// dental 핸들 그룹 — clearDentalPaint/getPaintedFaceIds/findDentalMargin/
//   clearDentalMargin/detectDentalIslands/clearDentalIslands/invalidateDentalResults.
//   원본 useImperativeHandle 의 dental 메서드를 순수 이동. 검출·정리 구현은
//   dental-actions.ts 의 ctx 기반 함수에 위임한다. 로직·문자열 무변경.
import { Mesh } from "@babylonjs/core";
import { computePaintedFaceIds } from "../../../utils/dental/paint-mask";
import type { BabylonSceneHandle } from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";
import {
  disposeIslandVisualization,
  disposeMarginVisualization,
  invalidateDentalResults,
  runDetectDentalIslands,
  runFindDentalMargin,
} from "../dental-actions";

type DentalHandle = Pick<
  BabylonSceneHandle,
  | "clearDentalPaint"
  | "getPaintedFaceIds"
  | "findDentalMargin"
  | "clearDentalMargin"
  | "detectDentalIslands"
  | "clearDentalIslands"
  | "invalidateDentalResults"
>;

export function buildDentalHandle(ctx: SceneCtx): DentalHandle {
  return {
    clearDentalPaint() {
      // 오버레이 데칼 dispose + painted 점 초기화 (원본 clearMask 대응).
      const affected = new Set<Mesh>();
      for (const pt of ctx.paintPointsRef.current) affected.add(pt.mesh);
      for (const ov of ctx.paintOverlaysRef.current) ov.dispose(false, true);
      ctx.paintOverlaysRef.current = [];
      ctx.paintPointsRef.current = [];
      // 원본 clearMask 는 autoFill(floodfill) 도 함께 정리했다 → 마진 시각화·
      //   floodfill 도 지운다. 색칠이 사라지면 그 마진은 무의미하므로 일관.
      disposeMarginVisualization(ctx);
      // 색칠이 사라지면 그 아일랜드 시각화도 무의미 → 함께 정리 (2-3b 패턴).
      disposeIslandVisualization(ctx);
      // 색칠이 있던 STL 마다 빈 목록 통지.
      for (const mesh of affected) {
        for (const [id, m] of ctx.meshMapRef.current) {
          if (m === mesh) {
            ctx.onPaintedFacesChangeRef.current?.(id, []);
            break;
          }
        }
      }
    },
    getPaintedFaceIds(stlId) {
      const mesh = ctx.meshMapRef.current.get(stlId);
      if (!mesh) return [];
      return Array.from(
        computePaintedFaceIds(mesh, ctx.paintPointsRef.current),
      );
    },
    findDentalMargin() {
      return runFindDentalMargin(ctx);
    },
    clearDentalMargin() {
      // 마진 시각화 + floodfill 만 정리. 브러쉬 색칠(painted)은 유지.
      disposeMarginVisualization(ctx);
    },
    detectDentalIslands(layerHeightMm) {
      return runDetectDentalIslands(ctx, layerHeightMm);
    },
    clearDentalIslands() {
      // 아일랜드 마젠타 overlay + 결과 ref 만 정리. 색칠/마진은 유지.
      disposeIslandVisualization(ctx);
    },
    invalidateDentalResults(stlId) {
      // 페이지 측 transform 수렴점에서 호출. 마진·아일랜드 dispose+ref null +
      // onDentalResultsInvalidated 콜백 (감사 B1). refs 만 참조라 [] 핸들 안전.
      invalidateDentalResults(ctx, stlId);
    },
  };
}
