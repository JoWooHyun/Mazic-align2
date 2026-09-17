// editMode 동기화 훅 — 원본 effect #6 순수 이동.
//   STL 드래그 behavior detach/attach + support isPickable 토글 + 카메라 좌클릭 버튼
//   매핑 조정(dental-brush 진입 [1,2] / 이탈 [0,1,2] 원복, 감사 B2)
//   + 모델 머티리얼 표시 모드 전환(서포트 탭에서만 오버행 색, 리드 결정 C안).
import { useEffect } from "react";
import { setModelDiffuseMode } from "../../../utils/stl-loader";
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
  //    · 모델 머티리얼 표시 모드 전환 (리드 결정 2026-09-17, C안).
  //      "오버행 색은 서포트 달 때만 필요한데 평소에 보여줄 이유가 있나" →
  //      서포트 탭에서만 흰색 diffuse 로 바꿔 오버행 vertex color 를 드러내고,
  //      그 외 모드에서는 청록빛 파랑으로 복원한다. 자세한 색 계약은
  //      `utils/stl-loader.ts` 의 setModelDiffuseMode 주석 참고.
  //
  //      ★ 왜 이 훅인가 — 이미 editMode 전환 시의 씬 부수효과(드래그 behavior,
  //        support pickable, 카메라 버튼)를 모아 둔 자리라, "모드가 바뀌면 씬을
  //        이렇게 맞춘다"는 같은 책임에 속한다. 전용 훅을 신설하면 BabylonScene 의
  //        고정된 훅 호출 순서(`docs/리팩토링_LLM구조_20260720.md` §5 불변식 1)에
  //        항목을 하나 더 얹게 되는데, 새 lifecycle(cleanup·옵저버)이 없는
  //        한 줄짜리 작업이라 그 비용이 더 크다고 판단했다.
  //
  //      ⚠ 이 effect 는 **이미 meshMapRef 에 올라온** 메쉬만 훑는다. 서포트 탭에
  //        있는 동안 새로 로드되는 STL 은 비동기라 여기 잡히지 않으므로
  //        useFileMeshSync 의 로드 완료 지점에서 따로 한 번 맞춘다.
  useEffect(() => {
    // 서포트 탭에서만 오버행 색을 보여준다.
    const showOverhang = editMode === "support";

    for (const [id, mesh] of ctx.meshMapRef.current) {
      // 머티리얼은 mesh 마다 개별 생성(`${meshName}-mat`)되므로 **모든** STL
      // 메쉬에 적용해야 한다. 서포트 메쉬·플레이트·기즈모는 meshMapRef 에
      // 없으므로 자연히 제외된다.
      setModelDiffuseMode(mesh, showOverhang);

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
