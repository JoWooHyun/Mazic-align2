/**
 * Task0 내보내기 코어 (Z2 run.gcode · Z3 job.zip) — 앱 워커와 검증 스크립트가 **같은 함수**를 부른다
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.4 @ 커밋 a4ebc6c (§3·§5·§11·§12·§13 — 파서 v0.2.1 03c0519),
 *   협의 §26-1·§30.
 * 설계: `docs/계획_Z1_task0출력_20261002.md` §4·§4-2 (Z2 인계 — 워커 필수, 채움 실패면 막고 안내 / Z3 인계 — 마스크는 투사
 *   프레임, writer 와 같은 meshes·topY, 층당 PNG 약 20 ms 라 워커·진행 표시, float32 topY 층 수 함정).
 *
 * 앱 경로: workers/slice-batch.worker.ts runTask0Gcode·runTask0JobZip → 이 파일 runTask0GcodeExport·runTask0JobZipExport →
 *   결과를 메인으로 (utils/slice-batch-service.ts exportTask0Gcode·exportTask0JobZip).
 * 검증: scripts/verify-task0-export.mjs — run.gcode 가 scripts/gen-task0-dryrun.mjs 와 같은 입력(파일 A·C·B)에서 **같은 바이트**,
 *   scripts/verify-task0-jobzip-export.mjs — job.zip 이 scripts/gen-task0-sample-zip.mjs 의 sample.job.zip 과 **같은 바이트**.
 *
 * run.gcode 순서 (runTask0GcodeExport):
 *   0. topY 를 1 µm 로 정규화 — task0-frame task0NormalizeTopY (float32 최고점 함정. **이 입구 한 곳**이라 writer·마스크·
 *      manifest 가 같은 값을 받는다. 정확한 topY(파일 A·B·C)는 그대로).
 *   1. 층이 없으면(메시 없음·topY ≤ 0) 막음.
 *   1-b. **출력 가능 영역** — 메시(모델·서포트) 꼭짓점 전부의 베드 bbox(writer 와 같은 worldToBed·베드 값)가 영역
 *      (프로파일 printable, 빠지면 TASK0_DEFAULTS X 10~150 × Y 10~85 — 규격 §1, 경계 포함·허용 1 µm) 밖이면 writer 를
 *      돌리지 않고 막음. Task0 에는 "일부만 잘라 출력" 이 없다 — 투사 밖은 노광되지 않고(writer 커버리지 검사가 엉뚱하게
 *      "채움 실패" 로 막던 경우), 노즐 범위(Y 85) 밖 이동은 Task0(Klipper)가 거부한다(투사 안·노즐 밖 띠는 파일이 나와 버리던 경우).
 *      writer 출력 뒤 G-code XY 범위(totals.xyBounds)도 같은 영역으로 한 번 더 본다(writer 검증 c7 과 같은 역할).
 *   2. generateTask0Gcode(meshes, topY, lh, writer 옵션 + 층 진행 콜백) — 진행 콜백은 출력에 영향 없음.
 *   3. writer 의 채움 실패 층(totals.thinFillFailedLayers)이 있으면 막음 — 층 번호·Z·이유.
 *   4. 같은 텍스트를 Task0 파서 이식판으로 세 모드 파싱 — print(layerHeightMm 지정) → dryrun(E 유지) →
 *      dryrun(E 제거). 경고·오류가 하나라도 있거나 층 수가 writer 와 다르면 막음("내보낼 파일은 경고 0 인 것만").
 *      실출력(job.zip) 기준은 print 모드이고, 11월 데모는 Task0 드라이런 탭에서 돌기 때문에 dryrun 두 모드도
 *      함께 본다(writer 검증 c1 과 같은 세 모드).
 *   5. 통과하면 gcode + 요약(층 수·빈 층·채움 층·길이·예상 시간 — task0-jobzip buildTask0Estimate 재사용).
 *   막을 때는 gcode 를 돌려주지 않는다(null) — 화면에 보일 이유 문장(한국어)만 돌려준다.
 *
 * job.zip 순서 (runTask0JobZipExport) — 0~5 를 그대로 거친다(막히면 그 이유 그대로, 파일 없음):
 *   6. 층마다 같은 meshes·lh·bed 로 task0LayerPolygonsBed → rasterizeTask0Mask(프로파일 투사 프레임, 'full') → 8-bit 회색조 PNG
 *      (task0-jobzip buildTask0LayerImages — 견본 경로 buildTask0JobZip 과 같은 함수).
 *   7. 생성 단계 단언 — PNG 수 = 층 수, **마스크 빈 층 집합(흰 픽셀 0) = G-code 빈 층 집합(XY 이동 없음)**
 *      ("도포 영역 = 노광 영역" 규격 §3 — 노광하는데 레진이 없거나, 도포했는데 노광이 없는 층). 다르면 막음.
 *   8. manifest(노광 = 프로파일, 빠진 값은 types/printer.ts DEFAULT_* — 규칙 6)·exposure·preview·zip 조립
 *      (buildTask0JobFiles·assembleTask0JobZip — 견본 경로와 같은 함수).
 *   9. 자기 검사 verifyTask0JobZip(layerPngs 'header') — 거부 조건 1~7·추가 검사 위반이 하나라도 있으면 막음.
 *      검사 비용: 층 PNG 를 전부 풀면 층당 약 16 ms 가 더 든다 → 내용(빈 층 = 0, 도포 층 > 0)은 7 에서 PNG 의 원본인 마스크로
 *      단언하고, zip 검사는 구조·머리(해상도·IHDR 8-bit 회색조·번호·개수·Z·manifest·exposure·run.gcode 파서·CRC) 위주로, 인코더 왕복은
 *      표본 두 장(첫 도포 층·첫 빈 층)만 풀어 흰 픽셀 수를 맞춰 본다. manifest estimate = 요약 estimate(화면 = 파일)도 본다.
 *   진행 = ('gcode', 층 n/N) → ('png', 층 n/N) → ('verify', 0/1 → 1/1).
 *
 * 2재료 (D1b — 규격서 v0.3.4 §5·§6·§11, 계획 `docs/계획_Z1_task0출력_20261002.md` §4-5 D1b 인계,
 *   `docs/계획_하이브리드슬라이서설정_20260928.md` §5-2·§5-3·§6 결정 5):
 *   입력 materialSlots(메시마다 A/B — 앱은 task0-material task0ExportMaterialSlots: 서포트 = A, STL = 파일의 materialSlot·기본 B)가
 *   있을 때만. 없으면 위 단일 재료 경로를 한 글자도 바꾸지 않는다(파일 A·B·C·견본 바이트 그대로).
 *   1-c. 슬롯 수 = 메시 수, 값은 A/B — 아니면 막음(writer 의 RangeError 대신 이유 문장).
 *   2.  writer 옵션에 dualMaterial { …writer.dualMaterial, slots } (D1a — 층 안 T0 → T1 2패스, 툴별 리트랙트, B 우선 겹침).
 *   3.  writer 'failed' 층은 원인을 갈라 적는다 — 재료 B 가 칠한 A 에 갇힘(층 순서 B → A 는 규격 §6 【미정】 — Task0 답 대기,
 *       협의 §31-4) / 칠한 레진을 가로질러야 하는 항목 / 얇은 부분 채움 실패 (dualFailedLayerIssues).
 *   4-b. 자기 검사(앞 단계가 통과했을 때만): task0-coverage checkTask0DualGcodeCoverage(재료별 (a)(b)(c)(d) — A 영역 = PA − PB,
 *       넘침은 합집합, B 우선) + 트래블 엄격 판정(T 줄을 넘는 전환 트래블 포함 — task0-fill-route task0TravelContactOk, verify c4b 정의).
 *   5.  요약에 dual(툴 전환 수·툴별 도포 길이·슬롯별 메시 수·막지 않는 알림), estimate 툴 전환 시간 = 툴 전환 수 × 0.5 s(규격 §13).
 *   7.  빈 층 대조는 그대로 — G-code 빈 층(두 툴 모두 XY 이동 없음)과 합집합 마스크(모든 메시 — 층 PNG 는 PA ∪ PB 한 장)를 맞댄다.
 *   8.  manifest materials 2개(A = T0 TASK0_DEFAULT_MATERIAL_NAME, B = T1 TASK0_DEFAULT_MATERIAL_NAME_B)·dualMaterial true·
 *       toolChangeCount = writer 툴 전환 수, 층 노광 = 재료별 큰 값(task0-jobzip buildTask0MaterialExposure — 지금은 한 프로파일이라 같다).
 *   9.  자기 검사 verifyTask0JobZip 은 그대로 — manifest toolChangeCount = run.gcode 툴 전환 수, materials 툴 = G-code 가 쓰는 툴을 본다.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음(Web Worker·tsx 공통 — performance.now 만).
 */
