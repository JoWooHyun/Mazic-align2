import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  HighlightLayer,
  LinesMesh,
  Mesh,
  MeshBuilder,
  Plane,
  PointerDragBehavior,
  PointerEventTypes,
  PositionGizmo,
  Quaternion,
  Ray,
  RotationGizmo,
  ScaleGizmo,
  Scene,
  StandardMaterial,
  UtilityLayerRenderer,
  Vector3,
} from "@babylonjs/core";

import { loadStlIntoScene } from "../utils/stl-loader";
import { applyOverhangColors } from "../utils/overhang";
import {
  applyTransformToMesh,
  computeAlignFloorTransform,
  readMeshTransform,
} from "../utils/transform";
import { findClosestT } from "../utils/bridge-path";
import {
  worldToStlLocal as worldToStlLocalUtil,
  stlLocalToWorld as stlLocalToWorldUtil,
} from "../utils/coord-space";
import { IDENTITY_TRANSFORM, type TransformV2 } from "../types/transform";
import {
  createSupportMaterial,
  createSupportMesh,
} from "../utils/support-render";
import {
  babylonMeshToManifold,
  ensureManifoldReady,
  manifoldToBabylonMesh,
} from "../utils/manifold-csg";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { Matrix, VertexBuffer, VertexData } from "@babylonjs/core";
import {
  computePaintedFaceIds,
  makePaintPoint,
  type PaintPoint,
} from "../utils/dental/paint-mask";
import {
  findMargin,
  type FindMarginResult,
  type FindMarginStats,
} from "../utils/dental/margin-detect";
import {
  readWorldTriangles,
  createSupport as createDiscSupport,
} from "../utils/dental/dental-support";
import { detectSliceIslands } from "../utils/dental/island-detection";
import { guardContactAgainstMargin } from "../utils/dental/margin-guard";

function buildBridgeClipKey(
  point: SupportPointV2,
  params: SupportParams,
): string {
  const f = (v: number) => v.toFixed(3);
  const c = point.contact.map(f).join(",");
  const b = point.base.map(f).join(",");
  const cps = (point.curveControlPoints ?? [])
    .map((p) => p.map(f).join(","))
    .join(";");
  return `${c}|${b}|${cps}|${params.bridgeDiameterMm}`;
}

/**
 * support 전체 rebuild 판정용 key. STL local 좌표 기준이라 STL transform
 * 이 변경되어도 (world 좌표는 바뀌지만 local 좌표 = 원래 값) key 동일 →
 * mesh 재생성 skip. mesh.parent = stlMesh 로 auto-follow 되므로 world
 * 위치는 자동 이동. rebuild = freeze 원인이므로 이 skip 이 핵심.
 *
 * localContact/localBase 는 stlInvWorld 로 미리 변환한 좌표를 전달.
 */
function buildSupportKey(
  point: SupportPointV2,
  params: SupportParams,
  localContact: [number, number, number],
  localBase: [number, number, number],
  localCps: [number, number, number][] | null,
): string {
  const f = (v: number) => v.toFixed(3);
  const c = localContact.map(f).join(",");
  const b = localBase.map(f).join(",");
  const cps = localCps ? localCps.map((p) => p.map(f).join(",")).join(";") : "";
  // disc variant 는 dental 치수 스냅샷도 key 에 반영 (형상 결정 요소).
  //   trunk/bridge 는 discSettings 가 없어 빈 문자열 → 기존 key 와 동일.
  const ds = point.discSettings;
  const disc = ds
    ? [
        ds.tipTopDiameter,
        ds.tipBottomDiameter,
        ds.contactDepth,
        ds.supportAngle,
        ds.touchTipDistance,
      ].join(",")
    : "";
  return [
    point.source,
    point.variant ?? "trunk",
    c,
    b,
    cps,
    params.trunkDiameterMm,
    params.tipDiameterMm,
    params.baseDiameterMm,
    params.baseTransitionMm,
    params.tipTransitionMm,
    params.bridgeDiameterMm,
    disc,
  ].join("|");
}

function meshFromCachedData(
  data: {
    positions: Float32Array;
    indices: Uint32Array;
    normals: Float32Array;
  },
  name: string,
  material: StandardMaterial,
  scene: Scene,
): Mesh {
  const m = new Mesh(name, scene);
  m.setVerticesData(VertexBuffer.PositionKind, Array.from(data.positions));
  m.setIndices(Array.from(data.indices));
  m.setVerticesData(VertexBuffer.NormalKind, Array.from(data.normals));
  m.material = material;
  return m;
}
import { autoGenerateSupportPoints } from "../support/utils/auto-generate";
import { meshesToStlBlob } from "../utils/stl-export";
import { computeMeshVolumeMm3 } from "../utils/mesh-volume";
import {
  chainSegments,
  extractWorldTriangles,
  sliceMeshAtY,
} from "../utils/slice-section";
import {
  buildPolygonFillMesh,
  createSliceFillMaterial,
} from "../utils/slice-render";
import {
  rasterizePolygons,
  type SliceMask,
} from "../utils/slice-rasterize";
import {
  DEFAULT_FDM_SETTINGS,
  type FdmSettings,
} from "../utils/gcode/types";
import type { SupportParams, SupportPointV2 } from "../support/types";
import type { EditMode } from "./EditModeControls";

export type GizmoMode = "none" | "translate" | "rotate" | "scale";
import {
  addBuildPlateAndGrid,
  type SceneFurniture,
} from "../utils/scene-setup";
import {
  applyViewPreset,
  frameCameraToMeshes,
  resetCameraOnPlate,
  type ViewPreset,
} from "../utils/camera-views";
import type { STLFileV2 } from "../types/stl";

const HIGHLIGHT_COLOR = new Color3(1.0, 0.78, 0.18); // 따뜻한 노랑

