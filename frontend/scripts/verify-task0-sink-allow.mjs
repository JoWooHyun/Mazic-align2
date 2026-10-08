// Task0 플레이트 아래 파고든 모델 "확인 후 허용"(Z3-b) 헤드리스 검증 — 순수 판정 · 화면 관문 동작 · 코어가 잘린 채 job.zip 을 만듦 ·
// 하드 위반은 여전히 막힘 · 소스 형태 · 대조군.
//
//   무엇을: 리드 결정(2026-10-08) — 치과에서 모델 바닥을 일부러 플레이트 밑으로 넣어 잘라 쓰는 일이 잦다. Task0 프로파일에서
//     플레이트 아래로만 파고든 모델은 확인 후 내보내고(바닥이 잘린 채 출력), 가로·세로 영역 밖·높이 초과(서포트 묶음 포함)는 지금처럼 막는다.
//     src/features/v2/utils/build-volume.ts                     isTask0HardViolation (순수 판정 — 화면 관문·배너·이 스크립트가 공유)
//     src/features/v2/pages/viewer/hooks/useSliceExport.ts      alertIfOutOfTask0Area (하드 → alert 로 막음 / 파묻힘만 → confirm)
//     src/features/v2/pages/ViewerV2Page.tsx                    Task0 출력영역 배너 문구 두 갈래 (task0HardIssue)
//   코어(utils/task0/task0-export.ts)는 무변경 — 영역 검사는 XY 만(meshesBedBox·areaExcess), 층 단면은 (N+0.5)·lh 부터라
//   Y < 0 부분은 자연히 잘린다. 이 스크립트의 (b) 가 그 사실을 실제 job.zip 으로 확인한다.
//
//   (a) 순수 판정 isTask0HardViolation — belowPlate 만 → false / belowPlate+minX → true / aboveMax 만 → true / minZ 만 → true /
//       minX·maxX·maxZ 각각 → true / 전부 false → false / 서포트 XY 위반(checkItemsInPrintableArea 의 kind "support" 묶음) → true.
//       실제 AABB: 10 mm 상자를 Y −2~8 에 둔 메시(아래 (b) 와 같은 삼각형)의 AABB 를 checkPrintableArea(빌트인 Task0 프로파일 영역·높이)
//       → belowPlate 만 true → isTask0HardViolation false · hasViolation true. 같은 상자를 world X 80~90 에 두면(파묻힘 포함) true.
//   (a2) 화면 관문 동작 — useSliceExport.ts 의 alertIfOutOfTask0Area 본문을 소스에서 잘라 (타입 표기만 벗기고) 가짜 window 로 실행:
//       빈 목록 → 통과·대화상자 없음 / 파묻힘만 + 확인 → 통과(confirm 1, alert 0, 문구 "플레이트 아래 2.00 mm"·"잘린 채 출력") /
//       파묻힘만 + 취소 → 막음 / 섞임(파묻힘 A + X 밖 B + 서포트 C) → alert 1·confirm 0·막음, 알림에 B·C 만(A 없음)·건수 2 /
//       파묻힘 + X 밖이 한 모델 → alert / 파묻힘 5개 → "5개"·이름 3개·"외 2개".
//   (b) 코어는 파묻힌 모델로 정상 job.zip 을 만든다 — 10 mm 정육면체 world Y −2~8(베드 XY 가운데) → runTask0JobZipExport
//       (빌트인 프로파일 writer·투사 프레임·출력 가능 영역) ok, 층 수 = task0LayerCount(8, 0.1) = 80, 빈 층 0, 층 0 PNG 흰 픽셀 =
//       10×10 mm 에 해당하는 수(±2 %). 비교군: 같은 상자를 Y 0~10 에 두면 100층, 층 0 흰 픽셀 같음 → 아래 2 mm(20층)가 잘린 채 출력.
//   (c) 하드 위반은 코어가 여전히 막는다 — 같은 상자를 world X 80~90(베드 X 155~165)에 두면 ok false + "출력 가능 영역 … 밖" 문구,
//       파묻힘 + X 밖도 같은 문구로 막힘.
//   (d) 소스 형태 — 훅: 관문 본문에 const hard = volumeIssues.filter(… isTask0HardViolation(it.violation)), hard 분기 안에 window.alert
//       + return true, 그 뒤 window.confirm + return !ok, alert·confirm 각 1곳, deps [volumeIssues], import / 두 Task0 핸들러에
//       if (alertIfOutOfTask0Area()) return; 그대로 + P-1 confirm 안 부름 + deps 에 alertIfOutOfTask0Area / confirmIfOutOfBounds 블록
//       sha256 = a02d43a 의 값(diff 0) + 기존 문구 두 줄. 페이지: task0HardIssue = volumeIssues.some(… isTask0HardViolation …)(훅 아님),
//       Task0 갈래가 task0HardIssue ? 기존 차단 문구 : "… 잘린 채 출력됩니다" 문구, 기존 프로파일 문구·"플레이트 위로 올리기" 버튼 그대로.
//   (e) 대조군 — 실제 파일은 고치지 않고 메모리에서 문자열·함수를 바꿔 같은 검사에 넣는다. 전부 "검사가 실패함" 이어야 통과:
//       M1 isTask0HardViolation 을 hasViolation(belowPlate 포함)으로 → (a) 와 (a2) 가 실패
//       M2 관문을 옛 구현(a02d43a — window.confirm 분기 없이 항상 alert)으로 → (d) 와 (a2) 가 실패
//       M3 hard 를 volumeIssues.filter(() => true) 로 → (d) 와 (a2) 가 실패
//       M4 (생략) 코어 호출부를 confirmIfOutOfBounds() 로 바꾸는 변조는 verify-task0-export (5)·verify-task0-jobzip-export g2 가 잡는다.
//       M5 페이지 task0HardIssue 를 volumeIssues.length > 0 으로(항상 차단 문구) → (d) 가 실패
//       M6 hard 분기 알림 목록을 volumeIssues 기준으로(섞이면 파묻힘 항목도 나열) → (a2) 가 실패
//       M7 confirmIfOutOfBounds(기존 프로파일) 문구를 바꾸면 → (d) 가 실패
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "변조"·"FAIL" 문자열을 출력할 수 있다.
//   실행: npx tsx scripts/verify-task0-sink-allow.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkItemsInPrintableArea,
  checkPrintableArea,
  hasViolation,
  isTask0HardViolation,
} from "../src/features/v2/utils/build-volume.ts";
import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";
import { task0LayerCount } from "../src/features/v2/utils/task0/task0-frame.ts";
import { TASK0_APP_JOB_GENERATOR, runTask0JobZipExport } from "../src/features/v2/utils/task0/task0-export.ts";
import { readTask0ZipEntries, task0LayerPngName } from "../src/features/v2/utils/task0/task0-jobzip.ts";
import { decodeTask0GrayPng } from "../src/features/v2/utils/task0/task0-png.ts";
import {
  TASK0_BUILT_IN_PROFILE,
  task0PrintableAreaForProfile,
  task0PrintableFrameForProfile,
  task0RasterFrameForProfile,
  task0WriterOptionsForProfile,
} from "../src/features/v2/utils/task0/task0-profile.ts";
import { profileExposure } from "../src/features/v2/pages/viewer/utils/profile-exposure.ts";
import { boxTriangles, meshesTopY } from "./verify-task0-writer.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(SCRIPT_DIR, "..", "src", "features", "v2");

