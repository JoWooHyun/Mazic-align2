// 씬 더블탭 + 클릭 픽업 옵저버 등록. 원본 씬 부트스트랩 effect 의 두 pointer
//   옵저버 구획을 순수 이동. 이 옵저버들은 명시 remove 가 없고 scene.dispose() 에
//   의존하므로 bootstrap effect 안에 그대로 둔다 (다른 훅으로 옮기지 않음).
//   effect 안에서 동기 호출되는 일반 함수라 실행 순서에 영향 없음.
import { PointerEventTypes, Ray, Scene, Vector3, Mesh } from "@babylonjs/core";
import { findClosestT } from "../../../utils/bridge-path";
import { computeAlignFloorTransform } from "../../../utils/transform";
import type { SceneCtx } from "../scene-refs";
import { syncGizmo } from "../scene-actions";

export function setupPointerHandlers(ctx: SceneCtx, scene: Scene): void {
  // 더블 클릭:
  //   · STL mesh (select 모드)         → 회전 모드 활성화 신호
  //   · Bridge tube (support 모드)     → 그 위치에 변곡점 추가
  scene.onPointerObservable.add((info) => {
    if (info.type !== PointerEventTypes.POINTERDOUBLETAP) return;
    const evt = info.event as PointerEvent;
    if (evt.button !== 0) return;
    const picked = info.pickInfo?.pickedMesh;
    if (!picked) return;

    // Bridge tube?
    const meta = (
      picked as {
        metadata?: { type?: string; supportId?: string };
      }
    ).metadata;
    if (
      ctx.editModeRef.current === "support" &&
      meta?.type === "support" &&
      meta.supportId &&
      info.pickInfo?.pickedPoint
    ) {
      const p = info.pickInfo.pickedPoint;
      ctx.onDoublePickBridgeTubeRef.current?.(meta.supportId, [p.x, p.y, p.z]);
      return;
    }

    // STL mesh?
    if (ctx.editModeRef.current !== "select") return;
    for (const [id, mesh] of ctx.meshMapRef.current) {
      if (mesh === picked) {
        ctx.onDoublePickStlRef.current?.(id);
        return;
      }
    }
  });

  // 클릭 픽업: 좌클릭으로 단순 클릭 (드래그 없는) 시 mesh 픽.
  // 메쉬 위면 선택, 빈 공간이면 선택 해제.
  scene.onPointerObservable.add((info) => {
    if (info.type !== PointerEventTypes.POINTERPICK) return;
    const evt = info.event as PointerEvent;
    if (evt.button !== 0) return; // 좌클릭만

    let picked = info.pickInfo?.pickedMesh;

    // support 모드 — Bridge sphere (A/B/변곡점) 가 STL 안에 묻혀
    // ray 가 STL 을 먼저 잡는 경우 우선 픽. 같은 ray 위에 sphere 가
    // 있으면 그것 채택. 없으면 STL 그대로.
    if (
      ctx.editModeRef.current === "support" &&
      ctx.bridgeCpMeshesRef.current.length > 0 &&
      picked &&
      !ctx.bridgeCpMeshesRef.current.includes(picked as Mesh)
    ) {
      const spherePick = scene.pick(
        scene.pointerX,
        scene.pointerY,
        (m) => ctx.bridgeCpMeshesRef.current.includes(m as Mesh),
      );
      if (spherePick?.pickedMesh) {
        picked = spherePick.pickedMesh;
      }
    }

    // 'support' 모드:
    //   · Bridge sub-mode 면 기둥 픽도 endpoint 로 → onAddSupportAt.
    //   · 그 외 기둥 픽 → 선택. 모델 표면 픽 → 추가.
    //   · 빈 공간 픽 → 선택 해제 (bridge 모드는 무시, Esc 로 취소).
    if (ctx.editModeRef.current === "support") {
      const bridge = ctx.bridgeModeRef.current;

      if (!picked) {
        ctx.selectedBridgeSphereRef.current = null;
        syncGizmo(ctx);
        if (!bridge) ctx.onPickSupportRef.current(null);
        return;
      }
      const meta = (
        picked as {
          metadata?: {
            type?: string;
            supportId?: string;
            stlId?: string;
            cpIdx?: number;
          };
        }
      ).metadata;

      // 변곡점 sphere 단일 클릭 → 선택 + PositionGizmo 부착.
      if (
        meta?.type === "bridge-cp" &&
        meta.supportId &&
        typeof meta.cpIdx === "number"
      ) {
        ctx.selectedBridgeSphereRef.current = picked as Mesh;
        syncGizmo(ctx);
        ctx.onSelectBridgeControlPointRef.current?.(
          meta.supportId,
          meta.cpIdx,
        );
        return;
      }
      // 끝점 sphere 단일 클릭 → PositionGizmo 부착.
      if (
        meta?.type === "bridge-ep" &&
        meta.supportId &&
        (meta as { which?: string }).which
      ) {
        ctx.selectedBridgeSphereRef.current = picked as Mesh;
        syncGizmo(ctx);
        return;
      }

      if (meta?.type === "support" && meta.supportId) {
        // 변곡점/끝점 sphere 부착됐던 PositionGizmo 해제.
        ctx.selectedBridgeSphereRef.current = null;
        // Bridge 모드 → 기둥 위 hit point 를 새 endpoint 로.
        // 기둥 표면 안쪽으로 normal × PEN 만큼 push → Bridge↔Bridge
        // 연결 시 void 제거. PEN 은 기둥 반지름의 70% 이하 (양면
        // 통과 방지). 굵기는 안 바뀌고 길이만 살짝 연장.
        if (bridge && info.pickInfo?.pickedPoint && meta.stlId) {
          const p = info.pickInfo.pickedPoint;
          const n = info.pickInfo.getNormal(true, true);
          const radius = ctx.bridgeDiamRef.current * 0.5;
          // PEN = 반지름의 120% → cap 평면이 부모 axis 를 넘어가서
          // cap 가장자리 (반지름 = child radius) 가 부모 cylinder
          // cross-section 안에 완전히 박힌다. 굵기 균일 유지,
          // 외형 벗어남 0. (양면 통과는 PEN < 2×radius 라 안전.)
          const PEN = radius * 1.2;
          const cx = n ? p.x - n.x * PEN : p.x;
          const cy = n ? p.y - n.y * PEN : p.y;
          const cz = n ? p.z - n.z * PEN : p.z;
          const nArr: [number, number, number] | undefined = n
            ? [n.x, n.y, n.z]
            : undefined;
          // attachedTo: 부모 Bridge path 위의 t 비율. 부모가
          // 수정되면 child 가 따라 이동.
          const parent = ctx.supportsRef.current.find(
            (s) => s.id === meta.supportId,
          );
          let attachedTo:
            | { supportId: string; t: number }
            | undefined;
          if (parent && parent.source === "bridge") {
            const t = findClosestT(
              parent.base,
              parent.curveControlPoints,
              parent.contact,
              [p.x, p.y, p.z],
            );
            attachedTo = { supportId: meta.supportId, t };
          }
          ctx.onAddSupportRef.current(
            meta.stlId,
            [cx, cy, cz],
            nArr,
            attachedTo,
          );
          return;
        }
        // 그 외 → 선택.
        ctx.onPickSupportRef.current(meta.supportId);
        return;
      }
      for (const [id, mesh] of ctx.meshMapRef.current) {
        if (mesh === picked && info.pickInfo?.pickedPoint) {
          const p = info.pickInfo.pickedPoint;
          // 표면 안쪽으로 push → 서포트 끝 cap 이 표면 밖으로
          // 튀어나오지 않게. Bridge 는 굵기가 커서 더 깊이.
          const n = info.pickInfo.getNormal(true, true);
          const radius = bridge ? ctx.bridgeDiamRef.current * 0.5 : 0;
          // Bridge: 사용자 알고리즘대로 0.1mm 만 박음. manifold subtract
          // 가 cap 의 STL 안 + winding-flip 으로 외부 노출 부분도 cut.
          // 단점: 두께 검사 적용 (반대편 침범 방지).
          void radius;
          let PEN = bridge ? 0.1 : 0.3;
          if (!bridge && n) {
            const startOffset = 0.05;
            const origin = new Vector3(
              p.x - n.x * startOffset,
              p.y - n.y * startOffset,
              p.z - n.z * startOffset,
            );
            const dir = new Vector3(-n.x, -n.y, -n.z);
            const ray = new Ray(origin, dir, 100);
            const farPick = scene.pickWithRay(ray, (m) => m === mesh);
            if (farPick?.hit && farPick.distance != null) {
              const thickness = farPick.distance + startOffset;
              const maxPen = Math.max(0.05, thickness - 0.2);
              PEN = Math.min(PEN, maxPen);
            }
          }
          const cx = n ? p.x - n.x * PEN : p.x;
          const cy = n ? p.y - n.y * PEN : p.y;
          const cz = n ? p.z - n.z * PEN : p.z;
          const nArr: [number, number, number] | undefined = n
            ? [n.x, n.y, n.z]
            : undefined;
          ctx.onAddSupportRef.current(id, [cx, cy, cz], nArr);
          if (!bridge) ctx.onPickSupportRef.current(null);
          return;
        }
      }
      return;
    }

    // 'dental-brush' 모드: 표면 클릭은 브러쉬 색칠(6.5 effect 의 별도
    // 포인터 옵저버)이 담당한다. 여기서 선택/해제하면 브러쉬 도중 모델
    // 선택이 바뀌므로 아무 것도 하지 않고 종료.
    if (ctx.editModeRef.current === "dental-brush") return;

    // 'select' 모드 (기본): 모델 선택 / 빈 공간 = 해제.
    // 단 alignFloorMode 활성 시 STL face 클릭 → 바닥면 정렬.
    const multi = evt.ctrlKey || evt.metaKey;
    if (!picked) {
      ctx.onPickRef.current(null, { multi });
      return;
    }
    if (ctx.alignFloorModeRef.current && info.pickInfo) {
      const n = info.pickInfo.getNormal(true, true);
      for (const [id, mesh] of ctx.meshMapRef.current) {
        if (mesh === picked && n) {
          const newT = computeAlignFloorTransform(mesh, n);
          ctx.onAlignFaceToFloorRef.current?.(id, newT);
          return;
        }
      }
    }
    for (const [id, mesh] of ctx.meshMapRef.current) {
      if (mesh === picked) {
        ctx.onPickRef.current(id, { multi });
        return;
      }
    }
    // furniture (plate/grid/axes) 픽은 isPickable=false 라 안 옴.
  });
}
