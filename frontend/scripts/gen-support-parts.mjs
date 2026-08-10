// 서포트 부품 STL 생성 스크립트 (S-4b-1, B안 = 부품 STL 조립).
//   설계서 4장(기둥 세우기)이 요구하는 화살촉+기둥 형상을 "단위 크기 프리미티브
//   STL"을 스케일·배치·병합해 만들기 위한 부품을 생성한다. CHITUBOX 원본 STL 은
//   재배포 우려로 쓰지 않고(리드 결정 2026-08-05), 규격만 CHITUBOX 관례를 따라
//   자체 생성한다: 단위 크기(⌀1mm), Z-up, 바닥 Z=0.
//
//   산출물(바이너리 STL 3종): sphere.stl / cone.stl / cylinder.stl
//   재생성: node scripts/gen-support-parts.mjs
//
//   ※ 이 스크립트는 조립(assemble-core)과 무관한 순수 지오메트리 생성기다.
//     조립 시의 스케일·회전·이동은 assemble-core.ts 가 담당한다.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "src", "features", "v2", "support", "parts");

// 원주 분할 수(기본 24). 부품 공통.
const SEGMENTS = 24;

/**
 * 삼각형 목록 → 바이너리 STL ArrayBuffer.
 *   각 삼각형 = { n:[x,y,z] 법선, v:[[x,y,z]*3] }. 법선은 우리 파서/Babylon 이
 *   재계산하므로 (0,0,0) 이어도 무방하지만, 표준 준수를 위해 채워 넣는다.
 */
function trianglesToBinaryStl(triangles) {
  const count = triangles.length;
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  // 80바이트 헤더는 0 으로 둔다 (해석 안 됨).
  dv.setUint32(80, count, true);
  let off = 84;
  for (const t of triangles) {
    dv.setFloat32(off, t.n[0], true);
    dv.setFloat32(off + 4, t.n[1], true);
    dv.setFloat32(off + 8, t.n[2], true);
    off += 12;
    for (const v of t.v) {
      dv.setFloat32(off, v[0], true);
      dv.setFloat32(off + 4, v[1], true);
      dv.setFloat32(off + 8, v[2], true);
      off += 12;
    }
    dv.setUint16(off, 0, true); // attribute byte count.
    off += 2;
  }
  return buf;
}

/** 세 꼭짓점의 면 법선(정규화). 축퇴 삼각형이면 (0,0,1). */
function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return [0, 0, 1];
  return [nx / len, ny / len, nz / len];
}

/** 꼭짓점 3개를 삼각형 객체로(법선 자동). */
function tri(a, b, c) {
  return { n: faceNormal(a, b, c), v: [a, b, c] };
}

/**
 * 단위 구: ⌀1.0 (반지름 0.5), 중심 원점.
 *   UV 구면(위도 SEGMENTS/2, 경도 SEGMENTS) 삼각분할. 극점은 fan.
 */
function makeSphere(segments) {
  const R = 0.5;
  const latBands = Math.max(2, Math.floor(segments / 2));
  const lonBands = segments;
  // 위도/경도 격자 꼭짓점.
  const grid = [];
  for (let i = 0; i <= latBands; i++) {
    const theta = (i * Math.PI) / latBands; // 0..π (Z 극에서 극으로).
    const st = Math.sin(theta), ct = Math.cos(theta);
    const row = [];
    for (let j = 0; j <= lonBands; j++) {
      const phi = (j * 2 * Math.PI) / lonBands;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      // Z-up: 극축을 Z 로.
      row.push([R * st * cp, R * st * sp, R * ct]);
    }
    grid.push(row);
  }
  const tris = [];
  for (let i = 0; i < latBands; i++) {
    for (let j = 0; j < lonBands; j++) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j + 1];
      const d = grid[i][j + 1];
      // 극 근처는 축퇴 삼각형이 생기지만 STL 상 무해. 두 삼각형으로 분할.
      tris.push(tri(a, b, c));
      tris.push(tri(a, c, d));
    }
  }
  return tris;
}

/**
 * 단위 원뿔: 밑면 ⌀1.0 (반지름 0.5) 가 Z=0, 꼭짓점 (0,0,1).
 *   측면 + 밑면 캡. 바닥 Z=0 규약 준수.
 */
function makeCone(segments) {
  const R = 0.5;
  const apex = [0, 0, 1];
  const center = [0, 0, 0];
  const ring = [];
  for (let j = 0; j < segments; j++) {
    const phi = (j * 2 * Math.PI) / segments;
    ring.push([R * Math.cos(phi), R * Math.sin(phi), 0]);
  }
  const tris = [];
  for (let j = 0; j < segments; j++) {
    const p0 = ring[j];
    const p1 = ring[(j + 1) % segments];
    // 측면 (밖에서 볼 때 CCW).
    tris.push(tri(p0, p1, apex));
    // 밑면 (아래를 향하게, 원점 fan).
    tris.push(tri(p1, p0, center));
  }
  return tris;
}

/**
 * 단위 원기둥: ⌀1.0 (반지름 0.5), Z 0→1.
 *   측면 + 위/아래 캡. 바닥 Z=0 규약 준수.
 */
function makeCylinder(segments) {
  const R = 0.5;
  const bottomC = [0, 0, 0];
  const topC = [0, 0, 1];
  const bottom = [];
  const top = [];
  for (let j = 0; j < segments; j++) {
    const phi = (j * 2 * Math.PI) / segments;
    const x = R * Math.cos(phi), y = R * Math.sin(phi);
    bottom.push([x, y, 0]);
    top.push([x, y, 1]);
  }
  const tris = [];
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    const b0 = bottom[j], b1 = bottom[k];
    const t0 = top[j], t1 = top[k];
    // 측면 (밖에서 CCW).
    tris.push(tri(b0, b1, t1));
    tris.push(tri(b0, t1, t0));
    // 아래 캡 (아래 향함).
    tris.push(tri(b1, b0, bottomC));
    // 위 캡 (위 향함).
    tris.push(tri(t0, t1, topC));
  }
  return tris;
}

function writePart(name, tris) {
  const buf = trianglesToBinaryStl(tris);
  const path = join(OUT_DIR, name);
  writeFileSync(path, Buffer.from(buf));
  console.log(`  ${name}: 삼각형 ${tris.length}개, ${buf.byteLength} bytes`);
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`서포트 부품 STL 생성 (분할 ${SEGMENTS}) → ${OUT_DIR}`);
  writePart("sphere.stl", makeSphere(SEGMENTS));
  writePart("cone.stl", makeCone(SEGMENTS));
  writePart("cylinder.stl", makeCylinder(SEGMENTS));
  console.log("완료.");
}

main();
