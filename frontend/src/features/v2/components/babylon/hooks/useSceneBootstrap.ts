// 씬 부트스트랩 훅 — 원본 effect #1(씬/카메라/조명/gizmo/pointer/renderLoop/resize/
//   dispose) + effect #1.5(plate 재생성)를 담는다. 두 effect 는 원본에서 연속 선언돼
//   있으므로 이 훅 안에서도 #1 → #1.5 순으로 등록해 선언 순서를 보존한다.
//   ⚠️ 이 훅은 본체에서 가장 먼저 호출돼야 한다 (unmount cleanup 선언 순서 = 실행 순서
//   불변식 — dispose-scene 이 브러쉬 cleanup 보다 먼저 돌아 isUnmountingRef 를 세팅).
import { useEffect } from "react";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  HighlightLayer,
  Scene,
  StandardMaterial,
  UtilityLayerRenderer,
  Vector3,
} from "@babylonjs/core";
import { createSupportMaterial } from "../../../utils/support-render";
import { ensureManifoldReady } from "../../../utils/manifold-csg";
import { createSliceFillMaterial } from "../../../utils/slice-render";
import { addBuildPlateAndGrid } from "../../../utils/scene-setup";
import { applyZoomLimits, resetCameraOnPlate } from "../../../utils/camera-views";
import type { SceneCtx } from "../scene-refs";
import { setupGizmos } from "./setup-gizmos";
import { setupPointerHandlers } from "./setup-pointer-handlers";
import { disposeScene } from "./dispose-scene";

