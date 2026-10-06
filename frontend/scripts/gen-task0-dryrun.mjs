// Task0 드라이런 파일 생성 (로드맵 0절 2주차 PR-1 Z1-a2·Z1-b2·Z1-c — 10/7~8 Task0 프린터 드라이런용, D1a 파일 D 2재료).
//
//   만드는 것 (writer = src/features/v2/utils/task0/task0-gcode-writer.ts, 규격서 v0.3.4 — Z1-c: 모든 툴 리트랙트 상태로
//   시작, 툴의 첫 도포 앞에도 E+r, 층마다 E+r 수 = E-r 수):
//     파일 A  task0_A_cube10_lh0.1.gcode   10 mm 정육면체, 출력 가능 영역 가운데(베드 (80, 47.5) = world x 5, z 5),
//                                          바닥 Y 0, lh 0.1 → 100층
//     파일 B  task0_B_thin_5L_lh0.1.gcode  (Z1-b2) 한 층에 세 형상 — ① 10×10 판 + 가운데 3×3 구멍 ② 얇은 링(반경 4,
//                                          폭 0.3 mm) ③ 얇은 띠(10 × 0.6 mm, 전역 행 위상에서 빗나가게). 높이 0.5, lh 0.1 → 5층.
//                                          형상 정의 = verify-task0-writer.mjs fixtureFileB (같은 검증을 상시로 돈다)
//     파일 C  task0_C_gap_5L_lh0.1.gcode   10×10 판 두 장(Y 0~0.2, 0.3~0.5), lh 0.1 → 5층, 층 2(0-based)가 빈 층
//     파일 D  task0_D_dual_10L_lh0.1.gcode (D1a 2재료) 서포트 기둥 A(T0) 4개 + 판 B(T1) — 형상 = verify-task0-dual.mjs
//                                          fixtureDualPillarsPlate. lh 0.1 → 10층: 층 0~3 기둥만(T0), 4~5 둘 다(T0 → T1),
//                                          6~9 판만(T1). 왼쪽 기둥 둘은 판 모서리에 걸쳐 판 높이에도 A 가 남고, 오른쪽 둘은 판에 묻힌다
//                                          (B 우선 — 그 자리 A 도포 0). 쓰기 전 검사 = verify-task0-dual runDualOutputChecks(c1~c10 —
//                                          c3 툴별 리트랙트·c10 툴 순서) + 2재료 통계 + 재료별 커버리지(B 우선 위반 0) + (있으면)
//                                          Task0 원본 파서(Python @03c0519) 3모드 경고·오류 0.
//
//   쓰기 전에 verify-task0-writer.mjs 의 출력 검사(c1~c7 + c4b 실제 교차 + c8 참조 구간 — c3 은 v0.3.4 리트랙트 상태 기계)와
//   통계 검사를 그대로 돌리고,
//   (Z1-b1) 커버리지 검사기(task0-coverage.ts checkTask0GcodeCoverage)로 **전 층** (a)(b)(c)(d)·넘침 통과를 본다
//   (규격 §3 "도포 영역 = 노광 영역" — G-code 텍스트에서 도포 선분을 다시 뽑아 같은 단면의 마스크와 맞댄다).
//   (Z1-b2) writer 의 채움 실패 층(totals.thinFillFailedLayers)이 하나라도 있어도 실패. A·C 는 채움이 없어야 한다
//   (채움 없는 층은 B안 행 그대로), B 는 채움이 있어야 한다. sha256 고정값은 verify-task0-export.mjs (3) 이 갖는다
//   (Z1-c 값 — Z1-b2 판과의 차이는 파일 첫 도포 앞 E+r 1줄과 머리 메타 두 줄뿐임을 거기서 단언).
//   하나라도 실패하면 **어떤 파일도 쓰지 않고** exit 1.
//   이 스크립트는 검증 목록(verify-*)이 아니다 — 상시 검증은 verify-task0-writer.mjs·verify-task0-coverage.mjs·
//   verify-task0-dual.mjs(파일 D 형상 포함) 가 맡는다.
//
//   실행: npx tsx scripts/gen-task0-dryrun.mjs [--out <폴더>]
//     기본 폴더 = OS 임시 폴더/mazicalign-task0. 쓴 경로와 파일별 통계(층 수·빈 층·도포/트래블 길이·
//     리트랙트 수·E 합·줄 수·sha256·채움 조각/점/우회 트래블 수·드라이런 예상 시간)와 커버리지 층별 최악값 요약을 출력한다.
//     드라이런 예상 시간 = XY 이동 길이(도포 + 트래블) ÷ 10 mm/s(드라이런 F600) + E 단독 줄 |E| ÷ 10 mm/s
//       + 도포한 층 × 23 s(파킹 3 + 블레이드 15 + LED 3 + 오버헤드 2 — 협의 §24-3 추정). Z 이동은 뺀다(층당 1초 미만).
//       (D) + 툴 전환 수 × 0.5 s (규격 §13 toolChangeSec 잠정 — 퍼지 도입 시 5~15 s). 실출력 추정(manifest estimate 식,
//       task0-jobzip buildTask0Estimate — 노광은 기본값)도 함께 찍는다.
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkTask0DualGcodeCoverage, checkTask0GcodeCoverage } from "../src/features/v2/utils/task0/task0-coverage.ts";
import { TASK0_TIME_CONSTANTS } from "../src/features/v2/utils/task0/task0-frame.ts";
import { generateTask0Gcode, resolveTask0WriterParams } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import { buildTask0Estimate, buildTask0Exposure } from "../src/features/v2/utils/task0/task0-jobzip.ts";
import {
  DUAL_CHECK_LABELS,
  checkDualStats,
  dualCoverageSummary,
  fixtureDualPillarsPlate,
  runDualOutputChecks,
  runTask0OriginalParser,
} from "./verify-task0-dual.mjs";
import {
  CHECK_LABELS,
  checkStats,
  coverageSummary,
  expectedEmptyLayers,
  fixtureCube10,
  fixtureFileB,
  fixtureGapPlates,
  meshesTopY,
  runOutputChecks,
} from "./verify-task0-writer.mjs";

