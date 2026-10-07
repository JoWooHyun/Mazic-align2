// 데모 사고 방지 2차 헤드리스 검증 — C2(IndexedDB 트랜잭션 onabort) · C3(manifold WASM 해제)
//   · C7(메시별 머티리얼 해제 · 다중 솔리드 STL 잔여).
//
//   실행: npx tsx scripts/verify-safety2.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "변조 → 실패 재현" 문자열을 낸다.
//
//   [C2] 저장공간 초과(QuotaExceededError)는 요청 에러가 아니라 **커밋 시점 중단**으로 와서
//     error 이벤트 없이 abort 만 발생한다. 종전 repo 트랜잭션 21개는 oncomplete/onerror 만
//     걸어 Promise 가 영원히 끝나지 않았다. 이 스크립트는 명세대로 동작하는 **가짜
//     IndexedDB**(아래 makeFactory — 의존성 추가 없이 스크립트 안에 둠)를 깔고 실제 repo
//     모듈을 그대로 불러,
//       (a) 정상 경로는 종전과 같은 값으로 resolve,
//       (b) 커밋 중단을 주입하면 **모든** repo 함수가 2 s 안에 reject(원인 name 보존),
//       (c) 요청 단위 에러를 주입해도 원인 name 보존(error 이벤트 시점엔 tx.error 가 null),
//       (d) 저장공간 부족 안내가 연달아 와도 한 번만,
//       (e) 소스 검사 — data/ 의 모든 트랜잭션이 db.ts settleTx 를 거친다(헬퍼 밖 새
//           트랜잭션 코드는 FAIL), 스키마(DB_VERSION·스토어·인덱스) 불변.
//   [C3·C7] Babylon NullEngine + 실제 manifold-3d(wasm)로 STL 로드 → STL manifold → 브릿지
//     절삭 → 모델 삭제 → 씬 정리(disposeScene)를 실제 모듈로 돌리고, manifold 객체를
//     계수 래퍼로 세어 해제 후 살아 있는 객체 0, 삭제된 메시의 전용 머티리얼 해제, 공유
//     서포트 머티리얼은 씬 정리 전까지 생존, 다중 솔리드 STL 잔여 메시 0 을 단언한다.
//     훅(useFileMeshSync·useSupportMeshSync) 본체는 React 없이 돌릴 수 없어, 그 배선
//     (어느 헬퍼를 어떤 순서로 부르는가)은 소스 검사로 본다(verify-support-follow 관례).
//
//   ★ 대조군 원칙(프로젝트 규약): 실제 소스를 임시 폴더로 복사해 한 곳을 변조한 판을
//     같은 검사에 넣어 **실제로 실패하는지** 확인한다 — onabort 제거, 헬퍼 우회(종전 코드),
//     원인 소실, manifold delete 생략(씬 정리·개별), 수정 전 dispose-scene, 공유 머티리얼까지
//     해제, STL 머티리얼 미해제(종전), 다중 솔리드 잔여(종전). 변조 대상 문자열이 소스에
//     없으면 그 자체를 FAIL 로 센다(변조 안 된 채 통과하는 공허한 PASS 방지).

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const V2 = join(__dirname, "..", "src", "features", "v2");
const HANG_MS = 2000;

// ── assert 유틸 ──────────────────────────────────────────────────────────
let failed = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}
/** 묶음 결과 [{ok,label}] 를 그대로 단언으로 출력. */
function assertAll(results) {
  for (const r of results) assert(r.ok, r.label);
}
/** 대조군: 변조판이 **하나 이상** 실패해야 통과. */
function assertControl(results, label) {
  const bad = results.filter((r) => !r.ok);
  if (bad.length > 0) {
    console.log(`  ok  [대조군] ${label} → 실패 재현: ${bad[0].label}`);
  } else {
    failed++;
    console.error(`  FAIL [대조군] ${label} — 변조판이 모든 검사를 통과함(검사가 결함을 못 잡음)`);
  }
}

/** Promise 가 ms 안에 끝나는지 — "hang" 은 영원히 대기의 대리 판정. */
function settleWithin(promise, ms = HANG_MS) {
  return new Promise((res) => {
    const t = setTimeout(() => res({ state: "hang" }), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(t);
        res({ state: "resolved", value });
      },
      (error) => {
        clearTimeout(t);
        res({ state: "rejected", error });
      },
    );
  });
}

// ── 변조판(대조군) 생성 ──────────────────────────────────────────────────
//   V2 하위 파일을 상대 경로 구조 그대로 임시 폴더에 복사하고, 한 파일에 텍스트 변조를
//   가한다. bare import(@babylonjs/*)는 이 스크립트 기준으로 푼 URL 로 바꿔 같은 모듈
//   인스턴스(instanceof·씬 등록 공유)를 쓰게 한다. `import type` 은 tsx 가 지운다.
const TMP_ROOT = mkdtempSync(join(tmpdir(), "verify-safety2-"));
// 예외로 끝나도 임시 폴더를 남기지 않는다(exit 이벤트는 미처리 예외 종료에서도 온다)
process.on("exit", () => rmSync(TMP_ROOT, { recursive: true, force: true }));
const BARE = {
  "@babylonjs/core": import.meta.resolve("@babylonjs/core"),
  "@babylonjs/loaders/STL": import.meta.resolve("@babylonjs/loaders/STL"),
};
let mutantSeq = 0;
function makeMutant(files, mutations = []) {
  const dir = join(TMP_ROOT, `m${mutantSeq++}`);
  const texts = Object.fromEntries(
    files.map((rel) => [rel, readFileSync(join(V2, rel), "utf8").replace(/\r\n/g, "\n")]),
  );
  for (const { file, from, to } of mutations) {
    if (!texts[file].includes(from)) {
      throw new Error(`변조 대상 없음: ${file} — ${JSON.stringify(from.slice(0, 70))}`);
    }
    texts[file] = texts[file].replace(from, to);
  }
  for (const rel of files) {
    let src = texts[rel];
    for (const [spec, url] of Object.entries(BARE)) src = src.split(`"${spec}"`).join(`"${url}"`);
    const out = join(dir, rel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, src);
  }
  return { url: (rel) => pathToFileURL(join(dir, rel)).href, texts };
}
const src = (rel) => readFileSync(join(V2, rel), "utf8").replace(/\r\n/g, "\n");

// ═════════════════════════════════════════════════════════════════════════
// C2 — 가짜 IndexedDB (명세의 이벤트 순서만 충실히 흉내)
//   · 요청은 다음 태스크에 실행, 대기 요청이 0 이 되면 자동 커밋 → complete.
//   · 요청 에러: error 를 요청에 → 같은 이벤트가 트랜잭션 onerror 로 전파(target = 요청,
//     이 시점 tx.error 는 **null**) → preventDefault 없으면 중단(tx.error = 그 에러) → abort.
//   · 커밋 중단 주입(쿼터 초과 흉내): error 이벤트 없이 tx.error 설정 + abort 만.
//   · 명시적 tx.abort(): tx.error = null, abort 만.
//   · 쓰기는 트랜잭션 작업본에만 → 커밋 때 반영, 중단이면 버린다.
// ═════════════════════════════════════════════════════════════════════════
class FakeRequest {
  constructor(tx) {
    this.transaction = tx;
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
  }
}
globalThis.IDBRequest = FakeRequest; // db.ts withStore 의 instanceof IDBRequest
globalThis.IDBKeyRange = { only: (v) => ({ only: v }) };

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

