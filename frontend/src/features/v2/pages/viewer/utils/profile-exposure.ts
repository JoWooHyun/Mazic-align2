// 프린터 프로파일의 노광 설정을 PNG-ZIP manifest 용 exposure 객체로 변환.
// (ViewerV2Page 에서 추출 — 동작 불변.)

import {
  DEFAULT_EXPOSURE_SEC,
  DEFAULT_BOTTOM_EXPOSURE_SEC,
  DEFAULT_BOTTOM_LAYER_COUNT,
  DEFAULT_TRANSITION_LAYER_COUNT,
  type PrinterProfileV2,
} from "../../../types/printer";

/**
 * 프로파일의 노광 설정을 PNG-ZIP manifest 용 exposure 객체로 변환.
 * 프로파일에 노광 필드가 하나도 없으면 undefined 를 반환해 manifest 에 노광 정보를
 * 추가하지 않는다 (기존 프로파일 하위 호환 — 산출물 불변).
 * (기본값은 ctb-encoder 의 기본값과 동일하게 맞춰 CTB/manifest 간 일관성 유지.)
 */
export function profileExposure(p: PrinterProfileV2):
  | {
      bottomLayerCount: number;
      transitionLayerCount: number;
      bottomExposureSec: number;
      exposureSec: number;
    }
  | undefined {
  const hasAny =
    p.exposureSec !== undefined ||
    p.bottomExposureSec !== undefined ||
    p.bottomLayerCount !== undefined ||
    p.transitionLayerCount !== undefined;
  if (!hasAny) return undefined;
  return {
    bottomLayerCount: p.bottomLayerCount ?? DEFAULT_BOTTOM_LAYER_COUNT,
    transitionLayerCount:
      p.transitionLayerCount ?? DEFAULT_TRANSITION_LAYER_COUNT,
    bottomExposureSec: p.bottomExposureSec ?? DEFAULT_BOTTOM_EXPOSURE_SEC,
    exposureSec: p.exposureSec ?? DEFAULT_EXPOSURE_SEC,
  };
}
