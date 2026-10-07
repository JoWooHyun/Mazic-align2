import type { STLFileV2 } from "../types/stl";
import type { Task0MaterialSlot } from "../utils/task0/task0-slice";
import { Task0SlotToggle } from "./Task0MaterialCard";

interface StlFileListProps {
  files: STLFileV2[];
  selectedIds: ReadonlySet<string>;
  onPick: (id: string, opts: { multi: boolean }) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  loading?: boolean;
  className?: string;
  /**
   * Task0 2재료 (D1b) — 있으면 줄마다 재료 A/B 고르기(pages/viewer/hooks/useTask0Material — Task0 프로파일 + 재료 모드 2재료일
   * 때만 준다). slotOf 는 기본값을 채운 슬롯(없으면 B).
   */
  materialSlot?: {
    slotOf: (file: STLFileV2) => Task0MaterialSlot;
    onChange: (id: string, slot: Task0MaterialSlot) => void;
  };
}

/**
 * 좌측 STL 리스트 패널.
 * 다중 선택 지원 — Ctrl/Meta+클릭 으로 토글.
 */
const StlFileList: React.FC<StlFileListProps> = ({
  files,
  selectedIds,
  onPick,
  onAdd,
  onRemove,
  loading = false,
  className = "",
  materialSlot,
}) => {
  return (
    <aside
      className={`w-56 bg-white border-r border-gray-200 flex flex-col ${className}`}
    >
      <div className="px-3 py-3 border-b border-gray-200 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-800">
          모델
          <span className="ml-1 text-xs text-gray-400">
            ({files.length}
            {selectedIds.size > 0 ? ` · ${selectedIds.size} 선택` : ""})
          </span>
        </span>
        <button
          onClick={onAdd}
          className="px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
        >
          + 추가
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="px-3 py-4 text-xs text-gray-400">불러오는 중…</p>
        )}
        {!loading && files.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-400 leading-relaxed">
            아직 모델이 없습니다.
            <br />
            상단의 '+ 추가' 로 STL 을 가져오세요.
          </p>
        )}
        {!loading &&
          files.map((f) => {
            const isSelected = selectedIds.has(f.id);
            return (
              <div
                key={f.id}
                onClick={(e) => onPick(f.id, { multi: e.ctrlKey || e.metaKey })}
                className={`group px-3 py-2 cursor-pointer border-l-2 transition-colors ${
                  isSelected
                    ? "bg-primary-50 border-primary-500"
                    : "border-transparent hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-sm truncate ${
                      isSelected
                        ? "text-primary-700 font-medium"
                        : "text-gray-700"
                    }`}
                    title={f.fileName}
                  >
                    {f.fileName}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`"${f.fileName}" 을(를) 삭제할까요?`)) {
                        onRemove(f.id);
                      }
                    }}
                    className="ml-2 opacity-0 group-hover:opacity-100 text-xs text-red-500 hover:text-red-600 transition-opacity"
                    title="삭제"
                  >
                    ×
                  </button>
                </div>
                {materialSlot ? (
                  // Task0 2재료 (D1b) — 크기 옆에 재료 A(T0)/B(T1). 서포트는 항상 A 라 여기 없다.
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-xs text-gray-400">
                      {formatSize(f.fileSize)}
                    </p>
                    <Task0SlotToggle
                      value={materialSlot.slotOf(f)}
                      onChange={(s) => materialSlot.onChange(f.id, s)}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatSize(f.fileSize)}
                  </p>
                )}
              </div>
            );
          })}
      </div>
    </aside>
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default StlFileList;
