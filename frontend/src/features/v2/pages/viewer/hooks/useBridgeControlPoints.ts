// Bridge 변곡점(control point) 편집 핸들러 묶음 — 이동/끝점이동/추가/삭제/직선복원.
// (useSupportEditing 에서 분리 — 파일 크기 축소, 동작·undo 불변.)

import { useCallback } from "react";

import { useUndoStore } from "../../../hooks/useUndoStore";
import type { SupportPointV2 } from "../../../support/types";
import {
  findClosestT,
  insertControlPoint,
  removeControlPoint,
  straightCps,
} from "../../../utils/bridge-path";
import { proportionalMoveCps } from "../utils/support-transform";
import type { PatchSupport } from "./types";

type Vec3 = [number, number, number];
type Cps3 = [Vec3, Vec3, Vec3];

interface UseBridgeControlPointsArgs {
  supports: SupportPointV2[];
  selectedSupportId: string | null;
  patchSupport: PatchSupport;
  followAttachedChildren: (
    parentId: string,
    parentBase: Vec3,
    parentCps: Cps3 | undefined,
    parentContact: Vec3,
  ) => Promise<void>;
  setSelectedCp: React.Dispatch<
    React.SetStateAction<{ supportId: string; idx: number } | null>
  >;
}

export function useBridgeControlPoints({
  supports,
  selectedSupportId,
  patchSupport,
  followAttachedChildren,
  setSelectedCp,
}: UseBridgeControlPointsArgs) {
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
        newCps = proportionalMoveCps(
          oldCps,
          oldBase,
          newBase,
          oldContact,
          newContact,
        ) as typeof oldCps;

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
    [supports, patchSupport, followAttachedChildren, setSelectedCp],
  );

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

  return {
    handleMoveBridgeControlPoint,
    handleMoveBridgeEndpoint,
    handleAddBridgeControlPoint,
    handleRemoveBridgeControlPoint,
    handleResetBridgeCurve,
  };
}
