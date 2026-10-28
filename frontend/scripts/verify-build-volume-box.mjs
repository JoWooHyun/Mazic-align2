// verify-build-volume-box — #7 빌드 볼륨 철사 상자 (2026-10-28)
//
// 실행: cd frontend && npx tsx scripts/verify-build-volume-box.mjs   (판정 = exit code)
//
// 검사:
//   (1) 기능 — 실제 utils/scene-setup.ts addBuildPlateAndGrid 를 Babylon NullEngine 씬에서 돌린다:
//       (a) Task0 영역 + heightMm 120 → v2_volume_box 하나: 세로 모서리 4(바닥 → 120, 영역 네 모서리) + 윗면 사각형(y 120),
//           선택 불가, 씬 메시 6개, dispose 로 전부 정리
//       (b) 영역 없음 + heightMm 50 → 원점 중심 ±75 / ±42.5 네 모서리
//       (c) heightMm 0·없음 → volumeBox null, 씬 메시 5개(종전 그대로)
//       (d) 플레이트 긴 변 × VOLUME_BOX_MAX_HEIGHT_RATIO 경계 — 같으면 그림, 넘으면(Task0 2000 mm) 안 그림
//   (2) 배선(소스) — ViewerV2Page plateHeightMm = buildVolumeMm[2] → BabylonScene → useSceneBootstrap 5번째 인자 →
//       addBuildPlateAndGrid heightMm, plate effect deps 에 plateHeightMm
//   (3) 대조군 — 수정 전 scene-setup(git fe8cf25) 과 변조 2종(윗면 빠짐·높이 무시)은 (1) 에서 실패해야 한다
//       (임시 사본을 같은 폴더에 써서 import — @babylonjs/core 해석을 위해. 끝나면 지운다)

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONT = join(HERE, "..");
const V2 = join(FRONT, "src", "features", "v2");
const SETUP_REL = "utils/scene-setup.ts";
/** 수정 전 기준 — 메인라인 fe8cf25 (#156 머지, 상자 없음) */
const BEFORE_COMMIT = "fe8cf25";

let failed = 0;
function assert(ok, label) {
  console.log(`  ${ok ? "ok" : "FAIL"}: ${label}`);
  if (!ok) failed++;
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const { NullEngine, Scene, VertexBuffer } = await import("@babylonjs/core");
const engine = new NullEngine();

/** 선 메시 정점 [[x,y,z], ...] */
function lineVerts(mesh) {
  const p = mesh.getVerticesData(VertexBuffer.PositionKind) ?? [];
  const out = [];
  for (let i = 0; i < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]]);
  return out;
}

/** 상자 정점이 "rect 네 모서리 세로선 4 + 윗면 사각형" 인지 — 문제 목록(빈 배열 = 통과) */
function boxProblems(box, rect, h) {
  const probs = [];
  if (!box) return ["volumeBox 없음"];
  if (box.name !== "v2_volume_box") probs.push(`이름 ${box.name}`);
  if (box.isPickable) probs.push("선택 가능");
  const v = lineVerts(box);
  const xs = [rect.minX, rect.maxX];
  const zs = [rect.minZ, rect.maxZ];
  const onCorner = (p) => xs.some((x) => near(p[0], x)) && zs.some((z) => near(p[2], z));
  if (!v.every(onCorner)) probs.push("모서리 밖 정점");
  const ys = v.map((p) => p[1]);
  if (!near(Math.max(...ys), h)) probs.push(`최고 y ${Math.max(...ys)} ≠ ${h}`);
  if (!(Math.min(...ys) >= 0 && Math.min(...ys) < 0.1)) probs.push(`최저 y ${Math.min(...ys)} (바닥 근처여야)`);
  // 네 모서리마다 바닥 근처 점과 꼭대기 점이 둘 다 있어야 (세로 모서리)
  for (const x of xs) for (const z of zs) {
    const at = v.filter((p) => near(p[0], x) && near(p[2], z));
    if (!at.some((p) => p[1] < 0.1) || !at.some((p) => near(p[1], h))) probs.push(`모서리 (${x}, ${z}) 세로선 없음`);
  }
  // 윗면: 꼭대기 점이 네 모서리 전부에 있고, 세로선 4개의 꼭대기(4) 말고도 윗면 사각형 점(5)이 있다 → 꼭대기 점 ≥ 9
  const topPts = v.filter((p) => near(p[1], h));
  if (topPts.length < 9) probs.push(`꼭대기 점 ${topPts.length} (윗면 사각형 없음?)`);
  return probs;
}

