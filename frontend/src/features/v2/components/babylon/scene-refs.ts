// BabylonScene 의 ~45개 useRef 를 하나의 SceneCtx 로 묶어 생성하는 훅.
//   기능 훅·액션 함수는 모두 이 ctx 를 인자로 받아 동일 ref 인스턴스를 공유한다.
//   props→ref 미러링(매 렌더 최신값 대입)도 여기서 수행 — 원본 컴포넌트 본문의
//   `xxxRef.current = prop` 배선을 그대로 옮긴 것이라 동작 무변경.
//   ⚠️ pendingInvalidationsRef 등 전 조각을 관통하는 ref 는 반드시 컴포넌트
//   레벨(이 ctx)에서 소유 — 브러쉬 훅 로컬로 내리면 B3 레이스 회귀.
import { useRef, type MutableRefObject } from "react";
import type {
  ArcRotateCamera,
  Engine,
  HighlightLayer,
  LinesMesh,
  Mesh,
  Observer,
  PointerDragBehavior,
  PointerInfoPre,
  PositionGizmo,
  RotationGizmo,
  ScaleGizmo,
  Scene,
  StandardMaterial,
  TransformNode,
  UtilityLayerRenderer,
} from "@babylonjs/core";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { TransformV2 } from "../../types/transform";
import type { createSupportMaterial } from "../../utils/support-render";
import type { createSliceFillMaterial } from "../../utils/slice-render";
import type { SceneFurniture } from "../../utils/scene-setup";
import type { PaintPoint } from "../../utils/dental/paint-mask";
import type { FindMarginResult } from "../../utils/dental/margin-detect";
import type { SupportPointV2 } from "../../support/types";
import type { EditMode } from "../EditModeControls";
import type {
  BabylonSceneProps,
  GizmoMode,
  IslandResultSlim,
} from "./babylon-scene-types";

/** gizmo/STL 드래그가 공유하는 드래그 시작 스냅샷 union (원본 gizmoDragStartRef). */
export type GizmoDragStart =
  | { kind: "stl"; id: string; t: TransformV2 }
  | { kind: "support"; id: string }
  | { kind: "bridge-cp"; id: string; cpIdx: number }
  | { kind: "bridge-ep"; id: string; which: "base" | "contact" }
  | null;

type SupportMaterial = ReturnType<typeof createSupportMaterial>;
type SliceFillMaterial = ReturnType<typeof createSliceFillMaterial>;

/** Bridge subtract 결과 vertex data cache 값 (supportId 기준). */
export interface BridgeClipCache {
  key: string;
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
}

/**
 * 모든 분리 훅·액션 함수가 공유하는 씬 컨텍스트. 각 필드는 원본 컴포넌트 본문의
 * 동명 ref 와 1:1 대응한다. props 미러 ref 는 useSceneRefs 가 매 렌더 최신값으로
 * 갱신하므로 effect 바깥에서도 최신 prop 을 참조할 수 있다 (원본 패턴 유지).
 */
export interface SceneCtx {
  // ── 코어 씬 오브젝트 ──
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  engineRef: MutableRefObject<Engine | null>;
  sceneRef: MutableRefObject<Scene | null>;
  cameraRef: MutableRefObject<ArcRotateCamera | null>;
  meshMapRef: MutableRefObject<Map<string, Mesh>>;
  dragBehaviorMapRef: MutableRefObject<Map<string, PointerDragBehavior>>;

  // ── 서포트 ──
  supportsRef: MutableRefObject<SupportPointV2[]>;
  supportMeshMapRef: MutableRefObject<Map<string, Mesh>>;
  supportMaterialRef: MutableRefObject<SupportMaterial | null>;

  // ── manifold (wasm) ──
  manifoldModuleRef: MutableRefObject<ManifoldToplevel | null>;
  stlManifoldMapRef: MutableRefObject<Map<string, Manifold>>;
  bridgeClipCacheRef: MutableRefObject<Map<string, BridgeClipCache>>;

