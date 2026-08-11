// 슬라이스 래스터화 nonzero 감김 규칙 헤드리스 검증 (B-7).
//   합성 삼각형(바깥 법선 감김 준수)과 실물 조립 서포트를
//   sliceTrianglesAtY → chainSegments → rasterizePolygons 로 통과시켜
//   "겹친 솔리드 = 채움 / 진짜 구멍 = 비움" 이 성립하는지 assert 한다.
//
//   예전 even-odd 규칙은 겹침을 XOR 로 지워 마스크에 검은 구멍(미경화)을
//   만들었다 — (a)(b)(f) 가 그 회귀를 잡는다.
//
//   (g)는 그 후속 FAIL: 소스별 감김 관례가 섞이면(Babylon STL 로더의 Y/Z 스왑으로
//   뒤집힌 모델 + 정상 감김 조립 서포트) nonzero 감김수가 상쇄돼 겹친 부위에
//   검은 틈이 남는다. normalizeTriangleWinding 이 이를 막는지 확인한다.
//
//   실행: npx tsx scripts/verify-slice-rasterize.mjs
//   통과 로그는 커밋 메시지에 기록.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assembleVerticalSupport } from "../src/features/v2/support/assemble-core.ts";
import {
  chainSegments,
  normalizeTriangleWinding,
  sliceTrianglesAtY,
} from "../src/features/v2/utils/slice-geometry.ts";
import { rasterizePolygons } from "../src/features/v2/utils/slice-rasterize.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARTS = join(__dirname, "..", "src", "features", "v2", "support", "parts");

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

// ── 합성 지오메트리 ──────────────────────────────────────────────────────

/**
 * 축정렬 상자의 삼각형 12개 (삼각형당 9 float, 바깥 법선 감김).
 *   min/max 는 [x, y, z]. `flip=true` 면 감김을 뒤집어 내벽(구멍)용으로 쓴다.
 */
function boxTriangles(min, max, flip = false) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  // 8 꼭짓점.
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], // 아래 0..3
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], // 위 4..7
  ];
  // 각 면을 바깥 법선 기준 CCW 로 (오른손 법칙: (v1−v0)×(v2−v0) 가 바깥).
  const faces = [
    [0, 3, 2], [0, 2, 1], // 바닥 (−Y)
    [4, 5, 6], [4, 6, 7], // 천장 (+Y)
    [0, 1, 5], [0, 5, 4], // −Z
    [2, 3, 7], [2, 7, 6], // +Z
    [3, 0, 4], [3, 4, 7], // −X
    [1, 2, 6], [1, 6, 5], // +X
  ];
  const out = new Float32Array(faces.length * 9);
  let o = 0;
  for (const f of faces) {
    const tri = flip ? [f[0], f[2], f[1]] : f;
    for (const k of tri) {
      out[o++] = v[k][0];
      out[o++] = v[k][1];
      out[o++] = v[k][2];
    }
  }
  return out;
}

/** 여러 Float32Array 삼각형 배열을 하나로 잇는다. */
function concatTris(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** 삼각형 배열을 Y축 기준 각도(rad) 회전. */
function rotateTrisY(tris, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    out[i] = c * x + s * z;
    out[i + 1] = y;
    out[i + 2] = -s * x + c * z;
  }
  return out;
}

// ── 래스터화 헬퍼 ────────────────────────────────────────────────────────

/** 검증용 플레이트/해상도 (100mm 정사각, 1px = 0.1mm). */
const OPTS = {
  widthPx: 1000,
  heightPx: 1000,
  plateWidthMm: 100,
  plateDepthMm: 100,
};

/** 삼각형 배열을 Y=y 로 잘라 마스크로. */
function maskAtY(tris, y, opts = OPTS) {
  const segs = sliceTrianglesAtY(tris, y);
  const polys = chainSegments(segs);
  return rasterizePolygons(polys, opts);
}

