// 씬 부트스트랩 effect 의 cleanup 본문 순수 이동.
//   ★ dispose 순서는 원본과 한 줄도 다르면 안 된다: isUnmounting 플래그 → resize
//   해제 → gizmo 3종 → utilityLayer → support mesh → material → slice/bridge → STL
//   mesh → dental clear → furniture → highlight → scene.dispose() → engine.dispose()
//   (engine 이 맨 마지막). React 는 언마운트 시 이 cleanup 을 브러쉬 cleanup 보다
//   먼저 실행하므로 isUnmountingRef 를 여기서 true 로 세팅한다.
import type { Engine, HighlightLayer, Scene } from "@babylonjs/core";
import type { SceneCtx } from "../scene-refs";

export function disposeScene(
  ctx: SceneCtx,
  args: {
    engine: Engine;
    scene: Scene;
    hl: HighlightLayer;
    onResize: () => void;
  },
): void {
  const { engine, scene, hl, onResize } = args;
  // 언마운트 표시 — 이 cleanup 은 deps [] 이라 언마운트에서만 실행된다.
  //   React 는 언마운트 시 effect cleanup 을 선언 순서대로 실행하므로, 이
  //   씬-셋업 effect(먼저 선언)의 cleanup 이 브러쉬 effect(나중 선언) cleanup
  //   보다 먼저 돌아 이 플래그가 true 로 세팅된다. 브러쉬 cleanup 은 이 값을
  //   보고 pending 무효화를 "즉시 실행" 대신 "타이머만 정리"로 처리한다
  //   (언마운트 중 부모 setState 방지 — 뒤이어 전체 dispose 가 온다).
  ctx.isUnmountingRef.current = true;
  window.removeEventListener("resize", onResize);
  ctx.positionGizmoRef.current?.dispose();
  ctx.rotationGizmoRef.current?.dispose();
  ctx.scaleGizmoRef.current?.dispose();
  ctx.positionGizmoRef.current = null;
  ctx.rotationGizmoRef.current = null;
  ctx.scaleGizmoRef.current = null;
  ctx.utilityLayerRef.current?.dispose();
  ctx.utilityLayerRef.current = null;
  for (const sm of ctx.supportMeshMapRef.current.values()) {
    sm.dispose();
  }
  ctx.supportMeshMapRef.current.clear();
  ctx.supportMaterialRef.current?.dispose();
  ctx.supportMaterialRef.current = null;
  ctx.sliceOutlineRef.current?.dispose();
  ctx.sliceOutlineRef.current = null;
  for (const fm of ctx.sliceFillMeshesRef.current) fm.dispose();
  ctx.sliceFillMeshesRef.current = [];
  ctx.bridgeMarkerRef.current?.dispose();
  ctx.bridgeMarkerRef.current = null;
  ctx.bridgeMarkerMatRef.current?.dispose();
  ctx.bridgeMarkerMatRef.current = null;
  ctx.sliceModelMatRef.current?.dispose();
  ctx.sliceSupportMatRef.current?.dispose();
  ctx.sliceModelMatRef.current = null;
  ctx.sliceSupportMatRef.current = null;
  for (const mesh of ctx.meshMapRef.current.values()) {
    mesh.dispose();
  }
  ctx.meshMapRef.current.clear();
  // dental-brush painted 오버레이/점 정리 (scene.dispose 로도 mesh 는
  // 사라지지만 ref 는 명시적으로 비운다).
  ctx.paintOverlaysRef.current = [];
  ctx.paintPointsRef.current = [];
  // 마진 시각화/floodfill ref 도 명시적으로 비운다 (scene.dispose 후 stale
  //   mesh 참조 방지).
  ctx.marginMarkersRef.current = [];
  ctx.autoFillOverlayRef.current = [];
  ctx.marginRef.current = null;
  ctx.autoFillFacesRef.current = new Set();
  // 아일랜드 시각화/결과 ref 도 명시적으로 비운다 (감사 B8 — 위 마진 ref 와
  //   동일 이유. scene.dispose 로 mesh 는 사라지나 ref 는 stale 로 남는다).
  ctx.islandMarkersRef.current = [];
  ctx.islandResultRef.current = null;
  ctx.furnitureRef.current?.dispose();
  ctx.furnitureRef.current = null;
  hl.dispose();
  ctx.highlightRef.current = null;
  scene.dispose();
  engine.dispose();
  ctx.engineRef.current = null;
  ctx.sceneRef.current = null;
  ctx.cameraRef.current = null;
}
