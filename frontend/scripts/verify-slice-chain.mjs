// 슬라이스 체인 끊김 헤드리스 검증 — chainSegments 1 µm 양자화 키 × 공유 변 보간 방향 (기존 결함 수정).
//
//   결함: 이웃한 두 삼각형은 공유 변을 서로 반대 방향(a→b / b→a)으로 갖는다. sliceTrianglesAtY 가
//     변을 끝점 순서대로 보간하면 수학적으로 같은 교차점이 1 ulp 남짓 달라지고, 그 차이가 x.5 µm
//     반올림 경계를 넘으면 chainSegments 의 1 µm 키(Math.round(x·1000))가 갈라져 체인이 끊긴다.
//     열린 체인이 현(chord)으로 닫히며 단면 일부가 빠진다 = 마스크 구멍.
//     재현: 상자 (−0.15,0,−4)–(0.15,1,6.5), lh 0.05 → 20층 중 2층 끊김. 층 4 는 폴리곤 2개·면적 2.44 mm²
//     (정상 3.15 — 0.71 mm² 삼각형 누락), DLP 마스크 흰 픽셀 1110(정상 1230, 2560×1620 @130.56×82.62).
//     0.1 mm 단위 치수 상자 200개 lh 0.025 에서 상자 5개·층 26개(검수 집계, 면적 오차 1% 초과 23층).
//     드문 일만은 아니다 — 교차 좌표가 정확히 x.5 µm 에 오는 반듯한 치수면 잦다: 예제 20 mm 정육면체 lh 0.025 는
//     800층 중 158층, 10×10×4 속 빈 상자 lh 0.05 는 80층 중 14층이 끊겼다.
//   수정: 교차 변 보간을 언제나 평면 아래(d<0) 끝점 → 위 끝점 방향으로 고정 — 공유 변의 두 삼각형이 같은
//     입력으로 같은 식을 계산해 교차점이 비트까지 같다. 선분 방향(B-7)·감김은 그대로.
//
//   검사 항목:
//     (a) 재현 사례 — 위 막대 lh 0.05 20층: 층마다 폴리곤 1개·열린 체인 0·면적 = 해석값,
//         DLP 마스크(rasterizePolygons)와 Task0 마스크(task0LayerPolygonsBed → rasterizeTask0Mask)가
//         20층 모두 층 0 과 바이트 동일(각기둥이므로 단면이 같아야 한다)
//     (a2) 예제 정육면체(SAMPLE_MODELS cube20) lh 0.025 800층: 열린 체인 0, 면적 = 400 mm²
//     (b) 0.1 mm 단위 치수 상자 600개 (lh 0.1·0.05·0.025 각 200 — 검수 재현 표본과 같은 난수열):
//         열린 체인 0, 면적 = 해석값
//     (c) 회전 상자 — Y축 회전 200개(lh 0.05, 해석 면적) + 3D 임의 회전 100개(lh 0.05, 독립 계산 면적)
//     (d) 얇은 막대 300개 (폭 0.05~0.30 mm, 0.1 mm 격자 자리, lh 0.025): 열린 체인 0, 면적 = 해석값
//     (e) 구 — 예제 구(SAMPLE_MODELS sphere20) lh 0.025 + 무작위 UV 구 20개(반경·중심·분할·회전) lh 0.05:
//         열린 체인 0, 면적 = 독립 계산
//     (f) 끝점 비트 일치 — 꼭짓점이 비트 동일한(용접된) 메시면 모든 교차점에서 들어오는 선분 수 = 나가는
//         선분 수(좌표 === 비교, 양자화 없음). 수정의 직접 근거(공유 변 교차점 비트 일치)를 본다.
//         예제 구는 북극점이 sin(π)≠0 이라 경도마다 1e-15 mm 다른 꼭짓점이어서 이 전제가 안 맞아 (f) 에서 뺀다
//         (그 차이는 µm 키 경계를 넘을 확률이 사실상 0 — (e) 의 체인·면적 검사는 그대로 적용).
//     (g) 감김 보존(B-7) — 속 빈 상자·구(내벽 반대 감김), 겹친 상자·구(같은 감김): nonzero 마스크가 기대대로
//         (내강 비움·겹침 채움), 폴리곤 감김 부호 관계 유지, **수정 전 함수와 마스크 바이트 동일**
//     (h) 대조군 — 수정 전 sliceTrianglesAtY 복제본으로 (a)(a2)(b)(f) 를 돌려 끊김·면적 오차·비트 불일치를
//         실제로 검출하는지(검사가 통과만 하는 검사가 아님). 수정 전 구현 자체로 이 스크립트를 돌리면 exit 1.
//
//   "열린 체인" 판정: 폴리곤의 이웃 두 점(마지막→첫 점 포함)이 입력 선분(1 µm 키 기준 유방향)으로
//     이어져 있지 않으면 현(chord), 폴리곤에 쓰이지 않은 선분이 남으면 누락 — 둘 다 0 이어야 한다.
//   면적 허용치: chainSegments 는 같은 1 µm 칸의 서로 다른 점(예: 꼭짓점 0.25 µm 옆 교차점)을 의도적으로
//     합친다 — 대표점이 최대 √2 µm 움직이므로 |오차| ≤ 1.5e-3 mm × 둘레 + 1e-9. 끊김(현으로 닫힘)은
//     이보다 수십 배 크다(재현 사례 0.71 mm² vs 허용 0.032 mm²).
//
//   실행: npx tsx scripts/verify-slice-chain.mjs   (판정은 exit code)

