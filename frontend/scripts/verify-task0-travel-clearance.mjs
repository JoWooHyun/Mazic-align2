// Task0 트래블 여유 거리 d (규격 v0.3.5 §7-2) 검사기 헤드리스 검증 — Z1-d(§32 반영).
//
//   무엇을: src/features/v2/utils/task0/task0-travel-check.ts
//     checkTask0TravelClearance (d 판정 — 우리 정의, 협의 §37 질문 1) · extractTask0LayerPaths (T 줄 = 파킹 (0,0) 리셋, 규격 v0.3.5 §6)
//     + 상수 TASK0_DEFAULTS.travelClearanceMm(task0-frame — 잠정 d = w = 0.5) + 내보내기 분기 TRAVEL_CLEARANCE_AS_WARNING(task0-export).
//   규격 = Task0 리포 docs/Task0_Gcode_규격서_초안.md v0.3.5 @ 481f416 §7-2 "트래블이 칠한 비드 중심선에서 떨어질 최소 거리
//   d = w/2 + 노즐 바깥 반지름 + 여유, 실측 전 잠정 d = w. 검증기는 '중심선까지 거리 < d 인 트래블 표본점 0'", §6 "T 전환 직후 첫
//   트래블은 (0,0) 에서 출발", §6 ② "B → A 층에서도 A 노즐이 칠한 B 를 스치지 않아야", §12 검증기 추가 항목. 설계 =
//   docs/계획_Z1_task0출력_20261002.md "Z1-d(§32 반영)".
//
//   판정식(모듈 머리 주석): 검사 구간 = 트래블 경로에서 시작 호 길이 d 를 뗀 나머지(끝은 떼지 않음), S(다음 도포 시작)가 끝점인 칠한
//   선분은 뺌(이어 칠함), 위반 = 칠한 선분(모든 툴)과 정확 거리 < d − 1e-6 (등호 허용 — 서펜타인 L 이동의 X 다리는 직전 행에서 정확히 w).
//
//   (A) 판정 대조군 — 손으로 쓴 G-code:
//       a. 행 하나 + L 자 트래블(Y 다리 0.5 → X 다리가 행 중심선에서 정확 0.500) → 0건 / Y 다리 0.499 → 1건(최소 0.499)
//       b. S 제외 — 칠한 고리의 끝점으로 돌아와 이어 칠하는 트래블 → 0건, 같은 경로 끝을 1 µm 옆(끝점 아님)으로 → 1건
//       c. T 리셋 — A 선분 끝 바로 위로 가는 전환 트래블: 파킹 (0,0) 출발로 보면 칠한 A 옆을 d 안으로 지나 1건(다른 툴),
//          모듈에서 T 리셋을 뺀 변조 사본(임시 폴더)은 앞 도포 끝 출발로 봐 0건 = T 리셋이 판정을 바꾼다.
//   (B) 픽스처 (writer 기본 옵션·빌트인 Task0 프로파일, lh 0.1):
//       큐브 10·판 2장(파일 A·C)·서포트 1개(F4) = 0건 / 파일 B = 90건·층 0~4·최소 0.157 mm(양성 대조군 — 채움 조각이 행 사이) /
//       판 + 서포트 9(F1) = 19건·층 [0,1,2,10,38,39,40,41] / 큐브 20 + 서포트 16(F2) = 31건·층 [0,1,10,11,38,39,40,41]
//       (설계 실측과 같은 층 집합) / 파일 D(2재료) 기본 0건, 전환 트래블 대조군(switchTravelFromPark false) 2건·층 4·5·다른 툴(설계 실측
//       0.251 mm — 그래서 전환 트래블을 파킹 출발로 계획). 위 c 의 T 리셋 변조 사본으로 D 기본 출력을 보면 층 4·5 에 1건씩 생긴다.
//       판정은 d 경고만 — 같은 출력의 c4b(엄격 판정)는 전부 0.
//   (C) 상수·분기 — 옵션 clearanceMm 0.25(= w/2) 면 파일 B 90 → 20건 / task0-frame 의 travelClearanceMm 를 0.25 로 바꾼 변조 사본으로
//       기본 호출하면 파일 B 도 20건(= 기본값이 TASK0_DEFAULTS 한 곳에서 온다 — 규칙 6) / task0-export 의 TRAVEL_CLEARANCE_AS_WARNING 을
//       false 로 바꾼 변조 사본은 파일 B 를 경고 0·경고 층 []로 내고 요약 travelClearance 수치(90건)는 그대로(= 리드 결정 분기 한 곳).
//
//   대조군 원칙: 수정 전 트리(0f2d330)에는 task0-travel-check.ts 가 없어 import 단계에서 exit 1. 위 변조 사본들은 각 단언을 실제로 뒤집는다.
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "위반" 문자열을 출력한다.
//   실행: npx tsx scripts/verify-task0-travel-clearance.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assembleVerticalSupport } from "../src/features/v2/support/assemble-core.ts";
import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";
import { TASK0_DEFAULTS } from "../src/features/v2/utils/task0/task0-frame.ts";
import { generateTask0Gcode } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import { TRAVEL_CLEARANCE_AS_WARNING, runTask0GcodeExport } from "../src/features/v2/utils/task0/task0-export.ts";
import { TASK0_BUILT_IN_PROFILE, task0PrintableFrameForProfile, task0WriterOptionsForProfile } from "../src/features/v2/utils/task0/task0-profile.ts";
import {
  checkTask0TravelClearance,
  checkTask0TravelContact,
  extractTask0LayerPaths,
} from "../src/features/v2/utils/task0/task0-travel-check.ts";
import { fixtureDualPillarsPlate } from "./verify-task0-dual.mjs";
import { boxTriangles, fixtureCube10, fixtureFileB, fixtureGapPlates, meshesTopY } from "./verify-task0-writer.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(SCRIPT_DIR, "..", "src", "features", "v2");
const TASK0_SRC = path.join(V2, "utils", "task0");
const PARTS = path.join(V2, "support", "parts");
const LH = 0.1;
const P = TASK0_BUILT_IN_PROFILE;
const APP = { writer: task0WriterOptionsForProfile(P), printable: task0PrintableFrameForProfile(P) };

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

