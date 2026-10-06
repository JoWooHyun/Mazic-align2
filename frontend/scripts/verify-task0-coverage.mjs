// Task0 마스크 래스터 + 도포 커버리지 검사기 헤드리스 검증 (로드맵 0절 2주차 PR-1 Z1-b1).
//
//   무엇을: src/features/v2/utils/task0/ 의
//     task0-distance.ts (정확한 EDT) · task0-mask.ts (투사 프레임 래스터) · task0-coverage.ts (규격 §3 (a)(b)(c)(d)·넘침,
//     G-code → 도포 선분 추출) · task0-slice.ts (writer 와 공유하는 층 단면).
//     규격 = Task0 리포 docs/Task0_Gcode_규격서_초안.md v0.3.3 @ dfdf08c §1·§3·§11.
//     판정 정의의 출처 = docs/references/sim-coverage-20261002.py (문턱 99.9 %·0.75·w·w²·4-연결).
//
//   (1) EDT — 무작위 격자 수백 개(빈 격자·꽉 찬 격자·1×N 포함)를 무차별 계산과 비교: 불일치 0.
//   (2) 마스크·덮임
//       a. 무작위 폴리곤(오목·겹침·구멍, 프레임 가장자리에 걸친 것 포함) — 픽셀 중심마다 독립 감김수(Sunday)와
//          비교해 불일치 0, 프레임 밖 칸 0, 잘림 통계(clippedPixels)도 독립 계산과 같음, 'full' ↔ 'bbox' 같음.
//       b. 방향 — 비대칭 L 자: 손으로 계산한 픽셀 번호에서 흰/검정 (X·Y 뒤집힘이면 실패), 프레임 모서리 픽셀 중심.
//       c. 반열림 — 변이 픽셀 중심을 정확히 지날 때 베드 Y [lo, hi)·X [시작, 끝).
//       d. 덮임 표(선분 캡슐 칠하기) — 무작위 선분(수평·수직·사선·점)을 점-선분 거리 무차별 계산과 비교: 불일치 0.
//   (3) 시뮬레이션 재현 — sim-coverage-20261002.py 사례 1~7 × w 0.5·1.0 을 같은 형상·같은 경로로 만든다
//       (형상을 평행이동해 시뮬레이션 격자점 = 투사 픽셀 중심이 되게 맞춤 — 픽셀 위상까지 같다).
//       python 이 있으면 시뮬레이션을 실제로 돌려 출력과 대조(그 출력이 아래 박아 둔 기대값과 같은지도 확인),
//       없으면 박아 둔 기대값과 대조.
//       i.  분해 재현 — 우리 래스터 + 우리 덮임 표 + 우리 성분 라벨 + **시뮬레이션의 해석 침식(inside_er)** 으로
//           (a)(c)(d) 를 계산 → 시뮬레이션 출력과 인쇄 자릿수 안(± 0.0005 %, ± 0.005 mm²)에서 같아야 한다.
//       ii. 검사기 본체(checkTask0LayerCoverage) — 판정 (a)(c)(d) 가 시뮬레이션과 전부 같아야 한다.
//           (d) 는 침식을 안 쓰므로 i 와 값이 정확히 같아야 한다. (a)(c) 는 침식만 다르다(래스터 EDT − p/2 vs 해석 거리):
//           두 침식 집합의 차(띠)의 모든 픽셀이 해석 경계 거리 w/2 ± p 안에 있음을 확인하고,
//           허용 오차 = 인쇄 자릿수 + 그 띠가 바꿀 수 있는 양:
//             (a) 100·띠/침식 픽셀 수 % — 침식 집합에서 m 개 빼고 n 개 더하면 비율은 최대 (m+n)/새 침식 수 만큼 변한다(증명 가능한 상한).
//             (c) 띠 중 0.75w 밖 픽셀 수·p² — 덮인 띠 픽셀은 (c) 성분에 못 들어간다. 띠 픽셀이 두 성분을 잇는 병합은
//                 이 상한 밖이지만, 사례들의 띠는 경계를 따라 한 줄로 따로 놓여 병합이 없다.
//           (w 0.5 사례 4 는 0.6 mm 띠의 침식 영역이 픽셀 1~2줄이라 시뮬레이션 1줄, 래스터 2줄 → (c) 가 두 배 — 이 띠로 설명된다.)
//   (4) 파일 A·C (gen-task0-dryrun.mjs 와 같은 입력으로 writer 생성) — 전 층 (a)(b)(c)(d)·넘침 통과,
//       추출한 도포 선분 수·길이 = writer 통계. sha256 은 참고로 출력(불변 확인은 gen 스크립트 출력과 대조).
//   (5) 대조군 — 정상 검사기는 통과, 변조하면 해당 판정이 실제로 FAIL 로 바뀜:
//       규칙 변조 K1 0.75w→0.5w (행 간격 1.4w), K2 (c)(d) 4-연결→8-연결 (대각 사슬), K3 (b) 8-연결→4-연결 (같은 사슬 + 점 1개),
//       K4 침식 생략 (아래 경계 띠가 0.75w 밖);
//       G-code 변조 K5 파일 A 층 50 도포 줄 하나 삭제, K6 층 30 도포 줄 끝 X ±5 mm (넘침), K7 층 10 도포 줄 E 삭제 (섬에 도포 0),
//       K8 프리앰블 M83 삭제 (Klipper 기본 절대 E 로 읽혀 도포가 사라짐).
//   (6) 실패 성분 목록(detail) — 도포 없는 섬의 면적·범위·가장 깊은 점(점 도포 후보)이 형상과 맞는지 (Z1-b2 입력).
//
//   대조군 원칙(구현 쪽): 모듈을 일부러 망가뜨리면 이 스크립트가 exit 1 — 2026-10-06 실측 8종
//   (미덮임 4→8-연결, 침식 반 픽셀 보정 제거, 마스크 Y 반열림 뒤집기, EDT 식 오류, 캡슐 반경 오류,
//    추출기 E ≥ 0 을 도포로, 섬 8→4-연결, 마스크 X 반열림 뒤집기) 모두 FAIL.
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "FAIL" 문자열을 출력한다.
//   실행: npx tsx scripts/verify-task0-coverage.mjs   (목표 30 초 이내 — 끝에 구간별 시간 출력)
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { squaredDistanceTransform } from "../src/features/v2/utils/task0/task0-distance.ts";
import { TASK0_DEFAULTS, bedToPixel, pixelCenterToBed } from "../src/features/v2/utils/task0/task0-frame.ts";
import { rasterizeTask0Mask } from "../src/features/v2/utils/task0/task0-mask.ts";
import {
  TASK0_COVERAGE_RULES,
  checkTask0GcodeCoverage,
  checkTask0LayerCoverage,
  extractTask0DepositSegments,
  labelTask0Components,
  stampTask0Coverage,
} from "../src/features/v2/utils/task0/task0-coverage.ts";
import { generateTask0Gcode } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import { fixtureCube10, fixtureGapPlates, meshesTopY } from "./verify-task0-writer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIM_PATH = path.resolve(__dirname, "..", "..", "docs", "references", "sim-coverage-20261002.py");

