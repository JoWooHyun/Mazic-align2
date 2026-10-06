// Task0 job.zip 조립·검사기 + 8-bit 회색조 PNG 인코더 헤드리스 검증 (로드맵 0절 2주차 — 10/8 견본 zip, Z3 준비).
//
//   무엇을: src/features/v2/utils/task0/ 의
//     task0-png.ts (8-bit 회색조 PNG 인코더·디코더, CRC-32) · task0-jobzip.ts (manifest·exposure·estimate·preview·zip 조립,
//     zip 읽기, 검사기 verifyTask0JobZip) + scripts/gen-task0-sample-zip.mjs (견본 sample.job.zip + 불량 7종).
//     규격 = Task0 리포 docs/Task0_Gcode_규격서_초안.md v0.3.4 @ a4ebc6c §11(job.zip·거부 조건 1~7)·§3·§13,
//     협의 docs/제안_Task0협의_20260929.md §26-3·§27-1.
//
//   (1) PNG — 이 스크립트 안의 **독립 구현**(비트 단위 CRC-32 + node:zlib inflate + 필터 5종 복원)으로 대조:
//       a. CRC-32 — 표준 시험값 "123456789" = CBF43926, 무작위 버퍼에서 비트 단위 계산과 같음.
//       b. 왕복 — 무작위 크기(1×1, 1×N, N×1, 37×23 …)·내용(잡음·블록 0/255·상수·기울기) 이미지를 인코딩 →
//          독립 디코더·모듈 디코더 둘 다 원래 픽셀과 같음, 청크 = IHDR·IDAT·IEND 만, IHDR 8-bit 회색조, 청크 CRC 일치,
//          필터 바이트 ∈ {None, Up}, 같은 행이 반복되면 Up, 두 번 인코딩 → 같은 바이트.
//       c. 0/1 마스크 → 0/255.  d. 모듈 디코더 일반성 — 이 스크립트가 Sub·Average·Paeth 필터와 IDAT 여러 개로 만든 PNG 도 풂.
//       e. 모듈 디코더 거부 13종(사유 문구까지 일치) — RGB·16-bit·팔레트·인터레이스·시그니처·IDAT/IEND **청크 CRC 필드**·
//          zlib 꼬리(Adler-32, 청크 CRC 는 맞춤)·IDAT 사이 보조 청크(연속성)·잘림·IEND 뒤 바이트·필터 5·짧은 데이터.
//          대조: 보조 청크가 IHDR 과 첫 IDAT 사이면 받음.
//   (2) manifest·exposure·estimate — 규격 §11 예시와 같은 키·순서, 견본 값, exposure 보간·기본값(types/printer DEFAULT_*),
//       estimate 를 **run.gcode 텍스트만으로 다시 계산**(층마다 파킹 (0,0) 에서 시작, 줄의 F 로 시간)해 1 ms 안에서 같음,
//       totalSec = 7개 합(ms 정수).
//   (3) preview — 400×300, 견본 실루엣이 정사각·가운데·여백, 비대칭 L 자로 위아래·좌우 방향, 빈 합집합 = 전부 0, 확대 상한.
//   (4) 결정성 — 견본을 두 번 만들면 같은 바이트, 입력 메시 무변경, generatedAt 만 바꾸면 manifest 만 달라짐.
//   (5) 견본 내용 — 검사기 위반 0·추가 0, zip 항목 순서·무압축·CRC(독립 파싱), run.gcode = writer 출력 그대로,
//       파서 이식판 dryrun·print(lh 포함) 경고·오류 0, PNG 3장 1920×1080 8-bit 회색조 0/255, 층 1 전부 0,
//       층 0·2 = 그 층 마스크 × 255 (독립 디코더), 흰 영역 위치·방향(행 0 = Y 최대) = 베드 X 75~85 × Y 42.5~52.5.
//   (6) 불량 7종 — 각각 위반이 정확히 [N]·추가 0, 견본과 다른 곳이 의도한 항목뿐.
//   (7) 대조군 —
//       a. 검사기에서 조건 N 을 빼면(conditions 옵션) bad_N 이 통과해 버린다 → 그 zip 을 잡는 것은 조건 N 뿐.
//       b. 추가 검사 변조 13종(빈 층 흰 픽셀, 인라인 주석, RGB PNG, totalSec, format, preview 없음, zip CRC, ;HEIGHT:,
//          toolChangeCount, exposure lh, 알 수 없는 항목, JSON 앞 BOM, 도포 층 검정 PNG) — 위반 번호는 그대로 [] 이고 추가 검사가 잡음,
//          extraChecks 를 끄면 통과.
//       c. 조건의 다른 형태 — manifest 없음 [2], 4자리 아닌 이름 [4], bed·projector 값 [5], exposure 없음 [6],
//          PNG 수·;LAYER_CHANGE 수만 다름 [3], ;Z: 없음 ∋ 7, zip 아님 ∋ 1·2,
//          조건 7 허용치 경계 — 층 2 의 ;Z:·G1 Z 를 ±0.002 → [7], ±0.0009 → 통과 (파서 이식판 print(lh) 판정과 같음).
//       d. deflate(방식 8)로 다시 묶은 견본도 통과(zip 읽기 경로).
//   (8) (선택) python 이 있으면 zipfile.testzip() 로 8개 zip 무결성, Task0 리포가 있으면 원본 파서(03c0519 — v0.2.1)로
//       견본 run.gcode print(lh 0.1) 오류 0·bad_7 오류 1(v0.2.1 문구 'Z0.3100 (기대 Z0.3000)') — 없으면 SKIP(판정에 영향 없음).
//   (9) 참고 — 층당 마스크 래스터·PNG 인코딩·디코딩 시간 (판정 없음, Z3 성능 참고).
//
//   대조군 원칙(구현 쪽): 모듈을 일부러 망가뜨리면 이 스크립트가 exit 1 — 2026-10-06 실측 23종 모두 FAIL:
//     PNG — 색 유형 0→2, Up 필터 식(− → +), CRC 다항식, 디코더 Paeth 동률 순서, 필터 항상 None,
//           디코더 청크 CRC 검사 빠짐, 디코더 IDAT 연속성 검사 빠짐;
//     jobzip — estimate 빈 층도 파킹·블레이드·노광, totalSec 에서 노광 빠짐, 조건 7 허용치 0.1, 조건 4 기대 이름 1부터,
//     preview 위아래·좌우 뒤집힘, 층 PNG 이름 1부터, 조건 5 가 첫 PNG 만 봄, 빈 층 흰 픽셀 검사 빠짐, exposure 한 층 밀림,
//     zip 방식 8 을 zlib 형식으로 풂, 조건 3 이 PNG 수·;LAYER_CHANGE 수를 비교 안 함, 조건 6 기준을 PNG 수로, 조건 2 version 검사 빠짐,
//     조건 7 허용치 0.005(경계 사례가 잡음 — bad_7 의 0.01 만으로는 못 잡는 폭).
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "FAIL"·"위반" 문자열을 출력한다.
//   실행: npx tsx scripts/verify-task0-jobzip.mjs   (선택) TASK0_DIR=<Task0 리포>, PYTHON=<python 실행 파일>
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

import {
  DEFAULT_BOTTOM_EXPOSURE_SEC,
  DEFAULT_BOTTOM_LAYER_COUNT,
  DEFAULT_EXPOSURE_SEC,
} from "../src/features/v2/types/printer.ts";
import { TASK0_DEFAULTS, TASK0_TIME_CONSTANTS, pixelCenterToBed } from "../src/features/v2/utils/task0/task0-frame.ts";
import { generateTask0Gcode } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import { parseGcodeText } from "../src/features/v2/utils/task0/task0-gcode-parser.ts";
import {
  TASK0_ESTIMATE_PARTS,
  assembleTask0JobZip,
  buildTask0Estimate,
  buildTask0Exposure,
  buildTask0Preview,
  readTask0ZipEntries,
  task0JsonBytes,
  task0LayerPngName,
  verifyTask0JobZip,
} from "../src/features/v2/utils/task0/task0-jobzip.ts";
import { rasterizeTask0Mask } from "../src/features/v2/utils/task0/task0-mask.ts";
import {
  decodeTask0GrayPng,
  encodeTask0GrayPng,
  encodeTask0MaskPng,
  readTask0PngHeader,
  task0Crc32,
} from "../src/features/v2/utils/task0/task0-png.ts";
import { task0LayerPolygonsBed } from "../src/features/v2/utils/task0/task0-slice.ts";
import {
  BAD_SPECS,
  SAMPLE_EXPOSURE,
  SAMPLE_GENERATED_AT,
  SAMPLE_LH,
  SAMPLE_TOP_Y,
  badProblems,
  buildSampleJob,
  buildTask0SampleSet,
  sampleMeshes,
  sampleProblems,
} from "./gen-task0-sample-zip.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const TASK0_DIR = process.env.TASK0_DIR || path.resolve(REPO_ROOT, "..", "Task0");
const PARSER_COMMIT = "03c0519"; // 파서 v0.2.1 (Z1-c — 협의 §30-3)

