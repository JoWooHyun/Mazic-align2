// Task0 경로 미리보기 P1 헤드리스 검증 — run.gcode → 층별 이동 → 2D 단면 겹쳐 그리기 + 줌·드래그 (계획 docs/계획_경로미리보기_20261019.md §4-1).
//
//   무엇을:
//     src/features/v2/utils/task0/task0-path-preview.ts   extractTask0Moves·buildTask0PathPreview(추출), bedToSectionPx(좌표),
//                                                        진행률·노즐, 줌·이동 view(zoomSectionViewAt·panSectionView·applySectionView·
//                                                        sectionViewCssTransform), drawTask0PathLayer(그리기)
//     src/features/v2/pages/viewer/hooks/useSliceExport.ts       task0Path 상태 수명(= task0Report)
//     src/features/v2/pages/viewer/components/SliceSectionPane.tsx  경로 canvas·토글·진행률·줌·드래그(소스 검사)
//
//   (1) 추출기 동치 — 파일 A·B·C(gen-task0-dryrun 과 같은 입력, 앱 코어 runTask0GcodeExport)·파일 D(2재료)에서
//       extractTask0Moves 의 deposit 만 거른 결과 = task0-coverage extractTask0DepositSegments (JSON 글자 단위 같음),
//       travel 수 = 층 블록의 G0/G1 X·Y 줄 수 − deposit 수, 층 수 = task0LayerCount, 타입 배열판(buildTask0PathPreview) = 객체판(float32).
//       산출물 바이트 고정 sha 는 이 스크립트가 들고 있지 않는다 — 단일 소스는 verify-task0-export·verify-task0-dual-export
//       (사본을 두면 writer 가 의도적으로 바뀌는 PR 과 엇갈려 깨진다 — 10/23 §32 PR 시험 병합에서 실제로 발생).
//   (2) 좌표 일치 — 큐브 단면(world 폴리곤)을 rasterizePolygons 로 그린 마스크의 흰 영역 경계 ≟ bedToSectionPx(worldToBed(꼭짓점)):
//       세로 ±0.5 px(래스터가 행 중심 표본), 가로 ±1 px(래스터가 가로 구간을 floor/ceil 로 넓게 칠함). 표본 점 안/밖 판정,
//       파일 A 도포 끝점이 전부 흰 픽셀 위. 플레이트 150×85 · 512×288(앱) · 300×300 · 400×100(종횡비 다른 px) 셋.
//   (3) 층 정렬 — 파일 A·C·D 의 층 N 도포 선분(끝점·가운데)이 그 층 단면(task0LayerPolygonsBed N) 합집합의 w/2 안쪽
//       (8방향 w/2 − 0.01 mm 점이 전부 안). 층 수 = 단면 층 수, 빈 단면 층 = 이동 없음.
//   (4) 진행률 — p % → ⌊p·n/100⌋, 0 % = 파킹(0,0)·그린 선 없음·노즐 점 = 파킹 px, 50 % = 절반, 100 % = 전부·노즐 숨김.
//       층 첫 이동 = 파킹에서 나오는 트래블. 큐브 서펜타인 행이 흰 영역 안쪽 w/2 (75.25 ~ 84.75) 에서 시작·끝.
//       2재료 파일 D: 툴 전환 층에서 주황(T0) 띠를 전부 그린 뒤 보라(T1) 띠.
//   (6) 줌 변환 — 커서 기준 확대 뒤 커서 아래 점 불변, 배율 1~20 자르기, 이동 자르기, CSS transform 문자열(마스크) = applySectionView(경로),
//       줌·이동 뒤에도 마스크 픽셀 중심과 경로 좌표(drawTask0PathLayer 가 그린 점)가 ±0.5 마스크 px 안.
//   (7) 배선(소스) — 단면 pane(경로 canvas·래스터 상한 512·휠 passive:false·더블클릭·마스크 CSS transform·경로 canvas 는 CSS 확대 안 함),
//       useSliceExport(무효화 effect·두 핸들러 시작에서 지움·sameInputs 안에서만 채움·텍스트 보관 없음·run.gcode 핸들러 downloadBlob 그대로),
//       ViewerV2Page(props 전달만).
//   (8) 대조군 — 변조 구현을 같은 검사에 넣어 실패를 단언: a. Y 뒤집기 제거 b. bed→world 생략 c. travel 을 deposit 으로
//       d. 층 인덱스 +1 e. 줌에서 확대 중심 무시 + 소스 검사 변조(무효화 effect 에서 setTask0Path(null) 뺌 / passive:false 뺌).
//   (5 = P2 못 덮은 영역은 이 PR 범위 밖)
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "FAIL" 문자열이 들어간 레이블을 출력한다.
//   실행: npx tsx scripts/verify-task0-path-preview.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chainSegments, sliceTrianglesAtY } from "../src/features/v2/utils/slice-geometry.ts";
import { rasterizePolygons } from "../src/features/v2/utils/slice-rasterize.ts";
import { extractTask0DepositSegments } from "../src/features/v2/utils/task0/task0-coverage.ts";
import { runTask0GcodeExport } from "../src/features/v2/utils/task0/task0-export.ts";
import { TASK0_DEFAULTS, bedToWorld, task0LayerCount, worldToBed } from "../src/features/v2/utils/task0/task0-frame.ts";
import { parseGcodeText } from "../src/features/v2/utils/task0/task0-gcode-parser.ts";
import { TASK0_SLOT_COLOR_HEX } from "../src/features/v2/utils/task0/task0-material.ts";
import {
  SECTION_VIEW_IDENTITY,
  SECTION_ZOOM_MAX,
  SECTION_ZOOM_STEP,
  TASK0_MOVE_FLAG_DEPOSIT,
  TASK0_MOVE_FLAG_T1,
  applySectionView,
  bedToSectionPx,
  buildTask0PathPreview,
  clampSectionView,
  drawTask0PathLayer,
  extractTask0Moves,
  panSectionView,
  sectionViewCssTransform,
  task0LayerMoveCount,
  task0NozzleAt,
  task0ShownMovesForPercent,
  zoomSectionViewAt,
} from "../src/features/v2/utils/task0/task0-path-preview.ts";
import { TASK0_BUILT_IN_PROFILE, task0WriterOptionsForProfile } from "../src/features/v2/utils/task0/task0-profile.ts";
import { task0LayerPolygonsBed } from "../src/features/v2/utils/task0/task0-slice.ts";
import { fixtureDualPillarsPlate } from "./verify-task0-dual.mjs";
import { fixtureCube10, fixtureFileB, fixtureGapPlates, meshesTopY } from "./verify-task0-writer.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(SCRIPT_DIR, "..", "src", "features", "v2");

