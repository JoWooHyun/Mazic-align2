/**
 * Task0 채움 층의 도포 순서·트래블 — 띠 분해 + 우회 경로 (규격서 v0.3.4 §5·§7, Z1-b2)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.4 @ 커밋 a4ebc6c §7 (v0.3.3 dfdf08c 와 같은 문장) —
 *   "도포는 파킹 (0,0)에서 멀어지는 +Y 방향 단조 진행", "도포한 영역을 가로지르는 트래블 금지 — 우회 경로",
 *   "층 안 Z-hop 금지". 설계: `docs/계획_Z1_task0출력_20261002.md` Z1-b2.
 * 이 모듈은 얇은 부분 채움(task0-thin-fill)이 필요한 층에서만 쓴다. 채움이 없는 층은 writer 가 B안 행을 그대로
 *   낸다(출력 바이트 불변 — 파일 A·C).
 * 리트랙트(E−r/E+r)는 여기서 내지 않는다 — writer 가 행 층과 같은 상태 기계(travel/deposit)로 붙인다
 *   (v0.3.4 §5: 모든 툴 리트랙트 상태로 시작, 첫 도포 앞 E+r 포함, 1 mm 미만 트래블 생략은 경로 길이 기준).
 * (D1a 2재료) writer 는 층 안 두 번째 툴 패스를 채움이 없어도 이 모듈로 낸다 — paintedBefore(앞 툴이 칠한 선분)를 받아
 *   전환 트래블(앞 패스 끝 → 이 패스 첫 도포점)과 패스 안 트래블이 앞 툴이 칠한 곳까지 피하게(아래 교차 검사·A* 그대로).
 *   행만 있는 패스면 띠 = 행이라 B안 서펜타인과 같은 순서이고, 트래블만 교차 검사를 받는다.
 *   2재료 패스 전용 선택(rowsEitherWay·firstBandDir·reverseLastItem): 행·점도 띠 방향 쪽 끝이 막히면 반대 끝으로 들어가고,
 *   writer 가 기본 계획이 막힌 층에서만 첫 띠 방향·마지막 항목 방향을 바꿔 다시 계획한다(다음 툴 패스로 떠날 끝을 바꿔 봄).
 *   단일 재료는 이 선택을 쓰지 않는다(출력 그대로).
 *
 * 엄격 판정 (D1a 재작업 — 리뷰 FAIL: 교차를 성공으로 보고한 출력): 위 교차 검사(c4 정의 — 양 끝 w/2 를 잘라냄)만으로는
 *   경로 시작 w/2 안에서 칠한 중심선을 실제로 가로지르는 다리를 못 본다(이음점 끝에서 출발하는 L자). 그래서 모든 트래블 후보는
 *   task0TravelContactOk(= verify-task0-writer c4b checkTravelContact 와 같은 정의: 정수 µm 외적으로 다리·칠한 선분 접촉 분류,
 *   시작·끝점 한 점 접촉만 허용, 진짜 교차·경유점 접촉 금지, 같은 직선 겹침은 첫 다리가 직전 도포 선분을 거꾸로 되짚는 것만)까지
 *   통과해야 채택한다. 통과하는 경로가 없으면 그 항목은 칠하지 않는다(unreachable — 층 실패). 검증 스크립트의 c4b 는 독립 구현을
 *   그대로 두고, verify-task0-dual 이 두 구현의 판정이 같은지 무작위로 맞대어 본다.
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
  /**
   * (D1a 2재료) 이 층에서 앞 툴 패스가 이미 칠한 도포 선분 (mm). 트래블 교차 검사·우회 격자에 넣고(규격 §7 "도포한 영역을
   * 가로지르는 트래블 금지" — 툴과 무관), 그래서 첫 트래블(전환 트래블)도 직선 예외 없이 검사한다. painted 출력에는 넣지 않는다.
   */
  paintedBefore?: readonly Task0DepositSegment[];
  /** (D1a 2재료 패스) 행 구간·점도 반대 끝으로 들어갈 수 있게 — 띠 방향 쪽 끝이 먼저, 막히면 반대 끝 */
  rowsEitherWay?: boolean;
  /** (D1a 2재료 패스) 첫 띠 방향 (기본 +1 = +X). 이후 띠는 번갈아 */
  firstBandDir?: 1 | -1;
  /** (D1a 2재료 패스) 마지막 항목은 반대 방향을 먼저 시도 — 다음 툴 패스로 떠날 끝을 바꿔 보기 */
  reverseLastItem?: boolean;
  /**
   * (D1a 2재료 패스) 경로 없는 항목이 생기면 그 앞에 낸 항목(바로 앞부터 STUCK_RETRY_BACK 개)의 방향을 뒤집어 다시 계획
   * (STUCK_RETRY_MAX 회까지). 막힌 항목이 없으면 아무 것도 안 한다.
   */
  retryOnStuck?: boolean;
  /** (D1a 2재료 패스) 처음부터 방향 후보 순서를 뒤집을 항목 (결과 emittedSeqs 의 번호) — writer 가 다음 패스가 막힐 때 쓴다 */
  flipItems?: readonly number[];
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
  /** 낸 항목 번호(입력 항목 순서 — 같은 입력이면 같은 번호), 낸 순서대로 — flipItems 에 다시 줄 수 있다 */
  emittedSeqs: number[];
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
/** (2재료) 막힌 항목 다시 계획 — 시도 상한과, 막힌 항목 앞 몇 개까지 방향을 뒤집어 볼지 */
const STUCK_RETRY_MAX = 8;
const STUCK_RETRY_BACK = 3;

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

