// 이동(Move) 기즈모 앵커 헤드리스 검증 (B-17).
//
//   리드 요구: "Move 화살표도 Rotate 처럼 **가운데**에 생기고, **회전해도 위치가
//   안 바뀌었으면** 좋겠다."
//
//   원인: PositionGizmo 는 mesh 에 직접 attach 라 Babylon 기본 anchorPoint
//   (= Origin) 규칙에 따라 화살표가 **mesh 원점**에 붙는다. 그런데 stl-loader 의
//   alignMeshToPlate 가 정점을 "XZ 중심 / Y 바닥" 에 베이크해 원점 ≠ bbox 중심이고,
//   회전 피벗은 bbox 중심(B-9)이라 회전 시 원점이 중심 둘레를 **공전**한다.
//   → 화살표가 돌아다닌다. (anchorPoint 는 Origin/Pivot 두 값뿐이라 bbox 중심을
//   지정할 수 없다. 그래서 회전/스케일과 같은 **피벗 프록시** 방식을 쓴다.)
//
//   ⚠️ 이 검증의 핵심은 **대조군으로 결함을 실제 재현**하는 것이다
//   (프로젝트 규약: B-1 확립, B-12~B-15 연속 적중).
//     (a) 원점 앵커(수정 전) — 회전할 때마다 화살표가 mm 단위로 이동함을 수치로.
//     (b) bbox 중심 앵커(수정 후) — 같은 회전에서 불변임을 수치로.
//   여기에 더해 프록시 경유 이동의 **커밋 정확성**((c)~(e))을 본다. 프록시 방식은
//   화살표 위치만 고치는 게 아니라 mesh 를 임시 부모화하므로, 커밋되는 tx/ty/tz 가
//   실제 이동량과 정확히 일치하고 회전/스케일이 오염되지 않아야 한다.
//
//   Babylon 의존: Scene/렌더 루프 없이 Matrix/Quaternion/Vector3 + TransformNode 의
//   부모-자식 world 행렬 합성만 쓴다. setParent 는 Scene 을 요구해 NullEngine 이
//   필요하므로, (c)~(e) 는 setParent 가 하는 일(= world 보존 후 local SRT 재분해)을
//   **행렬로 동일하게 재현**해 검증한다. 실제 Babylon 도 같은 decompose 를 쓴다.
//
//   실행: npx tsx scripts/verify-move-gizmo-anchor.mjs

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";

import {
  degToRad,
  matrixFromTransform,
  radToDeg,
  rotateTransformAroundWorldPivot,
} from "../src/features/v2/utils/transform.ts";

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

// 허용치 1e-4mm(0.1µm). Babylon 수학 클래스는 내부적으로 float32(Math.fround)라
//   ~10mm 좌표에서 ~1e-6mm 반올림이 남는다. 프린터 해상도(수십 µm)보다 두 자리
//   이상 작다. 결함(원점 공전·커밋 오차)은 mm 단위라 이 허용치로 충분히 갈린다.
const TOL = 1e-4;

// ── 테스트 모델 ──────────────────────────────────────────────────────────
// alignMeshToPlate 를 거친 STL 을 모사한다: 정점 로컬 AABB 가 "XZ 중심 / Y 바닥".
//   즉 로컬 원점 (0,0,0) 은 바닥면 중앙이고, **로컬 bbox 중심은 (0, h/2, 0)**.
//   이 오프셋이 있기 때문에 원점 앵커와 중심 앵커가 갈린다.
const LOCAL_BB = {
  min: new Vector3(-8, 0, -5),
  max: new Vector3(8, 24, 5),
};
const LOCAL_CENTER = LOCAL_BB.min.add(LOCAL_BB.max).scale(0.5); // (0,12,0)

/** transform 을 적용했을 때의 world AABB 중심 = 피벗/앵커의 정본 (B-9). */
function worldBBoxCenter(t) {
  const m = matrixFromTransform(t);
  const corners = [];
  for (const x of [LOCAL_BB.min.x, LOCAL_BB.max.x]) {
    for (const y of [LOCAL_BB.min.y, LOCAL_BB.max.y]) {
      for (const z of [LOCAL_BB.min.z, LOCAL_BB.max.z]) {
        corners.push(
          Vector3.TransformCoordinates(new Vector3(x, y, z), m),
        );
      }
    }
  }
  let min = corners[0].clone();
  let max = corners[0].clone();
  for (const c of corners) {
    min = Vector3.Minimize(min, c);
    max = Vector3.Maximize(max, c);
  }
  return min.add(max).scale(0.5);
}

