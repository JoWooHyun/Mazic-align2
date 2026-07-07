import { useState, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Mesh, VertexBuffer } from '@babylonjs/core';
import { useAuth } from '@hooks/useAuth';
import { useProject } from '@hooks/useProjects';
import { useSTLFiles } from '@hooks/useSTLFiles';
import { useKeyboardShortcuts } from '@hooks/useKeyboardShortcuts';
import STLViewer from '@components/STLViewer';
import type { STLViewerHandle, GizmoMode, ViewMode } from '@components/STLViewer';
import StatusBar from '@components/StatusBar';
import STLFileList from '@components/STLFileList';
import ViewerControls from '@components/ViewerControls';
import Toolbar from '@components/Toolbar';
import TransformPanel from '@components/TransformPanel';
import HistoryViewer from '@components/HistoryViewer';
import SettingsModal from '@components/SettingsModal';
import SlicerPanel from '@components/Slicer/SlicerPanel';
import SlicePreview from '@components/Slicer/SlicePreview';
import LocalFileBrowser from '@components/LocalFileBrowser';
import { slicerService } from '@services/slicer/SlicerService';
import { importSTLFromPath } from '@services/stl.service';
import { SliceSettings, LayerData, SliceMetadata } from '@services/slicer/types';
import JSZip from 'jszip';
import { AdjustmentType } from '../types/stl.types';
import { getTransformFromMesh } from '@utils/stl-loader.utils';

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
    addLocalFile,
    toggleVisibility,
    deleteFile,
    adjustSTL,
    previewSTL,
  } = useSTLFiles(projectId);

  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'transform' | 'history' | 'support'>('transform');

  // Settings state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [transparency, setTransparency] = useState(80); // 0-100% (Default 80%)

  // Slicer state
  const [isSlicerOpen, setIsSlicerOpen] = useState(false);
  const [isSlicing, setIsSlicing] = useState(false);
  const [sliceProgress, setSliceProgress] = useState(0);
  const [sliceStatus, setSliceStatus] = useState('');
  const [slicedLayers, setSlicedLayers] = useState<LayerData[]>([]);
  const [fullGcode, setFullGcode] = useState<string>('');
  const [sliceMetadata, setSliceMetadata] = useState<SliceMetadata | null>(null);
  const [lastSliceSettings, setLastSliceSettings] = useState<SliceSettings | null>(null);
  const [slicerViewMode, setSlicerViewMode] = useState<'3d' | '2d'>('3d');

  // Drag & Drop state
  const [isDragOver, setIsDragOver] = useState(false);

  // Build plate config (from localStorage)
  const [buildPlateConfig] = useState(() => {
    const saved = localStorage.getItem('mazicalign_slicer_settings');
    if (saved) {
      try {
        const p = JSON.parse(saved);
        return { width: p.buildWidth || 192, depth: p.buildDepth || 120, height: p.buildHeight || 200 };
      } catch { /* fallback */ }
    }
    return { width: 192, depth: 120, height: 200 };
  });

  // Gizmo mode & View mode
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('move');
  const [viewMode, setViewMode] = useState<ViewMode>('solid');

  // Refs
  const viewerRef = useRef<STLViewerHandle>(null);
  const pendingScaleUpdates = useRef<{ x?: number; y?: number; z?: number }>({});
  const scaleUpdateTimeout = useRef<NodeJS.Timeout | null>(null);
  const meshMapRef = useRef<Map<string, Mesh>>(new Map());

  // 선택된 파일 객체들
  const selectedFiles = stlFiles.filter((f) => selectedFileIds.has(f.stlId));
  // 대표 파일 (Transform 패널 표시용 - 첫 번째 선택된 파일)
  const primarySelectedFile = selectedFiles.length > 0 ? selectedFiles[0] : null;

  // 선택된 메쉬 정보 (StatusBar용)
  const selectedMeshInfo = useMemo(() => {
    if (selectedFiles.length === 0) return null;
    const mesh = meshMapRef.current.get(selectedFiles[0].stlId);
    if (!mesh) return null;
    mesh.computeWorldMatrix(true);
    const bi = mesh.getBoundingInfo();
    const ext = bi.boundingBox.extendSizeWorld;
    return {
      triangles: Math.floor(mesh.getTotalIndices() / 3),
      boundingSize: { x: ext.x * 2, y: ext.z * 2, z: ext.y * 2 }, // Babylon Y-up → slicer Z-up
    };
  }, [selectedFiles, stlFiles]);

  /**
   * Mesh Load Handler
   */
  const handleMeshLoaded = useCallback((id: string, mesh: Mesh) => {
    meshMapRef.current.set(id, mesh);
  }, []);

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

    // Mesh에서 현재 transform 추출 (Babylon → 사용자 좌표계 변환 포함)
    const newTransform = getTransformFromMesh(mesh);
    console.log('[ViewerPage] Transform from mesh:', newTransform);

    // 기존 transform 가져오기
    const file = stlFiles.find(f => f.stlId === stlId);
    if (!file) {
      console.error('[ViewerPage] File not found in stlFiles:', stlId);
      console.log('[ViewerPage] Available stlFiles:', stlFiles.map(f => f.stlId));
      return;
    }

    const oldTransform = file.currentTransform;
    console.log('[ViewerPage] Old transform:', oldTransform);

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
  const handleZoomIn = () => viewerRef.current?.zoomIn();
  const handleZoomOut = () => viewerRef.current?.zoomOut();
  const handleResetView = () => viewerRef.current?.resetView();

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
      const result = await slicerService.slice(mergedMeshData, settings, (progress) => {
        setSliceProgress(progress.progress);
        setSliceStatus(progress.message);
      });

      setSlicedLayers(result.layers);
      setFullGcode(result.fullGcode);
      setSliceMetadata(result.metadata);
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

  /**
   * 드래그 앤 드롭 핸들러
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false when leaving the main area (not child elements)
    if (e.currentTarget === e.target) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.name.toLowerCase().endsWith('.stl')
    );

    if (files.length === 0) {
      alert('Please drop .stl files only.');
      return;
    }

    for (const file of files) {
      // 중복 체크
      const isDuplicate = stlFiles.some((f) => f.fileName === file.name);
      if (isDuplicate) {
        console.log(`[ViewerPage] File ${file.name} already exists, skipping`);
        continue;
      }
      addLocalFile(file);
    }
  }, [stlFiles, addLocalFile]);

  /**
   * ZIP 내보내기 핸들러
   */
  const handleExportZip = useCallback(async () => {
    if (slicedLayers.length === 0 || !sliceMetadata) return;

    const zip = new JSZip();
    const layersFolder = zip.folder('layers');

    // metadata.json
    zip.file('metadata.json', JSON.stringify(sliceMetadata, null, 2));

    // print.gcode (FDM G-code)
    if (fullGcode) {
      zip.file('print.gcode', fullGcode);
    }

    // Layer images
    for (const layer of slicedLayers) {
      if (!layer.imageData) continue;
      // Data URL → binary
      const base64 = layer.imageData.split(',')[1];
      if (base64 && layersFolder) {
        const padded = String(layer.index + 1).padStart(4, '0');
        layersFolder.file(`${padded}.png`, base64, { base64: true });
      }
    }

    // Generate and download
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const modelName = selectedFiles.length > 0 ? selectedFiles[0].fileName.replace('.stl', '') : 'model';
    a.href = url;
    a.download = `${modelName}_sliced.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [slicedLayers, sliceMetadata, fullGcode, selectedFiles]);

  /**
   * Gizmo 모드 변경 핸들러
   */
  const handleGizmoModeChange = useCallback((mode: GizmoMode) => {
    setGizmoMode(mode);
    viewerRef.current?.setGizmoMode(mode);
  }, []);

  /**
   * 키보드 단축키
   */
  const shortcutCallbacks = useMemo(() => ({
    onModeChange: (mode: GizmoMode) => {
      setGizmoMode(mode);
      viewerRef.current?.setGizmoMode(mode);
    },
    onFocusSelected: () => viewerRef.current?.focusOnSelected(),
    onDeleteSelected: () => {
      if (selectedFileIds.size === 0) return;
      const ids = Array.from(selectedFileIds);
      for (const id of ids) {
        deleteFile(id);
      }
      setSelectedFileIds(new Set());
    },
    onClearSelection: handleClearSelection,
    onSelectAll: () => setSelectedFileIds(new Set(stlFiles.map(f => f.stlId))),
  }), [selectedFileIds, deleteFile, stlFiles, handleClearSelection]);

  useKeyboardShortcuts(shortcutCallbacks);

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
        <main
          className="flex-1 relative bg-gray-900"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <STLViewer
            ref={viewerRef}
            stlFiles={stlFiles}
            selectedFileIds={Array.from(selectedFileIds)}
            onMeshSelected={(id) => handleFileSelect(id, false)} // Viewer click selects single
            onBackgroundClick={handleClearSelection} // Click background to deselect
            onGizmoTransformChange={handleGizmoTransformChange}
            onMeshLoaded={handleMeshLoaded} // Store mesh ref
            unselectedOpacity={1 - transparency / 100} // Convert 0-100% transparency to 1-0 opacity
            viewMode={viewMode}
            buildPlateConfig={buildPlateConfig}
            className="w-full h-full"
          />

          {/* Left Toolbar - Tool Mode Selector */}
          <div className="absolute top-4 left-4 z-10">
            <Toolbar activeMode={gizmoMode} onModeChange={handleGizmoModeChange} />
          </div>

          {/* Viewer Controls */}
          <div className="absolute top-4 right-4">
            <ViewerControls
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onResetView={handleResetView}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          </div>

          {/* Drag & Drop Overlay */}
          {isDragOver && (
            <div className="absolute inset-0 bg-primary-600 bg-opacity-30 border-4 border-dashed border-primary-400 flex items-center justify-center z-20 pointer-events-none">
              <div className="bg-gray-900 bg-opacity-80 px-8 py-6 rounded-xl">
                <p className="text-white text-xl font-semibold">Drop STL files here</p>
              </div>
            </div>
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
              onClick={() => setRightPanelTab('history')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${rightPanelTab === 'history'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              History
            </button>
            <button
              onClick={() => setRightPanelTab('support')}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${rightPanelTab === 'support'
                ? 'text-primary-600 border-b-2 border-primary-600'
                : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              Support
            </button>
          </div>

          {/* 탭 콘텐츠 */}
          <div className="flex-1 overflow-y-auto">
            {rightPanelTab === 'transform' ? (
              <div className="p-4">
                <TransformPanel
                  selectedFile={primarySelectedFile}
                  onTransformChange={handleTransformChange}
                  onPreview={handleTransformPreview}
                  onReset={handleTransformReset}
                />
                {selectedFiles.length > 1 && (
                  <div className="mt-2 text-xs text-blue-600 text-center">
                    Applying to {selectedFiles.length} selected files
                  </div>
                )}
              </div>
            ) : rightPanelTab === 'history' ? (
              <HistoryViewer
                stlId={primarySelectedFile?.stlId}
                isMaster={user?.role === 'master'}
                className="h-full"
              />
            ) : (
              /* Support Tab - Shell UI */
              <div className="p-4 space-y-4">
                <div className="text-center py-8">
                  <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <p className="text-gray-400 text-sm font-medium mb-2">Support Generation</p>
                  <p className="text-gray-500 text-xs">Coming Soon</p>
                </div>

                {/* Support settings placeholder (disabled) */}
                <div className="opacity-40 pointer-events-none space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Contact Shape</label>
                    <select className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" disabled>
                      <option>Sphere</option>
                      <option>None</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Contact Diameter (mm)</label>
                    <input type="number" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" value="0.6" disabled />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Support Density (%)</label>
                    <input type="number" className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded" value="50" disabled />
                  </div>
                  <div className="flex space-x-2 pt-2">
                    <button className="flex-1 px-3 py-2 bg-primary-600 text-white text-sm rounded" disabled>
                      Auto Support
                    </button>
                    <button className="flex-1 px-3 py-2 bg-gray-200 text-gray-700 text-sm rounded" disabled>
                      Manual
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Status Bar */}
      <StatusBar
        totalModels={stlFiles.length}
        selectedCount={selectedFiles.length}
        selectedMeshInfo={selectedMeshInfo}
        buildPlateSize={buildPlateConfig}
        gizmoMode={gizmoMode}
      />

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
              <div className="flex items-center space-x-4">
                <h2 className="text-2xl font-bold text-white">Hybrid Slicer</h2>
                {sliceMetadata && (
                  <span className="text-sm text-gray-400">
                    {sliceMetadata.totalLayers} layers | Est. {Math.floor(sliceMetadata.estimatedTime / 60)}m {Math.round(sliceMetadata.estimatedTime % 60)}s
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleExportZip}
                  disabled={slicedLayers.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Export ZIP
                </button>
                <button
                  onClick={() => setIsSlicerOpen(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
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
