// Task0 2재료 D2 헤드리스 검증 — 2색 슬라이스 미리보기 · 재료 색 상태(effect 순서 의존 제거) · 재료 이름 · 복제·붙여넣기 슬롯 상속 ·
// 실패 이유 정확화(writer 툴 패스별 경로 없는 항목) · 배선(BabylonScene 훅·dispose 순서) · 대조군.
//
//   무엇을: D2 에서 고친 곳.
//     src/features/v2/utils/slice-material-mask.ts            라벨 마스크(합집합 + B 래스터, 겹침 = B) — 2D 단면 패널
//     src/features/v2/components/babylon/material-display.ts  재료 색 상태 → STL·서포트·단면 fill 표시 색 (applyModelDisplayColor 등)
//     src/features/v2/components/babylon/handle/slice-export-handle.ts  getSliceMaterialMask, setMaterialSlotColors = 상태 입구
//     src/features/v2/utils/task0/task0-material.ts            재료 이름 정규화·해석·저장값, 내보내기 이름, 복제 슬롯 상속
//     src/features/v2/utils/task0/task0-gcode-writer.ts        Task0LayerStats.unreachableByTool (G-code 바이트 불변)
//     src/features/v2/utils/task0/task0-export.ts              실패 층 이유 = writer 통계, manifest 이름 정규화
//     + 데이터(ProjectV2.task0MaterialNames?, createStlFile init — repo 경유), 배선(소스 검사).
//   규격 = Task0 리포 docs/Task0_Gcode_규격서_초안.md v0.3.4 @ a4ebc6c §6(A = T0, B = T1, 겹친 곳 B — D1a B 우선)·§11(materials[].name 은
//   Task0 GUI 표시용 자유 문자열). 설계 = docs/계획_Z1_task0출력_20261002.md §4-6(D1b 인계 — D2 목록, 3D 색 구멍).
//
//   (1) 라벨 마스크 — 2재료 픽스처(서포트 기둥 A + 판 B = 파일 D 형상 / 겹친 두 상자 A·B / A 고리 안 B)의 여러 높이에서
//       rasterizeMaterialLabels(Node 에서 handle 과 같은 절차 — 메시마다 sliceTrianglesAtY → chainSegments, STL 먼저·서포트 뒤)의 라벨이
//       독립 계산(raster(PB) ? 2 : raster(PA) ? 1 : 0 — 겹침 = B)과 픽셀마다 같고, 표본 점(겹친 곳 2·A 만 1·B 만 2·빈 곳 0)이 맞다.
//       (1b) 실제 handle(buildSliceExportHandle, Babylon NullEngine 메시): getSliceMaterialMask 라벨 = (1) 의 라벨, 라벨 ≠ 0 집합 = 같은 인자의
//       getSliceMask 흰 픽셀. 화면 색 materialLabelRgb = TASK0_SLOT_COLOR_HEX, 2D 미리보기·pane 배선(소스).
//   (2) 재료 색 상태 — NullEngine 씬(STL 머티리얼은 stl-loader 와 같은 청록빛 파랑, 서포트는 createSupportMaterial 공유)에서:
//       상태 설정 → STL 슬롯 색·서포트 A, 편집 모드 동기화 재실행(useEditModeSync 경로)에도 유지, **진입 뒤 로드된 STL**(useFileMeshSync 경로)
//       = 슬롯 색, 다시 만든 서포트 메시 = A, 단면 fill(useSlicePreview 와 같은 절차) = 슬롯 fill, 슬롯을 바꾸면 이미 그려진 fill 도 즉시,
//       상태 해제 → 편집 모드별 원래 색(서포트 탭 흰색 / 그 밖 파랑)·서포트 칠하기 전 색·종전 fill. 색 결정 순수 함수 = setModelDiffuseMode 색.
//   (3) 재료 이름 — 정규화 표(공백·줄바꿈·C0/DEL/C1 제어문자·BOM·짝 없는 서로게이트·길이 24 코드 포인트·빈 값·문자열 아님),
//       해석·저장값(기본 이름이면 필드 뺌)·내보내기 이름(2재료만), 코어 job.zip manifest materials[].name(제어문자 섞인 입력도 정규화),
//       기본 이름이면 D1b 고정 zip e9edb893… 그대로, 단일 모드는 이름을 넘기지 않아 견본 zip 616b0e61… 그대로, 실제 워커 모듈 메시지 →
//       manifest 이름, repo 왕복(가짜 IndexedDB — verify-task0-dual-export 의 것, DB 버전·스토어·인덱스 그대로, 옛 레코드 기본값, .mzalign 보존),
//       화면 배선(입력은 blur·Enter 에서만 저장, 내보내기 중 잠금, job.zip 핸들러 deps — 규칙 7).
//   (4) 복제·붙여넣기 슬롯 상속 — task0CopySlotInit 표, repo createStlFile init(A → A, 없음·모르는 값 → 필드 없음), 복제·클립보드 경로를
//       같은 함수로 따라 해 A 원본 → 복제본 A, 배선(복제·복사·잘라내기·붙여넣기가 init 을 넘기고 드롭·예제는 안 넘김, 복제 undo 구조 그대로).
//   (5) 실패 이유 — writer unreachableByTool 합 = unreachable(단일·2재료 픽스처 전 층), A 고리 안 B → "갇힌 B"(T1 패스 경로 없음),
//       A 고리 안 B + 고리 밖 B(B 일부는 칠함 — D1b 휴리스틱 "T1 도포 0" 이면 "맞물림" 으로 읽던 배치) → "갇힌 B", B 고리 안 A + 순서 'BA'
//       (T0 패스 경로 없음) → 다른 문구("맞물린" — T0/T1 패스별 항목 수), 단일 A·B·C·파일 D G-code 바이트 불변.
//   (6) 배선 — BabylonScene 훅 호출 순서·dispose 순서(§5 불변식), 부트스트랩 슬롯 fill 머티리얼, STL 표시 색을 정하는 지점이 전부
//       applyModelDisplayColor(setModelDiffuseMode 직접 호출은 stl-loader·material-display 밖에 없음), useTask0Material 은 슬롯 표가 바뀔 때만.
//   (7) 대조군 — a. 겹침을 A 우선으로 바꾼 slice-material-mask → (1) 실패  b. 재료 색 상태를 무시(항상 setModelDiffuseMode)하는
//       material-display → (2) 실패  c. 제어문자를 거르지 않는 이름 정규화 → (3) 정규화 표 실패  d. 복제가 슬롯을 안 넘김(task0CopySlotInit = {}·
//       복제 핸들러에서 인자 뺌) → (4) 실패  e. 갇힌 B 판정을 D1b 휴리스틱("T1 도포 0")으로 되돌린 코어 → (5) 의 고리 밖 B 배치 실패.
//   (8) 성능 참고 — TASK0_PERF=1 일 때만(판정 없음): 2D 단면 한 층 getSliceMask(1bpp) vs getSliceMaterialMask(2재료) ms (512×288).
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "변조"·"FAIL" 같은 문자열을 출력할 수 있다.
//   실행: npx tsx scripts/verify-task0-dual-preview.mjs   (선택) TASK0_PERF=1
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Color3, Mesh, NullEngine, Scene, StandardMaterial, VertexData } from "@babylonjs/core";

import { buildSliceExportHandle } from "../src/features/v2/components/babylon/handle/slice-export-handle.ts";
import * as materialDisplay from "../src/features/v2/components/babylon/material-display.ts";
import { chainSegments, normalizeTriangleWinding, sliceTrianglesAtY } from "../src/features/v2/utils/slice-geometry.ts";
import * as sliceMaterialMask from "../src/features/v2/utils/slice-material-mask.ts";
import { rasterizePolygons } from "../src/features/v2/utils/slice-rasterize.ts";
import { buildPolygonFillMesh, createSliceFillMaterial } from "../src/features/v2/utils/slice-render.ts";
import { MODEL_DIFFUSE_COLOR, MODEL_DIFFUSE_COLOR_OVERHANG, setModelDiffuseMode } from "../src/features/v2/utils/stl-loader.ts";
import { createSupportMaterial } from "../src/features/v2/utils/support-render.ts";
import { generateTask0Gcode } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import {
  TASK0_APP_JOB_GENERATOR,
  runTask0GcodeExport,
  runTask0JobZipExport,
} from "../src/features/v2/utils/task0/task0-export.ts";
import {
  TASK0_DEFAULT_MATERIAL_NAME,
  TASK0_DEFAULT_MATERIAL_NAME_B,
  readTask0ZipEntries,
  verifyTask0JobZip,
} from "../src/features/v2/utils/task0/task0-jobzip.ts";
import * as task0Material from "../src/features/v2/utils/task0/task0-material.ts";
import {
  TASK0_BUILT_IN_PROFILE,
  task0PrintableFrameForProfile,
  task0RasterFrameForProfile,
  task0WriterOptionsForProfile,
} from "../src/features/v2/utils/task0/task0-profile.ts";
import { profileExposure } from "../src/features/v2/pages/viewer/utils/profile-exposure.ts";
import { addCopySuffix } from "../src/features/v2/pages/viewer/utils/file-naming.ts";
import {
  SAMPLE_EXPOSURE,
  SAMPLE_GENERATED_AT,
  SAMPLE_LH,
  SAMPLE_TOP_Y,
  sampleMeshes,
} from "./gen-task0-sample-zip.mjs";
import {
  fixtureClosedRing,
  fixtureDualPillarsPlate,
  pillarTriangles,
  sphereSeedModel,
  sphereTriangles,
} from "./verify-task0-dual.mjs";
import { installFakeIndexedDB } from "./verify-task0-dual-export.mjs";
import {
  boxTriangles,
  fixtureCube10,
  fixtureFileB,
  fixtureGapPlates,
  meshesTopY,
} from "./verify-task0-writer.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(SCRIPT_DIR, "..");
const V2 = path.join(FRONTEND, "src", "features", "v2");