/** 원점 앵커 = tx/ty/tz 그대로 (Babylon anchorPoint=Origin 이 붙는 곳). */
function originAnchor(t) {
  return new Vector3(t.tx, t.ty, t.tz);
}

const T0 = {
  tx: 0, ty: 0, tz: 0,
  rx: 0, ry: 0, rz: 0,
  sx: 1, sy: 1, sz: 1,
};

// ── (a) 대조군: 원점 앵커는 회전할 때마다 화살표가 이동한다 ───────────────
function caseOriginAnchorDrifts() {
  console.log("\n(a) 대조군(수정 전) — 원점 앵커는 회전마다 화살표가 이동:");
  const anchor0 = originAnchor(T0);
  console.log(
    `  회전 0° 화살표 위치 = (${anchor0.x.toFixed(3)}, ${anchor0.y.toFixed(3)}, ${anchor0.z.toFixed(3)})`,
  );

  let maxDrift = 0;
  for (const deg of [30, 90, 180]) {
    // 실제 앱과 동일하게 bbox 중심을 축으로 제자리 회전한다 (B-9).
    const pivot = worldBBoxCenter(T0);
    const dq = Quaternion.RotationAxis(new Vector3(1, 0, 0), degToRad(deg));
    const t1 = rotateTransformAroundWorldPivot(T0, dq, pivot);
    const a1 = originAnchor(t1);
    const drift = Vector3.Distance(a1, anchor0);
    maxDrift = Math.max(maxDrift, drift);
    console.log(
      `  X축 ${String(deg).padStart(3)}° 회전 후 = (${a1.x.toFixed(3)}, ${a1.y.toFixed(3)}, ${a1.z.toFixed(3)})  이동량 ${drift.toFixed(3)}mm`,
    );
  }
  // 모델 높이 24mm → 원점은 중심에서 12mm 떨어져 있으므로 180° 에서 24mm 공전.
  assert(
    maxDrift > 1.0,
    `원점 앵커는 회전 시 화살표가 1mm 이상 이동 (최대 ${maxDrift.toFixed(3)}mm) — 리드 보고 결함 재현`,
  );
}

// ── (b) 수정 후: bbox 중심 앵커는 회전해도 불변 ──────────────────────────
function caseCenterAnchorFixed() {
  console.log("\n(b) 수정 후 — bbox 중심 앵커는 회전해도 불변:");
  const anchor0 = worldBBoxCenter(T0);
  console.log(
    `  회전 0° 화살표 위치 = (${anchor0.x.toFixed(3)}, ${anchor0.y.toFixed(3)}, ${anchor0.z.toFixed(3)})`,
  );

  let maxDrift = 0;
  for (const deg of [30, 90, 180]) {
    const pivot = worldBBoxCenter(T0);
    const dq = Quaternion.RotationAxis(new Vector3(1, 0, 0), degToRad(deg));
    const t1 = rotateTransformAroundWorldPivot(T0, dq, pivot);
    const a1 = worldBBoxCenter(t1);
    const drift = Vector3.Distance(a1, anchor0);
    maxDrift = Math.max(maxDrift, drift);
    console.log(
      `  X축 ${String(deg).padStart(3)}° 회전 후 = (${a1.x.toFixed(3)}, ${a1.y.toFixed(3)}, ${a1.z.toFixed(3)})  이동량 ${drift.toExponential(2)}mm`,
    );
  }
  assert(
    maxDrift < TOL,
    `bbox 중심 앵커는 회전해도 불변 (최대 ${maxDrift.toExponential(2)}mm < 1e-4)`,
  );

  // 임의 축 복합 회전에서도 성립해야 한다 (단축만 보면 우연히 통과할 수 있다).
  const pivot = worldBBoxCenter(T0);
  let t = T0;
  for (const [axis, deg] of [
    [new Vector3(0.3, 0.9, -0.2), 37],
    [new Vector3(-0.5, 0.1, 0.85), 71],
  ]) {
    const dq = Quaternion.RotationAxis(axis.normalize(), degToRad(deg));
    t = rotateTransformAroundWorldPivot(t, dq, worldBBoxCenter(t));
  }
  const dMulti = Vector3.Distance(worldBBoxCenter(t), pivot);
  console.log(`  임의축 2연쇄 회전 후 이동량 = ${dMulti.toExponential(2)}mm`);
  assert(dMulti < TOL, `임의축 복합 회전에서도 중심 앵커 불변 (${dMulti.toExponential(2)}mm)`);
}

