// Task0 2재료 앱 내보내기(D1b) 헤드리스 검증 — 파일별 재료 지정 · 앱 run.gcode/job.zip 2재료 · manifest 2재료 · 막힘 이유 ·
// 데이터(repo 왕복) · 배선 · 대조군 · 단일 재료 바이트 불변.
//
//   무엇을: D1b 에서 앱에 붙인 2재료 경로.
//     src/features/v2/utils/task0/task0-material.ts  재료 모드·STL 재료 슬롯 기본값, 메시마다 슬롯(서포트 = A, STL = materialSlot·기본 B)
//     src/features/v2/utils/task0/task0-export.ts    코어 materialSlots → writer dualMaterial, 2재료 자기 검사(재료별 커버리지·B 우선·
//       트래블 엄격 판정), writer 실패 층 이유 가르기(갇힌 B 등), 요약 dual
//     src/features/v2/utils/task0/task0-jobzip.ts    manifest materials 2개·dualMaterial·toolChangeCount = writer 툴 전환 수,
//       estimate toolChangeSec, 층 노광 = 재료별 큰 값(buildTask0MaterialExposure)
//     + 데이터(types/stl.ts materialSlot?·types/project.ts task0MaterialMode? — data/*.repo.ts 경유), 배선(소스 검사): 씬 handle
//       getSliceGeometry 메시 정체·setMaterialSlotColors, 워커·메시지, useSliceExport, useTask0Material, 패널·목록·페이지.
//   규격 = Task0 리포 docs/Task0_Gcode_규격서_초안.md v0.3.4 @ a4ebc6c §5(툴별 리트랙트)·§6(A = T0, B = T1, 층 안 A → B, 노광 큰 값)·
//   §11(manifest materials[]·dualMaterial·toolChangeCount)·§13(toolChangeSec 0.5). 설계 = docs/계획_Z1_task0출력_20261002.md §4-5(D1b 인계),
//   docs/계획_하이브리드슬라이서설정_20260928.md §5-1·§5-2·§5-3·§6 결정 5.
//
//   (1) 앱 경로 = 스크립트 경로 — 파일 D 형상(서포트 기둥 4 + 판, verify-task0-dual fixtureDualPillarsPlate)을 **앱 순서**(씬 handle
//       getSliceGeometry 와 같이 STL 먼저·서포트 뒤, 메시 정체 kind·stlId 붙임)로 만들고 슬롯은 task0ExportMaterialSlots('dual', …)로 →
//       코어 run.gcode = gen-task0-dryrun 파일 D(generateTask0Gcode 직접 호출, 형상 순서)와 **같은 바이트**(sha256 53730df7…),
//       job.zip: run.gcode 같은 바이트·manifest materials 2개(A T0 모델레진 / B T1 템프레진, 노광 = DEFAULT_*)·dualMaterial true·
//       toolChangeCount 3·estimate toolChangeSec = 3 × 0.5·estimate = 화면 요약, 층 PNG 전부 = 합집합 마스크(task0-mask, 모든 메시) × 255
//       (두 재료가 다 있는 층은 A 만·B 만 마스크보다 흰 픽셀이 많음), verifyTask0JobZip(전부 풀기) 위반 0, 견본 경로 buildTask0JobZip
//       (writer dualMaterial) 과 같은 zip 바이트, zip sha256 고정값.
//   (1b) 실제 워커 모듈 — slice-batch.worker.ts 를 가짜 self 로 불러 앱과 같은 모양의 메시지(meshes = 메시 정체가 붙은 항목, materialSlots)
//       → task0-gcode 의 gcode = 파일 D 바이트, task0-jobzip 의 zip = (1) 의 zip 바이트.
//   (2) 단일 모드·재료 정보 없음 → 기존 바이트 — task0ExportMaterialSlots('single') = undefined(STL 에 materialSlot 'A' 가 있어도),
//       코어 run.gcode 파일 A·C·B sha256 = Z1-c 고정값(verify-task0-export 와 같은 값), materialSlots: undefined 키도 같음, 요약 dual null·
//       툴 전환 0, 견본 job.zip sha256 616b0e61…(verify-task0-jobzip-export 와 같은 값). 마스크 ZIP·marlin 은 Node 에서 못 돌린다
//       (OffscreenCanvas·js-clipper) → (6) 에서 소스로: getSliceGeometry 의 삼각형·순서 그대로, 워커 마스크·marlin 경로는 triangles 만 읽음.
//   (3) 슬롯 결정 — task0MeshSlots: 서포트는 붙은 STL 이 B 여도 A, STL materialSlot 없음 → B, 'A' → A, 모르는 값·목록에 없는 STL → B.
//       코어로: 왼쪽 상자(A 지정) + 오른쪽 상자(지정 없음) + 오른쪽에 붙은 서포트 기둥 → T0 도포는 왼쪽 상자·기둥 자리만, T1 은 오른쪽 상자만.
//   (4) 막힘 — ① 갇힌 B(닫힌 고리 A + 안의 B, verify-task0-dual fixtureClosedRing): run.gcode·job.zip 둘 다 파일 없음, 이유
//       "재료 B(T1)가 재료 A(T0)에 둘러싸여 … 협의 §31-4", 문제 층 = 전 층 ② 출력 가능 영역 밖(2재료 입력을 베드 X 밖으로) → writer 전에
//       같은 영역 문구 ③ 슬롯 수 ≠ 메시 수 → 이유 ④ 2재료 자기 검사 — writer 대조군 옵션으로 만든 위반 출력:
//       겹침 차집합 끔(subtractOverlap false) → "B 우선 위반", 우회 끔(thinFillDetour false, U 자 A 안의 B) → "트래블이 칠한 레진을 가로지르거나".
//   (5) 데이터 — 가짜 IndexedDB(이 스크립트 안, 스토어·인덱스·커서만)에 data/*.repo.ts 를 그대로 돌림: DB 버전 4·스토어 3개·인덱스 그대로,
//       새 프로젝트·STL 레코드에는 새 필드 없음(기본값 single·B), updateProject/updateStlFile 로 저장 → 다시 읽어 그 값, transform 과 함께
//       보존, 옛 레코드(putProject/putStlFile 필드 없음) → 기본값, 저장한 슬롯으로 task0ExportMaterialSlots, .mzalign 내보내기 → 가져오기('new')
//       에도 두 필드 보존. 노광 큰 값 규칙(buildTask0MaterialExposure — 같으면 단일과 같은 값·경고 없음, 다르면 층마다 큰 값·경고), 코어에
//       exposureB 를 주면 manifest 재료별 값·exposure.json 큰 값·요약 경고.
//   (6) 배선(소스) — 씬 handle·워커·메시지·useSliceExport(두 Task0 핸들러가 materialSlots 를 넘기고 deps 에 재료 모드·files — 규칙 7,
//       무효화 deps 에 재료 모드)·useTask0Material(repo 경유·3D 색은 슬라이스 화면 2재료일 때만)·패널·목록·페이지·컴포넌트에 IndexedDB 직접 접근 없음.
//   (7) 대조군 — a. 서포트 슬롯을 B 로 바꾼 task0-material → (1) 의 파일 D 바이트·(3) 의 "서포트 = A" 가 실패
//       b. job.zip 의 toolChangeCount 를 0 으로 고정한 task0-jobzip(+ 그것을 쓰는 코어) → 파일 D job.zip 이 막히고(자기 검사 — 툴 전환 수
//          불일치) 견본 경로 zip 은 검사기가 잡는다 c. 코어에서 2재료 자기 검사를 빼면 (4)④ 의 B 우선 위반·교차 트래블 출력이 파일로 나온다
//       d. 트래블 검사만 빼면 교차 출력이 나오고 B 우선 위반은 여전히 막힌다(두 검사가 각각 필요) e. 갇힌 B 판정을 빼면 이유가 엉뚱한
//          "두 재료가 맞물린 단면" 으로 바뀐다(D2 — 판정이 writer 통계 기반, 그 전에는 "얇은 부분 채움 실패" 였다) f. deps 에서 재료 모드·files 를 빼거나 무효화 deps 에서 재료 모드를 빼면 (6) 이 실패한다
//       g. 슬롯 입력을 무시하는 코어(D1b 이전 동작) → 단일 재료 파일이 나와 (1) 의 파일 D 바이트·manifest 2재료가 실패.
//       (수정 전 트리 전체로 돌리면 task0-material.ts 가 없어 import 단계에서 exit 1 — 구현 확인 때 실측.)
//   (8) 성능 참고 — TASK0_PERF=1 일 때만(판정 없음): 2재료 job.zip — 파일 D 형상, 구 + 기둥 서포트(verify-task0-dual sphereSeedModel) 단계별 시간.
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "변조"·"FAIL" 같은 문자열을 출력할 수 있다.
//   실행: npx tsx scripts/verify-task0-dual-export.mjs   (선택) TASK0_PERF=1
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_BOTTOM_EXPOSURE_SEC,
  DEFAULT_EXPOSURE_SEC,
} from "../src/features/v2/types/printer.ts";
import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";
import { extractTask0DepositSegments } from "../src/features/v2/utils/task0/task0-coverage.ts";
import { TASK0_DEFAULTS, TASK0_TIME_CONSTANTS } from "../src/features/v2/utils/task0/task0-frame.ts";
import { generateTask0Gcode } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import {
  TASK0_APP_JOB_GENERATOR,
  runTask0GcodeExport,
  runTask0JobZipExport,
} from "../src/features/v2/utils/task0/task0-export.ts";
import {
  TASK0_DEFAULT_MATERIAL_NAME,
  TASK0_DEFAULT_MATERIAL_NAME_B,
  buildTask0Exposure,
  buildTask0JobZip,
  buildTask0MaterialExposure,
  readTask0ZipEntries,
  task0LayerPngName,
  verifyTask0JobZip,
} from "../src/features/v2/utils/task0/task0-jobzip.ts";
import {
  TASK0_SLOT_COLOR_HEX,
  resolveStlMaterialSlot,
  resolveTask0MaterialMode,
  task0ExportMaterialSlots,
  task0MeshSlots,
  task0SlotColorRgb,
} from "../src/features/v2/utils/task0/task0-material.ts";
import { rasterizeTask0Mask } from "../src/features/v2/utils/task0/task0-mask.ts";
import { decodeTask0GrayPng } from "../src/features/v2/utils/task0/task0-png.ts";
import { task0LayerPolygonsBed, task0SplitMeshesBySlot } from "../src/features/v2/utils/task0/task0-slice.ts";
import {
  TASK0_BUILT_IN_PROFILE,
  task0PrintableFrameForProfile,
  task0RasterFrameForProfile,
  task0WriterOptionsForProfile,
} from "../src/features/v2/utils/task0/task0-profile.ts";
import { profileExposure } from "../src/features/v2/pages/viewer/utils/profile-exposure.ts";
import {
  SAMPLE_EXPOSURE,
  SAMPLE_GENERATED_AT,
  SAMPLE_LH,
  SAMPLE_TOP_Y,
  sampleMeshes,
} from "./gen-task0-sample-zip.mjs";
import { fixtureClosedRing, fixtureDualPillarsPlate, sphereSeedModel } from "./verify-task0-dual.mjs";
import {
  boxTriangles,
  fixtureCube10,
  fixtureFileB,
  fixtureGapPlates,
  meshesTopY,
} from "./verify-task0-writer.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(SCRIPT_DIR, "..", "src", "features", "v2");
const TASK0_SRC = path.join(V2, "utils", "task0");

