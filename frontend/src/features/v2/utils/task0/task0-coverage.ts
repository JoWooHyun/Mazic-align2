/**
 * Task0 도포 커버리지 검사기 — "도포 영역 = 노광 영역" 을 숫자로 (규격서 v0.3.3 §3, Z1-b1)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c §3 "도포 영역 = 노광 영역".
 * 판정 정의의 출처: `docs/references/sim-coverage-20261002.py`(협의 §20·§22 — 문턱 99.9 %·0.75·w·w²·4-연결이
 *   이 시뮬레이션에서 정해졌다). 정의를 시뮬레이션과 맞췄고, `scripts/verify-task0-coverage.mjs` 가 사례 1~7 × w 두 벌로
 *   판정 일치를 확인한다.
 *
 * 층 하나 (checkTask0LayerCoverage):
 *   흰 = task0-mask 래스터 1 (픽셀 중심 표본, nonzero). 검사 영역은 단면 bbox + 여유(ROI) — 프레임 밖 칸은 비흰.
 *   경로까지 거리 = 픽셀 중심에서 **도포 선분까지의 유클리드 거리**(끝 반원 포함). 선분 주변 행마다 거리 ≤ R 인
 *   x 구간을 해석적으로 구해 칠한다(시뮬레이션 stamp 와 같은 원리, 대각 선분까지 일반화) → 0.75·w·w 두 벌 덮임 표.
 *   - 침식(w/2 안쪽) = 흰 픽셀 중 비흰 영역까지 거리 ≥ w/2. 비흰 영역까지 거리 = (가장 가까운 비흰 픽셀 중심까지
 *     EDT 거리) − p/2 — 경계를 흰·비흰 픽셀 중심의 가운데(픽셀 경계)로 본다. 축 방향에서는 비흰 픽셀 정사각형까지의
 *     거리와 같고, 대각에서는 최대 (√2−1)/2·p ≈ 0.015 mm 크게 잡는다. 프레임 밖은 비흰(ROI 여유 칸이 비흰이라 자동).
 *     등호(≥)는 시뮬레이션 inside_er 의 닫힌 부등식(10 + w/2 ≤ x)과 같은 쪽 — 정수 격자 거리라 w 0.5·1.0 에서는 동률이 안 난다.
 *   - (a) 침식 픽셀 중 0.75·w 이내 비율 ≥ 99.9 %. 침식 픽셀 0 이면 통과(비율 NaN — 시뮬레이션 nan 처리와 같음).
 *   - (b) 흰 연결 성분마다 도포 표본점 ≥ 1 (표본점이 놓인 픽셀이 그 성분). 연결성은 **8-연결** — 규격·시뮬레이션에
 *     정의가 없다. 픽셀 중심 표본으로 그린 가는 사선 형상은 대각으로만 이어지는데, 4-연결이면 한 형상이 한 픽셀짜리
 *     "섬" 수백 개로 쪼개져 섬마다 도포점을 요구하게 된다(노광된 레진은 모서리로 이어져 한 덩어리로 굳는다).
 *   - (c) 침식 픽셀 중 0.75·w 밖 픽셀의 **4-연결** 성분 최대 면적 < w² (시뮬레이션 maxcomp 가 4-연결).
 *   - (d) 흰 픽셀 전체 중 w 밖 픽셀의 4-연결 성분 최대 면적 < w².
 *   - 넘침: 도포 선분을 p/2 이하 간격으로 표본(양 끝 포함, 길이 0 이면 1점) → 99 % 이상이 흰 픽셀 위이거나
 *     흰 영역에서 w 이내. 흰 영역까지 거리 = (표본 픽셀 중심에서 가장 가까운 흰 픽셀 중심까지 EDT 거리) − p/2
 *     (침식과 같은 경계 규약. 표본점은 픽셀 안 어디든 있을 수 있어 최대 p/√2 ≈ 0.05 mm 어긋난다 — w 0.5 에 비해 작다).
 *   면적 = 픽셀 수 × p². 문턱 비교는 시뮬레이션처럼 "면적 < w²" (같으면 FAIL).
 *
 * G-code (extractTask0DepositSegments): writer 내부가 아니라 **산출물 텍스트**를 본다. 블록 분할은 Task0 파서 이식판
 *   (task0-gcode-parser, 드라이런·E 유지)으로 — Task0 가 버리는 줄은 여기서도 버려진다. 위치 추적은 Klipper 규칙:
 *   시작 G90·M82(Klipper 기본 — 규격 §4-1 프리앰블 M83 이 있어야 상대 E), G91 이면 XY·E 모두 상대, G92 는 지정 축 재설정
 *   (인자 없으면 전 축 0). 층 블록 시작 위치 = 파킹 (Task0 가 층 사이에 파킹, 규격 §9 — writer 통계와 같은 가정).
 *   도포 = X/Y 가 있는 이동 + 그 줄의 E 증가 > 0 (X/Y 가 그대로여도 점 도포로 본다).
 *
 * 2재료 (D1a — 규격서 v0.3.4 §3·§6, 계획 `docs/계획_하이브리드슬라이서설정_20260928.md` §5-3):
 *   - 층 단면을 재료별로: PA = 슬롯 A 메시들(서포트 포함), PB = 슬롯 B 메시들. 우선순위 차집합 B > A —
 *     R_B = PB, R_A = PA − PB. 노광 PNG(이번 조각에서는 만들지 않음)는 PA ∪ PB 한 장.
 *   - 층 검사(checkTask0LayerCoverage)에 excludePolygonsBed·overflowPolygonsBed 를 주면: (a)(b)(c)(d) 는 재료 영역
 *     R_m(= raster(Pm) AND NOT raster(뺄 쪽)) 과 그 툴의 도포 선분으로, 넘침은 합집합 PA ∪ PB 로 본다. 옵션이 없으면 지금과 같은 결과.
 *   - 파일 전체(checkTask0DualGcodeCoverage): 층마다 A = (PA − PB, T0 선분), B = (PB, T1 선분) 두 번 + B 우선 검사
 *     (T0 표본점이 PB 안쪽 깊이 > 투사 피치 p 인 곳 0 — 행 끝은 w/2 물려 있고, 채움 선은 R_A 픽셀에서 나와 피치 안에서만
 *     어긋날 수 있다. 경계에서 w/2 안의 비드 물림은 규격 §3 이 허용하는 합집합 안 물림이다).
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음.
 */
