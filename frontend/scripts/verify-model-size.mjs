// 모델 크기(mm) 표시·입력 + "출력 영역에 맞춤" 헤드리스 검증 (데모 빈칸 #1).
//
//   대상: src/features/v2/utils/model-size.ts (순수 계산) + TransformPanel 배선.
//   계획: docs/계획_11월데모_20260923.md §3 #1 — 프루사처럼 Size(mm) ↔ Scale(%) 연동.
//
//   (a) world AABB → 표시 크기 (Z-up 축 규약 B-13 — 크기는 부호 없는 축 교환)
//   (b) 크기 입력 → 새 배율 (비율 유지 on/off, 축 정렬 회전·45° 회전, 0·음수 거부, 배율 한계)
//       — 결과 배율을 패널과 같은 경로(scaleTransformAroundWorldPivot, bbox 중심 피벗)로 적용해
//         **실제 정점 상자**를 다시 재서 입력한 크기가 나오는지 본다.
//   (b2) "보인 값 그대로" 가드 (검수 1) — 크기 칸·Scale 칸에 포커스만 주고 빠져나오면(표시 문자열 그대로 커밋)
//       onChange 가 나가지 않는다(12.3456789 mm · 맞춤 배율 222.05 % 등). Position 류(가드 없음)는 B-14 그대로.
//   (c) 맞춤 — 큐브 20 / 판 200×10×5 / 기둥 10×10×300 / 45° 회전 / 기울인 모델 × Task0 영역(140×75)·
//       일반 프로파일(Mars 3 Pro 빌드 크기) 기대값 + 맞춘 정점 상자를 **빨간 박스 판정과 같은 함수**
//       (checkPrintableArea / checkBuildVolume)로 검사 + 여유 2 mm·가운데·바닥·균일 배율.
//       + 다시 맞추면 무변경(null — 커밋 없음, 검수 2) · 맞출 수 없으면 이유·안내 문구(검수 4).
//   (d) 맞춤 영역 출처 — Task0 면 task0PrintableAreaForProfile, 아니면 빌드 크기 (빨간 박스와 같은 출처)
//   (e) 서포트 추종 시뮬레이션 — 커밋 경로(useTransformCommit)와 같은 transformPointBetween 으로 접점을
//       옮기고 발을 바로 아래(Y=0)에 둔 서포트 상자로 checkItemsInPrintableArea(Task0, 서포트 포함).
//   (f) 배선 정적 검사 — 크기 입력이 Scale 과 같은 적용 경로(applyScale)·같은 undo 묶음(beginDrag/endDrag),
//       맞춤이 onCommit 1회, 핸들이 캐시(model-bounds-cache)를 거쳐 출력영역 검사와 같은 순회, BabylonScene 훅 순서 불변.
//   (h) 피벗·크기 상자 캐시 (검수 3) — 실제 Babylon Mesh(NullEngine)로 자세·정점을 바꿔 가며 캐시 값이
//       worldVertexAabb / meshWorldBBoxCenter 와 **비트 단위로 같고**, 같은 상태·이동만이면 다시 훑지 않는지.
//   (g) ★ 대조군 — model-size.ts·model-bounds-cache.ts·TransformPanel 소스를 변조하면 위 단언이 실제로 FAIL 하는가:
//       축 규약 뒤집기 / 비율 유지 무시 / 여유 무시 / 높이 무시 / Task0 인데 빌드 크기 / 바닥 여유 제거 /
//       맞춤 이중 커밋 / 크기 입력이 Scale 경로 우회 / 보인 값 가드 제거(크기·Scale, 함수·배선) /
//       재맞춤 무변경 가드 제거 / 캐시 키에서 회전·정점 빼기 / 캐시 이동 더하기 빼기.
//
//   실행: npx tsx scripts/verify-model-size.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "FAIL" 이 들어간 문자열을 낸다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Vector3 } from "@babylonjs/core";

import * as REAL from "../src/features/v2/utils/model-size.ts";
import {
  checkBuildVolume,
  checkItemsInPrintableArea,
  checkPrintableArea,
  hasViolation,
} from "../src/features/v2/utils/build-volume.ts";
import {
  matrixFromTransform,
  scaleTransformAroundWorldPivot,
  transformPointBetween,
} from "../src/features/v2/utils/transform.ts";
import { transformKeepsRedesignValid } from "../src/features/v2/types/transform.ts";
import {
  TASK0_BUILT_IN_PROFILE,
  task0PrintableAreaForProfile,
} from "../src/features/v2/utils/task0/task0-profile.ts";
import {
  positionsWorldAabb,
  worldVertexAabb,
} from "../src/features/v2/components/babylon/hooks/useBuildVolumeCheck.ts";
import * as REAL_CACHE from "../src/features/v2/components/babylon/model-bounds-cache.ts";
import { DEFAULT_SUPPORT_PARAMS } from "../src/features/v2/support/utils/defaults.ts";
import {
  commitNumberInput,
  formatNumberForDisplay,
} from "../src/features/v2/utils/number-input.ts";
import { applyTransformToMesh, meshWorldBBoxCenter } from "../src/features/v2/utils/transform.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(__dirname, "..");
const V2 = path.join(FRONTEND, "src", "features", "v2");
const MODEL_SIZE_TS = path.join(V2, "utils", "model-size.ts");
const BOUNDS_CACHE_TS = path.join(V2, "components", "babylon", "model-bounds-cache.ts");

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
/** 대조군용 — 출력 없이 실패만 센다(메시지는 모아 둔다) */
function collector() {
  const c = { fails: 0, first: null, msgs: [] };
  c.assert = (cond, msg) => {
    if (!cond) {
      c.fails++;
      c.msgs.push(msg);
      if (c.first === null) c.first = msg;
    }
  };
  return c;
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const nearRel = (a, b, rel) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));
const near3 = (a, b, tol) => a.every((v, i) => near(v, b[i], tol));
const fmt3 = (v) => `(${v.map((x) => (Number.isFinite(x) ? +x.toFixed(4) : x)).join(", ")})`;

// ── 픽스처 ──────────────────────────────────────────────────────────────
//   stl-loader 의 alignMeshToPlate 가 정점을 "XZ 중심 0 / 바닥 Y = 리프트" 에 베이크한다.
//   내부(Babylon) 치수 = [X 폭, Y 높이, Z 깊이]. 표시(Z-up) = [X, Y(=내부 Z), Z(=내부 Y 높이)].
const LIFT = DEFAULT_SUPPORT_PARAMS.liftMm; // 5 mm — 새로 불러온 모델의 바닥 높이

/** 상자 8 꼭짓점 (float32 — 메쉬 정점 버퍼와 같은 정밀도) */
function boxVerts(w, h, d, lift) {
  const out = [];
  for (const x of [-w / 2, w / 2])
    for (const y of [lift, lift + h])
      for (const z of [-d / 2, d / 2]) out.push(x, y, z);
  return Float32Array.from(out);
}

const T = (o = {}) => ({ tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1, ...o });

/** 씬 핸들 getModelWorldAabb 와 같은 계산 — 실제 worldVertexAabb 에 world 행렬(matrixFromTransform)을 준다 */
function liveAabb(pos, t) {
  return worldVertexAabb({
    getVerticesData: () => pos,
    getWorldMatrix: () => matrixFromTransform(t),
  });
}

/** 패널 Scale 경로 재현 — withPivot 의 배율 분기(scaleTransformAroundWorldPivot, 피벗 = bbox 중심) */
function applyScaleLikePanel(base, s, aabb) {
  const pivot = new Vector3(
    (aabb.minX + aabb.maxX) / 2,
    (aabb.minY + aabb.maxY) / 2,
    (aabb.minZ + aabb.maxZ) / 2,
  );
  const r = (a, b) => (Math.abs(b) < 1e-9 ? 1 : a / b);
  return scaleTransformAroundWorldPivot(
    base,
    [r(s[0], base.sx), r(s[1], base.sy), r(s[2], base.sz)],
    pivot,
  );
}

const FIX = {
  cube: { name: "큐브 20", dims: [20, 20, 20], lift: LIFT, t: T(), disp: [20, 20, 20] },
  plate: { name: "판 200×10×5", dims: [200, 5, 10], lift: 0, t: T(), disp: [200, 10, 5] },
  pillar: { name: "기둥 10×10×300", dims: [10, 300, 10], lift: LIFT, t: T(), disp: [10, 10, 300] },
  // 표시 40×20×10 상자를 수직축(표시 Z = 내부 Y)으로 45° — world 바닥 상자는 (40+20)/√2 정사각형.
  rot45: {
    name: "45° 회전 40×20×10",
    dims: [40, 10, 20],
    lift: LIFT,
    t: T({ ry: 45 }),
    disp: [60 / Math.SQRT2, 60 / Math.SQRT2, 10],
  },
  // 세 축이 섞인 기울인 자세 — 기대값 대신 성질로만 본다.
  tilt: { name: "기울인 30×12×18 (30°,17°,41°)", dims: [30, 12, 18], lift: LIFT, t: T({ rx: 30, ry: 17, rz: 41 }), disp: null },
};
for (const f of Object.values(FIX)) f.pos = boxVerts(f.dims[0], f.dims[1], f.dims[2], f.lift);