class FakeTx {
  constructor(factory, rec, names, mode) {
    this._f = factory;
    this._rec = rec;
    this.objectStoreNames = names;
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._pending = 0;
    this._done = false;
    this._work = new Map();
    factory.active.add(this);
    this._check();
  }
  objectStore(name) {
    if (!this.objectStoreNames.includes(name)) throw new DOMException(name, "NotFoundError");
    return new FakeStore(this, name);
  }
  abort() {
    if (this._done) throw new DOMException("finished", "InvalidStateError");
    this._finishAbort(null);
  }
  _records(name) {
    if (!this._work.has(name)) this._work.set(name, new Map(this._rec.stores.get(name).records));
    return this._work.get(name);
  }
  _schema(name) {
    return this._rec.stores.get(name);
  }
  _exec(req, op, fn) {
    this._pending++;
    setTimeout(() => {
      this._pending--;
      if (this._done) return;
      let result;
      let err = null;
      const rf = this._f.inject.requestFailure;
      if (rf && rf.op === op) {
        this._f.inject.requestFailure = null;
        err = new DOMException(`${op} 실패(주입)`, rf.name);
      } else {
        try {
          result = fn();
        } catch (e) {
          err = e;
        }
      }
      if (err) {
        req.error = err;
        const ev = {
          type: "error",
          target: req,
          defaultPrevented: false,
          preventDefault() {
            this.defaultPrevented = true;
          },
        };
        req.onerror?.(ev);
        this.onerror?.(ev); // 전파 — 이 시점 this.error 는 아직 null (명세)
        if (!ev.defaultPrevented) this._finishAbort(err);
        return;
      }
      req.result = result;
      req.onsuccess?.({ type: "success", target: req });
      this._check();
    }, 0);
  }
  _check() {
    setTimeout(() => {
      if (this._done || this._pending > 0) return;
      const cf = this._f.inject.commitFailure;
      if (cf && (!cf.mode || cf.mode === this.mode)) {
        this._f.inject.commitFailure = null;
        this._finishAbort(new DOMException("커밋 실패(주입)", cf.name));
        return;
      }
      this._done = true;
      this._f.active.delete(this);
      if (this.mode !== "readonly") {
        for (const [n, recs] of this._work) this._rec.stores.get(n).records = recs;
      }
      this.oncomplete?.({ type: "complete", target: this });
    }, 0);
  }
  _finishAbort(err) {
    this._done = true;
    this._f.active.delete(this);
    this.error = err;
    setTimeout(() => this.onabort?.({ type: "abort", target: this }), 0);
  }
}

class FakeStore {
  constructor(tx, name) {
    this._tx = tx;
    this._name = name;
  }
  _req(op, fn) {
    const r = new FakeRequest(this._tx);
    this._tx._exec(r, op, fn);
    return r;
  }
  _rw() {
    if (this._tx.mode === "readonly") throw new DOMException("readonly", "ReadOnlyError");
  }
  get(key) {
    return this._req("get", () => {
      const v = this._tx._records(this._name).get(key);
      return v === undefined ? undefined : { ...v };
    });
  }
  put(value) {
    this._rw();
    return this._req("put", () => this._write(value, true));
  }
  add(value) {
    this._rw();
    return this._req("add", () => this._write(value, false));
  }
  delete(key) {
    this._rw();
    return this._req("delete", () => {
      this._tx._records(this._name).delete(key);
    });
  }
  clear() {
    this._rw();
    return this._req("clear", () => {
      this._tx._records(this._name).clear();
    });
  }
  index(name) {
    const def = this._tx._schema(this._name).indexes.get(name);
    if (!def) throw new DOMException(name, "NotFoundError");
    return new FakeIndex(this, def);
  }
  _write(value, overwrite) {
    const schema = this._tx._schema(this._name);
    const recs = this._tx._records(this._name);
    const key = value[schema.keyPath];
    if (!overwrite && recs.has(key)) throw new DOMException("key exists", "ConstraintError");
    for (const idx of schema.indexes.values()) {
      if (!idx.unique) continue;
      for (const [k, v] of recs) {
        if (k !== key && v[idx.keyPath] === value[idx.keyPath]) {
          throw new DOMException("unique index", "ConstraintError");
        }
      }
    }
    recs.set(key, { ...value });
    return key;
  }
}

class FakeIndex {
  constructor(store, def) {
    this._store = store;
    this._def = def;
  }
  openCursor(range, direction = "next") {
    const tx = this._store._tx;
    const name = this._store._name;
    const kp = this._def.keyPath;
    const req = new FakeRequest(tx);
    let list = null;
    let i = 0;
    const step = () => {
      if (list === null) {
        list = [...tx._records(name).entries()]
          .filter(([, v]) => range == null || v[kp] === range.only)
          .sort(([ka, a], [kb, b]) => cmp(a[kp], b[kp]) || cmp(ka, kb));
        if (direction === "prev") list.reverse();
      }
      if (i >= list.length) return null;
      const [pk, v] = list[i++];
      return {
        value: { ...v },
        primaryKey: pk,
        continue: () => tx._exec(req, "cursor", step),
        delete: () => {
          if (tx.mode === "readonly") throw new DOMException("readonly", "ReadOnlyError");
          const r = new FakeRequest(tx);
          tx._exec(r, "delete", () => {
            tx._records(name).delete(pk);
          });
          return r;
        },
      };
    };
    tx._exec(req, "cursor", step);
    return req;
  }
}

function makeFactory() {
  const dbs = new Map();
  const inject = { commitFailure: null, requestFailure: null, openFailure: null };
  const directStore = (s) => ({
    createIndex(n, keyPath, opts) {
      s.indexes.set(n, { keyPath, unique: !!opts?.unique });
    },
    indexNames: { contains: (n) => s.indexes.has(n) },
  });
  const factory = {
    inject,
    dbs,
    /** 아직 끝나지 않은 트랜잭션 — 주입 전에 비워 두어 주입이 엉뚱한 트랜잭션에 먹히지 않게 한다. */
    active: new Set(),
    async idle() {
      for (let i = 0; i < 1000 && this.active.size > 0; i++) await new Promise((r) => setTimeout(r, 0));
    },
    open(name, version) {
      const req = new FakeRequest(null);
      req.onupgradeneeded = null;
      req.onblocked = null;
      setTimeout(() => {
        if (inject.openFailure) {
          req.error = new DOMException("open 실패(주입)", inject.openFailure);
          inject.openFailure = null;
          req.onerror?.({ type: "error", target: req });
          return;
        }
        let rec = dbs.get(name);
        if (!rec) {
          rec = { version: 0, stores: new Map() };
          dbs.set(name, rec);
        }
        const db = {
          onversionchange: null,
          onclose: null,
          _closed: false,
          close() {
            this._closed = true;
          },
          createObjectStore(n, opts) {
            const s = { keyPath: opts.keyPath, records: new Map(), indexes: new Map() };
            rec.stores.set(n, s);
            return directStore(s);
          },
          transaction(names, mode = "readonly") {
            if (this._closed) throw new DOMException("closed", "InvalidStateError");
            const list = Array.isArray(names) ? names : [names];
            for (const n of list) if (!rec.stores.has(n)) throw new DOMException(n, "NotFoundError");
            return new FakeTx(factory, rec, list, mode);
          },
        };
        req.result = db;
        if (version > rec.version) {
          const oldVersion = rec.version;
          req.transaction = { objectStore: (n) => directStore(rec.stores.get(n)) };
          req.onupgradeneeded?.({ type: "upgradeneeded", oldVersion, newVersion: version, target: req });
          rec.version = version;
          req.transaction = null;
        }
        req.onsuccess?.({ type: "success", target: req });
      }, 0);
      return req;
    },
  };
  return factory;
}

