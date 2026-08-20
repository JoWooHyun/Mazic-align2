// 선택 하이라이트 · STL 드래그 · gizmo attach · 활성 STL 조회 — ctx 기반 액션.
//   원본 BabylonScene 본문의 내부 함수(refreshHighlight/attachDragBehavior/
//   syncGizmo/getActiveStl)를 순수 이동. ref 접근을 ctx 인자로 바꾼 것 외 로직 무변경.
import { Color3, Mesh, PointerDragBehavior, Quaternion, Vector3 } from "@babylonjs/core";
import { meshWorldBBoxCenter, readMeshTransform } from "../../utils/transform";
import type { SceneCtx } from "./scene-refs";

export const HIGHLIGHT_COLOR = new Color3(1.0, 0.78, 0.18); // 따뜻한 노랑

/**
 * 피벗 프록시 자세 (B-12).
 *   · "identity" — world 축 정렬. 이동(B-17)·회전 기즈모용.
 *   · "mesh"     — 모델 회전을 복사(로컬 축). 스케일 기즈모용.
 */
export type PivotProxyOrientation = "identity" | "mesh";

/**
 * 피벗 프록시를 mesh 의 **현재 world bbox 중심**에 놓는다 (B-9).
 *
 * 이동/회전/스케일 기즈모가 모두 이 프록시에 attach 되므로, 핸들이 항상 실루엣
 * 중심에 보이고 드래그가 그 점을 기준으로 동작한다.
 *
 * 자세(orientation)는 기즈모 종류에 따라 다르다 (B-12 재작업):
 *
 * · **이동 = "identity"**. 화살표가 world 축에 고정돼야 한다 — 회전과 같은 이유이고
 *   `updateGizmoRotationToMatchAttachedMesh = false` 와 짝이다 (B-12·B-17).
 *   프록시가 unit scale·identity 자세라 자식 mesh 가 받는 것은 **순수 world 병진**
 *   뿐이고, 그래서 커밋되는 tx/ty/tz 가 드래그 이동량과 정확히 일치한다.
 *
 * · **회전 = "identity"**. 링이 world 축에 고정돼야 한다(CHITUBOX 실물 대조).
 *   사실 `RotationGizmo` 는 `updateGizmoRotationToMatchAttachedMesh = false` 만으로
 *   이미 world 축 링을 그린다 — `Gizmo._update` 가 flag=false 면 attach 노드 자세와
 *   무관하게 rootMesh 회전을 identity 로 세우기 때문. 그래서 프록시 identity 는
 *   회전 기즈모에 **무해한 중복**이다. (초기 B-12 주석의 "프록시가 기울면 링도
 *   기운다" 는 틀린 서술이었다.)
 *
 * · **스케일 = "mesh"**. `AxisScaleGizmo` 는 attach 노드의 **로컬 축**에 스케일을
 *   건다. 프록시가 identity 면 world 축 스케일이 되는데, 회전된 자식 메쉬에는
 *   그것이 **전단(shear)** 이다 — SRT 로 표현할 수 없어 `setParent(null)` 의
 *   decompose 에서 형상이 깨진다(Y 45° 회전 + world X 1.5배에서 10mm 정점당
 *   2.712mm 오차 실측). 프록시를 모델 회전에 맞추면 로컬 축 스케일 = 기존 동작이
 *   되어 오차가 0 이다. 핸들이 모델을 따라 기우는 것은 기하학적으로 올바르다.
 *   (`ScaleGizmo` 는 애초에 flag=false 를 거부하는 no-op setter 라 끌 수도 없다.)
 *
 * 피벗 규약(B-9)은 자세와 무관하다 — 제자리 회전/스케일을 만드는 것은 프록시의
 * **위치**(bbox 중심)이고, 자식은 setParent 로 world 를 보존한 채 매달린다.
 * 스케일은 항상 1 에서 시작해 드래그 배율이 그대로 읽힌다.
 *
 * 드래그 시작 시점과 선택 동기화(syncGizmo) 양쪽에서 호출한다 — 드래그 전에도
 * 링이 중심에 보여야 하기 때문.
 */
