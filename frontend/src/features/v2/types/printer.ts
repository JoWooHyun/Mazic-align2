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

  // ---- 리프트/딜레이 설정 (모두 선택 — 미지정 시 v1 기본값으로 폴백, 기존 프로파일 하위 호환) ----
  /** 리프트 거리 (mm). 레이어 노광 후 플랫폼이 올라갔다 내려오는 거리. */
  liftDistanceMm?: number;
  /** 리프트 속도 (mm/s). 플랫폼이 올라가는 속도. */
  liftSpeedMmS?: number;
  /** 하강 속도 (mm/s). 플랫폼이 내려오는 속도. */
  retractSpeedMmS?: number;
  /** 노광 후 대기 시간 (초). light-off delay. */
  lightOffDelaySec?: number;
}

/**
 * 노광 기본값 — 프로파일/옵션에 노광 값이 없을 때 폴백에 사용.
 * 인코더(ctb-encoder)·워커·예상 시간(print-time)·UI(SliceSidePanel)·
 * 프로파일 편집(PrinterProfileDialog)이 모두 이 상수를 참조해 값이 갈라지지 않도록 한다.
 */
export const DEFAULT_EXPOSURE_SEC = 2.5;
export const DEFAULT_BOTTOM_EXPOSURE_SEC = 30.0;
export const DEFAULT_BOTTOM_LAYER_COUNT = 5;
export const DEFAULT_TRANSITION_LAYER_COUNT = 0;

/**
 * 리프트/딜레이 v1 기본값 — 프로파일에 값이 없을 때 폴백에 사용.
 * (v1 SlicerWorker 합산식의 기본 파라미터와 동일.)
 */
export const DEFAULT_LIFT_DISTANCE_MM = 6.0;
export const DEFAULT_LIFT_SPEED_MM_S = 3.0;
export const DEFAULT_RETRACT_SPEED_MM_S = 3.0;
export const DEFAULT_LIGHT_OFF_DELAY_SEC = 1.0;

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
