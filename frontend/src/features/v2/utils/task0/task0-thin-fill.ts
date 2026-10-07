/**
 * Task0 얇은 부분 채움 — 행이 덮지 못한 곳의 중심선·점 도포 (규격서 v0.3.3 §3 (b)(c)(d)·§7 B안, Z1-b2)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c —
 *   §7 "얇은 부분 채움: 행이 덮지 못한 부분(폭 w~2w 띠, w 미만 벽·링)은 중심선을 따라 한 줄 도포",
 *   §3 (b) "w/2 안쪽 영역이 비는 가는 섬(서포트 기둥 끝 등)은 내부 한 점에 짧게 도포".
 * 설계: `docs/계획_Z1_task0출력_20261002.md` Z1-b2. 순서·트래블은 task0-fill-route.ts, 출력은 task0-gcode-writer.ts.
 *
 * 대상 찾기 — writer 자체 통계(narrowDropped 등)가 아니라 **커버리지 검사기**(task0-coverage
 *   checkTask0LayerCoverage, detail)가 돌려준 실패 성분(b 도포점 없는 섬, c·d 면적 ≥ w² 미덮임)을 대상으로 한다.
 *   판정과 채움이 같은 기준을 쓴다. (w 보다 얇은 Y 방향 벽은 행 구간이 0줄이라 writer 통계로는 안 보인다 — Z1-b1 검수.)
 *
 * 채움 경로 (회차마다, 실패 성분마다):
 *   0. (a) 비율만 실패하면 detail 에 대상이 없을 수 있어(면적 < w² 성분만 남은 작은 층) 침식 영역의 미덮임 성분을
 *      크기와 무관하게 검사기와 같은 규칙으로 따로 모은다(innerUncoveredTargets).
 *   1. 미도포 영역 U = 흰 픽셀 중 지금까지의 도포 선분(행 + 앞 회차 채움 + 판정에 안 세는 아주 짧은 행 구간)에서
 *      w/2 보다 먼 것 — 비드(폭 w)가 안 덮은 곳. 실패 성분의 가장 깊은 점(검사기 innerXMm/innerYMm)이 든 U 의
 *      8-연결 성분을 잡는다. 실패 픽셀(c: 0.75·w 밖, d: w 밖)은 늘 U 안이다. 같은 U 성분에 실패 성분이 여럿이면
 *      한 번만 처리한다. 가장 깊은 점이 U 밖이면(비드 아래인데 표본이 안 떨어진 섬) 그 점에 점 도포.
 *      (규격의 "행이 덮지 못한 부분의 중심선" = U 성분의 중심선. 검사기의 미덮임 성분(w 밖)만 세선화하면
 *      남은 띠 가장자리 한 줄을 따라가 버린다 — 예: 10.3 mm 상자 맨 위 0.3 mm 띠의 중심은 0.15 mm 안쪽.)
 *   2. 성분을 Zhang–Suen 세선화(Lü–Wang 수정 — 사선 띠 보존) → 8-이웃 그래프(계단 모양에서 대각 연결이 4-이웃 두 걸음과 겹치면 대각은 뺀다)
 *      → 끝점·분기점 사이 사슬로 추적, 분기점이 없는 고리는 닫힌 꺾은선. 분기점에 붙은 길이 < w/2 잔가지는 지운다
 *      (세선화가 모서리·인위 경계(비드 끝)에서 내는 잔가지 — 폭 w 미만 형상이면 반폭 이하라 w/2 면 넉넉하다).
 *   3. 남은 중심선 총길이 < w/2 이면 **점 도포**(가장 깊은 점에 X 방향 짧은 선분). 아니면 사슬마다
 *      Douglas–Peucker(허용 오차 = 피치 p) → 띠 경계 붙이기 → 최소 선분 길이 → 베드 µm.
 *   4. 다시 검사해 통과할 때까지 반복(상한 maxIterations). 칠한 곳은 U 에서 빠지므로 다음 회차는 남은 곳만 본다.
 *      그래도 실패면 pass=false 로 돌려준다(writer 가 층 실패로 남기고 gen 은 파일을 안 쓴다).
 *   (D1a 2재료) excludePolygonsBed 를 주면 흰 = 재료 영역(raster(polys) − raster(뺄 쪽)) — 대상 찾기·U·검사가 모두 그 영역.
 *
 * 문턱과 근거 (w = 도포폭, p = 투사 피치):
 *   - 점 도포 문턱 = 중심선 총길이 < w/2: 성분은 중심선 양옆으로 반폭씩 퍼져 있어 실제 크기 ≈ 중심선 + 폭이다.
 *     중심선이 w/2 미만이면 성분이 지름 약 w 원 안에 들어가 비드 하나(지름 w)로 덮인다. 세선화는 2×2 덩어리를
 *     통째로 지우므로 0.15 mm 기둥(2 픽셀 남짓) 같은 작은 섬은 중심선이 아예 없다 — 이것도 점 도포.
 *   - 점 도포 길이 = max(w/2, E 2 눈금 길이): 비드 지름 w 짜리 둥근 방울 하나 정도. 가운데 픽셀에 표본이 떨어지도록
 *     가장 깊은 픽셀 중심을 가운데로 둔다(검사기 표본 간격 p/2 → 가운데에서 p/4 안에 표본 하나 — 같은 픽셀).
 *     E 눈금(1e-5 mm)이 0 으로 반올림되지 않게 정확 E 가 2 눈금 이상인 길이를 하한으로(lh 0.1·K 165 면 0.066 mm).
 *   - 최소 선분 길이 = max(0.05 mm, E 1 눈금 길이 × 1.01): 정확 E 증분이 1 눈금 이상이면 잔차 이월로도 출력 E ≥ 1 눈금
 *     (round 는 단조라 round(a + d) ≥ round(a) + 1, d ≥ 1). 규격 Task0 질문 §5-6 의 E0.00000 줄을 채움에서는 만들지 않는다.
 *   - 띠 경계 붙이기: 꼭짓점이 띠 경계(층 최소 Y + k·w)에서 최소 선분 길이 안이면 경계 위로 옮긴다. 띠로 자를 때
 *     경계 근처 꼭짓점 때문에 아주 짧은 조각이 생기지 않게 — 옮김 거리 < 최소 선분 길이(lh ≥ 0.05 면 0.07 mm 미만)라
 *     덮임에는 거의 영향이 없고, 옮긴 뒤의 좌표로 다시 검사한다.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음.
 */