import { checkTask0DualGcodeCoverage, type Task0DualCoverageReport } from './task0-coverage';
import { task0TravelContactOk, type Task0UmSegment } from './task0-fill-route';
import {
  TASK0_DEFAULTS,
  task0LayerCount,
  task0LayerZ,
  task0NormalizeTopY,
  worldToBed,
  type Task0PrintableFrame,
} from './task0-frame';
import { parseGcodeText, type Task0ParseOptions } from './task0-gcode-parser';
import {
  generateTask0Gcode,
  resolveTask0WriterParams,
  type Task0GcodeResult,
  type Task0WriterOptions,
} from './task0-gcode-writer';
import {
  TASK0_JOB_CONDITION_LABELS,
  TASK0_JOB_GENERATOR,
  assembleTask0JobZip,
  buildTask0Estimate,
  buildTask0JobFiles,
  buildTask0LayerImages,
  task0JobMaterialExposure,
  verifyTask0JobZip,
  type Task0Estimate,
  type Task0ExposureSettings,
} from './task0-jobzip';
import type { Task0RasterFrame } from './task0-mask';
import { decodeTask0GrayPng } from './task0-png';
import { task0LayerPolygonsBed, task0SplitMeshesBySlot, type Task0MaterialSlot } from './task0-slice';
import type { Task0UmPoint } from './task0-thin-fill';

// ==================== 타입 ====================

/** 워커 메시지로 넘길 수 있는 writer 옵션 — 진행 콜백(함수)은 빼고, 워커가 붙인다 */
export type Task0ExportWriterOptions = Omit<Task0WriterOptions, 'onLayerDone'>;

export interface Task0ExportInput {
  /** 메시별 world 삼각형 (감김 통일 — extractWorldTriangles 결과, 서포트 포함). 읽기만 한다 */
  meshes: readonly Float32Array[];
  /**
   * 서포트 포함 최고점 (mm, 플레이트 0 기준) — 마스크 경로와 같은 값(handle.getSceneTopY).
   * 코어 입구에서 1 µm 로 정규화한다(task0NormalizeTopY — float32 꼭짓점 함정).
   */
  topY: number;
  /** 층두께 (mm) */
  layerHeightMm: number;
  /** writer 옵션 (프로파일에서 — task0-profile task0WriterOptionsForProfile). 빠진 값은 TASK0_DEFAULTS */
  writer?: Task0ExportWriterOptions;
  /** 예상 시간의 노광 항목(job.zip 은 manifest·exposure.json 도)용 — 빠진 값은 types/printer.ts DEFAULT_* (규칙 6) */
  exposure?: Task0ExposureSettings;
  /**
   * 출력 가능 영역 (베드 mm — 프로파일, task0-profile task0PrintableFrameForProfile). 빠지면 TASK0_DEFAULTS (규칙 6).
   * 모델·서포트가 이 밖에 있으면 writer 를 돌리지 않고 막는다(머리 주석 1-b).
   */
  printable?: Task0PrintableFrame;
  /**
   * 2재료 (D1b — 머리 주석 "2재료") — 메시마다 재료 슬롯(meshes 와 같은 길이·순서, A = T0, B = T1). 있으면 writer dualMaterial
   * 로 층 안 T0 → T1 2패스 + 2재료 자기 검사, 없으면 단일 재료 경로 그대로(바이트 불변). 앱은 task0-material
   * task0ExportMaterialSlots(재료 모드 2재료일 때만 — 서포트 = A, STL = 파일의 materialSlot, 기본 B).
   */
  materialSlots?: readonly Task0MaterialSlot[];
  /**
   * (2재료) 재료 B 노광 — 빠지면 exposure 와 같은 값(지금 앱은 한 프로파일이라 늘 같다). 층당 노광 = 재료별 큰 값
   * (task0-jobzip buildTask0MaterialExposure — 규격 §6), 값이 다르면 요약 dual.warnings 에 경고.
   */
  exposureB?: Task0ExposureSettings;
}

/** 2재료 요약 (D1b) — 길이 mm */
export interface Task0DualExportSummary {
  /** 툴 전환 수 = 층 블록 안 T 줄 수 (manifest toolChangeCount 와 같은 값) */
  toolChanges: number;
  /** 툴별 도포 길이 — [T0 = 재료 A, T1 = 재료 B] */
  depositMmByTool: [number, number];
  /** 슬롯별 메시 수 (서포트 포함 — 서포트는 A) */
  meshCount: Record<Task0MaterialSlot, number>;
  /** 막지 않는 알림 — 재료별 노광이 달라 큰 값을 쓴 경우(규격 §6), 한 재료의 도포가 없는 경우 */
  warnings: string[];
}