interface BabylonSceneProps {
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
interface IslandResultSlim {
  /** 어떤 STL 의 결과인지. 단일 슬롯 소유·정리 판정용. */
  stlId: string;
  /** ISLAND 로 판정된 face index 집합 — 자동 서포트 faceFilter/재검증에 사용. */
  islandFaces: Set<number>;
}

const BabylonScene = forwardRef<BabylonSceneHandle, BabylonSceneProps>(
  function BabylonScene(
    {
      files,
      selectedIds,
      onPick,
      overhangAngleDeg,
      gizmoMode,
      onGizmoCommit,
      supports,
      supportParams,
      plateWidthMm,
      plateDepthMm,
      editMode,
      onAddSupportAt,
      onPickSupport,
      selectedSupportId,
      onMoveSupport,
      pendingBridgePoint,
      bridgeMode,
      sliceY,
      onMoveBridgeControlPoint,
      onMoveBridgeEndpoint,
      onDoublePickStl,
      onDoublePickBridgeTube,
      onSelectBridgeControlPoint,
      alignFloorMode,
      onAlignFaceToFloor,
      brushThicknessMm = 3,
      onPaintedFacesChange,
      onBrushThicknessChange,
      onDentalResultsInvalidated,
      className = "",
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<Engine | null>(null);
    const sceneRef = useRef<Scene | null>(null);
    const cameraRef = useRef<ArcRotateCamera | null>(null);
    const meshMapRef = useRef<Map<string, Mesh>>(new Map());
    const dragBehaviorMapRef = useRef<Map<string, PointerDragBehavior>>(
      new Map(),
    );
    const supportsRef = useRef<SupportPointV2[]>(supports);
    supportsRef.current = supports;
    const supportMeshMapRef = useRef<Map<string, Mesh>>(new Map());
    const supportMaterialRef = useRef<ReturnType<
      typeof createSupportMaterial
    > | null>(null);
    // manifold-3d (wasm) — STL 마다 Manifold 객체 cache, Bridge subtract 에 사용
    const manifoldModuleRef = useRef<ManifoldToplevel | null>(null);
    const stlManifoldMapRef = useRef<Map<string, Manifold>>(new Map());
    // Bridge subtract 결과 vertex data cache (supportId 기준)
    const bridgeClipCacheRef = useRef<Map<string, {
      key: string;
      positions: Float32Array;
      indices: Uint32Array;
      normals: Float32Array;
    }>>(new Map());
    const sliceOutlineRef = useRef<LinesMesh | null>(null);
    const sliceFillMeshesRef = useRef<Mesh[]>([]);
    const bridgeMarkerRef = useRef<Mesh | null>(null);
    const bridgeMarkerMatRef = useRef<StandardMaterial | null>(null);
    // Bridge 변곡점 + A/B 끝점 sphere.
    // 선택된 Bridge: 큰 sphere (드래그 가능, 변곡점 포함).
    // Bridge 모드 + 안 선택된 Bridge: A/B 작은 sphere (시각화만).
    const bridgeCpMeshesRef = useRef<Mesh[]>([]);
    const bridgeCpMatRef = useRef<StandardMaterial | null>(null);
    const bridgeBMatRef = useRef<StandardMaterial | null>(null); // B 끝점 (청록)
    // PositionGizmo 가 부착된 Bridge sphere (변곡점 또는 끝점).
    const selectedBridgeSphereRef = useRef<Mesh | null>(null);
    const sliceModelMatRef = useRef<ReturnType<
      typeof createSliceFillMaterial
    > | null>(null);
    const sliceSupportMatRef = useRef<ReturnType<
      typeof createSliceFillMaterial
    > | null>(null);
    const furnitureRef = useRef<SceneFurniture | null>(null);
    const highlightRef = useRef<HighlightLayer | null>(null);
    const utilityLayerRef = useRef<UtilityLayerRenderer | null>(null);
    const positionGizmoRef = useRef<PositionGizmo | null>(null);
    const rotationGizmoRef = useRef<RotationGizmo | null>(null);
    const scaleGizmoRef = useRef<ScaleGizmo | null>(null);
    const gizmoDragStartRef = useRef<
      | { kind: "stl"; id: string; t: TransformV2 }
      | { kind: "support"; id: string }
      | { kind: "bridge-cp"; id: string; cpIdx: number }
      | { kind: "bridge-ep"; id: string; which: "base" | "contact" }
      | null
    >(null);
    const gizmoModeRef = useRef<GizmoMode>(gizmoMode);
    gizmoModeRef.current = gizmoMode;

    // 최신 값을 effect 바깥에서 참조할 수 있게 ref 로 동기화.
    const overhangRef = useRef<number>(overhangAngleDeg);
    overhangRef.current = overhangAngleDeg;
    const liftRef = useRef<number>(supportParams.liftMm);
    liftRef.current = supportParams.liftMm;
    const bridgeDiamRef = useRef<number>(supportParams.bridgeDiameterMm);
    bridgeDiamRef.current = supportParams.bridgeDiameterMm;
    const plateWRef = useRef<number>(plateWidthMm);
    plateWRef.current = plateWidthMm;
    const plateDRef = useRef<number>(plateDepthMm);
    plateDRef.current = plateDepthMm;
    const editModeRef = useRef<EditMode>(editMode);
    editModeRef.current = editMode;
    const onAddSupportRef = useRef(onAddSupportAt);
    onAddSupportRef.current = onAddSupportAt;
    const onPickSupportRef = useRef(onPickSupport);
    onPickSupportRef.current = onPickSupport;
    const onMoveSupportRef = useRef(onMoveSupport);
    onMoveSupportRef.current = onMoveSupport;
    const onMoveBridgeCpRef = useRef(onMoveBridgeControlPoint);
    onMoveBridgeCpRef.current = onMoveBridgeControlPoint;
    const onMoveBridgeEndpointRef = useRef(onMoveBridgeEndpoint);
    onMoveBridgeEndpointRef.current = onMoveBridgeEndpoint;
    const onDoublePickStlRef = useRef(onDoublePickStl);
    onDoublePickStlRef.current = onDoublePickStl;
    const onDoublePickBridgeTubeRef = useRef(onDoublePickBridgeTube);
    onDoublePickBridgeTubeRef.current = onDoublePickBridgeTube;
    const onSelectBridgeControlPointRef = useRef(onSelectBridgeControlPoint);
    onSelectBridgeControlPointRef.current = onSelectBridgeControlPoint;
    const alignFloorModeRef = useRef<boolean>(!!alignFloorMode);
    alignFloorModeRef.current = !!alignFloorMode;
    const onAlignFaceToFloorRef = useRef(onAlignFaceToFloor);
    onAlignFaceToFloorRef.current = onAlignFaceToFloor;
    // dental-brush: 브러쉬 두께 + painted 변경 콜백 (effect 재실행 없이 최신 참조).
    const brushThicknessRef = useRef<number>(brushThicknessMm);
    brushThicknessRef.current = brushThicknessMm;
    const onPaintedFacesChangeRef = useRef(onPaintedFacesChange);
    onPaintedFacesChangeRef.current = onPaintedFacesChange;
    const onDentalResultsInvalidatedRef = useRef(onDentalResultsInvalidated);
    onDentalResultsInvalidatedRef.current = onDentalResultsInvalidated;
    const onBrushThicknessChangeRef = useRef(onBrushThicknessChange);
    onBrushThicknessChangeRef.current = onBrushThicknessChange;
    // dental-brush painted 점 (세션 상태 원본 = 원본 maskRef 방식 이식).
    // localPoint/localNormal/radius 로 저장 → STL 회전·이동을 자동 추적.
    const paintPointsRef = useRef<PaintPoint[]>([]);
    // painted 시각화 데칼 mesh (주황). painted 점과 index 1:1 대응.
    const paintOverlaysRef = useRef<Mesh[]>([]);
    // 마진 찾기 결과 캐시 (원본 marginRef 이식). stlId 로 어떤 STL 의 마진인지
    //   기록해 floodfill 이 활성 STL 의 마진만 사용하게 한다. null = 아직 미검출.
    const marginRef = useRef<
      | (FindMarginResult & { stlId: string })
      | null
    >(null);
    // 마진 라인 시각화 mesh(초록 튜브). stlId 를 metadata 에 담아 재검출 시 교체.
    const marginMarkersRef = useRef<Mesh[]>([]);
    // 마진 floodfill 로 자동 색칠된 face 집합 (원본 autoFillFacesRef 이식).
    //   ⚠️ painted(paintPointsRef) 계약과 별도 집합 — margin-detect/getPaintedFaceIds
    //   입력에는 포함하지 않는다 (원본 isMasked 3번째 인자 경로, 이 조각 밖).
    const autoFillFacesRef = useRef<Set<number>>(new Set());
    // 마진 floodfill 자동 색칠 시각화 오버레이 mesh (주황). autoFillFacesRef 와 세트.
    const autoFillOverlayRef = useRef<Mesh[]>([]);
    // 아일랜드 검출 결과 캐시 (원본 sliceDataRef 대응 축약). stlId 로 어떤 STL 의
    //   결과인지 기록. null = 미검출. 대형 중간산물은 보관하지 않는다 (감사 B7 —
    //   IslandResultSlim 참조). 시각화·통계는 검출 시점에 즉시 소비.
    const islandResultRef = useRef<IslandResultSlim | null>(null);
    // 아일랜드 face 마젠타 overlay mesh. stlId 를 metadata 에 담아 정리 시 구분.
    const islandMarkersRef = useRef<Mesh[]>([]);
    // 색칠 변경에 따른 마진·아일랜드 무효화(감사 B3)를 "지연" 실행하기 위한
    //   stlId → setTimeout 핸들 맵. **컴포넌트 레벨 ref 로 승격**했다: 이전에는
    //   브러쉬 effect 클로저 안 지역 Map 이라 검출 함수(runFindDentalMargin/
    //   runDetectDentalIslands)가 pending 을 취소할 수 없어, 칠→300ms 내 검출 시
    //   방금 만든 유효 결과를 만료 타이머가 지우는 레이스가 있었다. ref 로 올려
    //   검출 성공 경로에서도 cancelPendingInvalidation 을 호출할 수 있게 한다.
    const pendingInvalidationsRef = useRef<
      Map<string, ReturnType<typeof setTimeout>>
    >(new Map());
    // 컴포넌트 언마운트(씬 dispose 경로) 진행 표시. 브러쉬 effect cleanup 이
    //   모드 전환(마운트 유지)과 언마운트를 구분하는 데 쓴다. 씬-셋업 effect([])
    //   cleanup 이 언마운트에서만 실행되며 그 시작에서 true 로 세팅한다. 언마운트
    //   시엔 뒤이어 전체 dispose 가 오므로 pending 타이머는 clearTimeout 만 하고
    //   invalidate(=setState 유발) 는 호출하지 않는다. (React 는 언마운트 시 effect
    //   cleanup 을 선언 순서대로 실행 — 씬-셋업 effect 가 브러쉬 effect 보다 먼저
    //   선언돼 있어 브러쉬 cleanup 시점엔 이 플래그가 이미 true 다.)
    const isUnmountingRef = useRef(false);
    const selectedSupportRef = useRef<string | null>(selectedSupportId);
    selectedSupportRef.current = selectedSupportId;
    const bridgeModeRef = useRef<boolean>(bridgeMode);
    bridgeModeRef.current = bridgeMode;
    const selectedRef = useRef<ReadonlySet<string>>(selectedIds);
    selectedRef.current = selectedIds;
    const onPickRef = useRef(onPick);
    onPickRef.current = onPick;
    const onGizmoCommitRef = useRef(onGizmoCommit);
    onGizmoCommitRef.current = onGizmoCommit;

    function refreshHighlight() {
      const hl = highlightRef.current;
      if (!hl) return;
      hl.removeAllMeshes();
      for (const id of selectedRef.current) {
        const mesh = meshMapRef.current.get(id);
        if (mesh) hl.addMesh(mesh, HIGHLIGHT_COLOR);
      }
      const sSel = selectedSupportRef.current;
      if (sSel) {
        const sMesh = supportMeshMapRef.current.get(sSel);
        if (sMesh) hl.addMesh(sMesh, HIGHLIGHT_COLOR);
      }
    }

    /**
     * 모델 위 좌클릭+드래그로 XZ 평면 이동.
     * Y 는 모델의 현재 높이에서 고정 (수직 이동은 Gizmo/슬라이더로).
     */
    function attachDragBehavior(mesh: Mesh, fileId: string) {
      const drag = new PointerDragBehavior({
        dragPlaneNormal: new Vector3(0, 1, 0),
      });
      drag.useObjectOrientationForDragging = false;
      drag.moveAttached = true;
      // 좌클릭(0) 에서만 모델 XZ 이동을 시작한다. 기본값 [0,1,2] 는 모든 버튼에
      // 반응해, 모델 위에서 우드래그(팬)·휠드래그(회전) 를 이 behavior 가 먼저
      // 가로채 카메라 조작이 막혔다. dragButtons=[0] 이면 우/휠 드래그는
      // behavior 를 트리거하지 않고 카메라 pointer input 으로 그대로 전달된다.
      // (button 규약: MouseEvent.button — 0=Left, 1=Middle, 2=Right)
      drag.dragButtons = [0];

      drag.onDragStartObservable.add(() => {
        gizmoDragStartRef.current = {
          kind: "stl",
          id: fileId,
          t: readMeshTransform(mesh),
        };
      });
      drag.onDragEndObservable.add(() => {
        const started = gizmoDragStartRef.current;
        gizmoDragStartRef.current = null;
        if (!started || started.kind !== "stl") return;
        const end = readMeshTransform(mesh);
        // 마진·아일랜드 무효화(감사 B1)는 onGizmoCommit === handleCommitTransform
        // 으로 수렴하는 페이지 측에서 처리한다 (gizmo/드래그/수치입력/바닥면정렬 +
        // undo/redo 를 한 경로로 통일 — 씬 내부 이중 배선 방지).
        onGizmoCommitRef.current(started.id, started.t, end);
      });

      // 'support' 모드면 attach 보류 (mode effect 가 attach).
      if (editModeRef.current === "select") {
        mesh.addBehavior(drag);
      }
      dragBehaviorMapRef.current.set(fileId, drag);
    }

    function syncGizmo() {
      const pg = positionGizmoRef.current;
      const rg = rotationGizmoRef.current;
      const sg = scaleGizmoRef.current;
      if (!pg || !rg || !sg) return;

      // 'support' 모드:
      //   · Bridge 변곡점/끝점 sphere 선택됨 → PositionGizmo 가 그 sphere
      //     X/Y/Z 축으로 깊이 방향 정확 드래그 가능.
      //   · 그 외 + 단점 서포트 기둥 선택 → 기둥에 attach.
      if (editModeRef.current === "support") {
        const handleMesh = selectedBridgeSphereRef.current;
        if (handleMesh) {
          pg.attachedMesh = handleMesh;
          rg.attachedMesh = null;
          sg.attachedMesh = null;
          return;
        }
        const sid = selectedSupportRef.current;
        const sMesh = sid ? supportMeshMapRef.current.get(sid) ?? null : null;
        pg.attachedMesh = sMesh;
        rg.attachedMesh = null;
        sg.attachedMesh = null;
        return;
      }

      // 'dental-brush' 등 non-select 모드: Gizmo 전부 detach. select 진입
      //   유지된 선택으로 translate Gizmo 가 붙은 채 남아 브러쉬 색칠과
      //   모델 이동이 동시에 일어나던 문제 차단. effect 5 가 editMode 변경
      //   마다 syncGizmo 를 재호출하므로 select 복귀 시 자동 재attach.
      if (editModeRef.current !== "select") {
        pg.attachedMesh = null;
        rg.attachedMesh = null;
        sg.attachedMesh = null;
        return;
      }

      // 'select' 모드: 단일 STL 선택 + 사용자 gizmoMode 에 따라.
      const sel = Array.from(selectedRef.current);
      const single = sel.length === 1 ? sel[0] : null;
      const mesh = single ? meshMapRef.current.get(single) ?? null : null;
      const mode = gizmoModeRef.current;

      pg.attachedMesh = mode === "translate" ? mesh : null;
      rg.attachedMesh = mode === "rotate" ? mesh : null;
      sg.attachedMesh = mode === "scale" ? mesh : null;
    }

    /**
     * 활성 STL(선택된 것, 없으면 첫 STL) 의 id + mesh 를 반환. 마진/floodfill
     * 이 브러쉬 색칠과 같은 STL 을 대상으로 하도록 원본 findMarginSignal /
     * getActiveMesh 의 STL 선택 규칙을 그대로 따른다.
     */
    function getActiveStl(): { id: string; mesh: Mesh } | null {
      const ids = Array.from(selectedRef.current);
      let id: string | undefined = ids[0];
      if (!id) id = [...meshMapRef.current.keys()][0];
      if (!id) return null;
      const mesh = meshMapRef.current.get(id);
      return mesh ? { id, mesh } : null;
    }

    /**
     * 마진 시각화(초록 튜브) + floodfill 자동 색칠(주황) 을 정리한다.
     *   stlId 지정 시 그 STL 것만, 미지정 시 전부. marginRef 는 전부 지울 때만
     *   null 로 (부분 정리는 재검출 흐름에서 같은 STL 튜브만 교체하는 용도).
     */
    function disposeMarginVisualization(stlId?: string): void {
      marginMarkersRef.current = marginMarkersRef.current.filter((m) => {
        if (stlId === undefined || m.metadata?.stlId === stlId) {
          m.dispose(false, true);
          return false;
        }
        return true;
      });
      // floodfill 오버레이는 stlId 별 metadata 로 구분해 정리.
      autoFillOverlayRef.current = autoFillOverlayRef.current.filter((m) => {
        if (stlId === undefined || m.metadata?.stlId === stlId) {
          m.dispose(false, true);
          return false;
        }
        return true;
      });
      if (stlId === undefined) {
        marginRef.current = null;
        autoFillFacesRef.current = new Set();
      } else if (marginRef.current?.stlId === stlId) {
        marginRef.current = null;
        autoFillFacesRef.current = new Set();
      }
    }

    /**
     * 색칠 영역에서 마진을 찾아 초록 튜브로 시각화하고 결과를 marginRef 에 보관.
     *   원본 findMarginSignal useEffect 의 [UI/씬 의존부] 이식 — 알고리즘 코어는
     *   findMargin(margin-detect.ts, 잠금) 이 담당한다. 성공/실패를 반환해 호출자
     *   (useImperativeHandle)가 패널로 전달한다.
     */
    function runFindDentalMargin():
      | { ok: true; stats: FindMarginStats }
      | { ok: false; reason: string } {
      const scene = sceneRef.current;
      if (!scene) return { ok: false, reason: "씬이 준비되지 않았습니다." };
      const active = getActiveStl();
      if (!active) {
        // 원본 console.warn('마진 찾기: 대상 STL이 없습니다.') → UI 문구.
        return { ok: false, reason: "대상 STL이 없습니다." };
      }
      const { id: stlId, mesh } = active;
      // painted 계약 그대로 — 이 STL 의 색칠 face index (autoFill 제외 버전).
      const paintedFaceIds = computePaintedFaceIds(mesh, paintPointsRef.current);

      const res = findMargin({
        mesh,
        paintedFaceIds,
        brushThickness: brushThicknessRef.current,
      });
      if (!res.ok) {
        // 원본 각 early-return console.warn 문구를 사용자 UI 문구로 변환.
        const reasonText: Record<typeof res.reason, string> = {
          "no-geometry": "모델 지오메트리를 읽을 수 없습니다.",
          "no-painted-faces":
            "색칠 영역이 없습니다. 먼저 브러쉬로 마진 부근을 칠하세요.",
          "no-seed":
            "색칠 영역 안에서 마진(급격히 꺾이는 모서리)을 찾지 못했습니다. 마진 라인 위를 칠했는지 확인하세요.",
          "empty-margin": "마진 라인을 구성하지 못했습니다.",
        };
        return { ok: false, reason: reasonText[res.reason] };
      }

      // 모든 STL 의 기존 마진 시각화·floodfill 을 정리한다 (감사 B4). marginRef 는
      //   단일 슬롯이므로 다른 STL 의 초록 튜브가 남으면 "보이지만 무효"가 된다
      //   (A 검출 → B 검출 시 A 튜브 잔존). 검출 진입 시 전체를 지워 화면=단일 슬롯
      //   유효 결과를 일치시킨다. floodfill 오버레이·autoFillFacesRef 도 함께 초기화.
      //   (아일랜드는 다른 단일 슬롯 — 여기서 건드리지 않는다. 마진+아일랜드 공존이
      //   autoSupportIslands 마진 가드의 전제이므로 교차 정리는 하지 않는다. 다중
      //   STL 을 개별 슬롯으로 동시에 유지하려면 향후 Map 다중화가 옵션이나, 현재는
      //   단일 슬롯 의미론을 유지한다.)
      disposeMarginVisualization();
      marginRef.current = { ...res.result, stlId };
      // 이 검출이 최신 painted 를 방금 소비했으므로, 색칠 스트로크가 예약해 둔
      //   지연 무효화는 무의미해진다. 취소하지 않으면 300ms 뒤 만료 타이머가
      //   방금 만든 이 유효 마진을 지워버린다(신선 결과 파괴 레이스).
      cancelPendingInvalidation(stlId);

      // 마진 라인 — 각 세그먼트를 얇은 튜브로 만들고 merge (원본 verbatim).
      //   WebGL LineSystem 은 thickness 1px 고정 → 두꺼운 선 표현 불가 →
      //   3D 튜브로 대체. 모델과 같은 렌더링 그룹 + 깊이 검사로 투과 없이 표시.
      const tubeBatch: Mesh[] = [];
      for (const e of res.result.edges) {
        const len = Vector3.Distance(e.pa, e.pb);
        if (len < 1e-6) continue;
        const tube = MeshBuilder.CreateTube(
          "v2_marginSeg",
          {
            path: [e.pa, e.pb],
            radius: 0.025, // ≈ 0.05mm 두께 (절반)
            tessellation: 6,
            cap: Mesh.NO_CAP,
          },
          scene,
        );
        tubeBatch.push(tube);
      }
      if (tubeBatch.length > 0) {
        const marginMesh = Mesh.MergeMeshes(
          tubeBatch,
          true,
          true,
          undefined,
          false,
          false,
        );
        if (marginMesh) {
          marginMesh.name = "v2_marginLines";
          marginMesh.isPickable = false;
          marginMesh.renderingGroupId = 0;
          marginMesh.metadata = { stlId };
          const mat = new StandardMaterial("v2_marginMat", scene);
          mat.emissiveColor = new Color3(0.2, 1, 0.4);
          mat.diffuseColor = new Color3(0, 0, 0);
          mat.disableLighting = true;
          marginMesh.material = mat;
          marginMesh.setParent(mesh); // STL 회전·이동 추종 (원본 이식).
          marginMarkersRef.current.push(marginMesh);
        }
      }

      // 원본 console.log 문구 이식 (통계 — 디버그용).
      const s = res.result.stats;
      console.log(
        `[마진 찾기] 색칠 ${s.paintedFaceCount}면 · 시드 엣지 ${s.seedEdgeCount} · ` +
          `전역 sharp 엣지 ${s.globalSharpEdgeCount} · 마진 엣지 ${s.marginEdgeCount} (spur-trim + corner-ext 후) · ` +
          `corner extension ${s.cornerExtSteps}스텝 · 작은-컴포넌트 폐기 ${s.droppedTinyComps}엣지 · ` +
          `endpoint bridge ${s.surfacePathCount}쌍(${s.bridgeSegCount}세그) · 직선폴백 ${s.straightFallbackCount}쌍 · ` +
          `컴포넌트 간 bridge ${s.interCompPathCount}쌍 (region R=${s.seedRegionR.toFixed(1)}mm)`,
      );

      return { ok: true, stats: s };
    }

    /**
     * 아일랜드 마젠타 overlay + 결과 ref 를 정리한다.
     *   stlId 지정 시 그 STL 것만, 미지정 시 전부. islandResultRef 는 전부 지울 때
     *   또는 같은 STL 재검출 시 null 로.
     */
    function disposeIslandVisualization(stlId?: string): void {
      islandMarkersRef.current = islandMarkersRef.current.filter((m) => {
        if (stlId === undefined || m.metadata?.stlId === stlId) {
          m.dispose(false, true);
          return false;
        }
        return true;
      });
      if (stlId === undefined) {
        islandResultRef.current = null;
      } else if (islandResultRef.current?.stlId === stlId) {
        islandResultRef.current = null;
      }
    }

    /**
     * 한 STL 의 마진·아일랜드 검출 결과를 stale 로 간주해 일괄 무효화한다
     * (감사 B1/B3). world 좌표 기반 검출 결과가 STL 변형(회전·이동)이나
     * 색칠 변경 후 옛 좌표를 참조하는 것을 막는다.
     *   · disposeMarginVisualization(stlId): 초록 튜브 + marginRef + floodfill
     *     오버레이(주황) + autoFillFacesRef 정리
     *   · disposeIslandVisualization(stlId): 마젠타 overlay + islandResultRef 정리
     *   · onDentalResultsInvalidated: 페이지의 marginStatus/islandStatus 리셋
     *
     * UX 변화: 사용자가 STL 을 회전/이동하거나 칠을 바꾸면 초록 튜브·마젠타가
     * 즉시 사라지고 dental 패널이 초기 상태로 돌아간다 — "재검출 필요"가
     * 명시적이 되어, 옛 좌표 기준으로 자동 서포트가 배치되는 사고를 막는다.
     * (해당 STL 에 검출 결과가 없으면 아무 일도 하지 않는다.)
     */
    function invalidateDentalResults(stlId: string): void {
      const hadMargin = marginRef.current?.stlId === stlId;
      const hadIsland = islandResultRef.current?.stlId === stlId;
      if (!hadMargin && !hadIsland) return;
      disposeMarginVisualization(stlId);
      disposeIslandVisualization(stlId);
      onDentalResultsInvalidatedRef.current?.(stlId);
    }

    /**
     * 예약된 지연 무효화 타이머를 취소한다 (해당 stlId 것만).
     *   · 더블탭 floodfill 경로: 첫 클릭이 예약한 무효화를 취소해 marginRef 유지
     *     (감사 B3 회귀 방지, 원본 워크플로우).
     *   · 검출 성공 경로: 검출이 최신 painted 를 이미 소비했으므로 그 예약은
     *     무의미 — 만료 시 방금 만든 유효 결과를 지우는 레이스를 없앤다.
     *   pendingInvalidationsRef(컴포넌트 레벨) 를 참조하므로 브러쉬 effect 안팎
     *   어디서든(검출 함수 포함) 호출 가능하다.
     */
    function cancelPendingInvalidation(stlId: string): void {
      const t = pendingInvalidationsRef.current.get(stlId);
      if (t !== undefined) {
        clearTimeout(t);
        pendingInvalidationsRef.current.delete(stlId);
      }
    }

    /**
     * 색칠 변경에 따른 무효화를 더블클릭 윈도우(Scene.DoubleClickDelay, 기본
     * 300ms)만큼 미뤄 예약한다.
     *   ⚠️ 왜 지연인가: 마진→더블탭 채우기 워크플로우에서 더블클릭의 "첫 클릭"
     *   이 painted 를 바꿔 POINTERUP flush 가 즉시 marginRef 를 null 로 만들면,
     *   뒤이어 도착하는 POINTERDOUBLETAP 의 fillMarginFromFace 가 마진 없음으로
     *   거부된다(회귀). 따라서 painted "통지"는 즉시 하되, "무효화"만 미룬다. 그
     *   사이 더블탭이 오거나 검출이 실행되면 cancelPendingInvalidation 으로 취소.
     */
    function scheduleInvalidation(stlId: string): void {
      cancelPendingInvalidation(stlId); // 중복 예약 방지 (직전 예약을 갱신).
      const t = setTimeout(() => {
        pendingInvalidationsRef.current.delete(stlId);
        invalidateDentalResults(stlId);
      }, Scene.DoubleClickDelay);
      pendingInvalidationsRef.current.set(stlId, t);
    }

    /**
     * 활성 STL 전체에 대해 슬라이스 기반 아일랜드(미지지 영역)를 검출하고 마젠타
     * overlay 로 시각화한다.
     *   원본 STLViewer 의 detectIslandsSignal useEffect [씬/시각화 의존부] 이식 —
     *   알고리즘 코어는 detectSliceIslands(island-detection.ts, 잠금) 담당.
     *   호출 파라미터는 원본과 동일:
     *     · cellSize = layerHeight = lh (원본 sliceLayerHeight)
     *     · supportAngle 45° (원본 DEFAULT_SUPPORT_SETTINGS.supportAngle — v2 에는
     *       support-settings ref 가 없어 그 기본값을 명시. detectSliceIslands 의
     *       supportAngle ?? 45 기본과도 동일 → 수치 무변경.)
     *     · downFacingOnly true · minIslandCells 1 · plateGap 0
     *   debugLayers 는 전달하지 않는다(원본의 임시 진단 [41,42,43] 은 v2 에서 비활성이
     *   정답 — 지현규 문서 Step 2 의도).
     */
    function runDetectDentalIslands(layerHeightMm?: number):
      | { ok: true; stats: IslandStats }
      | { ok: false; reason: string } {
      const scene = sceneRef.current;
      if (!scene) return { ok: false, reason: "씬이 준비되지 않았습니다." };
      const active = getActiveStl();
      if (!active) {
        // 원본 console.warn('Island 검출: 대상 STL이 없습니다.') → UI 문구.
        return { ok: false, reason: "대상 STL이 없습니다." };
      }
      const { id: stlId, mesh } = active;

      // 현재 STL 각도(회전/이동) 정확 반영 — worldMatrix 갱신 (원본 이식).
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo();

      const tris = readWorldTriangles(mesh);
      if (tris.length === 0) {
        // 원본 console.warn('Island 검출: 분석할 삼각형이 없습니다.') → UI 문구.
        return { ok: false, reason: "분석할 삼각형이 없습니다." };
      }

      const lh = layerHeightMm ?? 0.05; // 원본 sliceLayerHeight 기본 0.05mm.
      const t0 = performance.now();
      const result = detectSliceIslands({
        tris,
        cellSize: lh, // 라스터화 정밀도 = layer 두께 (원본 verbatim).
        layerHeight: lh,
        // 원본 supportSettingsRef.current.supportAngle (기본 45°). v2 는 support
        //   설정 ref 가 없어 그 기본값을 명시 — detectSliceIslands 기본과 동일.
        supportAngle: 45,
        // 위 향한 면(n.y > 0)은 서포트 불필요 → island 결과에서 제외 (원본 verbatim).
        downFacingOnly: true,
        minIslandCells: 1, // 슬라이스 sim 미지지 정의 일치 — 1-cell piece 도 포착.
        plateGap: 0, // plate 인접 layer 도 island 검출 (낮은 Y 의 piece 도 포착).
        // debugLayers 전달 안 함 — 원본 임시 진단 [41,42,43] 은 v2 에서 비활성.
      });
      const tDetect = performance.now() - t0;

      // 모든 STL 의 기존 island 시각화를 정리한다 (감사 B4). islandResultRef 는 단일
      //   슬롯이므로 다른 STL 의 마젠타 overlay 가 남으면 "보이지만 무효"가 된다.
      //   검출 진입 시 전체를 지워 화면=단일 슬롯 유효 결과를 일치시킨다. (마진은
      //   다른 단일 슬롯 — 여기서 건드리지 않는다: 마진+아일랜드 공존이
      //   autoSupportIslands 마진 가드의 전제. 위 runFindDentalMargin 주석 참조.)
      disposeIslandVisualization();
      // 슬림 보관 (감사 B7): islandFaces + stlId 만. result 의 나머지 대형 중간산물
      //   (sliceCells/sliceFaceCells/perLayer*)은 아래 overlay·통계 계산에서 지역
      //   변수 result 로 즉시 소비하고 폐기 — ref 로 세션 상주시키지 않는다.
      islandResultRef.current = { stlId, islandFaces: result.islandFaces };
      // 마진 검출과 동일 이유 — 이 검출이 최신 painted 를 소비했으므로 색칠이
      //   예약한 지연 무효화를 취소한다. 없으면 만료 타이머가 방금 만든 이 유효
      //   아일랜드 결과를 지운다(신선 결과 파괴 레이스).
      cancelPendingInvalidation(stlId);

      // Island face overlay — 검출된 island face 의 실제 STL triangle 을 표면
      //   conforming 마젠타로 표시 (원본 시각화 verbatim). mesh index 버퍼에서
      //   local vertex 를 직접 읽어 overlay.parent=mesh 로 얹는다.
      const meshIndices = mesh.getIndices();
      const meshPositions = mesh.getVerticesData("position");
      if (meshIndices && meshPositions && result.islandFaces.size > 0) {
        const positions: number[] = [];
        const indices: number[] = [];
        let vIdx = 0;
        for (const f of result.islandFaces) {
          for (let kk = 0; kk < 3; kk++) {
            const vi = meshIndices[f * 3 + kk];
            positions.push(
              meshPositions[vi * 3],
              meshPositions[vi * 3 + 1],
              meshPositions[vi * 3 + 2],
            );
          }
          indices.push(vIdx, vIdx + 1, vIdx + 2);
          vIdx += 3;
        }
        if (indices.length > 0) {
          const overlay = new Mesh("v2_islandFaces", scene);
          const vd = new VertexData();
          vd.positions = positions;
          vd.indices = indices;
          const norms: number[] = [];
          VertexData.ComputeNormals(positions, indices, norms);
          vd.normals = norms;
          vd.applyToMesh(overlay);
          const mat = new StandardMaterial("v2_islandFacesMat", scene);
          mat.emissiveColor = new Color3(1.0, 0.2, 0.85); // 마젠타 (원본 verbatim).
          mat.diffuseColor = new Color3(0, 0, 0);
          mat.specularColor = new Color3(0, 0, 0);
          mat.disableLighting = true;
          mat.backFaceCulling = false;
          mat.zOffset = -1; // STL 표면보다 살짝 앞으로 — z-fighting 차단.
          overlay.material = mat;
          overlay.isPickable = false;
          overlay.renderingGroupId = 0;
          overlay.metadata = { stlId, kind: "islandFaces" };
          // local vertex → 직접 parent 할당 (setParent 아님 — worldMatrix 승계).
          overlay.parent = mesh;
          islandMarkersRef.current.push(overlay);
        }
      }

      const layersWithIsland = result.perLayerIslandCount.reduce(
        (n, c) => (c > 0 ? n + 1 : n),
        0,
      );

      // 원본 console.log 문구 이식 (통계 — 디버그용).
      const totalIslandCells = result.perLayerIslandCells.reduce(
        (s, c) => s + c.size,
        0,
      );
      console.log(
        `[Island 검출] 전체 face ${tris.length} · island face ${result.islandFaces.size} · ` +
          `island cell ${totalIslandCells} · layers ${result.nSlices} · ` +
          `layerHeight ${result.layerHeight}mm · cellSize ${result.cellSize}mm · ` +
          `supportAngle 45° (dSafe ${result.dSafe.toFixed(3)}mm, prevLayers ${result.prevLayers}, ` +
          `cellAdjR ${result.cellAdjR}) · ${tDetect.toFixed(0)}ms`,
      );

      return {
        ok: true,
        stats: {
          totalIslandFaces: result.islandFaces.size,
          nSlices: result.nSlices,
          layersWithIsland,
          layerHeight: result.layerHeight,
        },
      };
    }

    /**
     * 마진 안쪽 face floodfill — startFace 를 시작으로 마진 엣지(edgeKeys)를 차단
     * 벽 삼아 BFS 로 내부 face 를 모으고 주황 오버레이로 채운다.
     *   원본 fillFromFace 이식. 결과는 autoFillFacesRef (painted 계약과 별도 집합)
     *   에 저장하고 오버레이 mesh 는 mesh.parent 로 부착해 회전을 추종한다.
     */
    function fillMarginFromFace(stlId: string, startFace: number): void {
      const scene = sceneRef.current;
      if (!scene) return;
      const mesh = meshMapRef.current.get(stlId);
      if (!mesh) return;
      const margin = marginRef.current;
      if (!margin || margin.stlId !== stlId || !margin.canon) {
        // 원본 console.warn('마진 색칠: 먼저 "마진 찾기" 를 실행하세요.') 대응.
        console.warn('마진 색칠: 먼저 "마진 찾기" 를 실행하세요.');
        return;
      }
      const meshIndices = mesh.getIndices();
      if (!meshIndices) return;
      const canon = margin.canon;

      // 마진 엣지(canonical "a,b") 를 차단 벽으로 BFS. (원본 fillFromFace verbatim —
      //   3D 근접 차단(bridge wall)은 원본에서 이미 비활성이라 옮기지 않음.)
      const ek = (a: number, b: number): string =>
        a < b ? `${a},${b}` : `${b},${a}`;
      const edgeToFaces = new Map<string, number[]>();
      const triCount = meshIndices.length / 3;
      for (let f = 0; f < triCount; f++) {
        const ia = canon[meshIndices[f * 3]];
        const ib = canon[meshIndices[f * 3 + 1]];
        const ic = canon[meshIndices[f * 3 + 2]];
        for (const [a, b] of [
          [ia, ib],
          [ib, ic],
          [ic, ia],
        ] as const) {
          const k = ek(a, b);
          let arr = edgeToFaces.get(k);
          if (!arr) {
            arr = [];
            edgeToFaces.set(k, arr);
          }
          arr.push(f);
        }
      }
      // BFS face → face, 마진 엣지 차단.
      const filled = new Set<number>([startFace]);
      const queue: number[] = [startFace];
      let head = 0;
      while (head < queue.length) {
        const f = queue[head++];
        const ia = canon[meshIndices[f * 3]];
        const ib = canon[meshIndices[f * 3 + 1]];
        const ic = canon[meshIndices[f * 3 + 2]];
        const ef: [number, number][] = [
          [ia, ib],
          [ib, ic],
          [ic, ia],
        ];
        for (const [a, b] of ef) {
          const k = ek(a, b);
          if (margin.edgeKeys.has(k)) continue; // 명시적 마진 엣지 = 차단 벽.
          const adj = edgeToFaces.get(k);
          if (!adj) continue;
          for (const nb of adj) {
            if (nb === f) continue;
            if (filled.has(nb)) continue;
            filled.add(nb);
            queue.push(nb);
          }
        }
      }
      autoFillFacesRef.current = filled;

      // 시각화 — 이전 floodfill 오버레이를 전부 제거 후 새로 생성 (원본 fillFromFace
      //   verbatim). autoFillFacesRef 는 단일 전역 Set 이라 floodfill 은 한 번에 한
      //   영역만 존재 → 위에서 filled 로 덮어쓴 순간 다른 STL 의 이전 fill 은 추적에서
      //   벗어난다. 오버레이도 stlId 불문 전부 지워야 다른 STL 의 orphan 잔존(2-3b
      //   잔여 ②)을 막는다.
      for (const m of autoFillOverlayRef.current) m.dispose(false, true);
      autoFillOverlayRef.current = [];
      const meshPositions = mesh.getVerticesData("position");
      if (!meshPositions) return;
      const positions: number[] = [];
      const indices: number[] = [];
      let vIdx = 0;
      for (const f of filled) {
        for (let kk = 0; kk < 3; kk++) {
          const vi = meshIndices[f * 3 + kk];
          positions.push(
            meshPositions[vi * 3],
            meshPositions[vi * 3 + 1],
            meshPositions[vi * 3 + 2],
          );
        }
        indices.push(vIdx, vIdx + 1, vIdx + 2);
        vIdx += 3;
      }
      if (indices.length === 0) return;
      const overlay = new Mesh("v2_maskAutoFill", scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      const norms: number[] = [];
      VertexData.ComputeNormals(positions, indices, norms);
      vd.normals = norms;
      vd.applyToMesh(overlay);
      const mat = new StandardMaterial("v2_maskAutoFillMat", scene);
      mat.emissiveColor = new Color3(0.96, 0.52, 0.13); // 주황 (painted 와 동일 톤).
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.zOffset = -1;
      overlay.material = mat;
      overlay.isPickable = false;
      overlay.metadata = { stlId };
      // 직접 parent 할당 — overlay vertex 가 LOCAL mesh 좌표라서 setParent 대신
      //   parent= 로 attach 해야 worldMatrix = mesh.worldMatrix 로 올바르게 얹힌다.
      overlay.parent = mesh;
      autoFillOverlayRef.current.push(overlay);
      console.log(
        `[마진 색칠] 시작 face ${startFace} → 자동 색칠 ${filled.size}/${triCount}`,
      );
    }

    // 1) 씬 부트스트랩
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
      });
      const scene = new Scene(engine);
      // ChiTuBox 풍 어두운 회색 배경. 모델의 청록색이 더 또렷.
      scene.clearColor = new Color4(0.36, 0.37, 0.4, 1);
      // ambient 줄여 그림자/대비 강화 (옛: 0.45 → 0.22).
      scene.ambientColor = new Color3(0.22, 0.23, 0.26);

      // Bridge handle (A/B/변곡점 sphere) 용 별도 렌더링 그룹.
      // 그룹 1 그릴 때 depth buffer 를 새로 클리어 → 모델 안에 박혀
      // 있어도 항상 위에 보인다.
      scene.setRenderingAutoClearDepthStencil(1, true, true, false);

      const camera = new ArcRotateCamera(
        "cam",
        -Math.PI / 4,
        Math.PI / 3,
        300,
        Vector3.Zero(),
        scene,
      );
      camera.attachControl(canvas, true);
      // wheelPrecision 은 휠 입력에 대한 "나눗셈" 계수 → 값이 작을수록
      // 한 노치당 줌이 커진다. 5.0 = Babylon 기본 (30) 대비 6 배.
      camera.wheelPrecision = 5.0;
      camera.minZ = 0.1;
      camera.panningSensibility = 50;
      camera.inertia = 0.7;

      // ChiTuBox 풍: 위는 강하게, 옆/아래는 약하게 → 윗면 밝고 옆면
      // 어두운 명확한 그림자 대비. 라이트 4 개 다 hemispheric 으로
      // 부드러운 wrap-around 유지하면서 상대 intensity 만 조정.
      const lightTop = new HemisphericLight(
        "lightTop",
        new Vector3(0.2, 1, 0.3),
        scene,
      );
      lightTop.intensity = 1.05; // 위 빛 강화 (0.7 → 1.05)
      lightTop.diffuse = new Color3(1, 1, 1);
      lightTop.specular = new Color3(0.05, 0.05, 0.05);

      const lightBottom = new HemisphericLight(
        "lightBottom",
        new Vector3(0, -1, 0),
        scene,
      );
      lightBottom.intensity = 0.06; // 아래 거의 끔 (0.2 → 0.06)

      // 측면 보강 — cylinder 등 둥근 모델 옆면이 새카매지지 않게.
      const lightSideA = new HemisphericLight(
        "lightSideA",
        new Vector3(-1, 0.3, 0.4),
        scene,
      );
      lightSideA.intensity = 0.18; // 0.4 → 0.18
      lightSideA.specular = new Color3(0.03, 0.03, 0.03);

      const lightSideB = new HemisphericLight(
        "lightSideB",
        new Vector3(1, 0.3, -0.4),
        scene,
      );
      lightSideB.intensity = 0.18; // 0.4 → 0.18
      lightSideB.specular = new Color3(0.03, 0.03, 0.03);

      // 빌드플레이트 / 그리드는 별도 plate effect 에서 생성·재생성한다.

      supportMaterialRef.current = createSupportMaterial(scene);
      // manifold-3d wasm async load. ready 후 manifoldModuleRef.current set.
      // STL 이 이미 로드되어 있으면 별도 effect 에서 stlManifoldMap 생성.
      void ensureManifoldReady().then((mod) => {
        manifoldModuleRef.current = mod;
      });
      const bridgeMat = new StandardMaterial("v2_bridge_marker_mat", scene);
      bridgeMat.diffuseColor = new Color3(1.0, 0.55, 0.15);
      bridgeMat.emissiveColor = new Color3(0.6, 0.3, 0.1);
      bridgeMat.specularColor = new Color3(0, 0, 0);
      bridgeMarkerMatRef.current = bridgeMat;

      // Bridge 변곡점 핸들 (노란 sphere) 용 material.
      const cpMat = new StandardMaterial("v2_bridge_cp_mat", scene);
      cpMat.diffuseColor = new Color3(1.0, 0.85, 0.1);
      cpMat.emissiveColor = new Color3(0.5, 0.42, 0.05);
      cpMat.specularColor = new Color3(0, 0, 0);
      bridgeCpMatRef.current = cpMat;

      // Bridge B 끝점 (청록) — A 는 기존 주황 marker mat 재사용.
      const bMat = new StandardMaterial("v2_bridge_b_mat", scene);
      bMat.diffuseColor = new Color3(0.2, 0.7, 0.85);
      bMat.emissiveColor = new Color3(0.1, 0.4, 0.5);
      bMat.specularColor = new Color3(0, 0, 0);
      bridgeBMatRef.current = bMat;

      sliceModelMatRef.current = createSliceFillMaterial(
        scene,
        new Color3(0.85, 0.86, 0.9),
        "v2_slice_model_mat",
      );
      sliceSupportMatRef.current = createSliceFillMaterial(
        scene,
        new Color3(0.55, 0.7, 0.95),
        "v2_slice_support_mat",
      );

      const hl = new HighlightLayer("v2_highlight", scene, {
        blurHorizontalSize: 0.6,
        blurVerticalSize: 0.6,
      });
      hl.innerGlow = false;
      hl.outerGlow = true;
      highlightRef.current = hl;

      // Gizmo: UtilityLayer 위에 세 종류를 한 번씩만 만들고 영속화한다.
      // 모드 전환은 attachedMesh = null/target 로만 처리 → 인스턴스
      // 재생성·콜백 재바인딩 비용이 없다.
      //
      // ⚠️ autoClearDepthAndStencil 은 기본값(true) 유지. false 로
      // 두면 메인 scene 의 depth buffer 가 그대로 남아 gizmo 가
      // 모델 뒤로 가려진다.
      const utility = new UtilityLayerRenderer(scene);

      const positionGizmo = new PositionGizmo(utility);
      const rotationGizmo = new RotationGizmo(utility);
      const scaleGizmo = new ScaleGizmo(utility);

      // 모델이 작을 때 (10mm 단위) 화살표가 묻혀 보이는 걸 막기 위해
      // scaleRatio 를 키운다.
      const SCALE = 1.8;
      positionGizmo.scaleRatio = SCALE;
      rotationGizmo.scaleRatio = SCALE;
      scaleGizmo.scaleRatio = SCALE;

      const onDragStart = () => {
        const attached = positionGizmo.attachedMesh;
        if (attached) {
          const meta = (
            attached as {
              metadata?: {
                type?: string;
                supportId?: string;
                cpIdx?: number;
                which?: "base" | "contact";
              };
            }
          ).metadata;
          // Bridge 변곡점 sphere 드래그.
          if (
            meta?.type === "bridge-cp" &&
            meta.supportId &&
            typeof meta.cpIdx === "number"
          ) {
            gizmoDragStartRef.current = {
              kind: "bridge-cp",
              id: meta.supportId,
              cpIdx: meta.cpIdx,
            };
            return;
          }
          // Bridge 끝점 sphere 드래그.
          if (meta?.type === "bridge-ep" && meta.supportId && meta.which) {
            gizmoDragStartRef.current = {
              kind: "bridge-ep",
              id: meta.supportId,
              which: meta.which,
            };
            return;
          }
          // 단점 서포트 기둥 이동.
          if (meta?.type === "support" && meta.supportId) {
            gizmoDragStartRef.current = {
              kind: "support",
              id: meta.supportId,
            };
            return;
          }
        }
        // STL transform (기존).
        const sel = Array.from(selectedRef.current);
        if (sel.length !== 1) return;
        const id = sel[0];
        const mesh = meshMapRef.current.get(id);
        if (!mesh) return;
        gizmoDragStartRef.current = {
          kind: "stl",
          id,
          t: readMeshTransform(mesh),
        };
        // STL drag 중 race 차단: 영향 받는 supports mesh 들을 STL
        // mesh 의 child 로 임시 설정. drag 진행하는 동안 Babylon 이
        // world transform 자동 동기 → mesh 가 STL 따라 즉시 움직임.
        // setParent 는 world 위치 유지하면서 local 좌표 자동 계산.
        const supports = supportsRef.current;
        for (const [supId, supMesh] of supportMeshMapRef.current) {
          const sup = supports.find((s) => s.id === supId);
          if (
            sup &&
            (sup.stlId === id || sup.baseStlId === id)
          ) {
            supMesh.setParent(mesh);
          }
        }
      };
      const onDragEnd = () => {
        const started = gizmoDragStartRef.current;
        gizmoDragStartRef.current = null;
        if (!started) return;
        if (started.kind === "bridge-cp") {
          const sphere = selectedBridgeSphereRef.current;
          if (!sphere) return;
          onMoveBridgeCpRef.current(started.id, started.cpIdx, [
            sphere.position.x,
            sphere.position.y,
            sphere.position.z,
          ]);
          return;
        }
        if (started.kind === "bridge-ep") {
          const sphere = selectedBridgeSphereRef.current;
          if (!sphere) return;
          const meta = (
            sphere as {
              metadata?: { normal?: [number, number, number] };
            }
          ).metadata;
          const stored = undoLift(
            {
              x: sphere.position.x,
              y: sphere.position.y,
              z: sphere.position.z,
            },
            meta?.normal,
          );
          onMoveBridgeEndpointRef.current(started.id, started.which, stored);
          return;
        }
        if (started.kind === "support") {
          const sMesh = supportMeshMapRef.current.get(started.id);
          if (!sMesh) return;
          // disc 는 world-baked geometry (mesh.position = 원점)이라 trunk
          //   처럼 position.x/z 로 base 이동을 표현할 수 없다. 좌표 손상을
          //   막기 위해 disc 기둥 gizmo 이동은 무시한다 (선택·삭제는 유지).
          //   재배치가 필요하면 삭제 후 다시 배치. (trunk 이동 경로 무변경.)
          const sup = supportsRef.current.find((s) => s.id === started.id);
          if (sup?.variant === "disc") {
            // gizmo 가 옮긴 만큼 원위치로 되돌린다 (baked geometry 라
            //   position=원점이 정상 상태 → 시각적 잔상 방지).
            sMesh.position.set(0, 0, 0);
            return;
          }
          onMoveSupportRef.current(started.id, [
            sMesh.position.x,
            sMesh.position.z,
          ]);
          return;
        }
        const mesh = meshMapRef.current.get(started.id);
        if (!mesh) return;
        // STL drag 종료 — supports mesh 의 parent 해제. setParent(null)
        // 은 world transform 유지하면서 parent 만 푸는 안전한 호출.
        for (const supMesh of supportMeshMapRef.current.values()) {
          if (supMesh.parent === mesh) {
            supMesh.setParent(null);
          }
        }
        const end = readMeshTransform(mesh);
        // 무효화(감사 B1)는 페이지 측 handleCommitTransform 수렴점에서 처리.
        onGizmoCommitRef.current(started.id, started.t, end);
      };
      [positionGizmo, rotationGizmo, scaleGizmo].forEach((giz) => {
        giz.onDragStartObservable.add(onDragStart);
        giz.onDragEndObservable.add(onDragEnd);
      });

      utilityLayerRef.current = utility;
      positionGizmoRef.current = positionGizmo;
      rotationGizmoRef.current = rotationGizmo;
      scaleGizmoRef.current = scaleGizmo;

      // 더블 클릭:
      //   · STL mesh (select 모드)         → 회전 모드 활성화 신호
      //   · Bridge tube (support 모드)     → 그 위치에 변곡점 추가
      scene.onPointerObservable.add((info) => {
        if (info.type !== PointerEventTypes.POINTERDOUBLETAP) return;
        const evt = info.event as PointerEvent;
        if (evt.button !== 0) return;
        const picked = info.pickInfo?.pickedMesh;
        if (!picked) return;

        // Bridge tube?
        const meta = (
          picked as {
            metadata?: { type?: string; supportId?: string };
          }
        ).metadata;
        if (
          editModeRef.current === "support" &&
          meta?.type === "support" &&
          meta.supportId &&
          info.pickInfo?.pickedPoint
        ) {
          const p = info.pickInfo.pickedPoint;
          onDoublePickBridgeTubeRef.current?.(meta.supportId, [p.x, p.y, p.z]);
          return;
        }

        // STL mesh?
        if (editModeRef.current !== "select") return;
        for (const [id, mesh] of meshMapRef.current) {
          if (mesh === picked) {
            onDoublePickStlRef.current?.(id);
            return;
          }
        }
      });

      // 클릭 픽업: 좌클릭으로 단순 클릭 (드래그 없는) 시 mesh 픽.
      // 메쉬 위면 선택, 빈 공간이면 선택 해제.
      scene.onPointerObservable.add((info) => {
        if (info.type !== PointerEventTypes.POINTERPICK) return;
        const evt = info.event as PointerEvent;
        if (evt.button !== 0) return; // 좌클릭만

        let picked = info.pickInfo?.pickedMesh;

        // support 모드 — Bridge sphere (A/B/변곡점) 가 STL 안에 묻혀
        // ray 가 STL 을 먼저 잡는 경우 우선 픽. 같은 ray 위에 sphere 가
        // 있으면 그것 채택. 없으면 STL 그대로.
        if (
          editModeRef.current === "support" &&
          bridgeCpMeshesRef.current.length > 0 &&
          picked &&
          !bridgeCpMeshesRef.current.includes(picked as Mesh)
        ) {
          const spherePick = scene.pick(
            scene.pointerX,
            scene.pointerY,
            (m) => bridgeCpMeshesRef.current.includes(m as Mesh),
          );
          if (spherePick?.pickedMesh) {
            picked = spherePick.pickedMesh;
          }
        }

        // 'support' 모드:
        //   · Bridge sub-mode 면 기둥 픽도 endpoint 로 → onAddSupportAt.
        //   · 그 외 기둥 픽 → 선택. 모델 표면 픽 → 추가.
        //   · 빈 공간 픽 → 선택 해제 (bridge 모드는 무시, Esc 로 취소).
        if (editModeRef.current === "support") {
          const bridge = bridgeModeRef.current;

          if (!picked) {
            selectedBridgeSphereRef.current = null;
            syncGizmo();
            if (!bridge) onPickSupportRef.current(null);
            return;
          }
          const meta = (
            picked as {
              metadata?: {
                type?: string;
                supportId?: string;
                stlId?: string;
                cpIdx?: number;
              };
            }
          ).metadata;

          // 변곡점 sphere 단일 클릭 → 선택 + PositionGizmo 부착.
          if (
            meta?.type === "bridge-cp" &&
            meta.supportId &&
            typeof meta.cpIdx === "number"
          ) {
            selectedBridgeSphereRef.current = picked as Mesh;
            syncGizmo();
            onSelectBridgeControlPointRef.current?.(
              meta.supportId,
              meta.cpIdx,
            );
            return;
          }
          // 끝점 sphere 단일 클릭 → PositionGizmo 부착.
          if (
            meta?.type === "bridge-ep" &&
            meta.supportId &&
            (meta as { which?: string }).which
          ) {
            selectedBridgeSphereRef.current = picked as Mesh;
            syncGizmo();
            return;
          }

          if (meta?.type === "support" && meta.supportId) {
            // 변곡점/끝점 sphere 부착됐던 PositionGizmo 해제.
            selectedBridgeSphereRef.current = null;
            // Bridge 모드 → 기둥 위 hit point 를 새 endpoint 로.
            // 기둥 표면 안쪽으로 normal × PEN 만큼 push → Bridge↔Bridge
            // 연결 시 void 제거. PEN 은 기둥 반지름의 70% 이하 (양면
            // 통과 방지). 굵기는 안 바뀌고 길이만 살짝 연장.
            if (bridge && info.pickInfo?.pickedPoint && meta.stlId) {
              const p = info.pickInfo.pickedPoint;
              const n = info.pickInfo.getNormal(true, true);
              const radius = bridgeDiamRef.current * 0.5;
              // PEN = 반지름의 120% → cap 평면이 부모 axis 를 넘어가서
              // cap 가장자리 (반지름 = child radius) 가 부모 cylinder
              // cross-section 안에 완전히 박힌다. 굵기 균일 유지,
              // 외형 벗어남 0. (양면 통과는 PEN < 2×radius 라 안전.)
              const PEN = radius * 1.2;
              const cx = n ? p.x - n.x * PEN : p.x;
              const cy = n ? p.y - n.y * PEN : p.y;
              const cz = n ? p.z - n.z * PEN : p.z;
              const nArr: [number, number, number] | undefined = n
                ? [n.x, n.y, n.z]
                : undefined;
              // attachedTo: 부모 Bridge path 위의 t 비율. 부모가
              // 수정되면 child 가 따라 이동.
              const parent = supportsRef.current.find(
                (s) => s.id === meta.supportId,
              );
              let attachedTo:
                | { supportId: string; t: number }
                | undefined;
              if (parent && parent.source === "bridge") {
                const t = findClosestT(
                  parent.base,
                  parent.curveControlPoints,
                  parent.contact,
                  [p.x, p.y, p.z],
                );
                attachedTo = { supportId: meta.supportId, t };
              }
              onAddSupportRef.current(
                meta.stlId,
                [cx, cy, cz],
                nArr,
                attachedTo,
              );
              return;
            }
            // 그 외 → 선택.
            onPickSupportRef.current(meta.supportId);
            return;
          }
          for (const [id, mesh] of meshMapRef.current) {
            if (mesh === picked && info.pickInfo?.pickedPoint) {
              const p = info.pickInfo.pickedPoint;
              // 표면 안쪽으로 push → 서포트 끝 cap 이 표면 밖으로
              // 튀어나오지 않게. Bridge 는 굵기가 커서 더 깊이.
              const n = info.pickInfo.getNormal(true, true);
              const radius = bridge ? bridgeDiamRef.current * 0.5 : 0;
              // Bridge: 사용자 알고리즘대로 0.1mm 만 박음. manifold subtract
              // 가 cap 의 STL 안 + winding-flip 으로 외부 노출 부분도 cut.
              // 단점: 두께 검사 적용 (반대편 침범 방지).
              void radius;
              let PEN = bridge ? 0.1 : 0.3;
              if (!bridge && n) {
                const startOffset = 0.05;
                const origin = new Vector3(
                  p.x - n.x * startOffset,
                  p.y - n.y * startOffset,
                  p.z - n.z * startOffset,
                );
                const dir = new Vector3(-n.x, -n.y, -n.z);
                const ray = new Ray(origin, dir, 100);
                const farPick = scene.pickWithRay(ray, (m) => m === mesh);
                if (farPick?.hit && farPick.distance != null) {
                  const thickness = farPick.distance + startOffset;
                  const maxPen = Math.max(0.05, thickness - 0.2);
                  PEN = Math.min(PEN, maxPen);
                }
              }
              const cx = n ? p.x - n.x * PEN : p.x;
              const cy = n ? p.y - n.y * PEN : p.y;
              const cz = n ? p.z - n.z * PEN : p.z;
              const nArr: [number, number, number] | undefined = n
                ? [n.x, n.y, n.z]
                : undefined;
              onAddSupportRef.current(id, [cx, cy, cz], nArr);
              if (!bridge) onPickSupportRef.current(null);
              return;
            }
          }
          return;
        }

        // 'dental-brush' 모드: 표면 클릭은 브러쉬 색칠(6.5 effect 의 별도
        // 포인터 옵저버)이 담당한다. 여기서 선택/해제하면 브러쉬 도중 모델
        // 선택이 바뀌므로 아무 것도 하지 않고 종료.
        if (editModeRef.current === "dental-brush") return;

        // 'select' 모드 (기본): 모델 선택 / 빈 공간 = 해제.
        // 단 alignFloorMode 활성 시 STL face 클릭 → 바닥면 정렬.
        const multi = evt.ctrlKey || evt.metaKey;
        if (!picked) {
          onPickRef.current(null, { multi });
          return;
        }
        if (alignFloorModeRef.current && info.pickInfo) {
          const n = info.pickInfo.getNormal(true, true);
          for (const [id, mesh] of meshMapRef.current) {
            if (mesh === picked && n) {
              const newT = computeAlignFloorTransform(mesh, n);
              onAlignFaceToFloorRef.current?.(id, newT);
              return;
            }
          }
        }
        for (const [id, mesh] of meshMapRef.current) {
          if (mesh === picked) {
            onPickRef.current(id, { multi });
            return;
          }
        }
        // furniture (plate/grid/axes) 픽은 isPickable=false 라 안 옴.
      });

      engineRef.current = engine;
      sceneRef.current = scene;
      cameraRef.current = camera;

      // 초기 카메라 위치는 plate effect 에서 잡는다.

      engine.runRenderLoop(() => scene.render());

      const onResize = () => engine.resize();
      window.addEventListener("resize", onResize);

      return () => {
        // 언마운트 표시 — 이 cleanup 은 deps [] 이라 언마운트에서만 실행된다.
        //   React 는 언마운트 시 effect cleanup 을 선언 순서대로 실행하므로, 이
        //   씬-셋업 effect(먼저 선언)의 cleanup 이 브러쉬 effect(나중 선언) cleanup
        //   보다 먼저 돌아 이 플래그가 true 로 세팅된다. 브러쉬 cleanup 은 이 값을
        //   보고 pending 무효화를 "즉시 실행" 대신 "타이머만 정리"로 처리한다
        //   (언마운트 중 부모 setState 방지 — 뒤이어 전체 dispose 가 온다).
        isUnmountingRef.current = true;
        window.removeEventListener("resize", onResize);
        positionGizmoRef.current?.dispose();
        rotationGizmoRef.current?.dispose();
        scaleGizmoRef.current?.dispose();
        positionGizmoRef.current = null;
        rotationGizmoRef.current = null;
        scaleGizmoRef.current = null;
        utilityLayerRef.current?.dispose();
        utilityLayerRef.current = null;
        for (const sm of supportMeshMapRef.current.values()) {
          sm.dispose();
        }
        supportMeshMapRef.current.clear();
        supportMaterialRef.current?.dispose();
        supportMaterialRef.current = null;
        sliceOutlineRef.current?.dispose();
        sliceOutlineRef.current = null;
        for (const fm of sliceFillMeshesRef.current) fm.dispose();
        sliceFillMeshesRef.current = [];
        bridgeMarkerRef.current?.dispose();
        bridgeMarkerRef.current = null;
        bridgeMarkerMatRef.current?.dispose();
        bridgeMarkerMatRef.current = null;
        sliceModelMatRef.current?.dispose();
        sliceSupportMatRef.current?.dispose();
        sliceModelMatRef.current = null;
        sliceSupportMatRef.current = null;
        for (const mesh of meshMapRef.current.values()) {
          mesh.dispose();
        }
        meshMapRef.current.clear();
        // dental-brush painted 오버레이/점 정리 (scene.dispose 로도 mesh 는
        // 사라지지만 ref 는 명시적으로 비운다).
        paintOverlaysRef.current = [];
        paintPointsRef.current = [];
        // 마진 시각화/floodfill ref 도 명시적으로 비운다 (scene.dispose 후 stale
        //   mesh 참조 방지).
        marginMarkersRef.current = [];
        autoFillOverlayRef.current = [];
        marginRef.current = null;
        autoFillFacesRef.current = new Set();
        // 아일랜드 시각화/결과 ref 도 명시적으로 비운다 (감사 B8 — 위 마진 ref 와
        //   동일 이유. scene.dispose 로 mesh 는 사라지나 ref 는 stale 로 남는다).
        islandMarkersRef.current = [];
        islandResultRef.current = null;
        furnitureRef.current?.dispose();
        furnitureRef.current = null;
        hl.dispose();
        highlightRef.current = null;
        scene.dispose();
        engine.dispose();
        engineRef.current = null;
        sceneRef.current = null;
        cameraRef.current = null;
      };
    }, []);