import { squaredDistanceTransform } from './task0-distance';
import { TASK0_DEFAULTS, bedToPixel, pixelCenterToBed, task0LayerCount } from './task0-frame';
import { parseGcodeText } from './task0-gcode-parser';
import {
  rasterizeTask0Mask,
  rasterizeTask0Region,
  task0ColsWithin,
  task0RoiForBedBox,
  task0RowsWithin,
  type Task0Mask,
  type Task0PixelRoi,
  type Task0RasterFrame,
} from './task0-mask';
import {
  TASK0_SLOT_TOOL,
  task0LayerPolygonsBed,
  task0SplitMeshesBySlot,
  type Task0BedPolygon,
  type Task0MaterialSlot,
} from './task0-slice';

// ==================== 타입 ====================

/** 도포 선분 (베드 좌표 mm). 길이 0 이면 점 도포 */
export interface Task0DepositSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 그 줄의 E 증가 (mm) */
  e: number;
  /** 툴 번호 (T0 = 0, T1 = 1) */
  tool: number;
}

/**
 * 판정 규칙 — 기본값 = 규격 §3 + 시뮬레이션. 바꾸는 것은 대조군·실험용(검증 스크립트)뿐, 앱은 기본값만 쓴다.
 * 길이 계수는 w 배수, 면적 계수는 w² 배수.
 */
export interface Task0CoverageRules {
  /** 침식 거리 = 계수·w (규격 "w/2 안쪽") */
  erosionFactor: number;
  /** (a)(c) 덮임 반경 = 계수·w */
  innerRadiusFactor: number;
  /** (a) 최소 비율 */
  innerRatioMin: number;
  /** (d) 덮임 반경 = 계수·w */
  allRadiusFactor: number;
  /** (c)(d) 성분 면적 문턱 = 계수·w² (면적 < 문턱 이어야 통과) */
  holeAreaFactor: number;
  /** (c)(d) 미덮임 성분 연결성 */
  holeConnectivity: 4 | 8;
  /** (b) 흰 성분 연결성 */
  islandConnectivity: 4 | 8;
  /** 넘침 허용 거리 = 계수·w (흰 영역에서) */
  overflowDistFactor: number;
  /** 넘침 최소 비율 */
  overflowRatioMin: number;
}

/** 규격 §3 기본 규칙 */
export const TASK0_COVERAGE_RULES: Readonly<Task0CoverageRules> = Object.freeze({
  erosionFactor: 0.5,
  innerRadiusFactor: 0.75,
  innerRatioMin: 0.999,
  allRadiusFactor: 1.0,
  holeAreaFactor: 1.0,
  holeConnectivity: 4,
  islandConnectivity: 8,
  overflowDistFactor: 1.0,
  overflowRatioMin: 0.99,
});

export interface Task0CoverageOptions {
  /** 도포폭 w (mm) — 기본 TASK0_DEFAULTS.depositWidthMm */
  depositWidthMm?: number;
  frame?: Task0RasterFrame;
  /** 판정 규칙 일부 덮어쓰기 (대조군·실험용) */
  rules?: Partial<Task0CoverageRules>;
  /** true 면 실패 성분 목록(uncovered)을 함께 돌려준다 — 얇은 부분 채움(Z1-b2)용 */
  detail?: boolean;
  /**
   * (D1a 2재료) 흰 영역에서 뺄 단면 — 재료 영역 R_A = PA − PB(B 우선). (a)(b)(c)(d) 는 뺀 영역 기준(task0-mask
   * rasterizeTask0Region). 없으면 지금과 같은 결과.
   */
  excludePolygonsBed?: readonly Task0BedPolygon[];
  /**
   * (D1a 2재료) 넘침 기준 흰 영역 — 두 재료 합집합 PA ∪ PB(규격 §3 "2재료 경계 물림은 두 재료 합친 흰 영역 안이면 허용").
   * 없으면 흰 영역 그대로(지금과 같은 결과). 주면 검사 영역(ROI)도 이 단면까지 덮는다.
   */
  overflowPolygonsBed?: readonly Task0BedPolygon[];
}

/** 성분 하나 — 좌표는 픽셀 중심 베드 mm */
export interface Task0CoverageComponent {
  pixels: number;
  areaMm2: number;
  xMinMm: number;
  xMaxMm: number;
  yMinMm: number;
  yMaxMm: number;
  /** 성분 안에서 비흰 영역까지 가장 먼 픽셀 중심 — 점 도포·중심선 시작 후보 */
  innerXMm: number;
  innerYMm: number;
  /** 그 픽셀의 비흰 영역까지 거리 (mm, 침식과 같은 규약 = EDT − p/2) */
  innerDepthMm: number;
}

