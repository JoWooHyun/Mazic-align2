// 선택/gizmo 동기화 훅 — 원본 effect #4(highlight 갱신) + #5(gizmo attach 재계산).
//   두 effect 는 원본에서 연속 선언되므로 이 훅에서도 그 순서로 등록한다.
//   refreshHighlight/syncGizmo 는 scene-actions.ts 로 추출한 ctx 기반 함수.
import { useEffect } from "react";
import type { STLFileV2 } from "../../../types/stl";
import type { SupportPointV2 } from "../../../support/types";
import type { EditMode } from "../../EditModeControls";
import type { GizmoMode } from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";
import { refreshHighlight, syncGizmo } from "../scene-actions";

export function useSelectionSync(
  ctx: SceneCtx,
  selectedIds: ReadonlySet<string>,
  selectedSupportId: string | null,
  gizmoMode: GizmoMode,
  files: STLFileV2[],
  editMode: EditMode,
  supports: SupportPointV2[],
): void {
  // 4) 선택 변경 시 highlight 갱신
  useEffect(() => {
    refreshHighlight(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, selectedSupportId]);

  // 5) Gizmo: 선택 / 모드 / files / editMode / supports / selectedSupportId 변경 시 attach 재계산
  useEffect(() => {
    syncGizmo(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, gizmoMode, files, editMode, supports, selectedSupportId]);
}
