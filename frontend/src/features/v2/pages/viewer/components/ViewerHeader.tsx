// 뷰어 상단 헤더 — 프로젝트명/코드, 프로파일 선택, 슬라이스 미리보기 토글,
// 예제 모델 불러오기, STL 내보내기·열기 버튼.
// (ViewerV2Page 에서 마크업 그대로 추출 — className·구조 불변.)

import { useEffect, useRef, useState } from "react";

import PrinterProfileSelect from "../../../components/PrinterProfileSelect";
import type { ProjectV2 } from "../../../types/project";
import { SAMPLE_MODELS, type SampleModelDef } from "../../../utils/sample-models";

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
  onLoadSample: (id: SampleModelDef["id"]) => void;
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
  onLoadSample,
}: ViewerHeaderProps) {
  // 예제 드롭다운 열림 여부 — 이 컴포넌트 안에서만 쓰는 로컬 상태.
  const [sampleOpen, setSampleOpen] = useState(false);
  // 바깥 클릭 판정을 위해 버튼+메뉴를 감싸는 래퍼 참조.
  const sampleRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭 / Esc 로 드롭다운 닫기. 열려 있을 때만 리스너를 붙이고
  // 언마운트·닫힘 시 반드시 해제한다.
  //
  // ⚠️ `mousedown` 이 아니라 **`pointerdown` + capture** 로 듣는다 (B-33).
  //   Babylon 은 캔버스의 `pointerdown` 에 `preventDefault()` 를 건다
  //   (`scene.preventDefaultOnPointerDown` 기본 true — 캔버스 포커스·텍스트 선택
  //   방지용이라 끄면 단축키 등이 회귀한다). `pointerdown` 을 preventDefault 하면
  //   브라우저는 뒤따르는 호환 이벤트 `mousedown` 을 **아예 발생시키지 않으므로**,
  //   캔버스 위를 클릭했을 때 document 의 mousedown 리스너가 영영 안 불린다
  //   (리드 실물: "바깥 클릭은 메뉴가 안 닫혀, Esc 는 잘 돼" — keydown 은 무관해서
  //   Esc 만 동작했다). `ViewerContextMenu` 가 이미 쓰는 패턴과 통일한다.
  useEffect(() => {
    if (!sampleOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && !sampleRef.current?.contains(target)) setSampleOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSampleOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [sampleOpen]);

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
          {/* 예제 모델 드롭다운 — 파일 없이 코드로 생성해 바로 불러온다. */}
          <div className="relative" ref={sampleRef}>
            <button
              onClick={() => setSampleOpen((v) => !v)}
              className="px-3 py-1 text-sm text-primary-700 border border-primary-600 rounded hover:bg-primary-50 transition-colors"
              title="치수 확인·시험 출력용 기본 도형을 불러옵니다"
            >
              예제 ▾
            </button>
            {sampleOpen && (
              <div className="absolute right-0 mt-1 z-20 w-56 bg-white border rounded shadow-lg py-1">
                {SAMPLE_MODELS.map((def) => (
                  <button
                    key={def.id}
                    onClick={() => {
                      setSampleOpen(false);
                      onLoadSample(def.id);
                    }}
                    className="w-full px-3 py-1.5 text-sm text-left text-gray-700 hover:bg-primary-50 transition-colors"
                  >
                    {def.label}
                  </button>
                ))}
              </div>
            )}
          </div>
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
