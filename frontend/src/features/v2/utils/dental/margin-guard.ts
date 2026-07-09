/**
 * margin-guard — 지현규 '선택 영역 자동 서포트'(scopedSupportSignal)의 마진 가드 이식.
 *
 * 원본: frontend/src/components/STLViewer.tsx 의 scopedSupportSignal useEffect
 * (지현규 브랜치) 안 "마진 가드 — 30회 perpendicular push, 통과 못 하면 폐기" 시드
 * 보정 블록. 자동 배치된 접점이 마진 라인에서 (0.5mm + bodyR) 안쪽으로 못 들어오게
 * XZ 평면에서 마진 라인 밖으로 밀어내고, 30회 안에 안전 거리를 확보 못 하면 배제한다.
 *
 * 이식 원칙: 원본 코드 블록을 그대로 옮기고 useEffect 지역변수(t.centroid, marginPoints,
 * bodyR, MARGIN_GUARD, MAX_PUSH)를 함수 인자로 바꾸는 최소 변형만 적용했다.
 * 수치·반복 횟수·판정 무변경 (아래 [원본 대응표] 참조).
 *
 * ── 원본 대응표 ──────────────────────────────────────────────────────────────
 *   MARGIN_GUARD    = 0.5   (mm)          — 원본 상수 `const MARGIN_GUARD = 0.5;`
 *   minDist         = MARGIN_GUARD + bodyR — 원본 `const minDist = MARGIN_GUARD + bodyR;`
 *   MAX_PUSH        = 30    (회)          — 원본 `const MAX_PUSH = 30;`
 *   push 방향       = 최근접 마진점 → seed 의 XZ 단위벡터
 *   push 목표거리   = minDist (마진점에서 정확히 minDist 떨어진 점으로 재배치)
 *   d <= 1e-6 이면  = seed 폐기(null) — 마진점과 XZ 동일 위치라 밀 방향 없음
 *   재검증          = push 후 임의 마진점이 minDist2 안이면 seed 폐기(null)
 *   거리 판정       = XZ 평면 거리²만 (서포트 발은 수직 → Y 무시) — 원본 verbatim
 *   bodyR (원본)    = settings.tipBottomDiameter (호출자가 그대로 전달)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * marginPoints 는 findMargin(margin-detect.ts)의 result.points — MARGIN_SAMPLE_STEP
 * (0.2mm) 간격 dense 샘플이라 segment 사이 빈 공간으로 seed 가 새지 않는다 (원본 주석).
 */
import type { Vector3 } from '@babylonjs/core';

/** 마진 가드 상수 — 원본 scopedSupport 블록과 1:1. 변경 전 지현규 컨펌 필수. */
export const MARGIN_GUARD_LOCK = {
  /** 마진 라인 비침범 여유 (mm) — 원본 `MARGIN_GUARD = 0.5`. */
  MARGIN_GUARD: 0.5,
  /** perpendicular push 최대 반복 — 원본 `MAX_PUSH = 30`. */
  MAX_PUSH: 30,
} as const;

/**
 * 후보 접점 하나를 마진 라인 밖으로 가드한다.
 *
 * @param contact     후보 접점 world 좌표 [x, y, z] (원본 t.centroid 대응).
 * @param marginPoints 마진 라인 dense 점 배열 (findMargin result.points).
 * @param bodyR       서포트 몸통 반경 (원본 settings.tipBottomDiameter). minDist 에 가산.
 * @returns 안전 거리를 확보한 조정된 접점 [x, y, z] (Y 는 원본과 동일하게 그대로 유지).
 *          30회 안에 확보 못 하거나 마진점과 XZ 동일 위치면 null (배제).
 *
 * 마진 라인이 없으면(marginPoints 비어 있음) 가드 대상이 없으므로 입력을 그대로 통과.
 */
export function guardContactAgainstMargin(
  contact: [number, number, number],
  marginPoints: Vector3[],
  bodyR: number,
): [number, number, number] | null {
  // 마진 없음 → 가드 불필요. 원본은 marginPoints 가 비면 worstMP 가 없어 첫 반복에서
  //   break, 재검증도 통과 → 입력 그대로. 여기선 동일 결과를 명시적으로 처리.
  if (marginPoints.length === 0) return contact;

  const MARGIN_GUARD = MARGIN_GUARD_LOCK.MARGIN_GUARD;
  const MAX_PUSH = MARGIN_GUARD_LOCK.MAX_PUSH;
  const minDist = MARGIN_GUARD + bodyR;
  const minDist2 = minDist * minDist;

  // seed 는 [x, y, z] 로 유지 (원본 Vector3 대응). Y 는 push 중 불변.
  let sx = contact[0];
  const sy = contact[1];
  let sz = contact[2];
  let alive = true;

  for (let pi = 0; pi < MAX_PUSH; pi++) {
    let worstMPx = 0;
    let worstMPz = 0;
    let hasWorst = false;
    let worstD2 = minDist2;
    for (const mp of marginPoints) {
      const dxm = mp.x - sx;
      const dzm = mp.z - sz;
      const d2 = dxm * dxm + dzm * dzm;
      if (d2 < worstD2) {
        worstD2 = d2;
        worstMPx = mp.x;
        worstMPz = mp.z;
        hasWorst = true;
      }
    }
    if (!hasWorst) break; // minDist 안 마진점 없음 — 안전.
    const dxm = sx - worstMPx;
    const dzm = sz - worstMPz;
    const d = Math.sqrt(worstD2);
    if (d > 1e-6) {
      sx = worstMPx + (dxm / d) * minDist;
      sz = worstMPz + (dzm / d) * minDist;
    } else {
      alive = false; // 마진점과 XZ 동일 위치 → 밀 방향 없음 → 폐기.
      break;
    }
  }

  if (alive) {
    // 재검증 — push 후에도 임의 마진점이 minDist2 안이면 폐기.
    for (const mp of marginPoints) {
      const dxm = mp.x - sx;
      const dzm = mp.z - sz;
      if (dxm * dxm + dzm * dzm < minDist2) {
        alive = false;
        break;
      }
    }
  }

  if (!alive) return null;
  return [sx, sy, sz];
}