import {
  chainSegments,
  normalizeTriangleWinding,
  sliceTrianglesAtY,
} from "../src/features/v2/utils/slice-geometry.ts";
import { rasterizePolygons } from "../src/features/v2/utils/slice-rasterize.ts";
import { SAMPLE_MODELS } from "../src/features/v2/utils/sample-models.ts";
import { rasterizeTask0Mask } from "../src/features/v2/utils/task0/task0-mask.ts";
import { task0LayerPolygonsBed } from "../src/features/v2/utils/task0/task0-slice.ts";

// ── assert 유틸 ──────────────────────────────────────────────────────────
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

// ── 대조군: 수정 전 sliceTrianglesAtY (788c255 그대로 — 보간을 변 끝점 순서대로) ──────
const EPS = 1e-6;
function sliceTrianglesAtYBeforeFix(triangles, y) {
  const out = [];
  for (let t = 0; t + 9 <= triangles.length; t += 9) {
    const v0x = triangles[t], v0y = triangles[t + 1], v0z = triangles[t + 2];
    const v1x = triangles[t + 3], v1y = triangles[t + 4], v1z = triangles[t + 5];
    const v2x = triangles[t + 6], v2y = triangles[t + 7], v2z = triangles[t + 8];
    const d0 = v0y - y, d1 = v1y - y, d2 = v2y - y;
    if (d0 > EPS && d1 > EPS && d2 > EPS) continue;
    if (d0 < -EPS && d1 < -EPS && d2 < -EPS) continue;
    if (Math.abs(d0) < EPS && Math.abs(d1) < EPS && Math.abs(d2) < EPS) continue;
    const cross = [];
    const tryEdge = (ax, az, bx, bz, da, db) => {
      if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
        const tt = da / (da - db);
        cross.push([ax + tt * (bx - ax), az + tt * (bz - az)]);
      } else if (Math.abs(da) < EPS) {
        cross.push([ax, az]);
      }
    };
    tryEdge(v0x, v0z, v1x, v1z, d0, d1);
    tryEdge(v1x, v1z, v2x, v2z, d1, d2);
    tryEdge(v2x, v2z, v0x, v0z, d2, d0);
    if (cross.length >= 2) {
      const p0 = cross[0], p1 = cross[1];
      const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
      const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
      const nx = e1y * e2z - e1z * e2y;
      const nz = e1x * e2y - e1y * e2x;
      const tx = nz, tz = -nx;
      const swap = tx * tx + tz * tz >= 1e-12 && (p1[0] - p0[0]) * tx + (p1[1] - p0[1]) * tz < 0;
      out.push(swap ? { a: p1, b: p0 } : { a: p0, b: p1 });
    }
  }
  return out;
}

const SLICERS = { fixed: sliceTrianglesAtY, beforeFix: sliceTrianglesAtYBeforeFix };

// ── 지오메트리 ───────────────────────────────────────────────────────────

/** 정점 8개 + 면 12개(바깥 법선 CCW)로 삼각형 배열. `flip` 이면 감김 반전(내벽용). 꼭짓점은 한 번만 계산 → 비트 동일 공유 */
function trisFromBoxVerts(v, flip = false) {
  const faces = [
    [0, 3, 2], [0, 2, 1], // −Y
    [4, 5, 6], [4, 6, 7], // +Y
    [0, 1, 5], [0, 5, 4], // −Z
    [2, 3, 7], [2, 7, 6], // +Z
    [3, 0, 4], [3, 4, 7], // −X
    [1, 2, 6], [1, 6, 5], // +X
  ];
  const out = new Float32Array(faces.length * 9);
  let o = 0;
  for (const f of faces) {
    for (const k of flip ? [f[0], f[2], f[1]] : f) {
      out[o++] = v[k][0];
      out[o++] = v[k][1];
      out[o++] = v[k][2];
    }
  }
  return out;
}

/** 축정렬 상자 (verify-task0-writer boxTriangles 와 같은 꼭짓점·면 순서) */
function boxTriangles(min, max, flip = false) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return trisFromBoxVerts(
    [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ],
    flip,
  );
}

/** 3×3 회전 행렬 (Rz·Ry·Rx) */
function rotMatrix(ax, ay, az) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}
const mulV = (R, p) => [
  R[0][0] * p[0] + R[0][1] * p[1] + R[0][2] * p[2],
  R[1][0] * p[0] + R[1][1] * p[1] + R[1][2] * p[2],
  R[2][0] * p[0] + R[2][1] * p[1] + R[2][2] * p[2],
];

