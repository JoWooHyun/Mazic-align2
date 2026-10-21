// 수치 패널 표시축 = STL·베드 좌표 헤드리스 검증 (B-13 → 2026-10-15 반사 켤레, 인수인계_20261013 §3-1)
//
//   리드 결정(10/12 "다른 슬라이서처럼", 10/13 §4-2 #1): 패널 숫자 = STL/베드 좌표, 회전 입력은 오른손 규칙
//   (CHITUBOX·PrusaSlicer 와 같은 방향). 내부 좌표계(Babylon Y-up)·저장값(TransformV2)은 그대로이고
//   `types/axis-display.ts` 의 표시·입력 환산만 (x, −z, y) 회전 켤레 → (x, z, y) 반사 + 회전 행렬 켤레로 바꿨다.
//
//   (a) 위치·스케일 왕복 무손실 — world (1, 2, 3) → 표시 (1, 3, 2) → world (1, 2, 3).
//   (b) 표시 = 베드 좌표 — task0-frame worldToBed 로 보낸 베드 점과 toDisplayAxes 의 X·Y(+W/2·D/2)·Z(높이 = world Y)
//       가 같다(여러 점). STL 점 → Babylon STL 로더 교환 (sx, sy, sz) → (sx, sz, sy) → world → 표시 = STL 점.
//       표시 변환은 반사(det −1) — 로더 반사의 역이라서다.
//   (c) 회전의 물리 의미(오른손) — 표시 Euler 단축 ±90° 를 fromDisplayEulerDeg 로 내부 Euler 로 바꾸고
//       Babylon Quaternion.FromEulerAngles(앱이 메쉬에 거는 식)로 world 벡터를 돌려 베드로 보내면
//       Z +90: 베드 (1,0,0) → (0,1,0) (위에서 봐서 반시계) · X +90: (0,1,0) → (0,0,1) · Y +90: (0,0,1) → (1,0,0).
//       세 기저 전부 표준 오른손 회전 행렬과 같고, 앱 경로(utils/transform matrixFromTransform)로도 같다.
//       합성 순서: 표시 Euler (α, β, γ) = 베드 프레임 Rz(γ)·Ry(β)·Rx(α) (고정축 X → Y → Z — 모듈 주석의 규약).
//   (d) 복합 회전 — 임의 내부 Euler 13개(내부·표시 짐벌 정확히·근처 포함)·표시 Euler 5개: 표시 Euler 가 가리키는 자세 = 내부 자세를
//       베드 프레임에서 본 것(Babylon 으로 world 기저를 돌려 독립 계산), 내부 → 표시 → 내부 · 표시 → 내부 → 표시
//       자세 왕복(quaternion 내적 1 − ε), toDisplayQuaternion 판도 같은 자세·회전각 보존·왕복.
//   (e) ★ 대조군 — 실패해야 통과. 변조 대상 문자열·git 옛 판이 없으면 그 자체가 FAIL(공허한 PASS 방지):
//       ① git 8f876ae 의 옛 판((x, −z, y) + quaternion 켤레) → (b) 표시 Y 부호·(c) Z 회전 방향에서 실패.
//       ② 회전을 성분 교환으로만 하는 변조판(표시 = (−rx, −rz, −ry)) → (d) 복합 회전에서 실패.
//          단축 (c) 는 통과한다 — 단축만 검증하면 결함을 놓친다는 증거.
//       ③ 반사 켤레를 한쪽만(M·R) 하는 변조판 → (d) 실패.
//   (f) B-12 회귀 — 축 변환을 얹어도 회전 시 POSITION 표시 불변, 패널 입력 왕복, 표시 Y = world Z.
//
//   변조판·옛 판은 frontend/scripts 아래 임시 폴더에 써서 import 한다(bare import @babylonjs/core 가 같은
//   node_modules 로 풀리게 — WORKFLOW §8). 옛 판 대조군은 git 이력이 있는 체크아웃에서만 돈다.
//
//   실행: npx tsx scripts/verify-axis-display.mjs   (판정은 exit code — 대조군 줄에도 "실패" 문자열이 나온다)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";

