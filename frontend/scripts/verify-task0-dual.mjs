// Task0 2재료 writer 헤드리스 검증 (D1a — 11월 데모 단일·2재료 모드 중 2재료의 라이브러리 조각, 앱 미연결).
//
//   무엇을: src/features/v2/utils/task0/task0-gcode-writer.ts 의 dualMaterial 옵션(층 안 T0/T1 2패스 + 툴별 리트랙트 +
//     재료 겹침 우선순위 B > A + 재료별 커버리지)이 규격서 v0.3.4(Task0 리포 docs/Task0_Gcode_규격서_초안.md @ a4ebc6c)
//     §5(툴별 리트랙트 상태 기계·전환 순서 E−r → T1 → 트래블 → E+r → 도포·층 끝 모든 툴 리트랙트)·§6(층 안 T0/T1 순차,
//     기본 A(T0) → B(T1), 동시 토출 없음)·§3(도포 = 노광, 2재료 경계 물림은 합집합 안이면 허용)·§7(트래블 교차 0)대로인지.
//     설계 = docs/계획_하이브리드슬라이서설정_20260928.md §5-3(R_B = PB, R_A = PA − R_B), §5-2(서포트 = A).
//
//   (A) 2재료 픽스처 (world 삼각형을 스크립트 안에서 만든다, 메시마다 슬롯) × lh 0.1·0.05:
//       ① 서포트 기둥(A) 4개 + 판(B) — 기둥만 있는 층·둘 다 있는 층·판만 있는 층. 왼쪽 기둥 둘은 판 모서리에 걸쳐
//          판 높이에도 A 가 남고, 오른쪽 둘은 판 아래 묻혀 판 높이 층에서 B 에 완전히 덮인다(그 자리 A 도포 0)
//       ② 겹친 두 상자 A·B — 겹친 곳은 B 만
//       ③ A 가 B 를 둘러싼 U 자(+Y 쪽이 열림, B 가 A 에 0.2 mm 물림) — 전환 트래블이 칠한 A 를 돌아 U 입구로 들어가야 한다
//       ④ 같은 자리 A / 빈 층 / B / A 쌓기 — 층에 한 재료만 있을 때 층 머리 T 줄(직전 층 끝 툴 기준), 빈 층 T·E 줄 0
//       ⑤ A 판을 가르는 0.32 mm B 막대(A 위 가장자리 밖으로 나감) — B 는 행이 없어 두 번째 패스에서 중심선 채움 + 경로 계획
//       (재작업 회귀 — 리뷰 FAIL 재현, lh 0.1) ⑥ 모서리 점 도포: A 상자 (−4.2,0,−4.2)–(4.2,1,4.2) + B (4.3,0,3.5)–(8,1,8) —
//          A 패스가 점 도포 이음점에서 끝나 전환 L자 둘째 다리가 그 점 도포를 실제로 가로지른 채 '통과'로 보고되던 배치(c4b)
//       ⑦ 두 상자 sweep 의 실패 배치 셋(A 8.4 틈 0.3 dz 0 / A 8.4 틈 0.1 dz −1 — 전 층 실패, A 7.4 틈 0.1 dz −0.7 — 보고 없는 교차)
//       ⑧ 구 지름 6 + 기둥 7 무작위 seed 1000·1012 전체 높이(70층 — 실패 층·B 우선 위반(점 도포가 PB 로 0.1 mm)이 있던 시드)
//       ⑨ 20° 기울인 판 B + 기둥 12 개 (64층 — 맨 위 층 0.53 mm 띠가 채움 점에 갇혀 실패하던 단면)
//       ⑩ 리뷰 무작위 스트레스(stressModel — 돌린 상자 A·B 섞기 / 구 + 기둥) 중 두 번째 패스 행을 반대 끝으로 들어가야 하는 둘
//          ⑥~⑩ 은 전 층 통과 + 실패 아닌 층의 c4b 0 이어야 하고, 고치기 전 구현에서는 실패(교차 또는 실패 층)가 난다.
//          새 장치를 하나씩 끈 구현(엄격 판정·변형 계획·행 양방향·막힘 재계획·짧은 행 빼기·점 도포 줄이기)도 각각 여기서 실패한다
//          (재작업 보고의 변조 실측).
//     출력마다 검사 (runDualOutputChecks — gen-task0-dryrun 파일 D 도 이것을 쓴다):
//       c1 Task0 파서 이식판 dryrun(keepE false — T 줄은 경고 없이 버려짐 / true)·print 경고·오류 0, 빈 층 일치
//       c2 줄 형식 — 2재료라 층 블록 안 T0/T1 줄 허용, 나머지 verify-task0-writer c2 그대로
//       c3 **툴별** 리트랙트 상태 기계 (verify-task0-writer checkRetract — D1a 에서 툴별로 확장): T 줄을 따라 툴별 상태,
//          모든 툴 리트랙트로 시작, 층마다 툴별 순변화 0·E+r 수 = E−r 수, T 전환 직전 지금 툴 리트랙트, 전환 뒤 첫 도포 앞 E+r,
//          인접 규칙(E+r 다음 = 도포, E−r 다음 = T·트래블·층 끝), 층 끝 모든 툴 리트랙트
//       c4·c4b 트래블 교차 0 — **모든 툴**의 칠한 선분 기준(전환 트래블 포함, T 줄은 트래블 경로를 끊지 않는다)
//       c5 툴 패스마다 +Y 단조(띠)·행 간격 — 띠 원점 = 그 재료 단면 최소 Y. **2재료 패스 규칙**(재작업): 행 방향·띠 방향 번갈아는
//          보지 않는다(막힌 끝을 피해 반대 끝으로 들어갈 수 있게) — 대신 한 띠 안 항목은 한 방향 X 순서, 한 행 구간끼리 간격 ≥ w,
//          띠 번호 비감소·띠 경계 자르기는 그대로. 행만 있는 층의 L자 모양도 안 본다(교차는 c4·c4b). 앞 패스는 층 첫 트래블 = 직선
//          1줄을 그대로 보고, 두 번째 패스는 트래블 모양 자유(전환 트래블)
//       c6 E 잔차 이월 — 툴별 누적(플런저가 따로), |E| ≤ 500   c7 출력 가능 영역
//       c8 툴 패스마다 독립 참조 행 구간과 일치 — A = PA nonzero 구간 − PB nonzero 구간(writer 와 다른 구현: 끝점 사이 기초 구간
//          판정), B = PB. + 픽스처 단언
//       c10 (새) 툴 순서 — 층마다 T 줄 수 = 필요한 최소(직전 층 끝 툴 기준, ≤ 2), 쓸모없는 T 줄 0, 툴마다 한 번씩 순차(A→B→A 금지
//          = 동시·교대 토출 없음), 두 툴이면 A(T0) → B(T1), 재료 영역(래스터)이 없는 툴은 도포 0·있는 툴은 도포 > 0
//       통계 — writer 층별·툴별 통계 = G-code 재측정 (T 줄 수·툴별 도포 길이·리트랙트·E)
//       커버리지 — task0-coverage checkTask0DualGcodeCoverage: 재료마다 (a)(b)(c)(d)(A 는 PA − PB 영역), 넘침은 PA ∪ PB,
//          B 우선(T0 표본이 PB 안쪽 깊이 > 피치 0개)
//       c9 결정성 — 두 번 생성 같은 바이트, 입력 무변경
//   (B) 대조군 — 정상 출력을 글자로 변조: 전환 전 E−r 삭제 → c3 / 전환 뒤 E+r 삭제 → c3 / 쓸모없는 T 줄 → c10 /
//       층 머리 T0 삭제(A 패스를 T1 이 칠함) → c10
//   (C) writer 대조군 — 차집합 끔(subtractOverlap=false) → B 우선 검사·c8 FAIL / 툴 상태 하나(perToolRetract=false) →
//       툴별 c3 FAIL 이고 **툴을 모르는 c3(T 줄을 지운 출력)는 통과**(= 확장이 필요한 이유) / 우회 끔(thinFillDetour=false) →
//       c4 FAIL — 층마다 [A 패스 + 전환 트래블 + B 첫 도포] 만 남긴 모델에서도 두 재료 층마다 1건(= 전환 트래블), 우회 켬이면 0 /
//       순서 B→A(order 'BA') → c10 FAIL (기대 순서를 B→A 로 주면 나머지는 통과)
//   (D) 닫힌 고리(A 가 B 를 완전히 둘러쌈) — A→B 순서로는 B 로 들어갈 길이 없다: writer 가 그 층을 thinFill 'failed'
//       (unreachable > 0)로 보고하고, 내놓은 출력에도 교차 트래블이 없어야(c3·c4·c4b 통과). order 'BA' 면 통과함을 기록
//       (규격 §6 【미정】 "B 가 A 안에 갇힌 층은 B → A" — Task0 에 물을 거리). lh 0.1 만 — lh 0.05 는 bench-task0-dual ④
//       (같은 판정 함수 closedRingChecks, 실패 층이 두 배라 오래 걸려 상시 검증에서 뺐다).
//   (E) 단일 재료 회귀 — dualMaterial 없는 호출 = 옵션 키 없는 호출, 파일 A sha256 고정값(verify-task0-export 와 같은 값),
//       T 줄은 프리앰블뿐. 옵션 검사(경계 여유·부스러기 0 만, 슬롯 수·값).
//   (F) 라이브러리 단위 — rasterizeTask0Region = 두 래스터의 AND NOT, 커버리지 옵션 없는 호출 = 빈 옵션 호출,
//       넘침 합집합 기준(T0 선분이 R_A 에서 w 넘게 벗어나지만 PA ∪ PB 안 → 합집합 기준이면 넘침 통과, 자기 재료 영역 기준이면 FAIL),
//       엄격 판정 공유 함수 task0-fill-route task0TravelContactOk 와 이 검증의 c4b(verify-task0-writer legSegmentContact 규칙)가
//       무작위 정수 µm 경로·선분 6000 쌍에서 같은 판정.
//   (G) Task0 원본 파서(Python, @03c0519) — python·Task0 리포가 있으면 lh 0.1 출력들을 3모드로 직접 돌려 경고·오류 0,
//       없으면 SKIP(이식판 c1 으로 판정). 차분 검사의 원본 대조는 verify-task0-parser 가 맡는다.
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "FAIL"·"위반" 문자열을 출력한다.
//   실행: npx tsx scripts/verify-task0-dual.mjs   (선택) TASK0_DIR=<Task0 리포>, PYTHON=<python>
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  chainSegments,
  normalizeTriangleWinding,
  sliceTrianglesAtY,
} from "../src/features/v2/utils/slice-geometry.ts";
import {
  checkTask0DualGcodeCoverage,
  checkTask0LayerCoverage,
} from "../src/features/v2/utils/task0/task0-coverage.ts";
import { generateTask0Gcode, resolveTask0WriterParams } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import * as fillRoute from "../src/features/v2/utils/task0/task0-fill-route.ts";
import { rasterizeTask0Mask, rasterizeTask0Region } from "../src/features/v2/utils/task0/task0-mask.ts";
import { task0LayerPolygonsBed } from "../src/features/v2/utils/task0/task0-slice.ts";
import {
  LAYER,
  SNAP_TOL,
  Viol,
  boxTriangles,
  buildModel,
  checkArea,
  checkExtrusion,
  checkFormat,
  checkMonotone,
  checkParser,
  checkReference,
  checkRetract,
  checkTravelContact,
  checkTravelCrossing,
  classifyDeposits,
  concatTris,
  coverageSummary,
  dist,
  expectedEmptyLayers,
  fixtureCube10,
  joinLines,
  legSegmentContact,
  linesOf,
  meshesTopY,
  rotateTrisY,
  toolOfOp,
} from "./verify-task0-writer.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const TASK0_DIR = process.env.TASK0_DIR || path.resolve(REPO_ROOT, "..", "Task0");
/** Task0 원본 파서 커밋 (v0.2.1 — 규격서 v0.3.4 §12) */
const ORIGIN_PARSER_COMMIT = "03c0519";
/** 파일 A sha256 (Z1-c 고정값 — verify-task0-export.mjs EXPECTED_SHA.cube10 과 같은 값) */
const FILE_A_SHA = "dde08ea97b2e144dabc842d1257980bdd4d51fa59b7bf7453c463e5f264928b9";

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

