// BabylonScene 공개/내부 타입 정의. BabylonScene.tsx 에서 순수 이동 후 re-export.
//   공개 인터페이스(BabylonSceneProps/Handle/GizmoMode/IslandStats)는 소비자가
//   `./BabylonScene` 경로로 계속 import 하므로 export 이름을 그대로 유지한다.
import type { TransformV2 } from "../../types/transform";
import type { SliceMask } from "../../utils/slice-rasterize";
import type { FdmSettings } from "../../utils/gcode/types";
import type { FindMarginStats } from "../../utils/dental/margin-detect";
import type { SupportParams, SupportPointV2 } from "../../support/types";
import type { EditMode } from "../EditModeControls";
import type { ViewPreset } from "../../utils/camera-views";
import type { STLFileV2 } from "../../types/stl";

export type GizmoMode = "none" | "translate" | "rotate" | "scale";

export interface BabylonSceneProps {
  /** 프로젝트의 STL 파일 목록. */
  files: STLFileV2[];
  /** 선택된 STL id 집합. 다중 선택 지원. */
  selectedIds: ReadonlySet<string>;
  /**
   * 씬에서 픽으로 선택 변경됐을 때 부모에 알림.
   * - id == null  → 빈 공간 클릭
   * - opts.multi  → Ctrl/Meta 키 동시 누름 (토글)
   */
  onPick: (id: string | null, opts: { multi: boolean }) => void;
  /** 오버행 임계각 (deg). */
  overhangAngleDeg: number;
  /** Gizmo 모드. 단일 선택일 때만 활성. 'none' 이면 비활성. */
  gizmoMode: GizmoMode;
  /** Gizmo 드래그가 끝났을 때 commit. (start, end) 가 다르면 DB+undo. */
  onGizmoCommit: (id: string, start: TransformV2, end: TransformV2) => void;
  /** 프로젝트의 서포트 점. 추가·삭제 시 자동 동기화. */
  supports: SupportPointV2[];
  /** 서포트 굵기 등 시각화에 쓰는 파라미터. */
  supportParams: SupportParams;
  /** 빌드플레이트 가로 (mm). 프로파일에서 옴. */
  plateWidthMm: number;
  /** 빌드플레이트 세로 (mm). */
  plateDepthMm: number;
  /** 'select' / 'support' — 모드별 픽·드래그·Gizmo 동작. */
  editMode: EditMode;
  /** 'support' 모드에서 모델 표면 픽 시 → 그 위치에 서포트 추가.
   *  contact 는 표면 안쪽으로 push 된 좌표. normal 은 표면 외부
   *  방향 단위 벡터 (옵셔널 — 기둥 위 클릭 등 normal 없는 경우).
   *  attachedTo 는 클릭이 다른 Bridge 기둥 위면 그 부모 Bridge id 와
   *  path 위 t 비율 (Bridge↔Bridge follow). */
  onAddSupportAt: (
    stlId: string,
    contact: [number, number, number],
    normal?: [number, number, number],
    attachedTo?: { supportId: string; t: number },
  ) => void;
  /**
   * 'support' 모드에서 기둥 픽 시 선택, 빈 공간 픽 시 null.
   * 삭제는 Delete 키 / UI 버튼으로 분리.
   */
  onPickSupport: (supportId: string | null) => void;
  /** 현재 선택된 기둥 id (highlight 표시용). */
  selectedSupportId: string | null;
  /**
   * 선택된 기둥의 Gizmo 드래그가 끝났을 때 호출.
   * newBaseXZ = 새 (X, Z) world 좌표. Y 는 0 으로 고정.
   * contact 의 Y 는 호출 측에서 옛 값을 유지한다.
   */
  onMoveSupport: (id: string, newBaseXZ: [number, number]) => void;
  /**
   * Bridge 모드에서 첫 번째 클릭한 지점. null 이면 표시 X.
   * 두 번째 클릭으로 확정될 때까지 작은 marker 로 보여준다.
   */
  pendingBridgePoint: [number, number, number] | null;
  /**
   * Bridge sub-mode 활성 여부. true 면:
   *   · 기둥 픽 → 그 기둥 위 hit point 를 onAddSupportAt 으로 넘김
   *     (= bridge endpoint 로 사용). stlId 는 기둥의 stlId.
   *   · 빈 공간 픽 → 무시 (취소는 Esc).
   */
  bridgeMode: boolean;
  /**
   * Z 슬라이스 미리보기 높이 (mm). null 이면 비활성.
   * 활성 시 Y > sliceY 영역의 메쉬가 잘려 단면이 보인다.
   */
  sliceY: number | null;
  /**
   * Bridge 곡선의 변곡점을 사용자가 드래그해서 옮겼을 때 호출.
   * idx 는 base → contact 방향 순서 (0..n-1). n 은 가변.
   */
  onMoveBridgeControlPoint: (
    supportId: string,
    idx: number,
    pos: [number, number, number],
  ) => void;
  /**
   * Bridge 끝점 (base / contact) 을 사용자가 드래그해서 옮겼을 때 호출.
   * which: 'base' = 첫 번째 클릭으로 정해진 끝, 'contact' = 두 번째 클릭.
   * 변곡점 비례 이동은 ViewerV2Page handler 가 한 transaction 으로 처리.
   */
  onMoveBridgeEndpoint: (
    supportId: string,
    which: "base" | "contact",
    pos: [number, number, number],
  ) => void;
  /** STL 메쉬 더블 클릭 (= select 모드에서 회전 모드 활성화 신호). */
  onDoublePickStl?: (id: string) => void;
  /** Bridge tube 더블 클릭 — 그 위치 (world 좌표) 에 변곡점 추가. */
  onDoublePickBridgeTube?: (
    supportId: string,
    hitPoint: [number, number, number],
  ) => void;
  /** Bridge 변곡점 sphere 가 선택됐을 때 (단일 클릭). Delete 키 처리용. */
  onSelectBridgeControlPoint?: (
    supportId: string,
    idx: number,
  ) => void;
  /**
   * '바닥면 붙이기' sub-mode 활성 여부. true 면 STL face 클릭 시
   * onAlignFaceToFloor 호출 — 그 face 의 world normal 이 -Y 가 되게
   * STL 을 회전하고 minY 가 0 이 되게 Y 이동.
   */
  alignFloorMode?: boolean;
  /** 바닥면 붙이기 face 클릭 결과: 회전 후의 새 TransformV2. */
  onAlignFaceToFloor?: (id: string, newTransform: TransformV2) => void;
  /**
   * 'dental-brush' 모드 브러쉬 두께 (mm). 색칠 반경 = 두께/2. 미지정 시 3mm.
   * (원본 STLViewer 의 brushThickness prop — 기본 3.)
   */
  brushThicknessMm?: number;
  /**
   * 'dental-brush' 모드에서 색칠이 바뀔 때마다 통지 (v2 콜백 패턴).
   * faceIds = 그 STL 의 painted face index 목록. margin-detect 의
   * paintedFaceIds 입력 계약과 동일 (index buffer 상 삼각형 번호).
   * painted 는 세션 상태 — IndexedDB 영속화는 이 조각 범위 밖.
   */
  onPaintedFacesChange?: (stlId: string, faceIds: number[]) => void;
  /**
   * 'dental-brush' 모드에서 SHIFT+휠로 브러쉬 두께를 바꿨을 때 통지.
   * 패널의 두께 입력과 양방향 동기화용 (원본 onBrushThicknessChange 이식).
   */
  onBrushThicknessChange?: (mm: number) => void;
  /**
   * 마진·아일랜드 검출 결과가 stale 이 되어 내부에서 무효화(dispose+ref null)
   * 됐을 때 통지 (감사 B1/B3). 페이지는 이 stlId 의 marginStatus/islandStatus
   * 를 초기 상태로 되돌려 "재검출 필요"를 명시적으로 표시한다.
   *   무효화 트리거: (a) STL transform commit(회전·이동), (b) 색칠 실제 변경.
   *   world 좌표 기반 검출 결과가 변형 후 옛 좌표를 참조하는 것을 막는다.
   */
  onDentalResultsInvalidated?: (stlId: string) => void;
  className?: string;
}