import * as REAL from "../src/features/v2/types/axis-display.ts";
import { TASK0_DEFAULTS, worldToBed } from "../src/features/v2/utils/task0/task0-frame.ts";
import {
  displayAnchorOffset,
  fromDisplayPosition,
  matrixFromTransform,
  rotateTransformAroundWorldPivot,
  toDisplayPosition,
} from "../src/features/v2/utils/transform.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, "..");
const AXIS_TS = path.join(FRONTEND, "src", "features", "v2", "types", "axis-display.ts");
/** 대조군 ① — 수정 전 기준 커밋(#141 머지)의 옛 판. */
const OLD_COMMIT = "8f876ae";
const OLD_REL = "frontend/src/features/v2/types/axis-display.ts";

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

/** 절 하나를 모듈 A 로 돌려 결과 목록을 모은다(대조군이 같은 절을 다른 모듈로 돌린다). */
function collect(section, A) {
  const res = [];
  const check = (ok, label) => res.push({ ok: !!ok, label });
  try {
    section(A, check);
  } catch (e) {
    res.push({ ok: false, label: `검사 도중 예외: ${e?.message ?? e}` });
  }
  return res;
}
function assertAll(results) {
  for (const r of results) assert(r.ok, r.label);
}

const TOL = 1e-6;
/** Babylon Matrix(Float32Array) 를 거친 값 비교용 — float32 반올림 ~1e-7. */
const TOL32 = 1e-5;
const d2r = (d) => (d * Math.PI) / 180;
const fmt = (v, n = 3) => `(${v.map((x) => (Math.abs(x) < 5e-13 ? 0 : x).toFixed(n)).join(", ")})`;
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const W = TASK0_DEFAULTS.bedWidthMm;
const D = TASK0_DEFAULTS.bedDepthMm;

// ── 베드 좌표 (task0-frame 이 단일 소스) ───────────────────────────────────
/** world 점 → 베드 점 [X, Y, 높이]. 베드 X·Y 는 worldToBed, 높이 = world Y (task0-frame 머리 주석). */
function worldPointToBed(w) {
  const [bx, by] = worldToBed(w[0], w[2], W, D);
  return [bx, by, w[1]];
}
/** world 방향벡터 → 베드 방향벡터 (worldPointToBed 의 선형부). */
function worldDirToBed(w) {
  const p = worldPointToBed(w);
  const o = worldPointToBed([0, 0, 0]);
  return [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
}
/** 베드 방향벡터 → world 방향벡터 — worldDirToBed 를 기저로 풀어 역행렬을 만든다(교환을 손으로 쓰지 않는다). */
function bedDirToWorld(b) {
  // worldDirToBed 는 선형 사상 L. 열 L(e_j) 로 행렬을 만들고, 직교 행렬이므로 역 = 전치.
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(worldDirToBed);
  return [0, 1, 2].map((j) => cols[j][0] * b[0] + cols[j][1] * b[1] + cols[j][2] * b[2]);
}

// ── 회전 도우미 (모듈과 독립) ─────────────────────────────────────────────
/** 내부 Euler(도)로 world 벡터를 돌린다 — Babylon 이 메쉬에 거는 그대로(FromEulerAngles → 행렬, 행벡터 v·M). */
function rotateWorldByInternalEuler(eDeg, w) {
  const q = Quaternion.FromEulerAngles(d2r(eDeg[0]), d2r(eDeg[1]), d2r(eDeg[2]));
  const m = new Matrix();
  q.toRotationMatrix(m);
  const v = Vector3.TransformCoordinates(new Vector3(...w), m);
  return [v.x, v.y, v.z];
}
/** 앱 경로 — TransformV2 → matrixFromTransform(위치 0·배율 1) 로 world 벡터를 돌린다. */
function rotateWorldByAppTransform(eDeg, w) {
  const t = { tx: 0, ty: 0, tz: 0, rx: eDeg[0], ry: eDeg[1], rz: eDeg[2], sx: 1, sy: 1, sz: 1 };
  const v = Vector3.TransformCoordinates(new Vector3(...w), matrixFromTransform(t));
  return [v.x, v.y, v.z];
}
/** 3×3 행렬(행 배열의 배열) 곱. */
function mul3(a, b) {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
}
/** 표준 오른손 회전 행렬(열벡터 v' = R·v). */
function stdRot(axis, deg) {
  const c = Math.cos(d2r(deg));
  const s = Math.sin(d2r(deg));
  if (axis === "X") return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === "Y") return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
/** 표시 Euler(도) → 베드 프레임 회전 행렬 — 규약 R = Rz(γ)·Ry(β)·Rx(α) 를 여기서 따로 계산한다. */
const dispEulerToBedMatrix = (d) => mul3(stdRot("Z", d[2]), mul3(stdRot("Y", d[1]), stdRot("X", d[0])));
/** 회전(베드 벡터 → 베드 벡터)을 베드 기저에 적용해 행렬로. */
function bedMatrixOf(rotBed) {
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(rotBed);
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => cols[j][i]));
}
/** 내부 Euler(도) → 그 회전을 베드 프레임에서 본 행렬 (Babylon 으로 world 를 돌린 결과를 베드로 옮겨 모은다). */
const internalEulerToBedMatrix = (e) =>
  bedMatrixOf((b) => worldDirToBed(rotateWorldByInternalEuler(e, bedDirToWorld(b))));
