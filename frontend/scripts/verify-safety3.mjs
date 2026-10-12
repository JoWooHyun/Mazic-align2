// 데모 사고 방지 3차 헤드리스 검증 — ① Delete confirm · ② C11 워커 취소 · ③ 슬라이스 진입 가드·층수 재계산
//   · ④ 자동 생성 busy 선표시 · ⑤ C5 손상 STL 알림 · ⑥ C4 다중 드롭 갱신 1회 · ⑦ undo allSettled·TransformPanel memo
//   · ⑧ 재료 이름 레이스(프로젝트 갱신 낙관 반영) · R-2(b) handlePick useCallback.
//
//   실행: npx tsx scripts/verify-safety3.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "실패 재현" 문자열을 낸다.
//
//   (1) 기능 검사 — 새 순수 모듈을 실제로 불러 돌린다:
//       addStlFilesSequential(⑥) · settleAll(⑦) · awaitPaint·runWithBusy(④, 가짜 rAF·setTimeout 으로 순서 확인)
//       · confirmDeleteModels(①, 가짜 window.confirm 으로 문구 확인).
//   (2) 배선 소스 검사 — 훅·컴포넌트는 React 없이 돌릴 수 없어 소스로 본다(verify-support-follow·verify-safety2 관례).
//   (3) ★ 대조군 원칙(프로젝트 규약): 기능 모듈은 임시 폴더 복사본의 한 곳을 변조해 같은 검사에 넣고, 소스 검사는
//       핵심 문자열을 지우거나 뒤집은 판을 넣어 **실제로 실패하는지** 확인한다. 변조 대상 문자열이 소스에 없으면
//       그 자체를 FAIL 로 센다(변조 안 된 채 통과하는 공허한 PASS 방지).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const V2 = join(__dirname, "..", "src", "features", "v2");
const NL = String.fromCharCode(10);

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
/** 묶음 결과 [{ok,label}] 를 그대로 단언으로 출력. */
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

const readV2 = (rel) => readFileSync(join(V2, rel), "utf8").replace(/\r\n/g, "\n");
const count = (s, sub) => s.split(sub).length - 1;
/** a 부터 그 뒤 첫 b 앞까지 (b 가 없으면 끝까지). a 가 없으면 "". */
function between(s, a, b) {
  const i = s.indexOf(a);
  if (i < 0) return "";
  const j = b ? s.indexOf(b, i + a.length) : -1;
  return s.slice(i, j > 0 ? j : s.length);
}
/** 주석 제거 — 주석에 든 함수 이름이 검사를 속이지 않게 (verify-support-follow 와 같은 식). */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ── 변조판(대조군) 생성 — 순수 모듈(외부 import 없음)만 임시 폴더로 복사 ──────────
const TMP_ROOT = mkdtempSync(join(tmpdir(), "verify-safety3-"));
process.on("exit", () => rmSync(TMP_ROOT, { recursive: true, force: true }));
let mutantSeq = 0;
/** rel 파일을 임시 폴더에 복사하면서 from → to 로 한 곳 바꾸고 import. 대상 문자열이 없으면 null. */
async function loadMutant(rel, mutations) {
  let text = readV2(rel);
  for (const [from, to] of mutations) {
    if (!text.includes(from)) return null;
    text = text.replace(from, to);
  }
  const out = join(TMP_ROOT, `m${mutantSeq++}`, rel.split("/").pop());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  return import(pathToFileURL(out).href);
}
async function functionalControl(label, rel, mutations, suite) {
  const mod = await loadMutant(rel, mutations);
  if (!mod) {
    // 변조 대상 문자열이 소스에 없으면 대조군이 아무것도 검사하지 못한 것 — 그 자체를 FAIL 로 센다(공허한 PASS 방지).
    assert(false, `[대조군] ${label} — 변조 대상 없음 ${rel}`);
    return;
  }
  let results;
  try {
    results = await suite(mod);
  } catch (e) {
    // 변조판이 검사 도중 예외로 무너진 것도 실패 재현으로 센다.
    results = [{ ok: false, label: `검사 도중 예외: ${e?.message ?? e}` }];
  }
  assertControl(results, label);
}

const REL = {
  addMany: "utils/stl-add-many.ts",
  settle: "pages/viewer/utils/settle-all.ts",
  busy: "pages/viewer/utils/run-with-busy.ts",
  confirm: "pages/viewer/utils/confirm-delete-models.ts",
};
const realMod = async (rel) => import(pathToFileURL(join(V2, rel)).href);

// ═════════════════════════════════════════════════════════════════════════
// (1) 기능 검사
// ═════════════════════════════════════════════════════════════════════════