const LH = 0.1;
const W_DEP = TASK0_DEFAULTS.depositWidthMm;
const WRITER = task0WriterOptionsForProfile(TASK0_BUILT_IN_PROFILE);
const PLATE_W = TASK0_BUILT_IN_PROFILE.buildVolumeMm[0];
const PLATE_D = TASK0_BUILT_IN_PROFILE.buildVolumeMm[1];
/** 앱 단면 pane 의 마스크(래스터) 크기 (1920×1080 → 긴 변 1024 — 10/28 리드 결정, 종전 512). 박스(CSS)는 512×288 그대로라 kx = 0.5 */
const APP_PX = [1024, 576];

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ok: ${msg}`);
  else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}
/** 대조군 — 변조 구현에서 검사가 실패(false)해야 통과 */
function control(label, passedWithMutant) {
  assert(!passedWithMutant, `대조군 ${label} → 검사가 실패한다(변조를 잡는다)`);
}
const read = (...p) => fs.readFileSync(path.join(V2, ...p), "utf8");

// ── 픽스처 → run.gcode (앱 코어) ─────────────────────────────────────────

function makeFiles() {
  const out = {};
  for (const fx of [fixtureCube10(), fixtureGapPlates(), fixtureFileB()]) {
    const meshes = fx.meshes();
    const r = runTask0GcodeExport({ meshes, topY: meshesTopY(meshes), layerHeightMm: LH, writer: WRITER });
    out[fx.name] = { meshes, gcode: r.ok ? r.gcode : null, topY: meshesTopY(meshes) };
  }
  const d = fixtureDualPillarsPlate();
  const dm = d.meshes();
  const rd = runTask0GcodeExport({ meshes: dm, topY: meshesTopY(dm), layerHeightMm: LH, writer: WRITER, materialSlots: d.slots });
  out[d.name] = { meshes: dm, gcode: rd.ok ? rd.gcode : null, topY: meshesTopY(dm) };
  return out;
}

// ── (1) 추출기 동치 ───────────────────────────────────────────────────────

/** deposit 만 거른 결과를 기존 추출기 모양({x0,y0,x1,y1,e,tool})으로 */
function depositOnly(ext) {
  return ext.layers.map((l) => l.filter((m) => m.kind === "deposit").map(({ x0, y0, x1, y1, e, tool }) => ({ x0, y0, x1, y1, e, tool })));
}

/** 층 블록의 G0/G1 X·Y 줄 수 (파서 이식판 블록 그대로 — 추출기와 독립인 셈) */
function xyMoveCounts(gcode) {
  const parsed = parseGcodeText(gcode, { mode: "dryrun", keepE: true });
  return parsed.blocks
    .filter((b) => b.isLayer)
    .map((b) => b.gcode.split("\n").filter((ln) => /^G[01]\b/i.test(ln.trim()) && /\s[XY]-?[\d.]/i.test(ln)).length);
}

function equivalenceOk(gcode, ext) {
  const ref = extractTask0DepositSegments(gcode);
  return JSON.stringify(depositOnly(ext)) === JSON.stringify(ref.layers) && ext.parseWarnings.join("|") === ref.parseWarnings.join("|");
}

function travelCountOk(gcode, ext) {
  const xy = xyMoveCounts(gcode);
  return (
    xy.length === ext.layers.length &&
    ext.layers.every((l, i) => l.filter((m) => m.kind === "travel").length === xy[i] - l.filter((m) => m.kind === "deposit").length)
  );
}

function packedMatches(ext, packed) {
  if (packed.layerCount !== ext.layers.length) return false;
  let k = 0;
  for (let i = 0; i < ext.layers.length; i++) {
    if (packed.layerStart[i] !== k) return false;
    for (const m of ext.layers[i]) {
      const o = 4 * k;
      const f = packed.flags[k];
      if (
        packed.xy[o] !== Math.fround(m.x0) || packed.xy[o + 1] !== Math.fround(m.y0) ||
        packed.xy[o + 2] !== Math.fround(m.x1) || packed.xy[o + 3] !== Math.fround(m.y1) ||
        ((f & TASK0_MOVE_FLAG_DEPOSIT) !== 0) !== (m.kind === "deposit") ||
        ((f & TASK0_MOVE_FLAG_T1) !== 0) !== (m.tool === 1)
      ) return false;
      k++;
    }
  }
  return packed.layerStart[ext.layers.length] === k && packed.moveCount === k;
}

/**
 * 툴 전환 뒤 첫 X·Y 이동 = 파킹 (0,0) 에서 출발하는 트래블 (규격 v0.3.5 §6 — 전환 매크로가 파킹 후 복귀).
 * 층 블록 줄을 직접 세어 T 줄 다음 X·Y 이동의 번호를 찾고, 추출 결과의 그 이동을 본다. [전환 수, 어긋난 수]
 */
function toolChangeParkCheck(gcode, ext) {
  const parsed = parseGcodeText(gcode, { mode: "dryrun", keepE: true });
  let changes = 0;
  let bad = 0;
  let layer = 0;
  for (const b of parsed.blocks) {
    if (!b.isLayer) continue;
    let k = 0;
    let pending = false;
    for (const raw of b.gcode.split("\n")) {
      const ln = raw.trim();
      if (/^T[01]$/i.test(ln)) {
        pending = true;
        continue;
      }
      if (/^G[01]\b/i.test(ln) && /\s[XY]-?[\d.]/i.test(ln)) {
        if (pending) {
          changes++;
          const m = ext.layers[layer][k];
          if (!m || m.kind !== "travel" || m.x0 !== TASK0_DEFAULTS.parkXMm || m.y0 !== TASK0_DEFAULTS.parkYMm) bad++;
          pending = false;
        }
        k++;
      }
    }
    layer++;
  }
  return [changes, bad];
}

function sectionExtract(files) {
  console.log("\n(1) 추출기 동치 — 파일 A·B·C·D");
  for (const [name, f] of Object.entries(files)) {
    assert(f.gcode !== null, `${name}: run.gcode 생성됨`);
    if (f.gcode === null) continue;
    const ext = extractTask0Moves(f.gcode);
    const deps = ext.layers.reduce((s, l) => s + l.filter((m) => m.kind === "deposit").length, 0);
    const trav = ext.layers.reduce((s, l) => s + l.filter((m) => m.kind === "travel").length, 0);
    assert(equivalenceOk(f.gcode, ext), `${name}: deposit 만 거른 결과 = extractTask0DepositSegments (JSON 같음, 도포 ${deps}개)`);
    assert(travelCountOk(f.gcode, ext), `${name}: 층마다 travel 수 = G0/G1 X·Y 줄 수 − deposit 수 (travel ${trav}개)`);
    assert(ext.layers.length === task0LayerCount(f.topY, LH), `${name}: 층 수 ${ext.layers.length} = task0LayerCount`);
    assert(ext.preambleMoves === 0, `${name}: 프리앰블 X·Y 이동 0`);
    const [changes, badPark] = toolChangeParkCheck(f.gcode, ext);
    assert(
      badPark === 0 && (name !== "pillars-plate" || changes > 0),
      `${name}: T 줄 뒤 첫 이동 = 파킹 (0,0) 에서 출발하는 트래블 (층 안 전환 ${changes}회, 어긋남 ${badPark})`,
    );
    const packed = buildTask0PathPreview(f.gcode, { writer: WRITER, plateWidthMm: PLATE_W, plateDepthMm: PLATE_D });
    assert(
      packedMatches(ext, packed) && packed.depositCount === deps && packed.usesT1 === (name === "pillars-plate"),
      `${name}: 타입 배열판 = 객체판 (좌표 float32, 플래그 deposit·T1, 층 시작 인덱스)`,
    );
  }
}

// ── (2) 좌표 일치 ─────────────────────────────────────────────────────────

/** 큐브(world x 0..10, z 0..10) 의 높이 y 단면 world 폴리곤 */
function cubePolys(meshes, y) {
  const out = [];
  for (const tris of meshes) out.push(...chainSegments(sliceTrianglesAtY(tris, y)));
  return out;
}

/** 흰 픽셀 bbox [c0, c1, r0, r1] */
function whiteBox(mask) {
  let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  for (let r = 0; r < mask.height; r++)
    for (let c = 0; c < mask.width; c++)
      if (mask.data[r * mask.width + c]) {
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
      }
  return [c0, c1, r0, r1];
}

/**
 * 좌표 함수 toPx 로 큐브 단면 경계·표본·파일 A 도포 끝점을 마스크와 맞댄다. 통과면 true (대조군이 변조 함수를 넣는다).
 * cube = { meshes, xMin, xMax, zMin, zMax } (world), deposits = 파일 A 그 층 도포 선분(베드).
 */
function coordinateOk(toPx, cube, deposits, Wpx, Hpx, verbose) {
  const frame = { bedWidthMm: PLATE_W, bedDepthMm: PLATE_D, plateWidthMm: PLATE_W, plateDepthMm: PLATE_D, widthPx: Wpx, heightPx: Hpx };
  const mask = rasterizePolygons(cubePolys(cube.meshes, 5.05), { widthPx: Wpx, heightPx: Hpx, plateWidthMm: PLATE_W, plateDepthMm: PLATE_D });
  const [c0, c1, r0, r1] = whiteBox(mask);
  const [bxL, byT] = worldToBed(cube.xMin, cube.zMax, PLATE_W, PLATE_D);
  const [bxR, byB] = worldToBed(cube.xMax, cube.zMin, PLATE_W, PLATE_D);
  const [pxL, pyT] = toPx(bxL, byT, frame);
  const [pxR, pyB] = toPx(bxR, byB, frame);
  const edgeOk =
    Math.abs(c0 - pxL) <= 1 && Math.abs(c1 + 1 - pxR) <= 1 && Math.abs(r0 - pyT) <= 0.5 && Math.abs(r1 + 1 - pyB) <= 0.5;
  if (verbose) {
    console.log(
      `    ${Wpx}×${Hpx}: 흰 경계 열 [${c0}, ${c1 + 1}) 행 [${r0}, ${r1 + 1}) / 꼭짓점 px x ${pxL.toFixed(3)}~${pxR.toFixed(3)} y ${pyT.toFixed(3)}~${pyB.toFixed(3)}`,
    );
  }
  // 표본: 큐브 안쪽(경계에서 1.5 px 이상) → 흰, 바깥(1.5 px 이상) → 검정
  const mmPerPxX = PLATE_W / Wpx;
  const mmPerPxY = PLATE_D / Hpx;
  let sampleBad = 0;
  for (let bx = bxL - 5; bx <= bxR + 5; bx += 0.37) {
    for (let by = byB - 5; by <= byT + 5; by += 0.41) {
      const inX = bx > bxL + 1.5 * mmPerPxX && bx < bxR - 1.5 * mmPerPxX;
      const inY = by > byB + 1.5 * mmPerPxY && by < byT - 1.5 * mmPerPxY;
      const outX = bx < bxL - 1.5 * mmPerPxX || bx > bxR + 1.5 * mmPerPxX;
      const outY = by < byB - 1.5 * mmPerPxY || by > byT + 1.5 * mmPerPxY;
      const [px, py] = toPx(bx, by, frame);
      const c = Math.floor(px);
      const r = Math.floor(py);
      const white = c >= 0 && c < Wpx && r >= 0 && r < Hpx && mask.data[r * Wpx + c] === 1;
      if (inX && inY && !white) sampleBad++;
      if ((outX || outY) && white) sampleBad++;
    }
  }
  // 파일 A 도포 끝점 → 흰 픽셀
  let depBad = 0;
  for (const s of deposits) {
    for (const [bx, by] of [[s.x0, s.y0], [s.x1, s.y1]]) {
      const [px, py] = toPx(bx, by, frame);
      const c = Math.floor(px);
      const r = Math.floor(py);
      if (!(c >= 0 && c < Wpx && r >= 0 && r < Hpx && mask.data[r * Wpx + c] === 1)) depBad++;
    }
  }
  if (verbose) console.log(`    표본 어긋남 ${sampleBad} · 도포 끝점이 흰 픽셀 밖 ${depBad} / ${deposits.length * 2}`);
  return edgeOk && sampleBad === 0 && depBad === 0 && deposits.length > 0;
}

function cubeInfo(files) {
  return { meshes: files.cube10.meshes, xMin: 0, xMax: 10, zMin: 0, zMax: 10 };
}

function sectionCoordinate(files) {
  console.log("\n(2) 좌표 일치 — 큐브 단면 래스터 ↔ bedToSectionPx (플레이트 150×85)");
  const deps = depositOnly(extractTask0Moves(files.cube10.gcode))[50];
  for (const [Wpx, Hpx] of [APP_PX, [512, 288], [300, 300], [400, 100]]) {
    assert(coordinateOk(bedToSectionPx, cubeInfo(files), deps, Wpx, Hpx, true), `${Wpx}×${Hpx}: 경계(세로 ±0.5 · 가로 ±1 px)·표본 안/밖·파일 A 층 50 도포 끝점 전부 흰 픽셀`);
  }
}

// ── (3) 층 정렬 ───────────────────────────────────────────────────────────

/** nonzero 감김 — 점이 폴리곤 합집합 안인지 (베드 좌표) */
function insideUnion(polys, x, y) {
  let wind = 0;
  for (const poly of polys) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % n];
      if (ay <= y) {
        if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) wind++;
      } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) wind--;
    }
  }
  return wind !== 0;
}

const DIRS8 = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);

/** 층 정렬 — layers(층별 이동)의 도포가 그 층 단면의 w/2 안쪽. 통과면 true */
function layerAlignOk(meshes, topY, layers, verbose, name) {
  const count = task0LayerCount(topY, LH);
  if (layers.length !== count) return false;
  const r = W_DEP / 2 - 0.01;
  let bad = 0;
  let emptyMismatch = 0;
  let checked = 0;
  for (let n = 0; n < count; n++) {
    const polys = task0LayerPolygonsBed(meshes, n, LH, PLATE_W, PLATE_D);
    const deps = layers[n].filter((m) => m.kind === "deposit");
    if ((polys.length === 0) !== (layers[n].length === 0)) emptyMismatch++;
    for (const s of deps) {
      for (const [x, y] of [[s.x0, s.y0], [s.x1, s.y1], [(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2]]) {
        checked++;
        if (!insideUnion(polys, x, y) || !DIRS8.every(([dx, dy]) => insideUnion(polys, x + r * dx, y + r * dy))) bad++;
      }
    }
  }
  if (verbose) console.log(`    ${name}: 층 ${count} · 검사 점 ${checked} · w/2 안쪽 밖 ${bad} · 빈 층 불일치 ${emptyMismatch}`);
  return bad === 0 && emptyMismatch === 0 && checked > 0;
}

function sectionLayerAlign(files) {
  console.log("\n(3) 층 정렬 — 도포가 그 층 단면의 w/2 안쪽 (파일 A·C·D)");
  for (const name of ["cube10", "gap-plates", "pillars-plate"]) {
    const f = files[name];
    assert(layerAlignOk(f.meshes, f.topY, extractTask0Moves(f.gcode).layers, true, name), `${name}: 층 N 도포 ⊂ 층 N 단면 침식(w/2) · 빈 단면 층 = 이동 없음`);
  }
}

// ── (4) 진행률·그리기 ─────────────────────────────────────────────────────

/** 기록용 가짜 2D 컨텍스트 */
function fakeCtx() {
  const ops = [];
  const ctx = {
    lineWidth: 1,
    strokeStyle: "#000",
    fillStyle: "#000",
    globalAlpha: 1,
    lineCap: "butt",
    lineJoin: "miter",
    beginPath: () => ops.push({ op: "begin" }),
    moveTo: (x, y) => ops.push({ op: "move", x, y }),
    lineTo: (x, y) => ops.push({ op: "line", x, y }),
    stroke: () => ops.push({ op: "stroke", style: ctx.strokeStyle, width: ctx.lineWidth, alpha: ctx.globalAlpha }),
    arc: (x, y, r) => ops.push({ op: "arc", x, y, r }),
    fill: () => ops.push({ op: "fill", style: ctx.fillStyle }),
  };
  return { ctx, ops };
}

function drawOps(pathPv, layer, shown, boxW, boxH, scale = 1, [Wpx, Hpx] = APP_PX) {
  const { ctx, ops } = fakeCtx();
  drawTask0PathLayer(ctx, { path: pathPv, layer, shown, widthPx: Wpx, heightPx: Hpx, boxW, boxH, scale });
  return ops;
}

function sectionProgress(files) {
  console.log("\n(4) 진행률·노즐·그리기 순서");
  const pv = buildTask0PathPreview(files.cube10.gcode, { writer: WRITER, plateWidthMm: PLATE_W, plateDepthMm: PLATE_D });
  const layer = 50;
  const n = task0LayerMoveCount(pv, layer);
  const s0 = task0ShownMovesForPercent(n, 0);
  const s50 = task0ShownMovesForPercent(n, 50);
  const s100 = task0ShownMovesForPercent(n, 100);
  assert(s0 === 0 && s50 === Math.floor(n / 2) && s100 === n && task0ShownMovesForPercent(n, 33) === Math.floor((33 * n) / 100), `p % → ⌊p·n/100⌋ (n = ${n}: 0 → 0, 50 → ${s50}, 100 → ${n})`);
  const park = task0NozzleAt(pv, layer, 0);
  const i50 = pv.layerStart[layer] + s50 - 1;
  const iLast = pv.layerStart[layer + 1] - 1;
  const n50 = task0NozzleAt(pv, layer, s50);
  const nLast = task0NozzleAt(pv, layer, n);
  assert(park[0] === 0 && park[1] === 0, "0 % 노즐 = 파킹 (0, 0)");
  assert(n50[0] === pv.xy[4 * i50 + 2] && n50[1] === pv.xy[4 * i50 + 3], `50 % 노즐 = 이동 ${s50} 의 끝점`);
  assert(nLast[0] === pv.xy[4 * iLast + 2] && nLast[1] === pv.xy[4 * iLast + 3], "100 % 노즐 = 마지막 이동 끝점");
  const first = pv.layerStart[layer];
  assert(
    (pv.flags[first] & TASK0_MOVE_FLAG_DEPOSIT) === 0 && pv.xy[4 * first] === 0 && pv.xy[4 * first + 1] === 0,
    "층 첫 이동 = 파킹 (0,0) 에서 나오는 트래블",
  );

  const [bw, bh] = APP_PX;
  const op0 = drawOps(pv, layer, 0, bw, bh);
  const [ppx, ppy] = bedToSectionPx(0, 0, { bedWidthMm: PLATE_W, bedDepthMm: PLATE_D, plateWidthMm: PLATE_W, plateDepthMm: PLATE_D, widthPx: bw, heightPx: bh });
  const arc0 = op0.filter((o) => o.op === "arc");
  assert(
    op0.filter((o) => o.op === "stroke").length === 0 && arc0.length === 1 && Math.abs(arc0[0].x - ppx) < 1e-9 && Math.abs(arc0[0].y - ppy) < 1e-9 && ppx === 0 && ppy === bh,
    `0 %: 선 0 · 노즐 점 1개 = 파킹 px (${ppx}, ${ppy}) — 단면 왼쪽 아래 구석`,
  );
  const op50 = drawOps(pv, layer, s50, bw, bh);
  assert(op50.filter((o) => o.op === "line").length === s50 && op50.filter((o) => o.op === "arc").length === 1, `50 %: 그린 선분 ${s50}개 + 노즐 점`);
  const op100 = drawOps(pv, layer, n, bw, bh);
  assert(op100.filter((o) => o.op === "line").length === n && op100.filter((o) => o.op === "arc").length === 0, `100 %: 선분 ${n}개 전부 · 노즐 숨김`);
  const depStroke = op100.filter((o) => o.op === "stroke" && o.style === TASK0_SLOT_COLOR_HEX.A);
  const expW = W_DEP * Math.sqrt((bw / PLATE_W) * (bh / PLATE_D));
  assert(depStroke.length > 0 && depStroke.every((o) => Math.abs(o.width - expW) < 1e-9 && o.alpha === 0.85), `도포 띠 = T0 주황 · 폭 w×(px/mm) = ${expW.toFixed(3)} px · 알파 0.85`);
  const opZ = drawOps(pv, layer, n, bw, bh, 4);
  assert(opZ.filter((o) => o.op === "stroke" && o.style === TASK0_SLOT_COLOR_HEX.A).every((o) => Math.abs(o.width - expW) < 1e-9), "×4 확대: 띠 폭은 u 단위 그대로(화면에서 4배 = 실제 비드 폭)");

  // 수용 기준 1 — 서펜타인 행이 흰 영역 안쪽 w/2 에서 시작·끝 (큐브 베드 75~85)
  const deps = extractTask0Moves(files.cube10.gcode).layers[layer].filter((m) => m.kind === "deposit");
  const xs = deps.flatMap((s) => [s.x0, s.x1]);
  const ys = deps.flatMap((s) => [s.y0, s.y1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  assert(
    Math.abs(minX - (75 + W_DEP / 2)) < 1e-6 && Math.abs(maxX - (85 - W_DEP / 2)) < 1e-6 && minY >= 42.5 + W_DEP / 2 - 1e-6 && maxY <= 52.5 - W_DEP / 2 + 1e-6,
    `큐브 행 끝 X ${minX} ~ ${maxX} = 75 + w/2 ~ 85 − w/2, Y ${minY} ~ ${maxY} ⊂ [42.75, 52.25]`,
  );

  // 수용 기준 4 — 파일 D 툴 전환 층: T0 주황 띠 먼저, T1 보라 띠 뒤
  const pd = buildTask0PathPreview(files["pillars-plate"].gcode, { writer: WRITER, plateWidthMm: PLATE_W, plateDepthMm: PLATE_D });
  let dualLayers = 0;
  let orderOk = true;
  for (let L = 0; L < pd.layerCount; L++) {
    const strokes = drawOps(pd, L, task0LayerMoveCount(pd, L), bw, bh).filter((o) => o.op === "stroke" && o.style !== "rgba(148, 163, 184, 0.5)");
    const seq = strokes.map((o) => (o.style === TASK0_SLOT_COLOR_HEX.A ? "A" : o.style === TASK0_SLOT_COLOR_HEX.B ? "B" : "?"));
    if (seq.includes("A") && seq.includes("B")) {
      dualLayers++;
      if (seq.lastIndexOf("A") > seq.indexOf("B")) orderOk = false;
    }
    if (seq.includes("?")) orderOk = false;
  }
  assert(dualLayers === 2 && orderOk, `파일 D: 두 재료 층 ${dualLayers}개(층 4·5) 모두 주황(T0) 띠를 다 그린 뒤 보라(T1) 띠`);
}

// ── (6) 줌 변환 ───────────────────────────────────────────────────────────

/** CSS transform 문자열(translate(..px, ..px) scale(..)) 을 CSS 처럼 적용 — transform-origin 0 0: p → t + s·p */
function applyCss(css, u, v) {
  const m = css.match(/^translate\((-?[\d.e+-]+)px, (-?[\d.e+-]+)px\) scale\(([\d.e+-]+)\)$/);
  if (!m) return [NaN, NaN];
  const tx = Number(m[1]);
  const ty = Number(m[2]);
  const s = Number(m[3]);
  return [tx + s * u, ty + s * v];
}

/** 줌 함수 zoomFn 이 커서 아래 점을 지키는지 (통과면 true) */
function zoomAnchorOk(zoomFn, boxW, boxH) {
  let v = SECTION_VIEW_IDENTITY;
  const cursors = [[100, 80], [100, 80], [400, 200], [37, 250], [300, 30], [256, 144]];
  for (const [cx, cy] of cursors) {
    const u = (cx - v.tx) / v.scale;
    const w = (cy - v.ty) / v.scale;
    const next = zoomFn(v, cx, cy, SECTION_ZOOM_STEP, boxW, boxH);
    const [sx, sy] = applySectionView(next, u, w);
    if (!(Math.abs(sx - cx) < 1e-9 && Math.abs(sy - cy) < 1e-9)) return false;
    v = next;
  }
  return true;
}

/** 줌·이동 뒤 마스크 픽셀 중심(CSS 경로)과 경로 점(drawTask0PathLayer → applySectionView)이 ±0.5 마스크 px (통과면 true) */
function zoomAlignOk(pv, layer, view, boxW, boxH, maskInfo) {
  const [Wpx, Hpx] = APP_PX;
  const kx = boxW / Wpx;
  const ky = boxH / Hpx;
  const css = sectionViewCssTransform(view);
  const ops = drawOps(pv, layer, task0LayerMoveCount(pv, layer), boxW, boxH, view.scale);
  const pts = ops.filter((o) => o.op === "line");
  // 도포 끝점(그린 lineTo) 마다 그 점이 든 마스크 픽셀 중심과 비교
  const segs = extractTask0Moves(maskInfo.gcode).layers[layer];
  if (pts.length !== segs.length) return false;
  let worst = 0;
  for (let i = 0; i < segs.length; i++) {
    const [px, py] = bedToSectionPx(segs[i].x1, segs[i].y1, { bedWidthMm: PLATE_W, bedDepthMm: PLATE_D, plateWidthMm: PLATE_W, plateDepthMm: PLATE_D, widthPx: Wpx, heightPx: Hpx });
    const c = Math.floor(px);
    const r = Math.floor(py);
    const [mx, my] = applyCss(css, (c + 0.5) * kx, (r + 0.5) * ky); // 마스크 층 (CSS transform)
    const [qx, qy] = applySectionView(view, pts[i].x, pts[i].y); // 경로 층 (setTransform 과 같은 변환)
    const dx = Math.abs(mx - qx) / (view.scale * kx);
    const dy = Math.abs(my - qy) / (view.scale * ky);
    worst = Math.max(worst, dx, dy);
  }
  maskInfo.worst = worst;
  return worst <= 0.5 + 1e-9;
}

function sectionZoom(files) {
  console.log("\n(6) 줌·이동 변환");
  const [bw, bh] = [512, 288];
  assert(zoomAnchorOk(zoomSectionViewAt, bw, bh), "커서 기준 확대 — 확대 뒤에도 커서 아래 점이 커서 아래 (6회, 커서 여러 곳)");
  let v = SECTION_VIEW_IDENTITY;
  for (let i = 0; i < 40; i++) v = zoomSectionViewAt(v, 10, 10, SECTION_ZOOM_STEP, bw, bh);
  assert(v.scale === SECTION_ZOOM_MAX, `배율 상한 ${SECTION_ZOOM_MAX} (40칸 확대 → ×${v.scale})`);
  for (let i = 0; i < 60; i++) v = zoomSectionViewAt(v, 300, 200, 1 / SECTION_ZOOM_STEP, bw, bh);
  assert(v.scale === 1 && v.tx === 0 && v.ty === 0, "끝까지 축소 → ×1 · 이동 0 (원래대로)");
  const p = panSectionView(zoomSectionViewAt(SECTION_VIEW_IDENTITY, 256, 144, 4, bw, bh), 5000, -5000, bw, bh);
  assert(p.tx === 0 && Math.abs(p.ty - bh * (1 - p.scale)) < 1e-9, "드래그 이동은 확대된 내용이 박스를 덮는 범위로 자른다");
  assert(panSectionView(SECTION_VIEW_IDENTITY, 50, 50, bw, bh).tx === 0, "×1 에서는 드래그해도 움직이지 않는다");
  const c = clampSectionView({ scale: 0.2, tx: 5, ty: 5 }, bw, bh);
  assert(c.scale === 1 && c.tx === 0 && c.ty === 0, "자르기 — 배율 1 미만·이동 밖 값");
  let cssSame = true;
  for (const vv of [SECTION_VIEW_IDENTITY, { scale: 3.2, tx: -100.25, ty: -40.5 }, { scale: 20, tx: -9000, ty: -5000 }]) {
    for (const [u, w] of [[0, 0], [12.5, 7.25], [511, 287]]) {
      const [a, b] = applyCss(sectionViewCssTransform(vv), u, w);
      const [x, y] = applySectionView(vv, u, w);
      if (!(Math.abs(a - x) < 1e-9 && Math.abs(b - y) < 1e-9)) cssSame = false;
    }
  }
  assert(cssSame, "마스크 CSS transform(transform-origin 0 0) = 경로 applySectionView — 같은 변환");

  const pv = buildTask0PathPreview(files.cube10.gcode, { writer: WRITER, plateWidthMm: PLATE_W, plateDepthMm: PLATE_D });
  const views = [
    SECTION_VIEW_IDENTITY,
    zoomSectionViewAt(SECTION_VIEW_IDENTITY, 270, 120, 6, bw, bh),
    panSectionView(zoomSectionViewAt(SECTION_VIEW_IDENTITY, 300, 100, 18, bw, bh), -37, 21, bw, bh),
  ];
  // 박스 = 앱 크기(512×288) 와 칸에 맞춰 줄어든 박스(소수 px)
  for (const [bW, bH] of [[512, 288], [384.75, 216.421875]]) {
    for (const vv of views) {
      const view = clampSectionView({ scale: vv.scale, tx: (vv.tx * bW) / bw, ty: (vv.ty * bH) / bh }, bW, bH);
      const info = { gcode: files.cube10.gcode, worst: NaN };
      const ok = zoomAlignOk(pv, 50, view, bW, bH, info);
      assert(ok, `박스 ${bW}×${bH} · ×${view.scale.toFixed(2)}: 마스크 픽셀 중심 ↔ 경로 점 최대 ${info.worst.toFixed(3)} 마스크 px (≤ 0.5)`);
    }
  }
}

// ── (7) 배선(소스) ────────────────────────────────────────────────────────

function paneOk(pane) {
  const canvasTag = pane.slice(pane.indexOf("<canvas"), pane.indexOf("/>", pane.indexOf("<canvas")));
  return (
    /const MASK_MAX_PX = 1024;/.test(pane) &&
    // 10/28 — 박스(CSS)는 래스터와 분리해 종전 512 기준, 래스터가 장치 px 보다 촘촘하면 부드러운 축소
    /const BOX_BASE_PX = 512;/.test(pane) &&
    /Math\.min\(1, stage\.w \/ boxBaseW, stage\.h \/ boxBaseH\)/.test(pane) &&
    /const maskSmooth = devicePxPerMaskPx < 1;/.test(pane) &&
    /smooth=\{maskSmooth\}/.test(pane) &&
    /ref=\{pathCanvasRef\}/.test(pane) &&
    /drawTask0PathLayer\(ctx, \{/.test(pane) &&
    /el\.addEventListener\("wheel", onWheel, \{ passive: false \}\);/.test(pane) &&
    /e\.preventDefault\(\);/.test(pane) &&
    /transform: sectionViewCssTransform\(view\),\s*transformOrigin: "0 0",/.test(pane) &&
    /onDoubleClick=\{\(e\) => \{\s*e\.stopPropagation\(\);\s*resetView\(\);/.test(pane) &&
    /setPointerCapture\(e\.pointerId\)/.test(pane) &&
    /ctx\.setTransform\(\s*sx \* view\.scale,\s*0,\s*0,\s*sy \* view\.scale,\s*sx \* view\.tx,\s*sy \* view\.ty,\s*\);/.test(pane) &&
    // 경로 canvas 는 CSS 확대하지 않는다 (style·transform 없음)
    canvasTag.length > 0 && !/style=|transform/.test(canvasTag) &&
    /useState\(true\); \/\/ 리드 10\/22 — 기본 켬/.test(pane) &&
    /progress\.path === task0Path && progress\.layer === layerIdx/.test(pane) &&
    /widthPx=\{widthPx\}/.test(pane) &&
    /run\.gcode 만/.test(pane)
  );
}

function hookOk(hook) {
  const at = hook.indexOf("const task0ReportEpochRef = useRef(0);");
  const eff = hook.slice(at, hook.indexOf("]);", at) + 3);
  const job = hook.slice(hook.indexOf("const handleExportTask0JobZip"), hook.indexOf("const handleExportTask0Gcode"));
  const gc = hook.slice(hook.indexOf("const handleExportTask0Gcode"), hook.lastIndexOf("return {"));
  const okBlock = gc.slice(gc.indexOf("if (sameInputs) {\n        setTask0Report({ ok: true"));
  const okBlockBody = okBlock.slice(0, okBlock.indexOf("\n      }\n"));
  return (
    /const \[task0Path, setTask0Path\] = useState<Task0PathPreview \| null>\(null\);/.test(hook) &&
    /setTask0Report\(null\);\n\s*setTask0Path\(null\);/.test(eff) &&
    /setTask0Report\(null\);\n\s*setTask0Path\(null\);/.test(job) &&
    /setTask0Report\(null\);\n\s*setTask0Path\(null\);/.test(gc) &&
    !/setTask0Path\(\s*safeBuildTask0Path/.test(job) && !/buildTask0PathPreview/.test(job) &&
    /setTask0Path\(\s*safeBuildTask0Path\(result\.gcode, printerProfile\),\s*\);/.test(okBlockBody) &&
    (gc.match(/setTask0Path\(/g) ?? []).length === 2 &&
    /downloadBlob\(blob, fileName\);/.test(gc) &&
    // 텍스트를 상태에 두지 않는다 — string 상태 없음
    !/useState<string/.test(hook) &&
    /task0Path: isTask0Profile\(printerProfile\) \? task0Path : undefined,/.test(hook) &&
    /writer: task0WriterOptionsForProfile\(printerProfile\),\s*\/\/[^\n]*\n\s*plateWidthMm: printerProfile\.buildVolumeMm\[0\],\s*plateDepthMm: printerProfile\.buildVolumeMm\[1\],/.test(hook)
  );
}

function pageOk(page) {
  return (
    /<SliceSectionPane[\s\S]*?layerIdx=\{safeLayerIdx\}\s*task0Path=\{task0Path\}\s*\/>/.test(page) &&
    /\n\s*task0Path,\n\s*\} = useSliceExport\(\{/.test(page) &&
    !/buildTask0PathPreview|task0-path-preview/.test(page)
  );
}

function sectionWiring() {
  console.log("\n(7) 배선(소스)");
  const pane = read("pages", "viewer", "components", "SliceSectionPane.tsx");
  const hook = read("pages", "viewer", "hooks", "useSliceExport.ts");
  const page = read("pages", "ViewerV2Page.tsx");
  const prev = read("components", "SliceMaskPreview.tsx");
  assert(paneOk(pane), "단면 pane: 래스터 상한 1024 · 박스 512 기준(래스터와 분리) · 촘촘하면 부드러운 축소 · 경로 canvas(CSS 확대 없음, setTransform = view) · 휠 passive:false + preventDefault · 마스크 CSS transform(origin 0 0) · 더블클릭 리셋 · 드래그 포인터 캡처 · 경로 보기 기본 켬 · 진행률은 층·경로가 같을 때만");
  // 10/28 — smooth 가 아니면(기본) 종전 pixelated, smooth 면 부드러운 축소(1024 래스터를 작은 박스에 띄울 때 얇은 벽 건너뜀 방지)
  assert(
    /style=\{\{ imageRendering: smooth \? "auto" : "pixelated" \}\}/.test(prev) && /smooth = false,/.test(prev) && /canvas\.getContext\("2d"\)/.test(prev),
    "SliceMaskPreview: 마스크 그리기 그대로 · 기본 pixelated, smooth 면 auto",
  );
  assert(hookOk(hook), "useSliceExport: task0Path 수명 = task0Report(무효화 effect·두 핸들러 시작에서 지움, run.gcode sameInputs 안에서만 채움, job.zip 은 안 채움), 텍스트 상태 없음, 다운로드 그대로, Task0 아니면 undefined");
  assert(pageOk(page), "ViewerV2Page: task0Path·layerIdx 를 pane 에 넘기기만");
  return { pane, hook };
}

// ── (8) 대조군 ────────────────────────────────────────────────────────────

function sectionControls(files, src) {
  console.log("\n(8) 대조군 — 변조 구현은 같은 검사에서 실패해야 한다");
  const cube = cubeInfo(files);
  const deps = depositOnly(extractTask0Moves(files.cube10.gcode))[50];
  // a. Y 뒤집기 제거
  const noFlip = (bx, by, f) => {
    const [wx, wz] = bedToWorld(bx, by, f.bedWidthMm, f.bedDepthMm);
    return [((wx + f.plateWidthMm / 2) / f.plateWidthMm) * f.widthPx, ((wz + f.plateDepthMm / 2) / f.plateDepthMm) * f.heightPx];
  };
  control("a. Y 뒤집기 제거", coordinateOk(noFlip, cube, deps, ...APP_PX, false));
  // b. bed → world 생략 (베드 좌표를 world 로 착각 — 75 mm 어긋남)
  const noBedToWorld = (bx, by, f) => [((bx + f.plateWidthMm / 2) / f.plateWidthMm) * f.widthPx, ((f.plateDepthMm / 2 - by) / f.plateDepthMm) * f.heightPx];
  control("b. bed→world 생략", coordinateOk(noBedToWorld, cube, deps, ...APP_PX, false));
  // c. travel 을 deposit 으로
  for (const name of ["cube10", "pillars-plate"]) {
    const g = files[name].gcode;
    const ext = extractTask0Moves(g);
    const mut = { ...ext, layers: ext.layers.map((l) => l.map((m) => ({ ...m, kind: "deposit" }))) };
    control(`c. travel 을 deposit 으로 (${name})`, equivalenceOk(g, mut) && travelCountOk(g, mut));
  }
  // c2. 툴 전환 뒤 파킹 리셋 없음 — 전환 트래블 출발점을 앞 툴 끝점으로 되돌린 결과
  {
    const g = files["pillars-plate"].gcode;
    const ext = extractTask0Moves(g);
    const mut = {
      ...ext,
      layers: ext.layers.map((l) => l.map((m, i) => (i > 0 && m.x0 === 0 && m.y0 === 0 ? { ...m, x0: l[i - 1].x1, y0: l[i - 1].y1 } : m))),
    };
    control("c2. 툴 전환 뒤 파킹 리셋 없음 (pillars-plate)", toolChangeParkCheck(g, mut)[1] === 0);
  }
  // d. 층 인덱스 +1 (층 N 자리에 층 N+1 의 이동)
  for (const name of ["gap-plates", "pillars-plate"]) {
    const f = files[name];
    const layers = extractTask0Moves(f.gcode).layers;
    const shifted = layers.map((_, i) => layers[i + 1] ?? []);
    control(`d. 층 인덱스 +1 (${name})`, layerAlignOk(f.meshes, f.topY, shifted, false, name));
  }
  // e. 줌에서 확대 중심 무시 (원점 기준 확대)
  const zoomNoAnchor = (v, _cx, _cy, factor, bw, bh) => {
    const cur = clampSectionView(v, bw, bh);
    const s = Math.min(SECTION_ZOOM_MAX, Math.max(1, cur.scale * factor));
    const k = s / cur.scale;
    return clampSectionView({ scale: s, tx: k * cur.tx, ty: k * cur.ty }, bw, bh);
  };
  control("e. 줌 확대 중심 무시", zoomAnchorOk(zoomNoAnchor, 512, 288));
  // f. 소스 변조 — 무효화 effect 에서 경로를 안 지움 / 휠 passive:false 없음 / 경로 canvas 를 CSS 확대
  const at = src.hook.indexOf("const task0ReportEpochRef = useRef(0);");
  const brokenHook = src.hook.slice(0, at) + src.hook.slice(at).replace("setTask0Report(null);\n    setTask0Path(null);\n  }, [", "setTask0Report(null);\n  }, [");
  control("f1. 무효화 effect 에서 setTask0Path(null) 뺌", brokenHook !== src.hook && hookOk(brokenHook));
  const brokenPane = src.pane.replace('el.addEventListener("wheel", onWheel, { passive: false });', 'el.addEventListener("wheel", onWheel);');
  control("f2. 휠 passive:false 뺌(페이지 스크롤)", brokenPane !== src.pane && paneOk(brokenPane));
  const brokenPane2 = src.pane.replace("ref={pathCanvasRef}\n", "ref={pathCanvasRef}\n              style={{ transform: sectionViewCssTransform(view) }}\n");
  control("f3. 경로 canvas 를 CSS 로 확대(흐려짐)", brokenPane2 !== src.pane && paneOk(brokenPane2));
}

function main() {
  console.log("Task0 경로 미리보기 P1 검증 (계획 docs/계획_경로미리보기_20261019.md §4-1)");
  const files = makeFiles();
  sectionExtract(files);
  if (Object.values(files).some((f) => f.gcode === null)) {
    console.error("\n픽스처 run.gcode 가 막혀 나머지를 못 돌림");
    process.exit(1);
  }
  sectionCoordinate(files);
  sectionLayerAlign(files);
  sectionProgress(files);
  sectionZoom(files);
  const src = sectionWiring();
  sectionControls(files, src);
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
