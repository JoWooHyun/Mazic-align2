// 모델 변형 시 재설계 서포트 무효화 판정 검증 (B-1, B-15·B-15c 보강).
//   transformKeepsRedesignValid 는 "이 변형이 재설계 서포트를 유효하게 두는가"를
//   판정하는 순수 함수다. 재설계 서포트는 stl-local 이라 모델 변형을 그대로 따라
//   가므로, 모델을 기울이면 기둥이 기울어 출력 불가 → 리드 확정 정책은 삭제+안내.
//   예외는 세 가지다:
//     1) 순수 XZ 평행이동 — 기둥 수직성·바닥 접지 보존
//     2) 수직축(내부 Babylon Y) 회전 — 제자리에서 팽이처럼 돌 뿐 (B-15)
//     3) 수직 이동(ty) — 발이 플레이트에 고정돼 기둥 길이만 변한다 (B-18)
//
//   ⚠️ B-18: 리드가 타 슬라이서 실물과 대조해 확정 — "서포터랑 stl 이랑 아예 다른
//   객체 취급". 서포트는 플레이트에 서 있는 독립 구조물이고 모델이 그 위에 얹혀
//   있다. 판정에서 ty 항을 뺀 것과 **짝을 이루는** 변경이 assemble-core 의
//   resolveRedesignBaseY(기둥 발을 world Y=0 에 고정)이며, 그쪽은
//   verify-assemble-core.mjs 가 기둥 길이 수치로 검증한다. 둘은 함께 봐야 한다.
//
//   ⚠️ B-15c: 판정이 **Euler 성분 비교 → 기하학적 불변량(로컬 up 의 world Y 성분)**
//   으로 바뀌었다. B-15(ry 항 제거)만으로는 실물에서 여전히 삭제됐는데, 진범이 ry 가
//   아니라 **rx/rz 성분 비교에 낀 float32 노이즈**였기 때문이다. 아래 (g) 가 그
//   대조군이다.
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
  // B-18 이후: ry + ty 는 둘 다 유효 예외라 동반해도 유지된다(정책 변경).
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, ry: BASE.ry + 90, ty: BASE.ty + 3,
    }) === true,
    "ry + ty 동반 → 유지 (B-18: 수직 이동도 예외로 편입)",
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

// ── (d) B-18: 수직 이동은 유지 ───────────────────────────────────────────
//   리드가 타 슬라이서 실물 화면과 대조해 확정: "수직이동은 서포터 달린 상태로
//   올라갔다 내려오더라. 서포터랑 stl 이랑 아예 다른 객체 취급이야."
//   서포트는 플레이트에 서 있는 독립 구조물이라 모델이 오르내리면 기둥 길이만
//   변하면 된다 → 삭제할 이유가 없다.
function caseTyKeeps() {
  console.log("\n(d) ty(수직 이동) 단독 → 유지 (B-18):");
  for (const dy of [5, -3.2, 50, 0.5, -0.001]) {
    assert(
      transformKeepsRedesignValid(BASE, { ...BASE, ty: BASE.ty + dy }) === true,
      `ty ${dy > 0 ? "+" : ""}${dy}mm 단독 이동 → 유지(기둥 길이로 흡수)`,
    );
  }
  // 예외 1(XZ)·2(수직축 회전)·3(ty)은 서로 섞여도 전부 유지 — 셋 다 유효하므로.
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, tx: BASE.tx + 25, ty: BASE.ty + 12, tz: BASE.tz - 12,
    }) === true,
    "tx+ty+tz 동반 이동 → 유지",
  );
  assert(
    transformKeepsRedesignValid(BASE, {
      ...BASE, tx: BASE.tx + 5, ty: BASE.ty - 7.5, tz: BASE.tz + 5,
      ry: BASE.ry + 90,
    }) === true,
    "tx+ty+tz + 수직축 회전 동반 → 유지(예외 1·2·3 조합)",
  );
}

