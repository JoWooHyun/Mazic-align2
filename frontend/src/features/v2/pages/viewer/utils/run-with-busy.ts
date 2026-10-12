// busy 라벨을 먼저 그린 뒤 동기 작업을 돌리는 헬퍼 — 사고 방지 3차 ④.
//   useDentalWorkflow 의 runWithBusy 를 그대로 옮겼고(의미 불변), Support 탭 "자동 생성"(useSupportEditing)이
//   같은 보장을 await 로 쓰도록 awaitPaint 를 더했다.

/** busy 라벨이 화면에 그려진 뒤 resolve — requestAnimationFrame → setTimeout(0) (runWithBusy 와 같은 보장). */
export function awaitPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(() => resolve(), 0);
    });
  });
}

/**
 * 동기(수십~수백 초) 검출 작업을 busy 라벨이 먼저 페인트된 뒤 시작하도록
 * 감싸는 헬퍼. requestAnimationFrame(다음 프레임 직전) → setTimeout(0)(프레임
 * 커밋 후) 로 라벨 페인트를 보장한 뒤 동기 작업(work)을 실행한다.
 * (handleFindMargin / handleDetectIslands 의 동일 패턴 통합 — 의미 불변.)
 */
export function runWithBusy(
  setBusy: (v: boolean) => void,
  work: () => void,
): void {
  setBusy(true);
  requestAnimationFrame(() => {
    setTimeout(() => {
      try {
        work();
      } finally {
        setBusy(false);
      }
    }, 0);
  });
}
