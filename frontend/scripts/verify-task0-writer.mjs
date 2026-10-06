// Task0 G-code writer 헤드리스 검증 (로드맵 0절 2주차 PR-1 Z1-a2).
//
//   무엇을: src/features/v2/utils/task0/task0-gcode-writer.ts (+ task0-frame.ts) 가 규격서 v0.3.3
//     (Task0 리포 docs/Task0_Gcode_규격서_초안.md @ dfdf08c) 대로 G-code 를 쓰는지 본다.
//     설계 = docs/계획_Z1_task0출력_20261002.md S1~S9.
//
//   (0) 좌표 모듈 — worldToBed·베드↔픽셀·층 수/Z/단면 식(마스크 runPngZip 과 같은 식인지).
//   (A) 픽스처(스크립트 안에서 world 삼각형 직접 생성, 바깥 법선 감김 + normalizeTriangleWinding):
//       ① 10 mm 정육면체 ② 속 빈 사각 관(구멍 보존) ③ 겹친 두 정육면체(nonzero — even-odd 면 구멍)
//       ④ 한 행에 섬 둘(넓은 틈 → 행 안 리트랙트 / 좁은 틈 → 생략) ⑤ 두 판 사이 한 층 틈(빈 층)
//       ⑥ 바닥이 뜬 상자(첫 층들이 빈 층 — 계획서 §3 열린 질문의 잠정 동작)
//       ⑦ 45° 마름모 기둥(행마다 폭이 달라 L자에 X 다리, 빗변 교차) ⑧ 면을 맞댄 두 메시(맞닿은 구간 잇기)
//       ⑨ 10 × 10.3 mm 상자(Y 폭이 w 배수가 아님 — 행 종료 조건·맨 위 남는 띠 통계) × lh 0.1 · 0.05.
//     출력마다 검사:
//       c1 Task0 파서 이식판 dryrun(keepE false/true)·print(layerHeightMm) 모두 warnings 0·errors 0,
//          layerCount = task0LayerCount(topY, lh), 빈 층 블록 hasXy=false (기대 빈 층 = 기하로 따로 계산)
//       c2 줄 형식(허용된 줄 모양만) — 지수·-0·인라인 주석·F 단독 줄 0, 층 첫 이동 = F 없는 순수 G1 Z,
//          그 뒤 Z 줄 0, 프리앰블 G90/M83/T0, START 앞 메타, 끝 개행 1개
//       c3 리트랙트 상태 시뮬레이션 — 첫 사용 전 E+r 없음, 도포 줄은 언리트랙트 상태, 도포한 층 끝은 리트랙트,
//          ≥ retractMinTravel 트래블을 언리트랙트로 하지 않음(첫 사용 전 트래블 제외), 빈 층 E 줄 0
//       c4 트래블 교차 0 — 트래블 경로(연속 트래블 = 한 경로)를 양 끝 w/2 씩 줄인 나머지가 그 층에서
//          이미 칠한 줄(폭 w)에서 w/2 − 1e-6 미만으로 다가가지 않음
//       c4b (Z1-b2 보강) 트래블 다리(선분)와 그 시점까지 칠한 중심선의 **실제 교차 0** — 잘라내기 없이 정수 µm 로.
//          제외: 트래블 시작점(직전 도포 끝)·끝점(다음 도포 시작)에서의 한 점 접촉, 첫 다리가 직전 도포 선분을 거꾸로
//          되짚는 겹침(통계로만 셈 — Z2 이후 과제). 길이 ≤ w 라 c4 가 못 보는 짧은 트래블도 검사된다.
//       c5 (Z1-b2 갱신) +Y 단조를 **띠 해상도**로: 띠 k = [Y0 + k·w, Y0 + (k+1)·w), Y0 = 단면 최소 Y(독립 참조).
//          도포 줄 띠(= 중점 y 의 띠) 층 안 비감소, 줄 양 끝이 그 띠 안(띠 경계에서 잘림), 도포가 있는 띠마다
//          방향 번갈아(첫 띠 +X) — 행 줄은 띠 방향으로, 띠 안 항목(트래블 없이 이어진 도포 묶음)은 방향 순서
//          (+X 면 최소 x 비감소, −X 면 최대 x 비증가), 행 줄끼리 간격 = w 정수배·한 행 안 구간 간격 ≥ w,
//          길이 0 도포 줄 없음, 층 첫 트래블 = 직선 1줄, 도포 없이 끝나는 트래블 없음.
//          채움이 없는 층(도포 줄이 모두 행 줄)은 Z1-a2 트래블 모양도 그대로(행 안 = 수평 1줄, 행 사이 = L자).
//          행만 있는 기존 출력은 띠 = 행이라 예전 c5 와 같은 판정이다.
//       c6 E — 모든 도포 줄에서 |출력 누적 − 정확 누적| ≤ 0.5e-5(잔차 이월), |E| ≤ 500
//       c7 좌표가 출력 가능 영역(X 10~150 × Y 10~85) 안
//       c8 검사기가 **독립 계산**한 nonzero 행 구간(w/2 축소·1 µm 격자)과 행 줄이 일치(행 줄 = 행 높이의 수평 도포 중
//          참조 구간과 같은 것, 나머지는 채움 줄), 행 줄 도포 띠(y ± w/2)가 단면 Y 범위 안 + 픽스처별 단언
//          (관: 구멍 안 도포 0 / 겹침: 겹친 구간이 끊기지 않음 + even-odd 였다면 끊겼을 것 / 섬: 리트랙트 여부)
//       c9 결정성 — 새 배열로 두 번 생성 → 같은 바이트, 입력 배열 무변경
//       통계 — writer 의 층별 통계가 G-code 에서 다시 잰 값과 같음 (Z2 시간 추정 입력, 채움 줄 수 포함)
//   (A2) 얇은 부분 채움 픽스처 (Z1-b2): ⑩ 0.4 mm 벽 속 빈 관(10 × 10.2 — 위쪽 벽도 행이 빗나감)
//       ⑪ 얇은 링(반경 4, 폭 0.3 mm = 0.6w) ⑫ 얇은 띠 10 × 0.6 mm(1.2w, 행이 아래 가장자리 0.11 mm 위를 지나게)
//       ⑬ 얇은 띠 10 × 0.3 mm(0.6w, 두 행 사이 — 행이 통째로 빗나감) ⑭ 0.15 mm 기둥 4개 ⑮ 사각뿔(층마다 단면이
//       달라 단면 높이 (N+0.5)·lh 를 잘못 잡으면 커버리지가 깨진다 — Z1-b1 검수 참고 3) ⑯ 0.3 mm 사선 막대 X 자
//       (Zhang–Suen 원판이 지우던 45° 띠 — 세선화 회귀) ⑰ 파일 B(구멍 판·링·띠).
//       각 lh 0.1·0.05 로 c1~c9·통계 + **전 층 커버리지 (a)(b)(c)(d)·넘침**(task0-coverage, G-code 텍스트 기준)
//       + 채움이 실제로 들어갔는지(⑫ 는 행만으로 통과 — 1.2w 띠는 행 하나가 늘 w 안에 둔다).
//   (B) 대조군 — 정상 출력을 글자로 변조해 겨냥한 검사가 실제로 실패하는지:
//       (i) 도포 줄 끝 ` ; x` (ii) 층 첫 G1 Z 에 F (iii) 층 끝 E-r 삭제 (iv) E 지수 표기
//       (v) 두 행 순서 뒤집기(+Y 단조 위반) (vi) 트래블이 칠한 줄을 가로지름(리트랙트로 감싸 c4 만 겨냥)
//       (vii) 겹친 구간에서 도포를 끊음(even-odd 흉내) (viii) 관 구멍 안으로 도포를 늘림
//       (ix) 채움 층에서 띠 경계를 넘는 두 도포 줄을 한 줄로(띠에서 안 자름) (x) 채움 층에서 앞 띠 항목 하나를
//       층 끝으로 옮김(띠 번호 감소) (xi) 트래블 하나가 칠한 줄을 짧게(전체 ≤ w) 가로지름 — c4b 는 잡고 c4 는 놓침을 단언.
//       하나라도 "변조했는데 통과" 면 실패.
//   (C) writer 대조군 (Z1-b2): thinFill=false 로 같은 픽스처(⑩⑪⑬⑭⑮⑯⑰) → 커버리지 FAIL,
//       thinFillDetour=false(우회 끔) → c4 트래블 교차 FAIL (⑩⑪⑰).
//   (D) 경로 계획 단위 검사 (Z1-b2): 띠 자르기, 칠한 선 한가운데 점으로 들어가는 트래블(정확한 수직만 허용 — 탈출점).
//
//   gen-task0-dryrun.mjs 가 이 파일의 검사 함수를 import 해서 드라이런 파일 A·B·C 를 쓰기 전에 돌린다
//   (그래서 main 은 직접 실행할 때만 돈다).
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "FAIL"·"위반" 문자열을 출력한다.
//   실행: npx tsx scripts/verify-task0-writer.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  chainSegments,
  normalizeTriangleWinding,
  sliceTrianglesAtY,
} from "../src/features/v2/utils/slice-geometry.ts";
import {
  TASK0_DEFAULTS,
  bedToPixel,
  bedToWorld,
  isInPrintableArea,
  pixelCenterToBed,
  task0LayerCount,
  task0LayerZ,
  task0SliceY,
  worldToBed,
} from "../src/features/v2/utils/task0/task0-frame.ts";
import { checkTask0GcodeCoverage } from "../src/features/v2/utils/task0/task0-coverage.ts";
import {
  routeTask0FillLayer,
  task0CutByBands,
  task0TravelCrossesPainted,
} from "../src/features/v2/utils/task0/task0-fill-route.ts";
import { parseGcodeText } from "../src/features/v2/utils/task0/task0-gcode-parser.ts";
import {
  generateTask0Gcode,
  resolveTask0WriterParams,
} from "../src/features/v2/utils/task0/task0-gcode-writer.ts";

const START = "; EXECUTABLE_BLOCK_START";
const LAYER = ";LAYER_CHANGE";
const SNAP_TOL = 0.0011; // 1 µm 격자 반올림 차이 허용 (mm)

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

/** 위반 집계 — 메시지별 개수 + 앞 5개 줄 번호 */
class Viol {
  constructor() {
    this.map = new Map();
  }
  add(msg, line) {
    let e = this.map.get(msg);
    if (!e) {
      e = { n: 0, lines: [] };
      this.map.set(msg, e);
    }
    e.n++;
    if (line !== undefined && e.lines.length < 5) e.lines.push(line);
  }
  get list() {
    return [...this.map].map(
      ([m, e]) => `${m} ×${e.n}${e.lines.length ? ` (줄 ${e.lines.join(", ")}${e.n > e.lines.length ? " …" : ""})` : ""}`,
    );
  }
}

// ── 픽스처 지오메트리 ────────────────────────────────────────────────────

/**
 * 축정렬 상자의 삼각형 12개 (삼각형당 9 float, 바깥 법선 감김 — verify-slice-rasterize 와 같은 구성).
 *   min/max 는 world [x, y, z] (Y-up). `flip=true` 면 감김을 뒤집어 내강(구멍) 벽으로 쓴다.
 */
export function boxTriangles(min, max, flip = false) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 3, 2], [0, 2, 1], // −Y
    [4, 5, 6], [4, 6, 7], // +Y
    [0, 1, 5], [0, 5, 4], // −Z
    [2, 3, 7], [2, 7, 6], // +Z
    [3, 0, 4], [3, 4, 7], // −X
    [1, 2, 6], [1, 6, 5], // +X
  ];
  const out = new Float32Array(faces.length * 9);
  let o = 0;
  for (const f of faces) {
    const tri = flip ? [f[0], f[2], f[1]] : f;
    for (const k of tri) {
      out[o++] = v[k][0];
      out[o++] = v[k][1];
      out[o++] = v[k][2];
    }
  }
  return out;
}

/** 여러 삼각형 배열을 하나로 */
export function concatTris(...arrays) {
  const out = new Float32Array(arrays.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** 삼각형 배열을 Y 축 기준 ang(rad) 회전 (감김 보존 — 회전은 행렬식 +1) */
export function rotateTrisY(tris, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i];
    const z = tris[i + 2];
    out[i] = c * x + s * z;
    out[i + 1] = tris[i + 1];
    out[i + 2] = -s * x + c * z;
  }
  return out;
}

/** 메시들의 최고 Y (서포트 포함 topY 에 해당) */
export function meshesTopY(meshes) {
  let top = -Infinity;
  for (const m of meshes) for (let i = 1; i < m.length; i += 3) top = Math.max(top, m[i]);
  return top;
}

/**
 * 기대 빈 층 — 기하로 직접: 층 N 단면 (N+0.5)·lh 가 어느 솔리드의 (y0, y1) 안에도 없으면 빈 층.
 * (float32 로 저장된 경계를 쓴다.) 층 수는 규격 식 task0LayerCount.
 */
export function expectedEmptyLayers(solidYRanges, topY, lh) {
  const out = [];
  const count = task0LayerCount(topY, lh);
  for (let n = 0; n < count; n++) {
    const y = (n + 0.5) * lh;
    const hit = solidYRanges.some(([y0, y1]) => Math.fround(y0) < y && y < Math.fround(y1));
    if (!hit) out.push(n);
  }
  return out;
}

/** 파일 A — 10 mm 정육면체, 출력 가능 영역 가운데(베드 (80, 47.5) = world x 5, z 5), 바닥 Y 0 */
export function fixtureCube10() {
  return {
    name: "cube10",
    meshes: () => [normalizeTriangleWinding(boxTriangles([0, 0, 0], [10, 10, 10]))],
    solids: [[0, 10]],
  };
}

/** 파일 C — 10×10 판 두 장(Y 0~0.2, 0.3~0.5), 가운데 한 층 틈 (lh 0.1 → 층 2 빈 층). 자리는 파일 A 와 같음 */
export function fixtureGapPlates() {
  return {
    name: "gap-plates",
    meshes: () => [
      normalizeTriangleWinding(
        concatTris(boxTriangles([0, 0, 0], [10, 0.2, 10]), boxTriangles([0, 0.3, 0], [10, 0.5, 10])),
      ),
    ],
    solids: [[0, 0.2], [0.3, 0.5]],
  };
}

/** 삼각형 하나를 기대 바깥 법선 n 쪽으로 감아 넣는다 (외적·n < 0 이면 두 꼭짓점 교환) */
function pushOriented(out, a, b, c, n) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const cross = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const tri = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] >= 0 ? [a, b, c] : [a, c, b];
  for (const p of tri) out.push(p[0], p[1], p[2]);
}