/** 드라이런 이동 속도 (mm/s) — Task0 드라이런은 모든 이동 F600 (규격 §8) */
const DRYRUN_SPEED_MM_S = 10;
/** 도포한 층마다 Task0 층 경계 동작 (s) — 파킹 3 + 블레이드 15 + LED 3 + 오버헤드 2 (협의 §24-3 추정) */
const DRYRUN_LAYER_OVERHEAD_S = 23;

function parseArgs(argv) {
  let out = path.join(os.tmpdir(), "mazicalign-task0");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      const v = argv[++i];
      if (!v) throw new Error("--out 뒤에 폴더 경로가 필요함");
      out = path.resolve(v);
    } else if (argv[i].startsWith("--out=")) {
      out = path.resolve(argv[i].slice("--out=".length));
    } else {
      throw new Error(`알 수 없는 인자: ${argv[i]} (사용법: --out <폴더>)`);
    }
  }
  return { out };
}

const FILES = [
  { file: "task0_A_cube10_lh0.1.gcode", fixture: fixtureCube10(), lh: 0.1, expectLayers: 100, expectEmpty: [], expectFill: false },
  { file: "task0_B_thin_5L_lh0.1.gcode", fixture: fixtureFileB(), lh: 0.1, expectLayers: 5, expectEmpty: [], expectFill: true },
  { file: "task0_C_gap_5L_lh0.1.gcode", fixture: fixtureGapPlates(), lh: 0.1, expectLayers: 5, expectEmpty: [2], expectFill: false },
  {
    file: "task0_D_dual_10L_lh0.1.gcode",
    fixture: fixtureDualPillarsPlate(),
    lh: 0.1,
    expectLayers: 10,
    expectEmpty: [],
    expectFill: false,
    dual: true,
    expectToolChanges: 3,
  },
];

