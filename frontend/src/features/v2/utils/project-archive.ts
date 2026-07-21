/**
 * 프로젝트 단위 export/import — .mzalign (= ZIP STORE).
 *
 * 구조:
 *   metadata.json   ← project + supports + transforms
 *   stl/<stlId>.stl ← 각 STL binary 그대로
 */

import * as projectRepo from "../data/projects.repo";
import * as stlRepo from "../data/stl-files.repo";
import * as supportRepo from "../data/supports.repo";
import type { ProjectV2 } from "../types/project";
import type { STLFileV2 } from "../types/stl";
import type { SupportPointV2 } from "../support/types";
import { makeZipStore, unzipStore, type ZipEntry } from "./zip-store";

interface ArchiveMetadata {
  version: 1;
  project: ProjectV2;
  /** stlId → fileName / addedAt / transform. blob 은 별도 stl/<id>.stl 에. */
  stlFiles: Omit<STLFileV2, "blob">[];
  supports: SupportPointV2[];
}

const META = "metadata.json";

/**
 * IndexedDB 의 프로젝트 + STL + supports 를 .mzalign Blob 으로 export.
 */
export async function exportProjectArchive(projectId: string): Promise<Blob> {
  const project = await projectRepo.getProject(projectId);
  if (!project) throw new Error(`프로젝트 없음: ${projectId}`);
  const stlFiles = await stlRepo.listStlFilesByProject(projectId);
  const supports = await supportRepo.listSupportsByProject(projectId);

  const meta: ArchiveMetadata = {
    version: 1,
    project,
    stlFiles: stlFiles.map(({ blob: _b, ...rest }) => rest),
    supports,
  };

  const entries: ZipEntry[] = [
    {
      name: META,
      data: new TextEncoder().encode(JSON.stringify(meta)),
    },
  ];
  for (const f of stlFiles) {
    const ab = await f.blob.arrayBuffer();
    entries.push({
      name: `stl/${f.id}.stl`,
      data: new Uint8Array(ab),
    });
  }
  return makeZipStore(entries);
}

export interface ImportPreview {
  meta: ArchiveMetadata;
  /** IndexedDB 에 이미 같은 id 의 프로젝트가 있는지. */
  conflict: boolean;
}

/**
 * .mzalign Blob 의 metadata 만 미리 파싱. 사용자에게 충돌 여부 보여줌.
 */
export async function previewImportArchive(blob: Blob): Promise<ImportPreview> {
  const entries = await unzipStore(blob);
  const metaEntry = entries.find((e) => e.name === META);
  if (!metaEntry) throw new Error("metadata.json 없음 (mzalign 아님)");
  const meta: ArchiveMetadata = JSON.parse(new TextDecoder().decode(metaEntry.data));
  if (meta.version !== 1) {
    throw new Error(`지원 안 함 버전: ${meta.version}`);
  }
  const existing = await projectRepo.getProject(meta.project.id);
  return { meta, conflict: !!existing };
}

/**
 * .mzalign Blob 을 IndexedDB 에 import.
 *
 * mode:
 *   · 'overwrite' — 같은 id 프로젝트가 있으면 기존 STL/supports 삭제 후 새로
 *   · 'new'       — project + 모든 STL/supports 의 id 를 새로 생성 (충돌 회피)
 */
export async function importProjectArchive(
  blob: Blob,
  mode: "overwrite" | "new",
): Promise<{ projectId: string }> {
  const entries = await unzipStore(blob);
  const metaEntry = entries.find((e) => e.name === META);
  if (!metaEntry) throw new Error("metadata.json 없음");
  const meta: ArchiveMetadata = JSON.parse(new TextDecoder().decode(metaEntry.data));

  const stlBlobByOldId = new Map<string, Blob>();
  for (const e of entries) {
    if (!e.name.startsWith("stl/")) continue;
    const id = e.name.replace(/^stl\//, "").replace(/\.stl$/, "");
    stlBlobByOldId.set(id, new Blob([e.data], { type: "model/stl" }));
  }

  // id remap (new mode 만).
  const idMap = new Map<string, string>();
  const newId = (oldId: string): string => {
    if (mode === "overwrite") return oldId;
    let mapped = idMap.get(oldId);
    if (!mapped) {
      mapped = crypto.randomUUID();
      idMap.set(oldId, mapped);
    }
    return mapped;
  };

  const newProjectId = newId(meta.project.id);
  const now = Date.now();

  // 1) Project — overwrite 면 기존 cascade 삭제 후 put, new 면 새 id 로 put.
  if (mode === "overwrite") {
    await stlRepo.deleteStlFilesByProject(meta.project.id);
    await supportRepo.deleteSupportsByProject(meta.project.id);
    await projectRepo.putProject({
      ...meta.project,
      lastModifiedAt: now,
    });
  } else {
    await projectRepo.putProject({
      ...meta.project,
      id: newProjectId,
      code: `${meta.project.code}_${now.toString(36).slice(-4)}`,
      name: `${meta.project.name} (사본)`,
      createdAt: now,
      lastModifiedAt: now,
    });
  }

  // 2) STL — id remap (new mode).
  for (const old of meta.stlFiles) {
    const blob = stlBlobByOldId.get(old.id);
    if (!blob) continue;
    const stlId = newId(old.id);
    await stlRepo.putStlFile({
      ...old,
      id: stlId,
      projectId: newProjectId,
      blob,
    });
  }

  // 3) Supports — id / stlId / baseStlId / attachedTo.supportId 모두 remap.
  //   폐기된 dental disc 서포트(variant==="disc") 레코드는 조용히 걸러낸다
  //   (옛 아카이브 하위 호환 — 마이그레이션 불필요, 무시만).
  const newSupports: SupportPointV2[] = meta.supports
    .filter((s) => (s as { variant?: string }).variant !== "disc")
    .map((s) => ({
      ...s,
      id: newId(s.id),
      projectId: newProjectId,
      stlId: newId(s.stlId),
      baseStlId: s.baseStlId ? newId(s.baseStlId) : undefined,
      contactAttachedTo: s.contactAttachedTo
        ? {
            supportId: newId(s.contactAttachedTo.supportId),
            t: s.contactAttachedTo.t,
          }
        : undefined,
      baseAttachedTo: s.baseAttachedTo
        ? {
            supportId: newId(s.baseAttachedTo.supportId),
            t: s.baseAttachedTo.t,
          }
        : undefined,
    }));
  await supportRepo.addSupports(newSupports);

  return { projectId: newProjectId };
}
