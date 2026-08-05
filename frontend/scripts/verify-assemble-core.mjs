// 서포트 조립 코어 헤드리스 검증 (S-4b-1). Node 에서 부품 STL 을 읽고
//   assemble-core 로직으로 조립 → bbox·삼각형 수·주요 Y좌표 assert.
//   assemble-core.ts(순수)를 tsx 로 직접 import 한다(Babylon 미의존이라 가능).
//
//   실행: npx tsx scripts/verify-assemble-core.mjs
//   통과 로그는 커밋 메시지에 기록.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assembleVerticalSupport } from "../src/features/v2/support/assemble-core.ts";

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

function bbox(geo) {
  const p = geo.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
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
  assert(Math.abs(a - b) <= tol, `${msg} (${a.toFixed(4)} ≈ ${b.toFixed(4)}, tol ${tol})`);
}

function main() {
  const parts = {
    sphere: loadPart("sphere.stl"),
    cone: loadPart("cone.stl"),
    cylinder: loadPart("cylinder.stl"),
  };
  console.log("부품 로드:");
  console.log(`  sphere ${parts.sphere.indices.length / 3} tris`);
  console.log(`  cone ${parts.cone.indices.length / 3} tris`);
  console.log(`  cylinder ${parts.cylinder.indices.length / 3} tris`);

  // 단위 부품 규격 확인.
  const sb = bbox(parts.sphere);
  approx(sb.min[0], -0.5, 1e-3, "sphere minX = -0.5 (⌀1.0)");
  approx(sb.max[0], 0.5, 1e-3, "sphere maxX = 0.5");
  const cb = bbox(parts.cone);
  approx(cb.min[2], 0, 1e-3, "cone 바닥 Z=0");
  approx(cb.max[2], 1, 1e-3, "cone 꼭짓점 Z=1");
  const yb = bbox(parts.cylinder);
  approx(yb.min[2], 0, 1e-3, "cylinder 바닥 Z=0");
  approx(yb.max[2], 1, 1e-3, "cylinder 상단 Z=1");

  // 조립 스펙 (설계 4-1 기본값 기반).
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
  console.log("\n조립 (surfaceY=8, baseY=0):");
  const geo = assembleVerticalSupport(parts, spec);
  const nTris = geo.indices.length / 3;
  console.log(`  조립 삼각형 ${nTris}개, 정점 ${geo.positions.length / 3}개`);
  assert(nTris > 0, "조립 삼각형 > 0");
  assert(
    nTris === (parts.sphere.indices.length + parts.cone.indices.length +
      parts.sphere.indices.length + parts.cylinder.indices.length +
      parts.cone.indices.length) / 3,
    "조립 삼각형 수 = 부품 합(앞구슬+원뿔+뒷구슬+기둥+발)",
  );

  const gb = bbox(geo);
  console.log(`  bbox min=[${gb.min.map((v) => v.toFixed(3))}] max=[${gb.max.map((v) => v.toFixed(3))}]`);

  // 바닥 Y = baseY(0).
  approx(gb.min[1], spec.baseY, 1e-3, "조립 바닥 Y = baseY (0)");

  // 침투: 앞구슬 꼭대기 = surfaceY + penetration.
  const tipR = spec.tipDiameterMm * 0.5;
  const frontCenterY = spec.surfaceY + spec.contactPenetrationMm - tipR;
  const expectedTop = frontCenterY + tipR; // = surfaceY + penetration.
  approx(gb.max[1], expectedTop, 1e-2, "앞구슬 꼭대기 = surfaceY + 침투(0.2)");
  approx(gb.max[1], spec.surfaceY + spec.contactPenetrationMm, 1e-2, "→ 표면을 침투 깊이만큼 파고듦");

  // 최대폭 = max(baseDiameter, headBackDiameter) 근사 (X 방향).
  const width = gb.max[0] - gb.min[0];
  approx(width, Math.max(spec.baseDiameterMm, spec.headBackDiameterMm), 5e-2,
    "최대 폭 ≈ max(baseDiameter, headBackDiameter)");

  // 스케일 정확 반영: 뒷구슬 지름 검증용으로 headBackDiameter 만 크게 한 케이스.
  const spec2 = { ...spec, headBackDiameterMm: 2.0, baseDiameterMm: 1.0 };
  const geo2 = assembleVerticalSupport(parts, spec2);
  const w2 = bbox(geo2).max[0] - bbox(geo2).min[0];
  approx(w2, 2.0, 5e-2, "headBackDiameter=2.0 반영 → 최대 폭 ≈ 2.0");

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
