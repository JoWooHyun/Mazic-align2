// 데모 수정 1차 헤드리스 검증 — 10/12 리드 실기 테스트 5건
//   ① 풀아치 자동 회전 제거 · ② Task0 플레이트 = 출력 가능 영역(주황 테두리 삭제) · ③ 여러 모델 재설계 서포트 차례 생성
//   · ④ Vite optimizeDeps(내보내기 중 새로고침) · ⑤ 슬라이스 미리보기 캡션의 해상도 표기 삭제.
//
//   실행: npx tsx scripts/verify-demo-fix1.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).
//   판정은 **exit code** 로 — 대조군 절은 정상일 때도 "실패 재현" 문자열을 낸다.
//
//   (1) 기능 검사 — 실제 모듈을 Babylon NullEngine 씬에서 돌린다:
//       (a) scene-setup addBuildPlateAndGrid — area 를 주면 평면 bbox = 영역(±0.01), 격자는 (minX, minZ) 모서리에서
//           10 mm 간격, 앞쪽 탭은 영역 앞변 중앙. area 가 없으면 종전(원점 중심 ±75 / ±42.5, 격자는 원점에서).
//           camera-views resetCameraOnPlate — center 를 주면 그 점을 본다, 없으면 원점.
//       (b) stl-loader — 가로 60 × 높이 10 × 깊이 20 mm 비대칭 박스(바이너리 STL, 여기서 생성 — 축 대응은 STL_UP_NOTE)를
//           불러도 긴 축이 X(세워지지 않음). 대조군 = git 의 수정 전 stl-loader(40cb275) — 긴 축이 Y 로 세워져 실패해야 한다.
//       (c) redesign-detect-actions prepareRedesignDetectInput(ctx, stlId) — 지정한 모델(선택과 무관), 없으면 활성
//           (선택 첫 번째), 씬에 없는 id 는 ok:false.
//   (2) 소스 검사 — autoOrient 0회, 영역 테두리 훅 삭제·참조 0회, BabylonScene useSceneBootstrap 4번째 인자·훅 14개 불변,
//       부트스트랩 plate effect deps 가 숫자, useDentalWorkflow 순차 루프·취소 중단·deps, ViewerV2Page 배선,
//       캡션에 px·1bpp 없음, vite.config optimizeDeps(워커 entries·js-clipper include), 영역 검사 그대로.
//   (3) ★ 대조군 원칙: 기능 모듈은 임시 폴더 사본의 핵심 한 곳을 변조해 같은 검사에 넣고, 소스 검사는 핵심 문자열을
//       지우거나 뒤집은 판을 넣어 **실제로 실패하는지** 확인한다. 변조 대상 문자열이 소스에 없으면 그 자체를 FAIL 로
//       센다(변조 안 된 채 통과하는 공허한 PASS 방지). 임시 사본의 bare import(@babylonjs/*)·상대 import 는 원본과 같은
//       모듈 인스턴스를 쓰도록 절대 URL 로 바꾼다(verify-safety2 와 같은 방식).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(__dirname, "..");
const V2 = join(FRONTEND, "src", "features", "v2");
/** 수정 전 기준 커밋 (#139 머지) — ① 대조군이 여기서 수정 전 stl-loader 를 꺼낸다. */
const BASE_COMMIT = "40cb275";

