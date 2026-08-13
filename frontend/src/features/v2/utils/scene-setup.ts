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
  grid: LinesMesh;
  axes: LinesMesh;
  dispose: () => void;
}

export interface PlateOptions {
  /** 빌드 볼륨 X (mm). */
  widthMm: number;
  /** 빌드 볼륨 Z (mm). Babylon 의 Z 가 STL 의 Y 에 해당. */
  depthMm: number;
  /** 격자 간격 (mm). 보통 10. */
  gridStepMm?: number;
}

const DEFAULT_GRID_STEP_MM = 10;

export function addBuildPlateAndGrid(
  scene: Scene,
  opts: PlateOptions,
): SceneFurniture {
  const { widthMm, depthMm } = opts;
  const step = opts.gridStepMm ?? DEFAULT_GRID_STEP_MM;

  // 1) 평면 (Y=0)
  const plate = MeshBuilder.CreateGround(
    "v2_plate",
    { width: widthMm, height: depthMm },
    scene,
  );
  const plateMat = new StandardMaterial("v2_plate_mat", scene);
  plateMat.diffuseColor = new Color3(0.78, 0.8, 0.85);
  plateMat.specularColor = new Color3(0.05, 0.05, 0.05);
  plateMat.alpha = 0.35;
  plate.material = plateMat;
  plate.isPickable = false;

  // 2) 평면 외곽선 (눈에 띄게 진하게)
  const halfW = widthMm / 2;
  const halfD = depthMm / 2;
  const outlineY = 0.02;
  const plateOutline = MeshBuilder.CreateLines(
    "v2_plate_outline",
    {
      points: [
        new Vector3(-halfW, outlineY, -halfD),
        new Vector3(halfW, outlineY, -halfD),
        new Vector3(halfW, outlineY, halfD),
        new Vector3(-halfW, outlineY, halfD),
        new Vector3(-halfW, outlineY, -halfD),
      ],
    },
    scene,
  );
  plateOutline.color = new Color3(0.3, 0.36, 0.42);
  plateOutline.isPickable = false;

  // 3) 그리드 라인 (10mm 간격)
  const gridLines: Vector3[][] = [];
  const xCount = Math.floor(halfW / step);
  const zCount = Math.floor(halfD / step);
  const gridY = 0.01;
  for (let i = -xCount; i <= xCount; i++) {
    const x = i * step;
    gridLines.push([
      new Vector3(x, gridY, -halfD),
      new Vector3(x, gridY, halfD),
    ]);
  }
  for (let j = -zCount; j <= zCount; j++) {
    const z = j * step;
    gridLines.push([
      new Vector3(-halfW, gridY, z),
      new Vector3(halfW, gridY, z),
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
  //   내부 +Z(안쪽) → 표시 −Y → 초록
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

  return {
    plate,
    plateOutline,
    grid,
    axes,
    dispose() {
      plate.dispose();
      plateOutline.dispose();
      grid.dispose();
      axes.dispose();
      plateMat.dispose();
    },
  };
}