// ── 픽스처 (world 좌표 Y-up, 베드 = world X + 75, world Z + 42.5) ─────────────

const box = (min, max, flip = false) => normalizeTriangleWinding(boxTriangles(min, max, flip));
/** 층 n 단면 높이 y 가 float32 경계 [y0, y1] 안 */
const within = (y, y0, y1) => Math.fround(y0) < y && y < Math.fround(y1);

/**
 * ① 서포트 기둥(A) 4개 + 판(B) — gen-task0-dryrun 파일 D 도 이 형상(lh 0.1 → 10층).
 *   판 B: world x −4..4 × z −3..3, Y 0.4..1.0 (베드 X 71..79 × Y 39.5..45.5).
 *   기둥 A 1.2 × 1.2, Y 0..0.6: 왼쪽 둘(중심 (−4, ∓3))은 판 모서리에 걸쳐 판 높이 층에도 L 자로 A 가 남는다.
 *   오른쪽 둘(중심 (2.5, ∓1.5) — 베드 X 76.9..78.1 × Y 40.4..41.6 / 43.4..44.6)은 판 아래에 묻혀 판 높이 층에서 B 에 덮인다.
 *   층: Y < 0.4 기둥만(T0) / 0.4..0.6 둘 다(T0 → T1) / > 0.6 판만(T1).
 */
export function fixtureDualPillarsPlate() {
  const centers = [
    [-4, -3],
    [-4, 3],
    [2.5, -1.5],
    [2.5, 1.5],
  ];
  return {
    name: "pillars-plate",
    meshes: () => [
      ...centers.map(([x, z]) => box([x - 0.6, 0, z - 0.6], [x + 0.6, 0.6, z + 0.6])),
      box([-4, 0.4, -3], [4, 1.0, 3]),
    ],
    slots: ["A", "A", "A", "A", "B"],
    solids: [[0, 1.0]],
    expectSeq: (y) => (y < Math.fround(0.4) ? [0] : y < Math.fround(0.6) ? [0, 1] : [1]),
    fixtureCheck: noToolDepositIn(0, "판 아래 묻힌 기둥 자리(판 높이 층)", [
      [76.9, 78.1, 40.4, 41.6],
      [76.9, 78.1, 43.4, 44.6],
    ], (y) => within(y, 0.4, 0.6)),
  };
}

/** ② 겹친 두 상자 — A world x −6..2, B x −2..6 (z −3..3, Y 0..1). 겹친 곳(베드 X 73..77)은 B 만 */
function fixtureOverlapBoxes() {
  return {
    name: "overlap-boxes",
    meshes: () => [box([-6, 0, -3], [2, 1, 3]), box([-2, 0, -3], [6, 1, 3])],
    slots: ["A", "B"],
    solids: [[0, 1]],
    expectSeq: () => [0, 1],
    fixtureCheck: noToolDepositIn(0, "겹친 곳(베드 X 73..77 — B 우선)", [[73, 77, 39.5, 45.5]], () => true),
  };
}

/**
 * ③ U 자 A(왼팔 x −8..−4, 오른팔 4..8, z −4.4..8 / 바닥 x −8..8, z −8..−4, 열린 쪽 +Y) + B(x·z −4.2..4.2 — A 와 0.2 겹침).
 *   A 패스는 팔 맨 위 행에서 끝나고 B 첫 점은 B 맨 아래 — 직선·L자는 칠한 팔을 가로지르므로 U 입구로 돌아 들어가야 한다.
 */
function fixtureURing() {
  return {
    name: "u-ring",
    meshes: () => [
      box([-8, 0, -4.4], [-4, 1, 8]),
      box([4, 0, -4.4], [8, 1, 8]),
      box([-8, 0, -8], [8, 1, -4]),
      box([-4.2, 0, -4.2], [4.2, 1, 4.2]),
    ],
    slots: ["A", "A", "A", "B"],
    solids: [[0, 1]],
    expectSeq: () => [0, 1],
    expectTransitionDetour: true,
    fixtureCheck: noToolDepositIn(0, "B 자리(0.2 물림 포함, 0.05 안쪽)", [[70.85, 79.15, 38.35, 46.65]], () => true),
  };
}

/** ④ 같은 자리(x·z −3..3) A Y 0..0.3 / 빈 틈 0.3..0.4 / B 0.4..0.7 / A 0.7..1.0 */
function fixtureSandwichGap() {
  return {
    name: "sandwich-gap",
    meshes: () => [box([-3, 0, -3], [3, 0.3, 3]), box([-3, 0.4, -3], [3, 0.7, 3]), box([-3, 0.7, -3], [3, 1.0, 3])],
    slots: ["A", "B", "A"],
    solids: [
      [0, 0.3],
      [0.4, 0.7],
      [0.7, 1.0],
    ],
    expectSeq: (y) => (y < Math.fround(0.3) ? [0] : y < Math.fround(0.4) ? [] : y < Math.fround(0.7) ? [1] : [0]),
  };
}

/**
 * ⑤ A 판(x·z −5..5, Y 0..1)을 가르는 0.32 mm B 막대(world x −0.16..0.16, z −4..6.4 — A 위 가장자리 밖으로 1.4 나감).
 *   B 는 행 구간이 0.32 < w 라 행 0줄 → 두 번째 패스에서 중심선 채움 + 경로 계획(앞 패스가 칠한 A 를 피해 막대 위 끝으로 들어감).
 *   치수 주의: 옆면 대각선이 단면과 만나는 점이 1 µm 의 반(…5 µm 끝)에 오면 slice-geometry chainSegments 의 1 µm 양자화 키가
 *   두 삼각형에서 다르게 반올림돼 단면이 열린 꺾은선 둘로 끊긴다(0.3 × 10.5 막대 lh 0.05 에서 실측 — 대각선 틈이 A 영역이 됨).
 *   기존 슬라이서 동작이라 여기서는 치수를 (폭·길이 × 단면 높이가 µm 정수가 되게) 골라 피한다.
 */
function fixtureSlotBar() {
  return {
    name: "slot-bar",
    meshes: () => [box([-5, 0, -5], [5, 1, 5]), box([-0.16, 0, -4], [0.16, 1, 6.4])],
    slots: ["A", "B"],
    solids: [[0, 1]],
    expectSeq: () => [0, 1],
    expectFillTool: 1,
    fixtureCheck: noToolDepositIn(0, "막대 자리(베드 X 74.84..75.16)", [[74.85, 75.15, 38.5, 48.9]], () => true),
  };
}

/**
 * 닫힌 고리 A(바깥 16, 안 8) + 안을 채운 B 8 정사각(맞닿음) — A→B 순서로는 B 로 들어갈 길이 없다.
 * (B 가 w 배수 크기라 B 패스가 행 끝에서 끝난다 — B→A 순서 기록용. 0.2 물림은 ③ U 자가 본다)
 */
export function fixtureClosedRing() {
  return {
    name: "closed-ring",
    meshes: () => [
      normalizeTriangleWinding(concatTris(boxTriangles([-8, 0, -8], [8, 1, 8]), boxTriangles([-4, 0, -4], [4, 1, 4], true))),
      box([-4, 0, -4], [4, 1, 4]),
    ],
    slots: ["A", "B"],
    solids: [[0, 1]],
    expectSeq: () => [0],
  };
}

/** 결정적 의사난수 (선형 합동) — bench-task0-dual 과 같은 식 */
export function makeRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 1) / 2147483648;
  };
}

/** 구 (위도 lat × 경도 lon 띠) — 바깥 법선은 normalizeTriangleWinding 이 맞춘다 */
export function sphereTriangles(cx, cy, cz, r, lat = 40, lon = 56) {
  const out = [];
  const P = (i, j) => {
    const th = (Math.PI * i) / lat;
    const ph = (2 * Math.PI * j) / lon;
    return [cx + r * Math.sin(th) * Math.cos(ph), cy - r * Math.cos(th), cz + r * Math.sin(th) * Math.sin(ph)];
  };
  for (let i = 0; i < lat; i++) {
    for (let j = 0; j < lon; j++) {
      const a = P(i, j);
      const b = P(i, j + 1);
      const c = P(i + 1, j + 1);
      const d = P(i + 1, j);
      if (i !== 0) out.push(...a, ...b, ...c);
      if (i !== lat - 1) out.push(...a, ...c, ...d);
    }
  }
  return Float32Array.from(out);
}

/** 원기둥 서포트 (n 각기둥, 바닥 y0 · 끝 y1) — 꼭짓점 각이 0.1 rad 어긋나 대각 µm 경계(chainSegments 1 µm 키)를 피한다 */
export function pillarTriangles(cx, cz, r, y0, y1, n = 12) {
  const out = [];
  const P = (k, y) => [cx + r * Math.cos((2 * Math.PI * k) / n + 0.1), y, cz + r * Math.sin((2 * Math.PI * k) / n + 0.1)];
  for (let k = 0; k < n; k++) {
    const a = P(k, y0);
    const b = P(k + 1, y0);
    const c = P(k + 1, y1);
    const d = P(k, y1);
    out.push(...a, ...c, ...b, ...a, ...d, ...c, cx, y1, cz, ...c, ...d, cx, y0, cz, ...a, ...b);
  }
  return Float32Array.from(out);
}

/** 구(반지름 R, 바닥 Y bottom) B + 원기둥 서포트 A [x, z, 반지름, 구 표면에서 묻힌 깊이] */
export function sphereOnPillars(R, bottom, pillars) {
  const cy = bottom + R;
  const meshes = [normalizeTriangleWinding(sphereTriangles(0, cy, 0, R))];
  const slots = ["B"];
  for (const [x, z, r, embed] of pillars) {
    const yS = cy - Math.sqrt(Math.max(0, R * R - x * x - z * z));
    meshes.push(normalizeTriangleWinding(pillarTriangles(x, z, r, 0, yS + embed)));
    slots.push("A");
  }
  return { meshes, slots };
}

