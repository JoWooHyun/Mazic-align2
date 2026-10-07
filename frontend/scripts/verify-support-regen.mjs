// 자동 서포트 재실행 = 교체 + undo · 생성 대상 모델 고정 · 뷰어 이탈 시 저장 금지
//   헤드리스 검증 (정리_20261001 §1-2 D5 / §4-2 신규 8·9·11).
//
//   결함:
//     · 신규 8(D5) — 자동 서포트를 다시 누르면 기존을 지우지 않고 **추가**해 두 세트가
//       겹쳤다. undo 는 새 세트 id 만 지웠다.
//     · 신규 9 — 재설계 생성(워커 검출, 수 초~수십 초) 도중 다른 모델을 클릭하면 라우팅
//       확정이 **끝나는 시점의 선택**을 다시 읽어, 점의 stlId 는 시작 모델인데 좌표는
//       다른 모델 기준으로 변환돼 저장됐다.
//     · 신규 11 — 생성 도중 뷰어를 떠나면 씬 핸들이 사라져 라우팅을 못 하는데, 호출 측이
//       `routed?.points ?? res.points` 로 **라우팅 전 원시 점**을 DB 에 저장했다.
//
//   수정:
//     · pages/viewer/utils/auto-support-replace.ts — 교체 계획(planAutoSupportReplace)·
//       교체+undo(applyAutoSupportReplace)·gen 가드 push(makeUndoPusher)·재설계 마무리
//       (commitRedesignGeneration: 취소 신호·원시 점 폴백 금지).
//     · data/supports.repo.ts replaceSupportsInProject — 고르기·삭제·추가 한 transaction.
//     · components/babylon/redesign-target.ts + redesign-detect-actions.ts — 시작 시점
//       stlId·world 행렬로만 확정(선택 무시, 이동·소멸 시 거절).
//     · 세 생성 경로(Support "자동 생성" / Dental "검출 영역 자동 서포트" / "서포트 생성
//       (재설계)") 배선 + 뷰어 언마운트 시 검출 취소.
//
//   검증 방법:
//     (a)~(e) 실제 모듈을 import 해 가짜 저장소(IndexedDB transaction 의 원자성을 흉내 —
//         실패 주입 시 아무것도 안 바뀜) + **실제 useUndoStore** 로 교체·undo·redo 를 돌린다.
//     (f)~(g) 재설계 확정을 NullEngine 씬(모델 2개)에서 실제 routeAndFinalizePoints 로 돌린다.
//     (h) 재설계 마무리(commitRedesignGeneration)의 취소·폴백 규칙.
//     (i) 훅·저장소 배선은 소스 정적 검사(훅은 React + `?worker` import 체인이라 tsx 로 못
//         불러온다 — layer-count.ts 주석 참조).
//
//   ★ 대조군 원칙(프로젝트 규약): (j) 에서 결함 구현(수정 전 동작·변조)을 같은 시나리오에
//     돌려 **실제로 걸리는지** 확인한다. 안 걸리면 이 스크립트가 결함을 못 잡는다는 뜻이므로
//     그 자체를 FAIL 로 센다. 대조군:
//       M1 교체 대신 추가(수정 전 동작) · M2 수동까지 지움 · M3 다른 모델 것까지 지움 ·
//       M4 undo 가 새 세트만 지우고 옛 세트 복원 안 함 · M5 선택 변경을 따라감 ·
//       M6 언마운트 후 저장(원시 점 폴백) · M7 생성 중 모델 이동 무시 · M8 clear 뒤 push ·
//       M9 삭제·추가 2단계(비원자) · M10 부착된 점까지 지움 · M11 world 행렬을 사본 아닌 참조로.
//
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "결함 재현" 문자열을 출력한다.
//   exit 0 = 실제 모듈 전 항목 통과 AND 대조군 전부 결함 재현.
//
//   실행: npx tsx scripts/verify-support-regen.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Matrix,
  MeshBuilder,
  NullEngine,
  Scene,
  Vector3,
} from "@babylonjs/core";

import {
  applyAutoSupportReplace,
  commitRedesignGeneration,
  formatAutoReplaceNotice,
  makeUndoPusher,
  planAutoSupportReplace,
} from "../src/features/v2/pages/viewer/utils/auto-support-replace.ts";
import { useUndoStore } from "../src/features/v2/hooks/useUndoStore.ts";
import {
  resolveRedesignTarget,
  sameWorldMatrix,
} from "../src/features/v2/components/babylon/redesign-target.ts";
import {
  prepareRedesignDetectInput,
  routeAndFinalizePoints,
} from "../src/features/v2/components/babylon/redesign-detect-actions.ts";
import { getActiveStl } from "../src/features/v2/components/babylon/scene-actions.ts";
import { DEFAULT_SUPPORT_PARAMS } from "../src/features/v2/support/utils/defaults.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const V2 = join(__dirname, "..", "src", "features", "v2");
// CRLF 체크아웃(autocrlf)에서도 같은 판정이 나오게 줄바꿈을 LF 로 맞춘다.
const readSrc = (rel) =>
  readFileSync(join(V2, rel), "utf8").replace(/\r\n/g, "\n");

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

/** 실제 모듈의 console.warn(undo 실패 항목 폐기 로그)을 잠시 묵음. */
const origWarn = console.warn;
const muteWarn = () => {
  console.warn = () => {};
};
const restoreWarn = () => {
  console.warn = origWarn;
};

