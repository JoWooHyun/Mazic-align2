import { Matrix, Mesh, Quaternion, Vector3 } from "@babylonjs/core";

import type { TransformV2 } from "../types/transform";

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Babylon Mesh 에 v2 transform 을 적용한다.
 *
 * Gizmo 가 rotationQuaternion 으로 동작하므로 우리도 quaternion 으로
 * 통일한다. Euler 는 UI 표시 용도로만 변환.
 */
export function applyTransformToMesh(mesh: Mesh, t: TransformV2): void {
  mesh.position.set(t.tx, t.ty, t.tz);
  mesh.rotationQuaternion = Quaternion.FromEulerAngles(
    degToRad(t.rx),
    degToRad(t.ry),
    degToRad(t.rz),
  );
  mesh.scaling.set(t.sx, t.sy, t.sz);
}

/**
 * Babylon Mesh 의 현재 자세를 읽어 TransformV2 로 변환한다.
 * Gizmo 드래그 종료 시점에 사용.
 */
/**
 * TransformV2 → world matrix (scale → rotate → translate 순으로 합성).
 */
export function matrixFromTransform(t: TransformV2): Matrix {
  return Matrix.Compose(
    new Vector3(t.sx, t.sy, t.sz),
    Quaternion.FromEulerAngles(
      degToRad(t.rx),
      degToRad(t.ry),
      degToRad(t.rz),
    ),
    new Vector3(t.tx, t.ty, t.tz),
  );
}

/**
 * old transform 기준 world 좌표 p 를 new transform 기준 world 좌표로
 * 변환. 즉 p 가 모델에 부착돼 있을 때, 모델 transform 이 old→new 로
 * 바뀐 후의 새 world 좌표.
 */
export function transformPointBetween(
  p: [number, number, number],
  oldT: TransformV2,
  newT: TransformV2,
): [number, number, number] {
  const oldMat = matrixFromTransform(oldT);
  const newMat = matrixFromTransform(newT);
  const oldInv = Matrix.Invert(oldMat);
  const v = new Vector3(p[0], p[1], p[2]);
  const local = Vector3.TransformCoordinates(v, oldInv);
  const w = Vector3.TransformCoordinates(local, newMat);
  return [w.x, w.y, w.z];
}

/**
 * TransformV2 의 회전 성분을 Quaternion 으로 (UI Euler 도 → quaternion).
 */
function quaternionFromTransform(t: TransformV2): Quaternion {
  return Quaternion.FromEulerAngles(
    degToRad(t.rx),
    degToRad(t.ry),
    degToRad(t.rz),
  );
}

/**
 * 회전 quaternion + 위치 + 스케일을 TransformV2 로 (Euler 도 표기로 환원).
 * 스케일은 그대로 옮기고 회전만 Euler 로 분해한다.
 */
function transformFromParts(
  q: Quaternion,
  pos: Vector3,
  scale: { sx: number; sy: number; sz: number },
): TransformV2 {
  const eul = q.toEulerAngles();
  return {
    tx: pos.x,
    ty: pos.y,
    tz: pos.z,
    rx: radToDeg(eul.x),
    ry: radToDeg(eul.y),
    rz: radToDeg(eul.z),
    sx: scale.sx,
    sy: scale.sy,
    sz: scale.sz,
  };
}

/**
 * t 를 적용한 상태에서 **world 피벗 p 를 고정한 채** 회전을 deltaQ 만큼 더한
 * 새 transform (B-9).
 *
 * 수학: 원하는 결과는 W' = T(p)·Rd·T(−p)·W. 좌변을 분해하면
 *   선형부  = Rd·R·S  → 회전 R' = Rd·R, 스케일 S 불변(순수 회전이라 분해 가능)
 *   평행이동 = Rd·(pos − p) + p
 * 이므로 TransformV2(tx..sz) 스키마를 바꾸지 않고 표현할 수 있다. 즉 피벗은
 * **적용 시점의 계산**으로만 반영되고, 정점 재베이크나 스키마 변경이 없다.
 *
 * 이렇게 하면 회전 전후로 피벗의 world 좌표가 불변이라, 피벗을 현재 바운딩박스
 * 중심으로 주면 CHITUBOX/프루사처럼 "제자리 회전"이 된다(원점 공전 방지).
 */
