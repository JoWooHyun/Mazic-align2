import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";

import { useProjectV2 } from "../hooks/useProjectsV2";
import { useStlFilesV2 } from "../hooks/useStlFilesV2";
import { useSupportsV2 } from "../hooks/useSupportsV2";
import { useShortcutsListener, useShortcutHandler } from "../hooks/useShortcuts";
import { useSupportParamsStore } from "../support";
import { summarizeSupports } from "../support/support-stats";
import BabylonScene, {
  type BabylonSceneHandle,
  type GizmoMode,
  type BuildVolumeIssue,
} from "../components/BabylonScene";
import { type EditMode } from "../components/EditModeControls";
import SliceSidePanel from "../components/SliceSidePanel";
import PrinterProfileDialog from "../components/PrinterProfileDialog";
import ViewerContextMenu from "../components/ViewerContextMenu";
import StlFileList from "../components/StlFileList";
import { useCurrentProfile } from "../hooks/usePrinterProfileStore";
import { IDENTITY_TRANSFORM } from "../types/transform";
import { SAMPLE_MODELS } from "../utils/sample-models";

import { useClipboardActions } from "./viewer/hooks/useClipboardActions";
import { useViewerShortcuts } from "./viewer/hooks/useViewerShortcuts";
import { useTransformCommit } from "./viewer/hooks/useTransformCommit";
import { useSupportEditing } from "./viewer/hooks/useSupportEditing";
import { useDentalWorkflow } from "./viewer/hooks/useDentalWorkflow";
import { useSliceExport } from "./viewer/hooks/useSliceExport";
import { layerCountFor } from "./viewer/utils/layer-count";
import { useStlDropImport } from "./viewer/hooks/useStlDropImport";
import ViewerHeader from "./viewer/components/ViewerHeader";
import SliceModeHeader from "./viewer/components/SliceModeHeader";
import SliceLayerRail from "./viewer/components/SliceLayerRail";
import SliceSectionPane from "./viewer/components/SliceSectionPane";
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
    // S-4b-2d 기둥 연결 브레이스 — 같은 스토어·별도 목록(타입 오염 방지).
    pillarBraces,
    addPillarBraces,
    addMany: addSupports,
    removeMany: removeSupports,
    clearAll: clearAllSupports,
    refresh: refreshSupports,
    patchSupport,
  } = useSupportsV2(projectId);

  // supports closure 가 stale 일 때 항상 최신 값을 보기 위한 ref.
  // handleCommitTransform / followAttachedChildren 등 비동기 콜백에서 사용.
  const supportsRef = useRef(supports);
  supportsRef.current = supports;

  // ----- 핵심 공유 상태 (페이지 유지) -----
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

  // 출력영역 초과 경고 (C-2). 자동 소멸시키지 않는다 — 조건이 해소될 때까지
  //   계속 보여야 하는 **상태**이지 일회성 알림이 아니다(모델을 안으로 옮기면
  //   훅이 빈 배열을 올려보내 저절로 사라진다).
  const [volumeIssues, setVolumeIssues] = useState<BuildVolumeIssue[]>([]);

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
    // P-1: 출력영역을 벗어난 모델이 있으면 내보내기 전에 확인을 받는다.
    volumeIssues,
  });

  // 서포트 구성 요약 (C-4). 저장된 점 목록에서 매번 파생 — 별도 상태를 두지
  //   않으므로 추가/삭제/undo 어느 경로로 바뀌든 자동으로 최신이다.
  const supportSummary = useMemo(
    () => summarizeSupports(supports),
    [supports],
  );

  // 재설계 서포트 무효화 안내 (B-1). 5초 뒤 자동 소멸.
  const [redesignInvalidNotice, setRedesignInvalidNotice] = useState<
    string | null
  >(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRedesignInvalidated = (count: number) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setRedesignInvalidNotice(
      `모델 변형으로 재설계 서포트 ${count}개가 제거되었습니다. ` +
        `서포트 생성을 다시 실행하세요. (Ctrl+Z로 되돌리기 가능)`,
    );
    noticeTimerRef.current = setTimeout(
      () => setRedesignInvalidNotice(null),
      5000,
    );
  };
  // 언마운트 시 타이머 정리 (setState 누수 방지).
  useEffect(
    () => () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    },
    [],
  );

  // STL transform 프리뷰/커밋 + 부착 서포트 추종.
  const { handlePreviewTransform, handleCommitTransform, followAttachedChildren } =
    useTransformCommit({
      supports,
      supportsRef,
      sceneHandleRef,
      updateTransform,
      patchSupport,
      removeSupports,
      addSupports,
      onRedesignInvalidated: handleRedesignInvalidated,
    });

  /**
   * 플레이트 아래로 파고든 모델들을 한 번에 위로 올린다 (B-21).
   *
   * 회전하면 모델이 실제로 플레이트를 파고드는데(우리는 회전 후 자동 안착을
   * 하지 않는다 — B-12 리드 결정 A안), 사용자가 ty 를 손으로 계산해 되돌리는
   * 것은 번거롭다. 경고 배너에서 원클릭으로 해소한다.
   *
   * 내부 Y 가 높이축이므로 `ty += 파고든 깊이`. 회전·스케일은 건드리지 않는다.
   * `handleCommitTransform` 을 그대로 쓰므로 undo(Ctrl+Z)·서포트 추종이 함께 걸린다.
   */
  const handleDropToPlate = () => {
    for (const issue of volumeIssues) {
      if (issue.sinkDepthMm <= 0) continue;
      const f = files.find((file) => file.id === issue.stlId);
      if (!f) continue;
      const oldT = f.transform ?? IDENTITY_TRANSFORM;
      const newT = { ...oldT, ty: oldT.ty + issue.sinkDepthMm };
      sceneHandleRef.current?.previewTransform(issue.stlId, newT);
      handleCommitTransform(issue.stlId, oldT, newT);
    }
  };

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
    addPillarBraces,
  });

  // 네이티브 열기 + 드래그앤드롭.
  const {
    isDragOver,
    fileInputRef,
    addSampleModel,
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
      if (profileDialogOpen) return;
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

  /**
   * 슬라이스 미리보기 **모드** 진입 (B-38 1단계).
   *
   * 라우트를 나누지 않고 같은 ViewerV2Page 안에서 화면 구성만 바꾼다 — 리드
   * 확정("인터넷 새 탭 내는 건 아니지?"). BabylonScene 을 언마운트하면 dispose
   * 로 STL 재로드 + 카메라 리셋이 나서 미리보기가 성립하지 않기 때문이다.
   *
   * ⚠️ 평범한 함수로 둔다 — 위쪽 early return(!projectId) 아래라 useCallback 을
   *   쓰면 훅 호출 순서가 렌더마다 달라진다(rules-of-hooks). 호출 시점에 최신
   *   ref/상태를 읽으므로 메모이제이션이 필요 없다.
   */
  const enterSliceMode = () => {
    // 켤 때는 **최상층**부터 보여준다 (리드: "다른 슬라이서는 0층이 아니라
    //   끝 레이어부터 보여준다"). 0층은 바닥 한 겹이라 켜자마자 거의
    //   아무것도 안 보이는 상태로 시작했다.
    //   getSceneTopY() 는 동기라 여기서 층수를 바로 구할 수 있다 —
    //   setSceneTopY 의 state 반영을 기다릴 필요가 없다.
    const top = sceneHandleRef.current?.getSceneTopY() ?? 0;
    setSceneTopY(top);
    // 미리보기 진입 시 편집 모드를 select 로 강제한다.
    //   support/dental-brush 를 켠 채로 두면 보이지 않는(clipPlane 으로
    //   잘려 나간) 표면을 클릭해 서포트가 엉뚱한 곳에 생기거나 색칠이
    //   된다 — picking ray 는 셰이더 discard 와 무관하게 원본 메쉬를
    //   전부 맞히기 때문. select 하나로 수렴시키면 잠금 대상이 단일
    //   경로가 된다.
    //
    //   ⚠️ 미리보기를 꺼도 **이전 모드로 되돌리지 않는다.** 사용자가
    //   명시적으로 다시 고르게 둔다 — 예기치 않은 모드 복귀가 더
    //   혼란스럽고, 그 사이 선택/서포트 상태가 바뀌었을 수 있다.
    setEditMode("select");
    // "면 클릭 대기" 상태로 들어가 있었다면 함께 해제 — 바닥면
    //   붙이기도 클릭 한 번으로 모델을 회전시키는 변환이라 잠금 대상.
    setAlignFloorMode(false);
    setSlicePreview((s) => ({
      ...s,
      on: true,
      layerIdx: layerCountFor(top, s.layerHeightMm) - 1,
    }));
  };

  /**
   * 모드 이탈 — `on` 만 내린다.
   *
   * layerIdx/layerHeightMm 은 유지한다: 다시 들어올 때 진입 로직이 layerIdx 를
   * 최상층으로 덮고, 레이어 두께는 사용자가 고른 설정이라 초기화 대상이 아니다.
   * 편집 화면 쪽 상태(선택·카메라·서포트)는 애초에 건드리지 않으므로 그대로
   * 복귀한다.
   */
  const exitSliceMode = () => setSlicePreview((s) => ({ ...s, on: false }));

  // 슬라이스 미리보기 모드 여부 — 기존 `slicePreview.on` 이 단일 출처.
  //   별도 모드 state 를 두지 않는다(두 값이 어긋날 여지를 만들지 않기 위해).
  const sliceMode = slicePreview.on;

  // 층 슬라이더에 표시할 현재 층 — 범위 클램프한 값.
  //   층높이를 키우면 총 층수가 줄어 저장된 layerIdx 가 범위를 벗어날 수 있다.
  //   `sliceYNow` 도 훅 안에서 같은 클램프를 거치므로 표시와 실제 단면이 일치한다.
  //   (SliceSidePanel 이 내부에서 쓰는 것과 같은 식 — 훅의 export 를 늘리지 않았다.)
  const safeLayerIdx = Math.min(
    slicePreview.layerIdx,
    Math.max(0, layerCount - 1),
  );

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/*
        헤더만 모드에 따라 교체한다. 아래 뷰포트(<main>)는 **분기 밖**에 그대로
        둬 BabylonScene 이 절대 언마운트되지 않게 한다.
      */}
      {sliceMode ? (
        <SliceModeHeader
          project={project}
          loading={loading}
          onBack={exitSliceMode}
          // 내보내기 진행 중에는 모드를 못 빠져나가게 한다 — 기존
          //   SliceSidePanel 의 닫기 버튼과 같은 가드.
          backDisabled={batchExport.busy}
        />
      ) : (
        <ViewerHeader
          project={project}
          loading={loading}
          filesLength={files.length}
          slicePreviewOn={slicePreview.on}
          onBackToProjects={() => navigate("/v2/projects")}
          onEditProfile={() => setProfileDialogOpen(true)}
          onToggleSlicePreview={enterSliceMode}
          onExportStl={handleExportStl}
          onOpenStl={() => fileInputRef.current?.click()}
          onLoadSample={(id) => {
            const def = SAMPLE_MODELS.find((d) => d.id === id);
            if (def) void addSampleModel(def);
          }}
        />
      )}

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
        {/* STL 목록은 편집 화면 전용 — 미리보기 모드에서는 숨긴다. */}
        {!sliceMode && (
          <StlFileList
            files={files}
            selectedIds={selectedIds}
            onPick={(id, opts) => handlePick(id, opts)}
            onAdd={() => fileInputRef.current?.click()}
            onRemove={handleRemove}
            loading={filesLoading}
          />
        )}

        {/*
          ★ 수용 기준 5 — 이 <main> 과 그 안의 <BabylonScene> 은 **모드 분기
            바깥**에 있다. 모드가 바뀌어도 React 는 같은 위치의 같은 타입
            엘리먼트로 보아 재조정(reconcile)만 하므로 BabylonScene 은
            언마운트/재마운트되지 않는다 — Engine·Scene·로드된 STL·카메라가
            전부 그대로 유지된다. 바뀌는 건 className(레이아웃)과 형제
            오버레이의 표시 여부뿐이다.
        */}
        <main
          // min-w-0 — 미리보기 모드에서 오른쪽에 층 레일·2D 단면이 붙으므로
          //   flex 아이템이 콘텐츠 최소폭에 걸려 넘치지 않도록 한다.
          className="flex-1 min-w-0 relative bg-gray-100"
          // 드래그 임포트는 편집 행위 — 미리보기 모드에서는 핸들러 자체를
          //   떼어 둔다. 오버레이만 숨기면 드롭 시 조용히 STL 이 추가돼
          //   편집 잠금과 어긋난다.
          onDragOver={sliceMode ? undefined : handleDragOver}
          onDragLeave={sliceMode ? undefined : handleDragLeave}
          onDrop={sliceMode ? undefined : handleDrop}
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
            pillarBraces={pillarBraces}
            supportParams={supportParams}
            plateWidthMm={printerProfile.buildVolumeMm[0]}
            plateDepthMm={printerProfile.buildVolumeMm[1]}
            plateHeightMm={printerProfile.buildVolumeMm[2]}
            onBuildVolumeIssues={setVolumeIssues}
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

          {/*
            뷰포트 오버레이(편집 툴바·뷰 프리셋)는 미리보기 모드에서 숨긴다.
            ⚠️ `sliceLockedRef` 편집 잠금(PR #91)은 **그대로 둔다** — 화면에서
            편집 UI 가 사라져도 picking ray 는 clipPlane 과 무관하게 원본 메쉬를
            맞히므로 잠금의 근본 이유가 유지된다. ViewportOverlays 안의
            "미리보기 중 — 편집 잠금" 배지는 오버레이 자체가 안 보이므로 자연히
            사라지지만, 코드는 남겨 둔다(2단계 정리 대상).
          */}
          {!sliceMode && (
            <ViewportOverlays
              files={files}
              selectedIds={selectedIds}
              editMode={editMode}
              gizmoMode={gizmoMode}
              alignFloorMode={alignFloorMode}
              slicePreviewOn={slicePreview.on}
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
          )}

          {/*
            B-27 — STL 이 없을 때 뜨던 안내 오버레이 제거 (리드 지시:
            "stl파일 열릴때까지 알림창 뜨는거 없었으면 좋겠어. 굳이 알림창 뜰
            이유가 없다. 삭제해"). 드래그 중 오버레이(isDragOver)는 드롭 위치를
            알려주는 실질 피드백이라 유지한다.
          */}

          {/* 재설계 서포트 무효화 안내 (B-1). 5초 후 자동 소멸. */}
          {!sliceMode && redesignInvalidNotice && (
            <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none px-4">
              <div className="bg-amber-50/95 backdrop-blur border border-amber-300 rounded-md shadow px-4 py-2 text-sm text-amber-900 select-none">
                {redesignInvalidNotice}
              </div>
            </div>
          )}

          {/*
            출력영역 초과 경고 (C-2, `docs/판정_CHITUBOX분석_20260821.md`).
            자동 소멸 없음 — 모델을 영역 안으로 되돌리면 훅이 빈 배열을 올려
            저절로 사라진다. 뷰포트에는 해당 모델을 감싸는 빨간 와이어박스가
            함께 표시된다(useBuildVolumeCheck).
          */}
          {/*
            미리보기 모드에서는 숨긴다 (지시: 알림 배너 숨김). 안전장치가
            사라지는 것은 아니다 — 내보내기 경로는 useSliceExport 의
            `confirmIfOutOfBounds`(P-1) 가 여전히 확인 다이얼로그로 막는다.
            "플레이트 위로 올리기" 는 모델을 움직이는 **변환**이라 편집 잠금
            중인 미리보기 모드에 있어서도 안 된다.
          */}
          {!sliceMode && volumeIssues.length > 0 && (
            <div className="absolute inset-x-0 top-4 flex justify-center px-4 pointer-events-none">
              <div className="bg-red-50/95 backdrop-blur border border-red-300 rounded-md shadow px-4 py-2 text-sm text-red-900 select-none max-w-xl pointer-events-auto">
                <div className="font-medium">
                  ⚠ 출력영역을 벗어난 모델 {volumeIssues.length}개 — 이대로
                  출력하면 잘려 나갑니다.
                </div>
                <ul className="mt-1 space-y-0.5">
                  {volumeIssues.slice(0, 3).map((it) => (
                    <li key={it.stlId} className="text-xs">
                      · {it.fileName} — {it.message}
                    </li>
                  ))}
                  {volumeIssues.length > 3 && (
                    <li className="text-xs">
                      · 외 {volumeIssues.length - 3}개
                    </li>
                  )}
                </ul>
                {/*
                  플레이트 아래로 파고든 경우만 원클릭 해소 버튼을 띄운다 (B-21).
                  회전하면 실제로 파고들기 때문에(자동 안착 없음 — B-12 A안)
                  가장 흔한 경고이고, 손으로 ty 를 계산하지 않게 해 준다.
                */}
                {volumeIssues.some((it) => it.sinkDepthMm > 0) && (
                  <button
                    onClick={handleDropToPlate}
                    className="mt-2 px-2 py-1 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                  >
                    플레이트 위로 올리기 (Ctrl+Z 로 되돌리기 가능)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 드래그앤드롭 오버레이 — pointer-events-none 로 drop 이벤트가
              main 컨테이너에 그대로 도달하게 한다. */}
          {!sliceMode && isDragOver && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-primary-500/10 border-2 border-dashed border-primary-500 pointer-events-none">
              <div className="bg-white/95 backdrop-blur rounded-lg shadow-lg px-6 py-4 text-base font-medium text-primary-700">
                여기에 STL 을 놓으세요
              </div>
            </div>
          )}

          {!sliceMode && (
            <ViewportInfoPanels
              filesLength={files.length}
              overhangAngleDeg={overhangAngleDeg}
              editMode={editMode}
              plateWidthMm={printerProfile.buildVolumeMm[0]}
              plateDepthMm={printerProfile.buildVolumeMm[1]}
              supportSummary={supportSummary}
            />
          )}
        </main>

        {/*
          미리보기 모드 가운데 세로 층 슬라이더 (위=최상층, 아래=0층).
          기존 onLayerIdxChange 경로를 그대로 재사용한다.
        */}
        {sliceMode && (
          <SliceLayerRail
            layerIdx={safeLayerIdx}
            layerCount={layerCount}
            sliceYNow={sliceYNow}
            onLayerIdxChange={(i) =>
              setSlicePreview((s) => ({ ...s, layerIdx: i }))
            }
          />
        )}

        {/* 미리보기 모드 우측 2D 단면 (SliceMaskPreview 재사용, 해상도 상한 고정). */}
        {sliceMode && (
          <SliceSectionPane
            sceneHandleRef={sceneHandleRef}
            sliceY={sliceYNow}
            lcdWidthPx={printerProfile.lcdWidthPx}
            lcdHeightPx={printerProfile.lcdHeightPx}
          />
        )}

        {/*
          1단계에서는 SliceSidePanel 을 그대로 유지한다 — 출력 추정·레이어
          두께·내보내기(마스크 ZIP / G-code / .ctb)가 전부 여기 있어서 빼면
          기능이 사라진다. 하단 설정 줄로 재배치하는 것은 2단계 과제.
        */}
        {sliceMode && (
          <SliceSidePanel
            onClose={exitSliceMode}
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
              setSlicePreview((s) => ({
                ...s,
                layerHeightMm: mm,
                // 층높이를 키우면 총 층수가 줄어 기존 layerIdx 가 범위를 벗어난다.
                //   그대로 두면 단면이 모델 위 허공을 가리켜 화면이 빈다.
                layerIdx: Math.min(
                  s.layerIdx,
                  layerCountFor(sceneTopY, mm) - 1,
                ),
              }))
            }
            onExportMasksZip={() => void handleExportMasksZip()}
            onExportGcode={() => void handleExportGcode()}
            onExportCtb={() => void handleExportCtb()}
            batchBusy={batchExport.busy}
            batchDone={batchExport.done}
            batchTotal={batchExport.total}
            modelCount={files.length}
            // 가운데 단면 pane 이 같은 마스크를 이미 크게 그린다 — 패널 미니맵은 끈다.
            hideMaskPreview
          />
        )}

        {/* 우측 편집 패널 — 편집 화면 전용. */}
        {!sliceMode && (
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
            redesignProgress={dental.redesignProgress}
            onCancelRedesign={dental.handleCancelRedesign}
            onClearRedesignDetect={dental.handleClearRedesignDetect}
            redesignStatus={dental.redesignStatus}
            onGenerateRedesignSupports={dental.handleGenerateRedesignSupports}
          />
        )}
      </div>

      <PrinterProfileDialog
        open={profileDialogOpen}
        onClose={() => setProfileDialogOpen(false)}
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
