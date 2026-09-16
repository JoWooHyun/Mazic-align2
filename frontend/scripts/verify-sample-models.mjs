// 예제 모델(정육면체 20mm / 구 지름 20mm) STL 생성 헤드리스 검증.
//
//   리드 요청("치투박스처럼 간단한 예제")으로 STL 을 파일이 아닌 **코드로** 만든다.
//   파일이 없으니 "열어서 눈으로 확인"이 불가능하다 — 그래서 생성 결과를 바이트
//   단위로 되읽어 치수·법선·winding 을 직접 잰다.
//
//   검사 항목:
//     (a) 바이너리 STL 구조 — 헤더 80 + uint32 개수 + 50바이트×N 이 파일 길이와 일치
//     (b) 법선 위생 — 모든 법선이 단위벡터(‖n‖≈1), 면적 0(degenerate) 삼각형 없음
//     (c) 정육면체 — AABB 가 정확히 20×20×20, minY=0, XZ 중심 0, 삼각형 12개
//     (d) 구 — AABB 20×20×20, minY=0, 모든 정점이 중심(0,10,0)에서 반지름 10±ε
//     (e) winding/법선 외향성 — 기입된 법선과 winding 에서 다시 계산한 법선이 일치하고,
//         둘 다 도형 중심 반대편(바깥)을 향한다
//     (f) **변조 대조군** — 법선을 0 으로 만든 STL, winding 을 뒤집은 STL 을 만들어
//         (b)(e) 검사가 실제로 FAIL 을 내는지 증명한다. 검사가 통과만 하는 검사가
//         아니라는 근거.
//
//   실행: npx tsx scripts/verify-sample-models.mjs

import { SAMPLE_MODELS } from "../src/features/v2/utils/sample-models.ts";

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

// 치수 허용치. 정점을 float32 로 기록하므로 ~10mm 규모에서 ~1e-6mm 오차가 남는다.
//   프린터 해상도(수십 µm)보다 세 자리 이상 작다.
const TOL = 1e-4;
const HEADER_BYTES = 80;
const TRI_BYTES = 50;

/** 바이너리 STL ArrayBuffer → { count, tris: [{ n, v: [p0,p1,p2] }] }. */
function parseBinaryStl(buffer) {
  const view = new DataView(buffer);
  const count = view.getUint32(HEADER_BYTES, true);
  const tris = [];
  for (let i = 0; i < count; i++) {
    const o = HEADER_BYTES + 4 + i * TRI_BYTES;
    const n = [
      view.getFloat32(o, true),
      view.getFloat32(o + 4, true),
      view.getFloat32(o + 8, true),
    ];
    const v = [];
    for (let k = 0; k < 3; k++) {
      const p = o + 12 + k * 12;
      v.push([
        view.getFloat32(p, true),
        view.getFloat32(p + 4, true),
        view.getFloat32(p + 8, true),
      ]);
    }
    tris.push({ n, v });
  }
  return { count, tris };
}

/** 정점 배열의 AABB → { min: [x,y,z], max: [x,y,z] }. */
function aabbOf(tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (const p of t.v) {
      for (let k = 0; k < 3; k++) {
        if (p[k] < min[k]) min[k] = p[k];
        if (p[k] > max[k]) max[k] = p[k];
      }
    }
  }
  return { min, max };
}

