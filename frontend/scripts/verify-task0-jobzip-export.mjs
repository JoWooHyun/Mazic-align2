// Task0 앱 job.zip 내보내기(Z3) 헤드리스 검증 — 앱 경로 = 스크립트 경로 · 투사 프레임 마스크 · 빈 층 집합 · float32 topY ·
// 실제 워커 모듈 · 막힘 · 배선 · 대조군 · 기존 산출물 불변.
//
//   무엇을: Z3 에서 앱에 붙인 Task0 job.zip 경로.
//     src/features/v2/utils/task0/task0-export.ts  runTask0JobZipExport (워커가 부르는 순수 코어 — run.gcode 검사 → 층 마스크 PNG →
//       빈 층 집합 대조 → manifest·exposure·preview·zip → 자기 검사) + exportGcodeStage 입구의 topY 정규화
//     src/features/v2/utils/task0/task0-jobzip.ts  buildTask0LayerImages·buildTask0JobFiles (견본 경로 buildTask0JobZip 과 공용),
//       verifyTask0JobZip layerPngs 'header'
//     src/features/v2/utils/task0/task0-frame.ts   task0NormalizeTopY (1 µm 반올림)
//     src/features/v2/utils/task0/task0-profile.ts task0RasterFrameForProfile
//     + 배선(소스 검사): 워커·서비스·useSliceExport·SliceSidePanel·ViewerV2Page.
//   규격 = Task0 리포 docs/Task0_Gcode_규격서_초안.md v0.3.4 @ a4ebc6c §11(job.zip 구성·PNG 1920×1080 8-bit 회색조·래스터 규약·
//   manifest v1·exposure·preview·거부 조건 1~7)·§3(층 수 = ceil(topY/lh), 도포 영역 = 노광 영역, 빈 층 PNG 전부 검정)·§13.
//   설계 = docs/계획_Z1_task0출력_20261002.md §4·§4-2·§4-3(Z3 인계).
//
//   (1) 앱 경로 = 스크립트 경로 — 코어를 견본과 같은 입력(3층, 층 1 빈 층, generatedAt 고정, 빌트인 Task0 프로파일의 writer·투사
//       프레임)으로 → gen-task0-sample-zip.mjs 의 sample.job.zip 과 **같은 바이트**(sha256 616b0e61… 고정값). 진행 단계 순서
//       (gcode 1..3 → png 1..3 → verify 0/1 → 1/1). 앱 generator(TASK0_APP_JOB_GENERATOR)로 만들면 manifest.json 의 generator 글자만
//       다르고(다른 항목 바이트 같음) 그 글자를 견본 값으로 되돌려 다시 묶으면 견본 바이트 — 정규화 근거.
//   (2) 파일 A·C·B — 코어 결과 zip: verifyTask0JobZip(전부 풀기) 위반 0·추가 0, PNG 수 = 층 수, run.gcode = Z2 고정 sha256
//       (A dde08ea9… / C ab3f8d74… / B b1e65f70…), **층 PNG 전부 = task0-mask rasterizeTask0Mask(writer 와 같은 단면, 투사 프레임) × 255**
//       (빈 층 = 전부 0), G-code 빈 층 = PNG 흰 픽셀 0 인 층, manifest 노광 = types/printer.ts DEFAULT_*(앱이 넘기는 profileExposure
//       (빌트인) = undefined), manifest estimate = 화면 요약 estimate, generatedAt ISO.
//   (3) float32 topY — Math.fround(0.3) 은 정규화 전 task0LayerCount 4 (대조), 코어는 3층·견본 바이트·`; topYMm: 0.3`.
//       견본 스크립트 경로(buildTask0JobZip — 정규화 없음)에 float32 를 주면 4층(그래서 코어 입구에서 정규화).
//       µm 설계값 2만 개 × lh 4종을 float32 로 넣어도 정규화 후 층 수 = 정수 계산(정규화 없이는 어긋나는 경우가 있음),
//       파일 A·B·C 의 topY(10·0.5·0.5)는 정규화로 안 바뀜.
//   (3b) 실제 워커 모듈 — slice-batch.worker.ts 를 가짜 self 로 Node 에서 불러 task0-jobzip 메시지 → progress(단계 키, 단계 순서,
//       단계 끝 done = total) + task0-job-done 1건(마지막), zip = 견본 바이트, zip.buffer 를 transfer. float32 topY 메시지도 같은 바이트.
//       task0-gcode 메시지의 progress 에는 stage 키가 없음(기존 경로 그대로). 막힘 입력 → error 아닌 task0-job-done(ok false).
//   (4) 막힘 — ① 채움 실패(나선 벽 층 9) ② 파서 경고(트래블 F9000) ③ zip 검사 위반(코어 변조: 마지막 PNG 1920×1000 → 거부 조건 5)
//       ④ 빈 층 집합 불일치(코어 변조: 빈 층 1 에 층 0 PNG / 도포 층 0 에 빈 PNG) ⑤ 층 없음
//       ⑥ 출력 가능 영역 밖(검수 FAIL 필수 1) — 투사 X 최소에 걸친 상자(베드 X 6~16)·투사 안 노즐 밖 띠(베드 Y 85.5~88.5)·
//          검수 재현(베드 Y 82.5~87.5): job.zip·run.gcode 만 둘 다 writer 전에 같은 문구로 막힘(진행 0건), 경계(Y 85 딱·1 µm 안) 통과
//       ⑦ 표본 풀기(필수 2) — 층 0 PNG 의 흰 픽셀 하나만 지운 변조(CRC·zlib 정상)를 "PNG 를 풀어 보니 … 18768 ≠ 18769" 로 막음
//       ⑧ estimate 대조 — manifest 만 다른 시간 상수(블레이드 16 s)로 만든 변조를 막음 (화면 요약 = 파일)
//       ⑨ 'header' 검사도 IHDR 8-bit 회색조 확인 — 색 유형 2·비트 깊이 16 IHDR(CRC 맞춤) PNG 를 추가 검사로 잡음 — 모두 zip null + 이유.
//   (5) 배선(소스) — 워커 runTask0JobZip 이 코어를 요청 값 그대로 부르고 zip.buffer 를 transfer, 진행 스로틀의 단계 처리, 서비스
//       exportTask0JobZip(application/zip Blob, task0-job-done), useSliceExport(deps 에 printerProfile·층두께 — 규칙 7, 파일 이름
//       <프로젝트>_task0_<lh>mm.job.zip, 프로파일 writer·투사 프레임·노광·출력 가능 영역, 앱 generator, 핸들러 순서), Task0 두 핸들러는
//       영역 밖이면 confirm 이 아니라 alert 로 막음(alertIfOutOfTask0Area — Z3-b: 플레이트 아래만이면 확인 후 허용, verify-task0-sink-allow),
//       워커 두 경로가 printable 전달, task0Report 무효화(모델·서포트 수·
//       프로파일·층두께·슬라이스 화면) + 도중 변경 epoch, 패널(job.zip 주 버튼 → run.gcode 만 보조, 단계 표시, 이유 key 에 순번),
//       ViewerV2Page(배선, 출력영역 배너 Task0 제목 "이대로는 내보낼 수 없습니다" + 기존 문구 그대로), 미리보기 층 수 previewLayerCount 세 곳.
//   (6) 대조군 — 이 스크립트가 실제로 결함을 잡는지:
//       a. 층 마스크를 기존 slice-rasterize(플레이트 150×85 를 1920×1080 에 늘림)로 바꾼 코어 → 코어·zip 검사는 통과해 버리고
//          (2) 의 "PNG = task0-mask 래스터" 비교가 잡는다.
//       b. 코어에서 빈 층 집합 대조를 빼면 ④ 의 변조 zip 이 파일로 나오고, 'header' 자기 검사도 통과한다(전부 풀기 검사만 잡음)
//          → 생성 단계 단언이 실제로 필요하다.
//       c. 코어에서 topY 정규화를 빼면 float32 견본이 4층 — 견본 바이트와 다르다.
//       d. 코어에서 자기 검사 결과를 무시하면 1920×1000 PNG zip 이 파일로 나온다(그 zip 은 검사기 위반 [5]).
//       e. 'header' 검사의 한계(기록) — PNG 몸통만 망가뜨린 zip 은 'header' 통과, 'decode' 는 잡음 → 그래서 생성 단계 단언 + 표본 풀기.
//       f. deps 에서 printerProfile 을 빼면 (5) 의 규칙 7 검사가 실패한다.  g. epoch 확인을 빼면 (5) 의 검사가 실패한다.
//       g2. Task0 핸들러를 P-1 confirm 으로 되돌리면 (5) 의 영역 차단 검사가 실패한다.
//       h. 코어에서 영역 검사(사전·사후)를 빼면 걸친 상자는 엉뚱한 "얇은 부분 채움 실패" 문구로 막히고, 노즐 밖 띠는
//          G-code Y 최대 > 85 인 zip 이 나온다(검사기·파서도 통과 — 노즐 범위를 모름).
//       i. 사전 검사만 빼면 사후 검사(writer 출력 XY)가 띠를 막는다.
//       j. 표본 풀기를 빼면 ⑦ 의 변조 zip 이 파일로 나온다(마스크와 1px 다름, 전부 풀기 검사기도 통과).
//       k. estimate 대조를 빼면 ⑧ 의 변조 zip 이 나오고 파일 예상 시간 ≠ 화면 요약.
//       l. 검사기에서 IHDR 확인을 빼면 ⑨ 의 RGB IHDR zip 이 'header' 검사를 통과한다.
//       m. 미리보기 층 수 — Task0(float32 0.3) = 3 = job.zip, 정규화 없이 세면 4, 기존 프로파일은 layerCountFor 와 같음,
//          페이지 한 곳을 layerCountFor 로 되돌리면 (5) 가 실패.
//   (7) 기존 산출물 불변 — 견본 sample.job.zip + 불량 7종 sha256 = 10/8 전달본(buildTask0JobZip 공용 함수로 나눈 뒤에도 같음),
//       run.gcode A·C·B = (2) 의 고정값. 마스크 ZIP(runPngZip)·marlin(runGcode)은 Node 에서 못 돌린다(OffscreenCanvas·js-clipper)
//       → 진행 알림이 단계 없이 두 인자로만 불리는지 소스로 본다(throttle 의 stage 처리는 (3b) 에서 동작으로 확인).
//   (8) 성능 참고 — TASK0_PERF=1 일 때만(판정 없음): 20 mm 정육면체(리프트 5 mm, 0.1 mm 250층)·100×60 판(0.1 mm 30층) 단계별 시간,
//       'header' 와 'decode' 검사 시간.
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "변조"·"놓침"·"FAIL" 문자열을 출력할 수 있다.
//   실행: npx tsx scripts/verify-task0-jobzip-export.mjs   (선택) TASK0_PERF=1
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_BOTTOM_EXPOSURE_SEC,
  DEFAULT_BOTTOM_LAYER_COUNT,
  DEFAULT_EXPOSURE_SEC,
  DEFAULT_TRANSITION_LAYER_COUNT,
} from "../src/features/v2/types/printer.ts";
import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";
import { TASK0_DEFAULTS, task0LayerCount, task0NormalizeTopY } from "../src/features/v2/utils/task0/task0-frame.ts";
import {
  TASK0_APP_JOB_GENERATOR,
  runTask0GcodeExport,
  runTask0JobZipExport,
} from "../src/features/v2/utils/task0/task0-export.ts";
import {
  TASK0_JOB_GENERATOR,
  assembleTask0JobZip,
  buildTask0JobZip,
  readTask0ZipEntries,
  task0JsonBytes,
  task0LayerPngName,
  verifyTask0JobZip,
} from "../src/features/v2/utils/task0/task0-jobzip.ts";
import { rasterizeTask0Mask } from "../src/features/v2/utils/task0/task0-mask.ts";
import { decodeTask0GrayPng, readTask0PngHeader, task0Crc32 } from "../src/features/v2/utils/task0/task0-png.ts";
import { task0LayerPolygonsBed } from "../src/features/v2/utils/task0/task0-slice.ts";
import {
  TASK0_BUILT_IN_PROFILE,
  resolveTask0ProfileFrame,
  task0PrintableFrameForProfile,
  task0RasterFrameForProfile,
  task0WriterOptionsForProfile,
} from "../src/features/v2/utils/task0/task0-profile.ts";
import { profileExposure } from "../src/features/v2/pages/viewer/utils/profile-exposure.ts";
import { layerCountFor, previewLayerCount } from "../src/features/v2/pages/viewer/utils/layer-count.ts";
import { parseGcodeText } from "../src/features/v2/utils/task0/task0-gcode-parser.ts";
import {
  BAD_SPECS,
  SAMPLE_EXPOSURE,
  SAMPLE_GENERATED_AT,
  SAMPLE_LH,
  SAMPLE_TOP_Y,
  buildSampleJob,
  buildTask0SampleSet,
  sampleMeshes,
} from "./gen-task0-sample-zip.mjs";
import {
  boxTriangles,
  concatTris,
  fixtureCube10,
  fixtureFileB,
  fixtureGapPlates,
  meshesTopY,
} from "./verify-task0-writer.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(SCRIPT_DIR, "..", "src", "features", "v2");
const UTILS = path.join(V2, "utils");
const TASK0_SRC = path.join(UTILS, "task0");

