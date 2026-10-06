/**
 * v2 IndexedDB 진입점.
 *
 * 단일 DB 'resinforge' 안에 v2 모든 데이터를 격리해서 보관한다.
 * 옛 백엔드 API 는 사용하지 않는다. 라이브러리 의존성 없이 raw
 * IndexedDB API 위에 얇은 Promise 래퍼만 둔다.
 */

export const DB_NAME = "resinforge";
export const DB_VERSION = 4;

export const STORE_PROJECTS = "projects";
export const STORE_STL_FILES = "stl_files";
export const STORE_SUPPORTS = "supports";

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * DB 핸들을 한 번만 연다. 후속 호출은 같은 Promise 를 재사용.
 *
 * onupgradeneeded 에서 스키마를 만들고 oldVersion 별로 마이그레이션.
 */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      // v0 → v1: projects 스토어
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
        store.createIndex("by_lastModifiedAt", "lastModifiedAt");
        store.createIndex("by_code", "code", { unique: true });
      }

      // v1 → v2: stl_files 스토어
      if (oldVersion < 2) {
        const stlStore = db.createObjectStore(STORE_STL_FILES, {
          keyPath: "id",
        });
        stlStore.createIndex("by_project", "projectId");
        stlStore.createIndex("by_addedAt", "addedAt");
      }

      // v2 → v3: supports 스토어
      if (oldVersion < 3) {
        const supportStore = db.createObjectStore(STORE_SUPPORTS, {
          keyPath: "id",
        });
        supportStore.createIndex("by_project", "projectId");
        supportStore.createIndex("by_stl", "stlId");
      }

      // v3 → v4: bridge cascade 용 by_base_stl 인덱스.
      // 기존 store 에 인덱스 추가는 upgrade transaction 으로.
      if (oldVersion < 4) {
        const tx = req.transaction;
        if (tx) {
          const supportStore = tx.objectStore(STORE_SUPPORTS);
          if (!supportStore.indexNames.contains("by_base_stl")) {
            supportStore.createIndex("by_base_stl", "baseStlId");
          }
        }
      }
    };

    // 열기 실패는 캐시하지 않는다 — 한 번 실패한 Promise 를 붙들면 세션 내내 모든
    //   저장·읽기가 같은 에러로 끝난다(C2). 다음 호출이 다시 연다.
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    // 다른 탭이 옛 버전 연결을 쥐고 있으면 업그레이드가 그 탭이 닫힐 때까지 멈춘다.
    //   명세상 나중에 success 가 올 수 있어 reject 하지 않고 원인만 남긴다.
    req.onblocked = () => {
      console.warn(
        "[db] 다른 탭이 이 앱을 열고 있어 저장소 업그레이드가 대기 중입니다 — 다른 탭을 닫아 주세요.",
      );
    };
    req.onsuccess = () => {
      const db = req.result;
      // 새 버전 탭이 업그레이드를 요청하면 이 연결을 닫아 그 탭을 막지 않는다.
      //   브라우저가 연결을 강제로 닫은 경우(저장소 삭제 등)와 함께, 다음 호출이
      //   닫힌 핸들 대신 새로 열도록 캐시를 비운다.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
  });

  return dbPromise;
}

/** 저장공간 부족 안내를 다시 띄우기까지의 최소 간격 — 같은 원인이 연달아 와도 한 번만. */
const QUOTA_NOTICE_INTERVAL_MS = 10_000;
let lastQuotaNoticeAt = Number.NEGATIVE_INFINITY;

/**
 * 트랜잭션 실패를 콘솔에 남기고, 저장공간 부족이면 사용자에게 알린다 (C2).
 *
 * 저장 호출 지점이 수십 곳이고 그중 다수가 실패를 처리하지 않는다(`void save()` 등).
 * 지점마다 알림을 달면 범위가 커지므로, **원인이 저장공간 부족일 때만** 여기서 한 번
 * 알린다 — 그 외 실패는 reject 로 호출 측에 넘기고 콘솔에만 남긴다.
 * 명시적 tx.abort()(AbortError — 호출 측이 이미 자기 에러로 reject 함)는 조용히 둔다.
 */