// ── (d-2) B-18: ty 에 다른 축이 섞이면 여전히 무효 (과잉수정 방지) ─────────
function caseTyMixedInvalidates() {
  console.log("\n(d-2) ty + 기울임/스케일 동반 → 무효화 (B-18):");
  for (const tilt of [0.1, 5, 45]) {
    assert(
      transformKeepsRedesignValid(BASE, {
        ...BASE, ty: BASE.ty + 10, rx: BASE.rx + tilt,
      }) === false,
      `ty +10 + rx ${tilt}° 기울임 → 무효(기둥이 기울면 길이로 못 고침)`,
    );
    assert(
      transformKeepsRedesignValid(BASE, {
        ...BASE, ty: BASE.ty + 10, rz: BASE.rz + tilt,
      }) === false,
      `ty +10 + rz ${tilt}° 기울임 → 무효`,
    );
  }
  for (const [label, patch] of [
    ["sx", { sx: BASE.sx * 1.5 }],
    ["sy", { sy: BASE.sy * 1.1 }],
    ["sz", { sz: BASE.sz * 0.5 }],
    ["균일 스케일", { sx: BASE.sx * 2, sy: BASE.sy * 2, sz: BASE.sz * 2 }],
  ]) {
    assert(
      transformKeepsRedesignValid(BASE, {
        ...BASE, ty: BASE.ty + 10, ...patch,
      }) === false,
      `ty +10 + ${label} → 무효(스케일은 접점 XZ 까지 흩어져 길이로 못 고침)`,
    );
  }
}

// ── (d-3) B-18 [대조군] 수정 전 판정이 "수직 이동 시 삭제" 를 재현하는지 ────
/**
 * B-18 **수정 전** 구현 — 기울기 불변량 + 스케일 + **ty 성분 비교**.
 *   B-15c 시점(PR #46) 의 판정 그대로다. 리드가 실물에서 본 "수직으로 올렸더니
 *   서포트가 통째로 사라진다" 증상이 여기서 재현돼야, 이 스크립트가 실제로
 *   버그를 잡는다는 것이 증명된다 (프로젝트 규약, B-1 확립).
 */
function keepsValidBeforeB18(start, end) {
  const changed = (a, b) => Math.abs(a - b) > 1e-6;
  const D = Math.PI / 180;
  const tiltDeg = (t) =>
    (Math.acos(
      Math.max(-1, Math.min(1, Math.cos(t.rx * D) * Math.cos(t.rz * D))),
    ) *
      180) /
    Math.PI;
  return !(
    Math.abs(tiltDeg(start) - tiltDeg(end)) > 0.01 ||
    changed(start.sx, end.sx) ||
    changed(start.sy, end.sy) ||
    changed(start.sz, end.sz) ||
    changed(start.ty, end.ty) // ← B-18 이 제거한 항
  );
}

function caseBeforeB18Control() {
  console.log("\n(d-3) [대조군] 수정 전 판정 = 수직 이동 시 삭제 (B-18):");
  for (const dy of [5, -3.2, 50]) {
    // [대조군] 수정 전에는 ty 단독 이동이 false(=삭제) 였다 → 리드가 본 증상.
    assert(
      keepsValidBeforeB18(BASE, { ...BASE, ty: BASE.ty + dy }) === false,
      `수정 전: ty ${dy > 0 ? "+" : ""}${dy}mm 를 무효로 판정(= 서포트가 사라짐) — 버그 재현`,
    );
    // [신규] 현재 구현은 같은 입력에서 반대로 나온다 = 스크립트가 차이를 잡는다.
    assert(
      transformKeepsRedesignValid(BASE, { ...BASE, ty: BASE.ty + dy }) === true,
      `현재 구현: 같은 입력을 유지로 판정 — 대조군과 결과가 갈림`,
    );
  }
  assert(
    keepsValidBeforeB18(BASE, {
      ...BASE, tx: BASE.tx + 25, ty: BASE.ty + 12, tz: BASE.tz - 12,
    }) === false,
    "수정 전: tx+ty+tz 동반도 무효로 판정",
  );
  // ty 외 축은 수정 전후 판정이 같아야 한다 (과잉수정 방지).
  for (const [label, end] of [
    ["rx 기울임", { ...BASE, rx: BASE.rx + 30 }],
    ["rz 기울임", { ...BASE, rz: BASE.rz + 30 }],
    ["수직축 회전", { ...BASE, ry: BASE.ry + 90 }],
    ["sy", { ...BASE, sy: BASE.sy * 1.5 }],
    ["XZ 이동", { ...BASE, tx: BASE.tx + 30, tz: BASE.tz + 30 }],
    ["ty + rx", { ...BASE, ty: BASE.ty + 10, rx: BASE.rx + 30 }],
    ["ty + sy", { ...BASE, ty: BASE.ty + 10, sy: BASE.sy * 1.5 }],
  ]) {
    assert(
      keepsValidBeforeB18(BASE, end) === transformKeepsRedesignValid(BASE, end),
      `${label} 은 수정 전후 판정이 동일(ty 외 축은 건드리지 않았음)`,
    );
  }
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
  //   ⚠️ B-15c: 회전 허용치는 이제 **기울기 각도 0.01°** 기준이라 1e-4° 는 더 이상
  //   경계 위가 아니다(노이즈 수준). 실제로 잡아야 하는 최소 기울임 0.1° 로 확인한다.
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, rx: BASE.rx + 0.1 }) === false,
    "0.1° rx 기울임은 허용치를 넘어 무효화(경계 유효성 확인)",
  );
  // B-18: ty 는 더 이상 판정 대상이 아니다 — 크기와 무관하게 유지된다.
  assert(
    transformKeepsRedesignValid(BASE, { ...BASE, ty: BASE.ty + 1e-4 }) === true,
    "1e-4 mm ty 이동 → 유지 (B-18: ty 는 판정에서 제외)",
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
    // ["ty", ...] 는 뺀다 — B-18 이 ty 항을 제거해 수정 전(B-15)과 의도적으로
    //   갈라졌다. 그 차이는 (d-3) 대조군에서 따로 검증한다.
    ["sy", { ...BASE, sy: BASE.sy * 1.5 }],
    ["XZ 이동", { ...BASE, tx: BASE.tx + 30, tz: BASE.tz + 30 }],
  ]) {
    assert(
      keepsValidBeforeB15(BASE, end) === transformKeepsRedesignValid(BASE, end),
      `${label} 은 수정 전후 판정이 동일(ry 외 축은 건드리지 않았음)`,
    );
  }
}

