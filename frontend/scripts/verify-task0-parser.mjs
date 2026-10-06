// Task0 G-code 파서 TS 이식 헤드리스 검증 (로드맵 0절 2주차 PR-1 Z1-a1).
//
//   무엇을: src/features/v2/utils/task0/task0-gcode-parser.ts 가 Task0 원본 파서
//     `controllers/task0_gcode.py` @ 커밋 03c0519 (파서 v0.2.1, 규격서 v0.3.4 §12 @ a4ebc6c) 와
//     **같은 결과**를 내는지 본다. Z1-a2 의 task0 G-code writer 가 이 파서로 자기 출력을 검사하므로,
//     여기서 어긋나면 "MazicAlign 은 통과, Task0 는 거부" 가 생긴다.
//     (Z1-c — 이식 기준 592accf(v0.2) → 03c0519(v0.2.1): G92 인자 검사, 인자 없는 이동 줄 분리,
//      Z 관련 위반 문구 소수 4자리. 협의 §30-3)
//
//   (a) 단위테스트 이식 — 원본 `test/test_task0_gcode.py` @ 03c0519 의 테스트 82건을 같은 입력·같은
//       기대값으로 옮겼다(레이블 = 원본 클래스.테스트 이름). 이식 개수 ≠ 원본 개수면 실패.
//       test_big_file(Task0 루트의 미커밋 OrcaSlicer 파일)은 원본처럼 파일이 있을 때만 돌고 없으면 SKIP.
//       test_2.gcode 는 03c0519 판을 아래에 내장(Task0 가 있으면 원본 blob 과 같은지도 확인).
//   (b) Python 원본과의 차분 검사 — python 과 Task0 리포(TASK0_DIR, 기본 = 리포 루트 기준 ../Task0)가
//       있으면 `git show 03c0519:controllers/task0_gcode.py` 를 임시 폴더에 풀어 Python 하네스로 돌리고,
//       말뭉치(= (a)의 모든 입력 + 결정적 시드 퍼즈 600건 × 모드 5종 + 숫자 포맷 경계 + 인자 오류 +
//       함수 단위 입력) 각각의 결과(블록 필드·warnings·errors·layerCount·endFound / 예외 메시지)가
//       JS 와 **완전히 같아야** 한다(float 는 비트 단위 비교). 퍼즈·경계 말뭉치에는 v0.2.1 새 규칙 사례
//       (G92 인자 변형, 인자 없는 G0/G1, |Z| ≥ 1000·소수 4자리 동률·지수 범위 Z 문구)가 들어 있다.
//       ★ 대조군 원칙: 같은 하네스로 원본을 일부러 변조한 판(_TOL 0.001→0.01, 경고 문구 한 글자,
//       half-even 반올림 → +0.5 절삭, 이동·G92 인자 정규식 re.ASCII 제거, utf-8-sig → utf-8,
//       Z 문구 소수 3자리, 인자 없는 이동 줄을 F 단독 줄로, G92 허용 글자에 F 추가)을 돌리면 불일치가
//       **검출돼야** 한다 — 검출 못 하면 말뭉치가 그 차이를 못 잡는다는 뜻이므로 실패.
//       python·Task0·커밋 중 하나라도 없으면 `SKIP(차분 검사): 사유` 를 찍고 (a)만으로 판정한다
//       (Task0 를 안 가진 팀원 PC 에서도 돈다).
//
//   원본이 바뀌면: 이 파일의 ORIGIN_COMMIT·이식 테스트·내장 test_2.gcode 와 TS 파서를 같은 커밋 기준으로
//   다시 맞춘다.
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "불일치" 문자열을 출력한다.
//   exit 0 = 이식 테스트 전부 통과 AND (차분 검사 불일치 0 AND 대조군 전부 검출 | 차분 검사 SKIP).
//
//   실행: npx tsx scripts/verify-task0-parser.mjs
//     (선택) TASK0_DIR=<Task0 리포 경로>, PYTHON=<python 실행 파일>
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as P from "../src/features/v2/utils/task0/task0-gcode-parser.ts";

const ORIGIN_COMMIT = "03c0519";
const ORIGIN_TEST_COUNT = 82; // python test/test_task0_gcode.py @03c0519 → "Ran 82 tests"
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const TASK0_DIR = process.env.TASK0_DIR || path.resolve(REPO_ROOT, "..", "Task0");
const MODULE_PATH = path.resolve(SCRIPT_DIR, "../src/features/v2/utils/task0/task0-gcode-parser.ts");
const BIG_FILE = path.join(TASK0_DIR, "뚜껑_0.2mm_ABS_Generic Klipper Printer_4h52m.gcode");

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

// ── 원본 test_2.gcode @03c0519 (내장 사본 — Task0 가 있으면 blob 과 대조) ──
const TEST2_GCODE = `; ============================================
; test_2.gcode — 층 내 듀얼 전환 + 층간 LED 노광 검증 (규격서 §6·§9)
; 3층, 매 층: [Z 이동] -> T0(왼쪽 사각) -> T1(오른쪽 사각)
;   파킹/블레이드/리프트/LED는 Task0(GUI)가 삽입 (규격서 §2: 슬라이서는 블레이드 명령을 쓰지 않는다)
;   => 실행 순서: 도포 -> Z 리프트 -> 익스트루더 파킹(0,0) -> Z 복원
;                 -> 블레이드 스윕(북) -> Z 리프트 -> 블레이드 복귀 -> Z 복원 -> LED -> (다음 층) Z
; 검증 포인트:
;   1) 한 층에서 익스트루더 2개가 순서대로 도는가 (Motor5 -> Motor6)
;   2) 전환 직전 리트랙션(E-20) / 전환 직후 언리트랙션(E20)이 먹는가
;   3) 도포 후 Z가 리프트된 채 익스트루더가 (0,0)으로 파킹하고, Z가 리프트 양만큼 복원되는가
;   4) 블레이드 스윕 후 Z 리프트 상태로 복귀하고, Z 복원 뒤(익스트루더·블레이드 모두 홈) LED가 켜지는가
; XY 범위: X 20~130, Y 20~60 / Z 3층 x 5mm (층 시작 시 이동)
; Z 규약 (2026-09-29 MazicAlign 합의): 층 N(0-based)의 G1 Z = (N+1) x 층두께 -> 5/10/15. 첫 층 Z=0 아님
; 사용법: Dry Run 탭 -> 파일 선택 -> "E 포함" 체크 -> 블레이드 스윕/속도/리프트 확인 -> Start (LED는 DLP 연결 시 자동)
; ============================================
; EXECUTABLE_BLOCK_START
M83
G28 X Y Z
G90
;LAYER_CHANGE
;Z:5
;HEIGHT:5
; --- Layer 1 (Z=5) / T0 구역(왼쪽) ---
G1 Z5 F300
T0
G1 X20 Y20 F300
G1 E20 F300
G1 X70 Y20 E200 F300
G1 X70 Y60 E160 F300
G1 X20 Y60 E200 F300
G1 X20 Y20 E160 F300
G1 X70 Y60 E240 F300
G1 E-20 F300
; --- Layer 1 / T1 구역(오른쪽) ---
T1
G1 X80 Y20 F300
G1 E20 F300
G1 X130 Y20 E200 F300
G1 X130 Y60 E160 F300
G1 X80 Y60 E200 F300
G1 X80 Y20 E160 F300
G1 X130 Y60 E240 F300
G1 E-20 F300
;LAYER_CHANGE
;Z:10
;HEIGHT:5
; --- Layer 2 (Z=10) / T0 구역(왼쪽) ---
G1 Z10 F300
T0
G1 X20 Y20 F300
G1 E20 F300
G1 X70 Y20 E200 F300
G1 X70 Y60 E160 F300
G1 X20 Y60 E200 F300
G1 X20 Y20 E160 F300
G1 X70 Y60 E240 F300
G1 E-20 F300
; --- Layer 2 / T1 구역(오른쪽) ---
T1
G1 X80 Y20 F300
G1 E20 F300
G1 X130 Y20 E200 F300
G1 X130 Y60 E160 F300
G1 X80 Y60 E200 F300
G1 X80 Y20 E160 F300
G1 X130 Y60 E240 F300
G1 E-20 F300
;LAYER_CHANGE
;Z:15
;HEIGHT:5
; --- Layer 3 (Z=15) / T0 구역(왼쪽) ---
G1 Z15 F300
T0
G1 X20 Y20 F300
G1 E20 F300
G1 X70 Y20 E200 F300
G1 X70 Y60 E160 F300
G1 X20 Y60 E200 F300
G1 X20 Y20 E160 F300
G1 X70 Y60 E240 F300
G1 E-20 F300
; --- Layer 3 / T1 구역(오른쪽) ---
T1
G1 X80 Y20 F300
G1 E20 F300
G1 X130 Y20 E200 F300
G1 X130 Y60 E160 F300
G1 X80 Y60 E200 F300
G1 X80 Y20 E160 F300
G1 X130 Y60 E240 F300
G1 E-20 F300
; EXECUTABLE_BLOCK_END
`;

// ════════════════════════════════════════════════════════════════════════
// (a) 단위테스트 이식
// ════════════════════════════════════════════════════════════════════════

/** (a)에서 파서에 넣은 모든 입력 — (b) 차분 검사 말뭉치에 그대로 들어간다 */
const unitCorpus = [];
const R = {
  lines(lines, opts = {}) {
    unitCorpus.push({ t: "parse", lines: [...lines], opts });
    return P.parseGcodeLines(lines, opts);
  },
  text(text, opts = {}) {
    unitCorpus.push({ t: "text", text, opts });
    return P.parseGcodeText(text, opts);
  },
  strip(s) {
    unitCorpus.push({ t: "strip", s });
    return P.stripComment(s);
  },
  norm(s, keepE) {
    unitCorpus.push({ t: "norm", s, keepE });
    return P.normalizeDryrunMotion(s, keepE);
  },
  unspaced(s) {
    unitCorpus.push({ t: "unspaced", s });
    return P.isUnspacedMove(s);
  },
};

const START = "; EXECUTABLE_BLOCK_START";
const END = "; EXECUTABLE_BLOCK_END";
const LC = ";LAYER_CHANGE";

/** START 마커 + 줄들 → parseGcodeLines (원본 parse(*lines, **kw)) */
const parse = (lines, kw = {}) => R.lines([START, ...lines], kw);
/** 정상 층 블록 줄: ;LAYER_CHANGE, ;Z:z, G1 Z{z}, body... (z 는 원본 f"{z}" 와 같은 문자열) */
function layer(z, body = [], marker = true) {
  const out = [LC];
  if (marker) out.push(`;Z:${z}`);
  out.push(`G1 Z${z}`);
  out.push(...body);
  return out;
}
/** Python str.splitlines() */
function pySplitlines(s) {
  const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}
/** 블록 G-code → 줄 목록 */
const gl = (block) => (block.gcode ? pySplitlines(block.gcode) : []);
const find = (msgs, needle) => msgs.filter((m) => m.includes(needle));

class TestFailure extends Error {}
const show = (v) => {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x));
  } catch {
    return String(v);
  }
};
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}
const T = {
  eq(a, b, note = "") {
    if (!deepEqual(a, b)) throw new TestFailure(`${show(a)} != ${show(b)} ${note}`);
  },
  ne(a, b) {
    if (deepEqual(a, b)) throw new TestFailure(`${show(a)} == ${show(b)}`);
  },
  isTrue(v, note = "") {
    if (!v) throw new TestFailure(`${show(v)} is not true ${note}`);
  },
  isFalse(v, note = "") {
    if (v) throw new TestFailure(`${show(v)} is not false ${note}`);
  },
  isNull(v) {
    if (v !== null) throw new TestFailure(`${show(v)} is not None`);
  },
  /** assertIn(sub, s) — 문자열 포함 */
  has(sub, s, note = "") {
    if (typeof s !== "string" || !s.includes(sub)) throw new TestFailure(`${show(sub)} not found in ${show(s)} ${note}`);
  },
  hasNot(sub, s, note = "") {
    if (typeof s !== "string" || s.includes(sub)) throw new TestFailure(`${show(sub)} unexpectedly in ${show(s)} ${note}`);
  },
  regex(s, re) {
    if (!re.test(s)) throw new TestFailure(`${show(s)} !~ ${re}`);
  },
  le(a, b) {
    if (!(a <= b)) throw new TestFailure(`${a} > ${b}`);
  },
  lt(a, b) {
    if (!(a < b)) throw new TestFailure(`${a} >= ${b}`);
  },
  /** assertRaises(ValueError) */
  raises(fn, note = "") {
    try {
      fn();
    } catch (e) {
      if (e && e.name === "ValueError") return;
      throw new TestFailure(`ValueError 대신 ${e && e.name}: ${e && e.message} ${note}`);
    }
    throw new TestFailure(`ValueError not raised ${note}`);
  },
};

