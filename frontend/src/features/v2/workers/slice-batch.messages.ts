/**
 * 배치 슬라이스 워커 ↔ 메인 브릿지 사이의 메시지 프로토콜.
 *
 * 씬(Babylon Mesh)은 워커로 못 넘어가므로 메인이 world 삼각형 배열
 * (Float32Array, 삼각형당 9 float)을 직렬화해 넘긴다. 워커는 이 배열만으로
 * 레이어 루프 + rasterize + PNG 인코딩 + ZIP 조립 또는 G-code 조립을
 * 수행한다.
 *
 * FdmSettings 는 gcode/types.ts 의 순수 타입(Babylon 무의존)이라 워커
 * 번들에 @babylonjs/core 를 끌어오지 않는다 (type-only import).
 */
import type { FdmSettings } from "../utils/gcode/types";
import type {
  Task0ExportResult,
  Task0ExportWriterOptions,
  Task0JobStage,
  Task0JobZipExportResult,
} from "../utils/task0/task0-export";
import type { Task0ExposureSettings } from "../utils/task0/task0-jobzip";
import type { Task0PrintableFrame } from "../utils/task0/task0-frame";
import type { Task0RasterFrame } from "../utils/task0/task0-mask";
import type { Task0MaterialSlot } from "../utils/task0/task0-slice";

/** 워커가 자를 대상 메시 하나 — world 좌표 삼각형 flat 배열. */
export interface WorkerMeshGeometry {
  /** 삼각형당 9 float (v0.x,v0.y,v0.z, v1.x,…, v2.z). world 좌표. */
  triangles: Float32Array;
}

/** 슬라이스 + 인코딩 공통 파라미터. */
export interface WorkerSliceOptions {
  layerHeightMm: number;
  /** 마스크 픽셀 해상도 (= LCD 해상도). */
  widthPx: number;
  heightPx: number;
  /** 빌드플레이트 가로/세로 (mm). rasterize 좌표 매핑에 사용. */
  plateWidthMm: number;
  plateDepthMm: number;
  /** 씬 최상단 Y (mm). 레이어 수 = ceil(topY / layerHeightMm). */
  topY: number;
  /** 노광 파라미터 (선택). PNG-ZIP manifest 노광 계산용. */
  exposure?: {
    bottomLayerCount: number;
    transitionLayerCount: number;
    bottomExposureSec: number;
    exposureSec: number;
  };
}

/** PNG-ZIP 산출 요청. */
export interface PngZipRequest {
  kind: "pngzip";
  meshes: WorkerMeshGeometry[];
  options: WorkerSliceOptions;
}

/** FDM G-code 산출 요청. */
export interface GcodeRequest {
  kind: "gcode";
  /** world 삼각형 배열들 (transferable). */
  meshes: WorkerMeshGeometry[];
  /** gcode/types.ts 의 FdmSettings (buildWidth/buildDepth 포함). */
  settings: FdmSettings;
  /** 슬라이스 높이 범위 (mm). 대상 mesh 들의 world bounding 최저/최고 Y. */
  range: { yMin: number; yMax: number };
}

/**
 * Task0 G-code(run.gcode) 산출 요청 (Z2). 워커가 utils/task0/task0-export.ts runTask0GcodeExport 를
 * 그대로 부른다 — 검증 스크립트(verify-task0-export)가 같은 함수를 불러 앱 경로 = 스크립트 경로를 확인한다.
 */
export interface Task0GcodeRequest {
  kind: "task0-gcode";
  /** world 삼각형 배열들 (transferable) — 마스크 ZIP 과 같은 mesh 집합(STL + 서포트). */
  meshes: WorkerMeshGeometry[];
  /** 씬 최상단 Y (mm, 서포트 포함) — 마스크 경로와 같은 값. 층 수 = task0LayerCount(topY, lh). */
  topY: number;
  layerHeightMm: number;
  /** writer 옵션 (베드 크기 등 — 프로파일에서). 층 진행 콜백은 워커가 붙인다. */
  writer: Task0ExportWriterOptions;
  /** 예상 시간의 노광 항목용 (선택 — 빠지면 types/printer.ts DEFAULT_*). */
  exposure?: Task0ExposureSettings;
  /** 출력 가능 영역 (프로파일 — 빠지면 TASK0_DEFAULTS). 모델·서포트가 밖이면 writer 전에 막는다(Z3). */
  printable?: Task0PrintableFrame;
  /**
   * 2재료 (D1b) — meshes 와 같은 순서의 재료 슬롯(서포트 = A, STL = 파일의 materialSlot·기본 B). 재료 모드가 단일이면
   * 보내지 않는다(빠지면 단일 재료 — 바이트 그대로). 코어 task0-export materialSlots 로 그대로 넘긴다.
   */
  materialSlots?: Task0MaterialSlot[];
}