/** gen-task0-dryrun.mjs 파일 D (D1a — 서포트 기둥 A + 판 B, lh 0.1, 툴 전환 3) sha256 */
const FILE_D_SHA = "53730df71c6a7d984615962e9228c9a6a54636e84941d6b69310334f9ee28faa";
/** 파일 A·C·B (Z1-c, 규격 v0.3.4) sha256 — verify-task0-export.mjs EXPECTED_SHA 와 같은 값 */
const SINGLE_SHA = {
  cube10: "dde08ea97b2e144dabc842d1257980bdd4d51fa59b7bf7453c463e5f264928b9",
  "gap-plates": "ab3f8d7431386b5deaa3a4f44df09dfe1b0b1f0ac82303423cc63ccac76d7859",
  "file-b": "b1e65f70c96a3e5cee17a97c27d8b2bb029faa8e82791bca2ef09361098a8339",
};
/** 견본 sample.job.zip (Z1-c) sha256 — verify-task0-jobzip-export.mjs SAMPLE_SHA 와 같은 값 */
const SAMPLE_SHA = "616b0e610dfa0a101f357d2a8a30bdb7f3823ddd773350ffe40682f7c8192989";
/** (1) 2재료 job.zip (파일 D 형상, 앱 generator, generatedAt D_GENERATED_AT) sha256 — 이 PR(D1b)에서 처음 정한 값 */
const DUAL_ZIP_SHA = "e9edb893e4e0b40e271ebfda9dcdfb4885859087a64c549fccffbe407ce26050";
const D_GENERATED_AT = "2026-10-07T00:00:00.000Z";
const D_LH = 0.1;

const P = TASK0_BUILT_IN_PROFILE;
const APP = {
  writer: task0WriterOptionsForProfile(P),
  frame: task0RasterFrameForProfile(P),
  printable: task0PrintableFrameForProfile(P),
  exposure: profileExposure(P),
};

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

const sha256 = (data) => createHash("sha256").update(typeof data === "string" ? data : Buffer.from(data)).digest("hex");
const dec = new TextDecoder();
const box = (min, max) => normalizeTriangleWinding(boxTriangles(min, max));

async function zipEntries(bytes) {
  return new Map((await readTask0ZipEntries(bytes)).map((e) => [e.name, e.data]));
}

// ── 입력 만들기 ──────────────────────────────────────────────────────────

/**
 * 파일 D 형상을 앱 순서로 — 씬 handle getSliceGeometry 처럼 STL(판) 먼저, 서포트(기둥 4) 뒤, 항목마다 kind·stlId.
 * files = 판 STL 레코드 하나(materialSlot 없음 → B). 형상 순서(기둥 먼저)와 같은 바이트가 나와야 한다(슬롯별 순서는 같다).
 */
function appItemsD() {
  const fx = fixtureDualPillarsPlate();
  const m = fx.meshes(); // [기둥 4, 판]
  const items = [
    { triangles: m[4], kind: "stl", stlId: "plate" },
    ...m.slice(0, 4).map((t) => ({ triangles: t, kind: "support", stlId: "plate" })),
  ];
  const files = [{ id: "plate", fileName: "plate.stl" }];
  return { fx, scriptMeshes: m, items, files };
}

/** 코어 입력 (앱이 워커에 넘기는 값과 같은 출처) */
function coreInput(items, slots, extra = {}) {
  const meshes = items.map((it) => it.triangles);
  return {
    meshes,
    topY: meshesTopY(meshes),
    layerHeightMm: D_LH,
    writer: APP.writer,
    exposure: APP.exposure,
    printable: APP.printable,
    materialSlots: slots,
    ...extra,
  };
}

/** 층 PNG 전부를 합집합 마스크(모든 메시)와 비교 — [{ n, diff, white }] */
async function compareUnionMasks(entries, meshes, lh, layerCount) {
  const out = [];
  for (let n = 0; n < layerCount; n++) {
    const data = entries.get(task0LayerPngName(n));
    if (!data) {
      out.push({ n, diff: -1, white: 0 });
      continue;
    }
    const img = await decodeTask0GrayPng(data);
    const mask = rasterizeTask0Mask(task0LayerPolygonsBed(meshes, n, lh, APP.writer.bedWidthMm, APP.writer.bedDepthMm), { frame: APP.frame });
    let diff = img.width === mask.width && img.height === mask.height ? 0 : -1;
    if (diff === 0) for (let i = 0; i < img.data.length; i++) if (img.data[i] !== (mask.data[i] ? 255 : 0)) diff++;
    out.push({ n, diff, white: mask.whitePixels });
  }
  return out;
}

// ── (1) 앱 경로 = 스크립트 경로 ───────────────────────────────────────────

