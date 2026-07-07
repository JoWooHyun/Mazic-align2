/// <reference lib="webworker" />
/**
 * 배치 슬라이스/출력 Web Worker.
 *
 * 메인스레드에서 world 삼각형 배열을 받아 레이어별로 슬라이스 → rasterize →
 * PNG(ZIP) 또는 CTB 로 인코딩한다. 메인스레드 프리즈를 없애는 것이 목적.
 *
 * 순수 코어(sliceTrianglesAtY / chainSegments / rasterizePolygons /
 * encodeRle1bpp / assembleCtb / buildPngZipEntries)를 그대로 재사용하므로
 * 산출 바이트는 동기 경로와 동일하다. Babylon 은 import 하지 않는다.
 */
import {
  assembleCtb,
  encodeRle1bpp,
} from "../utils/ctb-encoder";
import { buildPngZipEntries } from "../utils/slice-batch";
import {
  chainSegments,
  sliceTrianglesAtY,
  type SlicePolygon,
} from "../utils/slice-geometry";
import { rasterizePolygons, type SliceMask } from "../utils/slice-rasterize";
import { makeZipStore } from "../utils/zip-store";

import type {
  CtbRequest,
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

  const pngs: Uint8Array[] = [];
  for (let i = 0; i < layerCount; i++) {
    const sliceY = (i + 0.5) * options.layerHeightMm;
    const mask = sliceLayerMask(meshes, sliceY, options);
    pngs.push(await maskToPngBytes(mask));
    post({ type: "progress", done: i + 1, total: layerCount });
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

async function runCtb(req: CtbRequest): Promise<void> {
  const { meshes, options, ctb } = req;
  if (options.topY <= 0) {
    post({ type: "done", buffer: null, mime: "application/octet-stream" });
    return;
  }
  const layerCount = Math.max(
    1,
    Math.ceil(options.topY / options.layerHeightMm),
  );

  // 기존 인코더와 동일한 기본값 처리 (makeCtbV4 의 ?? 기본과 일치).
  const exposureSec = ctb.exposureSec ?? 2.5;
  const bottomExposureSec = ctb.bottomExposureSec ?? 30.0;
  const bottomLayers = ctb.bottomLayerCount ?? 5;
  const transitionLayers = ctb.transitionLayerCount ?? 0;
  const lightOffSec = ctb.lightOffDelaySec ?? 0.0;

  const layerData: Uint8Array[] = [];
  for (let i = 0; i < layerCount; i++) {
    const z = (i + 0.5) * options.layerHeightMm;
    const mask = sliceLayerMask(meshes, z, options);
    layerData.push(encodeRle1bpp(mask));
    post({ type: "progress", done: i + 1, total: layerCount });
  }

  const blob = assembleCtb(layerData, layerCount, {
    layerHeightMm: options.layerHeightMm,
    resolutionX: options.widthPx,
    resolutionY: options.heightPx,
    bedSizeXMm: options.plateWidthMm,
    bedSizeYMm: options.plateDepthMm,
    bedSizeZMm: ctb.bedSizeZMm,
    exposureSec,
    bottomExposureSec,
    bottomLayers,
    transitionLayers,
    lightOffSec,
  });
  const buffer = await blob.arrayBuffer();
  post(
    { type: "done", buffer, mime: "application/octet-stream" },
    [buffer],
  );
}

ctx.addEventListener(
  "message",
  async (event: MessageEvent<SliceBatchRequest>) => {
    const req = event.data;
    try {
      if (req.kind === "pngzip") {
        await runPngZip(req);
      } else {
        await runCtb(req);
      }
    } catch (err) {
      post({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  },
);