/** 위반 요약 — { n: 건수, layers, min, other } */
function summarize(v) {
  return {
    n: v.reduce((a, x) => a + x.count, 0),
    layers: v.map((x) => x.layer),
    min: v.length ? Math.min(...v.map((x) => x.minDistMm)) : null,
    other: v.some((x) => x.againstOtherTool),
  };
}
const fmt = (s) => `${s.n}건 · 층 ${JSON.stringify(s.layers)} · 최소 ${s.min === null ? "-" : s.min.toFixed(3)} mm${s.other ? " · 다른 툴" : ""}`;

/**
 * task0 모듈 하나를 소스 변조해 임시 폴더에 쓰고 import — 상대 import 는 원본 폴더의 절대 URL 로(redirect 로 일부를 다른 변조 사본으로).
 * @param edits [[찾을 문자열, 바꿀 문자열]] — 각각 소스에 한 번만 있어야 한다
 */
async function loadMutant(tag, file, edits, redirect = {}) {
  let src = fs.readFileSync(path.join(TASK0_SRC, file), "utf8");
  for (const [from, to] of edits) {
    if (src.split(from).length !== 2) throw new Error(`변조 대상 문자열이 소스에 한 번만 있어야 함 (${tag}): ${from}`);
    src = src.replace(from, to);
  }
  src = src.replace(/from '\.\/([^']+)'/g, (_, p) => `from '${redirect[p] ?? pathToFileURL(path.join(TASK0_SRC, `${p}.ts`)).href}'`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-task0-travel-clearance-"));
  const out = path.join(dir, `${tag}.ts`);
  fs.writeFileSync(out, src, "utf8");
  return { mod: await import(pathToFileURL(out).href), url: pathToFileURL(out).href, dir };
}

