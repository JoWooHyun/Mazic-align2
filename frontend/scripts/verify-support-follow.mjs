// 모델을 옮겼을 때 서포트 메시가 따라오는가 — rebuild key 헤드리스 검증
//   (데모 사고 방지 1차 A·B).
//
//   결함(A): world 저장 서포트(자동·수동·브릿지 등, coordSpace !== 'stl-local')는
//     rebuild key 를 `inv(현재 STL world) × 저장 world` 로 로컬화해 만들었다. 모델
//     transform 커밋(useTransformCommit)이 저장 world 좌표를 같은 변환으로 patch
//     하면 새 world 를 새 역행렬로 로컬화한 값이 **그대로**라 key 가 안 바뀌고,
//     parent 없는 world 점도 skip 하는 조건 때문에 메시가 옛 자리에 남았다
//     (슬라이스·내보내기도 메시를 읽어 옛 자리로 나감).
//   수정: world 점은 저장 world 좌표를 그대로 key 에 쓴다(support-key-inputs.ts).
//
//   이 스크립트는 훅(useSupportMeshSync)이 실제로 부르는 순수 함수
//   `buildSupportRebuildKey` 를 그대로 import 해 판정한다. 커밋 patch 는
//   useTransformCommit 과 같은 `transformPointBetween`(실제 모듈)으로 만든다.
//   STL world 행렬은 `matrixFromTransform`(applyTransformToMesh 와 같은 합성).
//
//   실행: npx tsx scripts/verify-support-follow.mjs
//   ⚠️ plain node 로 돌리면 확장자 없는 TS import 를 못 풀어 오탐이 난다(CLAUDE.md).
//   판정은 **exit code** 로 — (g) 대조군 절은 정상일 때도 "결함 재현" 문자열을 낸다.
//
//   ★ 대조군 원칙(프로젝트 규약):
//     (g) 수정 전(4f2df2a) key 계산(world 점 로컬화)을 이 스크립트 안에 그대로
//         재현해 (a) 의 "옮기면 key 가 바뀐다" 단언이 그때는 **실제로 깨지는지**
//         확인한다. 안 깨지면 이 스크립트가 결함을 못 잡는다는 뜻이므로 FAIL 로 센다.
//     (c) stl-local 점은 수정 전 계산과 **바이트 단위로 같은 key** 를 내는지 여러
//         행렬에서 대조한다(B-2·B-18 무회귀).
//     (f) 훅·씬 배선(meshLoadTick deps, 훅 호출 순서)은 소스 정적 검사로 본다 —
//         수정 전 소스에서는 meshLoadTick 항목이 FAIL 한다.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Matrix, Vector3 } from "@babylonjs/core";

import {
  buildSupportRebuildKey,
  resolveSupportKeyInputs,
} from "../src/features/v2/components/babylon/support-key-inputs.ts";
import { buildSupportKey } from "../src/features/v2/components/babylon/support-keys.ts";
import {
  matrixFromTransform,
  transformPointBetween,
} from "../src/features/v2/utils/transform.ts";
import { IDENTITY_TRANSFORM } from "../src/features/v2/types/transform.ts";
import { DEFAULT_SUPPORT_PARAMS } from "../src/features/v2/support/utils/defaults.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const V2 = join(__dirname, "..", "src", "features", "v2");

// ── assert 유틸 ──────────────────────────────────────────────────────────
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

const params = DEFAULT_SUPPORT_PARAMS;

/** useSupportMeshSync.isRedesignPoint 와 같은 판정. */
const isRedesign = (p) => p.kind === "island" || p.kind === "slope";

/** 훅이 점마다 하는 계산 그대로 (stlWorld = STL 메시의 현재 world 행렬). */
function hookKey(point, t, { meshLoaded = true, clipReady = meshLoaded } = {}) {
  const stlWorld = meshLoaded ? matrixFromTransform(t) : null;
  return buildSupportRebuildKey(
    point,
    params,
    stlWorld,
    isRedesign(point),
    clipReady,
  );
}