export function rotateTransformAroundWorldPivot(
  t: TransformV2,
  deltaQ: Quaternion,
  pivotWorld: Vector3,
): TransformV2 {
  const curQ = quaternionFromTransform(t);
  const newQ = deltaQ.multiply(curQ);

  // pos' = Rd·(pos − p) + p.
  const pos = new Vector3(t.tx, t.ty, t.tz);
  const rel = pos.subtract(pivotWorld);
  const rotMat = Matrix.Identity();
  deltaQ.toRotationMatrix(rotMat);
  const rotated = Vector3.TransformCoordinates(rel, rotMat);
  const newPos = rotated.add(pivotWorld);

  return transformFromParts(newQ, newPos, { sx: t.sx, sy: t.sy, sz: t.sz });
}

/**
 * t 를 적용한 상태에서 **world 피벗 p 를 고정한 채** 모델 로컬 축 기준으로
 * per-axis 배율 deltaScale 을 곱한 새 transform (B-9).
 *
 * 수학: 로컬 피벗 pl = inv(W_t)·p 라 두면, 스케일 후에도 pl 이 같은 world 점에
 * 오도록 평행이동을 보정한다.
 *   S' = S∘Sd (성분별 곱 — 로컬 프레임 diagonal 이라 분해 가능)
 *   pos' = pos + R·(S·pl − S'·pl)
 * 회전 R 은 불변. 비균일 스케일이어도 로컬 축 기준이라 성립한다.
 */
export function scaleTransformAroundWorldPivot(
  t: TransformV2,
  deltaScale: [number, number, number],
  pivotWorld: Vector3,
): TransformV2 {
  const curQ = quaternionFromTransform(t);

  // 로컬 피벗 pl = inv(W_t)·p.
  const w = matrixFromTransform(t);
  const pl = Vector3.TransformCoordinates(pivotWorld, Matrix.Invert(w));

  const newScale = {
    sx: t.sx * deltaScale[0],
    sy: t.sy * deltaScale[1],
    sz: t.sz * deltaScale[2],
  };

  // R·(S·pl − S'·pl) — 스케일 차이를 회전 프레임에서 본 평행이동 보정.
  const diff = new Vector3(
    t.sx * pl.x - newScale.sx * pl.x,
    t.sy * pl.y - newScale.sy * pl.y,
    t.sz * pl.z - newScale.sz * pl.z,
  );
  const rotMat = Matrix.Identity();
  curQ.toRotationMatrix(rotMat);
  const corr = Vector3.TransformCoordinates(diff, rotMat);
  const newPos = new Vector3(t.tx, t.ty, t.tz).add(corr);

  return transformFromParts(curQ, newPos, newScale);
}

/**
 * mesh 의 현재 world AABB 중심 — 회전·스케일 피벗의 정본 (B-9).
 *
 * 로드 시점에 정점으로 베이크된 원점(바닥 중심)이 아니라 **지금 화면에 보이는
 * 실루엣의 중심**을 쓴다. Babylon 은 world 행렬/바운딩 정보를 지연 갱신하므로
 * 반드시 computeWorldMatrix(true) 후 refresh 한 값을 읽는다.
 */
export function meshWorldBBoxCenter(mesh: Mesh): Vector3 {
  mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo();
  return mesh.getBoundingInfo().boundingBox.centerWorld.clone();
}

/**
 * Mesh 의 한 face 의 world normal n 이 -Y (바닥 방향) 가 되도록
 * 회전 + AABB minY 가 0 이 되도록 Y 이동한 새 TransformV2 반환.
 *
 * 알고리즘:
 *   1. axis = n × (-Y), angle = arccos(n · -Y) 의 quaternion 으로
 *      현재 mesh rotation 에 곱해서 새 rotation 결정.
 *   2. 새 rotation 으로 가상 변환 → 새 world bounding box 의 minY
 *      구함. translation Y 를 -minY 만큼 보정해 base 가 Y=0 위에.
 *   3. translation X, Z 는 **바운딩박스 중심 피벗 기준으로 보정**한다 (B-9).
 *      예전에는 tx/tz 를 그대로 뒀는데, 회전이 베이크된 원점 기준이라 모델이
 *      옆으로 밀려났다. rotateTransformAroundWorldPivot 으로 피벗을 고정한
 *      tx/tz 를 얻어 쓰고, ty 만 아래 코너 minY 로직으로 덮어쓴다.
 */
