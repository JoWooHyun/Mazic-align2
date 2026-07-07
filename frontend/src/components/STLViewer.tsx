import { useEffect, useRef, useState } from 'react';
import { Engine, Scene, ArcRotateCamera, Mesh, GizmoManager, UtilityLayerRenderer, IPointerEvent, PointerDragBehavior, Vector3, MeshBuilder, Color3, Ray, Matrix, StandardMaterial, Quaternion, VertexData, Plane } from '@babylonjs/core';
import { detectSliceIslands } from '@utils/slice-detection.utils';
import {
  createEngine,
  createScene,
  createCamera,
  createLights,
  startRenderLoop,
  disposeScene,
  focusOnAllMeshes,
  createUtilityLayer,
  createGizmoManager,
} from '@utils/babylon.utils';
import { createBuildPlate, type BuildPlate } from '@utils/build-plate.utils';
import ViewCube from '@components/ViewCube';
import {
  loadSTLFile,
  applyTransform,
  setMeshVisibility,
  setMeshOpacity,
} from '@utils/stl-loader.utils';
import {
  createSupport,
  readWorldTriangles,
  createFaceOverlay,
  DEFAULT_SUPPORT_SETTINGS,
  type SupportSettings,
  type SupportTool,
  type TriInfo,
} from '@utils/support.utils';
import type { STLFile } from '@types/stl.types';

interface STLViewerProps {
  stlFiles: STLFile[];
  selectedFileIds?: string[];  // 선택된 파일 IDs
  onMeshLoaded?: (stlId: string, mesh: Mesh) => void;
  onMeshSelected?: (stlId: string) => void;
  onGizmoTransformChange?: (stlId: string, mesh: Mesh) => void;  // Gizmo 드래그 완료 시
  unselectedOpacity?: number; // 선택되지 않은 객체의 투명도 (0~1)
  showGizmo?: boolean; // 위치/회전 기즈모 표시 여부 (Transform 탭 활성 시에만 true)
  supportTool?: SupportTool; // 서포트 배치 도구 (point / mask)
  brushThickness?: number; // 보호 영역 브러쉬 두께 (mm)
  onBrushThicknessChange?: (value: number) => void; // SHIFT+휠 브러쉬 크기 조정
  supportSettings?: SupportSettings; // 서포트 치수 (팁 상부/하부, 접점 깊이)
  clearSupportsSignal?: number; // 값이 바뀌면 선택된 STL의 서포트 제거
  generateSupportsSignal?: number; // 값이 바뀌면 지정 영역에 서포트 생성
  autoAngleSignal?: number; // 값이 바뀌면 자동 각도 조절 실행
  findMarginSignal?: number; // 값이 바뀌면 색칠 영역에서 마진 찾기 실행
  scopedSupportSignal?: number; // 값이 바뀌면 선택 영역 자동 서포트 생성
  // Phase 1 — Island Detection
  sliceLayerHeight?: number; // 슬라이스 두께 (mm) — 기본 0.05
  detectIslandsSignal?: number; // 값이 바뀌면 전체 모델 island 검출
  currentLayerIndex?: number; // -1 = clipPlane off, 0..nSlices-1
  onIslandDetectionComplete?: (info: {
    yMin: number;
    yMax: number;
    nSlices: number;
    layerHeight: number;
    totalIslandFaces: number;
    perLayerIslandCount: number[];
  }) => void;
  /** 활성 mesh bbox + sliceLayerHeight 변동 시 호출 — LayerSlider 가 항상 활성. */
  onSliceRangeChange?: (info: {
    yMin: number;
    yMax: number;
    nSlices: number;
    layerHeight: number;
  } | null) => void;
  className?: string;
}

/**
 * STL 뷰어 컴포넌트
 * Babylon.js를 사용하여 3D STL 모델 렌더링
 */