// ==================== 엄격 판정 (c4b 와 같은 정의) ====================

/** 칠한 선분 (정수 µm) */
export type Task0UmSegment = [Task0UmPoint, Task0UmPoint];

/** 외적 부호 (정수 µm — 값이 2^53 안이라 정확) */
const orientI = (a: Task0UmPoint, b: Task0UmPoint, c: Task0UmPoint): number =>
  Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
/** 같은 직선 위 점 p 가 선분 ab 범위(닫힌 bbox) 안인지 */
const withinI = (p: Task0UmPoint, a: Task0UmPoint, b: Task0UmPoint): boolean =>
  Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

type LegContact =
  | { kind: 'none' }
  | { kind: 'cross' }
  | { kind: 'touch'; points: Task0UmPoint[] }
  | { kind: 'overlap'; containsP: boolean };

/** 다리 pq 와 칠한 선분 ab 의 접촉 — verify-task0-writer legSegmentContact 와 같은 분류 */
function legContact(p: Task0UmPoint, q: Task0UmPoint, a: Task0UmPoint, b: Task0UmPoint): LegContact {
  const o1 = orientI(p, q, a);
  const o2 = orientI(p, q, b);
  const o3 = orientI(a, b, p);
  const o4 = orientI(a, b, q);
  if (o1 === 0 && o2 === 0) {
    // 같은 직선 — 다리 방향의 큰 축으로 투영해 구간 겹침
    const ax = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) ? 0 : 1;
    const lo = Math.max(Math.min(p[ax], q[ax]), Math.min(a[ax], b[ax]));
    const hi = Math.min(Math.max(p[ax], q[ax]), Math.max(a[ax], b[ax]));
    if (lo > hi) return { kind: 'none' };
    if (lo === hi) {
      const point = [p, q, a, b].find((t) => t[ax] === lo && withinI(t, p, q) && withinI(t, a, b));
      return { kind: 'touch', points: point ? [point] : [] };
    }
    return { kind: 'overlap', containsP: lo <= p[ax] && p[ax] <= hi };
  }
  if (o1 * o2 < 0 && o3 * o4 < 0) return { kind: 'cross' };
  const points: Task0UmPoint[] = [];
  if (o1 === 0 && withinI(a, p, q)) points.push(a);
  if (o2 === 0 && withinI(b, p, q)) points.push(b);
  if (o3 === 0 && withinI(p, a, b)) points.push(p);
  if (o4 === 0 && withinI(q, a, b)) points.push(q);
  return points.length > 0 ? { kind: 'touch', points } : { kind: 'none' };
}

