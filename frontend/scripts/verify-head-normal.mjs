// 화살촉 법선 방향 부착 + 45° 포화 헤드리스 검증 (S-4e-1).
//   설계 4-1 "접점은 모델 표면 법선을 따라 붙되 수평 45°보다 눕지 못하게 제한"
//   + 4-3 "45° 단일 규칙" 의 구현을 수치로 확인한다.
//
//   실행: npx tsx scripts/verify-head-normal.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).
//   ⚠️ Node 20.6 이상 필요 — `node:module` 의 `register`(로더 훅)로 Vite 전용 `.stl?url` import 를 푼다.
//      Node 18 이면 크래시가 나서 가짜 FAIL 로 보인다.
//   판정은 **exit code** 로 — 아래 (d) 대조군 절은 정상 동작일 때도 "FAIL 재현"
//   문자열을 출력한다(뮤테이션 대조군 관례).
//
//   ★ 대조군 원칙(프로젝트 규약): (d) 절에서 **종전 수직 고정 구현**
//     (`appendArrowHead` 경로 = headDir 무시)을 같은 30° 입력으로 돌려, (c) 의
//     기울임 단언이 그때는 **실제로 깨지는지** 확인한다. 깨지지 않으면 스크립트가
//     결함을 못 잡는다는 뜻이므로 그 사실 자체를 FAIL 로 센다.
//
//   ★ 검수 FAIL 재작업에서 보강한 것:
//     · (c)(e) 치수 케이스 B(tipR 0.3·침투 0.1) — 케이스 A 는 tipR = 침투(0.2) 라
//       뒷구슬 거리식의 (tipR − 침투) 항을 변조해도 값이 같아 살아남았다.
//     · (e) 첫 스트럿 **끝 단면 중심** = 뒷구슬(contact + sat(n)·d) 을 1e-3 로 단언.
//       종전 "정점 최근접 거리 < 기둥 지름" 은 느슨해서 "경로가 접점 XZ 에서 출발"
//       변조가 살아남았다. bent·anchor·joinPillar 3종과 45° 포화 입력까지 본다.
//     · (f) bridge/manual 점은 contactNormal 이 있어도 flag 와 무관하게 key 불변.
//     · (g) **실제 진입점** `createRedesignSupportMesh` 를 Babylon NullEngine 으로
//       호출해 flag 게이트를 검사하고, key 판정(`|hn|` 항목)과 조립 판정(형상이
//       실제로 기울었는가)이 전 조합에서 같은지 교차 확인한다. 기본값 off 도 지킨다.

import { register } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendArrowHead,
  appendArrowHeadDir,
  assembleVerticalSupport,
  saturateHeadDir,
  usesHeadNormal,
  HEAD_MAX_TILT_DEG,
} from "../src/features/v2/support/assemble-core.ts";
import { assembleRoutedSupport } from "../src/features/v2/support/assemble-route.ts";
import { DEFAULT_SUPPORT_PARAMS } from "../src/features/v2/support/utils/defaults.ts";
import { buildSupportKey } from "../src/features/v2/components/babylon/support-keys.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARTS = join(__dirname, "..", "src", "features", "v2", "support", "parts");

// ── (g) 용 모듈 로더 훅 ────────────────────────────────────────────────────
//   parts-cache.ts 는 Vite 전용 `./parts/*.stl?url` import 를 쓴다. Node 에는 그
//   문법이 없으므로, 그 specifier 만 "파일 URL 문자열을 default export 하는 모듈"
//   로 바꿔 준다(Vite 의 ?url 이 URL 문자열을 주는 것과 같은 모양). 다른 import 는
//   그대로 tsx 로 넘긴다. **정적 import 보다 늦게 등록되므로** 이 훅이 필요한
//   모듈(assemble-support·parts-cache)은 main 안에서 동적 import 한다.
const STL_URL_HOOK = `
export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".stl?url")) {
    const u = new URL(specifier.slice(0, -"?url".length), context.parentURL);
    return { url: "stlurl:" + u.href, shortCircuit: true };
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith("stlurl:")) {
    const href = url.slice("stlurl:".length);
    return {
      format: "module",
      source: "export default " + JSON.stringify(href) + ";",
      shortCircuit: true,
    };
  }
  return next(url, context);
}
`;
register("data:text/javascript," + encodeURIComponent(STL_URL_HOOK));

/** 바이너리 STL → { positions, indices } (verify-assemble-core.mjs 와 동일 파서). */
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
function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}

/** 정점 구간 [v0, v1) 의 bbox 중심. 구/원뿔 부품이 축대칭이라 중심 추정에 충분. */
function centerOfRange(pos, v0, v1) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = v0 * 3; i < v1 * 3; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = pos[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return [0, 1, 2].map((a) => (min[a] + max[a]) * 0.5);
}