// ── 손으로 쓴 G-code ─────────────────────────────────────────────────────

const f3 = (v) => v.toFixed(3);
/** 층 하나짜리 G-code — ops: ["t", x, y] 트래블 · ["d", x, y] 도포 · ["T", n] 툴 · ["r"] E−r · ["u"] E+r */
function handGcode(ops) {
  const L = ["; hand-written (verify-task0-travel-clearance)", "; EXECUTABLE_BLOCK_START", "G90", "M83", "T0", ";LAYER_CHANGE", ";Z:0.1", ";HEIGHT:0.1", "G1 Z0.1"];
  for (const op of ops) {
    if (op[0] === "t") L.push(`G1 X${f3(op[1])} Y${f3(op[2])} F6000`);
    else if (op[0] === "d") L.push(`G1 X${f3(op[1])} Y${f3(op[2])} E0.00100 F1800`);
    else if (op[0] === "T") L.push(`T${op[1]}`);
    else if (op[0] === "r") L.push("G1 E-1.00000 F1800");
    else if (op[0] === "u") L.push("G1 E1.00000 F1800");
  }
  return L.join("\n") + "\n";
}

/** (A) a — 행 하나 + L 자(Y 다리 dy 위로, 그다음 X 로 왼쪽 20 mm) + 짧은 도포 */
const lMove = (dy) =>
  handGcode([["t", 70, 40], ["u"], ["d", 80, 40], ["r"], ["t", 80, 40 + dy], ["t", 60, 40 + dy], ["u"], ["d", 59, 40 + dy], ["r"]]);
/** (A) b — 사각 고리 3변을 칠하고 고리 시작점 S 로 돌아와 이어 칠함 (end 를 주면 그 점으로) */
const loopBack = (end) =>
  handGcode([
    ["t", 70, 40], ["u"], ["d", 72, 40], ["d", 72, 42], ["d", 70, 42], ["r"],
    ["t", 69.4, 42], ["t", 69.4, 40], ["t", ...end], ["u"], ["d", end[0], end[1] + 1], ["r"],
  ]);
/** (A) c — T0 이 (40,20)→(60,30) 을 칠하고 T1 전환 뒤 (60,30.6) 으로. 파킹 (0,0) → (60,30.6) 직선은 A 의 (40,20) 끝에서 0.356 mm,
 *  앞 도포 끝 (60,30) → (60,30.6) 직선은 시작 d 를 떼면 A 끝에서 0.5 mm 이상 */
const switchNearA = () =>
  handGcode([["t", 40, 20], ["u"], ["d", 60, 30], ["r"], ["T", 1], ["t", 60, 30.6], ["u"], ["d", 61, 30.6], ["r"]]);

