// 저장 실패를 호출 지점에서 사용자에게 알리는 헬퍼 — C9.
//   data/db.ts 의 settleTx 는 저장공간 부족(QuotaExceededError)만 알림을 띄운다. 그 밖의 저장 실패(제약 위반·
//   트랜잭션 중단 등)는 reject 로 호출 측에 넘어오는데, 호출 지점 대부분이 처리하지 않아 콘솔에만 남았다.
//   사용자는 저장이 안 된 줄 모르고 새로고침하면 변경이 사라졌다. 이 모듈이 그 안내를 한 곳에서 맡는다.
//
// 규칙
//   - console.error 는 항상. 사용자 안내는 window.alert 1회.
//   - QuotaExceededError 는 알림을 생략한다 — data/db.ts 가 이미 안내했다(이중 알림 방지). 콘솔만.
//   - 알림 폭주 방지: 마지막 알림 뒤 ALERT_INTERVAL_MS 안의 실패는 알림 없이 콘솔만(일괄 저장 루프 등).
//   - 같은 오류 객체를 두 번 보고하지 않는다(재던진 오류가 바깥 지점·되돌리기 스택을 거쳐 다시 올 때).
//   - 시계·알림·콘솔은 주입할 수 있다(검증 스크립트용). 기본 인스턴스는 export 한 reportSaveFailure / withSaveReport.

/** 연속 실패 알림 최소 간격(ms). */
export const ALERT_INTERVAL_MS = 3000;

/** 저장공간 부족 오류 이름 — data/db.ts 가 이미 안내하는 경우. */
const QUOTA_ERROR_NAME = "QuotaExceededError";

export interface SaveFailureDeps {
  /** 현재 시각(ms). */
  now: () => number;
  /** 사용자 알림. */
  alert: (message: string) => void;
  /** 콘솔 오류 기록. */
  logError: (...args: unknown[]) => void;
}

export interface SaveFailureReporter {
  /** 저장 실패를 보고한다 — 콘솔 기록 + (조건에 맞으면) 사용자 알림. 예외를 던지지 않는다. */
  reportSaveFailure: (action: string, err: unknown) => void;
  /**
   * 저장 Promise 를 감싼다 — 실패하면 보고한 뒤 **같은 오류를 다시 던진다**(호출 흐름은 종전 그대로).
   * 성공하면 값을 그대로 돌려준다.
   */
  withSaveReport: <T>(action: string, saving: Promise<T>) => Promise<T>;
}

/** 오류에서 이름·메시지를 짧게 뽑는다 — 사용자 문구용(내부 스택·규격 용어 없이). */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message ? err.message.slice(0, 80) : "";
    return msg ? `${err.name}: ${msg}` : err.name;
  }
  if (err && typeof err === "object") {
    const o = err as { name?: unknown; message?: unknown };
    const name = typeof o.name === "string" ? o.name : "";
    const msg = typeof o.message === "string" ? o.message.slice(0, 80) : "";
    const joined = [name, msg].filter(Boolean).join(": ");
    if (joined) return joined;
  }
  return String(err).slice(0, 80);
}

function errorName(err: unknown): string {
  if (err && typeof err === "object") {
    const n = (err as { name?: unknown }).name;
    if (typeof n === "string") return n;
  }
  return "";
}

export function createSaveFailureReporter(deps: SaveFailureDeps): SaveFailureReporter {
  let lastAlertAt = Number.NEGATIVE_INFINITY;
  const reported = new WeakSet<object>();

  function reportSaveFailure(action: string, err: unknown): void {
    // 같은 오류를 두 번 보고하지 않는다 — 객체가 아닌 오류(문자열 등)는 추적할 수 없어 매번 보고한다.
    if (err !== null && typeof err === "object") {
      if (reported.has(err)) return;
      reported.add(err);
    }
    try {
      deps.logError(`[저장 실패] ${action}`, err);
    } catch {
      // 콘솔 기록 실패는 무시한다.
    }
    // 저장공간 부족은 data/db.ts 가 이미 안내했다 — 이중 알림 방지.
    if (errorName(err) === QUOTA_ERROR_NAME) return;
    const now = deps.now();
    if (now - lastAlertAt < ALERT_INTERVAL_MS) return;
    lastAlertAt = now;
    try {
      deps.alert(
        `저장하지 못했습니다 — ${action}\n` +
          "변경 내용이 저장되지 않았을 수 있습니다. 이대로 새로고침하면 이 변경이 사라질 수 있으니 작업을 다시 확인해 주세요.\n" +
          `(${describeError(err)})`,
      );
    } catch {
      // 알림 자체가 막혀도(브라우저 설정 등) 저장 흐름을 깨지 않는다 — 콘솔 기록은 이미 남았다.
    }
  }

  function withSaveReport<T>(action: string, saving: Promise<T>): Promise<T> {
    return saving.catch((err: unknown) => {
      reportSaveFailure(action, err);
      throw err;
    });
  }

  return { reportSaveFailure, withSaveReport };
}

/** 브라우저 알림 — window 가 없는 환경(헤드리스)에서는 조용히 건너뛴다. */
function browserAlert(message: string): void {
  if (typeof window === "undefined" || typeof window.alert !== "function") return;
  window.alert(message);
}

const defaultReporter = createSaveFailureReporter({
  now: () => Date.now(),
  alert: browserAlert,
  logError: (...args) => console.error(...args),
});

/** 기본 인스턴스 — 저장 실패 보고(콘솔 + 알림 1회, 폭주·저장공간 부족 처리 포함). */
export const reportSaveFailure = defaultReporter.reportSaveFailure;
/** 기본 인스턴스 — 저장 Promise 를 감싸 실패를 보고하고 같은 오류를 다시 던진다. */
export const withSaveReport = defaultReporter.withSaveReport;
