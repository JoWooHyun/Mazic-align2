import {
  Color3,
  Mesh,
  Scene,
  SceneLoader,
  StandardMaterial,
  VertexBuffer,
} from "@babylonjs/core";
import "@babylonjs/loaders/STL";

/**
 * 평상 모드(select / dental-brush)의 모델 기본색 — ChiTuBox 풍 청록빛 파랑.
 *
 * ★ 색은 이 상수 **한 곳**에서만 관리한다 (CLAUDE.md 규칙 6 의 정신).
 *   로드 시점(loadStlIntoScene)과 모드 전환 시점(useEditModeSync →
 *   setModelDiffuseMode)이 같은 값을 써야 두 경로가 갈라지지 않는다.
 *
 * ⚠ Babylon 의 Color3 는 가변(mutable)이다. 이 상수를 머티리얼에 직접
 *   대입하면 이후 그 머티리얼의 색을 만지는 코드가 전역 상수를 오염시킨다.
 *   반드시 clone() 해서 넣는다.
 */
export const MODEL_DIFFUSE_COLOR = new Color3(0.19, 0.55, 0.82);

/**
 * 서포트 탭(editMode === "support") 의 모델 기본색 — 흰색.
 *
 * diffuseColor 와 vertex color 는 **곱셈**으로 결합한다. 흰색은 곱셈의
 * 항등원이라 `overhang.ts` 가 칠한 중성 회색(0.78, 0.79, 0.83) / 오버행
 * 빨강(1.0, 0.32, 0.32)이 그대로 보인다 — overhang.ts 의 함수 주석이
 * 명시한 계약("diffuseColor 가 흰색이면 vertex color 가 그대로 보인다")
 * 을 이 상수가 충족시킨다.
 */
export const MODEL_DIFFUSE_COLOR_OVERHANG = new Color3(1, 1, 1);

/**
 * STL 메쉬 머티리얼의 diffuseColor 를 표시 모드에 맞춰 전환한다.
 *
 * 리드 결정(2026-09-17, C안) — 오버행 색은 **서포트를 달 때만** 필요하다:
 *   · overhang = true  → 흰색        → 회색 모델 + 빨간 오버행 (CHITUBOX 방식)
 *   · overhang = false → 청록빛 파랑 → 깔끔한 단색 모델
 *
 * **vertex color 는 건드리지 않는다.** 전 정점 순회 없이 머티리얼 색 1개만
 * 바꾸므로 수십만 정점 모델에서도 모드 전환이 즉각적이다. 오버행 vertex
 * color 자체는 `useFileMeshSync` 의 재색칠 effect 가 임계각·자세 변경마다
 * 최신으로 유지한다 (B-35).
 *
 * 이미 같은 색이면 아무 일도 하지 않는다 (멱등).
 */
export function setModelDiffuseMode(mesh: Mesh, overhang: boolean): void {
  const mat = mesh.material;
  if (!(mat instanceof StandardMaterial)) return;
  const next = overhang ? MODEL_DIFFUSE_COLOR_OVERHANG : MODEL_DIFFUSE_COLOR;
  if (mat.diffuseColor.equals(next)) return;
  mat.diffuseColor = next.clone();
}

/**
 * STL Blob → Babylon Mesh.
 *
 *  1. STL Z-up → Babylon Y-up: X 축 -90° 회전을 vertex 에 베이크.
 *  2. 빌드플레이트 정렬 (vertex shift):
 *       · X, Z = AABB center (모델이 플레이트 한가운데로)
 *       · Y    = AABB minimum → base 를 Y = liftMm 에 정렬
 *         (liftMm=0 이면 base 가 Y=0, liftMm=5 면 base 가 Y=5 위)
 *     mesh.position 은 (0,0,0) 으로 시작 → Transform Reset 시에도
 *     자동으로 base 가 다시 liftMm 위치로 복귀.
 *  3. StandardMaterial 적용 — 기본은 평상 모드의 청록빛 파랑
 *     (`MODEL_DIFFUSE_COLOR`). 호출 측(useFileMeshSync)이 로드 직후
 *     setModelDiffuseMode() 로 현재 편집 모드에 맞춰 보정한다.
 */
