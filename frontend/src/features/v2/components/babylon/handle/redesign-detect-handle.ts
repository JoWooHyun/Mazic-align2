// 서포트 재설계(S-4) 핸들 그룹 — 검출 입력 준비·점 표시·라우팅 확정·clearRedesignDetect.
//   구현은 redesign-detect-actions.ts 의 ctx 기반 함수에 위임한다. 기존 dental
//   island 핸들과 독립 (마진/dental 코드 미참조 — 리드 결정 1).
import type { BabylonSceneHandle } from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";
import {
  disposeRedesignVisualization,
  prepareRedesignDetectInput,
  renderRedesignPoints,
  routeAndFinalizePoints,
} from "../redesign-detect-actions";

type RedesignDetectHandle = Pick<
  BabylonSceneHandle,
  | "clearRedesignDetect"
  | "routeAndFinalizeRedesignPoints"
  | "prepareRedesignDetectInput"
  | "renderRedesignPoints"
>;

export function buildRedesignDetectHandle(ctx: SceneCtx): RedesignDetectHandle {
  return {
    clearRedesignDetect() {
      disposeRedesignVisualization(ctx);
    },
    routeAndFinalizeRedesignPoints(points, params, target) {
      return routeAndFinalizePoints(ctx, points, params, target);
    },
    // S-2 워커 경로 — 씬 접근(삼각형 추출)과 시각화만 담당.
    //   데모 수정 1차 ③: stlId 를 주면 그 모델, 없으면 활성 STL(종전).
    prepareRedesignDetectInput(stlId) {
      return prepareRedesignDetectInput(ctx, stlId);
    },
    renderRedesignPoints(points) {
      renderRedesignPoints(ctx, points);
    },
  };
}
