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
  applyZoomLimits(camera);
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
  applyZoomLimits(camera);
  applyViewPreset(camera, "iso");
}

/**
 * 줌 한계 — 사실상 무제한 (B-19).
 *
 * ## 왜 바꿨나
 * 종전에는 프레이밍할 때마다 `lowerRadiusLimit = diag×0.3` / `upperRadiusLimit
 * = diag×6` 으로 **모델 크기에 비례한 좁은 범위**를 걸었다. 그래서 작은 치아
 * 모델을 불러오면 조금만 당겨도 확대가 멈추고, 조금만 밀어도 축소가 멈췄다
 * (리드 실물: "줌 확대가 일정 수준 이상 안 된다. 줌아웃도 그렇다").
 * 리드 요청 = **둘 다 무제한**.
 *
 * ## 왜 완전한 0/Infinity 가 아닌가
 * · 하한 `MIN_RADIUS`: ArcRotateCamera 는 radius 가 0 이 되면 target 과 카메라가
 *   한 점에 겹쳐 **뷰 행렬이 특이해지고 화면이 뒤집히거나 NaN 이 된다.**
 *   0.01mm 는 10μm 라 레진 해상도(층 0.05mm)보다 훨씬 작아 실사용상 무제한이다.
 * · 상한 `MAX_RADIUS`: `camera.maxZ`(원거리 클리핑, 기본 10000) 를 넘겨 밀면
 *   모델이 잘려 사라진다. 그래서 상한을 두되 **maxZ 를 함께 올려** 그 지점까지
 *   실제로 보이게 만든다. 100,000mm = 100m 라 어떤 치과 모델·플레이트보다 크다.
 *
 * 프레이밍 함수들이 이 한 곳만 부르게 해서, 앞으로 한계가 다시 좁아지는
 * 회귀를 막는다.
 */
const MIN_RADIUS_MM = 0.01;
const MAX_RADIUS_MM = 100_000;

export function applyZoomLimits(camera: ArcRotateCamera): void {
  camera.lowerRadiusLimit = MIN_RADIUS_MM;
  camera.upperRadiusLimit = MAX_RADIUS_MM;
  // 멀리 밀었을 때 원거리 클리핑에 잘리지 않도록 far plane 도 함께 넓힌다.
  //   near(minZ)는 useSceneBootstrap 의 0.1 을 유지 — 더 줄이면 z-fighting 이 생긴다.
  if (camera.maxZ < MAX_RADIUS_MM * 2) camera.maxZ = MAX_RADIUS_MM * 2;
}