/** 구 지름 6(바닥 Y 1.0) + 기둥 7개 무작위 (반지름 0.25~0.5, 묻힘 0.15~0.45) — seed 별 (bench ② 와 같은 생성) */
export function sphereSeedModel(seed) {
  const rnd = makeRand(seed);
  const pillars = [];
  for (let i = 0; i < 7; i++) {
    const ang = rnd() * 2 * Math.PI;
    const rr = rnd() * 2.4;
    pillars.push([rr * Math.cos(ang), rr * Math.sin(ang), 0.25 + rnd() * 0.25, 0.15 + rnd() * 0.3]);
  }
  return sphereOnPillars(3, 1.0, pillars);
}

/**
 * 기울인 판 B (10 × 1.5 × 6, Z 축으로 20° — 아랫면 높이가 X 따라 1.5 ~ 4.9, 64층) + 4 × 3 원기둥 서포트 A (끝 0.3 묻힘).
 * 맨 위 층(층 61)은 폭 0.53 mm 띠 — 행 구간이 E 1 눈금도 안 되는 28 µm 라 채움 점과 겹쳐 노즐이 갇히던 단면(단일 재료로 내도 실패).
 */
export function tiltedPlateModel() {
  const ang = (20 * Math.PI) / 180;
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const plate = boxTriangles([-5, 0, -3], [5, 1.5, 3]);
  const rot = plate.map((v, j, a) => {
    const k = j - (j % 3);
    const x = a[k];
    const y = a[k + 1];
    return j % 3 === 0 ? c * x - sn * y : j % 3 === 1 ? sn * x + c * y + 3.2 : v;
  });
  const meshes = [normalizeTriangleWinding(Float32Array.from(rot))];
  const slots = ["B"];
  for (const x of [-3.6, -1.2, 1.2, 3.6]) {
    for (const z of [-2, 0, 2]) {
      // 판 아랫면 직선 y = tan(20°)·x + 3.2 (아랫면 점 (x0, 0) 이 (c·x0, s·x0 + 3.2) 로)
      meshes.push(normalizeTriangleWinding(pillarTriangles(x, z, 0.35, 0, Math.tan(ang) * x + 3.2 + 0.3)));
      slots.push("A");
    }
  }
  return { meshes, slots };
}

/**
 * 리뷰 무작위 스트레스 생성기(재작업 리뷰 재현물 stress.mjs 와 같은 식·같은 난수 순서) — seed 로 시작해 k 번째 모델까지 다시 만든다.
 *   k % 3 == 0: 구 B + 기둥 A(끝 묻힘, 구 아래쪽 3 mm 만 — topY 3.0 으로 자름) / 그 밖: 돌린 상자 A·B 섞기. thin = 가는 기둥·막대 섞기.
 */
export function stressModel(seedArg, kTarget, thin = false) {
  let seed = seedArg;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const shift = (t, cx, cy, cz) => t.map((v, j) => (j % 3 === 0 ? v + cx : j % 3 === 1 ? v + cy : v + cz));
  const pillarPlain = (cx, cz, r, y0, y1, n = 12) => {
    const out = [];
    const P = (k, y) => [cx + r * Math.cos((2 * Math.PI * k) / n), y, cz + r * Math.sin((2 * Math.PI * k) / n)];
    for (let k = 0; k < n; k++) {
      const a = P(k, y0);
      const b = P(k + 1, y0);
      const c = P(k + 1, y1);
      const d = P(k, y1);
      out.push(...a, ...c, ...b, ...a, ...d, ...c, cx, y1, cz, ...c, ...d, cx, y0, cz, ...a, ...b);
    }
    return Float32Array.from(out);
  };
  for (let k = 0; ; k++) {
    const meshes = [];
    const slots = [];
    const kind = k % 3;
    if (kind === 0) {
      const R = 2 + rnd() * 2.5;
      const cy = 0.8 + R;
      meshes.push(normalizeTriangleWinding(sphereTriangles(0, cy, 0, R, 32, 48)));
      slots.push("B");
      const np = 3 + Math.floor(rnd() * 6);
      for (let i = 0; i < np; i++) {
        const ang = rnd() * 2 * Math.PI;
        const rr = rnd() * R * 0.85;
        const x = rr * Math.cos(ang);
        const z = rr * Math.sin(ang);
        const yS = cy - Math.sqrt(Math.max(0, R * R - x * x - z * z));
        meshes.push(normalizeTriangleWinding(pillarPlain(x, z, thin ? 0.12 + rnd() * 0.2 : 0.25 + rnd() * 0.35, 0, yS + 0.15 + rnd() * 0.3)));
        slots.push("A");
      }
    } else {
      const nb = 2 + Math.floor(rnd() * 4);
      for (let i = 0; i < nb; i++) {
        const hx = thin && rnd() < 0.5 ? 0.12 + rnd() * 0.2 : 0.2 + rnd() * 3;
        const hz = 0.2 + rnd() * 3;
        const y0 = rnd() * 0.3;
        const y1 = y0 + 0.3 + rnd() * 0.5;
        meshes.push(normalizeTriangleWinding(shift(rotateTrisY(boxTriangles([-hx, y0, -hz], [hx, y1, hz]), rnd() * Math.PI), (rnd() - 0.5) * 10, 0, (rnd() - 0.5) * 8)));
        slots.push(i === 0 ? "A" : i === 1 ? "B" : rnd() < 0.5 ? "A" : "B");
      }
    }
    if (k === kTarget) {
      const topY = meshesTopY(meshes);
      return { meshes, slots, topY: kind === 0 ? Math.min(topY, 3.0) : topY };
    }
  }
}

/** 두 상자 sweep 배치 — A 정사각(한 변 a, 높이 1) 오른쪽 위 모서리 옆에 B 3.7 × 4.5 (틈 gap, Z 어긋남 dz) */
export function twoBoxMeshes(a, gap, dz) {
  const h = a / 2;
  return [box([-h, 0, -h], [h, 1.0, h]), box([h + gap, 0, h + dz], [h + gap + 3.7, 1.0, h + dz + 4.5])];
}

/** 재작업 회귀 픽스처 (lh 0.1 만) — 고치기 전 구현에서 교차를 통과로 내거나 층 실패가 나던 배치 */
function regressionFixtures() {
  const out = [
    {
      name: "corner-dot",
      // 리뷰 FAIL 재현: A 패스가 맨 위 띠 채움의 점 도포 이음점에서 끝나고, 전환 L자 둘째 다리가 그 점 도포 중심선을 가로질렀다
      meshes: () => [box([-4.2, 0, -4.2], [4.2, 1, 4.2]), box([4.3, 0, 3.5], [8, 1, 8])],
      slots: ["A", "B"],
      solids: [[0, 1]],
      expectSeq: () => [0, 1],
    },
  ];
  for (const [a, gap, dz] of [
    [8.4, 0.3, 0],
    [8.4, 0.1, -1],
    [7.4, 0.1, -0.7],
  ]) {
    out.push({
      name: `two-box-A${a}-gap${gap}-dz${dz}`,
      meshes: () => twoBoxMeshes(a, gap, dz),
      slots: ["A", "B"],
      solids: [[0, 1]],
      expectSeq: () => [0, 1],
    });
  }
  for (const seed of [1000, 1012]) {
    const m = sphereSeedModel(seed);
    out.push({ name: `sphere-seed${seed}`, meshes: () => m.meshes, slots: m.slots, solids: [[0, meshesTopY(m.meshes)]] });
  }
  {
    const m = tiltedPlateModel();
    out.push({ name: "tilted-plate", meshes: () => m.meshes, slots: m.slots, solids: [[0, meshesTopY(m.meshes)]] });
  }
  // 리뷰 무작위 스트레스에서 두 번째 패스 행을 반대 끝으로 들어가야 통과하는 모델 둘 (rowsEitherWay 를 끄면 실패)
  for (const [seed, k] of [
    [11, 5],
    [7, 6],
  ]) {
    const m = stressModel(seed, k);
    out.push({ name: `stress-s${seed}-k${k}`, meshes: () => m.meshes, slots: m.slots, topY: m.topY, solids: meshYRanges(m.meshes) });
  }
  return out.map((f) => ({ ...f, lhs: [0.1] }));
}

/** 툴 tool 의 도포 표본(0.01 mm 간격)이 사각형들 [x0, x1, y0, y1] 안에 없어야 (단면 높이 y 가 layerPred 인 층만) */
function noToolDepositIn(tool, label, rects, layerPred) {
  return (model, ctx) => {
    const out = [];
    for (const layer of model.layers) {
      if (!layerPred((layer.index + 0.5) * ctx.lh)) continue;
      for (const d of layer.ops) {
        if (d.kind !== "deposit" || d.tool !== tool) continue;
        const n = Math.max(2, Math.ceil(dist(d.from, d.to) / 0.01));
        let hit = false;
        for (let k = 0; k <= n && !hit; k++) {
          const x = d.from[0] + ((d.to[0] - d.from[0]) * k) / n;
          const y = d.from[1] + ((d.to[1] - d.from[1]) * k) / n;
          hit = rects.some(([x0, x1, y0, y1]) => x > x0 && x < x1 && y > y0 && y < y1);
        }
        if (hit) out.push(`${label} 에 T${tool} 도포 (층 ${layer.index}, 줄 ${d.lineNo})`);
      }
    }
    return [...new Set(out)].slice(0, 5);
  };
}

// ── 독립 참조: 재료별 행 구간 ──────────────────────────────────────────────
//   writer 와 다른 구현 — 단면은 slice-geometry 를 직접(task0-slice 를 거치지 않음), 구간 교차는 a 기준 보간,
//   차집합은 "모든 끝점 사이 기초 구간의 가운데가 A 안이고 B 밖" 판정(writer 는 정렬 구간 훑기).

function refPolys(meshes, n, lh, bedW, bedD) {
  const out = [];
  for (const m of meshes) {
    for (const p of chainSegments(sliceTrianglesAtY(m, (n + 0.5) * lh))) out.push(p.points.map(([x, z]) => [x + bedW / 2, z + bedD / 2]));
  }
  return out;
}

function refEdges(polys) {
  const edges = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pts of polys) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      yMin = Math.min(yMin, a[1]);
      yMax = Math.max(yMax, a[1]);
      if (a[1] !== b[1]) edges.push({ a, b });
    }
  }
  return { edges, yMin, yMax };
}

