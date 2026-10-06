import { openDb, settleTx, STORE_SUPPORTS } from "./db";
import type { SupportPointV2 } from "../support/types";

/**
 * 폐기된 dental disc 서포트 레코드 판별 (하위 호환).
 *   disc 서포트는 제거됐지만 기존 IndexedDB 에는 variant==="disc" 레코드가
 *   남아있을 수 있다. 로드 시 조용히 걸러 앱이 죽지 않게 한다 (마이그레이션
 *   불필요 — 무시만). variant 필드는 타입에서 제거됐으므로 raw 값으로 확인.
 */
function isDiscRecord(value: unknown): boolean {
  return (value as { variant?: string } | null)?.variant === "disc";
}

/** 프로젝트의 모든 서포트 점. */
export async function listSupportsByProject(
  projectId: string,
): Promise<SupportPointV2[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readonly");
    const idx = tx.objectStore(STORE_SUPPORTS).index("by_project");
    const out: SupportPointV2[] = [];
    idx.openCursor(IDBKeyRange.only(projectId)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        if (!isDiscRecord(cursor.value)) out.push(cursor.value as SupportPointV2);
        cursor.continue();
      }
    };
    settleTx(tx, () => resolve(out), reject);
  });
}

/** 단일 STL 의 서포트 점만. */
export async function listSupportsByStl(
  stlId: string,
): Promise<SupportPointV2[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readonly");
    const idx = tx.objectStore(STORE_SUPPORTS).index("by_stl");
    const out: SupportPointV2[] = [];
    idx.openCursor(IDBKeyRange.only(stlId)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        if (!isDiscRecord(cursor.value)) out.push(cursor.value as SupportPointV2);
        cursor.continue();
      }
    };
    settleTx(tx, () => resolve(out), reject);
  });
}

/**
 * 여러 점을 한 transaction 으로 일괄 추가 (자동 생성 시 유리).
 *   store.add 가 아니라 **put(upsert)** 을 쓴다 (B-1). id 는 앱이 생성하는
 *   고유값이라 같은 레코드를 다시 넣는 것 외에 키 충돌이 날 일이 없는데,
 *   add 는 그런 경우 ConstraintError 로 transaction 전체를 abort 시켜
 *   "삭제 → undo 복원" 같은 경로에서 무관한 점들까지 통째로 날린다.
 *   put 은 그 상황을 무해한 덮어쓰기로 만든다. (근본 순서 보장은 호출 측
 *   await 책임 — 여기는 보조 방어선이다.)
 */
export async function addSupports(
  points: SupportPointV2[],
): Promise<void> {
  if (points.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    const store = tx.objectStore(STORE_SUPPORTS);
    for (const p of points) {
      store.put(p);
    }
    settleTx(tx, () => resolve(), reject);
  });
}

export async function updateSupport(
  id: string,
  patch: Partial<
    Omit<SupportPointV2, "id" | "projectId" | "addedAt">
  >,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    const store = tx.objectStore(STORE_SUPPORTS);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const existing = getReq.result as SupportPointV2 | undefined;
      if (!existing) {
        tx.abort();
        reject(new Error(`support not found: ${id}`));
        return;
      }
      store.put({ ...existing, ...patch });
    };
    settleTx(tx, () => resolve(), reject);
  });
}

export async function deleteSupport(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    tx.objectStore(STORE_SUPPORTS).delete(id);
    settleTx(tx, () => resolve(), reject);
  });
}

/**
 * 여러 id 를 한 transaction 으로 일괄 삭제 (B-1 무효화 / 대량 삭제용).
 *   점마다 deleteSupport 를 반복하면 tx 가 N 개로 쪼개져 그 사이에 다른
 *   쓰기가 끼어들 수 있고, 호출 측에서 refresh 까지 N 회 돌게 된다.
 *   여기서 tx 를 하나로 묶어 원자성과 성능을 동시에 확보한다.
 */
export async function deleteSupportsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    const store = tx.objectStore(STORE_SUPPORTS);
    for (const id of ids) {
      store.delete(id);
    }
    settleTx(tx, () => resolve(), reject);
  });
}

