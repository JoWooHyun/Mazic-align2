// STL transform 프리뷰/커밋과 그에 따른 부착 서포트 추종(followAttachedChildren).
// (ViewerV2Page 에서 추출 — 좌표 전파·undo·검출 무효화 동작 불변.)

import { useCallback } from "react";

import { useUndoStore } from "../../../hooks/useUndoStore";
import type { SupportPointV2 } from "../../../support/types";
import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import { type TransformV2 } from "../../../types/transform";
import { transformPointBetween } from "../../../utils/transform";
import {
  getBridgePathPoint,
  isStraightCps,
  straightCps,
} from "../../../utils/bridge-path";
import { proportionalMoveCps } from "../utils/support-transform";
import type { PatchSupport, UpdateTransform } from "./types";

type Vec3 = [number, number, number];
type Cps3 = [Vec3, Vec3, Vec3];

interface UseTransformCommitArgs {
  supports: SupportPointV2[];
  supportsRef: React.MutableRefObject<SupportPointV2[]>;
  sceneHandleRef: React.RefObject<BabylonSceneHandle>;
  updateTransform: UpdateTransform;
  patchSupport: PatchSupport;
}

interface UseTransformCommitResult {
  handlePreviewTransform: (id: string, t: TransformV2) => void;
  handleCommitTransform: (
    id: string,
    start: TransformV2,
    end: TransformV2,
  ) => void;
  /** 부모 Bridge 수정 후 부착된 child 를 새 path 위 t 위치로 추종시킨다. */
  followAttachedChildren: (
    parentId: string,
    parentBase: Vec3,
    parentCps: Cps3 | undefined,
    parentContact: Vec3,
  ) => Promise<void>;
}

export function useTransformCommit({
  supports,
  supportsRef,
  sceneHandleRef,
  updateTransform,
  patchSupport,
}: UseTransformCommitArgs): UseTransformCommitResult {
  const handlePreviewTransform = useCallback(
    (id: string, t: TransformV2) => {
      sceneHandleRef.current?.previewTransform(id, t);
    },
    [sceneHandleRef],
  );

  // 부모 Bridge 가 수정된 직후 그 위에 부착된 child Bridge 들의
  // contact/base 를 새 path 의 t 위치 좌표로 다시 계산해서 따라가게.
  const followAttachedChildren = useCallback(
    async (
      parentId: string,
      parentBase: Vec3,
      parentCps: Cps3 | undefined,
      parentContact: Vec3,
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
            updates.curveControlPoints = proportionalMoveCps(
              child.curveControlPoints,
              child.base,
              newBase,
              child.contact,
              newContact,
            );
          }
        }

        if (Object.keys(updates).length > 0) {
          await patchSupport(child.id, updates);
        }
      }
    },
    [supportsRef, patchSupport],
  );

  const handleCommitTransform = useCallback(
    (id: string, start: TransformV2, end: TransformV2) => {
      // STL 이 변형됐으므로 world 좌표 기반 마진·아일랜드 검출 결과를 무효화한다
      //   (감사 B1). gizmo/드래그/수치입력(TransformPanel)/바닥면정렬이 모두 이
      //   handleCommitTransform 으로 수렴하므로 무효화를 여기 한 곳에 배선한다.
      sceneHandleRef.current?.invalidateDentalResults(id);
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
          // undo 도 STL 을 다시 이동시키므로 검출 결과 무효화 (감사 B1).
          sceneHandleRef.current?.invalidateDentalResults(id);
          await updateTransform(id, start);
          await Promise.all(
            oldStates.map(({ id: sid, patch }) => patchSupport(sid, patch)),
          );
        },
        redo: async () => {
          // redo 도 마찬가지로 무효화 (감사 B1).
          sceneHandleRef.current?.invalidateDentalResults(id);
          await updateTransform(id, end);
          await Promise.all(
            newPatches.map(({ id: sid, patch }) => patchSupport(sid, patch)),
          );
        },
      });
    },
    // supports 는 본문에서 supportsRef.current 를 쓰지만(stale 방지), 원본과
    //   동일한 콜백 재생성 주기를 유지하기 위해 dep 로 그대로 둔다.
    [
      sceneHandleRef,
      updateTransform,
      supports,
      patchSupport,
      followAttachedChildren,
    ],
  );

  return { handlePreviewTransform, handleCommitTransform, followAttachedChildren };
}
