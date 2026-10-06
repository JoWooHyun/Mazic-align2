/**
 * Task0 job.zip — 조립(buildTask0JobZip)과 검사(verifyTask0JobZip) (규격서 v0.3.3 §11·§3·§13)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c
 *   §11(job.zip 구성·PNG·래스터 규약·manifest v1·exposure.json·preview·**거부 조건 1~7**), §3(층 규약, 빈 층 = PNG 전부 검정),
 *   §13(시간 상수). 협의 `docs/제안_Task0협의_20260929.md` §26-3(10/8 견본 구성)·§27-1(불량 7종).
 * 견본·불량 zip 생성: `scripts/gen-task0-sample-zip.mjs`, 상시 검증: `scripts/verify-task0-jobzip.mjs`.
 * Z3(앱 내보내기 — task0-export runTask0JobZipExport)가 이 모듈을 그대로 쓴다: 층 이미지(buildTask0LayerImages)와
 *   파일 목록(buildTask0JobFiles)은 견본 경로 buildTask0JobZip 과 **같은 함수**라 같은 입력이면 같은 바이트
 *   (scripts/verify-task0-jobzip-export.mjs 가 sample.job.zip 바이트로 확인).
 *
 * zip 구성 (파일 순서 고정 — run.gcode, manifest.json, exposure.json, preview.png, layers/0000.png …):
 *   - run.gcode      = task0-gcode-writer generateTask0Gcode 출력 그대로.
 *   - layers/NNNN.png = 층 N 의 task0-mask rasterizeTask0Mask(… 'full') — 투사 프레임 1920 × 1080, 0/1 → 0/255,
 *                       8-bit 회색조 (task0-png). 단면은 writer 와 같은 task0-slice task0LayerPolygonsBed(같은 bed 값).
 *                       번호는 0-based 4자리(10000 층부터는 자리가 늘어남 — 규격은 4자리만 적었다).
 *   - manifest.json  = 규격 §11 예시와 같은 필드·순서. generatedAt 은 주입 가능(같은 입력 → 같은 바이트).
 *                       2재료(D1b — writer 결과 totals.dualMaterial)면 materials = [A(T0), B(T1)]·dualMaterial true·
 *                       toolChangeCount = G-code 툴 전환 수, 층 노광 = 재료별 큰 값(buildTask0MaterialExposure — 규격 §6).
 *                       단일 재료는 지금 바이트 그대로(materials 1개·dualMaterial false·toolChangeCount 0).
 *   - exposure.json  = { layerHeightMm, bottomLayerCount, transitionLayerCount, exposureSecByLayer(길이 = layerCount) }.
 *                       값은 utils/exposure.ts layerExposureSec(기존 마스크 경로와 같은 보간), 빠진 설정은
 *                       types/printer.ts DEFAULT_* (규칙 6 — 기본값 단일 소스). 빈 층도 일정표 값 그대로 둔다
 *                       (Task0 는 빈 층에서 LED 를 생략하므로 쓰이지 않는다).
 *   - preview.png    = 400 × 300 회색조, 전 층 마스크 합집합 실루엣(합집합 bbox 에 맞춰 축척, 여백 20 px, 4×4 표본 평균).
 *   JSON 은 2칸 들여쓰기 + 끝 개행, UTF-8(BOM 없음). zip 은 기존 utils/zip-store makeZipStore(무압축, 시각 0) —
 *   PNG 는 이미 압축돼 있다.
 *
 * estimate (규격 §11·§13) — writer 층 통계로 계산, 각 항목을 1 ms 단위로 반올림, totalSec = 나머지 7개 합(ms 정수 합):
 *   depositSec = Σ 도포 길이 ÷ 도포 속도(파일의 F) / travelSec = Σ 트래블 길이 ÷ 트래블 속도 + E 단독 줄(E−r·E+r) 시간
 *   (§13 에 따로 항목이 없어 트래블에 넣는다) / toolChangeSec = toolChangeCount × 0.5 /
 *   parkSec·bladeSec = 도포가 있는 층 수 × 3·15 (빈 층은 Task0 가 파킹·블레이드·LED 를 생략 — §9) /
 *   layerOverheadSec = 전체 층 수 × 2 / exposureSec = 도포가 있는 층의 exposureSecByLayer 합.
 *   가속은 보지 않는다(잠정 상수와 같은 수준의 근사).
 *
 * 검사 (verifyTask0JobZip) — 거부 조건 번호 목록(violations) + 추가 검사(extraIssues):
 *   1 run.gcode 없음 / 2 manifest.json 없음·JSON 아님·version ≠ 1 /
 *   3 `;LAYER_CHANGE` 수(Task0 파서 이식판 print 모드 layerCount) · manifest layerCount · layers/*.png 수 중 하나라도 다름 /
 *   4 PNG 이름이 layers/0000.png … 로 빈틈없이 이어지지 않음 / 5 PNG 해상도·manifest projector 픽셀 수 ≠ 1920 × 1080,
 *   manifest bed ≠ 150 × 85 / 6 exposure.json 없음·배열 아님·길이 ≠ layerCount / 7 층 N 의 `;Z:` 가 없거나
 *   |`;Z:` − layerHeightMm × (N+1)| > 0.001.
 *   한 조건만 어긴 zip 이 그 번호 하나만 받도록, 판정할 수 없는 조건은 건너뛴다(예: run.gcode 가 없으면 3·7 의
 *   G-code 쪽 비교는 하지 않는다 — 조건 1 이 이미 잡는다).
 *   추가 검사: zip CRC·이름 중복·알 수 없는 항목·JSON 앞 BOM / PNG 가 8-bit 회색조로 풀림 / run.gcode 가 Task0 파서 이식판 print
 *   모드에서 경고 0·오류 0 (층두께 비교는 조건 7 이 맡으므로 파서에는 주지 않는다) / 층마다 `;HEIGHT:` = layerHeightMm /
 *   (조건 3·4 가 맞을 때만 — 층 N ↔ NNNN.png 대응이 정해짐) XY 이동 없는 층(빈 층) ↔ PNG 흰 픽셀 0, 도포 층 ↔ 흰 픽셀 > 0 /
 *   manifest 필드(format·materials·dualMaterial·toolChangeCount = G-code 툴 전환 수·estimate 8필드와 합·hints) /
 *   exposure 필드(layerHeightMm 일치, 값 ≥ 0) / preview.png 400 × 300 8-bit 회색조.
 *   layerPngs 'header'(Z3 앱 자기 검사)면 층 PNG 풀기와 그 내용 대조(빈 층 ↔ 흰 픽셀)만 건너뛰고, 대신 IHDR 로 8-bit 회색조·
 *   비인터레이스를 본다 — 나머지는 같다.
 *   zip 해석은 중앙 디렉터리 기준, 무압축(0)·deflate(8 — DecompressionStream 'deflate-raw') 지원.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음 (CompressionStream·DecompressionStream·TextEncoder/TextDecoder·Blob 만 —
 *   브라우저·Web Worker·Node 22 공통).
 */
import {
  DEFAULT_BOTTOM_EXPOSURE_SEC,
  DEFAULT_BOTTOM_LAYER_COUNT,
  DEFAULT_EXPOSURE_SEC,
  DEFAULT_TRANSITION_LAYER_COUNT,
} from '../../types/printer';
import { layerExposureSec } from '../exposure';
import { makeZipStore } from '../zip-store';
import { TASK0_DEFAULTS, TASK0_TIME_CONSTANTS, type Task0TimeConstants } from './task0-frame';
import {
  generateTask0Gcode,
  type Task0GcodeResult,
  type Task0LayerStats,
  type Task0WriterOptions,
  type Task0WriterParams,
} from './task0-gcode-writer';
import { END_MARKER, LAYER_MARKER, START_MARKER, parseGcodeText, type ParseResult } from './task0-gcode-parser';
import { rasterizeTask0Mask, type Task0RasterFrame } from './task0-mask';
import {
  decodeTask0GrayPng,
  encodeTask0GrayPng,
  encodeTask0MaskPng,
  readTask0PngHeader,
  task0Crc32,
  task0Inflate,
  type Task0GrayImage,
} from './task0-png';
import { task0LayerPolygonsBed } from './task0-slice';

// ==================== 상수 ====================

