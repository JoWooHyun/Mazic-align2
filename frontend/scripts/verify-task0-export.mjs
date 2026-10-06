// Task0 앱 내보내기(Z2) 헤드리스 검증 — 프로파일 · 출력 가능 영역 · 워커 코어(앱 경로 = 스크립트 경로) · 막힘 경로.
//
//   무엇을: Z2 에서 앱에 붙인 Task0 경로.
//     src/features/v2/utils/task0/task0-profile.ts (빌트인 Task0 프로파일·판정·프로파일 → Task0 값)
//     src/features/v2/utils/task0/task0-export.ts  (워커가 부르는 순수 코어 runTask0GcodeExport)
//     src/features/v2/utils/task0/task0-frame.ts   (task0PrintableWorldRect — 베드 → world 출력 가능 영역)
//     src/features/v2/utils/build-volume.ts        (checkPrintableArea · checkItemsInPrintableArea — 모델 + 서포트)
//     src/features/v2/hooks/usePrinterProfileStore.ts (빌트인 목록·새 설치 기본 선택·저장값 하위 호환)
//     + 배선(소스 검사): 워커·서비스·useSliceExport·SliceSidePanel·ViewerV2Page·BabylonScene 훅 순서.
//   규격 = Task0 리포 docs/Task0_Gcode_규격서_초안.md v0.3.3 @ dfdf08c §1(베드 150×85, 출력 가능 영역 X 10~150 × Y 10~85,
//   투사 (10,10)·73 µm·1920×1080, Z 0~2000)·§8(F 한계)·§12(파서). 설계 = docs/계획_Z1_task0출력_20261002.md §4·§4-2.
//
//   (1) 프로파일 — 빌트인 Task0 필드(outputKind 'task0', 1920×1080, 73 µm, 150×85×2000), 값이 TASK0_DEFAULTS 와 같음
//       (단일 소스), 선택 필드 폴백 = TASK0_DEFAULTS·선택 필드가 있으면 그 값, 기존 빌트인 3종 값 그대로·0번(폴백) 그대로,
//       Task0 는 맨 뒤, PROFILE_FIELD_LIMITS 안(높이는 buildHeightMm), 기존 프로파일·outputKind 없는 저장값은 Task0 아님.
//       스토어: 새 설치(저장값 없음) 기본 = Task0, 저장값이 있으면(기존 사용자) currentId·사용자 프로파일 그대로.
//   (2) 출력 가능 영역 — world X −65~75 × Z −32.5~42.5(bedToWorld 로 계산), 모델 안/밖/걸침/경계 딱 맞음,
//       서포트만 밖(모델 안) → 서포트 묶음 위반, 같은 모델 서포트 둘 → 1건(count 2·합집합), 붙은 모델 없는 서포트,
//       서포트 바닥 Y 잡음은 위반 아님, 모델 플레이트 아래·높이 초과, 기존 대칭 검사(checkBuildVolume) 문구 그대로.
//   (3) 앱 경로 = 스크립트 경로 — 워커 코어 runTask0GcodeExport 를 gen-task0-dryrun.mjs 와 같은 입력(파일 A·C·B,
//       lh 0.1, 빌트인 Task0 프로파일의 writer 옵션)으로 → generateTask0Gcode 직접 호출과 같은 문자열 + sha256 고정값
//       (A 22415b46… / C 3975b066… / B a62e93fa…), 파서 3모드 경고·오류 0, 요약(층 수·빈 층·채움 층·estimate),
//       층 진행 콜백(1..n 차례, 바이트 무영향).
//   (3b) 실제 워커 모듈 — slice-batch.worker.ts 를 가짜 self 로 Node 에서 불러 task0-gcode 메시지를 넣으면
//       progress(스로틀, 마지막 = 전체 층) + task0-done 1건, gcode sha256 = 위 고정값, 막힘은 error 가 아닌 task0-done.
//   (4) 막힘 경로 — ① 채움 실패: 같은 평면 면을 가진 겹친 상자들을 **한 메시**로 묶은 나선 벽(lh 0.1)에서 층 9 가
//       thinFill 'failed' → gcode null + 이유에 층 번호·Z·문구 ② 파서 경고: 규격 §8 한계를 넘는 속도(트래블 150 mm/s
//       → F9000) → Task0 파서 print 모드 "F 클램프" 경고 → gcode null + 이유 ③ 층 없음(topY 0) → 이유.
//   (5) 배선 — 워커 runTask0Gcode 가 코어를 그대로 부름, 서비스 exportTask0Gcode, useSliceExport(deps 에 printerProfile·
//       층두께 — 규칙 7, octet-stream, `_task0_` 파일 이름, handleExportStl 뒤), confirm 문구(기존 그대로 + Task0),
//       SliceSidePanel(Task0 일 때만 Task0 버튼, 마스크 ZIP 은 Task0 아닌 쪽), ViewerV2Page 배선, BabylonScene 훅 호출
//       목록 불변(불변식 1 — 영역 테두리 훅은 useBuildVolumeCheck 안 끝에서 부름).
//   (6) 대조군 — 이 스크립트가 실제로 결함을 잡는지:
//       a. 경계를 대칭(플레이트 ±W/2·±D/2)으로 바꾸면 "베드 X 5~15 모델" 사례를 놓친다(= (2) 의 그 단언이 실패).
//       b. 서포트를 빼고 검사하면 "서포트만 밖" 사례를 놓친다.
//       c. 코어에서 파서 검사를 빼면(소스 변조 → 임시 폴더) 속도 위반 입력이 **파일로 나와 버린다**.
//       d. 코어에서 채움 실패 확인을 빼면 나선 벽이 파일로 나와 버린다.
//       e. writer 옵션의 베드 크기를 Mars 3 Pro 플레이트로 바꾸면 sha256 이 달라진다(= (3) 의 바이트 비교가 민감함).
//       f. deps 검사 함수에 printerProfile 을 뺀 소스를 넣으면 실패한다.
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "변조"·"놓침" 문자열을 출력한다.
//   실행: npx tsx scripts/verify-task0-export.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { normalizeTriangleWinding } from "../src/features/v2/utils/slice-geometry.ts";
import {
  checkBuildVolume,
  checkItemsInPrintableArea,
  checkPrintableArea,
  describeViolation,
  hasViolation,
} from "../src/features/v2/utils/build-volume.ts";
import { PROFILE_FIELD_LIMITS } from "../src/features/v2/types/printer.ts";
import { TASK0_DEFAULTS, bedToWorld, task0PrintableWorldRect } from "../src/features/v2/utils/task0/task0-frame.ts";
import { generateTask0Gcode } from "../src/features/v2/utils/task0/task0-gcode-writer.ts";
import { runTask0GcodeExport } from "../src/features/v2/utils/task0/task0-export.ts";
import {
  TASK0_BUILT_IN_PROFILE,
  TASK0_PROFILE_ID,
  isTask0Profile,
  resolveTask0ProfileFrame,
  task0PrintableAreaForProfile,
  task0WriterOptionsForProfile,
} from "../src/features/v2/utils/task0/task0-profile.ts";
import {
  boxTriangles,
  concatTris,
  fixtureCube10,
  fixtureFileB,
  fixtureGapPlates,
  meshesTopY,
} from "./verify-task0-writer.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const V2 = path.resolve(SCRIPT_DIR, "..", "src", "features", "v2");
const TASK0_SRC = path.join(V2, "utils", "task0");

