// 회전·스케일 피벗 헤드리스 검증 (B-9).
//   utils/transform.ts 의 순수 헬퍼가 "world 피벗을 고정한 채" 회전/스케일을
//   더하는지 assert 한다. 피벗이 고정돼야 CHITUBOX/프루사처럼 제자리 회전이
//   되고, 베이크된 원점 기준 공전(리드 보고 결함)이 사라진다.
//
//   Mesh 의존 함수(meshWorldBBoxCenter)는 호출하지 않는다 — Babylon 의 수학
//   클래스(Matrix/Quaternion/Vector3)만 쓰므로 node 에서 그대로 돌아간다.
//
//   실행: npx tsx scripts/verify-transform-pivot.mjs

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";

import {
  matrixFromTransform,
  rotateTransformAroundWorldPivot,
  scaleTransformAroundWorldPivot,
  degToRad,
} from "../src/features/v2/utils/transform.ts";

// ── assert 유틸 ──────────────────────────────────────────────────────────
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

/** transform t 를 적용했을 때 world 점 p 가 가는 곳. */
function applyToPoint(t, p) {
  return Vector3.TransformCoordinates(p, matrixFromTransform(t));
}

/**
 * "피벗이 고정됐다"의 정의: 피벗의 **모델 부착점**이 변환 후에도 같은 world
 * 좌표에 남는가. 즉 pl = inv(W_old)·p 를 W_new 로 보내면 다시 p 여야 한다.
 */
function pivotDrift(tOld, tNew, pivot) {
  const localPivot = Vector3.TransformCoordinates(
    pivot,
    Matrix.Invert(matrixFromTransform(tOld)),
  );
  const after = applyToPoint(tNew, localPivot);
  return Vector3.Distance(after, pivot);
}

/** 두 행렬의 선형부(3x3) 최대 성분 차. */
function linearPartMaxDiff(a, b) {
  const ma = a.m;
  const mb = b.m;
  let d = 0;
  // row-major 4x4 의 상위 3x3 (Babylon m 은 column-major flat 이지만 대응 위치는 동일).
  const idx = [0, 1, 2, 4, 5, 6, 8, 9, 10];
  for (const i of idx) d = Math.max(d, Math.abs(ma[i] - mb[i]));
  return d;
}

// 피벗 이동 허용치 1e-4mm(0.1µm). Babylon 의 Matrix/Vector3 는 내부적으로
//   float32(Math.fround)라 좌표 크기 ~10mm 에서 ~1e-6mm 반올림 오차가 남는다.
//   이는 로직 오차가 아니라 부동소수 한계이며, 프린터 해상도(수십 µm)보다
//   두 자리 이상 작다. 무보정 방식의 이탈은 mm 단위라 (d)가 여전히 구분한다.
const TOL = 1e-4;

// 임의의 "까다로운" 기준 transform: 비원점 위치·비단위 회전·비균일 스케일.
const T0 = {
  tx: 12.5, ty: -3.25, tz: 7.75,
  rx: 23, ry: -41, rz: 67,
  sx: 1.7, sy: 0.6, sz: 2.3,
};
// 임의 피벗 (모델 원점과 무관한 곳).
const PIVOT = new Vector3(-4.5, 9.25, 3.75);

function caseRotatePivotFixed() {
  console.log("\n(a) 회전 — 피벗 world 좌표 불변 + 선형부 = Rd·(기존 선형부):");
  const deltaQ = Quaternion.RotationAxis(
    new Vector3(0.3, 0.9, -0.2).normalize(),
    degToRad(37),
  );
  const t1 = rotateTransformAroundWorldPivot(T0, deltaQ, PIVOT);

  const drift = pivotDrift(T0, t1, PIVOT);
  console.log(`  피벗 이동량 = ${drift.toExponential(3)}mm`);
  assert(drift < TOL, `회전 후 피벗 world 좌표 불변 (drift ${drift.toExponential(2)} < 1e-4)`);

  // 선형부 검산: W1 의 선형부 = Rd · (W0 의 선형부).
  const w0 = matrixFromTransform(T0);
  const w1 = matrixFromTransform(t1);
  const rd = Matrix.Identity();
  deltaQ.toRotationMatrix(rd);
  // Babylon 은 row-vector 규약(v·M)이라 합성 순서가 M0·Rd 로 표기된다.
  const expected = w0.multiply(rd);
  const diff = linearPartMaxDiff(w1, expected);
  console.log(`  선형부 최대 차 = ${diff.toExponential(3)}`);
  assert(diff < 1e-5, `선형부 = Rd·R·S (차 ${diff.toExponential(2)} < 1e-5)`);

  // 스케일 불변.
  assert(
    Math.abs(t1.sx - T0.sx) < TOL &&
      Math.abs(t1.sy - T0.sy) < TOL &&
      Math.abs(t1.sz - T0.sz) < TOL,
    "회전은 스케일 성분을 바꾸지 않음",
  );
}