/** 표준 quaternion → 행렬 (열벡터). Babylon quaternion 의 성분 규약 그대로. */
function quatToMatrix(q) {
  const { x, y, z, w } = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}
const maxDiff3 = (a, b) => Math.max(...[0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => Math.abs(a[i][j] - b[i][j]))));
/** 두 quaternion 이 같은 자세인지 (q 와 −q 는 같은 자세) — |내적| 이 1 − eps 보다 크다. */
const dotAbs = (a, b) => Math.abs(Quaternion.Dot(a, b));
const qOfInternal = (e) => Quaternion.FromEulerAngles(d2r(e[0]), d2r(e[1]), d2r(e[2]));
/** 3×3 행렬식 — 매핑 f 를 기저에 적용한 열벡터 3개로. */
function detOfMapping(f) {
  const [c0, c1, c2] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(f);
  return (
    c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) -
    c1[0] * (c0[1] * c2[2] - c0[2] * c2[1]) +
    c2[0] * (c0[1] * c1[2] - c0[2] * c1[1])
  );
}

// ── (a) 위치·스케일 왕복 무손실 ───────────────────────────────────────────
function sectionRoundTrip(A, check) {
  const disp = A.toDisplayAxes([1, 2, 3]);
  check(dist3(disp, [1, 3, 2]) < TOL, `(a) world (1, 2, 3) → 표시 ${fmt(disp, 0)} = (1, 3, 2)`);
  const back = A.fromDisplayAxes(disp);
  check(dist3(back, [1, 2, 3]) < TOL, `(a) 표시 (1, 3, 2) → world ${fmt(back, 0)} = (1, 2, 3)`);

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
    const e1 = dist3(A.fromDisplayAxes(A.toDisplayAxes(v)), v);
    check(e1 < TOL, `(a) world→표시→world (${v.join(", ")}) 오차 ${e1.toExponential(2)}`);
    // 반대 방향 왕복(사용자 타이핑 경로).
    const e2 = dist3(A.toDisplayAxes(A.fromDisplayAxes(v)), v);
    check(e2 < TOL, `(a) 표시→world→표시 (${v.join(", ")}) 오차 ${e2.toExponential(2)}`);
  }

  // 스케일은 부호 없이 축만 교환 — 자기 자신이 역함수.
  for (const s of [[1, 1, 1], [1.7, 0.6, 2.3], [0.5, 2, 1.25]]) {
    const back2 = A.swapScaleAxes(A.swapScaleAxes(s));
    check(back2.every((v, i) => v === s[i]), `(a) 스케일 (${s.join(", ")}) 왕복 무손실`);
    check(A.swapScaleAxes(s).every((v) => v > 0), `(a) 스케일 (${s.join(", ")}) 에 부호가 붙지 않는다 (음수 배율 = 모델 뒤집힘)`);
  }
  // 스케일 축 = 위치 축 (표시 Y 배율 = world Z 배율).
  check(dist3(A.swapScaleAxes([1, 2, 3]), [1, 3, 2]) < TOL, "(a) 스케일 축 교환이 위치 축과 같다 (표시 Y = world Z, 표시 Z = world Y)");
}