import {
  TASK0_COVERAGE_RULES,
  checkTask0LayerCoverage,
  labelTask0Components,
  stampTask0Coverage,
  type Task0CoverageComponent,
  type Task0DepositSegment,
  type Task0LayerCoverage,
} from './task0-coverage';
import { squaredDistanceTransform } from './task0-distance';
import { TASK0_DEFAULTS, bedToPixel, pixelCenterToBed } from './task0-frame';
import { rasterizeTask0Region, type Task0RasterFrame } from './task0-mask';
import type { Task0BedPolygon } from './task0-slice';

// ==================== 타입 ====================

/** 1 µm 격자 점 [x, y] (정수 µm, 베드 좌표) */
export type Task0UmPoint = [number, number];

export interface Task0ThinFillOptions {
  /** 도포폭 w (mm) */
  depositWidthMm: number;
  /** 도포 E 비율 (E mm / 도포 길이 mm) — E 가 0 으로 반올림되지 않을 최소 길이 계산용 */
  eRatePerMm: number;
  /** 띠 원점 = 층 단면 최소 Y (mm) — writer 행 위상과 같은 값 */
  bandOriginMm: number;
  frame?: Task0RasterFrame;
  /** 채움 회차 상한 (기본 4) */
  maxIterations?: number;
  /**
   * (D1a 2재료) 흰에서 뺄 단면 — 재료 영역 R_A = PA − PB 에서 채움을 찾는다(task0-mask rasterizeTask0Region).
   * 검사도 같은 영역으로(task0-coverage excludePolygonsBed). 없으면 지금과 같은 결과.
   */
  excludePolygonsBed?: readonly Task0BedPolygon[];
  /** (D1a 2재료) 넘침 기준 단면 — 합집합 PA ∪ PB (task0-coverage overflowPolygonsBed). 없으면 지금과 같은 결과 */
  overflowPolygonsBed?: readonly Task0BedPolygon[];
}

