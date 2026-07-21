// gizmo 3종(Position/Rotation/Scale) 생성 + onDragStart/onDragEnd 배선.
//   원본 씬 부트스트랩 effect 의 gizmo 구획을 순수 이동. effect 안에서 동기 호출되는
//   일반 함수라 effect 실행 순서에 영향 없음. ctx 는 동일 ref 를 공유한다.
//   ⚠️ onDragStart/onDragEnd 는 STL-drag 와 gizmo-drag 가 공유하는 gizmoDragStartRef
//   union 을 그대로 쓰고, setParent(mesh) ↔ setParent(null) 짝을 유지한다.
import {
  PositionGizmo,
  RotationGizmo,
  ScaleGizmo,
  UtilityLayerRenderer,
} from "@babylonjs/core";
import { readMeshTransform } from "../../../utils/transform";
import type { SceneCtx } from "../scene-refs";

export function setupGizmos(ctx: SceneCtx, utility: UtilityLayerRenderer): void {
  const positionGizmo = new PositionGizmo(utility);
  const rotationGizmo = new RotationGizmo(utility);
  const scaleGizmo = new ScaleGizmo(utility);

  // 모델이 작을 때 (10mm 단위) 화살표가 묻혀 보이는 걸 막기 위해
  // scaleRatio 를 키운다.
  const SCALE = 1.8;
  positionGizmo.scaleRatio = SCALE;
  rotationGizmo.scaleRatio = SCALE;
  scaleGizmo.scaleRatio = SCALE;

  const onDragStart = () => {
    const attached = positionGizmo.attachedMesh;
    if (attached) {
      const meta = (
        attached as {
          metadata?: {
            type?: string;
            supportId?: string;
            cpIdx?: number;
            which?: "base" | "contact";
          };
        }
      ).metadata;
      // Bridge 변곡점 sphere 드래그.
      if (
        meta?.type === "bridge-cp" &&
        meta.supportId &&
        typeof meta.cpIdx === "number"
      ) {
        ctx.gizmoDragStartRef.current = {
          kind: "bridge-cp",
          id: meta.supportId,
          cpIdx: meta.cpIdx,
        };
        return;
      }
      // Bridge 끝점 sphere 드래그.
      if (meta?.type === "bridge-ep" && meta.supportId && meta.which) {
        ctx.gizmoDragStartRef.current = {
          kind: "bridge-ep",
          id: meta.supportId,
          which: meta.which,
        };
        return;
      }
      // 단점 서포트 기둥 이동.
      if (meta?.type === "support" && meta.supportId) {
        ctx.gizmoDragStartRef.current = {
          kind: "support",
          id: meta.supportId,
        };
        return;
      }
    }
    // STL transform (기존).
    const sel = Array.from(ctx.selectedRef.current);
    if (sel.length !== 1) return;
    const id = sel[0];
    const mesh = ctx.meshMapRef.current.get(id);
    if (!mesh) return;
    ctx.gizmoDragStartRef.current = {
      kind: "stl",
      id,
      t: readMeshTransform(mesh),
    };
    // STL drag 중 race 차단: 영향 받는 supports mesh 들을 STL
    // mesh 의 child 로 임시 설정. drag 진행하는 동안 Babylon 이
    // world transform 자동 동기 → mesh 가 STL 따라 즉시 움직임.
    // setParent 는 world 위치 유지하면서 local 좌표 자동 계산.
    const supports = ctx.supportsRef.current;
    for (const [supId, supMesh] of ctx.supportMeshMapRef.current) {
      const sup = supports.find((s) => s.id === supId);
      if (
        sup &&
        (sup.stlId === id || sup.baseStlId === id)
      ) {
        supMesh.setParent(mesh);
      }
    }
  };
  const onDragEnd = () => {
    const started = ctx.gizmoDragStartRef.current;
    ctx.gizmoDragStartRef.current = null;
    if (!started) return;
    if (started.kind === "bridge-cp") {
      const sphere = ctx.selectedBridgeSphereRef.current;
      if (!sphere) return;
      ctx.onMoveBridgeCpRef.current(started.id, started.cpIdx, [
        sphere.position.x,
        sphere.position.y,
        sphere.position.z,
      ]);
      return;
    }
    if (started.kind === "bridge-ep") {
      const sphere = ctx.selectedBridgeSphereRef.current;
      if (!sphere) return;
      const meta = (
        sphere as {
          metadata?: { normal?: [number, number, number] };
        }
      ).metadata;
      const stored = undoLift(
        {
          x: sphere.position.x,
          y: sphere.position.y,
          z: sphere.position.z,
        },
        meta?.normal,
      );
      ctx.onMoveBridgeEndpointRef.current(started.id, started.which, stored);
      return;
    }
    if (started.kind === "support") {
      const sMesh = ctx.supportMeshMapRef.current.get(started.id);
      if (!sMesh) return;
      ctx.onMoveSupportRef.current(started.id, [
        sMesh.position.x,
        sMesh.position.z,
      ]);
      return;
    }
    const mesh = ctx.meshMapRef.current.get(started.id);
    if (!mesh) return;
    // STL drag 종료 — supports mesh 의 parent 해제. setParent(null)
    // 은 world transform 유지하면서 parent 만 푸는 안전한 호출.
    for (const supMesh of ctx.supportMeshMapRef.current.values()) {
      if (supMesh.parent === mesh) {
        supMesh.setParent(null);
      }
    }
    const end = readMeshTransform(mesh);
    // 무효화(감사 B1)는 페이지 측 handleCommitTransform 수렴점에서 처리.
    ctx.onGizmoCommitRef.current(started.id, started.t, end);
  };
  [positionGizmo, rotationGizmo, scaleGizmo].forEach((giz) => {
    giz.onDragStartObservable.add(onDragStart);
    giz.onDragEndObservable.add(onDragEnd);
  });

  ctx.utilityLayerRef.current = utility;
  ctx.positionGizmoRef.current = positionGizmo;
  ctx.rotationGizmoRef.current = rotationGizmo;
  ctx.scaleGizmoRef.current = scaleGizmo;
}