function caseRotateChain() {
  console.log("\n(b) 회전 2연쇄 — 각 단계에서 피벗 불변:");
  const q1 = Quaternion.RotationAxis(new Vector3(1, 0, 0), degToRad(50));
  const q2 = Quaternion.RotationAxis(new Vector3(0, 0, 1), degToRad(-80));

  const t1 = rotateTransformAroundWorldPivot(T0, q1, PIVOT);
  const d1 = pivotDrift(T0, t1, PIVOT);
  assert(d1 < TOL, `1단계(X축 50°) 피벗 불변 (${d1.toExponential(2)})`);

  // 2단계는 새 피벗(회전 후 bbox 중심에 해당)으로도, 같은 피벗으로도 성립해야
  //   한다. 여기서는 같은 world 피벗을 계속 고정하는 경우를 본다.
  const t2 = rotateTransformAroundWorldPivot(t1, q2, PIVOT);
  const d2 = pivotDrift(t1, t2, PIVOT);
  assert(d2 < TOL, `2단계(Z축 −80°) 피벗 불변 (${d2.toExponential(2)})`);

  // 누적 후에도 T0 기준 피벗이 제자리인지(체인 전체).
  const dTotal = pivotDrift(T0, t2, PIVOT);
  console.log(`  2연쇄 누적 피벗 이동량 = ${dTotal.toExponential(3)}mm`);
  assert(dTotal < TOL, `2연쇄 누적에도 피벗 불변 (${dTotal.toExponential(2)})`);

  // 다른 피벗으로 2단계를 걸면 그 피벗이 고정되는지도 확인.
  const pivot2 = new Vector3(20, -5, 11);
  const t2b = rotateTransformAroundWorldPivot(t1, q2, pivot2);
  const d2b = pivotDrift(t1, t2b, pivot2);
  assert(d2b < TOL, `다른 피벗으로 2단계 — 그 피벗이 고정 (${d2b.toExponential(2)})`);
}

function caseScalePivotFixed() {
  console.log("\n(c) 스케일 — 피벗 불변 + 스케일 성분 = S∘Sd:");
  const deltaScale = [1.5, 0.4, 2.2];
  const t1 = scaleTransformAroundWorldPivot(T0, deltaScale, PIVOT);

  const drift = pivotDrift(T0, t1, PIVOT);
  console.log(`  피벗 이동량 = ${drift.toExponential(3)}mm`);
  assert(drift < TOL, `스케일 후 피벗 불변 (drift ${drift.toExponential(2)} < 1e-4)`);

  assert(
    Math.abs(t1.sx - T0.sx * deltaScale[0]) < TOL &&
      Math.abs(t1.sy - T0.sy * deltaScale[1]) < TOL &&
      Math.abs(t1.sz - T0.sz * deltaScale[2]) < TOL,
    "스케일 성분 = S∘Sd (성분별 곱)",
  );

  // 회전 성분 불변.
  assert(
    Math.abs(t1.rx - T0.rx) < 1e-4 &&
      Math.abs(t1.ry - T0.ry) < 1e-4 &&
      Math.abs(t1.rz - T0.rz) < 1e-4,
    "스케일은 회전 성분을 바꾸지 않음",
  );

  // 균일 스케일도 성립.
  const tUni = scaleTransformAroundWorldPivot(T0, [2, 2, 2], PIVOT);
  const dUni = pivotDrift(T0, tUni, PIVOT);
  assert(dUni < TOL, `균일 스케일(×2) 피벗 불변 (${dUni.toExponential(2)})`);
}

function caseNaiveDrifts() {
  console.log("\n(d) 보정 없는 기존 방식은 피벗이 움직인다 (검증이 결함을 잡는 증명):");
  const deltaQ = Quaternion.RotationAxis(
    new Vector3(0.3, 0.9, -0.2).normalize(),
    degToRad(37),
  );
  // 기존 방식 = 회전만 교체하고 tx/ty/tz 는 그대로 둔다.
  const curQ = Quaternion.FromEulerAngles(
    degToRad(T0.rx), degToRad(T0.ry), degToRad(T0.rz),
  );
  const naiveQ = deltaQ.multiply(curQ);
  const eul = naiveQ.toEulerAngles();
  const naive = {
    ...T0,
    rx: (eul.x * 180) / Math.PI,
    ry: (eul.y * 180) / Math.PI,
    rz: (eul.z * 180) / Math.PI,
  };

  const drift = pivotDrift(T0, naive, PIVOT);
  console.log(`  무보정 피벗 이동량 = ${drift.toFixed(4)}mm`);
  assert(
    drift > 1.0,
    `무보정 방식은 피벗이 1mm 이상 이탈 (${drift.toFixed(3)}mm) — 결함 재현`,
  );

  // 같은 조건에서 보정 방식은 고정.
  const fixed = rotateTransformAroundWorldPivot(T0, deltaQ, PIVOT);
  const fixedDrift = pivotDrift(T0, fixed, PIVOT);
  console.log(`  보정 후 피벗 이동량 = ${fixedDrift.toExponential(3)}mm`);
  assert(fixedDrift < TOL, "같은 조건에서 보정 방식은 피벗 고정 — 수정 효과 확인");
}

function main() {
  console.log("회전·스케일 피벗 검증 (B-9)");
  caseRotatePivotFixed();
  caseRotateChain();
  caseScalePivotFixed();
  caseNaiveDrifts();
  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
