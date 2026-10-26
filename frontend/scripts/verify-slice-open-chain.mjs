// 열린 메시 단면 사슬 잇기 헤드리스 검증 — chainSegments 의 열린 체인 대비 경로(chainSegmentsByEdges).
//
//   배경 (2026-10-23 리드 실기): 치과 부분 틀니 `partial denture (1).stl`(경계 변 740 — 열린 메시, 구멍·이음매가 392/518 층을
//     지난다) + 레거시 자동 서포트, Task0 단일 재료 lh 0.05 → "얇은 부분 채움 실패" 층 271. 경로 미리보기에서 단면 아래쪽만
//     도포되고 위(+Y)의 양쪽 벽·서포트 단면은 도포가 전혀 없었다.
//   원인: 열린 메시의 층 윤곽은 머리(들어오는 선분 없음)→꼬리(나가는 선분 없음) 열린 체인인데, 수정 전 chainSegments 는 점 단위
//     순회를 out.keys() 순서대로 시작해 체인 **가운데**에서 출발하는 일이 많았다 — 체인을 여러 조각으로 끊고 조각마다 끝→처음
//     가짜 현으로 닫아(층 270: 폴리곤 13개 전부 가짜 현, 실제 열린 체인은 4개) 벽 안팎을 가로지르는 현이 가는 띠를 만들었다.
//     writer 의 얇은 부분 채움이 그 띠에서 노즐을 칠한 비드 사이에 가둬 그 뒤(+Y) 항목 전부가 "경로 없음"(층 270 기본 계획:
//     띠 0~16 만 도포, 144 항목 경로 없음)이 됐다. 같은 단면이 노광 마스크(워커)·Task0 마스크에도 쓰인다.
//   수정: 점 단위 순회가 끊긴 폴리곤을 하나라도 내는 층만 chainSegmentsByEdges 로 다시 잇는다 — 열린 체인 머리부터, 선분 단위
//     소비(만나는 점을 두 번 지날 수 있음), 열린 걸음은 꼬리에서 가장 가까운 머리로(자기 머리면 닫음). 모든 폴리곤이 닫힌 층은
//     수정 전 결과 그대로(같은 코드 경로).
//
//   단언:
//     (a) 닫힌 입력 불변 — 예제 정육면체·구(lh 0.05), 무작위 상자 60개, 속 빈 상자·겹친 상자(한 메시), 기본 서포트 1개
//         (support/parts 조립): 모든 층에서 수정 전 함수(이 파일의 chainSegmentsBefore — feefd1c 그대로 복제)와 결과가 JSON 동일,
//         수정 전 결과에 끊긴 폴리곤 0 (= 말뭉치가 정말 닫힌 입력).
//     (b) 합성 열린 입력 (선분·메시) — 새 구현 / 수정 전 / 변조본(가까운 머리 잇기 끔 = 자기 현만):
//         b1 한 변이 빠진 정사각형, 선분을 체인 가운데부터 나열: 새 = 폴리곤 1개·가짜 현 1개·면적 100. 수정 전 = 조각 2개(FAIL 해야 함)
//         b2 머리 없는 닫힌 입력의 만나는 점(들어옴·나감 2) — **이번에는 손대지 않음**(닫힌 메시 바이트 보존): 8자 두 정사각형과
//            verify-task0-export 의 나선 벽(한 메시 안 맞닿은 상자 7개, 층 9) 단면이 수정 전과 JSON 동일. 수정 전 결과에 가짜 현이 있음을
//            숫자로 남긴다(나선 벽 nonzero 면적 약 10.28 vs 상자 합집합 8.560 mm² — 별도 결정 대상). 열린 머리가 있는 층 안의 만나는 점은
//            b3·c 가 함께 본다(치과 층 270·271).
//         b3 캡 없는 아치 벽 3조각(이음매·다리 끝 모두 열림, 삼각형 순서 섞음 — 씨앗 5개, lh 0.1 20층): 층마다 nonzero 면적 =
//            같은 꼭짓점의 닫힌 아치(한 조각 + 양 끝 캡) 단면 (±0.02 mm²). 수정 전·자기 현 변조본은 어긋나야 한다(자기 현은 아치 바깥·안쪽 윤곽을 각자 닫아 내강을 가로지르는 띠).
//         b4 같은 아치(씨앗 1) writer(앱 빌트인 Task0 프로파일): 새 = 얇은 부분 채움 층 0·실패 0 (닫힌 메시와 같음),
//            수정 전 단면(변조 writer) = 채움 층 20 (가짜 띠마다 채움 — 대조군)
//     (c) 실제 STL (리포 밖 — 없으면 SKIP): 환경변수 DENTURE_STL 또는
//         C:/Users/JoWooHyun/Documents/Task0_inbox/20261023_partial_denture/partial_denture_1.stl.
//         배치 = STL (x,y,z) → world (x,z,y), XZ 가운데, 바닥 Y 5(리프트), lh 0.05, 앱 빌트인 Task0 프로파일 writer.
//         c1 모델만: 새 = thinFillFailedLayers [] / 수정 전 단면 = [270, 271, 274]
//         c2 + 레거시 자동 서포트 근사(support/utils/auto-generate.ts — 4 mm 격자, 아래→위 첫 hit, 오버행 45°, 접점 0.3 mm 안쪽,
//            회전체 16각 바닥 ⌀1.5 →(3.0) ⌀0.8 … ⌀0.8 →(1.0) 팁 ⌀0.4): 새 = [] / 수정 전 = [271] (리드 화면과 같은 층)
//
//   판정은 **exit code** 로 — 대조군 단언 레이블에도 "실패" 같은 단어가 들어간다.
//   실행: npx tsx scripts/verify-slice-open-chain.mjs   (c 는 1~2분 — 수정 전 단면 writer 가 갇힌 층에서 오래 돈다)
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assembleVerticalSupport } from "../src/features/v2/support/assemble-core.ts";
import { chainSegments, normalizeTriangleWinding, sliceTrianglesAtY } from "../src/features/v2/utils/slice-geometry.ts";
import { SAMPLE_MODELS } from "../src/features/v2/utils/sample-models.ts";
import { generateTask0Gcode } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import { TASK0_BUILT_IN_PROFILE, task0WriterOptionsForProfile } from "../src/features/v2/utils/task0/task0-profile.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(SCRIPT_DIR, "..", "src", "features", "v2");
const UTILS = path.join(V2, "utils");
const TASK0_SRC = path.join(UTILS, "task0");
const PARTS = path.join(V2, "support", "parts");
const DENTURE_DEFAULT = "C:/Users/JoWooHyun/Documents/Task0_inbox/20261023_partial_denture/partial_denture_1.stl";
const WRITER_OPTS = task0WriterOptionsForProfile(TASK0_BUILT_IN_PROFILE);

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}
const json = (v) => JSON.stringify(v);

