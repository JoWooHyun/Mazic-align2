import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mesh, VertexBuffer } from '@babylonjs/core';
import { useAuth } from '@hooks/useAuth';
import { useProject } from '@hooks/useProjects';
import { useSTLFiles } from '@hooks/useSTLFiles';
import STLViewer from '@components/STLViewer';
import STLFileList from '@components/STLFileList';
import ViewerControls from '@components/ViewerControls';
import TransformPanel from '@components/TransformPanel';
import SupporterPanel from '@components/SupporterPanel';
import LayerSlider from '@components/LayerSlider';
import HistoryViewer from '@components/HistoryViewer';
import SettingsModal from '@components/SettingsModal';
import SlicerPanel from '@components/Slicer/SlicerPanel';
import SlicePreview from '@components/Slicer/SlicePreview';
import LocalFileBrowser from '@components/LocalFileBrowser';
import { slicerService } from '@services/slicer/SlicerService';
import { importSTLFromPath } from '@services/stl.service';
import { SliceSettings, LayerData } from '@services/slicer/types';
import { AdjustmentType, type Transform, type STLFile } from '../types/stl.types';
import { getTransformFromMesh } from '@utils/stl-loader.utils';
import {
  type SupportSettings,
  type SupportTool,
  DEFAULT_SUPPORT_SETTINGS,
} from '@utils/support.utils';