const F = TASK0_DEFAULTS;
const P = F.pixelPitchUm / 1000; // 0.073 mm — 시뮬레이션 P 와 같은 double
const W_PX = F.projectorWidthPx;
const H_PX = F.projectorHeightPx;

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

// ── (0) 판정 규칙 = 규격서 v0.3.3 §3 고정값 ────────────────────────────────
//   문턱을 조금 느슨하게 바꿔도 아래 사례들이 그대로 통과할 수 있어(Z1-b1 검수 참고 1),
//   규칙 값 자체를 규격 문구와 1:1 로 못박는다. 규격이 바뀌면 여기와 규격서를 함께 고친다.
{
  const SPEC_RULES = {
    erosionFactor: 0.5, // 경계 w/2 띠 제외
    innerRadiusFactor: 0.75, // (a) 0.75·w 이내
    innerRatioMin: 0.999, // (a) 99.9% 이상
    allRadiusFactor: 1.0, // (d) w 밖
    holeAreaFactor: 1.0, // (c)(d) 면적 w² 이상 0개
    holeConnectivity: 4, // (c)(d) 시뮬레이션과 같은 4-연결
    islandConnectivity: 8, // (b) 섬 = 8-연결(주석 근거)
    overflowDistFactor: 1.0, // 넘침: 흰 영역에서 도포폭 이내
    overflowRatioMin: 0.99, // 넘침: 99% 이상
  };
  const keys = [...new Set([...Object.keys(SPEC_RULES), ...Object.keys(TASK0_COVERAGE_RULES)])];
  const diff = keys.filter((k) => SPEC_RULES[k] !== TASK0_COVERAGE_RULES[k]);
  assert(diff.length === 0, `(0) TASK0_COVERAGE_RULES = 규격 §3 값 (다른 키: ${diff.join(", ") || "없음"})`);
}

/** 재현 가능한 난수 (mulberry32) */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const timings = [];
function timed(label, fn) {
  const t0 = performance.now();
  const r = fn();
  timings.push([label, performance.now() - t0]);
  return r;
}

// ── 기하 보조 (독립 구현) ────────────────────────────────────────────────

/** 픽셀 중심 — 규격 §11 식을 이 스크립트에서 따로 적음 (모듈의 pixelCenterToBed 와 같은 식) */
function centerOf(c, r) {
  return [F.projectorOffsetXMm + (c + 0.5) * P, F.projectorOffsetYMm + (H_PX - r - 0.5) * P];
}

/** Sunday 감김수 — 변 [lo, hi) 반열림, 점이 변 위면 오른쪽 교차로 안 셈 */
function windingNumber(polys, x, y) {
  let wn = 0;
  for (const pts of polys) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const isLeft = (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]);
      if (a[1] <= y) {
        if (b[1] > y && isLeft > 0) wn++;
      } else if (b[1] <= y && isLeft < 0) wn--;
    }
  }
  return wn;
}

function pointSegDist(px, py, s) {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - s.x0) * dx + (py - s.y0) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x0 + t * dx), py - (s.y0 + t * dy));
}

const seg = (x0, y0, x1, y1) => ({ x0, y0, x1, y1, e: 1, tool: 0 });
const dot = (x, y) => seg(x, y, x, y);
const rectPoly = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function circlePoly(cx, cy, R, n = 4096, reverse = false) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    pts.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]);
  }
  return reverse ? pts.reverse() : pts;
}

// ═════════════════════════════════════════════════════════════════════════
// (1) EDT
// ═════════════════════════════════════════════════════════════════════════
function sectionEdt() {
  console.log("\n(1) EDT — 무차별 계산 대조");
  const rng = makeRng(20261006);
  const densities = [0, 0.01, 0.05, 0.2, 0.5, 0.9, 1];
  const cases = [];
  for (let i = 0; i < 400; i++) {
    const w = 1 + Math.floor(rng() * 24);
    const h = 1 + Math.floor(rng() * 24);
    const dens = densities[i % densities.length];
    const g = new Uint8Array(w * h);
    for (let k = 0; k < g.length; k++) g[k] = rng() < dens ? 1 : 0;
    cases.push([g, w, h]);
  }
  for (const [w, h] of [[64, 48], [1, 50], [50, 1], [97, 3]]) {
    const g = new Uint8Array(w * h);
    for (let k = 0; k < g.length; k++) g[k] = rng() < 0.03 ? 1 : 0;
    cases.push([g, w, h]);
  }
  let cells = 0;
  let mismatch = 0;
  let infCases = 0;
  for (const [g, w, h] of cases) {
    for (const target of [1, 0]) {
      const got = squaredDistanceTransform(g, w, h, target);
      const sites = [];
      for (let k = 0; k < g.length; k++) if (g[k] === target) sites.push([k % w, Math.floor(k / w)]);
      if (sites.length === 0) infCases++;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let best = Infinity;
          for (const [sx, sy] of sites) best = Math.min(best, (sx - x) ** 2 + (sy - y) ** 2);
          cells++;
          if (got[y * w + x] !== best) mismatch++;
        }
      }
    }
  }
  assert(mismatch === 0, `격자 ${cases.length}개 × 표적 0/1, 칸 ${cells}개 — 불일치 ${mismatch} (표적 없는 격자 ${infCases}개 = 전부 Infinity 포함)`);
  const empty = squaredDistanceTransform(new Uint8Array(0), 0, 0);
  assert(empty.length === 0, "0×0 격자 → 빈 결과");
}

// ═════════════════════════════════════════════════════════════════════════
// (2) 마스크·덮임
// ═════════════════════════════════════════════════════════════════════════

/** 무작위 별 모양(오목) 폴리곤 */
function randomStar(rng, cx, cy, rMax, reverse) {
  const n = 3 + Math.floor(rng() * 12);
  const angles = [];
  for (let i = 0; i < n; i++) angles.push(rng() * 2 * Math.PI);
  angles.sort((a, b) => a - b);
  const pts = angles.map((t) => {
    const r = rMax * (0.25 + 0.75 * rng());
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  });
  return reverse ? pts.reverse() : pts;
}

