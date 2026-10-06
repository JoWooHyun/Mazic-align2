// Task0 견본 job.zip + 불량 7종 생성 (로드맵 0절 2주차 — 협의 §26-3·§27, 10/8 전달분).
//
//   만드는 것 (조립 = src/features/v2/utils/task0/task0-jobzip.ts buildTask0JobZip, 규격서 v0.3.3 §11 @ dfdf08c):
//     sample.job.zip   3층 견본. 10×10 mm 판 두 장(높이 0~0.1, 0.2~0.3 mm), lh 0.1 → 단면 0.05·0.15·0.25 →
//                      층 1(0-based) 이 두 판 사이 틈이라 빈 층(run.gcode 는 마커 + ;Z: + ;HEIGHT: + G1 Z 만, PNG 전부 0).
//                      자리 = 출력 가능 영역 가운데(파일 A 와 같은 자리 — world x·z 0~10 = 베드 X 75~85 × Y 42.5~52.5).
//                      w 0.5, K 165(잠정), 노광 2.5 s · 바닥 30 s (types/printer.ts DEFAULT_*), bottomLayerCount 1
//                      (3층 견본에 기본 5 를 쓰면 전 층이 바닥 노광이 되어 바닥/일반 구분이 안 보인다 — 협의 §26-3).
//                      topY 는 설계 높이 0.3 을 그대로 준다: float32 로 저장된 꼭짓점 높이(0.30000001)로 재면
//                      ceil(0.30000001 / 0.1) = 4 층이 된다(맨 위 빈 층 하나 추가 — Z3 참고 사항).
//                      generatedAt 은 고정값(SAMPLE_GENERATED_AT) — 같은 입력이면 같은 바이트.
//     bad_N_*.job.zip  규격 §11 거부 조건 N 하나만 어긴 zip 7개 (협의 §27-1 — 이름에 조건 번호, 한 zip 에 한 조건).
//                      sample 의 파일 목록을 고쳐 다시 묶는다 — 어떻게 고쳤는지는 BAD_SPECS·README.txt.
//     README.txt       조건(w·K·lh·노광)·파일별 내용·Task0 가 거부해야 할 이유·크기·sha256·검증기 결과 (협의 §27-2).
//
//   쓰기 전 검사: sample 은 verifyTask0JobZip 결과 위반 없음·추가 검사 0건 + 견본 단언(PNG 3장 1920×1080 8-bit 회색조,
//   층 1 전부 0, 층 0·2 흰 픽셀 있음, run.gcode 파서 print 경고·오류 0), bad_N 은 위반이 정확히 [N]·추가 검사 0건.
//   하나라도 어긋나면 **아무 파일도 쓰지 않고** exit 1.
//   이 스크립트는 검증 목록(verify-*)이 아니다 — 상시 검증은 verify-task0-jobzip.mjs 가 맡는다
//   (그쪽이 buildTask0SampleSet 등을 import 하므로 main 은 직접 실행할 때만 돈다).
//
//   실행: npx tsx scripts/gen-task0-sample-zip.mjs [--out <폴더>]
//     기본 폴더 = OS 임시 폴더/mazicalign-task0-jobzip. 쓴 경로와 파일별 크기·sha256·검사 결과를 출력한다.
//     Task0 전달은 리드가 그 폴더 내용을 `Task0_inbox\YYYYMMDD\` 로 옮긴다(협의 §27-2).
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_BOTTOM_EXPOSURE_SEC, DEFAULT_EXPOSURE_SEC } from "../src/features/v2/types/printer.ts";
import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";
import {
  TASK0_JOB_CONDITION_LABELS,
  assembleTask0JobZip,
  buildTask0JobZip,
  task0JsonBytes,
  task0LayerPngName,
  verifyTask0JobZip,
} from "../src/features/v2/utils/task0/task0-jobzip.ts";
import { decodeTask0GrayPng, encodeTask0GrayPng } from "../src/features/v2/utils/task0/task0-png.ts";

const __filename = fileURLToPath(import.meta.url);

// ── 견본 조건 ────────────────────────────────────────────────────────────

