/**
 * Task0 G-code writer — B안 줄 채움 (규격서 v0.3.3 §3·§4·§5·§7·§8·§10)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c. 협의 §25~§26.
 * 설계: `docs/계획_Z1_task0출력_20261002.md` S1~S9 (Z1-a2). 기존 marlin G-code(`utils/gcode/`)와는 별개 —
 *   그쪽 바이트는 이 파일과 무관하게 그대로다(S1).
 * 출력 검사: `utils/task0/task0-gcode-parser.ts`(Task0 파서 이식) + `scripts/verify-task0-writer.mjs`.
 *
 * 입력: world 삼각형(메시마다 Float32Array, 감김 통일된 것 — 앱에서는 `extractWorldTriangles` 결과),
 *   topY(서포트 포함 최고점, 플레이트 0 기준), 층두께 lh.
 *
 * 층 N (규격 §3 — 마스크 PNG 와 같은 단면·같은 채움 규칙):
 *   1. 단면 = (N+0.5)·lh 에서 **메시마다** sliceTrianglesAtY → chainSegments (워커 sliceLayerMask 와 같은 절차).
 *   2. 점을 베드 좌표로(task0-frame worldToBed). 아래 계산은 전부 베드 좌표 mm.
 *      (1·2 는 task0-slice.ts task0LayerPolygonsBed 한 곳 — 마스크 래스터·커버리지 검사기와 같은 단면을 쓴다.)
 *   3. 행 y_k = (층 폴리곤 최소 Y) + w/2 + k·w, y_k < (최대 Y) − w/2 + 1e-9 동안.
 *      층 Y 폭이 w 의 배수가 아니면 마지막 행 띠 위에 w 미만 띠가 남는다(Z1-b 대상 — 통계 rowRemainderMm).
 *   4. 각 행에서 모든 폴리곤 변과의 교차점을 감김 부호와 함께 모아 x 순 정렬 → **감김수 ≠ 0 구간**
 *      (= 래스터라이저 slice-rasterize.ts 와 같은 nonzero 합집합: 겹친 솔리드는 채움, 반대 감김 내벽은 구멍).
 *      수평 변 제외, yLo ≤ y < yHi 반열림 — 식의 꼴은 래스터라이저와 같다. 단 래스터는 픽셀 y(베드 Y 와
 *      반대 방향) 기준이라 베드 기준으로는 닫힌 쪽이 반대다: 행이 꼭짓점을 정확히 지나면 이 writer 는
 *      위쪽(+Y) 단면을 택한다. 그 차이로 생기는 넘침·미도포는 w/2 띠 안이라 무해(Z1-a2 검수에서 확인).
 *      맞닿은 구간(끝 = 다음 시작)은 하나로 잇는다(래스터에서는 연속 픽셀이므로).
 *   5. 구간 양끝을 w/2 씩 안쪽으로 → 1 µm 격자에 맞춘 뒤 길이 ≤ 0 이면 버림(얇은 부분은 Z1-b, 개수는 통계).
 *   6. 행 순서 +Y 단조. 행 안 방향은 서펜타인 — 도포한 행 기준으로 첫 행 +X, 다음 행 −X, … 번갈아.
 *      한 행의 여러 구간은 진행 방향 순서.
 *   7. 이동: 층 첫 트래블(파킹 → 첫 도포점) = 직선 1줄. 같은 행 안 구간 사이 = 행 선을 따라 직선.
 *      행 사이 = L자(먼저 Y 로 다음 행, 그다음 X 로 다음 구간 시작) — 다음 행 선은 아직 안 칠한 곳이라
 *      도포 영역 교차 0 이 구조적으로 보장된다(규격 §7). 길이 0 인 다리는 쓰지 않는다.
 *
 * 리트랙트 상태 기계 (규격 §5, 툴 T0 하나):
 *   - 시작 상태 = 프라이밍 완료·언리트랙트(Task0 가 넘김, §10). 그래서 파일 첫 도포 앞에는 E+r 이 없다.
 *   - 트래블 길이(L자는 두 다리 합) ≥ retractMinTravel 이고 언리트랙트 상태(이미 쓴 툴)면 트래블 전에 E−r.
 *     짧은 트래블은 생략(§5 예외).
 *   - 도포 직전에 리트랙트 상태면 E+r.
 *   - 그 층에서 도포했으면 층 블록 끝에 항상 E−r.
 *   - 빈 층은 E 줄 없음 — **아직 안 쓴 툴도 상태 변경 없음**(계획서 §3 열린 질문의 잠정 답).
 *
 * E (규격 §5): 도포 줄 ΔE = 길이 × w × lh × 과충전 ÷ K. 소수 5자리 + **잔차 이월** — 정확 누적값을
 *   1e-5 단위로 반올림한 값의 차분을 출력하므로 어느 줄에서 끊어도 |출력 누적 − 정확 누적| ≤ 0.5e-5.
 *   길이는 출력한 좌표(1 µm 격자)로 잰다 — 파일만 보고 같은 값을 다시 계산할 수 있게.
 *
 * 출력 형식 (규격 §4·§7·§8, 협의 §26-1):
 *   START 앞 = 단독 주석 줄 메타(Task0 는 무시) → `; EXECUTABLE_BLOCK_START` → G90 → M83 → T0 →
 *   층마다 `;LAYER_CHANGE` / `;Z:{z}` / `;HEIGHT:{lh}` / `G1 Z{z}`(F 없음, ;Z: 와 같은 글자) → 이동들.
 *   빈 층도 4줄 그대로(건너뛰기·중복 제거 금지). 숫자는 고정 소수(X/Y 3자리, E 5자리, Z·HEIGHT 는 lh 에 맞는
 *   자리 후 끝 0 정리), F 정수 — 지수 표기·`-0` 없음. 이동 줄마다 F. 명령 줄 끝 주석 없음, END 마커 없음.
 *   줄바꿈 `\n`, 파일 끝 개행 1개, 같은 입력 → 같은 바이트.
 *
 * 얇은 부분 채움 (Z1-b2 — 규격 §3 (b)(c)(d)·§7 "얇은 부분 채움"):
 *   층마다 B안 행을 만든 뒤 커버리지 검사기(task0-coverage, 1 µm 격자 행 선분 그대로)로 본다.
 *   - 통과하면 위 1~7 그대로 낸다 — **채움이 필요 없는 층의 출력 바이트는 Z1-a2 와 같다**(파일 A·C).
 *   - 실패하면 task0-thin-fill 이 실패 성분의 중심선·점 도포를 만들고(통과할 때까지 반복), task0-fill-route 가
 *     띠 분해(띠 번호 비감소·띠마다 방향 번갈아·띠 안 X 순서)와 교차 검사 통과 트래블(L자·A* 우회)로 순서를 정한다.
 *     리트랙트·E·숫자 표기·층 머리는 위와 같은 함수로 낸다(1 mm 미만 트래블 생략도 경로 길이 기준 그대로).
 *   - 그래도 커버리지 실패이거나 경로 없는 항목이 있으면 그 층을 thinFill 'failed' 로 남긴다 — 파일을 쓰는 쪽
 *     (gen-task0-dryrun, Z2 내보내기)이 totals.thinFillFailedLayers 를 보고 막는다.
 *   - 채움이 있는 파일만 START 앞 메타에 채움 통계 줄을 더한다(없는 파일은 메타도 그대로).
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음(slice-geometry 순수 코어만 사용).
 */