const AREA = { minX: -65, maxX: 75, minZ: -32.5, maxZ: 42.5 };

/** (1) 기능 검사 — 결과 [{ok,label}] */
function suite(mod) {
  const res = [];
  const check = (ok, label) => res.push({ ok, label });
  // (a) 영역 + 높이
  {
    const scene = new Scene(engine);
    const f = mod.addBuildPlateAndGrid(scene, { widthMm: 150, depthMm: 85, area: AREA, heightMm: 120 });
    const p = boxProblems(f.volumeBox, AREA, 120);
    check(p.length === 0, `(a) 영역 + 120 mm: 세로 모서리 4 + 윗면(y 120), 선택 불가 ${p.length ? "— " + p.join(", ") : ""}`);
    const names = scene.meshes.map((m) => m.name).sort();
    check(
      JSON.stringify(names) === JSON.stringify(["v2_axes", "v2_grid", "v2_plate", "v2_plate_front", "v2_plate_outline", "v2_volume_box"]),
      `(a) 씬 메시 6개 (${names.join(", ")})`,
    );
    f.dispose();
    check(scene.meshes.length === 0 && scene.materials.length === 0, "(a) dispose 로 상자까지 메시·머티리얼 전부 정리");
    scene.dispose();
  }
  // (b) 영역 없음 + 높이
  {
    const scene = new Scene(engine);
    const f = mod.addBuildPlateAndGrid(scene, { widthMm: 150, depthMm: 85, heightMm: 50 });
    const p = boxProblems(f.volumeBox, { minX: -75, maxX: 75, minZ: -42.5, maxZ: 42.5 }, 50);
    check(p.length === 0, `(b) 영역 없음 + 50 mm: 원점 중심 ±75 / ±42.5 상자 ${p.length ? "— " + p.join(", ") : ""}`);
    f.dispose();
    scene.dispose();
  }
  // (c) 높이 0 / 없음 → 종전
  for (const h of [0, undefined]) {
    const scene = new Scene(engine);
    const f = mod.addBuildPlateAndGrid(scene, { widthMm: 150, depthMm: 85, area: AREA, ...(h === undefined ? {} : { heightMm: h }) });
    check(f.volumeBox === null && scene.meshes.length === 5, `(c) heightMm ${h}: 상자 없음 · 씬 메시 5개(종전)`);
    f.dispose();
    scene.dispose();
  }
  // (d) 높이 상한 — Task0 영역 긴 변 140 mm × 4 = 560
  {
    const scene = new Scene(engine);
    const at = mod.addBuildPlateAndGrid(scene, { widthMm: 150, depthMm: 85, area: AREA, heightMm: 560 });
    check(boxProblems(at.volumeBox, AREA, 560).length === 0, "(d) 높이 = 긴 변 140 × 4 = 560 mm → 그림");
    at.dispose();
    const task0 = mod.addBuildPlateAndGrid(scene, { widthMm: 150, depthMm: 85, area: AREA, heightMm: 2000 });
    check(task0.volumeBox === null && scene.meshes.length === 5, "(d) Task0 높이 2000 mm(Z 이송 범위) → 안 그림(2 m 기둥 방지)");
    task0.dispose();
    scene.dispose();
  }
  return res;
}