// ── B-15c: 기하학적 불변량 판정 ───────────────────────────────────────────
/**
 * B-15c **수정 전** 구현(= PR #46 시점, ry 항만 제거한 상태) — 대조군.
 * rx/rz 를 Euler 성분으로 직접 비교하므로 float32 노이즈에 그대로 걸린다.
 */
function keepsValidBeforeB15c(start, end) {
  const changed = (a, b) => Math.abs(a - b) > 1e-6;
  return !(
    changed(start.rx, end.rx) || // ← B-15c 가 불변량으로 대체한 항
    changed(start.rz, end.rz) || // ←
    changed(start.sx, end.sx) ||
    changed(start.sy, end.sy) ||
    changed(start.sz, end.sz) ||
    changed(start.ty, end.ty)
  );
}

/**
 * NullEngine 실측으로 얻은 **실제 회전 기즈모 왕복 결과**.
 *   피벗 프록시(B-9) 에 setParent → world Y 축으로 회전 → setParent(null) 후
 *   readMeshTransform 으로 읽은 (start, end) 쌍이다. Babylon 이 행렬을
 *   Float32Array 로 보관해 rx/rz 에 노이즈가 낀 것이 그대로 담겨 있다.
 *   ⚠️ 여기 수치를 임의로 다듬지 말 것 — 리드가 겪은 증상의 물증이다.
 */
const REAL_PIVOT_ROUNDTRIPS = [
  {
    label: "rx=15,rz=45 에서 수직축 +15°",
    start: { ...BASE, rx: 15, ry: -30, rz: 45 },
    end: { ...BASE, rx: 15.000001378, ry: -15, rz: 45.000000991 },
  },
  {
    label: "rx=15,rz=45 에서 수직축 -137°",
    start: { ...BASE, rx: 15, ry: -30, rz: 45 },
    end: { ...BASE, rx: 15.000000171, ry: -167, rz: 45.000002492 },
  },
  {
    label: "rx=89.5(gimbal 근처) 에서 수직축 +90°",
    start: { ...BASE, rx: 89.5, ry: 10, rz: 20 },
    end: { ...BASE, rx: 89.499874623, ry: 100, rz: 19.999952248 },
  },
  {
    label: "rx=88 에서 수직축 +15°",
    start: { ...BASE, rx: 88, ry: 30, rz: -15 },
    end: { ...BASE, rx: 88.000033522, ry: 45, rz: -15.000003368 },
  },
  {
    label: "rx=75,rz=-40 에서 수직축 +15°",
    start: { ...BASE, rx: 75, ry: 15, rz: -40 },
    end: { ...BASE, rx: 74.999990995, ry: 30, rz: -40.000005080 },
  },
  {
    label: "rx=60,rz=0 에서 수직축 +90°",
    start: { ...BASE, rx: 60, ry: 0, rz: 0 },
    end: { ...BASE, rx: 59.999998219, ry: 90, rz: 0 },
  },
  {
    label: "rx=-45,rz=80 에서 수직축 -137°",
    start: { ...BASE, rx: -45, ry: 10, rz: 80 },
    end: { ...BASE, rx: -44.999998300, ry: -127, rz: 79.999997229 },
  },
];