function sectionMask() {
  console.log("\n(2) 마스크·덮임");
  const rng = makeRng(7310);
  // a. 무작위 장면
  let scenes = 0;
  let pixels = 0;
  let mismatch = 0;
  let outsideFrameWhite = 0;
  let clipMismatch = 0;
  let clipScenes = 0;
  let fullMismatch = 0;
  for (let s = 0; s < 160; s++) {
    // 프레임 안쪽 가운데 / 가장자리에 걸친 것 섞음
    const edge = s % 4 === 0;
    const cx = edge ? (rng() < 0.5 ? 10 + (rng() - 0.5) : 150.16 + (rng() - 0.5)) : 20 + rng() * 120;
    const cy = edge ? (rng() < 0.5 ? 10 + (rng() - 0.5) : 88.84 + (rng() - 0.5)) : 15 + rng() * 70;
    const polys = [];
    const count = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < count; k++) {
      const ox = (rng() - 0.5) * 2;
      const oy = (rng() - 0.5) * 2;
      polys.push(randomStar(rng, cx + ox, cy + oy, 0.4 + rng() * 2.5, rng() < 0.2));
    }
    if (rng() < 0.4) polys.push(rectPoly(cx - 0.3, cy - 0.3, cx + 0.3, cy + 0.3).reverse()); // 반대 감김 = 구멍 후보
    const mask = rasterizeTask0Mask(polys, { roi: "bbox", marginPx: 3 });
    scenes++;
    for (let j = 0; j < mask.height; j++) {
      for (let i = 0; i < mask.width; i++) {
        const c = mask.col0 + i;
        const r = mask.row0 + j;
        const [x, y] = centerOf(c, r);
        const inFrame = c >= 0 && c < W_PX && r >= 0 && r < H_PX;
        const want = inFrame && windingNumber(polys, x, y) !== 0 ? 1 : 0;
        const got = mask.data[j * mask.width + i];
        pixels++;
        if (got !== want) mismatch++;
        if (!inFrame && got !== 0) outsideFrameWhite++;
      }
    }
    // 잘림 통계 — 폴리곤 bbox 를 덮는 가상 픽셀 전부(프레임 밖 포함)를 독립으로 훑음
    const xs = polys.flat().map((q) => q[0]);
    const ys = polys.flat().map((q) => q[1]);
    const c0 = Math.floor((Math.min(...xs) - F.projectorOffsetXMm) / P) - 2;
    const c1 = Math.ceil((Math.max(...xs) - F.projectorOffsetXMm) / P) + 2;
    const r0 = H_PX - 1 - Math.ceil((Math.max(...ys) - F.projectorOffsetYMm) / P) - 2;
    const r1 = H_PX - 1 - Math.floor((Math.min(...ys) - F.projectorOffsetYMm) / P) + 2;
    let clipped = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (c >= 0 && c < W_PX && r >= 0 && r < H_PX) continue;
        const [x, y] = centerOf(c, r);
        if (windingNumber(polys, x, y) !== 0) clipped++;
      }
    }
    if (clipped > 0) clipScenes++;
    if (clipped !== mask.clippedPixels) clipMismatch++;
    if (s % 20 === 1) {
      // 'full' 모드 — ROI 부분이 'bbox' 결과와 같고 흰 칸 수도 같음
      const full = rasterizeTask0Mask(polys);
      if (full.width !== W_PX || full.height !== H_PX || full.col0 !== 0 || full.row0 !== 0) fullMismatch++;
      if (full.whitePixels !== mask.whitePixels) fullMismatch++;
      for (let j = 0; j < mask.height; j++) {
        for (let i = 0; i < mask.width; i++) {
          const c = mask.col0 + i;
          const r = mask.row0 + j;
          if (c < 0 || c >= W_PX || r < 0 || r >= H_PX) continue;
          if (full.data[r * W_PX + c] !== mask.data[j * mask.width + i]) fullMismatch++;
        }
      }
    }
  }
  assert(mismatch === 0, `무작위 장면 ${scenes}개(오목·겹침·구멍), 픽셀 ${pixels}개 — 독립 감김수와 불일치 ${mismatch}`);
  assert(outsideFrameWhite === 0, `프레임 밖 칸이 흰 경우 ${outsideFrameWhite}`);
  assert(clipMismatch === 0 && clipScenes > 0, `잘림 통계 불일치 ${clipMismatch}장면 (프레임에 걸친 장면 ${clipScenes}개)`);
  assert(fullMismatch === 0, `'full'(1920×1080) ↔ 'bbox' 결과 불일치 ${fullMismatch}`);

  // b. 방향 — 비대칭 L: 가로 막대 [20,30]×[20,22] + 세로 막대 [20,22]×[20,30]
  const L = [[20, 20], [30, 20], [30, 22], [22, 22], [22, 30], [20, 30]];
  const full = rasterizeTask0Mask([L]);
  const at = (c, r) => full.data[r * W_PX + c];
  // 손 계산: 열 = floor((X − 10)/0.073), 행 = 1079 − floor((Y − 10)/0.073)
  //   X 21 → 150, X 29 → 260, Y 21 → 1079 − 150 = 929, Y 29 → 1079 − 260 = 819
  const hand = [
    ["(29, 21) 가로 막대 끝", 29, 21, 260, 929, 1],
    ["(21, 29) 세로 막대 끝", 21, 29, 150, 819, 1],
    ["(21, 21) 모서리", 21, 21, 150, 929, 1],
    ["(29, 29) L 바깥", 29, 29, 260, 819, 0],
  ];
  for (const [label, x, y, c, r, want] of hand) {
    const [bc, br] = bedToPixel(x, y);
    assert(bc === c && br === r && at(c, r) === want, `L ${label} → 픽셀 (${c}, ${r}) = ${want ? "흰" : "검정"} (bedToPixel ${bc},${br}, 값 ${at(c, r)})`);
  }
  const tl = pixelCenterToBed(0, 0);
  const br = pixelCenterToBed(W_PX - 1, H_PX - 1);
  assert(
    Math.abs(tl[0] - 10.0365) < 1e-9 && Math.abs(tl[1] - 88.8035) < 1e-9 && Math.abs(br[0] - 150.1235) < 1e-9 && Math.abs(br[1] - 10.0365) < 1e-9,
    `픽셀 (0,0) 중심 = (${tl[0].toFixed(4)}, ${tl[1].toFixed(4)}) 왼쪽 위, (1919,1079) = (${br[0].toFixed(4)}, ${br[1].toFixed(4)}) 오른쪽 아래`,
  );

  // c. 반열림 — 직사각 변이 픽셀 중심을 정확히 지남: 열 300~310 중심, 행 500(아래)~490(위) 중심
  const xA = pixelCenterToBed(300, 0)[0];
  const xB = pixelCenterToBed(310, 0)[0];
  const yA = pixelCenterToBed(0, 500)[1];
  const yB = pixelCenterToBed(0, 490)[1];
  const tie = rasterizeTask0Mask([rectPoly(xA, yA, xB, yB)], { roi: { col0: 295, row0: 485, width: 20, height: 20 } });
  const white = [];
  for (let j = 0; j < tie.height; j++) {
    for (let i = 0; i < tie.width; i++) if (tie.data[j * tie.width + i]) white.push([tie.col0 + i, tie.row0 + j]);
  }
  const cols = [...new Set(white.map((q) => q[0]))].sort((a, b) => a - b);
  const rows = [...new Set(white.map((q) => q[1]))].sort((a, b) => a - b);
  assert(
    white.length === 100 && cols[0] === 300 && cols[cols.length - 1] === 309 && rows[0] === 491 && rows[rows.length - 1] === 500,
    `변이 중심을 지나는 직사각 → 열 ${cols[0]}~${cols[cols.length - 1]}(X [시작, 끝)), 행 ${rows[0]}~${rows[rows.length - 1]}(베드 Y [lo, hi) — 아래 변 행 500 포함, 위 변 행 490 제외)`,
  );

  // d. 덮임 표 — 무작위 선분 vs 점-선분 거리 무차별
  let stampPixels = 0;
  let stampMismatch = 0;
  let stampTies = 0;
  for (let s = 0; s < 120; s++) {
    const roi = { col0: 900 + Math.floor(rng() * 50), row0: 500 + Math.floor(rng() * 50), width: 40 + Math.floor(rng() * 60), height: 40 + Math.floor(rng() * 60) };
    const [bx, by] = pixelCenterToBed(roi.col0 + roi.width / 2, roi.row0 + roi.height / 2);
    const segs = [];
    for (let k = 0; k < 1 + Math.floor(rng() * 4); k++) {
      const kind = Math.floor(rng() * 5);
      const x0 = bx + (rng() - 0.5) * 6;
      const y0 = by + (rng() - 0.5) * 6;
      const len = rng() * 4;
      const ang = rng() * 2 * Math.PI;
      if (kind === 0) segs.push(seg(x0, y0, x0 + len, y0)); // 수평
      else if (kind === 1) segs.push(seg(x0, y0, x0, y0 + len)); // 수직
      else if (kind === 2) segs.push(dot(x0, y0)); // 점
      else if (kind === 3) segs.push(seg(x0, y0, x0 + len, y0 + 1e-7)); // 거의 수평
      else segs.push(seg(x0, y0, x0 + len * Math.cos(ang), y0 + len * Math.sin(ang))); // 사선
    }
    const R = 0.05 + rng() * 1.2;
    const out = new Uint8Array(roi.width * roi.height);
    stampTask0Coverage(segs, R, roi, out);
    for (let j = 0; j < roi.height; j++) {
      for (let i = 0; i < roi.width; i++) {
        const [x, y] = centerOf(roi.col0 + i, roi.row0 + j);
        const d = Math.min(...segs.map((q) => pointSegDist(x, y, q)));
        stampPixels++;
        if (Math.abs(d - R) < 1e-9) {
          stampTies++;
          continue;
        }
        if ((d <= R ? 1 : 0) !== out[j * roi.width + i]) stampMismatch++;
      }
    }
  }
  assert(stampMismatch === 0, `덮임 표: 무작위 선분 장면 120개, 픽셀 ${stampPixels}개 — 거리 ≤ R 무차별과 불일치 ${stampMismatch} (|거리 − R| < 1e-9 동률 ${stampTies}개 제외)`);
}