export function useSceneBootstrap(
  ctx: SceneCtx,
  plateWidthMm: number,
  plateDepthMm: number,
): void {
  // 1) 씬 부트스트랩
  useEffect(() => {
    const canvas = ctx.canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    const scene = new Scene(engine);
    // ChiTuBox 풍 어두운 회색 배경. 모델의 청록색이 더 또렷.
    scene.clearColor = new Color4(0.36, 0.37, 0.4, 1);
    // ambient 줄여 그림자/대비 강화 (옛: 0.45 → 0.22).
    scene.ambientColor = new Color3(0.22, 0.23, 0.26);

    // Bridge handle (A/B/변곡점 sphere) 용 별도 렌더링 그룹.
    // 그룹 1 그릴 때 depth buffer 를 새로 클리어 → 모델 안에 박혀
    // 있어도 항상 위에 보인다.
    scene.setRenderingAutoClearDepthStencil(1, true, true, false);

    const camera = new ArcRotateCamera(
      "cam",
      -Math.PI / 4,
      Math.PI / 3,
      300,
      Vector3.Zero(),
      scene,
    );
    camera.attachControl(canvas, true);
    // wheelPrecision 은 휠 입력에 대한 "나눗셈" 계수 → 값이 작을수록
    // 한 노치당 줌이 커진다. 5.0 = Babylon 기본 (30) 대비 6 배.
    camera.wheelPrecision = 5.0;
    camera.minZ = 0.1;
    camera.panningSensibility = 50;
    camera.inertia = 0.7;
    // ★ 커서 기준 줌 (C-1) — 휠을 굴리면 **마우스가 가리키는 지점**이 화면에
    //   그대로 머문다. 끄면(Babylon 기본 false) 카메라 target 방향으로만
    //   radius 가 변해, 화면 가장자리의 관심 지점이 줌인할수록 밖으로 밀려난다.
    //
    //   ⚠️ 신규 기능이 아니라 **v1 회귀 복구**다. 구 v1 `utils/babylon.utils.ts`
    //   가 이미 `zoomToMouseLocation = true` 를 켜 두었는데 v2 이관 때 누락됐다.
    //
    //   근거: `docs/판정_CHITUBOX분석_20260821.md` C-1
    //   (분석 문서 `docs/view94.md` 7.3/7.4 가 "Viewer 사용성이 매우 좋으므로
    //    적극 채용 권장"으로 지목한 항목 — Acceptance Test "확대 후 그 점이
    //    화면에서 크게 벗어나지 않음").
    //
    //   B-19(줌 확대 한계 걸림)의 유력한 원인이기도 하다: 중앙 기준 줌은 모델
    //   가장자리를 당길 때 관심 지점에 닿기 전에 lowerRadiusLimit 에 먼저 걸린다.
    camera.zoomToMouseLocation = true;
    // 줌 한계 사실상 해제 (B-19, 리드 요청 "확대·축소 둘 다 무제한이었으면").
    //   프레이밍(resetCameraOnPlate/frameCameraToMeshes)도 같은 함수를 부르므로
    //   모델을 새로 불러와도 한계가 다시 좁아지지 않는다.
    applyZoomLimits(camera);

    // ChiTuBox 풍: 위는 강하게, 옆/아래는 약하게 → 윗면 밝고 옆면
    // 어두운 명확한 그림자 대비. 라이트 4 개 다 hemispheric 으로
    // 부드러운 wrap-around 유지하면서 상대 intensity 만 조정.
    const lightTop = new HemisphericLight(
      "lightTop",
      new Vector3(0.2, 1, 0.3),
      scene,
    );
    lightTop.intensity = 1.05; // 위 빛 강화 (0.7 → 1.05)
    lightTop.diffuse = new Color3(1, 1, 1);
    lightTop.specular = new Color3(0.05, 0.05, 0.05);

    const lightBottom = new HemisphericLight(
      "lightBottom",
      new Vector3(0, -1, 0),
      scene,
    );
    lightBottom.intensity = 0.06; // 아래 거의 끔 (0.2 → 0.06)

    // 측면 보강 — cylinder 등 둥근 모델 옆면이 새카매지지 않게.
    const lightSideA = new HemisphericLight(
      "lightSideA",
      new Vector3(-1, 0.3, 0.4),
      scene,
    );
    lightSideA.intensity = 0.18; // 0.4 → 0.18
    lightSideA.specular = new Color3(0.03, 0.03, 0.03);

    const lightSideB = new HemisphericLight(
      "lightSideB",
      new Vector3(1, 0.3, -0.4),
      scene,
    );
    lightSideB.intensity = 0.18; // 0.4 → 0.18
    lightSideB.specular = new Color3(0.03, 0.03, 0.03);

    // 빌드플레이트 / 그리드는 별도 plate effect 에서 생성·재생성한다.

    ctx.supportMaterialRef.current = createSupportMaterial(scene);
    // manifold-3d wasm async load. ready 후 manifoldModuleRef.current set.
    // STL 이 이미 로드되어 있으면 별도 effect 에서 stlManifoldMap 생성.
    void ensureManifoldReady().then((mod) => {
      ctx.manifoldModuleRef.current = mod;
    });
    const bridgeMat = new StandardMaterial("v2_bridge_marker_mat", scene);
    bridgeMat.diffuseColor = new Color3(1.0, 0.55, 0.15);
    bridgeMat.emissiveColor = new Color3(0.6, 0.3, 0.1);
    bridgeMat.specularColor = new Color3(0, 0, 0);
    ctx.bridgeMarkerMatRef.current = bridgeMat;

    // Bridge 변곡점 핸들 (노란 sphere) 용 material.
    const cpMat = new StandardMaterial("v2_bridge_cp_mat", scene);
    cpMat.diffuseColor = new Color3(1.0, 0.85, 0.1);
    cpMat.emissiveColor = new Color3(0.5, 0.42, 0.05);
    cpMat.specularColor = new Color3(0, 0, 0);
    ctx.bridgeCpMatRef.current = cpMat;

    // Bridge B 끝점 (청록) — A 는 기존 주황 marker mat 재사용.
    const bMat = new StandardMaterial("v2_bridge_b_mat", scene);
    bMat.diffuseColor = new Color3(0.2, 0.7, 0.85);
    bMat.emissiveColor = new Color3(0.1, 0.4, 0.5);
    bMat.specularColor = new Color3(0, 0, 0);
    ctx.bridgeBMatRef.current = bMat;

    ctx.sliceModelMatRef.current = createSliceFillMaterial(
      scene,
      new Color3(0.85, 0.86, 0.9),
      "v2_slice_model_mat",
    );
    ctx.sliceSupportMatRef.current = createSliceFillMaterial(
      scene,
      new Color3(0.55, 0.7, 0.95),
      "v2_slice_support_mat",
    );

    const hl = new HighlightLayer("v2_highlight", scene, {
      blurHorizontalSize: 0.6,
      blurVerticalSize: 0.6,
    });
    hl.innerGlow = false;
    hl.outerGlow = true;
    ctx.highlightRef.current = hl;

    // Gizmo: UtilityLayer 위에 세 종류를 한 번씩만 만들고 영속화한다.
    // 모드 전환은 attachedMesh = null/target 로만 처리 → 인스턴스
    // 재생성·콜백 재바인딩 비용이 없다.
    //
    // ⚠️ autoClearDepthAndStencil 은 기본값(true) 유지. false 로
    // 두면 메인 scene 의 depth buffer 가 그대로 남아 gizmo 가
    // 모델 뒤로 가려진다.
    const utility = new UtilityLayerRenderer(scene);
    setupGizmos(ctx, utility);

    setupPointerHandlers(ctx, scene);

    ctx.engineRef.current = engine;
    ctx.sceneRef.current = scene;
    ctx.cameraRef.current = camera;

    // 초기 카메라 위치는 plate effect 에서 잡는다.

    engine.runRenderLoop(() => scene.render());

    const onResize = () => engine.resize();
    window.addEventListener("resize", onResize);

    return () => disposeScene(ctx, { engine, scene, hl, onResize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1.5) plate 크기 변경 시 furniture 재생성 + 카메라 reset.
  useEffect(() => {
    const scene = ctx.sceneRef.current;
    const camera = ctx.cameraRef.current;
    if (!scene || !camera) return;

    ctx.furnitureRef.current?.dispose();
    ctx.furnitureRef.current = addBuildPlateAndGrid(scene, {
      widthMm: plateWidthMm,
      depthMm: plateDepthMm,
    });

    // 모델이 없을 때만 plate 기준으로 camera reset (모델이 있으면
    // 사용자 시점 유지).
    if (ctx.meshMapRef.current.size === 0) {
      resetCameraOnPlate(camera, plateWidthMm, plateDepthMm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateWidthMm, plateDepthMm]);
}
