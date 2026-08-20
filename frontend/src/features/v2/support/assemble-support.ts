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
//   ※ B-18: 기둥 발은 저장된 base 가 아니라 **플레이트(world Y=0)** 에 고정한다
//     (resolveRedesignBaseY). 모델을 수직 이동하면 발은 바닥에 남고 기둥 길이만
//     변한다 — 리드 확정 "서포터랑 STL 은 아예 다른 객체".

import {
  Matrix,
  Mesh,
  StandardMaterial,
  Vector3,
  VertexData,
  type Scene,
} from "@babylonjs/core";

import type { SupportParams, SupportPointV2 } from "./types";
import {
  assembleVerticalSupport,
  resolveRedesignBaseY,
  type VerticalSupportSpec,
} from "./assemble-core";
import { assembleRoutedSupport, type RoutedSupportSpec } from "./assemble-route";
import type { Vec3 } from "./assemble-strut";
import { getSupportParts } from "./parts-cache";

/**
 * 재설계(island/slope) 서포트 점 → 화살촉+수직 기둥 Mesh.
 *   부품 미로드 시 null. 이 경로는 kind==='island'|'slope' 점 전용.
 *
 *   ★ 월드 프레임 조립(리뷰 수정 #2): point.contact/base 는 stl-local 좌표라
 *     로컬 Y 로 곧장 세우면 STL 이 회전됐을 때 기둥이 기울고 발이 플레이트
 *     (world Y=0)에서 이탈한다. 그래서 (1) 로컬 좌표를 stlMesh world matrix 로
 *     월드화해 월드 수직으로 조립하고, (2) 전체 positions 에 inv(world) 를
 *     적용해 다시 로컬화한 뒤 parent=stlMesh 로 붙인다. 결과 world 형상은
 *     STL 회전과 무관하게 항상 월드 수직·발 Y=0 이며, STL 이동·회전 시엔
 *     Babylon 이 parent 로 자동 follow 한다(로컬 저장이라 race 0).
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

  const stlMesh =
    point.coordSpace === "stl-local" && stlMeshMap
      ? stlMeshMap.get(point.stlId) ?? null
      : null;

  // 저장 좌표(stl-local 또는 world) → 월드 좌표. stlMesh 없으면 좌표 그대로가 월드.
  const toWorld = (p: [number, number, number]): Vector3 => {
    const v = new Vector3(p[0], p[1], p[2]);
    if (!stlMesh) return v;
    stlMesh.computeWorldMatrix(true);
    return Vector3.TransformCoordinates(v, stlMesh.getWorldMatrix());
  };
  const wContact = toWorld(point.contact);
  const wBase = toWorld(point.base);

  // 월드 수직 기둥: XZ 는 contact 의 world X/Z, surfaceY/baseY 는 world Y.
  //   (수직 전제라 base 의 world XZ 는 무시하고 contact XZ 축에 세운다.)
  const cx = wContact.x;
  const cz = wContact.z;
  const surfaceY = wContact.y;
  // ★ B-18: 발은 저장된 base 를 따라가는 게 아니라 **플레이트(world Y=0)에
  //   고정**된다. base 는 stl-local 이라 모델을 올리면 같이 떠오르는데, 리드
  //   실물 대조 결과 서포트는 "플레이트에 서 있는 독립 구조물" 이라 발은 바닥에
  //   붙은 채 기둥 길이만 늘어야 한다. 판정은 순수 함수에 위임 — S-4b-2 의 3단
  //   폴백이 `baseAnchor:'model'` 을 실어 보내면 저장값이 그대로 존중된다.
  const baseY = resolveRedesignBaseY(wBase.y, point.baseAnchor);

  // 앞구슬 지름 = 2×point.tipRadius (없으면 params.tipDiameterMm) — 수용 4.
  const tipDiameterMm =
    point.tipRadius != null ? point.tipRadius * 2 : params.tipDiameterMm;

  // ── S-4b-2c: 폴백 경로(bent/anchor/joinPillar) 분기 ─────────────────────
  //   routeKind 미설정/'vertical' 은 **아래 기존 경로 그대로** — 옛 데이터와
  //   1단(수직) 점은 S-4b-1 과 완전히 같은 형상이 나온다(무회귀).
  const routed = buildRoutedSpec(point, params, tipDiameterMm, toWorld, baseY);

  // 조립 좌표 → world. 기존(수직) 경로는 로컬 XZ 원점 기준이라 contact XZ 로
  //   평행이동이 필요하고, 폴백 경로(assemble-route)는 **이미 world** 라 0 이다.
  let geo;
  let shiftX = 0;
  let shiftZ = 0;
  if (routed) {
    geo = assembleRoutedSupport(parts, routed);
  } else {
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
    geo = assembleVerticalSupport(parts, spec);
    shiftX = cx;
    shiftZ = cz;
  }

  // 월드 형상 완성 후 stlMesh 가 있으면 inv(world) 로 로컬화(parent 규약).
  const invWorld = stlMesh ? Matrix.Invert(stlMesh.getWorldMatrix()) : null;
  const positions = new Float32Array(geo.positions.length);
  const tmp = new Vector3();
  for (let i = 0; i < geo.positions.length; i += 3) {
    tmp.set(
      geo.positions[i] + shiftX,
      geo.positions[i + 1],
      geo.positions[i + 2] + shiftZ,
    );
    const out = invWorld
      ? Vector3.TransformCoordinates(tmp, invWorld)
      : tmp;
    positions[i] = out.x;
    positions[i + 1] = out.y;
    positions[i + 2] = out.z;
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
  //   (positions 는 위에서 inv(world) 로 로컬화됨 → parent world 가 다시 world
  //   형상으로 복원. STL 회전과 무관하게 월드 수직 유지.)
  if (stlMesh) mesh.parent = stlMesh;
  return mesh;
}

/**
 * 저장된 라우팅 정보(S-4b-2c) → `assembleRoutedSupport` 스펙 (world 좌표).
 *   routeKind 가 없거나 'vertical' 이면 **null** — 호출 측이 기존 수직 경로를
 *   그대로 탄다(무회귀 보장 지점).
 *
 * ## ⚠️ baseAnchor 함정 (반드시 지킬 것)
 * joinPillar·anchor 의 base 는 **플레이트가 아니다**(각각 기둥 옆면·모델 표면).
 * 이 점들을 `baseAnchor:'plate'` 로 저장하면 `resolveRedesignBaseY` 가 base 의
 * world Y 를 0 으로 **강제**해 다리가 바닥까지 늘어나고 형상이 무너진다. 생성
 * 측(`redesign-detect-actions`)이 'model' 로 찍어 보내는 게 규약이며, 여기서는
 * 그 규약대로 **저장된 base world 좌표를 그대로** 쓴다.
 * bent 만은 발이 플레이트에 서므로 'plate'(= 인자로 받은 고정된 baseY)를 쓴다.
 */
