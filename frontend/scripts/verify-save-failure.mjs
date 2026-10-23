// C9 — 저장 실패가 호출 지점에서 조용히 묻히지 않는지 헤드리스 검증.
//
//   실행: npx tsx scripts/verify-save-failure.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md). 판정은 **exit code**.
//
//   (a) 헬퍼 단위 — pages/viewer/utils/save-failure.ts 를 불러 가짜 시계·알림으로 확인:
//       일반 오류 → 알림 1회 + 콘솔 / QuotaExceededError → 알림 0 + 콘솔 / 3 s 안 연속 실패 → 알림 1회 / 3 s 뒤 → 다시 알림
//       · 같은 오류 객체는 한 번만 보고 · withSaveReport 는 같은 오류를 다시 던짐 · 알림이 던져도 안 깨짐
//       + 기본 인스턴스 연결(settleAll 의 action 인자 · useUndoStore 의 되돌리기/다시 실행 실패 보고).
//   (b) 소스 정적 검사 — TypeScript AST 로 화면 쪽(pages/**, components/** 중 핵심 영역 제외)의 repo 쓰기 호출을 전부 찾아
//       각 호출이 (1) withSaveReport 인자 (2) .catch(reportSaveFailure) (3) catch 에 reportSaveFailure 가 있는 try
//       (4) action 인자가 있는 settleAll (5) 되돌리기/다시 실행 콜백(useUndoStore 가 보고) (6) 명시 예외(기존 처리) 중 하나로
//       이어지는지 확인한다. 처리 없는 호출이 0 이어야 한다. data 훅(hooks/use*V2.ts)은 reject 를 호출자에게 전파하는 계층이라 대상 밖.
//   (c) ★ 대조군 — 헬퍼의 quota 판정 제거 / 폭주 방지 제거 / 중복 보고 방지 제거, 쓰기 지점의 보고 제거(여러 형태)를
//       같은 검사에 넣어 **실제로 FAIL 하는지** 확인한다. 변조 대상 문자열이 소스에 없으면 그 자체가 FAIL(공허한 PASS 방지).

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const V2 = join(__dirname, "..", "src", "features", "v2");

let failed = 0;
function assert(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}
function assertAll(results) {
  for (const r of results) assert(r.ok, r.label);
}
function assertControl(results, label) {
  const bad = results.filter((r) => !r.ok);
  if (bad.length > 0) console.log(`  ok  [대조군] ${label} → 실패 재현: ${bad[0].label}`);
  else {
    failed++;
    console.error(`  FAIL [대조군] ${label} — 변조판이 모든 검사를 통과함(검사가 결함을 못 잡음)`);
  }
}
function makeChecker() {
  const res = [];
  return { res, check: (ok, label) => res.push({ ok: !!ok, label }) };
}

const HELPER_REL = "pages/viewer/utils/save-failure.ts";
const readV2 = (rel) => readFileSync(join(V2, rel), "utf8").replace(/\r\n/g, "\n");

/** 변조: from 이 소스에 정확히 1번 있어야 한다(없으면 공허한 대조군이므로 throw). */
function tamper(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`대조군 변조 대상이 ${n}번 나옴(1번이어야 함): ${label}`);
  return src.replace(from, to);
}

// ═════════════════════════════════════════════════════════════════════════
// (a) 헬퍼 단위
// ═════════════════════════════════════════════════════════════════════════
function makeEnv(mod) {
  const alerts = [];
  const logs = [];
  let t = 1_000_000;
  const env = {
    alerts,
    logs,
    advance: (ms) => {
      t += ms;
    },
    reporter: mod.createSaveFailureReporter({
      now: () => t,
      alert: (m) => alerts.push(m),
      logError: (...a) => logs.push(a),
    }),
  };
  return env;
}