/** 내보내기 요약 — 길이 mm, 시간 s */
export interface Task0ExportSummary {
  layerCount: number;
  layerHeightMm: number;
  /** 빈 층 수 (XY 이동 없음 — Task0 가 파킹·블레이드·LED 를 생략) */
  emptyLayerCount: number;
  /** 얇은 부분 채움이 들어간 층 수 */
  thinFillLayerCount: number;
  /** 채움 후에도 커버리지 실패인 층 (0-based) — 비어 있어야 파일을 낸다 */
  thinFillFailedLayers: number[];
  depositMm: number;
  travelMm: number;
  /** E−r 줄 수 */
  retracts: number;
  /** 파일 줄 수 */
  lineCount: number;
  /** 규격 §11·§13 estimate 8필드 (s) — 툴 전환 시간 = 툴 전환 수 × 0.5 s (단일 재료 0) */
  estimate: Task0Estimate;
  /** 2재료 요약 (D1b) — 단일 재료면 null */
  dual: Task0DualExportSummary | null;
}

/** 파서 검사 한 모드의 결과 */
export interface Task0ExportParserCheck {
  /** 'print(lh=…)' · 'dryrun(keepE=true)' · 'dryrun(keepE=false)' */
  label: string;
  warnings: string[];
  errors: string[];
  layerCount: number;
}

export type Task0ExportResult =
  | {
      ok: true;
      gcode: string;
      summary: Task0ExportSummary;
      parser: Task0ExportParserCheck[];
    }
  | {
      ok: false;
      /** 막았으므로 항상 null — 파일을 돌려주지 않는다 */
      gcode: null;
      /** 화면에 보일 이유 (한국어, 층 번호는 0-based — 슬라이스 미리보기 층 번호와 같음) */
      issues: string[];
      /** 문제가 난 층 (0-based, 오름차순 — 채움 실패 층, 2재료면 자기 검사(커버리지·B 우선·트래블)에 걸린 층도) */
      failedLayers: number[];
      /** writer 를 돌렸으면 요약, 돌리지 않았으면(층 없음·출력 가능 영역 밖) null */
      summary: Task0ExportSummary | null;
      parser: Task0ExportParserCheck[];
    };

/** job.zip 진행 단계 — G-code 생성 / 층 마스크·PNG / 묶기·자기 검사 */
export type Task0JobStage = 'gcode' | 'png' | 'verify';

export interface Task0JobZipExportInput extends Task0ExportInput {
  /** 층 마스크 투사 프레임 (프로파일 — task0-profile resolveTask0ProfileFrame). 빠지면 TASK0_DEFAULTS */
  frame?: Task0RasterFrame;
  /** 재료 A(T0) 이름 — 빠지면 task0-jobzip TASK0_DEFAULT_MATERIAL_NAME */
  materialName?: string;
  /** (2재료) 재료 B(T1) 이름 — 빠지면 task0-jobzip TASK0_DEFAULT_MATERIAL_NAME_B */
  materialNameB?: string;
  /** manifest.generator — 빠지면 task0-jobzip TASK0_JOB_GENERATOR(견본 값). 앱은 TASK0_APP_JOB_GENERATOR */
  generator?: string;
  /** manifest.generatedAt (ISO 8601) — 빠지면 지금 시각. 같은 바이트가 필요한 검증만 고정값을 준다 */
  generatedAt?: string;
}

/** job.zip 요약 — 성공 화면·검증용 (바이트 수 B, 시간 ms) */
export interface Task0JobZipSummary {
  /** zip 크기 */
  zipBytes: number;
  /** layers/*.png 수 (= 층 수) */
  pngCount: number;
  /** 층 PNG 바이트 합 */
  pngBytes: number;
  /** 흰 픽셀 0 인 층 수 — G-code 빈 층 수와 같다(7 에서 집합으로 확인) */
  emptyMaskLayerCount: number;
  /** 단면 안이지만 투사 프레임 밖이라 잘린 픽셀 중심 수 (전 층 합) — 0 이 아니면 그만큼 노광되지 않는다 */
  clippedPixels: number;
  /** manifest.generator 그대로 */
  generator: string;
  /** 단계별 걸린 시간 (참고용 — 산출물과 무관) */
  stageMs: Record<Task0JobStage, number>;
}

export type Task0JobZipExportResult =
  | {
      ok: true;
      /** job.zip 바이트 (무압축 zip — application/zip). 워커가 buffer 를 transfer 한다 */
      zip: Uint8Array<ArrayBuffer>;
      summary: Task0ExportSummary;
      job: Task0JobZipSummary;
      parser: Task0ExportParserCheck[];
    }
  | {
      ok: false;
      /** 막았으므로 항상 null */
      zip: null;
      issues: string[];
      /** 문제가 난 층 (0-based, 오름차순 — 채움 실패 층·빈 층 불일치 층) */
      failedLayers: number[];
      summary: Task0ExportSummary | null;
      /** 층 이미지까지 만들었으면 요약, 그 전에 막혔으면 null */
      job: Task0JobZipSummary | null;
      parser: Task0ExportParserCheck[];
    };

/**
 * 화면에 남기는 마지막 내보내기 결과 (앱 — useSliceExport 상태, 슬라이스 패널 표시).
 *   ok: 내려받은 파일 이름 + 요약(job.zip 이면 zip 요약도) / 막힘: 이유 문장들(층 번호·문구).
 */
export type Task0ExportReport =
  | { ok: true; kind: 'gcode'; fileName: string; summary: Task0ExportSummary }
  | { ok: true; kind: 'jobzip'; fileName: string; summary: Task0ExportSummary; job: Task0JobZipSummary }
  | { ok: false; kind: 'gcode' | 'jobzip'; issues: string[] };

/** 결과를 메인에 보일 때 줄이는 개수 — 층 번호 목록·파서 경고 */
export const TASK0_EXPORT_MAX_LISTED = 8;

/**
 * 앱이 만든 job.zip 의 manifest.generator (규격 §11 "MazicAlign v2 <버전>").
 * 빌드 때 앱 버전을 넣는 장치가 없고(package.json version 1.0.0 은 v1 시절 값 그대로, 릴리스는 git 태그로 붙인다),
 * Task0 는 이 값을 읽지 않는다(§11 "Task0가 읽는 것" 목록에 없음) → 출력 단계(Z3)와 규격판을 적는다.
 * 견본 경로(gen-task0-sample-zip)는 task0-jobzip TASK0_JOB_GENERATOR 를 그대로 쓴다 — 두 zip 은 manifest 의 이 글자만 다르다.
 */
export const TASK0_APP_JOB_GENERATOR = 'MazicAlign v2 Z3 app export (Task0 spec v0.3.4)';

// ==================== 본체 ====================

