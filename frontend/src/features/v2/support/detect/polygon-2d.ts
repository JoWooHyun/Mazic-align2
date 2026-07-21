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
