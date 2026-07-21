// 서포트/브릿지 배치·이동·삭제·변곡점 편집 핸들러 묶음 + 관련 편집 상태.
// (ViewerV2Page 에서 추출 — undo push·supportsRef·cascade 동작 불변.)
//
// followAttachedChildren 은 useTransformCommit 이 소유하며 인자로 주입받는다.

import { useCallback, useRef, useState } from "react";

import { useUndoStore } from "../../../hooks/useUndoStore";
import * as supportRepo from "../../../data/supports.repo";
import type { SupportPointV2 } from "../../../support/types";
import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import type { EditMode } from "../../../components/EditModeControls";
import type { SupportParams } from "../../../support";
import { IDENTITY_TRANSFORM } from "../../../types/transform";
import { addCopySuffix } from "../utils/file-naming";
import { useBridgeControlPoints } from "./useBridgeControlPoints";
import type {
  AddStlFile,
  AddSupports,
  ClearAllSupports,
  RefreshSupports,
  PatchSupport,
  RemoveStlFile,
  UpdateTransform,
} from "./types";
import type { STLFileV2 } from "../../../types/stl";

type Vec3 = [number, number, number];
type Cps3 = [Vec3, Vec3, Vec3];

interface PendingBridge {
  stlId: string;
  contact: Vec3;
  normal?: Vec3;
  attachedTo?: { supportId: string; t: number };
}

interface UseSupportEditingArgs {
  projectId: string | undefined;
  files: STLFileV2[];
  supports: SupportPointV2[];
  supportParams: SupportParams;
  sceneHandleRef: React.RefObject<BabylonSceneHandle>;
  editMode: EditMode;
  selectedIds: ReadonlySet<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  addSupports: AddSupports;
  clearAllSupports: ClearAllSupports;
  refreshSupports: RefreshSupports;
  patchSupport: PatchSupport;
  addStlFile: AddStlFile;
  removeStlFile: RemoveStlFile;
  updateTransform: UpdateTransform;
  followAttachedChildren: (
    parentId: string,
    parentBase: Vec3,
    parentCps: Cps3 | undefined,
    parentContact: Vec3,
  ) => Promise<void>;
  setCtxMenu: React.Dispatch<
    React.SetStateAction<{ x: number; y: number } | null>
  >;
}

export function useSupportEditing({
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
}: UseSupportEditingArgs) {
  const [bridgeMode, setBridgeMode] = useState(false);
  const [pendingBridge, setPendingBridge] = useState<PendingBridge | null>(
    null,
  );
  const [selectedSupportId, setSelectedSupportId] = useState<string | null>(
    null,
  );
  // 선택된 Bridge 변곡점 idx (sphere 클릭 시 설정). Delete 키로 제거.
  const [selectedCp, setSelectedCp] = useState<{
    supportId: string;
    idx: number;
  } | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

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
  }, [projectId, autoBusy, files.length, supportParams, addSupports, refreshSupports, sceneHandleRef]);

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

      // 단점 모드 — 모델 표면 클릭 → 단일 trunk 서포트 배치.
      if (contact[1] <= 0.5) return;
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
    [projectId, bridgeMode, pendingBridge, addSupports, refreshSupports, sceneHandleRef],
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

  // Bridge 변곡점 편집 핸들러는 크기 축소를 위해 별도 훅으로 분리.
  const {
    handleMoveBridgeControlPoint,
    handleMoveBridgeEndpoint,
    handleAddBridgeControlPoint,
    handleRemoveBridgeControlPoint,
    handleResetBridgeCurve,
  } = useBridgeControlPoints({
    supports,
    selectedSupportId,
    patchSupport,
    followAttachedChildren,
    setSelectedCp,
  });

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
    setSelectedIds,
  ]);

  // 선택된 STL 을 복제한다 (P5 컨텍스트 메뉴 · Select 모드).
  //   handlePaste 와 동일하게 "addCopySuffix + addStlFile" 경로로 새 STL 을 추가하되,
  //   소스는 클립보드가 아니라 현재 선택이다 — 사용자 Ctrl+C 클립보드는 건드리지 않는다.
  //   원본에서 XZ +5mm 오프셋해 겹침을 피한다 (자동배치는 건드리지 않음).
  const handleDuplicateSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const sources = files.filter((f) => selectedIds.has(f.id));
    const newIds: string[] = [];
    for (const src of sources) {
      const created = await addStlFile(
        addCopySuffix(src.fileName, files),
        src.blob,
      );
      // 원본 transform 을 복제하고 XZ 로 +5mm 이동해 원본 위에 겹치지 않게 한다.
      const base = src.transform ?? IDENTITY_TRANSFORM;
      await updateTransform(created.id, {
        ...base,
        tx: base.tx + 5,
        tz: base.tz + 5,
      });
      newIds.push(created.id);
    }
    setSelectedIds(new Set(newIds));
  }, [files, selectedIds, addStlFile, updateTransform, setSelectedIds]);

  // ----- 우클릭 컨텍스트 메뉴 (P5) -----
  //   프루사와 동일하게 짧은 우클릭=메뉴, 우드래그=팬 으로 구분한다.
  //   pointerdown(우) 좌표를 기록 → pointerup(우) 이동량<임계값이면 메뉴 오픈.
  //   contextmenu 이벤트는 preventDefault 로 죽여 브라우저 기본 메뉴/팬 충돌을 없앤다.
  const CTX_MENU_DRAG_THRESHOLD_PX = 5;
  // 우클릭 시작 좌표 — pointerup 에서 이동량<임계값이면 컨텍스트 메뉴, 아니면 팬 (P5).
  const rightDownRef = useRef<{ x: number; y: number } | null>(null);
  const handleViewportPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2) {
      rightDownRef.current = { x: e.clientX, y: e.clientY };
    }
  }, []);
  const handleViewportPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 2) return;
      const start = rightDownRef.current;
      rightDownRef.current = null;
      if (!start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      // 이동량이 크면 우드래그(팬) 로 간주 — 메뉴를 열지 않는다.
      if (moved > CTX_MENU_DRAG_THRESHOLD_PX) return;
      // 선택된 모델이 있을 때만 메뉴를 연다 (빈 공간 우클릭 → 메뉴 없음).
      if (editMode !== "select" || selectedIds.size === 0) return;
      setCtxMenu({ x: e.clientX, y: e.clientY });
    },
    [editMode, selectedIds, setCtxMenu],
  );

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

  return {
    // 상태
    bridgeMode,
    setBridgeMode,
    pendingBridge,
    setPendingBridge,
    selectedSupportId,
    setSelectedSupportId,
    selectedCp,
    setSelectedCp,
    autoBusy,
    // 핸들러
    handleAutoGenerate,
    handleAddSupportAt,
    handleRemoveSupport,
    handleMoveSupport,
    handleMoveBridgeControlPoint,
    handleMoveBridgeEndpoint,
    handleAddBridgeControlPoint,
    handleRemoveBridgeControlPoint,
    handleDeleteSelectedSupport,
    handleDuplicateSelected,
    handleResetBridgeCurve,
    handleClearAllSupports,
    // 뷰포트 우클릭(컨텍스트 메뉴) pointer 핸들러
    handleViewportPointerDown,
    handleViewportPointerUp,
  };
}