export const SAMPLE_LH = 0.1;
/** 설계 높이 (mm) — 위쪽 판 윗면. float32 꼭짓점으로 재지 않는다(머리 주석) */
export const SAMPLE_TOP_Y = 0.3;
export const SAMPLE_GENERATED_AT = "2026-10-08T00:00:00.000Z";
export const SAMPLE_EXPOSURE = Object.freeze({
  exposureSec: DEFAULT_EXPOSURE_SEC,
  bottomExposureSec: DEFAULT_BOTTOM_EXPOSURE_SEC,
  bottomLayerCount: 1,
  transitionLayerCount: 0,
});
export const SAMPLE_EXPECT = Object.freeze({ layerCount: 3, emptyLayers: [1], printedLayers: [0, 2] });

/** 축정렬 상자 삼각형 12개 (world [x, y, z], Y-up, 바깥 법선 감김 — verify-task0-writer 픽스처와 같은 구성) */
function boxTriangles(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 3, 2], [0, 2, 1], // −Y
    [4, 5, 6], [4, 6, 7], // +Y
    [0, 1, 5], [0, 5, 4], // −Z
    [2, 3, 7], [2, 7, 6], // +Z
    [3, 0, 4], [3, 4, 7], // −X
    [1, 2, 6], [1, 6, 5], // +X
  ];
  const out = new Float32Array(faces.length * 9);
  let o = 0;
  for (const f of faces) {
    for (const k of f) {
      out[o++] = v[k][0];
      out[o++] = v[k][1];
      out[o++] = v[k][2];
    }
  }
  return out;
}

/** 견본 메시 — 10×10 판 두 장(높이 0~0.1, 0.2~0.3), world x·z 0~10 (파일 A·C 와 같은 자리). 부를 때마다 새 배열 */
export function sampleMeshes() {
  const a = boxTriangles([0, 0, 0], [10, 0.1, 10]);
  const b = boxTriangles([0, 0.2, 0], [10, 0.3, 10]);
  const both = new Float32Array(a.length + b.length);
  both.set(a, 0);
  both.set(b, a.length);
  return [normalizeTriangleWinding(both)];
}

/** 견본 job.zip 조립 */
export function buildSampleJob() {
  return buildTask0JobZip({
    meshes: sampleMeshes(),
    topY: SAMPLE_TOP_Y,
    layerHeightMm: SAMPLE_LH,
    exposure: SAMPLE_EXPOSURE,
    generatedAt: SAMPLE_GENERATED_AT,
  });
}

// ── 불량 7종 ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

function fileOf(files, name) {
  const f = files.find((x) => x.name === name);
  if (!f) throw new Error(`견본에 ${name} 없음`);
  return f;
}

function replaceData(files, name, data) {
  return files.map((f) => (f.name === name ? { name, data } : f));
}

function editJson(files, name, edit) {
  const obj = JSON.parse(dec.decode(fileOf(files, name).data));
  edit(obj);
  return replaceData(files, name, task0JsonBytes(obj));
}

/** 끝 0 정리한 고정 소수 (writer 의 Z 표기와 같은 꼴 — 0.31) */
function zText(v) {
  return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/** 층 N 의 `;Z:` 와 층 첫 `G1 Z` 를 함께 dz 만큼 옮긴다 (둘이 같아 파서의 `;Z:`=`G1 Z` 검사는 통과) */
function shiftLayerZ(gcode, layer, lh, dz) {
  const lines = gcode.split("\n");
  let seen = -1;
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === ";LAYER_CHANGE" && ++seen === layer) {
      at = i;
      break;
    }
  }
  const z = zText((layer + 1) * lh);
  const moved = zText((layer + 1) * lh + dz);
  if (at < 0 || lines[at + 1] !== `;Z:${z}` || lines[at + 3] !== `G1 Z${z}`) {
    throw new Error(`층 ${layer} 머리가 예상 꼴(;LAYER_CHANGE / ;Z:${z} / ;HEIGHT / G1 Z${z})이 아님`);
  }
  lines[at + 1] = `;Z:${moved}`;
  lines[at + 3] = `G1 Z${moved}`;
  return { text: lines.join("\n"), from: z, to: moved };
}