/** 10/8 전달 견본(Z1-c, 규격 v0.3.4) sha256 — gen-task0-sample-zip.mjs 출력 */
const SAMPLE_SHA = "616b0e610dfa0a101f357d2a8a30bdb7f3823ddd773350ffe40682f7c8192989";
/** 같은 때의 불량 7종 sha256 — buildTask0JobZip 을 공용 함수로 나눈 뒤에도 같아야 한다 */
const BAD_SHA = {
  "bad_1_no_run_gcode.job.zip": "08f9a8dd781e210b460bb80e9f407a038fb60675839cdddb8b29953c28c3cec7",
  "bad_2_manifest_version.job.zip": "9fc7581b6286dacc9265707e78656580d45cd2f9b2177eb86abc7f7bb8aabe5b",
  "bad_3_layer_count.job.zip": "30145825d4cc11e38180e635f7250e57376459decad447626148b1065a521bfd",
  "bad_4_png_gap.job.zip": "7fb43cb87ce8910d86b0d37a6f4ebe9d56acf27bbea047ed8b50ef34ce905ded",
  "bad_5_resolution.job.zip": "90105153e8fe0baf4a517b55990e99971348de0120920c7cd9d4c3726c4aa4c5",
  "bad_6_exposure_length.job.zip": "26af5b8b4548fc71e3eaf02ae0a3b3130d9a4d236aa999563f67c01a24f9412a",
  "bad_7_z_mismatch.job.zip": "e369de001a8876ea13b9c8ed927337474bdf9022f9290626dae30b8290cc68a7",
};
/** run.gcode 파일 A·C·B sha256 (Z1-c 고정값 — verify-task0-export 와 같은 값) */
const GCODE_SHA = {
  cube10: "dde08ea97b2e144dabc842d1257980bdd4d51fa59b7bf7453c463e5f264928b9",
  "gap-plates": "ab3f8d7431386b5deaa3a4f44df09dfe1b0b1f0ac82303423cc63ccac76d7859",
  "file-b": "b1e65f70c96a3e5cee17a97c27d8b2bb029faa8e82791bca2ef09361098a8339",
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

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const dec = new TextDecoder();
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** 앱이 빌트인 Task0 프로파일에서 넘기는 값 (useSliceExport handleExportTask0JobZip 과 같은 함수) */
const P = TASK0_BUILT_IN_PROFILE;
const APP = {
  writer: task0WriterOptionsForProfile(P),
  frame: task0RasterFrameForProfile(P),
  printable: task0PrintableFrameForProfile(P),
  exposure: profileExposure(P),
};

/** 견본 입력 (gen-task0-sample-zip buildSampleJob 과 같은 값) + 앱 프로파일 값 */
function sampleInput(extra = {}) {
  return {
    meshes: sampleMeshes(),
    topY: SAMPLE_TOP_Y,
    layerHeightMm: SAMPLE_LH,
    exposure: SAMPLE_EXPOSURE,
    generatedAt: SAMPLE_GENERATED_AT,
    writer: APP.writer,
    frame: APP.frame,
    printable: APP.printable,
    ...extra,
  };
}

async function zipEntries(bytes) {
  return new Map((await readTask0ZipEntries(bytes)).map((e) => [e.name, e.data]));
}

/**
 * 층 PNG 들이 task0-mask 투사 프레임 래스터(writer 와 같은 단면) × 255 와 같은가 — (2) 와 대조군 a 가 같은 함수를 쓴다.
 * @returns 층마다 { n, diff(다른 픽셀 수, 크기 다르면 -1), white(래스터 흰 픽셀), pngWhite }
 */
async function compareLayerPngsToTask0Raster(entries, meshes, lh, layerCount, frame = APP.frame) {
  const out = [];
  for (let n = 0; n < layerCount; n++) {
    const data = entries.get(task0LayerPngName(n));
    if (!data) {
      out.push({ n, diff: -1, white: null, pngWhite: null });
      continue;
    }
    const img = await decodeTask0GrayPng(data);
    const mask = rasterizeTask0Mask(task0LayerPolygonsBed(meshes, n, lh, APP.writer.bedWidthMm, APP.writer.bedDepthMm), { frame });
    let diff = 0;
    let pngWhite = 0;
    if (img.width !== mask.width || img.height !== mask.height) diff = -1;
    else {
      for (let i = 0; i < img.data.length; i++) {
        if (img.data[i] !== 0) pngWhite++;
        if (img.data[i] !== (mask.data[i] ? 255 : 0)) diff++;
      }
    }
    out.push({ n, diff, white: mask.whitePixels, pngWhite });
  }
  return out;
}

// ── 변조 코어 로더 ───────────────────────────────────────────────────────

/**
 * task0-export.ts 를 소스 변조해 임시 폴더에 쓰고 import — 상대 import 는 원본 폴더의 절대 URL 로 바꾼다
 * (verify-task0-export 의 loadMutant 와 같은 방식, 변조 여러 개 + 꼬리 코드 덧붙이기).
 */
async function loadTask0Mutant(fileName, tag, edits, append = "") {
  let src = fs.readFileSync(path.join(TASK0_SRC, fileName), "utf8");
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`변조 대상 문자열이 소스에 없음 (${tag}): ${from}`);
    src = src.replace(from, to);
  }
  // './x'·'../x'·'../../x' 모두 원본 폴더 기준 절대 URL 로 (task0-jobzip 은 ../exposure·../../types/printer 를 쓴다)
  src = src.replace(/from '(\.{1,2}\/[^']+)'/g, (_, spec) => `from '${pathToFileURL(path.resolve(TASK0_SRC, `${spec}.ts`)).href}'`) + append;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-task0-jobzip-export-"));
  const file = path.join(dir, `${path.basename(fileName, ".ts")}.${tag}.ts`);
  fs.writeFileSync(file, src, "utf8");
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const loadExportMutant = (tag, edits, append = "") => loadTask0Mutant("task0-export.ts", tag, edits, append);

const AT_ASSEMBLE = "  // 8) manifest·exposure·preview·zip 조립 (견본 경로와 같은 함수)";
const AT_SET_CHECK = "  if (exposedWithoutResin.length > 0 || resinWithoutExposure.length > 0) {";
const AT_GEN_STAGE_PNG = "  // 7) 생성 단계 단언 — PNG 수, 빈 층 집합 (도포 = 노광, 규격 §3)";
const IMPORT_PNG = "import { decodeTask0GrayPng } from './task0-png';";

/** 변조: 마지막 층 PNG 를 위쪽 1000행만 남긴 1920×1000 으로 (형상은 그대로, 8-bit 회색조) */
const MUT_CROP_LAST = [
  [IMPORT_PNG, "import { decodeTask0GrayPng, encodeTask0GrayPng } from './task0-png';"],
  [
    AT_ASSEMBLE,
    "  {\n" +
      "    const last = images.layerFiles.length - 1;\n" +
      "    const img = await decodeTask0GrayPng(images.layerFiles[last].data);\n" +
      "    const cropped = { width: img.width, height: 1000, data: img.data.slice(0, img.width * 1000) };\n" +
      "    images.layerFiles[last] = { name: images.layerFiles[last].name, data: await encodeTask0GrayPng(cropped) };\n" +
      "  }\n" +
      AT_ASSEMBLE,
  ],
];

/** 변조: 견본의 빈 층 1 에 층 0 PNG 를 넣는다(마스크와 G-code 가 다른 단면에서 나온 것처럼) */
const MUT_EMPTY_GETS_WHITE = [
  [
    AT_GEN_STAGE_PNG,
    "  images.layerFiles[1] = { name: images.layerFiles[1].name, data: images.layerFiles[0].data };\n" +
      "  images.layerWhitePixels[1] = images.layerWhitePixels[0];\n" +
      AT_GEN_STAGE_PNG,
  ],
];

/** 변조: 견본의 도포 층 0 에 빈 층 1 의 PNG 를 넣는다 */
const MUT_PRINTED_GETS_BLACK = [
  [
    AT_GEN_STAGE_PNG,
    "  images.layerFiles[0] = { name: images.layerFiles[0].name, data: images.layerFiles[1].data };\n" +
      "  images.layerWhitePixels[0] = images.layerWhitePixels[1];\n" +
      AT_GEN_STAGE_PNG,
  ],
];

/**
 * 변조: 층 0 PNG 를 풀어 흰 픽셀 하나를 지우고 다시 인코딩 (CRC·zlib 정상, 해상도·8-bit 회색조 그대로, 흰 픽셀 > 0 그대로)
 * — 마스크의 흰 픽셀 수(layerWhitePixels)는 그대로라 빈 층 대조·'header' 검사로는 안 보이고 표본 풀기만 잡는다.
 */