// ── 수정 전 chainSegments (feefd1c 그대로 — 점 단위 순회만). verify-slice-chain (h) 대조군도 이것을 쓴다 ──
export function chainSegmentsBefore(segs) {
  const QUANT = 1000;
  const idMap = new Map();
  const points = [];
  const qkey = (p) => `${Math.round(p[0] * QUANT)}_${Math.round(p[1] * QUANT)}`;
  const ensureId = (p) => {
    const k = qkey(p);
    let id = idMap.get(k);
    if (id === undefined) {
      id = points.length;
      idMap.set(k, id);
      points.push(p);
    }
    return id;
  };
  const out = new Map();
  for (const s of segs) {
    const ia = ensureId(s.a);
    const ib = ensureId(s.b);
    if (ia === ib) continue;
    if (!out.has(ia)) out.set(ia, []);
    out.get(ia).push(ib);
  }
  const visited = new Set();
  const polygons = [];
  for (const startId of out.keys()) {
    if (visited.has(startId)) continue;
    const polygon = [];
    let curr = startId;
    let safety = out.size + 4;
    while (safety-- > 0) {
      visited.add(curr);
      polygon.push(points[curr]);
      const succs = out.get(curr) ?? [];
      let next = -1;
      for (const n of succs) {
        if (n === startId && polygon.length > 2) {
          next = n;
          break;
        }
        if (!visited.has(n)) {
          next = n;
          break;
        }
      }
      if (next === -1 || next === startId) break;
      curr = next;
    }
    if (polygon.length >= 3) polygons.push({ points: polygon });
  }
  return polygons;
}

