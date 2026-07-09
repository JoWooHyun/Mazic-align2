import { layerExposureSec } from "./exposure";
import type { ZipEntry } from "./zip-store";

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
 * Babylon / 캔버스에 의존하지 않는 순수 함수 — 워커가 PNG 를 인코딩해 호출한다.
 * manifest 필드/파일명 규칙은 분리 전과 동일.
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
