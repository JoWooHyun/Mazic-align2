// 슬라이스 미리보기 3D 단면 뚜껑(cap) 채움 헤드리스 검증 (2026-10-23).
//
//   무엇을: src/features/v2/utils/slice-cap-triangulate.ts  triangulateSliceSection(한 메시의 단면 폴리곤들 → nonzero 채움 삼각분할)
//           src/features/v2/utils/slice-render.ts           buildSliceFillMesh(위 결과 → Y 평면 Babylon mesh 하나)
//           src/features/v2/components/babylon/hooks/useSlicePreview.ts  메시마다 fill 하나·정체 표식·B-34 평면 아래 배치(배선)
//   왜: 종전 폴리곤별 fan(point[0] 기준) 은 볼록 단면에서만 맞았다 — 치과 아치처럼 오목한 단면이면 fan 삼각형이 폴리곤 밖으로 넘쳐
//       실제보다 수십 배 큰 흰 판이 그려졌고(리드 실기 10/23 — 398 mm² 단면이 1650 mm², 107 mm² 가 7251 mm²), 속 빈 모델의
//       내벽(반대 감김 내곽)도 별도로 채워 구멍이 메워졌다. 출력 마스크(rasterizePolygons, nonzero)와 같은 의미로 채워야 한다.
//
//   (1) 손으로 만든 도형 — 볼록 사각형 / 오목 U 자 / 도넛(외곽 CCW + 내곽 CW) / 겹친 두 사각형(union) / 떨어진 두 섬 /
//       동심 같은 감김(조립 서포트 — nonzero 감김수 2 → 채움) / 구멍 속 섬 / 전체 CW / 퇴화(점 2개·넓이 0):
//       · 삼각형 넓이 합 = 기대 넓이(±0.1 %)  · 모든 삼각형 무게중심이 nonzero 판정으로 안쪽
//       · 격자 표본점마다 "삼각형이 덮음" ⇔ "감김수 ≠ 0"(경계 근처 제외) — 구멍 안 점을 덮는 삼각형 0 포함
//   (2) 실제 STL 단면 — 리포 밖 파일(리드 PC)이 있으면: 넓이 합 ≈ |shoelace 합|(±0.5 %), 모든 삼각형 무게중심 안쪽(경계 0.1 µm 안은
//       클리퍼 정수 격자 반올림이라 따로 셈). 없으면 SKIP.
//       시간(ms)은 참고 출력만(판정 없음).
//   (2b) 열린(구멍 난) 메시 단면 — 리포 루트 stl모음/(gitignore) 의 infill_model_cut·SUPPORT_sphere 가 있으면: 예외 없음, 넓이 ≤ 단면 bbox,
//       격자 표본 nonzero 넓이와 ±2 %, 무게중심 안쪽. 없으면 SKIP.
//   (3) Babylon 경로 — NullEngine 씬에서 buildSliceFillMesh: 정점 Y 전부 = 넘긴 y, 법선 (0,1,0), 넓이 = (1) 과 같음, 머티리얼·pick 끔,
//       채울 넓이 없으면 null.
//   (4) 배선(소스) — useSlicePreview: buildSliceFillMesh 를 메시마다 한 번(모델·서포트), 정체 표식 2곳, yFill = sliceY − 0.005(B-34) 그대로,
//       deps 그대로. slice-render 에 fan 인덱스 규칙 없음. 옛 buildPolygonFillMesh 를 부르는 곳 없음.
//   (5) 대조군 — a. 삼각분할을 폴리곤별 fan 으로 바꾼 변조본 → U 자·도넛에서 실패  b. nonzero 를 even-odd 로 바꾼 변조본 → 겹친 두
//       사각형·동심 같은 감김에서 실패(2D 마스크와 의미가 갈린다).
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "FAIL" 문자열을 출력한다.
//   실행: npx tsx scripts/verify-slice-cap-fill.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NullEngine, Scene, Color3 } from "@babylonjs/core";