/**
 * 고리 기둥(원통 고리) — 중심 world (cx, cz), 안·바깥 반지름, Y 범위 y0~y1, 둘레 n 등분.
 * 면마다 바깥 법선(바깥 벽 = 반지름 방향, 안 벽 = 축 쪽, 윗면 +Y, 아랫면 −Y) 으로 감는다.
 */
export function annulusTriangles(cx, cz, rIn, rOut, y0, y1, n = 256) {
  const out = [];
  const P = (r, t, y) => [cx + r * Math.cos(t), y, cz + r * Math.sin(t)];
  for (let i = 0; i < n; i++) {
    const t0 = (2 * Math.PI * i) / n;
    const t1 = (2 * Math.PI * (i + 1)) / n;
    const tm = (t0 + t1) / 2;
    const rad = [Math.cos(tm), 0, Math.sin(tm)];
    const inward = [-rad[0], 0, -rad[2]];
    pushOriented(out, P(rOut, t0, y0), P(rOut, t1, y0), P(rOut, t1, y1), rad);
    pushOriented(out, P(rOut, t0, y0), P(rOut, t1, y1), P(rOut, t0, y1), rad);
    pushOriented(out, P(rIn, t0, y0), P(rIn, t1, y0), P(rIn, t1, y1), inward);
    pushOriented(out, P(rIn, t0, y0), P(rIn, t1, y1), P(rIn, t0, y1), inward);
    pushOriented(out, P(rOut, t0, y1), P(rOut, t1, y1), P(rIn, t1, y1), [0, 1, 0]);
    pushOriented(out, P(rOut, t0, y1), P(rIn, t1, y1), P(rIn, t0, y1), [0, 1, 0]);
    pushOriented(out, P(rOut, t0, y0), P(rOut, t1, y0), P(rIn, t1, y0), [0, -1, 0]);
    pushOriented(out, P(rOut, t0, y0), P(rIn, t1, y0), P(rIn, t0, y0), [0, -1, 0]);
  }
  return Float32Array.from(out);
}

/**
 * 사각뿔대 — 밑면 중심 world (cx, cz), 밑면 반폭 hb(y0)·윗면 반폭 ht(y1). 층마다 단면 크기가 달라(비각기둥)
 * 단면 높이 (N+0.5)·lh 를 잘못 잡으면 커버리지가 깨진다. 윗면을 남겨 맨 위 층에도 픽셀이 있게 한다.
 */
export function frustumTriangles(cx, cz, hb, ht, y0, y1) {
  const out = [];
  const B = [
    [cx - hb, y0, cz - hb],
    [cx + hb, y0, cz - hb],
    [cx + hb, y0, cz + hb],
    [cx - hb, y0, cz + hb],
  ];
  const T = [
    [cx - ht, y1, cz - ht],
    [cx + ht, y1, cz - ht],
    [cx + ht, y1, cz + ht],
    [cx - ht, y1, cz + ht],
  ];
  pushOriented(out, B[0], B[1], B[2], [0, -1, 0]);
  pushOriented(out, B[0], B[2], B[3], [0, -1, 0]);
  pushOriented(out, T[0], T[1], T[2], [0, 1, 0]);
  pushOriented(out, T[0], T[2], T[3], [0, 1, 0]);
  const normals = [
    [0, 0.5, -1],
    [1, 0.5, 0],
    [0, 0.5, 1],
    [-1, 0.5, 0],
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pushOriented(out, B[i], B[j], T[j], normals[i]);
    pushOriented(out, B[i], T[j], T[i], normals[i]);
  }
  return Float32Array.from(out);
}

/**
 * 파일 B — 한 층에 세 형상을 나란히(출력 가능 영역 가운데 근처, 높이 0.5 mm → lh 0.1 이면 5층). 메시 셋(모델·서포트처럼 따로).
 *   ① 10×10 판 + 가운데 3×3 구멍: 베드 X 57.5~67.5 × Y 42.5~52.5, 구멍 X 61~64 × Y 46~49
 *   ② 얇은 링: 중심 베드 (80, 47.5), 반경 4 mm(중심선), 폭 0.3 mm = 0.6w (안 3.85 · 바깥 4.15)
 *   ③ 얇은 띠 10 × 0.6 mm(1.2w): 베드 X 92.5~102.5 × Y 47.14~47.74 — 층 최소 Y = 42.5(판 아래)라 행이 42.75 + k·0.5,
 *      띠 안에는 47.25 한 줄만(아래 가장자리 0.11 mm 위, 다음 47.75 는 위 가장자리 밖)으로 전역 행 위상에서 가장 빗나가게.
 */
export function fixtureFileB() {
  return {
    name: "file-b",
    meshes: () => [
      normalizeTriangleWinding(
        concatTris(boxTriangles([-17.5, 0, 0], [-7.5, 0.5, 10]), boxTriangles([-14, 0, 3.5], [-11, 0.5, 6.5], true)),
      ),
      normalizeTriangleWinding(annulusTriangles(5, 5, 3.85, 4.15, 0, 0.5)),
      normalizeTriangleWinding(boxTriangles([17.5, 0, 4.64], [27.5, 0.5, 5.24])),
    ],
    solids: [[0, 0.5]],
  };
}

// ── G-code 모델 (검사용 느슨한 해석 — 형식은 c2 가 따로 본다) ─────────────

/** 명령 줄 하나를 느슨하게 해석 (주석 떼고 토큰 분리, 숫자는 Number) */
function classify(s, lineNo) {
  const semi = s.indexOf(";");
  const code = (semi >= 0 ? s.slice(0, semi) : s).trim();
  const toks = code.split(/\s+/).filter(Boolean);
  const cmd = (toks[0] ?? "").toUpperCase();
  const op = { lineNo, text: s, cmd, kind: "other", args: {} };
  if (cmd !== "G0" && cmd !== "G1") return op;
  for (const t of toks.slice(1)) op.args[t[0].toUpperCase()] = Number(t.slice(1));
  const a = op.args;
  const hasXY = "X" in a || "Y" in a;
  const hasE = "E" in a;
  const hasZ = "Z" in a;
  if (hasZ && !hasXY && !hasE) op.kind = "z";
  else if (hasXY && hasE) op.kind = "deposit";
  else if (hasXY) op.kind = "travel";
  else if (hasE) op.kind = "eonly";
  else op.kind = "fonly";
  return op;
}

/** G-code → { lines, startIdx, layers: [{index, lineNo, ops}] } — 이동 op 에 from/to(층 시작 = 파킹) */
export function buildModel(gcode, park = [TASK0_DEFAULTS.parkXMm, TASK0_DEFAULTS.parkYMm]) {
  const text = gcode.endsWith("\n") ? gcode.slice(0, -1) : gcode;
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === START);
  const layers = [];
  let cur = null;
  if (startIdx >= 0) {
    for (let i = startIdx + 1; i < lines.length; i++) {
      const s = lines[i].trim();
      if (s === LAYER) {
        cur = { index: layers.length, lineNo: i + 1, ops: [] };
        layers.push(cur);
        continue;
      }
      if (s === "" || s.startsWith(";") || cur === null) continue;
      cur.ops.push(classify(s, i + 1));
    }
  }
  for (const layer of layers) {
    let pos = [park[0], park[1]];
    for (const op of layer.ops) {
      if (op.kind === "travel" || op.kind === "deposit") {
        const to = [op.args.X ?? pos[0], op.args.Y ?? pos[1]];
        op.from = pos;
        op.to = to;
        pos = to;
      }
    }
  }
  return { lines, startIdx, layers };
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** 층 안 트래블 묶음 — 도포 사이(또는 층 시작~첫 도포)의 연속 트래블·E 단독 줄 */
function travelGroups(layer) {
  const groups = [];
  let g = null;
  let depositsBefore = 0;
  for (const op of layer.ops) {
    if (op.kind === "travel" || op.kind === "eonly") {
      if (!g) g = { ops: [], points: [], len: 0, afterDeposit: depositsBefore > 0, beforeDeposit: false };
      g.ops.push(op);
      if (op.kind === "travel") {
        if (g.points.length === 0) g.points.push(op.from);
        g.points.push(op.to);
        g.len += dist(op.from, op.to);
      }
    } else if (op.kind === "deposit") {
      if (g) {
        g.beforeDeposit = true;
        groups.push(g);
        g = null;
      }
      depositsBefore++;
    }
  }
  if (g) groups.push(g);
  return groups;
}

/** 층 도포 줄을 행(같은 y)으로 묶음 — 진행 순서 유지 */
function depositRows(layer) {
  const rows = [];
  for (const op of layer.ops) {
    if (op.kind !== "deposit") continue;
    const y = op.to[1];
    let row = rows.length ? rows[rows.length - 1] : null;
    if (!row || row.y !== y) {
      row = { y, deps: [] };
      rows.push(row);
    }
    row.deps.push(op);
  }
  return rows;
}

// ── 기하 보조 ────────────────────────────────────────────────────────────

function pointSegDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function orient(a, b, c) {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
}

function segSegDist(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0; // 진짜 교차
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

/** 꺾은선에서 호 길이 앞 d·뒤 d 를 뗀 나머지 조각들 */
function trimPolyline(points, d) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  if (total <= 2 * d) return [];
  const s0 = d;
  const s1 = total - d;
  const out = [];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const L = dist(a, b);
    const lo = Math.max(s0, acc);
    const hi = Math.min(s1, acc + L);
    if (L > 0 && hi > lo) {
      const p = (t) => [a[0] + ((b[0] - a[0]) * (t - acc)) / L, a[1] + ((b[1] - a[1]) * (t - acc)) / L];
      out.push([p(lo), p(hi)]);
    }
    acc += L;
  }
  return out;
}

const snap3 = (v) => Math.round(v * 1000) / 1000;

// ── 독립 참조: 단면 → 행 구간 (nonzero / even-odd) ─────────────────────────
//   writer 와 다른 구현(전체 변 순회, a 기준 보간, 래스터라이저식 짝 구간 채움)으로 같은 답이 나와야 한다.

function referenceSpans(hits, mode) {
  const out = [];
  let wnd = 0;
  for (let i = 0; i + 1 < hits.length; i++) {
    wnd += hits[i].dir;
    const inside = mode === "nonzero" ? wnd !== 0 : (i + 1) % 2 === 1;
    if (!inside) continue;
    const s = hits[i].x;
    const e = hits[i + 1].x;
    const last = out.length ? out[out.length - 1] : null;
    if (last && s - last[1] <= 1e-9) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out.filter(([s, e]) => e - s > 1e-9);
}

/** 층 N 의 참조 행들 (w/2 축소·1 µm 격자 전 원래 구간 + 기대 도포 구간) */
export function referenceLayer(meshes, n, lh, w, bedW, bedD) {
  const sliceY = (n + 0.5) * lh;
  const polys = [];
  for (const m of meshes) polys.push(...chainSegments(sliceTrianglesAtY(m, sliceY)));
  const edges = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of polys) {
    const pts = p.points.map(([x, z]) => [x + bedW / 2, z + bedD / 2]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      yMin = Math.min(yMin, a[1]);
      yMax = Math.max(yMax, a[1]);
      if (a[1] !== b[1]) edges.push({ a, b });
    }
  }
  const rows = [];
  for (let k = 0; ; k++) {
    const y = yMin + (k + 0.5) * w;
    if (!(y < yMax - w / 2 + 1e-9)) break;
    const hits = [];
    for (const { a, b } of edges) {
      const lo = Math.min(a[1], b[1]);
      const hi = Math.max(a[1], b[1]);
      if (y < lo || y >= hi) continue;
      hits.push({ x: a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]), dir: a[1] < b[1] ? 1 : -1 });
    }
    hits.sort((p, q) => p.x - q.x);
    const nonzero = referenceSpans(hits, "nonzero");
    const evenodd = referenceSpans(hits, "evenodd");
    const expect = [];
    for (const [s, e] of nonzero) {
      const a = snap3(s + w / 2);
      const b = snap3(e - w / 2);
      if (b > a) expect.push([a, b]);
    }
    rows.push({ y, ySnap: snap3(y), nonzero, evenodd, expect });
  }
  // 행 자리를 다 놓고 맨 위에 남는 띠 (writer 통계 rowRemainderMm 의 독립 계산)
  const rowRemainder = polys.length ? Math.max(0, snap3(yMax - yMin - rows.length * w)) : 0;
  return { polygons: polys.length, rows, yMin, yMax, rowRemainder };
}

function sameSpans(p, q, tol) {
  if (p.length !== q.length) return false;
  return p.every((s, i) => Math.abs(s[0] - q[i][0]) <= tol && Math.abs(s[1] - q[i][1]) <= tol);
}

// ── 검사 c1~c8 ───────────────────────────────────────────────────────────

/** c1 — Task0 파서 이식판 3모드 */
function checkParser(gcode, ctx) {
  const v = new Viol();
  const expectLayers = task0LayerCount(ctx.topY, ctx.lh);
  const modes = [
    { label: "dryrun(keepE=false)", opt: { mode: "dryrun", keepE: false }, pre: "G90" },
    { label: "dryrun(keepE=true)", opt: { mode: "dryrun", keepE: true }, pre: "G90\nM83\nT0" },
    { label: `print(lh=${ctx.lh})`, opt: { mode: "print", layerHeightMm: ctx.lh }, pre: "G90\nM83\nT0" },
  ];
  for (const { label, opt, pre } of modes) {
    const r = parseGcodeText(gcode, opt);
    for (const w of r.warnings) v.add(`${label} 경고: ${w}`);
    for (const e of r.errors) v.add(`${label} 오류: ${e}`);
    if (r.layerCount !== expectLayers) v.add(`${label} layerCount ${r.layerCount} ≠ task0LayerCount ${expectLayers}`);
    if (r.endFound) v.add(`${label} END 마커 있음`);
    const preBlock = r.blocks.find((b) => !b.isLayer);
    if (!preBlock || preBlock.gcode !== pre) v.add(`${label} 프리앰블 블록 ≠ ${JSON.stringify(pre)}`);
    const layerBlocks = r.blocks.filter((b) => b.isLayer);
    const empty = layerBlocks.filter((b) => !b.hasXy).map((b) => b.layerIndex);
    if (ctx.expectedEmpty && JSON.stringify(empty) !== JSON.stringify(ctx.expectedEmpty)) {
      v.add(`${label} 빈 층(hasXy=false) ${JSON.stringify(empty)} ≠ 기대 ${JSON.stringify(ctx.expectedEmpty)}`);
    }
  }
  return v.list;
}

