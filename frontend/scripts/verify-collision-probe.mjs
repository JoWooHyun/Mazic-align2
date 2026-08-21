// 충돌 프로브 + 삼각형 인덱스 헤드리스 검증 (S-4b-2c-f).
//   triangle-index.ts / collision-probe.ts 가 **순수 모듈이 되어** 실동작을 Node 에서
//   전수 검증할 수 있게 됐다 — 2c 검수의 사각지대 ①(프로브 실동작 미검증)이
//   이번 재작업의 구조적 수확이다. 2c 까지는 Babylon 의존이라 합성 probe 로만
//   상류 로직을 봤고, 프로브 자체는 아무도 돌려보지 못했다.
//
//   실행: npx tsx scripts/verify-collision-probe.mjs
//
//   ★ 대조군 원칙 (프로젝트 규약, B-1 확립):
//     (b) 는 "고쳤다"만 보이지 않는다. **구 허용치(1.0mm)를 옵션으로 재현**해
//     같은 기하를 실제로 잘못 통과시켰음을 보이고, 신 허용치(0.4mm)가 막는 것을
//     대조한다. (a) 는 가속 구조 없는 브루트포스 참조 구현과 전수 대조한다.
//   ★ 변조 시험 (§f): DDA 셀 순회 / backface det 부호를 각각 망가뜨린 복제본이
//     해당 테스트를 실제로 FAIL 시키는지 확인 — 검사가 살아 있다는 증명.

import {
  buildTriangleIndex,
} from "../src/features/v2/support/triangle-index.ts";
import { makeTriangleBeamProbe } from "../src/features/v2/support/collision-probe.ts";
import {
  clusterForSharedPillars,
  DEFAULT_MAX_MEMBERS_PER_PILLAR,
} from "../src/features/v2/support/detect/preprocess-points.ts";
import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
  }
}

/** 결정적 의사난수 (시드 고정) — 무작위 금지 규약. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ─────────────────────────────────────────────────────────────────────────────
// 기하 생성기 — 전부 감김 정규화(바깥 법선 = (v1−v0)×(v2−v0))를 지킨 닫힌 솔리드.
// ─────────────────────────────────────────────────────────────────────────────

/** 축 정렬 박스의 12 삼각형 (바깥 법선 감김). */
function boxTriangles(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], // 아래 0..3
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], // 위   4..7
  ];
  // 각 면을 바깥에서 봤을 때 반시계(CCW)가 되도록 정점 순서를 잡는다.
  const faces = [
    [0, 3, 2], [0, 2, 1], // −Y (바닥, 아래에서 보면 CCW)
    [4, 5, 6], [4, 6, 7], // +Y (천장)
    [0, 1, 5], [0, 5, 4], // −Z
    [2, 3, 7], [2, 7, 6], // +Z
    [3, 0, 4], [3, 4, 7], // −X
    [1, 2, 6], [1, 6, 5], // +X
  ];
  const out = new Float32Array(faces.length * 9);
  let o = 0;
  for (const f of faces) {
    for (const idx of f) {
      out[o++] = v[idx][0];
      out[o++] = v[idx][1];
      out[o++] = v[idx][2];
    }
  }
  return out;
}

/** UV 구면 삼각형 — 성능 스모크용 대량 메시. seg 세분에 비례해 삼각형이 는다. */
function sphereTriangles(cx, cy, cz, r, segU, segV) {
  const tris = [];
  const P = (iu, iv) => {
    const phi = (2 * Math.PI * iu) / segU;
    const theta = (Math.PI * iv) / segV;
    return [
      cx + r * Math.sin(theta) * Math.cos(phi),
      cy + r * Math.cos(theta),
      cz + r * Math.sin(theta) * Math.sin(phi),
    ];
  };
  for (let iv = 0; iv < segV; iv++) {
    for (let iu = 0; iu < segU; iu++) {
      const a = P(iu, iv);
      const b = P(iu + 1, iv);
      const c = P(iu + 1, iv + 1);
      const d = P(iu, iv + 1);
      tris.push(a, d, c);
      tris.push(a, c, b);
    }
  }
  const out = new Float32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    out[i * 3] = tris[i][0];
    out[i * 3 + 1] = tris[i][1];
    out[i * 3 + 2] = tris[i][2];
  }
  return out;
}

