/**
 * DentalPanel — 우측 패널의 치과(dental) 도구 UI.
 *
 * Step 2-3a 범위: 브러쉬 색칠(마스크) 만.
 *   · "브러쉬로 영역 지정" 토글 — dental-brush editMode on/off.
 *   · 브러쉬 두께(mm) 입력 (씬에서 SHIFT+휠로도 조정 → 양방향 동기화).
 *   · "칠 지우기" — 색칠 전부 제거.
 *
 * 마진 찾기 / 아일랜드 검출 버튼은 2-3b/c 에서 추가 (아래 자리만 주석).
 * 스타일은 SupportParamsPanel 패턴을 따른다 (흰 카드 · 회색 라벨 · primary 버튼).
 */

/** dental-brush 두께 입력 한계 (원본 SHIFT+휠 clamp 0.5~30mm 과 일치). */
const BRUSH_MIN = 0.5;
const BRUSH_MAX = 30;
const BRUSH_STEP = 0.5;

interface DentalPanelProps {
  /** 브러쉬 색칠 모드 활성 여부 (editMode === 'dental-brush'). */
  brushActive: boolean;
  /** 브러쉬 색칠 모드 토글. */
  onToggleBrush: (active: boolean) => void;
  /** 브러쉬 두께 (mm). 색칠 반경 = 두께/2. */
  brushThicknessMm: number;
  /** 브러쉬 두께 변경. */
  onBrushThicknessChange: (mm: number) => void;
  /** 색칠 전부 지우기. */
  onClearPaint: () => void;
  /** 현재 색칠된 face 수 (있으면 표시 + "칠 지우기" 활성). */
  paintedFaceCount?: number;
  className?: string;
}

const DentalPanel: React.FC<DentalPanelProps> = ({
  brushActive,
  onToggleBrush,
  brushThicknessMm,
  onBrushThicknessChange,
  onClearPaint,
  paintedFaceCount = 0,
  className = "",
}) => {
  const commitThickness = (raw: number) => {
    if (Number.isNaN(raw)) return;
    const clamped = Math.min(Math.max(raw, BRUSH_MIN), BRUSH_MAX);
    onBrushThicknessChange(Number(clamped.toFixed(2)));
  };

  return (
    <div className={`p-4 bg-white rounded-lg shadow ${className}`}>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Dental</h3>

      {/* 브러쉬 색칠 토글 */}
      <button
        onClick={() => onToggleBrush(!brushActive)}
        className={`w-full px-3 py-2 text-sm rounded transition-colors ${
          brushActive
            ? "bg-primary-600 text-white hover:bg-primary-700"
            : "border border-primary-600 text-primary-700 hover:bg-primary-50"
        }`}
      >
        {brushActive ? "브러쉬 색칠 중 (클릭하여 종료)" : "브러쉬로 영역 지정"}
      </button>

      {brushActive && (
        <p className="mt-2 text-xs text-gray-500">
          모델 표면을 드래그하여 색칠 · <kbd className="px-1 border rounded">Ctrl</kbd>
          +드래그 = 지우기 · <kbd className="px-1 border rounded">Shift</kbd>+휠 =
          두께 조절
        </p>
      )}

      {/* 브러쉬 두께 */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-gray-700">브러쉬 두께</label>
          <span className="text-xs text-gray-500">
            {BRUSH_MIN}–{BRUSH_MAX} mm
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <input
            type="range"
            min={BRUSH_MIN}
            max={BRUSH_MAX}
            step={BRUSH_STEP}
            value={brushThicknessMm}
            onChange={(e) => commitThickness(Number(e.target.value))}
            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <input
            type="number"
            min={BRUSH_MIN}
            max={BRUSH_MAX}
            step={BRUSH_STEP}
            value={brushThicknessMm}
            onChange={(e) => commitThickness(Number(e.target.value))}
            className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
          />
          <span className="w-6 text-xs text-gray-500">mm</span>
        </div>
      </div>

      {/* 색칠 관리 */}
      <div className="mt-5 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">색칠</span>
          <span className="text-xs text-gray-500">
            현재 {paintedFaceCount} 면
          </span>
        </div>
        <button
          onClick={onClearPaint}
          disabled={paintedFaceCount === 0}
          className="w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          칠 지우기
        </button>
      </div>

      {/* 2-3b: 마진 찾기 버튼 자리 · 2-3c: 아일랜드 검출 버튼 자리
          (findMargin / island-detection 코어는 이미 이식됨 — UI 연결만 남음). */}
    </div>
  );
};

export default DentalPanel;