/** 중심 c·반치수 h 상자를 R 로 돌린 것 (꼭짓점 8개를 한 번씩 계산) */
function rotatedBox(c, h, R) {
  const v = [];
  for (const [sx, sy, sz] of [
    [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
    [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
  ]) {
    const p = mulV(R, [sx * h[0], sy * h[1], sz * h[2]]);
    v.push([c[0] + p[0], c[1] + p[1], c[2] + p[2]]);
  }
  return normalizeTriangleWinding(trisFromBoxVerts(v));
}

/** UV 구 (용접 — 극점 1개씩, 꼭짓점 표 한 번 계산). R 로 분할 방향을 돌린다. `flip` 이면 내벽용 반전 감김 */
function uvSphere(c, r, lat, lon, R, flip = false) {
  const vert = (p) => {
    const q = mulV(R, p);
    return [c[0] + r * q[0], c[1] + r * q[1], c[2] + r * q[2]];
  };
  const south = vert([0, -1, 0]);
  const north = vert([0, 1, 0]);
  const ring = [];
  for (let i = 1; i < lat; i++) {
    const phi = (Math.PI * i) / lat;
    const row = [];
    for (let j = 0; j < lon; j++) {
      const th = (2 * Math.PI * j) / lon;
      row.push(vert([Math.sin(phi) * Math.cos(th), -Math.cos(phi), Math.sin(phi) * Math.sin(th)]));
    }
    ring.push(row);
  }
  const tris = [];
  const push = (a, b, c2) => tris.push(...(flip ? [a, c2, b] : [a, b, c2]));
  for (let j = 0; j < lon; j++) {
    const j1 = (j + 1) % lon;
    push(south, ring[0][j], ring[0][j1]);
    push(north, ring[lat - 2][j1], ring[lat - 2][j]);
    for (let i = 0; i + 1 < lat - 1; i++) {
      push(ring[i][j], ring[i + 1][j], ring[i + 1][j1]);
      push(ring[i][j], ring[i + 1][j1], ring[i][j1]);
    }
  }
  return Float32Array.from(tris.flat());
}

function concatTris(...arrays) {
  const out = new Float32Array(arrays.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

function yRange(tris) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < tris.length; i += 3) {
    lo = Math.min(lo, tris[i]);
    hi = Math.max(hi, tris[i]);
  }
  return [lo, hi];
}

/** 예제 구(바이너리 STL) → 삼각형 배열 (파일 좌표 그대로 — 바닥 y 0, XZ 중심 원점) */
async function sampleSphereTris() {
  const def = SAMPLE_MODELS.find((m) => m.id === "sphere20");
  const buf = await def.build().arrayBuffer();
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  const t = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 9; k++) t[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
  }
  return normalizeTriangleWinding(t);
}

// ── 판정 도구 ────────────────────────────────────────────────────────────

const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};
const perimeter = (polys) => {
  let s = 0;
  for (const { points: pts } of polys) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      s += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
  }
  return s;
};
const areaTol = (polys) => 1.5e-3 * perimeter(polys) + 1e-9;

/** 열린 체인 판정 — 폴리곤 변이 입력 선분(1 µm 키, 유방향)에 없으면 현, 쓰이지 않은 선분은 누락 */
function chainDefects(segs, polys) {
  const key = (p) => `${Math.round(p[0] * 1000)}_${Math.round(p[1] * 1000)}`;
  const avail = new Map();
  for (const s of segs) {
    const ka = key(s.a), kb = key(s.b);
    if (ka === kb) continue; // chainSegments 도 버리는 1 µm 미만 선분
    const k = `${ka}>${kb}`;
    avail.set(k, (avail.get(k) ?? 0) + 1);
  }
  let chords = 0;
  for (const { points: pts } of polys) {
    for (let i = 0; i < pts.length; i++) {
      const k = `${key(pts[i])}>${key(pts[(i + 1) % pts.length])}`;
      const c = avail.get(k);
      if (c) avail.set(k, c - 1);
      else chords++;
    }
  }
  let unused = 0;
  for (const c of avail.values()) unused += c;
  return chords + unused;
}

/** 끝점 비트 일치 판정 — 좌표가 정확히 같은 점마다 (나가는 수 − 들어오는 수) 의 |합|/2. 0 이어야 닫힌 곡선 */
function exactImbalance(segs) {
  const m = new Map();
  const k = (p) => `${p[0]},${p[1]}`;
  for (const s of segs) {
    m.set(k(s.a), (m.get(k(s.a)) ?? 0) + 1);
    m.set(k(s.b), (m.get(k(s.b)) ?? 0) - 1);
  }
  let s = 0;
  for (const v of m.values()) s += Math.abs(v);
  return s / 2;
}

/**
 * 독립 계산 단면 면적(부호 포함) — 이 스크립트 자체 구현의 삼각형·평면 교차 + Green 합.
 *   체인 연결과 무관하다(선분을 잇지 않고 선분마다 ½ a×b 를 더함). 교차점은 변 (i→j) 를 고정 순서로 보간하고
 *   방향은 바깥 법선 수평 성분 t = (n_z, −n_x) 로 정한다(B-7 과 같은 정의, 별도 코드).
 *   평면 위 꼭짓점이 나오면 표본 설계 오류라 throw.
 */