/**
 * 불량 zip 사양 — make(files, ctx) 는 견본 파일 목록을 고친 새 목록을 돌려준다(입력은 바꾸지 않음).
 * what = 무엇을 고쳤나, why = Task0 가 거부해야 할 이유 (README 문구).
 */
export const BAD_SPECS = [
  {
    n: 1,
    file: "bad_1_no_run_gcode.job.zip",
    what: "run.gcode 항목을 뺐다. 나머지(manifest·exposure·preview·PNG 3장)는 sample 과 같다.",
    why: "조건 1 (run.gcode 없음)",
    make: (files) => files.filter((f) => f.name !== "run.gcode"),
  },
  {
    n: 2,
    file: "bad_2_manifest_version.job.zip",
    what:
      'manifest.json 의 "version" 을 1 → 2 로 바꿨다(그 밖의 필드는 그대로). "manifest 없음" 쪽이 아니라 version 2 를 고른 이유: ' +
      "규격 §11 은 옛 MAZIC-CERA ZIP 을 manifest.json 유무로 구분하므로, manifest 를 빼면 거부가 아니라 옛 형식으로 분류될 수 있다.",
    why: "조건 2 (manifest version 2 ≠ 1)",
    make: (files) => editJson(files, "manifest.json", (m) => (m.version = 2)),
  },
  {
    n: 3,
    file: "bad_3_layer_count.job.zip",
    what:
      "manifest.json 의 layerCount 를 3 → 4 로 바꿨다. ;LAYER_CHANGE 3개·PNG 3장은 그대로. " +
      "조건 6(exposure 길이 = layerCount)까지 어기지 않도록 exposureSecByLayer 끝에 2.5 하나를 더해 길이 4 로 맞췄다.",
    why: "조건 3 (;LAYER_CHANGE 3 / layerCount 4 / PNG 3 불일치)",
    make: (files) => {
      const f1 = editJson(files, "manifest.json", (m) => (m.layerCount = 4));
      return editJson(f1, "exposure.json", (x) => x.exposureSecByLayer.push(SAMPLE_EXPOSURE.exposureSec));
    },
  },
  {
    n: 4,
    file: "bad_4_png_gap.job.zip",
    what:
      "PNG 이름을 0000·0002·0003 으로 바꿨다(원래 0001 → 0002, 0002 → 0003). 장 수 3 = layerCount = ;LAYER_CHANGE 라 조건 3 은 통과.",
    why: "조건 4 (PNG 번호 불연속 — 0001 빠짐, 0003 은 없는 층의 번호)",
    make: (files) =>
      files.map((f) => {
        if (f.name === task0LayerPngName(1)) return { name: task0LayerPngName(2), data: f.data };
        if (f.name === task0LayerPngName(2)) return { name: task0LayerPngName(3), data: f.data };
        return f;
      }),
  },
  {
    n: 5,
    file: "bad_5_resolution.job.zip",
    what:
      "layers/0002.png 하나만 1920×1000 으로 바꿨다(층 2 마스크의 위쪽 1000행 — 형상은 그대로 들어 있음, 8-bit 회색조). " +
      "0000·0001.png 와 manifest projector(1920×1080)·bed(150×85)는 그대로. 첫 장이 아니라 마지막 장이라 로더가 모든 PNG 를 보는지도 시험한다.",
    why: "조건 5 (해상도 1920×1080 아님 — layers/0002.png 1920×1000)",
    make: async (files) => {
      const name = task0LayerPngName(2);
      const img = await decodeTask0GrayPng(fileOf(files, name).data);
      const h = 1000;
      const cropped = { width: img.width, height: h, data: img.data.slice(0, img.width * h) };
      return replaceData(files, name, await encodeTask0GrayPng(cropped));
    },
  },
  {
    n: 6,
    file: "bad_6_exposure_length.job.zip",
    what: "exposure.json 의 exposureSecByLayer 를 앞 2개 [30, 2.5] 로 줄였다(layerCount 3).",
    why: "조건 6 (exposure 배열 길이 2 ≠ layerCount 3)",
    make: (files) => editJson(files, "exposure.json", (x) => (x.exposureSecByLayer = x.exposureSecByLayer.slice(0, 2))),
  },
  {
    n: 7,
    file: "bad_7_z_mismatch.job.zip",
    what:
      "run.gcode 층 2(0-based, 세 번째 ;LAYER_CHANGE) 의 ;Z:0.3 과 G1 Z0.3 을 함께 0.31 로 바꿨다(lh × 3 = 0.3 에서 +0.01). " +
      "두 값이 같으므로 파서의 ;Z: = G1 Z 검사와 Z 비감소 검사는 통과하고, job.zip 의 Z = (N+1) × layerHeightMm 비교만 어긋난다.",
    why:
      "조건 7 (층 2(0-based) = Task0 파서 메시지의 '층 3' 의 ;Z:0.31 ≠ 0.1 × 3 = 0.3, ±0.001 밖. " +
      "원본 파서 592accf print(lh 0.1) 메시지: 'Z ≠ (N+1)×층두께 1층 (층 3) … Z0.31 (기대 Z0.3)')",
    make: (files) => {
      const g = fileOf(files, "run.gcode");
      const { text } = shiftLayerZ(dec.decode(g.data), 2, SAMPLE_LH, 0.01);
      return replaceData(files, "run.gcode", enc.encode(text));
    },
  },
];