// ── assert 유틸 (verify-safety3 와 같은 구조) ─────────────────────────────
let failed = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}
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
function makeChecker() {
  const res = [];
  const check = (ok, label) => res.push({ ok: !!ok, label });
  return { res, check };
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const readV2 = (rel) => readFileSync(join(V2, rel), "utf8").replace(/\r\n/g, "\n");
const count = (s, sub) => s.split(sub).length - 1;
/** a 부터 그 뒤 첫 b 앞까지 (b 가 없으면 끝까지). a 가 없으면 "". */
function between(s, a, b) {
  const i = s.indexOf(a);
  if (i < 0) return "";
  const j = b ? s.indexOf(b, i + a.length) : -1;
  return s.slice(i, j > 0 ? j : s.length);
}
/** 주석 제거 — 주석에 든 이름이 검사를 속이지 않게 (verify-safety3 와 같은 식). */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ── 변조판(대조군) — 임시 폴더 사본, import 는 원본과 같은 모듈 인스턴스로 ──────────
const TMP_ROOT = mkdtempSync(join(tmpdir(), "verify-demo-fix1-"));
process.on("exit", () => rmSync(TMP_ROOT, { recursive: true, force: true }));
const BARE = {
  "@babylonjs/core": import.meta.resolve("@babylonjs/core"),
  "@babylonjs/loaders/STL": import.meta.resolve("@babylonjs/loaders/STL"),
};
/** 사본 텍스트의 import 를 절대 URL 로 — bare 는 이 스크립트 기준 해석, 상대 경로는 원본 위치 기준 해석. */
function rewriteImports(text, origAbs) {
  let src = text;
  for (const [spec, url] of Object.entries(BARE)) src = src.split(`"${spec}"`).join(`"${url}"`);
  return src.replace(/(from\s+|import\s+)(["'])(\.{1,2}\/[^"']+)\2/g, (m, kw, q, rel) => {
    const base = resolve(dirname(origAbs), rel);
    const cand = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), base].find(
      (c) => existsSync(c) && statSync(c).isFile(),
    );
    if (!cand) throw new Error(`사본 import 를 풀 수 없음: ${rel} (${origAbs})`);
    return `${kw}${q}${pathToFileURL(cand).href}${q}`;
  });
}
let mutantSeq = 0;
/** 텍스트(원본 위치 origAbs 기준)를 임시 폴더에 써서 import. */
async function importText(text, origAbs) {
  const out = join(TMP_ROOT, `m${mutantSeq++}`, origAbs.split(/[\\/]/).pop());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, rewriteImports(text, origAbs));
  return import(pathToFileURL(out).href);
}
/** v2 파일 rel 을 from → to 로 바꾼 사본을 import. 대상 문자열이 없으면 null. */
async function loadMutant(rel, mutations) {
  let text = readV2(rel);
  for (const [from, to] of mutations) {
    if (!text.includes(from)) return null;
    text = text.replace(from, to);
  }
  return importText(text, join(V2, rel));
}
async function functionalControl(label, rel, mutations, suite) {
  const mod = await loadMutant(rel, mutations);
  if (!mod) {
    // 변조 대상 문자열이 소스에 없으면 대조군이 아무것도 검사하지 못한 것 — 그 자체를 FAIL 로 센다(공허한 PASS 방지).
    assert(false, `[대조군] ${label} — 변조 대상 없음 ${rel}`);
    return;
  }
  let results;
  try {
    results = await suite(mod);
  } catch (e) {
    results = [{ ok: false, label: `검사 도중 예외: ${e?.message ?? e}` }];
  }
  assertControl(results, label);
}

// ── Babylon (Node) 준비 ─────────────────────────────────────────────────
const { NullEngine, Scene, ArcRotateCamera, MeshBuilder, Vector3, VertexBuffer } = await import("@babylonjs/core");
// Babylon 파일 로더가 쓰는 FileReader (Node 에 없음 — verify-safety2 와 같은 대용)
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
const engine = new NullEngine();
const newScene = () => new Scene(engine);

const REL = {
  setup: "utils/scene-setup.ts",
  camera: "utils/camera-views.ts",
  loader: "utils/stl-loader.ts",
  redesign: "components/babylon/redesign-detect-actions.ts",
};
const realMod = async (rel) => import(pathToFileURL(join(V2, rel)).href);

// ═════════════════════════════════════════════════════════════════════════
// (1) 기능 검사
// ═════════════════════════════════════════════════════════════════════════

/** Task0 기본 출력 가능 영역 (world) — 베드 X 10~150·Y 10~85, 베드 150 × 85 */
const AREA = { minX: -65, maxX: 75, minZ: -32.5, maxZ: 42.5 };

/** 선 메시의 정점 좌표 목록 [[x,y,z], ...] (world — 선 메시는 원점에 그대로라 local = world) */
function lineVerts(mesh) {
  const p = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const out = [];
  for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]);
  return out;
}
/** 격자 선(2점씩)을 세로선(x 일정)의 x 목록·가로선(z 일정)의 z 목록으로 나눈다 */
function gridAxes(mesh) {
  const v = lineVerts(mesh);
  const xs = new Set();
  const zs = new Set();
  for (let i = 0; i + 1 < v.length; i += 2) {
    if (near(v[i][0], v[i + 1][0], 1e-6)) xs.add(v[i][0].toFixed(3));
    else if (near(v[i][2], v[i + 1][2], 1e-6)) zs.add(v[i][2].toFixed(3));
  }
  return { xs, zs, verts: v };
}
function worldBox(mesh) {
  mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo();
  const bb = mesh.getBoundingInfo().boundingBox;
  return { min: bb.minimumWorld, max: bb.maximumWorld };
}

