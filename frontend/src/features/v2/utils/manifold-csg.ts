import {
  Matrix,
  Mesh,
  Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
} from "@babylonjs/core";
import Module, {
  type ManifoldToplevel,
  type Manifold,
} from "manifold-3d";

/**
 * manifold-3d wasm 기반 mesh-level boolean.
 * 기존 Babylon CSG 보다 ~100배 빠름.
 *
 * 사용 흐름:
 *   1. await ensureManifoldReady() — wasm 한 번만 load (수백 ms)
 *   2. const stlMan = babylonMeshToManifold(stlMesh) — STL 마다 1회 (cache)
 *   3. const tubeMan = babylonMeshToManifold(tubeMesh) — Bridge 마다
 *   4. const result = tubeMan.subtract(stlMan)
 *   5. const clippedMesh = manifoldToBabylonMesh(result, name, mat, scene)
 *
 * **한계**: manifold-3d 는 watertight (closed manifold) mesh 만 받는다.
 * 사용자 STL 이 thin shell + open hole 이면 Manifold 생성 시 status !==
 * 'NoError' 가 되고 subtract 결과 가 빈 mesh.
 * → 그 경우 fallback (원본 tube 반환).
 */

let manifoldPromise: Promise<ManifoldToplevel> | null = null;
let manifoldModule: ManifoldToplevel | null = null;

export async function ensureManifoldReady(): Promise<ManifoldToplevel> {
  if (manifoldModule) return manifoldModule;
  if (!manifoldPromise) {
    manifoldPromise = Module({
      // wasm 파일은 Vite 가 dep optimize 로 알아서 처리
      locateFile: () => new URL(
        "manifold-3d/manifold.wasm",
        import.meta.url,
      ).toString(),
    });
  }
  manifoldModule = await manifoldPromise;
  manifoldModule.setup();
  return manifoldModule;
}

/**
 * Babylon mesh → manifold Mesh.
 * transformMatrix 전달 시 그 matrix 로 vertex 변환 (예: Bridge world → STL local).
 * 미전달 시 mesh 의 world matrix 적용.
 * null 전달 시 mesh local 좌표 그대로 (STL 의 STL local manifold 생성용).
 */
export function babylonMeshToManifold(
  babylonMesh: Mesh,
  manifold: ManifoldToplevel,
  transformMatrix?: Matrix | null,
): Manifold | null {
  const positions = babylonMesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = babylonMesh.getIndices();
  if (!positions || !indices) return null;

  let appliedMatrix: Matrix | null;
  if (transformMatrix === null) {
    appliedMatrix = null;
  } else if (transformMatrix) {
    appliedMatrix = transformMatrix;
  } else {
    babylonMesh.computeWorldMatrix(true);
    appliedMatrix = babylonMesh.getWorldMatrix();
  }

  const vertCount = positions.length / 3;
  const vertProperties = new Float32Array(positions.length);
  const tmp = new Vector3();
  for (let i = 0; i < vertCount; i++) {
    tmp.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    if (appliedMatrix) {
      const w = Vector3.TransformCoordinates(tmp, appliedMatrix);
      vertProperties[i * 3] = w.x;
      vertProperties[i * 3 + 1] = w.y;
      vertProperties[i * 3 + 2] = w.z;
    } else {
      vertProperties[i * 3] = tmp.x;
      vertProperties[i * 3 + 1] = tmp.y;
      vertProperties[i * 3 + 2] = tmp.z;
    }
  }
  // Babylon left-handed CW winding vs manifold-3d (CCW outward) — STL loader
  // 의 결과가 inverse 라 manifold inside 가 잘못 정의됨. 각 triangle 의
  // i1, i2 swap 으로 winding flip → outward normal 일관성.
  const rawIndices =
    indices instanceof Uint32Array ? indices : new Uint32Array(indices);
  const triVerts = new Uint32Array(rawIndices.length);
  for (let i = 0; i < rawIndices.length; i += 3) {
    triVerts[i] = rawIndices[i];
    triVerts[i + 1] = rawIndices[i + 2];
    triVerts[i + 2] = rawIndices[i + 1];
  }
  try {
    const mesh = new manifold.Mesh({
      numProp: 3,
      vertProperties,
      triVerts,
    });
    // STL 의 raw face 는 vertex duplicate (각 triangle 별개). manifold 가 아님.
    // mesh.merge() 가 가까운 vertex 합쳐 open edge 패치 → 가능하면 manifold.
    mesh.merge();
    return new manifold.Manifold(mesh);
  } catch (e) {
    console.warn("[manifold] Manifold ctor 실패", e);
    return null;
  }
}

/** manifold mesh → Babylon Mesh (world 좌표 그대로). */
export function manifoldToBabylonMesh(
  man: Manifold,
  name: string,
  material: StandardMaterial,
  scene: Scene,
): Mesh | null {
  try {
    const mesh = man.getMesh();
    if (mesh.vertProperties.length === 0 || mesh.triVerts.length === 0) {
      return null;
    }
    const out = new Mesh(name, scene);
    const positions = mesh.numProp === 3
      ? mesh.vertProperties
      : compactPositions(mesh.vertProperties, mesh.numProp);
    out.setVerticesData(
      VertexBuffer.PositionKind,
      positions instanceof Float32Array ? Array.from(positions) : positions,
    );
    // manifold-3d 는 CCW outward (right-handed). Babylon 은 left-handed
    // CW=front. winding swap 으로 통일 → stl-export 의 winding swap 과
    // 일관 처리 (Bridge mesh 가 slicer 에서 inside-out 인식되는 것 방지).
    const flippedIdx: number[] = [];
    for (let i = 0; i < mesh.triVerts.length; i += 3) {
      flippedIdx.push(mesh.triVerts[i], mesh.triVerts[i + 2], mesh.triVerts[i + 1]);
    }
    out.setIndices(flippedIdx);
    const normals: number[] = [];
    VertexData.ComputeNormals(
      positions instanceof Float32Array ? Array.from(positions) : positions,
      flippedIdx,
      normals,
    );
    out.setVerticesData(VertexBuffer.NormalKind, normals);
    out.material = material;
    return out;
  } catch (e) {
    console.warn("[manifold] getMesh 실패", e);
    return null;
  }
}

function compactPositions(props: Float32Array, numProp: number): number[] {
  const vertCount = props.length / numProp;
  const out: number[] = [];
  for (let i = 0; i < vertCount; i++) {
    out.push(
      props[i * numProp],
      props[i * numProp + 1],
      props[i * numProp + 2],
    );
  }
  return out;
}

/**
 * Babylon world matrix 의 inverse 를 적용해 clipped mesh 좌표를 mesh local 로
 * 되돌림 (mesh.parent 사용 시).
 */
export function applyInverseTransform(mesh: Mesh, world: Matrix): void {
  const inv = Matrix.Invert(world);
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  const out = new Float32Array(positions.length);
  const tmp = new Vector3();
  for (let i = 0; i < positions.length / 3; i++) {
    tmp.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    const local = Vector3.TransformCoordinates(tmp, inv);
    out[i * 3] = local.x;
    out[i * 3 + 1] = local.y;
    out[i * 3 + 2] = local.z;
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, Array.from(out));
}