/** ⑥ addStlFilesSequential — 하나가 실패해도 나머지 저장, 순서 보존, 이름·사유 보존. */
async function suiteAddMany(mod) {
  const { res, check } = makeChecker();
  const calls = [];
  const create = async (fileName, blob) => {
    calls.push(fileName);
    await Promise.resolve();
    if (fileName === "b.stl") throw new Error("QuotaExceededError: 저장 공간 부족");
    return { id: `id-${fileName}`, fileName, size: blob.size };
  };
  const items = ["a.stl", "b.stl", "c.stl"].map((n, i) => ({
    fileName: n,
    blob: new Blob([new Uint8Array(i + 1)]),
  }));
  let r;
  try {
    r = await mod.addStlFilesSequential(create, items);
  } catch (e) {
    check(false, `⑥ addStlFilesSequential: 2번째 저장 실패에서 전체가 reject 됨 (${e?.message ?? e})`);
    return res;
  }
  check(
    JSON.stringify(calls) === JSON.stringify(["a.stl", "b.stl", "c.stl"]),
    `⑥ addStlFilesSequential: create 3회, 입력 순서 그대로 [${calls.join(", ")}]`,
  );
  check(
    r.created.length === 2 && r.created[0].fileName === "a.stl" && r.created[1].fileName === "c.stl" && r.created[1].size === 3,
    `⑥ 2번째가 실패해도 나머지 저장 — created ${r.created.length}개 [${r.created.map((c) => c.fileName).join(", ")}]`,
  );
  check(
    r.failed.length === 1 && r.failed[0].fileName === "b.stl" && r.failed[0].message === "QuotaExceededError: 저장 공간 부족",
    `⑥ failed 1건 — 이름·사유 보존 (${JSON.stringify(r.failed)})`,
  );
  const blob = new Blob([new Uint8Array(1)]);
  const r2 = await mod.addStlFilesSequential(
    async (n) => {
      if (n === "x.stl") throw "문자열 사유";
      return n;
    },
    [
      { fileName: "x.stl", blob },
      { fileName: "y.stl", blob },
    ],
  );
  check(
    r2.failed[0]?.message === "문자열 사유" && r2.created.join() === "y.stl",
    "⑥ Error 가 아닌 reject 도 사유 문자열로 보존",
  );
  const r3 = await mod.addStlFilesSequential(create, []);
  check(r3.created.length === 0 && r3.failed.length === 0 && calls.length === 3, "⑥ 빈 입력 → 빈 결과, create 호출 없음");
  return res;
}

/** ⑦ settleAll — 하나가 reject 돼도 resolve, 반환 = 실패 건수, 나머지 부수효과 전부 실행, 경고 1건. */
async function suiteSettle(mod) {
  const { res, check } = makeChecker();
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" "));
  try {
    const done = [];
    const p1 = (async () => {
      await Promise.resolve();
      done.push("p1");
    })();
    const p2 = (async () => {
      await Promise.resolve();
      throw new Error("support not found: s2");
    })();
    const p3 = new Promise((resolve) =>
      setTimeout(() => {
        done.push("p3");
        resolve("ok");
      }, 20),
    );
    let n;
    let threw = null;
    try {
      n = await mod.settleAll("transform:undo", [p1, p2, p3]);
    } catch (e) {
      threw = e;
    }
    check(threw === null, `⑦ settleAll: 하나가 reject 돼도 resolve (${threw ? `reject: ${threw.message}` : "resolve"})`);
    check(n === 1, `⑦ 반환값 = 실패 건수 1 (${n})`);
    check(
      done.includes("p1") && done.includes("p3"),
      `⑦ 늦게 끝나는 저장까지 전부 기다린 뒤 끝남 [${done.join(", ")}]`,
    );
    check(
      warns.length === 1 && warns[0].includes("transform:undo") && warns[0].includes("support not found"),
      `⑦ 실패는 console.warn 1건(라벨·사유) — ${warns.length}건`,
    );
    const n0 = await mod.settleAll("x", [Promise.resolve(1), Promise.resolve(2)]);
    check(n0 === 0 && warns.length === 1, "⑦ 전부 성공 → 0, 경고 없음");
    const nEmpty = await mod.settleAll("x", []);
    check(nEmpty === 0, "⑦ 빈 목록 → 0");
  } finally {
    console.warn = origWarn;
  }
  return res;
}