    // 1.5) plate 크기 변경 시 furniture 재생성 + 카메라 reset.
    useEffect(() => {
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!scene || !camera) return;

      furnitureRef.current?.dispose();
      furnitureRef.current = addBuildPlateAndGrid(scene, {
        widthMm: plateWidthMm,
        depthMm: plateDepthMm,
      });

      // 모델이 없을 때만 plate 기준으로 camera reset (모델이 있으면
      // 사용자 시점 유지).
      if (meshMapRef.current.size === 0) {
        resetCameraOnPlate(camera, plateWidthMm, plateDepthMm);
      }
    }, [plateWidthMm, plateDepthMm]);

    // 2) files 변경 시 메쉬 동기화
    useEffect(() => {
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      if (!scene || !camera) return;

      let cancelled = false;

      const currentIds = new Set(meshMapRef.current.keys());
      const nextIds = new Set(files.map((f) => f.id));

      for (const id of currentIds) {
        if (!nextIds.has(id)) {
          const removedMesh = meshMapRef.current.get(id) ?? null;
          // 이 STL 의 dental-brush 색칠(painted 점 + 오버레이 데칼) 정리.
          //   오버레이 데칼은 STL mesh 의 child 라 dispose 로 함께 사라지지만
          //   paintPointsRef/paintOverlaysRef 배열은 stale ref 로 남으므로
          //   여기서 해당 mesh 엔트리를 제거해 stale painted 카운트를 막는다.
          if (removedMesh) {
            for (let i = paintPointsRef.current.length - 1; i >= 0; i--) {
              if (paintPointsRef.current[i].mesh === removedMesh) {
                paintPointsRef.current.splice(i, 1);
                paintOverlaysRef.current.splice(i, 1);
              }
            }
          }
          // 이 STL 의 마진 시각화(초록 튜브) + floodfill 오버레이(주황) 도 정리.
          //   튜브/오버레이는 mesh child 라 dispose 로 함께 사라지지만 ref/marginRef
          //   가 stale 로 남으므로 명시적으로 제거.
          disposeMarginVisualization(id);
          // 이 STL 의 아일랜드 마젠타 overlay + 결과 ref 도 정리 (2-3b 패턴).
          disposeIslandVisualization(id);
          removedMesh?.dispose();
          meshMapRef.current.delete(id);
          // 이 STL 의 painted 목록도 비었음을 부모에 통지 (세션 상태 sync).
          onPaintedFacesChangeRef.current?.(id, []);
          // manifold 객체도 dispose
          const m = stlManifoldMapRef.current.get(id);
          if (m) {
            m.delete();
            stlManifoldMapRef.current.delete(id);
          }
        }
      }

      const newFiles = files.filter((f) => !currentIds.has(f.id));
      const wasEmpty = currentIds.size === 0;

      Promise.all(
        newFiles.map(async (f) => {
          try {
            const mesh = await loadStlIntoScene(
              scene,
              f.blob,
              f.fileName,
              liftRef.current,
            );
            if (cancelled) {
              mesh.dispose();
              return null;
            }
            applyOverhangColors(mesh, overhangRef.current);
            applyTransformToMesh(mesh, f.transform ?? IDENTITY_TRANSFORM);
            mesh.isPickable = true;
            attachDragBehavior(mesh, f.id);
            meshMapRef.current.set(f.id, mesh);
            // STL 의 manifold 객체 생성 (한 번, STL local 좌표 — transform
            // 적용 X). Bridge subtract 시 Bridge 도 STL local 로 변환해
            // 동일 공간에서 boolean → STL transform 변경 무관 cache hit.
            const mod = manifoldModuleRef.current;
            if (mod) {
              const t0 = performance.now();
              const man = babylonMeshToManifold(mesh, mod, null);
              if (man) {
                stlManifoldMapRef.current.set(f.id, man);
                const status = man.status();
                console.log(
                  `[manifold] STL ${f.fileName} → status=${status} (${(performance.now() - t0).toFixed(0)} ms, numTri=${man.numTri()})`,
                );
              }
            }
            return mesh;
          } catch (e) {
            console.error("[v2] STL 로드 실패", f.fileName, e);
            return null;
          }
        }),
      ).then((loaded) => {
        if (cancelled) return;
        if (wasEmpty && loaded.some((m) => m !== null)) {
          frameCameraToMeshes(
            camera,
            loaded.filter((m): m is Mesh => m !== null),
          );
        }
        refreshHighlight();
        // load 가 끝난 뒤에야 mesh 가 존재하므로 여기서 다시 attach.
        syncGizmo();
      });

      // 기존 메쉬들은 transform 변경 가능성 체크
      for (const f of files) {
        if (currentIds.has(f.id)) {
          const mesh = meshMapRef.current.get(f.id);
          if (mesh) {
            applyTransformToMesh(mesh, f.transform ?? IDENTITY_TRANSFORM);
          }
        }
      }

      return () => {
        cancelled = true;
      };
    }, [files]);

    // 3) 임계각 변경 시 모든 메쉬 색 재할당
    useEffect(() => {
      for (const mesh of meshMapRef.current.values()) {
        applyOverhangColors(mesh, overhangAngleDeg);
      }
    }, [overhangAngleDeg]);

    // 3.5) 서포트 점 동기화 — diff-based.
    //   · 각 support 의 rebuild key = STL local 좌표 + params (STL transform
    //     은 world 만 바꾸고 local 은 안 바꿈 → key 동일 → rebuild skip).
    //   · mesh.parent = stlMesh 라 STL transform 시 자동 follow → freeze 0.
    //   · 삭제된 support: dispose. 추가/변경된 support: 재생성.
    useEffect(() => {
      const scene = sceneRef.current;
      const mat = supportMaterialRef.current;
      if (!scene || !mat) return;

      const mod = manifoldModuleRef.current;
      const map = supportMeshMapRef.current;

      // 1) 삭제된 support mesh dispose.
      const newIds = new Set(supports.map((s) => s.id));
      for (const [id, mesh] of Array.from(map)) {
        if (!newIds.has(id)) {
          mesh.dispose();
          map.delete(id);
          // Bridge subtract 결과 캐시도 함께 정리 (감사 B9). 캐시는 point.id 키라
          //   (buildBridgeClipKey 호출부 set/get 참조) 삭제된 support 의 clip 산출물이
          //   세션 내내 잔류하지 않게 한다. 삭제 후 같은 id 재사용은 없다.
          bridgeClipCacheRef.current.delete(id);
        }
      }

      // 2) 각 support 처리 — key 동일하면 skip.
      for (const p of supports) {
        const stlMesh = meshMapRef.current.get(p.stlId);
        let stlInvWorld: Matrix | null = null;
        if (stlMesh) {
          stlMesh.computeWorldMatrix(true);
          stlInvWorld = Matrix.Invert(stlMesh.getWorldMatrix());
        }
        const toLocal = (
          w: [number, number, number],
        ): [number, number, number] => {
          if (!stlInvWorld) return w;
          const v = Vector3.TransformCoordinates(
            new Vector3(w[0], w[1], w[2]),
            stlInvWorld,
          );
          return [v.x, v.y, v.z];
        };
        const lc = toLocal(p.contact);
        const lb = toLocal(p.base);
        const lcps = p.curveControlPoints
          ? p.curveControlPoints.map(toLocal)
          : null;
        const key = buildSupportKey(p, supportParams, lc, lb, lcps);

        const existing = map.get(p.id);
        // skip 조건: key 동일 + mesh 가 stlMesh child (auto-follow). parent
        // 없는 mesh 는 STL 이동 시 world 위치 그대로 남으므로 재생성 필요.
        if (
          existing &&
          existing.metadata?.rebuildKey === key &&
          existing.parent
        ) {
          continue;
        }
        if (existing) existing.dispose();

        // disc variant — 지현규 dental disc 서포트. trunk/bridge 렌더
        //   (createSupportMesh) 와 완전 분기. contact 는 world 좌표(manual
        //   support 와 동일 규약)이며, createDiscSupport 가 그 지점부터
        //   plate(Y=0)까지 world-space mesh 를 만든다. parent 없음 →
        //   기존 manual/world support 와 동일하게 STL transform 시 재빌드.
        if (p.variant === "disc") {
          const ds = p.discSettings;
          // discSettings 없는 disc = 데이터 이상 → skip. existing 은 위에서 이미
          //   dispose 됐으므로 map 에서도 지워 disposed mesh 가 잔류하지 않게 한다
          //   (감사 B5 — export/슬라이스가 map 값을 순회하므로 잔류 시 유령 mesh).
          if (!ds) {
            map.delete(p.id);
            continue;
          }
          const discMesh = createDiscSupport(
            scene,
            new Vector3(p.contact[0], p.contact[1], p.contact[2]),
            p.contactNormal
              ? new Vector3(
                  p.contactNormal[0],
                  p.contactNormal[1],
                  p.contactNormal[2],
                )
              : new Vector3(0, 1, 0),
            ds,
          );
          // 목이 너무 짧은 등 생성 실패 → skip. existing dispose 후 map 잔류를
          //   막아 disposed mesh 가 export/슬라이스 경로에 남지 않게 한다 (감사 B5).
          if (!discMesh) {
            map.delete(p.id);
            continue;
          }
          // dental createSupport 는 호출마다 자체 StandardMaterial 을
          //   새로 만든다. disc 는 parent 가 없어 rebuild skip 이 안 되고
          //   effect 마다 전량 재생성되므로, mesh dispose 지점(1928/1968)
          //   이 material 을 지우지 않으면 무한 누적된다. 개별 material 을
          //   공용 supportMaterial 로 교체하고 원본을 즉시 dispose →
          //   두 dispose 지점 모두에서 릭 없음 (mesh 만 지워도 안전).
          const ownMat = discMesh.material;
          discMesh.material = mat;
          ownMat?.dispose();
          // 선택/삭제(support 모드)용 metadata — createSupportMesh 와 동일
          //   규약 (type/supportId/stlId) + rebuildKey.
          discMesh.isPickable = editModeRef.current === "support";
          discMesh.metadata = {
            type: "support",
            supportId: p.id,
            stlId: p.stlId,
            baseStlId: p.baseStlId,
            rebuildKey: key,
          };
          map.set(p.id, discMesh);
          continue;
        }

        const m = createSupportMesh(
          scene,
          p,
          supportParams,
          mat,
          meshMapRef.current,
        );
        m.isPickable = editModeRef.current === "support";

        let finalMesh: Mesh = m;
        // Bridge — manifold-3d 로 STL 침투 부분 깎아내기.
        if (
          p.source === "bridge" &&
          mod &&
          stlManifoldMapRef.current.size > 0
        ) {
          const clipped = clipBridgeWithManifold(m, p, mat as StandardMaterial, scene, mod);
          if (clipped) {
            clipped.isPickable = editModeRef.current === "support";
            finalMesh = clipped;
          }
        }
        finalMesh.metadata = {
          ...(finalMesh.metadata ?? {}),
          rebuildKey: key,
        };
        map.set(p.id, finalMesh);
      }
    }, [supports, supportParams]);

    function clipBridgeWithManifold(
      tube: Mesh,
      point: SupportPointV2,
      material: StandardMaterial,
      scene: Scene,
      mod: ManifoldToplevel,
    ): Mesh | null {
      // STL local 공간에서 subtract — STL transform 변경 시 cache hit.
      // (현재 단순화: stlId 의 STL 한 개만 검사. baseStl 별도 검사는 추후.)
      const stlMesh = meshMapRef.current.get(point.stlId);
      const stlMan = stlManifoldMapRef.current.get(point.stlId);
      if (!stlMesh || !stlMan) return null;
      stlMesh.computeWorldMatrix(true);
      const stlWorld = stlMesh.getWorldMatrix();
      const stlInvWorld = Matrix.Invert(stlWorld);

      // tube world → STL local 변환 matrix = stlInvWorld × tube.world
      tube.computeWorldMatrix(true);
      const tubeWorld = tube.getWorldMatrix();
      const tubeToStlLocal = tubeWorld.multiply(stlInvWorld);

      // cache key: Bridge contact/base 의 STL local 좌표 — STL transform
      // 변경해도 같은 표면 위 위치면 같은 key (Bridge 가 STL 따라 함).
      const toStlLocal = (p: [number, number, number]): [number, number, number] => {
        const v = Vector3.TransformCoordinates(new Vector3(p[0], p[1], p[2]), stlInvWorld);
        return [v.x, v.y, v.z];
      };
      const cLocal = toStlLocal(point.contact);
      const bLocal = toStlLocal(point.base);
      const cpsLocal = (point.curveControlPoints ?? []).map(toStlLocal);
      const localPoint: SupportPointV2 = {
        ...point,
        contact: cLocal,
        base: bLocal,
        curveControlPoints: cpsLocal.length ? cpsLocal : undefined,
      };
      const key = buildBridgeClipKey(localPoint, supportParams);
      const cached = bridgeClipCacheRef.current.get(point.id);
      if (cached && cached.key === key) {
        const reusedMesh = meshFromCachedData(
          cached, `support_${point.id}`, material, scene,
        );
        reusedMesh.metadata = tube.metadata;
        tube.dispose();
        // STL local 좌표 mesh + parent = stlMesh → STL transform 자동 follow
        reusedMesh.parent = stlMesh;
        return reusedMesh;
      }

      const tubeMan = babylonMeshToManifold(tube, mod, tubeToStlLocal);
      if (!tubeMan) return null;
      try {
        const result = tubeMan.subtract(stlMan);
        if (result === tubeMan) {
          tubeMan.delete();
          return null;
        }
        const clipped = manifoldToBabylonMesh(
          result,
          `support_${point.id}`,
          material,
          scene,
        );
        // clipped 의 vertex 는 STL local. mesh.parent = stlMesh 박으면
        // final world = stlMesh.world × vertex = 원래 Bridge world.
        // cache 에 vertex data (STL local) 저장 → 다음 hit 시 재사용.
        const positions = clipped?.getVerticesData(VertexBuffer.PositionKind);
        const idx = clipped?.getIndices();
        const normals = clipped?.getVerticesData(VertexBuffer.NormalKind);
        if (clipped && positions && idx && normals) {
          bridgeClipCacheRef.current.set(point.id, {
            key,
            positions: new Float32Array(positions),
            indices: new Uint32Array(idx),
            normals: new Float32Array(normals),
          });
        }
        result.delete();
        tubeMan.delete();
        if (!clipped) return null;
        clipped.metadata = tube.metadata;
        tube.dispose();
        clipped.parent = stlMesh;
        return clipped;
      } catch (e) {
        console.warn("[manifold] subtract 실패", e);
        tubeMan.delete();
        return null;
      }
    }

    // 4) 선택 변경 시 highlight 갱신
    useEffect(() => {
      refreshHighlight();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIds, selectedSupportId]);

    // 5) Gizmo: 선택 / 모드 / files / editMode / supports / selectedSupportId 변경 시 attach 재계산
    useEffect(() => {
      syncGizmo();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIds, gizmoMode, files, editMode, supports, selectedSupportId]);

    // 5.5) Z 슬라이스 미리보기:
    //   · scene.clipPlane 으로 Y > sliceY 영역 컬링.
    //   · 모든 mesh 의 단면 segment 계산 → chain → polygon fill mesh.
    //   · outline 라인은 polygon 경계 위에 얇게 그려 강조.
    useEffect(() => {
      const scene = sceneRef.current;
      const modelMat = sliceModelMatRef.current;
      const supportMat = sliceSupportMatRef.current;
      if (!scene || !modelMat || !supportMat) return;

      // 기존 fill / outline 정리.
      for (const fm of sliceFillMeshesRef.current) fm.dispose();
      sliceFillMeshesRef.current = [];
      sliceOutlineRef.current?.dispose();
      sliceOutlineRef.current = null;

      if (sliceY == null) {
        scene.clipPlane = null;
        return;
      }

      scene.clipPlane = new Plane(0, 1, 0, -sliceY);

      const yFill = sliceY + 0.005;
      const yLine = sliceY + 0.02;
      const lines: Vector3[][] = [];

      // 모델 단면.
      for (const mesh of meshMapRef.current.values()) {
        const segs = sliceMeshAtY(mesh, sliceY);
        if (segs.length === 0) continue;
        const polys = chainSegments(segs);
        for (const p of polys) {
          const fill = buildPolygonFillMesh(
            scene,
            p,
            yFill,
            modelMat,
            "v2_slice_model_fill",
          );
          if (fill) sliceFillMeshesRef.current.push(fill);
        }
        for (const s of segs) {
          lines.push([
            new Vector3(s.a[0], yLine, s.a[1]),
            new Vector3(s.b[0], yLine, s.b[1]),
          ]);
        }
      }

      // 서포트 단면.
      for (const sm of supportMeshMapRef.current.values()) {
        const segs = sliceMeshAtY(sm, sliceY);
        if (segs.length === 0) continue;
        const polys = chainSegments(segs);
        for (const p of polys) {
          const fill = buildPolygonFillMesh(
            scene,
            p,
            yFill,
            supportMat,
            "v2_slice_support_fill",
          );
          if (fill) sliceFillMeshesRef.current.push(fill);
        }
        for (const s of segs) {
          lines.push([
            new Vector3(s.a[0], yLine, s.a[1]),
            new Vector3(s.b[0], yLine, s.b[1]),
          ]);
        }
      }

      if (lines.length > 0) {
        const ol = MeshBuilder.CreateLineSystem(
          "v2_slice_outline",
          { lines },
          scene,
        );
        ol.color = new Color3(1.0, 0.55, 0.15);
        ol.isPickable = false;
        sliceOutlineRef.current = ol;
      }
    }, [sliceY, files, supports, supportParams]);

    // 5.6) Bridge pending point marker (작은 주황 sphere).
    useEffect(() => {
      const scene = sceneRef.current;
      const mat = bridgeMarkerMatRef.current;
      if (!scene || !mat) return;

      bridgeMarkerRef.current?.dispose();
      bridgeMarkerRef.current = null;
      if (!pendingBridgePoint) return;

      const m = MeshBuilder.CreateSphere(
        "v2_bridge_marker",
        { diameter: 1.4, segments: 10 },
        scene,
      );
      m.position.set(
        pendingBridgePoint[0],
        pendingBridgePoint[1],
        pendingBridgePoint[2],
      );
      m.material = mat;
      m.isPickable = false;
      m.renderingGroupId = 1;
      bridgeMarkerRef.current = m;
    }, [pendingBridgePoint]);

    // 5.7) Bridge 시각화:
    //   · Bridge 모드 활성 → 모든 Bridge 의 A (주황) / B (청록) 끝점을
    //     작은 sphere 로 표시 (시각화만, 드래그 X).
    //   · 선택된 Bridge → 큰 sphere 로 A/B 표시 + 변곡점 3 개 (노랑),
    //     PointerDragBehavior 로 드래그 가능.
    useEffect(() => {
      const scene = sceneRef.current;
      const cpMat = bridgeCpMatRef.current;
      const aMat = bridgeMarkerMatRef.current; // A = 주황 (기존 marker mat)
      // B 도 주황 — 사용자 요청. (bridgeBMatRef 는 보존, 추후 구분 필요 시 사용.)
      const bMat = bridgeMarkerMatRef.current;
      if (!scene || !cpMat || !aMat || !bMat) return;

      // 매번 dispose & 재생성. drag 도중에는 supports 가 안 바뀌므로
      // 끊김 없이 동작.
      for (const m of bridgeCpMeshesRef.current) {
        m.dispose();
      }
      bridgeCpMeshesRef.current = [];

      if (editMode !== "support") return;

      const bridges = supports.filter((s) => s.source === "bridge");
      const dBig = Math.max(supportParams.bridgeDiameterMm * 1.5, 1.2);
      const dSmall = Math.max(supportParams.bridgeDiameterMm * 1.0, 0.8);

      // 저장된 contact/base 는 표면 안쪽 push 된 상태. sphere 는
      // 그 반대로 normal × LIFT 만큼 밖으로 끌어내서 사용자가 표면
      // 위에서 보고 클릭/드래그할 수 있게 한다. (메시 cap 은 안쪽
      // 박힌 그대로 유지 → void 없는 부착.)
      const LIFT = 0.8;
      const liftOut = (
        pos: [number, number, number],
        n: [number, number, number] | undefined,
      ): [number, number, number] => {
        if (!n) return pos;
        return [pos[0] + n[0] * LIFT, pos[1] + n[1] * LIFT, pos[2] + n[2] * LIFT];
      };
      // stl-local 좌표 모드의 support 면 sphere 를 STL mesh 의 child 로
       // 묶어 STL 회전/이동 시 자동 follow. sphere.position 은 이미 local
       // 좌표가 박혀있으므로 그대로 둔다 (parent 만 바꿈, 위치 보존 X).
      const attachToStl = (sphere: Mesh, sup: SupportPointV2): void => {
        if (sup.coordSpace !== "stl-local") return;
        const stlMesh = meshMapRef.current.get(sup.stlId);
        if (stlMesh) sphere.parent = stlMesh;
      };
      const undoLift = (
        pos: { x: number; y: number; z: number },
        n: [number, number, number] | undefined,
      ): [number, number, number] => {
        if (!n) return [pos.x, pos.y, pos.z];
        return [pos.x - n[0] * LIFT, pos.y - n[1] * LIFT, pos.z - n[2] * LIFT];
      };

      // (1) Bridge 모드 → 안 선택된 Bridge 들의 A / B 시각화.
      if (bridgeMode) {
        for (const sup of bridges) {
          if (sup.id === selectedSupportId) continue; // 선택된 건 (2) 에서.
          const aPos = liftOut(sup.base, sup.baseNormal);
          const aSphere = MeshBuilder.CreateSphere(
            `v2_bridge_a_viz_${sup.id}`,
            { diameter: dSmall, segments: 10 },
            scene,
          );
          aSphere.position.set(aPos[0], aPos[1], aPos[2]);
          aSphere.material = aMat;
          aSphere.isPickable = false;
          aSphere.renderingGroupId = 1;
          attachToStl(aSphere, sup);
          bridgeCpMeshesRef.current.push(aSphere);

          const bPos = liftOut(sup.contact, sup.contactNormal);
          const bSphere = MeshBuilder.CreateSphere(
            `v2_bridge_b_viz_${sup.id}`,
            { diameter: dSmall, segments: 10 },
            scene,
          );
          bSphere.position.set(bPos[0], bPos[1], bPos[2]);
          bSphere.material = bMat;
          bSphere.isPickable = false;
          bSphere.renderingGroupId = 1;
          attachToStl(bSphere, sup);
          bridgeCpMeshesRef.current.push(bSphere);
        }
      }

      // (2) 선택된 Bridge → A/B 큰 sphere (드래그) + 변곡점 (노랑).
      if (!selectedSupportId) return;
      const sup = bridges.find((s) => s.id === selectedSupportId);
      if (!sup) return;

      const endpoints: {
        which: "base" | "contact";
        pos: [number, number, number];
        normal: [number, number, number] | undefined;
        mat: StandardMaterial;
      }[] = [
        { which: "base", pos: sup.base, normal: sup.baseNormal, mat: aMat },
        {
          which: "contact",
          pos: sup.contact,
          normal: sup.contactNormal,
          mat: bMat,
        },
      ];
      for (const ep of endpoints) {
        const visPos = liftOut(ep.pos, ep.normal);
        const sphere = MeshBuilder.CreateSphere(
          `v2_bridge_ep_${sup.id}_${ep.which}`,
          { diameter: dBig, segments: 10 },
          scene,
        );
        sphere.position.set(visPos[0], visPos[1], visPos[2]);
        sphere.material = ep.mat;
        sphere.isPickable = true;
        sphere.renderingGroupId = 1;
        sphere.metadata = {
          type: "bridge-ep",
          supportId: sup.id,
          which: ep.which,
          normal: ep.normal,
        };
        attachToStl(sphere, sup);
        // PointerDragBehavior 도 유지 — sphere 직접 끌면 카메라 평면
        // 자유 드래그. PositionGizmo 의 X/Y/Z 축 화살표는 정확한 깊이
        // 드래그. 둘 다 동시 가능.
        const drag = new PointerDragBehavior();
        // 우/휠 드래그는 카메라 조작으로 통과 (P5: 모델 메쉬와 동일 처리)
        drag.dragButtons = [0];
        drag.useObjectOrientationForDragging = false;
        sphere.addBehavior(drag);
        const which = ep.which;
        const epNormal = ep.normal;
        drag.onDragEndObservable.add(() => {
          const stored = undoLift(
            { x: sphere.position.x, y: sphere.position.y, z: sphere.position.z },
            epNormal,
          );
          onMoveBridgeEndpointRef.current(sup.id, which, stored);
        });
        bridgeCpMeshesRef.current.push(sphere);
      }

      if (sup.curveControlPoints) {
        for (let i = 0; i < sup.curveControlPoints.length; i++) {
          const cp = sup.curveControlPoints[i];
          const sphere = MeshBuilder.CreateSphere(
            `v2_bridge_cp_${sup.id}_${i}`,
            { diameter: dBig, segments: 10 },
            scene,
          );
          sphere.position.set(cp[0], cp[1], cp[2]);
          sphere.material = cpMat;
          sphere.isPickable = true;
          sphere.renderingGroupId = 1;
          sphere.metadata = {
            type: "bridge-cp",
            supportId: sup.id,
            cpIdx: i,
          };
          attachToStl(sphere, sup);
          // PointerDragBehavior 유지 — 자유 드래그. PositionGizmo 도
          // syncGizmo 에서 attach 되어 X/Y/Z 축 정확 드래그 가능.
          const drag = new PointerDragBehavior();
          // 우/휠 드래그는 카메라 조작으로 통과 (P5: 모델 메쉬와 동일 처리)
          drag.dragButtons = [0];
          drag.useObjectOrientationForDragging = false;
          sphere.addBehavior(drag);
          const idx = i;
          drag.onDragEndObservable.add(() => {
            onMoveBridgeCpRef.current(sup.id, idx, [
              sphere.position.x,
              sphere.position.y,
              sphere.position.z,
            ]);
          });
          bridgeCpMeshesRef.current.push(sphere);
        }
      }
    }, [
      editMode,
      bridgeMode,
      selectedSupportId,
      supports,
      files,
      supportParams.bridgeDiameterMm,
    ]);

    // 6) editMode 변경 시:
    //    · STL 메쉬의 PointerDragBehavior detach/attach
    //    · support 메쉬의 isPickable 토글
    //    · dental-brush 모드도 support 와 마찬가지로 STL 드래그 비활성
    //      (표면 클릭이 색칠에 쓰이므로 이동/선택으로 소비되면 안 됨).
    //    · dental-brush 모드에서만 카메라 좌클릭(0) 회전을 끈다 (감사 B2).
    //      원본(babylon.utils createCamera)은 좌클릭을 buttons=[1,2] 로 전역
    //      제외했으나, v2 는 select/support 의 좌드래그 회전 UX 를 유지하기
    //      위해 모드 진입 시에만 0 을 빼고 이탈 시 [0,1,2] 로 원복한다.
    useEffect(() => {
      for (const [id, mesh] of meshMapRef.current) {
        const drag = dragBehaviorMapRef.current.get(id);
        if (!drag) continue;
        const attached = mesh.behaviors.includes(drag);
        if (editMode !== "select" && attached) {
          mesh.removeBehavior(drag);
        } else if (editMode === "select" && !attached) {
          mesh.addBehavior(drag);
        }
      }
      for (const sm of supportMeshMapRef.current.values()) {
        sm.isPickable = editMode === "support";
      }

      // 카메라 pointer input 의 버튼 매핑을 모드에 맞춰 조정한다.
      // ArcRotateCameraPointersInput.buttons: 0=Left, 1=Middle, 2=Right.
      // dental-brush 에서는 좌클릭 드래그가 색칠에 쓰이므로 카메라 회전에서
      // 좌클릭을 제외(=[1,2])하고, 그 외 모드에서는 기본값([0,1,2])으로 원복.
      const pointersInput = cameraRef.current?.inputs.attached.pointers as
        | { buttons?: number[] }
        | undefined;
      if (pointersInput) {
        pointersInput.buttons =
          editMode === "dental-brush" ? [1, 2] : [0, 1, 2];
      }
    }, [editMode, files, supports]);

    // 6.5) dental-brush 모드 — 브러쉬로 STL 표면 영역 색칠 (마스크).
    //   원본: frontend/src/components/STLViewer.tsx (지현규) supportTool==='mask'
    //   경로의 useEffect (약 718~1271줄) 이식. addMaskPoint / eraseMaskAt /
    //   포인터 옵저버 / 브러쉬 링 / SHIFT+휠 두께 조정 을 verbatim 에 가깝게 옮기고,
    //   painted 상태는 paintPointsRef 에 저장 후 onPaintedFacesChange 로 통지한다.
    //   (원본 maskRef → paintPointsRef, maskMarkersRef → paintOverlaysRef.)
    useEffect(() => {
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const engine = engineRef.current;
      const canvas = canvasRef.current;
      if (!scene || !camera || !engine || !canvas) return;
      if (editMode !== "dental-brush") return;

      canvas.style.cursor = "none";

      // 메쉬의 로컬 +Y 축을 dir 방향으로 정렬 (원본 orientYTo verbatim).
      const orientYTo = (m: Mesh, dir: Vector3): void => {
        const d = dir.normalizeToNew();
        const up = new Vector3(0, 1, 0);
        const dt = Math.max(-1, Math.min(1, Vector3.Dot(up, d)));
        if (dt > 0.999999) {
          m.rotationQuaternion = Quaternion.Identity();
        } else if (dt < -0.999999) {
          m.rotationQuaternion = Quaternion.RotationAxis(
            new Vector3(1, 0, 0),
            Math.PI,
          );
        } else {
          m.rotationQuaternion = Quaternion.RotationAxis(
            Vector3.Cross(up, d).normalize(),
            Math.acos(dt),
          );
        }
      };

      // 한 스트로크 동안 색칠/지우기로 영향 받은 mesh 를 모아둔다.
      //   computePaintedFaceIds 는 O(전체 tri × painted 점) 전수 스캔이라
      //   매 브러쉬 스텝(POINTERMOVE 당 최대 80 회)마다 돌리면 대형 스캔에서
      //   프리즈. 따라서 스텝마다는 mesh 만 기록하고, 실제 재계산·통지는
      //   스트로크 종료(POINTERUP / 단발 클릭)에서 mesh 당 1 회만 flush 한다.
      //   판정 로직 자체는 무변경 — 호출 시점만 스트로크 단위로 이동.
      const touchedMeshes = new Set<Mesh>();
      const markTouched = (mesh: Mesh): void => {
        touchedMeshes.add(mesh);
      };

      // 지연 무효화(감사 B3)의 상태·헬퍼는 컴포넌트 레벨로 승격됐다:
      //   pendingInvalidationsRef / scheduleInvalidation / cancelPendingInvalidation.
      //   (검출 함수가 pending 을 취소할 수 있어야 신선 결과 파괴 레이스를 막을 수
      //   있기 때문 — 지역 클로저에 가두면 불가.) 여기서는 그대로 호출만 한다.
      //   cleanup 에서 순회할 Map 을 effect 본문에서 미리 캡처한다 (react-hooks/
      //   exhaustive-deps 권고 — ref 가 보유한 Map 은 컴포넌트 생애 내내 동일
      //   객체라, 이후 스케줄러가 이 Map 을 mutate 해도 같은 참조로 반영된다).
      const pendingInvalidations = pendingInvalidationsRef.current;

      // 모아둔 touched mesh 마다 painted face 를 재계산해 통지 후 비운다.
      const flushPaintedNotifications = (): void => {
        if (touchedMeshes.size === 0) return;
        for (const mesh of touchedMeshes) {
          let stlId: string | undefined;
          for (const [id, m] of meshMapRef.current) {
            if (m === mesh) {
              stlId = id;
              break;
            }
          }
          if (!stlId) continue;
          const faces = computePaintedFaceIds(mesh, paintPointsRef.current);
          // 통지는 즉시 (painted 상태 동기 유지).
          onPaintedFacesChangeRef.current?.(stlId, Array.from(faces));
          // 무효화는 더블클릭 윈도우만큼 지연 예약 (위 주석 참고).
          //   ⚠️ flush 는 사용자 브러쉬 스트로크(POINTERUP/단발 클릭)에서만 호출된다.
          //   "마진 찾기"(runFindDentalMargin)는 painted 를 읽기만 하고 touchedMeshes
          //   를 건드리지 않으므로 검출 직후 무효화 예약이 생기지 않는다.
          scheduleInvalidation(stlId);
        }
        touchedMeshes.clear();
      };

      // mask 도구: 표면 법선에 맞춰 기울어지는 3D 브러쉬 링 (호버 시 표시).
      const brushRing = MeshBuilder.CreateTorus(
        "v2_brushRing",
        { diameter: 1, thickness: 0.07, tessellation: 40 },
        scene,
      );
      const rm = new StandardMaterial("v2_brushRingMat", scene);
      rm.emissiveColor = new Color3(0.2, 0.85, 0.95);
      rm.diffuseColor = new Color3(0, 0, 0);
      rm.disableLighting = true;
      rm.disableDepthWrite = true;
      brushRing.material = rm;
      brushRing.isPickable = false;
      brushRing.renderingGroupId = 1;
      brushRing.setEnabled(false);

      // SHIFT + 마우스 휠 → 브러쉬 커서 크기 조정 (카메라 줌은 막음).
      const maskWheel = (e: WheelEvent): void => {
        if (!e.shiftKey) return; // SHIFT 없으면 일반 휠(카메라 줌) 그대로
        e.preventDefault();
        e.stopImmediatePropagation(); // Babylon 카메라 줌 입력 차단
        const cur = brushThicknessRef.current;
        const next = Math.max(0.5, Math.min(30, cur + (e.deltaY < 0 ? 1 : -1)));
        if (next === cur) return;
        brushThicknessRef.current = next; // 브러쉬 링 즉시 반영
        onBrushThicknessChangeRef.current?.(next); // 패널 상태 동기화
      };
      canvas.addEventListener("wheel", maskWheel, {
        capture: true,
        passive: false,
      });

      // 현재 활성(선택)된 STL — 색칠은 이 메쉬에만 적용 (원본 getActiveMesh).
      const getActiveMesh = (): Mesh | null => {
        const ids = Array.from(selectedRef.current);
        let id: string | undefined = ids[0];
        if (!id) id = [...meshMapRef.current.keys()][0];
        return id ? meshMapRef.current.get(id) ?? null : null;
      };
      // scene.pick 술어 — 활성 STL 메쉬만 picking 대상으로 한정.
      const onlyActive = (m: { uniqueId: number }): boolean => {
        const a = getActiveMesh();
        return !!a && (m as unknown as Mesh) === a;
      };

      // mm → 화면 px (거리 dist 에서의 원근 투영) — 원본 mmToPx verbatim.
      const mmToPx = (mm: number, dist: number): number =>
        (mm * engine.getRenderHeight()) / (2 * dist * Math.tan(camera.fov / 2));

      // ── 브러쉬 상태 ──
      let brushing = false;
      let lastBrush: { x: number; y: number } | null = null;

      // mask — 보호 영역을 STL 표면에 데칼로 직접 색칠. 원본 addMaskPoint 이식.
      const addMaskPoint = (x: number, y: number): void => {
        const pick = scene.pick(x, y, onlyActive);
        if (!pick?.hit || !pick.pickedPoint || !pick.pickedMesh) return;
        // 데칼 투영 방향 — 원본은 smooth normal 우선. Babylon getNormal(true,true)
        //   = 정점 보간(smooth) world 법선. 실패 시 face 법선 fallback.
        let normal: Vector3 | null = pick.getNormal(true, true);
        if (!normal || normal.lengthSquared() < 1e-9) {
          normal = pick.getNormal(false, true);
        }
        if (!normal || normal.lengthSquared() < 1e-9) return;
        normal = normal.normalizeToNew();
        const viewDir = pick.pickedPoint.subtract(camera.position);
        if (Vector3.Dot(normal, viewDir) > 0) normal = normal.negate();
        const dia = Math.max(brushThicknessRef.current, 1);
        // 데칼 투영 깊이 — 작게 잡아 반대편(뒷면)까지 뚫고 칠해지지 않게 한다.
        const depthSize = Math.min(dia, 3);

        // STL 표면 geometry 에 밀착하는 데칼로 색칠 (size.z = 투영 깊이).
        const decal = MeshBuilder.CreateDecal("v2_maskDecal", pick.pickedMesh, {
          position: pick.pickedPoint,
          normal,
          size: new Vector3(dia, dia, depthSize),
        });

        // 클릭한 면 각도와 비슷한 삼각형만 유지 → 다른 각도의 면으로 안 번짐.
        const dpos = decal.getVerticesData("position");
        const didx = decal.getIndices();
        const dnorm = decal.getVerticesData("normal");
        if (dpos && didx && dnorm) {
          const COS = Math.cos((45 * Math.PI) / 180); // 45° 이내 면만
          const depthLimit = depthSize * 0.55; // 클릭 표면 근처만 유지 → 뒷면 제외
          const hit = pick.pickedPoint;
          const wm = decal.computeWorldMatrix(true);
          const kp: number[] = [];
          const ki: number[] = [];
          let k = 0;
          for (let t = 0; t < didx.length; t += 3) {
            const i0 = didx[t] * 3;
            const i1 = didx[t + 1] * 3;
            const i2 = didx[t + 2] * 3;
            const a = Vector3.TransformCoordinates(
              new Vector3(dpos[i0], dpos[i0 + 1], dpos[i0 + 2]),
              wm,
            );
            const b = Vector3.TransformCoordinates(
              new Vector3(dpos[i1], dpos[i1 + 1], dpos[i1 + 2]),
              wm,
            );
            const c = Vector3.TransformCoordinates(
              new Vector3(dpos[i2], dpos[i2 + 1], dpos[i2 + 2]),
              wm,
            );
            const tn = Vector3.TransformNormal(
              new Vector3(
                dnorm[i0] + dnorm[i1] + dnorm[i2],
                dnorm[i0 + 1] + dnorm[i1 + 1] + dnorm[i2 + 1],
                dnorm[i0 + 2] + dnorm[i1 + 2] + dnorm[i2 + 2],
              ),
              wm,
            );
            if (tn.lengthSquared() < 1e-12) continue;
            tn.normalize();
            if (Vector3.Dot(tn, normal) < COS) continue;
            const ctr = a.add(b).add(c).scale(1 / 3);
            if (Vector3.Dot(ctr.subtract(hit), normal) < -depthLimit) continue;
            for (const ii of [i0, i1, i2]) {
              kp.push(dpos[ii], dpos[ii + 1], dpos[ii + 2]);
            }
            ki.push(k, k + 1, k + 2);
            k += 3;
          }
          if (ki.length === 0) {
            decal.dispose();
            return;
          }
          const norms: number[] = [];
          VertexData.ComputeNormals(kp, ki, norms);
          const vd = new VertexData();
          vd.positions = kp;
          vd.indices = ki;
          vd.normals = norms;
          vd.applyToMesh(decal);
        }

        const maskMesh = pick.pickedMesh as Mesh;
        // painted 점 저장용 normal — 시각용 smooth normal 이 아니라 picked face 의
        //   face normal 사용. isMasked 의 정면 검사가 face normal 기반이라
        //   일관성 유지 → 마진 찾기 painted set 이 원본과 동일하게 나온다.
        let storeNormal = pick.getNormal(false, true);
        if (!storeNormal || storeNormal.lengthSquared() < 1e-9) {
          storeNormal = normal; // fallback
        } else {
          storeNormal = storeNormal.normalizeToNew();
          if (Vector3.Dot(storeNormal, viewDir) > 0) {
            storeNormal = storeNormal.negate();
          }
        }
        paintPointsRef.current.push(
          makePaintPoint(maskMesh, pick.pickedPoint, storeNormal, dia),
        );
        decal.isPickable = false;
        // 모델과 같은 렌더링 그룹(0) + 깊이쓰기 ON → 뒷면 색칠 투과 방지.
        const dm = new StandardMaterial("v2_maskMat", scene);
        dm.emissiveColor = new Color3(0.96, 0.52, 0.13); // 주황 (#F5852B 계열)
        dm.diffuseColor = new Color3(0, 0, 0);
        dm.disableLighting = true;
        dm.backFaceCulling = false;
        dm.zOffset = -2;
        decal.material = dm;
        decal.setParent(pick.pickedMesh); // 모델과 함께 움직이도록
        paintOverlaysRef.current.push(decal);
        markTouched(maskMesh); // 통지는 스트로크 종료 시 flush.
      };

      // mask — Ctrl+드래그 지우개. 원본 eraseMaskAt 이식.
      const eraseMaskAt = (x: number, y: number): void => {
        const pick = scene.pick(x, y, onlyActive);
        if (!pick?.hit || !pick.pickedPoint) return;
        const p = pick.pickedPoint;
        let eraseN: Vector3 | null = pick.getNormal(true, true);
        if (!eraseN || eraseN.lengthSquared() < 1e-9) {
          eraseN = pick.getNormal(false, true);
        }
        if (eraseN && eraseN.lengthSquared() < 1e-9) eraseN = null;
        if (eraseN) {
          eraseN = eraseN.normalizeToNew();
          const vd = pick.pickedPoint.subtract(camera.position);
          if (Vector3.Dot(eraseN, vd) > 0) eraseN = eraseN.negate();
        }
        const COS = Math.cos((30 * Math.PI) / 180);
        const r = Math.max(brushThicknessRef.current / 2, 1);
        for (let i = paintPointsRef.current.length - 1; i >= 0; i--) {
          const entry = paintPointsRef.current[i];
          const wm = entry.mesh.getWorldMatrix();
          const wp = Vector3.TransformCoordinates(entry.localPoint, wm);
          if (Vector3.Distance(wp, p) >= r + entry.radius) continue;
          if (eraseN) {
            const en = Vector3.TransformNormal(
              entry.localNormal,
              wm,
            ).normalize();
            if (Vector3.Dot(en, eraseN) < COS) continue;
          }
          markTouched(entry.mesh); // 통지는 스트로크 종료 시 flush.
          paintOverlaysRef.current[i]?.dispose(false, true);
          paintOverlaysRef.current.splice(i, 1);
          paintPointsRef.current.splice(i, 1);
        }
      };

      const obs = scene.onPointerObservable.add((pi) => {
        const ev = pi.event as PointerEvent;

        if (pi.type === PointerEventTypes.POINTERMOVE) {
          // 커서(브러쉬 링) 갱신 + 브러쉬 페인팅.
          const pick = scene.pick(scene.pointerX, scene.pointerY, onlyActive);
          const dist =
            pick?.hit && pick.pickedPoint
              ? Vector3.Distance(camera.position, pick.pickedPoint)
              : camera.radius;
          const sizePx = Math.max(mmToPx(brushThicknessRef.current, dist), 4);

          let ringShown = false;
          if (pick?.hit && pick.pickedPoint) {
            let n: Vector3 | null = pick.getNormal(true, true);
            if (!n || n.lengthSquared() < 1e-9) n = pick.getNormal(false, true);
            if (n && n.lengthSquared() < 1e-9) n = null;
            if (n) {
              n = n.normalizeToNew();
              const vd = pick.pickedPoint.subtract(camera.position);
              if (Vector3.Dot(n, vd) > 0) n = n.negate();
              const d = Math.max(brushThicknessRef.current, 1);
              brushRing.scaling.set(d, d, d);
              brushRing.position = pick.pickedPoint.add(n.scale(0.1));
              orientYTo(brushRing, n);
              (brushRing.material as StandardMaterial).emissiveColor =
                ev.ctrlKey
                  ? new Color3(0.95, 0.25, 0.25) // 지우개
                  : new Color3(0.2, 0.85, 0.95); // 칠하기
              brushRing.setEnabled(true);
              ringShown = true;
            }
          }
          if (!ringShown) brushRing.setEnabled(false);

          if (brushing) {
            // lastBrush→현재 점 구간을 stepPx 간격으로 채운다 (연속 획).
            const stepPx = Math.max(sizePx * 0.1, 2);
            const paintAt = (px: number, py: number): void => {
              if (ev.ctrlKey) eraseMaskAt(px, py);
              else addMaskPoint(px, py);
            };
            if (!lastBrush) {
              paintAt(scene.pointerX, scene.pointerY);
              lastBrush = { x: scene.pointerX, y: scene.pointerY };
            } else {
              const dx = scene.pointerX - lastBrush.x;
              const dy = scene.pointerY - lastBrush.y;
              const d = Math.hypot(dx, dy);
              if (d >= stepPx) {
                const steps = Math.min(Math.floor(d / stepPx), 80);
                for (let s = 1; s <= steps; s++) {
                  const t = (s * stepPx) / d;
                  paintAt(lastBrush.x + dx * t, lastBrush.y + dy * t);
                }
                const adv = (steps * stepPx) / d;
                lastBrush = {
                  x: lastBrush.x + dx * adv,
                  y: lastBrush.y + dy * adv,
                };
              }
            }
          }
        } else if (pi.type === PointerEventTypes.POINTERDOWN) {
          // 좌클릭 → 칠하기 스트로크 시작.
          if (ev.button === 0) {
            brushing = true;
            lastBrush = { x: scene.pointerX, y: scene.pointerY };
            if (ev.ctrlKey) eraseMaskAt(scene.pointerX, scene.pointerY);
            else addMaskPoint(scene.pointerX, scene.pointerY);
          }
        } else if (pi.type === PointerEventTypes.POINTERUP) {
          // 스트로크 종료 — 이 스트로크에서 색칠/지운 mesh 들의 painted face 를
          //   여기서 1 회만 재계산·통지 (단발 클릭도 DOWN→UP 이라 포함).
          brushing = false;
          lastBrush = null;
          flushPaintedNotifications();
        } else if (pi.type === PointerEventTypes.POINTERDOUBLETAP) {
          // 마진 안쪽 더블클릭 → floodfill 자동 색칠 (원본 fillFromFace 이식).
          //   마진 ref 가 없으면 fillMarginFromFace 가 console.warn 후 무시.
          if (ev.button !== 0) return;
          const pick = scene.pick(scene.pointerX, scene.pointerY, onlyActive);
          if (
            !pick?.hit ||
            !pick.pickedMesh ||
            pick.faceId === undefined ||
            pick.faceId < 0
          )
            return;
          let sid: string | undefined;
          for (const [id, m] of meshMapRef.current.entries()) {
            if (m === pick.pickedMesh) {
              sid = id;
              break;
            }
          }
          if (!sid) return;
          // 더블탭 = floodfill 채우기 의도. 직전 첫 클릭의 POINTERUP flush 가
          //   예약한 무효화를 취소해 marginRef 를 살려둔다 (감사 B3 회귀 방지).
          //   floodfill 은 마진을 소비하되 유지하는 원본 워크플로우.
          cancelPendingInvalidation(sid);
          fillMarginFromFace(sid, pick.faceId);
        }
      });

      return () => {
        // 스트로크 중 모드 전환 등으로 UP 을 못 받은 경우 대비 — 남은 touched
        //   mesh 를 정리 통지 (통지 누락 방지). 이 flush 가 무효화를 재예약할 수
        //   있으므로 반드시 타이머 정리보다 "먼저" 호출한다.
        flushPaintedNotifications();
        // 예약된 무효화 타이머 처리 — 드롭하지 않는다.
        //   · 모드 전환(마운트 유지): pending 을 clearTimeout 후 즉시 실행
        //     (invalidateDentalResults). 모드 이탈 후엔 더블탭이 불가능하므로 지연할
        //     이유가 없고, 이렇게 해야 "칠→300ms 내 모드 이탈"에서도 그 칠 변경의
        //     무효화가 보장된다(감사 B3). 방금 flush 가 새로 예약한 것도 포함된다.
        //   · 언마운트(씬 dispose 경로): 뒤이어 전체 dispose 가 오므로 invalidate
        //     (setState 유발) 를 부르면 언마운트 중 부모 상태 갱신이 된다. 타이머만
        //     clearTimeout 하고 콜백은 발화하지 않는다 — dispose 가 mesh/ref 를 모두
        //     정리한다. isUnmountingRef 로 두 경우를 구분한다.
        const unmounting = isUnmountingRef.current;
        // effect 본문에서 캡처해 둔 pendingInvalidations(동일 Map 참조)를 순회.
        for (const [stlId, t] of pendingInvalidations) {
          clearTimeout(t);
          if (!unmounting) invalidateDentalResults(stlId);
        }
        pendingInvalidations.clear();
        scene.onPointerObservable.remove(obs);
        canvas.style.cursor = "";
        brushRing.dispose(false, true);
        rm.dispose();
        canvas.removeEventListener("wheel", maskWheel, true);
        // 원본은 도구 종료 시 clearMask() 로 색칠을 지웠다. v2 에서는 모드
        // 전환 시 painted(세션 상태)를 유지 — margin/island 조각이 같은 색칠을
        // 재사용할 수 있도록. 명시적 지우기는 clearDentalPaint()(패널 버튼).
      };
      // invalidateDentalResults 는 컴포넌트 본문 함수(매 렌더 재생성)라 deps 에
      // 넣으면 editMode 무변경에도 브러쉬 effect 가 반복 재설정된다. editMode 만 의존.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editMode]);

    // 5) 외부 ref API
    useImperativeHandle(
      ref,
      () => ({
        setView(preset) {
          const camera = cameraRef.current;
          if (!camera) return;
          applyViewPreset(camera, preset);
        },
        fit() {
          const camera = cameraRef.current;
          if (!camera) return;
          const meshes = Array.from(meshMapRef.current.values());
          if (meshes.length > 0) {
            frameCameraToMeshes(camera, meshes);
          } else {
            resetCameraOnPlate(camera, plateWRef.current, plateDRef.current);
          }
        },
        fitSelection(ids) {
          const camera = cameraRef.current;
          if (!camera) return;
          // 넘어온 id 에 해당하는 STL 루트 메쉬만 모은다 (fit() 의 meshMapRef 재사용).
          const meshes = ids
            .map((id) => meshMapRef.current.get(id))
            .filter((m): m is NonNullable<typeof m> => m != null);
          if (meshes.length > 0) {
            frameCameraToMeshes(camera, meshes);
          } else {
            // 매칭 0 개 → 전체 fit() 폴백 (선택 없음 = 전체 맞춤).
            const all = Array.from(meshMapRef.current.values());
            if (all.length > 0) {
              frameCameraToMeshes(camera, all);
            } else {
              resetCameraOnPlate(camera, plateWRef.current, plateDRef.current);
            }
          }
        },
        viewPlate() {
          const camera = cameraRef.current;
          if (!camera) return;
          // 홈(iso) 각도로 리셋 + 플레이트 AABB 프레이밍. resetCameraOnPlate 내부에서
          // applyViewPreset(camera, "iso") 로 홈 각도를 적용한다 (home == iso 각도).
          resetCameraOnPlate(camera, plateWRef.current, plateDRef.current);
        },
        previewTransform(id, t) {
          const mesh = meshMapRef.current.get(id);
          if (mesh) applyTransformToMesh(mesh, t);
        },
        generateAutoSupports(projectId, params) {
          const scene = sceneRef.current;
          if (!scene) return [];
          const out: SupportPointV2[] = [];
          const all = Array.from(meshMapRef.current.entries());
          for (const [stlId, mesh] of all) {
            const others = all
              .filter(([id]) => id !== stlId)
              .map(([, m]) => m);
            const pts = autoGenerateSupportPoints(
              scene,
              mesh,
              others,
              params,
              projectId,
              stlId,
            );
            out.push(...pts);
          }
          return out;
        },
        autoSupportIslands(projectId, params) {
          const scene = sceneRef.current;
          if (!scene) return null;
          const island = islandResultRef.current;
          // 아일랜드 검출 결과가 없으면 파이프라인 시작점이 없음 → null.
          if (!island || island.islandFaces.size === 0) return null;

          const stlId = island.stlId;
          const mesh = meshMapRef.current.get(stlId);
          if (!mesh) return null;

          // island face 집합 = faceFilter — 후보 접점을 검출 영역 위로만 제한.
          const others = Array.from(meshMapRef.current.entries())
            .filter(([id]) => id !== stlId)
            .map(([, m]) => m);
          const pts = autoGenerateSupportPoints(
            scene,
            mesh,
            others,
            params,
            projectId,
            stlId,
            { faceFilter: island.islandFaces },
          );

          // 같은 STL 의 마진 결과가 있으면 각 접점에 margin-guard 적용 —
          //   마진 라인 밖으로 밀어내고, 확보 못 하면 배제 (원본 scopedSupport 이식).
          //   원본 bodyR = settings.tipBottomDiameter (disc 팁 아랫면 지름 = 마진에
          //   가장 가까운 접점 부위). v2 SupportParams 에는 tipBottomDiameter 필드가
          //   없어, 접점(팁) 지름인 tipDiameterMm 를 그 대응값으로 쓴다. (마진 가드는
          //   접점 근방 클리어런스이므로 팁 지름이 가장 근접한 의미 대응.)
          const margin =
            marginRef.current && marginRef.current.stlId === stlId
              ? marginRef.current
              : null;
          if (!margin) {
            console.log(
              `[검출 영역 자동 서포트] island face ${island.islandFaces.size}면 → ` +
                `생성 ${pts.length}개 (마진 없음 — 가드 미적용)`,
            );
            // 생성 성공 시 island 검출 상태를 소진 (감사 B6): 마젠타 overlay +
            //   islandResultRef 를 정리해 같은 자리에 중복 생성/stale 결과 재사용을
            //   막는다. 페이지 islandStatus 리셋은 handleAutoSupportIslands 가 담당
            //   → 버튼 자연 비활성 (재클릭하려면 재검출). 빈 배열이면 소진하지 않아
            //   사용자가 파라미터를 바꿔 재시도할 수 있게 한다. 마진 결과는 건드리지
            //   않는다 (island 만 소진).
            if (pts.length > 0) disposeIslandVisualization(stlId);
            return pts;
          }

          const bodyR = params.tipDiameterMm;
          // 재검증용 mesh AABB — 아래→위 ray 발사 범위 (auto-generate 와 동일 규약).
          mesh.computeWorldMatrix(true);
          mesh.refreshBoundingInfo();
          const bb = mesh.getBoundingInfo().boundingBox;
          const reYTop = bb.maximumWorld.y + 1;
          const reYBelow = bb.minimumWorld.y - 1;
          const reRayLen = reYTop - reYBelow;
          const reUp = new Vector3(0, 1, 0);
          const otherMeshes = Array.from(meshMapRef.current.entries())
            .filter(([id]) => id !== stlId)
            .map(([, m]) => m);
          const PEN = 0.3; // auto-generate 와 동일 — contact 를 표면 안쪽으로 push.

          const guarded: SupportPointV2[] = [];
          let excluded = 0;
          let moved = 0;
          for (const p of pts) {
            const adj = guardContactAgainstMargin(
              p.contact,
              margin.points,
              bodyR,
            );
            if (!adj) {
              excluded++;
              continue;
            }
            const didMove =
              Math.abs(adj[0] - p.contact[0]) > 1e-6 ||
              Math.abs(adj[2] - p.contact[2]) > 1e-6;
            if (!didMove) {
              // XZ 불변 → 원본 접점 그대로 (표면 재검증 불필요).
              guarded.push(p);
              continue;
            }

            // ── 이동 후 표면 재검증 (원본 STLViewer scopedSupport 3482-3490 이식) ──
            //   가드 push 로 XZ 가 바뀌면 그 새 XZ 에서 표면을 다시 raycast 해 Y 를
            //   재스냅한다. v2 데이터는 IndexedDB 최종 커밋이라 뒤에서 보정 기회가
            //   없으므로, 히트 없음/island 이탈이면 어중간한 보정 대신 폐기한다.
            //   ray 방향은 auto-generate 와 동일(아래→위)로 맞춰 face 번호 체계 일치.
            const reOrigin = new Vector3(adj[0], reYBelow, adj[2]);
            const reInfo = scene.pickWithRay(
              new Ray(reOrigin, reUp, reRayLen),
              (m) => m === mesh,
            );
            // 1) 히트 없으면 폐기.
            if (!reInfo?.hit || !reInfo.pickedPoint) {
              excluded++;
              continue;
            }
            // 2) island faceFilter 재확인 — 이동으로 검출 영역 밖이면 폐기.
            if (
              reInfo.faceId < 0 ||
              !island.islandFaces.has(reInfo.faceId)
            ) {
              excluded++;
              continue;
            }
            const reNormal = reInfo.getNormal(true, true);
            if (!reNormal) {
              excluded++;
              continue;
            }
            // 3) 새 pickedPoint/normal 로 contact 재계산 (PEN 0.3 push 규약 포함).
            const cX = reInfo.pickedPoint.x - reNormal.x * PEN;
            const cY = reInfo.pickedPoint.y - reNormal.y * PEN;
            const cZ = reInfo.pickedPoint.z - reNormal.z * PEN;
            // 4) base 동기화 — 새 contact XZ 로. 원본 base Y 가 0(플레이트)이면 그대로
            //    유지, 다른 STL 표면(base Y>0)이었으면 새 XZ 에서 base Y 재확인.
            let baseY = 0;
            if (p.base[1] > 0 && otherMeshes.length > 0 && cY > 0) {
              const downRay = new Ray(
                new Vector3(cX, cY - 0.01, cZ),
                new Vector3(0, -1, 0),
                cY,
              );
              for (const om of otherMeshes) {
                const hit = om.intersects(downRay, false);
                if (hit.hit && hit.pickedPoint && hit.pickedPoint.y > baseY) {
                  baseY = hit.pickedPoint.y;
                }
              }
            }
            moved++;
            guarded.push({
              ...p,
              contact: [cX, cY, cZ],
              base: [cX, baseY, cZ],
            });
          }
          console.log(
            `[검출 영역 자동 서포트] island face ${island.islandFaces.size}면 → ` +
              `후보 ${pts.length}개 · 마진 가드 이동 ${moved} · 배제 ${excluded} → ` +
              `생성 ${guarded.length}개 (marginPoints ${margin.points.length}개 · ` +
              `가드 ${bodyR.toFixed(2)}mm + 0.5mm)`,
          );
          // 생성 성공 시 island 검출 상태 소진 (감사 B6 — 위 마진 없음 분기와 동일).
          //   마진 결과(marginRef)는 유지, island overlay/ref 만 정리한다.
          if (guarded.length > 0) disposeIslandVisualization(stlId);
          return guarded;
        },
        exportStl() {
          const stl = Array.from(meshMapRef.current.values());
          const supports = Array.from(supportMeshMapRef.current.values());
          if (stl.length === 0) return null;
          return meshesToStlBlob([...stl, ...supports]);
        },
        getFdmSliceInput(settings) {
          // exportStl 과 동일한 mesh 집합 (STL + 서포트).
          const stl = Array.from(meshMapRef.current.values());
          const supports = Array.from(supportMeshMapRef.current.values());
          if (stl.length === 0) return null;
          const meshes = [...stl, ...supports];

          // getSceneTopY 가 top(maximumWorld.y) 을 구하는 방식과 대칭으로
          // bottom(minimumWorld.y) 도 함께 구해 실제 슬라이스 범위를 정한다.
          let yMin = Infinity;
          let yMax = -Infinity;
          for (const mesh of meshes) {
            mesh.computeWorldMatrix(true);
            const bb = mesh.getBoundingInfo().boundingBox;
            if (bb.minimumWorld.y < yMin) yMin = bb.minimumWorld.y;
            if (bb.maximumWorld.y > yMax) yMax = bb.maximumWorld.y;
          }
          if (yMin === Infinity || yMax <= yMin) return null;

          const merged: FdmSettings = {
            ...DEFAULT_FDM_SETTINGS,
            // buildWidth/buildDepth 는 getSliceMask 와 동일한 출처(plateWRef/plateDRef).
            buildWidth: plateWRef.current,
            buildDepth: plateDRef.current,
            ...settings,
          };

          // 씬(Babylon Mesh)은 워커로 못 넘어가므로 world 삼각형 배열로 직렬화.
          // (generateFdmGcode 의 Mesh 버전이 하던 추출과 동일 — extractWorldTriangles.)
          const out: { triangles: Float32Array }[] = [];
          for (const mesh of meshes) {
            const tris = extractWorldTriangles(mesh);
            if (tris.length > 0) out.push({ triangles: tris });
          }
          if (out.length === 0) return null;

          return { meshes: out, settings: merged, range: { yMin, yMax } };
        },
        getSliceMask(sliceY, widthPx, heightPx) {
          const polys = [];
          for (const mesh of meshMapRef.current.values()) {
            const segs = sliceMeshAtY(mesh, sliceY);
            polys.push(...chainSegments(segs));
          }
          for (const sm of supportMeshMapRef.current.values()) {
            const segs = sliceMeshAtY(sm, sliceY);
            polys.push(...chainSegments(segs));
          }
          return rasterizePolygons(polys, {
            widthPx,
            heightPx,
            plateWidthMm: plateWRef.current,
            plateDepthMm: plateDRef.current,
          });
        },
        getSliceGeometry() {
          // getSliceMask 와 동일한 mesh 집합 (STL + 서포트) 을 world 삼각형으로.
          const out: { triangles: Float32Array }[] = [];
          for (const mesh of meshMapRef.current.values()) {
            const tris = extractWorldTriangles(mesh);
            if (tris.length > 0) out.push({ triangles: tris });
          }
          for (const sm of supportMeshMapRef.current.values()) {
            const tris = extractWorldTriangles(sm);
            if (tris.length > 0) out.push({ triangles: tris });
          }
          return out;
        },
        getSceneTopY() {
          let top = 0;
          for (const mesh of meshMapRef.current.values()) {
            mesh.computeWorldMatrix(true);
            const y = mesh.getBoundingInfo().boundingBox.maximumWorld.y;
            if (y > top) top = y;
          }
          for (const sm of supportMeshMapRef.current.values()) {
            sm.computeWorldMatrix(true);
            const y = sm.getBoundingInfo().boundingBox.maximumWorld.y;
            if (y > top) top = y;
          }
          return top;
        },
        getBuildVolumeMm3() {
          let model = 0;
          for (const mesh of meshMapRef.current.values()) {
            model += computeMeshVolumeMm3(mesh);
          }
          let support = 0;
          for (const sm of supportMeshMapRef.current.values()) {
            support += computeMeshVolumeMm3(sm);
          }
          return { model, support };
        },
        worldToStlLocal(stlId, world) {
          const stlMesh = meshMapRef.current.get(stlId);
          if (!stlMesh) return null;
          return worldToStlLocalUtil(world, stlMesh);
        },
        stlLocalToWorld(stlId, local) {
          const stlMesh = meshMapRef.current.get(stlId);
          if (!stlMesh) return null;
          return stlLocalToWorldUtil(local, stlMesh);
        },
        autoRouteBridge(base, contact, cps, excludeStlIds) {
          const SAFETY_MM = 5;
          const excluded = new Set(excludeStlIds);
          const candidates: Mesh[] = [];
          for (const [id, m] of meshMapRef.current) {
            if (!excluded.has(id)) candidates.push(m);
          }
          if (candidates.length === 0) return cps;

          // 경로 4 segment 가 어느 한 STL 과라도 교차하는지 검사.
          const path = [
            new Vector3(base[0], base[1], base[2]),
            new Vector3(cps[0][0], cps[0][1], cps[0][2]),
            new Vector3(cps[1][0], cps[1][1], cps[1][2]),
            new Vector3(cps[2][0], cps[2][1], cps[2][2]),
            new Vector3(contact[0], contact[1], contact[2]),
          ];
          let collides = false;
          for (let i = 0; i < path.length - 1 && !collides; i++) {
            const dir = path[i + 1].subtract(path[i]);
            const len = dir.length();
            if (len < 1e-6) continue;
            dir.scaleInPlace(1 / len);
            const ray = new Ray(path[i], dir, len);
            for (const mesh of candidates) {
              const hit = mesh.intersects(ray, false);
              if (hit.hit) {
                collides = true;
                break;
              }
            }
          }
          if (!collides) return cps;

          // 충분히 높은 시작점에서 각 변곡점 (X, Z) 으로 -Y ray.
          // 그 위치의 가장 가까운 STL 상단 + SAFETY 로 lift.
          let maxY = 0;
          for (const mesh of candidates) {
            mesh.computeWorldMatrix(true);
            const y = mesh.getBoundingInfo().boundingBox.maximumWorld.y;
            if (y > maxY) maxY = y;
          }
          const startY = maxY + 100;

          const liftCp = (cp: [number, number, number]): [number, number, number] => {
            const origin = new Vector3(cp[0], startY, cp[2]);
            const ray = new Ray(origin, new Vector3(0, -1, 0), startY);
            let surfaceY = 0;
            for (const mesh of candidates) {
              const hit = mesh.intersects(ray, false);
              if (hit.hit && hit.pickedPoint && hit.pickedPoint.y > surfaceY) {
                surfaceY = hit.pickedPoint.y;
              }
            }
            return [cp[0], Math.max(cp[1], surfaceY + SAFETY_MM), cp[2]];
          };

          return [liftCp(cps[0]), liftCp(cps[1]), liftCp(cps[2])];
        },
        findSurfaceBelow(x, z, startY, excludeStlIds) {
          const excluded = new Set(excludeStlIds);
          const candidates: Mesh[] = [];
          for (const [id, m] of meshMapRef.current) {
            if (!excluded.has(id)) candidates.push(m);
          }
          if (candidates.length === 0) return 0;

          const origin = new Vector3(x, startY, z);
          const ray = new Ray(origin, new Vector3(0, -1, 0), startY);
          let bestY = 0;
          for (const mesh of candidates) {
            const hit = mesh.intersects(ray, false);
            if (hit.hit && hit.pickedPoint && hit.pickedPoint.y > bestY) {
              bestY = hit.pickedPoint.y;
            }
          }
          return bestY;
        },
        projectToStlSurface(stlId, point, hintNormal) {
          const stlMesh = meshMapRef.current.get(stlId);
          const scene = sceneRef.current;
          if (!stlMesh || !scene) return null;

          const origin = new Vector3(point[0], point[1], point[2]);
          const predicate = (m: import("@babylonjs/core").AbstractMesh) =>
            m === stlMesh;

          type Hit = {
            pt: Vector3;
            normal: Vector3;
            dist: number;
          };
          let best: Hit | null = null;

          const tryDir = (dx: number, dy: number, dz: number) => {
            const len = Math.hypot(dx, dy, dz);
            if (len < 1e-6) return;
            const dir = new Vector3(dx / len, dy / len, dz / len);
            const ray = new Ray(origin, dir, 200);
            const pick = scene.pickWithRay(ray, predicate);
            if (
              pick?.hit &&
              pick.pickedPoint &&
              typeof pick.distance === "number"
            ) {
              const n =
                pick.getNormal(true, true) ?? new Vector3(0, 1, 0);
              if (!best || pick.distance < best.dist) {
                best = {
                  pt: pick.pickedPoint.clone(),
                  normal: n.clone(),
                  dist: pick.distance,
                };
              }
            }
          };

          if (hintNormal) {
            tryDir(hintNormal[0], hintNormal[1], hintNormal[2]);
            tryDir(-hintNormal[0], -hintNormal[1], -hintNormal[2]);
          } else {
            tryDir(1, 0, 0);
            tryDir(-1, 0, 0);
            tryDir(0, 1, 0);
            tryDir(0, -1, 0);
            tryDir(0, 0, 1);
            tryDir(0, 0, -1);
          }
          if (!best) return null;

          // normal 이 안쪽을 향하면 뒤집어 (outward) — point 가 STL 밖에
          // 있을 때 origin → pt 방향과 normal 의 dot 가 양수여야 outward.
          const bestHit: Hit = best;
          const toOrigin = origin.subtract(bestHit.pt);
          if (Vector3.Dot(bestHit.normal, toOrigin) < 0) {
            bestHit.normal.scaleInPlace(-1);
          }

          // 반대편 두께: 표면 점에서 inward normal 방향으로 ray, 같은
          // 메쉬 다음 hit. 모델이 너무 두꺼우면 200mm 까지만 본다.
          const inward = bestHit.normal.scale(-1);
          const insideOrigin = bestHit.pt.add(inward.scale(0.05));
          const insideRay = new Ray(insideOrigin, inward, 200);
          const farPick = scene.pickWithRay(insideRay, predicate);
          const thickness =
            farPick?.hit && typeof farPick.distance === "number"
              ? farPick.distance + 0.05
              : Number.POSITIVE_INFINITY;

          return {
            point: [bestHit.pt.x, bestHit.pt.y, bestHit.pt.z],
            normal: [
              bestHit.normal.x,
              bestHit.normal.y,
              bestHit.normal.z,
            ],
            thickness,
          };
        },
        clearDentalPaint() {
          // 오버레이 데칼 dispose + painted 점 초기화 (원본 clearMask 대응).
          const affected = new Set<Mesh>();
          for (const pt of paintPointsRef.current) affected.add(pt.mesh);
          for (const ov of paintOverlaysRef.current) ov.dispose(false, true);
          paintOverlaysRef.current = [];
          paintPointsRef.current = [];
          // 원본 clearMask 는 autoFill(floodfill) 도 함께 정리했다 → 마진 시각화·
          //   floodfill 도 지운다. 색칠이 사라지면 그 마진은 무의미하므로 일관.
          disposeMarginVisualization();
          // 색칠이 사라지면 그 아일랜드 시각화도 무의미 → 함께 정리 (2-3b 패턴).
          disposeIslandVisualization();
          // 색칠이 있던 STL 마다 빈 목록 통지.
          for (const mesh of affected) {
            for (const [id, m] of meshMapRef.current) {
              if (m === mesh) {
                onPaintedFacesChangeRef.current?.(id, []);
                break;
              }
            }
          }
        },
        getPaintedFaceIds(stlId) {
          const mesh = meshMapRef.current.get(stlId);
          if (!mesh) return [];
          return Array.from(
            computePaintedFaceIds(mesh, paintPointsRef.current),
          );
        },
        findDentalMargin() {
          return runFindDentalMargin();
        },
        clearDentalMargin() {
          // 마진 시각화 + floodfill 만 정리. 브러쉬 색칠(painted)은 유지.
          disposeMarginVisualization();
        },
        detectDentalIslands(layerHeightMm) {
          return runDetectDentalIslands(layerHeightMm);
        },
        clearDentalIslands() {
          // 아일랜드 마젠타 overlay + 결과 ref 만 정리. 색칠/마진은 유지.
          disposeIslandVisualization();
        },
        invalidateDentalResults(stlId) {
          // 페이지 측 transform 수렴점에서 호출. 마진·아일랜드 dispose+ref null +
          // onDentalResultsInvalidated 콜백 (감사 B1). refs 만 참조라 [] 핸들 안전.
          invalidateDentalResults(stlId);
        },
      }),
      // 핸들은 ref/stable 함수만 참조 → 정체성 고정을 위해 []. runFindDentalMargin/
      //   disposeMarginVisualization 은 refs 만 close-over 하는 순수 함수 선언이라
      //   deps 에 넣지 않아도 안전 (다른 핸들 메서드와 동일 패턴).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    return (
      <canvas
        ref={canvasRef}
        className={`w-full h-full outline-none ${className}`}
        style={{ display: "block" }}
      />
    );
  },
);

export default BabylonScene;