async function helperChecks(mod) {
  const { res, check } = makeChecker();
  const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });

  // 일반 오류 → 알림 1 + 콘솔 1, 문구에 동작 이름·오류 이름
  {
    const e = makeEnv(mod);
    e.reporter.reportSaveFailure("서포트 추가", new Error("boom"));
    check(e.alerts.length === 1, `일반 오류: 알림 1회 (${e.alerts.length})`);
    check(e.logs.length === 1, `일반 오류: 콘솔 1회 (${e.logs.length})`);
    check(e.alerts[0]?.includes("서포트 추가") && e.alerts[0]?.includes("boom"), "알림 문구에 동작 이름·오류 메시지 포함");
    check(String(e.logs[0]?.[0]).includes("[저장 실패]"), "콘솔 접두 [저장 실패]");
  }
  // Quota → 알림 0 + 콘솔 1
  {
    const e = makeEnv(mod);
    e.reporter.reportSaveFailure("서포트 추가", quota);
    check(e.alerts.length === 0, `QuotaExceededError: 알림 0회 (${e.alerts.length})`);
    check(e.logs.length === 1, `QuotaExceededError: 콘솔 1회 (${e.logs.length})`);
    // Quota 가 먼저 와도 뒤따르는 일반 오류 알림은 막지 않는다(Quota 는 알림 시각을 갱신하지 않음)
    e.reporter.reportSaveFailure("모델 삭제", new Error("x"));
    check(e.alerts.length === 1, "Quota 뒤의 일반 오류는 알림 1회");
  }
  // 3 s 안 연속 실패 → 알림 1회, 3 s 뒤 → 다시 알림
  {
    const e = makeEnv(mod);
    for (let i = 0; i < 30; i++) {
      e.reporter.reportSaveFailure("서포트 삭제", new Error(`e${i}`));
      e.advance(50); // 30건 × 50 ms = 1.5 s
    }
    check(e.alerts.length === 1, `3 s 안 연속 30건: 알림 1회 (${e.alerts.length})`);
    check(e.logs.length === 30, `3 s 안 연속 30건: 콘솔 30회 (${e.logs.length})`);
    e.advance(3000);
    e.reporter.reportSaveFailure("서포트 삭제", new Error("late"));
    check(e.alerts.length === 2, `3 s 뒤 다시 알림 (${e.alerts.length})`);
  }
  // 같은 오류 객체 → 한 번만 보고
  {
    const e = makeEnv(mod);
    const err = new Error("once");
    e.reporter.reportSaveFailure("a", err);
    e.advance(10_000);
    e.reporter.reportSaveFailure("b", err);
    check(e.logs.length === 1 && e.alerts.length === 1, `같은 오류 객체 2회 보고 → 콘솔 1·알림 1 (${e.logs.length}/${e.alerts.length})`);
  }
  // withSaveReport — 같은 오류를 다시 던짐, 성공 값 통과
  {
    const e = makeEnv(mod);
    const err = new Error("rej");
    let caught = null;
    try {
      await e.reporter.withSaveReport("동작", Promise.reject(err));
    } catch (x) {
      caught = x;
    }
    check(caught === err, "withSaveReport: 같은 오류를 다시 던짐");
    check(e.alerts.length === 1 && e.logs.length === 1, "withSaveReport: 실패 시 보고 1회");
    const v = await e.reporter.withSaveReport("동작", Promise.resolve(42));
    check(v === 42 && e.alerts.length === 1, "withSaveReport: 성공 값 통과·추가 보고 없음");
  }
  // 알림이 던져도 보고가 던지지 않음
  {
    const r = mod.createSaveFailureReporter({
      now: () => 0,
      alert: () => {
        throw new Error("blocked");
      },
      logError: () => {},
    });
    let threw = false;
    try {
      r.reportSaveFailure("x", new Error("y"));
    } catch {
      threw = true;
    }
    check(!threw, "알림이 던져도 reportSaveFailure 는 던지지 않음");
  }
  return res;
}

