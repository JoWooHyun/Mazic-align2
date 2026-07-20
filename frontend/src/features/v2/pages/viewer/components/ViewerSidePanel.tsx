// 우측 사이드 패널 — Transform / Support / Dental 탭 스위처 + 각 패널.
// (ViewerV2Page 의 <aside> 마크업 그대로 추출 — className·조건 렌더 불변.)

import TransformPanel from "../../../components/TransformPanel";
import DentalPanel from "../../../components/DentalPanel";
import { SupportParamsPanel } from "../../../support";
import type { EditMode } from "../../../components/EditModeControls";
import type { TransformV2 } from "../../../types/transform";

type PanelTab = "transform" | "support" | "dental";

type MarginStatus = { ok: boolean; message: string } | null;
type IslandStatus =
  | {
      ok: true;
      totalIslandFaces: number;
      nSlices: number;
      layersWithIsland: number;
    }
  | { ok: false; message: string }
  | null;

interface TransformPanelSelected {
  id: string;
  fileName: string;
  transform: TransformV2;
}

interface ViewerSidePanelProps {
  error: Error | null;
  panelTab: PanelTab;
  onPanelTabChange: (t: PanelTab) => void;
  // Transform
  transformPanelSelected: TransformPanelSelected | null;
  onPreviewTransform: (id: string, t: TransformV2) => void;
  onCommitTransform: (id: string, start: TransformV2, end: TransformV2) => void;
  // Support
  onAutoGenerate: () => void;
  onClearAllSupports: () => void;
  supportCount: number;
  autoBusy: boolean;
  // Dental
  editMode: EditMode;
  onToggleBrush: (active: boolean) => void;
  brushThicknessMm: number;
  onBrushThicknessChange: (mm: number) => void;
  onClearPaint: () => void;
  paintedFaceCount: number;
  onFindMargin: () => void;
  marginBusy: boolean;
  onClearMargin: () => void;
  marginStatus: MarginStatus;
  onDetectIslands: () => void;
  islandBusy: boolean;
  onClearIslands: () => void;
  islandStatus: IslandStatus;
  onAutoSupportIslands: () => void;
  autoSupportBusy: boolean;
  autoSupportResult: string | null;
}

export default function ViewerSidePanel({
  error,
  panelTab,
  onPanelTabChange,
  transformPanelSelected,
  onPreviewTransform,
  onCommitTransform,
  onAutoGenerate,
  onClearAllSupports,
  supportCount,
  autoBusy,
  editMode,
  onToggleBrush,
  brushThicknessMm,
  onBrushThicknessChange,
  onClearPaint,
  paintedFaceCount,
  onFindMargin,
  marginBusy,
  onClearMargin,
  marginStatus,
  onDetectIslands,
  islandBusy,
  onClearIslands,
  islandStatus,
  onAutoSupportIslands,
  autoSupportBusy,
  autoSupportResult,
}: ViewerSidePanelProps) {
  return (
    <aside className="w-80 border-l bg-white overflow-y-auto flex flex-col">
      {error && (
        <p className="text-red-600 text-sm m-4">
          프로젝트 조회 실패: {error.message}
        </p>
      )}
      {/* 탭: Transform / Support / Dental */}
      <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
        {(["transform", "support", "dental"] as const).map((t) => (
          <button
            key={t}
            onClick={() => onPanelTabChange(t)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              panelTab === t
                ? "bg-white text-primary-700 border-b-2 border-primary-600 -mb-px"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {t === "transform"
              ? "Transform"
              : t === "support"
                ? "Support"
                : "Dental"}
          </button>
        ))}
      </div>
      <div className="p-4">
        {panelTab === "transform" ? (
          <TransformPanel
            selected={transformPanelSelected}
            onPreview={onPreviewTransform}
            onCommit={onCommitTransform}
          />
        ) : panelTab === "support" ? (
          <SupportParamsPanel
            onAutoGenerate={onAutoGenerate}
            onClearAll={onClearAllSupports}
            supportCount={supportCount}
            busy={autoBusy}
          />
        ) : (
          <DentalPanel
            brushActive={editMode === "dental-brush"}
            onToggleBrush={onToggleBrush}
            brushThicknessMm={brushThicknessMm}
            onBrushThicknessChange={onBrushThicknessChange}
            onClearPaint={onClearPaint}
            paintedFaceCount={paintedFaceCount}
            onFindMargin={onFindMargin}
            marginBusy={marginBusy}
            onClearMargin={onClearMargin}
            marginStatus={marginStatus}
            onDetectIslands={onDetectIslands}
            islandBusy={islandBusy}
            onClearIslands={onClearIslands}
            islandStatus={islandStatus}
            onAutoSupportIslands={onAutoSupportIslands}
            autoSupportBusy={autoSupportBusy}
            autoSupportResult={autoSupportResult}
          />
        )}
      </div>
    </aside>
  );
}
