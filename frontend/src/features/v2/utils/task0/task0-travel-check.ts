/**
 * Task0 G-code 트래블 검사 — 칠한 비드와의 여유 거리 d(규격 v0.3.5 §7-2)와 엄격 판정(c4b), 텍스트 기준 (Z1-d)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.5 @ 커밋 481f416
 *   §7-2 "트래블은 칠한 비드의 가장자리를 스치거나 비드 안으로 들어가지 않는다 … 최소 거리 d = w/2 + 노즐 바깥 반지름 + 여유,
 *   실측 전 잠정 d = w. 검증기는 '중심선까지 거리 < d 인 트래블 표본점 0' 으로", §6 "T 전환 직후 첫 트래블은 (0,0) 에서 출발
 *   — 교차 검사를 '(0,0) → 첫 도포점' 으로 계산", §6 ② "B → A 층에서도 A 노즐이 칠한 B 를 가로지르거나 스치지 않아야".
 *   §12 검증기 추가 항목 "§7 트래블 중심선까지 거리 < d 인 표본점 0(T 전환 직후 트래블은 (0,0) 출발로 계산)".
 * 설계: `docs/계획_Z1_task0출력_20261002.md` "Z1-d(§32 반영)".
 *
 * 쓰는 곳: task0-export(단일·2재료 공통 — d 위반은 경고, 엄격 판정은 2재료 자기 검사), verify-task0-travel-clearance.
 *
 * 경로 뽑기 (extractTask0LayerPaths — 예전 task0-export travelContactViolations 와 같은 줄 분류 + T 리셋):
 *   - `; EXECUTABLE_BLOCK_START` 앞은 무시. `;LAYER_CHANGE` 마다 새 층 — 위치 = 파킹, 칠한 선분 비움.
 *   - 도포 = X/Y 와 E 가 같이 있는 G0/G1 줄 → 칠한 선분(정수 µm, 그 줄의 툴). 트래블 경로 = 연속한 XY-only 이동
 *     [C(직전 도포 끝 = 지금 위치), 경유점…, S(다음 도포 시작)]. Z·E 단독·F 단독 줄은 경로를 끊지 않는다.
 *   - `T0`/`T1` 줄 = 툴 전환 — 지금 경로를 닫고 위치 = 파킹 (0,0)(규격 §6 — 매크로가 리프트·파킹 후 다음 줄을 실행).
 *     그래서 전환 직후 첫 트래블은 파킹에서 출발한 경로로 본다(전환 전 끝점 → 첫 도포점 직선은 검사하지 않는다).
 *
 * d 판정 (checkTask0TravelClearance — 우리 정의, 협의 §37 질문 1 로 Task0 확인 받을 것):
 *   - 검사 구간 = 경로에서 시작 호 길이 d 를 뗀 나머지(직전 비드에서 떠나는 구간은 거리 0 에서 시작하므로 불가피).
 *     끝은 떼지 않는다(규격 "이어 칠할 조각 끝점으로 비드 안에 들어가는 것도 금지").
 *   - 칠한 선분 중 S 가 끝점인 것은 뺀다(S 에서 이어 칠함 — 이 제외가 없으면 고리형 채움은 전부 위반).
 *   - 위반 = 검사 구간의 어느 조각이든 칠한 선분과의 최소 거리 < d − 1e-6 (표본점 대신 정확 거리 — 더 엄격).
 *     등호 허용이 핵심이다: 서펜타인 L 이동의 X 다리는 직전 행 중심선에서 정확히 행 간격 w = d 다.
 *   - 칠한 선분은 모든 툴(2재료 — 뒤집은 층의 A 트래블 ↔ B 비드도 같은 d, 규격 §6 ②).
 *
 * 엄격 판정 (checkTask0TravelContact — task0-fill-route task0TravelContactOk = verify-task0-writer c4b 정의 그대로):
 *   교차·경유점 접촉·되짚기 외 겹침 금지. 시작 호 d 안쪽의 실제 교차는 d 판정이 아니라 이것이 잡는다.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음.
 */
import { TASK0_DEFAULTS } from './task0-frame';
import { segSegDist, task0TravelContactOk, trimPolyline, type Task0UmSegment } from './task0-fill-route';
import type { Task0UmPoint } from './task0-thin-fill';

// ==================== 타입 ====================

/** 트래블 경로 하나 (정수 µm) */
export interface Task0TravelPath {
  /** [C, 경유점…, S] — C = 직전 도포 끝(층 첫 트래블·T 전환 뒤면 파킹), S = 다음 도포 시작 */
  points: Task0UmPoint[];
  /** 이 트래블 앞에 그 층에서 칠한 선분 수 — 층 painted 의 앞 이만큼이 이 트래블의 "이미 칠한 것" */
  paintedCount: number;
  /** 이 트래블의 툴 (T 줄 상태, 프리앰블 T0 부터) */
  tool: number;
  /** T 줄 바로 뒤 트래블인지 (출발점 = 파킹) */
  afterToolChange: boolean;
}