const tests = [];
/** 이식 테스트 등록 — name = 원본 "클래스.테스트" */
function test(name, fn, skipReason = null) {
  tests.push({ name, fn, skipReason });
}

// ---------- TestInlineComment ----------
test("TestInlineComment.test_inline_comment_f_outside", () => {
  const r = parse(["G1 X10 Y10 F1800 ; note"]);
  T.eq(gl(r.blocks[0]), [`G1 X10 Y10 F${P.FIXED_SPEED_F}`]);
  T.eq(r.blocks[0].gcode, "G1 X10 Y10 F600");
  const w = find(r.warnings, "명령 줄 끝 주석");
  T.eq(w.length, 1);
  T.has("1줄", w[0]);
  T.hasNot(";", r.blocks[0].gcode);
});
test("TestInlineComment.test_inline_comment_print", () => {
  const r = parse(["G1 X10 Y10 F1800 ; note"], { mode: "print" });
  T.eq(r.blocks[0].gcode, "G1 X10 Y10 F1800");
  T.eq(find(r.warnings, "명령 줄 끝 주석").length, 1);
});
test("TestInlineComment.test_comment_letters_ignored_e_removed", () => {
  let r = parse(["G1 E5 ; X marks"]);
  T.eq(r.blocks, []);
  r = parse(layer("0.05", ["G1 E5 ; X marks"]));
  T.eq(gl(r.blocks[0]), ["G1 Z0.05 F600"]);
  T.isFalse(r.blocks[0].hasXy);
});
test("TestInlineComment.test_comment_letters_keep_e", () => {
  const r = parse(["G1 E5 ; X marks"], { keepE: true });
  T.eq(r.blocks[0].gcode, "G1 E5 F600");
  T.isFalse(r.blocks[0].hasXy);
});
test("TestInlineComment.test_inline_comment_on_passthrough", () => {
  const r = parse(["G28 ; home", "M83 ; rel"], { keepE: true });
  T.eq(gl(r.blocks[0]), ["G28", "M83"]);
  T.has("2줄", find(r.warnings, "명령 줄 끝 주석")[0]);
});
test("TestInlineComment.test_strip_comment", () => {
  T.eq(R.strip("  G1 X1 ; c ; d  "), "G1 X1");
  T.eq(R.strip("; only"), "");
  T.eq(R.strip("G90"), "G90");
});

// ---------- TestCommandMatching ----------
test("TestCommandMatching.test_unknown_aggregated", () => {
  const r = parse(["M104 S200", "M104 S210", "G90", "M104 S0"]);
  const w = find(r.warnings, "M104");
  T.eq(w.length, 1);
  T.has("×3", w[0]);
  T.has("(줄 2, 3, 5)", w[0]);
  T.eq(gl(r.blocks[0]), ["G90"]);
});
test("TestCommandMatching.test_no_prefix_match", () => {
  const r = parse(["G280", "M4000", "T01", "G10", "G11", "G17", "G28", "M400"], { keepE: true });
  T.eq(gl(r.blocks[0]), ["G28", "M400"]);
  for (const name of ["G280", "M4000", "T01", "G10", "G11", "G17"]) {
    T.eq(find(r.warnings, `알 수 없는 명령 버림: ${name} ×1`).length, 1, name);
  }
  T.eq(find(r.warnings, "공백 없는 이동 줄"), []);
});
test("TestCommandMatching.test_unspaced_move", () => {
  const lines = ["G1X10", "g0z5", "G1F1800 X1", "G90"];
  let r = parse(lines);
  T.eq(gl(r.blocks[0]), ["G90"]);
  const w = find(r.warnings, "공백 없는 이동 줄");
  T.eq(w.length, 1);
  T.has("3줄", w[0]);
  T.eq(find(r.warnings, "알 수 없는 명령"), []);
  r = parse(lines, { mode: "print" });
  T.eq(find(r.errors, "공백 없는 이동 줄").length, 1);
  T.eq(find(r.warnings, "공백 없는 이동 줄"), []);
});
test("TestCommandMatching.test_is_unspaced_move", () => {
  for (const tok of ["G1X10", "G0Z5", "g1e-1", "G1F1800", "G0Y"]) T.isTrue(R.unspaced(tok), tok);
  for (const tok of ["G1", "G0", "G10", "G11", "G17", "G28", "G1.5", "M1X", "G2X1", "GX1", ""]) {
    T.isFalse(R.unspaced(tok), tok);
  }
});
test("TestCommandMatching.test_unknown_refs_capped", () => {
  const r = parse(Array(1000).fill("M104 S0"));
  const w = find(r.warnings, "M104");
  T.eq(w.length, 1);
  T.has("×1000", w[0]);
  T.has("(줄 2, 3, 4, 5, 6 …)", w[0]);
});
test("TestCommandMatching.test_unknown_kinds_capped", () => {
  const r = parse(Array.from({ length: 30 }, (_, i) => `CMD_${i}`));
  T.eq(r.warnings.length, 21);
  const other = find(r.warnings, "그 외 10종");
  T.eq(other.length, 1);
  T.has("×10", other[0]);
});
test("TestCommandMatching.test_dryrun_passthrough_sets", () => {
  const pre = ["G28 X Y", "G90", "G91", "G92 E0", "M400", "M83", "M82", "T0", "T1"];
  let r = parse(pre, { keepE: true });
  T.eq(gl(r.blocks[0]), pre);
  T.eq(r.warnings, []);
  r = parse(pre, { keepE: false });
  T.eq(gl(r.blocks[0]), ["G28 X Y", "G90", "G91", "G92 E0", "M400"]);
  T.eq(r.warnings, []); // M83/M82/T0/T1은 경고 없이 버림
});
test("TestCommandMatching.test_dryrun_g92_xyz_warning", () => {
  const r = parse(["G92 Z0", "G92 E0", "G92"]);
  T.eq(gl(r.blocks[0]), ["G92 Z0", "G92 E0", "G92"]);
  const w = find(r.warnings, "G92 좌표 재설정");
  T.eq(w.length, 1);
  T.has("2줄", w[0]);
  T.has("(줄 2, 4)", w[0]);
});
test("TestCommandMatching.test_lowercase_command", () => {
  const r = parse(["g1 x10 y5 f100", "g90"]);
  T.eq(gl(r.blocks[0]), ["G1 X10 Y5 F600", "g90"]);
});
test("TestCommandMatching.test_g0_kept", () => {
  const r = parse(["G0 X1 Y2 F9000"]);
  T.eq(gl(r.blocks[0]), ["G0 X1 Y2 F600"]);
});

// ---------- TestEndMarker ----------
test("TestEndMarker.test_end", () => {
  const r = parse([...layer("0.05", ["G1 X1 Y1"]), END, "G1 X5 Y5", "; c", "", "M104"]);
  T.isTrue(r.endFound);
  T.eq(r.layerCount, 1);
  T.eq(gl(r.blocks[0]), ["G1 Z0.05 F600", "G1 X1 Y1 F600"]);
  const w = find(r.warnings, "EXECUTABLE_BLOCK_END 뒤 명령");
  T.eq(w.length, 1);
  T.has("2줄", w[0]);
  T.eq(find(r.warnings, "M104"), []); // END 뒤 명령은 알 수 없는 명령으로 세지 않음
});
test("TestEndMarker.test_end_clean", () => {
  const r = parse([...layer("0.05", ["G1 X1 Y1"]), END, "; trailing comment", ""]);
  T.isTrue(r.endFound);
  T.eq(r.warnings, []);
});
test("TestEndMarker.test_no_end", () => {
  const r = parse(layer("0.05", ["G1 X1 Y1"]));
  T.isFalse(r.endFound);
  T.eq(r.warnings, []);
});
test("TestEndMarker.test_no_start", () => {
  let r = R.lines(["G90", LC, "G1 Z1"]);
  T.eq(r.blocks, []);
  T.eq(find(r.warnings, "EXECUTABLE_BLOCK_START 마커 없음").length, 1);
  r = R.lines(["G90", LC, "G1 Z1"], { mode: "print" });
  T.eq(find(r.errors, "EXECUTABLE_BLOCK_START 마커 없음").length, 1);
});
test("TestEndMarker.test_before_start_ignored", () => {
  const r = R.lines(["M104 S200", "G1 X1 Y1", START, "G90"]);
  T.eq(gl(r.blocks[0]), ["G90"]);
  T.eq(r.warnings, []);
  T.eq(r.blocks[0].lineNo, 4);
});

// ---------- TestZMarker ----------
const ZMARKER_LINES = [
  ...layer("0.05", ["G1 X1 Y1"], false), // 층 1: ;Z: 없음
  ...[LC, ";Z:0.1", "G1 Z0.11", "G1 X1 Y1"], // 층 2: 불일치
  ...[LC, ";Z:abc", "G1 Z0.15", "G1 X1 Y1"], // 층 3: 잘못된 값
];
test("TestZMarker.test_dryrun", () => {
  const r = parse(ZMARKER_LINES);
  T.eq(r.errors, []);
  T.has("(층 1)", find(r.warnings, ";Z: 마커 없는 층")[0]);
  T.has("(층 2)", find(r.warnings, ";Z:와 G1 Z 불일치")[0]);
  T.eq(find(r.warnings, "잘못된 ;Z: 값").length, 1);
  T.eq(r.blocks[1].markerZ, 0.1);
  T.isNull(r.blocks[0].markerZ);
  T.isNull(r.blocks[2].markerZ);
});
test("TestZMarker.test_print", () => {
  const r = parse(ZMARKER_LINES, { mode: "print" });
  T.eq(find(r.errors, ";Z: 마커 없는 층").length, 1);
  T.eq(find(r.errors, ";Z:와 G1 Z 불일치").length, 1);
  T.eq(find(r.errors, "잘못된 ;Z: 값").length, 1);
  T.eq(find(r.warnings, ";Z:"), []);
});
test("TestZMarker.test_first_marker_only", () => {
  const r = parse([LC, ";Z:0.05", ";Z:9", "G1 Z0.05", "G1 X1 Y1"]);
  T.eq(r.blocks[0].markerZ, 0.05);
  T.eq(r.warnings, []);
});

// ---------- TestFirstMoveZ ----------
const FIRSTZ_LINES = [
  ...[LC, ";Z:0.05", "T0", "G1 Z0.05", "G1 X1 Y1"], // 층 1: T0 먼저
  ...[LC, ";Z:0.1", "G1 X1 Y1", "G1 Z0.1", "G1 X2 Y2"], // 층 2: XY 먼저
  ...[LC, ";Z:0.15", "G1 E1", "G1 Z0.15", "G1 X2 Y2"], // 층 3: E 먼저
  ...[LC, ";Z:0.2", "G1 X3 Y3"], // 층 4: 순수 Z 없음
  ...layer("0.25", ["T0", "G1 X1 Y1"]), // 층 5: 정상
];
test("TestFirstMoveZ.test_dryrun", () => {
  const r = parse(FIRSTZ_LINES, { keepE: true });
  const w = find(r.warnings, "층 첫 이동이 G1 Z가 아님");
  T.eq(w.length, 1);
  T.has("4층", w[0]);
  T.has("(층 1, 2, 3, 4)", w[0]);
  T.eq(r.errors, []);
  T.isNull(r.blocks[3].z);
  T.eq(r.blocks[4].z, 0.25);
});
test("TestFirstMoveZ.test_dryrun_e_removed_still_detects_tool", () => {
  const r = parse([LC, ";Z:0.05", "T0", "G1 Z0.05", "G1 X1 Y1"], { keepE: false });
  T.eq(gl(r.blocks[0]), ["G1 Z0.05 F600", "G1 X1 Y1 F600"]);
  T.has("(층 1)", find(r.warnings, "층 첫 이동이 G1 Z가 아님")[0]);
});
test("TestFirstMoveZ.test_print", () => {
  const r = parse(FIRSTZ_LINES, { mode: "print" });
  const e = find(r.errors, "층 첫 이동이 G1 Z가 아님");
  T.eq(e.length, 1);
  T.has("(층 1, 2, 3, 4)", e[0]);
  T.eq(find(r.warnings, "층 첫 이동"), []);
});
test("TestFirstMoveZ.test_preamble_not_checked", () => {
  const r = parse(["G90", "M83", "T0", "G1 X1 Y1", ...layer("0.05", ["G1 X1 Y1"])], { keepE: true });
  T.eq(r.warnings, []);
});

