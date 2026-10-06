/**
 * Task0 채움 층의 도포 순서·트래블 — 띠 분해 + 우회 경로 (규격서 v0.3.3 §5·§7, Z1-b2)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c §7 —
 *   "도포는 파킹 (0,0)에서 멀어지는 +Y 방향 단조 진행", "도포한 영역을 가로지르는 트래블 금지 — 우회 경로",
 *   "층 안 Z-hop 금지". 설계: `docs/계획_Z1_task0출력_20261002.md` Z1-b2.
 * 이 모듈은 얇은 부분 채움(task0-thin-fill)이 필요한 층에서만 쓴다. 채움이 없는 층은 writer 가 B안 행을 그대로
 *   낸다(출력 바이트 불변 — 파일 A·C).
 *
 * 띠 분해 (+Y 단조를 띠 해상도로):
 *   - 띠 k = [원점 + k·w, 원점 + (k+1)·w), 원점 = 층 단면 최소 Y — 행 k(y = 원점 + (k+0.5)·w)가 띠 k 의 가운데.
 *     맨 위 나머지 띠(행 자리가 없는 띠)도 같은 식으로 번호가 이어진다.
 *   - 중심선 꺾은선은 띠 경계에서 잘라 조각마다 띠를 매긴다(선분 띠 = 중점 y 의 띠, task0SegmentBand).
 *     점 도포·행 구간은 수평이라 띠 하나.
 *   - 층 진행 = 띠 번호 비감소. 도포가 있는 띠마다 방향을 번갈아(첫 띠 +X) — 채움이 없는 층이면 B안 행 서펜타인과 같다.
 *     한 띠 안에서는 항목(행 구간·채움 조각·점)을 방향 순서로: +X 면 항목 최소 x 오름차순, −X 면 최대 x 내림차순.
 *   - 왜 구조적으로 안전한가: 띠 k 까지 칠한 비드는 y ≤ 원점 + (k+1)·w + w/2 = 행 k+1 선 안에 있다. 그래서 다음 띠로
 *     넘어가는 이동은 B안 L자(먼저 Y, 그다음 X)가 대개 그대로 통한다. 같은 띠 안 이동은 그렇지 않을 수 있어 아래처럼 검사한다.
 *
 * 채움 조각 방향: 현재 위치가 조각 끝점이면 거기서 시작(이동 없이 이어 칠함). 아니면 양 끝 Y 차가 w/4 보다 크면
 *   **아래 끝에서 위로**(+Y 진행 — 위 끝은 다음 띠 조각이 이어받는 자리), 아니면 띠 방향 쪽 끝에서 시작.
 *   그 방향으로 길이 없을 때만 반대 방향을 시도한다. 행 구간·점은 띠 방향.
 *
 * 트래블 (규격 §7.2 우회 허용): 후보를 차례로 시험해 **교차 검사**(아래)를 통과하는 첫 경로를 쓴다.
 *   1) 같은 높이면 직선, 아니면 B안 L자(Y 다음 X) 2) 직선 3) X 다음 Y 의 L자 4) 격자 A* 우회.
 *   3)·4) 를 "우회 트래블"로 센다. detour=false(대조군 전용)면 3)·4) 없이 1) 을 그대로 낸다(가로지를 수 있음).
 *   교차 검사 = verify-task0-writer c4 와 같은 정의: 경로(현재 위치 → 경유점 → 시작점)를 양 끝 w/2 씩 호 길이로
 *   줄인 나머지가, 그 층에서 이미 칠한 도포 선분(중심선)에서 w/2 − 1e-6 미만으로 다가가면 교차.
 *   A* 우회: 층 단면 bbox + 여유 격자(칸 = w/8, µm 정수 좌표) 위에서, 칠한 중심선에서 w/2 + 여유(칸 대각 반 + 0.1 µm)
 *   안인 칸을 막는다(거리 함수는 1-립시츠라 빈 칸끼리 잇는 선분은 w/2 이상 떨어진다). 시작·끝은 현재 위치·시작점에서
 *   보이는 빈 칸(직선의 첫·끝 w/2 를 뺀 나머지가 칠한 곳에서 w/2 이상)에 잇는다. 칠한 선 위·분기점처럼 떠날 수 있는
 *   방향이 칠한 선의 정확한 수직뿐인 점은 격자 칸이 그 방향에 거의 안 놓이므로, 법선·연장선·5° 부채꼴·도포할 항목의
 *   첫 방향으로 거리 w(·1.5w) 탈출점을 만들어 정확히 검사한 뒤 그 둘레 칸에 잇는다. 찾은 칸 경로는 보이는 만큼 당겨
 *   꺾임을 줄인 뒤 교차 검사로 다시 확인한다. 경로가 없으면 그 항목을 칠하지 않고 unreachable 로 센다(층 실패 —
 *   억지로 가로지르지 않는다).
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음.
 */
