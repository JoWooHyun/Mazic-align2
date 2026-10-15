// 카메라 핸들 그룹 — setView/fit/fitSelection/viewPlate/previewTransform.
//   원본 useImperativeHandle 의 카메라·미리보기 메서드를 순수 이동. buildCameraHandle
//   이 해당 메서드 객체를 반환하고 본체가 스프레드로 조립한다.
//   사고 방지 4차(소): 모델 0개 폴백·플레이트 보기는 Task0 면 출력 가능 영역(플레이트를 그 사각형에 그린다)의
//   중심·크기로 맞춘다(emptySceneCameraFrame). 기존 프로파일은 종전 그대로 원점 중심.
import type { ArcRotateCamera } from "@babylonjs/core";
import { applyTransformToMesh } from "../../../utils/transform";
import {
  applyViewPreset,
  frameCameraToMeshes,
  resetCameraOnPlate,
} from "../../../utils/camera-views";
import type { PrintableAreaMm } from "../../../utils/build-volume";
import type { BabylonSceneHandle } from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";

type CameraHandle = Pick<
  BabylonSceneHandle,
  "setView" | "fit" | "fitSelection" | "viewPlate" | "previewTransform"
>;

/**
 * 빈 씬(모델 0개)·플레이트 보기의 카메라 프레이밍 대상 (사고 방지 4차(소)).
 *
 * Task0 면 플레이트를 출력 가능 영역(비대칭)에 그리므로(useSceneBootstrap #1.5 와 같은 식) 그 사각형의 크기·중심,
 * 아니면 종전 그대로 plate 크기에 center 없음(resetCameraOnPlate 가 원점을 본다).
 * 순수 함수 — 검증 스크립트(verify-cleanup-20261015)가 값으로 검사한다.
 */
export function emptySceneCameraFrame(
  plateWidthMm: number,
  plateDepthMm: number,
  area: PrintableAreaMm | null,
): { widthMm: number; depthMm: number; center?: [number, number] } {
  if (!area) return { widthMm: plateWidthMm, depthMm: plateDepthMm };
  return {
    widthMm: area.maxX - area.minX,
    depthMm: area.maxZ - area.minZ,
    center: [(area.minX + area.maxX) / 2, (area.minZ + area.maxZ) / 2],
  };
}

export function buildCameraHandle(ctx: SceneCtx): CameraHandle {
  // 빈 씬 폴백·플레이트 보기 공통 — 호출 시점의 최신 plate·영역 미러 ref 로 맞춘다.
  const resetOnPlate = (camera: ArcRotateCamera) => {
    const f = emptySceneCameraFrame(
      ctx.plateWRef.current,
      ctx.plateDRef.current,
      ctx.printableAreaRef.current,
    );
    resetCameraOnPlate(camera, f.widthMm, f.depthMm, f.center);
  };
  return {
    setView(preset) {
      const camera = ctx.cameraRef.current;
      if (!camera) return;
      applyViewPreset(camera, preset);
    },
    fit() {
      const camera = ctx.cameraRef.current;
      if (!camera) return;
      const meshes = Array.from(ctx.meshMapRef.current.values());
      if (meshes.length > 0) {
        frameCameraToMeshes(camera, meshes);
      } else {
        resetOnPlate(camera);
      }
    },
    fitSelection(ids) {
      const camera = ctx.cameraRef.current;
      if (!camera) return;
      // 넘어온 id 에 해당하는 STL 루트 메쉬만 모은다 (fit() 의 meshMapRef 재사용).
      const meshes = ids
        .map((id) => ctx.meshMapRef.current.get(id))
        .filter((m): m is NonNullable<typeof m> => m != null);
      if (meshes.length > 0) {
        frameCameraToMeshes(camera, meshes);
      } else {
        // 매칭 0 개 → 전체 fit() 폴백 (선택 없음 = 전체 맞춤).
        const all = Array.from(ctx.meshMapRef.current.values());
        if (all.length > 0) {
          frameCameraToMeshes(camera, all);
        } else {
          resetOnPlate(camera);
        }
      }
    },
    viewPlate() {
      const camera = ctx.cameraRef.current;
      if (!camera) return;
      // 홈(iso) 각도로 리셋 + 플레이트 AABB 프레이밍. resetCameraOnPlate 내부에서
      // applyViewPreset(camera, "iso") 로 홈 각도를 적용한다 (home == iso 각도).
      resetOnPlate(camera);
    },
    previewTransform(id, t) {
      const mesh = ctx.meshMapRef.current.get(id);
      if (mesh) applyTransformToMesh(mesh, t);
    },
  };
}