function refSectionArea(tris, y) {
  let A = 0;
  for (let t = 0; t + 9 <= tris.length; t += 9) {
    const P = [
      [tris[t], tris[t + 1], tris[t + 2]],
      [tris[t + 3], tris[t + 4], tris[t + 5]],
      [tris[t + 6], tris[t + 7], tris[t + 8]],
    ];
    const d = P.map((p) => p[1] - y);
    if (d.some((v) => v === 0)) throw new Error(`표본 오류: 평면 위 꼭짓점 (y=${y})`);
    const pts = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if ((d[i] < 0) !== (d[j] < 0)) {
        const s = d[i] / (d[i] - d[j]);
        pts.push([P[i][0] + s * (P[j][0] - P[i][0]), P[i][2] + s * (P[j][2] - P[i][2])]);
      }
    }
    if (pts.length !== 2) continue;
    const e1 = [P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]];
    const e2 = [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    let [p, q] = pts;
    if ((q[0] - p[0]) * nz + (q[1] - p[1]) * -nx < 0) [p, q] = [q, p];
    A += (p[0] * q[1] - q[0] * p[1]) / 2;
  }
  return A;
}

/**
 * 한 형상을 층마다 잘라 판정. `area` = (y) → 기대 |면적| 또는 null(독립 계산 사용).
 * `skipEndsMm` — 형상 맨 아래·맨 위 꼭짓점에서 이 거리 안의 층은 뺀다. 꼭짓점 하나만 걸친 µm 급 단면
 *   (돌린 상자 모서리 끝)은 1 µm 키 병합으로 점이 합쳐져 폴리곤이 사라지는데(설계상 µm 미만 형상 무시),
 *   이번 결함과 무관하고 수정 전/후 같다. 축정렬·Y축 회전 형상은 끝이 수평면이라 해당 없음.
 * 반환: { layers, skipped, broken(열린 체인 층), areaBad, imbalanced(비트 불일치 층), worstAreaErr, first }
 */
function scanShape(slice, tris, lh, opts = {}) {
  const [lo, hi] = yRange(tris);
  const skip = opts.skipEndsMm ?? 0;
  const r = { layers: 0, skipped: 0, broken: 0, areaBad: 0, imbalanced: 0, worstAreaErr: 0, first: null };
  for (let n = 0; ; n++) {
    const y = (n + 0.5) * lh;
    if (y >= hi) break;
    if (y <= lo) continue;
    if (y - lo < skip || hi - y < skip) {
      r.skipped++;
      continue;
    }
    r.layers++;
    const segs = slice(tris, y);
    const polys = chainSegments(segs);
    const A = polys.reduce((s, p) => s + signedArea(p.points), 0);
    const expect = opts.area ? opts.area(y) : null;
    const err = expect !== null ? Math.abs(Math.abs(A) - expect) : Math.abs(A - refSectionArea(tris, y));
    const defects = chainDefects(segs, polys);
    const imb = opts.exact ? exactImbalance(segs) : 0;
    if (defects) r.broken++;
    if (err > areaTol(polys)) r.areaBad++;
    if (imb) r.imbalanced++;
    if (err > r.worstAreaErr) r.worstAreaErr = err;
    if (!r.first && (defects || err > areaTol(polys))) {
      r.first = { n, y, polys: polys.length, defects, A: Number(A.toFixed(5)), err: Number(err.toFixed(5)), imb };
    }
  }
  return r;
}

function addStats(acc, r) {
  for (const k of ["layers", "skipped", "broken", "areaBad", "imbalanced"]) acc[k] = (acc[k] ?? 0) + r[k];
  acc.shapesBroken = (acc.shapesBroken ?? 0) + (r.broken || r.areaBad ? 1 : 0);
  acc.worstAreaErr = Math.max(acc.worstAreaErr ?? 0, r.worstAreaErr);
  if (!acc.first && r.first) acc.first = r.first;
  return acc;
}
const fmt = (s) =>
  `층 ${s.layers}${s.skipped ? ` (끝 꼭짓점 10 µm 안 ${s.skipped}층 제외)` : ""}: 열린 체인 층 ${s.broken}, ` +
  `면적 불일치 층 ${s.areaBad}, 비트 불일치 층 ${s.imbalanced}, 걸린 형상 ${s.shapesBroken}, ` +
  `최대 면적 오차 ${s.worstAreaErr.toExponential(2)} mm²` +
  (s.first ? ` (첫 끊김 ${JSON.stringify(s.first)})` : "");

// 결정적 난수 — 검수 재현 스크립트와 같은 LCG(seed 5) 라 (b) 표본이 검수 집계와 같다.
let seed = 5;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const r10 = (v) => Math.round(v * 10) / 10;

// ── (a) 재현 사례 ────────────────────────────────────────────────────────

const BAR = normalizeTriangleWinding(boxTriangles([-0.15, 0, -4], [0.15, 1, 6.5]));
const BAR_AREA = (Math.fround(0.15) - Math.fround(-0.15)) * 10.5;
const DLP_OPTS = { widthPx: 2560, heightPx: 1620, plateWidthMm: 130.56, plateDepthMm: 82.62 };
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const whiteOf = (data) => data.reduce((s, v) => s + (v ? 1 : 0), 0);