// 일반 프로파일 = 빌트인 Mars 3 Pro 빌드 크기 (hooks/usePrinterProfileStore.ts BUILT_IN_PROFILES[0]).
//   스토어 모듈(zustand persist)을 node 에서 불러오지 않으려고 값만 옮겨 적었다.
const MARS = {
  id: "elegoo-mars-3-pro",
  name: "ELEGOO Mars 3 Pro",
  lcdWidthPx: 4098,
  lcdHeightPx: 2560,
  pixelPitchUm: 35.0,
  buildVolumeMm: [143.43, 89.6, 175.0],
};

/** 빨간 박스 판정 그대로 — Task0 면 출력 가능 영역(checkPrintableArea), 아니면 대칭 플레이트(checkBuildVolume) */
function redBoxViolation(profile, aabb) {
  const area = task0PrintableAreaForProfile(profile);
  const [w, d, h] = profile.buildVolumeMm;
  return area
    ? checkPrintableArea(aabb, area, h)
    : checkBuildVolume(aabb, { widthMm: w, depthMm: d, heightMm: h });
}
/** 판정 영역(world X/Z) — 위와 같은 출처 */
function redBoxArea(profile) {
  const area = task0PrintableAreaForProfile(profile);
  const [w, d] = profile.buildVolumeMm;
  return area ?? { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 };
}

// ── (a) 크기 표시 ────────────────────────────────────────────────────────
function sectionDisplay(M, A) {
  for (const key of ["cube", "plate", "pillar", "rot45"]) {
    const f = FIX[key];
    const got = M.toDisplaySize(liveAabb(f.pos, f.t));
    A(near3(got, f.disp, 1e-4), `${f.name}: 표시 크기 X/Y/Z ${fmt3(got)} = ${fmt3(f.disp)} mm`);
  }
  // 라이브 — 같은 메쉬를 배율 2 로 바꾸면 표시도 두 배 (판: 표시 Z 가 높이 5 → 10).
  const p = FIX.plate;
  const got2 = M.toDisplaySize(liveAabb(p.pos, T({ sx: 2, sy: 2, sz: 2 })));
  A(near3(got2, [400, 20, 10], 1e-4), `판 배율 2: ${fmt3(got2)} = (400, 20, 10) — 지금 메쉬를 다시 읽는다`);
  // 높이축 단독 배율 — 표시 Z 만 바뀐다(Y 와 섞이면 축 규약 뒤집힘).
  const got3 = M.toDisplaySize(liveAabb(p.pos, T({ sy: 3 })));
  A(near3(got3, [200, 10, 15], 1e-4), `판 내부 sy 3: 표시 ${fmt3(got3)} = (200, 10, 15) — 내부 Y(높이) = 표시 Z`);
}

// ── (b) 크기 입력 → 배율 ─────────────────────────────────────────────────
function sizeCase(M, f, t, axis, valueMm, uniform) {
  const aabb = liveAabb(f.pos, t);
  const displaySize = M.toDisplaySize(aabb);
  const s = M.sizeInputToScale({
    scale: [t.sx, t.sy, t.sz],
    rotationDeg: [t.rx, t.ry, t.rz],
    displaySize,
    axis,
    valueMm,
    uniform,
  });
  if (!s) return { s: null, after: null };
  const next = applyScaleLikePanel(t, s, aabb);
  return { s, after: M.toDisplaySize(liveAabb(f.pos, next)) };
}

function sectionSizeInput(M, A) {
  // b1 비율 유지 ON — 한 칸을 바꾸면 세 축이 같은 비율
  {
    const r = sizeCase(M, FIX.cube, FIX.cube.t, 0, 30, true);
    A(r.s && near3(r.s, [1.5, 1.5, 1.5], 1e-12), `b1 큐브 X=30 (비율 유지): 배율 ${r.s && fmt3(r.s)} = (1.5, 1.5, 1.5)`);
    A(r.after && near3(r.after, [30, 30, 30], 1e-3), `b1 적용 후 실제 크기 ${r.after && fmt3(r.after)} = (30, 30, 30)`);
  }
  // b2 비율 유지 OFF — 표시 Y(= 내부 Z)만
  {
    const r = sizeCase(M, FIX.plate, FIX.plate.t, 1, 20, false);
    A(r.s && near3(r.s, [1, 1, 2], 1e-12), `b2 판 Y=20 (비율 유지 끔): 내부 배율 ${r.s && fmt3(r.s)} = (1, 1, 2) — 표시 Y = 내부 Z`);
    A(r.after && near3(r.after, [200, 20, 5], 1e-3), `b2 적용 후 ${r.after && fmt3(r.after)} = (200, 20, 5) — 다른 축 그대로`);
  }
  // b3 높이(표시 Z = 내부 Y)만
  {
    const r = sizeCase(M, FIX.pillar, FIX.pillar.t, 2, 150, false);
    A(r.s && near3(r.s, [1, 0.5, 1], 1e-12), `b3 기둥 Z=150 (비율 유지 끔): 내부 배율 ${r.s && fmt3(r.s)} = (1, 0.5, 1)`);
    A(r.after && near3(r.after, [10, 10, 150], 1e-3), `b3 적용 후 ${r.after && fmt3(r.after)} = (10, 10, 150)`);
  }
  // b4 축 정렬 회전(내부 rx 90: 로컬 Z → world −Y) — 높이 입력이 로컬 Z 배율로 간다
  {
    const f = { ...FIX.rot45, t: T({ rx: 90 }) };
    const before = M.toDisplaySize(liveAabb(f.pos, f.t));
    A(near3(before, [40, 10, 20], 1e-3), `b4 40×10×20(내부) 를 rx 90 으로 눕힘: 표시 ${fmt3(before)} = (40, 10, 20)`);
    const r = sizeCase(M, f, f.t, 2, 40, false);
    A(r.s && near3(r.s, [1, 1, 2], 1e-9), `b4 높이 Z=40 (비율 유지 끔): 내부 배율 ${r.s && fmt3(r.s)} = (1, 1, 2) — world 높이 = 로컬 Z`);
    A(r.after && near3(r.after, [40, 10, 40], 1e-3), `b4 적용 후 ${r.after && fmt3(r.after)} = (40, 10, 40)`);
  }
  // b5 수직축 90° (내부 ry 90: 로컬 Z → world X)
  {
    const f = { ...FIX.rot45, t: T({ ry: 90 }) };
    const before = M.toDisplaySize(liveAabb(f.pos, f.t));
    A(near3(before, [20, 40, 10], 1e-3), `b5 ry 90: 표시 ${fmt3(before)} = (20, 40, 10)`);
    const r = sizeCase(M, f, f.t, 0, 10, false);
    A(r.s && near3(r.s, [1, 1, 0.5], 1e-9), `b5 X=10 (비율 유지 끔): 내부 배율 ${r.s && fmt3(r.s)} = (1, 1, 0.5) — world X = 로컬 Z`);
    A(r.after && near3(r.after, [10, 40, 10], 1e-3), `b5 적용 후 ${r.after && fmt3(r.after)} = (10, 40, 10)`);
  }
  // b6 45° 회전 — 축 정렬이 아니면 비율 유지 꺼져 있어도 세 축 같은 비율, 입력 축은 정확히 입력값
  {
    const f = FIX.rot45;
    A(M.axisAlignedLocalAxes([0, 45, 0]) === null, "b6 45° 회전은 축 정렬이 아니다");
    const target = 2 * f.disp[0];
    const r = sizeCase(M, f, f.t, 0, target, false);
    // 지금 크기를 float32 world 행렬로 재므로 비율에 ~1e-7 상대 잡음이 낀다 → 1e-5 허용.
    A(r.s && near3(r.s, [2, 2, 2], 1e-5) && r.s[0] === r.s[1] && r.s[1] === r.s[2],
      `b6 45° X=${target.toFixed(2)} (비율 유지 끔): 배율 ${r.s && fmt3(r.s)} = (2, 2, 2) — 세 축 같은 비율`);
    A(r.after && near3(r.after, [target, target, 20], 1e-3), `b6 적용 후 ${r.after && fmt3(r.after)} — X 가 정확히 입력값, 모양 유지`);
    // 기울인 자세(세 축 섞임)도 입력 축은 정확히 입력값
    const g = FIX.tilt;
    const d0 = M.toDisplaySize(liveAabb(g.pos, g.t));
    const rt = sizeCase(M, g, g.t, 2, d0[2] * 0.7, false);
    A(rt.after && near(rt.after[2], d0[2] * 0.7, 1e-3) && near(rt.after[0], d0[0] * 0.7, 1e-3),
      `b6 기울인 자세 높이 ×0.7: ${rt.after && fmt3(rt.after)} — 세 축 0.7배 (원래 ${fmt3(d0)})`);
  }
  // b7 거부 — 0·음수·NaN·무한대·두께 0
  {
    const bad = [0, -5, NaN, Infinity, -Infinity];
    const rs = bad.map((v) => sizeCase(M, FIX.cube, FIX.cube.t, 0, v, true).s);
    A(rs.every((s) => s === null), `b7 입력 ${bad.join(", ")} → 모두 거부(null)`);
    A(bad.every((v) => !M.isValidSizeInput(v, 20)), "b7 isValidSizeInput 도 같은 입력을 거부 (패널 NumberInput isValid)");
    A(!M.isValidSizeInput(10, 0) && M.isValidSizeInput(10, 20), "b7 지금 크기 0(두께 없는 축)은 거부, 정상 입력은 통과");
    const flat = M.sizeInputToScale({ scale: [1, 1, 1], rotationDeg: [0, 0, 0], displaySize: [10, 10, 0], axis: 2, valueMm: 5, uniform: true });
    A(flat === null, "b7 두께 0 축에 크기 입력 → 거부");
  }
  // b8 배율 한계 — Scale(%) 칸과 같은 1 %~10000 %
  {
    A(M.SCALE_MIN === 0.01 && M.SCALE_MAX === 100 && M.SCALE_PERCENT_MIN === 1 && M.SCALE_PERCENT_MAX === 10000,
      `b8 배율 한계 ${M.SCALE_PERCENT_MIN}~${M.SCALE_PERCENT_MAX} % (= ${M.SCALE_MIN}~${M.SCALE_MAX} 배)`);
    const big = sizeCase(M, FIX.cube, FIX.cube.t, 0, 1e9, true).s;
    const tiny = sizeCase(M, FIX.cube, FIX.cube.t, 0, 1e-9, true).s;
    A(big && near3(big, [100, 100, 100], 1e-9), `b8 아주 큰 입력 → 최대 배율로 맞춤 ${big && fmt3(big)}`);
    A(tiny && near3(tiny, [0.01, 0.01, 0.01], 1e-12), `b8 아주 작은 입력 → 최소 배율로 맞춤 ${tiny && fmt3(tiny)}`);
    const one = sizeCase(M, FIX.plate, FIX.plate.t, 1, 1e9, false).s;
    A(one && near3(one, [1, 1, 100], 1e-9), `b8 비율 유지 끔 — 그 축만 최대 배율 ${one && fmt3(one)}`);
  }
  // b9 축 정렬 판정 — 기즈모 왕복 잡음은 정렬로, 실제 기울임은 비정렬로
  {
    const id = M.axisAlignedLocalAxes([0, 0, 0]);
    A(id && id.join() === "0,1,2", `b9 항등 → [0,1,2] (${id})`);
    A(M.axisAlignedLocalAxes([90 + 1e-4, 0, 0]) !== null, "b9 rx 90.0001° (float 잡음 수준) → 축 정렬");
    A(M.axisAlignedLocalAxes([0, 180, 0]) !== null && M.axisAlignedLocalAxes([90, 90, 0]) !== null, "b9 180°·복합 90° → 축 정렬");
    A(M.axisAlignedLocalAxes([1, 0, 0]) === null, "b9 rx 1° → 축 정렬 아님(세 축 같은 비율로)");
  }
  // b10 이미 배율이 걸린 모델 — 비율은 지금 크기 기준
  {
    const t = T({ sx: 2, sy: 2, sz: 2 });
    const r = sizeCase(M, FIX.cube, t, 0, 20, true);
    A(r.s && near3(r.s, [1, 1, 1], 1e-12), `b10 배율 2 큐브(40 mm)를 X=20 → 배율 ${r.s && fmt3(r.s)} = (1, 1, 1)`);
  }
}