const STLViewer: React.FC<STLViewerProps> = ({
  stlFiles,
  selectedFileIds = [],
  onMeshLoaded,
  onMeshSelected,
  onGizmoTransformChange,
  unselectedOpacity = 1, // Default to opaque
  showGizmo = false,
  supportTool = 'none',
  brushThickness = 3,
  onBrushThicknessChange,
  supportSettings = DEFAULT_SUPPORT_SETTINGS,
  clearSupportsSignal = 0,
  generateSupportsSignal = 0,
  autoAngleSignal = 0,
  findMarginSignal = 0,
  scopedSupportSignal = 0,
  sliceLayerHeight = 0.05,
  detectIslandsSignal = 0,
  currentLayerIndex = -1,
  onIslandDetectionComplete,
  onSliceRangeChange,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const meshMapRef = useRef<Map<string, Mesh>>(new Map());
  const utilityLayerRef = useRef<UtilityLayerRenderer | null>(null);
  const gizmoManagerRef = useRef<GizmoManager | null>(null);
  const buildPlateRef = useRef<BuildPlate | null>(null);
  const supportCursorRef = useRef<HTMLDivElement>(null);
  const supportsRef = useRef<Mesh[]>([]);
  // Phase 1 — Island Detection 결과 시각화
  const islandFaceMarkersRef = useRef<Mesh[]>([]);      // 전체 island face overlay
  const islandLayerCellMarkersRef = useRef<Mesh[]>([]); // 현재 layer 의 island cell 강조
  const sliceCapMeshesRef = useRef<Mesh[]>([]);          // 현재 layer 의 각 mesh 별 단면 채움 cap
  const plateContactOverlaysRef = useRef<Mesh[]>([]);    // plate 안착/뚫림 face overlay (초록/빨강)
  const sliceDataRef = useRef<{
    stlId: string;
    yMin: number;
    layerHeight: number;
    cellSize: number;
    perLayerIslandCells: Set<string>[];
  } | null>(null);
  // 마진 라인 시각화 + 검출 결과 캐시 (자동 서포트 생성에서 사용)
  const marginMarkersRef = useRef<Mesh[]>([]);
  const marginRef = useRef<{
    stlId: string;
    points: Vector3[]; // 마진 점 (가드 존 판정용)
    occlusalFaces: Set<number>; // 교합면 면 인덱스
    edgeKeys: Set<string>; // 마진 엣지 (canonical "a,b") — floodfill 차단용
    canon: Int32Array | null; // 원본 vertex idx → canonical idx
    canonPositions: Vector3[]; // canonical 인덱스의 월드 좌표 (3D 거리 차단용)
    bridgePoints: Vector3[]; // bridge(가상 엣지) midpoint 만 — floodfill 근접 차단용
  } | null>(null);
  // 마진 floodfill 로 자동 색칠된 face 들 (mask 확장)
  const autoFillFacesRef = useRef<Set<number>>(new Set());
  // 자동 색칠 시각화 오버레이 메시
  const autoFillOverlayRef = useRef<Mesh[]>([]);
  // 보호 영역(서포트 금지 마스크)
  // 마스크(보호 영역) 점 — 모델 로컬 좌표로 저장해 회전·재안착을 따라가게 한다
  const maskRef = useRef<
    {
      mesh: Mesh;
      localPoint: Vector3;
      localNormal: Vector3; // 칠한 면의 법선(로컬) — 정면/뒷면 구분용
      radius: number;
    }[]
  >([]);
  const maskMarkersRef = useRef<Mesh[]>([]);
  // 드래그 종료 콜백을 ref 로 보관 (effect 가 매 렌더 재실행되지 않도록)
  const onGizmoTransformChangeRef = useRef(onGizmoTransformChange);
  onGizmoTransformChangeRef.current = onGizmoTransformChange;

  // 서포트 설정을 ref 로 보관 (설정 변경 시 effect 재실행 방지)
  const supportSettingsRef = useRef(supportSettings);
  supportSettingsRef.current = supportSettings;
  const brushThicknessRef = useRef(brushThickness);
  brushThicknessRef.current = brushThickness;
  const onBrushThicknessChangeRef = useRef(onBrushThicknessChange);
  onBrushThicknessChangeRef.current = onBrushThicknessChange;
  // 선택(활성)된 STL — effect 재실행 없이 최신 선택을 참조
  const selectedFileIdsRef = useRef(selectedFileIds);
  selectedFileIdsRef.current = selectedFileIds;
  // 현재 도구 — 도구 활성 중에는 STL 클릭으로 선택이 바뀌지 않도록 참조
  const supportToolRef = useRef(supportTool);
  supportToolRef.current = supportTool;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);

  /**
   * Babylon.js 초기화
   */
  useEffect(() => {
    if (!canvasRef.current) return;

    try {
      // 엔진 및 씬 생성
      const engine = createEngine(canvasRef.current);
      const scene = createScene(engine);
      const camera = createCamera(scene, canvasRef.current);

      // 조명 설정
      createLights(scene);

      // 빌드플레이트(그리드 + 축선) 생성
      buildPlateRef.current = createBuildPlate(scene);

      // Utility Layer 및 Gizmo Manager 생성
      const utilityLayer = createUtilityLayer(scene);
      const gizmoManager = createGizmoManager(scene, utilityLayer);

      // Gizmo 드래그 완료 이벤트 (Position)
      if (gizmoManager.gizmos.positionGizmo) {
        console.log('[STLViewer] Position gizmo drag handler registered');
        gizmoManager.gizmos.positionGizmo.onDragEndObservable.add(() => {
          console.log('[STLViewer] Position gizmo drag ended!');
          const attachedMesh = gizmoManager.gizmos.positionGizmo?.attachedMesh;
          console.log('[STLViewer] Attached mesh:', attachedMesh);
          console.log('[STLViewer] onGizmoTransformChange:', onGizmoTransformChange);

          if (attachedMesh && onGizmoTransformChange) {
            // 메쉬에서 stlId 찾기
            for (const [stlId, mesh] of meshMapRef.current.entries()) {
              if (mesh === attachedMesh) {
                console.log('[STLViewer] Calling onGizmoTransformChange for:', stlId);
                onGizmoTransformChange(stlId, mesh);
                break;
              }
            }
          }
        });
      }

      // Gizmo 드래그 완료 이벤트 (Rotation)
      if (gizmoManager.gizmos.rotationGizmo) {
        console.log('[STLViewer] Rotation gizmo drag handler registered');
        gizmoManager.gizmos.rotationGizmo.onDragEndObservable.add(() => {
          console.log('[STLViewer] Rotation gizmo drag ended!');
          const attachedMesh = gizmoManager.gizmos.rotationGizmo?.attachedMesh;

          if (attachedMesh && onGizmoTransformChange) {
            for (const [stlId, mesh] of meshMapRef.current.entries()) {
              if (mesh === attachedMesh) {
                console.log('[STLViewer] Calling onGizmoTransformChange for:', stlId);
                onGizmoTransformChange(stlId, mesh);
                break;
              }
            }
          }
        });
      }

      // 렌더링 시작
      startRenderLoop(engine, scene);

      // 레퍼런스 저장
      engineRef.current = engine;
      sceneRef.current = scene;
      cameraRef.current = camera;
      utilityLayerRef.current = utilityLayer;
      gizmoManagerRef.current = gizmoManager;

      // 메쉬 클릭 이벤트
      // 드래그/클릭 구분용 — POINTERDOWN 위치 기록
      let pointerDownPos: { x: number; y: number } | null = null;

      scene.onPointerObservable.add((pointerInfo) => {
        const event = pointerInfo.event as IPointerEvent;

        if (pointerInfo.type === 1) { // PointerEventTypes.POINTERDOWN
          pointerDownPos = { x: event.clientX, y: event.clientY };
          return;
        }

        if (pointerInfo.type === 2) { // PointerEventTypes.POINTERUP
          // 드래그(위치이동)였으면 클릭으로 보지 않음 → 선택 상태 그대로 유지
          if (pointerDownPos) {
            const dist = Math.hypot(
              event.clientX - pointerDownPos.x,
              event.clientY - pointerDownPos.y
            );
            pointerDownPos = null;
            if (dist > 5) return;
          }

          // 영역 지정·서포트 도구가 활성화된 동안에는 STL 클릭으로
          //   선택/해제가 바뀌지 않게 한다 (칠하기·점 배치 중 오선택 방지)
          if (supportToolRef.current !== 'none') return;

          // 메쉬를 클릭하면 선택. 배경 클릭으로 해제는 하지 않음
          // (선택은 다른 STL을 클릭하거나 파일 목록에서만 변경)
          if (pointerInfo.pickInfo?.hit && pointerInfo.pickInfo.pickedMesh) {
            if (event.button === 0) {
              const pickedMesh = pointerInfo.pickInfo.pickedMesh;
              if (onMeshSelected) {
                // STL ID 찾기
                for (const [stlId, mesh] of meshMapRef.current.entries()) {
                  if (mesh === pickedMesh) {
                    onMeshSelected(stlId);
                    break;
                  }
                }
              }
            }
          }
        }
      });

      // ViewCube 가 카메라/씬에 접근 가능하도록 준비 완료 표시
      setViewerReady(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize viewer';
      setError(errorMessage);
    }

    // 클린업
    return () => {
      setViewerReady(false);
      if (buildPlateRef.current) {
        buildPlateRef.current.dispose();
        buildPlateRef.current = null;
      }
      if (gizmoManagerRef.current) {
        gizmoManagerRef.current.dispose();
      }
      if (engineRef.current && sceneRef.current) {
        disposeScene(engineRef.current, sceneRef.current);
      }
    };
  }, []);

  /**
   * STL 파일 로드
   */
  useEffect(() => {
    if (!sceneRef.current || !cameraRef.current) return;

    const loadFiles = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const scene = sceneRef.current!;
        const camera = cameraRef.current!;

        // 기존 메쉬 중 더 이상 없는 파일 제거
        const currentFileIds = new Set(stlFiles.map(f => f.stlId));
        for (const [stlId, mesh] of meshMapRef.current.entries()) {
          if (!currentFileIds.has(stlId)) {
            mesh.dispose();
            meshMapRef.current.delete(stlId);
          }
        }

        // 새로 추가된 STL 파일만 로드
        for (const stlFile of stlFiles) {
          // 이미 로드된 파일은 스킵
          if (meshMapRef.current.has(stlFile.stlId)) {
            continue;
          }

          // Check if scene is disposed before starting load
          if (scene.isDisposed) {
            console.warn('[STLViewer] Scene disposed, stopping file load');
            break;
          }

          try {
            const mesh = await loadSTLFile(scene, stlFile.originalUrl, stlFile.fileName);

            // Transform 적용 (Preview 우선)
            const transformToApply = stlFile.previewTransform || stlFile.currentTransform;
            console.log(`[STLViewer] Applying transform to ${stlFile.fileName}:`, transformToApply);
            applyTransform(mesh, transformToApply);
            console.log(`[STLViewer] Mesh position after transform:`, mesh.position);

            // 가시성 설정
            setMeshVisibility(mesh, stlFile.visibility);

            // 메쉬 맵에 저장
            meshMapRef.current.set(stlFile.stlId, mesh);

            // STL 로드 직후 plate 접지 face overlay 표시
            updatePlateContactOverlay(mesh, stlFile.stlId);

            // 콜백 호출 (Check disposed again)
            if (!scene.isDisposed && onMeshLoaded) {
              onMeshLoaded(stlFile.stlId, mesh);
            }
          } catch (err) {
            console.error(`Failed to load STL file: ${stlFile.fileName}`, err);
          }
        }

        // 모든 메쉬에 카메라 포커스
        if (meshMapRef.current.size > 0) {
          focusOnAllMeshes(camera, scene);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load STL files';

        // Ignore scene disposal errors (user navigated away)
        if (errorMessage.includes('Scene was disposed') || errorMessage.includes('Scene has been disposed')) {
          console.warn('[STLViewer] Load aborted due to scene disposal');
          return;
        }

        setError(errorMessage);
      } finally {
        if (sceneRef.current && !sceneRef.current.isDisposed) {
          setIsLoading(false);
        }
      }
    };

    loadFiles();
  }, [stlFiles.map(f => f.stlId).join(','), onMeshLoaded]); // Only reload when file list changes

  /**
   * 단일 mesh 의 plate 접지 face overlay 갱신 (재사용 헬퍼).
   *   - centroid.y ≈ 0 (안착 닿는 면): 초록 face overlay
   *   - centroid.y <  0 (plate 뚫은 면): 빨강 face overlay
   *   - centroid.y >  0: 표시 안 함
   *   해당 stlId 의 이전 overlay 만 dispose 하고 새로 생성.
   */
  const updatePlateContactOverlay = (mesh: Mesh, stlId: string): void => {
    const scene = sceneRef.current;
    if (!scene) return;
    // 같은 stlId 의 기존 overlay dispose
    plateContactOverlaysRef.current = plateContactOverlaysRef.current.filter((ov) => {
      if (ov.metadata?.stlId === stlId) {
        ov.dispose();
        return false;
      }
      return true;
    });
    const tris = readWorldTriangles(mesh);
    const greenTris: typeof tris = [];
    const redTris: typeof tris = [];
    for (const t of tris) {
      const y = t.centroid.y;
      if (y < -0.01) redTris.push(t);
      else if (y < 0.01) greenTris.push(t);
    }
    if (greenTris.length > 0) {
      const ov = createFaceOverlay(scene, greenTris, [0.2, 0.85, 0.3]);
      if (ov) {
        ov.metadata = { stlId };
        ov.setParent(mesh);
        plateContactOverlaysRef.current.push(ov);
      }
    }
    if (redTris.length > 0) {
      const ov = createFaceOverlay(scene, redTris, [0.95, 0.2, 0.2]);
      if (ov) {
        ov.metadata = { stlId };
        ov.setParent(mesh);
        plateContactOverlaysRef.current.push(ov);
      }
    }
  };

  /**
   * Transform 변경 처리 (Preview 및 Current) + plate 접지 face overlay 갱신
   */
  useEffect(() => {
    stlFiles.forEach((stlFile) => {
      const mesh = meshMapRef.current.get(stlFile.stlId);
      if (!mesh) return;
      applyTransform(mesh, stlFile.previewTransform || stlFile.currentTransform);
      updatePlateContactOverlay(mesh, stlFile.stlId);
    });
  }, [stlFiles]); // Update transforms when any transform changes

  /**
   * 가시성 변경 처리
   */
  useEffect(() => {
    stlFiles.forEach((stlFile) => {
      const mesh = meshMapRef.current.get(stlFile.stlId);
      if (mesh) {
        setMeshVisibility(mesh, stlFile.visibility);
      }
    });
  }, [stlFiles.map((f) => `${f.stlId}-${f.visibility}`).join(',')]);

  /**
   * 선택된 메쉬에 Gizmo 부착 (바운딩박스 중심으로)
   */
  useEffect(() => {
    if (!gizmoManagerRef.current) return;

    // 선택된 메쉬 가져오기
    const selectedMeshes = Array.from(selectedFileIds)
      .map(id => meshMapRef.current.get(id))
      .filter((mesh): mesh is Mesh => mesh !== undefined);

    if (showGizmo && selectedMeshes.length === 1) {
      // Transform 탭 활성 + 단일 선택일 때만 Gizmo 부착
      gizmoManagerRef.current.attachToMesh(selectedMeshes[0]);
    } else {
      // 다중 선택 / 선택 없음 / Transform 탭 비활성: Gizmo 제거
      gizmoManagerRef.current.attachToMesh(null);
    }

    // 모든 STL 은 불투과로 표현 (선택 여부와 무관)
    meshMapRef.current.forEach((mesh, stlId) => {
      const isSelected = selectedFileIds.includes(stlId);

      // 선택된 STL 은 하늘색으로 강조, 나머지는 기본 색
      if (mesh.material instanceof StandardMaterial) {
        mesh.material.diffuseColor = isSelected
          ? new Color3(0.45, 0.75, 1.0)
          : new Color3(0.8, 0.8, 0.9);
      }

      // 모든 STL 은 항상 불투과(불투명) — 색칠 표현은 술자가 화면을 돌려가며 확인
      setMeshOpacity(mesh, 1);
    });

  }, [selectedFileIds, unselectedOpacity, showGizmo]);

  /**
   * 선택된 STL 자유 위치이동
   * XZ 평면(법선 = Babylon Y)에 구속 → 높이(user Z) 고정, X/Y 자유 이동
   */
  useEffect(() => {
    if (selectedFileIds.length !== 1) return;
    if (supportTool !== 'none') return; // 서포트 도구 사용 중엔 STL 이동 비활성
    if (!onGizmoTransformChangeRef.current) return; // 콜백 없는 읽기전용 뷰어 제외
    const stlId = selectedFileIds[0];
    const mesh = meshMapRef.current.get(stlId);
    if (!mesh) return;

    const drag = new PointerDragBehavior({ dragPlaneNormal: new Vector3(0, 1, 0) });
    drag.useObjectOrientationForDragging = false; // 월드 XZ 평면 기준 드래그
    drag.dragDeltaRatio = 1; // 즉시 1:1 이동 (스무딩 지연 제거)
    drag.dragButtons = [0]; // 좌클릭으로만 이동 (우클릭은 카메라 회전 전용)
    drag.onDragEndObservable.add(() => {
      onGizmoTransformChangeRef.current?.(stlId, mesh);
    });
    mesh.addBehavior(drag);

    return () => {
      drag.onDragEndObservable.clear();
      mesh.removeBehavior(drag);
    };
  }, [selectedFileIds.join(','), supportTool]);

  // 색칠한 영역 안에 있는 점인지 — '자동 각도 조절' 비용 함수에서만 사용한다.
  //   색칠은 서포트 생성을 직접 막지 않고, 색칠 면이 오버행/아일랜드가 안 되는
  //   방향으로 모델을 회전시키기 위한 입력일 뿐이다.
  //   n(면 법선)이 주어지면 칠한 면과 같은 쪽일 때만 인정 → 얇은 벽 반대편 제외
  //   faceIdx 가 주어지면 마진 floodfill 자동 색칠 set 도 검사한다.
  const isMasked = (p: Vector3, n?: Vector3, faceIdx?: number): boolean => {
    if (faceIdx !== undefined && autoFillFacesRef.current.has(faceIdx)) {
      return true;
    }
    for (const m of maskRef.current) {
      // 로컬 좌표 → 현재 월드 좌표 (모델 회전/이동 추적)
      const wm = m.mesh.getWorldMatrix();
      const wp = Vector3.TransformCoordinates(m.localPoint, wm);
      if (Vector3.Distance(p, wp) >= m.radius) continue;
      if (n) {
        const mn = Vector3.TransformNormal(m.localNormal, wm);
        if (Vector3.Dot(mn, n) <= 0) continue; // 반대편 면 → 마스크 아님
      }
      return true;
    }
    return false;
  };

  // STL 더블클릭 시 호출 — startFace 를 시작으로 마진 폐곡선 안쪽 face 들을
  //   floodfill (마진 엣지는 차단) → autoFillFacesRef + 오렌지 오버레이 메시 갱신.
  const fillFromFace = (stlId: string, startFace: number): void => {
    const scene = sceneRef.current;
    if (!scene) return;
    const mesh = meshMapRef.current.get(stlId);
    if (!mesh) return;
    const margin = marginRef.current;
    if (!margin || margin.stlId !== stlId || !margin.canon) {
      console.warn('마진 색칠: 먼저 "마진 찾기" 를 실행하세요.');
      return;
    }
    const meshIndices = mesh.getIndices();
    if (!meshIndices) return;
    const canon = margin.canon;
    // 메시가 movement 됐을 수 있으니 canonical 좌표를 현재 월드 기준으로 재계산.
    const meshPositionsForCanon = mesh.getVerticesData('position');
    if (!meshPositionsForCanon) return;
    const wmCur = mesh.computeWorldMatrix(true);
    const canonPosCur: Vector3[] = [];
    const vCountCur = meshPositionsForCanon.length / 3;
    for (let v = 0; v < vCountCur; v++) {
      const c = canon[v];
      if (!canonPosCur[c]) {
        canonPosCur[c] = Vector3.TransformCoordinates(
          new Vector3(
            meshPositionsForCanon[v * 3],
            meshPositionsForCanon[v * 3 + 1],
            meshPositionsForCanon[v * 3 + 2]
          ),
          wmCur
        );
      }
    }

    // 3D 근접 차단은 과거의 가상 엣지(직선 폴백) 시대 흔적.
    //   현재 모든 bridge 가 real mesh edge → edgeKeys 가 직접 차단. 3D 근접은 더 이상
    //   필요 없고, 0.4mm 폭 wall 이 inner face 들을 잘못 차단해 floodfill 부분 미충전 사고.
    //   완전 비활성화 — edgeKeys 만으로 충분.
    const hasBridges = false;
    const nearBridge3D = (_pt: Vector3): boolean => false;

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
    // BFS face → face, 마진 엣지(또는 3D 마진 근접) 차단
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
        if (margin.edgeKeys.has(k)) continue; // 명시적 마진 엣지
        // 공유 엣지 midpoint 가 bridge midpoint 근접이면 차단
        if (hasBridges) {
          const pa = canonPosCur[a];
          const pb = canonPosCur[b];
          if (pa && pb) {
            const mid = pa.add(pb).scale(0.5);
            if (nearBridge3D(mid)) continue;
          }
        }
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

    // 시각화 — 이전 오버레이 제거 + 새로 생성
    autoFillOverlayRef.current.forEach((m) => m.dispose());
    autoFillOverlayRef.current = [];
    const meshPositions = mesh.getVerticesData('position');
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
          meshPositions[vi * 3 + 2]
        );
      }
      indices.push(vIdx, vIdx + 1, vIdx + 2);
      vIdx += 3;
    }
    if (indices.length === 0) return;
    const overlay = new Mesh('maskAutoFill', scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    const norms: number[] = [];
    VertexData.ComputeNormals(positions, indices, norms);
    vd.normals = norms;
    vd.applyToMesh(overlay);
    const mat = new StandardMaterial('maskAutoFillMat', scene);
    mat.emissiveColor = new Color3(0.96, 0.52, 0.13);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.zOffset = -1;
    overlay.material = mat;
    overlay.isPickable = false;
    overlay.metadata = { stlId };
    // 직접 parent 할당 — overlay vertex 가 LOCAL mesh 좌표라서, setParent 대신
    //   parent= 로 attach 해야 worldMatrix = mesh.worldMatrix 가 되어
    //   vertex world = mesh.worldMatrix × local 로 올바르게 mesh 위에 놓인다.
    overlay.parent = mesh;
    autoFillOverlayRef.current.push(overlay);
    console.log(
      `[마진 색칠] 시작 face ${startFace} → 자동 색칠 ${filled.size}/${triCount} ` +
        `(차단거리 ${PROX_DIST}mm)`
    );
  };

  // 보호 영역(마스크) 색칠 초기화 — autoFill 도 함께 정리
  const clearMask = () => {
    maskMarkersRef.current.forEach((m) => m.dispose(false, true));
    maskMarkersRef.current = [];
    maskRef.current = [];
    autoFillFacesRef.current.clear();
    autoFillOverlayRef.current.forEach((m) => m.dispose());
    autoFillOverlayRef.current = [];
  };

  /**
   * 서포트 배치 도구 — point(점) / mask(보호 영역 칠하기)
   */
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const engine = engineRef.current;
    const canvas = canvasRef.current;
    const dot = supportCursorRef.current;
    if (!scene || !camera || !engine || !canvas || !dot) return;

    if (supportTool === 'none') {
      dot.style.display = 'none';
      canvas.style.cursor = '';
      return;
    }
    canvas.style.cursor = 'none';

    // 메쉬의 로컬 +Y 축을 dir 방향으로 정렬
    const orientYTo = (m: Mesh, dir: Vector3): void => {
      const d = dir.normalizeToNew();
      const up = new Vector3(0, 1, 0);
      const dot = Math.max(-1, Math.min(1, Vector3.Dot(up, d)));
      if (dot > 0.999999) {
        m.rotationQuaternion = Quaternion.Identity();
      } else if (dot < -0.999999) {
        m.rotationQuaternion = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
      } else {
        m.rotationQuaternion = Quaternion.RotationAxis(
          Vector3.Cross(up, d).normalize(),
          Math.acos(dot)
        );
      }
    };

    // === Smooth normal 헬퍼 — picked face 1개의 normal 대신 인접 face normals 평균 ===
    //   거친 mesh 에서 picked face 가 face 경계 위로 미세 변동 시 normal 이 휙휙 변하는
    //   문제 해결. brush ring 각도가 표면 따라 부드럽게 변동, 데칼도 안정.
    //   face normal 은 local 좌표로 캐시 (모델 회전해도 cache 유효).
    type SmoothNormalCache = {
      mesh: Mesh;
      vertexFaces: Map<number, number[]>;
      faceNormalsLocal: Vector3[];
    };
    let smoothCache: SmoothNormalCache | null = null;
    const ensureSmoothCache = (mesh: Mesh): SmoothNormalCache | null => {
      if (smoothCache && smoothCache.mesh === mesh) return smoothCache;
      const positions = mesh.getVerticesData('position');
      const indices = mesh.getIndices();
      if (!positions || !indices) {
        smoothCache = null;
        return null;
      }
      const nFaces = indices.length / 3;
      const faceNormalsLocal: Vector3[] = new Array(nFaces);
      const vertexFaces = new Map<number, number[]>();
      for (let f = 0; f < nFaces; f++) {
        const i0 = indices[f * 3];
        const i1 = indices[f * 3 + 1];
        const i2 = indices[f * 3 + 2];
        const ax = positions[i0 * 3];
        const ay = positions[i0 * 3 + 1];
        const az = positions[i0 * 3 + 2];
        const bx = positions[i1 * 3];
        const by = positions[i1 * 3 + 1];
        const bz = positions[i1 * 3 + 2];
        const cx = positions[i2 * 3];
        const cy = positions[i2 * 3 + 1];
        const cz = positions[i2 * 3 + 2];
        const ux = bx - ax;
        const uy = by - ay;
        const uz = bz - az;
        const vx = cx - ax;
        const vy = cy - ay;
        const vz = cz - az;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1e-9) {
          faceNormalsLocal[f] = new Vector3(0, 1, 0);
        } else {
          faceNormalsLocal[f] = new Vector3(nx / len, ny / len, nz / len);
        }
        for (const vi of [i0, i1, i2]) {
          let arr = vertexFaces.get(vi);
          if (!arr) {
            arr = [];
            vertexFaces.set(vi, arr);
          }
          arr.push(f);
        }
      }
      smoothCache = { mesh, vertexFaces, faceNormalsLocal };
      return smoothCache;
    };
    // picked face 의 3 vertex 의 1-ring face normals 평균 → smooth normal (world).
    //   인접 face normal 이 picked face normal 과 60° 이상 차이면 평균에서 제외.
    //   결과 null 이면 호출자가 pick.getNormal() 폴백.
    const getSmoothNormal = (
      mesh: Mesh,
      faceId: number | null | undefined
    ): Vector3 | null => {
      if (faceId === null || faceId === undefined || faceId < 0) return null;
      const c = ensureSmoothCache(mesh);
      if (!c) return null;
      const indices = mesh.getIndices();
      if (!indices || faceId * 3 + 2 >= indices.length) return null;
      const fLocal = c.faceNormalsLocal[faceId];
      if (!fLocal) return null;
      const COS60 = 0.5;
      const accumVertex = (vi: number): { x: number; y: number; z: number } => {
        const adj = c.vertexFaces.get(vi);
        if (!adj || adj.length === 0) return { x: fLocal.x, y: fLocal.y, z: fLocal.z };
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let cnt = 0;
        for (const af of adj) {
          const an = c.faceNormalsLocal[af];
          if (!an) continue;
          if (an.x * fLocal.x + an.y * fLocal.y + an.z * fLocal.z < COS60) continue;
          sx += an.x;
          sy += an.y;
          sz += an.z;
          cnt++;
        }
        if (cnt === 0) return { x: fLocal.x, y: fLocal.y, z: fLocal.z };
        return { x: sx, y: sy, z: sz };
      };
      const i0 = indices[faceId * 3];
      const i1 = indices[faceId * 3 + 1];
      const i2 = indices[faceId * 3 + 2];
      const a = accumVertex(i0);
      const b = accumVertex(i1);
      const cc = accumVertex(i2);
      const sx = a.x + b.x + cc.x;
      const sy = a.y + b.y + cc.y;
      const sz = a.z + b.z + cc.z;
      const lenL = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (lenL < 1e-12) return null;
      const local = new Vector3(sx / lenL, sy / lenL, sz / lenL);
      const wm = mesh.computeWorldMatrix(true);
      const world = Vector3.TransformNormal(local, wm);
      const wlen = world.length();
      if (wlen < 1e-9) return null;
      return world.scale(1 / wlen);
    };

    // mask 도구: 표면 법선에 맞춰 기울어지는 3D 브러쉬 링 (호버 시 표시)
    let brushRing: Mesh | null = null;
    let maskWheel: ((e: WheelEvent) => void) | null = null;
    if (supportTool === 'mask') {
      brushRing = MeshBuilder.CreateTorus(
        'brushRing',
        { diameter: 1, thickness: 0.07, tessellation: 40 },
        scene
      );
      const rm = new StandardMaterial('brushRingMat', scene);
      rm.emissiveColor = new Color3(0.2, 0.85, 0.95);
      rm.diffuseColor = new Color3(0, 0, 0);
      rm.disableLighting = true;
      rm.disableDepthWrite = true;
      brushRing.material = rm;
      brushRing.isPickable = false;
      brushRing.renderingGroupId = 1;
      brushRing.setEnabled(false);

      // SHIFT + 마우스 휠 → 브러쉬 커서 크기 조정 (카메라 줌은 막음)
      maskWheel = (e: WheelEvent) => {
        if (!e.shiftKey) return; // SHIFT 없으면 일반 휠(카메라 줌) 그대로
        e.preventDefault();
        e.stopImmediatePropagation(); // Babylon 카메라 줌 입력 차단
        const cur = brushThicknessRef.current;
        const next = Math.max(0.5, Math.min(30, cur + (e.deltaY < 0 ? 1 : -1)));
        if (next === cur) return;
        brushThicknessRef.current = next; // 브러쉬 링 즉시 반영
        onBrushThicknessChangeRef.current?.(next); // 패널 상태 동기화
      };
      // capture 단계로 등록 → Babylon 카메라 휠 입력보다 먼저 처리
      canvas.addEventListener('wheel', maskWheel, {
        capture: true,
        passive: false,
      });
    }

    // 현재 활성(선택)된 STL 메쉬 — 칠하기/지우기는 이 메쉬에만 적용된다.
    const getActiveMesh = (): Mesh | null => {
      const ids = selectedFileIdsRef.current;
      let id: string | undefined = ids[0];
      if (!id) id = [...meshMapRef.current.keys()][0];
      return id ? meshMapRef.current.get(id) ?? null : null;
    };
    // scene.pick 술어 — 활성 STL 메쉬만 picking 대상으로 한정
    const onlyActive = (m: { uniqueId: number }): boolean => {
      const a = getActiveMesh();
      return !!a && (m as unknown as Mesh) === a;
    };

    // 화면 좌표(x,y) 위치의 모델 표면에 서포트 1개 배치
    const placeSupportAt = (x: number, y: number): boolean => {
      const pick = scene.pick(x, y);
      if (!pick?.hit || !pick.pickedPoint || !pick.pickedMesh) return false;
      // Smooth normal — picked face 의 인접 face normals 평균. face-단위 jitter 제거
      let normal: Vector3 | null = getSmoothNormal(
        pick.pickedMesh as Mesh,
        pick.faceId
      );
      if (!normal) normal = pick.getNormal(false, true);
      if (!normal || normal.lengthSquared() < 1e-9) return false;
      normal = normal.normalizeToNew();
      const viewDir = pick.pickedPoint.subtract(camera.position);
      if (Vector3.Dot(normal, viewDir) > 0) normal = normal.negate();
      const support = createSupport(
        scene,
        pick.pickedPoint,
        normal,
        supportSettingsRef.current
      );
      if (!support) return false;
      let stlId: string | undefined;
      for (const [id, m] of meshMapRef.current.entries()) {
        if (m === pick.pickedMesh) {
          stlId = id;
          break;
        }
      }
      support.metadata = { stlId };
      supportsRef.current.push(support);
      return true;
    };

    // mm → 화면 px (거리 dist 에서의 원근 투영)
    const mmToPx = (mm: number, dist: number) =>
      (mm * engine.getRenderHeight()) / (2 * dist * Math.tan(camera.fov / 2));

    // ── 브러쉬 상태 ──
    let brushing = false;
    let lastBrush: { x: number; y: number } | null = null;

    // mask — 보호 영역을 STL 표면에 데칼로 직접 색칠 (서포트 금지 구역)
    const addMaskPoint = (x: number, y: number): void => {
      // 활성 STL 에만 색칠 — 다른 STL 은 picking 대상에서 제외
      const pick = scene.pick(x, y, onlyActive);
      if (!pick?.hit || !pick.pickedPoint || !pick.pickedMesh) return;
      // Smooth normal — 인접 face normals 평균. picked face jitter 제거 → 데칼이
      //   끊김 없이 부드러운 표면 방향으로 투영
      let normal: Vector3 | null = getSmoothNormal(
        pick.pickedMesh as Mesh,
        pick.faceId
      );
      if (!normal) normal = pick.getNormal(false, true);
      if (!normal || normal.lengthSquared() < 1e-9) return;
      normal = normal.normalizeToNew();
      const viewDir = pick.pickedPoint.subtract(camera.position);
      if (Vector3.Dot(normal, viewDir) > 0) normal = normal.negate();
      const dia = Math.max(brushThicknessRef.current, 1);
      // 데칼 투영 깊이 — 작게 잡아 반대편(뒷면)까지 뚫고 칠해지지 않게 한다.
      //   size.z(법선 방향) ±depthSize/2 범위의 표면만 데칼로 잡힘 → 정면만 색칠.
      const depthSize = Math.min(dia, 3);

      // STL 표면 geometry 에 밀착하는 데칼로 색칠 (size.z = 투영 깊이)
      const decal = MeshBuilder.CreateDecal('maskDecal', pick.pickedMesh, {
        position: pick.pickedPoint,
        normal,
        size: new Vector3(dia, dia, depthSize),
      });

      // 클릭한 면 각도와 비슷한 삼각형만 유지 → 다른 각도의 면으로 번지지 않음.
      //   45° 임계 — 곡면 위 데칼 가장자리 face 의 normal 이 중심 face normal 과
      //   다소 어긋나는 케이스를 허용해 빠른 드래그 시 점점이/끊김 현상 방지.
      const dpos = decal.getVerticesData('position');
      const didx = decal.getIndices();
      const dnorm = decal.getVerticesData('normal');
      if (dpos && didx && dnorm) {
        const COS = Math.cos((45 * Math.PI) / 180); // 45° 이내 면만
        // 클릭한 면 깊이에서 이만큼 이상 안쪽이면 반대편 면 → 제외
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
            wm
          );
          const b = Vector3.TransformCoordinates(
            new Vector3(dpos[i1], dpos[i1 + 1], dpos[i1 + 2]),
            wm
          );
          const c = Vector3.TransformCoordinates(
            new Vector3(dpos[i2], dpos[i2 + 1], dpos[i2 + 2]),
            wm
          );
          // 데칼 삼각형의 표면 법선 — 저장된 법선(바깥쪽) 3개 평균을 월드로 변환.
          // 와인딩이 모호한 cross-product 대신 저장 법선으로 정면/뒷면을 정확히 구분.
          const tn = Vector3.TransformNormal(
            new Vector3(
              dnorm[i0] + dnorm[i1] + dnorm[i2],
              dnorm[i0 + 1] + dnorm[i1 + 1] + dnorm[i2 + 1],
              dnorm[i0 + 2] + dnorm[i1 + 2] + dnorm[i2 + 2]
            ),
            wm
          );
          if (tn.lengthSquared() < 1e-12) continue;
          tn.normalize();
          // 클릭 법선과 같은 방향(정면) + 비슷한 각도의 면만 → 반대편/다른각도 제외
          if (Vector3.Dot(tn, normal) < COS) continue;
          // 클릭한 면 깊이 근처 삼각형만 — 반대편(뒷면)으로 뚫린 부분 제외
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
      const invWm = Matrix.Invert(maskMesh.getWorldMatrix());
      // maskRef 저장용 normal — 시각용 smooth normal 이 아니라 picked face 의
      //   face normal 사용. isMasked()/eraseMaskAt 의 정면 검사가 face normal
      //   기반이라 일관성 유지 → 마진 찾기 painted set 동작이 brush 수정 전과 동일.
      let storeNormal = pick.getNormal(false, true);
      if (!storeNormal || storeNormal.lengthSquared() < 1e-9) {
        storeNormal = normal; // fallback
      } else {
        storeNormal = storeNormal.normalizeToNew();
        if (Vector3.Dot(storeNormal, viewDir) > 0) storeNormal = storeNormal.negate();
      }
      maskRef.current.push({
        mesh: maskMesh,
        // 월드 클릭점·법선을 모델 로컬 좌표로 변환해 저장 (회전 추적)
        localPoint: Vector3.TransformCoordinates(pick.pickedPoint, invWm),
        localNormal: Vector3.TransformNormal(storeNormal, invWm),
        radius: dia / 2,
      });
      decal.isPickable = false;
      // 모델과 같은 렌더링 그룹(0) + 깊이쓰기 ON → 일반 표면처럼 모델에 가려짐
      // (반대편/뒷면 색칠이 앞으로 비쳐 보이는 투과 현상 방지)
      const dm = new StandardMaterial('maskMat', scene);
      dm.emissiveColor = new Color3(0.96, 0.52, 0.13);
      dm.diffuseColor = new Color3(0, 0, 0);
      dm.disableLighting = true; // 조명 무관 균일 색
      dm.backFaceCulling = false;
      dm.zOffset = -2; // 모델 표면과 z-fighting 방지
      decal.material = dm;
      decal.setParent(pick.pickedMesh); // 모델과 함께 움직이도록
      maskMarkersRef.current.push(decal);
    };

    // mask — Ctrl+드래그 지우개: 커서 주변 보호 영역 색칠 제거
    const eraseMaskAt = (x: number, y: number): void => {
      // 활성 STL 표면 기준으로만 지우기 판정
      const pick = scene.pick(x, y, onlyActive);
      if (!pick?.hit || !pick.pickedPoint) return;
      const p = pick.pickedPoint;
      // 지우개도 칠하기처럼 정면만 — Smooth normal 사용 (jitter 제거)
      let eraseN: Vector3 | null = getSmoothNormal(
        pick.pickedMesh as Mesh,
        pick.faceId
      );
      if (!eraseN) eraseN = pick.getNormal(false, true);
      if (eraseN && eraseN.lengthSquared() < 1e-9) eraseN = null;
      if (eraseN) {
        eraseN = eraseN.normalizeToNew();
        const vd = pick.pickedPoint.subtract(camera.position);
        if (Vector3.Dot(eraseN, vd) > 0) eraseN = eraseN.negate();
      }
      const COS = Math.cos((30 * Math.PI) / 180);
      const r = Math.max(brushThicknessRef.current / 2, 1);
      for (let i = maskRef.current.length - 1; i >= 0; i--) {
        const entry = maskRef.current[i];
        const wm = entry.mesh.getWorldMatrix();
        const wp = Vector3.TransformCoordinates(entry.localPoint, wm);
        if (Vector3.Distance(wp, p) >= r + entry.radius) continue;
        // 칠한 면 법선과 지우개 면 법선이 같은 쪽일 때만 지움 → 반대편 보존
        if (eraseN) {
          const en = Vector3.TransformNormal(entry.localNormal, wm).normalize();
          if (Vector3.Dot(en, eraseN) < COS) continue;
        }
        maskMarkersRef.current[i]?.dispose(false, true);
        maskMarkersRef.current.splice(i, 1);
        maskRef.current.splice(i, 1);
      }
    };


    const obs = scene.onPointerObservable.add((pi) => {
      const ev = pi.event as IPointerEvent;

      if (pi.type === 4) {
        // POINTERMOVE — 커서 갱신 + 브러쉬 페인팅
        //   mask 도구는 활성 STL 만 picking → 다른 STL 위에선 칠해지지 않음
        const pick =
          supportTool === 'mask'
            ? scene.pick(scene.pointerX, scene.pointerY, onlyActive)
            : scene.pick(scene.pointerX, scene.pointerY);
        const dist =
          pick?.hit && pick.pickedPoint
            ? Vector3.Distance(camera.position, pick.pickedPoint)
            : camera.radius;
        const mm =
          supportTool === 'mask'
            ? brushThicknessRef.current
            : supportTool === 'point'
            ? supportSettingsRef.current.tipTopDiameter
            : 1.2;
        const sizePx = Math.max(mmToPx(mm, dist), 4);

        // mask 도구: 표면 위에선 법선에 맞춰 기울어지는 3D 링, 표면 밖에선 HTML 점
        let ringShown = false;
        if (brushRing && supportTool === 'mask' && pick?.hit && pick.pickedPoint) {
          // Smooth normal — 인접 face normals 평균. 마우스가 face 경계 위로 미세
          //   변동해도 ring 각도가 부드럽게 추적됨.
          let n: Vector3 | null = getSmoothNormal(
            pick.pickedMesh as Mesh,
            pick.faceId
          );
          if (!n) n = pick.getNormal(false, true);
          if (n && n.lengthSquared() < 1e-9) n = null; // degenerate triangle → HTML 점 fallback
          if (n) {
            n = n.normalizeToNew();
            const vd = pick.pickedPoint.subtract(camera.position);
            if (Vector3.Dot(n, vd) > 0) n = n.negate();
            const d = Math.max(brushThicknessRef.current, 1);
            brushRing.scaling.set(d, d, d);
            brushRing.position = pick.pickedPoint.add(n.scale(0.1));
            orientYTo(brushRing, n);
            (brushRing.material as StandardMaterial).emissiveColor = ev.ctrlKey
              ? new Color3(0.95, 0.25, 0.25) // 지우개
              : new Color3(0.2, 0.85, 0.95); // 칠하기
            brushRing.setEnabled(true);
            ringShown = true;
          }
        }
        if (brushRing && !ringShown) brushRing.setEnabled(false);

        if (ringShown) {
          dot.style.display = 'none';
        } else {
          dot.style.display = 'block';
          dot.style.left = `${scene.pointerX}px`;
          dot.style.top = `${scene.pointerY}px`;
          dot.style.width = `${sizePx}px`;
          dot.style.height = `${sizePx}px`;
          dot.style.borderColor =
            supportTool === 'mask' && ev.ctrlKey ? '#ef4444' : '#5fa8ee';
        }

        if (supportTool === 'mask' && brushing) {
          // 부드러운 페인트 — lastBrush→현재 점 구간을 stepPx 간격으로 채운다.
          //   빠르게 드래그해도 점점이 끊기지 않고 연속된 획으로 칠해진다.
          const stepPx = Math.max(sizePx * 0.1, 2); // brush 직경 10% 간격 — 데칼 90% 겹침으로 빈 곳 없게
          const paintAt = (px: number, py: number): void => {
            if (ev.ctrlKey) eraseMaskAt(px, py); // Ctrl+드래그 = 지우기
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
              // 구간을 균일 간격으로 보간해 모든 중간 지점에 칠한다
              const steps = Math.min(Math.floor(d / stepPx), 80);
              for (let s = 1; s <= steps; s++) {
                const t = (s * stepPx) / d;
                paintAt(lastBrush.x + dx * t, lastBrush.y + dy * t);
              }
              const adv = (steps * stepPx) / d; // 소비한 거리만큼만 전진(나머지 이월)
              lastBrush = {
                x: lastBrush.x + dx * adv,
                y: lastBrush.y + dy * adv,
              };
            }
          }
        }
      } else if (pi.type === 1) {
        // POINTERDOWN — 보호 영역 칠하기 스트로크 시작
        if (supportTool === 'mask' && ev.button === 0) {
          brushing = true;
          lastBrush = { x: scene.pointerX, y: scene.pointerY };
          if (ev.ctrlKey) {
            eraseMaskAt(scene.pointerX, scene.pointerY); // Ctrl+드래그 = 지우기
          } else {
            addMaskPoint(scene.pointerX, scene.pointerY);
          }
        }
      } else if (pi.type === 2) {
        // POINTERUP — 스트로크 종료
        if (supportTool === 'mask') {
          brushing = false;
          lastBrush = null;
        }
      } else if (pi.type === 32) {
        // POINTERTAP
        if (ev.button !== 0) return;
        if (supportTool === 'point') {
          placeSupportAt(scene.pointerX, scene.pointerY);
        }
      } else if (pi.type === 64) {
        // POINTERDOUBLETAP — STL 더블클릭 시 마진 안쪽 자동 색칠
        if (ev.button !== 0) return;
        const pick = scene.pick(
          scene.pointerX,
          scene.pointerY,
          onlyActive
        );
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
        fillFromFace(sid, pick.faceId);
      }
    });

    return () => {
      scene.onPointerObservable.remove(obs);
      dot.style.display = 'none';
      canvas.style.cursor = '';
      if (brushRing) brushRing.dispose(false, true);
      if (maskWheel) canvas.removeEventListener('wheel', maskWheel, true);
      // 보호영역 칠하기 도구를 끄면 마스크 초기화
      if (supportTool === 'mask') clearMask();
    };
  }, [supportTool]);

  /**
   * 서포트 생성 — '서포트 생성' 버튼
   * 현재 STL·플레이트 관계에서 아래 5가지 위험 요소를 종합한 risk score 로 서포트를 생성한다.
   *  1) 연결성    — 이전 레이어와 충분히 연결되지 않은(아래에 받쳐주는 면이 먼) 영역
   *  2) 오버행    — 임계각 이상으로 아래를 향한 down-facing surface
   *  3) 캔틸레버  — 길고 얇아서 처질 가능성이 있는 구조
   *  4) 아일랜드  — 작은 island / 약한 시작 단면 (반드시 지지)
   *  5) Peel force — 급격한 단면 변화로 박리력이 커지는 영역
   *  risk 가 높을수록 더 촘촘하게(adaptive density) 배치, 인접 seed 는 clustering 정리
   */
  useEffect(() => {
    if (generateSupportsSignal === 0) return; // 초기값
    const scene = sceneRef.current;
    if (!scene) return;

    // 대상 STL — 선택된 것, 없으면 로드된 첫 STL
    let stlId = selectedFileIds[0];
    if (!stlId) {
      const ids = Array.from(meshMapRef.current.keys());
      if (ids.length > 0) stlId = ids[0];
    }
    if (!stlId) {
      console.warn('서포트 생성: 대상 STL이 없습니다.');
      return;
    }
    const mesh = meshMapRef.current.get(stlId);
    if (!mesh) return;

    // 같은 STL의 기존 서포트 제거 (재생성 시 중복 방지)
    supportsRef.current = supportsRef.current.filter((s) => {
      if (s.metadata?.stlId === stlId) {
        s.dispose();
        return false;
      }
      return true;
    });
    // 마진 라인 시각화는 '마진 찾기' 가 관리 — 서포트 재생성 시 유지

    // 레이캐스트 가속용 옥트리 + 대상 모델만 picking
    mesh.createOrUpdateSubmeshesOctree(64, 2);
    const onlyModel = (m: { uniqueId: number }) => m === mesh;

    const settings = supportSettingsRef.current;
    const footDia = settings.tipBottomDiameter * 1.5; // 서포트 발(빌드플레이트 접지) 추정 직경
    // 오버행은 여유롭게(40° — 더 엄격해 서포트 적게), 아일랜드는 강하게 본다
    const COS_OVERHANG = Math.cos((40 * Math.PI) / 180);
    const PLATE_GAP = 0.5; // 이보다 낮으면 플레이트 접촉(지지받음)
    const CLEAR_MIN = 1.5; // 바로 아래 받쳐주는 면이 이 거리 이내면 자체 지지(이전 레이어 연결)
    const OVERHANG_SPACING = Math.max(footDia * 4, 7); // 오버행 — 여유로운(희박) 간격 (mm)
    const ISLAND_SPACING = Math.max(footDia * 1.2, 2); // 아일랜드 — 강하게(촘촘) 간격 (mm)

    // 점 p 에서 아래로 — 받쳐주는(윗면) geometry 까지 거리. 없으면 플레이트까지.
    //   같은 오버행 천장의 인접 삼각형(아랫면 hit)은 자기-표면이므로 무시한다.
    //   straight-down ray 가 곡면 오버행의 이웃 삼각형을 바로 다시 맞히면
    //   drop 이 0 에 가깝게 잡혀 모든 후보가 '자체 지지'로 잘못 제외되던 버그 수정.
    const dropDistance = (p: Vector3): number => {
      const ray = new Ray(
        new Vector3(p.x, p.y - 0.05, p.z),
        new Vector3(0, -1, 0),
        p.y
      );
      const hits = scene.multiPickWithRay(ray, onlyModel);
      if (hits && hits.length > 0) {
        const sorted = hits
          .filter((h) => h.hit && h.distance > 0.15)
          .sort((a, b) => a.distance - b.distance);
        for (const h of sorted) {
          const n = h.getNormal(true, true);
          // 윗면(법선이 위로)을 만나면 그 위에 모델이 얹혀 = 자체 지지
          if (n && n.y > 0.2) return h.distance + 0.05;
          // 아랫면 hit = 같은 오버행 영역 → 무시하고 계속 탐색
        }
      }
      return p.y; // 받쳐주는 면 없음 → 플레이트까지 낙하
    };
    const tris = readWorldTriangles(mesh);
    if (tris.length === 0) {
      console.warn('서포트 생성: 모델 삼각형을 읽지 못했습니다.');
      return;
    }

    // === 마진 — '마진 찾기' 버튼으로 미리 검출한 결과를 사용 ===
    //   마진을 찾지 않았거나 stlId 가 다르면 마진 정보 없음 →
    //   교합면/내면 분류 + 가드 존 비활성 (기존 거동).
    const MARGIN_GUARD = 1.0; // mm — 마진 라인 반경 1mm 안엔 서포트 금지
    const MARGIN_GUARD2 = MARGIN_GUARD * MARGIN_GUARD;
    const marginCache =
      marginRef.current && marginRef.current.stlId === stlId
        ? marginRef.current
        : null;
    const marginPoints: Vector3[] = marginCache ? marginCache.points : [];
    const occlusalFaces: Set<number> = marginCache
      ? marginCache.occlusalFaces
      : new Set();
    const hasOcclusalClassify = occlusalFaces.size > 0;
    const isOcclusal = (faceIndex: number): boolean =>
      !hasOcclusalClassify || occlusalFaces.has(faceIndex);

    // XZ 격자 — 마진 점 빠른 근접 조회
    const MG_CELL = MARGIN_GUARD;
    const mgGrid = new Map<string, Vector3[]>();
    for (const m of marginPoints) {
      const k = `${Math.floor(m.x / MG_CELL)},${Math.floor(m.z / MG_CELL)}`;
      let arr = mgGrid.get(k);
      if (!arr) {
        arr = [];
        mgGrid.set(k, arr);
      }
      arr.push(m);
    }
    const isNearMargin = (p: Vector3): boolean => {
      const cx = Math.floor(p.x / MG_CELL);
      const cz = Math.floor(p.z / MG_CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = mgGrid.get(`${cx + dx},${cz + dz}`);
          if (!arr) continue;
          for (const m of arr) {
            const ax = m.x - p.x;
            const ay = m.y - p.y;
            const az = m.z - p.z;
            if (ax * ax + ay * ay + az * az < MARGIN_GUARD2) return true;
          }
        }
      }
      return false;
    };

    // XZ 공간 그리드 — '주변에 더 낮은 표면이 있나'(아일랜드 판정)용.
    //   각 셀에 그 셀로 떨어지는 삼각형 중심의 최소 Y 를 보관한다.
    const CELL = 1.5;
    const colMinY = new Map<string, number>();
    for (const t of tris) {
      const k = `${Math.floor(t.centroid.x / CELL)},${Math.floor(
        t.centroid.z / CELL
      )}`;
      const cur = colMinY.get(k);
      if (cur === undefined || t.centroid.y < cur) colMinY.set(k, t.centroid.y);
    }
    // 점 c 주변(반경 ISLAND_R)에 c 보다 뚜렷이 낮은 표면이 없으면 = 국부 최저점 = 아일랜드
    const ISLAND_R = 2.2;
    const cellsR = Math.ceil(ISLAND_R / CELL);
    const isLocalLow = (c: Vector3): boolean => {
      const cx = Math.floor(c.x / CELL);
      const cz = Math.floor(c.z / CELL);
      for (let dx = -cellsR; dx <= cellsR; dx++) {
        for (let dz = -cellsR; dz <= cellsR; dz++) {
          const v = colMinY.get(`${cx + dx},${cz + dz}`);
          // 아일랜드 판정 강화 — 이웃이 1.5mm 이상 뚜렷이 낮을 때만 아일랜드 아님.
          //   (오목한 골 안쪽처럼 주변과 비슷한 높이의 표면이 잘못 아일랜드로
          //    잡히는 오탐을 줄인다)
          if (v !== undefined && v < c.y - 1.5) return false;
        }
      }
      return true;
    };

    // 지지 필요 지오메트리를 빠짐없이 포함하려면 촘촘히 스캔해야 한다.
    //   CAP 이하 모델은 모든 삼각형을 검사(step=1), 초과 시에만 가볍게 표본화.
    const CAP = 60000;
    const step = tris.length > CAP ? Math.ceil(tris.length / CAP) : 1;

    // base 검사는 모델 하위 50% 에서만 (높은 곳 오버행은 확실히 진짜 오버행)
    mesh.computeWorldMatrix(true);
    const mBox = mesh.getBoundingInfo().boundingBox;
    const baseCheckMaxY =
      mBox.minimumWorld.y + (mBox.maximumWorld.y - mBox.minimumWorld.y) * 0.5;

    // 표면을 따라 내리막으로 march — 빌드플레이트까지 끊김없이 이어지면
    // '바닥에 닿아있는' base 영역(모델이 플레이트로 자체 연결) → 오버행 서포트 불필요
    const DOWN = new Vector3(0, -1, 0);
    const descendsToPlate = (start: Vector3, startN: Vector3): boolean => {
      let cur = start;
      let nrm = startN;
      for (let s = 0; s < 22; s++) {
        if (cur.y <= PLATE_GAP + 0.3) return true; // 플레이트 도달 → base
        const dp = DOWN.subtract(nrm.scale(Vector3.Dot(nrm, DOWN)));
        if (dp.lengthSquared() < 1e-4) return false; // 수평 아랫면 → 더 못 내려감
        dp.normalize();
        const probe = cur.add(dp.scale(4)); // 표면 내리막으로 4mm 전진
        const snap = scene.pickWithRay(
          new Ray(probe.add(nrm.scale(3)), nrm.scale(-1), 6),
          onlyModel
        );
        if (!snap?.hit || !snap.pickedPoint) return false; // 표면 끊김 → base 아님
        const sn = snap.getNormal(true, true);
        if (!sn || sn.y > -0.2) return false; // 더 이상 아래보기 면 아님
        cur = snap.pickedPoint;
        nrm = sn;
      }
      return false;
    };

    // 지지 필요 판정 — 치투박스/큐라식 결정론적 규칙 (가중 risk score 아님)
    //   삼각형이 다음 중 하나면 '지지 필요':
    //    A) 오버행: 아랫면이 임계각(45°) 이상 수평으로 기울어짐  (n.y < -cos45°)
    //    B) 아일랜드: 주변에 더 낮은 표면이 없는 국부 최저점(공중 시작 단면)
    //   단, 바로 아래(CLEAR_MIN 이내)에 받쳐주는 면이 있으면(이전 레이어와 연결)
    //   오버행이라도 자체 지지되므로 제외 — 아일랜드는 시작 단면이라 항상 유지.
    type Seed = { point: Vector3; normal: Vector3; island: boolean };
    const seeds: Seed[] = [];
    let nOverhang = 0;
    let nIsland = 0;
    for (let i = 0; i < tris.length; i += step) {
      const t = tris[i];
      if (t.centroid.y < PLATE_GAP) continue; // 플레이트 접촉면 → 지지받음
      if (!isOcclusal(t.faceIndex)) continue; // 인레이 내면(intaglio) → 서포트 금지
      const n = t.normal;
      let isOverhang = n.y < -COS_OVERHANG; // A) 임계각 이상 오버행
      const isIsland = isLocalLow(t.centroid); // B) 국부 최저점(아일랜드)
      // 바닥에 닿아있는 base 영역 — 표면이 플레이트까지 이어지면 자체 지지 → 오버행 제외
      if (
        isOverhang &&
        !isIsland &&
        t.centroid.y < baseCheckMaxY &&
        descendsToPlate(t.centroid, n)
      ) {
        isOverhang = false;
      }
      if (!isOverhang && !isIsland) continue;

      // 바로 아래에 받쳐주는 면이 있으면 자체 지지 → 오버행은 제외(아일랜드는 예외)
      const drop = dropDistance(t.centroid);
      if (drop < CLEAR_MIN && !isIsland) continue;

      if (isIsland) nIsland++;
      else nOverhang++;
      seeds.push({
        point: t.centroid,
        // 아일랜드는 플레이트에서 수직으로 받친다(아래 방향 anchor)
        normal: isIsland ? new Vector3(0, -1, 0) : n,
        island: isIsland,
      });
    }

    // === 슬라이스 층 분석 (안정 서포팅) ===
    //   모델을 가로 단면으로 샘플 → 단면이 '크거나' '얇고 길거나' 한 Z 구간을
    //   찾아, 그 층의 아래보기 면(완만한 경사 포함)에도 서포트 seed 를 추가.
    let nSlice = 0;
    {
      const mb2 = mesh.getBoundingInfo().boundingBox;
      const yMin = mb2.minimumWorld.y;
      const yMax = mb2.maximumWorld.y;
      const modelDX = mb2.maximumWorld.x - mb2.minimumWorld.x;
      const modelDZ = mb2.maximumWorld.z - mb2.minimumWorld.z;
      const SLICE_STEP = 1.0; // 단면 샘플 간격 (mm)
      const bands: { y: number; x0: number; x1: number; z0: number; z1: number }[] =
        [];
      for (let z = yMin + SLICE_STEP; z < yMax - 0.2; z += SLICE_STEP) {
        let x0 = Infinity;
        let x1 = -Infinity;
        let z0 = Infinity;
        let z1 = -Infinity;
        let found = false;
        for (const t of tris) {
          const lo = Math.min(t.v0.y, t.v1.y, t.v2.y);
          const hi = Math.max(t.v0.y, t.v1.y, t.v2.y);
          if (z < lo || z > hi) continue;
          const vs = [t.v0, t.v1, t.v2];
          for (let e = 0; e < 3; e++) {
            const a = vs[e];
            const b = vs[(e + 1) % 3];
            if ((a.y - z) * (b.y - z) > 0) continue; // 평면을 안 가로지름
            const dy = b.y - a.y;
            if (Math.abs(dy) < 1e-9) continue;
            const tt = (z - a.y) / dy;
            const px = a.x + (b.x - a.x) * tt;
            const pz = a.z + (b.z - a.z) * tt;
            if (px < x0) x0 = px;
            if (px > x1) x1 = px;
            if (pz < z0) z0 = pz;
            if (pz > z1) z1 = pz;
            found = true;
          }
        }
        if (!found) continue;
        const dx = x1 - x0;
        const dz = z1 - z0;
        const lng = Math.max(dx, dz);
        const shrt = Math.min(dx, dz);
        const isLarge =
          shrt > 0.4 * Math.min(modelDX, modelDZ) && shrt > 5; // 큰 덩어리
        const isThinLong = lng > 8 && shrt < 3; // 얇고 긴 단면
        if (isLarge || isThinLong) {
          bands.push({ y: z, x0, x1, z0, z1 });
        }
      }
      // 위험 층의 아래보기 면(완만한 경사 포함)을 seed 에 추가
      if (bands.length > 0) {
        for (let i = 0; i < tris.length; i += step) {
          const t = tris[i];
          if (t.centroid.y < PLATE_GAP) continue;
          if (!isOcclusal(t.faceIndex)) continue; // 인레이 내면 → 서포트 금지
          if (t.normal.y > -COS_OVERHANG) continue; // 오버행(40°) 임계 미만 → 제외
          let inBand = false;
          for (const b of bands) {
            if (Math.abs(t.centroid.y - b.y) > SLICE_STEP * 0.6) continue;
            if (t.centroid.x < b.x0 - 1 || t.centroid.x > b.x1 + 1) continue;
            if (t.centroid.z < b.z0 - 1 || t.centroid.z > b.z1 + 1) continue;
            inBand = true;
            break;
          }
          if (!inBand) continue;
          if (dropDistance(t.centroid) < CLEAR_MIN) continue; // 자체 지지
          seeds.push({ point: t.centroid, normal: t.normal, island: false });
          nSlice++;
        }
      }
    }

    // === 마진 가드 적용 — 시드가 마진 근처면 가드 바깥으로 자동 이동 ===
    //   가까운 마진에서 멀어지는 방향(XZ)으로 0.5mm씩 진전, 가드 바깥에
    //   닿는 down-facing 표면을 찾아 새 시드로 채택. 끝까지 못 찾으면 그 시드 제거.
    //   (마진 자체엔 서포트 안 달림 → 제거 시 뜯기지 않음)
    //   Safe Zone 알고리즘:
    //   ① 시드가 마진 가드(MARGIN_GUARD) 밖이면 그대로 사용.
    //   ② 침범하면 원 시드 주변을 '가장 가까운 반경'부터 16방향으로 스캔
    //      (radius outward, 0.3mm 간격). 각 후보 XZ 에서:
    //        - 마진 가드 밖일 것
    //        - 그 컬럼에 down-facing 교합면 표면이 존재할 것
    //      가장 작은 반경에서 처음 만족되는 점 = 최근접 Safe Zone.
    //   ③ Safe Zone 을 OFFSET_MAX(4mm) 안에서 못 찾으면 그 시드는 제거
    //      (원래 오버행을 효과적으로 지지하기엔 너무 멀어진 경우).
    const adjustForMargin = (
      p: Vector3,
      n: Vector3
    ): { point: Vector3; normal: Vector3 } | null => {
      if (!isNearMargin(p)) return { point: p, normal: n };
      const OFFSET_MAX = 4; // mm — 원 시드에서 이만큼 안의 Safe Zone 만 인정
      const OFFSET_STEP = 0.3;
      const NA = 16;
      for (let r = OFFSET_STEP; r <= OFFSET_MAX + 1e-3; r += OFFSET_STEP) {
        for (let k = 0; k < NA; k++) {
          const a = (k / NA) * 2 * Math.PI;
          const tx = p.x + Math.cos(a) * r;
          const tz = p.z + Math.sin(a) * r;
          // 가드 침범 여부 — 같은 XZ 의 시드 Y 기준 점으로 빠르게 검사
          if (isNearMargin(new Vector3(tx, p.y, tz))) continue;
          // 그 컬럼의 down-facing 교합면 표면 찾기
          const ray = new Ray(
            new Vector3(tx, p.y + 5, tz),
            new Vector3(0, -1, 0),
            15
          );
          const hit = scene.pickWithRay(ray, onlyModel);
          if (!hit?.hit || !hit.pickedPoint) continue;
          const hn = hit.getNormal(true, true);
          if (!hn || hn.y > -0.2) continue; // down-facing 아니면 패스
          if (!isOcclusal(hit.faceId ?? -1)) continue; // 인레이 내면 금지
          // 실제 접점이 가드 안이 아닌지 한번 더 확인 (Y 차이 큰 경우 대비)
          if (isNearMargin(hit.pickedPoint)) continue;
          return { point: hit.pickedPoint, normal: hn };
        }
      }
      return null; // OFFSET_MAX 안에 Safe Zone 없음 — 시드 제거
    };
    {
      const adjusted: typeof seeds = [];
      for (const s of seeds) {
        const a = adjustForMargin(s.point, s.normal);
        if (!a) continue;
        adjusted.push({ point: a.point, normal: a.normal, island: s.island });
      }
      seeds.length = 0;
      seeds.push(...adjusted);
    }

    // 배치 (아일랜드 우선 — 작은 시작 단면을 놓치지 않도록):
    //   ① 지지 필요 지오메트리에 균일 간격(density)으로 primary 서포트 생성
    //   ② 각 primary 주변에 '터치 팁 거리' 반경 링으로 보조 서포트 추가
    seeds.sort((a, b) => (a.island === b.island ? 0 : a.island ? -1 : 1));
    const placedPrimary: Vector3[] = []; // primary 간격 판정용
    const placedAll: Vector3[] = []; // 전체 위치 — 보조 서포트 겹침 판정용
    let nPrimary = 0;
    let nAux = 0;
    const SUPPORT_CAP = 1800;

    // 튜브(반경 radius) from→to 가 STL 과 radius 이상 떨어져 있는지 검사.
    //   축 + 둘레 4점의 평행 레이로 튜브 굵기 + 여유를 함께 본다.
    const segmentClear = (
      from: Vector3,
      to: Vector3,
      radius: number
    ): boolean => {
      const v = to.subtract(from);
      const len = v.length();
      if (len < 1e-4) return true;
      const dir = v.scale(1 / len);
      let u = Vector3.Cross(dir, new Vector3(0, 1, 0));
      if (u.lengthSquared() < 1e-6) u = Vector3.Cross(dir, new Vector3(1, 0, 0));
      u.normalize();
      const w = Vector3.Cross(dir, u).normalize();
      const offs = [
        Vector3.Zero(),
        u.scale(radius),
        u.scale(-radius),
        w.scale(radius),
        w.scale(-radius),
      ];
      for (const o of offs) {
        if (scene.pickWithRay(new Ray(from.add(o), dir, len), onlyModel)?.hit) {
          return false;
        }
      }
      return true;
    };

    // 1개 서포트 생성·등록 — 플레이트에서 접점까지 경로를 라우팅한다.
    //   bend point 를 옮겨가며 수직 경로 우선, 막히면 목을 기울여 우회.
    //   목·몸통이 STL 과 클리어런스(튜브 반경 + 여유) 미만이면 그 경로 제외,
    //   어떤 경로도 안 되면 그 서포트 자체를 제외.
    const makeSupportAt = (
      point: Vector3,
      normal: Vector3,
      mustSupport = false
    ): boolean => {
      const tipLen = Math.max(settings.tipBottomDiameter * 1.6, 1.0);
      const neckR = Math.max(settings.tipBottomDiameter / 2, 0.1); // 목 반경
      const bodyR = settings.tipBottomDiameter; // 몸통 반경
      const sphereR = Math.max(settings.tipTopDiameter / 2, neckR); // 구형 팁 반경
      const CLEARR = bodyR + 0.5; // 몸통이 STL 에서 유지할 클리어런스 반경
      const NECK_PEN = neckR + 0.05; // 목 침범 검사 반경 (목은 STL 을 뚫으면 안 됨)
      const TIP_SKIP = 2 * sphereR + 0.15; // 구형 팁 구간 — 검사 제외(팁만 STL 에 닿음)
      const C = point; // 접점 (아일랜드/오버행)
      if (C.y < tipLen + 0.6) return false; // 너무 낮아 서포트 공간 없음

      // bend point 후보 — {수평 offset, 목 길이}.
      //   목 길이(수직 낙차)를 바꿔가며 STL 간섭을 피한다.
      //   필수 지지면(mustSupport)은 길이·각도 후보를 더 촘촘히 탐색한다.
      const maxRise = Math.min(mustSupport ? 12 : 8, Math.max(2.0, C.y - 0.6));
      const riseStep = mustSupport ? 0.9 : 1.5;
      const riseSet: number[] = [];
      for (let r = 2.0; r <= maxRise + 1e-3; r += riseStep) riseSet.push(r);
      if (riseSet.length === 0) riseSet.push(Math.max(2.0, maxRise));
      const tiltDirs = mustSupport ? 12 : 8;

      // ① 수직(offset 0)으로 목 길이만 바꿔 시도 → ② 기울임 + 목 길이 조합
      const cands: { ox: number; oz: number; rise: number }[] = [];
      for (const rise of riseSet) cands.push({ ox: 0, oz: 0, rise });
      for (const rise of riseSet) {
        for (const rad of [rise * 0.6, rise * 1.0, rise * 1.5]) {
          for (let k = 0; k < tiltDirs; k++) {
            const a = (k / tiltDirs) * 2 * Math.PI;
            cands.push({
              ox: Math.cos(a) * rad,
              oz: Math.sin(a) * rad,
              rise,
            });
          }
        }
      }

      for (const { ox, oz, rise } of cands) {
        const B = new Vector3(C.x + ox, C.y - rise, C.z + oz);
        if (B.y < 0.5) continue;
        const cToB = B.subtract(C);
        const nlen = cToB.length();
        if (nlen < tipLen + 0.6) continue; // 목이 너무 짧음
        const ndir = cToB.scale(1 / nlen);
        // 목 — 구형 팁 구간(TIP_SKIP) 이후 전체를 STL 침범 검사.
        //   팁(구)만 STL 에 닿고, 그 아래 목/몸통은 STL 을 침범하면 안 된다.
        if (nlen > TIP_SKIP) {
          const neckStart = C.add(ndir.scale(TIP_SKIP));
          if (!segmentClear(neckStart, B, NECK_PEN)) continue; // 목이 STL 침범
        }
        // 몸통 — 수직 컬럼 전체 클리어런스 검사
        const plate = new Vector3(B.x, 0, B.z);
        if (!segmentClear(B, plate, CLEARR)) continue; // 몸통 간섭

        // 경로 확보 — 이 bend point 로 서포트 생성
        const support = createSupport(scene, C, normal, settings, B);
        if (!support) continue;
        support.metadata = { stlId };
        support.setParent(mesh); // 서포트를 STL 에 부착 (모델을 따라감)
        supportsRef.current.push(support);
        return true;
      }
      return false; // 어떤 경로도 STL 간섭 → 서포트 제외
    };
    // origin 에서 dir 방향으로 모델 표면을 찾아 부착점·법선 반환
    const snapToSurface = (
      origin: Vector3,
      dir: Vector3
    ): { point: Vector3; normal: Vector3; faceId: number } | null => {
      const ray = new Ray(origin, dir, 8);
      const hit = scene.pickWithRay(ray, onlyModel);
      if (hit?.hit && hit.pickedPoint) {
        return {
          point: hit.pickedPoint,
          normal: hit.getNormal(true, true) ?? dir.scale(-1),
          faceId: hit.faceId ?? -1,
        };
      }
      return null;
    };

    // 보조 서포트 — 필수 서포트로부터 '터치 팁 거리' 만큼 떨어진 링에 배치
    const AUX_R = Math.max(settings.touchTipDistance, 1.5); // 링 반경 = 터치 팁 거리
    const AUX_GAP = Math.max(footDia * 0.85, 1.5); // 보조 겹침 최소거리
    const AUX_COUNT = 6; // 링 둘레의 보조 서포트 개수
    for (const s of seeds) {
      if (placedAll.length > SUPPORT_CAP) break; // 안전 상한
      // 균일 간격 배치 — 아일랜드는 촘촘하게, 오버행은 density 간격
      const spacing = s.island ? ISLAND_SPACING : OVERHANG_SPACING;
      if (
        placedPrimary.some((q) => Vector3.Distance(q, s.point) < spacing)
      )
        continue;
      // ① primary — 지지 필요 지오메트리에 반드시 생성.
      //   아일랜드는 mustSupport=true 로 목 길이를 더 폭넓게 조정해 간섭을 피한다.
      if (!makeSupportAt(s.point, s.normal, s.island)) continue;
      placedPrimary.push(s.point);
      placedAll.push(s.point);
      nPrimary++;

      // ② 해당 부분 주변에 보조 서포트 2~3개 추가
      const n = s.normal.normalizeToNew();
      let u = Vector3.Cross(n, Vector3.Up());
      if (u.lengthSquared() < 1e-6) u = Vector3.Cross(n, Vector3.Right());
      u.normalize();
      const v = Vector3.Cross(n, u).normalize();
      const baseAng = Math.random() * Math.PI * 2;
      for (let k = 0; k < AUX_COUNT; k++) {
        const ang = baseAng + (k * 2 * Math.PI) / AUX_COUNT;
        const dir = u.scale(Math.cos(ang)).add(v.scale(Math.sin(ang)));
        const target = s.point.add(dir.scale(AUX_R));
        // 표면에서 살짝 떨어진 곳에서 표면 쪽(-n)으로 레이캐스트 → 실제 부착점
        const snap = snapToSurface(target.add(n.scale(3)), n.scale(-1));
        if (!snap) continue; // 주변에 부착할 표면 없음 → 건너뜀
        // 아래를 향한 면에만 보조 서포트 — 윗면/수직면에 붙이면 서포트가 모델을 파고듦
        if (snap.normal.y > -0.2) continue;
        if (!isOcclusal(snap.faceId)) continue; // 인레이 내면 → 보조 서포트 금지
        if (isNearMargin(snap.point)) continue; // 마진 가드 — 보조도 마진 금지
        if (placedAll.some((q) => Vector3.Distance(q, snap.point) < AUX_GAP))
          continue;
        if (makeSupportAt(snap.point, snap.normal)) {
          placedAll.push(snap.point);
          nAux++;
        }
      }
    }

    // 진단 — 생성된 서포트와 모델의 실제 위치 범위 확인
    mesh.computeWorldMatrix(true);
    const mbb = mesh.getBoundingInfo().boundingBox;
    let sMinY = Infinity;
    let sMaxY = -Infinity;
    let sMeshCount = 0;
    for (const s of supportsRef.current) {
      if (s.metadata?.stlId !== stlId) continue;
      s.computeWorldMatrix(true);
      const bi = s.getBoundingInfo().boundingBox;
      sMinY = Math.min(sMinY, bi.minimumWorld.y);
      sMaxY = Math.max(sMaxY, bi.maximumWorld.y);
      sMeshCount++;
    }
    const diag =
      `모델 Y범위 [${mbb.minimumWorld.y.toFixed(1)} ~ ${mbb.maximumWorld.y.toFixed(1)}]\n` +
      (sMeshCount > 0
        ? `서포트 Y범위 [${sMinY.toFixed(1)} ~ ${sMaxY.toFixed(1)}]`
        : `서포트 메쉬 0개`);
    const msg =
      `서포트 생성 완료\n` +
      `아일랜드 ${nIsland} · 오버행 ${nOverhang} · 슬라이스층 ${nSlice}\n` +
      `주요 서포트 ${nPrimary}개 + 보조 서포트 ${nAux}개 = 총 ${placedAll.length}개\n` +
      diag;
    console.log('[서포트 생성]', msg.replace(/\n/g, ' / '));
  }, [generateSupportsSignal]);

  /**
   * 자동 각도 조절 — '자동 각도 조절 실행' 버튼
   * 색칠한 면(보호 영역)의 평균 법선이 위(+Y, 플레이트 반대)를 향하도록 모델을
   * 회전시킨다. 색칠하지 않은 면이 플레이트를 향하게 되어, 서포트가 필요한
   * 미지지 지오메트리는 색칠하지 않은 부분에만 포함된다 (조건 1).
   */
  useEffect(() => {
    if (autoAngleSignal === 0) return; // 초기값
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return;

    // 선택된 STL, 없으면 로드된 첫 STL 사용
    let stlId = selectedFileIds[0];
    if (!stlId) {
      const ids = Array.from(meshMapRef.current.keys());
      if (ids.length > 0) stlId = ids[0];
    }
    if (!stlId) {
      console.warn('자동 각도 조절: 대상 STL이 없습니다. STL을 먼저 불러오세요.');
      return;
    }
    const mesh = meshMapRef.current.get(stlId);
    if (!mesh) {
      console.warn('자동 각도 조절: 대상 STL 메쉬를 찾을 수 없습니다.');
      return;
    }

    // 색칠한 면(보호 영역)의 평균 법선을 위(+Y)로 향하게 모델을 회전시킨다.
    //   → 색칠 면은 플레이트 반대쪽(위), 색칠하지 않은 면이 플레이트를 향한다.
    //   서포트가 필요한 미지지 지오메트리는 아래를 향한 면에서 생기므로,
    //   색칠 면이 위를 향하면 색칠하지 않은 부분에만 서포트가 달린다 (조건 1).
    const tris = readWorldTriangles(mesh).map((t) => ({
      ...t,
      masked: isMasked(t.centroid, t.normal, t.faceIndex),
    }));
    if (tris.length === 0) {
      console.warn('자동 각도 조절: 분석할 삼각형이 없습니다.');
      return;
    }

    // 색칠 면의 면적 가중 평균 법선 (현재 월드 기준)
    let pnx = 0;
    let pny = 0;
    let pnz = 0;
    let pArea = 0;
    for (const t of tris) {
      if (!t.masked) continue;
      pnx += t.normal.x * t.area;
      pny += t.normal.y * t.area;
      pnz += t.normal.z * t.area;
      pArea += t.area;
    }
    if (pArea < 1e-6) {
      console.warn(
        '자동 각도 조절: 색칠한 영역이 없습니다. 먼저 브러쉬로 영역을 지정하세요.'
      );
      return;
    }
    const paintN = new Vector3(pnx, pny, pnz).normalize();

    // 평균 색칠 법선을 +Y(위)로 보내는 회전 q
    const up = new Vector3(0, 1, 0);
    const d = Math.max(-1, Math.min(1, Vector3.Dot(paintN, up)));
    let q: Quaternion;
    if (d > 0.99999) {
      q = Quaternion.Identity(); // 이미 위를 향함 → 회전 불필요
    } else if (d < -0.99999) {
      q = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI); // 정반대 → 뒤집기
    } else {
      q = Quaternion.RotationAxis(
        Vector3.Cross(paintN, up).normalize(),
        Math.acos(d)
      );
    }
    const changed = d < 0.99999;

    if (changed) {
      // 색칠 면이 위를 향하도록 회전 후 빌드플레이트(Y=0)에 재안착
      mesh.rotationQuaternion = q.multiply(
        mesh.rotationQuaternion ?? Quaternion.Identity()
      );
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo();
      const minY = mesh.getBoundingInfo().boundingBox.minimumWorld.y;
      mesh.position.y -= minY;
      mesh.computeWorldMatrix(true);
      onGizmoTransformChangeRef.current?.(stlId, mesh); // transform 저장
    }

    // 진단 — 조건 1 확인: 회전 후에도 아래를 향하는(서포트가 생길) 색칠 면적.
    //   0 이면 미지지 지오메트리가 색칠하지 않은 부분에만 포함된다.
    const COS_OH = Math.cos((40 * Math.PI) / 180); // 임계 오버행 각
    const rotM = new Matrix();
    q.toRotationMatrix(rotM);
    let maskedDown = 0;
    for (const t of tris) {
      if (!t.masked) continue;
      const ny = Vector3.TransformNormal(t.normal, rotM).y;
      if (ny < -COS_OH) maskedDown += t.area;
    }
    const msg =
      (changed
        ? '자동 각도 조절 완료 — 색칠 면이 위(플레이트 반대)를 향하도록 회전'
        : '회전 불필요 — 색칠 면이 이미 위를 향함') +
      (maskedDown > 0.1
        ? ` / 주의: 색칠 면 ${maskedDown.toFixed(1)} mm² 가 아직 아래를 향함` +
          ` (곡면이라 회전만으로 완전히 못 피함) — 그 부분엔 서포트가 생길 수 있음`
        : ' / 색칠 면이 모두 위를 향함 — 미지지 지오메트리는 색칠하지 않은 부분에만 포함');
    console.log('[자동 각도 조절]', msg);
  }, [autoAngleSignal]);

  /**
   * 마진 찾기 — '마진 찾기' 버튼
   *   사용자가 브러쉬로 마진 근처를 살짝 칠하면, 색칠 영역 내부에서 인접한 두
   *   삼각형의 법선이 급격히 꺾이는(=다이히드럴 큰) 모서리를 찾아 마진으로
   *   삼는다. 색칠 영역에 한정해 탐색하므로 다른 sharp 디테일(fissure 등)이
   *   영향을 주지 않고, 임계각을 낮춰 높은 민감도로 검출한다.
   */
  useEffect(() => {
    if (findMarginSignal === 0) return;
    const scene = sceneRef.current;
    if (!scene) return;
    let stlId = selectedFileIds[0];
    if (!stlId) {
      const ids = Array.from(meshMapRef.current.keys());
      if (ids.length > 0) stlId = ids[0];
    }
    if (!stlId) {
      console.warn('마진 찾기: 대상 STL이 없습니다.');
      return;
    }
    const mesh = meshMapRef.current.get(stlId);
    if (!mesh) return;
    if (maskRef.current.length === 0) {
      console.warn(
        '마진 찾기: 색칠 영역이 없습니다. 먼저 브러쉬로 마진 부근을 칠하세요.'
      );
      return;
    }
    const tris = readWorldTriangles(mesh);
    if (tris.length === 0) return;

    // ① 색칠된 삼각형 집합
    const paintedSet = new Set<number>();
    for (const t of tris) {
      if (isMasked(t.centroid, t.normal)) paintedSet.add(t.faceIndex);
    }
    if (paintedSet.size === 0) {
      console.warn('마진 찾기: 색칠된 삼각형이 없습니다.');
      return;
    }

    // ② 메시 인덱스/포지션 + canonical vertex (position 용접)
    const meshIndices = mesh.getIndices();
    const meshPositions = mesh.getVerticesData('position');
    if (!meshIndices || !meshPositions) return;
    const wm = mesh.computeWorldMatrix(true);
    const QUANT = 1000;
    const vertCount = meshPositions.length / 3;
    const canon = new Int32Array(vertCount);
    const posToCanon = new Map<string, number>();
    const canonPositions: Vector3[] = [];
    for (let v = 0; v < vertCount; v++) {
      const x = Math.round(meshPositions[v * 3] * QUANT);
      const y = Math.round(meshPositions[v * 3 + 1] * QUANT);
      const z = Math.round(meshPositions[v * 3 + 2] * QUANT);
      const k = `${x},${y},${z}`;
      let c = posToCanon.get(k);
      if (c === undefined) {
        c = posToCanon.size;
        posToCanon.set(k, c);
        canonPositions[c] = Vector3.TransformCoordinates(
          new Vector3(
            meshPositions[v * 3],
            meshPositions[v * 3 + 1],
            meshPositions[v * 3 + 2]
          ),
          wm
        );
      }
      canon[v] = c;
    }

    // ③ 엣지 인접성 — canonical 인덱스 기준
    const ek = (a: number, b: number): string =>
      a < b ? `${a},${b}` : `${b},${a}`;
    const edgeFaces = new Map<string, number[]>();
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
        let arr = edgeFaces.get(k);
        if (!arr) {
          arr = [];
          edgeFaces.set(k, arr);
        }
        arr.push(f);
      }
    }

    // ④ Sharp dihedral 엣지 수집 — 색칠 영역(낮은 임계) + 전체 메시(엄격 임계).
    //   색칠 영역 내 sharp = 시드, 전체 메시 sharp = 확장에 사용.
    //   시드가 속한 연결 컴포넌트의 모든 엣지를 추적하면 마진이 폐곡선으로 연장됨.
    const SHARP_DEG_PAINTED = 25;
    const SHARP_DEG_GLOBAL = 12; // 거친 mesh 에서도 마진 sharp 라인의 모든 vertex 쌍이 후보화되도록 완화
    const SHARP_DOT_PAINTED = Math.cos((SHARP_DEG_PAINTED * Math.PI) / 180);
    const SHARP_DOT_GLOBAL = Math.cos((SHARP_DEG_GLOBAL * Math.PI) / 180);
    const triNormalByFace = new Map<number, Vector3>();
    for (const t of tris) triNormalByFace.set(t.faceIndex, t.normal);

    type CandEdge = { va: number; vb: number; pa: Vector3; pb: Vector3 };
    const edgeByKey = new Map<string, CandEdge>();
    const seedKeys = new Set<string>();
    const allKeys = new Set<string>();

    // 플레이트 접지부(모델 바닥의 sharp 링) 배제용 — 두 vertex 모두 Y 가
    //   PLATE_EXCL 미만이면 마진 후보로 안 잡는다.
    const PLATE_EXCL = 0.6;
    for (const [k, faces] of edgeFaces) {
      if (faces.length !== 2) continue;
      const n1 = triNormalByFace.get(faces[0]);
      const n2 = triNormalByFace.get(faces[1]);
      if (!n1 || !n2) continue;
      const dotNN = Vector3.Dot(n1, n2);
      const bothPainted =
        paintedSet.has(faces[0]) && paintedSet.has(faces[1]);
      const isSeed = bothPainted && dotNN <= SHARP_DOT_PAINTED;
      const isGlobal = dotNN <= SHARP_DOT_GLOBAL;
      if (!isSeed && !isGlobal) continue;
      const [aStr, bStr] = k.split(',');
      const va = parseInt(aStr, 10);
      const vb = parseInt(bStr, 10);
      const pa = canonPositions[va];
      const pb = canonPositions[vb];
      if (!pa || !pb) continue;
      // 플레이트 접지부 배제 — 시드가 아닐 때만 (시드 자체는 사용자가 지정한 위치라 신뢰)
      if (!isSeed && pa.y < PLATE_EXCL && pb.y < PLATE_EXCL) continue;
      edgeByKey.set(k, { va, vb, pa, pb });
      if (isSeed) seedKeys.add(k);
      if (isGlobal || isSeed) allKeys.add(k); // 시드는 항상 포함
    }

    if (seedKeys.size === 0) {
      console.warn(
        '마진 찾기: 색칠 영역 안에서 sharp 모서리(시드)를 찾지 못했습니다. ' +
          '브러쉬로 마진(각이 급변하는 부분)에 살짝 더 칠해보세요.'
      );
      return;
    }

    // ⑤ vertex adjacency — 모든 sharp 엣지(시드 + 전체)
    const vAdj = new Map<number, Set<number>>();
    for (const k of allKeys) {
      const e = edgeByKey.get(k);
      if (!e) continue;
      let a = vAdj.get(e.va);
      if (!a) {
        a = new Set();
        vAdj.set(e.va, a);
      }
      a.add(e.vb);
      let b = vAdj.get(e.vb);
      if (!b) {
        b = new Set();
        vAdj.set(e.vb, b);
      }
      b.add(e.va);
    }

    // ⑥ 방향 연속성 chain walk — 시드 엣지에서 출발해 분기 vertex 에서는
    //    가장 정렬된 한 이웃만 따라간다(best-only). 단일 chain 유지로 마진의
    //    안쪽/바깥쪽 평행 라인이 동시에 추적되는 다중선을 방지한다.
    //    + 시드 vertex 영역 제한: chain 의 새 frontier 가 어떤 시드 vertex 와도
    //      SEED_REGION_R mm 이내일 것 → 시드 영역 밖 sharp 디테일로 chain 이
    //      새 나가는 false-positive 방지 (사용자 brush 영역 의도 반영).
    const DIR_TOL_DEG = 45; // 한 step 허용 방향 변화 — 곡률 급한 마진 구간 허용
    const DIR_TOL_DOT = Math.cos((DIR_TOL_DEG * Math.PI) / 180);

    // edge → dihedral dotNN (endpoint corner extension 에서 사용)
    const edgeDihedral = new Map<string, number>();
    for (const [k, faces] of edgeFaces) {
      if (faces.length !== 2) continue;
      const n1 = triNormalByFace.get(faces[0]);
      const n2 = triNormalByFace.get(faces[1]);
      if (!n1 || !n2) continue;
      edgeDihedral.set(k, Vector3.Dot(n1, n2));
    }

    // 시드 vertex 위치 모음
    const seedVertices = new Set<number>();
    for (const sk of seedKeys) {
      const e = edgeByKey.get(sk);
      if (!e) continue;
      seedVertices.add(e.va);
      seedVertices.add(e.vb);
    }
    const seedPositions: Vector3[] = [];
    for (const sv of seedVertices) {
      const p = canonPositions[sv];
      if (p) seedPositions.push(p);
    }
    // 영역 반경 — brush 두께 비례 + 최소 8mm.
    const SEED_REGION_R = Math.max(brushThicknessRef.current * 3, 8);
    const SEED_REGION_R2 = SEED_REGION_R * SEED_REGION_R;
    const isWithinSeedRegion = (p: Vector3): boolean => {
      for (const sp of seedPositions) {
        const dx = sp.x - p.x;
        const dy = sp.y - p.y;
        const dz = sp.z - p.z;
        if (dx * dx + dy * dy + dz * dz <= SEED_REGION_R2) return true;
      }
      return false;
    };

    const visitedEdges = new Set<string>(seedKeys);
    type Frontier = { v: number; comingFrom: Vector3 };
    const queue: Frontier[] = [];

    // 시드 엣지마다 양방향 진행을 큐에 넣는다.
    for (const sk of seedKeys) {
      const e = edgeByKey.get(sk);
      if (!e) continue;
      const dir = e.pb.subtract(e.pa);
      const len = dir.length();
      if (len < 1e-9) continue;
      dir.scaleInPlace(1 / len);
      queue.push({ v: e.vb, comingFrom: dir });
      queue.push({ v: e.va, comingFrom: dir.scale(-1) });
    }

    while (queue.length > 0) {
      const f = queue.shift() as Frontier;
      const adj = vAdj.get(f.v);
      if (!adj) continue;
      const pV = canonPositions[f.v];
      if (!pV) continue;
      // 분기 vertex 에서 best-only: incoming 방향과 가장 정렬된 한 이웃만 채택.
      let bestNb = -1;
      let bestDot = DIR_TOL_DOT;
      let bestDir: Vector3 | null = null;
      for (const nb of adj) {
        if (nb === f.v) continue;
        const key = f.v < nb ? `${f.v},${nb}` : `${nb},${f.v}`;
        if (visitedEdges.has(key)) continue;
        const pNb = canonPositions[nb];
        if (!pNb) continue;
        // 시드 영역 밖 vertex 는 chain 진행 차단
        if (!isWithinSeedRegion(pNb)) continue;
        const outDir = pNb.subtract(pV);
        const outLen = outDir.length();
        if (outLen < 1e-9) continue;
        outDir.scaleInPlace(1 / outLen);
        const align = Vector3.Dot(outDir, f.comingFrom);
        if (align > bestDot) {
          bestDot = align;
          bestNb = nb;
          bestDir = outDir;
        }
      }
      if (bestNb >= 0 && bestDir) {
        const key =
          f.v < bestNb ? `${f.v},${bestNb}` : `${bestNb},${f.v}`;
        visitedEdges.add(key);
        queue.push({ v: bestNb, comingFrom: bestDir });
      }
    }

    const marginCand: CandEdge[] = [];
    for (const k of visitedEdges) {
      const e = edgeByKey.get(k);
      if (e) marginCand.push(e);
    }
    if (marginCand.length === 0) {
      console.warn('마진 찾기: 마진 컴포넌트가 비어있습니다.');
      return;
    }

    // ⑦ 후처리 1 — Spur trimming: chain 결과의 짧은 가지(잘못 빠진 dead-end)
    //   를 가지치기. degree-1 endpoint 에서 출발해 분기점(degree≥3) 도달 시까지
    //   누적 거리가 SPUR_MAX 이내면 그 path 의 엣지 전부 제거. 진짜 마진의
    //   양 끝(다른 endpoint 까지의 chain)은 길이가 길어 임계 초과 → 보존.
    const SPUR_MAX = 2.0; // mm — 이보다 짧은 가지는 spur
    const ekey = (a: number, b: number): string =>
      a < b ? `${a},${b}` : `${b},${a}`;
    {
      const adj = new Map<number, Set<number>>();
      for (const e of marginCand) {
        let a = adj.get(e.va);
        if (!a) {
          a = new Set();
          adj.set(e.va, a);
        }
        a.add(e.vb);
        let b = adj.get(e.vb);
        if (!b) {
          b = new Set();
          adj.set(e.vb, b);
        }
        b.add(e.va);
      }
      const removedEdges = new Set<string>();
      const initialEndpoints: number[] = [];
      for (const [v, nbs] of adj) if (nbs.size === 1) initialEndpoints.push(v);
      for (const v0 of initialEndpoints) {
        // v0 부터 chain 따라 진행하며 분기점/임계 만날 때까지 trace
        const path: number[] = [v0];
        let length = 0;
        let prev = -1;
        let cur = v0;
        let foundBranch = false;
        while (true) {
          const nbs = adj.get(cur);
          if (!nbs) break;
          let next = -1;
          for (const nb of nbs) {
            if (nb === prev) continue;
            if (removedEdges.has(ekey(cur, nb))) continue;
            next = nb;
            break;
          }
          if (next === -1) break;
          const pCur = canonPositions[cur];
          const pNext = canonPositions[next];
          if (!pCur || !pNext) break;
          length += Vector3.Distance(pCur, pNext);
          path.push(next);
          if (length > SPUR_MAX) break;
          const nextDeg = adj.get(next)?.size ?? 0;
          if (nextDeg >= 3) {
            foundBranch = true;
            break;
          }
          if (nextDeg === 1 && next !== v0) break; // 다른 endpoint — 전체 chain 이 짧음, 보존
          prev = cur;
          cur = next;
        }
        if (foundBranch) {
          for (let i = 0; i < path.length - 1; i++) {
            removedEdges.add(ekey(path[i], path[i + 1]));
          }
        }
      }
      if (removedEdges.size > 0) {
        const filtered: CandEdge[] = [];
        for (const e of marginCand) {
          if (!removedEdges.has(ekey(e.va, e.vb))) filtered.push(e);
        }
        marginCand.length = 0;
        marginCand.push(...filtered);
      }
    }

    // ⑦.5 Endpoint corner extension — 끊긴 chain endpoint 를 sharp 방향 무관하게 연장.
    //   chain walk 의 DIR_TOL_DOT 가 45° 라서 큰 곡률 (코너/급커브) 에서 끊김 → endpoint 발생.
    //   이 단계는 endpoint 한정으로 direction 무관(최대 150° 회전) + dihedral ≥20° edge 만
    //   탐색해 chain 연장. region 안 한정 + 최대 N 스텝 → 노이즈 확산 차단.
    //   민감도(SHARP_DEG_GLOBAL/PAINTED) 변경 없이 코너 케이스 전용으로 동작.
    let cornerExtSteps = 0;
    {
      // 현재 marginCand 의 컴포넌트 adjacency
      const cAdj = new Map<number, Set<number>>();
      for (const e of marginCand) {
        let a = cAdj.get(e.va);
        if (!a) { a = new Set(); cAdj.set(e.va, a); }
        a.add(e.vb);
        let b = cAdj.get(e.vb);
        if (!b) { b = new Set(); cAdj.set(e.vb, b); }
        b.add(e.va);
      }
      // 모든 degree-1 endpoint + 그 outgoing direction
      const endpointStarts: { v: number; dir: Vector3 }[] = [];
      for (const [v, nbs] of cAdj) {
        if (nbs.size !== 1) continue;
        const nb = Array.from(nbs)[0];
        const pV = canonPositions[v];
        const pNb = canonPositions[nb];
        if (!pV || !pNb) continue;
        const d = pV.subtract(pNb);
        const len = d.length();
        if (len < 1e-9) continue;
        d.scaleInPlace(1 / len);
        endpointStarts.push({ v, dir: d });
      }

      const MAX_CORNER_STEPS = 5; // 너무 길게 연장 시 평행 chain 노이즈 → 짧게.
      const CORNER_DIR_TOL_DOT = Math.cos((150 * Math.PI) / 180); // 최대 150° 회전 허용
      const CORNER_SHARP_DOT = Math.cos((30 * Math.PI) / 180); // dihedral ≥ 30° 만 (코너 명확)

      for (const { v: epStart, dir: epDir } of endpointStarts) {
        let cur = epStart;
        let curDir = epDir;
        for (let step = 0; step < MAX_CORNER_STEPS; step++) {
          const adj = vAdj.get(cur);
          if (!adj) break;
          const pV = canonPositions[cur];
          if (!pV) break;
          let bestNb = -1;
          let bestScore = -Infinity;
          let bestDir: Vector3 | null = null;
          for (const nb of adj) {
            if (nb === cur) continue;
            const key = cur < nb ? `${cur},${nb}` : `${nb},${cur}`;
            if (visitedEdges.has(key)) continue;
            const pNb = canonPositions[nb];
            if (!pNb) continue;
            if (!isWithinSeedRegion(pNb)) continue;
            const outDir = pNb.subtract(pV);
            const outLen = outDir.length();
            if (outLen < 1e-9) continue;
            outDir.scaleInPlace(1 / outLen);
            const align = Vector3.Dot(outDir, curDir);
            if (align < CORNER_DIR_TOL_DOT) continue; // 최대 150° 회전까지 허용
            const dotNN = edgeDihedral.get(key) ?? 1.0;
            if (dotNN > CORNER_SHARP_DOT) continue; // ≥ 20° dihedral 만
            // score: 더 sharp + 정렬도. sharpness 가 주 인자 — 코너 탐지가 목적.
            const score = (1 - dotNN) * 1.0 + align * 0.3;
            if (score > bestScore) {
              bestScore = score;
              bestNb = nb;
              bestDir = outDir;
            }
          }
          if (bestNb < 0 || !bestDir) break;
          const key = cur < bestNb ? `${cur},${bestNb}` : `${bestNb},${cur}`;
          visitedEdges.add(key);
          const pa = canonPositions[cur];
          const pb = canonPositions[bestNb];
          if (!pa || !pb) break;
          marginCand.push({ va: cur, vb: bestNb, pa, pb });
          cornerExtSteps++;
          cur = bestNb;
          curDir = bestDir;
        }
      }
    }

    // ⑦.7 작은-컴포넌트 폐기 — corner extension 후에도 총 길이 < 1.5mm 인 isolated 컴포넌트 제거.
    //   큰 마진 chain 은 영향 없음 (수십 mm 이상). tangle 안의 짧은 fragment 노이즈만 정리.
    //   bridge 단계 전에 실행 — 이후 inter-component bridge 는 깨끗한 컴포넌트만 대상.
    let droppedTinyComps = 0;
    {
      const adj7 = new Map<number, Set<number>>();
      for (const e of marginCand) {
        let a = adj7.get(e.va);
        if (!a) { a = new Set(); adj7.set(e.va, a); }
        a.add(e.vb);
        let b = adj7.get(e.vb);
        if (!b) { b = new Set(); adj7.set(e.vb, b); }
        b.add(e.va);
      }
      const visited7 = new Set<number>();
      const compMap7 = new Map<number, number>();
      const compLen7: number[] = [];
      let cId7 = 0;
      for (const startV of adj7.keys()) {
        if (visited7.has(startV)) continue;
        cId7++;
        const stack: number[] = [startV];
        visited7.add(startV);
        compMap7.set(startV, cId7);
        let len = 0;
        while (stack.length > 0) {
          const v = stack.pop() as number;
          const pV = canonPositions[v];
          const nbs = adj7.get(v);
          if (!nbs || !pV) continue;
          for (const nb of nbs) {
            if (visited7.has(nb)) continue;
            const pNb = canonPositions[nb];
            if (!pNb) continue;
            len += Vector3.Distance(pV, pNb);
            visited7.add(nb);
            compMap7.set(nb, cId7);
            stack.push(nb);
          }
        }
        compLen7[cId7] = len;
      }
      const MIN_TINY_COMP_LEN = 1.5; // mm — 이보다 짧으면 noise 로 폐기
      const keptCand: CandEdge[] = [];
      for (const e of marginCand) {
        const cid = compMap7.get(e.va) ?? 0;
        const clen = compLen7[cid] ?? 0;
        if (clen >= MIN_TINY_COMP_LEN) keptCand.push(e);
      }
      droppedTinyComps = marginCand.length - keptCand.length;
      if (droppedTinyComps > 0) {
        marginCand.length = 0;
        marginCand.push(...keptCand);
      }
    }

    // ⑧ 후처리 2 — Endpoint bridge: spur 제거 후 남은 backbone 양 끝 endpoint 끼리
    //   STL 표면(mesh vertex-edge graph) 위의 Dijkstra 최단 경로로 연결.
    //   직선 bridge 가 모델 내부/외부를 가로지르는 문제 해결 — 항상 표면을 따라간다.
    const bridgePoints: Vector3[] = [];
    let surfacePathCount = 0;
    let straightFallbackCount = 0;
    let interCompPathCount = 0;
    {
      // 컴포넌트 그래프 + 컴포넌트 분류
      const compAdj = new Map<number, Set<number>>();
      for (const e of marginCand) {
        let a = compAdj.get(e.va);
        if (!a) {
          a = new Set();
          compAdj.set(e.va, a);
        }
        a.add(e.vb);
        let b = compAdj.get(e.vb);
        if (!b) {
          b = new Set();
          compAdj.set(e.vb, b);
        }
        b.add(e.va);
      }
      const vertexComp = new Map<number, number>();
      const compVertices = new Map<number, number[]>();
      let compIdNext = 0;
      for (const startV of compAdj.keys()) {
        if (vertexComp.has(startV)) continue;
        compIdNext++;
        const stack = [startV];
        vertexComp.set(startV, compIdNext);
        const arr: number[] = [];
        while (stack.length > 0) {
          const v = stack.pop() as number;
          arr.push(v);
          const nbs = compAdj.get(v);
          if (!nbs) continue;
          for (const nb of nbs) {
            if (!vertexComp.has(nb)) {
              vertexComp.set(nb, compIdNext);
              stack.push(nb);
            }
          }
        }
        compVertices.set(compIdNext, arr);
      }

      const BRIDGE_MAX = 12.0; // endpoint(degree-1) 쌍 직선거리
      // weighted Dijkstra weighted distance 한계 — ridge 우회 허용 위해 ×4.5.
      //   ×3 으로는 휘는 ridge path 가 한계 초과로 실패 → 직선 폴백으로 빠지는 경우 발생.
      const SURFACE_MAX = BRIDGE_MAX * 4.5;
      const INTERCOMP_BRIDGE_MAX = 15.0;
      const INTERCOMP_SURFACE_MAX = INTERCOMP_BRIDGE_MAX * 4.5;
      const MIN_COMP_VERTS = 2; // 단일-edge fragment 까지 bridge 대상에 포함

      // === Mesh vertex-edge graph (canonical) — surface path 용 ===
      const meshVAdj = new Map<number, Set<number>>();
      for (const k of edgeFaces.keys()) {
        const ci = k.indexOf(',');
        const va = +k.slice(0, ci);
        const vb = +k.slice(ci + 1);
        let a = meshVAdj.get(va);
        if (!a) {
          a = new Set();
          meshVAdj.set(va, a);
        }
        a.add(vb);
        let b = meshVAdj.get(vb);
        if (!b) {
          b = new Set();
          meshVAdj.set(vb, b);
        }
        b.add(va);
      }

      // Dijkstra — start→end 까지 mesh edge 경로 (weighted: sharp 우선). 못 찾으면 null.
      //   cost = length × (1 + dotNN²×4). Sharp edge (dotNN→0) 는 cost ≈ length,
      //   Smooth edge (dotNN→1) 는 cost ≈ 5×length. 결과: ridge 따라 path 형성.
      //   VISIT_CAP: 큰 mesh 에서 weighted 거리로 explored 폭증 시 abort → UI freeze 방지.
      const findSurfacePath = (
        start: number,
        end: number,
        maxDist: number
      ): number[] | null => {
        const VISIT_CAP = 10000; // 충분한 탐색 기회 (UI freeze 한계는 여전히 안전 범위)
        const dist = new Map<number, number>();
        const prev = new Map<number, number>();
        dist.set(start, 0);
        const queue: { v: number; d: number }[] = [{ v: start, d: 0 }];
        let visited = 0;
        while (queue.length > 0) {
          if (visited++ > VISIT_CAP) return null;
          let minIdx = 0;
          for (let i = 1; i < queue.length; i++) {
            if (queue[i].d < queue[minIdx].d) minIdx = i;
          }
          const cur = queue.splice(minIdx, 1)[0];
          const v = cur.v;
          const d = cur.d;
          if (v === end) {
            const path: number[] = [end];
            let c: number = end;
            while (c !== start) {
              const p = prev.get(c);
              if (p === undefined) return null;
              path.unshift(p);
              c = p;
            }
            return path;
          }
          if (d > (dist.get(v) ?? Infinity)) continue;
          if (d > maxDist) continue;
          const pV = canonPositions[v];
          if (!pV) continue;
          const adj = meshVAdj.get(v);
          if (!adj) continue;
          for (const nb of adj) {
            const pNb = canonPositions[nb];
            if (!pNb) continue;
            const ek = v < nb ? `${v},${nb}` : `${nb},${v}`;
            const dotNN = edgeDihedral.get(ek) ?? 1.0;
            // dihedral 가중치: sharp(dotNN≈0) → 1.0× , smooth(dotNN≈1) → 5.0×
            const weight = 1 + dotNN * dotNN * 4;
            const nd = d + Vector3.Distance(pV, pNb) * weight;
            if (nd > maxDist) continue;
            if (nd < (dist.get(nb) ?? Infinity)) {
              dist.set(nb, nd);
              prev.set(nb, v);
              queue.push({ v: nb, d: nd });
            }
          }
        }
        return null;
      };

      // 1) Endpoint bridge — degree-1 vertex 쌍 (열린 chain 끝 끼리)
      const endpoints: number[] = [];
      for (const [v, nbs] of compAdj) {
        if (nbs.size === 1) endpoints.push(v);
      }
      if (endpoints.length >= 2) {
        const pairs: { a: number; b: number; d: number }[] = [];
        for (let i = 0; i < endpoints.length; i++) {
          for (let j = i + 1; j < endpoints.length; j++) {
            const a = endpoints[i];
            const b = endpoints[j];
            const pa = canonPositions[a];
            const pb = canonPositions[b];
            if (!pa || !pb) continue;
            const d = Vector3.Distance(pa, pb);
            if (d <= BRIDGE_MAX) pairs.push({ a, b, d });
          }
        }
        pairs.sort((x, y) => x.d - y.d);
        const used = new Set<number>();
        for (const p of pairs) {
          if (used.has(p.a) || used.has(p.b)) continue;
          used.add(p.a);
          used.add(p.b);
          const path = findSurfacePath(p.a, p.b, SURFACE_MAX);
          if (path && path.length >= 2) {
            for (let i = 0; i < path.length - 1; i++) {
              const va = path[i];
              const vb = path[i + 1];
              const pa = canonPositions[va];
              const pb = canonPositions[vb];
              if (!pa || !pb) continue;
              marginCand.push({ va, vb, pa, pb });
              bridgePoints.push(pa.add(pb).scale(0.5));
            }
            surfacePathCount++;
          } else {
            // 직선 폴백 제거 — surface path 못 찾으면 차라리 끊김 유지. 사용자 사진처럼
            //   직선이 마진 외 영역을 가로지르는 사고 차단. straightFallbackCount 는 stat 용으로만.
            straightFallbackCount++;
          }
        }
      }

      // 2) 컴포넌트 간 bridge — 닫힌 loop 등 endpoint 없는 컴포넌트 끼리 잇기.
      //   사용자 시나리오: 사진처럼 위쪽 닫힌 loop + 아래쪽 별도 chain → endpoint 0개 →
      //   기존 endpoint bridge 작동 안 함. 두 컴포넌트의 최근접 vertex 쌍을 surface path 로.
      //   안전: MIN_COMP_VERTS=4 로 단일-edge noise 컴포넌트 배제, INTERCOMP_BRIDGE_MAX=15mm 한계.
      const substantialComps = Array.from(compVertices.entries())
        .filter(([, verts]) => verts.length >= MIN_COMP_VERTS)
        .map(([id]) => id);
      if (substantialComps.length >= 2) {
        type CompPair = { a: number; b: number; va: number; vb: number; d: number };
        const compPairs: CompPair[] = [];
        for (let i = 0; i < substantialComps.length; i++) {
          for (let j = i + 1; j < substantialComps.length; j++) {
            const aVerts = compVertices.get(substantialComps[i]);
            const bVerts = compVertices.get(substantialComps[j]);
            if (!aVerts || !bVerts) continue;
            let bestD = INTERCOMP_BRIDGE_MAX;
            let bestA = -1;
            let bestB = -1;
            for (const va of aVerts) {
              const pa = canonPositions[va];
              if (!pa) continue;
              for (const vb of bVerts) {
                const pb = canonPositions[vb];
                if (!pb) continue;
                const dx = pa.x - pb.x;
                const dy = pa.y - pb.y;
                const dz = pa.z - pb.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < bestD * bestD) {
                  bestD = Math.sqrt(d2);
                  bestA = va;
                  bestB = vb;
                }
              }
            }
            if (bestA >= 0) {
              compPairs.push({
                a: substantialComps[i],
                b: substantialComps[j],
                va: bestA,
                vb: bestB,
                d: bestD,
              });
            }
          }
        }
        // 가까운 컴포넌트 쌍부터 bridge — 이미 연결된 컴포넌트는 건너뜀 (union-find)
        compPairs.sort((x, y) => x.d - y.d);
        const compRoot = new Map<number, number>();
        for (const id of substantialComps) compRoot.set(id, id);
        const findRoot = (id: number): number => {
          let r = id;
          while (compRoot.get(r) !== r) r = compRoot.get(r) as number;
          let c = id;
          while (compRoot.get(c) !== r) {
            const next = compRoot.get(c) as number;
            compRoot.set(c, r);
            c = next;
          }
          return r;
        };
        for (const cp of compPairs) {
          const ra = findRoot(cp.a);
          const rb = findRoot(cp.b);
          if (ra === rb) continue; // 이미 같은 union → bridge 중복
          const path = findSurfacePath(cp.va, cp.vb, INTERCOMP_SURFACE_MAX);
          if (path && path.length >= 2) {
            for (let k = 0; k < path.length - 1; k++) {
              const va = path[k];
              const vb = path[k + 1];
              const pa = canonPositions[va];
              const pb = canonPositions[vb];
              if (!pa || !pb) continue;
              marginCand.push({ va, vb, pa, pb });
              bridgePoints.push(pa.add(pb).scale(0.5));
            }
            interCompPathCount++;
            compRoot.set(ra, rb);
          }
        }
      }
    }

    // 마진 점 — 자동 서포트 가드 거리 판정용.
    //   마진 라인 segment 따라 0.2mm 간격으로 dense sampling → sphere tip 이 segment
    //   사이 빈 공간으로 빠져 마진 라인을 가로지르는 케이스 방지. 가드는 마진 점에서
    //   (0.5mm + sphereR) 거리로 검사되므로 점이 빽빽해야 정확.
    const marginPoints: Vector3[] = [];
    const MARGIN_SAMPLE_STEP = 0.2; // mm
    for (const e of marginCand) {
      const dx = e.pb.x - e.pa.x;
      const dy = e.pb.y - e.pa.y;
      const dz = e.pb.z - e.pa.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const n = Math.max(1, Math.ceil(len / MARGIN_SAMPLE_STEP));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        marginPoints.push(
          new Vector3(e.pa.x + dx * t, e.pa.y + dy * t, e.pa.z + dz * t)
        );
      }
    }

    // 교합면(외면) — 색칠된 삼각형들의 평균 Y 이하 (대략적 가드용)
    let sumY = 0;
    let cnt = 0;
    for (const t of tris) {
      if (paintedSet.has(t.faceIndex)) {
        sumY += t.centroid.y;
        cnt++;
      }
    }
    const yMargin = cnt > 0 ? sumY / cnt : 0;
    const occlusalFaces = new Set<number>();
    for (const t of tris) {
      if (t.centroid.y < yMargin + 0.2) occlusalFaces.add(t.faceIndex);
    }

    // 결과 저장 + 옅은 선으로 시각화
    // 마진 엣지 키 (canonical) — floodfill 차단용
    const edgeKeys = new Set<string>();
    for (const e of marginCand) {
      edgeKeys.add(e.va < e.vb ? `${e.va},${e.vb}` : `${e.vb},${e.va}`);
    }
    marginRef.current = {
      stlId,
      points: marginPoints,
      occlusalFaces,
      edgeKeys,
      canon,
      canonPositions,
      bridgePoints,
    };
    marginMarkersRef.current = marginMarkersRef.current.filter((m) => {
      if (m.metadata?.stlId === stlId) {
        m.dispose();
        return false;
      }
      return true;
    });
    // 마진 라인 — 각 세그먼트를 얇은 튜브로 만들고 merge 해서 두께 표현.
    //   WebGL LineSystem 은 thickness 가 1px 고정이라 두꺼운 선 표현 불가 →
    //   3D 튜브로 대체. 모델과 같은 렌더링 그룹 + 깊이 검사로 투과 없이 표시.
    const tubeBatch: Mesh[] = [];
    for (const e of marginCand) {
      const len = Vector3.Distance(e.pa, e.pb);
      if (len < 1e-6) continue;
      const tube = MeshBuilder.CreateTube(
        'marginSeg',
        {
          path: [e.pa, e.pb],
          radius: 0.025, // ≈ 0.05mm 두께 (절반)
          tessellation: 6,
          cap: Mesh.NO_CAP,
        },
        scene
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
        false
      );
      if (marginMesh) {
        marginMesh.name = 'marginLines';
        marginMesh.isPickable = false;
        marginMesh.renderingGroupId = 0;
        marginMesh.metadata = { stlId };
        const mat = new StandardMaterial('marginMat', scene);
        mat.emissiveColor = new Color3(0.2, 1, 0.4);
        mat.diffuseColor = new Color3(0, 0, 0);
        mat.disableLighting = true;
        marginMesh.material = mat;
        marginMesh.setParent(mesh);
        marginMarkersRef.current.push(marginMesh);
      }
    }

    console.log(
      `[마진 찾기] 색칠 ${paintedSet.size}면 · 시드 엣지 ${seedKeys.size} · ` +
        `전역 sharp 엣지 ${allKeys.size} · 마진 엣지 ${marginCand.length} (spur-trim + corner-ext 후) · ` +
        `corner extension ${cornerExtSteps}스텝 · 작은-컴포넌트 폐기 ${droppedTinyComps}엣지 · ` +
        `endpoint bridge ${surfacePathCount}쌍(${bridgePoints.length}세그) · 직선폴백 ${straightFallbackCount}쌍 · ` +
        `컴포넌트 간 bridge ${interCompPathCount}쌍 ` +
        `(painted≥${SHARP_DEG_PAINTED}°, global≥${SHARP_DEG_GLOBAL}°, dir≤${DIR_TOL_DEG}° (corner-ext ≤150° + dihedral ≥30°), ` +
        `spur≤${SPUR_MAX}mm, tiny-comp ≤1.5mm 폐기, region R=${SEED_REGION_R.toFixed(1)}mm, ` +
        `endpoint bridge≤12mm/weighted≤54, 컴포넌트 bridge≤15mm/weighted≤67.5, MIN_COMP=2, sharp-weighted Dijkstra)`
    );
  }, [findMarginSignal]);

  /**
   * 선택 영역 자동 서포트 생성 — '자동 각도 조절 실행' 하위 버튼
   *   ① 색칠한(주황) 영역만 100% 탐색해 미지지 지오메트리를 찾는다.
   *   ② 색칠한 영역이 플레이트를 마주보도록 회전 — 평균 법선을 (0,-1,0)으로
   *      보낸 뒤 ±15° 범위에서 미지지 면 개수가 최소가 되도록 비틀린다.
   *   ③ 색칠 영역 외엔 서포트가 절대 생성·침범되지 않도록 face filter.
   *   ④ 마진 반경 0.5mm 안엔 서포트 금지 (일반 서포트 가드 1mm 보다 좁힘).
   */
  useEffect(() => {
    if (scopedSupportSignal === 0) return;
    const scene = sceneRef.current;
    if (!scene) return;

    let stlId = selectedFileIds[0];
    if (!stlId) {
      const ids = Array.from(meshMapRef.current.keys());
      if (ids.length > 0) stlId = ids[0];
    }
    if (!stlId) {
      console.warn('선택 영역 자동 서포트: 대상 STL이 없습니다.');
      return;
    }
    const mesh = meshMapRef.current.get(stlId);
    if (!mesh) return;

    // ===== 색칠 면 수집 (autoFill + mask) =====
    const trisBefore = readWorldTriangles(mesh);
    if (trisBefore.length === 0) {
      console.warn('선택 영역 자동 서포트: 분석할 삼각형이 없습니다.');
      return;
    }
    const paintedFaces = new Set<number>();
    let pnx = 0;
    let pny = 0;
    let pnz = 0;
    let pArea = 0;
    for (const t of trisBefore) {
      if (!isMasked(t.centroid, t.normal, t.faceIndex)) continue;
      paintedFaces.add(t.faceIndex);
      pnx += t.normal.x * t.area;
      pny += t.normal.y * t.area;
      pnz += t.normal.z * t.area;
      pArea += t.area;
    }
    if (paintedFaces.size === 0 || pArea < 1e-6) {
      console.warn(
        '선택 영역 자동 서포트: 색칠한 영역이 없습니다. 먼저 브러쉬로 영역을 지정하거나 마진 안쪽을 더블클릭하세요.'
      );
      return;
    }
    const paintN = new Vector3(pnx, pny, pnz).normalize();

    // ===== 색칠 영역이 플레이트를 마주보게 회전 (평균 법선 → -Y) =====
    const down = new Vector3(0, -1, 0);
    const d0 = Math.max(-1, Math.min(1, Vector3.Dot(paintN, down)));
    let qBase: Quaternion;
    if (d0 > 0.99999) {
      qBase = Quaternion.Identity();
    } else if (d0 < -0.99999) {
      qBase = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
    } else {
      qBase = Quaternion.RotationAxis(
        Vector3.Cross(paintN, down).normalize(),
        Math.acos(d0)
      );
    }

    // ===== 자동 각도 조정 — brush 영역 안 island 면적이 최소가 되는 q 채택 =====
    //   사용자 요구: 색칠 영역의 island 면적(=서포트 필요 면적) 최소화 각도 선택.
    //   qBase (paintN → -Y) 를 기점으로 X·Z 축 ±15° 비틀기 (13 후보).
    //   각 후보마다 **전체 tri 회전** + detectSliceIslands 호출 (global connectivity) →
    //   결과 island face 중 painted 와 교집합인 것의 **면적 합산** 을 metric.
    //   cellSize/layerHeight 0.1mm — 평가 단계 coarse 라 비용 절감.
    const evalSettings = supportSettingsRef.current;
    const faceIndexToTri = new Map<number, TriInfo>();
    for (const t of trisBefore) faceIndexToTri.set(t.faceIndex, t);
    const evalQ = (q: Quaternion): number => {
      const m = new Matrix();
      q.toRotationMatrix(m);
      const rotated: TriInfo[] = [];
      let minY = Infinity;
      // 전체 tri 회전 (painted-only 제한 제거 — connectivity 분석을 global 과 일치)
      for (const t of trisBefore) {
        const v0 = Vector3.TransformCoordinates(t.v0, m);
        const v1 = Vector3.TransformCoordinates(t.v1, m);
        const v2 = Vector3.TransformCoordinates(t.v2, m);
        const centroid = Vector3.TransformCoordinates(t.centroid, m);
        const normal = Vector3.TransformNormal(t.normal, m).normalize();
        if (v0.y < minY) minY = v0.y;
        if (v1.y < minY) minY = v1.y;
        if (v2.y < minY) minY = v2.y;
        rotated.push({ ...t, v0, v1, v2, centroid, normal });
      }
      if (rotated.length === 0 || !Number.isFinite(minY)) return Infinity;
      for (const t of rotated) {
        t.v0.y -= minY;
        t.v1.y -= minY;
        t.v2.y -= minY;
        t.centroid.y -= minY;
      }
      try {
        const r = detectSliceIslands({
          tris: rotated,
          cellSize: 0.1,
          layerHeight: 0.1,
          supportAngle: evalSettings.supportAngle,
          downFacingOnly: true,
          minIslandCells: 1, // 슬라이스 sim 미지지 정의 일치 — 1-cell 떨어진 piece 도 포착
          plateGap: 0, // plate 인접 layer 도 island 검출 (낮은 Y 의 piece 도 포착)
        });
        // brush 영역 island 면적 합산 — face area sum (rotation 무관, trisBefore.area 사용)
        let areaSum = 0;
        for (const f of r.islandFaces) {
          if (!paintedFaces.has(f)) continue;
          const t = faceIndexToTri.get(f);
          if (t) areaSum += t.area;
        }
        return areaSum;
      } catch {
        return Infinity;
      }
    };
    let qBest = qBase;
    let cBest = evalQ(qBase);
    for (const ax of [new Vector3(1, 0, 0), new Vector3(0, 0, 1)]) {
      for (let deg = -15; deg <= 15; deg += 5) {
        if (deg === 0) continue;
        const qt = Quaternion.RotationAxis(ax, (deg * Math.PI) / 180).multiply(
          qBase
        );
        const c = evalQ(qt);
        if (c < cBest) {
          cBest = c;
          qBest = qt;
        }
      }
    }
    console.log(
      `[선택 영역 자동 서포트] 자동 각도 — brush island 면적 ${cBest.toFixed(2)}mm² 으로 최소화 (후보 13개 평가)`
    );

    // 자동 회전 비활성화 — 사용자 요구: island 검출 disc 위치와 support 위치 일치.
    //   자동 회전을 적용하면 회전 후 detectSliceIslands 결과가 달라져 disc(회전 이전 결과)
    //   와 support(회전 이후 결과) 위치가 어긋남. 회전 안 함으로써 현재 mesh 상태 그대로
    //   detection → support → disc 와 동일 좌표.
    //   평가 로그(brush island 면적)는 진단용으로 위에 유지.
    const rotChanged = false;
    void qBest;

    // ===== 같은 STL 의 기존 서포트 제거 (재생성 시 중복 방지) =====
    supportsRef.current = supportsRef.current.filter((s) => {
      if (s.metadata?.stlId === stlId) {
        s.dispose();
        return false;
      }
      return true;
    });

    // ===== 회전 후 — 색칠 영역만 대상 서포트 생성 =====
    mesh.createOrUpdateSubmeshesOctree(64, 2);
    const onlyModel = (m: { uniqueId: number }) => m === mesh;
    const settings = supportSettingsRef.current;
    const footDia = settings.tipBottomDiameter * 1.5;
    const PLATE_GAP = 0.5;
    const CLEAR_MIN = 1.5;
    // 색칠 영역 내부 mandatory 시드 간 최소거리 — supporter 탭의 '터치 팁 거리' 적용.
    //   하한은 footDia*1.2 (서포트 발이 겹치지 않는 최소거리) 로 보호.
    const PRIMARY_SPACING = Math.max(settings.touchTipDistance, footDia * 1.2, 2);

    // ===== Brush(painted) 영역 검증 — 시드 이동 후 painted face 위인지 확인 =====
    //   사용자 요구: 마진 침범 시 "브러쉬 영역 내에서" 0.5mm 떨어진 점으로 이동.
    //   수직 raycast 로 그 XZ 가 painted 면을 hit 하는지 검사. hit 면 Y 보정 + 통과,
    //   아니면 시드 폐기.
    mesh.refreshBoundingInfo();
    const meshYMax = mesh.getBoundingInfo().boundingBox.maximumWorld.y;
    const verifyOnPaintedXZ = (x: number, z: number): number | null => {
      const ray = new Ray(
        new Vector3(x, meshYMax + 2, z),
        new Vector3(0, -1, 0),
        meshYMax + 10
      );
      const hits = scene.multiPickWithRay(ray, onlyModel);
      if (!hits) return null;
      for (const h of hits) {
        if (
          h.hit &&
          h.faceId !== undefined &&
          paintedFaces.has(h.faceId) &&
          h.pickedPoint
        ) {
          return h.pickedPoint.y;
        }
      }
      return null;
    };

    const tris = readWorldTriangles(mesh);
    // 색칠 면 집합 — face 인덱스는 회전 후에도 동일
    const isPainted = (faceIdx: number): boolean => paintedFaces.has(faceIdx);

    // ===== 마진 가드 (0.5mm — 서포트 몸통 반경까지 포함하여 비침범) =====
    const MARGIN_GUARD = 0.5;
    const marginCache =
      marginRef.current && marginRef.current.stlId === stlId
        ? marginRef.current
        : null;
    const marginPoints: Vector3[] = marginCache ? marginCache.points : [];
    const MG_CELL = Math.max(MARGIN_GUARD, 0.5);
    const mgGrid = new Map<string, Vector3[]>();
    for (const m of marginPoints) {
      // 마진 점도 모델과 같이 회전했으므로 현재 월드 좌표 그대로 사용
      const k = `${Math.floor(m.x / MG_CELL)},${Math.floor(m.z / MG_CELL)}`;
      let arr = mgGrid.get(k);
      if (!arr) {
        arr = [];
        mgGrid.set(k, arr);
      }
      arr.push(m);
    }
    // 서포트 몸통 반경 — 마진/서포트가 서로 침범하지 않게 가드에 더해 사용
    const bodyR = settings.tipBottomDiameter;
    // 마진 가드 검사: 점 p 에서 임의 반경 r 가 마진 0.5mm 안으로 침범하는가
    //   → 마진까지 거리 < (MARGIN_GUARD + r). XZ 평면 거리만 본다(서포트 발은 수직).
    const isNearMarginXZ = (p: Vector3, r = 0): boolean => {
      const limit = MARGIN_GUARD + r;
      const limit2 = limit * limit;
      const cells = Math.ceil(limit / MG_CELL);
      const cx = Math.floor(p.x / MG_CELL);
      const cz = Math.floor(p.z / MG_CELL);
      for (let dx = -cells; dx <= cells; dx++) {
        for (let dz = -cells; dz <= cells; dz++) {
          const arr = mgGrid.get(`${cx + dx},${cz + dz}`);
          if (!arr) continue;
          for (const mp of arr) {
            const ax = mp.x - p.x;
            const az = mp.z - p.z;
            if (ax * ax + az * az < limit2) return true;
          }
        }
      }
      return false;
    };
    // 마진 가드 검사 (segment 버전): segment A→B 가 XZ 평면에서 마진 점에 대해
    //   반경 (MARGIN_GUARD + r) 이내로 접근하는가. 서포트 튜브 전체 경로가
    //   마진을 침범·관통하는 것을 막는다(점·반경 검사로는 segment 중간 누락).
    const segmentNearMarginXZ = (A: Vector3, B: Vector3, r = 0): boolean => {
      if (marginPoints.length === 0) return false;
      const limit = MARGIN_GUARD + r;
      const limit2 = limit * limit;
      const ax = A.x;
      const az = A.z;
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const segLen2 = dx * dx + dz * dz;
      if (segLen2 < 1e-9) return isNearMarginXZ(A, r);
      const xLo = Math.min(A.x, B.x) - limit;
      const xHi = Math.max(A.x, B.x) + limit;
      const zLo = Math.min(A.z, B.z) - limit;
      const zHi = Math.max(A.z, B.z) + limit;
      const cxLo = Math.floor(xLo / MG_CELL);
      const cxHi = Math.floor(xHi / MG_CELL);
      const czLo = Math.floor(zLo / MG_CELL);
      const czHi = Math.floor(zHi / MG_CELL);
      for (let cx = cxLo; cx <= cxHi; cx++) {
        for (let cz = czLo; cz <= czHi; cz++) {
          const arr = mgGrid.get(`${cx},${cz}`);
          if (!arr) continue;
          for (const m of arr) {
            // 점 m 의 segment AB 에 대한 XZ 평면 투영 거리
            let tt = ((m.x - ax) * dx + (m.z - az) * dz) / segLen2;
            if (tt < 0) tt = 0;
            else if (tt > 1) tt = 1;
            const px = ax + dx * tt;
            const pz = az + dz * tt;
            const ex = m.x - px;
            const ez = m.z - pz;
            if (ex * ex + ez * ez < limit2) return true;
          }
        }
      }
      return false;
    };

    // 빠르게 드랍 — 받쳐주는 면 (윗면) 까지 수직 거리
    const dropDistance = (p: Vector3): number => {
      const ray = new Ray(
        new Vector3(p.x, p.y - 0.05, p.z),
        new Vector3(0, -1, 0),
        p.y
      );
      const hits = scene.multiPickWithRay(ray, onlyModel);
      if (hits && hits.length > 0) {
        const sorted = hits
          .filter((h) => h.hit && h.distance > 0.15)
          .sort((a, b) => a.distance - b.distance);
        for (const h of sorted) {
          const n = h.getNormal(true, true);
          if (n && n.y > 0.2) return h.distance + 0.05;
        }
      }
      return p.y;
    };

    // ===== LCD/DLP 미지지 지오메트리 탐색 (색칠 영역, 100%) =====
    //   업계 표준 기준 — 다음 중 하나라도 만족하면 '반드시 지지' (mandatory):
    //   ① True Island  : 슬라이스 단면에서 새로 등장한 분리된 영역.
    //                     (=이전 레이어와 connected 가 아님 → 공중 시작)
    //   ② Local Y Min  : XZ 반경 ISLAND_R 안에서 그 색칠 면의 centroid 가
    //                     가장 낮음 (drop>=CLIFF_DROP 가 추가 보장)
    //   ③ Overhang Tip : 다운페이싱 면 + 아래로 떨어지는 거리 > BIG_DROP
    //                     (단지 받침 없는 '천장' → 박리력 큼)
    //   ④ Steep Overhang: n.y < -cos(35°) + drop > CLEAR_MIN
    //                     (LCD/DLP 통상 임계 35° — 보수적 기준)
    //   mandatory 가 아니지만 '일반 다운페이싱'은 일단 보류(보조 서포트 비활성)
    const COS_OH_STRICT = Math.cos((35 * Math.PI) / 180); // 35° — LCD/DLP 보수 임계
    const CLIFF_DROP = 1.2; // mm — 자체 지지 아닌 drop
    const BIG_DROP = 3.0; // mm — 박리력 큰 천장
    const ISLAND_R = 2.0; // mm — local min 판정 반경
    const ISLAND_R2 = ISLAND_R * ISLAND_R;

    // XZ 그리드 — 색칠 면 centroid 빠른 인접 검색 (local min 판정)
    const PT_CELL = ISLAND_R;
    const paintedGrid = new Map<string, { y: number; idx: number }[]>();
    const paintedTriIdx: number[] = [];
    for (let i = 0; i < tris.length; i++) {
      const t = tris[i];
      if (!isPainted(t.faceIndex)) continue;
      paintedTriIdx.push(i);
      const k = `${Math.floor(t.centroid.x / PT_CELL)},${Math.floor(t.centroid.z / PT_CELL)}`;
      let arr = paintedGrid.get(k);
      if (!arr) {
        arr = [];
        paintedGrid.set(k, arr);
      }
      arr.push({ y: t.centroid.y, idx: i });
    }
    const isLocalYMin = (c: Vector3): boolean => {
      const cx = Math.floor(c.x / PT_CELL);
      const cz = Math.floor(c.z / PT_CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = paintedGrid.get(`${cx + dx},${cz + dz}`);
          if (!arr) continue;
          for (const e of arr) {
            if (e.y >= c.y - 0.25) continue; // 같거나 더 높으면 무시 (0.25 노이즈)
            const tri = tris[e.idx];
            const ax = tri.centroid.x - c.x;
            const az = tri.centroid.z - c.z;
            if (ax * ax + az * az < ISLAND_R2) return false; // 이웃이 더 낮음
          }
        }
      }
      return true;
    };

    // ===== Slice island 탐색 — ChiTuBox / Cura 동일 로직 =====
    //
    // 표준 슬라이서 (ChiTuBox, Cura, PrusaSlicer ...) 의 island 판정:
    //  ① 모델을 layerHeight 간격으로 슬라이스 → 각 레이어의 2D 단면 폴리곤.
    //  ② 각 레이어에서 폴리곤의 연결 성분(connected component) 을 찾는다.
    //  ③ 한 컴포넌트가 직하 레이어의 어떤 컴포넌트와도 교차/접하지 않으면
    //     = '새로 등장한' 영역 → ISLAND → 컴포넌트 전체에 mandatory support.
    //  ④ 최하단 레이어는 (= 색칠 영역의 첫 등장) 모든 컴포넌트가 island.
    //
    // 핵심 차이 (이전 cell-기반 검사 → 컴포넌트-기반):
    //  · 큰 영역의 한 모서리가 살짝 비어도(직하에 셀 없음) island 가 아님 —
    //    그 컴포넌트의 다른 셀이 이미 직하에 연결돼 있다면 단순 오버행.
    //  · 반대로 작은 finger 가 분리돼 새로 등장하면 전체가 island.
    //
    // 슬라이서 표준값:
    //  · layerHeight 0.05mm (LCD/DLP)
    //  · XY pixel 0.05mm (4K~8K LCD 일반치)
    //  · 인접도 4-connectivity (정사각 셀 = 픽셀 단위 폴리곤 근사)
    // ===== Slice island 탐색 — global "Island 검출 (전체 모델)" 과 동일 알고리즘 =====
    //   faceFilter 없이 전체 모델 island 검출 → connectivity 가 global 과 일치.
    //   결과를 painted face 와 교집합 → brush 영역 island 만 시드 후보.
    const sliceResult = detectSliceIslands({
      tris,
      cellSize: sliceLayerHeight,
      layerHeight: sliceLayerHeight,
      supportAngle: settings.supportAngle,
      downFacingOnly: true,
      minIslandCells: 1, // 슬라이스 sim 미지지 정의 일치 — 1-cell 떨어진 piece 도 포착
      plateGap: 0, // plate 인접 layer 도 island 검출 (낮은 Y 의 piece 도 포착)
    });
    const globalIslandSize = sliceResult.islandFaces.size;
    const sliceIslandFaces = new Set<number>();
    for (const f of sliceResult.islandFaces) {
      if (paintedFaces.has(f)) sliceIslandFaces.add(f);
    }
    if (false) {
      const SLICE = 0.05;
      const CELL2 = 0.05;
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const idx of paintedTriIdx) {
        const lo = Math.min(tris[idx].v0.y, tris[idx].v1.y, tris[idx].v2.y);
        const hi = Math.max(tris[idx].v0.y, tris[idx].v1.y, tris[idx].v2.y);
        if (lo < yMin) yMin = lo;
        if (hi > yMax) yMax = hi;
      }
      const nSlices = Math.max(2, Math.ceil((yMax - yMin) / SLICE) + 1);

      // 각 레이어의 occupancy + (faceIndex → 그 face 가 stamp 된 cells)
      const sliceCells: Set<string>[] = new Array(nSlices);
      const sliceFaceCells: { faceIndex: number; cell: string }[][] = new Array(
        nSlices
      );
      for (let i = 0; i < nSlices; i++) {
        sliceCells[i] = new Set();
        sliceFaceCells[i] = [];
      }

      // 각 tri 를 그 Y 범위에 걸친 모든 레이어에 rasterize.
      //   삼각형의 z=z_L 평면과의 교차선(line segment)을 정확히 계산해
      //   그 segment 위 셀만 stamp 한다.
      //   bbox stamp 대비 false-positive 셀이 없어, 직하 컴포넌트와의 4-인접
      //   체크에서 잘못된 "연결" 이 사라져 island 누락이 줄어든다.
      const stampSegment = (
        sIdx: number,
        ax: number,
        az: number,
        bx: number,
        bz: number,
        faceIndex: number
      ): void => {
        const dx = bx - ax;
        const dz = bz - az;
        const lenC = Math.max(Math.abs(dx), Math.abs(dz)) / (CELL2 * 0.5);
        const steps = Math.max(1, Math.ceil(lenC));
        let prevKey = '';
        for (let k = 0; k <= steps; k++) {
          const tt = k / steps;
          const px = ax + dx * tt;
          const pz = az + dz * tt;
          const cx = Math.floor(px / CELL2);
          const cz = Math.floor(pz / CELL2);
          const key = `${cx},${cz}`;
          if (key === prevKey) continue;
          prevKey = key;
          sliceCells[sIdx].add(key);
          sliceFaceCells[sIdx].push({ faceIndex, cell: key });
        }
      };
      for (const idx of paintedTriIdx) {
        const t = tris[idx];
        const lo = Math.min(t.v0.y, t.v1.y, t.v2.y);
        const hi = Math.max(t.v0.y, t.v1.y, t.v2.y);
        const sLo = Math.max(0, Math.floor((lo - yMin) / SLICE));
        const sHi = Math.min(nSlices - 1, Math.ceil((hi - yMin) / SLICE));
        // 삼각형이 z 평면(Y=zL)과 거의 평행 → bbox stamp 폴백 (드문 케이스)
        const triAlmostHorizontal = hi - lo < SLICE * 0.5;
        if (triAlmostHorizontal) {
          const xLo = Math.min(t.v0.x, t.v1.x, t.v2.x);
          const xHi = Math.max(t.v0.x, t.v1.x, t.v2.x);
          const zLo = Math.min(t.v0.z, t.v1.z, t.v2.z);
          const zHi = Math.max(t.v0.z, t.v1.z, t.v2.z);
          const cxLo = Math.floor(xLo / CELL2);
          const cxHi = Math.floor(xHi / CELL2);
          const czLo = Math.floor(zLo / CELL2);
          const czHi = Math.floor(zHi / CELL2);
          for (let s = sLo; s <= sHi; s++) {
            for (let cx = cxLo; cx <= cxHi; cx++) {
              for (let cz = czLo; cz <= czHi; cz++) {
                const key = `${cx},${cz}`;
                sliceCells[s].add(key);
                sliceFaceCells[s].push({ faceIndex: t.faceIndex, cell: key });
              }
            }
          }
          continue;
        }
        // 일반 케이스: 각 레이어 z=zL 에서 삼각형 평면 교차선 계산
        const vs: Vector3[] = [t.v0, t.v1, t.v2];
        for (let s = sLo; s <= sHi; s++) {
          const zL = yMin + s * SLICE;
          const pts: { x: number; z: number }[] = [];
          for (let e = 0; e < 3; e++) {
            const a = vs[e];
            const b = vs[(e + 1) % 3];
            // edge 양 끝의 y 부호로 평면 가로지름 판정 (>= 일관 사용)
            const ay = a.y - zL;
            const by = b.y - zL;
            if (ay === 0 && by === 0) continue; // edge 가 평면 위 → 다음 케이스에서 잡힘
            if ((ay >= 0 && by >= 0) || (ay <= 0 && by <= 0)) {
              if (ay === 0) pts.push({ x: a.x, z: a.z });
              else if (by === 0) pts.push({ x: b.x, z: b.z });
              continue;
            }
            const tt = ay / (ay - by); // 0..1
            pts.push({ x: a.x + (b.x - a.x) * tt, z: a.z + (b.z - a.z) * tt });
          }
          if (pts.length < 2) continue;
          // 보통 2점, 드물게 3점(꼭짓점이 평면 위) → 첫 두 점 사용으로 충분
          stampSegment(s, pts[0].x, pts[0].z, pts[1].x, pts[1].z, t.faceIndex);
        }
      }

      // 4-연결 컴포넌트 라벨링 — Set<cellKey> 를 받아 cellKey → label 맵 반환.
      const labelComponents = (cells: Set<string>): Map<string, number> => {
        const lab = new Map<string, number>();
        let next = 0;
        const queue: string[] = [];
        for (const seed of cells) {
          if (lab.has(seed)) continue;
          next++;
          lab.set(seed, next);
          queue.length = 0;
          queue.push(seed);
          while (queue.length > 0) {
            const k = queue.pop()!;
            const ci = k.indexOf(',');
            const cx = +k.slice(0, ci);
            const cz = +k.slice(ci + 1);
            const nbrs = [
              `${cx + 1},${cz}`,
              `${cx - 1},${cz}`,
              `${cx},${cz + 1}`,
              `${cx},${cz - 1}`,
            ];
            for (const nk of nbrs) {
              if (cells.has(nk) && !lab.has(nk)) {
                lab.set(nk, next);
                queue.push(nk);
              }
            }
          }
        }
        return lab;
      };

      // === 자체지지 한계 — supporter 탭 'supportAngle' 에서 파생 ===
      //   layer L 의 polygon 이 직하 polygon 으로부터 max d_safe = layerHeight × tan(angle)
      //   이내에 있으면 자체지지로 본다 (표준 슬라이서 정의와 동등).
      //   여기선 cell grid 라 두 가지로 환산:
      //     · prev 로 합칠 직하 layer 수 = max(1, ceil(d_safe_vertical / SLICE))
      //       (수직으로 얼마나 깊이까지 받쳐주는 것으로 인정할지)
      //     · cell 인접 반경 r_cell = ceil(d_safe_horizontal / CELL2)
      //       (XZ 평면에서 cell 몇 칸까지 확장해서 직하와 비교할지)
      //   45° 인 경우: d_safe = 0.05mm → 1 layer + 1 cell 인접 = 표준 정확치.
      //   30° 인 경우: d_safe = 0.029mm → 1 layer + 1 cell 인접 (cell 최소 1).
      //   60° 인 경우: d_safe = 0.087mm → 2 layer + 2 cell.
      const ssAngleRad = (settings.supportAngle * Math.PI) / 180;
      const dSafe = SLICE * Math.tan(ssAngleRad); // mm
      const prevLayers = Math.max(1, Math.ceil(dSafe / SLICE));
      const cellAdjR = Math.max(1, Math.ceil(dSafe / CELL2));

      // 컴포넌트가 직하 영역(prev) 과 닿는가? — 그 컴포넌트의 어떤 cell 이라도
      //   prev cells 와 동일 또는 cellAdjR 이내 거리(Chebyshev) 면 '지지받음(연결)'.
      //   cellAdjR = 1 이면 4-인접과 동등 (표준 supportAngle ≈ 45° 케이스).
      const isComponentConnected = (
        compCells: string[],
        prevCells: Set<string>
      ): boolean => {
        for (const k of compCells) {
          if (prevCells.has(k)) return true;
          const ci = k.indexOf(',');
          const cx = +k.slice(0, ci);
          const cz = +k.slice(ci + 1);
          for (let dx = -cellAdjR; dx <= cellAdjR; dx++) {
            for (let dz = -cellAdjR; dz <= cellAdjR; dz++) {
              if (dx === 0 && dz === 0) continue;
              if (prevCells.has(`${cx + dx},${cz + dz}`)) return true;
            }
          }
        }
        return false;
      };

      // 레이어를 아래에서 위로 순회 — 컴포넌트 단위로 island 판정.
      for (let i = 0; i < nSlices; i++) {
        const cur = sliceCells[i];
        if (cur.size === 0) continue;
        const labels = labelComponents(cur);
        // 라벨별 cells
        const compCells = new Map<number, string[]>();
        for (const [k, lb] of labels) {
          let arr = compCells.get(lb);
          if (!arr) {
            arr = [];
            compCells.set(lb, arr);
          }
          arr.push(k);
        }
        // 직하 prevLayers 레이어 cells 합집합 (supportAngle 에서 파생)
        const prev = new Set<string>();
        for (let k = 1; k <= prevLayers && i - k >= 0; k++) {
          for (const c of sliceCells[i - k]) prev.add(c);
        }
        // island 컴포넌트의 cell 집합 — face stamping 매핑에 사용
        const islandCellSet = new Set<string>();
        for (const [, cellsOfComp] of compCells) {
          if (isComponentConnected(cellsOfComp, prev)) continue;
          // 이 컴포넌트는 island — 모든 cell 을 모은다
          for (const c of cellsOfComp) islandCellSet.add(c);
        }
        if (islandCellSet.size === 0) continue;
        // 이 레이어에 stamp 된 face 중 island cell 에 속하는 것 → mandatory
        for (const fc of sliceFaceCells[i]) {
          if (islandCellSet.has(fc.cell)) sliceIslandFaces.add(fc.faceIndex);
        }
      }
    }

    // ===== 시드 수집 — paintedTriIdx 순회 + sliceIslandFaces (=global∩painted) 필터 =====
    //   각 painted+island 면이 시드. PRIMARY_SPACING clustering 으로 1 component 당
    //   대략 1 support 로 수렴 → 사용자가 본 disc 와 거의 1:1.
    type Seed = { point: Vector3; normal: Vector3; reason: string };
    const seeds: Seed[] = [];
    let nDownFaces = 0;
    for (const idx of paintedTriIdx) {
      const t = tris[idx];
      if (t.centroid.y < PLATE_GAP) continue; // 플레이트 접촉

      const isDownFacing = t.normal.y < -COS_OH_STRICT; // 35° 임계
      if (!isDownFacing) continue;
      nDownFaces++;

      // 시드는 slice-island 만
      if (!sliceIslandFaces.has(t.faceIndex)) continue;

      // 마진 가드 — 30회 perpendicular push, 통과 못 하면 폐기
      const minDist = MARGIN_GUARD + bodyR;
      const minDist2 = minDist * minDist;
      let seedPt: Vector3 | null = t.centroid.clone();
      const MAX_PUSH = 30;
      for (let pi = 0; pi < MAX_PUSH; pi++) {
        let worstMP: Vector3 | null = null;
        let worstD2 = minDist2;
        for (const mp of marginPoints) {
          const dxm = mp.x - seedPt.x;
          const dzm = mp.z - seedPt.z;
          const d2 = dxm * dxm + dzm * dzm;
          if (d2 < worstD2) {
            worstD2 = d2;
            worstMP = mp;
          }
        }
        if (!worstMP) break;
        const dxm = seedPt.x - worstMP.x;
        const dzm = seedPt.z - worstMP.z;
        const d = Math.sqrt(worstD2);
        if (d > 1e-6) {
          seedPt = new Vector3(
            worstMP.x + (dxm / d) * minDist,
            seedPt.y,
            worstMP.z + (dzm / d) * minDist
          );
        } else {
          seedPt = null;
          break;
        }
      }
      if (seedPt) {
        for (const mp of marginPoints) {
          const dxm = mp.x - seedPt.x;
          const dzm = mp.z - seedPt.z;
          if (dxm * dxm + dzm * dzm < minDist2) {
            seedPt = null;
            break;
          }
        }
      }
      if (!seedPt) continue;

      // 이동 후 brush 영역 검증
      const moved =
        Math.abs(seedPt.x - t.centroid.x) > 1e-6 ||
        Math.abs(seedPt.z - t.centroid.z) > 1e-6;
      if (moved) {
        const newY = verifyOnPaintedXZ(seedPt.x, seedPt.z);
        if (newY === null) continue;
        seedPt = new Vector3(seedPt.x, newY, seedPt.z);
      }

      seeds.push({ point: seedPt, normal: t.normal, reason: 'slice-island' });
    }

    // ===== 서포트 생성 헬퍼 — generateSupportsSignal 과 동일한 라우팅 =====
    const segmentClear = (
      from: Vector3,
      to: Vector3,
      radius: number
    ): boolean => {
      const v = to.subtract(from);
      const len = v.length();
      if (len < 1e-4) return true;
      const dir = v.scale(1 / len);
      let u = Vector3.Cross(dir, new Vector3(0, 1, 0));
      if (u.lengthSquared() < 1e-6) u = Vector3.Cross(dir, new Vector3(1, 0, 0));
      u.normalize();
      const w = Vector3.Cross(dir, u).normalize();
      const offs = [
        Vector3.Zero(),
        u.scale(radius),
        u.scale(-radius),
        w.scale(radius),
        w.scale(-radius),
      ];
      for (const o of offs) {
        if (scene.pickWithRay(new Ray(from.add(o), dir, len), onlyModel)?.hit) {
          return false;
        }
      }
      return true;
    };

    const MANDATORY_COLOR = new Color3(0.05, 0.25, 0.75); // 찐한 파랑

    const makeSupportAt = (point: Vector3, normal: Vector3): boolean => {
      const tipLen = Math.max(settings.tipBottomDiameter * 1.6, 1.0);
      const neckR = Math.max(settings.tipBottomDiameter / 2, 0.1);
      const sphereR = Math.max(settings.tipTopDiameter / 2, neckR);
      const CLEARR = bodyR + 0.5;
      const NECK_PEN = neckR + 0.05;
      const TIP_SKIP = 2 * sphereR + 0.15;
      const C = point;
      if (C.y < tipLen + 0.6) return false;
      const maxRise = Math.min(8, Math.max(2.0, C.y - 0.6));
      const riseSet: number[] = [];
      for (let r = 2.0; r <= maxRise + 1e-3; r += 1.5) riseSet.push(r);
      if (riseSet.length === 0) riseSet.push(Math.max(2.0, maxRise));
      const tiltDirs = 8;
      // supporter 탭 '서포트 각도' 를 bend 후보의 최대 기울기(수직 대비) 로 적용.
      //   rad/rise = tan(angle). 사용자가 작은 값을 두면 거의 수직만 시도되고
      //   STL 우회 실패가 늘어남(콘솔 카운터로 추적 가능).
      const maxTiltRad = (settings.supportAngle * Math.PI) / 180;
      const tanMax = Math.tan(maxTiltRad);
      const cands: { ox: number; oz: number; rise: number }[] = [];
      // 수직 후보 — 항상 채택 (supportAngle 무관)
      for (const rise of riseSet) cands.push({ ox: 0, oz: 0, rise });
      // 기울임 후보 — supportAngle 에서 파생된 비율 3단계 (0.4·0.7·1.0×tanMax)
      if (tanMax > 0.05) {
        for (const rise of riseSet) {
          for (const ratio of [tanMax * 0.4, tanMax * 0.7, tanMax]) {
            if (ratio < 0.05) continue;
            const rad = rise * ratio;
            for (let k = 0; k < tiltDirs; k++) {
              const a = (k / tiltDirs) * 2 * Math.PI;
              cands.push({
                ox: Math.cos(a) * rad,
                oz: Math.sin(a) * rad,
                rise,
              });
            }
          }
        }
      }
      // 사용자 요구: 마진 0.5mm 반경 안에 서포트 어떤 부분도 침범 금지.
      //   sphere tip + 잠재 bodyR 까지 포함한 가장 보수적 가드 — C 가 마진에서
      //   (0.5mm + bodyR) 이상 떨어져야 통과. sphere/neck/body 모두 안전.
      if (isNearMarginXZ(C, bodyR)) return false;
      for (const { ox, oz, rise } of cands) {
        const B = new Vector3(C.x + ox, C.y - rise, C.z + oz);
        if (B.y < 0.5) continue;
        // 마진 가드 — bend point(몸통 시작) 도 0.5mm + bodyR 안 마진 침범 금지
        if (isNearMarginXZ(B, bodyR)) continue;
        const cToB = B.subtract(C);
        const nlen = cToB.length();
        if (nlen < tipLen + 0.6) continue;
        const ndir = cToB.scale(1 / nlen);
        if (nlen > TIP_SKIP) {
          const neckStart = C.add(ndir.scale(TIP_SKIP));
          if (!segmentClear(neckStart, B, NECK_PEN)) continue;
        }
        // 마진 가드 (segment) — neck 튜브 (C→B) 전체가 0.5mm + bodyR 안 침범 금지
        //   neck 후반은 연결부에서 bodyR 까지 부풀어 오르므로 bodyR 기준으로 검사
        if (segmentNearMarginXZ(C, B, bodyR)) continue;
        const plate = new Vector3(B.x, 0, B.z);
        if (!segmentClear(B, plate, CLEARR)) continue;
        // 마진 가드 (segment) — body 튜브 (B→plate) 전체도 동일 가드
        if (segmentNearMarginXZ(B, plate, bodyR)) continue;
        const support = createSupport(
          scene,
          C,
          normal,
          settings,
          B,
          MANDATORY_COLOR
        );
        if (!support) continue;
        support.metadata = { stlId, mandatory: true };
        support.setParent(mesh);
        supportsRef.current.push(support);
        return true;
      }
      return false;
    };

    // island 시드만 배치 — 너무 밀집되면 PRIMARY_SPACING 으로 클러스터링.
    const placed: Vector3[] = [];
    let nPlaced = 0;
    const SUPPORT_CAP = 2000;
    const tally: Record<string, number> = {};
    for (const s of seeds) {
      if (placed.length > SUPPORT_CAP) break;
      if (placed.some((q) => Vector3.Distance(q, s.point) < PRIMARY_SPACING))
        continue;
      if (!makeSupportAt(s.point, s.normal)) continue;
      placed.push(s.point);
      tally[s.reason] = (tally[s.reason] ?? 0) + 1;
      nPlaced++;
    }

    const breakdown = Object.entries(tally)
      .map(([k, v]) => `${k}:${v}`)
      .join(' · ');
    console.log(
      `[선택 영역 자동 서포트] 색칠 ${paintedFaces.size}면 · 다운페이싱 ${nDownFaces}면 · ` +
        `전체 모델 island ${globalIslandSize}면 → painted 교집합 ${sliceIslandFaces.size}면 · ` +
        `mandatory 시드 ${seeds.length} · 생성 ${nPlaced}개 (${breakdown}) · marginPoints ${marginPoints.length}개 ` +
        `(회전: ${rotChanged ? '적용' : '불필요'} · 마진 가드 ${MARGIN_GUARD}mm + bodyR ${bodyR.toFixed(2)}mm · ` +
        `supportAngle ${settings.supportAngle}° · touchTipDistance ${settings.touchTipDistance}mm)`
    );
    if (marginPoints.length === 0) {
      console.warn('[선택 영역 자동 서포트] marginPoints 가 비어있음 — 마진 찾기 먼저 실행하세요 (또는 stlId 불일치 가능)');
    }
  }, [scopedSupportSignal]);

  /**
   * Phase 1 — Island Detection (전체 모델, ChiTuBox/Cura 표준)
   *   슬라이스 두께(sliceLayerHeight) 간격으로 STL을 자르고 4-connected
   *   component 라벨링으로 island 를 판정. supportAngle 로 자체지지 임계.
   *   결과: 전체 island face 주황색 overlay + sliceDataRef 갱신 + 콜백.
   */
  useEffect(() => {
    if (detectIslandsSignal === 0) return;
    const scene = sceneRef.current;
    if (!scene) return;

    // 대상 STL — 선택된 것, 없으면 로드된 첫 STL
    let stlId = selectedFileIds[0];
    if (!stlId) {
      const ids = Array.from(meshMapRef.current.keys());
      if (ids.length > 0) stlId = ids[0];
    }
    if (!stlId) {
      console.warn('Island 검출: 대상 STL이 없습니다.');
      return;
    }
    const mesh = meshMapRef.current.get(stlId);
    if (!mesh) return;

    // 기존 island 시각화 정리
    islandFaceMarkersRef.current.forEach((m) => m.dispose());
    islandFaceMarkersRef.current = [];
    islandLayerCellMarkersRef.current.forEach((m) => m.dispose());
    islandLayerCellMarkersRef.current = [];
    // mesh.clipPlane 정리 (재검출 시 새로 적용)
    mesh.clipPlane = null;
    // 현재 STL 각도 (회전/이동) 정확 반영 보장 — worldMatrix 갱신
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();

    const tris = readWorldTriangles(mesh);
    if (tris.length === 0) {
      console.warn('Island 검출: 분석할 삼각형이 없습니다.');
      return;
    }
    const t0 = performance.now();
    const result = detectSliceIslands({
      tris,
      cellSize: sliceLayerHeight, // 라스터화 정밀도 = layer 두께
      layerHeight: sliceLayerHeight,
      supportAngle: supportSettingsRef.current.supportAngle,
      // 위 향한 면(n.y > 0)은 서포트 불필요 → island 결과에서 제외
      downFacingOnly: true,
      minIslandCells: 1, // 슬라이스 sim 미지지 정의 일치 — 1-cell 떨어진 piece 도 포착
      plateGap: 0, // plate 인접 layer 도 island 검출 (낮은 Y 의 piece 도 포착)
      // TEMP 진단 — 사용자 호소 (L=42 piece 누락) 원인 좁힘. 확인 후 제거.
      debugLayers: [41, 42, 43],
    });
    const tDetect = performance.now() - t0;

    // Island face overlay — 검출된 island face 의 실제 STL triangle 을 표면 conforming 으로 표시.
    //   사용자 요구: thread 처럼 가는 island 는 thread 모양 그대로 / elongated 도 elongated.
    //   cell-square (layer 평면 사각형) 은 여러 layer 에 걸친 thread 의 첫 layer 만 표시되는 한계.
    //   face overlay 는 islandFaces (downFacingOnly 후처리 통과 face) 의 실제 triangle 을 칠함 →
    //   thread 의 down-facing 면 모두 표시 → 자연스러운 thread 모양.
    {
      const meshIndices2 = mesh.getIndices();
      const meshPositions2 = mesh.getVerticesData('position');
      if (
        meshIndices2 &&
        meshPositions2 &&
        result.islandFaces.size > 0
      ) {
        const positions: number[] = [];
        const indices: number[] = [];
        let vIdx = 0;
        for (const f of result.islandFaces) {
          for (let kk = 0; kk < 3; kk++) {
            const vi = meshIndices2[f * 3 + kk];
            positions.push(
              meshPositions2[vi * 3],
              meshPositions2[vi * 3 + 1],
              meshPositions2[vi * 3 + 2]
            );
          }
          indices.push(vIdx, vIdx + 1, vIdx + 2);
          vIdx += 3;
        }
        if (indices.length > 0) {
          const overlay = new Mesh('islandFaces', scene);
          const vd = new VertexData();
          vd.positions = positions;
          vd.indices = indices;
          const norms: number[] = [];
          VertexData.ComputeNormals(positions, indices, norms);
          vd.normals = norms;
          vd.applyToMesh(overlay);
          const mat = new StandardMaterial('islandFacesMat', scene);
          mat.emissiveColor = new Color3(1.0, 0.2, 0.85);
          mat.diffuseColor = new Color3(0, 0, 0);
          mat.specularColor = new Color3(0, 0, 0);
          mat.disableLighting = true;
          mat.backFaceCulling = false;
          mat.zOffset = -1; // STL 표면보다 살짝 앞으로 — z-fighting 차단
          overlay.material = mat;
          overlay.isPickable = false;
          overlay.renderingGroupId = 0;
          overlay.metadata = { stlId, kind: 'islandFaces' };
          // mesh-local vertex → 직접 parent (setParent 아님)
          overlay.parent = mesh;
          islandFaceMarkersRef.current.push(overlay);
        }
      }
    }

    sliceDataRef.current = {
      stlId,
      yMin: result.yMin,
      layerHeight: result.layerHeight,
      cellSize: result.cellSize,
      perLayerIslandCells: result.perLayerIslandCells,
    };

    onIslandDetectionComplete?.({
      yMin: result.yMin,
      yMax: result.yMax,
      nSlices: result.nSlices,
      layerHeight: result.layerHeight,
      totalIslandFaces: result.islandFaces.size,
      perLayerIslandCount: result.perLayerIslandCount,
    });

    const totalIslandCells = result.perLayerIslandCells.reduce(
      (s, c) => s + c.size,
      0
    );
    console.log(
      `[Island 검출] 전체 face ${tris.length} · island face ${result.islandFaces.size} · ` +
        `island cell ${totalIslandCells} · layers ${result.nSlices} · ` +
        `layerHeight ${result.layerHeight}mm · cellSize ${result.cellSize}mm · ` +
        `supportAngle ${supportSettingsRef.current.supportAngle}° ` +
        `(dSafe ${result.dSafe.toFixed(3)}mm, prevLayers ${result.prevLayers}, cellAdjR ${result.cellAdjR}) ` +
        `· ${tDetect.toFixed(0)}ms`
    );
  }, [detectIslandsSignal]);

  /**
   * Phase 1 — 모든 mesh union bbox 기반 yRange/nSlices 자동 계산.
   *   stlFiles / sliceLayerHeight 변경 시 LayerSlider 가 모든 STL 의 적층 범위
   *   union 과 일치하도록 콜백으로 ViewerPage state 갱신.
   *   Island 검출 여부 무관하게 슬라이더 동작 가능.
   */
  useEffect(() => {
    const allMeshes = Array.from(meshMapRef.current.values());
    if (allMeshes.length === 0) {
      onSliceRangeChange?.(null);
      return;
    }
    // plate 기준 — yMin = 0 (plate 면), yMax = 모든 mesh 의 maximumWorld.y 중 최댓값
    let yMax = -Infinity;
    for (const m of allMeshes) {
      const bb = m.getBoundingInfo().boundingBox;
      if (bb.maximumWorld.y > yMax) yMax = bb.maximumWorld.y;
    }
    if (!isFinite(yMax) || yMax <= 0) {
      onSliceRangeChange?.(null);
      return;
    }
    const yMin = 0;
    const nSlices = Math.max(2, Math.ceil((yMax - yMin) / sliceLayerHeight) + 1);
    onSliceRangeChange?.({
      yMin,
      yMax,
      nSlices,
      layerHeight: sliceLayerHeight,
    });
  }, [stlFiles, sliceLayerHeight, onSliceRangeChange]);

  /**
   * Phase 1 — Layer 변경에 따른 ClipPlane + 현재 layer island cell 강조
   *   currentLayerIndex === -1 면 ClipPlane 끔(전체 모델 보기) + cell 마커 정리.
   *   그 외엔 mesh.clipPlane 으로 yTarget 이상 잘라내기.
   *   Island cell 강조는 sliceDataRef 가 있고 layerHeight 가 일치할 때만.
   */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // 이전 cell 마커 + 단면 윤곽선 정리
    islandLayerCellMarkersRef.current.forEach((m) => m.dispose());
    islandLayerCellMarkersRef.current = [];
    // 이전 cap mesh 들 정리
    sliceCapMeshesRef.current.forEach((m) => m.dispose());
    sliceCapMeshesRef.current = [];

    // 로드된 모든 STL mesh 수집 — 실시간 적층 시뮬레이션이 모든 mesh 에 동시 적용
    const allMeshes = Array.from(meshMapRef.current.values());
    if (allMeshes.length === 0) return;

    if (currentLayerIndex === undefined || currentLayerIndex < 0) {
      // OFF — 모든 mesh 의 clipPlane + scene clipPlane 해제
      for (const m of allMeshes) m.clipPlane = null;
      scene.clipPlane = null;
      return;
    }

    // plate 기준(Y=0) 으로 yTarget 계산. 슬라이더 0 → plate 면.
    const yTarget = currentLayerIndex * sliceLayerHeight;
    // y > yTarget frag 잘림 → y ≤ yTarget 만 보임.
    //   scene.clipPlane (전역) + mesh.clipPlane 둘 다 설정 → 일부 material/렌더
    //   경로에서 mesh.clipPlane 만으로 동작 안 하는 케이스 대비.
    //   빌드플레이트 그리드(Y=0)·서포트(plate~mesh)·마진 등 다른 메쉬도 같이 잘릴 수
    //   있으나 적층 시뮬레이션 우선.
    const plane = new Plane(0, 1, 0, -yTarget);
    scene.clipPlane = plane;
    for (const m of allMeshes) m.clipPlane = plane;

    // === 단면 채움 cap mesh 생성 — 각 STL 의 y=yTarget 평면 교차 polygon ===
    //   ClipPlane 만으로는 watertight mesh 의 단면이 비어 보임 → 모델 색의 평면
    //   mesh 로 채워 "속이 찬 STL" 시각 효과. 슬라이더 매 변경 시 재생성.
    const capY = yTarget - 0.002; // mesh.clipPlane 경계와 z-fighting 방지
    for (const mesh of allMeshes) {
      const positions = mesh.getVerticesData('position');
      const indices = mesh.getIndices();
      if (!positions || !indices) continue;
      const wm = mesh.getWorldMatrix();
      const getV = (i: number): Vector3 =>
        Vector3.TransformCoordinates(
          new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]),
          wm
        );
      // mesh bbox 검사로 yTarget 이 mesh 범위 밖이면 skip (cap 안 만들음)
      const bb = mesh.getBoundingInfo().boundingBox;
      if (yTarget < bb.minimumWorld.y || yTarget > bb.maximumWorld.y) continue;

      // Step 1: tri ↔ z=yTarget 교차 segments 수집
      const segs: { ax: number; az: number; bx: number; bz: number }[] = [];
      for (let f = 0; f < indices.length; f += 3) {
        const v0 = getV(indices[f]);
        const v1 = getV(indices[f + 1]);
        const v2 = getV(indices[f + 2]);
        const ay = v0.y - yTarget;
        const by = v1.y - yTarget;
        const cy = v2.y - yTarget;
        if ((ay > 0 && by > 0 && cy > 0) || (ay < 0 && by < 0 && cy < 0)) continue;
        const pts: { x: number; z: number }[] = [];
        const edges: [Vector3, Vector3, number, number][] = [
          [v0, v1, ay, by],
          [v1, v2, by, cy],
          [v2, v0, cy, ay],
        ];
        for (const [a, b, da, db] of edges) {
          if (da === 0 && db === 0) continue;
          if ((da >= 0 && db >= 0) || (da <= 0 && db <= 0)) {
            if (da === 0) pts.push({ x: a.x, z: a.z });
            else if (db === 0) pts.push({ x: b.x, z: b.z });
            continue;
          }
          const t = da / (da - db);
          pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        }
        if (pts.length >= 2) {
          segs.push({ ax: pts[0].x, az: pts[0].z, bx: pts[1].x, bz: pts[1].z });
        }
      }
      if (segs.length === 0) continue;

      // Step 2: vertex 양자화 + adjacency
      const QUANT = 10000;
      const keyOf = (x: number, z: number): string =>
        `${Math.round(x * QUANT)},${Math.round(z * QUANT)}`;
      const vertexPos = new Map<string, { x: number; z: number }>();
      const adj = new Map<string, Set<string>>();
      for (const s of segs) {
        const ka = keyOf(s.ax, s.az);
        const kb = keyOf(s.bx, s.bz);
        if (ka === kb) continue;
        if (!vertexPos.has(ka)) vertexPos.set(ka, { x: s.ax, z: s.az });
        if (!vertexPos.has(kb)) vertexPos.set(kb, { x: s.bx, z: s.bz });
        if (!adj.has(ka)) adj.set(ka, new Set());
        if (!adj.has(kb)) adj.set(kb, new Set());
        adj.get(ka)!.add(kb);
        adj.get(kb)!.add(ka);
      }

      // Step 3: closed loop tracing
      const visited = new Set<string>();
      const loops: { x: number; z: number }[][] = [];
      for (const start of vertexPos.keys()) {
        if (visited.has(start)) continue;
        const startNbrs = adj.get(start);
        if (!startNbrs || startNbrs.size === 0) continue;
        const loopKeys: string[] = [start];
        visited.add(start);
        let prev = '';
        let cur = start;
        let closed = false;
        while (true) {
          const nbrs = adj.get(cur);
          if (!nbrs) break;
          let next: string | undefined;
          for (const n of nbrs) {
            if (n === prev) continue;
            if (n === start && loopKeys.length >= 3) {
              closed = true;
              break;
            }
            if (visited.has(n)) continue;
            next = n;
            break;
          }
          if (closed) break;
          if (!next) break;
          loopKeys.push(next);
          visited.add(next);
          prev = cur;
          cur = next;
        }
        if (closed && loopKeys.length >= 3) {
          loops.push(loopKeys.map((k) => vertexPos.get(k)!));
        }
      }
      if (loops.length === 0) continue;

      // Step 4: fan triangulation
      const capPositions: number[] = [];
      const capIndices: number[] = [];
      for (const loop of loops) {
        let cx = 0;
        let cz = 0;
        for (const p of loop) {
          cx += p.x;
          cz += p.z;
        }
        cx /= loop.length;
        cz /= loop.length;
        const cIdx = capPositions.length / 3;
        capPositions.push(cx, capY, cz);
        for (const p of loop) capPositions.push(p.x, capY, p.z);
        for (let i = 0; i < loop.length; i++) {
          const a = cIdx + 1 + i;
          const b = cIdx + 1 + ((i + 1) % loop.length);
          capIndices.push(cIdx, a, b);
          capIndices.push(cIdx, b, a); // 양면
        }
      }
      if (capIndices.length === 0) continue;

      // Step 5: cap mesh — STL 모델 색 그대로 ("속이 찬" 시각)
      const cap = new Mesh('sliceCap_' + mesh.name, scene);
      const vd = new VertexData();
      vd.positions = capPositions;
      vd.indices = capIndices;
      const norms: number[] = [];
      VertexData.ComputeNormals(capPositions, capIndices, norms);
      vd.normals = norms;
      vd.applyToMesh(cap);
      // STL material 의 diffuseColor 가져옴 (기본 STL 색 — 회색·파랑 등)
      let diffuse = new Color3(0.8, 0.8, 0.9);
      if (mesh.material && mesh.material instanceof StandardMaterial) {
        diffuse = mesh.material.diffuseColor.clone();
      }
      const capMat = new StandardMaterial('sliceCapMat', scene);
      capMat.diffuseColor = diffuse;
      capMat.specularColor = new Color3(0.1, 0.1, 0.1);
      capMat.backFaceCulling = false;
      cap.material = capMat;
      cap.isPickable = false;
      sliceCapMeshesRef.current.push(cap);
    }

    // 활성 STL 결정 — island cell 강조용
    let activeStlId = selectedFileIds[0];
    if (!activeStlId) {
      const ids = Array.from(meshMapRef.current.keys());
      if (ids.length > 0) activeStlId = ids[0];
    }
    // 현재 layer 의 island cell 강조 — 검출 결과 layerHeight 가 현재 sliceLayerHeight 와
    //   일치할 때만 (사용자가 검출 후 두께 변경하면 의미 잃음)
    const data = sliceDataRef.current;
    if (
      data &&
      data.stlId === activeStlId &&
      Math.abs(data.layerHeight - sliceLayerHeight) < 1e-6
    ) {
      const cells = data.perLayerIslandCells[currentLayerIndex];
      if (cells && cells.size > 0) {
        const cellSize = data.cellSize;
        for (const k of cells) {
          const ci = k.indexOf(',');
          const cx = +k.slice(0, ci);
          const cz = +k.slice(ci + 1);
          const box = MeshBuilder.CreateBox(
            'islandCell',
            { width: cellSize, depth: cellSize, height: 0.02 },
            scene
          );
          box.position.set(
            cx * cellSize + cellSize / 2,
            yTarget + 0.05,
            cz * cellSize + cellSize / 2
          );
          const mat = new StandardMaterial('islandCellMat', scene);
          mat.emissiveColor = new Color3(1, 0.15, 0.15);
          mat.diffuseColor = new Color3(0, 0, 0);
          mat.disableLighting = true;
          box.material = mat;
          box.isPickable = false;
          box.renderingGroupId = 1; // 모델 위 덮어쓰기
          islandLayerCellMarkersRef.current.push(box);
        }
      }
    }
  }, [currentLayerIndex, sliceLayerHeight, selectedFileIds, stlFiles]);

  /**
   * 모두 지우기 — 현재 선택된 STL에 부착된 서포트 + 마진 + island 마커 제거
   */
  useEffect(() => {
    if (clearSupportsSignal === 0) return; // 초기값
    supportsRef.current = supportsRef.current.filter((s) => {
      const sid = s.metadata?.stlId as string | undefined;
      if (sid && selectedFileIds.includes(sid)) {
        s.dispose();
        return false;
      }
      return true;
    });
    // 마진 라인 시각화도 함께 제거
    marginMarkersRef.current = marginMarkersRef.current.filter((m) => {
      const sid = m.metadata?.stlId as string | undefined;
      if (sid && selectedFileIds.includes(sid)) {
        m.dispose();
        return false;
      }
      return true;
    });
    // Island disc 오버레이 + layer cell 마커도 제거 (stlId 기준 필터)
    islandFaceMarkersRef.current = islandFaceMarkersRef.current.filter((m) => {
      const sid = m.metadata?.stlId as string | undefined;
      if (!sid || selectedFileIds.includes(sid)) {
        m.dispose();
        return false;
      }
      return true;
    });
    islandLayerCellMarkersRef.current = islandLayerCellMarkersRef.current.filter((m) => {
      const sid = m.metadata?.stlId as string | undefined;
      if (!sid || selectedFileIds.includes(sid)) {
        m.dispose();
        return false;
      }
      return true;
    });
  }, [clearSupportsSignal]);

  return (
    <div className={`relative w-full h-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full outline-none"
        tabIndex={0}
        onContextMenu={(e) => e.preventDefault()}
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <div className="text-white text-lg">Loading 3D models...</div>
        </div>
      )}

      {error && (
        <div className="absolute top-4 left-4 right-4 bg-red-500 text-white p-4 rounded">
          Error: {error}
        </div>
      )}

      {!isLoading && stlFiles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
          No STL files to display
        </div>
      )}

      {/* 네비게이션 큐브 (줌 컨트롤 왼쪽) */}
      {viewerReady && (
        <div className="absolute top-3 right-20">
          <ViewCube cameraRef={cameraRef} sceneRef={sceneRef} />
        </div>
      )}

      {/* 서포트 추가 모드 점 커서 (직경 = 팁 상부 직경) */}
      <div
        ref={supportCursorRef}
        className="absolute rounded-full pointer-events-none"
        style={{
          display: 'none',
          transform: 'translate(-50%, -50%)',
          border: '1.5px solid #5fa8ee',
          background: 'rgba(95, 168, 238, 0.3)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
        }}
      />
    </div>
  );
};

export default STLViewer;