// ---------- TestPrintF ----------
test("TestPrintF.test_classes_and_modal", () => {
  const r = parse(
    [
      "G90",
      "M83",
      LC,
      ";Z:0.05",
      "G1 Z0.05", // 순수 Z (modal 없음 → 그래도 F300, 경고 없음)
      "G1 X1 Y1", // modal 없음 → 트래블 한계 + 경고
      "G1 X2 Y2 E1 F3000", // 도포 3000 → 1800
      "G1 X3 Y3 F9000", // 트래블 9000 → 6000
      "G1 X4 Y4 F3000", // 트래블 3000 그대로
      "G1 E-1 F2400", // E 단독 2400 → 1800
      "G1 Z0.5", // 순수 Z → F300 (modal 2400 유지)
      "G1 X5 Y5", // 순수 Z 다음 F 없는 XY → modal 2400 (F300 아님)
      "G1 Z0.05 F9000", // 순수 Z F9000 → F300, modal은 9000
      "G1 X6 Y6", // modal 9000 → 트래블 6000
      "G1 F1500", // F 단독 → 버림, modal 1500
      "G1 X7 Y7 E1", // 도포 1500
    ],
    { mode: "print" },
  );
  // 층 안 두 번째 이후 순수 Z(줄 12, 14)는 위반 — 출력(F300)은 그대로
  T.eq(r.errors.length, 1);
  T.has("층 안 Z 이동 2줄 (줄 12, 14)", r.errors[0]);
  T.eq(gl(r.blocks[1]), [
    `G1 Z0.05 F${P.Z_SPEED_F}`,
    "G1 X1 Y1 F6000",
    "G1 X2 Y2 E1 F1800",
    "G1 X3 Y3 F6000",
    "G1 X4 Y4 F3000",
    "G1 E-1 F1800",
    "G1 Z0.5 F300",
    "G1 X5 Y5 F2400",
    "G1 Z0.05 F300",
    "G1 X6 Y6 F6000",
    "G1 X7 Y7 E1 F1500",
  ]);
  for (const ln of gl(r.blocks[1])) T.regex(ln, / F\d+$/);
  T.has("1줄", find(r.warnings, "F 미지정 이동")[0]);
  const dep = find(r.warnings, "도포 F 클램프")[0];
  T.has("1줄", dep);
  T.has("F3000", dep);
  T.has("F1800", dep);
  const trv = find(r.warnings, "트래블 F 클램프")[0];
  T.has("2줄", trv);
  T.has("최대 원래 F9000", trv);
  T.has("F2400", find(r.warnings, "E 단독 F 클램프")[0]);
  T.has("1줄", find(r.warnings, "F 단독 줄")[0]);
});
test("TestPrintF.test_pure_z_f_does_not_leak", () => {
  // 실출력에서 순수 Z 줄의 F300이 다음 줄로 새지 않음: 다음 줄은 항상 자기 F를 가짐
  const r = parse([LC, ";Z:0.05", "G1 Z0.05 F21000", "G1 X1 Y1", "G1 X2 Y2 E0.1"], { mode: "print" });
  T.eq(gl(r.blocks[0]), ["G1 Z0.05 F300", "G1 X1 Y1 F6000", "G1 X2 Y2 E0.1 F1800"]);
});
test("TestPrintF.test_modal_missing_limits", () => {
  const r = parse(["G1 X1 Y1 E1", "G1 E1", "G1 X2 Y2"], { mode: "print" });
  T.eq(gl(r.blocks[0]), ["G1 X1 Y1 E1 F1800", "G1 E1 F1800", "G1 X2 Y2 F6000"]);
  T.has("3줄", find(r.warnings, "F 미지정 이동")[0]);
});
test("TestPrintF.test_custom_limits_and_z_speed", () => {
  const r = parse(["G1 X1 Y1 E1 F3000", "G1 X2 Y2", "G1 Z1"], {
    mode: "print",
    fLimits: { deposit: 1200 },
    zSpeedF: 150,
  });
  T.eq(gl(r.blocks[0]), ["G1 X1 Y1 E1 F1200", "G1 X2 Y2 F3000", "G1 Z1 F150"]);
  T.eq(P.PRINT_F_LIMITS.deposit, 1800); // 기본값 불변
});
test("TestPrintF.test_print_keeps_e", () => {
  const r = parse(["G1 X1 Y1 E0.5 F600"], { mode: "print", keepE: false });
  T.eq(gl(r.blocks[0]), ["G1 X1 Y1 E0.5 F600"]);
});
test("TestPrintF.test_dryrun_all_f600", () => {
  const r = parse(["G1 Z5 F300", "G1 X1 Y1 E1 F3000", "G1 E-1 F2400"], { keepE: true });
  T.eq(gl(r.blocks[0]), ["G1 Z5 F600", "G1 X1 Y1 E1 F600", "G1 E-1 F600"]);
  T.eq(r.warnings, []);
});

// ---------- TestPrintCommands ----------
test("TestPrintCommands.test_forbidden", () => {
  const r = parse(["G90", "M83", "G28", "G91", "M82", "G92 Z0", "G92", "G92 E0", "T0", "T1", "M400"], {
    mode: "print",
  });
  T.eq(gl(r.blocks[0]), ["G90", "M83", "G92 E0", "T0", "T1", "M400"]);
  T.eq(find(r.errors, "G28 1줄").length, 1);
  T.has("호밍", find(r.errors, "G28")[0]);
  T.has("상대 좌표", find(r.errors, "G91")[0]);
  T.has("M83 필수", find(r.errors, "M82")[0]);
  const g92 = find(r.errors, "G92 좌표 재설정");
  T.eq(g92.length, 1);
  T.has("2줄", g92[0]);
});
test("TestPrintCommands.test_manual_stepper_removed", () => {
  for (const mode of ["dryrun", "print"]) {
    const r = parse(
      ["MANUAL_STEPPER STEPPER=blade MOVE=10", ...layer("0.05", ["manual_stepper STEPPER=blade MOVE=0"])],
      { mode },
    );
    const allGcode = r.blocks.map((b) => b.gcode).join("\n");
    T.hasNot("MANUAL_STEPPER", allGcode.toUpperCase(), mode);
    const w = find(r.warnings, "블레이드 명령");
    T.eq(w.length, 1, mode);
    T.has("2줄", w[0]);
  }
});
test("TestPrintCommands.test_bad_move", () => {
  for (const line of ["G1 X10 A5", "G1 X10 X20", "G1 X", "G1 Xnan", "G1 X1e3", "G1 X10 F0", "G1 X10 F-5"]) {
    let r = parse([line]);
    T.eq(r.blocks, [], line);
    T.eq(find(r.warnings, "잘못된 이동 줄").length, 1, line);
    r = parse([line], { mode: "print" });
    T.eq(find(r.errors, "잘못된 이동 줄").length, 1, line);
  }
});
test("TestPrintCommands.test_number_text_kept", () => {
  let r = parse(["G1 X.5 Y-1. E-.8 F1800"], { mode: "print" });
  T.eq(gl(r.blocks[0]), ["G1 X.5 Y-1. E-.8 F1800"]);
  r = parse(["G1 E1 Y2 X3 Z4 F100"], { keepE: true });
  T.eq(gl(r.blocks[0]), ["G1 X3 Y2 Z4 E1 F600"]);
});
test("TestPrintCommands.test_invalid_mode", () => {
  T.raises(() => parse(["G90"], { mode: "run" }));
});

// ---------- TestG92Args (v0.2.1 — 협의 §28-3 1·2: G92 인자 검사, 두 모드) ----------
const G92_MSG = "잘못된 G92 줄";
// E만 썼지만 잘못된 인자 / 허용 안 되는 글자 / 중복 / 무한대
const G92_BAD = [
  "G92 E", "G92 E1e3", "G92 E1 E2", "G92 e1E3", "G92 Enan", "G92 E1_0", "G92 X",
  "G92 F100", "G92 E0 A1", "G92 E" + "9".repeat(400),
];
test("TestG92Args.test_print_bad", () => {
  for (const line of G92_BAD) {
    const r = parse([line], { mode: "print" });
    T.eq(r.blocks, [], line);
    T.eq(find(r.errors, G92_MSG).length, 1, line);
    // 예전 오류: E만 썼는데 "X/Y/Z 재설정 금지"로 나옴 → 이제 그 사유로는 나오지 않음
    T.eq(find(r.errors, "G92 좌표 재설정"), [], line);
    T.eq(find(r.warnings, G92_MSG), [], line);
  }
});
test("TestG92Args.test_print_message", () => {
  const r = parse(["G92 E", "G92 E1e3", "G92 E0"], { mode: "print" });
  T.eq(gl(r.blocks[0]), ["G92 E0"]);
  T.eq(r.errors, ["잘못된 G92 줄 2줄 (줄 2, 3) — 버림 (인자는 X/Y/Z/E + 10진수, 중복 금지)"]);
  T.eq(r.warnings, []);
});
test("TestG92Args.test_print_valid_args", () => {
  // E만 → 통과 (원문 그대로)
  let r = parse(["G92 E0", "g92 e-.5", "G92 E+1. ; c"], { mode: "print" });
  T.eq(gl(r.blocks[0]), ["G92 E0", "g92 e-.5", "G92 E+1."]);
  T.eq(r.errors, []);
  // X/Y/Z 있음 / 인자 없음(전 축 재설정) → 기존 X/Y/Z 재설정 오류
  r = parse(["G92 Z0", "G92", "G92 E0 X1"], { mode: "print" });
  T.eq(r.blocks, []);
  T.eq(r.errors, ["G92 좌표 재설정 3줄 (줄 2, 3, 4) — X/Y/Z 재설정 금지 (G92 E만 허용)"]);
  T.eq(r.warnings, []);
});
test("TestG92Args.test_dryrun_bad", () => {
  for (const keepE of [false, true]) {
    for (const line of G92_BAD) {
      const r = parse([line], { keepE });
      T.eq(r.blocks, [], line); // 버림 — Klipper로 보내지 않음
      T.eq(find(r.warnings, G92_MSG).length, 1, line);
      T.eq(find(r.warnings, "G92 좌표 재설정"), [], line);
      T.eq(r.errors, []);
    }
  }
});
test("TestG92Args.test_dryrun_message", () => {
  const r = parse(["G92 E1e3", "G92 E", "G92 E1 E2", "G90"]);
  T.eq(gl(r.blocks[0]), ["G90"]);
  T.eq(r.warnings, ["잘못된 G92 줄 3줄 (줄 2, 3, 4) — 버림 (인자는 X/Y/Z/E + 10진수, 중복 금지)"]);
});
test("TestG92Args.test_dryrun_valid_args", () => {
  for (const keepE of [false, true]) {
    let r = parse(["G92 E0"], { keepE });
    T.eq(gl(r.blocks[0]), ["G92 E0"]);
    T.eq(r.warnings, []);
    r = parse(["G92 Z0"], { keepE });
    T.eq(gl(r.blocks[0]), ["G92 Z0"]);
    T.eq(r.warnings, ["G92 좌표 재설정(X/Y/Z) 1줄 (줄 2) — 층 Z 기준이 틀어질 수 있음"]);
  }
});

