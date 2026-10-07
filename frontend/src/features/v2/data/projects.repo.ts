import { openDb, settleTx, STORE_PROJECTS } from "./db";
import type { ProjectV2, ProjectV2CreateInput } from "../types/project";

/**
 * 8자리 영문 대문자 + 숫자 코드. 충돌은 거의 안 나지만 만약 충돌하면
 * 다시 뽑는다.
 */
function generateCode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** 최신 수정 순으로 전부 가져온다. */
export async function listProjects(): Promise<ProjectV2[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, "readonly");
    const idx = tx.objectStore(STORE_PROJECTS).index("by_lastModifiedAt");
    const out: ProjectV2[] = [];
    idx.openCursor(null, "prev").onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        out.push(cursor.value as ProjectV2);
        cursor.continue();
      }
    };
    settleTx(tx, () => resolve(out), reject);
  });
}

export async function getProject(id: string): Promise<ProjectV2 | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, "readonly");
    const req = tx.objectStore(STORE_PROJECTS).get(id);
    settleTx(tx, () => resolve(req.result as ProjectV2 | undefined), reject);
  });
}

/**
 * 새 프로젝트 생성. id 와 code 는 자동 발급. code 가 우연히 기존
 * 값과 충돌하면 ConstraintError 가 나는데 그 경우만 다시 시도한다.
 */
export async function createProject(
  input: ProjectV2CreateInput,
): Promise<ProjectV2> {
  const db = await openDb();
  const now = Date.now();

  for (let attempt = 0; attempt < 5; attempt++) {
    const project: ProjectV2 = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      code: generateCode(),
      note: input.note?.trim() || undefined,
      createdAt: now,
      lastModifiedAt: now,
    };

    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PROJECTS, "readwrite");
        tx.objectStore(STORE_PROJECTS).add(project);
        settleTx(tx, () => resolve(), reject);
      });
      return project;
    } catch (err) {
      const e = err as DOMException | Error | null;
      if (e && (e as DOMException).name === "ConstraintError") {
        continue; // code 충돌 — 다시 발급
      }
      throw err;
    }
  }

  throw new Error("project code collision (giving up after 5 attempts)");
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<ProjectV2, "id" | "createdAt">>,
): Promise<ProjectV2> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    const store = tx.objectStore(STORE_PROJECTS);
    const getReq = store.get(id);
    let next: ProjectV2 | null = null;

    getReq.onsuccess = () => {
      const existing = getReq.result as ProjectV2 | undefined;
      if (!existing) {
        tx.abort();
        reject(new Error(`project not found: ${id}`));
        return;
      }
      next = { ...existing, ...patch, lastModifiedAt: Date.now() };
      store.put(next);
    };

    settleTx(tx, () => resolve(next as ProjectV2), reject);
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    tx.objectStore(STORE_PROJECTS).delete(id);
    settleTx(tx, () => resolve(), reject);
  });
}

/**
 * import 용 — 완성된 ProjectV2 객체를 그대로 put.
 * createProject 는 id / code / timestamp 자동 생성이라 archive 복원
 * 시 옛 id 보존이 안 되므로 별도 함수.
 */
export async function putProject(project: ProjectV2): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    tx.objectStore(STORE_PROJECTS).put(project);
    settleTx(tx, () => resolve(), reject);
  });
}
