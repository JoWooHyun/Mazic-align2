/**
 * 슬라이스 기반 island 검출 — ChiTuBox/Cura 표준 알고리즘.
 *
 * 모델을 Y축 layerHeight 간격으로 자른 뒤 각 layer 단면을 cellSize
 * grid 로 라스터화하고, 4-connected component 라벨링으로 연결 영역을 찾는다.
 * 컴포넌트가 직하 prevLayers 합집합과 cellAdjR 인접 안에서 닿지 않으면
 * "새로 등장한 분리 영역" = ISLAND. supportAngle 로 자체지지 임계를 파생.
 */
import { Vector3 } from '@babylonjs/core';
import type { TriInfo } from './support.utils';

export interface SliceIslandParams {
  tris: TriInfo[];
  /** 미지정 시 전체 face */
  faceFilter?: (faceIdx: number) => boolean;
  /** 기본 0.05mm (LCD/DLP 표준) */
  layerHeight?: number;
  /** 기본 0.05mm */
  cellSize?: number;
  /** 자체지지 임계각 (°). 기본 45° */
  supportAngle?: number;
  /**
   * true 면 island 후처리 단계에서 face normal.y >= 0 (수평/위 향함) 인 face 를
   * 결과에서 제외. 표준 슬라이서 정의에서 벗어나지만 사용자가 본 "위쪽 향한
   * 면도 island" 노이즈 제거. default true.
   */
  downFacingOnly?: boolean;
  /**
   * Island component 의 최소 cell 수. 그 미만 component 는 노이즈로 무시.
   * cellSize 0.05mm 기준 8 cell ≈ 0.02 mm². default 8.
   */
  minIslandCells?: number;
  /**
   * plate (Y=0) 와 이 거리(mm) 이내의 layer 는 island 분류에서 제외.
   * 모델 바닥(plate 접지)은 "공중에 떠있는" 게 아니므로 island 가 아님.
   * default 0.1mm.
   */
  plateGap?: number;
  /**
   * 디버그용. 지정한 layer 인덱스 들에서 component / connectivity / downFacing 후처리
   * 결과를 콘솔에 상세 출력. 검출 누락 진단용. default 없음.
   */
  debugLayers?: number[];
}

export interface IslandComponent {
  /** 이 component 의 cell 수 (면적 = cellCount × cellSize²) */
  cellCount: number;
  /** Centroid 의 world X (mm) */
  centroidX: number;
  /** Centroid 의 world Z (mm) */
  centroidZ: number;
}

export interface SliceIslandResult {
  /** ISLAND 로 판정된 face index 집합 */
  islandFaces: Set<number>;
  /** [L] → 그 layer 의 모든 cell key set */
  sliceCells: Set<string>[];
  /** [L] → 라스터화 시 stamp 된 (faceIndex, cell) 매핑 */
  sliceFaceCells: Array<{ faceIndex: number; cell: string }[]>;
  /** [L] → 그 layer 에서 ISLAND 로 판정된 cell key set (UI 강조용) */
  perLayerIslandCells: Set<string>[];
  /** [L] → 그 layer 의 island component 정보 (시각화용) */
  perLayerIslandComponents: IslandComponent[][];
  /** [L] → 그 layer 의 island face 개수 */
  perLayerIslandCount: number[];
  yMin: number;
  yMax: number;
  nSlices: number;
  layerHeight: number;
  cellSize: number;
  /** 자체지지 한계 (mm) */
  dSafe: number;
  /** 직하 합집합 깊이 (layer 수) */
  prevLayers: number;
  /** 인접 검사 cell 반경 */
  cellAdjR: number;
}

const EMPTY_RESULT = (
  layerHeight: number,
  cellSize: number
): SliceIslandResult => ({
  islandFaces: new Set(),
  sliceCells: [],
  sliceFaceCells: [],
  perLayerIslandCells: [],
  perLayerIslandComponents: [],
  perLayerIslandCount: [],
  yMin: 0,
  yMax: 0,
  nSlices: 0,
  layerHeight,
  cellSize,
  dSafe: 0,
  prevLayers: 1,
  cellAdjR: 1,
});