export interface Task0LayerCoverage {
  /** 검사 영역(ROI) — 투사 프레임 픽셀 번호 */
  roi: Task0PixelRoi;
  /** 흰 픽셀 수 */
  whitePixels: number;
  /** 단면 안이지만 투사 프레임 밖이라 잘린 픽셀 수 (출력 가능 영역 검사는 Z2) */
  clippedPixels: number;
  /** 도포 선분 수 */
  segments: number;
  a: { innerPixels: number; coveredPixels: number; coveredRatio: number; pass: boolean };
  b: { components: number; withoutDeposit: number; pass: boolean };
  /** components = 미덮임 성분 수, oversized = 면적 ≥ 문턱 인 성분 수 */
  c: { components: number; oversized: number; maxAreaMm2: number; pass: boolean };
  d: { components: number; oversized: number; maxAreaMm2: number; pass: boolean };
  overflow: { samples: number; okSamples: number; okRatio: number; pass: boolean };
  pass: boolean;
  /** detail 옵션일 때만 — b: 도포점 없는 흰 성분, c·d: 면적 ≥ 문턱 미덮임 성분 */
  uncovered?: { b: Task0CoverageComponent[]; c: Task0CoverageComponent[]; d: Task0CoverageComponent[] };
}

// ==================== 기본 연산 ====================

/** 피치 (mm) */
function pitchOf(frame: Task0RasterFrame): number {
  return frame.pixelPitchUm / 1000;
}

/** a·s ∈ [cLo, cHi] 를 s 구간 [sLo, sHi] 에 교차 — a = 0 이면 조건이 s 와 무관 */
function clampLinear(a: number, cLo: number, cHi: number, sLo: number, sHi: number): [number, number] {
  if (a === 0) return cLo <= 0 && 0 <= cHi ? [sLo, sHi] : [1, 0];
  const p = cLo / a;
  const q = cHi / a;
  return a > 0 ? [Math.max(sLo, p), Math.min(sHi, q)] : [Math.max(sLo, q), Math.min(sHi, p)];
}

/**
 * 높이 y 의 수평선에서 선분 AB 까지 거리 ≤ R 인 x 구간 (캡슐은 볼록이라 구간 하나) — 없으면 null.
 * 캡슐 = 양 끝 원판 ∪ 띠(투영이 선분 안 + 수직 거리 ≤ R). 수평 선분이면 [ax − e, bx + e] (e = √(R² − dy²)) —
 * 시뮬레이션 stamp 의 식과 같다.
 */
export function task0CapsuleSpanAtY(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  R: number,
  y: number,
): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const dA = y - ay;
  const qA = R * R - dA * dA;
  if (qA >= 0) {
    const e = Math.sqrt(qA);
    lo = Math.min(lo, ax - e);
    hi = Math.max(hi, ax + e);
  }
  const dB = y - by;
  const qB = R * R - dB * dB;
  if (qB >= 0) {
    const e = Math.sqrt(qB);
    lo = Math.min(lo, bx - e);
    hi = Math.max(hi, bx + e);
  }
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy);
  if (L > 0) {
    const ux = dx / L;
    const uy = dy / L;
    // s = x − ax. 투영 0 ≤ s·ux + dA·uy ≤ L, 수직 |−s·uy + dA·ux| ≤ R
    let [sLo, sHi] = clampLinear(ux, -dA * uy, L - dA * uy, -Infinity, Infinity);
    [sLo, sHi] = clampLinear(-uy, -R - dA * ux, R - dA * ux, sLo, sHi);
    if (sLo <= sHi) {
      lo = Math.min(lo, ax + sLo);
      hi = Math.max(hi, ax + sHi);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * 도포 선분들에서 거리 ≤ radiusMm 인 픽셀(중심)을 ROI 격자 out 에 1 로 칠한다 (이미 1 인 칸은 그대로).
 * out 은 행 우선 roi.width × roi.height — 칸 (i, j) = 프레임 픽셀 (col0 + i, row0 + j).
 */
export function stampTask0Coverage(
  segments: readonly Task0DepositSegment[],
  radiusMm: number,
  roi: Task0PixelRoi,
  out: Uint8Array,
  frame: Task0RasterFrame = TASK0_DEFAULTS,
): void {
  if (!(radiusMm >= 0)) throw new RangeError(`반경은 0 이상이어야 함 (받은 값: ${radiusMm})`);
  if (roi.width === 0 || roi.height === 0) return;
  const R = radiusMm;
  const colEnd = roi.col0 + roi.width - 1;
  const rowEnd = roi.row0 + roi.height - 1;
  for (const s of segments) {
    const [rTop, rBot] = task0RowsWithin(Math.min(s.y0, s.y1) - R, Math.max(s.y0, s.y1) + R, frame);
    const r0 = Math.max(rTop, roi.row0);
    const r1 = Math.min(rBot, rowEnd);
    for (let r = r0; r <= r1; r++) {
      const y = pixelCenterToBed(0, r, frame)[1];
      const span = task0CapsuleSpanAtY(s.x0, s.y0, s.x1, s.y1, R, y);
      if (span === null) continue;
      const [cA, cB] = task0ColsWithin(span[0], span[1], frame);
      const c0 = Math.max(cA, roi.col0);
      const c1 = Math.min(cB, colEnd);
      if (c1 < c0) continue;
      const off = (r - roi.row0) * roi.width - roi.col0;
      out.fill(1, off + c0, off + c1 + 1);
    }
  }
}

/** 단면들의 점 bbox 를 덮는 ROI + 여유 (rasterizeTask0Mask 'bbox' 와 같은 식) — 점이 없으면 빈 ROI */
function task0RoiForPolygons(
  polygons: readonly Task0BedPolygon[],
  marginPx: number,
  frame: Task0RasterFrame,
): Task0PixelRoi {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pts of polygons) {
    for (const [x, y] of pts) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  if (xMin === Infinity) return { col0: 0, row0: 0, width: 0, height: 0 };
  return task0RoiForBedBox(xMin, xMax, yMin, yMax, marginPx, frame);
}

/** 선분 표본점 — p/2 이하 간격, 양 끝 포함 (길이 0 이면 1점) */
function forEachSample(s: Task0DepositSegment, spacing: number, fn: (x: number, y: number) => void): void {
  const L = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
  if (L === 0) {
    fn(s.x0, s.y0);
    return;
  }
  const n = Math.max(1, Math.ceil(L / spacing));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    fn(s.x0 + (s.x1 - s.x0) * t, s.y0 + (s.y1 - s.y0) * t);
  }
}

/** 연결 성분 라벨 — labels[i] = 0(배경) 또는 1..count, sizes[label] = 픽셀 수 */
export function labelTask0Components(
  cells: Uint8Array,
  width: number,
  height: number,
  connectivity: 4 | 8,
): { labels: Int32Array; count: number; sizes: number[] } {
  const labels = new Int32Array(width * height);
  const sizes: number[] = [0];
  const stack = new Int32Array(width * height);
  let count = 0;
  const diag = connectivity === 8;
  for (let start = 0; start < cells.length && start < width * height; start++) {
    if (cells[start] === 0 || labels[start] !== 0) continue;
    count++;
    let size = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top > 0) {
      const k = stack[--top];
      size++;
      const i = k % width;
      const j = (k - i) / width;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= height) continue;
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          if (!diag && di !== 0 && dj !== 0) continue;
          const ii = i + di;
          if (ii < 0 || ii >= width) continue;
          const q = jj * width + ii;
          if (cells[q] !== 0 && labels[q] === 0) {
            labels[q] = count;
            stack[top++] = q;
          }
        }
      }
    }
    sizes.push(size);
  }
  return { labels, count, sizes };
}