const NUM_Z = "(?:0|[1-9][0-9]*)(?:\\.[0-9]*[1-9])?"; // 끝 0 정리된 양수 고정 소수
const RE_ZMARK = new RegExp(`^;Z:(${NUM_Z})$`);
const RE_HEIGHT = new RegExp(`^;HEIGHT:(${NUM_Z})$`);
const RE_ZMOVE = new RegExp(`^G1 Z(${NUM_Z})$`);
const RE_TRAVEL = /^G1 X(-?[0-9]+\.[0-9]{3}) Y(-?[0-9]+\.[0-9]{3}) F([1-9][0-9]*)$/;
const RE_DEPOSIT = /^G1 X(-?[0-9]+\.[0-9]{3}) Y(-?[0-9]+\.[0-9]{3}) E([0-9]+\.[0-9]{5}) F([1-9][0-9]*)$/;
const RE_EONLY = /^G1 E(-?[0-9]+\.[0-9]{5}) F([1-9][0-9]*)$/;
const RE_FORBIDDEN = /^(G28|G91|G92|M82|M104|M109|M140|M190|M106|M107|M84|M400|G4|G10|G11|M204|MANUAL_STEPPER|SET_VELOCITY_LIMIT)\b/i;

/** c2 — 줄 형식 */
function checkFormat(gcode, ctx) {
  const v = new Viol();
  const p = ctx.params;
  const expectLayers = task0LayerCount(ctx.topY, ctx.lh);
  if (gcode.includes("\r")) v.add("CR 문자 있음 (줄바꿈은 \\n 만)");
  if (!gcode.endsWith("\n")) v.add("파일 끝 개행 없음");
  if (gcode.endsWith("\n\n")) v.add("파일 끝 개행 2개 이상");
  const lines = (gcode.endsWith("\n") ? gcode.slice(0, -1) : gcode).split("\n");
  const startIdx = lines.indexOf(START);
  if (startIdx < 0) {
    v.add("; EXECUTABLE_BLOCK_START 없음");
    return v.list;
  }
  if (lines.filter((l) => l.trim() === START).length !== 1) v.add("START 마커가 1개가 아님");

  // START 앞 메타 — 단독 주석 줄
  const meta = new Map();
  for (let i = 0; i < startIdx; i++) {
    if (!/^; \S/.test(lines[i])) v.add("START 앞 줄이 단독 주석이 아님", i + 1);
    const m = /^; ([A-Za-z][A-Za-z0-9]*): (.*)$/.exec(lines[i]);
    if (m) meta.set(m[1], m[2]);
  }
  if (!(lines[0] ?? "").includes("task0-gcode-writer")) v.add("메타 첫 줄에 생성기 없음");
  for (const key of ["layerCount", "layerHeightMm", "depositWidthMm", "syringeKMm3PerMm", "overfill", "retractMm"]) {
    if (!meta.has(key)) v.add(`메타 ${key} 없음`);
  }
  if (meta.has("layerCount") && Number(meta.get("layerCount")) !== expectLayers) v.add("메타 layerCount ≠ 층 수");

  // 프리앰블
  const pre = lines.slice(startIdx + 1, startIdx + 4).join("/");
  if (pre !== "G90/M83/T0") v.add(`프리앰블 ≠ G90/M83/T0 (${pre})`, startIdx + 2);

  // 층 블록·이동 줄
  let n = -1;
  for (let i = startIdx + 4; i < lines.length; i++) {
    const l = lines[i];
    const ln = i + 1;
    if (l === LAYER) {
      n++;
      const zm = RE_ZMARK.exec(lines[i + 1] ?? "");
      const hm = RE_HEIGHT.exec(lines[i + 2] ?? "");
      const gz = RE_ZMOVE.exec(lines[i + 3] ?? "");
      if (!zm) v.add("층 마커 다음 줄이 ;Z:{z}(끝 0 정리 고정 소수)가 아님", ln + 1);
      if (!hm) v.add(";HEIGHT:{lh} 줄 형식 아님", ln + 2);
      if (!gz) v.add("층 첫 이동이 F 없는 순수 G1 Z 가 아님", ln + 3);
      if (zm && gz && zm[1] !== gz[1]) v.add(";Z: 와 G1 Z 글자가 다름", ln + 3);
      if (zm && Math.abs(Number(zm[1]) - (n + 1) * ctx.lh) > 1e-6) v.add("Z ≠ (N+1)·lh", ln + 1);
      if (hm && Math.abs(Number(hm[1]) - ctx.lh) > 1e-9) v.add("HEIGHT ≠ lh", ln + 2);
      i += 3;
      continue;
    }
    if (n < 0) v.add("첫 ;LAYER_CHANGE 전에 프리앰블 외 줄", ln);
    if (l === "") v.add("빈 줄", ln);
    if (l.includes(";")) v.add(l.startsWith(";") ? "층 안 주석 줄(마커 외)" : "명령 줄 끝 주석", ln);
    if (/[0-9.][eE][+-]?[0-9]/.test(l)) v.add("지수 표기 숫자", ln);
    if (/(^|\s)[A-Za-z]-0(\.0*)?(?=\s|$)/.test(l)) v.add("-0 숫자", ln);
    if (/^G[01]\s+F\S+\s*$/i.test(l)) v.add("F 단독 줄", ln);
    if (RE_FORBIDDEN.test(l.trim())) v.add("쓰지 않는 명령(G28/G91/G92/M82/M104/M106/M400…)", ln);
    if (/^G[01]\b.*\sZ/i.test(l)) v.add("층 첫 G1 Z 외 Z 가 든 줄", ln);
    if (l.trim() === "; EXECUTABLE_BLOCK_END") v.add("END 마커 있음", ln);
    let m;
    if ((m = RE_TRAVEL.exec(l))) {
      if (Number(m[3]) !== p.travelF) v.add(`트래블 F ≠ ${p.travelF}`, ln);
    } else if ((m = RE_DEPOSIT.exec(l))) {
      if (Number(m[4]) !== p.depositF) v.add(`도포 F ≠ ${p.depositF}`, ln);
    } else if ((m = RE_EONLY.exec(l))) {
      if (Number(m[2]) !== p.retractF) v.add(`E 단독 줄 F ≠ ${p.retractF}`, ln);
    } else {
      v.add("허용되지 않은 줄 모양", ln);
    }
  }
  if (n + 1 !== expectLayers) v.add(`;LAYER_CHANGE ${n + 1}개 ≠ 층 수 ${expectLayers}`);
  return v.list;
}

/** c3 — 리트랙트 상태 기계 (툴 T0) */
function checkRetract(model, ctx) {
  const v = new Viol();
  const r = ctx.params.retractMm;
  const minTravel = ctx.params.retractMinTravelMm;
  let used = false;
  let retracted = false; // 시작 = 프라이밍 완료·언리트랙트 (§10)
  for (const layer of model.layers) {
    const usedAtStart = used;
    let net = 0;
    let deposited = false;
    let eLines = 0;
    let group = null;
    const closeGroup = () => {
      if (group && !group.exempt && group.unretracted && group.len >= minTravel - 1e-9) {
        v.add(`≥${minTravel} mm 트래블을 언리트랙트 상태로 함`, group.line);
      }
      group = null;
    };
    for (const op of layer.ops) {
      if (op.kind === "eonly") {
        eLines++;
        const e = op.args.E;
        net += e;
        if (Math.abs(Math.abs(e) - r) > 0.5e-5 + 1e-12) v.add(`E 단독 줄 크기 ≠ r(${r})`, op.lineNo);
        if (e < 0) {
          if (retracted) v.add("이중 리트랙트", op.lineNo);
          retracted = true;
        } else if (e > 0) {
          if (!used) v.add("툴 첫 사용 전 E+r (Task0 가 프라이밍 완료 상태로 넘김 — 생략해야 함)", op.lineNo);
          if (!retracted) v.add("이중 언리트랙트", op.lineNo);
          retracted = false;
        } else {
          v.add("E0 단독 줄", op.lineNo);
        }
      } else if (op.kind === "travel") {
        if (!group) group = { len: 0, unretracted: false, exempt: !used, line: op.lineNo };
        group.len += dist(op.from, op.to);
        if (!retracted) group.unretracted = true;
      } else if (op.kind === "deposit") {
        closeGroup();
        if (retracted) v.add("리트랙트 상태에서 도포", op.lineNo);
        used = true;
        deposited = true;
      }
    }
    closeGroup();
    if (deposited) {
      if (!retracted) v.add("도포한 층 블록 끝이 리트랙트 상태가 아님", layer.lineNo);
      const expectNet = usedAtStart ? 0 : -r; // 첫 사용 층: E+r 생략 + 층 끝 E−r
      if (Math.abs(net - expectNet) > 1e-9) v.add(`층 E 단독 순변화 ${net.toFixed(5)} ≠ ${expectNet}`, layer.lineNo);
    } else if (eLines > 0) {
      v.add("빈 층에 E 줄 (아직 안 쓴 툴은 상태 변경 없음 — 계획서 §3)", layer.lineNo);
    }
  }
  return v.list;
}

/** c4 — 트래블이 이미 칠한 줄을 가로지르지 않음 */
function checkTravelCrossing(model, ctx) {
  const v = new Viol();
  const half = ctx.params.depositWidthMm / 2;
  for (const layer of model.layers) {
    const painted = [];
    let path = null;
    let pathLine = 0;
    const flush = () => {
      if (path && painted.length) {
        const crosses = trimPolyline(path, half).some(([a, b]) =>
          painted.some(([c, e]) => segSegDist(a, b, c, e) < half - 1e-6),
        );
        if (crosses) v.add("트래블이 칠한 줄(폭 w) 안을 지남", pathLine);
      }
      path = null;
    };
    for (const op of layer.ops) {
      if (op.kind === "travel") {
        if (!path) {
          path = [op.from];
          pathLine = op.lineNo;
        }
        path.push(op.to);
      } else if (op.kind === "deposit") {
        flush();
        painted.push([op.from, op.to]);
      }
    }
    flush();
  }
  return v.list;
}

// ── c4b: 트래블 다리와 칠한 중심선의 실제 교차 (잘라내기 없음) ──────────────
//   c4 는 트래블 경로의 양 끝 w/2 를 잘라낸 나머지만 보므로 길이 ≤ w 인 트래블은 검사를 아예 받지 않는다
//   (잘라내면 남는 게 없음). c4b 는 그 빈틈을 막는다: 트래블 다리(선분) 하나하나를 그 층에서 그 시점까지 칠한
//   도포 선분(중심선)과 **정수 µm 좌표**로 정확히 맞대어(외적 부호 — 반올림 오차 없음) 접촉을 분류한다.
//     - 진짜 교차(두 선분 안쪽끼리 한 점에서 엇갈림) → 위반.
//     - 한 점 접촉(한 선분의 끝점이 다른 선분 위) → 그 점이 **트래블 경로의 시작점(직전 도포 끝 = 현재 위치)
//       또는 끝점(다음 도포 시작점)** 이면 제외("끝점 공유" — 칠한 곳에서 출발하거나 칠한 이음점으로 들어가는 것).
//       경유점(꺾이는 점)이나 다리 한가운데가 칠한 선에 닿으면 위반.
//     - 같은 직선 위 겹침(길이 > 0) → **첫 다리가 직전 도포 선분을 거꾸로 되짚는 경우**(겹침이 시작점을 포함)만 제외하고
//       그 밖의 겹침은 위반.
//   되짚기 통계(위반 아님 — Z2 이후 과제): 첫 다리 방향이 직전 도포 선분 방향과 90° 넘게 벌어진 트래블(노즐이 방금 깐
//   비드 쪽으로 되돌아감 — c4 는 앞 w/2 를 잘라 보지 않는다) 수. 그중 같은 직선 위로 겹치는 것을 따로 센다.
//       같은 직선 위로 끝점에서만 만나는 이어짐(예: 행 끝에서 행 선을 따라 다음 구간으로)은 한 점 접촉이라 위 규칙으로 제외.

/** 정수 µm 점 */
const toUmPt = (p) => [Math.round(p[0] * 1000), Math.round(p[1] * 1000)];
/** 외적 부호 (정수 — 값이 2^53 안이라 정확) */
const orientI = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const samePtI = (a, b) => a[0] === b[0] && a[1] === b[1];
/** 같은 직선 위 점 p 가 선분 ab 범위 안인지 */
const withinI = (p, a, b) =>
  Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);

/**
 * 다리 pq 와 칠한 선분 ab 의 접촉 — { kind: "none" } | { kind: "cross" } | { kind: "touch", points } |
 * { kind: "overlap", containsP } (같은 직선 위 겹침 길이 > 0, containsP = 겹침이 p 를 포함)
 */
function legSegmentContact(p, q, a, b) {
  const o1 = orientI(p, q, a);
  const o2 = orientI(p, q, b);
  const o3 = orientI(a, b, p);
  const o4 = orientI(a, b, q);
  if (o1 === 0 && o2 === 0) {
    // 같은 직선 — 다리 방향의 큰 축으로 투영해 구간 겹침
    const ax = Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) ? 0 : 1;
    const lo = Math.max(Math.min(p[ax], q[ax]), Math.min(a[ax], b[ax]));
    const hi = Math.min(Math.max(p[ax], q[ax]), Math.max(a[ax], b[ax]));
    if (lo > hi) return { kind: "none" };
    if (lo === hi) {
      const point = [p, q, a, b].find((t) => t[ax] === lo && withinI(t, p, q) && withinI(t, a, b));
      return { kind: "touch", points: point ? [point] : [] };
    }
    return { kind: "overlap", containsP: lo <= p[ax] && p[ax] <= hi };
  }
  if (o1 * o2 < 0 && o3 * o4 < 0) return { kind: "cross" };
  const points = [];
  if (o1 === 0 && withinI(a, p, q)) points.push(a);
  if (o2 === 0 && withinI(b, p, q)) points.push(b);
  if (o3 === 0 && withinI(p, a, b)) points.push(p);
  if (o4 === 0 && withinI(q, a, b)) points.push(q);
  return points.length > 0 ? { kind: "touch", points } : { kind: "none" };
}

