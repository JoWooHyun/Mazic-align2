// v2 서포트 모듈 public surface.

export { default as SupportParamsPanel } from "./components/SupportParamsPanel";
export { useSupportParamsStore } from "./hooks/useSupportParamsStore";

export type { SupportParams, SupportParamKey } from "./types";
export {
  DEFAULT_SUPPORT_PARAMS,
  SUPPORT_PARAM_LIMITS,
  DEFAULT_LAYER_GRAPH_PARAMS,
  DEFAULT_PLACE_POINTS_PARAMS,
  SUPPORT_DETECT_PARAM_LIMITS,
} from "./utils/defaults";

// 서포트 재설계(S-4) 검출·점생성 공개면 (신규).
export { detectLayerGraph } from "./detect/layer-graph";
export { placeSupportPoints } from "./detect/place-points";
export type { PlacePointsParams } from "./detect/place-points";
export type {
  IslandRegion,
  OverhangRegion,
  LayerGraphResult,
  LayerGraphParams,
} from "./detect/types";
