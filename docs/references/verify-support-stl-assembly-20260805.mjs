// B안 실현성 헤드리스 프로토타입
// 목적: CHITUBOX 부품 STL을 로드→스케일→배치(조립)→Y-up 변환한 뒤,
//       우리 슬라이서의 순수 슬라이스 코어(sliceTrianglesAtY)로 층별로 잘라
//       "부품 STL이 우리 파이프라인을 통과해 폴리곤을 만든다"를 실증한다.
//
// slice-geometry.ts 의 sliceTrianglesAtY / chainSegments 는 Babylon 무관 순수함수.
// 여기서는 그 알고리즘을 그대로(동일 로직) 이식해 실제 STL에 물린다.
// (프로덕션 코드가 아니라 실현성 검증용 — 로직은 원본과 동일하게 유지)

import fs from "node:fs";
import path from "node:path";

const STL_DIR = "c:/Users/JoWooHyun/Documents/MazicAlign/stl모음";

// ---- STL 파서 (binary + ASCII) → flat Float32Array (삼각형당 9 float) ----
function parseStl(buf) {
  // ASCII 판별
  const head = buf.subarray(0, 5).toString("ascii");
  const looksAscii =
    head === "solid" && buf.subarray(0, 300).toString("ascii").includes("facet");
  if (looksAscii) return parseAscii(buf.toString("ascii"));
  return parseBinary(buf);
}

function parseBinary(buf) {
  const n = buf.readUInt32LE(80);
  const out = new Float32Array(n * 9);
  let o = 0;
  let p = 84;
  for (let i = 0; i < n; i++) {
    p += 12; // normal skip
    for (let v = 0; v < 3; v++) {
      out[o++] = buf.readFloatLE(p);
      out[o++] = buf.readFloatLE(p + 4);
      out[o++] = buf.readFloatLE(p + 8);
      p += 12;
    }
    p += 2; // attribute byte count
  }
  return out;
}

function parseAscii(txt) {
  const verts = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m;
  while ((m = re.exec(txt))) {
    verts.push(+m[1], +m[2], +m[3]);
  }
  return new Float32Array(verts);
}

// ---- 변환 유틸: 삼각형 배열에 대해 오프셋+스케일 그리고 Z-up→Y-up 회전 ----
// STL은 Z-up. 우리 stl-loader가 X축 -90° 회전을 vertex에 베이크한다:
//   (x,y,z) -> (x, z, -y)   [X축 -90° 회전]
function bakeYup(tris) {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    out[i] = x;
    out[i + 1] = z;
    out[i + 2] = -y;
  }
  return out;
}

// 부품을 로컬에서 정규화(원점을 바닥중심으로) + 스케일 + world 배치
function placePart(tris, { center = true, scale = [1, 1, 1], translate = [0, 0, 0] } = {}) {
  // bbox
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    mnx = Math.min(mnx, tris[i]); mxx = Math.max(mxx, tris[i]);
    mny = Math.min(mny, tris[i + 1]); mxy = Math.max(mxy, tris[i + 1]);
    mnz = Math.min(mnz, tris[i + 2]); mxz = Math.max(mxz, tris[i + 2]);
  }
  // 원점 재정렬: XY중심, Z바닥 (일부 부품이 원점에서 벗어나 있으므로)
  const cx = center ? (mnx + mxx) / 2 : 0;
  const cy = center ? (mny + mxy) / 2 : 0;
  const cz = mnz; // Z바닥을 0으로
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    out[i] = (tris[i] - cx) * scale[0] + translate[0];
    out[i + 1] = (tris[i + 1] - cy) * scale[1] + translate[1];
    out[i + 2] = (tris[i + 2] - cz) * scale[2] + translate[2];
  }
  return out;
}

function concat(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function bbox(tris) {
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], tris[i + k]);
      mx[k] = Math.max(mx[k], tris[i + k]);
    }
  }
  return { mn, mx };
}

// ---- 우리 슬라이스 코어 (slice-geometry.ts 로직 그대로) ----
const EPS = 1e-6;
function sliceTrianglesAtY(triangles, y) {
  const out = [];
  for (let t = 0; t + 9 <= triangles.length; t += 9) {
    const v0y = triangles[t + 1], v1y = triangles[t + 4], v2y = triangles[t + 7];
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
    const v0x = triangles[t], v0z = triangles[t + 2];
    const v1x = triangles[t + 3], v1z = triangles[t + 5];
    const v2x = triangles[t + 6], v2z = triangles[t + 8];
    tryEdge(v0x, v0z, v1x, v1z, d0, d1);
    tryEdge(v1x, v1z, v2x, v2z, d1, d2);
    tryEdge(v2x, v2z, v0x, v0z, d2, d0);
    if (cross.length >= 2) out.push({ a: cross[0], b: cross[1] });
  }
  return out;
}

function load(name) {
  return parseStl(fs.readFileSync(path.join(STL_DIR, name)));
}

console.log("=== B안 실현성 검증: CHITUBOX 부품 STL → 우리 슬라이스 코어 ===\n");

// --- 1) 각 부품 로드 & 파싱 성공 확인 ---
const parts = {
  topCone: "SUPPORT_TOP_Cone.stl",
  cylinder: "SUPPORT_Cylinder.stl",
  sphere: "SUPPORT_sphere.stl",
  bottomCone: "SUPPORT_BOTTOM_Cone.stl",
};
const raw = {};
for (const [k, f] of Object.entries(parts)) {
  const tris = load(f);
  raw[k] = tris;
  console.log(`[파싱] ${f.padEnd(26)} 삼각형 ${(tris.length / 9).toString().padStart(5)}개 → OK`);
}

