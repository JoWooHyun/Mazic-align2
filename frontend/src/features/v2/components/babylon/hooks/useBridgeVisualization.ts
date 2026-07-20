// Bridge 시각화 훅 — 원본 effect #5.6(pending marker) + #5.7(A/B 끝점·변곡점 sphere).
//   두 effect 는 원본에서 연속 선언(deps [pendingBridgePoint] → [editMode,...])이므로
//   이 훅에서도 그 순서로 등록한다. undoLift(#5.7 로컬)는 그대로 유지 — 로직 무변경.
import { useEffect } from "react";
import {
  Mesh,
  MeshBuilder,
  PointerDragBehavior,
  StandardMaterial,
} from "@babylonjs/core";
import type { SupportParams, SupportPointV2 } from "../../../support/types";
import type { EditMode } from "../../EditModeControls";
import type { STLFileV2 } from "../../../types/stl";
import type { SceneCtx } from "../scene-refs";

export function useBridgeVisualization(
  ctx: SceneCtx,
  pendingBridgePoint: [number, number, number] | null,
  editMode: EditMode,
  bridgeMode: boolean,
  selectedSupportId: string | null,
  supports: SupportPointV2[],
  supportParams: SupportParams,
  files: STLFileV2[],
): void {
  // 5.6) Bridge pending point marker (작은 주황 sphere).
  useEffect(() => {
    const scene = ctx.sceneRef.current;
    const mat = ctx.bridgeMarkerMatRef.current;
    if (!scene || !mat) return;

    ctx.bridgeMarkerRef.current?.dispose();
    ctx.bridgeMarkerRef.current = null;
    if (!pendingBridgePoint) return;

    const m = MeshBuilder.CreateSphere(
      "v2_bridge_marker",
      { diameter: 1.4, segments: 10 },
      scene,
    );
    m.position.set(
      pendingBridgePoint[0],
      pendingBridgePoint[1],
      pendingBridgePoint[2],
    );
    m.material = mat;
    m.isPickable = false;
    m.renderingGroupId = 1;
    ctx.bridgeMarkerRef.current = m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBridgePoint]);

  // 5.7) Bridge 시각화:
  //   · Bridge 모드 활성 → 모든 Bridge 의 A (주황) / B (청록) 끝점을
  //     작은 sphere 로 표시 (시각화만, 드래그 X).
  //   · 선택된 Bridge → 큰 sphere 로 A/B 표시 + 변곡점 3 개 (노랑),
  //     PointerDragBehavior 로 드래그 가능.
  useEffect(() => {
    const scene = ctx.sceneRef.current;
    const cpMat = ctx.bridgeCpMatRef.current;
    const aMat = ctx.bridgeMarkerMatRef.current; // A = 주황 (기존 marker mat)
    // B 도 주황 — 사용자 요청. (bridgeBMatRef 는 보존, 추후 구분 필요 시 사용.)
    const bMat = ctx.bridgeMarkerMatRef.current;
    if (!scene || !cpMat || !aMat || !bMat) return;

    // 매번 dispose & 재생성. drag 도중에는 supports 가 안 바뀌므로
    // 끊김 없이 동작.
    for (const m of ctx.bridgeCpMeshesRef.current) {
      m.dispose();
    }
    ctx.bridgeCpMeshesRef.current = [];

    if (editMode !== "support") return;

    const bridges = supports.filter((s) => s.source === "bridge");
    const dBig = Math.max(supportParams.bridgeDiameterMm * 1.5, 1.2);
    const dSmall = Math.max(supportParams.bridgeDiameterMm * 1.0, 0.8);

    // 저장된 contact/base 는 표면 안쪽 push 된 상태. sphere 는
    // 그 반대로 normal × LIFT 만큼 밖으로 끌어내서 사용자가 표면
    // 위에서 보고 클릭/드래그할 수 있게 한다. (메시 cap 은 안쪽
    // 박힌 그대로 유지 → void 없는 부착.)
    const LIFT = 0.8;
    const liftOut = (
      pos: [number, number, number],
      n: [number, number, number] | undefined,
    ): [number, number, number] => {
      if (!n) return pos;
      return [pos[0] + n[0] * LIFT, pos[1] + n[1] * LIFT, pos[2] + n[2] * LIFT];
    };
    // stl-local 좌표 모드의 support 면 sphere 를 STL mesh 의 child 로
     // 묶어 STL 회전/이동 시 자동 follow. sphere.position 은 이미 local
     // 좌표가 박혀있으므로 그대로 둔다 (parent 만 바꿈, 위치 보존 X).
    const attachToStl = (sphere: Mesh, sup: SupportPointV2): void => {
      if (sup.coordSpace !== "stl-local") return;
      const stlMesh = ctx.meshMapRef.current.get(sup.stlId);
      if (stlMesh) sphere.parent = stlMesh;
    };
    const undoLift = (
      pos: { x: number; y: number; z: number },
      n: [number, number, number] | undefined,
    ): [number, number, number] => {
      if (!n) return [pos.x, pos.y, pos.z];
      return [pos.x - n[0] * LIFT, pos.y - n[1] * LIFT, pos.z - n[2] * LIFT];
    };

    // (1) Bridge 모드 → 안 선택된 Bridge 들의 A / B 시각화.
    if (bridgeMode) {
      for (const sup of bridges) {
        if (sup.id === selectedSupportId) continue; // 선택된 건 (2) 에서.
        const aPos = liftOut(sup.base, sup.baseNormal);
        const aSphere = MeshBuilder.CreateSphere(
          `v2_bridge_a_viz_${sup.id}`,
          { diameter: dSmall, segments: 10 },
          scene,
        );
        aSphere.position.set(aPos[0], aPos[1], aPos[2]);
        aSphere.material = aMat;
        aSphere.isPickable = false;
        aSphere.renderingGroupId = 1;
        attachToStl(aSphere, sup);
        ctx.bridgeCpMeshesRef.current.push(aSphere);

        const bPos = liftOut(sup.contact, sup.contactNormal);
        const bSphere = MeshBuilder.CreateSphere(
          `v2_bridge_b_viz_${sup.id}`,
          { diameter: dSmall, segments: 10 },
          scene,
        );
        bSphere.position.set(bPos[0], bPos[1], bPos[2]);
        bSphere.material = bMat;
        bSphere.isPickable = false;
        bSphere.renderingGroupId = 1;
        attachToStl(bSphere, sup);
        ctx.bridgeCpMeshesRef.current.push(bSphere);
      }
    }

    // (2) 선택된 Bridge → A/B 큰 sphere (드래그) + 변곡점 (노랑).
    if (!selectedSupportId) return;
    const sup = bridges.find((s) => s.id === selectedSupportId);
    if (!sup) return;

    const endpoints: {
      which: "base" | "contact";
      pos: [number, number, number];
      normal: [number, number, number] | undefined;
      mat: StandardMaterial;
    }[] = [
      { which: "base", pos: sup.base, normal: sup.baseNormal, mat: aMat },
      {
        which: "contact",
        pos: sup.contact,
        normal: sup.contactNormal,
        mat: bMat,
      },
    ];
    for (const ep of endpoints) {
      const visPos = liftOut(ep.pos, ep.normal);
      const sphere = MeshBuilder.CreateSphere(
        `v2_bridge_ep_${sup.id}_${ep.which}`,
        { diameter: dBig, segments: 10 },
        scene,
      );
      sphere.position.set(visPos[0], visPos[1], visPos[2]);
      sphere.material = ep.mat;
      sphere.isPickable = true;
      sphere.renderingGroupId = 1;
      sphere.metadata = {
        type: "bridge-ep",
        supportId: sup.id,
        which: ep.which,
        normal: ep.normal,
      };
      attachToStl(sphere, sup);
      // PointerDragBehavior 도 유지 — sphere 직접 끌면 카메라 평면
      // 자유 드래그. PositionGizmo 의 X/Y/Z 축 화살표는 정확한 깊이
      // 드래그. 둘 다 동시 가능.
      const drag = new PointerDragBehavior();
      // 우/휠 드래그는 카메라 조작으로 통과 (P5: 모델 메쉬와 동일 처리)
      drag.dragButtons = [0];
      drag.useObjectOrientationForDragging = false;
      sphere.addBehavior(drag);
      const which = ep.which;
      const epNormal = ep.normal;
      drag.onDragEndObservable.add(() => {
        const stored = undoLift(
          { x: sphere.position.x, y: sphere.position.y, z: sphere.position.z },
          epNormal,
        );
        ctx.onMoveBridgeEndpointRef.current(sup.id, which, stored);
      });
      ctx.bridgeCpMeshesRef.current.push(sphere);
    }

    if (sup.curveControlPoints) {
      for (let i = 0; i < sup.curveControlPoints.length; i++) {
        const cp = sup.curveControlPoints[i];
        const sphere = MeshBuilder.CreateSphere(
          `v2_bridge_cp_${sup.id}_${i}`,
          { diameter: dBig, segments: 10 },
          scene,
        );
        sphere.position.set(cp[0], cp[1], cp[2]);
        sphere.material = cpMat;
        sphere.isPickable = true;
        sphere.renderingGroupId = 1;
        sphere.metadata = {
          type: "bridge-cp",
          supportId: sup.id,
          cpIdx: i,
        };
        attachToStl(sphere, sup);
        // PointerDragBehavior 유지 — 자유 드래그. PositionGizmo 도
        // syncGizmo 에서 attach 되어 X/Y/Z 축 정확 드래그 가능.
        const drag = new PointerDragBehavior();
        // 우/휠 드래그는 카메라 조작으로 통과 (P5: 모델 메쉬와 동일 처리)
        drag.dragButtons = [0];
        drag.useObjectOrientationForDragging = false;
        sphere.addBehavior(drag);
        const idx = i;
        drag.onDragEndObservable.add(() => {
          ctx.onMoveBridgeCpRef.current(sup.id, idx, [
            sphere.position.x,
            sphere.position.y,
            sphere.position.z,
          ]);
        });
        ctx.bridgeCpMeshesRef.current.push(sphere);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editMode,
    bridgeMode,
    selectedSupportId,
    supports,
    files,
    supportParams.bridgeDiameterMm,
  ]);
}
