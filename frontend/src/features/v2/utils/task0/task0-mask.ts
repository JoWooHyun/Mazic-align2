/**
 * Task0 마스크 래스터 — 투사 프레임(1920×1080, 피치 p, 시작 (10,10)) 위 0/1 마스크 (Z1-b1)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c — §1(투사 1920×1080·73 µm·시작 (10,10)),
 *   §3(도포 영역 = 노광 영역, 겹친 솔리드 nonzero 합집합), §11(열 0 = X 최소, 행 0 = Y 최대, 0/255).
 * 설계: `docs/계획_Z1_task0출력_20261002.md` S3·S4·§4(Z3 — 마스크는 "플레이트를 화면에 늘린" 기존 래스터가
 *   아니라 투사 프레임으로 그려야 도포·노광이 물리적으로 겹친다).
 *
 * 왜 기존 `utils/slice-rasterize.ts` 를 안 쓰나: 그쪽은 플레이트(W×D mm)를 화면 해상도에 늘려 그리고
 *   x 는 구간이 걸친 픽셀을 전부 칠한다(픽셀 중심 표본이 아님). Task0 는 픽셀 하나 = 베드 위 p×p 정사각이고
 *   시작점이 (10,10) 이라 좌표 변환부터 다르다. 채움 규칙(nonzero 감김)만 같다.
 *
 * 규칙:
 *   - 픽셀 (c, r) 중심 = task0-frame pixelCenterToBed(c, r) = (ox + (c+0.5)·p, oy + (H−r−0.5)·p). 중심이 단면 안이면 1.
 *   - 안/밖 = **nonzero 감김**: 행 높이 y(베드)에서 변과의 교차를 감김 부호와 함께 x 순으로 쌓아 감김수 ≠ 0 구간
 *     (writer 행 구간·slice-rasterize 와 같은 규칙 — 겹친 솔리드는 채움, 반대 감김 내벽은 구멍).
 *   - 반열림: 변은 **베드 Y 기준 [yLo, yHi)** 에서만 행과 만난다 — writer(task0-gcode-writer fillRows)와 같은 쪽.
 *     그래서 행(writer)·픽셀 행(마스크)이 꼭짓점을 정확히 지날 때 둘 다 위쪽(+Y) 단면을 택해 같은 판정을 낸다.
 *     (계획서 §4 의 "래스터는 픽셀 y 기준이라 (lo, hi]" 어긋남이 이 모듈에서는 없다.)
 *     x 도 [시작, 끝) — 중심이 구간 시작과 같으면 안, 끝과 같으면 밖(task0-frame bedToPixel 의 [시작, 끝) 과 같은 쪽).
 *   - 투사 프레임 밖 픽셀은 항상 0 이고, 단면 안이지만 프레임 밖이라 잘린 픽셀 중심 수를 clippedPixels 로 돌려준다
 *     (출력 가능 영역 검사는 Z2 몫 — 여기서는 사실만 알린다).
 *   - ROI: 'full'(기본, 1920×1080 전체 — Z3 PNG 용) / 'bbox'(단면 bbox 를 덮는 픽셀 + marginPx — 검사 속도용) /
 *     직접 지정. ROI 는 프레임 밖으로 나가도 된다(그 칸은 0 — 커버리지 검사기가 "프레임 밖 = 비흰" 으로 쓴다).
 *   - (D1a) 재료 영역 rasterizeTask0Region = 한 재료 마스크에서 다른 재료 마스크를 뺀 것(2재료 우선순위 차집합).
 *     층 노광 PNG 는 여전히 두 재료 합집합 PA ∪ PB 한 장(rasterizeTask0Mask 에 모든 메시 단면) — LED 는 하나다.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음.
 */
import { TASK0_DEFAULTS, pixelCenterToBed, type Task0Defaults } from './task0-frame';
import type { Task0BedPolygon } from './task0-slice';

/** 래스터에 필요한 투사 값 (가로·세로 픽셀 수, 피치, 시작점) */
export type Task0RasterFrame = Pick<
  Task0Defaults,
  'projectorWidthPx' | 'projectorHeightPx' | 'pixelPitchUm' | 'projectorOffsetXMm' | 'projectorOffsetYMm'
>;

/** 픽셀 직사각 영역 — 투사 프레임 픽셀 번호 기준 (col0·row0 은 음수·프레임 초과 가능) */
export interface Task0PixelRoi {
  col0: number;
  row0: number;
  width: number;
  height: number;
}

