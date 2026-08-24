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
import {
  DISPLAY_AXIS_LABELS,
  toDisplayAxes,
} from "../../../types/axis-display";
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
  // select-none: 카메라 드래그가 뷰포트 위 UI 글자를 긁어 선택하는 것 방지(B-6).
  return (
    <div className="absolute top-3 right-3 flex flex-col items-end gap-2 max-w-[calc(100%-1.5rem)] select-none">
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
          // ★ B-20 — 축 변환을 적용한 뒤 표시한다.
          //   종전에는 **내부 Y-up 값(tx/ty/tz)을 그대로** 찍으면서 라벨만
          //   X/Y/Z(Z-up 규약)로 달아, 위로 움직이면 "Y" 가 변하고 파란 Z 는
          //   엉뚱한 축을 가리켰다(리드 실물 발견). TransformPanel 은 이미
          //   `toDisplayAxes` 를 거치므로 **두 패널의 같은 축 값이 서로 달랐다.**
          //   축 색도 `DISPLAY_AXIS_LABELS` 순서(X 빨강·Y 초록·Z 파랑)에 맞춘다 —
          //   이제 "위로 뻗는 축 = Z = 파랑"이 씬 축 라인·범례와 일치한다.
          //
          //   ⚠️ TransformPanel 의 bbox 기준점 환산(B-12, toDisplayPosition)은
          //   적용하지 않는다. 그건 피벗을 실시간으로 읽어야 하는데 이 오버레이는
          //   메쉬 핸들이 없고, 여기 표시는 **원점 기준 위치**라는 종전 의미를
          //   유지한다(축만 바로잡는 최소 수정). 두 패널의 절대값이 다를 수 있는
          //   것은 기준점 차이이며, 축 대응은 이제 일치한다.
          const disp = toDisplayAxes([t.tx, t.ty, t.tz]);
          const axisColor = [
            "text-red-500",
            "text-green-600",
            "text-blue-500",
          ];
          return (
            <div className="bg-white/90 backdrop-blur rounded-md shadow px-3 py-2 text-xs font-mono text-gray-700 pointer-events-none">
              <div className="text-[10px] text-gray-500 mb-0.5 font-sans">
                {f.fileName}
              </div>
              {DISPLAY_AXIS_LABELS.map((label, i) => (
                <div key={label}>
                  <span className={axisColor[i]}>{label}</span>{" "}
                  {disp[i].toFixed(2)} mm
                </div>
              ))}
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