/** 라벨들의 성분 요약 (wanted[label] = true 인 것만) */
function summarizeComponents(
  labels: Int32Array,
  sizes: number[],
  wanted: (label: number) => boolean,
  distToBlack2: Float64Array,
  roi: Task0PixelRoi,
  frame: Task0RasterFrame,
): Task0CoverageComponent[] {
  const p = pitchOf(frame);
  const n = sizes.length;
  const iMin = new Int32Array(n).fill(2147483647);
  const iMax = new Int32Array(n).fill(-1);
  const jMin = new Int32Array(n).fill(2147483647);
  const jMax = new Int32Array(n).fill(-1);
  const best = new Float64Array(n).fill(-1);
  const bestK = new Int32Array(n).fill(-1);
  const take = new Uint8Array(n);
  for (let l = 1; l < n; l++) take[l] = wanted(l) ? 1 : 0;
  for (let k = 0; k < labels.length; k++) {
    const l = labels[k];
    if (l === 0 || take[l] === 0) continue;
    const i = k % roi.width;
    const j = (k - i) / roi.width;
    if (i < iMin[l]) iMin[l] = i;
    if (i > iMax[l]) iMax[l] = i;
    if (j < jMin[l]) jMin[l] = j;
    if (j > jMax[l]) jMax[l] = j;
    if (distToBlack2[k] > best[l]) {
      best[l] = distToBlack2[k];
      bestK[l] = k;
    }
  }
  const out: Task0CoverageComponent[] = [];
  for (let l = 1; l < n; l++) {
    if (take[l] === 0) continue;
    const [xMin, yMax] = pixelCenterToBed(roi.col0 + iMin[l], roi.row0 + jMin[l], frame);
    const [xMax, yMin] = pixelCenterToBed(roi.col0 + iMax[l], roi.row0 + jMax[l], frame);
    const bi = bestK[l] % roi.width;
    const bj = (bestK[l] - bi) / roi.width;
    const [ix, iy] = pixelCenterToBed(roi.col0 + bi, roi.row0 + bj, frame);
    out.push({
      pixels: sizes[l],
      areaMm2: sizes[l] * p * p,
      xMinMm: xMin,
      xMaxMm: xMax,
      yMinMm: yMin,
      yMaxMm: yMax,
      innerXMm: ix,
      innerYMm: iy,
      innerDepthMm: Math.sqrt(best[l]) * p - p / 2,
    });
  }
  out.sort((u, v) => v.pixels - u.pixels);
  return out;
}

// ==================== 층 검사 ====================

/**
 * 층 하나의 커버리지 (a)(b)(c)(d)·넘침.
 * @param polygonsBed 층 단면 (task0LayerPolygonsBed — writer·마스크와 같은 단면)
 * @param segments 그 층의 도포 선분 (extractTask0DepositSegments — G-code 에서 뽑은 것)
 */