// ---------- TestZNumberFormat (v0.2.1 — 협의 §28-3 3: Z 관련 위반 문구 숫자 소수 4자리) ----------
test("TestZNumberFormat.test_mismatch_big_z", () => {
  const lines = [LC, ";Z:1000.002", "G1 Z1000", "G1 X1 Y1"];
  let r = parse(lines);
  T.eq(find(r.warnings, ";Z:와 G1 Z 불일치"), [
    ";Z:와 G1 Z 불일치 1층 (층 1) — 첫 사례 층 1: ;Z:1000.0020 ≠ G1 Z1000.0000",
  ]);
  r = parse(lines, { mode: "print" });
  T.has(";Z:1000.0020 ≠ G1 Z1000.0000", find(r.errors, ";Z:와 G1 Z 불일치")[0]);
});
test("TestZNumberFormat.test_layer_height", () => {
  const lines = [...layer("0.05", ["G1 X1 Y1"]), ...layer("0.1", ["G1 X1 Y1"]), ...layer("0.16", ["G1 X1 Y1"])];
  let r = parse(lines, { layerHeightMm: 0.05 });
  T.eq(find(r.warnings, "Z ≠ (N+1)×층두께"), [
    "Z ≠ (N+1)×층두께 1층 (층 3) — 층두께 0.0500, 첫 사례 층 3: Z0.1600 (기대 Z0.1500)",
  ]);
  r = parse(layer("1000.002", ["G1 X1 Y1"]), { layerHeightMm: 1000, mode: "print" });
  T.has("층두께 1000.0000, 첫 사례 층 1: Z1000.0020 (기대 Z1000.0000)", find(r.errors, "Z ≠ (N+1)×층두께")[0]);
});
test("TestZNumberFormat.test_z_down", () => {
  const lines = [...layer("1000.002", ["G1 X1 Y1"]), ...layer("1000", ["G1 X1 Y1"])];
  let r = parse(lines);
  T.eq(find(r.warnings, "Z가 이전 층보다 작음"), [
    "Z가 이전 층보다 작음 1층 (층 2) — 첫 사례 층 2: Z1000.0000 < 이전 Z1000.0020",
  ]);
  r = parse(lines, { mode: "print" });
  T.has("Z1000.0000 < 이전 Z1000.0020", find(r.errors, "Z가 이전 층보다 작음")[0]);
});
test("TestZNumberFormat.test_other_numbers_unchanged", () => {
  // Z 외 문구(F 클램프)는 기존 형식 그대로
  const r = parse(["G1 X1 Y1 F9000.5"], { mode: "print" });
  T.has("최대 원래 F9000.5, 한계 F6000", find(r.warnings, "트래블 F 클램프")[0]);
});

// ---------- TestNoArgMove (v0.2.1 — 협의 §28-3 4: 인자 없는 G0/G1 은 'F 단독 줄'과 따로 경고) ----------
test("TestNoArgMove.test_both_modes", () => {
  for (const kw of [{}, { keepE: true }, { mode: "print" }]) {
    const r = parse(["G1", "g0", "G1 ; c", "G1 F1800", "G90"], kw);
    T.eq(gl(r.blocks[0]), ["G90"], show(kw));
    T.eq(find(r.warnings, "인자 없는 이동 줄"), ["인자 없는 이동 줄 3줄 (줄 2, 3, 4) — 버림"], show(kw));
    T.eq(find(r.warnings, "F 단독 줄"), ["F 단독 줄 1줄 (줄 5) — 버림 (규격서 §4-2)"], show(kw));
    T.eq(r.errors, [], show(kw));
  }
});
test("TestNoArgMove.test_modal_f_unchanged", () => {
  // 인자 없는 G1은 modal F를 바꾸지 않음, F 단독 줄은 그대로 modal 갱신
  const r = parse(["G1 F1500", "G1", "G1 X1 Y1"], { mode: "print" });
  T.eq(gl(r.blocks[0]), ["G1 X1 Y1 F1500"]);
  T.eq(find(r.warnings, "F 미지정 이동"), []);
});
test("TestNoArgMove.test_not_a_first_move", () => {
  // 이동이 아니므로 층 첫 이동 판정(불변식 1)에 영향 없음
  const r = parse([LC, ";Z:0.05", "G1", "G1 Z0.05", "G1 X1 Y1"]);
  T.eq(gl(r.blocks[0]), ["G1 Z0.05 F600", "G1 X1 Y1 F600"]);
  T.eq(find(r.warnings, "층 첫 이동"), []);
  T.eq(find(r.warnings, "인자 없는 이동 줄").length, 1);
});

// ---------- TestZMixed ----------
const ZMIXED_LINES = [
  "G1 X1 Y1 Z0.6 F3000", // 프리앰블 (줄 2)
  ...layer("0.05", [
    "G1 X1 Y1 F3000",
    "G1 X2 Y2 Z0.6", // 경사 Z-hop (줄 7)
    "G1 Z0.65 E0.1 F1200", // Z+E (줄 8)
    "G1 X3 Y3 E0.5",
  ]),
];
test("TestZMixed.test_dryrun", () => {
  const r = parse(ZMIXED_LINES, { keepE: true });
  const w = find(r.warnings, "Z와 XY/E 동시 이동");
  T.eq(w.length, 1);
  T.has("3줄 (줄 2, 7, 8)", w[0]);
  T.eq(r.errors, []);
  // 출력 줄은 그대로 (F600)
  T.eq(gl(r.blocks[0]), ["G1 X1 Y1 Z0.6 F600"]);
  T.eq(gl(r.blocks[1]), [
    "G1 Z0.05 F600",
    "G1 X1 Y1 F600",
    "G1 X2 Y2 Z0.6 F600",
    "G1 Z0.65 E0.1 F600",
    "G1 X3 Y3 E0.5 F600",
  ]);
});
test("TestZMixed.test_print", () => {
  const r = parse(ZMIXED_LINES, { mode: "print" });
  const e = find(r.errors, "Z와 XY/E 동시 이동");
  T.eq(e.length, 1);
  T.has("3줄", e[0]);
  T.eq(find(r.warnings, "Z와 XY/E"), []);
  // F = min(분류 한계 적용 F, z_speed_f)
  T.eq(gl(r.blocks[0]), ["G1 X1 Y1 Z0.6 F300"]);
  T.eq(gl(r.blocks[1]), [
    "G1 Z0.05 F300",
    "G1 X1 Y1 F3000",
    "G1 X2 Y2 Z0.6 F300",
    "G1 Z0.65 E0.1 F300",
    "G1 X3 Y3 E0.5 F1200",
  ]);
});
test("TestZMixed.test_print_slower_than_z_speed", () => {
  const r = parse(["G1 X1 Y1 Z1 F600", "G1 X2 Y2 Z2 F9000"], { mode: "print", zSpeedF: 1000 });
  T.eq(gl(r.blocks[0]), ["G1 X1 Y1 Z1 F600", "G1 X2 Y2 Z2 F1000"]);
});
test("TestZMixed.test_pure_z_not_mixed", () => {
  const r = parse(layer("0.05", ["G1 X1 Y1", "G1 Z0.6 F9000", "G1 E-1"]), { keepE: true });
  T.eq(find(r.warnings, "Z와 XY/E"), []);
});
test("TestZMixed.test_message", () => {
  const r = parse(["G1 X1 Y1 Z0.6"]);
  T.has("Z는 층 첫 G1 Z 한 줄로만 (규격서 §7)", find(r.warnings, "Z와 XY/E 동시 이동")[0]);
});

// ---------- TestZExtra ----------
// Orca 수직 Z-hop: 층 첫 Z 뒤 G1 Z.6 → 트래블 → G1 Z.2
const ZEXTRA_LINES = [
  "G1 Z5",
  "G0 Z6", // 프리앰블 순수 Z (대상 아님)
  ...layer("0.2", [
    "G1 E-.8 F1800",
    "G1 Z.6 F21000", // 줄 8: 층 안 Z
    "G1 X1 Y1",
    "G1 Z.2", // 줄 10: 층 안 Z
    "G1 X2 Y2 Z0.3", // 줄 11: 섞인 줄
    "G1 X3 Y3 E1",
  ]),
];
test("TestZExtra.test_dryrun", () => {
  const r = parse(ZEXTRA_LINES, { keepE: true });
  const w = find(r.warnings, "층 안 Z 이동");
  T.eq(w.length, 1);
  T.has("2줄 (줄 8, 10)", w[0]); // 섞인 줄(11)·프리앰블(2, 3)은 들어가지 않음
  T.has("층 첫 G1 Z 말고는 Z 금지 (규격서 §7)", w[0]);
  T.has("1줄 (줄 11)", find(r.warnings, "Z와 XY/E 동시 이동")[0]);
  T.eq(r.errors, []);
  // 출력·층 판정은 그대로: z/marker_z는 첫 순수 Z, 불변식 1 위반 없음
  T.eq(gl(r.blocks[0]), ["G1 Z5 F600", "G0 Z6 F600"]);
  T.eq(gl(r.blocks[1]), [
    "G1 Z0.2 F600",
    "G1 E-.8 F600",
    "G1 Z.6 F600",
    "G1 X1 Y1 F600",
    "G1 Z.2 F600",
    "G1 X2 Y2 Z0.3 F600",
    "G1 X3 Y3 E1 F600",
  ]);
  T.eq(r.blocks[1].z, 0.2);
  T.eq(r.blocks[1].markerZ, 0.2);
  T.eq(find(r.warnings, "층 첫 이동"), []);
  T.eq(find(r.warnings, ";Z:와 G1 Z 불일치"), []);
});
test("TestZExtra.test_print", () => {
  const r = parse(ZEXTRA_LINES, { mode: "print" });
  const e = find(r.errors, "층 안 Z 이동");
  T.eq(e.length, 1);
  T.has("2줄 (줄 8, 10)", e[0]);
  T.eq(find(r.warnings, "층 안 Z 이동"), []);
  // 순수 Z 출력은 z_speed_f 그대로
  T.eq(gl(r.blocks[1])[2], "G1 Z.6 F300");
  T.eq(gl(r.blocks[1])[4], "G1 Z.2 F300");
});
test("TestZExtra.test_preamble_pure_z_ok", () => {
  const r = parse(["G1 Z5", "G1 Z6", ...layer("0.05", ["G1 X1 Y1"])]);
  T.eq(r.warnings, []);
});
test("TestZExtra.test_each_layer_first_z_ok", () => {
  const r = parse([...layer("0.05", ["G1 X1 Y1"]), ...layer("0.1", ["G1 X1 Y1"]), ...layer("0.15")]);
  T.eq(r.warnings, []);
});

// ---------- TestArgValidation ----------
test("TestArgValidation.test_f_limits", () => {
  const bads = [
    { deposit: 0 },
    { travel: -1 },
    { e_only: Infinity },
    { deposit: NaN },
    { deposit: "1800" },
    { travel: null },
    { deposit: true },
    { deposti: 1200 },
  ];
  for (const bad of bads) T.raises(() => parse(["G90"], { mode: "print", fLimits: bad }), show(bad));
  parse(["G90"], { mode: "print", fLimits: { deposit: 1200.5, travel: 3000 } }); // 정상
});
test("TestArgValidation.test_z_speed_f", () => {
  // 10 ** 400 (Python 큰 int) → BigInt
  for (const bad of [0, -300, NaN, Infinity, "300", null, false, 10n ** 400n]) {
    T.raises(() => parse(["G90"], { mode: "print", zSpeedF: bad }), show(bad));
  }
  const r = parse(["G1 Z1"], { mode: "print", zSpeedF: 150.4 });
  T.eq(gl(r.blocks[0]), ["G1 Z1 F150"]);
});
test("TestArgValidation.test_layer_height", () => {
  for (const bad of [0, -0.05, NaN, Infinity, "0.05"]) {
    T.raises(() => parse(["G90"], { layerHeightMm: bad }), show(bad));
  }
});
test("TestArgValidation.test_validated_in_dryrun_too", () => {
  T.raises(() => parse(["G90"], { fLimits: { deposit: 0 } }));
});

// ---------- TestLayerHeight ----------
test("TestLayerHeight.test_layer_height", () => {
  // 원본 layer(0.10, ...) → f"{0.10}" = "0.1"
  const lines = [...layer("0.05", ["G1 X1 Y1"]), ...layer("0.1", ["G1 X1 Y1"]), ...layer("0.16", ["G1 X1 Y1"])];
  let r = parse(lines, { layerHeightMm: 0.05 });
  const w = find(r.warnings, "Z ≠ (N+1)×층두께");
  T.eq(w.length, 1);
  T.has("1층 (층 3)", w[0]);
  r = parse(lines, { layerHeightMm: 0.05, mode: "print" });
  T.eq(find(r.errors, "Z ≠ (N+1)×층두께").length, 1);
});
test("TestLayerHeight.test_layer_height_float_ok", () => {
  const lines = [...layer("0.05", ["G1 X1 Y1"]), ...layer("0.1", ["G1 X1 Y1"]), ...layer("0.15", ["G1 X1 Y1"])];
  const r = parse(lines, { layerHeightMm: 0.05 });
  T.eq(r.warnings, []);
});
test("TestLayerHeight.test_z_decrease", () => {
  const lines = [...layer("0.1", ["G1 X1 Y1"]), ...layer("0.05", ["G1 X1 Y1"]), ...layer("0.15", ["G1 X1 Y1"])];
  let r = parse(lines);
  const w = find(r.warnings, "Z가 이전 층보다 작음");
  T.eq(w.length, 1);
  T.has("(층 2)", w[0]);
  r = parse(lines, { mode: "print" });
  T.eq(find(r.errors, "Z가 이전 층보다 작음").length, 1);
});
test("TestLayerHeight.test_same_z_allowed", () => {
  const r = parse([...layer("0.1", ["G1 X1 Y1"]), ...layer("0.1", ["G1 X1 Y1"])]);
  T.eq(find(r.warnings, "Z가 이전 층보다 작음"), []);
});