export interface Task0ThinFillResult {
  /** 중심선 꺾은선 (µm, 닫힌 고리는 첫 점 = 끝 점) */
  centerlines: Task0UmPoint[][];
  /** 점 도포 — X 방향 짧은 선분 [왼쪽, 오른쪽] (µm) */
  dots: Task0UmPoint[][];
  /** 채움을 만든 회차 수 (0 = 행만으로 통과) */
  iterations: number;
  /** 행 + 채움으로 커버리지 통과 */
  pass: boolean;
  /** 마지막 검사 결과 */
  coverage: Task0LayerCoverage;
}

// ==================== 상수 ====================

const UM_PER_MM = 1000;
/** E 한 눈금 (mm) — writer 의 E 소수 5자리 */
const E_TICK_MM = 1e-5;
/** 최소 선분 길이 하한 (mm) */
const MIN_SEGMENT_FLOOR_MM = 0.05;
/** 채움 회차 상한 기본값 */
const DEFAULT_MAX_ITERATIONS = 4;
/** 잔가지 지우기 반복 상한 */
const PRUNE_ROUNDS = 10;

// ==================== 띠 ====================

/**
 * 띠 번호 — 띠 k = [원점 + k·w, 원점 + (k+1)·w). 행 k(y = 원점 + (k+0.5)·w)가 띠 k 의 가운데.
 * 검증 스크립트(verify-task0-writer c5)가 같은 식으로 다시 계산한다 — 식을 바꾸면 양쪽을 같이.
 */
export function task0BandOf(yMm: number, bandOriginMm: number, depositWidthMm: number): number {
  return Math.floor((yMm - bandOriginMm) / depositWidthMm);
}

/** 도포 선분의 띠 = 중점 y 의 띠 (µm 끝점 → mm 로 바꾼 뒤 중점 — G-code 를 읽은 값과 같은 double) */
export function task0SegmentBand(aYUm: number, bYUm: number, bandOriginMm: number, depositWidthMm: number): number {
  return task0BandOf((aYUm / UM_PER_MM + bYUm / UM_PER_MM) / 2, bandOriginMm, depositWidthMm);
}

/** 채움 최소 선분 길이 (mm) — 정확 E 증분이 1 눈금 이상 */
export function task0MinFillSegmentMm(eRatePerMm: number): number {
  return Math.max(MIN_SEGMENT_FLOOR_MM, (E_TICK_MM / eRatePerMm) * 1.01);
}

/** 점 도포 길이 (mm) */
export function task0DotLengthMm(depositWidthMm: number, eRatePerMm: number): number {
  return Math.max(depositWidthMm / 2, (2 * E_TICK_MM) / eRatePerMm);
}

/** mm → 1 µm 격자 정수 (writer toUm 과 같은 식) */
function toUm(mm: number): number {
  const u = Math.round(mm * UM_PER_MM);
  return u === 0 ? 0 : u;
}

// ==================== 세선화·추적 ====================

/** 잘라낸 성분 그림 — 가장자리 1칸은 항상 0 */
interface Crop {
  img: Uint8Array;
  cw: number;
  ch: number;
  /** 그림 (0,0) 칸 = ROI 칸 (i0, j0) */
  i0: number;
  j0: number;
}

/**
 * Zhang–Suen 세선화 (제자리) — 8-이웃 P2(위)부터 시계 방향 P3…P9. 이웃 수 조건은 Lü–Wang(1986) 수정판 3 ≤ B ≤ 6:
 * 원판(2 ≤ B)은 폭이 짝수 픽셀인 45° 띠를 두 겹 계단으로 줄인 뒤 양 끝에서 한 칸씩 갉아 통째로 지운다
 * (0.3 mm 사선 막대 X 자에서 실측 — 204 픽셀 팔이 2 픽셀만 남음). B ≥ 3 이면 두 겹 계단이 남고, 추적은 그것을
 * 4-연결 계단 경로로 따라가 Douglas–Peucker 가 곧은 선으로 편다.
 */