export function checkTask0LayerCoverage(
  polygonsBed: readonly Task0BedPolygon[],
  segments: readonly Task0DepositSegment[],
  options: Task0CoverageOptions = {},
): Task0LayerCoverage {
  const frame = options.frame ?? TASK0_DEFAULTS;
  const w = options.depositWidthMm ?? TASK0_DEFAULTS.depositWidthMm;
  if (!Number.isFinite(w) || w <= 0) throw new RangeError(`depositWidthMm 는 양의 유한 수여야 함 (받은 값: ${w})`);
  const rules: Task0CoverageRules = { ...TASK0_COVERAGE_RULES, ...options.rules };
  const p = pitchOf(frame);

  // ROI = 단면 bbox + 여유. 여유 ≥ 1 이면 비흰 EDT 가 ROI 안에서 정확하다(ROI 밖 비흰 칸보다 가까운 여유 칸이
  // 항상 있음). 넘침 판정에는 ROI 밖 표본이 흰 영역에서 허용 거리보다 확실히 멀도록 허용 거리 + 2 칸.
  const overflowDist = rules.overflowDistFactor * w;
  const marginPx = Math.ceil(overflowDist / p) + 2;
  const exclude = options.excludePolygonsBed ?? [];
  const overflowPolys = options.overflowPolygonsBed ?? null;
  let mask: Task0Mask;
  // 넘침 기준 흰 (2재료 = 합집합). 옵션이 없으면 흰 영역 그대로 — 아래 판정이 지금과 같다
  let overWhite: Uint8Array;
  let overWhitePixels: number;
  if (exclude.length === 0 && overflowPolys === null) {
    mask = rasterizeTask0Mask(polygonsBed, { frame, roi: 'bbox', marginPx });
    overWhite = mask.data;
    overWhitePixels = mask.whitePixels;
  } else {
    // (D1a) 재료 영역 + 합집합 넘침 — ROI 는 두 단면 bbox 를 함께 덮는다(합집합 흰까지 거리를 ROI 안에서 정확히)
    const roiPolys = overflowPolys === null ? polygonsBed : polygonsBed.concat(overflowPolys);
    const roiAll = task0RoiForPolygons(roiPolys, marginPx, frame);
    mask = rasterizeTask0Region(polygonsBed, exclude, { frame, roi: roiAll });
    if (overflowPolys === null) {
      overWhite = mask.data;
      overWhitePixels = mask.whitePixels;
    } else {
      const over = rasterizeTask0Mask(overflowPolys, { frame, roi: roiAll });
      overWhite = over.data;
      overWhitePixels = over.whitePixels;
    }
  }
  const roi: Task0PixelRoi = { col0: mask.col0, row0: mask.row0, width: mask.width, height: mask.height };
  const nPix = roi.width * roi.height;
  const white = mask.data;

  // 비흰까지 EDT (픽셀²) → 침식
  const distToBlack2 = nPix > 0 ? squaredDistanceTransform(white, roi.width, roi.height, 0) : new Float64Array(0);
  const erodeThr = (rules.erosionFactor * w) / p + 0.5;
  const erodeThr2 = erodeThr * erodeThr;

  // 덮임 표 두 벌
  const covInner = new Uint8Array(nPix);
  const covAll = new Uint8Array(nPix);
  stampTask0Coverage(segments, rules.innerRadiusFactor * w, roi, covInner, frame);
  stampTask0Coverage(segments, rules.allRadiusFactor * w, roi, covAll, frame);

  let innerPixels = 0;
  let coveredPixels = 0;
  const uncInner = new Uint8Array(nPix);
  const uncAll = new Uint8Array(nPix);
  for (let k = 0; k < nPix; k++) {
    if (white[k] === 0) continue;
    if (covAll[k] === 0) uncAll[k] = 1;
    if (distToBlack2[k] >= erodeThr2) {
      innerPixels++;
      if (covInner[k] !== 0) coveredPixels++;
      else uncInner[k] = 1;
    }
  }
  const coveredRatio = innerPixels > 0 ? coveredPixels / innerPixels : NaN;
  const aPass = innerPixels === 0 || coveredPixels / innerPixels >= rules.innerRatioMin;

  const holeThr = rules.holeAreaFactor * w * w;
  const compC = labelTask0Components(uncInner, roi.width, roi.height, rules.holeConnectivity);
  const compD = labelTask0Components(uncAll, roi.width, roi.height, rules.holeConnectivity);
  const maxOf = (sizes: number[]): number => sizes.reduce((m, v) => Math.max(m, v), 0);
  const cMax = maxOf(compC.sizes) * p * p;
  const dMax = maxOf(compD.sizes) * p * p;
  const cOversized = compC.sizes.filter((s, l) => l > 0 && s * p * p >= holeThr).length;
  const dOversized = compD.sizes.filter((s, l) => l > 0 && s * p * p >= holeThr).length;

  // (b) 흰 성분 + 넘침 — 같은 표본점
  const islands = labelTask0Components(white, roi.width, roi.height, rules.islandConnectivity);
  const hasDeposit = new Uint8Array(islands.count + 1);
  let distToWhite2: Float64Array | null = null;
  const okThr = overflowDist / p + 0.5;
  const okThr2 = okThr * okThr;
  let samples = 0;
  let okSamples = 0;
  const spacing = p / 2;
  for (const s of segments) {
    forEachSample(s, spacing, (x, y) => {
      samples++;
      const [c, r] = bedToPixel(x, y, frame);
      const i = c - roi.col0;
      const j = r - roi.row0;
      if (i < 0 || j < 0 || i >= roi.width || j >= roi.height) return; // ROI 밖 = 흰 영역에서 허용 거리 밖
      const k = j * roi.width + i;
      if (white[k] !== 0) hasDeposit[islands.labels[k]] = 1;
      // 넘침 — 기준 흰(기본 = 흰 영역 그대로, 2재료 = 합집합) 위이거나 거기서 w 이내
      if (overWhite[k] !== 0) {
        okSamples++;
        return;
      }
      if (overWhitePixels === 0) return;
      if (distToWhite2 === null) distToWhite2 = squaredDistanceTransform(overWhite, roi.width, roi.height, 1);
      if (distToWhite2[k] <= okThr2) okSamples++;
    });
  }
  let withoutDeposit = 0;
  for (let l = 1; l <= islands.count; l++) if (hasDeposit[l] === 0) withoutDeposit++;
  const okRatio = samples > 0 ? okSamples / samples : NaN;
  const overflowPass = samples === 0 || okSamples / samples >= rules.overflowRatioMin;

  const result: Task0LayerCoverage = {
    roi,
    whitePixels: mask.whitePixels,
    clippedPixels: mask.clippedPixels,
    segments: segments.length,
    a: { innerPixels, coveredPixels, coveredRatio, pass: aPass },
    b: { components: islands.count, withoutDeposit, pass: withoutDeposit === 0 },
    c: { components: compC.count, oversized: cOversized, maxAreaMm2: cMax, pass: cMax < holeThr },
    d: { components: compD.count, oversized: dOversized, maxAreaMm2: dMax, pass: dMax < holeThr },
    overflow: { samples, okSamples, okRatio, pass: overflowPass },
    pass: false,
  };
  result.pass = result.a.pass && result.b.pass && result.c.pass && result.d.pass && result.overflow.pass;

  if (options.detail) {
    result.uncovered = {
      b: summarizeComponents(islands.labels, islands.sizes, (l) => hasDeposit[l] === 0, distToBlack2, roi, frame),
      c: summarizeComponents(compC.labels, compC.sizes, (l) => compC.sizes[l] * p * p >= holeThr, distToBlack2, roi, frame),
      d: summarizeComponents(compD.labels, compD.sizes, (l) => compD.sizes[l] * p * p >= holeThr, distToBlack2, roi, frame),
    };
  }
  return result;
}