/** ② (a) 플레이트 — area 있음 / 없음. setupMod = scene-setup 모듈, camMod = camera-views 모듈 */
function suitePlate(setupMod, camMod) {
  const { res, check } = makeChecker();
  // area 있음 (Task0)
  {
    const scene = newScene();
    const f = setupMod.addBuildPlateAndGrid(scene, { widthMm: 150, depthMm: 85, area: AREA });
    const b = worldBox(f.plate);
    check(
      near(b.min.x, AREA.minX) && near(b.max.x, AREA.maxX) && near(b.min.z, AREA.minZ) && near(b.max.z, AREA.maxZ),
      `② area 있음: 평면 bbox = 출력 가능 영역 (X ${b.min.x.toFixed(2)}~${b.max.x.toFixed(2)}, Z ${b.min.z.toFixed(2)}~${b.max.z.toFixed(2)})`,
    );
    const ov = lineVerts(f.plateOutline);
    const oxs = ov.map((v) => v[0]);
    const ozs = ov.map((v) => v[2]);
    check(
      near(Math.min(...oxs), AREA.minX) && near(Math.max(...oxs), AREA.maxX) && near(Math.min(...ozs), AREA.minZ) && near(Math.max(...ozs), AREA.maxZ),
      "② area 있음: 외곽선 = 영역 사각형",
    );
    const { xs: gxs, zs: gzs, verts: gv } = gridAxes(f.grid);
    const inside = gv.length > 0 && gv.every((v) => v[0] >= AREA.minX - 1e-6 && v[0] <= AREA.maxX + 1e-6 && v[2] >= AREA.minZ - 1e-6 && v[2] <= AREA.maxZ + 1e-6);
    check(
      gxs.has("-65.000") && gxs.has("-55.000") && gxs.has("75.000") && !gxs.has("-60.000") && gxs.size === 15 &&
        gzs.has("-32.500") && gzs.has("-22.500") && gzs.has("37.500") && !gzs.has("-30.000") && gzs.size === 8 && inside,
      `② area 있음: 격자는 (minX, minZ) 모서리(베드 10,10)에서 10 mm 간격(세로 −65·−55…75 ${gxs.size}줄 / 가로 −32.5·−22.5…37.5 ${gzs.size}줄), 영역 밖 선 없음`,
    );
    const fv = lineVerts(f.frontMarker);
    const fxs = fv.map((v) => v[0]);
    const fzs = fv.map((v) => v[2]);
    const fcx = (Math.min(...fxs) + Math.max(...fxs)) / 2;
    check(
      near(fcx, (AREA.minX + AREA.maxX) / 2) && near(Math.max(...fzs), AREA.minZ) && Math.min(...fzs) < AREA.minZ,
      `② area 있음: 앞쪽 탭 = 영역 앞변(z ${AREA.minZ}) 중앙(x ${fcx.toFixed(2)})에서 바깥으로`,
    );
    const names = scene.meshes.map((m) => m.name).sort();
    check(
      JSON.stringify(names) === JSON.stringify(["v2_axes", "v2_grid", "v2_plate", "v2_plate_front", "v2_plate_outline"]),
      `② area 있음: 씬 메시 = 평면·외곽선·앞쪽 탭·격자·축 5개 (${names.join(", ")})`,
    );
    const ax = worldBox(f.axes);
    check(near(ax.min.x, 0) && near(ax.min.z, 0), "② area 있음: 원점 좌표축은 world 원점 그대로(모델 좌표 불변)");
    f.dispose();
    check(scene.meshes.length === 0 && scene.materials.length === 0, "② area 있음: dispose 로 메시·머티리얼 전부 정리");
    scene.dispose();
  }
  // area 없음 (기존 프로파일 — 종전)
  {
    const scene = newScene();
    const f = setupMod.addBuildPlateAndGrid(scene, { widthMm: 150, depthMm: 85 });
    const b = worldBox(f.plate);
    check(
      near(b.min.x, -75) && near(b.max.x, 75) && near(b.min.z, -42.5) && near(b.max.z, 42.5),
      `② area 없음: 평면 bbox = 원점 중심 ±75 / ±42.5 (종전) (X ${b.min.x.toFixed(2)}~${b.max.x.toFixed(2)})`,
    );
    const { xs: gxs, zs: gzs } = gridAxes(f.grid);
    check(
      gxs.has("0.000") && gxs.has("70.000") && gxs.has("-70.000") && gxs.size === 15 && gzs.has("0.000") && gzs.has("40.000") && gzs.has("-40.000") && gzs.size === 9,
      `② area 없음: 격자는 원점에서 10 mm 배수(종전 — X 15줄·Z 9줄, 실제 ${gxs.size}·${gzs.size})`,
    );
    const fv = lineVerts(f.frontMarker);
    const fxs = fv.map((v) => v[0]);
    check(near((Math.min(...fxs) + Math.max(...fxs)) / 2, 0) && near(Math.max(...fv.map((v) => v[2])), -42.5), "② area 없음: 앞쪽 탭 = 원점 중심 앞변 z −42.5 (종전)");
    f.dispose();
    scene.dispose();
  }
  // 카메라 reset 중심
  {
    const scene = newScene();
    const cam = new ArcRotateCamera("c", 0, 1, 10, new Vector3(9, 9, 9), scene);
    camMod.resetCameraOnPlate(cam, 140, 75, [5, 5]);
    const t1 = cam.target.clone();
    camMod.resetCameraOnPlate(cam, 150, 85);
    const t2 = cam.target.clone();
    check(
      near(t1.x, 5) && near(t1.y, 0) && near(t1.z, 5) && near(t2.x, 0) && near(t2.z, 0),
      `② resetCameraOnPlate: center [5, 5] → target (${t1.x}, ${t1.y}, ${t1.z}), 없으면 원점 (${t2.x}, ${t2.z})`,
    );
    scene.dispose();
  }
  return res;
}