// ---------- TestEmptyLayer ----------
test("TestEmptyLayer.test_empty_layer_kept", () => {
  const lines = [...layer("0.05", ["G1 X1 Y1"]), ...layer("0.1"), ...layer("0.15", ["G1 X1 Y1"])];
  const r = parse(lines);
  T.eq(r.layerCount, 3);
  T.eq(r.blocks.length, 3);
  T.eq(
    r.blocks.map((b) => b.layerIndex),
    [0, 1, 2],
  );
  T.eq(gl(r.blocks[1]), ["G1 Z0.1 F600"]);
  T.isFalse(r.blocks[1].hasXy);
  T.isTrue(r.blocks[0].hasXy && r.blocks[2].hasXy);
  T.eq(r.warnings, []);
});
test("TestEmptyLayer.test_zero_output_layer_kept", () => {
  // E 제거 모드에서 출력 줄 0개가 되는 층도 블록 유지 (인덱스 밀림 방지)
  const lines = [
    ...layer("0.05", ["G1 X1 Y1"]),
    ...[LC, ";Z:0.1", "T0", "G1 E5"],
    ...layer("0.15", ["G1 X1 Y1"]),
    LC, // 파일 끝의 내용 없는 층
  ];
  const r = parse(lines, { keepE: false });
  T.eq(r.layerCount, 4);
  T.eq(
    r.blocks.map((b) => b.layerIndex),
    [0, 1, 2, 3],
  );
  T.eq(r.blocks[1].gcode, "");
  T.eq(r.blocks[3].gcode, "");
  T.eq(r.blocks[2].z, 0.15);
});
test("TestEmptyLayer.test_preamble_without_output_dropped", () => {
  const r = parse(["M104 S0", ...layer("0.05", ["G1 X1 Y1"])]);
  T.eq(r.blocks.length, 1);
  T.isTrue(r.blocks[0].isLayer);
});
test("TestEmptyLayer.test_line_numbers", () => {
  const r = parse(["G90", ...layer("0.05", ["G1 X1 Y1"])]);
  T.eq(r.blocks[0].lineNo, 2); // 프리앰블 첫 명령 줄
  T.eq(r.blocks[1].lineNo, 3); // ;LAYER_CHANGE 줄
  T.isFalse(r.blocks[0].isLayer);
  T.isNull(r.blocks[0].layerIndex);
});

// ---------- TestMaxLayers ----------
const MAXL_LINES = [
  "G90",
  ...layer("0.05", ["G1 X1 Y1"]),
  ...layer("0.1", ["G1 X2 Y2"]),
  ...layer("0.15", ["G1 X3 Y3"]),
  ...layer("0.2", ["G1 X4 Y4"]),
  END,
];
test("TestMaxLayers.test_max_two", () => {
  const r = parse(MAXL_LINES, { maxLayers: 2 });
  T.eq(r.blocks.length, 3);
  T.eq(r.layerCount, 2);
  T.isFalse(r.blocks[0].isLayer);
  T.eq(
    r.blocks.slice(1).map((b) => b.layerIndex),
    [0, 1],
  );
  T.eq(gl(r.blocks[2]), ["G1 Z0.1 F600", "G1 X2 Y2 F600"]);
  T.ne(r.blocks[1].gcode, r.blocks[2].gcode);
  T.isFalse(r.endFound);
  T.eq(r.warnings, []);
});
test("TestMaxLayers.test_max_zero_all", () => {
  const r = parse(MAXL_LINES, { maxLayers: 0 });
  T.eq(r.layerCount, 4);
  T.eq(r.blocks.length, 5);
  T.isTrue(r.endFound);
});
test("TestMaxLayers.test_max_counts_empty_layer", () => {
  const lines = [...layer("0.05", ["G1 X1 Y1"]), ...layer("0.1"), ...layer("0.15", ["G1 X1 Y1"])];
  const r = parse(lines, { maxLayers: 2 });
  T.eq(r.layerCount, 2);
  T.isFalse(r.blocks[1].hasXy);
});

// ---------- TestRepoFiles ----------
test("TestRepoFiles.test_test2_gcode", () => {
  const r = R.text(TEST2_GCODE, { mode: "dryrun", keepE: true });
  T.eq(r.blocks.length, 4);
  T.eq(r.layerCount, 3);
  T.eq(r.warnings, []);
  T.eq(r.errors, []);
  T.isTrue(r.endFound);
  T.isFalse(r.blocks[0].isLayer);
  T.eq(
    r.blocks.slice(1).map((b) => gl(b)[0]),
    ["G1 Z5 F600", "G1 Z10 F600", "G1 Z15 F600"],
  );
  T.isTrue(r.blocks.slice(1).every((b) => b.hasXy));
  T.eq(
    r.blocks.slice(1).map((b) => b.markerZ),
    [5.0, 10.0, 15.0],
  );
});
test("TestRepoFiles.test_test2_gcode_e_removed", () => {
  const r = R.text(TEST2_GCODE, { mode: "dryrun", keepE: false });
  T.eq(r.blocks.length, 4);
  T.eq(r.warnings, []);
  for (const b of r.blocks) T.hasNot("E", b.gcode.split("F600").join(""));
});
test("TestRepoFiles.test_bom", () => {
  // 원본: encoding="utf-8" 로 '\ufeff; EXECUTABLE_BLOCK_START...' 를 쓴 파일 → parse_gcode_file(utf-8-sig)
  const r = R.text("\ufeff; EXECUTABLE_BLOCK_START\nG90\n;LAYER_CHANGE\n;Z:0.05\nG1 Z0.05\nG1 X1 Y1\n", {
    mode: "dryrun",
  });
  T.eq(r.warnings, []);
  T.eq(r.blocks.length, 2);
  T.eq(r.layerCount, 1);
});
let bigFileDryrunMs = null;
test(
  "TestRepoFiles.test_big_file",
  () => {
    const t0 = performance.now();
    const r = P.parseGcodeText(fs.readFileSync(BIG_FILE, "utf8"), { mode: "dryrun", keepE: true });
    const dt = (performance.now() - t0) / 1000;
    bigFileDryrunMs = Math.round(dt * 1000);
    T.eq(r.layerCount, 831);
    T.le(r.warnings.length, 30);
    T.lt(dt, 15.0);
  },
  fs.existsSync(BIG_FILE) ? null : "뚜껑 G-code 파일 없음 (git 미추적)",
);

// ---------- TestNormalize ----------
test("TestNormalize.test_cases", () => {
  T.eq(R.norm("G1 X10 ; c", false), "G1 X10 F600");
  T.isNull(R.norm("G1 E5", false));
  T.eq(R.norm("G1 E5", true), "G1 E5 F600");
  T.isNull(R.norm("G1 Xnan", false));
  T.isNull(R.norm("G1 Xinf", false));
  T.isNull(R.norm("G1 X1e3", false));
  T.isNull(R.norm("G1 X10 X20", false));
  T.isNull(R.norm("G1 F1800", true));
  T.isNull(R.norm("G1", true));
  T.isNull(R.norm("M104 S200", true));
  T.isNull(R.norm("; G1 X10", true));
  T.eq(R.norm("g0 z5 f300", false), "G0 Z5 F600");
  T.eq(R.norm("G1 X10 Y10 E2 F3000 ; t", false), "G1 X10 Y10 F600");
});

