/**
 * Task0 마스크 PNG — 8-bit 회색조 인코더·디코더 (규격서 v0.3.3 §11, Z1 견본 job.zip)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c §11
 *   — layers/NNNN.png 는 1920 × 1080, 8-bit 회색조, 0 = 미노광 / 255 = 노광(중간값은 그대로 투사).
 *
 * 인코더 (encodeTask0GrayPng / encodeTask0MaskPng):
 *   - 시그니처 → IHDR(비트 깊이 8, 색 유형 0 = 회색조, 압축 0, 필터 0, 인터레이스 0) → IDAT 1개 → IEND. 보조 청크 없음
 *     (시각·감마 정보가 없어 같은 입력 → 같은 바이트).
 *   - 행 필터: 행마다 None(0) 또는 Up(2) 중 "필터 결과 바이트를 부호 있는 값으로 본 절댓값 합" 이 작은 쪽(같으면 None)
 *     — libpng 의 최소 합 휴리스틱을 두 가지로 줄인 것. 판정이 입력에만 달려 있어 결정적이다.
 *     0/255 마스크는 위아래 행이 같은 곳이 많아 Up 이 대부분 0 바이트가 되고 deflate 가 잘 줄인다.
 *   - 압축: 웹 표준 CompressionStream('deflate') = zlib 형식(RFC 1950 — PNG IDAT 가 요구하는 형식).
 *     브라우저·Web Worker·Node 22 공통. 같은 런타임에서는 같은 바이트(zlib 기본 수준). 런타임의 zlib 판이 다르면
 *     압축 바이트는 달라질 수 있으나 풀어 낸 픽셀은 같다.
 *   - 0/1 마스크(task0-mask rasterizeTask0Mask 결과) → 0/255 (0 이 아닌 칸은 전부 255).
 *
 * 디코더 (decodeTask0GrayPng — job.zip 검사기용): 8-bit 회색조·비인터레이스만 받는다. 시그니처, 청크 CRC,
 *   IHDR 위치·길이, IDAT 연속, IEND 끝, 알 수 없는 필수 청크(대문자 시작) 거부, 풀린 길이 = 높이 × (1 + 너비),
 *   필터 0~4 (None·Sub·Up·Average·Paeth 전부 — 다른 도구로 만든 PNG 도 읽게). 어기면 Error 를 던진다.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음 (CompressionStream·DecompressionStream·TypedArray 만).
 */

// ==================== 타입 ====================

/** 회색조 이미지 — 행 우선 0~255, 행 0 = 위 */
export interface Task0GrayImage {
  width: number;
  height: number;
  /** 길이 width·height */
  data: Uint8Array;
}

/** IHDR 값 */
export interface Task0PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compression: number;
  filter: number;
  interlace: number;
}

/** 압축 형식 — 'deflate' = zlib(PNG IDAT), 'deflate-raw' = 머리·꼬리 없는 deflate(zip 압축 방식 8) */
export type Task0DeflateFormat = 'deflate' | 'deflate-raw';

// ==================== 상수 ====================

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
/** PNG 청크 길이 상한 (2^31 − 1) */
const MAX_CHUNK_LENGTH = 0x7fffffff;
/** 너비·높이 상한 — 규격 상한(2^31 − 1)보다 작게: 풀린 버퍼가 메모리를 넘지 않게 (투사 1920 × 1080 의 수십 배 여유) */
const MAX_SIDE_PX = 1 << 15;

// ==================== CRC32 ====================