// ── ① 비대칭 박스 STL ──────────────────────────────────────────────────
//   STL_UP_NOTE (실측, 데모 수정 1차): Babylon STL 로더가 기본 설정(DO_NOT_ALTER_FILE_COORDINATES=false)에서 이미
//   Y/Z 를 바꿔 넣고(STL Z → Babylon Y), stl-loader 1) 의 X −90° 가 그것을 다시 돌려 **STL 의 Y 축이 위**가 된다.
//   그래서 박스는 STL (X 60, Y 10, Z 20) 으로 만든다 — 새 판은 높이 10 으로 눕고, 수정 전 판은 60 > 10×1.5 라 X 를 세운다.
/** 축 정렬 박스 [0,sx]×[0,sy]×[0,sz] 를 바이너리 STL Blob 으로 (법선은 외적, 리틀엔디언 — sample-models 와 같은 형식). */
function boxStlBlob(sx, sy, sz) {
  const P = (x, y, z) => [x * sx, y * sy, z * sz];
  // 면마다 사각형 4점(바깥에서 보아 반시계) → 삼각형 2개
  const quads = [
    [P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)], // −Z
    [P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)], // +Z
    [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)], // −Y
    [P(0, 1, 0), P(0, 1, 1), P(1, 1, 1), P(1, 1, 0)], // +Y
    [P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0)], // −X
    [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)], // +X
  ];
  const tris = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1;
    for (const x of [...n.map((k) => k / len), ...a, ...b, ...c]) {
      dv.setFloat32(o, x, true);
      o += 4;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Blob([buf]);
}

/** ① stl-loader 모듈로 비대칭 박스를 불러 긴 축 확인 */
async function suiteLoader(loaderMod) {
  const { res, check } = makeChecker();
  const scene = newScene();
  const mesh = await loaderMod.loadStlIntoScene(scene, boxStlBlob(60, 10, 20), "box", 0);
  mesh.refreshBoundingInfo();
  const bb = mesh.getBoundingInfo().boundingBox;
  const dx = bb.maximum.x - bb.minimum.x;
  const dy = bb.maximum.y - bb.minimum.y;
  const dz = bb.maximum.z - bb.minimum.z;
  // 긴 축(60)이 X 그대로이고 높이(Y)는 짧은 두 변(10·20) 중 하나 — 축 비율로 세우는 회전이 없다.
  //   (높이가 STL 의 어느 축인지는 이 검사의 관심이 아니다 — 아래 STL_UP_NOTE 참고)
  check(
    near(dx, 60) && near(Math.min(dy, dz), 10) && near(Math.max(dy, dz), 20),
    `① 60 × 10 × 20 박스: 긴 축이 X 그대로 — 세워지지 않음 (X ${dx.toFixed(2)} · Y(높이) ${dy.toFixed(2)} · Z ${dz.toFixed(2)})`,
  );
  check(near(bb.minimum.y, 0), `① 바닥 Y = 0 (리프트 0) (${bb.minimum.y.toFixed(3)})`);
  scene.dispose();
  return res;
}

/** ③ (c) prepareRedesignDetectInput(ctx, stlId) — 지정 모델 / 활성 / 없는 id */
function suiteRedesign(mod) {
  const { res, check } = makeChecker();
  const scene = newScene();
  const a = MeshBuilder.CreateBox("A", { size: 10 }, scene);
  a.position.set(0, 5, 0);
  const b = MeshBuilder.CreateBox("B", { size: 10 }, scene);
  b.position.set(40, 5, 0);
  a.computeWorldMatrix(true);
  b.computeWorldMatrix(true);
  const ctx = {
    sceneRef: { current: scene },
    meshMapRef: { current: new Map([["A", a], ["B", b]]) },
    selectedRef: { current: new Set(["A"]) },
  };
  const xRange = (tri) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < tri.length; i += 3) {
      lo = Math.min(lo, tri[i]);
      hi = Math.max(hi, tri[i]);
    }
    return [lo, hi];
  };
  const pB = mod.prepareRedesignDetectInput(ctx, "B");
  const [bLo, bHi] = pB.ok ? xRange(pB.triangles) : [NaN, NaN];
  check(
    pB.ok && pB.stlId === "B" && near(pB.worldMatrix[12], 40) && near(bLo, 35) && near(bHi, 45),
    `③ stlId "B" 지정(선택은 A): 대상 = B — 삼각형 X ${bLo}~${bHi}, 행렬 이동 X ${pB.ok ? pB.worldMatrix[12] : "-"}`,
  );
  const pA = mod.prepareRedesignDetectInput(ctx);
  check(pA.ok && pA.stlId === "A", `③ stlId 없음: 종전대로 활성(선택 첫 번째) = A (${pA.ok ? pA.stlId : pA.reason})`);
  ctx.selectedRef.current = new Set();
  const pFirst = mod.prepareRedesignDetectInput(ctx);
  check(pFirst.ok && pFirst.stlId === "A", "③ stlId 없음 + 선택 없음: 씬 첫 번째 = A (종전)");
  const pZ = mod.prepareRedesignDetectInput(ctx, "Z");
  check(!pZ.ok && pZ.reason === "선택한 모델이 씬에 없습니다.", `③ 씬에 없는 id: ok:false "선택한 모델이 씬에 없습니다." (${pZ.ok ? "ok" : pZ.reason})`);
  scene.dispose();
  return res;
}