// ---------- TestModuleDeps ----------
// 원본: "표준 라이브러리만 import" → 이식판: import 0 + DOM/Node 전역 미사용 (브라우저·Worker·tsx 공용)
test("TestModuleDeps.test_stdlib_only", () => {
  const src = fs.readFileSync(MODULE_PATH, "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const imports = code.match(/^\s*import\b.*$|\brequire\s*\(|\bimport\s*\(/gm) || [];
  T.eq(imports, []);
  const envGlobals = [
    "window",
    "document",
    "navigator",
    "self",
    "globalThis",
    "process",
    "Buffer",
    "require",
    "module",
    "__dirname",
    "fetch",
    "TextDecoder",
    "TextEncoder",
    "setTimeout",
    "localStorage",
    "indexedDB",
    "performance",
    "console",
  ];
  const used = envGlobals.filter((g) => new RegExp(`(?<![\\w.$])${g}\\b`).test(code));
  T.eq(used, []);
});

// ── (a) 실행 ──
console.log(`\n(a) 단위테스트 이식 — 원본 test/test_task0_gcode.py @${ORIGIN_COMMIT}`);
let unitPass = 0;
let unitFail = 0;
let unitSkip = 0;
for (const t of tests) {
  if (t.skipReason) {
    unitSkip++;
    console.log(`  skip: ${t.name} — ${t.skipReason}`);
    continue;
  }
  try {
    t.fn();
    unitPass++;
    console.log(`  ok: ${t.name}`);
  } catch (e) {
    unitFail++;
    failed++;
    console.error(`  FAIL: ${t.name} — ${e instanceof TestFailure ? e.message : e && e.stack}`);
  }
}
console.log(`  이식 테스트 ${tests.length}건 (원본 ${ORIGIN_TEST_COUNT}건): 통과 ${unitPass}, 실패 ${unitFail}, SKIP ${unitSkip}`);
if (bigFileDryrunMs !== null) console.log(`  (test_big_file JS 파싱 ${bigFileDryrunMs}ms)`);
assert(tests.length === ORIGIN_TEST_COUNT, `이식 테스트 수 ${tests.length} = 원본 ${ORIGIN_TEST_COUNT}`);
assert(new Set(tests.map((t) => t.name)).size === tests.length, "이식 테스트 이름 중복 없음");

// ════════════════════════════════════════════════════════════════════════
// (b) Python 원본과의 차분 검사
// ════════════════════════════════════════════════════════════════════════

/** 결정적 PRNG (mulberry32) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x7a5c0de);
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const digits = (n) => Array.from({ length: n }, () => String(ri(0, 9))).join("");

const NUM_SPECIAL = [
  "0", "1", "10", "-5", "+3", "007", "0.05", "0.1", "0.2", "1.25", "2.5", "3.5", "0.5", "1.5", "-0.5", ".5",
  "5.", "-.8", "+.25", "-0", "0.0000005", "0.0000015", "123456.5", "1234565", "999999.5", "1.234375",
  "0.1234565", "1800", "1800.5", "6000", "9000", "21000", "12000", "1e3", "nan", "inf", "1_000", "１",
  "0x10", "--1", "1..2", "", "1.2.3", "1e-5", "Infinity", "+", "-", ".", "1,5", "٣",
];
/** 이동 인자·;Z: 값용 숫자 텍스트 (정상·경계·잘못된 표기 섞음) */
function numText() {
  const r = rand();
  if (r < 0.4) return pick(NUM_SPECIAL);
  if (r < 0.9) {
    const sign = pick(["", "", "", "-", "+"]);
    const intPart = chance(0.1) ? "" : digits(ri(1, 7));
    const frac = chance(0.6) || intPart === "" ? "." + digits(ri(intPart === "" ? 1 : 0, 7)) : "";
    return sign + intPart + frac;
  }
  if (r < 0.95) return "1" + digits(ri(303, 330)); // 309자리 이상이면 float inf
  return "0." + "0".repeat(ri(300, 330)) + digits(ri(1, 3)); // 길지만 유한(아주 작음/0)
}
const Z_NOISE = [0, 0, 0, 0, 0.0005, -0.0005, 0.0009, 0.001, 0.0011, -0.0011, 0.002, -0.002, 0.005, 0.01, -0.3];
/** 층 Z 텍스트 — 대부분 (N+1)×lh 근처, 가끔 이상값 */
function zText(n, lh) {
  if (chance(0.25)) return numText();
  const v = (n + 1) * lh + pick(Z_NOISE);
  const style = rand();
  if (style < 0.4) return String(v);
  if (style < 0.8) return v.toFixed(ri(1, 7));
  return v.toPrecision(ri(1, 8));
}
const WS = [" ", "\t", "  ", "\v", "\f", "\x1c", "\x1f", "\x85", "\u00a0", "\u3000", "\u2028", "\ufeff", "\u200b"];
/** 줄 앞뒤 공백 장식 (Python 공백 정의와 JS trim 이 다른 문자 포함 — \ufeff·\u200b 는 공백 아님) */
function decorate(line) {
  let s = line;
  if (chance(0.08)) s = pick(WS) + s;
  if (chance(0.08)) s = s + pick(WS);
  return s;
}
const SEPS = ["  ", "\t", " \t", "\u00a0", "\u3000", "\v", "\f", "\x1c", "\x85", "\u2028"];
const sep = () => (chance(0.92) ? " " : pick(SEPS));
const F_TEXTS = ["1800", "3000", "600", "21000", "2.5", "1800.5", "0.4", "0.5", "1.5", "123456.5", "1234565", "300", "9000"];
function moveLine(n, lh) {
  const cmd = pick(["G1", "G1", "G1", "G1", "G0", "g1", "g0"]);
  const args = [];
  const axes = ["X", "Y", "Z", "E", "F"].filter((a) => chance(a === "Z" ? 0.12 : a === "F" ? 0.4 : 0.55));
  if (chance(0.3)) axes.reverse();
  for (const a of axes) {
    let v;
    if (chance(0.2)) v = numText();
    else if (a === "X" || a === "Y") v = chance(0.5) ? String(ri(0, 200)) : (rand() * 200).toFixed(ri(1, 4));
    else if (a === "E") v = pick(["0.0123", "-0.8", ".8", "1", "-1.", "0.5", "-20", "20", "0"]);
    else if (a === "F") v = pick(F_TEXTS);
    else v = zText(n, lh);
    args.push((chance(0.12) ? a.toLowerCase() : a) + v);
  }
  if (chance(0.05)) args.push(pick(["A5", "X1", "S3", "Xnan", "E", "F", "X", "x2"]));
  return args.length === 0 ? cmd : cmd + sep() + args.join(sep());
}
const PASS_POOL = [
  "G28", "G28 X Y", "G90", "G91", "G92", "G92 E0", "G92 Z0", "G92 X1 E0", "G92 e1.5", "G92 E1e3", "G92 E",
  "G92 E0 E1", "G92 ße", "M400", "M83", "M82", "T0", "T1", "t1", "m83", "g90", "g28", "MANUAL_STEPPER STEPPER=blade MOVE=10",
  "manual_stepper stepper=blade", "G1", "G0", "G1 F1800", "G1 F0", "g1 f3000.5", "G1 F2.5",
  // v0.2.1 — G92 인자 검사(두 모드)·인자 없는 이동 줄
  "G92 X", "G92 F100", "G92 E0 A1", "G92 Enan", "G92 E1_0", "g92 e-.5", "G92 E+1.", "G92 e1E3", "G92 X1 Y2 Z3 E4",
  "G92 E-0", "G92\tE0", "G92 E0 X1", "G92  E0  ", "G92 E" + "9".repeat(400), "G92 E0." + "0".repeat(300) + "1",
  "G92 Y-.5 e2", "G92 Z", "g0", "g1", "G0\t", "G1 　",
];
const UNKNOWN_POOL = [
  "M104 S200", "M109 S210", "M140 S60", "M106 S255", "M107", "M84", "G4 P100", "G21", "M73 P10 R5",
  "SET_VELOCITY_LIMIT ACCEL=500", "EXCLUDE_OBJECT_START NAME=a", "EXCLUDE_OBJECT_END", "PRINT_START", "PRINT_END",
  "G280", "M4000", "T01", "T2", "G10", "G11", "G17", "G1.5 X1", "G2 X1 Y1 I1", "M82x", "ßeta 1", "ﬀ2",
  "프린트 시작", "🙂CMD", "Ⅻ", "ǰob", "ŉ", "\ufeffG90", "\u200bG90",
  "A".repeat(40), "B".repeat(41), "C".repeat(39) + "🙂" + "D", "Z".repeat(39) + "ß", "ﬀ".repeat(21),
  "LONG_" + "X".repeat(60) + " P1",
];
const UNSPACED_POOL = ["G1X10", "g0z5", "G1F1800 X1", "G1Y2 X1", "G0E1", "G1x1.5 y2", "g1f300"];
const COMMENT_POOL = [
  ";", "; c", ";HEIGHT:0.2", ";TYPE:Outer wall", ";Z:0.4", ";Z:", ";Z: 0.2 ", ";LAYER_CHANGE x", "; LAYER_CHANGE",
  ";layer_change", "; EXECUTABLE_BLOCK_START", ";WIDTH:0.4", "; EXECUTABLE_BLOCK_END x",
];
const WS_LINES = ["", " ", "\t", "\v", "\f", "\x1c", "\x85", "\u3000", "\ufeff", "\u2028", "\u200b"];
function bodyLine(n, lh) {
  const r = rand();
  let line;
  if (r < 0.5) line = moveLine(n, lh);
  else if (r < 0.6) line = pick(PASS_POOL);
  else if (r < 0.7) line = pick(UNKNOWN_POOL);
  else if (r < 0.78) line = pick(COMMENT_POOL);
  else if (r < 0.83) line = pick(WS_LINES);
  else if (r < 0.86) line = pick(UNSPACED_POOL);
  else if (r < 0.9) line = "G1 Z" + zText(n + ri(-1, 1), lh) + (chance(0.3) ? " F" + pick(F_TEXTS) : "");
  else if (r < 0.94) line = "G1 X" + ri(0, 99) + " Y" + ri(0, 99) + " Z" + zText(n, lh);
  else line = pick(["T0", "T1", "G1 E-.8 F1800", "G1 E.8", "G1 F21000"]);
  if (chance(0.08)) line += pick([" ; note", " ;X marks", ";c", "; F1800", " ;", ";;"]);
  return decorate(line);
}
/** 퍼즈 케이스 1개 → 줄 배열 */
function fuzzLines(lh) {
  const lines = [];
  for (let k = ri(0, 2); k > 0; k--) lines.push(bodyLine(0, lh)); // START 이전 (무시돼야 함)
  const sm = rand();
  if (sm < 0.04) {
    // START 없음
  } else if (sm < 0.08) {
    lines.push(pick(["; executable_block_start", ";EXECUTABLE_BLOCK_START", "; EXECUTABLE_BLOCK_START x", "\ufeff" + START]));
  } else {
    lines.push(chance(0.1) ? pick(WS) + START + pick(WS) : START);
  }
  for (let k = ri(0, 5); k > 0; k--) lines.push(bodyLine(0, lh));
  if (chance(0.05)) for (let i = 0; i < ri(21, 30); i++) lines.push(`CMD_${ri(0, 40)}`); // 알 수 없는 명령 종류 상한
  const nLayers = ri(0, 7);
  for (let i = 0; i < nLayers; i++) {
    lines.push(chance(0.95) ? decorate(LC) : pick([";LAYER_CHANGE ;x", "; LAYER_CHANGE", LC + "\u200b"]));
    const zi = chance(0.1) ? i - ri(1, 3) : i; // Z 역행
    const zt = zText(zi, lh);
    if (chance(0.06)) lines.push(pick(["T0", "T1", "G1 X1 Y1", "G1 E1", "G1 X1 Y1 Z0.5", "M106 S0"])); // 첫 이동 위반
    if (chance(0.88)) lines.push(";Z:" + (chance(0.7) ? zt : chance(0.5) ? zText(zi, lh) : pick([" " + zt + " ", "abc", "", "1e3", "nan"])));
    if (chance(0.05)) lines.push(";Z:" + zText(zi + 5, lh)); // 두 번째 마커 (무시)
    if (chance(0.9)) lines.push(decorate("G1 Z" + zt + (chance(0.2) ? " F" + pick(["300", "9000", "600.5"]) : "")));
    for (let k = ri(0, 7); k > 0; k--) lines.push(bodyLine(i, lh));
  }
  if (chance(0.55)) {
    lines.push(decorate(END));
    for (let k = ri(0, 3); k > 0; k--) lines.push(pick([bodyLine(nLayers, lh), "; c", "", "M104"]));
  } else if (chance(0.2)) {
    for (let k = ri(1, 3); k > 0; k--) lines.push(bodyLine(nLayers, lh));
  }
  return lines;
}
/** 줄 배열 → 파일 내용 (줄 끝 \n·\r\n·\r 혼합, BOM 0~2개, 마지막 줄 끝 유무) */
function toText(lines) {
  const style = pick(["\n", "\r\n", "\r", "mix"]);
  let text = "";
  lines.forEach((l, i) => {
    text += l;
    if (i < lines.length - 1 || chance(0.5)) text += style === "mix" ? pick(["\n", "\r\n", "\r"]) : style;
  });
  const bom = rand();
  if (bom < 0.03) text = "\ufeff\ufeff" + text; // utf-8-sig 는 1개만 지운다
  else if (bom < 0.33) text = "\ufeff" + text;
  return text;
}
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
function printExtras() {
  if (chance(0.5)) return {};
  const fLimits = {};
  for (const k of ["deposit", "travel", "e_only"]) {
    if (chance(0.5)) fLimits[k] = pick([1200, 1500.5, 2.5, 100000, 1e20, 1800, 1e300, 0.4]);
  }
  const out = { fLimits };
  if (chance(0.6)) out.zSpeedF = pick([150.4, 150.5, 151.5, 300, 0.4, 1e20, 1e300, 2.5, 2 ** 53]);
  return out;
}
// 250·1000: |Z| ≥ 1000 위반 문구(v0.2.1 소수 4자리 — :g 유효 6자리였으면 ±0.001 이 안 보이던 범위)
const LH_POOL = [0.05, 0.1, 0.2, 0.3, 0.25, 5, 1, 0.0000015, 0.123456789, 0.0000025, 250, 1000];

const FUZZ_CASES = 600;
function buildFuzzCorpus() {
  const out = [];
  for (let i = 0; i < FUZZ_CASES; i++) {
    const lh = pick(LH_POOL);
    const lines = fuzzLines(lh);
    const asText = chance(0.35) && !lines.some((l) => LONE_SURROGATE_RE.test(l));
    const text = asText ? toText(lines) : null;
    const combos = [
      { mode: "dryrun" },
      { mode: "dryrun", keepE: true },
      { mode: "print", ...printExtras() },
      { mode: "print", layerHeightMm: lh },
      {
        mode: pick(["dryrun", "print"]),
        keepE: chance(0.5),
        maxLayers: ri(-1, 4),
        layerHeightMm: chance(0.6) ? lh : null,
        ...(chance(0.3) ? printExtras() : {}),
      },
    ];
    for (const opts of combos) {
      out.push(asText ? { t: "text", text, opts, src: `fuzz#${i}` } : { t: "parse", lines, opts, src: `fuzz#${i}` });
    }
  }
  return out;
}

/** 숫자 포맷·반올림 경계 (결정적) — '{:g}' half-even, round(x, 6), F 정수화, 큰 수 */
function buildEdgeCorpus() {
  const groups = [
    [LC, ";Z:1234565", "G1 Z123456.5", "G1 X1 Y1"],
    [LC, ";Z:999999.5", "G1 Z1.234375", "G1 X1 Y1"],
    [LC, ";Z:0.00001", "G1 Z0.0001", "G1 X1 Y1"],
    [LC, ";Z:-0", "G1 Z-0.0000123456789", "G1 X1 Y1"],
    [LC, ";Z:1" + "0".repeat(307), "G1 Z0." + "0".repeat(320) + "5", "G1 X1 Y1"],
    [LC, ";Z:100000.5", "G1 Z100000.5", LC, ";Z:0.1234565", "G1 Z0.1234565"],
    [LC, ";Z:0.30000000000000004", "G1 Z0.3", LC, ";Z:0.0000025", "G1 Z0.0000025"],
    ["G1 X1 Y1 F1234565", "G1 X2 Y2 F2.5", "G1 X3 Y3 E1 F0.5", "G1 E1 F1.5", "G1 X4 Y4 F" + "9".repeat(40)],
    ["G1 X1 Y1 F3.5", "G1 X2 Y2 E1 F4.5", "G1 E-1 F" + "1".repeat(305), "G1 Z1 F1"],
    // 알 수 없는 명령 이름 자르기 (코드 포인트 단위) · 홀로 선 서로게이트
    ["\ud800CMD", "A".repeat(39) + "😀B", "Z".repeat(39) + "ß", "ﬀ".repeat(25), "\ud83d".repeat(3), "\udc00x"],
    // v0.2.1 Z 문구 소수 4자리 — |Z| ≥ 1000, 소수 5째 자리 동률(0.03125 는 2진 정확값 → half-even 0.0312),
    // 0 으로 반올림되는 음수('-0.0000'), 지수 범위(1e22 → 자리 전부), Z 역행
    [LC, ";Z:1000.002", "G1 Z1000", "G1 X1 Y1", LC, ";Z:999.9985", "G1 Z999.9985", "G1 X1 Y1"],
    [LC, ";Z:0.03125", "G1 Z0.04375", "G1 X1 Y1", LC, ";Z:0.00015", "G1 Z0.00015", LC, ";Z:0.00025", "G1 Z0.00025"],
    [LC, ";Z:-0.00004", "G1 Z0.5", "G1 X1 Y1", LC, ";Z:0.99995", "G1 Z0.99995"],
    [LC, ";Z:10000000000000000000000.5", "G1 Z1", "G1 X1 Y1", LC, ";Z:1234.56785", "G1 Z1234.56785"],
    // v0.2.1 G92 인자·인자 없는 이동 줄 (층 안·프리앰블)
    ["G92 E", "G92 E0", "G92", "G1", "G1 F1500", LC, ";Z:0.05", "G1", "G1 Z0.05", "G92 E1e3", "G0", "G1 X1 Y1"],
    // 줄 안 개행 문자 (줄 배열 입력)
    ["G1 X1\nG1 Y2", "G90\r", "\nG91", "G1 X1 \u2028Y2", "G1\u00a0X1"],
  ];
  const optsList = [
    { mode: "dryrun" },
    { mode: "dryrun", keepE: true },
    { mode: "print" },
    { mode: "print", fLimits: { travel: 1e300, deposit: 2.5, e_only: 1e20 }, zSpeedF: 2.5 },
    { mode: "print", fLimits: { travel: 1e300, deposit: 1e300, e_only: 1e300 }, zSpeedF: 1e300 },
    { mode: "print", layerHeightMm: 0.0000025 },
    { mode: "dryrun", layerHeightMm: 0.0000015 },
    { mode: "dryrun", layerHeightMm: 0.1234565 },
    { mode: "dryrun", layerHeightMm: 1e-7 },
    { mode: "print", layerHeightMm: 123456.5 },
    { mode: "dryrun", layerHeightMm: 5 },
    // v0.2.1 층두께·기대 Z 소수 4자리 — 동률·0 근처·큰 값·정수
    { mode: "dryrun", layerHeightMm: 0.03125 },
    { mode: "print", layerHeightMm: 0.00005 },
    { mode: "dryrun", layerHeightMm: 1000 },
    { mode: "print", layerHeightMm: 1e22 },
  ];
  const out = [];
  groups.forEach((g, gi) => {
    for (const opts of optsList) out.push({ t: "parse", lines: [START, ...g], opts, src: `edge#${gi}` });
  });
  return out;
}

/** 인자 오류 (ValueError 메시지 글자 단위 비교) */
function buildArgCorpus() {
  const lines = [START, "G90", LC, ";Z:0.05", "G1 Z0.05", "G1 X1 Y1 F3000"];
  const optsList = [
    { mode: "run" }, { mode: null }, { mode: "DRYRUN" }, { mode: "it's" }, { mode: "a\"b'c" },
    { mode: "\u00e9\u200b\x07😀\\" }, { mode: 3 }, { mode: true },
    { layerHeightMm: 0 }, { layerHeightMm: -0.05 }, { layerHeightMm: NaN }, { layerHeightMm: Infinity },
    { layerHeightMm: -Infinity }, { layerHeightMm: "0.05" }, { layerHeightMm: true }, { layerHeightMm: 1e-320 },
    { layerHeightMm: -1e16 }, { layerHeightMm: -1e-5 }, { layerHeightMm: -123456789.25 }, { layerHeightMm: -1e15 },
    { layerHeightMm: -0.0001 }, { layerHeightMm: -0 }, { layerHeightMm: null },
    { mode: "print", fLimits: { deposit: 0 } }, { mode: "print", fLimits: { travel: -1 } },
    { mode: "print", fLimits: { e_only: Infinity } }, { mode: "print", fLimits: { deposit: NaN } },
    { mode: "print", fLimits: { deposit: "1800" } }, { mode: "print", fLimits: { travel: null } },
    { mode: "print", fLimits: { deposit: true } }, { mode: "print", fLimits: { deposti: 1200 } },
    { mode: "print", fLimits: { zeta: 1, alpha: 2, deposit: 0 } }, { mode: "print", fLimits: {} },
    { mode: "print", fLimits: { deposit: 300n } }, { mode: "print", fLimits: { "\u00e9": 1, z: 2, "🙂": 3, "\uffff": 4 } },
    { mode: "print", fLimits: { e_only: -2.5e-7, travel: 0 } }, { mode: "print", fLimits: null },
    { mode: "print", zSpeedF: 0 }, { mode: "print", zSpeedF: -300 }, { mode: "print", zSpeedF: NaN },
    { mode: "print", zSpeedF: Infinity }, { mode: "print", zSpeedF: "300" }, { mode: "print", zSpeedF: null },
    { mode: "print", zSpeedF: false }, { mode: "print", zSpeedF: 10n ** 400n }, { mode: "print", zSpeedF: -(2 ** 53) },
    { mode: "print", zSpeedF: 2 ** 53 }, { mode: "print", zSpeedF: -0 }, { mode: "print", zSpeedF: 300n },
    { mode: "print", zSpeedF: -5n }, { mode: "print", zSpeedF: 2n ** 1024n }, { mode: "print", zSpeedF: 150.5 },
    { mode: "print", fLimits: { deposit: 0 }, zSpeedF: 0 }, { mode: "x", layerHeightMm: 0 },
    { layerHeightMm: 0, fLimits: { deposti: 1 } },
  ];
  return optsList.map((opts, i) => ({ t: "parse", lines, opts, src: `arg#${i}` }));
}

/** 함수 단위 (stripComment·normalizeDryrunMotion·isUnspacedMove) — 말뭉치의 서로 다른 줄 전부 */
function buildFuncCorpus(cases) {
  const seen = new Set();
  for (const c of cases) {
    const src = c.t === "parse" ? c.lines : c.t === "text" ? c.text.split(/\r\n|\r|\n/) : [];
    for (const l of src) seen.add(l);
  }
  const out = [];
  for (const s of seen) {
    out.push({ t: "strip", s, src: "func" });
    out.push({ t: "norm", s, keepE: false, src: "func" });
    out.push({ t: "norm", s, keepE: true, src: "func" });
    out.push({ t: "unspaced", s, src: "func" });
    const tok = s.trim().split(/\s+/)[0];
    if (tok && tok !== s) out.push({ t: "unspaced", s: tok, src: "func" });
  }
  return out;
}

// ── 결과 정규형 (JS·Python 공통) ──
function f64hex(x) {
  if (x === null || x === undefined) return null;
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  let s = "";
  for (let i = 0; i < 8; i++) s += dv.getUint8(i).toString(16).padStart(2, "0");
  return s;
}
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
function canonResult(r, digest) {
  return {
    blocks: r.blocks.map((b) => [
      digest ? sha256(b.gcode) : b.gcode,
      b.isLayer,
      b.layerIndex,
      b.lineNo,
      f64hex(b.z),
      f64hex(b.markerZ),
      b.hasXy,
    ]),
    warnings: r.warnings,
    errors: r.errors,
    layerCount: r.layerCount,
    endFound: r.endFound,
  };
}
function runJs(c) {
  try {
    switch (c.t) {
      case "parse":
        return { ok: canonResult(P.parseGcodeLines(c.lines, c.opts), false) };
      case "text":
        return { ok: canonResult(P.parseGcodeText(c.text, c.opts), false) };
      case "file":
        return { ok: canonResult(P.parseGcodeText(fs.readFileSync(c.path, "utf8"), c.opts), true) };
      case "strip":
        return { ok: P.stripComment(c.s) };
      case "norm":
        return { ok: P.normalizeDryrunMotion(c.s, c.keepE) };
      case "unspaced":
        return { ok: P.isUnspacedMove(c.s) };
      default:
        throw new Error(`unknown case ${c.t}`);
    }
  } catch (e) {
    return { exc: [e && e.name, e && e.message] };
  }
}

// ── Python 하네스 입출력 ──
/** JS 값 → JSON (안전 정수 = Python int, 그 외 number = 비트 그대로 float, bigint = int) */
function encVal(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : { $f: f64hex(v) };
  if (typeof v === "bigint") return { $i: v.toString() };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return { $obj: Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encVal(x)]) };
  }
  return v;
}
function encCase(c) {
  const o = { t: c.t };
  if (c.lines) o.lines = c.lines;
  if (c.text !== undefined) o.text = c.text;
  if (c.path) o.path = c.path;
  if (c.s !== undefined) o.s = c.s;
  if (c.keepE !== undefined) o.keepE = c.keepE;
  if (c.opts) {
    o.opts = {};
    for (const [k, v] of Object.entries(c.opts)) if (v !== undefined) o.opts[k] = encVal(v);
  }
  return o;
}

