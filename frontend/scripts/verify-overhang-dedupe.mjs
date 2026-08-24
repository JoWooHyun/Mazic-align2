// 오버행 점 전역 3D 중복 제거 헤드리스 검증 (B-22).
//   place-points.ts(순수, Babylon 무의존)를 tsx 로 직접 import 한다.
//
//   실행: npx tsx scripts/verify-overhang-dedupe.mjs
//   근거: docs/진단_서포트과다_20260824.md
//
//   무엇을 확인하는가:
//     리드 실물 지적 "서포트 아직도 너무많다"의 주범 — 오버행 점 중복 제거가
//     **층 하나 안에서만** 돌아, 같은 XZ 라도 층이 다르면 점이 따로 남던 것.
//     이제 전체 층에 걸친 3D 격자로 한 번에 거른다.
//
//   ★ 대조군 원칙 (프로젝트 규약, B-1 확립):
//     "줄었다"만 보이지 않는다. §3 에서 **수정 전 동작**(층별 XZ dedupe)을 같은
//     입력에 돌려 점이 층 수만큼 쌓이던 것을 실측하고, §5 에서 "Y 를 무시하고
//     XZ 로만 뭉개는" 과잉 수정이 **별개 오버행을 잃는다**는 것을 보인다.
//     즉 현행 구현이 두 극단 사이의 옳은 지점임을 증명한다.

import { placeSupportPoints } from "../src/features/v2/support/detect/place-points.ts";

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
  }
}

const PARAMS = {
  tipRadiusMm: 0.2,
  smallAreaMm2: 1.0,
  elongatedAspect: 3.0,
  fillSpacingMm: 3.0,
  overhangSpacingMm: 3.0,
  verticalSpacingMm: 3.0,
};

/** 층 nLayers 개에 걸쳐 **같은 XZ 자리**에 오버행이 잡힌 검출 결과를 만든다. */
function verticalWall(nLayers, lh, xz = [0, 0]) {
  const overhangs = [];
  for (let i = 0; i < nLayers; i++) {
    overhangs.push({ y: i * lh, points: [xz] });
  }
  return {
    stlId: "s",
    islands: [],
    overhangs,
    nLayers,
    layerHeight: lh,
    islandFloorY: 0,
  };
}

// ── §1. 수직 누적이 실제로 줄어드는가 ─────────────────────────────────────
console.log("\n§1. 같은 자리에 층마다 잡힌 오버행 (핵심 시나리오)");
{
  const lh = 0.05;
  const nLayers = 240; // 12mm / 0.05mm — 리드 모델 규모
  const detect = verticalWall(nLayers, lh);
  const pts = placeSupportPoints(detect, "p", PARAMS);

  // 높이 범위 = 240 × 0.05 = 12mm. 수직 간격 3mm → 이론상 약 5개(0,3,6,9,12).
  assert(
    pts.length <= 6,
    `240층 같은 자리 → ${pts.length}점 (수직 3mm 간격이면 5개 안팎)`,
  );
  assert(pts.length >= 4, `너무 줄지도 않았다 (${pts.length}점 ≥ 4)`);

  // 남은 점들이 실제로 수직으로 벌어져 있는가.
  const ys = pts.map((p) => p.contact[1]).sort((a, b) => a - b);
  let minGap = Infinity;
  for (let i = 1; i < ys.length; i++) minGap = Math.min(minGap, ys[i] - ys[i - 1]);
  assert(
    minGap >= PARAMS.verticalSpacingMm - 1e-6,
    `남은 점들의 최소 수직 간격 ${minGap.toFixed(2)}mm ≥ ${PARAMS.verticalSpacingMm}mm`,
  );
}

// ── §2. 수평 중복 제거는 그대로 동작하는가 ────────────────────────────────
console.log("\n§2. 같은 층 안 수평 중복 (종전 동작 보존)");
{
  const detect = {
    stlId: "s",
    islands: [],
    // 한 층에 **같은 3mm 셀 안**에 몰린 점 5개 + 멀리 떨어진 점 1개.
    //   ⚠️ 좌표를 한 셀 내부(1.0~2.9)로 잡는다. 0 근처에 두면 음수 좌표가
    //   이웃 셀(-1)로 가서 별개 취급되는데, 이는 격자 방식의 본질적 성질이지
    //   결함이 아니다(round 를 써도 경계에 걸친 점은 갈린다).
    overhangs: [
      {
        y: 5,
        points: [
          [1.0, 1.0],
          [1.5, 1.2],
          [2.0, 1.8],
          [2.5, 2.5],
          [2.9, 2.9],
          [20, 20],
        ],
      },
    ],
    nLayers: 1,
    layerHeight: 0.05,
    islandFloorY: 0,
  };
  const pts = placeSupportPoints(detect, "p", PARAMS);
  assert(pts.length === 2, `몰린 5점 → 1점, 먼 1점 유지 = 총 ${pts.length}점`);
}