// ── (b) 표시 = 베드 좌표 = STL 좌표 ───────────────────────────────────────
function sectionBedCoords(A, check) {
  const points = [
    [0, 0, 0],
    [10, 0, 20],
    [-30.5, 12.25, -17.75],
    [42, 3.5, 30],
    [-60, 80, 7.125],
  ];
  for (const w of points) {
    const bed = worldPointToBed(w);
    const disp = A.toDisplayAxes(w);
    const tag = `world (${w.join(", ")})`;
    check(Math.abs(disp[0] + W / 2 - bed[0]) < TOL, `(b) ${tag}: 표시 X + W/2 = 베드 X (${(disp[0] + W / 2).toFixed(3)} vs ${bed[0].toFixed(3)})`);
    check(Math.abs(disp[1] + D / 2 - bed[1]) < TOL, `(b) ${tag}: 표시 Y + D/2 = 베드 Y (${(disp[1] + D / 2).toFixed(3)} vs ${bed[1].toFixed(3)})`);
    check(Math.abs(disp[2] - bed[2]) < TOL, `(b) ${tag}: 표시 Z = 베드 높이(world Y) (${disp[2].toFixed(3)} vs ${bed[2].toFixed(3)})`);
  }

  // 방향: 위 = +Z, 안쪽(world +Z = 베드 +Y) = +Y, 옆 = +X.
  const up = A.toDisplayAxes([0, 1, 0]);
  check(dist3(up, [0, 0, 1]) < TOL, `(b) world +Y(위) → 표시 ${fmt(up, 0)} = +Z`);
  const depth = A.toDisplayAxes([0, 0, 1]);
  check(dist3(depth, [0, 1, 0]) < TOL, `(b) world +Z(안쪽, 베드 +Y) → 표시 ${fmt(depth, 0)} = +Y`);
  const side = A.toDisplayAxes([1, 0, 0]);
  check(dist3(side, [1, 0, 0]) < TOL, `(b) world +X → 표시 ${fmt(side, 0)} = +X`);

  // STL 점 → Babylon STLFileLoader 교환 (sx, sy, sz) → world (sx, sz, sy) (verify-demo-fix1 (b) 가 로더로 실측) → 표시.
  const loaderStlToWorld = (s) => [s[0], s[2], s[1]];
  for (const s of [[1, 2, 3], [-12.5, 40.25, 0.5], [7, -3, 18]]) {
    const disp = A.toDisplayAxes(loaderStlToWorld(s));
    check(dist3(disp, s) < TOL, `(b) STL (${s.join(", ")}) → world → 표시 ${fmt(disp)} = STL 좌표 그대로`);
  }

  // 표시 변환은 반사(det −1) — 로더 반사의 역이라 STL·베드 숫자가 그대로 보인다.
  const det = detOfMapping(A.toDisplayAxes);
  check(Math.abs(det + 1) < TOL, `(b) 표시 변환의 행렬식 = −1 (로더 y/z 교환의 역) — ${det.toFixed(6)}`);
}