console.log("(1) 기능 검사");
const setupReal = await realMod(REL.setup);
const cameraReal = await realMod(REL.camera);
assertAll(suitePlate(setupReal, cameraReal));
assertAll(await suiteLoader(await realMod(REL.loader)));
assertAll(suiteRedesign(await realMod(REL.redesign)));

console.log("\n(1') 기능 대조군 — 수정 전·변조 구현이 실제로 실패하는가");
// ① 수정 전 stl-loader (git 기준 커밋) — 자동 회전으로 세워져 실패해야 한다.
{
  let before = null;
  try {
    before = execFileSync("git", ["show", `${BASE_COMMIT}:frontend/src/features/v2/utils/stl-loader.ts`], {
      cwd: FRONTEND,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).replace(/\r\n/g, "\n");
  } catch {
    before = null;
  }
  if (!before || !before.includes("autoOrientUpright(mesh);")) {
    // 수정 전 판을 못 꺼내면 대조군이 아무것도 검사하지 못한 것 — 그 자체를 FAIL 로 센다.
    assert(false, `[대조군] ① 수정 전 stl-loader(${BASE_COMMIT}) 를 git 에서 꺼내지 못함 / autoOrientUpright 호출 없음`);
  } else {
    let r;
    try {
      r = await suiteLoader(await importText(before, join(V2, REL.loader)));
    } catch (e) {
      r = [{ ok: false, label: `검사 도중 예외: ${e?.message ?? e}` }];
    }
    assertControl(r, `① 수정 전 stl-loader(${BASE_COMMIT}) — 비대칭 박스를 세움`);
  }
}
await functionalControl("② scene-setup 이 area 를 무시(종전 원점 중심)", REL.setup, [["  const area = opts.area;\n", "  const area = undefined;\n"]], (m) => suitePlate(m, cameraReal));
await functionalControl("② 격자 원점을 world 원점으로(영역 모서리 아님)", REL.setup, [["  const gridOriginX = area ? rectMinX : 0;\n", "  const gridOriginX = 0;\n"]], (m) => suitePlate(m, cameraReal));
await functionalControl("② 앞쪽 탭을 원점 중앙에(영역 중앙 아님)", REL.setup, [["new Vector3(centerX - tabHalfW, outlineY, frontZ),", "new Vector3(-tabHalfW, outlineY, frontZ),"], ["new Vector3(centerX + tabHalfW, outlineY, frontZ),", "new Vector3(tabHalfW, outlineY, frontZ),"]], (m) => suitePlate(m, cameraReal));
await functionalControl("② resetCameraOnPlate 가 center 를 무시", REL.camera, [["  if (center) camera.target.copyFromFloats(center[0], 0, center[1]);\n  else camera.target.copyFrom(Vector3.Zero());\n", "  camera.target.copyFrom(Vector3.Zero());\n"]], (m) => suitePlate(setupReal, m));
await functionalControl("③ prepareRedesignDetectInput 가 stlId 를 무시(종전 — 늘 활성 1개)", REL.redesign, [["  if (stlId !== undefined) {\n", "  if (false) {\n"]], suiteRedesign);
await functionalControl("③ 씬에 없는 id 를 활성 STL 로 대체", REL.redesign, [["    if (!mesh) return { ok: false, reason: \"선택한 모델이 씬에 없습니다.\" };\n    active = { id: stlId, mesh };\n", "    active = mesh ? { id: stlId, mesh } : getActiveStl(ctx);\n"]], suiteRedesign);

// ═════════════════════════════════════════════════════════════════════════
// (2) 소스 검사
// ═════════════════════════════════════════════════════════════════════════

/** v2 하위 .ts/.tsx 전부 (상대 경로 → 텍스트) */
function readTree(dir, base = dir, out = {}) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTree(p, base, out);
    else if (/\.(ts|tsx)$/.test(name)) out[p.slice(base.length + 1).replace(/\\/g, "/")] = readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  }
  return out;
}
const TREE = readTree(V2);
const OUTLINE_HOOK_FILE = join(V2, "components", "babylon", "hooks", "usePrintableAreaOutline.ts");

