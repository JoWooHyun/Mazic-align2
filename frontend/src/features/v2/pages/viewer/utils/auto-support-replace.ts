// 자동 서포트 재실행 = **교체 + undo** (정리_20261001 §1-2 D5 / §4-2 신규 8·11).
//
// 종전에는 자동 서포트를 다시 누르면 기존 세트를 지우지 않고 새 세트를 **추가**해
// 두 세트가 겹쳤다("파라미터 바꿔 다시 누르는 시연"에서 바로 보이는 사고).
// 이제 세 자동 생성 경로가 모두 이 모듈로 저장한다:
//   · Support 탭 "자동 생성"             (useSupportEditing.handleAutoGenerate)
//   · Dental 탭 "검출 영역 자동 서포트"    (useDentalWorkflow.handleAutoSupportIslands)
//   · Dental 탭 "서포트 생성(재설계)"      (useDentalWorkflow.handleGenerateRedesignSupports)
//
// 교체 대상 = 그 생성이 다룬 모델의 source === "auto" 점 (planAutoSupportReplace).
// 삭제+추가는 저장소의 한 transaction(supports.repo replaceSupportsInProject)이고,
// undo 한 번이면 옛 세트(DB 에 있던 레코드 그대로)로, redo 면 새 세트로 돌아간다.
//
// React·IndexedDB 에 직접 의존하지 않는다 — 저장(replace)·재조회(refresh)·undo push
// 를 인자로 받는다. 헤드리스 검증(scripts/verify-support-regen.mjs)이 가짜 저장소와
// 실제 useUndoStore 로 그대로 돌린다(useDentalWorkflow 는 `?worker` import 체인
// 때문에 tsx 로 못 불러온다 — layer-count.ts 와 같은 이유로 별도 모듈).

import { useUndoStore, type UndoEntry } from "../../../hooks/useUndoStore";
import type { RouteReport } from "../../../support/route-plan";
import type { SupportPointV2 } from "../../../support/types";

/** 교체 계획 — 무엇을 지우는가. */
export interface AutoReplacePlan {
  /** 지울 기존 자동 서포트 id (기존 목록 순서). */
  removeIds: string[];
  /**
   * 교체 대상이지만 **남겨 둔** 자동 서포트 id — 남는 서포트가 부착
   * (contactAttachedTo/baseAttachedTo)·기둥 합류(joinPillarPointId)로 가리키고 있다.
   */
  keptAttachedIds: string[];
}

/**
 * 기존 서포트 목록에서 교체로 지울 점을 고른다 (순수 함수).
 *
 * 규칙:
 *   1. `source === "auto"` 이고 `targetStlIds` 에 속한 모델의 점만 후보.
 *      수동(`manual`)·브릿지(`bridge`)는 손으로 만든 것이라 절대 지우지 않는다.
 *      다른 모델의 자동 서포트도 그대로 둔다.
 *      재설계 점(kind island/slope)도 source 가 "auto" 라 후보다 — 한 모델의 자동
 *      세트는 경로와 무관하게 하나만 남는다(일반 자동 위에 재설계를 돌려도 안 겹침).
 *   2. **남는 서포트가 가리키는 후보는 지우지 않는다.** 지우면 그 위에 붙은 브릿지
 *      끝이 허공에 뜬다. 부착 해제(필드 수정)는 사용자가 만든 형상을 바꾸므로 하지
 *      않고 "그 점 유지" 를 택한다. 지금 UI 는 브릿지 위에만 부착을 만들므로
 *      (setup-pointer-handlers: parent.source === "bridge") 자동 점이 부모일 일은
 *      없지만, 옛 데이터·다른 경로 방어선이다. 남긴 점이 기둥 합류 멤버면 그 기둥
 *      주인도 남긴다(다리가 허공에서 끝나지 않게). 둘 다 고정점까지 반복한다.
 *
 * 한계: 사용자가 손으로 옮긴 자동 점(handleMoveSupport)은 source 가 "auto" 그대로라
 *   구분할 수 없어 교체에 포함된다(undo 로 복구 가능).
 */
