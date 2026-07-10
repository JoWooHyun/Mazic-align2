import type { PrinterProfileV2 } from "../types/printer";
import { layerExposureSec } from "./exposure";
import { estimatePrintTimeSec } from "./print-time";
import type { SliceMask } from "./slice-rasterize";

/** mm/s → mm/min (CTB 리프트/하강 속도 필드는 mm/min 단위). */
function mmPerSecToMmPerMin(mmPerSec: number): number {
  return mmPerSec * 60;
}

/**
 * CTB 조립 옵션(폴백 해결 완료) → estimatePrintTimeSec 가 읽는 프로파일 형태로 매핑.
 *
 * 헤더의 예상 출력 시간이 UI(SliceSidePanel)와 완전히 동일한 값이 되도록,
 * 시간 공식은 print-time.ts 의 estimatePrintTimeSec 한 곳에서만 관리한다.
 * estimatePrintTimeSec 는 아래 8개 노광/리프트/딜레이 필드만 읽으므로 나머지
 * 필수 필드(id, name, lcd 해상도, pixelPitch, buildVolume)는 계산에 영향 없는 placeholder.
 */
function ctbOptionsToProfile(opts: CtbAssembleOptions): PrinterProfileV2 {
  return {
    id: "",
    name: "",
    lcdWidthPx: opts.resolutionX,
    lcdHeightPx: opts.resolutionY,
    pixelPitchUm: 0,
    buildVolumeMm: [opts.bedSizeXMm, opts.bedSizeYMm, opts.bedSizeZMm],
    exposureSec: opts.exposureSec,
    bottomExposureSec: opts.bottomExposureSec,
    bottomLayerCount: opts.bottomLayers,
    transitionLayerCount: opts.transitionLayers,
    liftDistanceMm: opts.liftDistanceMm,
    liftSpeedMmS: opts.liftSpeedMmS,
    retractSpeedMmS: opts.retractSpeedMmS,
    lightOffDelaySec: opts.lightOffSec,
  };
}

/**
 * CTB 조립에 필요한 파라미터 (Babylon 의존 없는 순수부).
 * 워커는 자체적으로 마스크를 만들어 encodeRle1bpp → assembleCtb 로 산출.
 */
export interface CtbAssembleOptions {
  layerHeightMm: number;
  resolutionX: number;
  resolutionY: number;
  bedSizeXMm: number;
  bedSizeYMm: number;
  bedSizeZMm: number;
  exposureSec: number;
  bottomExposureSec: number;
  bottomLayers: number;
  transitionLayers: number;
  lightOffSec: number;
  // ---- 리프트/딜레이 (호출부에서 DEFAULT_* 폴백까지 해결한 값. 예상 시간과 동일 기준) ----
  /** 리프트 거리 (mm). CTB LiftHeight/BottomLiftHeight 에 그대로 기록. */
  liftDistanceMm: number;
  /** 리프트 속도 (mm/s). 기록 시 mm/min 으로 환산. */
  liftSpeedMmS: number;
  /** 하강 속도 (mm/s). 기록 시 mm/min 으로 환산. */
  retractSpeedMmS: number;
}

/**
 * ChiTuBox `.ctb` v4 인코더 — minimal viable 구현.
 *
 * spec 출처: UVTools wiki (https://github.com/sn4k3/UVtools/wiki/File-Formats).
 * 사유 포맷이라 100% 정확성 보장 안 됨. 표준 도구 (UVTools 등) 에서
 * 열어 검증한 뒤 잘못된 필드는 사용자 보고로 점진 수정.
 *
 * 첫 패스 단순화:
 *   · 평문 (encryption_key = 0)
 *   · anti_alias = 1 (binary mask 만 — 우리 마스크가 1bpp).
 *   · preview small / large = 거의 빈 회색 RGB565 이미지.
 *   · print parameters / slicer info 는 표준 default 값.
 *
 * Layer data 는 CTB v3/v4 의 RLE 인코딩:
 *   각 byte:
 *     bit 7    = pixel state (0=black, 1=white)
 *     bits 0-6 = run length 1..127
 *   run > 127 은 같은 색의 byte 를 반복 출력.
 */

