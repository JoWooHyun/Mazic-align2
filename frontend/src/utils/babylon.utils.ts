import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Color3,
  Color4,
  Mesh,
  UtilityLayerRenderer,
  GizmoManager,
} from '@babylonjs/core';
import '@babylonjs/loaders/STL';

/**
 * Babylon.js 엔진 초기화
 */
export const createEngine = (canvas: HTMLCanvasElement): Engine => {
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
  });

  // 화면 크기 변경 시 엔진 리사이즈
  window.addEventListener('resize', () => {
    engine.resize();
  });

  return engine;
};

/**
 * 3D 씬 생성 및 기본 설정
 */
export const createScene = (engine: Engine): Scene => {
  const scene = new Scene(engine);

  // 배경색 설정 (어두운 회색)
  scene.clearColor = new Color4(0.15, 0.15, 0.15, 1);

  return scene;
};

/**
 * 카메라 설정
 */
export const createCamera = (scene: Scene, canvas: HTMLCanvasElement): ArcRotateCamera => {
  const camera = new ArcRotateCamera(
    'camera',
    Math.PI / 2, // alpha (회전 각도)
    Math.PI / 3, // beta (상하 각도)
    300, // radius (거리) — 200mm 빌드플레이트가 한눈에 보이도록
    Vector3.Zero(), // target
    scene
  );

  // 카메라 제어 설정
  // attachControl(element, noPreventDefault, useCtrlForPanning)
  // useCtrlForPanning = false (Ctrl 키 없이 패닝)
  camera.attachControl(canvas, true, false);

  // 카메라 키보드 입력 — ↑/↓ 는 LayerSlider 전용. 카메라는 키보드 회전 안 함.
  //   inputs.attached.keyboard 가 ArrowUp/Down/Left/Right 를 카메라 alpha/beta 변경에
  //   기본 적용 → LayerSlider 와 동시 발화로 뷰까지 같이 움직임. keyboard 입력 자체 제거.
  if (camera.inputs.attached.keyboard) {
    camera.inputs.remove(camera.inputs.attached.keyboard);
  }

  // 줌 속도: 기본 2배(wheelPrecision 0.5), Ctrl+휠은 4배(0.25)
  // wheelPrecision 은 낮을수록 한 틱당 크게 이동
  const ZOOM_NORMAL = 0.5;
  const ZOOM_CTRL = 0.25;
  camera.wheelPrecision = ZOOM_NORMAL;

  // Ctrl 키 여부에 따라 휠 줌 속도 전환 (capture 단계 → Babylon 휠 입력보다 먼저 실행)
  const wheelHandler = (e: WheelEvent) => {
    camera.wheelPrecision = e.ctrlKey ? ZOOM_CTRL : ZOOM_NORMAL;
    if (e.ctrlKey) e.preventDefault(); // 브라우저 페이지 줌 방지
  };
  canvas.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
  camera.onDisposeObservable.add(() => {
    canvas.removeEventListener('wheel', wheelHandler, true);
  });

  // 관성 제거 — 마우스를 멈추면 즉시 멈추도록 (딜레이 없는 기민한 조작)
  // inertia: 회전/줌 관성 (default 0.9). 0 = 코스팅 없음
  camera.inertia = 0;
  // panningInertia: 패닝 관성 (default 0.9). 0 = 코스팅 없음
  camera.panningInertia = 0;

  // 패닝 속도
  // panningSensibility: default 1000. Lower is faster.
  camera.panningSensibility = 50;

  // 마우스 버튼 매핑
  // 0: Left, 1: Middle, 2: Right

  // Panning (이동): Middle Click (1)
  // Explicitly set property (and private property for older versions)
  (camera as any).panningMouseButton = 1;
  (camera as any)._panningMouseButton = 1;

  // Rotation (회전): Right Click (2)
  // Configure the pointers input to accept both Middle (Pan) and Right (Rotate)
  // Left Click (0) is excluded so it can be used for selection
  const pointersInput = (camera.inputs.attached.pointers as any);
  if (pointersInput) {
    pointersInput.buttons = [1, 2];
  }

  camera.minZ = 0.1; // 최소 클리핑 거리
  camera.maxZ = 1000; // 최대 클리핑 거리

  // 카메라 이동 범위 제한
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 800;

  return camera;
};

/**
 * 조명 설정
 */