/** 고정값 — verify-task0-export·verify-task0-dual-export·verify-task0-jobzip-export 와 같은 값 */
const FILE_D_SHA = "53730df71c6a7d984615962e9228c9a6a54636e84941d6b69310334f9ee28faa";
const SINGLE_SHA = {
  cube10: "dde08ea97b2e144dabc842d1257980bdd4d51fa59b7bf7453c463e5f264928b9",
  "gap-plates": "ab3f8d7431386b5deaa3a4f44df09dfe1b0b1f0ac82303423cc63ccac76d7859",
  "file-b": "b1e65f70c96a3e5cee17a97c27d8b2bb029faa8e82791bca2ef09361098a8339",
};
const SAMPLE_SHA = "616b0e610dfa0a101f357d2a8a30bdb7f3823ddd773350ffe40682f7c8192989";
/** D1b 2재료 job.zip (파일 D 형상, 앱 generator, D_GENERATED_AT) — 기본 이름이면 그대로여야 한다 */
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
const read = (...p) => fs.readFileSync(path.join(V2, ...p), "utf8");
/** 주석(줄 주석·블록 주석) 지운 소스 — 순서·존재 검사용 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

async function zipManifest(bytes) {
  const e = new Map((await readTask0ZipEntries(bytes)).map((x) => [x.name, x.data]));
  return JSON.parse(dec.decode(e.get("manifest.json")));
}

// ── 변조본 로더 ──────────────────────────────────────────────────────────

/** 상대 import 경로 → 실제 파일 (.ts / .tsx / index.ts) */
function resolveSource(p) {
  for (const cand of [`${p}.ts`, `${p}.tsx`, path.join(p, "index.ts"), p]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  throw new Error(`import 대상을 못 찾음: ${p}`);
}

/**
 * v2 소스 파일 하나를 문자열 변조해 임시 폴더에 쓰고 import — 상대 import 는 원본 폴더의 절대 URL 로 바꾼다(그 밖의 모듈은 원본 그대로).
 * 임시 폴더는 이 scripts 폴더 안(끝나면 지운다) — 패키지 이름 import(@babylonjs/core)가 이 스크립트와 **같은 모듈 인스턴스**로
 * 풀려야 instanceof StandardMaterial 이 맞는다(OS 임시 폴더는 못 풀고, node_modules 아래는 tsx 가 다른 인스턴스로 읽는다 — 실측).
 */
async function loadMutant(tag, relFile, edits) {
  const srcPath = path.join(V2, ...relFile.split("/"));
  let src = fs.readFileSync(srcPath, "utf8");
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`변조 대상 문자열이 소스에 없음 (${tag}): ${from}`);
    src = src.replace(from, to);
  }
  const baseDir = path.dirname(srcPath);
  src = src.replace(/(from\s+)(["'])(\.{1,2}\/[^"']+)\2/g, (m, pre, q, spec) => `${pre}${q}${pathToFileURL(resolveSource(path.resolve(baseDir, spec))).href}${q}`);
  const dir = fs.mkdtempSync(path.join(SCRIPT_DIR, `.tmp-verify-task0-dual-preview-${tag}-`));
  const out = path.join(dir, path.basename(srcPath));
  fs.writeFileSync(out, src, "utf8");
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── Babylon 헤드리스 씬 ──────────────────────────────────────────────────

const engine = new NullEngine();

/** world 삼각형(삼각형당 9 float) → Babylon Mesh (정점 = 삼각형 꼭짓점 그대로) */
function meshFromTris(scene, name, tris) {
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = Array.from(tris);
  vd.indices = Array.from({ length: tris.length / 3 }, (_, i) => i);
  vd.applyToMesh(m);
  m.computeWorldMatrix(true);
  return m;
}

/** STL 메시 — stl-loader loadStlIntoScene 과 같은 머티리얼(청록빛 파랑 clone) */
function stlMesh(scene, id, tris) {
  const m = meshFromTris(scene, id, tris);
  const mat = new StandardMaterial(`${id}-mat`, scene);
  mat.diffuseColor = MODEL_DIFFUSE_COLOR.clone();
  m.material = mat;
  return m;
}

const PLATE_W = 40;
const PLATE_D = 24;
const PX_W = 400;
const PX_H = 240;

/** handle·material-display 가 읽는 SceneCtx 조각 — 부트스트랩과 같은 머티리얼 (단면 fill 색은 useSceneBootstrap 과 같은 값) */
function makeCtx(scene) {
  const ref = (v) => ({ current: v });
  return {
    sceneRef: ref(scene),
    meshMapRef: ref(new Map()),
    supportMeshMapRef: ref(new Map()),
    supportsRef: ref([]),
    supportMaterialRef: ref(createSupportMaterial(scene)),
    sliceFillMeshesRef: ref([]),
    sliceModelMatRef: ref(createSliceFillMaterial(scene, new Color3(0.85, 0.86, 0.9), "v2_slice_model_mat")),
    sliceSupportMatRef: ref(createSliceFillMaterial(scene, new Color3(0.55, 0.7, 0.95), "v2_slice_support_mat")),
    sliceSlotMatsRef: ref({
      A: createSliceFillMaterial(scene, Color3.FromArray(task0Material.task0SlotColorRgb("A")), "v2_slice_slot_a_mat"),
      B: createSliceFillMaterial(scene, Color3.FromArray(task0Material.task0SlotColorRgb("B")), "v2_slice_slot_b_mat"),
    }),
    materialSlotColorsRef: ref(null),
    editModeRef: ref("select"),
    plateWRef: ref(PLATE_W),
    plateDRef: ref(PLATE_D),
  };
}

// ── (1) 라벨 마스크 ──────────────────────────────────────────────────────

/**
 * 2재료 단면 픽스처 — items 는 handle 순회 순서(STL 먼저, 서포트 뒤). slots = STL id → 슬롯.
 * probes = [x, z, 기대 라벨] (경계에서 0.2 mm 이상 떨어진 world 점).
 */
function labelFixtures() {
  const d = fixtureDualPillarsPlate().meshes(); // [기둥 4, 판]
  const ring = fixtureClosedRing().meshes(); // [A 고리, 안 B]
  return [
    {
      name: "서포트 기둥 A + 판 B (파일 D 형상)",
      items: [{ tris: d[4], kind: "stl", stlId: "plate" }, ...d.slice(0, 4).map((t, i) => ({ tris: t, kind: "support", stlId: `sup${i}` }))],
      slots: { plate: "B" },
      layers: [
        { y: 0.25, probes: [[-4, -3, 1], [2.5, 1.5, 1], [0, 0, 0], [15, 10, 0]] },
        { y: 0.5, probes: [[-4.3, -3.3, 1], [-3.7, -2.7, 2], [2.5, -1.5, 2], [0, 0, 2], [15, 10, 0]] },
        { y: 0.8, probes: [[0, 0, 2], [-4.3, -3.3, 0], [3.5, 2.5, 2]] },
      ],
    },
    {
      name: "겹친 두 상자 A·B",
      items: [
        { tris: box([-6, 0, -3], [2, 1, 3]), kind: "stl", stlId: "a" },
        { tris: box([-2, 0, -3], [6, 1, 3]), kind: "stl", stlId: "b" },
      ],
      slots: { a: "A", b: "B" },
      layers: [{ y: 0.5, probes: [[-4, 0, 1], [0, 0, 2], [1.5, 2.5, 2], [4, 0, 2], [8, 0, 0]] }],
    },
    {
      name: "A 고리 안 B",
      items: [
        { tris: ring[0], kind: "stl", stlId: "ring" },
        { tris: ring[1], kind: "stl", stlId: "core" },
      ],
      slots: { ring: "A", core: "B" },
      layers: [{ y: 0.55, probes: [[0, 0, 2], [3.5, -3.5, 2], [6, 0, 1], [-7, 7, 1], [10, 0, 0]] }],
    },
  ];
}

/** handle 과 같은 절차로 폴리곤·슬롯 (메시마다 자르고 잇기, STL 은 slots[stlId] ?? B, 서포트 A) */
function taggedPolygons(fx, y) {
  const polys = [];
  const slots = [];
  for (const it of fx.items) {
    const slot = it.kind === "support" ? "A" : fx.slots[it.stlId] ?? "B";
    for (const p of chainSegments(sliceTrianglesAtY(normalizeTriangleWinding(it.tris), y))) {
      polys.push(p);
      slots.push(slot);
    }
  }
  return { polys, slots };
}

const RASTER = { widthPx: PX_W, heightPx: PX_H, plateWidthMm: PLATE_W, plateDepthMm: PLATE_D };
const pixelOf = (x, z) => Math.floor(((PLATE_D / 2 - z) / PLATE_D) * PX_H) * PX_W + Math.floor(((x + PLATE_W / 2) / PLATE_W) * PX_W);

/** (1) 판정 — mod.rasterizeMaterialLabels 로. 대조군 a 가 같은 함수를 변조본으로 부른다. 반환: [{ ok, msg }] */
function labelChecks(mod) {
  const out = [];
  for (const fx of labelFixtures()) {
    for (const layer of fx.layers) {
      const { polys, slots } = taggedPolygons(fx, layer.y);
      const labels = mod.rasterizeMaterialLabels(polys, slots, RASTER);
      const ra = rasterizePolygons(polys.filter((_, i) => slots[i] === "A"), RASTER).data;
      const rb = rasterizePolygons(polys.filter((_, i) => slots[i] === "B"), RASTER).data;
      let diff = 0;
      const count = [0, 0, 0];
      for (let i = 0; i < labels.data.length; i++) {
        const want = rb[i] ? 2 : ra[i] ? 1 : 0;
        if (labels.data[i] !== want) diff++;
        count[labels.data[i]] = (count[labels.data[i]] ?? 0) + 1;
      }
      const probeBad = layer.probes.filter(([x, z, want]) => labels.data[pixelOf(x, z)] !== want);
      out.push({
        ok: diff === 0 && probeBad.length === 0 && labels.width === PX_W && labels.height === PX_H,
        msg:
          `[${fx.name} Y ${layer.y}] 라벨 = raster(PB) ? B : raster(PA) ? A : 0 (다른 픽셀 ${diff}), 표본 ${layer.probes.length - probeBad.length}/${layer.probes.length}` +
          ` — A ${count[1]} · B ${count[2]} 픽셀` +
          (probeBad.length ? ` (틀린 표본 ${JSON.stringify(probeBad.map(([x, z, w]) => [x, z, w, labels.data[pixelOf(x, z)]]))})` : ""),
      });
    }
  }
  return out;
}

function sectionLabels() {
  console.log("\n(1) 라벨 마스크 — 겹침 = B, 라벨 = 독립 계산");
  for (const { ok, msg } of labelChecks(sliceMaterialMask)) assert(ok, msg);
  let threw = false;
  try {
    sliceMaterialMask.rasterizeMaterialLabels(taggedPolygons(labelFixtures()[1], 0.5).polys, ["A"], RASTER);
  } catch (e) {
    threw = e instanceof RangeError;
  }
  assert(threw, "슬롯 수 ≠ 폴리곤 수 → RangeError");
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  assert(
    JSON.stringify(sliceMaterialMask.materialLabelRgb(0)) === "[0,0,0]" &&
      JSON.stringify(sliceMaterialMask.materialLabelRgb(1)) === JSON.stringify(hex(task0Material.TASK0_SLOT_COLOR_HEX.A)) &&
      JSON.stringify(sliceMaterialMask.materialLabelRgb(2)) === JSON.stringify(hex(task0Material.TASK0_SLOT_COLOR_HEX.B)),
    `화면 색: 0 = 검정, 1 = ${task0Material.TASK0_SLOT_COLOR_HEX.A}(A 주황), 2 = ${task0Material.TASK0_SLOT_COLOR_HEX.B}(B 보라) — TASK0_SLOT_COLOR_HEX 한 곳`,
  );

  console.log("\n(1b) 실제 handle(NullEngine) — getSliceMaterialMask = (1) 라벨, 라벨 ≠ 0 = getSliceMask");
  for (const fx of labelFixtures()) {
    const scene = new Scene(engine);
    const ctx = makeCtx(scene);
    for (const it of fx.items) {
      if (it.kind === "stl") ctx.meshMapRef.current.set(it.stlId, stlMesh(scene, it.stlId, it.tris));
      else ctx.supportMeshMapRef.current.set(it.stlId, meshFromTris(scene, it.stlId, it.tris));
    }
    const handle = buildSliceExportHandle(ctx);
    for (const layer of fx.layers) {
      const labels = handle.getSliceMaterialMask(layer.y, PX_W, PX_H, fx.slots);
      const mask = handle.getSliceMask(layer.y, PX_W, PX_H);
      const { polys, slots } = taggedPolygons(fx, layer.y);
      const pure = sliceMaterialMask.rasterizeMaterialLabels(polys, slots, RASTER);
      let unionDiff = 0;
      let pureDiff = 0;
      let white = 0;
      for (let i = 0; i < mask.data.length; i++) {
        if ((labels.data[i] !== 0) !== (mask.data[i] === 1)) unionDiff++;
        if (labels.data[i] !== pure.data[i]) pureDiff++;
        if (mask.data[i]) white++;
      }
      assert(
        unionDiff === 0 && pureDiff === 0 && white > 0 && labels.width === mask.width && labels.height === mask.height,
        `[${fx.name} Y ${layer.y}] handle 라벨 ≠ 0 = getSliceMask 흰 픽셀 ${white} (다른 픽셀 ${unionDiff}), handle 라벨 = Node 라벨 (다른 픽셀 ${pureDiff})`,
      );
    }
    scene.dispose();
  }
  // 2D 미리보기 배선 — 재료 슬롯이 있을 때만 라벨, 아니면 종전 1bpp 그대로
  const prev = read("components", "SliceMaskPreview.tsx");
  assert(
    /if \(materialSlots\) \{\s*const labels = handle\.getSliceMaterialMask\(sliceY, widthPx, heightPx, materialSlots\);/.test(prev) &&
      /const palette = \[materialLabelRgb\(0\), materialLabelRgb\(1\), materialLabelRgb\(2\)\];/.test(prev) &&
      /const mask = handle\.getSliceMask\(sliceY, widthPx, heightPx\);[\s\S]*const v = mask\.data\[i\] \? 255 : 0;/.test(prev) &&
      /\}, \[sceneHandleRef, sliceY, widthPx, heightPx, materialSlots\]\);/.test(prev),
    "SliceMaskPreview: 재료 슬롯이 있으면 getSliceMaterialMask + materialLabelRgb, 없으면 종전 1bpp 흑백, 슬롯이 바뀌면 다시 그림(deps)",
  );
  const pane = read("pages", "viewer", "components", "SliceSectionPane.tsx");
  assert(
    /const MASK_MAX_PX = 512;/.test(pane) && /materialSlots=\{materialSlots\}/.test(pane) &&
      /주황 = 재료 A\(T0\)/.test(pane) && /보라 = 재료 B\(T1\)/.test(pane) && /겹친 곳은 B/.test(pane) &&
      /LCD 1bpp 마스크 \(흰 = 모델 영역\) · \{widthPx\}×\{heightPx\}px/.test(pane),
    "단면 pane: 해상도 상한 512 그대로, 2재료면 범례(주황 = 재료 A(T0) · 보라 = 재료 B(T1) · 겹친 곳은 B), 아니면 종전 문구",
  );
  const page = read("pages", "ViewerV2Page.tsx");
  assert(/<SliceSectionPane[\s\S]*?materialSlots=\{task0Material\.sliceSlots\}[\s\S]*?\/>/.test(page), "ViewerV2Page: 단면 pane 에 슬롯 표(useTask0Material sliceSlots)를 넘기기만");
}

// ── (2) 재료 색 상태 ─────────────────────────────────────────────────────

const A_RGB = task0Material.task0SlotColorRgb("A");
const B_RGB = task0Material.task0SlotColorRgb("B");
const BLUE = MODEL_DIFFUSE_COLOR.asArray();
const WHITE = MODEL_DIFFUSE_COLOR_OVERHANG.asArray();
const colorIs = (c, rgb) => Math.abs(c.r - rgb[0]) < 1e-9 && Math.abs(c.g - rgb[1]) < 1e-9 && Math.abs(c.b - rgb[2]) < 1e-9;
const rgbText = (c) => `(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`;

/**
 * (2) 시나리오 — api = { setState(ctx, slots), applyModel(ctx, id, mesh, overhang), fillMatFor(ctx, tag) }.
 * 정상은 handle·material-display, 대조군 b 는 변조본. 반환: [{ ok, msg }]
 */
function colorScenario(api) {
  const out = [];
  const check = (ok, msg) => out.push({ ok, msg });
  const scene = new Scene(engine);
  const ctx = makeCtx(scene);
  const supMat = ctx.supportMaterialRef.current;
  const supBase = supMat.diffuseColor.clone();
  const tri = (x) => box([x - 1, 0, -1], [x + 1, 1, 1]);
  for (const [id, x] of [["s1", -6], ["s2", 0]]) ctx.meshMapRef.current.set(id, stlMesh(scene, id, tri(x)));
  const addSupport = (id) => {
    const m = meshFromTris(scene, id, box([8, 0, -0.5], [9, 1, 0.5]));
    m.material = supMat; // useSupportMeshSync 의 모든 경로가 공유 머티리얼 하나를 받는다
    ctx.supportMeshMapRef.current.set(id, m);
    return m;
  };
  addSupport("p1");
  const diffuse = (id) => ctx.meshMapRef.current.get(id).material.diffuseColor;

  // useSlicePreview 와 같은 절차 — fill 마다 정체 표식, 머티리얼은 sliceFillMaterialFor ?? 종전
  const makeFills = () => {
    for (const fm of ctx.sliceFillMeshesRef.current) fm.dispose();
    ctx.sliceFillMeshesRef.current = [];
    for (const [stlId, mesh] of ctx.meshMapRef.current) {
      const tag = { kind: "stl", stlId };
      const mat = api.fillMatFor(ctx, tag) ?? ctx.sliceModelMatRef.current;
      for (const p of chainSegments(sliceTrianglesAtY(normalizeTriangleWinding(Float32Array.from(mesh.getVerticesData("position"))), 0.5))) {
        const fill = buildPolygonFillMesh(scene, p, 0.495, mat, "v2_slice_model_fill");
        fill.metadata = { sliceFill: tag };
        ctx.sliceFillMeshesRef.current.push(fill);
      }
    }
    const stag = { kind: "support" };
    const smat = api.fillMatFor(ctx, stag) ?? ctx.sliceSupportMatRef.current;
    for (const sm of ctx.supportMeshMapRef.current.values()) {
      for (const p of chainSegments(sliceTrianglesAtY(normalizeTriangleWinding(Float32Array.from(sm.getVerticesData("position"))), 0.5))) {
        const fill = buildPolygonFillMesh(scene, p, 0.495, smat, "v2_slice_support_fill");
        fill.metadata = { sliceFill: stag };
        ctx.sliceFillMeshesRef.current.push(fill);
      }
    }
  };
  const fillOf = (pred) => ctx.sliceFillMeshesRef.current.filter((f) => pred(f.metadata.sliceFill));
  const slotMats = ctx.sliceSlotMatsRef.current;

  check(colorIs(diffuse("s1"), BLUE) && colorIs(supMat.diffuseColor, supBase.asArray()), "0. 상태 없음 — STL 청록빛 파랑, 서포트 기본색");
  api.setState(ctx, { s1: "A", s2: "B" });
  check(
    colorIs(diffuse("s1"), A_RGB) && colorIs(diffuse("s2"), B_RGB) && colorIs(supMat.diffuseColor, A_RGB),
    `1. 상태 설정 — s1(A) ${rgbText(diffuse("s1"))}, s2(B) ${rgbText(diffuse("s2"))}, 서포트 = A`,
  );
  for (const [id, mesh] of ctx.meshMapRef.current) api.applyModel(ctx, id, mesh, false); // useEditModeSync 재실행 (select)
  for (const [id, mesh] of ctx.meshMapRef.current) api.applyModel(ctx, id, mesh, true); // 서포트 탭 표시로 다시 돌아도
  check(colorIs(diffuse("s1"), A_RGB) && colorIs(diffuse("s2"), B_RGB), "2. 편집 모드 동기화가 다시 돌아도(useEditModeSync 경로) 재료 색 유지 — 부모 effect 순서 무관");
  const s3 = stlMesh(scene, "s3", tri(5)); // 슬라이스 진입 **뒤** 로드가 끝난 STL (useFileMeshSync 경로)
  api.applyModel(ctx, "s3", s3, ctx.editModeRef.current === "support");
  ctx.meshMapRef.current.set("s3", s3);
  check(colorIs(diffuse("s3"), B_RGB), `3. 진입 뒤 로드된 STL(상태에 없는 id) = 기본 B 색 ${rgbText(diffuse("s3"))} — D1b 구멍(원래 파랑으로 남음) 닫힘`);
  ctx.supportMeshMapRef.current.get("p1").dispose();
  const p2 = addSupport("p2");
  ctx.supportMeshMapRef.current.delete("p1");
  check(colorIs(p2.material.diffuseColor, A_RGB), "4. 진입 뒤 다시 만든 서포트 메시 = A 색 (공유 머티리얼이 상태를 따른다)");
  makeFills();
  check(
    fillOf((t) => t.stlId === "s1").every((f) => f.material === slotMats.A) && fillOf((t) => t.stlId === "s2").every((f) => f.material === slotMats.B) &&
      fillOf((t) => t.stlId === "s3").every((f) => f.material === slotMats.B) && fillOf((t) => t.kind === "support").every((f) => f.material === slotMats.A) &&
      ctx.sliceFillMeshesRef.current.length >= 4,
    `5. 단면 fill(useSlicePreview 절차) — s1 A·s2 B·s3 B·서포트 A 슬롯 fill (fill ${ctx.sliceFillMeshesRef.current.length}개)`,
  );
  api.setState(ctx, { s1: "B", s2: "B", s3: "A" });
  check(
    fillOf((t) => t.stlId === "s1").every((f) => f.material === slotMats.B) && fillOf((t) => t.stlId === "s3").every((f) => f.material === slotMats.A) &&
      colorIs(diffuse("s1"), B_RGB) && colorIs(diffuse("s3"), A_RGB),
    "6. 슬롯을 바꾸면 이미 그려진 fill·3D 색이 즉시 바뀐다 (fill 다시 만들지 않음)",
  );
  ctx.editModeRef.current = "support";
  api.setState(ctx, null);
  check(
    ["s1", "s2", "s3"].every((id) => colorIs(diffuse(id), WHITE)) && colorIs(supMat.diffuseColor, supBase.asArray()) &&
      fillOf((t) => t.kind === "stl").every((f) => f.material === ctx.sliceModelMatRef.current) &&
      fillOf((t) => t.kind === "support").every((f) => f.material === ctx.sliceSupportMatRef.current),
    "7. 상태 해제(서포트 탭) — STL 흰색(오버행 색 표시), 서포트 칠하기 전 색, fill 종전 머티리얼",
  );
  ctx.editModeRef.current = "select";
  api.setState(ctx, { s1: "A" });
  api.setState(ctx, null);
  api.setState(ctx, null); // 멱등
  check(
    ["s1", "s2", "s3"].every((id) => colorIs(diffuse(id), BLUE)) && colorIs(supMat.diffuseColor, supBase.asArray()),
    "8. 상태 해제(select) 를 두 번 — STL 청록빛 파랑, 서포트 기본색 (멱등)",
  );
  for (const [id, mesh] of ctx.meshMapRef.current) api.applyModel(ctx, id, mesh, true);
  check(["s1", "s2", "s3"].every((id) => colorIs(diffuse(id), WHITE)), "9. 상태 없음 + 편집 모드 동기화(서포트 탭) = 종전 setModelDiffuseMode(흰색)");
  scene.dispose();
  return out;
}

function sectionColors() {
  console.log("\n(2) 재료 색 상태 — 진입 뒤 로드·서포트 갱신에도 유지, 해제 시 편집 모드별 원래 색");
  const real = {
    setState: (ctx, slots) => buildSliceExportHandle(ctx).setMaterialSlotColors(slots), // 실제 handle 입구
    applyModel: materialDisplay.applyModelDisplayColor,
    fillMatFor: materialDisplay.sliceFillMaterialFor,
  };
  for (const { ok, msg } of colorScenario(real)) assert(ok, msg);
  // 색 결정 순수 함수 — 상태 없음 = setModelDiffuseMode 와 같은 색, 있음 = 슬롯 색(없는 id 는 B)
  const scene = new Scene(engine);
  const probe = stlMesh(scene, "probe", box([0, 0, 0], [1, 1, 1]));
  const sameAsLegacy = [false, true].every((ov) => {
    setModelDiffuseMode(probe, ov);
    return materialDisplay.modelDisplayColor(null, "probe", ov).equals(probe.material.diffuseColor);
  });
  assert(
    sameAsLegacy && colorIs(materialDisplay.modelDisplayColor({ x: "A" }, "x", true), A_RGB) && colorIs(materialDisplay.modelDisplayColor({ x: "A" }, "y", false), B_RGB),
    "modelDisplayColor: 상태 없음 = setModelDiffuseMode 색(서포트 탭 흰색 / 그 밖 파랑), 상태 있음 = 슬롯 색(없는 id 는 B)",
  );
  const c = materialDisplay.modelDisplayColor(null, "probe", false);
  c.r = 0;
  assert(MODEL_DIFFUSE_COLOR.r !== 0, "modelDisplayColor 결과를 바꿔도 stl-loader 상수는 그대로 (새 Color3)");
  scene.dispose();
}

// ── (3) 재료 이름 ────────────────────────────────────────────────────────

/** 정규화 표 — mat = task0-material 모듈(대조군 c 는 변조본). 반환: [{ ok, msg }] */
function nameTable(mat) {
  const n = (raw, fb = "기본") => mat.normalizeTask0MaterialName(raw, fb);
  const k = "가".repeat(30);
  const emoji = "😀".repeat(30);
  const cases = [
    ["앞뒤 공백", n("  모델 레진  "), "모델 레진"],
    ["C0 제어문자(NUL·BEL)", n("A\u0000B\u0007C"), "ABC"],
    ["탭·줄바꿈 → 공백", n("A\tB\nC\r\nD"), "A B C  D"],
    ["C1(NEL → 공백, U+009F 제거)·DEL", n("\u0085앞\u009F뒤\u007F"), "앞뒤"],
    ["줄 구분자 U+2028 → 공백", n("A B"), "A B"],
    ["BOM", n("﻿레진"), "레진"],
    ["짝 없는 서로게이트", n("abc\uD800def\uDC00"), "abcdef"],
    ["빈 문자열 → 기본", n(""), "기본"],
    ["공백·제어문자만 → 기본", n(" \t\u0000\u001F "), "기본"],
    ["문자열 아님 → 기본", `${n(42)}|${n(null)}|${n(undefined)}`, "기본|기본|기본"],
    [`길이 ${mat.TASK0_MATERIAL_NAME_MAX_LENGTH} 코드 포인트`, n(k), "가".repeat(24)],
    ["서로게이트 쌍은 가르지 않음(이모지 30 → 24)", n(emoji), "😀".repeat(24)],
    ["자른 뒤 끝 공백 제거", n(`${"a".repeat(23)} bcd`), "a".repeat(23)],
    ["보통 이름 그대로", n("Formlabs Dental LT V2"), "Formlabs Dental LT V2"],
  ];
  return cases.map(([label, got, want]) => ({ ok: got === want && mat.TASK0_MATERIAL_NAME_MAX_LENGTH === 24, msg: `${label}: ${JSON.stringify(got)}` }));
}

async function sectionNames() {
  console.log("\n(3) 재료 이름 — 정규화·저장값·manifest·repo 왕복·배선");
  for (const { ok, msg } of nameTable(task0Material)) assert(ok, `정규화 — ${msg}`);
  const M = task0Material;
  const r0 = M.resolveTask0MaterialNames(undefined);
  const r1 = M.resolveTask0MaterialNames({ task0MaterialNames: { A: "  베이스\n레진 " } });
  const r2 = M.resolveTask0MaterialNames({ task0MaterialNames: { A: 5, B: "" } });
  const r3 = M.resolveTask0MaterialNames({ task0MaterialNames: "x" });
  assert(
    r0.A === TASK0_DEFAULT_MATERIAL_NAME && r0.B === TASK0_DEFAULT_MATERIAL_NAME_B && r1.A === "베이스 레진" && r1.B === TASK0_DEFAULT_MATERIAL_NAME_B &&
      JSON.stringify(r2) === JSON.stringify(r0) && JSON.stringify(r3) === JSON.stringify(r0) &&
      JSON.stringify(M.TASK0_DEFAULT_MATERIAL_NAMES) === JSON.stringify({ A: TASK0_DEFAULT_MATERIAL_NAME, B: TASK0_DEFAULT_MATERIAL_NAME_B }),
    `해석: 필드 없음 → 기본(${r0.A}/${r0.B}), 저장값은 정규화해 읽음("${r1.A}"), 모르는 값·빈 값 → 기본`,
  );
  const w1 = M.task0MaterialNamesWith(undefined, "A", TASK0_DEFAULT_MATERIAL_NAME);
  const w2 = M.task0MaterialNamesWith(undefined, "B", "  크라운  ");
  const w3 = M.task0MaterialNamesWith({ B: "크라운" }, "A", "베이스");
  const w4 = M.task0MaterialNamesWith({ A: "베이스", B: "크라운" }, "B", "");
  assert(
    w1 === undefined && JSON.stringify(w2) === '{"B":"크라운"}' && JSON.stringify(w3) === '{"A":"베이스","B":"크라운"}' && JSON.stringify(w4) === '{"A":"베이스"}',
    `저장값: 기본 이름이면 필드 없음(${JSON.stringify(w1)}), 정규화해 저장(${JSON.stringify(w2)}), 다른 슬롯 보존(${JSON.stringify(w3)}), 비우면 기본으로(${JSON.stringify(w4)})`,
  );
  const es = M.task0ExportMaterialNames("single", { A: "X", B: "Y" });
  const ed = M.task0ExportMaterialNames("dual", { A: "X", B: "Y" });
  assert(
    Object.keys(es).length === 0 && JSON.stringify(ed) === '{"materialName":"X","materialNameB":"Y"}',
    "내보내기 이름: 단일 재료는 아무것도 안 넘김(manifest 기본 이름 = 단일 바이트 불변), 2재료만 사용자 이름",
  );

  // 코어 — 파일 D 형상(앱 순서), 2재료
  const fx = fixtureDualPillarsPlate();
  const m = fx.meshes();
  const items = [{ triangles: m[4], kind: "stl", stlId: "plate" }, ...m.slice(0, 4).map((t) => ({ triangles: t, kind: "support", stlId: "plate" }))];
  const slots = M.task0ExportMaterialSlots("dual", items, [{ id: "plate", fileName: "plate.stl" }]);
  const meshes = items.map((it) => it.triangles);
  const core = (extra) =>
    runTask0JobZipExport({
      meshes,
      topY: meshesTopY(meshes),
      layerHeightMm: D_LH,
      writer: APP.writer,
      exposure: APP.exposure,
      printable: APP.printable,
      frame: APP.frame,
      generator: TASK0_APP_JOB_GENERATOR,
      generatedAt: D_GENERATED_AT,
      materialSlots: slots,
      ...extra,
    });
  const jd = await core(M.task0ExportMaterialNames("dual", M.resolveTask0MaterialNames(undefined)));
  assert(jd.ok && sha256(jd.zip) === DUAL_ZIP_SHA, `기본 이름(2재료) → D1b 고정 job.zip 그대로 (${jd.ok ? sha256(jd.zip).slice(0, 16) : jd.issues[0]}…)`);
  const jn = await core(M.task0ExportMaterialNames("dual", { A: "베이스 레진", B: "크라운\u0000 레진\u0085" }));
  const man = jn.ok ? await zipManifest(jn.zip) : null;
  const rep = jn.ok ? await verifyTask0JobZip(jn.zip) : null;
  assert(
    man !== null && man.materials[0].name === "베이스 레진" && man.materials[1].name === "크라운 레진" && man.materials[0].tool === "T0" &&
      man.materials[1].tool === "T1" && rep.pass && sha256(jn.zip) !== DUAL_ZIP_SHA,
    `2재료 이름 → manifest materials[].name ${JSON.stringify(man?.materials.map((x) => x.name))} (제어문자 섞인 입력도 코어가 같은 함수로 정규화), 검사기 통과`,
  );
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
  const js = await runTask0JobZipExport({ ...sample, ...M.task0ExportMaterialNames("single", { A: "X", B: "Y" }) });
  assert(js.ok && sha256(js.zip) === SAMPLE_SHA, `단일 재료 모드(사용자 이름이 있어도 안 넘김) → 견본 job.zip 그대로 (${js.ok ? sha256(js.zip).slice(0, 16) : "막힘"}…)`);

  // 실제 워커 모듈 — 앱과 같은 모양의 메시지에 이름
  const posted = [];
  let handler = null;
  const hadSelf = Object.prototype.hasOwnProperty.call(globalThis, "self");
  const prevSelf = globalThis.self;
  globalThis.self = { addEventListener: (type, fn) => (type === "message" ? (handler = fn) : null), postMessage: (msg) => posted.push(msg) };
  try {
    await import(pathToFileURL(path.join(V2, "workers", "slice-batch.worker.ts")).href);
  } finally {
    if (hadSelf) globalThis.self = prevSelf;
    else delete globalThis.self;
  }
  if (typeof handler === "function") {
    await handler({
      data: {
        kind: "task0-jobzip",
        meshes: items.map((it) => ({ ...it })),
        topY: meshesTopY(meshes),
        layerHeightMm: D_LH,
        writer: APP.writer,
        exposure: APP.exposure,
        frame: APP.frame,
        printable: APP.printable,
        generator: TASK0_APP_JOB_GENERATOR,
        generatedAt: D_GENERATED_AT,
        materialSlots: slots,
        ...M.task0ExportMaterialNames("dual", { A: "베이스 레진", B: "크라운 레진" }),
      },
    });
    const done = posted.find((x) => x.type === "task0-job-done");
    const wm = done?.result.ok ? await zipManifest(done.result.zip) : null;
    assert(
      wm !== null && wm.materials[0].name === "베이스 레진" && wm.materials[1].name === "크라운 레진" && sha256(done.result.zip) === sha256(jn.zip),
      "실제 워커 모듈: task0-jobzip 메시지의 materialName·materialNameB → manifest 이름 (코어 직접 호출과 같은 zip)",
    );
  } else assert(false, "워커 모듈이 message 리스너를 등록하지 않음");

  // repo 왕복 (가짜 IndexedDB)
  const fake = installFakeIndexedDB();
  const dbMod = await import(pathToFileURL(path.join(V2, "data", "db.ts")).href);
  const projects = await import(pathToFileURL(path.join(V2, "data", "projects.repo.ts")).href);
  const archive = await import(pathToFileURL(path.join(V2, "utils", "project-archive.ts")).href);
  const p = await projects.createProject({ name: "재료 이름 시험" });
  const db = fake.databases.get(dbMod.DB_NAME);
  const indexes = Object.fromEntries([...db.stores].map(([nm, s]) => [nm, [...s.indexes.keys()].sort()]));
  assert(
    dbMod.DB_VERSION === 4 && db.version === 4 && JSON.stringify([...db.stores.keys()].sort()) === '["projects","stl_files","supports"]' &&
      JSON.stringify(indexes) === JSON.stringify({ projects: ["by_code", "by_lastModifiedAt"], stl_files: ["by_addedAt", "by_project"], supports: ["by_base_stl", "by_project", "by_stl"] }),
    `IndexedDB 스키마 그대로 — 버전 ${db.version}, 스토어·인덱스 ${JSON.stringify(indexes)}`,
  );
  assert(!("task0MaterialNames" in p) && JSON.stringify(M.resolveTask0MaterialNames(await projects.getProject(p.id))) === JSON.stringify(r0), "새 프로젝트 레코드에 이름 필드 없음 → 기본 이름");
  await projects.updateProject(p.id, { task0MaterialMode: "dual" });
  await projects.updateProject(p.id, { task0MaterialNames: M.task0MaterialNamesWith(undefined, "A", " 베이스\t레진 ") });
  const back = await projects.getProject(p.id);
  assert(
    JSON.stringify(back.task0MaterialNames) === '{"A":"베이스 레진"}' && back.task0MaterialMode === "dual" && back.name === "재료 이름 시험" &&
      M.resolveTask0MaterialNames(back).A === "베이스 레진" && M.resolveTask0MaterialNames(back).B === TASK0_DEFAULT_MATERIAL_NAME_B,
    `updateProject(task0MaterialNames) → getProject ${JSON.stringify(back.task0MaterialNames)}, 재료 모드·이름 등 다른 필드 그대로`,
  );
  await projects.putProject({ id: "old-p", name: "옛 프로젝트", code: "OLD00002", createdAt: 1, lastModifiedAt: 1 });
  assert(JSON.stringify(M.resolveTask0MaterialNames(await projects.getProject("old-p"))) === JSON.stringify(r0), "옛 레코드(필드 없음) → 기본 이름");
  const imp = await archive.importProjectArchive(await archive.exportProjectArchive(p.id), "new");
  const np = await projects.getProject(imp.projectId);
  assert(JSON.stringify(np.task0MaterialNames) === '{"A":"베이스 레진"}' && imp.projectId !== p.id, ".mzalign 내보내기 → 가져오기('new') 에도 이름 보존");

  // 화면 배선 (소스)
  const card = read("components", "Task0MaterialCard.tsx");
  const input = card.slice(card.indexOf("function MaterialNameInput("), card.indexOf("/** A / B 고르기"));
  assert(
    /onChange=\{\(e\) => setDraft\(e\.target\.value\)\}/.test(input) && /onBlur=\{commit\}/.test(input) &&
      /e\.key === "Enter" && !e\.nativeEvent\.isComposing/.test(input) && /disabled=\{disabled\}/.test(input) &&
      /normalizeTask0MaterialName\(draft, TASK0_DEFAULT_MATERIAL_NAMES\[slot\]\)/.test(input) && (input.match(/onCommit\(/g) ?? []).length === 1 &&
      /value=\{names\.A\}/.test(card) && /value=\{names\.B\}/.test(card) && /서포트는 항상 A/.test(card),
    "재료 카드: 이름 칸은 타이핑 중 칸 상태만, blur·Enter(한글 조합 중 제외)에서 정규화 후 한 번 저장, 내보내기 중 잠금",
  );
  const tm = read("pages", "viewer", "hooks", "useTask0Material.ts");
  assert(
    /updateProject\(\{ task0MaterialNames: next \}\)/.test(tm) && /const next = task0MaterialNamesWith\(storedNames, slot, raw\);/.test(tm) &&
      /if \(after\.A === nameA && after\.B === nameB\) return;/.test(tm) && /names: \{ A: nameA, B: nameB \},\s*onNameChange: setName,/.test(tm),
    "useTask0Material: 이름은 repo 경유(useProjectV2.update), 바뀔 때만 저장, 카드에 표시값·저장 함수",
  );
  const hook = read("pages", "viewer", "hooks", "useSliceExport.ts");
  const job = hook.slice(hook.indexOf("const handleExportTask0JobZip"), hook.indexOf("const handleExportTask0Gcode"));
  const gc = hook.slice(hook.indexOf("const handleExportTask0Gcode"), hook.lastIndexOf("return {"));
  const deps = job.slice(job.lastIndexOf("}, ["));
  assert(
    /\.\.\.task0ExportMaterialNames\(task0MaterialMode, \{ A: task0NameA, B: task0NameB \}\),/.test(job) && /\n\s*task0NameA,\n\s*task0NameB,\n/.test(deps) &&
      !/task0ExportMaterialNames/.test(gc) && /const task0MaterialNames = resolveTask0MaterialNames\(project\);/.test(hook),
    "useSliceExport: job.zip 핸들러만 이름을 넘기고 deps 에 이름(규칙 7) — run.gcode 에는 이름 없음",
  );
  const worker = read("workers", "slice-batch.worker.ts");
  const msgs = read("workers", "slice-batch.messages.ts");
  assert(
    /materialName: req\.materialName,\s*materialNameB: req\.materialNameB,/.test(worker) && /materialName\?: string;\s*materialNameB\?: string;/.test(msgs),
    "워커·메시지: Task0JobZipRequest 의 materialName·materialNameB 를 코어로 그대로",
  );
}

// ── (4) 복제·붙여넣기 슬롯 상속 ──────────────────────────────────────────

function copyTable(mat) {
  const f = mat.task0CopySlotInit;
  return (
    JSON.stringify(f({ materialSlot: "A" })) === '{"materialSlot":"A"}' && JSON.stringify(f({ materialSlot: "B" })) === '{"materialSlot":"B"}' &&
    JSON.stringify(f({})) === "{}" && JSON.stringify(f(undefined)) === "{}" && JSON.stringify(f(null)) === "{}" && JSON.stringify(f({ materialSlot: "C" })) === "{}"
  );
}

/** 복제·클립보드 경로 따라 하기 — 같은 함수(addCopySuffix·task0CopySlotInit)·같은 repo 호출. mat = task0-material(대조군 d 는 변조본) */
async function copyPath(mat, stls, pid) {
  const blob = new Blob([new Uint8Array(84)]);
  const src = await stls.createStlFile(pid, "crown.stl", blob, { materialSlot: "A" });
  const files = await stls.listStlFilesByProject(pid);
  // handleDuplicateSelected: addStlFile(addCopySuffix(src.fileName, files), src.blob, task0CopySlotInit(src))
  const dup = await stls.createStlFile(pid, addCopySuffix(src.fileName, files), src.blob, mat.task0CopySlotInit(src));
  // handleCopy → handlePaste: { fileName, blob, ...task0CopySlotInit(f) } → addStlFile(…, item.blob, task0CopySlotInit(item))
  const item = { fileName: src.fileName, blob: src.blob, ...mat.task0CopySlotInit(src) };
  const pasted = await stls.createStlFile(pid, addCopySuffix(item.fileName, await stls.listStlFilesByProject(pid)), item.blob, mat.task0CopySlotInit(item));
  const d = await stls.getStlFile(dup.id);
  const pz = await stls.getStlFile(pasted.id);
  return { ok: d.materialSlot === "A" && pz.materialSlot === "A" && d.fileName === "crown (copy).stl", d, pz };
}

/** 복제·복사·잘라내기·붙여넣기 배선 (소스) — 대조군 d 가 변조 소스로 부른다 */
function copyWiringOk(sup, clip, stlHook, drop) {
  const dupBody = sup.slice(sup.indexOf("const handleDuplicateSelected"), sup.indexOf("// ----- 우클릭 컨텍스트 메뉴"));
  return (
    /addStlFile\(\s*addCopySuffix\(src\.fileName, files\),\s*src\.blob,\s*task0CopySlotInit\(src\),\s*\)/.test(dupBody) && !/useUndoStore/.test(dupBody) &&
    /\.map\(\(f\) => \(\{ fileName: f\.fileName, blob: f\.blob, \.\.\.task0CopySlotInit\(f\) \}\)\)/.test(clip) &&
    /\.set\(toCut\.map\(\(f\) => \(\{ fileName: f\.fileName, blob: f\.blob, \.\.\.task0CopySlotInit\(f\) \}\)\)\)/.test(clip) &&
    /addStlFile\(\s*addCopySuffix\(item\.fileName, files\),\s*item\.blob,\s*task0CopySlotInit\(item\),\s*\)/.test(clip) &&
    /repo\.createStlFile\(projectId, fileName, blob, init\)/.test(stlHook) &&
    /addStlFile\(file\.name, file\)/.test(drop) && /addStlFile\(def\.fileName, def\.build\(\)\)/.test(drop)
  );
}

async function sectionCopy() {
  console.log("\n(4) 복제·붙여넣기 슬롯 상속");
  assert(copyTable(task0Material), "task0CopySlotInit: A → {A}, B → {B}, 없음·null·모르는 값 → {} (필드 없음 = 기본 B)");
  const projects = await import(pathToFileURL(path.join(V2, "data", "projects.repo.ts")).href);
  const stls = await import(pathToFileURL(path.join(V2, "data", "stl-files.repo.ts")).href);
  const p = await projects.createProject({ name: "복제 시험" });
  const blob = new Blob([new Uint8Array(84)]);
  const plain = await stls.getStlFile((await stls.createStlFile(p.id, "new.stl", blob)).id);
  const bad = await stls.getStlFile((await stls.createStlFile(p.id, "bad.stl", blob, { materialSlot: "C" })).id);
  assert(!("materialSlot" in plain) && !("materialSlot" in bad), "repo createStlFile: init 없음(드롭·예제)·모르는 값 → 필드 없음 (종전 레코드와 같다)");
  const r = await copyPath(task0Material, stls, p.id);
  assert(r.ok, `A 원본 → 복제본 ${r.d.materialSlot}("${r.d.fileName}")·붙여넣기 ${r.pz.materialSlot} (같은 함수·repo 경로)`);
  const sup = read("pages", "viewer", "hooks", "useSupportEditing.ts");
  const clip = read("pages", "viewer", "hooks", "useClipboardActions.ts");
  const stlHook = read("hooks", "useStlFilesV2.ts");
  const drop = read("pages", "viewer", "hooks", "useStlDropImport.ts");
  assert(copyWiringOk(sup, clip, stlHook, drop), "배선: 복제·복사·잘라내기·붙여넣기가 원본 슬롯을 넘기고(repo 경유), 드롭·예제는 안 넘김, 복제 undo 구조 그대로(이력 없음)");
  return { stls, pid: p.id, sup, clip, stlHook, drop };
}

// ── (5) 실패 이유 ────────────────────────────────────────────────────────

function ringPlusInput() {
  const ring = fixtureClosedRing().meshes();
  const meshes = [ring[0], ring[1], box([10, 0, -2], [13, 1, 2])];
  return { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1, writer: APP.writer, printable: APP.printable, materialSlots: ["A", "B", "B"] };
}
function ringInput() {
  const ring = fixtureClosedRing();
  const meshes = ring.meshes();
  return { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1, writer: APP.writer, printable: APP.printable, materialSlots: ring.slots };
}
function baRingInput() {
  const ring = fixtureClosedRing().meshes();
  return {
    meshes: ring,
    topY: meshesTopY(ring),
    layerHeightMm: 0.1,
    writer: { ...APP.writer, dualMaterial: { order: "BA" } },
    printable: APP.printable,
    materialSlots: ["B", "A"],
  };
}

/** (5) 이유 판정 — core = task0-export 모듈(대조군 e 는 변조본). 반환: [{ ok, msg }] */
function reasonChecks(core) {
  const out = [];
  const trappedHead = "재료 B(T1)가 재료 A(T0)에 둘러싸여 T1 로 들어갈 길이 없는 층 10개";
  const r = core.runTask0GcodeExport(ringInput());
  out.push({
    ok: !r.ok && r.issues.some((s) => s.startsWith(trappedHead) && s.includes("T1 패스에서 길이 없는 도포 항목") && s.includes("협의 §31-4")) && !r.issues.some((s) => s.includes("맞물린")),
    msg: `A 고리 안 B → 갇힌 B "${r.ok ? "(통과)" : r.issues[0].slice(0, 44)}…"`,
  });
  const rp = core.runTask0GcodeExport(ringPlusInput());
  out.push({
    ok: !rp.ok && rp.issues.some((s) => s.startsWith(trappedHead)) && !rp.issues.some((s) => s.includes("맞물린")) && (rp.summary?.dual?.depositMmByTool[1] ?? 0) > 0,
    msg: `A 고리 안 B + 고리 밖 B(T1 도포 ${rp.summary?.dual?.depositMmByTool[1].toFixed(1)} mm — 일부 B 는 칠함) → 갇힌 B "${rp.ok ? "(통과)" : rp.issues[0].slice(0, 30)}…"`,
  });
  const ba = core.runTask0GcodeExport(baRingInput());
  out.push({
    ok: !ba.ok && ba.issues.some((s) => s.startsWith("두 재료가 맞물린 단면에서") && /\(T0 패스 [1-9]\d*개 · T1 패스 0개\)/.test(s)) && !ba.issues.some((s) => s.includes("둘러싸여")),
    msg: `B 고리 안 A + 순서 'BA'(T0 패스 경로 없음) → 다른 문구 "${ba.ok ? "(통과)" : ba.issues[0].slice(0, 60)}…"`,
  });
  return out;
}

function sectionReasons() {
  console.log("\n(5) 실패 이유 — writer 툴 패스별 경로 없는 항목, G-code 바이트 불변");
  // writer 통계 — unreachableByTool 합 = unreachable, 모양 = byTool
  const cases = [
    ...[fixtureCube10(), fixtureGapPlates(), fixtureFileB()].map((fx) => ({ name: fx.name, meshes: fx.meshes(), lh: 0.1 })),
    { name: "파일 D", meshes: fixtureDualPillarsPlate().meshes(), lh: D_LH, dual: { slots: fixtureDualPillarsPlate().slots } },
    { name: "A 고리 안 B", ...(() => { const i = ringInput(); return { meshes: i.meshes, lh: 0.1, dual: { slots: i.materialSlots } }; })() },
    { name: "고리 밖 B 추가", ...(() => { const i = ringPlusInput(); return { meshes: i.meshes, lh: 0.1, dual: { slots: i.materialSlots } }; })() },
    { name: "B 고리 안 A ('BA')", ...(() => { const i = baRingInput(); return { meshes: i.meshes, lh: 0.1, dual: { slots: i.materialSlots, order: "BA" } }; })() },
    { name: "구 + 기둥(seed 1000)", ...(() => { const s = sphereSeedModel(1000); return { meshes: s.meshes, lh: 0.1, dual: { slots: s.slots } }; })() },
  ];
  const results = {};
  for (const c of cases) {
    const r = generateTask0Gcode(c.meshes, meshesTopY(c.meshes), c.lh, c.dual ? { dualMaterial: c.dual } : {});
    results[c.name] = r;
    const bad = r.layers.filter((s) => !Array.isArray(s.unreachableByTool) || s.unreachableByTool.length !== s.byTool.length || s.unreachableByTool.reduce((a, b) => a + b, 0) !== s.unreachable);
    const tot = r.layers.reduce((acc, s) => [acc[0] + (s.unreachableByTool[0] ?? 0), acc[1] + (s.unreachableByTool[1] ?? 0)], [0, 0]);
    assert(bad.length === 0, `[${c.name}] 층 ${r.layers.length}개 전부 unreachableByTool(길이 = byTool ${r.layers[0]?.byTool.length}) 합 = unreachable — 합계 T0 ${tot[0]} · T1 ${tot[1]} = ${r.totals.unreachable}`);
  }
  const ring = results["A 고리 안 B"];
  const plus = results["고리 밖 B 추가"];
  const baR = results["B 고리 안 A ('BA')"];
  assert(
    ring.totals.thinFillFailedLayers.length === 10 && ring.layers.every((s) => s.unreachableByTool[0] === 0 && s.unreachableByTool[1] > 0) &&
      plus.totals.thinFillFailedLayers.length === 10 && plus.layers.every((s) => s.unreachableByTool[1] > 0 && s.byTool[1].segments > 0) &&
      baR.totals.thinFillFailedLayers.length === 10 && baR.layers.every((s) => s.unreachableByTool[0] > 0 && s.unreachableByTool[1] === 0),
    "픽스처 통계: 고리 안 B = T1 패스만 막힘, 고리 밖 B 추가 = T1 패스 막힘 + T1 도포 있음(D1b 휴리스틱이 놓치던 층), 'BA' 고리 안 A = T0 패스만 막힘",
  );
  for (const { ok, msg } of reasonChecks({ runTask0GcodeExport })) assert(ok, msg);
  // G-code 바이트 불변
  assert(sha256(results["파일 D"].gcode) === FILE_D_SHA, `파일 D(writer 직접) sha256 그대로 (${sha256(results["파일 D"].gcode).slice(0, 16)}…)`);
  for (const fx of [fixtureCube10(), fixtureGapPlates(), fixtureFileB()]) {
    const meshes = fx.meshes();
    const r = runTask0GcodeExport({ meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1, writer: APP.writer, exposure: APP.exposure, printable: APP.printable });
    assert(r.ok && sha256(r.gcode) === SINGLE_SHA[fx.name] && sha256(results[fx.name].gcode) === SINGLE_SHA[fx.name], `단일 ${fx.name}: 코어·writer run.gcode sha256 그대로`);
  }
}

// ── (6) 배선 — BabylonScene 훅·dispose 순서, 색을 정하는 지점 ─────────────

function sectionWiring() {
  console.log("\n(6) 배선 — BabylonScene 훅 호출·dispose 순서(§5), STL 표시 색을 정하는 지점");
  const scene = stripComments(read("components", "BabylonScene.tsx"));
  const body = scene.slice(scene.indexOf("function BabylonScene(props, ref) {"));
  const hooks = [...body.matchAll(/\b(use[A-Z]\w*)\(/g)].map((m) => m[1]);
  const want = [
    "useSceneRefs", "useSupportPartsReady", "useSceneBootstrap", "useState", "useFileMeshSync", "useSupportMeshSync", "useSelectionSync",
    "useSlicePreview", "useBridgeVisualization", "useEditModeSync", "useDentalBrush", "useBuildVolumeCheck", "useAlignFloorHover", "useImperativeHandle",
  ];
  assert(JSON.stringify(hooks) === JSON.stringify(want), `BabylonScene 훅 호출 순서 그대로 (새 훅 없음): ${hooks.join(" → ")}`);
  const disp = stripComments(read("components", "babylon", "hooks", "dispose-scene.ts"));
  const marks = [
    "ctx.isUnmountingRef.current = true;",
    'window.removeEventListener("resize", onResize);',
    "resizeObserver?.disconnect();",
    "ctx.positionGizmoRef.current?.dispose();",
    "ctx.utilityLayerRef.current?.dispose();",
    "sm.dispose();",
    "ctx.supportMaterialRef.current?.dispose();",
    "ctx.sliceOutlineRef.current?.dispose();",
    "for (const fm of ctx.sliceFillMeshesRef.current) fm.dispose();",
    "ctx.bridgeMarkerRef.current?.dispose();",
    "ctx.bridgeMarkerMatRef.current?.dispose();",
    "ctx.sliceModelMatRef.current?.dispose();",
    "ctx.sliceSupportMatRef.current?.dispose();",
    "ctx.sliceSlotMatsRef.current?.A.dispose();",
    "ctx.sliceSlotMatsRef.current?.B.dispose();",
    "mesh.dispose();",
    "ctx.furnitureRef.current?.dispose();",
    "hl.dispose();",
    "scene.dispose();",
    "engine.dispose();",
  ];
  const at = marks.map((s) => disp.indexOf(s));
  const once = marks.every((s) => disp.split(s).length === 2);
  assert(
    once && at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1])),
    "dispose 순서 그대로 — 슬롯 fill 머티리얼은 기존 단면 머티리얼 바로 뒤(STL 메시 앞), scene.dispose → engine.dispose 맨 끝",
  );
  const boot = read("components", "babylon", "hooks", "useSceneBootstrap.ts");
  const iSupport = boot.indexOf('"v2_slice_support_mat"');
  const iSlots = boot.indexOf("ctx.sliceSlotMatsRef.current = {");
  const iHl = boot.indexOf('new HighlightLayer("v2_highlight"');
  assert(
    iSupport > 0 && iSlots > iSupport && iHl > iSlots &&
      /A: createSliceFillMaterial\(\s*scene,\s*Color3\.FromArray\(task0SlotColorRgb\("A"\)\),\s*"v2_slice_slot_a_mat",\s*\)/.test(boot) &&
      /B: createSliceFillMaterial\(\s*scene,\s*Color3\.FromArray\(task0SlotColorRgb\("B"\)\),\s*"v2_slice_slot_b_mat",\s*\)/.test(boot),
    "부트스트랩: 슬롯 fill 머티리얼 2개를 기존 단면 머티리얼 바로 뒤에서 1회 (색 = TASK0_SLOT_COLOR_HEX)",
  );
  const refs = read("components", "babylon", "scene-refs.ts");
  assert(
    /const materialSlotColorsRef = useRef<Readonly<Record<string, Task0MaterialSlot>> \| null>\(null\);/.test(refs) &&
      /const sliceSlotMatsRef = useRef<Record<Task0MaterialSlot, SliceFillMaterial> \| null>\(null\);/.test(refs),
    "SceneCtx: 재료 색 상태(처음엔 없음)·슬롯 fill 머티리얼 ref",
  );
  // STL 표시 색을 정하는 지점 — setModelDiffuseMode 직접 호출은 정의(stl-loader)와 material-display 밖에 없다
  const callers = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /setModelDiffuseMode\(/.test(stripComments(fs.readFileSync(p, "utf8")))) callers.push(path.relative(V2, p).replace(/\\/g, "/"));
    }
  };
  walk(V2);
  assert(
    JSON.stringify(callers.sort()) === JSON.stringify(["components/babylon/material-display.ts", "utils/stl-loader.ts"]),
    `setModelDiffuseMode 를 부르는 곳 = ${callers.join(", ")} (나머지는 전부 applyModelDisplayColor 경유)`,
  );
  const ems = read("components", "babylon", "hooks", "useEditModeSync.ts");
  const fms = read("components", "babylon", "hooks", "useFileMeshSync.ts");
  const sp = read("components", "babylon", "hooks", "useSlicePreview.ts");
  const h = read("components", "babylon", "handle", "slice-export-handle.ts");
  assert(
    /applyModelDisplayColor\(ctx, id, mesh, showOverhang\);/.test(ems) && /\}, \[editMode, files, supports, sliceLocked\]\);/.test(ems) &&
      /applyModelDisplayColor\(ctx, f\.id, mesh, ctx\.editModeRef\.current === "support"\);/.test(fms) &&
      /const fillMat = sliceFillMaterialFor\(ctx, tag\) \?\? modelMat;/.test(sp) && /const supportFillMat = sliceFillMaterialFor\(ctx, supportTag\) \?\? supportMat;/.test(sp) &&
      (sp.match(/fill\.metadata = \{ sliceFill: /g) ?? []).length === 2 && /\}, \[sliceY, files, supports, supportParams\]\);/.test(sp) &&
      /setMaterialSlotColors\(slots\) \{[\s\S]*?setMaterialSlotState\(ctx, slots\);\s*\},/.test(h),
    "useEditModeSync·useFileMeshSync 로드 완료 → applyModelDisplayColor, useSlicePreview fill → sliceFillMaterialFor + 정체 표식, handle → setMaterialSlotState (deps 그대로)",
  );
  const mask = h.slice(h.indexOf("    getSliceMask(sliceY, widthPx, heightPx) {"), h.indexOf("    getSliceMaterialMask("));
  assert(
    /for \(const mesh of ctx\.meshMapRef\.current\.values\(\)\) \{\s*const segs = sliceMeshAtY\(mesh, sliceY\);\s*polys\.push\(\.\.\.chainSegments\(segs\)\);\s*\}\s*for \(const sm of ctx\.supportMeshMapRef\.current\.values\(\)\) \{\s*const segs = sliceMeshAtY\(sm, sliceY\);\s*polys\.push\(\.\.\.chainSegments\(segs\)\);\s*\}\s*return rasterizePolygons\(polys, \{/.test(mask),
    "handle getSliceMask 무변경 (1bpp — 단일·다른 프로파일 화면 그대로)",
  );
  const tm = read("pages", "viewer", "hooks", "useTask0Material.ts");
  assert(
    /const slotKey = JSON\.stringify\(files\.map\(\(f\) => \[f\.id, resolveStlMaterialSlot\(f\)\]\)\);/.test(tm) && /if \(!\(sliceOn && dualActive\)\) return null;/.test(tm) &&
      /\}, \[sliceOn, dualActive, slotKey\]\);/.test(tm) && /sceneHandleRef\.current\?\.setMaterialSlotColors\(sliceSlots\);\s*\}, \[sliceSlots, sceneHandleRef\]\);/.test(tm) &&
      !/다시 칠한다\(자식 effect 가 먼저 돈다\)/.test(tm),
    "useTask0Material: 슬롯 표는 내용(id·슬롯) 키로 memo — 바뀔 때만 handle(멱등), 슬라이스 화면 + 2재료 밖이면 null, '부모 effect 가 다시 칠한다' 의존 없음",
  );
}

