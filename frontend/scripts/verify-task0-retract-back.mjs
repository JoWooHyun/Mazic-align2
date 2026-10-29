// verify-task0-retract-back — Task0 writer 옵션 retractBack (뒤로 당기기 끄기, 리드 2026-10-29)
//
// 실행: cd frontend && npx tsx scripts/verify-task0-retract-back.mjs   (판정 = exit code)
//
// 배경: 드라이런에서 익스트루더가 ±1 mm(E+r / E−r) 왕복만 해서 토출이 눈에 안 보였다(도포 ΔE 는 줄당 1e-4 mm 수준).
//   리드 결정 — 앱 내보내기는 E−r 줄을 빼고 E+r 만 남겨 한 방향으로만 돌게 한다. writer 기본은 규격 §5 그대로(true).
//
// 검사:
//   (1) writer — 픽스처(큐브, 두 덩어리 판 — 층 안 긴 트래블, 2재료 — 툴 전환)마다
//       (a) 기본(옵션 없음) = 규격 모드: E−r 줄이 있고 머리 메타에 retractBack 줄 없음
//       (b) retractBack:false: 음수 E 줄 0 · 머리(START 앞)에 `; retractBack: false` 한 줄
//       (c) false 본문 = 기본 본문에서 E−r 줄만 뺀 것(바이트 동일) — 경로·도포 E·E+r 은 하나도 안 바뀐다
//       (d) 통계: false 의 retracts 0, unretracts = 기본의 unretracts(E+r 수 그대로), 도포 E 합 같음
//       (e) Task0 파서 이식 print 모드 오류 0 · 층 수 같음
//   (2) 내보내기 코어 runTask0GcodeExport({writer:{retractBack:false}}) → ok, run.gcode = writer false 출력
//   (3) 앱 배선(소스) — useSliceExport 의 job.zip·run.gcode 내보내기 2곳이 task0ExportWriterOptions(retractBack: false),
//       경로 미리보기는 그대로 task0WriterOptionsForProfile
//   (4) 대조군 — writer 변조 3종은 (1) 에서, 수정 전 useSliceExport(git fe8cf25)는 (3) 에서 실패해야 한다
//       (writer 임시 사본을 같은 폴더에 써서 import — 상대 import 해석. 끝나면 지운다)

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";
import { parseGcodeText } from "../src/features/v2/utils/task0/task0-gcode-parser.ts";
import { runTask0GcodeExport } from "../src/features/v2/utils/task0/task0-export.ts";
import { boxTriangles, concatTris, fixtureCube10, meshesTopY } from "./verify-task0-writer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONT = join(HERE, "..");
const V2 = join(FRONT, "src", "features", "v2");
const WRITER_REL = "utils/task0/task0-gcode-writer.ts";
const HOOK_REL = "pages/viewer/hooks/useSliceExport.ts";
/** 수정 전 기준 — 메인라인 fe8cf25 (#156 머지, 앱이 E−r 을 쓰던 판) */
const BEFORE_COMMIT = "fe8cf25";
const START = "; EXECUTABLE_BLOCK_START";
const META_LINE = "; retractBack: false";

let failed = 0;
function assert(ok, label) {
  console.log(`  ${ok ? "ok" : "FAIL"}: ${label}`);
  if (!ok) failed++;
}

/** 픽스처 — [이름, meshes, lh, 옵션(2재료)] */
const FIXTURES = [
  ["큐브 10 mm (lh 0.1)", fixtureCube10().meshes(), 0.1, {}],
  [
    // 한 메시에 두 덩어리(X 0~4, 9~13) — 행마다 구간 둘 사이 5 mm 트래블 → 층 안 E−r / E+r
    "두 덩어리 판 (lh 0.1, 층 안 5 mm 트래블)",
    [normalizeTriangleWinding(concatTris(boxTriangles([0, 0, 0], [4, 0.5, 6]), boxTriangles([9, 0, 0], [13, 0.5, 6])))],
    0.1,
    {},
  ],
  [
    // 2재료 — A·B 나란히, 층마다 T0 → T1 전환 (전환 앞 E−r)
    "2재료 A|B 나란히 (lh 0.1, 툴 전환)",
    [
      normalizeTriangleWinding(boxTriangles([0, 0, 0], [5, 0.4, 5])),
      normalizeTriangleWinding(boxTriangles([8, 0, 0], [13, 0.4, 5])),
    ],
    0.1,
    { dualMaterial: { slots: ["A", "B"] } },
  ],
];