import { task0CapsuleSpanAtY, type Task0DepositSegment } from './task0-coverage';
import { task0PolylineSegments, task0SegmentBand, type Task0UmPoint } from './task0-thin-fill';

// ==================== 타입 ====================

/** writer 의 B안 행 (µm) — slot = 행 자리 번호 k (y = 원점 + (k+0.5)·w) */
export interface Task0RouteRow {
  yUm: number;
  slot: number;
  spans: [number, number][];
}

/** 트래블 종류 — none: 이동 없음(이어 칠함), first: 층 첫 트래블(직선), lY: B안 L자, lX·detour: 우회, crossing: 대조군 */
export type Task0TravelKind = 'none' | 'first' | 'straight' | 'lY' | 'lX' | 'detour' | 'crossing';

export interface Task0RouteStep {
  /** 트래블 경유점 (µm) — 마지막 = 도포 시작점. 빈 배열 = 이동 없음 */
  travel: Task0UmPoint[];
  travelKind: Task0TravelKind;
  /** 도포 점 (µm) — 시작점 다음부터 */
  deposit: Task0UmPoint[];
  kind: 'row' | 'fill' | 'dot';
  band: number;
}

export interface Task0RouteInput {
  rows: readonly Task0RouteRow[];
  centerlines: readonly Task0UmPoint[][];
  dots: readonly Task0UmPoint[][];
  /** 띠 원점 = 층 단면 최소 Y (mm) */
  bandOriginMm: number;
  depositWidthMm: number;
  /** A* 격자 범위 (mm) — 단면 bbox + 여유, 출력 가능 영역 안 */
  regionMm: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** 층 시작 위치 (µm) = Task0 파킹 */
  startUm: Task0UmPoint;
  /** false = 우회 끔 (대조군 전용) */
  detour: boolean;
}

export interface Task0RouteResult {
  steps: Task0RouteStep[];
  /** 띠로 자른 채움 조각 수 (점 도포 제외) */
  fillPieces: number;
  /** 점 도포 수 */
  dots: number;
  /** 우회 트래블 수 (X 먼저 L자 + A*) */
  detourTravels: number;
  /** 그중 A* 경로 수 */
  latticeDetours: number;
  /** 경로가 없어 칠하지 못한 항목 수 (> 0 이면 층 실패) */
  unreachable: number;
  /** 대조군(detour=false)에서 교차한 채 낸 트래블 수 */
  crossings: number;
  /** 낸 순서대로 도포 선분 (mm) */
  painted: Task0DepositSegment[];
}

type MmPoint = [number, number];

