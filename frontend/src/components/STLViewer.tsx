import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Engine, Scene, ArcRotateCamera, Mesh, GizmoManager, UtilityLayerRenderer, IPointerEvent } from '@babylonjs/core';
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
  createBuildPlate,
  disposeBuildPlate,
} from '@utils/babylon.utils';
import {
  loadSTLFile,
  applyTransform,
  setMeshVisibility,
  setMeshOpacity,
} from '@utils/stl-loader.utils';
import type { STLFile } from '@types/stl.types';

export type GizmoMode = 'select' | 'move' | 'rotate' | 'scale';
export type ViewMode = 'solid' | 'wireframe' | 'xray';

export interface STLViewerHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  focusOnSelected: () => void;
  setGizmoMode: (mode: GizmoMode) => void;
}

interface STLViewerProps {
  stlFiles: STLFile[];
  selectedFileIds?: string[];  // 선택된 파일 IDs
  onMeshLoaded?: (stlId: string, mesh: Mesh) => void;
  onMeshSelected?: (stlId: string) => void;
  onGizmoTransformChange?: (stlId: string, mesh: Mesh) => void;  // Gizmo 드래그 완료 시
  onBackgroundClick?: () => void; // 배경 클릭 시
  unselectedOpacity?: number; // 선택되지 않은 객체의 투명도 (0~1)
  viewMode?: ViewMode;
  buildPlateConfig?: { width: number; depth: number; height: number };
  className?: string;
}

/**
 * STL 뷰어 컴포넌트
 * Babylon.js를 사용하여 3D STL 모델 렌더링
 */