/** confirmIfOutOfBounds 블록(선언 ~ deps) sha256 — a02d43a(Z3-b 직전)의 값. 기존 프로파일 P-1 확인은 이 PR 에서 diff 0 */
const CONFIRM_BLOCK_SHA = "ad8d2ae974711205c7f976968e06df4fd0284f686998e1a3580c9e2900bf1d0c";

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

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const read = (...p) => fs.readFileSync(path.join(V2, ...p), "utf8").replace(/\r\n/g, "\n");

/** 앱이 빌트인 Task0 프로파일에서 넘기는 값 (useSliceExport handleExportTask0JobZip 과 같은 함수) */
const P = TASK0_BUILT_IN_PROFILE;
const APP = {
  writer: task0WriterOptionsForProfile(P),
  frame: task0RasterFrameForProfile(P),
  printable: task0PrintableFrameForProfile(P),
  exposure: profileExposure(P),
};
/** 화면 검사 영역·높이 (useBuildVolumeCheck 에 넘기는 값 — ViewerV2Page printableAreaMm·plateHeightMm) */
const AREA = task0PrintableAreaForProfile(P);
const HEIGHT_MM = P.buildVolumeMm[2];
const LH = 0.1;

/** 픽스처 — 10 mm 정육면체 (world X/Z 0~10 = 베드 X 75~85 × Y 42.5~52.5, 출력 가능 영역 가운데) */
const SUNK = () => [normalizeTriangleWinding(boxTriangles([0, -2, 0], [10, 8, 10]))];
const FLAT = () => [normalizeTriangleWinding(boxTriangles([0, 0, 0], [10, 10, 10]))];
/** 같은 상자를 world X 80~90(베드 X 155~165 — 출력 가능 영역 X 150 밖)에 */
const OUT_X = () => [normalizeTriangleWinding(boxTriangles([80, 0, 0], [90, 10, 10]))];
const SUNK_OUT_X = () => [normalizeTriangleWinding(boxTriangles([80, -2, 0], [90, 8, 10]))];

