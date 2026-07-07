import { Mesh, Vector3, VertexBuffer } from "@babylonjs/core";

import {
  chainSegments,
  sliceTrianglesAtY,
  type SlicePolygon,
  type SliceSegment,
} from "./slice-geometry";

// 순수 기하 코어는 slice-geometry.ts 로 분리(워커 공유). 기존 호출자·타입
// 임포트 호환을 위해 여기서 그대로 re-export 한다.
export { chainSegments };
export type { SlicePolygon, SliceSegment };

/**
 * mesh 의 삼각형을 world 좌표로 변환해 flat Float32Array (삼각형당 9 float:
 * v0.x,v0.y,v0.z, v1.x,…, v2.z) 로 추출한다.
 *
 * 이렇게 뽑은 배열은 Babylon 없이 sliceTrianglesAtY 로 자를 수 있으므로
 * Web Worker 로 (transferable 로) 넘겨 슬라이스할 수 있다.
 */
export function extractWorldTriangles(mesh: Mesh): Float32Array {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices) return new Float32Array(0);

  mesh.computeWorldMatrix(true);
  const world = mesh.getWorldMatrix();

  const triCount = indices.length / 3;
  const out = new Float32Array(triCount * 9);

  const v = new Vector3();
  let o = 0;
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const idx = indices[i + k] * 3;
      Vector3.TransformCoordinatesFromFloatsToRef(
        positions[idx],
        positions[idx + 1],
        positions[idx + 2],
        world,
        v,
      );
      out[o++] = v.x;
      out[o++] = v.y;
      out[o++] = v.z;
    }
  }

  return out;
}

/**
 * 한 mesh 를 Y=`y` 평면으로 자른 결과의 line segment 들.
 *
 * 기존 시그니처 유지 — 내부적으로 world 삼각형 추출 후 순수 함수
 * sliceTrianglesAtY 에 위임한다. 결과는 분리 전과 동일.
 */
export function sliceMeshAtY(mesh: Mesh, y: number): SliceSegment[] {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices) return [];

  return sliceTrianglesAtY(extractWorldTriangles(mesh), y);
}
