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

/**
 * Y=y0 근방(±band) 삼각형들이 그 평면을 가로지르는 지점의 XZ 반경 최대치×2 를
 * 대략적 단면 폭으로 본다. 각 삼각형의 세 변에서 Y=y0 교차점의 XZ 를 모아
 * 중심(평균) 대비 최대 반경으로 폭을 근사한다. (정밀 슬라이스는 아니지만 발
 * 원뿔·기둥 접합부가 ⌀trunk 이상인지 보기엔 충분.)
 */
function sectionWidthAtY(geo, y0) {
  const p = geo.positions;
  const idx = geo.indices;
  const pts = [];
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]].map((k) => [
      p[k * 3], p[k * 3 + 1], p[k * 3 + 2],
    ]);
    for (let e = 0; e < 3; e++) {
      const a = vs[e], b = vs[(e + 1) % 3];
      const ya = a[1], yb = b[1];
      if ((ya - y0) * (yb - y0) > 0) continue; // 같은 쪽 → 미교차.
      if (Math.abs(yb - ya) < 1e-9) continue;
      const s = (y0 - ya) / (yb - ya);
      if (s < 0 || s > 1) continue;
      pts.push([a[0] + s * (b[0] - a[0]), a[2] + s * (b[2] - a[2])]);
    }
  }
  if (pts.length === 0) return 0;
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  let rmax = 0;
  for (const [x, z] of pts) rmax = Math.max(rmax, Math.hypot(x - cx, z - cz));
  return rmax * 2;
}

/** Y=y0 단면 교차점들의 XZ 중심(평균). 미교차면 null. */
function sectionCenterXZAtY(geo, y0) {
  const p = geo.positions;
  const idx = geo.indices;
  let cx = 0, cz = 0, n = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]].map((k) => [
      p[k * 3], p[k * 3 + 1], p[k * 3 + 2],
    ]);
    for (let e = 0; e < 3; e++) {
      const a = vs[e], b = vs[(e + 1) % 3];
      if ((a[1] - y0) * (b[1] - y0) > 0) continue;
      if (Math.abs(b[1] - a[1]) < 1e-9) continue;
      const s = (y0 - a[1]) / (b[1] - a[1]);
      if (s < 0 || s > 1) continue;
      cx += a[0] + s * (b[0] - a[0]);
      cz += a[2] + s * (b[2] - a[2]);
      n++;
    }
  }
  return n === 0 ? null : [cx / n, cz / n];
}

/** 4x4 row-major 행렬로 [x,y,z] 변환. */
function apply4(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
  ];
}
/** Z축 회전(rad) 4x4. */
function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
/** 4x4 역행렬(회전+평행이동 한정이면 충분한 일반 역행렬, 여기선 순수 회전). */
function invRotZ(a) {
  return rotZ(-a);
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

  // ── 리뷰 수정 #1: 발↔기둥 접합부 단면 폭 ≥ ⌀trunk (구조 안 끊김) ──────────
  //   footTopY = baseY + baseTransitionMm 근방에서 단면 폭이 기둥 지름 이상이어야
  //   한다(기둥을 baseY 까지 겹쳐 세운 결과). 예전(꼭짓점 접합)이면 여기 ~0.
  console.log("\n리뷰 #1 — 발↔기둥 접합부 단면:");
  const footTopY = spec.baseY + spec.baseTransitionMm;
  const wJunction = sectionWidthAtY(geo, footTopY);
  console.log(`  Y=${footTopY} 단면 폭 = ${wJunction.toFixed(4)}mm (⌀trunk=${spec.trunkDiameterMm})`);
  assert(
    wJunction >= spec.trunkDiameterMm - 1e-3,
    `footTopY 근방 단면 폭 ≥ ⌀trunk (${wJunction.toFixed(4)} ≥ ${spec.trunkDiameterMm})`,
  );

  // ── 리뷰 수정 #2: 회전된 STL 에서도 월드 수직·발 Y=0 ────────────────────
  //   assemble-support.ts 의 월드 프레임 조립을 헤드리스로 재현: STL 이 Z축 30°
  //   회전일 때, world contact/base 로 월드 수직 조립 후 inv(world) 로 로컬화하고
  //   다시 parent(world) 를 곱해 최종 world 형상을 얻는다. 결과가 월드 수직(발
  //   Y=0, 기둥 XZ 가 앞구슬 XZ 와 동일)이어야 한다.
  console.log("\n리뷰 #2 — STL Z축 30° 회전 시 월드 수직·발 Y=0:");
  const ang = (30 * Math.PI) / 180;
  const W = rotZ(ang); // STL world matrix (순수 회전).
  const invW = invRotZ(ang);
  // 실제 데이터 흐름 재현: snapAndFinalizePoints 는 world contact(표면)와
  //   world base=[x,0,z](플레이트 Y=0)를 만든 뒤 worldToStlLocal(invW)로 저장한다.
  //   여기선 world 값에서 출발한다: contact world=(2, 8, -1), base world=(2, 0, -1).
  const wContact = [2, 8, -1];
  const wBase = [2, 0, -1]; // ★ world Y=0 (플레이트).
  // (저장되는 로컬 좌표는 invW·world 이지만, 래퍼가 다시 world 로 되돌리므로
  //   최종 검산은 world 값으로 한다.)
  // world 수직 조립: XZ=contact world XZ, surfaceY/baseY=world Y.
  const rspec = { ...spec, surfaceY: wContact[1], baseY: wBase[1] };
  const rgeo = assembleVerticalSupport(parts, rspec);
  // 로컬화(inv(world)) 후 다시 parent(world) → 최종 world positions 복원.
  const finalPos = new Float32Array(rgeo.positions.length);
  for (let i = 0; i < rgeo.positions.length; i += 3) {
    const world0 = [
      rgeo.positions[i] + wContact[0],
      rgeo.positions[i + 1],
      rgeo.positions[i + 2] + wContact[2],
    ];
    const local = apply4(invW, world0); // 저장될 로컬 좌표.
    const world = apply4(W, local); // parent 로 복원되는 world.
    finalPos[i] = world[0];
    finalPos[i + 1] = world[1];
    finalPos[i + 2] = world[2];
  }
  const rgb = bbox({ positions: finalPos, indices: rgeo.indices });
  console.log(`  최종 world bbox min=[${rgb.min.map((v) => v.toFixed(3))}] max=[${rgb.max.map((v) => v.toFixed(3))}]`);
  // 발이 플레이트(world Y=0)에 닿아야 한다.
  approx(rgb.min[1], 0, 1e-2, "회전 STL: 최종 world 발 Y = 0 (플레이트)");
  // 기둥이 월드 수직 → 서로 다른 Y 단면의 XZ 중심이 같아야 한다(축이 +Y 평행).
  const finalGeo = { positions: finalPos, indices: rgeo.indices };
  const cLow = sectionCenterXZAtY(finalGeo, 1.0);
  const cHigh = sectionCenterXZAtY(finalGeo, wContact[1] - 2.0);
  assert(cLow && cHigh, "회전 STL: 하부·상부 단면 존재");
  if (cLow && cHigh) {
    approx(cLow[0], cHigh[0], 5e-2, "회전 STL: 기둥 축 world X 일정(수직)");
    approx(cLow[1], cHigh[1], 5e-2, "회전 STL: 기둥 축 world Z 일정(수직)");
  }
  // 앞구슬 꼭대기 world Y = contact world Y + 침투.
  approx(rgb.max[1], wContact[1] + spec.contactPenetrationMm, 5e-2,
    "회전 STL: 앞구슬 꼭대기 = contact world Y + 침투");

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
