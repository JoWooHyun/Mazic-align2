// 서포트 재설계(S-4b-2c-f) **삼각형 레이캐스트 가속 구조** — 순수 모듈, Babylon import 금지.
//   근거: `docs/피드백_2c실물테스트_20260821.md` T-2.
//
//   ## 왜 이 파일이 생겼나 (T-2)
//   2c 의 충돌 프로브는 Babylon `Ray.intersectsMesh` 를 썼다. 이 API 는 가속 구조가
//   없어 **매 광선마다 메시의 전 삼각형**을 훑는다. 우리 라우팅은 bent 점 하나당
//   최대 8방위 × ~37스텝 × 9광선 ≈ 2,700발을 쏘고, 실패 점은 전수 탐색한다 —
//   삼각형 수십만 개짜리 덴처 모델에서는 수백억 번의 삼각형 테스트가 되어 실물에서
//   **생성 버튼에 탭이 죽는다**(리드 실측). 그래서 자체 인덱스를 둔다.
//
//   ## 구조 — 균일 격자(uniform grid) + 3D-DDA
//   BVH 가 아니라 균일 격자를 고른 이유: (1) 구축이 O(n) 한 번 훑기라 생성 버튼을
//   누른 직후의 지연이 짧다, (2) 서포트 대상은 치과 모델처럼 삼각형이 표면에 고르게
//   퍼진 형상이라 격자가 잘 먹는다, (3) 코드가 짧아 검증·감사가 쉽다.
//   광선은 3D-DDA 로 셀을 **가까운 순서대로** 지나가므로, 어떤 셀에서 히트를 찾으면
//   그 셀의 원거리 경계까지만 확인하고 조기 종료할 수 있다(DDA 표준 기법).
//
//   ## 입력 전제 — 감김 정규화 완료
//   `extractWorldTriangles`(slice-section.ts)가 `normalizeTriangleWinding` 을 거쳐
//   내보낸 배열을 그대로 받는다(B-7 관문). 즉 삼각형 기하 법선
//   n = (v1−v0)×(v2−v0) 이 **바깥 방향**임을 신뢰할 수 있고, 그래서 광선이 뒷면을
//   맞았는지(= 모델 내부에서 밖으로 나가는 중인지)를 부호 하나로 판정한다.
//   2c 가 Babylon pick 의 법선을 믿을 수 없어 우회하던 문제가 여기서 사라진다.
//
//   ## 결정성
//   Math.random / Date 를 쓰지 않는다. 셀 크기·순회 순서가 입력만으로 정해지므로
//   같은 입력이면 항상 같은 히트가 나온다. 질의당 힙 할당도 하지 않는다
//   (스탬프 배열·재사용 버퍼만 쓴다) — 광선 수십만 발에서 GC 가 병목이 되지 않게.

import type { Vec3 } from "./route-plan-core";

/** `TriangleIndex.raycast` 결과. */
export interface TriangleRayHit {
  /** 광선 시작점부터의 거리 (mm). */
  distance: number;
  /**
   * 뒷면 히트인가 — 삼각형 기하 법선과 광선 방향의 내적 > 0.
   * 감김이 정규화된 입력이라 이 판정을 신뢰할 수 있다(B-7 관문 공유).
   */
  backface: boolean;
}

/** world 삼각형 배열 위의 레이캐스트 질의 구조. */
export interface TriangleIndex {
  /** 가장 가까운 히트. maxDist 너머·미교차는 null. */
  raycast(origin: Vec3, dir: Vec3, maxDistMm: number): TriangleRayHit | null;
  /** 색인된 삼각형 개수 (진단·검증용). */
  triangleCount: number;
}

/**
 * 격자 한 축의 기본 분할 수 — 셀 크기 = bbox 최장변 / 이 값.
 *
 * ## 근거
 * 균일 격자의 고전적 경험칙은 "셀 개수 ≈ 삼각형 개수"(1축당 ∛n)다. 삼각형
 * 10만 개면 ∛100000 ≈ 46, 100만 개면 100 이다. 64 는 그 대역의 가운데로,
 * 우리가 실제로 다루는 규모(수만~수십만 삼각형)에서 셀당 평균 삼각형이
 * 한 자릿수에 머무는 값이다. 아래 `deriveDivisions` 가 삼각형 수에 맞춰
 * 이 값을 다시 조정하므로 여기서는 하한·기준점 역할만 한다.
 */
const BASE_DIVISIONS = 64;

/** 축당 분할 수 상한 — 셀 배열 메모리(=D³)가 폭주하지 않도록. 128³ ≈ 210만 셀. */
const MAX_DIVISIONS = 128;