const WIRE = {
  loader: "utils/stl-loader.ts",
  sample: "utils/sample-models.ts",
  scene: "components/BabylonScene.tsx",
  boot: "components/babylon/hooks/useSceneBootstrap.ts",
  bv: "components/babylon/hooks/useBuildVolumeCheck.ts",
  handle: "components/babylon/handle/redesign-detect-handle.ts",
  types: "components/babylon/babylon-scene-types.ts",
  dental: "pages/viewer/hooks/useDentalWorkflow.ts",
  page: "pages/ViewerV2Page.tsx",
  info: "pages/viewer/components/ViewportInfoPanels.tsx",
  panel: "components/SliceSidePanel.tsx",
  pane: "pages/viewer/components/SliceSectionPane.tsx",
};
const VITE_REL = "vite.config.ts";

// BabylonScene 훅 호출 순서 (불변식 1 — verify-support-follow·verify-safety3 와 같은 목록).
const EXPECTED_SCENE_HOOKS = [
  "useSceneRefs", "useSupportPartsReady", "useSceneBootstrap", "useState", "useFileMeshSync",
  "useSupportMeshSync", "useSelectionSync", "useSlicePreview", "useBridgeVisualization",
  "useEditModeSync", "useDentalBrush", "useBuildVolumeCheck", "useAlignFloorHover", "useImperativeHandle",
];