function thinZhangSuen(img: Uint8Array, cw: number, ch: number): void {
  const del: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 1; y < ch - 1; y++) {
        for (let x = 1; x < cw - 1; x++) {
          const k = y * cw + x;
          if (img[k] === 0) continue;
          const p2 = img[k - cw];
          const p3 = img[k - cw + 1];
          const p4 = img[k + 1];
          const p5 = img[k + cw + 1];
          const p6 = img[k + cw];
          const p7 = img[k + cw - 1];
          const p8 = img[k - 1];
          const p9 = img[k - cw - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 3 || b > 6) continue;
          const a =
            (p2 === 0 && p3 === 1 ? 1 : 0) +
            (p3 === 0 && p4 === 1 ? 1 : 0) +
            (p4 === 0 && p5 === 1 ? 1 : 0) +
            (p5 === 0 && p6 === 1 ? 1 : 0) +
            (p6 === 0 && p7 === 1 ? 1 : 0) +
            (p7 === 0 && p8 === 1 ? 1 : 0) +
            (p8 === 0 && p9 === 1 ? 1 : 0) +
            (p9 === 0 && p2 === 1 ? 1 : 0);
          if (a !== 1) continue;
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
          del.push(k);
        }
      }
      for (const k of del) img[k] = 0;
      if (del.length > 0) changed = true;
    }
  }
}

/** 4-이웃 다음 대각 — 순서 고정(결정성) */
const NEIGHBOR_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 뼈대 칸 k 의 연결 이웃 — 대각은 두 칸이 공유하는 4-이웃이 뼈대면 뺀다(계단의 삼각 연결 제거) */
function skeletonLinks(img: Uint8Array, cw: number, k: number): number[] {
  const x = k % cw;
  const y = (k - x) / cw;
  const out: number[] = [];
  for (const [dx, dy] of NEIGHBOR_STEPS) {
    const q = (y + dy) * cw + (x + dx);
    if (img[q] === 0) continue;
    if (dx !== 0 && dy !== 0 && (img[y * cw + x + dx] !== 0 || img[(y + dy) * cw + x] !== 0)) continue;
    out.push(q);
  }
  return out;
}

/** 뼈대 사슬 — 끝점·분기점(연결 수 ≠ 2) 사이, 또는 닫힌 고리(첫 칸 = 끝 칸), 외톨이 칸은 [k] */
function traceSkeleton(img: Uint8Array, cw: number): { chains: number[][]; degree: Map<number, number> } {
  const cells: number[] = [];
  for (let k = 0; k < img.length; k++) if (img[k] !== 0) cells.push(k);
  const links = new Map<number, number[]>();
  const degree = new Map<number, number>();
  for (const k of cells) {
    const l = skeletonLinks(img, cw, k);
    links.set(k, l);
    degree.set(k, l.length);
  }
  const used = new Set<number>();
  const n = img.length;
  const edgeKey = (a: number, b: number): number => (a < b ? a * n + b : b * n + a);
  const chains: number[][] = [];
  const walk = (start: number, next: number): void => {
    const chain = [start, next];
    used.add(edgeKey(start, next));
    let prev = start;
    let cur = next;
    while (degree.get(cur) === 2 && cur !== start) {
      const nb = (links.get(cur) as number[]).find((q) => q !== prev && !used.has(edgeKey(cur, q)));
      if (nb === undefined) break;
      used.add(edgeKey(cur, nb));
      chain.push(nb);
      prev = cur;
      cur = nb;
    }
    chains.push(chain);
  };
  for (const k of cells) {
    const d = degree.get(k) as number;
    if (d === 0) chains.push([k]);
    if (d === 2 || d === 0) continue;
    for (const q of links.get(k) as number[]) if (!used.has(edgeKey(k, q))) walk(k, q);
  }
  // 분기점 없는 고리
  for (const k of cells) {
    if (degree.get(k) !== 2) continue;
    for (const q of links.get(k) as number[]) if (!used.has(edgeKey(k, q))) walk(k, q);
  }
  return { chains, degree };
}

/** 사슬 길이 (mm) — 칸 걸음 p 또는 p√2 */
function chainLengthMm(chain: number[], cw: number, p: number): number {
  let len = 0;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    const dx = Math.abs((a % cw) - (b % cw));
    const dy = Math.abs(Math.floor(a / cw) - Math.floor(b / cw));
    len += dx !== 0 && dy !== 0 ? p * Math.SQRT2 : p;
  }
  return len;
}