export async function loadStlIntoScene(
  scene: Scene,
  blob: Blob,
  meshName = "model",
  liftMm = 0,
): Promise<Mesh> {
  const file = new File([blob], `${meshName}.stl`, { type: "model/stl" });
  const result = await SceneLoader.ImportMeshAsync(
    "",
    "",
    file,
    scene,
    undefined,
    ".stl",
  );

  const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh);
  if (meshes.length === 0) {
    throw new Error("STL 로드 결과에 메쉬가 없습니다.");
  }
  const mesh = meshes[0];
  mesh.name = meshName;

  // 0) Babylon STL 로더가 face normal 을 (0,0,0) 영벡터로 import
  //    하는 STL (cylinder.STL 등) 에 대비해 vertex normal 을
  //    강제 재계산. 이미 정상 normal 이 있어도 멱등.
  mesh.createNormals(true);

  // 1) STL Z-up → Babylon Y-up.
  mesh.rotation.x = -Math.PI / 2;
  mesh.bakeCurrentTransformIntoVertices();

  // 1.5) auto-orient: 이미 Y-up 으로 export 된 STL 은 위 회전으로
  //      옆으로 누운 상태가 된다. AABB 분석으로 가장 긴 축이 Y 가
  //      아니면 추가 회전. 1.5× 임계로 대칭 모델 (cube 등) 보호.
  autoOrientUpright(mesh);

  // 1.7) bakeCurrentTransformIntoVertices 는 vertex position 만 회전
  //      적용하고 normal 은 그대로 둔다. 위 두 회전 후 normal 이
  //      옛 좌표 기준이라 Bridge / 단점 픽의 normal 이 잘못된 방향으로
  //      향함 → contact push 가 외부로 → Bridge 가 모델 밖으로 튀어
  //      나가는 증상. 모든 회전 baked 직후 normal 재계산.
  mesh.createNormals(true);

  // 2) 빌드플레이트에 정렬 (XZ center, Y base=liftMm).
  alignMeshToPlate(mesh, liftMm);

  // 3) Material — ChiTuBox 풍 청록빛 파란색 (평상 모드).
  //    서포트 탭에서는 setModelDiffuseMode() 가 흰색으로 바꿔 vertex color
  //    (회색 모델 + 빨간 오버행)가 그대로 드러나게 한다.
  const mat = new StandardMaterial(`${meshName}-mat`, scene);
  mat.diffuseColor = MODEL_DIFFUSE_COLOR.clone(); // 청록빛 파랑
  mat.specularColor = new Color3(0.04, 0.04, 0.04); // 거의 무광 (matte)
  // scene.ambientColor 가 적용되려면 material 측의 ambientColor 가
  // 0 이 아니어야 한다 (둘은 곱셈으로 결합).
  mat.ambientColor = new Color3(1, 1, 1);
  mat.backFaceCulling = true;
  mesh.material = mat;

  return mesh;
}

/**
 * AABB 분석으로 가장 긴 축이 Y 가 되게 추가 회전.
 *
 * Z-up 가정의 X 축 -90° 회전 후, 이미 Y-up 으로 export 된 STL 은
 * 옆으로 누워있다 (cylinder.STL 등). 가장 긴 축 (= 출력 방향 추정)
 * 이 Y 가 아니면 그 축을 Y 로 돌린다.
 *
 * 임계 RATIO = 1.5 — 가장 긴 축이 Y 보다 1.5× 이상 길어야 회전.
 * cube / 거의 등방인 모델은 그대로 둠 (사용자 의도 보호).
 */
function autoOrientUpright(mesh: Mesh): void {
  mesh.refreshBoundingInfo();
  const bb = mesh.getBoundingInfo().boundingBox;
  const dx = bb.maximum.x - bb.minimum.x;
  const dy = bb.maximum.y - bb.minimum.y;
  const dz = bb.maximum.z - bb.minimum.z;
  const RATIO = 1.5;

  if (dx > dy * RATIO && dx >= dz) {
    // X 가 가장 길다 → Z 축 -90° 회전 → X 가 Y 가 됨.
    mesh.rotation.z = -Math.PI / 2;
    mesh.bakeCurrentTransformIntoVertices();
  } else if (dz > dy * RATIO && dz > dx) {
    // Z 가 가장 길다 → X 축 +90° 회전 → Z 가 Y 가 됨.
    mesh.rotation.x = Math.PI / 2;
    mesh.bakeCurrentTransformIntoVertices();
  }
}

/**
 * Mesh 의 vertex 를 빌드플레이트 정렬한다.
 *   · XZ: AABB center → 0     (모델이 플레이트 한가운데)
 *   · Y : AABB minimum → liftMm (base 가 Y=liftMm)
 * Normal 은 그대로 (translation 은 normal 에 영향 없음).
 */
function alignMeshToPlate(mesh: Mesh, liftMm: number): void {
  mesh.refreshBoundingInfo();
  const bb = mesh.getBoundingInfo().boundingBox;
  const dx = bb.center.x;
  const dy = bb.minimum.y - liftMm;
  const dz = bb.center.z;
  if (dx === 0 && dy === 0 && dz === 0) return;

  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;

  const shifted = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    shifted[i] = positions[i] - dx;
    shifted[i + 1] = positions[i + 1] - dy;
    shifted[i + 2] = positions[i + 2] - dz;
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, shifted, true);
  mesh.refreshBoundingInfo();
}