// ── 변조본 로더 (소스 문자열 치환 → 임시 폴더, 상대 import 는 원본 절대 URL) ──
let TMP = null;
const AT_FALLBACK = "  if (!openAccepted) return polygons;";
const AT_STITCH = "        if (dj < bestD) {";

function writeMutant(name, src) {
  if (TMP === null) {
    TMP = fs.mkdtempSync(path.join(os.tmpdir(), "verify-slice-open-chain-"));
    process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));
  }
  const file = path.join(TMP, name);
  fs.writeFileSync(file, src, "utf8");
  return pathToFileURL(file).href;
}
function mutateSliceGeometry(tag, from, to) {
  const src = fs.readFileSync(path.join(UTILS, "slice-geometry.ts"), "utf8");
  if (!src.includes(from)) throw new Error(`변조 대상 문자열이 소스에 없음 (${tag}): ${from}`);
  return writeMutant(`slice-geometry.${tag}.ts`, src.replace(from, to));
}
/** 수정 전 단면(끊긴 폴리곤도 그대로)을 쓰는 writer — slice-geometry → task0-slice → writer 사슬을 변조본으로 */
async function loadBeforeWriter() {
  const sg = mutateSliceGeometry("before", AT_FALLBACK, "  return polygons;");
  const rel = (src) => src.replace(/from '\.\/([^']+)'/g, (_, p) => `from '${pathToFileURL(path.join(TASK0_SRC, `${p}.ts`)).href}'`);
  const slice = fs.readFileSync(path.join(TASK0_SRC, "task0-slice.ts"), "utf8");
  if (!slice.includes("from '../slice-geometry'")) throw new Error("task0-slice import 문자열이 바뀜");
  const sliceUrl = writeMutant("task0-slice.before.ts", rel(slice.replace("from '../slice-geometry'", `from '${sg}'`)));
  const writer = fs.readFileSync(path.join(TASK0_SRC, "task0-gcode-writer.ts"), "utf8");
  if (!writer.includes("from './task0-slice'")) throw new Error("writer import 문자열이 바뀜");
  const wUrl = writeMutant("task0-gcode-writer.before.ts", rel(writer.replace("from './task0-slice'", `from '${sliceUrl}'`)));
  return import(wUrl);
}

// ── 판정 도구 ────────────────────────────────────────────────────────────

const qk = (p) => `${Math.round(p[0] * 1000)}_${Math.round(p[1] * 1000)}`;
/** 폴리곤 이웃 두 점(마지막→첫 점 포함) 중 입력 선분(1 µm 키 유방향)이 아닌 것 = 가짜 현 수 */
function fakeChords(polys, segs) {
  const keys = new Set(segs.map((s) => `${qk(s.a)}>${qk(s.b)}`));
  let n = 0;
  for (const { points: P } of polys) {
    for (let i = 0; i < P.length; i++) if (!keys.has(`${qk(P[i])}>${qk(P[(i + 1) % P.length])}`)) n++;
  }
  return n;
}
/** nonzero 채움 면적 (mm², 행 간격 dy 의 중점 적분) */
function nonzeroArea(polys, dy = 0.004) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const { points } of polys) for (const p of points) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  if (!(y1 > y0)) return 0;
  let area = 0;
  for (let y = y0 + dy / 2; y < y1; y += dy) {
    const hits = [];
    for (const { points: P } of polys) {
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        if (a[1] === b[1]) continue;
        const lo = a[1] < b[1] ? a : b;
        const hi = a[1] < b[1] ? b : a;
        if (y < lo[1] || y >= hi[1]) continue;
        hits.push({ x: lo[0] + ((y - lo[1]) * (hi[0] - lo[0])) / (hi[1] - lo[1]), d: a[1] < b[1] ? 1 : -1 });
      }
    }
    hits.sort((p, q) => p.x - q.x);
    let wn = 0;
    for (let k = 0; k < hits.length; k++) {
      if (wn !== 0 && k > 0) area += (hits[k].x - hits[k - 1].x) * dy;
      wn += hits[k].d;
    }
  }
  return area;
}

// ── 지오메트리 ───────────────────────────────────────────────────────────

function boxTris(min, max, flip = false) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const faces = [[0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7], [1, 2, 6], [1, 6, 5]];
  const out = [];
  for (const f of faces) for (const k of flip ? [f[0], f[2], f[1]] : f) out.push(...v[k]);
  return out;
}