// ── (c) 맞춤 ──────────────────────────────────────────────────────────────
//   기대 비율 k (손 계산, 여유 2 mm):
//     Task0 영역 140 × 75 (X −65~75, Z −32.5~42.5), 높이 2000 → 가용 136 × 71 × (2000 − 바닥 − 2)
//     Mars 3 Pro 143.43 × 89.6 × 175 → 가용 139.43 × 85.6 × (175 − 바닥 − 2)
const FIT_EXPECT = [
  // [픽스처, Task0 k, 일반 k, 제한 축]
  ["cube", 71 / 20, 85.6 / 20, "세로(Y)"],
  ["plate", 136 / 200, 139.43 / 200, "가로(X)"],
  ["pillar", (2000 - LIFT - 2) / 300, (175 - LIFT - 2) / 300, "높이"],
  ["rot45", 71 / (60 / Math.SQRT2), 85.6 / (60 / Math.SQRT2), "세로(Y)"],
];

/** 맞춤 한 건 — 실제 정점 상자로 판정까지. 반환 { fit, actual, start } */
function fitCase(M, A, profile, f, startT, expectK, label) {
  const start = startT ?? f.t;
  const aabb0 = liveAabb(f.pos, start);
  const region = M.modelFitRegionForProfile(profile);
  const fit = M.computeFitTransform(start, aabb0, region);
  if (!fit) {
    A(false, `${label}: 맞춤 결과가 있다`);
    return null;
  }
  const actual = liveAabb(f.pos, fit.transform);
  const area = redBoxArea(profile);
  const H = profile.buildVolumeMm[2];
  const MG = M.FIT_MARGIN_MM;
  const v = redBoxViolation(profile, actual);
  const kOk = expectK === null || nearRel(fit.scale, expectK, 1e-5);
  A(kOk, `${label}: 비율 k = ${fit.scale.toFixed(6)}${expectK === null ? "" : ` (기대 ${expectK.toFixed(6)})`}`);
  A(!hasViolation(v), `${label}: 맞춘 정점 상자가 빨간 박스 판정 통과 (${task0PrintableAreaForProfile(profile) ? "checkPrintableArea" : "checkBuildVolume"})`);
  const tol = 1e-3;
  const inMargin =
    actual.minX >= area.minX + MG - tol &&
    actual.maxX <= area.maxX - MG + tol &&
    actual.minZ >= area.minZ + MG - tol &&
    actual.maxZ <= area.maxZ - MG + tol &&
    actual.maxY <= H - MG + tol;
  A(inMargin, `${label}: 가장자리·위 여유 ${MG} mm 안 (X ${actual.minX.toFixed(3)}~${actual.maxX.toFixed(3)}, Z ${actual.minZ.toFixed(3)}~${actual.maxZ.toFixed(3)}, 높이 ~${actual.maxY.toFixed(3)})`);
  const tight =
    near(actual.maxX - actual.minX, area.maxX - area.minX - 2 * MG, tol) ||
    near(actual.maxZ - actual.minZ, area.maxZ - area.minZ - 2 * MG, tol) ||
    near(actual.maxY, H - MG, tol);
  A(tight, `${label}: 한 축이 가용 크기에 꽉 찬다 (최대한 크게)`);
  const cxOk =
    near((actual.minX + actual.maxX) / 2, (area.minX + area.maxX) / 2, tol) &&
    near((actual.minZ + actual.maxZ) / 2, (area.minZ + area.maxZ) / 2, tol);
  A(cxOk, `${label}: 영역 가운데`);
  const wantBottom = Math.max(M.FIT_FLOOR_CLEARANCE_MM, aabb0.minY);
  A(near(actual.minY, wantBottom, 1e-4) && actual.minY >= 0,
    `${label}: 바닥 ${actual.minY.toFixed(4)} = 지금 바닥 높이 ${aabb0.minY.toFixed(4)} 유지(플레이트에 닿았으면 ${M.FIT_FLOOR_CLEARANCE_MM})`);
  const t = fit.transform;
  const uni =
    nearRel(t.sx / start.sx, fit.scale, 1e-12) &&
    nearRel(t.sy / start.sy, fit.scale, 1e-12) &&
    nearRel(t.sz / start.sz, fit.scale, 1e-12) &&
    t.rx === start.rx && t.ry === start.ry && t.rz === start.rz;
  A(uni, `${label}: 세 축 같은 비율 · 회전 그대로`);
  const pred = fit.aabb;
  const predOk = ["minX", "minY", "minZ", "maxX", "maxY", "maxZ"].every((k) => near(pred[k], actual[k], 1e-3));
  A(predOk, `${label}: 예상 상자 = 실제 정점 상자 (±1 µm)`);
  return { fit, actual, start };
}

function sectionFit(M, A) {
  for (const [key, kTask0, kMars, lim] of FIT_EXPECT) {
    const f = FIX[key];
    fitCase(M, A, TASK0_BUILT_IN_PROFILE, f, null, kTask0, `Task0 · ${f.name}`);
    fitCase(M, A, MARS, f, null, kMars, `일반(Mars 3 Pro) · ${f.name} [${lim} 제한]`);
  }
  // 기울인 자세 — 기대값 대신 성질(판정 통과·여유·가운데·꽉 참)
  fitCase(M, A, TASK0_BUILT_IN_PROFILE, FIX.tilt, null, null, `Task0 · ${FIX.tilt.name}`);
  fitCase(M, A, MARS, FIX.tilt, null, null, `일반 · ${FIX.tilt.name}`);
  // 큐브를 X 90° 눕힌 경우 — 바닥 여유 없으면 float32 로 −3e-6 mm 가 되는 사례(대조군 f)
  fitCase(M, A, MARS, { ...FIX.cube, pos: boxVerts(20, 20, 20, 0) }, T({ rx: 90 }), 85.6 / 20, "일반 · 바닥 0 큐브 X 90°");
  // 플레이트 아래로 파고든 모델 → 플레이트 위로
  fitCase(M, A, TASK0_BUILT_IN_PROFILE, FIX.cube, T({ ty: -8, tx: 30, tz: -20 }), 71 / 20, "Task0 · 파고든 큐브(바닥 −3)");
  // 비균일 배율이 걸린 모델 — 모양(축 비) 유지
  {
    const start = T({ sx: 1, sy: 2, sz: 0.5 });
    const r = fitCase(M, A, TASK0_BUILT_IN_PROFILE, FIX.cube, start, null, "Task0 · 비균일 배율(1,2,0.5) 큐브");
    if (r) {
      const before = M.toDisplaySize(liveAabb(FIX.cube.pos, start));
      const after = M.toDisplaySize(r.actual);
      A(nearRel(after[0] / after[2], before[0] / before[2], 1e-6) && nearRel(after[1] / after[2], before[1] / before[2], 1e-6),
        `비균일 모델도 축 비 유지 ${fmt3(before)} → ${fmt3(after)}`);
    }
  }
}

