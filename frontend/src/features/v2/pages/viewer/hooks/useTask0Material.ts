// Task0 2재료 (D1b) — 프로젝트 재료 모드·파일별 재료 슬롯의 화면 상태·핸들러 + 3D 재료 색.
// (ViewerV2Page 에 기능을 더하지 않으려고 뺀 조각 — 페이지는 이 훅을 부르고 결과를 패널·목록에 넘기기만 한다.)
//
// 데이터는 repo 경유(규칙 1): 모드 = useProjectV2.update({ task0MaterialMode }), 슬롯 = useStlFilesV2.updateMaterialSlot.
// 기본값 해석(모드 없음 = 단일, 슬롯 없음 = B)은 utils/task0/task0-material 한 곳.
// 3D 색은 handle setMaterialSlotColors(규칙 2) — 슬라이스 화면(재료 카드가 보이는 곳)에서 Task0 2재료일 때만 칠하고,
//   그 밖에서는 원래 색으로 되돌린다. 편집 화면은 편집 모드마다 표시 색(서포트 탭 = 오버행 색)이 따로 있어 칠하지 않는다.

import { useCallback, useEffect, useMemo } from "react";

import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import type { Task0MaterialCardProps } from "../../../components/Task0MaterialCard";
import type { ProjectV2 } from "../../../types/project";
import type { PrinterProfileV2 } from "../../../types/printer";
import type { STLFileV2 } from "../../../types/stl";
import {
  resolveStlMaterialSlot,
  resolveTask0MaterialMode,
  type Task0MaterialMode,
} from "../../../utils/task0/task0-material";
import { isTask0Profile } from "../../../utils/task0/task0-profile";
import type { Task0MaterialSlot } from "../../../utils/task0/task0-slice";
import type { UpdateMaterialSlot, UpdateProject } from "./types";

/** 확인 다이얼로그 줄바꿈. */
const NL = String.fromCharCode(10);

interface UseTask0MaterialArgs {
  project: ProjectV2 | null | undefined;
  updateProject: UpdateProject;
  files: STLFileV2[];
  updateMaterialSlot: UpdateMaterialSlot;
  printerProfile: PrinterProfileV2;
  sceneHandleRef: React.RefObject<BabylonSceneHandle>;
  /** 슬라이스 미리보기 화면인지 (slicePreview.on) — 3D 재료 색은 이때만 */
  sliceOn: boolean;
}

/** 왼쪽 모델 목록의 A/B 고르기 (2재료일 때만) */
export interface Task0ListSlotProps {
  slotOf: (file: STLFileV2) => Task0MaterialSlot;
  onChange: (id: string, slot: Task0MaterialSlot) => void;
}

export function useTask0Material({
  project,
  updateProject,
  files,
  updateMaterialSlot,
  printerProfile,
  sceneHandleRef,
  sliceOn,
}: UseTask0MaterialArgs) {
  const task0 = isTask0Profile(printerProfile);
  const mode = resolveTask0MaterialMode(project);
  // 재료 모드는 Task0 프로파일에서만 의미가 있다 — 다른 프로파일이면 저장값이 2재료여도 화면·출력에 쓰지 않는다
  const dualActive = task0 && mode === "dual";

  const setMode = useCallback(
    (next: Task0MaterialMode) => {
      updateProject({ task0MaterialMode: next }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        window.alert(`재료 모드를 저장하지 못했습니다.${NL}${msg}`);
      });
    },
    [updateProject],
  );

  const setSlot = useCallback(
    (id: string, slot: Task0MaterialSlot) => {
      updateMaterialSlot(id, slot).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        window.alert(`재료 슬롯을 저장하지 못했습니다.${NL}${msg}`);
      });
    },
    [updateMaterialSlot],
  );

  // 3D 재료 색 — 슬라이스 화면 + Task0 2재료일 때만. useEditModeSync(씬 자식 effect)가 files·잠금이 바뀔 때 STL 색을 되돌리므로
  //   같은 deps(files·sliceOn)로 부모 effect 에서 다시 칠한다(자식 effect 가 먼저 돈다). null 은 멱등(이미 원래 색이면 그대로).
  useEffect(() => {
    const handle = sceneHandleRef.current;
    if (!handle) return;
    if (!(sliceOn && dualActive)) {
      handle.setMaterialSlotColors(null);
      return;
    }
    const slots: Record<string, Task0MaterialSlot> = {};
    for (const f of files) slots[f.id] = resolveStlMaterialSlot(f);
    handle.setMaterialSlotColors(slots);
  }, [sliceOn, dualActive, files, sceneHandleRef]);

  // 슬라이스 패널 재료 카드 — Task0 프로파일에서만
  const card = useMemo<Omit<Task0MaterialCardProps, "disabled"> | undefined>(
    () =>
      task0
        ? {
            mode,
            onModeChange: setMode,
            files: files.map((f) => ({ id: f.id, fileName: f.fileName, slot: resolveStlMaterialSlot(f) })),
            onSlotChange: setSlot,
          }
        : undefined,
    [task0, mode, files, setMode, setSlot],
  );

  // 왼쪽 모델 목록 A/B — Task0 2재료일 때만
  const listSlots = useMemo<Task0ListSlotProps | undefined>(
    () => (dualActive ? { slotOf: resolveStlMaterialSlot, onChange: setSlot } : undefined),
    [dualActive, setSlot],
  );

  return { task0, mode, dualActive, card, listSlots };
}