const PY_HARNESS = String.raw`
import hashlib, importlib.util, json, os, struct, sys

mod_path, cases_path, out_path, tmp_dir = sys.argv[1:5]
spec = importlib.util.spec_from_file_location("task0_gcode_under_test", mod_path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

KW = {"mode": "mode", "keepE": "keep_e", "maxLayers": "max_layers", "layerHeightMm": "layer_height_mm",
      "fLimits": "f_limits", "zSpeedF": "z_speed_f"}

def dec(v):
    if isinstance(v, dict):
        if "$f" in v:
            return struct.unpack(">d", bytes.fromhex(v["$f"]))[0]
        if "$i" in v:
            return int(v["$i"])
        if "$obj" in v:
            return {k: dec(x) for k, x in v["$obj"]}
        raise RuntimeError("bad encoding")
    return v

def kwargs(c):
    return {KW[k]: dec(v) for k, v in c.get("opts", {}).items()}

def fbits(x):
    return None if x is None else struct.pack(">d", x).hex()

def canon(r, digest):
    blocks = []
    for b in r.blocks:
        g = hashlib.sha256(b.gcode.encode("utf-8")).hexdigest() if digest else b.gcode
        blocks.append([g, b.is_layer, b.layer_index, b.line_no, fbits(b.z), fbits(b.marker_z), b.has_xy])
    return {"blocks": blocks, "warnings": r.warnings, "errors": r.errors,
            "layerCount": r.layer_count, "endFound": r.end_found}

last_text = [None]
def run(c):
    t = c["t"]
    if t == "parse":
        return canon(m.parse_gcode_lines(c["lines"], **kwargs(c)), False)
    if t == "text":
        p = os.path.join(tmp_dir, "case.gcode")
        if last_text[0] != c["text"]:
            with open(p, "wb") as f:
                f.write(c["text"].encode("utf-8"))
            last_text[0] = c["text"]
        return canon(m.parse_gcode_file(p, **kwargs(c)), False)
    if t == "file":
        return canon(m.parse_gcode_file(c["path"], **kwargs(c)), True)
    if t == "strip":
        return m.strip_comment(c["s"])
    if t == "norm":
        return m.normalize_dryrun_motion(c["s"], c["keepE"])
    if t == "unspaced":
        return m.is_unspaced_move(c["s"])
    raise RuntimeError("unknown case type " + t)

with open(cases_path, encoding="utf-8") as f:
    cases = json.load(f)
out = []
for c in cases:
    try:
        out.append({"ok": run(c)})
    except Exception as e:
        out.append({"exc": [type(e).__name__, str(e)]})
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=True)
`;

