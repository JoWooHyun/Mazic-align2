// Task0 2재료 writer 벤치마크 (D1a 재작업 — 실패율 측정, 검증 목록 아님: verify-* 가 아니라 상시 판정에 안 들어간다).
//
//   무엇을: generateTask0Gcode(dualMaterial) 가 실사용 형상에서 몇 층을 'failed'(경로 없는 항목 — 쓰는 쪽이 막는 층)로
//     남기는지, 그리고 실패로 보고하지 않은 층에 트래블 교차(c4·c4b — verify-task0-writer 의 독립 검사)가 없는지.
//     ① 두 상자 352 배치 — A 정사각(한 변 7.0~9.0, 높이 1) 오른쪽 위 모서리 옆에 B 상자(3.7 × 4.5), 틈 0.1~1.0, Z 어긋남 −1.0~0
//        (리뷰어 sweep — A 높이가 w 배수가 아니면 맨 위 띠 채움·모서리 점 도포가 생기는 배치)
//     ② 구(지름 6, 바닥 Y 1.0) + 원기둥 서포트 7개(반지름 0.25~0.5, 끝이 구에 0.15~0.45 묻힘) 무작위 30개, **전체 높이**
//     ③ 데모형 — 정육면체 8 mm·구 지름 8·45° 돌린 상자·20° 기울인 판이 자동 서포트 모양(원기둥 기둥 격자, 끝 묻힘) 위에
//   보고: 모델 수, 실패 층이 하나라도 있는 모델 수, 실패 층 / 전체 층, 두 재료 층 수, 우회 트래블 수, 실패로 보고 안 한 층의
//     c4·c4b 위반과 재료별 커버리지 FAIL(task0-coverage checkTask0DualGcodeCoverage — B 우선 포함, 0 이어야), 걸린 시간.
//     실패 모델은 이름과 실패 층 수를 찍는다. 형상 생성기는 verify-task0-dual.mjs 의 것(회귀 픽스처와 같은 식)을 쓴다.
//
//     ④ 닫힌 고리 lh 0.05 — verify-task0-dual (D) 와 같은 판정(closedRingChecks — 전 층 실패 보고, 교차 출력 0, B 커버리지 FAIL)
//   실행: npx tsx scripts/bench-task0-dual.mjs [①~④ 중 고를 번호 1·2·3·4, 기본 전부] [--flip]
//     --flip = dualMaterial.flipOrderWhenStuck (규격 §6 【미정】 "갇힌 층은 B → A" — 기본 끔 옵션, 켜면 얼마나 줄어드는지 측정용)
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";
import { generateTask0Gcode, resolveTask0WriterParams } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import { checkTask0DualGcodeCoverage } from "../src/features/v2/utils/task0/task0-coverage.ts";
import {
  closedRingChecks,
  pillarTriangles,
  sphereOnPillars,
  sphereSeedModel,
  tiltedPlateModel,
  twoBoxMeshes,
} from "./verify-task0-dual.mjs";
import {
  boxTriangles,
  buildModel,
  checkTravelContact,
  checkTravelCrossing,
  meshesTopY,
  rotateTrisY,
} from "./verify-task0-writer.mjs";

const params = resolveTask0WriterParams();
const box = (a, b) => normalizeTriangleWinding(boxTriangles(a, b));
const shift = (t, cx, cy, cz) => t.map((v, j) => (j % 3 === 0 ? v + cx : j % 3 === 1 ? v + cy : v + cz));

/** ① 두 상자 352 배치 */
export function suiteTwoBoxes() {
  const out = [];
  for (let si = 70; si <= 90; si += 2) {
    const s = si / 10;
    for (const gap of [0.1, 0.3, 0.6, 1.0]) {
      for (const dz of [-1.0, -0.9, -0.8, -0.7, -0.6, -0.5, -0.3, 0]) {
        out.push({
          name: `A${s.toFixed(1)} gap${gap} dz${dz}`,
          meshes: () => twoBoxMeshes(s, gap, dz),
          slots: ["A", "B"],
          lh: 0.1,
        });
      }
    }
  }
  return out;
}