// ── (c) 회전의 물리 의미 — 오른손 규칙 ────────────────────────────────────
const PHYSICAL_CASES = [
  { axis: "Z", deg: 90, from: [1, 0, 0], to: [0, 1, 0], note: "위에서 봐서 반시계" },
  { axis: "X", deg: 90, from: [0, 1, 0], to: [0, 0, 1], note: "+Y 쪽이 위로" },
  { axis: "Y", deg: 90, from: [0, 0, 1], to: [1, 0, 0], note: "위쪽이 +X 로" },
  { axis: "Z", deg: -90, from: [1, 0, 0], to: [0, -1, 0], note: "위에서 봐서 시계" },
  { axis: "X", deg: -90, from: [0, 1, 0], to: [0, 0, -1], note: "+Y 쪽이 아래로" },
  { axis: "Y", deg: -90, from: [0, 0, 1], to: [-1, 0, 0], note: "위쪽이 −X 로" },
];
function sectionPhysical(A, check) {
  const idx = { X: 0, Y: 1, Z: 2 };
  for (const c of PHYSICAL_CASES) {
    const disp = [0, 0, 0];
    disp[idx[c.axis]] = c.deg;
    const sign = c.deg > 0 ? "+" : "−";
    const head = `(c) 표시 ${c.axis} ${sign}90°`;
    const internal = A.fromDisplayEulerDeg(disp);
    // 대표 벡터 — 리드가 화면에서 보는 방향.
    const got = worldDirToBed(rotateWorldByInternalEuler(internal, bedDirToWorld(c.from)));
    check(
      dist3(got, c.to) < TOL32,
      `${head}: 베드 (${c.from.join(",")}) → ${fmt(got)} = (${c.to.join(",")}) — ${c.note} (내부 Euler ${fmt(internal, 3)})`,
    );
    // 세 기저 전부 표준 오른손 회전 행렬과 같다.
    const m = internalEulerToBedMatrix(internal);
    const diff = maxDiff3(m, stdRot(c.axis, c.deg));
    check(diff < TOL32, `${head}: 베드 프레임 회전 = 표준 오른손 R${c.axis.toLowerCase()}(${c.deg}°) (최대 차 ${diff.toExponential(2)})`);
    // 앱 경로(matrixFromTransform)로도 같다.
    const gotApp = worldDirToBed(rotateWorldByAppTransform(internal, bedDirToWorld(c.from)));
    check(dist3(gotApp, c.to) < TOL32, `${head}: 앱 경로 matrixFromTransform 도 ${fmt(gotApp)}`);
    // 화면 표시 — 그 자세를 다시 표시하면 입력한 숫자가 보인다.
    const shown = A.toDisplayEulerDeg(internal);
    check(dist3(shown, disp) < 1e-6, `${head}: 다시 표시하면 ${fmt(shown, 4)} = 입력값`);
  }

  // 합성 순서 — 표시 Euler (α, β, γ) = 베드 프레임 Rz(γ)·Ry(β)·Rx(α) (고정축 X → Y → Z).
  for (const d of [[30, 0, 40], [0, 25, -60], [20, 35, 50], [-75, 10, 160]]) {
    const m = internalEulerToBedMatrix(A.fromDisplayEulerDeg(d));
    const diff = maxDiff3(m, dispEulerToBedMatrix(d));
    check(diff < TOL32, `(c) 합성 순서: 표시 ${fmt(d, 0)} = Rz·Ry·Rx (고정축 X → Y → Z, 최대 차 ${diff.toExponential(2)})`);
  }
}