const clone = (v) => structuredClone(v);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 시나리오 데이터 ──────────────────────────────────────────────────────
const P = "proj-1";
let seq = 0;
function pt(id, stlId, source, extra = {}) {
  seq++;
  return {
    id,
    projectId: P,
    stlId,
    contact: [seq * 1.5, 10 + seq * 0.1, -seq * 0.7],
    base: [seq * 1.5, 0, -seq * 0.7],
    source,
    addedAt: 1000 + seq,
    ...extra,
  };
}

/** 모델 A: 자동 3(일반 2 + 재설계 1) + 수동 1 + 브릿지 1, 모델 B: 자동 2. 다른 프로젝트 점 1. */
function initialRows() {
  seq = 0;
  return [
    pt("a1", "A", "auto"),
    pt("a2", "A", "auto"),
    pt("a3", "A", "auto", { kind: "slope", tipRadius: 0.3, coordSpace: "stl-local" }),
    pt("m1", "A", "manual", { contactNormal: [0, -1, 0] }),
    pt("br1", "A", "bridge", {
      baseStlId: "B",
      curveControlPoints: [
        [1, 2, 3],
        [2, 3, 4],
        [3, 4, 5],
      ],
    }),
    pt("b1", "B", "auto"),
    pt("b2", "B", "auto"),
    { ...pt("x1", "A", "auto"), projectId: "other-project" },
  ];
}

/** 새로 생성된 자동 세트 (모델 A 4개). */
function newSetA() {
  return [
    pt("n1", "A", "auto"),
    pt("n2", "A", "auto"),
    pt("n3", "A", "auto", { kind: "island", tipRadius: 0.25, coordSpace: "stl-local" }),
    pt("n4", "A", "auto"),
  ];
}

/**
 * IndexedDB 서포트 store 흉내 — replaceSupportsInProject 계약.
 *   · 프로젝트 점만 pick 에 넘기고, 고른 id 삭제 + add put 을 **원자적**으로.
 *   · failAtCall(k): 이 저장소의 k 번째(1부터) replace 호출을 실패시킨다(tx abort
 *     흉내 — 아무것도 안 바뀐 채 reject). 레코드는 structuredClone 으로 오간다.
 */
function makeFakeDb(rows) {
  const map = new Map(rows.map((r) => [r.id, clone(r)]));
  let calls = 0;
  const failAt = new Set();
  return {
    failAtCall(k) {
      failAt.add(k);
    },
    get calls() {
      return calls;
    },
    async replace(pick, add) {
      calls++;
      await new Promise((r) => setTimeout(r, 1));
      const existing = [...map.values()]
        .filter((r) => r.projectId === P)
        .map(clone);
      const ids = new Set(pick(existing));
      if (failAt.has(calls)) throw new Error(`주입된 실패 (replace #${calls})`);
      const removed = existing.filter((r) => ids.has(r.id));
      for (const r of removed) map.delete(r.id);
      for (const r of add) map.set(r.id, clone(r));
      return removed;
    },
    snapshot() {
      return [...map.values()].map(clone).sort(byId);
    },
  };
}

// ── 교체 구현 묶음 (실제 / 대조군) ────────────────────────────────────────
/** 실제 모듈. */
const REAL = {
  name: "실제 모듈",
  plan: planAutoSupportReplace,
  apply: applyAutoSupportReplace,
  makePusher: makeUndoPusher,
};

/**
 * 대조군용 교체 구현 — 결함을 골라 끼운다. (실제 apply 의 모양을 따르되 한 곳씩 틀리게.)
 *   opts.plan       : 교체 계획 함수
 *   opts.appendOnly : 교체 대신 추가 + undo 는 새 id 만 삭제 (수정 전 handleAutoGenerate)
 *   opts.undoNoRestore : undo 가 새 세트만 지우고 옛 세트를 안 되돌림
 *   opts.twoStep    : 삭제·추가를 replace 2번으로 나눔(비원자)
 */
function makeMutantApply(opts) {
  return async (args) => {
    const { label, targetStlIds, replace, refresh, pushUndo } = args;
    const generated = args.generated.slice();
    const addedIds = generated.map((p) => p.id);
    if (opts.appendOnly) {
      await replace(() => [], generated);
      pushUndo({
        label,
        undo: async () => {
          await replace(() => addedIds, []);
          await refresh();
        },
        redo: async () => {
          await replace(() => [], generated);
          await refresh();
        },
      });
      await refresh();
      return { removedCount: 0, addedCount: generated.length, keptAttachedCount: 0 };
    }
    const pick = (existing) => opts.plan(existing, targetStlIds).removeIds;
    let removed;
    if (opts.twoStep) {
      removed = await replace(pick, []);
      await replace(() => [], generated);
    } else {
      removed = await replace(pick, generated);
    }
    const removedIds = removed.map((p) => p.id);
    pushUndo({
      label,
      undo: async () => {
        await replace(() => addedIds, opts.undoNoRestore ? [] : removed);
        await refresh();
      },
      redo: async () => {
        await replace(() => removedIds, generated);
        await refresh();
      },
    });
    await refresh();
    return { removedCount: removed.length, addedCount: generated.length, keptAttachedCount: 0 };
  };
}

