// 서포트 재설계(S-4b) 조립 결과 → Babylon Mesh 래퍼.
//   조립 코어(assemble-core.ts, 순수)가 낸 { positions, indices } 를 VertexData
//   로 Mesh 화한다. getSupportParts() 가 null(미로드)이면 null 을 반환해 호출
//   측이 로드 후 재시도하게 한다.
//
//   좌표 규약: 기존 createSupportMesh(support-render.ts)와 동일하게 맞춘다.
//     · point.contact/base 좌표를 그대로 사용(수직 기둥이라 XZ 동일).
//     · coordSpace==='stl-local' 이면 mesh.parent = stlMesh (STL transform
//       auto-follow, freeze 0). world 면 parent 없음.
//     · metadata(type/supportId/stlId/baseStlId), isPickable 은 호출 측
//       (useSupportMeshSync)이 기존 규약대로 덮어쓴다.
//
//   ※ S-4b-1 한계(TODO): 3단 폴백·충돌 회피 없음. 기둥이 모델을 관통해도
//     이번엔 허용(S-4b-2 몫). base 는 항상 contact 바로 아래 플레이트(수직).

import {
  Mesh,
  StandardMaterial,
  VertexData,
  type Scene,
} from "@babylonjs/core";

import type { SupportParams, SupportPointV2 } from "./types";
import {
  assembleVerticalSupport,
  type VerticalSupportSpec,
} from "./assemble-core";
import { getSupportParts } from "./parts-cache";

/**
 * 재설계(island/slope) 서포트 점 → 화살촉+수직 기둥 Mesh.
 *   부품 미로드 시 null. 이 경로는 kind==='island'|'slope' 점 전용.
 */
export function createRedesignSupportMesh(
  scene: Scene,
  point: SupportPointV2,
  params: SupportParams,
  material: StandardMaterial,
  stlMeshMap?: Map<string, Mesh>,
): Mesh | null {
  const parts = getSupportParts();
  if (!parts) return null;

  // 수직 기둥: contact 와 base 는 XZ 동일(수직) 전제. surfaceY = contact.y,
  //   baseY = base.y. 조립 코어는 로컬 XZ 원점(0,y,0) 기준으로 세로로 쌓고,
  //   여기서 XZ 를 contact 의 X/Z 로 평행이동해 배치한다.
  const cx = point.contact[0];
  const cz = point.contact[2];
  const surfaceY = point.contact[1];
  const baseY = point.base[1];

  // 앞구슬 지름 = 2×point.tipRadius (없으면 params.tipDiameterMm) — 수용 4.
  const tipDiameterMm =
    point.tipRadius != null ? point.tipRadius * 2 : params.tipDiameterMm;

  const spec: VerticalSupportSpec = {
    surfaceY,
    baseY,
    tipDiameterMm,
    headBackDiameterMm: params.headBackDiameterMm,
    headLengthMm: params.headLengthMm,
    contactPenetrationMm: params.contactPenetrationMm,
    trunkDiameterMm: params.trunkDiameterMm,
    baseDiameterMm: params.baseDiameterMm,
    baseTransitionMm: params.baseTransitionMm,
  };

  const geo = assembleVerticalSupport(parts, spec);

  // 조립 positions 는 로컬 XZ 원점 기준 → contact XZ 로 평행이동.
  const positions = new Float32Array(geo.positions.length);
  for (let i = 0; i < geo.positions.length; i += 3) {
    positions[i] = geo.positions[i] + cx;
    positions[i + 1] = geo.positions[i + 1];
    positions[i + 2] = geo.positions[i + 2] + cz;
  }

  const mesh = new Mesh(`support_${point.id}`, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = Array.from(geo.indices);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, vd.indices, normals);
  vd.normals = normals;
  vd.applyToMesh(mesh);

  mesh.material = material;
  mesh.isPickable = false;
  mesh.metadata = {
    type: "support",
    supportId: point.id,
    stlId: point.stlId,
    baseStlId: point.baseStlId,
  };

  // stl-local 좌표면 STL mesh 의 child 로 → STL transform 시 자동 follow.
  if (point.coordSpace === "stl-local" && stlMeshMap) {
    const stlMesh = stlMeshMap.get(point.stlId);
    if (stlMesh) mesh.parent = stlMesh;
  }
  return mesh;
}