interface PaintedSeg {
  a: MmPoint;
  b: MmPoint;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface RouteItem {
  kind: 'row' | 'fill' | 'dot';
  band: number;
  pts: Task0UmPoint[];
  minX: number;
  maxX: number;
  minY: number;
  seq: number;
}

// ==================== 상수 ====================

const UM_PER_MM = 1000;
/** 교차 판정 여유 — verify-task0-writer c4 와 같은 값 */
const CROSS_EPS = 1e-6;
/** A* 계획 여유 (mm) — 계획 단계는 c4 보다 조금 엄격하게 */
const PLAN_MARGIN_MM = 1e-4;

// ==================== 기하 (verify-task0-writer c4 와 같은 식) ====================

const dist = (a: MmPoint, b: MmPoint): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

function pointSegDist(p: MmPoint, a: MmPoint, b: MmPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function orient(a: MmPoint, b: MmPoint, c: MmPoint): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
}

function segSegDist(a: MmPoint, b: MmPoint, c: MmPoint, d: MmPoint): number {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0; // 진짜 교차
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

/** 꺾은선에서 호 길이 앞 d·뒤 d 를 뗀 나머지 조각들 */
function trimPolyline(points: MmPoint[], d: number): [MmPoint, MmPoint][] {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  if (total <= 2 * d) return [];
  const s0 = d;
  const s1 = total - d;
  const out: [MmPoint, MmPoint][] = [];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const L = dist(a, b);
    const lo = Math.max(s0, acc);
    const hi = Math.min(s1, acc + L);
    if (L > 0 && hi > lo) {
      const p = (t: number): MmPoint => [a[0] + ((b[0] - a[0]) * (t - acc)) / L, a[1] + ((b[1] - a[1]) * (t - acc)) / L];
      out.push([p(lo), p(hi)]);
    }
    acc += L;
  }
  return out;
}

const umToMm = (p: Task0UmPoint): MmPoint => [p[0] / UM_PER_MM, p[1] / UM_PER_MM];

/** 선분 AB 와 칠한 선분들의 최소 거리가 minDist 미만인지 (bbox 로 먼저 거름 — 판정은 같다) */
function nearPainted(a: MmPoint, b: MmPoint, painted: readonly PaintedSeg[], minDist: number): boolean {
  const xMin = Math.min(a[0], b[0]) - minDist;
  const xMax = Math.max(a[0], b[0]) + minDist;
  const yMin = Math.min(a[1], b[1]) - minDist;
  const yMax = Math.max(a[1], b[1]) + minDist;
  for (const s of painted) {
    if (s.xMax < xMin || s.xMin > xMax || s.yMax < yMin || s.yMin > yMax) continue;
    if (segSegDist(a, b, s.a, s.b) < minDist) return true;
  }
  return false;
}

/**
 * 트래블 교차 — verify-task0-writer c4 와 같은 정의. path = [현재 위치, 경유점…, 시작점] (mm).
 * 칠한 것이 없으면(층 첫 트래블) 교차 없음.
 */
export function task0TravelCrossesPainted(
  path: readonly MmPoint[],
  painted: readonly { a: MmPoint; b: MmPoint }[],
  depositWidthMm: number,
): boolean {
  return crossesPainted(path, painted.map((s) => toPainted(s.a, s.b)), depositWidthMm);
}

function crossesPainted(path: readonly MmPoint[], painted: readonly PaintedSeg[], depositWidthMm: number): boolean {
  if (painted.length === 0) return false;
  const half = depositWidthMm / 2;
  return trimPolyline(path.slice(), half).some(([a, b]) => nearPainted(a, b, painted, half - CROSS_EPS));
}

function toPainted(a: MmPoint, b: MmPoint): PaintedSeg {
  return {
    a,
    b,
    xMin: Math.min(a[0], b[0]),
    xMax: Math.max(a[0], b[0]),
    yMin: Math.min(a[1], b[1]),
    yMax: Math.max(a[1], b[1]),
  };
}

/**
 * 선분 PQ 중 앞 trimStart·뒤 trimEnd(호 길이)를 뺀 나머지가 칠한 곳에서 minDist 이상인지.
 * 남는 부분이 없으면 참.
 */
function segmentClear(
  P: MmPoint,
  Q: MmPoint,
  trimStart: number,
  trimEnd: number,
  painted: readonly PaintedSeg[],
  minDist: number,
): boolean {
  const L = dist(P, Q);
  if (L <= trimStart + trimEnd) return true;
  const ux = (Q[0] - P[0]) / L;
  const uy = (Q[1] - P[1]) / L;
  const A: MmPoint = [P[0] + ux * trimStart, P[1] + uy * trimStart];
  const B: MmPoint = [Q[0] - ux * trimEnd, Q[1] - uy * trimEnd];
  return !nearPainted(A, B, painted, minDist);
}

// ==================== 띠 자르기 ====================

/** mm → 1 µm 격자 정수 */
function toUm(mm: number): number {
  const u = Math.round(mm * UM_PER_MM);
  return u === 0 ? 0 : u;
}

/**
 * µm 꺾은선을 띠 경계(원점 + k·w)에서 잘라 조각마다 띠를 매긴다. 교차점은 1 µm 격자로 반올림.
 * 선분 띠 = 중점 y 의 띠(task0SegmentBand), 같은 띠가 이어지는 선분들을 한 조각으로.
 */
export function task0CutByBands(
  pts: readonly Task0UmPoint[],
  bandOriginMm: number,
  depositWidthMm: number,
): { band: number; pts: Task0UmPoint[] }[] {
  const w = depositWidthMm;
  const dense: Task0UmPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a[1] !== b[1]) {
      const lo = Math.min(a[1], b[1]);
      const hi = Math.max(a[1], b[1]);
      const kLo = Math.floor((lo / UM_PER_MM - bandOriginMm) / w);
      const kHi = Math.ceil((hi / UM_PER_MM - bandOriginMm) / w);
      const cuts: { t: number; p: Task0UmPoint }[] = [];
      for (let k = kLo; k <= kHi; k++) {
        const yb = toUm(bandOriginMm + k * w);
        if (!(yb > lo && yb < hi)) continue;
        const t = (yb - a[1]) / (b[1] - a[1]);
        cuts.push({ t, p: [Math.round(a[0] + t * (b[0] - a[0])), yb] });
      }
      cuts.sort((u, v) => u.t - v.t);
      for (const c of cuts) dense.push(c.p);
    }
    dense.push(b);
  }
  const pieces: { band: number; pts: Task0UmPoint[] }[] = [];
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const band = task0SegmentBand(a[1], b[1], bandOriginMm, w);
    const last = pieces.length > 0 ? pieces[pieces.length - 1] : null;
    const tail = last !== null ? last.pts[last.pts.length - 1] : null;
    if (last !== null && tail !== null && last.band === band && tail[0] === a[0] && tail[1] === a[1]) last.pts.push(b);
    else pieces.push({ band, pts: [a, b] });
  }
  return pieces;
}

