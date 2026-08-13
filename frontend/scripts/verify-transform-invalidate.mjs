// 모델 변형 시 재설계 서포트 무효화 판정 검증 (B-1).
//   transformKeepsRedesignValid 는 "이 변형이 재설계 서포트를 유효하게 두는가"를
//   판정하는 순수 함수다. 재설계 서포트는 stl-local 이라 모델 변형을 그대로 따라
//   가므로, 회전하면 기둥이 기울어 출력 불가 → 리드 확정 정책은 삭제+안내.
//   **순수 XZ 평행이동만 예외** — 수직성·바닥 접지가 보존되어 여전히 유효하다.
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

function caseRotationInvalidates() {
  console.log("\n(b) 회전 → 무효화:");
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, rx: BASE.rx + 90 }) === false,
    "rx 90° 회전 → 무효화",
  );
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, ry: BASE.ry + 5 }) === false,
    "ry 5° 회전 → 무효화",
  );
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, rz: BASE.rz - 0.5 }) === false,
    "rz 0.5° 미세 회전도 무효화(기둥이 기울므로)",
  );
  // XZ 이동을 같이 해도 회전이 섞이면 무효.
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, tx: BASE.tx + 10, tz: BASE.tz + 10, ry: BASE.ry + 45,
    }) === false,
    "XZ 이동 + 회전 동반 → 무효화",
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
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, ry: BASE.ry + 1e-4 }) === false,
    "1e-4 회전은 허용치를 넘어 무효화(경계 유효성 확인)",
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
    "항등 → 회전 무효화",
  );
}

function main() {
  console.log("재설계 서포트 무효화 판정 검증 (B-1)");
  caseXZMoveKeeps();
  caseRotationInvalidates();
  caseScaleInvalidates();
  caseTyInvalidates();
  caseFloatNoiseKeeps();
  caseIdentityBase();
  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