/**
 * 수정 전(4f2df2a) useSupportMeshSync 루프의 key 계산 복제 — 대조군 전용.
 *   world 점은 inv(world) 로 로컬화, stl-local 점은 저장값 그대로 + 재설계만 world Y.
 */
function legacyKey(point, t, { meshLoaded = true } = {}) {
  const stlWorld = meshLoaded ? matrixFromTransform(t) : null;
  const inv = stlWorld ? Matrix.Invert(stlWorld) : null;
  const toLocal = (w) => {
    if (!inv) return w;
    const v = Vector3.TransformCoordinates(new Vector3(w[0], w[1], w[2]), inv);
    return [v.x, v.y, v.z];
  };
  const isLocal = point.coordSpace === "stl-local";
  const lc = isLocal ? point.contact : toLocal(point.contact);
  const lb = isLocal ? point.base : toLocal(point.base);
  const lcps = point.curveControlPoints
    ? isLocal
      ? point.curveControlPoints
      : point.curveControlPoints.map(toLocal)
    : null;
  const surfaceWorldY =
    isRedesign(point) && stlWorld && isLocal
      ? Vector3.TransformCoordinates(
          new Vector3(point.contact[0], point.contact[1], point.contact[2]),
          stlWorld,
        ).y
      : undefined;
  return buildSupportKey(point, params, lc, lb, lcps, surfaceWorldY);
}

