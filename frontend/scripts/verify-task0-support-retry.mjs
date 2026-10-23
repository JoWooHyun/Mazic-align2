// Task0 단일 재료 변형 재시도 헤드리스 검증 — 기본 서포트를 붙인 모델이 "얇은 부분 채움 실패" 로 막히지 않는가.
//
//   배경: 2026-10-15 리드 결정 — "3D 프린터를 모르는 유저가 아무 모델 + 기본 서포트 + 기본 설정으로 슬라이스해 내보내면
//     파일이 나오고 Task0 가 돌아야 한다. 품질 문제(아일랜드·커버리지)는 경고만, 막는 것은 기계가 거부하는 조건뿐."
//     기본 서포트(기둥 ⌀0.8·팁 ⌀0.4·화살촉 뒷구슬 ⌀1.0·발 ⌀1.5 — support/utils/defaults.ts)를 붙이면 writer 단일 재료 경로가
//     발 층·화살촉 층에서 "경로 없음(unreachable)" 으로 thinFill 'failed' 를 냈고, task0-export 가 그 층 때문에 내보내기 전체를
//     막았다. 같은 형상을 2재료 경로(전부 슬롯 A)로 돌리면 변형 재시도 덕에 실패 0 이었다.
//
//   무엇을: src/features/v2/utils/task0/task0-gcode-writer.ts 의 retryStuckLayers(단일 재료 변형 재시도 — 기본 켬, 후보 순서
//     ① 기본 + 막힌 항목 앞 뒤집기 1 ② 앞 패스 변형 2~4 ③ 끝 항목 뒤집기 5~8) + task0-export.ts 의 막음/경고 정책.
//
//   형상 (lh 0.1, 메시는 앱처럼 **메시마다 따로** — 모델 1 + 서포트 n):
//     서포트 = support/parts/{sphere,cone,cylinder}.stl 을 verify-assemble-core 와 같은 파서로 읽어 assembleVerticalSupport
//       (기본 서포트 값, surfaceY 5, baseY 0) → (cx, cz) 평행이동 → normalizeTriangleWinding.
//     F1 판 [0,5,0]~[10,6,10] + 서포트 x,z ∈ {1,5,9} (9개)        F2 큐브 [0,5,0]~[20,25,20] + 서포트 x,z ∈ {2,7,12,17} (16개)
//     F3(대조) 큐브 10 [0,0,0]~[10,10,10] 단독                    F4(대조) 서포트 1개 단독 (5, 5)
//
//   단언:
//     (0) 서포트 값 = DEFAULT_SUPPORT_PARAMS (기본값이 바뀌면 이 스크립트의 형상·실측값을 갱신해야 한다 — 그래서 FAIL)
//     (a) 대조군 writer {retryStuckLayers:false} = 수정 전 동작 → F1 thinFillFailedLayers [0], F2 [38, 41], unreachable > 0
//         (2026-10-15 실측: F1 unreachable 1, F2 unreachable 6)
//     (b) 기본 writer → F1·F2 실패 층 0, unreachable 0, routeVariantLayers 가 (a) 의 층을 전부 포함(실측: 전부 변형 1)
//     (c) 통과 층 불변 — 기본·대조군 G-code 를 `;LAYER_CHANGE` 로 층 블록 분할:
//         (a) 에서 실패하지 않은 층 블록은 도포 줄의 E 값만 빼면 문자열 동일, E 는 줄마다 차이 ≤ 1 눈금(1e-5 mm),
//         첫 실패 층 앞 층 블록은 바이트 동일(F2 층 0~37). E 끝자리 차이는 잔차 이월(writer 머리 주석 "E") 때문 — 정확 누적 E 가
//         파일 전체로 이어져 재시도로 바뀐 층 뒤의 반올림 경계가 옮겨 간다(좌표·줄 구성은 그대로).
//         START 앞 메타는 줄 수·키가 같고 값이 다른 줄은 채움 통계·합계 키(depositTotalMm·extrusionTotalMm·thinFill*·
//         detourTravelCount)뿐, thinFillFailedLayerCount 는 N → 0. 프리앰블(START ~ 첫 층)은 바이트 동일.
//     (d) 기본 출력 F1·F2: verify-task0-writer runOutputChecks(c1~c8 — c1 = checkParser 3모드)·checkStats 위반 0
//         (gen-task0-dryrun 과 같은 방식), checkTask0GcodeCoverage 전 층 통과, 빈 층 0.
//     (e) F3·F4: 기본과 대조군 G-code 바이트 동일(sha256), routeVariantLayers 빈 배열, 실패 층 0.
//     (f) 내보내기(앱 빌트인 Task0 프로파일 값): runTask0GcodeExport(F1) 기본 → ok, 채움 실패 경고 0 — (Z1-d) 경고는 트래블 여유 거리
//         d(규격 v0.3.5 §7-2, 잠정 w) 1줄뿐: 19건, failedLayers [0,1,2,10,38,39,40,41](발·화살촉 층 — 채움 조각이 행 사이 w/2 에 놓임);
//         대조군 writer → ok(막지 않음), gcode 있음, 채움 실패 경고 1건("얇은 부분 채움 실패" + "층 0") + d 경고 1줄, failedLayers ∋ 0;
//         runTask0JobZipExport(F1, 대조군) → ok, zip > 0, 같은 경고, verifyTask0JobZip(전부 풀기) 위반 0(= Task0 가 받는 파일);
//         runTask0JobZipExport(F2) 기본 → ok, 경고 = d 1줄(31건, 층 [0,1,10,11,38,39,40,41]), verifyTask0JobZip 위반 0.
//     (g) 뮤테이션 대조군 — writer 소스에서 단일 재료 탐색 분기를 끈 변조본(임시 폴더)으로 F1 → 실패 층 [0] = (b) 가 실패한다.
//         ((a) 의 옵션 끄기와 별개로, 기본값 배선이 아니라 탐색 분기 자체가 F1 을 살린다는 증명)
//     (h) 배선(소스) — 서비스 exportTask0JobZip 이 warnings·failedLayers 를 옮김, useSliceExport 두 Task0 핸들러가 보고에
//         warnings 를 싣고 내려받은 **뒤** 경고가 있을 때만 알림 1회, SliceSidePanel 보고가 경고 0건이면 그리지 않고 있으면
//         "경고 N건 — 파일은 냈습니다" 목록. 대조군: 알림 블록을 뺀 훅·목록을 뺀 패널·warnings 를 빼먹은 서비스는 검사가 실패.
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "실패 층"·"FAIL" 같은 문자열을 출력한다.
//   실행: npx tsx scripts/verify-task0-support-retry.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assembleVerticalSupport } from "../src/features/v2/support/assemble-core.ts";
import { DEFAULT_SUPPORT_PARAMS } from "../src/features/v2/support/utils/defaults.ts";
import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";
import { checkTask0GcodeCoverage } from "../src/features/v2/utils/task0/task0-coverage.ts";
import { generateTask0Gcode, resolveTask0WriterParams } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import { runTask0GcodeExport, runTask0JobZipExport } from "../src/features/v2/utils/task0/task0-export.ts";
import { verifyTask0JobZip } from "../src/features/v2/utils/task0/task0-jobzip.ts";
import {
  TASK0_BUILT_IN_PROFILE,
  task0PrintableFrameForProfile,
  task0RasterFrameForProfile,
  task0WriterOptionsForProfile,
} from "../src/features/v2/utils/task0/task0-profile.ts";
import {
  CHECK_LABELS,
  LAYER,
  START,
  boxTriangles,
  checkStats,
  meshesTopY,
  runOutputChecks,
} from "./verify-task0-writer.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(SCRIPT_DIR, "..", "src", "features", "v2");
const TASK0_SRC = path.join(V2, "utils", "task0");
const PARTS = path.join(V2, "support", "parts");