/** CRC-32 (IEEE 802.3, 다항식 0xEDB88320) 표 — PNG 청크·zip 공통 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** CRC-32 — data[start, end) (PNG 청크는 형식 4바이트 + 데이터, zip 은 풀린 데이터 전체) */
export function task0Crc32(data: Uint8Array, start = 0, end = data.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ==================== 압축 스트림 ====================

/** 바이트 → 변환 스트림 → 바이트. 쓰기와 읽기를 함께 돌려야 역압(backpressure)에 막히지 않는다 */
async function pipeBytes(
  data: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = stream.writable.getWriter();
  const writing = writer.write(data).then(() => writer.close());
  writing.catch(() => undefined); // 오류는 읽기 쪽에서 받는다 (처리 안 된 거부 방지)
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await writing;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** ArrayBuffer 기반 사본이 필요할 때만 복사 (SharedArrayBuffer 위 뷰 대비) */
function ownBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : new Uint8Array(data);
}

/** 압축 — CompressionStream (format 'deflate' = zlib, 'deflate-raw' = zip 방식 8) */
export function task0Deflate(data: Uint8Array, format: Task0DeflateFormat = 'deflate'): Promise<Uint8Array<ArrayBuffer>> {
  return pipeBytes(ownBytes(data), new CompressionStream(format));
}

/** 압축 풀기 — DecompressionStream. 깨진 입력이면 거부(reject)된다 */
export function task0Inflate(data: Uint8Array, format: Task0DeflateFormat = 'deflate'): Promise<Uint8Array<ArrayBuffer>> {
  return pipeBytes(ownBytes(data), new DecompressionStream(format));
}

// ==================== 인코더 ====================

/** 필터 결과 바이트 하나의 비용 — 부호 있는 바이트로 본 절댓값 */
function byteCost(b: number): number {
  return b < 128 ? b : 256 - b;
}

/**
 * 스캔라인 필터 — 행마다 [필터 바이트, 행 바이트…]. None/Up 중 비용이 작은 쪽(같으면 None).
 * 0 행의 Up 은 위 행을 0 으로 보므로 None 과 같다 → 항상 None.
 */
function filterRows(width: number, height: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const stride = width + 1;
  const raw = new Uint8Array(stride * height);
  for (let r = 0; r < height; r++) {
    const src = r * width;
    const dst = r * stride;
    let costNone = 0;
    let costUp = 0;
    if (r > 0) {
      const prev = src - width;
      for (let c = 0; c < width; c++) {
        costNone += byteCost(data[src + c]);
        costUp += byteCost((data[src + c] - data[prev + c]) & 0xff);
      }
    }
    if (r > 0 && costUp < costNone) {
      raw[dst] = 2;
      const prev = src - width;
      for (let c = 0; c < width; c++) raw[dst + 1 + c] = (data[src + c] - data[prev + c]) & 0xff;
    } else {
      raw[dst] = 0;
      raw.set(data.subarray(src, src + width), dst + 1);
    }
  }
  return raw;
}

function writeU32(out: Uint8Array, offset: number, v: number): void {
  out[offset] = (v >>> 24) & 0xff;
  out[offset + 1] = (v >>> 16) & 0xff;
  out[offset + 2] = (v >>> 8) & 0xff;
  out[offset + 3] = v & 0xff;
}

function readU32(b: Uint8Array, offset: number): number {
  return ((b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3]) >>> 0;
}

/** 청크 하나 = 길이(4) + 형식(4) + 데이터 + CRC(형식 + 데이터) */
function makeChunk(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + payload.length);
  writeU32(out, 0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  writeU32(out, 8 + payload.length, task0Crc32(out, 4, 8 + payload.length));
  return out;
}

function checkSize(width: number, height: number, dataLength: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`PNG 크기는 양의 정수여야 함 (받은 값: ${width}×${height})`);
  }
  if (width > MAX_SIDE_PX || height > MAX_SIDE_PX) {
    throw new RangeError(`PNG 크기 상한 ${MAX_SIDE_PX} 초과 (받은 값: ${width}×${height})`);
  }
  if (dataLength !== width * height) {
    throw new RangeError(`픽셀 수 불일치: data ${dataLength} ≠ ${width}×${height}`);
  }
}