// ── C2 동작 묶음 — 실제 모듈과 변조판에 같은 검사를 돌린다 ───────────────
const DATA_FILES = [
  "data/db.ts",
  "data/stl-files.repo.ts",
  "data/projects.repo.ts",
  "data/supports.repo.ts",
];
async function loadData(url) {
  return {
    db: await import(url("data/db.ts")),
    stl: await import(url("data/stl-files.repo.ts")),
    proj: await import(url("data/projects.repo.ts")),
    sup: await import(url("data/supports.repo.ts")),
  };
}

function sp(id, projectId, stlId, extra = {}) {
  return { id, projectId, stlId, contact: [0, 1, 0], base: [0, 0, 0], addedAt: Date.now(), ...extra };
}

/**
 * @param failFast 대조군용 — 첫 실패에서 멈춘다(영원히 대기 변조판이 검사마다 2 s 씩 쓰지 않게).
 */
async function c2Suite(m, F, { failFast = false } = {}) {
  const res = [];
  let stop = false;
  const check = (ok, label) => {
    res.push({ ok: !!ok, label });
    if (!ok && failFast) stop = true;
  };
  // 직전 호출의 트랜잭션이 커밋을 마칠 때까지 기다린 뒤 부른다 — 종전 get 처럼 요청 성공에서
  //   먼저 resolve 하는 코드의 남은 커밋이 다음 주입을 먹어 버리지 않게.
  const T = async (fn) => {
    await F.idle();
    return settleWithin(Promise.resolve().then(fn));
  };
  const isName = (r, name) => r.state === "rejected" && r.error?.name === name;
  const desc = (r) =>
    r.state === "rejected" ? `rejected(${r.error?.name ?? String(r.error)})` : r.state;

  // ── (a) 정상 경로 ──
  const pr = await T(() => m.proj.createProject({ name: " 데모 " }));
  check(pr.state === "resolved" && pr.value.name === "데모", `정상 createProject → ${desc(pr)}`);
  if (stop) return res;
  const pid = pr.value.id;
  const blob = new Blob([new Uint8Array([1, 2, 3])]);
  const steps = [
    ["getProject", () => m.proj.getProject(pid), (v) => v?.id === pid],
    ["listProjects", () => m.proj.listProjects(), (v) => v.some((p) => p.id === pid)],
    ["updateProject", () => m.proj.updateProject(pid, { note: "n" }), (v) => v.note === "n"],
    [
      "putProject",
      () => m.proj.putProject({ ...pr.value, id: "p-imp", code: "IMPORT01" }),
      () => true,
    ],
    ["createStlFile", () => m.stl.createStlFile(pid, "a.stl", blob), (v) => !!v.id],
  ];
  let s1 = null;
  for (const [name, fn, ok] of steps) {
    const r = await T(fn);
    check(r.state === "resolved" && ok(r.value), `정상 ${name} → ${desc(r)}`);
    if (stop) return res;
    if (name === "createStlFile") s1 = r.value;
  }
  const steps2 = [
    ["getStlFile", () => m.stl.getStlFile(s1.id), (v) => v?.fileName === "a.stl"],
    ["updateStlFile", () => m.stl.updateStlFile(s1.id, { fileName: "b.stl" }), (v) => v.fileName === "b.stl"],
    ["putStlFile", () => m.stl.putStlFile({ ...s1, id: "s-imp", addedAt: s1.addedAt + 1 }), () => true],
    [
      "listStlFilesByProject",
      () => m.stl.listStlFilesByProject(pid),
      (v) => v.length === 2 && v[0].id === s1.id && v[1].id === "s-imp",
    ],
    [
      "addSupports",
      () =>
        m.sup.addSupports([
          sp("sp1", pid, s1.id),
          sp("sp2", pid, "other", { baseStlId: s1.id }),
          sp("sp3", pid, s1.id),
          sp("disc1", pid, "zz", { variant: "disc" }),
        ]),
      () => true,
    ],
    ["listSupportsByProject", () => m.sup.listSupportsByProject(pid), (v) => v.length === 3],
    [
      "listSupportsByStl",
      () => m.sup.listSupportsByStl(s1.id),
      (v) => v.length === 2 && v.every((x) => x.stlId === s1.id),
    ],
    ["updateSupport", () => m.sup.updateSupport("sp1", { contact: [1, 2, 3] }), () => true],
    ["deleteSupport", () => m.sup.deleteSupport("sp3"), () => true],
    ["deleteSupportsByIds", () => m.sup.deleteSupportsByIds(["sp1"]), () => true],
    ["deleteSupportsByStl(by_base_stl)", () => m.sup.deleteSupportsByStl(s1.id), () => true],
    [
      "→ by_base_stl 로 sp2 삭제됨",
      () => m.sup.listSupportsByProject(pid),
      (v) => v.length === 0,
    ],
    ["deleteSupportsByProject", () => m.sup.deleteSupportsByProject(pid), () => true],
    ["deleteStlFile", () => m.stl.deleteStlFile("s-imp"), () => true],
    ["deleteStlFilesByProject", () => m.stl.deleteStlFilesByProject(pid), () => true],
    ["→ 목록 비었음", () => m.stl.listStlFilesByProject(pid), (v) => v.length === 0],
    ["deleteProject", () => m.proj.deleteProject("p-imp"), () => true],
    [
      "withStore(readonly get)",
      () => m.db.withStore(m.db.STORE_PROJECTS, "readonly", (s) => s.get(pid)),
      (v) => v?.id === pid,
    ],
  ];
  for (const [name, fn, ok] of steps2) {
    const r = await T(fn);
    check(r.state === "resolved" && ok(r.value), `정상 ${name} → ${desc(r)}`);
    if (stop) return res;
  }
  // 코드 충돌(ConstraintError) 재시도 — 원인 name 이 보존돼야 createProject 가 다시 뽑는다.
  await F.idle();
  F.inject.requestFailure = { op: "add", name: "ConstraintError" };
  const retry = await T(() => m.proj.createProject({ name: "재시도" }));
  check(retry.state === "resolved", `createProject ConstraintError 재시도 → ${desc(retry)}`);
  if (stop) return res;

  // 시드 — 실패 주입용 대상 레코드
  const s2 = (await T(() => m.stl.createStlFile(pid, "c.stl", blob))).value;
  await T(() => m.sup.addSupports([sp("spX", pid, s2.id), sp("spZ", pid, s2.id)]));
  await T(() => m.proj.putProject({ ...pr.value, id: "p-x", code: "XXXXXXXX" }));

  // ── (b) 커밋 중단 주입 — 쿼터 초과 흉내(쓰기) / 일반 중단(읽기) ──
  const writes = [
    ["createProject", () => m.proj.createProject({ name: "q" })],
    ["updateProject", () => m.proj.updateProject(pid, { note: "q" })],
    ["putProject", () => m.proj.putProject({ ...pr.value, id: "p-q", code: "QQQQQQQQ" })],
    ["deleteProject", () => m.proj.deleteProject("p-x")],
    ["createStlFile", () => m.stl.createStlFile(pid, "q.stl", blob)],
    ["updateStlFile", () => m.stl.updateStlFile(s2.id, { fileName: "q.stl" })],
    ["putStlFile", () => m.stl.putStlFile({ ...s2, id: "s-q" })],
    ["deleteStlFile", () => m.stl.deleteStlFile(s2.id)],
    ["deleteStlFilesByProject", () => m.stl.deleteStlFilesByProject(pid)],
    ["addSupports", () => m.sup.addSupports([sp("spQ", pid, s2.id)])],
    ["updateSupport", () => m.sup.updateSupport("spX", { contact: [9, 9, 9] })],
    ["deleteSupport", () => m.sup.deleteSupport("spX")],
    ["deleteSupportsByIds", () => m.sup.deleteSupportsByIds(["spX"])],
    ["deleteSupportsByProject", () => m.sup.deleteSupportsByProject(pid)],
    ["deleteSupportsByStl", () => m.sup.deleteSupportsByStl(s2.id)],
    [
      "withStore(readwrite)",
      () => m.db.withStore(m.db.STORE_PROJECTS, "readwrite", (s) => s.put({ ...pr.value, id: "p-ws", code: "WSWSWSWS" })),
    ],
    ["_wipeAll", () => m.db._wipeAll()],
  ];
  for (const [name, fn] of writes) {
    await F.idle();
    F.inject.commitFailure = { name: "QuotaExceededError" };
    const r = await T(fn);
    F.inject.commitFailure = null;
    check(isName(r, "QuotaExceededError"), `커밋 중단(쿼터) ${name} → ${desc(r)}`);
    if (stop) return res;
  }
  const after = await T(() => m.stl.getStlFile(s2.id));
  check(after.state === "resolved" && after.value?.fileName === "c.stl", "중단된 쓰기는 반영되지 않음(시드 그대로)");
  if (stop) return res;
  const reads = [
    ["listProjects", () => m.proj.listProjects()],
    ["getProject", () => m.proj.getProject(pid)],
    ["listStlFilesByProject", () => m.stl.listStlFilesByProject(pid)],
    ["getStlFile", () => m.stl.getStlFile(s2.id)],
    ["listSupportsByProject", () => m.sup.listSupportsByProject(pid)],
    ["listSupportsByStl", () => m.sup.listSupportsByStl(s2.id)],
    ["withStore(readonly)", () => m.db.withStore(m.db.STORE_PROJECTS, "readonly", (s) => s.get(pid))],
  ];
  for (const [name, fn] of reads) {
    await F.idle();
    F.inject.commitFailure = { name: "UnknownError", mode: "readonly" };
    const r = await T(fn);
    F.inject.commitFailure = null;
    check(isName(r, "UnknownError"), `읽기 중단 ${name} → ${desc(r)}`);
    if (stop) return res;
  }

  // ── (c) 요청 단위 에러 — 원인 name 보존 ──
  const reqFails = [
    ["createProject", "add", () => m.proj.createProject({ name: "r" })],
    ["createStlFile", "add", () => m.stl.createStlFile(pid, "r.stl", blob)],
    ["updateProject", "put", () => m.proj.updateProject(pid, { note: "r" })],
    ["updateStlFile", "put", () => m.stl.updateStlFile(s2.id, { fileName: "r.stl" })],
    ["updateSupport", "put", () => m.sup.updateSupport("spX", { contact: [7, 7, 7] })],
    ["putProject", "put", () => m.proj.putProject({ ...pr.value, id: "p-r", code: "RRRRRRRR" })],
    ["putStlFile", "put", () => m.stl.putStlFile({ ...s2, id: "s-r" })],
    ["addSupports", "put", () => m.sup.addSupports([sp("spR", pid, s2.id)])],
    ["deleteProject", "delete", () => m.proj.deleteProject("p-x")],
    ["deleteStlFile", "delete", () => m.stl.deleteStlFile(s2.id)],
    ["deleteSupport", "delete", () => m.sup.deleteSupport("spX")],
    ["deleteSupportsByIds", "delete", () => m.sup.deleteSupportsByIds(["spX"])],
    ["deleteSupportsByProject", "delete", () => m.sup.deleteSupportsByProject(pid)],
    ["deleteSupportsByStl", "delete", () => m.sup.deleteSupportsByStl(s2.id)],
    ["deleteStlFilesByProject", "delete", () => m.stl.deleteStlFilesByProject(pid)],
    ["_wipeAll", "clear", () => m.db._wipeAll()],
  ];
  for (const [name, op, fn] of reqFails) {
    await F.idle();
    F.inject.requestFailure = { op, name: "QuotaExceededError" };
    const r = await T(fn);
    const consumed = F.inject.requestFailure === null;
    F.inject.requestFailure = null;
    check(consumed && isName(r, "QuotaExceededError"), `요청 에러(${op}) ${name} → ${desc(r)}`);
    if (stop) return res;
  }

  // ── 명시적 tx.abort()(없는 레코드) — 호출 측 에러가 그대로 ──
  for (const [name, fn] of [
    ["updateStlFile", () => m.stl.updateStlFile("nope", {})],
    ["updateProject", () => m.proj.updateProject("nope", {})],
    ["updateSupport", () => m.sup.updateSupport("nope", {})],
  ]) {
    const r = await T(fn);
    check(r.state === "rejected" && /not found/.test(r.error?.message ?? ""), `없는 레코드 ${name} → ${desc(r)}(not found 보존)`);
    if (stop) return res;
  }
  return res;
}