/** 행 y 의 nonzero 구간 [s, e) — 맞닿은 구간은 이음 */
function refSpansAt(edges, y) {
  const hits = [];
  for (const { a, b } of edges) {
    const lo = Math.min(a[1], b[1]);
    const hi = Math.max(a[1], b[1]);
    if (y < lo || y >= hi) continue;
    hits.push({ x: a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), dir: a[1] < b[1] ? 1 : -1 });
  }
  hits.sort((p, q) => p.x - q.x);
  const out = [];
  let wnd = 0;
  for (let i = 0; i + 1 < hits.length; i++) {
    wnd += hits[i].dir;
    if (wnd === 0) continue;
    const s = hits[i].x;
    const e = hits[i + 1].x;
    const last = out.length ? out[out.length - 1] : null;
    if (last && s - last[1] <= 1e-9) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out.filter(([s, e]) => e - s > 1e-9);
}

/** a − b — 끝점 사이 기초 구간마다 가운데가 a 안·b 밖이면 남김, 이어진 것은 합침 */
function refSubtract(a, b) {
  const cuts = [...new Set([...a, ...b].flat())].sort((p, q) => p - q);
  const inside = (spans, x) => spans.some(([s, e]) => s <= x && x < e);
  const out = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    if (!inside(a, mid) || inside(b, mid)) continue;
    const last = out.length ? out[out.length - 1] : null;
    if (last && last[1] === cuts[i]) last[1] = cuts[i + 1];
    else out.push([cuts[i], cuts[i + 1]]);
  }
  return out.filter(([s, e]) => e - s > 1e-9);
}

const snap3 = (v) => Math.round(v * 1000) / 1000;

/**
 * E 1 눈금(1e-5 mm)도 안 되는 행 구간인지 — 판정에 원래 안 세는 구간이라 2재료 경로 계획 패스는 내지 않는다(writer 머리 주석
 * "층 계획"). B안 행 그대로 내는 패스는 낸다. 그래서 참조 행 구간에서 빼고, 낸 줄은 행·채움 어느 쪽으로도 세지 않는다.
 */
const subTickSpan = (lenMm, rate) => lenMm * rate * 1e5 < 1;

/** 재료 하나의 참조 행 — 행 위상·종료는 그 재료 단면 Pm, 구간은 Pm − ex(있으면) 를 w/2 줄여 1 µm 격자 (E 1 눈금 미만 구간 제외) */
function refMaterialLayer(polysM, polysEx, w, present, rate) {
  const { edges, yMin, yMax } = refEdges(polysM);
  const ex = polysEx ? refEdges(polysEx).edges : null;
  const rows = [];
  if (Number.isFinite(yMin)) {
    for (let k = 0; ; k++) {
      const y = yMin + (k + 0.5) * w;
      if (!(y < yMax - w / 2 + 1e-9)) break;
      let raw = refSpansAt(edges, y);
      if (ex) raw = refSubtract(raw, refSpansAt(ex, y));
      const expect = [];
      for (const [s, e] of raw) {
        const a = snap3(s + w / 2);
        const b = snap3(e - w / 2);
        if (b > a && !subTickSpan(b - a, rate)) expect.push([a, b]);
      }
      rows.push({ y, ySnap: snap3(y), raw, expect });
    }
  }
  const rowRemainder = polysM.length ? Math.max(0, snap3(yMax - yMin - rows.length * w)) : 0;
  // polygons — c8 "단면이 있는데 도포 0" 판정용: 재료 영역(래스터)이 있으면 1
  return { polygons: present ? 1 : 0, rows, yMin, yMax, rowRemainder };
}

/** 층 하나의 재료별 참조 + 재료 영역 있음(래스터 — 검사기와 같은 정의: A = raster(PA) − raster(PB), B = raster(PB)) */
function dualReference(split, n, lh, p) {
  const pa = refPolys(split.A, n, lh, p.bedWidthMm, p.bedDepthMm);
  const pb = refPolys(split.B, n, lh, p.bedWidthMm, p.bedDepthMm);
  const presentA = rasterizeTask0Region(pa, pb, { roi: "bbox" }).whitePixels > 0;
  const presentB = rasterizeTask0Mask(pb, { roi: "bbox" }).whitePixels > 0;
  const rate = (p.depositWidthMm * lh * p.overfill) / p.syringeKMm3PerMm;
  return {
    A: refMaterialLayer(pa, pb, p.depositWidthMm, presentA, rate),
    B: refMaterialLayer(pb, null, p.depositWidthMm, presentB, rate),
    present: [presentA, presentB],
  };
}

function splitBySlot(meshes, slots) {
  const out = { A: [], B: [] };
  slots.forEach((s, i) => out[s].push(meshes[i]));
  return out;
}

// ── 툴 패스 나누기 ────────────────────────────────────────────────────────

/**
 * 층마다 툴별 부분 층 — T 줄을 따라 지금 툴(프리앰블 T0 에서 시작, 층을 넘어 이어짐)에 op 를 나눈다. op.tool 도 매긴다.
 * passOrder[n] = 그 층에서 도포한 툴 순서(처음 도포한 순).
 */
function splitPasses(model) {
  let tool = 0;
  const perTool = [{ layers: [] }, { layers: [] }];
  const passOrder = [];
  for (const layer of model.layers) {
    const sub = [0, 1].map(() => ({ index: layer.index, lineNo: layer.lineNo, ops: [] }));
    const order = [];
    for (const op of layer.ops) {
      const t = toolOfOp(op);
      if (t >= 0) {
        tool = t;
        continue;
      }
      op.tool = tool;
      sub[tool].ops.push(op);
      if (op.kind === "deposit" && !order.includes(tool)) order.push(tool);
    }
    perTool[0].layers.push(sub[0]);
    perTool[1].layers.push(sub[1]);
    passOrder.push(order);
  }
  return { perTool, passOrder };
}

// ── c10 툴 순서 ──────────────────────────────────────────────────────────

/**
 * c10 — 층마다: T 줄 수 = 필요한 최소(첫 도포 툴 ≠ 직전 층 끝 툴이면 1 + 툴 전환 수, ≤ 2), T 줄이 지금 툴과 같으면 위반,
 * 도포 툴 순서가 툴마다 한 번(A→B→A 같은 교대 금지 — 순차·동시 토출 없음), 두 툴이면 ctx.expectOrder(기본 [0, 1] = A(T0) → B(T1)),
 * 재료 영역(ctx.dualRefs[n].present)이 없는 툴은 도포 0, 있는 툴은 도포 > 0.
 */
export function checkToolOrder(model, ctx) {
  const v = new Viol();
  const expectOrder = ctx.expectOrder ?? [0, 1];
  let tool = 0;
  for (const layer of model.layers) {
    const startTool = tool;
    let tLines = 0;
    const seq = [];
    const deposits = [0, 0];
    for (const op of layer.ops) {
      const t = toolOfOp(op);
      if (t >= 0) {
        tLines++;
        if (t === tool) v.add(`T${t} 줄이 지금 툴과 같음 (쓸모없는 전환)`, op.lineNo);
        tool = t;
      } else if (op.kind === "deposit") {
        deposits[tool]++;
        if (seq[seq.length - 1] !== tool) seq.push(tool);
      }
    }
    if (tLines > 2) v.add(`층 T 줄 ${tLines}개 > 2`, layer.lineNo);
    if (new Set(seq).size !== seq.length) v.add(`층 안 도포 툴이 교대 (${seq.map((t) => `T${t}`).join("→")}) — 툴마다 한 번씩 순차여야`, layer.lineNo);
    if (seq.length === 2 && (seq[0] !== expectOrder[0] || seq[1] !== expectOrder[1])) {
      v.add(`층 안 순서 ${seq.map((t) => `T${t}`).join("→")} ≠ 기대 T${expectOrder[0]}→T${expectOrder[1]} (규격 §6 기본 A → B)`, layer.lineNo);
    }
    const uniq = [...new Set(seq)];
    const minimal = uniq.length === 0 ? 0 : (uniq[0] !== startTool ? 1 : 0) + (uniq.length - 1);
    if (tLines !== minimal) v.add(`층 T 줄 ${tLines}개 ≠ 필요 ${minimal}개 (직전 층 끝 툴 T${startTool})`, layer.lineNo);
    const present = ctx.dualRefs?.[layer.index]?.present;
    if (present) {
      for (const t of [0, 1]) {
        const name = t === 0 ? "A" : "B";
        if (!present[t] && deposits[t] > 0) v.add(`재료 ${name} 영역이 없는 층에 T${t} 도포`, layer.lineNo);
        if (present[t] && deposits[t] === 0) v.add(`재료 ${name} 영역이 있는데 T${t} 도포 0`, layer.lineNo);
      }
    }
  }
  return v.list;
}

// ── 출력 검사 묶음 ────────────────────────────────────────────────────────

export const DUAL_CHECK_LABELS = {
  c1: "c1 Task0 파서 3모드 경고·오류 0",
  c2: "c2 줄 형식 (층 안 T0/T1 허용)",
  c3: "c3 툴별 리트랙트 상태 기계 (모든 툴 리트랙트로 시작, 툴별 순변화 0, T 전환 직전 E−r, 인접 규칙)",
  c4: "c4 트래블 교차 0 (모든 툴의 칠한 선분, 전환 트래블 포함)",
  c4b: "c4b 트래블 다리·칠한 중심선 실제 교차 0",
  c5: "c5 툴 패스마다 +Y 단조(띠)·띠 방향·행 간격",
  c6: "c6 E 잔차 이월(툴별)·|E|≤500",
  c7: "c7 출력 가능 영역",
  c8: "c8 재료별 참조 행 구간 일치(A = PA − PB)·픽스처 단언",
  c10: "c10 툴 순서 (T 줄 최소·≤2, 순차, A→B, 재료 있는 툴만)",
};

/**
 * 2재료 출력 검사 전부 — { c1…c10: [위반] } (gen-task0-dryrun 파일 D 도 이것을 쓴다).
 * ctx = { name, meshes, slots, topY, lh, params, expectedEmpty, expectOrder?, fixtureCheck? } — ctx.dualRefs·passOrder 를 채운다.
 */
export function runDualOutputChecks(gcode, ctx) {
  const p = ctx.params;
  const model = buildModel(gcode, [p.parkXMm, p.parkYMm]);
  const split = splitBySlot(ctx.meshes, ctx.slots);
  ctx.dualRefs = model.layers.map((l) => dualReference(split, l.index, ctx.lh, p));
  const { perTool, passOrder } = splitPasses(model);
  ctx.passOrder = passOrder;
  const c5 = [];
  const c8 = [];
  for (const t of [0, 1]) {
    const refs = ctx.dualRefs.map((r) => (t === 0 ? r.A : r.B));
    for (const layer of perTool[t].layers) classifyDeposits(layer, refs[layer.index]);
    const first = { layers: perTool[t].layers.filter((l) => passOrder[l.index].indexOf(t) <= 0) };
    const later = { layers: perTool[t].layers.filter((l) => passOrder[l.index].indexOf(t) > 0) };
    c5.push(...checkMonotone(first, { ...ctx, refLayers: refs, relaxRowDirection: true }).map((m) => `T${t}: ${m}`));
    c5.push(
      ...checkMonotone(later, { ...ctx, refLayers: refs, relaxRowDirection: true, relaxTravelShape: true }).map(
        (m) => `T${t} (두 번째 패스): ${m}`,
      ),
    );
    c8.push(...checkReference(perTool[t], { ...ctx, refLayers: refs, fixtureCheck: null }).map((m) => `T${t}: ${m}`));
  }
  if (ctx.fixtureCheck) c8.push(...ctx.fixtureCheck(model, ctx));
  return {
    c1: checkParser(gcode, ctx),
    c2: checkFormat(gcode, { ...ctx, dual: true }),
    c3: checkRetract(model, ctx),
    c4: checkTravelCrossing(model, ctx),
    c4b: checkTravelContact(model, ctx),
    c5,
    c6: checkExtrusion(model, ctx),
    c7: checkArea(model),
    c8,
    c10: checkToolOrder(model, ctx),
  };
}

