// 서포트 재설계(S-4) 핸들 그룹 — runRedesignDetect / clearRedesignDetect.
//   구현은 redesign-detect-actions.ts 의 ctx 기반 함수에 위임한다. 기존 dental
//   island 핸들과 독립 (마진/dental 코드 미참조 — 리드 결정 1).
import type { BabylonSceneHandle } from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";
import {
  disposeRedesignVisualization,
  runRedesignDetect,
} from "../redesign-detect-actions";

type RedesignDetectHandle = Pick<
  BabylonSceneHandle,
  "runRedesignDetect" | "clearRedesignDetect"
>;

export function buildRedesignDetectHandle(ctx: SceneCtx): RedesignDetectHandle {
  return {
    runRedesignDetect(projectId, opts) {
      return runRedesignDetect(ctx, projectId, opts);
    },
    clearRedesignDetect() {
      disposeRedesignVisualization(ctx);
    },
  };
}