const lines = (g) => g.split("\n");
const headOf = (g) => lines(g).slice(0, lines(g).indexOf(START));
const bodyOf = (g) => lines(g).slice(lines(g).indexOf(START));
/** E 단독 줄 (리트랙트·언리트랙트) */
const RE_E_ONLY = /^G1 E(-?[0-9]+\.[0-9]{5}) F[0-9]+$/;
const eOnly = (ls) => ls.map((l) => RE_E_ONLY.exec(l)).filter(Boolean).map((m) => Number(m[1]));
const sumTotals = (r) => ({
  retracts: r.layers.reduce((a, l) => a + l.retracts, 0),
  unretracts: r.layers.reduce((a, l) => a + l.unretracts, 0),
  extrusion: r.layers.reduce((a, l) => a + l.extrusionMm, 0),
});

/** (1) writer 검사 — 결과 [{ok,label}] */
function suite(gen) {
  const res = [];
  const check = (ok, label) => res.push({ ok, label });
  for (const [name, meshes, lh, extra] of FIXTURES) {
    const topY = meshesTopY(meshes);
    const on = gen(meshes, topY, lh, { ...extra });
    const off = gen(meshes, topY, lh, { ...extra, retractBack: false });
    const onBody = bodyOf(on.gcode);
    const offBody = bodyOf(off.gcode);
    const onE = eOnly(onBody);
    const offE = eOnly(offBody);
    const negOn = onE.filter((e) => e < 0);
    check(
      negOn.length > 0 && !headOf(on.gcode).includes(META_LINE),
      `${name}: (a) 기본 = 규격 모드 — E−r ${negOn.length}줄, 메타 줄 없음`,
    );
    const negOff = lines(off.gcode).filter((l) => /E-/.test(l));
    const metaN = headOf(off.gcode).filter((l) => l === META_LINE).length;
    check(negOff.length === 0 && metaN === 1, `${name}: (b) retractBack:false — 음수 E 줄 ${negOff.length}, 머리 메타 줄 ${metaN}`);
    const rLine = onBody.find((l) => RE_E_ONLY.test(l) && l.includes("E-"));
    const onMinusRetract = onBody.filter((l) => l !== rLine);
    check(
      onMinusRetract.join("\n") === offBody.join("\n"),
      `${name}: (c) false 본문 = 기본 본문 − E−r 줄 (${onBody.length} − ${onBody.length - onMinusRetract.length} = ${offBody.length}줄)`,
    );
    const tOn = sumTotals(on);
    const tOff = sumTotals(off);
    const posOn = onE.filter((e) => e > 0).length;
    const posOff = offE.filter((e) => e > 0).length;
    check(
      tOff.retracts === 0 && tOff.unretracts === tOn.unretracts && posOff === posOn && posOn > 1 &&
        Math.abs(tOff.extrusion - tOn.extrusion) < 1e-9,
      `${name}: (d) 통계 retracts ${tOff.retracts}, E+r ${posOff} = 기본 ${posOn}, 도포 E 같음`,
    );
    const p = parseGcodeText(off.gcode, { mode: "print", layerHeightMm: lh });
    const pOn = parseGcodeText(on.gcode, { mode: "print", layerHeightMm: lh });
    check(
      p.errors.length === 0 && p.layerCount === pOn.layerCount && p.layerCount === on.layers.length,
      `${name}: (e) Task0 파서 print 오류 ${p.errors.length}, 층 ${p.layerCount}${p.errors.length ? " — " + p.errors.slice(0, 2).join(" / ") : ""}`,
    );
  }
  return res;
}

// ── (1) 실제 writer ──
console.log("(1) writer — retractBack 기본(규격) / false(앞으로만)");
const realWriter = await import(pathToFileURL(join(V2, WRITER_REL)).href);
for (const r of suite(realWriter.generateTask0Gcode)) assert(r.ok, r.label);

// ── (2) 내보내기 코어 ──
console.log("\n(2) 내보내기 코어");
{
  const [, meshes, lh] = FIXTURES[1];
  const topY = meshesTopY(meshes);
  const r = runTask0GcodeExport({ meshes, topY, layerHeightMm: lh, writer: { retractBack: false } });
  const direct = realWriter.generateTask0Gcode(meshes, topY, lh, { retractBack: false });
  assert(r.ok && r.gcode === direct.gcode, "runTask0GcodeExport writer.retractBack:false → ok, run.gcode = writer 출력 같은 바이트");
}

