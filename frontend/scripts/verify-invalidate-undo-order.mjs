// 재설계 서포트 무효화 삭제 ↔ undo 복원의 순서 보장 검증 (B-1 재작업).
//
//   문제였던 것: 커밋 시 무효화 삭제를 `void (async () => {...})()` 로 던져두면
//   삭제 완료와 undo 실행 사이에 순서 보장이 없다. 사용자가 "실수로 회전 →
//   즉시 Ctrl+Z" 를 누르면 삭제가 끝나기 전에 복원(addSupports)이 돌고, 뒤늦게
//   도착한 삭제가 방금 복원한 점을 도로 지운다. 게다가 addSupports 가 IndexedDB
//   store.add 였을 때는 아직 안 지워진 id 하나만 있어도 ConstraintError 로
//   transaction 전체가 abort → 무관한 점들까지 통째로 유실됐다.
//
//   수정: 삭제 promise 를 변수(invalidationDone)로 잡고 undo/redo 클로저에서
//   먼저 await 한다. 여기서는 그 순서 규약을 IndexedDB/React 없이 재현한다 —
//   비동기 지연을 가진 fake store 위에서 커밋 직후 undo 를 즉시 호출해도
//   최종 상태가 "복원됨"으로 수렴하는지 본다.
//
//   ※ useTransformCommit 자체는 React 훅 + Babylon 핸들 + IndexedDB 에 얽혀
//     있어 node 에서 그대로 import 할 수 없다. 그래서 이 스크립트는 훅의
//     **순서 규약만** 같은 모양으로 복제해 검증한다 (판정 함수는 실제 모듈을
//     그대로 import). 실제 배선이 이 규약을 따르는지는 코드 리뷰로 확인한다.
//
//   실행: npx tsx scripts/verify-invalidate-undo-order.mjs

import { transformKeepsRedesignValid } from "../src/features/v2/types/transform.ts";

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

/**
 * IndexedDB 서포트 store 를 흉내낸 fake.
 *   - 모든 쓰기에 인위적 지연을 줘 인터리브가 실제로 일어나게 한다.
 *   - addMode: 'add' 는 기존 IndexedDB store.add 처럼 키 충돌 시 tx 전체를
 *     abort(=전부 롤백) 하고, 'put' 은 덮어쓴다.
 */
function makeFakeStore({ writeDelayMs = 20, addMode = "put" } = {}) {
  const rows = new Map();
  let refreshCount = 0;

  return {
    rows,
    get refreshCount() {
      return refreshCount;
    },
    ids: () => [...rows.keys()].sort(),

    /** 단일 tx 일괄 삭제 (repo.deleteSupportsByIds). */
    async deleteMany(ids) {
      await delay(writeDelayMs);
      for (const id of ids) rows.delete(id);
      refreshCount++; // useSupportsV2.removeMany 의 refresh 1회
    },

    /** 점당 tx 삭제 (수정 전 동작 재현용). */
    async deleteOne(id) {
      await delay(writeDelayMs);
      rows.delete(id);
      refreshCount++;
    },

    /** 단일 tx 일괄 추가 (repo.addSupports). */
    async addMany(points) {
      if (points.length === 0) return;
      await delay(writeDelayMs);
      if (addMode === "add") {
        // store.add 시맨틱: 하나라도 키가 이미 있으면 ConstraintError → tx abort.
        for (const p of points) {
          if (rows.has(p.id)) {
            throw new Error(`ConstraintError: key already exists (${p.id})`);
          }
        }
      }
      for (const p of points) rows.set(p.id, p);
      refreshCount++;
    },
  };
}

/** 재설계 점 3개 + 무관한 world 점 1개가 있는 초기 상태. */
function seed(store) {
  const pts = [
    { id: "r1", stlId: "S", kind: "island", coordSpace: "stl-local" },
    { id: "r2", stlId: "S", kind: "island", coordSpace: "stl-local" },
    { id: "r3", stlId: "S", kind: "slope", coordSpace: "stl-local" },
    { id: "w1", stlId: "S", kind: undefined, coordSpace: "world" },
  ];
  for (const p of pts) store.rows.set(p.id, p);
  return pts;
}

