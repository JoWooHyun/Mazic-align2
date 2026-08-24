// gizmo 3종(Position/Rotation/Scale) 생성 + onDragStart/onDragEnd 배선.
//   원본 씬 부트스트랩 effect 의 gizmo 구획을 순수 이동. effect 안에서 동기 호출되는
//   일반 함수라 effect 실행 순서에 영향 없음. ctx 는 동일 ref 를 공유한다.
//   ⚠️ onDragStart/onDragEnd 는 STL-drag 와 gizmo-drag 가 공유하는 gizmoDragStartRef
//   union 을 그대로 쓰고, setParent(mesh) ↔ setParent(null) 짝을 유지한다.
import {
  Color3,
  PositionGizmo,
  Quaternion,
  RotationGizmo,
  ScaleGizmo,
  TransformNode,
  UtilityLayerRenderer,
} from "@babylonjs/core";
import type { StandardMaterial } from "@babylonjs/core";
import { readMeshTransform } from "../../../utils/transform";
import { placePivotProxy } from "../scene-actions";
// R-1: 종전에는 import 없이 스코프 밖 `undoLift` 를 참조해 Bridge 끝점 gizmo
//   드래그 커밋에서 런타임 ReferenceError 가 날 수 있었다. 공용 유틸로 해소.
import { undoLift } from "../../../utils/bridge-lift";
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

  // ★ B-23 — 기즈모 축 색을 **표시 규약(Z-up)** 에 맞춘다.
  //   리드: "수치나 Z축은 맞는데 저 화살표 색이 안바뀌었네? 노란색이 Y축인데
  //          사실은 Z축이잖아. 색깔만 바꾸면 될것같아."
  //   Babylon 기본색은 **내부 축** 기준(X 빨강 / Y 초록 / Z 파랑)인데, 우리
  //   내부는 Y-up 이라 **위로 뻗는 화살표가 초록**으로 나왔다. 씬 축 라인
  //   (`scene-setup.ts`)·범례·Transform 패널은 이미 Z-up 이라 기즈모만 어긋났다.
  //   → 씬 축 라인과 **똑같은 배정**으로 맞춘다:
  //       내부 X(옆)   → 표시 X → 빨강
  //       내부 Y(위)   → 표시 Z → **파랑**
  //       내부 Z(안쪽) → 표시 Y → 초록
  //   ⚠️ 색만 바꾼다. 드래그 축·방향·저장값은 일절 건드리지 않는다(리드 지시
  //   "색깔만 바꾸면 될것같아") — 내부 축 의미가 바뀌면 출력물·서포트가 흔들린다.
  applyDisplayAxisColors(positionGizmo);
  applyDisplayAxisColors(rotationGizmo);
  applyDisplayAxisColors(scaleGizmo);

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
    //
    // ⚠️ B-15b: **stl-local 서포트는 부모화하지 않는다.** 그 점들은 이미 정본
    //   parent 가 stlMesh 라(useSupportMeshSync) 부모화가 불필요한데, Babylon
    //   `setParent` 는 **이미 같은 부모여도 early-return 없이** 로컬 SRT 를
    //   decompose 로 재계산한다. 재설계 서포트는 정점에 좌표가 베이크돼 로컬 SRT
    //   가 항등이어야 정상이므로, 비-항등 SRT 가 끼면 world 형상이 두 번 변환된다.
    //   해제 루프(onDragEnd)에는 이 필터가 이미 있었는데(B-11) 시작 쪽만 빠져
    //   비대칭이었다 → 여기서 맞춘다. 임시 부모화 대상은 world 서포트뿐이다.
    const supports = ctx.supportsRef.current;
    for (const [supId, supMesh] of ctx.supportMeshMapRef.current) {
      const sup = supports.find((s) => s.id === supId);
      if (sup?.coordSpace === "stl-local") continue; // 정본 parent 유지.
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

/**
 * 기즈모 축 3개의 색을 **표시 규약(Z-up)** 에 맞춰 다시 칠한다 (B-23).
 *
 * 내부 Y(위) 축 기즈모를 파랑으로, 내부 Z(안쪽) 축 기즈모를 초록으로 바꾼다.
 * 색상값은 `utils/scene-setup.ts` 의 축 라인과 동일하게 맞춰, 화면의 축 라인과
 * 기즈모 화살표가 같은 축이면 같은 색이 되게 한다.
 *
 * `coloredMaterial`(평상시)·`hoverMaterial`(마우스 올림) 둘 다 칠한다 —
 * 하나만 바꾸면 호버할 때 옛 색이 튀어나온다. `disableMaterial` 은 회색
 * "비활성" 표시라 의미가 축과 무관하므로 건드리지 않는다.
 *
 * ⚠️ 색만 바꾼다. 드래그 축·방향·커밋되는 tx/ty/tz 의미는 그대로다.
 */
function applyDisplayAxisColors(gizmo: {
  xGizmo: { coloredMaterial: StandardMaterial; hoverMaterial: StandardMaterial };
  yGizmo: { coloredMaterial: StandardMaterial; hoverMaterial: StandardMaterial };
  zGizmo: { coloredMaterial: StandardMaterial; hoverMaterial: StandardMaterial };
}): void {
  // scene-setup.ts 의 AXIS_RED / AXIS_GREEN / AXIS_BLUE 와 같은 값.
  const RED = new Color3(1, 0.3, 0.3);
  const GREEN = new Color3(0.3, 0.9, 0.4);
  const BLUE = new Color3(0.35, 0.55, 1);
  // 호버 색은 원색을 밝게 — Babylon 기본도 같은 방식이다.
  const lighten = (c: Color3) =>
    new Color3(
      Math.min(1, c.r + 0.3),
      Math.min(1, c.g + 0.3),
      Math.min(1, c.b + 0.3),
    );

  const paint = (
    axis: { coloredMaterial: StandardMaterial; hoverMaterial: StandardMaterial },
    color: Color3,
  ) => {
    axis.coloredMaterial.diffuseColor = color;
    axis.coloredMaterial.emissiveColor = color;
    const hov = lighten(color);
    axis.hoverMaterial.diffuseColor = hov;
    axis.hoverMaterial.emissiveColor = hov;
  };

  paint(gizmo.xGizmo, RED); // 내부 X = 표시 X
  paint(gizmo.yGizmo, BLUE); // 내부 Y(위) = 표시 Z
  paint(gizmo.zGizmo, GREEN); // 내부 Z(안쪽) = 표시 Y
}