async function sectionAppPath() {
  console.log("\n(1) 앱 경로 = 스크립트 경로 — 파일 D 형상(서포트 기둥 A + 판 B)");
  const { fx, scriptMeshes, items, files } = appItemsD();
  const slots = task0ExportMaterialSlots("dual", items, files);
  assert(JSON.stringify(slots) === '["B","A","A","A","A"]', `앱 순서 슬롯 ${JSON.stringify(slots)} — 판(STL, 지정 없음) B, 서포트 기둥 4개 A`);

  // 스크립트 경로 = gen-task0-dryrun 파일 D (형상 순서·writer 기본값)
  const script = generateTask0Gcode(scriptMeshes, meshesTopY(scriptMeshes), D_LH, { dualMaterial: { slots: fx.slots } });
  assert(sha256(script.gcode) === FILE_D_SHA, `스크립트 경로(generateTask0Gcode 직접) = 파일 D sha256 ${sha256(script.gcode).slice(0, 16)}…`);

  const g = runTask0GcodeExport(coreInput(items, slots));
  assert(g.ok && g.gcode === script.gcode, `코어 run.gcode = 파일 D 같은 바이트 (${g.ok ? sha256(g.gcode).slice(0, 16) : g.issues[0]}…)`);
  const d = g.ok ? g.summary.dual : null;
  assert(
    d !== null && d.toolChanges === 3 && d.meshCount.A === 4 && d.meshCount.B === 1 && d.warnings.length === 0 &&
      Math.abs(d.depositMmByTool[0] - script.totals.byTool[0].depositMm) < 1e-9 &&
      Math.abs(d.depositMmByTool[1] - script.totals.byTool[1].depositMm) < 1e-9,
    `요약 dual: 툴 전환 ${d?.toolChanges}, 메시 A ${d?.meshCount.A}·B ${d?.meshCount.B}, 도포 T0 ${d?.depositMmByTool[0].toFixed(1)} / T1 ${d?.depositMmByTool[1].toFixed(1)} mm, 알림 ${d?.warnings.length}`,
  );
  assert(
    g.ok && g.summary.estimate.toolChangeSec === 3 * TASK0_TIME_CONSTANTS.toolChangeSec,
    `요약 estimate toolChangeSec ${g.ok ? g.summary.estimate.toolChangeSec : "?"} = 3 × ${TASK0_TIME_CONSTANTS.toolChangeSec} s (규격 §13)`,
  );

  const j = await runTask0JobZipExport(coreInput(items, slots, { frame: APP.frame, generator: TASK0_APP_JOB_GENERATOR, generatedAt: D_GENERATED_AT }));
  assert(j.ok, `코어 job.zip 통과 ${j.ok ? `(${j.job.pngCount}장, ${j.job.zipBytes} B)` : JSON.stringify(j.issues)}`);
  if (!j.ok) return null;
  const e = await zipEntries(j.zip);
  assert(sha256(e.get("run.gcode")) === FILE_D_SHA, "job.zip 의 run.gcode = 파일 D 같은 바이트");
  const man = JSON.parse(dec.decode(e.get("manifest.json")));
  const mats = man.materials;
  assert(
    Array.isArray(mats) && mats.length === 2 &&
      JSON.stringify(mats[0]) ===
        JSON.stringify({ slot: "A", tool: "T0", name: TASK0_DEFAULT_MATERIAL_NAME, exposureSec: DEFAULT_EXPOSURE_SEC, bottomExposureSec: DEFAULT_BOTTOM_EXPOSURE_SEC, retractMm: 1 }) &&
      JSON.stringify(mats[1]) ===
        JSON.stringify({ slot: "B", tool: "T1", name: TASK0_DEFAULT_MATERIAL_NAME_B, exposureSec: DEFAULT_EXPOSURE_SEC, bottomExposureSec: DEFAULT_BOTTOM_EXPOSURE_SEC, retractMm: 1 }),
    `manifest materials 2개 — ${JSON.stringify(mats)}`,
  );
  assert(man.dualMaterial === true && man.toolChangeCount === 3, `manifest dualMaterial ${man.dualMaterial}, toolChangeCount ${man.toolChangeCount} (= run.gcode T 전환 3)`);
  assert(
    man.estimate.toolChangeSec === 1.5 && JSON.stringify(man.estimate) === JSON.stringify(j.summary.estimate),
    `manifest estimate toolChangeSec ${man.estimate.toolChangeSec} = 3 × 0.5, estimate = 화면 요약 (총 ${man.estimate.totalSec} s)`,
  );
  const exp = JSON.parse(dec.decode(e.get("exposure.json")));
  assert(
    JSON.stringify(exp) === JSON.stringify(buildTask0Exposure(10, D_LH, APP.exposure ?? {})),
    "exposure.json = 단일 재료와 같은 일정 (두 재료 노광이 한 프로파일이라 같은 값 — 큰 값 = 그 값)",
  );
  const allMeshes = items.map((it) => it.triangles);
  const cmp = await compareUnionMasks(e, allMeshes, D_LH, 10);
  assert(cmp.every((c) => c.diff === 0 && c.white > 0), `층 PNG 10장 전부 = 합집합 마스크(모든 메시) × 255 (차이 ${cmp.map((c) => c.diff).join(",")})`);
  const split = task0SplitMeshesBySlot(allMeshes, slots);
  const whiteOf = (ms, n) => rasterizeTask0Mask(task0LayerPolygonsBed(ms, n, D_LH, 150, 85), { frame: APP.frame }).whitePixels;
  const both = [4, 5].map((n) => ({ n, u: cmp[n].white, a: whiteOf(split.A, n), b: whiteOf(split.B, n) }));
  assert(
    both.every((x) => x.u > x.a && x.u > x.b && x.a > 0 && x.b > 0),
    `두 재료 층(4·5) PNG = A ∪ B — 흰 픽셀 ${both.map((x) => `층 ${x.n}: 합 ${x.u} > A ${x.a}, B ${x.b}`).join(" / ")}`,
  );
  const rep = await verifyTask0JobZip(j.zip);
  assert(rep.pass && rep.violations.length === 0 && rep.extraIssues.length === 0, `verifyTask0JobZip(전부 풀기) 위반 ${rep.violations.length}·추가 ${rep.extraIssues.length}`);
  // 견본 경로 buildTask0JobZip(writer dualMaterial) — 같은 조립 함수라 같은 zip 바이트
  const sp = await buildTask0JobZip({
    meshes: allMeshes,
    topY: meshesTopY(allMeshes),
    layerHeightMm: D_LH,
    writer: { ...APP.writer, dualMaterial: { slots } },
    exposure: APP.exposure,
    generator: TASK0_APP_JOB_GENERATOR,
    generatedAt: D_GENERATED_AT,
  });
  assert(sha256(sp.bytes) === sha256(j.zip), `견본 경로 buildTask0JobZip(writer dualMaterial) = 코어 zip 같은 바이트 (${sha256(j.zip).slice(0, 16)}…)`);
  assert(sha256(j.zip) === DUAL_ZIP_SHA, `2재료 job.zip sha256 고정값 (${sha256(j.zip)})`);
  return { items, slots, gcode: g.ok ? g.gcode : null, zip: j.zip };
}

// ── (1b) 실제 워커 모듈 ──────────────────────────────────────────────────

async function sectionWorkerModule(ref) {
  console.log("\n(1b) 실제 워커 모듈(slice-batch.worker.ts)에 앱과 같은 모양의 2재료 메시지");
  const posted = [];
  let handler = null;
  const hadSelf = Object.prototype.hasOwnProperty.call(globalThis, "self");
  const prevSelf = globalThis.self;
  globalThis.self = {
    addEventListener: (type, fn) => {
      if (type === "message") handler = fn;
    },
    postMessage: (m) => posted.push(m),
  };
  try {
    await import(pathToFileURL(path.join(V2, "workers", "slice-batch.worker.ts")).href);
  } finally {
    if (hadSelf) globalThis.self = prevSelf;
    else delete globalThis.self;
  }
  assert(typeof handler === "function", "워커 모듈이 message 리스너를 등록");
  if (typeof handler !== "function" || ref === null) return;
  const { items, slots } = ref;
  const meshes = items.map((it) => ({ ...it })); // 앱: handle.getSliceGeometry() 항목을 그대로 (kind·stlId 붙은 채)
  const topY = meshesTopY(items.map((it) => it.triangles));
  posted.length = 0;
  await handler({ data: { kind: "task0-gcode", meshes, topY, layerHeightMm: D_LH, writer: APP.writer, exposure: APP.exposure, printable: APP.printable, materialSlots: slots } });
  const gd = posted.find((m) => m.type === "task0-done");
  assert(gd?.result.ok && sha256(gd.result.gcode) === FILE_D_SHA && gd.result.summary.dual?.toolChanges === 3, `task0-gcode → 파일 D 같은 바이트, 요약 툴 전환 ${gd?.result.summary?.dual?.toolChanges}`);
  posted.length = 0;
  await handler({
    data: {
      kind: "task0-jobzip",
      meshes,
      topY,
      layerHeightMm: D_LH,
      writer: APP.writer,
      exposure: APP.exposure,
      frame: APP.frame,
      printable: APP.printable,
      generator: TASK0_APP_JOB_GENERATOR,
      generatedAt: D_GENERATED_AT,
      materialSlots: slots,
    },
  });
  const jd = posted.find((m) => m.type === "task0-job-done");
  assert(jd?.result.ok && sha256(jd.result.zip) === sha256(ref.zip) && !posted.some((m) => m.type === "error"), "task0-jobzip → (1) 의 2재료 zip 과 같은 바이트");
  posted.length = 0;
  await handler({ data: { kind: "task0-gcode", meshes, topY, layerHeightMm: D_LH, writer: APP.writer, printable: APP.printable } });
  const sd = posted.find((m) => m.type === "task0-done");
  assert(sd?.result.ok && sd.result.summary.dual === null && sha256(sd.result.gcode) !== FILE_D_SHA && !/^T1$/m.test(sd.result.gcode), "materialSlots 없는 메시지 → 단일 재료(T1 줄 없음, dual null)");
}

// ── (2) 단일 모드 · 재료 정보 없음 → 기존 바이트 ─────────────────────────

async function sectionSingle() {
  console.log("\n(2) 단일 모드·재료 정보 없음 → 기존 바이트");
  const { items } = appItemsD();
  const filesA = [{ id: "plate", fileName: "plate.stl", materialSlot: "A" }];
  assert(task0ExportMaterialSlots("single", items, filesA) === undefined, "재료 모드 단일 → 슬롯 없음(STL 에 materialSlot 'A' 가 있어도)");
  assert(
    resolveTask0MaterialMode(undefined) === "single" && resolveTask0MaterialMode({}) === "single" && resolveTask0MaterialMode({ task0MaterialMode: "x" }) === "single" &&
      resolveTask0MaterialMode({ task0MaterialMode: "dual" }) === "dual",
    "재료 모드 기본값 = 단일 (필드 없음·모르는 값), 'dual' 은 그대로",
  );
  for (const fx of [fixtureCube10(), fixtureGapPlates(), fixtureFileB()]) {
    const meshes = fx.meshes();
    const base = { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1, writer: APP.writer, exposure: APP.exposure, printable: APP.printable };
    const r = runTask0GcodeExport(base);
    const r2 = runTask0GcodeExport({ ...base, materialSlots: undefined });
    assert(
      r.ok && sha256(r.gcode) === SINGLE_SHA[fx.name] && r2.ok && r2.gcode === r.gcode && r.summary.dual === null && r.summary.estimate.toolChangeSec === 0,
      `${fx.name}: 코어 run.gcode sha256 = Z1-c 고정값 (${r.ok ? sha256(r.gcode).slice(0, 16) : "막힘"}…), materialSlots: undefined 도 같은 바이트, dual null, 툴 전환 0 s`,
    );
  }
  const sample = {
    meshes: sampleMeshes(),
    topY: SAMPLE_TOP_Y,
    layerHeightMm: SAMPLE_LH,
    exposure: SAMPLE_EXPOSURE,
    generatedAt: SAMPLE_GENERATED_AT,
    writer: APP.writer,
    frame: APP.frame,
    printable: APP.printable,
  };
  const s1 = await runTask0JobZipExport(sample);
  const s2 = await runTask0JobZipExport({ ...sample, materialSlots: undefined });
  assert(s1.ok && sha256(s1.zip) === SAMPLE_SHA && s2.ok && sha256(s2.zip) === SAMPLE_SHA, `견본 입력 → 코어 job.zip = sample.job.zip 같은 바이트 (${s1.ok ? sha256(s1.zip).slice(0, 16) : "막힘"}…)`);
  if (s1.ok) {
    const man = JSON.parse(dec.decode((await zipEntries(s1.zip)).get("manifest.json")));
    assert(man.materials.length === 1 && man.dualMaterial === false && man.toolChangeCount === 0, "견본 manifest = 단일 재료(materials 1개, dualMaterial false, toolChangeCount 0)");
  }
}

// ── (3) 슬롯 결정 ────────────────────────────────────────────────────────