export const createLights = (scene: Scene): void => {
  // 주변광 (Ambient Light)
  const hemisphericLight = new HemisphericLight('hemisphericLight', new Vector3(0, 1, 0), scene);
  hemisphericLight.intensity = 0.7;
  hemisphericLight.diffuse = new Color3(1, 1, 1);
  hemisphericLight.specular = new Color3(0.5, 0.5, 0.5);

  // 방향성 조명 1 (앞쪽)
  const directionalLight1 = new DirectionalLight(
    'directionalLight1',
    new Vector3(-1, -2, -1),
    scene
  );
  directionalLight1.intensity = 0.5;

  // 방향성 조명 2 (뒤쪽)
  const directionalLight2 = new DirectionalLight(
    'directionalLight2',
    new Vector3(1, 2, 1),
    scene
  );
  directionalLight2.intensity = 0.3;
};

/**
 * 씬 렌더링 시작
 */
export const startRenderLoop = (engine: Engine, scene: Scene): void => {
  engine.runRenderLoop(() => {
    scene.render();
  });
};

/**
 * 엔진 및 씬 정리
 */
export const disposeScene = (engine: Engine, scene: Scene): void => {
  scene.dispose();
  engine.dispose();
};

/**
 * 카메라를 특정 메쉬에 포커스
 */
export const focusOnMesh = (camera: ArcRotateCamera, mesh: Mesh): void => {
  // 메쉬의 바운딩 박스 계산
  const boundingInfo = mesh.getBoundingInfo();
  const center = boundingInfo.boundingBox.centerWorld;
  const radius = boundingInfo.boundingBox.extendSizeWorld.length();

  // 카메라 타겟 및 거리 설정
  camera.target = center;
  camera.radius = radius * 2.5; // 메쉬 크기의 2.5배 거리
};

/**
 * 씬의 모든 메쉬에 카메라 포커스
 * 카메라 target은 원점 (0,0,0)에 고정하고, radius만 조정
 */
export const focusOnAllMeshes = (camera: ArcRotateCamera, scene: Scene): void => {
  // 빌드플레이트(그리드 라인 메쉬)는 바운딩 계산에서 제외
  const meshes = scene.meshes.filter(
    (m) =>
      m.isVisible &&
      m.getTotalVertices() > 0 &&
      !m.name.startsWith('buildPlate')
  );

  if (meshes.length === 0) return;

  // 모든 메쉬의 바운딩 박스 합산
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  meshes.forEach((mesh) => {
    const boundingInfo = mesh.getBoundingInfo();
    const min = boundingInfo.boundingBox.minimumWorld;
    const max = boundingInfo.boundingBox.maximumWorld;

    minX = Math.min(minX, min.x);
    minY = Math.min(minY, min.y);
    minZ = Math.min(minZ, min.z);
    maxX = Math.max(maxX, max.x);
    maxY = Math.max(maxY, max.y);
    maxZ = Math.max(maxZ, max.z);
  });

  const size = new Vector3(maxX - minX, maxY - minY, maxZ - minZ);
  const radius = size.length();

  // 모델 바운딩박스 중심을 바라보고, 모델 크기에 맞춰 거리 조정
  // (원점 고정 시 작은 모델이 화면 위쪽에 작게 치우쳐 보이는 문제 해결)
  camera.target = new Vector3(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2
  );
  camera.radius = Math.max(radius * 1.5, 50);
};

/**
 * Utility Layer 생성 (Gizmo용)
 */
export const createUtilityLayer = (scene: Scene): UtilityLayerRenderer => {
  const utilityLayer = new UtilityLayerRenderer(scene);
  return utilityLayer;
};

/**
 * Gizmo Manager 생성 및 설정
 */
export const createGizmoManager = (scene: Scene, utilityLayer: UtilityLayerRenderer): GizmoManager => {
  const gizmoManager = new GizmoManager(scene, 1, utilityLayer);

  // Disable auto-attach on click. We handle attachment manually based on selection.
  gizmoManager.usePointerToAttachGizmos = false;

  // Gizmo 활성화 설정
  gizmoManager.positionGizmoEnabled = true;
  gizmoManager.rotationGizmoEnabled = true;
  gizmoManager.scaleGizmoEnabled = false;
  // 바운딩 박스(파란 선택 박스) 비활성화 — 선택 표기는 파일 목록에서만
  gizmoManager.boundingBoxGizmoEnabled = false;

  const positionGizmo = gizmoManager.gizmos.positionGizmo;
  const rotationGizmo = gizmoManager.gizmos.rotationGizmo;

  if (positionGizmo) {
    positionGizmo.updateGizmoRotationToMatchAttachedMesh = false;
  }

  if (rotationGizmo) {
    rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
  }

  return gizmoManager;
};