const F = TASK0_DEFAULTS;
const W_PX = F.projectorWidthPx;
const H_PX = F.projectorHeightPx;

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

const timings = [];
async function timed(label, fn) {
  console.log(`\n${label}`);
  const t0 = performance.now();
  let r;
  try {
    r = await fn();
  } catch (err) {
    // 모듈이 망가져 던진 예외도 실패로 센다 (대조군 — 변조 구현이 예외로 끝나도 FAIL 로 보이게)
    assert(false, `${label} — 예외: ${err instanceof Error ? err.stack?.split("\n").slice(0, 2).join(" ") : String(err)}`);
  }
  timings.push([label, performance.now() - t0]);
  return r;
}

/** 재현 가능한 난수 (mulberry32) */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const sameBytes = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ── 독립 구현: CRC-32 · PNG · zip ─────────────────────────────────────────

/** 비트 단위 CRC-32 (표 없이 — 모듈의 표 구현과 독립) */
function refCrc(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
function putU32be(v) {
  return Uint8Array.of((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
}
function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** PNG 청크 목록 (독립 파서) — CRC 는 refCrc 로 */
function refChunks(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((v, i) => bytes[i] === v)) throw new Error("시그니처 아님");
  const out = [];
  let p = 8;
  while (p < bytes.length) {
    const len = u32be(bytes, p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + len);
    const crcOk = u32be(bytes, p + 8 + len) === refCrc(bytes.subarray(p + 4, p + 8 + len));
    out.push({ type, data, crcOk });
    p += 12 + len;
  }
  return out;
}

/** 독립 PNG 디코더 (8-bit 회색조 전용, 필터 5종) */
function refDecode(bytes) {
  const chunks = refChunks(bytes);
  const ih = chunks[0].data;
  const width = u32be(ih, 0);
  const height = u32be(ih, 4);
  const raw = zlib.inflateSync(concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const data = new Uint8Array(width * height);
  const filters = [];
  for (let r = 0; r < height; r++) {
    const ft = raw[r * (width + 1)];
    filters.push(ft);
    for (let c = 0; c < width; c++) {
      const x = raw[r * (width + 1) + 1 + c];
      const a = c > 0 ? data[r * width + c - 1] : 0;
      const b = r > 0 ? data[(r - 1) * width + c] : 0;
      const d = r > 0 && c > 0 ? data[(r - 1) * width + c - 1] : 0;
      let pred = 0;
      if (ft === 1) pred = a;
      else if (ft === 2) pred = b;
      else if (ft === 3) pred = Math.floor((a + b) / 2);
      else if (ft === 4) {
        const pp = a + b - d;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - d);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : d;
      }
      data[r * width + c] = (x + pred) & 255;
    }
  }
  return {
    width,
    height,
    bitDepth: ih[8],
    colorType: ih[9],
    compression: ih[10],
    filterMethod: ih[11],
    interlace: ih[12],
    data,
    filters,
    chunkTypes: chunks.map((c) => c.type),
    crcOk: chunks.every((c) => c.crcOk),
  };
}

function refChunk(type, data) {
  const td = concat([enc.encode(type), data]);
  return concat([putU32be(data.length), td, putU32be(refCrc(td))]);
}

/**
 * 독립 PNG 인코더 (시험용) — filterOf(r) 로 행 필터 지정, 바이트/픽셀 bpp, IDAT 을 parts 개로 나눔.
 * ihdrOver 로 IHDR 값 덮어쓰기(거부 시험용).
 */
function refEncode({ width, height, data, bpp = 1, filterOf = () => 0, idatParts = 1, ihdr = {} }) {
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  for (let r = 0; r < height; r++) {
    const ft = filterOf(r);
    raw[r * (stride + 1)] = ft;
    for (let i = 0; i < stride; i++) {
      const x = data[r * stride + i];
      const a = i >= bpp ? data[r * stride + i - bpp] : 0;
      const b = r > 0 ? data[(r - 1) * stride + i] : 0;
      const d = r > 0 && i >= bpp ? data[(r - 1) * stride + i - bpp] : 0;
      let pred = 0;
      if (ft === 1) pred = a;
      else if (ft === 2) pred = b;
      else if (ft === 3) pred = Math.floor((a + b) / 2);
      else if (ft === 4) {
        const pp = a + b - d;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - d);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : d;
      } else if (ft !== 0) pred = 0;
      raw[r * (stride + 1) + 1 + i] = (x - pred) & 255;
    }
  }
  const z = zlib.deflateSync(raw);
  const h = { bitDepth: 8, colorType: 0, compression: 0, filter: 0, interlace: 0, ...ihdr };
  const ih = concat([putU32be(width), putU32be(height), Uint8Array.of(h.bitDepth, h.colorType, h.compression, h.filter, h.interlace)]);
  const idats = [];
  const step = Math.ceil(z.length / idatParts);
  for (let o = 0; o < z.length; o += step) idats.push(refChunk("IDAT", z.subarray(o, o + step)));
  return concat([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), refChunk("IHDR", ih), ...idats, refChunk("IEND", new Uint8Array(0))]);
}

/** zip 독립 파싱 — 로컬 머리를 처음부터 차례로 (중앙 디렉터리는 보지 않음) */
function refUnzipLocal(bytes) {
  const out = [];
  let p = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  while (p + 30 <= bytes.length && view.getUint32(p, true) === 0x04034b50) {
    const method = view.getUint16(p + 8, true);
    const time = view.getUint16(p + 10, true);
    const date = view.getUint16(p + 12, true);
    const crc = view.getUint32(p + 14, true);
    const comp = view.getUint32(p + 18, true);
    const size = view.getUint32(p + 22, true);
    const nl = view.getUint16(p + 26, true);
    const el = view.getUint16(p + 28, true);
    const name = dec.decode(bytes.subarray(p + 30, p + 30 + nl));
    const start = p + 30 + nl + el;
    const raw = bytes.subarray(start, start + comp);
    const data = method === 8 ? new Uint8Array(zlib.inflateRawSync(raw)) : raw;
    out.push({ name, method, time, date, crc, size, data, crcOk: refCrc(data) === crc });
    p = start + comp;
  }
  return out;
}

/** 독립 zip 작성 — method 0 또는 8 (deflate 읽기 경로 시험용) */
function refZip(files, methodOf) {
  const locals = [];
  const centrals = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const method = methodOf(f);
    const body = method === 8 ? new Uint8Array(zlib.deflateRawSync(f.data)) : f.data;
    const crc = refCrc(f.data);
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, off, true);
    cd.set(name, 46);
    locals.push(lh, body);
    centrals.push(cd);
    off += lh.length + body.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, off, true);
  return concat([...locals, ...centrals, eocd]);
}

async function throwsAsync(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ── (1) PNG ──────────────────────────────────────────────────────────────

/** 시험 이미지 */
function makeImage(kind, width, height, rng) {
  const data = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let v = 0;
      if (kind === "noise") v = Math.floor(rng() * 256);
      else if (kind === "const0") v = 0;
      else if (kind === "const255") v = 255;
      else if (kind === "gradient") v = (r * 7 + c * 3) & 255;
      else if (kind === "blocks") v = ((Math.floor(r / 5) + Math.floor(c / 3)) & 1) * 255;
      data[r * width + c] = v;
    }
  }
  if (kind === "rects") {
    for (let k = 0; k < 4; k++) {
      const x0 = Math.floor(rng() * width);
      const y0 = Math.floor(rng() * height);
      const x1 = Math.min(width, x0 + 1 + Math.floor(rng() * width));
      const y1 = Math.min(height, y0 + 1 + Math.floor(rng() * height));
      for (let r = y0; r < y1; r++) for (let c = x0; c < x1; c++) data[r * width + c] = 255;
    }
  }
  return { width, height, data };
}