export function computeAlignFloorTransform(
  mesh: Mesh,
  worldNormal: Vector3,
): TransformV2 {
  const n = worldNormal.clone().normalize();
  const target = new Vector3(0, -1, 0);
  const dot = Vector3.Dot(n, target);

  let deltaQ: Quaternion;
  if (dot > 0.9999) {
    // 이미 바닥 방향 — 회전 X.
    deltaQ = Quaternion.Identity();
  } else if (dot < -0.9999) {
    // 정반대 (위로 향함) — X 축 180°.
    deltaQ = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
  } else {
    const axis = Vector3.Cross(n, target);
    axis.normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    deltaQ = Quaternion.RotationAxis(axis, angle);
  }

  // 현재 회전 quaternion.
  const curQ =
    mesh.rotationQuaternion ?? Quaternion.FromEulerVector(mesh.rotation);
  const newQ = deltaQ.multiply(curQ);
  const eul = newQ.toEulerAngles();

  // 피벗(현재 bbox 중심) 고정 회전으로 tx/tz 보정값을 얻는다 (B-9).
  //   ty 는 아래 코너 minY 로직이 정본이라 여기서 나온 값은 쓰지 않는다.
  const pivoted = rotateTransformAroundWorldPivot(
    readMeshTransform(mesh),
    deltaQ,
    meshWorldBBoxCenter(mesh),
  );

  // 새 회전 적용한 가상 transform 으로 bounding box 의 minY 계산.
  // mesh 의 vertex local AABB 를 새 rotation 으로 변환 후 minY.
  mesh.refreshBoundingInfo();
  const localBB = mesh.getBoundingInfo().boundingBox;
  const localCorners = [
    new Vector3(localBB.minimum.x, localBB.minimum.y, localBB.minimum.z),
    new Vector3(localBB.maximum.x, localBB.minimum.y, localBB.minimum.z),
    new Vector3(localBB.minimum.x, localBB.maximum.y, localBB.minimum.z),
    new Vector3(localBB.minimum.x, localBB.minimum.y, localBB.maximum.z),
    new Vector3(localBB.maximum.x, localBB.maximum.y, localBB.minimum.z),
    new Vector3(localBB.maximum.x, localBB.minimum.y, localBB.maximum.z),
    new Vector3(localBB.minimum.x, localBB.maximum.y, localBB.maximum.z),
    new Vector3(localBB.maximum.x, localBB.maximum.y, localBB.maximum.z),
  ];
  const sx = mesh.scaling.x;
  const sy = mesh.scaling.y;
  const sz = mesh.scaling.z;
  const rotMat = Matrix.Identity();
  newQ.toRotationMatrix(rotMat);
  let minY = Infinity;
  for (const c of localCorners) {
    const scaled = new Vector3(c.x * sx, c.y * sy, c.z * sz);
    const rotated = Vector3.TransformCoordinates(scaled, rotMat);
    if (rotated.y < minY) minY = rotated.y;
  }

  return {
    tx: pivoted.tx, // 피벗 고정 회전 보정 (B-9) — 옆으로 밀리지 않게.
    ty: -minY, // base 가 Y=0 위에 정확히 놓이도록
    tz: pivoted.tz,
    rx: radToDeg(eul.x),
    ry: radToDeg(eul.y),
    rz: radToDeg(eul.z),
    sx,
    sy,
    sz,
  };
}

export function readMeshTransform(mesh: Mesh): TransformV2 {
  const q = mesh.rotationQuaternion ?? Quaternion.FromEulerVector(mesh.rotation);
  const euler = q.toEulerAngles();
  return {
    tx: mesh.position.x,
    ty: mesh.position.y,
    tz: mesh.position.z,
    rx: radToDeg(euler.x),
    ry: radToDeg(euler.y),
    rz: radToDeg(euler.z),
    sx: mesh.scaling.x,
    sy: mesh.scaling.y,
    sz: mesh.scaling.z,
  };
}