/** 왼쪽 상자 L(A 지정) + 오른쪽 상자 R(지정 없음) + R 에 붙은 서포트 기둥 — 앱 순서(STL 먼저, 서포트 뒤) */
function slotScene() {
  const L = box([-10, 0, -3], [-2, 0.6, 3]); // 베드 X 65..73
  const R = box([2, 0, -3], [10, 0.6, 3]); // 베드 X 77..85
  const pillar = box([12, 0, -0.6], [13.2, 0.6, 0.6]); // 베드 X 87..88.2
  const items = [
    { triangles: L, kind: "stl", stlId: "L" },
    { triangles: R, kind: "stl", stlId: "R" },
    { triangles: pillar, kind: "support", stlId: "R" },
  ];
  const files = [
    { id: "L", fileName: "left.stl", materialSlot: "A" },
    { id: "R", fileName: "right.stl" },
  ];
  return { items, files };
}

/** 툴별 도포 선분의 베드 X 범위가 허용 구간 안인지 — 밖에 있는 선분 수 */
function depositsOutside(gcode, tool, ranges) {
  const ext = extractTask0DepositSegments(gcode);
  let out = 0;
  let total = 0;
  for (const layer of ext.layers) {
    for (const s of layer) {
      if (s.tool !== tool) continue;
      total++;
      const inside = ranges.some(([lo, hi]) => Math.min(s.x0, s.x1) >= lo - 1e-6 && Math.max(s.x0, s.x1) <= hi + 1e-6);
      if (!inside) out++;
    }
  }
  return { out, total };
}

function sectionSlots(mat = { task0MeshSlots, task0ExportMaterialSlots }, label = "") {
  const tag = label ? ` [${label}]` : "";
  if (!label) console.log("\n(3) 슬롯 결정 — 서포트 = A, STL = materialSlot(기본 B)");
  const items = [
    { kind: "support", stlId: "b" },
    { kind: "stl", stlId: "a" },
    { kind: "stl", stlId: "b" },
    { kind: "stl", stlId: "none" },
    { kind: "stl", stlId: "missing" },
    { kind: "stl", stlId: "weird" },
    { kind: "support" },
  ];
  const files = [
    { id: "a", materialSlot: "A" },
    { id: "b", materialSlot: "B" },
    { id: "none" },
    { id: "weird", materialSlot: "C" },
  ];
  const got = mat.task0MeshSlots(items, files);
  const okTable = JSON.stringify(got) === '["A","A","B","B","B","B","A"]';
  if (!label) {
    assert(okTable, `task0MeshSlots ${JSON.stringify(got)} — 서포트(붙은 STL 이 B 여도)·stlId 없는 서포트 A, 'A' 지정 A, 'B'·없음·목록에 없음·모르는 값 B`);
    assert(resolveStlMaterialSlot(undefined) === "B" && resolveStlMaterialSlot({}) === "B" && resolveStlMaterialSlot({ materialSlot: "A" }) === "A", "STL 슬롯 기본값 B");
  }
  const { items: sItems, files: sFiles } = slotScene();
  const slots = mat.task0ExportMaterialSlots("dual", sItems, sFiles);
  const r = runTask0GcodeExport(coreInput(sItems, slots, { layerHeightMm: 0.2 }));
  const t0 = r.ok ? depositsOutside(r.gcode, 0, [[65, 73], [87, 88.2]]) : null;
  const t1 = r.ok ? depositsOutside(r.gcode, 1, [[77, 85]]) : null;
  const okScene = r.ok && JSON.stringify(slots) === '["A","B","A"]' && t0.total > 0 && t0.out === 0 && t1.total > 0 && t1.out === 0;
  if (!label) {
    assert(
      okScene,
      `코어 — 슬롯 ${JSON.stringify(slots)}: T0 도포 ${t0?.total}줄 전부 왼쪽 상자(A 지정)·기둥(서포트) 자리, T1 도포 ${t1?.total}줄 전부 오른쪽 상자(지정 없음 = B)${r.ok ? "" : ` — ${r.issues[0]}`}`,
    );
  }
  return { okTable, okScene, tag };
}

// ── (4) 막힘 ─────────────────────────────────────────────────────────────

/** U 자 A(+Y 열림) 안의 B — 전환 트래블이 칠한 A 를 돌아 들어가야 하는 배치 (verify-task0-dual ③ 과 같은 형상, 높이 0.6) */
function uRingInput(writer) {
  const meshes = [
    box([-8, 0, -4.4], [-4, 0.6, 8]),
    box([4, 0, -4.4], [8, 0.6, 8]),
    box([-8, 0, -8], [8, 0.6, -4]),
    box([-4.2, 0, -4.2], [4.2, 0.6, 4.2]),
  ];
  return { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.2, writer: { ...APP.writer, ...writer }, printable: APP.printable, materialSlots: ["A", "A", "A", "B"] };
}

/** 겹친 두 상자 A·B (verify-task0-dual ② 와 같은 형상, 높이 0.6) — 겹친 곳은 B 만 칠해야 한다 */
function overlapInput(dualWriter = {}) {
  const meshes = [box([-6, 0, -3], [2, 0.6, 3]), box([-2, 0, -3], [6, 0.6, 3])];
  const slots = ["A", "B"];
  return {
    meshes,
    topY: meshesTopY(meshes),
    layerHeightMm: 0.2,
    writer: { ...APP.writer, dualMaterial: { slots, ...dualWriter } },
    printable: APP.printable,
    materialSlots: slots,
  };
}

function ringInput() {
  const ring = fixtureClosedRing();
  const meshes = ring.meshes();
  return { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1, writer: APP.writer, printable: APP.printable, materialSlots: ring.slots };
}

async function sectionBlocked() {
  console.log("\n(4) 막힘 — 파일 없음 + 구체 이유");
  const ri = ringInput();
  const rg = runTask0GcodeExport(ri);
  const rj = await runTask0JobZipExport(ri);
  const allLayers = JSON.stringify([...Array(10).keys()]);
  for (const [what, r, file] of [["run.gcode", rg, rg.gcode], ["job.zip", rj, rj.zip]]) {
    assert(
      !r.ok && file === null && JSON.stringify(r.failedLayers) === allLayers &&
        r.issues.some((s) => s.startsWith("재료 B(T1)가 재료 A(T0)에 둘러싸여 T1 로 들어갈 길이 없는 층 10개") && s.includes("층 0 (Z 0.1 mm)") && s.includes("협의 §31-4")) &&
        !r.issues.some((s) => s.includes("얇은 부분 채움 실패")),
      `① 갇힌 B(닫힌 고리) ${what}: 파일 없음, 문제 층 전 층, 이유 "${r.ok ? "(통과)" : r.issues[0].slice(0, 46)}…"`,
    );
  }
  assert(!rg.ok && rg.summary?.dual?.toolChanges === 0 && rg.summary.dual.depositMmByTool[1] === 0, "① 요약은 남김 — 툴 전환 0, T1 도포 0 (막힌 이유를 화면에 보이는 데 씀)");
  // ② 출력 가능 영역 밖 — 파일 D 형상을 world X +72 (베드 X 147~157)
  const { items, slots } = (() => {
    const d = appItemsD();
    return { items: d.items, slots: task0ExportMaterialSlots("dual", d.items, d.files) };
  })();
  const shifted = items.map((it) => {
    const t = new Float32Array(it.triangles);
    for (let i = 0; i < t.length; i += 3) t[i] += 72;
    return { ...it, triangles: t };
  });
  const og = runTask0GcodeExport(coreInput(shifted, slots));
  const oj = await runTask0JobZipExport(coreInput(shifted, slots));
  assert(
    !og.ok && og.summary === null && og.issues[0].startsWith("출력 가능 영역(X 10~150 × Y 10~85 mm) 밖에 모델·서포트가 있습니다") &&
      !oj.ok && oj.zip === null && oj.issues[0] === og.issues[0],
    `② 2재료 입력이 영역 밖(베드 X 최대 157): writer 전에 막힘 — "${og.ok ? "" : og.issues[0].slice(0, 40)}…"`,
  );
  // ③ 슬롯 수 ≠ 메시 수
  const sm = runTask0GcodeExport(coreInput(items, ["A", "B"]));
  assert(!sm.ok && sm.summary === null && sm.issues[0].startsWith("재료 슬롯 수 2 ≠ 메시 수 5"), `③ 슬롯 수 ≠ 메시 수: ${sm.ok ? "(통과)" : sm.issues[0].slice(0, 30)}…`);
  const bad = runTask0GcodeExport(coreInput(items, ["A", "B", "C", "A", "A"]));
  assert(!bad.ok && bad.issues[0].includes("재료 슬롯은 A 또는 B"), "③ 슬롯 값이 A/B 가 아님: 막힘");
  // ④ 2재료 자기 검사 — writer 대조군 옵션으로 만든 위반 출력
  const ov = runTask0GcodeExport(overlapInput({ subtractOverlap: false }));
  const ovj = await runTask0JobZipExport(overlapInput({ subtractOverlap: false }));
  assert(
    !ov.ok && ov.gcode === null && ov.issues.some((s) => s.startsWith("B 우선 위반 3개 층")) && !ovj.ok && ovj.zip === null,
    `④ 겹침 차집합 끔(subtractOverlap false): run.gcode·job.zip 막힘 — "${ov.ok ? "" : ov.issues[0].slice(0, 44)}…"`,
  );
  const okOv = runTask0GcodeExport(overlapInput());
  assert(okOv.ok, "④ 같은 배치를 기본 옵션(B 우선 차집합)으로 내면 통과");
  const un = runTask0GcodeExport(uRingInput({ thinFillDetour: false }));
  assert(
    !un.ok && un.gcode === null && un.issues.some((s) => s.startsWith("트래블이 칠한 레진을 가로지르거나 스치는 곳")) && JSON.stringify(un.failedLayers) === "[0,1,2]",
    `④ 우회 끔(thinFillDetour false, U 자 A 안의 B): 막힘, 문제 층 ${JSON.stringify(un.failedLayers)} — "${un.ok ? "" : un.issues[0].slice(0, 30)}…"`,
  );
  const uo = runTask0GcodeExport(uRingInput({}));
  assert(uo.ok && uo.summary.dual.toolChanges === 5, `④ 같은 배치를 기본 옵션(우회 켬)으로 내면 통과 (툴 전환 ${uo.ok ? uo.summary.dual.toolChanges : "?"})`);
}