/** manifest.format — 규격 §11 */
export const TASK0_JOB_FORMAT = 'mazicalign-job';
/** manifest.version — 규격 §11 (v1) */
export const TASK0_JOB_VERSION = 1;
/** manifest.generator 기본값 ("MazicAlign v2 <버전>") */
export const TASK0_JOB_GENERATOR = 'MazicAlign v2 task0-jobzip (Z1)';
/** 단일 재료 기본 이름 — 규격 §11 예시 (2재료면 재료 A(T0) 기본 이름도 이 값) */
export const TASK0_DEFAULT_MATERIAL_NAME = '모델레진';
/**
 * 2재료 재료 B(T1) 기본 이름 (D1b) — `docs/계획_하이브리드슬라이서설정_20260928.md` §3-C 재료 이름 예("모델레진, 템프레진")와
 * §5-5(템프 레진 크라운 = B 가 모델 레진 베이스 = A 위에)를 따른다. 재료 이름 편집 UI 는 아직 없다(D2).
 */
export const TASK0_DEFAULT_MATERIAL_NAME_B = '템프레진';
/** zip 안 고정 이름 */
export const TASK0_JOB_FILE_GCODE = 'run.gcode';
export const TASK0_JOB_FILE_MANIFEST = 'manifest.json';
export const TASK0_JOB_FILE_EXPOSURE = 'exposure.json';
export const TASK0_JOB_FILE_PREVIEW = 'preview.png';
/** 미리보기 크기 — 규격 §11 "400×300 권장" */
export const TASK0_PREVIEW_WIDTH_PX = 400;
export const TASK0_PREVIEW_HEIGHT_PX = 300;

/** 층 N 의 마스크 PNG 이름 — 0-based 4자리 (규격 §11) */
export function task0LayerPngName(layerIndex: number): string {
  return `layers/${String(layerIndex).padStart(4, '0')}.png`;
}

/** estimate 의 합산 대상 7개 (totalSec 제외) — 규격 §11 예시 순서 */
export const TASK0_ESTIMATE_PARTS = [
  'depositSec',
  'travelSec',
  'toolChangeSec',
  'parkSec',
  'bladeSec',
  'layerOverheadSec',
  'exposureSec',
] as const;

/** 거부 조건 번호 — 규격 §11 */
export type Task0JobCondition = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 거부 조건 문구 — 규격 §11 그대로 */
export const TASK0_JOB_CONDITION_LABELS: Readonly<Record<Task0JobCondition, string>> = Object.freeze({
  1: 'run.gcode 없음',
  2: 'manifest.json 없음 또는 version ≠ 1',
  3: ';LAYER_CHANGE 개수 ≠ layerCount ≠ PNG 개수',
  4: 'PNG 번호 불연속',
  5: '해상도(1920×1080)·베드 불일치',
  6: 'exposure 배열 길이 ≠ layerCount',
  7: ';Z: ≠ layerHeightMm × (N+1) (±0.001)',
});

const ALL_CONDITIONS: readonly Task0JobCondition[] = [1, 2, 3, 4, 5, 6, 7];

/** 조건 7 허용 오차 (mm) — 규격 §11·파서 TOL 과 같은 값 */
const Z_TOL_MM = 0.001;
/** 부동소수 경계 보정 — 파서 EPS 와 같은 값 */
const EPS = 1e-9;
/** estimate 합 비교 허용치 (s) — 항목이 1 ms 단위라 반 ms */
const ESTIMATE_SUM_TOL_SEC = 0.0005;
/** 메시지에 보여 줄 목록 길이 */
const MAX_LIST = 5;

// ==================== 타입 ====================

/** 노광 설정 — 빠진 값은 types/printer.ts DEFAULT_* */
export interface Task0ExposureSettings {
  /** 일반 층 노광 (s) */
  exposureSec?: number;
  /** 바닥 층 노광 (s) */
  bottomExposureSec?: number;
  /** 바닥 층 수 */
  bottomLayerCount?: number;
  /** 전환 층 수 (바닥 → 일반 선형 보간) */
  transitionLayerCount?: number;
}

/** exposure.json — 규격 §11 */
export interface Task0Exposure {
  layerHeightMm: number;
  bottomLayerCount: number;
  transitionLayerCount: number;
  /** 길이 = layerCount, Task0 는 [N] 만 쓴다 */
  exposureSecByLayer: number[];
}

/** manifest.estimate — 규격 §11 (s) */
export interface Task0Estimate {
  depositSec: number;
  travelSec: number;
  toolChangeSec: number;
  parkSec: number;
  bladeSec: number;
  layerOverheadSec: number;
  exposureSec: number;
  /** 나머지 7개의 합 */
  totalSec: number;
}

/** manifest.materials[] — 규격 §11 */
export interface Task0ManifestMaterial {
  slot: 'A' | 'B';
  tool: 'T0' | 'T1';
  name: string;
  exposureSec: number;
  bottomExposureSec: number;
  retractMm: number;
}

/** manifest.json v1 — 규격 §11 예시와 같은 필드·순서 */
export interface Task0Manifest {
  format: string;
  version: number;
  generator: string;
  generatedAt: string;
  layerCount: number;
  layerHeightMm: number;
  projector: { widthPx: number; heightPx: number; pixelPitchUm: number; offsetMm: [number, number] };
  bed: { widthMm: number; depthMm: number };
  materials: Task0ManifestMaterial[];
  dualMaterial: boolean;
  toolChangeCount: number;
  estimate: Task0Estimate;
  hints: { blade: null; ledPower: null };
}

/** manifest 재료 하나의 입력 — 노광 값은 그 재료의 exposure 설정, retractMm 은 writer 값 */
export interface Task0ManifestMaterialInput {
  name?: string;
  exposureSec: number;
  bottomExposureSec: number;
  retractMm: number;
}

export interface Task0ManifestInput {
  layerCount: number;
  layerHeightMm: number;
  estimate: Task0Estimate;
  /** 재료 A(T0) — 노광 값은 exposure 설정과 같은 값, retractMm 은 writer 값 */
  material: Task0ManifestMaterialInput;
  /**
   * (2재료 D1b) 재료 B(T1) — 있으면 materials 2개(A·B)·dualMaterial true (규격 §11 "materials 가 1개면 단일 모드").
   * 이름이 빠지면 TASK0_DEFAULT_MATERIAL_NAME_B. 없으면 지금과 같은 단일 재료 manifest(바이트 그대로).
   */
  materialB?: Task0ManifestMaterialInput;
  toolChangeCount?: number;
  generator?: string;
  /** ISO 8601 — 빠지면 지금 시각 (결정적 출력이 필요하면 주입) */
  generatedAt?: string;
  frame?: Task0RasterFrame;
  bed?: { widthMm: number; depthMm: number };
}

export interface Task0EstimateOptions {
  /** 툴 전환 횟수 (단일 재료 0, 2재료 = writer totals.toolChanges) */
  toolChangeCount?: number;
  /** 시간 상수 — 빠진 값은 TASK0_TIME_CONSTANTS (규격 §13) */
  time?: Partial<Task0TimeConstants>;
}

/** estimate 계산에 쓰는 층 통계 (writer Task0LayerStats 의 일부) */
export type Task0EstimateLayer = Pick<Task0LayerStats, 'index' | 'empty' | 'depositMm' | 'travelMm' | 'retracts' | 'unretracts'>;

export interface Task0PreviewOptions {
  widthPx?: number;
  heightPx?: number;
  /** 사방 여백 (px, 기본 20) */
  marginPx?: number;
  /** 확대 상한 (미리보기 px / 마스크 px, 기본 8 — 아주 작은 형상이 덩어리 몇 개로 커지는 것을 막음) */
  maxScale?: number;
  /** 미리보기 픽셀당 표본 수 = samples² (기본 4 → 16) */
  samples?: number;
}

export interface Task0JobZipInput {
  /** 메시별 world 삼각형 (감김 통일 — extractWorldTriangles 결과). 읽기만 한다 */
  meshes: readonly Float32Array[];
  /** 서포트 포함 최고점 (mm, 플레이트 0 기준) — 층 수 = task0LayerCount(topY, lh) */
  topY: number;
  /** 층두께 lh (mm) */
  layerHeightMm: number;
  writer?: Task0WriterOptions;
  exposure?: Task0ExposureSettings;
  /** (2재료) 재료 B 노광 — 빠지면 exposure 와 같은 값. writer.dualMaterial 이 있을 때만 쓴다 */
  exposureB?: Task0ExposureSettings;
  materialName?: string;
  /** (2재료) 재료 B 이름 — 빠지면 TASK0_DEFAULT_MATERIAL_NAME_B */
  materialNameB?: string;
  generator?: string;
  /** ISO 8601 — 빠지면 지금 시각 */
  generatedAt?: string;
  time?: Partial<Task0TimeConstants>;
  preview?: Task0PreviewOptions;
}

/** zip 안 파일 하나 */
export interface Task0JobZipFile {
  name: string;
  data: Uint8Array;
}