/** ② 구(지름 6) + 기둥 7개 무작위 30개 — 전체 높이 */
export function suiteSpherePillars(count = 30) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const m = sphereSeedModel(1000 + k);
    out.push({ name: `sphere-seed${1000 + k}`, meshes: () => m.meshes, slots: m.slots, lh: 0.1 });
  }
  return out;
}

/** ③ 데모형 */
export function suiteDemo() {
  const out = [];
  // 정육면체 8 mm (바닥 Y 1.5) + 3×3 기둥 격자 (반지름 0.4, 끝 0.3 묻힘)
  {
    const meshes = [box([-4, 1.5, -4], [4, 9.5, 4])];
    const slots = ["B"];
    for (const x of [-3, 0, 3]) for (const z of [-3, 0, 3]) {
      meshes.push(normalizeTriangleWinding(pillarTriangles(x, z, 0.4, 0, 1.8)));
      slots.push("A");
    }
    out.push({ name: "demo-cube8-on-grid", meshes: () => meshes, slots, lh: 0.1 });
  }
  // 구 지름 8 (바닥 Y 1.5) + 기둥 7개 (중심·고리 6) 끝 0.3 묻힘
  {
    const pts = [[0, 0, 0.45, 0.3]];
    for (let i = 0; i < 6; i++) pts.push([2.2 * Math.cos((i * Math.PI) / 3), 2.2 * Math.sin((i * Math.PI) / 3), 0.4, 0.3]);
    const s = sphereOnPillars(4, 1.5, pts);
    out.push({ name: "demo-sphere8-on-7", meshes: () => s.meshes, slots: s.slots, lh: 0.1 });
  }
  // 45° 돌린 상자 8 × 6 × 3 (바닥 Y 1.2) + 기둥 5개
  {
    const ang = Math.PI / 4;
    const meshes = [normalizeTriangleWinding(shift(rotateTrisY(boxTriangles([-4, 0, -3], [4, 3, 3]), ang), 0, 1.2, 0))];
    const slots = ["B"];
    for (const [x0, z0] of [[-3, -2], [-3, 2], [0, 0], [3, -2], [3, 2]]) {
      const x = Math.cos(ang) * x0 + Math.sin(ang) * z0;
      const z = -Math.sin(ang) * x0 + Math.cos(ang) * z0;
      meshes.push(normalizeTriangleWinding(pillarTriangles(x, z, 0.45, 0, 1.5)));
      slots.push("A");
    }
    out.push({ name: "demo-rotbox-on-5", meshes: () => meshes, slots, lh: 0.1 });
  }
  // 기울인 판 (10 × 1.5 × 6, Z 축으로 20°) + 4 × 3 기둥 격자 — 두 재료 층이 길게 이어진다 (verify-task0-dual 회귀 픽스처 ⑨ 와 같은 형상)
  {
    const m = tiltedPlateModel();
    out.push({ name: "demo-tilted-plate-on-12", meshes: () => m.meshes, slots: m.slots, lh: 0.1 });
  }
  // 정육면체 8 mm 을 lh 0.05 로 (층이 두 배)
  {
    const meshes = [box([-4, 1.5, -4], [4, 5.5, 4])];
    const slots = ["B"];
    for (const x of [-3, 0, 3]) for (const z of [-3, 0, 3]) {
      meshes.push(normalizeTriangleWinding(pillarTriangles(x, z, 0.35, 0, 1.8)));
      slots.push("A");
    }
    out.push({ name: "demo-cube8x4-on-grid-lh0.05", meshes: () => meshes, slots, lh: 0.05 });
  }
  return out;
}

