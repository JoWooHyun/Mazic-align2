// 10/15 코드 정리(R-4) + 사고 방지 4차(소) 헤드리스 검증.
//
//   실행: npx tsx scripts/verify-cleanup-20261015.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "실패 재현" 문자열을 낸다.
//
//   무엇을:
//     정리(동작 불변) — 콘솔 소음(log → debug·측정 로그 삭제), 낡은 주석, 죽은 코드 삭제(호출 0 — src+scripts),
//       NL 상수 통합(pages/viewer/utils/text.ts), ViewerV2Page 분리(손상 STL 훅·옛 서포트 마이그레이션 훅·Esc 훅·출력영역 배너).
//     사고 방지 4차(소) — 동작 변경 4건:
//       ① 여러 모델 차례 생성: 라우팅 뒤·저장 앞에 그 모델이 아직 목록(최신 filesRef)에 있는지 확인, 없으면 건너뜀.
//       ② Ctrl+X 잘라내기: Delete 와 같은 삭제 확인(confirmDeleteModels) — 취소하면 복사도 삭제도 안 하고 선택 유지.
//       ③ 슬라이스 진입 가드: 모델이 전부 손상이면 "전부 손상돼 … 목록에서 지워 주세요" 문구(아니면 종전 문구).
//       ④ 빈 씬 카메라 fit·플레이트 보기: Task0 면 출력 가능 영역 중심·크기(기존 프로파일은 원점 그대로).
//
//   (1) 기능 검사 — cutModels(②, 가짜 window.confirm·가짜 repo 로 순서·클립보드 확인) · isEveryModelLoadFailed(③)
//       · emptySceneCameraFrame·buildCameraHandle(④, NullEngine 의 실제 ArcRotateCamera 로 target·radius 확인).
//   (2) 소스 검사 — 훅·페이지는 React 없이 돌릴 수 없어 소스로 본다(verify-safety3 관례).
//   (3) ★ 대조군 원칙: 기능 모듈은 임시 폴더 사본의 한 곳을 변조해 같은 검사에 넣고, 소스 검사는 핵심 문자열을 지우거나
//       뒤집은 판을 넣어 **실제로 실패하는지** 확인한다. 변조 대상 문자열이 소스에 없으면 그 자체를 FAIL 로 센다.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FRONTEND = join(__dirname, "..");
const V2 = join(FRONTEND, "src", "features", "v2");

// ── assert 유틸 ──────────────────────────────────────────────────────────
let failed = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}
function assertAll(results) {
  for (const r of results) assert(r.ok, r.label);
}
/** 대조군: 변조판이 **하나 이상** 실패해야 통과. */
function assertControl(results, label) {
  const bad = results.filter((r) => !r.ok);
  if (bad.length > 0) {
    console.log(`  ok  [대조군] ${label} → 실패 재현: ${bad[0].label}`);
  } else {
    failed++;
    console.error(`  FAIL [대조군] ${label} — 변조판이 모든 검사를 통과함(검사가 결함을 못 잡음)`);
  }
}
function makeChecker() {
  const res = [];
  const check = (ok, label) => res.push({ ok: !!ok, label });
  return { res, check };
}
const norm = (s) => s.replace(/\r\n/g, "\n");
const readV2 = (rel) => norm(readFileSync(join(V2, rel), "utf8"));
const count = (s, sub) => s.split(sub).length - 1;
/** a 부터 그 뒤 첫 b 앞까지 (b 가 없으면 끝까지). a 가 없으면 "". */
function between(s, a, b) {
  const i = s.indexOf(a);
  if (i < 0) return "";
  const j = b ? s.indexOf(b, i + a.length) : -1;
  return s.slice(i, j > 0 ? j : s.length);
}
const lineCount = (s) => (s.endsWith("\n") ? s.split("\n").length - 1 : s.split("\n").length);