// ==================== A* 우회 격자 ====================

/** 최소 힙 (f, 칸) */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      vals[i] = vals[parent];
      i = parent;
    }
    keys[i] = key;
    vals[i] = val;
  }
  /** [key, val] — 비었으면 호출 금지 */
  pop(): [number, number] {
    const { keys, vals } = this;
    const topKey = keys[0];
    const topVal = vals[0];
    const lastKey = keys.pop() as number;
    const lastVal = vals.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastKey;
      vals[i] = lastVal;
    }
    return [topKey, topVal];
  }
}

const LATTICE_STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 우회 격자 — 칸 중심이 정수 µm. 칠한 중심선에서 blockMm 안인 칸은 막힘 */
class DetourLattice {
  readonly x0Um: number;
  readonly y0Um: number;
  readonly hUm: number;
  readonly nx: number;
  readonly ny: number;
  readonly blocked: Uint8Array;
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  private readonly seen: Int32Array;
  private readonly closed: Int32Array;
  private readonly goal: Int32Array;
  private gen = 0;

  constructor(
    region: { xMin: number; xMax: number; yMin: number; yMax: number },
    hUm: number,
    private readonly blockMm: number,
  ) {
    this.hUm = hUm;
    this.x0Um = Math.round(region.xMin * UM_PER_MM);
    this.y0Um = Math.round(region.yMin * UM_PER_MM);
    this.nx = Math.max(1, Math.floor((Math.round(region.xMax * UM_PER_MM) - this.x0Um) / hUm) + 1);
    this.ny = Math.max(1, Math.floor((Math.round(region.yMax * UM_PER_MM) - this.y0Um) / hUm) + 1);
    const n = this.nx * this.ny;
    this.blocked = new Uint8Array(n);
    this.g = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.goal = new Int32Array(n);
  }

  cellUm(k: number): Task0UmPoint {
    const i = k % this.nx;
    const j = (k - i) / this.nx;
    return [this.x0Um + i * this.hUm, this.y0Um + j * this.hUm];
  }

  /** 칠한 선분 하나 — 중심선에서 blockMm 안인 칸을 막음 */
  stamp(s: PaintedSeg): void {
    const R = this.blockMm;
    const h = this.hUm;
    const jLo = Math.max(0, Math.ceil(((s.yMin - R) * UM_PER_MM - this.y0Um) / h));
    const jHi = Math.min(this.ny - 1, Math.floor(((s.yMax + R) * UM_PER_MM - this.y0Um) / h));
    for (let j = jLo; j <= jHi; j++) {
      const y = (this.y0Um + j * h) / UM_PER_MM;
      const span = task0CapsuleSpanAtY(s.a[0], s.a[1], s.b[0], s.b[1], R, y);
      if (span === null) continue;
      const iLo = Math.max(0, Math.ceil((span[0] * UM_PER_MM - this.x0Um) / h));
      const iHi = Math.min(this.nx - 1, Math.floor((span[1] * UM_PER_MM - this.x0Um) / h));
      if (iHi >= iLo) this.blocked.fill(1, j * this.nx + iLo, j * this.nx + iHi + 1);
    }
  }

