// Task0 드라이런 파일 생성 (로드맵 0절 2주차 PR-1 Z1-a2·Z1-b2·Z1-c — 10/7~8 Task0 프린터 드라이런용).
//
//   만드는 것 (writer = src/features/v2/utils/task0/task0-gcode-writer.ts, 규격서 v0.3.4 — Z1-c: 모든 툴 리트랙트 상태로
//   시작, 툴의 첫 도포 앞에도 E+r, 층마다 E+r 수 = E-r 수):
//     파일 A  task0_A_cube10_lh0.1.gcode   10 mm 정육면체, 출력 가능 영역 가운데(베드 (80, 47.5) = world x 5, z 5),
//                                          바닥 Y 0, lh 0.1 → 100층
//     파일 B  task0_B_thin_5L_lh0.1.gcode  (Z1-b2) 한 층에 세 형상 — ① 10×10 판 + 가운데 3×3 구멍 ② 얇은 링(반경 4,
//                                          폭 0.3 mm) ③ 얇은 띠(10 × 0.6 mm, 전역 행 위상에서 빗나가게). 높이 0.5, lh 0.1 → 5층.
//                                          형상 정의 = verify-task0-writer.mjs fixtureFileB (같은 검증을 상시로 돈다)
//     파일 C  task0_C_gap_5L_lh0.1.gcode   10×10 판 두 장(Y 0~0.2, 0.3~0.5), lh 0.1 → 5층, 층 2(0-based)가 빈 층
//
//   쓰기 전에 verify-task0-writer.mjs 의 출력 검사(c1~c7 + c4b 실제 교차 + c8 참조 구간 — c3 은 v0.3.4 리트랙트 상태 기계)와
//   통계 검사를 그대로 돌리고,
//   (Z1-b1) 커버리지 검사기(task0-coverage.ts checkTask0GcodeCoverage)로 **전 층** (a)(b)(c)(d)·넘침 통과를 본다
//   (규격 §3 "도포 영역 = 노광 영역" — G-code 텍스트에서 도포 선분을 다시 뽑아 같은 단면의 마스크와 맞댄다).
//   (Z1-b2) writer 의 채움 실패 층(totals.thinFillFailedLayers)이 하나라도 있어도 실패. A·C 는 채움이 없어야 한다
//   (채움 없는 층은 B안 행 그대로), B 는 채움이 있어야 한다. sha256 고정값은 verify-task0-export.mjs (3) 이 갖는다
//   (Z1-c 값 — Z1-b2 판과의 차이는 파일 첫 도포 앞 E+r 1줄과 머리 메타 두 줄뿐임을 거기서 단언).
//   하나라도 실패하면 **어떤 파일도 쓰지 않고** exit 1.
//   이 스크립트는 검증 목록(verify-*)이 아니다 — 상시 검증은 verify-task0-writer.mjs·verify-task0-coverage.mjs 가 맡는다.
//
//   실행: npx tsx scripts/gen-task0-dryrun.mjs [--out <폴더>]
//     기본 폴더 = OS 임시 폴더/mazicalign-task0. 쓴 경로와 파일별 통계(층 수·빈 층·도포/트래블 길이·
//     리트랙트 수·E 합·줄 수·sha256·채움 조각/점/우회 트래블 수·드라이런 예상 시간)와 커버리지 층별 최악값 요약을 출력한다.
//     드라이런 예상 시간 = XY 이동 길이(도포 + 트래블) ÷ 10 mm/s(드라이런 F600) + E 단독 줄 |E| ÷ 10 mm/s
//       + 도포한 층 × 23 s(파킹 3 + 블레이드 15 + LED 3 + 오버헤드 2 — 협의 §24-3 추정). Z 이동은 뺀다(층당 1초 미만).
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkTask0GcodeCoverage } from "../src/features/v2/utils/task0/task0-coverage.ts";
import { generateTask0Gcode, resolveTask0WriterParams } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
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
];

/** 드라이런 예상 시간 (s) — 머리 주석의 식 */
function dryrunSeconds(result) {
  const t = result.totals;
  const eOnly = (t.retracts + t.unretracts) * result.params.retractMm;
  const layers = t.layerCount - t.emptyLayers.length;
  return (t.depositMm + t.travelMm + eOnly) / DRYRUN_SPEED_MM_S + layers * DRYRUN_LAYER_OVERHEAD_S;
}

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const params = resolveTask0WriterParams();
  console.log("Task0 드라이런 파일 생성 (Z1-a2·Z1-b2·Z1-c, 규격서 v0.3.4)");
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
    const result = generateTask0Gcode(meshes, topY, spec.lh);
    const ctx = {
      name: spec.file,
      meshes,
      topY,
      lh: spec.lh,
      params,
      expectedEmpty: expectedEmptyLayers(spec.fixture.solids, topY, spec.lh),
      fixtureCheck: null,
    };
    const problems = [];
    const res = runOutputChecks(result.gcode, ctx);
    for (const key of Object.keys(CHECK_LABELS)) {
      for (const msg of res[key]) problems.push(`${CHECK_LABELS[key]}: ${msg}`);
    }
    for (const msg of checkStats(result, ctx)) problems.push(`통계: ${msg}`);
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
    const coverage = checkTask0GcodeCoverage(meshes, topY, spec.lh, result.gcode, { depositWidthMm: params.depositWidthMm });
    if (coverage.gcodeLayerCount !== coverage.expectedLayerCount) {
      problems.push(`커버리지: G-code 층 ${coverage.gcodeLayerCount} ≠ 기대 ${coverage.expectedLayerCount}`);
    }
    if (coverage.preambleSegments) problems.push(`커버리지: 프리앰블 도포 ${coverage.preambleSegments}줄`);
    for (const l of coverage.layers.filter((x) => !x.pass).slice(0, 10)) {
      const which = ["a", "b", "c", "d", "overflow"].filter((k) => !l[k].pass).join("·");
      problems.push(`커버리지: 층 ${l.index} FAIL (${which})`);
    }
    if (coverage.failedLayers.length > 10) problems.push(`커버리지: FAIL 층 ${coverage.failedLayers.length}개 (앞 10개만 표시)`);
    console.log(`\n  [${spec.file}] 검사 ${problems.length === 0 ? "통과" : `실패 ${problems.length}건`}`);
    console.log(`    커버리지 ${coverage.pass ? "전 층 통과" : "FAIL"}: ${coverageSummary(coverage)}`);
    for (const p of problems.slice(0, 20)) console.error(`    FAIL: ${p}`);
    if (problems.length) bad++;
    built.push({ spec, result, ctx, coverage });
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
    const sec = dryrunSeconds(result);
    console.log(`    드라이런 예상 약 ${(sec / 60).toFixed(1)}분 (${Math.round(sec)} s — 이동 F600 + 층당 ${DRYRUN_LAYER_OVERHEAD_S} s)`);
    const rt = ctx.retraceReport;
    console.log(`    되짚기(첫 다리가 직전 도포 방향과 90° 넘게 — 통계, 위반 아님): 합 ${rt.total}(같은 직선 겹침 ${rt.collinear}), 층당 최대 ${rt.maxPerLayer}`);
    console.log(`    sha256 ${createHash("sha256").update(result.gcode, "utf8").digest("hex")}`);
    console.log(`    커버리지(전 층 통과): ${coverageSummary(coverage)}`);
  }
  console.log("\n완료");
}

main();
