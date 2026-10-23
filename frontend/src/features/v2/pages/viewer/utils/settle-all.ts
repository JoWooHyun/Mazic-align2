// 여러 저장을 한꺼번에 기다리되 하나가 실패해도 나머지를 끝까지 보내는 헬퍼 — 사고 방지 3차 ⑦.
//   useTransformCommit 의 서포트 patch 묶음(커밋·undo·redo)이 쓴다. 종전 Promise.all 은 서포트 하나가 이미 지워져
//   "support not found" 로 reject 되면 전체가 죽어(나머지 patch 결과를 기다리지 않고 throw) transform undo 가 반쯤
//   되돌아간 채로 끝났다.

import { reportSaveFailure } from "./save-failure";

/**
 * 전부 끝나길 기다리고 실패 건수를 돌려준다 — 하나가 실패해도 나머지 저장은 계속된다(사고 방지 3차 ⑦). 실패는 console.warn 으로 남긴다.
 * action(사용자 동작 이름)을 주면 실패가 있을 때 묶음당 **한 번** 사용자에게도 알린다(C9 — 저장 실패 안내). 반환값·흐름은 그대로.
 */
export async function settleAll(
  label: string,
  promises: readonly Promise<unknown>[],
  action?: string,
): Promise<number> {
  const results = await Promise.allSettled(promises);
  let failedCount = 0;
  let firstReason: unknown;
  for (const r of results) {
    if (r.status === "rejected") {
      if (failedCount === 0) firstReason = r.reason;
      failedCount += 1;
      console.warn(`[${label}] 저장 실패 — 나머지는 계속 진행:`, r.reason);
    }
  }
  if (failedCount > 0 && action) reportSaveFailure(action, firstReason);
  return failedCount;
}
