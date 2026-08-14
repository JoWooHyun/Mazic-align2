// gizmo 3종(Position/Rotation/Scale) 생성 + onDragStart/onDragEnd 배선.
//   원본 씬 부트스트랩 effect 의 gizmo 구획을 순수 이동. effect 안에서 동기 호출되는
//   일반 함수라 effect 실행 순서에 영향 없음. ctx 는 동일 ref 를 공유한다.
//   ⚠️ onDragStart/onDragEnd 는 STL-drag 와 gizmo-drag 가 공유하는 gizmoDragStartRef
//   union 을 그대로 쓰고, setParent(mesh) ↔ setParent(null) 짝을 유지한다.
import {
  PositionGizmo,
  Quaternion,
  RotationGizmo,
  ScaleGizmo,
  TransformNode,
  UtilityLayerRenderer,
} from "@babylonjs/core";
import { readMeshTransform } from "../../../utils/transform";
import { placePivotProxy } from "../scene-actions";
import type { SceneCtx } from "../scene-refs";

export function setupGizmos(ctx: SceneCtx, utility: UtilityLayerRenderer): void {
  const positionGizmo = new PositionGizmo(utility);
  const rotationGizmo = new RotationGizmo(utility);
  const scaleGizmo = new ScaleGizmo(utility);

  // 회전/스케일 피벗 프록시 (B-9). 기즈모는 utility layer 에 그대로 두고,
  //   프록시만 **메인 씬**에 만든다 — mesh 를 자식으로 붙여야 하기 때문.
  //   렌더링 대상이 없는 TransformNode 라 화면에는 보이지 않는다.
  //   ⚠️ 씬은 utility.originalScene 에서 얻는다. useSceneBootstrap 이
  //   ctx.sceneRef.current 를 setupGizmos **호출 뒤에** 대입하므로 여기서
  //   ctx.sceneRef 를 읽으면 아직 null 이다.
  ctx.pivotProxyRef.current = new TransformNode(
    "v2_pivotProxy",
    utility.originalScene,
  );

  // 모델이 작을 때 (10mm 단위) 화살표가 묻혀 보이는 걸 막기 위해
  // scaleRatio 를 키운다.
  const SCALE = 1.8;
  positionGizmo.scaleRatio = SCALE;
  rotationGizmo.scaleRatio = SCALE;
  scaleGizmo.scaleRatio = SCALE;

  // 이동/회전 기즈모 축을 **world 에 고정** 한다 (B-12).
  //   Babylon 기본값은 true(local 모드)라 화살표/링이 attach 된 노드의 회전을
  //   매 프레임 따라간다. 그러면 모델을 95° 돌린 뒤 링도 95° 기울어, 어느 링이
  //   어느 축인지 사용자가 알 수 없다. CHITUBOX 는 회전 후에도 링 방향이
  //   그대로다(리드 실물 대조). 구 v1 도 명시적으로 껐던 설정인데
  //   (utils/babylon.utils.ts:378·384) v2 이관에서 누락된 회귀다.
  //   이 플래그 하나로 충분하다 — Gizmo._update 는 flag=false 면 attach 노드
  //   자세와 무관하게 rootMesh 회전을 identity 로 세운다. 즉 피벗 프록시가
  //   기울어 있어도 링은 world 축에 그려진다.
  //   ⚠️ ScaleGizmo 에는 걸지 않는다 — Babylon 이 false 를 **거부하는 no-op
  //   setter** 라(scaleGizmo.js: Logger.Warn "not supported") 콘솔 경고만 남고
  //   아무 효과가 없다. 스케일 축은 프록시 자세로만 정해진다(scene-actions.ts).
  positionGizmo.updateGizmoRotationToMatchAttachedMesh = false;
  rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;

  const onDragStart = () => {
    // 서포트/브릿지 경로는 sphere·기둥 mesh 에 **직접** attach 된 경우만이다.
    //   STL 이동은 B-17 이후 프록시(attachedNode)를 타므로 attachedMesh 가
    //   null 이고, 아래 metadata 분기를 자연히 건너뛴다.
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
    // 이동/회전/스케일 드래그면 mesh 를 피벗 프록시의 자식으로 임시 부모화한다
    //   (B-9 → 이동 확대가 B-17).
    //   프록시를 현재 bbox 중심에 놓고 mesh 를 매달면, 기즈모가 프록시를 움직일 때
    //   mesh 가 따라온다 — 회전이면 그 중심을 축으로 제자리 회전, 이동이면 순수
    //   병진. setParent 는 world 를 유지하며 로컬 좌표를 재계산하므로 시각적
    //   점프가 없다(서포트 임시 부모화와 같은 패턴).
    //   ⚠️ 이동도 이 조건에 포함돼야 프록시 드래그가 mesh 에 전달된다 — 빠뜨리면
    //   화살표만 움직이고 모델은 제자리에 남는다.
    const proxy = ctx.pivotProxyRef.current;
    const isMove = proxy !== null && positionGizmo.attachedNode === proxy;
    const isRotate = proxy !== null && rotationGizmo.attachedNode === proxy;
    const isScale = proxy !== null && scaleGizmo.attachedNode === proxy;
    if (proxy && (isMove || isRotate || isScale)) {
      // 자세는 기즈모별로 다르다 (B-12) — 스케일은 모델 로컬 축을 써야
      //   전단(shear)이 생기지 않는다. 이동/회전은 world 축 identity.
      //   placePivotProxy 주석 참고.
      placePivotProxy(ctx, mesh, isScale ? "mesh" : "identity");
      mesh.setParent(proxy);
    }
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
    //
    // ⚠️ B-11: **stl-local 서포트는 풀지 않는다.** 그 점들은 정본 parent 가
    //   stlMesh 라서(useSupportMeshSync 가 그렇게 세운다) 여기서 함께 풀면
    //   다음 sync effect 재실행 전까지 모델 이동에 따라오지 못한다. 드래그
    //   시작 때 임시로 부모화한 것은 world 서포트뿐이므로 그것만 되돌린다.
    const supportsNow = ctx.supportsRef.current;
    for (const [supId, supMesh] of ctx.supportMeshMapRef.current) {
      if (supMesh.parent !== mesh) continue;
      const sup = supportsNow.find((s) => s.id === supId);
      if (sup?.coordSpace === "stl-local") continue; // 정본 parent 유지.
      supMesh.setParent(null);
    }
    // 피벗 프록시 부모화 해제 (B-9). readMeshTransform 은 mesh 의 **로컬** SRT 를
    //   읽으므로, 프록시 자식인 상태로 읽으면 프록시 회전이 빠진 값이 나온다.
    //   setParent(null) 이 world 를 유지한 채 로컬 SRT 를 재계산해 주므로,
    //   그 뒤에 읽어야 피벗 회전이 반영된 최종 transform 이 나온다.
    const proxy = ctx.pivotProxyRef.current;
    if (proxy && mesh.parent === proxy) {
      mesh.setParent(null);
      // 다음 드래그를 위해 프록시 자세 초기화 (위치·자세는 다음 placePivotProxy
      //   호출이 기즈모 종류에 맞게 다시 세운다). 드래그로 기울거나 늘어난
      //   프록시가 그 사이에 남지 않도록 여기서 되돌려 둔다.
      //   ⚠️ 이동 드래그(B-17)는 프록시 **위치**도 옮겨 놓는다. 여기서 되돌리지
      //   않아도 다음 placePivotProxy 가 bbox 중심으로 덮어쓰지만, 남은 상태가
      //   다음 attach 까지의 한 프레임에 비치지 않도록 자세와 함께 정리한다.
      proxy.rotationQuaternion?.copyFrom(Quaternion.Identity());
      proxy.scaling.set(1, 1, 1);
      // 방금 커밋된 mesh 의 새 bbox 중심으로 프록시를 다시 세운다. 이동 후에도
      //   화살표가 곧바로 중심에 남아 있어야 하기 때문(리드 요구의 본질).
      placePivotProxy(ctx, mesh, "identity");
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