/** 세선화 + 잔가지 지우기 → 사슬들 (그림 칸 번호) */
function skeletonChains(crop: Crop, spurMm: number, p: number): number[][] {
  const { img, cw, ch } = crop;
  thinZhangSuen(img, cw, ch);
  for (let round = 0; round < PRUNE_ROUNDS; round++) {
    const { chains, degree } = traceSkeleton(img, cw);
    let removed = false;
    for (const chain of chains) {
      if (chain.length < 2) continue;
      const d0 = degree.get(chain[0]) as number;
      const d1 = degree.get(chain[chain.length - 1]) as number;
      const spur = (d0 === 1 && d1 >= 3) || (d1 === 1 && d0 >= 3);
      if (!spur || chainLengthMm(chain, cw, p) >= spurMm) continue;
      const keep = d0 >= 3 ? chain[0] : chain[chain.length - 1];
      for (const k of chain) if (k !== keep) img[k] = 0;
      removed = true;
    }
    if (!removed) return chains;
  }
  return traceSkeleton(img, cw).chains;
}

// ==================== 꺾은선 ====================

type MmPoint = [number, number];

/** 점 P 에서 선분 AB 까지 거리 */
function pointSegmentDistance(p: MmPoint, a: MmPoint, b: MmPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker (열린 꺾은선, 양 끝 유지) */
function simplifyOpen(pts: MmPoint[], eps: number): MmPoint[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop() as [number, number];
    let best = -1;
    let bestD = eps;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegmentDistance(pts[i], pts[s], pts[e]);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** Douglas–Peucker — 닫힌 고리(첫 점 = 끝 점)는 첫 점에서 가장 먼 점으로 둘로 나눠 각각 */
function simplifyPolyline(pts: MmPoint[], eps: number): MmPoint[] {
  const closed = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  if (!closed) return simplifyOpen(pts, eps);
  let far = 1;
  let farD = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), eps);
  const b = simplifyOpen(pts.slice(far), eps);
  return a.concat(b.slice(1));
}

/** 띠 경계에서 snapMm 안인 y 를 경계 위로 */
function snapToBand(y: number, origin: number, w: number, snapMm: number): number {
  const by = origin + Math.round((y - origin) / w) * w;
  return Math.abs(y - by) < snapMm ? by : y;
}

/**
 * mm 꺾은선 → µm 꺾은선: 띠 경계 붙이기 → µm → 같은 점 합치기 → 최소 선분 길이(가운데 꼭짓점을 뺌, 양 끝 유지).
 * 너무 짧아 한 선분도 못 남으면 null.
 */
function finishPolyline(pts: MmPoint[], origin: number, w: number, minSegMm: number): Task0UmPoint[] | null {
  const um: Task0UmPoint[] = [];
  for (const [x, y] of pts) {
    const q: Task0UmPoint = [toUm(x), toUm(snapToBand(y, origin, w, minSegMm))];
    const last = um.length > 0 ? um[um.length - 1] : null;
    if (last === null || last[0] !== q[0] || last[1] !== q[1]) um.push(q);
  }
  if (um.length < 2) return null;
  const minUm = minSegMm * UM_PER_MM;
  const len = (a: Task0UmPoint, b: Task0UmPoint): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const out: Task0UmPoint[] = [um[0]];
  for (let i = 1; i < um.length - 1; i++) {
    if (len(out[out.length - 1], um[i]) >= minUm) out.push(um[i]);
  }
  const end = um[um.length - 1];
  // 끝 선분이 짧으면 바로 앞 꼭짓점을 빼고 끝 점에 잇는다 (양 끝은 이웃 사슬·성분 경계와 맞닿는 자리라 유지)
  while (out.length > 1 && len(out[out.length - 1], end) < minUm) out.pop();
  out.push(end);
  if (out.length < 2 || len(out[0], out[1]) < minUm) return null;
  return out;
}

// ==================== 회차 ====================

/**
 * (a) 비율만 실패할 때의 대상 — 검사기 detail 은 면적 ≥ w² 성분만 주므로, 작은 층(침식 영역이 픽셀 수십 개)에서
 * 몇 픽셀이 비어 비율이 99.9 % 밑으로 내려가면 고칠 대상이 안 보인다. 검사기와 같은 규칙(TASK0_COVERAGE_RULES:
 * 침식 = 비흰까지 EDT − p/2 ≥ w/2, 덮임 0.75·w, 4-연결)으로 침식 영역의 미덮임 성분을 크기와 무관하게 모아
 * 성분마다 가장 깊은 픽셀을 돌려준다(그 점만 쓴다 — 다른 칸은 0).
 */
