/**
 * margin-detect — 지현규 '마진 찾기'(findMarginSignal) 알고리즘 코어 (v2 이식).
 *
 * 원본: frontend/src/components/STLViewer.tsx 의 `findMarginSignal` useEffect
 * (지현규 브랜치, 약 2053~2814줄). 색칠(painted) 영역 내부에서 인접 두 삼각형의
 * 법선이 급격히 꺾이는(=dihedral 큰) 모서리를 찾아 마진 폐곡선으로 잇는다.
 *
 * 이 파일은 useEffect 의 [알고리즘 코어] 만 순수 함수로 추출한 것이다:
 *   painted face 집합 + mesh 지오메트리 → sharp-edge 수집 → chain walk →
 *   spur trimming → endpoint corner extension → 작은-컴포넌트 폐기 →
 *   endpoint/inter-component bridge(surface Dijkstra) → 마진 폐곡선.
 * [UI/씬 의존부] (씬 픽킹으로 painted 수집, 초록 튜브 시각화, ref 저장) 는 추출
 * 대상이 아니며 Step 2-3 에서 이 코어를 호출하도록 연결한다.
 *
 * 추출 원칙: 원본 코드 블록을 그대로 옮기고 useEffect 지역변수 참조(mesh, painted
 * 여부, brush 두께)를 함수 인자로 바꾸는 최소 변형만 적용했다. 수치 동작 무변경.
 *
 * ⚠️ 잠금 알고리즘: 아래 MARGIN_LOCK 상수와 코어 로직/임계값/가중치는
 *    2026-06-08 사용자 컨펌으로 도달한 균형 상태다. 변경 전 반드시 지현규 컨펌 필수.
 *    docs/references/feedback_margin_algorithm_lock.md 의 [현재 균형 파라미터]
 *    표와 1:1 로 일치해야 한다. 임계 한 단계만 옮겨도 노이즈/끊김 균형이 깨진다.
 */
import { Mesh, Vector3 } from '@babylonjs/core';

/**
 * 마진 찾기 잠금 파라미터 — 변경 전 지현규 컨펌 필수.
 * docs/references/feedback_margin_algorithm_lock.md 의 표와 이름·값이 1:1 일치.
 */
export const MARGIN_LOCK = {
  /** bothPainted seed 임계 (°) */
  SHARP_DEG_PAINTED: 25,
  /** chain 확장 풀 임계 (°) */
  SHARP_DEG_GLOBAL: 12,
  /** chain walk 한 step 허용 방향 변화 (°, best-only) */
  DIR_TOL_DEG: 45,
  /** spur(짧은 dead-end 가지) 최대 길이 (mm) */
  SPUR_MAX: 2.0,
  /** 플레이트 접지부(모델 바닥 sharp 링) 배제용 Y 임계 (mm) */
  PLATE_EXCL: 0.6,
  /** 시드 영역 반경 = max(brush × 3, 8mm) — 아래 8 이 최소값 */
  SEED_REGION_R_MIN: 8,
  /** endpoint corner extension 최대 스텝 */
  MAX_CORNER_STEPS: 5,
  /** corner extension 최대 회전 허용 (°) */
  CORNER_DIR_TOL_DEG: 150,
  /** corner extension dihedral 임계 (°, 명확한 코너만) */
  CORNER_SHARP_DEG: 30,
  /** 작은-컴포넌트 폐기 — 총 edge 길이가 이보다 짧은 isolated 컴포넌트 폐기 (mm) */
  MIN_TINY_COMP_LEN: 1.5,
  /** endpoint(degree-1) 쌍 직선거리 한계 (mm) */
  BRIDGE_MAX: 12.0,
  /** endpoint bridge weighted Dijkstra 거리 한계 배수 (BRIDGE_MAX × 4.5) */
  SURFACE_MAX_MULT: 4.5,
  /** 컴포넌트 간 bridge 직선거리 한계 (mm) */
  INTERCOMP_BRIDGE_MAX: 15.0,
  /** 컴포넌트 간 bridge weighted 거리 한계 배수 (INTERCOMP_BRIDGE_MAX × 4.5) */
  INTERCOMP_SURFACE_MAX_MULT: 4.5,
  /** bridge 대상 컴포넌트 최소 vertex 수 (단일-edge fragment 도 포함) */
  MIN_COMP_VERTS: 2,
  /** surface Dijkstra 방문 상한 — UI freeze 방지 */
  VISIT_CAP: 10000,
  /** 마진 점 dense sampling 간격 (mm) — 서포트 가드 거리 판정용 */
  MARGIN_SAMPLE_STEP: 0.2,
} as const;

/**
 * 마진 찾기 코어 입력.
 *   mesh: 대상 STL mesh (원본은 meshMapRef 로 얻던 것 — 씬 의존부는 호출자가 처리)
 *   paintedFaceIds: 색칠된 삼각형 face index 집합 (원본은 isMasked/maskRef 로 수집)
 *   brushThickness: SEED_REGION_R 계산용 brush 두께 (mm). 원본 brushThicknessRef.current.
 */
export interface FindMarginParams {
  mesh: Mesh;
  paintedFaceIds: Set<number>;
  /** 미지정 시 0 → SEED_REGION_R = max(0, 8) = 8mm */
  brushThickness?: number;
}

/** 마진 라인 한 세그먼트 (canonical vertex 인덱스 + 월드 좌표 양 끝점) */
export interface MarginEdge {
  va: number;
  vb: number;
  pa: Vector3;
  pb: Vector3;
}

