// CHITUBOX 분석 학습 적용분 헤드리스 검증 (C-2 / C-3 / C-4).
//   순수 모듈만 직접 import 한다 (Babylon·React 무의존).
//
//   실행: npx tsx scripts/verify-chitubox-applied.mjs
//   근거: docs/판정_CHITUBOX분석_20260821.md
//
//   ★ 대조군 원칙 (프로젝트 규약, B-1 확립 / PR #43 교훈):
//     "잘 돌아간다"만 보이지 않는다. 각 절의 마지막에서 **수정 전 동작**이나
//     **일부러 망가뜨린 구현**을 같은 입력에 돌려, 이 스크립트가 실제로 그
//     결함을 잡아내는지 증명한다. 검증 스크립트가 배선보다 관대하면 결함이
//     그대로 통과한다(B-12 의 교훈).

import {
  checkBuildVolume,
  describeViolation,
  hasViolation,
} from "../src/features/v2/utils/build-volume.ts";
import {
  summarizeSupports,
  pillarSavingRatio,
  formatSupportSummary,
} from "../src/features/v2/support/support-stats.ts";

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
  }
}

const VOL = { widthMm: 200, depthMm: 130, heightMm: 160 };

/** AABB 헬퍼 — 중심(cx,cz)·바닥 y0 에 놓인 w×h×d 박스. */
function box(cx, y0, cz, w, h, d) {
  return {
    minX: cx - w / 2,
    maxX: cx + w / 2,
    minY: y0,
    maxY: y0 + h,
    minZ: cz - d / 2,
    maxZ: cz + d / 2,
  };
}

// ── §1. C-2 볼륨 안 = 위반 없음 ────────────────────────────────────────────
console.log("\n§1. 출력영역 안 (위반 없어야 함)");
{
  const v = checkBuildVolume(box(0, 0, 0, 50, 40, 50), VOL);
  assert(!hasViolation(v), "중앙 50×40×50 박스는 위반 없음");
  assert(describeViolation(v) === null, "문구는 null");
}

// ── §2. C-2 축별 이탈 검출 ────────────────────────────────────────────────
console.log("\n§2. 축별 이탈");
{
  // X+ 로 밀어 오른쪽 벽을 넘김 (half = 100).
  const v = checkBuildVolume(box(90, 0, 0, 50, 40, 50), VOL);
  assert(v.maxX && !v.minX, "X+ 초과만 검출");
  assert(!v.minZ && !v.maxZ, "Z 는 정상");
  assert((describeViolation(v) ?? "").includes("X"), "문구에 X 포함");
}
{
  const v = checkBuildVolume(box(-90, 0, 0, 50, 40, 50), VOL);
  assert(v.minX && !v.maxX, "X− 초과만 검출");
}
{
  // Z 는 half = 65.
  const v = checkBuildVolume(box(0, 0, 60, 50, 40, 50), VOL);
  assert(v.maxZ, "Z+ 초과 검출");
  // 표시 좌표계(B-13)에서 내부 Z = 표시 Y 라 문구는 "Y" 여야 한다.
  assert(
    (describeViolation(v) ?? "").includes("Y"),
    "문구는 표시축 규약대로 Y 로 적힌다 (내부 Z = 표시 Y)",
  );
}
{
  const v = checkBuildVolume(box(0, 0, 0, 50, 200, 50), VOL);
  assert(v.aboveMax, "높이 초과 검출 (200 > 160)");
  assert((describeViolation(v) ?? "").includes("높이"), "문구에 높이 포함");
}
{
  const v = checkBuildVolume(box(0, -5, 0, 50, 40, 50), VOL);
  assert(v.belowPlate, "플레이트 아래 파고듦 검출");
  assert(
    (describeViolation(v) ?? "").includes("플레이트 아래"),
    "문구에 플레이트 아래 포함",
  );
}

// ── §3. C-2 경계 정확히 걸침 = 위반 아님 (오탐 방지) ──────────────────────
console.log("\n§3. 경계 정확히 걸침 (오탐이면 안 됨)");
{
  // 폭 200 짜리를 정중앙에 = minX -100, maxX +100 = 경계와 정확히 같음.
  const v = checkBuildVolume(box(0, 0, 0, 200, 40, 130), VOL);
  assert(!hasViolation(v), "플레이트에 딱 맞춘 배치는 경고하지 않는다");
}
{
  const v = checkBuildVolume(box(0, 0, 0, 50, 160, 50), VOL);
  assert(!v.aboveMax, "높이가 정확히 상한이면 위반 아님");
}

// ── §4. C-2 heightMm <= 0 이면 높이 검사 생략 ─────────────────────────────
console.log("\n§4. 높이 미설정(0) 처리");
{
  const v = checkBuildVolume(box(0, 0, 0, 50, 9999, 50), {
    ...VOL,
    heightMm: 0,
  });
  assert(!v.aboveMax, "heightMm=0 이면 높이 검사 안 함");
  assert(!hasViolation(v), "가로·세로가 정상이면 전체도 정상");
}