/** 기본 인스턴스 연결 — window.alert 스텁 + Date.now 가짜 시계로 settleAll·useUndoStore 가 보고하는지 본다. */
async function wiringChecks() {
  const { res, check } = makeChecker();
  const alerts = [];
  const g = globalThis;
  const hadWindow = "window" in g;
  const prevWindow = g.window;
  const realNow = Date.now;
  const realError = console.error;
  const realWarn = console.warn;
  let t = 5_000_000;
  g.window = { alert: (m) => alerts.push(m) };
  Date.now = () => t;
  console.error = () => {};
  console.warn = () => {};
  try {
    const { settleAll } = await import(pathToFileURL(join(V2, "pages/viewer/utils/settle-all.ts")).href);
    const { useUndoStore } = await import(pathToFileURL(join(V2, "hooks/useUndoStore.ts")).href);

    // settleAll — action 없으면 알림 없음(종전), 있으면 묶음당 1회
    const n0 = await settleAll("t", [Promise.reject(new Error("a")), Promise.resolve(1)]);
    check(n0 === 1 && alerts.length === 0, `settleAll(action 없음): 실패 건수 1·알림 0 (${n0}/${alerts.length})`);
    t += 10_000;
    const n1 = await settleAll(
      "t",
      [Promise.reject(new Error("b")), Promise.reject(new Error("c")), Promise.resolve(1)],
      "서포트 위치 저장",
    );
    check(n1 === 2 && alerts.length === 1, `settleAll(action): 실패 건수 2·알림 묶음당 1회 (${n1}/${alerts.length})`);
    check(alerts[0]?.includes("서포트 위치 저장"), "settleAll 알림에 동작 이름");

    // useUndoStore — undo/redo 콜백 실패가 보고된다
    t += 10_000;
    useUndoStore.getState().clear();
    useUndoStore.getState().push({
      label: "x",
      undo: async () => {
        throw new Error("undo-fail");
      },
      redo: async () => {
        throw new Error("redo-fail");
      },
    });
    const before = alerts.length;
    await useUndoStore.getState().undo();
    check(alerts.length === before + 1 && alerts[alerts.length - 1].includes("되돌리기"), "useUndoStore: undo 실패 → 알림(되돌리기)");
    check(useUndoStore.getState().busy === false, "useUndoStore: undo 실패 뒤 busy 해제(흐름 불변)");
    t += 10_000;
    useUndoStore.getState().clear();
    useUndoStore.setState({
      past: [],
      future: [
        {
          label: "y",
          undo: async () => {},
          redo: async () => {
            throw new Error("redo-fail2");
          },
        },
      ],
    });
    const before2 = alerts.length;
    await useUndoStore.getState().redo();
    check(alerts.length === before2 + 1 && alerts[alerts.length - 1].includes("다시 실행"), "useUndoStore: redo 실패 → 알림(다시 실행)");
    useUndoStore.getState().clear();
  } finally {
    Date.now = realNow;
    console.error = realError;
    console.warn = realWarn;
    if (hadWindow) g.window = prevWindow;
    else delete g.window;
  }
  return res;
}

// ═════════════════════════════════════════════════════════════════════════
// (b) 소스 정적 검사 (TypeScript AST)
// ═════════════════════════════════════════════════════════════════════════
const HOOK_WRITE_NAMES = new Set([
  "addStlFile",
  "addStlFiles",
  "removeStlFile",
  "updateTransform",
  "updateMaterialSlot",
  "updateProject",
  "addSupports",
  "removeSupports",
  "clearAllSupports",
  "patchSupport",
]);
/** 파일별 추가 쓰기 이름 — 일반 이름(create·remove)이라 그 파일에서만 센다. */
const FILE_WRITE_NAMES = {
  "pages/ProjectsV2Page.tsx": new Set(["create", "remove"]),
};
const REPO_ALIASES = new Set(["repo", "supportRepo", "stlRepo", "projectRepo"]);
const REPO_WRITE_RE = /^(create|update|put|delete|add|replace)[A-Z]/;

/**
 * 기존 처리 예외 — 이미 실패를 사용자에게 알리는 지점. `파일::바깥 함수 이름`.
 * 새 예외를 늘리려면 이유를 여기에 적는다(스크립트가 사용 여부도 검사 — 안 쓰는 예외는 FAIL).
 */
