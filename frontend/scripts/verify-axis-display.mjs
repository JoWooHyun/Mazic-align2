// 축 Z-up 표시 규약 헤드리스 검증 (B-13).
//
//   리드 요구: "Y축이 Z축처럼 위아래로 올라가는 게 이상하다" → 프린터 관례대로
//   **Z 를 높이로 표기**한다(CHITUBOX 캡처 ①: Z=위, Y=안쪽, X=옆).
//   내부 좌표계(Babylon Y-up)는 슬라이서 ~35~40 파일의 전제라 **손대지 않고**
//   표시 레이어에서만 환산한다.
//
//   ⚠️ 이 검증의 핵심은 **두 가지 함정을 실제로 잡아내는 것**이다:
//     함정 1. 단순 스왑 (x,z,y) — 행렬식 −1(반사)이라 회전 부호가 뒤집힌다.
//     함정 2. 회전을 성분 교환으로 환산 — Euler 합성 순서와 교환되지 않아
//             복합 회전에서 틀린다. **단축 회전만 보면 우연히 통과한다.**
//   그래서 (c)·(e) 에서 잘못된 구현을 대조군으로 함께 돌린다
//   (프로젝트 규약: B-1 확립, B-12 에서 이 규약 덕에 결함을 잡았다).
//
//   실행: npx tsx scripts/verify-axis-display.mjs

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";

import {
  fromDisplayAxes,
  fromDisplayEulerDeg,
  fromDisplayQuaternion,
  swapScaleAxes,
  toDisplayAxes,
  toDisplayEulerDeg,
  toDisplayQuaternion,
} from "../src/features/v2/types/axis-display.ts";
import {
  displayAnchorOffset,
  rotateTransformAroundWorldPivot,
  matrixFromTransform,
  toDisplayPosition,
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

// Babylon 수학 클래스가 float32(Math.fround)라 ~1e-6 반올림이 남는다.
const TOL = 1e-4;
const d2r = (d) => (d * Math.PI) / 180;
const r2d = (r) => (r * 180) / Math.PI;

/** 두 quaternion 이 같은 자세인지 (q 와 −q 는 같은 자세). */
function sameOrientation(a, b) {
  return Math.abs(Math.abs(Quaternion.Dot(a, b)) - 1) < 1e-5;
}

/** 3x3 행렬식 — 열벡터 3개로 계산. */
function det3(c0, c1, c2) {
  return (
    c0.x * (c1.y * c2.z - c1.z * c2.y) -
    c1.x * (c0.y * c2.z - c0.z * c2.y) +
    c2.x * (c0.y * c1.z - c0.z * c1.y)
  );
}

/** 매핑 함수 f 를 기저에 적용해 얻은 열벡터 3개의 행렬식. */
function detOfMapping(f) {
  const col = (v) => new Vector3(...f(v));
  return det3(col([1, 0, 0]), col([0, 1, 0]), col([0, 0, 1]));
}

// ── (a) 왕복 무손실 ──────────────────────────────────────────────────────
function caseRoundTrip() {
  console.log("\n(a) toDisplayAxes / fromDisplayAxes 왕복 무손실:");

  const vectors = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [12.5, -3.25, 7.75],
    [-40.125, 21.5, 0],
    [3.7, 88.125, -19.0625],
  ];

  for (const v of vectors) {
    const back = fromDisplayAxes(toDisplayAxes(v));
    const err = Math.hypot(back[0] - v[0], back[1] - v[1], back[2] - v[2]);
    assert(err < TOL, `내부→표시→내부 (${v.join(", ")}) 오차 ${err.toExponential(2)}`);

    // 반대 방향 왕복도 무손실이어야 한다 (사용자 타이핑 경로).
    const fwd = toDisplayAxes(fromDisplayAxes(v));
    const err2 = Math.hypot(fwd[0] - v[0], fwd[1] - v[1], fwd[2] - v[2]);
    assert(err2 < TOL, `표시→내부→표시 (${v.join(", ")}) 오차 ${err2.toExponential(2)}`);
  }

  // 스케일은 부호 없이 축만 교환 — 자기 자신이 역함수.
  for (const s of [[1, 1, 1], [1.7, 0.6, 2.3], [0.5, 2, 1.25]]) {
    const back = swapScaleAxes(swapScaleAxes(s));
    assert(
      back[0] === s[0] && back[1] === s[1] && back[2] === s[2],
      `스케일 (${s.join(", ")}) 왕복 무손실`,
    );
    assert(
      swapScaleAxes(s).every((v) => v > 0),
      `스케일 (${s.join(", ")}) 는 부호가 붙지 않는다 (음수 배율 = 모델 뒤집힘 방지)`,
    );
  }
}