/** 견본 + 불량 7종 전부 (바이트·파일 목록) */
export async function buildTask0SampleSet() {
  const sample = await buildSampleJob();
  const bads = [];
  for (const spec of BAD_SPECS) {
    const files = await spec.make(sample.files.map((f) => ({ name: f.name, data: f.data })));
    bads.push({ spec, files, bytes: await assembleTask0JobZip(files) });
  }
  return { sample, bads };
}

/** 견본 단언 — 실패 문구 목록 (빈 목록 = 통과). verify 스크립트도 같은 단언을 쓴다 */
export function sampleProblems(sample, report) {
  const p = [];
  if (!report.pass) {
    p.push(`검사기: 위반 [${report.violations.join(", ")}] / 추가 ${report.extraIssues.length}건`);
    for (const r of report.reasons) p.push(`  조건 ${r.condition}: ${r.message}`);
    for (const m of report.extraIssues) p.push(`  추가: ${m}`);
  }
  if (report.layerChangeCount !== SAMPLE_EXPECT.layerCount) p.push(`층 수 ${report.layerChangeCount} ≠ ${SAMPLE_EXPECT.layerCount}`);
  if (JSON.stringify(report.emptyLayers) !== JSON.stringify(SAMPLE_EXPECT.emptyLayers)) {
    p.push(`빈 층 ${JSON.stringify(report.emptyLayers)} ≠ ${JSON.stringify(SAMPLE_EXPECT.emptyLayers)}`);
  }
  if (report.pngs.length !== SAMPLE_EXPECT.layerCount) p.push(`PNG ${report.pngs.length}장`);
  report.pngs.forEach((info, n) => {
    if (info.name !== task0LayerPngName(n)) p.push(`PNG 이름 ${info.name}`);
    if (info.width !== 1920 || info.height !== 1080 || info.decoded !== true) {
      p.push(`${info.name}: ${info.width}×${info.height}, 8-bit 회색조 해석 ${info.decoded}`);
    }
    if (info.midPixels !== 0) p.push(`${info.name}: 0·255 아닌 픽셀 ${info.midPixels}`);
    const empty = SAMPLE_EXPECT.emptyLayers.includes(n);
    if (empty && info.whitePixels !== 0) p.push(`빈 층 ${info.name} 흰 픽셀 ${info.whitePixels}`);
    if (!empty && !(info.whitePixels > 0)) p.push(`${info.name} 흰 픽셀 ${info.whitePixels}`);
    if (sample && info.whitePixels !== sample.layerWhitePixels[n]) p.push(`${info.name} 흰 픽셀 ${info.whitePixels} ≠ 래스터 ${sample.layerWhitePixels[n]}`);
  });
  if (report.parserWarnings?.length || report.parserErrors?.length) {
    p.push(`파서 print 경고 ${report.parserWarnings?.length} / 오류 ${report.parserErrors?.length}`);
  }
  if (sample) {
    if (JSON.stringify(sample.gcode.totals.emptyLayers) !== JSON.stringify(SAMPLE_EXPECT.emptyLayers)) {
      p.push(`writer 빈 층 ${JSON.stringify(sample.gcode.totals.emptyLayers)}`);
    }
    if (sample.gcode.totals.sectionWithoutDeposit.length) p.push(`단면은 있는데 도포 0 인 층 ${JSON.stringify(sample.gcode.totals.sectionWithoutDeposit)}`);
    if (sample.clippedPixels !== 0) p.push(`프레임 밖 잘림 ${sample.clippedPixels}px`);
  }
  return p;
}