/** 경로(XZ 점들) 양옆 오프셋 (두께 t) — 경로 전체에서 한 번 계산해 조각끼리 이음매 꼭짓점이 비트까지 같게 */
function offsets(pts, t) {
  const n = pts.length;
  const L = [];
  const R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz);
    const nx = -dz / l;
    const nz = dx / l;
    L.push([pts[i][0] + (nx * t) / 2, pts[i][1] + (nz * t) / 2]);
    R.push([pts[i][0] - (nx * t) / 2, pts[i][1] - (nz * t) / 2]);
  }
  return { L, R };
}

/** 오프셋 i0~i1 구간 벽 조각 (높이 y0~y1) — caps 면 양 끝 캡, 아니면 열림. 바깥 법선 감김 */
function wallPiece(L, R, i0, i1, y0, y1, caps) {
  const tri = [];
  const q = (a, b, c, d) => tri.push(...a, ...b, ...c, ...a, ...c, ...d);
  const P = (p, y) => [p[0], y, p[1]];
  for (let i = i0; i < i1; i++) {
    q(P(L[i], y0), P(L[i], y1), P(L[i + 1], y1), P(L[i + 1], y0));
    q(P(R[i + 1], y0), P(R[i + 1], y1), P(R[i], y1), P(R[i], y0));
    q(P(L[i], y1), P(R[i], y1), P(R[i + 1], y1), P(L[i + 1], y1));
    q(P(L[i + 1], y0), P(R[i + 1], y0), P(R[i], y0), P(L[i], y0));
  }
  if (caps) {
    q(P(R[i0], y0), P(R[i0], y1), P(L[i0], y1), P(L[i0], y0));
    q(P(L[i1], y0), P(L[i1], y1), P(R[i1], y1), P(R[i1], y0));
  }
  return tri;
}

/**
 * 아치(바깥으로 기운 양 다리 + 위가 볼록한 호) 벽, 두께 3, 높이 5~7.
 * closed = 한 조각 + 양 끝 캡(닫힌 메시 — 기준), 아니면 3조각·캡 전혀 없음(이음매·다리 끝 모두 열림 — 열린 체인)
 */
function archTris(closed) {
  const path0 = [];
  for (let i = 0; i <= 12; i++) path0.push([-10 - 0.25 * (12 - i), -14 + i]); // 다리는 바깥으로 기울어 끝 단면이 비스듬 — 바깥·안쪽 윤곽 끝의 Z 가 달라 자기 현이면 내강에 띠
  for (let i = 1; i < 40; i++) {
    const a = Math.PI - (Math.PI * i) / 40;
    path0.push([10 * Math.cos(a), -2 + 13 * Math.sin(a)]);
  }
  for (let i = 0; i <= 12; i++) path0.push([10 + 0.25 * i, -2 - i]);
  const { L, R } = offsets(path0, 3);
  const last = path0.length - 1;
  if (closed) return wallPiece(L, R, 0, last, 5, 7, true);
  const per = Math.ceil(last / 3);
  let tri = [];
  for (let k = 0; k < 3; k++) tri = tri.concat(wallPiece(L, R, k * per, Math.min(last, (k + 1) * per), 5, 7, false));
  return tri;
}

function shuffleTris(a, seed) {
  const n = a.length / 9;
  const idx = [...Array(n).keys()];
  let s = seed;
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.flatMap((k) => a.slice(k * 9, k * 9 + 9));
}

function parseBinaryStl(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  let off = 84;
  let pi = 0;
  for (let t = 0; t < count; t++) {
    off += 12;
    for (let v = 0; v < 9; v++) positions[pi++] = dv.getFloat32(off + v * 4, true);
    off += 38;
  }
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}

async function sampleWorldTris(id) {
  const def = SAMPLE_MODELS.find((m) => m.id === id);
  const buf = await def.build().arrayBuffer();
  const dv = new DataView(buf);
  const n = dv.getUint32(80, true);
  const t = new Float32Array(n * 9);
  const toWorld = [0, 2, 1];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 9; k++) t[i * 9 + (k - (k % 3)) + toWorld[k % 3]] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
  }
  return normalizeTriangleWinding(t);
}

function meshTopY(tris) {
  let m = -Infinity;
  for (let i = 1; i < tris.length; i += 3) m = Math.max(m, tris[i]);
  return m;
}

