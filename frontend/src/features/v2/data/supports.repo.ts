import { openDb, STORE_SUPPORTS } from "./db";
import type { PillarBraceRecord, SupportPointV2 } from "../support/types";

/**
 * 폐기된 dental disc 서포트 레코드 판별 (하위 호환).
 *   disc 서포트는 제거됐지만 기존 IndexedDB 에는 variant==="disc" 레코드가
 *   남아있을 수 있다. 로드 시 조용히 걸러 앱이 죽지 않게 한다 (마이그레이션
 *   불필요 — 무시만). variant 필드는 타입에서 제거됐으므로 raw 값으로 확인.
 */
function isDiscRecord(value: unknown): boolean {
  return (value as { variant?: string } | null)?.variant === "disc";
}

/**
 * 기둥 연결 브레이스 레코드 판별 (S-4b-2d 2단계).
 *   위 `isDiscRecord` 와 **같은 패턴** — 하나의 스토어에 이종 레코드를 공존시키고
 *   판별 필드로 조회를 가른다. 이렇게 두면 `by_project`/`by_stl` 인덱스를 그대로
 *   재사용해 **cascade 삭제가 자동**이고 DB_VERSION 을 올릴 필요가 없다.
 *
 *   ⚠️ `listSupportsByProject`/`listSupportsByStl` 의 반환 타입은 `SupportPointV2[]`
 *   이므로 브레이스가 섞여 나가면 **화면·조립·export 전부가 이상한 점 하나를
 *   기둥으로 세우려 든다**. 반드시 여기서 걸러낸다(타입 오염 방지).
 */
function isBraceRecord(value: unknown): boolean {
  return (
    (value as { recordKind?: string } | null)?.recordKind === "pillarBrace"
  );
}

/** 서포트 점 조회에서 제외해야 하는 이종 레코드인가. */
function isForeignRecord(value: unknown): boolean {
  return isDiscRecord(value) || isBraceRecord(value);
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
        if (!isForeignRecord(cursor.value)) out.push(cursor.value as SupportPointV2);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
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
        if (!isForeignRecord(cursor.value)) out.push(cursor.value as SupportPointV2);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSupport(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    tx.objectStore(STORE_SUPPORTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
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

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 기둥 연결 브레이스 (S-4b-2d 2단계)
//   같은 스토어(STORE_SUPPORTS)에 공존하되 `recordKind:'pillarBrace'` 로 갈린다.
//   ★ 삭제 계열은 **일부러 추가하지 않았다** — `deleteSupportsByProject` /
//     `deleteSupportsByStl` 이 인덱스 커서로 스토어 전체를 훑으므로 브레이스도
//     같이 지워진다(cascade 공짜). 여기 있는 삭제 함수는 "기둥 하나를 지울 때
//     그 기둥의 다리만" 지우는 경우뿐이다.
// ─────────────────────────────────────────────────────────────────────────────

/** 프로젝트의 브레이스 레코드만. 서포트 점 조회와 반환 타입이 다르다(타입 오염 방지). */
export async function listPillarBracesByProject(
  projectId: string,
): Promise<PillarBraceRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readonly");
    const idx = tx.objectStore(STORE_SUPPORTS).index("by_project");
    const out: PillarBraceRecord[] = [];
    idx.openCursor(IDBKeyRange.only(projectId)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        if (isBraceRecord(cursor.value)) out.push(cursor.value as PillarBraceRecord);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 브레이스 일괄 추가. `addSupports` 와 같은 이유로 add 가 아니라 **put(upsert)**.
 *   (add 는 키 충돌 시 transaction 전체를 abort 시켜 무관한 레코드까지 날린다 — B-1.)
 */
export async function addPillarBraces(
  braces: PillarBraceRecord[],
): Promise<void> {
  if (braces.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    const store = tx.objectStore(STORE_SUPPORTS);
    for (const b of braces) {
      store.put(b);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * **기둥 삭제 cascade** — 주어진 점 id 중 하나라도 끝에 걸린 브레이스를 지운다.
 *   리드 확정: "다리 개별 삭제는 불필요, 기둥을 지우면 다리도 사라지면 된다."
 *   양 끝(`fromPointId`/`toPointId`) 어느 쪽이든 매치하면 지운다 — 한 끝이 사라진
 *   다리가 허공에 남지 않게 (`deleteSupportsByStl` 의 by_base_stl 취지와 동일).
 *
 * @returns 삭제된 브레이스 레코드 (undo 복원용).
 */
export async function deletePillarBracesByPointIds(
  projectId: string,
  pointIds: readonly string[],
): Promise<PillarBraceRecord[]> {
  if (pointIds.length === 0) return [];
  const targets = new Set(pointIds);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SUPPORTS, "readwrite");
    const idx = tx.objectStore(STORE_SUPPORTS).index("by_project");
    const removed: PillarBraceRecord[] = [];
    idx.openCursor(IDBKeyRange.only(projectId)).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        const v = cursor.value as PillarBraceRecord;
        if (
          isBraceRecord(v) &&
          (targets.has(v.fromPointId) || targets.has(v.toPointId))
        ) {
          removed.push(v);
          cursor.delete();
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error);
  });
}
