/// <reference lib="webworker" />
/**
 * 배치 슬라이스/출력 Web Worker.
 *
 * 메인스레드에서 world 삼각형 배열을 받아 레이어별로 슬라이스 → rasterize →
 * PNG(ZIP)로 인코딩하거나 G-code 로 조립한다. 메인스레드 프리즈를 없애는 것이 목적.
 *
 * 순수 코어(sliceTrianglesAtY / chainSegments / rasterizePolygons /
 * buildPngZipEntries)를 그대로 재사용하므로 산출 바이트는 동기 경로와
 * 동일하다. Babylon 은 import 하지 않는다.
 */
import { generateFdmGcodeFromTriangles } from "../utils/gcode/fdm-gcode";
import { buildPngZipEntries } from "../utils/slice-batch";
import {
  chainSegments,
  sliceTrianglesAtY,
  type SlicePolygon,
} from "../utils/slice-geometry";
import { rasterizePolygons, type SliceMask } from "../utils/slice-rasterize";
import { makeZipStore } from "../utils/zip-store";

import type {
  GcodeRequest,
  PngZipRequest,
  SliceBatchRequest,
  SliceBatchResponse,
  WorkerMeshGeometry,
  WorkerSliceOptions,
} from "./slice-batch.messages";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: SliceBatchResponse, transfer?: Transferable[]) {
  if (transfer) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

/**
 * progress 통지 스로틀러 (감사 A11). 레이어마다 postMessage 를 쏘면 대형
 * 모델에서 메인스레드 리스너가 과부하되므로 최소 간격을 둔다.
 *
 * 규칙: 직전 통지 후 minIntervalMs 미만이면 스킵하되, done === total
 * (마지막 레이어)은 반드시 통지한다 — 진행바가 100%에서 멈추지 않도록.
 */
function makeProgressThrottle(minIntervalMs = 50) {
  let lastAt = 0;
  return (done: number, total: number) => {
    const now = Date.now();
    if (done < total && now - lastAt < minIntervalMs) return;
    lastAt = now;
    post({ type: "progress", done, total });
  };
}

/** 한 레이어의 union 마스크 — getSliceMask(메인) 와 동일 절차. */
function sliceLayerMask(
  meshes: WorkerMeshGeometry[],
  sliceY: number,
  opts: WorkerSliceOptions,
): SliceMask {
  const polys: SlicePolygon[] = [];
  for (const m of meshes) {
    const segs = sliceTrianglesAtY(m.triangles, sliceY);
    polys.push(...chainSegments(segs));
  }
  return rasterizePolygons(polys, {
    widthPx: opts.widthPx,
    heightPx: opts.heightPx,
    plateWidthMm: opts.plateWidthMm,
    plateDepthMm: opts.plateDepthMm,
  });
}

/**
 * 1bpp 마스크 → PNG 바이트 (OffscreenCanvas).
 * mask-png.ts(document canvas)의 워커 등가물 — 브라우저 PNG 인코더 동일.
 */
async function maskToPngBytes(mask: SliceMask): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(mask.width, mask.height);
  const c2d = canvas.getContext("2d");
  if (!c2d) throw new Error("2D context unavailable");

  const img = c2d.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) {
    const v = mask.data[i] ? 255 : 0;
    const o = i * 4;
    img.data[o] = v;
    img.data[o + 1] = v;
    img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  c2d.putImageData(img, 0, 0);

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

async function runPngZip(req: PngZipRequest): Promise<void> {
  const { meshes, options } = req;
  if (options.topY <= 0) {
    post({ type: "done", buffer: null, mime: "application/zip" });
    return;
  }
  const layerCount = Math.max(
    1,
    Math.ceil(options.topY / options.layerHeightMm),
  );

  const reportProgress = makeProgressThrottle();
  const pngs: Uint8Array[] = [];
  for (let i = 0; i < layerCount; i++) {
    const sliceY = (i + 0.5) * options.layerHeightMm;
    const mask = sliceLayerMask(meshes, sliceY, options);
    pngs.push(await maskToPngBytes(mask));
    reportProgress(i + 1, layerCount);
  }

  const entries = buildPngZipEntries(
    pngs,
    layerCount,
    {
      layerHeightMm: options.layerHeightMm,
      widthPx: options.widthPx,
      heightPx: options.heightPx,
      plateWidthMm: options.plateWidthMm,
      plateDepthMm: options.plateDepthMm,
      exposure: options.exposure,
    },
    options.topY,
  );
  const zip = makeZipStore(entries);
  const buffer = await zip.arrayBuffer();
  post({ type: "done", buffer, mime: "application/zip" }, [buffer]);
}

/**
 * FDM G-code 조립 (감사 A5 — 메인스레드 프리즈 해소).
 *
 * 순수 함수 generateFdmGcodeFromTriangles 를 그대로 호출하므로 산출 문자열은
 * 동기(메인스레드) 경로와 정의상 동일하다. 진행률은 레이어 완료 콜백을 통해
 * 스로틀링해 통지한다.
 */
function runGcode(req: GcodeRequest): void {
  const { meshes, settings, range } = req;
  // 대상 mesh 가 없거나 슬라이스 범위가 비면 산출물 없음 (동기 경로와 동일 판정).
  if (meshes.length === 0 || range.yMax <= range.yMin) {
    post({ type: "gcode-done", gcode: null });
    return;
  }
  const triangleMeshes = meshes.map((m) => m.triangles);
  const reportProgress = makeProgressThrottle();
  const gcode = generateFdmGcodeFromTriangles(
    triangleMeshes,
    settings,
    range,
    (done, total) => reportProgress(done, total),
  );
  post({ type: "gcode-done", gcode });
}

ctx.addEventListener(
  "message",
  async (event: MessageEvent<SliceBatchRequest>) => {
    const req = event.data;
    try {
      if (req.kind === "pngzip") {
        await runPngZip(req);
      } else {
        runGcode(req);
      }
    } catch (err) {
      post({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