// ── (d) 복합 회전 — 독립 계산 일치 + 자세 왕복 ────────────────────────────
const COMPOUND_INTERNAL = [
  [10, 20, 30],
  [23, -41, 67],
  [-170, 15, 120],
  [89, 0, -12],
  [45, 45, 45],
  [-30, 75, -150],
  [12, -35, 179.5],
  [89.9999, 30, 20], // 내부(Babylon pitch) 짐벌 근처
  [-90, 40, 10], // 내부 짐벌 정확히
  [0, 37, -90], // 표시 β = +90° (표시 짐벌 정확히)
  [0, 37, -89.9999], // 표시 짐벌 근처
  [180, 0, 90], // 표시 β = +90° (내부 X 180° 쪽 분기)
  [0, -25, 90], // 표시 β = −90°
];
const COMPOUND_DISPLAY = [
  [10, 20, 30],
  [-120, 60, 15],
  [10, 90, 20], // 표시 짐벌 — γ 가 α 로 합쳐진 표현으로 돌아온다(자세는 같음)
  [0, -89.99999, 45],
  [170, -5, -170],
];
function sectionCompound(A, check) {
  let worstDot = 1;
  for (const e of COMPOUND_INTERNAL) {
    const d = A.toDisplayEulerDeg(e);
    const tag = `내부 ${fmt(e, 4)} → 표시 ${fmt(d, 3)}`;
    // 표시 Euler 가 가리키는 자세 = 내부 자세를 베드 프레임에서 본 것 (독립 계산).
    const diff = maxDiff3(dispEulerToBedMatrix(d), internalEulerToBedMatrix(e));
    check(diff < TOL32, `(d) 복합 ${tag}: 표시 Euler 의 자세 = 내부 자세(베드 프레임, 최대 차 ${diff.toExponential(2)})`);
    // 내부 → 표시 → 내부 자세 왕복.
    const back = A.fromDisplayEulerDeg(d);
    const dot = dotAbs(qOfInternal(e), qOfInternal(back));
    worstDot = Math.min(worstDot, dot);
    check(1 - dot < 1e-7, `(d) 왕복 ${tag} → 내부 ${fmt(back, 4)}: 같은 자세 (1 − |내적| = ${(1 - dot).toExponential(2)})`);
  }
  for (const d0 of COMPOUND_DISPLAY) {
    // 표시 → 내부 → 표시: 숫자는 달라도(짐벌) 같은 자세.
    const d1 = A.toDisplayEulerDeg(A.fromDisplayEulerDeg(d0));
    const diff = maxDiff3(dispEulerToBedMatrix(d0), dispEulerToBedMatrix(d1));
    check(diff < 1e-6, `(d) 표시 ${fmt(d0, 5)} → 내부 → 표시 ${fmt(d1, 5)}: 같은 자세 (최대 차 ${diff.toExponential(2)})`);
  }
  if (A === REAL) console.log(`    (d) 내부 왕복 최악 1 − |내적| = ${(1 - worstDot).toExponential(2)}`);

  // quaternion 판 — 같은 켤레, 회전각 보존, 왕복.
  for (const e of COMPOUND_INTERNAL) {
    const qi = qOfInternal(e);
    const qd = A.toDisplayQuaternion(qi);
    const diff = maxDiff3(quatToMatrix(qd), internalEulerToBedMatrix(e));
    check(diff < TOL32, `(d) toDisplayQuaternion 내부 ${fmt(e, 4)}: 베드 프레임 자세와 같다 (최대 차 ${diff.toExponential(2)})`);
    const angI = 2 * Math.acos(Math.min(1, Math.abs(qi.w)));
    const angD = 2 * Math.acos(Math.min(1, Math.abs(qd.w)));
    check(Math.abs(angI - angD) < 1e-6, `(d) 켤레는 회전각 보존 ${(angI * 180 / Math.PI).toFixed(3)}° = ${(angD * 180 / Math.PI).toFixed(3)}°`);
    const dot = dotAbs(A.fromDisplayQuaternion(qd), qi);
    check(1 - dot < 1e-12, `(d) quaternion 왕복 무손실 (1 − |내적| = ${(1 - dot).toExponential(2)})`);
  }
}