/** 층 하나의 칠한 선분과 트래블 */
export interface Task0LayerPaths {
  /** 0-based 층 번호 */
  layer: number;
  /** 칠한 선분 (도포 순서, 정수 µm) */
  painted: Task0UmSegment[];
  /** painted 와 같은 길이 — 선분마다 툴 */
  paintedTool: number[];
  travels: Task0TravelPath[];
}

/** d 위반이 있는 층 하나 */
export interface Task0TravelClearanceViolation {
  /** 0-based 층 번호 */
  layer: number;
  /** 위반 트래블 수 */
  count: number;
  /** 위반 트래블들의 칠한 중심선까지 최소 거리 (mm) */
  minDistMm: number;
  /** 위반 중 다른 툴이 칠한 비드에 다가간 것이 있는지 (2재료 — 뒤집은 층의 A 노즐 ↔ B 비드 등) */
  againstOtherTool: boolean;
}

export interface Task0TravelClearanceOptions {
  /** 파킹 위치 (mm) — 빠지면 TASK0_DEFAULTS */
  parkXMm?: number;
  parkYMm?: number;
  /** 여유 거리 d (mm) — 빠지면 TASK0_DEFAULTS.travelClearanceMm */
  clearanceMm?: number;
}

// ==================== 상수 ====================

const UM_PER_MM = 1000;
/** 거리 판정 여유 — task0-fill-route 교차 검사(c4)와 같은 값 */
const CLEARANCE_EPS = 1e-6;

/** 소수 3자리 mm → 정수 µm (writer 출력은 X/Y 소수 3자리라 정확) */
const toUm = (mm: number): number => Math.round(mm * UM_PER_MM);
const umToMm = (p: Task0UmPoint): [number, number] => [p[0] / UM_PER_MM, p[1] / UM_PER_MM];
const samePt = (a: Task0UmPoint, b: Task0UmPoint): boolean => a[0] === b[0] && a[1] === b[1];

// ==================== 경로 뽑기 ====================

/**
 * G-code 텍스트 → 층마다 칠한 선분·트래블 경로 (머리 주석 "경로 뽑기").
 * @param parkUm 파킹 위치 (정수 µm) — 층 시작·T 전환 뒤 위치
 */
export function extractTask0LayerPaths(gcode: string, parkUm: Task0UmPoint): Task0LayerPaths[] {
  const out: Task0LayerPaths[] = [];
  let started = false;
  let cur: Task0LayerPaths | null = null;
  let pos: Task0UmPoint = parkUm;
  let tool = 0;
  let afterToolChange = false;
  let path: Task0UmPoint[] | null = null;
  const flush = (): void => {
    if (path !== null && cur !== null) {
      cur.travels.push({ points: path, paintedCount: cur.painted.length, tool, afterToolChange });
    }
    path = null;
  };
  for (const raw of gcode.split('\n')) {
    const line = raw.trim();
    if (!started) {
      started = line === '; EXECUTABLE_BLOCK_START';
      continue;
    }
    if (line === ';LAYER_CHANGE') {
      flush();
      cur = { layer: out.length, painted: [], paintedTool: [], travels: [] };
      out.push(cur);
      pos = parkUm;
      afterToolChange = false;
      continue;
    }
    if (line === '' || line.startsWith(';')) continue;
    const toks = line.split(/\s+/);
    const cmd = toks[0].toUpperCase();
    if (cmd === 'T0' || cmd === 'T1') {
      // 툴 전환 — 매크로가 리프트·파킹 (0,0) 후 다음 줄 (규격 §6). 프리앰블 T0 도 툴 상태만 바꾼다
      flush();
      tool = cmd === 'T0' ? 0 : 1;
      pos = parkUm;
      afterToolChange = cur !== null;
      continue;
    }
    if (cur === null || (cmd !== 'G0' && cmd !== 'G1')) continue;
    let x: number | null = null;
    let y: number | null = null;
    let hasE = false;
    for (const t of toks.slice(1)) {
      const k = t[0].toUpperCase();
      if (k === 'X') x = toUm(Number(t.slice(1)));
      else if (k === 'Y') y = toUm(Number(t.slice(1)));
      else if (k === 'E') hasE = true;
    }
    if (x === null && y === null) continue; // Z·E 단독·F 단독 — 경로를 끊지 않는다
    const to: Task0UmPoint = [x ?? pos[0], y ?? pos[1]];
    if (hasE) {
      flush();
      cur.painted.push([pos, to]);
      cur.paintedTool.push(tool);
      afterToolChange = false;
    } else {
      if (path === null) path = [pos];
      path.push(to);
    }
    pos = to;
  }
  flush();
  return out;
}

// ==================== 엄격 판정 (c4b) ====================

