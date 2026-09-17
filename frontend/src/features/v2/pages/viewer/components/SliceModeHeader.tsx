// 슬라이스 미리보기 **모드** 전용 헤더 (1단계).
//
// 리드 확정: "슬라이스는 별도 창으로 넘어가는 게 좋겠다" — 단 브라우저 새 탭이
// 아니라 같은 SPA 안에서 화면만 교체한다. 그래서 라우트를 나누지 않고,
// ViewerV2Page 안에서 이 헤더가 ViewerHeader 를 **대신** 렌더된다
// (BabylonScene 은 그대로 마운트된 채 유지 — 언마운트되면 dispose 로 STL
// 재로드 + 카메라 리셋이 나서 미리보기 자체가 성립하지 않는다).

import type { ProjectV2 } from "../../../types/project";

interface SliceModeHeaderProps {
  project: ProjectV2 | null | undefined;
  loading: boolean;
  /** 모드 이탈 (← 뒤로). 내보내기 진행 중이면 비활성. */
  onBack: () => void;
  backDisabled?: boolean;
}

export default function SliceModeHeader({
  project,
  loading,
  onBack,
  backDisabled = false,
}: SliceModeHeaderProps) {
  return (
    <header className="bg-white border-b">
      <div className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            disabled={backDisabled}
            className="text-sm text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
            title="편집 화면으로 돌아갑니다"
          >
            ← 뒤로
          </button>
          <h1 className="text-lg font-semibold text-gray-900">
            슬라이스 미리보기
          </h1>
          <span className="text-sm text-gray-500">
            · {project?.name ?? (loading ? "Loading…" : "Unknown project")}
          </span>
          {project && (
            <span className="text-xs text-gray-500 font-mono">
              {project.code}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-500 select-none">
            편집 잠금 중 — 뷰 조작만 가능
          </span>
        </div>
      </div>
    </header>
  );
}