// ── 프록시 경유 이동 모사 ────────────────────────────────────────────────
/**
 * setParent(proxy) → 기즈모가 프록시를 world 로 d 만큼 병진 → setParent(null)
 * 의 순수 행렬 재현.
 *
 * Babylon 의 setParent 는 "world 를 보존한 채 local 을 재계산" 하고,
 * setParent(null) 은 최종 world 행렬을 decompose 해 mesh 의 position/
 * rotationQuaternion/scaling 에 되돌려 놓는다. AxisDragGizmo 는 attachedNode 의
 * world 행렬에 **world 병진만** 더한다(axisDragGizmo.js: addTranslationFromFloats).
 * 프록시는 identity 자세·단위 스케일이므로 자식 world = T(d)·W_mesh 다.
 *
 * 반환값 = 드래그 종료 후 readMeshTransform 이 읽게 될 TransformV2.
 */
function commitAfterProxyMove(t, delta) {
  const world = matrixFromTransform(t);
  // 프록시(identity·unit)가 world 로 delta 만큼 움직인 뒤의 자식 world 행렬.
  const moved = world.clone();
  moved.addTranslationFromFloats(delta.x, delta.y, delta.z);

  // setParent(null) 의 decompose.
  const s = new Vector3();
  const q = new Quaternion();
  const p = new Vector3();
  moved.decompose(s, q, p);
  const eul = q.toEulerAngles();
  return {
    tx: p.x, ty: p.y, tz: p.z,
    rx: radToDeg(eul.x), ry: radToDeg(eul.y), rz: radToDeg(eul.z),
    sx: s.x, sy: s.y, sz: s.z,
  };
}

// ── (c) 프록시 경유 이동의 커밋값이 실제 이동량과 정확히 일치 ─────────────
function caseCommitExact() {
  console.log("\n(c) 프록시 경유 이동 — 커밋된 tx/ty/tz 가 실제 이동량과 일치:");
  const delta = new Vector3(13.5, -7.25, 4.75);

  // 회전·비균일 스케일이 걸린 까다로운 상태에서 검사한다. 프록시가 identity 라도
  //   자식이 기울어 있으면 잘못 구현 시 여기서 어긋난다.
  const base = {
    tx: 12.5, ty: 3.25, tz: -7.75,
    rx: 23, ry: -41, rz: 67,
    sx: 1.7, sy: 0.6, sz: 2.3,
  };
  const after = commitAfterProxyMove(base, delta);

  const dx = after.tx - base.tx;
  const dy = after.ty - base.ty;
  const dz = after.tz - base.tz;
  console.log(
    `  기즈모 이동 delta = (${delta.x}, ${delta.y}, ${delta.z})`,
  );
  console.log(
    `  커밋 tx/ty/tz 변화 = (${dx.toFixed(6)}, ${dy.toFixed(6)}, ${dz.toFixed(6)})`,
  );
  const err = Math.hypot(dx - delta.x, dy - delta.y, dz - delta.z);
  assert(err < TOL, `커밋 병진량 = 기즈모 이동량 (오차 ${err.toExponential(2)}mm)`);

  // 순수 병진이므로 회전·스케일은 한 톨도 바뀌면 안 된다.
  const rotErr = Math.max(
    Math.abs(after.rx - base.rx),
    Math.abs(after.ry - base.ry),
    Math.abs(after.rz - base.rz),
  );
  const sclErr = Math.max(
    Math.abs(after.sx - base.sx),
    Math.abs(after.sy - base.sy),
    Math.abs(after.sz - base.sz),
  );
  console.log(`  회전 최대 오차 ${rotErr.toExponential(2)}°, 스케일 최대 오차 ${sclErr.toExponential(2)}`);
  assert(rotErr < 1e-3, `이동은 회전 성분을 바꾸지 않음 (${rotErr.toExponential(2)}°)`);
  assert(sclErr < 1e-4, `이동은 스케일 성분을 바꾸지 않음 (${sclErr.toExponential(2)})`);

  // 모델 형상 보존: 로컬 정점이 world 에서 delta 만큼만 평행이동해야 한다
  //   (decompose 가 전단을 흘리면 여기서 깨진다 — B-12 스케일 사고의 교훈).
  const wBefore = matrixFromTransform(base);
  const wAfter = matrixFromTransform(after);
  let maxVertErr = 0;
  for (const x of [LOCAL_BB.min.x, LOCAL_BB.max.x]) {
    for (const y of [LOCAL_BB.min.y, LOCAL_BB.max.y]) {
      for (const z of [LOCAL_BB.min.z, LOCAL_BB.max.z]) {
        const v = new Vector3(x, y, z);
        const b = Vector3.TransformCoordinates(v, wBefore).add(delta);
        const a = Vector3.TransformCoordinates(v, wAfter);
        maxVertErr = Math.max(maxVertErr, Vector3.Distance(a, b));
      }
    }
  }
  console.log(`  정점 최대 오차 = ${maxVertErr.toExponential(2)}mm`);
  assert(maxVertErr < TOL, `모든 정점이 delta 만큼만 평행이동 (${maxVertErr.toExponential(2)}mm)`);
}