// ═════════════════════════════════════════════════════════════════════════
// (3) 시뮬레이션 재현
// ═════════════════════════════════════════════════════════════════════════

// sim-coverage-20261002.py 출력 (2026-10-06, Python 3.13 실측) — python 이 없는 PC 의 기준값.
// a = (a) %, c·d = mm², 판정 true = 통과. a NaN = 침식 픽셀 0 (시뮬레이션 nan).
const SIM_EXPECTED = {
  0.5: [
    { a: 100.0, ap: true, c: 0.0, cp: true, d: 0.01, dp: true },
    { a: 99.929, ap: true, c: 7.41, cp: false, d: 6.11, dp: false },
    { a: 100.0, ap: true, c: 0.0, cp: true, d: 0.0, dp: true },
    { a: 99.996, ap: true, c: 0.01, cp: true, d: 0.04, dp: true },
    { a: 3.745, ap: false, c: 0.69, cp: false, d: 5.57, dp: false },
    { a: 100.0, ap: true, c: 0.0, cp: true, d: 0.0, dp: true },
    { a: NaN, ap: true, c: 0.0, cp: true, d: 18.29, dp: false },
    { a: NaN, ap: true, c: 0.0, cp: true, d: 0.0, dp: true },
  ],
  1: [
    { a: 100.0, ap: true, c: 0.0, cp: true, d: 0.04, dp: true },
    { a: 99.945, ap: true, c: 5.65, cp: false, d: 3.27, dp: false },
    { a: 100.0, ap: true, c: 0.0, cp: true, d: 0.0, dp: true },
    { a: 100.0, ap: true, c: 0.0, cp: true, d: 0.03, dp: true },
    { a: 7.692, ap: false, c: 1.92, cp: false, d: 11.27, dp: false },
    { a: 100.0, ap: true, c: 0.0, cp: true, d: 0.0, dp: true },
    { a: NaN, ap: true, c: 0.0, cp: true, d: 35.45, dp: false },
    { a: NaN, ap: true, c: 0.0, cp: true, d: 0.0, dp: true },
  ],
};

/** 시뮬레이션 출력 파싱 → { 0.5: [8], 1: [8] } (실패 시 null) */
function parseSimOutput(text) {
  const out = {};
  let cur = null;
  const re = /\(a\)\s*(\S+)%\s+(통과|FAIL).*?\(c\)[^0-9]*([0-9.]+)mm²\s+(통과|FAIL).*?\(d\)[^0-9]*([0-9.]+)mm²\s+(통과|FAIL)/;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/도포폭 w = ([0-9.]+) mm/);
    if (h) {
      cur = Number(h[1]);
      out[cur] = [];
      continue;
    }
    const m = line.match(re);
    if (m && cur !== null) {
      out[cur].push({
        a: m[1] === "nan" ? NaN : Number(m[1]),
        ap: m[2] === "통과",
        c: Number(m[3]),
        cp: m[4] === "통과",
        d: Number(m[5]),
        dp: m[6] === "통과",
      });
    }
  }
  return out[0.5]?.length === 8 && out[1]?.length === 8 ? out : null;
}

function runPythonSim() {
  for (const exe of ["python", "python3"]) {
    const r = spawnSync(exe, [SIM_PATH], {
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      timeout: 120000,
    });
    if (r.error || r.status !== 0) continue;
    const parsed = parseSimOutput(r.stdout);
    if (parsed) return { exe, parsed };
  }
  return null;
}

// 시뮬레이션 경로 규칙 (rows_rect·rows_circle 그대로 옮김)
function rowsRect(xa, xb, ya, yb, w, hole = null, phase = 0) {
  const out = [];
  const ya2 = ya + w / 2;
  const yb2 = yb - w / 2;
  const xa2 = xa + w / 2;
  const xb2 = xb - w / 2;
  let k = Math.ceil((ya2 - phase) / w);
  while (phase + k * w <= yb2 + 1e-9) {
    const y = phase + k * w;
    if (hole && hole[2] <= y && y <= hole[3]) {
      if (xa2 < hole[0]) out.push(["row", xa2, hole[0], y]);
      if (xb2 > hole[1]) out.push(["row", hole[1], xb2, y]);
    } else out.push(["row", xa2, xb2, y]);
    k++;
  }
  return out;
}
function rowsCircle(R, w, phase = 0) {
  const r = R - w / 2;
  const out = [];
  if (r <= 0) return out;
  let k = Math.ceil((-r - phase) / w);
  while (phase + k * w <= r) {
    const y = phase + k * w;
    const h = Math.sqrt(Math.max(0, r * r - y * y));
    out.push(["row", -h, h, y]);
    k++;
  }
  return out;
}

