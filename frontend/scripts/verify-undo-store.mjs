// undo/redo 스택 실행 규칙 헤드리스 검증 (정리_20261001 §4-2 신규 3a·6).
//
//   문제였던 것:
//     · 신규 6 — undo() 가 past 마지막 항목을 읽고 `await entry.undo()` 한 **뒤에야**
//       set() 으로 뺐다. await 중 두 번째 호출(Ctrl+Z 연타·키 반복)이 같은 항목을
//       또 실행하고, 그 뒤 slice(0,-1) 두 번이 **되돌리지도 않은 앞 항목**까지
//       past 에서 날렸다. redo 도 동일.
//     · 신규 3a — 콜백이 throw 하면 set() 이 안 돌아 항목이 past 에 영구히 남고,
//       Ctrl+Z 마다 같은 실패를 반복해 이력이 막혔다(호출부 void → unhandled rejection).
//     · await 중 clear()(프로젝트 전환·STL 삭제)가 불려도 끝난 항목이 future 로
//       되살아났다. 위치(slice) 기반 제거라 await 중 push 된 새 항목을 대신 뺐다.
//
//   수정(useUndoStore.ts): busy 동안 undo/redo 호출 무시 · 실패 항목 폐기(reject 안 함)
//     · clear 세대(gen) 비교 · identity 기반 제거.
//
//   검증 방법: **실제 모듈** `useUndoStore` 를 import 해 getState() 로 직접 시험한다
//     (zustand 스토어라 React 렌더 불필요). 각 시나리오 전 clear() 로 초기화.
//
//   ★ 대조군 원칙(프로젝트 규약): 같은 시나리오를 **수정 전 구현의 복제본**
//     (`makeOldStore()` — 수정 전 useUndoStore.ts 로직을 zustand create 로 그대로
//     옮김)에도 돌려, 그때는 **버그가 실제로 재현됨**을 단언한다. 재현되지 않으면
//     시나리오가 결함을 못 잡는다는 뜻이므로 그 자체를 FAIL 로 센다.
//     (5) 정상 순차는 회귀 방지용이라 대조군도 통과해야 정상 — 버그 재현 대상에서 뺀다.
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "버그 재현" 문자열을 출력한다.
//   exit 0 = 실제 모듈 전 항목 통과 AND 대조군 전 항목 버그 재현.
//
//   실행: npx tsx scripts/verify-undo-store.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { create } from "zustand";

import { useUndoStore } from "../src/features/v2/hooks/useUndoStore.ts";

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

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** promise 의 reject 를 삼키고 결과만 돌려준다 (unhandled rejection 방지). */
async function settle(p) {
  try {
    await p;
    return { rejected: false };
  } catch (error) {
    return { rejected: true, error };
  }
}

/** 실제 모듈의 console.warn(실패 항목 폐기 로그)을 모아 출력 소음을 줄인다. */
let warnCount = 0;
const origWarn = console.warn;
function muteWarn() {
  warnCount = 0;
  console.warn = () => {
    warnCount++;
  };
}
function restoreWarn() {
  console.warn = origWarn;
}

// ── 수정 전 구현 복제본 (대조군) ─────────────────────────────────────────
//   frontend/src/features/v2/hooks/useUndoStore.ts 의 수정 전 로직을 그대로 옮김.
const OLD_MAX_DEPTH = 100;
function makeOldStore() {
  return create((set, get) => ({
    past: [],
    future: [],

    push: (entry) =>
      set((s) => {
        const past = [...s.past, entry];
        while (past.length > OLD_MAX_DEPTH) past.shift();
        return { past, future: [] };
      }),

    undo: async () => {
      const past = get().past;
      if (past.length === 0) return;
      const entry = past[past.length - 1];
      await entry.undo();
      set((s) => ({
        past: s.past.slice(0, -1),
        future: [...s.future, entry],
      }));
    },

    redo: async () => {
      const future = get().future;
      if (future.length === 0) return;
      const entry = future[future.length - 1];
      await entry.redo();
      set((s) => ({
        past: [...s.past, entry],
        future: s.future.slice(0, -1),
      }));
    },

    clear: () => set({ past: [], future: [] }),

    _peek: () => ({ past: get().past.length, future: get().future.length }),
  }));
}

