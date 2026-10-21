import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";

import { useProjectV2 } from "../hooks/useProjectsV2";
import { useStlFilesV2 } from "../hooks/useStlFilesV2";
import { useSupportsV2 } from "../hooks/useSupportsV2";
import { useShortcutsListener, useShortcutHandler } from "../hooks/useShortcuts";
import { useSupportParamsStore } from "../support";
import { summarizeSupports } from "../support/support-stats";
import { modelFitRegionForProfile } from "../utils/model-size";
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
import { task0PrintableAreaForProfile } from "../utils/task0/task0-profile";

import { useClipboardActions } from "./viewer/hooks/useClipboardActions";
import { useViewerShortcuts } from "./viewer/hooks/useViewerShortcuts";
import { useTransformCommit } from "./viewer/hooks/useTransformCommit";
import { useSupportEditing } from "./viewer/hooks/useSupportEditing";
import { useDentalWorkflow } from "./viewer/hooks/useDentalWorkflow";
import { useSliceExport } from "./viewer/hooks/useSliceExport";
import { useTask0Material } from "./viewer/hooks/useTask0Material";
import { previewLayerCount } from "./viewer/utils/layer-count";
import { useStlDropImport } from "./viewer/hooks/useStlDropImport";
import {
  isEveryModelLoadFailed,
  useStlLoadFailures,
} from "./viewer/hooks/useStlLoadFailures";
import { useLegacySupportMigration } from "./viewer/hooks/useLegacySupportMigration";
import { useEscapeDeselect } from "./viewer/hooks/useEscapeDeselect";
import { NL } from "./viewer/utils/text";
import ViewerHeader from "./viewer/components/ViewerHeader";
import SliceModeHeader from "./viewer/components/SliceModeHeader";
import SliceLayerRail from "./viewer/components/SliceLayerRail";
import SliceSectionPane from "./viewer/components/SliceSectionPane";
import ViewportOverlays from "./viewer/components/ViewportOverlays";
import ViewportInfoPanels from "./viewer/components/ViewportInfoPanels";
import ViewerSidePanel from "./viewer/components/ViewerSidePanel";
import BuildVolumeBanner from "./viewer/components/BuildVolumeBanner";

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
  const { project, loading, error, update: updateProject } =
    useProjectV2(projectId);

  const {
    files,
    loading: filesLoading,
    add: addStlFile,
    // 드롭·파일 열기 여러 개를 한 번에 저장 + 목록 갱신 1회 (사고 방지 3차 ⑥).
    addMany: addStlFiles,
    remove: removeStlFile,
    updateTransform,
    updateMaterialSlot,
  } = useStlFilesV2(projectId);

  const {
    supports,
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

  // 씬의 STL 로드 완료 신호 (BabylonScene onMeshesLoaded 마다 +1 — 사고 방지 3차 ③).
  //   미리보기 중에 로드가 끝나면 useSliceExport 가 최상층 높이를 다시 읽는다. useSliceExport 보다 위에 둔다.
  const [meshLoadTick, setMeshLoadTick] = useState(0);

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
    handleExportGcode,
    handleExportStl,
    handleExportTask0JobZip,
    handleExportTask0Gcode,
    task0Report,
  } = useSliceExport({
    files,
    project,
    supportsLength: supports.length,
    printerProfile,
    sceneHandleRef,
    // P-1: 출력영역을 벗어난 모델이 있으면 내보내기 전에 확인을 받는다.
    volumeIssues,
    // 사고 방지 3차 ③ — 미리보기 중 로드 완료 시 층수 재계산.
    meshLoadTick,
  });

  // Task0 2재료 (D1b) — 재료 모드·파일별 재료 슬롯(repo 경유) + 슬라이스 화면 3D 재료 색.
  //   미리보기 상태(slicePreview.on) 때문에 useSliceExport 뒤에 둔다.
  const task0Material = useTask0Material({
    project,
    updateProject,
    files,
    updateMaterialSlot,
    printerProfile,
    sceneHandleRef,
    sliceOn: slicePreview.on,
  });

  // 파일 선택/클립보드/undo·redo 단축키.
  //   미리보기 중 편집 키 잠금(slicePreview.on) 때문에 useSliceExport 뒤에 둔다.
  useClipboardActions({
    projectId,
    files,
    selectedIds,
    setSelectedIds,
    addStlFile,
    removeStlFile,
    refreshSupports,
    editLocked: slicePreview.on,
  });

  // 서포트 구성 요약 (C-4). 저장된 점 목록에서 매번 파생 — 별도 상태를 두지
  //   않으므로 추가/삭제/undo 어느 경로로 바뀌든 자동으로 최신이다.
  const supportSummary = useMemo(
    () => summarizeSupports(supports),
    [supports],
  );

  // 재설계 서포트 무효화 안내 (B-1). 5초 뒤 자동 소멸.
  //   자동 서포트 교체 안내(신규 8)도 같은 자리를 쓴다(showViewportNotice).
  const [redesignInvalidNotice, setRedesignInvalidNotice] = useState<
    string | null
  >(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showViewportNotice = useCallback((message: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setRedesignInvalidNotice(message);
    noticeTimerRef.current = setTimeout(
      () => setRedesignInvalidNotice(null),
      5000,
    );
  }, []);
  const handleRedesignInvalidated = (count: number) => {
    showViewportNotice(
      `모델 변형으로 재설계 서포트 ${count}개가 제거되었습니다. ` +
        `서포트 생성을 다시 실행하세요. (Ctrl+Z로 되돌리기 가능)`,
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
    editLocked: slicePreview.on,
    onNotice: showViewportNotice,
  });

  // Dental 색칠/마진/아일랜드/검출→서포트 상태·핸들러.
  const dental = useDentalWorkflow({
    projectId,
    supportParams,
    sceneHandleRef,
    layerHeightMm: slicePreview.layerHeightMm,
    refreshSupports,
    onNotice: showViewportNotice,
    // 데모 수정 1차 ③ — 여러 모델 선택 시 서포트 생성(재설계)을 선택한 모델마다 차례로.
    selectedIds,
    files,
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
  } = useStlDropImport({ addStlFile, addStlFiles, setSelectedIds });

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
  // R-2(b) — handlePick useCallback 복원(로드맵 3절 R-2 "(b) `handlePick` useCallback 복원", 리팩토링_LLM구조 §6
  //   Task B 권고 "handlePick useCallback 복원(보험)"). 함수형 업데이트만 쓰므로 deps 는 setter 하나.
  //   이 지점은 아래 early return(!projectId) 위라 훅 순서가 렌더마다 같다.
  const handlePick = useCallback(
    (id: string | null, opts: { multi: boolean }) => {
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
    },
    [setSelectedIds],
  );

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

  // 잘못된 옛 마이그레이션 되돌리기 (stl-local → world, kind 없는 옛 데이터 점만 — B-2).
  useLegacySupportMigration({
    filesLoading,
    supports,
    patchSupport,
    sceneHandleRef,
  });

  // Esc 단계적 해제 (P3) — Bridge pending → 서포트/변곡점 선택 → STL 선택 순으로 한 단계씩.
  useEscapeDeselect({
    profileDialogOpen,
    pendingBridge,
    setPendingBridge,
    selectedCp,
    setSelectedCp,
    selectedSupportId,
    setSelectedSupportId,
    selectedIds,
    setSelectedIds,
  });

  // ----- 손상 STL (사고 방지 3차 ⑤ C5) — 씬이 메시로 못 올린 STL id → 사유, 알림은 파일당 한 번 -----
  const { loadFailed, handleStlLoadError } = useStlLoadFailures(files);

  // ----- Transform 패널 선택 (단일 선택만 표시) -----
  //   사고 방지 3차 ⑦ — 매 렌더 새 객체라 TransformPanel 의 `[selected]` effect 가 렌더마다 돌아 드래그 중 입력값이
  //   되튀었다(⑦). selectedFile 은 files 배열의 원소 참조라 refresh 전까지 정체성이 고정 — 그것으로 메모한다.
  //   useMemo 를 쓰므로 아래 early return(!projectId) 위에 둔다.
  const selectedFile =
    selectedIds.size === 1
      ? files.find((f) => selectedIds.has(f.id)) ?? null
      : null;
  const transformPanelSelected = useMemo(
    () =>
      selectedFile
        ? {
            id: selectedFile.id,
            fileName: selectedFile.fileName,
            transform: selectedFile.transform ?? IDENTITY_TRANSFORM,
          }
        : null,
    [selectedFile],
  );

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
  // 수치 패널의 크기(mm)·출력 영역에 맞춤 = 선택 모델의 현재 world AABB (데모 빈칸 #1).
  //   getTransformPivot 과 같은 이유로 평범한 함수(호출 시점에 최신 ref 를 읽는 라이브 게터).
  const getTransformAabb = () => {
    if (!selectedFileId) return null;
    return sceneHandleRef.current?.getModelWorldAabb(selectedFileId) ?? null;
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
    // 사고 방지 3차 ③ — 모델은 있는데 씬 높이가 0 이면 아직 로드 중(또는 전부 플레이트 아래)이라 슬라이스할 층이 없다.
    //   종전엔 그대로 들어가 "총 1 layer" 로 굳었다. 모델 0개(빈 프로젝트)는 종전 그대로 들어간다.
    if ((filesLoading || files.length > 0) && top <= 0) {
      // 사고 방지 4차(소) — 모델이 전부 손상(메시로 못 올림)이면 기다려도 층이 안 생긴다: 지우라고 안내한다.
      window.alert(
        !filesLoading && isEveryModelLoadFailed(files, loadFailed)
          ? "불러온 모델이 전부 손상돼 슬라이스할 것이 없습니다. 목록에서 지워 주세요."
          : `모델을 아직 불러오는 중이거나 모델이 전부 플레이트 아래에 있어 슬라이스할 층이 없습니다.${NL}잠시 뒤 다시 눌러 주세요.`,
      );
      return;
    }
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
      layerIdx: previewLayerCount(top, s.layerHeightMm, printerProfile) - 1,
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
            materialSlot={task0Material.listSlots}
            // 사고 방지 3차 ⑤ (C5) — 메시로 못 올린 파일에 "⚠ 손상" 표시.
            loadFailed={loadFailed}
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
            supportParams={supportParams}
            plateWidthMm={printerProfile.buildVolumeMm[0]}
            plateDepthMm={printerProfile.buildVolumeMm[1]}
            plateHeightMm={printerProfile.buildVolumeMm[2]}
            // Task0 프로파일이면 비대칭 출력 가능 영역(플레이트를 그 영역에 그림 — 데모 수정 1차 ② + 모델·서포트 검사), 아니면 null (Z2).
            //   매 렌더 새 객체지만 씬 훅이 숫자로 비교하므로 재실행은 값이 바뀔 때만.
            printableAreaMm={task0PrintableAreaForProfile(printerProfile)}
            onBuildVolumeIssues={setVolumeIssues}
            // 사고 방지 3차 ③ — STL 로드 완료 신호(미리보기 층수 재계산), ⑤ — 로드 실패 알림.
            onMeshesLoaded={() => setMeshLoadTick((n) => n + 1)}
            onStlLoadError={handleStlLoadError}
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

          {/* 출력영역 초과 경고 (C-2) — 문구·갈래·버튼은 BuildVolumeBanner. 미리보기 모드에서는 숨긴다(지시: 알림 배너 숨김). */}
          {!sliceMode && (
            <BuildVolumeBanner
              volumeIssues={volumeIssues}
              printerProfile={printerProfile}
              onDropToPlate={handleDropToPlate}
            />
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
              // 데모 수정 1차 ② — Task0 면 플레이트 = 출력 가능 영역이라 표기도 영역 크기로.
              printableAreaMm={task0PrintableAreaForProfile(printerProfile)}
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
            materialSlots={task0Material.sliceSlots}
          />
        )}

        {/*
          1단계에서는 SliceSidePanel 을 그대로 유지한다 — 출력 추정·레이어
          두께·내보내기(마스크 ZIP / G-code)가 전부 여기 있어서 빼면
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
                  previewLayerCount(sceneTopY, mm, printerProfile) - 1,
                ),
              }))
            }
            onExportMasksZip={() => void handleExportMasksZip()}
            onExportGcode={() => void handleExportGcode()}
            onExportTask0JobZip={() => void handleExportTask0JobZip()}
            onExportTask0Gcode={() => void handleExportTask0Gcode()}
            task0Report={task0Report}
            task0Material={task0Material.card}
            batchBusy={batchExport.busy}
            batchDone={batchExport.done}
            batchTotal={batchExport.total}
            batchStage={batchExport.stage}
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
            getTransformAabb={getTransformAabb}
            // 맞춤 영역 = 씬 빨간 박스 판정과 같은 출처(Task0 면 출력 가능 영역, 아니면 빌드 크기).
            fitRegion={modelFitRegionForProfile(printerProfile)}
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
