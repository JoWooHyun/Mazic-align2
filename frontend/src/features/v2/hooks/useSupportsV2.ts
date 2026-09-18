import { useCallback, useEffect, useState } from "react";

import * as repo from "../data/supports.repo";
import type { PillarBraceRecord, SupportPointV2 } from "../support/types";

/**
 * 한 프로젝트의 서포트 점 목록 + 일괄 add / 단일·일괄 remove / 전부 clear.
 */
export function useSupportsV2(projectId: string | undefined) {
  const [supports, setSupports] = useState<SupportPointV2[]>([]);
  /**
   * 기둥 연결 브레이스 (S-4b-2d). 서포트 점과 **같은 스토어**에 살지만 조회는
   *   별도 함수로 가른다 — `SupportPointV2[]` 에 섞이면 조립·export 가 다리를
   *   기둥으로 세우려 든다(타입 오염). refresh 한 번에 둘 다 읽어 두 목록이
   *   서로 다른 시점의 DB 를 보는 일이 없게 한다.
   */
  const [pillarBraces, setPillarBraces] = useState<PillarBraceRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(projectId));
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setSupports([]);
      setPillarBraces([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [points, braces] = await Promise.all([
        repo.listSupportsByProject(projectId),
        repo.listPillarBracesByProject(projectId),
      ]);
      setSupports(points);
      setPillarBraces(braces);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * 기둥 연결 브레이스 일괄 추가 (S-4b-2d). 점 저장과 **같은 패턴**.
   *   삭제 전용 함수는 두지 않는다 — 리드 확정대로 다리는 개별 삭제 대상이
   *   아니고, 기둥 삭제 cascade 는 `useSupportEditing` 이 repo 를 직접 부른다.
   */
  const addPillarBraces = useCallback(
    async (braces: PillarBraceRecord[]) => {
      if (braces.length === 0) return;
      await repo.addPillarBraces(braces);
      await refresh();
    },
    [refresh],
  );

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
    pillarBraces,
    addPillarBraces,
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