// ==================== G-code → 도포 선분 ====================

export interface Task0DepositExtraction {
  /** 층별 도포 선분 (인덱스 = 층 N, 빈 층은 []) */
  layers: Task0DepositSegment[][];
  /** 첫 ;LAYER_CHANGE 전(프리앰블)의 도포 선분 수 — 0 이어야 한다(층이 아님) */
  preambleSegments: number;
  /** Task0 파서(드라이런·E 유지) 경고 — 버려진 줄 등 */
  parseWarnings: string[];
}

export interface Task0ExtractOptions {
  /** 층 블록 시작 위치 = Task0 파킹 (mm) — 기본 TASK0_DEFAULTS */
  parkXMm?: number;
  parkYMm?: number;
}

/**
 * G-code 텍스트 → 층별 도포 선분. 블록 분할·줄 정리는 Task0 파서 이식판(드라이런, E 유지)과 같다.
 */
export function extractTask0DepositSegments(
  gcodeText: string,
  options: Task0ExtractOptions = {},
): Task0DepositExtraction {
  const parkX = options.parkXMm ?? TASK0_DEFAULTS.parkXMm;
  const parkY = options.parkYMm ?? TASK0_DEFAULTS.parkYMm;
  const parsed = parseGcodeText(gcodeText, { mode: 'dryrun', keepE: true });

  // Klipper 기본 상태: G90(절대 좌표), M82(절대 E)
  let absCoord = true;
  let absExtrude = true;
  let x = parkX;
  let y = parkY;
  let ePos = 0;
  let tool = 0;
  const layers: Task0DepositSegment[][] = [];
  let preambleSegments = 0;

  for (const blk of parsed.blocks) {
    const segs: Task0DepositSegment[] = [];
    if (blk.isLayer) {
      x = parkX; // Task0 가 층 사이에 파킹 (규격 §9)
      y = parkY;
    }
    for (const raw of blk.gcode.split('\n')) {
      const line = raw.trim();
      if (line === '') continue;
      const toks = line.split(/\s+/);
      const cmd = toks[0].toUpperCase();
      const args = new Map<string, number>();
      for (const t of toks.slice(1)) args.set(t[0].toUpperCase(), Number(t.slice(1)));
      if (cmd === 'G0' || cmd === 'G1') {
        const relE = !absCoord || !absExtrude;
        const nx = args.has('X') ? (absCoord ? 0 : x) + (args.get('X') as number) : x;
        const ny = args.has('Y') ? (absCoord ? 0 : y) + (args.get('Y') as number) : y;
        let de = 0;
        if (args.has('E')) {
          const ev = args.get('E') as number;
          de = relE ? ev : ev - ePos;
          ePos = relE ? ePos + ev : ev;
        }
        if ((args.has('X') || args.has('Y')) && de > 0) {
          segs.push({ x0: x, y0: y, x1: nx, y1: ny, e: de, tool });
        }
        x = nx;
        y = ny;
      } else if (cmd === 'G90') absCoord = true;
      else if (cmd === 'G91') absCoord = false;
      else if (cmd === 'M82') absExtrude = true;
      else if (cmd === 'M83') absExtrude = false;
      else if (cmd === 'G92') {
        if (args.size === 0) {
          x = 0;
          y = 0;
          ePos = 0;
        } else {
          if (args.has('X')) x = args.get('X') as number;
          if (args.has('Y')) y = args.get('Y') as number;
          if (args.has('E')) ePos = args.get('E') as number;
        }
      } else if (cmd === 'T0') tool = 0;
      else if (cmd === 'T1') tool = 1;
    }
    if (blk.isLayer) layers.push(segs);
    else preambleSegments += segs.length;
  }
  return { layers, preambleSegments, parseWarnings: parsed.warnings };
}

// ==================== 파일 전체 ====================

export interface Task0GcodeCoverageOptions extends Task0CoverageOptions, Task0ExtractOptions {
  /** world → 베드 변환 (writer 와 같은 값) — 기본 TASK0_DEFAULTS */
  bedWidthMm?: number;
  bedDepthMm?: number;
}

export interface Task0CoverageWorst {
  /** (a) 최소 비율 (침식 픽셀 있는 층만, 없으면 NaN) */
  aMinRatio: number;
  aLayer: number | null;
  /** (b) 도포점 없는 흰 성분 수 합계 */
  bWithoutDeposit: number;
  bLayer: number | null;
  cMaxAreaMm2: number;
  cLayer: number | null;
  dMaxAreaMm2: number;
  dLayer: number | null;
  /** 넘침 최소 비율 (표본 있는 층만, 없으면 NaN) */
  overflowMinRatio: number;
  overflowLayer: number | null;
  /** 프레임 밖으로 잘린 픽셀 합계 */
  clippedPixels: number;
}