/** 축당 분할 수 하한 — 삼각형이 몇 개 없을 때 격자를 잘게 쪼갤 이유가 없다. */
const MIN_DIVISIONS = 1;

/** bbox 를 이만큼(mm) 부풀려 경계면 위의 삼각형이 격자 밖으로 새지 않게 한다. */
const BBOX_PAD_MM = 1e-4;

/** Möller–Trumbore 평행 판정 임계 — |det| 가 이보다 작으면 광선이 삼각형 면과 평행. */
const PARALLEL_EPS = 1e-12;

/**
 * world 삼각형 배열(Float32Array, 삼각형당 9 float)에 균일 격자 인덱스를 씌운다.
 *
 * @param triangles `extractWorldTriangles` 출력 포맷 — v0.x,v0.y,v0.z,v1.x,…,v2.z.
 *                  **감김 정규화 완료 입력을 전제**한다(파일 머리 주석).
 * @param cellSizeMm 셀 한 변 길이 (mm). 미지정이면 bbox·삼각형 수에서 유도한다.
 */
export function buildTriangleIndex(
  triangles: Float32Array,
  cellSizeMm?: number,
): TriangleIndex {
  const triCount = Math.floor(triangles.length / 9);

  // ── bbox ───────────────────────────────────────────────────────────────
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let t = 0; t + 9 <= triangles.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      const x = triangles[t + k * 3];
      const y = triangles[t + k * 3 + 1];
      const z = triangles[t + k * 3 + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
  }
  if (triCount === 0) return makeEmptyIndex();

  minX -= BBOX_PAD_MM;
  minY -= BBOX_PAD_MM;
  minZ -= BBOX_PAD_MM;
  maxX += BBOX_PAD_MM;
  maxY += BBOX_PAD_MM;
  maxZ += BBOX_PAD_MM;

  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  const longest = Math.max(sizeX, sizeY, sizeZ);

  // ── 셀 크기 결정 ────────────────────────────────────────────────────────
  const cell =
    cellSizeMm != null && cellSizeMm > 0
      ? cellSizeMm
      : longest / deriveDivisions(triCount);
  const nx = axisCount(sizeX, cell);
  const ny = axisCount(sizeY, cell);
  const nz = axisCount(sizeZ, cell);
  const cellCount = nx * ny * nz;

  // ── 삼각형을 셀에 등록 (삼각형 AABB 가 겹치는 모든 셀) ──────────────────
  //   2-pass counting sort — 셀별 배열을 만들지 않고 CSR 형태(오프셋+평탄 목록)로
  //   담는다. 셀 수십만 개짜리 배열의 배열은 할당만으로도 비싸다.
  const counts = new Int32Array(cellCount + 1);
  const cellRange = new Int32Array(6); // [ix0, ix1, iy0, iy1, iz0, iz1] 재사용 버퍼.

  for (let t = 0, tri = 0; t + 9 <= triangles.length; t += 9, tri++) {
    triCellRange(triangles, t, minX, minY, minZ, cell, nx, ny, nz, cellRange);
    for (let iz = cellRange[4]; iz <= cellRange[5]; iz++) {
      for (let iy = cellRange[2]; iy <= cellRange[3]; iy++) {
        const rowBase = (iz * ny + iy) * nx;
        for (let ix = cellRange[0]; ix <= cellRange[1]; ix++) {
          counts[rowBase + ix + 1]++;
        }
      }
    }
  }
  for (let i = 0; i < cellCount; i++) counts[i + 1] += counts[i];

  const total = counts[cellCount];
  const items = new Int32Array(total);
  const cursor = new Int32Array(cellCount);
  for (let t = 0, tri = 0; t + 9 <= triangles.length; t += 9, tri++) {
    triCellRange(triangles, t, minX, minY, minZ, cell, nx, ny, nz, cellRange);
    for (let iz = cellRange[4]; iz <= cellRange[5]; iz++) {
      for (let iy = cellRange[2]; iy <= cellRange[3]; iy++) {
        const rowBase = (iz * ny + iy) * nx;
        for (let ix = cellRange[0]; ix <= cellRange[1]; ix++) {
          const c = rowBase + ix;
          items[counts[c] + cursor[c]] = tri;
          cursor[c]++;
        }
      }
    }
  }

  // 같은 삼각형 중복 검사 방지용 스탬프. 질의마다 배열을 지우지 않고 광선 id 를
  //   올려 비교한다(할당·clear 둘 다 없음).
  const stamp = new Int32Array(triCount);
  let rayId = 0;

  return {
    triangleCount: triCount,

    raycast(origin: Vec3, dir: Vec3, maxDistMm: number): TriangleRayHit | null {
      if (!(maxDistMm > 0)) return null;
      const ox = origin[0];
      const oy = origin[1];
      const oz = origin[2];
      const dx = dir[0];
      const dy = dir[1];
      const dz = dir[2];

      // 격자 bbox 와의 교차 구간 [tEnter, tExit] — 밖에서 출발하면 여기까지 건너뛴다.
      let tEnter = 0;
      let tExit = maxDistMm;
      // X
      let r = slab(ox, dx, minX, maxX, tEnter, tExit);
      if (r === null) return null;
      tEnter = r[0];
      tExit = r[1];
      r = slab(oy, dy, minY, maxY, tEnter, tExit);
      if (r === null) return null;
      tEnter = r[0];
      tExit = r[1];
      r = slab(oz, dz, minZ, maxZ, tEnter, tExit);
      if (r === null) return null;
      tEnter = r[0];
      tExit = r[1];

      rayId++;
      const id = rayId;

      // DDA 초기화 — 진입점이 속한 셀부터.
      const px = ox + dx * tEnter;
      const py = oy + dy * tEnter;
      const pz = oz + dz * tEnter;
      let ix = clampInt(Math.floor((px - minX) / cell), 0, nx - 1);
      let iy = clampInt(Math.floor((py - minY) / cell), 0, ny - 1);
      let iz = clampInt(Math.floor((pz - minZ) / cell), 0, nz - 1);

      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

      // 다음 셀 경계까지의 t, 셀 하나를 건너는 데 드는 t.
      let tMaxX = nextBoundaryT(ox, dx, minX, cell, ix, stepX);
      let tMaxY = nextBoundaryT(oy, dy, minY, cell, iy, stepY);
      let tMaxZ = nextBoundaryT(oz, dz, minZ, cell, iz, stepZ);
      const tDeltaX = stepX === 0 ? Infinity : cell / Math.abs(dx);
      const tDeltaY = stepY === 0 ? Infinity : cell / Math.abs(dy);
      const tDeltaZ = stepZ === 0 ? Infinity : cell / Math.abs(dz);

      let bestT = Infinity;
      let bestBack = false;

      for (;;) {
        const c = (iz * ny + iy) * nx + ix;
        const from = counts[c];
        const to = counts[c + 1];
        for (let k = from; k < to; k++) {
          const tri = items[k];
          if (stamp[tri] === id) continue; // 이미 이 광선이 검사한 삼각형.
          stamp[tri] = id;
          const hit = intersectTriangle(triangles, tri * 9, ox, oy, oz, dx, dy, dz);
          if (hit === null) continue;
          const t = hit.t;
          if (t < 0 || t > maxDistMm) continue;
          if (t < bestT) {
            bestT = t;
            bestBack = hit.backface;
          }
        }

        // 이 셀을 나가는 t. 히트가 그 안이면 더 볼 필요가 없다(DDA 조기 종료).
        const tCellExit = Math.min(tMaxX, tMaxY, tMaxZ);
        if (bestT <= tCellExit) break;
        if (tCellExit >= tExit) break;

        // 다음 셀로.
        if (tMaxX < tMaxY) {
          if (tMaxX < tMaxZ) {
            ix += stepX;
            if (ix < 0 || ix >= nx) break;
            tMaxX += tDeltaX;
          } else {
            iz += stepZ;
            if (iz < 0 || iz >= nz) break;
            tMaxZ += tDeltaZ;
          }
        } else if (tMaxY < tMaxZ) {
          iy += stepY;
          if (iy < 0 || iy >= ny) break;
          tMaxY += tDeltaY;
        } else {
          iz += stepZ;
          if (iz < 0 || iz >= nz) break;
          tMaxZ += tDeltaZ;
        }
      }

      if (bestT === Infinity) return null;
      return { distance: bestT, backface: bestBack };
    },
  };
}