// ── (7) 대조군 ───────────────────────────────────────────────────────────

async function sectionControls(copyCtx) {
  console.log("\n(7) 대조군 — 변조하면 위 단언이 실제로 실패하는가");
  // a. 겹침 A 우선
  const aPri = await loadMutant("a-priority", "utils/slice-material-mask.ts", [
    ["  const maskB = polysB.length > 0 ? rasterizePolygons(polysB, opts) : null;", "  const maskB = polysB.length > 0 ? rasterizePolygons(polysB, opts) : null;\n  const maskA = rasterizePolygons(polygons.filter((_, k) => slots[k] === \"A\"), opts);"],
    ["    data[i] = maskB !== null && maskB.data[i] ? 2 : 1;", "    data[i] = maskA.data[i] ? 1 : maskB !== null && maskB.data[i] ? 2 : 1;"],
  ]);
  const aRes = labelChecks(aPri);
  assert(aRes.some((r) => !r.ok), `a. 겹침을 A 우선으로 바꾸면 (1) 이 실패 (${aRes.filter((r) => !r.ok).length}/${aRes.length} 층)`);
  // b. 재료 색 상태 무시
  const noState = await loadMutant("ignore-state", "components/babylon/material-display.ts", [
    ["  const slots = ctx.materialSlotColorsRef.current;\n  if (slots === null) {\n    setModelDiffuseMode(mesh, overhang);", "  const slots = ctx.materialSlotColorsRef.current;\n  if (slots === null || true) {\n    setModelDiffuseMode(mesh, overhang);"],
  ]);
  const bRes = colorScenario({ setState: noState.setMaterialSlotState, applyModel: noState.applyModelDisplayColor, fillMatFor: noState.sliceFillMaterialFor });
  // 상태를 읽어야 맞는 단계(1 설정·2 편집 모드 재실행·3 진입 뒤 로드)가 실패해야 한다
  assert(
    !bRes[1].ok && !bRes[2].ok && !bRes[3].ok,
    `b. 재료 색 상태를 무시(항상 setModelDiffuseMode)하면 (2) 가 실패 — 실패 단계 ${bRes.filter((r) => !r.ok).map((r) => r.msg.slice(0, 2)).join(" ")}`,
  );
  // c. 제어문자 통과
  const noCtrl = await loadMutant("name-no-control", "utils/task0/task0-material.ts", [
    ["  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0xfeff || (cp >= 0xd800 && cp <= 0xdfff);", "  return false;"],
  ]);
  const cRes = nameTable(noCtrl);
  assert(cRes.some((r) => !r.ok), `c. 이름 정규화가 제어문자를 거르지 않으면 (3) 정규화 표가 실패 (${cRes.filter((r) => !r.ok).length}건)`);
  // d. 복제가 슬롯을 안 넘김
  const noInherit = await loadMutant("copy-no-slot", "utils/task0/task0-material.ts", [
    ["  return s === 'A' || s === 'B' ? { materialSlot: s } : {};", "  return {};"],
  ]);
  const dPath = await copyPath(noInherit, copyCtx.stls, copyCtx.pid);
  const supNoArg = copyCtx.sup.replace("        src.blob,\n        task0CopySlotInit(src),\n", "        src.blob,\n");
  assert(
    !copyTable(noInherit) && !dPath.ok && supNoArg !== copyCtx.sup && !copyWiringOk(supNoArg, copyCtx.clip, copyCtx.stlHook, copyCtx.drop),
    `d. task0CopySlotInit 가 {} 를 내면 복제본 ${dPath.d.materialSlot ?? "(없음 = B)"} — (4) 실패, 복제 핸들러에서 인자를 빼면 배선 검사 실패`,
  );
  // e. 갇힌 B 판정을 D1b 휴리스틱으로
  const oldRule = await loadMutant("trapped-heuristic", "utils/task0/task0-export.ts", [
    ["    else if (abOrder && stuckT1 > 0) {", "    else if (abOrder && s.byTool[1].segments === 0) {"],
  ]);
  const eRes = reasonChecks(oldRule);
  assert(!eRes[1].ok, `e. 갇힌 B 판정을 옛 휴리스틱("T1 도포 0")으로 되돌리면 고리 밖 B 배치가 "맞물림" 으로 읽혀 (5) 실패 — ${eRes[1].msg.slice(0, 60)}…`);
}

