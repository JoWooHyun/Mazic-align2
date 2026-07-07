import type { BabylonSceneHandle } from "../components/BabylonScene";
import { layerExposureSec } from "./exposure";
import type { SliceMask } from "./slice-rasterize";
import { maskToPngBlob } from "./mask-png";
import { makeZipStore, type ZipEntry } from "./zip-store";

export interface BatchSliceOptions {
  layerHeightMm: number;
  widthPx: number;
  heightPx: number;
  plateWidthMm: number;
  plateDepthMm: number;
  /**
   * 노광 설정 (선택). 지정 시 manifest 에 레이어별 exposureSec 배열을 동봉한다.
   * 미지정 시 manifest 는 기존과 동일 (노광 정보 없음 — 하위 호환).
   */
  exposure?: {
    bottomLayerCount: number;
    transitionLayerCount: number;
    bottomExposureSec: number;
    exposureSec: number;
  };
  /** 0 ≤ progress ≤ 1 콜백 (선택). */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 이미 PNG 로 인코딩된 레이어 바이트 배열 + 파라미터로 ZIP STORE 에 넣을
 * ZipEntry 배열(manifest.json + layer_*.png)을 조립한다.
 *
 * Babylon / 캔버스에 의존하지 않는 순수 함수 — 메인스레드(exportLayersAsPngZip)와
 * 워커가 공유한다. manifest 필드/파일명 규칙은 분리 전과 동일.
 */
export function buildPngZipEntries(
  pngs: Uint8Array[],
  layerCount: number,
  opts: BatchSliceOptions,
  topY: number,
): ZipEntry[] {
  const entries: ZipEntry[] = [];

  // 노광 설정이 있으면 레이어별 노광 시간(초) 배열을 계산해 manifest 에 동봉.
  const exposureSecByLayer = opts.exposure
    ? Array.from({ length: layerCount }, (_, i) =>
        layerExposureSec(i, opts.exposure!),
      )
    : undefined;

  const manifest = {
    layerCount,
    layerHeightMm: opts.layerHeightMm,
    widthPx: opts.widthPx,
    heightPx: opts.heightPx,
    plateWidthMm: opts.plateWidthMm,
    plateDepthMm: opts.plateDepthMm,
    topY,
    generatedAt: new Date().toISOString(),
    generator: "resinforge-v2",
    ...(exposureSecByLayer ? { exposureSecByLayer } : {}),
  };
  entries.push({
    name: "manifest.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  });

  const pad = String(layerCount).length;
  for (let i = 0; i < pngs.length; i++) {
    entries.push({
      name: `layer_${String(i + 1).padStart(pad, "0")}.png`,
      data: pngs[i],
    });
  }

  return entries;
}

/**
 * sceneTop 까지 layerHeight 간격으로 모든 레이어 마스크를 만들어
 * PNG 로 인코딩 → ZIP STORE 1 개로 묶는다.
 *
 * 메모리 관리: 마스크 자체는 즉시 PNG 로 변환 후 버린다. 큰 해상도 +
 * 수백 레이어도 동시에 메모리에 1 layer 만 들고 있다.
 *
 * 파일명: layer_00001.png … (1-based, leading zero padded)
 * 첫 번째 파일로 메타 텍스트 manifest.json 동봉.
 */
export async function exportLayersAsPngZip(
  sceneHandle: BabylonSceneHandle,
  opts: BatchSliceOptions,
): Promise<Blob | null> {
  const topY = sceneHandle.getSceneTopY();
  if (topY <= 0) return null;
  const layerCount = Math.max(1, Math.ceil(topY / opts.layerHeightMm));

  const pngs: Uint8Array[] = [];

  for (let i = 0; i < layerCount; i++) {
    const sliceY = (i + 0.5) * opts.layerHeightMm;
    const mask: SliceMask = sceneHandle.getSliceMask(
      sliceY,
      opts.widthPx,
      opts.heightPx,
    );
    pngs.push(await maskToPngBlob(mask));
    opts.onProgress?.(i + 1, layerCount);

    // 다음 microtask 로 yield — 큰 작업 중 UI 가 멈추지 않게.
    if (i % 8 === 7) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  return makeZipStore(buildPngZipEntries(pngs, layerCount, opts, topY));
}