// ── C2 소스 검사 ─────────────────────────────────────────────────────────
/** 최상위 함수 단위로 자른다 (export async function / function / export function). */
function topLevelFunctions(text) {
  const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
  const heads = [...text.matchAll(re)].map((mm) => ({ name: mm[1], at: mm.index }));
  return heads.map((h, i) => ({ name: h.name, body: text.slice(h.at, heads[i + 1]?.at ?? text.length) }));
}
const count = (s, needle) => s.split(needle).length - 1;

function c2SourceChecks(texts) {
  const res = [];
  const check = (ok, label) => res.push({ ok: !!ok, label });
  let txTotal = 0;
  const txList = [];
  for (const file of DATA_FILES) {
    const text = texts[file];
    for (const fn of topLevelFunctions(text)) {
      const nTx = count(fn.body, ".transaction(");
      if (nTx === 0) continue;
      txTotal += nTx;
      txList.push(`${file.replace("data/", "")}:${fn.name}`);
      const nSettle = count(fn.body, "settleTx(");
      check(nSettle >= nTx, `소스 ${file} ${fn.name} — 트랜잭션 ${nTx}개가 settleTx 경유(${nSettle})`);
    }
    if (file !== "data/db.ts") {
      const raw = (text.match(/\b(?:tx|req|getReq)\.on(?:complete|error|abort|success)\s*=/g) ?? []).filter(
        (x) => !x.startsWith("getReq.onsuccess"),
      );
      check(raw.length === 0, `소스 ${file} — 트랜잭션 끝 처리를 직접 거는 코드 없음(${raw.join(", ") || "0"})`);
    }
  }
  // db.ts — 끝 처리 대입은 settleTx 본문 안에만
  const dbText = texts["data/db.ts"];
  const settleBody = topLevelFunctions(dbText).find((f) => f.name === "settleTx")?.body ?? "";
  check(/tx\.onabort\s*=/.test(settleBody), "소스 db.ts settleTx — onabort 처리 있음");
  check(/tx\.oncomplete\s*=/.test(settleBody) && /tx\.onerror\s*=/.test(settleBody), "소스 db.ts settleTx — oncomplete·onerror 처리 있음");
  const outside = dbText.replace(settleBody, "");
  check(!/tx\.on(?:complete|error|abort)\s*=/.test(outside), "소스 db.ts — settleTx 밖에 트랜잭션 끝 처리 대입 없음");
  check(txTotal >= 23, `소스 트랜잭션 총 ${txTotal}개(repo 21 + db.ts 2) 전부 검사됨`);
  // 스키마 불변 — DB_VERSION·스토어·인덱스
  check(/export const DB_VERSION = 4;/.test(dbText), "스키마 불변 — DB_VERSION = 4");
  const schemaCalls = [...dbText.matchAll(/create(?:ObjectStore|Index)\(([^)]*)\)/g)].map((mm) => mm[1].replace(/\s+/g, " ").trim());
  const expected = [
    'STORE_PROJECTS, { keyPath: "id" }',
    '"by_lastModifiedAt", "lastModifiedAt"',
    '"by_code", "code", { unique: true }',
    'STORE_STL_FILES, { keyPath: "id", }',
    '"by_project", "projectId"',
    '"by_addedAt", "addedAt"',
    'STORE_SUPPORTS, { keyPath: "id", }',
    '"by_project", "projectId"',
    '"by_stl", "stlId"',
    '"by_base_stl", "baseStlId"',
  ];
  check(JSON.stringify(schemaCalls) === JSON.stringify(expected), `스키마 불변 — 스토어·인덱스 ${schemaCalls.length}개 종전과 동일`);
  return { res, txList };
}