  // ── 슬라이스 미리보기 ──
  sliceOutlineRef: MutableRefObject<LinesMesh | null>;
  sliceFillMeshesRef: MutableRefObject<Mesh[]>;
  sliceModelMatRef: MutableRefObject<SliceFillMaterial | null>;
  sliceSupportMatRef: MutableRefObject<SliceFillMaterial | null>;

  // ── Bridge 시각화 ──
  bridgeMarkerRef: MutableRefObject<Mesh | null>;
  bridgeMarkerMatRef: MutableRefObject<StandardMaterial | null>;
  bridgeCpMeshesRef: MutableRefObject<Mesh[]>;
  bridgeCpMatRef: MutableRefObject<StandardMaterial | null>;
  bridgeBMatRef: MutableRefObject<StandardMaterial | null>;
  selectedBridgeSphereRef: MutableRefObject<Mesh | null>;

  // ── 씬 furniture / highlight / gizmo ──
  furnitureRef: MutableRefObject<SceneFurniture | null>;
  highlightRef: MutableRefObject<HighlightLayer | null>;
  utilityLayerRef: MutableRefObject<UtilityLayerRenderer | null>;
  /** 휠 줌 방향 감지 옵저버 (B-28). dispose 시 명시적으로 제거한다. */
  wheelObserverRef: MutableRefObject<Observer<PointerInfoPre> | null>;
  positionGizmoRef: MutableRefObject<PositionGizmo | null>;
  rotationGizmoRef: MutableRefObject<RotationGizmo | null>;
  scaleGizmoRef: MutableRefObject<ScaleGizmo | null>;
  gizmoDragStartRef: MutableRefObject<GizmoDragStart>;
  gizmoModeRef: MutableRefObject<GizmoMode>;
  /**
   * 회전/스케일 기즈모가 attach 되는 피벗 프록시 노드 (B-9). 메인 씬에 있고,
   * 드래그 시작·선택 동기화 시점마다 현재 bbox 중심으로 재배치된다. mesh 를
   * 이 노드의 자식으로 임시 부모화해 "bbox 중심 기준 회전/스케일"을 만든다.
   */
  pivotProxyRef: MutableRefObject<TransformNode | null>;

  // ── prop 미러 ref (effect 바깥 최신값 참조) ──
  overhangRef: MutableRefObject<number>;
  liftRef: MutableRefObject<number>;
  bridgeDiamRef: MutableRefObject<number>;
  plateWRef: MutableRefObject<number>;
  plateDRef: MutableRefObject<number>;
  editModeRef: MutableRefObject<EditMode>;
  onAddSupportRef: MutableRefObject<BabylonSceneProps["onAddSupportAt"]>;
  onPickSupportRef: MutableRefObject<BabylonSceneProps["onPickSupport"]>;
  onMoveSupportRef: MutableRefObject<BabylonSceneProps["onMoveSupport"]>;
  onMoveBridgeCpRef: MutableRefObject<BabylonSceneProps["onMoveBridgeControlPoint"]>;
  onMoveBridgeEndpointRef: MutableRefObject<BabylonSceneProps["onMoveBridgeEndpoint"]>;
  onDoublePickStlRef: MutableRefObject<BabylonSceneProps["onDoublePickStl"]>;
  onDoublePickBridgeTubeRef: MutableRefObject<
    BabylonSceneProps["onDoublePickBridgeTube"]
  >;
  onSelectBridgeControlPointRef: MutableRefObject<
    BabylonSceneProps["onSelectBridgeControlPoint"]
  >;
  alignFloorModeRef: MutableRefObject<boolean>;
  onAlignFaceToFloorRef: MutableRefObject<BabylonSceneProps["onAlignFaceToFloor"]>;
  brushThicknessRef: MutableRefObject<number>;
  onPaintedFacesChangeRef: MutableRefObject<BabylonSceneProps["onPaintedFacesChange"]>;
  onDentalResultsInvalidatedRef: MutableRefObject<
    BabylonSceneProps["onDentalResultsInvalidated"]
  >;
  onBrushThicknessChangeRef: MutableRefObject<
    BabylonSceneProps["onBrushThicknessChange"]
  >;
  selectedSupportRef: MutableRefObject<string | null>;
  bridgeModeRef: MutableRefObject<boolean>;
  selectedRef: MutableRefObject<ReadonlySet<string>>;
  onPickRef: MutableRefObject<BabylonSceneProps["onPick"]>;
  onGizmoCommitRef: MutableRefObject<BabylonSceneProps["onGizmoCommit"]>;