  /** 점 P(mm) 에서 반지름 r 안의 빈 칸 중 ok(칸) 인 것 */
  private cellsNear(P: MmPoint, r: number, ok: (q: MmPoint) => boolean): number[] {
    const h = this.hUm;
    const out: number[] = [];
    const iLo = Math.max(0, Math.ceil(((P[0] - r) * UM_PER_MM - this.x0Um) / h));
    const iHi = Math.min(this.nx - 1, Math.floor(((P[0] + r) * UM_PER_MM - this.x0Um) / h));
    const jLo = Math.max(0, Math.ceil(((P[1] - r) * UM_PER_MM - this.y0Um) / h));
    const jHi = Math.min(this.ny - 1, Math.floor(((P[1] + r) * UM_PER_MM - this.y0Um) / h));
    for (let j = jLo; j <= jHi; j++) {
      for (let i = iLo; i <= iHi; i++) {
        const k = j * this.nx + i;
        if (this.blocked[k] !== 0) continue;
        const q = umToMm(this.cellUm(k));
        if (dist(P, q) <= r && ok(q)) out.push(k);
      }
    }
    return out;
  }

  /**
   * 점 P(µm) 를 격자에 잇는 칸들 — atStart 면 P → 칸(앞 w/2 는 c4 처럼 뺌), 아니면 칸 → P(뒤 w/2 를 뺌).
   *   (a) P 에서 곧게 보이는 빈 칸 (반지름 radii 를 작은 것부터)
   *   (b) 탈출점 경유: P 가 칠한 선 한가운데나 여러 선이 만나는 점이면 c4 의 "앞 w/2 를 뺀 나머지가 w/2 이상"을
   *       만족하는 방향이 칠한 선의 **정확한 수직**뿐일 수 있다(w/2 지점에서 거리 = (w/2)·cos 어긋난 각).
   *       격자 칸은 그 방향에 거의 안 놓이므로, 가까운 칠한 선분의 법선·끝점 연장선과 5° 간격 부채꼴 방향으로
   *       거리 w·1.5w 인 점(µm)을 만들어 정확히 검사하고, 통과한 점 둘레 칸에 잇는다.
   * 칸마다 가장 싼 연결 하나 (via = 탈출점, 없으면 null).
   */
  private links(
    P: Task0UmPoint,
    atStart: boolean,
    painted: readonly PaintedSeg[],
    w: number,
    radii: readonly number[],
    hint: MmPoint | null,
  ): Map<number, { via: Task0UmPoint | null; cost: number }> {
    const half = w / 2;
    const clearMm = half - CROSS_EPS;
    const pm = umToMm(P);
    const out = new Map<number, { via: Task0UmPoint | null; cost: number }>();
    const put = (k: number, via: Task0UmPoint | null, cost: number): void => {
      const cur = out.get(k);
      if (cur === undefined || cost < cur.cost) out.set(k, { via, cost });
    };
    const seg = (a: MmPoint, b: MmPoint, trim: number): boolean =>
      atStart ? segmentClear(a, b, trim, 0, painted, clearMm) : segmentClear(b, a, 0, trim, painted, clearMm);
    // (a) 곧게 보이는 칸
    for (const r of radii) {
      for (const k of this.cellsNear(pm, r, (q) => seg(pm, q, half))) put(k, null, dist(pm, umToMm(this.cellUm(k))));
      if (out.size > 0) break;
    }
    // (b) 탈출점
    const dirs: MmPoint[] = [];
    if (hint !== null) dirs.push(hint);
    for (let a = 0; a < 72; a++) dirs.push([Math.cos((a * Math.PI) / 36), Math.sin((a * Math.PI) / 36)]);
    for (const s of painted) {
      if (pointSegDist(pm, s.a, s.b) > w) continue;
      const L = dist(s.a, s.b);
      if (L === 0) continue;
      const vx = (s.b[0] - s.a[0]) / L;
      const vy = (s.b[1] - s.a[1]) / L;
      dirs.push([-vy, vx], [vy, -vx], [vx, vy], [-vx, -vy]);
    }
    const reach = (2.5 * this.hUm) / UM_PER_MM;
    for (const r of [w, 1.5 * w]) {
      let found = false;
      for (const [ux, uy] of dirs) {
        const E: Task0UmPoint = [Math.round(P[0] + ux * r * UM_PER_MM), Math.round(P[1] + uy * r * UM_PER_MM)];
        const em = umToMm(E);
        if (!seg(pm, em, half)) continue;
        const base = dist(pm, em);
        for (const k of this.cellsNear(em, reach, (q) => seg(em, q, 0))) {
          put(k, E, base + dist(em, umToMm(this.cellUm(k))));
          found = true;
        }
      }
      if (found) break;
    }
    return out;
  }