/**
 * c4b — 트래블 다리가 칠한 중심선과 실제로 교차·접촉·겹침 0 (규칙은 위 머리 주석).
 * 되짚기(첫 다리가 직전 도포 방향과 90° 넘게 벌어짐, 그중 같은 직선 겹침) 수를 ctx.retraceReport 에 남긴다 — 위반 아님.
 */
function checkTravelContact(model, ctx) {
  const v = new Viol();
  const perLayer = [];
  for (const layer of model.layers) {
    const painted = []; // 정수 µm [a, b]
    let path = null;
    let pathLine = 0;
    let lastDep = null; // 이 트래블 바로 앞 도포 선분
    let retraces = 0;
    let collinear = 0;
    const flush = () => {
      if (path && painted.length) {
        const C = path[0];
        const S = path[path.length - 1];
        let retraced = false;
        if (lastDep !== null && path.length >= 2) {
          const dx = lastDep[1][0] - lastDep[0][0];
          const dy = lastDep[1][1] - lastDep[0][1];
          if (dx * (path[1][0] - C[0]) + dy * (path[1][1] - C[1]) < 0) retraced = true;
        }
        for (let i = 1; i < path.length; i++) {
          const p = path[i - 1];
          const q = path[i];
          for (const seg of painted) {
            const c = legSegmentContact(p, q, seg[0], seg[1]);
            if (c.kind === "cross") v.add("트래블 다리가 칠한 선분과 교차", pathLine);
            else if (c.kind === "touch") {
              if (c.points.some((t) => !samePtI(t, C) && !samePtI(t, S))) {
                v.add("트래블 경유점·다리 가운데가 칠한 선분에 닿음 (시작·끝점 아닌 곳)", pathLine);
              }
            } else if (c.kind === "overlap") {
              if (i === 1 && seg === lastDep && c.containsP) collinear++;
              else v.add("트래블 다리가 칠한 선분과 같은 직선 위에서 겹침 (되짚기 외)", pathLine);
            }
          }
        }
        if (retraced) retraces++;
      }
      path = null;
    };
    for (const op of layer.ops) {
      if (op.kind === "travel") {
        if (!path) {
          path = [toUmPt(op.from)];
          pathLine = op.lineNo;
        }
        path.push(toUmPt(op.to));
      } else if (op.kind === "deposit") {
        flush();
        lastDep = [toUmPt(op.from), toUmPt(op.to)];
        painted.push(lastDep);
      }
    }
    flush();
    perLayer.push([retraces, collinear]);
  }
  ctx.retraceReport = {
    total: perLayer.reduce((s, [n]) => s + n, 0),
    collinear: perLayer.reduce((s, [, c]) => s + c, 0),
    maxPerLayer: perLayer.reduce((m, [n]) => Math.max(m, n), 0),
    layers: perLayer.filter(([n]) => n > 0).length,
  };
  return v.list;
}

/**
 * 행 줄 분류 — 행 높이(참조 ySnap)의 수평 도포 중 x 범위가 참조 기대 구간(w/2 축소)과 같은 줄은 행 줄(op.rowK = 참조 행 번호),
 * 나머지는 채움 줄(op.rowK = -1). 참조가 없으면 전부 -1.
 */
function classifyDeposits(layer, ref) {
  for (const op of layer.ops) {
    if (op.kind !== "deposit") continue;
    op.rowK = -1;
    if (!ref || op.from[1] !== op.to[1]) continue;
    const lo = Math.min(op.from[0], op.to[0]);
    const hi = Math.max(op.from[0], op.to[0]);
    op.rowK = ref.rows.findIndex(
      (r) =>
        Math.abs(r.ySnap - op.to[1]) <= SNAP_TOL &&
        r.expect.some(([a, b]) => Math.abs(a - lo) <= SNAP_TOL && Math.abs(b - hi) <= SNAP_TOL),
    );
  }
}

/** 띠 번호 — writer task0BandOf 와 같은 식(독립 구현): 띠 k = [Y0 + k·w, Y0 + (k+1)·w) */
const bandOf = (y, y0, w) => Math.floor((y - y0) / w);

/**
 * c5 — +Y 단조(띠 해상도)·띠 방향·띠 안 X 순서·행 간격·트래블 모양 (Z1-b2 갱신 — 머리 주석 c5 참고).
 * 띠 원점 Y0 = 독립 참조 단면 최소 Y (ctx.refLayers). 참조가 없으면 띠 검사를 못 하므로 위반으로 센다.
 */
function checkMonotone(model, ctx) {
  const v = new Viol();
  const w = ctx.params.depositWidthMm;
  for (const layer of model.layers) {
    const ref = ctx.refLayers?.[layer.index] ?? null;
    const deps = layer.ops.filter((op) => op.kind === "deposit");
    for (const d of deps) if (d.from[0] === d.to[0] && d.from[1] === d.to[1]) v.add("길이 0 도포 줄", d.lineNo);
    if (deps.length === 0) continue;
    if (!ref || !Number.isFinite(ref.yMin)) {
      v.add("독립 참조 단면이 없어 띠 검사를 못 함", layer.lineNo);
      continue;
    }
    const y0 = ref.yMin;
    // (1) 줄마다 띠(중점 y) + 양 끝이 그 띠 안 + 층 안 띠 번호 비감소
    let prevBand = -Infinity;
    for (const d of deps) {
      d.band = bandOf((d.from[1] + d.to[1]) / 2, y0, w);
      const lo = y0 + d.band * w;
      const hi = y0 + (d.band + 1) * w;
      if ([d.from[1], d.to[1]].some((y) => y < lo - SNAP_TOL || y > hi + SNAP_TOL)) {
        v.add("도포 줄이 띠 하나 안에 있지 않음 (띠 경계에서 자르지 않음)", d.lineNo);
      }
      if (d.band < prevBand) v.add("도포 띠 번호가 층 안에서 감소 (+Y 단조 위반)", d.lineNo);
      prevBand = Math.max(prevBand, d.band);
    }
    // (2) 띠 방향 — 도포가 있는 띠 순서대로 +X, −X, …
    const dirOf = new Map();
    for (const d of deps) if (!dirOf.has(d.band)) dirOf.set(d.band, dirOf.size % 2 === 0 ? 1 : -1);
    // (3) 항목 = 트래블 없이 이어진 도포 줄 묶음(띠가 바뀌면 끊음) — 띠 안에서 방향 순서
    const items = [];
    let item = null;
    let chained = false;
    for (const op of layer.ops) {
      if (op.kind === "deposit") {
        if (item && chained && item.band === op.band) item.deps.push(op);
        else {
          item = { band: op.band, deps: [op] };
          items.push(item);
        }
        chained = true;
      } else if (op.kind === "travel") chained = false;
    }
    const lastKey = new Map();
    for (const it of items) {
      const dir = dirOf.get(it.band);
      const xs = it.deps.flatMap((d) => [d.from[0], d.to[0]]);
      const key = dir > 0 ? Math.min(...xs) : -Math.max(...xs);
      const prev = lastKey.get(it.band);
      if (prev !== undefined && key < prev - SNAP_TOL) {
        v.add("띠 안 항목이 방향 순서(+X 면 왼쪽부터, −X 면 오른쪽부터)가 아님", it.deps[0].lineNo);
      }
      lastKey.set(it.band, prev === undefined ? key : Math.max(prev, key));
    }
    // (4) 행 줄 — 띠 방향(서펜타인), 행 간격 = w 정수배, 한 행 안 구간 간격 ≥ w
    const rowDeps = deps.filter((d) => d.rowK >= 0);
    for (const d of rowDeps) {
      if (Math.sign(d.to[0] - d.from[0]) !== dirOf.get(d.band)) {
        v.add("서펜타인 아님 (도포한 띠마다 번갈아, 첫 띠 +X)", d.lineNo);
      }
    }
    const rowYs = [...new Set(rowDeps.map((d) => d.to[1]))];
    for (let k = 1; k < rowYs.length; k++) {
      const dy = rowYs[k] - rowYs[k - 1];
      const m = Math.round(dy / w);
      if (m < 1 || Math.abs(dy - m * w) > SNAP_TOL) v.add(`행 간격 ${dy.toFixed(4)} 이 w 의 정수배가 아님`, layer.lineNo);
    }
    for (const y of rowYs) {
      const row = rowDeps.filter((d) => d.to[1] === y);
      const dir = Math.sign(row[0].to[0] - row[0].from[0]);
      for (let j = 1; j < row.length; j++) {
        const gap = (row[j].from[0] - row[j - 1].to[0]) * dir;
        if (gap < w - SNAP_TOL) v.add("한 행 안 구간이 진행 순서가 아니거나 겹침", row[j].lineNo);
      }
    }
    // (5) 트래블 모양 — 층 첫 = 직선 1줄, 도포 없이 끝나는 트래블 없음.
    //     채움이 없는 층(모든 도포 줄이 행 줄)은 Z1-a2 규칙 그대로: 같은 행 안 = 수평 1줄, 행 사이 = L자(Y 먼저, 그다음 X)
    const rowOnly = rowDeps.length === deps.length;
    for (const g of travelGroups(layer)) {
      const legs = g.ops.filter((op) => op.kind === "travel");
      const line = g.ops[0].lineNo;
      if (legs.length === 0) {
        continue; // E 단독 줄만 (층 끝 E-r 등)
      } else if (!g.beforeDeposit) {
        v.add("도포 없이 끝나는 트래블", line);
      } else if (!g.afterDeposit) {
        if (legs.length !== 1) v.add("층 첫 트래블(파킹 → 첫 도포점)이 직선 1줄이 아님", line);
      } else if (!rowOnly) {
        continue; // 채움 층 — 모양은 자유(우회), 교차는 c4 가 본다
      } else if (legs[0].from[1] === legs[legs.length - 1].to[1]) {
        if (legs.length !== 1) v.add("같은 행 안 트래블이 수평 1줄이 아님", line);
      } else {
        const [l1, l2] = legs;
        const yLegOk = l1.from[0] === l1.to[0] && l1.to[1] > l1.from[1];
        const xLegOk = l2 === undefined || (l2.from[1] === l2.to[1] && l2.from[0] !== l2.to[0]);
        if (legs.length > 2 || !yLegOk || !xLegOk) v.add("행 사이 이동이 L자(Y 먼저, 그다음 X)가 아님", line);
      }
    }
  }
  return v.list;
}

/** c6 — E 잔차 이월·|E| ≤ 500 */
function checkExtrusion(model, ctx) {
  const v = new Viol();
  const p = ctx.params;
  const rate = (p.depositWidthMm * ctx.lh * p.overfill) / p.syringeKMm3PerMm;
  let exact = 0;
  let printed = 0;
  let worst = 0;
  for (const layer of model.layers) {
    for (const op of layer.ops) {
      if ("E" in op.args && Math.abs(op.args.E) > 500) v.add("|E| > 500", op.lineNo);
      if (op.kind !== "deposit") continue;
      if (!(op.args.E >= 0)) v.add("도포 E 가 음수/숫자 아님", op.lineNo);
      exact += dist(op.from, op.to) * rate;
      printed += op.args.E;
      const diff = Math.abs(printed - exact);
      worst = Math.max(worst, diff);
      if (diff > 0.5e-5 + 1e-9) v.add("|출력 E 누적 − 정확 누적| > 0.5e-5 (잔차 이월 안 됨)", op.lineNo);
    }
  }
  ctx.eReport = { exact, printed, worst };
  return v.list;
}

/** c7 — 출력 가능 영역 */
function checkArea(model) {
  const v = new Viol();
  for (const layer of model.layers) {
    for (const op of layer.ops) {
      if (op.kind !== "travel" && op.kind !== "deposit") continue;
      if (!isInPrintableArea(op.to[0], op.to[1])) v.add("좌표가 출력 가능 영역(X 10~150 × Y 10~85) 밖", op.lineNo);
    }
  }
  return v.list;
}

/** c8 — 독립 참조 nonzero 구간과 행 줄 일치 + 픽스처별 단언 (채움 줄은 커버리지 검사가 본다) */
function checkReference(model, ctx) {
  const v = new Viol();
  if (!ctx.meshes) return v.list;
  const w = ctx.params.depositWidthMm;
  for (const layer of model.layers) {
    const ref = ctx.refLayers[layer.index];
    const deps = layer.ops.filter((op) => op.kind === "deposit");
    const rowDeps = deps.filter((d) => d.rowK >= 0);
    if (ref.polygons > 0 && deps.length === 0) v.add("단면이 있는데 도포 0", layer.lineNo);
    for (const d of rowDeps) {
      // 행 줄 도포 띠(y ± w/2)가 층 단면의 Y 범위를 넘으면 마스크 밖 도포 (행 종료 조건 위반 등)
      if (d.to[1] - w / 2 < ref.yMin - SNAP_TOL || d.to[1] + w / 2 > ref.yMax + SNAP_TOL) {
        v.add("도포 띠(y ± w/2)가 단면 Y 범위 밖", layer.lineNo);
      }
    }
    const expectRows = ref.rows.map((r, k) => ({ r, k })).filter(({ r }) => r.expect.length > 0);
    const actualRowCount = new Set(rowDeps.map((d) => d.rowK)).size;
    if (expectRows.length !== actualRowCount) {
      v.add(`도포 행 수 ${actualRowCount} ≠ 참조 ${expectRows.length}`, layer.lineNo);
    }
    for (const { r, k } of expectRows) {
      const spans = rowDeps
        .filter((d) => d.rowK === k)
        .map((d) => [Math.min(d.from[0], d.to[0]), Math.max(d.from[0], d.to[0])])
        .sort((a, b) => a[0] - b[0]);
      if (!sameSpans(r.expect, spans, SNAP_TOL)) v.add("행 도포 구간 ≠ 참조 nonzero 구간(w/2 축소)", layer.lineNo);
    }
  }
  if (ctx.fixtureCheck) for (const msg of ctx.fixtureCheck(model, ctx)) v.add(msg);
  return v.list;
}

