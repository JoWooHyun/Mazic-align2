// 선택 하이라이트 · STL 드래그 · gizmo attach · 활성 STL 조회 — ctx 기반 액션.
//   원본 BabylonScene 본문의 내부 함수(refreshHighlight/attachDragBehavior/
//   syncGizmo/getActiveStl)를 순수 이동. ref 접근을 ctx 인자로 바꾼 것 외 로직 무변경.
import { Color3, Mesh, PointerDragBehavior, Vector3 } from "@babylonjs/core";
import { readMeshTransform } from "../../utils/transform";
import type { SceneCtx } from "./scene-refs";

export const HIGHLIGHT_COLOR = new Color3(1.0, 0.78, 0.18); // 따뜻한 노랑

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
  if (ctx.editModeRef.current === "support") {
    const handleMesh = ctx.selectedBridgeSphereRef.current;
    if (handleMesh) {
      pg.attachedMesh = handleMesh;
      rg.attachedMesh = null;
      sg.attachedMesh = null;
      return;
    }
    const sid = ctx.selectedSupportRef.current;
    const sMesh = sid
      ? ctx.supportMeshMapRef.current.get(sid) ?? null
      : null;
    pg.attachedMesh = sMesh;
    rg.attachedMesh = null;
    sg.attachedMesh = null;
    return;
  }

  // 'dental-brush' 등 non-select 모드: Gizmo 전부 detach. select 진입
  //   유지된 선택으로 translate Gizmo 가 붙은 채 남아 브러쉬 색칠과
  //   모델 이동이 동시에 일어나던 문제 차단. effect 5 가 editMode 변경
  //   마다 syncGizmo 를 재호출하므로 select 복귀 시 자동 재attach.
  if (ctx.editModeRef.current !== "select") {
    pg.attachedMesh = null;
    rg.attachedMesh = null;
    sg.attachedMesh = null;
    return;
  }

  // 'select' 모드: 단일 STL 선택 + 사용자 gizmoMode 에 따라.
  const sel = Array.from(ctx.selectedRef.current);
  const single = sel.length === 1 ? sel[0] : null;
  const mesh = single ? ctx.meshMapRef.current.get(single) ?? null : null;
  const mode = ctx.gizmoModeRef.current;

  pg.attachedMesh = mode === "translate" ? mesh : null;
  rg.attachedMesh = mode === "rotate" ? mesh : null;
  sg.attachedMesh = mode === "scale" ? mesh : null;
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
