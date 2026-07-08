import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";

import { useProjectV2 } from "../hooks/useProjectsV2";
import { useStlFilesV2 } from "../hooks/useStlFilesV2";
import { useSupportsV2 } from "../hooks/useSupportsV2";
import {
  useShortcutsListener,
  useShortcutHandler,
} from "../hooks/useShortcuts";
import { useClipboardStore } from "../hooks/useClipboardStore";
import { useUndoStore } from "../hooks/useUndoStore";
import { SupportParamsPanel, useSupportParamsStore } from "../support";
import * as supportRepo from "../data/supports.repo";
import type { SupportPointV2 } from "../support/types";
import { DEFAULT_SUPPORT_SETTINGS } from "../utils/dental/dental-support";
import { downloadBlob } from "../utils/stl-export";
import { sliceBatchService } from "../utils/slice-batch-service";
import BabylonScene, {
  type BabylonSceneHandle,
  type GizmoMode,
} from "../components/BabylonScene";
import LocalFileBrowser from "../components/LocalFileBrowser";
import ViewControls from "../components/ViewControls";
import StlFileList from "../components/StlFileList";
import TransformPanel from "../components/TransformPanel";
import GizmoControls from "../components/GizmoControls";
import EditModeControls, {
  type EditMode,
} from "../components/EditModeControls";
import DentalPanel from "../components/DentalPanel";
import SliceSidePanel from "../components/SliceSidePanel";
import GithubProjectDialog from "../components/GithubProjectDialog";
import PrinterProfileSelect from "../components/PrinterProfileSelect";
import PrinterProfileDialog from "../components/PrinterProfileDialog";
import { useCurrentProfile } from "../hooks/usePrinterProfileStore";
import type { PrinterProfileV2 } from "../types/printer";
import { IDENTITY_TRANSFORM, type TransformV2 } from "../types/transform";
import { transformPointBetween } from "../utils/transform";
import {
  findClosestT,
  getBridgePathPoint,
  insertControlPoint,
  isStraightCps,
  removeControlPoint,
  straightCps,
} from "../utils/bridge-path";

/**
 * 프로파일의 노광 설정을 PNG-ZIP manifest 용 exposure 객체로 변환.
 * 프로파일에 노광 필드가 하나도 없으면 undefined 를 반환해 manifest 에 노광 정보를
 * 추가하지 않는다 (기존 프로파일 하위 호환 — 산출물 불변).
 * (기본값은 ctb-encoder 의 기본값과 동일하게 맞춰 CTB/manifest 간 일관성 유지.)
 */
function profileExposure(p: PrinterProfileV2):
  | {
      bottomLayerCount: number;
      transitionLayerCount: number;
      bottomExposureSec: number;
      exposureSec: number;
    }
  | undefined {
  const hasAny =
    p.exposureSec !== undefined ||
    p.bottomExposureSec !== undefined ||
    p.bottomLayerCount !== undefined ||
    p.transitionLayerCount !== undefined;
  if (!hasAny) return undefined;
  return {
    bottomLayerCount: p.bottomLayerCount ?? 5,
    transitionLayerCount: p.transitionLayerCount ?? 0,
    bottomExposureSec: p.bottomExposureSec ?? 30.0,
    exposureSec: p.exposureSec ?? 2.5,
  };
}