/** 통계 — writer 층별·툴별 통계가 G-code 에서 다시 잰 값과 같음 (runDualOutputChecks 뒤에 — ctx.dualRefs 를 쓴다) */
export function checkDualStats(result, ctx) {
  const v = new Viol();
  const p = ctx.params;
  const model = buildModel(result.gcode, [p.parkXMm, p.parkYMm]);
  const { perTool } = splitPasses(model);
  for (const t of [0, 1]) {
    for (const layer of perTool[t].layers) classifyDeposits(layer, (t === 0 ? ctx.dualRefs[layer.index].A : ctx.dualRefs[layer.index].B));
  }
  if (result.layers.length !== model.layers.length) v.add("층 통계 개수 ≠ 층 수");
  const rate = (p.depositWidthMm * ctx.lh * p.overfill) / p.syringeKMm3PerMm;
  const refRowsAt = (ref, t) => (t === 0 ? ref.A.rows : ref.B.rows);
  let tool = 0;
  let tAll = 0;
  const totalBy = [0, 1].map(() => ({ segments: 0, depositMm: 0, retracts: 0, unretracts: 0, e: 0 }));
  model.layers.forEach((layer, i) => {
    const s = result.layers[i];
    if (!s) return;
    const by = [0, 1].map(() => ({ segments: 0, depositMm: 0, retracts: 0, unretracts: 0, e: 0 }));
    let trav = 0;
    let tLines = 0;
    let fillSegs = 0;
    for (const op of layer.ops) {
      const t = toolOfOp(op);
      if (t >= 0) {
        tool = t;
        tLines++;
        continue;
      }
      if (op.kind === "deposit") {
        by[tool].segments++;
        by[tool].depositMm += dist(op.from, op.to);
        by[tool].e += op.args.E;
        // 채움 줄 = 행 줄이 아닌 도포 — 단 E 1 눈금 미만 행 구간(B안 행 그대로 낸 패스만 냄, 참조에서 뺌)은 writer 가 행으로 센다
        const subTickRow =
          op.from[1] === op.to[1] &&
          subTickSpan(Math.abs(op.to[0] - op.from[0]), rate) &&
          refRowsAt(ctx.dualRefs[layer.index], tool).some((r) => Math.abs(r.ySnap - op.to[1]) <= SNAP_TOL);
        if (op.rowK < 0 && !subTickRow) fillSegs++;
      } else if (op.kind === "travel") trav += dist(op.from, op.to);
      else if (op.kind === "eonly") op.args.E < 0 ? by[tool].retracts++ : by[tool].unretracts++;
    }
    tAll += tLines;
    const sum = (k) => by[0][k] + by[1][k];
    const empty = !layer.ops.some((op) => op.kind === "travel" || op.kind === "deposit");
    if (s.index !== i) v.add("층 통계 index 어긋남", layer.lineNo);
    if (s.empty !== empty) v.add("층 통계 empty ≠ G-code", layer.lineNo);
    if (s.segments !== sum("segments")) v.add("층 통계 segments ≠ 도포 줄 수", layer.lineNo);
    if (Math.abs(s.depositMm - sum("depositMm")) > 1e-6) v.add("층 통계 depositMm ≠ 도포 길이", layer.lineNo);
    if (Math.abs(s.travelMm - trav) > 1e-6) v.add("층 통계 travelMm ≠ 트래블 길이", layer.lineNo);
    if (s.retracts !== sum("retracts") || s.unretracts !== sum("unretracts")) v.add("층 통계 retracts/unretracts ≠ E 단독 줄 수", layer.lineNo);
    if (Math.abs(s.extrusionMm - sum("e")) > 1e-9) v.add("층 통계 extrusionMm ≠ 도포 E 합", layer.lineNo);
    if (s.toolChanges !== tLines) v.add(`층 통계 toolChanges ${s.toolChanges} ≠ T 줄 ${tLines}`, layer.lineNo);
    if (s.byTool.length !== 2) v.add("층 통계 byTool 이 툴 2개가 아님", layer.lineNo);
    for (const t of [0, 1]) {
      const b = s.byTool[t];
      if (!b || b.tool !== t) {
        v.add(`층 통계 byTool[${t}] 없음`, layer.lineNo);
        continue;
      }
      if (b.segments !== by[t].segments || Math.abs(b.depositMm - by[t].depositMm) > 1e-6) v.add(`층 통계 T${t} 도포 ≠ G-code`, layer.lineNo);
      if (b.retracts !== by[t].retracts || b.unretracts !== by[t].unretracts) v.add(`층 통계 T${t} E 단독 줄 ≠ G-code`, layer.lineNo);
      if (Math.abs(b.extrusionMm - by[t].e) > 1e-9) v.add(`층 통계 T${t} E 합 ≠ G-code`, layer.lineNo);
      for (const k of ["segments", "depositMm", "retracts", "unretracts", "e"]) totalBy[t][k] += by[t][k];
    }
    const ref = ctx.dualRefs[i];
    const remainder = Math.max(ref.A.rowRemainder, ref.B.rowRemainder);
    if (Math.abs(s.rowRemainderMm - remainder) > SNAP_TOL) v.add(`층 통계 rowRemainderMm ${s.rowRemainderMm} ≠ 독립 계산 ${remainder}`, layer.lineNo);
    if (s.fillSegments !== fillSegs) v.add(`층 통계 fillSegments ${s.fillSegments} ≠ 채움 줄 수 ${fillSegs}`, layer.lineNo);
    if ((s.thinFill === "none" && fillSegs > 0) || (s.thinFill === "filled" && fillSegs === 0)) {
      v.add(`층 통계 thinFill '${s.thinFill}' 와 채움 줄 수 ${fillSegs} 가 어긋남`, layer.lineNo);
    }
    if (s.unreachable > 0 && s.thinFill !== "failed") v.add("층 통계 unreachable > 0 인데 thinFill 이 'failed' 가 아님", layer.lineNo);
  });
  const t = result.totals;
  if (!t.dualMaterial) v.add("totals.dualMaterial 이 false");
  if (t.lineCount !== result.gcode.split("\n").length - 1) v.add("totals.lineCount ≠ 실제 줄 수");
  if (t.toolChanges !== tAll) v.add(`totals.toolChanges ${t.toolChanges} ≠ 층 블록 T 줄 ${tAll}`);
  for (const k of [0, 1]) {
    const b = t.byTool[k];
    if (!b || b.segments !== totalBy[k].segments || Math.abs(b.depositMm - totalBy[k].depositMm) > 1e-6) v.add(`totals.byTool[${k}] 도포 ≠ G-code`);
    if (!b || b.retracts !== totalBy[k].retracts || b.unretracts !== totalBy[k].unretracts) v.add(`totals.byTool[${k}] E 단독 줄 ≠ G-code`);
    if (!b || Math.abs(b.extrusionMm - totalBy[k].e) > 1e-9) v.add(`totals.byTool[${k}] E 합 ≠ G-code`);
  }
  if (Math.abs(t.extrusionMm - (totalBy[0].e + totalBy[1].e)) > 1e-9) v.add("totals.extrusionMm ≠ 도포 E 합");
  if (Math.abs(t.extrusionMm - t.extrusionExactMm) > 1e-5 + 1e-9) v.add("totals E 출력·정확 차 > 툴 2개 × 0.5e-5");
  const empties = model.layers.filter((l) => !l.ops.some((op) => op.kind === "deposit")).map((l) => l.index);
  if (JSON.stringify(t.emptyLayers) !== JSON.stringify(empties)) v.add("totals.emptyLayers ≠ G-code");
  const sumL = (key) => result.layers.reduce((acc, s) => acc + s[key], 0);
  for (const key of ["fillPieces", "fillDots", "fillSegments", "detourTravels", "unreachable", "toolChanges"]) {
    if (t[key] !== sumL(key)) v.add(`totals.${key} ≠ 층별 합`);
  }
  const byState = (st) => JSON.stringify(result.layers.filter((s) => s.thinFill === st).map((s) => s.index));
  if (JSON.stringify(t.thinFillLayers) !== byState("filled")) v.add("totals.thinFillLayers ≠ 층별 'filled'");
  if (JSON.stringify(t.thinFillFailedLayers) !== byState("failed")) v.add("totals.thinFillFailedLayers ≠ 층별 'failed'");
  return v.list;
}

/** 2재료 커버리지 요약 (gen-task0-dryrun 도 쓴다) */
export function dualCoverageSummary(rep) {
  return (
    `A(T0, PA−PB): ${coverageSummary({ worst: rep.worst.A })} / B(T1, PB): ${coverageSummary({ worst: rep.worst.B })} / ` +
    `B 우선 위반 표본 ${rep.overlapSamplesA} (T0 표본의 PB 안쪽 최대 깊이 ${rep.overlapMaxDepthMm.toFixed(4)} mm)`
  );
}

/** 메시마다 [최소 Y, 최대 Y] — 빈 층 기대 계산용 */
function meshYRanges(meshes) {
  return meshes.map((m) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < m.length; i += 3) {
      lo = Math.min(lo, m[i]);
      hi = Math.max(hi, m[i]);
    }
    return [lo, hi];
  });
}

export function makeDualCtx(fixture, lh, params) {
  const meshes = fixture.meshes();
  const topY = fixture.topY ?? meshesTopY(meshes);
  return {
    name: `${fixture.name} lh${lh}`,
    meshes,
    slots: fixture.slots,
    topY,
    lh,
    params,
    expectedEmpty: expectedEmptyLayers(fixture.solids, topY, lh),
    fixtureCheck: fixture.fixtureCheck ?? null,
  };
}

// ── Task0 원본 파서 (Python) ──────────────────────────────────────────────

