import { useCallback, useEffect, useState } from "react";

import * as repo from "../data/stl-files.repo";
import * as supportRepo from "../data/supports.repo";
import type { STLFileV2 } from "../types/stl";
import type { TransformV2 } from "../types/transform";
import { useUndoStore } from "./useUndoStore";

/**
 * 한 프로젝트의 STL 파일 목록과 add / remove.
 */
export function useStlFilesV2(projectId: string | undefined) {
  const [files, setFiles] = useState<STLFileV2[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId));
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setFiles(await repo.listStlFilesByProject(projectId));
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (fileName: string, blob: Blob) => {
      if (!projectId) throw new Error("projectId 가 없습니다.");
      const created = await repo.createStlFile(projectId, fileName, blob);
      await refresh();
      return created;
    },
    [projectId, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      // STL 삭제는 되돌릴 수 없다(P-5 보류). 삭제 이전 이력은 사라진 STL 의
      //   서포트를 되살릴 수 있어(허공 서포트) 이력을 끊는다 — 신규 3.
      //   이 함수가 모든 STL 삭제 경로(Delete 키·목록 삭제 버튼·Ctrl+X·
      //   컨텍스트 메뉴)의 단일 관문이다.
      //   시작에서 한 번: 아래 await 사이에 눌린 Ctrl+Z 가 지운 서포트를
      //   cascade 뒤에 되살리는 틈을 막는다. 끝에서 한 번 더: 그 사이 push 된 항목 정리.
      useUndoStore.getState().clear();
      // 서포트 cascade — STL 삭제 시 그 위의 서포트도 같이 지운다.
      await supportRepo.deleteSupportsByStl(id);
      await repo.deleteStlFile(id);
      await refresh();
      useUndoStore.getState().clear();
    },
    [refresh],
  );

  const updateTransform = useCallback(
    async (id: string, transform: TransformV2) => {
      await repo.updateStlFile(id, { transform });
      await refresh();
    },
    [refresh],
  );

  /** Task0 2재료 재료 슬롯 (D1b) — repo 경유 저장(규칙 1) 후 목록 갱신. 되돌리기 이력에는 넣지 않는다(형상 무변경). */
  const updateMaterialSlot = useCallback(
    async (id: string, materialSlot: "A" | "B") => {
      await repo.updateStlFile(id, { materialSlot });
      await refresh();
    },
    [refresh],
  );

  return {
    files,
    loading,
    error,
    refresh,
    add,
    remove,
    updateTransform,
    updateMaterialSlot,
  };
}
