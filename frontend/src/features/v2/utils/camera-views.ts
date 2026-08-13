import { ArcRotateCamera, Mesh, Vector3 } from "@babylonjs/core";

export type ViewPreset =
  | "home"
  | "top"
  | "bottom"
  | "front"
  | "back"
  | "left"
  | "right"
  | "iso";

/**
 * 카메라를 주어진 프리셋으로 이동.
 *
 * 각도는 내부 Babylon Y-up 좌표계 기준이다. 괄호 안은 **표시 규약(Z-up, B-13)**
 * 으로 본 같은 방향 — `types/axis-display.ts` 의 `(x, −z, y)` 매핑을 적용한 것.
 *   - Top:    위에서 아래 보기 (alpha=-π/2, beta≈0) — 내부 +Y = 표시 +Z
 *   - Bottom: 아래에서 위 보기 (alpha=-π/2, beta≈π)
 *   - Front:  내부 -Z 쪽에서 보기 (표시 +Y 쪽)
 *   - Back:   내부 +Z 쪽        (표시 -Y 쪽)
 *   - Left:   내부 -X 쪽에서 +X (표시도 -X)
 *   - Right:  내부 +X 쪽        (표시도 +X)
 *   - Iso:    기본 등각
 *
 * ⚠️ **동작(카메라 각도)은 B-13 에서 바꾸지 않았다.** Top/Front/Left 가 화면에
 * 비추는 그림은 종전과 동일하다 — 축 표기만 Z-up 으로 바뀌었을 뿐이라 프리셋의
 * 의미가 그대로 성립하기 때문이다. 각도를 건드리면 리드가 실물 확인할 때
 * 원인 분리가 어려워지므로 주석만 정리했다.
 *
 * radius / target 은 호출 측에서 별도 frame() 후에 호출하거나,
 * radius/target 을 유지한 채 각도만 바꾼다.
 */
export function applyViewPreset(
  camera: ArcRotateCamera,
  preset: ViewPreset,
): void {
  // beta 가 정확히 0 이면 ArcRotateCamera 가 짐벌락이 걸려 화면이 튄다.
  const TOP_EPS = 0.0001;

  switch (preset) {
    case "top":
      camera.alpha = -Math.PI / 2;
      camera.beta = TOP_EPS;
      break;
    case "bottom":
      // beta 가 정확히 π 이면 top 과 마찬가지로 짐벌락이 걸린다.
      camera.alpha = -Math.PI / 2;
      camera.beta = Math.PI - TOP_EPS;
      break;
    case "front":
      camera.alpha = -Math.PI / 2;
      camera.beta = Math.PI / 2;
      break;
    case "back":
      camera.alpha = Math.PI / 2;
      camera.beta = Math.PI / 2;
      break;
    case "left":
      camera.alpha = Math.PI;
      camera.beta = Math.PI / 2;
      break;
    case "right":
      camera.alpha = 0;
      camera.beta = Math.PI / 2;
      break;
    case "home":
    case "iso":
    default:
      camera.alpha = -Math.PI / 4;
      camera.beta = Math.PI / 3;
      break;
  }
}

/**
 * 빈 씬 (모델이 없을 때) 의 표준 카메라 위치.
 * 빌드플레이트 중심을 보고 거리는 plate diag * 1.3.
 */
export function resetCameraOnPlate(
  camera: ArcRotateCamera,
  plateWidthMm: number,
  plateDepthMm: number,
): void {
  const diag = Math.hypot(plateWidthMm, plateDepthMm);
  camera.target.copyFrom(Vector3.Zero());
  camera.radius = diag * 1.3;
  camera.lowerRadiusLimit = diag * 0.2;
  camera.upperRadiusLimit = diag * 6;
  applyViewPreset(camera, "iso");
}

/**
 * 모델 AABB 에 카메라를 맞춘다. (target 도 같이 이동)
 */
export function frameCameraToMesh(
  camera: ArcRotateCamera,
  mesh: Mesh,
): void {
  frameCameraToMeshes(camera, [mesh]);
}

/**
 * 여러 메쉬의 합산 AABB 에 카메라를 맞춘다. 비어 있으면 무동작.
 */
export function frameCameraToMeshes(
  camera: ArcRotateCamera,
  meshes: Mesh[],
): void {
  if (meshes.length === 0) return;

  let min: Vector3 | null = null;
  let max: Vector3 | null = null;

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const bb = mesh.getBoundingInfo().boundingBox;
    min = min ? Vector3.Minimize(min, bb.minimumWorld) : bb.minimumWorld.clone();
    max = max ? Vector3.Maximize(max, bb.maximumWorld) : bb.maximumWorld.clone();
  }

  if (!min || !max) return;

  const center = Vector3.Center(min, max);
  const diag = max.subtract(min).length();

  camera.target.copyFrom(center);
  camera.radius = Math.max(diag * 1.8, 1);
  camera.lowerRadiusLimit = Math.max(diag * 0.3, 0.5);
  camera.upperRadiusLimit = Math.max(diag * 6, 10);
  applyViewPreset(camera, "iso");
}