import { checkTask0LayerCoverage, type Task0DepositSegment } from './task0-coverage';
import { routeTask0FillLayer, type Task0RouteResult } from './task0-fill-route';
import { TASK0_DEFAULTS, task0LayerCount, task0LayerZ } from './task0-frame';
import { task0LayerPolygonsBed, type Task0BedPolygon } from './task0-slice';
import { findTask0ThinFills } from './task0-thin-fill';

// ==================== 타입 ====================

/** writer 선택 옵션 — 빠진 값은 TASK0_DEFAULTS (길이 mm, 속도 mm/s) */
export interface Task0WriterOptions {
  depositWidthMm?: number;
  syringeKMm3PerMm?: number;
  overfill?: number;
  retractMm?: number;
  retractMinTravelMm?: number;
  depositSpeedMmS?: number;
  travelSpeedMmS?: number;
  retractSpeedMmS?: number;
  bedWidthMm?: number;
  bedDepthMm?: number;
  parkXMm?: number;
  parkYMm?: number;
  /** 얇은 부분 채움 (기본 true). false 는 대조군·실험용 — 앱은 기본값만 쓴다 */
  thinFill?: boolean;
  /** 채움 층 트래블 우회 (기본 true). false 는 대조군 전용 — 교차하는 트래블을 그대로 낸다 */
  thinFillDetour?: boolean;
  /**
   * 층 진행 콜백 (Z2 — 앱 워커 진행률). 층 하나를 다 쓸 때마다 (끝낸 층 수, 전체 층 수) 로 부른다.
   * 출력 바이트·통계에는 영향이 없다(읽기만 하는 알림).
   */
  onLayerDone?: (done: number, total: number) => void;
}

/** 기본값을 채우고 검사한 writer 설정 (F 는 mm/min 정수) */
export interface Task0WriterParams {
  depositWidthMm: number;
  syringeKMm3PerMm: number;
  overfill: number;
  retractMm: number;
  retractMinTravelMm: number;
  depositF: number;
  travelF: number;
  retractF: number;
  bedWidthMm: number;
  bedDepthMm: number;
  parkXMm: number;
  parkYMm: number;
}