/**
 * v2 프로젝트 작업 화면.
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
  // handleCommitTransform / followAttachedChildren 등 비동기 콜백에서
  // 사용.
  const supportsRef = useRef(supports);
  supportsRef.current = supports;

  const [browserOpen, setBrowserOpen] = useState(false);
  // 뷰어 영역 드래그앤드롭 오버레이 표시 여부.
  const [isDragOver, setIsDragOver] = useState(false);
  // 네이티브 파일 열기용 숨김 input.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ghDialog, setGhDialog] = useState<"save" | "load" | null>(null);
  const [panelTab, setPanelTab] = useState<
    "transform" | "support" | "dental"
  >("transform");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // 기본 translate — STL 단일 선택 시 자동으로 X/Y/Z 이동 화살표 표시.
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [alignFloorMode, setAlignFloorMode] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("select");
  const [bridgeMode, setBridgeMode] = useState(false);
  // disc(디스크 서포트) 배치 서브 모드 — support 편집 모드 안에서만 의미.
  //   bridge 와 상호 배타 (동시에 켤 수 없음). 켜져 있으면 모델 표면 클릭이
  //   trunk 대신 지현규 dental disc 서포트를 배치한다.
  const [discMode, setDiscMode] = useState(false);
  // dental-brush 색칠 두께 (mm). 씬 SHIFT+휠 로도 갱신됨.
  const [brushThicknessMm, setBrushThicknessMm] = useState(3);
  // stlId → painted face index 목록 (세션 상태). margin/island 조각 입력.
  // painted 는 IndexedDB 에 저장하지 않는다 (이 조각 범위 밖).
  const [paintedFaces, setPaintedFaces] = useState<Record<string, number[]>>(
    {},
  );
  // 마진 찾기 결과 상태 (세션). null = 미실행. ok=false → 실패 사유 표시.
  //   marginRef 자체는 BabylonScene 내부 — 여기서는 UI 표시/버튼 활성용 상태만.
  const [marginStatus, setMarginStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  // 아일랜드 검출 결과 상태 (세션). null = 미실행. islandResultRef 자체는
  //   BabylonScene 내부 — 여기서는 UI 표시/버튼 활성용 상태만.
  const [islandStatus, setIslandStatus] = useState<
    | {
        ok: true;
        totalIslandFaces: number;
        nSlices: number;
        layersWithIsland: number;
      }
    | { ok: false; message: string }
    | null
  >(null);
  const [pendingBridge, setPendingBridge] = useState<{
    stlId: string;
    contact: [number, number, number];
    normal?: [number, number, number];
    attachedTo?: { supportId: string; t: number };
  } | null>(null);
  const [selectedSupportId, setSelectedSupportId] = useState<string | null>(
    null,
  );
  // 선택된 Bridge 변곡점 idx (sphere 클릭 시 설정). Delete 키로 제거.
  const [selectedCp, setSelectedCp] = useState<{
    supportId: string;
    idx: number;
  } | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [slicePreview, setSlicePreview] = useState<{
    on: boolean;
    layerIdx: number;
    layerHeightMm: number;
  }>({ on: false, layerIdx: 0, layerHeightMm: 0.05 });
  const [sceneTopY, setSceneTopY] = useState(0);
  const [batchExport, setBatchExport] = useState<{
    busy: boolean;
    done: number;
    total: number;
  }>({ busy: false, done: 0, total: 0 });
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  // sliceY = (layerIdx + 0.5) × layerHeight — 레이어 중심을 픽업
  const sliceYNow =
    (slicePreview.layerIdx + 0.5) * slicePreview.layerHeightMm;
  const layerCount = Math.max(
    1,
    Math.ceil(sceneTopY / slicePreview.layerHeightMm),
  );
  const sceneHandleRef = useRef<BabylonSceneHandle>(null);

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
  }, [files]);

  const overhangAngleDeg = useSupportParamsStore(
    (s) => s.params.overhangAngleDeg,
  );
  const supportParams = useSupportParamsStore((s) => s.params);

  const printerProfile = useCurrentProfile();

  useShortcutsListener();

  // 잘못된 마이그레이션 reverse (stl-local → world).
  // 0c83dd2 의 timing 문제로 stl-local 좌표가 STL transform 적용 전
  // 기준으로 저장 → 새로고침 시 saved transform 이 한 번 더 곱해져
  // 위치 어긋남. 사용자가 현재 보고 있는 위치 (= 잘못된 위치) 를
  // 그대로 world 좌표로 받아 적고 coordSpace='world' 로 되돌림.
  // 이후 race 옛 동작으로 복귀 (transform 시 patch chain). 새 supports
  // 에 timing-safe stl-local 도입은 별도 commit.
  useEffect(() => {
    if (filesLoading) return;
    if (supports.length === 0) return;
    const toRevert = supports.filter((s) => s.coordSpace === "stl-local");
    if (toRevert.length === 0) return;
    const handle = sceneHandleRef.current;
    if (!handle) return;
    // STL transform 이 BabylonScene 의 비동기 STL 로드 후 적용되는
    // 시점까지 충분히 대기 (1.5s — Promise.all 안의 applyTransform
    // 보장).
    const t = setTimeout(() => {
      void (async () => {
        for (const s of toRevert) {
          const newContact = handle.stlLocalToWorld(s.stlId, s.contact);
          if (!newContact) continue;
          const newBase =
            handle.stlLocalToWorld(s.stlId, s.base) ?? s.base;
          let newCps = s.curveControlPoints;
          if (newCps) {
            newCps = newCps.map(
              (cp) =>
                handle.stlLocalToWorld(s.stlId, cp) ?? cp,
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

  // Bridge pending 상태에서 Esc 누르면 취소.
  useEffect(() => {
    if (!pendingBridge) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingBridge(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingBridge]);

  // ----- 선택 -----
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
    [],
  );

  // ----- 클립보드 -----
  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(files.map((f) => f.id)));
  }, [files]);

  const handleCopy = useCallback(() => {
    if (selectedIds.size === 0) return;
    const items = files
      .filter((f) => selectedIds.has(f.id))
      .map((f) => ({ fileName: f.fileName, blob: f.blob }));
    useClipboardStore.getState().set(items);
  }, [files, selectedIds]);

  const handleCut = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const toCut = files.filter((f) => selectedIds.has(f.id));
    useClipboardStore
      .getState()
      .set(toCut.map((f) => ({ fileName: f.fileName, blob: f.blob })));
    for (const f of toCut) {
      await removeStlFile(f.id);
    }
    setSelectedIds(new Set());
  }, [files, selectedIds, removeStlFile]);

  const handlePaste = useCallback(async () => {
    const items = useClipboardStore.getState().items;
    if (items.length === 0) return;
    const newIds: string[] = [];
    for (const item of items) {
      const created = await addStlFile(
        addCopySuffix(item.fileName, files),
        item.blob,
      );
      newIds.push(created.id);
    }
    setSelectedIds(new Set(newIds));
  }, [files, addStlFile]);

  // ----- Undo / Redo -----
  const handleUndo = useCallback(() => {
    void useUndoStore.getState().undo();
  }, []);
  const handleRedo = useCallback(() => {
    void useUndoStore.getState().redo();
  }, []);

  useShortcutHandler("selectAll", handleSelectAll);
  useShortcutHandler("copy", handleCopy);
  useShortcutHandler("cut", handleCut);
  useShortcutHandler("paste", handlePaste);
  useShortcutHandler("undo", handleUndo);
  useShortcutHandler("redo", handleRedo);
  // 'delete' 핸들러는 아래의 handleDeleteSelectedSupport 선언 후에 등록한다.

  // ----- 자동 서포트 -----
  const handleAutoGenerate = useCallback(async () => {
    if (!projectId || autoBusy) return;
    if (files.length === 0) return;
    setAutoBusy(true);
    try {
      const generated =
        sceneHandleRef.current?.generateAutoSupports(projectId, supportParams) ??
        [];
      if (generated.length === 0) return;

      const ids = generated.map((p) => p.id);
      await addSupports(generated);

      useUndoStore.getState().push({
        label: "auto-supports",
        undo: async () => {
          for (const id of ids) {
            await supportRepo.deleteSupport(id);
          }
          await refreshSupports();
        },
        redo: async () => {
          await addSupports(generated);
        },
      });
    } finally {
      setAutoBusy(false);
    }
  }, [projectId, autoBusy, files.length, supportParams, addSupports, refreshSupports]);

  // ----- 수동 편집 -----
  const handleAddSupportAt = useCallback(
    async (
      stlId: string,
      contact: [number, number, number],
      normal?: [number, number, number],
      attachedTo?: { supportId: string; t: number },
    ) => {
      if (!projectId) return;

      // Bridge 모드: 첫 클릭은 pending, 두 번째 클릭에 둘을 잇는 기둥.
      if (bridgeMode) {
        if (!pendingBridge) {
          // 첫 점 — pending 설정 (선택 해제 X).
          if (contact[1] <= 0.5) return; // 베드 근처 무의미
          setPendingBridge({ stlId, contact, normal, attachedTo });
          return;
        }
        // 두 번째 점 — 두 점을 잇는 bridge 서포트 추가.
        const a = pendingBridge.contact;
        const b = contact;
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        const dz = a[2] - b[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 1.0) {
          // 거의 같은 점이면 무시.
          return;
        }
        // 변곡점 3 개 자동 배치: t = 0.25 / 0.50 / 0.75. 직선 lerp.
        // tube 가 STL 침투하는 부분은 BabylonScene 의 CSG subtract 로
        // 제거되어 표면 위 외부만 매끈하게 노출.
        const lerp = (t: number): [number, number, number] => [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ];
        const initialCps: [
          [number, number, number],
          [number, number, number],
          [number, number, number],
        ] = [lerp(0.25), lerp(0.5), lerp(0.75)];
        const newPoint: SupportPointV2 = {
          id: crypto.randomUUID(),
          projectId,
          stlId, // 두 번째 클릭의 모델 (contact 쪽)
          baseStlId: pendingBridge.stlId, // 첫 번째 클릭의 모델 (base 쪽)
          // base = 첫 점, contact = 두 번째 점.
          // (createSupportMesh 는 base→contact 방향으로 그린다.)
          contact: b,
          base: a,
          source: "bridge",
          addedAt: Date.now(),
          curveControlPoints: initialCps,
          contactNormal: normal,
          baseNormal: pendingBridge.normal,
          contactAttachedTo: attachedTo,
          baseAttachedTo: pendingBridge.attachedTo,
        };
        setPendingBridge(null);
        await addSupports([newPoint]);
        useUndoStore.getState().push({
          label: "add-bridge",
          undo: async () => {
            await supportRepo.deleteSupport(newPoint.id);
            await refreshSupports();
          },
          redo: async () => {
            await addSupports([newPoint]);
          },
        });
        return;
      }

      // 단점 모드 (기존) / disc 모드 (지현규 dental disc).
      //   둘 다 "모델 표면 클릭 → 단일 서포트 배치" 로 동작이 동일하고,
      //   저장·undo·삭제 경로도 공유한다. 차이는 variant / discSettings 뿐.
      if (contact[1] <= 0.5) return;
      // disc: dental createSupport 는 목 길이(tubeTop→bend)가 하한
      //   (CONN 1.6 + 0.5) 미만이면 null 을 반환한다. 그대로 저장하면
      //   mesh 없는 유령 DB 레코드가 남아 UI 로 삭제할 수 없으므로,
      //   저장 전에 dental 과 동일한 계산으로 생성 가능 여부를 검증한다.
      //   (모델 표면이 베드에 너무 가까울 때 조용히 무시 — 새 UI 없음.)
      if (discMode) {
        const ds = DEFAULT_SUPPORT_SETTINGS;
        const sphereR = Math.max(
          ds.tipTopDiameter / 2,
          Math.max(ds.tipBottomDiameter / 2, 0.1),
        );
        const tubeTopY = contact[1] + ds.contactDepth - sphereR;
        const bendY = Math.max(0.5, contact[1] - 4);
        if (tubeTopY - bendY < 1.6 + 0.5) return; // 목 길이 하한 미달 → 배치 안 함.
      }
      // base: contact 에서 -Y 로 가장 가까운 표면 (자기 모델 제외).
      // 다른 STL 위에 단점이 서 있으면 그 모델 상단에 base 부착되어
      // 기둥 직선이 다른 STL 을 통과하지 않게 된다.
      const groundY =
        sceneHandleRef.current?.findSurfaceBelow(
          contact[0],
          contact[2],
          contact[1] - 0.01,
          [stlId],
        ) ?? 0;
      const newPoint: SupportPointV2 = {
        id: crypto.randomUUID(),
        projectId,
        stlId,
        contact,
        base: [contact[0], groundY, contact[2]],
        source: "manual",
        addedAt: Date.now(),
        contactNormal: normal,
        // disc 모드면 variant='disc' + 배치 시점 dental 치수 스냅샷.
        // (trunk 는 variant 미지정 → 기존 코드 경로 그대로.)
        ...(discMode
          ? {
              variant: "disc" as const,
              discSettings: { ...DEFAULT_SUPPORT_SETTINGS },
            }
          : {}),
      };
      await addSupports([newPoint]);
      useUndoStore.getState().push({
        label: "add-support",
        undo: async () => {
          await supportRepo.deleteSupport(newPoint.id);
          await refreshSupports();
        },
        redo: async () => {
          await addSupports([newPoint]);
        },
      });
    },
    [projectId, bridgeMode, discMode, pendingBridge, addSupports, refreshSupports],
  );

  const handleRemoveSupport = useCallback(
    async (supportId: string) => {
      const target = supports.find((s) => s.id === supportId);
      if (!target) return;
      // Bridge↔Bridge cascade — 부모 삭제 시 그 위에 부착된 child
      // (contactAttachedTo / baseAttachedTo 가 부모를 가리킴) 들도
      // 함께 삭제. grand-child 까지 재귀로.
      const cascadeIds = new Set<string>([supportId]);
      let added = true;
      while (added) {
        added = false;
        for (const s of supports) {
          if (cascadeIds.has(s.id)) continue;
          const cId = s.contactAttachedTo?.supportId;
          const bId = s.baseAttachedTo?.supportId;
          if ((cId && cascadeIds.has(cId)) || (bId && cascadeIds.has(bId))) {
            cascadeIds.add(s.id);
            added = true;
          }
        }
      }
      const removed = supports.filter((s) => cascadeIds.has(s.id));
      for (const id of cascadeIds) {
        await supportRepo.deleteSupport(id);
      }
      await refreshSupports();
      if (selectedSupportId && cascadeIds.has(selectedSupportId)) {
        setSelectedSupportId(null);
      }
      useUndoStore.getState().push({
        label: "remove-support",
        undo: async () => {
          await addSupports(removed);
        },
        redo: async () => {
          for (const id of cascadeIds) {
            await supportRepo.deleteSupport(id);
          }
          await refreshSupports();
        },
      });
    },
    [supports, addSupports, refreshSupports, selectedSupportId],
  );

  const handleMoveSupport = useCallback(
    async (id: string, newBaseXZ: [number, number]) => {
      const target = supports.find((s) => s.id === id);
      if (!target) return;

      const oldContact: [number, number, number] = [...target.contact];
      const oldBase: [number, number, number] = [...target.base];
      const newContact: [number, number, number] = [
        newBaseXZ[0],
        target.contact[1], // contact 의 Y 는 유지
        newBaseXZ[1],
      ];
      const newBase: [number, number, number] = [
        newBaseXZ[0],
        0,
        newBaseXZ[1],
      ];

      await patchSupport(id, { contact: newContact, base: newBase });

      useUndoStore.getState().push({
        label: "move-support",
        undo: async () => {
          await patchSupport(id, { contact: oldContact, base: oldBase });
        },
        redo: async () => {
          await patchSupport(id, { contact: newContact, base: newBase });
        },
      });
    },
    [supports, patchSupport],
  );

  // 부모 Bridge 가 수정된 직후 그 위에 부착된 child Bridge 들의
  // contact/base 를 새 path 의 t 위치 좌표로 다시 계산해서 따라가게.
  const followAttachedChildren = useCallback(
    async (
      parentId: string,
      parentBase: [number, number, number],
      parentCps:
        | [
            [number, number, number],
            [number, number, number],
            [number, number, number],
          ]
        | undefined,
      parentContact: [number, number, number],
    ) => {
      // closure stale 방지: 최신 supports 사용.
      const children = supportsRef.current.filter(
        (s) =>
          s.contactAttachedTo?.supportId === parentId ||
          s.baseAttachedTo?.supportId === parentId,
      );
      for (const child of children) {
        const updates: Parameters<typeof patchSupport>[1] = {};
        const newContact =
          child.contactAttachedTo?.supportId === parentId
            ? getBridgePathPoint(
                parentBase,
                parentCps,
                parentContact,
                child.contactAttachedTo.t,
              )
            : child.contact;
        const newBase =
          child.baseAttachedTo?.supportId === parentId
            ? getBridgePathPoint(
                parentBase,
                parentCps,
                parentContact,
                child.baseAttachedTo.t,
              )
            : child.base;

        if (newContact !== child.contact) updates.contact = newContact;
        if (newBase !== child.base) updates.base = newBase;

        // 변곡점 처리: 사용자가 child 를 직접 휘어놓지 않았다 (= 직선
        // 상태) 면 새 base→contact 직선으로 reset. 사용자가 휘어놓은
        // 곡선이면 끝점 비례 이동으로 모양 보존.
        // STL transform 컨텍스트에서도 cps 는 affected loop 의 결과
        // (옛 push 없는 STL 표면 위) 와 다른 push 레벨이라 follow 에서
        // 일관되게 다시 set 해야 한다.
        if (child.curveControlPoints) {
          if (
            isStraightCps(
              child.base,
              child.curveControlPoints,
              child.contact,
            )
          ) {
            updates.curveControlPoints = straightCps(newBase, newContact);
          } else {
            const dB: [number, number, number] = [
              newBase[0] - child.base[0],
              newBase[1] - child.base[1],
              newBase[2] - child.base[2],
            ];
            const dC: [number, number, number] = [
              newContact[0] - child.contact[0],
              newContact[1] - child.contact[1],
              newContact[2] - child.contact[2],
            ];
            const cps = child.curveControlPoints;
            const n = cps.length;
            updates.curveControlPoints = cps.map(
              (cp, i): [number, number, number] => {
                const t = (i + 1) / (n + 1);
                const w0 = 1 - t;
                return [
                  cp[0] + dB[0] * w0 + dC[0] * t,
                  cp[1] + dB[1] * w0 + dC[1] * t,
                  cp[2] + dB[2] * w0 + dC[2] * t,
                ];
              },
            );
          }
        }

        if (Object.keys(updates).length > 0) {
          await patchSupport(child.id, updates);
        }
      }
    },
    [supports, patchSupport],
  );

  const handleMoveBridgeControlPoint = useCallback(
    async (
      supportId: string,
      idx: number,
      pos: [number, number, number],
    ) => {
      const target = supports.find((s) => s.id === supportId);
      if (!target || !target.curveControlPoints) return;
      const oldCps = target.curveControlPoints;
      if (idx < 0 || idx >= oldCps.length) return;
      const newCps: typeof oldCps = oldCps.map((p) => [...p] as [number, number, number]);
      newCps[idx] = pos;

      // 자동 우회 호출 X — 사용자가 끈 위치를 그대로 보존.
      // 모델 안 침투 시 사용자가 직접 변곡점을 다시 조정한다.

      await patchSupport(supportId, { curveControlPoints: newCps });
      await followAttachedChildren(
        supportId,
        target.base,
        newCps,
        target.contact,
      );

      useUndoStore.getState().push({
        label: "move-bridge-cp",
        undo: async () => {
          await patchSupport(supportId, { curveControlPoints: oldCps });
        },
        redo: async () => {
          await patchSupport(supportId, { curveControlPoints: newCps });
        },
      });
    },
    [supports, patchSupport, followAttachedChildren],
  );

  const handleMoveBridgeEndpoint = useCallback(
    async (
      supportId: string,
      which: "base" | "contact",
      pos: [number, number, number],
    ) => {
      const target = supports.find((s) => s.id === supportId);
      if (!target || target.source !== "bridge") return;

      const oldBase = target.base;
      const oldContact = target.contact;
      const oldCps = target.curveControlPoints;

      const newBase: [number, number, number] =
        which === "base" ? pos : oldBase;
      const newContact: [number, number, number] =
        which === "contact" ? pos : oldContact;

      // 변곡점 비례 이동: t = 0.25 / 0.50 / 0.75 위치 기준으로
      // (Δbase × (1-t)) + (Δcontact × t) 만큼 함께 이동.
      // 사용자가 휘어놓은 곡선 모양이 그대로 유지된다.
      let newCps = oldCps;
      if (oldCps) {
        const dBase: [number, number, number] = [
          newBase[0] - oldBase[0],
          newBase[1] - oldBase[1],
          newBase[2] - oldBase[2],
        ];
        const dContact: [number, number, number] = [
          newContact[0] - oldContact[0],
          newContact[1] - oldContact[1],
          newContact[2] - oldContact[2],
        ];
        const n = oldCps.length;
        newCps = oldCps.map((cp, i): [number, number, number] => {
          const t = (i + 1) / (n + 1);
          const w0 = 1 - t;
          return [
            cp[0] + dBase[0] * w0 + dContact[0] * t,
            cp[1] + dBase[1] * w0 + dContact[1] * t,
            cp[2] + dBase[2] * w0 + dContact[2] * t,
          ];
        });

        // 자동 우회 호출 X — 사용자가 끈 위치를 그대로 보존.
        // (끝점 이동 시 변곡점 모양은 비례 이동 결과 그대로 유지.)
      }

      const patch: Parameters<typeof patchSupport>[1] = {
        base: newBase,
        contact: newContact,
      };
      if (newCps) patch.curveControlPoints = newCps;
      await patchSupport(supportId, patch);
      await followAttachedChildren(supportId, newBase, newCps, newContact);

      useUndoStore.getState().push({
        label: "move-bridge-endpoint",
        undo: async () => {
          const undoPatch: Parameters<typeof patchSupport>[1] = {
            base: oldBase,
            contact: oldContact,
          };
          if (oldCps) undoPatch.curveControlPoints = oldCps;
          await patchSupport(supportId, undoPatch);
        },
        redo: async () => {
          await patchSupport(supportId, patch);
        },
      });
    },
    [supports, patchSupport, followAttachedChildren],
  );

  // Bridge tube 더블클릭 시 그 위치에 변곡점 추가.
  const handleAddBridgeControlPoint = useCallback(
    async (supportId: string, hitPoint: [number, number, number]) => {
      const target = supports.find((s) => s.id === supportId);
      if (!target || target.source !== "bridge") return;
      const oldCps = target.curveControlPoints ?? [];
      // hit point 의 t 비율 계산 후 그 위치에 삽입.
      const t = findClosestT(
        target.base,
        oldCps.length > 0 ? oldCps : undefined,
        target.contact,
        hitPoint,
      );
      const newCps = insertControlPoint(
        target.base,
        oldCps.length > 0 ? oldCps : undefined,
        target.contact,
        t,
      );
      await patchSupport(supportId, { curveControlPoints: newCps });
      await followAttachedChildren(
        supportId,
        target.base,
        newCps,
        target.contact,
      );
      useUndoStore.getState().push({
        label: "add-bridge-cp",
        undo: async () => {
          if (oldCps.length === 0) {
            await patchSupport(supportId, { curveControlPoints: [] });
          } else {
            await patchSupport(supportId, { curveControlPoints: oldCps });
          }
        },
        redo: async () => {
          await patchSupport(supportId, { curveControlPoints: newCps });
        },
      });
    },
    [supports, patchSupport, followAttachedChildren],
  );

  // 선택된 변곡점 제거 (Delete 키).
  const handleRemoveBridgeControlPoint = useCallback(
    async (supportId: string, idx: number) => {
      const target = supports.find((s) => s.id === supportId);
      if (!target || target.source !== "bridge" || !target.curveControlPoints) {
        return;
      }
      const oldCps = target.curveControlPoints;
      if (idx < 0 || idx >= oldCps.length) return;
      const newCps = removeControlPoint(oldCps, idx);
      await patchSupport(supportId, { curveControlPoints: newCps });
      await followAttachedChildren(
        supportId,
        target.base,
        newCps,
        target.contact,
      );
      setSelectedCp(null);
      useUndoStore.getState().push({
        label: "remove-bridge-cp",
        undo: async () => {
          await patchSupport(supportId, { curveControlPoints: oldCps });
        },
        redo: async () => {
          await patchSupport(supportId, { curveControlPoints: newCps });
        },
      });
    },
    [supports, patchSupport, followAttachedChildren],
  );

  const handleDeleteSelectedSupport = useCallback(() => {
    // Support 모드: 변곡점 > 서포트 순으로 제거.
    if (editMode === "support") {
      if (selectedCp) {
        void handleRemoveBridgeControlPoint(
          selectedCp.supportId,
          selectedCp.idx,
        );
        return;
      }
      if (!selectedSupportId) return;
      void handleRemoveSupport(selectedSupportId);
      return;
    }
    // Select 모드: 선택된 STL 들 모두 제거.
    if (editMode === "select" && selectedIds.size > 0) {
      const ids = Array.from(selectedIds);
      setSelectedIds(new Set());
      void (async () => {
        for (const id of ids) await removeStlFile(id);
        // STL 삭제는 DB cascade 로 그 STL 의 서포트도 같이 사라지지만
        // useSupportsV2 state 가 stale 이라 명시적 refresh 필요.
        await refreshSupports();
      })();
    }
  }, [
    editMode,
    selectedSupportId,
    selectedCp,
    selectedIds,
    handleRemoveSupport,
    handleRemoveBridgeControlPoint,
    removeStlFile,
    refreshSupports,
  ]);

  // 선택된 Bridge 의 변곡점 3 개를 base→contact 직선상 균등 분할
  // 위치로 reset. 사용자가 휘어놓은 곡선을 한 번에 직선으로 복원.
  const handleResetBridgeCurve = useCallback(async () => {
    if (!selectedSupportId) return;
    const target = supports.find((s) => s.id === selectedSupportId);
    if (!target || target.source !== "bridge" || !target.curveControlPoints) {
      return;
    }
    const oldCps = target.curveControlPoints;
    // 기존 개수 유지하여 직선 reset (cps 길이 보존).
    const newCps = straightCps(target.base, target.contact, oldCps.length);
    await patchSupport(selectedSupportId, { curveControlPoints: newCps });
    // attached child 도 follow.
    await followAttachedChildren(
      selectedSupportId,
      target.base,
      newCps,
      target.contact,
    );

    useUndoStore.getState().push({
      label: "reset-bridge-curve",
      undo: async () => {
        await patchSupport(selectedSupportId, { curveControlPoints: oldCps });
      },
      redo: async () => {
        await patchSupport(selectedSupportId, { curveControlPoints: newCps });
      },
    });
  }, [
    selectedSupportId,
    supports,
    patchSupport,
    followAttachedChildren,
  ]);

  useShortcutHandler("delete", handleDeleteSelectedSupport);

  // ----- 마스크 ZIP 내보내기 -----
  const handleExportMasksZip = useCallback(async () => {
    const handle = sceneHandleRef.current;
    if (!handle || files.length === 0) return;
    if (batchExport.busy) return;
    setBatchExport({ busy: true, done: 0, total: 0 });
    try {
      // 씬(Babylon Mesh)은 워커로 못 넘어가므로 world 삼각형 배열로 직렬화해 전달.
      const meshes = handle.getSliceGeometry();
      const topY = handle.getSceneTopY();
      const blob = await sliceBatchService.exportPngZip(
        meshes,
        {
          layerHeightMm: slicePreview.layerHeightMm,
          widthPx: printerProfile.lcdWidthPx,
          heightPx: printerProfile.lcdHeightPx,
          plateWidthMm: printerProfile.buildVolumeMm[0],
          plateDepthMm: printerProfile.buildVolumeMm[1],
          topY,
          // 프로파일에 노광 설정이 있을 때만 manifest 에 노광 배열 동봉 (기존 프로파일 하위 호환).
          exposure: profileExposure(printerProfile),
        },
        (done, total) => setBatchExport({ busy: true, done, total }),
      );
      if (!blob) return;
      const safe = (project?.name ?? "project").replace(
        /[\\/:*?"<>|]/g,
        "_",
      );
      const lh = slicePreview.layerHeightMm.toFixed(3).replace(".", "_");
      downloadBlob(blob, `${safe}_layers_${lh}mm.zip`);
    } finally {
      setBatchExport({ busy: false, done: 0, total: 0 });
    }
  }, [
    files.length,
    project?.name,
    slicePreview.layerHeightMm,
    batchExport.busy,
    printerProfile,
  ]);

  // ----- .ctb v4 내보내기 -----
  const handleExportCtb = useCallback(async () => {
    const handle = sceneHandleRef.current;
    if (!handle || files.length === 0) return;
    if (batchExport.busy) return;
    setBatchExport({ busy: true, done: 0, total: 0 });
    try {
      // 씬(Babylon Mesh)은 워커로 못 넘어가므로 world 삼각형 배열로 직렬화해 전달.
      const meshes = handle.getSliceGeometry();
      const topY = handle.getSceneTopY();
      const blob = await sliceBatchService.exportCtb(
        meshes,
        {
          layerHeightMm: slicePreview.layerHeightMm,
          widthPx: printerProfile.lcdWidthPx,
          heightPx: printerProfile.lcdHeightPx,
          plateWidthMm: printerProfile.buildVolumeMm[0],
          plateDepthMm: printerProfile.buildVolumeMm[1],
          topY,
        },
        {
          bedSizeZMm: printerProfile.buildVolumeMm[2],
          // 프로파일에 값이 없으면 undefined → 인코더 기본값 사용 (기존 산출물과 동일).
          exposureSec: printerProfile.exposureSec,
          bottomExposureSec: printerProfile.bottomExposureSec,
          bottomLayerCount: printerProfile.bottomLayerCount,
          transitionLayerCount: printerProfile.transitionLayerCount,
          // 리프트/딜레이 — 미지정 시 워커에서 DEFAULT_*(v1) 폴백. CTB 기록과 예상 시간이 같은 값 기준.
          lightOffDelaySec: printerProfile.lightOffDelaySec,
          liftDistanceMm: printerProfile.liftDistanceMm,
          liftSpeedMmS: printerProfile.liftSpeedMmS,
          retractSpeedMmS: printerProfile.retractSpeedMmS,
        },
        (done, total) => setBatchExport({ busy: true, done, total }),
      );
      if (!blob) return;
      const safe = (project?.name ?? "project").replace(
        /[\\/:*?"<>|]/g,
        "_",
      );
      downloadBlob(blob, `${safe}_v3.ctb`);
    } finally {
      setBatchExport({ busy: false, done: 0, total: 0 });
    }
  }, [
    files.length,
    project?.name,
    slicePreview.layerHeightMm,
    batchExport.busy,
    printerProfile,
  ]);

  // ----- STL 내보내기 -----
  // Chrome/Edge 의 File System Access API (showSaveFilePicker) 우선 사용 —
  // 사용자가 매 저장 시 위치 직접 선택 (작업 디렉토리 등). 다운로드 폴더
  // 안 거쳐서 보안 프로그램 우회. 미지원 브라우저는 기존 downloadBlob fallback.
  const handleExportStl = useCallback(async () => {
    if (files.length === 0) return;
    const blob = sceneHandleRef.current?.exportStl();
    if (!blob) return;
    const safe = (project?.name ?? "project").replace(/[\\/:*?"<>|]/g, "_");
    const suffix = supports.length > 0 ? "_supported" : "";
    const fileName = `${safe}${suffix}.stl`;

    const w = window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName?: string;
        types?: {
          description?: string;
          accept: Record<string, string[]>;
        }[];
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };

    if (typeof w.showSaveFilePicker === "function") {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: "STL binary",
              accept: { "model/stl": [".stl"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (e) {
        // 사용자 취소 (AbortError) → 그대로 종료, fallback X.
        if ((e as { name?: string })?.name === "AbortError") return;
        // 기타 오류 → fallback.
      }
    }

    downloadBlob(blob, fileName);
  }, [files.length, project?.name, supports.length]);

  const handleClearAllSupports = useCallback(async () => {
    if (!projectId) return;
    if (supports.length === 0) return;
    const snapshot: SupportPointV2[] = supports.slice();
    await clearAllSupports();
    useUndoStore.getState().push({
      label: "clear-supports",
      undo: async () => {
        await addSupports(snapshot);
      },
      redo: async () => {
        await clearAllSupports();
      },
    });
  }, [projectId, supports, clearAllSupports, addSupports]);

  // ----- Dental 브러쉬 색칠 -----
  // 씬이 색칠 변경을 통지 → stlId 별 painted face 목록 갱신. 빈 목록이면 제거.
  const handlePaintedFacesChange = useCallback(
    (stlId: string, faceIds: number[]) => {
      setPaintedFaces((prev) => {
        const next = { ...prev };
        if (faceIds.length === 0) delete next[stlId];
        else next[stlId] = faceIds;
        return next;
      });
    },
    [],
  );

  const handleClearDentalPaint = useCallback(() => {
    sceneHandleRef.current?.clearDentalPaint();
    setPaintedFaces({});
    // clearDentalPaint 는 씬에서 마진·아일랜드 시각화도 함께 정리하므로 상태도 초기화.
    setMarginStatus(null);
    setIslandStatus(null);
  }, []);

  // ----- Dental 마진 찾기 (2-3b) -----
  //   씬에서 색칠 영역 → findMargin → 초록 튜브 시각화. 성공/실패 사유를
  //   패널 문구로 표시. painted 0 이면 패널 버튼이 비활성이라 여기 도달 X.
  const handleFindMargin = useCallback(() => {
    const res = sceneHandleRef.current?.findDentalMargin();
    if (!res) return;
    if (res.ok) {
      setMarginStatus({
        ok: true,
        message: `마진 검출 완료 · 마진 엣지 ${res.stats.marginEdgeCount}개 (색칠 ${res.stats.paintedFaceCount}면)`,
      });
    } else {
      setMarginStatus({ ok: false, message: res.reason });
    }
  }, []);

  const handleClearMargin = useCallback(() => {
    sceneHandleRef.current?.clearDentalMargin();
    setMarginStatus(null);
  }, []);

  // ----- Dental 아일랜드 검출 (2-3c) -----
  //   활성 STL 전체를 슬라이스 → detectSliceIslands → 마젠타 overlay.
  //   레이어 높이는 슬라이스 프리뷰가 쓰는 값(slicePreview.layerHeightMm)을 재사용.
  const handleDetectIslands = useCallback(() => {
    const res = sceneHandleRef.current?.detectDentalIslands(
      slicePreview.layerHeightMm,
    );
    if (!res) return;
    if (res.ok) {
      setIslandStatus({
        ok: true,
        totalIslandFaces: res.stats.totalIslandFaces,
        nSlices: res.stats.nSlices,
        layersWithIsland: res.stats.layersWithIsland,
      });
    } else {
      setIslandStatus({ ok: false, message: res.reason });
    }
  }, [slicePreview.layerHeightMm]);

  const handleClearIslands = useCallback(() => {
    sceneHandleRef.current?.clearDentalIslands();
    setIslandStatus(null);
  }, []);

  // ----- Transform -----
  const handlePreviewTransform = useCallback(
    (id: string, t: TransformV2) => {
      sceneHandleRef.current?.previewTransform(id, t);
    },
    [],
  );

  const handleCommitTransform = useCallback(
    (id: string, start: TransformV2, end: TransformV2) => {
      // 즉시 DB 반영. (그 사이 메쉬는 이미 preview 로 반영돼 있음)
      void updateTransform(id, end);

      // 부착된 서포트도 transform delta 만큼 같이 이동시킨다.
      //   단점/auto: contact, base 둘 다 동일 변환.
      //   Bridge   : 자기 쪽 끝점만 변환 + 변곡점은 끝점 비례 이동.
      //
      // 영향 받는 서포트: stlId == id (contact 쪽) 또는 baseStlId == id
      // (Bridge base 쪽). closure stale 방지 위해 ref 사용.
      const currentSupports = supportsRef.current;
      const affected = currentSupports.filter(
        // stl-local 좌표 supports 는 mesh.parent 가 자동 follow → patch X.
        (s) =>
          s.coordSpace !== "stl-local" &&
          (s.stlId === id || s.baseStlId === id),
      );


      type CpsArr = [number, number, number][];
      type SupportPatch = {
        contact: [number, number, number];
        base: [number, number, number];
        curveControlPoints?: CpsArr;
      };
      const oldStates: { id: string; patch: SupportPatch }[] = [];
      const newPatches: { id: string; patch: SupportPatch }[] = [];

      for (const sup of affected) {
        const isBridge = sup.source === "bridge";
        const contactSide = sup.stlId === id;
        // Bridge 는 base 도 다른 STL 에 부착돼있어 양쪽 따라가지만,
        // 단점/auto 는 base 가 빌드플레이트 (또는 다른 STL 상단) 라
        // 회전을 함께 적용하면 비스듬해진다.
        const baseSide = sup.baseStlId === id;

        // main/sub 통합: 모든 Bridge endpoint 를 STL transform 적용.
        // sub Bridge 의 attached 끝점은 follow 단계에서 부모 path 위
        // 정확한 t 위치로 다시 덮어씀 → 일관된 최종 좌표.
        const newContact = contactSide
          ? transformPointBetween(sup.contact, start, end)
          : sup.contact;
        let newBase: [number, number, number];
        if (isBridge) {
          newBase = baseSide
            ? transformPointBetween(sup.base, start, end)
            : sup.base;
        } else if (contactSide) {
          // 단점/auto: contact 는 모델 따라 이동, base 는 새 contact 의
          // 수직 아래 (자기 모델 제외하고 가장 가까운 표면 또는 Y=0).
          const groundY =
            sceneHandleRef.current?.findSurfaceBelow(
              newContact[0],
              newContact[2],
              newContact[1] - 0.01,
              [sup.stlId],
            ) ?? 0;
          newBase = [newContact[0], groundY, newContact[2]];
        } else {
          newBase = sup.base;
        }

        let newCps: CpsArr | undefined = sup.curveControlPoints
          ? sup.curveControlPoints.map(
              (p) => [...p] as [number, number, number],
            )
          : undefined;

        if (isBridge && sup.curveControlPoints) {
          // 변곡점도 STL local 좌표로 부착. main/sub 동일 처리. sub 의
          // 경우 follow 가 부모 path 따라 다시 보정.
          const cps = sup.curveControlPoints;
          const nn = cps.length;
          newCps = cps.map((cp, i): [number, number, number] => {
            const t = (i + 1) / (nn + 1);
            const useBaseSide = t < 0.5;
            const stlSide = useBaseSide ? baseSide : contactSide;
            if (stlSide) {
              return transformPointBetween(cp, start, end);
            }
            return cp;
          });
        }

        const oldPatch: SupportPatch = {
          contact: sup.contact,
          base: sup.base,
        };
        if (sup.curveControlPoints) {
          oldPatch.curveControlPoints = sup.curveControlPoints;
        }
        const newPatch: SupportPatch = {
          contact: newContact,
          base: newBase,
        };
        if (newCps) newPatch.curveControlPoints = newCps;

        oldStates.push({ id: sup.id, patch: oldPatch });
        newPatches.push({ id: sup.id, patch: newPatch });
      }

      // 부모 Bridge 의 새 path 정보 (follow 호출용).
      type FollowInfo = {
        parentId: string;
        base: [number, number, number];
        contact: [number, number, number];
        cps?: CpsArr;
      };
      const follows: FollowInfo[] = [];
      for (let i = 0; i < affected.length; i++) {
        const sup = affected[i];
        if (sup.source !== "bridge") continue;
        const p = newPatches[i].patch;
        follows.push({
          parentId: sup.id,
          base: p.base,
          contact: p.contact,
          cps: p.curveControlPoints,
        });
      }


      void (async () => {
        await Promise.all(
          newPatches.map(({ id: sid, patch }) => patchSupport(sid, patch)),
        );
        // 변환된 부모 Bridge 들의 새 path 로 부착된 child 들도 따라옴.
        for (const f of follows) {
          await followAttachedChildren(f.parentId, f.base, f.cps, f.contact);
        }
        // sub Bridge (양 끝 모두 attached) 정확 보정 — newPatches 의
        // 부모 new path 를 직접 활용해 한 번에 contact + base + cps
        // 모두 set. follow 가 부모마다 따로 호출되어 race 발생하던
        // 케이스 해결.
        const subBridges = supportsRef.current.filter(
          (s) =>
            s.source === "bridge" &&
            s.contactAttachedTo?.supportId &&
            s.baseAttachedTo?.supportId,
        );
        for (const sub of subBridges) {
          const cParent = newPatches.find(
            (p) => p.id === sub.contactAttachedTo!.supportId,
          );
          const bParent = newPatches.find(
            (p) => p.id === sub.baseAttachedTo!.supportId,
          );
          if (!cParent || !bParent) continue;
          const newContact = getBridgePathPoint(
            cParent.patch.base,
            cParent.patch.curveControlPoints,
            cParent.patch.contact,
            sub.contactAttachedTo!.t,
          );
          const newBase = getBridgePathPoint(
            bParent.patch.base,
            bParent.patch.curveControlPoints,
            bParent.patch.contact,
            sub.baseAttachedTo!.t,
          );
          const updates: Parameters<typeof patchSupport>[1] = {
            contact: newContact,
            base: newBase,
          };
          if (sub.curveControlPoints) {
            updates.curveControlPoints = straightCps(
              newBase,
              newContact,
              sub.curveControlPoints.length,
            );
          }
          await patchSupport(sub.id, updates);
        }
      })();

      // Undo entry: STL transform + 모든 영향 받은 서포트 복원/재적용.
      useUndoStore.getState().push({
        label: "transform",
        undo: async () => {
          await updateTransform(id, start);
          await Promise.all(
            oldStates.map(({ id: sid, patch }) => patchSupport(sid, patch)),
          );
        },
        redo: async () => {
          await updateTransform(id, end);
          await Promise.all(
            newPatches.map(({ id: sid, patch }) => patchSupport(sid, patch)),
          );
        },
      });
    },
    [updateTransform, supports, patchSupport, followAttachedChildren],
  );

  if (!projectId) {
    return <Navigate to="/v2/projects" replace />;
  }

  // ----- 파일 추가/삭제 -----
  async function handlePicked(file: { name: string; blob: Blob }) {
    setBrowserOpen(false);
    const created = await addStlFile(file.name, file.blob);
    setSelectedIds(new Set([created.id]));
  }

  // 브라우저 네이티브 파일 열기 / 드래그앤드롭 공통 저장 경로.
  // handlePicked 와 동일하게 addStlFile → repo.createStlFile → IndexedDB.
  // 여러 파일을 순차 저장하고 새로 추가된 파일 전체를 선택 상태로 만든다.
  async function addNativeFiles(fileList: File[]) {
    const stlFiles = fileList.filter((f) =>
      f.name.toLowerCase().endsWith(".stl"),
    );
    if (stlFiles.length === 0) return;
    const newIds: string[] = [];
    for (const file of stlFiles) {
      // File 은 Blob 의 서브타입이라 blob 으로 그대로 전달 가능.
      const created = await addStlFile(file.name, file);
      newIds.push(created.id);
    }
    if (newIds.length > 0) setSelectedIds(new Set(newIds));
  }

  // 숨김 input 을 통한 "내 PC에서 열기".
  function handleNativeInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    // 같은 파일을 다시 선택해도 onChange 가 발생하도록 value 초기화.
    e.target.value = "";
    void addNativeFiles(picked);
  }

  // ----- 드래그앤드롭 (뷰어 영역) -----
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // canvas 등 자식 요소로 이동하는 경우는 무시하고, 컨테이너 바깥으로
    // 실제로 벗어날 때만 해제. relatedTarget 이 main 안에 없으면 이탈.
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    void addNativeFiles(dropped);
  };

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

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <header className="bg-white border-b">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => navigate("/v2/projects")}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              ← Projects
            </button>
            <h1 className="text-lg font-semibold text-gray-900">
              {project?.name ?? (loading ? "Loading…" : "Unknown project")}
            </h1>
            {project && (
              <span className="text-xs text-gray-500 font-mono">
                {project.code}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <PrinterProfileSelect onEdit={() => setProfileDialogOpen(true)} />
            <button
              onClick={() => {
                setSlicePreview((s) => {
                  if (!s.on) {
                    const top = sceneHandleRef.current?.getSceneTopY() ?? 0;
                    setSceneTopY(top);
                  }
                  return { ...s, on: !s.on };
                });
              }}
              className={`px-3 py-1 text-sm border rounded transition-colors ${
                slicePreview.on
                  ? "bg-primary-600 text-white border-primary-600"
                  : "text-primary-700 border-primary-600 hover:bg-primary-50"
              }`}
            >
              슬라이스 미리보기
            </button>
            <button
              onClick={handleExportStl}
              disabled={files.length === 0}
              className="px-3 py-1 text-sm text-primary-700 border border-primary-600 rounded hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              STL 내보내기
            </button>
            <button
              onClick={() => setGhDialog("save")}
              disabled={!projectId}
              className="px-3 py-1 text-sm text-primary-700 border border-primary-600 rounded hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="현재 프로젝트 전체 (STL + 서포트 + 변환) 를 GitHub 에 저장"
            >
              GitHub 저장
            </button>
            <button
              onClick={() => setGhDialog("load")}
              className="px-3 py-1 text-sm text-primary-700 border border-primary-600 rounded hover:bg-primary-50 transition-colors"
              title="GitHub 에서 저장된 프로젝트 불러오기"
            >
              GitHub 불러오기
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1 text-sm text-primary-700 border border-primary-600 rounded hover:bg-primary-50 transition-colors"
              title="브라우저 파일 선택 창으로 내 PC 의 STL 을 엽니다 (백엔드 불필요)"
            >
              내 PC에서 열기
            </button>
            <button
              onClick={() => setBrowserOpen(true)}
              className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
            >
              STL 불러오기
            </button>
          </div>
        </div>
      </header>

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
          onAdd={() => setBrowserOpen(true)}
          onRemove={handleRemove}
          loading={filesLoading}
        />

        <main
          className="flex-1 relative bg-gray-100"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
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
            onAddSupportAt={handleAddSupportAt}
            onPickSupport={setSelectedSupportId}
            selectedSupportId={selectedSupportId}
            onMoveSupport={handleMoveSupport}
            pendingBridgePoint={pendingBridge?.contact ?? null}
            bridgeMode={bridgeMode}
            sliceY={slicePreview.on ? sliceYNow : null}
            onMoveBridgeControlPoint={handleMoveBridgeControlPoint}
            onMoveBridgeEndpoint={handleMoveBridgeEndpoint}
            onDoublePickStl={(id) => {
              setSelectedIds(new Set([id]));
              setGizmoMode("rotate");
            }}
            onDoublePickBridgeTube={(supportId, hit) =>
              void handleAddBridgeControlPoint(supportId, hit)
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
            brushThicknessMm={brushThicknessMm}
            onPaintedFacesChange={handlePaintedFacesChange}
            onBrushThicknessChange={setBrushThicknessMm}
          />

          {/* 우측 상단 stack: 모든 overlay 컨트롤 / 정보 패널 */}
          <div className="absolute top-3 right-3 flex flex-col items-end gap-2 max-w-[calc(100%-1.5rem)]">
            <ViewControls
              onSetView={(p) => sceneHandleRef.current?.setView(p)}
              onFit={() => sceneHandleRef.current?.fit()}
            />

            <GizmoControls
              mode={gizmoMode}
              onChange={setGizmoMode}
              enabled={selectedIds.size === 1 && editMode === "select"}
            />

            {gizmoMode === "rotate" && editMode === "select" && (
              <button
                onClick={() => setAlignFloorMode((v) => !v)}
                className={`px-3 py-1.5 text-xs rounded-md shadow border transition-colors ${
                  alignFloorMode
                    ? "bg-primary-600 text-white border-primary-600"
                    : "bg-white/95 backdrop-blur border-gray-200 text-gray-700 hover:bg-gray-100"
                }`}
                title="모델의 한 face 를 클릭하면 그 면이 바닥에 닿도록 회전 + Y 이동"
              >
                {alignFloorMode ? "면 클릭 대기..." : "바닥면 붙이기"}
              </button>
            )}

            <EditModeControls
              mode={editMode}
              onChange={(m) => {
                setEditMode(m);
                setSelectedCp(null);
                // support 전용 상태는 support 모드가 아닐 때 정리.
                if (m !== "support") {
                  setSelectedSupportId(null);
                  setBridgeMode(false);
                  setDiscMode(false);
                  setPendingBridge(null);
                }
                // dental 모드 진입 시 우측 패널을 Dental 탭으로.
                if (m === "dental-brush") setPanelTab("dental");
              }}
            />

            {selectedIds.size === 1 &&
              editMode === "select" &&
              (() => {
                const id = Array.from(selectedIds)[0];
                const f = files.find((file) => file.id === id);
                if (!f) return null;
                const t = f.transform ?? IDENTITY_TRANSFORM;
                return (
                  <div className="bg-white/90 backdrop-blur rounded-md shadow px-3 py-2 text-xs font-mono text-gray-700 pointer-events-none">
                    <div className="text-[10px] text-gray-500 mb-0.5 font-sans">
                      {f.fileName}
                    </div>
                    <div>
                      <span className="text-red-500">X</span>{" "}
                      {t.tx.toFixed(2)} mm
                    </div>
                    <div>
                      <span className="text-green-600">Y</span>{" "}
                      {t.ty.toFixed(2)} mm
                    </div>
                    <div>
                      <span className="text-blue-500">Z</span>{" "}
                      {t.tz.toFixed(2)} mm
                    </div>
                  </div>
                );
              })()}

          {editMode === "support" && (
            <div className="flex items-center gap-3 bg-white/95 backdrop-blur rounded-md shadow px-3 py-2 text-xs text-gray-700">
              {bridgeMode ? (
                <span className="pointer-events-none">
                  <strong>Bridge 모드</strong> ·{" "}
                  {pendingBridge
                    ? "두 번째 지점을 클릭"
                    : "첫 번째 지점을 클릭"}{" "}
                  · <kbd className="px-1 border rounded">Esc</kbd> = 취소
                </span>
              ) : discMode ? (
                <span className="pointer-events-none">
                  <strong>디스크 서포트 모드</strong> · 모델 표면 = 배치 ·
                  기둥 클릭 = 선택 ·{" "}
                  <kbd className="px-1 border rounded">Delete</kbd> = 삭제
                </span>
              ) : (
                <span className="pointer-events-none">
                  <strong>서포트 편집</strong> · 모델 표면 = 추가 · 기둥 클릭
                  = 선택 · <kbd className="px-1 border rounded">Delete</kbd> =
                  삭제
                </span>
              )}
              <button
                onClick={() => {
                  setBridgeMode((v) => !v);
                  setDiscMode(false); // bridge 와 disc 는 상호 배타.
                  setPendingBridge(null);
                }}
                className={`px-2 py-0.5 text-xs border rounded transition-colors ${
                  bridgeMode
                    ? "bg-primary-600 text-white border-primary-600"
                    : "border-primary-600 text-primary-700 hover:bg-primary-50"
                }`}
              >
                Bridge
              </button>
              <button
                onClick={() => {
                  setDiscMode((v) => !v);
                  setBridgeMode(false); // disc 와 bridge 는 상호 배타.
                  setPendingBridge(null);
                }}
                className={`px-2 py-0.5 text-xs border rounded transition-colors ${
                  discMode
                    ? "bg-primary-600 text-white border-primary-600"
                    : "border-primary-600 text-primary-700 hover:bg-primary-50"
                }`}
                title="지현규 dental disc 서포트 — 모델 표면 클릭으로 배치"
              >
                Disc
              </button>
              <button
                onClick={() => void handleResetBridgeCurve()}
                disabled={
                  !selectedSupportId ||
                  bridgeMode ||
                  supports.find((s) => s.id === selectedSupportId)?.source !==
                    "bridge"
                }
                className="px-2 py-0.5 text-xs border border-gray-400 text-gray-700 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="선택된 Bridge 의 변곡점을 직선 균등 분할로 복원"
              >
                직선 복원
              </button>
              <button
                onClick={handleDeleteSelectedSupport}
                disabled={!selectedSupportId || bridgeMode}
                className="px-2 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                선택 삭제
              </button>
            </div>
          )}
          </div>
          {/* 우측 상단 stack 끝 */}

          {files.length === 0 && !isDragOver && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
              <div className="bg-white/90 backdrop-blur rounded-md shadow px-4 py-3 text-sm text-gray-600">
                좌측 '+ 추가' · 상단 '내 PC에서 열기' · STL 을 여기로 드래그하여
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

          {/* 우측 하단 stack: 색 범례 / 축 + 플레이트 정보 */}
          <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2">
            {files.length > 0 && (
              <div className="bg-white/90 backdrop-blur rounded-md shadow px-3 py-2 text-xs text-gray-700 space-y-1 pointer-events-none">
                <div className="flex items-center space-x-2">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ background: "rgb(255, 82, 82)" }}
                  />
                  <span>Overhang (≤ {overhangAngleDeg}°)</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ background: "rgb(199, 202, 212)" }}
                  />
                  <span>Safe</span>
                </div>
              </div>
            )}

            <div className="bg-white/90 backdrop-blur rounded-md shadow px-3 py-2 text-xs text-gray-600 pointer-events-none">
              <div className="flex items-center space-x-2">
                <span
                  className="inline-block w-3 h-1 rounded"
                  style={{ background: "rgb(255,77,77)" }}
                />
                <span>X</span>
                <span
                  className="inline-block w-3 h-1 rounded ml-2"
                  style={{ background: "rgb(77,230,102)" }}
                />
                <span>Y (위)</span>
                <span
                  className="inline-block w-3 h-1 rounded ml-2"
                  style={{ background: "rgb(89,140,255)" }}
                />
                <span>Z</span>
              </div>
              <div className="mt-1 text-gray-500">
                플레이트 {printerProfile.buildVolumeMm[0].toFixed(1)} ×{" "}
                {printerProfile.buildVolumeMm[1].toFixed(1)} mm · 격자 10 mm
              </div>
            </div>
          </div>
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
            onExportCtb={() => void handleExportCtb()}
            batchBusy={batchExport.busy}
            batchDone={batchExport.done}
            batchTotal={batchExport.total}
            modelCount={files.length}
          />
        )}

        <aside className="w-80 border-l bg-white overflow-y-auto flex flex-col">
          {error && (
            <p className="text-red-600 text-sm m-4">
              프로젝트 조회 실패: {error.message}
            </p>
          )}
          {/* 탭: Transform / Support / Dental */}
          <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
            {(["transform", "support", "dental"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setPanelTab(t)}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  panelTab === t
                    ? "bg-white text-primary-700 border-b-2 border-primary-600 -mb-px"
                    : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {t === "transform"
                  ? "Transform"
                  : t === "support"
                    ? "Support"
                    : "Dental"}
              </button>
            ))}
          </div>
          <div className="p-4">
            {panelTab === "transform" ? (
              <TransformPanel
                selected={transformPanelSelected}
                onPreview={handlePreviewTransform}
                onCommit={handleCommitTransform}
              />
            ) : panelTab === "support" ? (
              <SupportParamsPanel
                onAutoGenerate={handleAutoGenerate}
                onClearAll={handleClearAllSupports}
                supportCount={supports.length}
                busy={autoBusy}
              />
            ) : (
              <DentalPanel
                brushActive={editMode === "dental-brush"}
                onToggleBrush={(active) => {
                  setEditMode(active ? "dental-brush" : "select");
                  setSelectedCp(null);
                  setSelectedSupportId(null);
                  setBridgeMode(false);
                  setDiscMode(false);
                  setPendingBridge(null);
                }}
                brushThicknessMm={brushThicknessMm}
                onBrushThicknessChange={setBrushThicknessMm}
                onClearPaint={handleClearDentalPaint}
                paintedFaceCount={Object.values(paintedFaces).reduce(
                  (sum, ids) => sum + ids.length,
                  0,
                )}
                onFindMargin={handleFindMargin}
                onClearMargin={handleClearMargin}
                marginStatus={marginStatus}
                onDetectIslands={handleDetectIslands}
                onClearIslands={handleClearIslands}
                islandStatus={islandStatus}
              />
            )}
          </div>
        </aside>
      </div>

      {browserOpen && (
        <LocalFileBrowser
          onSelect={handlePicked}
          onClose={() => setBrowserOpen(false)}
        />
      )}

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

    </div>
  );
};

function addCopySuffix(name: string, existing: { fileName: string }[]): string {
  const existingNames = new Set(existing.map((e) => e.fileName));
  if (!existingNames.has(name)) return name;
  const dotIdx = name.lastIndexOf(".");
  const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : "";
  let candidate = `${stem} (copy)${ext}`;
  let i = 2;
  while (existingNames.has(candidate)) {
    candidate = `${stem} (copy ${i})${ext}`;
    i++;
  }
  return candidate;
}

export default ViewerV2Page;