const EXCEPTIONS = [
  { key: "pages/viewer/hooks/useTask0Material.ts::setMode", why: "catch → window.alert (재료 모드 저장 실패)" },
  { key: "pages/viewer/hooks/useTask0Material.ts::setSlot", why: "catch → window.alert (재료 슬롯 저장 실패)" },
  { key: "pages/viewer/hooks/useTask0Material.ts::setName", why: "catch → window.alert (재료 이름 저장 실패)" },
  { key: "pages/viewer/hooks/useStlDropImport.ts::addNativeFiles", why: "try/catch → window.alert + 파일별 failed 목록 알림" },
  { key: "pages/viewer/hooks/useStlDropImport.ts::addSampleModel", why: "try/catch → window.alert (예제 불러오기 실패)" },
  { key: "pages/viewer/hooks/useSupportEditing.ts::handleAutoGenerate", why: "catch → onNotice 배너 (자동 서포트 교체 저장 실패)" },
  { key: "pages/viewer/hooks/useDentalWorkflow.ts::handleGenerateRedesignSupports", why: "catch → setRedesignStatus 실패 문구 (재설계 서포트 교체 저장 실패)" },
  { key: "pages/viewer/hooks/useDentalWorkflow.ts::handleAutoSupportIslands", why: "catch → setIslandSupportResult 실패 문구 (검출 영역 서포트 교체 저장 실패)" },
];

/** 스캔 대상 파일(상대 경로, '/' 구분) — 핵심 영역은 제외. */
function listScanFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name)) out.push(relative(V2, full).replace(/\\/g, "/"));
    }
  };
  walk(join(V2, "pages"));
  walk(join(V2, "components"));
  return out.filter((f) => !f.startsWith("components/babylon/") && f !== "components/BabylonScene.tsx");
}

function nodeName(n) {
  if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) return n.name.text;
  return null;
}
const isFn = (n) =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);

function calleeInfo(call) {
  const c = call.expression;
  if (ts.isIdentifier(c)) return { name: c.text, owner: null };
  if (ts.isPropertyAccessExpression(c)) {
    const owner = ts.isIdentifier(c.expression) ? c.expression.text : null;
    return { name: c.name.text, owner };
  }
  return null;
}

function isWriteCall(call, file) {
  const info = calleeInfo(call);
  if (!info) return false;
  if (info.owner && REPO_ALIASES.has(info.owner) && REPO_WRITE_RE.test(info.name)) return true;
  if (!info.owner && HOOK_WRITE_NAMES.has(info.name)) return true;
  if (!info.owner && FILE_WRITE_NAMES[file]?.has(info.name)) return true;
  return false;
}

/** 쓰기 호출 하나가 보고로 이어지는지: "withSaveReport" 등 사유 문자열 또는 null(미처리). */
function coverage(call, sf, file, exceptionsUsed) {
  const text = (n) => n.getText(sf);
  // (1) withSaveReport(action, <call>) 의 인자
  let p = call.parent;
  while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
  if (p && ts.isCallExpression(p) && calleeInfo(p)?.name === "withSaveReport" && p.arguments.includes(call)) {
    return "withSaveReport";
  }
  // (4) settleAll 인자 안 — action(3번째 인자) 이 있어야만 인정. 없으면 실패가 삼켜지므로 (5) 로도 넘기지 않는다.
  for (let a = call.parent; a; a = a.parent) {
    if (ts.isCallExpression(a) && calleeInfo(a)?.name === "settleAll") {
      return a.arguments.length >= 3 ? "settleAll(action)" : null;
    }
  }
  // (2) <call>.catch(... reportSaveFailure ...)
  {
    let q = call.parent;
    if (q && ts.isPropertyAccessExpression(q) && q.expression === call && q.name.text === "catch") {
      const cc = q.parent;
      if (cc && ts.isCallExpression(cc) && cc.arguments.some((arg) => text(arg).includes("reportSaveFailure("))) {
        return ".catch(reportSaveFailure)";
      }
    }
  }
  // (3) catch 절에 reportSaveFailure 가 있는 try 의 try 블록 — 함수 경계를 넘지 않는다.
  for (let a = call.parent, child = call; a; child = a, a = a.parent) {
    if (isFn(a)) break;
    if (ts.isTryStatement(a) && a.tryBlock === child && a.catchClause && text(a.catchClause).includes("reportSaveFailure(")) {
      return "try/catch(reportSaveFailure)";
    }
  }
  // (6) 명시 예외 — 바깥 이름이 일치
  const names = [];
  for (let a = call.parent; a; a = a.parent) {
    const nm = nodeName(a);
    if (nm) names.push(nm);
  }
  for (const ex of EXCEPTIONS) {
    const [exFile, exFn] = ex.key.split("::");
    if (exFile === file && names.includes(exFn)) {
      exceptionsUsed.add(ex.key);
      return `예외(${ex.why})`;
    }
  }
  // (5) undo/redo 콜백 — useUndoStore 의 catch 가 reportSaveFailure 로 보고한다
  for (let a = call.parent; a; a = a.parent) {
    if (isFn(a) && a.parent && ts.isPropertyAssignment(a.parent)) {
      const pn = nodeName(a.parent);
      if (pn === "undo" || pn === "redo") return "undo/redo(useUndoStore)";
    }
  }
  return null;
}

