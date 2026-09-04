// 뷰어 상단 헤더 — 프로젝트명/코드, 프로파일 선택, 슬라이스 미리보기 토글,
// STL 내보내기·열기 버튼.
// (ViewerV2Page 에서 마크업 그대로 추출 — className·구조 불변.)

import PrinterProfileSelect from "../../../components/PrinterProfileSelect";
import type { ProjectV2 } from "../../../types/project";

interface ViewerHeaderProps {
  project: ProjectV2 | null | undefined;
  loading: boolean;
  filesLength: number;
  slicePreviewOn: boolean;
  onBackToProjects: () => void;
  onEditProfile: () => void;
  onToggleSlicePreview: () => void;
  onExportStl: () => void;
  onOpenStl: () => void;
}

export default function ViewerHeader({
  project,
  loading,
  filesLength,
  slicePreviewOn,
  onBackToProjects,
  onEditProfile,
  onToggleSlicePreview,
  onExportStl,
  onOpenStl,
}: ViewerHeaderProps) {
  return (
    <header className="bg-white border-b">
      <div className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBackToProjects}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            ← Projects
          </button>
          <h1 className="text-lg font-semibold text-gray-900">
            {project?.name ?? (loading ? "Loading…" : "Unknown project")}
          </h1>
          {project && (
            <span className="text-xs text-gray-500 font-mono">
              {project.code}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <PrinterProfileSelect onEdit={onEditProfile} />
          <button
            onClick={onToggleSlicePreview}
            className={`px-3 py-1 text-sm border rounded transition-colors ${
              slicePreviewOn
                ? "bg-primary-600 text-white border-primary-600"
                : "text-primary-700 border-primary-600 hover:bg-primary-50"
            }`}
          >
            슬라이스 미리보기
          </button>
          <button
            onClick={onExportStl}
            disabled={filesLength === 0}
            className="px-3 py-1 text-sm text-primary-700 border border-primary-600 rounded hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            STL 내보내기
          </button>
          <button
            onClick={onOpenStl}
            className="px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
            title="브라우저 파일 선택 창으로 내 PC 의 STL 을 엽니다 (백엔드 불필요)"
          >
            STL 열기
          </button>
        </div>
      </div>
    </header>
  );
}