  // ── dental-brush / 마진 / 아일랜드 상태 ──
  paintPointsRef: MutableRefObject<PaintPoint[]>;
  paintOverlaysRef: MutableRefObject<Mesh[]>;
  marginRef: MutableRefObject<(FindMarginResult & { stlId: string }) | null>;
  marginMarkersRef: MutableRefObject<Mesh[]>;
  autoFillFacesRef: MutableRefObject<Set<number>>;
  autoFillOverlayRef: MutableRefObject<Mesh[]>;
  islandResultRef: MutableRefObject<IslandResultSlim | null>;
  islandMarkersRef: MutableRefObject<Mesh[]>;
  // ── 서포트 재설계(S-4) 검출·점생성 시각화 (신규, 기존 island 슬롯과 별개) ──
  //   재설계 오버레이(아일랜드/오버행 색 + 서포트 점 구) 메쉬 목록. dispose 대상.
  redesignMarkersRef: MutableRefObject<Mesh[]>;
  pendingInvalidationsRef: MutableRefObject<
    Map<string, ReturnType<typeof setTimeout>>
  >;
  isUnmountingRef: MutableRefObject<boolean>;
}

/**
 * SceneCtx 를 구성하는 훅. 원본 BabylonScene 본문의 useRef 선언 + props 미러링을
 * 그대로 옮겼다. 반환 객체는 매 렌더 새로 만들지만 담긴 ref 인스턴스는 안정적이다.
 */
