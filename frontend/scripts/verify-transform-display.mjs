// POSITION 표시 기준점 헤드리스 검증 (B-12).
//   리드가 CHITUBOX 실물과 대조해 제기한 두 가지 중 (b) "회전해도 POSITION 이
//   0 을 유지한다" 를 우리 구현이 재현하는지 assert 한다.
//
//   핵심 주장: 표시 기준점을 **회전 피벗과 같은 점(bbox 중심)** 으로 두면,
//   피벗이 회전 불변이므로(B-9) 표시값도 자동으로 불변이다. 반대로 기존처럼
//   mesh 원점(정점에 베이크된 바닥 중심)을 그대로 표시하면 원점이 중심 둘레를
//   공전해 값이 바뀐다 — (c) 대조군이 그것을 재현한다.
//
//   ⚠️ (a)~(d) 는 회전 후 오프셋을 **재계산**해서 본다. 초판 패널은 재계산하지
//   않고 선택 시점 오프셋을 캐시했기 때문에, 결함(드래그 중 드리프트)이 이
//   스크립트를 통과하고도 존재했다(검수 FAIL). 그래서 패널 실동작을 그대로
//   재현하는 (e) 를 추가했다 — 고정 오프셋 vs 라이브 피벗 대조.
//   (f) 는 축별 스케일 기즈모의 전단(결함 2)을 프록시 자세별로 대조한다.
//
//   Mesh 의존 함수(meshWorldBBoxCenter)는 호출하지 않는다 — Babylon 의 수학
//   클래스(Matrix/Quaternion/Vector3)만 쓰므로 node 에서 그대로 돌아간다.
//   표시 환산 3종은 순수 함수라 그대로 import 한다.
//
//   실행: npx tsx scripts/verify-transform-display.mjs

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";