async function sectionHand() {
  console.log("\n(A) 판정 대조군 — 손으로 쓴 G-code");
  const eq = summarize(checkTask0TravelClearance(lMove(0.5)));
  const lt = summarize(checkTask0TravelClearance(lMove(0.499)));
  assert(eq.n === 0, `a. L 자 X 다리가 행 중심선에서 정확히 0.500 mm(= d) → 0건 (등호 허용) — ${fmt(eq)}`);
  assert(lt.n === 1 && Math.abs(lt.min - 0.499) < 1e-9, `a. 0.499 mm → 1건, 최소 0.499 — ${fmt(lt)}`);
  const ok = checkTask0TravelContact(lMove(0.5), [0, 0]);
  assert(ok.length === 0, "a. 같은 출력의 엄격 판정(c4b) 0건 — d 판정만 갈린다");

  const back = summarize(checkTask0TravelClearance(loopBack([70, 40])));
  const off = summarize(checkTask0TravelClearance(loopBack([70.001, 40])));
  assert(back.n === 0, `b. 칠한 고리의 끝점(70, 40)으로 돌아와 이어 칠함 → 그 끝점의 비드는 빼고 0건 — ${fmt(back)}`);
  assert(off.n === 1, `b. 같은 경로 끝을 1 µm 옆(끝점 아님)으로 → 1건 (끝은 떼지 않는다 — 비드 안으로 들어감) — ${fmt(off)}`);

  const sw = switchNearA();
  const paths = extractTask0LayerPaths(sw, [0, 0]);
  const tr = paths[0]?.travels.find((t) => t.afterToolChange);
  assert(
    tr !== undefined && tr.points[0][0] === 0 && tr.points[0][1] === 0 && tr.tool === 1 && tr.paintedCount === 1,
    `c. T1 뒤 트래블 = 파킹 (0,0) 출발 경로 (툴 T${tr?.tool}, 앞에 칠한 선분 ${tr?.paintedCount}개)`,
  );
  const swS = summarize(checkTask0TravelClearance(sw));
  assert(swS.n === 1 && swS.other && Math.abs(swS.min - 0.3563) < 1e-3, `c. 파킹 출발로 보면 칠한 A 끝 (40,20) 에서 d 안 → 1건·다른 툴 — ${fmt(swS)}`);
  const noReset = await loadMutant("no-t-reset", "task0-travel-check.ts", [["      pos = parkUm;\n      afterToolChange = cur !== null;", "      afterToolChange = cur !== null;"]]);
  try {
    const mS = summarize(noReset.mod.checkTask0TravelClearance(sw));
    assert(mS.n === 0, `c. 변조 사본(T 리셋 뺌 — 앞 도포 끝 (60,30) 출발) → ${mS.n}건 = T 리셋이 판정을 바꾼다 (위 1건 단언이 잡는다)`);
    return noReset;
  } catch (e) {
    fs.rmSync(noReset.dir, { recursive: true, force: true });
    throw e;
  }
}

// ── (B) 픽스처 ───────────────────────────────────────────────────────────