export interface Task0MaskOptions {
  frame?: Task0RasterFrame;
  /** 'full' = 프레임 전체(기본), 'bbox' = 단면 bbox 를 덮는 픽셀 + marginPx, 또는 직접 지정 */
  roi?: 'full' | 'bbox' | Task0PixelRoi;
  /** roi 'bbox' 일 때 사방 여유 픽셀 (기본 0) */
  marginPx?: number;
}

export interface Task0Mask extends Task0PixelRoi {
  /** 행 우선 0/1 (길이 width·height). 칸 (i, j) = 프레임 픽셀 (col0 + i, row0 + j). 프레임 밖 칸은 항상 0 */
  data: Uint8Array;
  /** ROI 안 1 인 칸 수 */
  whitePixels: number;
  /** 단면 안이지만 투사 프레임 밖이라 잘린 픽셀 중심 수 — 단면 전체 기준(ROI 와 무관) */
  clippedPixels: number;
}

/** 래스터 변 — 베드 좌표, 감김 부호는 베드 Y 가 늘어나는 변이 +1 (writer ScanEdge 와 같은 꼴) */
interface MaskEdge {
  yLo: number;
  yHi: number;
  xAtLo: number;
  dxPerY: number;
  dir: 1 | -1;
}

/** 프레임 값 검사 + 피치(mm) */
function framePitchMm(frame: Task0RasterFrame): number {
  const { projectorWidthPx: W, projectorHeightPx: H, pixelPitchUm } = frame;
  if (!Number.isInteger(W) || W <= 0 || !Number.isInteger(H) || H <= 0) {
    throw new RangeError(`투사 픽셀 수는 양의 정수여야 함 (받은 값: ${W}×${H})`);
  }
  if (!Number.isFinite(pixelPitchUm) || pixelPitchUm <= 0) {
    throw new RangeError(`pixelPitchUm 은 양의 유한 수여야 함 (받은 값: ${pixelPitchUm})`);
  }
  return pixelPitchUm / 1000;
}

/** 픽셀 열 c 의 중심 베드 X — pixelCenterToBed 와 같은 식 */
function colCenterX(c: number, frame: Task0RasterFrame): number {
  return pixelCenterToBed(c, 0, frame)[0];
}

/** 픽셀 행 r 의 중심 베드 Y — pixelCenterToBed 와 같은 식 */
function rowCenterY(r: number, frame: Task0RasterFrame): number {
  return pixelCenterToBed(0, r, frame)[1];
}

/** 중심 X ≥ x 인 가장 작은 열 (식으로 어림한 뒤 중심 좌표로 바로잡아 반올림 경계를 정확히) */
function firstColAtOrAfter(x: number, frame: Task0RasterFrame, p: number): number {
  let c = Math.ceil((x - frame.projectorOffsetXMm) / p - 0.5);
  while (colCenterX(c, frame) < x) c++;
  while (colCenterX(c - 1, frame) >= x) c--;
  return c;
}

/** 중심 Y ≥ y 인 가장 큰 행 (행 번호가 클수록 Y 가 작다) */
function lastRowAtOrAbove(y: number, frame: Task0RasterFrame, p: number): number {
  const H = frame.projectorHeightPx;
  let r = Math.floor(H - 0.5 - (y - frame.projectorOffsetYMm) / p);
  while (rowCenterY(r, frame) < y) r--;
  while (rowCenterY(r + 1, frame) >= y) r++;
  return r;
}

/** 중심 Y ≤ y 인 가장 작은 행 */
function firstRowAtOrBelow(y: number, frame: Task0RasterFrame, p: number): number {
  const H = frame.projectorHeightPx;
  let r = Math.ceil(H - 0.5 - (y - frame.projectorOffsetYMm) / p);
  while (rowCenterY(r, frame) > y) r++;
  while (rowCenterY(r - 1, frame) <= y) r--;
  return r;
}

/** 중심 X ≤ x 인 가장 큰 열 */
function lastColAtOrBefore(x: number, frame: Task0RasterFrame, p: number): number {
  let c = Math.floor((x - frame.projectorOffsetXMm) / p - 0.5);
  while (colCenterX(c, frame) > x) c--;
  while (colCenterX(c + 1, frame) <= x) c++;
  return c;
}

/** 중심 X 가 닫힌 구간 [xLo, xHi] 안인 열 [첫, 끝] — 없으면 끝 < 첫 */
export function task0ColsWithin(
  xLo: number,
  xHi: number,
  frame: Task0RasterFrame = TASK0_DEFAULTS,
): [number, number] {
  const p = framePitchMm(frame);
  return [firstColAtOrAfter(xLo, frame, p), lastColAtOrBefore(xHi, frame, p)];
}