async function sectionPng() {
  // a. CRC
  assert(task0Crc32(enc.encode("123456789")) === 0xcbf43926, "(1a) CRC-32 표준 시험값 \"123456789\" = CBF43926");
  {
    const rng = makeRng(11);
    let bad = 0;
    for (const n of [0, 1, 3, 8, 255, 1000, 4097]) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = Math.floor(rng() * 256);
      if (task0Crc32(b) !== refCrc(b)) bad++;
      if (n > 4 && task0Crc32(b, 2, n - 1) !== refCrc(b.subarray(2, n - 1))) bad++;
      if (typeof zlib.crc32 === "function" && zlib.crc32(b) !== refCrc(b)) bad++;
    }
    assert(bad === 0, `(1a) CRC-32 = 비트 단위 계산${typeof zlib.crc32 === "function" ? " = node:zlib.crc32" : ""} (무작위 버퍼 7종, 부분 구간 포함) — 불일치 ${bad}`);
  }

  // b. 왕복
  const rng = makeRng(20261008);
  const sizes = [[1, 1], [1, 9], [9, 1], [37, 23], [300, 7], [64, 64], [5, 300]];
  const kinds = ["noise", "const0", "const255", "gradient", "blocks", "rects"];
  let cases = 0;
  const problems = [];
  for (const [w, h] of sizes) {
    for (const kind of kinds) {
      const img = makeImage(kind, w, h, rng);
      const png = await encodeTask0GrayPng(img);
      const png2 = await encodeTask0GrayPng({ width: w, height: h, data: img.data.slice() });
      const ref = refDecode(png);
      const mine = await decodeTask0GrayPng(png);
      const tag = `${w}×${h} ${kind}`;
      cases++;
      if (!sameBytes(ref.data, img.data)) problems.push(`${tag}: 독립 디코더 픽셀 불일치`);
      if (!sameBytes(mine.data, img.data) || mine.width !== w || mine.height !== h) problems.push(`${tag}: 모듈 디코더 불일치`);
      if (!ref.crcOk) problems.push(`${tag}: 청크 CRC 불일치(독립 계산)`);
      if (ref.chunkTypes.join(",") !== "IHDR,IDAT,IEND") problems.push(`${tag}: 청크 ${ref.chunkTypes.join(",")}`);
      if (ref.width !== w || ref.height !== h || ref.bitDepth !== 8 || ref.colorType !== 0 || ref.compression !== 0 ||
        ref.filterMethod !== 0 || ref.interlace !== 0) problems.push(`${tag}: IHDR 값`);
      if (!ref.filters.every((f) => f === 0 || f === 2) || ref.filters[0] !== 0) problems.push(`${tag}: 필터 ${[...new Set(ref.filters)]}`);
      if (!sameBytes(png, png2)) problems.push(`${tag}: 두 번 인코딩한 바이트가 다름`);
      const hd = readTask0PngHeader(png);
      if (hd.width !== w || hd.height !== h || hd.bitDepth !== 8 || hd.colorType !== 0) problems.push(`${tag}: readTask0PngHeader`);
    }
  }
  for (const p of problems.slice(0, 10)) console.error(`    ${p}`);
  assert(problems.length === 0, `(1b) 왕복 ${cases}건 — 독립 디코더·모듈 디코더 픽셀 일치, IHDR 8-bit 회색조, 청크 3개·CRC, 필터 None/Up, 결정적 (문제 ${problems.length})`);

  // 필터 선택 — 같은 행이 반복되면 Up, 0 행은 None
  {
    const w = 50;
    const img = { width: w, height: 4, data: new Uint8Array(w * 4) };
    for (let r = 0; r < 4; r++) for (let c = 0; c < w; c++) img.data[r * w + c] = c % 7 === 0 ? 255 : 0;
    const ref = refDecode(await encodeTask0GrayPng(img));
    assert(ref.filters.join(",") === "0,2,2,2", `(1b) 필터 선택: 같은 행 반복 → Up (행별 필터 ${ref.filters.join(",")})`);
  }

  // c. 0/1 마스크 → 0/255
  {
    const m = { width: 4, height: 2, data: Uint8Array.of(0, 1, 7, 255, 1, 0, 0, 1) };
    const out = await decodeTask0GrayPng(await encodeTask0MaskPng(m));
    assert(out.data.join(",") === "0,255,255,255,255,0,0,255", `(1c) 0/1 마스크 → 0/255 (0 아닌 값은 전부 255): ${out.data.join(",")}`);
  }

  // d. 모듈 디코더 일반성 — Sub·Average·Paeth + IDAT 여러 개
  {
    const img = makeImage("noise", 41, 29, makeRng(5));
    const png = refEncode({ ...img, filterOf: (r) => r % 5, idatParts: 4 });
    const out = await decodeTask0GrayPng(png);
    assert(sameBytes(out.data, img.data), "(1d) 모듈 디코더 — 필터 0~4 섞인 행 + IDAT 4개로 나눈 PNG 를 풂");
  }

  // e. 거부
  {
    const img = makeImage("gradient", 20, 10, makeRng(3));
    const good = refEncode(img);
    const rgb = refEncode({ width: 20, height: 10, data: new Uint8Array(600), bpp: 3, ihdr: { colorType: 2 } });
    const b16 = refEncode({ width: 20, height: 10, data: new Uint8Array(400), bpp: 2, ihdr: { bitDepth: 16 } });
    const pal = refEncode({ ...img, ihdr: { colorType: 3 } });
    const lace = refEncode({ ...img, ihdr: { interlace: 1 } });
    const badSig = good.slice();
    badSig[1] = 0x51;
    // 청크 CRC 필드 자체를 뒤집는다 (데이터는 그대로 — CRC 검사만 겨냥). IDAT 은 IHDR(8 + 25) 바로 뒤
    const idatAt = 8 + 12 + 13;
    const idatCrcAt = idatAt + 8 + u32be(good, idatAt);
    const badIdatCrc = good.slice();
    badIdatCrc[idatCrcAt] ^= 0x01;
    const badIendCrc = good.slice();
    badIendCrc[good.length - 1] ^= 0x01;
    // IDAT 데이터(zlib 꼬리 Adler-32) 한 바이트 — 청크 CRC 도 다시 맞춰 압축 풀기 검사만 겨냥
    const gc = refChunks(good);
    const zBad = gc[1].data.slice();
    zBad[zBad.length - 2] ^= 0x40;
    const badZlib = concat([good.subarray(0, 8), refChunk("IHDR", gc[0].data), refChunk("IDAT", zBad), refChunk("IEND", new Uint8Array(0))]);
    // IDAT 연속성 — IDAT 두 개 사이에 보조 청크(tEXt). 대조: 같은 보조 청크를 IHDR 과 IDAT 사이에 두면 받아야 함
    const two = refChunks(refEncode({ ...img, idatParts: 2 }));
    const tExt = refChunk("tEXt", enc.encode("k\0v"));
    const sig8 = good.subarray(0, 8);
    const idatSplit = concat([sig8, refChunk("IHDR", two[0].data), refChunk("IDAT", two[1].data), tExt, refChunk("IDAT", two[2].data), refChunk("IEND", new Uint8Array(0))]);
    const ancFirst = concat([sig8, refChunk("IHDR", two[0].data), tExt, refChunk("IDAT", two[1].data), refChunk("IDAT", two[2].data), refChunk("IEND", new Uint8Array(0))]);
    const trunc = good.subarray(0, good.length - 5);
    const tail = concat([good, Uint8Array.of(0)]);
    const f5 = refEncode({ ...img, filterOf: (r) => (r === 3 ? 5 : 0) });
    const shortRaw = refEncode({ width: 20, height: 9, data: img.data.subarray(0, 180) });
    // shortRaw 의 IHDR 높이만 10 으로 (데이터는 9행)
    const sr = refChunks(shortRaw);
    const ih = sr[0].data.slice();
    ih.set(putU32be(10), 4);
    const shortPng = concat([shortRaw.subarray(0, 8), refChunk("IHDR", ih), ...sr.slice(1).map((c) => refChunk(c.type, c.data))]);
    // [이름, 바이트, 기대 사유 문구] — 사유까지 맞아야 그 검사가 잡은 것으로 본다
    const cases = [
      ["RGB(색 유형 2)", rgb, "8-bit 회색조 아님"],
      ["16-bit", b16, "8-bit 회색조 아님"],
      ["팔레트(색 유형 3)", pal, "8-bit 회색조 아님"],
      ["인터레이스", lace, "인터레이스"],
      ["시그니처", badSig, "시그니처"],
      ["IDAT 청크 CRC 필드", badIdatCrc, "CRC 불일치: IDAT"],
      ["IEND 청크 CRC 필드", badIendCrc, "CRC 불일치: IEND"],
      ["zlib 꼬리(Adler-32) — 청크 CRC 는 맞춤", badZlib, "압축 풀기 실패"],
      ["IDAT 사이 보조 청크(tEXt)", idatSplit, "IDAT 청크가 연속이 아님"],
      ["잘림", trunc, "잘림"],
      ["IEND 뒤 바이트", tail, "IEND 뒤에 남은 바이트"],
      ["필터 5", f5, "필터 형식 오류"],
      ["데이터 짧음", shortPng, "풀린 길이"],
    ];
    const missed = [];
    for (const [label, bytes, needle] of cases) {
      const err = await throwsAsync(() => decodeTask0GrayPng(bytes));
      if (err === null || !err.includes(needle)) missed.push(`${label}(${err ?? "받아들임"})`);
    }
    assert((await throwsAsync(() => decodeTask0GrayPng(good))) === null, "(1e) 정상 PNG 는 받음");
    const anc = await throwsAsync(() => decodeTask0GrayPng(ancFirst));
    assert(anc === null, `(1e) 대조 — 보조 청크(tEXt)가 IHDR 과 첫 IDAT 사이면 받음 (${anc ?? "통과"})`);
    assert(missed.length === 0, `(1e) 모듈 디코더 거부 ${cases.length}종, 사유 문구까지 일치 (못 거른 것: ${missed.join(", ") || "없음"})`);
    const hdrErr = (() => {
      try {
        readTask0PngHeader(badSig);
        return null;
      } catch (e) {
        return e.message;
      }
    })();
    assert(hdrErr !== null && readTask0PngHeader(rgb).colorType === 2, "(1e) readTask0PngHeader — 시그니처 오류 거부, 색 유형은 판단 없이 그대로 돌려줌");
  }
}