/** 마진 찾기 코어 출력 — 향후 Step 2-4 마진 export API 의 기반 (지현규 문서 4.7). */
export interface FindMarginResult {
  /**
   * 마진 라인 dense 점 배열 (MARGIN_SAMPLE_STEP 간격 샘플).
   * 서포트 가드 거리 판정 등에 사용.
   */
  points: Vector3[];
  /** 마진 라인 세그먼트 목록 (시각화·해석용) */
  edges: MarginEdge[];
  /** 마진 엣지 키(canonical `min,max`) 집합 — floodfill 차단용 */
  edgeKeys: Set<string>;
  /** bridge 로 생성된 세그먼트 중점 (디버그/시각화용) */
  bridgePoints: Vector3[];
  /** 교합면(외면) face index 집합 — 색칠 평균 Y 이하 (대략적 가드용) */
  occlusalFaces: Set<number>;
  /** 원본 vertex → canonical(용접) vertex 매핑 */
  canon: Int32Array;
  /** canonical vertex → 월드 좌표 */
  canonPositions: Vector3[];
  /** 통계 — 콘솔 로그/디버그용 (원본 console.log 항목과 동일 정보) */
  stats: FindMarginStats;
}

/** 마진 찾기 통계 (원본 useEffect 말미 console.log 와 동일 정보). */
export interface FindMarginStats {
  paintedFaceCount: number;
  seedEdgeCount: number;
  globalSharpEdgeCount: number;
  marginEdgeCount: number;
  cornerExtSteps: number;
  droppedTinyComps: number;
  surfacePathCount: number;
  straightFallbackCount: number;
  interCompPathCount: number;
  bridgeSegCount: number;
  seedRegionR: number;
}

/** 마진 찾기 실패 사유 — 호출자(UI)가 사용자 메시지로 변환. */
export type FindMarginFailReason =
  | 'no-geometry' // 인덱스/포지션 없음 또는 tri 0
  | 'no-painted-faces' // 색칠된 삼각형 없음
  | 'no-seed' // 색칠 영역 안에서 sharp 시드 없음
  | 'empty-margin'; // 마진 컴포넌트 비어있음

/**
 * 색칠 영역에서 마진 폐곡선을 검출한다. 실패 시 { ok:false, reason } 반환
 * (원본 useEffect 의 각 early-return console.warn 지점에 대응).
 *
 * ⚠️ 잠금 알고리즘 — 로직/임계값 변경 전 지현규 컨펌 필수.
 *    docs/references/feedback_margin_algorithm_lock.md 참조.
 */