export function placePivotProxy(
  ctx: SceneCtx,
  mesh: Mesh,
  orientation: PivotProxyOrientation = "identity",
): void {
  const proxy = ctx.pivotProxyRef.current;
  if (!proxy) return;
  proxy.position.copyFrom(meshWorldBBoxCenter(mesh));
  const q =
    orientation === "mesh"
      ? mesh.rotationQuaternion ?? Quaternion.FromEulerVector(mesh.rotation)
      : Quaternion.Identity();
  if (!proxy.rotationQuaternion) proxy.rotationQuaternion = q.clone();
  else proxy.rotationQuaternion.copyFrom(q);
  proxy.scaling.set(1, 1, 1);
  proxy.computeWorldMatrix(true);
}

export function refreshHighlight(ctx: SceneCtx): void {
  const hl = ctx.highlightRef.current;
  if (!hl) return;
  hl.removeAllMeshes();
  for (const id of ctx.selectedRef.current) {
    const mesh = ctx.meshMapRef.current.get(id);
    if (mesh) hl.addMesh(mesh, HIGHLIGHT_COLOR);
  }
  const sSel = ctx.selectedSupportRef.current;
  if (sSel) {
    const sMesh = ctx.supportMeshMapRef.current.get(sSel);
    if (sMesh) hl.addMesh(sMesh, HIGHLIGHT_COLOR);
  }
}

/**
 * 모델 위 좌클릭+드래그로 XZ 평면 이동.
 * Y 는 모델의 현재 높이에서 고정 (수직 이동은 Gizmo/슬라이더로).
 */
export function attachDragBehavior(
  ctx: SceneCtx,
  mesh: Mesh,
  fileId: string,
): void {
  const drag = new PointerDragBehavior({
    dragPlaneNormal: new Vector3(0, 1, 0),
  });
  drag.useObjectOrientationForDragging = false;
  drag.moveAttached = true;
  // 좌클릭(0) 에서만 모델 XZ 이동을 시작한다. 기본값 [0,1,2] 는 모든 버튼에
  // 반응해, 모델 위에서 우드래그(팬)·휠드래그(회전) 를 이 behavior 가 먼저
  // 가로채 카메라 조작이 막혔다. dragButtons=[0] 이면 우/휠 드래그는
  // behavior 를 트리거하지 않고 카메라 pointer input 으로 그대로 전달된다.
  // (button 규약: MouseEvent.button — 0=Left, 1=Middle, 2=Right)
  drag.dragButtons = [0];

  drag.onDragStartObservable.add(() => {
    ctx.gizmoDragStartRef.current = {
      kind: "stl",
      id: fileId,
      t: readMeshTransform(mesh),
    };
  });
  drag.onDragEndObservable.add(() => {
    const started = ctx.gizmoDragStartRef.current;
    ctx.gizmoDragStartRef.current = null;
    if (!started || started.kind !== "stl") return;
    const end = readMeshTransform(mesh);
    // 마진·아일랜드 무효화(감사 B1)는 onGizmoCommit === handleCommitTransform
    // 으로 수렴하는 페이지 측에서 처리한다 (gizmo/드래그/수치입력/바닥면정렬 +
    // undo/redo 를 한 경로로 통일 — 씬 내부 이중 배선 방지).
    ctx.onGizmoCommitRef.current(started.id, started.t, end);
  });

  // 'support' 모드면 attach 보류 (mode effect 가 attach).
  if (ctx.editModeRef.current === "select") {
    mesh.addBehavior(drag);
  }
  ctx.dragBehaviorMapRef.current.set(fileId, drag);
}