const MUT_DROP_ONE_WHITE = [
  [IMPORT_PNG, "import { decodeTask0GrayPng, encodeTask0GrayPng } from './task0-png';"],
  [
    AT_GEN_STAGE_PNG,
    "  {\n" +
      "    const img0 = await decodeTask0GrayPng(images.layerFiles[0].data);\n" +
      "    img0.data[img0.data.indexOf(255)] = 0;\n" +
      "    images.layerFiles[0] = { name: images.layerFiles[0].name, data: await encodeTask0GrayPng(img0) };\n" +
      "  }\n" +
      AT_GEN_STAGE_PNG,
  ],
];
const AT_SPOT_FILTER = "  ].filter((n) => n >= 0);";
const AT_JOB_FILES_END = "    frame,\n  });\n  const zip = await assembleTask0JobZip(files);";
const AT_ESTIMATE_CHECK = "  if (JSON.stringify(manifest.estimate) !== JSON.stringify(summary.estimate)) {";
/** 변조: manifest 만 다른 시간 상수(블레이드 16 s)로 — 화면 요약 estimate 와 파일 estimate 가 갈라진 상황 */
const MUT_ESTIMATE_DIVERGE = [[AT_JOB_FILES_END, "    frame,\n    time: { bladeSec: 16 },\n  });\n  const zip = await assembleTask0JobZip(files);"]];
const AT_AREA_FN = "function areaExcess(box: BedBox, area: Task0PrintableFrame): string[] {\n";
const AT_AREA_PRE = "  if (meshBox && meshExcess.length > 0) {";

/**
 * 출력 가능 영역 밖 사례 (world 상자 → 베드 = world + (75, 42.5)). 투사 = X 10~150.16 × Y 10~88.84, 노즐 = X 0~150 × Y 0~85,
 * 출력 가능 영역 = 둘의 교집합 X 10~150 × Y 10~85 (규격 §1).
 */
const AREA_CASES = {
  xStraddle: { label: "투사 X 최소에 걸친 상자(베드 X 6~16)", min: [-69, 0, 0], max: [-59, 0.3, 6], excess: "X 최소 6 < 10", box: "X 6~16, Y 42.5~48.5 mm" },
  yBand: { label: "투사 안·노즐 밖 띠(베드 Y 85.5~88.5)", min: [0, 0, 43], max: [10, 0.3, 46], excess: "Y 최대 88.5 > 85", box: "X 75~85, Y 85.5~88.5 mm" },
  yStraddle: { label: "검수 재현(베드 Y 82.5~87.5)", min: [0, 0, 40], max: [10, 0.3, 45], excess: "Y 최대 87.5 > 85", box: "X 75~85, Y 82.5~87.5 mm" },
};
const AREA_MSG_HEAD = "출력 가능 영역(X 10~150 × Y 10~85 mm) 밖에 모델·서포트가 있습니다 — 베드 ";
const areaMeshes = (c) => [normalizeTriangleWinding(boxTriangles(c.min, c.max))];
const areaInput = (c, extra = {}) => {
  const meshes = areaMeshes(c);
  return { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1, ...APP, ...extra };
};
/** run.gcode 의 G1 이동 줄 Y 최댓값 */
function gcodeYMax(text) {
  let m = -Infinity;
  for (const l of text.split("\n")) {
    const y = /^G1 .*\bY(-?[0-9.]+)/.exec(l);
    if (y) m = Math.max(m, Number(y[1]));
  }
  return m;
}

/** PNG IHDR 의 한 바이트를 바꾸고 IHDR CRC 를 다시 맞춘다 (시그니처 8 + 길이 4 + 'IHDR' 4 → 데이터 16~28, CRC 29~32) */
function withIhdrByte(png, at, val) {
  const d = png.slice();
  d[at] = val;
  const crc = task0Crc32(d, 12, 29);
  d.set([crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff], 29);
  return d;
}

// ── (1) 앱 경로 = 스크립트 경로 ─────────────────────────────────────────

async function sectionSamplePath() {
  console.log("\n(1) 앱 경로(코어 runTask0JobZipExport) = 스크립트 경로(gen-task0-sample-zip) — sample.job.zip 같은 바이트");
  const script = await buildSampleJob();
  assert(sha256(script.bytes) === SAMPLE_SHA, `스크립트 경로 sample.job.zip sha256 ${sha256(script.bytes).slice(0, 16)}… = 10/8 전달본 ${SAMPLE_SHA.slice(0, 16)}…`);
  const prog = [];
  const r = await runTask0JobZipExport(sampleInput(), (s, d, t) => prog.push(`${s}:${d}/${t}`));
  assert(r.ok, `코어 통과 (막힘 이유 ${r.ok ? "없음" : JSON.stringify(r.issues)})`);
  if (!r.ok) return null;
  assert(sameBytes(r.zip, script.bytes), `코어 zip = 스크립트 zip 바이트 (${r.zip.length} B, sha256 ${sha256(r.zip).slice(0, 16)}…)`);
  const want = "gcode:1/3 gcode:2/3 gcode:3/3 png:1/3 png:2/3 png:3/3 verify:0/1 verify:1/1";
  assert(prog.join(" ") === want, `진행 단계 순서: ${prog.join(" ")}`);
  const s = r.summary;
  const j = r.job;
  assert(
    s.layerCount === 3 && s.emptyLayerCount === 1 && j.pngCount === 3 && j.emptyMaskLayerCount === 1 &&
      j.clippedPixels === 0 && j.zipBytes === r.zip.length && j.generator === TASK0_JOB_GENERATOR &&
      j.pngBytes === script.files.filter((f) => f.name.startsWith("layers/")).reduce((a, f) => a + f.data.length, 0),
    `요약: 층 ${s.layerCount}·빈 층 ${s.emptyLayerCount}·PNG ${j.pngCount}장·마스크 빈 층 ${j.emptyMaskLayerCount}·잘림 ${j.clippedPixels}·zip ${j.zipBytes} B·generator 견본 값`,
  );
  assert(JSON.stringify(s.estimate) === JSON.stringify(script.manifest.estimate), `요약 estimate = 견본 manifest estimate (totalSec ${s.estimate.totalSec})`);

  // 앱 generator — manifest 의 generator 글자만 다르다
  const app = await runTask0JobZipExport(sampleInput({ generator: TASK0_APP_JOB_GENERATOR }));
  assert(app.ok && app.job.generator === TASK0_APP_JOB_GENERATOR, `앱 generator "${TASK0_APP_JOB_GENERATOR}"`);
  assert(/^MazicAlign v2 \S/.test(TASK0_APP_JOB_GENERATOR), '앱 generator 가 규격 §11 꼴 "MazicAlign v2 <버전>"');
  if (!app.ok) return r;
  const a = await zipEntries(app.zip);
  const b = await zipEntries(script.bytes);
  const names = [...a.keys()];
  const differing = names.filter((nm) => !sameBytes(a.get(nm), b.get(nm)));
  assert(
    JSON.stringify(names) === JSON.stringify([...b.keys()]) && JSON.stringify(differing) === '["manifest.json"]',
    `항목 이름·순서 같음, 다른 항목은 manifest.json 뿐 (${JSON.stringify(differing)})`,
  );
  const ma = JSON.parse(dec.decode(a.get("manifest.json")));
  const mb = JSON.parse(dec.decode(b.get("manifest.json")));
  assert(ma.generator === TASK0_APP_JOB_GENERATOR && JSON.stringify({ ...ma, generator: mb.generator }) === JSON.stringify(mb), "manifest 는 generator 값만 다름 (키 순서 포함 나머지 같음)");
  const files = [...a.entries()].map(([name, data]) => ({ name, data: name === "manifest.json" ? task0JsonBytes({ ...ma, generator: TASK0_JOB_GENERATOR }) : data }));
  const renorm = await assembleTask0JobZip(files);
  assert(sha256(renorm) === SAMPLE_SHA, "정규화: 앱 zip 의 generator 를 견본 값으로 되돌려 다시 묶으면 견본 sha256");
  return r;
}

// ── (2) 파일 A·C·B ──────────────────────────────────────────────────────

async function sectionFixtures() {
  console.log("\n(2) 파일 A·C·B — 코어 job.zip: 검사기 위반 0, PNG = task0-mask 투사 프레임 래스터, run.gcode = Z2 고정값");
  assert(APP.exposure === undefined, "앱이 넘기는 노광(profileExposure(빌트인 Task0)) = undefined → 코어가 DEFAULT_* (규칙 6)");
  const pf = resolveTask0ProfileFrame(P);
  assert(
    JSON.stringify(APP.frame) ===
      JSON.stringify({ projectorWidthPx: 1920, projectorHeightPx: 1080, pixelPitchUm: 73, projectorOffsetXMm: 10, projectorOffsetYMm: 10 }) &&
      APP.frame.pixelPitchUm === pf.pixelPitchUm,
    `앱 투사 프레임 = 프로파일 값 ${JSON.stringify(APP.frame)} (규격 §1)`,
  );
  assert(
    JSON.stringify(APP.printable) ===
      JSON.stringify({ printableXMinMm: 10, printableXMaxMm: 150, printableYMinMm: 10, printableYMaxMm: 85 }) &&
      APP.printable.printableYMaxMm === TASK0_DEFAULTS.printableYMaxMm,
    `앱 출력 가능 영역 = 프로파일 값 = TASK0_DEFAULTS ${JSON.stringify(APP.printable)} (규격 §1, 규칙 6)`,
  );
  const results = {};
  for (const fx of [fixtureCube10(), fixtureGapPlates(), fixtureFileB()]) {
    const meshes = fx.meshes();
    const topY = meshesTopY(meshes);
    const lh = 0.1;
    const r = await runTask0JobZipExport({ meshes, topY, layerHeightMm: lh, ...APP, generator: TASK0_APP_JOB_GENERATOR });
    results[fx.name] = r;
    assert(r.ok, `${fx.name}: 통과 (막힘 이유 ${r.ok ? "없음" : JSON.stringify(r.issues)})`);
    if (!r.ok) continue;
    const L = r.summary.layerCount;
    const entries = await zipEntries(r.zip);
    const g = entries.get("run.gcode");
    const gHash = g ? sha256(g) : "(없음)";
    const gz = runTask0GcodeExport({ meshes: fx.meshes(), topY, layerHeightMm: lh, writer: APP.writer });
    assert(
      gHash === GCODE_SHA[fx.name] && gz.ok && sha256(gz.gcode) === gHash,
      `${fx.name}: run.gcode sha256 ${gHash.slice(0, 16)}… = Z2 고정값 = "run.gcode 만" 경로 출력`,
    );
    const rep = await verifyTask0JobZip(r.zip);
    assert(
      rep.pass && rep.violations.length === 0 && rep.extraIssues.length === 0 && rep.pngCount === L && rep.layerChangeCount === L && rep.manifestLayerCount === L,
      `${fx.name}: verifyTask0JobZip(전부 풀기) 위반 [${rep.violations}]·추가 ${rep.extraIssues.length}건, 층 ${L} = PNG ${rep.pngCount} = ;LAYER_CHANGE ${rep.layerChangeCount}`,
    );
    const cmp = await compareLayerPngsToTask0Raster(entries, fx.meshes(), lh, L);
    const bad = cmp.filter((c) => c.diff !== 0);
    assert(bad.length === 0, `${fx.name}: 층 PNG ${L}장 전부 = task0-mask 투사 프레임 래스터 × 255 (다른 층 ${bad.length}개${bad.length ? ` — 첫 층 ${bad[0].n}: ${bad[0].diff}px` : ""})`);
    const pngEmpty = cmp.filter((c) => c.pngWhite === 0).map((c) => c.n);
    const writerEmpty = rep.emptyLayers;
    assert(
      JSON.stringify(pngEmpty) === JSON.stringify(writerEmpty) && pngEmpty.length === r.summary.emptyLayerCount && r.job.emptyMaskLayerCount === pngEmpty.length,
      `${fx.name}: G-code 빈 층 ${JSON.stringify(writerEmpty)} = PNG 전부 0 인 층 ${JSON.stringify(pngEmpty)} (도포 = 노광)`,
    );
    const m = JSON.parse(dec.decode(entries.get("manifest.json")));
    const x = JSON.parse(dec.decode(entries.get("exposure.json")));
    assert(
      m.layerCount === L && m.materials[0].exposureSec === DEFAULT_EXPOSURE_SEC && m.materials[0].bottomExposureSec === DEFAULT_BOTTOM_EXPOSURE_SEC &&
        x.bottomLayerCount === DEFAULT_BOTTOM_LAYER_COUNT && x.transitionLayerCount === DEFAULT_TRANSITION_LAYER_COUNT && x.exposureSecByLayer.length === L,
      `${fx.name}: manifest 노광 ${m.materials[0].exposureSec}/${m.materials[0].bottomExposureSec} s·바닥 ${x.bottomLayerCount}층 = types/printer DEFAULT_* (규칙 6), exposure 길이 ${x.exposureSecByLayer.length}`,
    );
    assert(
      JSON.stringify(m.estimate) === JSON.stringify(r.summary.estimate) && m.generator === TASK0_APP_JOB_GENERATOR && !Number.isNaN(Date.parse(m.generatedAt)),
      `${fx.name}: manifest estimate = 화면 요약(totalSec ${m.estimate.totalSec} s), generator 앱 값, generatedAt ISO(${m.generatedAt})`,
    );
    assert(
      JSON.stringify(m.projector) === JSON.stringify({ widthPx: 1920, heightPx: 1080, pixelPitchUm: 73, offsetMm: [10, 10] }) &&
        JSON.stringify(m.bed) === JSON.stringify({ widthMm: 150, depthMm: 85 }),
      `${fx.name}: manifest projector·bed = 프로파일 값 (1920×1080·73 µm·(10,10) / 150×85)`,
    );
  }
  return results;
}