/** 원본 변조판 (대조군) — [이름, 찾을 문자열, 바꿀 문자열] */
const MUTANTS = [
  ["_TOL 0.001 → 0.01", "_TOL = 0.001", "_TOL = 0.01"],
  [
    "경고 문구 한 글자 (F 단독 줄 §4-2 → §4-3)",
    '"F 단독 줄 {n}줄{refs} — 버림 (규격서 §4-2)"',
    '"F 단독 줄 {n}줄{refs} — 버림 (규격서 §4-3)"',
  ],
  ["_f_int half-even → +0.5 절삭", "return max(1, int(round(value)))", "return max(1, int(value + 0.5))"],
  [
    "_MOVE_ARG_RE re.ASCII 제거",
    '_MOVE_ARG_RE = re.compile(r"\\s+([XYZEFxyzef])(" + _NUM + r")(?=\\s|\\Z)", re.ASCII)',
    '_MOVE_ARG_RE = re.compile(r"\\s+([XYZEFxyzef])(" + _NUM + r")(?=\\s|\\Z)")',
  ],
  ["parse_gcode_file utf-8-sig → utf-8", 'encoding="utf-8-sig"', 'encoding="utf-8"'],
  // v0.2.1 새 규칙 — 이 셋을 말뭉치가 못 잡으면 G92·인자 없는 이동·Z 문구 이식 오류도 못 잡는다
  ["_fmt_z 소수 4자리 → 3자리", 'return f"{value:.4f}"', 'return f"{value:.3f}"'],
  ["인자 없는 이동 줄 → F 단독 줄로 다시 묶음", "        if not params:\n", "        if False:\n"],
  ["_G92_ARG_RE 허용 글자에 F 추가", '_G92_ARG_RE = re.compile(r"\\s+([XYZExyze])(', '_G92_ARG_RE = re.compile(r"\\s+([XYZEFxyzef])('],
  [
    "_G92_ARG_RE re.ASCII 제거",
    '_G92_ARG_RE = re.compile(r"\\s+([XYZExyze])(" + _NUM + r")(?=\\s|\\Z)", re.ASCII)',
    '_G92_ARG_RE = re.compile(r"\\s+([XYZExyze])(" + _NUM + r")(?=\\s|\\Z)")',
  ],
];

function findPython() {
  const cands = process.env.PYTHON ? [[process.env.PYTHON, []]] : [["python", []], ["python3", []], ["py", ["-3"]]];
  for (const [cmd, pre] of cands) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], {
      encoding: "utf8",
    });
    const mm = r.status === 0 ? /^(\d+) (\d+)/.exec((r.stdout || "").trim()) : null;
    if (mm && Number(mm[1]) === 3 && Number(mm[2]) >= 7) return { cmd, pre, version: `${mm[1]}.${mm[2]}` };
  }
  return null;
}
function gitShow(spec) {
  const r = spawnSync("git", ["-C", TASK0_DIR, "show", spec], { maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function runPython(py, tmp, modSource, cases, tag) {
  const modPath = path.join(tmp, `task0_gcode_${tag}.py`);
  const casesPath = path.join(tmp, "cases.json");
  const outPath = path.join(tmp, `out_${tag}.json`);
  const harnessPath = path.join(tmp, "harness.py");
  fs.writeFileSync(modPath, modSource);
  if (!fs.existsSync(harnessPath)) fs.writeFileSync(harnessPath, PY_HARNESS, "utf8");
  fs.writeFileSync(casesPath, JSON.stringify(cases.map(encCase)), "utf8");
  const r = spawnSync(py.cmd, [...py.pre, harnessPath, modPath, casesPath, outPath, tmp], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600000,
  });
  if (r.status !== 0) {
    return { error: `python 종료 코드 ${r.status}: ${(r.stderr || r.error || "").toString().slice(-800)}` };
  }
  return { results: JSON.parse(fs.readFileSync(outPath, "utf8")) };
}

/** 불일치 목록 (JS 결과 vs Python 결과) */
function diffResults(cases, jsResults, pyResults) {
  const mism = [];
  for (let i = 0; i < cases.length; i++) {
    const a = JSON.stringify(jsResults[i]);
    const b = JSON.stringify(pyResults[i]);
    if (a !== b) mism.push({ i, a, b });
  }
  return mism;
}
function showMismatch(c, mm) {
  let k = 0;
  while (k < mm.a.length && mm.a[k] === mm.b[k]) k++;
  const from = Math.max(0, k - 120);
  const input =
    c.t === "parse" ? JSON.stringify(c.lines) : c.t === "text" ? JSON.stringify(c.text) : JSON.stringify(c.s ?? c.path);
  console.error(`    · [${c.src ?? "unit"}] t=${c.t} opts=${show(c.opts ?? (c.keepE !== undefined ? { keepE: c.keepE } : {}))}`);
  console.error(`      입력: ${input.slice(0, 600)}${input.length > 600 ? " …" : ""}`);
  console.error(`      JS    …${mm.a.slice(from, k + 200)}`);
  console.error(`      Python…${mm.b.slice(from, k + 200)}`);
}

console.log(`\n(b) Python 원본(@${ORIGIN_COMMIT})과의 차분 검사`);
const py = findPython();
const hasTask0 = fs.existsSync(path.join(TASK0_DIR, ".git"));
const originSrc = hasTask0 ? gitShow(`${ORIGIN_COMMIT}:controllers/task0_gcode.py`) : null;
let skipReason = null;
if (!py) skipReason = "python 3.7+ 없음 (PYTHON 환경변수로 지정 가능)";
else if (!hasTask0) skipReason = `Task0 리포 없음 (${TASK0_DIR} — TASK0_DIR 환경변수로 지정 가능)`;
else if (!originSrc) skipReason = `Task0 리포에 커밋 ${ORIGIN_COMMIT}(controllers/task0_gcode.py) 없음`;

if (skipReason) {
  console.log(`  SKIP(차분 검사): ${skipReason}`);
} else {
  console.log(`  python ${py.version} (${[py.cmd, ...py.pre].join(" ")}), Task0 = ${TASK0_DIR}`);

  // 원본 테스트 목록·test_2.gcode 와 이식판 대조
  const testSrc = gitShow(`${ORIGIN_COMMIT}:test/test_task0_gcode.py`);
  if (testSrc) {
    const names = [];
    let cls = null;
    for (const line of testSrc.toString("utf8").split(/\r?\n/)) {
      const c = /^class (\w+)\(unittest\.TestCase\)/.exec(line);
      if (c) cls = c[1];
      const d = /^ {4}def (test_\w+)\(/.exec(line);
      if (d && cls) names.push(`${cls}.${d[1]}`);
    }
    const mine = new Set(tests.map((t) => t.name));
    const missing = names.filter((n) => !mine.has(n));
    const extra = [...mine].filter((n) => !names.includes(n));
    assert(
      names.length === ORIGIN_TEST_COUNT && missing.length === 0 && extra.length === 0,
      `원본 테스트 목록(${names.length}건)과 이식 목록 일치` +
        (missing.length || extra.length ? ` — 빠짐 ${show(missing)}, 남음 ${show(extra)}` : ""),
    );
  } else {
    assert(false, `git show ${ORIGIN_COMMIT}:test/test_task0_gcode.py 실패`);
  }
  const t2 = gitShow(`${ORIGIN_COMMIT}:test_2.gcode`);
  assert(
    t2 !== null && t2.toString("utf8").replace(/\r\n/g, "\n") === TEST2_GCODE,
    `내장 test_2.gcode = 원본 @${ORIGIN_COMMIT} blob`,
  );

  // 말뭉치
  const fuzz = buildFuzzCorpus();
  const edge = buildEdgeCorpus();
  const argc = buildArgCorpus();
  const parseCases = [...unitCorpus.filter((c) => c.t === "parse" || c.t === "text"), ...fuzz, ...edge, ...argc];
  const funcCases = [...unitCorpus.filter((c) => c.t !== "parse" && c.t !== "text"), ...buildFuncCorpus(parseCases)];
  // 큰 실파일은 (a) test_big_file 과 같은 모드 1종만 (print 까지 넣으면 Python 7초+ — 퍼즈가 print 규칙을 덮는다)
  const bigCases = fs.existsSync(BIG_FILE)
    ? [{ t: "file", path: BIG_FILE, opts: { mode: "dryrun", keepE: true }, src: "big" }]
    : [];
  const cases = [...parseCases, ...funcCases, ...bigCases];
  const nUnit = unitCorpus.length;
  console.log(
    `  말뭉치: 단위테스트 입력 ${nUnit} + 퍼즈 ${FUZZ_CASES}건×모드 5 = ${fuzz.length} + 숫자 경계 ${edge.length}` +
      ` + 인자 오류 ${argc.length} + 함수 단위 ${funcCases.length - unitCorpus.filter((c) => c.t !== "parse" && c.t !== "text").length}` +
      ` + 큰 실파일 ${bigCases.length}${bigCases.length ? "" : "(파일 없음)"} = ${cases.length}건`,
  );

  const t0 = performance.now();
  const jsResults = cases.map(runJs);
  const jsMs = Math.round(performance.now() - t0);

  // 메시지 커버리지 — 모든 경고·오류 카테고리가 말뭉치에서 1회 이상 비교됐는지
  const allMsgs = [];
  for (const r of jsResults) {
    if (r.exc) allMsgs.push(r.exc[1]);
    else if (r.ok && typeof r.ok === "object" && r.ok.warnings) allMsgs.push(...r.ok.warnings, ...r.ok.errors);
  }
  const COVER = [
    "층 첫 이동이 G1 Z가 아님", ";Z: 마커 없는 층", ";Z:와 G1 Z 불일치", "Z ≠ (N+1)×층두께", "Z가 이전 층보다 작음",
    "EXECUTABLE_BLOCK_START 마커 없음", "EXECUTABLE_BLOCK_END 뒤 명령", "잘못된 ;Z: 값", "명령 줄 끝 주석",
    "공백 없는 이동 줄", "블레이드 명령", "G92 좌표 재설정 ", "G92 좌표 재설정(X/Y/Z)", "출력 중 호밍 금지",
    "상대 좌표 금지", "E 절대 모드 금지", "알 수 없는 명령 버림: ", "알 수 없는 명령 버림: 그 외 ", "잘못된 이동 줄",
    "F 단독 줄", "Z와 XY/E 동시 이동", "층 안 Z 이동", "F 미지정 이동", "도포 F 클램프", "트래블 F 클램프",
    "E 단독 F 클램프", "mode는", "layer_height_mm는", "f_limits 키는", "f_limits['", "z_speed_f는", "…)",
    "잘못된 G92 줄", "인자 없는 이동 줄", // v0.2.1
  ];
  const uncovered = COVER.filter((k) => !allMsgs.some((m) => m.includes(k)));
  assert(uncovered.length === 0, `메시지 커버리지 ${COVER.length}종 전부 말뭉치에 등장` + (uncovered.length ? ` — 빠짐 ${show(uncovered)}` : ""));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-task0-"));
  try {
    const t1 = performance.now();
    const orig = runPython(py, tmp, originSrc, cases, "orig");
    const pyMs = Math.round(performance.now() - t1);
    if (orig.error) {
      assert(false, `Python 원본 실행 — ${orig.error}`);
    } else {
      const mism = diffResults(cases, jsResults, orig.results);
      console.log(`  비교 ${cases.length}건 (JS ${jsMs}ms, Python ${pyMs}ms): 불일치 ${mism.length}건`);
      for (const mm of mism.slice(0, 5)) showMismatch(cases[mm.i], mm);
      assert(mism.length === 0, `JS = Python 원본 (말뭉치 ${cases.length}건 불일치 0)`);
    }

    // 대조군 — 변조 원본에서 불일치가 검출돼야 함 (큰 실파일은 시간상 제외)
    const mutCases = cases.filter((c) => c.t !== "file");
    const mutJs = jsResults.filter((_r, i) => cases[i].t !== "file");
    const src = originSrc.toString("utf8");
    MUTANTS.forEach(([name, from, to], k) => {
      const at = src.indexOf(from);
      if (at < 0 || src.indexOf(from, at + 1) >= 0) {
        assert(false, `대조군 [${name}] 변조 대상 문자열이 원본에 정확히 1회 있어야 함`);
        return;
      }
      const res = runPython(py, tmp, Buffer.from(src.replace(from, to), "utf8"), mutCases, `mut${k}`);
      if (res.error) {
        assert(false, `대조군 [${name}] Python 실행 — ${res.error}`);
        return;
      }
      const n = diffResults(mutCases, mutJs, res.results).length;
      assert(n >= 1, `대조군 [${name}] 불일치 ${n}건 검출 (≥1 이어야 함)`);
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("");
if (failed > 0) {
  console.error(`FAIL: ${failed}건`);
  process.exit(1);
}
console.log("PASS: Task0 G-code 파서 이식 검증 전부 통과");