export interface Task0JobZipBuild {
  /** zip 바이트 */
  bytes: Uint8Array;
  /** zip 안 순서 그대로 */
  files: Task0JobZipFile[];
  gcode: Task0GcodeResult;
  manifest: Task0Manifest;
  exposure: Task0Exposure;
  /** 층별 마스크 흰 픽셀 수 */
  layerWhitePixels: number[];
  /** 단면 안이지만 투사 프레임 밖이라 잘린 픽셀 중심 수 (전 층 합) */
  clippedPixels: number;
}

export interface Task0LayerImagesOptions {
  /** 투사 프레임 — 빠지면 TASK0_DEFAULTS (앱은 프로파일 값 — task0-profile resolveTask0ProfileFrame) */
  frame?: Task0RasterFrame;
  preview?: Task0PreviewOptions;
  /** 층 하나를 PNG 로 만들 때마다 (끝낸 층 수, 전체 층 수) — 출력에는 영향 없음(읽기만 하는 알림) */
  onLayerDone?: (done: number, total: number) => void;
}

/** 층 마스크 PNG + preview (buildTask0LayerImages 결과) */
export interface Task0LayerImages {
  /** layers/NNNN.png — 층 순서 */
  layerFiles: Task0JobZipFile[];
  /** 층별 마스크 흰 픽셀 수 */
  layerWhitePixels: number[];
  /** 단면 안이지만 투사 프레임 밖이라 잘린 픽셀 중심 수 (전 층 합) */
  clippedPixels: number;
  /** preview.png 바이트 */
  preview: Uint8Array;
}

/** buildTask0JobFiles 입력 — writer 결과 + 층 이미지 + 노광·manifest 값 */
export interface Task0JobFilesInput {
  gcode: Task0GcodeResult;
  layerHeightMm: number;
  images: Task0LayerImages;
  exposure?: Task0ExposureSettings;
  /**
   * (2재료) 재료 B 노광 — 빠지면 exposure 와 같은 값. 2재료 여부는 writer 결과(gcode.totals.dualMaterial)로 정한다.
   * 층당 노광 = 재료별 큰 값 (buildTask0MaterialExposure — 규격 §6)
   */
  exposureB?: Task0ExposureSettings;
  materialName?: string;
  /** (2재료) 재료 B 이름 — 빠지면 TASK0_DEFAULT_MATERIAL_NAME_B */
  materialNameB?: string;
  generator?: string;
  /** ISO 8601 — 빠지면 지금 시각 */
  generatedAt?: string;
  time?: Partial<Task0TimeConstants>;
  /** manifest projector 값 — 층 이미지와 같은 프레임 (빠지면 TASK0_DEFAULTS) */
  frame?: Task0RasterFrame;
}

export interface Task0JobFiles {
  /** zip 안 순서 그대로 */
  files: Task0JobZipFile[];
  manifest: Task0Manifest;
  exposure: Task0Exposure;
}

/** zip 에서 읽은 항목 */
export interface Task0ZipEntry {
  name: string;
  /** 풀린 데이터 */
  data: Uint8Array;
  /** 0 = 무압축, 8 = deflate */
  method: number;
  /** 풀린 데이터 CRC-32 = 중앙 디렉터리 값 */
  crcOk: boolean;
}

export interface Task0JobZipVerifyOptions {
  /** 기대 해상도 (기본 TASK0_DEFAULTS 1920 × 1080) */
  widthPx?: number;
  heightPx?: number;
  /** 기대 베드 (기본 TASK0_DEFAULTS 150 × 85 mm) */
  bedWidthMm?: number;
  bedDepthMm?: number;
  /** 판정할 거부 조건 — 기본 1~7 전부. 대조군(조건 하나를 뺀 검사기)용 */
  conditions?: readonly number[];
  /** 추가 검사 — 기본 true. 대조군용 */
  extraChecks?: boolean;
  /**
   * layers/*.png 를 어디까지 보나 (Z3) — 'decode'(기본): 끝까지 풀어 8-bit 회색조 해석 + 빈 층 ↔ 흰 픽셀 내용 대조.
   * 'header': 머리만 — 청크 구조·CRC(readTask0PngHeader), 조건 5 해상도, IHDR 8-bit 회색조·비인터레이스는 그대로 보고
   * 압축 풀기를 건너뛴다. 1920×1080 한 장 풀기가 층당 약 16 ms 라
   * 앱 자기 검사(runTask0JobZipExport)가 쓴다: 그쪽은 내용(빈 층 = 흰 픽셀 0, 도포 층 = 흰 픽셀 > 0)을 PNG 로 만들기 전
   * 마스크에서 직접 단언하고, 인코더 왕복은 표본 두 장(첫 도포 층·빈 층)만 풀어 본다.
   */
  layerPngs?: 'decode' | 'header';
}

/** layers/*.png 하나의 검사 결과 */
export interface Task0JobZipPngInfo {
  name: string;
  /** IHDR 값 (머리를 못 읽으면 null) */
  width: number | null;
  height: number | null;
  /** 8-bit 회색조로 끝까지 풀렸는지 (추가 검사를 끄면 null) */
  decoded: boolean | null;
  /** 0 이 아닌 픽셀 수 (못 풀었으면 null) */
  whitePixels: number | null;
  /** 0·255 가 아닌 픽셀 수 (못 풀었으면 null) — 규격상 허용(그대로 투사), 참고용 */
  midPixels: number | null;
}

export interface Task0JobZipReport {
  /** 어긴 거부 조건 번호 (오름차순, 중복 없음) */
  violations: Task0JobCondition[];
  /** 조건별 사유 (한 조건에 여러 줄 가능) */
  reasons: { condition: Task0JobCondition; message: string }[];
  /** 추가 검사 위반 */
  extraIssues: string[];
  /** violations·extraIssues 모두 비었는지 */
  pass: boolean;
  /** zip 항목 이름 (순서 그대로) */
  entries: string[];
  /** run.gcode 의 층 수 (파서 이식판 print 모드) — 못 읽으면 null */
  layerChangeCount: number | null;
  /** manifest.layerCount — 없거나 정수가 아니면 null */
  manifestLayerCount: number | null;
  /** layers/*.png 수 */
  pngCount: number;
  /** exposureSecByLayer 길이 — 없으면 null */
  exposureLength: number | null;
  /** XY 이동이 없는 층 (Task0 빈 층) — run.gcode 를 못 읽으면 null */
  emptyLayers: number[] | null;
  pngs: Task0JobZipPngInfo[];
  /** 파서 print 모드 경고·오류 — run.gcode 를 못 읽으면 null */
  parserWarnings: string[] | null;
  parserErrors: string[] | null;
}

// ==================== 노광·시간·manifest ====================

function nonNegInt(name: string, v: number): number {
  if (!Number.isInteger(v) || v < 0) throw new RangeError(`${name} 는 0 이상 정수여야 함 (받은 값: ${String(v)})`);
  return v;
}

