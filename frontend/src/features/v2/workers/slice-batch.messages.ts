/**
 * 배치 슬라이스 워커 ↔ 메인 브릿지 사이의 메시지 프로토콜.
 *
 * 씬(Babylon Mesh)은 워커로 못 넘어가므로 메인이 world 삼각형 배열
 * (Float32Array, 삼각형당 9 float)을 직렬화해 넘긴다. 워커는 이 배열만으로
 * 레이어 루프 + rasterize + PNG/CTB 인코딩 + ZIP 조립을 수행한다.
 */

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
  /** 노광 파라미터 (선택). PNG-ZIP manifest / CTB layer table 노광 계산용. */
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

/** CTB 산출 요청. */
export interface CtbRequest {
  kind: "ctb";
  meshes: WorkerMeshGeometry[];
  options: WorkerSliceOptions;
  /** CTB 전용 파라미터 (미지정 필드는 워커에서 기존 인코더 기본값 적용). */
  ctb: {
    bedSizeZMm: number;
    exposureSec?: number;
    bottomExposureSec?: number;
    bottomLayerCount?: number;
    transitionLayerCount?: number;
    lightOffDelaySec?: number;
  };
}

export type SliceBatchRequest = PngZipRequest | CtbRequest;

/** 진행률 알림 (done / total 레이어). */
export interface WorkerProgress {
  type: "progress";
  done: number;
  total: number;
}

/** 완료 — 산출 바이너리 (ArrayBuffer, transferable). */
export interface WorkerDone {
  type: "done";
  /** 산출물 바이트. PNG-ZIP 또는 CTB. topY<=0(빈 씬)이면 null. */
  buffer: ArrayBuffer | null;
  /** Blob 재조립용 MIME. */
  mime: string;
}

/** 오류. */
export interface WorkerError {
  type: "error";
  message: string;
}

export type SliceBatchResponse = WorkerProgress | WorkerDone | WorkerError;