/** M2 — 수동까지 지움 (브릿지만 남김). */
const planDeleteManualToo = (existing, targets) => ({
  removeIds: existing
    .filter((s) => s.source !== "bridge" && targets.has(s.stlId))
    .map((s) => s.id),
  keptAttachedIds: [],
});
/** M3 — 대상 모델 무시 (모든 모델의 자동 서포트). */
const planIgnoreTarget = (existing) => ({
  removeIds: existing.filter((s) => s.source === "auto").map((s) => s.id),
  keptAttachedIds: [],
});
/** M10 — 부착 보호 없음 (대상 모델 자동 전부). */
const planIgnoreAttach = (existing, targets) => ({
  removeIds: existing
    .filter((s) => s.source === "auto" && targets.has(s.stlId))
    .map((s) => s.id),
  keptAttachedIds: [],
});
/** M8 — gen 무시 push. */
const pusherIgnoringGen = () => (entry) => useUndoStore.getState().push(entry);

// ── 교체 시나리오 (실제·대조군 공용) ─────────────────────────────────────
/**
 * 교체 시나리오를 돌리고 [라벨, 통과여부] 목록을 돌려준다(출력은 호출 측).
 *   impl = { plan, apply, makePusher }
 */
async function runReplaceScenarios(impl) {
  const checks = [];
  const check = (label, ok) => checks.push([label, Boolean(ok)]);
  const undo = useUndoStore.getState();

  // ── (1) 교체 → undo → redo ────────────────────────────────────────────
  {
    undo.clear();
    const db = makeFakeDb(initialRows());
    const before = db.snapshot();
    const gen = newSetA();
    let refreshes = 0;
    const result = await impl.apply({
      label: "auto-supports",
      targetStlIds: new Set(["A"]),
      generated: gen,
      replace: (pick, add) => db.replace(pick, add),
      refresh: async () => {
        refreshes++;
      },
      pushUndo: impl.makePusher(),
    });
    const after = db.snapshot();
    const autoA = after.filter((r) => r.projectId === P && r.stlId === "A" && r.source === "auto");
    check(
      "교체: 모델 A 의 자동 서포트 = 새 세트만 (옛 자동 3개 없음)",
      sameJson(autoA.map((r) => r.id).sort(), ["n1", "n2", "n3", "n4"]),
    );
    check(
      "교체: 새 세트 좌표·필드가 생성값 그대로",
      sameJson(autoA, gen.map(clone).sort(byId)),
    );
    const keepIds = ["m1", "br1", "b1", "b2", "x1"];
    check(
      "교체: 수동·브릿지·모델 B 자동·다른 프로젝트 점은 그대로(전 필드)",
      keepIds.every((id) =>
        sameJson(
          after.find((r) => r.id === id),
          before.find((r) => r.id === id),
        ),
      ),
    );
    check("교체: 전체 개수 = 새 4 + 수동 1 + 브릿지 1 + B 자동 2 + 타 프로젝트 1", after.length === 9);
    check(
      "교체: 결과 요약 removed 3 · added 4",
      result.removedCount === 3 && result.addedCount === 4,
    );
    check("교체: undo 항목 1개", useUndoStore.getState().past.length === 1);
    check("교체: 재조회 1회 이상", refreshes >= 1);

    await useUndoStore.getState().undo();
    check("undo 1회: 교체 전 상태로 정확히 복귀(id·좌표·전 필드)", sameJson(db.snapshot(), before));
    await useUndoStore.getState().redo();
    check("redo: 새 세트 상태로 정확히 복귀", sameJson(db.snapshot(), after));
    await useUndoStore.getState().undo();
    check("undo 다시: 또 정확히 교체 전", sameJson(db.snapshot(), before));
  }

  // ── (2) 대상 모델 범위: 생성이 A·B 를 다뤘는데 새 점은 A 만 ─────────────
  {
    undo.clear();
    const db = makeFakeDb(initialRows());
    await impl.apply({
      label: "auto-supports",
      targetStlIds: new Set(["A", "B"]),
      generated: newSetA(),
      replace: (pick, add) => db.replace(pick, add),
      refresh: async () => {},
      pushUndo: impl.makePusher(),
    });
    const after = db.snapshot();
    check(
      "다룬 모델 A·B: B 의 옛 자동도 교체(새 점 0 → 없어짐), 수동·브릿지 그대로",
      !after.some((r) => r.id === "b1" || r.id === "b2") &&
        after.some((r) => r.id === "m1") &&
        after.some((r) => r.id === "br1"),
    );
  }

  // ── (3) 교체 중 실패 주입 → 상태 보존, undo 미등록 ─────────────────────
  {
    undo.clear();
    const db = makeFakeDb(initialRows());
    const before = db.snapshot();
    db.failAtCall(1);
    let rejected = false;
    try {
      await impl.apply({
        label: "auto-supports",
        targetStlIds: new Set(["A"]),
        generated: newSetA(),
        replace: (pick, add) => db.replace(pick, add),
        refresh: async () => {},
        pushUndo: impl.makePusher(),
      });
    } catch {
      rejected = true;
    }
    check("첫 저장 실패: 호출이 실패를 알린다(reject)", rejected);
    check("첫 저장 실패: 저장소는 교체 전 그대로", sameJson(db.snapshot(), before));
    check("첫 저장 실패: undo 항목 없음", useUndoStore.getState().past.length === 0);
  }
  {
    // 두 번째 저장 호출이 실패해도 "전부 옛것" 또는 "전부 새것" 중 하나여야 한다.
    undo.clear();
    const db = makeFakeDb(initialRows());
    const before = db.snapshot();
    db.failAtCall(2);
    try {
      await impl.apply({
        label: "auto-supports",
        targetStlIds: new Set(["A"]),
        generated: newSetA(),
        replace: (pick, add) => db.replace(pick, add),
        refresh: async () => {},
        pushUndo: impl.makePusher(),
      });
    } catch {
      /* 결과 상태만 본다 */
    }
    const s = db.snapshot();
    const ids = s.map((r) => r.id).sort().join(",");
    const allOld = sameJson(s, before);
    const allNew = ids === "b1,b2,br1,m1,n1,n2,n3,n4,x1";
    check("중간 실패 주입: 반쯤 바뀐 상태 없음(전부 옛것 또는 전부 새것)", allOld || allNew);
  }
  {
    // undo 실패 → 상태 보존(새 세트 그대로) + 항목 폐기(이력 안 막힘).
    undo.clear();
    const db = makeFakeDb(initialRows());
    await impl.apply({
      label: "auto-supports",
      targetStlIds: new Set(["A"]),
      generated: newSetA(),
      replace: (pick, add) => db.replace(pick, add),
      refresh: async () => {},
      pushUndo: impl.makePusher(),
    });
    const afterReplace = db.snapshot();
    db.failAtCall(db.calls + 1);
    muteWarn();
    await useUndoStore.getState().undo();
    restoreWarn();
    check("undo 실패 주입: 저장소는 교체 후 상태 그대로", sameJson(db.snapshot(), afterReplace));
    const st = useUndoStore.getState();
    check("undo 실패 주입: 실패 항목 폐기(past·future 비어 있음)", st.past.length === 0 && st.future.length === 0);
  }

  // ── (4) 생성 도중 이력 끊김(clear) → 끝난 항목을 새 이력에 넣지 않음 ─────
  {
    undo.clear();
    const db = makeFakeDb(initialRows());
    const pusher = impl.makePusher();
    useUndoStore.getState().clear(); // 프로젝트 전환·뷰어 이탈·STL 삭제
    await impl.apply({
      label: "auto-supports",
      targetStlIds: new Set(["A"]),
      generated: newSetA(),
      replace: (pick, add) => db.replace(pick, add),
      refresh: async () => {},
      pushUndo: pusher,
    });
    check("clear 뒤 끝난 교체: undo 항목을 새 이력에 넣지 않음", useUndoStore.getState().past.length === 0);
  }

  // ── (5) 부착 보호: 남는 브릿지가 가리키는 자동 점(+기둥 합류 주인)은 유지 ──
  {
    seq = 100;
    const existing = [
      pt("c1", "A", "auto"),
      pt("c2", "A", "auto", { kind: "island", joinPillarPointId: "c3" }),
      pt("c3", "A", "auto", { kind: "island" }),
      pt("c4", "A", "auto"),
      pt("bb", "A", "bridge", { contactAttachedTo: { supportId: "c2", t: 0.5 } }),
      pt("bd", "B", "bridge", { baseAttachedTo: { supportId: "c4", t: 0.2 } }),
      pt("d1", "B", "auto"),
    ];
    const plan = impl.plan(existing, new Set(["A"]));
    check(
      "부착 보호: 지울 것 = c1 만 (브릿지 부착 c2·c4, c2 의 기둥 주인 c3 유지)",
      sameJson([...plan.removeIds].sort(), ["c1"]),
    );
    check(
      "부착 보호: 유지 목록 = c2·c3·c4",
      sameJson([...plan.keptAttachedIds].sort(), ["c2", "c3", "c4"]),
    );
  }

  return checks;
}