/** 사례 1~7 (시뮬레이션 좌표) — inside/insideEr 는 시뮬레이션 람다 그대로, bd = 해석 경계까지 거리(안쪽 점) */
function simCases(w) {
  const cases = [];
  const rect = (x, y) => 10 <= x && x <= 150 && 10 <= y && y <= 85;
  const rectEr = (x, y) => 10 + w / 2 <= x && x <= 150 - w / 2 && 10 + w / 2 <= y && y <= 85 - w / 2;
  const rectBd = (x, y) => Math.min(x - 10, 150 - x, y - 10, 85 - y);
  const hole = [78.5, 81.5, 46, 49];
  cases.push({ name: "1 전면층 140x75, 정상", bbox: [9.5, 9.5, 150.5, 85.5], polys: [rectPoly(10, 10, 150, 85)], inside: rect, insideEr: rectEr, bd: rectBd, paths: rowsRect(10, 150, 10, 85, w) });
  cases.push({ name: "2 전면층 + 3x3 구멍(행 제거)", bbox: [9.5, 9.5, 150.5, 85.5], polys: [rectPoly(10, 10, 150, 85)], inside: rect, insideEr: rectEr, bd: rectBd, paths: rowsRect(10, 150, 10, 85, w, hole) });
  for (const R of [1, 10]) {
    cases.push({
      name: `3 원 반경 ${R}mm, 정상`,
      bbox: [-R - 1, -R - 1, R + 1, R + 1],
      polys: [circlePoly(0, 0, R)],
      inside: (x, y) => x * x + y * y <= R * R,
      insideEr: (x, y) => x * x + y * y <= (R - w / 2) ** 2,
      bd: (x, y) => R - Math.hypot(x, y),
      paths: rowsCircle(R, w),
    });
  }
  const hw = 1.2 * w;
  const strip = (x, y) => 0 <= x && x <= 20 && 0 <= y && y <= hw;
  const stripEr = (x, y) => w / 2 <= x && x <= 20 - w / 2 && w / 2 <= y && y <= hw - w / 2;
  const stripBd = (x, y) => Math.min(x, 20 - x, y, hw - y);
  cases.push({ name: "4 얇은 띠 폭1.2w, 빗나감(점 1개)", bbox: [-1, -1, 21, hw + 1], polys: [rectPoly(0, 0, 20, hw)], inside: strip, insideEr: stripEr, bd: stripBd, paths: [["dot", 10, hw / 2]] });
  cases.push({ name: "5 얇은 띠 폭1.2w, 중심선 1줄", bbox: [-1, -1, 21, hw + 1], polys: [rectPoly(0, 0, 20, hw)], inside: strip, insideEr: stripEr, bd: stripBd, paths: [["row", w / 2, 20 - w / 2, hw / 2]] });
  const rw = 0.6 * w;
  const Ro = 10;
  const Ri = Ro - rw;
  const ring = (x, y) => Ri * Ri <= x * x + y * y && x * x + y * y <= Ro * Ro;
  const ringBd = (x, y) => Math.min(Ro - Math.hypot(x, y), Math.hypot(x, y) - Ri);
  const ringPolys = [circlePoly(0, 0, Ro), circlePoly(0, 0, Ri, 4096, true)];
  cases.push({ name: "6 얇은 링 폭0.6w, 점 1개만", bbox: [-11, -11, 11, 11], polys: ringPolys, inside: ring, insideEr: () => false, bd: ringBd, paths: [["dot", Ro - rw / 2, 0]] });
  const rm = Ro - rw / 2;
  const n = Math.trunc((2 * Math.PI * rm) / (P * 2));
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(["dot", rm * Math.cos((2 * Math.PI * i) / n), rm * Math.sin((2 * Math.PI * i) / n)]);
  cases.push({ name: "7 얇은 링 폭0.6w, 중심선 점 도포", bbox: [-11, -11, 11, 11], polys: ringPolys, inside: ring, insideEr: () => false, bd: ringBd, paths: pts });
  return cases;
}

/**
 * 평행이동 (tx, ty) — 시뮬레이션 격자점 (x0 + i·P, y0 + j·P) 이 투사 픽셀 중심 (cI0 + i, rJ0 − j) 에 오게.
 * 형상 bbox 가운데를 출력 가능 영역 가운데 (80, 47.5) 근처에 둔다.
 */
