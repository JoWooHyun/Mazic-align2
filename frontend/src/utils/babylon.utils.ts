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
  MeshBuilder,
  StandardMaterial,
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
    50, // radius (거리)
    Vector3.Zero(), // target
    scene
  );

  // 카메라 제어 설정
  // attachControl(element, noPreventDefault, useCtrlForPanning)
  // useCtrlForPanning = false (Ctrl 키 없이 패닝)
  camera.attachControl(canvas, true, false);

  // 줌 속도 개선
  // wheelPrecision: default 50. Lower is faster.
  camera.wheelPrecision = 10;

  // 패닝 속도 및 관성 설정 (1:1 이동 느낌)
  // panningSensibility: default 1000. Lower is faster.
  // 10 was too fast (moved more than mouse). Increased to 50 to slow it down.
  camera.panningSensibility = 50;
  // panningInertia: default 0.9. 
  // User requested "smoothness" similar to rotation.
  // 0.1 was too stiff. 0.7 provides a good balance of 1:1 feel + smoothness.
  camera.panningInertia = 0.7;

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
  camera.upperRadiusLimit = 200;

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
 * 카메라 target을 모든 메쉬의 바운딩박스 중심으로 설정
 */
export const focusOnAllMeshes = (camera: ArcRotateCamera, scene: Scene): void => {
  const meshes = scene.meshes.filter((m) => m.isVisible && m.getTotalVertices() > 0);

  if (meshes.length === 0) return;

  // 모든 메쉬의 바운딩 박스 합산
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;

  meshes.forEach((mesh) => {
    mesh.computeWorldMatrix(true);
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
  const center = new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const radius = size.length();

  // 카메라 target을 실제 메쉬 중심으로 설정
  camera.target = center;
  // 거리 조정하여 모든 메쉬가 보이도록 설정
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
/**
 * 빌드 플레이트 생성 (바닥판 + 그리드 + 볼륨 경계)
 */
export const createBuildPlate = (
  scene: Scene,
  buildWidth: number,
  buildDepth: number,
  buildHeight: number
): Mesh[] => {
  if (buildWidth <= 0 || buildDepth <= 0) return [];

  const meshes: Mesh[] = [];
  const hw = buildWidth / 2;
  const hd = buildDepth / 2;

  // 1. 바닥판 (반투명)
  const ground = MeshBuilder.CreateGround('buildPlate_ground', {
    width: buildWidth,
    height: buildDepth,
  }, scene);
  ground.position.y = 0;
  ground.isPickable = false;
  const groundMat = new StandardMaterial('buildPlate_groundMat', scene);
  groundMat.diffuseColor = new Color3(0.3, 0.3, 0.3);
  groundMat.alpha = 0.3;
  groundMat.backFaceCulling = false;
  ground.material = groundMat;
  meshes.push(ground);

  // 2. 그리드 (10mm 간격)
  const gridSpacing = 10;
  const lineArrays: Vector3[][] = [];

  for (let z = -hd; z <= hd; z += gridSpacing) {
    lineArrays.push([new Vector3(-hw, 0.01, z), new Vector3(hw, 0.01, z)]);
  }
  for (let x = -hw; x <= hw; x += gridSpacing) {
    lineArrays.push([new Vector3(x, 0.01, -hd), new Vector3(x, 0.01, hd)]);
  }

  const gridMesh = MeshBuilder.CreateLineSystem('buildPlate_grid', {
    lines: lineArrays,
  }, scene);
  gridMesh.color = new Color3(0.4, 0.4, 0.4);
  gridMesh.alpha = 0.5;
  gridMesh.isPickable = false;
  meshes.push(gridMesh);

  // 3. 볼륨 경계선 (와이어프레임 박스)
  const bh = buildHeight;
  const boxLines: Vector3[][] = [
    // Bottom
    [new Vector3(-hw, 0, -hd), new Vector3(hw, 0, -hd)],
    [new Vector3(hw, 0, -hd), new Vector3(hw, 0, hd)],
    [new Vector3(hw, 0, hd), new Vector3(-hw, 0, hd)],
    [new Vector3(-hw, 0, hd), new Vector3(-hw, 0, -hd)],
    // Top
    [new Vector3(-hw, bh, -hd), new Vector3(hw, bh, -hd)],
    [new Vector3(hw, bh, -hd), new Vector3(hw, bh, hd)],
    [new Vector3(hw, bh, hd), new Vector3(-hw, bh, hd)],
    [new Vector3(-hw, bh, hd), new Vector3(-hw, bh, -hd)],
    // Vertical edges
    [new Vector3(-hw, 0, -hd), new Vector3(-hw, bh, -hd)],
    [new Vector3(hw, 0, -hd), new Vector3(hw, bh, -hd)],
    [new Vector3(hw, 0, hd), new Vector3(hw, bh, hd)],
    [new Vector3(-hw, 0, hd), new Vector3(-hw, bh, hd)],
  ];

  const boundary = MeshBuilder.CreateLineSystem('buildPlate_boundary', {
    lines: boxLines,
  }, scene);
  boundary.color = new Color3(0.2, 0.6, 1.0);
  boundary.alpha = 0.6;
  boundary.isPickable = false;
  meshes.push(boundary);

  return meshes;
};

/**
 * 빌드 플레이트 제거
 */
export const disposeBuildPlate = (meshes: Mesh[]): void => {
  meshes.forEach(m => m.dispose());
};

export const createGizmoManager = (scene: Scene, utilityLayer: UtilityLayerRenderer): GizmoManager => {
  const gizmoManager = new GizmoManager(scene, 1, utilityLayer);

  // Disable auto-attach on click. We handle attachment manually based on selection.
  gizmoManager.usePointerToAttachGizmos = false;

  // Gizmo 활성화 설정
  gizmoManager.positionGizmoEnabled = true;
  gizmoManager.rotationGizmoEnabled = true;
  gizmoManager.scaleGizmoEnabled = false;
  gizmoManager.boundingBoxGizmoEnabled = true; // 바운딩 박스 표시 (조작 불가)

  const positionGizmo = gizmoManager.gizmos.positionGizmo;
  const rotationGizmo = gizmoManager.gizmos.rotationGizmo;
  const boundingBoxGizmo = gizmoManager.gizmos.boundingBoxGizmo;

  if (positionGizmo) {
    positionGizmo.updateGizmoRotationToMatchAttachedMesh = false;
  }

  if (rotationGizmo) {
    rotationGizmo.updateGizmoRotationToMatchAttachedMesh = false;
  }

  // Bounding Box는 시각적으로만 표시 (조작 핸들 비활성화)
  if (boundingBoxGizmo) {
    // 모든 스케일 박스 숨기기 (조작 포인트 제거)
    boundingBoxGizmo.setEnabledScaling(false);
    // 회전 핸들도 숨기기
    boundingBoxGizmo.setEnabledRotationAxis('');
    // 고정 크기로 표시
    boundingBoxGizmo.fixedDragMeshScreenSize = true;
  }

  return gizmoManager;
};