function innerUncoveredTargets(
  polys: readonly Task0BedPolygon[],
  exclude: readonly Task0BedPolygon[],
  segments: readonly Task0DepositSegment[],
  w: number,
  frame: Task0RasterFrame,
): Task0CoverageComponent[] {
  const rules = TASK0_COVERAGE_RULES;
  const p = frame.pixelPitchUm / UM_PER_MM;
  const mask = rasterizeTask0Region(polys, exclude, { frame, roi: 'bbox', marginPx: 2 });
  const roi = { col0: mask.col0, row0: mask.row0, width: mask.width, height: mask.height };
  const nPix = roi.width * roi.height;
  if (nPix === 0) return [];
  const d2 = squaredDistanceTransform(mask.data, roi.width, roi.height, 0);
  const thr = (rules.erosionFactor * w) / p + 0.5;
  const cov = new Uint8Array(nPix);
  stampTask0Coverage(segments, rules.innerRadiusFactor * w, roi, cov, frame);
  const unc = new Uint8Array(nPix);
  for (let k = 0; k < nPix; k++) {
    if (mask.data[k] !== 0 && d2[k] >= thr * thr && cov[k] === 0) unc[k] = 1;
  }
  const comp = labelTask0Components(unc, roi.width, roi.height, rules.holeConnectivity);
  const bestK = new Int32Array(comp.count + 1).fill(-1);
  for (let k = 0; k < nPix; k++) {
    const l = comp.labels[k];
    if (l !== 0 && (bestK[l] < 0 || d2[k] > d2[bestK[l]])) bestK[l] = k;
  }
  const out: Task0CoverageComponent[] = [];
  for (let l = 1; l <= comp.count; l++) {
    const k = bestK[l];
    const i = k % roi.width;
    const j = (k - i) / roi.width;
    const [x, y] = pixelCenterToBed(roi.col0 + i, roi.row0 + j, frame);
    out.push({
      pixels: comp.sizes[l],
      areaMm2: comp.sizes[l] * p * p,
      xMinMm: x,
      xMaxMm: x,
      yMinMm: y,
      yMaxMm: y,
      innerXMm: x,
      innerYMm: y,
      innerDepthMm: Math.sqrt(d2[k]) * p - p / 2,
    });
  }
  return out;
}