/** ④ awaitPaint·runWithBusy — rAF → setTimeout(0) → 작업 순서, busy true → false (가짜 타이머). */
async function suitePaint(mod) {
  const { res, check } = makeChecker();
  const hadRaf = "requestAnimationFrame" in globalThis;
  const origRaf = globalThis.requestAnimationFrame;
  const origSetTimeout = globalThis.setTimeout;
  const log = [];
  const rafQ = [];
  const timeoutQ = [];
  globalThis.requestAnimationFrame = (cb) => {
    log.push("raf");
    rafQ.push(cb);
    return rafQ.length;
  };
  globalThis.setTimeout = (cb, ms) => {
    log.push(`timeout(${ms ?? 0})`);
    timeoutQ.push(cb);
    return timeoutQ.length;
  };
  const flush = (q) => {
    for (const cb of q.splice(0)) {
      try {
        cb(0);
      } catch (e) {
        log.push(`throw:${e.message}`);
      }
    }
  };
  const drain = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  try {
    // awaitPaint
    let resolved = false;
    const p = mod.awaitPaint().then(() => {
      resolved = true;
      log.push("resolved");
    });
    await drain();
    check(!resolved && log.join() === "raf", `④ awaitPaint: 호출 직후엔 다음 프레임(rAF)만 예약 — 아직 안 끝남 [${log.join(", ")}]`);
    flush(rafQ);
    await drain();
    check(
      !resolved && log.join() === "raf,timeout(0)",
      `④ awaitPaint: 프레임 콜백 안에서 setTimeout(0) — 아직 안 끝남 [${log.join(", ")}]`,
    );
    flush(timeoutQ);
    await drain();
    await p;
    check(resolved && log.join() === "raf,timeout(0),resolved", `④ awaitPaint: setTimeout 뒤에 resolve [${log.join(", ")}]`);

    // runWithBusy
    log.length = 0;
    mod.runWithBusy(
      (v) => log.push(`busy:${v}`),
      () => log.push("work"),
    );
    check(log.join() === "busy:true,raf", `④ runWithBusy: busy true 먼저, 작업은 아직 [${log.join(", ")}]`);
    flush(rafQ);
    check(log.join() === "busy:true,raf,timeout(0)", `④ runWithBusy: 프레임 뒤 setTimeout(0), 작업은 아직 [${log.join(", ")}]`);
    flush(timeoutQ);
    check(
      log.join() === "busy:true,raf,timeout(0),work,busy:false",
      `④ runWithBusy: 작업 → busy false [${log.join(", ")}]`,
    );
    log.length = 0;
    try {
      mod.runWithBusy(
        (v) => log.push(`busy:${v}`),
        () => {
          throw new Error("검출 실패");
        },
      );
    } catch (e) {
      // 동기로 던지면(프레임 양보 없음) 여기로 온다 — 순서 문자열에 남겨 아래 단언이 잡게 한다.
      log.push(`throw:${e.message}`);
    }
    flush(rafQ);
    flush(timeoutQ);
    check(
      log.join() === "busy:true,raf,timeout(0),busy:false,throw:검출 실패",
      `④ runWithBusy: 작업이 던져도 busy false (finally) [${log.join(", ")}]`,
    );
  } finally {
    globalThis.setTimeout = origSetTimeout;
    if (hadRaf) globalThis.requestAnimationFrame = origRaf;
    else delete globalThis.requestAnimationFrame;
  }
  return res;
}

/** ① confirmDeleteModels — 문구(1개·2개·4개), 0개 false(묻지 않음), 취소 → false. */
async function suiteConfirm(mod) {
  const { res, check } = makeChecker();
  const hadWindow = "window" in globalThis;
  const origWindow = globalThis.window;
  const asked = [];
  let answer = true;
  globalThis.window = {
    confirm: (m) => {
      asked.push(m);
      return answer;
    },
  };
  const TAIL = "모델 위 서포트도 함께 지워지며 되돌릴 수 없습니다.";
  try {
    check(mod.confirmDeleteModels([]) === false && asked.length === 0, "① 0개 → 묻지 않고 false");
    const ok1 = mod.confirmDeleteModels(["crown.stl"]);
    check(
      ok1 === true && asked[0] === `"crown.stl" 을(를) 삭제할까요?${NL}${TAIL}`,
      `① 1개 문구: ${JSON.stringify(asked[0])}`,
    );
    const ok4 = mod.confirmDeleteModels(["a.stl", "b.stl", "c.stl", "d.stl"]);
    const expect4 = ["모델 4개를 삭제할까요?", "· a.stl", "· b.stl", "· c.stl", "· 외 1개", TAIL].join(NL);
    check(ok4 === true && asked[1] === expect4, `① 4개 문구(이름 3줄 + "외 1개"): ${JSON.stringify(asked[1])}`);
    mod.confirmDeleteModels(["a.stl", "b.stl"]);
    check(
      asked[2] === ["모델 2개를 삭제할까요?", "· a.stl", "· b.stl", TAIL].join(NL),
      `① 2개 문구(이름 2줄, "외" 없음): ${JSON.stringify(asked[2])}`,
    );
    answer = false;
    check(mod.confirmDeleteModels(["a.stl"]) === false && asked.length === 4, "① 확인 창에서 취소 → false");
  } finally {
    if (hadWindow) globalThis.window = origWindow;
    else delete globalThis.window;
  }
  return res;
}