const PY_HARNESS = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("task0_gcode_origin", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
jobs = json.load(open(sys.argv[2], encoding="utf-8"))
out = []
for job in jobs:
    res = []
    for mode, keep in (("dryrun", False), ("dryrun", True), ("print", True)):
        kw = {"mode": mode, "keep_e": keep}
        if mode == "print":
            kw["layer_height_mm"] = job["lh"]
        r = mod.parse_gcode_file(job["path"], **kw)
        res.append({
            "mode": mode, "keepE": keep, "warnings": r.warnings, "errors": r.errors,
            "layerCount": r.layer_count, "endFound": r.end_found,
            "empty": [b.layer_index for b in r.blocks if b.is_layer and not b.has_xy],
            "tLines": sum(1 for b in r.blocks for l in b.gcode.split("\\n") if l.strip() in ("T0", "T1")),
        })
    out.append(res)
json.dump(out, open(sys.argv[3], "w", encoding="utf-8"), ensure_ascii=False)
`;

function findPython() {
  const cands = process.env.PYTHON ? [[process.env.PYTHON, []]] : [["python", []], ["python3", []], ["py", ["-3"]]];
  for (const [cmd, pre] of cands) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], { encoding: "utf8" });
    const mm = r.status === 0 ? /^(\d+) (\d+)/.exec((r.stdout || "").trim()) : null;
    if (mm && Number(mm[1]) === 3 && Number(mm[2]) >= 7) return { cmd, pre, version: `${mm[1]}.${mm[2]}` };
  }
  return null;
}

/**
 * Task0 원본 파서(@03c0519)로 G-code 들을 3모드(dryrun E 끔·켬, print)로 — { skip: 사유 } 또는
 * { python, results: [[{mode, keepE, warnings, errors, layerCount, endFound, empty, tLines}] × 파일] }.
 * @param jobs [{ gcode, lh }]
 */
export function runTask0OriginalParser(jobs) {
  const py = findPython();
  if (!py) return { skip: "python 3.7+ 없음 (PYTHON 환경변수로 지정 가능)" };
  if (!fs.existsSync(path.join(TASK0_DIR, ".git"))) return { skip: `Task0 리포 없음 (${TASK0_DIR} — TASK0_DIR 로 지정 가능)` };
  const src = spawnSync("git", ["-C", TASK0_DIR, "show", `${ORIGIN_PARSER_COMMIT}:controllers/task0_gcode.py`], { maxBuffer: 64 << 20 });
  if (src.status !== 0) return { skip: `Task0 리포에 커밋 ${ORIGIN_PARSER_COMMIT} 없음` };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mazicalign-dual-py-"));
  try {
    const mod = path.join(tmp, "task0_gcode_origin.py");
    fs.writeFileSync(mod, src.stdout);
    fs.writeFileSync(path.join(tmp, "harness.py"), PY_HARNESS, "utf8");
    const list = jobs.map((j, i) => {
      const file = path.join(tmp, `job${i}.gcode`);
      fs.writeFileSync(file, j.gcode, "utf8");
      return { path: file, lh: j.lh };
    });
    fs.writeFileSync(path.join(tmp, "jobs.json"), JSON.stringify(list), "utf8");
    const outPath = path.join(tmp, "out.json");
    const r = spawnSync(py.cmd, [...py.pre, path.join(tmp, "harness.py"), mod, path.join(tmp, "jobs.json"), outPath], {
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
      maxBuffer: 64 << 20,
      timeout: 600000,
    });
    if (r.status !== 0) return { error: `python 종료 코드 ${r.status}: ${(r.stderr || r.error || "").toString().slice(-600)}` };
    return { python: `${[py.cmd, ...py.pre].join(" ")} ${py.version}`, results: JSON.parse(fs.readFileSync(outPath, "utf8")) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 본체 ─────────────────────────────────────────────────────────────────

function reportChecks(res, skip = []) {
  for (const key of Object.keys(DUAL_CHECK_LABELS)) {
    if (skip.includes(key)) continue;
    const list = res[key];
    assert(list.length === 0, `${DUAL_CHECK_LABELS[key]}${list.length ? " — " + list.slice(0, 3).join(" / ") : ""}`);
  }
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function sectionFixtures(params) {
  console.log("\n(A) 2재료 픽스처 출력 검사:");
  const outputs = new Map();
  const fixtures = [
    fixtureDualPillarsPlate(),
    fixtureOverlapBoxes(),
    fixtureURing(),
    fixtureSandwichGap(),
    fixtureSlotBar(),
    ...regressionFixtures(),
  ];
  for (const fixture of fixtures) {
    for (const lh of fixture.lhs ?? [0.1, 0.05]) {
      const ctx = makeDualCtx(fixture, lh, params);
      const snapshot = ctx.meshes.map((m) => Float32Array.from(m));
      const opts = { dualMaterial: { slots: fixture.slots } };
      const t0 = Date.now();
      const result = generateTask0Gcode(ctx.meshes, ctx.topY, lh, opts);
      const ms = Date.now() - t0;
      const t = result.totals;
      console.log(
        `\n  [${ctx.name}] 층 ${t.layerCount}, 빈 층 ${JSON.stringify(t.emptyLayers)}, T 전환 ${t.toolChanges}, ` +
          `T0 도포 ${t.byTool[0].depositMm.toFixed(3)} mm·E−r ${t.byTool[0].retracts} / T1 도포 ${t.byTool[1].depositMm.toFixed(3)} mm·E−r ${t.byTool[1].retracts}, ` +
          `우회 ${t.detourTravels}, 채움 층 ${t.thinFillLayers.length}, 줄 ${t.lineCount}, ${ms} ms`,
      );
      const res = runDualOutputChecks(result.gcode, ctx);
      reportChecks(res);
      const stats = checkDualStats(result, ctx);
      assert(stats.length === 0, `통계 = G-code 재측정 (층별·툴별)${stats.length ? " — " + stats.slice(0, 3).join(" / ") : ""}`);
      const cov = checkTask0DualGcodeCoverage(ctx.meshes, ctx.slots, ctx.topY, lh, result.gcode, { depositWidthMm: params.depositWidthMm });
      assert(
        cov.pass && cov.overlapSamplesA === 0,
        `재료별 커버리지 전 층 통과·B 우선 위반 0 — ${dualCoverageSummary(cov)}` +
          (cov.failedLayers.length ? ` / FAIL 층 ${JSON.stringify(cov.failedLayers.slice(0, 10))}` : ""),
      );
      assert(t.thinFillFailedLayers.length === 0 && t.unreachable === 0, `실패 층·경로 없는 항목 없음 (${JSON.stringify(t.thinFillFailedLayers)}, ${t.unreachable})`);
      // 층별 툴 순서 = 형상에서 기대한 순서 (기대를 적은 픽스처만 — 구 + 기둥은 c10 이 재료 영역으로 본다)
      if (fixture.expectSeq) {
        const bad = [];
        ctx.passOrder.forEach((seq, n) => {
          const want = fixture.expectSeq((n + 0.5) * lh);
          if (JSON.stringify(seq) !== JSON.stringify(want)) bad.push(`층 ${n}: ${JSON.stringify(seq)} ≠ ${JSON.stringify(want)}`);
        });
        assert(bad.length === 0, `층별 도포 툴 순서 = 형상 기대 (기둥만 T0 / 둘 다 T0→T1 / 판만 T1 등)${bad.length ? " — " + bad.slice(0, 3).join(" / ") : ""}`);
      }
      const variantLayers = t.routeVariantLayers ?? [];
      const flippedLayers = t.orderFlippedLayers ?? [];
      if (variantLayers.length || flippedLayers.length) {
        console.log(`    (기본 계획이 막혀 변형 계획을 쓴 층 ${JSON.stringify(variantLayers)}, 순서 뒤집은 층 ${JSON.stringify(flippedLayers)})`);
      }
      // T 줄 = 툴 전환, 층마다 ≤ 2 (c10 이 정확한 수를 봄) — 합계도 단언
      assert(
        result.layers.every((s) => s.toolChanges <= 2),
        `층마다 T 줄 ≤ 2 (최대 ${Math.max(...result.layers.map((s) => s.toolChanges))})`,
      );
      if (fixture.expectTransitionDetour) {
        const both = result.layers.filter((s) => s.byTool[0].segments > 0 && s.byTool[1].segments > 0);
        assert(
          both.length > 0 && both.every((s) => s.detourTravels > 0),
          `전환 트래블 우회 — 두 재료 층 ${both.length}개 모두 우회 트래블 있음 (층당 최소 ${Math.min(...both.map((s) => s.detourTravels))})`,
        );
      }
      if (fixture.expectFillTool !== undefined) {
        const tool = fixture.expectFillTool;
        const model = buildModel(result.gcode, [params.parkXMm, params.parkYMm]);
        splitPasses(model);
        const fillT = model.layers.filter((l) => l.ops.some((op) => op.kind === "deposit" && op.tool === tool && op.from[1] !== op.to[1]));
        assert(
          fillT.length === t.layerCount && t.thinFillLayers.length === t.layerCount,
          `두 번째 패스(T${tool}) 중심선 채움 — 층 ${fillT.length}/${t.layerCount} 에 T${tool} 사선·세로 도포, 채움 층 ${t.thinFillLayers.length}`,
        );
      }
      const again = generateTask0Gcode(fixture.meshes(), ctx.topY, lh, opts);
      const unchanged = ctx.meshes.every((m, i) => m.length === snapshot[i].length && m.every((x, j) => Object.is(x, snapshot[i][j])));
      assert(again.gcode === result.gcode && unchanged, "c9 결정성 — 두 번 생성 같은 바이트, 입력 배열 무변경");
      outputs.set(ctx.name, { ctx, result, fixture });
    }
  }
  return outputs;
}

// ── (B) 글자 변조 대조군 ──────────────────────────────────────────────────

/** 두 재료 층(T1 줄이 가운데 있는 층)의 T1 줄 index — 바로 앞이 E−r */
function midT1(lines) {
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "T1" && /^G1 E-/.test(lines[i - 1])) return i;
  }
  throw new Error("두 재료 층의 T1 전환이 없음");
}

const DUAL_MUTATIONS = [
  {
    id: "(d-i)",
    desc: "T1 전환 직전 E−r 삭제 (T0 을 언리트랙트로 둔 채 전환)",
    base: "pillars-plate lh0.1",
    target: "c3",
    mutate(lines) {
      const i = midT1(lines);
      lines.splice(i - 1, 1);
    },
  },
  {
    id: "(d-ii)",
    desc: "T1 전환 뒤 첫 도포 앞 E+r 삭제 (T1 이 리트랙트 상태로 도포)",
    base: "pillars-plate lh0.1",
    target: "c3",
    mutate(lines) {
      const i = midT1(lines);
      let j = i + 1;
      while (!/^G1 E[0-9]/.test(lines[j])) j++;
      lines.splice(j, 1);
    },
  },
  {
    id: "(d-iii)",
    desc: "T1 줄을 두 번 (쓸모없는 전환)",
    base: "pillars-plate lh0.1",
    target: "c10",
    mutate(lines) {
      const i = midT1(lines);
      lines.splice(i, 0, "T1");
    },
  },
  {
    id: "(d-iv)",
    desc: "층 머리 T0 삭제 (A 패스를 T1 이 칠함)",
    base: "pillars-plate lh0.1",
    target: "c10",
    mutate(lines) {
      const i = lines.findIndex((l, k) => l === "T0" && /^G1 Z/.test(lines[k - 1] ?? ""));
      if (i < 0) throw new Error("층 머리 T0 이 없음");
      lines.splice(i, 1);
    },
  },
];

function sectionMutations(outputs) {
  console.log("\n(B) 대조군 — 2재료 출력 글자 변조는 겨냥한 검사에서 실패해야 함:");
  for (const mu of DUAL_MUTATIONS) {
    const base = outputs.get(mu.base);
    const lines = linesOf(base.result.gcode);
    let mutated;
    try {
      mu.mutate(lines);
      mutated = joinLines(lines);
    } catch (err) {
      assert(false, `${mu.id} ${mu.desc} — 변조 준비 실패: ${err.message}`);
      continue;
    }
    const res = runDualOutputChecks(mutated, { ...base.ctx });
    const caught = Object.keys(res).filter((k) => res[k].length > 0);
    console.log(`  ${mu.id} ${mu.desc}: 검출한 검사 = ${caught.join(", ") || "없음"}`);
    if (res[mu.target].length) console.log(`      ${mu.target} 위반 예: ${res[mu.target][0]}`);
    assert(mutated !== base.result.gcode && res[mu.target].length > 0, `${mu.id} 겨냥한 ${DUAL_CHECK_LABELS[mu.target]} 가 변조를 검출`);
  }
}

// ── (C) writer 대조군 ─────────────────────────────────────────────────────

function sectionWriterControls(params) {
  console.log("\n(C) writer 대조군:");
  const lh = 0.1;
  // 차집합 끔 — 겹친 곳에 A 도 도포
  for (const fixture of [fixtureOverlapBoxes(), fixtureDualPillarsPlate()]) {
    const ctx = makeDualCtx(fixture, lh, params);
    const off = generateTask0Gcode(ctx.meshes, ctx.topY, lh, { dualMaterial: { slots: fixture.slots, subtractOverlap: false } });
    const cov = checkTask0DualGcodeCoverage(ctx.meshes, ctx.slots, ctx.topY, lh, off.gcode, { depositWidthMm: params.depositWidthMm });
    const res = runDualOutputChecks(off.gcode, { ...ctx });
    assert(
      cov.overlapSamplesA > 0 && res.c8.length > 0,
      `[${ctx.name}] 차집합 끔 → B 우선 위반 표본 ${cov.overlapSamplesA} (최대 깊이 ${cov.overlapMaxDepthMm.toFixed(3)} mm, 층 ${cov.overlapLayers.length}개), c8 ${res.c8.length ? "검출 — " + res.c8[0] : "놓침"}`,
    );
  }
  // 툴 상태 하나 — 툴별 c3 는 잡고, 툴을 모르는 c3(T 줄을 지운 출력 = 예전 단일 툴 판정)는 놓친다
  {
    const fixture = fixtureDualPillarsPlate();
    const ctx = makeDualCtx(fixture, lh, params);
    const merged = generateTask0Gcode(ctx.meshes, ctx.topY, lh, { dualMaterial: { slots: fixture.slots, perToolRetract: false } });
    const res = runDualOutputChecks(merged.gcode, { ...ctx });
    const noT = merged.gcode.replace(/^T[01]\n/gm, (m, off) => (off < merged.gcode.indexOf(LAYER) ? m : ""));
    const old = checkRetract(buildModel(noT, [params.parkXMm, params.parkYMm]), ctx);
    assert(res.c3.length > 0, `[${ctx.name}] 툴 상태 하나(perToolRetract=false) → 툴별 c3 검출 — ${res.c3.slice(0, 2).join(" / ")}`);
    assert(old.length === 0, `  … 같은 출력에서 T 줄을 지우면(툴을 모르는 c3) 위반 ${old.length}건 — 툴별 확장 없이는 못 잡는다`);
  }
  // 우회 끔 — 전환 트래블이 칠한 A 를 가로지름. 층마다 [A 패스 전부 + 전환 트래블 + B 첫 도포] 까지만 남긴 모델에서도 c4 가
  //   두 재료 층마다 잡아야 한다(A 패스는 B안 행 그대로라 교차가 없으니 잡힌 것은 전환 트래블). 정상 출력의 같은 모델은 c4 0.
  {
    const fixture = fixtureURing();
    const ctx = makeDualCtx(fixture, lh, params);
    const off = generateTask0Gcode(ctx.meshes, ctx.topY, lh, { dualMaterial: { slots: fixture.slots }, thinFillDetour: false });
    const on = generateTask0Gcode(ctx.meshes, ctx.topY, lh, { dualMaterial: { slots: fixture.slots } });
    const res = runDualOutputChecks(off.gcode, { ...ctx });
    assert(res.c4.length > 0, `[${ctx.name}] 우회 끔(thinFillDetour=false) → c4 트래블 교차 검출${res.c4.length ? " — " + res.c4[0] : ""}`);
    const upToTransition = (gcode) => {
      const model = buildModel(gcode, [params.parkXMm, params.parkYMm]);
      let layers = 0;
      for (const layer of model.layers) {
        const t1 = layer.ops.findIndex((op) => toolOfOp(op) === 1);
        if (t1 <= 0 || !layer.ops.slice(0, t1).some((op) => op.kind === "deposit")) continue;
        const firstB = layer.ops.findIndex((op, k) => k > t1 && op.kind === "deposit");
        layer.ops = layer.ops.slice(0, firstB + 1);
        layers++;
      }
      const v = checkTravelCrossing(model, ctx);
      const n = v.reduce((acc, m) => acc + Number(/×(\d+)/.exec(m)?.[1] ?? 1), 0);
      return { layers, n };
    };
    const a = upToTransition(off.gcode);
    const b = upToTransition(on.gcode);
    assert(
      a.layers > 0 && a.n === a.layers && b.n === 0,
      `  … 전환 트래블만 남긴 모델: 우회 끔 c4 위반 ${a.n} = 두 재료 층 ${a.layers}, 우회 켬 ${b.n}`,
    );
  }
  // 순서 B → A
  {
    const fixture = fixtureDualPillarsPlate();
    const ctx = makeDualCtx(fixture, lh, params);
    const ba = generateTask0Gcode(ctx.meshes, ctx.topY, lh, { dualMaterial: { slots: fixture.slots, order: "BA" } });
    const res = runDualOutputChecks(ba.gcode, { ...ctx });
    assert(res.c10.length > 0, `[${ctx.name}] 순서 B→A(order 'BA') → c10 검출${res.c10.length ? " — " + res.c10[0] : ""}`);
    const resBA = runDualOutputChecks(ba.gcode, { ...ctx, expectOrder: [1, 0] });
    const others = Object.keys(resBA).filter((k) => resBA[k].length > 0);
    assert(others.length === 0, `  … 기대 순서를 B→A 로 주면 c1~c10 통과 (B→A 출력도 형식·상태 기계는 지킴)${others.length ? " — " + others.join(", ") : ""}`);
  }
}

// ── (D) 닫힌 고리 ─────────────────────────────────────────────────────────

/**
 * 닫힌 고리 판정 — [{ ok, msg }]. A→B 순서로는 B 로 들어갈 길이 없으니 전 층 'failed'·경로 없는 항목 > 0·T1 도포 0·T 전환 0,
 * 내놓은 출력은 형식·상태 기계·교차 0 (c1·c2·c3·c4·c4b·c6·c7), 재료 B 커버리지 FAIL. withBA 면 order 'BA' 가 통과함도 기록.
 * verify 는 lh 0.1 만 돌린다 — lh 0.05 는 bench-task0-dual ④ 가 같은 함수로 본다(실패 층이 많아 오래 걸림).
 */
export function closedRingChecks(lh, params, withBA = false) {
  const out = [];
  const fixture = fixtureClosedRing();
  const ctx = makeDualCtx(fixture, lh, params);
  const t0 = Date.now();
  const r = generateTask0Gcode(ctx.meshes, ctx.topY, lh, { dualMaterial: { slots: fixture.slots } });
  const ms = Date.now() - t0;
  const t = r.totals;
  out.push({
    ok: t.thinFillFailedLayers.length === t.layerCount && t.unreachable > 0 && t.byTool[1].segments === 0 && t.toolChanges === 0,
    msg: `[${ctx.name}] 전 층 'failed' (${t.thinFillFailedLayers.length}/${t.layerCount}), 경로 없는 항목 ${t.unreachable}, T1 도포 0, T 전환 0 (writer ${ms} ms)`,
  });
  const res = runDualOutputChecks(r.gcode, { ...ctx });
  const okKeys = ["c1", "c2", "c3", "c4", "c4b", "c6", "c7"].filter((k) => res[k].length === 0);
  out.push({ ok: okKeys.length === 7, msg: `  … 내놓은 출력은 형식·상태 기계·교차 0 (c1·c2·c3·c4·c4b·c6·c7 통과 ${okKeys.length}/7) — 억지로 가로지르지 않음` });
  const cov = checkTask0DualGcodeCoverage(ctx.meshes, ctx.slots, ctx.topY, lh, r.gcode, { depositWidthMm: params.depositWidthMm });
  out.push({ ok: !cov.pass && cov.worst.B.bWithoutDeposit > 0, msg: `  … 재료 B 커버리지 FAIL (B 섬 도포 0 — ${cov.worst.B.bWithoutDeposit}) = 쓰는 쪽이 막아야 할 파일` });
  if (withBA) {
    const ba = generateTask0Gcode(ctx.meshes, ctx.topY, lh, { dualMaterial: { slots: fixture.slots, order: "BA" } });
    const covBA = checkTask0DualGcodeCoverage(ctx.meshes, ctx.slots, ctx.topY, lh, ba.gcode, { depositWidthMm: params.depositWidthMm });
    const resBA = runDualOutputChecks(ba.gcode, { ...ctx, expectOrder: [1, 0] });
    const badBA = Object.keys(resBA).filter((k) => resBA[k].length > 0);
    out.push({
      ok: ba.totals.thinFillFailedLayers.length === 0 && covBA.pass && badBA.length === 0,
      msg:
        `  … (기록) order 'BA' 면 통과 — 실패 층 ${ba.totals.thinFillFailedLayers.length}, 커버리지 ${covBA.pass ? "통과" : "FAIL"}, ` +
        `우회 ${ba.totals.detourTravels} (규격 §6 【미정】 "B 가 A 안에 갇힌 층은 B → A" — Task0 에 물을 거리)`,
    });
  }
  return out;
}

function sectionClosedRing(params) {
  console.log("\n(D) 닫힌 고리 — A→B 순서로는 B 로 들어갈 길이 없음 (층 실패로 보고, lh 0.1 — lh 0.05 는 bench-task0-dual ④):");
  for (const { ok, msg } of closedRingChecks(0.1, params, true)) assert(ok, msg);
}

// ── (E) 단일 재료 회귀·옵션 검사 ──────────────────────────────────────────

function sectionSingle(params) {
  console.log("\n(E) 단일 재료 회귀·옵션 검사:");
  const cube = fixtureCube10();
  const meshes = cube.meshes();
  const topY = meshesTopY(meshes);
  const plain = generateTask0Gcode(meshes, topY, 0.1);
  const undef = generateTask0Gcode(meshes, topY, 0.1, { dualMaterial: undefined });
  const tLines = linesOf(plain.gcode).filter((l) => l === "T0" || l === "T1").length;
  assert(
    sha256(plain.gcode) === FILE_A_SHA && undef.gcode === plain.gcode && tLines === 1,
    `dualMaterial 없음 → 파일 A sha256 ${sha256(plain.gcode).slice(0, 16)}… = 고정값, 옵션 키 undefined 와 같은 바이트, T 줄은 프리앰블 T0 하나`,
  );
  const t = plain.totals;
  assert(
    !t.dualMaterial && t.toolChanges === 0 && t.byTool.length === 1 && t.byTool[0].depositMm === t.depositMm &&
      t.byTool[0].retracts === t.retracts && t.byTool[0].extrusionMm === t.extrusionMm,
    "단일 재료 통계: dualMaterial false, T 전환 0, byTool = [T0] (합계와 같음)",
  );
  const bad = [
    ["boundaryInsetMm 0.5 (경계 여유는 자리만 — 0 만)", { slots: ["A"], boundaryInsetMm: 0.5 }],
    ["minFragmentAreaMm2 1 (부스러기 제거는 자리만 — 0 만)", { slots: ["A"], minFragmentAreaMm2: 1 }],
    ["슬롯 수 ≠ 메시 수", { slots: ["A", "B"] }],
    ["슬롯 값 'C'", { slots: ["C"] }],
    ["order 'XY'", { slots: ["A"], order: "XY" }],
  ];
  for (const [label, dm] of bad) {
    let threw = false;
    try {
      generateTask0Gcode(meshes, topY, 0.1, { dualMaterial: dm });
    } catch (err) {
      threw = err instanceof RangeError;
    }
    assert(threw, `옵션 검사: ${label} → RangeError`);
  }
  // 슬롯이 전부 A 면 T1 없이 T0 만 (B 패스가 비어 T 줄 없음) — 행은 단일과 같은 자리
  const allA = generateTask0Gcode(meshes, topY, 0.1, { dualMaterial: { slots: ["A"] } });
  const strip = (g) => g.slice(g.indexOf("; EXECUTABLE_BLOCK_START"));
  assert(
    allA.totals.toolChanges === 0 && strip(allA.gcode) === strip(plain.gcode),
    "슬롯 전부 A → START 뒤 본문이 단일 재료 출력과 같은 바이트 (머리 메타만 2재료 줄 추가)",
  );
}

// ── (F) 라이브러리 단위 ───────────────────────────────────────────────────

function sectionLibrary(params) {
  console.log("\n(F) 라이브러리 단위:");
  const fx = fixtureOverlapBoxes();
  const meshes = fx.meshes();
  const pa = task0LayerPolygonsBed([meshes[0]], 3, 0.1);
  const pb = task0LayerPolygonsBed([meshes[1]], 3, 0.1);
  const roi = { col0: 700, row0: 400, width: 260, height: 200 };
  const region = rasterizeTask0Region(pa, pb, { roi });
  const ma = rasterizeTask0Mask(pa, { roi });
  const mb = rasterizeTask0Mask(pb, { roi });
  let same = true;
  let white = 0;
  for (let k = 0; k < ma.data.length; k++) {
    const want = ma.data[k] !== 0 && mb.data[k] === 0 ? 1 : 0;
    if (region.data[k] !== want) same = false;
    white += want;
  }
  assert(same && region.whitePixels === white && white > 0, `rasterizeTask0Region = raster(PA) AND NOT raster(PB) (흰 ${white}px)`);
  const empty = rasterizeTask0Region(pa, [], { roi });
  assert(empty.data.every((v, k) => v === ma.data[k]), "뺄 단면이 없으면 rasterizeTask0Mask 와 같음");
  const segs = [{ x0: 70, y0: 42, x1: 72, y1: 42, e: 1, tool: 0 }];
  const a = checkTask0LayerCoverage(pa, segs, { depositWidthMm: params.depositWidthMm });
  const b = checkTask0LayerCoverage(pa, segs, { depositWidthMm: params.depositWidthMm, excludePolygonsBed: undefined, overflowPolygonsBed: undefined });
  assert(JSON.stringify(a) === JSON.stringify(b), "커버리지: 2재료 옵션 키가 undefined 면 옵션 없는 호출과 같은 결과");

  // 넘침 = 합집합 기준 — A 상자(베드 X 69~77) · B 상자(X 73~81) 겹침, R_A = X 69~73. T0 선분을 X 76~78(PB 안, R_A 에서 3 mm)에:
  //   합집합 PA ∪ PB 기준이면 넘침 통과, 넘침을 자기 재료 영역(R_A)으로 보면 FAIL (규격 §3 "2재료 경계 물림은 합친 흰 영역 안이면 허용")
  const union = pa.concat(pb);
  const inB = [{ x0: 76, y0: 42.5, x1: 78, y1: 42.5, e: 1, tool: 0 }];
  const withUnion = checkTask0LayerCoverage(pa, inB, { depositWidthMm: params.depositWidthMm, excludePolygonsBed: pb, overflowPolygonsBed: union });
  const ownRegion = checkTask0LayerCoverage(pa, inB, { depositWidthMm: params.depositWidthMm, excludePolygonsBed: pb });
  assert(
    withUnion.overflow.pass && withUnion.overflow.okRatio === 1 && !ownRegion.overflow.pass && ownRegion.overflow.okRatio === 0,
    `넘침 합집합 기준: R_A 에서 3 mm 벗어난 T0 선분 — 합집합 기준 통과(${withUnion.overflow.okRatio}), 자기 영역 기준 FAIL(${ownRegion.overflow.okRatio})`,
  );

  // 엄격 판정 공유 함수 = 이 검증의 c4b 규칙 (무작위 정수 µm — 작은 격자라 겹침·끝점 접촉·교차가 자주 난다)
  const lib = fillRoute.task0TravelContactOk;
  if (typeof lib !== "function") {
    assert(false, "task0-fill-route task0TravelContactOk 없음 (엄격 판정 공유 함수)");
    return;
  }
  const rnd = makeRand(4242);
  const ri = (n) => Math.floor(rnd() * n);
  const pt = () => [ri(7) * 1000, ri(7) * 1000];
  let agree = 0;
  let okCount = 0;
  const N = 6000;
  for (let c = 0; c < N; c++) {
    const painted = [];
    const np = 1 + ri(4);
    for (let k = 0; k < np; k++) {
      const a = pt();
      let b = pt();
      while (b[0] === a[0] && b[1] === a[1]) b = pt();
      painted.push([a, b]);
    }
    // 시작점 = 직전 도포 끝 (writer·c4b 와 같은 상황), 경유점 0~2 개, 끝점
    const path = [painted[np - 1][1]];
    const nw = ri(3);
    for (let k = 0; k <= nw; k++) path.push(pt());
    const want = refContactOk(path, painted, np - 1);
    const got = lib(path, painted, np - 1);
    if (want === got) agree++;
    if (want) okCount++;
  }
  assert(
    agree === N && okCount > N / 20 && okCount < N - N / 20,
    `엄격 판정 공유 함수 = c4b 규칙 — 무작위 ${N} 쌍 일치 ${agree} (통과 ${okCount}·막힘 ${N - okCount})`,
  );
}

/**
 * c4b 규칙의 독립 적용 (verify-task0-writer checkTravelContact 의 flush 와 같은 규칙, 접촉 분류는 그 legSegmentContact) —
 * 길이 0 다리는 writer 가 내지 않으므로 뺀다.
 */
function refContactOk(path0, painted, lastIdx) {
  const path = path0.filter((p, i) => i === 0 || p[0] !== path0[i - 1][0] || p[1] !== path0[i - 1][1]);
  const C = path[0];
  const S = path[path.length - 1];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  for (let i = 1; i < path.length; i++) {
    for (let k = 0; k < painted.length; k++) {
      const c = legSegmentContact(path[i - 1], path[i], painted[k][0], painted[k][1]);
      if (c.kind === "cross") return false;
      if (c.kind === "touch" && c.points.some((t) => !same(t, C) && !same(t, S))) return false;
      if (c.kind === "overlap" && !(i === 1 && k === lastIdx && c.containsP)) return false;
    }
  }
  return true;
}

// ── (G) Task0 원본 파서 ───────────────────────────────────────────────────

function sectionOriginalParser(outputs) {
  console.log(`\n(G) Task0 원본 파서(Python @${ORIGIN_PARSER_COMMIT}) — lh 0.1 출력 3모드:`);
  const items = [...outputs.values()].filter((o) => o.ctx.lh === 0.1);
  const run = runTask0OriginalParser(items.map((o) => ({ gcode: o.result.gcode, lh: o.ctx.lh })));
  if (run.skip) {
    console.log(`  SKIP(원본 파서): ${run.skip} — 이식판 c1 으로 판정`);
    return;
  }
  if (run.error) {
    assert(false, `원본 파서 실행 실패: ${run.error}`);
    return;
  }
  console.log(`  ${run.python}, Task0 = ${TASK0_DIR}`);
  items.forEach((o, i) => {
    const res = run.results[i];
    const problems = [];
    for (const m of res) {
      const tag = `${m.mode}(keepE=${m.keepE})`;
      for (const w of m.warnings) problems.push(`${tag} 경고: ${w}`);
      for (const e of m.errors) problems.push(`${tag} 오류: ${e}`);
      if (m.layerCount !== o.result.totals.layerCount) problems.push(`${tag} 층 수 ${m.layerCount}`);
      if (JSON.stringify(m.empty) !== JSON.stringify(o.ctx.expectedEmpty)) problems.push(`${tag} 빈 층 ${JSON.stringify(m.empty)}`);
    }
    const tKeep = res.find((m) => m.mode === "dryrun" && m.keepE).tLines;
    const tDrop = res.find((m) => m.mode === "dryrun" && !m.keepE).tLines;
    const tPrint = res.find((m) => m.mode === "print").tLines;
    assert(
      problems.length === 0 && tKeep === o.result.totals.toolChanges + 1 && tPrint === tKeep && tDrop === 0,
      `[${o.ctx.name}] 원본 파서 3모드 경고·오류 0, 층 수·빈 층 일치, T 줄 통과 ${tKeep}(= 전환 ${o.result.totals.toolChanges} + 프리앰블 T0)·E 끔이면 ${tDrop}` +
        (problems.length ? " — " + problems.slice(0, 3).join(" / ") : ""),
    );
  });
}

function main() {
  console.log("Task0 2재료 writer 검증 (D1a — 층 안 T0/T1 2패스, 툴별 리트랙트, B 우선 차집합, 재료별 커버리지; 규격서 v0.3.4)");
  const params = resolveTask0WriterParams();
  const outputs = sectionFixtures(params);
  sectionMutations(outputs);
  sectionWriterControls(params);
  sectionClosedRing(params);
  sectionSingle(params);
  sectionLibrary(params);
  sectionOriginalParser(outputs);
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

const isMain = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMain) main();