// ── §3. [대조군] 수정 전 동작(층별 XZ dedupe)은 얼마나 많았나 ────────────
console.log("\n§3. [대조군] 수정 전 구현을 같은 입력에 돌리면");
{
  const lh = 0.05;
  const nLayers = 240;
  const detect = verticalWall(nLayers, lh);

  // 수정 전 구현 재현: 층마다 seen 을 새로 만들어 XZ 로만 dedupe.
  const step = PARAMS.overhangSpacingMm;
  let oldCount = 0;
  for (const oh of detect.overhangs) {
    const seen = new Set();
    for (const [x, z] of oh.points) {
      const key = `${Math.round(x / step)},${Math.round(z / step)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      oldCount++;
    }
  }
  const newCount = placeSupportPoints(detect, "p", PARAMS).length;

  assert(
    oldCount === nLayers,
    `수정 전: 층마다 1점씩 그대로 = ${oldCount}점 (층 수와 같다 — 누적 증명)`,
  );
  assert(
    newCount < oldCount / 10,
    `수정 후: ${newCount}점 — ${(100 - (newCount / oldCount) * 100).toFixed(1)}% 감소`,
  );
}

// ── §4. 높이가 다른 별개 오버행은 살아남는가 (과잉 수정 방지) ────────────
console.log("\n§4. 높이가 다른 별개 오버행은 유지되어야 한다");
{
  const detect = {
    stlId: "s",
    islands: [],
    overhangs: [
      { y: 1, points: [[0, 0]] }, // 아래쪽 돌출부
      { y: 20, points: [[0, 0]] }, // 같은 XZ 지만 **한참 위**의 다른 돌출부
    ],
    nLayers: 2,
    layerHeight: 0.05,
    islandFloorY: 0,
  };
  const pts = placeSupportPoints(detect, "p", PARAMS);
  assert(
    pts.length === 2,
    `같은 XZ 라도 높이가 19mm 차이면 둘 다 유지 (${pts.length}점)`,
  );
}

// ── §5. [대조군] Y 를 무시하고 XZ 로만 뭉개면 무엇을 잃는가 ──────────────
console.log("\n§5. [대조군] Y 를 격자에서 빼는 과잉 수정의 폐해");
{
  // §4 와 같은 입력을 "XZ 로만" 뭉개면 1점만 남는다 = 위쪽 돌출부가 안 받쳐진다.
  const step = PARAMS.overhangSpacingMm;
  const seen = new Set();
  let xzOnlyCount = 0;
  for (const oh of [
    { y: 1, points: [[0, 0]] },
    { y: 20, points: [[0, 0]] },
  ]) {
    for (const [x, z] of oh.points) {
      const key = `${Math.round(x / step)},${Math.round(z / step)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      xzOnlyCount++;
    }
  }
  assert(
    xzOnlyCount === 1,
    "XZ 로만 뭉개면 1점 — **위쪽 돌출부를 잃는다**(이래서 Y 를 격자에 넣었다)",
  );
}

// ── §6. 아일랜드 경로는 무변경인가 (무회귀) ──────────────────────────────
console.log("\n§6. 아일랜드 경로 무회귀");
{
  const detect = {
    stlId: "s",
    islands: [
      {
        y: 3,
        polygon: [
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
        ],
        centroid: [0, 0],
        bbox: [-0.5, -0.5, 0.5, 0.5],
        area: 1.0, // smallAreaMm2 경계 → 중심 1점
      },
    ],
    overhangs: [],
    nLayers: 1,
    layerHeight: 0.05,
    islandFloorY: 0,
  };
  const pts = placeSupportPoints(detect, "p", PARAMS);
  assert(pts.length === 1, "작은 아일랜드는 여전히 중심 1점");
  assert(pts[0].kind === "island", "kind='island' 유지");
  assert(
    Math.abs(pts[0].contact[1] - 3) < 1e-9,
    "아일랜드 접점 Y = 검출된 층 Y 유지",
  );
}

// ── §7. verticalSpacingMm 미지정 시 폴백 ─────────────────────────────────
console.log("\n§7. verticalSpacingMm 미지정 → overhangSpacingMm 으로 폴백");
{
  const { verticalSpacingMm, ...noVertical } = PARAMS;
  void verticalSpacingMm;
  const detect = verticalWall(100, 0.05);
  const a = placeSupportPoints(detect, "p", noVertical).length;
  const b = placeSupportPoints(
    detect,
    "p",
    { ...noVertical, verticalSpacingMm: PARAMS.overhangSpacingMm },
  ).length;
  assert(a === b, `미지정(${a}점) == 명시(${b}점) — 폴백 동작`);
}

// ── §8. 결정성 ────────────────────────────────────────────────────────────
console.log("\n§8. 결정성");
{
  const detect = verticalWall(120, 0.05);
  const a = placeSupportPoints(detect, "p", PARAMS).map((p) => p.contact.join(","));
  const b = placeSupportPoints(detect, "p", PARAMS).map((p) => p.contact.join(","));
  assert(JSON.stringify(a) === JSON.stringify(b), "같은 입력 2회 → 동일 출력");
}

console.log(failed === 0 ? "\n✅ 전체 통과" : `\n❌ 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