/** c1~c8 + c4b 전부 — { c1: [...위반], …, c8: [...] } (gen-task0-dryrun 도 이것을 쓴다) */
export function runOutputChecks(gcode, ctx) {
  const park = [ctx.params.parkXMm, ctx.params.parkYMm];
  const model = buildModel(gcode, park);
  // 독립 참조(층 단면·행 구간) — c5 띠 원점, c8 행 줄 대조, 픽스처 단언이 함께 쓴다
  const p = ctx.params;
  ctx.refLayers = ctx.meshes
    ? model.layers.map((l) => referenceLayer(ctx.meshes, l.index, ctx.lh, p.depositWidthMm, p.bedWidthMm, p.bedDepthMm))
    : null;
  for (const layer of model.layers) classifyDeposits(layer, ctx.refLayers?.[layer.index] ?? null);
  return {
    c1: checkParser(gcode, ctx),
    c2: checkFormat(gcode, ctx),
    c3: checkRetract(model, ctx),
    c4: checkTravelCrossing(model, ctx),
    c4b: checkTravelContact(model, ctx),
    c5: checkMonotone(model, ctx),
    c6: checkExtrusion(model, ctx),
    c7: checkArea(model, ctx),
    c8: checkReference(model, ctx),
  };
}

export const CHECK_LABELS = {
  c1: "c1 Task0 파서 3모드 경고·오류 0",
  c2: "c2 줄 형식",
  c3: "c3 리트랙트 상태 기계",
  c4: "c4 트래블 교차 0",
  c4b: "c4b 트래블 다리·칠한 중심선 실제 교차 0 (잘라내기 없음)",
  c5: "c5 +Y 단조(띠)·띠 방향·띠 안 X 순서·행 간격·트래블 모양",
  c6: "c6 E 잔차 이월·|E|≤500",
  c7: "c7 출력 가능 영역",
  c8: "c8 nonzero 참조 행 줄 일치·픽스처 단언",
};

/** 통계 — writer 의 층별·합계 통계가 G-code 에서 다시 잰 값과 같음 */
export function checkStats(result, ctx) {
  const v = new Viol();
  const model = buildModel(result.gcode, [ctx.params.parkXMm, ctx.params.parkYMm]);
  if (result.layers.length !== model.layers.length) v.add("층 통계 개수 ≠ 층 수");
  let allE = 0;
  model.layers.forEach((layer, i) => {
    const s = result.layers[i];
    if (!s) return;
    let dep = 0;
    let trav = 0;
    let segs = 0;
    let ret = 0;
    let unret = 0;
    let e = 0;
    for (const op of layer.ops) {
      if (op.kind === "deposit") {
        segs++;
        dep += dist(op.from, op.to);
        e += op.args.E;
      } else if (op.kind === "travel") trav += dist(op.from, op.to);
      else if (op.kind === "eonly") op.args.E < 0 ? ret++ : unret++;
    }
    allE += e;
    const empty = !layer.ops.some((op) => op.kind === "travel" || op.kind === "deposit");
    if (s.index !== i) v.add("층 통계 index 어긋남", layer.lineNo);
    if (Math.abs(s.z - task0LayerZ(i, ctx.lh)) > 1e-12) v.add("층 통계 z ≠ (N+1)·lh", layer.lineNo);
    if (s.empty !== empty) v.add("층 통계 empty ≠ G-code", layer.lineNo);
    if (s.segments !== segs) v.add("층 통계 segments ≠ 도포 줄 수", layer.lineNo);
    if (Math.abs(s.depositMm - dep) > 1e-6) v.add("층 통계 depositMm ≠ 도포 길이", layer.lineNo);
    if (Math.abs(s.travelMm - trav) > 1e-6) v.add("층 통계 travelMm ≠ 트래블 길이(파킹부터)", layer.lineNo);
    if (s.retracts !== ret || s.unretracts !== unret) v.add("층 통계 retracts/unretracts ≠ E 단독 줄 수", layer.lineNo);
    if (Math.abs(s.extrusionMm - e) > 1e-9) v.add("층 통계 extrusionMm ≠ 도포 E 합", layer.lineNo);
    if (ctx.meshes) {
      const p = ctx.params;
      const ref = referenceLayer(ctx.meshes, i, ctx.lh, p.depositWidthMm, p.bedWidthMm, p.bedDepthMm);
      if (Math.abs(s.rowRemainderMm - ref.rowRemainder) > SNAP_TOL) {
        v.add(`층 통계 rowRemainderMm ${s.rowRemainderMm} ≠ 독립 계산 ${ref.rowRemainder}`, layer.lineNo);
      }
      if (!(s.rowRemainderMm >= 0 && s.rowRemainderMm < p.depositWidthMm)) v.add("rowRemainderMm 가 [0, w) 밖", layer.lineNo);
      // 채움 줄 수 (Z1-b2) = 행 줄(참조 구간과 같은 수평 도포)이 아닌 도포 줄
      classifyDeposits(layer, ref);
      const fillSegs = layer.ops.filter((op) => op.kind === "deposit" && op.rowK < 0).length;
      if (s.fillSegments !== fillSegs) v.add(`층 통계 fillSegments ${s.fillSegments} ≠ 채움 줄 수 ${fillSegs}`, layer.lineNo);
      if ((s.thinFill === "none" && fillSegs > 0) || (s.thinFill === "filled" && fillSegs === 0)) {
        v.add(`층 통계 thinFill '${s.thinFill}' 와 채움 줄 수 ${fillSegs} 가 어긋남`, layer.lineNo);
      }
    }
  });
  const t = result.totals;
  const lineCount = result.gcode.split("\n").length - 1;
  if (t.lineCount !== lineCount) v.add(`totals.lineCount ${t.lineCount} ≠ 실제 ${lineCount}`);
  if (Math.abs(t.extrusionMm - allE) > 1e-9) v.add("totals.extrusionMm ≠ 도포 E 합");
  if (Math.abs(t.extrusionMm - t.extrusionExactMm) > 0.5e-5 + 1e-9) v.add("totals E 출력·정확 차 > 0.5e-5");
  const empties = model.layers.filter((l) => !l.ops.some((op) => op.kind === "deposit")).map((l) => l.index);
  if (JSON.stringify(t.emptyLayers) !== JSON.stringify(empties)) v.add("totals.emptyLayers ≠ G-code");
  const maxRemainder = result.layers.reduce((acc, s) => Math.max(acc, s.rowRemainderMm), 0);
  if (t.rowRemainderMaxMm !== maxRemainder) v.add("totals.rowRemainderMaxMm ≠ 층별 최댓값");
  const sum = (key) => result.layers.reduce((acc, s) => acc + s[key], 0);
  for (const key of ["fillPieces", "fillDots", "fillSegments", "detourTravels"]) {
    if (t[key] !== sum(key)) v.add(`totals.${key} ≠ 층별 합`);
  }
  const byState = (st) => JSON.stringify(result.layers.filter((s) => s.thinFill === st).map((s) => s.index));
  if (JSON.stringify(t.thinFillLayers) !== byState("filled")) v.add("totals.thinFillLayers ≠ 층별 thinFill 'filled'");
  if (JSON.stringify(t.thinFillFailedLayers) !== byState("failed")) v.add("totals.thinFillFailedLayers ≠ 층별 thinFill 'failed'");
  return v.list;
}

// ── 픽스처별 단언 (c8 에 합류) ───────────────────────────────────────────

/** 관: 구멍 높이의 행은 구간 2개, 구멍 X 범위 안 도포 0 */
function tubeCheck(hole) {
  return (model) => {
    const out = [];
    let rowsInHole = 0;
    let rowsTwo = 0;
    for (const layer of model.layers) {
      for (const row of depositRows(layer)) {
        if (!(row.y > hole.y0 && row.y < hole.y1)) continue;
        rowsInHole++;
        if (row.deps.length === 2) rowsTwo++;
        for (const d of row.deps) {
          const lo = Math.min(d.from[0], d.to[0]);
          const hi = Math.max(d.from[0], d.to[0]);
          if (hi > hole.x0 + 1e-9 && lo < hole.x1 - 1e-9) {
            out.push(`관 구멍 안 도포 (줄 ${d.lineNo}) — 구멍이 메워짐`);
          }
        }
      }
    }
    if (rowsInHole === 0) out.push("구멍 높이의 행이 없음 — 픽스처가 구멍을 시험하지 못함");
    else if (rowsTwo !== rowsInHole) out.push(`구멍 높이 행 ${rowsInHole}개 중 구간 2개인 행 ${rowsTwo}개`);
    return out;
  };
}

/** 겹침: 모든 행이 한 줄로 겹친 구간을 덮고, 참조 even-odd 라면 끊겼을 것 */
function overlapCheck(overlapX) {
  return (model, ctx) => {
    const out = [];
    let rows = 0;
    let evenoddSplit = 0;
    model.layers.forEach((layer, i) => {
      for (const row of depositRows(layer)) {
        rows++;
        const covering = row.deps.filter((d) => {
          const lo = Math.min(d.from[0], d.to[0]);
          const hi = Math.max(d.from[0], d.to[0]);
          return lo <= overlapX[0] && hi >= overlapX[1];
        });
        if (covering.length !== 1) out.push(`겹친 구간 X ${overlapX[0]}~${overlapX[1]} 에서 도포가 끊김 (줄 ${row.deps[0].lineNo})`);
      }
      for (const r of ctx.refLayers?.[i]?.rows ?? []) {
        if (r.nonzero.length === 1 && r.evenodd.length === 2) evenoddSplit++;
      }
    });
    if (rows === 0) out.push("겹침 픽스처에 도포 행이 없음");
    if (evenoddSplit === 0) out.push("참조 even-odd 가 겹친 곳을 끊지 않음 — 픽스처가 nonzero 를 시험하지 못함");
    return out;
  };
}

/** 섬 둘: 행 안 트래블이 있고, wide=true 면 모두 리트랙트로 감쌈 / false 면 모두 1 mm 미만·리트랙트 없음 */
function islandsCheck(wide, minTravel) {
  return (model) => {
    const out = [];
    let inRow = 0;
    for (const layer of model.layers) {
      for (const g of travelGroups(layer)) {
        if (!g.afterDeposit || !g.beforeDeposit) continue;
        if (!g.points.every((pt) => pt[1] === g.points[0][1])) continue; // 행 사이 L자 제외
        inRow++;
        const eVals = g.ops.filter((op) => op.kind === "eonly").map((op) => op.args.E);
        if (wide) {
          if (!(g.len >= minTravel)) out.push(`넓은 틈 픽스처의 행 안 트래블이 ${g.len.toFixed(3)} mm (< ${minTravel})`);
          if (!(eVals.length === 2 && eVals[0] < 0 && eVals[1] > 0)) out.push("넓은 틈 행 안 트래블이 E-r … E+r 로 감싸이지 않음");
        } else {
          if (!(g.len < minTravel)) out.push(`좁은 틈 픽스처의 행 안 트래블이 ${g.len.toFixed(3)} mm (≥ ${minTravel})`);
          if (eVals.length !== 0) out.push("좁은 틈(짧은 트래블)인데 리트랙트함 — §5 예외 미적용");
        }
      }
    }
    if (inRow === 0) out.push("행 안 트래블이 없음 — 픽스처가 섬 둘을 시험하지 못함");
    return [...new Set(out)];
  };
}

/** Y 폭이 w 배수가 아닌 형상: 맨 위 도포 띠와 단면 최대 Y 사이에 band(< w) 가 남음 — 넘치지도, 더 비지도 않음 */
function remainderCheck(band) {
  return (model, ctx) => {
    const out = [];
    const w = ctx.params.depositWidthMm;
    let layers = 0;
    model.layers.forEach((layer, i) => {
      const rows = depositRows(layer);
      const ref = ctx.refLayers?.[i];
      if (!rows.length || !ref) return;
      layers++;
      const gap = ref.yMax - (rows[rows.length - 1].y + w / 2);
      if (Math.abs(gap - band) > SNAP_TOL) out.push(`맨 위 남는 띠 ${gap.toFixed(4)} mm ≠ 기대 ${band} (층 ${i})`);
    });
    if (layers === 0) out.push("나머지 띠 픽스처에 도포 층이 없음");
    return [...new Set(out)].slice(0, 5);
  };
}

/** 맞댄 면: 모든 행이 이음매(seamX) 를 한 줄로 덮음 */
function seamCheck(seamX) {
  return (model) => {
    const out = [];
    let rows = 0;
    for (const layer of model.layers) {
      for (const row of depositRows(layer)) {
        rows++;
        const covering = row.deps.filter((d) => Math.min(d.from[0], d.to[0]) <= seamX[0] && Math.max(d.from[0], d.to[0]) >= seamX[1]);
        if (row.deps.length !== 1 || covering.length !== 1) out.push(`맞댄 면 이음매에서 도포가 끊김 (줄 ${row.deps[0].lineNo})`);
      }
    }
    if (rows === 0) out.push("맞댄 면 픽스처에 도포 행이 없음");
    return [...new Set(out)];
  };
}

/** 마름모: 행 사이 L자 중 X 다리가 있는 것이 실제로 있어야(그래야 L자·교차 검사가 의미 있음) */
function diamondCheck() {
  return (model) => {
    let lWithX = 0;
    for (const layer of model.layers) {
      for (const g of travelGroups(layer)) {
        if (g.afterDeposit && g.beforeDeposit && g.points.length === 3) lWithX++;
      }
    }
    return lWithX > 0 ? [] : ["X 다리가 있는 행 사이 L자가 없음 — 픽스처가 L자를 시험하지 못함"];
  };
}

// ── 픽스처 목록 ──────────────────────────────────────────────────────────