// ── (f) B-12 회귀 — 축 변환을 얹어도 POSITION 표시 불변 ──────────────────
function sectionB12(A, check) {
  // B-12 검증과 같은 픽스처 — 높이 20mm 모델의 로컬 bbox 중심.
  const LOCAL_BBOX_CENTER = new Vector3(0, 10, 0);
  const pivotOf = (t) => {
    const c = Vector3.TransformCoordinates(LOCAL_BBOX_CENTER, matrixFromTransform(t));
    return [c.x, c.y, c.z];
  };
  const t0 = { tx: 15, ty: 0, tz: -8, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };

  // 패널 렌더 경로 그대로: 내부값 → (B-12) bbox 기준 환산 → (B-13) 축 변환.
  const panelDisplay = (t) => A.toDisplayAxes(toDisplayPosition(t, displayAnchorOffset(t, pivotOf(t))));
  const disp0 = panelDisplay(t0);
  check(Math.abs(disp0[2] - 10) < 1e-4, `(f) 표시 Z = 10mm (bbox 중심 높이) — ${disp0[2].toFixed(4)}`);
  check(Math.abs(disp0[1] - -8) < 1e-4, `(f) 표시 Y = world Z = −8mm (베드 Y − D/2, 부호 그대로) — ${disp0[1].toFixed(4)}`);
  check(Math.abs(disp0[0] - 15) < 1e-4, `(f) 표시 X = 15mm — ${disp0[0].toFixed(4)}`);

  const rotations = [
    ["X축 89°", new Vector3(1, 0, 0), 89],
    ["Z축 95°", new Vector3(0, 0, 1), 95],
    ["Y축 -137°", new Vector3(0, 1, 0), -137],
    ["임의축 43°", new Vector3(0.3, 0.9, -0.2).normalize(), 43],
  ];
  for (const [label, axis, deg] of rotations) {
    const dq = Quaternion.RotationAxis(axis, d2r(deg));
    const t1 = rotateTransformAroundWorldPivot(t0, dq, new Vector3(...pivotOf(t0)));
    const drift = dist3(panelDisplay(t1), disp0);
    check(drift < 1e-4, `(f) ${label}: 축 변환을 얹어도 표시 불변 (B-12 보존, ${drift.toExponential(2)}mm)`);
  }

  // 입력 역환산 왕복 — 사용자가 표시값을 타이핑하는 경로 전체(TransformPanel applyPositionField 와 같은 순서).
  const t = { tx: 12.5, ty: -3.25, tz: 7.75, rx: 23, ry: -41, rz: 67, sx: 1.7, sy: 0.6, sz: 2.3 };
  const off = displayAnchorOffset(t, pivotOf(t));
  const typed = [3.5, -7.125, 12.25];
  const [tx, ty, tz] = fromDisplayPosition(A.fromDisplayAxes(typed), off);
  const nextT = { ...t, tx, ty, tz };
  const shown = A.toDisplayAxes(toDisplayPosition(nextT, off));
  const err = dist3(shown, typed);
  check(err < 1e-4, `(f) 타이핑 (${typed.join(", ")}) → 다시 표시 ${fmt(shown, 4)} (오차 ${err.toExponential(2)}mm)`);
  // 타이핑한 표시 Y 는 world Z(안쪽) 로 들어간다.
  const pivotWorldZ = tz + off[2];
  check(Math.abs(pivotWorldZ - typed[1]) < 1e-4, `(f) 타이핑한 표시 Y ${typed[1]} = 새 bbox 중심의 world Z ${pivotWorldZ.toFixed(4)}`);
}

