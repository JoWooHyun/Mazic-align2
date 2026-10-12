// 네이티브 STL 파일 열기 + 뷰어 영역 드래그앤드롭 가져오기 + 예제 모델 불러오기.
// (ViewerV2Page 에서 추출 — 필터·알림·선택 동작 불변.)

import { useCallback, useRef, useState } from "react";

import type { SampleModelDef } from "../../../utils/sample-models";

import type { AddStlFile, AddStlFiles } from "./types";

/** 알림 줄바꿈. */
const NL = String.fromCharCode(10);

interface UseStlDropImportArgs {
  /** 한 파일 저장 — 예제 모델 경로. */
  addStlFile: AddStlFile;
  /** 여러 파일 저장 + 목록 갱신 1회 — 드롭·파일 열기 경로 (사고 방지 3차 ⑥). */
  addStlFiles: AddStlFiles;
  setSelectedIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
}

export function useStlDropImport({
  addStlFile,
  addStlFiles,
  setSelectedIds,
}: UseStlDropImportArgs) {
  // 뷰어 영역 드래그앤드롭 오버레이 표시 여부.
  const [isDragOver, setIsDragOver] = useState(false);
  // 네이티브 파일 열기용 숨김 input.
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ----- 파일 추가/삭제 -----
  // 브라우저 네이티브 파일 열기 / 드래그앤드롭 공통 저장 경로.
  // addStlFiles(useStlFilesV2.addMany) → repo.createStlFile → IndexedDB.
  // 여러 파일을 순차 저장하고 새로 추가된 파일 전체를 선택 상태로 만든다.
  // 사고 방지 3차 ⑥ (C4) — 파일마다 refresh 하면 files 가 N번 바뀌어 앞 파일 로드가 취소·재파싱됐다(useFileMeshSync cancelled).
  //   이제 전부 저장한 뒤 목록 갱신 한 번, 실패한 파일은 알림 한 번에 모은다.
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
      let result: Awaited<ReturnType<AddStlFiles>>;
      try {
        // File 은 Blob 의 서브타입이라 blob 으로 그대로 전달 가능.
        result = await addStlFiles(
          stlFiles.map((f) => ({ fileName: f.name, blob: f })),
        );
      } catch (err) {
        // 파일별 실패는 result.failed 로 온다 — 여기는 저장 자체를 시작하지 못한 경우(프로젝트 없음 등).
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`파일을 저장하지 못했습니다: ${msg}`);
        return;
      }
      const { created, failed } = result;
      if (failed.length > 0) {
        // IndexedDB 저장 실패 등 — 어떤 파일이 왜 실패했는지 한 번에 알린다.
        window.alert(
          `파일을 저장하지 못했습니다:${NL}` +
            failed.map((it) => `· ${it.fileName} — ${it.message}`).join(NL),
        );
      }
      if (created.length > 0) setSelectedIds(new Set(created.map((c) => c.id)));
    },
    [addStlFiles, setSelectedIds],
  );

  // 예제 모델(정육면체/구)을 코드로 생성해 같은 저장 경로로 넣는다.
  //   addNativeFiles 와 동일하게 addStlFile → repo → IndexedDB 를 타므로,
  //   불러온 뒤에는 일반 STL 과 완전히 같게 동작한다 (이동/회전/슬라이스/내보내기).
  const addSampleModel = useCallback(
    async (def: SampleModelDef) => {
      try {
        const created = await addStlFile(def.fileName, def.build());
        setSelectedIds(new Set([created.id]));
      } catch (err) {
        // IndexedDB 저장 실패 등 — 네이티브 열기와 같은 방식으로 알린다.
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`예제를 불러오지 못했습니다: ${def.label} — ${msg}`);
      }
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
    addSampleModel,
    handleNativeInputChange,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
