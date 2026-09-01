// v2 Babylon 씬 컴포넌트 — 단일책임 분리 후의 얇은 조립 계층.
//   씬 상태(ref 45개)는 useSceneRefs(SceneCtx)로 모으고, 기능별 effect 는 babylon/hooks
//   의 훅으로, useImperativeHandle 구현은 babylon/handle 의 빌더로 위임한다.
//   공개 인터페이스(BabylonScene default / BabylonSceneHandle / GizmoMode /
//   BabylonSceneProps / IslandStats)는 이 파일에서 그대로 re-export 하므로 소비자
//   (ViewerV2Page 등)는 수정할 필요가 없다.
import { forwardRef, useImperativeHandle, useState } from "react";

import { useSceneRefs } from "./babylon/scene-refs";
import { useSceneBootstrap } from "./babylon/hooks/useSceneBootstrap";
import { useFileMeshSync } from "./babylon/hooks/useFileMeshSync";
import { useSupportMeshSync } from "./babylon/hooks/useSupportMeshSync";
import { useSupportPartsReady } from "../support/hooks/useSupportPartsReady";
import { useSelectionSync } from "./babylon/hooks/useSelectionSync";
import { useSlicePreview } from "./babylon/hooks/useSlicePreview";
import { useBridgeVisualization } from "./babylon/hooks/useBridgeVisualization";
import { useEditModeSync } from "./babylon/hooks/useEditModeSync";
import { useDentalBrush } from "./babylon/hooks/useDentalBrush";
import { useBuildVolumeCheck } from "./babylon/hooks/useBuildVolumeCheck";
import { useAlignFloorHover } from "./babylon/hooks/useAlignFloorHover";
import { buildCameraHandle } from "./babylon/handle/camera-handle";
import { buildTransformHandle } from "./babylon/handle/transform-handle";
import { buildSupportGenHandle } from "./babylon/handle/support-gen-handle";
import { buildSliceExportHandle } from "./babylon/handle/slice-export-handle";
import { buildDentalHandle } from "./babylon/handle/dental-handle";
import { buildRedesignDetectHandle } from "./babylon/handle/redesign-detect-handle";
import type {
  BabylonSceneHandle,
  BabylonSceneProps,
} from "./babylon/babylon-scene-types";

// 공개 타입 re-export — 소비자는 계속 `./BabylonScene` 에서 import 한다.
export type {
  BabylonSceneProps,
  BabylonSceneHandle,
  GizmoMode,
  IslandStats,
  BuildVolumeIssue,
} from "./babylon/babylon-scene-types";

const BabylonScene = forwardRef<BabylonSceneHandle, BabylonSceneProps>(
  function BabylonScene(props, ref) {
    const {
      files,
      selectedIds,
      overhangAngleDeg,
      gizmoMode,
      supports,
      supportParams,
      plateWidthMm,
      plateDepthMm,
      plateHeightMm = 0,
      onBuildVolumeIssues,
      editMode,
      selectedSupportId,
      pendingBridgePoint,
      bridgeMode,
      sliceY,
      className = "",
    } = props;

    // 씬 상태(ref 45개) + props→ref 미러링을 한 컨텍스트로 묶는다.
    const ctx = useSceneRefs(props);

    // 재설계 서포트 부품 STL 로드 완료 여부 (useSupportMeshSync 재설계 경로 dep).
    const supportPartsReady = useSupportPartsReady();

    // ★ 훅 호출 순서 = 원본 effect 선언 순서 (불변식 1). React 는 언마운트 시 passive
    //   effect cleanup 을 등록 순서대로 실행하고, 이 파일은 그 순서에 의존한다:
    //   bootstrap cleanup 이 먼저 실행돼 isUnmountingRef 를 세팅해야, 뒤에 오는 brush
    //   cleanup 이 pending 무효화를 "타이머만 정리"로 처리한다. 따라서 아래 순서를
    //   #1/#1.5 → #2/#3 → #3.5 → #4/#5 → #5.5 → #5.6/#5.7 → #6 → #6.5 로 고정한다.
    useSceneBootstrap(ctx, plateWidthMm, plateDepthMm); // #1 씬 부트스트랩 + #1.5 plate
    // STL 로드 완료 신호 (H3). 로드는 비동기라 같은 커밋에서는 meshMapRef 가 비어
    //   있다. 이 tick 이 올라가야 메쉬를 읽는 훅(#7 출력영역 검사)이 새 모델을 본다.
    const [meshLoadTick, setMeshLoadTick] = useState(0);
    useFileMeshSync(ctx, files, overhangAngleDeg, () =>
      setMeshLoadTick((n) => n + 1),
    ); // #2 files→mesh + #3 overhang 색
    // files 는 B-18 수직 이동 감지용(재설계 기둥 길이 재조립). 훅 내부에서 ty 만
    //   신호로 뽑으므로 수평 이동·회전으로는 재조립이 일어나지 않는다.
    useSupportMeshSync(
      ctx,
      supports,
      supportParams,
      supportPartsReady,
      files,
    ); // #3.5 서포트 mesh diff 동기화
    useSelectionSync(
      ctx,
      selectedIds,
      selectedSupportId,
      gizmoMode,
      files,
      editMode,
      supports,
    ); // #4 highlight + #5 gizmo
    useSlicePreview(ctx, sliceY, files, supports, supportParams); // #5.5 Z 슬라이스
    useBridgeVisualization(
      ctx,
      pendingBridgePoint,
      editMode,
      bridgeMode,
      selectedSupportId,
      supports,
      supportParams,
      files,
    ); // #5.6 pending marker + #5.7 Bridge 시각화
    useEditModeSync(ctx, editMode, files, supports); // #6 editMode 동기화
    useDentalBrush(ctx, editMode); // #6.5 dental-brush 페인팅
    // #7 출력영역 초과 경고 (C-2). 씬 상태를 읽기만 하고 아무도 이 훅에
    //   의존하지 않으므로, 불변식 1(훅 순서)을 흔들지 않도록 맨 끝에 둔다.
    useBuildVolumeCheck(
      ctx,
      files,
      plateWidthMm,
      plateDepthMm,
      plateHeightMm,
      onBuildVolumeIssues,
      meshLoadTick,
    );
    // #8 바닥면 붙이기 호버 하이라이트 (B-25). #7 과 같은 이유로 맨 끝.
    useAlignFloorHover(ctx, !!props.alignFloorMode);

    // 외부 ref API — 그룹별 빌더가 반환한 메서드 객체를 조립한다. 각 빌더는 ctx(ref)
    //   와 stable 함수만 참조하므로 deps [] 로 정체성을 고정한다 (원본과 동일).
    useImperativeHandle(
      ref,
      () => ({
        ...buildCameraHandle(ctx),
        ...buildTransformHandle(ctx),
        ...buildSupportGenHandle(ctx),
        ...buildSliceExportHandle(ctx),
        ...buildDentalHandle(ctx),
        ...buildRedesignDetectHandle(ctx),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    return (
      <canvas
        ref={ctx.canvasRef}
        className={`w-full h-full outline-none ${className}`}
        style={{ display: "block" }}
      />
    );
  },
);

export default BabylonScene;