import {
  degToRad,
  displayAnchorOffset,
  fromDisplayPosition,
  matrixFromTransform,
  rotateTransformAroundWorldPivot,
  scaleTransformAroundWorldPivot,
  toDisplayPosition,
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

// 표시값 허용치 1e-4mm. Babylon 수학 클래스가 float32(Math.fround)라
//   ~10mm 규모에서 ~1e-6mm 반올림이 남는다. 프린터 해상도(수십 µm)보다
//   두 자리 이상 작다. 대조군의 이탈은 mm 단위라 (c)가 여전히 구분한다.
const TOL = 1e-4;

/**
 * 모델에 부착된 로컬 점 pl 이 transform t 에서 가는 world 좌표.
 * bbox 중심은 모델에 부착된 점이므로, 회전 후 중심 = 이 함수로 추적한다.
 */
function attachedPoint(t, pl) {
  return Vector3.TransformCoordinates(pl, matrixFromTransform(t));
}

// ── 픽스처 ──────────────────────────────────────────────────────────────
//   stl-loader 의 alignMeshToPlate 가 정점을 "XZ 중심 0 / Y 바닥 0" 에 베이크하므로
//   모델 로컬 bbox 중심은 (0, h/2, 0) 이다. 높이 20mm 모델을 가정.
const LOCAL_BBOX_CENTER = new Vector3(0, 10, 0);

/** transform t 에서의 world bbox 중심 = 회전 피벗 (B-9). */
function pivotOf(t) {
  const c = attachedPoint(t, LOCAL_BBOX_CENTER);
  return [c.x, c.y, c.z];
}

function caseRotationInvariant() {
  console.log("\n(a) bbox 기준 표시값은 회전 후에도 불변 (CHITUBOX 동작):");

  // 모델을 플레이트 임의 위치에 둔 상태 (회전 없음).
  const t0 = {
    tx: 15, ty: 0, tz: -8,
    rx: 0, ry: 0, rz: 0,
    sx: 1, sy: 1, sz: 1,
  };
  const pivot0 = pivotOf(t0);
  const off0 = displayAnchorOffset(t0, pivot0);
  const disp0 = toDisplayPosition(t0, off0);
  console.log(`  회전 전 표시 = (${disp0.map((v) => v.toFixed(4)).join(", ")})`);

  // 표시값은 정의상 bbox 중심의 world 좌표여야 한다.
  assert(
    Math.abs(disp0[0] - pivot0[0]) < TOL &&
      Math.abs(disp0[1] - pivot0[1]) < TOL &&
      Math.abs(disp0[2] - pivot0[2]) < TOL,
    "표시값 = bbox 중심 world 좌표",
  );

  // 여러 각도·축으로 피벗 고정 회전을 걸어도 표시값이 그대로여야 한다.
  // movesOrigin: 이 회전이 내부 tx/ty/tz 를 실제로 움직이는가.
  //   원점(0, 0, 0)_local 은 bbox 중심(0, h/2, 0)_local 의 **바로 아래**라
  //   두 점을 잇는 벡터가 Y 축과 평행하다. 그래서 Y 축 회전만은 원점이 제자리다
  //   (회전축 위의 점은 안 움직인다). 나머지 축은 원점이 중심 둘레를 공전한다.
  const rotations = [
    ["X축 89°", new Vector3(1, 0, 0), 89, true],
    ["Z축 95°", new Vector3(0, 0, 1), 95, true],
    ["Y축 -137°", new Vector3(0, 1, 0), -137, false],
    ["임의축 43°", new Vector3(0.3, 0.9, -0.2).normalize(), 43, true],
  ];
  for (const [label, axis, deg, movesOrigin] of rotations) {
    const dq = Quaternion.RotationAxis(axis, degToRad(deg));
    const t1 = rotateTransformAroundWorldPivot(t0, dq, new Vector3(...pivot0));
    // 회전 후에도 오프셋은 "그 시점의 원점 → 그 시점의 bbox 중심" 으로 다시
    //   구한다. 패널은 선택 시점 오프셋을 들고 있지만, 불변성의 근거는
    //   "원점 + 오프셋 = 피벗" 이 유지된다는 것이므로 양쪽을 다 본다.
    const pivot1 = pivotOf(t1);
    const dispRecomputed = toDisplayPosition(
      t1,
      displayAnchorOffset(t1, pivot1),
    );
    const drift = Math.hypot(
      dispRecomputed[0] - disp0[0],
      dispRecomputed[1] - disp0[1],
      dispRecomputed[2] - disp0[2],
    );
    console.log(
      `  ${label} 후 표시 = (${dispRecomputed
        .map((v) => v.toFixed(4))
        .join(", ")})  이동 ${drift.toExponential(2)}mm`,
    );
    assert(drift < TOL, `${label} 회전에도 표시값 불변 (${drift.toExponential(2)}mm)`);

    // 내부 저장값은 손대지 않았음을 확인 — "표시만 환산" 방침.
    //   회전축이 원점을 지나지 않으면 tx/ty/tz 가 실제로 움직여야 한다. 표시값이
    //   불변인 게 "저장값을 고정했기 때문"이 아니라 "기준점을 바꿨기 때문"임을
    //   보여주는 대조다.
    const stored = Math.hypot(t1.tx - t0.tx, t1.ty - t0.ty, t1.tz - t0.tz);
    if (movesOrigin) {
      assert(
        stored > 1e-3,
        `${label}: 내부 tx/ty/tz 는 종전대로 움직인다 (${stored.toFixed(3)}mm) — 저장 의미 불변`,
      );
    } else {
      assert(
        stored < TOL,
        `${label}: 회전축이 원점을 지나 내부 tx/ty/tz 도 제자리 (${stored.toExponential(2)}mm)`,
      );
    }
  }
}

function caseRoundTrip() {
  console.log("\n(b) 표시 ↔ 내부 환산 왕복 무손실:");

  const cases = [
    {
      tx: 15, ty: 0, tz: -8,
      rx: 0, ry: 0, rz: 0,
      sx: 1, sy: 1, sz: 1,
    },
    {
      tx: 12.5, ty: -3.25, tz: 7.75,
      rx: 23, ry: -41, rz: 67,
      sx: 1.7, sy: 0.6, sz: 2.3,
    },
    {
      tx: -40.125, ty: 21.5, tz: 0,
      rx: 89, ry: 0, rz: -12,
      sx: 0.5, sy: 0.5, sz: 0.5,
    },
  ];

  for (const [i, t] of cases.entries()) {
    const off = displayAnchorOffset(t, pivotOf(t));
    const disp = toDisplayPosition(t, off);
    const back = fromDisplayPosition(disp, off);
    const err = Math.hypot(back[0] - t.tx, back[1] - t.ty, back[2] - t.tz);
    assert(err < TOL, `케이스 ${i + 1}: 표시→내부 왕복 오차 ${err.toExponential(2)}mm`);
  }

  // 사용자가 표시값을 직접 타이핑하는 경로: 임의 표시값 → 내부 → 다시 표시.
  const t = cases[1];
  const off = displayAnchorOffset(t, pivotOf(t));
  const typed = [3.5, 12.25, -7.125];
  const [tx, ty, tz] = fromDisplayPosition(typed, off);
  const shown = toDisplayPosition({ ...t, tx, ty, tz }, off);
  const err = Math.hypot(
    shown[0] - typed[0],
    shown[1] - typed[1],
    shown[2] - typed[2],
  );
  assert(err < TOL, `사용자 입력값이 그대로 다시 표시됨 (오차 ${err.toExponential(2)}mm)`);

  // offset 이 null 이면 기존(원점 기준) 동작으로 폴백.
  const fallback = toDisplayPosition(t, null);
  assert(
    fallback[0] === t.tx && fallback[1] === t.ty && fallback[2] === t.tz,
    "피벗 미제공 시 원점 기준 표시로 폴백 (기존 동작 보존)",
  );
}

function caseLegacyDrifts() {
  console.log(
    "\n(c) 대조군 — 기존 방식(원점 기준 표시)은 회전하면 값이 바뀐다 (검증이 결함을 잡는 증명):",
  );

  // 리드 스크린샷 실측 재현.
  //   회전 전 Y=21, Z=−1.196 / X축 89° 후 Y=31.226, Z=−17.60.
  //
  //   피벗은 `pos' = Rd·(pos − p) + p` 를 p 에 대해 역산해 얻었다 — 관측 2쌍과
  //   회전각 89° 를 넣으면 (y 34.4594, z −4.1950) 이 유일해다. 진단 문서의
  //   "피벗 ≈ Y 26, Z −9" 는 스크린샷에서 눈대중한 근사치라 그대로 넣으면
  //   실측값이 안 나온다. 여기서는 역산한 정확한 값을 써 소수 3자리까지 맞춘다.
  const PIVOT = new Vector3(0, 34.4594, -4.195);
  const t0 = {
    tx: 0, ty: 21, tz: -1.196,
    rx: 0, ry: 0, rz: 0,
    sx: 1, sy: 1, sz: 1,
  };
  const rel = new Vector3(t0.tx - PIVOT.x, t0.ty - PIVOT.y, t0.tz - PIVOT.z);
  console.log(
    `  회전 전 원점 = (${t0.tx}, ${t0.ty}, ${t0.tz}), 피벗 = (${PIVOT.x}, ${PIVOT.y}, ${PIVOT.z})`,
  );
  console.log(`  rel = (${rel.x.toFixed(3)}, ${rel.y.toFixed(3)}, ${rel.z.toFixed(3)})`);

  const dq = Quaternion.RotationAxis(new Vector3(1, 0, 0), degToRad(89));
  const t1 = rotateTransformAroundWorldPivot(t0, dq, PIVOT);

  // 기존 방식 표시 = 내부 tx/ty/tz 를 그대로 보여줌 (offset 없음).
  const legacy0 = toDisplayPosition(t0, null);
  const legacy1 = toDisplayPosition(t1, null);
  console.log(
    `  [기존] 회전 전 = (${legacy0.map((v) => v.toFixed(3)).join(", ")})`,
  );
  console.log(
    `  [기존] X축 89° 후 = (${legacy1.map((v) => v.toFixed(3)).join(", ")})`,
  );

  // 리드 실측값 재현 확인 (표시 소수 2~3자리 수준의 일치).
  assert(
    Math.abs(legacy1[1] - 31.226) < 0.01,
    `리드 실측 Y=31.226 재현 (계산 ${legacy1[1].toFixed(3)})`,
  );
  assert(
    Math.abs(legacy1[2] - -17.6) < 0.01,
    `리드 실측 Z=−17.60 재현 (계산 ${legacy1[2].toFixed(3)})`,
  );

  const legacyDrift = Math.hypot(
    legacy1[0] - legacy0[0],
    legacy1[1] - legacy0[1],
    legacy1[2] - legacy0[2],
  );
  console.log(`  [기존] 표시값 이동량 = ${legacyDrift.toFixed(3)}mm`);
  assert(
    legacyDrift > 1.0,
    `기존 방식은 회전만으로 표시값이 1mm 이상 변한다 (${legacyDrift.toFixed(3)}mm) — 결함 재현`,
  );

  // 같은 조건에서 새 방식(bbox 기준)은 불변.
  const off0 = displayAnchorOffset(t0, [PIVOT.x, PIVOT.y, PIVOT.z]);
  const new0 = toDisplayPosition(t0, off0);
  // 회전 후 피벗은 정의상 제자리(B-9)이므로 같은 피벗으로 오프셋을 다시 구한다.
  const off1 = displayAnchorOffset(t1, [PIVOT.x, PIVOT.y, PIVOT.z]);
  const new1 = toDisplayPosition(t1, off1);
  console.log(`  [신규] 회전 전 = (${new0.map((v) => v.toFixed(3)).join(", ")})`);
  console.log(`  [신규] X축 89° 후 = (${new1.map((v) => v.toFixed(3)).join(", ")})`);
  const newDrift = Math.hypot(
    new1[0] - new0[0],
    new1[1] - new0[1],
    new1[2] - new0[2],
  );
  console.log(`  [신규] 표시값 이동량 = ${newDrift.toExponential(3)}mm`);
  assert(newDrift < TOL, "같은 조건에서 새 방식은 표시값 불변 — 수정 효과 확인");
}

function casePureTranslation() {
  console.log("\n(d) 순수 이동은 표시값이 그대로 따라온다:");

  const t0 = {
    tx: 15, ty: 0, tz: -8,
    rx: 23, ry: -41, rz: 67,
    sx: 1.2, sy: 1.2, sz: 1.2,
  };
  // 선택 시점에 오프셋을 잡고, 그 뒤 이동만 한다 (패널 실제 동작).
  const off = displayAnchorOffset(t0, pivotOf(t0));
  const disp0 = toDisplayPosition(t0, off);

  const DELTA = [7.5, -3.25, 11];
  const t1 = {
    ...t0,
    tx: t0.tx + DELTA[0],
    ty: t0.ty + DELTA[1],
    tz: t0.tz + DELTA[2],
  };
  const disp1 = toDisplayPosition(t1, off);
  const err = Math.hypot(
    disp1[0] - (disp0[0] + DELTA[0]),
    disp1[1] - (disp0[1] + DELTA[1]),
    disp1[2] - (disp0[2] + DELTA[2]),
  );
  console.log(
    `  이동 (${DELTA.join(", ")}) → 표시 (${disp0
      .map((v) => v.toFixed(3))
      .join(", ")}) → (${disp1.map((v) => v.toFixed(3)).join(", ")})`,
  );
  assert(err < TOL, `표시값이 이동량만큼 정확히 따라옴 (오차 ${err.toExponential(2)}mm)`);

  // 회전이 없어도(항등 자세) 동일해야 한다.
  const u0 = { ...t0, rx: 0, ry: 0, rz: 0 };
  const uOff = displayAnchorOffset(u0, pivotOf(u0));
  const uDisp0 = toDisplayPosition(u0, uOff);
  const u1 = { ...u0, tx: u0.tx + 5, ty: u0.ty + 5, tz: u0.tz + 5 };
  const uDisp1 = toDisplayPosition(u1, uOff);
  assert(
    Math.abs(uDisp1[0] - uDisp0[0] - 5) < TOL &&
      Math.abs(uDisp1[1] - uDisp0[1] - 5) < TOL &&
      Math.abs(uDisp1[2] - uDisp0[2] - 5) < TOL,
    "무회전 상태에서도 이동이 1:1 로 반영",
  );

  // 표시값으로 목표 위치를 지정하는 경로 (사용자 타이핑) 도 이동으로 성립.
  const TARGET = [0, 12, 0];
  const [tx, ty, tz] = fromDisplayPosition(TARGET, off);
  const shown = toDisplayPosition({ ...t0, tx, ty, tz }, off);
  assert(
    Math.abs(shown[0] - TARGET[0]) < TOL &&
      Math.abs(shown[1] - TARGET[1]) < TOL &&
      Math.abs(shown[2] - TARGET[2]) < TOL,
    "표시값으로 목표 지정 시 그 값이 그대로 유지됨",
  );
}

/**
 * (e) 패널 실동작 재현 — 드래그 **중** 표시값.
 *
 * 검수 결함 1: 초판은 선택 시점 오프셋을 캐시해 `표시 = t + d₀` 로 그렸다.
 * (a) 는 회전 후 오프셋을 **재계산**해서 봤기 때문에 그 결함을 통과시켰다.
 * 여기서는 두 방식을 나란히 계산해 대조한다.
 *   · [고정 오프셋] 초판 = 결함. `pivot + (Rd−I)(t₀−pivot) ≠ pivot` 으로 드리프트.
 *   · [라이브 피벗] 수정본. 렌더 시점 피벗으로 매번 환산 → 정의상 불변.
 */
function casePanelDuringDrag() {
  console.log(
    "\n(e) 패널 실동작 — 드래그 중 표시값 (고정 오프셋=결함 vs 라이브 피벗=수정):",
  );

  // 높이 20mm 모델을 플레이트 중앙에. bbox 중심 = (0, 10, 0).
  const t0 = {
    tx: 0, ty: 0, tz: 0,
    rx: 0, ry: 0, rz: 0,
    sx: 1, sy: 1, sz: 1,
  };
  const pivot0 = pivotOf(t0);
  // 초판이 선택 시점에 캐시하던 오프셋.
  const frozenOffset = displayAnchorOffset(t0, pivot0);
  const disp0 = toDisplayPosition(t0, frozenOffset);
  console.log(`  선택 직후 표시 = (${disp0.map((v) => v.toFixed(3)).join(", ")})`);
  assert(
    Math.abs(disp0[1] - 10) < TOL,
    `선택 직후 표시 Y = 10 (bbox 중심) — 정지 상태는 양쪽 다 옳다`,
  );

  // ── 회전 드래그 중 (X축 89°) ─────────────────────────────────────────
  const dq = Quaternion.RotationAxis(new Vector3(1, 0, 0), degToRad(89));
  const tRot = rotateTransformAroundWorldPivot(t0, dq, new Vector3(...pivot0));

  const frozenRot = toDisplayPosition(tRot, frozenOffset);
  const frozenDrift = Math.hypot(
    frozenRot[0] - disp0[0],
    frozenRot[1] - disp0[1],
    frozenRot[2] - disp0[2],
  );
  console.log(
    `  [고정 오프셋] X축 89° 드래그 중 = (${frozenRot
      .map((v) => v.toFixed(3))
      .join(", ")})  드리프트 ${frozenDrift.toFixed(3)}mm`,
  );
  assert(
    frozenDrift > 1.0,
    `고정 오프셋은 드래그 중 표시가 ${frozenDrift.toFixed(3)}mm 드리프트 — 결함 1 재현`,
  );
  // 검수자 재현 수치와 일치하는지 (0, 19.825, −9.998).
  assert(
    Math.abs(frozenRot[1] - 19.825) < 0.01 &&
      Math.abs(frozenRot[2] - -9.998) < 0.01,
    `검수 실측 (0, 19.825, −9.998) 재현 (계산 ${frozenRot
      .map((v) => v.toFixed(3))
      .join(", ")})`,
  );
  // 커밋 후에는 오프셋이 다시 잡혀 값이 튀어 돌아온다 — "손 떼면 복귀".
  const afterCommit = toDisplayPosition(tRot, displayAnchorOffset(tRot, pivotOf(tRot)));
  assert(
    Math.hypot(
      afterCommit[0] - disp0[0],
      afterCommit[1] - disp0[1],
      afterCommit[2] - disp0[2],
    ) < TOL,
    `고정 오프셋: 커밋 후에는 (0,10,0) 로 복귀 — 값이 튀는 현상`,
  );

  // 수정본: 렌더 시점 라이브 피벗으로 환산 = pivotOf(tRot).
  const liveRot = toDisplayPosition(tRot, displayAnchorOffset(tRot, pivotOf(tRot)));
  const liveDrift = Math.hypot(
    liveRot[0] - disp0[0],
    liveRot[1] - disp0[1],
    liveRot[2] - disp0[2],
  );
  console.log(
    `  [라이브 피벗] X축 89° 드래그 중 = (${liveRot
      .map((v) => v.toFixed(3))
      .join(", ")})  드리프트 ${liveDrift.toExponential(2)}mm`,
  );
  assert(liveDrift < TOL, "라이브 피벗은 회전 드래그 중에도 표시값 불변 — 수정 확인");

  // ── 균일 스케일 드래그 중 (×2) ───────────────────────────────────────
  const tScale = scaleTransformAroundWorldPivot(
    t0,
    [2, 2, 2],
    new Vector3(...pivot0),
  );
  const frozenScale = toDisplayPosition(tScale, frozenOffset);
  console.log(
    `  [고정 오프셋] 균일 ×2 드래그 중 = (${frozenScale
      .map((v) => v.toFixed(3))
      .join(", ")})`,
  );
  assert(
    Math.abs(frozenScale[1] - 0) < 0.01,
    `고정 오프셋: ×2 스케일 중 표시 Y 가 10 → 0 으로 점프 (계산 ${frozenScale[1].toFixed(3)}) — 결함 1 재현`,
  );
  const liveScale = toDisplayPosition(
    tScale,
    displayAnchorOffset(tScale, pivotOf(tScale)),
  );
  const liveScaleDrift = Math.hypot(
    liveScale[0] - disp0[0],
    liveScale[1] - disp0[1],
    liveScale[2] - disp0[2],
  );
  console.log(
    `  [라이브 피벗] 균일 ×2 드래그 중 = (${liveScale
      .map((v) => v.toFixed(3))
      .join(", ")})  드리프트 ${liveScaleDrift.toExponential(2)}mm`,
  );
  assert(
    liveScaleDrift < TOL,
    "라이브 피벗은 스케일 드래그 중에도 표시값 불변 — 수정 확인",
  );

  // ── 리드 실측 모델(오프셋 ~13.8mm) 규모 확인 ────────────────────────
  //   높이 27.6mm → bbox 중심 (0, 13.8, 0). 검수 지적대로 드리프트가 커진다.
  const bigCenter = new Vector3(0, 13.8, 0);
  const tBig = { ...t0 };
  const pivotBig = [
    ...Vector3.TransformCoordinates(bigCenter, matrixFromTransform(tBig)).asArray(),
  ];
  const frozenBig = displayAnchorOffset(tBig, pivotBig);
  const tBigRot = rotateTransformAroundWorldPivot(
    tBig,
    dq,
    new Vector3(...pivotBig),
  );
  const bigDrift = Math.hypot(
    ...toDisplayPosition(tBigRot, frozenBig).map(
      (v, i) => v - toDisplayPosition(tBig, frozenBig)[i],
    ),
  );
  console.log(`  [고정 오프셋] 오프셋 13.8mm 모델의 드리프트 = ${bigDrift.toFixed(3)}mm`);
  assert(
    bigDrift > 15,
    `리드 실측 규모에서 드리프트가 ~19mm 로 커진다 (${bigDrift.toFixed(3)}mm)`,
  );
}

/**
 * (f) 축별 스케일 기즈모의 전단(shear) — 검수 결함 2.
 *
 * `AxisScaleGizmo` 는 attach 노드(피벗 프록시)의 **로컬 축**에 스케일을 건다.
 * 드래그 결과 자식 메쉬의 world 행렬은 `P_scaled · (P₀⁻¹ · M₀)` 이고,
 * `setParent(null)` 이 이것을 decompose → SRT 로 재합성한다. 프록시가 identity 인데
 * 자식이 회전돼 있으면 이 행렬이 SRT 로 표현 불가(전단)라 형상이 깨진다.
 *
 * 여기서는 프록시 자세 두 가지("identity" = 결함, "mesh" = 수정)로 같은 드래그를
 * 재현하고, 재합성 전후 정점 오차를 비교한다. Babylon 수학 클래스만 쓴다.
 */
function caseScaleShear() {
  console.log("\n(f) 축별 스케일: 프록시 자세에 따른 전단 오차 (결함 2):");

  // Y축 45° 회전된 모델. bbox 중심을 피벗으로 삼는다.
  const t0 = {
    tx: 0, ty: 0, tz: 0,
    rx: 0, ry: 45, rz: 0,
    sx: 1, sy: 1, sz: 1,
  };
  const M0 = matrixFromTransform(t0);
  const pivot = Vector3.TransformCoordinates(LOCAL_BBOX_CENTER, M0);

  /** 프록시 자세 q 로 world X 1.5배 드래그를 재현 → 자식의 최종 world 행렬. */
  function dragScale(proxyQ) {
    // 드래그 전 프록시: 위치=pivot, 자세=proxyQ, 스케일 1.
    const P0 = Matrix.Compose(new Vector3(1, 1, 1), proxyQ, pivot);
    // 기즈모가 프록시 **로컬 X** 를 1.5배. (world X 핸들을 끈 것에 해당)
    const P1 = Matrix.Compose(new Vector3(1.5, 1, 1), proxyQ, pivot);
    // 자식은 setParent 로 매달렸으므로 로컬 = P0⁻¹ · M0. 최종 world = local · P1.
    const local = M0.multiply(Matrix.Invert(P0));
    return local.multiply(P1);
  }

  /**
   * setParent(null) 이 하는 일 = world 행렬을 decompose 해 SRT 로 재합성.
   * 전단이 섞여 있으면 재합성 결과가 원본 world 행렬과 달라진다.
   *
   * 반환: `{ max, probe }`
   *   · max   — 로컬 bbox 코너 8개 중 최대 오차(mm). 형상 왜곡의 크기.
   *   · probe — 검수자가 인용한 지점(로컬 (0,0,10), 원점에서 10mm)의 오차.
   *             오차는 정점마다 다르므로(레버암 차이) 실측 대조는 같은 지점에서 한다.
   */
  function recomposeError(W) {
    const s = new Vector3();
    const q = new Quaternion();
    const p = new Vector3();
    W.decompose(s, q, p);
    const R = Matrix.Compose(s, q, p);
    const errAt = (c) =>
      Vector3.Distance(
        Vector3.TransformCoordinates(c, W),
        Vector3.TransformCoordinates(c, R),
      );
    // 10mm 규모 정점(로컬 bbox 코너)에서 오차를 잰다.
    let max = 0;
    for (const x of [-10, 10]) {
      for (const y of [0, 20]) {
        for (const z of [-10, 10]) {
          max = Math.max(max, errAt(new Vector3(x, y, z)));
        }
      }
    }
    return { max, probe: errAt(new Vector3(0, 0, 10)) };
  }

  // [결함] 프록시 identity → world 축 스케일 → 회전된 자식에 전단.
  const errIdentity = recomposeError(dragScale(Quaternion.Identity()));
  console.log(
    `  [프록시 identity] 재합성 오차 = 최대 ${errIdentity.max.toFixed(3)}mm (bbox 코너)` +
      ` / ${errIdentity.probe.toFixed(3)}mm (로컬 (0,0,10) 정점)`,
  );
  assert(
    errIdentity.max > 1.0,
    `프록시 identity + 축별 스케일은 전단으로 최대 ${errIdentity.max.toFixed(3)}mm 오차 — 결함 2 재현`,
  );
  assert(
    Math.abs(errIdentity.probe - 2.712) < 0.05,
    `검수 실측 2.712mm / 10mm 정점 재현 (계산 ${errIdentity.probe.toFixed(3)}mm)`,
  );
  // 전단의 정체: decompose 가 뽑아낸 스케일이 우리가 건 (1.5, 1, 1) 과 다르다.
  const s = new Vector3();
  dragScale(Quaternion.Identity()).decompose(s, new Quaternion(), new Vector3());
  console.log(
    `  [프록시 identity] decompose 스케일 = (${s.x.toFixed(4)}, ${s.y.toFixed(4)}, ${s.z.toFixed(4)}) ← 건 값은 (1.5, 1, 1)`,
  );
  assert(
    Math.abs(s.x - 1.5) > 0.1,
    `SRT 로 표현 불가라 스케일이 (1.5,1,1) → (${s.x.toFixed(3)},${s.y.toFixed(3)},${s.z.toFixed(3)}) 로 뭉개진다`,
  );

  // [수정] 프록시 = 모델 회전 → 로컬 축 스케일 → 전단 없음.
  const meshQ = Quaternion.FromEulerAngles(
    degToRad(t0.rx),
    degToRad(t0.ry),
    degToRad(t0.rz),
  );
  const errMesh = recomposeError(dragScale(meshQ));
  console.log(
    `  [프록시 = 모델 회전] 재합성 오차 = 최대 ${errMesh.max.toExponential(2)}mm`,
  );
  assert(
    errMesh.max < 1e-3,
    `프록시를 모델 회전에 맞추면 전단 오차 0 (${errMesh.max.toExponential(2)}mm) — 수정 확인`,
  );

  // 회전이 없으면 두 방식이 같아야 한다 (수정이 무회전 케이스를 바꾸지 않음).
  const u0 = { ...t0, ry: 0 };
  const M0u = matrixFromTransform(u0);
  const pivotU = Vector3.TransformCoordinates(LOCAL_BBOX_CENTER, M0u);
  const P0u = Matrix.Compose(new Vector3(1, 1, 1), Quaternion.Identity(), pivotU);
  const P1u = Matrix.Compose(new Vector3(1.5, 1, 1), Quaternion.Identity(), pivotU);
  const errU = recomposeError(M0u.multiply(Matrix.Invert(P0u)).multiply(P1u));
  assert(
    errU.max < 1e-3,
    `무회전 모델은 프록시 자세와 무관하게 오차 0 (${errU.max.toExponential(2)}mm)`,
  );
}

function main() {
  console.log("POSITION 표시 기준점 검증 (B-12)");
  // Matrix 를 한 번 참조해 import 가 트리셰이크로 사라지지 않게 한다
  //   (matrixFromTransform 내부에서 쓰지만 명시적 사용을 남긴다).
  void Matrix;
  caseRotationInvariant();
  caseRoundTrip();
  caseLegacyDrifts();
  casePureTranslation();
  casePanelDuringDrag();
  caseScaleShear();
  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