// ── (a) 닫힌 입력 불변 ───────────────────────────────────────────────────

async function sectionClosed() {
  console.log("\n(a) 닫힌 입력 — 수정 전 함수와 결과 동일");
  const corpus = [
    ["예제 정육면체 cube20", await sampleWorldTris("cube20")],
    ["예제 구 sphere20", await sampleWorldTris("sphere20")],
    ["속 빈 상자(한 메시)", normalizeTriangleWinding(new Float32Array([...boxTris([0, 0, 0], [10, 4, 10]), ...boxTris([2, 0.5, 2], [8, 3.5, 8], true)]))],
    ["겹친 상자(한 메시)", normalizeTriangleWinding(new Float32Array([...boxTris([0, 0, 0], [6, 3, 6]), ...boxTris([3, 1, 3], [9, 4, 9])]))],
    ["아치 벽(닫힌 메시)", normalizeTriangleWinding(new Float32Array(archTris(true)))],
  ];
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 60; i++) {
    const x = Math.round(rnd() * 200) / 10;
    const z = Math.round(rnd() * 200) / 10;
    const y = Math.round(rnd() * 30) / 10;
    corpus.push([`상자 ${i}`, normalizeTriangleWinding(new Float32Array(boxTris([x, y, z], [x + 0.3 + Math.round(rnd() * 80) / 10, y + 0.5 + Math.round(rnd() * 40) / 10, z + 0.3 + Math.round(rnd() * 80) / 10])))]);
  }
  const parts = {
    sphere: parseBinaryStl(fs.readFileSync(path.join(PARTS, "sphere.stl"))),
    cone: parseBinaryStl(fs.readFileSync(path.join(PARTS, "cone.stl"))),
    cylinder: parseBinaryStl(fs.readFileSync(path.join(PARTS, "cylinder.stl"))),
  };
  const geo = assembleVerticalSupport(parts, {
    tipDiameterMm: 0.4, headBackDiameterMm: 1.0, headLengthMm: 1.0, contactPenetrationMm: 0.2,
    trunkDiameterMm: 0.8, baseDiameterMm: 1.5, baseTransitionMm: 3.0, surfaceY: 5, baseY: 0,
  });
  const sup = new Float32Array(geo.indices.length * 3);
  for (let i = 0; i < geo.indices.length; i++) for (let k = 0; k < 3; k++) sup[i * 3 + k] = geo.positions[geo.indices[i] * 3 + k];
  corpus.push(["기본 서포트 1개(부품 조립)", normalizeTriangleWinding(sup)]);

  let layers = 0;
  let same = 0;
  let openBefore = 0;
  const diffs = [];
  for (const [label, tris] of corpus) {
    const top = meshTopY(tris);
    for (let n = 0; (n + 0.5) * 0.05 < top; n++) {
      const segs = sliceTrianglesAtY(tris, (n + 0.5) * 0.05);
      if (segs.length === 0) continue;
      layers++;
      const before = chainSegmentsBefore(segs);
      if (fakeChords(before, segs) > 0) openBefore++;
      if (json(before) === json(chainSegments(segs))) same++;
      else if (diffs.length < 3) diffs.push(`${label} 층 ${n}`);
    }
  }
  assert(layers > 2000 && openBefore === 0, `말뭉치 ${corpus.length}개 메시 ${layers}층 — 수정 전 결과에 가짜 현 있는 층 ${openBefore} (닫힌 입력)`);
  assert(same === layers, `수정 전 함수와 JSON 동일 ${same}/${layers}층${diffs.length ? ` — 다름: ${diffs.join(", ")}` : ""}`);
}

// ── (b) 합성 열린 입력 ───────────────────────────────────────────────────

