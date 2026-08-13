// 뷰포트 우측 하단 stack — 오버행/세이프 색 범례 + 축·플레이트 정보.
// (ViewerV2Page 의 우하단 stack 마크업 그대로 추출.)

interface ViewportInfoPanelsProps {
  filesLength: number;
  overhangAngleDeg: number;
  plateWidthMm: number;
  plateDepthMm: number;
}

export default function ViewportInfoPanels({
  filesLength,
  overhangAngleDeg,
  plateWidthMm,
  plateDepthMm,
}: ViewportInfoPanelsProps) {
  return (
    <div className="absolute bottom-3 right-3 flex flex-col items-end gap-2">
      {filesLength > 0 && (
        <div className="bg-white/90 backdrop-blur rounded-md shadow px-3 py-2 text-xs text-gray-700 space-y-1 pointer-events-none">
          <div className="flex items-center space-x-2">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: "rgb(255, 82, 82)" }}
            />
            <span>Overhang (≤ {overhangAngleDeg}°)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: "rgb(199, 202, 212)" }}
            />
            <span>Safe</span>
          </div>
        </div>
      )}

      <div className="bg-white/90 backdrop-blur rounded-md shadow px-3 py-2 text-xs text-gray-600 pointer-events-none">
        {/*
          축 범례 — 프린터 관례대로 **Z 가 위** (B-13, CHITUBOX 캡처 ① 대조).
          색은 관례 그대로 X 빨강 / Y 초록 / Z 파랑을 유지하되, 표시 규약상
          화면에서 위로 뻗는 선이 Z(파랑) 이라 scene-setup 의 축 라인 색 배정도
          같이 맞춰 뒀다. 내부 좌표계는 여전히 Babylon Y-up 이다.
        */}
        <div className="flex items-center space-x-2">
          <span
            className="inline-block w-3 h-1 rounded"
            style={{ background: "rgb(255,77,77)" }}
          />
          <span>X</span>
          <span
            className="inline-block w-3 h-1 rounded ml-2"
            style={{ background: "rgb(77,230,102)" }}
          />
          <span>Y (안쪽)</span>
          <span
            className="inline-block w-3 h-1 rounded ml-2"
            style={{ background: "rgb(89,140,255)" }}
          />
          <span>Z (위)</span>
        </div>
        <div className="mt-1 text-gray-500">
          플레이트 {plateWidthMm.toFixed(1)} × {plateDepthMm.toFixed(1)} mm ·
          격자 10 mm
        </div>
      </div>
    </div>
  );
}
