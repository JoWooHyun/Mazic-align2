// STL 선택/클립보드/undo·redo 단축키 핸들러 묶음.
// (ViewerV2Page 에서 추출 — 동작·등록 불변.)

import { useCallback } from "react";

import { useShortcutHandler } from "../../../hooks/useShortcuts";
import { useClipboardStore } from "../../../hooks/useClipboardStore";
import { useUndoStore } from "../../../hooks/useUndoStore";
import type { STLFileV2 } from "../../../types/stl";
import { addCopySuffix } from "../utils/file-naming";
import type { AddStlFile, RemoveStlFile } from "./types";

interface UseClipboardActionsArgs {
  files: STLFileV2[];
  selectedIds: ReadonlySet<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  addStlFile: AddStlFile;
  removeStlFile: RemoveStlFile;
}

/**
 * selectAll / copy / cut / paste / undo / redo 를 등록한다.
 * (delete 는 서포트 편집과 얽혀 useSupportEditing 에서 등록.)
 */
export function useClipboardActions({
  files,
  selectedIds,
  setSelectedIds,
  addStlFile,
  removeStlFile,
}: UseClipboardActionsArgs): void {
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
    if (selectedIds.size === 0) return;
    const toCut = files.filter((f) => selectedIds.has(f.id));
    useClipboardStore
      .getState()
      .set(toCut.map((f) => ({ fileName: f.fileName, blob: f.blob })));
    for (const f of toCut) {
      await removeStlFile(f.id);
    }
    setSelectedIds(new Set());
  }, [files, selectedIds, removeStlFile, setSelectedIds]);

  const handlePaste = useCallback(async () => {
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
  }, [files, addStlFile, setSelectedIds]);

  const handleUndo = useCallback(() => {
    void useUndoStore.getState().undo();
  }, []);
  const handleRedo = useCallback(() => {
    void useUndoStore.getState().redo();
  }, []);

  useShortcutHandler("selectAll", handleSelectAll);
  useShortcutHandler("copy", handleCopy);
  useShortcutHandler("cut", handleCut);
  useShortcutHandler("paste", handlePaste);
  useShortcutHandler("undo", handleUndo);
  useShortcutHandler("redo", handleRedo);
}
