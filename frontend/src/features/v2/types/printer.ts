/**
 * v2 프린터 프로파일.
 *
 * 슬라이서가 LCD 해상도 / 빌드 볼륨을 알아야 정확한 출력 가능.
 * 옛 v1 core/printer 와 무관하게 다시 정의.
 *
 * 좌표: buildVolumeMm = [X, Y, Z] mm
 *   X  = LCD 가로 방향 폭        (Babylon X)
 *   Y  = LCD 세로 방향 깊이      (Babylon Z)
 *   Z  = 출력 가능 높이           (Babylon Y)
 */
export interface PrinterProfileV2 {
  id: string;
  name: string;
  lcdWidthPx: number;
  lcdHeightPx: number;
  pixelPitchUm: number;
  buildVolumeMm: [number, number, number];

  // ---- 노광 설정 (모두 선택 — 미지정 시 인코더 기본값 사용, 기존 프로파일 하위 호환) ----
  /** 일반 레이어 노광 시간 (초). */
  exposureSec?: number;
  /** 바닥 레이어 노광 시간 (초). */
  bottomExposureSec?: number;
  /** 바닥 레이어 개수. */
  bottomLayerCount?: number;
  /**
   * 전환 레이어 개수. 바닥 노광에서 일반 노광으로 선형 보간되는 구간 길이.
   * 0 이면 전환 없이 바닥→일반이 즉시 전환 (기본값, 기존 동작과 동일).
   */
  transitionLayerCount?: number;
}

/**
 * 빌드플레이트 정렬(좌표 매핑)에 쓰는 헬퍼.
 *   plateWidthMm  → Babylon X
 *   plateDepthMm  → Babylon Z
 *   plateHeightMm → Babylon Y (출력 최대 높이)
 */
export interface PlateDimensions {
  plateWidthMm: number;
  plateDepthMm: number;
  plateHeightMm: number;
}

export function profileToPlate(p: PrinterProfileV2): PlateDimensions {
  return {
    plateWidthMm: p.buildVolumeMm[0],
    plateDepthMm: p.buildVolumeMm[1],
    plateHeightMm: p.buildVolumeMm[2],
  };
}