/** 실제 모듈 — 싱글턴이라 clear() 로 초기화해서 돌려준다. */
function realStore() {
  useUndoStore.getState().clear();
  return useUndoStore;
}

/**
 * 호출 횟수를 세는 undo entry.
 *   delayMs: 콜백 지연(비동기 DB 쓰기 흉내) · undoThrows/redoThrows: 실패 주입.
 */
function makeEntry(
  label,
  { delayMs = 0, undoThrows = false, redoThrows = false } = {},
) {
  const calls = { undo: 0, redo: 0 };
  const entry = {
    label,
    undo: async () => {
      calls.undo++;
      if (delayMs) await delay(delayMs);
      if (undoThrows) throw new Error(`${label} undo 실패(주입)`);
    },
    redo: async () => {
      calls.redo++;
      if (delayMs) await delay(delayMs);
      if (redoThrows) throw new Error(`${label} redo 실패(주입)`);
    },
  };
  return { entry, calls };
}

const labels = (arr) => arr.map((e) => e.label).join(",") || "없음";

// ── 시나리오 (store 를 받아 관찰값만 돌려준다 — 판정은 main 에서) ─────────

/** (1) 연타: 지연 항목 1개 → undo() 2번을 await 없이 연달아. */
async function scDoubleUndo(store) {
  const a = makeEntry("A", { delayMs: 20 });
  store.getState().push(a.entry);
  const p1 = settle(store.getState().undo());
  const p2 = settle(store.getState().undo());
  await Promise.all([p1, p2]);
  const s = store.getState();
  return { calls: a.calls.undo, past: s.past.length, future: s.future.length };
}

/** (1b) 연타 + 앞 항목: A, B(지연) → undo() 2연타 → A 는 손대지 않아야 한다. */
async function scDoubleUndoTwoEntries(store) {
  const a = makeEntry("A");
  const b = makeEntry("B", { delayMs: 20 });
  store.getState().push(a.entry);
  store.getState().push(b.entry);
  await Promise.all([
    settle(store.getState().undo()),
    settle(store.getState().undo()),
  ]);
  const s = store.getState();
  return {
    aUndo: a.calls.undo,
    bUndo: b.calls.undo,
    past: labels(s.past),
    future: labels(s.future),
  };
}

/** (1c) redo 연타: 지연 항목 1개를 undo 해 둔 뒤 redo() 2번 연달아. */
async function scDoubleRedo(store) {
  const a = makeEntry("A", { delayMs: 20 });
  store.getState().push(a.entry);
  await settle(store.getState().undo());
  await Promise.all([
    settle(store.getState().redo()),
    settle(store.getState().redo()),
  ]);
  const s = store.getState();
  return { calls: a.calls.redo, past: s.past.length, future: s.future.length };
}

/** (2) undo 실패 폐기: A(정상), B(throw) → undo() → undo(). */
async function scUndoFailure(store) {
  const a = makeEntry("A");
  const b = makeEntry("B", { undoThrows: true });
  store.getState().push(a.entry);
  store.getState().push(b.entry);
  const r1 = await settle(store.getState().undo());
  const after1 = {
    past: labels(store.getState().past),
    future: labels(store.getState().future),
  };
  const r2 = await settle(store.getState().undo());
  const s = store.getState();
  return {
    r1Rejected: r1.rejected,
    after1,
    r2Rejected: r2.rejected,
    aUndo: a.calls.undo,
    bUndo: b.calls.undo,
    past: labels(s.past),
    future: labels(s.future),
    busy: s.busy,
  };
}

/**
 * (3) redo 실패 폐기: P(redo throw), Q(정상) push → undo ×2 → future=[Q,P]
 *     → redo()(P 실패) → redo()(Q 진행).
 */