function buildFixtures(minTravel) {
  return [
    fixtureCube10(),
    {
      name: "box-10x10.3",
      // 베드 Y 폭 10.3 mm (42.5~52.8) — w(0.5) 의 배수가 아님. 마지막 행 52.25 의 띠(~52.5) 위에 0.3 mm 띠가
      //   남는다(설계대로 Z1-b 대상 — 통계 rowRemainderMm 로만 드러냄). 행 종료 조건이 y < 최대 Y − w/2 가
      //   아니면(예: y < 최대 Y) 52.75 행이 생겨 단면 밖(53.0 까지)을 칠한다 → c8 이 잡는다.
      meshes: () => [normalizeTriangleWinding(boxTriangles([0, 0, 0], [10, 3, 10.3]))],
      solids: [[0, 3]],
      fixtureCheck: remainderCheck(0.3),
    },
    {
      name: "tube",
      // 바깥 20×20(world −10~10), 내강 8×8(−4~4) 관통 — 베드 구멍 X 71~79, Y 38.5~46.5
      meshes: () => [
        normalizeTriangleWinding(
          concatTris(boxTriangles([-10, 0, -10], [10, 5, 10]), boxTriangles([-4, 0, -4], [4, 5, 4], true)),
        ),
      ],
      solids: [[0, 5]],
      fixtureCheck: tubeCheck({ x0: 71, x1: 79, y0: 38.5, y1: 46.5 }),
    },
    {
      name: "overlap",
      // 두 메시(모델+서포트처럼 따로) — 겹친 곳 world X −2~2 = 베드 73~77
      meshes: () => [
        normalizeTriangleWinding(boxTriangles([-8, 0, -5], [2, 6, 5])),
        normalizeTriangleWinding(boxTriangles([-2, 0, -5], [8, 6, 5])),
      ],
      solids: [[0, 6]],
      fixtureCheck: overlapCheck([73, 77]),
    },
    {
      name: "touching",
      // 면을 맞댄 두 메시(world X −5~0 | 0~5) — 맞닿은 구간을 하나로 잇는지 (안 이으면 이음매에 w 틈)
      meshes: () => [
        normalizeTriangleWinding(boxTriangles([-5, 0, -5], [0, 3, 5])),
        normalizeTriangleWinding(boxTriangles([0, 0, -5], [5, 3, 5])),
      ],
      solids: [[0, 3]],
      fixtureCheck: seamCheck([74, 76]),
    },
    {
      name: "islands-wide",
      // 한 행에 섬 둘, 틈 8 mm → 행 안 트래블 8.5 mm ≥ 1 → 리트랙트
      meshes: () => [
        normalizeTriangleWinding(
          concatTris(boxTriangles([-10, 0, -3], [-4, 3, 3]), boxTriangles([4, 0, -3], [10, 3, 3])),
        ),
      ],
      solids: [[0, 3]],
      fixtureCheck: islandsCheck(true, minTravel),
    },
    {
      name: "islands-narrow",
      // 틈 0.3 mm → 행 안 트래블 0.8 mm < 1 → 리트랙트 생략 (§5 예외)
      meshes: () => [
        normalizeTriangleWinding(
          concatTris(boxTriangles([-6, 0, -3], [-0.15, 3, 3]), boxTriangles([0.15, 0, -3], [6, 3, 3])),
        ),
      ],
      solids: [[0, 3]],
      fixtureCheck: islandsCheck(false, minTravel),
    },
    {
      name: "diamond",
      // 10×10 사각 기둥을 45° 돌린 마름모 — 행마다 폭이 달라 행 사이 L자에 X 다리가 생기고, 빗변 교차도 시험
      meshes: () => [normalizeTriangleWinding(rotateTrisY(boxTriangles([-5, 0, -5], [5, 3, 5]), Math.PI / 4))],
      solids: [[0, 3]],
      fixtureCheck: diamondCheck(),
    },
    fixtureGapPlates(),
    {
      name: "float-box",
      // 바닥이 Y 0.2 에 뜬 상자 — 첫 층들이 빈 층(아직 안 쓴 툴은 상태 변경 없음)
      meshes: () => [normalizeTriangleWinding(boxTriangles([-3, 0.2, -3], [3, 1, 3]))],
      solids: [[0.2, 1]],
    },
  ];
}

/** 채움 줄(행 줄이 아닌 도포) 중 pred 를 만족하는 것이 도포한 층마다 있어야 */
function fillWhereCheck(label, pred) {
  return (model) => {
    const out = [];
    let layers = 0;
    for (const layer of model.layers) {
      const deps = layer.ops.filter((op) => op.kind === "deposit");
      if (deps.length === 0) continue;
      layers++;
      if (!deps.some((d) => d.rowK < 0 && pred(d))) out.push(`${label} 채움 줄이 없음 (층 ${layer.index})`);
    }
    if (layers === 0) out.push(`${label}: 도포한 층이 없음`);
    return out.slice(0, 5);
  };
}

/** 여러 픽스처 단언을 한 번에 */
const allChecks =
  (...checks) =>
  (model, ctx) =>
    checks.flatMap((c) => c(model, ctx));

/** 행 줄이 y 에 정확히 count 개, x 범위 [x0, x1] 안 — 1.2w 띠에 행 하나가 지나는지 */
function rowLinesAt(label, y, x0, x1, count) {
  return (model) => {
    const out = [];
    for (const layer of model.layers) {
      const n = layer.ops.filter(
        (op) =>
          op.kind === "deposit" &&
          op.rowK >= 0 &&
          Math.abs(op.to[1] - y) <= SNAP_TOL &&
          Math.min(op.from[0], op.to[0]) >= x0 &&
          Math.max(op.from[0], op.to[0]) <= x1,
      ).length;
      if (n !== count) out.push(`${label}: 층 ${layer.index} 행 줄 ${n}개 ≠ 기대 ${count}`);
    }
    return out.slice(0, 5);
  };
}

/** 사각 구멍 (x0, x1) × (y0, y1) — 형상 구멍을 w/2 줄인 안쪽 — 을 지나는 도포 줄이 없어야 */
function holeEmptyCheck(label, x0, x1, y0, y1) {
  return (model) => {
    const out = [];
    for (const layer of model.layers) {
      for (const d of layer.ops.filter((op) => op.kind === "deposit")) {
        const n = Math.max(2, Math.ceil(dist(d.from, d.to) / 0.01));
        for (let k = 0; k <= n; k++) {
          const x = d.from[0] + ((d.to[0] - d.from[0]) * k) / n;
          const y = d.from[1] + ((d.to[1] - d.from[1]) * k) / n;
          if (x > x0 && x < x1 && y > y0 && y < y1) {
            out.push(`${label} 안 도포 (줄 ${d.lineNo})`);
            break;
          }
        }
      }
    }
    return [...new Set(out)].slice(0, 5);
  };
}

/** 사각뿔대: 층마다 행 구간 길이가 달라야(단면이 층마다 다름 — 비각기둥 시험이 실제로 일어남) */
function varyingSectionCheck() {
  return (model) => {
    const widths = new Set();
    for (const layer of model.layers) {
      const row = layer.ops.find((op) => op.kind === "deposit" && op.rowK >= 0);
      if (row) widths.add(Math.round(Math.abs(row.to[0] - row.from[0]) * 1000));
    }
    return widths.size >= 5 ? [] : [`층별 행 구간 길이 종류 ${widths.size} < 5 — 단면이 층마다 다르지 않음`];
  };
}

/**
 * (A2) 얇은 부분 채움 픽스처 (Z1-b2). expectFill = 채움 층이 있어야 하는지, thinControl = 채움 끄면 커버리지 FAIL 이어야,
 * detourControl = 우회 끄면 c4 FAIL 이어야.
 */
function buildThinFixtures() {
  // 행 위상 기준판: 베드 X 63~67 × Y 42.5~46.5 — 층 최소 Y = 42.5 라 행이 42.75 + k·0.5
  const anchor = () => normalizeTriangleWinding(boxTriangles([-12, 0, 0], [-8, 1, 4]));
  const pillarAt = [
    [-3, -3],
    [0, 0.1],
    [2, 1.3],
    [-1.5, 2.5],
  ];
  return [
    {
      name: "wall-tube",
      // 바깥 10 × 10.2(베드 X 70~80 × Y 37.5~47.7), 벽 0.4 mm(< w) 속 빈 관. 행 37.75 + k·0.5 에서 왼·오른 벽 구간은
      //   0.4 mm 라 버려지고, 맨 위 행 47.25 는 내강(Y 37.9~47.3) 안이라 위쪽 벽(47.3~47.7)도 행이 없다 → ㄷ 자 미도포.
      meshes: () => [
        normalizeTriangleWinding(
          concatTris(boxTriangles([-5, 0, -5], [5, 1, 5.2]), boxTriangles([-4.6, 0, -4.6], [4.6, 1, 4.8], true)),
        ),
      ],
      solids: [[0, 1]],
      expectFill: true,
      thinControl: true,
      detourControl: true,
      fixtureCheck: allChecks(
        fillWhereCheck("왼쪽 벽(X 70~70.4)", (d) => d.from[0] < 70.4 && d.to[0] < 70.4 && d.from[1] > 40 && d.to[1] < 45),
        fillWhereCheck("오른쪽 벽(X 79.6~80)", (d) => d.from[0] > 79.6 && d.to[0] > 79.6 && d.from[1] > 40 && d.to[1] < 45),
        fillWhereCheck(
          "위쪽 벽(Y 47.3~47.7)",
          (d) => Math.min(d.from[1], d.to[1]) >= 47.3 && Math.max(d.from[1], d.to[1]) <= 47.7 && dist(d.from, d.to) > 1,
        ),
        holeEmptyCheck("내강(0.25 mm 안쪽)", 70.65, 79.35, 38.15, 47.05),
      ),
    },
    {
      name: "thin-ring",
      // 반경 4(중심선), 폭 0.3 mm = 0.6w 고리, 중심 베드 (75, 42.5). 위·아래 끝에서만 행 구간이 w 보다 길다
      meshes: () => [normalizeTriangleWinding(annulusTriangles(0, 0, 3.85, 4.15, 0, 1))],
      solids: [[0, 1]],
      expectFill: true,
      thinControl: true,
      detourControl: true,
      fixtureCheck: allChecks(
        fillWhereCheck("왼쪽 호", (d) => Math.max(d.from[0], d.to[0]) < 72),
        fillWhereCheck("오른쪽 호", (d) => Math.min(d.from[0], d.to[0]) > 78),
        holeEmptyCheck("고리 안(0.25 mm 안쪽 정사각)", 72.5, 77.5, 40, 45),
      ),
    },
    {
      name: "band-1.2w",
      // 기준판 + 얇은 띠 10 × 0.6 mm(1.2w, 베드 X 70~80 × Y 44.64~45.24). 행 44.75 하나가 아래 가장자리 0.11 mm 위를
      //   지나고 다음 행 45.25 는 위 가장자리 밖 — 행 위상에서 가장 빗나간 자리. 그래도 위 가장자리까지 0.49 mm < w 라
      //   행 하나로 (c)(d) 통과: 폭 t ∈ [w, 2w] 띠에는 행이 하나 이상 지나고, 그 행에서 띠 끝까지 < w.
      meshes: () => [anchor(), normalizeTriangleWinding(boxTriangles([-5, 0, 2.14], [5, 1, 2.74]))],
      solids: [[0, 1]],
      expectFill: false,
      fixtureCheck: rowLinesAt("1.2w 띠", 44.75, 70, 80, 1),
    },
    {
      name: "band-0.6w",
      // 기준판 + 얇은 띠 10 × 0.3 mm(0.6w, 베드 Y 44.80~45.10) — 행 44.75·45.25 사이라 행이 통째로 빗나간다(규격 §7
      //   "전역 행 위상만으로는 얇은 띠를 빗나갈 수 있다") → 섬에 도포 0 ((b)) → 중심선 채움
      meshes: () => [anchor(), normalizeTriangleWinding(boxTriangles([-5, 0, 2.3], [5, 1, 2.6]))],
      solids: [[0, 1]],
      expectFill: true,
      thinControl: true,
      fixtureCheck: fillWhereCheck(
        "0.6w 띠",
        (d) => Math.min(d.from[1], d.to[1]) >= 44.8 && Math.max(d.from[1], d.to[1]) <= 45.1 && dist(d.from, d.to) > 5,
      ),
    },
    {
      name: "pillars",
      // 0.15 mm 기둥 4개(서포트 기둥 끝 흉내) — 행 구간이 0.15 mm 라 전부 버려짐 → 섬마다 점 도포 (규격 §3 (b))
      meshes: () => [
        normalizeTriangleWinding(concatTris(...pillarAt.map(([x, z]) => boxTriangles([x, 0, z], [x + 0.15, 1, z + 0.15])))),
      ],
      solids: [[0, 1]],
      expectFill: true,
      thinControl: true,
      fixtureCheck: allChecks(
        ...pillarAt.map(([x, z], i) =>
          fillWhereCheck(`기둥 ${i + 1} 점 도포`, (d) => {
            const cx = x + 0.075 + 75;
            const cy = z + 0.075 + 42.5;
            return (
              d.from[1] === d.to[1] &&
              Math.abs((d.from[0] + d.to[0]) / 2 - cx) < 0.1 &&
              Math.abs((d.from[1] + d.to[1]) / 2 - cy) < 0.1
            );
          }),
        ),
      ),
    },
    {
      name: "frustum",
      // 사각뿔대 밑면 6 × 6 → 윗면 0.3 × 0.3, 높이 3 — 층마다 단면이 달라 맨 위 남는 띠·작은 섬 채움이 층마다 다르다
      meshes: () => [normalizeTriangleWinding(frustumTriangles(0, 0, 3, 0.15, 0, 3))],
      solids: [[0, 3]],
      expectFill: true,
      thinControl: true,
      fixtureCheck: varyingSectionCheck(),
    },
    {
      name: "x-bars",
      // 기준판 + 0.3 mm 막대 둘을 ±45° 로 겹친 X 자(길이 8 mm) — 행 구간이 0.42 mm 라 버려지고 가운데만 행이 지난다.
      //   사선 띠는 Zhang–Suen 원판이 통째로 지우던 모양(폭이 짝수 픽셀인 45° 띠) — Lü–Wang 수정 회귀 검사.
      meshes: () => [
        anchor(),
        normalizeTriangleWinding(
          concatTris(
            rotateTrisY(boxTriangles([-4, 0, -0.15], [4, 1, 0.15]), Math.PI / 4),
            rotateTrisY(boxTriangles([-4, 0, -0.15], [4, 1, 0.15]), -Math.PI / 4),
          ),
        ),
      ],
      solids: [[0, 1]],
      expectFill: true,
      thinControl: true,
      fixtureCheck: allChecks(
        fillWhereCheck("왼쪽 아래 팔", (d) => Math.max(d.from[0], d.to[0]) < 74 && Math.max(d.from[1], d.to[1]) < 41.5 && dist(d.from, d.to) > 0.3),
        fillWhereCheck("오른쪽 위 팔", (d) => Math.min(d.from[0], d.to[0]) > 76 && Math.min(d.from[1], d.to[1]) > 43.5 && dist(d.from, d.to) > 0.3),
      ),
    },
    {
      ...fixtureFileB(),
      expectFill: true,
      thinControl: true,
      detourControl: true,
      fixtureCheck: allChecks(
        fillWhereCheck("링 왼쪽 호", (d) => Math.max(d.from[0], d.to[0]) < 77),
        fillWhereCheck("링 오른쪽 호", (d) => Math.min(d.from[0], d.to[0]) > 83 && Math.max(d.from[0], d.to[0]) < 85),
        rowLinesAt("1.2w 띠", 47.25, 92.5, 102.5, 1),
        holeEmptyCheck("판 구멍(0.25 mm 안쪽)", 61.25, 63.75, 46.25, 48.75),
      ),
    },
  ];
}