// ── 재설계 확정 (NullEngine) ─────────────────────────────────────────────
const engine = new NullEngine();
const scene = new Scene(engine);

/** 모델 A·B 와 SceneCtx 의 필요한 부분(sceneRef·meshMapRef·selectedRef). */
function makeSceneCtx() {
  for (const m of scene.meshes.slice()) m.dispose();
  const a = MeshBuilder.CreateBox("A", { size: 10 }, scene);
  a.position.set(0, 10, 0); // 바닥면 y = 5
  const b = MeshBuilder.CreateBox("B", { size: 10 }, scene);
  b.position.set(40, 12, -8);
  b.rotation.set(0, 0.7, 0.2);
  b.scaling.set(1.5, 1.2, 0.9);
  a.computeWorldMatrix(true);
  b.computeWorldMatrix(true);
  const ctx = {
    sceneRef: { current: scene },
    meshMapRef: { current: new Map([["A", a], ["B", b]]) },
    selectedRef: { current: new Set(["A"]) },
  };
  return { ctx, a, b };
}

/** A 바닥면(y=5) 아래 접점 4개 — 워커가 만든 원시 점 모양(world, base 플레이트). */
function rawPointsOn(stlId) {
  const out = [];
  for (const x of [-2, 2]) {
    for (const z of [-2, 2]) {
      out.push({
        id: `r${x}${z}`,
        projectId: P,
        stlId,
        contact: [x, 5, z],
        base: [x, 0, z],
        source: "auto",
        kind: "island",
        tipRadius: 0.3,
        addedAt: 1,
      });
    }
  }
  return out;
}