export function detectSliceIslands(p: SliceIslandParams): SliceIslandResult {
  const layerHeight = p.layerHeight ?? 0.05;
  const cellSize = p.cellSize ?? 0.05;
  const supportAngle = p.supportAngle ?? 45;
  const faceFilter = p.faceFilter ?? (() => true);
  const downFacingOnly = p.downFacingOnly ?? true;
  const minIslandCells = p.minIslandCells ?? 8;
  const plateGap = p.plateGap ?? 0.1;
  const tris = p.tris;

  // ── Y 범위 + 대상 tri 인덱스 모음 ──────────────────────────────────────────
  let yMin = Infinity;
  let yMax = -Infinity;
  const targetIdx: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    if (!faceFilter(tris[i].faceIndex)) continue;
    targetIdx.push(i);
    const t = tris[i];
    const lo = Math.min(t.v0.y, t.v1.y, t.v2.y);
    const hi = Math.max(t.v0.y, t.v1.y, t.v2.y);
    if (lo < yMin) yMin = lo;
    if (hi > yMax) yMax = hi;
  }
  if (targetIdx.length === 0) return EMPTY_RESULT(layerHeight, cellSize);

  const nSlices = Math.max(2, Math.ceil((yMax - yMin) / layerHeight) + 1);
  const sliceCells: Set<string>[] = new Array(nSlices);
  const sliceFaceCells: { faceIndex: number; cell: string }[][] = new Array(
    nSlices
  );
  // layer 별 단면 segment (scanline fill 용). boundary stamp 와 동시에 수집.
  type LayerSegment = { ax: number; az: number; bx: number; bz: number };
  const layerSegments: LayerSegment[][] = new Array(nSlices);
  for (let i = 0; i < nSlices; i++) {
    sliceCells[i] = new Set();
    sliceFaceCells[i] = [];
    layerSegments[i] = [];
  }

  // ── 라스터화 ────────────────────────────────────────────────────────────
  //   각 layer z=zL 평면과 삼각형의 교차선(line segment) 을:
  //     ① DDA 로 외곽 cell stamp (sliceCells + sliceFaceCells)
  //     ② layerSegments 에 segment 저장 → 이후 scanline fill 로 내부 cells 추가
  const stampSegment = (
    sIdx: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
    faceIndex: number
  ): void => {
    const dx = bx - ax;
    const dz = bz - az;
    const lenC = Math.max(Math.abs(dx), Math.abs(dz)) / (cellSize * 0.5);
    const steps = Math.max(1, Math.ceil(lenC));
    let prevKey = '';
    for (let k = 0; k <= steps; k++) {
      const tt = k / steps;
      const px = ax + dx * tt;
      const pz = az + dz * tt;
      const cx = Math.floor(px / cellSize);
      const cz = Math.floor(pz / cellSize);
      const key = `${cx},${cz}`;
      if (key === prevKey) continue;
      prevKey = key;
      sliceCells[sIdx].add(key);
      sliceFaceCells[sIdx].push({ faceIndex, cell: key });
    }
  };

  for (const idx of targetIdx) {
    const t = tris[idx];
    const lo = Math.min(t.v0.y, t.v1.y, t.v2.y);
    const hi = Math.max(t.v0.y, t.v1.y, t.v2.y);
    const sLo = Math.max(0, Math.floor((lo - yMin) / layerHeight));
    const sHi = Math.min(nSlices - 1, Math.ceil((hi - yMin) / layerHeight));
    // 거의 수평인 삼각형 → bbox 폴백
    if (hi - lo < layerHeight * 0.5) {
      const xLo = Math.min(t.v0.x, t.v1.x, t.v2.x);
      const xHi = Math.max(t.v0.x, t.v1.x, t.v2.x);
      const zLo = Math.min(t.v0.z, t.v1.z, t.v2.z);
      const zHi = Math.max(t.v0.z, t.v1.z, t.v2.z);
      const cxLo = Math.floor(xLo / cellSize);
      const cxHi = Math.floor(xHi / cellSize);
      const czLo = Math.floor(zLo / cellSize);
      const czHi = Math.floor(zHi / cellSize);
      for (let s = sLo; s <= sHi; s++) {
        for (let cx = cxLo; cx <= cxHi; cx++) {
          for (let cz = czLo; cz <= czHi; cz++) {
            const key = `${cx},${cz}`;
            sliceCells[s].add(key);
            sliceFaceCells[s].push({ faceIndex: t.faceIndex, cell: key });
          }
        }
      }
      continue;
    }
    // 일반: 각 layer 에서 평면 교차선 (양 끝 점 2개) → DDA stamp
    const vs: Vector3[] = [t.v0, t.v1, t.v2];
    for (let s = sLo; s <= sHi; s++) {
      const zL = yMin + s * layerHeight;
      const pts: { x: number; z: number }[] = [];
      for (let e = 0; e < 3; e++) {
        const a = vs[e];
        const b = vs[(e + 1) % 3];
        const ay = a.y - zL;
        const by = b.y - zL;
        if (ay === 0 && by === 0) continue;
        if ((ay >= 0 && by >= 0) || (ay <= 0 && by <= 0)) {
          if (ay === 0) pts.push({ x: a.x, z: a.z });
          else if (by === 0) pts.push({ x: b.x, z: b.z });
          continue;
        }
        const tt = ay / (ay - by);
        pts.push({ x: a.x + (b.x - a.x) * tt, z: a.z + (b.z - a.z) * tt });
      }
      if (pts.length < 2) continue;
      stampSegment(s, pts[0].x, pts[0].z, pts[1].x, pts[1].z, t.faceIndex);
      // Fill 용 segment 저장 (face 무관)
      layerSegments[s].push({
        ax: pts[0].x,
        az: pts[0].z,
        bx: pts[1].x,
        bz: pts[1].z,
      });
    }
  }

  // ── Scanline fill — 단면 내부 cells 추가 ──────────────────────────────
  //   even-odd 규칙: 각 cellZ 중심 z 에서 segment 들과 교차하는 x 값 정렬,
  //   짝수번째↔홀수번째 x 쌍 사이의 cells = 내부.
  //   내부 cell 은 face 매핑 없음 (sliceFaceCells 는 boundary 만 유지) → downFacingOnly /
  //   face overlay / scoped support 는 영향 없음.
  let fillSkippedRows = 0;
  for (let s = 0; s < nSlices; s++) {
    const segs = layerSegments[s];
    if (segs.length === 0) continue;
    let zLoMin = Infinity;
    let zHiMax = -Infinity;
    for (const seg of segs) {
      const zLo = Math.min(seg.az, seg.bz);
      const zHi = Math.max(seg.az, seg.bz);
      if (zLo < zLoMin) zLoMin = zLo;
      if (zHi > zHiMax) zHiMax = zHi;
    }
    if (!Number.isFinite(zLoMin) || !Number.isFinite(zHiMax)) continue;
    const cellZMin = Math.floor(zLoMin / cellSize);
    const cellZMax = Math.floor(zHiMax / cellSize);
    for (let cz = cellZMin; cz <= cellZMax; cz++) {
      const zMid = (cz + 0.5) * cellSize;
      const xs: number[] = [];
      for (const seg of segs) {
        const zMinSeg = Math.min(seg.az, seg.bz);
        const zMaxSeg = Math.max(seg.az, seg.bz);
        // half-open: zMid 가 [zMinSeg, zMaxSeg) 안 → endpoint 중복 카운트 방지
        if (zMid < zMinSeg || zMid >= zMaxSeg) continue;
        const denom = seg.bz - seg.az;
        if (Math.abs(denom) < 1e-12) continue;
        const t = (zMid - seg.az) / denom;
        xs.push(seg.ax + t * (seg.bx - seg.ax));
      }
      if (xs.length < 2 || xs.length % 2 !== 0) {
        fillSkippedRows++;
        continue; // mesh 결함 — 그 z 줄 skip
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i < xs.length; i += 2) {
        const cxL = Math.floor(xs[i] / cellSize);
        const cxR = Math.floor(xs[i + 1] / cellSize);
        for (let cx = cxL + 1; cx < cxR; cx++) {
          sliceCells[s].add(`${cx},${cz}`);
        }
      }
    }
  }
  if (fillSkippedRows > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[detectSliceIslands] scanline fill: ${fillSkippedRows} z-row skip (홀수 교차 — mesh 결함)`
    );
  }

  // ── 4-connected component 라벨링 ──────────────────────────────────────
  const labelComponents = (cells: Set<string>): Map<string, number> => {
    const lab = new Map<string, number>();
    let next = 0;
    const queue: string[] = [];
    for (const seed of cells) {
      if (lab.has(seed)) continue;
      next++;
      lab.set(seed, next);
      queue.length = 0;
      queue.push(seed);
      while (queue.length > 0) {
        const k = queue.pop() as string;
        const ci = k.indexOf(',');
        const cx = +k.slice(0, ci);
        const cz = +k.slice(ci + 1);
        // 8-connected — 가파른 곡면 단면의 대각선 인접도 같은 component 로 묶음
        const nbrs = [
          `${cx + 1},${cz}`,
          `${cx - 1},${cz}`,
          `${cx},${cz + 1}`,
          `${cx},${cz - 1}`,
          `${cx + 1},${cz + 1}`,
          `${cx + 1},${cz - 1}`,
          `${cx - 1},${cz + 1}`,
          `${cx - 1},${cz - 1}`,
        ];
        for (const nk of nbrs) {
          if (cells.has(nk) && !lab.has(nk)) {
            lab.set(nk, next);
            queue.push(nk);
          }
        }
      }
    }
    return lab;
  };

  // ── 자체지지 한계 (supportAngle 파생) ──────────────────────────────────
  const ssAngleRad = (supportAngle * Math.PI) / 180;
  const dSafe = layerHeight * Math.tan(ssAngleRad);
  const prevLayers = Math.max(1, Math.ceil(dSafe / layerHeight));
  // Fill 모드 (단면 내부 cells 까지 채워짐) — cellAdjR Chebyshev 보정 불필요.
  //   layer 간 fill 영역 overlap 이 자연스럽게 "지지받음" 표현.
  //   직접 overlap + 4-인접 (1 cell shift 흡수) 만 인정.
  //   cellAdjR 변수는 3D 전파 단계에서 같은 의미로 재사용 (1 고정).
  const cellAdjR = 1;

  const isComponentConnected = (
    compCells: string[],
    prevCells: Set<string>
  ): boolean => {
    for (const k of compCells) {
      if (prevCells.has(k)) return true;
      const ci = k.indexOf(',');
      const cx = +k.slice(0, ci);
      const cz = +k.slice(ci + 1);
      // 4-인접 (상하좌우) — fill 영역의 1 cell shift 흡수
      if (prevCells.has(`${cx + 1},${cz}`)) return true;
      if (prevCells.has(`${cx - 1},${cz}`)) return true;
      if (prevCells.has(`${cx},${cz + 1}`)) return true;
      if (prevCells.has(`${cx},${cz - 1}`)) return true;
    }
    return false;
  };

  // ── Island 판정 (아래에서 위로) ────────────────────────────────────────
  const islandFaces = new Set<number>();
  const perLayerIslandCells: Set<string>[] = new Array(nSlices);
  const perLayerIslandComponents: IslandComponent[][] = new Array(nSlices);
  const perLayerIslandCount: number[] = new Array(nSlices).fill(0);
  // 각 component 의 cells 보관 (downFacingOnly 후처리에서 필터 위해)
  const perLayerCompCells: string[][][] = new Array(nSlices);
  for (let i = 0; i < nSlices; i++) {
    perLayerIslandCells[i] = new Set();
    perLayerIslandComponents[i] = [];
    perLayerCompCells[i] = [];
  }

  const debugLayers = p.debugLayers ?? [];
  const debugLayerSet = new Set(debugLayers);
  for (let i = 0; i < nSlices; i++) {
    const cur = sliceCells[i];
    if (cur.size === 0) continue;
    // plate (Y=0) 근처 layer 는 island 분류 skip — 모델 바닥은 공중에 안 떠있음
    const layerYAbs = yMin + i * layerHeight;
    if (layerYAbs < plateGap) {
      if (debugLayerSet.has(i)) {
        // eslint-disable-next-line no-console
        console.log(`[L=${i}] SKIP — plateGap (Y=${layerYAbs.toFixed(3)} < ${plateGap})`);
      }
      continue;
    }
    const labels = labelComponents(cur);
    const compCells = new Map<number, string[]>();
    for (const [k, lb] of labels) {
      let arr = compCells.get(lb);
      if (!arr) {
        arr = [];
        compCells.set(lb, arr);
      }
      arr.push(k);
    }
    const prev = new Set<string>();
    for (let k = 1; k <= prevLayers && i - k >= 0; k++) {
      for (const c of sliceCells[i - k]) prev.add(c);
    }
    if (debugLayerSet.has(i)) {
      // eslint-disable-next-line no-console
      console.log(
        `[L=${i}] Y=${layerYAbs.toFixed(3)} cells=${cur.size} components=${compCells.size} prevCells=${prev.size}`
      );
      for (const [, cellsOfComp] of compCells) {
        const isCon = isComponentConnected(cellsOfComp, prev);
        let sumX = 0, sumZ = 0;
        for (const k of cellsOfComp) {
          const ci = k.indexOf(',');
          sumX += +k.slice(0, ci);
          sumZ += +k.slice(ci + 1);
        }
        const cxAvg = sumX / cellsOfComp.length;
        const czAvg = sumZ / cellsOfComp.length;
        // eslint-disable-next-line no-console
        console.log(
          `   comp size=${cellsOfComp.length} centroid=(${(cxAvg * cellSize).toFixed(2)}, ${(czAvg * cellSize).toFixed(2)}) connected=${isCon} ${cellsOfComp.length < minIslandCells ? '(under-min)' : ''}`
        );
      }
    }
    const islandCellSet = perLayerIslandCells[i];
    for (const [, cellsOfComp] of compCells) {
      // 작은 component (cellSize 단위 노이즈) 제외 — 시뮬레이션상 안 보이는 미세 분리
      if (cellsOfComp.length < minIslandCells) continue;
      if (isComponentConnected(cellsOfComp, prev)) continue;
      // component 의 centroid 계산 (cell 단위 → mm)
      let sumCx = 0;
      let sumCz = 0;
      for (const k of cellsOfComp) {
        const ci2 = k.indexOf(',');
        sumCx += +k.slice(0, ci2);
        sumCz += +k.slice(ci2 + 1);
      }
      const avgCx = sumCx / cellsOfComp.length;
      const avgCz = sumCz / cellsOfComp.length;
      perLayerIslandComponents[i].push({
        cellCount: cellsOfComp.length,
        centroidX: (avgCx + 0.5) * cellSize,
        centroidZ: (avgCz + 0.5) * cellSize,
      });
      perLayerCompCells[i].push(cellsOfComp); // 동일 index — downFacingOnly 후처리용
      for (const c of cellsOfComp) islandCellSet.add(c);
    }
    if (islandCellSet.size === 0) continue;
    const faceTouched = new Set<number>();
    for (const fc of sliceFaceCells[i]) {
      if (islandCellSet.has(fc.cell)) {
        islandFaces.add(fc.faceIndex);
        faceTouched.add(fc.faceIndex);
      }
    }
    perLayerIslandCount[i] = faceTouched.size;
  }

  // ── 3D 전파: 첫 등장 island → 위 layer 들로 동일 physical island label 확장 ──
  //   사용자 요구: 가늘고 길게 이어진 island 전체 영역 표시 (첫 등장 layer 만 아님).
  //   알고리즘:
  //     ① 각 layer 의 첫 등장 island cells 에 physId 부여 (2D 컴포넌트 단위).
  //     ② layer 위로 올라가며 sliceCells[L] 의 2D 컴포넌트를 순회.
  //         · 이미 physId 라벨된 cell 포함 컴포넌트 → skip (첫 등장).
  //         · 컴포넌트 size > MAX_COMPONENT_SIZE → skip (main body 흡수 방지).
  //         · cellAdjR 이내 L-1 cell 중 physId 가지면 → 컴포넌트 전체에 동일 physId.
  //     ③ 결과: physical island 의 모든 cells 가 라벨됨 → islandFaces 확장.
  const MAX_COMPONENT_SIZE = 200; // cells per layer per component — 초과 시 main body 로 간주
  const cellPhysId = new Map<string, number>(); // "L|cellKey" → physId
  let nextPhysId = 0;

  // 첫 등장 island cells 에 physId 부여 (per 2D component)
  for (let L = 0; L < nSlices; L++) {
    const islandCells = perLayerIslandCells[L];
    if (!islandCells || islandCells.size === 0) continue;
    const seedLabels = labelComponents(islandCells);
    const labelToPhys = new Map<number, number>();
    for (const [k, lb] of seedLabels) {
      let physId = labelToPhys.get(lb);
      if (physId === undefined) {
        nextPhysId++;
        physId = nextPhysId;
        labelToPhys.set(lb, physId);
      }
      cellPhysId.set(`${L}|${k}`, physId);
    }
  }

  // 위로 전파
  for (let L = 1; L < nSlices; L++) {
    const curCells = sliceCells[L];
    if (curCells.size === 0) continue;
    const compLabels = labelComponents(curCells);
    const compToCells = new Map<number, string[]>();
    for (const [k, lb] of compLabels) {
      let arr = compToCells.get(lb);
      if (!arr) {
        arr = [];
        compToCells.set(lb, arr);
      }
      arr.push(k);
    }
    for (const [, cellsOfComp] of compToCells) {
      // 이미 첫 등장 physId 라벨 있으면 skip
      let alreadyLabeled = false;
      for (const k of cellsOfComp) {
        if (cellPhysId.has(`${L}|${k}`)) {
          alreadyLabeled = true;
          break;
        }
      }
      if (alreadyLabeled) continue;
      // main body 흡수 방지
      if (cellsOfComp.length > MAX_COMPONENT_SIZE) continue;
      // L-1 의 physId 후보 찾기
      let inherited: number | undefined;
      for (const k of cellsOfComp) {
        if (inherited !== undefined) break;
        const ci = k.indexOf(',');
        const cx = +k.slice(0, ci);
        const cz = +k.slice(ci + 1);
        for (let dx = -cellAdjR; dx <= cellAdjR && inherited === undefined; dx++) {
          for (let dz = -cellAdjR; dz <= cellAdjR; dz++) {
            const phys = cellPhysId.get(`${L - 1}|${cx + dx},${cz + dz}`);
            if (phys !== undefined) {
              inherited = phys;
              break;
            }
          }
        }
      }
      if (inherited === undefined) continue;
      for (const k of cellsOfComp) {
        cellPhysId.set(`${L}|${k}`, inherited);
      }
    }
  }

  // 라벨된 cells 로 perLayerIslandCells + islandFaces 재구성 (확장)
  for (let L = 0; L < nSlices; L++) perLayerIslandCells[L] = new Set<string>();
  for (const fullKey of cellPhysId.keys()) {
    const sep = fullKey.indexOf('|');
    const L = +fullKey.slice(0, sep);
    const cellKey = fullKey.slice(sep + 1);
    if (L < nSlices) perLayerIslandCells[L].add(cellKey);
  }
  islandFaces.clear();
  for (let L = 0; L < nSlices; L++) {
    const cells = perLayerIslandCells[L];
    if (cells.size === 0) continue;
    const faceTouched = new Set<number>();
    for (const fc of sliceFaceCells[L]) {
      if (cells.has(fc.cell)) {
        islandFaces.add(fc.faceIndex);
        faceTouched.add(fc.faceIndex);
      }
    }
    perLayerIslandCount[L] = faceTouched.size;
  }

  // ── 후처리: down-facing 필터 ─────────────────────────────────────────
  //   사용자 의도: 위쪽 향한 면 (face normal.y >= 0) 은 island 노이즈로 제외.
  //   표준 슬라이서 정의에서 벗어나지만, 인레이 외면 occlusal · 모델 윗면 ·
  //   concave 천장 같은 false-positive 제거에 효과적.
  if (downFacingOnly && islandFaces.size > 0) {
    const normalY = new Map<number, number>();
    for (const t of tris) normalY.set(t.faceIndex, t.normal.y);
    const islandFacesDown = new Set<number>();
    for (const f of islandFaces) {
      const ny = normalY.get(f);
      if (ny !== undefined && ny < 0) islandFacesDown.add(f);
    }
    // perLayerIslandCells / perLayerIslandCount 재계산
    const perLayerCellsDown: Set<string>[] = new Array(nSlices);
    const perLayerCountDown: number[] = new Array(nSlices).fill(0);
    for (let i = 0; i < nSlices; i++) perLayerCellsDown[i] = new Set();
    for (let i = 0; i < nSlices; i++) {
      const orig = perLayerIslandCells[i];
      if (!orig || orig.size === 0) continue;
      const faceTouched = new Set<number>();
      for (const fc of sliceFaceCells[i]) {
        if (!orig.has(fc.cell)) continue;
        if (!islandFacesDown.has(fc.faceIndex)) continue;
        perLayerCellsDown[i].add(fc.cell);
        faceTouched.add(fc.faceIndex);
      }
      perLayerCountDown[i] = faceTouched.size;
    }
    // perLayerIslandComponents 필터링 — component 의 cells 중 하나라도
    //   down-facing 살아남은 cells (perLayerCellsDown) 에 있으면 유지, 없으면 제거.
    //   centroid/cellCount 는 원본 유지 (재라벨링 안 함 — 이전 minIslandCells 재적용 사고 회피).
    const perLayerCompDown: IslandComponent[][] = new Array(nSlices);
    for (let i = 0; i < nSlices; i++) perLayerCompDown[i] = [];
    for (let i = 0; i < nSlices; i++) {
      const comps = perLayerIslandComponents[i];
      const cellsArr = perLayerCompCells[i];
      const downCells = perLayerCellsDown[i];
      if (!comps || comps.length === 0 || downCells.size === 0) continue;
      for (let c = 0; c < comps.length; c++) {
        const localCells = cellsArr[c];
        let hasDown = false;
        for (const k of localCells) {
          if (downCells.has(k)) {
            hasDown = true;
            break;
          }
        }
        if (hasDown) perLayerCompDown[i].push(comps[c]);
      }
    }
    if (debugLayerSet.size > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[downFacingOnly] before=${islandFaces.size} faces → after=${islandFacesDown.size} faces`
      );
      for (const L of debugLayerSet) {
        const beforeCells = perLayerIslandCells[L]?.size ?? 0;
        const afterCells = perLayerCellsDown[L]?.size ?? 0;
        // eslint-disable-next-line no-console
        console.log(`   [L=${L}] island cells: ${beforeCells} → ${afterCells} (down-facing only)`);
      }
    }
    return {
      islandFaces: islandFacesDown,
      sliceCells,
      sliceFaceCells,
      perLayerIslandCells: perLayerCellsDown,
      perLayerIslandComponents: perLayerCompDown,
      perLayerIslandCount: perLayerCountDown,
      yMin,
      yMax,
      nSlices,
      layerHeight,
      cellSize,
      dSafe,
      prevLayers,
      cellAdjR,
    };
  }

  return {
    islandFaces,
    sliceCells,
    sliceFaceCells,
    perLayerIslandCells,
    perLayerIslandComponents,
    perLayerIslandCount,
    yMin,
    yMax,
    nSlices,
    layerHeight,
    cellSize,
    dSafe,
    prevLayers,
    cellAdjR,
  };
}
