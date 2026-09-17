// 슬라이스 미리보기 모드의 가운데 세로 층 슬라이더 (1단계).
//
// 3D(좌)와 2D 단면(우) 사이에 끼는 얇은 레일. 위 = 최상층, 아래 = 0층
// (치투박스 등 다른 슬라이서 관례 — 리드가 스크린샷으로 확인한 배치).
//
// ⚠️ 세로 방향은 `writing-mode: vertical-lr` 로 만든다. CSS transform 회전은
//   트랙의 **히트 영역**이 회전 전 사각형으로 남아 드래그 좌표가 어긋난다.
//   vertical 슬라이더는 기본이 "아래=min, 위=max" 가 아니라 반대라
//   `direction: rtl` 로 뒤집어 위쪽이 최상층이 되게 맞춘다.

interface SliceLayerRailProps {
  /** 현재 층 (이미 범위 클램프된 값). */
  layerIdx: number;
  /** 총 층수. */
  layerCount: number;
  /** 현재 층의 Z (mm). */
  sliceYNow: number;
  onLayerIdxChange: (i: number) => void;
}

export default function SliceLayerRail({
  layerIdx,
  layerCount,
  sliceYNow,
  onLayerIdxChange,
}: SliceLayerRailProps) {
  const maxIdx = Math.max(0, layerCount - 1);

  return (
    <div className="w-24 shrink-0 border-x border-gray-200 bg-white flex flex-col items-center py-3 select-none">
      {/* 최상층 표시 */}
      <div className="text-[11px] text-gray-400 font-mono">{maxIdx}</div>

      <input
        type="range"
        min={0}
        max={maxIdx}
        step={1}
        value={layerIdx}
        onChange={(e) => onLayerIdxChange(Number(e.target.value))}
        aria-label="현재 레이어 번호"
        className="flex-1 my-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        style={{
          writingMode: "vertical-lr",
          direction: "rtl",
          width: "8px",
        }}
      />

      {/* 0층 표시 */}
      <div className="text-[11px] text-gray-400 font-mono">0</div>

      <div className="mt-3 text-center">
        <div className="text-sm font-semibold text-gray-900 font-mono">
          {layerIdx}
        </div>
        <div className="text-[11px] text-gray-500">/ {layerCount}층</div>
        <div className="mt-1 text-[11px] text-gray-600 font-mono">
          Z = {sliceYNow.toFixed(3)}mm
        </div>
      </div>
    </div>
  );
}