function wiringChecks(raw) {
  const { res, check } = makeChecker();
  const t = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, k === "vite" ? v : strip(v)]));

  // ① 자동 회전 제거 — 주석까지 포함한 원문에서 0회
  check(count(raw.loader, "autoOrient") === 0 && count(raw.sample, "autoOrient") === 0, "① stl-loader·sample-models 에 autoOrient 0회");
  const iRot = t.loader.indexOf("mesh.rotation.x = -Math.PI / 2;");
  const iBake = t.loader.indexOf("mesh.bakeCurrentTransformIntoVertices();", iRot);
  const iNorm = t.loader.indexOf("mesh.createNormals(true);", iBake);
  const iAlign = t.loader.indexOf("alignMeshToPlate(mesh, liftMm);", iNorm);
  check(
    iRot > 0 && iBake > iRot && iNorm > iBake && iAlign > iNorm && count(t.loader, "bakeCurrentTransformIntoVertices()") === 1,
    "① loadStlIntoScene: X −90° 회전 베이크 1회 → normal 재계산 → 플레이트 정렬 (추가 회전 베이크 없음)",
  );

  // ② 플레이트 = 영역, 주황 테두리 삭제
  const bodyAt = t.scene.indexOf("function BabylonScene(");
  const calls = bodyAt >= 0 ? [...t.scene.slice(bodyAt).matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map((m) => m[1]) : [];
  check(JSON.stringify(calls) === JSON.stringify(EXPECTED_SCENE_HOOKS), `② BabylonScene 훅 호출 순서·개수 불변 (${calls.length}개)`);
  check(/useSceneBootstrap\(\s*ctx,\s*plateWidthMm,\s*plateDepthMm,\s*printableAreaMm\s*\)/.test(t.scene), "② BabylonScene: useSceneBootstrap 4번째 인자 = printableAreaMm");
  check(
    /printableAreaMm: PrintableAreaMm \| null,?\s*\)/.test(t.boot) &&
      /addBuildPlateAndGrid\(scene, \{\s*widthMm: plateWidthMm,\s*depthMm: plateDepthMm,\s*area,\s*\}\)/.test(t.boot) &&
      t.boot.includes("}, [plateWidthMm, plateDepthMm, areaMinX, areaMaxX, areaMinZ, areaMaxZ]);") &&
      !/\}, \[[^\]]*printableAreaMm[^\]]*\]\);/.test(t.boot),
    "② useSceneBootstrap: 영역을 addBuildPlateAndGrid area 로, plate effect deps 는 숫자 4개(객체 아님)",
  );
  check(/resetCameraOnPlate\(\s*camera,\s*area\.maxX - area\.minX,\s*area\.maxZ - area\.minZ,\s*\[/.test(t.boot), "② useSceneBootstrap: 영역이 있으면 카메라 reset 도 영역 중심·크기로");
  check(!t.bv.includes("usePrintableAreaOutline") && count(raw.bv, "usePrintableAreaOutline") === 0, "② useBuildVolumeCheck: 영역 테두리 훅 import·호출 없음");
  check(
    t.bv.includes("collectPrintableAreaIssues(ctx, scene, files, area, plateHeightMm)") && t.bv.includes("onIssuesRef.current?.(issues);"),
    "② 영역 검사·배너 경로 그대로(collectPrintableAreaIssues → onIssues)",
  );
  check(
    between(t.page, "<ViewportInfoPanels", "/>").includes("printableAreaMm={task0PrintableAreaForProfile(printerProfile)}") &&
      t.info.includes("출력 영역") && t.info.includes("printableAreaMm.maxX - printableAreaMm.minX"),
    "② 정보 패널: Task0 면 '출력 영역 (폭) × (깊이) mm' (ViewerV2Page 가 영역을 넘김)",
  );

  // ③ 여러 모델 차례 생성
  check(
    t.handle.includes("prepareRedesignDetectInput(stlId) {") && t.handle.includes("return prepareRedesignDetectInput(ctx, stlId);") &&
      /prepareRedesignDetectInput: \(\s*stlId\?: string,?\s*\) =>/.test(t.types),
    "③ 핸들·타입: prepareRedesignDetectInput(stlId?) 를 그대로 전달",
  );
  const gen = between(t.dental, "const handleGenerateRedesignSupports = useCallback(", "\n  }, [");
  const genDeps = between(t.dental.slice(t.dental.indexOf("const handleGenerateRedesignSupports = useCallback(")), "\n  }, [", "]);");
  const iFor = gen.indexOf("for (const [idx, stlId] of targetIds.entries()) {");
  const iAlive = gen.indexOf("if (!aliveRef.current) return;", iFor);
  const iRun = gen.indexOf("runDetectInWorker(", iFor);
  check(iFor > 0 && iAlive > iFor && iRun > iAlive, "③ 재설계 생성: 대상 목록을 for 루프로 차례로 — 모델마다 이탈 확인 → runDetectInWorker(");
  check(
    gen.includes("files.filter((f) => selectedIds.has(f.id)).map((f) => f.id)") && gen.includes("picked.length > 1 ? picked : [undefined]"),
    "③ 대상 = 두 개 이상 선택이면 files 순서대로 선택 모델, 아니면 [undefined](종전 활성 1개)",
  );
  check(/runDetectInWorker\(\s*stlId,/.test(gen), "③ 모델마다 runDetectInWorker(stlId, …) 로 그 모델을 검출");
  check(
    gen.includes("if (!multi || e instanceof DetectCancelError) throw e;") && gen.includes('if (outcome.kind === "cancelled") return;'),
    "③ 검출 취소·뷰어 이탈은 전체 중단, 그 밖의 실패는 그 모델만 건너뜀",
  );
  check(count(gen, "skipped.push(") >= 4 && gen.includes("건너뛴 모델") && gen.includes("(되돌리기는 모델별)"), "③ 여러 모델 문구: 건너뛴 모델 이름·사유 + '(되돌리기는 모델별)'");
  check(/\bfiles,/.test(genDeps) && /\bselectedIds,/.test(genDeps), "③ 규칙 7: handleGenerateRedesignSupports deps 에 files·selectedIds");
  const dentalCall = between(t.page, "useDentalWorkflow({", "});");
  check(/\bselectedIds,/.test(dentalCall) && /\bfiles,/.test(dentalCall), "③ ViewerV2Page: useDentalWorkflow 에 selectedIds·files 전달");
  const dbg = between(t.dental, "const handleRunRedesignDetect = useCallback(", "\n  }, [");
  check(dbg.includes("await runDetectInWorker();"), "③ 디버그 '재설계 검출·점생성'은 종전(활성 1개) 그대로");

  // ④ Vite optimizeDeps
  check(
    /optimizeDeps:\s*\{/.test(t.vite) && /entries:\s*\[[^\]]*'src\/features\/v2\/workers\/\*\.ts'[^\]]*\]/.test(t.vite) &&
      /include:\s*\[[^\]]*'js-clipper'[^\]]*\]/.test(t.vite),
    "④ vite.config: optimizeDeps entries 에 워커(src/features/v2/workers/*.ts), include 에 js-clipper",
  );

  // ⑤ 캡션 px·1bpp 삭제
  check(count(raw.panel, "px)") === 0 && count(raw.panel, "1bpp") === 0 && t.panel.includes('"단면 마스크 (흰 = 노광 영역)"'), "⑤ SliceSidePanel: 캡션에 px)·1bpp 없음, '단면 마스크 (흰 = 노광 영역)'");
  check(
    !/\{widthPx\}×\{heightPx\}px/.test(t.pane) && count(raw.pane, "1bpp") === 0 && t.pane.includes("단면 마스크 (흰 = 노광 영역)") &&
      t.pane.includes("widthPx={widthPx}") && t.pane.includes("const MASK_MAX_PX = 512;"),
    "⑤ SliceSectionPane: 캡션에 해상도 px·1bpp 없음(래스터 상한 512·크기 계산은 그대로)",
  );
  return res;
}

console.log("\n(2) 소스 검사");
assert(count(Object.values(TREE).join("\n"), "autoOrient") === 0, `① v2 전체(${Object.keys(TREE).length}개 파일)에 autoOrient 0회`);
assert(
  !existsSync(OUTLINE_HOOK_FILE) && count(Object.values(TREE).join("\n"), "usePrintableAreaOutline") === 0,
  "② 영역 주황 테두리 훅 파일 삭제 + v2 전체 참조 0회",
);
const wireTexts = {
  ...Object.fromEntries(Object.entries(WIRE).map(([k, rel]) => [k, readV2(rel)])),
  vite: readFileSync(join(FRONTEND, VITE_REL), "utf8").replace(/\r\n/g, "\n"),
};
assertAll(wiringChecks(wireTexts));