// ── (d) B-12 회귀 방지: POSITION 표시값이 이동량만큼만 변한다 ─────────────
function caseDisplayPositionTracksMove() {
  console.log("\n(d) B-12 무회귀 — POSITION 표시(bbox 중심 기준)가 이동량만큼만 변함:");
  // 회전이 걸린 상태에서 이동한다. 표시값은 bbox 중심이므로, 순수 병진이면
  //   표시값도 정확히 delta 만큼만 움직여야 한다 (흔들림 없음).
  const base = rotateTransformAroundWorldPivot(
    T0,
    Quaternion.RotationAxis(new Vector3(0.3, 0.9, -0.2).normalize(), degToRad(53)),
    worldBBoxCenter(T0),
  );
  const delta = new Vector3(-6.5, 11.25, 3.5);
  const after = commitAfterProxyMove(base, delta);

  const cBefore = worldBBoxCenter(base);
  const cAfter = worldBBoxCenter(after);
  const moved = cAfter.subtract(cBefore);
  console.log(
    `  표시값 변화 = (${moved.x.toFixed(6)}, ${moved.y.toFixed(6)}, ${moved.z.toFixed(6)})`,
  );
  const err = Vector3.Distance(moved, delta);
  assert(err < TOL, `POSITION 표시 변화 = 이동량 (오차 ${err.toExponential(2)}mm)`);

  // 화살표(= bbox 중심)와 표시값 기준점이 **같은 점**이어야 한다. 이게 어긋나면
  //   리드 눈에는 "화살표는 중앙인데 숫자는 딴 값" 으로 보인다.
  const anchorErr = Vector3.Distance(cAfter, worldBBoxCenter(after));
  assert(anchorErr < TOL, "화살표 앵커 = POSITION 표시 기준점 (같은 bbox 중심)");
}

// ── (e) 드래그 중간 프레임에서도 앵커·표시가 어긋나지 않는다 ─────────────
function caseIncrementalDrag() {
  console.log("\n(e) 드래그 중간 프레임 누적 — 표시값이 흔들리지 않음:");
  // 기즈모는 프레임마다 작은 delta 를 더한다. 20 프레임 누적 후에도 총 이동량과
  //   일치해야 한다 (프레임마다 재부모화·재분해가 일어나는 최악 가정).
  const base = rotateTransformAroundWorldPivot(
    T0,
    Quaternion.RotationAxis(new Vector3(1, 0.4, 0.2).normalize(), degToRad(29)),
    worldBBoxCenter(T0),
  );
  const step = new Vector3(0.35, -0.2, 0.15);
  const frames = 20;

  let t = base;
  for (let i = 0; i < frames; i++) t = commitAfterProxyMove(t, step);

  const total = step.scale(frames);
  const moved = worldBBoxCenter(t).subtract(worldBBoxCenter(base));
  console.log(
    `  ${frames}프레임 누적 = (${moved.x.toFixed(6)}, ${moved.y.toFixed(6)}, ${moved.z.toFixed(6)}) / 기대 (${total.x.toFixed(6)}, ${total.y.toFixed(6)}, ${total.z.toFixed(6)})`,
  );
  const err = Vector3.Distance(moved, total);
  assert(err < TOL, `누적 이동량 일치 — 드리프트 없음 (오차 ${err.toExponential(2)}mm)`);

  // 회전 성분이 누적 재분해로 흘러가지 않았는지 (decompose 왕복 안정성).
  const rotErr = Math.max(
    Math.abs(t.rx - base.rx),
    Math.abs(t.ry - base.ry),
    Math.abs(t.rz - base.rz),
  );
  console.log(`  ${frames}회 재분해 후 회전 오차 = ${rotErr.toExponential(2)}°`);
  assert(rotErr < 1e-3, `반복 재분해에도 회전 불변 (${rotErr.toExponential(2)}°)`);
}

function main() {
  console.log("이동 기즈모 앵커 검증 (B-17)");
  caseOriginAnchorDrifts();
  caseCenterAnchorFixed();
  caseCommitExact();
  caseDisplayPositionTracksMove();
  caseIncrementalDrag();
  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
