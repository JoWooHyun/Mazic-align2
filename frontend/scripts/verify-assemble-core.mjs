// 서포트 조립 코어 헤드리스 검증 (S-4b-1). Node 에서 부품 STL 을 읽고
//   assemble-core 로직으로 조립 → bbox·삼각형 수·주요 Y좌표 assert.
//   assemble-core.ts(순수)를 tsx 로 직접 import 한다(Babylon 미의존이라 가능).
//
//   실행: npx tsx scripts/verify-assemble-core.mjs
//   통과 로그는 커밋 메시지에 기록.
//
//   ★ B-18 추가: "모델을 수직 이동하면 기둥 발은 플레이트(world Y=0)에 남고 기둥
//     길이만 그만큼 늘어난다" 를 **수치로** 검증한다(맨 아래 (B-18) 절). 수정 전
//     구현(baseY = 저장된 base 의 world Y)을 대조군으로 함께 돌려, 그때는 발이
//     ty 만큼 떠오르는 것을 재현한다 — 스크립트가 실제로 버그를 잡는다는 증명
//     (프로젝트 규약, B-1 확립).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleVerticalSupport,
  resolveRedesignBaseY,
} from "../src/features/v2/support/assemble-core.ts";

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

  // ── (B-18) 수직 이동: 발은 플레이트에 남고 기둥 길이만 ty 만큼 늘어난다 ────
  //   리드 확정 정책(타 슬라이서 실물 대조): "수직이동은 서포터 달린 상태로
  //   올라갔다 내려오더라. 서포터랑 stl 이랑 아예 다른 객체 취급이야."
  //   → 서포트는 플레이트에 서 있는 독립 구조물. 모델이 오르내리면 발은 바닥에
  //     붙은 채 기둥 길이만 변한다.
  //
  //   실제 데이터 흐름 재현:
  //     · 점 생성 시 world contact=(cx, surfaceY0, cz), world base=(cx, 0, cz).
  //       이 값이 stl-local 로 저장된다(coordSpace='stl-local', baseAnchor='plate').
  //     · 모델을 ty 만큼 수직 이동 → STL world matrix 가 translate(0,ty,0).
  //     · 래퍼(assemble-support)가 저장 local 좌표를 world 로 되돌리면 contact 도
  //       base 도 **둘 다 ty 만큼 올라온다**. 여기서 base 를 그대로 쓰면(수정 전)
  //       발이 떠오르고, resolveRedesignBaseY 로 플레이트에 고정하면(수정 후)
  //       발은 0 에 남고 기둥만 늘어난다.
  console.log("\n(B-18) 수직 이동 — 발 고정 + 기둥 길이 = ty 만큼 증가:");
  const B18_CX = 3.0;
  const B18_CZ = -2.5;
  const B18_SURFACE0 = 8.0; // 이동 전 접점 world Y.
  const b18spec = { ...spec, tipDiameterMm: 0.4 };

  /**
   * 모델을 ty 만큼 올렸을 때의 최종 world 지오메트리를 만든다.
   *   fixFoot=true  → 수정 후(resolveRedesignBaseY 로 플레이트 고정).
   *   fixFoot=false → **대조군**: 수정 전(baseY = 저장 base 의 world Y).
   * STL world matrix 는 순수 수직 평행이동이라 local↔world 왕복이 ±ty 다.
   */
  function buildAtTy(ty, fixFoot) {
    // 저장된 local 좌표 (생성 시점 world 에서 inv(world0)=항등 → 그대로).
    const localContact = [B18_CX, B18_SURFACE0, B18_CZ];
    const localBase = [B18_CX, 0, B18_CZ];
    // 모델을 ty 올린 뒤 래퍼가 보는 world 값.
    const wContactY = localContact[1] + ty;
    const wBaseY = localBase[1] + ty; // ★ base 도 같이 떠오른다.
    const baseY = fixFoot
      ? resolveRedesignBaseY(wBaseY, "plate")
      : wBaseY; // 대조군 = 옛 `const baseY = wBase.y;`
    const g = assembleVerticalSupport(parts, {
      ...b18spec,
      surfaceY: wContactY,
      baseY,
    });
    // 조립은 로컬 XZ 원점 기준 → contact 의 world XZ 로 평행이동(래퍼와 동일).
    const pos = new Float32Array(g.positions.length);
    for (let i = 0; i < g.positions.length; i += 3) {
      pos[i] = g.positions[i] + B18_CX;
      pos[i + 1] = g.positions[i + 1];
      pos[i + 2] = g.positions[i + 2] + B18_CZ;
    }
    return { positions: pos, indices: g.indices, baseY, surfaceY: wContactY };
  }

  // 기준(ty=0) — 이동 전 기둥 높이를 잰다.
  const g0 = buildAtTy(0, true);
  const bb0 = bbox(g0);
  const h0 = bb0.max[1] - bb0.min[1];
  console.log(
    `  기준 ty=0: 발 Y=${bb0.min[1].toFixed(4)}, 꼭대기 Y=${bb0.max[1].toFixed(4)}, 전체 높이=${h0.toFixed(4)}mm`,
  );
  approx(bb0.min[1], 0, 1e-3, "ty=0: 발이 플레이트(world Y=0)");

  for (const ty of [5, 20, 50, -3.2]) {
    const g = buildAtTy(ty, true);
    const bb = bbox(g);
    const h = bb.max[1] - bb.min[1];
    console.log(
      `  ty=${ty}: 발 Y=${bb.min[1].toFixed(4)}, 꼭대기 Y=${bb.max[1].toFixed(4)}, 전체 높이=${h.toFixed(4)}mm (Δ높이=${(h - h0).toFixed(4)})`,
    );
    // 1) 발이 여전히 플레이트에 있다.
    approx(bb.min[1], 0, 1e-3, `ty=${ty}: 발이 여전히 world Y=0 (플레이트 고정)`);
    // 2) 기둥(=전체) 높이가 정확히 ty 만큼 늘어난다.
    approx(h - h0, ty, 1e-3, `ty=${ty}: 전체 높이가 정확히 ty 만큼 증가`);
    // 3) 접점(화살촉 끝)이 모델 표면에 그대로 붙어 있다
    //    = 꼭대기가 (이동한 표면 Y + 침투) 에 온다.
    approx(
      bb.max[1],
      B18_SURFACE0 + ty + spec.contactPenetrationMm,
      1e-2,
      `ty=${ty}: 화살촉 끝 = 이동한 표면 Y + 침투(${spec.contactPenetrationMm}) — 접점 유지`,
    );
    // 4) 기둥이 여전히 world 수직 (하부·상부 단면 XZ 중심 일치).
    const cLo = sectionCenterXZAtY(g, ty > 0 ? 1.0 : 0.5);
    const cHi = sectionCenterXZAtY(g, B18_SURFACE0 + ty - 2.0);
    assert(cLo && cHi, `ty=${ty}: 하부·상부 단면 존재`);
    if (cLo && cHi) {
      approx(cLo[0], cHi[0], 5e-2, `ty=${ty}: 기둥 축 world X 일정(수직 유지)`);
      approx(cLo[1], cHi[1], 5e-2, `ty=${ty}: 기둥 축 world Z 일정(수직 유지)`);
    }
  }

  // ── [대조군] 수정 전(baseY = wBase.y): 발이 ty 만큼 떠오른다 ───────────────
  console.log("\n(B-18 대조군) 수정 전 구현이면 발이 ty 만큼 떠오른다:");
  for (const ty of [5, 20, 50]) {
    const gOld = buildAtTy(ty, false);
    const bbOld = bbox(gOld);
    const hOld = bbOld.max[1] - bbOld.min[1];
    console.log(
      `  [대조군] ty=${ty}: 발 Y=${bbOld.min[1].toFixed(4)} (기대 ${ty}), 전체 높이=${hOld.toFixed(4)}mm (Δ높이=${(hOld - h0).toFixed(4)})`,
    );
    // 발이 플레이트가 아니라 정확히 ty 만큼 떠 있다 = 리드가 본 버그.
    approx(
      bbOld.min[1],
      ty,
      1e-3,
      `[대조군] ty=${ty}: 발이 world Y=${ty} 로 떠오름(플레이트 이탈) — 버그 재현`,
    );
    // 기둥 길이는 그대로 = 모델을 통째로 들어올린 꼴.
    approx(
      hOld - h0,
      0,
      1e-3,
      `[대조군] ty=${ty}: 기둥 길이가 안 늘어남(통째로 따라 올라감)`,
    );
    // 수정 후와 결과가 실제로 갈리는지 = 스크립트가 차이를 잡는다는 증명.
    const gNew = buildAtTy(ty, true);
    const bbNew = bbox(gNew);
    assert(
      Math.abs(bbNew.min[1] - bbOld.min[1]) > ty - 1e-3,
      `ty=${ty}: 수정 전(${bbOld.min[1].toFixed(3)}) vs 수정 후(${bbNew.min[1].toFixed(3)}) 발 Y 가 ${ty}mm 갈림`,
    );
  }

  // ── resolveRedesignBaseY 단위 검증 — S-4b-2 3단 폴백 안전성 ────────────────
  console.log("\n(B-18) resolveRedesignBaseY — 폴백 안전성:");
  assert(
    resolveRedesignBaseY(12.5, "plate") === 0,
    "baseAnchor='plate' → 떠 있는 base 도 플레이트(0)로 고정",
  );
  // ★ 핵심: 'model' 앵커는 손대지 않는다 = S-4b-2 폴백(경사 다리·근처 기둥 합류·
  //   모델 표면 앵커)이 들어와도 발이 바닥으로 끌려 내려가지 않는다.
  for (const y of [12.5, 3.0, -1.0, 0.0]) {
    assert(
      resolveRedesignBaseY(y, "model") === y,
      `baseAnchor='model' → base world Y=${y} 를 그대로 존중(S-4b-2 폴백 보호)`,
    );
  }
  // 미지정(옛 데이터) 추정: 플레이트 근처면 고정, 아니면 그대로.
  assert(
    resolveRedesignBaseY(0, undefined) === 0,
    "미지정 + base Y=0 → 접지 의도로 보고 고정",
  );
  assert(
    resolveRedesignBaseY(1e-5, undefined) === 0,
    "미지정 + base Y=1e-5(float32 왕복 노이즈) → 접지로 판정",
  );
  assert(
    resolveRedesignBaseY(7.5, undefined) === 7.5,
    "미지정 + base Y=7.5(명백히 뜬 값) → 추정 안 함, 그대로 존중",
  );

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
