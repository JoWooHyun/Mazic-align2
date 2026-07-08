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
  return [
    point.source,
    c,
    b,
    cps,
    params.trunkDiameterMm,
    params.tipDiameterMm,
    params.baseDiameterMm,
    params.baseTransitionMm,
    params.tipTransitionMm,
    params.bridgeDiameterMm,
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
import { generateFdmGcode } from "../utils/gcode/slice-adapter";
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
  className?: string;
}

export interface BabylonSceneHandle {
  setView: (preset: ViewPreset) => void;
  fit: () => void;
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
   * 씬의 모든 STL + 서포트 mesh 를 (exportStl 과 동일한 집합) FDM
   * G-code 로 슬라이스한 전체 문자열. 모델이 0 개면 null.
   * settings 미지정 필드는 DEFAULT_FDM_SETTINGS 로 채운다.
   */
  exportFdmGcode: (settings?: Partial<FdmSettings>) => string | null;
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
    const onBrushThicknessChangeRef = useRef(onBrushThicknessChange);
    onBrushThicknessChangeRef.current = onBrushThicknessChange;
    // dental-brush painted 점 (세션 상태 원본 = 원본 maskRef 방식 이식).
    // localPoint/localNormal/radius 로 저장 → STL 회전·이동을 자동 추적.
    const paintPointsRef = useRef<PaintPoint[]>([]);
    // painted 시각화 데칼 mesh (주황). painted 점과 index 1:1 대응.
    const paintOverlaysRef = useRef<Mesh[]>([]);
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
      console.log(
        `[stl-useEffect] currentIds=${currentIds.size} files=${files.length} newFiles=${newFiles.length}`,
      );
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
          onPaintedFacesChangeRef.current?.(stlId, Array.from(faces));
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
        }
        // 원본의 마진 floodfill 더블탭(POINTERDOUBLETAP)은 이 조각 범위 밖
        // (마진/아일랜드는 2-3b/c) — 여기서는 색칠만 담당.
      });

      return () => {
        // 스트로크 중 모드 전환 등으로 UP 을 못 받은 경우 대비 — 남은 touched
        //   mesh 를 정리 통지 (통지 누락 방지).
        flushPaintedNotifications();
        scene.onPointerObservable.remove(obs);
        canvas.style.cursor = "";
        brushRing.dispose(false, true);
        rm.dispose();
        canvas.removeEventListener("wheel", maskWheel, true);
        // 원본은 도구 종료 시 clearMask() 로 색칠을 지웠다. v2 에서는 모드
        // 전환 시 painted(세션 상태)를 유지 — margin/island 조각이 같은 색칠을
        // 재사용할 수 있도록. 명시적 지우기는 clearDentalPaint()(패널 버튼).
      };
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
        exportStl() {
          const stl = Array.from(meshMapRef.current.values());
          const supports = Array.from(supportMeshMapRef.current.values());
          if (stl.length === 0) return null;
          return meshesToStlBlob([...stl, ...supports]);
        },
        exportFdmGcode(settings) {
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

          return generateFdmGcode(meshes, merged, { yMin, yMax });
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
      }),
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