/** winding 에서 다시 계산한 법선(비정규화) = (b−a) × (c−a). 길이 = 면적×2. */
function crossOf(tri) {
  const [a, b, c] = tri.v;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

function centroidOf(tri) {
  return [0, 1, 2].map((k) => (tri.v[0][k] + tri.v[1][k] + tri.v[2][k]) / 3);
}

/**
 * 법선 위생 + winding 외향성 검사. 대조군에도 그대로 돌리기 위해 결과를
 * assert 하지 않고 **집계값으로 반환**한다.
 *
 * center: 도형의 기하 중심(볼록 도형이므로 중심→면중심 방향이 곧 바깥).
 */
function inspect(tris, center) {
  let minNormLen = Infinity;
  let maxNormLen = 0;
  let minArea = Infinity;
  let outward = 0;
  let inward = 0;
  let maxNormalMismatch = 0;
  for (const t of tris) {
    const len = Math.hypot(t.n[0], t.n[1], t.n[2]);
    minNormLen = Math.min(minNormLen, len);
    maxNormLen = Math.max(maxNormLen, len);

    const cr = crossOf(t);
    const crLen = Math.hypot(cr[0], cr[1], cr[2]);
    minArea = Math.min(minArea, crLen / 2);

    // winding 이 가리키는 방향이 바깥인가 — 면중심이 도형 중심에서 멀어지는 쪽.
    const g = centroidOf(t);
    const out = [g[0] - center[0], g[1] - center[1], g[2] - center[2]];
    const dot = cr[0] * out[0] + cr[1] * out[1] + cr[2] * out[2];
    if (dot > 0) outward++;
    else inward++;

    // 기입 법선과 winding 재계산 법선의 불일치(단위벡터 간 거리).
    if (crLen > 0 && len > 0) {
      const d = Math.hypot(
        t.n[0] / len - cr[0] / crLen,
        t.n[1] / len - cr[1] / crLen,
        t.n[2] / len - cr[2] / crLen,
      );
      maxNormalMismatch = Math.max(maxNormalMismatch, d);
    } else {
      // 법선이 영벡터면 비교 자체가 불가 — 최대 불일치로 취급.
      maxNormalMismatch = 2;
    }
  }
  return { minNormLen, maxNormLen, minArea, outward, inward, maxNormalMismatch };
}

// ── 검사 케이스 ─────────────────────────────────────────────────────────

/** (a)(b)(e) — 두 예제 공통 검사. 파싱 결과를 돌려준다. */
function caseCommon(def, buffer, center) {
  console.log(`\n[${def.id}] ${def.label} — ${def.fileName}`);
  const { count, tris } = parseBinaryStl(buffer);
  const expectedBytes = HEADER_BYTES + 4 + count * TRI_BYTES;
  console.log(
    `  삼각형 ${count}개 / ${buffer.byteLength} 바이트 (기대 ${expectedBytes})`,
  );

  // (a) 구조.
  assert(
    buffer.byteLength === expectedBytes,
    `파일 길이 = 80 + 4 + 50×${count} = ${expectedBytes} 바이트`,
  );
  assert(count > 0, `삼각형 개수 헤더가 0 이 아니다 (${count})`);
  // 첫 5바이트가 "solid" 면 ASCII STL 로 오인된다 — 설명문이 그걸 피하는지 확인.
  const head = new TextDecoder("ascii").decode(new Uint8Array(buffer, 0, 5));
  assert(head !== "solid", `헤더가 "solid" 로 시작하지 않는다 (실제 "${head}")`);

  const info = inspect(tris, center);
  console.log(
    `  법선 길이 ${info.minNormLen.toFixed(6)}~${info.maxNormLen.toFixed(6)}` +
      ` / 최소 삼각형 면적 ${info.minArea.toExponential(3)}mm²`,
  );

  // (b) 법선 위생.
  assert(
    Math.abs(info.minNormLen - 1) < 1e-3 && Math.abs(info.maxNormLen - 1) < 1e-3,
    `모든 법선이 단위벡터 (길이 ${info.minNormLen.toFixed(6)}~${info.maxNormLen.toFixed(6)})`,
  );
  assert(info.minNormLen > 0.5, "영벡터 법선이 없다 (오버행 검출이 법선을 쓴다)");
  assert(
    info.minArea > 1e-6,
    `면적 0 삼각형(degenerate) 없음 — 최소 ${info.minArea.toExponential(3)}mm²`,
  );

  // (e) winding / 외향성.
  assert(
    info.inward === 0,
    `전 삼각형 winding 이 CCW·외향 (외향 ${info.outward} / 내향 ${info.inward})`,
  );
  assert(
    info.maxNormalMismatch < 1e-3,
    `기입 법선 = winding 재계산 법선 (최대 불일치 ${info.maxNormalMismatch.toExponential(2)})`,
  );

  return { count, tris };
}

/** (c) 정육면체 치수. */
function caseCube(tris, count) {
  console.log("\n(c) 정육면체 치수:");
  assert(count === 12, `삼각형 12개 (면당 2개) — 실제 ${count}개`);

  const { min, max } = aabbOf(tris);
  const size = [0, 1, 2].map((k) => max[k] - min[k]);
  console.log(
    `  AABB min (${min.map((v) => v.toFixed(4)).join(", ")})` +
      ` max (${max.map((v) => v.toFixed(4)).join(", ")})`,
  );
  console.log(`  크기 = ${size.map((v) => v.toFixed(4)).join(" × ")} mm`);

  assert(
    size.every((s) => Math.abs(s - 20) < TOL),
    `AABB 가 정확히 20 × 20 × 20 mm (${size.map((v) => v.toFixed(4)).join(" × ")})`,
  );
  assert(Math.abs(min[1]) < TOL, `바닥이 y=0 (minY ${min[1].toExponential(2)})`);
  assert(
    Math.abs(min[0] + max[0]) < TOL && Math.abs(min[2] + max[2]) < TOL,
    "XZ 중심이 원점 — 불러오자마자 플레이트 한가운데",
  );

  // 6면의 축 정렬 법선이 모두 나오는지 (면 하나가 빠지면 잡힌다).
  const dirs = new Set(
    tris.map((t) => t.n.map((v) => Math.round(v)).join(",")),
  );
  assert(dirs.size === 6, `축 정렬 법선 6종이 모두 존재 (실제 ${dirs.size}종)`);
}

/** (d) 구 치수. */
function caseSphere(tris, count) {
  console.log("\n(d) 구 치수:");
  console.log(`  삼각형 ${count}개`);

  const { min, max } = aabbOf(tris);
  const size = [0, 1, 2].map((k) => max[k] - min[k]);
  console.log(
    `  AABB min (${min.map((v) => v.toFixed(4)).join(", ")})` +
      ` max (${max.map((v) => v.toFixed(4)).join(", ")})`,
  );
  console.log(`  크기 = ${size.map((v) => v.toFixed(4)).join(" × ")} mm`);

  assert(
    size.every((s) => Math.abs(s - 20) < 1e-3),
    `AABB 가 20 × 20 × 20 mm (${size.map((v) => v.toFixed(4)).join(" × ")})`,
  );
  assert(Math.abs(min[1]) < TOL, `바닥이 y=0 에 닿는다 (minY ${min[1].toExponential(2)})`);
  assert(
    Math.abs(min[0] + max[0]) < 1e-3 && Math.abs(min[2] + max[2]) < 1e-3,
    "XZ 중심이 원점",
  );

  // 모든 정점이 중심 (0, 10, 0) 에서 반지름 10 ± ε.
  let minR = Infinity;
  let maxR = 0;
  for (const t of tris) {
    for (const p of t.v) {
      const r = Math.hypot(p[0], p[1] - 10, p[2]);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
  }
  console.log(`  정점 반지름 ${minR.toFixed(6)} ~ ${maxR.toFixed(6)} mm`);
  assert(
    Math.abs(minR - 10) < 1e-3 && Math.abs(maxR - 10) < 1e-3,
    `모든 정점이 중심 (0,10,0) 에서 반지름 10mm (${minR.toFixed(6)}~${maxR.toFixed(6)})`,
  );
}

/**
 * (f) 변조 대조군 — 검사가 결함을 실제로 잡는지 증명.
 *
 * 정상 STL 을 바이트 수준에서 두 가지로 변조하고, 위 검사와 **같은 inspect()** 를
 * 돌려 FAIL 조건이 걸리는지 본다. 걸리지 않으면 (b)(e) 통과는 의미가 없다.
 */
function caseTampered(buffer, center, label) {
  console.log(`\n(f) 변조 대조군 [${label}] — 검사가 결함을 잡는가:`);

  // ① 법선을 전부 0 으로. (b) "영벡터 법선 없음" 이 FAIL 해야 한다.
  const zeroed = buffer.slice(0);
  {
    const view = new DataView(zeroed);
    const count = view.getUint32(HEADER_BYTES, true);
    for (let i = 0; i < count; i++) {
      const o = HEADER_BYTES + 4 + i * TRI_BYTES;
      view.setFloat32(o, 0, true);
      view.setFloat32(o + 4, 0, true);
      view.setFloat32(o + 8, 0, true);
    }
  }
  const zInfo = inspect(parseBinaryStl(zeroed).tris, center);
  console.log(
    `  [법선 0] 최소 법선 길이 = ${zInfo.minNormLen}, 최대 법선 불일치 = ${zInfo.maxNormalMismatch}`,
  );
  assert(
    zInfo.minNormLen < 0.5,
    "법선을 0 으로 만든 STL 은 단위벡터 검사에서 걸린다 (검사가 살아 있음)",
  );
  assert(
    zInfo.maxNormalMismatch >= 2,
    "법선 0 은 winding 대조에서도 불일치로 잡힌다",
  );

  // ② winding 뒤집기 — 정점 1 과 2 를 교환. 법선은 그대로 두므로
  //    (e) "내향 0" 과 "기입 법선 = 재계산 법선" 이 모두 FAIL 해야 한다.
  const flipped = buffer.slice(0);
  {
    const view = new DataView(flipped);
    const count = view.getUint32(HEADER_BYTES, true);
    for (let i = 0; i < count; i++) {
      const o = HEADER_BYTES + 4 + i * TRI_BYTES;
      const p1 = o + 12 + 12;
      const p2 = o + 12 + 24;
      for (let k = 0; k < 3; k++) {
        const a = view.getFloat32(p1 + k * 4, true);
        const b = view.getFloat32(p2 + k * 4, true);
        view.setFloat32(p1 + k * 4, b, true);
        view.setFloat32(p2 + k * 4, a, true);
      }
    }
  }
  const fInfo = inspect(parseBinaryStl(flipped).tris, center);
  console.log(
    `  [winding 반전] 외향 ${fInfo.outward} / 내향 ${fInfo.inward},` +
      ` 최대 법선 불일치 ${fInfo.maxNormalMismatch.toFixed(4)}`,
  );
  assert(
    fInfo.outward === 0 && fInfo.inward > 0,
    `winding 을 뒤집으면 전 삼각형이 내향으로 판정된다 (내향 ${fInfo.inward}) — 검사가 살아 있음`,
  );
  assert(
    fInfo.maxNormalMismatch > 1.9,
    `뒤집힌 winding 은 기입 법선과 정반대(불일치 ≈2) 로 잡힌다 (${fInfo.maxNormalMismatch.toFixed(4)})`,
  );
}

async function main() {
  console.log("예제 모델 STL 생성 검증 (정육면체 20mm / 구 지름 20mm)");

  assert(SAMPLE_MODELS.length === 2, `예제 2종 노출 (실제 ${SAMPLE_MODELS.length}종)`);

  for (const def of SAMPLE_MODELS) {
    const blob = def.build();
    const buffer = await blob.arrayBuffer();
    // 두 도형 모두 중심이 (0, 10, 0) — 바닥이 y=0 이고 높이 20mm.
    const center = [0, 10, 0];

    const { count, tris } = caseCommon(def, buffer, center);
    if (def.id === "cube20") caseCube(tris, count);
    else caseSphere(tris, count);
    caseTampered(buffer, center, def.id);
  }

  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