/** 불량 zip 단언 — 위반이 정확히 [n], 추가 검사 0건 */
export function badProblems(n, report) {
  const p = [];
  if (JSON.stringify(report.violations) !== JSON.stringify([n])) p.push(`위반 [${report.violations.join(", ")}] ≠ [${n}]`);
  for (const m of report.extraIssues) p.push(`추가 검사: ${m}`);
  return p;
}

// ── 출력 ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  let out = path.join(os.tmpdir(), "mazicalign-task0-jobzip");
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

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** 생성 커밋 (git 이 없으면 "알 수 없음"). 커밋 안 된 변경이 있으면 표시 */
function sourceCommit() {
  const cwd = path.dirname(__filename);
  try {
    const head = execFileSync("git", ["log", "-1", "--format=%h %s"], { cwd, encoding: "utf8" }).trim();
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "."], { cwd: path.resolve(cwd, ".."), encoding: "utf8" }).trim();
    return `${branch} ${head}${dirty ? " (+ 커밋 안 된 변경 — 이 생성물의 코드는 PR 머지 커밋에서 확정)" : ""}`;
  } catch {
    return "알 수 없음 (git 없음)";
  }
}

const fmtSec = (s) => `${s} s`;

function readmeText({ sample, sampleReport, sampleBytes, bads, commit }) {
  const g = sample.gcode;
  const prm = g.params;
  const t = g.totals;
  const m = sample.manifest;
  const e = m.estimate;
  const xy = t.xyBounds;
  const L = [];
  L.push("MazicAlign → Task0 job.zip 견본 + 불량 7종 (2026-10-08 전달분 — 협의 §26-3·§27)");
  L.push("");
  L.push(`생성: MazicAlign ${commit}`);
  L.push("      frontend/scripts/gen-task0-sample-zip.mjs (같은 입력이면 같은 바이트 — generatedAt 고정)");
  L.push("규격: Task0_Gcode_규격서 v0.3.3 (dfdf08c) §11 job.zip, §3 층 규약, §13 시간 상수. 파서 이식 기준 592accf");
  L.push("");
  L.push("공통 조건");
  L.push(`  단일 재료 T0, 도포폭 w = ${prm.depositWidthMm} mm, 시린지 상수 K = ${prm.syringeKMm3PerMm} mm3/mm (잠정: 10 mL 안지름 14.5 mm 가정)`);
  L.push(`  과충전 ${prm.overfill}, 리트랙트 r = ${prm.retractMm} mm, 층두께 lh = ${SAMPLE_LH} mm`);
  L.push(`  속도: 도포 F${prm.depositF} / 트래블 F${prm.travelF} / 리트랙트 F${prm.retractF}. 도포 패턴 B안. G28 없음`);
  L.push(
    `  노광: 일반 ${SAMPLE_EXPOSURE.exposureSec} s, 바닥 ${SAMPLE_EXPOSURE.bottomExposureSec} s, bottomLayerCount ${SAMPLE_EXPOSURE.bottomLayerCount}, ` +
      `transitionLayerCount ${SAMPLE_EXPOSURE.transitionLayerCount}`,
  );
  L.push("    (bottomLayerCount 1: 3층 견본에 기본값 5 를 쓰면 전 층이 바닥 노광이 되어 바닥/일반 구분이 안 보인다)");
  L.push("  형상: 10 x 10 mm 판 두 장 — 높이 0~0.1 mm, 0.2~0.3 mm. 출력 가능 영역 가운데 (파일 A 와 같은 자리, 베드 X 75~85 x Y 42.5~52.5)");
  L.push("  단면: 층 N 은 (N+0.5) x lh = 0.05 / 0.15 / 0.25 mm → 층 1 은 두 판 사이 틈이라 빈 층");
  if (xy) L.push(`  노즐 XY 범위: X ${xy.xMin}~${xy.xMax} x Y ${xy.yMin}~${xy.yMax}`);
  L.push("  zip: 무압축(store), 항목 순서 run.gcode, manifest.json, exposure.json, preview.png, layers/0000.png ~ 0002.png");
  L.push("  PNG: 1920 x 1080, 8-bit 회색조, 0/255 만. 열 0 = X 최소, 행 0 = Y 최대. preview.png 400 x 300 회색조(전 층 합집합 실루엣)");
  L.push("  층 번호: 이 README 는 0부터 센다(0-based — layers/NNNN.png·exposureSecByLayer[N] 와 같은 번호).");
  L.push("          Task0 원본 파서 메시지는 1부터 센다 — 예: 우리 '층 2' = 파서 메시지의 '층 3'");
  L.push("");
  L.push("검증기 결과 (MazicAlign verifyTask0JobZip — 규격 §11 거부 조건 1~7 + 추가 검사)");
  L.push("  sample.job.zip: 위반 없음, 추가 검사 0건");
  L.push("  bad_N: 각각 조건 N 하나만 위반, 추가 검사 0건");
  L.push("  단 bad_1 은 조건 1(run.gcode 없음)이 선행 조건 — run.gcode 가 없으면 조건 3·7 의 G-code 쪽 비교는 할 수 없다");
  L.push("  추가 검사 = zip CRC, PNG 8-bit 회색조 해석, run.gcode Task0 파서(이식판) print 모드 경고·오류 0, ;HEIGHT: = lh,");
  L.push("              빈 층 PNG 전부 0, manifest 필드·estimate 합, exposure 필드, preview 크기");
  L.push("");
  L.push("파일");
  L.push(`  sample.job.zip  (${sampleBytes.length} B)`);
  L.push(`    sha256 ${sha256(sampleBytes)}`);
  L.push("    정상 견본. Task0 기대 동작: 통과");
  L.push(
    `    layers/0000.png 흰 픽셀 ${sample.layerWhitePixels[0]} / 0001.png 빈 층(전부 0) / 0002.png 흰 픽셀 ${sample.layerWhitePixels[2]}`,
  );
  L.push(
    `    run.gcode: 3층, 층 1 은 ;LAYER_CHANGE + ;Z:0.2 + ;HEIGHT:0.1 + G1 Z0.2 만. 도포 ${t.depositMm.toFixed(3)} mm (${t.segments}줄), ` +
      `E 합 ${t.extrusionMm.toFixed(5)} mm, ${t.lineCount}줄`,
  );
  L.push(
    `      Task0 파서(이식판) print 모드 경고 ${sampleReport.parserWarnings.length}, 오류 ${sampleReport.parserErrors.length}`,
  );
  L.push(
    `    manifest: version 1, layerCount ${m.layerCount}, layerHeightMm ${m.layerHeightMm}, materials 1개(T0 "${m.materials[0].name}"), ` +
      `dualMaterial false, toolChangeCount 0, generatedAt ${m.generatedAt}`,
  );
  L.push(
    `      estimate: 도포 ${fmtSec(e.depositSec)} + 트래블 ${fmtSec(e.travelSec)} + 툴전환 ${fmtSec(e.toolChangeSec)} + 파킹 ${fmtSec(e.parkSec)} + ` +
      `블레이드 ${fmtSec(e.bladeSec)} + 층 오버헤드 ${fmtSec(e.layerOverheadSec)} + 노광 ${fmtSec(e.exposureSec)} = totalSec ${fmtSec(e.totalSec)}`,
  );
  L.push("      (파킹·블레이드·노광은 빈 층을 뺀 2층분 — 규격 §9 빈 층은 3~5단계 생략. 층 오버헤드는 3층 전부. 리트랙트 줄 시간은 트래블에 포함)");
  L.push(`    exposure: exposureSecByLayer ${JSON.stringify(sample.exposure.exposureSecByLayer)} (빈 층 1 도 일정표 값 그대로 — Task0 는 빈 층 LED 생략)`);
  L.push("");
  L.push("  불량 7종 — 각각 sample 에서 아래 한 곳만 고쳤다. 나머지 조건은 전부 통과한다.");
  for (const b of bads) {
    L.push(`  ${b.spec.file}  (${b.bytes.length} B)`);
    L.push(`    sha256 ${sha256(b.bytes)}`);
    L.push(`    고친 곳: ${b.spec.what}`);
    L.push(`    Task0 기대 동작: 거부 — ${b.spec.why}`);
    L.push(`    검증기: 위반 [${b.report.violations.join(", ")}] — ${b.report.reasons.map((r) => r.message).join(" / ")}`);
  }
  L.push("");
  L.push("거부 조건 (규격서 v0.3.3 §11)");
  for (const [n, label] of Object.entries(TASK0_JOB_CONDITION_LABELS)) L.push(`  ${n}. ${label}`);
  return L.join("\n") + "\n";
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  console.log("Task0 견본 job.zip + 불량 7종 생성 (규격서 v0.3.3 §11, 협의 §26-3·§27)");

  // 1) 전부 만들고 검사 — 하나라도 어긋나면 아무것도 쓰지 않음
  const { sample, bads } = await buildTask0SampleSet();
  const sampleReport = await verifyTask0JobZip(sample.bytes);
  const problems = sampleProblems(sample, sampleReport).map((m) => `sample.job.zip: ${m}`);
  console.log(`\n  [sample.job.zip] 위반 [${sampleReport.violations.join(", ")}], 추가 검사 ${sampleReport.extraIssues.length}건`);
  for (const b of bads) {
    b.report = await verifyTask0JobZip(b.bytes);
    console.log(
      `  [${b.spec.file}] 위반 [${b.report.violations.join(", ")}], 추가 검사 ${b.report.extraIssues.length}건 — ` +
        b.report.reasons.map((r) => r.message).join(" / "),
    );
    for (const m of badProblems(b.spec.n, b.report)) problems.push(`${b.spec.file}: ${m}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`  FAIL: ${p}`);
    console.error(`\n검사 실패 ${problems.length}건 — 아무 파일도 쓰지 않음`);
    process.exit(1);
  }

  // 2) 쓰기
  fs.mkdirSync(out, { recursive: true });
  const written = [["sample.job.zip", sample.bytes], ...bads.map((b) => [b.spec.file, b.bytes])];
  for (const [name, bytes] of written) fs.writeFileSync(path.join(out, name), bytes);
  const readme = readmeText({ sample, sampleReport, sampleBytes: sample.bytes, bads, commit: sourceCommit() });
  fs.writeFileSync(path.join(out, "README.txt"), readme, "utf8");

  console.log(`\n출력 폴더: ${out}`);
  for (const [name, bytes] of written) console.log(`  ${name.padEnd(32)} ${String(bytes.length).padStart(7)} B  sha256 ${sha256(bytes)}`);
  console.log(`  ${"README.txt".padEnd(32)} ${String(Buffer.byteLength(readme, "utf8")).padStart(7)} B`);
  const e = sample.manifest.estimate;
  console.log(`\n  견본 estimate totalSec ${e.totalSec} s, exposure ${JSON.stringify(sample.exposure.exposureSecByLayer)}`);
  console.log("\n완료");
}

const isMain = path.resolve(process.argv[1] ?? "") === __filename;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
