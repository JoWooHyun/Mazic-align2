import { useEffect, useRef } from 'react';

interface LayerSliderProps {
  /** 총 레이어 수 */
  totalLayers: number;
  /** 현재 레이어 인덱스 (0..totalLayers-1) 또는 -1(off) */
  currentLayer: number;
  onChange: (idx: number) => void;
  /** 레이어별 island face 수 (UI 표기용) */
  perLayerIslandCount: number[];
  /** 슬라이스 최저 Y 좌표 (mm) */
  yMin: number;
  /** 레이어 두께 (mm) */
  layerHeight: number;
  /** 검출 완료 후 활성화 */
  enabled: boolean;
  /** 두께 입력 변경 콜백 (mm 단위로 전달) */
  onLayerHeightChange?: (mm: number) => void;
}

/**
 * 뷰어 우측에 absolute 배치되는 세로 레이어 슬라이더.
 * Island 검출 후 활성화되며, 슬라이더 위치(레이어 인덱스) 가
 * STLViewer 의 mesh.clipPlane Y 와 동기화된다.
 */
const LayerSlider: React.FC<LayerSliderProps> = ({
  totalLayers,
  currentLayer,
  onChange,
  perLayerIslandCount,
  yMin,
  layerHeight,
  enabled,
  onLayerHeightChange,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 키보드 ↑/↓ — 슬라이더 focus 없어도 작동 (window-level 리스너).
  //   안전: 다른 input/textarea/contentEditable 에 focus 있으면 처리 안 함
  //   (μm 입력 필드 등에서 ↑↓ 가 슬라이더로 가지 않게).
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target !== inputRef.current) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(totalLayers - 1, currentLayer + 1);
        if (next !== currentLayer) onChange(next);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.max(0, currentLayer - 1);
        if (next !== currentLayer) onChange(next);
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [enabled, totalLayers, currentLayer, onChange]);

  if (!enabled || totalLayers <= 1) return null;

  const safeLayer = Math.max(0, Math.min(totalLayers - 1, currentLayer));
  const z = yMin + safeLayer * layerHeight;
  const islandCount = perLayerIslandCount[safeLayer] ?? 0;
  const totalIsland = perLayerIslandCount.reduce((s, n) => s + n, 0);
  // 진행도 (%): 0..totalLayers-1 → 0..100
  const progressPct =
    totalLayers > 1 ? (safeLayer / (totalLayers - 1)) * 100 : 0;
  // 슬라이스 두께 μm 표시 (mm × 1000), 정수 표기
  const thicknessUm = Math.round(layerHeight * 1000);

  return (
    <div
      className="absolute right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-2 bg-black/70 text-white text-xs rounded-lg px-2 py-3 select-none"
      style={{ minHeight: 360 }}
    >
      {/* 슬라이스 두께 입력 (μm) — 0~100 */}
      <div className="flex flex-col items-center gap-1">
        <div className="text-[10px] text-gray-300">슬라이스 (μm)</div>
        <input
          type="number"
          min={1}
          max={100}
          step={1}
          value={thicknessUm}
          onChange={(e) => {
            const um = parseInt(e.target.value, 10);
            if (!isFinite(um) || um <= 0) return;
            onLayerHeightChange?.(um / 1000);
          }}
          className="w-14 px-1 py-0.5 text-center text-black rounded text-xs"
        />
      </div>

      <div className="text-center leading-tight">
        <div className="font-semibold">Layer</div>
        <div className="text-amber-300">
          {safeLayer + 1} / {totalLayers}
        </div>
        <div className="text-gray-300 text-[10px] mt-0.5">
          Z = {z.toFixed(2)}mm
        </div>
        <div className="text-amber-200 text-[10px]">
          {progressPct.toFixed(1)}%
        </div>
      </div>

      <input
        ref={inputRef}
        type="range"
        min={0}
        max={Math.max(0, totalLayers - 1)}
        step={1}
        value={safeLayer}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="h-56 cursor-pointer"
        // 세로 슬라이더 — 위가 큰 인덱스(상단 레이어)
        style={{
          writingMode: 'vertical-lr' as const,
          direction: 'rtl',
        }}
      />

      <div className="text-center leading-tight">
        <div
          className={islandCount > 0 ? 'text-red-400 font-semibold' : 'text-gray-400'}
        >
          island {islandCount}
        </div>
        <div className="text-gray-400 text-[10px]">총 {totalIsland}</div>
      </div>

      <button
        onClick={() => onChange(totalLayers - 1)}
        className="mt-1 px-2 py-0.5 text-[11px] bg-gray-700 hover:bg-gray-600 rounded"
        title="슬라이더 최상단 — 적층 완료 (전체 모델)"
      >
        전체
      </button>
    </div>
  );
};

export default LayerSlider;