/** v2 전체에서 data/ 밖 IndexedDB 직접 접근 없음 (규칙 1). */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
// 실행 — C2
// ═════════════════════════════════════════════════════════════════════════
console.log("\n[C2-a~c] 실제 repo 모듈 — 정상 resolve / 중단·에러는 2 s 안에 reject(원인 보존)");
const realF = makeFactory();
globalThis.indexedDB = realF;
const realData = await loadData((rel) => pathToFileURL(join(V2, rel)).href);
const alerts = [];
const errLogs = [];
const origConsoleError = console.error;
const origConsoleWarn = console.warn;
globalThis.window = { alert: (msg) => alerts.push(msg) };
console.error = (...a) => errLogs.push(a.map(String).join(" "));
console.warn = () => {};
let realC2;
try {
  realC2 = await c2Suite(realData, realF);
} finally {
  console.error = origConsoleError;
  console.warn = origConsoleWarn;
}
assertAll(realC2);

console.log("\n[C2-d] 저장공간 부족 안내 — 한 번만(10 s 간격), 콘솔에 원인");
assert(alerts.length === 1, `alert 호출 ${alerts.length}회(쿼터 실패 33건 연속 → 1회)`);
assert(/저장공간/.test(alerts[0] ?? ""), `안내 문구 한국어: ${JSON.stringify((alerts[0] ?? "").split("\n")[0])}`);
assert(errLogs.some((l) => l.includes("QuotaExceededError")), "console.error 에 QuotaExceededError 기록");
assert(!errLogs.some((l) => l.includes("AbortError")), "명시적 tx.abort()(없는 레코드)는 조용히 — AbortError 로그 없음");
delete globalThis.window;

console.log("\n[C2-open] openDb — 열기 실패 후 재시도 가능, 새 DB 업그레이드");
{
  const fresh = makeMutant(["data/db.ts"]);
  const F = makeFactory();
  globalThis.indexedDB = F;
  const db = await import(fresh.url("data/db.ts"));
  F.inject.openFailure = "UnknownError";
  const r1 = await settleWithin(db.openDb());
  assert(r1.state === "rejected" && r1.error?.name === "UnknownError", `열기 실패 → ${r1.state}`);
  const r2 = await settleWithin(db.openDb());
  assert(r2.state === "resolved", `다음 호출은 다시 열어 성공 → ${r2.state}`);
  const rec = F.dbs.get(db.DB_NAME);
  assert(
    rec?.version === 4 && rec.stores.get(db.STORE_SUPPORTS)?.indexes.has("by_base_stl"),
    "새 DB 업그레이드 v0→v4 (by_base_stl 인덱스까지)",
  );
}

console.log("\n[C2-e] 소스 검사 — 모든 트랜잭션이 settleTx 경유, 스키마 불변, data/ 밖 직접 접근 없음");
const realTexts = Object.fromEntries(DATA_FILES.map((f) => [f, src(f)]));
const { res: c2src, txList } = c2SourceChecks(realTexts);
assertAll(c2src);
console.log(`      트랜잭션 목록(${txList.length}): ${txList.join(", ")}`);
const direct = walk(V2)
  .filter((p) => !p.replace(/\\/g, "/").includes("/features/v2/data/"))
  .filter((p) => /\bindexedDB\.|\.transaction\(\s*(?:STORE_|\[)/.test(readFileSync(p, "utf8")));
assert(direct.length === 0, `data/ 밖 IndexedDB 직접 접근 0 (${direct.length})`);

console.log("\n[C2 대조군] 변조판이 실제로 실패하는가");
/**
 * @param expectSource 소스 검사도 이 변조를 잡아야 하는가 (동작 검사는 항상 잡아야 한다 —
 *   소스 검사만으로 통과시키지 않도록 둘을 따로 단언한다)
 */
async function c2Mutant(label, mutations, { expectSource }) {
  const mm = makeMutant(DATA_FILES, mutations);
  const F = makeFactory();
  globalThis.indexedDB = F;
  const mods = await loadData(mm.url);
  const silent = console.error;
  console.error = () => {};
  let dyn;
  try {
    dyn = await c2Suite(mods, F, { failFast: true });
  } finally {
    console.error = silent;
  }
  assertControl(dyn, `${label} (동작)`);
  if (expectSource) assertControl(c2SourceChecks(mm.texts).res, `${label} (소스)`);
}
await c2Mutant(
  "onabort 제거(settleTx)",
  [{ file: "data/db.ts", from: "  tx.onabort = () => fail(tx.error ?? abortError());\n", to: "" }],
  { expectSource: true },
);
await c2Mutant(
  "헬퍼 우회 — createStlFile 을 종전 코드로",
  [
    {
      file: "data/stl-files.repo.ts",
      from: "    settleTx(tx, () => resolve(), reject);\n",
      to: "    tx.oncomplete = () => resolve();\n    tx.onerror = () => reject(tx.error);\n",
    },
  ],
  { expectSource: true },
);
await c2Mutant(
  "원인 소실 — error 이벤트에서 tx.error 만 사용",
  [
    {
      file: "data/db.ts",
      from: "        (event.target as { error?: DOMException | null } | null)?.error ??\n",
      to: "",
    },
  ],
  { expectSource: false },
);
{
  // 소스 검사 단독 대조군 — 동작은 같아도 헬퍼 밖 끝 처리 대입은 잡는다.
  const t = { ...realTexts };
  t["data/supports.repo.ts"] = t["data/supports.repo.ts"].replace(
    "    settleTx(tx, () => resolve(), reject);\n",
    "    settleTx(tx, () => resolve(), reject);\n    tx.onabort = () => reject(tx.error);\n",
  );
  assertControl(c2SourceChecks(t).res, "소스 — 헬퍼와 별개로 tx.onabort 직접 대입");
  const t2 = { ...realTexts };
  t2["data/projects.repo.ts"] += `\nexport async function rogue(): Promise<void> {\n  const db = await openDb();\n  db.transaction(STORE_PROJECTS, "readwrite");\n}\n`;
  assertControl(c2SourceChecks(t2).res, "소스 — settleTx 없는 새 트랜잭션 함수 추가");
  const t3 = { ...realTexts };
  t3["data/db.ts"] = t3["data/db.ts"].replace("export const DB_VERSION = 4;", "export const DB_VERSION = 5;");
  assertControl(c2SourceChecks(t3).res, "소스 — DB_VERSION 변경");
}

// ═════════════════════════════════════════════════════════════════════════
// C3 · C7 — Babylon NullEngine + 실제 manifold-3d
// ═════════════════════════════════════════════════════════════════════════
const { NullEngine, Scene, MeshBuilder, StandardMaterial } = await import("@babylonjs/core");

// manifold wasm 선형 메모리 포착(참고 출력용) — 모듈 생성 동안만 instantiate 를 감싼다.
let wasmMemory = null;
const origInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = async function (...a) {
  const r = await origInstantiate.apply(this, a);
  const inst = r.instance ?? r;
  for (const v of Object.values(inst.exports)) if (v instanceof WebAssembly.Memory) wasmMemory = v;
  return r;
};
const { default: ManifoldModule } = await import("manifold-3d");
const realMod = await ManifoldModule();
realMod.setup();
WebAssembly.instantiate = origInstantiate;

// 계수 래퍼 — 앱 코드가 만드는 Manifold(생성자·subtract 결과)를 전부 기록한다.
//   embind 객체는 isDeleted() 로 해제 여부를 안다. 생성자는 래퍼 모듈로, subtract 는
//   Manifold 원형(prototype) 메서드를 감싸 잡는다.
const created = [];
const track = (o) => {
  if (o) created.push(o);
  return o;
};
const ManProto = Object.getPrototypeOf(realMod.Manifold.prototype);
assert(typeof ManProto.subtract === "function" && typeof ManProto.isDeleted === "function", "계수 래퍼 — Manifold 원형의 subtract·isDeleted 확인");
for (const k of ["subtract", "add", "intersect"]) {
  const orig = ManProto[k];
  ManProto[k] = function (...a) {
    return track(orig.apply(this, a));
  };
}
const trackedMod = Object.create(realMod);
trackedMod.Manifold = function (mesh) {
  return track(new realMod.Manifold(mesh));
};
const liveCount = () => created.filter((o) => !o.isDeleted()).length;

// Babylon 파일 로더가 쓰는 FileReader (Node 에 없음)
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }, (e) => this.onerror?.(e));
  }
  readAsText(blob) {
    blob.text().then((t) => {
      this.result = t;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    }, (e) => this.onerror?.(e));
  }
  abort() {}
};