function positive(name: string, v: number): number {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} 는 양의 유한 수여야 함 (받은 값: ${String(v)})`);
  return v;
}

function nonNeg(name: string, v: number): number {
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`${name} 는 0 이상 유한 수여야 함 (받은 값: ${String(v)})`);
  return v;
}

/** 노광 설정에 기본값(types/printer.ts DEFAULT_*)을 채우고 검사 */
export function resolveTask0ExposureSettings(settings: Task0ExposureSettings = {}): Required<Task0ExposureSettings> {
  return {
    exposureSec: positive('exposureSec', settings.exposureSec ?? DEFAULT_EXPOSURE_SEC),
    bottomExposureSec: nonNeg('bottomExposureSec', settings.bottomExposureSec ?? DEFAULT_BOTTOM_EXPOSURE_SEC),
    bottomLayerCount: nonNegInt('bottomLayerCount', settings.bottomLayerCount ?? DEFAULT_BOTTOM_LAYER_COUNT),
    transitionLayerCount: nonNegInt(
      'transitionLayerCount',
      settings.transitionLayerCount ?? DEFAULT_TRANSITION_LAYER_COUNT,
    ),
  };
}

/** exposure.json — 층마다 utils/exposure.ts layerExposureSec (기존 마스크 경로와 같은 보간) */
export function buildTask0Exposure(
  layerCount: number,
  layerHeightMm: number,
  settings: Task0ExposureSettings = {},
): Task0Exposure {
  nonNegInt('layerCount', layerCount);
  positive('layerHeightMm', layerHeightMm);
  const s = resolveTask0ExposureSettings(settings);
  const exposureSecByLayer: number[] = [];
  for (let n = 0; n < layerCount; n++) exposureSecByLayer.push(layerExposureSec(n, s));
  return {
    layerHeightMm,
    bottomLayerCount: s.bottomLayerCount,
    transitionLayerCount: s.transitionLayerCount,
    exposureSecByLayer,
  };
}

/** 재료별 노광 → 층 노광 (buildTask0MaterialExposure 결과) */
export interface Task0MaterialExposure {
  /** exposure.json — 단일이면 buildTask0Exposure 그대로, 2재료면 층마다 재료별 큰 값 */
  exposure: Task0Exposure;
  /** 재료 A(T0) 설정 (기본값 채움) — manifest materials[0] */
  settingsA: Required<Task0ExposureSettings>;
  /** 재료 B(T1) 설정 (기본값 채움) — manifest materials[1]. 단일 재료면 null */
  settingsB: Required<Task0ExposureSettings> | null;
  /** 재료별 값이 달라 큰 값을 쓴 항목 (화면 경고용 — 막지 않는다). 같으면 빈 목록 */
  warnings: string[];
}

/**
 * 층 노광 — 단일 재료(exposureB null)면 buildTask0Exposure(exposureA) 그대로.
 * 2재료면 **층마다 재료별 큰 값**(규격 §6 "노광은 층당 1회. 재료별 노광 시간이 다르면 큰 값을 쓰고 UI에 경고",
 * 계획 `docs/계획_하이브리드슬라이서설정_20260928.md` §6 결정 5): exposureSecByLayer[N] = max(A 의 [N], B 의 [N]),
 * bottomLayerCount·transitionLayerCount 도 큰 값(exposure.json 표시용 — Task0 는 [N] 만 쓴다).
 * 두 설정이 같으면 결과는 단일 재료와 같은 값이다(지금 앱은 한 프로파일에서 두 재료 값을 가져와 늘 같다).
 */
export function buildTask0MaterialExposure(
  layerCount: number,
  layerHeightMm: number,
  exposureA: Task0ExposureSettings = {},
  exposureB: Task0ExposureSettings | null = null,
): Task0MaterialExposure {
  const settingsA = resolveTask0ExposureSettings(exposureA);
  if (exposureB === null) {
    return { exposure: buildTask0Exposure(layerCount, layerHeightMm, exposureA), settingsA, settingsB: null, warnings: [] };
  }
  const settingsB = resolveTask0ExposureSettings(exposureB);
  const a = buildTask0Exposure(layerCount, layerHeightMm, settingsA);
  const b = buildTask0Exposure(layerCount, layerHeightMm, settingsB);
  const labels: [keyof Task0ExposureSettings, string, string][] = [
    ['exposureSec', '일반 노광', ' s'],
    ['bottomExposureSec', '바닥 노광', ' s'],
    ['bottomLayerCount', '바닥 층 수', '층'],
    ['transitionLayerCount', '전환 층 수', '층'],
  ];
  const diffs = labels
    .filter(([k]) => settingsA[k] !== settingsB[k])
    .map(([k, label, unit]) => `${label} A ${settingsA[k]}${unit} / B ${settingsB[k]}${unit}`);
  const warnings =
    diffs.length === 0
      ? []
      : [`재료 A·B 노광 설정이 다릅니다(${diffs.join(', ')}) — 층마다 큰 값으로 노광합니다(규격 §6, 층당 노광 1회).`];
  return {
    exposure: {
      layerHeightMm,
      bottomLayerCount: Math.max(a.bottomLayerCount, b.bottomLayerCount),
      transitionLayerCount: Math.max(a.transitionLayerCount, b.transitionLayerCount),
      exposureSecByLayer: a.exposureSecByLayer.map((v, n) => Math.max(v, b.exposureSecByLayer[n])),
    },
    settingsA,
    settingsB,
    warnings,
  };
}

/**
 * estimate 8필드 — 머리 주석의 식. 항목마다 1 ms 단위 반올림, totalSec = 나머지 7개의 ms 정수 합.
 * @param params writer 설정 (파일에 쓴 F 그대로 — mm/min)
 */
export function buildTask0Estimate(
  layers: readonly Task0EstimateLayer[],
  params: Pick<Task0WriterParams, 'depositF' | 'travelF' | 'retractF' | 'retractMm'>,
  exposureSecByLayer: readonly number[],
  options: Task0EstimateOptions = {},
): Task0Estimate {
  const t: Task0TimeConstants = { ...TASK0_TIME_CONSTANTS, ...options.time };
  const toolChanges = nonNegInt('toolChangeCount', options.toolChangeCount ?? 0);
  const depositMmS = positive('depositF', params.depositF) / 60;
  const travelMmS = positive('travelF', params.travelF) / 60;
  const retractMmS = positive('retractF', params.retractF) / 60;
  let deposit = 0;
  let travel = 0;
  let printed = 0;
  let exposure = 0;
  for (const l of layers) {
    deposit += l.depositMm / depositMmS;
    travel += l.travelMm / travelMmS + ((l.retracts + l.unretracts) * params.retractMm) / retractMmS;
    if (l.empty) continue; // 빈 층 — Task0 가 파킹·블레이드·LED 생략 (§9)
    printed++;
    const e = exposureSecByLayer[l.index];
    if (e !== undefined) exposure += e;
  }
  const ms = {
    depositSec: Math.round(deposit * 1000),
    travelSec: Math.round(travel * 1000),
    toolChangeSec: Math.round(toolChanges * t.toolChangeSec * 1000),
    parkSec: Math.round(printed * t.parkSec * 1000),
    bladeSec: Math.round(printed * t.bladeSec * 1000),
    layerOverheadSec: Math.round(layers.length * t.layerOverheadSec * 1000),
    exposureSec: Math.round(exposure * 1000),
  };
  let totalMs = 0;
  for (const k of TASK0_ESTIMATE_PARTS) totalMs += ms[k];
  return {
    depositSec: ms.depositSec / 1000,
    travelSec: ms.travelSec / 1000,
    toolChangeSec: ms.toolChangeSec / 1000,
    parkSec: ms.parkSec / 1000,
    bladeSec: ms.bladeSec / 1000,
    layerOverheadSec: ms.layerOverheadSec / 1000,
    exposureSec: ms.exposureSec / 1000,
    totalSec: totalMs / 1000,
  };
}

/**
 * manifest.json v1 — 규격 §11 예시와 같은 필드·순서. 단일 재료(materialB 없음)는 materials = [A(T0)]·dualMaterial false,
 * 2재료(D1b)는 materials = [A(T0), B(T1)]·dualMaterial true. toolChangeCount 는 호출자가 넘긴 값(G-code 툴 전환 수).
 */
export function buildTask0Manifest(input: Task0ManifestInput): Task0Manifest {
  const frame = input.frame ?? TASK0_DEFAULTS;
  const bed = input.bed ?? { widthMm: TASK0_DEFAULTS.bedWidthMm, depthMm: TASK0_DEFAULTS.bedDepthMm };
  const toolChangeCount = nonNegInt('toolChangeCount', input.toolChangeCount ?? 0);
  const mB = input.materialB;
  return {
    format: TASK0_JOB_FORMAT,
    version: TASK0_JOB_VERSION,
    generator: input.generator ?? TASK0_JOB_GENERATOR,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    layerCount: nonNegInt('layerCount', input.layerCount),
    layerHeightMm: positive('layerHeightMm', input.layerHeightMm),
    projector: {
      widthPx: frame.projectorWidthPx,
      heightPx: frame.projectorHeightPx,
      pixelPitchUm: frame.pixelPitchUm,
      offsetMm: [frame.projectorOffsetXMm, frame.projectorOffsetYMm],
    },
    bed: { widthMm: bed.widthMm, depthMm: bed.depthMm },
    materials: [
      {
        slot: 'A',
        tool: 'T0',
        name: input.material.name ?? TASK0_DEFAULT_MATERIAL_NAME,
        exposureSec: positive('exposureSec', input.material.exposureSec),
        bottomExposureSec: nonNeg('bottomExposureSec', input.material.bottomExposureSec),
        retractMm: positive('retractMm', input.material.retractMm),
      },
      ...(mB === undefined
        ? []
        : [
            {
              slot: 'B' as const,
              tool: 'T1' as const,
              name: mB.name ?? TASK0_DEFAULT_MATERIAL_NAME_B,
              exposureSec: positive('materialB.exposureSec', mB.exposureSec),
              bottomExposureSec: nonNeg('materialB.bottomExposureSec', mB.bottomExposureSec),
              retractMm: positive('materialB.retractMm', mB.retractMm),
            },
          ]),
    ],
    dualMaterial: mB !== undefined,
    toolChangeCount,
    estimate: { ...input.estimate },
    hints: { blade: null, ledPower: null },
  };
}

/** JSON 파일 바이트 — 2칸 들여쓰기 + 끝 개행, UTF-8 (BOM 없음) */
export function task0JsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
}

// ==================== 미리보기 ====================

/**
 * preview — 합집합 마스크(투사 프레임 0/1)의 실루엣을 bbox 에 맞춰 축척한 회색조 이미지.
 * 미리보기 픽셀마다 samples × samples 표본(픽셀 안 고른 점)을 마스크에서 집어 흰 비율 × 255 (반올림).
 * 행 0 = 위 = Y 최대 (마스크와 같은 평면도 방향). 흰 칸이 없으면 전부 0.
 */
export function buildTask0Preview(
  union: { width: number; height: number; data: Uint8Array },
  options: Task0PreviewOptions = {},
): Task0GrayImage {
  const W = options.widthPx ?? TASK0_PREVIEW_WIDTH_PX;
  const H = options.heightPx ?? TASK0_PREVIEW_HEIGHT_PX;
  const margin = options.marginPx ?? 20;
  const maxScale = options.maxScale ?? 8;
  const S = options.samples ?? 4;
  if (![W, H, S].every((v) => Number.isInteger(v) && v > 0) || !Number.isInteger(margin) || margin < 0) {
    throw new RangeError(`미리보기 설정 오류 (${W}×${H}, 여백 ${margin}, 표본 ${S})`);
  }
  if (2 * margin >= W || 2 * margin >= H) throw new RangeError(`여백 ${margin} px 이 미리보기 ${W}×${H} 에 비해 큼`);
  positive('maxScale', maxScale);
  const { width: mw, height: mh, data: md } = union;
  if (md.length !== mw * mh) throw new RangeError(`합집합 크기 불일치: ${md.length} ≠ ${mw}×${mh}`);

  const out = new Uint8Array(W * H);
  let c0 = Infinity;
  let c1 = -Infinity;
  let r0 = Infinity;
  let r1 = -Infinity;
  for (let r = 0; r < mh; r++) {
    const off = r * mw;
    for (let c = 0; c < mw; c++) {
      if (md[off + c] === 0) continue;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }
  }
  if (c0 === Infinity) return { width: W, height: H, data: out };

  // 마스크 좌표: 칸 (c, r) 은 [c, c+1) × [r, r+1). bbox 중심을 미리보기 중심에 둔다
  const bw = c1 - c0 + 1;
  const bh = r1 - r0 + 1;
  const scale = Math.min((W - 2 * margin) / bw, (H - 2 * margin) / bh, maxScale);
  const cx = c0 + bw / 2;
  const cy = r0 + bh / 2;
  const total = S * S;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let hit = 0;
      for (let l = 0; l < S; l++) {
        const sy = cy + (j + (l + 0.5) / S - H / 2) / scale;
        const row = Math.floor(sy);
        if (row < 0 || row >= mh) continue;
        const off = row * mw;
        for (let k = 0; k < S; k++) {
          const sx = cx + (i + (k + 0.5) / S - W / 2) / scale;
          const col = Math.floor(sx);
          if (col >= 0 && col < mw && md[off + col] !== 0) hit++;
        }
      }
      out[j * W + i] = Math.round((255 * hit) / total);
    }
  }
  return { width: W, height: H, data: out };
}

// ==================== 조립 ====================

/** 파일 목록 → zip 바이트 (기존 zip-store 무압축, 시각 0 — 순서 그대로, 결정적) */
export async function assembleTask0JobZip(files: readonly Task0JobZipFile[]): Promise<Uint8Array<ArrayBuffer>> {
  const blob = makeZipStore(files.map((f) => ({ name: f.name, data: f.data })));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 층 마스크 PNG + preview — 층 N 마다 writer 와 같은 단면(task0-slice task0LayerPolygonsBed, 같은 meshes·lh·bed)을
 * task0-mask rasterizeTask0Mask(투사 프레임 'full')로 그려 8-bit 회색조 PNG 로. preview 는 전 층 합집합 실루엣.
 * 견본 경로(buildTask0JobZip)와 앱 경로(task0-export runTask0JobZipExport)가 **이 함수 하나**를 쓴다.
 *
 * 빈 마스크(흰 픽셀 0)는 내용이 전부 0 이라 인코더 출력도 늘 같다 → 처음 한 장만 인코딩하고 그 바이트를 다른 빈 층에
 * 다시 쓴다(같은 런타임의 같은 입력 = 같은 바이트이므로 결과 zip 은 층마다 인코딩한 것과 바이트까지 같다 — 견본 sha256 로 확인).
 * @param bed writer 와 같은 베드 크기 (world → 베드 변환)
 */
export async function buildTask0LayerImages(
  meshes: readonly Float32Array[],
  layerCount: number,
  layerHeightMm: number,
  bed: { widthMm: number; depthMm: number },
  options: Task0LayerImagesOptions = {},
): Promise<Task0LayerImages> {
  nonNegInt('layerCount', layerCount);
  const frame = options.frame ?? TASK0_DEFAULTS;
  const W = frame.projectorWidthPx;
  const H = frame.projectorHeightPx;
  const union = new Uint8Array(W * H);
  const layerFiles: Task0JobZipFile[] = [];
  const layerWhitePixels: number[] = [];
  let clippedPixels = 0;
  let emptyPng: Uint8Array | null = null;
  for (let n = 0; n < layerCount; n++) {
    const polys = task0LayerPolygonsBed(meshes, n, layerHeightMm, bed.widthMm, bed.depthMm);
    const mask = rasterizeTask0Mask(polys, { frame });
    layerWhitePixels.push(mask.whitePixels);
    clippedPixels += mask.clippedPixels;
    let png: Uint8Array;
    if (mask.whitePixels === 0) {
      emptyPng ??= await encodeTask0MaskPng(mask);
      png = emptyPng;
    } else {
      const md = mask.data;
      for (let i = 0; i < md.length; i++) if (md[i] !== 0) union[i] = 1;
      png = await encodeTask0MaskPng(mask);
    }
    layerFiles.push({ name: task0LayerPngName(n), data: png });
    options.onLayerDone?.(n + 1, layerCount);
  }
  const preview = await encodeTask0GrayPng(buildTask0Preview({ width: W, height: H, data: union }, options.preview));
  return { layerFiles, layerWhitePixels, clippedPixels, preview };
}

/**
 * writer 결과에 맞는 층 노광 — 2재료 출력(gcode.totals.dualMaterial)이면 재료 B 노광(빠지면 A 와 같은 값)과 큰 값,
 * 단일이면 A 그대로. buildTask0JobFiles(manifest·exposure.json·estimate)와 앱 코어 요약(task0-export)이 이 함수 하나를 써서
 * 화면 요약 estimate = 파일 estimate 가 된다.
 */
export function task0JobMaterialExposure(
  gcode: Pick<Task0GcodeResult, 'totals'>,
  layerHeightMm: number,
  exposure: Task0ExposureSettings = {},
  exposureB?: Task0ExposureSettings,
): Task0MaterialExposure {
  const dual = gcode.totals.dualMaterial;
  return buildTask0MaterialExposure(gcode.totals.layerCount, layerHeightMm, exposure, dual ? (exposureB ?? exposure) : null);
}

/**
 * zip 에 넣을 파일 목록 (순서 고정 — 머리 주석) + manifest·exposure. writer 결과와 층 이미지를 받아 조립만 한다.
 * 견본 경로·앱 경로 공통 — manifest 노광 값은 exposure 설정(빠지면 types/printer.ts DEFAULT_*), retractMm·bed 는 writer 값.
 * 2재료(D1b — writer 결과 totals.dualMaterial): materials 2개(A = T0, B = T1)·dualMaterial true, 층 노광 = 재료별 큰 값.
 * toolChangeCount·estimate 툴 전환 시간은 둘 다 writer 의 툴 전환 수(totals.toolChanges — 단일 재료는 늘 0)로 센다.
 */
export function buildTask0JobFiles(input: Task0JobFilesInput): Task0JobFiles {
  const { gcode, images } = input;
  const lh = input.layerHeightMm;
  const layerCount = gcode.totals.layerCount;
  if (images.layerFiles.length !== layerCount) {
    throw new RangeError(`층 PNG ${images.layerFiles.length}장 ≠ writer 층 수 ${layerCount}`);
  }
  const params = gcode.params;

  const mat = task0JobMaterialExposure(gcode, lh, input.exposure ?? {}, input.exposureB);
  const exposure = mat.exposure;
  const exposureSettings = mat.settingsA;
  const toolChangeCount = gcode.totals.toolChanges;
  const estimate = buildTask0Estimate(gcode.layers, params, exposure.exposureSecByLayer, {
    toolChangeCount,
    time: input.time,
  });
  const manifest = buildTask0Manifest({
    layerCount,
    layerHeightMm: lh,
    estimate,
    material: {
      name: input.materialName,
      exposureSec: exposureSettings.exposureSec,
      bottomExposureSec: exposureSettings.bottomExposureSec,
      retractMm: params.retractMm,
    },
    materialB:
      mat.settingsB === null
        ? undefined
        : {
            name: input.materialNameB,
            exposureSec: mat.settingsB.exposureSec,
            bottomExposureSec: mat.settingsB.bottomExposureSec,
            retractMm: params.retractMm,
          },
    toolChangeCount,
    generator: input.generator,
    generatedAt: input.generatedAt,
    frame: input.frame,
    bed: { widthMm: params.bedWidthMm, depthMm: params.bedDepthMm },
  });

  const files: Task0JobZipFile[] = [
    { name: TASK0_JOB_FILE_GCODE, data: new TextEncoder().encode(gcode.gcode) },
    { name: TASK0_JOB_FILE_MANIFEST, data: task0JsonBytes(manifest) },
    { name: TASK0_JOB_FILE_EXPOSURE, data: task0JsonBytes(exposure) },
    { name: TASK0_JOB_FILE_PREVIEW, data: images.preview },
    ...images.layerFiles,
  ];
  return { files, manifest, exposure };
}

/**
 * world 메시 → Task0 job.zip (run.gcode + layers/NNNN.png + manifest.json + exposure.json + preview.png) — 견본 경로.
 * 층이 0개(topY ≤ 0)면 내보낼 것이 없으므로 throw. 검사(채움 실패·파서·자기 검사)는 하지 않는다 —
 * 앱은 task0-export runTask0JobZipExport(검사 + 같은 조립 함수)를 쓴다.
 */
export async function buildTask0JobZip(input: Task0JobZipInput): Promise<Task0JobZipBuild> {
  const lh = input.layerHeightMm;
  const gcode = generateTask0Gcode(input.meshes, input.topY, lh, input.writer ?? {});
  const layerCount = gcode.totals.layerCount;
  if (layerCount <= 0) throw new RangeError(`층이 0개 — topY ${String(input.topY)} mm 에서 내보낼 것이 없음`);
  const params = gcode.params;

  // 층 마스크 — writer 와 같은 단면(같은 bed 값), 투사 프레임 전체('full')
  const images = await buildTask0LayerImages(
    input.meshes,
    layerCount,
    lh,
    { widthMm: params.bedWidthMm, depthMm: params.bedDepthMm },
    { preview: input.preview },
  );
  const { files, manifest, exposure } = buildTask0JobFiles({
    gcode,
    layerHeightMm: lh,
    images,
    exposure: input.exposure,
    exposureB: input.exposureB,
    materialName: input.materialName,
    materialNameB: input.materialNameB,
    generator: input.generator,
    generatedAt: input.generatedAt,
    time: input.time,
  });
  const bytes = await assembleTask0JobZip(files);
  return {
    bytes,
    files,
    gcode,
    manifest,
    exposure,
    layerWhitePixels: images.layerWhitePixels,
    clippedPixels: images.clippedPixels,
  };
}

// ==================== zip 읽기 ====================

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/**
 * zip 항목 전부 읽기 — 중앙 디렉터리 기준. 무압축(0)·deflate(8) 지원, 암호화·ZIP64·그 밖의 방식은 throw.
 * 디렉터리 항목(이름 끝 '/')은 뺀다. CRC 는 throw 하지 않고 crcOk 로 알린다.
 */
export async function readTask0ZipEntries(bytes: Uint8Array): Promise<Task0ZipEntry[]> {
  const n = bytes.length;
  let eocd = -1;
  for (let p = n - 22; p >= 0 && p >= n - 22 - 0xffff; p--) {
    if (u32(bytes, p) === 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 끝 레코드(EOCD) 없음');
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('ZIP64 미지원');
  if (cdOffset + cdSize > eocd) throw new Error('zip 중앙 디렉터리 위치 오류');

  const dec = new TextDecoder();
  const out: Task0ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || u32(bytes, p) !== 0x02014b50) throw new Error(`zip 중앙 디렉터리 항목 ${i} 오류`);
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const crc = u32(bytes, p + 16);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new Error(`암호화된 zip 항목 미지원: ${name}`);
    if (local + 30 > n || u32(bytes, local) !== 0x04034b50) throw new Error(`zip 로컬 머리 오류: ${name}`);
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    if (start + compSize > n) throw new Error(`zip 데이터 잘림: ${name}`);
    if (name.endsWith('/')) continue;
    const raw = bytes.subarray(start, start + compSize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      try {
        data = await task0Inflate(raw, 'deflate-raw');
      } catch (e) {
        throw new Error(`zip 항목 압축 풀기 실패: ${name} (${e instanceof Error ? e.message : String(e)})`);
      }
    } else throw new Error(`zip 압축 방식 ${method} 미지원: ${name}`);
    if (data.length !== size) throw new Error(`zip 항목 크기 불일치: ${name} (${data.length} ≠ ${size})`);
    out.push({ name, data, method, crcOk: task0Crc32(data) === crc });
  }
  return out;
}

// ==================== 검사 ====================

type JsonRead = { kind: 'missing' } | { kind: 'error'; message: string } | { kind: 'ok'; value: unknown };

function readJson(entry: Task0ZipEntry | undefined): JsonRead {
  if (!entry) return { kind: 'missing' };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(entry.data);
    return { kind: 'ok', value: JSON.parse(text) as unknown };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPositiveNum = (v: unknown): v is number => isFiniteNum(v) && v > 0;
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** 메시지용 숫자 — 소수 6자리에서 반올림해 부동소수 꼬리(0.30000000000000004)를 감춘다 */
function shortNum(v: number): string {
  return String(Number(v.toFixed(6)));
}

function listHead(items: readonly (string | number)[]): string {
  const head = items.slice(0, MAX_LIST).join(', ');
  return items.length > MAX_LIST ? `${head} … (${items.length}개)` : head;
}

/** 줄 나누기 — 파서와 같이 \r\n·\r·\n */
function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** 층마다 첫 `;HEIGHT:` 값 (START 뒤, END 전 — 없으면 null, 숫자가 아니면 NaN) */
function scanHeightMarkers(text: string): (number | null)[] {
  const out: (number | null)[] = [];
  let started = false;
  for (const raw of splitLines(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)) {
    const s = raw.trim();
    if (!started) {
      started = s === START_MARKER;
      continue;
    }
    if (s === END_MARKER) break;
    if (s === LAYER_MARKER) {
      out.push(null);
      continue;
    }
    const last = out.length - 1;
    if (last >= 0 && out[last] === null && s.startsWith(';HEIGHT:')) {
      const t = s.slice(';HEIGHT:'.length).trim();
      out[last] = /^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/.test(t) ? Number(t) : NaN;
    }
  }
  return out;
}

/** 파서 출력에서 툴 사용·전환 수 (첫 선택은 전환이 아님) */
function countToolChanges(parse: ParseResult): { changes: number; tools: Set<string> } {
  let current: string | null = null;
  let changes = 0;
  const tools = new Set<string>();
  for (const b of parse.blocks) {
    for (const line of b.gcode.split('\n')) {
      const t = line.trim().toUpperCase();
      if (t !== 'T0' && t !== 'T1') continue;
      tools.add(t);
      if (current !== null && current !== t) changes++;
      current = t;
    }
  }
  return { changes, tools };
}

/**
 * job.zip 검사 — 규격 §11 거부 조건 1~7(violations) + 추가 검사(extraIssues). throw 하지 않는다
 * (zip 자체를 못 읽으면 항목 0개로 보고 extraIssues 에 사유를 남긴다).
 */
export async function verifyTask0JobZip(
  bytes: Uint8Array,
  options: Task0JobZipVerifyOptions = {},
): Promise<Task0JobZipReport> {
  const enabled = new Set<number>(options.conditions ?? ALL_CONDITIONS);
  const extra = options.extraChecks ?? true;
  const decodeLayers = (options.layerPngs ?? 'decode') === 'decode';
  const expW = options.widthPx ?? TASK0_DEFAULTS.projectorWidthPx;
  const expH = options.heightPx ?? TASK0_DEFAULTS.projectorHeightPx;
  const expBedW = options.bedWidthMm ?? TASK0_DEFAULTS.bedWidthMm;
  const expBedD = options.bedDepthMm ?? TASK0_DEFAULTS.bedDepthMm;

  const reasons: { condition: Task0JobCondition; message: string }[] = [];
  const extraIssues: string[] = [];
  const fail = (c: Task0JobCondition, message: string): void => {
    if (enabled.has(c)) reasons.push({ condition: c, message });
  };
  const issue = (message: string): void => {
    if (extra) extraIssues.push(message);
  };

  // ---- zip ----
  let entries: Task0ZipEntry[] = [];
  try {
    entries = await readTask0ZipEntries(bytes);
  } catch (e) {
    issue(`zip 해석 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  const byName = new Map<string, Task0ZipEntry>();
  for (const e of entries) {
    if (byName.has(e.name)) issue(`zip 항목 이름 중복: ${e.name}`);
    else byName.set(e.name, e);
    if (!e.crcOk) issue(`zip CRC 불일치: ${e.name}`);
  }

  // ---- 1. run.gcode ----
  const gEntry = byName.get(TASK0_JOB_FILE_GCODE);
  let gcodeText: string | null = null;
  let parse: ParseResult | null = null;
  if (!gEntry) fail(1, 'run.gcode 없음');
  else {
    try {
      gcodeText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(gEntry.data);
    } catch {
      issue('run.gcode 가 UTF-8 이 아님');
    }
    if (gcodeText !== null) parse = parseGcodeText(gcodeText, { mode: 'print' });
  }
  const layerBlocks = parse ? parse.blocks.filter((b) => b.isLayer) : null;
  const L = parse ? parse.layerCount : null;

  // ---- 2. manifest ----
  const mRead = readJson(byName.get(TASK0_JOB_FILE_MANIFEST));
  let manifest: Record<string, unknown> | null = null;
  if (mRead.kind === 'missing') fail(2, 'manifest.json 없음');
  else if (mRead.kind === 'error') fail(2, `manifest.json 해석 실패: ${mRead.message}`);
  else {
    manifest = asRecord(mRead.value);
    if (!manifest) fail(2, 'manifest.json 이 객체가 아님');
    else if (manifest.version !== TASK0_JOB_VERSION) fail(2, `manifest version = ${JSON.stringify(manifest.version)} (≠ 1)`);
  }
  const M = manifest && isNonNegInt(manifest.layerCount) ? manifest.layerCount : null;

  // ---- PNG 목록 ----
  const pngEntries = entries.filter((e) => e.name.startsWith('layers/') && e.name.toLowerCase().endsWith('.png'));
  const P = pngEntries.length;

  // ---- 3. 개수 ----
  let cond3ok = true;
  if (manifest && M === null) {
    cond3ok = false;
    fail(3, `manifest layerCount 가 0 이상 정수가 아님: ${JSON.stringify(manifest.layerCount)}`);
  }
  const counts: [string, number][] = [];
  if (L !== null) counts.push([';LAYER_CHANGE', L]);
  if (M !== null) counts.push(['layerCount', M]);
  counts.push(['PNG', P]);
  if (new Set(counts.map(([, v]) => v)).size > 1) {
    cond3ok = false;
    fail(3, counts.map(([k, v]) => `${k} ${v}`).join(' / '));
  }

  // ---- 4. PNG 번호 ----
  const pngNames = new Set(pngEntries.map((e) => e.name));
  const expectedNames = Array.from({ length: P }, (_, i) => task0LayerPngName(i));
  const missing = expectedNames.filter((nm) => !pngNames.has(nm));
  const unexpected = [...pngNames].filter((nm) => !expectedNames.includes(nm));
  const cond4ok = missing.length === 0 && unexpected.length === 0;
  if (!cond4ok) {
    fail(4, `빠진 번호: ${listHead(missing) || '없음'} / 어긋난 이름: ${listHead(unexpected) || '없음'}`);
  }

  // ---- 5. 해상도·베드 ----
  const pngs: Task0JobZipPngInfo[] = [];
  for (const e of pngEntries) {
    const info: Task0JobZipPngInfo = { name: e.name, width: null, height: null, decoded: null, whitePixels: null, midPixels: null };
    try {
      const h = readTask0PngHeader(e.data);
      info.width = h.width;
      info.height = h.height;
      if (h.width !== expW || h.height !== expH) fail(5, `${e.name} 해상도 ${h.width}×${h.height} ≠ ${expW}×${expH}`);
      // 'header' 는 풀지 않으므로 8-bit 회색조 여부를 IHDR 로 본다('decode' 는 디코더가 같은 것을 거부 — 문구 중복 방지)
      if (!decodeLayers && (h.bitDepth !== 8 || h.colorType !== 0 || h.interlace !== 0)) {
        issue(`${e.name} 가 8-bit 회색조·비인터레이스가 아님 (IHDR 비트 깊이 ${h.bitDepth}, 색 유형 ${h.colorType}, 인터레이스 ${h.interlace})`);
      }
    } catch (err) {
      issue(`${e.name} PNG 머리 해석 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
    pngs.push(info);
  }
  if (manifest) {
    const proj = asRecord(manifest.projector);
    if (!proj || proj.widthPx !== expW || proj.heightPx !== expH) {
      fail(5, `manifest projector ${proj ? `${String(proj.widthPx)}×${String(proj.heightPx)}` : '없음'} ≠ ${expW}×${expH}`);
    }
    const bed = asRecord(manifest.bed);
    const bedOk =
      bed && isFiniteNum(bed.widthMm) && isFiniteNum(bed.depthMm) &&
      Math.abs(bed.widthMm - expBedW) <= EPS && Math.abs(bed.depthMm - expBedD) <= EPS;
    if (!bedOk) {
      fail(5, `manifest bed ${bed ? `${String(bed.widthMm)}×${String(bed.depthMm)}` : '없음'} ≠ ${expBedW}×${expBedD} mm`);
    }
  }

  // ---- 6. exposure ----
  const xRead = readJson(byName.get(TASK0_JOB_FILE_EXPOSURE));
  let exposure: Record<string, unknown> | null = null;
  let exposureArr: unknown[] | null = null;
  if (xRead.kind === 'missing') fail(6, 'exposure.json 없음');
  else if (xRead.kind === 'error') fail(6, `exposure.json 해석 실패: ${xRead.message}`);
  else {
    exposure = asRecord(xRead.value);
    const arr = exposure ? exposure.exposureSecByLayer : undefined;
    if (!Array.isArray(arr)) fail(6, 'exposureSecByLayer 가 배열이 아님');
    else {
      exposureArr = arr;
      const ref = M ?? L ?? P;
      if (arr.length !== ref) fail(6, `exposureSecByLayer 길이 ${arr.length} ≠ layerCount ${ref}`);
    }
  }

  // ---- 7. ;Z: = lh × (N+1) ----
  const lhManifest = manifest && isPositiveNum(manifest.layerHeightMm) ? manifest.layerHeightMm : null;
  const lhExposure = exposure && isPositiveNum(exposure.layerHeightMm) ? exposure.layerHeightMm : null;
  const lh = lhManifest ?? lhExposure;
  if (layerBlocks && lh !== null) {
    for (const b of layerBlocks) {
      const n = b.layerIndex ?? 0;
      const want = lh * (n + 1);
      if (b.markerZ === null) fail(7, `층 ${n}: ;Z: 없음`);
      else if (Math.abs(b.markerZ - want) > Z_TOL_MM + EPS) {
        fail(7, `층 ${n}: ;Z:${shortNum(b.markerZ)} ≠ ${shortNum(lh)} × ${n + 1} = ${shortNum(want)} (±${Z_TOL_MM})`);
      }
    }
  }

  // ---- 추가 검사 ----
  const emptyLayers = layerBlocks ? layerBlocks.filter((b) => !b.hasXy).map((b) => b.layerIndex ?? 0) : null;
  if (extra) {
    const known = new Set([TASK0_JOB_FILE_GCODE, TASK0_JOB_FILE_MANIFEST, TASK0_JOB_FILE_EXPOSURE, TASK0_JOB_FILE_PREVIEW]);
    const unknownEntries = entries.filter((e) => !known.has(e.name) && !pngEntries.includes(e)).map((e) => e.name);
    if (unknownEntries.length) issue(`알 수 없는 항목: ${listHead(unknownEntries)}`);
    // JSON 앞 BOM — 여기서는 TextDecoder 가 지워 읽히지만 Python json.loads(bytes) 는 거부한다
    for (const name of [TASK0_JOB_FILE_MANIFEST, TASK0_JOB_FILE_EXPOSURE]) {
      const d = byName.get(name)?.data;
      if (d && d.length >= 3 && d[0] === 0xef && d[1] === 0xbb && d[2] === 0xbf) issue(`${name} 이 BOM 으로 시작`);
    }

    // run.gcode — Task0 파서 이식판 print 모드 (층두께 비교는 조건 7 몫)
    if (parse) {
      if (parse.warnings.length) issue(`run.gcode 파서(print) 경고 ${parse.warnings.length}건: ${parse.warnings[0]}`);
      if (parse.errors.length) issue(`run.gcode 파서(print) 오류 ${parse.errors.length}건: ${parse.errors[0]}`);
    }
    if (gcodeText !== null && lh !== null) {
      const bad = scanHeightMarkers(gcodeText)
        .map((v, n) => ({ v, n }))
        .filter(({ v }) => v === null || !(Math.abs(v - lh) <= Z_TOL_MM + EPS));
      if (bad.length) issue(`;HEIGHT: ≠ layerHeightMm ${lh} 인 층: ${listHead(bad.map(({ n, v }) => `${n}(${String(v)})`))}`);
    }

    // PNG — 8-bit 회색조로 끝까지 풀리는지 ('header' 면 건너뜀 — 옵션 주석)
    const decodedByName = new Map<string, Task0JobZipPngInfo>();
    for (let i = 0; decodeLayers && i < pngEntries.length; i++) {
      const info = pngs[i];
      try {
        const img = await decodeTask0GrayPng(pngEntries[i].data);
        let white = 0;
        let mid = 0;
        for (const v of img.data) {
          if (v !== 0) white++;
          if (v !== 0 && v !== 255) mid++;
        }
        info.decoded = true;
        info.whitePixels = white;
        info.midPixels = mid;
        decodedByName.set(info.name, info);
      } catch (err) {
        info.decoded = false;
        issue(`${info.name} 8-bit 회색조 PNG 로 풀리지 않음: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 층 ↔ PNG 내용 — 대응이 정해질 때만 (조건 3·4 통과). 'header' 면 풀린 내용이 없으므로 건너뜀
    if (decodeLayers && layerBlocks && cond3ok && cond4ok) {
      const emptyWhite: string[] = [];
      const printedBlack: number[] = [];
      for (const b of layerBlocks) {
        const n = b.layerIndex ?? 0;
        const info = decodedByName.get(task0LayerPngName(n));
        if (!info || info.whitePixels === null) continue;
        if (!b.hasXy && info.whitePixels > 0) emptyWhite.push(`${n}(${info.whitePixels}px)`);
        if (b.hasXy && info.whitePixels === 0) printedBlack.push(n);
      }
      if (emptyWhite.length) issue(`빈 층인데 PNG 에 흰 픽셀: 층 ${listHead(emptyWhite)} (규격 §3 — 전부 검정이어야 함)`);
      if (printedBlack.length) issue(`도포하는 층인데 PNG 흰 픽셀 0: 층 ${listHead(printedBlack)}`);
    }

    // manifest 필드
    if (manifest) {
      if (manifest.format !== TASK0_JOB_FORMAT) issue(`manifest format = ${JSON.stringify(manifest.format)} (≠ ${TASK0_JOB_FORMAT})`);
      if (typeof manifest.generator !== 'string' || manifest.generator === '') issue('manifest generator 없음');
      if (typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) {
        issue(`manifest generatedAt 이 ISO 시각이 아님: ${JSON.stringify(manifest.generatedAt)}`);
      }
      if (lhManifest === null) issue(`manifest layerHeightMm 이 양수가 아님: ${JSON.stringify(manifest.layerHeightMm)}`);
      const proj = asRecord(manifest.projector);
      const off = proj ? proj.offsetMm : undefined;
      if (!proj || !isPositiveNum(proj.pixelPitchUm) || !Array.isArray(off) || off.length !== 2 || !off.every(isFiniteNum)) {
        issue('manifest projector.pixelPitchUm·offsetMm 형식 오류');
      }
      const mats = manifest.materials;
      const toolsDeclared = new Set<string>();
      if (!Array.isArray(mats) || mats.length === 0) issue('manifest materials 가 비었거나 배열이 아님');
      else {
        mats.forEach((raw, i) => {
          const m = asRecord(raw);
          const ok =
            m && typeof m.slot === 'string' && (m.tool === 'T0' || m.tool === 'T1') && typeof m.name === 'string' &&
            isPositiveNum(m.exposureSec) && isFiniteNum(m.bottomExposureSec) && m.bottomExposureSec >= 0 &&
            isPositiveNum(m.retractMm);
          if (!ok) issue(`manifest materials[${i}] 필드 오류`);
          else if (toolsDeclared.has(m.tool as string)) issue(`manifest materials 툴 중복: ${String(m.tool)}`);
          else toolsDeclared.add(m.tool as string);
        });
        if (manifest.dualMaterial !== mats.length > 1) {
          issue(`manifest dualMaterial ${JSON.stringify(manifest.dualMaterial)} ≠ 재료 ${mats.length}개`);
        }
      }
      if (!isNonNegInt(manifest.toolChangeCount)) issue('manifest toolChangeCount 가 0 이상 정수가 아님');
      if (parse) {
        const { changes, tools } = countToolChanges(parse);
        if (isNonNegInt(manifest.toolChangeCount) && manifest.toolChangeCount !== changes) {
          issue(`manifest toolChangeCount ${manifest.toolChangeCount} ≠ run.gcode 툴 전환 ${changes}`);
        }
        const undeclared = [...tools].filter((t) => !toolsDeclared.has(t));
        if (undeclared.length && toolsDeclared.size) issue(`run.gcode 가 쓰는 툴이 materials 에 없음: ${undeclared.join(', ')}`);
      }
      const est = asRecord(manifest.estimate);
      if (!est) issue('manifest estimate 없음');
      else {
        const keys = [...TASK0_ESTIMATE_PARTS, 'totalSec'];
        const badKeys = keys.filter((k) => !isFiniteNum(est[k]) || (est[k] as number) < 0);
        if (badKeys.length) issue(`manifest estimate 필드 오류: ${badKeys.join(', ')}`);
        else {
          const sum = TASK0_ESTIMATE_PARTS.reduce((s, k) => s + (est[k] as number), 0);
          if (Math.abs(sum - (est.totalSec as number)) > ESTIMATE_SUM_TOL_SEC) {
            issue(`manifest estimate totalSec ${String(est.totalSec)} ≠ 7개 합 ${sum}`);
          }
        }
      }
      if (!asRecord(manifest.hints)) issue('manifest hints 없음');
    }

    // exposure 필드
    if (exposure) {
      if (lhExposure === null) issue(`exposure layerHeightMm 이 양수가 아님: ${JSON.stringify(exposure.layerHeightMm)}`);
      else if (lhManifest !== null && Math.abs(lhExposure - lhManifest) > EPS) {
        issue(`exposure layerHeightMm ${lhExposure} ≠ manifest ${lhManifest}`);
      }
      if (!isNonNegInt(exposure.bottomLayerCount) || !isNonNegInt(exposure.transitionLayerCount)) {
        issue('exposure bottomLayerCount·transitionLayerCount 가 0 이상 정수가 아님');
      }
      if (exposureArr) {
        const badIdx = exposureArr.map((v, i) => (isFiniteNum(v) && v >= 0 ? -1 : i)).filter((i) => i >= 0);
        if (badIdx.length) issue(`exposureSecByLayer 값 오류 (0 이상 수가 아님): 층 ${listHead(badIdx)}`);
      }
    }

    // preview
    const pv = byName.get(TASK0_JOB_FILE_PREVIEW);
    if (!pv) issue('preview.png 없음');
    else {
      try {
        const img = await decodeTask0GrayPng(pv.data);
        if (img.width !== TASK0_PREVIEW_WIDTH_PX || img.height !== TASK0_PREVIEW_HEIGHT_PX) {
          issue(`preview.png ${img.width}×${img.height} ≠ ${TASK0_PREVIEW_WIDTH_PX}×${TASK0_PREVIEW_HEIGHT_PX}`);
        }
      } catch (err) {
        issue(`preview.png 8-bit 회색조 PNG 로 풀리지 않음: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const violations = [...new Set(reasons.map((r) => r.condition))].sort((a, b) => a - b);
  return {
    violations,
    reasons,
    extraIssues,
    pass: violations.length === 0 && extraIssues.length === 0,
    entries: entries.map((e) => e.name),
    layerChangeCount: L,
    manifestLayerCount: M,
    pngCount: P,
    exposureLength: exposureArr ? exposureArr.length : null,
    emptyLayers,
    pngs,
    parserWarnings: parse ? parse.warnings : null,
    parserErrors: parse ? parse.errors : null,
  };
}