async function sectionSynthetic(noStitch, beforeWriter) {
  console.log("\n(b) 합성 열린 입력 — 새 구현 / 수정 전 / 자기 현 변조본");
  const impls = { 새: chainSegments, "수정 전": chainSegmentsBefore, 자기현: noStitch };

  // b1 한 변(x=0)이 빠진 정사각형 (반시계, 변마다 2조각) — 선분을 오른쪽 변 가운데부터
  const ring = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10]];
  const u = [];
  for (let i = 0; i + 1 < ring.length; i++) u.push({ a: ring[i], b: ring[i + 1] });
  const b1segs = [...u.slice(3), ...u.slice(0, 3)];
  const b1 = Object.fromEntries(Object.entries(impls).map(([k, f]) => [k, f(b1segs)]));
  assert(b1.새.length === 1 && fakeChords(b1.새, b1segs) === 1 && Math.abs(nonzeroArea(b1.새) - 100) < 0.05,
    `b1 한 변 빠진 정사각형: 새 = 폴리곤 ${b1.새.length}·가짜 현 ${fakeChords(b1.새, b1segs)}·면적 ${nonzeroArea(b1.새).toFixed(2)} (기대 1·1·100)`);
  assert(b1["수정 전"].length >= 2 && fakeChords(b1["수정 전"], b1segs) >= 2,
    `b1 대조군 수정 전: 조각 ${b1["수정 전"].length}·가짜 현 ${fakeChords(b1["수정 전"], b1segs)} (체인 가운데서 끊김 — 새 구현 단언이 실패해야 할 입력)`);

  // b2 머리 없는 닫힌 입력의 만나는 점 — 수정 전과 같아야 한다(손대지 않음). 8자: 두 정사각형이 (1,1) 에서 만남
  const sq = (x, y) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
  const loop = (p) => p.map((a, i) => ({ a, b: p[(i + 1) % p.length] }));
  const s1 = loop(sq(0, 0));
  const s2 = loop(sq(1, 1));
  const b2segs = [s1[0], s1[1], ...s2, s1[2], s1[3]];
  const spiral = normalizeTriangleWinding(new Float32Array([
    ...boxTris([-4, 0, -4], [4, 1, -3.8]), ...boxTris([3.8, 0, -4], [4, 1, 4]), ...boxTris([-4, 0, 3.8], [4, 1, 4]),
    ...boxTris([-4, 0, -2], [-3.8, 1, 4]), ...boxTris([-4, 0, -2], [2, 1, -1.8]), ...boxTris([1.8, 0, -2], [2, 1, 2]),
    ...boxTris([-2, 0, 1.8], [2, 1, 2]),
  ]));
  const spSegs = sliceTrianglesAtY(spiral, 0.95);
  const same8 = json(chainSegments(b2segs)) === json(chainSegmentsBefore(b2segs));
  const sameSp = json(chainSegments(spSegs)) === json(chainSegmentsBefore(spSegs));
  const spBefore = chainSegmentsBefore(spSegs);
  assert(same8 && sameSp && fakeChords(chainSegmentsBefore(b2segs), b2segs) > 0 && fakeChords(spBefore, spSegs) > 0,
    `b2 머리 없는 닫힌 입력(8자·나선 벽 층 9): 수정 전과 동일 ${same8}·${sameSp} — 수정 전에도 있던 가짜 현 ${fakeChords(spBefore, spSegs)}개, ` +
      `나선 벽 면적 ${nonzeroArea(spBefore).toFixed(3)} mm² (상자 합집합 8.560 — 손대지 않은 기존 결함, 보고 대상)`);

  // b3 캡 없는 아치 벽 3조각 — 층 면적 = 같은 꼭짓점의 닫힌 아치 단면
  const closedTris = normalizeTriangleWinding(new Float32Array(archTris(true)));
  const openRaw = archTris(false);
  const worst = { 새: 0, "수정 전": 0, 자기현: 0 };
  for (const seed of [1, 2, 3, 4, 5]) {
    const open = normalizeTriangleWinding(new Float32Array(shuffleTris(openRaw, seed)));
    for (let n = 0; n < 20; n++) {
      const y = 5 + (n + 0.5) * 0.1;
      const ref = nonzeroArea(chainSegments(sliceTrianglesAtY(closedTris, y)));
      const segs = sliceTrianglesAtY(open, y);
      for (const [k, f] of Object.entries(impls)) worst[k] = Math.max(worst[k], Math.abs(nonzeroArea(f(segs)) - ref));
    }
  }
  assert(worst.새 < 0.02, `b3 열린 아치(씨앗 5 × 20층): 새 구현 면적 최대 오차 ${worst.새.toFixed(4)} mm² (< 0.02, 기준 = 같은 꼭짓점의 닫힌 아치)`);
  assert(worst["수정 전"] > 1, `b3 대조군 수정 전: 최대 오차 ${worst["수정 전"].toFixed(2)} mm² (가짜 현 조각)`);
  assert(worst.자기현 > 1, `b3 대조군 자기 현 변조본(가까운 머리 잇기 끔): 최대 오차 ${worst.자기현.toFixed(2)} mm² (내강을 가로지르는 띠)`);

  // b4 writer — 열린 아치(씨앗 1)
  const open1 = normalizeTriangleWinding(new Float32Array(shuffleTris(openRaw, 1)));
  const tNew = generateTask0Gcode([open1], 7, 0.1, WRITER_OPTS).totals;
  const tClosed = generateTask0Gcode([closedTris], 7, 0.1, WRITER_OPTS).totals;
  const tBefore = beforeWriter.generateTask0Gcode([open1], 7, 0.1, WRITER_OPTS).totals;
  assert(tNew.thinFillLayers.length === tClosed.thinFillLayers.length && tNew.thinFillLayers.length === 0 && tNew.thinFillFailedLayers.length === 0 && tNew.emptyLayers.length === tClosed.emptyLayers.length,
    `b4 writer 열린 아치: 새 = 채움 층 ${tNew.thinFillLayers.length}·실패 ${tNew.thinFillFailedLayers.length} (닫힌 메시 채움 층 ${tClosed.thinFillLayers.length})`);
  assert(tBefore.thinFillLayers.length >= 10,
    `b4 대조군 수정 전 단면 writer: 채움 층 ${tBefore.thinFillLayers.length} (가짜 띠마다 얇은 부분 채움)`);
}