// ── (1) 실제 구현 ──
console.log("(1) 기능 — 실제 scene-setup");
const real = await import(pathToFileURL(join(V2, SETUP_REL)).href);
for (const r of suite(real)) assert(r.ok, r.label);

// ── (2) 배선(소스) ──
console.log("\n(2) 배선(소스)");
const read = (...p) => readFileSync(join(V2, ...p), "utf8");
const page = read("pages", "ViewerV2Page.tsx");
const sceneSrc = read("components", "BabylonScene.tsx");
const boot = read("components", "babylon", "hooks", "useSceneBootstrap.ts");
assert(/plateHeightMm=\{printerProfile\.buildVolumeMm\[2\]\}/.test(page), "ViewerV2Page: plateHeightMm = 프로파일 buildVolumeMm[2]");
assert(
  /useSceneBootstrap\(\s*ctx,\s*plateWidthMm,\s*plateDepthMm,\s*printableAreaMm,\s*plateHeightMm\s*\)/.test(sceneSrc),
  "BabylonScene: useSceneBootstrap 5번째 인자 = plateHeightMm (훅 호출 순서·개수는 verify-demo-fix1 이 본다)",
);
assert(
  /plateHeightMm = 0,\s*\): void/.test(boot) &&
    /addBuildPlateAndGrid\(scene, \{\s*widthMm: plateWidthMm,\s*depthMm: plateDepthMm,\s*area,\s*heightMm: plateHeightMm,\s*\}\)/.test(boot) &&
    boot.includes("}, [plateWidthMm, plateDepthMm, plateHeightMm, areaMinX, areaMaxX, areaMinZ, areaMaxZ]);"),
  "useSceneBootstrap: heightMm 전달 · plate effect deps 에 plateHeightMm (높이 바꾸면 상자 다시 그림)",
);

// ── (3) 대조군 ──
console.log("\n(3) 대조군 — 수정 전·변조 구현은 (1) 에서 실패해야 한다");
const realSrc = readFileSync(join(V2, SETUP_REL), "utf8");
let beforeSrc = null;
try {
  beforeSrc = execFileSync("git", ["show", `${BEFORE_COMMIT}:frontend/src/features/v2/${SETUP_REL}`], { cwd: FRONT, encoding: "utf8" });
} catch {
  console.log(`  SKIP: git ${BEFORE_COMMIT} 을 못 읽음(얕은 클론 등) — 수정 전 대조군 생략`);
}
const mutants = [
  ["수정 전(git " + BEFORE_COMMIT + " — 상자 없음)", beforeSrc],
  ["윗면 사각형 빠짐", realSrc.replace("boxLines.push([...corners, corners[0]]", "void ([...corners, corners[0]]")],
  ["높이 무시(꼭대기 = 10 mm 고정)", realSrc.replace("const top = heightMm;", "const top = 10;")],
  ["높이 상한 없음(Task0 2 m 기둥)", realSrc.replace("if (heightMm > 0 && heightMm <= Math.max(rectW, rectD) * VOLUME_BOX_MAX_HEIGHT_RATIO) {", "if (heightMm > 0) {")],
];
let n = 0;
for (const [label, src] of mutants) {
  if (src === null) continue;
  if (src === realSrc) {
    assert(false, `대조군 ${label}: 변조 문자열을 못 찾음(구현이 바뀌었으면 이 스크립트도 갱신)`);
    continue;
  }
  const tmp = join(V2, "utils", `scene-setup.__control${n++}.ts`);
  writeFileSync(tmp, src);
  let r;
  try {
    r = suite(await import(pathToFileURL(tmp).href));
  } catch (e) {
    r = [{ ok: false, label: `예외 ${e?.message ?? e}` }];
  } finally {
    rmSync(tmp, { force: true });
  }
  const caught = r.some((x) => !x.ok);
  assert(caught, `대조군 ${label} → 검사가 실패한다(변조를 잡는다)`);
}

engine.dispose();
console.log(failed === 0 ? "\n결과: 전부 통과" : `\n결과: 실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);