/**
 * handleCommitTransform 의 무효화 부분 + undo entry 생성을 그대로 옮긴 모델.
 *   mode: 'fixed'  = 현재 구현 (invalidationDone 을 undo 가 await)
 *         'racy'   = 수정 전 구현 (fire-and-forget, 점당 삭제)
 */
function commitTransform(store, current, stlId, start, end, mode) {
  const invalidates = !transformKeepsRedesignValid(start, end);
  const invalidated = invalidates
    ? current.filter(
        (s) => s.stlId === stlId && (s.kind === "island" || s.kind === "slope"),
      )
    : [];

  let noticeCount = 0;

  if (mode === "racy") {
    // 수정 전: 던져두고 잊는다. 점당 삭제라 window 도 길다.
    void (async () => {
      for (const s of invalidated) await store.deleteOne(s.id);
      noticeCount = invalidated.length;
    })();
    return {
      invalidated,
      undo: async () => {
        if (invalidated.length > 0) await store.addMany(invalidated);
      },
      redo: async () => {
        for (const s of invalidated) await store.deleteOne(s.id);
      },
      notice: () => noticeCount,
    };
  }

  // 현재 구현: 삭제 promise 를 잡아두고 undo/redo 가 먼저 await.
  const invalidationDone =
    invalidated.length > 0
      ? (async () => {
          try {
            await store.deleteMany(invalidated.map((s) => s.id));
            noticeCount = invalidated.length;
          } catch (e) {
            console.error("삭제 실패:", e);
          }
        })()
      : Promise.resolve();

  return {
    invalidated,
    undo: async () => {
      await invalidationDone;
      if (invalidated.length > 0) await store.addMany(invalidated);
    },
    redo: async () => {
      await invalidationDone;
      if (invalidated.length > 0) {
        await store.deleteMany(invalidated.map((s) => s.id));
      }
    },
    notice: () => noticeCount,
  };
}

const ROT = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
const ROTATED = { ...ROT, ry: 90 };

// ── (a) 커밋 직후 즉시 undo — 현재 구현 ───────────────────────────────────
async function caseImmediateUndoFixed() {
  console.log("\n(a) 회전 커밋 직후 즉시 Ctrl+Z (현재 구현):");
  const store = makeFakeStore({ addMode: "put" });
  const pts = seed(store);

  const entry = commitTransform(store, pts, "S", ROT, ROTATED, "fixed");
  assert(entry.invalidated.length === 3, "재설계 점 3개가 무효화 대상");

  // 삭제가 끝나기 전(지연 20ms 중)에 undo 호출 — 최악의 타이밍.
  await entry.undo();

  assert(
    store.ids().join(",") === "r1,r2,r3,w1",
    `undo 후 재설계 점 3개 전부 복원 (실제: ${store.ids().join(",") || "없음"})`,
  );
  assert(store.rows.has("w1"), "무관한 world 점은 영향 없음");
}

// ── (b) 같은 시나리오, 수정 전 구현이면 깨진다는 것 확인 ──────────────────
async function caseImmediateUndoRacy() {
  console.log("\n(b) 같은 시나리오, 수정 전 구현(fire-and-forget):");
  const store = makeFakeStore({ addMode: "add" });
  const pts = seed(store);

  const entry = commitTransform(store, pts, "S", ROT, ROTATED, "racy");
  let undoThrew = false;
  try {
    await entry.undo();
  } catch {
    undoThrew = true;
  }
  // 삭제가 아직 진행 중이므로 남은 삭제가 복원본을 마저 지운다.
  await delay(200);

  const survived = store.ids().filter((id) => id !== "w1");
  assert(
    undoThrew || survived.length < 3,
    `수정 전에는 undo 가 실패하거나 점이 유실됨 (throw=${undoThrew}, 남은 재설계 점=${survived.length}/3)`,
  );
  console.log(
    "    └ 수정 전 동작이 실제로 깨진다는 대조군. 위 (a)와 대비.",
  );
}