function alignTranslate(cs) {
  const [x0, y0] = cs.bbox;
  const xs = cs.polys.flat().map((q) => q[0]);
  const ys = cs.polys.flat().map((q) => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const cI0 = Math.round((80 - F.projectorOffsetXMm) / P - 0.5 - (cx - x0) / P);
  const rJ0 = Math.round(H_PX - 0.5 - (47.5 - F.projectorOffsetYMm) / P + (cy - y0) / P);
  return [F.projectorOffsetXMm + (cI0 + 0.5) * P - x0, F.projectorOffsetYMm + (H_PX - rJ0 - 0.5) * P - y0];
}

const fmtA = (a) => (Number.isNaN(a) ? "nan" : a.toFixed(3));
const verdict = (ok) => (ok ? "통과" : "FAIL");

function sectionSim() {
  console.log("\n(3) 시뮬레이션 재현 (sim-coverage-20261002.py 사례 1~7 × w 0.5·1.0)");
  const sim = timed("(3) python 시뮬레이션", runPythonSim);
  let S = SIM_EXPECTED;
  if (sim) {
    let drift = 0;
    for (const w of [0.5, 1]) {
      sim.parsed[w].forEach((v, i) => {
        const e = SIM_EXPECTED[w][i];
        const same = (x, y) => (Number.isNaN(x) && Number.isNaN(y)) || x === y;
        if (!same(v.a, e.a) || v.c !== e.c || v.d !== e.d || v.ap !== e.ap || v.cp !== e.cp || v.dp !== e.dp) drift++;
      });
    }
    assert(drift === 0, `python(${sim.exe}) 으로 시뮬레이션 실행 — 출력이 스크립트에 박아 둔 기대값과 같음 (다른 줄 ${drift})`);
    S = sim.parsed;
  } else {
    console.log("  (python 없음 — 박아 둔 기대값과 대조)");
  }

  const table = [];
  let verdictMismatch = 0;
  let verdictItems = 0;
  for (const w of [0.5, 1]) {
    const cases = simCases(w);
    cases.forEach((cs, idx) => {
      const s = S[w][idx];
      const [tx, ty] = alignTranslate(cs);
      const polys = cs.polys.map((pl) => pl.map(([x, y]) => [x + tx, y + ty]));
      const segs = cs.paths.map((q) => (q[0] === "row" ? seg(q[1] + tx, q[3] + ty, q[2] + tx, q[3] + ty) : dot(q[1] + tx, q[2] + ty)));

      // ii. 검사기 본체
      const res = checkTask0LayerCoverage(polys, segs, { depositWidthMm: w });
      const roi = res.roi;
      const nPix = roi.width * roi.height;

      // i. 분해 재현 — 같은 ROI 에서 우리 래스터·덮임 표·라벨 + 시뮬레이션 해석 침식
      const mask = rasterizeTask0Mask(polys, { roi });
      const covInner = new Uint8Array(nPix);
      const covAll = new Uint8Array(nPix);
      stampTask0Coverage(segs, 0.75 * w, roi, covInner);
      stampTask0Coverage(segs, 1.0 * w, roi, covAll);
      const edt = squaredDistanceTransform(mask.data, roi.width, roi.height, 0);
      const thr = ((0.5 * w) / P + 0.5) ** 2;
      const uncA = new Uint8Array(nPix);
      const uncD = new Uint8Array(nPix);
      let inner = 0;
      let ok = 0;
      let rasterInner = 0;
      let band = 0;
      let bandUncovered = 0;
      let bandOutside = 0;
      let whiteVsAnalytic = 0;
      let whiteVsAnalyticFar = 0;
      for (let k = 0; k < nPix; k++) {
        const i = k % roi.width;
        const j = (k - i) / roi.width;
        const [bx, by] = pixelCenterToBed(roi.col0 + i, roi.row0 + j);
        const x = bx - tx;
        const y = by - ty;
        if ((mask.data[k] === 1) !== cs.inside(x, y)) {
          whiteVsAnalytic++;
          if (Math.abs(cs.bd(x, y)) > 1e-5) whiteVsAnalyticFar++;
        }
        if (mask.data[k] === 0) continue;
        if (!covAll[k]) uncD[k] = 1;
        const er = cs.insideEr(x, y);
        const rasterEr = edt[k] >= thr;
        if (rasterEr) rasterInner++;
        if (er !== rasterEr) {
          band++;
          if (!covInner[k]) bandUncovered++;
          if (Math.abs(cs.bd(x, y) - w / 2) > P) bandOutside++;
        }
        if (er) {
          inner++;
          if (covInner[k]) ok++;
          else uncA[k] = 1;
        }
      }
      const maxArea = (g) => labelTask0Components(g, roi.width, roi.height, 4).sizes.reduce((m, v) => Math.max(m, v), 0) * P * P;
      const dec = { a: inner ? (ok / inner) * 100 : NaN, c: maxArea(uncA), d: maxArea(uncD) };
      const ours = { a: res.a.coveredRatio * 100, c: res.c.maxAreaMm2, d: res.d.maxAreaMm2 };

      const tag = `w ${w} ${cs.name}`;
      // 배치·래스터
      assert(res.clippedPixels === 0 && whiteVsAnalyticFar === 0,
        `${tag}: 프레임 안 배치(잘림 ${res.clippedPixels}), 래스터 = 해석 형상 (다른 픽셀 ${whiteVsAnalytic}, 경계 1e-5 mm 밖 ${whiteVsAnalyticFar})`);
      // i. 분해 재현 = 시뮬레이션 (인쇄 자릿수)
      const aClose = (x, y, tol) => (Number.isNaN(x) && Number.isNaN(y)) || Math.abs(x - y) <= tol;
      assert(aClose(dec.a, s.a, 0.0005 + 1e-9) && Math.abs(dec.c - s.c) <= 0.005 + 1e-9 && Math.abs(dec.d - s.d) <= 0.005 + 1e-9,
        `${tag}: 분해 재현 (a) ${fmtA(dec.a)} (c) ${dec.c.toFixed(4)} (d) ${dec.d.toFixed(4)} ≈ 시뮬레이션 ${fmtA(s.a)} / ${s.c.toFixed(2)} / ${s.d.toFixed(2)}`);
      // ii. 검사기 본체 — 판정 일치
      const vOk = res.a.pass === s.ap && res.c.pass === s.cp && res.d.pass === s.dp;
      verdictItems += 3;
      verdictMismatch += Number(res.a.pass !== s.ap) + Number(res.c.pass !== s.cp) + Number(res.d.pass !== s.dp);
      assert(vOk, `${tag}: 판정 (a)${verdict(res.a.pass)} (c)${verdict(res.c.pass)} (d)${verdict(res.d.pass)} = 시뮬레이션 (a)${verdict(s.ap)} (c)${verdict(s.cp)} (d)${verdict(s.dp)}`);
      // ii. 수치 — (d) 는 분해 재현과 정확히 같음, (a)(c) 는 침식 띠로 설명되는 범위
      const tolC = 0.005 + bandUncovered * P * P;
      const tolA = 0.0005 + (100 * band) / Math.max(1, res.a.innerPixels);
      const aOk = Number.isNaN(s.a) ? res.a.innerPixels <= band : aClose(ours.a, s.a, tolA);
      assert(rasterInner === res.a.innerPixels && ours.d === dec.d && bandOutside === 0 && Math.abs(ours.c - s.c) <= tolC && aOk,
        `${tag}: 수치 (a) ${fmtA(ours.a)} (±${tolA.toFixed(4)}) (c) ${ours.c.toFixed(4)} (±${tolC.toFixed(4)}) (d) ${ours.d.toFixed(4)} — 침식 띠 ${band}px(0.75w 밖 ${bandUncovered}), 해석 경계 w/2 ± p 밖 ${bandOutside}`);
      table.push({ w, name: cs.name, s, dec, ours, res, band });
    });
  }
  assert(verdictMismatch === 0 && verdictItems === 48, `판정 (a)(c)(d) ${verdictItems}항목(사례 8 × w 2 × 3) 중 시뮬레이션과 다른 항목 ${verdictMismatch}`);

  console.log("\n  대조표 (시뮬레이션 / 분해 재현 / 검사기 — (a) %, (c)·(d) mm²; 검사기 (b)·넘침은 시뮬레이션에 없음)");
  for (const t of table) {
    const r = t.res;
    console.log(
      `  w ${t.w} ${t.name.padEnd(26)} ` +
        `(a) ${fmtA(t.s.a).padStart(7)} / ${fmtA(t.dec.a).padStart(7)} / ${fmtA(t.ours.a).padStart(7)} ${verdict(r.a.pass)} | ` +
        `(c) ${t.s.c.toFixed(2)} / ${t.dec.c.toFixed(3)} / ${t.ours.c.toFixed(3)} ${verdict(r.c.pass)} | ` +
        `(d) ${t.s.d.toFixed(2)} / ${t.dec.d.toFixed(3)} / ${t.ours.d.toFixed(3)} ${verdict(r.d.pass)} | ` +
        `(b) ${verdict(r.b.pass)} 넘침 ${verdict(r.overflow.pass)} | 띠 ${t.band}px`,
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════
// (4) 파일 A·C
// ═════════════════════════════════════════════════════════════════════════
const AC_FILES = [
  { file: "task0_A_cube10_lh0.1.gcode", fixture: fixtureCube10, lh: 0.1 },
  { file: "task0_C_gap_5L_lh0.1.gcode", fixture: fixtureGapPlates, lh: 0.1 },
];

function buildAc() {
  return AC_FILES.map((spec) => {
    const meshes = spec.fixture().meshes();
    const topY = meshesTopY(meshes);
    const result = generateTask0Gcode(meshes, topY, spec.lh);
    return { ...spec, meshes, topY, result };
  });
}

function fmtWorst(rep) {
  const w = rep.worst;
  return (
    `(a) 최소 ${Number.isNaN(w.aMinRatio) ? "—" : (w.aMinRatio * 100).toFixed(3) + "%"}${w.aLayer !== null ? ` (층 ${w.aLayer})` : ""}, ` +
    `(b) 도포점 없는 섬 ${w.bWithoutDeposit}, ` +
    `(c) 최대 ${w.cMaxAreaMm2.toFixed(4)} mm²${w.cLayer !== null ? ` (층 ${w.cLayer})` : ""}, ` +
    `(d) 최대 ${w.dMaxAreaMm2.toFixed(4)} mm²${w.dLayer !== null ? ` (층 ${w.dLayer})` : ""}, ` +
    `넘침 최소 ${Number.isNaN(w.overflowMinRatio) ? "—" : (w.overflowMinRatio * 100).toFixed(3) + "%"}`
  );
}

function sectionFiles(built) {
  console.log("\n(4) 파일 A·C — 전 층 커버리지·넘침");
  for (const b of built) {
    const rep = timed(`(4) ${b.file} 검사`, () => checkTask0GcodeCoverage(b.meshes, b.topY, b.lh, b.result.gcode));
    const sha = createHash("sha256").update(b.result.gcode, "utf8").digest("hex");
    console.log(`  ${b.file}: sha256 ${sha} (참고 — gen-task0-dryrun.mjs 출력과 대조)`);
    assert(rep.pass, `${b.file}: 층 ${rep.gcodeLayerCount}/${rep.expectedLayerCount}, FAIL 층 ${JSON.stringify(rep.failedLayers)} — ${fmtWorst(rep)}`);
    const ext = extractTask0DepositSegments(b.result.gcode);
    const segs = ext.layers.flat();
    const len = segs.reduce((s, q) => s + Math.hypot(q.x1 - q.x0, q.y1 - q.y0), 0);
    assert(
      segs.length === b.result.totals.segments && Math.abs(len - b.result.totals.depositMm) < 1e-6 && ext.preambleSegments === 0,
      `${b.file}: 추출 도포 선분 ${segs.length}개·${len.toFixed(3)} mm = writer 통계 ${b.result.totals.segments}개·${b.result.totals.depositMm.toFixed(3)} mm, 프리앰블 도포 ${ext.preambleSegments}`,
    );
    const emptyLayers = rep.layers.filter((l) => l.whitePixels === 0).map((l) => l.index);
    assert(JSON.stringify(emptyLayers) === JSON.stringify(b.result.totals.emptyLayers), `${b.file}: 흰 픽셀 0 층 ${JSON.stringify(emptyLayers)} = writer 빈 층`);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// (5) 대조군
// ═════════════════════════════════════════════════════════════════════════

/** 정상 통과 + 변조 FAIL 단언 */
function expectFlip(id, normal, mutated, key) {
  assert(normal[key].pass && !mutated[key].pass, `${id}: 정상 (${key}) ${verdict(normal[key].pass)} → 변조 (${key}) ${verdict(mutated[key].pass)}`);
}

/** G-code 층 n 블록의 줄 번호들 (0-based, ;LAYER_CHANGE 다음 줄부터) */
function layerLineRange(lines, n) {
  let seen = -1;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === ";LAYER_CHANGE") {
      seen++;
      if (seen === n) start = i + 1;
      else if (seen === n + 1) return [start, i];
    }
  }
  return [start, lines.length];
}
const isDepositLine = (s) => /^G1 X\S+ Y\S+ E\S+ F\d+$/.test(s);

function sectionControls(built) {
  console.log("\n(5) 대조군 — 정상 통과, 변조하면 해당 판정 FAIL");
  const w = 0.5;
  const opt = { depositWidthMm: w };

  // K1 0.75w → 0.5w: 직사각 [70,90]×[40,50.3], 행 간격 1.4w (행 사이 최대 거리 0.7w — 0.75w 안, 0.5w 밖)
  {
    const polys = [rectPoly(70, 40, 90, 50.3)];
    const segs = [];
    for (let k = 0; k <= 14; k++) segs.push(seg(70.25, 40.25 + k * 1.4 * w, 89.75, 40.25 + k * 1.4 * w));
    const normal = checkTask0LayerCoverage(polys, segs, opt);
    const mut = checkTask0LayerCoverage(polys, segs, { ...opt, rules: { innerRadiusFactor: 0.5 } });
    assert(normal.pass, `K1 정상 검사기: 행 간격 1.4w 층 전체 통과 ((a) ${fmtA(normal.a.coveredRatio * 100)}%)`);
    expectFlip("K1 반경 0.75w→0.5w", normal, mut, "a");
    expectFlip("K1 반경 0.75w→0.5w", normal, mut, "c");
  }

  // K2·K3 연결성: 대각 사슬 60 픽셀 (각 픽셀 중심에 p/2 정사각) + 첫 칸에 점 도포 1개
  {
    const c0 = 900;
    const r0 = 500;
    const polys = [];
    for (let i = 0; i < 60; i++) {
      const [x, y] = pixelCenterToBed(c0 + i, r0 + i);
      polys.push(rectPoly(x - P / 4, y - P / 4, x + P / 4, y + P / 4));
    }
    const segs = [dot(...pixelCenterToBed(c0, r0))];
    const normal = checkTask0LayerCoverage(polys, segs, opt);
    assert(normal.whitePixels === 60 && normal.pass, `K2·K3 정상 검사기: 대각 사슬 흰 ${normal.whitePixels}px, 섬 ${normal.b.components}개(8-연결), (d) 최대 ${normal.d.maxAreaMm2.toFixed(4)} mm² — 전부 통과`);
    expectFlip("K2 (c)(d) 4-연결→8-연결", normal, checkTask0LayerCoverage(polys, segs, { ...opt, rules: { holeConnectivity: 8 } }), "d");
    expectFlip("K3 (b) 8-연결→4-연결", normal, checkTask0LayerCoverage(polys, segs, { ...opt, rules: { islandConnectivity: 4 } }), "b");
  }

  // K4 침식 생략: 직사각 [70,90]×[40,50.25], 행 y = 40.5 + k·w ≤ 50 (아래 경계 [40, 40.125) 가 0.75w 밖 — w/2 띠 안)
  {
    const polys = [rectPoly(70, 40, 90, 50.25)];
    const segs = [];
    for (let k = 0; 40.5 + k * w <= 50 + 1e-9; k++) segs.push(seg(70.25, 40.5 + k * w, 89.75, 40.5 + k * w));
    const normal = checkTask0LayerCoverage(polys, segs, opt);
    const mut = checkTask0LayerCoverage(polys, segs, { ...opt, rules: { erosionFactor: 0 } });
    assert(normal.pass, `K4 정상 검사기: 아래 경계 띠는 w/2 안이라 제외 — 통과`);
    expectFlip("K4 침식 생략", normal, mut, "c");
  }

  // G-code 변조 — 파일 A
  const A = built[0];
  const baseLines = A.result.gcode.split("\n");
  const run = (lines) => checkTask0GcodeCoverage(A.meshes, A.topY, A.lh, lines.join("\n"));
  const layerRes = (rep, n) => rep.layers[n];

  // K5 층 50 의 10번째 도포 줄 삭제 (행 하나 빠짐 → 행 간격 2w)
  {
    const lines = [...baseLines];
    const [s, e] = layerLineRange(lines, 50);
    const deps = [];
    for (let i = s; i < e; i++) if (isDepositLine(lines[i])) deps.push(i);
    lines.splice(deps[9], 1);
    const rep = run(lines);
    const l = layerRes(rep, 50);
    assert(!rep.pass && JSON.stringify(rep.failedLayers) === "[50]" && !l.a.pass && !l.c.pass,
      `K5 도포 줄 하나 삭제: FAIL 층 ${JSON.stringify(rep.failedLayers)}, 층 50 (a) ${fmtA(l.a.coveredRatio * 100)}% ${verdict(l.a.pass)} (c) ${l.c.maxAreaMm2.toFixed(3)} mm² ${verdict(l.c.pass)}`);
  }
  // K6 층 30 첫 도포 줄 끝 X 를 바깥으로 5 mm (넘침)
  {
    const lines = [...baseLines];
    const [s, e] = layerLineRange(lines, 30);
    let idx = -1;
    for (let i = s; i < e && idx < 0; i++) if (isDepositLine(lines[i])) idx = i;
    lines[idx] = lines[idx].replace(/X(\S+)/, (_, v) => `X${(Number(v) > 80 ? Number(v) + 5 : Number(v) - 5).toFixed(3)}`);
    const rep = run(lines);
    const l = layerRes(rep, 30);
    assert(!rep.pass && JSON.stringify(rep.failedLayers) === "[30]" && !l.overflow.pass,
      `K6 도포 줄 X ±5 mm: FAIL 층 ${JSON.stringify(rep.failedLayers)}, 층 30 넘침 ${(l.overflow.okRatio * 100).toFixed(2)}% ${verdict(l.overflow.pass)}`);
  }
  // K7 층 10 도포 줄 E 삭제 (전부 트래블이 됨 → 섬에 도포점 0)
  {
    const lines = [...baseLines];
    const [s, e] = layerLineRange(lines, 10);
    for (let i = s; i < e; i++) if (isDepositLine(lines[i])) lines[i] = lines[i].replace(/ E\S+/, "");
    const rep = run(lines);
    const l = layerRes(rep, 10);
    assert(!rep.pass && JSON.stringify(rep.failedLayers) === "[10]" && !l.b.pass && l.segments === 0,
      `K7 층 10 도포 E 삭제: FAIL 층 ${JSON.stringify(rep.failedLayers)}, 층 10 도포 ${l.segments}줄 (b) 도포점 없는 섬 ${l.b.withoutDeposit} ${verdict(l.b.pass)}`);
  }
  // K8 프리앰블 M83 삭제 — Klipper 기본 M82(절대 E)로 읽혀 도포 대부분이 사라짐
  {
    const lines = baseLines.filter((s) => s !== "M83");
    const rep = run(lines);
    assert(lines.length === baseLines.length - 1 && !rep.pass && rep.failedLayers.length > 90,
      `K8 M83 삭제: FAIL 층 ${rep.failedLayers.length}/${rep.layers.length}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// (6) 실패 성분 목록 (detail — Z1-b2 얇은 부분 채움의 입력)
// ═════════════════════════════════════════════════════════════════════════
function sectionDetail() {
  console.log("\n(6) 실패 성분 목록 (detail 옵션)");
  const w = 0.5;
  // 섬 A [70,75]×[40,45] 는 writer 식 행으로 다 덮고, 섬 B [80,82]×[40,42] 는 도포 0.
  // 면적 허용 = 둘레 × p (픽셀 중심 표본이라 경계에서 한 줄 차이), 좌표 허용 = p
  const polys = [rectPoly(70, 40, 75, 45), rectPoly(80, 40, 82, 42)];
  const segs = [];
  for (let k = 0; k < 10; k++) segs.push(seg(70.25, 40.25 + k * w, 74.75, 40.25 + k * w));
  const plain = checkTask0LayerCoverage(polys, segs, { depositWidthMm: w });
  const res = checkTask0LayerCoverage(polys, segs, { depositWidthMm: w, detail: true });
  assert(plain.uncovered === undefined && res.uncovered !== undefined, "detail 없으면 uncovered 없음, 있으면 채움");
  const u = res.uncovered;
  const b = u.b[0];
  const near = (x, y, tx, ty, tol) => Math.abs(x - tx) <= tol && Math.abs(y - ty) <= tol;
  assert(
    !res.b.pass && res.b.withoutDeposit === 1 && u.b.length === 1 && Math.abs(b.areaMm2 - 4) <= 8 * P &&
      near(b.innerXMm, b.innerYMm, 81, 41, P) && Math.abs(b.innerDepthMm - 1) <= P &&
      near(b.xMinMm, b.yMinMm, 80, 40, P) && near(b.xMaxMm, b.yMaxMm, 82, 42, P),
    `(b) 도포점 없는 섬 B: 면적 ${b.areaMm2.toFixed(3)} mm², 가장 깊은 점 (${b.innerXMm.toFixed(3)}, ${b.innerYMm.toFixed(3)}) 깊이 ${b.innerDepthMm.toFixed(3)} mm, 범위 X ${b.xMinMm.toFixed(3)}~${b.xMaxMm.toFixed(3)} Y ${b.yMinMm.toFixed(3)}~${b.yMaxMm.toFixed(3)}`,
  );
  assert(
    u.c.length === 1 && u.d.length === 1 && u.d[0].pixels === b.pixels && Math.abs(u.c[0].areaMm2 - 1.5 * 1.5) <= 6 * P &&
      res.d.oversized === 1 && res.c.oversized === 1,
    `(c)(d) 문턱 이상 미덮임 성분 = 섬 B 하나 ((c) 침식 안쪽 ${u.c[0]?.areaMm2.toFixed(3)} mm², (d) ${u.d[0]?.areaMm2.toFixed(3)} mm²) — 덮인 섬 A 는 목록에 없음`,
  );
}

function main() {
  const t0 = performance.now();
  console.log("Task0 마스크 래스터 + 커버리지 검사기 검증 (Z1-b1, 규격서 v0.3.3 §3)");
  console.log(`  규칙: ${JSON.stringify(TASK0_COVERAGE_RULES)}`);
  timed("(1) EDT", sectionEdt);
  timed("(2) 마스크·덮임", sectionMask);
  timed("(3) 시뮬레이션 재현 전체", sectionSim);
  const built = timed("(4) writer 로 A·C 생성", buildAc);
  timed("(4) 파일 A·C 전체", () => sectionFiles(built));
  timed("(5) 대조군", () => sectionControls(built));
  timed("(6) 실패 성분 목록", sectionDetail);
  const total = performance.now() - t0;
  console.log("\n  실행 시간:");
  for (const [label, ms] of timings) console.log(`    ${label}: ${(ms / 1000).toFixed(2)} s`);
  console.log(`    전체: ${(total / 1000).toFixed(2)} s`);
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