// ── (8) 성능 참고 ────────────────────────────────────────────────────────

function sectionPerf() {
  if (process.env.TASK0_PERF !== "1") return;
  console.log("\n(8) 성능 참고 (TASK0_PERF=1 — 판정 없음): 2D 단면 한 층, 512×288 (Node·NullEngine — 메인스레드 동기 호출과 같은 함수)");
  const s = sphereSeedModel(1000);
  // 큰 모델 — 구 지름 40(위도 300 × 경도 400 띠) STL B + 기둥 서포트 25개 A
  const big = { meshes: [normalizeTriangleWinding(sphereTriangles(0, 22, 0, 20, 300, 400))], slots: ["B"] };
  for (let i = 0; i < 25; i++) {
    big.meshes.push(normalizeTriangleWinding(pillarTriangles(-12 + 6 * (i % 5), -12 + 6 * Math.floor(i / 5), 0.5, 0, 6)));
    big.slots.push("A");
  }
  for (const [name, model, topY] of [["구 + 기둥(seed 1000)", s, 7], ["큰 구 + 기둥 25", big, 42]]) {
    const scene = new Scene(engine);
    const ctx = makeCtx(scene);
    ctx.plateWRef.current = 160;
    ctx.plateDRef.current = 90;
    model.meshes.forEach((t, i) => {
      if (model.slots[i] === "B") ctx.meshMapRef.current.set(`stl${i}`, stlMesh(scene, `stl${i}`, t));
      else ctx.supportMeshMapRef.current.set(`sup${i}`, meshFromTris(scene, `sup${i}`, t));
    });
    const tris = model.meshes.reduce((a, t) => a + t.length / 9, 0);
    const handle = buildSliceExportHandle(ctx);
    const ys = Array.from({ length: 30 }, (_, k) => 0.05 + (k * topY) / 30);
    const slots = Object.fromEntries([...ctx.meshMapRef.current.keys()].map((id) => [id, "B"]));
    for (let rep = 0; rep < 2; rep++) {
      const t0 = performance.now();
      for (const y of ys) handle.getSliceMask(y, 512, 288);
      const t1 = performance.now();
      for (const y of ys) handle.getSliceMaterialMask(y, 512, 288, slots);
      const t2 = performance.now();
      console.log(
        `  ${name}(삼각형 ${tris}, 메시 ${model.meshes.length})${rep === 0 ? " (예열)" : ""}: 1bpp ${((t1 - t0) / ys.length).toFixed(2)} ms/층, ` +
          `2재료 라벨 ${((t2 - t1) / ys.length).toFixed(2)} ms/층`,
      );
    }
    scene.dispose();
  }
}

async function main() {
  console.log("Task0 2재료 D2 검증 — 2색 슬라이스 미리보기·재료 색 상태·재료 이름·복제 슬롯 상속·실패 이유 (규격서 v0.3.4)");
  sectionLabels();
  sectionColors();
  await sectionNames();
  const copyCtx = await sectionCopy();
  sectionReasons();
  sectionWiring();
  await sectionControls(copyCtx);
  sectionPerf();
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
