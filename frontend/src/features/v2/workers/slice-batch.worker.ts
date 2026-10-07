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
import {
  runTask0GcodeExport,
  runTask0JobZipExport,
  type Task0JobStage,
} from "../utils/task0/task0-export";
import { makeZipStore } from "../utils/zip-store";

import type {
  GcodeRequest,
  PngZipRequest,
  SliceBatchRequest,
  SliceBatchResponse,
  Task0GcodeRequest,
  Task0JobZipRequest,
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
 * 단계(stage — Task0 job.zip 만)가 바뀐 첫 통지도 바로 보낸다(화면의 단계 이름이 늦게 바뀌지 않도록).
 * stage 를 넘기지 않는 기존 경로는 종전과 같은 메시지·같은 간격이다(stage 키 없음).
 */
function makeProgressThrottle(minIntervalMs = 50) {
  let lastAt = 0;
  let lastStage: Task0JobStage | undefined;
  return (done: number, total: number, stage?: Task0JobStage) => {
    const now = Date.now();
    if (done < total && stage === lastStage && now - lastAt < minIntervalMs) return;
    lastAt = now;
    lastStage = stage;
    if (stage === undefined) post({ type: "progress", done, total });
    else post({ type: "progress", done, total, stage });
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

/**
 * Task0 G-code(run.gcode) 조립 + 검사 (Z2).
 *
 * 처리 전부를 순수 함수 runTask0GcodeExport(utils/task0/task0-export.ts)에 맡긴다 — writer → 채움 실패 층 확인 →
 * Task0 파서 이식판 검사 → 요약. 검증 스크립트가 같은 함수를 직접 불러 산출 바이트를 확인하므로, 이 함수에는
 * 진행률 배선 외의 처리를 두지 않는다. writer 는 층마다 커버리지 검사를 돌려 무겁다(층당 수십~수백 ms —
 * 계획서 §4-2) → 반드시 이 워커에서 돈다. 취소는 다른 경로와 같이 서비스의 worker terminate.
 */
function runTask0Gcode(req: Task0GcodeRequest): void {
  const reportProgress = makeProgressThrottle();
  const result = runTask0GcodeExport(
    {
      meshes: req.meshes.map((m) => m.triangles),
      topY: req.topY,
      layerHeightMm: req.layerHeightMm,
      writer: req.writer,
      exposure: req.exposure,
      printable: req.printable,
    },
    (done, total) => reportProgress(done, total),
  );
  post({ type: "task0-done", result });
}

/**
 * Task0 job.zip 조립 + 검사 (Z3).
 *
 * 처리 전부를 순수 함수 runTask0JobZipExport(utils/task0/task0-export.ts)에 맡긴다 — run.gcode(위와 같은 검사) →
 * 층 마스크 PNG(투사 프레임) → 빈 층 집합 대조 → manifest·exposure·preview·zip → 자기 검사. 검증 스크립트가 같은 함수·같은
 * 메시지를 넣어 산출 바이트를 확인하므로, 이 함수에는 진행률 배선과 zip 바이트 전달(transfer) 외의 처리를 두지 않는다.
 * 층당 writer 수십~수백 ms + PNG 약 20 ms 라 반드시 이 워커에서 돈다. 취소는 다른 경로와 같이 서비스의 worker terminate.
 */
async function runTask0JobZip(req: Task0JobZipRequest): Promise<void> {
  const reportProgress = makeProgressThrottle();
  const result = await runTask0JobZipExport(
    {
      meshes: req.meshes.map((m) => m.triangles),
      topY: req.topY,
      layerHeightMm: req.layerHeightMm,
      writer: req.writer,
      exposure: req.exposure,
      frame: req.frame,
      printable: req.printable,
      generator: req.generator,
      generatedAt: req.generatedAt,
    },
    (stage, done, total) => reportProgress(done, total, stage),
  );
  if (result.ok) post({ type: "task0-job-done", result }, [result.zip.buffer]);
  else post({ type: "task0-job-done", result });
}

ctx.addEventListener(
  "message",
  async (event: MessageEvent<SliceBatchRequest>) => {
    const req = event.data;
    try {
      if (req.kind === "pngzip") {
        await runPngZip(req);
      } else if (req.kind === "gcode") {
        runGcode(req);
      } else if (req.kind === "task0-gcode") {
        runTask0Gcode(req);
      } else {
        await runTask0JobZip(req);
      }
    } catch (err) {
      post({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
