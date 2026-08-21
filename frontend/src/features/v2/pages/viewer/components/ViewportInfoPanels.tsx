// 뷰포트 우측 하단 stack — 오버행/세이프 색 범례 + 축·플레이트 정보 + 서포트 통계.
// (ViewerV2Page 의 우하단 stack 마크업 그대로 추출. 서포트 통계는 C-4 로 추가.)
import {
  pillarSavingRatio,
  type SupportSummary,
} from "../../../support/support-stats";

interface ViewportInfoPanelsProps {
  filesLength: number;
  overhangAngleDeg: number;
  plateWidthMm: number;
  plateDepthMm: number;
  /**
   * 현재 서포트 구성 요약 (C-4). null/전체 0 이면 패널을 숨긴다.
   *   근거: `docs/판정_CHITUBOX분석_20260821.md` C-4 (`docs/supp94_v2.md` 46장).
   */
  supportSummary?: SupportSummary | null;
}

export default function ViewportInfoPanels({
  filesLength,
  overhangAngleDeg,
  plateWidthMm,
  plateDepthMm,
  supportSummary = null,
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

      {/*
        서포트 통계 (C-4) — CHITUBOX 의 total / Up Touch / Main Support 3 카운터
        대응. 생성 직후 상태 문구와 달리 **항상** 현재 씬 기준으로 보인다.
        점이 0 이면 숨겨서 빈 화면을 어지럽히지 않는다.
      */}
      {supportSummary && supportSummary.total > 0 && (
        <div className="bg-white/90 backdrop-blur rounded-md shadow px-3 py-2 text-xs text-gray-700 space-y-0.5 pointer-events-none">
          <div className="font-medium text-gray-800">서포트</div>
          <div className="flex gap-3">
            <span>전체 {supportSummary.total}</span>
            <span>접점 {supportSummary.contact}</span>
            <span>기둥 {supportSummary.mainPillar}</span>
          </div>
          {(supportSummary.island > 0 || supportSummary.slope > 0) && (
            <div className="text-gray-500">
              아일랜드 {supportSummary.island} · 경사 {supportSummary.slope}
            </div>
          )}
          {supportSummary.joined > 0 && (
            <div className="text-gray-500">
              합류 {supportSummary.joined} (기둥 절감{" "}
              {(pillarSavingRatio(supportSummary) * 100).toFixed(0)}%)
            </div>
          )}
          {(supportSummary.bent > 0 || supportSummary.anchored > 0) && (
            <div className="text-gray-500">
              경사우회 {supportSummary.bent} · 모델앵커{" "}
              {supportSummary.anchored}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