function caseRepro() {
  console.log("\n(a) 재현 사례 — 상자 (−0.15,0,−4)–(0.15,1,6.5), lh 0.05, 20층");
  const out = {};
  for (const [name, slice] of Object.entries(SLICERS)) {
    const s = addStats({}, scanShape(slice, BAR, 0.05, { area: () => BAR_AREA, exact: true }));
    const masks = [];
    let onePoly = 0;
    for (let n = 0; n < 20; n++) {
      const polys = chainSegments(slice(BAR, (n + 0.5) * 0.05));
      if (polys.length === 1) onePoly++;
      masks.push(rasterizePolygons(polys, DLP_OPTS).data);
    }
    const maskDiff = masks.filter((m) => !sameBytes(m, masks[0])).length;
    const white = masks.map(whiteOf);
    console.log(`  [${name}] ${fmt(s)}`);
    console.log(`  [${name}] 폴리곤 1개인 층 ${onePoly}/20, DLP 마스크가 층 0 과 다른 층 ${maskDiff}, 흰 픽셀 최소 ${Math.min(...white)} 최대 ${Math.max(...white)}`);
    out[name] = { s, onePoly, maskDiff };
  }
  const f = out.fixed;
  assert(f.s.layers === 20 && f.s.broken === 0, "(a) 수정 후 20층 열린 체인 0");
  assert(f.onePoly === 20, "(a) 수정 후 20층 모두 폴리곤 1개");
  assert(f.s.areaBad === 0 && f.s.worstAreaErr < 1e-6, `(a) 수정 후 면적 = 해석값 ${BAR_AREA.toFixed(6)} mm² (최대 오차 ${f.s.worstAreaErr.toExponential(2)})`);
  assert(f.s.imbalanced === 0, "(a) 수정 후 끝점 비트 일치");
  assert(f.maskDiff === 0, "(a) 수정 후 DLP 마스크 20층이 층 0 과 바이트 동일");

  // Task0 경로(실제 함수 — 수정된 sliceTrianglesAtY 를 쓴다)
  const t0 = [];
  for (let n = 0; n < 20; n++) t0.push(rasterizeTask0Mask(task0LayerPolygonsBed([BAR], n, 0.05), { roi: "full" }));
  const t0Diff = t0.filter((m) => !sameBytes(m.data, t0[0].data)).length;
  console.log(`  Task0 마스크: 흰 픽셀 층 0 = ${t0[0].whitePixels}, 층 4 = ${t0[4].whitePixels}, 층 0 과 다른 층 ${t0Diff}`);
  assert(t0Diff === 0 && t0[0].whitePixels > 0, "(a) Task0 마스크 20층이 층 0 과 바이트 동일");

  // 대조군
  const b = out.beforeFix;
  assert(b.s.broken >= 1, `(h) 대조군: 수정 전 함수는 열린 체인 층을 검출 (${b.s.broken}층)`);
  assert(b.s.worstAreaErr > 0.5, `(h) 대조군: 수정 전 함수 면적 오차 ${b.s.worstAreaErr.toFixed(4)} mm² > 0.5 (삼각형 누락)`);
  assert(b.maskDiff >= 1, `(h) 대조군: 수정 전 함수의 DLP 마스크가 층 0 과 다른 층 ${b.maskDiff}개`);
  assert(b.s.imbalanced >= 1, `(h) 대조군: 수정 전 함수 끝점 비트 불일치 층 ${b.s.imbalanced}개`);
}

/**
 * (a2) 예제 정육면체(SAMPLE_MODELS cube20, 파일 좌표 ±10·0~20) lh 0.025 — 측면 대각선 교차 x = −10 + y 가
 *   y = (N+0.5)·0.025 에서 언제나 x.5 µm 라 수정 전에는 800층 중 다수가 끊겼다(층두께 입력은 0.005 단위라
 *   0.015·0.025·0.035… 모두 같은 처지). 면적 해석값 400 mm².
 */
async function caseSampleCube() {
  console.log("\n(a2) 예제 정육면체 cube20 lh 0.025 (800층)");
  const def = SAMPLE_MODELS.find((m) => m.id === "cube20");
  const buf = await def.build().arrayBuffer();
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  const t = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 9; k++) t[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
  }
  const cube = normalizeTriangleWinding(t);
  const res = {};
  for (const [name, slice] of Object.entries(SLICERS)) {
    res[name] = addStats({}, scanShape(slice, cube, 0.025, { area: () => 400, exact: true }));
    console.log(`  [${name}] ${fmt(res[name])}`);
  }
  const f = res.fixed;
  assert(f.layers === 800 && f.broken === 0 && f.areaBad === 0 && f.imbalanced === 0, "(a2) 예제 정육면체 수정 후 800층 열린 체인·면적 불일치·비트 불일치 0");
  assert(res.beforeFix.broken >= 1 && res.beforeFix.areaBad >= 1, `(h) 대조군: 수정 전 함수는 예제 정육면체 lh 0.025 에서 끊김 검출 (열린 체인 ${res.beforeFix.broken}층)`);
}

// ── (b) 0.1 mm 단위 치수 상자 ─────────────────────────────────────────────