function reportTxFailure(tx: IDBTransaction, err: unknown): void {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "AbortError") return;
  console.error(
    `[db] IndexedDB 트랜잭션 실패 (${Array.from(tx.objectStoreNames).join(",")} · ${tx.mode}): ${name}`,
    err,
  );
  if (name !== "QuotaExceededError") return;
  const now = Date.now();
  if (now - lastQuotaNoticeAt < QUOTA_NOTICE_INTERVAL_MS) return;
  lastQuotaNoticeAt = now;
  if (typeof window === "undefined" || typeof window.alert !== "function") return;
  window.alert(
    "저장공간이 부족해 변경 내용을 저장하지 못했습니다.\n" +
      "쓰지 않는 프로젝트를 삭제하거나 브라우저 저장공간을 확보한 뒤 다시 시도하세요.",
  );
}

/**
 * 트랜잭션의 세 가지 끝 — 완료(complete)·에러(error)·중단(abort) — 을 **전부**
 * Promise 에 연결한다 (데모 사고 방지 2차 C2). 모든 repo 트랜잭션은 이 함수를
 * 거친다 — `scripts/verify-safety2.mjs` 가 소스로 강제한다.
 *
 * 왜 onabort 가 꼭 필요한가: 저장공간 초과(QuotaExceededError)는 요청 단위 에러가
 * 아니라 **커밋 시점의 중단**으로 온다 — 그때는 error 이벤트 없이 abort 이벤트만
 * 발생한다. 종전처럼 oncomplete/onerror 만 걸면 Promise 가 영원히 끝나지 않았다.
 *
 * 원인 보존: 요청 에러는 error 이벤트 target(요청)의 error 를, 커밋 중단은 tx.error
 * 를 그대로 reject 한다(QuotaExceededError·ConstraintError 등 name 유지). error 이벤트
 * 시점에는 tx.error 가 아직 null 이다(명세 — 중단은 이벤트 전파가 끝난 뒤). 명시적
 * tx.abort() 는 tx.error 가 null 이라 AbortError 로 reject 한다.
 *
 * @param onComplete 커밋 완료 시 호출 — 보통 `() => resolve(결과)`
 * @param reject 실패 시 한 번만 호출된다 (error 뒤에 abort 가 따라와도 중복 없음)
 */
export function settleTx(
  tx: IDBTransaction,
  onComplete: () => void,
  reject: (reason: unknown) => void,
): void {
  let failed = false;
  const fail = (err: unknown): void => {
    if (failed) return;
    failed = true;
    reject(err);
    reportTxFailure(tx, err);
  };
  const abortError = (): DOMException =>
    new DOMException("IndexedDB transaction aborted", "AbortError");
  tx.oncomplete = () => onComplete();
  // 원인 우선순위: tx.error → 요청 error. 요청 에러로 오는 error 이벤트 시점엔 tx.error 가 아직 null 이라
  //   요청 error(ConstraintError 등)가 쓰이고, 트랜잭션이 대기 요청을 남긴 채 중단되면(쿼터·강제 종료) 대기 요청의
  //   AbortError 보다 tx.error(진짜 원인)가 먼저다.
  tx.onerror = (event) =>
    fail(
      tx.error ??
        (event.target as { error?: DOMException | null } | null)?.error ??
        abortError(),
    );
  tx.onabort = () => fail(tx.error ?? abortError());
}

/**
 * 단일 스토어에 대한 readonly / readwrite 트랜잭션을 Promise 로
 * 감싼다. fn 이 반환한 IDBRequest 의 결과를 await 결과로 돌려준다.
 */
export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    let result: T | undefined;
    let resolved = false;

    Promise.resolve(fn(store)).then(
      (req) => {
        if (req instanceof IDBRequest) {
          req.onsuccess = () => {
            result = req.result;
          };
          req.onerror = () => reject(req.error);
        } else {
          result = req as T;
          resolved = true;
        }
      },
      (err) => reject(err),
    );

    settleTx(tx, () => resolve(result as T), reject);

    void resolved;
  });
}

/**
 * 테스트·디버그용.
 */
export async function _wipeAll(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [STORE_PROJECTS, STORE_STL_FILES, STORE_SUPPORTS],
      "readwrite",
    );
    tx.objectStore(STORE_PROJECTS).clear();
    tx.objectStore(STORE_STL_FILES).clear();
    tx.objectStore(STORE_SUPPORTS).clear();
    settleTx(tx, () => resolve(), reject);
  });
}
