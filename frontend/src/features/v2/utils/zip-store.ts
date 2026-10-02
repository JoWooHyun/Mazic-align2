/**
 * 의존성 없이 ZIP STORE (no compression) 파일을 만든다.
 *
 * PNG 처럼 이미 압축된 데이터를 묶을 때는 STORE 로 충분 — deflate
 * 로 또 한 번 압축해도 거의 줄지 않으므로 deflate 구현 부담을 피한다.
 *
 * 만들어진 Blob 은 표준 ZIP 으로 어떤 도구로도 열린다.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function makeZipStore(entries: ZipEntry[]): Blob {
  const chunks: BlobPart[] = [];
  // 전부 new Uint8Array(n) 로 만든 ArrayBuffer 기반 — TS 5.7+ lib 에서 BlobPart 로 받도록 타입만 명시.
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const f of entries) {
    const nameBytes = new TextEncoder().encode(f.name);
    const crc = crc32(f.data);

    // Local file header
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method = STORE
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true); // compressed size
    lv.setUint32(22, f.data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length
    lh.set(nameBytes, 30);

    chunks.push(lh);
    // TS 5.7+ lib 의 Uint8Array<ArrayBufferLike> 와 BlobPart 불일치 — 타입 단언만, 런타임 동일.
    chunks.push(f.data as BlobPart);

    // Central directory record
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += lh.length + f.data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);

  return new Blob([...chunks, ...central, eocd], { type: "application/zip" });
}

/**
 * STORE 방식 ZIP 만 디코드 (deflate 미지원). makeZipStore 가 만든
 * 파일 또는 동등하게 STORE 만 사용한 ZIP 을 unzip 한다.
 *
 * 단순화: 각 local file header 를 0x04034b50 시그니처로 찾아 순회.
 * EOCD / central directory 는 무시.
 */
export async function unzipStore(blob: Blob): Promise<ZipEntry[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dec = new TextDecoder();
  const entries: ZipEntry[] = [];
  let i = 0;
  while (i + 30 <= buf.length) {
    const sig =
      buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16) | (buf[i + 3] << 24);
    // 0x04034b50 (local file header)
    if (sig !== 0x04034b50) break;
    const view = new DataView(
      buf.buffer,
      buf.byteOffset + i,
      Math.min(30, buf.length - i),
    );
    const method = view.getUint16(8, true);
    const compSize = view.getUint32(18, true);
    const uncompSize = view.getUint32(22, true);
    const nameLen = view.getUint16(26, true);
    const extraLen = view.getUint16(28, true);
    if (method !== 0) {
      throw new Error(`ZIP method ${method} 미지원 (STORE 만 지원)`);
    }
    const nameStart = i + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = dec.decode(buf.subarray(nameStart, nameStart + nameLen));
    const data = buf.slice(dataStart, dataStart + compSize);
    if (data.length !== uncompSize) {
      throw new Error(`ZIP STORE 크기 불일치: ${name}`);
    }
    entries.push({ name, data });
    i = dataStart + compSize;
  }
  return entries;
}
