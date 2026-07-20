// Bridge subtract 결과 vertex data 로 Mesh 를 복원하는 헬퍼. 순수 이동 — 로직 무변경.
import {
  Mesh,
  Scene,
  StandardMaterial,
  VertexBuffer,
} from "@babylonjs/core";

export function meshFromCachedData(
  data: {
    positions: Float32Array;
    indices: Uint32Array;
    normals: Float32Array;
  },
  name: string,
  material: StandardMaterial,
  scene: Scene,
): Mesh {
  const m = new Mesh(name, scene);
  m.setVerticesData(VertexBuffer.PositionKind, Array.from(data.positions));
  m.setIndices(Array.from(data.indices));
  m.setVerticesData(VertexBuffer.NormalKind, Array.from(data.normals));
  m.material = material;
  return m;
}
