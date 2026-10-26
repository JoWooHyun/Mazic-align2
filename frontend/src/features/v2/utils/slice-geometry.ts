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
 * 삼각형 수프의 감김을 "바깥 법선 = 양수 부호 부피" 관례로 통일한다 (B-7 재작업).
 *
 * 왜 필요한가: 감김 관례는 **소스마다 다르다**. Babylon STL 로더는 기본 설정
 * (DO_NOT_ALTER_FILE_COORDINATES=false)에서 정점을 (x, z, y) 로 넣어 Y/Z 를
 * 스왑하는데(stl-loader 는 이 결과를 그대로 쓴다 — 데모 수정 1차 ①-b 로 종전의 X −90° 추가 베이크 제거.
 * 그 회전은 행렬식 +1 이라 아래 감김 결론은 그때도 같았다), 스왑은 반사(행렬식 −1)라 **데이터 감김이 뒤집힌다**. 반면
 * assemble-core 로 조립한 재설계 서포트나 Babylon 기본 도형은 정상 감김이다.
 * 감김이 섞인 채 nonzero 로 래스터화하면 서로 겹친 부위에서 감김수가 +1 + (−1)
 * = 0 이 되어 마스크에 검은 틈(미경화)이 생긴다 — 실물에서 관찰된 초승달 구멍.
 *
 * 판정: 각 삼각형의 스칼라 삼중곱 v0·(v1×v2) 를 합산한다(닫힌 메시의 부호
 * 부피 ×6). 부호만 쓰므로 ÷6 은 생략. 음수면 각 삼각형의 v1↔v2 를 교환해
 * 감김을 뒤집는다. **in-place** 로 바꾸고 같은 배열을 반환한다.
 *
 * 전제와 한계: 닫힌(watertight) 메시를 전제한다. 열린 셸은 부호 부피가 0 근처라
 * 부호가 불안정하지만, 애초에 슬라이스(내부/외부)가 잘 정의되지 않는 입력이므로
 * 그대로 둔다. 전체를 일괄로 뒤집으므로 **내강(구멍)의 상대 감김은 보존된다** —
 * 속 빈 모델의 구멍이 메워지지 않는다.
 */