/**
 * 트래블 엄격 판정 — 층마다 그 층에서 이미 칠한 선분(모든 툴)과 트래블 경로를 task0TravelContactOk(c4b 정의)로 본다.
 * 직전 도포 선분 = 이미 칠한 것의 마지막(되짚기 허용 대상). T 전환 뒤 경로는 파킹에서 출발한다.
 * @returns 위반이 있는 층과 건수 (층 번호 오름차순)
 */
export function checkTask0TravelContact(gcode: string, parkUm: Task0UmPoint): { layer: number; count: number }[] {
  const out: { layer: number; count: number }[] = [];
  for (const lp of extractTask0LayerPaths(gcode, parkUm)) {
    let count = 0;
    for (const tr of lp.travels) {
      const before = lp.painted.slice(0, tr.paintedCount);
      if (!task0TravelContactOk(tr.points, before, before.length - 1)) count++;
    }
    if (count > 0) out.push({ layer: lp.layer, count });
  }
  return out;
}

// ==================== d 판정 ====================

/**
 * 트래블 하나의 d 판정 (머리 주석 "d 판정") — 칠한 중심선까지 최소 거리가 d − 1e-6 미만이면 그 거리와 다른 툴 여부,
 * 아니면 null.
 * @param painted 그 층에서 이 트래블 앞에 칠한 선분 (정수 µm)
 * @param paintedTool painted 와 같은 길이 — 선분마다 툴
 */
export function task0TravelClearanceMiss(
  points: readonly Task0UmPoint[],
  painted: readonly Task0UmSegment[],
  paintedTool: readonly number[],
  tool: number,
  clearanceMm: number,
): { distMm: number; otherTool: boolean } | null {
  if (painted.length === 0 || points.length < 2) return null;
  const S = points[points.length - 1];
  const pieces = trimPolyline(points.map(umToMm), clearanceMm, 0);
  if (pieces.length === 0) return null;
  const limit = clearanceMm - CLEARANCE_EPS;
  let best = Infinity;
  let otherTool = false;
  for (const [a, b] of pieces) {
    const xMin = Math.min(a[0], b[0]) - limit;
    const xMax = Math.max(a[0], b[0]) + limit;
    const yMin = Math.min(a[1], b[1]) - limit;
    const yMax = Math.max(a[1], b[1]) + limit;
    for (let k = 0; k < painted.length; k++) {
      const [p, q] = painted[k];
      if (samePt(p, S) || samePt(q, S)) continue; // S 에서 이어 칠하는 비드
      const pm = umToMm(p);
      const qm = umToMm(q);
      if (Math.max(pm[0], qm[0]) < xMin || Math.min(pm[0], qm[0]) > xMax || Math.max(pm[1], qm[1]) < yMin || Math.min(pm[1], qm[1]) > yMax) {
        continue; // bbox 로 먼저 거름 — 판정은 같다
      }
      const dd = segSegDist(a, b, pm, qm);
      if (dd < limit) {
        if (dd < best) best = dd;
        if (paintedTool[k] !== tool) otherTool = true;
      }
    }
  }
  return best === Infinity ? null : { distMm: best, otherTool };
}

/**
 * d 판정 — 트래블이 칠한 비드 중심선에서 d 안으로 지나는 곳 (규격 v0.3.5 §7-2, 머리 주석 "d 판정").
 * @returns 위반이 있는 층 (층 번호 오름차순)
 */
export function checkTask0TravelClearance(gcode: string, options: Task0TravelClearanceOptions = {}): Task0TravelClearanceViolation[] {
  const d = TASK0_DEFAULTS;
  const clearanceMm = options.clearanceMm ?? d.travelClearanceMm;
  if (!Number.isFinite(clearanceMm) || clearanceMm <= 0) {
    throw new RangeError(`clearanceMm 는 양의 유한 수여야 함 (받은 값: ${String(clearanceMm)})`);
  }
  const parkUm: Task0UmPoint = [toUm(options.parkXMm ?? d.parkXMm), toUm(options.parkYMm ?? d.parkYMm)];
  const out: Task0TravelClearanceViolation[] = [];
  for (const lp of extractTask0LayerPaths(gcode, parkUm)) {
    let count = 0;
    let minDistMm = Infinity;
    let againstOtherTool = false;
    for (const tr of lp.travels) {
      const miss = task0TravelClearanceMiss(
        tr.points,
        lp.painted.slice(0, tr.paintedCount),
        lp.paintedTool.slice(0, tr.paintedCount),
        tr.tool,
        clearanceMm,
      );
      if (miss === null) continue;
      count++;
      if (miss.distMm < minDistMm) minDistMm = miss.distMm;
      if (miss.otherTool) againstOtherTool = true;
    }
    if (count > 0) out.push({ layer: lp.layer, count, minDistMm, againstOtherTool });
  }
  return out;
}