/** 삼각형이 없을 때의 빈 인덱스 — 항상 청명. */
function makeEmptyIndex(): TriangleIndex {
  return {
    triangleCount: 0,
    raycast: () => null,
  };
}

/**
 * 삼각형 수에서 축당 분할 수를 유도한다 — 셀 개수 ≈ 삼각형 개수 경험칙(∛n).
 *   BASE_DIVISIONS 를 기준으로 하되 [MIN, MAX] 로 클램프한다.
 */
function deriveDivisions(triCount: number): number {
  const byCount = Math.round(Math.cbrt(Math.max(triCount, 1)));
  const d = Math.max(byCount, Math.min(BASE_DIVISIONS, byCount * 2));
  return clampInt(d, MIN_DIVISIONS, MAX_DIVISIONS);
}

/** 한 축의 셀 개수 — 최소 1개. */
function axisCount(size: number, cell: number): number {
  if (!(cell > 0) || !(size > 0)) return 1;
  return clampInt(Math.ceil(size / cell), 1, MAX_DIVISIONS * 4);
}

/**
 * 삼각형 하나의 AABB 가 덮는 셀 인덱스 범위를 `out`([ix0,ix1,iy0,iy1,iz0,iz1])에 쓴다.
 *   AABB 기준이라 실제로 안 겹치는 셀에도 등록될 수 있지만(보수적), 히트 판정은
 *   Möller–Trumbore 가 하므로 정확성에는 영향이 없고 약간의 여분 검사만 생긴다.
 */