/** 복사본 이름 생성 — "base (n).ext" (기존 (n) 은 제거 후 다음 번호) */
function makeCopyName(srcName: string, existingNames: string[]): string {
  const dot = srcName.lastIndexOf('.');
  const ext = dot > 0 ? srcName.slice(dot) : '';
  let base = dot > 0 ? srcName.slice(0, dot) : srcName;
  base = base.replace(/ \(\d+\)$/, '');
  let n = 1;
  while (existingNames.includes(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}

/**
 * 3D 뷰어 페이지
 * 프로젝트의 STL 파일 업로드 및 3D 뷰어 표시
 */
const ViewerPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { project, loading: projectLoading } = useProject(projectId);
  const {
    stlFiles,
    loading: filesLoading,
    fetchSTLFiles,
    toggleVisibility,
    deleteFile,
    adjustSTL,
    previewSTL,
    addLocalSTL,
  } = useSTLFiles(projectId);

  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'transform' | 'supporter' | 'history'>('transform');
  const [gizmoEnabled, setGizmoEnabled] = useState(false); // Rotation 버튼으로 기즈모 표시 토글
  const [supportTool, setSupportTool] = useState<SupportTool>('none'); // 서포트 배치 도구
  const [brushThickness, setBrushThickness] = useState(3); // 보호 영역 브러쉬 두께 (mm)
  const [supportSettings, setSupportSettings] = useState<SupportSettings>(
    DEFAULT_SUPPORT_SETTINGS
  );
  const [clearSupportsSignal, setClearSupportsSignal] = useState(0); // 증가 시 서포트 제거
  const [generateSupportsSignal, setGenerateSupportsSignal] = useState(0); // 증가 시 영역 서포트 생성
  const [autoAngleSignal, setAutoAngleSignal] = useState(0); // 증가 시 자동 각도 조절 실행
  const [findMarginSignal, setFindMarginSignal] = useState(0); // 증가 시 마진 찾기 실행
  const [scopedSupportSignal, setScopedSupportSignal] = useState(0); // 증가 시 선택 영역 자동 서포트 생성

  // Phase 1 — Island Detection
  const [sliceLayerHeight, setSliceLayerHeight] = useState(0.05); // 슬라이스 두께 (mm)
  const [detectIslandsSignal, setDetectIslandsSignal] = useState(0); // 증가 시 island 검출
  const [sliceLayerIndex, setSliceLayerIndex] = useState(-1); // -1 = clipPlane off
  const [sliceTotalLayers, setSliceTotalLayers] = useState(0);
  const [sliceYRange, setSliceYRange] = useState<{ yMin: number; yMax: number } | null>(null);
  const [sliceIslandStats, setSliceIslandStats] = useState<{
    totalIslandFaces: number;
    perLayerCount: number[];
  } | null>(null);

  // STL 로드 직후(sliceTotalLayers 새로 잡힘) sliceLayerIndex 가 OFF(-1) 면
  //   max 위치로 자동 설정 → 모델 전체 적층된 상태로 시작 (3D 프린팅 완료 상태).
  //   사용자가 슬라이더 내리며 적층 해체 시뮬레이션.
  useEffect(() => {
    if (sliceTotalLayers > 0 && sliceLayerIndex < 0) {
      setSliceLayerIndex(sliceTotalLayers - 1);
    }
  }, [sliceTotalLayers, sliceLayerIndex]);

  // Settings state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [transparency, setTransparency] = useState(80); // 0-100% (Default 80%)

  // Slicer state
  const [isSlicerOpen, setIsSlicerOpen] = useState(false);
  const [isSlicing, setIsSlicing] = useState(false);
  const [sliceProgress, setSliceProgress] = useState(0);
  const [sliceStatus, setSliceStatus] = useState('');
  const [slicedLayers, setSlicedLayers] = useState<LayerData[]>([]);
  const [lastSliceSettings, setLastSliceSettings] = useState<SliceSettings | null>(null);
  const [slicerViewMode, setSlicerViewMode] = useState<'3d' | '2d'>('3d');

  // Refs
  const pendingScaleUpdates = useRef<{ x?: number; y?: number; z?: number }>({});
  const scaleUpdateTimeout = useRef<NodeJS.Timeout | null>(null);
  const meshMapRef = useRef<Map<string, Mesh>>(new Map());

  // 선택된 파일 객체들
  const selectedFiles = stlFiles.filter((f) => selectedFileIds.has(f.stlId));
  // 대표 파일 (Transform 패널 표시용 - 첫 번째 선택된 파일)
  const primarySelectedFile = selectedFiles.length > 0 ? selectedFiles[0] : null;

  /**
   * Mesh Load Handler
   */
  const handleMeshLoaded = useCallback((id: string, mesh: Mesh) => {
    meshMapRef.current.set(id, mesh);
  }, []);

  // ===== Ctrl+Z 되돌리기 =====
  // transform 변경 직전 상태를 그룹(한 번의 조작 = 한 그룹) 단위로 스택에 저장
  const undoStackRef = useRef<Array<Array<{ stlId: string; transform: Transform }>>>([]);

  const pushUndoGroup = (entries: Array<{ stlId: string; transform: Transform }>) => {
    if (entries.length === 0) return;
    undoStackRef.current.push(
      entries.map((e) => ({
        stlId: e.stlId,
        transform: JSON.parse(JSON.stringify(e.transform)) as Transform,
      }))
    );
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
  };

  const handleUndo = async () => {
    if (!user || !projectId) return;
    const group = undoStackRef.current.pop();
    if (!group) return;
    for (const { stlId, transform } of group) {
      await adjustSTL(
        projectId,
        stlId,
        user.userId,
        AdjustmentType.TRANSLATION,
        { x: 0, y: 0, z: 0 },
        transform
      );
    }
  };

  // ===== Ctrl+C / Ctrl+V 복사·붙여넣기 =====
  const clipboardRef = useRef<STLFile | null>(null);

  const handleCopy = () => {
    if (primarySelectedFile) clipboardRef.current = primarySelectedFile;
  };

  const handlePaste = () => {
    const src = clipboardRef.current;
    if (!src || !projectId) return;
    const srcMesh = meshMapRef.current.get(src.stlId);
    if (!srcMesh) return;

    // 소스 footprint 반경 (XZ 평면)
    const srcBox = srcMesh.getBoundingInfo().boundingBox;
    const r = Math.hypot(srcBox.extendSizeWorld.x, srcBox.extendSizeWorld.z);

    // 기존 메쉬들의 XZ 중심 + 반경
    const existing: { x: number; z: number; radius: number }[] = [];
    meshMapRef.current.forEach((m) => {
      const bb = m.getBoundingInfo().boundingBox;
      existing.push({
        x: bb.centerWorld.x,
        z: bb.centerWorld.z,
        radius: Math.hypot(bb.extendSizeWorld.x, bb.extendSizeWorld.z),
      });
    });

    // 빌드플레이트 중앙에서 나선형으로 겹치지 않는 위치 탐색
    const margin = 2;
    const ringStep = Math.max(r * 1.3, 6);
    const candidates: { x: number; z: number }[] = [{ x: 0, z: 0 }];
    for (let ring = 1; ring <= 14; ring++) {
      const d = ring * ringStep;
      const cnt = ring * 6;
      for (let a = 0; a < cnt; a++) {
        const ang = (a / cnt) * Math.PI * 2;
        candidates.push({ x: Math.cos(ang) * d, z: Math.sin(ang) * d });
      }
    }
    let spot = candidates[candidates.length - 1];
    for (const c of candidates) {
      const free = existing.every(
        (e) => Math.hypot(c.x - e.x, c.z - e.z) >= r + e.radius + margin
      );
      if (free) {
        spot = c;
        break;
      }
    }

    const newName = makeCopyName(
      src.fileName,
      stlFiles.map((f) => f.fileName)
    );
    const copyId = `local-copy-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    const copy: STLFile = {
      stlId: copyId,
      projectId,
      originalUrl: src.originalUrl,
      fileName: newName,
      visibility: true,
      fileSize: src.fileSize,
      currentTransform: {
        translation: {
          x: spot.x,
          y: -spot.z, // Babylon Z → user -Y
          z: src.currentTransform.translation.z,
        },
        rotation: { ...src.currentTransform.rotation },
        scale: { ...src.currentTransform.scale },
      },
    };
    addLocalSTL(copy);
    setSelectedFileIds(new Set([copyId]));
  };

  // 키보드 리스너는 1회만 등록하고, 최신 핸들러는 ref 로 호출
  const handleUndoRef = useRef(handleUndo);
  handleUndoRef.current = handleUndo;
  const handleCopyRef = useRef(handleCopy);
  handleCopyRef.current = handleCopy;
  const handlePasteRef = useRef(handlePaste);
  handlePasteRef.current = handlePaste;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return; // 입력창은 기본 동작 유지
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
      } else if (k === 'c') {
        handleCopyRef.current();
      } else if (k === 'v') {
        e.preventDefault();
        handlePasteRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 선택된 STL이 바뀌면 기즈모를 끈다 (STL 클릭만으로는 기즈모가 뜨지 않도록)
  useEffect(() => {
    setGizmoEnabled(false);
  }, [primarySelectedFile?.stlId]);

  // Supporter 탭을 벗어나거나 STL 선택이 풀리면 서포트 도구 해제
  //   (영역 지정·서포트 기능은 STL 이 활성화된 동안에만 사용 가능)
  useEffect(() => {
    if (rightPanelTab !== 'supporter' || !primarySelectedFile) {
      setSupportTool('none');
    }
  }, [rightPanelTab, primarySelectedFile]);

  /**
   * 파일 선택 핸들러
   */
  const handleFileSelect = (stlId: string, multiSelect: boolean) => {
    setSelectedFileIds((prev) => {
      if (multiSelect) {
        // Multi-select mode: Toggle selection
        const newSet = new Set(prev);
        if (newSet.has(stlId)) {
          newSet.delete(stlId);
        } else {
          newSet.add(stlId);
        }
        return newSet;
      } else {
        // Single-select mode
        // If clicking the currently selected single file, deselect it (Toggle off)
        if (prev.has(stlId) && prev.size === 1) {
          return new Set();
        }
        // Otherwise, select only this file
        return new Set([stlId]);
      }
    });
  };

  /**
   * 선택 해제 핸들러
   */
  const handleClearSelection = () => {
    setSelectedFileIds(new Set());
  };

  /**
   * LocalFileBrowser에서 파일 선택 완료 핸들러
   */
  const handleFilesSelected = async (localPaths: string[]) => {
    setShowFileBrowser(false);
    if (!projectId) return;

    setUploading(true);
    try {
      for (const localPath of localPaths) {
        const fileName = localPath.split(/[\\/]/).pop() ?? localPath;

        // 중복 체크
        const isDuplicate = stlFiles.some(f => f.fileName === fileName);
        if (isDuplicate) {
          console.log(`[ViewerPage] File ${fileName} already exists, skipping`);
          continue;
        }

        try {
          console.log(`[ViewerPage] Importing ${fileName} from ${localPath}`);
          await importSTLFromPath(projectId, localPath);
          console.log(`[ViewerPage] Successfully imported ${fileName}`);
        } catch (err) {
          console.error(`[ViewerPage] Failed to import ${fileName}:`, err);
          alert(`Failed to import ${fileName}. Please try again.`);
        }
      }
      // 목록 새로고침
      await fetchSTLFiles(projectId);
    } finally {
      setUploading(false);
    }
  };

  /**
   * Transform 변경 핸들러 (Batch Transform)
   */
  const handleTransformChange = async (
    type: AdjustmentType,
    axis: 'x' | 'y' | 'z',
    value: number
  ) => {
    if (selectedFiles.length === 0 || !user || !projectId) return;

    // For scale updates, batch them together to prevent multiple history entries
    if (type === AdjustmentType.SCALE) {
      pendingScaleUpdates.current[axis] = value;

      // Clear existing timeout
      if (scaleUpdateTimeout.current) {
        clearTimeout(scaleUpdateTimeout.current);
      }

      // Wait a bit to see if more scale updates come in (for uniform scale)
      scaleUpdateTimeout.current = setTimeout(async () => {
        const updates = { ...pendingScaleUpdates.current };
        pendingScaleUpdates.current = {};

        // 되돌리기용: 스케일 변경 전 상태 저장
        pushUndoGroup(
          selectedFiles.map((f) => ({ stlId: f.stlId, transform: f.currentTransform }))
        );

        // Process all pending scale updates as a batch
        for (const file of selectedFiles) {
          const oldTransform = file.currentTransform;
          const newTransform = { ...oldTransform };

          // Apply all pending scale updates
          if (updates.x !== undefined) newTransform.scale.x = updates.x;
          if (updates.y !== undefined) newTransform.scale.y = updates.y;
          if (updates.z !== undefined) newTransform.scale.z = updates.z;

          // Calculate delta for the first axis that changed (for history purposes)
          const firstAxis = Object.keys(updates)[0] as 'x' | 'y' | 'z';
          const deltaValue = { [firstAxis]: updates[firstAxis]! - oldTransform.scale[firstAxis] };

          // Skip if no significant change
          if (Math.abs(deltaValue[firstAxis]) < 0.0001) continue;

          await adjustSTL(
            projectId,
            file.stlId,
            user.userId,
            AdjustmentType.SCALE,
            deltaValue,
            newTransform
          );
        }
      }, 10); // 10ms debounce to batch uniform scale updates

      return;
    }

    // 되돌리기용: 변경 전 상태 저장
    pushUndoGroup(selectedFiles.map((f) => ({ stlId: f.stlId, transform: f.currentTransform })));

    // For non-scale updates, process immediately
    for (const file of selectedFiles) {
      const oldTransform = file.currentTransform;
      let newTransform = { ...oldTransform };
      let deltaValue: any = {};

      if (type === AdjustmentType.TRANSLATION) {
        newTransform.translation = {
          ...newTransform.translation,
          [axis]: value,
        };
        deltaValue = { [axis]: value - oldTransform.translation[axis] };
      } else if (type === AdjustmentType.ROTATION) {
        // Convert Euler angle to Quaternion
        const radians = (value * Math.PI) / 180;
        const halfAngle = radians / 2;
        const s = Math.sin(halfAngle);
        const c = Math.cos(halfAngle);

        if (axis === 'x') {
          newTransform.rotation = { x: s, y: 0, z: 0, w: c };
        } else if (axis === 'y') {
          newTransform.rotation = { x: 0, y: s, z: 0, w: c };
        } else {
          newTransform.rotation = { x: 0, y: 0, z: s, w: c };
        }

        deltaValue = { [axis]: value };
      }

      await adjustSTL(
        projectId,
        file.stlId,
        user.userId,
        type,
        deltaValue,
        newTransform
      );
    }
  };

  /**
   * Transform 미리보기 핸들러 (No DB Log)
   */
  const handleTransformPreview = (
    type: AdjustmentType,
    axis: 'x' | 'y' | 'z',
    value: number
  ) => {
    if (selectedFiles.length === 0) return;

    // Apply preview to ALL selected files (local state only, no DB)
    for (const file of selectedFiles) {
      const oldTransform = file.currentTransform;
      let newTransform = { ...oldTransform };

      if (type === AdjustmentType.TRANSLATION) {
        newTransform.translation = {
          ...newTransform.translation,
          [axis]: value,
        };
      } else if (type === AdjustmentType.ROTATION) {
        // Convert Euler angle to Quaternion
        const radians = (value * Math.PI) / 180;
        const halfAngle = radians / 2;
        const s = Math.sin(halfAngle);
        const c = Math.cos(halfAngle);

        if (axis === 'x') {
          newTransform.rotation = { x: s, y: 0, z: 0, w: c };
        } else if (axis === 'y') {
          newTransform.rotation = { x: 0, y: s, z: 0, w: c };
        } else {
          newTransform.rotation = { x: 0, y: 0, z: s, w: c };
        }
      } else if (type === AdjustmentType.SCALE) {
        newTransform.scale = {
          ...newTransform.scale,
          [axis]: value,
        };
      }

      // Update preview transform (no DB call)
      previewSTL(file.stlId, newTransform);
    }
  };

  /**
   * Gizmo Transform 변경 핸들러 (Drag 완료 시)
   */
  const handleGizmoTransformChange = async (stlId: string, mesh: Mesh) => {
    console.log('[ViewerPage] handleGizmoTransformChange called for:', stlId);
    console.log('[ViewerPage] Mesh position:', mesh.position);
    console.log('[ViewerPage] Mesh rotation:', mesh.rotationQuaternion);

    if (!user || !projectId) return;

    // 기존 transform 가져오기
    const file = stlFiles.find(f => f.stlId === stlId);
    if (!file) {
      console.error('[ViewerPage] File not found in stlFiles:', stlId);
      console.log('[ViewerPage] Available stlFiles:', stlFiles.map(f => f.stlId));
      return;
    }

    const oldTransform = file.currentTransform;

    // 기즈모로 회전·이동해도 Z 거리(바닥 높이)는 유지 — 명시적 2단계 재안착:
    //   1) plate 안착 (mesh world yMin = 0)
    //   2) oldTransform.translation.z 만큼 위로 띄움
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();
    let minY = mesh.getBoundingInfo().boundingBox.minimumWorld.y;
    mesh.position.y -= minY;
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();
    minY = mesh.getBoundingInfo().boundingBox.minimumWorld.y;
    if (Math.abs(minY) > 1e-4) {
      mesh.position.y -= minY;
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo();
    }
    mesh.position.y += oldTransform.translation.z;
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo();

    // Mesh에서 현재 transform 추출 (Babylon → 사용자 좌표계 변환 포함)
    const newTransform = getTransformFromMesh(mesh);
    console.log('[ViewerPage] Transform from mesh:', newTransform);
    console.log('[ViewerPage] Old transform:', oldTransform);

    // 되돌리기용: translation/rotation 중 하나라도 바뀌면 변경 전 상태 저장
    const undoNeeded =
      Math.abs(newTransform.translation.x - oldTransform.translation.x) > 0.0001 ||
      Math.abs(newTransform.translation.y - oldTransform.translation.y) > 0.0001 ||
      Math.abs(newTransform.translation.z - oldTransform.translation.z) > 0.0001 ||
      Math.abs(newTransform.rotation.x - oldTransform.rotation.x) > 0.0001 ||
      Math.abs(newTransform.rotation.y - oldTransform.rotation.y) > 0.0001 ||
      Math.abs(newTransform.rotation.z - oldTransform.rotation.z) > 0.0001 ||
      Math.abs(newTransform.rotation.w - oldTransform.rotation.w) > 0.0001;
    if (undoNeeded) {
      pushUndoGroup([{ stlId, transform: oldTransform }]);
    }

    // Translation 변경사항 계산 및 저장
    const translationChanged =
      Math.abs(newTransform.translation.x - oldTransform.translation.x) > 0.0001 ||
      Math.abs(newTransform.translation.y - oldTransform.translation.y) > 0.0001 ||
      Math.abs(newTransform.translation.z - oldTransform.translation.z) > 0.0001;

    console.log('[ViewerPage] Translation changed:', translationChanged);

    if (translationChanged) {
      // 가장 큰 변화가 있는 축을 찾아 delta 계산
      const deltaX = newTransform.translation.x - oldTransform.translation.x;
      const deltaY = newTransform.translation.y - oldTransform.translation.y;
      const deltaZ = newTransform.translation.z - oldTransform.translation.z;

      const maxDelta = Math.max(Math.abs(deltaX), Math.abs(deltaY), Math.abs(deltaZ));
      let axis: 'x' | 'y' | 'z' = 'x';
      let deltaValue = deltaX;

      if (Math.abs(deltaY) === maxDelta) {
        axis = 'y';
        deltaValue = deltaY;
      } else if (Math.abs(deltaZ) === maxDelta) {
        axis = 'z';
        deltaValue = deltaZ;
      }

      console.log(`[ViewerPage] Saving translation: axis=${axis}, delta=${deltaValue}`);

      await adjustSTL(
        projectId,
        stlId,
        user.userId,
        AdjustmentType.TRANSLATION,
        { [axis]: deltaValue },
        newTransform
      );
    }

    // Rotation 변경사항 확인 및 저장
    const rotationChanged =
      Math.abs(newTransform.rotation.x - oldTransform.rotation.x) > 0.0001 ||
      Math.abs(newTransform.rotation.y - oldTransform.rotation.y) > 0.0001 ||
      Math.abs(newTransform.rotation.z - oldTransform.rotation.z) > 0.0001 ||
      Math.abs(newTransform.rotation.w - oldTransform.rotation.w) > 0.0001;

    console.log('[ViewerPage] Rotation changed:', rotationChanged);

    if (rotationChanged) {
      console.log('[ViewerPage] Saving rotation');

      // Rotation은 quaternion 전체를 저장
      await adjustSTL(
        projectId,
        stlId,
        user.userId,
        AdjustmentType.ROTATION,
        { x: 0, y: 0, z: 0 }, // Delta는 의미 없음 (quaternion)
        newTransform
      );
    }
  };


  /**
   * Transform 리셋 핸들러
   */
  const handleTransformReset = async () => {
    if (selectedFiles.length === 0 || !user || !projectId) return;

    const defaultTransform = {
      translation: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    };

    // 되돌리기용: 리셋 전 상태 저장
    pushUndoGroup(selectedFiles.map((f) => ({ stlId: f.stlId, transform: f.currentTransform })));

    // 각 축에 대해 리셋
    for (const file of selectedFiles) {
      await adjustSTL(
        projectId,
        file.stlId,
        user.userId,
        AdjustmentType.TRANSLATION,
        { x: -file.currentTransform.translation.x, y: -file.currentTransform.translation.y, z: -file.currentTransform.translation.z },
        defaultTransform
      );
    }
  };

  /**
   * 뷰어 컨트롤 핸들러들
   */
  const handleZoomIn = () => {
    // TODO: 카메라 줌 인 구현
    console.log('Zoom in');
  };

  const handleZoomOut = () => {
    // TODO: 카메라 줌 아웃 구현
    console.log('Zoom out');
  };

  const handleResetView = () => {
    // TODO: 카메라 뷰 리셋 구현
    console.log('Reset view');
  };

  /**
   * Slicer 핸들러
   */
  const handleSlice = async (settings: SliceSettings) => {
    if (selectedFiles.length === 0) {
      alert('Please select a model to slice.');
      return;
    }

    // Collect all vertex data from selected meshes
    const allPositions: number[] = [];

    for (const file of selectedFiles) {
      const mesh = meshMapRef.current.get(file.stlId);
      if (!mesh) {
        console.warn(`[ViewerPage] Mesh not found for ${file.fileName}, skipping.`);
        continue;
      }

      // Get vertices (local)
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions) continue;

      // Bake transform and map coordinates
      const worldMatrix = mesh.getWorldMatrix();
      const m = worldMatrix.m;

      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const y = positions[i + 1];
        const z = positions[i + 2];

        // Transform to World Coordinates
        const wx = x * m[0] + y * m[4] + z * m[8] + m[12];
        const wy = x * m[1] + y * m[5] + z * m[9] + m[13];
        const wz = x * m[2] + y * m[6] + z * m[10] + m[14];

        // Map Babylon World Coordinates (Y-up) to Slicer Coordinates (Z-up)
        // Slicer X = World X
        // Slicer Y = World Z
        // Slicer Z = World Y
        allPositions.push(wx);
        allPositions.push(wz);
        allPositions.push(wy);
      }
    }

    if (allPositions.length === 0) {
      alert('No valid mesh data found in selected files.');
      return;
    }

    const mergedMeshData = new Float32Array(allPositions);

    setIsSlicing(true);
    setSliceProgress(0);
    setSliceStatus('Initializing...');
    setSlicedLayers([]);

    try {
      const layers = await slicerService.slice(mergedMeshData, settings, (progress) => {
        setSliceProgress(progress.progress);
        setSliceStatus(progress.message);
      });

      setSlicedLayers(layers);
      setLastSliceSettings(settings);
      setSliceStatus('Slicing complete!');
      setSlicerViewMode('2d');
    } catch (err) {
      console.error('Slicing failed:', err);
      setSliceStatus('Slicing failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsSlicing(false);
    }
  };

  if (projectLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading project...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 mb-4">Project not found</div>
          <button
            onClick={() => navigate('/projects')}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm z-10">
        <div className="px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/projects')}
                className="text-gray-600 hover:text-gray-800"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
              </button>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{project.projectName}</h1>
                <p className="text-sm text-gray-600">
                  Project Code: <span className="font-mono">{project.projectCode}</span>
                </p>
              </div>
            </div>

            {/* 파일 업로드 버튼 */}
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setIsSlicerOpen(true)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Slicer
              </button>

              <button
                onClick={() => setShowFileBrowser(true)}
                disabled={uploading}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {uploading ? '가져오는 중...' : '+ STL 파일 열기'}
              </button>

              {/* Settings Button */}
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Settings"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - STL File List */}
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
          <div className="p-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">STL Files</h2>
            {filesLoading ? (
              <div className="text-center text-gray-600 py-4">Loading files...</div>
            ) : (
              <STLFileList
                stlFiles={stlFiles}
                onToggleVisibility={toggleVisibility}
                onDeleteFile={deleteFile}
                onSelectFile={handleFileSelect}
                onClearSelection={handleClearSelection}
                selectedFileIds={selectedFileIds}
              />
            )}
          </div>
        </aside>

        {/* 3D Viewer */}
        <main className="flex-1 relative bg-gray-900">
          <STLViewer
            stlFiles={stlFiles}
            selectedFileIds={Array.from(selectedFileIds)}
            onMeshSelected={(id) => handleFileSelect(id, false)} // Viewer click selects single
            onGizmoTransformChange={handleGizmoTransformChange}
            onMeshLoaded={handleMeshLoaded} // Store mesh ref
            unselectedOpacity={1 - transparency / 100} // Convert 0-100% transparency to 1-0 opacity
            showGizmo={rightPanelTab === 'transform' && gizmoEnabled} // Transform 탭 + Rotation 버튼 ON
            supportTool={supportTool}
            brushThickness={brushThickness}
            onBrushThicknessChange={setBrushThickness}
            supportSettings={supportSettings}
            clearSupportsSignal={clearSupportsSignal}
            generateSupportsSignal={generateSupportsSignal}
            autoAngleSignal={autoAngleSignal}
            findMarginSignal={findMarginSignal}
            scopedSupportSignal={scopedSupportSignal}
            sliceLayerHeight={sliceLayerHeight}
            detectIslandsSignal={detectIslandsSignal}
            currentLayerIndex={sliceLayerIndex}
            onIslandDetectionComplete={(info) => {
              setSliceIslandStats({
                totalIslandFaces: info.totalIslandFaces,
                perLayerCount: info.perLayerIslandCount,
              });
              // 검출 후에도 전체 적층 상태 유지 (별도 sliceLayerIndex 강제 안 함)
            }}
            onSliceRangeChange={(info) => {
              if (!info) {
                setSliceTotalLayers(0);
                setSliceYRange(null);
                return;
              }
              setSliceTotalLayers(info.nSlices);
              setSliceYRange({ yMin: info.yMin, yMax: info.yMax });
            }}
            className="w-full h-full"
          />

          {/* Viewer Controls */}
          <div className="absolute top-4 right-4">
            <ViewerControls
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onResetView={handleResetView}
            />
          </div>

          {/* Layer Slider — STL 로드되면 항상 활성, Island 검출 무관 */}
          {sliceTotalLayers > 0 && sliceYRange && (
            <LayerSlider
              totalLayers={sliceTotalLayers}
              currentLayer={sliceLayerIndex}
              onChange={setSliceLayerIndex}
              perLayerIslandCount={sliceIslandStats?.perLayerCount ?? []}
              yMin={sliceYRange.yMin}
              layerHeight={sliceLayerHeight}
              enabled={true}
              onLayerHeightChange={setSliceLayerHeight}
            />
          )}
        </main>

        {/* Right Sidebar - Transform & History */}
        <aside className="w-80 bg-white border-l border-gray-200 flex-shrink-0 flex flex-col">
          {/* 탭 헤더 */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setRightPanelTab('transform')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${rightPanelTab === 'transform'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              Transform
            </button>
            <button
              onClick={() => setRightPanelTab('supporter')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${rightPanelTab === 'supporter'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              Supporter
            </button>
            <button
              onClick={() => setRightPanelTab('history')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${rightPanelTab === 'history'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              History
            </button>
          </div>

          {/* 탭 콘텐츠 */}
          <div className="flex-1 overflow-y-auto">
            {rightPanelTab === 'transform' && (
              <div className="p-4">
                <TransformPanel
                  selectedFile={primarySelectedFile}
                  onTransformChange={handleTransformChange}
                  onPreview={handleTransformPreview}
                  onReset={handleTransformReset}
                  gizmoActive={gizmoEnabled}
                  onToggleGizmo={() => setGizmoEnabled((v) => !v)}
                />
                {selectedFiles.length > 1 && (
                  <div className="mt-2 text-xs text-blue-600 text-center">
                    Applying to {selectedFiles.length} selected files
                  </div>
                )}
              </div>
            )}
            {rightPanelTab === 'supporter' && (
              <div className="p-4">
                <SupporterPanel
                  selectedFile={primarySelectedFile}
                  onTransformChange={handleTransformChange}
                  onPreview={handleTransformPreview}
                  supportSettings={supportSettings}
                  onSupportSettingsChange={setSupportSettings}
                  supportTool={supportTool}
                  onSetSupportTool={setSupportTool}
                  brushThickness={brushThickness}
                  onBrushThicknessChange={setBrushThickness}
                  onGenerateRegionSupports={() =>
                    setGenerateSupportsSignal((n) => n + 1)
                  }
                  onAutoAngle={() => setAutoAngleSignal((n) => n + 1)}
                  onScopedSupport={() => setScopedSupportSignal((n) => n + 1)}
                  onFindMargin={() => setFindMarginSignal((n) => n + 1)}
                  onClearSupports={() => setClearSupportsSignal((n) => n + 1)}
                  sliceLayerHeight={sliceLayerHeight}
                  onSliceLayerHeightChange={setSliceLayerHeight}
                  onDetectIslands={() => setDetectIslandsSignal((n) => n + 1)}
                />
              </div>
            )}
            {rightPanelTab === 'history' && (
              <HistoryViewer
                stlId={primarySelectedFile?.stlId}
                isMaster={user?.role === 'master'}
                className="h-full"
              />
            )}
          </div>
        </aside>
      </div>


      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        transparency={transparency}
        onTransparencyChange={setTransparency}
      />

      {/* Slicer Modal */}
      {isSlicerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
          <div className="bg-gray-900 p-6 rounded-lg shadow-xl max-w-6xl w-full h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-white">Hybrid Slicer</h2>
              <button
                onClick={() => setIsSlicerOpen(false)}
                className="text-gray-400 hover:text-white"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 flex space-x-4 overflow-hidden">
              {/* Left: Settings */}
              <div className="w-80 flex-shrink-0 overflow-y-auto">
                <SlicerPanel
                  onSlice={handleSlice}
                  isSlicing={isSlicing}
                  progress={sliceProgress}
                  statusMessage={sliceStatus}
                />
              </div>

              {/* Right: Preview */}
              <div className="flex-1 bg-black rounded border border-gray-700 flex flex-col overflow-hidden relative">
                {/* View Mode Toggle */}
                <div className="absolute top-4 right-4 z-10 flex space-x-2">
                  <button
                    onClick={() => setSlicerViewMode('3d')}
                    className={`px-3 py-1 rounded text-sm font-medium ${slicerViewMode === '3d'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                  >
                    3D Model
                  </button>
                  <button
                    onClick={() => setSlicerViewMode('2d')}
                    className={`px-3 py-1 rounded text-sm font-medium ${slicerViewMode === '2d'
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    disabled={slicedLayers.length === 0}
                  >
                    Sliced Layers
                  </button>
                </div>

                {slicerViewMode === '3d' ? (
                  <div className="w-full h-full">
                    <STLViewer
                      stlFiles={selectedFiles}
                      selectedFileIds={Array.from(selectedFileIds)}
                      className="w-full h-full"
                      unselectedOpacity={1}
                    />
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-4">
                    {slicedLayers.length > 0 ? (
                      <SlicePreview
                        layers={slicedLayers}
                        nozzleDiameter={lastSliceSettings?.nozzleDiameter}
                      />
                    ) : (
                      <div className="text-gray-500">
                        No sliced data available. Click "Slice Model" to generate.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Local File Browser */}
      {showFileBrowser && (
        <LocalFileBrowser
          onSelect={handleFilesSelected}
          onClose={() => setShowFileBrowser(false)}
        />
      )}
    </div >
  );
};

export default ViewerPage;