const { babylonMeshToManifold } = await import("../src/features/v2/utils/manifold-csg.ts");
const { clipBridgeWithManifold } = await import("../src/features/v2/components/babylon/bridge-clip.ts");
const { createSupportMaterial } = await import("../src/features/v2/utils/support-render.ts");
const { DEFAULT_SUPPORT_PARAMS } = await import("../src/features/v2/support/utils/defaults.ts");
const { SAMPLE_MODELS } = await import("../src/features/v2/utils/sample-models.ts");
const cubeBlob = () => SAMPLE_MODELS.find((s) => s.id === "cube20").build();
const sphereBlob = () => SAMPLE_MODELS.find((s) => s.id === "sphere20").build();

/** 정사면체를 솔리드 2개(면 2+2)로 나눈 ASCII STL — 합치면 닫힌 모델 하나. */
function tetraTwoSolids() {
  const P = [
    [0, 0, 0],
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 10],
  ];
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
  ];
  const facet = (f) =>
    `facet normal 0 0 0\nouter loop\n${f.map((i) => `vertex ${P[i].join(" ")}`).join("\n")}\nendloop\nendfacet\n`;
  return new Blob([
    `solid partA\n${facet(faces[0])}${facet(faces[1])}endsolid partA\n` +
      `solid partB\n${facet(faces[2])}${facet(faces[3])}endsolid partB\n`,
  ]);
}
const oneSolid = () =>
  new Blob(["solid one\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid one\n"]);

function makeCtx() {
  const base = {
    meshMapRef: { current: new Map() },
    supportMeshMapRef: { current: new Map() },
    stlManifoldMapRef: { current: new Map() },
    bridgeClipCacheRef: { current: new Map() },
    sliceFillMeshesRef: { current: [] },
    paintOverlaysRef: { current: [] },
    paintPointsRef: { current: [] },
    marginMarkersRef: { current: [] },
    autoFillOverlayRef: { current: [] },
    islandMarkersRef: { current: [] },
    redesignMarkersRef: { current: [] },
    autoFillFacesRef: { current: new Set() },
    isUnmountingRef: { current: false },
  };
  return new Proxy(base, {
    get(t, p) {
      if (!(p in t)) t[p] = { current: null };
      return t[p];
    },
  });
}
/** dispose-scene 의 window.removeEventListener 용 — 그 호출 동안만 둔다. */
function withWindowStub(fn) {
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try {
    return fn();
  } finally {
    delete globalThis.window;
  }
}

const SCENE_FILES = [
  "components/babylon/resource-release.ts",
  "components/babylon/hooks/dispose-scene.ts",
  "utils/stl-loader.ts",
];
async function loadSceneMods(url) {
  const rr = await import(url("components/babylon/resource-release.ts"));
  const ds = await import(url("components/babylon/hooks/dispose-scene.ts"));
  const sl = await import(url("utils/stl-loader.ts"));
  return {
    disposeStlMesh: rr.disposeStlMesh,
    releaseStlManifold: rr.releaseStlManifold,
    releaseAllStlManifolds: rr.releaseAllStlManifolds,
    disposeScene: ds.disposeScene,
    loadStlIntoScene: sl.loadStlIntoScene,
  };
}

