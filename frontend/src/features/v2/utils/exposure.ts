/**
 * 레이어별 노광 시간 계산 — v1 SlicerWorker 의 보간 로직을 순수 함수로 이식.
 *
 * v1 원본 (services/slicer/SlicerWorker.ts):
 *   · i < bottomLayerCount                                → bottomExposureTime
 *   · bottomLayerCount ≤ i < bottomLayerCount + transition → 바닥→일반 선형 보간
 *   · 그 외                                                → exposureTime
 *
 * 전환 구간의 progress = (i - bottomLayerCount) / transitionLayerCount 이고
 * 노광 = bottom + (normal - bottom) * progress 이다. progress 는 전환 첫 레이어에서
 * 0 (= 바닥 노광), 마지막 전환 레이어에서 (transition-1)/transition 이며,
 * 전환 구간이 끝난 다음 레이어부터 정확히 일반 노광이 된다.
 */

export interface ExposureParams {
  /** 바닥 레이어 개수. */
  bottomLayerCount: number;
  /** 전환 레이어 개수 (0 이면 전환 없음 — 바닥→일반 즉시 전환). */
  transitionLayerCount: number;
  /** 바닥 레이어 노광 시간 (초). */
  bottomExposureSec: number;
  /** 일반 레이어 노광 시간 (초). */
  exposureSec: number;
}

/**
 * 0-based 레이어 인덱스의 노광 시간(초)을 반환한다.
 * v1 과 동일한 수식이므로 transitionLayerCount=0 일 때 기존 동작(바닥 or 일반)과 완전 일치.
 */
export function layerExposureSec(
  layerIndex: number,
  params: ExposureParams,
): number {
  const { bottomLayerCount, transitionLayerCount, bottomExposureSec, exposureSec } =
    params;

  if (layerIndex < bottomLayerCount) {
    return bottomExposureSec;
  }

  if (layerIndex < bottomLayerCount + transitionLayerCount) {
    const progress = (layerIndex - bottomLayerCount) / transitionLayerCount;
    return bottomExposureSec + (exposureSec - bottomExposureSec) * progress;
  }

  return exposureSec;
}