// ── (e) 대조군 ───────────────────────────────────────────────────────────
/** 텍스트를 frontend/scripts 아래 임시 폴더에 써서 import 한다. */
async function importAxisVariant(tag, text) {
  const dir = fs.mkdtempSync(path.join(__dirname, ".tmp-verify-axis-display-"));
  const file = path.join(dir, `axis-display.${tag}.ts`);
  fs.writeFileSync(file, text, "utf8");
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
/** 현재 axis-display.ts 를 from → to 로 바꾼 사본을 import. 대상 문자열이 없으면 null. */
async function loadMutant(tag, edits) {
  let text = fs.readFileSync(AXIS_TS, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    if (!text.includes(from)) return null;
    text = text.split(from).join(to);
  }
  return importAxisVariant(tag, text);
}
/** git 기준 커밋의 옛 판. 못 꺼내거나 marker 가 없으면 null. */
async function loadGitOld(markers) {
  let text;
  try {
    text = execFileSync("git", ["show", `${OLD_COMMIT}:${OLD_REL}`], {
      cwd: FRONTEND,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
  if (!markers.every((m) => text.includes(m))) return null;
  return importAxisVariant("old", text);
}
/**
 * 대조군 판정: 결과에 실패가 있고, must 의 문구 각각을 담은 단언이 **실제로 실패**해야 통과.
 * (엉뚱한 단언만 깨지고 핵심 판정은 통과하는 변조를 놓치지 않게.)
 */
function expectFail(label, results, must) {
  const bad = results.filter((r) => !r.ok);
  const missing = must.filter((m) => !bad.some((r) => r.label.includes(m)));
  const ok = bad.length > 0 && missing.length === 0;
  const detail = missing.length > 0 ? ` — 실패해야 할 단언이 통과함: ${missing.join(" / ")}` : "";
  assert(ok, `[대조군] ${label} → 실패 ${bad.length}건 재현 (예: ${bad.find((r) => must.some((m) => r.label.includes(m)))?.label ?? bad[0]?.label ?? "—"})${detail}`);
}

async function sectionControls() {
  console.log("\n(e) 대조군:");
  const run = (A, sections) => sections.flatMap((s) => collect(s, A));

  // 0) 기준 — 실제 모듈은 대조군이 쓰는 절에서 실패 0건 (대조군 판정이 원본에서 새지 않는지).
  {
    const bad = run(REAL, [sectionBedCoords, sectionPhysical, sectionCompound]).filter((r) => !r.ok);
    assert(bad.length === 0, `[대조군 기준] 실제 모듈은 (b)·(c)·(d) 에서 실패 0건 (${bad.length})`);
  }

  // ① git 옛 판 — (x, −z, y) + quaternion 켤레.
  {
    const old = await loadGitOld(["return [v[0], -v[2], v[1]];", "qm.multiply(q).multiply(Quaternion.Inverse(qm))"]);
    if (!old) {
      assert(false, `[대조군] ① ${OLD_COMMIT}:${OLD_REL} 를 git 에서 꺼내지 못함 / 옛 매핑 문자열 없음`);
    } else {
      expectFail("① 옛 판 (x, −z, y)+quaternion 켤레 — (b) 표시 Y 부호", run(old, [sectionBedCoords]), [": 표시 Y + D/2 = 베드 Y", "world +Z(안쪽"]);
      expectFail("① 옛 판 — (c) Z 회전 방향", run(old, [sectionPhysical]), ["(c) 표시 Z +90°: 베드 (1,0,0)", "(c) 표시 Z −90°: 베드 (1,0,0)"]);
    }
  }

  // ② 회전을 성분 교환으로만 — 표시 = (−rx, −rz, −ry). 단축은 우연히 맞고 복합에서 틀린다.
  {
    const m = await loadMutant("swap-euler", [
      ["export function toDisplayEulerDeg(r: Vec3): Vec3 {\n", "export function toDisplayEulerDeg(r: Vec3): Vec3 {\n  return [-r[0], -r[2], -r[1]];\n"],
      ["export function fromDisplayEulerDeg(r: Vec3): Vec3 {\n", "export function fromDisplayEulerDeg(r: Vec3): Vec3 {\n  return [-r[0], -r[2], -r[1]];\n"],
    ]);
    if (!m) {
      assert(false, "[대조군] ② 성분 교환 — 변조 대상 문자열(toDisplayEulerDeg·fromDisplayEulerDeg 머리)이 소스에 없음");
    } else {
      const single = run(m, [sectionPhysical]).filter((r) => !r.ok && !r.label.includes("합성 순서"));
      assert(single.length === 0, `[대조군] ② 성분 교환은 단축 (c) ±90° 를 통과한다 (실패 ${single.length}건) — 단축만 검증하면 결함을 놓친다는 증거`);
      expectFail("② 성분 교환 — (d) 복합 회전", run(m, [sectionCompound]), ["(d) 복합"]);
    }
  }

  // ③ 반사 켤레를 한쪽만 — M·R (행만 교환). det −1 이라 회전이 아니다.
  {
    const m = await loadMutant("one-sided", [
      ["    r[0], r[2], r[1],\n    r[6], r[8], r[7],\n    r[3], r[5], r[4],\n", "    r[0], r[1], r[2],\n    r[6], r[7], r[8],\n    r[3], r[4], r[5],\n"],
    ]);
    if (!m) {
      assert(false, "[대조군] ③ 한쪽 켤레 — 변조 대상 문자열(conjugateBySwapYZ 본문)이 소스에 없음");
    } else {
      expectFail("③ 반사 켤레 한쪽만(M·R) — (d) 복합 회전", run(m, [sectionCompound]), ["(d) 복합"]);
    }
  }
}

async function main() {
  console.log("수치 패널 표시축 = STL·베드 좌표 검증 (반사 (x, z, y) + 회전 행렬 켤레)");
  for (const [title, section] of [
    ["(a) 위치·스케일 왕복", sectionRoundTrip],
    ["(b) 표시 = 베드 좌표 = STL 좌표", sectionBedCoords],
    ["(c) 회전의 물리 의미 (오른손)", sectionPhysical],
    ["(d) 복합 회전", sectionCompound],
    ["(f) B-12 회귀", sectionB12],
  ]) {
    console.log(`\n${title}:`);
    assertAll(collect(section, REAL));
  }
  await sectionControls();
  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