/** 회차 하나 — 실패 성분마다 중심선 또는 점 도포 */
function fillOnce(
  polys: readonly Task0BedPolygon[],
  segments: readonly Task0DepositSegment[],
  targets: readonly Task0CoverageComponent[],
  opts: Required<Omit<Task0ThinFillOptions, 'maxIterations' | 'overflowPolygonsBed'>>,
  dotKeys: Set<string>,
): { centerlines: Task0UmPoint[][]; dots: Task0UmPoint[][] } {
  const { frame, depositWidthMm: w, bandOriginMm: origin } = opts;
  const p = frame.pixelPitchUm / UM_PER_MM;
  const minSegMm = task0MinFillSegmentMm(opts.eRatePerMm);
  const dotHalfUm = Math.round((task0DotLengthMm(w, opts.eRatePerMm) * UM_PER_MM) / 2);
  const mask = rasterizeTask0Region(polys, opts.excludePolygonsBed, { frame, roi: 'bbox', marginPx: 2 });
  const roi = { col0: mask.col0, row0: mask.row0, width: mask.width, height: mask.height };
  const nPix = roi.width * roi.height;
  const bead = new Uint8Array(nPix);
  stampTask0Coverage(segments, w / 2, roi, bead, frame);
  const free = new Uint8Array(nPix);
  for (let k = 0; k < nPix; k++) free[k] = mask.data[k] !== 0 && bead[k] === 0 ? 1 : 0;
  const owner = new Int32Array(nPix);
  let compCount = 0;

  const centerlines: Task0UmPoint[][] = [];
  const dots: Task0UmPoint[][] = [];
  // (D1a 2재료) 뺄 단면(다른 재료 PB)이 있으면 점 도포 끝이 그 영역 픽셀 안으로 들어가지 않게 줄인다 — 재료 경계에 붙은 가는
  //   조각의 점 도포(길이 w/2)가 B 우선 영역으로 최대 w/4 파고들던 것(리뷰 재작업 — 구 + 기둥에서 실측 0.11 mm). 가운데는 그대로,
  //   양 끝을 픽셀 한 칸씩 안으로, 최소 길이(E 2 눈금)까지. 단일 재료는 뺄 단면이 없어 그대로다.
  const exMask =
    opts.excludePolygonsBed.length > 0 ? rasterizeTask0Region(opts.excludePolygonsBed, [], { frame, roi }).data : null;
  const inExclude = (xUm: number, yUm: number): boolean => {
    if (exMask === null) return false;
    const [c, r] = bedToPixel(xUm / UM_PER_MM, yUm / UM_PER_MM, frame);
    const i = c - roi.col0;
    const j = r - roi.row0;
    return i >= 0 && j >= 0 && i < roi.width && j < roi.height && exMask[j * roi.width + i] !== 0;
  };
  const minDotHalfUm = Math.ceil(((2 * E_TICK_MM) / opts.eRatePerMm / 2) * UM_PER_MM);
  const stepUm = Math.max(1, Math.round(p * UM_PER_MM));
  const addDot = (t: Task0CoverageComponent): void => {
    const cx = toUm(t.innerXMm);
    const cy = toUm(t.innerYMm);
    const key = `${cx},${cy}`;
    if (dotKeys.has(key)) return;
    dotKeys.add(key);
    let left = dotHalfUm;
    let right = dotHalfUm;
    while (left > minDotHalfUm && inExclude(cx - left, cy)) left = Math.max(minDotHalfUm, left - stepUm);
    while (right > minDotHalfUm && inExclude(cx + right, cy)) right = Math.max(minDotHalfUm, right - stepUm);
    dots.push([
      [cx - left, cy],
      [cx + right, cy],
    ]);
  };

  for (const t of targets) {
    const [c, r] = bedToPixel(t.innerXMm, t.innerYMm, frame);
    const i = c - roi.col0;
    const j = r - roi.row0;
    const seed = i >= 0 && j >= 0 && i < roi.width && j < roi.height ? j * roi.width + i : -1;
    if (seed < 0 || free[seed] === 0) {
      addDot(t); // 비드 아래인데 표본이 안 떨어진 섬 등 — U 성분이 없으면 점 도포
      continue;
    }
    if (owner[seed] !== 0) continue; // 같은 U 성분을 이미 처리
    // U 의 8-연결 성분
    compCount++;
    const pixels: number[] = [seed];
    owner[seed] = compCount;
    let iMin = i;
    let iMax = i;
    let jMin = j;
    let jMax = j;
    for (let s = 0; s < pixels.length; s++) {
      const k = pixels[s];
      const ki = k % roi.width;
      const kj = (k - ki) / roi.width;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = ki + di;
          const nj = kj + dj;
          if (ni < 0 || nj < 0 || ni >= roi.width || nj >= roi.height) continue;
          const q = nj * roi.width + ni;
          if (free[q] === 0 || owner[q] !== 0) continue;
          owner[q] = compCount;
          pixels.push(q);
          if (ni < iMin) iMin = ni;
          if (ni > iMax) iMax = ni;
          if (nj < jMin) jMin = nj;
          if (nj > jMax) jMax = nj;
        }
      }
    }
    // 잘라낸 그림 (가장자리 1칸 여유)
    const crop: Crop = {
      cw: iMax - iMin + 3,
      ch: jMax - jMin + 3,
      i0: iMin - 1,
      j0: jMin - 1,
      img: new Uint8Array((iMax - iMin + 3) * (jMax - jMin + 3)),
    };
    for (const k of pixels) {
      const ki = k % roi.width;
      const kj = (k - ki) / roi.width;
      crop.img[(kj - crop.j0) * crop.cw + (ki - crop.i0)] = 1;
    }
    const chains = skeletonChains(crop, w / 2, p);
    let total = 0;
    for (const chain of chains) total += chainLengthMm(chain, crop.cw, p);
    if (total < w / 2) {
      addDot(t);
      continue;
    }
    for (const chain of chains) {
      if (chain.length < 2) continue;
      const pts: MmPoint[] = chain.map((k) => {
        const ci = k % crop.cw;
        const cj = (k - ci) / crop.cw;
        return pixelCenterToBed(roi.col0 + crop.i0 + ci, roi.row0 + crop.j0 + cj, frame);
      });
      const line = finishPolyline(simplifyPolyline(pts, p), origin, w, minSegMm);
      if (line !== null) centerlines.push(line);
    }
  }
  return { centerlines, dots };
}