function caseCleanBoxes() {
  console.log("\n(b) 0.1 mm 단위 치수 상자 — lh 0.1·0.05·0.025 각 200개 (검수 재현 표본 난수열)");
  const brokenBefore = {};
  for (const lh of [0.1, 0.05, 0.025]) {
    const acc = { fixed: {}, beforeFix: {} };
    for (let k = 0; k < 200; k++) {
      // 검수 재현 스크립트와 같은 식·같은 호출 순서 (치수·자리 모두 0.1 mm 단위)
      const sx = Math.round(1 + rnd() * 150) / 10, sz = Math.round(1 + rnd() * 150) / 10, sy = Math.round(5 + rnd() * 50) / 10;
      const ox = Math.round((rnd() - 0.5) * 400) / 10, oz = Math.round((rnd() - 0.5) * 300) / 10;
      const tris = normalizeTriangleWinding(boxTriangles([ox, 0, oz], [ox + sx, sy, oz + sz]));
      // 해석 면적 — float32 로 저장된 꼭짓점 좌표 그대로
      const A = (Math.fround(ox + sx) - Math.fround(ox)) * (Math.fround(oz + sz) - Math.fround(oz));
      for (const [name, slice] of Object.entries(SLICERS)) {
        addStats(acc[name], scanShape(slice, tris, lh, { area: () => A, exact: true }));
      }
    }
    console.log(`  lh ${lh} [fixed] ${fmt(acc.fixed)}`);
    console.log(`  lh ${lh} [beforeFix] ${fmt(acc.beforeFix)}`);
    const f = acc.fixed;
    assert(f.broken === 0 && f.areaBad === 0 && f.imbalanced === 0, `(b) lh ${lh} 수정 후 열린 체인·면적 불일치·비트 불일치 0 (${f.layers}층)`);
    brokenBefore[lh] = acc.beforeFix;
  }
  const b = brokenBefore[0.025];
  assert(b.broken >= 1 && b.areaBad >= 1, `(h) 대조군: 수정 전 함수는 lh 0.025 상자에서 끊김 검출 (열린 체인 ${b.broken}층, 면적 불일치 ${b.areaBad}층, 상자 ${b.shapesBroken}개)`);
}

// ── (c) 회전 상자 ────────────────────────────────────────────────────────

function caseRotatedBoxes() {
  console.log("\n(c) 회전 상자 — Y축 회전 200개(해석 면적) + 3D 임의 회전 100개(독립 계산 면적), lh 0.05");
  const accY = { fixed: {}, beforeFix: {} };
  for (let k = 0; k < 200; k++) {
    // 검수 재현 스크립트의 "무작위 실수 치수·회전 상자" 와 같은 식·같은 난수열
    const sx = 0.3 + rnd() * 15, sz = 0.3 + rnd() * 15, sy = 0.5 + rnd() * 5;
    const ang = rnd() * Math.PI;
    const t = boxTriangles([-sx / 2, 0, -sz / 2], [sx / 2, sy, sz / 2]);
    const A = (Math.fround(sx / 2) - Math.fround(-sx / 2)) * (Math.fround(sz / 2) - Math.fround(-sz / 2));
    const c = Math.cos(ang), s = Math.sin(ang);
    for (let i = 0; i < t.length; i += 3) {
      const x = t[i], z = t[i + 2];
      t[i] = c * x + s * z;
      t[i + 2] = -s * x + c * z;
    }
    const tris = normalizeTriangleWinding(t);
    for (const [name, slice] of Object.entries(SLICERS)) addStats(accY[name], scanShape(slice, tris, 0.05, { area: () => A, exact: true }));
  }
  console.log(`  Y축 회전 [fixed] ${fmt(accY.fixed)}`);
  console.log(`  Y축 회전 [beforeFix] ${fmt(accY.beforeFix)}`);
  const f = accY.fixed;
  assert(f.broken === 0 && f.areaBad === 0 && f.imbalanced === 0, `(c) Y축 회전 상자 수정 후 열린 체인·면적 불일치·비트 불일치 0 (${f.layers}층)`);

  const acc3 = { fixed: {}, beforeFix: {} };
  for (let k = 0; k < 100; k++) {
    const h = [0.1 + rnd() * 6, 0.1 + rnd() * 6, 0.1 + rnd() * 6];
    const R = rotMatrix(rnd() * 2 * Math.PI, rnd() * 2 * Math.PI, rnd() * 2 * Math.PI);
    const c = [r10((rnd() - 0.5) * 60), 12, r10((rnd() - 0.5) * 40)];
    const tris = rotatedBox(c, h, R);
    for (const [name, slice] of Object.entries(SLICERS)) {
      addStats(acc3[name], scanShape(slice, tris, 0.05, { exact: true, skipEndsMm: 0.01 }));
    }
  }
  console.log(`  3D 회전 [fixed] ${fmt(acc3.fixed)}`);
  console.log(`  3D 회전 [beforeFix] ${fmt(acc3.beforeFix)}`);
  const g = acc3.fixed;
  assert(g.broken === 0 && g.areaBad === 0 && g.imbalanced === 0, `(c) 3D 회전 상자 수정 후 열린 체인·면적 불일치·비트 불일치 0 (${g.layers}층)`);
  return [accY.beforeFix, acc3.beforeFix];
}

// ── (d) 얇은 막대 ────────────────────────────────────────────────────────