/** 회색조 0~255 이미지 → 8-bit 회색조 PNG 바이트 (같은 입력 → 같은 바이트) */
export async function encodeTask0GrayPng(img: Task0GrayImage): Promise<Uint8Array> {
  const { width, height, data } = img;
  checkSize(width, height, data.length);
  const ihdr = new Uint8Array(13);
  writeU32(ihdr, 0, width);
  writeU32(ihdr, 4, height);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 0; // 색 유형 0 = 회색조
  ihdr[10] = 0; // 압축 방식 (deflate)
  ihdr[11] = 0; // 필터 방식
  ihdr[12] = 0; // 인터레이스 없음
  const idat = await task0Deflate(filterRows(width, height, data), 'deflate');
  const parts = [PNG_SIGNATURE, makeChunk('IHDR', ihdr), makeChunk('IDAT', idat), makeChunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** 0/1 마스크 → 0/255 회색조 이미지 (0 이 아닌 칸은 전부 255) */
export function task0MaskToGray(mask: { width: number; height: number; data: Uint8Array }): Task0GrayImage {
  checkSize(mask.width, mask.height, mask.data.length);
  const data = new Uint8Array(mask.data.length);
  for (let i = 0; i < data.length; i++) data[i] = mask.data[i] !== 0 ? 255 : 0;
  return { width: mask.width, height: mask.height, data };
}

/** 0/1 마스크 → 8-bit 회색조 PNG (0 → 0, 그 밖 → 255) */
export function encodeTask0MaskPng(mask: { width: number; height: number; data: Uint8Array }): Promise<Uint8Array> {
  return encodeTask0GrayPng(task0MaskToGray(mask));
}

// ==================== 디코더 ====================

interface PngChunk {
  type: string;
  /** 데이터 시작 (원본 바이트 기준) */
  start: number;
  length: number;
}

/** 청크 목록 — 시그니처·길이·CRC 검사. 어기면 throw */
function readChunks(bytes: Uint8Array): PngChunk[] {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((v, i) => bytes[i] !== v)) {
    throw new Error('PNG 시그니처 아님');
  }
  const chunks: PngChunk[] = [];
  let p = PNG_SIGNATURE.length;
  while (p < bytes.length) {
    if (p + 12 > bytes.length) throw new Error(`PNG 청크 머리 잘림 (위치 ${p})`);
    const length = readU32(bytes, p);
    if (length > MAX_CHUNK_LENGTH || p + 12 + length > bytes.length) throw new Error(`PNG 청크 길이 오류 (위치 ${p})`);
    let type = '';
    for (let i = 0; i < 4; i++) {
      const c = bytes[p + 4 + i];
      const isLetter = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
      if (!isLetter) throw new Error(`PNG 청크 형식 이름 오류 (위치 ${p})`);
      type += String.fromCharCode(c);
    }
    const crc = readU32(bytes, p + 8 + length);
    if (crc !== task0Crc32(bytes, p + 4, p + 8 + length)) throw new Error(`PNG 청크 CRC 불일치: ${type}`);
    chunks.push({ type, start: p + 8, length });
    p += 12 + length;
    if (type === 'IEND') break;
  }
  if (p !== bytes.length) throw new Error('PNG IEND 뒤에 남은 바이트');
  return chunks;
}

function parseIhdr(bytes: Uint8Array, chunk: PngChunk): Task0PngHeader {
  if (chunk.type !== 'IHDR' || chunk.length !== 13) throw new Error('PNG 첫 청크가 IHDR(13바이트)가 아님');
  const s = chunk.start;
  return {
    width: readU32(bytes, s),
    height: readU32(bytes, s + 4),
    bitDepth: bytes[s + 8],
    colorType: bytes[s + 9],
    compression: bytes[s + 10],
    filter: bytes[s + 11],
    interlace: bytes[s + 12],
  };
}

/**
 * PNG 머리(IHDR)만 읽는다 — 해상도 검사용. 시그니처·청크 CRC 를 끝까지 보고(데이터 압축은 풀지 않음)
 * 첫 청크가 IHDR 이 아니면 throw. 비트 깊이·색 유형은 검사하지 않는다(호출 쪽 판단).
 */
export function readTask0PngHeader(bytes: Uint8Array): Task0PngHeader {
  const chunks = readChunks(bytes);
  if (chunks.length === 0) throw new Error('PNG 청크 없음');
  return parseIhdr(bytes, chunks[0]);
}

/** Paeth 예측 (PNG 명세 9.4) */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * 8-bit 회색조 PNG → 이미지. 8-bit 회색조·비인터레이스가 아니거나 구조가 깨졌으면 throw (메시지에 이유).
 */
export async function decodeTask0GrayPng(bytes: Uint8Array): Promise<Task0GrayImage> {
  const chunks = readChunks(bytes);
  if (chunks.length === 0) throw new Error('PNG 청크 없음');
  const h = parseIhdr(bytes, chunks[0]);
  if (h.bitDepth !== 8 || h.colorType !== 0) {
    throw new Error(`8-bit 회색조 아님 (비트 깊이 ${h.bitDepth}, 색 유형 ${h.colorType})`);
  }
  if (h.compression !== 0 || h.filter !== 0) throw new Error(`PNG 압축·필터 방식 오류 (${h.compression}, ${h.filter})`);
  if (h.interlace !== 0) throw new Error('인터레이스 PNG 미지원');
  if (h.width === 0 || h.height === 0 || h.width > MAX_SIDE_PX || h.height > MAX_SIDE_PX) {
    throw new Error(`PNG 크기 범위 밖 (${h.width}×${h.height})`);
  }
  if (chunks[chunks.length - 1].type !== 'IEND' || chunks[chunks.length - 1].length !== 0) {
    throw new Error('PNG 가 IEND 로 끝나지 않음');
  }

  // IDAT 은 연속이어야 한다 (PNG 명세 5.6). 그 밖의 필수 청크(대문자 시작)는 회색조에서 쓸 일이 없어 거부
  const idats: PngChunk[] = [];
  let idatEnded = false;
  for (let i = 1; i < chunks.length - 1; i++) {
    const c = chunks[i];
    if (c.type === 'IDAT') {
      if (idatEnded) throw new Error('PNG IDAT 청크가 연속이 아님');
      idats.push(c);
      continue;
    }
    if (idats.length > 0) idatEnded = true;
    if (c.type === 'IHDR' || c.type === 'IEND') throw new Error(`PNG ${c.type} 중복`);
    const critical = c.type.charCodeAt(0) >= 0x41 && c.type.charCodeAt(0) <= 0x5a;
    if (critical) throw new Error(`알 수 없는 필수 청크: ${c.type}`);
  }
  if (idats.length === 0) throw new Error('PNG IDAT 없음');

  const zLen = idats.reduce((s, c) => s + c.length, 0);
  const z = new Uint8Array(zLen);
  let o = 0;
  for (const c of idats) {
    z.set(bytes.subarray(c.start, c.start + c.length), o);
    o += c.length;
  }
  let raw: Uint8Array;
  try {
    raw = await task0Inflate(z, 'deflate');
  } catch (e) {
    throw new Error(`PNG IDAT 압축 풀기 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { width, height } = h;
  const stride = width + 1;
  if (raw.length !== stride * height) {
    throw new Error(`PNG 풀린 길이 ${raw.length} ≠ 높이 × (1 + 너비) = ${stride * height}`);
  }
  const data = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    const ft = raw[r * stride];
    const src = r * stride + 1;
    const dst = r * width;
    const up = dst - width; // r = 0 이면 위 행 = 0
    for (let c = 0; c < width; c++) {
      const x = raw[src + c];
      const a = c > 0 ? data[dst + c - 1] : 0;
      const b = r > 0 ? data[up + c] : 0;
      const cc = r > 0 && c > 0 ? data[up + c - 1] : 0;
      let v: number;
      switch (ft) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4:
          v = x + paeth(a, b, cc);
          break;
        default:
          throw new Error(`PNG 필터 형식 오류: 행 ${r} 필터 ${ft}`);
      }
      data[dst + c] = v & 0xff;
    }
  }
  return { width, height, data };
}