// ── (2) manifest·exposure·estimate ───────────────────────────────────────

const SPEC_MANIFEST_KEYS = {
  "": ["format", "version", "generator", "generatedAt", "layerCount", "layerHeightMm", "projector", "bed", "materials",
    "dualMaterial", "toolChangeCount", "estimate", "hints"],
  projector: ["widthPx", "heightPx", "pixelPitchUm", "offsetMm"],
  bed: ["widthMm", "depthMm"],
  "materials[0]": ["slot", "tool", "name", "exposureSec", "bottomExposureSec", "retractMm"],
  estimate: ["depositSec", "travelSec", "toolChangeSec", "parkSec", "bladeSec", "layerOverheadSec", "exposureSec", "totalSec"],
  hints: ["blade", "ledPower"],
};

/** run.gcode 텍스트만으로 estimate 다시 계산 (층마다 파킹 (0,0) 에서 시작, 줄의 F 로 시간) */
function refEstimate(gcode, exposureArr) {
  const lines = gcode.split("\n");
  let started = false;
  let layer = -1;
  let x = 0;
  let y = 0;
  let deposit = 0;
  let travel = 0;
  let eOnly = 0;
  const printed = new Set();
  let layers = 0;
  for (const raw of lines) {
    const s = raw.trim();
    if (!started) {
      started = s === "; EXECUTABLE_BLOCK_START";
      continue;
    }
    if (s === ";LAYER_CHANGE") {
      layer++;
      layers++;
      x = F.parkXMm;
      y = F.parkYMm;
      continue;
    }
    if (!s.startsWith("G1 ")) continue;
    const arg = {};
    for (const tok of s.split(/\s+/).slice(1)) arg[tok[0]] = Number(tok.slice(1));
    const fMmS = arg.F / 60;
    if ("X" in arg || "Y" in arg) {
      const nx = arg.X ?? x;
      const ny = arg.Y ?? y;
      const len = Math.hypot(nx - x, ny - y);
      if ("E" in arg && arg.E > 0) deposit += len / fMmS;
      else travel += len / fMmS;
      x = nx;
      y = ny;
      printed.add(layer);
    } else if ("E" in arg) eOnly += Math.abs(arg.E) / fMmS;
  }
  const T = TASK0_TIME_CONSTANTS;
  let exposure = 0;
  for (const n of printed) exposure += exposureArr[n];
  return {
    depositSec: deposit,
    travelSec: travel + eOnly,
    toolChangeSec: 0,
    parkSec: printed.size * T.parkSec,
    bladeSec: printed.size * T.bladeSec,
    layerOverheadSec: layers * T.layerOverheadSec,
    exposureSec: exposure,
  };
}

function keysOf(manifest) {
  return {
    "": Object.keys(manifest),
    projector: Object.keys(manifest.projector ?? {}),
    bed: Object.keys(manifest.bed ?? {}),
    "materials[0]": Object.keys(manifest.materials?.[0] ?? {}),
    estimate: Object.keys(manifest.estimate ?? {}),
    hints: Object.keys(manifest.hints ?? {}),
  };
}

async function sectionManifest(sample) {
  // 시간 상수 = 규격 §13 표 그대로 (값을 바꾸면 이 단언과 규격서를 함께)
  const T = TASK0_TIME_CONSTANTS;
  assert(
    JSON.stringify(T) === JSON.stringify({ toolChangeSec: 0.5, parkSec: 3, bladeSec: 15, layerOverheadSec: 2 }),
    `(2) TASK0_TIME_CONSTANTS = 규격 §13 (툴전환 0.5 / 파킹 3 / 블레이드 15 / 층 오버헤드 2): ${JSON.stringify(T)}`,
  );
  const files = Object.fromEntries(sample.files.map((f) => [f.name, f.data]));
  const m = JSON.parse(dec.decode(files["manifest.json"]));
  const x = JSON.parse(dec.decode(files["exposure.json"]));
  const k = keysOf(m);
  const keyDiff = Object.keys(SPEC_MANIFEST_KEYS).filter((p) => k[p].join(",") !== SPEC_MANIFEST_KEYS[p].join(","));
  assert(keyDiff.length === 0, `(2) manifest 키·순서 = 규격 §11 예시 (다른 곳: ${keyDiff.join(", ") || "없음"})`);
  const expect = {
    format: "mazicalign-job",
    version: 1,
    generatedAt: SAMPLE_GENERATED_AT,
    layerCount: 3,
    layerHeightMm: 0.1,
    projector: { widthPx: 1920, heightPx: 1080, pixelPitchUm: 73, offsetMm: [10, 10] },
    bed: { widthMm: 150, depthMm: 85 },
    materials: [{ slot: "A", tool: "T0", name: "모델레진", exposureSec: 2.5, bottomExposureSec: 30, retractMm: 1 }],
    dualMaterial: false,
    toolChangeCount: 0,
    hints: { blade: null, ledPower: null },
  };
  const valDiff = Object.keys(expect).filter((key) => JSON.stringify(m[key]) !== JSON.stringify(expect[key]));
  assert(
    valDiff.length === 0 && typeof m.generator === "string" && m.generator.startsWith("MazicAlign v2 "),
    `(2) manifest 값 — version 1, layerCount 3, lh 0.1, projector 1920×1080·73 µm·[10,10], bed 150×85, 재료 T0 하나(노광 2.5/30, r 1), ` +
      `dualMaterial false, toolChangeCount 0, generator "${m.generator}" (다른 키: ${valDiff.join(", ") || "없음"})`,
  );
  assert(
    JSON.stringify(x) ===
      JSON.stringify({ layerHeightMm: 0.1, bottomLayerCount: 1, transitionLayerCount: 0, exposureSecByLayer: [30, 2.5, 2.5] }),
    `(2) exposure.json = {lh 0.1, bottomLayerCount 1, transition 0, [30, 2.5, 2.5]} (받은 값 ${JSON.stringify(x)})`,
  );
  assert(
    dec.decode(files["manifest.json"]) === JSON.stringify(m, null, 2) + "\n" && files["manifest.json"][0] === 0x7b,
    "(2) JSON 직렬화 — 2칸 들여쓰기 + 끝 개행, BOM 없음",
  );

  // estimate — run.gcode 텍스트로 다시 계산
  const ref = refEstimate(dec.decode(files["run.gcode"]), x.exposureSecByLayer);
  const e = m.estimate;
  const off = TASK0_ESTIMATE_PARTS.filter((key) => !(Math.abs(e[key] - ref[key]) <= 0.0005 + 1e-9));
  console.log(`    estimate ${JSON.stringify(e)}`);
  console.log(`    다시 계산 ${JSON.stringify(Object.fromEntries(Object.entries(ref).map(([kk, v]) => [kk, Number(v.toFixed(6))])))}`);
  assert(off.length === 0, `(2) estimate 7항목 = run.gcode 텍스트로 다시 계산한 값 (±0.5 ms) (다른 항목: ${off.join(", ") || "없음"})`);
  const msSum = TASK0_ESTIMATE_PARTS.reduce((s, key) => s + Math.round(e[key] * 1000), 0);
  assert(
    Math.round(e.totalSec * 1000) === msSum && TASK0_ESTIMATE_PARTS.every((key) => Number.isInteger(Math.round(e[key] * 1000)) &&
      Math.abs(e[key] * 1000 - Math.round(e[key] * 1000)) < 1e-6),
    `(2) estimate 항목은 1 ms 단위, totalSec ${e.totalSec} = 7개 합 (ms 정수 ${msSum})`,
  );
  assert(
    e.parkSec === 2 * 3 && e.bladeSec === 2 * 15 && e.layerOverheadSec === 3 * 2 && e.exposureSec === 30 + 2.5 && e.toolChangeSec === 0,
    "(2) 빈 층 처리 — 파킹·블레이드·노광은 도포 층 2개분(빈 층 생략, 규격 §9), 층 오버헤드는 3층 전부",
  );

  // exposure 보간·기본값 (types/printer.ts DEFAULT_* — 규칙 6)
  {
    const s = { exposureSec: 2.5, bottomExposureSec: 30, bottomLayerCount: 3, transitionLayerCount: 4 };
    const got = buildTask0Exposure(12, 0.05, s).exposureSecByLayer;
    const want = Array.from({ length: 12 }, (_, i) =>
      i < 3 ? 30 : i < 7 ? 30 + (2.5 - 30) * ((i - 3) / 4) : 2.5);
    assert(got.every((v, i) => Math.abs(v - want[i]) < 1e-12), `(2) exposure 전환 보간 (바닥 3, 전환 4): ${got.map((v) => Number(v.toFixed(4))).join(", ")}`);
    const def = buildTask0Exposure(8, 0.05);
    assert(
      def.bottomLayerCount === DEFAULT_BOTTOM_LAYER_COUNT &&
        def.exposureSecByLayer.join(",") ===
          [...Array(DEFAULT_BOTTOM_LAYER_COUNT).fill(DEFAULT_BOTTOM_EXPOSURE_SEC), ...Array(8 - DEFAULT_BOTTOM_LAYER_COUNT).fill(DEFAULT_EXPOSURE_SEC)].join(","),
      `(2) exposure 기본값 = types/printer.ts DEFAULT_* (바닥 ${DEFAULT_BOTTOM_LAYER_COUNT}층 ${DEFAULT_BOTTOM_EXPOSURE_SEC} s, 일반 ${DEFAULT_EXPOSURE_SEC} s)`,
    );
    let threw = 0;
    for (const bad of [{ bottomLayerCount: -1 }, { exposureSec: 0 }, { transitionLayerCount: 1.5 }, { bottomExposureSec: NaN }]) {
      try {
        buildTask0Exposure(3, 0.1, bad);
      } catch {
        threw++;
      }
    }
    assert(threw === 4, `(2) exposure 설정 검사 — 음수·0·소수 층 수·NaN 거부 (${threw}/4)`);
  }

  // estimate 옵션 — 툴 전환·시간 상수 덮어쓰기
  {
    const layers = [
      // v0.3.4 §5 모양 — 도포한 층은 E+r 수 = E−r 수 (둘 다 시간에 들어가는지도 이 손계산이 본다)
      { index: 0, empty: false, depositMm: 30, travelMm: 100, retracts: 1, unretracts: 1 },
      { index: 1, empty: true, depositMm: 0, travelMm: 0, retracts: 0, unretracts: 0 },
    ];
    const prm = { depositF: 1800, travelF: 6000, retractF: 1800, retractMm: 1 };
    const est = buildTask0Estimate(layers, prm, [10, 99], { toolChangeCount: 3, time: { parkSec: 4 } });
    const want = { depositSec: 1, travelSec: 1.067, toolChangeSec: 1.5, parkSec: 4, bladeSec: 15, layerOverheadSec: 4, exposureSec: 10 };
    const diff = Object.keys(want).filter((key) => est[key] !== want[key]);
    assert(
      diff.length === 0 && est.totalSec === 36.567,
      `(2) buildTask0Estimate 손계산 — 도포 30 mm/30 mm/s, 트래블 100 mm/100 mm/s + 리트랙트(E−r 1 + E+r 1) × 1 mm/30 mm/s, 툴전환 3×0.5, 파킹 덮어쓰기 4, ` +
        `빈 층 노광 99 제외 → total ${est.totalSec} (다른 항목: ${diff.join(", ") || "없음"})`,
    );
  }
}