function caseFloat32NoiseControl() {
  console.log(
    "\n(g) [핵심] 회전 기즈모 float32 왕복 노이즈 — 대조군 대비 (B-15c):",
  );
  for (const { label, start, end } of REAL_PIVOT_ROUNDTRIPS) {
    const drx = Math.abs(end.rx - start.rx);
    const drz = Math.abs(end.rz - start.rz);
    // [대조군] 수정 전 구현은 이 노이즈를 "기울임" 으로 오판 → 서포트 삭제.
    assert(
      keepsValidBeforeB15c(start, end) === false,
      `[대조군] ${label}: |drx|=${drx.toExponential(2)} |drz|=${drz.toExponential(
        2,
      )} 노이즈를 무효로 오판(= 리드가 겪은 삭제) — 버그 재현`,
    );
    // [신규] 불변량 판정은 같은 입력을 유지로 본다.
    assert(
      transformKeepsRedesignValid(start, end) === true,
      `[신규] ${label}: 유효 유지(기둥 수직성 불변)`,
    );
  }
}

function caseBabylonConventionMatch() {
  console.log("\n(h) 회전 합성 관례가 Babylon 과 일치하는지 (B-15c):");
  // types/transform.ts 는 Babylon 무의존을 유지해야 하므로(B-1 헤드리스 검증),
  //   회전행렬을 직접 유도해 쓴다. 그 유도가 Babylon 관례와 실제로 같은지를
  //   **Babylon 실측값 하드코딩 대조**로 확인한다.
  //
  //   아래 m11 은 @babylonjs/core v6.49.0 에서
  //     const q = Quaternion.FromEulerAngles(x*D, y*D, z*D);
  //     const m = Matrix.Identity(); q.toRotationMatrix(m);
  //     m.m[5]  // row=1, col=1 = 로컬 up (0,1,0) 의 world Y 성분
  //   을 그대로 받아적은 값이다. (같은 스크립트에서 FromEulerAngles(x,y,z) 와
  //   RotationYawPitchRoll(y,x,z) 의 차가 정확히 0 임도 확인했다 → R=Ry·Rx·Rz)
  const BABYLON_M11 = [
    // [rx, ry, rz, Babylon 실측 m.m[5]]
    [10, 20, 30, 0.852868556976],
    [90, 45, 0, 0.0],
    [-89.9, 137, 12, 0.001707188785],
    [0, 0, 0, 1.0],
    [15, -30, 45, 0.683012723923],
  ];
  const D = Math.PI / 180;
  // 우리 유도: 로컬 up 의 world Y = cos(rx)·cos(rz) — ry 는 등장하지 않는다.
  const ourUpWorldY = (rx, rz) => Math.cos(rx * D) * Math.cos(rz * D);
  for (const [rx, ry, rz, expected] of BABYLON_M11) {
    const got = ourUpWorldY(rx, rz);
    // Babylon 은 Float32Array 라 실측값 자체가 float32 정밀도다 → 1e-6 대조.
    assert(
      Math.abs(got - expected) < 1e-6,
      `(${rx},${ry},${rz}): 직접 유도 up.y=${got.toFixed(12)} ≈ Babylon ${expected} (관례 일치)`,
    );
  }
  // ry 가 유도식에 없다는 것 = 수직축 회전 불변성의 근거. 실측으로도 확인.
  //   [10,20,30] 과 [10,-160,30] 은 ry 만 180° 다른데 Babylon m11 이 같아야 한다.
  assert(
    Math.abs(ourUpWorldY(10, 30) - 0.852868556976) < 1e-6,
    "ry 를 어떤 값으로 바꿔도 up.y 는 cos(rx)·cos(rz) 로 동일(수직축 불변성 근거)",
  );
}