export function findMargin(
  params: FindMarginParams
): { ok: true; result: FindMarginResult } | { ok: false; reason: FindMarginFailReason } {
  const { mesh, paintedFaceIds: paintedSet, brushThickness = 0 } = params;

  // ── 원본 useEffect 는 여기서 readWorldTriangles(mesh) 로 tris 를 얻고
  //    isMasked 로 paintedSet 을 만들었다. 씬 의존부(isMasked)는 호출자가 처리해
  //    paintedFaceIds 로 넘겨준다. tris 는 tri 법선(triNormalByFace)과 색칠 평균 Y
  //    (occlusalFaces) 산출에만 쓰이므로 여기서 mesh 지오메트리로 직접 계산한다. ──
  const meshIndices = mesh.getIndices();
  const meshPositions = mesh.getVerticesData('position');
  if (!meshIndices || !meshPositions) return { ok: false, reason: 'no-geometry' };
  const wm = mesh.computeWorldMatrix(true);

  // 월드 좌표 삼각형(법선·중심) — 원본 readWorldTriangles 와 동일한 산출.
  //   원본은 mesh 저장 법선(바깥쪽 보장) 우선, 없으면 기하 cross 를 썼다.
  const meshNormals = mesh.getVerticesData('normal');
  type Tri = { faceIndex: number; centroid: Vector3; normal: Vector3 };
  const tris: Tri[] = [];
  const triCountAll = meshIndices.length / 3;
  const getWorldPos = (i: number): Vector3 =>
    Vector3.TransformCoordinates(
      new Vector3(
        meshPositions[i * 3],
        meshPositions[i * 3 + 1],
        meshPositions[i * 3 + 2]
      ),
      wm
    );
  for (let f = 0; f < triCountAll; f++) {
    const i0 = meshIndices[f * 3];
    const i1 = meshIndices[f * 3 + 1];
    const i2 = meshIndices[f * 3 + 2];
    const v0 = getWorldPos(i0);
    const v1 = getWorldPos(i1);
    const v2 = getWorldPos(i2);
    const cross = Vector3.Cross(v1.subtract(v0), v2.subtract(v0));
    const len = cross.length();
    if (len < 1e-9) continue;
    let normal: Vector3;
    if (meshNormals) {
      normal = Vector3.TransformNormal(
        new Vector3(
          meshNormals[i0 * 3],
          meshNormals[i0 * 3 + 1],
          meshNormals[i0 * 3 + 2]
        ),
        wm
      );
      const nl = normal.length();
      normal = nl > 1e-9 ? normal.scale(1 / nl) : cross.scale(1 / len);
    } else {
      normal = cross.scale(1 / len);
    }
    tris.push({
      faceIndex: f,
      centroid: v0.add(v1).add(v2).scale(1 / 3),
      normal,
    });
  }
  if (tris.length === 0) return { ok: false, reason: 'no-geometry' };

  // ① 색칠된 삼각형 집합 — 원본은 isMasked 로 산출했고, 여기서는 인자로 받은
  //    paintedFaceIds 를 그대로 쓴다(코어 밖 씬 픽킹 결과).
  if (paintedSet.size === 0) {
    return { ok: false, reason: 'no-painted-faces' };
  }

  // ② 메시 인덱스/포지션 + canonical vertex (position 용접)
  const QUANT = 1000;
  const vertCount = meshPositions.length / 3;
  const canon = new Int32Array(vertCount);
  const posToCanon = new Map<string, number>();
  const canonPositions: Vector3[] = [];
  for (let v = 0; v < vertCount; v++) {
    const x = Math.round(meshPositions[v * 3] * QUANT);
    const y = Math.round(meshPositions[v * 3 + 1] * QUANT);
    const z = Math.round(meshPositions[v * 3 + 2] * QUANT);
    const k = `${x},${y},${z}`;
    let c = posToCanon.get(k);
    if (c === undefined) {
      c = posToCanon.size;
      posToCanon.set(k, c);
      canonPositions[c] = Vector3.TransformCoordinates(
        new Vector3(
          meshPositions[v * 3],
          meshPositions[v * 3 + 1],
          meshPositions[v * 3 + 2]
        ),
        wm
      );
    }
    canon[v] = c;
  }

  // ③ 엣지 인접성 — canonical 인덱스 기준
  const ek = (a: number, b: number): string =>
    a < b ? `${a},${b}` : `${b},${a}`;
  const edgeFaces = new Map<string, number[]>();
  const triCount = meshIndices.length / 3;
  for (let f = 0; f < triCount; f++) {
    const ia = canon[meshIndices[f * 3]];
    const ib = canon[meshIndices[f * 3 + 1]];
    const ic = canon[meshIndices[f * 3 + 2]];
    for (const [a, b] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ] as const) {
      const k = ek(a, b);
      let arr = edgeFaces.get(k);
      if (!arr) {
        arr = [];
        edgeFaces.set(k, arr);
      }
      arr.push(f);
    }
  }

  // ④ Sharp dihedral 엣지 수집 — 색칠 영역(낮은 임계) + 전체 메시(엄격 임계).
  //   색칠 영역 내 sharp = 시드, 전체 메시 sharp = 확장에 사용.
  //   시드가 속한 연결 컴포넌트의 모든 엣지를 추적하면 마진이 폐곡선으로 연장됨.
  const SHARP_DEG_PAINTED = MARGIN_LOCK.SHARP_DEG_PAINTED;
  const SHARP_DEG_GLOBAL = MARGIN_LOCK.SHARP_DEG_GLOBAL; // 거친 mesh 에서도 마진 sharp 라인의 모든 vertex 쌍이 후보화되도록 완화
  const SHARP_DOT_PAINTED = Math.cos((SHARP_DEG_PAINTED * Math.PI) / 180);
  const SHARP_DOT_GLOBAL = Math.cos((SHARP_DEG_GLOBAL * Math.PI) / 180);
  const triNormalByFace = new Map<number, Vector3>();
  for (const t of tris) triNormalByFace.set(t.faceIndex, t.normal);

  type CandEdge = { va: number; vb: number; pa: Vector3; pb: Vector3 };
  const edgeByKey = new Map<string, CandEdge>();
  const seedKeys = new Set<string>();
  const allKeys = new Set<string>();

  // 플레이트 접지부(모델 바닥의 sharp 링) 배제용 — 두 vertex 모두 Y 가
  //   PLATE_EXCL 미만이면 마진 후보로 안 잡는다.
  const PLATE_EXCL = MARGIN_LOCK.PLATE_EXCL;
  for (const [k, faces] of edgeFaces) {
    if (faces.length !== 2) continue;
    const n1 = triNormalByFace.get(faces[0]);
    const n2 = triNormalByFace.get(faces[1]);
    if (!n1 || !n2) continue;
    const dotNN = Vector3.Dot(n1, n2);
    const bothPainted =
      paintedSet.has(faces[0]) && paintedSet.has(faces[1]);
    const isSeed = bothPainted && dotNN <= SHARP_DOT_PAINTED;
    const isGlobal = dotNN <= SHARP_DOT_GLOBAL;
    if (!isSeed && !isGlobal) continue;
    const [aStr, bStr] = k.split(',');
    const va = parseInt(aStr, 10);
    const vb = parseInt(bStr, 10);
    const pa = canonPositions[va];
    const pb = canonPositions[vb];
    if (!pa || !pb) continue;
    // 플레이트 접지부 배제 — 시드가 아닐 때만 (시드 자체는 사용자가 지정한 위치라 신뢰)
    if (!isSeed && pa.y < PLATE_EXCL && pb.y < PLATE_EXCL) continue;
    edgeByKey.set(k, { va, vb, pa, pb });
    if (isSeed) seedKeys.add(k);
    if (isGlobal || isSeed) allKeys.add(k); // 시드는 항상 포함
  }

  if (seedKeys.size === 0) {
    return { ok: false, reason: 'no-seed' };
  }

  // ⑤ vertex adjacency — 모든 sharp 엣지(시드 + 전체)
  const vAdj = new Map<number, Set<number>>();
  for (const k of allKeys) {
    const e = edgeByKey.get(k);
    if (!e) continue;
    let a = vAdj.get(e.va);
    if (!a) {
      a = new Set();
      vAdj.set(e.va, a);
    }
    a.add(e.vb);
    let b = vAdj.get(e.vb);
    if (!b) {
      b = new Set();
      vAdj.set(e.vb, b);
    }
    b.add(e.va);
  }

  // ⑥ 방향 연속성 chain walk — 시드 엣지에서 출발해 분기 vertex 에서는
  //    가장 정렬된 한 이웃만 따라간다(best-only). 단일 chain 유지로 마진의
  //    안쪽/바깥쪽 평행 라인이 동시에 추적되는 다중선을 방지한다.
  //    + 시드 vertex 영역 제한: chain 의 새 frontier 가 어떤 시드 vertex 와도
  //      SEED_REGION_R mm 이내일 것 → 시드 영역 밖 sharp 디테일로 chain 이
  //      새 나가는 false-positive 방지 (사용자 brush 영역 의도 반영).
  const DIR_TOL_DEG = MARGIN_LOCK.DIR_TOL_DEG; // 한 step 허용 방향 변화 — 곡률 급한 마진 구간 허용
  const DIR_TOL_DOT = Math.cos((DIR_TOL_DEG * Math.PI) / 180);

  // edge → dihedral dotNN (endpoint corner extension 에서 사용)
  const edgeDihedral = new Map<string, number>();
  for (const [k, faces] of edgeFaces) {
    if (faces.length !== 2) continue;
    const n1 = triNormalByFace.get(faces[0]);
    const n2 = triNormalByFace.get(faces[1]);
    if (!n1 || !n2) continue;
    edgeDihedral.set(k, Vector3.Dot(n1, n2));
  }

  // 시드 vertex 위치 모음
  const seedVertices = new Set<number>();
  for (const sk of seedKeys) {
    const e = edgeByKey.get(sk);
    if (!e) continue;
    seedVertices.add(e.va);
    seedVertices.add(e.vb);
  }
  const seedPositions: Vector3[] = [];
  for (const sv of seedVertices) {
    const p = canonPositions[sv];
    if (p) seedPositions.push(p);
  }
  // 영역 반경 — brush 두께 비례 + 최소 8mm.
  const SEED_REGION_R = Math.max(brushThickness * 3, MARGIN_LOCK.SEED_REGION_R_MIN);
  const SEED_REGION_R2 = SEED_REGION_R * SEED_REGION_R;
  const isWithinSeedRegion = (p: Vector3): boolean => {
    for (const sp of seedPositions) {
      const dx = sp.x - p.x;
      const dy = sp.y - p.y;
      const dz = sp.z - p.z;
      if (dx * dx + dy * dy + dz * dz <= SEED_REGION_R2) return true;
    }
    return false;
  };

  const visitedEdges = new Set<string>(seedKeys);
  type Frontier = { v: number; comingFrom: Vector3 };
  const queue: Frontier[] = [];

  // 시드 엣지마다 양방향 진행을 큐에 넣는다.
  for (const sk of seedKeys) {
    const e = edgeByKey.get(sk);
    if (!e) continue;
    const dir = e.pb.subtract(e.pa);
    const len = dir.length();
    if (len < 1e-9) continue;
    dir.scaleInPlace(1 / len);
    queue.push({ v: e.vb, comingFrom: dir });
    queue.push({ v: e.va, comingFrom: dir.scale(-1) });
  }

  while (queue.length > 0) {
    const f = queue.shift() as Frontier;
    const adj = vAdj.get(f.v);
    if (!adj) continue;
    const pV = canonPositions[f.v];
    if (!pV) continue;
    // 분기 vertex 에서 best-only: incoming 방향과 가장 정렬된 한 이웃만 채택.
    let bestNb = -1;
    let bestDot = DIR_TOL_DOT;
    let bestDir: Vector3 | null = null;
    for (const nb of adj) {
      if (nb === f.v) continue;
      const key = f.v < nb ? `${f.v},${nb}` : `${nb},${f.v}`;
      if (visitedEdges.has(key)) continue;
      const pNb = canonPositions[nb];
      if (!pNb) continue;
      // 시드 영역 밖 vertex 는 chain 진행 차단
      if (!isWithinSeedRegion(pNb)) continue;
      const outDir = pNb.subtract(pV);
      const outLen = outDir.length();
      if (outLen < 1e-9) continue;
      outDir.scaleInPlace(1 / outLen);
      const align = Vector3.Dot(outDir, f.comingFrom);
      if (align > bestDot) {
        bestDot = align;
        bestNb = nb;
        bestDir = outDir;
      }
    }
    if (bestNb >= 0 && bestDir) {
      const key =
        f.v < bestNb ? `${f.v},${bestNb}` : `${bestNb},${f.v}`;
      visitedEdges.add(key);
      queue.push({ v: bestNb, comingFrom: bestDir });
    }
  }

  const marginCand: CandEdge[] = [];
  for (const k of visitedEdges) {
    const e = edgeByKey.get(k);
    if (e) marginCand.push(e);
  }
  if (marginCand.length === 0) {
    return { ok: false, reason: 'empty-margin' };
  }

  // ⑦ 후처리 1 — Spur trimming: chain 결과의 짧은 가지(잘못 빠진 dead-end)
  //   를 가지치기. degree-1 endpoint 에서 출발해 분기점(degree≥3) 도달 시까지
  //   누적 거리가 SPUR_MAX 이내면 그 path 의 엣지 전부 제거. 진짜 마진의
  //   양 끝(다른 endpoint 까지의 chain)은 길이가 길어 임계 초과 → 보존.
  const SPUR_MAX = MARGIN_LOCK.SPUR_MAX; // mm — 이보다 짧은 가지는 spur
  const ekey = (a: number, b: number): string =>
    a < b ? `${a},${b}` : `${b},${a}`;
  {
    const adj = new Map<number, Set<number>>();
    for (const e of marginCand) {
      let a = adj.get(e.va);
      if (!a) {
        a = new Set();
        adj.set(e.va, a);
      }
      a.add(e.vb);
      let b = adj.get(e.vb);
      if (!b) {
        b = new Set();
        adj.set(e.vb, b);
      }
      b.add(e.va);
    }
    const removedEdges = new Set<string>();
    const initialEndpoints: number[] = [];
    for (const [v, nbs] of adj) if (nbs.size === 1) initialEndpoints.push(v);
    for (const v0 of initialEndpoints) {
      // v0 부터 chain 따라 진행하며 분기점/임계 만날 때까지 trace
      const path: number[] = [v0];
      let length = 0;
      let prev = -1;
      let cur = v0;
      let foundBranch = false;
      // eslint-disable-next-line no-constant-condition -- 원본 verbatim: 내부 break 로 종료
      while (true) {
        const nbs = adj.get(cur);
        if (!nbs) break;
        let next = -1;
        for (const nb of nbs) {
          if (nb === prev) continue;
          if (removedEdges.has(ekey(cur, nb))) continue;
          next = nb;
          break;
        }
        if (next === -1) break;
        const pCur = canonPositions[cur];
        const pNext = canonPositions[next];
        if (!pCur || !pNext) break;
        length += Vector3.Distance(pCur, pNext);
        path.push(next);
        if (length > SPUR_MAX) break;
        const nextDeg = adj.get(next)?.size ?? 0;
        if (nextDeg >= 3) {
          foundBranch = true;
          break;
        }
        if (nextDeg === 1 && next !== v0) break; // 다른 endpoint — 전체 chain 이 짧음, 보존
        prev = cur;
        cur = next;
      }
      if (foundBranch) {
        for (let i = 0; i < path.length - 1; i++) {
          removedEdges.add(ekey(path[i], path[i + 1]));
        }
      }
    }
    if (removedEdges.size > 0) {
      const filtered: CandEdge[] = [];
      for (const e of marginCand) {
        if (!removedEdges.has(ekey(e.va, e.vb))) filtered.push(e);
      }
      marginCand.length = 0;
      marginCand.push(...filtered);
    }
  }

  // ⑦.5 Endpoint corner extension — 끊긴 chain endpoint 를 sharp 방향 무관하게 연장.
  //   chain walk 의 DIR_TOL_DOT 가 45° 라서 큰 곡률 (코너/급커브) 에서 끊김 → endpoint 발생.
  //   이 단계는 endpoint 한정으로 direction 무관(최대 150° 회전) + dihedral ≥30° edge 만
  //   탐색해 chain 연장. region 안 한정 + 최대 N 스텝 → 노이즈 확산 차단.
  //   민감도(SHARP_DEG_GLOBAL/PAINTED) 변경 없이 코너 케이스 전용으로 동작.
  let cornerExtSteps = 0;
  {
    // 현재 marginCand 의 컴포넌트 adjacency
    const cAdj = new Map<number, Set<number>>();
    for (const e of marginCand) {
      let a = cAdj.get(e.va);
      if (!a) { a = new Set(); cAdj.set(e.va, a); }
      a.add(e.vb);
      let b = cAdj.get(e.vb);
      if (!b) { b = new Set(); cAdj.set(e.vb, b); }
      b.add(e.va);
    }
    // 모든 degree-1 endpoint + 그 outgoing direction
    const endpointStarts: { v: number; dir: Vector3 }[] = [];
    for (const [v, nbs] of cAdj) {
      if (nbs.size !== 1) continue;
      const nb = Array.from(nbs)[0];
      const pV = canonPositions[v];
      const pNb = canonPositions[nb];
      if (!pV || !pNb) continue;
      const d = pV.subtract(pNb);
      const len = d.length();
      if (len < 1e-9) continue;
      d.scaleInPlace(1 / len);
      endpointStarts.push({ v, dir: d });
    }

    const MAX_CORNER_STEPS = MARGIN_LOCK.MAX_CORNER_STEPS; // 너무 길게 연장 시 평행 chain 노이즈 → 짧게.
    const CORNER_DIR_TOL_DOT = Math.cos((MARGIN_LOCK.CORNER_DIR_TOL_DEG * Math.PI) / 180); // 최대 150° 회전 허용
    const CORNER_SHARP_DOT = Math.cos((MARGIN_LOCK.CORNER_SHARP_DEG * Math.PI) / 180); // dihedral ≥ 30° 만 (코너 명확)

    for (const { v: epStart, dir: epDir } of endpointStarts) {
      let cur = epStart;
      let curDir = epDir;
      for (let step = 0; step < MAX_CORNER_STEPS; step++) {
        const adj = vAdj.get(cur);
        if (!adj) break;
        const pV = canonPositions[cur];
        if (!pV) break;
        let bestNb = -1;
        let bestScore = -Infinity;
        let bestDir: Vector3 | null = null;
        for (const nb of adj) {
          if (nb === cur) continue;
          const key = cur < nb ? `${cur},${nb}` : `${nb},${cur}`;
          if (visitedEdges.has(key)) continue;
          const pNb = canonPositions[nb];
          if (!pNb) continue;
          if (!isWithinSeedRegion(pNb)) continue;
          const outDir = pNb.subtract(pV);
          const outLen = outDir.length();
          if (outLen < 1e-9) continue;
          outDir.scaleInPlace(1 / outLen);
          const align = Vector3.Dot(outDir, curDir);
          if (align < CORNER_DIR_TOL_DOT) continue; // 최대 150° 회전까지 허용
          const dotNN = edgeDihedral.get(key) ?? 1.0;
          if (dotNN > CORNER_SHARP_DOT) continue; // ≥ 20° dihedral 만
          // score: 더 sharp + 정렬도. sharpness 가 주 인자 — 코너 탐지가 목적.
          const score = (1 - dotNN) * 1.0 + align * 0.3;
          if (score > bestScore) {
            bestScore = score;
            bestNb = nb;
            bestDir = outDir;
          }
        }
        if (bestNb < 0 || !bestDir) break;
        const key = cur < bestNb ? `${cur},${bestNb}` : `${bestNb},${cur}`;
        visitedEdges.add(key);
        const pa = canonPositions[cur];
        const pb = canonPositions[bestNb];
        if (!pa || !pb) break;
        marginCand.push({ va: cur, vb: bestNb, pa, pb });
        cornerExtSteps++;
        cur = bestNb;
        curDir = bestDir;
      }
    }
  }

  // ⑦.7 작은-컴포넌트 폐기 — corner extension 후에도 총 길이 < 1.5mm 인 isolated 컴포넌트 제거.
  //   큰 마진 chain 은 영향 없음 (수십 mm 이상). tangle 안의 짧은 fragment 노이즈만 정리.
  //   bridge 단계 전에 실행 — 이후 inter-component bridge 는 깨끗한 컴포넌트만 대상.
  let droppedTinyComps = 0;
  {
    const adj7 = new Map<number, Set<number>>();
    for (const e of marginCand) {
      let a = adj7.get(e.va);
      if (!a) { a = new Set(); adj7.set(e.va, a); }
      a.add(e.vb);
      let b = adj7.get(e.vb);
      if (!b) { b = new Set(); adj7.set(e.vb, b); }
      b.add(e.va);
    }
    const visited7 = new Set<number>();
    const compMap7 = new Map<number, number>();
    const compLen7: number[] = [];
    let cId7 = 0;
    for (const startV of adj7.keys()) {
      if (visited7.has(startV)) continue;
      cId7++;
      const stack: number[] = [startV];
      visited7.add(startV);
      compMap7.set(startV, cId7);
      let len = 0;
      while (stack.length > 0) {
        const v = stack.pop() as number;
        const pV = canonPositions[v];
        const nbs = adj7.get(v);
        if (!nbs || !pV) continue;
        for (const nb of nbs) {
          if (visited7.has(nb)) continue;
          const pNb = canonPositions[nb];
          if (!pNb) continue;
          len += Vector3.Distance(pV, pNb);
          visited7.add(nb);
          compMap7.set(nb, cId7);
          stack.push(nb);
        }
      }
      compLen7[cId7] = len;
    }
    const MIN_TINY_COMP_LEN = MARGIN_LOCK.MIN_TINY_COMP_LEN; // mm — 이보다 짧으면 noise 로 폐기
    const keptCand: CandEdge[] = [];
    for (const e of marginCand) {
      const cid = compMap7.get(e.va) ?? 0;
      const clen = compLen7[cid] ?? 0;
      if (clen >= MIN_TINY_COMP_LEN) keptCand.push(e);
    }
    droppedTinyComps = marginCand.length - keptCand.length;
    if (droppedTinyComps > 0) {
      marginCand.length = 0;
      marginCand.push(...keptCand);
    }
  }

  // ⑧ 후처리 2 — Endpoint bridge: spur 제거 후 남은 backbone 양 끝 endpoint 끼리
  //   STL 표면(mesh vertex-edge graph) 위의 Dijkstra 최단 경로로 연결.
  //   직선 bridge 가 모델 내부/외부를 가로지르는 문제 해결 — 항상 표면을 따라간다.
  const bridgePoints: Vector3[] = [];
  let surfacePathCount = 0;
  let straightFallbackCount = 0;
  let interCompPathCount = 0;
  {
    // 컴포넌트 그래프 + 컴포넌트 분류
    const compAdj = new Map<number, Set<number>>();
    for (const e of marginCand) {
      let a = compAdj.get(e.va);
      if (!a) {
        a = new Set();
        compAdj.set(e.va, a);
      }
      a.add(e.vb);
      let b = compAdj.get(e.vb);
      if (!b) {
        b = new Set();
        compAdj.set(e.vb, b);
      }
      b.add(e.va);
    }
    const vertexComp = new Map<number, number>();
    const compVertices = new Map<number, number[]>();
    let compIdNext = 0;
    for (const startV of compAdj.keys()) {
      if (vertexComp.has(startV)) continue;
      compIdNext++;
      const stack = [startV];
      vertexComp.set(startV, compIdNext);
      const arr: number[] = [];
      while (stack.length > 0) {
        const v = stack.pop() as number;
        arr.push(v);
        const nbs = compAdj.get(v);
        if (!nbs) continue;
        for (const nb of nbs) {
          if (!vertexComp.has(nb)) {
            vertexComp.set(nb, compIdNext);
            stack.push(nb);
          }
        }
      }
      compVertices.set(compIdNext, arr);
    }

    const BRIDGE_MAX = MARGIN_LOCK.BRIDGE_MAX; // endpoint(degree-1) 쌍 직선거리
    // weighted Dijkstra weighted distance 한계 — ridge 우회 허용 위해 ×4.5.
    //   ×3 으로는 휘는 ridge path 가 한계 초과로 실패 → 직선 폴백으로 빠지는 경우 발생.
    const SURFACE_MAX = BRIDGE_MAX * MARGIN_LOCK.SURFACE_MAX_MULT;
    const INTERCOMP_BRIDGE_MAX = MARGIN_LOCK.INTERCOMP_BRIDGE_MAX;
    const INTERCOMP_SURFACE_MAX = INTERCOMP_BRIDGE_MAX * MARGIN_LOCK.INTERCOMP_SURFACE_MAX_MULT;
    const MIN_COMP_VERTS = MARGIN_LOCK.MIN_COMP_VERTS; // 단일-edge fragment 까지 bridge 대상에 포함

    // === Mesh vertex-edge graph (canonical) — surface path 용 ===
    const meshVAdj = new Map<number, Set<number>>();
    for (const k of edgeFaces.keys()) {
      const ci = k.indexOf(',');
      const va = +k.slice(0, ci);
      const vb = +k.slice(ci + 1);
      let a = meshVAdj.get(va);
      if (!a) {
        a = new Set();
        meshVAdj.set(va, a);
      }
      a.add(vb);
      let b = meshVAdj.get(vb);
      if (!b) {
        b = new Set();
        meshVAdj.set(vb, b);
      }
      b.add(va);
    }

    // Dijkstra — start→end 까지 mesh edge 경로 (weighted: sharp 우선). 못 찾으면 null.
    //   cost = length × (1 + dotNN²×4). Sharp edge (dotNN→0) 는 cost ≈ length,
    //   Smooth edge (dotNN→1) 는 cost ≈ 5×length. 결과: ridge 따라 path 형성.
    //   VISIT_CAP: 큰 mesh 에서 weighted 거리로 explored 폭증 시 abort → UI freeze 방지.
    const findSurfacePath = (
      start: number,
      end: number,
      maxDist: number
    ): number[] | null => {
      const VISIT_CAP = MARGIN_LOCK.VISIT_CAP; // 충분한 탐색 기회 (UI freeze 한계는 여전히 안전 범위)
      const dist = new Map<number, number>();
      const prev = new Map<number, number>();
      dist.set(start, 0);
      const queueD: { v: number; d: number }[] = [{ v: start, d: 0 }];
      let visited = 0;
      while (queueD.length > 0) {
        if (visited++ > VISIT_CAP) return null;
        let minIdx = 0;
        for (let i = 1; i < queueD.length; i++) {
          if (queueD[i].d < queueD[minIdx].d) minIdx = i;
        }
        const cur = queueD.splice(minIdx, 1)[0];
        const v = cur.v;
        const d = cur.d;
        if (v === end) {
          const path: number[] = [end];
          let c: number = end;
          while (c !== start) {
            const p = prev.get(c);
            if (p === undefined) return null;
            path.unshift(p);
            c = p;
          }
          return path;
        }
        if (d > (dist.get(v) ?? Infinity)) continue;
        if (d > maxDist) continue;
        const pV = canonPositions[v];
        if (!pV) continue;
        const adj = meshVAdj.get(v);
        if (!adj) continue;
        for (const nb of adj) {
          const pNb = canonPositions[nb];
          if (!pNb) continue;
          const ekk = v < nb ? `${v},${nb}` : `${nb},${v}`;
          const dotNN = edgeDihedral.get(ekk) ?? 1.0;
          // dihedral 가중치: sharp(dotNN≈0) → 1.0× , smooth(dotNN≈1) → 5.0×
          const weight = 1 + dotNN * dotNN * 4;
          const nd = d + Vector3.Distance(pV, pNb) * weight;
          if (nd > maxDist) continue;
          if (nd < (dist.get(nb) ?? Infinity)) {
            dist.set(nb, nd);
            prev.set(nb, v);
            queueD.push({ v: nb, d: nd });
          }
        }
      }
      return null;
    };

    // 1) Endpoint bridge — degree-1 vertex 쌍 (열린 chain 끝 끼리)
    const endpoints: number[] = [];
    for (const [v, nbs] of compAdj) {
      if (nbs.size === 1) endpoints.push(v);
    }
    if (endpoints.length >= 2) {
      const pairs: { a: number; b: number; d: number }[] = [];
      for (let i = 0; i < endpoints.length; i++) {
        for (let j = i + 1; j < endpoints.length; j++) {
          const a = endpoints[i];
          const b = endpoints[j];
          const pa = canonPositions[a];
          const pb = canonPositions[b];
          if (!pa || !pb) continue;
          const d = Vector3.Distance(pa, pb);
          if (d <= BRIDGE_MAX) pairs.push({ a, b, d });
        }
      }
      pairs.sort((x, y) => x.d - y.d);
      const used = new Set<number>();
      for (const p of pairs) {
        if (used.has(p.a) || used.has(p.b)) continue;
        used.add(p.a);
        used.add(p.b);
        const path = findSurfacePath(p.a, p.b, SURFACE_MAX);
        if (path && path.length >= 2) {
          for (let i = 0; i < path.length - 1; i++) {
            const va = path[i];
            const vb = path[i + 1];
            const pa = canonPositions[va];
            const pb = canonPositions[vb];
            if (!pa || !pb) continue;
            marginCand.push({ va, vb, pa, pb });
            bridgePoints.push(pa.add(pb).scale(0.5));
          }
          surfacePathCount++;
        } else {
          // 직선 폴백 제거 — surface path 못 찾으면 차라리 끊김 유지. 사용자 사진처럼
          //   직선이 마진 외 영역을 가로지르는 사고 차단. straightFallbackCount 는 stat 용으로만.
          straightFallbackCount++;
        }
      }
    }

    // 2) 컴포넌트 간 bridge — 닫힌 loop 등 endpoint 없는 컴포넌트 끼리 잇기.
    //   사용자 시나리오: 사진처럼 위쪽 닫힌 loop + 아래쪽 별도 chain → endpoint 0개 →
    //   기존 endpoint bridge 작동 안 함. 두 컴포넌트의 최근접 vertex 쌍을 surface path 로.
    //   안전: MIN_COMP_VERTS=4 로 단일-edge noise 컴포넌트 배제, INTERCOMP_BRIDGE_MAX=15mm 한계.
    const substantialComps = Array.from(compVertices.entries())
      .filter(([, verts]) => verts.length >= MIN_COMP_VERTS)
      .map(([id]) => id);
    if (substantialComps.length >= 2) {
      type CompPair = { a: number; b: number; va: number; vb: number; d: number };
      const compPairs: CompPair[] = [];
      for (let i = 0; i < substantialComps.length; i++) {
        for (let j = i + 1; j < substantialComps.length; j++) {
          const aVerts = compVertices.get(substantialComps[i]);
          const bVerts = compVertices.get(substantialComps[j]);
          if (!aVerts || !bVerts) continue;
          let bestD: number = INTERCOMP_BRIDGE_MAX;
          let bestA = -1;
          let bestB = -1;
          for (const va of aVerts) {
            const pa = canonPositions[va];
            if (!pa) continue;
            for (const vb of bVerts) {
              const pb = canonPositions[vb];
              if (!pb) continue;
              const dx = pa.x - pb.x;
              const dy = pa.y - pb.y;
              const dz = pa.z - pb.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < bestD * bestD) {
                bestD = Math.sqrt(d2);
                bestA = va;
                bestB = vb;
              }
            }
          }
          if (bestA >= 0) {
            compPairs.push({
              a: substantialComps[i],
              b: substantialComps[j],
              va: bestA,
              vb: bestB,
              d: bestD,
            });
          }
        }
      }
      // 가까운 컴포넌트 쌍부터 bridge — 이미 연결된 컴포넌트는 건너뜀 (union-find)
      compPairs.sort((x, y) => x.d - y.d);
      const compRoot = new Map<number, number>();
      for (const id of substantialComps) compRoot.set(id, id);
      const findRoot = (id: number): number => {
        let r = id;
        while (compRoot.get(r) !== r) r = compRoot.get(r) as number;
        let c = id;
        while (compRoot.get(c) !== r) {
          const next = compRoot.get(c) as number;
          compRoot.set(c, r);
          c = next;
        }
        return r;
      };
      for (const cp of compPairs) {
        const ra = findRoot(cp.a);
        const rb = findRoot(cp.b);
        if (ra === rb) continue; // 이미 같은 union → bridge 중복
        const path = findSurfacePath(cp.va, cp.vb, INTERCOMP_SURFACE_MAX);
        if (path && path.length >= 2) {
          for (let k = 0; k < path.length - 1; k++) {
            const va = path[k];
            const vb = path[k + 1];
            const pa = canonPositions[va];
            const pb = canonPositions[vb];
            if (!pa || !pb) continue;
            marginCand.push({ va, vb, pa, pb });
            bridgePoints.push(pa.add(pb).scale(0.5));
          }
          interCompPathCount++;
          compRoot.set(ra, rb);
        }
      }
    }
  }

  // 마진 점 — 자동 서포트 가드 거리 판정용.
  //   마진 라인 segment 따라 0.2mm 간격으로 dense sampling → sphere tip 이 segment
  //   사이 빈 공간으로 빠져 마진 라인을 가로지르는 케이스 방지. 가드는 마진 점에서
  //   (0.5mm + sphereR) 거리로 검사되므로 점이 빽빽해야 정확.
  const marginPoints: Vector3[] = [];
  const MARGIN_SAMPLE_STEP = MARGIN_LOCK.MARGIN_SAMPLE_STEP; // mm
  for (const e of marginCand) {
    const dx = e.pb.x - e.pa.x;
    const dy = e.pb.y - e.pa.y;
    const dz = e.pb.z - e.pa.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const n = Math.max(1, Math.ceil(len / MARGIN_SAMPLE_STEP));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      marginPoints.push(
        new Vector3(e.pa.x + dx * t, e.pa.y + dy * t, e.pa.z + dz * t)
      );
    }
  }

  // 교합면(외면) — 색칠된 삼각형들의 평균 Y 이하 (대략적 가드용)
  let sumY = 0;
  let cnt = 0;
  for (const t of tris) {
    if (paintedSet.has(t.faceIndex)) {
      sumY += t.centroid.y;
      cnt++;
    }
  }
  const yMargin = cnt > 0 ? sumY / cnt : 0;
  const occlusalFaces = new Set<number>();
  for (const t of tris) {
    if (t.centroid.y < yMargin + 0.2) occlusalFaces.add(t.faceIndex);
  }

  // 마진 엣지 키 (canonical) — floodfill 차단용
  const edgeKeys = new Set<string>();
  for (const e of marginCand) {
    edgeKeys.add(e.va < e.vb ? `${e.va},${e.vb}` : `${e.vb},${e.va}`);
  }

  const stats: FindMarginStats = {
    paintedFaceCount: paintedSet.size,
    seedEdgeCount: seedKeys.size,
    globalSharpEdgeCount: allKeys.size,
    marginEdgeCount: marginCand.length,
    cornerExtSteps,
    droppedTinyComps,
    surfacePathCount,
    straightFallbackCount,
    interCompPathCount,
    bridgeSegCount: bridgePoints.length,
    seedRegionR: SEED_REGION_R,
  };

  return {
    ok: true,
    result: {
      points: marginPoints,
      edges: marginCand,
      edgeKeys,
      bridgePoints,
      occlusalFaces,
      canon,
      canonPositions,
      stats,
    },
  };
}