export interface Task0CoverageReport {
  /** G-code 층 수 (;LAYER_CHANGE 블록 수) */
  gcodeLayerCount: number;
  /** task0LayerCount(topY, lh) */
  expectedLayerCount: number;
  layers: (Task0LayerCoverage & { index: number })[];
  /** 판정 FAIL 층 번호 */
  failedLayers: number[];
  preambleSegments: number;
  parseWarnings: string[];
  worst: Task0CoverageWorst;
  /** 층 수 일치 + 프리앰블 도포 0 + 전 층 통과 */
  pass: boolean;
}

/** 최악값 초기값 */
function newCoverageWorst(): Task0CoverageWorst {
  return {
    aMinRatio: NaN,
    aLayer: null,
    bWithoutDeposit: 0,
    bLayer: null,
    cMaxAreaMm2: 0,
    cLayer: null,
    dMaxAreaMm2: 0,
    dLayer: null,
    overflowMinRatio: NaN,
    overflowLayer: null,
    clippedPixels: 0,
  };
}

/** 층 i 의 결과를 최악값에 합친다 */
function accumulateCoverageWorst(worst: Task0CoverageWorst, res: Task0LayerCoverage, i: number): void {
  if (res.a.innerPixels > 0 && !(res.a.coveredRatio >= worst.aMinRatio)) {
    worst.aMinRatio = res.a.coveredRatio;
    worst.aLayer = i;
  }
  if (res.b.withoutDeposit > 0) {
    if (worst.bLayer === null) worst.bLayer = i;
    worst.bWithoutDeposit += res.b.withoutDeposit;
  }
  if (res.c.maxAreaMm2 > worst.cMaxAreaMm2) {
    worst.cMaxAreaMm2 = res.c.maxAreaMm2;
    worst.cLayer = i;
  }
  if (res.d.maxAreaMm2 > worst.dMaxAreaMm2) {
    worst.dMaxAreaMm2 = res.d.maxAreaMm2;
    worst.dLayer = i;
  }
  if (res.overflow.samples > 0 && !(res.overflow.okRatio >= worst.overflowMinRatio)) {
    worst.overflowMinRatio = res.overflow.okRatio;
    worst.overflowLayer = i;
  }
  worst.clippedPixels += res.clippedPixels;
}

/**
 * G-code 산출물 전체 커버리지 — 층 N 단면(task0LayerPolygonsBed)과 G-code 층 N 블록의 도포 선분을 맞대어 본다.
 * @param meshes writer 에 넣은 것과 같은 world 삼각형 (서포트 포함)
 * @param topY writer 와 같은 topY
 */
export function checkTask0GcodeCoverage(
  meshes: readonly Float32Array[],
  topY: number,
  layerHeightMm: number,
  gcodeText: string,
  options: Task0GcodeCoverageOptions = {},
): Task0CoverageReport {
  const bedW = options.bedWidthMm ?? TASK0_DEFAULTS.bedWidthMm;
  const bedD = options.bedDepthMm ?? TASK0_DEFAULTS.bedDepthMm;
  const expected = task0LayerCount(topY, layerHeightMm);
  const ext = extractTask0DepositSegments(gcodeText, options);
  const n = Math.max(expected, ext.layers.length);
  const layers: (Task0LayerCoverage & { index: number })[] = [];
  const worst = newCoverageWorst();
  for (let i = 0; i < n; i++) {
    const polys = i < expected ? task0LayerPolygonsBed(meshes, i, layerHeightMm, bedW, bedD) : [];
    const res = { index: i, ...checkTask0LayerCoverage(polys, ext.layers[i] ?? [], options) };
    layers.push(res);
    accumulateCoverageWorst(worst, res, i);
  }
  const failedLayers = layers.filter((l) => !l.pass).map((l) => l.index);
  return {
    gcodeLayerCount: ext.layers.length,
    expectedLayerCount: expected,
    layers,
    failedLayers,
    preambleSegments: ext.preambleSegments,
    parseWarnings: ext.parseWarnings,
    worst,
    pass: ext.layers.length === expected && ext.preambleSegments === 0 && failedLayers.length === 0,
  };
}

// ==================== 2재료 파일 전체 (D1a) ====================

export interface Task0DualLayerCoverage {
  index: number;
  /** 재료 A — 영역 R_A = PA − PB(B 우선), T0 도포 선분, 넘침은 PA ∪ PB */
  A: Task0LayerCoverage;
  /** 재료 B — 영역 R_B = PB, T1 도포 선분, 넘침은 PA ∪ PB */
  B: Task0LayerCoverage;
  /** B 우선 위반 — T0 표본점 중 PB 안쪽 깊이 > 투사 피치 p 인 것 수 (0 이어야) */
  overlapSamplesA: number;
  /** T0 표본점의 PB 안쪽 최대 깊이 (mm, 전부 PB 밖이면 0) */
  overlapMaxDepthMm: number;
  pass: boolean;
}

export interface Task0DualCoverageReport {
  gcodeLayerCount: number;
  expectedLayerCount: number;
  layers: Task0DualLayerCoverage[];
  failedLayers: number[];
  preambleSegments: number;
  parseWarnings: string[];
  worst: { A: Task0CoverageWorst; B: Task0CoverageWorst };
  /** B 우선 위반 표본 수 합계 */
  overlapSamplesA: number;
  /** T0 표본점의 PB 안쪽 최대 깊이 (mm) */
  overlapMaxDepthMm: number;
  /** B 우선 위반이 있는 층 */
  overlapLayers: number[];
  /** 층 수 일치 + 프리앰블 도포 0 + 전 층 두 재료 통과 + B 우선 위반 0 */
  pass: boolean;
}

/** 점 판정용 변 — 감김(nonzero, 베드 Y 반열림 [yLo, yHi))과 경계 거리 */
interface InsideEdge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * 점 (x, y) 가 단면 안(nonzero — writer 행 구간·마스크와 같은 [시작, 끝)·[yLo, yHi) 규칙)이면 경계까지 거리, 밖이면 0.
 * 감김 = 왼쪽(교차 x ≤ x)에서 지나온 변의 부호 합 — 행 구간 [s, e) 와 같은 쪽.
 */
