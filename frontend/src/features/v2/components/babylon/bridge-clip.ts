// Bridge tube 를 manifold-3d 로 STL 침투 부분만큼 깎아내는 액션 — ctx 기반.
//   원본 BabylonScene 본문 내부 함수 clipBridgeWithManifold 순수 이동. STL local
//   공간에서 subtract 하고 결과를 bridgeClipCacheRef 에 캐시한다 (로직 무변경).
import {
  Matrix,
  Mesh,
  Scene,
  StandardMaterial,
  Vector3,
  VertexBuffer,
} from "@babylonjs/core";
import type { ManifoldToplevel } from "manifold-3d";
import {
  babylonMeshToManifold,
  manifoldToBabylonMesh,
} from "../../utils/manifold-csg";
import type { SupportParams, SupportPointV2 } from "../../support/types";
import type { SceneCtx } from "./scene-refs";
import { buildBridgeClipKey } from "./support-keys";
import { meshFromCachedData } from "./mesh-cache";

export function clipBridgeWithManifold(
  ctx: SceneCtx,
  supportParams: SupportParams,
  tube: Mesh,
  point: SupportPointV2,
  material: StandardMaterial,
  scene: Scene,
  mod: ManifoldToplevel,
): Mesh | null {
  // STL local 공간에서 subtract — STL transform 변경 시 cache hit.
  // (현재 단순화: stlId 의 STL 한 개만 검사. baseStl 별도 검사는 추후.)
  const stlMesh = ctx.meshMapRef.current.get(point.stlId);
  const stlMan = ctx.stlManifoldMapRef.current.get(point.stlId);
  if (!stlMesh || !stlMan) return null;
  stlMesh.computeWorldMatrix(true);
  const stlWorld = stlMesh.getWorldMatrix();
  const stlInvWorld = Matrix.Invert(stlWorld);

  // tube world → STL local 변환 matrix = stlInvWorld × tube.world
  tube.computeWorldMatrix(true);
  const tubeWorld = tube.getWorldMatrix();
  const tubeToStlLocal = tubeWorld.multiply(stlInvWorld);

  // cache key: Bridge contact/base 의 STL local 좌표 — STL transform
  // 변경해도 같은 표면 위 위치면 같은 key (Bridge 가 STL 따라 함).
  const toStlLocal = (p: [number, number, number]): [number, number, number] => {
    const v = Vector3.TransformCoordinates(new Vector3(p[0], p[1], p[2]), stlInvWorld);
    return [v.x, v.y, v.z];
  };
  const cLocal = toStlLocal(point.contact);
  const bLocal = toStlLocal(point.base);
  const cpsLocal = (point.curveControlPoints ?? []).map(toStlLocal);
  const localPoint: SupportPointV2 = {
    ...point,
    contact: cLocal,
    base: bLocal,
    curveControlPoints: cpsLocal.length ? cpsLocal : undefined,
  };
  const key = buildBridgeClipKey(localPoint, supportParams);
  const cached = ctx.bridgeClipCacheRef.current.get(point.id);
  if (cached && cached.key === key) {
    const reusedMesh = meshFromCachedData(
      cached, `support_${point.id}`, material, scene,
    );
    reusedMesh.metadata = tube.metadata;
    tube.dispose();
    // STL local 좌표 mesh + parent = stlMesh → STL transform 자동 follow
    reusedMesh.parent = stlMesh;
    return reusedMesh;
  }

  const tubeMan = babylonMeshToManifold(tube, mod, tubeToStlLocal);
  if (!tubeMan) return null;
  try {
    const result = tubeMan.subtract(stlMan);
    if (result === tubeMan) {
      tubeMan.delete();
      return null;
    }
    const clipped = manifoldToBabylonMesh(
      result,
      `support_${point.id}`,
      material,
      scene,
    );
    // clipped 의 vertex 는 STL local. mesh.parent = stlMesh 박으면
    // final world = stlMesh.world × vertex = 원래 Bridge world.
    // cache 에 vertex data (STL local) 저장 → 다음 hit 시 재사용.
    const positions = clipped?.getVerticesData(VertexBuffer.PositionKind);
    const idx = clipped?.getIndices();
    const normals = clipped?.getVerticesData(VertexBuffer.NormalKind);
    if (clipped && positions && idx && normals) {
      ctx.bridgeClipCacheRef.current.set(point.id, {
        key,
        positions: new Float32Array(positions),
        indices: new Uint32Array(idx),
        normals: new Float32Array(normals),
      });
    }
    result.delete();
    tubeMan.delete();
    if (!clipped) return null;
    clipped.metadata = tube.metadata;
    tube.dispose();
    clipped.parent = stlMesh;
    return clipped;
  } catch (e) {
    console.warn("[manifold] subtract 실패", e);
    tubeMan.delete();
    return null;
  }
}