// ── (3) float32 topY ────────────────────────────────────────────────────

async function sectionFloat32() {
  console.log("\n(3) float32 topY — 정규화 한 곳(코어 입구), 층 수 = ceil(설계 topY / lh)");
  const tf = Math.fround(0.3);
  assert(tf !== 0.3 && task0LayerCount(tf, 0.1) === 4, `대조: Math.fround(0.3) = ${tf} → 정규화 전 task0LayerCount 4층`);
  assert(task0NormalizeTopY(tf) === 0.3 && task0LayerCount(task0NormalizeTopY(tf), 0.1) === 3, "정규화 후 0.3 → 3층");
  const meshTop = meshesTopY(sampleMeshes());
  assert(meshTop === tf, `견본 메시의 float32 최고점 = ${meshTop} (getSceneTopY 가 주는 값과 같은 꼴)`);
  const r = await runTask0JobZipExport(sampleInput({ topY: meshTop }));
  assert(r.ok && r.summary.layerCount === 3 && sha256(r.zip) === SAMPLE_SHA, `코어(float32 topY) → 3층, 견본 sha256 (${r.ok ? sha256(r.zip).slice(0, 16) : "막힘"}…)`);
  if (r.ok) {
    const g = dec.decode((await zipEntries(r.zip)).get("run.gcode"));
    assert(g.includes("\n; topYMm: 0.3\n") && g.split("\n").filter((l) => l === ";LAYER_CHANGE").length === 3, "run.gcode 메타 `; topYMm: 0.3`, ;LAYER_CHANGE 3개");
  }
  const above = await runTask0JobZipExport(sampleInput({ topY: 0.3 + 4e-7 }));
  assert(above.ok && sha256(above.zip) === SAMPLE_SHA, "topY 0.3 + 0.4 µm(위로 잡음) → 같은 견본 바이트 (맨 위 빈 층만 달라질 수 있는 폭)");
  const gz = runTask0GcodeExport({ meshes: sampleMeshes(), topY: meshTop, layerHeightMm: SAMPLE_LH });
  assert(gz.ok && gz.summary.layerCount === 3, `"run.gcode 만" 경로도 같은 입구 → 3층 (${gz.ok ? gz.summary.layerCount : "막힘"})`);
  const direct = await buildTask0JobZip({ meshes: sampleMeshes(), topY: meshTop, layerHeightMm: SAMPLE_LH, exposure: SAMPLE_EXPOSURE, generatedAt: SAMPLE_GENERATED_AT });
  assert(direct.manifest.layerCount === 4, `참고: 정규화 없는 견본 경로(buildTask0JobZip)에 float32 를 주면 ${direct.manifest.layerCount}층 — 그래서 앱 코어 입구에서 정규화`);

  // 성질: µm 설계값을 float32 로 넣어도 정규화 후 층 수 = 정수 계산
  let normBad = 0;
  let rawBad = 0;
  let total = 0;
  for (const lh of [0.025, 0.05, 0.1, 0.2]) {
    const lhUm = Math.round(lh * 1000);
    for (let k = 1; k <= 20000; k++) {
      const exact = Math.ceil(k / lhUm);
      const t = Math.fround(k / 1000);
      total++;
      if (task0LayerCount(task0NormalizeTopY(t), lh) !== exact) normBad++;
      if (task0LayerCount(t, lh) !== exact) rawBad++;
    }
  }
  assert(normBad === 0 && rawBad > 0, `µm 설계값 ${total}개(lh 0.025·0.05·0.1·0.2)를 float32 로: 정규화 후 어긋남 ${normBad}, 정규화 전 어긋남 ${rawBad}`);
  assert([10, 0.5, 0.3, 20, 25, 1.1].every((v) => task0NormalizeTopY(v) === v), "정확한 설계값(파일 A·B·C 의 10·0.5 등)은 정규화로 안 바뀜");
}

// ── (3b) 실제 워커 모듈 ─────────────────────────────────────────────────

async function sectionWorkerModule() {
  console.log("\n(3b) 실제 워커 모듈(slice-batch.worker.ts)에 task0-jobzip 메시지 — 단계 진행률·결과·같은 바이트·transfer");
  const posted = [];
  let handler = null;
  const hadSelf = Object.prototype.hasOwnProperty.call(globalThis, "self");
  const prevSelf = globalThis.self;
  globalThis.self = {
    addEventListener: (type, fn) => {
      if (type === "message") handler = fn;
    },
    postMessage: (m, transfer) => posted.push({ m, transfer }),
  };
  try {
    await import(pathToFileURL(path.join(V2, "workers", "slice-batch.worker.ts")).href);
  } finally {
    if (hadSelf) globalThis.self = prevSelf;
    else delete globalThis.self;
  }
  assert(typeof handler === "function", "워커 모듈이 message 리스너를 등록");
  if (typeof handler !== "function") return;
  const send = async (data) => {
    posted.length = 0;
    await handler({ data });
    return [...posted];
  };
  const jobMsg = (extra = {}) => ({
    kind: "task0-jobzip",
    meshes: sampleMeshes().map((t) => ({ triangles: t })),
    topY: SAMPLE_TOP_Y,
    layerHeightMm: SAMPLE_LH,
    writer: APP.writer,
    exposure: SAMPLE_EXPOSURE,
    frame: APP.frame,
    printable: APP.printable,
    generatedAt: SAMPLE_GENERATED_AT,
    ...extra,
  });
  const order = { gcode: 0, png: 1, verify: 2 };
  for (const [label, msg] of [["설계 topY 0.3", jobMsg()], ["float32 topY", jobMsg({ topY: Math.fround(0.3) })]]) {
    const out = await send(msg);
    const done = out.filter((p) => p.m.type === "task0-job-done");
    const prog = out.filter((p) => p.m.type === "progress").map((p) => p.m);
    const ok = done.length === 1 && out.at(-1) === done[0] && done[0].m.result.ok;
    assert(
      ok && sha256(done[0].m.result.zip) === SAMPLE_SHA,
      `${label}: task0-job-done 1건(마지막) · zip = 견본 sha256 (${ok ? sha256(done[0].m.result.zip).slice(0, 16) : "응답 없음"}…)`,
    );
    assert(
      ok && Array.isArray(done[0].transfer) && done[0].transfer.length === 1 && done[0].transfer[0] === done[0].m.result.zip.buffer,
      `${label}: zip.buffer 를 transfer 목록으로 보냄`,
    );
    const stages = prog.map((p) => p.stage);
    const lastOf = (st) => prog.filter((p) => p.stage === st).at(-1);
    assert(
      prog.length >= 3 && prog.every((p) => "stage" in p) && stages.every((st, i) => i === 0 || order[st] >= order[stages[i - 1]]) &&
        ["gcode", "png", "verify"].every((st) => lastOf(st) && lastOf(st).done === lastOf(st).total),
      `${label}: 진행률 ${prog.length}건 — 단계 키 있음, 순서 gcode → png → verify, 단계마다 마지막 done = total (${prog.map((p) => `${p.stage}:${p.done}/${p.total}`).join(" ")})`,
    );
  }
  // 기존 경로 — task0-gcode 진행률에는 stage 키가 없다
  const cube = fixtureCube10().meshes();
  const g = await send({ kind: "task0-gcode", meshes: cube.map((t) => ({ triangles: t })), topY: meshesTopY(cube), layerHeightMm: 0.1, writer: APP.writer });
  const gp = g.filter((p) => p.m.type === "progress").map((p) => p.m);
  const gd = g.find((p) => p.m.type === "task0-done");
  assert(
    gp.length >= 1 && gp.every((p) => !("stage" in p) && Object.keys(p).join(",") === "type,done,total") && gd && sha256(gd.m.result.gcode) === GCODE_SHA.cube10,
    `기존 task0-gcode 경로: progress 키 type,done,total 그대로(stage 없음 ${gp.length}건), run.gcode = 파일 A 고정값`,
  );
  // 출력 가능 영역 밖 — 워커 두 경로(task0-gcode·task0-jobzip) 모두 같은 문구로 막힘 (printable 은 메시지로 전달)
  const yb = areaInput(AREA_CASES.yBand);
  const wire = { meshes: yb.meshes.map((t) => ({ triangles: t })), topY: yb.topY, layerHeightMm: 0.1, writer: APP.writer, printable: APP.printable };
  const ag = (await send({ kind: "task0-gcode", ...wire })).find((p) => p.m.type === "task0-done");
  const aj = (await send({ kind: "task0-jobzip", ...wire, frame: APP.frame })).find((p) => p.m.type === "task0-job-done");
  assert(
    ag && !ag.m.result.ok && ag.m.result.issues[0].startsWith(AREA_MSG_HEAD) &&
      aj && !aj.m.result.ok && aj.m.result.zip === null && aj.m.result.issues[0] === ag.m.result.issues[0],
    `영역 밖(베드 Y 85.5~88.5) — 워커 run.gcode·job.zip 두 경로 같은 이유로 막힘: ${ag?.m.result.issues?.[0]?.slice(0, 60)}…`,
  );
  // 막힘 — error 가 아니라 task0-job-done
  const sp = FAIL_INPUTS.spiral();
  const b = await send({ kind: "task0-jobzip", meshes: sp.meshes.map((t) => ({ triangles: t })), topY: sp.topY, layerHeightMm: sp.layerHeightMm, writer: APP.writer });
  const bd = b.find((p) => p.m.type === "task0-job-done");
  assert(
    bd !== undefined && !bd.m.result.ok && bd.m.result.zip === null && !b.some((p) => p.m.type === "error") && bd.transfer === undefined,
    "막힘 입력(나선 벽) → error 가 아니라 task0-job-done(ok false, zip null, transfer 없음)",
  );
}

