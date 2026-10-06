// Task0 2재료 (D1b·D2) — 프로젝트 재료 모드·파일별 재료 슬롯·재료 이름의 화면 상태·핸들러 + 슬라이스 화면 재료 색.
// (ViewerV2Page 에 기능을 더하지 않으려고 뺀 조각 — 페이지는 이 훅을 부르고 결과를 패널·목록·단면 pane 에 넘기기만 한다.)
//
// 데이터는 repo 경유(규칙 1): 모드·이름 = useProjectV2.update({ task0MaterialMode | task0MaterialNames }),
//   슬롯 = useStlFilesV2.updateMaterialSlot. 기본값 해석(모드 없음 = 단일, 슬롯 없음 = B, 이름 없음 = 기본 이름)과
//   이름 정규화는 utils/task0/task0-material 한 곳.
// 재료 색은 슬라이스 화면(재료 카드가 보이는 곳)에서 Task0 2재료일 때만 — sliceSlots(STL id → 슬롯, 그 밖에서는 null)를
//   3D 는 handle setMaterialSlotColors(규칙 2 — 씬의 재료 색 상태, D2)로, 2D 단면 pane 은 prop 으로 받는다.
//   sliceSlots 는 내용(파일 id·슬롯)이 같으면 같은 객체라 handle 은 상태가 바뀔 때만 불린다(멱등). STL 색을 되돌리는
//   씬 쪽 effect(useEditModeSync 등)도 같은 상태를 읽으므로 "부모 effect 가 다시 칠한다" 순서 의존이 없다(D1b 남은 위험).
//   편집 화면은 편집 모드마다 표시 색(서포트 탭 = 오버행 색)이 따로 있어 칠하지 않는다.

import { useCallback, useEffect, useMemo } from "react";

import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import type { Task0MaterialCardProps } from "../../../components/Task0MaterialCard";
import type { ProjectV2 } from "../../../types/project";
import type { PrinterProfileV2 } from "../../../types/printer";
import type { STLFileV2 } from "../../../types/stl";
import {
  resolveStlMaterialSlot,
  resolveTask0MaterialMode,
  resolveTask0MaterialNames,
  task0MaterialNamesWith,
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
  /** 슬라이스 미리보기 화면인지 (slicePreview.on) — 재료 색은 이때만 */
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
  // 재료 이름 (D2) — 정규화·기본값을 채운 표시값. 저장값(레코드 필드)은 바꿀 때 바탕으로 쓴다
  const names = resolveTask0MaterialNames(project);
  const nameA = names.A;
  const nameB = names.B;
  const storedNames = project?.task0MaterialNames;

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

  // 재료 이름 저장 (D2) — 카드가 입력을 마칠 때(blur·Enter)만 부른다(타이핑마다 IndexedDB 쓰기 없음).
  //   정규화한 결과가 지금 이름과 같으면 쓰지 않는다. 기본 이름과 같은 슬롯은 레코드에서 뺀다(task0MaterialNamesWith).
  const setName = useCallback(
    (slot: Task0MaterialSlot, raw: string) => {
      const next = task0MaterialNamesWith(storedNames, slot, raw);
      const after = resolveTask0MaterialNames({ task0MaterialNames: next });
      if (after.A === nameA && after.B === nameB) return;
      updateProject({ task0MaterialNames: next }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        window.alert(`재료 이름을 저장하지 못했습니다.${NL}${msg}`);
      });
    },
    [storedNames, nameA, nameB, updateProject],
  );

  // 슬라이스 화면 재료 색의 슬롯 표 (STL id → 슬롯) — 슬라이스 화면 + Task0 2재료일 때만, 아니면 null.
  //   파일 목록 배열은 저장·변환 커밋마다 새로 읽혀 참조가 바뀌므로, 내용(id·슬롯) 문자열을 키로 memo 한다 —
  //   슬롯이 실제로 바뀔 때만 새 객체(= handle 을 다시 부를 계기).
  const slotKey = JSON.stringify(files.map((f) => [f.id, resolveStlMaterialSlot(f)]));
  const sliceSlots = useMemo<Readonly<Record<string, Task0MaterialSlot>> | null>(() => {
    if (!(sliceOn && dualActive)) return null;
    const out: Record<string, Task0MaterialSlot> = {};
    for (const [id, slot] of JSON.parse(slotKey) as [string, Task0MaterialSlot][]) out[id] = slot;
    return out;
  }, [sliceOn, dualActive, slotKey]);

  // 3D 재료 색 — 씬의 재료 색 상태를 바꾼다(handle setMaterialSlotColors, 멱등). null 이면 원래 색.
  //   뒤에 끝나는 메시 로드·서포트 갱신·편집 모드 동기화는 씬이 같은 상태를 읽어 맞춘다(components/babylon/material-display).
  useEffect(() => {
    sceneHandleRef.current?.setMaterialSlotColors(sliceSlots);
  }, [sliceSlots, sceneHandleRef]);

  // 슬라이스 패널 재료 카드 — Task0 프로파일에서만
  const card = useMemo<Omit<Task0MaterialCardProps, "disabled"> | undefined>(
    () =>
      task0
        ? {
            mode,
            onModeChange: setMode,
            files: files.map((f) => ({ id: f.id, fileName: f.fileName, slot: resolveStlMaterialSlot(f) })),
            onSlotChange: setSlot,
            names: { A: nameA, B: nameB },
            onNameChange: setName,
          }
        : undefined,
    [task0, mode, files, setMode, setSlot, nameA, nameB, setName],
  );

  // 왼쪽 모델 목록 A/B — Task0 2재료일 때만
  const listSlots = useMemo<Task0ListSlotProps | undefined>(
    () => (dualActive ? { slotOf: resolveStlMaterialSlot, onChange: setSlot } : undefined),
    [dualActive, setSlot],
  );

  return { task0, mode, dualActive, card, listSlots, sliceSlots };
}