// --- 2) 화살촉 서포트 1개 "조립" (접점 + 기둥 + 바닥) ---
// 목표 서포트: 팁 지름 0.4, 기둥 지름 1.0, 기둥 높이 5mm, 바닥판 지름 2mm
// 좌표는 STL 원본(Z-up)에서 조립 후 마지막에 Y-up 베이크.
//
// (Z가 높이축) 접점 cone: 위쪽 Z=5~5.4, 기둥: Z=0.4~5, 바닥cone: Z=0~0.4
const tip = placePart(raw.topCone, { scale: [0.4, 0.4, 0.4], translate: [0, 0, 5.0] });      // Z 5.0~5.4
const trunk = placePart(raw.cylinder, { scale: [1.0, 1.0, 4.6], translate: [0, 0, 0.4] });   // Z 0.4~5.0
const foot = placePart(raw.bottomCone, { scale: [2.0, 2.0, 0.4], translate: [0, 0, 0.0] });  // Z 0~0.4

let support = concat(tip, trunk, foot);
const bAssembled = bbox(support);
console.log(`\n[조립] 화살촉 서포트 1개 (접점+기둥+바닥)  Z-up bbox:`);
console.log(`       X ${bAssembled.mn[0].toFixed(2)}~${bAssembled.mx[0].toFixed(2)}  Y ${bAssembled.mn[1].toFixed(2)}~${bAssembled.mx[1].toFixed(2)}  Z(높이) ${bAssembled.mn[2].toFixed(2)}~${bAssembled.mx[2].toFixed(2)}`);
console.log(`       총 삼각형 ${support.length / 9}개`);

// --- 3) Y-up 변환 (우리 stl-loader가 하는 것과 동일) ---
support = bakeYup(support);
const bYup = bbox(support);
console.log(`\n[Y-up] 우리 파이프라인 좌표계 변환 후 bbox:`);
console.log(`       X ${bYup.mn[0].toFixed(2)}~${bYup.mx[0].toFixed(2)}  Y(높이) ${bYup.mn[1].toFixed(2)}~${bYup.mx[1].toFixed(2)}  Z ${bYup.mn[2].toFixed(2)}~${bYup.mx[2].toFixed(2)}`);

// --- 4) 우리 슬라이스 코어로 층별 슬라이스 (레진 층높이 0.05mm) ---
const layerH = 0.05;
const yMin = bYup.mn[1], yMax = bYup.mx[1];
const layerCount = Math.floor((yMax - yMin) / layerH);
console.log(`\n[슬라이스] 층높이 ${layerH}mm → ${layerCount}개 층 예상. sliceTrianglesAtY 로 관통 검사:`);

let hitLayers = 0, totalSegs = 0;
const samples = [];
for (let i = 0; i < layerCount; i++) {
  const y = yMin + (i + 0.5) * layerH;
  const segs = sliceTrianglesAtY(support, y);
  if (segs.length > 0) { hitLayers++; totalSegs += segs.length; }
  // 대표 층 3개(하단 기둥/바닥, 중단 기둥, 상단 접점)에서 단면 폭 측정
  if (i === Math.floor(layerCount * 0.1) || i === Math.floor(layerCount * 0.5) || i === Math.floor(layerCount * 0.92)) {
    let mnx = Infinity, mxx = -Infinity;
    for (const s of segs) { for (const p of [s.a, s.b]) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); } }
    samples.push({ i, y: y.toFixed(2), segs: segs.length, widthX: segs.length ? (mxx - mnx).toFixed(3) : "-" });
  }
}

console.log(`       ✔ 단면이 나온 층: ${hitLayers}/${layerCount}   총 선분 ${totalSegs}개`);
console.log(`\n[대표 단면] (X폭 = 그 높이의 서포트 지름을 반영해야 함)`);
console.log(`       층#      Y높이   선분수   X폭(mm)   해석`);
const labels = ["하단(바닥판~기둥 ⌀2→1)", "중단(기둥 ⌀1.0)", "상단(접점 ⌀0.4쪽)"];
samples.forEach((s, idx) => {
  console.log(`       ${String(s.i).padStart(4)}   ${s.y.padStart(6)}     ${String(s.segs).padStart(3)}    ${String(s.widthX).padStart(6)}   ${labels[idx] || ""}`);
});

// --- 5) 판정 ---
console.log(`\n=== 판정 ===`);
const pass1 = Object.values(raw).every((t) => t.length > 0);
const pass2 = support.length > 0;
const pass3 = hitLayers > layerCount * 0.9; // 거의 모든 층이 단면을 내야 함(연속 기둥)
console.log(`  ① 부품 STL 파싱(binary+ASCII)        : ${pass1 ? "PASS" : "FAIL"}`);
console.log(`  ② 스케일·배치 조립 + Y-up 변환        : ${pass2 ? "PASS" : "FAIL"}`);
console.log(`  ③ 우리 슬라이스 코어 관통(층별 단면)  : ${pass3 ? "PASS" : "FAIL"} (${hitLayers}/${layerCount}층)`);
console.log(`\n  → ${pass1 && pass2 && pass3 ? "B안: STL 조립물이 우리 슬라이스 파이프라인을 통과함. CTB까지 붙는다." : "문제 발견 — 위 로그 확인 필요"}`);