function buildRoutedSpec(
  point: SupportPointV2,
  params: SupportParams,
  tipDiameterMm: number,
  toWorld: (p: [number, number, number]) => Vector3,
  plateBaseY: number,
): RoutedSupportSpec | null {
  const kind = point.routeKind;
  if (!kind || kind === "vertical") return null;

  const wContact = toWorld(point.contact);
  const contactWorld: Vec3 = [wContact.x, wContact.y, wContact.z];
  const dims = {
    contactWorld,
    tipDiameterMm,
    headBackDiameterMm: params.headBackDiameterMm,
    headLengthMm: params.headLengthMm,
    contactPenetrationMm: params.contactPenetrationMm,
    trunkDiameterMm: params.trunkDiameterMm,
    baseDiameterMm: params.baseDiameterMm,
    baseTransitionMm: params.baseTransitionMm,
  };
  const wBase = toWorld(point.base);

  if (kind === "bent") {
    // 발은 플레이트 고정(B-18) — 모델을 수직 이동해도 마지막 수직 구간만 늘어난다.
    const waypoints: Vec3[] = (point.routeWaypoints ?? []).map((p) => {
      const w = toWorld(p);
      return [w.x, w.y, w.z];
    });
    return {
      ...dims,
      route: {
        kind: "bent",
        worldWaypoints: waypoints,
        baseXZ: [wBase.x, wBase.z],
        baseY: plateBaseY,
      },
    };
  }

  if (kind === "anchor") {
    return {
      ...dims,
      route: { kind: "anchor", anchorWorld: [wBase.x, wBase.y, wBase.z] },
    };
  }

  // joinPillar — base 가 곧 합류점.
  return {
    ...dims,
    route: { kind: "joinPillar", junctionWorld: [wBase.x, wBase.y, wBase.z] },
  };
}
