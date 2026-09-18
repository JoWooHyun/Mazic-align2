// editMode 동기화 훅 — 원본 effect #6 순수 이동.
//   STL 드래그 behavior detach/attach + support isPickable 토글 + 카메라 좌클릭 버튼
//   매핑 조정(dental-brush 진입 [1,2] / 이탈 [0,1,2] 원복, 감사 B2)
//   + 모델 머티리얼 표시 모드 전환(서포트 탭에서만 오버행 색, 리드 결정 C안).
import { useEffect, useRef } from "react";
import { setModelDiffuseMode } from "../../../utils/stl-loader";
import { syncGizmo } from "../scene-actions";
import type { STLFileV2 } from "../../../types/stl";
import type { SupportPointV2 } from "../../../support/types";
import type { EditMode } from "../../EditModeControls";
import type { SceneCtx } from "../scene-refs";
import { BRACE_MESH_KEY_PREFIX } from "./useBraceMeshSync";

export function useEditModeSync(
  ctx: SceneCtx,
  editMode: EditMode,
  files: STLFileV2[],
  supports: SupportPointV2[],
  /** 슬라이스 미리보기 편집 잠금 (= `sliceY != null`). boolean 정규화된 값. */
  sliceLocked: boolean,
): void {
  // 직전 잠금 상태 — 아래 effect 가 "잠금이 바뀐 렌더"만 골라내는 데 쓴다.
  //   초기값을 현재 값으로 두어 마운트 시점에는 전환으로 보지 않는다.
  const sliceLockedPrevRef = useRef<boolean>(sliceLocked);

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

    // 슬라이스 미리보기 중에는 select 모드여도 드래그를 붙이지 않는다.
    //   미리보기는 clipPlane(셰이더 discard)이라 picking ray 가 잘린 윗부분까지
    //   맞히므로, 보이지 않는 곳을 잡아 모델이 끌려가는 사고가 난다(구 v1 근거).
    const dragAllowed = editMode === "select" && !sliceLocked;

    for (const [id, mesh] of ctx.meshMapRef.current) {
      // 머티리얼은 mesh 마다 개별 생성(`${meshName}-mat`)되므로 **모든** STL
      // 메쉬에 적용해야 한다. 서포트 메쉬·플레이트·기즈모는 meshMapRef 에
      // 없으므로 자연히 제외된다.
      setModelDiffuseMode(mesh, showOverhang);

      const drag = ctx.dragBehaviorMapRef.current.get(id);
      if (!drag) continue;
      const attached = mesh.behaviors.includes(drag);
      if (!dragAllowed && attached) {
        // ⚠️ S1 — 드래그 **도중** 잠금이 걸려도 이동 커밋이 유실되지 않는다.
        //   Babylon `Node.removeBehavior` → `PointerDragBehavior.detach()` 는
        //   마지막에 `releaseDrag()` 를 부르고, releaseDrag 는 `dragging` 이면
        //   `onDragEndObservable` 을 notify 한다(pointerDragBehavior.js:290-294,
        //   503-518). 그 observable 은 생성자에서 만들어져 detach 가 지우지
        //   않으므로, scene-actions 의 onDragEnd 핸들러가 정상 발화해
        //   gizmoDragStartRef 를 비우고 onGizmoCommit 까지 수행한다.
        mesh.removeBehavior(drag);
        // 보험: 위 경로가 어떤 이유로든 발화하지 않았다면 stale 스냅샷이 남아
        //   다음 드래그의 onDragEnd 가 엉뚱한 시작값으로 커밋한다. 이 메쉬의
        //   것일 때만 비운다(다른 종류의 드래그 스냅샷은 건드리지 않는다).
        const started = ctx.gizmoDragStartRef.current;
        if (started?.kind === "stl" && started.id === id) {
          ctx.gizmoDragStartRef.current = null;
        }
      } else if (dragAllowed && !attached) {
        mesh.addBehavior(drag);
      }
    }
    // ★ S-4b-2d: 같은 맵에 사는 기둥 연결 브레이스는 **절대 pickable 로 만들지
    //   않는다.** 리드 확정 "다리 개별 삭제는 불필요 — 자동으로만" 이라 클릭
    //   대상이 아니고, pickable 이 되면 다리를 집어 기둥을 옮기려 드는 오조작이
    //   난다(브레이스는 `onMoveSupport` 가 알 수 있는 점 id 가 없다).
    for (const [key, sm] of ctx.supportMeshMapRef.current) {
      if (key.startsWith(BRACE_MESH_KEY_PREFIX)) continue;
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

    // 잠금 **전환 시에만** 기즈모를 떼거나 되붙인다. effect #5(useSelectionSync)
    //   의 deps 에는 sliceLocked 가 없어 미리보기 토글만으로는 재실행되지 않으므로,
    //   여기서 한 번 불러 "켠 순간 화살표가 사라진다"를 보장한다. 해제 시에는
    //   같은 호출이 평소 규칙대로 재attach 하므로 편집 상태가 복원된다.
    //   (기즈모 드래그 진행 중이면 syncGizmo 가 스스로 detach 를 미룬다 — S2.)
    //
    //   ⚠️ editMode/files/supports 변경 경로에서는 부르지 않는다 — 그 셋은 이미
    //   effect #5 가 담당하고 있어, 여기서 겹쳐 부르면 기존 동작에 없던 중복
    //   호출이 생긴다(레이어 스크럽 무영향은 sliceLocked 의 boolean 정규화가,
    //   중복 회피는 이 조건이 각각 보장).
    if (sliceLockedPrevRef.current !== sliceLocked) {
      sliceLockedPrevRef.current = sliceLocked;
      syncGizmo(ctx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, files, supports, sliceLocked]);
}