/** world (X, Z) → 픽셀 인덱스의 마스크 값(0/1). 범위 밖이면 0. */
function sampleAt(mask, opts, worldX, worldZ) {
  const px = Math.floor(((worldX + opts.plateWidthMm / 2) / opts.plateWidthMm) * opts.widthPx);
  const py = Math.floor(((opts.plateDepthMm / 2 - worldZ) / opts.plateDepthMm) * opts.heightPx);
  if (px < 0 || px >= mask.width || py < 0 || py >= mask.height) return 0;
  return mask.data[py * mask.width + px];
}

/** 마스크에서 1 인 픽셀 수. */
function filledCount(mask) {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) n++;
  return n;
}

/** 픽셀 수 → mm². */
function pixelsToMm2(n, opts = OPTS) {
  const pxArea = (opts.plateWidthMm / opts.widthPx) * (opts.plateDepthMm / opts.heightPx);
  return n * pxArea;
}

// ── 케이스 ───────────────────────────────────────────────────────────────

function caseOverlappingSolids() {
  console.log("\n(a) 겹침 솔리드 — 부분 겹친 상자 2개:");
  // X 로 어긋나게 겹친 두 상자. 겹침 구간 X ∈ [-2, 2].
  const a = boxTriangles([-8, 0, -5], [2, 10, 5]);
  const b = boxTriangles([-2, 0, -5], [8, 10, 5]);
  const mask = maskAtY(concatTris(a, b), 5);
  const center = sampleAt(mask, OPTS, 0, 0); // 겹침 영역 중심.
  console.log(`  겹침 중심(0, 0) 픽셀 = ${center}`);
  assert(center === 1, "겹침 영역 중심 픽셀 = 1 (even-odd 였다면 0)");
  // 겹치지 않은 양쪽 날개도 채워져야 union 이 맞다.
  assert(sampleAt(mask, OPTS, -6, 0) === 1, "왼쪽 상자 단독 영역 = 1");
  assert(sampleAt(mask, OPTS, 6, 0) === 1, "오른쪽 상자 단독 영역 = 1");
  // union 면적 = 16 × 10 (두 상자 합집합 X ∈ [-8, 8], Z ∈ [-5, 5]).
  const area = pixelsToMm2(filledCount(mask));
  console.log(`  union 면적 = ${area.toFixed(2)}mm² (기대 160)`);
  assert(Math.abs(area - 160) / 160 <= 0.02, "union 면적 ≈ 160mm² (±2%)");
}

function caseNestedSolids() {
  console.log("\n(b) 중첩 솔리드 — 큰 상자 안의 작은 상자(둘 다 바깥 법선):");
  const big = boxTriangles([-10, 0, -10], [10, 10, 10]);
  const small = boxTriangles([-3, 0, -3], [3, 10, 3]);
  const mask = maskAtY(concatTris(big, small), 5);
  const center = sampleAt(mask, OPTS, 0, 0);
  console.log(`  작은 상자 중심(0, 0) 픽셀 = ${center}`);
  assert(center === 1, "작은 상자 중심 픽셀 = 1 (도넛 버그 회귀 방지)");
  assert(sampleAt(mask, OPTS, 7, 7) === 1, "큰 상자 영역(7, 7) = 1");
  // 감김수 2 구간도 채워지므로 면적은 큰 상자 그대로 400mm².
  const area = pixelsToMm2(filledCount(mask));
  console.log(`  채움 면적 = ${area.toFixed(2)}mm² (기대 400)`);
  assert(Math.abs(area - 400) / 400 <= 0.02, "채움 면적 ≈ 400mm² (구멍 없음)");
}