/** 삼각형 배열들의 world AABB */
function trisAabb(meshes) {
  const a = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (const t of meshes) {
    for (let i = 0; i + 2 < t.length; i += 3) {
      a.minX = Math.min(a.minX, t[i]);
      a.maxX = Math.max(a.maxX, t[i]);
      a.minY = Math.min(a.minY, t[i + 1]);
      a.maxY = Math.max(a.maxY, t[i + 1]);
      a.minZ = Math.min(a.minZ, t[i + 2]);
      a.maxZ = Math.max(a.maxZ, t[i + 2]);
    }
  }
  return a;
}

const NONE = { minX: false, maxX: false, minZ: false, maxZ: false, belowPlate: false, aboveMax: false };
const V = (o) => ({ ...NONE, ...o });

// ── (a) 순수 판정 ────────────────────────────────────────────────────────

/** 순수 판정 단언 — 판정 함수를 주입받는다(대조군 M1 이 변조 판정을 넣는다). 어긋난 항목 목록을 돌려준다 */
function pureFails(hardFn) {
  const fails = [];
  const want = (label, got, exp) => {
    if (got !== exp) fails.push(`${label}: ${got} (기대 ${exp})`);
  };
  want("belowPlate 만", hardFn(V({ belowPlate: true })), false);
  want("belowPlate + minX", hardFn(V({ belowPlate: true, minX: true })), true);
  want("aboveMax 만", hardFn(V({ aboveMax: true })), true);
  want("minZ 만", hardFn(V({ minZ: true })), true);
  want("minX 만", hardFn(V({ minX: true })), true);
  want("maxX 만", hardFn(V({ maxX: true })), true);
  want("maxZ 만", hardFn(V({ maxZ: true })), true);
  want("전부 false", hardFn(NONE), false);

  // 서포트 묶음 — 가로·세로만 검사되고 belowPlate 는 항상 false 로 묶인다(checkItemsInPrintableArea) → 있으면 항상 하드
  const sup = checkItemsInPrintableArea(
    [],
    [{ parentId: "m1", aabb: { minX: AREA.maxX - 1, maxX: AREA.maxX + 3, minY: -0.5, maxY: 4, minZ: 0, maxZ: 1 } }],
    AREA,
    HEIGHT_MM,
  );
  want("서포트 XY 위반 묶음 1건", sup.length === 1 && sup[0].kind === "support" && !sup[0].violation.belowPlate, true);
  want("서포트 XY 위반 → 하드", sup.length === 1 && hardFn(sup[0].violation), true);

  // 실제 AABB — (b) 와 같은 삼각형
  const sunkV = checkPrintableArea(trisAabb(SUNK()), AREA, HEIGHT_MM);
  want("Y −2~8 상자: belowPlate 만", JSON.stringify(sunkV) === JSON.stringify(V({ belowPlate: true })), true);
  want("Y −2~8 상자: 하드 아님", hardFn(sunkV), false);
  want("Y −2~8 상자: hasViolation (경고는 뜬다)", hasViolation(sunkV), true);
  const items = checkItemsInPrintableArea([{ id: "sunk", aabb: trisAabb(SUNK()) }], [], AREA, HEIGHT_MM);
  want("Y −2~8 상자: 화면 검사 항목 1건(모델) · 하드 아님", items.length === 1 && items[0].kind === "model" && !hardFn(items[0].violation), true);
  const mixedV = checkPrintableArea(trisAabb(SUNK_OUT_X()), AREA, HEIGHT_MM);
  want("X 80~90·Y −2~8 상자: belowPlate + maxX → 하드", mixedV.belowPlate && mixedV.maxX && hardFn(mixedV), true);
  want("X 80~90 상자: 하드", hardFn(checkPrintableArea(trisAabb(OUT_X()), AREA, HEIGHT_MM)), true);
  return fails;
}

