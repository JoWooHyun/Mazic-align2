/**
 * 슬라이스 기하 코어 — Babylon 의존이 전혀 없는 순수 함수 모음.
 *
 * 메인스레드(Babylon Mesh 보유)와 Web Worker(직렬화된 삼각형 배열만
 * 보유) 양쪽에서 공유한다. Babylon 을 import 하지 않으므로 워커 번들이
 * @babylonjs/core 를 끌어오지 않는다.
 *
 * · 메인스레드: slice-section.ts 가 Babylon Mesh 를 world 삼각형 배열로
 *   추출한 뒤 여기의 sliceTrianglesAtY 를 호출한다 (sliceMeshAtY 경유).
 * · 워커: BabylonScene 이 넘긴 world 삼각형 Float32Array 를 그대로
 *   sliceTrianglesAtY 에 넣는다.
 */

/**
 * 평면 Y = `y` 와 삼각형의 교차로 얻는 선분 한 개.
 * 점은 world 좌표의 (X, Z) — 평면 위라 Y 는 생략.
 */
export interface SliceSegment {
  a: [number, number];
  b: [number, number];
}

/** 닫힌 polygon (시계/반시계 무관, 마지막 점은 첫 점과 연결된 것으로 본다). */
export interface SlicePolygon {
  points: [number, number][];
}

const EPS = 1e-6;

/**
 * world 좌표 삼각형 배열(Float32Array)을 Y=`y` 평면으로 자른 line segment 들.
 *
 * `triangles` 는 삼각형당 9 개 float (v0.x, v0.y, v0.z, v1.x … v2.z) 로
 * 이어진 flat 배열. 좌표는 이미 world 변환이 적용된 상태여야 한다.
 *
 * 알고리즘 (표준 marching triangles) — sliceMeshAtY 원본과 동일:
 *   1) 각 vertex 와 평면의 부호 거리(d = y_v - y).
 *   2) 부호가 다른 두 vertex 의 edge → 평면과의 교차점 1 개씩.
 *   3) 교차점 2 개가 모이면 line segment.
 *
 * vertex 가 정확히 평면 위 (|d| < EPS) 인 경우는 1 회만 카운트.
 * triangle 전체가 코플레너 (3 vertex 다 평면 위) 인 경우 skip.
 */
export function sliceTrianglesAtY(
  triangles: Float32Array,
  y: number,
): SliceSegment[] {
  const out: SliceSegment[] = [];

  for (let t = 0; t + 9 <= triangles.length; t += 9) {
    const v0x = triangles[t];
    const v0y = triangles[t + 1];
    const v0z = triangles[t + 2];
    const v1x = triangles[t + 3];
    const v1y = triangles[t + 4];
    const v1z = triangles[t + 5];
    const v2x = triangles[t + 6];
    const v2y = triangles[t + 7];
    const v2z = triangles[t + 8];

    const d0 = v0y - y;
    const d1 = v1y - y;
    const d2 = v2y - y;

    // 모두 같은 쪽이면 평면과 교차 안 함.
    if (d0 > EPS && d1 > EPS && d2 > EPS) continue;
    if (d0 < -EPS && d1 < -EPS && d2 < -EPS) continue;

    // 코플레너 (3 vertex 모두 평면) → skip.
    if (Math.abs(d0) < EPS && Math.abs(d1) < EPS && Math.abs(d2) < EPS) continue;

    const cross: [number, number][] = [];

    const tryEdge = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      da: number,
      db: number,
    ) => {
      // 부호가 다른 edge: 정확히 t 비율로 교차.
      if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
        const tt = da / (da - db);
        cross.push([ax + tt * (bx - ax), az + tt * (bz - az)]);
      } else if (Math.abs(da) < EPS) {
        // 시작 vertex 가 평면 위. 중복 방지를 위해 시작 쪽에서만 1 회.
        cross.push([ax, az]);
      }
    };

    tryEdge(v0x, v0z, v1x, v1z, d0, d1);
    tryEdge(v1x, v1z, v2x, v2z, d1, d2);
    tryEdge(v2x, v2z, v0x, v0z, d2, d0);

    if (cross.length >= 2) {
      out.push({ a: cross[0], b: cross[1] });
    }
  }

  return out;
}

/**
 * Segment 들을 endpoint matching 으로 연결해 닫힌 polygon 들로 만든다.
 *
 * 좌표를 1 µm (1e-3 mm) 단위로 양자화하여 endpoint 동등성 비교를 안전
 * 하게 한다. 한 점에 segment 가 정확히 2 개 incident 면 그 점은 폴리곤
 * 위. 시작점에서 한쪽으로 따라가다 시작점으로 돌아오면 폴리곤 1 개 완성.
 */
export function chainSegments(segs: SliceSegment[]): SlicePolygon[] {
  const QUANT = 1000; // 1µm

  // 양자화된 (qx, qz) → 점 ID
  const idMap = new Map<string, number>();
  const points: [number, number][] = [];

  const qkey = (p: [number, number]) =>
    `${Math.round(p[0] * QUANT)}_${Math.round(p[1] * QUANT)}`;

  function ensureId(p: [number, number]): number {
    const k = qkey(p);
    let id = idMap.get(k);
    if (id === undefined) {
      id = points.length;
      idMap.set(k, id);
      points.push(p);
    }
    return id;
  }

  // adjacency 리스트 (각 점에 인접한 점 ID).
  const adj = new Map<number, number[]>();
  for (const s of segs) {
    const ia = ensureId(s.a);
    const ib = ensureId(s.b);
    if (ia === ib) continue;
    if (!adj.has(ia)) adj.set(ia, []);
    if (!adj.has(ib)) adj.set(ib, []);
    adj.get(ia)!.push(ib);
    adj.get(ib)!.push(ia);
  }

  const visited = new Set<number>();
  const polygons: SlicePolygon[] = [];

  for (const startId of adj.keys()) {
    if (visited.has(startId)) continue;

    const polygon: [number, number][] = [];
    let prev = -1;
    let curr = startId;
    let safety = adj.size + 4; // 안전 카운터

    while (safety-- > 0) {
      visited.add(curr);
      polygon.push(points[curr]);

      const neighbors = adj.get(curr) ?? [];
      let next = -1;
      for (const n of neighbors) {
        if (n === prev) continue;
        if (n === startId && polygon.length > 2) {
          next = n;
          break;
        }
        if (!visited.has(n)) {
          next = n;
          break;
        }
      }

      if (next === -1 || next === startId) break;
      prev = curr;
      curr = next;
    }

    if (polygon.length >= 3) polygons.push({ points: polygon });
  }

  return polygons;
}