// ── (3) 앱 배선(소스) ──
console.log("\n(3) 앱 배선(소스)");
/** 문제 목록 (빈 배열 = 통과) */
function wiringProblems(src) {
  const probs = [];
  if (!/function task0ExportWriterOptions\(printerProfile: PrinterProfileV2\) \{\s*return \{ \.\.\.task0WriterOptionsForProfile\(printerProfile\), retractBack: false \};\s*\}/.test(src)) {
    probs.push("task0ExportWriterOptions(retractBack: false) 없음");
  }
  const zip = src.indexOf("sliceBatchService.exportTask0JobZip(");
  const gc = src.indexOf("sliceBatchService.exportTask0Gcode(");
  const writerAfter = (i) => (i < 0 ? null : /writer: ([A-Za-z0-9]+)\(printerProfile\)/.exec(src.slice(i, i + 800))?.[1] ?? null);
  if (writerAfter(zip) !== "task0ExportWriterOptions") probs.push(`job.zip writer = ${writerAfter(zip)}`);
  if (writerAfter(gc) !== "task0ExportWriterOptions") probs.push(`run.gcode writer = ${writerAfter(gc)}`);
  const pv = src.indexOf("buildTask0PathPreview(gcode, {");
  if (pv < 0 || !src.slice(pv, pv + 200).includes("writer: task0WriterOptionsForProfile(printerProfile)")) {
    probs.push("경로 미리보기 writer 가 바뀜");
  }
  return probs;
}
const hookSrc = readFileSync(join(V2, HOOK_REL), "utf8");
{
  const p = wiringProblems(hookSrc);
  assert(p.length === 0, `useSliceExport: 내보내기 2곳 = retractBack:false, 경로 미리보기 그대로 ${p.length ? "— " + p.join(", ") : ""}`);
}

// ── (4) 대조군 ──
console.log("\n(4) 대조군 — 변조·수정 전은 실패해야 한다");
const writerSrc = readFileSync(join(V2, WRITER_REL), "utf8");
const mutants = [
  ["옵션 무시(항상 E−r)", writerSrc.replace("const retractBack = options.retractBack ?? true;", "const retractBack = true;")],
  ["기본값 뒤집힘(기본도 앞으로만)", writerSrc.replace("const retractBack = options.retractBack ?? true;", "const retractBack = options.retractBack ?? false;")],
  [
    "층 안 트래블 블록째 건너뜀(상태도 안 바뀜 → 트래블 뒤 E+r 빠짐)",
    writerSrc.replace(
      "if (!retracted[st] && lenMm >= params.retractMinTravelMm - TRAVEL_EPS) {",
      "if (retractBack && !retracted[st] && lenMm >= params.retractMinTravelMm - TRAVEL_EPS) {",
    ),
  ],
];
let n = 0;
for (const [label, src] of mutants) {
  if (src === writerSrc) {
    assert(false, `대조군 ${label}: 변조 문자열을 못 찾음(구현이 바뀌었으면 이 스크립트도 갱신)`);
    continue;
  }
  const tmp = join(V2, "utils", "task0", `task0-gcode-writer.__control${n++}.ts`);
  writeFileSync(tmp, src);
  let r;
  try {
    const mod = await import(pathToFileURL(tmp).href);
    r = suite(mod.generateTask0Gcode);
  } catch (e) {
    r = [{ ok: false, label: `예외 ${e?.message ?? e}` }];
  } finally {
    rmSync(tmp, { force: true });
  }
  assert(r.some((x) => !x.ok), `대조군 writer ${label} → (1) 이 실패한다`);
}
try {
  const before = execFileSync("git", ["show", `${BEFORE_COMMIT}:frontend/src/features/v2/${HOOK_REL}`], { cwd: FRONT, encoding: "utf8" });
  assert(wiringProblems(before).length > 0, `대조군 수정 전 useSliceExport(git ${BEFORE_COMMIT}) → (3) 이 실패한다`);
} catch {
  console.log(`  SKIP: git ${BEFORE_COMMIT} 을 못 읽음(얕은 클론 등) — 수정 전 대조군 생략`);
}

console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
