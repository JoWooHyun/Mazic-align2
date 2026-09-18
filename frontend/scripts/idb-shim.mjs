// 헤드리스 검증용 **최소 IndexedDB 셰임**. 프로덕션 코드가 아니다.
//   `supports.repo.ts` 가 실제로 쓰는 API 만 구현한다:
//     indexedDB.open / onupgradeneeded / createObjectStore(keyPath) /
//     createIndex / transaction / objectStore / index / openCursor(IDBKeyRange.only)
//     / cursor.continue / cursor.delete / store.put / get / delete /
//     tx.oncomplete / tx.onerror / tx.abort
//   ⚠️ 새 의존성을 넣지 않기 위한 선택이다(CLAUDE.md 규칙 — 계획 밖 의존성 금지).
//     동작 모델: 각 요청의 성공 콜백을 큐에 넣고 microtask 로 순차 배출한 뒤
//     더 배출할 것이 없으면 oncomplete 를 쏜다. 실제 IDB 의 "요청이 끝나고 더
//     이상 요청이 없으면 tx 가 커밋된다" 규칙을 그대로 흉내낸다.

class FakeKeyRange {
  constructor(value) {
    this.only = value;
  }
  includes(v) {
    return v === this.only;
  }
}

export const IDBKeyRange = {
  only(v) {
    return new FakeKeyRange(v);
  },
};

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.onsuccess = null;
    this.onerror = null;
  }
}

class FakeCursor {
  constructor(store, keys, i, req) {
    this._store = store;
    this._keys = keys;
    this._i = i;
    this._req = req;
    this.value = store._data.get(keys[i]);
  }
  continue() {
    this._store._tx._enqueue(() => {
      const next = this._i + 1;
      if (next >= this._keys.length) {
        this._req.result = null;
        this._req.onsuccess?.({ target: this._req });
        return;
      }
      this._req.result = new FakeCursor(this._store, this._keys, next, this._req);
      this._req.onsuccess?.({ target: this._req });
    });
  }
  delete() {
    this._store._data.delete(this._keys[this._i]);
  }
}

class FakeIndex {
  constructor(store, keyPath) {
    this._store = store;
    this._keyPath = keyPath;
  }
  openCursor(range) {
    const req = new FakeRequest();
    const keys = [];
    for (const [k, v] of this._store._data) {
      if (range == null || range.includes(v?.[this._keyPath])) keys.push(k);
    }
    this._store._tx._enqueue(() => {
      if (keys.length === 0) {
        req.result = null;
        req.onsuccess?.({ target: req });
        return;
      }
      req.result = new FakeCursor(this._store, keys, 0, req);
      req.onsuccess?.({ target: req });
    });
    return req;
  }
}

class FakeObjectStore {
  constructor(name, keyPath, tx, data, indexes) {
    this.name = name;
    this._keyPath = keyPath;
    this._tx = tx;
    this._data = data;
    this._indexes = indexes;
    this.indexNames = {
      contains: (n) => indexes.has(n),
    };
  }
  createIndex(name, keyPath) {
    this._indexes.set(name, keyPath);
  }
  index(name) {
    const keyPath = this._indexes.get(name);
    if (keyPath == null) throw new Error(`no index: ${name}`);
    return new FakeIndex(this, keyPath);
  }
  put(value) {
    const req = new FakeRequest();
    this._data.set(value[this._keyPath], value);
    this._tx._enqueue(() => {
      req.result = value[this._keyPath];
      req.onsuccess?.({ target: req });
    });
    return req;
  }
  get(key) {
    const req = new FakeRequest();
    const v = this._data.get(key);
    this._tx._enqueue(() => {
      req.result = v;
      req.onsuccess?.({ target: req });
    });
    return req;
  }
  delete(key) {
    const req = new FakeRequest();
    this._data.delete(key);
    this._tx._enqueue(() => {
      req.result = undefined;
      req.onsuccess?.({ target: req });
    });
    return req;
  }
}

class FakeTransaction {
  constructor(db, storeNames) {
    this._db = db;
    this._names = Array.isArray(storeNames) ? storeNames : [storeNames];
    this._queue = [];
    this._draining = false;
    this._done = false;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    // 다음 microtask 부터 배출 시작 — 호출 측이 콜백을 붙일 틈을 준다.
    queueMicrotask(() => this._drain());
  }
  objectStore(name) {
    const s = this._db._stores.get(name);
    if (!s) throw new Error(`no store: ${name}`);
    return new FakeObjectStore(name, s.keyPath, this, s.data, s.indexes);
  }
  abort() {
    this._done = true;
    this.error = new Error("aborted");
    queueMicrotask(() => this.onerror?.({ target: this }));
  }
  _enqueue(fn) {
    this._queue.push(fn);
    if (!this._draining) queueMicrotask(() => this._drain());
  }
  _drain() {
    if (this._done || this._draining) return;
    this._draining = true;
    while (this._queue.length > 0) {
      const fn = this._queue.shift();
      try {
        fn();
      } catch (e) {
        this._draining = false;
        this._done = true;
        this.error = e;
        this.onerror?.({ target: this });
        return;
      }
    }
    this._draining = false;
    // 더 배출할 것이 없으면 커밋.
    queueMicrotask(() => {
      if (this._done || this._queue.length > 0) return;
      this._done = true;
      this.oncomplete?.({ target: this });
    });
  }
}

class FakeDatabase {
  constructor() {
    this._stores = new Map();
  }
  createObjectStore(name, opts) {
    const entry = { keyPath: opts.keyPath, data: new Map(), indexes: new Map() };
    this._stores.set(name, entry);
    const tx = new FakeTransaction(this, name);
    return new FakeObjectStore(name, entry.keyPath, tx, entry.data, entry.indexes);
  }
  transaction(names) {
    return new FakeTransaction(this, names);
  }
}

class FakeOpenRequest extends FakeRequest {
  constructor() {
    super();
    this.onupgradeneeded = null;
    this.transaction = null;
  }
}

/** 전역 indexedDB/IDBKeyRange 를 설치한다. 같은 프로세스 내 DB 하나만 둔다. */
export function installFakeIndexedDb() {
  const dbs = new Map();
  globalThis.IDBKeyRange = IDBKeyRange;
  globalThis.indexedDB = {
    open(name, version) {
      const req = new FakeOpenRequest();
      let entry = dbs.get(name);
      const oldVersion = entry ? entry.version : 0;
      if (!entry) {
        entry = { db: new FakeDatabase(), version: 0 };
        dbs.set(name, entry);
      }
      req.result = entry.db;
      queueMicrotask(() => {
        if (version > oldVersion) {
          entry.version = version;
          const upgradeTx = new FakeTransaction(entry.db, []);
          upgradeTx.objectStore = (n) => {
            const s = entry.db._stores.get(n);
            if (!s) throw new Error(`no store: ${n}`);
            return new FakeObjectStore(n, s.keyPath, upgradeTx, s.data, s.indexes);
          };
          req.transaction = upgradeTx;
          req.onupgradeneeded?.({ target: req, oldVersion });
          req.transaction = null;
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
    /** 테스트 사이 초기화 — 같은 프로세스에서 DB 를 새로 열기 위해. */
    _reset() {
      dbs.clear();
    },
  };
}