export function useSceneRefs(props: BabylonSceneProps): SceneCtx {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const meshMapRef = useRef<Map<string, Mesh>>(new Map());
  const dragBehaviorMapRef = useRef<Map<string, PointerDragBehavior>>(
    new Map(),
  );
  const supportsRef = useRef<SupportPointV2[]>(props.supports);
  supportsRef.current = props.supports;
  const supportMeshMapRef = useRef<Map<string, Mesh>>(new Map());
  const supportMaterialRef = useRef<SupportMaterial | null>(null);
  const manifoldModuleRef = useRef<ManifoldToplevel | null>(null);
  const stlManifoldMapRef = useRef<Map<string, Manifold>>(new Map());
  const bridgeClipCacheRef = useRef<Map<string, BridgeClipCache>>(new Map());
  const sliceOutlineRef = useRef<LinesMesh | null>(null);
  const sliceFillMeshesRef = useRef<Mesh[]>([]);
  const bridgeMarkerRef = useRef<Mesh | null>(null);
  const bridgeMarkerMatRef = useRef<StandardMaterial | null>(null);
  const bridgeCpMeshesRef = useRef<Mesh[]>([]);
  const bridgeCpMatRef = useRef<StandardMaterial | null>(null);
  const bridgeBMatRef = useRef<StandardMaterial | null>(null);
  const selectedBridgeSphereRef = useRef<Mesh | null>(null);
  const sliceModelMatRef = useRef<SliceFillMaterial | null>(null);
  const sliceSupportMatRef = useRef<SliceFillMaterial | null>(null);
  const furnitureRef = useRef<SceneFurniture | null>(null);
  const highlightRef = useRef<HighlightLayer | null>(null);
  const utilityLayerRef = useRef<UtilityLayerRenderer | null>(null);
  const wheelObserverRef = useRef<Observer<PointerInfoPre> | null>(null);
  const positionGizmoRef = useRef<PositionGizmo | null>(null);
  const rotationGizmoRef = useRef<RotationGizmo | null>(null);
  const scaleGizmoRef = useRef<ScaleGizmo | null>(null);
  const gizmoDragStartRef = useRef<GizmoDragStart>(null);
  const gizmoModeRef = useRef<GizmoMode>(props.gizmoMode);
  gizmoModeRef.current = props.gizmoMode;
  // 회전/스케일 피벗 프록시 (B-9). setupGizmos 가 메인 씬에 생성해 채운다.
  const pivotProxyRef = useRef<TransformNode | null>(null);

  // 최신 값을 effect 바깥에서 참조할 수 있게 ref 로 동기화.
  const overhangRef = useRef<number>(props.overhangAngleDeg);
  overhangRef.current = props.overhangAngleDeg;
  const liftRef = useRef<number>(props.supportParams.liftMm);
  liftRef.current = props.supportParams.liftMm;
  const bridgeDiamRef = useRef<number>(props.supportParams.bridgeDiameterMm);
  bridgeDiamRef.current = props.supportParams.bridgeDiameterMm;
  const plateWRef = useRef<number>(props.plateWidthMm);
  plateWRef.current = props.plateWidthMm;
  const plateDRef = useRef<number>(props.plateDepthMm);
  plateDRef.current = props.plateDepthMm;
  const editModeRef = useRef<EditMode>(props.editMode);
  editModeRef.current = props.editMode;
  const onAddSupportRef = useRef(props.onAddSupportAt);
  onAddSupportRef.current = props.onAddSupportAt;
  const onPickSupportRef = useRef(props.onPickSupport);
  onPickSupportRef.current = props.onPickSupport;
  const onMoveSupportRef = useRef(props.onMoveSupport);
  onMoveSupportRef.current = props.onMoveSupport;
  const onMoveBridgeCpRef = useRef(props.onMoveBridgeControlPoint);
  onMoveBridgeCpRef.current = props.onMoveBridgeControlPoint;
  const onMoveBridgeEndpointRef = useRef(props.onMoveBridgeEndpoint);
  onMoveBridgeEndpointRef.current = props.onMoveBridgeEndpoint;
  const onDoublePickStlRef = useRef(props.onDoublePickStl);
  onDoublePickStlRef.current = props.onDoublePickStl;
  const onDoublePickBridgeTubeRef = useRef(props.onDoublePickBridgeTube);
  onDoublePickBridgeTubeRef.current = props.onDoublePickBridgeTube;
  const onSelectBridgeControlPointRef = useRef(props.onSelectBridgeControlPoint);
  onSelectBridgeControlPointRef.current = props.onSelectBridgeControlPoint;
  const alignFloorModeRef = useRef<boolean>(!!props.alignFloorMode);
  alignFloorModeRef.current = !!props.alignFloorMode;
  const onAlignFaceToFloorRef = useRef(props.onAlignFaceToFloor);
  onAlignFaceToFloorRef.current = props.onAlignFaceToFloor;
  // dental-brush: 브러쉬 두께 + painted 변경 콜백 (effect 재실행 없이 최신 참조).
  const brushThicknessRef = useRef<number>(props.brushThicknessMm ?? 3);
  brushThicknessRef.current = props.brushThicknessMm ?? 3;
  const onPaintedFacesChangeRef = useRef(props.onPaintedFacesChange);
  onPaintedFacesChangeRef.current = props.onPaintedFacesChange;
  const onDentalResultsInvalidatedRef = useRef(props.onDentalResultsInvalidated);
  onDentalResultsInvalidatedRef.current = props.onDentalResultsInvalidated;
  const onBrushThicknessChangeRef = useRef(props.onBrushThicknessChange);
  onBrushThicknessChangeRef.current = props.onBrushThicknessChange;
  // dental-brush painted 점 (세션 상태 원본 = 원본 maskRef 방식 이식).
  const paintPointsRef = useRef<PaintPoint[]>([]);
  const paintOverlaysRef = useRef<Mesh[]>([]);
  // 마진 찾기 결과 캐시 (원본 marginRef 이식).
  const marginRef = useRef<(FindMarginResult & { stlId: string }) | null>(null);
  const marginMarkersRef = useRef<Mesh[]>([]);
  const autoFillFacesRef = useRef<Set<number>>(new Set());
  const autoFillOverlayRef = useRef<Mesh[]>([]);
  const islandResultRef = useRef<IslandResultSlim | null>(null);
  const islandMarkersRef = useRef<Mesh[]>([]);
  // 서포트 재설계(S-4) 검출·점 시각화 메쉬 (신규 — 기존 island 슬롯과 독립).
  const redesignMarkersRef = useRef<Mesh[]>([]);
  // 색칠 변경에 따른 마진·아일랜드 무효화(감사 B3)의 지연 실행 타이머 맵.
  //   ⚠️ 컴포넌트 레벨 ref — 검출 함수가 pending 을 취소할 수 있어야 신선 결과
  //   파괴 레이스를 막는다 (브러쉬 effect 로컬 Map 으로 내리면 회귀).
  const pendingInvalidationsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  // 언마운트(씬 dispose 경로) 진행 표시 — 브러쉬 cleanup 이 모드 전환/언마운트를
  //   구분하는 데 쓴다. 씬-셋업 effect cleanup 이 언마운트에서만 true 로 세팅.
  const isUnmountingRef = useRef(false);
  const selectedSupportRef = useRef<string | null>(props.selectedSupportId);
  selectedSupportRef.current = props.selectedSupportId;
  const bridgeModeRef = useRef<boolean>(props.bridgeMode);
  bridgeModeRef.current = props.bridgeMode;
  const selectedRef = useRef<ReadonlySet<string>>(props.selectedIds);
  selectedRef.current = props.selectedIds;
  const onPickRef = useRef(props.onPick);
  onPickRef.current = props.onPick;
  const onGizmoCommitRef = useRef(props.onGizmoCommit);
  onGizmoCommitRef.current = props.onGizmoCommit;

  return {
    canvasRef,
    engineRef,
    sceneRef,
    cameraRef,
    meshMapRef,
    dragBehaviorMapRef,
    supportsRef,
    supportMeshMapRef,
    supportMaterialRef,
    manifoldModuleRef,
    stlManifoldMapRef,
    bridgeClipCacheRef,
    sliceOutlineRef,
    sliceFillMeshesRef,
    sliceModelMatRef,
    sliceSupportMatRef,
    bridgeMarkerRef,
    bridgeMarkerMatRef,
    bridgeCpMeshesRef,
    bridgeCpMatRef,
    bridgeBMatRef,
    selectedBridgeSphereRef,
    furnitureRef,
    highlightRef,
    utilityLayerRef,
    wheelObserverRef,
    positionGizmoRef,
    rotationGizmoRef,
    scaleGizmoRef,
    gizmoDragStartRef,
    gizmoModeRef,
    pivotProxyRef,
    overhangRef,
    liftRef,
    bridgeDiamRef,
    plateWRef,
    plateDRef,
    editModeRef,
    onAddSupportRef,
    onPickSupportRef,
    onMoveSupportRef,
    onMoveBridgeCpRef,
    onMoveBridgeEndpointRef,
    onDoublePickStlRef,
    onDoublePickBridgeTubeRef,
    onSelectBridgeControlPointRef,
    alignFloorModeRef,
    onAlignFaceToFloorRef,
    brushThicknessRef,
    onPaintedFacesChangeRef,
    onDentalResultsInvalidatedRef,
    onBrushThicknessChangeRef,
    paintPointsRef,
    paintOverlaysRef,
    marginRef,
    marginMarkersRef,
    autoFillFacesRef,
    autoFillOverlayRef,
    islandResultRef,
    islandMarkersRef,
    redesignMarkersRef,
    pendingInvalidationsRef,
    isUnmountingRef,
    selectedSupportRef,
    bridgeModeRef,
    selectedRef,
    onPickRef,
    onGizmoCommitRef,
  };
}