// ── (4) 막힘 ────────────────────────────────────────────────────────────

/** 같은 평면 면을 가진 겹친 상자 7개를 한 메시로 — 나선 벽 (verify-task0-export 와 같은 입력, 층 9 채움 실패) */
function spiralSingleMesh() {
  const box = boxTriangles;
  return [
    normalizeTriangleWinding(
      concatTris(
        box([-4, 0, -4], [4, 1, -3.8]),
        box([3.8, 0, -4], [4, 1, 4]),
        box([-4, 0, 3.8], [4, 1, 4]),
        box([-4, 0, -2], [-3.8, 1, 4]),
        box([-4, 0, -2], [2, 1, -1.8]),
        box([1.8, 0, -2], [2, 1, 2]),
        box([-2, 0, 1.8], [2, 1, 2]),
      ),
    ),
  ];
}

const FAIL_INPUTS = {
  spiral: () => {
    const meshes = spiralSingleMesh();
    return { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1 };
  },
  speed: () => {
    const meshes = fixtureGapPlates().meshes();
    return { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1, writer: { ...APP.writer, travelSpeedMmS: 150 } };
  },
};

async function sectionBlocked() {
  console.log("\n(4) 막힘 — 파일(zip) 없음 + 이유");
  const sp = await runTask0JobZipExport({ ...FAIL_INPUTS.spiral(), writer: APP.writer, frame: APP.frame, printable: APP.printable });
  assert(
    !sp.ok && sp.zip === null && sp.job === null && JSON.stringify(sp.failedLayers) === "[9]" &&
      sp.issues.some((s) => s.includes("얇은 부분 채움 실패") && s.includes("층 9")),
    `① 채움 실패(나선 벽): zip null, 층 이미지 단계 전 중단(job null), 이유 ${sp.ok ? "" : sp.issues[0].slice(0, 40)}…`,
  );
  const spd = await runTask0JobZipExport({ ...FAIL_INPUTS.speed(), frame: APP.frame, printable: APP.printable });
  assert(
    !spd.ok && spd.zip === null && spd.issues.some((s) => s.includes("Task0 파서 print(lh=0.1)") && s.includes("F 클램프")),
    `② 파서 경고(트래블 150 mm/s → F9000): zip null, 이유 ${spd.ok ? "" : spd.issues[0].slice(0, 50)}…`,
  );
  const crop = await loadExportMutant("crop-last-png", MUT_CROP_LAST);
  const c = await crop.runTask0JobZipExport(sampleInput());
  assert(
    !c.ok && c.zip === null && c.job !== null && c.issues.some((s) => s.includes("거부 조건 5") && s.includes("1920×1000")),
    `③ zip 검사 위반(코어 변조: 마지막 PNG 1920×1000): zip null, 이유 ${c.ok ? "" : c.issues.find((s) => s.includes("거부 조건 5"))}`,
  );
  const ew = await loadExportMutant("empty-gets-white", MUT_EMPTY_GETS_WHITE);
  const e1 = await ew.runTask0JobZipExport(sampleInput());
  assert(
    !e1.ok && e1.zip === null && JSON.stringify(e1.failedLayers) === "[1]" &&
      e1.issues.some((s) => s.includes("도포 영역 ≠ 노광 영역") && s.includes("G-code 는 빈 층 1개") && s.includes("층 1")),
    `④ 빈 층 집합 불일치(빈 층 1 에 흰 PNG): zip null, 이유 ${e1.ok ? "" : e1.issues[0]}`,
  );
  const pb = await loadExportMutant("printed-gets-black", MUT_PRINTED_GETS_BLACK);
  const e2 = await pb.runTask0JobZipExport(sampleInput());
  assert(
    !e2.ok && e2.zip === null && JSON.stringify(e2.failedLayers) === "[0]" &&
      e2.issues.some((s) => s.includes("마스크가 전부 검정인 층 1개") && s.includes("층 0")),
    `④ 빈 층 집합 불일치(도포 층 0 에 검정 PNG): zip null, 이유 ${e2.ok ? "" : e2.issues[0]}`,
  );
  const none = await runTask0JobZipExport({ meshes: fixtureGapPlates().meshes(), topY: 0, layerHeightMm: 0.1 });
  const noMesh = await runTask0JobZipExport({ meshes: [], topY: 10, layerHeightMm: 0.1 });
  assert(
    !none.ok && none.zip === null && none.summary === null && none.issues[0].includes("슬라이스할 층이 없습니다") && !noMesh.ok && noMesh.zip === null,
    "⑤ topY 0·메시 없음: zip null, 이유 '슬라이스할 층이 없습니다'",
  );

  // ⑥ 출력 가능 영역 밖 — writer 전에 막음 (job.zip·run.gcode 만 두 경로 공통)
  for (const c of Object.values(AREA_CASES)) {
    const prog = [];
    const j = await runTask0JobZipExport(areaInput(c), (st, d, t) => prog.push(`${st}:${d}/${t}`));
    const g = runTask0GcodeExport(areaInput(c));
    const want = `${AREA_MSG_HEAD}${c.box} (${c.excess}). 영역 안으로 옮기세요.`;
    assert(
      !j.ok && j.zip === null && j.summary === null && j.job === null && prog.length === 0 && j.issues.length === 1 && j.issues[0].startsWith(want) &&
        !g.ok && g.gcode === null && g.summary === null && g.issues[0] === j.issues[0],
      `⑥ ${c.label}: job.zip·run.gcode 둘 다 writer 전에 막힘(진행 0건) — "${j.ok ? "" : j.issues[0].slice(0, 90)}…"`,
    );
  }
  const edge = await runTask0JobZipExport(areaInput({ min: [0, 0, 32.5], max: [10, 0.3, 42.5] }));
  const tolIn = await runTask0JobZipExport(areaInput({ min: [0, 0, 32.5], max: [10, 0.3, 42.5005] }));
  const tolOut = runTask0GcodeExport(areaInput({ min: [0, 0, 32.5], max: [10, 0.3, 42.502] }));
  assert(
    edge.ok && tolIn.ok && !tolOut.ok && tolOut.issues[0].startsWith(AREA_MSG_HEAD),
    "⑥ 경계: 베드 Y 75~85(경계에 딱 맞음)·85.0005(1 µm 안)는 통과, 85.002 는 막힘",
  );

  // ⑦ 표본 풀기 — 흰 픽셀 하나만 지운 PNG(CRC·zlib 정상)는 표본 풀기가 잡는다
  const drop = await loadExportMutant("drop-one-white", MUT_DROP_ONE_WHITE);
  const d = await drop.runTask0JobZipExport(sampleInput());
  assert(
    !d.ok && d.zip === null && d.issues.some((s) => s.includes("층 0 PNG 를 풀어 보니") && s.includes("흰 픽셀 18768") && s.includes("흰 픽셀 18769")),
    `⑦ 층 0 PNG 흰 픽셀 하나 지움(코어 변조): zip null, 이유 ${d.ok ? "" : d.issues.find((s) => s.includes("풀어 보니"))}`,
  );
  // ⑧ estimate 대조 — 파일(manifest)과 화면 요약이 갈라지면 막는다
  const div = await loadExportMutant("estimate-diverge", MUT_ESTIMATE_DIVERGE);
  const v = await div.runTask0JobZipExport(sampleInput());
  assert(
    !v.ok && v.zip === null && v.issues.some((s) => s.includes("manifest estimate 가 화면 요약 estimate 와 다름")),
    "⑧ manifest 만 다른 시간 상수(코어 변조: 블레이드 16 s): zip null, 이유 'manifest estimate 가 화면 요약 estimate 와 다름'",
  );
  // ⑨ 'header' 자기 검사도 IHDR 8-bit 회색조를 본다 — 색 유형 2(RGB)·비트 깊이 16 으로 IHDR 만 바꾼(CRC 맞춤) PNG
  const sample = await buildSampleJob();
  for (const [what, at, val] of [["색 유형 2(RGB)", 25, 2], ["비트 깊이 16", 24, 16]]) {
    const z = await assembleTask0JobZip(sample.files.map((f) => (f.name === task0LayerPngName(0) ? { name: f.name, data: withIhdrByte(f.data, at, val) } : f)));
    const rep = await verifyTask0JobZip(z, { layerPngs: "header" });
    assert(
      !rep.pass && rep.violations.length === 0 && rep.extraIssues.some((m) => m.includes("layers/0000.png 가 8-bit 회색조·비인터레이스가 아님")),
      `⑨ 'header' 검사: 층 0 PNG IHDR ${what} → 추가 검사로 막힘 (${rep.extraIssues[0] ?? "통과해 버림"})`,
    );
  }
  return { crop, ew };
}

// ── (5) 배선 (소스) ──────────────────────────────────────────────────────

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

/**
 * Task0 출력 가능 영역 차단 — 두 핸들러가 alertIfOutOfTask0Area 로 막고 P-1 confirm 은 안 부름 (대조군 g2 가 같은 함수를 쓴다).
 * Z3-b: 하드 위반(isTask0HardViolation)은 alert 로 막고, 플레이트 아래로만 파고든 것은 그 뒤 confirm 으로 허용 —
 *   두 갈래의 상세(동작·문구·대조군)는 verify-task0-sink-allow.mjs.
 */