// ── (c2) 다시 맞추면 무변경 (검수 2) ────────────────────────────────────
//   맞춘 모델의 상자를 float32 world 행렬로 다시 재면 k = 1 ± 1e-8, 위치 ± 1e-7 mm 잡음이 나온다.
//   그걸 커밋하면 undo 가 한 번 더 쌓여 "Ctrl+Z 1회로 복귀" 가 깨진다 → null(무변경)이어야 한다.
function sectionRefit(M, A) {
  for (const profile of [TASK0_BUILT_IN_PROFILE, MARS]) {
    const region = M.modelFitRegionForProfile(profile);
    const tag = profile === MARS ? "일반" : "Task0";
    for (const key of ["cube", "plate", "pillar", "rot45", "tilt"]) {
      const f = FIX[key];
      const first = M.computeFitTransform(f.t, liveAabb(f.pos, f.t), region);
      if (!first) {
        A(false, `${tag} · ${f.name}: 첫 맞춤 결과가 있다`);
        continue;
      }
      const again = liveAabb(f.pos, first.transform); // 실제 메쉬를 다시 재는 것과 같은 float32 상자
      const plan = M.planFit(first.transform, again, region);
      const res = M.computeFitTransform(first.transform, again, region);
      A(plan.status === "unchanged" && res === null,
        `${tag} · ${f.name}: 다시 맞추면 무변경(null — 커밋 없음, undo 1회 유지) [${plan.status}]`);
    }
  }
  // 이미 최대 크기인데 가운데서 벗어난 모델 → 비율은 정확히 1(옮기기만) — 배율이 안 바뀌어 재설계 서포트도 유지
  {
    const region = M.modelFitRegionForProfile(TASK0_BUILT_IN_PROFILE);
    const f = FIX.tilt;
    const first = M.computeFitTransform(f.t, liveAabb(f.pos, f.t), region);
    const moved = { ...first.transform, tx: first.transform.tx + 3, tz: first.transform.tz - 2 };
    const plan = M.planFit(moved, liveAabb(f.pos, moved), region);
    const end = plan.status === "fit" ? plan.result.transform : null;
    A(end !== null && plan.result.scale === 1 && end.sx === moved.sx && end.sy === moved.sy && end.sz === moved.sz,
      `최대 크기 + 가운데서 3·2 mm 벗어남 → 비율 정확히 1, 배율 비트 동일 [${plan.status}]`);
    A(end !== null && transformKeepsRedesignValid(moved, end),
      "가운데로 옮기기만 한 맞춤은 재설계 서포트를 무효화하지 않는다(수평 이동 + 바닥 높이)");
  }
  // 이미 가운데·바닥(여유 1 µm)에 놓였지만 최대 크기보다 5 % 작은 모델 → 무변경이 아니라 맞춤(k = 1.05).
  //   대칭 영역(일반 프로파일 — 가운데 = 원점)에서는 이동량이 1e-4 mm 아래로 작아, 무변경 조건이 "이동만" 보면
  //   크기를 키워야 할 모델을 무변경으로 넘긴다(재검수 참고 1 — `k === 1 &&` 가 빠지는 변조).
  {
    const region = M.modelFitRegionForProfile(MARS);
    const availW = region.area.maxX - region.area.minX - 2 * M.FIT_MARGIN_MM;
    const w = availW / 1.05;
    const aabb = { minX: -w / 2, maxX: w / 2, minY: M.FIT_FLOOR_CLEARANCE_MM, maxY: M.FIT_FLOOR_CLEARANCE_MM + 5, minZ: -2.5, maxZ: 2.5 };
    const t = { ...FIX.cube.t, tx: 0, ty: 0, tz: 0, sx: 1, sy: 1, sz: 1 };
    const plan = M.planFit(t, aabb, region);
    A(plan.status === "fit" && Math.abs(plan.result.scale - 1.05) < 1e-9,
      `가운데·바닥에 있지만 5 % 작은 모델 → 맞춤(k 1.05, 무변경 아님) [${plan.status}${plan.status === "fit" ? " k " + plan.result.scale : ""}]`);
  }
}

// ── (c3) 맞출 수 없을 때 — 이유와 안내 문구 (검수 4) ─────────────────────
function sectionFitFailure(M, A) {
  const tinyRegion = { area: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, heightMm: 100, task0: false };
  const p1 = M.planFit(FIX.cube.t, liveAabb(FIX.cube.pos, FIX.cube.t), tinyRegion);
  A(p1.status === "impossible" && p1.reason === "space" && M.computeFitTransform(FIX.cube.t, liveAabb(FIX.cube.pos, FIX.cube.t), tinyRegion) === null,
    `영역 2×2 mm(여유 2 mm 보다 좁음) → 맞출 수 없음 "space" [${p1.status}/${p1.reason}]`);
  const region0 = M.modelFitRegionForProfile(TASK0_BUILT_IN_PROFILE);
  const huge = boxVerts(20000, 10, 10, 0); // 1 % 로 줄여도 가로 200 mm > 가용 136 mm
  const p2 = M.planFit(T(), liveAabb(huge, T()), region0);
  A(p2.status === "impossible" && p2.reason === "scale", `가로 20 m 모델 → 최소 배율(1 %)로도 안 들어감 "scale" [${p2.status}/${p2.reason}]`);
  const dot = Float32Array.from([0, 5, 0, 0, 5, 0, 0, 5, 0]);
  const p3 = M.planFit(T(), liveAabb(dot, T()), region0);
  A(p3.status === "impossible" && p3.reason === "measure", `두께 0 인 점 모델 → "measure" [${p3.status}/${p3.reason}]`);
  const msgs = ["space", "scale", "measure"].map((r) => M.describeFitFailure(r, region0));
  A(msgs.every((m) => m.startsWith("Task0 출력 가능 영역에 맞출 수 없습니다 — ")) && /여유\(2 mm\)/.test(msgs[0]) && /1 %/.test(msgs[1]),
    `안내 문구(한국어·영역 이름·이유): "${msgs[0]}"`);
  A(M.describeFitFailure("space", M.modelFitRegionForProfile(MARS)).startsWith("출력영역(빌드 크기)에 맞출 수 없습니다"),
    "일반 프로파일 문구는 출력영역(빌드 크기)");
}

// ── (b2) "보인 값 그대로" 가드 (검수 1) ──────────────────────────────────
/**
 * 숫자칸에 포커스만 주고 빠져나왔을 때 onChange 가 나가는가 — NumberInput.commit 과 같은 판정
 * (표시 문자열을 commitNumberInput → changed 이고 isValid 통과면 onBegin/onChange/onEnd).
 */
function blurFires(cur, decimals, min, max, isValid) {
  const shown = formatNumberForDisplay(cur, decimals);
  const r = commitNumberInput(shown, cur, min, max);
  return r.changed && (!isValid || isValid(r.value));
}
/** 같은 판정 — 사용자가 text 를 쳐서 커밋했을 때 */
function typedFires(text, cur, min, max, isValid) {
  const r = commitNumberInput(text, cur, min, max);
  return r.changed && (!isValid || isValid(r.value));
}
/** 패널 크기 칸의 isValid (TransformPanel 과 같은 조합 — 배선은 (f) 가 소스로 확인) */
const sizeGuard = (M, cur) => (v) => M.isValidSizeInput(v, cur) && M.isSizeInputChange(v, cur);
/** 패널 Scale(%) 칸의 isValid */
const scaleGuard = (M, curPct) => (v) => M.isScalePercentInputChange(v, curPct);