const STLViewer = forwardRef<STLViewerHandle, STLViewerProps>(({
  stlFiles,
  selectedFileIds = [],
  onMeshLoaded,
  onMeshSelected,
  onGizmoTransformChange,
  onBackgroundClick,
  unselectedOpacity = 1, // Default to opaque
  viewMode = 'solid',
  buildPlateConfig,
  className = '',
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const meshMapRef = useRef<Map<string, Mesh>>(new Map());
  const utilityLayerRef = useRef<UtilityLayerRenderer | null>(null);
  const gizmoManagerRef = useRef<GizmoManager | null>(null);
  const buildPlateRef = useRef<Mesh[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const camera = cameraRef.current;
      if (!camera) return;
      const newRadius = camera.radius * 0.8;
      camera.radius = Math.max(newRadius, camera.lowerRadiusLimit || 5);
    },
    zoomOut: () => {
      const camera = cameraRef.current;
      if (!camera) return;
      const newRadius = camera.radius * 1.25;
      camera.radius = Math.min(newRadius, camera.upperRadiusLimit || 200);
    },
    resetView: () => {
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      if (!camera || !scene) return;
      camera.alpha = Math.PI / 2;
      camera.beta = Math.PI / 3;
      focusOnAllMeshes(camera, scene);
    },
    focusOnSelected: () => {
      const camera = cameraRef.current;
      if (!camera) return;
      const selectedMeshes = Array.from(selectedFileIds)
        .map(id => meshMapRef.current.get(id))
        .filter((m): m is Mesh => m !== undefined);
      if (selectedMeshes.length === 0) return;
      // Focus on first selected mesh
      const mesh = selectedMeshes[0];
      mesh.computeWorldMatrix(true);
      const bi = mesh.getBoundingInfo();
      const center = bi.boundingBox.centerWorld;
      const size = bi.boundingBox.extendSizeWorld.length() * 2;
      camera.target = center.clone();
      camera.radius = Math.max(size * 2, 20);
    },
    setGizmoMode: (mode: GizmoMode) => {
      const gm = gizmoManagerRef.current;
      if (!gm) return;
      gm.positionGizmoEnabled = mode === 'move';
      gm.rotationGizmoEnabled = mode === 'rotate';
      gm.scaleGizmoEnabled = mode === 'scale';
      gm.boundingBoxGizmoEnabled = mode !== 'select';

      // Configure bounding box gizmo for visual-only display
      if (mode !== 'select' && gm.gizmos.boundingBoxGizmo) {
        gm.gizmos.boundingBoxGizmo.setEnabledScaling(false);
        gm.gizmos.boundingBoxGizmo.setEnabledRotationAxis('');
        gm.gizmos.boundingBoxGizmo.fixedDragMeshScreenSize = true;
      }
    },
  }), [selectedFileIds]);

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

      // 빌드 플레이트 생성
      if (buildPlateConfig) {
        buildPlateRef.current = createBuildPlate(scene, buildPlateConfig.width, buildPlateConfig.depth, buildPlateConfig.height);
      }

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
      scene.onPointerObservable.add((pointerInfo) => {
        if (pointerInfo.type === 2) { // PointerEventTypes.POINTERDOWN
          if (pointerInfo.pickInfo?.hit && pointerInfo.pickInfo.pickedMesh) {
            // 메쉬 클릭 (왼쪽 클릭만 허용)
            const event = pointerInfo.event as IPointerEvent;
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
          } else {
            // 배경 클릭 (왼쪽 클릭인 경우만)
            // pointerInfo.event.button === 0 (Left Click)
            const event = pointerInfo.event as IPointerEvent;
            if (event.button === 0 && onBackgroundClick) {
              onBackgroundClick();
            }
          }
        }
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize viewer';
      setError(errorMessage);
    }

    // 클린업
    return () => {
      disposeBuildPlate(buildPlateRef.current);
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
   * Transform 변경 처리 (Preview 및 Current)
   */
  useEffect(() => {
    stlFiles.forEach((stlFile) => {
      const mesh = meshMapRef.current.get(stlFile.stlId);
      if (mesh) {
        // Preview transform이 있으면 우선 사용, 없으면 current transform 사용
        applyTransform(mesh, stlFile.previewTransform || stlFile.currentTransform);
      }
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

    if (selectedMeshes.length === 1) {
      // 단일 선택: Gizmo 부착 (Babylon의 attachToMesh는 자동으로 중심에 배치)
      gizmoManagerRef.current.attachToMesh(selectedMeshes[0]);
    } else {
      // 다중 선택 또는 선택 없음: Gizmo 제거
      gizmoManagerRef.current.attachToMesh(null);
    }

    // 투명도 적용
    // 선택된 파일이 하나라도 있으면, 선택되지 않은 파일은 투명하게 처리
    // 선택된 파일이 없으면, 모든 파일 불투명하게 처리
    const hasSelection = selectedFileIds.length > 0;

    meshMapRef.current.forEach((mesh, stlId) => {
      const isSelected = selectedFileIds.includes(stlId);

      if (!hasSelection) {
        // 선택된 것이 없으면 모두 불투명
        setMeshOpacity(mesh, 1);
      } else if (isSelected) {
        // 선택된 것은 불투명
        setMeshOpacity(mesh, 1);
      } else {
        // 선택되지 않은 것은 설정된 투명도 적용
        setMeshOpacity(mesh, unselectedOpacity);
      }
    });

  }, [selectedFileIds, unselectedOpacity]);

  /**
   * 빌드 플레이트 동적 업데이트
   */
  useEffect(() => {
    if (!sceneRef.current || !buildPlateConfig) return;
    disposeBuildPlate(buildPlateRef.current);
    buildPlateRef.current = createBuildPlate(
      sceneRef.current,
      buildPlateConfig.width,
      buildPlateConfig.depth,
      buildPlateConfig.height
    );
  }, [buildPlateConfig?.width, buildPlateConfig?.depth, buildPlateConfig?.height]);

  /**
   * 뷰 모드 변경 처리 (Solid / Wireframe / X-ray)
   */
  useEffect(() => {
    meshMapRef.current.forEach((mesh) => {
      const mat = mesh.material;
      if (!mat) return;
      switch (viewMode) {
        case 'wireframe':
          mat.wireframe = true;
          mat.alpha = 1;
          (mat as any).backFaceCulling = true;
          break;
        case 'xray':
          mat.wireframe = false;
          mat.alpha = 0.3;
          (mat as any).backFaceCulling = false;
          break;
        default: // solid
          mat.wireframe = false;
          mat.alpha = 1;
          (mat as any).backFaceCulling = true;
          break;
      }
    });
  }, [viewMode, stlFiles]);

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
    </div>
  );
});

STLViewer.displayName = 'STLViewer';

export default STLViewer;