function sectionPure() {
  console.log("\n(a) 순수 판정 isTask0HardViolation — 플레이트 아래만 하드 아님, 가로·세로·높이·서포트는 하드");
  console.log(`    영역(world) ${JSON.stringify(AREA)} · 높이 ${HEIGHT_MM} mm`);
  const f = pureFails(isTask0HardViolation);
  assert(f.length === 0, `판정 단언 전부 (어긋남 ${f.length}건${f.length ? ": " + f.join(" / ") : ""})`);
}

// ── (a2) 화면 관문 동작 ─────────────────────────────────────────────────

const GATE_START = "const alertIfOutOfTask0Area = useCallback(";
const GATE_END = "}, [volumeIssues]);";

/** 훅 소스에서 관문 블록(선언 ~ deps 포함) — 없으면 null */
function gateBlock(hookSrc) {
  const at = hookSrc.indexOf(GATE_START);
  if (at < 0) return null;
  const end = hookSrc.indexOf(GATE_END, at);
  if (end < 0) return null;
  return hookSrc.slice(at, end + GATE_END.length);
}

/**
 * 관문 함수를 소스에서 잘라 실행 가능하게 — 타입 표기 `(): boolean =>` 만 벗긴다(본문은 순수 JS).
 * 반환: run(volumeIssues, confirmAnswer) → { blocked, alerts, confirms }
 */
function gateFromSource(hookSrc, hardFn) {
  const block = gateBlock(hookSrc);
  if (block === null) throw new Error("관문 블록을 못 찾음");
  const fnSrc = block.slice(GATE_START.length, block.length - GATE_END.length + 1); // "(): boolean => { … }"
  const js = fnSrc.replace(/^\(\): boolean =>/, "() =>");
  if (js === fnSrc) throw new Error("타입 표기 (): boolean 을 못 찾음");
  const factory = new Function("volumeIssues", "NL", "isTask0HardViolation", "window", `"use strict"; return (${js});`);
  return (issues, answer) => {
    const alerts = [];
    const confirms = [];
    const win = {
      alert: (m) => {
        alerts.push(String(m));
      },
      confirm: (m) => {
        confirms.push(String(m));
        return answer;
      },
    };
    const blocked = factory(issues, "\n", hardFn, win)();
    return { blocked, alerts, confirms };
  };
}

/** BuildVolumeIssue 꼴 (useBuildVolumeCheck collectPrintableAreaIssues 와 같은 필드) */
const sunkIssue = (name, depth) => ({
  stlId: `id-${name}`,
  fileName: name,
  message: "모델이 플레이트 아래로 내려감",
  violation: V({ belowPlate: true }),
  sinkDepthMm: depth,
  kind: "model",
});
const hardIssue = (name, v, depth = 0) => ({
  stlId: `id-${name}`,
  fileName: name,
  message: "출력 가능 영역을 벗어남 (X 방향)",
  violation: V(v),
  sinkDepthMm: depth,
  kind: "model",
});
const supportIssue = (name) => ({
  stlId: `id-${name}#supports`,
  fileName: `${name} 서포트`,
  message: "서포트 3개 — 출력 가능 영역을 벗어남 (Y 방향)",
  violation: V({ maxZ: true }),
  sinkDepthMm: 0,
  kind: "support",
});