function task0AreaBlockOk(src) {
  const at = src.indexOf("const alertIfOutOfTask0Area = useCallback(");
  if (at < 0) return false;
  const endMark = "}, [volumeIssues]);";
  const end = src.indexOf(endMark, at);
  if (end < 0) return false;
  const fnBody = src.slice(at, end + endMark.length);
  const job = src.slice(src.indexOf("const handleExportTask0JobZip"), src.indexOf("const handleExportTask0Gcode"));
  const gc = src.slice(src.indexOf("const handleExportTask0Gcode"), src.lastIndexOf("return {"));
  const blocks = (b) =>
    /if \(alertIfOutOfTask0Area\(\)\) return;/.test(b) && !/confirmIfOutOfBounds/.test(b) &&
    /\n\s*alertIfOutOfTask0Area, \/\/ Task0 출력 가능 영역 차단\n/.test(b);
  return (
    !/\n\s*\}, \[/.test(fnBody.slice(0, -endMark.length)) && /window\.alert\(/.test(fnBody) &&
    /isTask0HardViolation\(/.test(fnBody) && fnBody.indexOf("window.alert(") < fnBody.indexOf("window.confirm(") &&
    /내보낼 수 없습니다/.test(fnBody) && /return true;/.test(fnBody) && blocks(job) && blocks(gc)
  );
}

/** 미리보기 층 수 배선 — 훅 1곳·페이지 2곳이 previewLayerCount(…, printerProfile) (대조군 m 이 같은 함수를 쓴다) */
function previewCountWired(hook, page) {
  return (
    /previewLayerCount\(\s*sceneTopY,\s*slicePreview\.layerHeightMm,\s*printerProfile,\s*\)/.test(hook) &&
    (page.match(/previewLayerCount\([^)]*, printerProfile\)/g) ?? []).length === 2 &&
    !/layerCountFor\(/.test(hook) && !/layerCountFor\(/.test(page)
  );
}

/** 규칙 7 — job.zip 핸들러 deps 에 printerProfile·층두께 (대조군 f 가 변조 소스에 같은 함수를 쓴다) */
function jobDepsOk(src) {
  const deps = lastDeps(src, "const handleExportTask0JobZip", "const handleExportTask0Gcode");
  return deps !== null && /\bprinterProfile\b/.test(deps) && /slicePreview\.layerHeightMm/.test(deps);
}

/** task0Report 무효화 + 도중 변경 epoch (대조군 g 가 변조 소스에 같은 함수를 쓴다) */
function reportInvalidationOk(src) {
  const at = src.indexOf("const task0ReportEpochRef = useRef(0);");
  if (at < 0) return false;
  const eff = src.slice(at, src.indexOf("]);", at) + 3);
  const effOk =
    /task0ReportEpochRef\.current \+= 1;/.test(eff) && /setTask0Report\(null\);/.test(eff) &&
    ["files", "supportsLength", "printerProfile", "slicePreview.layerHeightMm", "slicePreview.on"].every((d) =>
      new RegExp(`\\n\\s*${d.replace(".", "\\.")},\\n`).test(eff),
    );
  const job = src.slice(src.indexOf("const handleExportTask0JobZip"), src.indexOf("const handleExportTask0Gcode"));
  const gc = src.slice(src.indexOf("const handleExportTask0Gcode"), src.lastIndexOf("return {"));
  const guarded = (body) =>
    /const epoch = task0ReportEpochRef\.current;/.test(body) &&
    /const sameInputs = task0ReportEpochRef\.current === epoch;/.test(body) &&
    (body.match(/if \(sameInputs\) \{\s*setTask0Report\(/g) ?? []).length === 2 &&
    (body.match(/setTask0Report\(\{/g) ?? []).length === 2;
  return effOk && guarded(job) && guarded(gc);
}

function sectionWiring() {
  console.log("\n(5) 배선 — 워커·서비스·훅·패널·페이지");
  const worker = read("workers", "slice-batch.worker.ts");
  const fn = worker.slice(worker.indexOf("async function runTask0JobZip"), worker.indexOf("ctx.addEventListener"));
  assert(
    /runTask0JobZipExport\(/.test(fn) &&
      /meshes:\s*req\.meshes\.map\(\(m\)\s*=>\s*m\.triangles\)/.test(fn) &&
      ["topY", "layerHeightMm", "writer", "exposure", "frame", "printable", "generator", "generatedAt"].every((k) => new RegExp(`${k}:\\s*req\\.${k}`).test(fn)) &&
      /\(stage, done, total\) => reportProgress\(done, total, stage\)/.test(fn) &&
      /if \(result\.ok\) post\(\{ type: "task0-job-done", result \}, \[result\.zip\.buffer\]\);/.test(fn) &&
      /else post\(\{ type: "task0-job-done", result \}\);/.test(fn),
    "워커 runTask0JobZip = 코어를 요청 값 그대로 부르고 결과를 그대로 보냄(통과면 zip.buffer transfer)",
  );
  const gfn = worker.slice(worker.indexOf("function runTask0Gcode"), worker.indexOf("async function runTask0JobZip"));
  assert(/printable:\s*req\.printable/.test(gfn), "워커 runTask0Gcode 도 출력 가능 영역(printable)을 코어로 넘김 (run.gcode 만·job.zip 공통 차단)");
  assert(
    /req\.kind === "task0-gcode"\) \{\s*runTask0Gcode\(req\);\s*\} else \{\s*await runTask0JobZip\(req\);/.test(worker),
    "워커 분기: … → task0-gcode → 그 밖(task0-jobzip, await)",
  );
  assert(
    /if \(done < total && stage === lastStage && now - lastAt < minIntervalMs\) return;/.test(worker) &&
      /if \(stage === undefined\) post\(\{ type: "progress", done, total \}\);/.test(worker),
    "진행 스로틀: 단계가 바뀐 첫 알림은 바로, stage 없는 기존 경로는 종전 메시지",
  );
  const svc = read("utils", "slice-batch-service.ts");
  assert(
    /kind: "task0-jobzip"/.test(svc) && /new Blob\(\[r\.zip\], \{ type: "application\/zip" \}\)/.test(svc) &&
      /case "task0-job-done":[\s\S]*?resolve\(msg\.result\)/.test(svc) && /onProgress\?\.\(msg\.done, msg\.total, msg\.stage\)/.test(svc),
    "서비스 exportTask0JobZip → task0-jobzip 요청, task0-job-done resolve, Blob application/zip, 진행률에 단계 전달",
  );

  const hook = read("pages", "viewer", "hooks", "useSliceExport.ts");
  const body = hook.slice(hook.indexOf("const handleExportTask0JobZip"), hook.indexOf("const handleExportTask0Gcode"));
  assert(jobDepsOk(hook), "규칙 7 — handleExportTask0JobZip deps 에 printerProfile · slicePreview.layerHeightMm");
  assert(/`\$\{safe\}_task0_\$\{lh\}mm\.job\.zip`/.test(body), "파일 이름 <프로젝트>_task0_<lh>mm.job.zip");
  assert(
    /getSliceGeometry\(\)/.test(body) && /getSceneTopY\(\)/.test(body) && /task0WriterOptionsForProfile\(printerProfile\)/.test(body) &&
      /task0RasterFrameForProfile\(printerProfile\)/.test(body) && /exposure: profileExposure\(printerProfile\)/.test(body) &&
      /generator: TASK0_APP_JOB_GENERATOR/.test(body) && /isTask0Profile\(printerProfile\)/.test(body) &&
      /printable: task0PrintableFrameForProfile\(printerProfile\)/.test(body),
    "마스크 ZIP 과 같은 mesh 집합·topY, 프로파일 writer·투사 프레임·노광·출력 가능 영역, 앱 generator, Task0 프로파일만",
  );
  assert(
    task0AreaBlockOk(hook),
    "Task0 두 핸들러: 출력 가능 영역 밖(하드 — isTask0HardViolation)이면 confirm 이 아니라 alert 로 이유를 보이고 끝, 플레이트 아래만이면 그 뒤 confirm(Z3-b)(alertIfOutOfTask0Area, deps volumeIssues), P-1 confirm 은 부르지 않음",
  );
  assert(/setBatchExport\(\{ busy: true, done, total, stage \}\)/.test(body), "진행률에 단계(stage)를 담아 패널로");
  const iStl = hook.indexOf("const handleExportStl");
  const iJob = hook.indexOf("const handleExportTask0JobZip");
  const iG = hook.indexOf("const handleExportTask0Gcode");
  assert(iStl > 0 && iJob > iStl && iG > iJob, "핸들러 순서 handleExportStl → job.zip → run.gcode (다른 검증의 본문 구간을 건드리지 않음)");
  assert(reportInvalidationOk(hook), "task0Report 무효화(모델·서포트 수·프로파일·층두께·슬라이스 화면 deps) + 내보내기 도중 바뀌면 결과를 올리지 않음(epoch)");

  const panel = read("components", "SliceSidePanel.tsx");
  const branch = panel.slice(panel.indexOf(") : task0 ? ("), panel.indexOf("onClick={onExportMasksZip}"));
  const iJobBtn = branch.indexOf("onClick={onExportTask0JobZip}");
  const iGBtn = branch.indexOf("onClick={onExportTask0Gcode}");
  assert(
    iJobBtn > 0 && iGBtn > iJobBtn &&
      /onClick=\{onExportTask0JobZip\}[\s\S]*?bg-primary-600[\s\S]*?Task0 job\.zip/.test(branch) &&
      /onClick=\{onExportTask0Gcode\}[\s\S]*?border border-gray-300[\s\S]*?run\.gcode 만/.test(branch),
    "패널 Task0 분기: 'Task0 job.zip' 주 버튼(채운 색) → 'run.gcode 만' 보조 버튼(테두리)",
  );
  assert(!/key=\{msg\}/.test(panel) && /key=\{`\$\{i\}:\$\{msg\}`\}/.test(panel), "이유 목록 key 에 순번 — 같은 문장이 두 번 와도 중복 key 없음");
  assert(
    /gcode: "1\/3 G-code 생성 — 층"/.test(panel) && /png: "2\/3 층 이미지"/.test(panel) && /verify: "3\/3 묶기·검사 중…"/.test(panel) &&
      /<>진행 중… \{batchDone\} \/ \{batchTotal\}<\/>/.test(panel),
    "진행 표시: 단계 이름(G-code 생성 / 층 이미지 / 묶기·검사), 단계 없는 기존 경로는 '진행 중… n / N' 그대로",
  );
  const page = read("pages", "ViewerV2Page.tsx");
  assert(
    /onExportTask0JobZip=\{\(\) => void handleExportTask0JobZip\(\)\}/.test(page) && /batchStage=\{batchExport\.stage\}/.test(page),
    "ViewerV2Page: 패널에 job.zip 핸들러·단계",
  );
  assert(
    page.includes("⚠ 출력영역을 벗어난 모델 {volumeIssues.length}개 — 이대로\n                      출력하면 잘려 나갑니다.") &&
      /isTask0Profile\(printerProfile\) \? \([\s\S]*?⚠ Task0 출력 가능 영역을 벗어난 항목\(모델·서포트\)[\s\S]*?이대로는 내보낼 수 없습니다\. 영역\s+안으로 옮기세요\./.test(page),
    "출력영역 배너: Task0 프로파일이면 'Task0 출력 가능 영역 … (모델·서포트) … 이대로는 내보낼 수 없습니다' 제목, 기존 프로파일 문구는 그대로",
  );
  assert(previewCountWired(hook, page), "미리보기 층 수: 훅 1곳·페이지 2곳이 previewLayerCount(…, printerProfile) — layerCountFor 를 직접 부르지 않음");
  const core = fs.readFileSync(path.join(TASK0_SRC, "task0-export.ts"), "utf8");
  assert(
    /verifyTask0JobZip\(zip, \{ layerPngs: 'header' \}\)/.test(core) && (core.match(/task0NormalizeTopY\(/g) ?? []).length === 1,
    "코어: 자기 검사는 'header'(+ 생성 단계 단언·표본 풀기), topY 정규화 호출은 한 곳",
  );
}

// ── (6) 대조군 ───────────────────────────────────────────────────────────

async function sectionControls(blockedMutants) {
  console.log("\n(6) 대조군 — 변조하면 위 단언이 실제로 실패하는가");
  // a. 플레이트 늘림 마스크
  const rasterUrl = pathToFileURL(path.join(UTILS, "slice-rasterize.ts")).href;
  const geomUrl = pathToFileURL(path.join(UTILS, "slice-geometry.ts")).href;
  const pngUrl = pathToFileURL(path.join(TASK0_SRC, "task0-png.ts")).href;
  const plate = await loadExportMutant(
    "plate-stretch",
    [["  const images = await buildTask0LayerImages(", "  const images = await plateStretchImages("]],
    `
async function plateStretchImages(meshes, layerCount, lh, bed, opts) {
  const { rasterizePolygons } = await import('${rasterUrl}');
  const { chainSegments, sliceTrianglesAtY } = await import('${geomUrl}');
  const { encodeTask0MaskPng } = await import('${pngUrl}');
  const real = await buildTask0LayerImages(meshes, layerCount, lh, bed, opts);
  const layerFiles = [];
  const layerWhitePixels = [];
  for (let n = 0; n < layerCount; n++) {
    const polys = meshes.flatMap((t) => chainSegments(sliceTrianglesAtY(t, (n + 0.5) * lh)));
    const m = rasterizePolygons(polys, { widthPx: 1920, heightPx: 1080, plateWidthMm: bed.widthMm, plateDepthMm: bed.depthMm });
    let w = 0;
    for (const v of m.data) if (v) w++;
    layerWhitePixels.push(w);
    layerFiles.push({ name: real.layerFiles[n].name, data: await encodeTask0MaskPng(m) });
  }
  return { ...real, layerFiles, layerWhitePixels };
}
`,
  );
  const cube = fixtureCube10().meshes();
  const pr = await plate.runTask0JobZipExport({ meshes: cube, topY: meshesTopY(cube), layerHeightMm: 0.1, ...APP });
  const prRep = pr.ok ? await verifyTask0JobZip(pr.zip) : null;
  assert(pr.ok && prRep.pass, "a. 플레이트 늘림 마스크 코어: 코어 검사·verifyTask0JobZip 은 통과해 버린다(빈 층 집합·해상도는 맞음)");
  if (pr.ok) {
    const cmp = await compareLayerPngsToTask0Raster(await zipEntries(pr.zip), fixtureCube10().meshes(), 0.1, pr.summary.layerCount);
    const bad = cmp.filter((c) => c.diff !== 0);
    assert(
      bad.length === cmp.length && bad[0].pngWhite !== bad[0].white,
      `a. (2) 의 'PNG = task0-mask 래스터' 비교가 잡는다 — 다른 층 ${bad.length}/${cmp.length}, 층 0 흰 픽셀 ${bad[0]?.pngWhite} ≠ 투사 프레임 ${bad[0]?.white}`,
    );
  }
  // b. 빈 층 집합 대조 제거
  const noSet = await loadExportMutant("no-set-check", [...MUT_EMPTY_GETS_WHITE, [AT_SET_CHECK, "  if (false) {"]]);
  const ns = await noSet.runTask0JobZipExport(sampleInput());
  const hdr = ns.ok ? await verifyTask0JobZip(ns.zip, { layerPngs: "header" }) : null;
  const full = ns.ok ? await verifyTask0JobZip(ns.zip) : null;
  assert(
    ns.ok && hdr.pass && !full.pass && full.extraIssues.some((m) => m.includes("빈 층인데 PNG 에 흰 픽셀")),
    `b. 빈 층 대조를 빼면 변조 zip 이 파일로 나오고 'header' 검사도 통과 — 전부 풀기만 잡음(${full?.extraIssues[0] ?? "?"}) → 생성 단계 단언이 필요`,
  );
  // c. 정규화 제거
  const noNorm = await loadExportMutant("no-normalize", [["  const topY = task0NormalizeTopY(input.topY);", "  const topY = input.topY;"]]);
  const nn = await noNorm.runTask0JobZipExport(sampleInput({ topY: Math.fround(0.3) }));
  assert(nn.ok && nn.summary.layerCount === 4 && sha256(nn.zip) !== SAMPLE_SHA, `c. 정규화를 빼면 float32 견본이 ${nn.ok ? nn.summary.layerCount : "?"}층 — 견본 바이트와 다름 ((3) 이 실패)`);
  // d. 자기 검사 무시
  const noVerify = await loadExportMutant("no-self-verify", [...MUT_CROP_LAST, ["  if (issues.length > 0) return blocked(issues);", "  if (false) return blocked(issues);"]]);
  const nv = await noVerify.runTask0JobZipExport(sampleInput());
  const nvRep = nv.ok ? await verifyTask0JobZip(nv.zip) : null;
  assert(
    nv.ok && JSON.stringify(nvRep.violations) === "[5]",
    `d. 자기 검사 결과를 무시하면 1920×1000 PNG zip 이 파일로 나온다(검사기 위반 [${nvRep?.violations ?? "?"}]) — ③ 을 막는 것은 자기 검사`,
  );
  // e. 'header' 검사의 범위 (기록) — 'header' 도 PNG 청크 구조·CRC 는 본다(readTask0PngHeader 가 청크를 다 읽음).
  //    CRC 까지 맞춘 채 압축 몸통(zlib Adler-32)만 망가뜨리면 'header' 는 통과하고 'decode' 만 잡는다.
  const base = await buildSampleJob();
  const corrupt = (data, fixCrc) => {
    const d = data.slice();
    const idat = 33; // 시그니처 8 + IHDR 25 — 인코더는 IHDR 다음 IDAT 하나(task0-png 머리 주석)
    const len = (d[idat] << 24) | (d[idat + 1] << 16) | (d[idat + 2] << 8) | d[idat + 3];
    d[idat + 8 + len - 1] ^= 0xff; // zlib 꼬리(Adler-32) 마지막 바이트
    if (fixCrc) {
      const crc = task0Crc32(d, idat + 4, idat + 8 + len);
      d.set([crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff], idat + 8 + len);
    }
    return d;
  };
  const withPng0 = (data) => base.files.map((f) => (f.name === task0LayerPngName(0) ? { name: f.name, data } : f));
  const png0 = base.files.find((f) => f.name === task0LayerPngName(0)).data;
  const crcBroken = await assembleTask0JobZip(withPng0(corrupt(png0, false)));
  const bodyBroken = await assembleTask0JobZip(withPng0(corrupt(png0, true)));
  const ch = await verifyTask0JobZip(crcBroken, { layerPngs: "header" });
  const bh = await verifyTask0JobZip(bodyBroken, { layerPngs: "header" });
  const bd = await verifyTask0JobZip(bodyBroken);
  const hdrOk = readTask0PngHeader(corrupt(png0, true)).width === 1920;
  assert(
    !ch.pass && ch.extraIssues.some((m) => m.includes("청크 CRC")) &&
      hdrOk && bh.pass && !bd.pass && bd.extraIssues.some((m) => m.includes("8-bit 회색조 PNG 로 풀리지 않음")),
    "e. (기록) 'header' 도 청크 CRC 손상은 잡음, CRC 를 맞춘 압축 몸통 손상은 'decode' 만 잡음 → 코어는 생성 단계 단언 + 표본 두 장 풀기로 메운다",
  );
  // f. deps
  const hook = read("pages", "viewer", "hooks", "useSliceExport.ts");
  const at = hook.indexOf("const handleExportTask0JobZip");
  const brokenDeps = hook.slice(0, at) + hook.slice(at).replace(/\n\s*printerProfile,\n/, "\n");
  assert(brokenDeps !== hook && !jobDepsOk(brokenDeps), "f. job.zip 핸들러 deps 에서 printerProfile 을 빼면 (5) 의 규칙 7 검사가 실패한다");
  // g. epoch
  const noEpoch = hook.replace("const sameInputs = task0ReportEpochRef.current === epoch;", "const sameInputs = true;");
  const noEffect = hook.replace("    slicePreview.on,\n  ]);", "  ]);");
  assert(
    noEpoch !== hook && !reportInvalidationOk(noEpoch) && noEffect !== hook && !reportInvalidationOk(noEffect),
    "g. epoch 비교를 빼거나 무효화 deps 에서 슬라이스 화면(slicePreview.on)을 빼면 (5) 의 무효화 검사가 실패한다",
  );
  // g2. 영역 차단 소스 검사의 민감도 — Task0 핸들러가 P-1 confirm 으로 돌아가면 (5) 가 실패
  const backToConfirm = hook.replace("    if (alertIfOutOfTask0Area()) return; // Task0 는 출력 가능 영역 밖이면 막는다 (confirm 아님)\n", "    if (!confirmIfOutOfBounds()) return;\n");
  assert(backToConfirm !== hook && !task0AreaBlockOk(backToConfirm), "g2. Task0 핸들러를 P-1 confirm 으로 되돌리면 (5) 의 영역 차단 검사가 실패한다");

  // h. 영역 검사(사전·사후 모두)를 빼면 — 걸친 상자는 엉뚱한 "채움 실패" 문구, 노즐 밖 띠는 Y > 85 파일이 나온다
  const noArea = await loadExportMutant("no-area-check", [[AT_AREA_FN, AT_AREA_FN + "  return [];\n"]]);
  const hx = await noArea.runTask0JobZipExport(areaInput(AREA_CASES.xStraddle));
  assert(
    !hx.ok && hx.issues.some((s) => s.includes("얇은 부분 채움 실패")) && !hx.issues.some((s) => s.includes("출력 가능 영역")),
    `h. 영역 검사를 빼면 투사 X 최소에 걸친 상자는 "${hx.ok ? "(통과)" : hx.issues[0].slice(0, 30)}…" 로 막힘 — 원인과 다른 문구`,
  );
  const hy = await noArea.runTask0JobZipExport(areaInput(AREA_CASES.yBand));
  let hyYMax = NaN;
  let hyRep = null;
  if (hy.ok) {
    const text = dec.decode((await zipEntries(hy.zip)).get("run.gcode"));
    hyYMax = gcodeYMax(text);
    hyRep = await verifyTask0JobZip(hy.zip);
    assert(parseGcodeText(text, { mode: "print", layerHeightMm: 0.1 }).warnings.length === 0, "h. (그 zip 은 Task0 파서 이식판 print 경고도 0 — 파서는 노즐 범위를 모름)");
  }
  assert(
    hy.ok && hyYMax > 85 && hyRep.pass,
    `h. 영역 검사를 빼면 베드 Y 85.5~88.5 띠가 zip 으로 나온다 — G-code Y 최대 ${hyYMax} > 85(Klipper "Move out of range"), 검사기도 통과`,
  );
  // i. 사전 검사만 빼면 사후 검사(G-code XY)가 같은 띠를 막는다
  const noPre = await loadExportMutant("no-area-pre", [[AT_AREA_PRE, "  if (false) {"]]);
  const iy = await noPre.runTask0JobZipExport(areaInput(AREA_CASES.yBand));
  assert(
    !iy.ok && iy.zip === null && iy.issues.some((s) => s.startsWith("G-code 이동 좌표가 출력 가능 영역(X 10~150 × Y 10~85 mm) 밖입니다") && s.includes("Y 최대")),
    `i. 사전 검사만 빼면 사후 검사(writer 출력 XY)가 막는다: ${iy.ok ? "(통과)" : iy.issues.find((s) => s.startsWith("G-code"))?.slice(0, 70)}…`,
  );
  // j. 표본 풀기를 빼면 ⑦ 의 변조 zip 이 파일로 나온다 (전부 풀기 검사기도 통과 — 흰 픽셀 > 0 이라)
  const noSpot = await loadExportMutant("no-spot-decode", [...MUT_DROP_ONE_WHITE, [AT_SPOT_FILTER, "  ].filter((n) => n < -1);"]]);
  const js = await noSpot.runTask0JobZipExport(sampleInput());
  const jsCmp = js.ok ? await compareLayerPngsToTask0Raster(await zipEntries(js.zip), sampleMeshes(), SAMPLE_LH, 3) : null;
  const jsRep = js.ok ? await verifyTask0JobZip(js.zip) : null;
  assert(
    js.ok && jsRep.pass && jsCmp[0].diff === 1,
    `j. 표본 풀기를 빼면 흰 픽셀 하나 빠진 PNG zip 이 파일로 나온다(마스크와 ${jsCmp?.[0].diff ?? "?"}px 다름, 검사기 통과) — ⑦ 을 막는 것은 표본 풀기`,
  );
  // k. estimate 대조를 빼면 ⑧ 의 변조 zip 이 나오고 manifest 예상 시간 ≠ 화면 요약
  const noEst = await loadExportMutant("no-estimate-check", [...MUT_ESTIMATE_DIVERGE, [AT_ESTIMATE_CHECK, "  if (false) {"]]);
  const ke = await noEst.runTask0JobZipExport(sampleInput());
  const km = ke.ok ? JSON.parse(dec.decode((await zipEntries(ke.zip)).get("manifest.json"))) : null;
  assert(
    ke.ok && km.estimate.totalSec !== ke.summary.estimate.totalSec,
    `k. estimate 대조를 빼면 파일 예상 시간 ${km?.estimate.totalSec} s ≠ 화면 요약 ${ke.ok ? ke.summary.estimate.totalSec : "?"} s 인 zip 이 나온다 — ⑧ 을 막는 것은 이 대조`,
  );
  // l. 'header' IHDR 검사를 빼면(검사기 변조) ⑨ 의 RGB IHDR zip 이 통과한다
  const jobzipNoIhdr = await loadTask0Mutant("task0-jobzip.ts", "no-ihdr-check", [
    ["      if (!decodeLayers && (h.bitDepth !== 8 || h.colorType !== 0 || h.interlace !== 0)) {", "      if (false) {"],
  ]);
  const sample = await buildSampleJob();
  const rgb = await assembleTask0JobZip(sample.files.map((f) => (f.name === task0LayerPngName(0) ? { name: f.name, data: withIhdrByte(f.data, 25, 2) } : f)));
  const lRep = await jobzipNoIhdr.verifyTask0JobZip(rgb, { layerPngs: "header" });
  assert(lRep.pass, "l. 검사기에서 IHDR 8-bit 회색조 확인을 빼면 'header' 검사가 RGB IHDR zip 을 통과시킨다 — ⑨ 를 잡는 것은 그 확인");
  // m. 미리보기 층 수 — Task0 만 정규화, 기존 프로파일은 layerCountFor 그대로
  const mars = { outputKind: undefined };
  const tf = Math.fround(0.3);
  let marsSame = true;
  for (let i = 0; i < 3000; i++) {
    const t = Math.fround(((i * 7919) % 30011) / 1000);
    const lh = [0.025, 0.05, 0.1, 0.03, 0.2][i % 5];
    if (previewLayerCount(t, lh, mars) !== layerCountFor(t, lh)) marsSame = false;
  }
  const core = await runTask0JobZipExport(sampleInput({ topY: tf }));
  assert(
    previewLayerCount(tf, 0.1, P) === 3 && core.ok && core.summary.layerCount === 3 && layerCountFor(tf, 0.1) === 4 && marsSame,
    `m. 미리보기 층 수(Task0, float32 0.3) = ${previewLayerCount(tf, 0.1, P)} = job.zip ${core.ok ? core.summary.layerCount : "?"}층 — 정규화 없이 세면 ${layerCountFor(tf, 0.1)}(대조), 기존 프로파일은 layerCountFor 와 3000/3000 같음`,
  );
  const hookSrc = read("pages", "viewer", "hooks", "useSliceExport.ts");
  const pageSrc = read("pages", "ViewerV2Page.tsx");
  const pageBack = pageSrc.replace("previewLayerCount(sceneTopY, mm, printerProfile)", "layerCountFor(sceneTopY, mm)");
  assert(pageBack !== pageSrc && !previewCountWired(hookSrc, pageBack), "m. 페이지 한 곳을 layerCountFor 로 되돌리면 (5) 의 미리보기 배선 검사가 실패한다");
  void blockedMutants;
}

// ── (7) 기존 산출물 불변 ────────────────────────────────────────────────

async function sectionUnchanged() {
  console.log("\n(7) 기존 산출물 불변 — 견본·불량 7종 sha256, 기존 경로 진행 알림");
  const { sample, bads } = await buildTask0SampleSet();
  assert(sha256(sample.bytes) === SAMPLE_SHA, `sample.job.zip ${sha256(sample.bytes).slice(0, 16)}… = 10/8 전달본`);
  const mism = bads.filter((b) => sha256(b.bytes) !== BAD_SHA[b.spec.file]).map((b) => b.spec.file);
  assert(bads.length === BAD_SPECS.length && bads.length === 7 && mism.length === 0, `불량 7종 sha256 = 10/8 전달본 (다른 것 ${JSON.stringify(mism)})`);
  const worker = read("workers", "slice-batch.worker.ts");
  const png = worker.slice(worker.indexOf("async function runPngZip"), worker.indexOf("function runGcode"));
  const gc = worker.slice(worker.indexOf("function runGcode"), worker.indexOf("function runTask0Gcode"));
  assert(
    /reportProgress\(i \+ 1, layerCount\);/.test(png) && /const layerCount = Math\.max\(\s*1,\s*Math\.ceil\(options\.topY \/ options\.layerHeightMm\),\s*\);/.test(png) &&
      /\(done, total\) => reportProgress\(done, total\),/.test(gc) && !/task0NormalizeTopY/.test(png + gc),
    "마스크 ZIP(runPngZip)·marlin(runGcode): 진행 알림은 단계 없이 두 인자, 층 수 식 그대로(정규화 미적용) — 산출 바이트 경로 무변경",
  );
  const lc = fs.readFileSync(path.join(V2, "pages", "viewer", "utils", "layer-count.ts"), "utf8");
  assert(/return Math\.max\(1, Math\.ceil\(topY \/ layerHeightMm\)\);/.test(lc), "미리보기 층 수(layerCountFor)는 그대로 — 기존 마스크 경로 무변경");
}

// ── (8) 성능 참고 ───────────────────────────────────────────────────────

async function sectionPerf() {
  if (process.env.TASK0_PERF !== "1") {
    console.log("\n(8) 성능 참고 — 건너뜀 (TASK0_PERF=1 일 때만)");
    return;
  }
  console.log("\n(8) 성능 참고 (판정 없음)");
  const cases = [
    ["20 mm 정육면체(리프트 5 mm, Y 5~25) 0.1 mm", [normalizeTriangleWinding(boxTriangles([-10, 5, -10], [10, 25, 10]))], 0.1],
    ["100×60 mm 판 3 mm 0.1 mm", [normalizeTriangleWinding(boxTriangles([-50, 0, -30], [50, 3, 30]))], 0.1],
  ];
  for (const [label, meshes, lh] of cases) {
    const t0 = performance.now();
    const r = await runTask0JobZipExport({ meshes, topY: meshesTopY(meshes), layerHeightMm: lh, ...APP, generator: TASK0_APP_JOB_GENERATOR });
    const total = performance.now() - t0;
    if (!r.ok) {
      console.log(`  ${label}: 막힘 — ${r.issues[0]}`);
      continue;
    }
    const s = r.job.stageMs;
    const L = r.summary.layerCount;
    const t1 = performance.now();
    await verifyTask0JobZip(r.zip);
    const decodeMs = performance.now() - t1;
    console.log(
      `  ${label}: ${L}층 — G-code ${(s.gcode / 1000).toFixed(2)} s (${(s.gcode / L).toFixed(0)} ms/층), ` +
        `층 이미지 ${(s.png / 1000).toFixed(2)} s (${(s.png / L).toFixed(1)} ms/층), 묶기·검사('header') ${(s.verify / 1000).toFixed(2)} s, ` +
        `합 ${(total / 1000).toFixed(2)} s, zip ${(r.job.zipBytes / 1024).toFixed(0)} KB / 참고: 'decode' 검사였다면 ${(decodeMs / 1000).toFixed(2)} s`,
    );
  }
}

async function main() {
  console.log("Task0 앱 job.zip 내보내기 검증 (Z3 — 앱 경로 = 스크립트 경로, 규격서 v0.3.4 §11)");
  console.log(`  기준: 투사 ${TASK0_DEFAULTS.projectorWidthPx}×${TASK0_DEFAULTS.projectorHeightPx} · ${TASK0_DEFAULTS.pixelPitchUm} µm, 베드 ${TASK0_DEFAULTS.bedWidthMm}×${TASK0_DEFAULTS.bedDepthMm}`);
  await sectionSamplePath();
  await sectionFixtures();
  await sectionFloat32();
  await sectionWorkerModule();
  const blockedMutants = await sectionBlocked();
  sectionWiring();
  await sectionControls(blockedMutants);
  await sectionUnchanged();
  await sectionPerf();
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