// ── (3) preview ──────────────────────────────────────────────────────────

function whiteBox(img, thr = 128) {
  let c0 = Infinity, c1 = -1, r0 = Infinity, r1 = -1, n = 0;
  for (let r = 0; r < img.height; r++) {
    for (let c = 0; c < img.width; c++) {
      if (img.data[r * img.width + c] < thr) continue;
      n++;
      c0 = Math.min(c0, c);
      c1 = Math.max(c1, c);
      r0 = Math.min(r0, r);
      r1 = Math.max(r1, r);
    }
  }
  return { c0, c1, r0, r1, n };
}

async function sectionPreview(sample) {
  const pv = refDecode(sample.files.find((f) => f.name === "preview.png").data);
  const b = whiteBox(pv);
  const bw = b.c1 - b.c0 + 1;
  const bh = b.r1 - b.r0 + 1;
  console.log(`    견본 preview 흰 bbox: 열 ${b.c0}~${b.c1} × 행 ${b.r0}~${b.r1} (${bw}×${bh})`);
  assert(pv.width === 400 && pv.height === 300 && pv.bitDepth === 8 && pv.colorType === 0, "(3) preview.png 400×300 8-bit 회색조");
  assert(
    Math.abs(bw - bh) <= 1 && Math.abs(bh - 260) <= 1 && Math.abs((b.c0 + b.c1) / 2 - 199.5) <= 1 && Math.abs((b.r0 + b.r1) / 2 - 149.5) <= 1 &&
      b.r0 >= 19 && b.r1 <= 280,
    "(3) 견본 실루엣 = 정사각(10×10 판), 가운데, 세로 260 px(여백 20 px)",
  );

  // 방향 — 100×80 합집합에 L 자(왼쪽 위 칸이 빔)
  const u = { width: 100, height: 80, data: new Uint8Array(8000) };
  for (let r = 10; r < 70; r++) for (let c = 10; c < 90; c++) if (!(r < 30 && c < 40)) u.data[r * 100 + c] = 1;
  const p = buildTask0Preview(u);
  const at = (sx, sy) => {
    // 합집합 좌표 → 미리보기 좌표 (bbox 열 10~89·행 10~69, 축척 min(360/80, 260/60, 8))
    const s = Math.min(360 / 80, 260 / 60, 8);
    const px = Math.floor((sx - 50) * s + 200);
    const py = Math.floor((sy - 40) * s + 150);
    return p.data[py * 400 + px];
  };
  assert(
    at(25, 20) === 0 && at(25, 60) === 255 && at(75, 20) === 255 && at(75, 60) === 255,
    `(3) 방향 — L 자의 빈 칸이 미리보기 왼쪽 위 (왼위 ${at(25, 20)}, 왼아래 ${at(25, 60)}, 오위 ${at(75, 20)}, 오아래 ${at(75, 60)})`,
  );
  const empty = buildTask0Preview({ width: 30, height: 20, data: new Uint8Array(600) });
  assert(empty.width === 400 && empty.height === 300 && empty.data.every((v) => v === 0), "(3) 빈 합집합 → 전부 0");
  const dot = { width: 30, height: 20, data: new Uint8Array(600) };
  dot.data[5 * 30 + 7] = 1;
  const pd = buildTask0Preview(dot);
  const nz = pd.data.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
  assert(nz > 0 && nz <= 81, `(3) 확대 상한 8 — 마스크 1 칸이 미리보기 ${nz} px (≤ 9×9)`);
  const pd2 = buildTask0Preview(dot);
  assert(sameBytes(pd.data, pd2.data), "(3) 같은 입력 → 같은 미리보기");
}

// ── (4) 결정성 ───────────────────────────────────────────────────────────