// ── (c) undo → redo → undo 왕복 ──────────────────────────────────────────
async function caseUndoRedoRoundTrip() {
  console.log("\n(c) undo → redo → undo 왕복:");
  const store = makeFakeStore({ addMode: "put" });
  const pts = seed(store);
  const entry = commitTransform(store, pts, "S", ROT, ROTATED, "fixed");

  await entry.undo();
  assert(store.ids().join(",") === "r1,r2,r3,w1", "undo → 복원됨");

  await entry.redo();
  assert(store.ids().join(",") === "w1", "redo → 다시 삭제됨 (world 점만 남음)");

  await entry.undo();
  assert(store.ids().join(",") === "r1,r2,r3,w1", "다시 undo → 재복원됨");
}

// ── (d) 삭제 완료를 기다린 뒤 undo (정상 타이밍) ─────────────────────────
async function caseNormalTimingUndo() {
  console.log("\n(d) 삭제 완료 후 여유있게 Ctrl+Z (정상 타이밍):");
  const store = makeFakeStore({ addMode: "put" });
  const pts = seed(store);
  const entry = commitTransform(store, pts, "S", ROT, ROTATED, "fixed");

  await delay(200); // 삭제 완료 대기
  assert(store.ids().join(",") === "w1", "삭제 완료 시점엔 재설계 점 없음");
  assert(entry.notice() === 3, "안내 배너 카운트 = 3 (삭제 성공 후에만)");

  await entry.undo();
  assert(store.ids().join(",") === "r1,r2,r3,w1", "undo → 전부 복원");
}

// ── (e) refresh 횟수 — N회 → 1회 ─────────────────────────────────────────
async function caseRefreshCount() {
  console.log("\n(e) 삭제 시 refresh 횟수 (성능, 수정 2):");
  const store = makeFakeStore({ addMode: "put" });
  const pts = seed(store);
  commitTransform(store, pts, "S", ROT, ROTATED, "fixed");
  await delay(200);
  assert(
    store.refreshCount === 1,
    `재설계 점 3개 삭제에 refresh 1회 (실제: ${store.refreshCount}회)`,
  );

  // 대조군: 점당 삭제면 N회.
  const racy = makeFakeStore({ addMode: "put" });
  const pts2 = seed(racy);
  commitTransform(racy, pts2, "S", ROT, ROTATED, "racy");
  await delay(300);
  assert(
    racy.refreshCount === 3,
    `수정 전 방식은 refresh 3회 (실제: ${racy.refreshCount}회) — 대조군`,
  );
}

// ── (f) 순수 XZ 이동은 아무것도 삭제하지 않는다 ──────────────────────────
async function caseXZMoveNoDelete() {
  console.log("\n(f) 순수 XZ 평행이동 → 삭제 없음:");
  const store = makeFakeStore({ addMode: "put" });
  const pts = seed(store);
  const entry = commitTransform(
    store,
    pts,
    "S",
    ROT,
    { ...ROT, tx: 30, tz: -10 },
    "fixed",
  );
  await delay(200);
  assert(entry.invalidated.length === 0, "무효화 대상 0개");
  assert(store.ids().join(",") === "r1,r2,r3,w1", "모든 점 그대로 유지");
  assert(store.refreshCount === 0, "쓸데없는 refresh 도 없음");
  assert(entry.notice() === 0, "안내 배너도 뜨지 않음");
}

// ── (g) 다른 STL 의 재설계 점은 건드리지 않는다 ──────────────────────────
async function caseOtherStlUntouched() {
  console.log("\n(g) 다른 STL 의 재설계 점은 무사:");
  const store = makeFakeStore({ addMode: "put" });
  const pts = seed(store);
  const other = { id: "o1", stlId: "T", kind: "island", coordSpace: "stl-local" };
  store.rows.set("o1", other);
  const entry = commitTransform(store, [...pts, other], "S", ROT, ROTATED, "fixed");
  await delay(200);
  assert(entry.invalidated.every((s) => s.stlId === "S"), "삭제 대상은 STL S 뿐");
  assert(store.rows.has("o1"), "STL T 의 재설계 점은 그대로");
}

async function main() {
  console.log("무효화 삭제 ↔ undo 순서 보장 검증 (B-1 재작업)");
  await caseImmediateUndoFixed();
  await caseImmediateUndoRacy();
  await caseUndoRedoRoundTrip();
  await caseNormalTimingUndo();
  await caseRefreshCount();
  await caseXZMoveNoDelete();
  await caseOtherStlUntouched();
  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