export function normalizeTriangleWinding(triangles: Float32Array): Float32Array {
  let vol6 = 0;

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

    // v0 · (v1 × v2).
    vol6 +=
      v0x * (v1y * v2z - v1z * v2y) +
      v0y * (v1z * v2x - v1x * v2z) +
      v0z * (v1x * v2y - v1y * v2x);
  }

  if (vol6 >= 0) return triangles;

  // 감김 뒤집기: 각 삼각형의 v1(오프셋 3..5) ↔ v2(6..8) 교환.
  for (let t = 0; t + 9 <= triangles.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      const tmp = triangles[t + 3 + k];
      triangles[t + 3 + k] = triangles[t + 6 + k];
      triangles[t + 6 + k] = tmp;
    }
  }

  return triangles;
}

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
        // **보간 방향 고정 — 공유 변 교차점 비트 일치.** 이웃한 두 삼각형은 공유 변을
        //   서로 반대 방향(a→b / b→a)으로 갖는다. 끝점 순서대로 보간하면 수학적으로
        //   같은 점이 1 ulp 남짓 달라지고, 그 차이가 x.5 µm 반올림 경계를 넘으면
        //   chainSegments 의 1 µm 양자화 키가 갈라져 체인이 끊긴다 — 열린 체인이
        //   현으로 닫히며 단면 일부가 빠진다(마스크 구멍). 교차 좌표가 정확히 x.5 µm 에
        //   오는 반듯한 치수에서 잦다 — 예제 20 mm 정육면체 lh 0.025 는 800층 중 158층,
        //   0.3×10.5 막대 lh 0.05 는 층 4 에서 0.71 mm² 누락. 그래서 언제나 **평면 아래(d<0) 끝점에서
        //   위(d>0) 끝점으로** 보간한다. 교차 변은 두 끝점 d 의 부호가 반드시 달라
        //   순서가 모호하지 않고, 공유 변의 두 삼각형이 같은 입력으로 같은 식을 계산하므로
        //   결과가 비트까지 같다(공유 꼭짓점 좌표가 비트 동일한 메시 전제 — 인덱스
        //   메시를 펼친 extractWorldTriangles·워커 배열이 그렇다).
        //   cross 에 넣는 **순서는 그대로**라 아래 선분 방향(B-7) 판정·감김은 불변이다.
        //   (대안인 "변의 꼭짓점 쌍으로 키" 는 SliceSegment 계약·모든 호출자를 바꿔야
        //   하고 평면 위 꼭짓점 점에는 변이 없어 채택하지 않았다.)
        const below = da < 0;
        const lx = below ? ax : bx;
        const lz = below ? az : bz;
        const ld = below ? da : db;
        const ux = below ? bx : ax;
        const uz = below ? bz : az;
        const ud = below ? db : da;
        const tt = ld / (ld - ud);
        cross.push([lx + tt * (ux - lx), lz + tt * (uz - lz)]);
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
 * 반올림 키는 x.5 µm 경계에서 1 ulp 차이에도 갈라진다. 같은 점이 같은 키를
 * 갖는 근거는 sliceTrianglesAtY 의 **보간 방향 고정**(공유 변 교차점이 비트까지
 * 같음)이다 — 그 고정을 풀면 체인이 끊겨 단면이 빠진다
 * (scripts/verify-slice-chain.mjs).
 *
 * **방향 보존(B-7)**: 인접 리스트를 무방향이 아니라 **유방향**(a→b 순방향만)
 * 으로 만든다. 그래야 결과 폴리곤의 점 순서가 선분 방향을 그대로 따르고,
 * 감김 방향(바깥 윤곽 vs 내벽)이 의미를 갖는다 — rasterizePolygons 의
 * nonzero 규칙이 이 감김에 의존한다. 점 순서를 뒤집는 후처리를 넣지 말 것.
 *
 * 퇴화 케이스(꼭짓점이 정확히 평면 위 등)나 열린 메시(구멍·이음매)로 out-edge 가
 * 끊긴 지점에서 멈추면 열린 체인이 되는데, 3 점 이상일 때만 채택하고 예외는 던지지
 * 않는다(관용적 처리). 단 채택한 폴리곤 중 하나라도 끊긴 것이고 그 층에 열린 체인
 * 머리(들어오는 선분보다 나가는 선분이 많은 점)가 있으면 그 층 전체를
 * chainSegmentsByEdges(열린 체인 머리부터·선분 단위 소비·가까운 머리 잇기)로 다시
 * 잇는다 — 그 밖의 층(닫힌 메시)은 예전 결과 그대로다(2026-10-23, 아래 함수 주석).
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
  // 채택한 폴리곤 중 시작점으로 돌아오지 못하고 끊긴 것(열린 체인 — 마지막 점→첫 점이 가짜 현)이 있는지
  let openAccepted = false;

  for (const startId of out.keys()) {
    if (visited.has(startId)) continue;

    const polygon: [number, number][] = [];
    let curr = startId;
    let safety = out.size + 4; // 안전 카운터
    let closed = false;

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

      if (next === startId) closed = true;
      if (next === -1 || next === startId) break;
      curr = next;
    }

    if (polygon.length >= 3) {
      polygons.push({ points: polygon });
      if (!closed) openAccepted = true;
    }
  }

  // 전부 닫혔으면 위 결과 그대로 (닫힌 메시의 보통 층 — 예전과 같은 바이트)
  if (!openAccepted) return polygons;
  // 열린 체인 머리(들어오는 선분보다 나가는 선분이 많은 점)가 없는 층도 그대로 — 끊긴 까닭이 두 윤곽이 한 점에서 만나는
  //   점뿐인 닫힌 입력(한 메시 안에서 꼭짓점이 맞닿게 겹친 상자 등)이다. 그 층도 점 단위 순회가 고리를 조각내 가짜 현이 생기지만
  //   닫힌 메시 출력 바이트를 지키려고 이번에는 손대지 않는다(2026-10-26 — 별도 결정 대상, verify-slice-open-chain b2).
  if (!hasOpenHead(out)) return polygons;
  return chainSegmentsByEdges(out, points);
}

/** 들어오는 선분보다 나가는 선분이 많은 점(열린 체인의 머리)이 있는지 */
function hasOpenHead(out: Map<number, number[]>): boolean {
  const indeg = new Map<number, number>();
  for (const succs of out.values()) for (const n of succs) indeg.set(n, (indeg.get(n) ?? 0) + 1);
  for (const [id, succs] of out) if ((indeg.get(id) ?? 0) < succs.length) return true;
  return false;
}