function caseTrueHole() {
  console.log("\n(c) 진짜 구멍 — 속 빈 상자(내강 벽은 반대 감김):");
  const outer = boxTriangles([-10, 0, -10], [10, 10, 10]);
  // 내강: 솔리드 기준 바깥 법선 = 내강 안쪽을 향함 → 감김 뒤집기.
  const cavity = boxTriangles([-4, 0, -4], [4, 10, 4], true);
  const mask = maskAtY(concatTris(outer, cavity), 5);
  const wall = sampleAt(mask, OPTS, 7, 0); // 벽 위.
  const hollow = sampleAt(mask, OPTS, 0, 0); // 내강 중심.
  console.log(`  벽(7, 0) = ${wall}, 내강 중심(0, 0) = ${hollow}`);
  assert(wall === 1, "벽 위 픽셀 = 1");
  assert(hollow === 0, "내강 중심 픽셀 = 0 (구멍 보존)");
  // 링 면적 = 400 − 64 = 336mm².
  const area = pixelsToMm2(filledCount(mask));
  console.log(`  링 면적 = ${area.toFixed(2)}mm² (기대 336)`);
  assert(Math.abs(area - 336) / 336 <= 0.02, "링 면적 ≈ 336mm² (±2%)");
}

/** (d) 단일 상자 회귀. 면적/바깥 픽셀을 확인하고 면적을 (e)에 넘긴다. */
function caseSingleBox() {
  console.log("\n(d) 단일 상자 회귀 — 20×20mm 단면:");
  const box = boxTriangles([-10, 0, -10], [10, 10, 10]);
  const mask = maskAtY(box, 5);
  const area = pixelsToMm2(filledCount(mask));
  console.log(`  채움 면적 = ${area.toFixed(2)}mm² (기대 400)`);
  assert(Math.abs(area - 400) / 400 <= 0.02, "단면 면적 ≈ 400mm² (±2%)");
  assert(sampleAt(mask, OPTS, 0, 0) === 1, "상자 중심 = 1");
  assert(sampleAt(mask, OPTS, 20, 0) === 0, "상자 밖(20, 0) = 0");
  assert(sampleAt(mask, OPTS, 0, -20) === 0, "상자 밖(0, -20) = 0");
  assert(sampleAt(mask, OPTS, -30, 30) === 0, "상자 밖(-30, 30) = 0");
  return area;
}

function caseRotationInvariance(baseArea) {
  console.log("\n(e) 회전 무관 — (d)의 상자를 Y축 30° 회전:");
  const box = boxTriangles([-10, 0, -10], [10, 10, 10]);
  const rotated = rotateTrisY(box, (30 * Math.PI) / 180);
  const mask = maskAtY(rotated, 5);
  const area = pixelsToMm2(filledCount(mask));
  console.log(`  회전 후 면적 = ${area.toFixed(2)}mm² (기준 ${baseArea.toFixed(2)})`);
  assert(
    Math.abs(area - baseArea) / baseArea <= 0.02,
    "회전 후 면적이 (d)와 ±2% 이내 (감김 판정이 방향 무관)",
  );
  assert(sampleAt(mask, OPTS, 0, 0) === 1, "회전 상자 중심 = 1");
}

// ── (f) 조립 서포트 실물 회귀 ────────────────────────────────────────────

/** 바이너리 STL → { positions, indices } (verify-assemble-core.mjs 와 동일). */
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

/** { positions, indices } → 삼각형당 9 float flat 배열. */
function geoToTriangles(geo) {
  const idx = geo.indices;
  const p = geo.positions;
  const out = new Float32Array(idx.length * 3);
  let o = 0;
  for (let i = 0; i < idx.length; i++) {
    const k = idx[i] * 3;
    out[o++] = p[k];
    out[o++] = p[k + 1];
    out[o++] = p[k + 2];
  }
  return out;
}