const LH = 0.1;
/** (a) 대조군 실측값 — 2026-10-15 (플래너 재현과 같은 층) */
const EXPECT_CONTROL_FAILED = { F1: [0], F2: [38, 41] };
/** 기본 서포트 값 (support/utils/defaults.ts DEFAULT_SUPPORT_PARAMS — (0) 에서 같은지 본다) */
const SUPPORT_SPEC = {
  tipDiameterMm: 0.4,
  headBackDiameterMm: 1.0,
  headLengthMm: 1.0,
  contactPenetrationMm: 0.2,
  trunkDiameterMm: 0.8,
  baseDiameterMm: 1.5,
  baseTransitionMm: 3.0,
};
/** START 앞 메타에서 재시도로 값이 바뀔 수 있는 키 (합계·채움 통계) */
const HEADER_STAT_KEYS = new Set([
  "depositTotalMm",
  "extrusionTotalMm",
  "thinFillLayerCount",
  "thinFillFailedLayerCount",
  "thinFillPieceCount",
  "thinFillDotCount",
  "detourTravelCount",
]);

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

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const json = (v) => JSON.stringify(v);

/** 앱이 빌트인 Task0 프로파일에서 넘기는 값 (useSliceExport 와 같은 함수) */
const P = TASK0_BUILT_IN_PROFILE;
const APP = {
  writer: task0WriterOptionsForProfile(P),
  frame: task0RasterFrameForProfile(P),
  printable: task0PrintableFrameForProfile(P),
};
const CONTROL_WRITER = { ...APP.writer, retryStuckLayers: false };

