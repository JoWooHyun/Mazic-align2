import { useCallback, useEffect, useState } from "react";

import * as repo from "../data/projects.repo";
import * as stlRepo from "../data/stl-files.repo";
import * as supportRepo from "../data/supports.repo";
import type { ProjectV2, ProjectV2CreateInput } from "../types/project";

/**
 * v2 프로젝트 목록 + 생성·삭제 훅.
 *
 * 옛 useProjects 와 무관. IndexedDB 단일 출처.
 */
export function useProjectsV2() {
  const [projects, setProjects] = useState<ProjectV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await repo.listProjects());
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: ProjectV2CreateInput) => {
      const created = await repo.createProject(input);
      await refresh();
      return created;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      // STL · 서포트 cascade — 프로젝트 삭제 시 같이 지운다.
      await supportRepo.deleteSupportsByProject(id);
      await stlRepo.deleteStlFilesByProject(id);
      await repo.deleteProject(id);
      await refresh();
    },
    [refresh],
  );

  return { projects, loading, error, refresh, create, remove };
}

/** 단일 프로젝트 조회. */
export function useProjectV2(id: string | undefined) {
  const [project, setProject] = useState<ProjectV2 | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(id));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id) {
      setProject(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    repo.getProject(id).then(
      (p) => {
        if (!cancelled) {
          setProject(p ?? null);
          setLoading(false);
        }
      },
      (e) => {
        if (!cancelled) {
          setError(e as Error);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  /**
   * 프로젝트 필드 갱신 (repo 경유 — 규칙 1) 후 화면 상태를 저장된 레코드로 바꾼다.
   * 지금 쓰는 곳: Task0 재료 모드(task0MaterialMode — D1b)·재료 이름(D2). lastModifiedAt 은 repo 가 갱신한다.
   * 실패하면 화면을 저장된 레코드로 되돌리고 원래 오류를 다시 던진다(부르는 쪽의 알림 유지).
   */
  const update = useCallback(
    async (patch: Partial<Omit<ProjectV2, "id" | "createdAt">>) => {
      if (!id) return;
      // 사고 방지 3차 ⑧ — 저장을 기다리기 전에 화면 상태에 먼저 반영한다. 재료 이름 칸에서 Enter 없이 곧바로
      //   "job.zip" 을 누르면 blur 커밋(이 함수)과 클릭이 같은 제스처라, 종전엔 클릭 핸들러가 옛 이름을 읽어 manifest 에 썼다.
      //   React 는 blur 이벤트 끝에 이 상태를 동기로 그려 주므로 클릭 시점에는 새 이름의 핸들러가 걸려 있다.
      setProject((prev) => (prev ? { ...prev, ...patch } : prev));
      try {
        const next = await repo.updateProject(id, patch);
        setProject(next);
      } catch (e) {
        // 실패하면 저장된 레코드로 되돌린다(화면이 저장 안 된 값을 계속 보이지 않게).
        try {
          setProject((await repo.getProject(id)) ?? null);
        } catch {
          // 되돌리기 실패는 무시 — 원래 오류를 우선 알린다.
        }
        throw e;
      }
    },
    [id],
  );

  return { project, loading, error, update };
}