/** 중심 Y 가 닫힌 구간 [yLo, yHi] 안인 행 [위(번호 작음), 아래] — 없으면 아래 < 위 */
export function task0RowsWithin(
  yLo: number,
  yHi: number,
  frame: Task0RasterFrame = TASK0_DEFAULTS,
): [number, number] {
  const p = framePitchMm(frame);
  return [firstRowAtOrBelow(yHi, frame, p), lastRowAtOrAbove(yLo, frame, p)];
}

/**
 * 베드 bbox 를 덮는 픽셀 ROI — 중심이 [xMin, xMax] × [yMin, yMax] 안인 픽셀 + 사방 marginPx.
 * bbox 안에 중심이 하나도 없으면(아주 작은 단면) 가장 가까운 한 칸 폭을 잡는다.
 */
export function task0RoiForBedBox(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  marginPx = 0,
  frame: Task0RasterFrame = TASK0_DEFAULTS,
): Task0PixelRoi {
  const p = framePitchMm(frame);
  const m = Math.max(0, Math.ceil(marginPx));
  const c0 = firstColAtOrAfter(xMin, frame, p);
  const c1 = Math.max(c0, lastColAtOrBefore(xMax, frame, p));
  const r0 = firstRowAtOrBelow(yMax, frame, p); // 중심 ≤ yMax 인 가장 위 행
  const r1 = Math.max(r0, lastRowAtOrAbove(yMin, frame, p)); // 중심 ≥ yMin 인 가장 아래 행
  return { col0: c0 - m, row0: r0 - m, width: c1 - c0 + 1 + 2 * m, height: r1 - r0 + 1 + 2 * m };
}

/** 폴리곤들 → 변 목록(yLo 오름차순) + bbox */
function buildEdges(polygons: readonly Task0BedPolygon[]): {
  edges: MaskEdge[];
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  const edges: MaskEdge[] = [];
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pts of polygons) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a[0] < xMin) xMin = a[0];
      if (a[0] > xMax) xMax = a[0];
      if (a[1] < yMin) yMin = a[1];
      if (a[1] > yMax) yMax = a[1];
      if (a[1] === b[1]) continue; // 수평 변은 행 교차에 기여 없음 (writer·slice-rasterize 와 같음)
      const rising = a[1] < b[1];
      const lo = rising ? a : b;
      const hi = rising ? b : a;
      edges.push({
        yLo: lo[1],
        yHi: hi[1],
        xAtLo: lo[0],
        dxPerY: (b[0] - a[0]) / (b[1] - a[1]),
        dir: rising ? 1 : -1,
      });
    }
  }
  edges.sort((p, q) => p.yLo - q.yLo);
  return { edges, xMin, xMax, yMin, yMax };
}

/**
 * 단면 폴리곤(베드 좌표) → Task0 투사 프레임 0/1 마스크.
 * @param polygonsBed task0LayerPolygonsBed 결과 (점 순서 = 감김, 그대로)
 */