/** gen-task0-dryrun.mjs 가 쓰는 파일 A·C·B 의 sha256 (Z1-a2·Z1-b2 검수 고정값) */
const EXPECTED_SHA = {
  cube10: "22415b46a3e974f20252e747aa036038c8dce09b1ea06065857526682f99218c",
  "gap-plates": "3975b066d6f7eb387911e475c234c12ae8ff3804f93c941d6edde6dfa5cd5f53",
  "file-b": "a62e93fa0c041ebf305f1383a6eb40a8dac59571eb5352184cb3b317674e7ee1",
};

/** 기존 빌트인 3종 — Z2 전(788c255) 값 그대로여야 한다 */
const LEGACY_BUILT_INS = [
  { id: "elegoo-mars-3-pro", name: "ELEGOO Mars 3 Pro", lcdWidthPx: 4098, lcdHeightPx: 2560, pixelPitchUm: 35.0, buildVolumeMm: [143.43, 89.6, 175.0] },
  { id: "elegoo-saturn-2", name: "ELEGOO Saturn 2", lcdWidthPx: 7680, lcdHeightPx: 4320, pixelPitchUm: 28.5, buildVolumeMm: [218.88, 123.12, 250.0] },
  { id: "phrozen-sonic-mighty-8k", name: "Phrozen Sonic Mighty 8K", lcdWidthPx: 7680, lcdHeightPx: 4320, pixelPitchUm: 28.0, buildVolumeMm: [218.88, 123.0, 235.0] },
];

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

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