// ── 변조판(대조군) 사본 — import 를 절대 URL 로(bare 는 이 스크립트 기준, 상대는 원본 위치 기준) ──
const TMP_ROOT = mkdtempSync(join(tmpdir(), "verify-cleanup-20261015-"));
process.on("exit", () => rmSync(TMP_ROOT, { recursive: true, force: true }));
const BARE = {
  react: import.meta.resolve("react"),
  "@babylonjs/core": import.meta.resolve("@babylonjs/core"),
};
function rewriteImports(text, origAbs) {
  let src = text;
  for (const [spec, url] of Object.entries(BARE)) src = src.split(`"${spec}"`).join(`"${url}"`);
  return src.replace(/(from\s+|import\s+)(["'])(\.{1,2}\/[^"']+)\2/g, (m, kw, q, rel) => {
    const base = resolve(dirname(origAbs), rel);
    const cand = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base].find((c) => existsSync(c) && statSync(c).isFile());
    if (!cand) throw new Error(`사본 import 를 풀 수 없음: ${rel} (${origAbs})`);
    return `${kw}${q}${pathToFileURL(cand).href}${q}`;
  });
}
let mutantSeq = 0;
/** v2 파일 rel 을 [from, to] 목록으로 바꾼 사본을 import. 대상 문자열이 하나라도 없으면 null. */
async function loadMutant(rel, mutations) {
  let text = readV2(rel);
  for (const [from, to] of mutations) {
    if (!text.includes(from)) return null;
    text = text.replace(from, () => to);
  }
  const out = join(TMP_ROOT, `m${mutantSeq++}`, basename(rel));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, rewriteImports(text, join(V2, rel)));
  return import(pathToFileURL(out).href);
}
async function functionalControl(label, rel, mutations, suite) {
  const mod = await loadMutant(rel, mutations);
  if (!mod) {
    assert(false, `[대조군] ${label} — 변조 대상 없음 ${rel}`);
    return;
  }
  let results;
  try {
    results = await suite(mod);
  } catch (e) {
    results = [{ ok: false, label: `검사 도중 예외: ${e?.message ?? e}` }];
  }
  assertControl(results, label);
}

const REL = {
  clip: "pages/viewer/hooks/useClipboardActions.ts",
  loadFail: "pages/viewer/hooks/useStlLoadFailures.ts",
  camera: "components/babylon/handle/camera-handle.ts",
};
const realMod = async (rel) => import(pathToFileURL(join(V2, rel)).href);
const { useClipboardStore } = await realMod("hooks/useClipboardStore.ts");
const { TASK0_BUILT_IN_PROFILE, task0PrintableAreaForProfile } = await realMod("utils/task0/task0-profile.ts");
const { NullEngine, Scene, ArcRotateCamera, Vector3 } = await import("@babylonjs/core");
const engine = new NullEngine();

// ═════════════════════════════════════════════════════════════════════════
// (1) 기능 검사
// ═════════════════════════════════════════════════════════════════════════

/** ② cutModels — 확인 취소면 아무것도 안 함, 확인이면 담기 → 삭제(순서대로) → 서포트 갱신 → 선택 해제. */
async function suiteCut(mod) {
  const { res, check } = makeChecker();
  const blobA = new Blob([new Uint8Array(3)]);
  const blobB = new Blob([new Uint8Array(5)]);
  const files = [
    { id: "a", fileName: "a.stl", blob: blobA, materialSlot: "A" },
    { id: "b", fileName: "b.stl", blob: blobB },
  ];
  let answer = false;
  const events = [];
  const confirms = [];
  const remove = async (id) => {
    await Promise.resolve();
    events.push(`remove:${id}`);
  };
  const refresh = async () => {
    events.push("refresh");
  };
  const clear = () => events.push("clear");
  const sentinel = [{ fileName: "keep.stl", blob: new Blob([]) }];
  // 가짜 window(confirm 만) — 이 묶음 안에서만. 뒤의 Babylon 검사가 브라우저로 오인하지 않게 finally 에서 지운다.
  globalThis.window = {
    confirm: (m) => {
      confirms.push(String(m));
      events.push("confirm");
      return answer;
    },
  };
  try {
    // 취소
    useClipboardStore.getState().set(sentinel);
    const r0 = await mod.cutModels(files, remove, refresh, clear);
    check(
      r0 === false && JSON.stringify(events) === '["confirm"]' && useClipboardStore.getState().items === sentinel,
      `② 확인 취소 → false, 삭제·갱신·선택 해제 없음, 클립보드 그대로 (사건 ${JSON.stringify(events)})`,
    );
    check(
      confirms.length === 1 && confirms[0].includes("모델 2개를 삭제할까요?") && confirms[0].includes("· a.stl") && confirms[0].includes("· b.stl"),
      "② 확인 문구 = confirmDeleteModels(이름 목록) — Delete 와 같은 문구",
    );

    // 확인
    answer = true;
    events.length = 0;
    const r1 = await mod.cutModels(files, remove, refresh, clear);
    const items = useClipboardStore.getState().items;
    check(
      r1 === true && JSON.stringify(events) === '["confirm","remove:a","remove:b","refresh","clear"]',
      `② 확인 → 삭제 a·b(순서대로) → 서포트 갱신 → 선택 해제 (사건 ${JSON.stringify(events)})`,
    );
    check(
      items !== sentinel && items.length === 2 && items[0].fileName === "a.stl" && items[0].blob === blobA && items[0].materialSlot === "A" &&
        items[1].fileName === "b.stl" && items[1].blob === blobB && !("materialSlot" in items[1]),
      "② 클립보드 = 잘라낸 모델(이름·blob·Task0 슬롯 상속 — 슬롯 없으면 필드 없음)",
    );

    // 대상 없음
    events.length = 0;
    const r2 = await mod.cutModels([], remove, refresh, clear);
    check(r2 === false && events.length === 0, "② 대상 0개 → 묻지 않고 false");
  } finally {
    delete globalThis.window;
  }
  return res;
}