  /**
   * C(현재 위치) → S(시작점) 우회 경로의 경유점 (µm, S 포함) — 없으면 null.
   * radii = 곧게 잇는 반지름 후보 (작은 것부터). next = 도포할 항목의 두 번째 점 — 그 반대쪽(항목이 나아갈 길)에서
   * S 로 들어오는 방향을 탈출점 후보에 넣는다(분기점·이음점 S 는 그 방향만 열려 있을 수 있다).
   */
  search(
    C: Task0UmPoint,
    S: Task0UmPoint,
    next: Task0UmPoint | null,
    painted: readonly PaintedSeg[],
    w: number,
    radii: readonly number[],
  ): Task0UmPoint[] | null {
    const half = w / 2;
    // 시작·끝 연결과 당기기는 격자 근사가 아니라 정확한 선분 검사라 c4 와 같은 문턱을 쓴다.
    // (칠한 끝점에서 곧게 떠나는 직선은 호 길이 s 에서 거리가 정확히 s — w/2 지점이 문턱과 같아 여유를 두면 못 떠난다)
    const clearMm = half - CROSS_EPS;
    const sm = umToMm(S);
    let hint: MmPoint | null = null;
    if (next !== null) {
      const L = Math.hypot(next[0] - S[0], next[1] - S[1]);
      if (L > 0) hint = [(next[0] - S[0]) / L, (next[1] - S[1]) / L];
    }
    const starts = this.links(C, true, painted, w, radii, null);
    const goals = this.links(S, false, painted, w, radii, hint);
    if (starts.size === 0 || goals.size === 0) return null;

    const gen = ++this.gen;
    for (const k of goals.keys()) this.goal[k] = gen;
    const heap = new MinHeap();
    const hUmMm = this.hUm / UM_PER_MM;
    for (const [k, { cost }] of starts) {
      this.seen[k] = gen;
      this.g[k] = cost;
      this.parent[k] = -1;
      heap.push(cost + dist(umToMm(this.cellUm(k)), sm), k);
    }
    // 끝 칸의 마지막 다리(칸 → (탈출점) → S)는 직선 거리 이상이라, 꺼낸 f 가 지금까지 최선 이상이면 멈춘다
    let best = -1;
    let bestCost = Infinity;
    while (heap.size > 0) {
      const [f, u] = heap.pop();
      if (f >= bestCost) break;
      if (this.closed[u] === gen) continue;
      this.closed[u] = gen;
      if (this.goal[u] === gen) {
        const total = this.g[u] + (goals.get(u) as { cost: number }).cost;
        if (total < bestCost) {
          bestCost = total;
          best = u;
        }
      }
      const ui = u % this.nx;
      const uj = (u - ui) / this.nx;
      for (const [di, dj] of LATTICE_STEPS) {
        const vi = ui + di;
        const vj = uj + dj;
        if (vi < 0 || vj < 0 || vi >= this.nx || vj >= this.ny) continue;
        const v = vj * this.nx + vi;
        if (this.blocked[v] !== 0 || this.closed[v] === gen) continue;
        const ng = this.g[u] + (di !== 0 && dj !== 0 ? hUmMm * Math.SQRT2 : hUmMm);
        if (this.seen[v] === gen && ng >= this.g[v]) continue;
        this.seen[v] = gen;
        this.g[v] = ng;
        this.parent[v] = u;
        heap.push(ng + dist(umToMm(this.cellUm(v)), sm), v);
      }
    }
    if (best < 0) return null;
    const cells: Task0UmPoint[] = [];
    let head = best;
    for (let k = best; k >= 0; k = this.parent[k]) {
      cells.push(this.cellUm(k));
      head = k;
    }
    cells.reverse();
    const viaStart = (starts.get(head) as { via: Task0UmPoint | null }).via;
    const viaGoal = (goals.get(best) as { via: Task0UmPoint | null }).via;
    const raw: Task0UmPoint[] = [C, ...(viaStart ? [viaStart] : []), ...cells, ...(viaGoal ? [viaGoal] : []), S];

    // 당기기 — 보이는 만큼 건너뛴다 (첫 선분은 앞 w/2, 마지막 선분은 뒤 w/2 를 뺀 나머지를 본다)
    const n = raw.length;
    const pulled: Task0UmPoint[] = [C];
    for (let i = 0; i < n - 1; ) {
      let j = i + 1;
      while (
        j + 1 < n &&
        segmentClear(umToMm(raw[i]), umToMm(raw[j + 1]), i === 0 ? half : 0, j + 1 === n - 1 ? half : 0, painted, clearMm)
      ) {
        j++;
      }
      pulled.push(raw[j]);
      i = j;
    }
    for (const cand of [pulled, raw]) {
      if (!crossesPainted(cand.map(umToMm), painted, w)) return cand.slice(1);
    }
    return null;
  }
}

