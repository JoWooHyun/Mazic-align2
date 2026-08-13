// 모델 변형 시 재설계 서포트 무효화 판정 검증 (B-1, B-15 보강).
//   transformKeepsRedesignValid 는 "이 변형이 재설계 서포트를 유효하게 두는가"를
//   판정하는 순수 함수다. 재설계 서포트는 stl-local 이라 모델 변형을 그대로 따라
//   가므로, 모델을 기울이면 기둥이 기울어 출력 불가 → 리드 확정 정책은 삭제+안내.
//   예외는 두 가지 — 둘 다 "기둥 수직성 + 바닥 접지가 보존된다" 는 같은 논리다:
//     1) 순수 XZ 평행이동
//     2) 수직축(내부 Babylon Y = ry) 회전 — 제자리에서 팽이처럼 돌 뿐 (B-15)
//
//   ⚠️ ry/rx/rz 는 **내부 Babylon 축**이다. B-13 은 표시만 Z-up 으로 바꿨으므로
//   화면에 "Z축 회전" 으로 보이는 것이 여기의 ry 다.
//
//   Babylon 의존이 없는 types/transform.ts 의 함수라 node 에서 그대로 돌아간다.
//
//   실행: npx tsx scripts/verify-transform-invalidate.mjs

import {
  IDENTITY_TRANSFORM,
  transformKeepsRedesignValid,
} from "../src/features/v2/types/transform.ts";

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

/** 기준 transform — 항등이 아니라 "이미 놓여 있는" 상태에서 출발한다. */
const BASE = {
  tx: 10, ty: 4, tz: -6,
  rx: 15, ry: -30, rz: 45,
  sx: 1.2, sy: 1.2, sz: 1.2,
};

function caseXZMoveKeeps() {
  console.log("\n(a) 순수 XZ 평행이동 → 유지:");
  const moved = { ...BASE, tx: BASE.tx + 25, tz: BASE.tz - 12 };
  assert(
    transformKeepsRedesignValid(BASE, moved) === true,
    "tx/tz 만 변경 → 유효 유지(서포트 삭제 안 함)",
  );
  // 한 축만 움직여도 유지.
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, tx: BASE.tx + 100 }) === true,
    "tx 만 크게 이동해도 유지",
  );
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, tz: BASE.tz - 100 }) === true,
    "tz 만 크게 이동해도 유지",
  );
  // 아무것도 안 바뀐 경우도 당연히 유지.
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE }) === true,
    "변화 없음 → 유지",
  );
}

function caseTiltRotationInvalidates() {
  console.log("\n(b) 기울이는 회전(rx/rz) → 무효화:");
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, rx: BASE.rx + 90 }) === false,
    "rx 90° 회전 → 무효화",
  );
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, rz: BASE.rz - 0.5 }) === false,
    "rz 0.5° 미세 회전도 무효화(기둥이 기울므로)",
  );
  // XZ 이동을 같이 해도 기울임이 섞이면 무효.
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, tx: BASE.tx + 10, tz: BASE.tz + 10, rx: BASE.rx + 45,
    }) === false,
    "XZ 이동 + rx 동반 → 무효화",
  );
}

// ── (b-2) B-15: 수직축 회전은 유지 ────────────────────────────────────────
//   리드 실물 보고: "노란색 원(바닥과 수평인 링) 잡고 돌려도 서포트가 사라진다".
//   그 링이 수직축 둘레 회전이고, 모델은 제자리에서 팽이처럼 돌 뿐이라 기둥은
//   여전히 수직이다 → 삭제하면 안 된다.
function caseVerticalRotationKeeps() {
  console.log("\n(b-2) 수직축(ry) 단독 회전 → 유지 (B-15):");
  for (const deg of [90, -137, 5, 180, -0.5]) {
    assert(
      transformKeepsRedesignValid(BASE, { ...BASE, ry: BASE.ry + deg }) === true,
      `ry ${deg}° 단독 회전 → 유지(제자리 회전이라 기둥 수직성 보존)`,
    );
  }
  // 예외 1(XZ 이동)과 예외 2(수직축 회전)는 같이 와도 유지 — 둘 다 유효하므로.
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, tx: BASE.tx + 25, tz: BASE.tz - 12, ry: BASE.ry + 90,
    }) === true,
    "XZ 이동 + ry 회전 동반 → 유지",
  );
}

