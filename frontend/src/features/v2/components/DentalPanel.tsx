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
 *
 * Step 2-4 범위: 검출→생성 파이프라인 (ADR-3, 지현규 판단 → 유승제 생성).
 *   · "검출 영역 자동 서포트" — 아일랜드 검출 결과가 있을 때만 활성. 검출된 island
 *     영역에만 자동 서포트를 생성(마진 있으면 마진 가드 적용)한다. 원클릭 배선.
 * 스타일은 SupportParamsPanel 패턴을 따른다 (흰 카드 · 회색 라벨 · primary 버튼).
 */

import NumberInput from "./common/NumberInput";

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
  /**
   * 마진 찾기 실행 중 여부 — 동기 실행이라 진행률은 없지만, 클릭 직후 버튼을
   * "찾는 중…" + disabled 로 바꿔 UI 가 멈춘 게 아님을 보인다(감사 #2).
   */
  marginBusy?: boolean;
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
  /**
   * 아일랜드 검출 실행 중 여부 — 동기 실행(수백 초)이라 진행률은 없지만, 클릭
   * 직후 버튼을 "검출 중…" + disabled 로 바꿔 UI 가 멈춘 게 아님을 보인다(감사 #1).
   */
  islandBusy?: boolean;
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
  /**
   * "검출 영역 자동 서포트" (Step 2-4) — 검출된 아일랜드 영역에만 자동 서포트 생성.
   * 아일랜드 검출이 성공(islandStatus.ok)했을 때만 활성.
   */
  onAutoSupportIslands: () => void;
  /** 검출 영역 자동 서포트 생성 진행 중 여부 (버튼 비활성/문구). */
  autoSupportBusy?: boolean;
  /**
   * 검출 영역 자동 서포트 완료 결과 문구 (감사 #5). null = 미실행/정리됨.
   * 예: "서포트 12개 생성됨 …". 성공/배제 모두 이 문구로 통지.
   */
  autoSupportResult?: string | null;
  /**
   * 서포트 재설계(S-4) 검출·점생성 실행 (설계 8장 1~2단계, 검증용 병행 경로).
   *   활성 STL 을 층 그래프로 검출 → 아일랜드/오버행 색 표시 → 검출 영역에서
   *   직접 서포트 점 생성(크기별 3분기) → 점만 표시(기둥 없음). 기존 격자/아일랜드
   *   경로와 독립. 정식 UI 는 설계 8장 5단계 몫이라 이 PR 은 디버그 버튼만.
   */
  onRunRedesignDetect?: () => void;
  /** 재설계 검출·점생성 진행 중 여부 (버튼 비활성/문구). */
  redesignBusy?: boolean;
  /** 재설계 검출·점생성 시각화 지우기. */
  onClearRedesignDetect?: () => void;
  /** 재설계 검출·점생성 결과 상태 (없으면 미실행). ok=false → 실패 사유. */
  redesignStatus?: { ok: boolean; message: string } | null;
  /**
   * 서포트 생성(재설계) — 점 생성 + 표면 스냅 + IndexedDB 저장 (S-4b-1).
   *   디버그 버튼과 달리 저장까지 해 뷰어에 화살촉+수직 기둥을 세운다.
   */
  onGenerateRedesignSupports?: () => void;
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
  marginBusy = false,
  onClearMargin,
  marginStatus = null,
  onDetectIslands,
  islandBusy = false,
  onClearIslands,
  islandStatus = null,
  onAutoSupportIslands,
  autoSupportBusy = false,
  autoSupportResult = null,
  onRunRedesignDetect,
  redesignBusy = false,
  onClearRedesignDetect,
  redesignStatus = null,
  onGenerateRedesignSupports,
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
          {/* 숫자칸은 Enter/blur 에서만 커밋한다 (B-14). 슬라이더는 연속
              조작이라 종전대로 즉시 반영. 클램프는 commitThickness 가 이미
              하지만, NumberInput 이 커밋 시점에 먼저 범위로 맞춰 준다. */}
          <NumberInput
            min={BRUSH_MIN}
            max={BRUSH_MAX}
            step={BRUSH_STEP}
            decimals={2}
            value={brushThicknessMm}
            onChange={commitThickness}
            ariaLabel="브러쉬 두께"
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
          disabled={paintedFaceCount === 0 || marginBusy}
          className="w-full px-3 py-2 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {marginBusy ? "찾는 중…" : "마진 찾기"}
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
          disabled={islandBusy}
          className="w-full px-3 py-2 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {islandBusy ? "검출 중…" : "아일랜드 검출"}
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

      {/* 검출 영역 자동 서포트 (2-4) — 아일랜드 검출 결과가 있을 때만 활성 */}
      <div className="mt-5 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            검출 영역 자동 서포트
          </span>
        </div>
        <button
          onClick={onAutoSupportIslands}
          disabled={
            autoSupportBusy ||
            !islandStatus?.ok ||
            islandStatus.totalIslandFaces === 0
          }
          className="w-full px-3 py-2 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {autoSupportBusy ? "생성 중…" : "검출 영역에 자동 서포트"}
        </button>
        {autoSupportResult && (
          <p className="mt-2 text-xs text-green-700">{autoSupportResult}</p>
        )}
        <p className="mt-2 text-xs text-gray-500">
          검출된 아일랜드 영역에만 자동으로 서포트를 배치 · 마진이 있으면 마진 라인
          비침범 가드 적용
        </p>
      </div>

      {/* 서포트 재설계(S-4) 검출·점생성 — 설계 8장 1~2단계 (검증용 디버그) */}
      {onRunRedesignDetect && (
        <div className="mt-5 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              서포트 재설계 (검증)
            </span>
            <span className="text-[10px] text-gray-400">S-4 · 1~2단계</span>
          </div>
          <button
            onClick={onRunRedesignDetect}
            disabled={redesignBusy}
            className="w-full px-3 py-2 text-sm rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {redesignBusy ? "검출·점생성 중…" : "재설계 검출·점생성"}
          </button>
          <p className="mt-2 text-xs text-gray-500">
            층 그래프로 아일랜드(마젠타)·오버행(주황)을 검출하고 검출 영역에 직접
            서포트 점(파랑)을 생성 · 기둥은 세우지 않음(점만)
          </p>

          {/* 서포트 생성(재설계) — 점 생성 + 표면 스냅 + 저장 → 뷰어에 기둥 (S-4b-1) */}
          {onGenerateRedesignSupports && (
            <button
              onClick={onGenerateRedesignSupports}
              disabled={redesignBusy}
              className="mt-2 w-full px-3 py-2 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {redesignBusy ? "생성 중…" : "서포트 생성(재설계)"}
            </button>
          )}

          {redesignStatus && (
            <p
              className={`mt-2 text-xs ${
                redesignStatus.ok ? "text-green-700" : "text-amber-600"
              }`}
            >
              {redesignStatus.message}
            </p>
          )}

          {onClearRedesignDetect && (
            <button
              onClick={onClearRedesignDetect}
              disabled={!redesignStatus?.ok}
              className="mt-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              재설계 표시 지우기
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DentalPanel;