/**
 * 프로젝트 서포트 **교체** — 지울 점 고르기·삭제·추가를 **한 transaction** 으로
 * 처리한다 (자동 서포트 재실행 = 교체, 정리_20261001 신규 8 / D5).
 *
 *   교체는 "기존 세트 삭제 + 새 세트 추가" 인데, 둘을 따로 부르면 그 사이에서
 *   실패했을 때 반쯤 바뀐 상태(옛 세트만 지워짐 등)가 남는다. IndexedDB 는 같은
 *   transaction 안의 요청 하나라도 실패하면 전체를 abort 하므로, 여기서 한 tx 로
 *   묶으면 "전부 바뀜 / 전혀 안 바뀜" 둘 중 하나만 남는다.
 *
 *   지울 점은 **tx 안에서 읽은 최신 목록**으로 고른다(`pickRemoveIds` — 동기 함수).
 *   호출 측 React state 로 고르면 그 사이 다른 생성 경로가 저장한 점을 못 보고
 *   두 세트가 겹칠 수 있다. 고르는 함수가 throw 하면 tx 를 abort 하고 reject 한다.
 *
 *   undo/redo 도 이 함수로 되돌린다(고르는 함수 = 고정 id 목록) — 같은 원자성.
 *
 * @returns 실제로 지운 레코드 — DB 에 있던 그대로(undo 복원용 스냅샷).
 */
export async function replaceSupportsInProject(
  projectId: string,
  pickRemoveIds: (existing: SupportPointV2[]) => readonly string[],
  add: readonly SupportPointV2[],
): Promise<SupportPointV2[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    const store = tx.objectStore(STORE_SUPPORTS);
    const existing: SupportPointV2[] = [];
    let removed: SupportPointV2[] = [];
    let pickError: unknown = null;
    const idx = store.index("by_project");
    idx.openCursor(IDBKeyRange.only(projectId)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        if (!isDiscRecord(cursor.value)) {
          existing.push(cursor.value as SupportPointV2);
        }
        cursor.continue();
        return;
      }
      // 목록 끝 — 같은 tx 안에서 삭제·추가 (사이에 다른 쓰기가 끼어들 틈 없음).
      try {
        const ids = new Set(pickRemoveIds(existing));
        removed = existing.filter((s) => ids.has(s.id));
        for (const s of removed) store.delete(s.id);
        for (const p of add) store.put(p);
      } catch (err) {
        pickError = err;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(pickError ?? tx.error ?? new Error("transaction aborted"));
  });
}

/** 한 프로젝트의 모든 서포트 삭제. */
export async function deleteSupportsByProject(projectId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    const idx = tx.objectStore(STORE_SUPPORTS).index("by_project");
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

/**
 * 단일 STL 의 서포트를 모두 삭제 (모델 삭제 cascade).
 * Bridge 의 경우 contact 쪽 (stlId) 또는 base 쪽 (baseStlId) 어느
 * 한쪽이 일치하면 같이 삭제 — 한 끝이 사라진 기둥이 공중에 떠있지
 * 않게 한다.
 */
export async function deleteSupportsByStl(stlId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    const store = tx.objectStore(STORE_SUPPORTS);
    const idxStl = store.index("by_stl");
    const idxBase = store.index("by_base_stl");

    // 두 인덱스 양쪽에서 매치되는 모든 record id 를 수집한 뒤 한 번에 delete.
    const ids = new Set<string>();

    idxStl.openCursor(IDBKeyRange.only(stlId)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        ids.add((cursor.value as { id: string }).id);
        cursor.continue();
      } else {
        // by_stl 끝나면 by_base_stl 스캔.
        idxBase.openCursor(IDBKeyRange.only(stlId)).onsuccess = (e2) => {
          const c2 = (e2.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (c2) {
            ids.add((c2.value as { id: string }).id);
            c2.continue();
          } else {
            for (const id of ids) store.delete(id);
          }
        };
      }
    };

    settleTx(tx, () => resolve(), reject);
  });
}