export function planAutoSupportReplace(
  existing: readonly SupportPointV2[],
  targetStlIds: ReadonlySet<string>,
): AutoReplacePlan {
  const candidates = new Set<string>();
  for (const s of existing) {
    if (s.source === "auto" && targetStlIds.has(s.stlId)) candidates.add(s.id);
  }
  const kept = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of existing) {
      // 남는 점 = 후보가 아니거나, 후보지만 이미 남기기로 한 점.
      if (candidates.has(s.id) && !kept.has(s.id)) continue;
      const refs = [
        s.contactAttachedTo?.supportId,
        s.baseAttachedTo?.supportId,
        s.joinPillarPointId,
      ];
      for (const r of refs) {
        if (r && candidates.has(r) && !kept.has(r)) {
          kept.add(r);
          changed = true;
        }
      }
    }
  }
  const removeIds: string[] = [];
  const keptAttachedIds: string[] = [];
  for (const s of existing) {
    if (!candidates.has(s.id)) continue;
    if (kept.has(s.id)) keptAttachedIds.push(s.id);
    else removeIds.push(s.id);
  }
  return { removeIds, keptAttachedIds };
}

/**
 * 저장소 교체 함수 — `supports.repo.replaceSupportsInProject` 의 projectId 를 묶은 꼴.
 *   pickRemoveIds 로 (같은 transaction 안에서 읽은) 기존 목록에서 지울 id 를 고르고,
 *   삭제·추가를 원자적으로 한다. 지운 레코드를 돌려준다.
 */
export type ReplaceSupportsFn = (
  pickRemoveIds: (existing: SupportPointV2[]) => readonly string[],
  add: readonly SupportPointV2[],
) => Promise<SupportPointV2[]>;

/** 교체 결과 요약 (안내 문구용). */
export interface AutoReplaceResult {
  removedCount: number;
  addedCount: number;
  keptAttachedCount: number;
}

/**
 * 새 자동 서포트 세트로 대상 모델의 기존 자동 서포트를 **교체**하고 undo 항목을 남긴다.
 *
 * 순서: 교체(원자적) → undo push → 재조회. 교체가 실패(throw)하면 저장소는 그대로이고
 *   undo 도 push 하지 않은 채 그 예외를 그대로 던진다 — 호출 측이 알린다.
 *   교체가 성공한 뒤 재조회만 실패해도 undo 항목은 이미 남아 있다(DB 는 바뀌었으므로).
 *
 * undo = 새 세트 id 를 지우고 지웠던 레코드(DB 에 있던 그대로)를 되돌린다.
 * redo = 다시 옛 세트 id 를 지우고 새 세트를 넣는다. 둘 다 같은 원자적 교체라 중간
 *   실패 시 반쯤 되돌아간 상태가 남지 않고, 실패 항목은 undo 스토어가 이력에서 뺀다
 *   (useUndoStore 실패 항목 폐기 규칙).
 */
export async function applyAutoSupportReplace(args: {
  /** undo 항목 라벨. */
  label: string;
  /** 이번 생성이 다룬 모델 — 이 모델들의 자동 서포트만 교체한다. */
  targetStlIds: ReadonlySet<string>;
  /** 새 세트. */
  generated: readonly SupportPointV2[];
  replace: ReplaceSupportsFn;
  refresh: () => Promise<void>;
  pushUndo: (entry: UndoEntry) => void;
}): Promise<AutoReplaceResult> {
  const { label, targetStlIds, replace, refresh, pushUndo } = args;
  const generated = args.generated.slice();
  let keptAttachedCount = 0;
  const removed = await replace((existing) => {
    const plan = planAutoSupportReplace(existing, targetStlIds);
    keptAttachedCount = plan.keptAttachedIds.length;
    return plan.removeIds;
  }, generated);
  const removedIds = removed.map((p) => p.id);
  const addedIds = generated.map((p) => p.id);
  pushUndo({
    label,
    undo: async () => {
      await replace(() => addedIds, removed);
      await refresh();
    },
    redo: async () => {
      await replace(() => removedIds, generated);
      await refresh();
    },
  });
  await refresh();
  return {
    removedCount: removed.length,
    addedCount: generated.length,
    keptAttachedCount,
  };
}