/** 층별 통계 (Z2 시간 추정·Z1-b 커버리지용) — 길이 mm */
export interface Task0LayerStats {
  /** 0-based 층 번호 */
  index: number;
  /** 층 Z = (N+1)·lh */
  z: number;
  /** XY 이동이 없는 층(= Task0 빈 층 — 파킹·블레이드·LED 생략) */
  empty: boolean;
  /** 단면 폴리곤 수 (0 = 형상 없는 층) */
  polygons: number;
  /** 도포한 행 수 */
  rows: number;
  /** 도포 줄 수 */
  segments: number;
  /** 폭이 w 이하라 버린 구간 수 (Z1-b 에서 중심선·점 도포로 메울 대상) */
  narrowDropped: number;
  /**
   * 행 자리를 다 놓고 층 단면 맨 위(최대 Y)에 남는 띠 높이 (mm, 0 ≤ 값 < w, 1 µm 반올림) —
   * (최대 Y − 최소 Y) − 행 자리 수 × w. 층 전체 기준이라 섬마다 다른 나머지는 Z1-b 커버리지 검사가 맡는다
   */
  rowRemainderMm: number;
  /** 도포 길이 합 */
  depositMm: number;
  /** 트래블 길이 합 — 층 첫 트래블은 파킹 위치에서 잰다 */
  travelMm: number;
  /** E−r 줄 수 */
  retracts: number;
  /** E+r 줄 수 */
  unretracts: number;
  /** 이 층 도포 줄 E 의 출력값 합 (mm) */
  extrusionMm: number;
  /** 얇은 부분 채움 — none: 행만으로 커버리지 통과, filled: 채움으로 통과, failed: 채움 후에도 실패(파일 쓰면 안 됨) */
  thinFill: 'none' | 'filled' | 'failed';
  /** 띠로 자른 중심선 채움 조각 수 */
  fillPieces: number;
  /** 점 도포 수 */
  fillDots: number;
  /** 채움(중심선·점) 도포 줄 수 — 행 도포 줄이 아닌 것 */
  fillSegments: number;
  /** 우회 트래블 수 (X 먼저 L자 + A* — B안 직선·L자가 칠한 곳을 가로지를 때) */
  detourTravels: number;
}

export interface Task0GcodeTotals {
  layerCount: number;
  /** 빈 층 번호 (XY 이동 없음) */
  emptyLayers: number[];
  /** 단면은 있는데 도포가 0 인 층 — 마스크에 흰 픽셀이 있어도 Task0 가 노광을 생략한다(Z1-b 대상) */
  sectionWithoutDeposit: number[];
  depositMm: number;
  travelMm: number;
  retracts: number;
  unretracts: number;
  segments: number;
  narrowDropped: number;
  /** 층별 rowRemainderMm 의 최댓값 (mm) */
  rowRemainderMaxMm: number;
  /** 도포 E 출력값 합 (mm) */
  extrusionMm: number;
  /** 도포 E 정확 합 (mm) — extrusionMm 과의 차이 ≤ 0.5e-5 */
  extrusionExactMm: number;
  /** 채움이 들어간 층 번호 (thinFill 'filled') */
  thinFillLayers: number[];
  /** 채움 후에도 커버리지 실패이거나 경로 없는 항목이 남은 층 — 비어 있어야 파일을 쓴다 */
  thinFillFailedLayers: number[];
  fillPieces: number;
  fillDots: number;
  fillSegments: number;
  detourTravels: number;
  /** 파일 줄 수 (끝 개행 기준) */
  lineCount: number;
  /** 출력한 XY 좌표 범위 (이동이 하나도 없으면 null) */
  xyBounds: { xMin: number; xMax: number; yMin: number; yMax: number } | null;
}

export interface Task0GcodeResult {
  gcode: string;
  layers: Task0LayerStats[];
  totals: Task0GcodeTotals;
  params: Task0WriterParams;
}

// ==================== 상수 ====================

/** 좌표 격자 (1 µm) — X/Y 소수 3자리 */
const UM_PER_MM = 1000;
/** E 단위 (1e-5 mm) — E 소수 5자리 */
const E_TICKS_PER_MM = 100000;
/** 행 반복 종료 여유 (계획서 S5) */
const ROW_EPS = 1e-9;
/** 맞닿은 구간 잇기 허용치 (mm) */
const SPAN_JOIN_EPS = 1e-9;
/** 트래블 리트랙트 판정 여유 (mm) — 1.0 mm 가 부동소수로 0.9999… 가 돼도 리트랙트 쪽으로 */
const TRAVEL_EPS = 1e-9;

/** START 앞 메타 첫 줄 */
export const TASK0_WRITER_ID = 'MazicAlign v2 task0-gcode-writer (Z1-a2)';

// ==================== 설정 ====================