/** 정점 구간 [v0, v1) 의 최대 Y. */
function maxYOfRange(pos, v0, v1) {
  let m = -Infinity;
  for (let i = v0 * 3 + 1; i < v1 * 3; i += 3) if (pos[i] > m) m = pos[i];
  return m;
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 두 Float32Array 가 바이트 단위로 같은가. */
function sameF32(a, b) {
  if (a.length !== b.length) return false;
  const va = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const vb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
  return true;
}

function sameU32(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** −Y 와 dir 이 이루는 극각(deg). */
function tiltDeg(d) {
  const len = Math.hypot(d[0], d[1], d[2]);
  const c = Math.min(1, Math.max(-1, -d[1] / len));
  return (Math.acos(c) * 180) / Math.PI;
}

/** 극각 θ(deg)·방위 φ(deg) 의 단위벡터 (−Y 기준). */
function dirFrom(thetaDeg, phiDeg) {
  const t = (thetaDeg * Math.PI) / 180;
  const p = (phiDeg * Math.PI) / 180;
  return [Math.sin(t) * Math.cos(p), -Math.cos(t), Math.sin(t) * Math.sin(p)];
}

/**
 * **독립 참조 구현** — 45° 포화의 기대값. 구현(`saturateHeadDir`)을 그대로 불러
 * 기대값을 만들면 구현 결함이 기대값에도 스며 단언이 공허해지므로 따로 쓴다.
 *   한계 이내면 정규화만, 넘으면 방위 유지·극각만 한계로: h·sin(max) + (0,−1,0)·cos(max).
 */
function satRef(d, maxDeg) {
  const len = Math.hypot(d[0], d[1], d[2]);
  const n = [d[0] / len, d[1] / len, d[2] / len];
  if (tiltDeg(n) <= maxDeg) return n;
  const h = Math.hypot(n[0], n[2]);
  const m = (maxDeg * Math.PI) / 180;
  return [(n[0] / h) * Math.sin(m), -Math.cos(m), (n[2] / h) * Math.sin(m)];
}

/**
 * 원기둥 부품에서 로컬 z === zEnd 인 끝 단면 정점의 **고유** 인덱스 목록.
 *   부품 STL 은 삼각형마다 정점을 중복 저장하므로(parseBinaryStl) 좌표로 중복을
 *   걷어낸다. 고유 정점(링 24개 + 중심 1개)의 평균이 정확히 단면 중심이며, 조립은
 *   어파인 변환이라 "변환된 정점의 평균 = 변환된 중심" 이 성립한다.
 */
function cylEndLocalIdx(cyl, zEnd) {
  const seen = new Map();
  const p = cyl.positions;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 2] !== zEnd) continue;
    const key = `${p[i]},${p[i + 1]}`;
    if (!seen.has(key)) seen.set(key, i / 3);
  }
  return [...seen.values()];
}

/** 조립 결과에서 부품 구간 시작 v0 의 원기둥 끝 단면 중심(world). */
function strutEndCenter(pos, v0, localIdx) {
  const c = [0, 0, 0];
  for (const li of localIdx) {
    const i = (v0 + li) * 3;
    c[0] += pos[i];
    c[1] += pos[i + 1];
    c[2] += pos[i + 2];
  }
  return c.map((v) => v / localIdx.length);
}

/**
 * 치수 케이스.
 *   A: 기본값과 같은 비율 — tipR(0.2) = 침투(0.2) 라 (tipR − 침투) = 0.
 *   B: tipR 0.3·침투 0.1 → (tipR − 침투) = 0.2. 뒷구슬 거리식에서 이 항을 빼거나
 *      부호를 뒤집는 변조가 A 에서는 값이 같아 살아남으므로 B 로 잡는다.
 */
const DIMS_CASES = [
  [
    "A(tip0.4·침투0.2)",
    {
      tipDiameterMm: 0.4,
      headBackDiameterMm: 1.0,
      headLengthMm: 1.0,
      contactPenetrationMm: 0.2,
      trunkDiameterMm: 0.8,
      baseDiameterMm: 3.0,
      baseTransitionMm: 1.5,
    },
  ],
  [
    "B(tip0.6·침투0.1)",
    {
      tipDiameterMm: 0.6,
      headBackDiameterMm: 1.0,
      headLengthMm: 1.0,
      contactPenetrationMm: 0.1,
      trunkDiameterMm: 0.8,
      baseDiameterMm: 3.0,
      baseTransitionMm: 1.5,
    },
  ],
];