const MAGIC_CTB = 0x12fd0086;
const VERSION = 3; // ChiTuBox 1.9.5 호환을 위해 v3 (binary, anti_alias=1)

/**
 * 이미 RLE 인코딩된 레이어 데이터 배열 + 파라미터로 최종 .ctb ArrayBuffer 를 조립.
 *
 * Babylon 에 의존하지 않는 순수 함수 — 워커가 마스크를 만들어 호출한다.
 * 산출 바이트는 분리 전과 동일 (헤더/preview/파라미터/layer table/layer data 순).
 * 단, slicer info 의 TimestampMinutes 필드는 호출 시각(분)을 담으므로 호출마다 달라진다.
 */
export function assembleCtb(
  layerData: Uint8Array[],
  layerCount: number,
  opts: CtbAssembleOptions,
): Blob {
  const {
    exposureSec,
    bottomExposureSec,
    bottomLayers,
    transitionLayers,
    lightOffSec,
    liftDistanceMm,
    liftSpeedMmS,
    retractSpeedMmS,
  } = opts;
  // CTB 속도 필드는 mm/min. 프로파일 속도는 mm/s 이므로 환산.
  const liftSpeedMmMin = mmPerSecToMmPerMin(liftSpeedMmS);
  const retractSpeedMmMin = mmPerSecToMmPerMin(retractSpeedMmS);

  // ---------- 2) 작은 / 큰 preview (단색 회색 placeholder) ----------
  const previewSmall = makeBlankPreview(400, 300);
  const previewLarge = makeBlankPreview(800, 480);

  // ---------- 3) 헤더·블록 사이즈 산정 (offset 계산용) ----------
  const HEADER_SIZE = 0x70; // 112 bytes
  // Preview header: ResX + ResY + ImageOffset + ImageLength + 4 padding uints.
  const PREVIEW_HEADER = 32;

  const printParamsSize = 60;
  const slicerInfoSize = 68; // v3 slicer info 표준 크기.

  let off = HEADER_SIZE;

  const previewSmallOffset = off;
  off += PREVIEW_HEADER + previewSmall.byteLength;

  const previewLargeOffset = off;
  off += PREVIEW_HEADER + previewLarge.byteLength;

  const printParamsOffset = off;
  off += printParamsSize;

  const slicerInfoOffset = off;
  off += slicerInfoSize;

  const layerTableOffset = off;
  const LAYER_DEF_SIZE = 36;
  // layer table 다음이 layer data 시작 offset. (레이어 정의 배열: layerCount × 36B)
  off = layerTableOffset + LAYER_DEF_SIZE * layerCount;

  // 각 layer data 의 절대 offset 미리 계산.
  const layerDataOffsets: number[] = [];
  for (const ld of layerData) {
    layerDataOffsets.push(off);
    off += ld.byteLength;
  }
  const totalSize = off;

  // ---------- 4) 출력 버퍼 ----------
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  // ---------- 5) 헤더 (112 bytes) ----------
  let p = 0;
  view.setUint32(p, MAGIC_CTB, true); p += 4;
  view.setUint32(p, VERSION, true); p += 4;
  view.setFloat32(p, opts.bedSizeXMm, true); p += 4;
  view.setFloat32(p, opts.bedSizeYMm, true); p += 4;
  view.setFloat32(p, opts.bedSizeZMm, true); p += 4;
  view.setUint32(p, 0, true); p += 4; // pad
  view.setUint32(p, 0, true); p += 4; // pad
  view.setUint32(p, 0, true); p += 4; // pad
  view.setFloat32(p, layerCount * opts.layerHeightMm, true); p += 4; // total height
  view.setFloat32(p, opts.layerHeightMm, true); p += 4;
  view.setFloat32(p, exposureSec, true); p += 4;
  view.setFloat32(p, bottomExposureSec, true); p += 4;
  view.setFloat32(p, lightOffSec, true); p += 4;
  view.setUint32(p, bottomLayers, true); p += 4;
  view.setUint32(p, opts.resolutionX, true); p += 4;
  view.setUint32(p, opts.resolutionY, true); p += 4;
  view.setUint32(p, previewLargeOffset, true); p += 4; // preview "one" = large
  view.setUint32(p, layerTableOffset, true); p += 4;
  view.setUint32(p, layerCount, true); p += 4;
  view.setUint32(p, previewSmallOffset, true); p += 4; // preview "two" = small
  // 예상 출력 시간: UI(SliceSidePanel)와 동일하게 print-time.ts 공식으로 계산
  // (레이어별 노광 보간 + lightOff + 리프트 왕복). 헤더 필드는 초 단위 Uint32.
  view.setUint32(p, Math.round(estimatePrintTimeSec(layerCount, ctbOptionsToProfile(opts))), true); p += 4; // print time
  view.setUint32(p, 0, true); p += 4; // projector = cast
  view.setUint32(p, printParamsOffset, true); p += 4;
  view.setUint32(p, printParamsSize, true); p += 4;
  view.setUint32(p, 1, true); p += 4; // anti_alias = 1 (binary)
  view.setUint16(p, 255, true); p += 2; // light pwm
  view.setUint16(p, 255, true); p += 2; // bottom light pwm
  view.setUint32(p, 0, true); p += 4; // encryption key = 0
  view.setUint32(p, slicerInfoOffset, true); p += 4;
  view.setUint32(p, slicerInfoSize, true); p += 4;

  // ---------- 6) preview small (header 32B + image) ----------
  p = previewSmallOffset;
  view.setUint32(p, 400, true); p += 4; // res x
  view.setUint32(p, 300, true); p += 4; // res y
  view.setUint32(p, previewSmallOffset + PREVIEW_HEADER, true); p += 4;
  view.setUint32(p, previewSmall.byteLength, true); p += 4;
  view.setUint32(p, 0, true); p += 4; // padding
  view.setUint32(p, 0, true); p += 4;
  view.setUint32(p, 0, true); p += 4;
  view.setUint32(p, 0, true); p += 4;
  u8.set(previewSmall, p);

  // ---------- 7) preview large ----------
  p = previewLargeOffset;
  view.setUint32(p, 800, true); p += 4;
  view.setUint32(p, 480, true); p += 4;
  view.setUint32(p, previewLargeOffset + PREVIEW_HEADER, true); p += 4;
  view.setUint32(p, previewLarge.byteLength, true); p += 4;
  view.setUint32(p, 0, true); p += 4; // padding
  view.setUint32(p, 0, true); p += 4;
  view.setUint32(p, 0, true); p += 4;
  view.setUint32(p, 0, true); p += 4;
  u8.set(previewLarge, p);

  // ---------- 8) print parameters (60 bytes) ----------
  p = printParamsOffset;
  view.setFloat32(p, liftDistanceMm, true); p += 4;   // bottom lift height mm
  view.setFloat32(p, liftSpeedMmMin, true); p += 4;   // bottom lift speed mm/min
  view.setFloat32(p, liftDistanceMm, true); p += 4;   // lift height mm
  view.setFloat32(p, liftSpeedMmMin, true); p += 4;   // lift speed mm/min
  view.setFloat32(p, retractSpeedMmMin, true); p += 4;// retract speed mm/min
  view.setFloat32(p, 0.0, true); p += 4;  // volume ml
  view.setFloat32(p, 0.0, true); p += 4;  // weight g
  view.setFloat32(p, 0.0, true); p += 4;  // cost
  view.setFloat32(p, lightOffSec, true); p += 4; // bottom light off
  view.setFloat32(p, lightOffSec, true); p += 4; // light off
  view.setUint32(p, bottomLayers, true); p += 4;
  // pad to 60
  for (; p < printParamsOffset + printParamsSize; p++) u8[p] = 0;

  // ---------- 9) slicer info (68 bytes for v3) ----------
  p = slicerInfoOffset;
  view.setFloat32(p, liftDistanceMm, true); p += 4;   // BottomLiftHeight
  view.setFloat32(p, liftSpeedMmMin, true); p += 4;   // BottomLiftSpeed
  view.setFloat32(p, liftDistanceMm, true); p += 4;   // LiftHeight
  view.setFloat32(p, liftSpeedMmMin, true); p += 4;   // LiftSpeed
  view.setFloat32(p, retractSpeedMmMin, true); p += 4;// RetractSpeed
  view.setFloat32(p, 0.0, true); p += 4;   // Volume
  view.setUint32(p, 1, true); p += 4;      // AntiAliasFlag (1 = on)
  view.setUint16(p, 0, true); p += 2;      // Padding
  view.setUint16(p, 0, true); p += 2;      // PerLayerSettings
  view.setUint32(p, Math.floor(Date.now() / 60000), true); p += 4; // TimestampMinutes
  view.setUint32(p, 1, true); p += 4;      // AntiAliasLevel
  view.setUint32(p, 0x01060300, true); p += 4; // SoftwareVersion (resinforge v1.6.3)
  view.setFloat32(p, 0.0, true); p += 4;   // RestTimeAfterRetract
  view.setFloat32(p, 0.0, true); p += 4;   // RestTimeAfterLift
  view.setUint32(p, transitionLayers, true); p += 4; // TransitionLayerCount
  view.setUint32(p, 0, true); p += 4;      // Padding2
  view.setUint32(p, 0, true); p += 4;      // Padding3

  // ---------- 10) layer table + layer data ----------
  p = layerTableOffset;
  for (let i = 0; i < layerCount; i++) {
    const z = (i + 1) * opts.layerHeightMm;
    // 전환 레이어 노광 선형 보간 (transitionLayers=0 이면 바닥/일반 즉시 전환 — 기존 동작 동일).
    const expo = layerExposureSec(i, {
      bottomLayerCount: bottomLayers,
      transitionLayerCount: transitionLayers,
      bottomExposureSec,
      exposureSec,
    });
    view.setFloat32(p, z, true); p += 4;
    view.setFloat32(p, expo, true); p += 4;
    view.setFloat32(p, lightOffSec, true); p += 4;
    view.setUint32(p, layerDataOffsets[i], true); p += 4;
    view.setUint32(p, layerData[i].byteLength, true); p += 4;
    view.setUint32(p, 0, true); p += 4; // unknown
    view.setUint32(p, 0, true); p += 4;
    view.setUint32(p, 0, true); p += 4;
    view.setUint32(p, 0, true); p += 4;
  }

  for (let i = 0; i < layerCount; i++) {
    u8.set(layerData[i], layerDataOffsets[i]);
  }

  return new Blob([buf], { type: "application/octet-stream" });
}