async function sectionDeterminism(sample) {
  const meshes = sampleMeshes();
  const before = meshes.map((m) => m.slice());
  const { buildTask0JobZip } = await import("../src/features/v2/utils/task0/task0-jobzip.ts");
  const again = await buildTask0JobZip({
    meshes,
    topY: SAMPLE_TOP_Y,
    layerHeightMm: SAMPLE_LH,
    exposure: SAMPLE_EXPOSURE,
    generatedAt: SAMPLE_GENERATED_AT,
  });
  assert(sameBytes(again.bytes, sample.bytes), `(4) 두 번 만든 견본이 같은 바이트 (sha256 ${sha256(sample.bytes).slice(0, 16)}…)`);
  assert(meshes.every((m, i) => sameBytes(new Uint8Array(m.buffer), new Uint8Array(before[i].buffer))), "(4) 입력 메시 무변경");
  const other = await buildTask0JobZip({
    meshes: sampleMeshes(),
    topY: SAMPLE_TOP_Y,
    layerHeightMm: SAMPLE_LH,
    exposure: SAMPLE_EXPOSURE,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  const diffNames = other.files.filter((f, i) => !sameBytes(f.data, sample.files[i].data)).map((f) => f.name);
  assert(diffNames.join(",") === "manifest.json", `(4) generatedAt 만 바꾸면 manifest.json 만 달라짐 (${diffNames.join(", ")})`);
  const now = await buildTask0JobZip({ meshes: sampleMeshes(), topY: SAMPLE_TOP_Y, layerHeightMm: SAMPLE_LH });
  const ts = Date.parse(now.manifest.generatedAt);
  assert(Math.abs(ts - Date.now()) < 600000, `(4) generatedAt 을 안 주면 지금 시각 (${now.manifest.generatedAt})`);
  let threw = null;
  try {
    await buildTask0JobZip({ meshes: sampleMeshes(), topY: 0, layerHeightMm: SAMPLE_LH });
  } catch (e) {
    threw = e.message;
  }
  assert(threw !== null, `(4) 층 0개(topY 0) 는 throw — ${threw}`);
}

// ── (5) 견본 내용 ────────────────────────────────────────────────────────

async function sectionSample(sample) {
  const report = await verifyTask0JobZip(sample.bytes);
  const probs = sampleProblems(sample, report);
  for (const p of probs) console.error(`    ${p}`);
  assert(probs.length === 0 && report.pass, `(5) 검사기 — 위반 [${report.violations}], 추가 ${report.extraIssues.length}건, 견본 단언 문제 ${probs.length}`);

  // zip 구조 — 로컬 머리를 독립 파싱
  const local = refUnzipLocal(sample.bytes);
  const order = ["run.gcode", "manifest.json", "exposure.json", "preview.png", "layers/0000.png", "layers/0001.png", "layers/0002.png"];
  assert(local.map((e) => e.name).join(",") === order.join(","), `(5) zip 항목 순서 ${local.map((e) => e.name).join(", ")}`);
  assert(local.every((e) => e.method === 0 && e.crcOk && e.time === 0 && e.date === 0 && e.size === e.data.length),
    "(5) zip 전 항목 무압축(store)·CRC 일치(독립 계산)·시각 0 고정");
  const mine = await readTask0ZipEntries(sample.bytes);
  assert(mine.length === local.length && mine.every((e, i) => e.name === local[i].name && sameBytes(e.data, local[i].data) && e.crcOk),
    "(5) readTask0ZipEntries(중앙 디렉터리 기준) = 로컬 머리 독립 파싱");

  // run.gcode = writer 출력 그대로
  const gcode = dec.decode(local[0].data);
  const direct = generateTask0Gcode(sampleMeshes(), SAMPLE_TOP_Y, SAMPLE_LH);
  assert(gcode === direct.gcode, `(5) run.gcode = generateTask0Gcode 출력 그대로 (${local[0].data.length} B)`);
  const modes = [
    ["dryrun", { mode: "dryrun" }],
    ["dryrun E", { mode: "dryrun", keepE: true }],
    ["print", { mode: "print" }],
    ["print lh 0.1", { mode: "print", layerHeightMm: 0.1 }],
  ];
  const parseBad = [];
  for (const [label, opt] of modes) {
    const r = parseGcodeText(gcode, opt);
    if (r.warnings.length || r.errors.length || r.layerCount !== 3) parseBad.push(`${label}: 경고 ${r.warnings.length} 오류 ${r.errors.length} 층 ${r.layerCount}`);
  }
  assert(parseBad.length === 0, `(5) 파서 이식판 dryrun(E 끔·켬)·print(lh 없음·0.1) 경고 0·오류 0·층 3 (${parseBad.join("; ") || "전부"})`);
  const blocks = parseGcodeText(gcode, { mode: "print" }).blocks.filter((b) => b.isLayer);
  assert(blocks.map((b) => b.hasXy).join(",") === "true,false,true" && blocks[1].z === 0.2,
    "(5) 층 1 = 빈 층 (XY 이동 없음, G1 Z0.2 만)");

  // PNG — 독립 디코더로, 같은 단면의 마스크 × 255 와 비교 + 위치·방향
  const meshes = sampleMeshes();
  for (let n = 0; n < 3; n++) {
    const png = refDecode(local[4 + n].data);
    const mask = rasterizeTask0Mask(task0LayerPolygonsBed(meshes, n, SAMPLE_LH));
    const want = new Uint8Array(mask.data.length);
    for (let i = 0; i < want.length; i++) want[i] = mask.data[i] ? 255 : 0;
    const b = whiteBox(png, 1);
    let posOk = true;
    if (n !== 1) {
      const [x0] = pixelCenterToBed(b.c0, 0);
      const [xPrev] = pixelCenterToBed(b.c0 - 1, 0);
      const [x1] = pixelCenterToBed(b.c1, 0);
      const [xNext] = pixelCenterToBed(b.c1 + 1, 0);
      const [, yTop] = pixelCenterToBed(0, b.r0);
      const [, yAbove] = pixelCenterToBed(0, b.r0 - 1);
      const [, yBot] = pixelCenterToBed(0, b.r1);
      const [, yBelow] = pixelCenterToBed(0, b.r1 + 1);
      posOk = x0 >= 75 && xPrev < 75 && x1 < 85 && xNext >= 85 && yTop < 52.5 && yAbove >= 52.5 && yBot >= 42.5 && yBelow < 42.5 &&
        b.n === (b.c1 - b.c0 + 1) * (b.r1 - b.r0 + 1);
      console.log(`    층 ${n}: 흰 열 ${b.c0}~${b.c1} (중심 X ${x0.toFixed(4)}~${x1.toFixed(4)}), 행 ${b.r0}~${b.r1} (중심 Y ${yTop.toFixed(4)}~${yBot.toFixed(4)}), ${b.n}px`);
    }
    assert(
      png.width === W_PX && png.height === H_PX && png.bitDepth === 8 && png.colorType === 0 && png.crcOk && sameBytes(png.data, want) &&
        (n === 1 ? b.n === 0 : b.n > 0 && posOk),
      n === 1
        ? "(5) layers/0001.png 1920×1080 8-bit 회색조, 전부 0 (빈 층)"
        : `(5) layers/000${n}.png 1920×1080 8-bit 회색조 = 층 ${n} 마스크 × 255, 흰 사각형이 베드 X 75~85 × Y 42.5~52.5 (행 0 = Y 최대)`,
    );
  }
}

// ── (6) 불량 7종 ─────────────────────────────────────────────────────────

async function sectionBad(sample, bads) {
  const base = new Map(sample.files.map((f) => [f.name, f.data]));
  const expectChanged = {
    1: "-run.gcode",
    2: "manifest.json",
    3: "manifest.json,exposure.json",
    4: "-layers/0001.png,layers/0002.png,+layers/0003.png",
    5: "layers/0002.png",
    6: "exposure.json",
    7: "run.gcode",
  };
  for (const b of bads) {
    const n = b.spec.n;
    const report = await verifyTask0JobZip(b.bytes);
    b.report = report;
    const probs = badProblems(n, report);
    assert(probs.length === 0, `(6) ${b.spec.file}: 위반 [${report.violations}] — ${report.reasons.map((r) => r.message).join(" / ")}${probs.length ? ` (문제: ${probs.join("; ")})` : ""}`);
    // 견본과 다른 곳
    const names = new Set(b.files.map((f) => f.name));
    const changed = [];
    for (const [name, data] of base) {
      if (!names.has(name)) changed.push(`-${name}`);
      else if (!sameBytes(b.files.find((f) => f.name === name).data, data)) changed.push(name);
    }
    for (const f of b.files) if (!base.has(f.name)) changed.push(`+${f.name}`);
    assert(changed.join(",") === expectChanged[n], `(6) ${b.spec.file}: 견본과 다른 항목 = ${changed.join(", ")}`);
  }
  // 세부 — bad_5 IHDR, bad_7 두 줄만
  const b5 = bads.find((b) => b.spec.n === 5);
  const h5 = readTask0PngHeader(b5.files.find((f) => f.name === "layers/0002.png").data);
  assert(h5.width === 1920 && h5.height === 1000 && h5.bitDepth === 8 && h5.colorType === 0, "(6) bad_5 layers/0002.png = 1920×1000 8-bit 회색조");
  const b7 = bads.find((b) => b.spec.n === 7);
  const g0 = dec.decode(base.get("run.gcode")).split("\n");
  const g7 = dec.decode(b7.files.find((f) => f.name === "run.gcode").data).split("\n");
  const dl = g0.map((l, i) => (l === g7[i] ? null : `${l} → ${g7[i]}`)).filter(Boolean);
  assert(g0.length === g7.length && dl.join(" | ") === ";Z:0.3 → ;Z:0.31 | G1 Z0.3 → G1 Z0.31", `(6) bad_7 run.gcode 차이 = ${dl.join(" | ")}`);
  const p7 = parseGcodeText(g7.join("\n"), { mode: "print" });
  const p7lh = parseGcodeText(g7.join("\n"), { mode: "print", layerHeightMm: 0.1 });
  assert(p7.warnings.length === 0 && p7.errors.length === 0 && p7lh.errors.length === 1,
    `(6) bad_7 — 파서 이식판 print(lh 없음) 경고·오류 0, print(lh 0.1) 오류 1: ${p7lh.errors[0]}`);
}

// ── (7) 대조군 ───────────────────────────────────────────────────────────

/** 견본 파일 목록을 고쳐 다시 묶기 */
async function mutateSample(sample, edit) {
  const files = await edit(sample.files.map((f) => ({ name: f.name, data: f.data })));
  return assembleTask0JobZip(files);
}
const editJson = (files, name, fn) =>
  files.map((f) => {
    if (f.name !== name) return f;
    const obj = JSON.parse(dec.decode(f.data));
    fn(obj);
    return { name, data: task0JsonBytes(obj) };
  });
const editText = (files, name, fn) => files.map((f) => (f.name === name ? { name, data: enc.encode(fn(dec.decode(f.data))) } : f));
const editGray = async (files, name, fn) => {
  const out = [];
  for (const f of files) {
    if (f.name !== name) {
      out.push(f);
      continue;
    }
    const img = await decodeTask0GrayPng(f.data);
    fn(img);
    out.push({ name, data: await encodeTask0GrayPng(img) });
  }
  return out;
};

async function sectionControls(sample, bads) {
  // a. 조건 N 을 뺀 검사기 → bad_N 통과
  for (const b of bads) {
    const n = b.spec.n;
    const r = await verifyTask0JobZip(b.bytes, { conditions: [1, 2, 3, 4, 5, 6, 7].filter((c) => c !== n) });
    assert(r.pass, `(7a) 조건 ${n} 을 뺀 검사기 → ${b.spec.file} 통과해 버림 (위반 [${r.violations}], 추가 ${r.extraIssues.length}) = 조건 ${n} 만이 잡는다`);
  }

  // b. 추가 검사 변조
  const rgbPng = refEncode({ width: W_PX, height: H_PX, data: new Uint8Array(W_PX * H_PX * 3), bpp: 3, ihdr: { colorType: 2 } });
  const X = [
    ["빈 층 PNG 에 흰 픽셀 1개", "빈 층인데 PNG 에 흰 픽셀", (fs0) => editGray(fs0, "layers/0001.png", (img) => (img.data[540 * W_PX + 960] = 255))],
    ["도포 줄 끝 인라인 주석", "파서(print) 경고", (fs0) => editText(fs0, "run.gcode", (t) => t.replace(/(E0\.\d+ F1800)\n/, "$1 ; x\n"))],
    ["layers/0000.png 를 RGB 1920×1080 으로", "8-bit 회색조 PNG 로 풀리지 않음", (fs0) => fs0.map((f) => (f.name === "layers/0000.png" ? { name: f.name, data: rgbPng } : f))],
    ["estimate.totalSec + 1", "totalSec", (fs0) => editJson(fs0, "manifest.json", (m) => (m.estimate.totalSec += 1))],
    ['manifest format "x"', "format", (fs0) => editJson(fs0, "manifest.json", (m) => (m.format = "x"))],
    ["preview.png 삭제", "preview.png 없음", (fs0) => fs0.filter((f) => f.name !== "preview.png")],
    ["층 2 ;HEIGHT:0.2", ";HEIGHT:", (fs0) => editText(fs0, "run.gcode", (t) => t.replace(";Z:0.3\n;HEIGHT:0.1\n", ";Z:0.3\n;HEIGHT:0.2\n"))],
    ["toolChangeCount 1", "toolChangeCount", (fs0) => editJson(fs0, "manifest.json", (m) => (m.toolChangeCount = 1))],
    ["exposure layerHeightMm 0.05", "exposure layerHeightMm", (fs0) => editJson(fs0, "exposure.json", (x) => (x.layerHeightMm = 0.05))],
    ["알 수 없는 항목 notes.txt", "알 수 없는 항목", (fs0) => [...fs0, { name: "notes.txt", data: enc.encode("x") }]],
    ["manifest.json 앞에 BOM", "BOM", (fs0) => fs0.map((f) => (f.name === "manifest.json" ? { name: f.name, data: concat([Uint8Array.of(0xef, 0xbb, 0xbf), f.data]) } : f))],
    ["도포 층 0 PNG 전부 0", "도포하는 층인데 PNG 흰 픽셀 0", (fs0) => editGray(fs0, "layers/0000.png", (img) => img.data.fill(0))],
  ];
  for (const [label, needle, edit] of X) {
    const bytes = await mutateSample(sample, edit);
    if (sameBytes(bytes, sample.bytes)) {
      assert(false, `(7b) ${label} — 변조가 적용되지 않음`);
      continue;
    }
    const r = await verifyTask0JobZip(bytes);
    const off = await verifyTask0JobZip(bytes, { extraChecks: false });
    const hit = r.extraIssues.find((m) => m.includes(needle));
    assert(
      r.violations.length === 0 && hit !== undefined && off.pass,
      `(7b) ${label} → 위반 [${r.violations}], 추가 검사가 잡음: ${hit ?? `못 잡음 (${r.extraIssues.join(" / ") || "없음"})`}; 추가 검사 끄면 통과 ${off.pass}`,
    );
  }
  // zip CRC — 저장된 run.gcode 데이터 한 바이트를 CRC 는 그대로 둔 채 바꿈 (START 앞 메타 주석 안이라 G-code 의미는 같음)
  {
    const bytes = sample.bytes.slice();
    const at = 30 + "run.gcode".length + 2; // "; MazicAlign …" 의 'M'
    bytes[at] = "N".charCodeAt(0);
    const r = await verifyTask0JobZip(bytes);
    assert(r.violations.length === 0 && r.extraIssues.some((m) => m.includes("zip CRC 불일치: run.gcode")),
      `(7b) zip 안 run.gcode 한 바이트(메타 주석) 변조, CRC 그대로 → 추가 검사가 잡음: ${r.extraIssues.join(" / ")}`);
  }

  // c. 조건의 다른 형태
  const C = [
    ["manifest.json 삭제", [2], (fs0) => fs0.filter((f) => f.name !== "manifest.json")],
    ["PNG 이름 layers/1.png (4자리 아님)", [4], (fs0) => fs0.map((f) => (f.name === "layers/0001.png" ? { name: "layers/1.png", data: f.data } : f))],
    ["manifest bed 140×85", [5], (fs0) => editJson(fs0, "manifest.json", (m) => (m.bed.widthMm = 140))],
    ["manifest projector heightPx 1000", [5], (fs0) => editJson(fs0, "manifest.json", (m) => (m.projector.heightPx = 1000))],
    ["exposure.json 삭제", [6], (fs0) => fs0.filter((f) => f.name !== "exposure.json")],
    ["PNG 한 장 추가 (layers/0003.png — 번호는 이어짐)", [3], (fs0) => [...fs0, { name: "layers/0003.png", data: fs0.find((f) => f.name === "layers/0001.png").data }]],
    ["PNG 한 장 삭제 (layers/0002.png — 번호는 이어짐)", [3], (fs0) => fs0.filter((f) => f.name !== "layers/0002.png")],
    ["run.gcode 끝에 빈 층 하나 추가 (;Z:0.4 — Z 는 맞음)", [3], (fs0) => editText(fs0, "run.gcode", (t) => t + ";LAYER_CHANGE\n;Z:0.4\n;HEIGHT:0.1\nG1 Z0.4\n")],
    ["manifest version \"1\" (문자열)", [2], (fs0) => editJson(fs0, "manifest.json", (m) => (m.version = "1"))],
  ];
  for (const [label, want, edit] of C) {
    const r = await verifyTask0JobZip(await mutateSample(sample, edit));
    assert(JSON.stringify(r.violations) === JSON.stringify(want), `(7c) ${label} → 위반 [${r.violations}] (기대 [${want}]) — ${r.reasons.map((x) => x.message).join(" / ")}`);
  }
  {
    const r = await verifyTask0JobZip(await mutateSample(sample, (fs0) => editText(fs0, "run.gcode", (t) => t.replace(";Z:0.2\n", ""))));
    assert(r.violations.includes(7), `(7c) 층 1 의 ;Z: 줄 삭제 → 위반 [${r.violations}] ∋ 7 — ${r.reasons.map((x) => x.message).join(" / ")}`);
    const junk = await verifyTask0JobZip(enc.encode("zip 아님"));
    assert(junk.violations.includes(1) && junk.violations.includes(2) && junk.extraIssues.some((m) => m.includes("zip 해석 실패")),
      `(7c) zip 이 아닌 바이트 → 위반 [${junk.violations}] ∋ 1·2, 추가 "${junk.extraIssues[0]}"`);
  }

  // c'. 조건 7 허용치 경계 (±0.001) — 층 2 의 ;Z: 와 G1 Z 를 함께 옮긴다(둘이 같아 파서의 ;Z:=G1 Z 검사는 통과).
  //     ±0.002 → [7], ±0.0009 → 통과. 파서 이식판 print(lh 0.1) 의 Z = (N+1)×lh 판정(Task0 원본과 같은 ±0.001)과도 같아야 한다.
  {
    const shiftZ = (fs0, z) =>
      editText(fs0, "run.gcode", (t) => {
        const lines = t.split("\n");
        const zi = lines.indexOf(";Z:0.3");
        const gi = lines.indexOf("G1 Z0.3");
        if (zi < 0 || gi !== zi + 2 || lines.indexOf(";Z:0.3", zi + 1) >= 0 || lines.indexOf("G1 Z0.3", gi + 1) >= 0) {
          throw new Error("층 2 머리(;Z:0.3 / ;HEIGHT / G1 Z0.3)를 하나만 찾지 못함");
        }
        lines[zi] = `;Z:${z}`;
        lines[gi] = `G1 Z${z}`;
        return lines.join("\n");
      });
    for (const [z, want] of [["0.302", [7]], ["0.298", [7]], ["0.3009", []], ["0.2991", []]]) {
      let gcodeText = "";
      const bytes = await mutateSample(sample, (fs0) => {
        const out = shiftZ(fs0, z);
        gcodeText = dec.decode(out.find((f) => f.name === "run.gcode").data);
        return out;
      });
      const r = await verifyTask0JobZip(bytes);
      const p = parseGcodeText(gcodeText, { mode: "print", layerHeightMm: 0.1 });
      // 파서 판정: 오류 1건(Z ≠ (N+1)×층두께) = [7], 경고·오류 0 = []
      const parserVerdict = p.errors.length === 1 && p.warnings.length === 0 ? [7] : p.errors.length + p.warnings.length === 0 ? [] : ["?"];
      const ok =
        JSON.stringify(r.violations) === JSON.stringify(want) && r.extraIssues.length === 0 &&
        JSON.stringify(parserVerdict) === JSON.stringify(want);
      assert(
        ok,
        `(7c) 조건 7 경계 — 층 2 Z ${z} (0.3 에서 ${(Number(z) - 0.3).toFixed(4)}) → 검사기 위반 [${r.violations}] · ` +
          `파서 이식판 print(lh 0.1) 판정 [${parserVerdict}] (기대 [${want}]), 추가 ${r.extraIssues.length}건`,
      );
    }
  }

  // d. deflate 로 다시 묶은 견본
  {
    const deflated = refZip(sample.files, (f) => (f.name.endsWith(".png") && f.name !== "layers/0001.png" ? 0 : 8));
    const entries = await readTask0ZipEntries(deflated);
    const r = await verifyTask0JobZip(deflated);
    assert(entries.filter((e) => e.method === 8).length === 4 && r.pass,
      `(7d) deflate(방식 8) 4개 + 무압축 3개로 다시 묶은 견본 → 통과 (위반 [${r.violations}], 추가 ${r.extraIssues.join(" / ") || "0건"})`);
  }
}

// ── (8) 선택: python zipfile · Task0 원본 파서 ─────────────────────────────

function findPython() {
  const cands = process.env.PYTHON ? [[process.env.PYTHON, []]] : [["python", []], ["python3", []], ["py", ["-3"]]];
  for (const [cmd, pre] of cands) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], { encoding: "utf8" });
    const mm = r.status === 0 ? /^(\d+) (\d+)/.exec((r.stdout || "").trim()) : null;
    if (mm && Number(mm[1]) === 3 && Number(mm[2]) >= 7) return { cmd, pre };
  }
  return null;
}