// ── (b) 행렬식 +1 (반사가 아님) ──────────────────────────────────────────
function caseDeterminant() {
  console.log("\n(b) 채택 매핑 (x, −z, y) 의 행렬식 = +1 (순수 회전):");

  const det = detOfMapping(toDisplayAxes);
  console.log(`  det[toDisplayAxes] = ${det.toFixed(6)}`);
  assert(Math.abs(det - 1) < TOL, `행렬식 +1 — 반사가 아니라 회전 (${det.toFixed(6)})`);

  const detInv = detOfMapping(fromDisplayAxes);
  console.log(`  det[fromDisplayAxes] = ${detInv.toFixed(6)}`);
  assert(Math.abs(detInv - 1) < TOL, `역변환도 행렬식 +1 (${detInv.toFixed(6)})`);

  // 매핑이 회전이라면 quaternion 으로 표현 가능해야 한다 — 실제로 X축 +90°.
  const qm = Quaternion.RotationAxis(new Vector3(1, 0, 0), d2r(90));
  const R = new Matrix();
  qm.toRotationMatrix(R);
  for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const viaQuat = Vector3.TransformCoordinates(new Vector3(...e), R);
    const viaMap = new Vector3(...toDisplayAxes(e));
    assert(
      Vector3.Distance(viaQuat, viaMap) < TOL,
      `기저 (${e.join(",")}): 매핑 = X축 +90° 회전과 일치`,
    );
  }
}

// ── (c) 대조군 — 단순 스왑은 반사라 회전 부호가 뒤집힌다 ─────────────────
function caseNaiveSwapIsReflection() {
  console.log(
    "\n(c) 대조군 ①: 단순 스왑 (x, z, y) 는 det=−1 이라 회전 부호가 뒤집힌다:",
  );

  const naiveSwap = (v) => [v[0], v[2], v[1]];
  const det = detOfMapping(naiveSwap);
  console.log(`  det[naiveSwap] = ${det.toFixed(6)}`);
  assert(
    Math.abs(det - -1) < TOL,
    `단순 스왑의 행렬식 = −1 (반사) — 후보 A 를 기각하는 근거 (${det.toFixed(6)})`,
  );

  // 부호 뒤집힘을 물리적으로 보여준다.
  //   내부에서 "위(내부 +Y = 표시 +Z)" 를 축으로 +90° 를 돌렸을 때,
  //   표시 좌표에서 본 회전 방향이 두 매핑에서 반대여야 한다.
  //
  //   방법: 내부 +Y 축 +90° 회전을 각 매핑으로 옮긴 뒤, 표시 +X 축이 어디로
  //   가는지 본다. 올바른 매핑이면 표시 XY 평면에서 반시계(+Z 축 +90°),
  //   반사 매핑이면 시계 방향이 된다.
  const qInt = Quaternion.RotationAxis(new Vector3(0, 1, 0), d2r(90));
  const Rint = new Matrix();
  qInt.toRotationMatrix(Rint);

  /** 내부 회전을 매핑 f 로 옮겨(켤레), 표시 +X 가 가는 곳. */
  function displayImageOfX(f, fInv) {
    const back = new Vector3(...fInv([1, 0, 0]));
    const rot = Vector3.TransformCoordinates(back, Rint);
    return new Vector3(...f([rot.x, rot.y, rot.z]));
  }

  const good = displayImageOfX(toDisplayAxes, fromDisplayAxes);
  // 단순 스왑은 자기 자신이 역함수.
  const bad = displayImageOfX(naiveSwap, naiveSwap);
  console.log(
    `  [채택 (x,−z,y)] 내부 +Y축 90° 후 표시 X축 → (${good.x.toFixed(3)}, ${good.y.toFixed(3)}, ${good.z.toFixed(3)})`,
  );
  console.log(
    `  [대조 (x, z,y)] 내부 +Y축 90° 후 표시 X축 → (${bad.x.toFixed(3)}, ${bad.y.toFixed(3)}, ${bad.z.toFixed(3)})`,
  );

  // 표시 XY 평면 안에서의 회전 방향 = z 성분의 외적 부호 (X × 결과).
  const crossGood = 1 * good.y - 0 * good.x; // (1,0) × (gx,gy) 의 z 성분
  const crossBad = 1 * bad.y - 0 * bad.x;
  console.log(
    `  회전 방향 부호: 채택 ${crossGood > 0 ? "+" : "−"} / 대조 ${crossBad > 0 ? "+" : "−"}`,
  );
  assert(
    crossGood * crossBad < 0,
    "두 매핑의 회전 방향이 서로 반대 — 단순 스왑을 쓰면 +90° 입력이 −90° 로 도는 버그",
  );
  assert(
    crossGood > 0,
    "채택 매핑은 내부 '위 축 +90°' 가 표시에서도 +방향(반시계) — 부호 보존",
  );
}

