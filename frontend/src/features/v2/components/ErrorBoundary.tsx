// v2 화면 렌더 예외 경계 (데모 사고 방지 1차 C).
//   React 는 렌더 중 예외 하나로 트리 전체를 언마운트해 흰 화면이 된다. 이 경계가
//   예외를 잡아 오류 화면 + 복구 버튼 3개를 보여 준다. 저장된 작업은 IndexedDB 에
//   있으므로 새로고침·목록 복귀로 잃는 것은 화면 상태뿐이다.
//   ※ 이벤트 핸들러·비동기(Promise) 예외는 React 경계가 잡지 못한다(React 규약) —
//     여기서 막는 것은 **렌더·라이프사이클 중 예외**다.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** componentDidCatch 가 넘겨주는 React 컴포넌트 스택 (상세 보기용). */
  componentStack: string | null;
}

// ── dev 전용 수동 확인 장치 ────────────────────────────────────────────────
//   주소에 `?crash=1` 이 있으면 DevCrashProbe 가 렌더 중 throw 해 이 경계를
//   재현한다. 경계가 오류를 한 번 잡으면(componentDidCatch) 소진돼 "다시 시도"
//   로 정상 복귀까지 확인할 수 있다 — React 18 은 렌더 예외 시 한 번 동기 재시도를
//   하므로 "첫 렌더만 throw" 로 만들면 재시도가 성공해 경계가 안 뜬다. 그래서
//   소진 시점을 렌더가 아니라 경계의 catch 로 잡는다. 새로고침하면 다시 무장된다.
//   호출부(App.tsx)가 `import.meta.env.DEV &&` 로 감싸므로 프로덕션 빌드에서는
//   렌더되지 않고 tree-shaking 으로 코드째 빠진다.
let devCrashSpent = false;

/** dev 전용 — `?crash=1` 이면 렌더 중 의도적 예외. 프로덕션에서는 렌더하지 말 것. */
export function DevCrashProbe(): null {
  if (
    !devCrashSpent &&
    new URLSearchParams(window.location.search).get("crash") === "1"
  ) {
    throw new Error(
      "[dev] ?crash=1 — 오류 화면 수동 확인용 의도적 렌더 예외입니다.",
    );
  }
  return null;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    // throw 된 값이 Error 가 아닐 수도 있다(문자열 등) — 메시지 표시용으로 감싼다.
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[v2] 렌더 예외 — ErrorBoundary 가 잡음", error, info);
    if (import.meta.env.DEV) devCrashSpent = true;
    this.setState({ componentStack: info.componentStack ?? null });
  }

  /** 경계 상태만 초기화해 자식을 다시 그린다 (원인이 일시적이면 복귀). */
  private handleRetry = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  /** Router 밖에서도 동작하도록 전체 이동으로 목록에 간다. */
  private handleGoProjects = (): void => {
    window.location.assign("/v2/projects");
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    const stackText = error.stack ?? `${error.name}: ${error.message}`;
    const detail = componentStack
      ? `${stackText}\n\n컴포넌트 스택:${componentStack}`
      : stackText;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div
          role="alert"
          className="bg-white p-6 rounded-lg shadow-xl max-w-lg w-full"
        >
          <h1 className="text-lg font-bold text-gray-900">
            화면을 그리는 중 문제가 생겼습니다
          </h1>
          <p className="mt-2 text-sm text-red-600 break-words">
            {error.message || error.name}
          </p>
          <p className="mt-3 text-sm text-gray-600">
            저장된 작업(프로젝트·모델·서포트)은 이 브라우저(IndexedDB)에 그대로
            남아 있습니다.
          </p>
          <details className="mt-3 text-xs text-gray-500">
            <summary className="cursor-pointer select-none hover:text-gray-700">
              자세히 보기
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all bg-gray-50 border border-gray-200 rounded p-2 font-mono">
              {detail}
            </pre>
          </details>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={this.handleGoProjects}
              className="px-4 py-2 text-gray-700 border border-gray-300 hover:bg-gray-100 rounded transition-colors"
            >
              프로젝트 목록으로
            </button>
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }
}