function makeCtx(fixture, lh, params) {
  const meshes = fixture.meshes();
  const topY = meshesTopY(meshes);
  return {
    name: `${fixture.name} lh${lh}`,
    meshes,
    topY,
    lh,
    params,
    expectedEmpty: expectedEmptyLayers(fixture.solids, topY, lh),
    fixtureCheck: fixture.fixtureCheck ?? null,
  };
}

/** 커버리지 최악값 요약 (gen-task0-dryrun 도 쓴다) */
export function coverageSummary(rep) {
  const w = rep.worst;
  const pct = (v) => (Number.isNaN(v) ? "—" : `${(v * 100).toFixed(3)}%`);
  const at = (n) => (n === null ? "" : ` (층 ${n})`);
  return (
    `(a) 최소 ${pct(w.aMinRatio)}${at(w.aLayer)} · (b) 도포점 없는 섬 ${w.bWithoutDeposit}${at(w.bLayer)} · ` +
    `(c) 최대 ${w.cMaxAreaMm2.toFixed(4)} mm²${at(w.cLayer)} · (d) 최대 ${w.dMaxAreaMm2.toFixed(4)} mm²${at(w.dLayer)} · ` +
    `넘침 최소 ${pct(w.overflowMinRatio)}${at(w.overflowLayer)} · 프레임 밖 잘림 ${w.clippedPixels}px`
  );
}

// ── 본체 ─────────────────────────────────────────────────────────────────

function sectionFrame() {
  console.log("\n(0) 좌표 모듈 task0-frame:");
  const d = TASK0_DEFAULTS;
  const near = (a, b, t = 1e-9) => Math.abs(a - b) <= t;
  const [bx, by] = worldToBed(5, 5);
  assert(bx === 80 && by === 47.5, `worldToBed(5, 5) = (${bx}, ${by}) = 출력 가능 영역 가운데 (80, 47.5)`);
  const [wx, wz] = bedToWorld(80, 47.5);
  assert(wx === 5 && wz === 5, "bedToWorld 는 worldToBed 의 역");
  assert(
    d.bedWidthMm === 150 && d.bedDepthMm === 85 && d.projectorWidthPx === 1920 && d.projectorHeightPx === 1080 &&
      d.pixelPitchUm === 73 && d.projectorOffsetXMm === 10 && d.projectorOffsetYMm === 10,
    "기본값: 베드 150×85, 투사 1920×1080, 피치 73 µm, 시작 (10, 10)",
  );
  assert(
    d.depositWidthMm === 0.5 && d.syringeKMm3PerMm === 165 && d.overfill === 1 && d.overfillMax === 1.2 &&
      d.retractMm === 1 && d.retractMinTravelMm === 1 && d.depositSpeedMmS === 30 && d.travelSpeedMmS === 100 &&
      d.retractSpeedMmS === 30,
    "기본값: w 0.5, K 165, 과충전 1.0(상한 1.2), r 1.0, 최소 트래블 1.0, 속도 30/100/30",
  );
  assert(Object.isFrozen(d), "TASK0_DEFAULTS 는 동결");
  const p = d.pixelPitchUm / 1000;
  const [c0, r0] = bedToPixel(10, 10);
  assert(c0 === 0 && r0 === 1079, `베드 (10, 10) → 픽셀 (${c0}, ${r0}) = 열 0·맨 아래 행 (행 0 = Y 최대)`);
  const [c1, r1] = bedToPixel(10 + 1920 * p - 1e-6, 10 + 1080 * p - 1e-6);
  assert(c1 === 1919 && r1 === 0, `투사 오른쪽 위 끝 → 픽셀 (${c1}, ${r1}) = (1919, 0)`);
  const [cx, cy] = pixelCenterToBed(0, 0);
  assert(near(cx, 10 + 0.5 * p) && near(cy, 10 + 1079.5 * p), "pixelCenterToBed(0, 0) = (ox + p/2, oy + 1079.5·p)");
  let roundTrip = true;
  for (const [c, r] of [[0, 0], [1919, 1079], [960, 540], [123, 1000], [1500, 7]]) {
    const [x, y] = pixelCenterToBed(c, r);
    const [c2, r2] = bedToPixel(x, y);
    if (c2 !== c || r2 !== r) roundTrip = false;
  }
  assert(roundTrip, "픽셀 중심 → 베드 → 픽셀 왕복 일치");
  // 층 수 — 마스크 runPngZip 과 같은 식 (워커는 self 를 써서 import 불가 → 식을 그대로 옮겨 대조)
  const maskLayerCount = (topY, lh) => (topY <= 0 ? 0 : Math.max(1, Math.ceil(topY / lh)));
  let same = true;
  for (let i = 0; i < 2000; i++) {
    const topY = ((i * 7919) % 2003) / 97 - 1; // 결정적 표본, 음수·0 포함
    const lh = [0.025, 0.05, 0.1, 0.03, 0.2][i % 5];
    if (task0LayerCount(topY, lh) !== maskLayerCount(topY, lh)) same = false;
  }
  assert(same, "task0LayerCount = 마스크 층 수 식 (표본 2000)");
  assert(task0LayerCount(10, 0.1) === 100 && task0LayerCount(0.5, 0.1) === 5, "층 수: 10/0.1 = 100, 0.5/0.1 = 5");
  assert(task0LayerCount(0, 0.1) === 0 && task0LayerCount(0.01, 0.1) === 1, "층 수: topY 0 → 0, 아주 얇으면 1");
  assert(near(task0LayerZ(0, 0.1), 0.1) && near(task0LayerZ(99, 0.1), 10), "층 Z = (N+1)·lh (첫 층 Z = lh)");
  assert(near(task0SliceY(2, 0.1), 0.25), "단면 높이 = (N+0.5)·lh");
}

function reportChecks(results) {
  for (const key of Object.keys(CHECK_LABELS)) {
    const list = results[key];
    assert(list.length === 0, `${CHECK_LABELS[key]}${list.length ? " — " + list.slice(0, 3).join(" / ") : ""}`);
  }
}

function sectionFixtures(params) {
  const outputs = new Map();
  const groups = [
    ["(A) 픽스처 출력 검사 (채움 없음 — 출력 = Z1-a2):", buildFixtures(params.retractMinTravelMm)],
    ["(A2) 얇은 부분 채움 픽스처 (Z1-b2):", buildThinFixtures()],
  ];
  for (const [title, fixtures] of groups) {
  console.log(`\n${title}`);
  for (const fixture of fixtures) {
    for (const lh of [0.1, 0.05]) {
      const ctx = makeCtx(fixture, lh, params);
      const snapshot = ctx.meshes.map((m) => Float32Array.from(m));
      const result = generateTask0Gcode(ctx.meshes, ctx.topY, lh);
      const t = result.totals;
      console.log(
        `\n  [${ctx.name}] 층 ${t.layerCount}, 빈 층 ${JSON.stringify(t.emptyLayers)}, 도포 ${t.depositMm.toFixed(3)} mm, ` +
          `트래블 ${t.travelMm.toFixed(3)} mm, E-r ${t.retracts}/E+r ${t.unretracts}, E 합 ${t.extrusionMm.toFixed(5)}, 줄 ${t.lineCount}`,
      );
      reportChecks(runOutputChecks(result.gcode, ctx));
      console.log(`    E: 출력 ${ctx.eReport.printed.toFixed(6)} / 정확 ${ctx.eReport.exact.toFixed(6)} / 최대 누적 차 ${ctx.eReport.worst.toExponential(2)}`);
      const rt = ctx.retraceReport;
      console.log(
        `    되짚기(첫 다리가 직전 도포 방향과 90° 넘게 벌어짐 — 통계, 위반 아님): 합 ${rt.total}(같은 직선 겹침 ${rt.collinear}), ` +
          `있는 층 ${rt.layers}/${t.layerCount}, 층당 최대 ${rt.maxPerLayer}`,
      );
      const stats = checkStats(result, ctx);
      assert(stats.length === 0, `통계 = G-code 재측정${stats.length ? " — " + stats.slice(0, 3).join(" / ") : ""}`);
      // c9 결정성 — 새 배열로 다시 생성, 입력 무변경
      const again = generateTask0Gcode(fixture.meshes(), ctx.topY, lh);
      const unchanged = ctx.meshes.every((m, i) => m.length === snapshot[i].length && m.every((x, j) => Object.is(x, snapshot[i][j])));
      assert(again.gcode === result.gcode && unchanged, "c9 결정성 — 두 번 생성 같은 바이트, 입력 배열 무변경");
      if (fixture.name === "gap-plates" && lh === 0.1) {
        assert(t.layerCount === 5 && JSON.stringify(t.emptyLayers) === "[2]", "파일 C 형상: 5층, 층 2 만 빈 층");
      }
      if (fixture.name === "cube10" && lh === 0.1) {
        assert(t.layerCount === 100 && t.emptyLayers.length === 0, "파일 A 형상: 100층, 빈 층 없음");
      }
      if (fixture.name === "cube10") {
        assert(t.rowRemainderMaxMm === 0, "정육면체(Y 폭 = w 배수): 맨 위 남는 띠 0");
      }
      if (fixture.name === "box-10x10.3") {
        const remainders = result.layers.filter((s) => !s.empty).map((s) => s.rowRemainderMm);
        assert(
          remainders.length > 0 && remainders.every((r) => Math.abs(r - 0.3) <= 1e-9) && Math.abs(t.rowRemainderMaxMm - 0.3) <= 1e-9,
          `Y 폭 10.3: 층마다 맨 위 남는 띠 0.3 mm 가 통계(rowRemainderMm)로 드러남 (최대 ${t.rowRemainderMaxMm})`,
        );
      }
      if (fixture.name === "float-box") {
        assert(ctx.expectedEmpty.length > 0 && ctx.expectedEmpty[0] === 0, "뜬 상자: 첫 층이 빈 층 (열린 질문 경로를 실제로 탐)");
      }
      // 커버리지 (규격 §3) — G-code 텍스트에서 도포 선분을 다시 뽑아 같은 단면의 마스크와 맞댄다 (gen 과 같은 검사)
      const cov = checkTask0GcodeCoverage(ctx.meshes, ctx.topY, lh, result.gcode, { depositWidthMm: params.depositWidthMm });
      assert(
        cov.pass,
        `커버리지 전 층 (a)(b)(c)(d)·넘침 통과 — ${coverageSummary(cov)}` +
          (cov.failedLayers.length ? ` / FAIL 층 ${JSON.stringify(cov.failedLayers.slice(0, 10))}` : ""),
      );
      assert(t.thinFillFailedLayers.length === 0, `채움 실패 층 없음 ${JSON.stringify(t.thinFillFailedLayers)}`);
      const expectFill = fixture.expectFill ?? false;
      assert(
        (t.thinFillLayers.length > 0) === expectFill,
        expectFill
          ? `채움 층 ${t.thinFillLayers.length}/${t.layerCount} — 조각 ${t.fillPieces}, 점 ${t.fillDots}, 채움 줄 ${t.fillSegments}, 우회 트래블 ${t.detourTravels}`
          : `채움 없음 — 행만으로 커버리지 통과 (채움 층 ${t.thinFillLayers.length})`,
      );
      outputs.set(ctx.name, { ctx, result, fixture });
    }
  }
  }
  return outputs;
}

/**
 * (C) writer 대조군 (Z1-b2) — 같은 픽스처를 채움 끔(thinFill=false) → 커버리지 FAIL,
 * 우회 끔(thinFillDetour=false) → c4 트래블 교차 FAIL 이어야 한다(채움·우회가 실제로 일을 하고 있다는 증거).
 */
function sectionWriterControls(params) {
  console.log("\n(C) writer 대조군 — 채움 끔 → 커버리지 FAIL, 우회 끔 → c4 FAIL:");
  for (const fixture of buildThinFixtures()) {
    if (!fixture.thinControl && !fixture.detourControl) continue;
    const lh = 0.1;
    const ctx = makeCtx(fixture, lh, params);
    if (fixture.thinControl) {
      const off = generateTask0Gcode(ctx.meshes, ctx.topY, lh, { thinFill: false });
      const cov = checkTask0GcodeCoverage(ctx.meshes, ctx.topY, lh, off.gcode, { depositWidthMm: params.depositWidthMm });
      assert(
        !cov.pass && off.totals.thinFillLayers.length === 0,
        `[${ctx.name}] 채움 끔 → 커버리지 FAIL 층 ${cov.failedLayers.length}/${cov.layers.length} — ${coverageSummary(cov)}`,
      );
    }
    if (fixture.detourControl) {
      const off = generateTask0Gcode(ctx.meshes, ctx.topY, lh, { thinFillDetour: false });
      const res = runOutputChecks(off.gcode, { ...ctx });
      assert(
        res.c4.length > 0,
        `[${ctx.name}] 우회 끔 → c4 트래블 교차 검출${res.c4.length ? " — " + res.c4[0] : " (검출 못 함)"}`,
      );
    }
  }
}

// ── 대조군 ───────────────────────────────────────────────────────────────

function linesOf(gcode) {
  return gcode.slice(0, -1).split("\n");
}
const joinLines = (lines) => lines.join("\n") + "\n";
const isDeposit = (l) => RE_DEPOSIT.test(l);

/** 첫 층(층 0) 의 [첫 이동 줄 index, 다음 ;LAYER_CHANGE index) */
function layer0Range(lines) {
  const a = lines.indexOf(LAYER);
  let b = lines.indexOf(LAYER, a + 1);
  if (b < 0) b = lines.length;
  return [a + 4, b];
}