/** STL local 점 → world (t 적용). */
function toWorld(t, p) {
  const v = Vector3.TransformCoordinates(
    new Vector3(p[0], p[1], p[2]),
    matrixFromTransform(t),
  );
  return [v.x, v.y, v.z];
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * useTransformCommit 의 affected patch 복제 (contact 쪽 STL = 옮긴 STL).
 *   단점/auto/manual: contact 변환 + base = 새 contact 수직 아래 바닥(Y=0 가정 —
 *   findSurfaceBelow 가 아래에 다른 모델이 없으면 0).
 *   bridge: 같은 STL 에 걸린 끝점·변곡점 모두 변환.
 */
function commitPatch(sup, start, end) {
  const contact = transformPointBetween(sup.contact, start, end);
  if (sup.source === "bridge") {
    return {
      ...sup,
      contact,
      base: transformPointBetween(sup.base, start, end),
      curveControlPoints: sup.curveControlPoints?.map((cp) =>
        transformPointBetween(cp, start, end),
      ),
    };
  }
  return { ...sup, contact, base: [contact[0], 0, contact[2]] };
}

const T = (o) => ({ ...IDENTITY_TRANSFORM, ...o });

// 시작 자세: 이미 한 번 옮기고 Y 로 돌려 놓은 모델 (원점·항등이면 결함이 가려진다).
const T0 = T({ tx: 5, ty: 0, tz: -3, ry: 30 });
const MOVES = [
  ["몸통 드래그(수평 이동)", T({ tx: 17, ty: 0, tz: -9, ry: 30 })],
  ["수치 입력(수직축 회전)", T({ tx: 5, ty: 0, tz: -3, ry: 75 })],
  ["수치 입력(수직 이동)", T({ tx: 5, ty: 4, tz: -3, ry: 30 })],
  ["기즈모(기울임 회전)", T({ tx: 5, ty: 0, tz: -3, rx: 20, ry: 30 })],
];

// world 저장 점들 — 저장 좌표는 T0 아래 STL local 점을 world 로 올린 값.
const localContact = [2.2, 7.4, -1.6];
const wContact = toWorld(T0, localContact);
const autoPt = {
  id: "auto-1",
  stlId: "stl-A",
  source: "auto",
  contact: wContact,
  base: [wContact[0], 0, wContact[2]],
};
const bridgePt = {
  id: "bridge-1",
  stlId: "stl-A",
  baseStlId: "stl-A",
  source: "bridge",
  contact: wContact,
  base: toWorld(T0, [-3.1, 4.3, 2.7]),
  curveControlPoints: [
    toWorld(T0, [-1.9, 8.2, 1.4]),
    toWorld(T0, [0.4, 9.1, 0.3]),
    toWorld(T0, [1.6, 8.6, -0.8]),
  ],
};
// 활성 STL 부재로 coordSpace 미지정(world)인 채 저장된 재설계 점 (useTransformCommit 주석).
const worldRedesignPt = {
  id: "rd-world",
  stlId: "stl-A",
  source: "auto",
  kind: "island",
  contact: wContact,
  base: [wContact[0], 0, wContact[2]],
};
const WORLD_POINTS = [
  ["auto(world)", autoPt],
  ["bridge(world)", bridgePt],
  ["재설계(world 저장)", worldRedesignPt],
];

// stl-local 점들 — 저장 좌표가 STL local.
const localAuto = {
  id: "local-auto",
  stlId: "stl-A",
  source: "auto",
  coordSpace: "stl-local",
  contact: localContact,
  base: [2.2, 0, -1.6],
};
const localRedesign = {
  id: "local-island",
  stlId: "stl-A",
  source: "auto",
  kind: "island",
  coordSpace: "stl-local",
  tipRadius: 0.25,
  contact: localContact,
  base: [2.2, 0, -1.6],
};
const localBridge = {
  ...bridgePt,
  id: "local-bridge",
  coordSpace: "stl-local",
  contact: localContact,
  base: [-3.1, 4.3, 2.7],
  curveControlPoints: [[-1.9, 8.2, 1.4]],
};

console.log("=== 서포트 추종 rebuild key 검증 (데모 사고 방지 1차) ===");

// ── (a) world 점: 모델을 옮기고 커밋 patch → key 가 바뀐다 (= 새 자리에서 재생성) ──
console.log("\n(a) world 점 — 옮기고 저장 좌표 patch 하면 key 가 달라진다:");
for (const [pname, pt] of WORLD_POINTS) {
  const before = hookKey(pt, T0);
  for (const [mname, T1] of MOVES) {
    const moved = commitPatch(pt, T0, T1);
    // 시험이 공허하지 않은지 — patch 가 실제로 접점을 옮겼어야 한다.
    const d = dist(moved.contact, pt.contact);
    const after = hookKey(moved, T1);
    assert(
      d > 0.5 && after !== before,
      `${pname} · ${mname}: 접점 ${d.toFixed(2)}mm 이동 → key 변경`,
    );
  }
}
{
  // undo: 모델·좌표를 되돌리면 key 가 원래 값으로 돌아와 옛 자리에서 재생성된다.
  const [, T1] = MOVES[0];
  const moved = commitPatch(autoPt, T0, T1);
  const undone = { ...moved, contact: autoPt.contact, base: autoPt.base };
  assert(
    hookKey(undone, T0) === hookKey(autoPt, T0) &&
      hookKey(undone, T0) !== hookKey(moved, T1),
    "undo(좌표 복원) → key 가 원래 값으로 복귀 (옮긴 key 와 다름 → 재생성)",
  );
}

// ── (b) world 점: 바뀐 것이 없으면 key 같다 (skip 유지 = rebuild 1회 원칙) ─────
console.log("\n(b) world 점 — 저장 좌표가 그대로면 key 같다 (skip 유지):");
for (const [pname, pt] of WORLD_POINTS) {
  // DB refresh 로 값이 같은 새 객체가 와도(참조만 바뀜) key 동일.
  const clone = structuredClone(pt);
  assert(
    hookKey(clone, T0) === hookKey(pt, T0),
    `${pname}: 값이 같은 새 객체 → key 같음`,
  );
  // STL 행렬만 먼저 바뀌고 patch 는 아직(files refresh 가 supports refresh 보다
  //   먼저 도착해 effect 가 도는 경우) → key 같음. 재생성은 patch 도착 때 1회.
  for (const [mname, T1] of MOVES) {
    assert(
      hookKey(pt, T1) === hookKey(pt, T0),
      `${pname} · ${mname}: patch 전(STL 행렬만 변경) → key 같음`,
    );
  }
  // 메시가 아직 없을 때(재오픈 직후)와 로드 후 — 비브릿지 world 점은 STL 메시와
  //   무관한 형상이라 key 가 같아야 한다(불필요한 일괄 재생성 0).
  if (pt.source !== "bridge") {
    assert(
      hookKey(pt, T0, { meshLoaded: false }) === hookKey(pt, T0),
      `${pname}: STL 미로드 ↔ 로드 후 key 같음 (형상이 STL 메시와 무관)`,
    );
  }
}

// ── (c) stl-local 점: 모델을 옮겨도 key 같다 (B-2) + 수정 전과 바이트 동일 ─────
console.log("\n(c) stl-local 점 — 옮겨도 key 같음(B-2), 수정 전 key 와 바이트 동일:");
{
  const base = hookKey(localAuto, T0);
  for (const [mname, T1] of MOVES) {
    assert(
      hookKey(localAuto, T1) === base,
      `stl-local auto · ${mname} → key 같음 (parent auto-follow, 재생성 0)`,
    );
  }
  assert(
    hookKey(localBridge, MOVES[1][1]) === hookKey(localBridge, T0),
    "stl-local bridge · 수직축 회전 → key 같음",
  );
  // 수정 전 계산과 바이트 대조 — 여러 행렬·메시 유무·clip 표식 유무 전부.
  let same = 0;
  let total = 0;
  for (const pt of [localAuto, localRedesign, localBridge]) {
    for (const t of [T0, IDENTITY_TRANSFORM, ...MOVES.map((m) => m[1])]) {
      for (const meshLoaded of [true, false]) {
        for (const clipReady of [true, false]) {
          total++;
          if (
            hookKey(pt, t, { meshLoaded, clipReady }) ===
            legacyKey(pt, t, { meshLoaded })
          ) {
            same++;
          }
        }
      }
    }
  }
  assert(
    same === total,
    `stl-local 3종 × 행렬 6 × 메시유무 × clip표식 = ${total}건 중 ${same}건이 수정 전 key 와 바이트 동일`,
  );
  // 입력 함수 자체도 저장 좌표를 그대로 돌려준다 (이중 로컬화 없음).
  const k = resolveSupportKeyInputs(localAuto, matrixFromTransform(T0), false);
  assert(
    k.contact === localAuto.contact && k.base === localAuto.base && k.surfaceWorldY === undefined,
    "resolveSupportKeyInputs: stl-local 비재설계 점은 저장 좌표 그대로, world Y 없음",
  );
}

// ── (d) stl-local 재설계 점: 수직 이동 → key 변경, 수평 이동 → 같음 (B-18) ─────
console.log("\n(d) stl-local 재설계 점 — 수직 이동만 재조립 (B-18 보존):");
{
  const R0 = T({ tx: 3, ty: 2, tz: -1 });
  const k0 = hookKey(localRedesign, R0);
  const up = hookKey(localRedesign, T({ tx: 3, ty: 5, tz: -1 }));
  const down = hookKey(localRedesign, T({ tx: 3, ty: 0.5, tz: -1 }));
  const side = hookKey(localRedesign, T({ tx: 13, ty: 2, tz: -5 }));
  assert(up !== k0, "수직 이동(ty +3) → key 변경 (기둥 길이 재조립)");
  assert(down !== k0, "수직 이동(ty −1.5) → key 변경");
  assert(side === k0, "수평 이동(tx +10, tz −4) → key 같음 (parent auto-follow)");
  const k = resolveSupportKeyInputs(localRedesign, matrixFromTransform(R0), true);
  assert(
    k.surfaceWorldY !== undefined && Math.abs(k.surfaceWorldY - (7.4 + 2)) < 1e-4,
    `surfaceWorldY = 접점 world Y (${k.surfaceWorldY?.toFixed(4)} ≈ 9.4000)`,
  );
  // 메시 미로드(재오픈 직후) → world Y 없음 → 로드 후 key 가 달라져 재조립 (B 경로).
  assert(
    hookKey(localRedesign, R0, { meshLoaded: false }) !== k0,
    "STL 미로드 → 로드 후 key 변경 (meshLoadTick 재실행 때 올바른 자리로 재조립)",
  );
}

// ── (e) world 브릿지: clip 준비 여부 표식 ──────────────────────────────────
console.log("\n(e) world 브릿지 — STL 로드로 clip 가능해지면 key 변경, 그 외 점은 무관:");
{
  assert(
    hookKey(bridgePt, T0, { meshLoaded: false, clipReady: false }) !==
      hookKey(bridgePt, T0, { meshLoaded: true, clipReady: true }),
    "world bridge: clip 불가 → 가능 이 되면 key 변경 (재오픈 후 깎기 재시도)",
  );
  assert(
    hookKey(bridgePt, T0, { clipReady: true }) ===
      hookKey(structuredClone(bridgePt), MOVES[1][1], { clipReady: true }),
    "world bridge: clip 준비 상태가 같고 좌표가 같으면 key 같음",
  );
  assert(
    hookKey(autoPt, T0, { clipReady: true }) ===
      hookKey(autoPt, T0, { clipReady: false }),
    "비브릿지 world 점: clip 표식이 key 에 영향 없음",
  );
  assert(
    hookKey(localBridge, T0, { clipReady: true }) ===
      hookKey(localBridge, T0, { clipReady: false }),
    "stl-local bridge: clip 표식이 key 에 영향 없음 (stl-local key 무변경)",
  );
  const plain = buildSupportKey(
    autoPt,
    params,
    autoPt.contact,
    autoPt.base,
    null,
    undefined,
  );
  assert(
    hookKey(autoPt, T0) === plain,
    "비브릿지 world 점 key = buildSupportKey(저장 world 좌표 그대로) — 정의 확인",
  );
}

// ── (f) 배선 정적 검사 — 훅 deps · 인자 · 훅 호출 순서 ─────────────────────
console.log("\n(f) 배선 정적 검사 (useSupportMeshSync.ts / BabylonScene.tsx):");
{
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const hookSrc = stripComments(
    readFileSync(
      join(V2, "components", "babylon", "hooks", "useSupportMeshSync.ts"),
      "utf8",
    ),
  );
  const sceneSrc = stripComments(
    readFileSync(join(V2, "components", "BabylonScene.tsx"), "utf8"),
  );

  assert(
    /buildSupportRebuildKey\s*\(/.test(hookSrc),
    "훅이 순수 함수 buildSupportRebuildKey 로 key 를 만든다 (검증 대상 = 실제 경로)",
  );
  assert(
    !/Matrix\.Invert/.test(hookSrc),
    "훅에 world 점 로컬화(Matrix.Invert) 잔재가 없다",
  );
  // 훅 effect 의 deps = 파일의 마지막 `}, [ ... ]);`.
  const depsAt = hookSrc.lastIndexOf("}, [");
  const deps = depsAt >= 0 ? hookSrc.slice(depsAt).match(/\[([^\]]*)\]/) : null;
  assert(
    deps !== null && /\bmeshLoadTick\b/.test(deps[1]),
    `effect deps 에 meshLoadTick 이 있다 (B — 로드 완료 후 재실행) [${deps ? deps[1].replace(/\s+/g, " ").trim() : "?"}]`,
  );
  assert(
    deps !== null &&
      ["supports", "supportParams", "partsReady", "verticalSignal"].every((d) =>
        new RegExp(`\\b${d}\\b`).test(deps[1]),
      ),
    "종전 deps 4종(supports·supportParams·partsReady·verticalSignal) 유지",
  );
  assert(
    /existing\.parent\s*\|\|\s*p\.coordSpace\s*!==\s*"stl-local"/.test(hookSrc),
    "skip 조건 유지: stl-local 인데 parent 없으면 재생성 (재오픈 시 메시 없이 만든 점)",
  );
  assert(
    /if\s*\(\s*redesign\s*&&\s*!partsReady\s*\)\s*continue/.test(hookSrc),
    "재설계 점 부품 미로드 skip(redesign && !partsReady) 유지",
  );

  // BabylonScene: useSupportMeshSync 호출 인자에 meshLoadTick.
  const callAt = sceneSrc.indexOf("useSupportMeshSync(");
  const callArgs =
    callAt >= 0 ? sceneSrc.slice(callAt, sceneSrc.indexOf(")", callAt)) : "";
  assert(
    /\bmeshLoadTick\b/.test(callArgs),
    "BabylonScene 이 useSupportMeshSync 에 meshLoadTick 을 넘긴다",
  );
  // 훅 호출 순서 (불변식 1) — 컴포넌트 본문의 use* 호출 순서가 그대로인가.
  const bodyAt = sceneSrc.indexOf("function BabylonScene(");
  const calls = [...sceneSrc.slice(bodyAt).matchAll(/\b(use[A-Z]\w*)\s*\(/g)].map(
    (m) => m[1],
  );
  const EXPECTED = [
    "useSceneRefs",
    "useSupportPartsReady",
    "useSceneBootstrap",
    "useState",
    "useFileMeshSync",
    "useSupportMeshSync",
    "useSelectionSync",
    "useSlicePreview",
    "useBridgeVisualization",
    "useEditModeSync",
    "useDentalBrush",
    "useBuildVolumeCheck",
    "useAlignFloorHover",
    "useImperativeHandle",
  ];
  assert(
    bodyAt >= 0 && JSON.stringify(calls) === JSON.stringify(EXPECTED),
    `BabylonScene 훅 호출 순서 무변경 (${calls.length}개)`,
  );
}

// ── (g) ★ 대조군 — 수정 전 key 계산이면 (a) 가 실제로 FAIL 하는가 ─────────────
console.log("\n(g) ★ 대조군 — 수정 전(로컬화) key 로 (a) 를 돌리면 결함이 재현되는가:");
{
  // 몸통 드래그(수평)·수직축 회전: auto 점은 base 가 새 접점 수직 아래로 재설정
  //   되지만 수평·수직축 회전에서는 로컬 값이 그대로 → key 불변 = 옛 자리 잔류.
  for (const [mname, T1] of MOVES.slice(0, 2)) {
    const moved = commitPatch(autoPt, T0, T1);
    assert(
      legacyKey(moved, T1) === legacyKey(autoPt, T0),
      `결함 재현: 수정 전 key · auto · ${mname} → key 불변(옛 자리 잔류) = (a) FAIL`,
    );
  }
  // 브릿지는 양 끝·변곡점이 강체 변환이라 어떤 이동이든 로컬 값이 그대로.
  for (const [mname, T1] of MOVES) {
    const moved = commitPatch(bridgePt, T0, T1);
    assert(
      legacyKey(moved, T1) === legacyKey(bridgePt, T0),
      `결함 재현: 수정 전 key · bridge · ${mname} → key 불변 = (a) FAIL`,
    );
  }
  // 같은 입력에서 수정 후 key 는 바뀐다 (= 대조).
  const moved = commitPatch(autoPt, T0, MOVES[0][1]);
  assert(
    hookKey(moved, MOVES[0][1]) !== hookKey(autoPt, T0),
    "대조: 같은 입력에서 수정 후 key 는 변경 = (a) PASS",
  );
}

console.log(
  failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
);
process.exit(failed === 0 ? 0 : 1);
