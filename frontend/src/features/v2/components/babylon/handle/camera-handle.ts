// 카메라 핸들 그룹 — setView/fit/fitSelection/viewPlate/previewTransform.
//   원본 useImperativeHandle 의 카메라·미리보기 메서드를 순수 이동. buildCameraHandle
//   이 해당 메서드 객체를 반환하고 본체가 스프레드로 조립한다. 로직 무변경.
import { applyTransformToMesh } from "../../../utils/transform";
import {
  applyViewPreset,
  frameCameraToMeshes,
  resetCameraOnPlate,
} from "../../../utils/camera-views";
import type { BabylonSceneHandle } from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";

type CameraHandle = Pick<
  BabylonSceneHandle,
  "setView" | "fit" | "fitSelection" | "viewPlate" | "previewTransform"
>;

export function buildCameraHandle(ctx: SceneCtx): CameraHandle {
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
        resetCameraOnPlate(camera, ctx.plateWRef.current, ctx.plateDRef.current);
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
          resetCameraOnPlate(
            camera,
            ctx.plateWRef.current,
            ctx.plateDRef.current,
          );
        }
      }
    },
    viewPlate() {
      const camera = ctx.cameraRef.current;
      if (!camera) return;
      // 홈(iso) 각도로 리셋 + 플레이트 AABB 프레이밍. resetCameraOnPlate 내부에서
      // applyViewPreset(camera, "iso") 로 홈 각도를 적용한다 (home == iso 각도).
      resetCameraOnPlate(camera, ctx.plateWRef.current, ctx.plateDRef.current);
    },
    previewTransform(id, t) {
      const mesh = ctx.meshMapRef.current.get(id);
      if (mesh) applyTransformToMesh(mesh, t);
    },
  };
}