function caseThinBars() {
  console.log("\n(d) 얇은 막대 300개 — 폭 0.05~0.30 mm, 길이 5~100 mm, 0.1 mm 격자 자리, lh 0.025");
  const acc = { fixed: {}, beforeFix: {} };
  for (let k = 0; k < 300; k++) {
    const w = Math.round(5 + rnd() * 25) / 100;
    const L = Math.round(50 + rnd() * 950) / 10;
    const hy = Math.round(5 + rnd() * 25) / 10;
    const ox = Math.round((rnd() - 0.5) * 600) / 10, oz = Math.round((rnd() - 0.5) * 400) / 10;
    const alongX = rnd() < 0.5;
    const [dx, dz] = alongX ? [L, w] : [w, L];
    const tris = normalizeTriangleWinding(boxTriangles([ox, 0, oz], [ox + dx, hy, oz + dz]));
    const A = (Math.fround(ox + dx) - Math.fround(ox)) * (Math.fround(oz + dz) - Math.fround(oz));
    for (const [name, slice] of Object.entries(SLICERS)) addStats(acc[name], scanShape(slice, tris, 0.025, { area: () => A, exact: true }));
  }
  console.log(`  [fixed] ${fmt(acc.fixed)}`);
  console.log(`  [beforeFix] ${fmt(acc.beforeFix)}`);
  const f = acc.fixed;
  assert(f.broken === 0 && f.areaBad === 0 && f.imbalanced === 0, `(d) 얇은 막대 수정 후 열린 체인·면적 불일치·비트 불일치 0 (${f.layers}층)`);
  return acc.beforeFix;
}

// ── (e) 구 ───────────────────────────────────────────────────────────────

async function caseSpheres() {
  console.log("\n(e) 구 — 예제 구 sphere20 lh 0.025 + 무작위 UV 구 20개 lh 0.05");
  const sample = await sampleSphereTris();
  const sf = scanShape(sliceTrianglesAtY, sample, 0.025);
  console.log(`  예제 구 [fixed] ${fmt(addStats({}, sf))}`);
  assert(sf.layers === 800 && sf.broken === 0 && sf.areaBad === 0, `(e) 예제 구 수정 후 ${sf.layers}층 열린 체인 0·면적 = 독립 계산`);
  // 예제 구 면적 상식 검사 — 높이 y 의 원 면적 π(r²−(y−10)²) 이하, 그 90% 이상(32 분할 내접 다각형).
  //   극 근처 층은 뺀다 — 극 팬은 원뿔이라 단면이 같은 높이 원보다 훨씬 작다.
  let sane = true;
  for (const y of [3.0125, 6.5125, 10.0125, 13.4875, 16.9875]) {
    const A = Math.abs(chainSegments(sliceTrianglesAtY(sample, y)).reduce((s, p) => s + signedArea(p.points), 0));
    const disc = Math.PI * (100 - (y - 10) ** 2);
    if (!(A <= disc * 1.0001 && A >= disc * 0.9)) sane = false;
  }
  assert(sane, "(e) 예제 구 단면 면적이 같은 높이 원 면적의 90~100% (상식 검사)");

  const acc = { fixed: {}, beforeFix: {} };
  for (let k = 0; k < 20; k++) {
    const r = Math.round(10 + rnd() * 90) / 10;
    const c = [r10((rnd() - 0.5) * 60), r + r10(rnd() * 3), r10((rnd() - 0.5) * 40)];
    const lat = 8 + Math.floor(rnd() * 40), lon = 8 + Math.floor(rnd() * 56);
    const R = rotMatrix(rnd() * 2 * Math.PI, rnd() * 2 * Math.PI, rnd() * 2 * Math.PI);
    const tris = normalizeTriangleWinding(uvSphere(c, r, lat, lon, R));
    for (const [name, slice] of Object.entries(SLICERS)) addStats(acc[name], scanShape(slice, tris, 0.05, { exact: true }));
  }
  console.log(`  UV 구 [fixed] ${fmt(acc.fixed)}`);
  console.log(`  UV 구 [beforeFix] ${fmt(acc.beforeFix)}`);
  const f = acc.fixed;
  assert(f.broken === 0 && f.areaBad === 0 && f.imbalanced === 0, `(e) UV 구 수정 후 열린 체인·면적 불일치·비트 불일치 0 (${f.layers}층)`);
  return acc.beforeFix;
}

// ── (g) 감김 보존 ────────────────────────────────────────────────────────

const WOPTS = { widthPx: 400, heightPx: 400, plateWidthMm: 40, plateDepthMm: 40 };
function sampleAt(mask, worldX, worldZ) {
  const px = Math.floor(((worldX + WOPTS.plateWidthMm / 2) / WOPTS.plateWidthMm) * WOPTS.widthPx);
  const py = Math.floor(((WOPTS.plateDepthMm / 2 - worldZ) / WOPTS.plateDepthMm) * WOPTS.heightPx);
  return mask.data[py * mask.width + px];
}