/**
 * 트래블 경로의 엄격 판정 — verify-task0-writer c4b(checkTravelContact) 와 같은 정의 (정수 µm, 반올림 오차 없음).
 *   path = [시작점 C(직전 도포 끝 = 현재 위치), 경유점…, 끝점 S(다음 도포 시작)], painted = 그 층에서 이미 칠한 선분(순서대로),
 *   lastDepIndex = 직전 도포 선분의 painted 번호(없으면 −1).
 *   - 다리와 칠한 선분의 진짜 교차 → 불가.
 *   - 한 점 접촉 → 그 점이 C 또는 S 면 허용, 경유점·다리 가운데면 불가.
 *   - 같은 직선 위 겹침(길이 > 0) → 첫 다리가 직전 도포 선분을 거꾸로 되짚는 것(겹침이 C 를 포함)만 허용.
 *   길이 0 다리는 writer 가 내지 않으므로 뺀다. 칠한 것이 없으면(층 첫 트래블) 참.
 */
export function task0TravelContactOk(
  path: readonly Task0UmPoint[],
  painted: readonly Task0UmSegment[],
  lastDepIndex: number,
): boolean {
  if (painted.length === 0) return true;
  const pts: Task0UmPoint[] = [];
  for (const p of path) {
    const last = pts.length > 0 ? pts[pts.length - 1] : null;
    if (last === null || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  if (pts.length < 2) return true;
  const C = pts[0];
  const S = pts[pts.length - 1];
  const isEnd = (t: Task0UmPoint): boolean => (t[0] === C[0] && t[1] === C[1]) || (t[0] === S[0] && t[1] === S[1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    const xLo = Math.min(p[0], q[0]);
    const xHi = Math.max(p[0], q[0]);
    const yLo = Math.min(p[1], q[1]);
    const yHi = Math.max(p[1], q[1]);
    for (let k = 0; k < painted.length; k++) {
      const [a, b] = painted[k];
      // 닫힌 bbox 가 안 겹치면 어떤 접촉도 없다 (판정은 같다)
      if (Math.max(a[0], b[0]) < xLo || Math.min(a[0], b[0]) > xHi || Math.max(a[1], b[1]) < yLo || Math.min(a[1], b[1]) > yHi) {
        continue;
      }
      const c = legContact(p, q, a, b);
      if (c.kind === 'cross') return false;
      if (c.kind === 'touch' && c.points.some((t) => !isEnd(t))) return false;
      if (c.kind === 'overlap' && !(i === 1 && k === lastDepIndex && c.containsP)) return false;
    }
  }
  return true;
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
  /**
   * 마지막으로 끝 칸을 못 찾은 탐색 — 그 탐색은 출발 칸들의 연결 성분 전체를 돌았다(closed[k] === gen 인 칸).
   * 같은 출발점·같은 칠한 상태(선분 수)면 출발 칸·막힌 칸이 같으므로, 다음 목표의 끝 칸이 그 성분에 하나도 없으면 탐색 없이
   * 길 없음을 낸다(결과는 탐색했을 때와 같다 — 성분 밖 칸에는 닿을 수 없음). 경로 없는 항목이 이어지는 층(닫힌 고리 등)의 비용을 줄인다.
   */
  private exhausted: { cx: number; cy: number; painted: number; gen: number } | null = null;

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
    accept: (path: Task0UmPoint[]) => boolean,
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
    const ex = this.exhausted;
    const sameStart = ex !== null && ex.cx === C[0] && ex.cy === C[1] && ex.painted === painted.length;
    const starts = this.links(C, true, painted, w, radii, null);
    const goals = this.links(S, false, painted, w, radii, hint);
    if (starts.size === 0 || goals.size === 0) return null;
    if (sameStart && ex !== null) {
      let reachable = false;
      for (const k of goals.keys()) {
        if (this.closed[k] === ex.gen) {
          reachable = true;
          break;
        }
      }
      if (!reachable) return null; // 앞 탐색이 다 돈 성분 밖 — 길 없음 (탐색 생략)
    }
    // 실제로 탐색하면 closed 표시가 새 세대로 덮이므로 앞 기록은 버린다 (아래에서 다시 다 돌면 새로 남김)
    this.exhausted = null;

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
    if (best < 0) {
      // 끝 칸을 못 찾음 = 출발 성분 전체를 돌았다 (bestCost 가 무한이라 중간에 멈추지 않음) — 다음 목표의 조기 판정에 쓴다
      this.exhausted = { cx: C[0], cy: C[1], painted: painted.length, gen };
      return null;
    }
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
      if (!crossesPainted(cand.map(umToMm), painted, w) && accept(cand)) return cand.slice(1);
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
  const hUm = Math.max(10, Math.round((w * UM_PER_MM) / 8));
  const blockMm = w / 2 + ((hUm / UM_PER_MM) * Math.SQRT2) / 2 + PLAN_MARGIN_MM;
  // 시작·끝 연결 반지름 — 칠한 끝점 바로 옆 빈 칸(blockMm 밖)이 들어오게 칸 2개 여유부터, 막히면 넓힘
  const radii = [blockMm + (2 * hUm) / UM_PER_MM, w, 1.5 * w];
  /** 방향을 바꿀 수 있는 항목 (양 끝이 다르고, 행·점이면 rowsEitherWay) */
  const flippable = (it: RouteItem): boolean =>
    !samePt(it.pts[0], it.pts[it.pts.length - 1]) && (it.kind === 'fill' || input.rowsEitherWay === true);
  /**
   * 한 번 계획 — flips 에 든 항목(seq)은 방향 후보 순서를 뒤집는다. firstStuck = 처음 경로 없던 항목 앞까지 낸 항목 수,
   * emittedSeqs = 낸 항목 seq (낸 순서).
   */
  const attempt = (flips: ReadonlySet<number>) => {
    const steps: Task0RouteStep[] = [];
    // 앞 툴 패스가 칠한 것 (2재료 두 번째 패스) — 교차 검사·우회 격자 대상, 출력 painted 에는 안 넣는다
    const painted: PaintedSeg[] = (input.paintedBefore ?? []).map((sg) => toPainted([sg.x0, sg.y0], [sg.x1, sg.y1]));
    // 같은 선분의 정수 µm 사본 (엄격 판정용 — writer 좌표가 µm 정수라 반올림은 원래 값으로 돌아간다)
    const paintedUm: Task0UmSegment[] = (input.paintedBefore ?? []).map((sg) => [
      [toUm(sg.x0), toUm(sg.y0)],
      [toUm(sg.x1), toUm(sg.y1)],
    ]);
    const paintedOut: Task0DepositSegment[] = [];
    // 격자는 처음 A* 가 필요할 때 만든다 (그때까지 칠한 것을 한꺼번에 찍고, 이후는 칠할 때마다)
    const det: { lattice: DetourLattice | null } = { lattice: null };
    let cur: Task0UmPoint = input.startUm;
    // 층 첫 트래블(파킹 → 첫 도포점, 아직 칠한 것 없음)만 직선 예외 — 앞 패스가 칠했으면 전환 트래블도 검사한다
    let first = painted.length === 0;
    let detourTravels = 0;
    let latticeDetours = 0;
    let unreachable = 0;
    let crossings = 0;
    let firstStuck = -1;
    const emittedSeqs: number[] = [];

    const crosses = (waypoints: Task0UmPoint[]): boolean => crossesPainted([cur, ...waypoints].map(umToMm), painted, w);
    /** 엄격 판정 (c4b 정의) — 시작점 cur 부터의 경로 */
    const contactOk = (pathFromCur: Task0UmPoint[]): boolean =>
      task0TravelContactOk(pathFromCur, paintedUm, paintedUm.length - 1);
    /** 교차 검사(c4) + 엄격 판정(c4b) 둘 다 통과 */
    const clear = (waypoints: Task0UmPoint[]): boolean => !crosses(waypoints) && contactOk([cur, ...waypoints]);

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
      for (const c of standard) if (clear(c.pts)) return c;
      if (!input.detour) return { pts: standard[0].pts, kind: 'crossing' };
      if (!sameY && cur[0] !== target[0]) {
        const lX: Task0UmPoint[] = [[target[0], cur[1]], target];
        if (clear(lX)) return { pts: lX, kind: 'lX' };
      }
      if (det.lattice === null) {
        det.lattice = new DetourLattice(input.regionMm, hUm, blockMm);
        for (const s of painted) det.lattice.stamp(s);
      }
      const path = det.lattice.search(cur, target, next, painted, w, radii, contactOk);
      return path === null ? null : { pts: path, kind: 'detour' };
    };

    let dir: number = input.firstBandDir ?? 1;
    const lastBand = bands.length > 0 ? bands[bands.length - 1] : null;
    for (const band of bands) {
      const list = (byBand.get(band) as RouteItem[]).slice();
      list.sort((p, q) => {
        const kp = dir > 0 ? p.minX : -p.maxX;
        const kq = dir > 0 ? q.minX : -q.maxX;
        return kp - kq || p.minY - q.minY || p.seq - q.seq;
      });
      let emitted = false;
      for (let itemIdx = 0; itemIdx < list.length; itemIdx++) {
        const it = list[itemIdx];
        const isLastItem = band === lastBand && itemIdx === list.length - 1;
        // 방향 후보 (앞 = 우선)
        const fwd = it.pts;
        const rev = it.pts.slice().reverse();
        let orients: Task0UmPoint[][];
        if (it.kind !== 'fill') {
          const pref = (fwd[0][0] <= fwd[fwd.length - 1][0]) === dir > 0 ? fwd : rev;
          // (D1a 2재료 패스) 띠 방향 쪽 끝이 막히면 반대 끝으로
          orients = input.rowsEitherWay && !samePt(fwd[0], fwd[fwd.length - 1]) ? [pref, pref === fwd ? rev : fwd] : [pref];
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
        const flip = flips.has(it.seq) !== (input.reverseLastItem === true && isLastItem);
        if (flip && orients.length === 2) orients = [orients[1], orients[0]];
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
            paintedUm.push([pts[i - 1], pts[i]]);
            if (det.lattice !== null) det.lattice.stamp(seg);
          }
          paintedOut.push(...task0PolylineSegments(pts));
          cur = pts[pts.length - 1];
          first = false;
          done = true;
          emitted = true;
          emittedSeqs.push(it.seq);
          break;
        }
        if (!done) {
          unreachable++;
          if (firstStuck < 0) firstStuck = emittedSeqs.length;
        }
      }
      if (emitted) dir = -dir;
    }
    const result: Task0RouteResult = {
      steps,
      fillPieces,
      dots: input.dots.length,
      detourTravels,
      latticeDetours,
      unreachable,
      crossings,
      painted: paintedOut,
      emittedSeqs,
    };
    return { result, firstStuck, emittedSeqs };
  };

  const initialFlips = new Set<number>(input.flipItems ?? []);
  let best = attempt(initialFlips);
  // (D1a 2재료 패스) 막힌 항목이 있으면 그 앞에 낸 항목(바로 앞부터 셋까지)의 방향을 뒤집어 다시 — 노즐이 이음점에서 끝나
  //   다음 항목으로 못 떠나는 경우(엄격 판정)를 다른 끝으로 끝내게. 경로 없는 항목이 줄거나(같으면 더 뒤에서 막히면) 채택.
  //   막힌 항목이 없으면 이 단계는 없다 — 통과하는 계획은 그대로.
  if (input.retryOnStuck && best.result.unreachable > 0) {
    let flips = new Set<number>(initialFlips);
    let tries = 0;
    const better = (a: typeof best, b: typeof best): boolean =>
      a.result.unreachable < b.result.unreachable ||
      (a.result.unreachable === b.result.unreachable && a.firstStuck > b.firstStuck);
    while (best.result.unreachable > 0 && tries < STUCK_RETRY_MAX) {
      const before = best.emittedSeqs.slice(0, best.firstStuck);
      let improved = false;
      for (let k = 1; k <= STUCK_RETRY_BACK && k <= before.length && tries < STUCK_RETRY_MAX; k++) {
        const seq = before[before.length - k];
        if (!flippable(items[seq])) continue;
        const trial = new Set(flips);
        if (trial.has(seq)) trial.delete(seq);
        else trial.add(seq);
        tries++;
        const r = attempt(trial);
        if (better(r, best)) {
          best = r;
          flips = trial;
          improved = true;
          break;
        }
      }
      if (!improved) break;
    }
  }
  return best.result;
}