/**
 * chainSegments 의 열린 체인 대비 경로 — 위 점 단위 순회가 끊긴 폴리곤을 하나라도 냈을 때만 층 전체를 이걸로 다시 잇는다.
 *
 * 왜(2026-10-23 실측 — 치과 `partial denture (1).stl`, 경계 변 740 인 **열린 메시**): 구멍·이음매가 단면 높이를 지나면
 * 윤곽이 머리(들어오는 선분 없음)→꼬리(나가는 선분 없음) 열린 체인이 된다. 점 단위 순회는 out.keys() 순서상 체인 **가운데**에서
 * 출발하는 일이 많아 체인을 여러 조각으로 끊고, 조각마다 끝→처음 가짜 현으로 닫는다 — 단면 안팎을 가로지르는 현이 가는
 * 띠(가짜 얇은 부분)를 만들고, writer 의 얇은 부분 채움이 그 띠에서 노즐을 칠한 비드 사이에 가둬 그 위(+Y) 항목 전부가
 * "경로 없음" 이 됐다(층 270 기본 계획: 도포 띠 0~16 뒤 144 항목 경로 없음). 같은 단면이 노광 마스크에도 쓰인다.
 * 또 두 윤곽이 한 점에서 만나는 점(들어오고 나가는 선분이 각각 2개)은 점 단위 "지난 점" 표시 때문에 고리를 조각낸다
 * (치과 STL 층 270·271 에 하나씩 — 이 경로로 다시 잇는 층 안에서는 함께 풀린다. 머리 없는 닫힌 층은 chainSegments 가 손대지 않음).
 *
 * 그래서 여기서는 (1) **열린 체인의 머리부터** 출발해 체인 하나를 통째로 잇고,
 * (2) "지난 점" 대신 **선분을 하나씩 소비**하며 걷는다 — 만나는 점을 두 번 지날 수 있어 고리가 조각나지 않는다.
 * 시작점으로 돌아오는 선분이 있으면 먼저 닫는다(3 점 이상일 때).
 * (3) 열린 걸음(꼬리에서 더 갈 선분이 없음)은 **꼬리에서 가장 가까운 머리**로 잇는다 — 자기 머리가 가장 가까우면 그대로
 * 닫고(구멍 하나를 가로지르는 현 하나), 다른 걸음의 머리가 더 가까우면 그 걸음을 뒤에 붙여 계속(관 조각의 바깥·안쪽 윤곽처럼
 * 이음매 양쪽 끝이 다른 체인이면 자기 현이 내강을 가로질러 가짜 띠를 만들기 때문). 가까움이 같으면 자기 머리.
 * 다 이은 뒤 3 점 미만은 버린다(예전과 같음).
 * nonzero 채움은 감김수가 선분의 합이라 닫힌 고리를 어떻게 묶든 같은 영역이 된다 — 가짜 현을 짧게·적게 만드는 것이 목적.
 * 점 순서는 선분 방향 그대로(B-7) — 뒤집지 않는다.
 */
function chainSegmentsByEdges(out: Map<number, number[]>, points: [number, number][]): SlicePolygon[] {
  const used = new Map<number, Uint8Array>();
  const indeg = new Map<number, number>();
  for (const [id, succs] of out) {
    used.set(id, new Uint8Array(succs.length));
    for (const n of succs) indeg.set(n, (indeg.get(n) ?? 0) + 1);
  }
  const heads: number[] = [];
  for (const [id, succs] of out) if ((indeg.get(id) ?? 0) < succs.length) heads.push(id);

  const closed: number[][] = [];
  const open: number[][] = [];
  for (const startId of [...heads, ...out.keys()]) {
    const u0 = used.get(startId) as Uint8Array;
    // 한 점에서 여러 번 출발할 수 있다(만나는 점) — 걸음마다 선분을 하나 이상 소비하므로 끝난다
    while (u0.includes(0)) {
      const walk: number[] = [];
      let curr = startId;
      let isClosed = false;
      for (;;) {
        walk.push(curr);
        const succs = out.get(curr) ?? [];
        const u = used.get(curr);
        let pick = -1;
        if (u !== undefined) {
          for (let i = 0; i < succs.length; i++) {
            if (u[i] === 0 && succs[i] === startId && walk.length > 2) {
              pick = i;
              break;
            }
          }
          if (pick < 0) {
            for (let i = 0; i < succs.length; i++) {
              if (u[i] === 0 && succs[i] !== startId) {
                pick = i;
                break;
              }
            }
          }
        }
        if (pick < 0) break; // 열린 걸음 — 꼬리
        (u as Uint8Array)[pick] = 1;
        if (succs[pick] === startId) {
          isClosed = true;
          break;
        }
        curr = succs[pick];
      }
      (isClosed ? closed : open).push(walk);
    }
  }

  // 열린 걸음 잇기 — 꼬리에서 가장 가까운 머리(자기 머리 포함, 같으면 자기)
  const d2 = (a: number, b: number): number => {
    const dx = points[a][0] - points[b][0];
    const dz = points[a][1] - points[b][1];
    return dx * dx + dz * dz;
  };
  while (open.length > 0) {
    let cur = open.shift() as number[];
    for (;;) {
      const tail = cur[cur.length - 1];
      let best = -1;
      let bestD = d2(tail, cur[0]);
      for (let j = 0; j < open.length; j++) {
        const dj = d2(tail, open[j][0]);
        if (dj < bestD) {
          bestD = dj;
          best = j;
        }
      }
      if (best < 0) break;
      const next = open.splice(best, 1)[0];
      // 꼬리와 다음 머리가 같은 점이면 한 번만
      cur = cur.concat(next[0] === tail ? next.slice(1) : next);
    }
    // 머리 = 꼬리로 끝나면(같은 점) 마지막 점을 빼 닫힌 고리로
    if (cur.length > 1 && cur[cur.length - 1] === cur[0]) cur = cur.slice(0, -1);
    closed.push(cur);
  }

  const polygons: SlicePolygon[] = [];
  for (const walk of closed) {
    if (walk.length >= 3) polygons.push({ points: walk.map((id) => points[id]) });
  }
  return polygons;
}