/** 여러 삼각형 배열 잇기. */
function concatTris(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/**
 * 경사면 쐐기 — XZ 의 X 축을 따라 각도 angleDeg 로 기울어진 윗면을 가진 닫힌 솔리드.
 *   윗면이 (x, baseY + x·tan(angle)) 를 지난다. (b) 의 "경사면에 파묻힌 기둥" 기하.
 */
function rampTriangles(angleDeg, baseY, x0, x1, z0, z1) {
  const t = Math.tan((angleDeg * Math.PI) / 180);
  const topY = (x) => baseY + (x - x0) * t;
  // 여덟 정점 (아래는 평면 Y=0, 위는 경사면).
  const v = [
    [x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1],
    [x0, topY(x0), z0], [x1, topY(x1), z0], [x1, topY(x1), z1], [x0, topY(x0), z1],
  ];
  const faces = [
    [0, 3, 2], [0, 2, 1],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
    [1, 2, 6], [1, 6, 5],
  ];
  const out = new Float32Array(faces.length * 9);
  let o = 0;
  for (const f of faces) {
    for (const idx of f) {
      out[o++] = v[idx][0];
      out[o++] = v[idx][1];
      out[o++] = v[idx][2];
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 참조 구현 — 가속 구조 없는 브루트포스 (a) 대조용.
// ─────────────────────────────────────────────────────────────────────────────

/** Möller–Trumbore 양면 교차 (참조 — 인덱스 코드를 보지 않고 독립 재현). */
function refIntersect(tris, off, o, d) {
  const ax = tris[off], ay = tris[off + 1], az = tris[off + 2];
  const e1 = [tris[off + 3] - ax, tris[off + 4] - ay, tris[off + 5] - az];
  const e2 = [tris[off + 6] - ax, tris[off + 7] - ay, tris[off + 8] - az];
  const p = [
    d[1] * e2[2] - d[2] * e2[1],
    d[2] * e2[0] - d[0] * e2[2],
    d[0] * e2[1] - d[1] * e2[0],
  ];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tv = [o[0] - ax, o[1] - ay, o[2] - az];
  const u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) * inv;
  if (u < 0 || u > 1) return null;
  const q = [
    tv[1] * e1[2] - tv[2] * e1[1],
    tv[2] * e1[0] - tv[0] * e1[2],
    tv[0] * e1[1] - tv[1] * e1[0],
  ];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  // 법선 n = e1 × e2 (바깥). d·n > 0 이면 뒷면.
  const n = [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
  const backface = d[0] * n[0] + d[1] * n[1] + d[2] * n[2] > 0;
  return { t, backface };
}

/** 전 삼각형 브루트포스 — 가장 가까운 히트. */
function bruteRaycast(tris, o, d, maxDist) {
  let best = null;
  for (let off = 0; off + 9 <= tris.length; off += 9) {
    const h = refIntersect(tris, off, o, d);
    if (h === null) continue;
    if (h.t < 0 || h.t > maxDist) continue;
    if (best === null || h.t < best.t) best = h;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// 변조본 (§f) — 핵심 기법을 하나씩 망가뜨린 복제 인덱스.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 변조 A — DDA 셀 순회 제거: **첫 셀만** 검사한다.
 *   진짜 구현은 광선을 따라 셀을 차례로 지나며 히트를 찾는다. 첫 셀만 보면
 *   멀리 있는 삼각형을 통째로 놓친다.
 */
function tamperedFirstCellOnly(tris, divisions = 16) {
  // 최소한의 격자를 직접 만든다(인덱스 코드 재사용 금지 — 같은 버그를 두 번 쓰지 않게).
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let off = 0; off + 9 <= tris.length; off += 9) {
    for (let k = 0; k < 3; k++) {
      for (let ax = 0; ax < 3; ax++) {
        const val = tris[off + k * 3 + ax];
        if (val < lo[ax]) lo[ax] = val;
        if (val > hi[ax]) hi[ax] = val;
      }
    }
  }
  const cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / divisions;
  const key = (p) =>
    [0, 1, 2]
      .map((ax) => Math.max(0, Math.min(divisions - 1, Math.floor((p[ax] - lo[ax]) / cell))))
      .join(",");
  const buckets = new Map();
  for (let off = 0, tri = 0; off + 9 <= tris.length; off += 9, tri++) {
    for (let k = 0; k < 3; k++) {
      const kk = key([tris[off + k * 3], tris[off + k * 3 + 1], tris[off + k * 3 + 2]]);
      if (!buckets.has(kk)) buckets.set(kk, []);
      if (!buckets.get(kk).includes(tri)) buckets.get(kk).push(tri);
    }
  }
  return {
    raycast(o, d, maxDist) {
      // ★ 시작점이 속한 셀만 본다 (변조 — DDA 순회 없음).
      const list = buckets.get(key(o)) ?? [];
      let best = null;
      for (const tri of list) {
        const h = refIntersect(tris, tri * 9, o, d);
        if (h === null || h.t < 0 || h.t > maxDist) continue;
        if (best === null || h.t < best.t) best = h;
      }
      return best === null ? null : { distance: best.t, backface: best.backface };
    },
  };
}

/**
 * 변조 B — backface 판정 제거: 항상 앞면이라고 답한다.
 *   진짜 구현은 det(=−d·n) 부호로 뒷면을 가려낸다. 이걸 없애면 "모델 내부에서
 *   출발한 광선"을 정상 히트로 착각해 파묻힘 검사(§b)가 무력해진다.
 */
function tamperedNoBackfaceSign(tris) {
  return {
    raycast(o, d, maxDist) {
      const h = bruteRaycast(tris, o, d, maxDist);
      // ★ backface 를 항상 false 로 (변조).
      return h === null ? null : { distance: h.t, backface: false };
    },
  };
}

/** 변조 인덱스를 castOne 규약대로 감싼 최소 프로브 (중심 광선 1가닥). */
function probeFromIndex(index, insideTol) {
  const REEMIT = 0.01;
  return {
    hitDistance(from, dir, radiusMm, maxDist) {
      const d = norm(dir);
      let traveled = 0;
      let o = [...from];
      for (let attempt = 0; attempt <= 4; attempt++) {
        const remain = maxDist - traveled;
        if (remain <= 0) return null;
        const hit = index.raycast(o, d, remain);
        if (hit === null) return null;
        if (!hit.backface) return traveled + hit.distance;
        if (traveled + hit.distance > insideTol) return 0;
        traveled += hit.distance + REEMIT;
        o = [from[0] + d[0] * traveled, from[1] + d[1] * traveled, from[2] + d[2] * traveled];
      }
      return 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

const R = 0.5; // strutRadiusMm (trunkDiameterMm 1.0).
const OLD_TOLERANCE = 1.0; // 2c 의 INSIDE_TOLERANCE_MM (대조군).
const NEW_TOLERANCE = 0.4; // 2c-f 기본값.

function main() {
  console.log("=== S-4b-2c-f 충돌 프로브 검증 ===");

  // ── (a) 정확성 대조 — 브루트포스 참조와 전수 일치 ────────────────────────
  console.log("\n(a) 인덱스 raycast vs 브루트포스 참조 — 광선 500발 전수 대조:");
  {
    // 고정 시드 삼각형 무리: 흩뿌린 박스 + 구 (수십 개 이상).
    const rnd = makeRng(20260821);
    const parts = [];
    for (let i = 0; i < 12; i++) {
      const cx = (rnd() - 0.5) * 30;
      const cy = rnd() * 20;
      const cz = (rnd() - 0.5) * 30;
      const s = 1 + rnd() * 3;
      parts.push(boxTriangles([cx - s, cy - s, cz - s], [cx + s, cy + s, cz + s]));
    }
    parts.push(sphereTriangles(0, 10, 0, 6, 12, 8));
    const tris = concatTris(...parts);
    const triCount = tris.length / 9;
    const index = buildTriangleIndex(tris);
    assert(
      index.triangleCount === triCount,
      `삼각형 ${triCount}개 색인됨 (triangleCount=${index.triangleCount})`,
    );

    const TOL = 1e-9;
    let distMismatch = 0;
    let faceMismatch = 0;
    let hitCount = 0;
    const rays = 500;
    const rr = makeRng(777);
    for (let i = 0; i < rays; i++) {
      const o = [(rr() - 0.5) * 60, rr() * 30 - 5, (rr() - 0.5) * 60];
      const d = norm([rr() * 2 - 1, rr() * 2 - 1, rr() * 2 - 1]);
      const maxDist = 10 + rr() * 90;
      const got = index.raycast(o, d, maxDist);
      const want = bruteRaycast(tris, o, d, maxDist);
      if ((got === null) !== (want === null)) {
        distMismatch++;
        continue;
      }
      if (got !== null && want !== null) {
        hitCount++;
        if (Math.abs(got.distance - want.t) > TOL) distMismatch++;
        if (got.backface !== want.backface) faceMismatch++;
      }
    }
    console.log(`      광선 ${rays}발 중 히트 ${hitCount}발`);
    // 시작점을 넓은 공간에 흩뿌리므로 상당수는 빗나간다. 히트가 수십 발 이상이면
    //   "전부 빗나가서 무의미한 대조"가 아님을 보이기에 충분하다.
    assert(hitCount >= 50, `히트가 충분히 발생 (${hitCount}/${rays}) — 전부 빗나가면 무의미`);
    assert(distMismatch === 0, `거리 불일치 ${distMismatch}건 (허용오차 ${TOL})`);
    assert(faceMismatch === 0, `backface 판정 불일치 ${faceMismatch}건`);

    // 축 정렬 광선(격자 경계와 나란함 — DDA 가 가장 틀리기 쉬운 케이스)도 따로.
    let axisMismatch = 0;
    const axisDirs = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    const ra = makeRng(31337);
    for (let i = 0; i < 120; i++) {
      const o = [(ra() - 0.5) * 40, ra() * 25, (ra() - 0.5) * 40];
      const d = axisDirs[i % axisDirs.length];
      const got = index.raycast(o, d, 100);
      const want = bruteRaycast(tris, o, d, 100);
      if ((got === null) !== (want === null)) axisMismatch++;
      else if (got && want && (Math.abs(got.distance - want.t) > TOL || got.backface !== want.backface)) {
        axisMismatch++;
      }
    }
    assert(axisMismatch === 0, `축 정렬 광선 120발도 전부 일치 (불일치 ${axisMismatch})`);
  }

  // ── (b) ★ T-1 회귀 — 파묻힘 허용치 축소 (구 동작 대조군) ─────────────────
  console.log("\n(b) ★ T-1 — 경사면에 0.6mm 파묻힌 기둥: 구 허용치는 통과, 신 허용치는 막힘:");
  {
    for (const angle of [45, 60]) {
      // 경사면 솔리드. 윗면은 x=−20 에서 Y=5, 기울기 angle 로 +X 방향 상승.
      //   ★ 빔 방향은 **경사면 바깥 법선의 반대**(면을 향해 파고드는 방향)로 잡는다.
      //     기둥은 접점에서 면에 수직으로 다가가 붙으므로 그게 실제 기하다.
      //     (연직 하향으로 쏘면 쐐기 몸통을 세로로 관통해 exit 가 수 mm 가 되므로
      //      "얕은 겹침" 시험이 성립하지 않는다 — 그 경우는 어차피 항상 막힌다.)
      const tris = normalizeTriangleWinding(rampTriangles(angle, 5, -20, 20, -20, 20));
      const rad = (angle * Math.PI) / 180;
      const t = Math.tan(rad);
      const surfY = (x) => 5 + (x - -20) * t;
      // 윗면 바깥 법선 = (−sin, cos, 0) 정규화. 빔은 그 반대 방향(면 속으로).
      const nOut = [-Math.sin(rad), Math.cos(rad), 0];
      const dirIn = [-nOut[0], -nOut[1], -nOut[2]];

      /** 표면에서 법선 반대로 depth mm 들어간 점 = 그만큼 파묻힌 기둥 시작점. */
      const buried = (depth) => [
        0 + dirIn[0] * depth,
        surfY(0) + dirIn[1] * depth,
        0,
      ];

      // 링 광선·안전거리를 끄고 중심 광선만 본다 — 경사면에서 링을 벌리면
      //   광선마다 침투 깊이가 달라져 허용치 경계 시험의 의미가 흐려진다.
      const pOpts = { safetyDistMm: 0, ringRayCount: 0 };
      const probeOld = makeTriangleBeamProbe(tris, { ...pOpts, insideToleranceMm: OLD_TOLERANCE });
      const probeNew = makeTriangleBeamProbe(tris, { ...pOpts, insideToleranceMm: NEW_TOLERANCE });

      // 0.6mm 파묻힘 — 구 허용치(1.0) 안, 신 허용치(0.4) 밖.
      //   빔이 면 속으로 향하므로 뒤로 나가는 exit 는 반대편 면. 시작점부터의
      //   내부 구간이 0.6mm 인 쪽을 보려면 **면 바깥으로** 쏴야 하므로 dirOut 사용.
      const dirOut = nOut;
      const start = buried(0.6);
      const oldHit = probeOld.hitDistance(start, dirOut, R, 20);
      const newHit = probeNew.hitDistance(start, dirOut, R, 20);
      console.log(
        `      ${angle}° · 0.6mm 파묻힘 → 구(${OLD_TOLERANCE}mm): ${fmt(oldHit)} / ` +
          `신(${NEW_TOLERANCE}mm): ${fmt(newHit)}`,
      );
      assert(
        newHit === 0,
        `${angle}°: 0.6mm 파묻힘을 신 허용치가 **막는다**(거리 0 = 즉시 막힘)`,
      );
      assert(
        oldHit === null,
        `★ ${angle}° 대조군: 구 허용치는 같은 0.6mm 파묻힘을 청명으로 통과시킨다 (${fmt(oldHit)})`,
      );

      // 0.3mm 얕은 겹침(화살촉급) — 신 허용치에서도 재발사로 통과해야 한다.
      const shallowNew = probeNew.hitDistance(buried(0.3), dirOut, R, 20);
      assert(
        shallowNew === null,
        `${angle}°: 0.3mm 얕은 겹침(화살촉급)은 신 허용치에서도 재발사로 통과 (${fmt(shallowNew)})`,
      );
    }

    // ★ 대조군 본체 — 구 허용치가 실제로 **잘못 통과시켰음**을 벽면에서 보인다.
    //   수직 벽에 파묻힌 기둥: 빔이 벽 안에서 시작해 0.6mm 만에 벽 밖으로 나간다.
    {
      // Y 5~30, X 0~10 벽. 빔은 X=−0.6 이 아니라 X=+0.6(벽 안 0.6mm)에서 −X 로 쏜다.
      const wall = normalizeTriangleWinding(boxTriangles([0, 5, -20], [10, 30, 20]));
      const start = [0.6, 15, 0];
      const dir = [-1, 0, 0];
      const probeOld = makeTriangleBeamProbe(wall, {
        insideToleranceMm: OLD_TOLERANCE,
        safetyDistMm: 0,
        ringRayCount: 0,
      });
      const probeNew = makeTriangleBeamProbe(wall, {
        insideToleranceMm: NEW_TOLERANCE,
        safetyDistMm: 0,
        ringRayCount: 0,
      });
      const oldHit = probeOld.hitDistance(start, dir, R, 20);
      const newHit = probeNew.hitDistance(start, dir, R, 20);
      console.log(
        `      벽면 0.6mm 파묻힘 → 구: ${fmt(oldHit)} / 신: ${fmt(newHit)}`,
      );
      assert(
        oldHit === null,
        `★ 대조군: 구 허용치(${OLD_TOLERANCE}mm)는 0.6mm 파묻힌 시작점을 **청명으로 통과시킨다** ` +
          `(${fmt(oldHit)}) — T-1 이 실재했다는 증명`,
      );
      assert(
        newHit === 0,
        `신 허용치(${NEW_TOLERANCE}mm)는 같은 입력을 막는다 (${fmt(newHit)})`,
      );
      // 0.3mm 는 신 허용치에서도 통과 (경계가 의도대로 0.4 사이에 있다).
      const shallow = probeNew.hitDistance([0.3, 15, 0], dir, R, 20);
      assert(
        shallow === null,
        `0.3mm 얕은 겹침은 신 허용치도 통과 (${fmt(shallow)}) — 화살촉 침투를 막지 않는다`,
      );
    }
  }

  // ── (c) 평행 스침 — 수직벽에 평행한 하향 빔 ──────────────────────────────
  console.log("\n(c) 평행 스침 — 벽 안에서 시작한 벽면 평행 하향 빔:");
  {
    // 닫힌 솔리드 박스(Y 0~20). 빔은 박스 안 Y=10 에서 벽면과 평행하게 −Y 로.
    const solid = normalizeTriangleWinding(boxTriangles([-5, 0, -5], [5, 20, 5]));
    const probe = makeTriangleBeamProbe(solid, { safetyDistMm: 0, ringRayCount: 0 });
    // 벽면(X=5)에 아주 가까운 안쪽 — 평행이라 옆벽은 안 맞지만 바닥 캡은 맞는다.
    const start = [4.999, 10, 0];
    const hit = probe.hitDistance(start, [0, -1, 0], R, 10);
    console.log(`      벽 안쪽 0.001mm, 하향 → ${fmt(hit)}`);
    assert(
      hit === 0,
      "닫힌 솔리드 내부에서 시작한 평행 하향 빔은 바닥 캡 뒷면 히트로 막힘 판정 (거리 0)",
    );
    // 벽 **바깥** 평행 하향은 청명이어야 한다 (스침을 과잉 차단하지 않는지).
    const outside = makeTriangleBeamProbe(solid, { safetyDistMm: 0, ringRayCount: 0 })
      .hitDistance([5.001, 10, 0], [0, -1, 0], R, 10);
    assert(
      outside === null,
      `벽 바깥 0.001mm 평행 하향은 청명 (${fmt(outside)}) — 스침을 과잉 차단하지 않는다`,
    );
  }

  // ── (d) 성능 스모크 (T-2 회귀) ───────────────────────────────────────────
  console.log("\n(d) 성능 스모크 — 삼각형 ≥10만 · 광선 ≥30만발:");
  {
    // 구 세분: segU × segV × 2 삼각형. 240×220×2 = 105,600.
    const tris = sphereTriangles(0, 15, 0, 12, 240, 220);
    const triCount = tris.length / 9;
    assert(triCount >= 100000, `합성 메시 삼각형 ${triCount.toLocaleString()}개 (≥100,000)`);

    const tBuild0 = performance.now();
    const index = buildTriangleIndex(tris);
    const buildMs = performance.now() - tBuild0;

    const RAYS = 300000;
    const rnd = makeRng(9999);
    // 광선 방향·시작점을 미리 만들지 않고 루프 안에서 생성(할당 최소화, 실사용과 유사).
    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < RAYS; i++) {
      const o = [(rnd() - 0.5) * 40, rnd() * 40, (rnd() - 0.5) * 40];
      const d = norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]);
      if (index.raycast(o, d, 60) !== null) hits++;
    }
    const castMs = performance.now() - t0;
    const totalMs = buildMs + castMs;
    console.log(
      `      구축 ${buildMs.toFixed(0)}ms + 광선 ${RAYS.toLocaleString()}발 ${castMs.toFixed(0)}ms ` +
        `= 합 ${totalMs.toFixed(0)}ms (히트 ${hits.toLocaleString()}발, ` +
        `${(RAYS / (castMs / 1000) / 1000).toFixed(0)}k 광선/초)`,
    );
    assert(totalMs < 10000, `10초 이내 완료 (${(totalMs / 1000).toFixed(2)}초)`);
    assert(hits > 0, `실제로 히트가 발생 (${hits}발) — 전부 빗나가면 성능 측정이 무의미`);
  }

  // ── (e) T-3 — 기둥당 다리 상한 ───────────────────────────────────────────
  console.log(`\n(e) ★ T-3 — 기둥당 다리 상한(기본 ${DEFAULT_MAX_MEMBERS_PER_PILLAR}):`);
  {
    // 한 자리(반경 2mm 원) 안에 도달 가능한 점 20개. h=10mm 라 Rmax=10mm —
    //   상한이 없으면 전부 한 기둥에 붙는다.
    const pts = [];
    const rnd = makeRng(4242);
    for (let i = 0; i < 20; i++) {
      const a = (2 * Math.PI * i) / 20;
      const r = 1 + rnd() * 1;
      pts.push({ contact: [Math.cos(a) * r, 10, Math.sin(a) * r], tipRadius: 0.2 });
    }

    // 대조군: 상한을 크게 주면 (구 동작) 메가 클러스터 1개.
    const unlimited = clusterForSharedPillars(pts, { maxMembersPerPillar: 1000 });
    console.log(
      `      상한 없음(대조군): 클러스터 ${unlimited.length}개, ` +
        `최대 멤버 ${Math.max(...unlimited.map((c) => c.memberIndices.length))}개`,
    );
    assert(
      unlimited.length === 1 && unlimited[0].memberIndices.length === 19,
      `★ 대조군: 상한 없으면 기둥 1개에 다리 19개 — T-3(기둥 3개에 978다리)의 축소 재현`,
    );

    // 기본 상한 적용 → 분할.
    const capped = clusterForSharedPillars(pts);
    const maxMembers = Math.max(...capped.map((c) => c.memberIndices.length));
    console.log(
      `      기본 상한: 클러스터 ${capped.length}개, 최대 멤버 ${maxMembers}개`,
    );
    assert(capped.length >= 2, `클러스터가 ${capped.length}개(≥2)로 자연 분할됨`);
    assert(
      maxMembers <= DEFAULT_MAX_MEMBERS_PER_PILLAR,
      `어떤 기둥도 다리 ${DEFAULT_MAX_MEMBERS_PER_PILLAR}개를 넘지 않음 (최대 ${maxMembers})`,
    );

    // 전 멤버 정확히 1회 배정 (점 유실·중복 금지).
    const seen = new Set();
    let dup = false;
    for (const c of capped) {
      for (const i of [c.pillarIndex, ...c.memberIndices]) {
        if (seen.has(i)) dup = true;
        seen.add(i);
      }
    }
    assert(!dup && seen.size === pts.length, `전 ${pts.length}점이 정확히 1회씩 배정`);

    // 결정성 — 셔플 3회 동일.
    const fp = (cl) =>
      cl
        .map((c) => `${c.pillarXZ[0].toFixed(6)},${c.pillarXZ[1].toFixed(6)}:${c.memberIndices.length}`)
        .sort()
        .join(" | ");
    const ref = fp(capped);
    let same = 0;
    for (const seed of [3, 11, 555]) {
      // 셔플하면 인덱스가 바뀌므로 좌표 기반 지문으로 비교한다.
      const shuffledPts = [...pts];
      const rr = makeRng(seed);
      for (let i = shuffledPts.length - 1; i > 0; i--) {
        const j = Math.floor(rr() * (i + 1));
        [shuffledPts[i], shuffledPts[j]] = [shuffledPts[j], shuffledPts[i]];
      }
      if (fp(clusterForSharedPillars(shuffledPts)) === ref) same++;
    }
    assert(same === 3, `셔플 3회 모두 동일한 클러스터 구성 (${same}/3)`);

    // 계획서 지정 케이스: 멤버 9개 입력 → 8개 + 1개 분리.
    const nine = [];
    for (let i = 0; i < 10; i++) {
      // 중심 1 + 주변 9. 전부 서로 도달 가능(h=10, 반경 1mm 원).
      nine.push({ contact: [Math.cos((2 * Math.PI * i) / 10), 10, Math.sin((2 * Math.PI * i) / 10)], tipRadius: 0.2 });
    }
    const split = clusterForSharedPillars(nine);
    const sizes = split.map((c) => c.memberIndices.length).sort((a, b) => b - a);
    console.log(`      멤버 9개 입력 → 클러스터 크기 [${sizes.join(", ")}]`);
    assert(
      sizes[0] === DEFAULT_MAX_MEMBERS_PER_PILLAR,
      `첫 기둥이 정확히 상한 ${DEFAULT_MAX_MEMBERS_PER_PILLAR}개를 받음 (${sizes[0]})`,
    );
    assert(split.length === 2, `나머지 1점이 자기 기둥으로 분리 → 클러스터 ${split.length}개 (기대 2)`);
  }

  // ── (f) ★ 변조 시험 — 검사가 실제로 잡는가 ───────────────────────────────
  console.log("\n(f) ★ 변조 시험 — 핵심 기법을 빼면 해당 테스트가 FAIL 하는가:");
  {
    // 변조 A: DDA 셀 순회 제거(첫 셀만) → (a) 의 대조가 깨진다.
    const rnd = makeRng(20260821);
    const parts = [];
    for (let i = 0; i < 12; i++) {
      const cx = (rnd() - 0.5) * 30;
      const cy = rnd() * 20;
      const cz = (rnd() - 0.5) * 30;
      const s = 1 + rnd() * 3;
      parts.push(boxTriangles([cx - s, cy - s, cz - s], [cx + s, cy + s, cz + s]));
    }
    parts.push(sphereTriangles(0, 10, 0, 6, 12, 8));
    const tris = concatTris(...parts);
    const bad = tamperedFirstCellOnly(tris);
    const real = buildTriangleIndex(tris);

    let badMiss = 0;
    let realMiss = 0;
    const rr = makeRng(777);
    const N = 500;
    for (let i = 0; i < N; i++) {
      const o = [(rr() - 0.5) * 60, rr() * 30 - 5, (rr() - 0.5) * 60];
      const d = norm([rr() * 2 - 1, rr() * 2 - 1, rr() * 2 - 1]);
      const maxDist = 10 + rr() * 90;
      const want = bruteRaycast(tris, o, d, maxDist);
      const gotBad = bad.raycast(o, d, maxDist);
      const gotReal = real.raycast(o, d, maxDist);
      if ((gotBad === null) !== (want === null)) badMiss++;
      else if (gotBad && want && Math.abs(gotBad.distance - want.t) > 1e-9) badMiss++;
      if ((gotReal === null) !== (want === null)) realMiss++;
      else if (gotReal && want && Math.abs(gotReal.distance - want.t) > 1e-9) realMiss++;
    }
    console.log(`      변조 A(첫 셀만): 불일치 ${badMiss}/${N} · 실제 구현: ${realMiss}/${N}`);
    assert(
      badMiss > 0,
      `변조 A(DDA 순회 제거) → (a) 의 브루트포스 대조가 실제로 FAIL 한다 (불일치 ${badMiss}건)`,
    );
    assert(realMiss === 0, "실제 구현은 같은 광선에서 불일치 0 — (a) 가 변조만 골라 잡는다");

    // 변조 B: backface det 부호 제거 → (b) 의 파묻힘 차단이 무력해진다.
    const wall = normalizeTriangleWinding(boxTriangles([0, 5, -20], [10, 30, 20]));
    const badProbe = probeFromIndex(tamperedNoBackfaceSign(wall), NEW_TOLERANCE);
    const realProbe = makeTriangleBeamProbe(wall, {
      insideToleranceMm: NEW_TOLERANCE,
      safetyDistMm: 0,
      ringRayCount: 0,
    });
    const start = [0.6, 15, 0];
    const badHit = badProbe.hitDistance(start, [-1, 0, 0], R, 20);
    const realHit = realProbe.hitDistance(start, [-1, 0, 0], R, 20);
    console.log(`      변조 B(backface 제거): ${fmt(badHit)} · 실제 구현: ${fmt(realHit)}`);
    assert(
      badHit !== 0,
      `변조 B(det 부호 제거) → 0.6mm 파묻힘을 막힘으로 판정하지 못한다 (${fmt(badHit)}) = (b) FAIL`,
    );
    assert(realHit === 0, "실제 구현은 같은 입력을 막는다 — (b) 가 변조를 잡는다");
  }

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

/** null(청명) / 0(막힘) / 거리 를 사람이 읽는 형태로. */
function fmt(v) {
  if (v === null) return "청명(null)";
  if (v === 0) return "막힘(0)";
  return `${v.toFixed(4)}mm`;
}

main();
