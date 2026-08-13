import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";

import { useProjectV2 } from "../hooks/useProjectsV2";
import { useStlFilesV2 } from "../hooks/useStlFilesV2";
import { useSupportsV2 } from "../hooks/useSupportsV2";
import { useShortcutsListener, useShortcutHandler } from "../hooks/useShortcuts";
import { useSupportParamsStore } from "../support";
import BabylonScene, {
  type BabylonSceneHandle,
  type GizmoMode,
} from "../components/BabylonScene";
import { type EditMode } from "../components/EditModeControls";
import SliceSidePanel from "../components/SliceSidePanel";
import GithubProjectDialog from "../components/GithubProjectDialog";
import PrinterProfileDialog from "../components/PrinterProfileDialog";
import ViewerContextMenu from "../components/ViewerContextMenu";
import StlFileList from "../components/StlFileList";
import { useCurrentProfile } from "../hooks/usePrinterProfileStore";
import { IDENTITY_TRANSFORM } from "../types/transform";

import { useClipboardActions } from "./viewer/hooks/useClipboardActions";
import { useViewerShortcuts } from "./viewer/hooks/useViewerShortcuts";
import { useTransformCommit } from "./viewer/hooks/useTransformCommit";
import { useSupportEditing } from "./viewer/hooks/useSupportEditing";
import { useDentalWorkflow } from "./viewer/hooks/useDentalWorkflow";
import { useSliceExport } from "./viewer/hooks/useSliceExport";
import { useStlDropImport } from "./viewer/hooks/useStlDropImport";
import ViewerHeader from "./viewer/components/ViewerHeader";
import ViewportOverlays from "./viewer/components/ViewportOverlays";
import ViewportInfoPanels from "./viewer/components/ViewportInfoPanels";
import ViewerSidePanel from "./viewer/components/ViewerSidePanel";

/**
 * v2 프로젝트 작업 화면.
 *
 * 데이터 훅 배선 + 핵심 공유 상태 + 기능별 훅(서포트 편집/변환/dental/내보내기/
 * 드롭 임포트/단축키) 조립 + JSX 골격만 담는다. 실제 핸들러·상태는 각 훅으로,
 * 마크업 덩어리는 pages/viewer/components 하위 컴포넌트로 분리돼 있다.
 */