const toWorldWith = (mesh, p) => {
  const v = Vector3.TransformCoordinates(new Vector3(p[0], p[1], p[2]), mesh.getWorldMatrix());
  return [v.x, v.y, v.z];
};

/**
 * 재설계 확정 시나리오 — [라벨, 통과여부] 목록.
 *   route(ctx, points, target) = 확정 함수(실제 또는 대조군).
 *   capture(ctx) = 시작 시점 대상 잡기(실제: prepareRedesignDetectInput).
 */
function runRedesignScenarios(route, capture) {
  const checks = [];
  const check = (label, ok) => checks.push([label, Boolean(ok)]);

  // (1) 생성 중 선택이 B 로 바뀜 → 결과는 시작 모델 A 기준.
  {
    const { ctx, a } = makeSceneCtx();
    const target = capture(ctx);
    const raw = rawPointsOn(target.stlId);
    ctx.selectedRef.current = new Set(["B"]); // 생성 도중 B 클릭
    const res = route(ctx, raw, target);
    const pts = res.ok ? res.points : [];
    check("선택 변경: 확정 성공", res.ok && pts.length === raw.length);
    check("선택 변경: 결과 stlId 전부 시작 모델 A", pts.length > 0 && pts.every((p) => p.stlId === "A"));
    const worst = Math.max(
      ...pts.map((p, i) => {
        const w = toWorldWith(a, p.contact);
        return Math.hypot(w[0] - raw[i].contact[0], w[1] - raw[i].contact[1], w[2] - raw[i].contact[2]);
      }),
    );
    check(
      `선택 변경: 저장 좌표를 A 행렬로 되돌리면 검출 접점과 일치 (최대 오차 ${worst.toFixed(4)}mm < 0.01)`,
      pts.length > 0 && worst < 0.01,
    );
  }

  // (2) 생성 중 시작 모델이 움직임 → 저장하지 않음(거절).
  {
    const { ctx, a } = makeSceneCtx();
    const target = capture(ctx);
    const raw = rawPointsOn(target.stlId);
    a.position.x += 5; // 생성 도중 A 를 옮김
    a.computeWorldMatrix(true);
    const res = route(ctx, raw, target);
    check("생성 중 이동: 확정 거절(ok:false) — 어긋난 서포트 저장 안 함", res.ok === false);
  }

  // (3) 생성 중 시작 모델이 사라짐 → 거절.
  {
    const { ctx } = makeSceneCtx();
    const target = capture(ctx);
    const raw = rawPointsOn(target.stlId);
    ctx.meshMapRef.current.delete("A");
    const res = route(ctx, raw, target);
    check("생성 중 모델 삭제: 확정 거절(ok:false)", res.ok === false);
  }

  // (4) 씬이 없음(언마운트) → 원시 점을 돌려주지 않음.
  {
    const { ctx } = makeSceneCtx();
    const target = capture(ctx);
    const raw = rawPointsOn(target.stlId);
    ctx.sceneRef.current = null;
    const res = route(ctx, raw, target);
    check("씬 없음: 확정 거절(원시 점 반환 없음)", res.ok === false && !("points" in res));
  }

  return checks;
}

/** 실제 시작 시점 캡처 — prepareRedesignDetectInput 의 stlId·worldMatrix. */
const realCapture = (ctx) => {
  const prep = prepareRedesignDetectInput(ctx);
  if (!prep.ok) throw new Error(prep.reason);
  return { stlId: prep.stlId, worldMatrix: prep.worldMatrix };
};
const realRoute = (ctx, points, target) =>
  routeAndFinalizePoints(ctx, points, DEFAULT_SUPPORT_PARAMS, target);

// ── 재설계 마무리(신규 11) 시나리오 ──────────────────────────────────────
const ROUTED_REPORT = { input: 4, afterDedupe: 4, failed: 0 };
async function runCommitScenarios(commit) {
  const checks = [];
  const check = (label, ok) => checks.push([label, Boolean(ok)]);
  const raw = rawPointsOn("A");
  const routedPts = raw.map((p) => ({ ...p, coordSpace: "stl-local", contact: [p.contact[0], -5, p.contact[2]] }));
  const okRoute = () => ({ ok: true, points: routedPts, report: ROUTED_REPORT });

  const run = async ({ cancelled, route, flipDuringRoute = false }) => {
    let isCancelled = cancelled;
    const saves = [];
    const outcome = await commit({
      isCancelled: () => isCancelled,
      route: () => {
        if (flipDuringRoute) isCancelled = true;
        return route();
      },
      save: async (points) => {
        saves.push(points);
        return { removedCount: 0, addedCount: points.length, keptAttachedCount: 0 };
      },
      rawPoints: raw, // 대조군(수정 전 동작)만 쓰는 값
    });
    return { outcome, saves };
  };

  {
    const { saves, outcome } = await run({ cancelled: true, route: okRoute });
    check("언마운트 후(취소 신호) 결과 도착: 저장 함수 호출 0회", saves.length === 0 && outcome.kind === "cancelled");
  }
  {
    const { saves } = await run({ cancelled: false, route: () => undefined });
    check("씬 핸들 없음(라우팅 불가): 저장 0회 — 원시 점 폴백 없음", saves.length === 0);
  }
  {
    const { saves } = await run({ cancelled: false, route: okRoute, flipDuringRoute: true });
    check("라우팅 중 언마운트: 저장 0회", saves.length === 0);
  }
  {
    const { saves, outcome } = await run({
      cancelled: false,
      route: () => ({ ok: false, reason: "생성 중 모델이 움직여 결과를 저장하지 않았습니다." }),
    });
    check("확정 거절(신규 9): 저장 0회 + 사유 전달", saves.length === 0 && outcome.kind === "rejected");
  }
  {
    const { saves, outcome } = await run({
      cancelled: false,
      route: () => ({ ok: true, points: [], report: ROUTED_REPORT }),
    });
    check("라우팅 뒤 0개: 저장 0회(기존 유지)", saves.length === 0 && outcome.kind === "empty");
  }
  {
    const { saves, outcome } = await run({ cancelled: false, route: okRoute });
    check(
      "정상: 저장 1회, 라우팅된 점만(원시 점 아님)",
      saves.length === 1 && saves[0] === routedPts && outcome.kind === "saved",
    );
  }
  return checks;
}