async function scRedoFailure(store) {
  const p = makeEntry("P", { redoThrows: true });
  const q = makeEntry("Q");
  store.getState().push(p.entry);
  store.getState().push(q.entry);
  await settle(store.getState().undo());
  await settle(store.getState().undo());
  const r1 = await settle(store.getState().redo());
  const after1 = {
    past: labels(store.getState().past),
    future: labels(store.getState().future),
  };
  const r2 = await settle(store.getState().redo());
  const s = store.getState();
  return {
    r1Rejected: r1.rejected,
    after1,
    r2Rejected: r2.rejected,
    pRedo: p.calls.redo,
    qRedo: q.calls.redo,
    past: labels(s.past),
    future: labels(s.future),
    busy: s.busy,
  };
}

/** (4) 진행 중 clear: 지연 undo 시작 → 즉시 clear() → (clear 후 새 B push) → await. */
async function scClearDuringUndo(store) {
  const a = makeEntry("A", { delayMs: 20 });
  store.getState().push(a.entry);
  const pending = settle(store.getState().undo());
  store.getState().clear();
  const b = makeEntry("B");
  store.getState().push(b.entry); // 새 프로젝트에서 곧바로 생긴 이력
  await pending;
  const s = store.getState();
  return { past: labels(s.past), future: labels(s.future), busy: s.busy };
}

/** (5) 정상 순차: 3개 push → undo ×2 → redo ×1 (회귀 방지). */
async function scSequential(store) {
  const order = [];
  const mk = (label) => ({
    label,
    undo: async () => {
      order.push(`undo:${label}`);
    },
    redo: async () => {
      order.push(`redo:${label}`);
    },
  });
  for (const l of ["A", "B", "C"]) store.getState().push(mk(l));
  await store.getState().undo();
  await store.getState().undo();
  const mid = {
    past: store.getState().past.length,
    future: store.getState().future.length,
  };
  await store.getState().redo();
  const s = store.getState();
  return {
    mid,
    past: s.past.length,
    future: s.future.length,
    pastLabels: labels(s.past),
    order: order.join(" "),
  };
}

/** (6) busy 플래그: 진행 중 true, 성공·실패 후 모두 false. (실제 모듈 전용) */
async function scBusy(store) {
  const a = makeEntry("A", { delayMs: 20 });
  const b = makeEntry("B", { delayMs: 20, undoThrows: true });
  store.getState().push(a.entry);
  store.getState().push(b.entry);
  const p1 = store.getState().undo(); // B (실패)
  const busyDuringFail = store.getState().busy;
  await settle(p1);
  const busyAfterFail = store.getState().busy;
  const p2 = store.getState().undo(); // A (성공)
  const busyDuringOk = store.getState().busy;
  await settle(p2);
  const busyAfterOk = store.getState().busy;
  const p3 = store.getState().redo(); // A redo (성공)
  const busyDuringRedo = store.getState().busy;
  await settle(p3);
  const busyAfterRedo = store.getState().busy;
  return {
    busyDuringFail,
    busyAfterFail,
    busyDuringOk,
    busyAfterOk,
    busyDuringRedo,
    busyAfterRedo,
  };
}

/** (7) identity 제거: 지연 undo 중 새 항목 B 가 push 돼도 B 를 잃지 않는다. */
async function scPushDuringUndo(store) {
  const a = makeEntry("A", { delayMs: 20 });
  store.getState().push(a.entry);
  const pending = settle(store.getState().undo());
  const b = makeEntry("B");
  store.getState().push(b.entry); // 되돌리는 도중 사용자가 새 편집
  await pending;
  const s = store.getState();
  return { past: labels(s.past) };
}

// ── 실행 ─────────────────────────────────────────────────────────────────