/** ③ isEveryModelLoadFailed — 모델이 있고 전부 손상일 때만 true. */
async function suiteLoadFail(mod) {
  const { res, check } = makeChecker();
  const f = mod.isEveryModelLoadFailed;
  const m = (...ids) => new Map(ids.map((id) => [id, "사유"]));
  check(f([], m()) === false && f([], m("a")) === false, "③ 모델 0개 → false (빈 프로젝트는 종전 문구 경로)");
  check(f([{ id: "a" }], m("a")) === true, "③ 모델 1개가 손상 → true");
  check(f([{ id: "a" }, { id: "b" }], m("a")) === false, "③ 2개 중 1개만 손상 → false (나머지는 로드 중일 수 있음)");
  check(f([{ id: "a" }, { id: "b" }], m("a", "b", "x")) === true, "③ 전부 손상(지운 모델 사유가 남아 있어도) → true");
  return res;
}

/** ④ 빈 씬 카메라 — 순수 함수 값 + 실제 카메라에 handle 세 메서드(fit·viewPlate·fitSelection([])). */
async function suiteCamera(mod) {
  const { res, check } = makeChecker();
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const plain = mod.emptySceneCameraFrame(192, 120, null);
  check(plain.widthMm === 192 && plain.depthMm === 120 && plain.center === undefined, "④ 기존 프로파일(영역 없음) → plate 크기, center 없음(원점 — 종전)");
  const area = task0PrintableAreaForProfile(TASK0_BUILT_IN_PROFILE);
  const cx = (area.minX + area.maxX) / 2;
  const cz = (area.minZ + area.maxZ) / 2;
  const w = area.maxX - area.minX;
  const d = area.maxZ - area.minZ;
  check(Math.abs(cx) + Math.abs(cz) > 1, `④ 전제: 빌트인 Task0 출력 가능 영역 중심이 원점이 아님 (${cx.toFixed(2)}, ${cz.toFixed(2)}) — 검사가 의미 있음`);
  const t0 = mod.emptySceneCameraFrame(150, 85, area);
  check(
    near(t0.widthMm, w) && near(t0.depthMm, d) && t0.center && near(t0.center[0], cx) && near(t0.center[1], cz),
    `④ Task0 → 영역 크기 ${w} × ${d} · 중심 (${cx.toFixed(2)}, ${cz.toFixed(2)})`,
  );

  const scene = new Scene(engine);
  const cam = new ArcRotateCamera("cam", 0, 1, 10, new Vector3(9, 9, 9), scene);
  const ctx = {
    cameraRef: { current: cam },
    meshMapRef: { current: new Map() },
    plateWRef: { current: 150 },
    plateDRef: { current: 85 },
    printableAreaRef: { current: area },
  };
  const h = mod.buildCameraHandle(ctx);
  const calls = [
    ["fit()", () => h.fit()],
    ["viewPlate()", () => h.viewPlate()],
    ["fitSelection([])", () => h.fitSelection([])],
  ];
  for (const [name, run] of calls) {
    cam.target.copyFromFloats(9, 9, 9);
    run();
    check(
      near(cam.target.x, cx) && near(cam.target.y, 0) && near(cam.target.z, cz) && near(cam.radius, Math.hypot(w, d) * 1.3),
      `④ Task0 빈 씬 ${name} → target (${cam.target.x.toFixed(2)}, ${cam.target.y.toFixed(2)}, ${cam.target.z.toFixed(2)}) = 영역 중심, radius = 영역 대각 × 1.3`,
    );
  }
  ctx.printableAreaRef.current = null;
  for (const [name, run] of calls) {
    cam.target.copyFromFloats(9, 9, 9);
    run();
    check(
      near(cam.target.x, 0) && near(cam.target.y, 0) && near(cam.target.z, 0) && near(cam.radius, Math.hypot(150, 85) * 1.3),
      `④ 기존 프로파일 빈 씬 ${name} → target 원점, radius = plate 대각 × 1.3 (종전 그대로)`,
    );
  }
  scene.dispose();
  return res;
}

console.log("(1) 기능 검사");
assertAll(await suiteCut(await realMod(REL.clip)));
assertAll(await suiteLoadFail(await realMod(REL.loadFail)));
assertAll(await suiteCamera(await realMod(REL.camera)));