/** M6 대조군 — 수정 전 handleGenerateRedesignSupports 의 저장 결정. */
async function legacyCommit({ route, save, rawPoints }) {
  const routed = route();
  const finalized = routed?.points ?? rawPoints;
  if (finalized.length === 0) return { kind: "empty" };
  await save(finalized);
  return { kind: "saved" };
}

// ── 출력 헬퍼 ─────────────────────────────────────────────────────────────
function report(checks) {
  for (const [label, ok] of checks) assert(ok, label);
}
/** 대조군: 결함이 실제로 걸렸는가(실패 항목 1개 이상). */
function expectCaught(name, checks) {
  const caught = checks.filter(([, ok]) => !ok).map(([l]) => l);
  if (caught.length > 0) {
    console.log(`  ok: 대조군 ${name} — 결함 재현(걸린 항목 ${caught.length}): ${caught[0]}`);
  } else {
    failed++;
    console.error(`  FAIL: 대조군 ${name} — 결함을 못 잡음(모든 항목 통과)`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("(a)~(e) 자동 서포트 교체·undo·redo·실패 주입·gen·부착 보호 — 실제 모듈:");
report(await runReplaceScenarios(REAL));

console.log("\n(e') 안내 문구:");
{
  const msg = formatAutoReplaceNotice({ removedCount: 3, addedCount: 4, keptAttachedCount: 0 });
  assert(msg != null && msg.includes("3개") && msg.includes("4개") && msg.includes("Ctrl+Z"), `교체 안내: "${msg}"`);
  assert(
    formatAutoReplaceNotice({ removedCount: 0, addedCount: 5, keptAttachedCount: 0 }) === null,
    "첫 생성(지운 것 없음)은 안내 없음",
  );
  const kept = formatAutoReplaceNotice({ removedCount: 2, addedCount: 3, keptAttachedCount: 1 });
  assert(kept != null && kept.includes("1개는 유지"), `부착 유지 안내: "${kept}"`);
}

console.log("\n(f) 재설계 시작 시점 캡처 — prepareRedesignDetectInput:");
{
  const { ctx, a } = makeSceneCtx();
  const target = realCapture(ctx);
  assert(target.stlId === "A", "선택된 A 를 대상으로 잡음");
  const startCopy = target.worldMatrix.slice();
  assert(sameWorldMatrix(target.worldMatrix, a.getWorldMatrix().asArray()), "world 행렬 = A 의 현재 행렬");
  a.position.y += 3;
  a.computeWorldMatrix(true);
  assert(
    sameJson(target.worldMatrix, startCopy),
    "잡아 둔 행렬은 사본 — 이후 A 를 움직여도 값이 안 바뀜",
  );
  // 순수 판정 함수.
  const map = new Map([["A", { w: startCopy }], ["B", { w: Matrix.Identity().asArray() }]]);
  const r1 = resolveRedesignTarget(map, { stlId: "A", worldMatrix: startCopy }, (m) => m.w);
  assert(r1.ok && r1.mesh === map.get("A"), "resolveRedesignTarget: 같은 자세면 A 메시");
  const moved = startCopy.slice();
  moved[13] += 0.01;
  const r2 = resolveRedesignTarget(map, { stlId: "A", worldMatrix: moved }, (m) => m.w);
  assert(!r2.ok, "resolveRedesignTarget: 0.01mm 이동도 거절");
  const jitter = startCopy.slice();
  jitter[0] += 1e-6;
  assert(sameWorldMatrix(jitter, startCopy), "sameWorldMatrix: 1e-6 반올림 흔들림은 같은 자세");
  const r3 = resolveRedesignTarget(map, { stlId: "Z", worldMatrix: startCopy }, (m) => m.w);
  assert(!r3.ok, "resolveRedesignTarget: 없는 모델이면 거절");
}

console.log("\n(g) 재설계 확정 — 생성 중 선택 변경·이동·삭제·씬 소멸 (NullEngine, 실제 routeAndFinalizePoints):");
report(runRedesignScenarios(realRoute, realCapture));

console.log("\n(h) 재설계 마무리 — 뷰어 이탈 시 저장 금지 (실제 commitRedesignGeneration):");
report(await runCommitScenarios(commitRedesignGeneration));

// ── (i) 배선 소스 정적 검사 ───────────────────────────────────────────────
console.log("\n(i) 배선 소스 정적 검사:");

/** start 마커부터 그 뒤 첫 `\n  }, [` (useCallback deps 시작)까지. */
function callbackBody(src, startMarker) {
  const s = src.indexOf(startMarker);
  if (s < 0) return "";
  const e = src.indexOf("\n  }, [", s);
  return e < 0 ? src.slice(s) : src.slice(s, e);
}
/** `export async function name(` 부터 다음 `\nexport ` 까지. */
function exportedFnBody(src, name) {
  const s = src.indexOf(`export async function ${name}(`) >= 0
    ? src.indexOf(`export async function ${name}(`)
    : src.indexOf(`export function ${name}(`);
  if (s < 0) return "";
  const e = src.indexOf("\nexport ", s + 1);
  return e < 0 ? src.slice(s) : src.slice(s, e);
}
const count = (s, sub) => s.split(sub).length - 1;

/** 배선 검사 묶음 — 소스 문자열 묶음을 받아 [라벨, 통과] 목록. */
function wiringChecks(src) {
  const checks = [];
  const check = (label, ok) => checks.push([label, Boolean(ok)]);

  const auto = callbackBody(src.supportEditing, "const handleAutoGenerate = useCallback(");
  check(
    "Support 탭 자동 생성: applyAutoSupportReplace + replaceSupportsInProject 경유",
    auto.includes("applyAutoSupportReplace(") && auto.includes("replaceSupportsInProject("),
  );
  check(
    "Support 탭 자동 생성: 교체 범위 = 씬이 다룬 모델(targetStlIds)",
    auto.includes("targetStlIds: new Set(out.targetStlIds)"),
  );
  check("Support 탭 자동 생성: addSupports 로 추가만 하지 않음", auto !== "" && !auto.includes("addSupports("));

  const island = callbackBody(src.dental, "const handleAutoSupportIslands = useCallback(");
  check(
    "검출 영역 자동 서포트: applyAutoSupportReplace 경유, addSupports 없음",
    island.includes("applyAutoSupportReplace(") && island !== "" && !island.includes("addSupports("),
  );

  const redesign = callbackBody(src.dental, "const handleGenerateRedesignSupports = useCallback(");
  check(
    "재설계 생성: commitRedesignGeneration + applyAutoSupportReplace 경유",
    redesign.includes("commitRedesignGeneration(") && redesign.includes("applyAutoSupportReplace("),
  );
  check(
    "재설계 생성: 취소 신호 = 언마운트(aliveRef)",
    redesign.includes("isCancelled: () => !aliveRef.current"),
  );
  check(
    "재설계 생성: 확정에 시작 시점 target 을 넘김",
    /routeAndFinalizeRedesignPoints\(\s*res\.points,\s*supportParams,\s*target,?\s*\)/.test(redesign),
  );
  check("재설계 생성: 원시 점 폴백(`?? res.points`) 없음", !src.dental.includes("?? res.points"));
  check(
    "재설계 생성: 교체 범위 = 시작 모델 하나",
    redesign.includes("targetStlIds: new Set([target.stlId])"),
  );
  check(
    "언마운트 cleanup: aliveRef=false + 검출 취소",
    /return \(\) => \{\s*aliveRef\.current = false;\s*detectService\.cancel\(\);\s*\};/.test(src.dental),
  );
  check(
    "검출 시작 시 대상 캡처: target = { stlId: prep.stlId, worldMatrix: prep.worldMatrix }",
    /stlId: prep\.stlId,\s*worldMatrix: prep\.worldMatrix/.test(src.dental),
  );

  const routeFn = src.actions.slice(src.actions.indexOf("export function routeAndFinalizePoints("));
  check(
    "routeAndFinalizePoints: 현재 선택(getActiveStl)을 읽지 않고 target 으로 메시 결정",
    !routeFn.includes("getActiveStl(") && routeFn.includes("resolveRedesignTarget("),
  );
  check(
    "prepareRedesignDetectInput: world 행렬 사본(Array.from) 반환",
    src.actions.includes("Array.from(active.mesh.getWorldMatrix().asArray())"),
  );
  check(
    "generateAutoSupports: 다룬 모델 목록(targetStlIds) 반환",
    src.genHandle.includes("return { points: out, targetStlIds }"),
  );

  const repoFn = exportedFnBody(src.repo, "replaceSupportsInProject");
  check(
    "replaceSupportsInProject: 고르기·삭제·추가가 transaction 1개 안",
    repoFn !== "" &&
      count(repoFn, "db.transaction(") === 1 &&
      repoFn.includes("store.delete(") &&
      repoFn.includes("store.put(") &&
      repoFn.indexOf("pickRemoveIds(existing)") > repoFn.indexOf("openCursor("),
  );
  check(
    "replaceSupportsInProject: 완료·에러·중단 처리를 공용 settleTx 로(abort 시 reject — pickError 우선)",
    repoFn.includes("settleTx(tx, () => resolve(removed), (err) => reject(pickError ?? err))"),
  );
  return checks;
}

const SRC = {
  supportEditing: readSrc("pages/viewer/hooks/useSupportEditing.ts"),
  dental: readSrc("pages/viewer/hooks/useDentalWorkflow.ts"),
  actions: readSrc("components/babylon/redesign-detect-actions.ts"),
  genHandle: readSrc("components/babylon/handle/support-gen-handle.ts"),
  repo: readSrc("data/supports.repo.ts"),
};
report(wiringChecks(SRC));

// ── (j) 대조군 ───────────────────────────────────────────────────────────
console.log("\n(j) 대조군 — 결함 구현이 같은 시나리오에서 실제로 걸리는가:");
const mutant = (name, overrides) => ({ ...REAL, name, ...overrides });

expectCaught(
  "M1 교체 대신 추가(수정 전 동작)",
  await runReplaceScenarios(mutant("M1", { apply: makeMutantApply({ appendOnly: true }) })),
);
expectCaught(
  "M2 수동까지 지움",
  await runReplaceScenarios(
    mutant("M2", { plan: planDeleteManualToo, apply: makeMutantApply({ plan: planDeleteManualToo }) }),
  ),
);
expectCaught(
  "M3 다른 모델 것까지 지움",
  await runReplaceScenarios(
    mutant("M3", { plan: planIgnoreTarget, apply: makeMutantApply({ plan: planIgnoreTarget }) }),
  ),
);
expectCaught(
  "M4 undo 가 새 세트만 지우고 옛 세트 복원 안 함",
  await runReplaceScenarios(
    mutant("M4", { apply: makeMutantApply({ plan: planAutoSupportReplace, undoNoRestore: true }) }),
  ),
);

/** M5 — 선택 변경을 따라감: 확정 시점 선택(getActiveStl)으로 대상을 다시 고른다(수정 전). */
const followSelectionRoute = (ctx, points, _target) => {
  const active = getActiveStl(ctx);
  if (!active) return { ok: true, points, report: null }; // 수정 전: 원시 점 그대로
  active.mesh.computeWorldMatrix(true);
  const t = { stlId: active.id, worldMatrix: Array.from(active.mesh.getWorldMatrix().asArray()) };
  const res = routeAndFinalizePoints(
    ctx,
    points.map((p) => ({ ...p, stlId: active.id })),
    DEFAULT_SUPPORT_PARAMS,
    t,
  );
  if (!res.ok) return res;
  // 수정 전에는 점의 stlId 가 원래 값(시작 모델) 그대로 남았다.
  return { ...res, points: res.points.map((p, i) => ({ ...p, stlId: points[i]?.stlId ?? p.stlId })) };
};
expectCaught("M5 선택 변경을 따라감", runRedesignScenarios(followSelectionRoute, realCapture));

expectCaught("M6 언마운트 후 저장(원시 점 폴백)", await runCommitScenarios(legacyCommit));

/** M7 — 생성 중 이동 무시: 행렬 비교 없이 stlId 로만 메시를 고른다. */
const ignoreMoveRoute = (ctx, points, target) => {
  const mesh = ctx.meshMapRef.current.get(target.stlId);
  if (!mesh) return { ok: false, reason: "없음" };
  mesh.computeWorldMatrix(true);
  return routeAndFinalizePoints(ctx, points, DEFAULT_SUPPORT_PARAMS, {
    stlId: target.stlId,
    worldMatrix: Array.from(mesh.getWorldMatrix().asArray()),
  });
};
expectCaught("M7 생성 중 모델 이동 무시", runRedesignScenarios(ignoreMoveRoute, realCapture));

expectCaught(
  "M8 clear 뒤에도 push(gen 무시)",
  await runReplaceScenarios(mutant("M8", { makePusher: pusherIgnoringGen })),
);
expectCaught(
  "M9 삭제·추가 2단계(비원자)",
  await runReplaceScenarios(
    mutant("M9", { apply: makeMutantApply({ plan: planAutoSupportReplace, twoStep: true }) }),
  ),
);
expectCaught(
  "M10 부착된 점까지 지움",
  await runReplaceScenarios(mutant("M10", { plan: planIgnoreAttach })),
);

/** M11 — world 행렬을 사본 아닌 **참조**로 잡음: 이후 이동이 캡처 값에 그대로 반영된다. */
const referenceCapture = (ctx) => {
  const active = getActiveStl(ctx);
  active.mesh.computeWorldMatrix(true);
  return { stlId: active.id, worldMatrix: active.mesh.getWorldMatrix().asArray() };
};
expectCaught("M11 world 행렬 참조 캡처", runRedesignScenarios(realRoute, referenceCapture));

/** 수정 전 배선(소스) 대조군 — 핵심 줄을 수정 전 모양으로 되돌린 소스에서 배선 검사가 걸리는가. */
{
  const legacy = {
    ...SRC,
    supportEditing: SRC.supportEditing.replace(
      /const handleAutoGenerate = useCallback\([\s\S]*?\n {2}\}, \[/,
      "const handleAutoGenerate = useCallback(async () => {\n" +
        "      const generated = sceneHandleRef.current?.generateAutoSupports(projectId, supportParams) ?? [];\n" +
        "      await addSupports(generated);\n  }, [",
    ),
    dental: SRC.dental
      .replace("isCancelled: () => !aliveRef.current", "isCancelled: () => false")
      .replace("detectService.cancel();\n    };", "};"),
  };
  expectCaught("M12 수정 전 배선(소스: 추가만·취소 신호 없음)", wiringChecks(legacy));
}

engine.dispose();

console.log(
  failed === 0
    ? "\n전 항목 통과 (exit 0)"
    : `\n실패 ${failed}건 (exit 1)`,
);
process.exit(failed === 0 ? 0 : 1);