import { triangulateSliceSection } from "../src/features/v2/utils/slice-cap-triangulate.ts";
import { chainSegments, normalizeTriangleWinding, sliceTrianglesAtY } from "../src/features/v2/utils/slice-geometry.ts";
import { buildSliceFillMesh, createSliceFillMaterial } from "../src/features/v2/utils/slice-render.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(SCRIPT_DIR, "..", "src", "features", "v2");

/** 리포 밖 실제 STL(리드 PC). 없으면 (2) 는 SKIP. */
const REAL_STLS = [
  "C:/Users/JoWooHyun/Desktop/정종윤/2023-08-17_00001-001-25-26-27-modelbase.stl",
  "C:/Users/JoWooHyun/Desktop/scan/bae lo 0.4.stl",
];

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ok: ${msg}`);
  else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

// ── 기하 유틸 ────────────────────────────────────────────────────────────

const poly = (pts) => ({ points: pts });
const rect = (x0, y0, x1, y1, ccw = true) =>
  poly(ccw ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]);
const shoelace = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
};

/** 점의 감김수(폴리곤 점 순서 그대로) — rasterizePolygons 와 같은 nonzero 의미. */
function winding(px, py, polys) {
  let w = 0;
  for (const p of polys) {
    const pts = p.points;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if (ay <= py) {
        if (by > py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) > 0) w++;
      } else if (by <= py && (bx - ax) * (py - ay) - (px - ax) * (by - ay) < 0) w--;
    }
  }
  return w;
}

/** 점에서 폴리곤 변까지 최소 거리. */
function edgeDist(px, py, polys) {
  let d = Infinity;
  for (const p of polys) {
    const pts = p.points;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const dx = bx - ax, dy = by - ay;
      const L = dx * dx + dy * dy;
      const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      d = Math.min(d, Math.hypot(ax + t * dx - px, ay + t * dy - py));
    }
  }
  return d;
}

const triList = ({ points, indices }) => {
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 2, b = indices[t + 1] * 2, c = indices[t + 2] * 2;
    out.push([points[a], points[a + 1], points[b], points[b + 1], points[c], points[c + 1]]);
  }
  return out;
};
const triArea = ([ax, ay, bx, by, cx, cy]) => Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
const triCovers = ([ax, ay, bx, by, cx, cy], px, py) => {
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};

// ── (1) 손으로 만든 도형 ─────────────────────────────────────────────────

/**
 * 도형 표. expected = 기대 넓이(mm²), holes = 덮이면 안 되는 점, inside = 덮여야 하는 점.
 * U 자는 fan 기준점(point[0]) 이 바깥 모서리라 fan 이 오목한 틈을 덮는다(대조군 a).
 */
const SHAPES = [
  { name: "볼록 사각형", polys: [rect(0, 0, 10, 5)], expected: 50, inside: [[5, 2.5]] },
  {
    name: "오목 U 자",
    polys: [poly([[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]])],
    expected: 700,
    holes: [[15, 20], [15, 29]],
    inside: [[5, 25], [25, 25], [15, 5]],
  },
  {
    name: "도넛(외곽 CCW + 내곽 CW)",
    polys: [rect(0, 0, 20, 20, true), rect(5, 5, 15, 15, false)],
    expected: 300,
    holes: [[10, 10], [6, 6]],
    inside: [[2, 2], [18, 10]],
  },
  {
    name: "겹친 두 사각형(같은 감김 — union)",
    polys: [rect(0, 0, 10, 10), rect(5, 5, 15, 15)],
    expected: 175,
    inside: [[7.5, 7.5], [2, 2], [13, 13]],
    holes: [[12, 2], [2, 12]],
  },
  {
    name: "떨어진 두 섬",
    polys: [rect(0, 0, 4, 4), rect(10, 0, 16, 3)],
    expected: 16 + 18,
    inside: [[2, 2], [13, 1.5]],
    holes: [[7, 2]],
  },
  {
    name: "동심 같은 감김(조립 서포트 — 감김수 2 → 채움)",
    polys: [rect(0, 0, 20, 20, true), rect(5, 5, 15, 15, true)],
    expected: 400,
    inside: [[10, 10], [2, 2]],
  },
  {
    name: "구멍 속 섬(외곽 CCW · 구멍 CW · 섬 CCW)",
    polys: [rect(0, 0, 30, 30, true), rect(5, 5, 25, 25, false), rect(10, 10, 20, 20, true)],
    expected: 900 - 400 + 100,
    inside: [[15, 15], [2, 2]],
    holes: [[7, 15], [22, 22]],
  },
  {
    name: "전체 CW(뒤집힌 메시) 도넛",
    polys: [rect(0, 0, 20, 20, false), rect(5, 5, 15, 15, true)],
    expected: 300,
    holes: [[10, 10]],
    inside: [[2, 2]],
  },
];

/** 도형 하나 검사 → 실패 항목 문자열 배열(빈 배열 = 통과). */
function checkShape(tri, shape) {
  const res = tri(shape.polys);
  const tris = triList(res);
  const errs = [];
  const area = tris.reduce((s, t) => s + triArea(t), 0);
  if (!(Math.abs(area - shape.expected) <= shape.expected * 0.001)) errs.push(`넓이 ${area.toFixed(3)} ≠ 기대 ${shape.expected}`);
  let outside = 0;
  for (const t of tris) {
    if (triArea(t) < 1e-9) continue;
    const cx = (t[0] + t[2] + t[4]) / 3, cy = (t[1] + t[3] + t[5]) / 3;
    if (winding(cx, cy, shape.polys) === 0) outside++;
  }
  if (outside > 0) errs.push(`무게중심이 바깥인 삼각형 ${outside}개`);
  // 격자 표본 — 경계에서 0.05 mm 넘게 떨어진 점만 비교
  let xs = Infinity, xe = -Infinity, ys = Infinity, ye = -Infinity;
  for (const p of shape.polys) for (const [x, y] of p.points) { xs = Math.min(xs, x); xe = Math.max(xe, x); ys = Math.min(ys, y); ye = Math.max(ye, y); }
  let mismatch = 0, sampled = 0;
  const N = 60;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const px = xs - 1 + ((xe - xs + 2) * (i + 0.37)) / N;
      const py = ys - 1 + ((ye - ys + 2) * (j + 0.61)) / N;
      if (edgeDist(px, py, shape.polys) < 0.05) continue;
      sampled++;
      const covered = tris.some((t) => triCovers(t, px, py));
      if (covered !== (winding(px, py, shape.polys) !== 0)) mismatch++;
    }
  }
  if (mismatch > 0) errs.push(`격자 표본 ${sampled}점 중 덮음 ≠ 감김 판정 ${mismatch}점`);
  for (const [hx, hy] of shape.holes ?? []) {
    const n = tris.filter((t) => triCovers(t, hx, hy)).length;
    if (n > 0) errs.push(`구멍·빈 곳 (${hx}, ${hy}) 을 덮는 삼각형 ${n}개`);
  }
  for (const [ix, iy] of shape.inside ?? []) {
    if (!tris.some((t) => triCovers(t, ix, iy))) errs.push(`안쪽 점 (${ix}, ${iy}) 이 안 덮임`);
  }
  return { errs, area, triCount: tris.length };
}

function sectionShapes() {
  console.log("\n(1) 손으로 만든 도형 — nonzero 채움 삼각분할");
  for (const s of SHAPES) {
    const r = checkShape(triangulateSliceSection, s);
    assert(r.errs.length === 0, `${s.name}: 넓이 ${r.area.toFixed(3)} (기대 ${s.expected}), 삼각형 ${r.triCount}${r.errs.length ? " — " + r.errs.join("; ") : ""}`);
  }
  const degenerate = [
    ["점 2개", [poly([[0, 0], [1, 1]])]],
    ["넓이 0(한 줄)", [poly([[0, 0], [1, 0], [2, 0], [3, 0]])]],
    ["빈 입력", []],
  ];
  for (const [name, polys] of degenerate) {
    const r = triangulateSliceSection(polys);
    assert(r.indices.length === 0, `퇴화 입력 ${name} → 삼각형 0 (${r.indices.length / 3})`);
  }
}

// ── (2) 실제 STL 단면 ────────────────────────────────────────────────────

/** 바이너리 STL → world 삼각형 (Babylon STLFileLoader 처럼 (x, y, z) → (x, z, y)) + 감김 정규화. */
function loadStlWorld(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  if (84 + n * 50 !== buf.length) return null; // ASCII 등은 다루지 않음
  const tri = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let v = 0; v < 3; v++) {
      tri[i * 9 + v * 3] = buf.readFloatLE(o + v * 12);
      tri[i * 9 + v * 3 + 1] = buf.readFloatLE(o + v * 12 + 8);
      tri[i * 9 + v * 3 + 2] = buf.readFloatLE(o + v * 12 + 4);
    }
  }
  return { world: normalizeTriangleWinding(tri), n };
}

function sectionRealStl() {
  console.log("\n(2) 실제 STL 단면 (리포 밖 파일 — 없으면 SKIP)");
  for (const file of REAL_STLS) {
    if (!fs.existsSync(file)) {
      console.log(`  SKIP: ${file} 없음`);
      continue;
    }
    const m = loadStlWorld(file);
    if (!m) {
      console.log(`  SKIP: ${file} 바이너리 STL 아님`);
      continue;
    }
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < m.world.length; i += 3) { minY = Math.min(minY, m.world[i]); maxY = Math.max(maxY, m.world[i]); }
    for (const f of [0.15, 0.5, 0.85]) {
      const y = minY + (maxY - minY) * f;
      const polys = chainSegments(sliceTrianglesAtY(m.world, y));
      const real = Math.abs(polys.reduce((s, p) => s + shoelace(p.points), 0));
      const t0 = performance.now();
      const res = triangulateSliceSection(polys);
      const ms = performance.now() - t0;
      const tris = triList(res);
      const area = tris.reduce((s, t) => s + triArea(t), 0);
      // 모든 삼각형 무게중심. 클리퍼 정수 격자(0.1 µm)로 반올림한 점이라 경계를 따라 붙은 아주 얇은 삼각형은 무게중심이
      // 경계 0.1 µm 안에서 바깥으로 읽힐 수 있다(실측 최대 0.04 µm, 넓이 1e-5 mm² 미만) — 그 거리 안은 "경계 위" 로 따로 센다.
      let outside = 0, onEdge = 0;
      for (const t of tris) {
        const cx = (t[0] + t[2] + t[4]) / 3, cy = (t[1] + t[3] + t[5]) / 3;
        if (winding(cx, cy, polys) !== 0) continue;
        if (edgeDist(cx, cy, polys) <= 1e-4) onEdge++;
        else outside++;
      }
      const pts = polys.reduce((s, p) => s + p.points.length, 0);
      assert(
        real > 0 && Math.abs(area - real) <= real * 0.005 && outside === 0,
        `${path.basename(file)} 높이 ${(f * 100).toFixed(0)}% — 폴리곤 ${polys.length}(점 ${pts}): 삼각분할 넓이 ${area.toFixed(2)} vs |shoelace 합| ${real.toFixed(2)} mm² ` +
          `(오차 ${(((area - real) / real) * 100).toFixed(3)}%), 삼각형 ${tris.length}개 무게중심 바깥 ${outside}(경계 0.1 µm 안 ${onEdge}), 시간 ${ms.toFixed(1)} ms(참고)`,
      );
    }
  }
}

/**
 * (2b) 열린(구멍 난) 메시 — 경계 변이 있어 chainSegments 가 닫히지 않는 사슬을 낼 수 있다(그 사슬은 끝 → 처음을 이어 닫힌 것으로 본다 —
 * rasterizePolygons 와 같다). 예외 없이 돌고, 넓이가 단면 bbox 를 넘지 않으며, 격자 표본으로 센 nonzero 넓이(감김수 ≠ 0 비율 × bbox)와
 * 맞는지(±2 %) — 화면이 터지지 않고 출력 마스크와 같은 의미인지 본다.
 */
const OPEN_STLS = [
  path.resolve(SCRIPT_DIR, "..", "..", "stl모음", "infill_model_cut.stl"),
  path.resolve(SCRIPT_DIR, "..", "..", "stl모음", "SUPPORT_sphere.stl"),
  "C:/Users/JoWooHyun/Documents/MazicAlign/stl모음/infill_model_cut.stl",
  "C:/Users/JoWooHyun/Documents/MazicAlign/stl모음/SUPPORT_sphere.stl",
];

function sectionOpenStl() {
  console.log("\n(2b) 열린 메시 단면 (리포 밖 stl모음 — 없으면 SKIP)");
  const seen = new Set();
  for (const file of OPEN_STLS) {
    const base = path.basename(file);
    if (seen.has(base) || !fs.existsSync(file)) continue;
    seen.add(base);
    const m = loadStlWorld(file);
    if (!m) continue;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < m.world.length; i += 3) { minY = Math.min(minY, m.world[i]); maxY = Math.max(maxY, m.world[i]); }
    for (const f of [0.03, 0.25, 0.5, 0.75, 0.97]) {
      const y = minY + (maxY - minY) * f;
      const segs = sliceTrianglesAtY(m.world, y);
      const polys = chainSegments(segs);
      if (polys.length === 0) continue;
      let res, err = null;
      try {
        res = triangulateSliceSection(polys);
      } catch (e) {
        err = e;
      }
      if (err) {
        assert(false, `${base} 높이 ${(f * 100).toFixed(0)}% — 예외: ${err.message}`);
        continue;
      }
      const tris = triList(res);
      const area = tris.reduce((s, t) => s + triArea(t), 0);
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const p of polys) for (const [x, z] of p.points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const bbox = (x1 - x0) * (z1 - z0);
      const N = 300;
      let hit = 0;
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          if (winding(x0 + ((x1 - x0) * (i + 0.5)) / N, z0 + ((z1 - z0) * (j + 0.5)) / N, polys) !== 0) hit++;
        }
      }
      const sampled = (hit / (N * N)) * bbox;
      let outside = 0;
      for (const t of tris) {
        const cx = (t[0] + t[2] + t[4]) / 3, cz = (t[1] + t[3] + t[5]) / 3;
        if (winding(cx, cz, polys) === 0 && edgeDist(cx, cz, polys) > 1e-4) outside++;
      }
      assert(
        area <= bbox * 1.0001 && Math.abs(area - sampled) <= Math.max(sampled * 0.02, bbox * 0.002) && outside === 0,
        `${base} 높이 ${(f * 100).toFixed(0)}% — 선분 ${segs.length}·폴리곤 ${polys.length}: 뚜껑 ${area.toFixed(1)} mm² ≤ bbox ${bbox.toFixed(1)}, ` +
          `격자 nonzero 넓이 ${sampled.toFixed(1)} (차 ${(((area - sampled) / Math.max(sampled, 1e-9)) * 100).toFixed(2)}%), 무게중심 바깥 ${outside}`,
      );
    }
  }
  if (seen.size === 0) console.log("  SKIP: stl모음 열린 메시 없음");
}

// ── (3) Babylon 경로 ─────────────────────────────────────────────────────

function sectionBabylon() {
  console.log("\n(3) Babylon NullEngine — buildSliceFillMesh");
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mat = createSliceFillMaterial(scene, new Color3(1, 1, 1), "verify_fill");
  const donut = SHAPES.find((s) => s.name.startsWith("도넛"));
  const y = 3.995;
  const mesh = buildSliceFillMesh(scene, donut.polys, y, mat, "v2_slice_model_fill");
  const pos = mesh.getVerticesData("position");
  const nor = mesh.getVerticesData("normal");
  const idx = mesh.getIndices();
  let allY = true, nOk = true;
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i + 1] - y) > 1e-6) allY = false;
    if (nor[i] !== 0 || nor[i + 1] !== 1 || nor[i + 2] !== 0) nOk = false;
  }
  let area = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    area += triArea([pos[a], pos[a + 2], pos[b], pos[b + 2], pos[c], pos[c + 2]]);
  }
  assert(
    allY && nOk && Math.abs(area - 300) < 0.3 && mesh.material === mat && mesh.isPickable === false && mesh.name === "v2_slice_model_fill",
    `도넛 → mesh 하나: 정점 Y 전부 ${y}, 법선 (0,1,0), 넓이 ${area.toFixed(3)} mm² (= 300), 머티리얼·pick 끔·이름`,
  );
  assert(buildSliceFillMesh(scene, [poly([[0, 0], [1, 0], [2, 0]])], y, mat) === null, "채울 넓이 없는 단면 → null (mesh 안 만듦)");
  scene.dispose();
  engine.dispose();
}

// ── (4) 배선(소스) ───────────────────────────────────────────────────────

const read = (...p) => fs.readFileSync(path.join(V2, ...p), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

function sectionWiring() {
  console.log("\n(4) 배선 — useSlicePreview·slice-render");
  const sp = stripComments(read("components", "babylon", "hooks", "useSlicePreview.ts"));
  const sr = stripComments(read("utils", "slice-render.ts"));
  assert(
    /const buildSafe = [\s\S]*?buildSliceFillMesh\(scene, polys, yFill, mat, name\)/.test(sp) &&
      /const fill = buildSafe\(polys, fillMat, "v2_slice_model_fill"\);/.test(sp) &&
      /const fill = buildSafe\(polys, supportFillMat, "v2_slice_support_fill"\);/.test(sp) &&
      !/for \(const p of polys\)/.test(sp),
    "useSlicePreview — 메시마다 buildSliceFillMesh 한 번(모델·서포트), 폴리곤별 루프 없음",
  );
  assert(
    (sp.match(/fill\.metadata = \{ sliceFill: /g) ?? []).length === 2 &&
      /const fillMat = sliceFillMaterialFor\(ctx, tag\) \?\? modelMat;/.test(sp) &&
      /const supportFillMat = sliceFillMaterialFor\(ctx, supportTag\) \?\? supportMat;/.test(sp),
    "2재료 표시 — 정체 표식 2곳·sliceFillMaterialFor 그대로",
  );
  assert(
    /const yFill = sliceY - 0\.005;/.test(sp) && /const yLine = sliceY - 0\.002;/.test(sp) && /\}, \[sliceY, files, supports, supportParams\]\);/.test(sp),
    "B-34 — fill 은 평면 아래(sliceY − 0.005), outline −0.002, deps 그대로",
  );
  assert(
    /triangulateSliceSection\(polygons\)/.test(sr) && !/indices\.push\(0, i, i \+ 1\)/.test(sr) && /mat\.backFaceCulling = false;/.test(sr),
    "slice-render — triangulateSliceSection 사용, fan 인덱스 규칙 없음, 양면 머티리얼",
  );
  const callers = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /buildPolygonFillMesh/.test(stripComments(fs.readFileSync(p, "utf8")))) callers.push(path.relative(V2, p));
    }
  };
  walk(V2);
  assert(callers.length === 0, `옛 buildPolygonFillMesh 를 쓰는 곳 없음 (${callers.join(", ") || "0곳"})`);
}

// ── (5) 대조군 ───────────────────────────────────────────────────────────

/**
 * slice-cap-triangulate.ts 를 문자열 변조해 이 scripts 폴더 아래 임시 폴더에 쓰고 import (끝나면 지운다).
 * 패키지 이름 import(js-clipper·earcut)가 frontend/node_modules 로 풀리도록 frontend 아래에 둔다. 상대 import 는 절대 URL 로.
 */
async function loadMutant(tag, edits, append = "") {
  const srcPath = path.join(V2, "utils", "slice-cap-triangulate.ts");
  let src = fs.readFileSync(srcPath, "utf8");
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`변조 대상 문자열이 소스에 없음 (${tag}): ${from}`);
    src = src.split(from).join(to);
  }
  src += append;
  src = src.replace(/(from\s+)(["'])(\.{1,2}\/[^"']+)\2/g, (m, pre, q, spec) => `${pre}${q}${pathToFileURL(path.resolve(path.dirname(srcPath), spec) + ".ts").href}${q}`);
  const dir = fs.mkdtempSync(path.join(SCRIPT_DIR, `.tmp-verify-slice-cap-fill-${tag}-`));
  const out = path.join(dir, "slice-cap-triangulate.ts");
  fs.writeFileSync(out, src, "utf8");
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 변조본 a — 종전 slice-render 의 폴리곤별 point[0] fan 을 같은 반환 형식으로. */
const FAN_APPEND = `
export function triangulateSliceSection(polygons) {
  const pts = [];
  const idx = [];
  for (const p of polygons) {
    const n = p.points.length;
    if (n < 3) continue;
    const base = pts.length / 2;
    for (const [x, z] of p.points) pts.push(x, z);
    for (let i = 1; i < n - 1; i++) idx.push(base, base + i, base + i + 1);
  }
  return { points: Float64Array.from(pts), indices: Uint32Array.from(idx) };
}
`;

async function sectionControls() {
  console.log("\n(5) 대조군 — 변조본이 실제로 걸리는지");
  const fan = await loadMutant("fan", [["export function triangulateSliceSection(", "function nonzeroTriangulateUnused("]], FAN_APPEND);
  const failsOf = (tri, names) => names.map((n) => [n, checkShape(tri, SHAPES.find((s) => s.name.startsWith(n))).errs]);
  for (const [n, errs] of failsOf(fan.triangulateSliceSection, ["오목 U 자", "도넛"])) {
    assert(errs.length > 0, `a. fan 변조본 → ${n} 실패 (${errs.join("; ") || "통과해 버림"})`);
  }
  // 실제 STL 이 있으면 fan 변조본이 (2) 의 넓이 판정에서도 걸리는지(리드 실기 증상 재현 — 넓이가 몇 배로 부푼다)
  const stl = REAL_STLS.find((f) => fs.existsSync(f));
  const m = stl ? loadStlWorld(stl) : null;
  if (m) {
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < m.world.length; i += 3) { minY = Math.min(minY, m.world[i]); maxY = Math.max(maxY, m.world[i]); }
    const polys = chainSegments(sliceTrianglesAtY(m.world, (minY + maxY) / 2));
    const real = Math.abs(polys.reduce((s, p) => s + shoelace(p.points), 0));
    const area = triList(fan.triangulateSliceSection(polys)).reduce((s, t) => s + triArea(t), 0);
    assert(Math.abs(area - real) > real * 0.005, `a. fan 변조본 → ${path.basename(stl)} 높이 50% 넓이 ${area.toFixed(1)} vs 실제 ${real.toFixed(1)} mm² (×${(area / real).toFixed(2)}) — (2) 판정 실패`);
  } else {
    console.log("  SKIP: 실제 STL 없음 — fan 변조본 실제 단면 대조 생략");
  }
  const evenOdd = await loadMutant("evenodd", [["ClipperLib.PolyFillType.pftNonZero", "ClipperLib.PolyFillType.pftEvenOdd"]]);
  for (const [n, errs] of failsOf(evenOdd.triangulateSliceSection, ["겹친 두 사각형", "동심 같은 감김"])) {
    assert(errs.length > 0, `b. even-odd 변조본 → ${n} 실패 (${errs.join("; ") || "통과해 버림"})`);
  }
  const leftovers = fs.readdirSync(SCRIPT_DIR).filter((f) => f.startsWith(".tmp-verify-slice-cap-fill-"));
  assert(leftovers.length === 0, `임시 변조본 폴더 정리됨 (${leftovers.length})`);
}

async function main() {
  console.log("슬라이스 미리보기 단면 뚜껑 채움 검증 — nonzero(clipper union → earcut), 2D 마스크와 같은 의미");
  sectionShapes();
  sectionRealStl();
  sectionOpenStl();
  sectionBabylon();
  sectionWiring();
  await sectionControls();
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
