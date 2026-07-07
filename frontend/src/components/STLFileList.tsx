import { useState } from 'react';
import type { STLFile } from '@types/stl.types';

interface STLFileListProps {
  stlFiles: STLFile[];
  onToggleVisibility: (stlId: string, visibility: boolean) => void;
  onDeleteFile?: (stlId: string) => void;
  onSelectFile?: (stlId: string, multiSelect: boolean) => void;
  onClearSelection?: () => void;
  selectedFileIds?: Set<string>;
  className?: string;
}

/**
 * STL 파일 목록 컴포넌트
 * 프로젝트 내 STL 파일 목록 표시 및 가시성 제어
 */
const STLFileList: React.FC<STLFileListProps> = ({
  stlFiles,
  onToggleVisibility,
  onDeleteFile,
  onSelectFile,
  selectedFileIds,
  className = '',
}) => {
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);

  /**
   * 파일 크기 포맷팅
   */
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  /**
   * 업로드 시간 포맷팅
   */
  const formatUploadTime = (date?: Date): string => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (stlFiles.length === 0) {
    return (
      <div className={`p-4 text-center text-gray-400 ${className}`}>
        No STL files uploaded
      </div>
    );
  }

  return (
    <div
      className={`overflow-y-auto ${className}`}
      onClick={(e) => {
        // Only trigger if clicking the container background directly
        if (e.target === e.currentTarget) {
          onClearSelection?.();
        }
      }}
    >
      <div className="space-y-2">
        {stlFiles.map((file) => (
          <div
            key={file.stlId}
            className="p-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-all cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              // If clicking the row, behave like the checkbox if it's already selected (toggle off)
              // or if modifier key is pressed.
              // Otherwise, single select.
              const isSelected = selectedFileIds?.has(file.stlId);
              if (isSelected && !e.ctrlKey && !e.metaKey) {
                // If already selected and no modifier, clicking again should probably deselect it 
                // OR it should just keep it selected (standard behavior).
                // User asked for "select or deselect".
                // Let's make it toggle if it's already selected, or standard select otherwise.
                // Actually, standard behavior is: click -> select only this. Ctrl+click -> toggle.
                // But user wants "checkbox like" behavior on the whole row?
                // "checkbox... as well as... other areas... to be selected or deselected".
                // This implies the whole row should act like the checkbox?
                // Let's try making the whole row act as a toggle if multi-select mode is implied or if we want to support easy multi-select.
                // But we also need to support single select.

                // Let's stick to:
                // Click: Select (exclusive)
                // Ctrl+Click: Toggle
                // BUT user said "select or deselect".
                // If I click a selected item, it should deselect? That's non-standard for single select.

                // Let's look at the checkbox logic:
                // onChange={(e) => onSelectFile?.(file.stlId, true)} -> This forces multi-select merge.

                // Let's make the row click behave like:
                // If Ctrl/Meta: Toggle (pass multiSelect=true)
                // If no modifier:
                //   If currently selected and it's the ONLY selection: Deselect? No, usually that does nothing.
                //   User might mean they want to easily select multiple things without hitting the tiny checkbox.

                // INTERPRETATION: The user likely wants the row click to behave EXACTLY like the checkbox if they are in a "multi-select mindset", 
                // but we don't have a mode switch.

                // Let's implement:
                // Click: Select (exclusive) unless Ctrl/Meta is held.
                // Wait, the user said "display multi-select... checkbox as well as... viewer button... delete button... except... other areas click... select or deselect".
                // This strongly suggests they want the row click to TOGGLE selection, effectively making the whole row a big checkbox.
                // This is common in some lists where multi-selection is the primary mode.
                // Let's try making it always toggle (multiSelect=true).

                onSelectFile?.(file.stlId, true);
              } else {
                // If not selected, select it. 
                // If we always pass true, it appends.
                // If we want exclusive select, we pass false.

                // If I always pass true, I can never select JUST one file easily (have to deselect others).
                // But the user asked for "select or deselect".

                // Let's try:
                // Normal click: Exclusive select (standard)
                // Ctrl/Meta click: Toggle (standard)
                // Checkbox: Toggle (standard)

                // Maybe the user just found it hard to hit the checkbox?
                // "checkbox... as well as... other areas... to be selected or deselected".
                // This implies the whole row should toggle.

                // I will make the row click act as a TOGGLE (multi-select merge).
                // This seems to be what is requested ("select or deselect").
                onSelectFile?.(file.stlId, true);
              }
            }}
            onMouseEnter={() => setHoveredFileId(file.stlId)}
            onMouseLeave={() => setHoveredFileId(null)}
          >
            <div className="flex items-center justify-between">
              {/* 파일 정보 */}
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                {/* Checkbox for selection */}
                <input
                  type="checkbox"
                  checked={selectedFileIds?.has(file.stlId) || false}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    // Force multi-select behavior when using checkbox
                    onSelectFile?.(file.stlId, true);
                  }}
                  className="w-4 h-4 text-primary-600 rounded border-gray-300 focus:ring-primary-500 cursor-pointer"
                />

                {/* 가시성 토글 버튼 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisibility(file.stlId, !file.visibility);
                  }}
                  className={`p-1.5 rounded-full transition-colors ${file.visibility
                    ? 'text-primary-600 hover:bg-primary-50'
                    : 'text-gray-400 hover:bg-gray-100'
                    }`}
                  title={file.visibility ? 'Hide file' : 'Show file'}
                >
                  {file.visibility ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  )}
                </button>

                {/* 파일 이름 및 정보 */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm text-gray-900 truncate ${
                      selectedFileIds?.has(file.stlId) ? 'font-black' : 'font-medium'
                    }`}
                  >
                    {file.fileName}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatFileSize(file.fileSize)} • {formatUploadTime(file.uploadedAt)}
                  </div>
                </div>
              </div>

              {/* 삭제 버튼 */}
              {onDeleteFile && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete ${file.fileName}?`)) {
                      onDeleteFile(file.stlId);
                    }
                  }}
                  className={`ml-2 p-2 text-red-600 hover:bg-red-50 rounded transition-opacity ${hoveredFileId === file.stlId ? 'opacity-100' : 'opacity-0'
                    }`}
                  title="Delete file"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default STLFileList;