function caseWinding() {
  console.log("\n(g) 감김 보존 — 속 빈(내벽 반대 감김)·겹친(같은 감김) 상자·구, nonzero 마스크");
  const Ra = rotMatrix(0.3, 1.1, -0.4), Rb = rotMatrix(-0.7, 0.2, 0.9), Rc = rotMatrix(1.3, -0.5, 0.1), Rd = rotMatrix(0.05, 2.2, -1.7);
  const shapes = [
    {
      name: "속 빈 상자", kind: "hollow", y: 2.025, hole: [0, 0], solid: [3.5, 0],
      tris: normalizeTriangleWinding(concatTris(boxTriangles([-5, 0, -5], [5, 4, 5]), boxTriangles([-2, 0.5, -2], [2, 3.5, 2], true))),
    },
    {
      name: "속 빈 구", kind: "hollow", y: 9.025, hole: [0.3, 0.2], solid: [6.8, 0.2],
      tris: normalizeTriangleWinding(concatTris(uvSphere([0.3, 9, 0.2], 8, 24, 40, Ra), uvSphere([0.3, 9, 0.2], 5, 18, 30, Rb, true))),
    },
    {
      name: "겹친 상자", kind: "overlap", y: 2.025, overlap: [0, 0.5],
      tris: normalizeTriangleWinding(concatTris(boxTriangles([-5, 0, -3], [1, 4, 3]), boxTriangles([-1, 0, -2.5], [5, 4, 3.5]))),
    },
    {
      name: "겹친 구", kind: "overlap", y: 5.025, overlap: [0, 0],
      tris: normalizeTriangleWinding(concatTris(uvSphere([-2, 5, 0], 4, 20, 36, Rc), uvSphere([2, 5, 0], 4, 20, 36, Rd))),
    },
  ];
  for (const sh of shapes) {
    const s = scanShape(sliceTrianglesAtY, sh.tris, 0.05, { exact: true });
    // 전 층 nonzero 마스크: 수정 후 vs 수정 전 함수. 수정 전 함수가 끊긴 층(이번 결함)은 따로 센다 —
    //   거기서는 수정 전 마스크가 틀렸으므로 달라야 정상이고, 수정 후 정답 여부는 위 scanShape 가 본다.
    const [lo, hi] = yRange(sh.tris);
    let layers = 0, beforeBroken = 0, diffClean = 0, diffBroken = 0;
    for (let n = 0; ; n++) {
      const y = (n + 0.5) * 0.05;
      if (y >= hi) break;
      if (y <= lo) continue;
      layers++;
      const a = rasterizePolygons(chainSegments(sliceTrianglesAtY(sh.tris, y)), WOPTS).data;
      const segsB = sliceTrianglesAtYBeforeFix(sh.tris, y);
      const polysB = chainSegments(segsB);
      const broken = chainDefects(segsB, polysB) > 0;
      const b = rasterizePolygons(polysB, WOPTS).data;
      if (broken) beforeBroken++;
      if (!sameBytes(a, b)) {
        if (broken) diffBroken++;
        else diffClean++;
      }
    }
    const polys = chainSegments(sliceTrianglesAtY(sh.tris, sh.y));
    const mask = rasterizePolygons(polys, WOPTS);
    const signs = polys.map((p) => Math.sign(signedArea(p.points)));
    console.log(
      `  ${sh.name}: ${layers}층, 수정 후 열린 체인 층 ${s.broken}·면적 불일치 층 ${s.areaBad}·비트 불일치 층 ${s.imbalanced}; ` +
        `수정 전 함수가 끊긴 층 ${beforeBroken}(마스크 다름 ${diffBroken}), 안 끊긴 층 ${layers - beforeBroken} 중 마스크 다름 ${diffClean}; ` +
        `y ${sh.y} 폴리곤 감김 부호 ${JSON.stringify(signs)}`,
    );
    assert(s.broken === 0 && s.areaBad === 0 && s.imbalanced === 0, `(g) ${sh.name} 수정 후 열린 체인·면적 불일치·비트 불일치 0`);
    assert(
      diffClean === 0,
      `(g) ${sh.name} 수정 전 함수가 안 끊긴 ${layers - beforeBroken}층의 nonzero 마스크가 수정 전과 바이트 동일`,
    );
    if (sh.kind === "hollow") {
      assert(signs.length === 2 && signs[0] === -signs[1], `(g) ${sh.name} 바깥 윤곽·내벽 감김 반대`);
      assert(sampleAt(mask, ...sh.hole) === 0 && sampleAt(mask, ...sh.solid) === 1, `(g) ${sh.name} 내강 = 0, 벽 = 1`);
    } else {
      assert(signs.length === 2 && signs[0] === signs[1], `(g) ${sh.name} 두 솔리드 감김 같음`);
      assert(sampleAt(mask, ...sh.overlap) === 1, `(g) ${sh.name} 겹친 부위 = 1 (nonzero 채움)`);
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("슬라이스 체인 끊김 검증 — 공유 변 교차점 비트 일치 (chainSegments 1 µm 키)");
  caseRepro();
  await caseSampleCube();
  caseCleanBoxes();
  const [rotY, rot3] = caseRotatedBoxes();
  const bars = caseThinBars();
  const sph = await caseSpheres();
  caseWinding();

  console.log("\n(h) 대조군 종합 — 수정 전 함수의 끝점 비트 불일치");
  const imb = rotY.imbalanced + rot3.imbalanced + bars.imbalanced + sph.imbalanced;
  console.log(`  회전·막대·구 표본에서 비트 불일치 층 ${imb} (Y축 회전 ${rotY.imbalanced}, 3D 회전 ${rot3.imbalanced}, 막대 ${bars.imbalanced}, 구 ${sph.imbalanced})`);
  assert(imb >= 1, "(h) 대조군: 수정 전 함수는 공유 변 교차점 비트 불일치를 낸다 — (f) 검사가 실제로 검출함");

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