async function main() {
  const parts = {
    sphere: loadPart("sphere.stl"),
    cone: loadPart("cone.stl"),
    cylinder: loadPart("cylinder.stl"),
  };

  const dims = DIMS_CASES[0][1];
  const tipR = dims.tipDiameterMm * 0.5;

  /** 화살촉 부품 순서: 앞구슬(sphere) → 원뿔(cone) → 뒷구슬(sphere). */
  const nSphere = parts.sphere.positions.length / 3;
  const nCone = parts.cone.positions.length / 3;
  const nCylV = parts.cylinder.positions.length / 3;
  /** 화살촉 다음 첫 부품(기둥·첫 스트럿)의 정점 시작 인덱스. */
  const afterHeadV0 = nSphere * 2 + nCone;
  const cylBottomIdx = cylEndLocalIdx(parts.cylinder, 0);
  const cylTopIdx = cylEndLocalIdx(parts.cylinder, 1);

  // ── (a) saturateHeadDir 순수 함수 ────────────────────────────────────────
  console.log("\n(a) saturateHeadDir — 45° 포화:");
  assert(HEAD_MAX_TILT_DEG === 45, "HEAD_MAX_TILT_DEG = 45 (설계 4-3 단일 규칙)");
  {
    const d30 = dirFrom(30, 37);
    const s30 = saturateHeadDir(d30, HEAD_MAX_TILT_DEG);
    assert(
      Math.abs(tiltDeg(s30) - 30) < 1e-6,
      "한계 이내(30°) 입력은 각이 그대로 유지된다",
    );
    assert(
      dist(s30, d30) < 1e-9,
      "한계 이내 입력은 벡터 자체가 변하지 않는다",
    );

    const d80 = dirFrom(80, 137);
    const s80 = saturateHeadDir(d80, HEAD_MAX_TILT_DEG);
    assert(Math.abs(tiltDeg(s80) - 45) < 1e-6, "80° 입력 → 정확히 45° 로 포화");
    const az = (v) => Math.atan2(v[2], v[0]);
    assert(
      Math.abs(az(s80) - az(d80)) < 1e-9,
      "포화해도 수평 방위(φ)는 그대로 보존된다",
    );
    assert(
      Math.abs(Math.hypot(s80[0], s80[1], s80[2]) - 1) < 1e-12,
      "포화 결과는 단위벡터",
    );
    assert(
      dist(s80, satRef(d80, 45)) < 1e-12,
      "포화 결과가 독립 참조 구현(satRef)과 일치한다",
    );

    const down = saturateHeadDir([0, -1, 0], HEAD_MAX_TILT_DEG);
    assert(
      down[0] === 0 && down[1] === -1 && down[2] === 0,
      "(0,−1,0) 은 불변 — 평평한 밑면 = 종전 수직 경로",
    );

    const up = saturateHeadDir([0, 1, 0], HEAD_MAX_TILT_DEG);
    assert(
      up[0] === 0 && up[1] === -1 && up[2] === 0,
      "(0,1,0)(윗면 법선) → 방위 불명이라 수직으로 떨어뜨린다",
    );

    const side = saturateHeadDir([1, 0, 0], HEAD_MAX_TILT_DEG);
    assert(Math.abs(tiltDeg(side) - 45) < 1e-6, "(1,0,0)(옆면 법선) → 45° 로 눕힘");
    assert(side[1] < 0, "옆면 법선의 포화 결과는 아래를 향한다(y < 0)");

    let nanFound = false;
    for (const d of [
      [0, 0, 0],
      [NaN, 1, 0],
      [1e-12, -1, 1e-12],
      [0, -1, 1e-10],
      [1, -1, 0],
      [-3, 0.5, 2],
    ]) {
      const s = saturateHeadDir(d, HEAD_MAX_TILT_DEG);
      if (s.some((v) => !Number.isFinite(v))) nanFound = true;
    }
    assert(!nanFound, "퇴화 입력(0벡터·NaN·거의 ±Y)에서 NaN 이 나오지 않는다");
  }

  // ── (b) 무회귀 — headDir 미지정 / (0,−1,0) 는 종전과 바이트 동일 ────────────
  //   ※ flag off 게이트는 여기서 흉내 내지 않고 (g) 에서 **실제 진입점**으로 검사한다
  //     (종전의 "headDir 미전달 = flag off" 단언은 위 첫 단언과 같은 비교라 중복이었다).
  console.log("\n(b) 무회귀 — 수직 경로는 바이트 단위로 종전과 동일:");
  {
    const base = { ...dims, surfaceY: 8.0, baseY: 0 };
    const legacy = assembleVerticalSupport(parts, base);
    const noDir = assembleVerticalSupport(parts, { ...base, headDir: undefined });
    const vertDir = assembleVerticalSupport(parts, { ...base, headDir: [0, -1, 0] });
    assert(
      sameF32(legacy.positions, noDir.positions) &&
        sameU32(legacy.indices, noDir.indices),
      "headDir 미지정(옛 점) → positions/indices 바이트 동일",
    );
    assert(
      sameF32(legacy.positions, vertDir.positions) &&
        sameU32(legacy.indices, vertDir.indices),
      "headDir=(0,−1,0)(평평한 밑면) → positions/indices 바이트 동일",
    );
    // 짧은 기둥(길이 축소 경로)도 무회귀인지.
    const shortBase = { ...base, surfaceY: 1.2 };
    const sLegacy = assembleVerticalSupport(parts, shortBase);
    const sVert = assembleVerticalSupport(parts, { ...shortBase, headDir: [0, -1, 0] });
    assert(
      sameF32(sLegacy.positions, sVert.positions),
      "길이 축소 경로(총 높이 < 전이+화살촉)도 수직이면 바이트 동일",
    );
  }

  // ── (c) 기울임 — 화살촉 축이 법선과 일치, 기둥은 뒷구슬 아래 ───────────────
  console.log("\n(c) 기울임 — 화살촉이 법선을 따라 붙는다:");
  const TILT = 30;
  const AZ = 25;
  const d30 = dirFrom(TILT, AZ);
  const surfaceY = 8.0;
  for (const [caseName, dm] of DIMS_CASES) {
    const cTipR = dm.tipDiameterMm * 0.5;
    /** 접점 → 뒷구슬 중심 거리 (설계 4-1: headLen + tipR − 침투). */
    const dBack = dm.headLengthMm + cTipR - dm.contactPenetrationMm;
    const geo = assembleVerticalSupport(parts, {
      ...dm,
      surfaceY,
      baseY: 0,
      headDir: d30,
    });
    const pos = geo.positions;
    const contact = [0, surfaceY, 0];
    // 앞구슬 중심은 접점에서 d 방향(자유 공간 쪽)으로 (tipR − 침투) 만큼 들어간다 —
    //   그래야 구 꼭대기가 모델 쪽으로 침투 깊이만큼 튀어나온다(설계 4-1).
    //   ※ 재작업 전 단언은 부호가 반대(침투 − tipR)였는데, 케이스 A 는 tipR = 침투라
    //     0 이 되어 통과했다. 케이스 B 가 이를 드러냈다(구현은 맞고 단언이 틀렸음).
    const frontExpect = [0, 1, 2].map(
      (a) => contact[a] + d30[a] * (cTipR - dm.contactPenetrationMm),
    );
    const backExpect = [0, 1, 2].map((a) => contact[a] + d30[a] * dBack);
    const front = centerOfRange(pos, 0, nSphere);
    const back = centerOfRange(pos, nSphere + nCone, afterHeadV0);
    assert(
      dist(front, frontExpect) < 1e-3,
      `[${caseName}] 앞구슬 중심 = contact + d·(tipR − 침투)`,
    );
    assert(
      dist(back, backExpect) < 1e-3,
      `[${caseName}] 뒷구슬 중심 = contact + d·(headLen + tipR − 침투)`,
    );
    // 화살촉 축(앞→뒤)이 법선과 평행한가.
    const axis = [0, 1, 2].map((a) => back[a] - front[a]);
    const axLen = Math.hypot(...axis);
    const dot = axis.reduce((s, v, a) => s + (v / axLen) * d30[a], 0);
    assert(dot > 1 - 1e-6, `[${caseName}] 화살촉 축이 포화된 법선과 평행하다`);
    assert(
      Math.abs(tiltDeg(axis) - TILT) < 1e-3,
      `[${caseName}] 화살촉 극각 = 입력 ${TILT}° (45° 이내라 포화 없음)`,
    );

    // 기둥 bbox 의 XZ 중심 = 뒷구슬 XZ, 기둥 꼭대기 Y = 뒷구슬 중심 Y, 발 min Y = baseY.
    //   조립 순서: 앞구슬 → 원뿔 → 뒷구슬 → 기둥(cylinder) → 발(cone).
    //   ★ 기둥 위치는 `appendArrowHeadDir` 가 **계산으로** 돌려준 뒷구슬 좌표를 쓴다
    //     (형상의 뒷구슬은 회전으로 따로 놓인다). 그래서 거리식 변조는 뒷구슬 형상은
    //     그대로 두고 기둥만 옮긴다 — 이 단언이 그 어긋남을 잡는다(케이스 B 필수).
    const trunk = centerOfRange(pos, afterHeadV0, afterHeadV0 + nCylV);
    assert(
      Math.abs(trunk[0] - backExpect[0]) < 1e-3 &&
        Math.abs(trunk[2] - backExpect[2]) < 1e-3,
      `[${caseName}] 기둥의 XZ 중심이 뒷구슬 XZ 바로 아래에 있다`,
    );
    assert(
      Math.abs(maxYOfRange(pos, afterHeadV0, afterHeadV0 + nCylV) - backExpect[1]) <
        1e-3,
      `[${caseName}] 기둥 꼭대기 Y = 뒷구슬 중심 Y`,
    );
    // 단언이 공허하지 않은지 — 기울었으면 기둥 축은 접점 XZ 에서 실제로 비껴난다.
    assert(
      Math.hypot(trunk[0], trunk[2]) > 0.1,
      `[${caseName}] 기울임 시 기둥 축이 접점 XZ(원점)에서 실제로 이탈한다(단언 비공허)`,
    );
    let minY = Infinity;
    for (let i = 1; i < pos.length; i += 3) if (pos[i] < minY) minY = pos[i];
    assert(Math.abs(minY - 0) < 1e-4, `[${caseName}] 발(바닥 원뿔) 최저 Y = baseY(0)`);

    // 45° 포화가 실제 형상에 걸리는가 — 80° 입력.
    const d80 = dirFrom(80, AZ);
    const geo80 = assembleVerticalSupport(parts, {
      ...dm,
      surfaceY,
      baseY: 0,
      headDir: d80,
    });
    const f80 = centerOfRange(geo80.positions, 0, nSphere);
    const b80 = centerOfRange(geo80.positions, nSphere + nCone, afterHeadV0);
    const ax80 = [0, 1, 2].map((a) => b80[a] - f80[a]);
    assert(
      Math.abs(tiltDeg(ax80) - HEAD_MAX_TILT_DEG) < 1e-2,
      `[${caseName}] 80° 법선 입력도 형상 극각은 45° 를 넘지 않는다`,
    );
    const s80 = satRef(d80, HEAD_MAX_TILT_DEG);
    const trunk80 = centerOfRange(geo80.positions, afterHeadV0, afterHeadV0 + nCylV);
    assert(
      Math.abs(trunk80[0] - s80[0] * dBack) < 1e-3 &&
        Math.abs(trunk80[2] - s80[2] * dBack) < 1e-3,
      `[${caseName}] 80° 입력의 기둥 XZ = contact + sat45(n)·d 의 XZ`,
    );
  }

  // ── (d) 대조군 — 수직 고정 구현이면 (c) 단언이 실제로 FAIL 하는가 ─────────
  console.log("\n(d) 대조군 — 종전 수직 고정 구현(headDir 무시)의 재현:");
  {
    // 수정 전 구현을 그대로 재현: headDir 을 무시하고 appendArrowHead 로 조립.
    const accPos = [];
    const accIdx = [];
    appendArrowHead(
      parts,
      {
        surfaceY,
        tipDiameterMm: dims.tipDiameterMm,
        headBackDiameterMm: dims.headBackDiameterMm,
        contactPenetrationMm: dims.contactPenetrationMm,
      },
      dims.headLengthMm,
      accPos,
      accIdx,
    );
    const legacyPos = new Float32Array(accPos);
    const front = centerOfRange(legacyPos, 0, nSphere);
    const back = centerOfRange(legacyPos, nSphere + nCone, afterHeadV0);
    const axis = [0, 1, 2].map((a) => back[a] - front[a]);
    const contact = [0, surfaceY, 0];
    const backExpect = [0, 1, 2].map(
      (a) =>
        contact[a] +
        d30[a] * (dims.headLengthMm + tipR - dims.contactPenetrationMm),
    );
    // 이 두 단언은 **깨져야 정상** (스크립트가 결함을 잡는다는 증명).
    const wouldFailTilt = !(Math.abs(tiltDeg(axis) - TILT) < 1e-3);
    const wouldFailBack = !(dist(back, backExpect) < 1e-3);
    assert(
      wouldFailTilt,
      "대조군 FAIL 재현 ok — 수직 고정 구현은 '극각 = 30°' 단언을 못 넘긴다",
    );
    assert(
      wouldFailBack,
      "대조군 FAIL 재현 ok — 수직 고정 구현은 '뒷구슬 = contact + d·L' 단언을 못 넘긴다",
    );
    // appendArrowHeadDir 가 돌려주는 뒷구슬 좌표(=기둥·다리 시작점) 자체도 확인.
    for (const [caseName, dm] of DIMS_CASES) {
      const cTipR = dm.tipDiameterMm * 0.5;
      const dBack = dm.headLengthMm + cTipR - dm.contactPenetrationMm;
      const ret = appendArrowHeadDir(
        parts,
        dm,
        dm.headLengthMm,
        [1, 2, 3],
        d30,
        [],
        [],
      );
      const expect = [0, 1, 2].map((a) => [1, 2, 3][a] + d30[a] * dBack);
      assert(
        dist(ret, expect) < 1e-9,
        `[${caseName}] appendArrowHeadDir 반환 = contact + d·(headLen + tipR − 침투)`,
      );
    }
  }

  // ── (e) assembleRoutedSupport — 첫 스트럿이 새 뒷구슬에서 출발 ────────────
  //   bent 는 첫 스트럿의 **아래 끝**(from = 뒷구슬), anchor·joinPillar 는
  //   assembleStrut(to = 뒷구슬) 이라 **위 끝** 단면 중심을 본다.
  console.log("\n(e) 라우팅 경로 — 첫 스트럿 끝 단면 중심 = 기울어진 뒷구슬 중심:");
  const contactWorld = [3, 9, -2];
  const ROUTES = [
    [
      "bent",
      { kind: "bent", worldWaypoints: [[5, 4, -2]], baseXZ: [5, -2], baseY: 0 },
      cylBottomIdx,
    ],
    ["anchor", { kind: "anchor", anchorWorld: [3.5, 4, -2.5] }, cylTopIdx],
    ["joinPillar", { kind: "joinPillar", junctionWorld: [4.5, 6, -1] }, cylTopIdx],
  ];
  for (const [caseName, dm] of DIMS_CASES) {
    const cTipR = dm.tipDiameterMm * 0.5;
    const dBack = dm.headLengthMm + cTipR - dm.contactPenetrationMm;
    for (const [routeName, route, endIdx] of ROUTES) {
      for (const tilt of [TILT, 80]) {
        const rawDir = dirFrom(tilt, AZ);
        const sat = satRef(rawDir, HEAD_MAX_TILT_DEG);
        const backExpect = [0, 1, 2].map((a) => contactWorld[a] + sat[a] * dBack);
        const geo = assembleRoutedSupport(parts, {
          ...dm,
          contactWorld,
          headDir: rawDir,
          route,
        });
        const pos = geo.positions;
        const tag = `[${caseName}·${routeName}·${tilt}°]`;
        const back = centerOfRange(pos, nSphere + nCone, afterHeadV0);
        assert(dist(back, backExpect) < 1e-3, `${tag} 뒷구슬 중심 = contact + sat(n)·d`);
        const end = strutEndCenter(pos, afterHeadV0, endIdx);
        assert(
          dist(end, backExpect) <= 1e-3,
          `${tag} 첫 스트럿 끝 단면 중심 = 뒷구슬 중심 (≤1e-3mm)`,
        );
        // 비공허 — 기울임으로 시작점이 접점 XZ 에서 실제로 비껴나 있어야,
        //   "경로가 접점 XZ 에서 출발" 변조를 위 단언이 구분할 수 있다.
        assert(
          Math.hypot(end[0] - contactWorld[0], end[2] - contactWorld[2]) > 0.1,
          `${tag} 시작점이 접점 XZ 에서 실제로 비껴난다(단언 비공허)`,
        );
      }

      // headDir 미지정이면 종전대로 접점 XZ 수직 화살촉.
      const geoV = assembleRoutedSupport(parts, { ...dm, contactWorld, route });
      const backV = centerOfRange(geoV.positions, nSphere + nCone, afterHeadV0);
      assert(
        Math.abs(backV[0] - contactWorld[0]) < 1e-4 &&
          Math.abs(backV[2] - contactWorld[2]) < 1e-4,
        `[${caseName}·${routeName}] headDir 미지정은 종전대로 접점 XZ 에 수직으로 붙는다`,
      );

      // headDir=(0,−1,0) 은 미지정과 **바이트 동일**이어야 한다. 회전 행렬이 항등
      //   이어도 곱을 한 번 더 거치면 float32 끝자리가 흔들리므로, 구현이 그 경우를
      //   종전 분기로 short-circuit 하는지 여기서 지킨다(수용 1).
      const geoD = assembleRoutedSupport(parts, {
        ...dm,
        contactWorld,
        headDir: [0, -1, 0],
        route,
      });
      assert(
        sameF32(geoV.positions, geoD.positions) &&
          sameU32(geoV.indices, geoD.indices),
        `[${caseName}·${routeName}] headDir=(0,−1,0) 는 미지정과 positions/indices 바이트 동일`,
      );
    }
  }

  // ── (f) buildSupportKey 무회귀 ──────────────────────────────────────────
  console.log("\n(f) buildSupportKey — 법선 항목은 재설계 점 + flag on + normal 일 때만:");
  const paramsOn = { ...DEFAULT_SUPPORT_PARAMS, headAlignNormal: true };
  const paramsOff = { ...DEFAULT_SUPPORT_PARAMS, headAlignNormal: false };
  const N = [0.3, -0.9, 0.31];
  {
    const lc = [1, 5, 2];
    const lb = [1, 0, 2];

    for (const kind of ["island", "slope"]) {
      const noNormal = { source: "auto", kind, tipRadius: 0.2 };
      const kOn = buildSupportKey(noNormal, paramsOn, lc, lb, null, 7.25);
      const kOff = buildSupportKey(noNormal, paramsOff, lc, lb, null, 7.25);
      assert(kOn === kOff, `${kind}: normal 없는 점 — flag on/off 무관하게 key 동일`);
      assert(!kOn.includes("|hn|"), `${kind}: normal 없는 점 key 에는 'hn' 항목이 없다(무회귀)`);

      const withNormal = { ...noNormal, contactNormal: N };
      const nOn = buildSupportKey(withNormal, paramsOn, lc, lb, null, 7.25);
      const nOff = buildSupportKey(withNormal, paramsOff, lc, lb, null, 7.25);
      assert(nOff === kOff, `${kind}: flag off 면 normal 이 있어도 key 는 종전과 동일`);
      assert(nOn !== kOn, `${kind}: flag on + normal 있으면 key 가 달라진다(재조립 트리거)`);
      assert(nOn.includes("|hn|"), `${kind}: flag on + normal 이면 key 에 'hn' 항목이 붙는다`);

      const other = { ...noNormal, contactNormal: [-0.3, -0.9, 0.31] };
      assert(
        buildSupportKey(other, paramsOn, lc, lb, null, 7.25) !== nOn,
        `${kind}: 법선이 달라지면 key 도 달라진다`,
      );
    }

    // 옛 trunk 점은 kind·normal 이 없으므로 flag 와 무관하게 불변.
    const legacyTrunk = { source: "auto" };
    assert(
      buildSupportKey(legacyTrunk, paramsOn, [1, 2, 3], [1, 0, 3], null) ===
        buildSupportKey(legacyTrunk, paramsOff, [1, 2, 3], [1, 0, 3], null),
      "옛 trunk 점 key 는 flag 와 무관하게 동일",
    );

    // ★ bridge/manual 점도 contactNormal 을 저장한다(useSupportEditing — 시각화용).
    //   화살촉이 없는 경로라 flag·법선 유무와 무관하게 key 가 **종전(법선 없음)과
    //   같아야** 한다. 종전 구현은 kind 를 안 봐서 여기서 'hn' 이 붙었다.
    const cps = [
      [0.5, 3.75, 0.25],
      [1, 4.5, 0.5],
      [1.5, 5.25, 0.75],
    ];
    const NON_REDESIGN = [
      ["bridge(source)", { source: "bridge", curveControlPoints: cps }, cps],
      ["manual(source) 단점", { source: "manual" }, null],
      ["kind 'manual'", { source: "auto", kind: "manual", tipRadius: 0.2 }, null],
    ];
    for (const [name, pt, lcps] of NON_REDESIGN) {
      const kNo = buildSupportKey(pt, paramsOn, lc, lb, lcps);
      const kOnN = buildSupportKey({ ...pt, contactNormal: N }, paramsOn, lc, lb, lcps);
      const kOffN = buildSupportKey({ ...pt, contactNormal: N }, paramsOff, lc, lb, lcps);
      assert(
        kOnN === kOffN && kOnN === kNo && !kOnN.includes("|hn|"),
        `${name} + contactNormal: flag on/off 모두 key 가 법선 없는 점과 동일`,
      );
    }
  }

  // ── (g) 실제 진입점 — flag 게이트 · key/조립 판정 일치 · 기본값 off ───────
  console.log("\n(g) createRedesignSupportMesh(실제 진입점) — flag 게이트·판정 일치:");
  assert(
    DEFAULT_SUPPORT_PARAMS.headAlignNormal === false,
    "DEFAULT_SUPPORT_PARAMS.headAlignNormal === false (S-4e-1b 전까지 기본 off)",
  );
  {
    const { NullEngine, Scene, StandardMaterial, Mesh } = await import(
      "@babylonjs/core"
    );
    const { initSupportParts, getSupportParts } = await import(
      "../src/features/v2/support/parts-cache.ts"
    );
    const { createRedesignSupportMesh } = await import(
      "../src/features/v2/support/assemble-support.ts"
    );
    const { createSupportMesh } = await import(
      "../src/features/v2/utils/support-render.ts"
    );

    // parts-cache 는 fetch(url) 로 부품을 읽는다. Node fetch 는 file: URL 을 못
    //   읽으므로 로드하는 동안만 디스크 읽기로 바꿔 끼운다.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const buf = readFileSync(fileURLToPath(url));
      return {
        arrayBuffer: async () =>
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    };
    try {
      await initSupportParts();
    } finally {
      globalThis.fetch = realFetch;
    }
    assert(getSupportParts() != null, "부품 캐시 로드(헤드리스)");

    const engine = new NullEngine();
    const scene = new Scene(engine);
    const mat = new StandardMaterial("verify-support", scene);

    // 회전·이동된 STL — stl-local 점의 법선 변환(TransformNormal) 경로까지 태운다.
    const stl = new Mesh("verify-stl", scene);
    stl.position.set(2, 3, -1);
    stl.rotation.set(0.3, 0.5, 0.1);
    stl.computeWorldMatrix(true);
    const stlMap = new Map([["s", stl]]);

    /** mesh → { pos, idx } 사본 후 dispose. null 이면 null. */
    const grab = (m) => {
      if (!m) return null;
      const g = {
        pos: Float32Array.from(m.getVerticesData("position")),
        idx: Uint32Array.from(m.getIndices()),
      };
      m.dispose();
      return g;
    };
    const sameGeo = (a, b) =>
      a != null && b != null && sameF32(a.pos, b.pos) && sameU32(a.idx, b.idx);
    const redesign = (p, params, map) =>
      grab(createRedesignSupportMesh(scene, p, params, mat, map));
    const legacyMesh = (p, params, map) =>
      grab(createSupportMesh(scene, p, params, mat, map));
    const withoutNormal = (p) => {
      const q = { ...p };
      delete q.contactNormal;
      return q;
    };

    // 기울기 ~32° 의 원시 법선 — 45° 이내라 포화 없이 형상이 확실히 달라진다.
    const TN = [0.45, -0.85, 0.28];
    const basePt = {
      id: "g1",
      projectId: "p",
      stlId: "s",
      contact: [1.5, 8, -0.5],
      base: [1.5, 0, -0.5],
      source: "auto",
      addedAt: 0,
      tipRadius: 0.2,
      baseAnchor: "plate",
      kind: "island",
    };
    const GATE_CASES = [
      ["island 수직", { ...basePt }, undefined],
      ["slope 수직", { ...basePt, kind: "slope" }, undefined],
      [
        "island bent",
        {
          ...basePt,
          base: [3, 0, -0.5],
          routeKind: "bent",
          routeWaypoints: [[3, 4, -0.5]],
        },
        undefined,
      ],
      [
        "island joinPillar",
        {
          ...basePt,
          base: [2.5, 5, 0],
          baseAnchor: "model",
          routeKind: "joinPillar",
        },
        undefined,
      ],
      [
        "island stl-local(회전 STL)",
        { ...basePt, contact: [0.5, 6, 0.2], base: [0.5, -3, 0.2], coordSpace: "stl-local" },
        stlMap,
      ],
    ];
    for (const [name, pt, map] of GATE_CASES) {
      const withN = { ...pt, contactNormal: TN };
      const gOffNo = redesign(pt, paramsOff, map);
      const gOffN = redesign(withN, paramsOff, map);
      const gOnNo = redesign(pt, paramsOn, map);
      const gOnN = redesign(withN, paramsOn, map);
      const gDefN = redesign(withN, DEFAULT_SUPPORT_PARAMS, map);
      assert(
        sameGeo(gOffN, gOffNo),
        `[${name}] flag off + contactNormal → 법선 없는 점과 positions·indices 바이트 동일`,
      );
      assert(
        sameGeo(gDefN, gOffNo),
        `[${name}] 기본값(DEFAULT) + contactNormal → 법선 없는 점과 바이트 동일`,
      );
      assert(
        sameGeo(gOnNo, gOffNo),
        `[${name}] flag on 이어도 법선이 없으면 바이트 동일(옛 점)`,
      );
      // 대조 — 위 단언들이 공허하지 않음(법선이 실제로 형상에 먹는 입력임)의 증명.
      assert(
        gOnN != null && !sameGeo(gOnN, gOffNo),
        `[${name}] 대조: flag on + contactNormal 이면 형상이 실제로 달라진다`,
      );
    }

    // key 판정(|hn| 항목) ↔ 조립 판정(형상이 실제로 기울었나) ↔ usesHeadNormal 이
    //   전 조합에서 일치하는가. 비재설계 kind 는 운영에서 이 진입점으로 오지 않지만
    //   (useSupportMeshSync.isRedesignPoint), 조립 게이트가 key 와 **같은 kind 조건**
    //   을 쓰는지 보려고 일부러 직접 호출한다.
    const mismatches = [];
    let combos = 0;
    for (const kind of ["island", "slope", "manual", undefined]) {
      for (const source of ["auto", "manual", "bridge"]) {
        for (const [flagName, params] of [
          ["on", paramsOn],
          ["off", paramsOff],
        ]) {
          for (const hasNormal of [true, false]) {
            combos++;
            const pt = { ...basePt, kind, source };
            if (kind === undefined) delete pt.kind;
            if (hasNormal) pt.contactNormal = TN;
            const redesignKind = kind === "island" || kind === "slope";
            const key = buildSupportKey(
              pt,
              params,
              pt.contact,
              pt.base,
              null,
              redesignKind ? pt.contact[1] : undefined,
            );
            const keyHn = key.includes("|hn|");
            const tilted = !sameGeo(
              redesign(pt, params, undefined),
              redesign(withoutNormal(pt), params, undefined),
            );
            const pred = usesHeadNormal(pt, params);
            const expectOn = redesignKind && flagName === "on" && hasNormal;
            if (!(keyHn === tilted && tilted === pred && pred === expectOn)) {
              mismatches.push(
                `kind=${kind} source=${source} flag=${flagName} normal=${hasNormal}` +
                  ` → key=${keyHn} 조립=${tilted} usesHeadNormal=${pred} 기대=${expectOn}`,
              );
            }
          }
        }
      }
    }
    for (const m of mismatches) console.error(`      ${m}`);
    assert(
      mismatches.length === 0,
      `key 판정 = 조립 판정 = usesHeadNormal = (island|slope ∧ flag ∧ normal) — ${combos} 조합`,
    );

    // bridge/manual(비재설계) 점의 **실제 조립 경로**(createSupportMesh)는 flag·법선
    //   유무와 무관하게 바이트 동일해야 한다.
    const bridgePt = {
      id: "b1",
      projectId: "p",
      stlId: "s",
      baseStlId: "s",
      contact: [2, 6, 1],
      base: [0, 3, 0],
      source: "bridge",
      addedAt: 0,
      curveControlPoints: [
        [0.5, 3.75, 0.25],
        [1, 4.5, 0.5],
        [1.5, 5.25, 0.75],
      ],
      contactNormal: TN,
      baseNormal: [0, 1, 0],
    };
    const manualPt = {
      id: "m1",
      projectId: "p",
      stlId: "s",
      contact: [1, 6, 1],
      base: [1, 0, 1],
      source: "manual",
      addedAt: 0,
      contactNormal: TN,
    };
    for (const [name, pt] of [
      ["bridge", bridgePt],
      ["manual 단점", manualPt],
    ]) {
      const gOn = legacyMesh(pt, paramsOn);
      const gOff = legacyMesh(pt, paramsOff);
      const gNo = legacyMesh(withoutNormal(pt), paramsOn);
      assert(
        sameGeo(gOn, gOff) && sameGeo(gOn, gNo),
        `${name} + contactNormal: createSupportMesh 결과가 flag on/off·법선 유무와 무관하게 동일`,
      );
    }

    scene.dispose();
    engine.dispose();
  }

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
