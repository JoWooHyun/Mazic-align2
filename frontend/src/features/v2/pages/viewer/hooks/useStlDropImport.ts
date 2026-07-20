// 네이티브 STL 파일 열기 + 뷰어 영역 드래그앤드롭 가져오기.
// (ViewerV2Page 에서 추출 — 필터·알림·선택 동작 불변.)

import { useCallback, useRef, useState } from "react";

import type { AddStlFile } from "./types";

interface UseStlDropImportArgs {
  addStlFile: AddStlFile;
  setSelectedIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
}

export function useStlDropImport({
  addStlFile,
  setSelectedIds,
}: UseStlDropImportArgs) {
  // 뷰어 영역 드래그앤드롭 오버레이 표시 여부.
  const [isDragOver, setIsDragOver] = useState(false);
  // 네이티브 파일 열기용 숨김 input.
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ----- 파일 추가/삭제 -----
  // 브라우저 네이티브 파일 열기 / 드래그앤드롭 공통 저장 경로.
  // addStlFile → repo.createStlFile → IndexedDB.
  // 여러 파일을 순차 저장하고 새로 추가된 파일 전체를 선택 상태로 만든다.
  const addNativeFiles = useCallback(
    async (fileList: File[]) => {
      const stlFiles = fileList.filter((f) =>
        f.name.toLowerCase().endsWith(".stl"),
      );
      // .stl 이 아니라 걸러진 파일이 있으면 어떤 파일이 제외됐는지 알린다.
      const rejected = fileList.filter(
        (f) => !f.name.toLowerCase().endsWith(".stl"),
      );
      if (rejected.length > 0) {
        window.alert(
          `STL 파일이 아닙니다: ${rejected.map((f) => f.name).join(", ")}`,
        );
      }
      // 전체가 걸러졌으면 위 알림만 하고 종료 (무음 실패 방지).
      if (stlFiles.length === 0) return;
      const newIds: string[] = [];
      for (const file of stlFiles) {
        try {
          // File 은 Blob 의 서브타입이라 blob 으로 그대로 전달 가능.
          const created = await addStlFile(file.name, file);
          newIds.push(created.id);
        } catch (err) {
          // IndexedDB 저장 실패 등 — 어떤 파일이 왜 실패했는지 알린다.
          const msg = err instanceof Error ? err.message : String(err);
          window.alert(`파일을 저장하지 못했습니다: ${file.name} — ${msg}`);
        }
      }
      if (newIds.length > 0) setSelectedIds(new Set(newIds));
    },
    [addStlFile, setSelectedIds],
  );

  // 숨김 input 을 통한 "내 PC에서 열기".
  const handleNativeInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files ? Array.from(e.target.files) : [];
      // 같은 파일을 다시 선택해도 onChange 가 발생하도록 value 초기화.
      e.target.value = "";
      void addNativeFiles(picked);
    },
    [addNativeFiles],
  );

  // ----- 드래그앤드롭 (뷰어 영역) -----
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // canvas 등 자식 요소로 이동하는 경우는 무시하고, 컨테이너 바깥으로
    // 실제로 벗어날 때만 해제. relatedTarget 이 main 안에 없으면 이탈.
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      // dataTransfer.files 가 비면 OneDrive 온라인 전용 파일이나 바로가기를
      // 드롭한 경우일 수 있다 (리드 환경 진단용 안내).
      if (e.dataTransfer.files.length === 0) {
        window.alert(
          "가져올 파일이 없습니다 — OneDrive 온라인 전용 파일이거나 바로가기일 수 있습니다",
        );
        return;
      }
      const dropped = Array.from(e.dataTransfer.files);
      void addNativeFiles(dropped);
    },
    [addNativeFiles],
  );

  return {
    isDragOver,
    fileInputRef,
    handleNativeInputChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