async function runReal() {
  console.log("\n[실제 모듈] useUndoStore (수정 후):");
  muteWarn();
  try {
    console.log("\n(1) undo 연타 — 지연 항목 1개, await 없이 2번:");
    let r = await scDoubleUndo(realStore());
    assert(r.calls === 1, `undo 콜백 1회만 실행 (실제: ${r.calls}회)`);
    assert(r.past === 0 && r.future === 1, `past 0 · future 1 (실제: past ${r.past} · future ${r.future})`);

    console.log("\n(1b) undo 연타 — A, B(지연) 2연타:");
    r = await scDoubleUndoTwoEntries(realStore());
    assert(r.bUndo === 1, `B undo 1회 (실제: ${r.bUndo}회)`);
    assert(r.aUndo === 0, `두 번째 호출은 무시 — A 는 실행 안 됨 (실제: ${r.aUndo}회)`);
    assert(r.past === "A" && r.future === "B", `past=[A] · future=[B] (실제: past=[${r.past}] · future=[${r.future}])`);

    console.log("\n(1c) redo 연타 — 지연 항목 1개:");
    r = await scDoubleRedo(realStore());
    assert(r.calls === 1, `redo 콜백 1회만 실행 (실제: ${r.calls}회)`);
    assert(r.past === 1 && r.future === 0, `past 1 · future 0 (실제: past ${r.past} · future ${r.future})`);

    console.log("\n(2) undo 실패 항목 폐기 — A(정상), B(throw):");
    r = await scUndoFailure(realStore());
    assert(!r.r1Rejected, "실패해도 undo() 가 reject 하지 않음");
    assert(r.after1.past === "A" && r.after1.future === "없음", `실패 직후 past=[A] · future=[] (실제: past=[${r.after1.past}] · future=[${r.after1.future}])`);
    assert(!r.r2Rejected && r.aUndo === 1, `다음 undo() 는 앞 항목 A 로 진행 (A undo ${r.aUndo}회)`);
    assert(r.bUndo === 1, `실패 항목 B 는 재시도되지 않음 (B undo ${r.bUndo}회)`);
    assert(r.past === "없음" && r.future === "A", `최종 past=[] · future=[A] (실제: past=[${r.past}] · future=[${r.future}])`);
    assert(warnCount >= 1, `실패를 console.warn 으로 남김 (${warnCount}건)`);

    console.log("\n(3) redo 실패 항목 폐기 — P(redo throw), Q(정상):");
    r = await scRedoFailure(realStore());
    assert(!r.r1Rejected, "실패해도 redo() 가 reject 하지 않음");
    assert(r.after1.past === "없음" && r.after1.future === "Q", `실패 직후 past=[] · future=[Q] (실제: past=[${r.after1.past}] · future=[${r.after1.future}])`);
    assert(!r.r2Rejected && r.qRedo === 1, `다음 redo() 는 Q 로 진행 (Q redo ${r.qRedo}회)`);
    assert(r.pRedo === 1, `실패 항목 P 는 재시도되지 않음 (P redo ${r.pRedo}회)`);
    assert(r.past === "Q" && r.future === "없음", `최종 past=[Q] · future=[] (실제: past=[${r.past}] · future=[${r.future}])`);

    console.log("\n(4) 진행 중 clear — 끝난 항목을 되살리지 않음:");
    r = await scClearDuringUndo(realStore());
    assert(r.future === "없음", `future 비어 있음 — A 가 되살아나지 않음 (실제: [${r.future}])`);
    assert(r.past === "B", `clear 후 새로 쌓인 B 는 그대로 (실제: past=[${r.past}])`);
    assert(r.busy === false, "busy 해제됨");

    console.log("\n(5) 정상 순차 — push 3 → undo ×2 → redo ×1:");
    r = await scSequential(realStore());
    assert(r.mid.past === 1 && r.mid.future === 2, `undo ×2 후 past 1 · future 2 (실제: ${r.mid.past} · ${r.mid.future})`);
    assert(r.past === 2 && r.future === 1, `redo 후 past 2 · future 1 (실제: ${r.past} · ${r.future})`);
    assert(r.pastLabels === "A,B", `past=[A,B] (실제: [${r.pastLabels}])`);
    assert(r.order === "undo:C undo:B redo:B", `실행 순서 C→B 되돌림, B 다시 실행 (실제: ${r.order})`);

    console.log("\n(6) busy 플래그:");
    r = await scBusy(realStore());
    assert(r.busyDuringFail && r.busyDuringOk && r.busyDuringRedo, "진행 중 busy=true (실패·성공·redo)");
    assert(!r.busyAfterFail, "실패 후 busy=false");
    assert(!r.busyAfterOk, "undo 성공 후 busy=false");
    assert(!r.busyAfterRedo, "redo 성공 후 busy=false");

    console.log("\n(7) 진행 중 push — identity 제거로 새 항목 보존:");
    r = await scPushDuringUndo(realStore());
    assert(r.past === "B", `되돌리는 도중 push 된 B 가 past 에 남음 (실제: past=[${r.past}])`);
  } finally {
    restoreWarn();
    useUndoStore.getState().clear();
  }
}