/**
 * **지금** undo 세대(gen)를 잡아 두고, 그 뒤 clear()(프로젝트 전환·뷰어 이탈·STL 삭제)
 * 가 없었을 때만 push 하는 함수를 돌려준다 — useUndoStore 의 gen 규칙(PR #110)과 같은
 * 취지. 교체 직전에 만들어 넘긴다(그 사이 이력이 끊겼으면 끝난 항목을 되살리지 않음).
 */
export function makeUndoPusher(): (entry: UndoEntry) => void {
  const gen = useUndoStore.getState().gen;
  return (entry) => {
    const s = useUndoStore.getState();
    if (s.gen !== gen) return;
    s.push(entry);
  };
}

/** 교체 안내 문구. 지운 기존 자동 서포트가 없으면(첫 생성) null. */
export function formatAutoReplaceNotice(r: AutoReplaceResult): string | null {
  if (r.removedCount === 0 && r.keptAttachedCount === 0) return null;
  let msg =
    `기존 자동 서포트 ${r.removedCount}개를 새 ${r.addedCount}개로 바꿨습니다 ` +
    "(Ctrl+Z 로 되돌리기)";
  if (r.keptAttachedCount > 0) {
    msg += ` · 브릿지가 붙어 있는 ${r.keptAttachedCount}개는 유지`;
  }
  return msg;
}

/** 재설계 라우팅 확정 결과 — 씬 핸들 `routeAndFinalizeRedesignPoints` 의 반환. */
export type RedesignRouteOutcome =
  | { ok: true; points: SupportPointV2[]; report: RouteReport }
  | { ok: false; reason: string };

/** 재설계 생성 마무리 결과. */
export type RedesignCommitOutcome =
  /** 뷰어를 떠났다(언마운트·씬 소멸) — 아무것도 저장하지 않았다. */
  | { kind: "cancelled" }
  /** 시작 모델이 사라졌거나 움직였다 등 — 저장하지 않았다. */
  | { kind: "rejected"; reason: string }
  /** 라우팅 뒤 저장할 점이 0개 — 기존 서포트 그대로. */
  | { kind: "empty"; report: RouteReport }
  /** 교체 저장 완료. */
  | {
      kind: "saved";
      points: SupportPointV2[];
      report: RouteReport;
      result: AutoReplaceResult;
    };

/**
 * 재설계 서포트 생성의 **워커 검출 이후** 단계 — 라우팅 확정 → 교체 저장 (신규 11).
 *
 * 종전에는 생성 도중 뷰어를 떠나면 씬 핸들이 사라져 라우팅이 안 됐는데, 호출 측이
 * `routed?.points ?? res.points` 로 **라우팅 전 원시 점**을 그대로 저장했다.
 * 여기서는:
 *   · 취소 신호(isCancelled — 언마운트)가 있으면 라우팅·저장 둘 다 하지 않는다.
 *   · 라우팅을 못 했으면(route 가 null/undefined — 씬 없음) 저장하지 않는다.
 *     원시 점 폴백은 없다.
 *   · 라우팅이 거절했으면(시작 모델 소멸·이동 — 신규 9) 저장하지 않는다.
 *   · 저장 직전에 취소 신호를 한 번 더 본다.
 */
export async function commitRedesignGeneration(args: {
  isCancelled: () => boolean;
  route: () => RedesignRouteOutcome | null | undefined;
  save: (points: SupportPointV2[]) => Promise<AutoReplaceResult>;
}): Promise<RedesignCommitOutcome> {
  if (args.isCancelled()) return { kind: "cancelled" };
  const routed = args.route();
  if (!routed) return { kind: "cancelled" };
  if (!routed.ok) return { kind: "rejected", reason: routed.reason };
  if (routed.points.length === 0) {
    return { kind: "empty", report: routed.report };
  }
  if (args.isCancelled()) return { kind: "cancelled" };
  const result = await args.save(routed.points);
  return {
    kind: "saved",
    points: routed.points,
    report: routed.report,
    result,
  };
}