const MUTATIONS = [
  {
    id: "(i)",
    desc: "도포 줄 끝에 ` ; x` 인라인 주석",
    base: "cube10 lh0.1",
    target: "c2",
    mutate(lines) {
      const i = lines.findIndex(isDeposit);
      lines[i] += " ; x";
    },
  },
  {
    id: "(ii)",
    desc: "층 첫 G1 Z 에 F 추가",
    base: "cube10 lh0.1",
    target: "c2",
    mutate(lines) {
      const i = lines.findIndex((l) => /^G1 Z/.test(l));
      lines[i] += " F300";
    },
  },
  {
    id: "(iii)",
    desc: "층 끝 E-r 삭제",
    base: "cube10 lh0.1",
    target: "c3",
    mutate(lines) {
      const [, end] = layer0Range(lines);
      if (!/^G1 E-/.test(lines[end - 1])) throw new Error("층 0 끝이 E-r 이 아님");
      lines.splice(end - 1, 1);
    },
  },
  {
    id: "(iv)",
    desc: "E 하나를 지수 표기로",
    base: "cube10 lh0.1",
    target: "c2",
    mutate(lines) {
      const i = lines.findIndex(isDeposit);
      lines[i] = lines[i].replace(/ E([0-9.]+) /, (_m, e) => ` E${Number(e).toExponential()} `);
    },
  },
  {
    id: "(v)",
    desc: "두 행 순서 뒤집기 (+Y 단조 위반)",
    base: "cube10 lh0.1",
    target: "c5",
    mutate(lines) {
      const [s] = layer0Range(lines);
      // 정육면체 층 0: [트래블, 도포] × 행. 행 1 과 행 2 의 두 줄씩을 맞바꿈
      const row1 = lines.slice(s + 2, s + 4);
      const row2 = lines.slice(s + 4, s + 6);
      if (![...row1, ...row2].every((l, k) => (k % 2 === 0 ? RE_TRAVEL.test(l) : isDeposit(l)))) {
        throw new Error("층 0 구조가 예상과 다름");
      }
      lines.splice(s + 2, 4, ...row2, ...row1);
    },
  },
  {
    id: "(vi)",
    desc: "트래블이 칠한 줄을 가로지름 (E-r/E+r 로 감싸 c4 만 겨냥)",
    base: "cube10 lh0.1",
    target: "c4",
    mutate(lines) {
      const [s] = layer0Range(lines);
      // 행 3 도포(s+7) 뒤 L자 트래블(s+8)을 행 1 높이로 내려갔다 오는 경로로 교체
      const row1Y = RE_DEPOSIT.exec(lines[s + 3])[2];
      const legTo = lines[s + 8];
      if (!RE_TRAVEL.test(legTo) || !isDeposit(lines[s + 7])) throw new Error("층 0 구조가 예상과 다름");
      lines.splice(s + 8, 1, "G1 E-1.00000 F1800", `G1 X80.000 Y${row1Y} F6000`, legTo, "G1 E1.00000 F1800");
    },
  },
  {
    id: "(vii)",
    desc: "겹친 구간에서 도포를 끊음 (even-odd 흉내)",
    base: "overlap lh0.1",
    target: "c8",
    mutate(lines, ctx) {
      const i = lines.findIndex(isDeposit);
      const m = RE_DEPOSIT.exec(lines[i]);
      const rate = (ctx.params.depositWidthMm * ctx.lh) / ctx.params.syringeKMm3PerMm;
      const x1 = Number(m[1]);
      const prevX = Number(RE_TRAVEL.exec(lines[i - 1])[1]);
      const e1 = ((73 - prevX) * rate).toFixed(5);
      const e2 = ((x1 - 77) * rate).toFixed(5);
      lines.splice(
        i,
        1,
        `G1 X73.000 Y${m[2]} E${e1} F1800`,
        `G1 X77.000 Y${m[2]} F6000`,
        `G1 X${m[1]} Y${m[2]} E${e2} F1800`,
      );
    },
  },
  {
    id: "(viii)",
    desc: "관 구멍 안으로 도포를 늘림 (구멍 메움)",
    base: "tube lh0.1",
    target: "c8",
    mutate(lines) {
      const i = lines.findIndex((l) => isDeposit(l) && / X70\.750 Y4[0-4]\./.test(l));
      if (i < 0) throw new Error("구멍 가장자리 도포 줄 없음");
      lines[i] = lines[i].replace(" X70.750 ", " X75.000 ");
    },
  },
  {
    id: "(ix)",
    desc: "채움 층: 띠 경계에서 이어지는 두 도포 줄을 한 줄로 (띠에서 안 자름)",
    base: "wall-tube lh0.1",
    target: "c5",
    mutate(lines, ctx) {
      const w = ctx.params.depositWidthMm;
      let n = -1;
      for (let i = 0; i + 1 < lines.length; i++) {
        if (lines[i] === LAYER) n++;
        const a = RE_DEPOSIT.exec(lines[i]);
        const b = RE_DEPOSIT.exec(lines[i + 1]);
        if (!a || !b || n < 0) continue;
        const y0 = ctx.refLayers[n].yMin;
        const ya = Number(a[2]);
        const k = Math.round((ya - y0) / w);
        if (Math.abs(ya - (y0 + k * w)) < 1e-3 && Number(b[2]) > ya + 0.1) {
          lines.splice(i, 1); // 경계에서 끝나는 줄을 지우면 다음 줄이 경계 아래에서 위로 걸친다
          return;
        }
      }
      throw new Error("띠 경계에서 이어지는 도포 줄 쌍이 없음");
    },
  },
  {
    id: "(x)",
    desc: "채움 층: 앞쪽 채움 항목 하나(트래블 + 도포)를 층 끝으로 옮김 (띠 번호 감소)",
    base: "thin-ring lh0.1",
    target: "c5",
    mutate(lines) {
      const [s, end] = layer0Range(lines);
      // 첫 사선 도포 줄(채움 — 앞 위치와 Y 가 다름)과 그 앞 트래블·E 줄, 뒤로 이어진 도포 줄을 한 덩어리로
      let first = -1;
      let prevY = null;
      for (let j = s; j < end; j++) {
        const m = RE_DEPOSIT.exec(lines[j]);
        const t = RE_TRAVEL.exec(lines[j]);
        const y = m ? m[2] : t ? t[2] : prevY;
        if (m && prevY !== null && m[2] !== prevY) {
          first = j;
          break;
        }
        prevY = y;
      }
      if (first < 0) throw new Error("층 0 에 사선 채움 줄이 없음");
      let a = first;
      while (a > s && !isDeposit(lines[a - 1])) a--;
      let b = first;
      while (b + 1 < end && isDeposit(lines[b + 1])) b++;
      if (b + 1 >= end - 1) throw new Error("옮길 덩어리 뒤에 다른 도포가 없음");
      const block = lines.splice(a, b - a + 1);
      const tail = end - block.length - 1; // 층 끝 E-r 자리
      if (!/^G1 E-/.test(lines[tail])) throw new Error("층 0 끝이 E-r 이 아님");
      lines.splice(tail, 0, ...block);
    },
  },
  {
    id: "(xi)",
    desc: "트래블 하나가 칠한 줄을 짧게(전체 ≤ w) 가로지름 — c4 는 양 끝 w/2 를 잘라내면 남는 게 없어 놓친다",
    base: "wall-tube lh0.1",
    target: "c4b",
    mustMiss: "c4",
    mutate(lines, ctx) {
      const [s, end] = layer0Range(lines);
      // 층 0 의 행 0 도포(트래블 바로 뒤, 수평 1 mm 이상, 끝 C) · 다음 트래블 묶음(C → … → S)
      const d = lines.findIndex((l, k) => {
        if (k < s || k >= end || !isDeposit(l) || !RE_TRAVEL.test(lines[k - 1])) return false;
        const a = RE_TRAVEL.exec(lines[k - 1]);
        const b = RE_DEPOSIT.exec(l);
        return a[2] === b[2] && Math.abs(Number(b[1]) - Number(a[1])) >= 1;
      });
      if (d < 0) throw new Error("층 0 에 행 도포가 없음");
      const start = RE_TRAVEL.exec(lines[d - 1]);
      const dep = RE_DEPOSIT.exec(lines[d]);
      let j = d + 1;
      while (j < end && RE_TRAVEL.test(lines[j])) j++;
      if (!start || !dep || j === d + 1) throw new Error("층 0 구조가 예상과 다름");
      const xs = Number(start[1]);
      const C = [Number(dep[1]), Number(dep[2])];
      const last = RE_TRAVEL.exec(lines[j - 1]);
      const S = [Number(last[1]), Number(last[2])];
      // C 에서 행 안쪽으로 0.05 · 행 아래 0.03 인 W 를 거쳐 S 로 — W → S 다리가 행 0 을 가로지른다
      const dir = Math.sign(C[0] - xs);
      const W = [C[0] - 0.05 * dir, C[1] - 0.03];
      const total = dist(C, W) + dist(W, S);
      const crossX = W[0] + ((S[0] - W[0]) * (C[1] - W[1])) / (S[1] - W[1]);
      const inside = (crossX - xs) * dir > 0 && (C[0] - crossX) * dir > 0;
      if (!(S[1] > C[1] + 0.1) || !inside || total > ctx.params.depositWidthMm) {
        throw new Error(`가로지르는 짧은 트래블을 만들 수 없음 (전체 ${total.toFixed(3)} mm, 교차 x ${crossX.toFixed(3)})`);
      }
      const F = ctx.params.travelF;
      lines.splice(d + 1, j - d - 1, `G1 X${W[0].toFixed(3)} Y${W[1].toFixed(3)} F${F}`, `G1 X${S[0].toFixed(3)} Y${S[1].toFixed(3)} F${F}`);
    },
  },
];

function sectionMutations(outputs) {
  console.log("\n(B) 대조군 — 변조 출력은 겨냥한 검사에서 실패해야 함:");
  for (const mu of MUTATIONS) {
    const base = outputs.get(mu.base);
    const lines = linesOf(base.result.gcode);
    let mutated;
    try {
      mu.mutate(lines, base.ctx);
      mutated = joinLines(lines);
    } catch (err) {
      assert(false, `${mu.id} ${mu.desc} — 변조 준비 실패: ${err.message}`);
      continue;
    }
    if (mutated === base.result.gcode) {
      assert(false, `${mu.id} ${mu.desc} — 변조가 적용되지 않음`);
      continue;
    }
    const ctx = { ...base.ctx };
    const res = runOutputChecks(mutated, ctx);
    const caught = Object.keys(res).filter((k) => res[k].length > 0);
    console.log(`  ${mu.id} ${mu.desc}: 검출한 검사 = ${caught.join(", ") || "없음"}`);
    if (res[mu.target].length) console.log(`      ${mu.target} 위반 예: ${res[mu.target][0]}`);
    assert(res[mu.target].length > 0, `${mu.id} 겨냥한 ${CHECK_LABELS[mu.target]} 가 변조를 검출`);
    if (mu.mustMiss) {
      assert(res[mu.mustMiss].length === 0, `${mu.id} ${CHECK_LABELS[mu.mustMiss]} 는 이 변조를 놓친다 (c4b 가 필요한 이유)`);
    }
  }
}

/**
 * (D) 경로 계획 단위 검사 (Z1-b2) — writer 출력으로는 잘 안 생기는 경우를 직접 입력으로:
 *   D1 띠 자르기 — 꺾은선이 띠 경계 3개를 지나면 조각 4개, 띠 번호 연속, 자른 점이 경계 위(1 µm), 조각 끝이 이어짐.
 *   D2 칠한 선 한가운데에서 시작하는 항목 — 행(+X) 을 먼저 칠하고 같은 띠의 채움 조각이 그 행 위 점에서 위로 출발.
 *      그 점으로는 행에 정확히 수직(위·아래)으로만 들어갈 수 있다(c4: 끝 w/2 앞 지점이 행에서 w/2 이상). 격자 칸이 그 수직선에
 *      안 놓이게 범위를 잡고, 경로가 있음(unreachable 0)·교차 0·마지막 다리가 수직임을 본다(탈출점이 없으면 실패).
 */
function sectionRouteUnit() {
  console.log("\n(D) 경로 계획 단위 검사:");
  const w = 0.5;
  const origin = 40;
  // D1
  const pieces = task0CutByBands(
    [
      [70000, 40100],
      [70500, 41900],
      [71000, 41950],
    ],
    origin,
    w,
  );
  const bands = pieces.map((p) => p.band);
  const cutsOnBoundary = pieces.slice(1).every((p) => (p.pts[0][1] - origin * 1000) % 500 === 0);
  const joined = pieces.every((p, i) => i === 0 || (p.pts[0][0] === pieces[i - 1].pts.at(-1)[0] && p.pts[0][1] === pieces[i - 1].pts.at(-1)[1]));
  assert(
    JSON.stringify(bands) === "[0,1,2,3]" && cutsOnBoundary && joined && pieces.at(-1).pts.length === 3,
    `D1 띠 자르기: 띠 ${JSON.stringify(bands)} (기대 [0,1,2,3]), 자른 점이 경계 위 ${cutsOnBoundary}, 조각 이어짐 ${joined}`,
  );
  // D2
  const route = routeTask0FillLayer({
    rows: [{ yUm: 40250, slot: 0, spans: [[70000, 80000]] }],
    centerlines: [
      [
        [75000, 40250],
        [75000, 40480],
      ],
    ],
    dots: [],
    bandOriginMm: origin,
    depositWidthMm: w,
    regionMm: { xMin: 68.5, xMax: 82, yMin: 38.5, yMax: 43 },
    startUm: [0, 0],
    detour: true,
  });
  const fillStep = route.steps.find((st) => st.kind === "fill");
  const rowStep = route.steps.find((st) => st.kind === "row");
  const path = fillStep ? [[80, 40.25], ...fillStep.travel.map(([x, y]) => [x / 1000, y / 1000])] : [];
  const painted = [{ a: [70, 40.25], b: [80, 40.25] }];
  const last = path.length >= 2 ? [path.at(-2), path.at(-1)] : null;
  const vertical = last !== null && last[0][0] === 75 && Math.abs(last[0][1] - 40.25) >= w / 2;
  assert(
    route.unreachable === 0 && rowStep !== undefined && route.steps.indexOf(rowStep) === 0 && fillStep !== undefined,
    `D2 행 다음 같은 띠 채움 조각 — 경로 있음 (unreachable ${route.unreachable}, 단계 ${route.steps.map((st) => st.kind).join("→")})`,
  );
  assert(
    fillStep !== undefined && !task0TravelCrossesPainted(path, painted, w) && vertical && fillStep.travelKind === "detour",
    `D2 칠한 행 한가운데 점으로 들어가는 트래블: 교차 0, 마지막 다리 수직 ${vertical}, 종류 ${fillStep?.travelKind} — 경로 ${JSON.stringify(path)}`,
  );
}

function main() {
  console.log("Task0 G-code writer 검증 (Z1-a2 + Z1-b2 얇은 부분 채움, 규격서 v0.3.3)");
  const params = resolveTask0WriterParams();
  sectionFrame();
  const outputs = sectionFixtures(params);
  sectionMutations(outputs);
  sectionWriterControls(params);
  sectionRouteUnit();
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

const isMain = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
if (isMain) main();