/** 관문 동작 단언 — run 을 주입받는다(대조군이 변조 소스·변조 판정으로 만든 run 을 넣는다). 어긋난 항목 목록 */
function gateFails(run) {
  const fails = [];
  const check = (label, cond) => {
    if (!cond) fails.push(label);
  };
  try {
    const e0 = run([], true);
    const e1 = run(undefined, true);
    check("빈 목록 → 통과·대화상자 없음", !e0.blocked && !e1.blocked && e0.alerts.length + e0.confirms.length + e1.alerts.length + e1.confirms.length === 0);

    const okRun = run([sunkIssue("bridge.stl", 2)], true);
    check("파묻힘만 + 확인 → 통과", okRun.blocked === false);
    check("파묻힘만 → confirm 1 · alert 0", okRun.confirms.length === 1 && okRun.alerts.length === 0);
    const cm = okRun.confirms[0] ?? "";
    check(
      "파묻힘 확인 문구 (건수·이름·깊이·잘린 채 출력·올리기 안내·계속?)",
      cm.includes("플레이트 아래로 파고든 모델이 1개") && cm.includes("· bridge.stl — 플레이트 아래 2.00 mm") &&
        cm.includes("잘린 채 출력됩니다") && cm.includes("플레이트 위로 올리기") && cm.endsWith("계속 내보낼까요?"),
    );
    const noRun = run([sunkIssue("bridge.stl", 2)], false);
    check("파묻힘만 + 취소 → 막음", noRun.blocked === true && noRun.confirms.length === 1 && noRun.alerts.length === 0);

    const mixed = run([sunkIssue("A.stl", 1.5), hardIssue("B.stl", { maxX: true }), supportIssue("C.stl")], true);
    const am = mixed.alerts[0] ?? "";
    check("섞임 → 막음 · alert 1 · confirm 0", mixed.blocked === true && mixed.alerts.length === 1 && mixed.confirms.length === 0);
    check(
      "섞임 알림에 하드 항목만 (B·C 서포트, A 없음, 2건)",
      am.includes("2건") && am.includes("· B.stl —") && am.includes("· C.stl 서포트 —") && !am.includes("A.stl") && am.includes("내보낼 수 없습니다"),
    );

    const both = run([hardIssue("D.stl", { belowPlate: true, minX: true }, 1)], true);
    check("파묻힘 + X 밖 한 모델 → alert 로 막음", both.blocked === true && both.alerts.length === 1 && both.confirms.length === 0);

    const many = run(["a", "b", "c", "d", "e"].map((n) => sunkIssue(`${n}.stl`, 0.5)), true);
    const mm = many.confirms[0] ?? "";
    check(
      "파묻힘 5개 → '5개'·이름 3개·'외 2개'",
      !many.blocked && mm.includes("모델이 5개") && mm.includes("· c.stl —") && !mm.includes("· d.stl") && mm.includes("· 외 2개"),
    );
  } catch (e) {
    fails.push(`실행 오류: ${e instanceof Error ? e.message : String(e)}`);
  }
  return fails;
}

function sectionGate(hook) {
  console.log("\n(a2) 화면 관문 동작 — useSliceExport alertIfOutOfTask0Area 본문을 가짜 window 로 실행");
  const f = gateFails(gateFromSource(hook, isTask0HardViolation));
  assert(f.length === 0, `관문 동작 단언 전부 (어긋남 ${f.length}건${f.length ? ": " + f.join(" / ") : ""})`);
}

// ── (b)(c) 코어 ──────────────────────────────────────────────────────────

async function runJob(meshes) {
  return runTask0JobZipExport({
    meshes,
    topY: meshesTopY(meshes),
    layerHeightMm: LH,
    ...APP,
    generator: TASK0_APP_JOB_GENERATOR,
  });
}

/** zip 의 층 n PNG 흰 픽셀(255) 수 */
async function layerWhite(zip, n) {
  const entries = new Map((await readTask0ZipEntries(zip)).map((e) => [e.name, e.data]));
  const img = await decodeTask0GrayPng(entries.get(task0LayerPngName(n)));
  let white = 0;
  for (const v of img.data) if (v === 255) white++;
  return white;
}

async function sectionCore() {
  console.log("\n(b) 코어 — 플레이트 아래로 파고든 모델(10 mm 상자 Y −2~8)로 정상 job.zip (플레이트 아래 부분은 잘린 채)");
  const sunk = await runJob(SUNK());
  assert(sunk.ok, `파묻힌 상자: 통과 (막힘 이유 ${sunk.ok ? "없음" : JSON.stringify(sunk.issues)})`);
  const flat = await runJob(FLAT());
  assert(flat.ok, `비교군 Y 0~10 상자: 통과 (막힘 이유 ${flat.ok ? "없음" : JSON.stringify(flat.issues)})`);
  if (sunk.ok && flat.ok) {
    const wantLayers = task0LayerCount(8, LH);
    assert(
      wantLayers === 80 && sunk.summary.layerCount === wantLayers && sunk.job.pngCount === wantLayers,
      `파묻힌 상자 층 수 ${sunk.summary.layerCount} = PNG ${sunk.job.pngCount} = task0LayerCount(8, ${LH}) ${wantLayers}`,
    );
    assert(
      sunk.summary.emptyLayerCount === 0 && sunk.job.emptyMaskLayerCount === 0 && sunk.job.clippedPixels === 0,
      `빈 층 0 (G-code ${sunk.summary.emptyLayerCount} · 마스크 ${sunk.job.emptyMaskLayerCount}) · 투사 밖 잘림 ${sunk.job.clippedPixels}`,
    );
    const pitchMm = APP.frame.pixelPitchUm / 1000;
    const expectWhite = (10 / pitchMm) ** 2;
    const w0 = await layerWhite(sunk.zip, 0);
    assert(
      Math.abs(w0 - expectWhite) <= expectWhite * 0.02,
      `층 0 흰 픽셀 ${w0} ≈ 10×10 mm / (${pitchMm} mm)² = ${expectWhite.toFixed(0)} (±2 %, 차 ${(((w0 - expectWhite) / expectWhite) * 100).toFixed(2)} %)`,
    );
    const wFlat0 = await layerWhite(flat.zip, 0);
    assert(
      flat.summary.layerCount === task0LayerCount(10, LH) && flat.summary.layerCount === 100 && wFlat0 === w0,
      `비교군 Y 0~10: ${flat.summary.layerCount}층, 층 0 흰 픽셀 ${wFlat0} = 파묻힌 상자 층 0 — 같은 단면에서 시작, ` +
        `차이 ${flat.summary.layerCount - sunk.summary.layerCount}층(= 2 mm / ${LH}) 이 플레이트 아래로 잘림`,
    );
  }

  console.log("\n(c) 하드 위반은 코어가 여전히 막는다 (XY 영역 검사 — 코어 무변경)");
  for (const [label, meshes] of [
    ["X 80~90 상자(베드 X 155~165)", OUT_X()],
    ["X 80~90 + Y −2~8 상자(파묻힘 + X 밖)", SUNK_OUT_X()],
  ]) {
    const r = await runJob(meshes);
    assert(
      !r.ok && r.zip === null && r.issues.some((s) => s.includes("출력 가능 영역(") && s.includes("밖에 모델·서포트가 있습니다")),
      `${label}: 막힘 — ${r.ok ? "(통과해 버림)" : r.issues[0].slice(0, 70)}…`,
    );
  }
}