/** 바이너리 STL → { positions, indices } (verify-task0-support-retry 와 같은 로직) */
function parseBinaryStl(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  let off = 84;
  let pi = 0;
  for (let t = 0; t < count; t++) {
    off += 12;
    for (let v = 0; v < 3; v++) {
      positions[pi++] = dv.getFloat32(off, true);
      positions[pi++] = dv.getFloat32(off + 4, true);
      positions[pi++] = dv.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2;
  }
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}
/** 기본 서포트 값 — verify-task0-support-retry SUPPORT_SPEC 과 같다 (support/utils/defaults.ts DEFAULT_SUPPORT_PARAMS) */
const SUPPORT_SPEC = { tipDiameterMm: 0.4, headBackDiameterMm: 1.0, headLengthMm: 1.0, contactPenetrationMm: 0.2, trunkDiameterMm: 0.8, baseDiameterMm: 1.5, baseTransitionMm: 3.0 };
let parts = null;
function supportTris(cx, cz, surfaceY = 5) {
  parts ??= {
    sphere: parseBinaryStl(fs.readFileSync(path.join(PARTS, "sphere.stl"))),
    cone: parseBinaryStl(fs.readFileSync(path.join(PARTS, "cone.stl"))),
    cylinder: parseBinaryStl(fs.readFileSync(path.join(PARTS, "cylinder.stl"))),
  };
  const { positions: p, indices: idx } = assembleVerticalSupport(parts, { ...SUPPORT_SPEC, surfaceY, baseY: 0 });
  const out = new Float32Array(idx.length * 3);
  let o = 0;
  for (let i = 0; i < idx.length; i++) {
    const k = idx[i] * 3;
    out[o++] = p[k] + cx;
    out[o++] = p[k + 1];
    out[o++] = p[k + 2] + cz;
  }
  return normalizeTriangleWinding(out);
}
const solid = (min, max) => normalizeTriangleWinding(boxTriangles(min, max));
const grid = (xs) => xs.flatMap((x) => xs.map((z) => supportTris(x, z)));

/** 이름 → { meshes, writer, want(요약 → 참/거짓), wantText } */
function fixtureCases() {
  const single = (name, meshes, wantN, wantLayers, extra = "") => ({
    name,
    meshes,
    writer: APP.writer,
    want: (s) => s.n === wantN && (wantLayers === null || JSON.stringify(s.layers) === JSON.stringify(wantLayers)),
    wantText: `${wantN}건${wantLayers ? ` · 층 ${JSON.stringify(wantLayers)}` : ""}${extra}`,
  });
  const d = fixtureDualPillarsPlate();
  return [
    single("큐브 10 (파일 A)", fixtureCube10().meshes(), 0, []),
    single("판 2장 (파일 C)", fixtureGapPlates().meshes(), 0, []),
    single("서포트 1개 (F4)", [supportTris(5, 5)], 0, []),
    {
      ...single("파일 B (양성 대조군)", fixtureFileB().meshes(), 90, [0, 1, 2, 3, 4]),
      want: (s) => s.n === 90 && JSON.stringify(s.layers) === "[0,1,2,3,4]" && Math.abs(s.min - 0.1572) < 1e-3 && !s.other,
      wantText: "90건 · 층 [0..4] · 최소 0.157",
    },
    single("판 + 서포트 9 (F1)", [solid([0, 5, 0], [10, 6, 10]), ...grid([1, 5, 9])], 19, [0, 1, 2, 10, 38, 39, 40, 41]),
    single("큐브 20 + 서포트 16 (F2)", [solid([0, 5, 0], [20, 25, 20]), ...grid([2, 7, 12, 17])], 31, [0, 1, 10, 11, 38, 39, 40, 41]),
    { ...single("파일 D 2재료 기본", d.meshes(), 0, []), writer: { dualMaterial: { slots: d.slots } } },
    {
      ...single("파일 D 2재료 대조군 switchTravelFromPark false", d.meshes(), 2, [4, 5]),
      writer: { dualMaterial: { slots: d.slots }, switchTravelFromPark: false },
      want: (s) => s.n === 2 && JSON.stringify(s.layers) === "[4,5]" && s.other && Math.abs(s.min - 0.2513) < 1e-3,
      wantText: "2건 · 층 [4,5] · 다른 툴 · 최소 0.251",
    },
  ];
}

function sectionFixtures(noReset) {
  console.log("\n(B) 픽스처 — writer 기본 옵션(빌트인 Task0 프로파일), lh 0.1");
  const out = {};
  for (const c of fixtureCases()) {
    const r = generateTask0Gcode(c.meshes, meshesTopY(c.meshes), LH, c.writer);
    const s = summarize(checkTask0TravelClearance(r.gcode));
    const contact = checkTask0TravelContact(r.gcode, [0, 0]);
    out[c.name] = r.gcode;
    assert(c.want(s) && contact.length === 0, `${c.name}: d 위반 ${fmt(s)} (기대 ${c.wantText}), c4b 0`);
  }
  // T 리셋 변조 사본 — 파일 D 기본 출력(전환 트래블을 파킹에서 곧게 계획)을 앞 패스 끝 출발로 재면 층 4·5 에 1건씩(0.294 mm) 생긴다
  const dNew = out["파일 D 2재료 기본"];
  const m = summarize(noReset.mod.checkTask0TravelClearance(dNew));
  assert(m.n === 2 && JSON.stringify(m.layers) === "[4,5]", `T 리셋 변조 사본으로 파일 D 기본 출력을 보면 ${fmt(m)} ≠ 0건 (전환 트래블을 앞 패스 끝에서 잰다)`);
  return out;
}

// ── (C) 상수·분기 ────────────────────────────────────────────────────────

async function sectionConstant(outs) {
  console.log("\n(C) 상수(TASK0_DEFAULTS.travelClearanceMm)·리드 결정 분기(TRAVEL_CLEARANCE_AS_WARNING)");
  const b = outs["파일 B (양성 대조군)"];
  assert(TASK0_DEFAULTS.travelClearanceMm === 0.5 && TASK0_DEFAULTS.travelClearanceMm === TASK0_DEFAULTS.depositWidthMm, "d 잠정값 = w = 0.5 mm (규격 v0.3.5 §7-2·§14)");
  // d = w/2 로 줄이면 위반이 크게 준다(90 → 20). 0 이 아닌 것은 판정식이 writer 계획 검사(c4 — 양 끝 w/2 를 뗌)와 달라서다:
  //   d 판정은 끝을 떼지 않으므로 이어 칠할 조각 끝점 근처에서 옆 비드에 w/2 안으로 다가가는 끝 구간이 남는다(규격 "끝점으로 비드 안에
  //   들어가는 것도 금지" 를 따른 차이 — 설계 표 예측 0 과 다름, 보고에 적음)
  const half = summarize(checkTask0TravelClearance(b, { clearanceMm: 0.25 }));
  assert(half.n === 20, `옵션 clearanceMm 0.25(= w/2 — writer 계획 거리) → 파일 B ${fmt(half)} (90 → 20)`);
  const frameMut = await loadMutant("frame-d025", "task0-frame.ts", [["  travelClearanceMm: 0.5,", "  travelClearanceMm: 0.25,"]]);
  const checkMut = await loadMutant("check-on-frame-d025", "task0-travel-check.ts", [], { "task0-frame": frameMut.url });
  try {
    const s = summarize(checkMut.mod.checkTask0TravelClearance(b));
    assert(s.n === half.n && s.n !== 90, `task0-frame 의 travelClearanceMm 를 0.25 로 바꾼 변조 사본 → 기본 호출로 파일 B ${s.n}건 = 옵션 0.25 결과 (기본값은 TASK0_DEFAULTS 한 곳)`);
  } finally {
    fs.rmSync(frameMut.dir, { recursive: true, force: true });
    fs.rmSync(checkMut.dir, { recursive: true, force: true });
  }

  const meshes = fixtureFileB().meshes();
  const input = { meshes, topY: meshesTopY(meshes), layerHeightMm: LH, writer: APP.writer, printable: APP.printable };
  const r = runTask0GcodeExport(input);
  assert(
    TRAVEL_CLEARANCE_AS_WARNING === true && r.ok && r.warnings.length === 1 && r.warnings[0].startsWith("트래블이 칠한 레진에서 d = 0.5 mm") &&
      JSON.stringify(r.failedLayers) === "[0,1,2,3,4]" && r.summary.travelClearance?.count === 90,
    `TRAVEL_CLEARANCE_AS_WARNING true(지금 — 설계 (a) 안): 파일 B 내보내기 ok + 경고 1줄 + 경고 층 [0..4], 요약 수치 90건`,
  );
  const exportMut = await loadMutant("export-info-only", "task0-export.ts", [["export const TRAVEL_CLEARANCE_AS_WARNING = true;", "export const TRAVEL_CLEARANCE_AS_WARNING = false;"]]);
  try {
    const m = exportMut.mod.runTask0GcodeExport(input);
    assert(
      m.ok && m.gcode === r.gcode && m.warnings.length === 0 && m.failedLayers.length === 0 && m.summary.travelClearance?.count === 90 &&
        JSON.stringify(m.summary.travelClearance.layers) === "[0,1,2,3,4]",
      `분기 false 로 바꾼 변조 사본(설계 (b) 안 — 정보만): 같은 파일, 경고 0·경고 층 [], 요약 travelClearance 90건·층 [0..4] 그대로`,
    );
  } finally {
    fs.rmSync(exportMut.dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log("Task0 트래블 여유 거리 d 검사기 검증 (Z1-d — 규격서 v0.3.5 §6·§7-2, 잠정 d = w)");
  const noReset = await sectionHand();
  try {
    const outs = sectionFixtures(noReset);
    await sectionConstant(outs);
  } finally {
    fs.rmSync(noReset.dir, { recursive: true, force: true });
  }
  console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
