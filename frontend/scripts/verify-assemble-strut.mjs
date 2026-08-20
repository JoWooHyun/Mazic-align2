// 임의 방향 막대·접합 구 프리미티브 헤드리스 검증 (S-4b-2a).
//   assemble-strut.ts(순수 모듈)를 tsx 로 직접 import 해 Node 에서 조립하고
//   기하량을 assert 한다. Babylon 무의존이라 가능 — 이 성질을 유지하는 것이
//   assemble-core/strut 를 래퍼와 분리해 둔 이유다.
//
//   실행: npx tsx scripts/verify-assemble-strut.mjs
//   통과 로그는 커밋 메시지에 기록.
//
//   ★ 대조군(프로젝트 규약, B-1 확립): "회전 없이 Y 스케일만 늘린 막대"(= 흔한
//     오구현)를 같이 조립해, 경사 목표점에서 **얼마나 어긋나는지**를 수치로 낸다.
//     스크립트가 실제로 오류를 잡는다는 증명.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleBentPath,
  assembleJunctionSphere,
  assembleStrut,
  rotationYToDir,
} from "../src/features/v2/support/assemble-strut.ts";
import { sliceTrianglesAtY } from "../src/features/v2/utils/slice-geometry.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARTS = join(__dirname, "..", "src", "features", "v2", "support", "parts");

/** 바이너리 STL → { positions, indices } (parts-cache 파서와 동일 로직). */
function parseBinaryStl(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  let off = 84;
  let pi = 0;
  for (let t = 0; t < count; t++) {
    off += 12;
    for (let v = 0; v < 3; v++) {
      positions[pi++] = dv.getFloat32(off, true);
      positions[pi++] = dv.getFloat32(off + 4, true);
      positions[pi++] = dv.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2;
  }
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}

function loadPart(name) {
  return parseBinaryStl(readFileSync(join(PARTS, name)));
}

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}
function approx(a, b, tol, msg) {
  assert(
    Math.abs(a - b) <= tol,
    `${msg} (${a.toExponential(3)} ≈ ${b.toExponential(3)}, tol ${tol})`,
  );
}

// ── 벡터 유틸 ────────────────────────────────────────────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** 지오메트리 정점을 [x,y,z] 배열 목록으로. */
function verts(geo) {
  const out = [];
  for (let i = 0; i < geo.positions.length; i += 3) {
    out.push([geo.positions[i], geo.positions[i + 1], geo.positions[i + 2]]);
  }
  return out;
}

/**
 * 막대 축(from→to)에 투영했을 때 **양 끝 단면**의 중심을 구한다.
 *   축 좌표 t = (v−from)·dir 의 최소/최대 근방(±tol) 정점들을 평균 → 각 끝 단면의
 *   기하 중심. 원기둥 캡이 축에 수직인 원판이라 이 평균이 곧 캡 중심이다.
 */
function endCapCenters(geo, from, dir, tol = 1e-4) {
  const vs = verts(geo);
  let tMin = Infinity;
  let tMax = -Infinity;
  for (const v of vs) {
    const t = dot(sub(v, from), dir);
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
  }
  const acc = (target) => {
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const v of vs) {
      if (Math.abs(dot(sub(v, from), dir) - target) > tol) continue;
      cx += v[0]; cy += v[1]; cz += v[2]; n++;
    }
    return n === 0 ? null : [cx / n, cy / n, cz / n];
  };
  return { start: acc(tMin), end: acc(tMax), tMin, tMax };
}

/**
 * 축에 **수직인** 방향의 최대 반경. 각 정점에서 축 성분을 뺀 나머지의 크기.
 *   (경사 막대의 "굵기" 검사는 반드시 이 값으로 봐야 한다 — 월드 XZ 로 재면
 *   기울어진 만큼 타원으로 보여 틀린다.)
 */
function maxRadialDistance(geo, from, dir) {
  let rmax = 0;
  for (const v of verts(geo)) {
    const d = sub(v, from);
    const t = dot(d, dir);
    const perp = [d[0] - t * dir[0], d[1] - t * dir[1], d[2] - t * dir[2]];
    rmax = Math.max(rmax, len(perp));
  }
  return rmax;
}

