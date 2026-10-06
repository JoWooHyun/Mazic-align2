import { openDb, settleTx, STORE_STL_FILES } from "./db";
import type { STLFileV2 } from "../types/stl";

/** 프로젝트의 STL 파일을 추가된 순서대로 반환. */
export async function listStlFilesByProject(
  projectId: string,
): Promise<STLFileV2[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STL_FILES, "readonly");
    const idx = tx.objectStore(STORE_STL_FILES).index("by_project");
    const out: STLFileV2[] = [];
    idx.openCursor(IDBKeyRange.only(projectId)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        out.push(cursor.value as STLFileV2);
        cursor.continue();
      }
    };
    settleTx(
      tx,
      () => resolve(out.sort((a, b) => a.addedAt - b.addedAt)),
      reject,
    );
  });
}

export async function getStlFile(id: string): Promise<STLFileV2 | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STL_FILES, "readonly");
    const req = tx.objectStore(STORE_STL_FILES).get(id);
    settleTx(tx, () => resolve(req.result as STLFileV2 | undefined), reject);
  });
}

export async function createStlFile(
  projectId: string,
  fileName: string,
  blob: Blob,
): Promise<STLFileV2> {
  const stlFile: STLFileV2 = {
    id: crypto.randomUUID(),
    projectId,
    fileName,
    blob,
    fileSize: blob.size,
    addedAt: Date.now(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_STL_FILES, "readwrite");
    tx.objectStore(STORE_STL_FILES).add(stlFile);
    settleTx(tx, () => resolve(), reject);
  });
  return stlFile;
}

export async function updateStlFile(
  id: string,
  patch: Partial<Omit<STLFileV2, "id" | "projectId" | "blob" | "addedAt">>,
): Promise<STLFileV2> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STL_FILES, "readwrite");
    const store = tx.objectStore(STORE_STL_FILES);
    const getReq = store.get(id);
    let next: STLFileV2 | null = null;
    getReq.onsuccess = () => {
      const existing = getReq.result as STLFileV2 | undefined;
      if (!existing) {
        tx.abort();
        reject(new Error(`STL not found: ${id}`));
        return;
      }
      next = { ...existing, ...patch };
      store.put(next);
    };
    settleTx(tx, () => resolve(next as STLFileV2), reject);
  });
}

/**
 * import 용 — 완성된 STLFileV2 객체 그대로 put. id / addedAt / transform
 * 보존.
 */
export async function putStlFile(file: STLFileV2): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STL_FILES, "readwrite");
    tx.objectStore(STORE_STL_FILES).put(file);
    settleTx(tx, () => resolve(), reject);
  });
}

export async function deleteStlFile(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STL_FILES, "readwrite");
    tx.objectStore(STORE_STL_FILES).delete(id);
    settleTx(tx, () => resolve(), reject);
  });
}

/** 프로젝트 삭제 시 cascade. */
export async function deleteStlFilesByProject(
  projectId: string,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STL_FILES, "readwrite");
    const idx = tx.objectStore(STORE_STL_FILES).index("by_project");
    idx.openCursor(IDBKeyRange.only(projectId)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    settleTx(tx, () => resolve(), reject);
  });
}