// ── (b-3) B-15: 수직축 회전에 다른 축이 섞이면 무효 ───────────────────────
//   함수가 changed() 의 OR 조합이라, 다른 축이 하나라도 바뀌면 그 항이 걸려
//   이미 false 가 된다. 별도 처리 없이 올바르게 동작하는지 확인한다.
function caseVerticalRotationMixedInvalidates() {
  console.log("\n(b-3) ry + 다른 축 동반 → 무효화 (B-15):");
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, ry: BASE.ry + 90, rx: BASE.rx + 10,
    }) === false,
    "ry + rx 동반 → 무효화(rx 가 기둥을 기울임)",
  );
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, ry: BASE.ry + 90, rz: BASE.rz + 10,
    }) === false,
    "ry + rz 동반 → 무효화",
  );
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, ry: BASE.ry + 90, ty: BASE.ty + 3,
    }) === false,
    "ry + ty 동반 → 무효화(바닥 접지 깨짐)",
  );
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, ry: BASE.ry + 90, sy: BASE.sy * 1.1,
    }) === false,
    "ry + sy 동반 → 무효화(접점 높이가 달라짐)",
  );
}

function caseScaleInvalidates() {
  console.log("\n(c) 스케일 → 무효화:");
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, sx: BASE.sx * 2 }) === false,
    "sx 배율 변경 → 무효화",
  );
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, sy: BASE.sy * 1.1 }) === false,
    "sy 배율 변경 → 무효화",
  );
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, sx: BASE.sx * 1.5, sy: BASE.sy * 1.5, sz: BASE.sz * 1.5,
    }) === false,
    "균일 스케일도 무효화(접점 위치가 달라짐)",
  );
}

function caseTyInvalidates() {
  console.log("\n(d) ty(수직 이동) → 무효화:");
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, ty: BASE.ty + 3 }) === false,
    "ty 상승 → 무효화(바닥 접지 깨짐)",
  );
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, ty: BASE.ty - 3 }) === false,
    "ty 하강 → 무효화",
  );
  // XZ 이동과 같이 와도 ty 가 섞이면 무효.
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, tx: BASE.tx + 5, ty: BASE.ty + 0.5, tz: BASE.tz + 5,
    }) === false,
    "XZ 이동 + ty 동반 → 무효화",
  );
}

function caseFloatNoiseKeeps() {
  console.log("\n(e) XZ 이동 + 부동소수 노이즈(1e-9) → 유지:");
  const noisy = {
    ...BASE,
    tx: BASE.tx + 20,
    tz: BASE.tz + 20,
    // 회전·스케일·ty 에 1e-9 급 노이즈. 실제 변형이 아니라 부동소수 반올림.
    rx: BASE.rx + 1e-9,
    ry: BASE.ry - 1e-9,
    rz: BASE.rz + 1e-9,
    sx: BASE.sx + 1e-9,
    sy: BASE.sy - 1e-9,
    sz: BASE.sz + 1e-9,
    ty: BASE.ty + 1e-9,
  };
  assert(
    transformKeepsRedesignValid(BASE, noisy) === true,
    "1e-9 노이즈는 무시하고 유지(허용치 1e-6)",
  );

  // 반대로 허용치를 넘는 변화는 확실히 잡는다 — 경계가 무의미하지 않음을 확인.
  //   ry 는 이제 축 자체가 유효 판정이므로 경계 확인에 못 쓴다 → rx 로 확인.
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, rx: BASE.rx + 1e-4 }) === false,
    "1e-4 rx 회전은 허용치를 넘어 무효화(경계 유효성 확인)",
  );
}