/** 소수 자리 고정 후 끝 0 정리 (Z 표시용) */
function trimNum(v: number, decimals: number): string {
  let s = v.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** 파서 세 모드 — print 가 실출력(job.zip) 기준, dryrun 둘은 Task0 드라이런 탭 */
function parserModes(lh: number): { label: string; opt: Task0ParseOptions }[] {
  return [
    { label: `print(lh=${trimNum(lh, 6)})`, opt: { mode: 'print', layerHeightMm: lh } },
    { label: 'dryrun(keepE=true)', opt: { mode: 'dryrun', keepE: true } },
    { label: 'dryrun(keepE=false)', opt: { mode: 'dryrun', keepE: false } },
  ];
}

/** 출력 가능 영역 판정 허용 오차 (mm) — 1 µm (writer 좌표 격자와 같은 단위). 경계 위는 안 */
const AREA_TOL_MM = 0.001;

/** 베드 좌표 사각 범위 (mm) */
interface BedBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * 메시 꼭짓점 전부의 베드 bbox — writer 와 같은 worldToBed·베드 값. world (X, Z) 최소·최대를 먼저 구한 뒤 두 모서리만
 * 옮긴다(worldToBed 는 상수를 더하는 평행 이동이라 결과가 같다). 꼭짓점이 없으면 null.
 */
function meshesBedBox(meshes: readonly Float32Array[], bedWidthMm: number, bedDepthMm: number): BedBox | null {
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const tris of meshes) {
    for (let i = 0; i + 2 < tris.length; i += 3) {
      const x = tris[i];
      const z = tris[i + 2];
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
  }
  if (xMin === Infinity) return null;
  const [bx0, by0] = worldToBed(xMin, zMin, bedWidthMm, bedDepthMm);
  const [bx1, by1] = worldToBed(xMax, zMax, bedWidthMm, bedDepthMm);
  return { xMin: bx0, xMax: bx1, yMin: by0, yMax: by1 };
}

/**
 * 베드 범위가 출력 가능 영역(경계 포함, 허용 1 µm) 밖이면 어긴 쪽 목록, 안이면 빈 목록.
 * 사전 검사(메시)·사후 검사(G-code XY)가 같은 함수를 쓴다.
 */
function areaExcess(box: BedBox, area: Task0PrintableFrame): string[] {
  const out: string[] = [];
  if (box.xMin < area.printableXMinMm - AREA_TOL_MM) out.push(`X 최소 ${trimNum(box.xMin, 3)} < ${trimNum(area.printableXMinMm, 3)}`);
  if (box.xMax > area.printableXMaxMm + AREA_TOL_MM) out.push(`X 최대 ${trimNum(box.xMax, 3)} > ${trimNum(area.printableXMaxMm, 3)}`);
  if (box.yMin < area.printableYMinMm - AREA_TOL_MM) out.push(`Y 최소 ${trimNum(box.yMin, 3)} < ${trimNum(area.printableYMinMm, 3)}`);
  if (box.yMax > area.printableYMaxMm + AREA_TOL_MM) out.push(`Y 최대 ${trimNum(box.yMax, 3)} > ${trimNum(area.printableYMaxMm, 3)}`);
  return out;
}

/** "X 10~150 × Y 10~85 mm" */
function areaText(area: Task0PrintableFrame): string {
  return (
    `X ${trimNum(area.printableXMinMm, 3)}~${trimNum(area.printableXMaxMm, 3)} × ` +
    `Y ${trimNum(area.printableYMinMm, 3)}~${trimNum(area.printableYMaxMm, 3)} mm`
  );
}

/** "X 75~85, Y 82.5~87.5 mm" */
function boxText(box: BedBox): string {
  return `X ${trimNum(box.xMin, 3)}~${trimNum(box.xMax, 3)}, Y ${trimNum(box.yMin, 3)}~${trimNum(box.yMax, 3)} mm`;
}

// ==================== 2재료 (D1b) ====================

/** 2재료 슬롯 — 입력 materialSlots(앱), 없으면 writer.dualMaterial.slots(실험·대조군), 둘 다 없으면 null(단일 재료) */
function dualSlotsOf(input: Task0ExportInput): readonly Task0MaterialSlot[] | null {
  return input.materialSlots ?? input.writer?.dualMaterial?.slots ?? null;
}

/** 슬롯 배열 검사 — writer 가 RangeError 로 멈추기 전에 화면 이유로 막는다. 문제 없으면 null */
function slotsIssue(slots: readonly Task0MaterialSlot[], meshCount: number): string | null {
  if (slots.length !== meshCount) {
    return `재료 슬롯 수 ${slots.length} ≠ 메시 수 ${meshCount} — 2재료 배정을 만들 수 없습니다(앱 배선 오류). 다시 시도해 보세요.`;
  }
  const bad = slots.findIndex((s) => s !== 'A' && s !== 'B');
  return bad >= 0 ? `재료 슬롯은 A 또는 B 여야 합니다 (메시 ${bad}: ${String(slots[bad])}).` : null;
}

/** 2재료 요약 — writer 툴별 합계·슬롯별 메시 수 + 막지 않는 알림(노광 큰 값, 한 재료 도포 없음) */
function dualSummaryOf(
  gen: Task0GcodeResult,
  slots: readonly Task0MaterialSlot[],
  exposureWarnings: readonly string[],
): Task0DualExportSummary {
  const t = gen.totals;
  const depositMmByTool: [number, number] = [t.byTool[0]?.depositMm ?? 0, t.byTool[1]?.depositMm ?? 0];
  const meshCount: Record<Task0MaterialSlot, number> = { A: 0, B: 0 };
  for (const s of slots) meshCount[s]++;
  const warnings = [...exposureWarnings];
  for (const [i, slot] of (['A', 'B'] as const).entries()) {
    if ((t.byTool[i]?.segments ?? 0) === 0) {
      warnings.push(
        `재료 ${slot}(T${i}) 도포가 없습니다(${slot} 메시 ${meshCount[slot]}개) — manifest 에는 두 재료가 그대로 적힙니다(2재료 모드). ` +
          '한 재료만 쓰려면 재료 모드를 단일로 바꾸세요.',
      );
    }
  }
  return { toolChanges: t.toolChanges, depositMmByTool, meshCount, warnings };
}

/** "층 0 (Z 0.1 mm), 층 1 (Z 0.2 mm) 외 n개 층" — 층 번호 0-based */
function listLayersZ(layers: readonly number[], lh: number): string {
  const listed = layers.slice(0, TASK0_EXPORT_MAX_LISTED).map((n) => `층 ${n} (Z ${trimNum(task0LayerZ(n, lh), 6)} mm)`);
  const more = layers.length > TASK0_EXPORT_MAX_LISTED ? ` 외 ${layers.length - TASK0_EXPORT_MAX_LISTED}개 층` : '';
  return `${listed.join(', ')}${more}`;
}

/**
 * writer 가 'failed' 로 남긴 층의 이유 (2재료) — 층 통계와 그 층의 재료별 단면 유무로 가른다(writer 통계에 실패한 패스 번호가
 * 없어서 — 툴별 도포 줄 수·경로 없는 항목 수로 판단):
 *   ① 두 재료가 다 있고 경로 없는 항목이 있는데 T1 도포가 0 = 재료 B 가 칠한 A 에 둘러싸여 T1 로 들어갈 길이 없다
 *      (층 안 순서 A → B — 그 층만 B → A 로 내는 것은 규격 §6 【미정】, Task0 답 대기 — 협의 §31-4).
 *      writer 순서 옵션이 기본(A → B, 뒤집기 끔)일 때만 이렇게 읽는다 — 실험 옵션(order 'BA'·flipOrderWhenStuck)이면 ②.
 *   ② 두 재료가 다 있고 경로 없는 항목이 있다(일부는 도포) = 칠한 레진을 가로지르지 않고는 갈 수 없는 항목.
 *   ③ 그 밖(한 재료만 있는 층, 경로는 있는데 채움 뒤 커버리지 실패) = 단일 재료와 같은 "얇은 부분 채움 실패".
 */
function dualFailedLayerIssues(
  gen: Task0GcodeResult,
  failed: readonly number[],
  meshes: readonly Float32Array[],
  slots: readonly Task0MaterialSlot[],
  lh: number,
  writer: Task0ExportWriterOptions | undefined,
): string[] {
  const split = task0SplitMeshesBySlot(meshes, slots);
  const { bedWidthMm, bedDepthMm } = gen.params;
  const abOrder = (writer?.dualMaterial?.order ?? 'AB') === 'AB' && !writer?.dualMaterial?.flipOrderWhenStuck;
  const trapped: number[] = [];
  const blocked: number[] = [];
  const thin: number[] = [];
  let blockedItems = 0;
  for (const n of failed) {
    const s = gen.layers[n];
    const hasA = task0LayerPolygonsBed(split.A, n, lh, bedWidthMm, bedDepthMm).length > 0;
    const hasB = task0LayerPolygonsBed(split.B, n, lh, bedWidthMm, bedDepthMm).length > 0;
    const interlocked = hasA && hasB && s.unreachable > 0;
    if (!interlocked) thin.push(n);
    else if (abOrder && s.byTool[1].segments === 0) trapped.push(n);
    else {
      blocked.push(n);
      blockedItems += s.unreachable;
    }
  }
  const out: string[] = [];
  if (trapped.length > 0) {
    out.push(
      `재료 B(T1)가 재료 A(T0)에 둘러싸여 T1 로 들어갈 길이 없는 층 ${trapped.length}개: ${listLayersZ(trapped, lh)} — ` +
        '층 안 순서 A → B 에서는 칠한 A 를 가로질러야 합니다(규격 §7 교차 금지). 그 층만 B → A 로 내는 것은 규격 §6 【미정】이라 ' +
        'Task0 답을 기다리는 중입니다(협의 §31-4). 재료 배정(A/B)이나 모델 배치를 바꿔 보세요.',
    );
  }
  if (blocked.length > 0) {
    out.push(
      `두 재료가 맞물린 단면에서 칠한 레진을 가로지르지 않고는 갈 수 없는 도포 항목 ${blockedItems}개가 남은 층 ${blocked.length}개: ` +
        `${listLayersZ(blocked, lh)} — 재료 배정(A/B)이나 모델 배치를 바꿔 보세요(규격 §7 교차 금지).`,
    );
  }
  if (thin.length > 0) {
    out.push(
      `얇은 부분 채움 실패 ${thin.length}개 층: ${listLayersZ(thin, lh)} — ` +
        '노즐이 방금 칠한 비드 사이에 갇히는 단면이라 도포 경로가 노광 영역을 다 덮지 못합니다(규격 §3 커버리지). ' +
        '모델 배치·방향이나 층 두께를 바꿔 보세요.',
    );
  }
  return out;
}

/** 재료별 커버리지 검사 이름 (task0-coverage — 규격 §3) */
const COVERAGE_CHECK_LABELS: readonly ['a' | 'b' | 'c' | 'd' | 'overflow', string][] = [
  ['a', '(a) 덮임 비율'],
  ['b', '(b) 도포 없는 섬'],
  ['c', '(c) 안쪽 덮이지 않은 곳'],
  ['d', '(d) 덮이지 않은 곳'],
  ['overflow', '넘침'],
];

/** 소수 자리 고정 µm 좌표 → 정수 µm (writer 출력은 X/Y 소수 3자리라 정확) */
const toUm = (mm: number): number => Math.round(mm * 1000);

/**
 * 트래블 엄격 판정 (2재료 자기 검사) — 층마다 그 층에서 이미 칠한 선분(모든 툴, 정수 µm)과 트래블 경로(연속한 XY 이동 줄 —
 * T 줄·E 단독 줄은 경로를 끊지 않는다)를 task0-fill-route task0TravelContactOk(= verify-task0-writer c4b 정의 — 교차·
 * 경유점 접촉·되짚기 외 겹침 금지)로 본다. 층 시작 위치 = 파킹(규격 §9). 도포 = X/Y 와 E 가 같이 있는 줄.
 * @returns 위반이 있는 층과 건수 (층 번호 오름차순)
 */
function travelContactViolations(gcode: string, parkUm: Task0UmPoint): { layer: number; count: number }[] {
  const out: { layer: number; count: number }[] = [];
  let started = false;
  let layer = -1;
  let pos: Task0UmPoint = parkUm;
  let painted: Task0UmSegment[] = [];
  let path: Task0UmPoint[] | null = null;
  let count = 0;
  const flush = (): void => {
    if (path !== null && !task0TravelContactOk(path, painted, painted.length - 1)) count++;
    path = null;
  };
  const endLayer = (): void => {
    flush();
    if (layer >= 0 && count > 0) out.push({ layer, count });
  };
  for (const raw of gcode.split('\n')) {
    const line = raw.trim();
    if (!started) {
      started = line === '; EXECUTABLE_BLOCK_START';
      continue;
    }
    if (line === ';LAYER_CHANGE') {
      endLayer();
      layer++;
      pos = parkUm;
      painted = [];
      path = null;
      count = 0;
      continue;
    }
    if (line === '' || line.startsWith(';') || layer < 0) continue;
    const toks = line.split(/\s+/);
    const cmd = toks[0].toUpperCase();
    if (cmd !== 'G0' && cmd !== 'G1') continue;
    let x: number | null = null;
    let y: number | null = null;
    let hasE = false;
    for (const t of toks.slice(1)) {
      const k = t[0].toUpperCase();
      if (k === 'X') x = toUm(Number(t.slice(1)));
      else if (k === 'Y') y = toUm(Number(t.slice(1)));
      else if (k === 'E') hasE = true;
    }
    if (x === null && y === null) continue; // Z·E 단독·F 단독 — 경로를 끊지 않는다
    const to: Task0UmPoint = [x ?? pos[0], y ?? pos[1]];
    if (hasE) {
      flush();
      painted.push([pos, to]);
    } else {
      if (path === null) path = [pos];
      path.push(to);
    }
    pos = to;
  }
  endLayer();
  return out;
}

/**
 * 2재료 자기 검사 (D1b — 머리 주석 4-b): 재료별 커버리지·B 우선(checkTask0DualGcodeCoverage) + 트래블 엄격 판정.
 * writer 가 지키는 불변식을 산출물 텍스트로 다시 본다 — 하나라도 어긋나면 파일을 내지 않는다.
 */
function dualSelfCheck(
  input: Task0ExportInput,
  slots: readonly Task0MaterialSlot[],
  topY: number,
  lh: number,
  gen: Task0GcodeResult,
): { issues: string[]; failedLayers: number[]; coverage: Task0DualCoverageReport } {
  const p = gen.params;
  const cov = checkTask0DualGcodeCoverage(input.meshes, slots, topY, lh, gen.gcode, {
    depositWidthMm: p.depositWidthMm,
    bedWidthMm: p.bedWidthMm,
    bedDepthMm: p.bedDepthMm,
    parkXMm: p.parkXMm,
    parkYMm: p.parkYMm,
  });
  const issues: string[] = [];
  const failedLayers = new Set<number>();
  if (cov.gcodeLayerCount !== cov.expectedLayerCount) {
    issues.push(`2재료 검사 — G-code 층 ${cov.gcodeLayerCount} ≠ 기대 층 ${cov.expectedLayerCount}`);
  }
  if (cov.preambleSegments > 0) issues.push(`2재료 검사 — 층 밖(프리앰블)에 도포 ${cov.preambleSegments}줄`);
  const covFailed = cov.layers.filter((l) => !l.A.pass || !l.B.pass);
  if (covFailed.length > 0) {
    const listed = covFailed.slice(0, TASK0_EXPORT_MAX_LISTED).map((l) => {
      const what = (['A', 'B'] as const)
        .map((m) => {
          const bad = COVERAGE_CHECK_LABELS.filter(([k]) => !l[m][k].pass).map(([, label]) => label);
          return bad.length > 0 ? `재료 ${m}: ${bad.join('·')}` : '';
        })
        .filter((s) => s !== '')
        .join(' / ');
      return `층 ${l.index} (${what})`;
    });
    const more = covFailed.length > TASK0_EXPORT_MAX_LISTED ? ` 외 ${covFailed.length - TASK0_EXPORT_MAX_LISTED}개 층` : '';
    issues.push(
      `2재료 커버리지 실패 ${covFailed.length}개 층: ${listed.join(', ')}${more} — 재료별 도포 경로가 그 재료의 노광 영역을 ` +
        '다 덮지 못하거나 넘칩니다(규격 §3, 겹친 곳은 B 영역).',
    );
    for (const l of covFailed) failedLayers.add(l.index);
  }
  if (cov.overlapLayers.length > 0) {
    issues.push(
      `B 우선 위반 ${cov.overlapLayers.length}개 층: 층 ${cov.overlapLayers.slice(0, TASK0_EXPORT_MAX_LISTED).join(', ')}` +
        `${cov.overlapLayers.length > TASK0_EXPORT_MAX_LISTED ? ' 외' : ''} — 재료 A(T0) 도포가 재료 B 단면 안쪽으로 최대 ` +
        `${trimNum(cov.overlapMaxDepthMm, 3)} mm 들어갑니다(겹친 곳은 B 만 칠한다 — 계획 §5-3).`,
    );
    for (const n of cov.overlapLayers) failedLayers.add(n);
  }
  const travel = travelContactViolations(gen.gcode, [toUm(p.parkXMm), toUm(p.parkYMm)]);
  if (travel.length > 0) {
    const total = travel.reduce((s, v) => s + v.count, 0);
    issues.push(
      `트래블이 칠한 레진을 가로지르거나 스치는 곳 ${total}건 — 층 ${travel
        .slice(0, TASK0_EXPORT_MAX_LISTED)
        .map((v) => v.layer)
        .join(', ')}${travel.length > TASK0_EXPORT_MAX_LISTED ? ' 외' : ''} (규격 §7 — 도포한 영역을 가로지르는 트래블 금지).`,
    );
    for (const v of travel) failedLayers.add(v.layer);
  }
  return { issues, failedLayers: [...failedLayers].sort((a, b) => a - b), coverage: cov };
}

/** G-code 단계 결과 — 공개 결과 + (job.zip 이 이어 쓰는) writer 결과 */
interface GcodeStage {
  out: Task0ExportResult;
  /** writer 결과 — 층이 없어 writer 를 돌리지 않았으면 null */
  gen: Task0GcodeResult | null;
}

/** run.gcode 단계 (머리 주석 0~5) — runTask0GcodeExport·runTask0JobZipExport 공통 */
function exportGcodeStage(
  input: Task0ExportInput,
  onLayerDone?: (done: number, total: number) => void,
): GcodeStage {
  const lh = input.layerHeightMm;
  // (0) float32 최고점 함정 — 정규화는 여기 한 곳 (task0-frame task0NormalizeTopY 주석)
  const topY = task0NormalizeTopY(input.topY);
  const layerCountExpected = Number.isFinite(lh) && lh > 0 ? task0LayerCount(topY, lh) : 0;
  if (input.meshes.length === 0 || layerCountExpected === 0) {
    return {
      out: {
        ok: false,
        gcode: null,
        issues: ['슬라이스할 층이 없습니다 — 모델이 플레이트 위에 있는지 확인하세요.'],
        failedLayers: [],
        summary: null,
        parser: [],
      },
      gen: null,
    };
  }

  // (1-b) 출력 가능 영역 — writer 전에 막는다 (머리 주석 1-b). 베드 값은 writer 가 쓸 값 그대로
  const area = input.printable ?? TASK0_DEFAULTS;
  const params = resolveTask0WriterParams(input.writer ?? {});
  const meshBox = meshesBedBox(input.meshes, params.bedWidthMm, params.bedDepthMm);
  const meshExcess = meshBox ? areaExcess(meshBox, area) : [];
  if (meshBox && meshExcess.length > 0) {
    return {
      out: {
        ok: false,
        gcode: null,
        issues: [
          `출력 가능 영역(${areaText(area)}) 밖에 모델·서포트가 있습니다 — 베드 ${boxText(meshBox)} ` +
            `(${meshExcess.join(', ')}). 영역 안으로 옮기세요. ` +
            '(투사 밖은 노광되지 않고, 노즐 범위 밖 이동은 Task0 가 거부합니다 — 규격 §1)',
        ],
        failedLayers: [],
        summary: null,
        parser: [],
      },
      gen: null,
    };
  }

  // (1-c) 2재료 슬롯 — 메시 수·값 검사 (writer 의 RangeError 대신 화면 이유로)
  const dualSlots = dualSlotsOf(input);
  const slotProblem = dualSlots === null ? null : slotsIssue(dualSlots, input.meshes.length);
  if (slotProblem !== null) {
    return {
      out: { ok: false, gcode: null, issues: [slotProblem], failedLayers: [], summary: null, parser: [] },
      gen: null,
    };
  }

  // (2) writer — 단일 재료는 지금 호출 그대로(바이트 불변), 2재료는 dualMaterial(슬롯 + writer 옵션의 나머지 2재료 값)
  const result =
    dualSlots === null
      ? generateTask0Gcode(input.meshes, topY, lh, { ...input.writer, onLayerDone })
      : generateTask0Gcode(input.meshes, topY, lh, {
          ...input.writer,
          dualMaterial: { ...input.writer?.dualMaterial, slots: dualSlots },
          onLayerDone,
        });
  const t = result.totals;
  // 층 노광 — 2재료면 재료별 큰 값(규격 §6). job.zip 의 buildTask0JobFiles 와 같은 함수라 요약 estimate = 파일 estimate
  const mat = task0JobMaterialExposure(result, lh, input.exposure ?? {}, input.exposureB);
  const summary: Task0ExportSummary = {
    layerCount: t.layerCount,
    layerHeightMm: lh,
    emptyLayerCount: t.emptyLayers.length,
    thinFillLayerCount: t.thinFillLayers.length,
    thinFillFailedLayers: [...t.thinFillFailedLayers],
    depositMm: t.depositMm,
    travelMm: t.travelMm,
    retracts: t.retracts,
    lineCount: t.lineCount,
    estimate: buildTask0Estimate(result.layers, result.params, mat.exposure.exposureSecByLayer, {
      toolChangeCount: t.toolChanges,
    }),
    dual: dualSlots === null ? null : dualSummaryOf(result, dualSlots, mat.warnings),
  };

  const issues: string[] = [];
  // (3) 채움 실패 — 노즐이 이미 칠한 비드에 갇히는 퇴화 단면 등 (계획서 §4-2). 2재료는 원인을 갈라 적는다(갇힌 B 등)
  const failed = t.thinFillFailedLayers;
  if (failed.length > 0) {
    if (dualSlots !== null) {
      issues.push(...dualFailedLayerIssues(result, failed, input.meshes, dualSlots, lh, input.writer));
    } else {
      const zDecimals = 6;
      const listed = failed
        .slice(0, TASK0_EXPORT_MAX_LISTED)
        .map((n) => `층 ${n} (Z ${trimNum(task0LayerZ(n, lh), zDecimals)} mm)`);
      const more = failed.length > TASK0_EXPORT_MAX_LISTED ? ` 외 ${failed.length - TASK0_EXPORT_MAX_LISTED}개 층` : '';
      issues.push(
        `얇은 부분 채움 실패 ${failed.length}개 층: ${listed.join(', ')}${more} — ` +
          '노즐이 방금 칠한 비드 사이에 갇히는 단면이라 도포 경로가 노광 영역을 다 덮지 못합니다(규격 §3 커버리지). ' +
          '모델 배치·방향이나 층 두께를 바꿔 보세요.',
      );
    }
  }

  // (1-b 사후) writer 가 낸 XY 좌표 범위도 출력 가능 영역 안 (writer 검증 c7 과 같은 역할 — 우회 트래블 등)
  const xyExcess = t.xyBounds ? areaExcess(t.xyBounds, area) : [];
  if (t.xyBounds && xyExcess.length > 0) {
    issues.push(
      `G-code 이동 좌표가 출력 가능 영역(${areaText(area)}) 밖입니다 — ${boxText(t.xyBounds)} (${xyExcess.join(', ')}). ` +
        'Task0 가 노즐 범위 밖 이동을 거부합니다.',
    );
  }

  // (4) Task0 파서 이식판 — 세 모드 경고·오류 0, 층 수 일치
  const parser: Task0ExportParserCheck[] = [];
  for (const { label, opt } of parserModes(lh)) {
    const r = parseGcodeText(result.gcode, opt);
    parser.push({ label, warnings: r.warnings, errors: r.errors, layerCount: r.layerCount });
    const msgs = [...r.errors.map((e) => `오류: ${e}`), ...r.warnings.map((w) => `경고: ${w}`)];
    for (const m of msgs.slice(0, TASK0_EXPORT_MAX_LISTED)) issues.push(`Task0 파서 ${label} ${m}`);
    if (msgs.length > TASK0_EXPORT_MAX_LISTED) {
      issues.push(`Task0 파서 ${label} 경고·오류 외 ${msgs.length - TASK0_EXPORT_MAX_LISTED}건`);
    }
    if (r.layerCount !== t.layerCount) {
      issues.push(`Task0 파서 ${label} 층 수 ${r.layerCount} ≠ writer 층 수 ${t.layerCount}`);
    }
  }

  // (4-b) 2재료 자기 검사 — 재료별 커버리지·B 우선·트래블 엄격 판정 (앞 단계가 이미 막았으면 건너뜀 — 검사 비용)
  const failedAll = new Set<number>(failed);
  if (dualSlots !== null && issues.length === 0) {
    const self = dualSelfCheck(input, dualSlots, topY, lh, result);
    issues.push(...self.issues);
    for (const n of self.failedLayers) failedAll.add(n);
  }

  if (issues.length > 0) {
    const failedLayers = [...failedAll].sort((a, b) => a - b);
    return { out: { ok: false, gcode: null, issues, failedLayers, summary, parser }, gen: result };
  }
  return { out: { ok: true, gcode: result.gcode, summary, parser }, gen: result };
}

/**
 * Task0 G-code 를 만들고 검사한다 — 통과하면 gcode, 아니면 gcode 없이 이유.
 * @param onLayerDone 층 진행 (끝낸 층 수, 전체 층 수) — 워커가 스로틀해서 메인에 알린다
 */
export function runTask0GcodeExport(
  input: Task0ExportInput,
  onLayerDone?: (done: number, total: number) => void,
): Task0ExportResult {
  return exportGcodeStage(input, onLayerDone).out;
}

/** 층 번호 목록 → "1, 4, 7 외 n개" */
function listLayers(layers: readonly number[]): string {
  const head = layers.slice(0, TASK0_EXPORT_MAX_LISTED).join(', ');
  const more = layers.length > TASK0_EXPORT_MAX_LISTED ? ` 외 ${layers.length - TASK0_EXPORT_MAX_LISTED}개` : '';
  return `${head}${more}`;
}

/**
 * Task0 job.zip 을 만들고 검사한다 (머리 주석 0~9) — 통과하면 zip 바이트 + 요약, 아니면 zip 없이 이유.
 * @param onProgress (단계, 끝낸 수, 전체 수) — 워커가 스로틀해서 메인에 알린다. 출력에는 영향 없음
 */
export async function runTask0JobZipExport(
  input: Task0JobZipExportInput,
  onProgress?: (stage: Task0JobStage, done: number, total: number) => void,
): Promise<Task0JobZipExportResult> {
  const t0 = performance.now();
  // 0~5) run.gcode — 막히면 그 이유 그대로
  const g = exportGcodeStage(input, (done, total) => onProgress?.('gcode', done, total));
  const t1 = performance.now();
  if (!g.out.ok || g.gen === null) {
    const o = g.out;
    return {
      ok: false,
      zip: null,
      issues: o.ok ? [] : o.issues,
      failedLayers: o.ok ? [] : o.failedLayers,
      summary: o.summary,
      job: null,
      parser: o.parser,
    };
  }
  const { summary, parser } = g.out;
  const gen = g.gen;
  const lh = input.layerHeightMm;
  const layerCount = gen.totals.layerCount;
  const frame = input.frame ?? TASK0_DEFAULTS;

  // 6) 층 마스크 → PNG — writer 와 같은 meshes·lh·bed, 투사 프레임 'full' (견본 경로와 같은 함수)
  const images = await buildTask0LayerImages(
    input.meshes,
    layerCount,
    lh,
    { widthMm: gen.params.bedWidthMm, depthMm: gen.params.bedDepthMm },
    { frame, onLayerDone: (done, total) => onProgress?.('png', done, total) },
  );
  const t2 = performance.now();
  onProgress?.('verify', 0, 1);

  const pngCount = images.layerFiles.length;
  const maskEmpty = images.layerWhitePixels.flatMap((w, n) => (w === 0 ? [n] : []));
  const job: Task0JobZipSummary = {
    zipBytes: 0,
    pngCount,
    pngBytes: images.layerFiles.reduce((s, f) => s + f.data.length, 0),
    emptyMaskLayerCount: maskEmpty.length,
    clippedPixels: images.clippedPixels,
    generator: input.generator ?? TASK0_JOB_GENERATOR,
    stageMs: { gcode: t1 - t0, png: t2 - t1, verify: 0 },
  };
  const blocked = (issues: string[], failedLayers: number[] = []): Task0JobZipExportResult => {
    job.stageMs.verify = performance.now() - t2;
    return { ok: false, zip: null, issues, failedLayers, summary, job, parser };
  };

  // 7) 생성 단계 단언 — PNG 수, 빈 층 집합 (도포 = 노광, 규격 §3)
  if (pngCount !== layerCount) return blocked([`층 PNG ${pngCount}장 ≠ G-code 층 수 ${layerCount} (규격 §11 거부 조건 3)`]);
  const gcodeEmpty = new Set(gen.totals.emptyLayers);
  const exposedWithoutResin: number[] = []; // 마스크 흰 픽셀 > 0 인데 G-code 빈 층 — 노광할 곳에 레진 없음
  const resinWithoutExposure: number[] = []; // G-code 도포 층인데 마스크 흰 픽셀 0 — 칠한 레진이 굳지 않음
  for (let n = 0; n < layerCount; n++) {
    const maskBlank = images.layerWhitePixels[n] === 0;
    if (!maskBlank && gcodeEmpty.has(n)) exposedWithoutResin.push(n);
    if (maskBlank && !gcodeEmpty.has(n)) resinWithoutExposure.push(n);
  }
  if (exposedWithoutResin.length > 0 || resinWithoutExposure.length > 0) {
    const issues: string[] = [];
    if (exposedWithoutResin.length > 0) {
      issues.push(
        `도포 영역 ≠ 노광 영역 (규격 §3): 마스크에 흰 픽셀이 있는데 G-code 는 빈 층 ${exposedWithoutResin.length}개 — ` +
          `층 ${listLayers(exposedWithoutResin)} (노광할 곳에 레진이 없음).`,
      );
    }
    if (resinWithoutExposure.length > 0) {
      issues.push(
        `도포 영역 ≠ 노광 영역 (규격 §3): G-code 는 도포하는데 마스크가 전부 검정인 층 ${resinWithoutExposure.length}개 — ` +
          `층 ${listLayers(resinWithoutExposure)} (투사 영역 밖이거나 픽셀보다 작은 단면 — 칠한 레진이 굳지 않음).`,
      );
    }
    const failedLayers = [...exposedWithoutResin, ...resinWithoutExposure].sort((a, b) => a - b);
    return blocked(issues, failedLayers);
  }

  // 8) manifest·exposure·preview·zip 조립 (견본 경로와 같은 함수)
  const { files, manifest } = buildTask0JobFiles({
    gcode: gen,
    layerHeightMm: lh,
    images,
    exposure: input.exposure,
    exposureB: input.exposureB,
    materialName: input.materialName,
    materialNameB: input.materialNameB,
    generator: input.generator,
    generatedAt: input.generatedAt,
    frame,
  });
  const zip = await assembleTask0JobZip(files);
  job.zipBytes = zip.length;
  job.generator = manifest.generator;

  // 9) 자기 검사 — 구조·머리 위주 ('header'), 내용은 7 에서 단언, 인코더 왕복은 표본 두 장
  const issues: string[] = [];
  const report = await verifyTask0JobZip(zip, { layerPngs: 'header' });
  for (const r of report.reasons.slice(0, TASK0_EXPORT_MAX_LISTED)) {
    issues.push(`job.zip 검사 — 거부 조건 ${r.condition} (${TASK0_JOB_CONDITION_LABELS[r.condition]}): ${r.message}`);
  }
  if (report.reasons.length > TASK0_EXPORT_MAX_LISTED) {
    issues.push(`job.zip 검사 — 거부 조건 사유 외 ${report.reasons.length - TASK0_EXPORT_MAX_LISTED}건`);
  }
  for (const m of report.extraIssues.slice(0, TASK0_EXPORT_MAX_LISTED)) issues.push(`job.zip 검사 — ${m}`);
  if (report.extraIssues.length > TASK0_EXPORT_MAX_LISTED) {
    issues.push(`job.zip 검사 — 추가 검사 외 ${report.extraIssues.length - TASK0_EXPORT_MAX_LISTED}건`);
  }
  const samples = [
    images.layerWhitePixels.findIndex((w) => w > 0),
    images.layerWhitePixels.findIndex((w) => w === 0),
  ].filter((n) => n >= 0);
  for (const n of samples) {
    try {
      const img = await decodeTask0GrayPng(images.layerFiles[n].data);
      let white = 0;
      let mid = 0;
      for (const v of img.data) {
        if (v !== 0) white++;
        if (v !== 0 && v !== 255) mid++;
      }
      if (img.width !== frame.projectorWidthPx || img.height !== frame.projectorHeightPx || white !== images.layerWhitePixels[n] || mid !== 0) {
        issues.push(
          `job.zip 검사 — 층 ${n} PNG 를 풀어 보니 ${img.width}×${img.height}, 흰 픽셀 ${white}(중간값 ${mid}) ≠ ` +
            `마스크 ${frame.projectorWidthPx}×${frame.projectorHeightPx}, 흰 픽셀 ${images.layerWhitePixels[n]}`,
        );
      }
    } catch (e) {
      issues.push(`job.zip 검사 — 층 ${n} PNG 풀기 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (JSON.stringify(manifest.estimate) !== JSON.stringify(summary.estimate)) {
    issues.push('job.zip 검사 — manifest estimate 가 화면 요약 estimate 와 다름 (같은 식·같은 입력이어야 함)');
  }
  if (issues.length > 0) return blocked(issues);

  onProgress?.('verify', 1, 1);
  job.stageMs.verify = performance.now() - t2;
  return { ok: true, zip, summary, job, parser };
}