/** world AABB — 중심 (cx, cz), 크기 w × d, Y 범위 y0~y1 */
function aabb(cx, cz, w, d, y0 = 0, y1 = 10) {
  return { minX: cx - w / 2, maxX: cx + w / 2, minY: y0, maxY: y1, minZ: cz - d / 2, maxZ: cz + d / 2 };
}
/** world AABB — 모서리로 */
function aabbXZ(minX, maxX, minZ, maxZ, minY = 0, maxY = 10) {
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

// ── (1) 프로파일 ─────────────────────────────────────────────────────────

async function sectionProfile() {
  console.log("\n(1) 프로파일 — 빌트인 Task0 · 단일 소스 · 하위 호환");
  const P = TASK0_BUILT_IN_PROFILE;
  const D = TASK0_DEFAULTS;
  assert(P.id === TASK0_PROFILE_ID && P.outputKind === "task0", `빌트인 Task0 id ${P.id}, outputKind ${P.outputKind}`);
  assert(
    P.lcdWidthPx === 1920 && P.lcdHeightPx === 1080 && P.pixelPitchUm === 73,
    `투사 ${P.lcdWidthPx}×${P.lcdHeightPx} px · ${P.pixelPitchUm} µm (규격 §1)`,
  );
  assert(
    JSON.stringify(P.buildVolumeMm) === "[150,85,2000]",
    `빌드 볼륨 ${JSON.stringify(P.buildVolumeMm)} = 베드 150×85 · Z 이송 2000 (규격 §1)`,
  );
  assert(
    P.lcdWidthPx === D.projectorWidthPx &&
      P.lcdHeightPx === D.projectorHeightPx &&
      P.pixelPitchUm === D.pixelPitchUm &&
      P.buildVolumeMm[0] === D.bedWidthMm &&
      P.buildVolumeMm[1] === D.bedDepthMm &&
      P.buildVolumeMm[2] === D.zTravelMaxMm,
    "빌트인 값 = TASK0_DEFAULTS (규칙 6 — 단일 소스)",
  );
  assert(P.task0 === undefined, "빌트인은 Task0 선택 필드를 두지 않는다 — 전부 TASK0_DEFAULTS 폴백");
  const f = resolveTask0ProfileFrame(P);
  const keys = [
    "projectorOffsetXMm",
    "projectorOffsetYMm",
    "printableXMinMm",
    "printableXMaxMm",
    "printableYMinMm",
    "printableYMaxMm",
    "projectorHeightPx",
    "pixelPitchUm",
  ];
  assert(
    keys.every((k) => f[k] === D[k]) &&
      f.bedWidthMm === D.bedWidthMm &&
      f.bedDepthMm === D.bedDepthMm &&
      f.projectorWidthPx === D.projectorWidthPx,
    `폴백 = TASK0_DEFAULTS (${keys.map((k) => `${k} ${f[k]}`).join(", ")})`,
  );
  const custom = { ...P, id: "x", task0: { printableXMinMm: 12, projectorOffsetYMm: 11 } };
  const fc = resolveTask0ProfileFrame(custom);
  assert(
    fc.printableXMinMm === 12 && fc.projectorOffsetYMm === 11 && fc.printableXMaxMm === D.printableXMaxMm,
    "선택 필드가 있으면 그 값, 빠진 것만 폴백",
  );
  const wo = task0WriterOptionsForProfile(P);
  assert(
    JSON.stringify(wo) === JSON.stringify({ bedWidthMm: 150, bedDepthMm: 85 }),
    `writer 옵션 = 베드 크기만 ${JSON.stringify(wo)} (나머지는 writer 의 TASK0_DEFAULTS)`,
  );

  // 한계 — 빌트인 Task0 값이 다이얼로그 입력 한계 안 (높이는 따로)
  const L = PROFILE_FIELD_LIMITS;
  const inR = (v, l) => v >= l.min && v <= l.max;
  assert(
    inR(P.lcdWidthPx, L.lcdPx) &&
      inR(P.lcdHeightPx, L.lcdPx) &&
      inR(P.pixelPitchUm, L.pixelPitchUm) &&
      inR(P.buildVolumeMm[0], L.buildVolumeMm) &&
      inR(P.buildVolumeMm[1], L.buildVolumeMm) &&
      inR(P.buildVolumeMm[2], L.buildHeightMm),
    `Task0 값이 PROFILE_FIELD_LIMITS 안 (높이 ${P.buildVolumeMm[2]} ≤ buildHeightMm.max ${L.buildHeightMm?.max})`,
  );
  assert(L.buildVolumeMm.max === 1000 && L.buildVolumeMm.min === 1, "가로·세로 한계는 종전 그대로 (1~1000 mm)");

  // 스토어 — 가짜 localStorage 를 깐 뒤 동적 import (zustand persist 가 생성 시점에 storage 를 잡는다)
  const mem = new Map();
  const prevLs = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => void mem.set(k, String(v)),
    removeItem: (k) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
  try {
    const S = await import(pathToFileURL(path.join(V2, "hooks", "usePrinterProfileStore.ts")).href);
    const ids = S.BUILT_IN_PROFILES.map((p) => p.id);
    assert(
      JSON.stringify(S.BUILT_IN_PROFILES.slice(0, 3)) === JSON.stringify(LEGACY_BUILT_INS),
      "기존 빌트인 3종 값·순서 그대로 (Z2 전과 같음)",
    );
    assert(
      ids[0] === "elegoo-mars-3-pro" && ids.at(-1) === TASK0_PROFILE_ID && ids.length === 4,
      `Task0 는 맨 뒤 — 0번(폴백)은 Mars 3 Pro 그대로 (${ids.join(", ")})`,
    );
    assert(S.BUILT_IN_PROFILES.at(-1) === TASK0_BUILT_IN_PROFILE, "빌트인 목록의 Task0 = task0-profile 의 같은 객체");
    assert(
      LEGACY_BUILT_INS.every((p) => !isTask0Profile(p) && task0PrintableAreaForProfile(p) === null),
      "기존 빌트인은 Task0 아님 · 출력 가능 영역 null (기존 대칭 검사 그대로)",
    );
    const st = S.usePrinterProfileStore;
    assert(st.getState().currentId === TASK0_PROFILE_ID, `새 설치(저장값 없음) 기본 선택 = ${st.getState().currentId}`);
    const userP = { id: "user-1", name: "내 프린터", lcdWidthPx: 4098, lcdHeightPx: 2560, pixelPitchUm: 35, buildVolumeMm: [143.43, 89.6, 175] };
    mem.set(S.usePrinterProfileStore.persist.getOptions().name, JSON.stringify({ state: { userProfiles: [userP], currentId: "elegoo-mars-3-pro" }, version: 0 }));
    await st.persist.rehydrate();
    assert(
      st.getState().currentId === "elegoo-mars-3-pro" && st.getState().userProfiles.length === 1,
      `기존 사용자(저장값 Mars) — 선택 유지 ${st.getState().currentId}, 사용자 프로파일 ${st.getState().userProfiles.length}개`,
    );
    mem.set(S.usePrinterProfileStore.persist.getOptions().name, JSON.stringify({ state: { userProfiles: [userP], currentId: "user-1" }, version: 0 }));
    await st.persist.rehydrate();
    const cur = st.getState().userProfiles.find((p) => p.id === st.getState().currentId);
    assert(
      st.getState().currentId === "user-1" && cur !== undefined && !isTask0Profile(cur),
      "기존 사용자(저장값 사용자 프로파일) — 선택 유지, outputKind 없는 저장 프로파일은 Task0 아님",
    );
  } finally {
    if (prevLs === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = prevLs;
  }
}

// ── (2) 출력 가능 영역 ───────────────────────────────────────────────────

/** (2)·(6) 이 함께 쓰는 사례 — area 를 바꿔 같은 단언을 돌릴 수 있게 */
function areaCases(area, { withSupports = true } = {}) {
  const H = TASK0_DEFAULTS.zTravelMaxMm;
  const sup = (list) => (withSupports ? list : []);
  const r = {};
  // a. 안 — 파일 A 자리(베드 (80, 47.5) = world (5, 5)) 10 mm 정육면체
  r.inside = checkItemsInPrintableArea([{ id: "m", aabb: aabb(5, 5, 10, 10) }], [], area, H);
  // b. 베드 X 5~15 (world −70~−60) — 플레이트(±75) 안이지만 투사 밖 → minX
  r.bedX5 = checkItemsInPrintableArea([{ id: "m", aabb: aabbXZ(-70, -60, 0, 10) }], [], area, H);
  // c. 걸침 — world Z 40~45 (베드 Y 82.5~87.5) → maxZ
  r.straddleZ = checkItemsInPrintableArea([{ id: "m", aabb: aabbXZ(0, 10, 40, 45) }], [], area, H);
  // d. 경계에 딱 맞음 — X 65~75, Z −32.5~−22.5 (베드 X 140~150, Y 10~20) → 위반 아님
  r.flush = checkItemsInPrintableArea([{ id: "m", aabb: aabbXZ(65, 75, -32.5, -22.5) }], [], area, H);
  // d2. 베드 Y 5~15 (world Z −37.5~−27.5) — 플레이트(±42.5) 안, 투사 밖 → minZ
  r.bedY5 = checkItemsInPrintableArea([{ id: "m", aabb: aabbXZ(0, 10, -37.5, -27.5) }], [], area, H);
  // e. 서포트만 밖 — 모델은 안, 서포트 하나 world X −68~−66
  r.supportOut = checkItemsInPrintableArea(
    [{ id: "m", aabb: aabb(-50, 0, 10, 10, 5, 15) }],
    sup([
      { parentId: "m", aabb: aabbXZ(-52, -50, -1, 1, 0, 5) },
      { parentId: "m", aabb: aabbXZ(-68, -66, -1, 1, 0, 5) },
    ]),
    area,
    H,
  );
  // f. 같은 모델 서포트 둘이 밖 + 붙은 모델 없는 서포트 하나 밖
  r.supportGroup = checkItemsInPrintableArea(
    [{ id: "m", aabb: aabb(0, 0, 10, 10, 5, 15) }],
    sup([
      { parentId: "m", aabb: aabbXZ(-69, -67, 0, 2, 0, 5) },
      { parentId: "m", aabb: aabbXZ(74, 76, 41, 43, 0, 5) },
      { parentId: null, aabb: aabbXZ(-80, -78, 0, 2, 0, 5) },
    ]),
    area,
    H,
  );
  // g. 서포트 바닥 Y 잡음(−1e-4) — XZ 는 안 → 위반 아님 / 모델이 플레이트 아래(−0.5)·높이 초과
  r.supportNoise = checkItemsInPrintableArea([], sup([{ parentId: "m", aabb: aabbXZ(0, 1, 0, 1, -1e-4, 5) }]), area, H);
  r.modelBelow = checkItemsInPrintableArea([{ id: "m", aabb: aabb(0, 0, 10, 10, -0.5, 9.5) }], [], area, H);
  r.modelTall = checkItemsInPrintableArea([{ id: "m", aabb: aabb(0, 0, 10, 10, 0, H + 1) }], [], area, H);
  return r;
}

/** (2) 의 사례별 판정 — 대조군이 같은 판정을 다시 쓴다 */
const AREA_EXPECT = {
  inside: (e) => e.length === 0,
  bedX5: (e) => e.length === 1 && e[0].kind === "model" && e[0].violation.minX && !e[0].violation.maxX,
  straddleZ: (e) => e.length === 1 && e[0].violation.maxZ && !e[0].violation.minZ,
  flush: (e) => e.length === 0,
  bedY5: (e) => e.length === 1 && e[0].violation.minZ,
  supportOut: (e) => e.length === 1 && e[0].kind === "support" && e[0].id === "m" && e[0].count === 1 && e[0].violation.minX,
  supportGroup: (e) =>
    e.length === 2 &&
    e[0].kind === "support" &&
    e[0].id === "m" &&
    e[0].count === 2 &&
    e[0].violation.minX &&
    e[0].violation.maxX &&
    e[0].violation.maxZ &&
    e[0].aabb.minX === -69 &&
    e[0].aabb.maxX === 76 &&
    e[1].kind === "support" &&
    e[1].id === null &&
    e[1].count === 1,
  supportNoise: (e) => e.length === 0,
  modelBelow: (e) => e.length === 1 && e[0].violation.belowPlate,
  modelTall: (e) => e.length === 1 && e[0].violation.aboveMax,
};

function sectionArea() {
  console.log("\n(2) 출력 가능 영역 — 비대칭 world 경계, 모델 + 서포트");
  const area = task0PrintableWorldRect();
  assert(
    area.minX === -65 && area.maxX === 75 && area.minZ === -32.5 && area.maxZ === 42.5,
    `world X ${area.minX}~${area.maxX} × Z ${area.minZ}~${area.maxZ} (베드 X 10~150 × Y 10~85)`,
  );
  const [bx0, bz0] = bedToWorld(TASK0_DEFAULTS.printableXMinMm, TASK0_DEFAULTS.printableYMinMm);
  assert(bx0 === area.minX && bz0 === area.minZ, "모서리 = task0-frame bedToWorld 결과 (상수 아님)");
  assert(
    JSON.stringify(task0PrintableAreaForProfile(TASK0_BUILT_IN_PROFILE)) === JSON.stringify(area),
    "빌트인 Task0 프로파일의 영역 = 같은 값",
  );
  assert(
    area.minX + area.maxX !== 0 && area.minZ + area.maxZ !== 0,
    "영역이 플레이트 중심(world 원점)에 대해 비대칭 (플레이트 원점 ≠ 영역 중심 (80, 47.5))",
  );

  const r = areaCases(area);
  const labels = {
    inside: "a. 안 — 파일 A 자리 10 mm 정육면체: 위반 0",
    bedX5: "b. 베드 X 5~15 모델(플레이트 안·투사 밖): minX 위반",
    straddleZ: "c. 걸침 — world Z 40~45: maxZ 위반",
    flush: "d. 경계 딱 맞음(베드 X 140~150 × Y 10~20): 위반 아님",
    bedY5: "d2. 베드 Y 5~15 모델: minZ 위반",
    supportOut: "e. 모델은 안, 서포트 하나만 밖: 서포트 묶음 1건(붙은 모델 m, count 1, minX)",
    supportGroup: "f. 같은 모델 서포트 둘 밖 → 1건(count 2·합집합·방향 OR) + 붙은 모델 없는 서포트 1건(id null)",
    supportNoise: "g. 서포트 바닥 Y −1e-4(XZ 안): 위반 아님 — 서포트는 X/Z 만",
    modelBelow: "h. 모델 플레이트 아래(−0.5): belowPlate",
    modelTall: "i. 모델 높이 > 2000: aboveMax",
  };
  for (const k of Object.keys(AREA_EXPECT)) assert(AREA_EXPECT[k](r[k]), `${labels[k]} — ${JSON.stringify(r[k].map((e) => [e.kind, e.id, e.count]))}`);

  // checkPrintableArea 단독 — 경계 eps
  const v = checkPrintableArea(aabbXZ(-65 - 5e-7, 75 + 5e-7, -32.5, 42.5), area, 2000);
  assert(!hasViolation(v), "경계 ±5e-7 (eps 1e-6 안) 은 위반 아님");
  const v2 = checkPrintableArea(aabbXZ(-65 - 1e-5, 75, -32.5, 42.5), area, 2000);
  assert(v2.minX && !v2.maxX, "경계 −1e-5 넘으면 minX 위반");
  // 문구 — 기존 기본값 그대로, Task0 이름표
  const bv = checkBuildVolume(aabbXZ(-80, -70, 0, 10), { widthMm: 150, depthMm: 85, heightMm: 2000 });
  assert(describeViolation(bv) === "출력영역을 벗어남 (X 방향)", `기존 문구 그대로: ${describeViolation(bv)}`);
  assert(
    describeViolation(r.bedX5[0].violation, "출력 가능 영역") === "출력 가능 영역을 벗어남 (X 방향)",
    `Task0 문구: ${describeViolation(r.bedX5[0].violation, "출력 가능 영역")}`,
  );
  return area;
}

// ── (3) 앱 경로 = 스크립트 경로 ─────────────────────────────────────────

function sectionSamePath() {
  console.log("\n(3) 앱 경로(워커 코어) = 스크립트 경로(gen-task0-dryrun) — 파일 A·C·B 같은 바이트");
  const writer = task0WriterOptionsForProfile(TASK0_BUILT_IN_PROFILE);
  const outputs = {};
  for (const fx of [fixtureCube10(), fixtureGapPlates(), fixtureFileB()]) {
    const meshes = fx.meshes();
    const topY = meshesTopY(meshes);
    const calls = [];
    const r = runTask0GcodeExport({ meshes, topY, layerHeightMm: 0.1, writer }, (d, t) => calls.push([d, t]));
    const direct = generateTask0Gcode(fx.meshes(), topY, 0.1);
    const hash = r.ok ? sha256(r.gcode) : "(막힘)";
    outputs[fx.name] = r;
    assert(r.ok, `${fx.name}: 통과 (막힘 이유 ${r.ok ? "없음" : JSON.stringify(r.issues)})`);
    assert(r.ok && r.gcode === direct.gcode, `${fx.name}: 코어 출력 = generateTask0Gcode 직접 호출 (gen-task0-dryrun 이 쓰는 것)`);
    assert(hash === EXPECTED_SHA[fx.name], `${fx.name}: sha256 ${hash.slice(0, 16)}… = 고정값 ${EXPECTED_SHA[fx.name].slice(0, 16)}…`);
    assert(
      r.parser.length === 3 && r.parser.every((p) => p.warnings.length === 0 && p.errors.length === 0 && p.layerCount === direct.totals.layerCount),
      `${fx.name}: 파서 3모드(${r.parser.map((p) => p.label).join(" · ")}) 경고·오류 0, 층 수 ${direct.totals.layerCount}`,
    );
    const n = direct.totals.layerCount;
    assert(
      calls.length === n && calls.every(([d, t], i) => d === i + 1 && t === n),
      `${fx.name}: 층 진행 콜백 ${calls.length}회 (1..${n} 차례, 전체 ${n})`,
    );
    const s = r.ok ? r.summary : null;
    assert(
      s !== null &&
        s.layerCount === n &&
        s.emptyLayerCount === direct.totals.emptyLayers.length &&
        s.thinFillLayerCount === direct.totals.thinFillLayers.length &&
        s.thinFillFailedLayers.length === 0 &&
        s.lineCount === direct.totals.lineCount &&
        Math.abs(s.estimate.totalSec - Object.entries(s.estimate).filter(([k]) => k !== "totalSec").reduce((a, [, v]) => a + v, 0)) < 1e-6,
      `${fx.name}: 요약 층 ${s?.layerCount} · 빈 층 ${s?.emptyLayerCount} · 채움 층 ${s?.thinFillLayerCount} · 예상 ${s?.estimate.totalSec} s(= 7항목 합)`,
    );
  }
  // 진행 콜백 없이도 같은 바이트 (콜백은 출력 무영향)
  const m = fixtureCube10().meshes();
  const noCb = runTask0GcodeExport({ meshes: m, topY: meshesTopY(m), layerHeightMm: 0.1, writer });
  assert(noCb.ok && sha256(noCb.gcode) === EXPECTED_SHA.cube10, "진행 콜백 없이 → 같은 sha256 (파일 A)");
  // 노광 설정이 estimate 노광 항목에만 반영 (gcode 무영향)
  const withExp = runTask0GcodeExport({ meshes: m, topY: meshesTopY(m), layerHeightMm: 0.1, writer, exposure: { exposureSec: 5, bottomExposureSec: 30, bottomLayerCount: 5, transitionLayerCount: 0 } });
  assert(
    withExp.ok && withExp.gcode === noCb.gcode && withExp.summary.estimate.exposureSec === 5 * 30 + 95 * 5,
    `노광 설정 → estimate 노광 ${withExp.ok ? withExp.summary.estimate.exposureSec : "?"} s (바닥 5층 × 30 + 95층 × 5), G-code 그대로`,
  );
  return outputs;
}

/**
 * (3b) 실제 워커 모듈 — slice-batch.worker.ts 를 가짜 self(addEventListener·postMessage)로 Node 에서 불러
 * 앱이 보내는 것과 같은 모양의 task0-gcode 메시지를 넣는다. 서비스(slice-batch-service)는 Vite `?worker`
 * import 라 Node 에서 못 띄우므로 메시지 모양·응답 처리는 (5) 의 소스 검사가 맡는다.
 */
async function sectionWorkerModule() {
  console.log("\n(3b) 실제 워커 모듈(slice-batch.worker.ts)에 task0-gcode 메시지 — 진행률·결과·같은 바이트");
  const posted = [];
  let handler = null;
  const hadSelf = Object.prototype.hasOwnProperty.call(globalThis, "self");
  const prevSelf = globalThis.self;
  globalThis.self = {
    addEventListener: (type, fn) => {
      if (type === "message") handler = fn;
    },
    postMessage: (m) => posted.push(m),
  };
  try {
    await import(pathToFileURL(path.join(V2, "workers", "slice-batch.worker.ts")).href);
  } finally {
    if (hadSelf) globalThis.self = prevSelf;
    else delete globalThis.self;
  }
  assert(typeof handler === "function", "워커 모듈이 message 리스너를 등록");
  if (typeof handler !== "function") return;
  const writer = task0WriterOptionsForProfile(TASK0_BUILT_IN_PROFILE);
  const send = async (meshes, topY, layerHeightMm, w = writer) => {
    posted.length = 0;
    await handler({ data: { kind: "task0-gcode", meshes: meshes.map((t) => ({ triangles: t })), topY, layerHeightMm, writer: w } });
    return [...posted];
  };
  for (const fx of [fixtureCube10(), fixtureGapPlates(), fixtureFileB()]) {
    const meshes = fx.meshes();
    const msgs = await send(meshes, meshesTopY(meshes), 0.1);
    const done = msgs.filter((m) => m.type === "task0-done");
    const prog = msgs.filter((m) => m.type === "progress");
    const last = prog.at(-1);
    const ok = done.length === 1 && done[0].result.ok && msgs.at(-1) === done[0];
    assert(
      ok && sha256(done[0].result.gcode) === EXPECTED_SHA[fx.name],
      `${fx.name}: 워커 응답 task0-done 1건(마지막) · sha256 = 고정값 (${ok ? sha256(done[0].result.gcode).slice(0, 16) : "응답 없음"}…)`,
    );
    assert(
      prog.length >= 1 && last.done === last.total && last.total === done[0]?.result.summary.layerCount &&
        prog.every((m, i) => i === 0 || m.done > prog[i - 1].done),
      `${fx.name}: 진행률 ${prog.length}건(스로틀), 증가, 마지막 ${last?.done}/${last?.total}`,
    );
  }
  const sp = FAIL_INPUTS.speed();
  const msgs = await send(sp.meshes, sp.topY, sp.layerHeightMm, { ...writer, ...sp.writer });
  const done = msgs.find((m) => m.type === "task0-done");
  assert(
    done !== undefined && !done.result.ok && done.result.gcode === null && !msgs.some((m) => m.type === "error"),
    "막힘 입력(속도 위반) → error 가 아니라 task0-done(ok false, gcode null) — 서비스가 reject 하지 않고 이유를 넘긴다",
  );
}

// ── (4) 막힘 경로 ────────────────────────────────────────────────────────

/** 같은 평면 면을 가진 겹친 상자 7개를 한 메시로 — 나선 벽 (Z1-b2 검수 "갇힘" 퇴화 단면) */
function spiralSingleMesh() {
  const box = boxTriangles;
  return [
    normalizeTriangleWinding(
      concatTris(
        box([-4, 0, -4], [4, 1, -3.8]),
        box([3.8, 0, -4], [4, 1, 4]),
        box([-4, 0, 3.8], [4, 1, 4]),
        box([-4, 0, -2], [-3.8, 1, 4]),
        box([-4, 0, -2], [2, 1, -1.8]),
        box([1.8, 0, -2], [2, 1, 2]),
        box([-2, 0, 1.8], [2, 1, 2]),
      ),
    ),
  ];
}

const FAIL_INPUTS = {
  spiral: () => {
    const meshes = spiralSingleMesh();
    return { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1 };
  },
  speed: () => {
    const meshes = fixtureGapPlates().meshes();
    return { meshes, topY: meshesTopY(meshes), layerHeightMm: 0.1, writer: { travelSpeedMmS: 150 } };
  },
};

function sectionBlocked(run = runTask0GcodeExport, label = "") {
  const out = {};
  // ① 채움 실패
  const sp = run(FAIL_INPUTS.spiral());
  out.spiral = sp;
  // ② 파서 경고 (규격 §8 한계 초과 속도)
  const spd = run(FAIL_INPUTS.speed());
  out.speed = spd;
  if (label) return out;
  console.log("\n(4) 막힘 경로 — 파일 없음 + 이유");
  assert(
    !sp.ok && sp.gcode === null && JSON.stringify(sp.failedLayers) === "[9]" && sp.summary?.thinFillFailedLayers.length === 1,
    `① 나선 벽(겹친 상자 한 메시, lh 0.1): 막힘, gcode null, 문제 층 ${JSON.stringify(sp.failedLayers)}`,
  );
  assert(
    !sp.ok && sp.issues.some((s) => s.includes("층 9") && s.includes("Z 1 mm") && s.includes("얇은 부분 채움 실패")),
    `① 이유에 층 번호·Z·문구: ${sp.ok ? "" : sp.issues[0]}`,
  );
  assert(
    !spd.ok && spd.gcode === null && spd.failedLayers.length === 0 && spd.issues.some((s) => s.includes("Task0 파서 print(lh=0.1)") && s.includes("F 클램프")),
    `② 트래블 150 mm/s(F9000 > 한계 F6000): 막힘, 이유 ${spd.ok ? "" : JSON.stringify(spd.issues)}`,
  );
  assert(
    !spd.ok && spd.summary !== null && spd.parser.find((p) => p.label.startsWith("print")).warnings.length === 1,
    "② 파서 print 모드 경고 1건, 요약은 남김(층 수 등)",
  );
  const empty = runTask0GcodeExport({ meshes: fixtureGapPlates().meshes(), topY: 0, layerHeightMm: 0.1 });
  assert(!empty.ok && empty.gcode === null && empty.summary === null && empty.issues[0].includes("슬라이스할 층이 없습니다"), `③ topY 0: ${empty.ok ? "" : empty.issues[0]}`);
  const noMesh = runTask0GcodeExport({ meshes: [], topY: 10, layerHeightMm: 0.1 });
  assert(!noMesh.ok && noMesh.gcode === null, "③ 메시 없음: 막힘");
  return out;
}

// ── (5) 배선 (소스) ──────────────────────────────────────────────────────

const read = (...p) => fs.readFileSync(path.join(V2, ...p), "utf8");

/** useCallback 본문(start ~ end 표식)의 마지막 deps 배열 */
function lastDeps(src, startMark, endMark) {
  const s = src.indexOf(startMark);
  if (s < 0) return null;
  const e = endMark ? src.indexOf(endMark, s) : -1;
  const body = src.slice(s, e > 0 ? e : src.length);
  const at = body.lastIndexOf("}, [");
  if (at < 0) return null;
  const m = body.slice(at).match(/\}\s*,\s*\[([\s\S]*?)\]\s*\)/);
  return m ? m[1] : null;
}