/** 뷰어 한 번 들어갔다 나오기 — 실제 모듈 경로를 그대로 밟는다. */
async function sceneSuite(k, { failFast = false } = {}) {
  const res = [];
  let stop = false;
  const check = (ok, label) => {
    res.push({ ok: !!ok, label });
    if (!ok && failFast) stop = true;
  };
  created.length = 0;
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const ctx = makeCtx();
  ctx.sceneRef.current = scene;
  ctx.engineRef.current = engine;
  ctx.manifoldModuleRef.current = trackedMod;
  const supportMat = createSupportMaterial(scene);
  ctx.supportMaterialRef.current = supportMat;
  const map = ctx.stlManifoldMapRef.current;
  try {
    // ── STL 2개 로드 + STL manifold (useFileMeshSync 로드 분기와 같은 호출) ──
    const A = await k.loadStlIntoScene(scene, cubeBlob(), "A", 0);
    const B = await k.loadStlIntoScene(scene, sphereBlob(), "B", 0);
    check(A.getTotalVertices() === 36 && scene.meshes.length === 2, `바이너리 STL — 메시 1개씩, 정육면체 정점 36 (${A.getTotalVertices()})`);
    for (const [id, mesh] of [["A", A], ["B", B]]) {
      ctx.meshMapRef.current.set(id, mesh);
      const man = babylonMeshToManifold(mesh, trackedMod, null);
      check(man && man.status() === "NoError", `STL ${id} manifold 생성 NoError`);
      k.releaseStlManifold(map, id);
      map.set(id, man);
    }
    check(liveCount() === 2, `STL manifold 2개 생존 (${liveCount()})`);
    if (stop) return res;

    // ── 브릿지 절삭 — A 를 관통하는 튜브(공유 서포트 머티리얼) ──
    const tube = MeshBuilder.CreateCylinder("tube", { height: 40, diameter: 2 }, scene);
    tube.material = supportMat;
    tube.position.set(3, 10, 3);
    tube.metadata = { kind: "bridge" };
    const point = { id: "br1", projectId: "p", stlId: "A", contact: [3, 25, 3], base: [3, -5, 3], source: "bridge", addedAt: 0 };
    const clipped = clipBridgeWithManifold(ctx, DEFAULT_SUPPORT_PARAMS, tube, point, supportMat, scene, trackedMod);
    check(clipped && clipped.parent === A && clipped.material === supportMat, "브릿지 절삭 결과 = A 의 자식 + 공유 서포트 머티리얼");
    check(created.length > 2 && liveCount() === 2, `브릿지 절삭 임시 manifold(튜브·결과 ${created.length - 2}개) 전부 해제 (생존 ${liveCount()})`);
    if (stop) return res;
    if (clipped) ctx.supportMeshMapRef.current.set("br1", clipped);
    // 부모 없는 일반 서포트 — 공유 머티리얼
    const box = MeshBuilder.CreateBox("s2", { size: 2 }, scene);
    box.material = supportMat;
    ctx.supportMeshMapRef.current.set("s2", box);
    // 색칠 데칼 — A 의 자식 + 데칼 전용 머티리얼 (useDentalBrush 구성 그대로)
    const decal = MeshBuilder.CreatePlane("decal", { size: 1 }, scene);
    const dm = new StandardMaterial("v2_maskMat", scene);
    decal.material = dm;
    decal.setParent(A);
    ctx.paintOverlaysRef.current.push(decal);
    ctx.paintPointsRef.current.push({ mesh: A });
    const aMat = A.material;
    const bMat = B.material;

    // ── 모델 A 삭제 — useFileMeshSync 제거 분기의 해제 호출을 같은 순서로 ──
    for (let i = ctx.paintPointsRef.current.length - 1; i >= 0; i--) {
      if (ctx.paintPointsRef.current[i].mesh === A) {
        ctx.paintPointsRef.current.splice(i, 1);
        ctx.paintOverlaysRef.current.splice(i, 1)[0]?.dispose(false, true);
      }
    }
    k.disposeStlMesh(A);
    ctx.meshMapRef.current.delete("A");
    k.releaseStlManifold(map, "A");
    check(A.isDisposed() && !scene.materials.includes(aMat), "모델 삭제 — STL 전용 머티리얼 해제");
    check(!scene.materials.includes(dm), "모델 삭제 — 색칠 데칼 전용 머티리얼 해제");
    check(scene.materials.includes(supportMat) && box.material === supportMat && !box.isDisposed(), "모델 삭제 — 공유 서포트 머티리얼 생존(다른 서포트가 계속 사용)");
    check(clipped?.isDisposed(), "모델 삭제 — A 자식 브릿지 메시도 함께 사라짐(종전 동작)");
    check(!B.isDisposed() && scene.materials.includes(bMat), "모델 삭제 — 다른 모델 B 무영향");
    check(liveCount() === 1 && map.size === 1 && map.has("B"), `모델 삭제 — A manifold 해제, B 만 생존 (${liveCount()})`);
    if (stop) return res;
    // 서포트 삭제(useSupportMeshSync) — 메시만 dispose, 공유 머티리얼은 남는다(정책)
    box.dispose();
    ctx.supportMeshMapRef.current.delete("s2");
    check(scene.materials.includes(supportMat), "서포트 전부 삭제돼도 공유 머티리얼은 씬 정리 전까지 생존");

    // ── 취소된 로드(useFileMeshSync cancelled 분기) ──
    const C = await k.loadStlIntoScene(scene, cubeBlob(), "C", 0);
    const cMat = C.material;
    k.disposeStlMesh(C);
    check(C.isDisposed() && !scene.materials.includes(cMat), "취소된 로드 — 메시·전용 머티리얼 해제");

    // ── 다중 솔리드 ASCII STL ──
    const before = scene.meshes.length;
    const M = await k.loadStlIntoScene(scene, tetraTwoSolids(), "M", 0);
    check(scene.meshes.length === before + 1, `다중 솔리드(2) → 씬 메시 +1 (잔여 없음, +${scene.meshes.length - before})`);
    check(M.getTotalVertices() === 12, `다중 솔리드 → 합친 메시에 두 솔리드 정점 전부 (${M.getTotalVertices()}/12)`);
    const mMan = babylonMeshToManifold(M, trackedMod, null);
    check(mMan && mMan.status() === "NoError", "다중 솔리드 → 합친 메시가 닫힌 모델 하나(manifold NoError)");
    mMan?.delete();
    const mMat = M.material;
    k.disposeStlMesh(M);
    check(scene.meshes.length === before && !scene.materials.includes(mMat), "다중 솔리드 모델 삭제 → 씬에 남는 메시·머티리얼 0");
    const O = await k.loadStlIntoScene(scene, oneSolid(), "O", 0);
    check(scene.meshes.length === before + 1 && O.getTotalVertices() === 3, "단일 솔리드 ASCII — 종전처럼 메시 1개");
    k.disposeStlMesh(O);
    if (stop) return res;

    // ── 씬 정리(useSceneBootstrap cleanup → disposeScene) ──
    withWindowStub(() =>
      k.disposeScene(ctx, { engine, scene, hl: { dispose() {} }, onResize() {}, resizeObserver: null }),
    );
    check(liveCount() === 0, `씬 정리 — 살아 있는 manifold 0 (${liveCount()})`);
    check(map.size === 0, "씬 정리 — STL manifold 캐시 비움");
    check(scene.isDisposed, "씬 정리 — scene.dispose() 까지 진행(순서 끝까지)");
  } catch (e) {
    check(false, `예외: ${e?.message ?? e}`);
  } finally {
    // 대조군이 남긴 객체는 여기서 치운다(다음 검사에 섞이지 않게).
    for (const o of created) if (!o.isDeleted()) o.delete();
    withWindowStub(() => {
      try {
        if (!scene.isDisposed) scene.dispose();
        engine.dispose();
      } catch {
        // 이미 정리된 엔진 — 무시
      }
    });
  }
  return res;
}

console.log("\n[C3·C7] 실제 모듈 — 로드·브릿지 절삭·모델 삭제·다중 솔리드·씬 정리");
const realScene = await loadSceneMods((rel) => pathToFileURL(join(V2, rel)).href);
assertAll(await sceneSuite(realScene));

console.log("\n[C3] 뷰어 들락날락 10회 — 매회 정리 후 살아 있는 manifold 0");
{
  const mem0 = wasmMemory?.buffer.byteLength ?? 0;
  let allZero = true;
  for (let i = 0; i < 10; i++) {
    const r = await sceneSuite(realScene);
    if (r.some((x) => !x.ok)) allZero = false;
  }
  const mem1 = wasmMemory?.buffer.byteLength ?? 0;
  assert(allZero, "10회 모두 전 검사 통과(정리 후 manifold 0)");
  console.log(`      (참고) manifold wasm 선형 메모리 ${(mem0 / 1e6).toFixed(1)} MB → ${(mem1 / 1e6).toFixed(1)} MB`);
}