async function runOld() {
  console.log("\n[대조군] 수정 전 구현 복제본 — 버그가 실제로 재현되어야 한다:");

  console.log("\n(1) undo 연타:");
  let r = await scDoubleUndo(makeOldStore());
  assert(r.calls === 2 || r.future === 2, `버그 재현: 같은 항목이 2번 실행 (undo ${r.calls}회 · future ${r.future})`);

  console.log("\n(1b) undo 연타 — A, B(지연):");
  r = await scDoubleUndoTwoEntries(makeOldStore());
  assert(r.bUndo === 2 && r.aUndo === 0 && r.past === "없음", `버그 재현: B 2번 실행, 되돌리지 않은 A 가 past 에서 사라짐 (B ${r.bUndo}회 · A ${r.aUndo}회 · past=[${r.past}])`);

  console.log("\n(1c) redo 연타:");
  r = await scDoubleRedo(makeOldStore());
  assert(r.calls === 2 || r.past === 2, `버그 재현: 같은 항목이 2번 다시 실행 (redo ${r.calls}회 · past ${r.past})`);

  console.log("\n(2) undo 실패:");
  r = await scUndoFailure(makeOldStore());
  assert(r.r1Rejected, "버그 재현: undo() 가 reject (호출부 void → unhandled rejection)");
  assert(r.after1.past === "A,B", `버그 재현: 실패 항목 B 가 past 에 남음 (past=[${r.after1.past}])`);
  assert(r.bUndo === 2 && r.aUndo === 0, `버그 재현: 다음 Ctrl+Z 도 같은 B 실패 반복 — 이력 막힘 (B ${r.bUndo}회 · A ${r.aUndo}회)`);

  console.log("\n(3) redo 실패:");
  r = await scRedoFailure(makeOldStore());
  assert(r.r1Rejected, "버그 재현: redo() 가 reject");
  assert(r.pRedo === 2 && r.qRedo === 0, `버그 재현: 다음 redo 도 같은 P 실패 반복 (P ${r.pRedo}회 · Q ${r.qRedo}회)`);

  console.log("\n(4) 진행 중 clear:");
  r = await scClearDuringUndo(makeOldStore());
  assert(r.future === "A", `버그 재현: clear 했는데 A 가 future 에 되살아남 (future=[${r.future}])`);

  console.log("\n(5) 정상 순차 (복제본 충실도 확인 — 버그 재현 대상 아님):");
  r = await scSequential(makeOldStore());
  assert(
    r.mid.past === 1 && r.mid.future === 2 && r.past === 2 && r.future === 1 && r.order === "undo:C undo:B redo:B",
    `대조군도 정상 순차는 통과 (past ${r.past} · future ${r.future} · ${r.order})`,
  );

  console.log("\n(7) 진행 중 push:");
  r = await scPushDuringUndo(makeOldStore());
  assert(r.past === "A", `버그 재현: 위치(slice) 제거가 새 항목 B 를 빼고 이미 되돌린 A 를 남김 (past=[${r.past}])`);
}

async function main() {
  console.log("undo/redo 스택 실행 규칙 검증 (신규 3a·6)");
  await runReal();
  await runOld();
  console.log(
    failed === 0
      ? "\n검증 통과 (실제 모듈 전 항목 ok · 대조군 전 항목 버그 재현)."
      : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