// ── (d) 높이축이 표시 Z 로 간다 ──────────────────────────────────────────
function caseUpAxis() {
  console.log("\n(d) 내부 +Y(위) → 표시 +Z(위), 바닥 Y=0 → 표시 Z=0:");

  const up = toDisplayAxes([0, 1, 0]);
  console.log(`  내부 +Y (0,1,0) → 표시 (${up.join(", ")})`);
  assert(
    Math.abs(up[0]) < TOL && Math.abs(up[1]) < TOL && Math.abs(up[2] - 1) < TOL,
    "내부 +Y(위) 가 표시 +Z 로 간다 — 리드 요구 'Z 가 위'",
  );

  // 내부 +Z(안쪽) → 표시 (0,−1,0). CHITUBOX 캡처 ① 의 "Y 가 안쪽" 과 대응.
  const depth = toDisplayAxes([0, 0, 1]);
  console.log(`  내부 +Z (0,0,1) → 표시 (${depth.join(", ")})`);
  assert(
    Math.abs(depth[1] - -1) < TOL,
    "내부 +Z 가 표시 −Y 로 간다 — 깊이축이 표시 Y",
  );

  // X 는 그대로.
  const side = toDisplayAxes([1, 0, 0]);
  assert(Math.abs(side[0] - 1) < TOL, "내부 +X 는 표시 +X 그대로");

  // 플레이트 위 여러 높이의 점: 표시 Z 가 내부 Y 와 정확히 같아야 한다.
  for (const h of [0, 0.05, 12.5, 137.25]) {
    const p = toDisplayAxes([10, h, -4]);
    assert(
      Math.abs(p[2] - h) < TOL,
      `높이 ${h}mm 인 점의 표시 Z = ${p[2]} (바닥 Y=0 → 표시 Z=0)`,
    );
  }
}

