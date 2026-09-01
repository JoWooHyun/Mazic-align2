import { create } from "zustand";

import {
  DEFAULT_LAYER_GRAPH_PARAMS,
  DEFAULT_PLACE_POINTS_PARAMS,
} from "../utils/defaults";
import type { LayerGraphParams } from "../detect/types";
import type { PlacePointsParams } from "../detect/place-points";

/**
 * 재설계(S-4) **검출·점생성** 파라미터의 사용자 조절 값 (P-2).
 *
 * ## 왜 별도 스토어인가
 * 기존 `useSupportParamsStore` 는 **구조물(기둥·팁·바닥)** 파라미터다. 이 스토어는
 * **"어디를 받칠지 고르고 점을 몇 개 찍을지"** 를 정하는 검출 단계 값이라 성격이
 * 다르고, 프리셋(light/medium/heavy)의 영향도 받지 않아야 한다.
 *
 * ## 왜 필요했나
 * 종전에는 `SUPPORT_DETECT_PARAM_LIMITS` 에 한계값이 선언돼 있는데도 **읽는
 * 컴포넌트가 하나도 없어** 9개 값이 전부 모듈 상수로 굳어 있었다. 리드 결정 3
 * ("모든 값 사용자 조절 가능")과 정면으로 어긋났고, 특히 B-22 로 도입한
 * `verticalSpacingMm` 는 **점 개수를 직접 좌우**하는데도 UI 가 없어 "서포트가
 * 너무 많다/적다" 를 사용자가 직접 조정할 수 없었다.
 *
 * ## `overhangAngleDeg` 의 소유권 (C-3 과의 관계)
 * 검출각은 **뷰어의 빨간 오버행 하이라이트와 같은 값이어야 한다**(판정서 C-3).
 * 그 단일 출처는 `useSupportParamsStore.overhangAngleDeg` 이므로, 여기서는
 * 검출각을 **다루지 않는다** — 중복 소유는 두 값이 어긋나는 원래 버그로 되돌아간다.
 */
export type DetectParams = Omit<LayerGraphParams, "liftMm" | "overhangAngleDeg"> &
  PlacePointsParams;

const DEFAULT_DETECT_PARAMS: DetectParams = {
  layerHeightMm: DEFAULT_LAYER_GRAPH_PARAMS.layerHeightMm,
  plateGapMm: DEFAULT_LAYER_GRAPH_PARAMS.plateGapMm,
  overlapSampleMm: DEFAULT_LAYER_GRAPH_PARAMS.overlapSampleMm,
  ...DEFAULT_PLACE_POINTS_PARAMS,
};

interface DetectParamsState {
  params: DetectParams;
  setParam: <K extends keyof DetectParams>(
    key: K,
    value: DetectParams[K],
  ) => void;
  reset: () => void;
}

export const useDetectParamsStore = create<DetectParamsState>((set) => ({
  params: DEFAULT_DETECT_PARAMS,

  setParam: (key, value) =>
    set((s) => ({ params: { ...s.params, [key]: value } })),

  reset: () => set({ params: DEFAULT_DETECT_PARAMS }),
}));

export { DEFAULT_DETECT_PARAMS };
