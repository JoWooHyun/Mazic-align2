// editMode 동기화 훅 — 원본 effect #6 순수 이동.
//   STL 드래그 behavior detach/attach + support isPickable 토글 + 카메라 좌클릭 버튼
//   매핑 조정(dental-brush 진입 [1,2] / 이탈 [0,1,2] 원복, 감사 B2). 로직 무변경.
import { useEffect } from "react";
import type { STLFileV2 } from "../../../types/stl";
import type { SupportPointV2 } from "../../../support/types";
import type { EditMode } from "../../EditModeControls";
import type { SceneCtx } from "../scene-refs";

export function useEditModeSync(
  ctx: SceneCtx,
  editMode: EditMode,
  files: STLFileV2[],
  supports: SupportPointV2[],
): void {
  // 6) editMode 변경 시:
  //    · STL 메쉬의 PointerDragBehavior detach/attach
  //    · support 메쉬의 isPickable 토글
  //    · dental-brush 모드도 support 와 마찬가지로 STL 드래그 비활성
  //      (표면 클릭이 색칠에 쓰이므로 이동/선택으로 소비되면 안 됨).
  //    · dental-brush 모드에서만 카메라 좌클릭(0) 회전을 끈다 (감사 B2).
  //      원본(babylon.utils createCamera)은 좌클릭을 buttons=[1,2] 로 전역
  //      제외했으나, v2 는 select/support 의 좌드래그 회전 UX 를 유지하기
  //      위해 모드 진입 시에만 0 을 빼고 이탈 시 [0,1,2] 로 원복한다.
  useEffect(() => {
    for (const [id, mesh] of ctx.meshMapRef.current) {
      const drag = ctx.dragBehaviorMapRef.current.get(id);
      if (!drag) continue;
      const attached = mesh.behaviors.includes(drag);
      if (editMode !== "select" && attached) {
        mesh.removeBehavior(drag);
      } else if (editMode === "select" && !attached) {
        mesh.addBehavior(drag);
      }
    }
    for (const sm of ctx.supportMeshMapRef.current.values()) {
      sm.isPickable = editMode === "support";
    }

    // 카메라 pointer input 의 버튼 매핑을 모드에 맞춰 조정한다.
    // ArcRotateCameraPointersInput.buttons: 0=Left, 1=Middle, 2=Right.
    // dental-brush 에서는 좌클릭 드래그가 색칠에 쓰이므로 카메라 회전에서
    // 좌클릭을 제외(=[1,2])하고, 그 외 모드에서는 기본값([0,1,2])으로 원복.
    const pointersInput = ctx.cameraRef.current?.inputs.attached.pointers as
      | { buttons?: number[] }
      | undefined;
    if (pointersInput) {
      pointersInput.buttons =
        editMode === "dental-brush" ? [1, 2] : [0, 1, 2];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, files, supports]);
}