// ── (e) 회전 변환 — 켤레가 맞고, 성분 교환은 틀린다 ──────────────────────
function caseRotation() {
  console.log("\n(e) 회전 환산 검증 (quaternion 켤레) + 대조군 ②(성분 교환):");

  // 기준 정의: 표시 회전은 좌표 변환의 켤레 R_disp = M·R_int·M⁻¹.
  //   이 케이스의 정답지는 quaternion 이 아니라 **행렬로 직접 켤레한 값**이라,
  //   구현(quaternion 곱)과 독립적으로 계산해 서로 대조한다.
  function conjugateByMatrix(qInt) {
    const R = new Matrix();
    qInt.toRotationMatrix(R);
    const cols = [];
    for (const e of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const back = new Vector3(...fromDisplayAxes(e));
      const rot = Vector3.TransformCoordinates(back, R);
      cols.push(new Vector3(...toDisplayAxes([rot.x, rot.y, rot.z])));
    }
    const m = Matrix.FromArray([
      cols[0].x, cols[0].y, cols[0].z, 0,
      cols[1].x, cols[1].y, cols[1].z, 0,
      cols[2].x, cols[2].y, cols[2].z, 0,
      0, 0, 0, 1,
    ]);
    const q = new Quaternion();
    m.decompose(new Vector3(), q, new Vector3());
    return q;
  }

  const cases = [
    [30, 0, 0],
    [0, 40, 0],
    [0, 0, 50],
    [23, -41, 67],
    [89, 0, -12],
    [10, 20, 30],
    [-170, 15, 120],
  ];

  // (e-1) 구현이 행렬 켤레와 일치하는가.
  for (const [rx, ry, rz] of cases) {
    const qi = Quaternion.FromEulerAngles(d2r(rx), d2r(ry), d2r(rz));
    assert(
      sameOrientation(toDisplayQuaternion(qi), conjugateByMatrix(qi)),
      `int(${rx},${ry},${rz}): quaternion 켤레 = 행렬 켤레 (독립 계산 일치)`,
    );
  }

  // (e-2) 자세 왕복 — 표시 Euler 로 내보냈다 되돌려도 같은 자세.
  console.log("\n  회전 왕복 (내부 → 표시 Euler → 내부):");
  for (const [rx, ry, rz] of cases) {
    const disp = toDisplayEulerDeg([rx, ry, rz]);
    const back = fromDisplayEulerDeg(disp);
    const qa = Quaternion.FromEulerAngles(d2r(rx), d2r(ry), d2r(rz));
    const qb = Quaternion.FromEulerAngles(d2r(back[0]), d2r(back[1]), d2r(back[2]));
    console.log(
      `    int(${rx},${ry},${rz}) → disp(${disp.map((v) => v.toFixed(3)).join(", ")})`,
    );
    assert(
      sameOrientation(qa, qb),
      `int(${rx},${ry},${rz}) 왕복 후 동일 자세 (Euler 성분은 달라도 자세는 같다)`,
    );
  }

  // (e-3) 물리적 의미 — 표시 축 회전이 의도한 내부 축을 돌리는가.
  console.log("\n  표시 축 회전의 물리적 의미:");
  {
    // 표시 Z(=위) 90° → 내부는 Y(=위) 90° 여야 한다.
    const int1 = fromDisplayEulerDeg([0, 0, 90]);
    console.log(`    disp(0,0,90) → int(${int1.map((v) => v.toFixed(3)).join(", ")})`);
    assert(
      Math.abs(int1[0]) < 1e-3 &&
        Math.abs(int1[1] - 90) < 1e-3 &&
        Math.abs(int1[2]) < 1e-3,
      "표시 Z축 +90°(수직축 회전) = 내부 Y축 +90° — 부호까지 보존",
    );

    // 표시 Y 90° → 내부 Z −90°.
    const int2 = fromDisplayEulerDeg([0, 90, 0]);
    console.log(`    disp(0,90,0) → int(${int2.map((v) => v.toFixed(3)).join(", ")})`);
    assert(
      Math.abs(int2[2] - -90) < 1e-3,
      "표시 Y축 +90° = 내부 Z축 −90° — 매핑의 부호 규약과 일치",
    );

    // 표시 X 는 내부 X 그대로.
    const int3 = fromDisplayEulerDeg([90, 0, 0]);
    console.log(`    disp(90,0,0) → int(${int3.map((v) => v.toFixed(3)).join(", ")})`);
    assert(
      Math.abs(int3[0] - 90) < 1e-3,
      "표시 X축 +90° = 내부 X축 +90° — X 는 불변축",
    );
  }

  // (e-4) 대조군 ② — 성분 교환 (rx, −rz, ry) 은 복합 회전에서 틀린다.
  //   ⚠️ 단축 회전만 보면 우연히 맞아서 통과한다. 그래서 복합 회전으로 잡는다.
  console.log("\n  대조군 ②: 회전을 성분 교환으로 환산하면?");
  const naiveEuler = (r) => [r[0], -r[2], r[1]];
  let naiveMatchedSingle = 0;
  let naiveBrokeCompound = 0;
  for (const [rx, ry, rz] of cases) {
    const correct = toDisplayEulerDeg([rx, ry, rz]);
    const naive = naiveEuler([rx, ry, rz]);
    const qc = Quaternion.FromEulerAngles(
      d2r(correct[0]), d2r(correct[1]), d2r(correct[2]),
    );
    const qn = Quaternion.FromEulerAngles(d2r(naive[0]), d2r(naive[1]), d2r(naive[2]));
    const agrees = sameOrientation(qc, qn);
    const isSingleAxis =
      [rx, ry, rz].filter((v) => Math.abs(v) > 1e-9).length <= 1;
    if (isSingleAxis && agrees) naiveMatchedSingle++;
    if (!isSingleAxis && !agrees) {
      naiveBrokeCompound++;
      console.log(
        `    int(${rx},${ry},${rz}): 올바름 (${correct.map((v) => v.toFixed(2)).join(", ")}) vs 성분교환 (${naive.join(", ")}) ← 불일치`,
      );
    }
  }
  assert(
    naiveMatchedSingle === 3,
    `성분 교환은 단축 회전 3건에서는 우연히 맞는다 (${naiveMatchedSingle}/3) — 단축만 검증하면 결함을 놓친다는 증거`,
  );
  assert(
    naiveBrokeCompound === 4,
    `성분 교환은 복합 회전 4건 전부에서 틀린다 (${naiveBrokeCompound}/4) — 대조군이 결함을 잡아냄`,
  );

  // (e-5) 켤레는 회전 각도(크기)를 보존한다 — 반사였다면 깨진다.
  console.log("\n  켤레의 각도 보존:");
  for (const [rx, ry, rz] of cases) {
    const qi = Quaternion.FromEulerAngles(d2r(rx), d2r(ry), d2r(rz));
    const qd = toDisplayQuaternion(qi);
    const angI = 2 * Math.acos(Math.min(1, Math.abs(qi.w)));
    const angD = 2 * Math.acos(Math.min(1, Math.abs(qd.w)));
    assert(
      Math.abs(angI - angD) < 1e-4,
      `int(${rx},${ry},${rz}): 회전각 ${r2d(angI).toFixed(3)}° 보존 (표시 ${r2d(angD).toFixed(3)}°)`,
    );
  }

  // (e-6) quaternion 왕복 자체.
  for (const [rx, ry, rz] of cases) {
    const qi = Quaternion.FromEulerAngles(d2r(rx), d2r(ry), d2r(rz));
    assert(
      sameOrientation(fromDisplayQuaternion(toDisplayQuaternion(qi)), qi),
      `int(${rx},${ry},${rz}): quaternion 왕복 무손실`,
    );
  }
}

