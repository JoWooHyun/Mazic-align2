import {
  Color3,
  Mesh,
  Scene,
  StandardMaterial,
  VertexData,
} from "@babylonjs/core";

import type { SlicePolygon } from "./slice-section";
import { triangulateSliceSection } from "./slice-cap-triangulate";

/**
 * 한 메시의 단면 폴리곤들을 Y=`y` 평면에 채워 mesh 하나로 (슬라이스 미리보기 단면 뚜껑).
 *
 * 채움 규칙은 2D 마스크와 같은 nonzero 감김이다(slice-cap-triangulate — clipper union → earcut).
 * 오목 단면·구멍(속 빈 모델 내벽)·겹친 솔리드가 마스크와 같은 모양으로 그려진다.
 * 종전 폴리곤별 fan(point[0] 기준)은 볼록 단면에서만 맞아 오목 단면에서 수십 배 큰 판이 그려졌다(2026-10-23).
 *
 * 시각적으로 단면을 막아 clipPlane 으로 잘린 모델 내부가 뚫려 보이는
 * 현상을 가린다. 채울 넓이가 없으면(퇴화 단면) null.
 */
export function buildSliceFillMesh(
  scene: Scene,
  polygons: readonly SlicePolygon[],
  y: number,
  material: StandardMaterial,
  name = "slice_fill",
): Mesh | null {
  const { points, indices } = triangulateSliceSection(polygons);
  const n = points.length / 2;
  if (indices.length === 0) return null;

  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3 + 0] = points[i * 2];
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = points[i * 2 + 1];
    normals[i * 3 + 1] = 1;
  }

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  // 삼각형 감김은 earcut 이 정하므로 위/아래 어느 쪽에서 봐도 보이게 머티리얼을 양면으로 둔다.
  data.indices = indices;
  data.normals = normals;
  data.applyToMesh(mesh);

  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}

/**
 * 단면 fill 용 material. 양면 렌더 (backFaceCulling=false) — 삼각형
 * 감김이 위/아래 어느 쪽일지 정해져 있지 않아 안전한 default.
 */
export function createSliceFillMaterial(
  scene: Scene,
  diffuse: Color3,
  name: string,
): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = diffuse;
  mat.specularColor = new Color3(0, 0, 0);
  mat.ambientColor = new Color3(1, 1, 1);
  mat.backFaceCulling = false;
  return mat;
}