// ── (c) 실제 STL ─────────────────────────────────────────────────────────

function loadDenture(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  const tri = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let v = 0; v < 3; v++) {
      tri[i * 9 + v * 3] = buf.readFloatLE(o + v * 12);
      tri[i * 9 + v * 3 + 1] = buf.readFloatLE(o + v * 12 + 8); // world Y = STL Z
      tri[i * 9 + v * 3 + 2] = buf.readFloatLE(o + v * 12 + 4); // world Z = STL Y
    }
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tri.length; i++) {
    const a = i % 3;
    min[a] = Math.min(min[a], tri[i]);
    max[a] = Math.max(max[a], tri[i]);
  }
  const off = [-(min[0] + max[0]) / 2, 5 - min[1], -(min[2] + max[2]) / 2];
  for (let i = 0; i < tri.length; i++) tri[i] += off[i % 3];
  return { model: normalizeTriangleWinding(tri), topY: max[1] + off[1] };
}

/** 레거시 자동 서포트 근사 — 격자 칸 중심에서 아래→위 첫 hit(가장 낮은 삼각형), 오버행이면 접점 */
function legacySupports(model) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < model.length; i += 3) {
    x0 = Math.min(x0, model[i]); x1 = Math.max(x1, model[i]);
    z0 = Math.min(z0, model[i + 2]); z1 = Math.max(z1, model[i + 2]);
  }
  const step = 4;
  const cos45 = Math.cos(Math.PI / 4);
  const out = [];
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let z = z0 + step / 2; z < z1; z += step) {
      let best = null;
      for (let t = 0; t + 9 <= model.length; t += 9) {
        const ax = model[t], ay = model[t + 1], az = model[t + 2];
        const bx = model[t + 3], by = model[t + 4], bz = model[t + 5];
        const cx = model[t + 6], cy = model[t + 7], cz = model[t + 8];
        if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue;
        const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
        if (Math.abs(d) < 1e-15) continue;
        const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
        const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const y = l1 * ay + l2 * by + l3 * cy;
        if (best !== null && y >= best.y) continue;
        const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nrm = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
        const L = Math.hypot(...nrm) || 1;
        best = { y, n: nrm.map((c) => c / L) };
      }
      if (best === null || best.n[1] > -cos45 || best.y <= 0.5) continue;
      const PEN = 0.3;
      out.push(frustumStack(x - best.n[0] * PEN, z - best.n[2] * PEN, best.y - best.n[1] * PEN));
    }
  }
  return out;
}