console.log("\n(2') 소스 대조군 — 핵심 문자열을 지우거나 뒤집은 판이 실제로 실패하는가");
function wireControl(label, key, from, to) {
  if (!wireTexts[key].includes(from)) {
    // 변조 대상 문자열이 소스에 없으면 대조군이 아무것도 검사하지 못한 것 — 그 자체를 FAIL 로 센다(공허한 PASS 방지).
    assert(false, `[대조군] ${label} — 변조 대상 없음 ${WIRE[key] ?? VITE_REL} — ${JSON.stringify(from.slice(0, 60))}`);
    return;
  }
  assertControl(wiringChecks({ ...wireTexts, [key]: wireTexts[key].replace(from, to) }), label);
}
wireControl("① 자동 회전 호출 되살림", "loader", "  // 1.7) bakeCurrentTransformIntoVertices", "  autoOrientUpright(mesh);\n  // 1.7) bakeCurrentTransformIntoVertices");
wireControl("② useSceneBootstrap 에 영역 인자 안 넘김(종전)", "scene", "useSceneBootstrap(ctx, plateWidthMm, plateDepthMm, printableAreaMm);", "useSceneBootstrap(ctx, plateWidthMm, plateDepthMm);");
wireControl("② BabylonScene 훅 하나 추가(불변식 1 위반)", "scene", "    const ctx = useSceneRefs(props);\n", "    const ctx = useSceneRefs(props);\n    useState(0);\n");
wireControl("② plate effect deps 에 객체(매 렌더 재생성)", "boot", "}, [plateWidthMm, plateDepthMm, areaMinX, areaMaxX, areaMinZ, areaMaxZ]);", "}, [plateWidthMm, plateDepthMm, printableAreaMm]);");
wireControl("② 영역을 addBuildPlateAndGrid 에 안 넘김", "boot", "      depthMm: plateDepthMm,\n      area,\n", "      depthMm: plateDepthMm,\n");
wireControl("② 주황 테두리 훅 되살림", "bv", "    partsReadyDep,\n  ]);\n}", "    partsReadyDep,\n  ]);\n  usePrintableAreaOutline(ctx, area);\n}");
wireControl("② 영역 검사 제거", "bv", "collectPrintableAreaIssues(ctx, scene, files, area, plateHeightMm)", "[]");
wireControl("② 정보 패널에 영역 안 넘김(종전 '플레이트 150 × 85')", "page", "              printableAreaMm={task0PrintableAreaForProfile(printerProfile)}\n              supportSummary", "              supportSummary");
wireControl("③ 핸들이 stlId 를 버림", "handle", "return prepareRedesignDetectInput(ctx, stlId);", "return prepareRedesignDetectInput(ctx);");
wireControl("③ 루프 없이 첫 모델만(종전)", "dental", "for (const [idx, stlId] of targetIds.entries()) {", "{ const [idx, stlId] = [0, targetIds[0]];");
wireControl("③ 모델 지정 없이 검출(늘 활성 1개)", "dental", "          const run = await runDetectInWorker(\n            stlId,\n", "          const run = await runDetectInWorker(\n            undefined,\n");
wireControl("③ 루프 중 이탈 확인 없음", "dental", "        if (!aliveRef.current) return;\n", "");
wireControl("③ 검출 취소에도 다음 모델 계속", "dental", "if (!multi || e instanceof DetectCancelError) throw e;", "if (!multi) throw e;");
wireControl("③ deps 에서 selectedIds 누락(규칙 7)", "dental", "    files,\n    selectedIds,\n", "    files,\n");
wireControl("③ ViewerV2Page 가 selectedIds 를 안 넘김", "page", "    selectedIds,\n    files,\n  });", "    files,\n  });");
wireControl("④ include 에서 js-clipper 빠짐", "vite", "include: ['js-clipper', '@babylonjs/core'],", "include: ['@babylonjs/core'],");
wireControl("④ entries 에 워커 없음", "vite", "entries: ['index.html', 'src/features/v2/workers/*.ts'],", "entries: ['index.html'],");
wireControl("⑤ 패널 캡션 되살림(LCD 1bpp)", "panel", '"단면 마스크 (흰 = 노광 영역)"', '"LCD 1bpp 마스크 (흰 = 모델 영역)"');
wireControl("⑤ 단면 pane 캡션에 px 되살림", "pane", "          단면 마스크 (흰 = 노광 영역)\n", "          단면 마스크 (흰 = 노광 영역) · {widthPx}×{heightPx}px\n");

engine.dispose();
rmSync(TMP_ROOT, { recursive: true, force: true });
console.log(failed === 0 ? "\n=== 전부 PASS ===" : `\n=== FAIL ${failed}건 ===`);
process.exit(failed === 0 ? 0 : 1);