const PY_CHECK = `
import json, sys, zipfile, importlib.util
out = {"zips": {}, "parser": None}
d = sys.argv[1]
for name in json.loads(sys.argv[2]):
    z = zipfile.ZipFile(d + "/" + name)
    out["zips"][name] = {"testzip": z.testzip(), "names": [i.filename for i in z.infolist()]}
if len(sys.argv) > 3:
    spec = importlib.util.spec_from_file_location("t0", sys.argv[3])
    T = importlib.util.module_from_spec(spec); spec.loader.exec_module(T)
    res = {}
    for name in ["sample.job.zip", "bad_7_z_mismatch.job.zip"]:
        lines = zipfile.ZipFile(d + "/" + name).read("run.gcode").decode("utf-8-sig").splitlines()
        r = T.parse_gcode_lines(lines, mode="print", layer_height_mm=0.1)
        res[name] = {"warnings": len(r.warnings), "errors": r.errors}
    out["parser"] = res
print(json.dumps(out, ensure_ascii=False))
`;

async function sectionPython(sample, bads) {
  const py = findPython();
  if (!py) {
    console.log("  SKIP(python): python 3.7+ 없음 (PYTHON 환경변수로 지정 가능)");
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "verify-task0-jobzip-"));
  try {
    const names = ["sample.job.zip", ...bads.map((b) => b.spec.file)];
    fs.writeFileSync(path.join(tmp, "sample.job.zip"), sample.bytes);
    for (const b of bads) fs.writeFileSync(path.join(tmp, b.spec.file), b.bytes);
    const args = [...py.pre, "-c", PY_CHECK, tmp, JSON.stringify(names)];
    let parserNote = "";
    if (fs.existsSync(path.join(TASK0_DIR, ".git"))) {
      const r = spawnSync("git", ["-C", TASK0_DIR, "show", `${PARSER_COMMIT}:controllers/task0_gcode.py`], { maxBuffer: 16 * 1024 * 1024 });
      if (r.status === 0) {
        const mod = path.join(tmp, "task0_gcode_origin.py");
        fs.writeFileSync(mod, r.stdout);
        args.push(mod);
      } else parserNote = `Task0 커밋 ${PARSER_COMMIT} 없음`;
    } else parserNote = `Task0 리포 없음 (${TASK0_DIR} — TASK0_DIR 환경변수로 지정 가능)`;
    const r = spawnSync(py.cmd, args, {
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
    if (r.status !== 0) {
      assert(false, `(8) python 실행 실패: ${(r.stderr || "").slice(-400)}`);
      return;
    }
    const out = JSON.parse(r.stdout);
    const badZip = names.filter((n) => out.zips[n].testzip !== null);
    assert(badZip.length === 0, `(8) python zipfile.testzip() — 8개 zip 전부 무결 (실패: ${badZip.join(", ") || "없음"})`);
    assert(out.zips["sample.job.zip"].names.join(",") === sample.files.map((f) => f.name).join(","), "(8) python zipfile 항목 이름·순서 = 조립 순서");
    if (out.parser) {
      const s = out.parser["sample.job.zip"];
      const b7 = out.parser["bad_7_z_mismatch.job.zip"];
      assert(s.warnings === 0 && s.errors.length === 0 && b7.warnings === 0 && b7.errors.length === 1 &&
        b7.errors[0].includes("(층 3)") && b7.errors[0].includes("Z0.3100 (기대 Z0.3000)"),
        `(8) Task0 원본 파서 ${PARSER_COMMIT} print(lh 0.1) — 견본 경고·오류 0, bad_7 오류 1(층 3, v0.2.1 소수 4자리 문구): ${b7.errors[0]}`);
    } else console.log(`  SKIP(원본 파서): ${parserNote}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── (9) 참고: 성능 ───────────────────────────────────────────────────────

async function sectionPerf() {
  // 출력 가능 영역을 거의 덮는 판(130 × 70 mm)과 10 mm 판 — 층 하나 래스터 + PNG 인코딩 + 디코딩
  const plate = (w, d) => [[F.printableXMinMm + 5, F.printableYMinMm + 2.5], [F.printableXMinMm + 5 + w, F.printableYMinMm + 2.5],
    [F.printableXMinMm + 5 + w, F.printableYMinMm + 2.5 + d], [F.printableXMinMm + 5, F.printableYMinMm + 2.5 + d]];
  for (const [label, poly] of [["10×10 mm", plate(10, 10)], ["130×70 mm", plate(130, 70)]]) {
    const N = 5;
    let tMask = 0;
    let tEnc = 0;
    let tDec = 0;
    let size = 0;
    for (let i = 0; i < N; i++) {
      let t = performance.now();
      const mask = rasterizeTask0Mask([poly]);
      tMask += performance.now() - t;
      t = performance.now();
      const png = await encodeTask0MaskPng(mask);
      tEnc += performance.now() - t;
      t = performance.now();
      await decodeTask0GrayPng(png);
      tDec += performance.now() - t;
      size = png.length;
    }
    console.log(`    ${label} 층 1장 (1920×1080): 래스터 ${(tMask / N).toFixed(1)} ms, PNG 인코딩 ${(tEnc / N).toFixed(1)} ms, ` +
      `디코딩 ${(tDec / N).toFixed(1)} ms, PNG ${size} B`);
  }
}

async function main() {
  const t0 = performance.now();
  console.log("Task0 job.zip 조립·검사기 + 8-bit 회색조 PNG 검증 (규격서 v0.3.4 §11, 협의 §26-3·§27)");
  await timed("(1) PNG 인코더·디코더", sectionPng);
  const set = await timed("견본·불량 7종 생성", buildTask0SampleSet);
  if (!set) {
    console.error("\n결과: 견본을 만들지 못해 중단");
    process.exit(1);
  }
  const { sample, bads } = set;
  await timed("(2) manifest·exposure·estimate", () => sectionManifest(sample));
  await timed("(3) preview", () => sectionPreview(sample));
  await timed("(4) 결정성", () => sectionDeterminism(sample));
  await timed("(5) 견본 내용", () => sectionSample(sample));
  await timed("(6) 불량 7종", () => sectionBad(sample, bads));
  await timed("(7) 대조군", () => sectionControls(sample, bads));
  await timed("(8) python zipfile · Task0 원본 파서 (선택)", () => sectionPython(sample, bads));
  await timed("(9) 참고 — 층당 시간", sectionPerf);
  const again = await buildSampleJob();
  assert(sameBytes(again.bytes, sample.bytes), "(4) 끝에서 한 번 더 — 견본 바이트 그대로");
  const total = performance.now() - t0;
  console.log("\n  실행 시간:");
  for (const [label, ms] of timings) console.log(`    ${label}: ${(ms / 1000).toFixed(2)} s`);
  console.log(`    전체: ${(total / 1000).toFixed(2)} s`);
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