function sectionDisplayGuard(M, A) {
  A(M.SIZE_DECIMALS === 2 && M.SCALE_PERCENT_DECIMALS === 1, `표시 자릿수 상수 — 크기 ${M.SIZE_DECIMALS}, Scale ${M.SCALE_PERCENT_DECIMALS}`);
  // 크기 12.3456789 mm — 가드가 없으면 "12.35" 가 커밋되어 배율 1.00035 배(검수 재현)
  {
    const cur = 12.3456789;
    const noGuard = blurFires(cur, M.SIZE_DECIMALS, undefined, undefined, (v) => M.isValidSizeInput(v, cur));
    A(noGuard, "재현: 0·음수 거부만 있으면 크기 12.3456789 칸 포커스→빠져나오기가 커밋된다(12.35/12.3456789 = 1.00035 배)");
    A(!blurFires(cur, M.SIZE_DECIMALS, undefined, undefined, sizeGuard(M, cur)),
      "크기 12.3456789 mm 칸 포커스→빠져나오기 → onChange 없음(가드)");
    A(typedFires("13", cur, undefined, undefined, sizeGuard(M, cur)) && typedFires("12.36", cur, undefined, undefined, sizeGuard(M, cur)),
      "크기 칸에 실제로 다른 값(13, 12.36)을 치면 커밋된다");
    A(!typedFires("12.35", cur, undefined, undefined, sizeGuard(M, cur)), "보인 값과 같은 \"12.35\" 를 다시 쳐도 커밋 없음");
  }
  // Scale — 맞춤 비율 k = 2.2205 → 222.05 % ("222.1" 로 보임)
  {
    const curPct = 2.2205 * 100;
    const min = M.SCALE_PERCENT_MIN;
    const max = M.SCALE_PERCENT_MAX;
    A(blurFires(curPct, M.SCALE_PERCENT_DECIMALS, min, max, undefined), "재현: 가드가 없으면 Scale 222.05 % 칸 포커스→빠져나오기가 커밋된다");
    A(!blurFires(curPct, M.SCALE_PERCENT_DECIMALS, min, max, scaleGuard(M, curPct)),
      `Scale 222.05 %("${formatNumberForDisplay(curPct, M.SCALE_PERCENT_DECIMALS)}") 칸 포커스→빠져나오기 → onChange 없음(가드)`);
    A(typedFires("300", curPct, min, max, scaleGuard(M, curPct)) && typedFires("0", curPct, min, max, scaleGuard(M, curPct)),
      "Scale 칸에 다른 값(300, 0→1 % 클램프)을 치면 커밋된다");
  }
  // 실제 상자·실제 맞춤 배율 — 기울인 모델의 float32 크기, 각 픽스처 맞춤 결과 배율
  {
    const g = FIX.tilt;
    const size = M.toDisplaySize(liveAabb(g.pos, g.t));
    A(size.every((s) => !blurFires(s, M.SIZE_DECIMALS, undefined, undefined, sizeGuard(M, s))),
      `기울인 모델 실제 크기 ${fmt3(size)} — 세 칸 모두 포커스→빠져나오기 커밋 없음`);
    let n = 0;
    let bad = 0;
    for (const profile of [TASK0_BUILT_IN_PROFILE, MARS]) {
      const region = M.modelFitRegionForProfile(profile);
      for (const f of Object.values(FIX)) {
        const r = M.computeFitTransform(f.t, liveAabb(f.pos, f.t), region);
        if (!r) continue;
        const t = r.transform;
        for (const pct of [t.sx * 100, t.sy * 100, t.sz * 100]) {
          n++;
          if (blurFires(pct, M.SCALE_PERCENT_DECIMALS, M.SCALE_PERCENT_MIN, M.SCALE_PERCENT_MAX, scaleGuard(M, pct))) bad++;
        }
        const s = M.toDisplaySize(liveAabb(f.pos, t));
        for (const v of s) {
          n++;
          if (blurFires(v, M.SIZE_DECIMALS, undefined, undefined, sizeGuard(M, v))) bad++;
        }
      }
    }
    A(n > 0 && bad === 0, `맞춤 결과 배율·크기 ${n}칸 — 포커스→빠져나오기 커밋 ${bad}건`);
  }
  // 공용 NumberInput 규약(B-14)은 그대로 — 가드 없는 칸(Position·Rotation)은 보인 값 "90" 을 커밋한다
  A(blurFires(89.9999999, 2, -180, 180, undefined), "가드 없는 칸(Rotation)은 B-14 그대로 — 89.9999999 를 \"90\" 으로 커밋");
}

// ── (d) 맞춤 영역 출처 ───────────────────────────────────────────────────
function sectionRegion(M, A) {
  const r0 = M.modelFitRegionForProfile(TASK0_BUILT_IN_PROFILE);
  const a0 = task0PrintableAreaForProfile(TASK0_BUILT_IN_PROFILE);
  A(r0.task0 && r0.area.minX === a0.minX && r0.area.maxX === a0.maxX && r0.area.minZ === a0.minZ && r0.area.maxZ === a0.maxZ,
    `Task0 → 출력 가능 영역 X ${r0.area.minX}~${r0.area.maxX} × Z ${r0.area.minZ}~${r0.area.maxZ} (task0PrintableAreaForProfile 와 같음)`);
  A(r0.area.maxX - r0.area.minX === 140 && r0.area.maxZ - r0.area.minZ === 75, "Task0 영역 140 × 75 mm (베드 X 10~150 × Y 10~85)");
  A(r0.heightMm === TASK0_BUILT_IN_PROFILE.buildVolumeMm[2], `Task0 높이 = buildVolumeMm[2] (${r0.heightMm})`);
  const r1 = M.modelFitRegionForProfile(MARS);
  A(!r1.task0 && r1.area.minX === -143.43 / 2 && r1.area.maxX === 143.43 / 2 && r1.area.minZ === -89.6 / 2 && r1.area.maxZ === 89.6 / 2 && r1.heightMm === 175,
    `일반 → 빌드 크기 대칭 ±${143.43 / 2} × ±${89.6 / 2}, 높이 175 (checkBuildVolume 과 같은 모양)`);
}

// ── (e) 서포트 추종 시뮬레이션 ───────────────────────────────────────────
//   useTransformCommit: world 서포트(자동·수동)는 contact = transformPointBetween(contact, start, end),
//   base = 새 contact 바로 아래(다른 모델이 없으면 Y = 0). 발판 반지름 = 바닥 지름 / 2.
function supportBoxes(contacts, radius, parentId) {
  return contacts.map((c) => ({
    parentId,
    aabb: { minX: c[0] - radius, maxX: c[0] + radius, minY: 0, maxY: c[1], minZ: c[2] - radius, maxZ: c[2] + radius },
  }));
}
function sectionSupports(M, A) {
  const f = FIX.cube;
  const start = T({ tx: 40, tz: 25 }); // 영역 귀퉁이 쪽에 둔 큐브
  const aabb0 = liveAabb(f.pos, start);
  const region = M.modelFitRegionForProfile(TASK0_BUILT_IN_PROFILE);
  const fit = M.computeFitTransform(start, aabb0, region);
  const area = region.area;
  // 최악 = 모델 상자 모서리(바닥 네 귀퉁이)에 붙은 접점 + 옆면 가운데
  const contacts0 = [
    [aabb0.minX, aabb0.minY, aabb0.minZ],
    [aabb0.maxX, aabb0.minY, aabb0.minZ],
    [aabb0.minX, aabb0.minY, aabb0.maxZ],
    [aabb0.maxX, aabb0.minY, aabb0.maxZ],
    [aabb0.maxX, (aabb0.minY + aabb0.maxY) / 2, (aabb0.minZ + aabb0.maxZ) / 2],
  ];
  const contacts1 = contacts0.map((c) => transformPointBetween(c, start, fit.transform));
  const actual = liveAabb(f.pos, fit.transform);
  const onSurface = contacts1.every((c) =>
    c[0] >= actual.minX - 1e-3 && c[0] <= actual.maxX + 1e-3 && c[2] >= actual.minZ - 1e-3 && c[2] <= actual.maxZ + 1e-3);
  A(onSurface, "맞춤 커밋의 접점 추종(transformPointBetween)이 맞춘 모델 상자 위에 남는다");
  const models = [{ id: "m", aabb: actual }];
  const rDef = DEFAULT_SUPPORT_PARAMS.baseDiameterMm / 2;
  const okDef = checkItemsInPrintableArea(models, supportBoxes(contacts1, rDef, "m"), area, region.heightMm);
  A(okDef.length === 0, `기본 바닥 지름 ${DEFAULT_SUPPORT_PARAMS.baseDiameterMm} mm(발판 반지름 ${rDef}) — 서포트 포함 출력 가능 영역 검사 통과 (위반 ${okDef.length}건)`);
  const rBig = 3; // 바닥 지름 6 mm — 발판 반지름 > 여유 2 mm
  const big = checkItemsInPrintableArea(models, supportBoxes(contacts1, rBig, "m"), area, region.heightMm);
  A(big.length > 0 && big.every((e) => e.kind === "support"),
    `바닥 지름 6 mm(반지름 ${rBig} > 여유 ${M.FIT_MARGIN_MM}) 귀퉁이 서포트는 영역을 벗어날 수 있고, 검사가 그것을 잡는다(빨간 박스 — 조용히 넘어가지 않음, ${big.length}건)`);
  // 재설계 서포트(island/slope)는 배율이 바뀌면 무효화(B-1 정책 — 삭제 + 안내, undo 로 복원)
  A(!transformKeepsRedesignValid(start, fit.transform), "맞춤(배율 변경)은 재설계 서포트를 무효화한다 — 기존 Scale 과 같은 B-1 정책(삭제 + 안내, Ctrl+Z 복원)");
}

// ── (f) 배선 정적 검사 ───────────────────────────────────────────────────
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const readV2 = (...p) => fs.readFileSync(path.join(V2, ...p), "utf8");

/** `function name(` 의 본문 { ... } (중괄호 짝 맞춤) */
function fnBody(src, name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return "";
  const open = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}
const count = (s, re) => (s.match(re) || []).length;

