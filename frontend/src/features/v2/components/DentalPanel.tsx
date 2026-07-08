/**
 * DentalPanel — 우측 패널의 치과(dental) 도구 UI.
 *
 * Step 2-3a 범위: 브러쉬 색칠(마스크).
 *   · "브러쉬로 영역 지정" 토글 — dental-brush editMode on/off.
 *   · 브러쉬 두께(mm) 입력 (씬에서 SHIFT+휠로도 조정 → 양방향 동기화).
 *   · "칠 지우기" — 색칠 전부 제거.
 *
 * Step 2-3b 범위: 마진 찾기.
 *   · "마진 찾기" — 색칠 영역에서 마진 폐곡선 검출 → 초록 튜브 시각화
 *     (painted 0 면 비활성). 성공: 마진 엣지 수 표시 / 실패: 사유 문구.
 *   · "마진 지우기" — 마진 시각화 + floodfill 자동 색칠 제거 (색칠은 유지).
 *   · 마진 안 더블클릭 → 내부 face floodfill (주황) — 씬에서 동작, 별도 버튼 없음.
 *
 * Step 2-3c 범위: 아일랜드(미지지 영역) 검출.
 *   · "아일랜드 검출" — 활성 STL 전체를 슬라이스해 미지지 영역을 마젠타로 표시.
 *     결과 요약(총 island face 수 · 레이어 수 · island 있는 레이어 수) 표시.
 *   · "아일랜드 지우기" — 마젠타 overlay 제거 (색칠/마진은 유지).
 *   레이어별 상세 카운트는 이번 범위 밖(요약 수준).
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
  /** "마진 찾기" — 색칠 영역에서 마진 검출·시각화 실행. */
  onFindMargin: () => void;
  /** "마진 지우기" — 마진 시각화 + floodfill 제거 (색칠은 유지). */
  onClearMargin: () => void;
  /**
   * 마진 찾기 결과 상태 (없으면 미실행). ok=true → 마진 엣지 수/실패 사유는
   * message 에 담아 표시. 마진이 있으면 "마진 지우기" 활성.
   */
  marginStatus?: {
    ok: boolean;
    /** 성공/실패 시 사용자에게 보여줄 문구 (원본 console 문구를 UI 문구로). */
    message: string;
  } | null;
  /** "아일랜드 검출" — 활성 STL 전체에서 미지지 영역 검출·마젠타 시각화. */
  onDetectIslands: () => void;
  /** "아일랜드 지우기" — 마젠타 overlay 제거 (색칠/마진은 유지). */
  onClearIslands: () => void;
  /**
   * 아일랜드 검출 결과 상태 (없으면 미실행). ok=true 면 요약 통계 표시 + "아일랜드
   * 지우기" 활성. ok=false 면 실패 사유(message)만 표시.
   */
  islandStatus?:
    | {
        ok: true;
        totalIslandFaces: number;
        nSlices: number;
        layersWithIsland: number;
      }
    | { ok: false; message: string }
    | null;
  className?: string;
}

const DentalPanel: React.FC<DentalPanelProps> = ({
  brushActive,
  onToggleBrush,
  brushThicknessMm,
  onBrushThicknessChange,
  onClearPaint,
  paintedFaceCount = 0,
  onFindMargin,
  onClearMargin,
  marginStatus = null,
  onDetectIslands,
  onClearIslands,
  islandStatus = null,
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

      {/* 마진 찾기 (2-3b) */}
      <div className="mt-5 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">마진</span>
        </div>
        <button
          onClick={onFindMargin}
          disabled={paintedFaceCount === 0}
          className="w-full px-3 py-2 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          마진 찾기
        </button>
        <p className="mt-2 text-xs text-gray-500">
          색칠 영역에서 마진 라인을 찾아 초록 선으로 표시 · 마진 안쪽을{" "}
          <kbd className="px-1 border rounded">더블클릭</kbd> = 자동 색칠
        </p>

        {marginStatus && (
          <p
            className={`mt-2 text-xs ${
              marginStatus.ok ? "text-green-700" : "text-amber-600"
            }`}
          >
            {marginStatus.message}
          </p>
        )}

        <button
          onClick={onClearMargin}
          disabled={!marginStatus?.ok}
          className="mt-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          마진 지우기
        </button>
      </div>

      {/* 아일랜드 검출 (2-3c) */}
      <div className="mt-5 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">아일랜드</span>
        </div>
        <button
          onClick={onDetectIslands}
          className="w-full px-3 py-2 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 transition-colors"
        >
          아일랜드 검출
        </button>
        <p className="mt-2 text-xs text-gray-500">
          활성 STL 전체를 슬라이스해 미지지 영역(아일랜드)을 마젠타로 표시
        </p>

        {islandStatus &&
          (islandStatus.ok ? (
            <div className="mt-2 text-xs text-gray-600 space-y-0.5">
              <div>
                총 island 면{" "}
                <span className="font-medium text-gray-900">
                  {islandStatus.totalIslandFaces}
                </span>
                개
              </div>
              <div>
                레이어 수{" "}
                <span className="font-medium text-gray-900">
                  {islandStatus.nSlices}
                </span>{" "}
                · island 있는 레이어{" "}
                <span className="font-medium text-gray-900">
                  {islandStatus.layersWithIsland}
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-amber-600">{islandStatus.message}</p>
          ))}

        <button
          onClick={onClearIslands}
          disabled={!islandStatus?.ok}
          className="mt-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          아일랜드 지우기
        </button>
      </div>
    </div>
  );
};

export default DentalPanel;