/**
 * Task0 job.zip 산출 요청 (Z3). 워커가 utils/task0/task0-export.ts runTask0JobZipExport 를 그대로 부른다 —
 * run.gcode(위 Task0GcodeRequest 와 같은 검사) + 층 마스크 PNG(투사 프레임) + manifest·exposure·preview + 자기 검사.
 * 검증 스크립트(verify-task0-jobzip-export)가 같은 함수·같은 메시지로 견본 sample.job.zip 과 같은 바이트를 확인한다.
 */
export interface Task0JobZipRequest {
  kind: "task0-jobzip";
  /** world 삼각형 배열들 (transferable) — 마스크 ZIP 과 같은 mesh 집합(STL + 서포트). */
  meshes: WorkerMeshGeometry[];
  /** 씬 최상단 Y (mm, 서포트 포함). 코어가 1 µm 로 정규화한다(float32 함정). */
  topY: number;
  layerHeightMm: number;
  /** writer 옵션 (베드 크기 등 — 프로파일에서). */
  writer: Task0ExportWriterOptions;
  /** 노광 (선택 — 빠지면 types/printer.ts DEFAULT_*). manifest·exposure.json·예상 시간에 쓴다. */
  exposure?: Task0ExposureSettings;
  /** 층 마스크 투사 프레임 (프로파일 — 빠지면 TASK0_DEFAULTS). */
  frame?: Task0RasterFrame;
  /** 출력 가능 영역 (프로파일 — 빠지면 TASK0_DEFAULTS). 모델·서포트가 밖이면 writer 전에 막는다. */
  printable?: Task0PrintableFrame;
  /** manifest.generator (앱은 TASK0_APP_JOB_GENERATOR, 빠지면 견본 값). */
  generator?: string;
  /** manifest.generatedAt (빠지면 워커에서 지금 시각 — 같은 바이트가 필요한 검증만 고정값). */
  generatedAt?: string;
  /** 2재료 (D1b) — Task0GcodeRequest.materialSlots 와 같다. 있으면 manifest materials 2개·dualMaterial true. */
  materialSlots?: Task0MaterialSlot[];
  /**
   * 재료 이름 (D2) — manifest materials[].name. 앱은 2재료일 때만 보낸다(task0-material task0ExportMaterialNames — 단일은
   * 빠짐 = 기본 이름, 바이트 그대로). 코어 task0-export 가 정규화한다.
   */
  materialName?: string;
  materialNameB?: string;
}

export type SliceBatchRequest =
  | PngZipRequest
  | GcodeRequest
  | Task0GcodeRequest
  | Task0JobZipRequest;

/** 진행률 알림 (done / total 레이어). */
export interface WorkerProgress {
  type: "progress";
  done: number;
  total: number;
  /**
   * 진행 단계 (Task0 job.zip 만 — G-code 생성 / 층 이미지 / 묶기·검사). 다른 경로는 이 키를 보내지 않는다.
   * 단계마다 done/total 이 처음부터 다시 센다.
   */
  stage?: Task0JobStage;
}

/** 완료 — 산출 바이너리 (ArrayBuffer, transferable). PNG-ZIP 경로. */
export interface WorkerDone {
  type: "done";
  /** 산출물 바이트. PNG-ZIP. topY<=0(빈 씬)이면 null. */
  buffer: ArrayBuffer | null;
  /** Blob 재조립용 MIME. */
  mime: string;
}

/** 완료 — G-code 문자열. 대상 mesh 가 없거나 슬라이스 범위가 없으면 null. */
export interface WorkerGcodeDone {
  type: "gcode-done";
  gcode: string | null;
}

/**
 * 완료 — Task0 G-code 결과 (Z2). 통과면 gcode + 요약, 막혔으면 gcode null + 이유(층 번호·문구).
 * 막힌 것은 오류(error)가 아니라 정상 응답이다 — 사용자에게 이유를 보여 줄 대상.
 */
export interface WorkerTask0Done {
  type: "task0-done";
  result: Task0ExportResult;
}

/**
 * 완료 — Task0 job.zip 결과 (Z3). 통과면 zip 바이트(transferable) + 요약, 막혔으면 zip null + 이유.
 * 막힌 것은 오류(error)가 아니라 정상 응답이다.
 */
export interface WorkerTask0JobDone {
  type: "task0-job-done";
  result: Task0JobZipExportResult;
}

/** 오류. */
export interface WorkerError {
  type: "error";
  message: string;
}

export type SliceBatchResponse =
  | WorkerProgress
  | WorkerDone
  | WorkerGcodeDone
  | WorkerTask0Done
  | WorkerTask0JobDone
  | WorkerError;