console.log("\n(1) 기능 검사 — 새 순수 모듈 실제 실행");
assertAll(await suiteAddMany(await realMod(REL.addMany)));
assertAll(await suiteSettle(await realMod(REL.settle)));
assertAll(await suitePaint(await realMod(REL.busy)));
assertAll(await suiteConfirm(await realMod(REL.confirm)));

console.log("\n(1') 기능 대조군 — 변조판이 실제로 실패하는가");
await functionalControl(
  "⑥ 하나가 실패하면 전체 중단(종전 루프처럼 예외 전파)",
  REL.addMany,
  [["    } catch (e) {\n      failed.push({", "    } catch (e) {\n      throw e;\n      failed.push({"]],
  suiteAddMany,
);
await functionalControl(
  "⑦ settleAll 을 Promise.all 로 되돌림(종전)",
  REL.settle,
  [["await Promise.allSettled(promises);", "await Promise.all(promises);"]],
  suiteSettle,
);
await functionalControl(
  "④ awaitPaint 가 페인트를 기다리지 않고 바로 resolve",
  REL.busy,
  [["    requestAnimationFrame(() => {\n      setTimeout(() => resolve(), 0);\n    });\n", "    resolve();\n"]],
  suitePaint,
);
await functionalControl(
  "④ runWithBusy 가 프레임 양보 없이 동기 실행(수정 전 자동 생성처럼)",
  REL.busy,
  [
    [
      "  requestAnimationFrame(() => {\n    setTimeout(() => {\n      try {\n        work();\n      } finally {\n        setBusy(false);\n      }\n    }, 0);\n  });\n",
      "  try {\n    work();\n  } finally {\n    setBusy(false);\n  }\n",
    ],
  ],
  suitePaint,
);
await functionalControl(
  "① 4개 이상일 때 \"외 k개\" 줄 누락",
  REL.confirm,
  [["  if (names.length > 3) lines.push(`· 외 ${names.length - 3}개`);\n", ""]],
  suiteConfirm,
);
await functionalControl(
  "① 0개 가드 없음(빈 선택에도 확인 창)",
  REL.confirm,
  [["  if (names.length === 0) return false;\n", ""]],
  suiteConfirm,
);

// ═════════════════════════════════════════════════════════════════════════
// (2) 배선 소스 검사
// ═════════════════════════════════════════════════════════════════════════

const WIRE = {
  sup: "pages/viewer/hooks/useSupportEditing.ts",
  list: "components/StlFileList.tsx",
  slice: "pages/viewer/hooks/useSliceExport.ts",
  page: "pages/ViewerV2Page.tsx",
  fileMesh: "components/babylon/hooks/useFileMeshSync.ts",
  refs: "components/babylon/scene-refs.ts",
  types: "components/babylon/babylon-scene-types.ts",
  scene: "components/BabylonScene.tsx",
  transform: "pages/viewer/hooks/useTransformCommit.ts",
  stlHook: "hooks/useStlFilesV2.ts",
  drop: "pages/viewer/hooks/useStlDropImport.ts",
  proj: "hooks/useProjectsV2.ts",
  dental: "pages/viewer/hooks/useDentalWorkflow.ts",
};

// BabylonScene 훅 호출 순서 (불변식 1 — verify-support-follow·verify-model-size 와 같은 목록).
const EXPECTED_SCENE_HOOKS = [
  "useSceneRefs", "useSupportPartsReady", "useSceneBootstrap", "useState", "useFileMeshSync",
  "useSupportMeshSync", "useSelectionSync", "useSlicePreview", "useBridgeVisualization",
  "useEditModeSync", "useDentalBrush", "useBuildVolumeCheck", "useAlignFloorHover", "useImperativeHandle",
];