function positiveOr(name: string, value: number | undefined, fallback: number): number {
  const v = value === undefined ? fallback : value;
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} 는 양의 유한 수여야 함 (받은 값: ${String(v)})`);
  return v;
}

function finiteOr(name: string, value: number | undefined, fallback: number): number {
  const v = value === undefined ? fallback : value;
  if (!Number.isFinite(v)) throw new RangeError(`${name} 는 유한 수여야 함 (받은 값: ${String(v)})`);
  return v;
}

/** mm/s → F (mm/min 정수, 최소 1) */
function speedToF(name: string, value: number | undefined, fallback: number): number {
  return Math.max(1, Math.round(positiveOr(name, value, fallback) * 60));
}

/** 옵션에 기본값을 채우고 검사한다 — 검증 스크립트도 같은 값을 쓰도록 공개 */
export function resolveTask0WriterParams(options: Task0WriterOptions = {}): Task0WriterParams {
  const d = TASK0_DEFAULTS;
  const overfill = positiveOr('overfill', options.overfill, d.overfill);
  if (overfill > d.overfillMax) {
    throw new RangeError(`overfill 상한 ${d.overfillMax} 초과 (받은 값: ${overfill}) — 규격 §5`);
  }
  return {
    depositWidthMm: positiveOr('depositWidthMm', options.depositWidthMm, d.depositWidthMm),
    syringeKMm3PerMm: positiveOr('syringeKMm3PerMm', options.syringeKMm3PerMm, d.syringeKMm3PerMm),
    overfill,
    retractMm: positiveOr('retractMm', options.retractMm, d.retractMm),
    retractMinTravelMm: positiveOr('retractMinTravelMm', options.retractMinTravelMm, d.retractMinTravelMm),
    depositF: speedToF('depositSpeedMmS', options.depositSpeedMmS, d.depositSpeedMmS),
    travelF: speedToF('travelSpeedMmS', options.travelSpeedMmS, d.travelSpeedMmS),
    retractF: speedToF('retractSpeedMmS', options.retractSpeedMmS, d.retractSpeedMmS),
    bedWidthMm: positiveOr('bedWidthMm', options.bedWidthMm, d.bedWidthMm),
    bedDepthMm: positiveOr('bedDepthMm', options.bedDepthMm, d.bedDepthMm),
    parkXMm: finiteOr('parkXMm', options.parkXMm, d.parkXMm),
    parkYMm: finiteOr('parkYMm', options.parkYMm, d.parkYMm),
  };
}

// ==================== 숫자 표기 ====================

/** 정수 n 을 10^decimals 로 나눈 고정 소수 문자열 — 지수 표기·`-0` 이 나올 수 없다 */
function fixedFromInt(n: number, decimals: number): string {
  const neg = n < 0;
  const a = Math.abs(n);
  const scale = 10 ** decimals;
  const ip = Math.floor(a / scale);
  const fp = a - ip * scale;
  return (neg ? '-' : '') + String(ip) + '.' + String(fp).padStart(decimals, '0');
}

/** mm → 1 µm 격자 정수 */
function toUm(mm: number): number {
  const u = Math.round(mm * UM_PER_MM);
  return u === 0 ? 0 : u; // -0 정리
}

/** lh 를 정확히 나타내는 소수 자리 (최소 4, 최대 6) — Z·HEIGHT 표기용 */
function layerNumberDecimals(lh: number): number {
  for (let d = 4; d < 6; d++) {
    const s = lh * 10 ** d;
    if (Math.abs(s - Math.round(s)) < 1e-6) return d;
  }
  return 6;
}

/** 양수 고정 소수 후 끝 0 정리 ('0.3000' → '0.3', '10.0000' → '10') */
function trimmedFixed(v: number, decimals: number): string {
  let s = v.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** 메타 주석용 숫자 (소수 6자리 후 끝 0 정리) */
function metaNum(v: number): string {
  return trimmedFixed(v, 6);
}

// ==================== 단면 → 행 구간 ====================

/** 래스터라이저 Edge 와 같은 모양 — 베드 좌표 */
interface ScanEdge {
  yLo: number;
  yHi: number;
  xAtLo: number;
  dxPerY: number;
  /** 감김 부호 — 베드 Y 가 늘어나는 변이 +1 */
  dir: 1 | -1;
}

interface LayerSection {
  /** yLo 오름차순 */
  edges: ScanEdge[];
  yMin: number;
  yMax: number;
}

/** 단면 폴리곤(베드 좌표) → 변 목록 + Y 범위 */
function buildSection(polys: Task0BedPolygon[]): LayerSection {
  const edges: ScanEdge[] = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pts of polys) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a[1] < yMin) yMin = a[1];
      if (a[1] > yMax) yMax = a[1];
      if (a[1] === b[1]) continue; // 수평 변은 행 교차에 기여 없음 (래스터라이저와 같음)
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
  return { edges, yMin, yMax };
}

/** 한 행의 감김수 ≠ 0 구간 (x 오름차순, 맞닿은 구간은 이음). active 는 yLo ≤ y < yHi 인 변만 */
function nonzeroSpans(active: ScanEdge[], y: number): [number, number][] {
  const hits: { x: number; dir: 1 | -1 }[] = [];
  for (const e of active) hits.push({ x: e.xAtLo + e.dxPerY * (y - e.yLo), dir: e.dir });
  hits.sort((p, q) => p.x - q.x);

  const spans: [number, number][] = [];
  let winding = 0;
  let start = 0;
  for (const h of hits) {
    const before = winding;
    winding += h.dir;
    if (before === 0 && winding !== 0) {
      start = h.x;
    } else if (before !== 0 && winding === 0) {
      const last = spans.length > 0 ? spans[spans.length - 1] : null;
      if (last !== null && start - last[1] <= SPAN_JOIN_EPS) last[1] = h.x;
      else spans.push([start, h.x]);
    }
  }
  // 길이 0 구간(꼭짓점에서만 스치는 행)은 형상이 아니므로 조용히 뺀다
  return spans.filter(([s, e]) => e - s > SPAN_JOIN_EPS);
}

interface FillRow {
  /** 행 높이 (µm) */
  yUm: number;
  /** 행 자리 번호 k (y = 최소 Y + (k+0.5)·w) — 채움 층의 띠 번호와 같다 */
  slot: number;
  /** 도포 구간 [시작, 끝] (µm, 오름차순) */
  spans: [number, number][];
}

/**
 * B안 행 목록 — 도포할 구간이 있는 행만, +Y 오름차순.
 * rowRemainderMm = 행 자리(slots 개)를 다 놓고 단면 맨 위에 남는 띠 높이 (형상 없는 층은 0)
 */
function fillRows(
  section: LayerSection,
  w: number,
): { rows: FillRow[]; narrowDropped: number; rowRemainderMm: number } {
  const rows: FillRow[] = [];
  let narrowDropped = 0;
  const half = w / 2;
  const { edges } = section;
  let next = 0;
  let active: ScanEdge[] = [];
  let slots = 0;
  for (; ; slots++) {
    const y = section.yMin + (slots + 0.5) * w;
    if (!(y < section.yMax - half + ROW_EPS)) break;
    while (next < edges.length && edges[next].yLo <= y) active.push(edges[next++]);
    active = active.filter((e) => y >= e.yLo && y < e.yHi);
    const spans: [number, number][] = [];
    for (const [s, e] of nonzeroSpans(active, y)) {
      const a = toUm(s + half);
      const b = toUm(e - half);
      if (b > a) spans.push([a, b]);
      else narrowDropped++;
    }
    if (spans.length > 0) rows.push({ yUm: toUm(y), slot: slots, spans });
  }
  const rowRemainderMm = Number.isFinite(section.yMin)
    ? Math.max(0, toUm(section.yMax - section.yMin - slots * w)) / UM_PER_MM
    : 0;
  return { rows, narrowDropped, rowRemainderMm };
}

// ==================== 얇은 부분 채움 (Z1-b2) ====================

/** 우회 격자 범위 = 단면 bbox + 이 여유 (mm) — 형상 바깥을 돌아갈 자리. 출력 가능 영역으로 자른다 */
const DETOUR_REGION_MARGIN_MM = 1.5;

/**
 * 정확 E 가 1 눈금(1e-5 mm) 이상인 도포 선분만 — 잔차 이월이라 그보다 짧은 줄은 출력 E 가 0 일 수 있고,
 * 커버리지 검사기는 G-code 에서 E 증가 > 0 인 줄만 도포로 본다. 그래서 writer 안의 검사는 이런 줄을 빼고(보수적)
 * 판정한다 — 빼고 통과하면 실제 출력(그 줄이 E 1 눈금으로 나와도)도 통과한다(도포가 늘면 (a)(b)(c)(d) 는 나빠지지 않고,
 * 행 구간은 단면 안이라 넘침도 그대로).
 */
function countedSegments(segs: readonly Task0DepositSegment[], eRatePerMm: number): Task0DepositSegment[] {
  return segs.filter((s) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0) * eRatePerMm * E_TICKS_PER_MM >= 1);
}

/** 행 → 검사기 도포 선분 (1 µm 격자 좌표 그대로 — G-code 를 다시 읽은 값과 같은 double) */
function rowSegments(rows: FillRow[]): Task0DepositSegment[] {
  const out: Task0DepositSegment[] = [];
  for (const row of rows) {
    const y = row.yUm / UM_PER_MM;
    for (const [a, b] of row.spans) out.push({ x0: a / UM_PER_MM, y0: y, x1: b / UM_PER_MM, y1: y, e: 1, tool: 0 });
  }
  return out;
}

interface ThinFillPlan {
  status: 'filled' | 'failed';
  /** 낼 순서 (채움을 하나도 못 만들었으면 null — 행만 낸다) */
  route: Task0RouteResult | null;
}

/**
 * 층 하나의 얇은 부분 채움 계획 — 행만으로 커버리지를 통과하면 null(B안 행 그대로).
 * 통과 못 하면 채움을 만들고(task0-thin-fill) 순서·트래블을 정한 뒤(task0-fill-route), 낼 도포 선분 그대로 다시 검사한다.
 */
function planThinFill(
  polys: Task0BedPolygon[],
  section: LayerSection,
  rows: FillRow[],
  w: number,
  eRatePerMm: number,
  startUm: [number, number],
  detour: boolean,
): ThinFillPlan | null {
  const all = rowSegments(rows);
  const counted = countedSegments(all, eRatePerMm);
  const fills = findTask0ThinFills(
    polys,
    counted,
    { depositWidthMm: w, eRatePerMm, bandOriginMm: section.yMin },
    all.filter((sg) => !counted.includes(sg)),
  );
  if (fills.iterations === 0 && fills.pass) return null;
  if (fills.centerlines.length === 0 && fills.dots.length === 0) return { status: 'failed', route: null };

  let xMin = Infinity;
  let xMax = -Infinity;
  for (const pts of polys) {
    for (const [x] of pts) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
  }
  const d = TASK0_DEFAULTS;
  const m = DETOUR_REGION_MARGIN_MM;
  const route = routeTask0FillLayer({
    rows,
    centerlines: fills.centerlines,
    dots: fills.dots,
    bandOriginMm: section.yMin,
    depositWidthMm: w,
    regionMm: {
      xMin: Math.max(d.printableXMinMm, xMin - m),
      xMax: Math.min(d.printableXMaxMm, xMax + m),
      yMin: Math.max(d.printableYMinMm, section.yMin - m),
      yMax: Math.min(d.printableYMaxMm, section.yMax + m),
    },
    startUm,
    detour,
  });
  const final = checkTask0LayerCoverage(polys, countedSegments(route.painted, eRatePerMm), { depositWidthMm: w });
  const ok = fills.pass && final.pass && route.unreachable === 0;
  return { status: ok ? 'filled' : 'failed', route };
}

// ==================== 본체 ====================

/**
 * world 삼각형 → Task0 G-code (B안 줄 채움).
 * @param meshes 메시별 world 삼각형 (삼각형당 9 float, 감김 통일 — extractWorldTriangles 결과). 읽기만 한다.
 * @param topY 서포트 포함 최고점 (mm, 플레이트 0 기준) — 층 수 = task0LayerCount(topY, lh)
 * @param layerHeightMm 층두께 lh (mm)
 */
export function generateTask0Gcode(
  meshes: readonly Float32Array[],
  topY: number,
  layerHeightMm: number,
  options: Task0WriterOptions = {},
): Task0GcodeResult {
  if (!Number.isFinite(layerHeightMm) || layerHeightMm <= 0) {
    throw new RangeError(`layerHeightMm 는 양의 유한 수여야 함 (받은 값: ${String(layerHeightMm)})`);
  }
  if (!Number.isFinite(topY)) throw new RangeError(`topY 는 유한 수여야 함 (받은 값: ${String(topY)})`);
  const params = resolveTask0WriterParams(options);
  const lh = layerHeightMm;
  const w = params.depositWidthMm;
  const eRatePerMm = (w * lh * params.overfill) / params.syringeKMm3PerMm;
  const retractTicks = Math.max(1, Math.round(params.retractMm * E_TICKS_PER_MM));
  const retractLine = `G1 E${fixedFromInt(-retractTicks, 5)} F${params.retractF}`;
  const unretractLine = `G1 E${fixedFromInt(retractTicks, 5)} F${params.retractF}`;
  const parkXUm = toUm(params.parkXMm);
  const parkYUm = toUm(params.parkYMm);
  const thinFillOn = options.thinFill ?? true;
  const detourOn = options.thinFillDetour ?? true;

  const layerCount = task0LayerCount(topY, lh);
  const zDecimals = layerNumberDecimals(lh);
  const heightText = trimmedFixed(lh, zDecimals);

  const body: string[] = ['; EXECUTABLE_BLOCK_START', 'G90', 'M83', 'T0'];
  const layers: Task0LayerStats[] = [];

  // 툴 T0 상태 — 시작은 프라이밍 완료·언리트랙트 (§10)
  let toolUsed = false;
  let retracted = false;
  let eExact = 0; // 도포 E 정확 누적
  let eTicks = 0; // 도포 E 출력 누적 (1e-5 단위)

  let bxMin = Infinity;
  let bxMax = -Infinity;
  let byMin = Infinity;
  let byMax = -Infinity;
  const touch = (xu: number, yu: number): void => {
    if (xu < bxMin) bxMin = xu;
    if (xu > bxMax) bxMax = xu;
    if (yu < byMin) byMin = yu;
    if (yu > byMax) byMax = yu;
  };

  for (let n = 0; n < layerCount; n++) {
    const z = task0LayerZ(n, lh);
    const zText = trimmedFixed(z, zDecimals);
    body.push(';LAYER_CHANGE', `;Z:${zText}`, `;HEIGHT:${heightText}`, `G1 Z${zText}`);

    // 1) 단면 — 마스크와 같은 절차 (메시마다 자르고 잇기, task0-slice 공유 함수)
    const polys = task0LayerPolygonsBed(meshes, n, lh, params.bedWidthMm, params.bedDepthMm);
    const section = buildSection(polys);
    const { rows, narrowDropped, rowRemainderMm } = fillRows(section, w);
    // 1-b) 얇은 부분 채움 — 행만으로 커버리지 통과면 null (아래 B안 행 그대로)
    const plan =
      thinFillOn && polys.length > 0
        ? planThinFill(polys, section, rows, w, eRatePerMm, [parkXUm, parkYUm], detourOn)
        : null;

    const stat: Task0LayerStats = {
      index: n,
      z,
      empty: true,
      polygons: polys.length,
      rows: rows.length,
      segments: 0,
      narrowDropped,
      rowRemainderMm,
      depositMm: 0,
      travelMm: 0,
      retracts: 0,
      unretracts: 0,
      extrusionMm: 0,
      thinFill: plan === null ? 'none' : plan.status,
      fillPieces: plan?.route?.fillPieces ?? 0,
      fillDots: plan?.route?.dots ?? 0,
      fillSegments: 0,
      detourTravels: plan?.route?.detourTravels ?? 0,
    };

    // 2) 경로 — Task0 가 층 사이에 파킹하므로 층 시작 위치 = 파킹 (통계용)
    let posX = parkXUm;
    let posY = parkYUm;
    let layerTicks = 0;

    /** 트래블 (목표점들을 차례로 직선) — 길이 0 다리는 버림, 합계로 리트랙트 판정 */
    const travel = (targets: [number, number][]): void => {
      const legs: [number, number][] = [];
      let lenMm = 0;
      let cx = posX;
      let cy = posY;
      for (const [x, y] of targets) {
        if (x === cx && y === cy) continue;
        lenMm += Math.hypot(x - cx, y - cy) / UM_PER_MM;
        legs.push([x, y]);
        cx = x;
        cy = y;
      }
      if (legs.length === 0) return;
      if (toolUsed && !retracted && lenMm >= params.retractMinTravelMm - TRAVEL_EPS) {
        body.push(retractLine);
        retracted = true;
        stat.retracts++;
      }
      for (const [x, y] of legs) {
        body.push(`G1 X${fixedFromInt(x, 3)} Y${fixedFromInt(y, 3)} F${params.travelF}`);
        touch(x, y);
      }
      stat.travelMm += lenMm;
      posX = cx;
      posY = cy;
    };

    /** 도포 한 줄 (현재 위치 → 목표) */
    const deposit = (x: number, y: number): void => {
      if (retracted) {
        body.push(unretractLine);
        retracted = false;
        stat.unretracts++;
      }
      const lenMm = Math.hypot(x - posX, y - posY) / UM_PER_MM;
      eExact += lenMm * eRatePerMm;
      const t = Math.round(eExact * E_TICKS_PER_MM);
      const dt = t - eTicks; // 잔차 이월 — 누적 반올림의 차분 (항상 ≥ 0)
      eTicks = t;
      layerTicks += dt;
      body.push(`G1 X${fixedFromInt(x, 3)} Y${fixedFromInt(y, 3)} E${fixedFromInt(dt, 5)} F${params.depositF}`);
      touch(x, y);
      toolUsed = true;
      stat.segments++;
      stat.depositMm += lenMm;
      posX = x;
      posY = y;
    };

    if (plan !== null && plan.route !== null) {
      // 채움 층 — 띠 순서·트래블은 task0-fill-route 가 정했다 (첫 트래블은 파킹에서 직선)
      for (const step of plan.route.steps) {
        if (step.travel.length > 0) travel(step.travel);
        for (const [x, y] of step.deposit) {
          deposit(x, y);
          if (step.kind !== 'row') stat.fillSegments++;
        }
      }
    } else {
      let firstMove = true;
      rows.forEach((row, rowIdx) => {
        const forward = rowIdx % 2 === 0; // 서펜타인: 도포한 첫 행 +X
        const spans = forward ? row.spans : [...row.spans].reverse();
        spans.forEach(([a, b], spanIdx) => {
          const sx = forward ? a : b;
          const ex = forward ? b : a;
          if (firstMove) travel([[sx, row.yUm]]); // 층 첫 트래블 = 직선
          else if (spanIdx === 0) travel([[posX, row.yUm], [sx, row.yUm]]); // 행 사이 L자 (Y 먼저)
          else travel([[sx, row.yUm]]); // 같은 행 안 — 행 선을 따라
          firstMove = false;
          deposit(ex, row.yUm);
        });
      });
    }

    // 3) 층 끝 — 도포했으면 항상 리트랙트 (§5)
    if (stat.segments > 0) {
      body.push(retractLine);
      retracted = true;
      stat.retracts++;
      stat.empty = false;
    }
    stat.extrusionMm = layerTicks / E_TICKS_PER_MM;
    layers.push(stat);
    options.onLayerDone?.(n + 1, layerCount);
  }

  const totals: Task0GcodeTotals = {
    layerCount,
    emptyLayers: layers.filter((s) => s.empty).map((s) => s.index),
    sectionWithoutDeposit: layers.filter((s) => s.empty && s.polygons > 0).map((s) => s.index),
    depositMm: layers.reduce((acc, s) => acc + s.depositMm, 0),
    travelMm: layers.reduce((acc, s) => acc + s.travelMm, 0),
    retracts: layers.reduce((acc, s) => acc + s.retracts, 0),
    unretracts: layers.reduce((acc, s) => acc + s.unretracts, 0),
    segments: layers.reduce((acc, s) => acc + s.segments, 0),
    narrowDropped: layers.reduce((acc, s) => acc + s.narrowDropped, 0),
    rowRemainderMaxMm: layers.reduce((acc, s) => Math.max(acc, s.rowRemainderMm), 0),
    thinFillLayers: layers.filter((s) => s.thinFill === 'filled').map((s) => s.index),
    thinFillFailedLayers: layers.filter((s) => s.thinFill === 'failed').map((s) => s.index),
    fillPieces: layers.reduce((acc, s) => acc + s.fillPieces, 0),
    fillDots: layers.reduce((acc, s) => acc + s.fillDots, 0),
    fillSegments: layers.reduce((acc, s) => acc + s.fillSegments, 0),
    detourTravels: layers.reduce((acc, s) => acc + s.detourTravels, 0),
    extrusionMm: eTicks / E_TICKS_PER_MM,
    extrusionExactMm: eExact,
    lineCount: 0,
    xyBounds:
      bxMin === Infinity
        ? null
        : { xMin: bxMin / UM_PER_MM, xMax: bxMax / UM_PER_MM, yMin: byMin / UM_PER_MM, yMax: byMax / UM_PER_MM },
  };

  // START 앞 메타 — 단독 주석 줄 (Task0 는 START 이전을 무시)
  const header: string[] = [
    `; ${TASK0_WRITER_ID}`,
    '; Task0 G-code spec v0.3.3 (B pattern: serpentine 0 deg row fill, L moves between rows)',
    `; layerCount: ${layerCount}`,
    `; layerHeightMm: ${heightText}`,
    `; topYMm: ${metaNum(topY)}`,
    `; depositWidthMm: ${metaNum(w)}`,
    `; syringeKMm3PerMm: ${metaNum(params.syringeKMm3PerMm)}`,
    `; overfill: ${metaNum(params.overfill)}`,
    `; retractMm: ${fixedFromInt(retractTicks, 5)}`,
    `; retractMinTravelMm: ${metaNum(params.retractMinTravelMm)}`,
    `; depositF: ${params.depositF}`,
    `; travelF: ${params.travelF}`,
    `; retractF: ${params.retractF}`,
    `; emptyLayerCount: ${totals.emptyLayers.length}`,
    `; depositTotalMm: ${totals.depositMm.toFixed(3)}`,
    `; extrusionTotalMm: ${fixedFromInt(eTicks, 5)}`,
  ];
  // 채움이 있는 파일만 (없는 파일의 메타·바이트는 Z1-a2 그대로)
  if (totals.thinFillLayers.length > 0 || totals.thinFillFailedLayers.length > 0) {
    header.push(
      '; thinFill: Z1-b2 centerline and dot fill where rows miss (bands of width w, band index non-decreasing, detour travels)',
      `; thinFillLayerCount: ${totals.thinFillLayers.length}`,
      `; thinFillFailedLayerCount: ${totals.thinFillFailedLayers.length}`,
      `; thinFillPieceCount: ${totals.fillPieces}`,
      `; thinFillDotCount: ${totals.fillDots}`,
      `; detourTravelCount: ${totals.detourTravels}`,
    );
  }

  const lines = header.concat(body);
  totals.lineCount = lines.length;
  return { gcode: lines.join('\n') + '\n', layers, totals, params };
}