export interface BabylonSceneHandle {
  setView: (preset: ViewPreset) => void;
  fit: () => void;
  /**
   * 주어진 STL id 들의 메쉬만 화면에 꽉 차게 프레이밍한다 (P5: Z 키 = 선택 한정 줌).
   * 매칭되는 메쉬가 0 개면 전체 fit() 으로 폴백.
   */
  fitSelection: (ids: string[]) => void;
  /**
   * 빌드 플레이트(빌드 볼륨) 전체가 보이도록 프레이밍한다 (P5: B 키 = 플레이트 전용 뷰).
   * 홈 뷰 각도로 리셋 후 플레이트 AABB 기준으로 카메라를 맞춘다.
   */
  viewPlate: () => void;
  /**
   * Transform 드래그 미리보기. DB 저장 없이 메쉬에 즉시 반영.
   * TransformPanel 의 onPreview 가 호출한다.
   */
  previewTransform: (id: string, t: TransformV2) => void;
  /**
   * 모든 STL 메쉬에 대해 자동 서포트 점을 생성해서 반환한다.
   * 저장은 호출 측에서 IndexedDB 에 commit.
   */
  generateAutoSupports: (
    projectId: string,
    params: SupportParams,
  ) => SupportPointV2[];
  /**
   * 현재 씬의 STL + 서포트 메쉬를 합쳐 binary STL Blob 으로 반환.
   * 모델이 0 개면 null.
   */
  exportStl: () => Blob | null;
  /**
   * 주어진 sliceY 의 단면을 width × height 픽셀의 1bpp 마스크로.
   * 모든 STL + 서포트의 union.
   */
  getSliceMask: (
    sliceY: number,
    widthPx: number,
    heightPx: number,
  ) => SliceMask;
  /**
   * 현재 씬의 모든 STL + 서포트 mesh 를 world 삼각형 배열(삼각형당 9 float)로
   * 추출한다. getSliceMask 와 동일한 mesh 집합. Web Worker 로 넘겨 배치
   * 슬라이스/출력할 때 씬(Babylon Mesh) 직렬화 불가 문제를 우회한다.
   */
  getSliceGeometry: () => { triangles: Float32Array }[];
  /**
   * 씬에 있는 모든 STL + 서포트의 world AABB 최대 Y. 모델 없으면 0.
   * 슬라이서가 layer count 를 계산할 때 쓴다.
   */
  getSceneTopY: () => number;
  /**
   * 모델 + 서포트의 부피 (mm³) 합. 출력 시간 / 레진 사용량 추정용.
   */
  getBuildVolumeMm3: () => { model: number; support: number };
  /**
   * FDM G-code 를 Web Worker 로 조립하기 위한 입력을 준비한다 (감사 A5).
   * exportStl 과 동일한 mesh 집합(STL + 서포트)을 world 삼각형 배열로 추출하고,
   * 슬라이스 높이 범위(world bounding 최저/최고 Y)와 병합된 FdmSettings 를 함께
   * 돌려준다. 실제 슬라이스·G-code 조립은 워커가 수행한다(메인스레드 프리즈 방지).
   * 모델이 0 개거나 유효 슬라이스 범위가 없으면 null.
   * settings 미지정 필드는 DEFAULT_FDM_SETTINGS 로 채운다.
   */
  getFdmSliceInput: (settings?: Partial<FdmSettings>) => {
    meshes: { triangles: Float32Array }[];
    settings: FdmSettings;
    range: { yMin: number; yMax: number };
  } | null;
  /**
   * world 좌표 한 점을 그 STL 의 local 좌표로 변환.
   * supports 마이그레이션 (world → stl-local) 에 사용.
   */
  worldToStlLocal: (
    stlId: string,
    world: [number, number, number],
  ) => [number, number, number] | null;
  /**
   * STL local 좌표 한 점을 현재 world 좌표로 변환.
   * 잘못된 마이그레이션 데이터 reverse (stl-local → world) 에 사용.
   */
  stlLocalToWorld: (
    stlId: string,
    local: [number, number, number],
  ) => [number, number, number] | null;
  /**
   * Bridge 경로 (base → cp1 → cp2 → cp3 → contact) 가 STL 메쉬와
   * 교차하면 변곡점들을 모든 STL 의 maxY + margin 위로 들어올린 새
   * 변곡점 배열을 반환. 교차 없으면 입력 그대로.
   *
   * excludeStlIds: 충돌 검사에서 제외할 STL (보통 base, contact 가 닿아
   *   있는 두 모델 — 이 두 모델 표면에 의도적으로 끝점이 박혀 있으므로).
   */
  autoRouteBridge: (
    base: [number, number, number],
    contact: [number, number, number],
    cps: [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ],
    excludeStlIds: string[],
  ) => [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  /**
   * (x, z) 위치에서 startY 부터 -Y 방향으로 ray 를 발사해 가장 가까운
   * STL 표면 Y 를 반환. excludeStlIds 의 STL 은 검사에서 제외.
   * 어떤 STL 도 hit 못하면 0 (빌드플레이트).
   *
   * 단점 / 자동 서포트의 base 결정에 쓰임 — base 가 다른 모델 상단에
   * 자동으로 부착되어 직선 경로가 다른 모델을 통과하지 않게 한다.
   */
  findSurfaceBelow: (
    x: number,
    z: number,
    startY: number,
    excludeStlIds: string[],
  ) => number;
  /**
   * 한 점에서 STL 표면으로 가장 가까운 점을 찾고 그 점의 surface normal
   * 도 함께 반환. hintNormal 이 있으면 그 양방향만 ray cast (가벼움),
   * 없으면 6 축 모두 시도. 반대편 두께도 측정해 반환 — Bridge path 각
   * 점에서 push 한계 계산에 사용.
   */
  projectToStlSurface: (
    stlId: string,
    point: [number, number, number],
    hintNormal?: [number, number, number],
  ) => {
    point: [number, number, number];
    normal: [number, number, number];
    thickness: number;
  } | null;
  /**
   * 'dental-brush' 모드 색칠(마스크)을 모두 지운다. 원본 clearMask 대응.
   * 오버레이 데칼 dispose + painted 점 초기화 + 각 STL 에 빈 목록 통지.
   */
  clearDentalPaint: () => void;
  /**
   * 주어진 STL 의 painted face index 집합. margin-detect 의 findMargin
   * ({ paintedFaceIds }) 입력 계약과 동일 (index buffer 상 삼각형 번호).
   * 색칠 없으면 빈 배열.
   */
  getPaintedFaceIds: (stlId: string) => number[];
  /**
   * 'dental-brush' 로 색칠한 영역에서 마진 폐곡선을 검출한다.
   *   활성 STL(선택된 것, 없으면 첫 STL) + getPaintedFaceIds 계약 그대로 →
   *   findMargin(margin-detect.ts) 호출. 성공 시 초록 튜브(원본 시각화 이식)를
   *   생성해 setParent(mesh) 로 STL 회전을 추종하고 결과를 내부 marginRef 에
   *   보관(floodfill 등 다음 조각이 사용). 실패 시 reason 반환 → 패널이 UI
   *   문구로 변환. stats 는 성공 시에만.
   */
  findDentalMargin: () =>
    | { ok: true; stats: FindMarginStats }
    | { ok: false; reason: string };
  /**
   * 마진 시각화(초록 튜브) + 마진 결과 ref + floodfill 자동 색칠(주황) 을 모두
   * 지운다. 브러쉬 색칠(painted) 자체는 건드리지 않는다 (clearDentalPaint 와 분리).
   */
  clearDentalMargin: () => void;
  /**
   * 활성 STL(선택된 것, 없으면 첫 STL) 전체에 대해 슬라이스 기반 아일랜드
   * (미지지 영역) 검출을 실행한다.
   *   활성 mesh → readWorldTriangles → detectSliceIslands(island-detection.ts, 잠금)
   *   호출(원본 STLViewer 의 detectIslandsSignal useEffect 와 동일 파라미터 구성.
   *   단 임시 진단용 debugLayers 는 v2 에서 비활성). 검출된 island face 를 마젠타
   *   overlay(원본 시각화 이식, zOffset -1, mesh child) 로 표시하고 결과를 내부
   *   islandResultRef 에 보관. 요약 통계를 반환해 패널이 표시한다.
   *   layerHeightMm 미지정 시 island-detection 기본값(0.05mm).
   */
  detectDentalIslands: (layerHeightMm?: number) =>
    | { ok: true; stats: IslandStats }
    | { ok: false; reason: string };
  /**
   * 아일랜드 마젠타 overlay + 결과 ref 를 지운다. 브러쉬 색칠/마진 은 유지.
   */
  clearDentalIslands: () => void;
  /**
   * 지정 STL 의 마진·아일랜드 검출 결과를 stale 로 간주해 일괄 무효화한다
   * (감사 B1). world 좌표 기반 결과가 STL 변형 후 옛 좌표를 참조하는 것을 막는다.
   *   호출 측(ViewerV2Page)의 transform 적용 수렴점(handleCommitTransform +
   *   undo/redo)에서 호출한다 — gizmo/드래그/수치입력/바닥면정렬 모두 그 한 곳으로
   *   수렴하므로 씬 내부가 아닌 페이지 측에서 단일 경로로 배선한다.
   *   내부적으로 onDentalResultsInvalidated 콜백도 발화해 패널 상태를 리셋한다.
   */
  invalidateDentalResults: (stlId: string) => void;
  /**
   * 검출→생성 파이프라인 (Step 2-4, ADR-3): 직전 아일랜드 검출 결과의 island face
   * 집합에만 자동 서포트 점을 생성해 반환한다.
   *   islandResultRef 의 island face 집합 → autoGenerateSupportPoints(…, {faceFilter})
   *   로 후보 접점을 island face 위로 제한 → 같은 STL 의 마진 결과(marginRef)가
   *   있으면 각 접점에 margin-guard(guardContactAgainstMargin)를 적용해 마진 라인
   *   비침범을 보장 → 통과한 점만 반환. 저장은 호출 측(ViewerV2Page)에서 IndexedDB
   *   commit — 기존 generateAutoSupports 패턴과 동일.
   *
   * 아일랜드 검출 결과가 없으면 null (패널이 "먼저 아일랜드 검출" 안내).
   */
  autoSupportIslands: (
    projectId: string,
    params: SupportParams,
  ) => SupportPointV2[] | null;
}

/** 아일랜드 검출 요약 통계 (패널 표시용). 원본 onIslandDetectionComplete 페이로드 축약. */
export interface IslandStats {
  /** ISLAND 로 판정된 face 총 개수 (result.islandFaces.size). */
  totalIslandFaces: number;
  /** 슬라이스한 레이어 수 (result.nSlices). */
  nSlices: number;
  /** island face 가 1개 이상인 레이어 수 (perLayerIslandCount > 0 인 레이어). */
  layersWithIsland: number;
  /** 검출에 쓴 레이어 두께 (mm). */
  layerHeight: number;
}

/**
 * islandResultRef 슬림 보관 타입 (감사 B7). detectSliceIslands 는 sliceCells /
 * sliceFaceCells / perLayerIslandCells / perLayerIslandComponents 등 레이어×수만
 * 셀 문자열을 담은 대형 중간산물을 반환하는데, 검출 이후 실제로 참조되는 건
 * islandFaces(자동 서포트 faceFilter·재검증)와 stlId 뿐이다. 세션 내내 수백 MB
 * 상주하지 않게 필요한 필드만 골라 보관한다. (island-detection.ts 반환은 그대로 —
 * 보관만 슬림. 요약 통계는 검출 시점에 IslandStats 로 뽑아 반환하므로 중간산물이
 * 필요 없다.)
 */
export interface IslandResultSlim {
  /** 어떤 STL 의 결과인지. 단일 슬롯 소유·정리 판정용. */
  stlId: string;
  /** ISLAND 로 판정된 face index 집합 — 자동 서포트 faceFilter/재검증에 사용. */
  islandFaces: Set<number>;
}