/** sources: { relPath: text } → { sites, uncovered, exceptionsUsed } */
function scan(sources) {
  const sites = [];
  const exceptionsUsed = new Set();
  for (const [file, text] of Object.entries(sources)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (n) => {
      if (ts.isCallExpression(n) && isWriteCall(n, file)) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const how = coverage(n, sf, file, exceptionsUsed);
        sites.push({ file, line, callee: calleeInfo(n).name, how });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { sites, uncovered: sites.filter((s) => !s.how), exceptionsUsed };
}

function loadSources() {
  const out = {};
  for (const f of listScanFiles()) out[f] = readV2(f);
  return out;
}

function staticChecks(sources, undoStoreSrc) {
  const { res, check } = makeChecker();
  const { sites, uncovered, exceptionsUsed } = scan(sources);
  check(sites.length > 0, `쓰기 호출 ${sites.length}곳 발견`);
  for (const u of uncovered) check(false, `처리 없는 쓰기 호출: ${u.file}:${u.line} ${u.callee}`);
  if (uncovered.length === 0) check(true, "처리 없는 쓰기 호출 0곳");
  for (const ex of EXCEPTIONS) check(exceptionsUsed.has(ex.key), `예외 사용됨(낡은 예외 아님): ${ex.key}`);
  // undo/redo 콜백 보고 배선 — useUndoStore catch 에 reportSaveFailure
  check(
    /reportSaveFailure\("되돌리기", err\)/.test(undoStoreSrc) && /reportSaveFailure\("다시 실행", err\)/.test(undoStoreSrc),
    "useUndoStore: undo/redo catch 가 reportSaveFailure 로 보고",
  );
  return { res, sites };
}

// ═════════════════════════════════════════════════════════════════════════
// 실행
// ═════════════════════════════════════════════════════════════════════════
const tmp = mkdtempSync(join(tmpdir(), "verify-save-failure-"));
try {
  const helperSrc = readV2(HELPER_REL);
  const helperMod = await import(pathToFileURL(join(V2, HELPER_REL)).href);

  console.log("\n(a) 헬퍼 단위");
  assertAll(await helperChecks(helperMod));

  console.log("\n(a2) 기본 인스턴스 연결 (settleAll action · useUndoStore)");
  assertAll(await wiringChecks());

  console.log("\n(b) 소스 정적 검사");
  const sources = loadSources();
  const undoStoreSrc = readV2("hooks/useUndoStore.ts");
  const real = staticChecks(sources, undoStoreSrc);
  assertAll(real.res);
  console.log("\n  쓰기 호출 전수 (파일:라인 — 호출 — 처리):");
  for (const s of real.sites) console.log(`    ${s.file}:${s.line}  ${s.callee}  ${s.how ?? "미처리"}`);

  console.log("\n(c) 대조군");
  // 헬퍼 변조 — 같은 단위 검사에 넣는다
  const helperTampers = [
    ["quota 판정 제거", "if (errorName(err) === QUOTA_ERROR_NAME) return;", ""],
    ["폭주 방지 제거", "if (now - lastAlertAt < ALERT_INTERVAL_MS) return;", ""],
    ["중복 보고 방지 제거", "if (reported.has(err)) return;", ""],
    ["withSaveReport 가 오류를 삼킴", "      throw err;\n", "      return undefined;\n"],
  ];
  let ti = 0;
  for (const [label, from, to] of helperTampers) {
    const mutated = tamper(helperSrc, from, to, label);
    const f = join(tmp, `save-failure-${ti++}.ts`);
    writeFileSync(f, mutated);
    const mod = await import(pathToFileURL(f).href);
    // withSaveReport 변조는 반환 타입 때문에 tsx 변환은 통과(타입 검사 안 함) — 같은 단위 검사로 실패해야 한다
    assertControl(await helperChecks(mod), `헬퍼 ${label}`);
  }

  // 쓰기 지점 변조 — 같은 정적 검사에 넣는다
  const siteTampers = [
    [
      "서포트 추가의 withSaveReport 제거",
      "pages/viewer/hooks/useSupportEditing.ts",
      'await withSaveReport("서포트 추가", addSupports([newPoint]));',
      "await addSupports([newPoint]);",
    ],
    [
      "프로젝트 삭제의 withSaveReport 제거",
      "pages/ProjectsV2Page.tsx",
      'await withSaveReport("프로젝트 삭제", remove(id));',
      "await remove(id);",
    ],
    [
      "모델 위치 저장의 .catch 제거",
      "pages/viewer/hooks/useTransformCommit.ts",
      '      updateTransform(id, end).catch((e: unknown) => {\n        reportSaveFailure("모델 위치 저장", e);\n      });\n',
      "      void updateTransform(id, end);\n",
    ],
    [
      "재설계 서포트 정리의 catch 보고 제거",
      "pages/viewer/hooks/useTransformCommit.ts",
      '                reportSaveFailure("재설계 서포트 정리", e);\n',
      "",
    ],
    [
      "settleAll action 인자 제거(커밋)",
      "pages/viewer/hooks/useTransformCommit.ts",
      '          "서포트 위치 저장",\n',
      "",
    ],
    [
      "브릿지 변곡점 이동의 withSaveReport 제거",
      "pages/viewer/hooks/useBridgeControlPoints.ts",
      'await withSaveReport("브릿지 변곡점 이동", patchSupport(supportId, { curveControlPoints: newCps }));',
      "await patchSupport(supportId, { curveControlPoints: newCps });",
    ],
    [
      "옛 서포트 좌표 변환의 withSaveReport 제거",
      "pages/viewer/hooks/useLegacySupportMigration.ts",
      'await withSaveReport(\n            "옛 서포트 좌표 변환",\n            patchSupport(s.id, {\n              contact: newContact,\n              base: newBase,\n              ...(newCps ? { curveControlPoints: newCps } : {}),\n              coordSpace: "world",\n            }),\n          );',
      'await patchSupport(s.id, {\n            contact: newContact,\n            base: newBase,\n            ...(newCps ? { curveControlPoints: newCps } : {}),\n            coordSpace: "world",\n          });',
    ],
  ];
  for (const [label, file, from, to] of siteTampers) {
    const mutated = { ...sources, [file]: tamper(sources[file], from, to, label) };
    assertControl(staticChecks(mutated, undoStoreSrc).res, label);
  }
  // useUndoStore 의 보고 제거
  assertControl(
    staticChecks(sources, tamper(undoStoreSrc, 'reportSaveFailure("되돌리기", err);', "", "undo 보고 제거")).res,
    "useUndoStore undo 보고 제거",
  );
  // 낡은 예외 — 예외 대상 호출의 .catch 알림이 사라져도(=예외가 쓰이지 않게 되어도) 검사가 알아챈다: 예외 키가 없는 파일로 검사
  {
    const stripped = { ...sources };
    delete stripped["pages/viewer/hooks/useTask0Material.ts"];
    assertControl(staticChecks(stripped, undoStoreSrc).res, "예외 대상 파일 없음 → 낡은 예외 검출");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failed === 0 ? "\n✔ verify-save-failure: 전부 통과" : `\n✘ verify-save-failure: ${failed}건 실패`);
process.exit(failed === 0 ? 0 : 1);