function frustumStack(cx, cz, top, sides = 16) {
  const rings = [[0, 0.75], [3.0, 0.4], [Math.max(3.0, top - 1.0), 0.4], [top, 0.2]];
  const P = (y, r, k) => [cx + r * Math.cos((2 * Math.PI * k) / sides), y, cz + r * Math.sin((2 * Math.PI * k) / sides)];
  const out = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const [ya, ra] = rings[i];
    const [yb, rb] = rings[i + 1];
    for (let k = 0; k < sides; k++) out.push(...P(ya, ra, k), ...P(yb, rb, k + 1), ...P(ya, ra, k + 1), ...P(ya, ra, k), ...P(yb, rb, k), ...P(yb, rb, k + 1));
  }
  const [y0, r0] = rings[0];
  const [y1, r1] = rings[rings.length - 1];
  for (let k = 0; k < sides; k++) out.push(cx, y0, cz, ...P(y0, r0, k), ...P(y0, r0, k + 1), cx, y1, cz, ...P(y1, r1, k + 1), ...P(y1, r1, k));
  return normalizeTriangleWinding(new Float32Array(out));
}

function sectionRealStl(beforeWriter) {
  const file = process.env.DENTURE_STL || DENTURE_DEFAULT;
  console.log(`\n(c) 실제 STL — ${file}`);
  if (!fs.existsSync(file)) {
    console.log("  SKIP: 파일 없음 (리포 밖 리드 PC 경로 — DENTURE_STL 로 지정 가능)");
    return;
  }
  const { model, topY } = loadDenture(file);
  const run = (w, meshes) => w.generateTask0Gcode(meshes, topY, 0.05, WRITER_OPTS).totals;
  const newModel = run({ generateTask0Gcode }, [model]);
  const oldModel = run(beforeWriter, [model]);
  assert(newModel.layerCount === 518 && newModel.thinFillFailedLayers.length === 0 && newModel.unreachable === 0,
    `c1 모델만 (518층): 새 = 실패 층 ${json(newModel.thinFillFailedLayers)}·경로 없음 ${newModel.unreachable} · 채움 층 ${newModel.thinFillLayers.length}`);
  assert(json(oldModel.thinFillFailedLayers) === "[270,271,274]",
    `c1 대조군 수정 전 단면: 실패 층 ${json(oldModel.thinFillFailedLayers)} (기대 [270,271,274]) · 경로 없음 ${oldModel.unreachable} · 채움 층 ${oldModel.thinFillLayers.length}`);
  const supports = legacySupports(model);
  const meshes = [model, ...supports];
  const newSup = run({ generateTask0Gcode }, meshes);
  const oldSup = run(beforeWriter, meshes);
  assert(supports.length === 40 && newSup.thinFillFailedLayers.length === 0 && newSup.unreachable === 0,
    `c2 + 레거시 자동 서포트 ${supports.length}개: 새 = 실패 층 ${json(newSup.thinFillFailedLayers)}·경로 없음 ${newSup.unreachable} · 채움 층 ${newSup.thinFillLayers.length}`);
  assert(json(oldSup.thinFillFailedLayers) === "[271]",
    `c2 대조군 수정 전 단면: 실패 층 ${json(oldSup.thinFillFailedLayers)} (기대 [271] — 리드 화면) · 경로 없음 ${oldSup.unreachable}`);
}

async function main() {
  await sectionClosed();
  const noStitch = (await import(mutateSliceGeometry("nostitch", AT_STITCH, "        if (false && dj < bestD) {"))).chainSegments;
  const beforeWriter = await loadBeforeWriter();
  // 변조 사슬이 정말 수정 전 함수와 같은지 (대조군의 근거)
  const probe = sliceTrianglesAtY(normalizeTriangleWinding(new Float32Array(shuffleTris(archTris(false), 1))), 5.55);
  const sgBefore = await import(mutateSliceGeometry("before-probe", AT_FALLBACK, "  return polygons;"));
  assert(json(sgBefore.chainSegments(probe)) === json(chainSegmentsBefore(probe)) && json(chainSegments(probe)) !== json(chainSegmentsBefore(probe)),
    "변조본(열린 체인 경로 끔) = 수정 전 함수 복제본, 새 구현은 다름 — 열린 아치 층에서");
  await sectionSynthetic(noStitch, beforeWriter);
  sectionRealStl(beforeWriter);
  console.log(failed === 0 ? "\nPASS verify-slice-open-chain" : `\nFAIL verify-slice-open-chain — ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

const isMain = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMain) main();