function insideDepth(edges: readonly InsideEdge[], x: number, y: number): number {
  let winding = 0;
  for (const e of edges) {
    if (e.ay === e.by) continue;
    const rising = e.ay < e.by;
    const yLo = rising ? e.ay : e.by;
    const yHi = rising ? e.by : e.ay;
    if (y < yLo || y >= yHi) continue;
    const xLo = rising ? e.ax : e.bx;
    const xc = xLo + ((e.bx - e.ax) / (e.by - e.ay)) * (y - yLo);
    if (xc <= x) winding += rising ? 1 : -1;
  }
  if (winding === 0) return 0;
  let best = Infinity;
  for (const e of edges) {
    const dx = e.bx - e.ax;
    const dy = e.by - e.ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - e.ax) * dx + (y - e.ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (e.ax + t * dx), y - (e.ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/**
 * 2재료 G-code 전체 커버리지 (D1a) — 층마다 재료별로 checkTask0LayerCoverage + B 우선 검사.
 *   A: 흰 = raster(PA) − raster(PB), 선분 = T0 도포 / B: 흰 = raster(PB), 선분 = T1 도포 / 넘침 = PA ∪ PB (규격 §3).
 *   B 우선: T0 표본점(p/2 간격 — 넘침 표본과 같음)이 PB 안쪽으로 투사 피치 p 보다 깊으면 위반.
 * @param meshes writer 에 넣은 것과 같은 world 삼각형 (서포트 포함)
 * @param slots 메시마다 재료 슬롯 (writer dualMaterial.slots 와 같은 값)
 */
export function checkTask0DualGcodeCoverage(
  meshes: readonly Float32Array[],
  slots: readonly Task0MaterialSlot[],
  topY: number,
  layerHeightMm: number,
  gcodeText: string,
  options: Task0GcodeCoverageOptions = {},
): Task0DualCoverageReport {
  const frame = options.frame ?? TASK0_DEFAULTS;
  const p = pitchOf(frame);
  const bedW = options.bedWidthMm ?? TASK0_DEFAULTS.bedWidthMm;
  const bedD = options.bedDepthMm ?? TASK0_DEFAULTS.bedDepthMm;
  const bySlot = task0SplitMeshesBySlot(meshes, slots);
  const expected = task0LayerCount(topY, layerHeightMm);
  const ext = extractTask0DepositSegments(gcodeText, options);
  const n = Math.max(expected, ext.layers.length);
  const base: Task0CoverageOptions = {
    depositWidthMm: options.depositWidthMm,
    frame: options.frame,
    rules: options.rules,
    detail: options.detail,
  };
  const layers: Task0DualLayerCoverage[] = [];
  const worst = { A: newCoverageWorst(), B: newCoverageWorst() };
  let overlapSamplesA = 0;
  let overlapMaxDepthMm = 0;
  for (let i = 0; i < n; i++) {
    const pa = i < expected ? task0LayerPolygonsBed(bySlot.A, i, layerHeightMm, bedW, bedD) : [];
    const pb = i < expected ? task0LayerPolygonsBed(bySlot.B, i, layerHeightMm, bedW, bedD) : [];
    const union = pa.concat(pb);
    const segs = ext.layers[i] ?? [];
    const segA = segs.filter((s) => s.tool === TASK0_SLOT_TOOL.A);
    const segB = segs.filter((s) => s.tool === TASK0_SLOT_TOOL.B);
    const A = checkTask0LayerCoverage(pa, segA, { ...base, excludePolygonsBed: pb, overflowPolygonsBed: union });
    const B = checkTask0LayerCoverage(pb, segB, { ...base, overflowPolygonsBed: union });
    // B 우선 — T0 표본점이 PB 안쪽 깊이 > p
    const edges: InsideEdge[] = [];
    let bx0 = Infinity;
    let bx1 = -Infinity;
    let by0 = Infinity;
    let by1 = -Infinity;
    for (const pts of pb) {
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % pts.length];
        edges.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1] });
        bx0 = Math.min(bx0, a[0]);
        bx1 = Math.max(bx1, a[0]);
        by0 = Math.min(by0, a[1]);
        by1 = Math.max(by1, a[1]);
      }
    }
    let over = 0;
    let depthMax = 0;
    if (edges.length > 0) {
      for (const s of segA) {
        forEachSample(s, p / 2, (x, y) => {
          if (x < bx0 || x > bx1 || y < by0 || y > by1) return;
          const d = insideDepth(edges, x, y);
          if (d > depthMax) depthMax = d;
          if (d > p) over++;
        });
      }
    }
    overlapSamplesA += over;
    overlapMaxDepthMm = Math.max(overlapMaxDepthMm, depthMax);
    accumulateCoverageWorst(worst.A, A, i);
    accumulateCoverageWorst(worst.B, B, i);
    layers.push({ index: i, A, B, overlapSamplesA: over, overlapMaxDepthMm: depthMax, pass: A.pass && B.pass && over === 0 });
  }
  const failedLayers = layers.filter((l) => !l.pass).map((l) => l.index);
  return {
    gcodeLayerCount: ext.layers.length,
    expectedLayerCount: expected,
    layers,
    failedLayers,
    preambleSegments: ext.preambleSegments,
    parseWarnings: ext.parseWarnings,
    worst,
    overlapSamplesA,
    overlapMaxDepthMm,
    overlapLayers: layers.filter((l) => l.overlapSamplesA > 0).map((l) => l.index),
    pass: ext.layers.length === expected && ext.preambleSegments === 0 && failedLayers.length === 0,
  };
}
