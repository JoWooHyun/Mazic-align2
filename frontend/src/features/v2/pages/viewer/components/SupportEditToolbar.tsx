// 서포트 편집 모드 툴바 — Bridge/Disc 토글, 직선 복원, 선택 삭제 + 모드 안내 문구.
// (ViewerV2Page 의 editMode==="support" 오버레이 마크업 그대로 추출.)

import type { SupportPointV2 } from "../../../support/types";

interface SupportEditToolbarProps {
  bridgeMode: boolean;
  discMode: boolean;
  pendingBridge: unknown | null;
  selectedSupportId: string | null;
  supports: SupportPointV2[];
  onToggleBridge: () => void;
  onToggleDisc: () => void;
  onResetBridgeCurve: () => void;
  onDeleteSelected: () => void;
}

export default function SupportEditToolbar({
  bridgeMode,
  discMode,
  pendingBridge,
  selectedSupportId,
  supports,
  onToggleBridge,
  onToggleDisc,
  onResetBridgeCurve,
  onDeleteSelected,
}: SupportEditToolbarProps) {
  return (
    <div className="flex items-center gap-3 bg-white/95 backdrop-blur rounded-md shadow px-3 py-2 text-xs text-gray-700">
      {bridgeMode ? (
        <span className="pointer-events-none">
          <strong>Bridge 모드</strong> ·{" "}
          {pendingBridge
            ? "두 번째 지점을 클릭"
            : "첫 번째 지점을 클릭"}{" "}
          · <kbd className="px-1 border rounded">Esc</kbd> = 취소
        </span>
      ) : discMode ? (
        <span className="pointer-events-none">
          <strong>디스크 서포트 모드</strong> · 모델 표면 = 배치 ·
          기둥 클릭 = 선택 ·{" "}
          <kbd className="px-1 border rounded">Delete</kbd> = 삭제
        </span>
      ) : (
        <span className="pointer-events-none">
          <strong>서포트 편집</strong> · 모델 표면 = 추가 · 기둥 클릭
          = 선택 · <kbd className="px-1 border rounded">Delete</kbd> =
          삭제
        </span>
      )}
      <button
        onClick={onToggleBridge}
        className={`px-2 py-0.5 text-xs border rounded transition-colors ${
          bridgeMode
            ? "bg-primary-600 text-white border-primary-600"
            : "border-primary-600 text-primary-700 hover:bg-primary-50"
        }`}
      >
        Bridge
      </button>
      <button
        onClick={onToggleDisc}
        className={`px-2 py-0.5 text-xs border rounded transition-colors ${
          discMode
            ? "bg-primary-600 text-white border-primary-600"
            : "border-primary-600 text-primary-700 hover:bg-primary-50"
        }`}
        title="지현규 dental disc 서포트 — 모델 표면 클릭으로 배치"
      >
        Disc
      </button>
      <button
        onClick={onResetBridgeCurve}
        disabled={
          !selectedSupportId ||
          bridgeMode ||
          supports.find((s) => s.id === selectedSupportId)?.source !==
            "bridge"
        }
        className="px-2 py-0.5 text-xs border border-gray-400 text-gray-700 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="선택된 Bridge 의 변곡점을 직선 균등 분할로 복원"
      >
        직선 복원
      </button>
      <button
        onClick={onDeleteSelected}
        disabled={!selectedSupportId || bridgeMode}
        className="px-2 py-0.5 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        선택 삭제
      </button>
    </div>
  );
}
