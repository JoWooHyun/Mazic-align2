import { Matrix, Mesh, Vector3, VertexBuffer } from "@babylonjs/core";

/**
 * 오버행 색칠에 쓰는 "법선 변환 행렬" 을 world 행렬에서 만든다 (B-35).
 *
 * ★ 왜 world 행렬을 그대로 쓰지 않는가 — 법선은 위치와 다른 규칙으로 변환된다.
 *   면 위 접선 t 와 법선 n 은 항상 직교(n·t = 0)다. 변환 M 후에도 직교가
 *   유지되려면 n 은 M 이 아니라 **역전치 (M⁻¹)ᵀ** 로 보내야 한다.
 *   회전만 있으면 (R⁻¹)ᵀ = R 이라 차이가 없지만, **비균등 스케일**이 섞이면
 *   달라진다. 이 프로젝트는 TransformPanel 이 X/Y/Z 배율을 따로 받으므로
 *   (sx≠sy≠sz 가능) 역전치를 쓴다.
 *
 *   구체적 예 — 45° 로 누운 면(로컬 법선 (0.707, 0.707, 0)) 에 X 만 2배:
 *     · TransformNormal(= M 직접)  → (1.414, 0.707, 0) → 정규화 y ≈ 0.447
 *       (면이 **더 서 있다**고 판정)
 *     · 역전치(= S⁻¹)              → (0.354, 0.707, 0) → 정규화 y ≈ 0.894
 *       (면이 **더 누웠다**고 판정)
 *   X 를 2배 늘리면 실제 표면은 완만해지므로 후자가 옳다. 오버행 판정이
 *   곧 "서포트가 어디 붙는가" 이므로 여기서 틀리면 화면과 실제가 어긋난다.
 *
 * 비용은 **호출당 행렬 1개** 라 정점 수십만 개 루프에 비하면 무시할 만하다.
 * 이동 성분은 방향 변환에 무의미하므로 3x3 부분만 쓰도록 호출 측에서
 * `TransformNormalToRef`(= 이동 무시) 를 쓴다.
 */
export function normalMatrixFromWorld(world: Matrix): Matrix {
  return Matrix.Invert(world).transpose();
}

/**
 * 로컬 법선 (nx, ny, nz) 을 `normalMatrix` 로 world 로 옮긴 뒤 오버행인지
 * 판정한다 (B-35). Babylon Mesh 에 의존하지 않는 **순수 함수** 라 헤드리스
 * 검증 스크립트에서 직접 부를 수 있다.
 *
 * 오버행 조건: angle(worldNormal, -Y) <= thresholdDeg
 *   ⇔ dot(n̂, (0,-1,0)) >= cos(thresholdDeg)
 *   ⇔ -n̂y >= cos(thresholdDeg)
 *   ⇔ n̂y <= -cos(thresholdDeg)
 * 판정식 자체는 종전과 동일하다. 달라진 것은 **어느 좌표계의 ny 를 보는가**
 * 뿐이다(로컬 → world).
 *
 * @param out 재사용 버퍼 — 정점마다 Vector3 를 새로 만들지 않기 위해 호출
 *            측에서 하나를 계속 넘긴다(치아 모델은 수십만 정점).
 */
export function isOverhangNormal(
  nx: number,
  ny: number,
  nz: number,
  normalMatrix: Matrix,
  negCosThreshold: number,
  out: Vector3,
): boolean {
  Vector3.TransformNormalFromFloatsToRef(nx, ny, nz, normalMatrix, out);
  // 스케일이 걸리면 변환 후 길이가 1 이 아니다 → y 성분 비교 전에 정규화 필수.
  const len = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
  if (len < 1e-12) return false; // 퇴화 법선 — 판정 불가, 안전면 취급.
  return out.y / len <= negCosThreshold;
}

/** 임계각(도) → 판정에 쓰는 -cos(θ). */
export function negCosOfThreshold(thresholdDeg: number): number {
  return -Math.cos((thresholdDeg * Math.PI) / 180);
}

/**
 * 면(face) 법선이 -Y (= 빌드플레이트 방향) 와 이루는 각이 `thresholdDeg`
 * 이하인 vertex 에 오버행 색을 칠한다. 그 외는 중성 회색.
 *
 * STL 은 통상 unindexed (vertex 3개가 1 face) 라 vertex normal 이 곧
 * face normal 이다. 따라서 vertex 단위 색칠로 곧바로 face 단위 색이 된다.
 *
 * ★ B-35 — 판정은 **world 법선** 으로 한다. `getVerticesData(NormalKind)` 가
 *   주는 것은 **로컬 좌표계 법선** 이라, 모델을 회전시켜도 값이 변하지 않는다.
 *   그래서 종전에는 아무리 돌려도 **처음 자세 기준**으로 칠해진 자리가 그대로
 *   남았다(리드 실물 발견). 서포트 검출 경로(`slice-section.ts` 의
 *   `extractWorldTriangles`)는 이미 `getWorldMatrix()` 로 world 에서 재므로,
 *   이 수정으로 **화면 표시와 실제 서포트 위치가 같은 기준**이 된다.
 *
 * 호출 측에서 mesh.material 의 diffuseColor 가 흰색이면 vertex color
 * 가 그대로 보인다.
 */
export function applyOverhangColors(mesh: Mesh, thresholdDeg: number): void {
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  if (!normals) {
    console.warn("[v2/overhang] 메쉬에 normal 이 없음 — 색칠 건너뜀");
    return;
  }

  const vCount = normals.length / 3;
  const colors = new Float32Array(vCount * 4);

  const negCosThreshold = negCosOfThreshold(thresholdDeg);

  // world 행렬은 Babylon 이 지연 갱신하므로 강제로 최신화한 뒤 읽는다
  //   (meshWorldBBoxCenter / extractWorldTriangles 와 같은 규약).
  mesh.computeWorldMatrix(true);
  const normalMatrix = normalMatrixFromWorld(mesh.getWorldMatrix());

  // 색 (RGBA, linear).
  const ovr = [1.0, 0.32, 0.32, 1.0];
  const safe = [0.78, 0.79, 0.83, 1.0];

  // 정점마다 Vector3 를 새로 만들지 않도록 재사용 버퍼 1개만 쓴다.
  const n = new Vector3();

  for (let i = 0; i < vCount; i++) {
    const isOverhang = isOverhangNormal(
      normals[i * 3 + 0],
      normals[i * 3 + 1],
      normals[i * 3 + 2],
      normalMatrix,
      negCosThreshold,
      n,
    );
    const c = isOverhang ? ovr : safe;
    const o = i * 4;
    colors[o + 0] = c[0];
    colors[o + 1] = c[1];
    colors[o + 2] = c[2];
    colors[o + 3] = c[3];
  }

  // updatable=true 로 두면 임계각 변경 시 재할당 비용이 적다.
  mesh.setVerticesData(VertexBuffer.ColorKind, colors, true);
  mesh.hasVertexAlpha = false;
}