function wiringPanel(panelRaw, A) {
  const panel = stripComments(panelRaw);
  const size = fnBody(panel, "applySizeField");
  const scale = fnBody(panel, "applyScaleField");
  const core = fnBody(panel, "applyScale");
  const fit = fnBody(panel, "fitToRegion");
  A(/applyScale\(/.test(size) && /sizeInputToScale\(/.test(size) && !/onCommit\(/.test(size) && !/setLocal\(/.test(size) && !/onPreview\(/.test(size),
    "크기 입력(applySizeField)은 sizeInputToScale → applyScale 만 부른다 (자체 커밋·미리보기 없음)");
  A(/applyScale\(/.test(scale), "Scale(%) 입력(applyScaleField)도 같은 applyScale 경로");
  A(/withPivot\(/.test(core) && /latestRef\.current = next/.test(core) && /onPreview\(/.test(core) && !/onCommit\(/.test(core),
    "applyScale = 기존 Scale 흐름(withPivot → latestRef → 미리보기), 커밋은 endDrag 몫");
  // 크기 숫자칸 — beginDrag/endDrag 로 undo 한 묶음, 거부 검사
  const at = panel.indexOf("applySizeField(i");
  const open = panel.lastIndexOf("<NumberInput", at);
  const close = panel.indexOf("/>", at);
  const jsx = open >= 0 && close > at ? panel.slice(open, close) : "";
  A(/onBegin=\{beginDrag\}/.test(jsx) && /onEnd=\{endDrag\}/.test(jsx) && /isValid=\{/.test(jsx) && /value=\{displaySize\[i\]\}/.test(jsx),
    "크기 칸: onBegin=beginDrag · onEnd=endDrag(undo 1회) · isValid(거부) · 값 = 라이브 표시 크기");
  // 보인 값 그대로 가드 (검수 1) — 크기 칸·Scale 칸만, 표시 자릿수 상수 공유
  A(/decimals=\{SIZE_DECIMALS\}/.test(jsx) && /isValidSizeInput\(v, displaySize\[i\]\)\s*&&\s*isSizeInputChange\(v, displaySize\[i\]\)/.test(jsx),
    "크기 칸: decimals = SIZE_DECIMALS, isValid = 0·음수 거부 && 보인 값 그대로 거부(isSizeInputChange)");
  const sAt = panel.indexOf("applyScaleField(i");
  const sJsx = sAt >= 0 ? panel.slice(panel.lastIndexOf("<NumberInput", sAt), panel.indexOf("/>", sAt)) : "";
  A(/decimals=\{SCALE_PERCENT_DECIMALS\}/.test(sJsx) && /isValid=\{\(v\) => isScalePercentInputChange\(v, displayScale\[i\] \* 100\)\}/.test(sJsx),
    "Scale(%) 칸: decimals = SCALE_PERCENT_DECIMALS, isValid = 보인 값 그대로 거부(isScalePercentInputChange)");
  A(!/isValid=/.test(fnBody(panel, "Row")),
    "Position·Rotation 칸(Row)은 가드 없음 — B-14 \"보인 값 = 적용값\" 그대로");
  A(count(fit, /onCommit\(/g) === 1 && count(fit, /onPreview\(/g) === 1 && /planFit\(/.test(fit),
    `맞춤(fitToRegion): planFit → 미리보기 1회 + onCommit 1회 (onCommit ${count(fit, /onCommit\(/g)}회)`);
  const unchangedAt = fit.indexOf('plan.status === "unchanged"');
  A(unchangedAt >= 0 && unchangedAt < fit.indexOf("onCommit("),
    "맞춤: 이미 맞춰져 있으면(unchanged) 커밋 전에 끝낸다 — 연타해도 undo 1회");
  A(/window\.alert\(describeFitFailure\(plan\.reason, fitRegion\)\)/.test(fit) && fit.indexOf("window.alert(") < fit.indexOf("onCommit("),
    "맞춤: 맞출 수 없으면 안내(window.alert — 기존 알림 수단) 후 끝낸다");
  A(/onClick=\{fitToRegion\}/.test(panel), "맞춤 버튼 onClick = fitToRegion");
  A(count(panel, /onCommit\(/g) === 4,
    `패널 전체 onCommit 호출 4곳(endDrag·Reset·회전 버튼·맞춤) — 크기 입력용 새 커밋 경로 없음 (${count(panel, /onCommit\(/g)})`);
  A(/min=\{SCALE_PERCENT_MIN\}/.test(panel) && /max=\{SCALE_PERCENT_MAX\}/.test(panel),
    "Scale(%) 칸 min/max = model-size 의 SCALE_PERCENT_* (배율 한계 단일 소스)");
  A(/getAabb \? getAabb\(\) : null/.test(panel) && /toDisplaySize\(liveAabb\)/.test(panel),
    "표시 크기 = 렌더 시점 라이브 게터(getAabb) → toDisplaySize");
}

function sectionWiring(A) {
  wiringPanel(readV2("components", "TransformPanel.tsx"), A);

  const side = stripComments(readV2("pages", "viewer", "components", "ViewerSidePanel.tsx"));
  A(/getAabb=\{getTransformAabb\}/.test(side) && /fitRegion=\{fitRegion\}/.test(side), "ViewerSidePanel → TransformPanel 에 getAabb·fitRegion 전달");
  const page = stripComments(readV2("pages", "ViewerV2Page.tsx"));
  A(/sceneHandleRef\.current\?\.getModelWorldAabb\(selectedFileId\)/.test(page), "페이지 게터 = 씬 핸들 getModelWorldAabb (규칙 2 — handle 경유)");
  A(/fitRegion=\{modelFitRegionForProfile\(printerProfile\)\}/.test(page) &&
    /printableAreaMm=\{task0PrintableAreaForProfile\(printerProfile\)\}/.test(page) &&
    /plateHeightMm=\{printerProfile\.buildVolumeMm\[2\]\}/.test(page),
    "맞춤 영역과 빨간 박스가 같은 printerProfile 에서 나온다");
  const ms = stripComments(fs.readFileSync(MODEL_SIZE_TS, "utf8"));
  A(/task0PrintableAreaForProfile\(p\)/.test(ms) && /p\.buildVolumeMm/.test(ms), "modelFitRegionForProfile = task0PrintableAreaForProfile + buildVolumeMm");
  const handle = stripComments(readV2("components", "babylon", "handle", "transform-handle.ts"));
  const hb = handle.slice(handle.indexOf("getModelWorldPivot(id)"), handle.indexOf("autoRouteBridge(base"));
  const builderHead = handle.slice(handle.indexOf("export function buildTransformHandle("), handle.indexOf("return {"));
  A(/const bounds = createModelBoundsCache\(\);/.test(builderHead) && /return bounds\.pivot\(mesh\);/.test(hb) && /return bounds\.worldAabb\(mesh\);/.test(hb),
    "핸들 getModelWorldPivot·getModelWorldAabb = 씬당 캐시 하나(createModelBoundsCache, 핸들 조립 때 1회)");
  const cache = stripComments(fs.readFileSync(BOUNDS_CACHE_TS, "utf8"));
  const wa = cache.slice(cache.indexOf("worldAabb(mesh) {"), cache.indexOf("pivot(mesh) {"));
  A(/mesh\.computeWorldMatrix\(true\);/.test(wa) && /positionsWorldAabb\(positions, world\)/.test(wa) && /meshWorldBBoxCenter\(mesh\)/.test(cache),
    "캐시: computeWorldMatrix(true) 후 읽고, 아핀 아니면 positionsWorldAabb(검사와 같은 순회), 피벗 첫 계산은 meshWorldBBoxCenter");
  const bvc = stripComments(readV2("components", "babylon", "hooks", "useBuildVolumeCheck.ts"));
  const wvb = fnBody(bvc, "worldVertexAabb");
  A(/export function worldVertexAabb\(/.test(bvc) && /export function positionsWorldAabb\(/.test(bvc) &&
    /positionsWorldAabb\(\s*mesh\.getVerticesData\(VertexBuffer\.PositionKind\),\s*mesh\.getWorldMatrix\(\),?\s*\)/.test(wvb) &&
    count(bvc, /worldVertexAabb\((mesh|sm)\)/g) === 3,
    "useBuildVolumeCheck: worldVertexAabb = positionsWorldAabb(정점, world) — 순회만 분리, 검사 호출 3곳 그대로");
  const ni = stripComments(readV2("components", "common", "NumberInput.tsx"));
  const commit = fnBody(ni, "commit");
  A(commit.indexOf("isValid(result.value)") >= 0 && commit.indexOf("isValid(result.value)") < commit.indexOf("onBegin?.()"),
    "NumberInput: 거부 검사가 onBegin 보다 먼저 — 거부된 입력은 undo 묶음도 미리보기도 안 만든다");

  // BabylonScene 훅 호출 순서 불변 (불변식 1) — 이 작업은 핸들 메서드만 추가
  const scene = stripComments(readV2("components", "BabylonScene.tsx"));
  const bodyAt = scene.indexOf("function BabylonScene(");
  const calls = [...scene.slice(bodyAt).matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]);
  const EXPECTED = [
    "useSceneRefs", "useSupportPartsReady", "useSceneBootstrap", "useState", "useFileMeshSync",
    "useSupportMeshSync", "useSelectionSync", "useSlicePreview", "useBridgeVisualization",
    "useEditModeSync", "useDentalBrush", "useBuildVolumeCheck", "useAlignFloorHover", "useImperativeHandle",
  ];
  A(bodyAt >= 0 && JSON.stringify(calls) === JSON.stringify(EXPECTED), `BabylonScene 훅 호출 순서 무변경 (${calls.length}개)`);
}

// ── (h) 피벗·크기 상자 캐시 (검수 3) ─────────────────────────────────────
//   실제 Babylon Mesh(NullEngine) — getVerticesData 의 배열 정체·computeWorldMatrix·getBoundingInfo 가 앱과 같다.
const { NullEngine, Scene, Mesh, VertexData, Matrix: BMatrix } = await import("@babylonjs/core");
const ENGINE = new NullEngine();
const SCENE = new Scene(ENGINE);

function makeMesh(nVerts, seed) {
  const pos = new Float32Array(nVerts * 3);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = (rnd() - 0.5) * 37.3;
    pos[i + 1] = 5 + rnd() * 21.7;
    pos[i + 2] = (rnd() - 0.5) * 29.1;
  }
  const m = new Mesh(`verify-bounds-${seed}`, SCENE);
  const vd = new VertexData();
  vd.positions = pos;
  vd.indices = Uint32Array.from({ length: nVerts }, (_, i) => i);
  vd.applyToMesh(m, true);
  m.refreshBoundingInfo();
  return m;
}
const KEYS6 = ["minX", "minY", "minZ", "maxX", "maxY", "maxZ"];
/** 캐시 없이(원래 경로) — 핸들의 예전 getModelWorldAabb */
function directAabb(mesh) {
  mesh.computeWorldMatrix(true);
  return worldVertexAabb(mesh);
}

function sectionCache(C, A) {
  const mesh = makeMesh(3000, 4242);
  // 기대값은 같은 정점의 **다른** 메쉬에서 원래 경로로 구한다 — 비교용 refreshBoundingInfo 가 캐시 쪽 메쉬에
  //   부작용을 남겨 캐시 결함을 가리지 않게.
  const ref = makeMesh(3000, 4242);
  const cache = C.createModelBoundsCache();
  const sameBits = (a, b) => a !== null && b !== null && KEYS6.every((k) => a[k] === b[k]);
  // 자세 순서: 처음 → 같은 자세 → 이동만 → 회전 → 배율 → 회전+이동 → 비균일 → 처음 자세로 복귀
  const poses = [
    ["처음", T({ tx: 3, rx: 10, ry: 20 }), "scan"],
    ["같은 자세 그대로", T({ tx: 3, rx: 10, ry: 20 }), "hit"],
    ["이동만(POSITION)", T({ tx: -41.7, ty: 6.25, tz: 13.1, rx: 10, ry: 20 }), "hit"],
    ["회전", T({ tx: -41.7, ty: 6.25, tz: 13.1, rx: 33, ry: -71, rz: 12 }), "scan"],
    ["배율", T({ tx: -41.7, ty: 6.25, tz: 13.1, rx: 33, ry: -71, rz: 12, sx: 2.2205, sy: 2.2205, sz: 2.2205 }), "scan"],
    ["회전+이동", T({ tx: 7, ty: -2, tz: 0.5, rx: 90, ry: 45, sx: 1.3, sy: 0.7, sz: 2 }), "scan"],
    ["이동만 다시", T({ tx: 70, ty: 12, tz: -30, rx: 90, ry: 45, sx: 1.3, sy: 0.7, sz: 2 }), "hit"],
    ["처음 자세로 복귀", T({ tx: 3, rx: 10, ry: 20 }), "scan"],
  ];
  let okAabb = true;
  let okPivot = true;
  let okCount = true;
  const notes = [];
  for (const [name, t, expect] of poses) {
    applyTransformToMesh(mesh, t);
    applyTransformToMesh(ref, t);
    const scans0 = cache.stats.aabbScans;
    const got = cache.worldAabb(mesh);
    const scanned = cache.stats.aabbScans - scans0;
    const want = directAabb(ref);
    const pv = cache.pivot(mesh);
    const c = meshWorldBBoxCenter(ref);
    if (!sameBits(got, want)) { okAabb = false; notes.push(`${name}: 상자 다름`); }
    if (!(pv[0] === c.x && pv[1] === c.y && pv[2] === c.z)) { okPivot = false; notes.push(`${name}: 피벗 다름`); }
    if ((expect === "hit") !== (scanned === 0)) { okCount = false; notes.push(`${name}: 순회 ${scanned}회(기대 ${expect})`); }
  }
  A(okAabb, `캐시 상자 = 원래 경로(worldVertexAabb) 비트 동일 — 자세 ${poses.length}가지 ${notes.join(" / ")}`);
  A(okPivot, "캐시 피벗 = meshWorldBBoxCenter 비트 동일 — 같은 자세들");
  A(okCount, `같은 자세·이동만이면 다시 훑지 않고(캐시), 회전·배율이 바뀌면 새로 훑는다 (순회 ${cache.stats.aabbScans}회 / 자세 ${poses.length})`);
  A(cache.stats.pivotRefreshes === 1, `피벗 로컬 상자 재계산은 정점이 같으면 처음 1회뿐 (${cache.stats.pivotRefreshes}회)`);

  // 정점 교체(setVerticesData — 로드 경로와 같은 "새 배열") → 새 값
  {
    const old = mesh.getVerticesData("position");
    const scaled = Float32Array.from(old, (v, i) => (i % 3 === 1 ? v * 1.5 : v + 2));
    mesh.setVerticesData("position", scaled, true);
    ref.setVerticesData("position", Float32Array.from(scaled), true);
    const scans0 = cache.stats.aabbScans;
    const refresh0 = cache.stats.pivotRefreshes;
    const got = cache.worldAabb(mesh);
    const pv = cache.pivot(mesh);
    const c = meshWorldBBoxCenter(ref);
    A(mesh.getVerticesData("position") !== old && sameBits(got, directAabb(ref)) && cache.stats.aabbScans === scans0 + 1,
      "정점을 새 배열로 바꾸면(같은 자세여도) 다시 훑어 새 상자 — 정점 배열 정체가 키");
    A(pv[0] === c.x && pv[1] === c.y && pv[2] === c.z && cache.stats.pivotRefreshes === refresh0 + 1,
      "정점을 바꾸면 피벗도 로컬 상자를 다시 만든다");
    // Babylon 이 같은 배열을 계속 돌려주는지(캐시가 실제로 맞으려면 필요) — 정체 안정
    A(mesh.getVerticesData("position") === mesh.getVerticesData("position"), "getVerticesData(Position) 는 같은 배열을 돌려준다(정체 키가 유효)");
  }
  // 아핀이 아닌 world 행렬(투영 성분) → 캐시 안 쓰고 매번 원래 순회
  {
    const pos = Float32Array.from([1, 2, 3, -4, 5, 6, 7, -8, 9]);
    const w = BMatrix.Identity();
    w.setRowFromFloats(0, 1, 0, 0, 0.01);
    const fake = { computeWorldMatrix() {}, getVerticesData: () => pos, getWorldMatrix: () => w };
    const s0 = cache.stats.aabbScans;
    const a1 = cache.worldAabb(fake);
    const a2 = cache.worldAabb(fake);
    A(sameBits(a1, positionsWorldAabb(pos, w)) && sameBits(a2, a1) && cache.stats.aabbScans === s0 + 2,
      "투영 성분이 있는 행렬이면 캐시 없이 positionsWorldAabb 그대로(매번 순회)");
  }
  mesh.dispose();
  ref.dispose();
}

// ── (g) 대조군 ────────────────────────────────────────────────────────────
/** 소스(기본 model-size.ts)를 변조해 frontend/scripts 아래 임시 폴더에 쓰고 import (상대 import 는 원본 절대 URL 로) */
async function loadMutant(tag, edits, srcFile = MODEL_SIZE_TS) {
  // CRLF 체크아웃에서도 변조 문자열(\n 포함)이 맞도록 줄바꿈을 LF 로 맞춘다.
  let src = fs.readFileSync(srcFile, "utf8").replace(/\r\n/g, "\n");
  for (const [from, to] of edits) {
    if (!src.includes(from)) throw new Error(`변조 대상 문자열이 소스에 없음 (${tag}): ${from}`);
    src = src.split(from).join(to);
  }
  const dir0 = path.dirname(srcFile);
  src = src.replace(/from "(\.{1,2}\/[^"]+)"/g, (_, p) => `from "${pathToFileURL(path.join(dir0, `${p}.ts`)).href}"`);
  // 임시 폴더는 frontend 아래 — "@babylonjs/core" 같은 패키지 import 가 node_modules 로 풀리게.
  const dir = fs.mkdtempSync(path.join(__dirname, ".tmp-verify-model-size-"));
  const file = path.join(dir, `${path.basename(srcFile, ".ts")}.${tag}.ts`);
  fs.writeFileSync(file, src, "utf8");
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function sectionControls() {
  const run = (M, sections) => {
    const c = collector();
    for (const s of sections) s(M, c.assert);
    return c;
  };
  // must = 반드시 실패해야 하는 단언의 문구 일부 — 엉뚱한 단언만 깨지고 핵심 판정은 통과하는 변조를 놓치지 않게.
  const expectFail = (tag, c, must) => {
    const hit = must ? c.msgs.find((m) => m.includes(must)) : c.first;
    assert(c.fails > 0 && hit !== undefined, `대조군 ${tag}: 변조하면 ${c.fails}건 FAIL — "${must ?? ""}" 포함 (예: ${hit ?? c.first ?? "—"})`);
  };

  // 0) 원본은 같은 절에서 0건 (대조군 판정이 원본에서 새지 않는지)
  {
    const c = run(REAL, [sectionDisplay, sectionSizeInput, sectionDisplayGuard, sectionFit, sectionRefit, sectionFitFailure, sectionRegion, sectionSupports]);
    const cc = run(REAL_CACHE, [sectionCache]);
    assert(c.fails === 0 && cc.fails === 0, `대조군 기준: 원본 모듈은 같은 절에서 FAIL 0건 (${c.fails} · 캐시 ${cc.fails})`);
  }
  // a) 축 규약 뒤집기 — 크기에 축 교환을 안 하면(내부 Y 를 표시 Y 로) 판의 표시 Y/Z 가 바뀐다
  expectFail("a 축 규약 뒤집기(축 교환 제거)", run(
    await loadMutant("axis", [["return swapScaleAxes([\n    aabb.maxX", "return ([\n    aabb.maxX"]]),
    [sectionDisplay],
  ), "표시 크기");
  // b) 비율 유지 무시 — 켜져 있어도 한 축만 바뀐다
  expectFail("b 비율 유지 무시", run(
    await loadMutant("uniform", [["const local = a.uniform ? null : axisAlignedLocalAxes(a.rotationDeg);", "const local = axisAlignedLocalAxes(a.rotationDeg);"]]),
    [sectionSizeInput],
  ), "(비율 유지)");
  // c) 여유 무시 — 영역 경계에 붙어 "여유 2 mm 안" 을 벗어난다
  expectFail("c 여유 무시", run(
    await loadMutant("margin", [
      ["const availW = area.maxX - area.minX - 2 * marginMm;", "const availW = area.maxX - area.minX;"],
      ["const availD = area.maxZ - area.minZ - 2 * marginMm;", "const availD = area.maxZ - area.minZ;"],
    ]),
    [sectionFit],
  ), "여유 2 mm 안");
  // d) 높이 무시 — 기둥이 빌드 높이를 넘는다(빨간 박스 aboveMax)
  expectFail("d 높이 무시", run(
    await loadMutant("height", [["if (hasHeight && h > DEGENERATE_MM) ratios.push(availH / h);", ""]]),
    [sectionFit],
  ), "기둥 10×10×300 [높이 제한]: 맞춘 정점 상자가 빨간 박스 판정 통과");
  // e) Task0 인데 일반 빌드 크기(대칭 플레이트) — 비대칭 출력 가능 영역을 벗어난다
  expectFail("e Task0 인데 빌드 크기 사용", run(
    await loadMutant("task0", [["const task0Area = task0PrintableAreaForProfile(p);", "const task0Area = null;"]]),
    [sectionFit, sectionRegion],
  ), "Task0 · 큐브 20: 맞춘 정점 상자가 빨간 박스 판정 통과");
  // f) 바닥 여유 제거 — float32 world 행렬 잡음으로 최저점이 플레이트 아래(−3e-6 mm)
  expectFail("f 바닥 여유(1 µm) 제거", run(
    await loadMutant("floor", [["const bottomY = Math.max(FIT_FLOOR_CLEARANCE_MM, aabb.minY);", "const bottomY = Math.max(0, aabb.minY);"]]),
    [sectionFit],
  ), "바닥 0 큐브 X 90°: 맞춘 정점 상자가 빨간 박스 판정 통과");
  // g) 배선 — 맞춤이 커밋을 두 번(undo 2회) / 크기 입력이 Scale 경로를 우회해 직접 커밋
  const panelSrc = readV2("components", "TransformPanel.tsx").replace(/\r\n/g, "\n");
  const mutPanel = (from, to) => {
    if (!panelSrc.includes(from)) throw new Error(`변조 대상 문자열이 TransformPanel 에 없음: ${from}`);
    return panelSrc.split(from).join(to);
  };
  {
    const c = collector();
    wiringPanel(mutPanel(
      "    onCommit(selected!.id, start, end);\n",
      "    onCommit(selected!.id, start, end);\n    onCommit(selected!.id, start, end);\n",
    ), c.assert);
    expectFail("g1 맞춤 이중 커밋", c, "onCommit 1회");
  }
  {
    const c = collector();
    wiringPanel(mutPanel(
      "    applyScale((src) =>\n      sizeInputToScale({",
      "    onCommit(selected!.id, local, local);\n    ((src) =>\n      sizeInputToScale({",
    ), c.assert);
    expectFail("g2 크기 입력이 Scale 경로 우회·직접 커밋", c, "applyScale 만 부른다");
  }
  // h) 보인 값 그대로 가드 제거 (검수 1) — 함수 쪽 / 배선 쪽 각각
  expectFail("h1 크기 칸 가드 함수 무력화", run(
    await loadMutant("size-guard", [["return changesDisplayedValue(v, cur, SIZE_DECIMALS);", "return true;"]]),
    [sectionDisplayGuard],
  ), "크기 12.3456789 mm 칸 포커스→빠져나오기 → onChange 없음");
  expectFail("h2 Scale 칸 가드 함수 무력화", run(
    await loadMutant("scale-guard", [["return changesDisplayedValue(v, cur, SCALE_PERCENT_DECIMALS);", "return true;"]]),
    [sectionDisplayGuard],
  ), "Scale 222.05 %");
  {
    const c = collector();
    wiringPanel(mutPanel(
      "isValidSizeInput(v, displaySize[i]) &&\n                    isSizeInputChange(v, displaySize[i])",
      "isValidSizeInput(v, displaySize[i])",
    ), c.assert);
    expectFail("h3 크기 칸 배선에서 가드 빼기", c, "크기 칸: decimals = SIZE_DECIMALS");
  }
  {
    const c = collector();
    wiringPanel(mutPanel(
      "                isValid={(v) => isScalePercentInputChange(v, displayScale[i] * 100)}\n",
      "",
    ), c.assert);
    expectFail("h4 Scale 칸 배선에서 가드 빼기", c, "Scale(%) 칸: decimals");
  }
  // i) 재맞춤 무변경 가드 제거 (검수 2) — 연타하면 잡음 커밋이 다시 생긴다
  expectFail("i 재맞춤 무변경 가드 제거", run(
    await loadMutant("refit", [['return { status: "unchanged" };', ";"]]),
    [sectionRefit],
  ), "다시 맞추면 무변경");
  // i2) 무변경 조건에서 비율 조건 빼기 (재검수 참고 1) — 가운데·바닥에 놓인 작은 모델을 키우지 않고 넘긴다
  expectFail("i2 무변경 조건에서 k === 1 빼기", run(
    await loadMutant("refit-k", [["    k === 1 &&\n", ""]]),
    [sectionRefit],
  ), "5 % 작은 모델");
  // j) 캐시 (검수 3) — 회전 키 빼기 / 이동 더하기 빼기 / 정점 키 빼기
  expectFail("j1 캐시 키에서 선형부(회전·배율) 빼기", run(
    await loadMutant("cache-linear", [["if (!lin || !LINEAR_IDX.every((k, i) => lin[i] === m[k])) {", "if (!lin) {"]], BOUNDS_CACHE_TS),
    [sectionCache],
  ), "캐시 상자 = 원래 경로");
  expectFail("j2 캐시 이동 더하기 빼기", run(
    await loadMutant("cache-shift", [["minX: a.minX + m[12],", "minX: a.minX,"]], BOUNDS_CACHE_TS),
    [sectionCache],
  ), "캐시 상자 = 원래 경로");
  expectFail("j3 캐시 키에서 정점 배열 빼기", run(
    await loadMutant("cache-positions", [["if (!e || e.positions !== positions) {", "if (!e) {"]], BOUNDS_CACHE_TS),
    [sectionCache],
  ), "정점을 새 배열로 바꾸면");
  expectFail("j4 캐시 안 쓰기(같은 상태도 매번 순회)", run(
    await loadMutant("cache-off", [["if (!lin || !LINEAR_IDX.every((k, i) => lin[i] === m[k])) {", "if (true) {"]], BOUNDS_CACHE_TS),
    [sectionCache],
  ), "같은 자세·이동만이면 다시 훑지 않고");
  // 임시 폴더가 남지 않았는지
  const left = fs.readdirSync(__dirname).filter((n) => n.startsWith(".tmp-verify-model-size-"));
  assert(left.length === 0, "대조군 임시 폴더 정리됨");
}

// ── 실행 ──────────────────────────────────────────────────────────────────
console.log("(a) 크기 표시 — world AABB → 표시 X/Y/Z mm (Z-up, 축 교환):");
sectionDisplay(REAL, assert);
console.log("\n(b) 크기 입력 → 배율 (패널 Scale 경로로 적용 후 실제 정점 상자 재측정):");
sectionSizeInput(REAL, assert);
console.log("\n(b2) \"보인 값 그대로\" 가드 — 크기·Scale 칸 포커스→빠져나오기는 커밋 없음 (검수 1):");
sectionDisplayGuard(REAL, assert);
console.log("\n(c) 출력 영역에 맞춤 — Task0 영역 · 일반 빌드 크기, 빨간 박스 판정 함수로 확인:");
sectionFit(REAL, assert);
console.log("\n(c2) 다시 맞추면 무변경 (검수 2):");
sectionRefit(REAL, assert);
console.log("\n(c3) 맞출 수 없을 때 — 이유·안내 (검수 4):");
sectionFitFailure(REAL, assert);
console.log("\n(d) 맞춤 영역 출처:");
sectionRegion(REAL, assert);
console.log("\n(e) 서포트 추종 시뮬레이션 (Task0 — 서포트 포함 검사):");
sectionSupports(REAL, assert);
console.log("\n(f) 배선 정적 검사:");
sectionWiring(assert);
console.log("\n(h) 피벗·크기 상자 캐시 — 실제 Babylon Mesh, 원래 경로와 비트 동일·같으면 재순회 없음 (검수 3):");
sectionCache(REAL_CACHE, assert);
console.log("\n(g) ★ 대조군 — 변조하면 위 단언이 실제로 FAIL 하는가:");
await sectionControls();
ENGINE.dispose();

console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