console.log("\n(1') 기능 대조군 — 사본 한 곳을 변조하면 위 검사가 실제로 실패하는가");
const CONFIRM_LINE = "  if (!confirmDeleteModels(toCut.map((f) => f.fileName))) return false;\n";
const SET_END = "task0CopySlotInit(f) })));\n";
await functionalControl("② Ctrl+X 확인 없음(종전)", REL.clip, [[CONFIRM_LINE, ""]], suiteCut);
await functionalControl("② 확인을 클립보드 담기 뒤로(취소해도 복사됨)", REL.clip, [[CONFIRM_LINE, ""], [SET_END, SET_END + CONFIRM_LINE]], suiteCut);
await functionalControl("③ 하나라도 손상이면 true(every → some)", REL.loadFail, [["files.every((f) => loadFailed.has(f.id))", "files.some((f) => loadFailed.has(f.id))"]], suiteLoadFail);
await functionalControl("③ 모델 0개도 true", REL.loadFail, [["files.length > 0 && files.every", "files.every"]], suiteLoadFail);
await functionalControl("④ Task0 중심 없음(원점 — 종전)", REL.camera, [["    center: [(area.minX + area.maxX) / 2, (area.minZ + area.maxZ) / 2],\n", ""]], suiteCamera);
await functionalControl(
  "④ fit() 빈 씬 폴백이 plate·원점(종전)",
  REL.camera,
  [["      } else {\n        resetOnPlate(camera);\n      }\n    },\n    fitSelection", "      } else {\n        resetCameraOnPlate(camera, ctx.plateWRef.current, ctx.plateDRef.current);\n      }\n    },\n    fitSelection"]],
  suiteCamera,
);
await functionalControl(
  "④ viewPlate() 가 plate·원점(종전)",
  REL.camera,
  [["      resetOnPlate(camera);\n    },\n    previewTransform", "      resetCameraOnPlate(camera, ctx.plateWRef.current, ctx.plateDRef.current);\n    },\n    previewTransform"]],
  suiteCamera,
);

// ═════════════════════════════════════════════════════════════════════════
// (2) 소스 검사
// ═════════════════════════════════════════════════════════════════════════

/** v2 아래 .ts/.tsx 전부 (rel → LF 텍스트). */
function readTree() {
  const out = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) out[relative(V2, p).replace(/\\/g, "/")] = norm(readFileSync(p, "utf8"));
    }
  };
  walk(V2);
  return out;
}
/** scripts/verify-*.mjs (이 스크립트 제외 — 삭제 심볼 이름을 목록으로 들고 있다). */
function readScripts() {
  const out = {};
  for (const name of readdirSync(__dirname)) {
    if (/^verify-.*\.mjs$/.test(name) && name !== basename(__filename)) out[name] = norm(readFileSync(join(__dirname, name), "utf8"));
  }
  return out;
}

const DELETED = [
  "runRedesignDetect",
  "renderDetectionOverlay",
  "RedesignDetectStats",
  "PlateDimensions",
  "profileToPlate",
  "maskToPngBlob",
  "isIdentity",
  "applyInverseTransform",
  "_peekRegisteredActions",
];
/** 이번엔 삭제하지 않는 것 — 같은 파일 안에서 쓰임(export 만 남은 것)·지현규 확인 전(dental-support). 과삭제 방지. */
const KEPT = [
  ["components/babylon/material-display.ts", "applySupportDisplayColor"],
  ["support/support-stats.ts", "EMPTY_SUPPORT_SUMMARY"],
  ["hooks/usePrinterProfileStore.ts", "DEFAULT_PROFILE_ID"],
  ["utils/camera-views.ts", "frameCameraToMesh"],
  ["utils/dental/dental-support.ts", "SupportTool"],
  ["utils/dental/dental-support.ts", "createUnsupportedHighlight"],
  ["utils/dental/dental-support.ts", "createFaceOverlay"],
  ["utils/dental/dental-support.ts", "createMarginLines"],
];
const NL_USERS = {
  "pages/ViewerV2Page.tsx": 'import { NL } from "./viewer/utils/text";',
  "pages/viewer/hooks/useSliceExport.ts": 'import { NL } from "../utils/text";',
  "pages/viewer/hooks/useStlDropImport.ts": 'import { NL } from "../utils/text";',
  "pages/viewer/hooks/useTask0Material.ts": 'import { NL } from "../utils/text";',
  "pages/viewer/hooks/useStlLoadFailures.ts": 'import { NL } from "../utils/text";',
  "pages/viewer/utils/confirm-delete-models.ts": 'import { NL } from "./text";',
};
/** 로그 정리 대상 — console.log 0, console.debug 개수. */
const DEBUG_LOGS = {
  "pages/viewer/hooks/useDentalWorkflow.ts": 1,
  "components/babylon/handle/support-gen-handle.ts": 2,
  "components/babylon/dental-actions.ts": 2,
  "components/babylon/dental-floodfill.ts": 1,
  "components/babylon/redesign-detect-actions.ts": 0,
  "components/babylon/hooks/useFileMeshSync.ts": 0,
};