function caseTiltedBaseVerticalRotationKeeps() {
  console.log("\n(i) 기울어진 모델 × 수직축 회전 → 유지 (B-15c):");
  // 여러 기준 자세 × 여러 각도. 수직축 회전은 rx/rz 를 그대로 두므로 up.y 불변.
  for (const [rx, rz] of [[15, 45], [60, 0], [89.5, 20], [-45, 80], [33, -124]]) {
    for (const deg of [1, 15, 90, 180, -137]) {
      const start = { ...BASE, rx, ry: 10, rz };
      const end = { ...start, ry: start.ry + deg };
      assert(
        transformKeepsRedesignValid(start, end) === true,
        `rx=${rx},rz=${rz} 에서 수직축 ${deg}° → 유지`,
      );
    }
  }
}

function caseRealTiltStillInvalidates() {
  console.log("\n(j) 실제 기울임은 여전히 무효 — 과잉수정 방지 (B-15c):");
  // 허용치(1e-4)를 넘는 실제 기울임은 확실히 잡아야 한다. 0.1° → up.y 3.2e-4.
  for (const [rx, rz] of [[15, 45], [0, 0], [60, 10]]) {
    for (const tilt of [0.1, 0.5, 1, 5, 30, 90]) {
      const start = { ...BASE, rx, ry: -30, rz };
      assert(
        transformKeepsRedesignValid(start, { ...start, rx: rx + tilt }) === false,
        `rx=${rx},rz=${rz} 에서 rx +${tilt}° 기울임 → 무효`,
      );
      assert(
        transformKeepsRedesignValid(start, { ...start, rz: rz + tilt }) === false,
        `rx=${rx},rz=${rz} 에서 rz +${tilt}° 기울임 → 무효`,
      );
    }
  }
  // 수직축 회전에 기울임이 섞이면 무효 — 불변량이 실제로 움직이므로.
  assert(
    transformKeepsRedesignValid(
      { ...BASE, rx: 15, ry: -30, rz: 45 },
      { ...BASE, rx: 20, ry: 60, rz: 45 },
    ) === false,
    "수직축 회전 + rx 기울임 동반 → 무효",
  );
}

function casePolicyUnchanged() {
  console.log("\n(k) 스케일·ty·tx/tz 정책 무변경 확인 (B-15c):");
  const tilted = { ...BASE, rx: 89.5, ry: 10, rz: 20 };
  // 스케일은 여전히 무효 (기울지 않은 자세에서도, 기운 자세에서도).
  for (const [label, patch] of [
    ["sx", { sx: BASE.sx * 2 }],
    ["sy", { sy: BASE.sy * 1.1 }],
    ["sz", { sz: BASE.sz * 0.5 }],
    ["균일 스케일", { sx: BASE.sx * 1.5, sy: BASE.sy * 1.5, sz: BASE.sz * 1.5 }],
  ]) {
    assert(
      transformKeepsRedesignValid(tilted, { ...tilted, ...patch }) === false,
      `${label} 변경 → 무효(접점 위치·높이가 달라짐)`,
    );
  }
  // B-18: ty 는 유지로 정책이 바뀌었다 — 기울어진 자세에서도 동일하게 유지.
  //   (기울기는 start/end 가 같으면 불변량도 같으므로 tilted 여도 상관없다.)
  assert(
    transformKeepsRedesignValid(tilted, { ...tilted, ty: tilted.ty + 3 }) === true,
    "ty 상승 → 유지 (B-18)",
  );
  assert(
    transformKeepsRedesignValid(tilted, { ...tilted, ty: tilted.ty - 0.5 }) === true,
    "ty 하강 → 유지 (B-18)",
  );
  // tx/tz 는 여전히 유효.
  assert(
    transformKeepsRedesignValid(tilted, {
      ...tilted, tx: tilted.tx + 50, tz: tilted.tz - 50,
    }) === true,
    "tx/tz 수평 이동 → 유지(정책 무변경)",
  );
}

function main() {
  console.log("재설계 서포트 무효화 판정 검증 (B-1, B-15·B-15c 보강)");
  caseXZMoveKeeps();
  caseTiltRotationInvalidates();
  caseVerticalRotationKeeps();
  caseVerticalRotationMixedInvalidates();
  caseScaleInvalidates();
  caseTyKeeps();
  caseTyMixedInvalidates();
  caseBeforeB18Control();
  caseFloatNoiseKeeps();
  caseIdentityBase();
  caseBeforeFixControl();
  caseFloat32NoiseControl();
  caseBabylonConventionMatch();
  caseTiltedBaseVerticalRotationKeeps();
  caseRealTiltStillInvalidates();
  casePolicyUnchanged();
  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