// ── (5) 데이터 — repo 왕복 (가짜 IndexedDB) · 노광 큰 값 ───────────────────

/**
 * 가짜 IndexedDB — data/*.repo.ts 가 쓰는 것만: open(업그레이드 이벤트) · 트랜잭션(요청이 다 끝나면 complete) · 스토어 get/put/add/delete/clear ·
 * createIndex(unique) · index.openCursor(IDBKeyRange.only, 'prev') + cursor.continue/delete · tx.abort. 레코드는 얕은 복사로 둔다(Blob 은 참조).
 */
export function installFakeIndexedDB() {
  const databases = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const clone = (v) => (v === undefined ? undefined : { ...v });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  class Req {
    constructor() {
      this.result = undefined;
      this.error = null;
      this.onsuccess = null;
      this.onerror = null;
    }
  }
  class Tx {
    constructor(db, names, mode) {
      this.db = db;
      this.names = names;
      this.mode = mode;
      this.pending = 0;
      this.done = false;
      this.aborted = false;
      this.error = null;
      this.oncomplete = null;
      this.onerror = null;
      this.onabort = null;
      later(() => this.maybeComplete());
    }
    objectStore(name) {
      if (this.mode !== "versionchange" && !this.names.includes(name)) throw new Error(`NotFoundError: ${name}`);
      const s = this.db.stores.get(name);
      if (!s) throw new Error(`NotFoundError: ${name}`);
      return new Store(this, s);
    }
    request(op) {
      const req = new Req();
      this.pending++;
      later(() => {
        this.pending--;
        if (this.aborted) return;
        try {
          req.result = op();
        } catch (e) {
          req.error = e;
          this.error = e;
          this.aborted = true;
          req.onerror?.({ target: req });
          this.onerror?.({ target: this });
          return;
        }
        req.onsuccess?.({ target: req });
        this.maybeComplete();
      });
      return req;
    }
    maybeComplete() {
      if (this.done || this.aborted || this.pending > 0) return;
      later(() => {
        if (this.done || this.aborted || this.pending > 0) return;
        this.done = true;
        this.oncomplete?.({ target: this });
      });
    }
    abort() {
      this.aborted = true;
      later(() => this.onabort?.({ target: this }));
    }
  }
  class Store {
    constructor(tx, s) {
      this.tx = tx;
      this.s = s;
      this.indexNames = { contains: (n) => s.indexes.has(n) };
    }
    uniqueCheck(value) {
      for (const [name, idx] of this.s.indexes) {
        if (!idx.unique) continue;
        for (const [k, r] of this.s.records) {
          if (k !== value[this.s.keyPath] && r[idx.keyPath] === value[idx.keyPath]) {
            const e = new Error(`ConstraintError: ${name}`);
            e.name = "ConstraintError";
            throw e;
          }
        }
      }
    }
    get(key) {
      return this.tx.request(() => clone(this.s.records.get(key)));
    }
    put(value) {
      return this.tx.request(() => {
        this.uniqueCheck(value);
        this.s.records.set(value[this.s.keyPath], clone(value));
        return value[this.s.keyPath];
      });
    }
    add(value) {
      return this.tx.request(() => {
        if (this.s.records.has(value[this.s.keyPath])) {
          const e = new Error("ConstraintError: key");
          e.name = "ConstraintError";
          throw e;
        }
        this.uniqueCheck(value);
        this.s.records.set(value[this.s.keyPath], clone(value));
        return value[this.s.keyPath];
      });
    }
    delete(key) {
      return this.tx.request(() => {
        this.s.records.delete(key);
      });
    }
    clear() {
      return this.tx.request(() => this.s.records.clear());
    }
    createIndex(name, keyPath, opts = {}) {
      this.s.indexes.set(name, { keyPath, unique: !!opts.unique });
    }
    index(name) {
      const idx = this.s.indexes.get(name);
      if (!idx) throw new Error(`NotFoundError: index ${name}`);
      return { openCursor: (range, dir) => this.cursor(idx, range, dir) };
    }
    cursor(idx, range, dir) {
      const req = new Req();
      const tx = this.tx;
      const s = this.s;
      const list = [...s.records.values()]
        .filter((v) => range == null || range.includes(v[idx.keyPath]))
        .sort((a, b) => cmp(a[idx.keyPath], b[idx.keyPath]) || cmp(a[s.keyPath], b[s.keyPath]));
      if (dir === "prev") list.reverse();
      let i = 0;
      const step = () => {
        tx.pending++;
        later(() => {
          tx.pending--;
          if (tx.aborted) return;
          if (i < list.length) {
            const v = list[i];
            req.result = {
              value: clone(v),
              primaryKey: v[s.keyPath],
              continue: () => {
                i++;
                step();
              },
              delete: () => tx.request(() => s.records.delete(v[s.keyPath])),
            };
          } else req.result = null;
          req.onsuccess?.({ target: req });
          tx.maybeComplete();
        });
      };
      step();
      return req;
    }
  }
  class DB {
    constructor(name) {
      this.name = name;
      this.version = 0;
      this.stores = new Map();
      this.upgradeTx = null;
    }
    get objectStoreNames() {
      return { contains: (n) => this.stores.has(n), length: this.stores.size };
    }
    createObjectStore(name, opts) {
      const s = { keyPath: opts.keyPath, records: new Map(), indexes: new Map() };
      this.stores.set(name, s);
      return new Store(this.upgradeTx, s);
    }
    transaction(names, mode = "readonly") {
      return new Tx(this, Array.isArray(names) ? names : [names], mode);
    }
    close() {}
  }
  const indexedDB = {
    open(name, version) {
      const req = new Req();
      req.onupgradeneeded = null;
      req.transaction = null;
      later(() => {
        let db = databases.get(name);
        if (!db) {
          db = new DB(name);
          databases.set(name, db);
        }
        const oldVersion = db.version;
        if (version > oldVersion) {
          const utx = new Tx(db, [], "versionchange");
          db.upgradeTx = utx;
          req.result = db;
          req.transaction = utx;
          req.onupgradeneeded?.({ oldVersion, newVersion: version, target: req });
          db.version = version;
          req.transaction = null;
        }
        req.result = db;
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
  globalThis.indexedDB = indexedDB;
  globalThis.IDBKeyRange = { only: (v) => ({ includes: (x) => x === v }) };
  return { databases };
}

async function sectionData() {
  console.log("\n(5) 데이터 — repo 왕복(가짜 IndexedDB) · 하위 호환 · .mzalign · 노광 큰 값");
  const fake = installFakeIndexedDB();
  const dbMod = await import(pathToFileURL(path.join(V2, "data", "db.ts")).href);
  const projects = await import(pathToFileURL(path.join(V2, "data", "projects.repo.ts")).href);
  const stls = await import(pathToFileURL(path.join(V2, "data", "stl-files.repo.ts")).href);
  const archive = await import(pathToFileURL(path.join(V2, "utils", "project-archive.ts")).href);

  const p = await projects.createProject({ name: "2재료 시험" });
  const db = fake.databases.get(dbMod.DB_NAME);
  const storeNames = [...db.stores.keys()].sort();
  const indexes = Object.fromEntries([...db.stores].map(([n, s]) => [n, [...s.indexes.keys()].sort()]));
  assert(
    dbMod.DB_VERSION === 4 && db.version === 4 && JSON.stringify(storeNames) === '["projects","stl_files","supports"]' &&
      JSON.stringify(indexes) === JSON.stringify({ projects: ["by_code", "by_lastModifiedAt"], stl_files: ["by_addedAt", "by_project"], supports: ["by_base_stl", "by_project", "by_stl"] }),
    `IndexedDB 스키마 그대로 — 버전 ${db.version}, 스토어 ${storeNames.join("·")}, 인덱스 ${JSON.stringify(indexes)}`,
  );
  assert(!("task0MaterialMode" in p) && resolveTask0MaterialMode(await projects.getProject(p.id)) === "single", "새 프로젝트 레코드에 재료 모드 필드 없음 → 단일");
  const upd = await projects.updateProject(p.id, { task0MaterialMode: "dual" });
  const back = await projects.getProject(p.id);
  const listed = (await projects.listProjects()).find((x) => x.id === p.id);
  assert(
    upd.task0MaterialMode === "dual" && back.task0MaterialMode === "dual" && listed?.task0MaterialMode === "dual" && back.name === "2재료 시험" && back.code === p.code,
    "updateProject(task0MaterialMode 'dual') → getProject·listProjects 에서 'dual', 다른 필드 그대로",
  );

  const blob = new Blob([new Uint8Array(84)]);
  const f1 = await stls.createStlFile(p.id, "teeth.stl", blob);
  const f2 = await stls.createStlFile(p.id, "gum.stl", blob);
  assert(!("materialSlot" in f1) && resolveStlMaterialSlot(await stls.getStlFile(f1.id)) === "B", "새 STL 레코드에 재료 슬롯 필드 없음 → B");
  const transform = { tx: 1, ty: 2, tz: 3, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
  await stls.updateStlFile(f2.id, { transform });
  await stls.updateStlFile(f2.id, { materialSlot: "A" });
  const g2 = await stls.getStlFile(f2.id);
  const list = await stls.listStlFilesByProject(p.id);
  assert(
    g2.materialSlot === "A" && JSON.stringify(g2.transform) === JSON.stringify(transform) && g2.blob === blob &&
      list.map((f) => resolveStlMaterialSlot(f)).join("") === "BA",
    "updateStlFile(materialSlot 'A') → getStlFile·listStlFilesByProject 에서 'A', transform·blob 보존, 다른 STL 은 B",
  );
  const items = [
    { kind: "stl", stlId: f1.id },
    { kind: "stl", stlId: f2.id },
    { kind: "support", stlId: f1.id },
  ];
  assert(
    JSON.stringify(task0ExportMaterialSlots(resolveTask0MaterialMode(back), items, list)) === '["B","A","A"]',
    "저장한 값으로 내보내기 슬롯 — STL(지정 없음) B, STL('A') A, 서포트 A",
  );
  // 옛 레코드 (D1b 이전에 저장된 것 — 필드 없음)
  await projects.putProject({ id: "old-p", name: "옛 프로젝트", code: "OLD00001", createdAt: 1, lastModifiedAt: 1 });
  await stls.putStlFile({ id: "old-s", projectId: "old-p", fileName: "old.stl", blob, fileSize: 84, addedAt: 1 });
  assert(
    resolveTask0MaterialMode(await projects.getProject("old-p")) === "single" && resolveStlMaterialSlot(await stls.getStlFile("old-s")) === "B",
    "옛 레코드(필드 없음) → 재료 모드 단일·STL 슬롯 B",
  );
  // .mzalign 왕복 — 레코드를 펼쳐 담으므로 새 필드도 함께
  const mz = await archive.exportProjectArchive(p.id);
  const imp = await archive.importProjectArchive(mz, "new");
  const np = await projects.getProject(imp.projectId);
  const nf = await stls.listStlFilesByProject(imp.projectId);
  assert(
    np.task0MaterialMode === "dual" && nf.length === 2 && nf.map((f) => resolveStlMaterialSlot(f)).join("") === "BA" && imp.projectId !== p.id,
    ".mzalign 내보내기 → 가져오기('new') 에도 재료 모드 'dual'·STL 슬롯 보존",
  );

  // 노광 — 층당 노광 = 재료별 큰 값 (규격 §6)
  const A = { exposureSec: 2.5, bottomExposureSec: 30, bottomLayerCount: 5, transitionLayerCount: 0 };
  const same = buildTask0MaterialExposure(12, 0.1, A, A);
  const single = buildTask0MaterialExposure(12, 0.1, A, null);
  assert(
    JSON.stringify(same.exposure) === JSON.stringify(buildTask0Exposure(12, 0.1, A)) && same.warnings.length === 0 &&
      JSON.stringify(single.exposure) === JSON.stringify(same.exposure) && single.settingsB === null,
    "노광: 두 재료 값이 같으면 단일 재료와 같은 일정·경고 없음",
  );
  const B = { exposureSec: 3, bottomExposureSec: 20, bottomLayerCount: 3, transitionLayerCount: 2 };
  const diff = buildTask0MaterialExposure(12, 0.1, A, B);
  const ea = buildTask0Exposure(12, 0.1, A).exposureSecByLayer;
  const eb = buildTask0Exposure(12, 0.1, B).exposureSecByLayer;
  assert(
    diff.exposure.exposureSecByLayer.every((v, n) => v === Math.max(ea[n], eb[n])) && diff.exposure.bottomLayerCount === 5 &&
      diff.exposure.transitionLayerCount === 2 && diff.warnings.length === 1 && diff.warnings[0].includes("큰 값"),
    `노광: 값이 다르면 층마다 큰 값 [${diff.exposure.exposureSecByLayer.join(", ")}] + 경고 "${diff.warnings[0]?.slice(0, 40)}…"`,
  );
  const d = appItemsD();
  const slots = task0ExportMaterialSlots("dual", d.items, d.files);
  const jz = await runTask0JobZipExport(coreInput(d.items, slots, { frame: APP.frame, exposure: A, exposureB: B, generatedAt: D_GENERATED_AT }));
  if (jz.ok) {
    const e = await zipEntries(jz.zip);
    const man = JSON.parse(dec.decode(e.get("manifest.json")));
    const exp = JSON.parse(dec.decode(e.get("exposure.json")));
    assert(
      man.materials[0].exposureSec === 2.5 && man.materials[1].exposureSec === 3 && man.materials[1].bottomExposureSec === 20 &&
        JSON.stringify(exp.exposureSecByLayer) === JSON.stringify(buildTask0MaterialExposure(10, D_LH, A, B).exposure.exposureSecByLayer) &&
        jz.summary.dual.warnings.some((w) => w.includes("노광 설정이 다릅니다")) && JSON.stringify(man.estimate) === JSON.stringify(jz.summary.estimate),
      "코어에 재료 B 노광을 따로 주면 manifest 재료별 값, exposure.json 층마다 큰 값, 요약 경고, estimate = 요약",
    );
  } else assert(false, `재료 B 노광 입력 job.zip 막힘: ${jz.issues[0]}`);
  // 표시 색 — hex 한 곳에서 rgb
  const [r, g, b] = task0SlotColorRgb("A");
  assert(
    TASK0_SLOT_COLOR_HEX.A !== TASK0_SLOT_COLOR_HEX.B && Math.abs(r - 0xf5 / 255) < 1e-12 && Math.abs(g - 0x9e / 255) < 1e-12 && Math.abs(b - 0x0b / 255) < 1e-12,
    `재료 표시 색 A ${TASK0_SLOT_COLOR_HEX.A} / B ${TASK0_SLOT_COLOR_HEX.B} — 3D 색(rgb)은 같은 hex 에서`,
  );
}

// ── (6) 배선 (소스) ──────────────────────────────────────────────────────

const read = (...p) => fs.readFileSync(path.join(V2, ...p), "utf8");

/** useCallback 본문(start ~ end 표식)의 마지막 deps 배열 */
function lastDeps(src, startMark, endMark) {
  const s = src.indexOf(startMark);
  if (s < 0) return null;
  const e = endMark ? src.indexOf(endMark, s) : -1;
  const body = src.slice(s, e > 0 ? e : src.length);
  const at = body.lastIndexOf("}, [");
  if (at < 0) return null;
  const m = body.slice(at).match(/\}\s*,\s*\[([\s\S]*?)\]\s*\)/);
  return m ? m[1] : null;
}

/** 규칙 7 + 배선 — 두 Task0 핸들러가 슬롯을 넘기고 deps 에 재료 모드·files, 무효화 deps 에 재료 모드 (대조군 f 가 같은 함수를 쓴다) */
function sliceExportDualOk(hook) {
  const job = hook.slice(hook.indexOf("const handleExportTask0JobZip"), hook.indexOf("const handleExportTask0Gcode"));
  const gc = hook.slice(hook.indexOf("const handleExportTask0Gcode"), hook.lastIndexOf("return {"));
  const passes = (body) => /materialSlots: task0ExportMaterialSlots\(task0MaterialMode, meshes, files\)/.test(body) && /const meshes = handle\.getSliceGeometry\(\);/.test(body);
  const depsOk = (start, end) => {
    const deps = lastDeps(hook, start, end);
    return deps !== null && /\btask0MaterialMode\b/.test(deps) && /\n\s*files,\n/.test(deps);
  };
  const at = hook.indexOf("const task0ReportEpochRef = useRef(0);");
  const eff = at < 0 ? "" : hook.slice(at, hook.indexOf("]);", at) + 3);
  return (
    passes(job) && passes(gc) &&
    depsOk("const handleExportTask0JobZip", "const handleExportTask0Gcode") &&
    depsOk("const handleExportTask0Gcode", "return {") &&
    /\n\s*task0MaterialMode,\n/.test(eff) &&
    /const task0MaterialMode = resolveTask0MaterialMode\(project\);/.test(hook)
  );
}

function sectionWiring() {
  console.log("\n(6) 배선 — 씬 handle·워커·훅·패널·목록·페이지 (소스)");
  const h = read("components", "babylon", "handle", "slice-export-handle.ts");
  const geo = h.slice(h.indexOf("    getSliceGeometry() {"), h.indexOf("    setMaterialSlotColors(slots) {"));
  assert(
    /for \(const \[stlId, mesh\] of ctx\.meshMapRef\.current\) \{\s*const tris = extractWorldTriangles\(mesh\);\s*if \(tris\.length > 0\) out\.push\(\{ triangles: tris, kind: "stl", stlId \}\);/.test(geo) &&
      /for \(const \[supportId, sm\] of ctx\.supportMeshMapRef\.current\) \{\s*const tris = extractWorldTriangles\(sm\);\s*if \(tris\.length > 0\) out\.push\(\{ triangles: tris, kind: "support", stlId: stlOfSupport\.get\(supportId\) \}\);/.test(geo) &&
      geo.indexOf("meshMapRef") < geo.indexOf("supportMeshMapRef"),
    "handle getSliceGeometry: 삼각형은 종전 그대로(extractWorldTriangles, 빈 메시 제외), 순서 STL → 서포트, 메시 정체만 덧붙임",
  );
  const fdm = h.slice(h.indexOf("    getFdmSliceInput(settings) {"), h.indexOf("    getSliceMask("));
  assert(/out\.push\(\{ triangles: tris \}\);/.test(fdm) && !/kind/.test(fdm), "handle getFdmSliceInput(marlin) 무변경 — 메시 정체를 붙이지 않음");
  const colors = h.slice(h.indexOf("    setMaterialSlotColors(slots) {"), h.indexOf("    getSceneTopY() {"));
  // D2: 색 칠하기는 재료 색 상태(components/babylon/material-display.ts setMaterialSlotState)로 옮겼다 — 색 규칙 자체는
  //   verify-task0-dual-preview (2) 가 NullEngine 으로 본다(STL = 슬롯 색, 서포트 = A, null 이면 편집 모드 표시 색·칠하기 전 색).
  const md = read("components", "babylon", "material-display.ts");
  assert(
    /setMaterialSlotState\(ctx, slots\);/.test(colors) &&
      /setModelDiffuseMode\(mesh, overhang\)/.test(md) && /task0SlotColorRgb\(slots\[stlId\] \?\? TASK0_DEFAULT_STL_SLOT\)/.test(md) &&
      /task0SlotColorRgb\(TASK0_SUPPORT_SLOT\)/.test(md) && !/setVerticesData|VertexBuffer/.test(colors + md),
    "handle setMaterialSlotColors → 재료 색 상태(material-display): STL = 슬롯 색, 서포트 = A 색, null 이면 편집 모드 표시 색으로 복귀, 정점 데이터는 안 건드림",
  );
  const types = read("components", "babylon", "babylon-scene-types.ts");
  assert(
    /getSliceGeometry: \(\) => SliceGeometryItem\[\];/.test(types) && /setMaterialSlotColors: \(slots: Readonly<Record<string, "A" \| "B">> \| null\) => void;/.test(types),
    "BabylonSceneHandle 에 메시 정체 항목·재료 색 메서드 (규칙 2 — 씬은 handle 경유)",
  );
  const worker = read("workers", "slice-batch.worker.ts");
  const gfn = worker.slice(worker.indexOf("function runTask0Gcode"), worker.indexOf("async function runTask0JobZip"));
  const jfn = worker.slice(worker.indexOf("async function runTask0JobZip"), worker.indexOf("ctx.addEventListener"));
  assert(/materialSlots:\s*req\.materialSlots/.test(gfn) && /materialSlots:\s*req\.materialSlots/.test(jfn), "워커 두 Task0 경로가 materialSlots 를 코어로 그대로");
  const mask = worker.slice(worker.indexOf("function sliceLayerMask"), worker.indexOf("async function maskToPngBytes"));
  const marlin = worker.slice(worker.indexOf("function runGcode"), worker.indexOf("function runTask0Gcode"));
  assert(
    /sliceTrianglesAtY\(m\.triangles, sliceY\)/.test(mask) && !/\.kind|stlId/.test(mask) && /meshes\.map\(\(m\) => m\.triangles\)/.test(marlin) && !/\.kind|stlId/.test(marlin),
    "워커 마스크 ZIP·marlin 경로는 triangles 만 읽는다 — 메시 정체가 붙어도 산출물 무관",
  );
  const msgs = read("workers", "slice-batch.messages.ts");
  assert((msgs.match(/materialSlots\?: Task0MaterialSlot\[\];/g) ?? []).length === 2, "메시지 Task0GcodeRequest·Task0JobZipRequest 에 materialSlots?");
  const hook = read("pages", "viewer", "hooks", "useSliceExport.ts");
  assert(sliceExportDualOk(hook), "useSliceExport: 두 Task0 핸들러가 getSliceGeometry 순서 그대로 슬롯을 넘기고 deps 에 재료 모드·files (규칙 7), 무효화 deps 에 재료 모드");
  const maskBody = hook.slice(hook.indexOf("const handleExportMasksZip"), hook.indexOf("const handleExportGcode"));
  assert(/const meshes = handle\.getSliceGeometry\(\);\s*const topY = handle\.getSceneTopY\(\);\s*const blob = await sliceBatchService\.exportPngZip\(\s*meshes,/.test(maskBody) && !/materialSlots/.test(maskBody), "마스크 ZIP 핸들러 무변경 — 같은 getSliceGeometry 항목을 그대로 워커로");
  const tm = read("pages", "viewer", "hooks", "useTask0Material.ts");
  // D2: 3D 색은 슬롯 표(sliceSlots — 슬라이스 화면 + 2재료일 때만, 아니면 null)가 바뀔 때만 handle 로(씬의 재료 색 상태 — 멱등)
  assert(
    /updateProject\(\{ task0MaterialMode: next \}\)/.test(tm) && /updateMaterialSlot\(id, slot\)/.test(tm) &&
      /if \(!\(sliceOn && dualActive\)\) return null;/.test(tm) && /sceneHandleRef\.current\?\.setMaterialSlotColors\(sliceSlots\);/.test(tm) &&
      /\}, \[sliceOn, dualActive, slotKey\]\);/.test(tm) && /\}, \[sliceSlots, sceneHandleRef\]\);/.test(tm) &&
      /const dualActive = task0 && mode === "dual";/.test(tm),
    "useTask0Material: 모드·슬롯은 repo 경유 함수로, 3D 색은 슬라이스 화면 + Task0 2재료일 때만(아니면 원래 색), 슬롯 표가 바뀔 때만 handle",
  );
  const projHook = read("hooks", "useProjectsV2.ts");
  const stlHook = read("hooks", "useStlFilesV2.ts");
  assert(
    /const next = await repo\.updateProject\(id, patch\);/.test(projHook) && /await repo\.updateStlFile\(id, \{ materialSlot \}\);/.test(stlHook),
    "데이터 훅: useProjectV2.update → projects.repo updateProject, useStlFilesV2.updateMaterialSlot → stl-files.repo updateStlFile (규칙 1)",
  );
  const uiFiles = [
    read("components", "Task0MaterialCard.tsx"),
    read("components", "SliceSidePanel.tsx"),
    read("components", "StlFileList.tsx"),
    tm,
    read("utils", "task0", "task0-material.ts"),
  ];
  assert(uiFiles.every((s) => !/indexedDB|openDb\(/.test(s)), "새·고친 UI·훅·순수 모듈에 IndexedDB 직접 접근 없음 (규칙 1)");
  const panel = read("components", "SliceSidePanel.tsx");
  assert(
    /\{task0 && task0Material && \(\s*<Card title="재료 \(Task0\)">\s*<Task0MaterialCard \{\.\.\.task0Material\} disabled=\{batchBusy\} \/>/.test(panel) &&
      panel.indexOf('<Card title="재료 (Task0)">') < panel.indexOf('<Card title="내보내기">') &&
      /dual\.toolChanges\}회/.test(panel) && /dual\.depositMmByTool\[0\]/.test(panel) && /dual\?\.warnings\.map/.test(panel),
    "슬라이스 패널: Task0 프로파일이면 재료 카드(내보내기 중 잠금), 결과 요약에 툴 전환 수·재료별 도포 길이·알림",
  );
  const card = read("components", "Task0MaterialCard.tsx");
  assert(/modeButton\("single", "단일 재료"\)/.test(card) && /modeButton\("dual", "2재료 \(T0 \/ T1\)"\)/.test(card) && /서포트는 항상 A/.test(card), "재료 카드: 단일 / 2재료 전환, 파일마다 A/B, '서포트는 항상 A' 안내");
  const list = read("components", "StlFileList.tsx");
  assert(/\{materialSlot \? \(/.test(list) && /<Task0SlotToggle/.test(list), "모델 목록: 2재료일 때만 줄마다 A/B (아니면 종전 표시 그대로)");
  const page = read("pages", "ViewerV2Page.tsx");
  assert(
    /const task0Material = useTask0Material\(\{/.test(page) && /materialSlot=\{task0Material\.listSlots\}/.test(page) && /task0Material=\{task0Material\.card\}/.test(page) &&
      page.indexOf("const task0Material = useTask0Material(") > page.indexOf("} = useSliceExport({") &&
      page.indexOf("const task0Material = useTask0Material(") < page.indexOf("if (!projectId) {"),
    "ViewerV2Page: useTask0Material 을 조립만(early return 앞, useSliceExport 뒤) — 목록·패널에 넘김",
  );
}

// ── (7) 대조군 ───────────────────────────────────────────────────────────

/**
 * utils/task0 의 파일들을 소스 변조해 같은 임시 폴더에 쓰고 entry 를 import — 같은 묶음 안의 './x' 는 변조본끼리 잇고,
 * 나머지 상대 import 는 원본 폴더의 절대 URL 로 바꾼다(verify-task0-jobzip-export loadTask0Mutant 와 같은 방식).
 */
async function loadMutantSet(tag, mutations, entry) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `verify-task0-dual-export-${tag}-`));
  const names = new Set(Object.keys(mutations).map((f) => path.basename(f, ".ts")));
  for (const [fileName, edits] of Object.entries(mutations)) {
    let src = fs.readFileSync(path.join(TASK0_SRC, fileName), "utf8");
    for (const [from, to] of edits) {
      if (!src.includes(from)) throw new Error(`변조 대상 문자열이 소스에 없음 (${tag}): ${from}`);
      src = src.replace(from, to);
    }
    src = src.replace(/from '(\.{1,2}\/[^']+)'/g, (m, spec) =>
      spec.startsWith("./") && names.has(spec.slice(2)) ? m : `from '${pathToFileURL(path.resolve(TASK0_SRC, `${spec}.ts`)).href}'`,
    );
    fs.writeFileSync(path.join(dir, fileName), src, "utf8");
  }
  try {
    return await import(pathToFileURL(path.join(dir, entry)).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const AT_DUAL_SELF = "  if (dualSlots !== null && issues.length === 0) {";
const AT_TRAVEL = "  const travel = travelContactViolations(gen.gcode, [toUm(p.parkXMm), toUm(p.parkYMm)]);";
const AT_TRAPPED = "    else if (abOrder && stuckT1 > 0) {";
const AT_SUPPORT_SLOT = "export const TASK0_SUPPORT_SLOT: Task0MaterialSlot = 'A';";
const AT_TOOL_CHANGES = "  const toolChangeCount = gcode.totals.toolChanges;";
const AT_DUAL_SLOTS = "  const dualSlots = dualSlotsOf(input);";

async function sectionControls(ref) {
  console.log("\n(7) 대조군 — 변조하면 위 단언이 실제로 실패하는가");
  // a. 서포트 슬롯 B
  const supB = await loadMutantSet("support-b", { "task0-material.ts": [[AT_SUPPORT_SLOT, "export const TASK0_SUPPORT_SLOT: Task0MaterialSlot = 'B';"]] }, "task0-material.ts");
  const d = appItemsD();
  const slotsB = supB.task0ExportMaterialSlots("dual", d.items, d.files);
  const gB = runTask0GcodeExport(coreInput(d.items, slotsB));
  const sB = sectionSlots(supB, "변조: 서포트 = B");
  assert(
    JSON.stringify(slotsB) === '["B","B","B","B","B"]' && (!gB.ok || sha256(gB.gcode) !== FILE_D_SHA) && !sB.okTable && !sB.okScene,
    `a. 서포트 슬롯을 B 로 바꾸면 파일 D 바이트(${gB.ok ? sha256(gB.gcode).slice(0, 16) : "막힘"}…)·슬롯 표·"T0 = 기둥 자리" 단언이 모두 실패`,
  );
  // b. toolChangeCount 0 고정
  const tc0 = { "task0-jobzip.ts": [[AT_TOOL_CHANGES, "  const toolChangeCount = 0;"]] };
  const coreTc0 = await loadMutantSet("toolchange-0", { ...tc0, "task0-export.ts": [] }, "task0-export.ts");
  const jb = await coreTc0.runTask0JobZipExport(coreInput(d.items, ref.slots, { frame: APP.frame, generator: TASK0_APP_JOB_GENERATOR, generatedAt: D_GENERATED_AT }));
  assert(
    !jb.ok && jb.zip === null && jb.issues.some((s) => s.includes("manifest toolChangeCount 0 ≠ run.gcode 툴 전환 3")),
    `b. toolChangeCount 를 0 으로 고정하면 파일 D job.zip 이 자기 검사에서 막힌다 — "${jb.ok ? "(통과)" : jb.issues.find((s) => s.includes("toolChangeCount"))?.slice(0, 70)}…"`,
  );
  const jzTc0 = await loadMutantSet("toolchange-0-sample", tc0, "task0-jobzip.ts");
  const allMeshes = d.items.map((it) => it.triangles);
  const built = await jzTc0.buildTask0JobZip({ meshes: allMeshes, topY: meshesTopY(allMeshes), layerHeightMm: D_LH, writer: { dualMaterial: { slots: ref.slots } }, generatedAt: D_GENERATED_AT });
  const repTc0 = await verifyTask0JobZip(built.bytes);
  assert(
    built.manifest.toolChangeCount === 0 && built.manifest.estimate.toolChangeSec === 0 && !repTc0.pass,
    `b. 같은 변조의 견본 경로 zip(toolChangeCount 0, toolChangeSec 0)은 검사기가 잡는다 (${repTc0.extraIssues.find((m) => m.includes("toolChangeCount")) ?? "?"})`,
  );
  // c. 2재료 자기 검사 제거
  const noSelf = await loadMutantSet("no-dual-self", { "task0-export.ts": [[AT_DUAL_SELF, "  if (false) {"]] }, "task0-export.ts");
  const cOv = noSelf.runTask0GcodeExport(overlapInput({ subtractOverlap: false }));
  const cOvZ = await noSelf.runTask0JobZipExport(overlapInput({ subtractOverlap: false }));
  const cUn = noSelf.runTask0GcodeExport(uRingInput({ thinFillDetour: false }));
  assert(
    cOv.ok && typeof cOv.gcode === "string" && cOvZ.ok && cOvZ.zip.length > 0 && cUn.ok && typeof cUn.gcode === "string",
    "c. 2재료 자기 검사를 빼면 B 우선 위반 출력(run.gcode·job.zip)과 교차 트래블 출력이 파일로 나온다 — (4)④ 를 막는 것은 이 검사",
  );
  // d. 트래블 검사만 제거
  const noTravel = await loadMutantSet("no-travel", { "task0-export.ts": [[AT_TRAVEL, "  const travel: { layer: number; count: number }[] = [];"]] }, "task0-export.ts");
  const dUn = noTravel.runTask0GcodeExport(uRingInput({ thinFillDetour: false }));
  const dOv = noTravel.runTask0GcodeExport(overlapInput({ subtractOverlap: false }));
  assert(
    dUn.ok && !dOv.ok && dOv.issues.some((s) => s.startsWith("B 우선 위반")),
    "d. 트래블 검사만 빼면 교차 출력은 나오고 B 우선 위반은 여전히 막힘 — 커버리지 검사만으로는 교차를 못 잡는다",
  );
  // e. 갇힌 B 판정 제거 (D2 — 판정이 writer 통계 unreachableByTool 기반이 된 뒤: 빼면 "맞물림" 문구로 떨어진다)
  const noTrap = await loadMutantSet("no-trapped", { "task0-export.ts": [[AT_TRAPPED, "    else if (abOrder && stuckT1 > 0 && false) {"]] }, "task0-export.ts");
  const eR = noTrap.runTask0GcodeExport(ringInput());
  assert(
    !eR.ok && !eR.issues.some((s) => s.includes("둘러싸여")) && eR.issues.some((s) => s.startsWith("두 재료가 맞물린 단면에서")),
    `e. 갇힌 B 판정을 빼면 이유가 엉뚱한 "${eR.ok ? "(통과)" : eR.issues[0].slice(0, 20)}…" 로 바뀐다 — (4)① 의 구체 이유 단언이 잡는다`,
  );
  // g. 수정 전 코어처럼 슬롯 입력을 무시하면 (앱이 materialSlots 를 보내도 단일 재료) — (1) 의 파일 D 바이트·manifest 2재료가 실패
  const noSlots = await loadMutantSet("ignore-slots", { "task0-export.ts": [[AT_DUAL_SLOTS, "  const dualSlots = dualSlotsOf({ ...input, materialSlots: undefined });"]] }, "task0-export.ts");
  const gG = noSlots.runTask0GcodeExport(coreInput(d.items, ref.slots));
  const gJ = await noSlots.runTask0JobZipExport(coreInput(d.items, ref.slots, { frame: APP.frame, generatedAt: D_GENERATED_AT }));
  const gMan = gJ.ok ? JSON.parse(dec.decode((await zipEntries(gJ.zip)).get("manifest.json"))) : null;
  assert(
    gG.ok && sha256(gG.gcode) !== FILE_D_SHA && gG.summary.dual === null && gMan !== null && gMan.materials.length === 1 && gMan.dualMaterial === false,
    "g. 슬롯 입력을 무시하는 코어(D1b 이전과 같은 동작)는 단일 재료 파일을 내 (1) 의 파일 D 바이트·materials 2개·dualMaterial 단언이 실패",
  );
  // f. deps·무효화
  const hook = read("pages", "viewer", "hooks", "useSliceExport.ts");
  const at = hook.indexOf("const handleExportTask0JobZip");
  const noModeDep = hook.slice(0, at) + hook.slice(at).replace(/\n\s*task0MaterialMode,\n/, "\n");
  const noFilesDep = hook.slice(0, at) + hook.slice(at).replace(/\n\s*files,\n/, "\n");
  const eAt = hook.indexOf("const task0ReportEpochRef = useRef(0);");
  const noInvalidate = hook.slice(0, eAt) + hook.slice(eAt).replace(/\n\s*task0MaterialMode,\n/, "\n");
  assert(
    noModeDep !== hook && !sliceExportDualOk(noModeDep) && noFilesDep !== hook && !sliceExportDualOk(noFilesDep) &&
      noInvalidate !== hook && !sliceExportDualOk(noInvalidate),
    "f. job.zip 핸들러 deps 에서 재료 모드·files 를 빼거나 무효화 deps 에서 재료 모드를 빼면 (6) 의 검사가 실패한다",
  );
}

// ── (8) 성능 참고 ────────────────────────────────────────────────────────

async function sectionPerf() {
  if (process.env.TASK0_PERF !== "1") return;
  console.log("\n(8) 성능 참고 (TASK0_PERF=1 — 판정 없음)");
  const cases = [];
  const d = appItemsD();
  cases.push({ name: "파일 D 형상(기둥 A + 판 B) lh 0.1", items: d.items, slots: task0ExportMaterialSlots("dual", d.items, d.files), lh: D_LH });
  const sp = sphereSeedModel(1000);
  const sItems = sp.meshes.map((t, i) => ({ triangles: t, kind: sp.slots[i] === "A" ? "support" : "stl", stlId: "sphere" }));
  cases.push({ name: `구 + 기둥 서포트(seed 1000, 메시 ${sp.meshes.length}) lh 0.1`, items: sItems, slots: sp.slots, lh: 0.1 });
  for (const c of cases) {
    for (const dual of [false, true]) {
      const t0 = performance.now();
      const r = await runTask0JobZipExport(coreInput(c.items, dual ? c.slots : undefined, { layerHeightMm: c.lh, frame: APP.frame }));
      const ms = performance.now() - t0;
      const st = r.job?.stageMs;
      console.log(
        `  ${c.name} ${dual ? "2재료" : "단일"}: ${r.ok ? "통과" : `막힘(${r.issues[0].slice(0, 30)}…)`} ${ms.toFixed(0)} ms` +
          (st ? ` (G-code·검사 ${st.gcode.toFixed(0)} / 층 이미지 ${st.png.toFixed(0)} / 묶기·검사 ${st.verify.toFixed(0)} ms, 층 ${r.summary?.layerCount}, 툴 전환 ${r.summary?.dual?.toolChanges ?? 0})` : ""),
      );
    }
  }
}

async function main() {
  console.log("Task0 2재료 앱 내보내기 검증 (D1b — 파일별 재료·job.zip/run.gcode 2재료·manifest 2재료, 규격서 v0.3.4)");
  const ref = await sectionAppPath();
  await sectionWorkerModule(ref);
  await sectionSingle();
  sectionSlots();
  await sectionBlocked();
  await sectionData();
  sectionWiring();
  if (ref) await sectionControls(ref);
  else assert(false, "(1) 이 실패해 대조군을 건너뜀");
  await sectionPerf();
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

// 다른 검증 스크립트(verify-task0-dual-preview — D2)가 가짜 IndexedDB 를 가져다 쓴다 → 직접 실행할 때만 main.
const isMain = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
