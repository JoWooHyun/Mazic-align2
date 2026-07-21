// 뷰포트 우측 상단 오버레이 stack — 뷰 컨트롤 / Gizmo / 바닥면 붙이기 /
// 편집 모드 / 선택 좌표 / 서포트 편집 툴바.
// (ViewerV2Page 의 우상단 stack 마크업 그대로 추출 — className·조건 렌더 불변.)

import ViewControls from "../../../components/ViewControls";
import GizmoControls from "../../../components/GizmoControls";
import EditModeControls, {
  type EditMode,
} from "../../../components/EditModeControls";
import type { GizmoMode } from "../../../components/BabylonScene";
import type { ViewPreset } from "../../../utils/camera-views";
import type { STLFileV2 } from "../../../types/stl";
import type { SupportPointV2 } from "../../../support/types";
import { IDENTITY_TRANSFORM } from "../../../types/transform";
import SupportEditToolbar from "./SupportEditToolbar";

interface ViewportOverlaysProps {
  files: STLFileV2[];
  selectedIds: ReadonlySet<string>;
  editMode: EditMode;
  gizmoMode: GizmoMode;
  alignFloorMode: boolean;
  bridgeMode: boolean;
  pendingBridge: unknown | null;
  selectedSupportId: string | null;
  supports: SupportPointV2[];
  onSetView: (p: ViewPreset) => void;
  onFit: () => void;
  onGizmoModeChange: (m: GizmoMode) => void;
  onToggleAlignFloor: () => void;
  onEditModeChange: (m: EditMode) => void;
  onToggleBridge: () => void;
  onResetBridgeCurve: () => void;
  onDeleteSelected: () => void;
}

export default function ViewportOverlays({
  files,
  selectedIds,
  editMode,
  gizmoMode,
  alignFloorMode,
  bridgeMode,
  pendingBridge,
  selectedSupportId,
  supports,
  onSetView,
  onFit,
  onGizmoModeChange,
  onToggleAlignFloor,
  onEditModeChange,
  onToggleBridge,
  onResetBridgeCurve,
  onDeleteSelected,
}: ViewportOverlaysProps) {
  return (
    <div className="absolute top-3 right-3 flex flex-col items-end gap-2 max-w-[calc(100%-1.5rem)]">
      <ViewControls onSetView={onSetView} onFit={onFit} />

      <GizmoControls
        mode={gizmoMode}
        onChange={onGizmoModeChange}
        enabled={selectedIds.size === 1 && editMode === "select"}
      />

      {gizmoMode === "rotate" && editMode === "select" && (
        <button
          onClick={onToggleAlignFloor}
          className={`px-3 py-1.5 text-xs rounded-md shadow border transition-colors ${
            alignFloorMode
              ? "bg-primary-600 text-white border-primary-600"
              : "bg-white/95 backdrop-blur border-gray-200 text-gray-700 hover:bg-gray-100"
          }`}
          title="모델의 한 face 를 클릭하면 그 면이 바닥에 닿도록 회전 + Y 이동"
        >
          {alignFloorMode ? "면 클릭 대기..." : "바닥면 붙이기"}
        </button>
      )}

      <EditModeControls mode={editMode} onChange={onEditModeChange} />

      {selectedIds.size === 1 &&
        editMode === "select" &&
        (() => {
          const id = Array.from(selectedIds)[0];
          const f = files.find((file) => file.id === id);
          if (!f) return null;
          const t = f.transform ?? IDENTITY_TRANSFORM;
          return (
            <div className="bg-white/90 backdrop-blur rounded-md shadow px-3 py-2 text-xs font-mono text-gray-700 pointer-events-none">
              <div className="text-[10px] text-gray-500 mb-0.5 font-sans">
                {f.fileName}
              </div>
              <div>
                <span className="text-red-500">X</span>{" "}
                {t.tx.toFixed(2)} mm
              </div>
              <div>
                <span className="text-green-600">Y</span>{" "}
                {t.ty.toFixed(2)} mm
              </div>
              <div>
                <span className="text-blue-500">Z</span>{" "}
                {t.tz.toFixed(2)} mm
              </div>
            </div>
          );
        })()}

      {editMode === "support" && (
        <SupportEditToolbar
          bridgeMode={bridgeMode}
          pendingBridge={pendingBridge}
          selectedSupportId={selectedSupportId}
          supports={supports}
          onToggleBridge={onToggleBridge}
          onResetBridgeCurve={onResetBridgeCurve}
          onDeleteSelected={onDeleteSelected}
        />
      )}
    </div>
  );
}