function sourceChecks(tree, scripts) {
  const { res, check } = makeChecker();
  const t = (rel) => tree[rel] ?? "";
  const all = Object.values(tree).join("\n");

  // (c) 죽은 코드 — src + scripts 참조 0, mask-png 파일 없음, 보류분은 그대로
  for (const name of DELETED) {
    const re = new RegExp(`\\b${name}\\b`);
    const inSrc = Object.keys(tree).filter((rel) => re.test(tree[rel]));
    const inScripts = Object.keys(scripts).filter((n) => re.test(scripts[n]));
    check(inSrc.length === 0 && inScripts.length === 0, `(c) ${name} 참조 0 (src ${JSON.stringify(inSrc)} · scripts ${JSON.stringify(inScripts)})`);
  }
  check(!("utils/mask-png.ts" in tree), "(c) utils/mask-png.ts 삭제 (워커가 자체 PNG 인코더)");
  for (const [rel, name] of KEPT) {
    check(
      new RegExp(`export (async )?(function|const|type|interface) ${name}\\b`).test(t(rel)),
      `(c) 보류 — ${rel} 의 export ${name} 은 그대로(이번 정리 대상 아님)`,
    );
  }

  // (d) NL 통합
  const nlDefs = Object.keys(tree).filter((rel) => /\bconst NL\b/.test(tree[rel]));
  check(count(all, "String.fromCharCode(10)") === 0, `(d) v2 에 String.fromCharCode(10) 0회 (${count(all, "String.fromCharCode(10)")})`);
  check(
    JSON.stringify(nlDefs) === '["pages/viewer/utils/text.ts"]' && t("pages/viewer/utils/text.ts").includes('export const NL = "\\n";'),
    `(d) NL 정의는 pages/viewer/utils/text.ts 한 곳 (${JSON.stringify(nlDefs)})`,
  );
  for (const [rel, imp] of Object.entries(NL_USERS)) check(t(rel).includes(imp), `(d) ${rel}: ${imp}`);
  const slice = t("pages/viewer/hooks/useSliceExport.ts");
  check(
    slice.includes("window.alert(`마스크 ZIP 내보내기에 실패했습니다.${NL}${msg}`);") &&
      slice.includes("window.alert(`G-code 내보내기에 실패했습니다.${NL}${msg}`);") &&
      !slice.includes("\\n"),
    "(d) useSliceExport: 실패 알림 두 곳도 ${NL} (파일에 \\n 리터럴 0 — 줄바꿈은 전부 NL)",
  );

  // (a) 콘솔 소음
  check(count(all, "[manifold] STL") === 0, "(a) [manifold] STL 측정 로그 0회");
  check(!t("components/babylon/hooks/useFileMeshSync.ts").includes("performance.now()"), "(a) useFileMeshSync: 측정용 t0(performance.now) 같이 제거");
  for (const [rel, n] of Object.entries(DEBUG_LOGS)) {
    const s = t(rel);
    check(count(s, "console.log(") === 0 && count(s, "console.debug(") === n, `(a) ${rel}: console.log 0 · console.debug ${count(s, "console.debug(")}/${n}`);
  }
  check(/console\.(log|debug)\(/.test(t("utils/dental/island-detection.ts")) && t("utils/dental/island-detection.ts").includes("debugLayers"), "(a) island-detection 의 debugLayers 게이트 로그는 그대로");

  // (b) 낡은 주석
  check(!t("utils/task0/task0-profile.ts").includes("화면 테두리") && t("utils/task0/task0-profile.ts").includes("화면 플레이트(출력 가능 영역)·배너"), "(b) task0-profile: '화면 테두리' → '화면 플레이트(출력 가능 영역)·배너'");
  const orange = Object.keys(tree).filter((rel) => tree[rel].includes("주황 테두리"));
  check(JSON.stringify(orange) === '["components/babylon/hooks/useBuildVolumeCheck.ts"]', `(b) '주황 테두리' 역사 언급은 useBuildVolumeCheck 한 곳 (${JSON.stringify(orange)})`);
  const loader = t("utils/stl-loader.ts");
  const i1 = loader.indexOf("  // 1) Babylon STL 로더가");
  const i2 = loader.indexOf("  // 2) 빌드플레이트에 정렬");
  const i3 = loader.indexOf("  // 3) Material");
  check(!loader.includes("  // 0) ") && i1 > 0 && i2 > i1 && i3 > i2, "(b) stl-loader 단계 주석 1) normal → 2) 정렬 → 3) Material (빈 단계 없음)");

  // (e) ViewerV2Page 분리
  const page = t("pages/ViewerV2Page.tsx");
  const lines = lineCount(page);
  check(lines <= 900, `(e) ViewerV2Page ${lines}줄 ≤ 900`);
  const early = page.indexOf("if (!projectId) {");
  const head = early > 0 ? page.slice(0, early) : "";
  const tail = early > 0 ? page.slice(early) : "";
  check(
    head.includes("const { loadFailed, handleStlLoadError } = useStlLoadFailures(files);") &&
      head.includes("useLegacySupportMigration({") &&
      head.includes("useEscapeDeselect({") &&
      !/\buse[A-Z]\w*\s*\(/.test(tail),
    "(e) 새 훅 3개(손상 STL·옛 마이그레이션·Esc)는 early return 위에서 호출, 아래에는 훅 호출 없음",
  );
  check(
    /<BuildVolumeBanner\s+volumeIssues=\{volumeIssues\}\s+printerProfile=\{printerProfile\}\s+onDropToPlate=\{handleDropToPlate\}\s*\/>/.test(page) &&
      !page.includes("task0HardIssue") && !page.includes("loadFailAlertedRef") && !page.includes("const toRevert") && !page.includes('addEventListener("keydown"'),
    "(e) 페이지: 배너는 <BuildVolumeBanner …/> 로, 옮긴 블록(손상 STL·마이그레이션·Esc·배너 갈래)의 본문은 페이지에 없음",
  );
  const loadFail = t("pages/viewer/hooks/useStlLoadFailures.ts");
  const mig = t("pages/viewer/hooks/useLegacySupportMigration.ts");
  const esc = t("pages/viewer/hooks/useEscapeDeselect.ts");
  const banner = t("pages/viewer/components/BuildVolumeBanner.tsx");
  check(
    loadFail.includes("if (loadFailAlertedRef.current.has(stlId)) return;") && loadFail.includes("return next ?? prev;") && loadFail.includes("}, [files]);"),
    "(e) useStlLoadFailures: 파일당 한 번 알림·삭제된 id 정리 effect 그대로",
  );
  check(
    mig.includes('(s) => s.coordSpace === "stl-local" && s.kind == null,') && mig.includes("}, 1500);") && mig.includes('coordSpace: "world",'),
    "(e) useLegacySupportMigration: kind 없는 옛 stl-local 점만 · 1.5s 뒤 world 로 patch 그대로",
  );
  check(
    esc.includes('if (e.key !== "Escape") return;') && esc.includes("if (profileDialogOpen) return;") &&
      esc.indexOf("if (pendingBridge) {") < esc.indexOf("if (selectedCp) {") && esc.indexOf("if (selectedCp) {") < esc.indexOf("if (selectedSupportId) {") &&
      esc.indexOf("if (selectedSupportId) {") < esc.indexOf("if (selectedIds.size > 0) {"),
    "(e) useEscapeDeselect: 다이얼로그·입력칸 가드 + 해제 순서(Bridge pending → 변곡점 → 서포트 → STL) 그대로",
  );
  check(
    banner.includes("if (volumeIssues.length === 0) return null;") && banner.includes("isTask0HardViolation(it.violation)") &&
      /onClick=\{onDropToPlate\}/.test(banner),
    "(e) BuildVolumeBanner: 항목 없으면 그리지 않음 · Task0 갈래 판정 · 올리기 버튼",
  );

  // 사고 방지 4차(소) ① 여러 모델 생성 — 라우팅 뒤·저장 앞 존재 확인
  const dental = t("pages/viewer/hooks/useDentalWorkflow.ts");
  const gen = between(dental, "const handleGenerateRedesignSupports = useCallback(", "\n  }, [");
  const iRoute = gen.indexOf("routeAndFinalizeRedesignPoints(");
  const iAlive = gen.indexOf("if (routed?.ok && !filesRef.current.some((f) => f.id === target.stlId)) {");
  const iSkip = gen.indexOf('return { ok: false, reason: "삭제됨 — 서포트를 저장하지 않았습니다." };', iAlive);
  const iSave = gen.indexOf("save: (points) =>");
  check(
    iRoute > 0 && iAlive > iRoute && iSkip > iAlive && iSave > iSkip && dental.includes("const filesRef = useRef(files);\n  filesRef.current = files;"),
    "① 재설계 생성: 라우팅 뒤·save 앞에서 최신 filesRef 로 모델 존재 확인 — 없으면 rejected(삭제됨)로 건너뜀",
  );
  // ② Ctrl+X
  const clip = t("pages/viewer/hooks/useClipboardActions.ts");
  const cut = between(clip, "export async function cutModels(", "export function useClipboardActions(");
  const iConf = cut.indexOf("if (!confirmDeleteModels(toCut.map((f) => f.fileName))) return false;");
  const iSet = cut.indexOf(".set(toCut.map(");
  const iRemove = cut.indexOf("await removeStlFile(f.id);");
  const handleCut = between(clip, "const handleCut = useCallback(", "const handlePaste");
  check(
    iConf > 0 && iSet > iConf && iRemove > iConf && handleCut.includes("await cutModels(") && !handleCut.includes(".set(") && !handleCut.includes("removeStlFile(f.id)"),
    "② Ctrl+X: cutModels 에서 confirmDeleteModels( 가 클립보드 담기·삭제보다 먼저, handleCut 은 cutModels 만 부름",
  );
  // ③ 손상 전부 문구
  const enter = between(page, "const enterSliceMode = () => {", "const exitSliceMode");
  const iGuard = enter.indexOf("if ((filesLoading || files.length > 0) && top <= 0) {");
  const iAlert = enter.indexOf("window.alert(", iGuard);
  const iAll = enter.indexOf("!filesLoading && isEveryModelLoadFailed(files, loadFailed)", iAlert);
  const iMsg = enter.indexOf('"불러온 모델이 전부 손상돼 슬라이스할 것이 없습니다. 목록에서 지워 주세요."', iAll);
  const iOld = enter.indexOf("모델을 아직 불러오는 중이거나 모델이 전부 플레이트 아래에 있어 슬라이스할 층이 없습니다.", iMsg);
  const iRet = enter.indexOf("return;", iOld);
  check(
    iGuard > 0 && iAlert > iGuard && iAll > iAlert && iMsg > iAll && iOld > iMsg && iRet > iOld,
    "③ 슬라이스 진입 가드: 전부 손상이면 '전부 손상돼 … 목록에서 지워 주세요', 아니면 종전 문구 (같은 alert·return)",
  );
  // ④ 카메라 중심
  const cam = t("components/babylon/handle/camera-handle.ts");
  check(
    count(cam, "resetCameraOnPlate(") === 1 && count(cam, "resetOnPlate(camera);") === 3 && count(cam, "ctx.plateWRef.current") === 1 &&
      cam.includes("ctx.printableAreaRef.current,") && cam.includes("resetCameraOnPlate(camera, f.widthMm, f.depthMm, f.center);"),
    "④ camera-handle: fit·fitSelection·viewPlate 의 빈 씬 리셋이 전부 resetOnPlate(영역 미러 ref → emptySceneCameraFrame) 경유",
  );
  const refs = t("components/babylon/scene-refs.ts");
  check(
    refs.includes("printableAreaRef: MutableRefObject<PrintableAreaMm | null>;") &&
      refs.includes("printableAreaRef.current = props.printableAreaMm ?? null;") &&
      /\n    printableAreaRef,\n/.test(refs) &&
      /\n    onStlLoadErrorRef,\n  \};/.test(refs),
    "④ scene-refs: printableAreaRef 미러(타입·매 렌더 대입·반환) — onStlLoadErrorRef 는 여전히 반환 끝(verify-safety3 불변)",
  );
  return res;
}

console.log("\n(2) 소스 검사");
const TREE = readTree();
const SCRIPTS = readScripts();
assertAll(sourceChecks(TREE, SCRIPTS));

console.log("\n(2') 소스 대조군 — 핵심 문자열을 지우거나 뒤집은 판이 실제로 실패하는가");
function sourceControl(label, rel, mutations) {
  let text = TREE[rel];
  if (text === undefined && mutations.length === 1 && mutations[0][0] === null) text = "";
  for (const [from, to] of mutations) {
    if (from === null) {
      text = to;
      continue;
    }
    if (text === undefined || !text.includes(from)) {
      assert(false, `[대조군] ${label} — 변조 대상 없음 ${rel} — ${JSON.stringify(String(from).slice(0, 60))}`);
      return;
    }
    text = text.replace(from, () => to);
  }
  assertControl(sourceChecks({ ...TREE, [rel]: text }, SCRIPTS), label);
}
sourceControl("(c) 삭제한 동기 검출 경로 되살림", "components/babylon/redesign-detect-actions.ts", [
  ["export function renderRedesignPoints(", "export function runRedesignDetect(): void {}\n\nexport function renderRedesignPoints("],
]);
sourceControl("(c) mask-png.ts 되살림", "utils/mask-png.ts", [[null, "export async function maskToPngBlob(): Promise<Uint8Array> { return new Uint8Array(); }\n"]]);
sourceControl("(c) 보류분(지현규 확인 전) 삭제", "utils/dental/dental-support.ts", [["export function createMarginLines(", "function createMarginLinesRemoved("]]);
sourceControl("(d) useSliceExport 로컬 NL 되살림(종전)", "pages/viewer/hooks/useSliceExport.ts", [['import { NL } from "../utils/text";', "const NL = String.fromCharCode(10);"]]);
sourceControl("(d) 실패 알림 \\n 리터럴 되살림", "pages/viewer/hooks/useSliceExport.ts", [["G-code 내보내기에 실패했습니다.${NL}${msg}", "G-code 내보내기에 실패했습니다.\\n${msg}"]]);
sourceControl("(a) [manifold] 측정 로그 되살림", "components/babylon/hooks/useFileMeshSync.ts", [
  ["ctx.stlManifoldMapRef.current.set(f.id, man);", "ctx.stlManifoldMapRef.current.set(f.id, man);\n              console.log(`[manifold] STL ${f.fileName}`);"],
]);
sourceControl("(a) dental-floodfill console.log 되살림", "components/babylon/dental-floodfill.ts", [["console.debug(", "console.log("]]);
sourceControl("(b) 주황 테두리 역사 언급 되살림", "components/BabylonScene.tsx", [
  ["    //   Z2: Task0 출력 가능 영역·서포트 신호는 인자만 추가 — 훅 호출 순서는 그대로.\n", "    //   Z2: Task0 출력 가능 영역·서포트 신호는 인자만 추가 — 훅 호출 순서는 그대로.\n    //   (영역 주황 테두리는 삭제)\n"],
]);
sourceControl("(e) 페이지 900줄 초과", "pages/ViewerV2Page.tsx", [["export default ViewerV2Page;", "\n".repeat(10) + "export default ViewerV2Page;"]]);
sourceControl("(e) 손상 STL 훅 미호출(페이지에 로컬 값)", "pages/ViewerV2Page.tsx", [["useStlLoadFailures(files);", "{ loadFailed: new Map<string, string>(), handleStlLoadError: () => {} };"]]);
sourceControl("(e) Esc 훅 미호출", "pages/ViewerV2Page.tsx", [["  useEscapeDeselect({", "  void ({"]]);
sourceControl("(e) 배너를 페이지 JSX 로 되돌림(task0HardIssue 페이지에)", "pages/ViewerV2Page.tsx", [["  return (\n    <div", "  const task0HardIssue = false;\n  return (\n    <div"]]);
sourceControl("(e) 마이그레이션 대상에 재설계 점까지(B-2 회귀)", "pages/viewer/hooks/useLegacySupportMigration.ts", [['(s) => s.coordSpace === "stl-local" && s.kind == null,', '(s) => s.coordSpace === "stl-local",']]);
sourceControl("① 저장 전 존재 확인 제거(종전)", "pages/viewer/hooks/useDentalWorkflow.ts", [["if (routed?.ok && !filesRef.current.some((f) => f.id === target.stlId)) {", "if (false) {"]]);
sourceControl("① 존재 확인이 시작 시점 files(클로저) — 최신 ref 아님", "pages/viewer/hooks/useDentalWorkflow.ts", [["!filesRef.current.some((f) => f.id === target.stlId)", "!files.some((f) => f.id === target.stlId)"]]);
sourceControl("② Ctrl+X 확인 제거(종전)", "pages/viewer/hooks/useClipboardActions.ts", [[CONFIRM_LINE, ""]]);
sourceControl("② handleCut 이 cutModels 를 안 거침", "pages/viewer/hooks/useClipboardActions.ts", [["    await cutModels(\n", "    await removeStlFile(f.id);\n    void (\n"]]);
sourceControl("③ 손상 전부 문구 분기 제거(종전)", "pages/ViewerV2Page.tsx", [["!filesLoading && isEveryModelLoadFailed(files, loadFailed)", "false"]]);
sourceControl("④ viewPlate 가 plate·원점(종전)", "components/babylon/handle/camera-handle.ts", [
  ["      resetOnPlate(camera);\n    },\n    previewTransform", "      resetCameraOnPlate(camera, ctx.plateWRef.current, ctx.plateDRef.current);\n    },\n    previewTransform"],
]);
sourceControl("④ scene-refs 미러 줄 누락(옛 영역 고착)", "components/babylon/scene-refs.ts", [["  printableAreaRef.current = props.printableAreaMm ?? null;\n", ""]]);

engine.dispose();
rmSync(TMP_ROOT, { recursive: true, force: true });
console.log(failed === 0 ? "\n=== 전부 PASS ===" : `\n=== FAIL ${failed}건 ===`);
process.exit(failed === 0 ? 0 : 1);