function caseIdentityBase() {
  console.log("\n(참고) 항등 기준에서도 동일 규칙:");
  assert(
    transformKeepsRedesignValid(IDENTITY_TRANSFORM, {
      ...IDENTITY_TRANSFORM, tx: 30, tz: -30,
    }) === true,
    "항등 → XZ 이동 유지",
  );
  assert(
    transformKeepsRedesignValid(IDENTITY_TRANSFORM, {
      ...IDENTITY_TRANSFORM, rx: 90,
    }) === false,
    "항등 → rx 회전 무효화",
  );
  assert(
    transformKeepsRedesignValid(IDENTITY_TRANSFORM, {
      ...IDENTITY_TRANSFORM, ry: 90,
    }) === true,
    "항등 → ry 회전 유지 (B-15)",
  );
}

// ── 대조군 ────────────────────────────────────────────────────────────────
/**
 * B-15 **수정 전** 구현 — rx/ry/rz 세 축을 모두 무효로 쳤다.
 * 이 스크립트가 실제로 버그를 잡는지 증명하기 위한 대조군(프로젝트 규약, B-1 확립).
 */
function keepsValidBeforeB15(start, end) {
  const changed = (a, b) => Math.abs(a - b) > 1e-6;
  return !(
    changed(start.rx, end.rx) ||
    changed(start.ry, end.ry) || // ← B-15 가 제거한 항
    changed(start.rz, end.rz) ||
    changed(start.sx, end.sx) ||
    changed(start.sy, end.sy) ||
    changed(start.sz, end.sz) ||
    changed(start.ty, end.ty)
  );
}

function caseBeforeFixControl() {
  console.log("\n(대조군) 수정 전 구현이면 수직축 회전에서 잘못 삭제된다:");
  // 수정 전에는 ry 단독 회전이 false(=삭제) 였다 → 리드가 본 그 증상.
  assert(
    keepsValidBeforeB15(BASE, { ...BASE, ry: BASE.ry + 90 }) === false,
    "수정 전: ry 90° 단독 회전을 무효로 판정(= 서포트가 사라짐) — 버그 재현",
  );
  assert(
    keepsValidBeforeB15(BASE, { ...BASE, ry: BASE.ry - 137 }) === false,
    "수정 전: ry -137° 도 무효로 판정",
  );
  assert(
    keepsValidBeforeB15(BASE, {
      ...BASE, tx: BASE.tx + 25, tz: BASE.tz - 12, ry: BASE.ry + 90,
    }) === false,
    "수정 전: XZ 이동 + ry 동반도 무효로 판정",
  );
  // 현재 구현은 같은 입력에서 반대로 나온다 = 스크립트가 차이를 실제로 잡는다.
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, ry: BASE.ry + 90 }) === true,
    "현재 구현: 같은 입력을 유지로 판정 — 대조군과 결과가 갈림(스크립트가 버그를 잡음)",
  );
  // 반대로 두 구현이 일치해야 하는 축들은 그대로 일치하는지도 확인 (과잉수정 방지).
  for (const [label, end] of [
    ["rx", { ...BASE, rx: BASE.rx + 30 }],
    ["rz", { ...BASE, rz: BASE.rz + 30 }],
    ["ty", { ...BASE, ty: BASE.ty + 2 }],
    ["sy", { ...BASE, sy: BASE.sy * 1.5 }],
    ["XZ 이동", { ...BASE, tx: BASE.tx + 30, tz: BASE.tz + 30 }],
  ]) {
    assert(
      keepsValidBeforeB15(BASE, end) === transformKeepsRedesignValid(BASE, end),
      `${label} 은 수정 전후 판정이 동일(ry 외 축은 건드리지 않았음)`,
    );
  }
}

function main() {
  console.log("재설계 서포트 무효화 판정 검증 (B-1, B-15 보강)");
  caseXZMoveKeeps();
  caseTiltRotationInvalidates();
  caseVerticalRotationKeeps();
  caseVerticalRotationMixedInvalidates();
  caseScaleInvalidates();
  caseTyInvalidates();
  caseFloatNoiseKeeps();
  caseIdentityBase();
  caseBeforeFixControl();
  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
