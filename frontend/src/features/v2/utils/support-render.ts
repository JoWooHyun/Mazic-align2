import {
  Color3,
  Curve3,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
  Vector4,
} from "@babylonjs/core";

import type { SupportParams, SupportPointV2 } from "../support/types";

export function createSupportMesh(
  scene: Scene,
  point: SupportPointV2,
  params: SupportParams,
  material: StandardMaterial,
  stlMeshMap?: Map<string, Mesh>,
): Mesh {
  const isBridge = point.source === "bridge";

  // Bridge + 변곡점 → 곡선 Tube.
  if (isBridge && point.curveControlPoints) {
    return createBridgeCurveTube(scene, point, params, material, stlMeshMap);
  }

  const base = new Vector3(point.base[0], point.base[1], point.base[2]);
  const contact = new Vector3(
    point.contact[0],
    point.contact[1],
    point.contact[2],
  );

  const direction = contact.subtract(base);
  const length = Math.max(direction.length(), 0.01);

  let baseT = params.baseTransitionMm;
  let tipT = params.tipTransitionMm;
  const totalT = baseT + tipT;
  if (totalT >= length) {
    const scale = (length / totalT) * 0.95;
    baseT *= scale;
    tipT *= scale;
  }

  // Bridge 는 trunk 굵기를 bridgeDiameterMm 로 별도 사용.
  const trunkR =
    (isBridge ? params.bridgeDiameterMm : params.trunkDiameterMm) * 0.5;
  // 사용자 입력값 그대로 (clamp 없음): 팁이 trunk 보다 굵거나 base 가
  // 더 가는 형상도 슬라이더로 자유롭게 재현 가능.
  const tipR = params.tipDiameterMm * 0.5;
  const baseR = params.baseDiameterMm * 0.5;

  // 시작 반지름: 브릿지는 양 끝 모두 tip 반지름 (양쪽 다 모델 자국 작음).
  const startR = isBridge ? tipR : baseR;

  const profile: Vector3[] = [
    new Vector3(startR, 0, 0),
    new Vector3(trunkR, baseT, 0),
    new Vector3(trunkR, length - tipT, 0),
    new Vector3(tipR, length, 0),
  ];

  const m = MeshBuilder.CreateLathe(
    `support_${point.id}`,
    {
      shape: profile,
      tessellation: 12,
      closed: true,
      cap: Mesh.CAP_ALL,
      sideOrientation: Mesh.DEFAULTSIDE,
      frontUVs: new Vector4(0, 0, 1, 1),
    },
    scene,
  );

  m.position.copyFrom(base);

  // up (lathe 의 +Y) 를 direction 으로 정렬. 수직 케이스는 identity.
  const dirNorm = direction.normalizeToNew();
  const up = new Vector3(0, 1, 0);
  const dot = Vector3.Dot(up, dirNorm);
  if (dot > 0.9999) {
    m.rotationQuaternion = Quaternion.Identity();
  } else if (dot < -0.9999) {
    // 완전 반대 방향 — X 축 180°.
    m.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
  } else {
    const axis = Vector3.Cross(up, dirNorm);
    axis.normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    m.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
  }

  m.material = material;
  m.isPickable = false;
  m.metadata = {
    type: "support",
    supportId: point.id,
    stlId: point.stlId,
    baseStlId: point.baseStlId,
  };

  // stl-local 좌표면 STL mesh 의 child 로 → STL transform 시 자동 follow.
  if (point.coordSpace === "stl-local" && stlMeshMap) {
    const stlMesh = stlMeshMap.get(point.stlId);
    if (stlMesh) m.parent = stlMesh;
  }
  return m;
}

/**
 * Bridge 곡선: 5 점 (base, Y1, Y2, Y3, contact) 을 통과하는
 * Catmull-Rom spline 을 만들어 그 path 를 따라 Tube 렌더.
 *
 * 굵기는 균일하게 bridgeDiameterMm. (양 끝 가는 형태는 다음 단계에서
 * radiusFunction 으로 추가 예정.)
 */
function createBridgeCurveTube(
  scene: Scene,
  point: SupportPointV2,
  params: SupportParams,
  material: StandardMaterial,
  stlMeshMap?: Map<string, Mesh>,
): Mesh {
  const cps = point.curveControlPoints!;
  const passPoints: Vector3[] = [
    new Vector3(point.base[0], point.base[1], point.base[2]),
  ];
  for (const cp of cps) {
    passPoints.push(new Vector3(cp[0], cp[1], cp[2]));
  }
  passPoints.push(
    new Vector3(point.contact[0], point.contact[1], point.contact[2]),
  );

  // 각 segment 사이 보간 점 수. 곡률에 따라 24 ~ 32 가 무난.
  const path = Curve3.CreateCatmullRomSpline(passPoints, 24, false).getPoints();

  const radius = params.bridgeDiameterMm * 0.5;

  const m = MeshBuilder.CreateTube(
    `support_${point.id}`,
    {
      path,
      radius,
      tessellation: 12,
      cap: Mesh.CAP_ALL,
      sideOrientation: Mesh.DEFAULTSIDE,
    },
    scene,
  );

  m.material = material;
  m.isPickable = false;
  m.metadata = {
    type: "support",
    supportId: point.id,
    stlId: point.stlId,
    baseStlId: point.baseStlId,
  };

  // stl-local 좌표면 STL mesh 의 child 로 → STL transform 시 자동 follow.
  if (point.coordSpace === "stl-local" && stlMeshMap) {
    const stlMesh = stlMeshMap.get(point.stlId);
    if (stlMesh) m.parent = stlMesh;
  }
  return m;
}

export function createSupportMaterial(scene: Scene): StandardMaterial {
  const mat = new StandardMaterial("v2_support_mat", scene);
  mat.diffuseColor = new Color3(0.45, 0.6, 0.85);
  mat.specularColor = new Color3(0.1, 0.1, 0.1);
  mat.ambientColor = new Color3(1, 1, 1);
  return mat;
}
