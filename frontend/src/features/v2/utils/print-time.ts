/**
 * DLP 예상 출력 시간 추정 — v1 SlicerWorker 의 레이어별 합산식을 순수 함수로 이식.
 *
 * v1 원본 (services/slicer/SlicerWorker.ts 82~88행):
 *   레이어당 시간 = 노광시간
 *                 + lightOffDelay
 *                 + (리프트거리 / 리프트속도)      // 플랫폼 상승
 *                 + (리프트거리 / 하강속도)         // 플랫폼 하강
 *   전체 = Σ(레이어별)
 *
 * 노광시간은 레이어마다 다르다 (바닥/전환/일반). 이 값은 exposure.ts 의
 * layerExposureSec 로 계산해 v1 과 동일한 보간 결과를 얻는다. 리프트/딜레이는
 * 레이어 무관하게 상수이므로 (레이어 수 × 상수) 로 처리해도 되지만, 향후
 * 레이어별 리프트 확장을 대비해 v1 과 같이 레이어 루프로 합산한다.
 */

import {
  DEFAULT_LIFT_DISTANCE_MM,
  DEFAULT_LIFT_SPEED_MM_S,
  DEFAULT_RETRACT_SPEED_MM_S,
  DEFAULT_LIGHT_OFF_DELAY_SEC,
  type PrinterProfileV2,
} from "../types/printer";
import { layerExposureSec } from "./exposure";

// 노광 설정 기본값 — 프로파일 미지정 시 폴백 (ctb-encoder / ViewerV2Page 와 동일).
const DEFAULT_EXPOSURE_SEC = 2.5;
const DEFAULT_BOTTOM_EXPOSURE_SEC = 30.0;
const DEFAULT_BOTTOM_LAYER_COUNT = 5;
const DEFAULT_TRANSITION_LAYER_COUNT = 0;

/**
 * 프로파일 기반 예상 출력 시간(초)을 계산한다.
 *
 * 리프트/딜레이 필드가 프로파일에 없으면 v1 기본값(6.0 / 3.0 / 3.0 / 1.0)으로
 * 폴백하므로 기존 프로파일에서도 NaN/0 이 되지 않는다.
 *
 * @param layerCount 전체 레이어 수 (>= 0)
 * @param profile    현재 프린터 프로파일
 * @returns 초 단위 예상 출력 시간
 */
export function estimatePrintTimeSec(
  layerCount: number,
  profile: PrinterProfileV2,
): number {
  if (layerCount <= 0) return 0;

  // 노광 파라미터 (미지정 시 기본값).
  const exposureParams = {
    bottomLayerCount: profile.bottomLayerCount ?? DEFAULT_BOTTOM_LAYER_COUNT,
    transitionLayerCount:
      profile.transitionLayerCount ?? DEFAULT_TRANSITION_LAYER_COUNT,
    bottomExposureSec: profile.bottomExposureSec ?? DEFAULT_BOTTOM_EXPOSURE_SEC,
    exposureSec: profile.exposureSec ?? DEFAULT_EXPOSURE_SEC,
  };

  // 리프트/딜레이 파라미터 (미지정 시 v1 기본값).
  const liftDistanceMm = profile.liftDistanceMm ?? DEFAULT_LIFT_DISTANCE_MM;
  const liftSpeedMmS = profile.liftSpeedMmS ?? DEFAULT_LIFT_SPEED_MM_S;
  const retractSpeedMmS = profile.retractSpeedMmS ?? DEFAULT_RETRACT_SPEED_MM_S;
  const lightOffDelaySec =
    profile.lightOffDelaySec ?? DEFAULT_LIGHT_OFF_DELAY_SEC;

  // 리프트 왕복 시간 (레이어 공통 상수). 속도가 0 이하면 나눗셈 폭주를 막고 0 처리.
  const liftUpSec = liftSpeedMmS > 0 ? liftDistanceMm / liftSpeedMmS : 0;
  const liftDownSec = retractSpeedMmS > 0 ? liftDistanceMm / retractSpeedMmS : 0;
  const perLayerMechanicalSec = lightOffDelaySec + liftUpSec + liftDownSec;

  let totalSec = 0;
  for (let i = 0; i < layerCount; i++) {
    totalSec += layerExposureSec(i, exposureParams);
    totalSec += perLayerMechanicalSec;
  }
  return totalSec;
}
