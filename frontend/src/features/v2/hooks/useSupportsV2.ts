import { useCallback, useEffect, useState } from "react";

import * as repo from "../data/supports.repo";
import type { SupportPointV2 } from "../support/types";

/**
 * 한 프로젝트의 서포트 점 목록 + 일괄 add / 단일·일괄 remove / 전부 clear.
 */
export function useSupportsV2(projectId: string | undefined) {
  const [supports, setSupports] = useState<SupportPointV2[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId));
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setSupports([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSupports(await repo.listSupportsByProject(projectId));
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addMany = useCallback(
    async (points: SupportPointV2[]) => {
      if (points.length === 0) return;
      await repo.addSupports(points);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await repo.deleteSupport(id);
      await refresh();
    },
    [refresh],
  );

  /**
   * 여러 점을 한 번에 삭제 (B-1 무효화 등). 단일 tx + refresh 1회 —
   * remove 를 N 번 부르면 전체 스캔·setState·메쉬 동기가 N 번 돌아
   * 서포트가 하나씩 사라지는 깜빡임과 O(N²) 읽기가 생긴다.
   */
  const removeMany = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      await repo.deleteSupportsByIds(ids);
      await refresh();
    },
    [refresh],
  );

  const clearAll = useCallback(async () => {
    if (!projectId) return;
    await repo.deleteSupportsByProject(projectId);
    await refresh();
  }, [projectId, refresh]);

  /**
   * 단일 SupportPoint 의 contact / base 등을 patch.
   * 호출 측에서 정확한 좌표를 만들어 전달한다 (예: contact 의 Y 유지).
   */
  const patchSupport = useCallback(
    async (
      id: string,
      patch: Partial<{
        contact: [number, number, number];
        base: [number, number, number];
        curveControlPoints: [number, number, number][];
        coordSpace: "world" | "stl-local";
      }>,
    ) => {
      await repo.updateSupport(id, patch);
      await refresh();
    },
    [refresh],
  );

  const clearForStl = useCallback(
    async (stlId: string) => {
      await repo.deleteSupportsByStl(stlId);
      await refresh();
    },
    [refresh],
  );

  return {
    supports,
    loading,
    error,
    refresh,
    addMany,
    remove,
    removeMany,
    clearAll,
    clearForStl,
    patchSupport,
  };
}