const ViewerV2Page: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { project, loading, error } = useProjectV2(projectId);

  const {
    files,
    loading: filesLoading,
    add: addStlFile,
    remove: removeStlFile,
    updateTransform,
  } = useStlFilesV2(projectId);

  const {
    supports,
    addMany: addSupports,
    clearAll: clearAllSupports,
    refresh: refreshSupports,
    patchSupport,
  } = useSupportsV2(projectId);

  // supports closure 가 stale 일 때 항상 최신 값을 보기 위한 ref.
  // handleCommitTransform / followAttachedChildren 등 비동기 콜백에서 사용.
  const supportsRef = useRef(supports);
  supportsRef.current = supports;

  // ----- 핵심 공유 상태 (페이지 유지) -----
  const [ghDialog, setGhDialog] = useState<"save" | "load" | null>(null);
  const [panelTab, setPanelTab] = useState<"transform" | "support" | "dental">(
    "transform",
  );
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 기본 translate — STL 단일 선택 시 자동으로 X/Y/Z 이동 화살표 표시.
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [alignFloorMode, setAlignFloorMode] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("select");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  // 뷰포트 우클릭 컨텍스트 메뉴 위치 (화면 좌표). null 이면 닫힘 (P5).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const sceneHandleRef = useRef<BabylonSceneHandle>(null);

  const overhangAngleDeg = useSupportParamsStore(
    (s) => s.params.overhangAngleDeg,
  );
  const supportParams = useSupportParamsStore((s) => s.params);
  const printerProfile = useCurrentProfile();

  useShortcutsListener();

  // ----- 기능별 훅 조립 -----
  // 파일 선택/클립보드/undo·redo 단축키.
  useClipboardActions({
    files,
    selectedIds,
    setSelectedIds,
    addStlFile,
    removeStlFile,
  });

  // 뷰 프리셋·줌·도구 단축키 (zoomFit 은 컨텍스트 메뉴 재사용).
  const { zoomFit } = useViewerShortcuts({
    sceneHandleRef,
    selectedIds,
    editMode,
    setGizmoMode,
  });

  // 슬라이스 프리뷰 상태 + 내보내기 핸들러.
  const {
    slicePreview,
    setSlicePreview,
    sceneTopY,
    setSceneTopY,
    batchExport,
    sliceYNow,
    layerCount,
    handleExportMasksZip,
    handleExportCtb,
    handleExportGcode,
    handleExportStl,
  } = useSliceExport({
    files,
    project,
    supportsLength: supports.length,
    printerProfile,
    sceneHandleRef,
  });

  // STL transform 프리뷰/커밋 + 부착 서포트 추종.
  const { handlePreviewTransform, handleCommitTransform, followAttachedChildren } =
    useTransformCommit({
      supports,
      supportsRef,
      sceneHandleRef,
      updateTransform,
      patchSupport,
    });

  // 서포트/브릿지 편집 상태·핸들러 (followAttachedChildren 주입).
  const support = useSupportEditing({
    projectId,
    files,
    supports,
    supportParams,
    sceneHandleRef,
    editMode,
    selectedIds,
    setSelectedIds,
    addSupports,
    clearAllSupports,
    refreshSupports,
    patchSupport,
    addStlFile,
    removeStlFile,
    updateTransform,
    followAttachedChildren,
    setCtxMenu,
  });

  // Dental 색칠/마진/아일랜드/검출→서포트 상태·핸들러.
  const dental = useDentalWorkflow({
    projectId,
    supportParams,
    sceneHandleRef,
    layerHeightMm: slicePreview.layerHeightMm,
    addSupports,
    refreshSupports,
  });

  // 네이티브 열기 + 드래그앤드롭.
  const {
    isDragOver,
    fileInputRef,
    handleNativeInputChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useStlDropImport({ addStlFile, setSelectedIds });

  // support 편집 델리게이트에서 자주 쓰는 setter/상태를 지역 별칭으로.
  const {
    bridgeMode,
    setBridgeMode,
    pendingBridge,
    setPendingBridge,
    selectedSupportId,
    setSelectedSupportId,
    selectedCp,
    setSelectedCp,
    autoBusy,
    handleDeleteSelectedSupport,
  } = support;

  const { setMarginStatus, setIslandStatus } = dental;

  // ----- 선택 -----
  const handlePick = (id: string | null, opts: { multi: boolean }) => {
    setSelectedIds((prev) => {
      if (!id) return opts.multi ? prev : new Set();
      const next = new Set(prev);
      if (opts.multi) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  };

  // delete 단축키는 서포트/STL 삭제가 얽혀 useSupportEditing 의 핸들러로 등록.
  useShortcutHandler("delete", handleDeleteSelectedSupport);

  // STL 이 삭제되면 dental 세션 상태(마진/아일랜드 결과)를 리셋한다 (2-3b 잔여 ①).
  //   BabylonScene 은 mesh 제거 시 해당 STL 의 시각화를 내부에서 정리하지만,
  //   여기 React 상태(marginStatus/islandStatus)는 별도라 stale 로 남는다. 삭제
  //   경로가 여러 개(handleRemove/handleCut/키보드 Delete)라 개별 처리 대신 파일
  //   id 집합 변화를 감지해 한 곳에서 리셋 — 삭제(집합 축소)일 때만 초기화.
  const prevFileIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const prev = prevFileIdsRef.current;
    const nextIds = new Set(files.map((f) => f.id));
    let removed = false;
    for (const id of prev) {
      if (!nextIds.has(id)) {
        removed = true;
        break;
      }
    }
    prevFileIdsRef.current = nextIds;
    if (removed) {
      setMarginStatus(null);
      setIslandStatus(null);
    }
  }, [files, setMarginStatus, setIslandStatus]);

  // 잘못된 마이그레이션 reverse (stl-local → world).
  // 0c83dd2 의 timing 문제로 stl-local 좌표가 STL transform 적용 전
  // 기준으로 저장 → 새로고침 시 saved transform 이 한 번 더 곱해져
  // 위치 어긋남. 사용자가 현재 보고 있는 위치 (= 잘못된 위치) 를
  // 그대로 world 좌표로 받아 적고 coordSpace='world' 로 되돌림.
  // 이후 race 옛 동작으로 복귀 (transform 시 patch chain). 새 supports
  // 에 timing-safe stl-local 도입은 별도 commit.
  // 대상은 **kind 없는 옛 데이터 점만** — 재설계 점(kind='island'|'slope')은
  // S-4b-1 의 timing-safe stl-local 이 정본이라 되돌리면 안 된다. 되돌리면
  // 1.5s 뒤 supports 가 바뀌어 서포트가 재생성·점프한다(B-2).
  useEffect(() => {
    if (filesLoading) return;
    if (supports.length === 0) return;
    const toRevert = supports.filter(
      (s) => s.coordSpace === "stl-local" && s.kind == null,
    );
    if (toRevert.length === 0) return;
    const handle = sceneHandleRef.current;
    if (!handle) return;
    // STL transform 이 BabylonScene 의 비동기 STL 로드 후 적용되는
    // 시점까지 충분히 대기 (1.5s — Promise.all 안의 applyTransform 보장).
    const t = setTimeout(() => {
      void (async () => {
        for (const s of toRevert) {
          const newContact = handle.stlLocalToWorld(s.stlId, s.contact);
          if (!newContact) continue;
          const newBase = handle.stlLocalToWorld(s.stlId, s.base) ?? s.base;
          let newCps = s.curveControlPoints;
          if (newCps) {
            newCps = newCps.map(
              (cp) => handle.stlLocalToWorld(s.stlId, cp) ?? cp,
            ) as typeof newCps;
          }
          await patchSupport(s.id, {
            contact: newContact,
            base: newBase,
            ...(newCps ? { curveControlPoints: newCps } : {}),
            coordSpace: "world",
          });
        }
      })();
    }, 1500);
    return () => clearTimeout(t);
  }, [filesLoading, supports, patchSupport]);

  // Esc 단계적 해제 (P3, 프루사 정합).
  //   우선순위: Bridge pending 취소 → 서포트/변곡점 선택 해제 → STL 선택 해제.
  //   한 번의 Esc 로는 가장 위 단계 하나만 해제하고 종료(early return)해,
  //   여러 상태가 동시에 있을 때 한 방에 전부 날아가지 않도록 한다.
  //   INPUT/TEXTAREA 등 텍스트 입력 중에는 브라우저 기본 동작(입력 취소 등) 유지.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 다이얼로그가 열려 있으면 Esc는 다이얼로그가 처리 — 뷰어 선택 해제와 동시 발동 방지 (P5)
      if (profileDialogOpen || ghDialog !== null) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      // 1) Bridge pending (첫 점 찍은 상태) 취소.
      if (pendingBridge) {
        setPendingBridge(null);
        return;
      }
      // 2) 서포트/변곡점 선택 해제.
      if (selectedCp) {
        setSelectedCp(null);
        return;
      }
      if (selectedSupportId) {
        setSelectedSupportId(null);
        return;
      }
      // 3) STL 선택 해제.
      if (selectedIds.size > 0) {
        setSelectedIds(new Set());
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    pendingBridge,
    selectedCp,
    selectedSupportId,
    selectedIds,
    profileDialogOpen,
    ghDialog,
    setPendingBridge,
    setSelectedCp,
    setSelectedSupportId,
  ]);

  if (!projectId) {
    return <Navigate to="/v2/projects" replace />;
  }

  async function handleRemove(id: string) {
    await removeStlFile(id);
    // STL 삭제 시 DB cascade 로 supports 도 사라지므로 state sync.
    await refreshSupports();
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // 단일 선택만 Transform 패널에 표시.
  const selectedFile =
    selectedIds.size === 1
      ? files.find((f) => selectedIds.has(f.id)) ?? null
      : null;
  const transformPanelSelected = selectedFile
    ? {
        id: selectedFile.id,
        fileName: selectedFile.fileName,
        transform: selectedFile.transform ?? IDENTITY_TRANSFORM,
      }
    : null;

  // 수치 패널의 회전·스케일 피벗 = 선택 모델의 현재 bbox 중심 (B-9).
  //   패널이 드래그 시작 시점에 한 번 물어 스냅샷으로 쓴다. 씬/모델이 아직
  //   없으면 null → 패널은 기존 무보정 동작으로 폴백한다.
  //   ⚠️ 평범한 함수로 둔다 — 이 지점은 위쪽 early return(!projectId) 아래라
  //   useCallback 을 쓰면 훅 호출 순서가 렌더마다 달라진다(rules-of-hooks).
  //   호출 시점에 최신 ref/선택을 읽으므로 메모이제이션이 필요 없다.
  const selectedFileId = selectedFile?.id ?? null;
  const getTransformPivot = () => {
    if (!selectedFileId) return null;
    return sceneHandleRef.current?.getModelWorldPivot(selectedFileId) ?? null;
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <ViewerHeader
        project={project}
        loading={loading}
        projectId={projectId}
        filesLength={files.length}
        slicePreviewOn={slicePreview.on}
        onBackToProjects={() => navigate("/v2/projects")}
        onEditProfile={() => setProfileDialogOpen(true)}
        onToggleSlicePreview={() =>
          setSlicePreview((s) => {
            if (!s.on) {
              const top = sceneHandleRef.current?.getSceneTopY() ?? 0;
              setSceneTopY(top);
            }
            return { ...s, on: !s.on };
          })
        }
        onExportStl={handleExportStl}
        onGithubSave={() => setGhDialog("save")}
        onGithubLoad={() => setGhDialog("load")}
        onOpenStl={() => fileInputRef.current?.click()}
      />

      {/* 네이티브 파일 열기용 숨김 input — 버튼 클릭으로 트리거. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".stl"
        multiple
        className="hidden"
        onChange={handleNativeInputChange}
      />

      <div className="flex-1 flex min-h-0">
        <StlFileList
          files={files}
          selectedIds={selectedIds}
          onPick={(id, opts) => handlePick(id, opts)}
          onAdd={() => fileInputRef.current?.click()}
          onRemove={handleRemove}
          loading={filesLoading}
        />

        <main
          className="flex-1 relative bg-gray-100"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onPointerDown={support.handleViewportPointerDown}
          onPointerUp={support.handleViewportPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <BabylonScene
            ref={sceneHandleRef}
            files={files}
            selectedIds={selectedIds}
            onPick={handlePick}
            overhangAngleDeg={overhangAngleDeg}
            gizmoMode={gizmoMode}
            onGizmoCommit={handleCommitTransform}
            supports={supports}
            supportParams={supportParams}
            plateWidthMm={printerProfile.buildVolumeMm[0]}
            plateDepthMm={printerProfile.buildVolumeMm[1]}
            editMode={editMode}
            onAddSupportAt={support.handleAddSupportAt}
            onPickSupport={setSelectedSupportId}
            selectedSupportId={selectedSupportId}
            onMoveSupport={support.handleMoveSupport}
            pendingBridgePoint={pendingBridge?.contact ?? null}
            bridgeMode={bridgeMode}
            sliceY={slicePreview.on ? sliceYNow : null}
            onMoveBridgeControlPoint={support.handleMoveBridgeControlPoint}
            onMoveBridgeEndpoint={support.handleMoveBridgeEndpoint}
            onDoublePickStl={(id) => {
              setSelectedIds(new Set([id]));
              setGizmoMode("rotate");
            }}
            onDoublePickBridgeTube={(supportId, hit) =>
              void support.handleAddBridgeControlPoint(supportId, hit)
            }
            onSelectBridgeControlPoint={(supportId, idx) =>
              setSelectedCp({ supportId, idx })
            }
            alignFloorMode={alignFloorMode}
            onAlignFaceToFloor={(id, newT) => {
              const f = files.find((file) => file.id === id);
              const oldT = f?.transform ?? IDENTITY_TRANSFORM;
              // mesh 에 즉시 반영 (handleCommitTransform 은 preview
              // 가정이라 mesh 직접 안 움직임).
              sceneHandleRef.current?.previewTransform(id, newT);
              handleCommitTransform(id, oldT, newT);
              setAlignFloorMode(false); // 한 번 사용 후 자동 OFF
            }}
            brushThicknessMm={dental.brushThicknessMm}
            onPaintedFacesChange={dental.handlePaintedFacesChange}
            onBrushThicknessChange={dental.setBrushThicknessMm}
            onDentalResultsInvalidated={dental.handleDentalResultsInvalidated}
          />

          <ViewportOverlays
            files={files}
            selectedIds={selectedIds}
            editMode={editMode}
            gizmoMode={gizmoMode}
            alignFloorMode={alignFloorMode}
            bridgeMode={bridgeMode}
            pendingBridge={pendingBridge}
            selectedSupportId={selectedSupportId}
            supports={supports}
            onSetView={(p) => sceneHandleRef.current?.setView(p)}
            onFit={() => sceneHandleRef.current?.fit()}
            onGizmoModeChange={setGizmoMode}
            onToggleAlignFloor={() => setAlignFloorMode((v) => !v)}
            onEditModeChange={(m) => {
              setEditMode(m);
              setSelectedCp(null);
              // support 전용 상태는 support 모드가 아닐 때 정리.
              if (m !== "support") {
                setSelectedSupportId(null);
                setBridgeMode(false);
                setPendingBridge(null);
              }
              // 모드 진입 시 우측 패널을 해당 탭으로 전환 (Dental·Support 일관, 감사 #4).
              if (m === "dental-brush") setPanelTab("dental");
              if (m === "support") setPanelTab("support");
            }}
            onToggleBridge={() => {
              setBridgeMode((v) => !v);
              setPendingBridge(null);
            }}
            onResetBridgeCurve={() => void support.handleResetBridgeCurve()}
            onDeleteSelected={handleDeleteSelectedSupport}
          />

          {files.length === 0 && !isDragOver && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
              <div className="bg-white/90 backdrop-blur rounded-md shadow px-4 py-3 text-sm text-gray-600">
                좌측 '+ 추가' · 상단 'STL 열기' · STL 을 여기로 드래그하여
                가져오세요.
              </div>
            </div>
          )}

          {/* 드래그앤드롭 오버레이 — pointer-events-none 로 drop 이벤트가
              main 컨테이너에 그대로 도달하게 한다. */}
          {isDragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary-500/10 border-2 border-dashed border-primary-500 pointer-events-none">
              <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg px-6 py-4 text-base font-medium text-primary-700">
                여기에 STL 을 놓으세요
              </div>
            </div>
          )}

          <ViewportInfoPanels
            filesLength={files.length}
            overhangAngleDeg={overhangAngleDeg}
            plateWidthMm={printerProfile.buildVolumeMm[0]}
            plateDepthMm={printerProfile.buildVolumeMm[1]}
          />
        </main>

        {slicePreview.on && (
          <SliceSidePanel
            onClose={() =>
              setSlicePreview({
                on: false,
                layerIdx: 0,
                layerHeightMm: 0.05,
              })
            }
            sceneHandleRef={sceneHandleRef}
            sliceYNow={sliceYNow}
            layerIdx={slicePreview.layerIdx}
            layerHeightMm={slicePreview.layerHeightMm}
            layerCount={layerCount}
            sceneTopY={sceneTopY}
            onLayerIdxChange={(i) =>
              setSlicePreview((s) => ({ ...s, layerIdx: i }))
            }
            onLayerHeightChange={(mm) =>
              setSlicePreview((s) => ({ ...s, layerHeightMm: mm }))
            }
            onExportMasksZip={() => void handleExportMasksZip()}
            onExportGcode={() => void handleExportGcode()}
            onExportCtb={() => void handleExportCtb()}
            batchBusy={batchExport.busy}
            batchDone={batchExport.done}
            batchTotal={batchExport.total}
            modelCount={files.length}
          />
        )}

        <ViewerSidePanel
          error={error}
          panelTab={panelTab}
          onPanelTabChange={setPanelTab}
          transformPanelSelected={transformPanelSelected}
          onPreviewTransform={handlePreviewTransform}
          onCommitTransform={handleCommitTransform}
          getTransformPivot={getTransformPivot}
          onAutoGenerate={support.handleAutoGenerate}
          onClearAllSupports={support.handleClearAllSupports}
          supportCount={supports.length}
          autoBusy={autoBusy}
          editMode={editMode}
          onToggleBrush={(active) => {
            setEditMode(active ? "dental-brush" : "select");
            setSelectedCp(null);
            setSelectedSupportId(null);
            setBridgeMode(false);
            setPendingBridge(null);
          }}
          brushThicknessMm={dental.brushThicknessMm}
          onBrushThicknessChange={dental.setBrushThicknessMm}
          onClearPaint={dental.handleClearDentalPaint}
          paintedFaceCount={Object.values(dental.paintedFaces).reduce(
            (sum, ids) => sum + ids.length,
            0,
          )}
          onFindMargin={dental.handleFindMargin}
          marginBusy={dental.marginBusy}
          onClearMargin={dental.handleClearMargin}
          marginStatus={dental.marginStatus}
          onDetectIslands={dental.handleDetectIslands}
          islandBusy={dental.islandBusy}
          onClearIslands={dental.handleClearIslands}
          islandStatus={dental.islandStatus}
          onAutoSupportIslands={dental.handleAutoSupportIslands}
          autoSupportBusy={dental.islandSupportBusy}
          autoSupportResult={dental.islandSupportResult}
          onRunRedesignDetect={dental.handleRunRedesignDetect}
          redesignBusy={dental.redesignBusy}
          onClearRedesignDetect={dental.handleClearRedesignDetect}
          redesignStatus={dental.redesignStatus}
          onGenerateRedesignSupports={dental.handleGenerateRedesignSupports}
        />
      </div>

      <PrinterProfileDialog
        open={profileDialogOpen}
        onClose={() => setProfileDialogOpen(false)}
      />

      <GithubProjectDialog
        open={ghDialog !== null}
        mode={ghDialog ?? "save"}
        projectId={projectId}
        projectName={project?.name}
        onClose={() => setGhDialog(null)}
        onLoaded={(newId) => {
          setGhDialog(null);
          navigate(`/v2/viewer/${newId}`);
        }}
      />

      {/* 우클릭 컨텍스트 메뉴 (P5 · Select 모드 선택 대상: 삭제/복제/줌투핏) */}
      <ViewerContextMenu
        open={ctxMenu !== null}
        x={ctxMenu?.x ?? 0}
        y={ctxMenu?.y ?? 0}
        onClose={() => setCtxMenu(null)}
        items={[
          { label: "삭제", onClick: handleDeleteSelectedSupport },
          { label: "복제", onClick: () => void support.handleDuplicateSelected() },
          { label: "줌 투 핏", onClick: zoomFit },
        ]}
      />
    </div>
  );
};

export default ViewerV2Page;
