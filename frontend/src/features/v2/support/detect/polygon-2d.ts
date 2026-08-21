// 2D 폴리곤 순수 기하 헬퍼 — Babylon 의존 없음.
//   layer-graph / place-points 가 공유한다. 좌표는 world (X, Z) 평면.
//   기존 slice-geometry.ts(슬라이스 코어)와 역할이 다르다: 여기는 이미 만들어진
//   닫힌 폴리곤에 대한 면적·무게중심·포함 판정만 담당.

import type { Point2 } from "./types";

/** 폴리곤 서명 면적 × 2 (부호는 winding 방향). */
function signedArea2(poly: Point2[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % n];
    s += x0 * z1 - x1 * z0;
  }
  return s;
}

/** 폴리곤 면적 (mm²). winding 방향 무관 절대값. */
export function polygonArea(poly: Point2[]): number {
  if (poly.length < 3) return 0;
  return Math.abs(signedArea2(poly)) * 0.5;
}

/**
 * 폴리곤 무게중심 (world X, Z). 면적이 0(퇴화)이면 정점 평균으로 폴백.
 *   가늘고 긴 폴리곤도 대표점을 안정적으로 얻기 위한 표준 centroid 공식.
 */
export function polygonCentroid(poly: Point2[]): Point2 {
  const a2 = signedArea2(poly);
  if (Math.abs(a2) < 1e-9) {
    // 퇴화(면적 ~0) — 정점 평균.
    let sx = 0;
    let sz = 0;
    for (const [x, z] of poly) {
      sx += x;
      sz += z;
    }
    const n = Math.max(1, poly.length);
    return [sx / n, sz / n];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, z0] = poly[i];
    const [x1, z1] = poly[(i + 1) % n];
    const cross = x0 * z1 - x1 * z0;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  const f = 1 / (3 * a2);
  return [cx * f, cz * f];
}

/** 폴리곤 XZ 바운딩박스 [minX, minZ, maxX, maxZ]. */
export function polygonBBox(
  poly: Point2[],
): [number, number, number, number] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return [minX, minZ, maxX, maxZ];
}

/**
 * 점 (x, z) 에서 폴리곤 외곽 선분들까지의 최소 거리 (mm).
 *   **내부/외부 무관 — 경계선까지의 거리**만 잰다(부호 없음). 내부 점이면
 *   "가장 가까운 변까지의 거리", 외부 점이면 "가장 가까운 변까지 나간 거리".
 *
 *   layer-graph 의 오버행 검출각 판정(층 팽창, r = lh/tanθ)에서 "아래층 폴리곤
 *   경계에서 r 이내인가"를 재는 데 쓴다. 순수·결정적.
 *
 *   구현은 표준 점-선분 거리: 각 변에 점을 투영하고 파라미터 t 를 [0,1] 로
 *   클램프해 선분 위 최근접점을 구한 뒤 거리를 잰다.
 */
export function distanceToPolygonEdges(
  x: number,
  z: number,
  poly: Point2[],
): number {
  const n = poly.length;
  if (n === 0) return Infinity;
  if (n === 1) return Math.hypot(x - poly[0][0], z - poly[0][1]);

  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [x0, z0] = poly[j];
    const [x1, z1] = poly[i];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len2 = dx * dx + dz * dz;
    // 퇴화 변(길이 0) → 끝점까지의 거리로 처리.
    let t = len2 > 1e-18 ? ((x - x0) * dx + (z - z0) * dz) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const d = Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz));
    if (d < best) best = d;
  }
  return best;
}

/**
 * 점 (px, pz) 가 폴리곤 내부인지 판정 (ray casting even-odd 규칙).
 *   경계 위 점의 처리는 근사(샘플링 용도라 엄밀 경계 판정 불필요).
 */
export function pointInPolygon(
  px: number,
  pz: number,
  poly: Point2[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect =
      zi > pz !== zj > pz &&
      px < ((xj - xi) * (pz - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