function caseAssembledSupport() {
  console.log("\n(f) 조립 서포트 실물 회귀 — 발 구간 단면:");
  const parts = {
    sphere: loadPart("sphere.stl"),
    cone: loadPart("cone.stl"),
    cylinder: loadPart("cylinder.stl"),
  };
  // verify-assemble-core.mjs 와 동일한 기본 스펙 (설계 4-1).
  const spec = {
    surfaceY: 8.0,
    baseY: 0.0,
    tipDiameterMm: 0.4,
    headBackDiameterMm: 1.0,
    headLengthMm: 1.0,
    contactPenetrationMm: 0.2,
    trunkDiameterMm: 0.8,
    baseDiameterMm: 1.5,
    baseTransitionMm: 3.0,
  };
  const geo = assembleVerticalSupport(parts, spec);
  const tris = geoToTriangles(geo);

  // 서포트는 미세(⌀1.5mm)하므로 고해상도 플레이트로 본다 (1px = 0.01mm).
  const opts = {
    widthPx: 1000,
    heightPx: 1000,
    plateWidthMm: 10,
    plateDepthMm: 10,
  };

  // 발(원뿔, Y 0→3)과 기둥(⌀0.8)이 겹치는 높이. 여기서 단면은 동심원 2개 →
  //   even-odd 였다면 기둥 축 중심이 도넛 구멍(0)이 된다.
  const y = spec.baseY + spec.baseTransitionMm * 0.5; // Y = 1.5
  const segs = sliceTrianglesAtY(tris, y);
  const polys = chainSegments(segs);
  const mask = rasterizePolygons(polys, opts);
  console.log(`  Y=${y} 단면: segment ${segs.length}, polygon ${polys.length}`);

  const axis = sampleAt(mask, opts, 0, 0); // 기둥 축 = 로컬 XZ 원점.
  console.log(`  기둥 축 중심(0, 0) 픽셀 = ${axis}`);
  assert(axis === 1, "발 구간 기둥 축 중심 픽셀 = 1 (even-odd 였다면 0)");

  // 채움이 "발 원뿔 ∪ 기둥" 의 원반이어야 한다 — 도넛(중심 빈 링)이 아니라.
  //   Y=1.5 에서 발 원뿔은 ⌀0.75(1.5→0 선형), 기둥은 ⌀0.8 → union 은 둘 중
  //   큰 ⌀0.8 원반. (기둥을 baseY 까지 겹쳐 세운 조립 의도 그대로.)
  const area = pixelsToMm2(filledCount(mask), opts);
  const dUnion = Math.max(0.75, spec.trunkDiameterMm);
  const expected = Math.PI * (dUnion / 2) ** 2;
  console.log(
    `  단면 면적 = ${area.toFixed(4)}mm² (⌀${dUnion} 원반 기대 ${expected.toFixed(4)})`,
  );
  // 부품 STL 은 다각형 근사라 이상 원보다 약간 작다 → 하한을 넉넉히 둔다.
  assert(
    area >= expected * 0.9 && area <= expected * 1.05,
    "발 구간 단면 면적 ≈ ⌀0.8 원반 (도넛 아님)",
  );

  // 기둥만 있는 높이(발 위쪽)에서도 축 중심이 채워져야 한다.
  const yTrunk = spec.baseY + spec.baseTransitionMm + 1.0; // Y = 4.0
  const maskTrunk = rasterizePolygons(
    chainSegments(sliceTrianglesAtY(tris, yTrunk)),
    opts,
  );
  assert(sampleAt(maskTrunk, opts, 0, 0) === 1, `기둥 구간(Y=${yTrunk}) 축 중심 = 1`);
}

/**
 * (g) 혼합 감김 회귀 — 리드 실물 확인 FAIL 재현.
 *
 * 모델 메시(Babylon STL 로더 Y/Z 스왑으로 감김 뒤집힘)와 조립 서포트(정상 감김)가
 * 겹친 상황을 상자 2개로 재현한다. 정규화 없으면 감김수 +1 + (−1) = 0 → 검은 틈.
 */