// ── (f) B-12 회귀 — 축 변환을 얹어도 POSITION 표시 불변 ──────────────────
function caseB12Regression() {
  console.log("\n(f) B-12 회귀: 축 변환을 얹어도 회전 시 POSITION 표시 불변:");

  // B-12 검증과 같은 픽스처 — 높이 20mm 모델의 로컬 bbox 중심.
  const LOCAL_BBOX_CENTER = new Vector3(0, 10, 0);
  const pivotOf = (t) => {
    const c = Vector3.TransformCoordinates(
      LOCAL_BBOX_CENTER,
      matrixFromTransform(t),
    );
    return [c.x, c.y, c.z];
  };

  const t0 = {
    tx: 15, ty: 0, tz: -8,
    rx: 0, ry: 0, rz: 0,
    sx: 1, sy: 1, sz: 1,
  };

  // 패널 렌더 경로 그대로: 내부값 → (B-12) bbox 기준 환산 → (B-13) 축 변환.
  const panelDisplay = (t) =>
    toDisplayAxes(toDisplayPosition(t, displayAnchorOffset(t, pivotOf(t))));

  const disp0 = panelDisplay(t0);
  console.log(`  회전 전 표시 = (${disp0.map((v) => v.toFixed(4)).join(", ")})`);

  // 표시 Z 는 bbox 중심의 높이(=10mm) 여야 한다 — Z-up 표기 확인.
  assert(
    Math.abs(disp0[2] - 10) < TOL,
    `표시 Z = 10mm (bbox 중심 높이) — 높이가 Z 로 표기됨 (${disp0[2].toFixed(4)})`,
  );

  const rotations = [
    ["X축 89°", new Vector3(1, 0, 0), 89],
    ["Z축 95°", new Vector3(0, 0, 1), 95],
    ["Y축 -137°", new Vector3(0, 1, 0), -137],
    ["임의축 43°", new Vector3(0.3, 0.9, -0.2).normalize(), 43],
  ];
  for (const [label, axis, deg] of rotations) {
    const dq = Quaternion.RotationAxis(axis, d2r(deg));
    const t1 = rotateTransformAroundWorldPivot(t0, dq, new Vector3(...pivotOf(t0)));
    const disp1 = panelDisplay(t1);
    const drift = Math.hypot(
      disp1[0] - disp0[0],
      disp1[1] - disp0[1],
      disp1[2] - disp0[2],
    );
    console.log(
      `  ${label} 후 표시 = (${disp1.map((v) => v.toFixed(4)).join(", ")})  이동 ${drift.toExponential(2)}mm`,
    );
    assert(
      drift < TOL,
      `${label}: 축 변환을 얹어도 표시 불변 (B-12 보존, ${drift.toExponential(2)}mm)`,
    );
  }

  // 입력 역환산 왕복 — 사용자가 표시값을 타이핑하는 경로 전체.
  console.log("\n  패널 입력 왕복 (표시 타이핑 → 내부 → 다시 표시):");
  const t = {
    tx: 12.5, ty: -3.25, tz: 7.75,
    rx: 23, ry: -41, rz: 67,
    sx: 1.7, sy: 0.6, sz: 2.3,
  };
  const off = displayAnchorOffset(t, pivotOf(t));
  const typed = [3.5, -7.125, 12.25];
  // 역순: 표시 → (B-13 역) 축 변환 → (B-12 역) bbox 기준 역환산 → 내부.
  const internalAxes = fromDisplayAxes(typed);
  const nextT = { ...t };
  {
    const [tx, ty, tz] = [
      internalAxes[0] - off[0],
      internalAxes[1] - off[1],
      internalAxes[2] - off[2],
    ];
    nextT.tx = tx;
    nextT.ty = ty;
    nextT.tz = tz;
  }
  const shown = toDisplayAxes(toDisplayPosition(nextT, off));
  const err = Math.hypot(
    shown[0] - typed[0],
    shown[1] - typed[1],
    shown[2] - typed[2],
  );
  console.log(
    `  타이핑 (${typed.join(", ")}) → 다시 표시 (${shown.map((v) => v.toFixed(4)).join(", ")})`,
  );
  assert(err < TOL, `입력한 표시값이 그대로 되돌아옴 (오차 ${err.toExponential(2)}mm)`);
}

function main() {
  console.log("축 Z-up 표시 규약 검증 (B-13)");
  caseRoundTrip();
  caseDeterminant();
  caseNaiveSwapIsReflection();
  caseUpAxis();
  caseRotation();
  caseB12Regression();
  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
