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
 *
 * **a → b 는 방향(directed)이다.** 삼각형 감김(바깥 법선)에서 유도하며,
 * 진행 방향 왼쪽이 솔리드 내부가 되도록 잡는다. 이 방향이 chainSegments 를
 * 거쳐 폴리곤 점 순서로 이어지고, rasterizePolygons 의 nonzero 감김 규칙이
 * 그 순서로 "겹친 솔리드(같은 방향) vs 진짜 구멍(반대 방향)" 을 구분한다.
 */
export interface SliceSegment {
  a: [number, number];
  b: [number, number];
}

/**
 * 닫힌 polygon (마지막 점은 첫 점과 연결된 것으로 본다).
 *
 * **점 순서(감김 방향)에 의미가 있다** — 선분 방향을 따라 이어붙인 결과라
 * 바깥 윤곽과 내벽(구멍) 윤곽이 서로 반대 감김을 갖는다. 래스터화의
 * nonzero 규칙이 이 감김을 사용하므로 점 순서를 임의로 뒤집지 말 것.
 */
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
 *
 * **선분 방향(B-7)**: 삼각형 감김에서 얻은 바깥 법선 n = (v1−v0)×(v2−v0) 로
 * 단면 선분의 진행 방향 t = ŷ×n = XZ 평면의 (n_z, −n_x) 를 구하고, a→b 가 t
 * 와 같은 쪽을 향하도록 필요하면 두 교차점을 스왑한다. 이렇게 하면 겹쳐 놓은
 * 두 솔리드의 윤곽은 같은 감김, 속 빈 모델의 내벽은 반대 감김이 되어 래스터화
 * 단계의 nonzero 규칙이 "겹침=채움 / 구멍=비움" 을 정확히 구분한다.
 * |t| 가 극소(법선이 거의 ±Y = 평면에 거의 평행한 삼각형)면 방향이 무의미하므로
 * 원래 순서를 유지한다.
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
      const p0 = cross[0];
      const p1 = cross[1];

      // 삼각형 감김에서 바깥 법선 n = (v1−v0)×(v2−v0). 부호만 쓰므로 정규화 불필요.
      const e1x = v1x - v0x;
      const e1y = v1y - v0y;
      const e1z = v1z - v0z;
      const e2x = v2x - v0x;
      const e2y = v2y - v0y;
      const e2z = v2z - v0z;
      const nx = e1y * e2z - e1z * e2y;
      const nz = e1x * e2y - e1y * e2x;

      // 단면 선분의 진행 방향 t = ŷ×n → XZ 평면에서 (n_z, −n_x).
      const tx = nz;
      const tz = -nx;

      // |t|² 가 극소면 법선이 거의 ±Y (평면에 거의 평행한 삼각형) → 방향이
      //   무의미하므로 스왑 없이 원래 순서를 유지한다.
      const swap =
        tx * tx + tz * tz >= 1e-12 &&
        (p1[0] - p0[0]) * tx + (p1[1] - p0[1]) * tz < 0;

      out.push(swap ? { a: p1, b: p0 } : { a: p0, b: p1 });
    }
  }

  return out;
}

/**
 * Segment 들을 endpoint matching 으로 연결해 닫힌 polygon 들로 만든다.
 *
 * 좌표를 1 µm (1e-3 mm) 단위로 양자화하여 endpoint 동등성 비교를 안전
 * 하게 한다. 시작점에서 out-edge 를 따라가다 시작점으로 돌아오면 폴리곤
 * 1 개 완성.
 *
 * **방향 보존(B-7)**: 인접 리스트를 무방향이 아니라 **유방향**(a→b 순방향만)
 * 으로 만든다. 그래야 결과 폴리곤의 점 순서가 선분 방향을 그대로 따르고,
 * 감김 방향(바깥 윤곽 vs 내벽)이 의미를 갖는다 — rasterizePolygons 의
 * nonzero 규칙이 이 감김에 의존한다. 점 순서를 뒤집는 후처리를 넣지 말 것.
 *
 * 퇴화 케이스(꼭짓점이 정확히 평면 위 등)로 out-edge 가 끊긴 지점에서 멈추면
 * 열린 체인이 되는데, 기존과 동일하게 3 점 이상일 때만 채택하고 예외는 던지지
 * 않는다(관용적 처리).
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

  // 유방향 인접 리스트: out.get(a) = a 에서 나가는 선분들의 도착점 ID.
  //   (무방향으로 양쪽에 넣으면 감김 방향이 소실된다 — B-7.)
  const out = new Map<number, number[]>();
  for (const s of segs) {
    const ia = ensureId(s.a);
    const ib = ensureId(s.b);
    if (ia === ib) continue;
    if (!out.has(ia)) out.set(ia, []);
    out.get(ia)!.push(ib);
  }

  const visited = new Set<number>();
  const polygons: SlicePolygon[] = [];

  for (const startId of out.keys()) {
    if (visited.has(startId)) continue;

    const polygon: [number, number][] = [];
    let curr = startId;
    let safety = out.size + 4; // 안전 카운터

    while (safety-- > 0) {
      visited.add(curr);
      polygon.push(points[curr]);

      // out-edge 중 다음 점을 고른다. 시작점으로 닫을 수 있으면 닫고,
      //   아니면 아직 안 지난 점으로 진행한다.
      const succs = out.get(curr) ?? [];
      let next = -1;
      for (const n of succs) {
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
      curr = next;
    }

    if (polygon.length >= 3) polygons.push({ points: polygon });
  }

  return polygons;
}