function caseMixedWinding() {
  console.log("\n(g) 혼합 감김 회귀 — 정상 감김 + 뒤집힌 감김 겹침:");

  // A = 정상 감김(조립 서포트 쪽), B = 감김 뒤집힘(STL 로더로 읽은 모델 쪽).
  //   겹침 구간 X ∈ [-2, 2].
  const makeA = () => boxTriangles([-8, 0, -5], [2, 10, 5]);
  const makeB = () => boxTriangles([-2, 0, -5], [8, 10, 5], true);

  // g-1: 정규화 없이 → 겹침 중심이 상쇄돼 0 (버그 재현).
  const rawMask = maskAtY(concatTris(makeA(), makeB()), 5);
  const rawCenter = sampleAt(rawMask, OPTS, 0, 0);
  console.log(`  g-1 정규화 없음: 겹침 중심(0, 0) = ${rawCenter}`);
  assert(rawCenter === 0, "g-1 정규화 없으면 겹침 중심 = 0 (FAIL 재현 확인)");

  // g-2: 각 메시를 개별 정규화 후 합치면 → 겹침 중심 = 1.
  //   (실제 파이프라인도 mesh 단위로 extractWorldTriangles 를 거친다.)
  const normA = normalizeTriangleWinding(makeA());
  const normB = normalizeTriangleWinding(makeB());
  const mask = maskAtY(concatTris(normA, normB), 5);
  const center = sampleAt(mask, OPTS, 0, 0);
  console.log(`  g-2 정규화 후: 겹침 중심(0, 0) = ${center}`);
  assert(center === 1, "g-2 정규화 후 겹침 중심 = 1 (검은 틈 해소)");
  assert(sampleAt(mask, OPTS, -6, 0) === 1, "g-2 A 단독 영역 = 1");
  assert(sampleAt(mask, OPTS, 6, 0) === 1, "g-2 B 단독 영역 = 1");
  const area = pixelsToMm2(filledCount(mask));
  console.log(`  g-2 union 면적 = ${area.toFixed(2)}mm² (기대 160)`);
  assert(Math.abs(area - 160) / 160 <= 0.02, "g-2 union 면적 ≈ 160mm² (±2%)");

  // g-3: 감김 뒤집힌 속 빈 상자를 정규화 → 내강은 그대로 구멍이어야 한다.
  //   (전체를 일괄로 뒤집으므로 내강의 '상대' 감김은 보존된다.)
  const outer = boxTriangles([-10, 0, -10], [10, 10, 10], true); // 뒤집힘.
  const cavity = boxTriangles([-4, 0, -4], [4, 10, 4]); // 내강도 함께 뒤집힘.
  const hollowMask = maskAtY(
    normalizeTriangleWinding(concatTris(outer, cavity)),
    5,
  );
  const wall = sampleAt(hollowMask, OPTS, 7, 0);
  const hollow = sampleAt(hollowMask, OPTS, 0, 0);
  console.log(`  g-3 뒤집힌 속 빈 상자 정규화: 벽(7, 0) = ${wall}, 내강(0, 0) = ${hollow}`);
  assert(wall === 1, "g-3 벽 위 픽셀 = 1");
  assert(hollow === 0, "g-3 내강 중심 = 0 (내강 상대 감김 보존)");
  const ring = pixelsToMm2(filledCount(hollowMask));
  console.log(`  g-3 링 면적 = ${ring.toFixed(2)}mm² (기대 336)`);
  assert(Math.abs(ring - 336) / 336 <= 0.02, "g-3 링 면적 ≈ 336mm² (±2%)");
}

// ── main ─────────────────────────────────────────────────────────────────

function main() {
  console.log("슬라이스 래스터화 nonzero 감김 검증 (B-7)");
  caseOverlappingSolids();
  caseNestedSolids();
  caseTrueHole();
  const baseArea = caseSingleBox();
  caseRotationInvariance(baseArea);
  caseAssembledSupport();
  caseMixedWinding();

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
