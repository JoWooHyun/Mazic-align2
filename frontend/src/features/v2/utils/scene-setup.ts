import {
  Color3,
  Color4,
  LinesMesh,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

/**
 * 빌드플레이트(평면) + 그리드 + 원점 좌표축 을 씬에 추가한다.
 * 반환된 핸들로 dispose 가능.
 */
export interface SceneFurniture {
  plate: Mesh;
  plateOutline: LinesMesh;
  /** 앞쪽 표시 사다리꼴 (B-26). 앞변 = 그린 사각형의 내부 z 최소 (area 가 없으면 −depthMm/2). */
  frontMarker: LinesMesh;
  grid: LinesMesh;
  axes: LinesMesh;
  /**
   * 빌드 볼륨 철사 상자 (#7) — 플레이트 사각형 위로 heightMm 까지 세로 모서리 4 + 윗면 사각형.
   *   heightMm 이 없거나 0 이하이거나, 플레이트 긴 변의 VOLUME_BOX_MAX_HEIGHT_RATIO 배를 넘으면 null(그리지 않음).
   */
  volumeBox: LinesMesh | null;
  dispose: () => void;
}

/** 플레이트로 그릴 사각형 (world X/Z mm). 원점 대칭이 아닐 수 있다. */
export interface PlateArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PlateOptions {
  /** 빌드 볼륨 X (mm). */
  widthMm: number;
  /** 빌드 볼륨 Z (mm). Babylon 의 Z 가 STL 의 Y 에 해당. */
  depthMm: number;
  /** 격자 간격 (mm). 보통 10. */
  gridStepMm?: number;
  /**
   * 데모 수정 1차 ② — 플레이트를 이 사각형(world X/Z mm)에 그린다. Task0 프로파일의 출력 가능 영역
   *   (task0PrintableAreaForProfile — 베드 X 10~150·Y 10~85 = world X −65~75·Z −32.5~42.5, 비대칭)을 준다.
   *   리드 10/12: "출력 가능 영역에 맞게, 테두리 따로 표현 안 해도 됨, 하드웨어를 맞춰 놓기 때문".
   *   평면·외곽선·격자·앞쪽 탭을 이 사각형으로 만들고, 격자는 (minX, minZ) 모서리(= 베드 (10, 10))에서
   *   gridStepMm 간격으로 시작한다. **그리는 위치만 바뀐다** — world 원점(모델 좌표)·world↔베드 변환
   *   (task0-frame worldToBed)은 그대로라 산출물 바이트는 불변. 원점 좌표축도 world 원점에 그대로 둔다.
   *   없으면 종전(원점 중심 widthMm × depthMm, 격자는 원점에서).
   */
  area?: PlateArea;
  /**
   * #7 빌드 볼륨 높이 (mm, world Y). > 0 이면 플레이트 사각형(area 가 있으면 그 사각형) 위로 이 높이까지
   *   철사 상자를 그린다 — 모델이 높이 상한에 얼마나 가까운지 눈으로 보이게. 표시용 선일 뿐 검사(useBuildVolumeCheck)·
   *   산출물과 무관. 없거나 0 이하이면 그리지 않는다(종전). 플레이트 긴 변의 VOLUME_BOX_MAX_HEIGHT_RATIO 배를 넘어도
   *   그리지 않는다 — Task0 는 높이 = Z 이송 범위 2000 mm(규격서 §1)라 150×85 판 위로 2 m 기둥만 보이고 쓸모가 없다.
   */
  heightMm?: number;
}

const DEFAULT_GRID_STEP_MM = 10;
/**
 * #7 빌드 볼륨 상자를 그리는 높이 상한 = 플레이트 긴 변 × 이 배수. 넘으면 "높이 제한이 사실상 없음" 으로 보고 안 그린다
 *   (Task0 2000 mm ÷ 140 mm ≈ 14배 → 안 그림 / LCD 프로파일은 보통 1~2배 → 그림).
 */
export const VOLUME_BOX_MAX_HEIGHT_RATIO = 4;
/** 격자 줄 수 계산의 부동소수 여유 (mm/step 단위) — 정수 배수에서 줄이 빠지지 않게. */
const GRID_EPS = 1e-9;

export function addBuildPlateAndGrid(
  scene: Scene,
  opts: PlateOptions,
): SceneFurniture {
  const { widthMm, depthMm } = opts;
  const step = opts.gridStepMm ?? DEFAULT_GRID_STEP_MM;
  // 데모 수정 1차 ② — 그릴 사각형. area 가 없으면 종전 원점 중심 widthMm × depthMm.
  const area = opts.area;
  const rectMinX = area ? area.minX : -widthMm / 2;
  const rectMaxX = area ? area.maxX : widthMm / 2;
  const rectMinZ = area ? area.minZ : -depthMm / 2;
  const rectMaxZ = area ? area.maxZ : depthMm / 2;
  const rectW = rectMaxX - rectMinX;
  const rectD = rectMaxZ - rectMinZ;
  const centerX = (rectMinX + rectMaxX) / 2;
  const centerZ = (rectMinZ + rectMaxZ) / 2;

  // 1) 평면 (Y=0) — 사각형 중심으로 옮긴다(area 가 없으면 원점 그대로).
  const plate = MeshBuilder.CreateGround(
    "v2_plate",
    { width: rectW, height: rectD },
    scene,
  );
  plate.position.x = centerX;
  plate.position.z = centerZ;
  const plateMat = new StandardMaterial("v2_plate_mat", scene);
  plateMat.diffuseColor = new Color3(0.78, 0.8, 0.85);
  plateMat.specularColor = new Color3(0.05, 0.05, 0.05);
  plateMat.alpha = 0.35;
  plate.material = plateMat;
  plate.isPickable = false;

  // 2) 평면 외곽선 (눈에 띄게 진하게)
  const halfW = rectW / 2;
  const halfD = rectD / 2;
  const outlineY = 0.02;
  const plateOutline = MeshBuilder.CreateLines(
    "v2_plate_outline",
    {
      points: [
        new Vector3(rectMinX, outlineY, rectMinZ),
        new Vector3(rectMaxX, outlineY, rectMinZ),
        new Vector3(rectMaxX, outlineY, rectMaxZ),
        new Vector3(rectMinX, outlineY, rectMaxZ),
        new Vector3(rectMinX, outlineY, rectMinZ),
      ],
    },
    scene,
  );
  plateOutline.color = new Color3(0.3, 0.36, 0.42);
  plateOutline.isPickable = false;

  // 2b) **앞쪽 표시** (B-26) — 플레이트만 보면 앞뒤를 알 수 없다는 리드 지적.
  //   CHITUBOX 는 앞변에 사다리꼴 탭을 달아 앞을 표시한다(리드 대조 캡처).
  //   같은 개념을 선으로 구현한다: 앞변 중앙에서 **바깥으로 튀어나온 사다리꼴**.
  //
  //   어느 변이 "앞"인가: Front 프리셋(alpha=-π/2, beta=π/2)의 카메라는 내부
  //   −Z 쪽에 선다. 따라서 사용자가 "앞"이라 부르는 변은 **내부 z 최소 변**
  //   (area 가 없으면 −depthMm/2). (표시 규약 B-13 에서 내부 −Z = 표시 −Y = 베드 Y 최소 쪽.)
  //   데모 수정 1차 ②: 탭은 그린 사각형의 앞변 중앙(centerX)에 단다.
  //
  //   외곽선과 같은 선 메시로 그려 머티리얼을 새로 만들지 않는다(누수 여지 0).
  const tabDepth = Math.min(halfW, halfD) * 0.12; // 플레이트 크기에 비례
  const tabHalfW = tabDepth * 1.1;
  const frontZ = rectMinZ;
  const frontMarker = MeshBuilder.CreateLines(
    "v2_plate_front",
    {
      points: [
        new Vector3(centerX - tabHalfW, outlineY, frontZ),
        new Vector3(centerX - tabHalfW * 0.45, outlineY, frontZ - tabDepth),
        new Vector3(centerX + tabHalfW * 0.45, outlineY, frontZ - tabDepth),
        new Vector3(centerX + tabHalfW, outlineY, frontZ),
      ],
    },
    scene,
  );
  // 외곽선보다 눈에 띄되 축 색(빨강/초록/파랑)과는 구분되는 청록.
  frontMarker.color = new Color3(0.25, 0.65, 0.85);
  frontMarker.isPickable = false;

  // 3) 그리드 라인 (10mm 간격)
  //   격자 원점: area 가 없으면 world 원점(종전 — 원점에서 ±방향으로 step 배수),
  //   있으면 (minX, minZ) 모서리(데모 수정 1차 ② — Task0 는 베드 (10, 10) = 출력 가능 영역 모서리).
  //   ⚠️ 격자 원점이 바뀌어도 모델 좌표(world 원점)는 바뀌지 않는다 — 표시용 선일 뿐이다.
  //   줄 번호 k 는 사각형 안에 드는 범위만: x = gridOriginX + k·step ∈ [rectMinX, rectMaxX].
  const gridLines: Vector3[][] = [];
  const gridOriginX = area ? rectMinX : 0;
  const gridOriginZ = area ? rectMinZ : 0;
  const xFirst = Math.ceil((rectMinX - gridOriginX) / step - GRID_EPS);
  const xLast = Math.floor((rectMaxX - gridOriginX) / step + GRID_EPS);
  const zFirst = Math.ceil((rectMinZ - gridOriginZ) / step - GRID_EPS);
  const zLast = Math.floor((rectMaxZ - gridOriginZ) / step + GRID_EPS);
  const gridY = 0.01;
  for (let i = xFirst; i <= xLast; i++) {
    const x = gridOriginX + i * step;
    gridLines.push([
      new Vector3(x, gridY, rectMinZ),
      new Vector3(x, gridY, rectMaxZ),
    ]);
  }
  for (let j = zFirst; j <= zLast; j++) {
    const z = gridOriginZ + j * step;
    gridLines.push([
      new Vector3(rectMinX, gridY, z),
      new Vector3(rectMaxX, gridY, z),
    ]);
  }
  const grid = MeshBuilder.CreateLineSystem(
    "v2_grid",
    { lines: gridLines },
    scene,
  );
  grid.color = new Color3(0.62, 0.66, 0.72);
  grid.alpha = 0.55;
  grid.isPickable = false;

  // 4) 원점 좌표축 — **표시 규약은 Z-up** (B-13).
  //
  // 라인 자체는 내부(Babylon Y-up) 좌표로 그리되, **색 배정을 표시 축에 맞춘다**:
  //   내부 +X(옆)  → 표시 X → 빨강
  //   내부 +Y(위)  → 표시 Z → **파랑**   ← 위로 뻗는 선이 파랑이어야 한다
  //   내부 +Z(안쪽) → 표시 +Y → 초록
  // 색은 프린터 관례(X 빨강 / Y 초록 / Z 파랑)를 그대로 쓰고, 어느 색이 화면에서
  // 위를 가리키는지만 규약과 맞췄다. 매핑 근거는 `types/axis-display.ts`.
  // 길이는 빌드플레이트 짧은 변의 20%.
  const axisLen = Math.min(widthMm, depthMm) * 0.18;
  const AXIS_RED = new Color4(1, 0.3, 0.3, 1);
  const AXIS_GREEN = new Color4(0.3, 0.9, 0.4, 1);
  const AXIS_BLUE = new Color4(0.35, 0.55, 1, 1);
  const axes = MeshBuilder.CreateLineSystem(
    "v2_axes",
    {
      lines: [
        [Vector3.Zero(), new Vector3(axisLen, 0, 0)],
        [Vector3.Zero(), new Vector3(0, axisLen, 0)],
        [Vector3.Zero(), new Vector3(0, 0, axisLen)],
      ],
      colors: [
        [AXIS_RED, AXIS_RED], // 내부 X = 표시 X
        [AXIS_BLUE, AXIS_BLUE], // 내부 Y(위) = 표시 Z
        [AXIS_GREEN, AXIS_GREEN], // 내부 Z = 표시 Y
      ],
    },
    scene,
  );
  axes.isPickable = false;

  // 5) 빌드 볼륨 철사 상자 (#7) — 세로 모서리 4 + 윗면 사각형. 바닥 사각형은 외곽선(2)이 이미 그린다.
  //   격자보다 옅게(외곽선 색 + 낮은 alpha) — 작업 공간을 가리지 않고 경계만 보이게.
  const heightMm = opts.heightMm ?? 0;
  let volumeBox: LinesMesh | null = null;
  if (heightMm > 0 && heightMm <= Math.max(rectW, rectD) * VOLUME_BOX_MAX_HEIGHT_RATIO) {
    const top = heightMm;
    const corners: [number, number][] = [
      [rectMinX, rectMinZ],
      [rectMaxX, rectMinZ],
      [rectMaxX, rectMaxZ],
      [rectMinX, rectMaxZ],
    ];
    const boxLines: Vector3[][] = corners.map(([x, z]) => [
      new Vector3(x, outlineY, z),
      new Vector3(x, top, z),
    ]);
    boxLines.push([...corners, corners[0]].map(([x, z]) => new Vector3(x, top, z)));
    volumeBox = MeshBuilder.CreateLineSystem(
      "v2_volume_box",
      { lines: boxLines },
      scene,
    );
    volumeBox.color = new Color3(0.3, 0.36, 0.42);
    volumeBox.alpha = 0.35;
    volumeBox.isPickable = false;
  }

  return {
    plate,
    plateOutline,
    frontMarker,
    grid,
    axes,
    volumeBox,
    dispose() {
      plate.dispose();
      plateOutline.dispose();
      frontMarker.dispose();
      grid.dispose();
      axes.dispose();
      volumeBox?.dispose();
      plateMat.dispose();
    },
  };
}