export function rasterizeTask0Mask(
  polygonsBed: readonly Task0BedPolygon[],
  options: Task0MaskOptions = {},
): Task0Mask {
  const frame = options.frame ?? TASK0_DEFAULTS;
  const p = framePitchMm(frame);
  const W = frame.projectorWidthPx;
  const H = frame.projectorHeightPx;
  const { edges, xMin, xMax, yMin, yMax } = buildEdges(polygonsBed);
  const hasShape = edges.length > 0;

  let roi: Task0PixelRoi;
  const roiOpt = options.roi ?? 'full';
  if (roiOpt === 'full') roi = { col0: 0, row0: 0, width: W, height: H };
  else if (roiOpt === 'bbox') {
    roi = hasShape
      ? task0RoiForBedBox(xMin, xMax, yMin, yMax, options.marginPx ?? 0, frame)
      : { col0: 0, row0: 0, width: 0, height: 0 };
  } else {
    if (![roiOpt.col0, roiOpt.row0, roiOpt.width, roiOpt.height].every(Number.isInteger) || roiOpt.width < 0 || roiOpt.height < 0) {
      throw new RangeError(`ROI 는 정수·크기 0 이상이어야 함 (받은 값: ${JSON.stringify(roiOpt)})`);
    }
    roi = { col0: roiOpt.col0, row0: roiOpt.row0, width: roiOpt.width, height: roiOpt.height };
  }

  const data = new Uint8Array(roi.width * roi.height);
  let whitePixels = 0;
  let clippedPixels = 0;
  if (!hasShape) return { ...roi, data, whitePixels, clippedPixels };

  // 단면 bbox 를 덮는 픽셀 행 전부(프레임 밖 포함)를 아래(Y 작음 = 행 번호 큼)에서 위로 훑는다.
  // 행마다 활성 변 = yLo ≤ y < yHi (베드 Y 반열림 — writer 와 같은 쪽).
  const rowBottom = lastRowAtOrAbove(yMin, frame, p); // 중심 ≥ yMin 인 가장 아래 행
  const rowTop = firstRowAtOrBelow(yMax, frame, p); // 중심 ≤ yMax 인 가장 위 행
  let next = 0;
  let active: MaskEdge[] = [];
  const hits: { x: number; dir: 1 | -1 }[] = [];
  for (let r = rowBottom; r >= rowTop; r--) {
    const y = rowCenterY(r, frame);
    while (next < edges.length && edges[next].yLo <= y) active.push(edges[next++]);
    active = active.filter((e) => y >= e.yLo && y < e.yHi);
    if (active.length === 0) continue;
    hits.length = 0;
    for (const e of active) hits.push({ x: e.xAtLo + e.dxPerY * (y - e.yLo), dir: e.dir });
    hits.sort((a, b) => a.x - b.x);

    const rowInFrame = r >= 0 && r < H;
    const j = r - roi.row0;
    const rowInRoi = j >= 0 && j < roi.height;
    let winding = 0;
    for (let i = 0; i + 1 < hits.length; i++) {
      winding += hits[i].dir;
      if (winding === 0) continue;
      // 감김수 ≠ 0 구간 [hits[i].x, hits[i+1].x) — 중심이 이 안인 열
      const c0 = firstColAtOrAfter(hits[i].x, frame, p);
      const c1 = firstColAtOrAfter(hits[i + 1].x, frame, p) - 1;
      if (c1 < c0) continue;
      // 프레임 밖 개수 (잘림 통계)
      if (!rowInFrame) clippedPixels += c1 - c0 + 1;
      else {
        if (c0 < 0) clippedPixels += Math.min(c1, -1) - c0 + 1;
        if (c1 >= W) clippedPixels += c1 - Math.max(c0, W) + 1;
      }
      if (!rowInFrame || !rowInRoi) continue;
      const a = Math.max(c0, 0, roi.col0);
      const b = Math.min(c1, W - 1, roi.col0 + roi.width - 1);
      const off = j * roi.width - roi.col0;
      for (let c = a; c <= b; c++) {
        if (data[off + c] === 0) {
          data[off + c] = 1;
          whitePixels++;
        }
      }
    }
  }
  return { ...roi, data, whitePixels, clippedPixels };
}

/**
 * 재료 영역 마스크 (2재료 D1a) — raster(polygons) AND NOT raster(excludePolygons), 같은 ROI·같은 픽셀 중심 규칙.
 * 계획 `docs/계획_하이브리드슬라이서설정_20260928.md` §5-3 우선순위 차집합 R_A = PA − R_B 를 다각형 연산 없이 픽셀로 —
 *   writer 의 행 구간 차집합(A 구간 − B 구간, 같은 nonzero·반열림 규칙)과 같은 판정을 낸다.
 * excludePolygons 가 비면 rasterizeTask0Mask 결과 그대로(같은 객체). ROI 는 polygons 기준(options.roi) — 뺄 쪽은 그 ROI 로만 그린다.
 * clippedPixels 는 polygons 의 값 그대로(프레임 밖 통계 — 뺄 쪽에 덮인 잘린 픽셀도 센다).
 */
export function rasterizeTask0Region(
  polygonsBed: readonly Task0BedPolygon[],
  excludePolygonsBed: readonly Task0BedPolygon[],
  options: Task0MaskOptions = {},
): Task0Mask {
  const base = rasterizeTask0Mask(polygonsBed, options);
  if (excludePolygonsBed.length === 0 || base.whitePixels === 0) return base;
  const roi: Task0PixelRoi = { col0: base.col0, row0: base.row0, width: base.width, height: base.height };
  const ex = rasterizeTask0Mask(excludePolygonsBed, { frame: options.frame, roi });
  let whitePixels = 0;
  for (let k = 0; k < base.data.length; k++) {
    if (base.data[k] === 0) continue;
    if (ex.data[k] !== 0) base.data[k] = 0;
    else whitePixels++;
  }
  return { ...base, whitePixels };
}