/** µm 꺾은선 → 도포 선분 (검사기 입력) */
export function task0PolylineSegments(pts: readonly Task0UmPoint[]): Task0DepositSegment[] {
  const out: Task0DepositSegment[] = [];
  for (let i = 1; i < pts.length; i++) {
    out.push({
      x0: pts[i - 1][0] / UM_PER_MM,
      y0: pts[i - 1][1] / UM_PER_MM,
      x1: pts[i][0] / UM_PER_MM,
      y1: pts[i][1] / UM_PER_MM,
      e: 1,
      tool: 0,
    });
  }
  return out;
}

/**
 * 층 하나의 얇은 부분 채움 — 행(baseSegments)만으로 커버리지를 통과하면 채움 없이 iterations 0 으로 돌려준다.
 * @param polys 층 단면 (task0LayerPolygonsBed — writer·검사기와 같은 단면)
 * @param baseSegments 행 도포 선분 (writer 가 낼 1 µm 격자 좌표 그대로) — 판정에 센다
 * @param uncountedSegments 실제로 내지만 판정에는 안 세는 선분(출력 E 가 0 일 수 있는 아주 짧은 행 구간 — writer).
 *   미도포 영역 U 에서는 칠한 것으로 뺀다: 중심선이 그 위를 지나면 그 줄을 칠한 뒤 노즐이 채움 비드 한가운데에 서게 돼
 *   어느 쪽으로 떠나도 c4(앞 w/2 뒤 w/2 이상) 를 못 지킨다.
 */
export function findTask0ThinFills(
  polys: readonly Task0BedPolygon[],
  baseSegments: readonly Task0DepositSegment[],
  options: Task0ThinFillOptions,
  uncountedSegments: readonly Task0DepositSegment[] = [],
): Task0ThinFillResult {
  const opts = {
    depositWidthMm: options.depositWidthMm,
    eRatePerMm: options.eRatePerMm,
    bandOriginMm: options.bandOriginMm,
    frame: options.frame ?? TASK0_DEFAULTS,
    excludePolygonsBed: options.excludePolygonsBed ?? [],
  };
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const check = (segs: readonly Task0DepositSegment[]): Task0LayerCoverage =>
    checkTask0LayerCoverage(polys, segs, {
      depositWidthMm: opts.depositWidthMm,
      frame: opts.frame,
      detail: true,
      excludePolygonsBed: options.excludePolygonsBed,
      overflowPolygonsBed: options.overflowPolygonsBed,
    });

  const segments: Task0DepositSegment[] = baseSegments.slice();
  const centerlines: Task0UmPoint[][] = [];
  const dots: Task0UmPoint[][] = [];
  const dotKeys = new Set<string>();
  let coverage = check(segments);
  let iterations = 0;
  while (!coverage.pass && iterations < maxIterations) {
    const u = coverage.uncovered;
    const targets = u ? [...u.b, ...u.c, ...u.d] : [];
    if (!coverage.a.pass) {
      targets.push(...innerUncoveredTargets(polys, opts.excludePolygonsBed, segments, opts.depositWidthMm, opts.frame));
    }
    if (targets.length === 0) break; // 넘침만 실패 — 채움으로 고칠 대상이 아님
    iterations++;
    const added = fillOnce(polys, segments.concat(uncountedSegments), targets, opts, dotKeys);
    if (added.centerlines.length === 0 && added.dots.length === 0) break;
    for (const line of added.centerlines) {
      centerlines.push(line);
      segments.push(...task0PolylineSegments(line));
    }
    for (const dot of added.dots) {
      dots.push(dot);
      segments.push(...task0PolylineSegments(dot));
    }
    coverage = check(segments);
  }
  return { centerlines, dots, iterations, pass: coverage.pass, coverage };
}