// ==================== 본체 ====================

const samePt = (a: Task0UmPoint, b: Task0UmPoint): boolean => a[0] === b[0] && a[1] === b[1];

/**
 * 채움 층 하나의 도포 순서와 트래블.
 * 행 구간 + 중심선(띠로 자름) + 점 도포 → 띠 오름차순, 띠마다 방향을 번갈아 X 순서로, 트래블은 교차 검사 통과 경로.
 */
export function routeTask0FillLayer(input: Task0RouteInput): Task0RouteResult {
  const w = input.depositWidthMm;
  const origin = input.bandOriginMm;
  const items: RouteItem[] = [];
  const pushItem = (kind: RouteItem['kind'], band: number, pts: Task0UmPoint[]): void => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
    }
    items.push({ kind, band, pts, minX, maxX, minY, seq: items.length });
  };
  for (const row of input.rows) {
    for (const [a, b] of row.spans) {
      pushItem('row', task0SegmentBand(row.yUm, row.yUm, origin, w), [
        [a, row.yUm],
        [b, row.yUm],
      ]);
    }
  }
  let fillPieces = 0;
  for (const line of input.centerlines) {
    for (const piece of task0CutByBands(line, origin, w)) {
      pushItem('fill', piece.band, piece.pts);
      fillPieces++;
    }
  }
  for (const dot of input.dots) pushItem('dot', task0SegmentBand(dot[0][1], dot[1][1], origin, w), dot.slice());

  const byBand = new Map<number, RouteItem[]>();
  for (const it of items) {
    const list = byBand.get(it.band);
    if (list) list.push(it);
    else byBand.set(it.band, [it]);
  }
  const bands = [...byBand.keys()].sort((a, b) => a - b);

  const steps: Task0RouteStep[] = [];
  const painted: PaintedSeg[] = [];
  const paintedOut: Task0DepositSegment[] = [];
  // 격자는 처음 A* 가 필요할 때 만든다 (그때까지 칠한 것을 한꺼번에 찍고, 이후는 칠할 때마다)
  const det: { lattice: DetourLattice | null } = { lattice: null };
  const hUm = Math.max(10, Math.round((w * UM_PER_MM) / 8));
  const blockMm = w / 2 + ((hUm / UM_PER_MM) * Math.SQRT2) / 2 + PLAN_MARGIN_MM;
  // 시작·끝 연결 반지름 — 칠한 끝점 바로 옆 빈 칸(blockMm 밖)이 들어오게 칸 2개 여유부터, 막히면 넓힘
  const radii = [blockMm + (2 * hUm) / UM_PER_MM, w, 1.5 * w];
  let cur: Task0UmPoint = input.startUm;
  let first = true;
  let detourTravels = 0;
  let latticeDetours = 0;
  let unreachable = 0;
  let crossings = 0;

  const crosses = (waypoints: Task0UmPoint[]): boolean => crossesPainted([cur, ...waypoints].map(umToMm), painted, w);

  /** 현재 위치 → target 트래블 (경유점, 종류) — 길이 없으면 null */
  const planTravel = (target: Task0UmPoint, next: Task0UmPoint | null): { pts: Task0UmPoint[]; kind: Task0TravelKind } | null => {
    if (samePt(cur, target)) return { pts: [], kind: 'none' };
    if (first) return { pts: [target], kind: 'first' };
    const sameY = cur[1] === target[1];
    const lY: Task0UmPoint[] = sameY || cur[0] === target[0] ? [target] : [[cur[0], target[1]], target];
    const standard: { pts: Task0UmPoint[]; kind: Task0TravelKind }[] = sameY
      ? [{ pts: [target], kind: 'straight' }]
      : [
          { pts: lY, kind: lY.length === 2 ? 'lY' : 'straight' },
          { pts: [target], kind: 'straight' },
        ];
    for (const c of standard) if (!crosses(c.pts)) return c;
    if (!input.detour) return { pts: standard[0].pts, kind: 'crossing' };
    if (!sameY && cur[0] !== target[0]) {
      const lX: Task0UmPoint[] = [[target[0], cur[1]], target];
      if (!crosses(lX)) return { pts: lX, kind: 'lX' };
    }
    if (det.lattice === null) {
      det.lattice = new DetourLattice(input.regionMm, hUm, blockMm);
      for (const s of painted) det.lattice.stamp(s);
    }
    const path = det.lattice.search(cur, target, next, painted, w, radii);
    return path === null ? null : { pts: path, kind: 'detour' };
  };

  let dir = 1;
  for (const band of bands) {
    const list = (byBand.get(band) as RouteItem[]).slice();
    list.sort((p, q) => {
      const kp = dir > 0 ? p.minX : -p.maxX;
      const kq = dir > 0 ? q.minX : -q.maxX;
      return kp - kq || p.minY - q.minY || p.seq - q.seq;
    });
    let emitted = false;
    for (const it of list) {
      // 방향 후보 (앞 = 우선)
      const fwd = it.pts;
      const rev = it.pts.slice().reverse();
      let orients: Task0UmPoint[][];
      if (it.kind !== 'fill') {
        orients = [(fwd[0][0] <= fwd[fwd.length - 1][0]) === dir > 0 ? fwd : rev];
      } else {
        const s = fwd[0];
        const e = fwd[fwd.length - 1];
        let pref: Task0UmPoint[];
        if (samePt(s, cur)) pref = fwd;
        else if (samePt(e, cur)) pref = rev;
        else if (Math.abs(e[1] - s[1]) > (w * UM_PER_MM) / 4) pref = s[1] <= e[1] ? fwd : rev;
        else pref = (s[0] <= e[0]) === dir > 0 ? fwd : rev;
        orients = samePt(s, e) ? [pref] : [pref, pref === fwd ? rev : fwd];
      }
      let done = false;
      for (const pts of orients) {
        const tr = planTravel(pts[0], pts.length > 1 ? pts[1] : null);
        if (tr === null) continue;
        steps.push({ travel: tr.pts, travelKind: tr.kind, deposit: pts.slice(1), kind: it.kind, band });
        if (tr.kind === 'lX' || tr.kind === 'detour') detourTravels++;
        if (tr.kind === 'detour') latticeDetours++;
        if (tr.kind === 'crossing') crossings++;
        for (let i = 1; i < pts.length; i++) {
          const seg = toPainted(umToMm(pts[i - 1]), umToMm(pts[i]));
          painted.push(seg);
          if (det.lattice !== null) det.lattice.stamp(seg);
        }
        paintedOut.push(...task0PolylineSegments(pts));
        cur = pts[pts.length - 1];
        first = false;
        done = true;
        emitted = true;
        break;
      }
      if (!done) unreachable++;
    }
    if (emitted) dir = -dir;
  }
  return {
    steps,
    fillPieces,
    dots: input.dots.length,
    detourTravels,
    latticeDetours,
    unreachable,
    crossings,
    painted: paintedOut,
  };
}