// ── §5. C-2 대조군 — 경계 판정을 '>=' 로 망가뜨리면 §3 이 걸리는가 ────────
console.log("\n§5. [대조군] 경계 판정 변조가 이 스크립트에 걸리는가");
{
  // 변조 구현: eps 없이 >= 로 비교 (경계 걸침을 위반으로 오탐).
  const brokenMaxX = (aabb, vol) => aabb.maxX >= vol.widthMm / 2;
  const flush = box(0, 0, 0, 200, 40, 130);
  const brokenSaysViolation = brokenMaxX(flush, VOL);
  const realSaysViolation = checkBuildVolume(flush, VOL).maxX;
  assert(
    brokenSaysViolation === true && realSaysViolation === false,
    "변조(>=)는 딱 맞춘 배치를 오탐하고, 현행 구현은 오탐하지 않는다",
  );
}

// ── §6. C-4 통계 — 기본 집계 ──────────────────────────────────────────────
console.log("\n§6. 서포트 통계 집계");
function pt(kind, routeKind, extra = {}) {
  return {
    id: Math.random().toString(36).slice(2),
    projectId: "p",
    stlId: "s",
    contact: [0, 10, 0],
    base: [0, 0, 0],
    source: "auto",
    addedAt: 0,
    kind,
    routeKind,
    ...extra,
  };
}
{
  const s = summarizeSupports([]);
  assert(s.total === 0 && s.mainPillar === 0, "빈 목록은 전부 0");
  assert(formatSupportSummary(s) === "서포트 없음", "빈 목록 문구");
}
{
  const pts = [
    pt("island", "vertical"),
    pt("island", "vertical"),
    pt("slope", "bent"),
    pt("slope", "joinPillar"),
    pt("slope", "joinPillar"),
    pt("island", "anchor"),
  ];
  const s = summarizeSupports(pts);
  assert(s.total === 6, "전체 6");
  assert(s.contact === 6, "접점 6 (점 하나가 접점 하나)");
  assert(s.island === 3 && s.slope === 3, "출처별 아일랜드 3 · 경사 3");
  assert(s.joined === 2, "합류 2");
  assert(s.anchored === 1, "앵커 1");
  assert(s.bent === 1, "경사우회 1");
  // 기둥 = vertical 2 + bent 1 = 3. 합류·앵커는 자기 기둥이 없다.
  assert(
    s.mainPillar === 3,
    "기둥 3 — 합류/앵커는 기둥을 세우지 않는다 (Contact ≠ Trunk 1:1)",
  );
}

// ── §7. C-4 routeKind undefined = vertical (하위 호환 규약) ───────────────
console.log("\n§7. routeKind 미지정 하위 호환");
{
  const s = summarizeSupports([pt("island", undefined)]);
  assert(
    s.mainPillar === 1 && s.joined === 0,
    "routeKind undefined 는 수직 기둥으로 센다 (types.ts 규약과 일치)",
  );
}

// ── §8. C-4 레거시 점 분리 ────────────────────────────────────────────────
console.log("\n§8. 레거시(비재설계) 점 분리");
{
  const legacy = {
    id: "L",
    projectId: "p",
    stlId: "s",
    contact: [0, 5, 0],
    base: [0, 0, 0],
    source: "manual",
    addedAt: 0,
    // kind 없음 → 레거시
  };
  const s = summarizeSupports([legacy, pt("island", "vertical")]);
  assert(s.legacy === 1, "레거시 1건 분리 집계");
  assert(s.island === 1, "재설계 출처 집계에는 레거시가 섞이지 않는다");
  assert(
    s.contact === 2 && s.mainPillar === 2,
    "레거시도 화면에 보이는 기둥이라 접점·기둥 합계에는 포함",
  );
}

// ── §9. C-4 기둥 절감률 ───────────────────────────────────────────────────
console.log("\n§9. 기둥 절감률");
{
  // 기둥 1 + 합류 3 → 원래 4개 세울 것을 1개로 = 75% 절감.
  const pts = [
    pt("island", "vertical"),
    pt("slope", "joinPillar"),
    pt("slope", "joinPillar"),
    pt("slope", "joinPillar"),
  ];
  const s = summarizeSupports(pts);
  const ratio = pillarSavingRatio(s);
  assert(
    Math.abs(ratio - 0.75) < 1e-9,
    `절감률 75% (실측 ${(ratio * 100).toFixed(1)}%)`,
  );
}
{
  const s = summarizeSupports([pt("island", "vertical")]);
  assert(pillarSavingRatio(s) === 0, "합류가 없으면 절감률 0 (0 나눗셈 없음)");
}

// ── §10. C-4 대조군 — "합류도 기둥으로 세는" 변조가 걸리는가 ──────────────
console.log("\n§10. [대조군] 합류를 기둥으로 세는 변조가 걸리는가");
{
  const pts = [
    pt("island", "vertical"),
    pt("slope", "joinPillar"),
    pt("slope", "joinPillar"),
  ];
  // 변조 구현: routeKind 를 무시하고 점 수 = 기둥 수 (Contact 1:1 Trunk).
  const brokenMainPillar = pts.length; // 3
  const realMainPillar = summarizeSupports(pts).mainPillar; // 1
  assert(
    brokenMainPillar === 3 && realMainPillar === 1,
    "변조(1:1)는 기둥 3 이라 하고, 현행은 1 — 기둥 공유 효과가 통계에 드러난다",
  );
}

// ── 결과 ──────────────────────────────────────────────────────────────────
console.log(
  failed === 0
    ? "\n✅ 전체 통과"
    : `\n❌ 실패 ${failed}건`,
);
process.exit(failed === 0 ? 0 : 1);
