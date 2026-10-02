// STL 선택/클립보드/undo·redo 단축키 핸들러 묶음.
// (ViewerV2Page 에서 추출 — 동작·등록 불변.)
//
// 슬라이스 미리보기 중(editLocked)에는 편집 키(Ctrl+X/V/Z/Y)를 잠근다 — 신규 7.
// 프로젝트 전환·뷰어 이탈 시 undo/redo 이력을 비운다 — 신규 2.

import { useCallback, useEffect } from "react";

import { useShortcutHandler } from "../../../hooks/useShortcuts";
import { useClipboardStore } from "../../../hooks/useClipboardStore";
import { useUndoStore } from "../../../hooks/useUndoStore";
import type { STLFileV2 } from "../../../types/stl";
import { addCopySuffix } from "../utils/file-naming";
import type { AddStlFile, RefreshSupports, RemoveStlFile } from "./types";

interface UseClipboardActionsArgs {
  projectId: string | undefined;
  files: STLFileV2[];
  selectedIds: ReadonlySet<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  addStlFile: AddStlFile;
  removeStlFile: RemoveStlFile;
  refreshSupports: RefreshSupports;
  /** 편집 잠금 (= 슬라이스 미리보기 중). true 면 cut/paste/undo/redo 무시. */
  editLocked: boolean;
}

/**
 * selectAll / copy / cut / paste / undo / redo 를 등록한다.
 * (delete 는 서포트 편집과 얽혀 useSupportEditing 에서 등록.)
 *
 * editLocked 동안 cut/paste/undo/redo 는 아무것도 하지 않는다 — 미리보기 중
 * 모델이 사라지거나 움직이면 씬 편집 잠금과 어긋난다. selectAll/copy 는
 * 편집이 아니라 잠그지 않는다.
 *
 * projectId 가 바뀌거나 뷰어가 언마운트되면 undo/redo 이력을 비운다 — 전역
 * 스토어라 남겨 두면 다른 프로젝트의 변경이 Ctrl+Z 로 몰래 되돌려진다.
 * 클립보드는 비우지 않는다(프로젝트 간 STL 복사·붙여넣기는 의도된 기능).
 */
export function useClipboardActions({
  projectId,
  files,
  selectedIds,
  setSelectedIds,
  addStlFile,
  removeStlFile,
  refreshSupports,
  editLocked,
}: UseClipboardActionsArgs): void {
  // 프로젝트 전환(같은 컴포넌트에서 :projectId 만 바뀌는 경우 포함)·뷰어 이탈 시
  //   이력을 비운다 — 신규 2.
  useEffect(() => {
    useUndoStore.getState().clear();
    return () => useUndoStore.getState().clear();
  }, [projectId]);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(files.map((f) => f.id)));
  }, [files, setSelectedIds]);

  const handleCopy = useCallback(() => {
    if (selectedIds.size === 0) return;
    const items = files
      .filter((f) => selectedIds.has(f.id))
      .map((f) => ({ fileName: f.fileName, blob: f.blob }));
    useClipboardStore.getState().set(items);
  }, [files, selectedIds]);

  const handleCut = useCallback(async () => {
    if (editLocked) return;
    if (selectedIds.size === 0) return;
    const toCut = files.filter((f) => selectedIds.has(f.id));
    useClipboardStore
      .getState()
      .set(toCut.map((f) => ({ fileName: f.fileName, blob: f.blob })));
    for (const f of toCut) {
      await removeStlFile(f.id);
    }
    // STL 삭제는 DB cascade 로 그 STL 의 서포트도 같이 사라지지만
    // useSupportsV2 state 가 stale 이라 명시적 refresh 필요 (Delete 경로와 동일) — 신규 4.
    await refreshSupports();
    setSelectedIds(new Set());
  }, [editLocked, files, selectedIds, removeStlFile, refreshSupports, setSelectedIds]);

  const handlePaste = useCallback(async () => {
    if (editLocked) return;
    const items = useClipboardStore.getState().items;
    if (items.length === 0) return;
    const newIds: string[] = [];
    for (const item of items) {
      const created = await addStlFile(
        addCopySuffix(item.fileName, files),
        item.blob,
      );
      newIds.push(created.id);
    }
    setSelectedIds(new Set(newIds));
  }, [editLocked, files, addStlFile, setSelectedIds]);

  const handleUndo = useCallback(() => {
    if (editLocked) return;
    void useUndoStore.getState().undo();
  }, [editLocked]);
  const handleRedo = useCallback(() => {
    if (editLocked) return;
    void useUndoStore.getState().redo();
  }, [editLocked]);

  useShortcutHandler("selectAll", handleSelectAll);
  useShortcutHandler("copy", handleCopy);
  useShortcutHandler("cut", handleCut);
  useShortcutHandler("paste", handlePaste);
  useShortcutHandler("undo", handleUndo);
  useShortcutHandler("redo", handleRedo);
}