/** 지오메트리 → sliceTrianglesAtY 가 먹는 삼각형 배열 (평탄 9수/삼각형). */
function toTriangleArray(geo) {
  const tris = new Float32Array(geo.indices.length * 3);
  for (let i = 0; i < geo.indices.length; i++) {
    const k = geo.indices[i] * 3;
    tris[i * 3] = geo.positions[k];
    tris[i * 3 + 1] = geo.positions[k + 1];
    tris[i * 3 + 2] = geo.positions[k + 2];
  }
  return tris;
}

/** Y=y 슬라이스 선분들의 XZ 중심(끝점 평균). 단면 없으면 null. */
function sliceCenterXZ(tris, y) {
  const segs = sliceTrianglesAtY(tris, y);
  if (!segs || segs.length === 0) return null;
  let cx = 0, cz = 0, n = 0;
  // SliceSegment = { a: [x, z], b: [x, z] } (slice-geometry.ts).
  for (const s of segs) {
    cx += s.a[0] + s.b[0];
    cz += s.a[1] + s.b[1];
    n += 2;
  }
  return { center: [cx / n, cz / n], count: segs.length };
}

function main() {
  const parts = {
    sphere: loadPart("sphere.stl"),
    cone: loadPart("cone.stl"),
    cylinder: loadPart("cylinder.stl"),
  };
  console.log("부품 로드:");
  console.log(`  sphere ${parts.sphere.indices.length / 3} tris`);
  console.log(`  cylinder ${parts.cylinder.indices.length / 3} tris`);

  // ── 1. 회전 행렬 자체 성질 ───────────────────────────────────────────────
  //   +Y 를 목표 방향으로 정확히 보내는가 + 직교(형상 안 찌그러짐) + det=+1
  //   (winding 보존 — 음수 스케일 금지 규약과 같은 취지).
  console.log("\n1. rotationYToDir — 회전 행렬 성질:");
  const apply3 = (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ];
  const dirCases = [
    ["수직 +Y", [0, 1, 0]],
    ["수직 −Y (퇴화·반평행)", [0, -1, 0]],
    ["45° 경사", [1, 1, 0]],
    ["45° 경사(대각)", [1, 1, 1]],
    ["수평 +X", [1, 0, 0]],
    ["수평 +Z", [0, 0, 1]],
    ["거의 수직(+Y, h=1e-8)", [1e-8, 1, 0]],
    ["거의 수직(−Y, h=1e-8)", [1e-8, -1, 0]],
    ["아래로 45°", [1, -1, 0]],
  ];
  for (const [label, raw] of dirCases) {
    const d = norm(raw);
    const R = rotationYToDir(d);
    const mapped = apply3(R, [0, 1, 0]);
    assert(
      mapped.every(Number.isFinite),
      `${label}: 행렬이 유한(NaN/Infinity 없음)`,
    );
    approx(len(sub(mapped, d)), 0, 1e-8, `${label}: +Y → 목표 방향`);
    // 직교성: 세 열이 서로 수직·단위 → 형상이 안 찌그러진다.
    const c0 = apply3(R, [1, 0, 0]);
    const c2 = apply3(R, [0, 0, 1]);
    const orth = Math.max(
      Math.abs(dot(c0, mapped)),
      Math.abs(dot(c0, c2)),
      Math.abs(dot(mapped, c2)),
      Math.abs(len(c0) - 1),
      Math.abs(len(c2) - 1),
    );
    approx(orth, 0, 1e-9, `${label}: 정규직교(단면 안 찌그러짐)`);
    // det=+1 (반사 아님 → 삼각형 winding 보존).
    const det = dot(c0, [
      mapped[1] * c2[2] - mapped[2] * c2[1],
      mapped[2] * c2[0] - mapped[0] * c2[2],
      mapped[0] * c2[1] - mapped[1] * c2[0],
    ]);
    approx(det, 1, 1e-9, `${label}: det=+1 (winding 보존)`);
  }

  // −Y 근처를 촘촘히 훑어 NaN·오차 폭주가 없는지 (퇴화 가드의 실질 검사).
  //   상쇄 없는 계수식 (1−dy)/h² 를 안 쓰면 여기서 Infinity/NaN 또는 큰 오차가 난다.
  console.log("\n1b. −Y 근처 스윕 (퇴화 가드·수치 안정성):");
  let worstErr = 0;
  let worstAt = null;
  let nan = 0;
  for (let e = 1e-2; e > 1e-18; e /= 1.3) {
    for (const sx of [1, -1]) {
      for (const kz of [0, 0.3, 1]) {
        const d = norm([e * sx, -Math.sqrt(Math.max(0, 1 - e * e)), e * kz]);
        const mapped = apply3(rotationYToDir(d), [0, 1, 0]);
        if (!mapped.every(Number.isFinite)) { nan++; continue; }
        const err = len(sub(mapped, d));
        if (!(err <= worstErr)) { worstErr = err; worstAt = d; }
      }
    }
  }
  console.log(
    `  스윕 최악 방향오차 = ${worstErr.toExponential(3)} at d=[${worstAt.map((v) => v.toExponential(2))}]`,
  );
  console.log(`  → 10mm 막대 환산 끝점오차 ≈ ${(worstErr * 10).toExponential(3)}mm`);
  assert(nan === 0, `−Y 근처 전 구간 NaN/Infinity 0건 (${nan}건)`);
  assert(
    worstErr * 10 < 1e-4,
    `−Y 근처 최악 끝점오차 < 1e-4mm (${(worstErr * 10).toExponential(3)})`,
  );

  // ── 2. assembleStrut — 양 끝 단면 중심·축 방향·반경 ──────────────────────
  console.log("\n2. assembleStrut — 끝점·축·반경 (경사/수직/거의수직/수평):");
  const R_STRUT = 0.4; // 반경 0.4mm (⌀0.8 = params.trunkDiameterMm 기본값).
  const strutCases = [
    ["45° 경사", [1, 2, -1], [6, 7, -1]],
    ["45° 경사(하강·대각)", [0, 10, 0], [5, 5, 5]],
    ["수직 상승", [2, 0, 3], [2, 12, 3]],
    ["수직 하강(반평행 퇴화)", [2, 12, 3], [2, 0, 3]],
    ["거의 수직(h=1e-8)", [0, 0, 0], [1e-8, 9, 0]],
    ["거의 수직(아래, h=1e-8)", [0, 9, 0], [1e-8, 0, 0]],
    ["수평 X", [0, 5, 0], [8, 5, 0]],
    ["수평 Z", [0, 5, 0], [0, 5, 8]],
    ["수평 대각", [-3, 4, -3], [3, 4, 3]],
    ["30° 완경사", [0, 0, 0], [8.66, 5, 0]],
    ["짧은 막대(0.5mm)", [1, 1, 1], [1.35, 1.35, 1]],
  ];
  for (const [label, from, to] of strutCases) {
    const geo = assembleStrut(parts, from, to, R_STRUT);
    const axis = sub(to, from);
    const dir = norm(axis);
    const L = len(axis);

    assert(geo.indices.length > 0, `${label}: 삼각형 생성됨`);
    assert(
      Array.from(geo.positions).every(Number.isFinite),
      `${label}: 좌표 전부 유한(NaN 없음)`,
    );

    const caps = endCapCenters(geo, from, dir);
    // 양 끝 단면 중심이 정확히 from / to.
    approx(len(sub(caps.start, from)), 0, 1e-4, `${label}: 시작 단면 중심 = from`);
    approx(len(sub(caps.end, to)), 0, 1e-4, `${label}: 끝 단면 중심 = to`);

    // 축 방향 = (to−from) 정규화. 두 캡 중심을 이은 방향으로 역산해 비교.
    const gotDir = norm(sub(caps.end, caps.start));
    approx(len(sub(gotDir, dir)), 0, 1e-4, `${label}: 축 방향 = (to−from) 정규화`);
    // 축 길이도 정확히 |to−from|.
    approx(caps.tMax - caps.tMin, L, 1e-4, `${label}: 축 길이 = |to−from|`);

    // 축에 수직인 최대 반경 = radiusMm (단위 부품이 ⌀1 → 지름 스케일 규약 확인).
    approx(
      maxRadialDistance(geo, from, dir),
      R_STRUT,
      1e-4,
      `${label}: 수직 단면 반경 = ${R_STRUT}mm`,
    );
  }

  // 길이 0 막대 → 빈 지오메트리(축 정의 불가).
  const zeroGeo = assembleStrut(parts, [1, 1, 1], [1, 1, 1], R_STRUT);
  assert(zeroGeo.indices.length === 0, "길이 0 막대 → 빈 지오메트리(퇴화 방어)");

  // 반경이 실제로 반영되는지 (반경 파라미터가 무시되면 여기서 걸린다).
  for (const r of [0.15, 0.4, 1.25]) {
    const g = assembleStrut(parts, [0, 0, 0], [3, 3, 0], r);
    approx(
      maxRadialDistance(g, [0, 0, 0], norm([1, 1, 0])),
      r,
      1e-4,
      `반경 ${r}mm 반영`,
    );
  }

  // ── 3. [대조군] 회전 없이 Y 스케일만 늘린 막대 ───────────────────────────
  //   흔한 오구현: "길이만큼 Y 로 늘리고 from 으로 옮기면 되겠지" → 축이 항상
  //   +Y 라 경사 목표점에 절대 닿지 않는다. 그 어긋남을 수치로 재현한다.
  console.log("\n3. [대조군] 회전 없이 Y 스케일만 — 경사 목표점 이탈:");
  /** 대조군 조립: R(+Y→dir) 를 빼고 스케일·이동만. */
  function assembleStrutNoRotation(from, to, radiusMm) {
    const L = len(sub(to, from));
    const d = radiusMm * 2;
    const accPos = [];
    const accIdx = [];
    const p = parts.cylinder.positions;
    for (let i = 0; i < p.length; i += 3) {
      // Z-up→Y-up (x, z, −y) 후 스케일 (d, L, d), 이동 from. 회전 없음.
      const x = p[i] * d;
      const y = p[i + 2] * L; // 부품 Z → 조립 Y.
      const z = -p[i + 1] * d;
      accPos.push(x + from[0], y + from[1], z + from[2]);
    }
    for (let i = 0; i < parts.cylinder.indices.length; i++) {
      accIdx.push(parts.cylinder.indices[i]);
    }
    return {
      positions: new Float32Array(accPos),
      indices: new Uint32Array(accIdx),
    };
  }
  for (const [label, from, to] of [
    ["45° 경사", [1, 2, -1], [6, 7, -1]],
    ["45° 하강 대각", [0, 10, 0], [5, 5, 5]],
    ["수평 X (90°)", [0, 5, 0], [8, 5, 0]],
    ["30° 완경사", [0, 0, 0], [8.66, 5, 0]],
  ]) {
    const dir = norm(sub(to, from));
    const good = assembleStrut(parts, from, to, R_STRUT);
    const bad = assembleStrutNoRotation(from, to, R_STRUT);
    // 올바른 구현의 끝 단면 중심 = to. 대조군은 +Y 로만 뻗어 다른 곳에 있다.
    const goodEnd = endCapCenters(good, from, dir).end;
    // 대조군의 끝점: 자기 축(+Y) 기준으로 재야 캡이 잡힌다.
    const badEnd = endCapCenters(bad, from, [0, 1, 0]).end;
    const gap = len(sub(badEnd, to));
    const L = len(sub(to, from));
    console.log(
      `  [대조군] ${label}: 목표 to=[${to}] → 실제 끝=[${badEnd.map((v) => v.toFixed(3))}], 이탈 ${gap.toFixed(4)}mm (막대 길이 ${L.toFixed(3)}mm)`,
    );
    // 올바른 구현은 목표에 닿는다.
    approx(len(sub(goodEnd, to)), 0, 1e-4, `${label}: 정상 구현은 to 에 정확히 도달`);
    // 대조군은 레이어 두께(50µm)보다 훨씬 크게 어긋난다 = 스크립트가 잡는다.
    assert(
      gap > 0.05,
      `[대조군] ${label}: 이탈 ${gap.toFixed(4)}mm > 0.05mm(레이어 두께) — 오류 검출됨`,
    );
    // 기하학적 기대치와 일치하는지까지 확인: 대조군 끝점은 from+(0,L,0).
    approx(
      gap,
      len(sub([from[0], from[1] + L, from[2]], to)),
      1e-3,
      `[대조군] ${label}: 이탈량 = |from+(0,L,0) − to| (예측과 일치)`,
    );
  }

  // ── 4. assembleJunctionSphere — 중심·반경 ────────────────────────────────
  console.log("\n4. assembleJunctionSphere — 중심·반경:");
  for (const [center, r] of [
    [[0, 0, 0], 0.4],
    [[2.5, 7.25, -3.5], 0.6],
    [[-1, 12, 4], 0.15],
  ]) {
    const g = assembleJunctionSphere(parts, center, r);
    assert(g.indices.length > 0, `구 center=[${center}] r=${r}: 삼각형 생성됨`);
    // 중심 = 정점 bbox 중심, 반경 = 중심에서의 거리(구면이라 전부 r).
    const vs = verts(g);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) {
      for (let a = 0; a < 3; a++) {
        if (v[a] < min[a]) min[a] = v[a];
        if (v[a] > max[a]) max[a] = v[a];
      }
    }
    const c = [0, 1, 2].map((a) => (min[a] + max[a]) / 2);
    approx(len(sub(c, center)), 0, 1e-4, `구 r=${r}: 중심 = center`);
    // 최대 반경 = r (단위 구 ⌀1 → 지름 스케일).
    let rmax = 0;
    for (const v of vs) rmax = Math.max(rmax, len(sub(v, center)));
    approx(rmax, r, 1e-3, `구 r=${r}: 최대 반경 = r`);
  }
  assert(
    assembleJunctionSphere(parts, [0, 0, 0], 0).indices.length === 0,
    "반경 0 구 → 빈 지오메트리(퇴화 방어)",
  );

  // ── 5. 꺾임 접합부를 구가 틈 없이 덮는가 ─────────────────────────────────
  //   두 막대(반경 r)가 각도 θ 로 만나는 접합점에 반경 R 구를 두면, R ≥ r 일 때
  //   접합점 주변 반경 r 이내가 전부 솔리드다. "막대 표면의 임의 점에서 접합점
  //   까지 거리 ≤ R 인 구간이 구 안에 들어간다" 를 수치로 확인한다.
  console.log("\n5. 꺾임 접합 — 구가 틈 없이 덮는가 (R ≥ r 이면 각도 무관):");
  const R_SPH = R_STRUT; // R = r (assembleBentPath 규약).
  //   ⚠️ 허용치: 부품 STL 이 **float32** 라 구 표면 반경에 ~1e-7mm 급 양자화
  //   오차가 있다. 여기서 보려는 것은 "각도 때문에 생기는 틈"(있다면 최소
  //   수십 µm 규모)이지 float32 반올림이 아니므로, 그 사이인 1e-5mm 로 둔다.
  const COVER_TOL_MM = 1e-5;
  for (const [label, a, j, b] of [
    // 라벨 = 두 막대 축이 이루는 사이각(θ). 작을수록 급격히 접힌 꺾임이다.
    ["135° (완만한 꺾임)", [0, 10, 0], [0, 5, 0], [5, 0, 0]],
    ["90° (직각 꺾임)", [0, 5, 0], [5, 5, 0], [5, 10, 0]],
    ["~0° (되접힘·최악)", [0, 10, 0], [0, 5, 0], [0.1, 10, 0.1]],
    ["3D 꺾임", [-4, 9, -2], [0, 5, 0], [3, 1, 4]],
  ]) {
    const sphere = assembleJunctionSphere(parts, j, R_SPH);
    // 두 막대의 축 방향(접합점에서 바깥으로).
    const d1 = norm(sub(a, j));
    const d2 = norm(sub(b, j));
    const cosT = dot(d1, d2);
    const theta = (Math.acos(Math.max(-1, Math.min(1, cosT))) * 180) / Math.PI;
    // 구 표면의 실제 최소 반경(다면체 근사라 이론 R 보다 약간 작다).
    let rminSphere = Infinity;
    for (const v of verts(sphere)) {
      rminSphere = Math.min(rminSphere, len(sub(v, j)));
    }
    // 접합점에서 거리 r 이내의 막대 표면 점들이 전부 구 내부(≤ 구 최소반경)인지.
    //   각 막대에서 접합점 근처 표면을 샘플링해 검사한다.
    let covered = true;
    let worstOutside = 0;
    for (const dAxis of [d1, d2]) {
      // 축에 수직인 정규 기저 2개.
      const tmp = Math.abs(dAxis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const u = norm([
        dAxis[1] * tmp[2] - dAxis[2] * tmp[1],
        dAxis[2] * tmp[0] - dAxis[0] * tmp[2],
        dAxis[0] * tmp[1] - dAxis[1] * tmp[0],
      ]);
      const w = [
        dAxis[1] * u[2] - dAxis[2] * u[1],
        dAxis[2] * u[0] - dAxis[0] * u[2],
        dAxis[0] * u[1] - dAxis[1] * u[0],
      ];
      // 막대 표면: 접합점에서 축으로 t, 반경 r 원주 위 점. t 는 구가 덮어야 할
      //   구간(0 ~ √(R²−r²)) 을 훑는다.
      const tMaxCover = Math.sqrt(Math.max(0, R_SPH * R_SPH - R_STRUT * R_STRUT));
      for (let ti = 0; ti <= 8; ti++) {
        const t = (tMaxCover * ti) / 8;
        for (let pi = 0; pi < 16; pi++) {
          const ph = (pi * 2 * Math.PI) / 16;
          const p = [0, 1, 2].map(
            (k) =>
              j[k] + dAxis[k] * t + R_STRUT * (Math.cos(ph) * u[k] + Math.sin(ph) * w[k]),
          );
          const dist = len(sub(p, j));
          if (dist > rminSphere + COVER_TOL_MM) {
            covered = false;
          }
          worstOutside = Math.max(worstOutside, dist - rminSphere);
        }
      }
    }
    console.log(
      `  ${label} (θ=${theta.toFixed(1)}°): 구 최소반경 ${rminSphere.toFixed(5)}mm, 막대반경 ${R_STRUT}mm, 이탈 ${worstOutside.toExponential(2)}mm`,
    );
    assert(
      covered,
      `${label}: 접합점 반경 ${R_STRUT}mm 구간을 구가 전부 덮음(틈 없음, 이탈 ${worstOutside.toExponential(2)}mm ≤ ${COVER_TOL_MM})`,
    );
  }
  // R ≥ r 조건 자체를 명시적으로 확인 (assembleBentPath 는 R = r).
  assert(R_SPH >= R_STRUT, `구 반경 R(${R_SPH}) ≥ 막대 반경 r(${R_STRUT}) — 파단 방지 조건`);

  // ── 6. assembleBentPath — 막대 + 꺾임 구 일괄 조립 ───────────────────────
  console.log("\n6. assembleBentPath — 경로 조립:");
  const path = [
    [0, 12, 0],   // 접점 아래.
    [0, 8, 0],    // 꺾임 1 (수직 → 경사).
    [4, 4, 0],    // 꺾임 2 (경사 → 수직) — 45°.
    [4, 0, 0],    // 플레이트.
  ];
  const bent = assembleBentPath(parts, path, R_STRUT);
  const cylTris = parts.cylinder.indices.length / 3;
  const sphTris = parts.sphere.indices.length / 3;
  assert(
    bent.indices.length / 3 === cylTris * 3 + sphTris * 2,
    `삼각형 수 = 막대 3개 + 중간 꺾임 구 2개 (${bent.indices.length / 3})`,
  );
  assert(
    Array.from(bent.positions).every(Number.isFinite),
    "경로 좌표 전부 유한",
  );
  // 경로 전 구간이 각 구간 막대와 동일한 위치에 있는지: bbox 로 대략 확인.
  {
    const vs = verts(bent);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) {
      for (let a = 0; a < 3; a++) {
        if (v[a] < min[a]) min[a] = v[a];
        if (v[a] > max[a]) max[a] = v[a];
      }
    }
    console.log(`  경로 bbox min=[${min.map((v) => v.toFixed(3))}] max=[${max.map((v) => v.toFixed(3))}]`);
    // 경로 Y 범위 = 정확히 0 ~ 12.
    //   양 끝 구간이 **수직** 막대라 끝 캡이 축에 수직인 수평 원판이다 → Y 로는
    //   반경만큼 더 튀어나오지 않는다(경사 끝이었다면 달라진다). 중간 꺾임 구는
    //   경로 안쪽(y=8, y=4)이라 Y 범위를 넓히지 않는다.
    approx(min[1], 0, 1e-3, "경로 최저 Y = 플레이트(0)");
    approx(max[1], 12, 1e-3, "경로 최고 Y = 시작점(12)");
    // XZ 폭은 경로가 x=0→4 로 가므로 ±반경만큼 번진다.
    approx(min[0], 0 - R_STRUT, 1e-2, "경로 최소 X = 0 − 반경");
    approx(max[0], 4 + R_STRUT, 1e-2, "경로 최대 X = 4 + 반경");
  }
  // 꺾임점에 구가 실제로 존재하는가 — **기하로** 확인 (삼각형 수만 세면 구를
  //   빼먹거나 다른 부품으로 바꿔도 놓칠 수 있다). 꺾임점에서 두 막대 축 **양쪽
  //   모두에 수직인** 방향은 막대 표면으로는 반경 r 까지 못 미치는 자리가 생기는데,
  //   구가 있으면 그 방향으로도 거리 r 지점이 솔리드 안이다. 여기서는 "꺾임점
  //   주위 반경 r 구면 위 정점이 존재하는가" 로 본다.
  //   판정 기준은 **꺾임점에서 거리 r 인 정점 수**다. 실측(이 경로·24분할 부품):
  //     · 막대만 있고 구가 없으면  240개 — 만나는 두 막대의 끝 캡 원주뿐이다.
  //     · Junction 구가 있으면    1968개 — 구가 전 방향에 정점을 두기 때문.
  //   그래서 임계를 그 사이(1000)에 둔다. 캡 원주만으로는 절대 넘을 수 없는 수라
  //   구를 빠뜨리면 반드시 걸린다. (막대 축 방향으로 프로브를 쏘는 방식은 이
  //   경로가 한 평면 위에 있어 캡 원주와 구별되지 않아 쓰지 않는다.)
  for (const j of [path[1], path[2]]) {
    let atR = 0;
    for (const v of verts(bent)) {
      if (Math.abs(len(sub(v, j)) - R_STRUT) < 1e-3) atR++;
    }
    assert(
      atR > 1000,
      `꺾임점 [${j}] 에 Junction 구 존재 (반경 ${R_STRUT}mm 정점 ${atR}개 > 1000; 막대 캡만이면 240개)`,
    );
  }

  // 2개 미만 waypoint → 빈 지오메트리.
  assert(
    assembleBentPath(parts, [[0, 0, 0]], R_STRUT).indices.length === 0,
    "waypoint 1개 → 빈 지오메트리",
  );
  assert(
    assembleBentPath(parts, [], R_STRUT).indices.length === 0,
    "waypoint 0개 → 빈 지오메트리",
  );

  // ── 7. 슬라이스 코어 통합 — 각 층 단면 존재 + 중심이 축을 따라 이동 ───────
  //   S-4b-1 에서 확립된 검증 방식(verify-assemble-core 의 sectionCenterXZAtY)을
  //   실제 슬라이서 코어(sliceTrianglesAtY)로 끌어올린 것. 경사 막대가 층마다
  //   끊기지 않고(단면 존재), 단면 중심이 축 기울기대로 옆으로 이동해야 한다.
  console.log("\n7. sliceTrianglesAtY 통합 — 45° 경사 막대 층별 단면:");
  const sFrom = [0, 0, 0];
  const sTo = [6, 6, 0]; // 45°.
  const sGeo = assembleStrut(parts, sFrom, sTo, R_STRUT);
  const sTris = toTriangleArray(sGeo);
  const LAYER = 0.05; // 50µm.
  let missing = 0;
  const samples = [];
  // 양 끝 캡 근방은 제외하고 몸통 구간만 본다. **정수 인덱스로 층을 세어**
  //   부동소수 누적(y += LAYER)이 마지막 층을 캡 밖으로 밀어내는 일을 막는다.
  const Y0 = 0.5;
  const layers = 101; // 0.5 ~ 5.5mm, 50µm 간격.
  for (let i = 0; i < layers; i++) {
    const y = Y0 + i * LAYER;
    const sc = sliceCenterXZ(sTris, y);
    if (!sc) { missing++; continue; }
    samples.push([y, sc.center[0], sc.center[1]]); // center = [x, z] (2원소).
  }
  console.log(`  층 ${layers}개 검사, 단면 없는 층 ${missing}개`);
  assert(missing === 0, `모든 층에 단면 존재 (누락 ${missing}/${layers})`);
  assert(samples.length === layers, `단면 샘플 ${samples.length}/${layers}개 확보`);
  // 45° 라 X 중심이 Y 와 1:1 로 따라가야 한다(축 = [1,1,0]/√2, from 원점).
  let worstAxis = 0;
  let worstZ = 0;
  for (const [y, cx, cz] of samples) {
    worstAxis = Math.max(worstAxis, Math.abs(cx - y));
    worstZ = Math.max(worstZ, Math.abs(cz));
  }
  console.log(`  단면 중심 X 이탈 최대 = ${worstAxis.toExponential(3)}mm, |Z| 최대 = ${worstZ.toExponential(3)}mm`);
  assert(
    worstAxis < 5e-3,
    `단면 중심이 축을 따라 이동 (45° → cx = y, 최대 이탈 ${worstAxis.toExponential(3)}mm)`,
  );
  // Z 는 0 이어야 하나 원주 24분할 근사라 미세 상수 오프셋이 남는다(축이 XY
  //   평면 안이라 기하학적 이탈이 아니라 이산화 잔차). 그 한도만 확인한다.
  assert(
    worstZ < 5e-3,
    `단면 중심 Z ≈ 0 (원주 24분할 이산화 잔차 ${worstZ.toExponential(3)}mm)`,
  );
  // 처음과 끝 단면 중심이 실제로 옮겨갔는지(수직 막대와 구별되는 성질).
  const first = samples[0];
  const last = samples[samples.length - 1];
  console.log(
    `  첫 층 y=${first[0].toFixed(2)} → 중심 X=${first[1].toFixed(4)} / 끝 층 y=${last[0].toFixed(2)} → 중심 X=${last[1].toFixed(4)}`,
  );
  approx(last[1] - first[1], last[0] - first[0], 1e-2, "45°: 중심 X 이동량 = Y 이동량");

  // 꺾임 경로도 층마다 단면이 존재하는지 (Junction 구 포함 — 파단 방지 확인).
  console.log("\n7b. 꺾임 경로 층별 단면 (Junction 구 효과):");
  const bTris = toTriangleArray(bent);
  let bMissing = 0;
  const bLayers = 233; // 0.2 ~ 11.8mm, 50µm 간격 (정수 인덱스 — 위와 같은 이유).
  for (let i = 0; i < bLayers; i++) {
    if (!sliceCenterXZ(bTris, 0.2 + i * LAYER)) bMissing++;
  }
  console.log(`  층 ${bLayers}개 검사, 단면 없는 층 ${bMissing}개`);
  assert(bMissing === 0, `꺾임 경로 전 층에 단면 존재 (누락 ${bMissing}/${bLayers})`);

  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