// ── (d) 소스 형태 ────────────────────────────────────────────────────────

/** 훅·페이지 소스 형태 — 어긋난 항목 목록 (대조군 M2·M3·M5·M7 이 변조 소스로 같은 함수를 부른다) */
function sourceFails(hook, page) {
  const fails = [];
  const check = (label, cond) => {
    if (!cond) fails.push(label);
  };
  // 훅 — 관문
  const block = gateBlock(hook);
  check("관문 블록(alertIfOutOfTask0Area = useCallback(… , [volumeIssues]))", block !== null);
  if (block !== null) {
    const inner = block.slice(0, -GATE_END.length);
    check("관문 안에 다른 deps 배열 없음(deps = [volumeIssues] 하나)", !/\n\s*\}, \[/.test(inner));
    check("hard = volumeIssues.filter(… isTask0HardViolation(it.violation))", /const hard = volumeIssues\.filter\(\(it\) => isTask0HardViolation\(it\.violation\)\);/.test(inner));
    const iIf = inner.indexOf("if (hard.length > 0) {");
    const iAlert = inner.indexOf("window.alert(");
    const iRetTrue = inner.indexOf("return true;");
    const iConfirm = inner.indexOf("window.confirm(");
    check(
      "hard 분기 안에서 window.alert → return true, 그 뒤 window.confirm",
      iIf > 0 && iAlert > iIf && iRetTrue > iAlert && iConfirm > iRetTrue,
    );
    check("alert·confirm 각 1곳", (inner.match(/window\.alert\(/g) ?? []).length === 1 && (inner.match(/window\.confirm\(/g) ?? []).length === 1);
    check("const ok = window.confirm(…) · return !ok", /const ok = window\.confirm\(/.test(inner) && /return !ok;/.test(inner));
    check("파묻힘 목록 = sinkDepthMm > 0", /const sunk = volumeIssues\.filter\(\(it\) => it\.sinkDepthMm > 0\);/.test(inner));
  }
  check(
    "훅 import isTask0HardViolation (utils/build-volume)",
    /import \{ isTask0HardViolation \} from "\.\.\/\.\.\/\.\.\/utils\/build-volume";/.test(hook),
  );
  // 훅 — 두 Task0 핸들러 (호출 모양·deps 그대로, P-1 confirm 안 부름)
  const iJob = hook.indexOf("const handleExportTask0JobZip");
  const iG = hook.indexOf("const handleExportTask0Gcode");
  const job = hook.slice(iJob, iG);
  const gc = hook.slice(iG, hook.lastIndexOf("return {"));
  const gated = (b) =>
    /if \(alertIfOutOfTask0Area\(\)\) return;/.test(b) && !/confirmIfOutOfBounds/.test(b) && /\n\s*alertIfOutOfTask0Area, \/\/ /.test(b);
  check("handleExportTask0JobZip: if (alertIfOutOfTask0Area()) return; · P-1 안 부름 · deps", iJob > 0 && iG > iJob && gated(job));
  check("handleExportTask0Gcode: if (alertIfOutOfTask0Area()) return; · P-1 안 부름 · deps", iG > 0 && gated(gc));
  // 훅 — 기존 프로파일 P-1 무변경
  const ca = hook.indexOf("const confirmIfOutOfBounds = useCallback(");
  const cMark = "}, [volumeIssues, printerProfile]);";
  const ce = hook.indexOf(cMark, ca);
  const cBlock = ca >= 0 && ce > ca ? hook.slice(ca, ce + cMark.length) : "";
  check(`confirmIfOutOfBounds 블록 sha256 = a02d43a 값 (${sha256(cBlock).slice(0, 12)}…)`, sha256(cBlock) === CONFIRM_BLOCK_SHA);
  check(
    "기존 프로파일 확인 문구 두 줄",
    hook.includes("`⚠️ 출력영역을 벗어난 모델이 ${volumeIssues.length}개 있습니다.${NL}` +") &&
      hook.includes("`이대로 내보내면 벗어난 부분이 잘려 나갑니다.${NL}${NL}`"),
  );

  // 페이지
  check("페이지 import isTask0HardViolation", /import \{ isTask0HardViolation \} from "\.\.\/utils\/build-volume";/.test(page));
  check(
    "task0HardIssue = volumeIssues.some(… isTask0HardViolation(it.violation)) (훅 아님)",
    /\n {2}const task0HardIssue = volumeIssues\.some\(\(it\) =>\s*isTask0HardViolation\(it\.violation\),?\s*\);/.test(page),
  );
  check(
    "Task0 배너: task0HardIssue ? 기존 차단 문구 : '… 잘린 채 출력됩니다' → 기존 프로파일 문구",
    /isTask0Profile\(printerProfile\) \? \(\s*task0HardIssue \? \(\s*<>\s*⚠ Task0 출력 가능 영역을 벗어난 항목\(모델·서포트\)[\s\S]*?이대로는 내보낼 수 없습니다\. 영역\s+안으로 옮기세요\.\s*<\/>\s*\) : \(\s*<>\s*⚠ 플레이트 아래로 파고든 모델 \{volumeIssues\.length\}개 — 이대로\s+내보내면 플레이트 아래 부분은 잘린 채 출력됩니다\(일부러 자르는\s+경우라면 그대로 진행\)\.\s*<\/>\s*\)\s*\) : \(\s*<>\s*⚠ 출력영역을 벗어난 모델 \{volumeIssues\.length\}개 — 이대로\s+출력하면 잘려 나갑니다\./.test(
      page,
    ),
  );
  check(
    "'플레이트 위로 올리기' 버튼 그대로 (sinkDepthMm > 0 → handleDropToPlate)",
    /\{volumeIssues\.some\(\(it\) => it\.sinkDepthMm > 0\) && \(\s*<button\s+onClick=\{handleDropToPlate\}/.test(page),
  );
  return fails;
}

function sectionSource(hook, page) {
  console.log("\n(d) 소스 형태 — 훅 관문·두 Task0 핸들러·P-1 무변경 / 페이지 배너 두 갈래");
  const f = sourceFails(hook, page);
  assert(f.length === 0, `소스 형태 단언 전부 (어긋남 ${f.length}건${f.length ? ": " + f.join(" / ") : ""})`);
}

// ── (e) 대조군 ───────────────────────────────────────────────────────────

/** a02d43a 의 관문(옛 구현 — 위반이 있으면 항상 alert 로 막음). M2 가 현재 관문 블록을 이것으로 바꾼다 */
const OLD_GATE = [
  "const alertIfOutOfTask0Area = useCallback((): boolean => {",
  "    if (!volumeIssues || volumeIssues.length === 0) return false;",
  "    const names = volumeIssues",
  "      .slice(0, 3)",
  "      .map((it) => `· ${it.fileName} — ${it.message}`)",
  "      .join(NL);",
  "    const more =",
  '      volumeIssues.length > 3 ? `${NL}· 외 ${volumeIssues.length - 3}개` : "";',
  "    window.alert(",
  "      `⚠️ Task0 출력 가능 영역을 벗어난 항목(모델·서포트)이 ${volumeIssues.length}건 있어 내보낼 수 없습니다.${NL}` +",
  "        `영역 안으로 옮긴 뒤 다시 내보내세요(투사 밖은 노광되지 않고, 노즐 범위 밖 이동은 Task0 가 거부합니다).${NL}${NL}` +",
  "        `${names}${more}`,",
  "    );",
  "    return true;",
  "  }, [volumeIssues]);",
].join("\n");

/** 문자열 변조 — 대상이 없으면(변조가 아무것도 안 바꾸면) 대조군이 무의미하므로 throw. to 의 `$` 는 글자 그대로(함수 치환) */
function mutate(tag, src, from, to) {
  const out = src.replace(from, () => to);
  if (out === src) throw new Error(`변조 대상이 소스에 없음 (${tag})`);
  return out;
}

function sectionMutants(hook, page) {
  console.log("\n(e) 대조군 — 메모리 변조가 위 검사에서 실제로 실패하는가 (전부 '실패함' 이어야 정상)");
  const gateOk = (h, hardFn = isTask0HardViolation) => {
    try {
      return gateFails(gateFromSource(h, hardFn)).length === 0;
    } catch {
      return false;
    }
  };

  // M1 판정을 hasViolation(belowPlate 포함)으로
  const m1Pure = pureFails(hasViolation);
  const m1Gate = gateOk(hook, hasViolation);
  assert(m1Pure.length > 0 && !m1Gate, `M1 isTask0HardViolation → hasViolation: (a) 어긋남 ${m1Pure.length}건 · (a2) ${m1Gate ? "놓침" : "실패함"}`);

  // M2 관문을 옛 구현(항상 alert)으로
  const block = gateBlock(hook);
  const m2 = block === null ? hook : mutate("M2", hook, block, OLD_GATE);
  const m2Src = sourceFails(m2, page);
  const m2Gate = gateOk(m2);
  assert(block !== null && m2Src.length > 0 && !m2Gate, `M2 관문 = 옛 구현(window.confirm 분기 없음): (d) 어긋남 ${m2Src.length}건 · (a2) ${m2Gate ? "놓침" : "실패함"}`);

  // M3 hard = 전부
  const m3 = mutate("M3", hook, "volumeIssues.filter((it) => isTask0HardViolation(it.violation))", "volumeIssues.filter(() => true)");
  const m3Src = sourceFails(m3, page);
  const m3Gate = gateOk(m3);
  assert(m3Src.length > 0 && !m3Gate, `M3 hard = volumeIssues.filter(() => true): (d) 어긋남 ${m3Src.length}건 · (a2) ${m3Gate ? "놓침" : "실패함"}`);

  // M4 — 생략 (코어 호출부 confirmIfOutOfBounds 변조는 verify-task0-export (5)·verify-task0-jobzip-export g2 가 잡는다)

  // M5 페이지 배너가 항상 차단 문구
  const m5 = mutate(
    "M5",
    page,
    /const task0HardIssue = volumeIssues\.some\(\(it\) =>\s*isTask0HardViolation\(it\.violation\),?\s*\);/,
    "const task0HardIssue = volumeIssues.length > 0;",
  );
  const m5Src = sourceFails(hook, m5);
  assert(m5Src.length > 0, `M5 페이지 task0HardIssue = volumeIssues.length > 0: (d) 어긋남 ${m5Src.length}건`);

  // M6 hard 분기 알림 목록을 volumeIssues 기준으로
  const m6 = mutate("M6", hook, "const names = hard\n", "const names = volumeIssues\n");
  const m6Gate = gateOk(m6);
  assert(!m6Gate, `M6 하드 알림 목록 = volumeIssues(섞이면 파묻힘 항목도 나열): (a2) ${m6Gate ? "놓침" : "실패함"}`);

  // M7 기존 프로파일 P-1 문구 변경
  const m7 = mutate("M7", hook, "이대로 내보내면 벗어난 부분이 잘려 나갑니다.", "이대로 내보내면 벗어난 부분이 잘린 채 출력됩니다.");
  const m7Src = sourceFails(m7, page);
  assert(m7Src.length > 0, `M7 confirmIfOutOfBounds 문구 변경: (d) 어긋남 ${m7Src.length}건`);
}

// ── main ────────────────────────────────────────────────────────────────

async function main() {
  console.log("Task0 플레이트 아래 파고든 모델 — 확인 후 허용 (Z3-b)");
  const hook = read("pages", "viewer", "hooks", "useSliceExport.ts");
  const page = read("pages", "ViewerV2Page.tsx");
  sectionPure();
  sectionGate(hook);
  await sectionCore();
  sectionSource(hook, page);
  sectionMutants(hook, page);
  console.log(failed ? `\n${failed}건 FAIL` : "\n전부 통과");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