export function syncGizmo(ctx: SceneCtx): void {
  const pg = ctx.positionGizmoRef.current;
  const rg = ctx.rotationGizmoRef.current;
  const sg = ctx.scaleGizmoRef.current;
  if (!pg || !rg || !sg) return;

  // 'support' 모드:
  //   · Bridge 변곡점/끝점 sphere 선택됨 → PositionGizmo 가 그 sphere
  //     X/Y/Z 축으로 깊이 방향 정확 드래그 가능.
  //   · 그 외 + 단점 서포트 기둥 선택 → 기둥에 attach.
  // ⚠️ attachedNode(피벗 프록시, B-9/B-17)도 함께 풀어야 한다. Babylon 에서
  //   attachedMesh=null 은 attachedNode 를 지우지 않아, select+rotate 에서
  //   다른 모드로 전환하면 링이 프록시에 붙은 채 남는다.
  const detachRotScale = () => {
    rg.attachedMesh = null;
    sg.attachedMesh = null;
    rg.attachedNode = null;
    sg.attachedNode = null;
  };
  // 이동 기즈모도 프록시를 타므로(B-17) 같은 정리가 필요하다. 서포트/브릿지
  //   경로는 sphere·기둥 mesh 에 직접 attach 하므로 attachedMesh 대입만으로는
  //   이전 프록시 attach 가 남을 수 있다.
  const detachMove = () => {
    pg.attachedMesh = null;
    pg.attachedNode = null;
  };

  if (ctx.editModeRef.current === "support") {
    const handleMesh = ctx.selectedBridgeSphereRef.current;
    if (handleMesh) {
      // 프록시 attach 를 먼저 끊고 sphere 에 직접 붙인다 (B-17).
      detachMove();
      pg.attachedMesh = handleMesh;
      detachRotScale();
      return;
    }
    const sid = ctx.selectedSupportRef.current;
    const sMesh = sid
      ? ctx.supportMeshMapRef.current.get(sid) ?? null
      : null;
    detachMove();
    pg.attachedMesh = sMesh;
    detachRotScale();
    return;
  }

  // 'dental-brush' 등 non-select 모드: Gizmo 전부 detach. select 진입
  //   유지된 선택으로 translate Gizmo 가 붙은 채 남아 브러쉬 색칠과
  //   모델 이동이 동시에 일어나던 문제 차단. effect 5 가 editMode 변경
  //   마다 syncGizmo 를 재호출하므로 select 복귀 시 자동 재attach.
  if (ctx.editModeRef.current !== "select") {
    detachMove();
    detachRotScale();
    return;
  }

  // 'select' 모드: 단일 STL 선택 + 사용자 gizmoMode 에 따라.
  const sel = Array.from(ctx.selectedRef.current);
  const single = sel.length === 1 ? sel[0] : null;
  const mesh = single ? ctx.meshMapRef.current.get(single) ?? null : null;
  const mode = ctx.gizmoModeRef.current;

  // 이동/회전/스케일 **모두** 피벗 프록시에 attach 해 bbox 중심을 기준점으로
  //   삼는다 (B-9 → 이동 확대가 B-17).
  //
  //   이동을 프록시로 옮긴 이유: mesh 직접 attach 는 Babylon 기본 anchorPoint
  //   (= Origin) 규칙 때문에 화살표가 **mesh 원점**에 붙는데, stl-loader 의
  //   alignMeshToPlate 가 원점을 "XZ 중심 / Y 바닥" 에 베이크해 원점 ≠ bbox 중심
  //   이다. 회전 피벗은 bbox 중심(B-9)이라, 모델을 돌리면 원점이 중심 둘레를
  //   **공전**해 화살표가 돌아다녔다(리드 보고). anchorPoint 는 Origin/Pivot 두
  //   값뿐이라 bbox 중심을 지정할 수 없어, 회전/스케일과 같은 프록시로 통일한다.
  //
  //   attachedMesh/attachedNode 는 같은 슬롯을 공유하므로, 프록시를 쓰지 않는
  //   경우 둘 다 null 로 정리해 이전 attach 가 남지 않게 한다.
  const proxy = ctx.pivotProxyRef.current;
  const usePivot = mesh !== null && proxy !== null;
  detachMove();
  detachRotScale();
  if (usePivot) {
    // 자세는 기즈모별로 다르다 (B-12) — 이동/회전은 world 축 identity,
    //   스케일은 모델 로컬 축(전단 방지). placePivotProxy 주석 참고.
    if (mode === "translate") {
      placePivotProxy(ctx, mesh, "identity");
      pg.attachedNode = proxy;
    } else if (mode === "rotate") {
      placePivotProxy(ctx, mesh, "identity");
      rg.attachedNode = proxy;
    } else if (mode === "scale") {
      placePivotProxy(ctx, mesh, "mesh");
      sg.attachedNode = proxy;
    }
  }
}

/**
 * 활성 STL(선택된 것, 없으면 첫 STL) 의 id + mesh 를 반환. 마진/floodfill
 * 이 브러쉬 색칠과 같은 STL 을 대상으로 하도록 원본 findMarginSignal /
 * getActiveMesh 의 STL 선택 규칙을 그대로 따른다.
 */
export function getActiveStl(
  ctx: SceneCtx,
): { id: string; mesh: Mesh } | null {
  const ids = Array.from(ctx.selectedRef.current);
  let id: string | undefined = ids[0];
  if (!id) id = [...ctx.meshMapRef.current.keys()][0];
  if (!id) return null;
  const mesh = ctx.meshMapRef.current.get(id);
  return mesh ? { id, mesh } : null;
}