function triCellRange(
  tris: Float32Array,
  off: number,
  minX: number,
  minY: number,
  minZ: number,
  cell: number,
  nx: number,
  ny: number,
  nz: number,
  out: Int32Array,
): void {
  let loX = Infinity;
  let loY = Infinity;
  let loZ = Infinity;
  let hiX = -Infinity;
  let hiY = -Infinity;
  let hiZ = -Infinity;
  for (let k = 0; k < 3; k++) {
    const x = tris[off + k * 3];
    const y = tris[off + k * 3 + 1];
    const z = tris[off + k * 3 + 2];
    if (x < loX) loX = x;
    if (y < loY) loY = y;
    if (z < loZ) loZ = z;
    if (x > hiX) hiX = x;
    if (y > hiY) hiY = y;
    if (z > hiZ) hiZ = z;
  }
  out[0] = clampInt(Math.floor((loX - minX) / cell), 0, nx - 1);
  out[1] = clampInt(Math.floor((hiX - minX) / cell), 0, nx - 1);
  out[2] = clampInt(Math.floor((loY - minY) / cell), 0, ny - 1);
  out[3] = clampInt(Math.floor((hiY - minY) / cell), 0, ny - 1);
  out[4] = clampInt(Math.floor((loZ - minZ) / cell), 0, nz - 1);
  out[5] = clampInt(Math.floor((hiZ - minZ) / cell), 0, nz - 1);
}

/**
 * slab 법 한 축 — [t0, t1] 구간을 [lo, hi] 슬랩과 교차시킨다.
 * @returns 좁혀진 [t0, t1]. 교차가 비면 null.
 */
function slab(
  o: number,
  d: number,
  lo: number,
  hi: number,
  t0: number,
  t1: number,
): [number, number] | null {
  if (Math.abs(d) < PARALLEL_EPS) {
    // 축에 평행 — 시작 좌표가 슬랩 밖이면 영영 못 들어온다.
    return o < lo || o > hi ? null : [t0, t1];
  }
  const inv = 1 / d;
  let a = (lo - o) * inv;
  let b = (hi - o) * inv;
  if (a > b) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  const n0 = a > t0 ? a : t0;
  const n1 = b < t1 ? b : t1;
  return n0 > n1 ? null : [n0, n1];
}

/** 현재 셀 index 에서 step 방향 다음 셀 경계까지의 t. step 0 이면 Infinity. */
function nextBoundaryT(
  o: number,
  d: number,
  min: number,
  cell: number,
  index: number,
  step: number,
): number {
  if (step === 0) return Infinity;
  const boundary = min + (step > 0 ? index + 1 : index) * cell;
  return (boundary - o) / d;
}

/**
 * Möller–Trumbore **양면** 교차 — det 부호로 앞/뒷면을 가른다.
 *
 * det > 0 이면 광선이 삼각형 법선의 **반대편**에서 들어온다 = 앞면(바깥에서 맞음),
 * det < 0 이면 법선과 같은 쪽 = 뒷면(내부에서 나가는 중). 감김 정규화 입력이라
 * 이 부호가 곧 안팎 판정이 된다(파일 머리 주석).
 *
 * @returns 교차 파라미터 t 와 뒷면 여부. 미교차·평행이면 null.
 */
function intersectTriangle(
  tris: Float32Array,
  off: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): { t: number; backface: boolean } | null {
  const ax = tris[off];
  const ay = tris[off + 1];
  const az = tris[off + 2];
  const e1x = tris[off + 3] - ax;
  const e1y = tris[off + 4] - ay;
  const e1z = tris[off + 5] - az;
  const e2x = tris[off + 6] - ax;
  const e2y = tris[off + 7] - ay;
  const e2z = tris[off + 8] - az;

  // p = d × e2.
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < PARALLEL_EPS) return null; // 면과 평행.

  const invDet = 1 / det;
  const tx = ox - ax;
  const ty = oy - ay;
  const tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0 || u > 1) return null;

  // q = t × e1.
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0 || u + v > 1) return null;

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  // det < 0 = 광선이 바깥 법선과 같은 방향으로 면을 통과 = 뒷면.
  return { t, backface: det < 0 };
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  const i = v | 0;
  return i < lo ? lo : i > hi ? hi : i;
}