/**
 * 1bpp 마스크의 RLE 인코딩 (CTB v3/v4 호환).
 *
 * 각 byte:
 *   bit 7    = pixel color (0=black, 1=white)
 *   bits 0-6 = run length 1..127
 *
 * run > 127 은 같은 (color, 127) byte 를 여러 번 출력해 분할.
 */
export function encodeRle1bpp(mask: SliceMask): Uint8Array {
  const data = mask.data;
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const color = data[i] ? 1 : 0;
    let run = 1;
    while (i + run < data.length && (data[i + run] ? 1 : 0) === color && run < 127) {
      run++;
    }
    out.push((color << 7) | run);
    i += run;
  }
  return new Uint8Array(out);
}

/**
 * 단색 회색 RGB565 이미지 — CTB preview 자리에 채울 placeholder.
 * (실 슬라이서는 모델 렌더 썸네일을 넣지만 우리는 첫 패스 단순화.)
 */
function makeBlankPreview(w: number, h: number): Uint8Array {
  const buf = new Uint8Array(w * h * 2);
  // RGB565: 5 bits R, 6 G, 5 B. 중간 회색 ≈ 0x7BEF (123, 60, 15 → grey-ish)
  // 단순화: 0x7BEF 반복.
  const v = 0x7bef;
  for (let i = 0; i < w * h; i++) {
    buf[i * 2] = v & 0xff;
    buf[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return buf;
}