function wiringChecks(raw) {
  const { res, check } = makeChecker();
  const t = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, strip(v)]));

  // ① Delete 키·컨텍스트 메뉴·툴바 삭제 = handleDeleteSelectedSupport 의 Select 분기
  const del = between(t.sup, "const handleDeleteSelectedSupport = useCallback(", "const handleDuplicateSelected");
  const supBranch = between(del, 'if (editMode === "support") {', 'if (editMode === "select"');
  const selBranch = between(del, 'if (editMode === "select" && selectedIds.size > 0) {', "\n  }, [");
  const iConf = selBranch.indexOf("if (!confirmDeleteModels(names)) return;");
  const iClear = selBranch.indexOf("setSelectedIds(new Set());");
  const iRemove = selBranch.indexOf("removeStlFile(");
  check(
    iConf > 0 && iClear > iConf && iRemove > iConf,
    "① useSupportEditing Select 분기: confirmDeleteModels( 가 선택 해제·removeStlFile( 보다 먼저 (취소 → 선택 유지·삭제 없음)",
  );
  check(supBranch !== "" && !supBranch.includes("confirmDeleteModels("), "① Support 모드(서포트·변곡점 삭제)는 확인 없음 — 종전 그대로");
  check(/\bfiles,/.test(between(del, "\n  }, [", "]);")), "① 규칙 7: handleDeleteSelectedSupport deps 에 files(확인 문구의 모델 이름)");
  check(!t.sup.includes("window.confirm("), "① useSupportEditing 에 window.confirm 직접 호출 없음(헬퍼 한 곳)");
  check(
    t.list.includes("if (confirmDeleteModels([f.fileName])) {") && !t.list.includes("confirm(`"),
    "① StlFileList × 버튼: confirmDeleteModels([이름]) — 옛 confirm(`…`) 문구 없음",
  );

  // ② C11
  const cleanup = t.slice.match(/useEffect\(\(\) => \(\) => \{\s*sliceBatchService\.cancel\(\);\s*\}, \[\]\);/);
  check(
    cleanup !== null && t.slice.indexOf(cleanup[0]) < t.slice.indexOf("const confirmIfOutOfBounds"),
    "② useSliceExport: 언마운트 cleanup 에 sliceBatchService.cancel() (내보내기 핸들러 검사 구간 밖)",
  );
  check(count(t.slice, 'if (e instanceof Error && e.name === "CancelError") return;') === 4, "② 네 내보내기 핸들러의 CancelError 무음 처리 그대로");

  // ③ 슬라이스 진입 가드 + 층수 재계산
  check(
    /useEffect\(\(\) => \{\s*if \(!slicePreview\.on\) return;\s*const top = sceneHandleRef\.current\?\.getSceneTopY\(\);\s*if \(top != null\) setSceneTopY\(top\);\s*\}, \[meshLoadTick, slicePreview\.on, sceneHandleRef\]\);/.test(t.slice) &&
      t.slice.includes("meshLoadTick?: number;"),
    "③ useSliceExport: 미리보기 중 meshLoadTick 마다 getSceneTopY 재계산",
  );
  const early = t.page.indexOf("if (!projectId) {");
  const head = early > 0 ? t.page.slice(0, early) : "";
  const tail = early > 0 ? t.page.slice(early) : "";
  const enter = between(t.page, "const enterSliceMode = () => {", "const exitSliceMode");
  const iGuard = enter.indexOf("if ((filesLoading || files.length > 0) && top <= 0) {");
  const iAlert = enter.indexOf("window.alert(", iGuard);
  const iRet = enter.indexOf("return;", iGuard);
  const iSet = enter.indexOf("setSceneTopY(top);");
  check(
    iGuard > 0 && iAlert > iGuard && iRet > iAlert && iSet > iRet,
    "③ enterSliceMode: 모델이 있는데 top <= 0 이면 alert 후 진입 안 함 (setSceneTopY 앞)",
  );
  check(
    /onMeshesLoaded=\{\(\) => setMeshLoadTick\(\(n\) => n \+ 1\)\}/.test(t.page) &&
      /useSliceExport\(\{[^}]*\bmeshLoadTick,\s*\}\);/.test(t.page) &&
      head.indexOf("const [meshLoadTick, setMeshLoadTick] = useState(0);") >= 0 &&
      head.indexOf("const [meshLoadTick, setMeshLoadTick] = useState(0);") < head.indexOf("useSliceExport({"),
    "③ ViewerV2Page: onMeshesLoaded → meshLoadTick(useSliceExport 위) → useSliceExport",
  );
  check(
    /useFileMeshSync\(ctx, files, overhangAngleDeg, \(\) => \{\s*setMeshLoadTick\(\(n\) => n \+ 1\);\s*onMeshesLoaded\?\.\(\);\s*\}\);/.test(t.scene),
    "③ BabylonScene: 로드 완료 콜백 안에서 onMeshesLoaded?.()",
  );
  const bodyAt = t.scene.indexOf("function BabylonScene(");
  const calls = bodyAt >= 0 ? [...t.scene.slice(bodyAt).matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]) : [];
  check(JSON.stringify(calls) === JSON.stringify(EXPECTED_SCENE_HOOKS), `③ BabylonScene 훅 호출 순서·개수 무변경 (${calls.length}개)`);
  check(
    t.types.includes("onMeshesLoaded?: () => void;") &&
      t.types.includes("onStlLoadError?: (stlId: string, fileName: string, message: string) => void;"),
    "③⑤ BabylonSceneProps 선택 prop 2개(onMeshesLoaded·onStlLoadError)",
  );

  // ④ 자동 생성 busy 선표시
  const auto = between(t.sup, "const handleAutoGenerate = useCallback(", "\n  }, [");
  const iBusy = auto.indexOf("setAutoBusy(true);");
  const iPaint = auto.indexOf("await awaitPaint();");
  const iGen = auto.indexOf("generateAutoSupports(");
  check(iBusy > 0 && iPaint > iBusy && iGen > iPaint, "④ 자동 생성: setAutoBusy(true) → await awaitPaint() → generateAutoSupports( 순서");
  check(
    t.dental.includes('import { runWithBusy } from "../utils/run-with-busy";') &&
      !/function runWithBusy\(/.test(t.dental) &&
      count(t.dental, "runWithBusy(") === 2,
    "④ useDentalWorkflow: run-with-busy 의 runWithBusy 사용(로컬 정의 없음), 호출 2곳 그대로",
  );

  // ⑤ C5 손상 STL
  check(
    /catch \(e\) \{[\s\S]*?if \(!cancelled\) \{\s*ctx\.onStlLoadErrorRef\.current\?\.\(\s*f\.id,\s*f\.fileName,\s*e instanceof Error \? e\.message : String\(e\),?\s*\);/.test(t.fileMesh),
    "⑤ useFileMeshSync 로드 catch: 취소가 아니면 onStlLoadErrorRef.current?.(id, 이름, 사유)",
  );
  check(
    t.refs.includes("const onStlLoadErrorRef = useRef(props.onStlLoadError);") &&
      t.refs.includes("onStlLoadErrorRef.current = props.onStlLoadError;") &&
      /\n    onStlLoadErrorRef,\n  \};/.test(t.refs) &&
      t.refs.includes('onStlLoadErrorRef: MutableRefObject<BabylonSceneProps["onStlLoadError"]>;'),
    "⑤ scene-refs: onStlLoadErrorRef 미러 2줄 + SceneCtx 필드·반환",
  );
  check(
    t.page.includes("onStlLoadError={handleStlLoadError}") && t.page.includes("loadFailed={loadFailed}"),
    "⑤ ViewerV2Page: BabylonScene onStlLoadError · StlFileList loadFailed 배선",
  );
  const handler = between(t.page, "const handleStlLoadError = useCallback(", "useEffect(");
  const iDedupe = handler.indexOf("if (loadFailAlertedRef.current.has(stlId)) return;");
  check(
    iDedupe > 0 && handler.indexOf("window.alert(") > iDedupe,
    "⑤ 로드 실패 알림은 파일당 한 번(files 가 바뀔 때마다의 재시도·재실패에 다시 알리지 않음)",
  );
  check(
    /for \(const id of prev\.keys\(\)\) \{\s*if \(ids\.has\(id\)\) continue;/.test(t.page) && t.page.includes("return next ?? prev;"),
    "⑤ 삭제된 파일은 손상 표시에서 빠짐(변화 없으면 같은 Map — 리렌더 없음)",
  );
  check(
    /loadFailed\?\.has\(f\.id\) && \(/.test(t.list) && t.list.includes("⚠ 손상") && t.list.includes("title={failMessage}"),
    "⑤ StlFileList: loadFailed 에 있으면 \"⚠ 손상\"(사유는 title)",
  );

  // ⑥ C4 다중 드롭
  const addMany = between(t.stlHook, "const addMany = useCallback(", "const remove = useCallback(");
  const iSeq = addMany.indexOf("addStlFilesSequential(");
  const iItems = addMany.indexOf("items,", iSeq);
  const iRefresh = addMany.indexOf("await refresh();");
  check(
    iSeq > 0 &&
      addMany.includes("(n, b) => repo.createStlFile(projectId, n, b),") &&
      count(addMany, "refresh()") === 1 &&
      iItems > iSeq &&
      iRefresh > iItems,
    "⑥ useStlFilesV2.addMany: addStlFilesSequential 로 전부 저장한 뒤 refresh() 1회(루프 밖)",
  );
  check(
    /\n    addMany,\n/.test(t.stlHook) &&
      t.stlHook.includes("const created = await repo.createStlFile(projectId, fileName, blob, init);\n      await refresh();\n      return created;"),
    "⑥ addMany 반환 + 기존 add(복제·붙여넣기·예제 경로) 그대로",
  );
  const native = between(t.drop, "const addNativeFiles = useCallback(", "const addSampleModel");
  check(
    /addStlFiles\(\s*stlFiles\.map\(\(f\) => \(\{ fileName: f\.name, blob: f \}\)\),?\s*\)/.test(native) &&
      count(native, "addStlFiles(") === 1 &&
      !native.includes("addStlFile(") &&
      native.includes("failed.map((it) => `· ${it.fileName} — ${it.message}`).join(NL)") &&
      native.includes("setSelectedIds(new Set(created.map((c) => c.id)))") &&
      /\[addStlFiles, setSelectedIds\]/.test(native),
    "⑥ useStlDropImport: addStlFiles 한 번, 실패는 한 알림에 모음, 성공분 전체 선택",
  );
  check(t.drop.includes("addStlFile(def.fileName, def.build())"), "⑥ 예제 경로는 종전 addStlFile 그대로");
  check(
    /useStlDropImport\(\{[^}]*\baddStlFiles\b[^}]*\}\)/.test(t.page) && t.page.includes("addMany: addStlFiles,"),
    "⑥ ViewerV2Page: useStlDropImport({ … addStlFiles … }) — useStlFilesV2 addMany",
  );

  // ⑦ undo allSettled + TransformPanel memo + R-2(b)
  check(
    count(t.transform, "Promise.all(") === 0 &&
      count(t.transform, "settleAll(") === 3 &&
      ["transform:commit", "transform:undo", "transform:redo"].every((l) => t.transform.includes(`"${l}"`)),
    `⑦ useTransformCommit: Promise.all( ${count(t.transform, "Promise.all(")}회 · settleAll( ${count(t.transform, "settleAll(")}회(커밋·undo·redo)`,
  );
  check(
    /const transformPanelSelected = useMemo\(\s*\(\) =>[\s\S]*?\[selectedFile\],?\s*\);/.test(head),
    "⑦ ViewerV2Page: transformPanelSelected = useMemo(…, [selectedFile]) — early return 위",
  );
  check(
    /const handlePick = useCallback\([\s\S]*?\[setSelectedIds\],?\s*\);/.test(head),
    "R-2(b) ViewerV2Page: handlePick = useCallback(…, [setSelectedIds]) — early return 위",
  );
  const hookDecls = [
    "const [meshLoadTick, setMeshLoadTick] = useState(0);",
    "const [loadFailed, setLoadFailed] = useState",
    "const handleStlLoadError = useCallback(",
    "const transformPanelSelected = useMemo(",
    "const handlePick = useCallback(",
  ];
  check(
    early > 0 && hookDecls.every((s) => head.includes(s)) && !/\buse[A-Z]\w*\s*\(/.test(tail),
    "⑦ ViewerV2Page: 새 훅 전부 early return(!projectId) 위 — 아래에는 훅 호출 없음(rules-of-hooks)",
  );

  // ⑧ 재료 이름 레이스 — 프로젝트 갱신 낙관 반영
  const upd = between(t.proj, "const update = useCallback(", "return { project");
  const iOpt = upd.indexOf("setProject((prev) => (prev ? { ...prev, ...patch } : prev));");
  const iSave = upd.indexOf("const next = await repo.updateProject(id, patch);");
  check(iOpt > 0 && iSave > iOpt, "⑧ useProjectV2.update: 저장(await repo.updateProject) 전에 setProject((prev) … patch) 낙관 반영");
  check(
    /catch \(e\) \{[\s\S]*?setProject\(\(await repo\.getProject\(id\)\) \?\? null\);[\s\S]*?throw e;/.test(upd),
    "⑧ 저장 실패 시 저장된 레코드로 되돌리고 원래 오류 재throw(부르는 쪽 알림 유지)",
  );
  return res;
}

console.log("\n(2) 배선 소스 검사");
const wireTexts = Object.fromEntries(Object.entries(WIRE).map(([k, rel]) => [k, readV2(rel)]));
assertAll(wiringChecks(wireTexts));

console.log("\n(2') 배선 대조군 — 핵심 문자열을 지우거나 뒤집은 판이 실제로 실패하는가");
function wireControl(label, key, from, to) {
  if (!wireTexts[key].includes(from)) {
    // 변조 대상 문자열이 소스에 없으면 대조군이 아무것도 검사하지 못한 것 — 그 자체를 FAIL 로 센다(공허한 PASS 방지).
    assert(false, `[대조군] ${label} — 변조 대상 없음 ${WIRE[key]} — ${JSON.stringify(from.slice(0, 60))}`);
    return;
  }
  assertControl(wiringChecks({ ...wireTexts, [key]: wireTexts[key].replace(from, to) }), label);
}
wireControl("① Select 분기 확인 제거(종전 — 확인 없이 삭제)", "sup", "      if (!confirmDeleteModels(names)) return;\n", "");
wireControl("① 확인을 선택 해제 뒤로(취소해도 선택이 풀림)", "sup",
  "      if (!confirmDeleteModels(names)) return;\n      setSelectedIds(new Set());\n",
  "      setSelectedIds(new Set());\n      if (!confirmDeleteModels(names)) return;\n");
wireControl("① deps 에서 files 누락(규칙 7)", "sup", "    files, // 사고 방지 3차 ① — 확인 문구의 모델 이름(규칙 7)\n", "");
wireControl("① 목록 × 버튼을 옛 confirm 문구로", "list", "if (confirmDeleteModels([f.fileName])) {", "if (confirm(`\"${f.fileName}\" 을(를) 삭제할까요?`)) {");
wireControl("② 언마운트 워커 취소 제거(종전)", "slice", "  useEffect(() => () => { sliceBatchService.cancel(); }, []);\n", "");
wireControl("③ 층수 재계산 deps 에서 meshLoadTick 누락", "slice", "}, [meshLoadTick, slicePreview.on, sceneHandleRef]);", "}, [slicePreview.on, sceneHandleRef]);");
wireControl("③ 슬라이스 진입 가드 제거(종전)", "page", "if ((filesLoading || files.length > 0) && top <= 0) {", "if (false) {");
wireControl("③ BabylonScene 이 onMeshesLoaded 를 부르지 않음", "scene", "      onMeshesLoaded?.();\n", "");
wireControl("③ BabylonScene 훅 하나 추가(불변식 1 위반)", "scene", "    const ctx = useSceneRefs(props);\n", "    const ctx = useSceneRefs(props);\n    useState(0);\n");
wireControl("④ 자동 생성이 페인트를 기다리지 않음(종전)", "sup", "      await awaitPaint();\n", "");
wireControl("④ useDentalWorkflow 에 로컬 runWithBusy 재정의", "dental",
  'import { runWithBusy } from "../utils/run-with-busy";',
  "function runWithBusy(setBusy: (v: boolean) => void, work: () => void): void { setBusy(true); work(); setBusy(false); }");
wireControl("⑤ 로드 실패를 부모에 알리지 않음(종전 console.error 만)", "fileMesh", "ctx.onStlLoadErrorRef.current?.(", "void (");
wireControl("⑤ 취소된 로드도 알림", "fileMesh", "if (!cancelled) {\n            ctx.onStlLoadErrorRef", "{\n            ctx.onStlLoadErrorRef");
wireControl("⑤ scene-refs 미러 줄 누락(옛 콜백 고착)", "refs", "  onStlLoadErrorRef.current = props.onStlLoadError;\n", "");
wireControl("⑤ 알림 중복 방지 제거(재시도마다 alert)", "page", "      if (loadFailAlertedRef.current.has(stlId)) return;\n", "");
wireControl("⑤ 목록에 손상 표시 없음", "page", "loadFailed={loadFailed}", "");
wireControl("⑥ refresh 를 저장 루프 안으로(파일마다 갱신 — 종전)", "stlHook",
  "        (n, b) => repo.createStlFile(projectId, n, b),\n        items,\n      );\n      await refresh();\n",
  "        async (n, b) => {\n          const c = await repo.createStlFile(projectId, n, b);\n          await refresh();\n          return c;\n        },\n        items,\n      );\n");
wireControl("⑥ 실패를 한 알림에 모으지 않음", "drop", "failed.map((it) => `· ${it.fileName} — ${it.message}`).join(NL)", "\"\"");
wireControl("⑥ 드롭이 addStlFiles 를 안 받음", "page", "useStlDropImport({ addStlFile, addStlFiles, setSelectedIds })", "useStlDropImport({ addStlFile, setSelectedIds })");
wireControl("⑦ undo 를 Promise.all 로 되돌림", "transform", 'settleAll(\n            "transform:undo",\n', "Promise.all(\n");
wireControl("⑦ transformPanelSelected 매 렌더 새 객체(종전)", "page", "const transformPanelSelected = useMemo(", "const transformPanelSelected = ((f: unknown) => f)(");
wireControl("R-2(b) handlePick 평범한 함수(종전)", "page", "const handlePick = useCallback(", "const handlePick = (");
wireControl("⑦ early return 아래에 훅 호출", "page", "  async function handleRemove(id: string) {", "  const lateHook = useMemo(() => 0, []);\n  async function handleRemove(id: string) {");
wireControl("⑧ 낙관 반영 제거(종전 — 저장 뒤에만 반영)", "proj", "      setProject((prev) => (prev ? { ...prev, ...patch } : prev));\n", "");
wireControl("⑧ 실패 시 원래 오류를 삼킴", "proj", "        throw e;\n", "");

rmSync(TMP_ROOT, { recursive: true, force: true });
console.log(failed === 0 ? "\n=== 전부 PASS ===" : `\n=== FAIL ${failed}건 ===`);
process.exit(failed === 0 ? 0 : 1);