/** 규칙 7 — Task0 핸들러 deps 에 printerProfile·층두께가 있는가 (대조군 f 가 같은 함수를 변조 소스에 쓴다) */
function task0DepsOk(src) {
  const deps = lastDeps(src, "const handleExportTask0Gcode", "return {");
  return deps !== null && /\bprinterProfile\b/.test(deps) && /slicePreview\.layerHeightMm/.test(deps);
}

function sectionWiring() {
  console.log("\n(5) 배선 — 워커·서비스·훅·패널·페이지·씬 훅 순서");
  const worker = read("workers", "slice-batch.worker.ts");
  const fn = worker.slice(worker.indexOf("function runTask0Gcode"), worker.indexOf("ctx.addEventListener"));
  assert(
    /runTask0GcodeExport\(/.test(fn) &&
      /meshes:\s*req\.meshes\.map\(\(m\)\s*=>\s*m\.triangles\)/.test(fn) &&
      /topY:\s*req\.topY/.test(fn) &&
      /layerHeightMm:\s*req\.layerHeightMm/.test(fn) &&
      /writer:\s*req\.writer/.test(fn) &&
      /type:\s*"task0-done",\s*result/.test(fn),
    "워커 runTask0Gcode = 코어 runTask0GcodeExport 를 요청 값 그대로 부르고 결과를 그대로 보냄 (앱 경로 = 이 스크립트가 부른 함수)",
  );
  assert(
    /req\.kind === "pngzip"[\s\S]*?req\.kind === "gcode"[\s\S]*?runTask0Gcode\(req\)/.test(worker),
    "워커 분기: pngzip → gcode → 그 밖(task0-gcode)",
  );
  const svc = read("utils", "slice-batch-service.ts");
  assert(
    /exportTask0Gcode\(/.test(svc) && /kind: "task0-gcode"/.test(svc) && /case "task0-done":[\s\S]*?resolve\(msg\.result\)/.test(svc),
    "서비스 exportTask0Gcode → task0-gcode 요청, task0-done 에서 결과 resolve",
  );

  const hook = read("pages", "viewer", "hooks", "useSliceExport.ts");
  const body = hook.slice(hook.indexOf("const handleExportTask0Gcode"), hook.lastIndexOf("return {"));
  assert(task0DepsOk(hook), "규칙 7 — handleExportTask0Gcode deps 에 printerProfile · slicePreview.layerHeightMm");
  assert(
    /type:\s*"application\/octet-stream"/.test(body) && !/type:\s*["']text\/plain/.test(body),
    "Task0 G-code Blob = application/octet-stream (B-38)",
  );
  assert(/`\$\{safe\}_task0_\$\{lh\}mm\.gcode`/.test(body), "파일 이름 <프로젝트>_task0_<lh>mm.gcode");
  assert(
    /getSliceGeometry\(\)/.test(body) && /getSceneTopY\(\)/.test(body) && /task0WriterOptionsForProfile\(printerProfile\)/.test(body) && /confirmIfOutOfBounds\(\)/.test(body),
    "마스크 ZIP 과 같은 mesh 집합·topY, 프로파일 writer 옵션, 출력영역 확인(P-1)",
  );
  assert(
    hook.indexOf("const handleExportStl") > 0 && hook.indexOf("const handleExportTask0Gcode") > hook.indexOf("const handleExportStl"),
    "Task0 핸들러는 handleExportStl 뒤 (verify-gcode-export-params 의 G-code 본문 구간을 건드리지 않음)",
  );
  const confirmDeps = lastDeps(hook, "const confirmIfOutOfBounds", "// ----- 마스크 ZIP");
  assert(confirmDeps !== null && /\bprinterProfile\b/.test(confirmDeps) && /volumeIssues/.test(confirmDeps), "confirmIfOutOfBounds deps 에 printerProfile 추가");
  assert(
    hook.includes("`⚠️ 출력영역을 벗어난 모델이 ${volumeIssues.length}개 있습니다.${NL}` +") &&
      hook.includes("`이대로 내보내면 벗어난 부분이 잘려 나갑니다.${NL}${NL}`"),
    "기존 프로파일 확인 문구 그대로",
  );

  const panel = read("components", "SliceSidePanel.tsx");
  const iBranch = panel.indexOf(") : task0 ? (");
  const iTask0Btn = panel.indexOf("Task0 G-code (run.gcode)");
  const iMaskBtn = panel.indexOf("onClick={onExportMasksZip}");
  assert(
    /const task0 = isTask0Profile\(printerProfile\)/.test(panel) && iBranch > 0 && iTask0Btn > iBranch && iMaskBtn > iTask0Btn,
    "패널: Task0 프로파일이면 Task0 버튼만, 마스크 ZIP·FDM G-code 는 Task0 아닌 쪽 분기",
  );

  const page = read("pages", "ViewerV2Page.tsx");
  assert(
    /printableAreaMm=\{task0PrintableAreaForProfile\(printerProfile\)\}/.test(page) &&
      /onExportTask0Gcode=\{\(\) => void handleExportTask0Gcode\(\)\}/.test(page) &&
      /task0Report=\{task0Report\}/.test(page),
    "ViewerV2Page: 씬에 출력 가능 영역, 패널에 Task0 핸들러·결과",
  );

  // BabylonScene 훅 호출 목록 — 불변식 1. verify-support-follow 와 같은 목록(Z2 는 목록을 늘리지 않는다).
  const scene = read("components", "BabylonScene.tsx");
  const bodyAt = scene.indexOf("function BabylonScene(");
  const calls = [...scene.slice(bodyAt).matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]);
  const EXPECTED_CALLS = [
    "useSceneRefs",
    "useSupportPartsReady",
    "useSceneBootstrap",
    "useState",
    "useFileMeshSync",
    "useSupportMeshSync",
    "useSelectionSync",
    "useSlicePreview",
    "useBridgeVisualization",
    "useEditModeSync",
    "useDentalBrush",
    "useBuildVolumeCheck",
    "useAlignFloorHover",
    "useImperativeHandle",
  ];
  assert(
    bodyAt >= 0 && JSON.stringify(calls) === JSON.stringify(EXPECTED_CALLS),
    `BabylonScene 훅 호출 목록 불변 (${calls.length}개 — 새 훅을 여기 늘리지 않음)`,
  );
  const vcAt = scene.indexOf("useBuildVolumeCheck(", bodyAt);
  const vc = scene.slice(vcAt, scene.indexOf("useAlignFloorHover(", vcAt));
  assert(/printableAreaMm,/.test(vc) && /supports, supportParams, partsReady: supportPartsReady/.test(vc), "useBuildVolumeCheck 에 영역·서포트 신호 인자만 추가");
  const bv = read("components", "babylon", "hooks", "useBuildVolumeCheck.ts");
  const fnBody = bv.slice(bv.indexOf("export function useBuildVolumeCheck("), bv.indexOf("function collectPrintableAreaIssues("));
  const hookCalls = [...fnBody.matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]);
  assert(
    JSON.stringify(hookCalls) === JSON.stringify(["useBuildVolumeCheck", "useRef", "useEffect", "usePrintableAreaOutline"]),
    `영역 테두리 훅은 useBuildVolumeCheck 안 끝(검사 effect 다음)에서 무조건 호출 (${hookCalls.join(" → ")})`,
  );
}

// ── (6) 대조군 ───────────────────────────────────────────────────────────

/** task0-export.ts 를 소스 변조해 임시 폴더에 쓰고 import — 상대 import 는 원본 폴더의 절대 URL 로 바꾼다 */
async function loadMutant(tag, from, to) {
  const src = fs.readFileSync(path.join(TASK0_SRC, "task0-export.ts"), "utf8");
  if (!src.includes(from)) throw new Error(`변조 대상 문자열이 소스에 없음 (${tag}): ${from}`);
  const mutated = src
    .replace(from, to)
    .replace(/from '\.\/([^']+)'/g, (_, p) => `from '${pathToFileURL(path.join(TASK0_SRC, `${p}.ts`)).href}'`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-task0-export-"));
  const file = path.join(dir, `task0-export.${tag}.ts`);
  fs.writeFileSync(file, mutated, "utf8");
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function sectionControls(area) {
  console.log("\n(6) 대조군 — 변조하면 위 단언이 실제로 실패하는가");
  // a. 대칭 경계 (기존 플레이트 판정과 같은 모양)
  const W = TASK0_DEFAULTS.bedWidthMm;
  const D = TASK0_DEFAULTS.bedDepthMm;
  const sym = areaCases({ minX: -W / 2, maxX: W / 2, minZ: -D / 2, maxZ: D / 2 });
  assert(
    !AREA_EXPECT.bedX5(sym.bedX5) && !AREA_EXPECT.bedY5(sym.bedY5),
    `a. 대칭 경계(±${W / 2} · ±${D / 2})면 베드 X 5~15·Y 5~15 모델을 놓친다 (위반 ${sym.bedX5.length}·${sym.bedY5.length}건)`,
  );
  const legacy = checkBuildVolume(aabbXZ(-70, -60, 0, 10), { widthMm: W, depthMm: D, heightMm: 2000 });
  assert(!hasViolation(legacy), "a. 기존 대칭 검사(checkBuildVolume)도 같은 모델을 놓친다 — 그래서 Task0 는 비대칭 영역이 필요");
  // b. 서포트 빼기
  const noSup = areaCases(area, { withSupports: false });
  assert(
    !AREA_EXPECT.supportOut(noSup.supportOut) && !AREA_EXPECT.supportGroup(noSup.supportGroup),
    `b. 서포트를 빼고 검사하면 서포트만 밖인 사례를 놓친다 (위반 ${noSup.supportOut.length}·${noSup.supportGroup.length}건)`,
  );
  // c. 파서 검사 제거
  const noParser = await loadMutant(
    "no-parser",
    "for (const { label, opt } of parserModes(lh)) {",
    "for (const { label, opt } of parserModes(lh).slice(0, 0)) {",
  );
  const c = sectionBlocked(noParser.runTask0GcodeExport, "no-parser");
  assert(c.speed.ok && typeof c.speed.gcode === "string" && c.speed.gcode.length > 0, "c. 파서 검사를 빼면 속도 위반 입력이 파일로 나와 버린다");
  // d. 채움 실패 확인 제거
  const noFill = await loadMutant("no-fill-check", "if (failed.length > 0) {", "if (failed.length < 0) {");
  const d = sectionBlocked(noFill.runTask0GcodeExport, "no-fill-check");
  assert(d.spiral.ok && typeof d.spiral.gcode === "string", "d. 채움 실패 확인을 빼면 나선 벽(층 9 채움 실패)이 파일로 나와 버린다");
  // e. 바이트 비교 민감도 — 베드 크기만 Mars 3 Pro 플레이트로
  const m = fixtureCube10().meshes();
  const mars = runTask0GcodeExport({ meshes: m, topY: meshesTopY(m), layerHeightMm: 0.1, writer: { bedWidthMm: 143.43, bedDepthMm: 89.6 } });
  assert(!mars.ok || sha256(mars.gcode) !== EXPECTED_SHA.cube10, "e. writer 베드 크기를 바꾸면 파일 A sha256 이 달라진다 — (3) 의 비교는 민감하다");
  // f. deps 검사
  const hook = read("pages", "viewer", "hooks", "useSliceExport.ts");
  const at = hook.indexOf("const handleExportTask0Gcode");
  const tail = hook.slice(at);
  const broken = hook.slice(0, at) + tail.replace(/\n\s*printerProfile,\n/, "\n");
  assert(broken !== hook && !task0DepsOk(broken), "f. deps 에서 printerProfile 을 빼면 (5) 의 규칙 7 검사가 실패한다");
}

async function main() {
  console.log("Task0 앱 내보내기 검증 (Z2 — 프로파일·출력 가능 영역·워커 코어, 규격서 v0.3.3)");
  await sectionProfile();
  const area = sectionArea();
  sectionSamePath();
  await sectionWorkerModule();
  sectionBlocked();
  sectionWiring();
  await sectionControls(area);
  console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