// ── 형상 ─────────────────────────────────────────────────────────────────

/** 바이너리 STL → { positions, indices } (verify-assemble-core·parts-cache 파서와 같은 로직) */
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

const parts = {
  sphere: parseBinaryStl(fs.readFileSync(path.join(PARTS, "sphere.stl"))),
  cone: parseBinaryStl(fs.readFileSync(path.join(PARTS, "cone.stl"))),
  cylinder: parseBinaryStl(fs.readFileSync(path.join(PARTS, "cylinder.stl"))),
};

/** 수직 서포트 1개의 world 삼각형 (XZ 를 (cx, cz) 로 평행이동, 감김 통일) */
function supportTris(cx, cz, surfaceY = 5) {
  const geo = assembleVerticalSupport(parts, { ...SUPPORT_SPEC, surfaceY, baseY: 0 });
  const { positions: p, indices: idx } = geo;
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

function gridSupports(xs) {
  const out = [];
  for (const x of xs) for (const z of xs) out.push(supportTris(x, z));
  return out;
}

const FIXTURES = {
  F1: { label: "F1 판 10×10×1 (Y 5~6) + 서포트 3×3", meshes: () => [solid([0, 5, 0], [10, 6, 10]), ...gridSupports([1, 5, 9])] },
  F2: { label: "F2 큐브 20 (Y 5~25) + 서포트 4×4", meshes: () => [solid([0, 5, 0], [20, 25, 20]), ...gridSupports([2, 7, 12, 17])] },
  F3: { label: "F3 큐브 10 단독(대조)", meshes: () => [solid([0, 0, 0], [10, 10, 10])] },
  F4: { label: "F4 서포트 1개 단독(대조)", meshes: () => [supportTris(5, 5)] },
};

// ── G-code 쪼개기 ────────────────────────────────────────────────────────

/** START 앞 메타 줄들 / 프리앰블(START ~ 첫 층) / 층 블록들 */
function splitGcode(gcode) {
  const at = gcode.indexOf(START);
  const head = gcode.slice(0, at).split("\n").filter((l) => l !== "");
  const parts2 = gcode.slice(at).split(`${LAYER}\n`);
  return { head, pre: parts2[0], layers: parts2.slice(1) };
}

const RE_DEPOSIT_E = /^(G1 X\S+ Y\S+ E)([0-9]+\.[0-9]{5})( F\S+)$/;

/** 두 층 블록 비교 — E 를 뺀 문자열이 같은지, 도포 줄 E 차이 최댓값(눈금) */
function compareBlocks(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  if (la.length !== lb.length) return { sameShape: false, maxTickDiff: Infinity };
  let maxTickDiff = 0;
  for (let i = 0; i < la.length; i++) {
    if (la[i] === lb[i]) continue;
    const ma = RE_DEPOSIT_E.exec(la[i]);
    const mb = RE_DEPOSIT_E.exec(lb[i]);
    if (!ma || !mb || ma[1] !== mb[1] || ma[3] !== mb[3]) return { sameShape: false, maxTickDiff: Infinity };
    const ticks = Math.abs(Math.round(Number(ma[2]) * 1e5) - Math.round(Number(mb[2]) * 1e5));
    if (ticks > maxTickDiff) maxTickDiff = ticks;
  }
  return { sameShape: true, maxTickDiff };
}

// ── (0) 기본 서포트 값 ───────────────────────────────────────────────────

function sectionDefaults() {
  console.log("\n(0) 서포트 값 = 앱 기본값 (support/utils/defaults.ts)");
  const diff = Object.entries(SUPPORT_SPEC).filter(([k, v]) => DEFAULT_SUPPORT_PARAMS[k] !== v);
  assert(
    diff.length === 0,
    `DEFAULT_SUPPORT_PARAMS 와 같음 (${diff.length === 0 ? "기둥 0.8·팁 0.4·뒷구슬 1.0·발 1.5" : `다른 값: ${json(diff.map(([k]) => [k, DEFAULT_SUPPORT_PARAMS[k]]))}`})`,
  );
}

// ── (a)~(e) writer ───────────────────────────────────────────────────────

function runWriter(meshes, writer) {
  const topY = meshesTopY(meshes);
  const t0 = performance.now();
  const r = generateTask0Gcode(meshes, topY, LH, writer);
  return { r, topY, ms: performance.now() - t0 };
}

function sectionWriter() {
  console.log("\n(a)(b) writer — 대조군(retryStuckLayers false = 수정 전) / 기본(재시도)");
  const out = {};
  for (const key of ["F1", "F2"]) {
    const fx = FIXTURES[key];
    const meshes = fx.meshes();
    const ctl = runWriter(meshes, { retryStuckLayers: false });
    const def = runWriter(meshes, {});
    const ct = ctl.r.totals;
    const dt = def.r.totals;
    console.log(
      `  [${fx.label}] 메시 ${meshes.length}개, 층 ${dt.layerCount} — 대조 ${(ctl.ms / 1000).toFixed(1)} s / 기본 ${(def.ms / 1000).toFixed(1)} s`,
    );
    console.log(
      `    대조: 실패 층 ${json(ct.thinFillFailedLayers)} · unreachable ${ct.unreachable} / ` +
        `기본: 실패 층 ${json(dt.thinFillFailedLayers)} · unreachable ${dt.unreachable} · 변형 층 ${json(dt.routeVariantLayers)}` +
        ` (번호 ${json(dt.routeVariantLayers.map((n) => def.r.layers[n].routeVariant))})`,
    );
    // (a) 대조군이 실제로 실패한다 (수정 전 동작 재현)
    assert(
      json(ct.thinFillFailedLayers) === json(EXPECT_CONTROL_FAILED[key]) && ct.unreachable > 0,
      `(a) ${key} 대조군 실패 층 ${json(ct.thinFillFailedLayers)} = 기대 ${json(EXPECT_CONTROL_FAILED[key])}, unreachable ${ct.unreachable} > 0`,
    );
    assert(json(ct.routeVariantLayers) === "[]", `(a) ${key} 대조군은 변형을 쓰지 않음 (${json(ct.routeVariantLayers)})`);
    // (b) 기본은 실패 0
    assert(
      dt.thinFillFailedLayers.length === 0 && dt.unreachable === 0,
      `(b) ${key} 기본: 실패 층 ${json(dt.thinFillFailedLayers)}, unreachable ${dt.unreachable}`,
    );
    assert(
      ct.thinFillFailedLayers.every((n) => dt.routeVariantLayers.includes(n)) &&
        dt.routeVariantLayers.every((n) => def.r.layers[n].routeVariant >= 1 && def.r.layers[n].routeVariant <= 8),
      `(b) ${key} 변형 층 ${json(dt.routeVariantLayers)} ⊇ 대조군 실패 층, 번호 1~8`,
    );
    out[key] = { meshes, ctl, def };
  }
  return out;
}

function sectionUnchanged(runs) {
  console.log("\n(c) 통과 층 불변 — 기본 vs 대조군 (실패하지 않은 층 = 같은 계획)");
  for (const key of ["F1", "F2"]) {
    const { ctl, def } = runs[key];
    const failedSet = new Set(ctl.r.totals.thinFillFailedLayers);
    const firstFailed = Math.min(...failedSet);
    const a = splitGcode(ctl.r.gcode);
    const b = splitGcode(def.r.gcode);
    assert(a.pre === b.pre, `${key}: 프리앰블(START ~ 첫 층) 바이트 동일`);
    // START 앞 메타 — 줄 수·키 같고, 값이 다른 줄은 합계·채움 통계 키뿐
    const keyOf = (l) => (/^; ([A-Za-z0-9]+): /.exec(l) ?? [null, null])[1];
    const headDiff = a.head.flatMap((l, i) => (l === b.head[i] ? [] : [[l, b.head[i]]]));
    const headOk =
      a.head.length === b.head.length &&
      a.head.every((l, i) => keyOf(l) === keyOf(b.head[i])) &&
      headDiff.every(([l]) => HEADER_STAT_KEYS.has(keyOf(l))) &&
      a.head.includes(`; thinFillFailedLayerCount: ${failedSet.size}`) &&
      b.head.includes("; thinFillFailedLayerCount: 0");
    assert(
      headOk,
      `${key}: START 앞 메타 줄 수·키 같음, 다른 값은 합계·채움 통계만 (${headDiff.map(([l, m]) => `${keyOf(l)} ${l.split(": ")[1]} → ${m.split(": ")[1]}`).join(", ")})`,
    );
    assert(a.layers.length === b.layers.length && a.layers.length === ctl.r.totals.layerCount, `${key}: 층 블록 수 ${a.layers.length} 같음`);
    let byteSame = 0;
    let eOnly = 0;
    let maxTick = 0;
    const bad = [];
    const beforeFirstBad = [];
    for (let n = 0; n < a.layers.length; n++) {
      if (failedSet.has(n)) continue;
      if (a.layers[n] === b.layers[n]) {
        byteSame++;
        continue;
      }
      if (n < firstFailed) beforeFirstBad.push(n);
      const c = compareBlocks(a.layers[n], b.layers[n]);
      if (!c.sameShape) bad.push(n);
      else {
        eOnly++;
        maxTick = Math.max(maxTick, c.maxTickDiff);
      }
    }
    assert(
      bad.length === 0 && maxTick <= 1,
      `${key}: 실패하지 않은 층 ${a.layers.length - failedSet.size}개 — 바이트 동일 ${byteSame} · E 끝자리만 다름 ${eOnly}(줄마다 최대 ${maxTick} 눈금) · 그 밖 차이 ${json(bad)}`,
    );
    assert(
      beforeFirstBad.length === 0 && byteSame >= firstFailed,
      `${key}: 첫 실패 층(${firstFailed}) 앞 층 블록은 바이트 동일 (${firstFailed}개, 어긋남 ${json(beforeFirstBad)})`,
    );
    const changed = [...failedSet].filter((n) => a.layers[n] !== b.layers[n] && !compareBlocks(a.layers[n], b.layers[n]).sameShape);
    assert(changed.length === failedSet.size, `${key}: 재시도한 층 ${json([...failedSet])} 은 경로가 실제로 바뀜`);
  }
}

function sectionOutputChecks(runs) {
  console.log("\n(d) 기본 출력 — verify-task0-writer c1~c8·통계 (gen-task0-dryrun 과 같은 방식) + 전 층 커버리지");
  const params = resolveTask0WriterParams();
  for (const key of ["F1", "F2"]) {
    const { meshes, def } = runs[key];
    const ctx = { name: key, meshes, topY: def.topY, lh: LH, params, expectedEmpty: [] };
    const res = runOutputChecks(def.r.gcode, ctx);
    const problems = [];
    for (const k of Object.keys(CHECK_LABELS)) for (const m of res[k]) problems.push(`${CHECK_LABELS[k]}: ${m}`);
    for (const m of checkStats(def.r, ctx)) problems.push(`통계: ${m}`);
    for (const p of problems.slice(0, 10)) console.error(`    ${p}`);
    assert(problems.length === 0, `${key}: c1(파서 3모드)~c8·통계 위반 ${problems.length}건`);
    const cov = checkTask0GcodeCoverage(meshes, def.topY, LH, def.r.gcode, { depositWidthMm: params.depositWidthMm });
    assert(
      cov.pass && cov.gcodeLayerCount === cov.expectedLayerCount && cov.failedLayers.length === 0,
      `${key}: 커버리지 전 층 통과 (층 ${cov.gcodeLayerCount}/${cov.expectedLayerCount}, 실패 층 ${json(cov.failedLayers)})`,
    );
    assert(def.r.totals.emptyLayers.length === 0, `${key}: 빈 층 0 (${json(def.r.totals.emptyLayers)})`);
  }
}

function sectionControlShapes() {
  console.log("\n(e) 대조 형상 — 기본 계획이 통과하는 층만 있으면 재시도 켜고 끄고 바이트 동일");
  for (const key of ["F3", "F4"]) {
    const fx = FIXTURES[key];
    const meshes = fx.meshes();
    const ctl = runWriter(meshes, { retryStuckLayers: false });
    const def = runWriter(meshes, {});
    assert(
      sha256(def.r.gcode) === sha256(ctl.r.gcode) &&
        def.r.totals.routeVariantLayers.length === 0 &&
        def.r.totals.thinFillFailedLayers.length === 0 &&
        ctl.r.totals.thinFillFailedLayers.length === 0,
      `${fx.label}: sha256 ${sha256(def.r.gcode).slice(0, 16)}… 같음, 변형 층 ${json(def.r.totals.routeVariantLayers)}, 실패 층 0 (층 ${def.r.totals.layerCount})`,
    );
  }
}

// ── (f) 내보내기 ─────────────────────────────────────────────────────────

function exportInput(meshes, writer, extra = {}) {
  return { meshes, topY: meshesTopY(meshes), layerHeightMm: LH, writer, printable: APP.printable, ...extra };
}

async function sectionExport(runs) {
  console.log("\n(f) 내보내기 — 기본은 채움 경고 없이(트래블 여유 거리 d 경고 1줄만), 대조군 writer(수정 전 계획)도 막지 않고 경고로");
  const m1 = runs.F1.meshes;
  const g = runTask0GcodeExport(exportInput(m1, APP.writer));
  // (Z1-d) d 경고 — 발·화살촉 층의 채움 조각이 행 사이(행 중심선에서 w/2)에 놓여 d = w(잠정) 안으로 지나간다. writer 계획은 w/2 기하
  //   (설계 — 협의 §37 질문 2). 실측: F1 19건 · 층 [0,1,2,10,38,39,40,41] (architect 측정과 같음)
  const isClear = (s) => s.startsWith("트래블이 칠한 레진에서 d = 0.5 mm 안으로 지나는 곳 ");
  assert(
    g.ok && typeof g.gcode === "string" && g.warnings.length === 1 && isClear(g.warnings[0]) && g.summary.travelClearance?.count === 19 &&
      json(g.failedLayers) === "[0,1,2,10,38,39,40,41]" && g.summary.thinFillFailedLayers.length === 0,
    `F1 run.gcode 기본: ok, 채움 실패 0, 경고 = d 1줄(${g.ok ? g.summary.travelClearance?.count : "?"}건), failedLayers ${json(g.failedLayers)}`,
  );
  const gc = runTask0GcodeExport(exportInput(m1, CONTROL_WRITER));
  const warn = gc.ok ? gc.warnings.filter((s) => !isClear(s)) : [];
  assert(
    gc.ok && typeof gc.gcode === "string" && gc.gcode.length > 0 && gc.failedLayers.includes(0) &&
      gc.warnings.length === 2 && gc.warnings.filter(isClear).length === 1 &&
      warn.length === 1 && warn[0].includes("얇은 부분 채움 실패") && warn[0].includes("층 0") && warn[0].includes("파일은 그대로 냈습니다"),
    `F1 run.gcode 대조군 writer: 막지 않음(ok), failedLayers ${json(gc.failedLayers)}(∋ 0), 경고 = 채움 실패 "${warn[0]?.slice(0, 60) ?? "(없음)"}…" + d 1줄`,
  );
  assert(gc.ok && gc.summary.thinFillFailedLayers.length === 1, "F1 run.gcode 대조군 writer: 요약 thinFillFailedLayers [0] 그대로");

  const jc = await runTask0JobZipExport(exportInput(m1, CONTROL_WRITER, { frame: APP.frame }));
  const jcRep = jc.ok ? await verifyTask0JobZip(jc.zip) : null;
  assert(
    jc.ok && jc.zip.length > 0 && json(jc.failedLayers) === json(gc.failedLayers) && jc.warnings.some((s) => s.includes("얇은 부분 채움 실패") && s.includes("층 0")),
    `F1 job.zip 대조군 writer: ok, zip ${jc.ok ? jc.zip.length : 0} B, 경고 ${jc.ok ? jc.warnings.length : "?"}건, failedLayers ${json(jc.failedLayers)}`,
  );
  assert(
    jcRep !== null && jcRep.pass && jcRep.reasons.length === 0 && jcRep.extraIssues.length === 0,
    `F1 job.zip 대조군 writer: verifyTask0JobZip(전부 풀기) 거부 조건 ${jcRep ? json(jcRep.violations) : "?"} · 추가 ${jcRep?.extraIssues.length ?? "?"} — Task0 가 받는 파일`,
  );

  const j2 = await runTask0JobZipExport(exportInput(runs.F2.meshes, APP.writer, { frame: APP.frame }));
  const j2Rep = j2.ok ? await verifyTask0JobZip(j2.zip) : null;
  assert(
    j2.ok && j2.warnings.length === 1 && isClear(j2.warnings[0]) && j2.summary.travelClearance?.count === 31 &&
      json(j2.failedLayers) === "[0,1,10,11,38,39,40,41]" && j2Rep !== null && j2Rep.pass,
    `F2 job.zip 기본: ok, 경고 = d 1줄(${j2.ok ? j2.summary.travelClearance?.count : "?"}건, 층 ${json(j2.failedLayers)}), 층 ${j2.ok ? j2.summary.layerCount : "?"}, ` +
      `verifyTask0JobZip ${j2Rep?.pass ? "통과" : "실패"}`,
  );
}

// ── (g) 뮤테이션 대조군 ──────────────────────────────────────────────────

const AT_SINGLE_RETRY = "    if (dual === null && !ok(chosen) && options.retryStuckLayers !== false) {";

/** task0-gcode-writer.ts 를 소스 변조해 임시 폴더에 쓰고 import — 상대 import 는 원본 폴더의 절대 URL 로 바꾼다 */
async function loadWriterMutant(tag, from, to) {
  const src = fs.readFileSync(path.join(TASK0_SRC, "task0-gcode-writer.ts"), "utf8");
  if (!src.includes(from)) throw new Error(`변조 대상 문자열이 소스에 없음 (${tag}): ${from}`);
  const mutated = src
    .replace(from, to)
    .replace(/from '\.\/([^']+)'/g, (_, p) => `from '${pathToFileURL(path.join(TASK0_SRC, `${p}.ts`)).href}'`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-task0-support-retry-"));
  const file = path.join(dir, `task0-gcode-writer.${tag}.ts`);
  fs.writeFileSync(file, mutated, "utf8");
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function sectionMutant(runs) {
  console.log("\n(g) 뮤테이션 대조군 — 단일 재료 탐색 분기를 끈 writer 변조본");
  const mut = await loadWriterMutant("no-single-retry", AT_SINGLE_RETRY, "    if (false) {");
  const meshes = runs.F1.meshes;
  const r = mut.generateTask0Gcode(meshes, meshesTopY(meshes), LH, {});
  const t = r.totals;
  assert(
    json(t.thinFillFailedLayers) === json(EXPECT_CONTROL_FAILED.F1) && t.unreachable > 0 && sha256(r.gcode) === sha256(runs.F1.ctl.r.gcode),
    `변조본 기본 옵션 F1: 실패 층 ${json(t.thinFillFailedLayers)} (= (b) 가 실패), 출력 = 대조군 writer 와 같은 바이트`,
  );
  const ok = t.thinFillFailedLayers.length === 0 && t.unreachable === 0;
  assert(!ok, "변조본에서는 (b) 의 \"기본: 실패 층 0\" 단언이 성립하지 않는다");
}

// ── (h) 배선 (소스) ──────────────────────────────────────────────────────

const readV2 = (...p) => fs.readFileSync(path.join(V2, ...p), "utf8");

/** 핸들러 본문 하나 — 보고에 warnings, 내려받은 뒤 경고가 있을 때만 알림 1회 */
function handlerWarnOk(body, what) {
  const dl = body.indexOf("downloadBlob(");
  const warnIf = body.indexOf("if (result.warnings.length > 0) {");
  const alertAt = body.indexOf("window.alert(", warnIf);
  return (
    /warnings: result\.warnings/.test(body) &&
    dl > 0 && warnIf > dl && alertAt > warnIf &&
    body.slice(alertAt, alertAt + 200).includes(`Task0 ${what}`) &&
    body.slice(alertAt, alertAt + 200).includes("경고 — 파일은 그대로 냈습니다")
  );
}

function uiWiring(svc, hook, panel) {
  const job = hook.slice(hook.indexOf("const handleExportTask0JobZip"), hook.indexOf("const handleExportTask0Gcode"));
  const gc = hook.slice(hook.indexOf("const handleExportTask0Gcode"), hook.lastIndexOf("return {"));
  const view = panel.slice(panel.indexOf("function Task0ReportView"), panel.indexOf("function Card("));
  return {
    service: /warnings: r\.warnings,/.test(svc) && /failedLayers: r\.failedLayers,/.test(svc),
    hookJob: handlerWarnOk(job, "job.zip"),
    hookGcode: handlerWarnOk(gc, "G-code"),
    panel:
      /\{report\.warnings\.length > 0 && \(/.test(view) &&
      view.includes("경고 {report.warnings.length}건 — 파일은 냈습니다") &&
      /report\.warnings\.map\(\(w, i\) => \(\s*<li key=\{`\$\{i\}:\$\{w\}`\}>\{w\}<\/li>/.test(view) &&
      view.indexOf("report.warnings") > view.indexOf("if (!report.ok)"),
  };
}

function sectionWiring() {
  console.log("\n(h) 배선(소스) — 서비스·훅(알림 1회)·패널(경고 목록)");
  const svc = readV2("utils", "slice-batch-service.ts");
  const hook = readV2("pages", "viewer", "hooks", "useSliceExport.ts");
  const panel = readV2("components", "SliceSidePanel.tsx");
  const w = uiWiring(svc, hook, panel);
  assert(w.service, "서비스 exportTask0JobZip — ok 결과를 Blob 으로 다시 만들 때 warnings·failedLayers 를 옮긴다");
  assert(w.hookJob, "useSliceExport handleExportTask0JobZip — 보고에 warnings, 내려받은 뒤 경고가 있을 때만 알림 1회");
  assert(w.hookGcode, "useSliceExport handleExportTask0Gcode — 보고에 warnings, 내려받은 뒤 경고가 있을 때만 알림 1회");
  assert(w.panel, "SliceSidePanel Task0ReportView — 성공 보고에서 경고가 있을 때만 \"경고 N건 — 파일은 냈습니다\" 목록(key = 순번:문장)");
  // 대조군 — 빼먹은 소스는 위 검사가 잡는다
  const noAlert = hook.replace(/\n\s*\/\/ 막지 않은 경고[^\n]*\n\s*if \(result\.warnings\.length > 0\) \{[\s\S]*?\n {6}\}\n/, "\n");
  const noList = panel.replace("{report.warnings.length > 0 && (", "{false && (");
  const noSvc = svc.replace("      warnings: r.warnings,\n", "");
  const c = [uiWiring(svc, noAlert, panel), uiWiring(svc, hook, noList), uiWiring(noSvc, hook, panel)];
  assert(
    noAlert !== hook && !(c[0].hookJob && c[0].hookGcode) && noList !== panel && !c[1].panel && noSvc !== svc && !c[2].service,
    "대조군: 알림 블록을 뺀 훅·경고 목록을 끈 패널·warnings 를 빼먹은 서비스는 각각 위 검사가 실패",
  );
}

async function main() {
  console.log("Task0 단일 재료 변형 재시도 검증 — 기본 서포트 + 기본 설정이면 파일이 나와야 한다 (2026-10-15 리드 결정)");
  sectionDefaults();
  const runs = sectionWriter();
  sectionUnchanged(runs);
  sectionOutputChecks(runs);
  sectionControlShapes();
  await sectionExport(runs);
  await sectionMutant(runs);
  sectionWiring();
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