console.log("\n[C3·C7 대조군] 변조판이 실제로 실패하는가");
async function sceneMutant(label, mutations) {
  const mm = makeMutant(SCENE_FILES, mutations);
  const k = await loadSceneMods(mm.url);
  // 다중 솔리드 대조군은 반쪽 메시로 manifold 를 만들다 경고를 낸다 — 기대된 소음이라 숨긴다.
  const warn = console.warn;
  console.warn = () => {};
  let r;
  try {
    r = await sceneSuite(k, { failFast: true });
  } finally {
    console.warn = warn;
  }
  assertControl(r, label);
}
await sceneMutant("수정 전 dispose-scene — 씬 정리에서 manifold 해제 없음", [
  {
    file: "components/babylon/hooks/dispose-scene.ts",
    from: "  releaseAllStlManifolds(ctx.stlManifoldMapRef.current);\n",
    to: "",
  },
]);
await sceneMutant("manifold delete 생략 — 씬 정리(releaseAllStlManifolds)", [
  {
    file: "components/babylon/resource-release.ts",
    from: "    try {\n      m.delete();\n",
    to: "    try {\n",
  },
]);
await sceneMutant("manifold delete 생략 — 모델 삭제(releaseStlManifold)", [
  { file: "components/babylon/resource-release.ts", from: "  map.delete(stlId);\n  m.delete();\n", to: "  map.delete(stlId);\n" },
]);
await sceneMutant("공유 머티리얼까지 해제 — dispose(false, true)", [
  {
    file: "components/babylon/resource-release.ts",
    from: "  mesh.dispose();\n  if (!mat) return;\n",
    to: "  mesh.dispose(false, true);\n  if (!mat) return;\n",
  },
]);
await sceneMutant("STL 머티리얼 미해제(종전 mesh.dispose())", [
  {
    file: "components/babylon/resource-release.ts",
    from: "  mat.dispose(false, true);\n}",
    to: "}",
  },
]);
await sceneMutant("다중 솔리드 잔여(종전 meshes[0])", [
  {
    file: "utils/stl-loader.ts",
    from: "meshes.length === 1 ? meshes[0] : mergeStlSolids(meshes)",
    to: "meshes[0]",
  },
]);

// ── 훅 배선 소스 검사 (React 없이 훅을 못 돌리므로) ─────────────────────
function wiringChecks(t) {
  const res = [];
  const check = (ok, label) => res.push({ ok: !!ok, label });
  const fm = t["components/babylon/hooks/useFileMeshSync.ts"];
  check(fm.includes("if (removedMesh) disposeStlMesh(removedMesh);") && !/removedMesh\?\.dispose\(/.test(fm), "배선 useFileMeshSync — 모델 삭제는 disposeStlMesh(전용 머티리얼 포함)");
  check(fm.includes("releaseStlManifold(ctx.stlManifoldMapRef.current, id);"), "배선 useFileMeshSync — 모델 삭제 시 releaseStlManifold");
  check(fm.includes(".paintOverlaysRef.current.splice(i, 1)[0]?.dispose(false, true);"), "배선 useFileMeshSync — 색칠 데칼은 전용 머티리얼과 함께 dispose");
  check(/if \(cancelled\) \{\s*disposeStlMesh\(mesh\);/.test(fm), "배선 useFileMeshSync — 취소된 로드도 disposeStlMesh");
  const setAt = fm.indexOf("ctx.stlManifoldMapRef.current.set(f.id, man);");
  const relAt = fm.indexOf("releaseStlManifold(ctx.stlManifoldMapRef.current, f.id);");
  check(relAt > 0 && setAt > relAt, "배선 useFileMeshSync — 같은 id 재등록 전 옛 manifold 해제");
  check(!/\bm\.delete\(\)|\.dispose\(\);/.test(fm), "배선 useFileMeshSync — 헬퍼 밖 직접 해제(mesh.dispose()/m.delete()) 없음");
  const ds = t["components/babylon/hooks/dispose-scene.ts"];
  const order = [
    "ctx.isUnmountingRef.current = true;",
    'window.removeEventListener("resize", onResize);',
    "resizeObserver?.disconnect();",
    "ctx.positionGizmoRef.current?.dispose();",
    "ctx.utilityLayerRef.current?.dispose();",
    "for (const sm of ctx.supportMeshMapRef.current.values())",
    "ctx.supportMaterialRef.current?.dispose();",
    "ctx.sliceOutlineRef.current?.dispose();",
    "ctx.bridgeMarkerRef.current?.dispose();",
    "ctx.sliceModelMatRef.current?.dispose();",
    "for (const mesh of ctx.meshMapRef.current.values())",
    "ctx.meshMapRef.current.clear();",
    "releaseAllStlManifolds(ctx.stlManifoldMapRef.current);",
    "ctx.paintOverlaysRef.current = [];",
    "ctx.furnitureRef.current?.dispose();",
    "hl.dispose();",
    "scene.dispose();",
    "engine.dispose();",
  ];
  const pos = order.map((s) => ds.indexOf(s));
  const okOrder = pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1]));
  check(okOrder, `배선 dispose-scene — 순서 불변(… STL mesh → manifold 해제 → dental → … → scene → engine) [${pos.map((p) => (p < 0 ? "없음" : "o")).join("")}]`);
  const ss = t["components/babylon/hooks/useSupportMeshSync.ts"];
  check(!/dispose\((?:false|true),\s*true\)/.test(ss), "배선 useSupportMeshSync — 서포트 메시는 공유 머티리얼을 해제하지 않음");
  const sl = t["utils/stl-loader.ts"];
  check(sl.includes("meshes.length === 1 ? meshes[0] : mergeStlSolids(meshes)"), "배선 stl-loader — 단일 메시는 종전 객체 그대로, 다중 솔리드만 합침");
  return res;
}
const WIRE_FILES = [
  "components/babylon/hooks/useFileMeshSync.ts",
  "components/babylon/hooks/dispose-scene.ts",
  "components/babylon/hooks/useSupportMeshSync.ts",
  "utils/stl-loader.ts",
];
console.log("\n[배선] 훅·씬 정리 소스 검사");
const wireTexts = Object.fromEntries(WIRE_FILES.map((f) => [f, src(f)]));
assertAll(wiringChecks(wireTexts));
console.log("\n[배선 대조군]");
{
  const mut = (file, from, to) => {
    const t = { ...wireTexts };
    if (!t[file].includes(from)) return [{ ok: false, label: `변조 대상 없음 ${file}` }];
    t[file] = t[file].replace(from, to);
    return wiringChecks(t);
  };
  assertControl(mut("components/babylon/hooks/useFileMeshSync.ts", "if (removedMesh) disposeStlMesh(removedMesh);", "removedMesh?.dispose();"), "useFileMeshSync 모델 삭제를 종전 removedMesh?.dispose() 로");
  assertControl(mut("components/babylon/hooks/useFileMeshSync.ts", ".splice(i, 1)[0]?.dispose(false, true);", ".splice(i, 1);"), "색칠 데칼 머티리얼 해제 생략(종전)");
  assertControl(mut("components/babylon/hooks/dispose-scene.ts", "  releaseAllStlManifolds(ctx.stlManifoldMapRef.current);\n", ""), "dispose-scene manifold 해제 제거");
  assertControl(
    mut("components/babylon/hooks/dispose-scene.ts", "  scene.dispose();\n  engine.dispose();\n", "  engine.dispose();\n  scene.dispose();\n"),
    "dispose-scene scene/engine 순서 뒤집기",
  );
  assertControl(mut("components/babylon/hooks/useSupportMeshSync.ts", "        mesh.dispose();\n        map.delete(id);", "        mesh.dispose(false, true);\n        map.delete(id);"), "서포트 삭제가 공유 머티리얼까지 해제");
}

rmSync(TMP_ROOT, { recursive: true, force: true });
console.log(failed === 0 ? "\n=== 전부 PASS ===" : `\n=== FAIL ${failed}건 ===`);
process.exit(failed === 0 ? 0 : 1);
