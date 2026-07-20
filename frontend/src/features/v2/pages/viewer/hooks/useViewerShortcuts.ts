// 뷰 프리셋·줌·도구(Gizmo 모드) 단축키 등록 묶음 (P2·P4·P5).
// (ViewerV2Page 에서 추출 — 키 매핑·조건 불변.)

import { useCallback } from "react";

import { useShortcutHandler } from "../../../hooks/useShortcuts";
import type { BabylonSceneHandle, GizmoMode } from "../../../components/BabylonScene";
import type { ViewPreset } from "../../../utils/camera-views";
import type { EditMode } from "../../../components/EditModeControls";

interface UseViewerShortcutsArgs {
  sceneHandleRef: React.RefObject<BabylonSceneHandle>;
  selectedIds: ReadonlySet<string>;
  editMode: EditMode;
  setGizmoMode: React.Dispatch<React.SetStateAction<GizmoMode>>;
}

interface UseViewerShortcutsResult {
  /** 컨텍스트 메뉴 "줌 투 핏" 에서도 재사용. */
  zoomFit: () => void;
}

/**
 * 0~6 뷰 프리셋 / Z(줌투핏)·B(플레이트) / M·R·S(도구) 를 등록한다.
 * (undo/redo/clipboard 는 useClipboardActions, delete 는 useSupportEditing.)
 */
export function useViewerShortcuts({
  sceneHandleRef,
  selectedIds,
  editMode,
  setGizmoMode,
}: UseViewerShortcutsArgs): UseViewerShortcutsResult {
  // ----- 뷰 프리셋·줌 단축키 (P2, 프루사 동일 키) -----
  //   0=Iso, 1=Top, 2=Bottom, 3=Front, 4=Back, 5=Left, 6=Right (숫자키).
  //   ViewControls 의 setView 핸들 경로를 그대로 재사용한다(별도 배선 없음).
  const setView = useCallback(
    (preset: ViewPreset) => {
      sceneHandleRef.current?.setView(preset);
    },
    [sceneHandleRef],
  );
  useShortcutHandler("viewIso", useCallback(() => setView("iso"), [setView]));
  useShortcutHandler("viewTop", useCallback(() => setView("top"), [setView]));
  useShortcutHandler(
    "viewBottom",
    useCallback(() => setView("bottom"), [setView]),
  );
  useShortcutHandler(
    "viewFront",
    useCallback(() => setView("front"), [setView]),
  );
  useShortcutHandler("viewBack", useCallback(() => setView("back"), [setView]));
  useShortcutHandler("viewLeft", useCallback(() => setView("left"), [setView]));
  useShortcutHandler(
    "viewRight",
    useCallback(() => setView("right"), [setView]),
  );
  // Z=줌투핏(선택 한정), B=플레이트 전용 뷰 — 정밀 의미 분리 (P5).
  //   Z(zoomFit): 선택된 메쉬만 화면에 꽉 차게. 선택이 없으면 전체 fit 폴백.
  //   B(viewPlate): 모델과 무관하게 홈 각도로 플레이트(빌드 볼륨) 전체를 프레이밍.
  const zoomFit = useCallback(() => {
    sceneHandleRef.current?.fitSelection(Array.from(selectedIds));
  }, [sceneHandleRef, selectedIds]);
  const viewPlate = useCallback(() => {
    sceneHandleRef.current?.viewPlate();
  }, [sceneHandleRef]);
  useShortcutHandler("zoomFit", zoomFit);
  useShortcutHandler("viewPlate", viewPlate);

  // ----- 도구 키 (P4, 프루사 동일): M=Move, R=Rotate, S=Scale -----
  //   select 모드에서만 동작(Gizmo 가 detach 되는 다른 모드에서는 무시).
  //   같은 키 재입력 시 해제하지 않고 해당 모드로 set — GizmoControls 버튼 동작과 일치.
  const handleToolMove = useCallback(() => {
    if (editMode === "select") setGizmoMode("translate");
  }, [editMode, setGizmoMode]);
  const handleToolRotate = useCallback(() => {
    if (editMode === "select") setGizmoMode("rotate");
  }, [editMode, setGizmoMode]);
  const handleToolScale = useCallback(() => {
    if (editMode === "select") setGizmoMode("scale");
  }, [editMode, setGizmoMode]);
  useShortcutHandler("toolMove", handleToolMove);
  useShortcutHandler("toolRotate", handleToolRotate);
  useShortcutHandler("toolScale", handleToolScale);

  // zoomFit 은 컨텍스트 메뉴 "줌 투 핏" 에서도 재사용하므로 반환한다.
  return { zoomFit };
}