/** 드라이런 예상 시간 (s) — 머리 주석의 식 (단일 재료는 툴 전환 0 이라 예전 값 그대로) */
function dryrunSeconds(result) {
  const t = result.totals;
  const eOnly = (t.retracts + t.unretracts) * result.params.retractMm;
  const layers = t.layerCount - t.emptyLayers.length;
  return (
    (t.depositMm + t.travelMm + eOnly) / DRYRUN_SPEED_MM_S +
    layers * DRYRUN_LAYER_OVERHEAD_S +
    t.toolChanges * TASK0_TIME_CONSTANTS.toolChangeSec
  );
}

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const params = resolveTask0WriterParams();
  console.log("Task0 드라이런 파일 생성 (Z1-a2·Z1-b2·Z1-c·D1a, 규격서 v0.3.4)");
  console.log(
    `  설정: w ${params.depositWidthMm} mm, K ${params.syringeKMm3PerMm} mm³/mm, 과충전 ${params.overfill}, ` +
      `r ${params.retractMm} mm, 리트랙트 생략 < ${params.retractMinTravelMm} mm, ` +
      `F 도포 ${params.depositF} / 트래블 ${params.travelF} / 리트랙트 ${params.retractF}`,
  );

  // 1) 전부 생성·검사 — 하나라도 실패하면 아무것도 쓰지 않음
  const built = [];
  let bad = 0;
  for (const spec of FILES) {
    const meshes = spec.fixture.meshes();
    const topY = meshesTopY(meshes);
    const result = spec.dual
      ? generateTask0Gcode(meshes, topY, spec.lh, { dualMaterial: { slots: spec.fixture.slots } })
      : generateTask0Gcode(meshes, topY, spec.lh);
    const ctx = {
      name: spec.file,
      meshes,
      slots: spec.fixture.slots,
      topY,
      lh: spec.lh,
      params,
      expectedEmpty: expectedEmptyLayers(spec.fixture.solids, topY, spec.lh),
      fixtureCheck: spec.dual ? spec.fixture.fixtureCheck : null,
    };
    const problems = [];
    if (spec.dual) {
      // (D1a) 2재료 — 툴별 c3·c10 툴 순서 포함 (verify-task0-dual 과 같은 검사)
      const res = runDualOutputChecks(result.gcode, ctx);
      for (const key of Object.keys(DUAL_CHECK_LABELS)) {
        for (const msg of res[key]) problems.push(`${DUAL_CHECK_LABELS[key]}: ${msg}`);
      }
      for (const msg of checkDualStats(result, ctx)) problems.push(`통계: ${msg}`);
      if (result.totals.toolChanges !== spec.expectToolChanges) {
        problems.push(`툴 전환 ${result.totals.toolChanges} ≠ 기대 ${spec.expectToolChanges}`);
      }
      if (result.totals.unreachable) problems.push(`경로 없는 항목 ${result.totals.unreachable}`);
    } else {
      const res = runOutputChecks(result.gcode, ctx);
      for (const key of Object.keys(CHECK_LABELS)) {
        for (const msg of res[key]) problems.push(`${CHECK_LABELS[key]}: ${msg}`);
      }
      for (const msg of checkStats(result, ctx)) problems.push(`통계: ${msg}`);
    }
    const t = result.totals;
    if (t.layerCount !== spec.expectLayers) problems.push(`층 수 ${t.layerCount} ≠ 기대 ${spec.expectLayers}`);
    if (JSON.stringify(t.emptyLayers) !== JSON.stringify(spec.expectEmpty)) {
      problems.push(`빈 층 ${JSON.stringify(t.emptyLayers)} ≠ 기대 ${JSON.stringify(spec.expectEmpty)}`);
    }
    if (t.sectionWithoutDeposit.length) problems.push(`단면은 있는데 도포 0 인 층 ${JSON.stringify(t.sectionWithoutDeposit)}`);
    if (t.thinFillFailedLayers.length) problems.push(`채움 실패 층 ${JSON.stringify(t.thinFillFailedLayers)}`);
    if ((t.thinFillLayers.length > 0) !== spec.expectFill) {
      problems.push(`채움 층 ${JSON.stringify(t.thinFillLayers)} — 기대 ${spec.expectFill ? "있음" : "없음"}`);
    }
    // 커버리지 (규격 §3) — writer 와 같은 meshes·topY·lh·w 로 G-code 텍스트를 다시 읽어 검사
    //   (D) 2재료는 재료별(A = PA − PB, B = PB) + 넘침은 합집합 + B 우선 위반 0
    const coverage = spec.dual
      ? checkTask0DualGcodeCoverage(meshes, spec.fixture.slots, topY, spec.lh, result.gcode, { depositWidthMm: params.depositWidthMm })
      : checkTask0GcodeCoverage(meshes, topY, spec.lh, result.gcode, { depositWidthMm: params.depositWidthMm });
    if (coverage.gcodeLayerCount !== coverage.expectedLayerCount) {
      problems.push(`커버리지: G-code 층 ${coverage.gcodeLayerCount} ≠ 기대 ${coverage.expectedLayerCount}`);
    }
    if (coverage.preambleSegments) problems.push(`커버리지: 프리앰블 도포 ${coverage.preambleSegments}줄`);
    for (const l of coverage.layers.filter((x) => !x.pass).slice(0, 10)) {
      const which = spec.dual
        ? ["A", "B"]
            .flatMap((m) => ["a", "b", "c", "d", "overflow"].filter((k) => !l[m][k].pass).map((k) => `${m}.${k}`))
            .concat(l.overlapSamplesA ? ["B 우선"] : [])
            .join("·")
        : ["a", "b", "c", "d", "overflow"].filter((k) => !l[k].pass).join("·");
      problems.push(`커버리지: 층 ${l.index} FAIL (${which})`);
    }
    if (coverage.failedLayers.length > 10) problems.push(`커버리지: FAIL 층 ${coverage.failedLayers.length}개 (앞 10개만 표시)`);
    if (spec.dual && coverage.overlapSamplesA) problems.push(`B 우선 위반 표본 ${coverage.overlapSamplesA}`);
    console.log(`\n  [${spec.file}] 검사 ${problems.length === 0 ? "통과" : `실패 ${problems.length}건`}`);
    console.log(`    커버리지 ${coverage.pass ? "전 층 통과" : "FAIL"}: ${spec.dual ? dualCoverageSummary(coverage) : coverageSummary(coverage)}`);
    for (const p of problems.slice(0, 20)) console.error(`    FAIL: ${p}`);
    if (problems.length) bad++;
    built.push({ spec, result, ctx, coverage });
  }
  // (D) 2재료 파일은 Task0 원본 파서(Python @03c0519)로도 — 있으면 3모드 경고·오류 0 이어야 쓴다 (없으면 SKIP, 이식판 c1 으로 판정)
  const duals = built.filter((b) => b.spec.dual);
  if (duals.length) {
    const run = runTask0OriginalParser(duals.map((b) => ({ gcode: b.result.gcode, lh: b.spec.lh })));
    if (run.skip) console.log(`\n  원본 파서 SKIP: ${run.skip}`);
    else if (run.error) {
      console.error(`\n  FAIL: 원본 파서 실행 실패 — ${run.error}`);
      bad++;
    } else {
      duals.forEach((b, i) => {
        const msgs = run.results[i].flatMap((m) => [...m.warnings, ...m.errors].map((x) => `${m.mode}(keepE=${m.keepE}): ${x}`));
        const layersOk = run.results[i].every((m) => m.layerCount === b.result.totals.layerCount);
        console.log(`\n  [${b.spec.file}] Task0 원본 파서(${run.python}) 3모드: 경고·오류 ${msgs.length}, 층 수 ${layersOk ? "일치" : "불일치"}`);
        for (const m of msgs.slice(0, 10)) console.error(`    FAIL: ${m}`);
        if (msgs.length || !layersOk) bad++;
      });
    }
  }
  if (bad) {
    console.error(`\n검사 실패 ${bad}개 파일 — 아무 파일도 쓰지 않음`);
    process.exit(1);
  }

  // 2) 쓰기 (\n 줄바꿈 그대로, BOM 없음)
  fs.mkdirSync(out, { recursive: true });
  console.log(`\n출력 폴더: ${out}`);
  for (const { spec, result, ctx, coverage } of built) {
    const file = path.join(out, spec.file);
    fs.writeFileSync(file, result.gcode, "utf8");
    const t = result.totals;
    console.log(`\n  ${file}`);
    console.log(`    층 수 ${t.layerCount} (topY ${ctx.topY} mm, lh ${spec.lh} mm), 빈 층 ${JSON.stringify(t.emptyLayers)}`);
    console.log(`    도포 ${t.depositMm.toFixed(3)} mm (${t.segments}줄), 트래블 ${t.travelMm.toFixed(3)} mm (층 첫 트래블은 파킹 (0,0)부터)`);
    console.log(`    리트랙트 E-r ${t.retracts} / 언리트랙트 E+r ${t.unretracts}, 도포 E 합 ${t.extrusionMm.toFixed(5)} mm (정확 ${t.extrusionExactMm.toFixed(7)})`);
    console.log(`    줄 수 ${t.lineCount}, 크기 ${Buffer.byteLength(result.gcode, "utf8")} B, XY 범위 ` +
      (t.xyBounds ? `X ${t.xyBounds.xMin}~${t.xyBounds.xMax} × Y ${t.xyBounds.yMin}~${t.xyBounds.yMax}` : "없음"));
    if (t.thinFillLayers.length > 0) {
      console.log(
        `    채움 층 ${JSON.stringify(t.thinFillLayers)}: 중심선 조각 ${t.fillPieces}, 점 도포 ${t.fillDots}, 채움 줄 ${t.fillSegments}, ` +
          `우회 트래블 ${t.detourTravels}`,
      );
    }
    if (spec.dual) {
      const [b0, b1] = t.byTool;
      console.log(`    (2재료) T 전환 ${t.toolChanges}회 (층별 ${JSON.stringify(result.layers.map((s) => s.toolChanges))})`);
      console.log(`      T0(A): 도포 ${b0.depositMm.toFixed(3)} mm (${b0.segments}줄), E-r ${b0.retracts} / E+r ${b0.unretracts}, E 합 ${b0.extrusionMm.toFixed(5)} mm`);
      console.log(`      T1(B): 도포 ${b1.depositMm.toFixed(3)} mm (${b1.segments}줄), E-r ${b1.retracts} / E+r ${b1.unretracts}, E 합 ${b1.extrusionMm.toFixed(5)} mm`);
      console.log(`      우회 트래블 ${t.detourTravels} (전환 트래블 포함), T0 표본의 PB 안쪽 최대 깊이 ${coverage.overlapMaxDepthMm.toFixed(4)} mm`);
      const exposure = buildTask0Exposure(t.layerCount, spec.lh);
      const est = buildTask0Estimate(result.layers, result.params, exposure.exposureSecByLayer, { toolChangeCount: t.toolChanges });
      console.log(
        `      실출력 추정(manifest estimate 식, 노광 기본값) ${est.totalSec} s — 도포 ${est.depositSec} / 트래블 ${est.travelSec} / ` +
          `툴 전환 ${est.toolChangeSec} / 파킹 ${est.parkSec} / 블레이드 ${est.bladeSec} / 층 ${est.layerOverheadSec} / 노광 ${est.exposureSec}`,
      );
    }
    const sec = dryrunSeconds(result);
    console.log(
      `    드라이런 예상 약 ${(sec / 60).toFixed(1)}분 (${Math.round(sec)} s — 이동 F600 + 층당 ${DRYRUN_LAYER_OVERHEAD_S} s` +
        (t.toolChanges ? ` + 툴 전환 ${t.toolChanges} × ${TASK0_TIME_CONSTANTS.toolChangeSec} s)` : ")"),
    );
    const rt = ctx.retraceReport;
    console.log(`    되짚기(첫 다리가 직전 도포 방향과 90° 넘게 — 통계, 위반 아님): 합 ${rt.total}(같은 직선 겹침 ${rt.collinear}), 층당 최대 ${rt.maxPerLayer}`);
    console.log(`    sha256 ${createHash("sha256").update(result.gcode, "utf8").digest("hex")}`);
    console.log(`    커버리지(전 층 통과): ${spec.dual ? dualCoverageSummary(coverage) : coverageSummary(coverage)}`);
  }
  console.log("\n완료");
}

main();
