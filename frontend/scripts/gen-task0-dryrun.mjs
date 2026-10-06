// Task0 드라이런 파일 생성 (로드맵 0절 2주차 PR-1 Z1-a2 — 10/7 Task0 프린터 드라이런용).
//
//   만드는 것 (writer = src/features/v2/utils/task0/task0-gcode-writer.ts, 규격서 v0.3.3):
//     파일 A  task0_A_cube10_lh0.1.gcode   10 mm 정육면체, 출력 가능 영역 가운데(베드 (80, 47.5) = world x 5, z 5),
//                                          바닥 Y 0, lh 0.1 → 100층
//     파일 C  task0_C_gap_5L_lh0.1.gcode   10×10 판 두 장(Y 0~0.2, 0.3~0.5), lh 0.1 → 5층, 층 2(0-based)가 빈 층
//     (파일 B — 얇은 링·띠 — 는 Z1-b 의 중심선 도포가 필요해서 아직 만들지 않는다.)
//
//   쓰기 전에 verify-task0-writer.mjs 의 출력 검사(c1~c7 + c8 참조 구간)와 통계 검사를 그대로 돌린다.
//   하나라도 실패하면 **어떤 파일도 쓰지 않고** exit 1.
//   이 스크립트는 검증 목록(verify-*)이 아니다 — 상시 검증은 verify-task0-writer.mjs 가 맡는다.
//
//   실행: npx tsx scripts/gen-task0-dryrun.mjs [--out <폴더>]
//     기본 폴더 = OS 임시 폴더/mazicalign-task0. 쓴 경로와 파일별 통계(층 수·빈 층·도포/트래블 길이·
//     리트랙트 수·E 합·줄 수)를 출력한다.
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generateTask0Gcode, resolveTask0WriterParams } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import {
  CHECK_LABELS,
  checkStats,
  expectedEmptyLayers,
  fixtureCube10,
  fixtureGapPlates,
  meshesTopY,
  runOutputChecks,
} from "./verify-task0-writer.mjs";

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
  { file: "task0_A_cube10_lh0.1.gcode", fixture: fixtureCube10(), lh: 0.1, expectLayers: 100, expectEmpty: [] },
  { file: "task0_C_gap_5L_lh0.1.gcode", fixture: fixtureGapPlates(), lh: 0.1, expectLayers: 5, expectEmpty: [2] },
];

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const params = resolveTask0WriterParams();
  console.log("Task0 드라이런 파일 생성 (Z1-a2, 규격서 v0.3.3)");
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
    console.log(`\n  [${spec.file}] 검사 ${problems.length === 0 ? "통과" : `실패 ${problems.length}건`}`);
    for (const p of problems.slice(0, 20)) console.error(`    FAIL: ${p}`);
    if (problems.length) bad++;
    built.push({ spec, result, ctx });
  }
  if (bad) {
    console.error(`\n검사 실패 ${bad}개 파일 — 아무 파일도 쓰지 않음`);
    process.exit(1);
  }

  // 2) 쓰기 (\n 줄바꿈 그대로, BOM 없음)
  fs.mkdirSync(out, { recursive: true });
  console.log(`\n출력 폴더: ${out}`);
  for (const { spec, result, ctx } of built) {
    const file = path.join(out, spec.file);
    fs.writeFileSync(file, result.gcode, "utf8");
    const t = result.totals;
    console.log(`\n  ${file}`);
    console.log(`    층 수 ${t.layerCount} (topY ${ctx.topY} mm, lh ${spec.lh} mm), 빈 층 ${JSON.stringify(t.emptyLayers)}`);
    console.log(`    도포 ${t.depositMm.toFixed(3)} mm (${t.segments}줄), 트래블 ${t.travelMm.toFixed(3)} mm (층 첫 트래블은 파킹 (0,0)부터)`);
    console.log(`    리트랙트 E-r ${t.retracts} / 언리트랙트 E+r ${t.unretracts}, 도포 E 합 ${t.extrusionMm.toFixed(5)} mm (정확 ${t.extrusionExactMm.toFixed(7)})`);
    console.log(`    줄 수 ${t.lineCount}, 크기 ${Buffer.byteLength(result.gcode, "utf8")} B, XY 범위 ` +
      (t.xyBounds ? `X ${t.xyBounds.xMin}~${t.xyBounds.xMax} × Y ${t.xyBounds.yMin}~${t.xyBounds.yMax}` : "없음"));
  }
  console.log("\n완료");
}

main();