/** 모델 하나 — 실패 층, 두 재료 층, 우회, 실패로 보고 안 한 층의 c4·c4b 위반 수 */
export function benchModel(m, flip = false) {
  const meshes = m.meshes();
  const topY = meshesTopY(meshes);
  const t0 = Date.now();
  const r = generateTask0Gcode(meshes, topY, m.lh, { dualMaterial: { slots: m.slots, flipOrderWhenStuck: flip } });
  const ms = Date.now() - t0;
  const failed = new Set(r.totals.thinFillFailedLayers);
  const model = buildModel(r.gcode, [params.parkXMm, params.parkYMm]);
  const okModel = { ...model, layers: model.layers.filter((l) => !failed.has(l.index)) };
  const ctx = { params, lh: m.lh };
  const count = (list) => list.reduce((acc, msg) => acc + Number(/×(\d+)/.exec(msg)?.[1] ?? 1), 0);
  const c4 = count(checkTravelCrossing(okModel, ctx));
  const c4b = count(checkTravelContact(okModel, ctx));
  // 재료별 커버리지·B 우선 — 실패로 보고 안 한 층에서 FAIL 이 있으면 안 된다
  const cov = checkTask0DualGcodeCoverage(meshes, m.slots, topY, m.lh, r.gcode, { depositWidthMm: params.depositWidthMm });
  const covBad = cov.failedLayers.filter((n) => !failed.has(n)).length;
  return {
    name: m.name,
    layers: r.totals.layerCount,
    failed: failed.size,
    both: r.layers.filter((s) => s.byTool[0].segments > 0 && s.byTool[1].segments > 0).length,
    detours: r.totals.detourTravels,
    flips: r.layers.filter((s) => s.orderFlipped).length,
    c4,
    c4b,
    covBad,
    overlap: cov.overlapSamplesA,
    ms,
  };
}

export function benchSuite(label, models, flip = false) {
  const t0 = Date.now();
  const rows = models.map((m) => benchModel(m, flip));
  const sum = (k) => rows.reduce((acc, r) => acc + r[k], 0);
  const bad = rows.filter((r) => r.failed > 0);
  const summary = {
    label,
    models: rows.length,
    failedModels: bad.length,
    layers: sum("layers"),
    failedLayers: sum("failed"),
    bothLayers: sum("both"),
    detours: sum("detours"),
    flips: sum("flips"),
    c4: sum("c4"),
    c4b: sum("c4b"),
    covBad: sum("covBad"),
    overlap: sum("overlap"),
    sec: (Date.now() - t0) / 1000,
  };
  return { summary, rows, bad };
}

function printSuite({ summary: s, bad }) {
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(2)}%` : "—");
  console.log(
    `${s.label}: 모델 ${s.models}, 실패 모델 ${s.failedModels} (${pct(s.failedModels, s.models)}), ` +
      `실패 층 ${s.failedLayers}/${s.layers} (${pct(s.failedLayers, s.layers)}), 두 재료 층 ${s.bothLayers}, 우회 ${s.detours}` +
      (s.flips ? `, 순서 뒤집은 층 ${s.flips}` : "") +
      `, 실패 아닌 층의 c4 ${s.c4}·c4b ${s.c4b}·커버리지 FAIL ${s.covBad}, B 우선 위반 표본 ${s.overlap}, ${s.sec.toFixed(1)} s`,
  );
  for (const b of bad.slice(0, 20)) console.log(`    실패: ${b.name} — 실패 층 ${b.failed}/${b.layers}`);
}

function main() {
  const args = process.argv.slice(2);
  const flip = args.includes("--flip");
  const pick = args.filter((a) => /^[1234]$/.test(a));
  const want = (k) => pick.length === 0 || pick.includes(k);
  console.log(`Task0 2재료 벤치마크${flip ? " (flipOrderWhenStuck 켬)" : ""}`);
  if (want("1")) printSuite(benchSuite("① 두 상자 352 배치", suiteTwoBoxes(), flip));
  if (want("2")) printSuite(benchSuite("② 구 지름 6 + 기둥 7 무작위 30 (전체 높이)", suiteSpherePillars(), flip));
  if (want("3")) printSuite(benchSuite("③ 데모형 (정육면체·구·돌린 상자 + 기둥 서포트)", suiteDemo(), flip));
  if (want("4")) {
    // ④ 닫힌 고리 lh 0.05 — verify-task0-dual (D) 의 lh 0.1 과 같은 판정(실패 보고·교차 출력 없음)을 여기서 (오래 걸려 verify 에서 뺌)
    console.log("④ 닫힌 고리 lh 0.05 (A→B 로는 길 없음 — 전 층 실패로 보고되고 교차 출력이 없어야):");
    let bad = 0;
    for (const { ok, msg } of closedRingChecks(0.05, params)) {
      if (!ok) bad++;
      console.log(`  ${ok ? "ok" : "NG"}: ${msg}`);
    }
    console.log(`  판정 ${bad === 0 ? "유지" : `어긋남 ${bad}건`}`);
  }
}

const isMain = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMain) main();
