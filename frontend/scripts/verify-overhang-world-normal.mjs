// 오버행 하이라이트 world 법선 판정 헤드리스 검증 (B-35).
//   overhang.ts 의 순수부(isOverhangNormal / normalMatrixFromWorld /
//   negCosOfThreshold)를 tsx 로 직접 import 한다. Babylon Mesh 는 쓰지 않고
//   Matrix/Vector3 만 쓰므로 헤드리스로 돈다.
//
//   실행: npx tsx scripts/verify-overhang-world-normal.mjs
//   통과 로그는 커밋 메시지에 기록.
//
//   무엇을 확인하는가: 오버행 색칠이 **현재 자세**를 반영하는가.
//     종전 구현은 getVerticesData(NormalKind) = **로컬 법선**의 ny 만 봤다.
//     로컬 법선은 회전시켜도 변하지 않으므로, 모델을 아무리 돌려도 처음
//     자세 기준으로 칠한 자리가 그대로 남았다(리드 실물 발견: "아래쪽에
//     오버행이 표시돼야 하는데 처음 표시된 부분이 그대로다").
//     서포트 검출(slice-section.ts)은 이미 world 기준이라 화면과 실제가
//     어긋나 있었다.
//
//   ★ 대조군 원칙 (프로젝트 규약, B-1 확립):
//     "잘 돌아간다"만 보이지 않는다. §6 에서 **구 구현**(로컬 법선 ny 만
//     보는 판정)을 이 스크립트 안에 재현해, 그것이 핵심 시나리오(X축 180°
//     회전)에서 **FAIL** 함을 실측한다. §7 에서는 판정을 일부러 망가뜨린
//     **변조 구현** 2종이 이 검사들에 실제로 걸리는지 확인한다.

import { Matrix, Quaternion, Vector3 } from "@babylonjs/core";

import {
  isOverhangNormal,
  negCosOfThreshold,
  normalMatrixFromWorld,
} from "../src/features/v2/utils/overhang.ts";

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
  }
}

// ── 헬퍼 ───────────────────────────────────────────────────────────────────

const deg2rad = (d) => (d * Math.PI) / 180;

/**
 * TransformV2 와 같은 순서(scale → rotate → translate)로 world 행렬 합성.
 *   utils/transform.ts 의 matrixFromTransform 과 동일한 규약이다 — 여기서
 *   다시 만드는 이유는 Babylon Mesh 없이 행렬만 다루기 위해서.
 */
function world({ rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, tx = 0, ty = 0, tz = 0 } = {}) {
  return Matrix.Compose(
    new Vector3(sx, sy, sz),
    Quaternion.FromEulerAngles(deg2rad(rx), deg2rad(ry), deg2rad(rz)),
    new Vector3(tx, ty, tz),
  );
}

/** 현재(신) 구현으로 판정. */
const buf = new Vector3();
function isOver(normal, worldMat, thresholdDeg) {
  return isOverhangNormal(
    normal[0],
    normal[1],
    normal[2],
    normalMatrixFromWorld(worldMat),
    negCosOfThreshold(thresholdDeg),
    buf,
  );
}

/**
 * ★ 구(舊) 구현 재현 — world 행렬을 **완전히 무시**하고 로컬 ny 만 본다.
 *   overhang.ts:35 의 `const ny = normals[i*3+1]; ny <= negCosThreshold`.
 */
function isOverOld(normal, _worldMat, thresholdDeg) {
  return normal[1] <= negCosOfThreshold(thresholdDeg);
}

/** 판정에 실제로 쓰인 world 법선의 정규화 y (진단 출력용). */
function worldNy(normal, worldMat) {
  const out = new Vector3();
  Vector3.TransformNormalFromFloatsToRef(
    normal[0],
    normal[1],
    normal[2],
    normalMatrixFromWorld(worldMat),
    out,
  );
  return out.y / out.length();
}

// 대표 법선 (로컬).
const DOWN = [0, -1, 0]; // 아래를 향한 면 — 무회전이면 오버행.
const UP = [0, 1, 0]; // 위를 향한 면 — 무회전이면 안전.
const SIDE = [1, 0, 0]; // 수직 벽(옆면) — 무회전이면 안전.
const TH = 45; // 기본 임계각 45°.

function main() {
  console.log(`\n오버행 world 법선 판정 검증 — 임계각 θ=${TH}°`);

  // ── §1. 무회전 — 기준 동작이 바뀌지 않았는가 ──────────────────────────────
  console.log("\n(§1) 무회전(identity) — 판정 기준 자체는 불변:");
  {
    const I = world();
    assert(isOver(DOWN, I, TH) === true, "아래를 향한 면(ny=-1) → 오버행");
    assert(isOver(UP, I, TH) === false, "위를 향한 면(ny=+1) → 오버행 아님");
    assert(isOver(SIDE, I, TH) === false, "수직 벽(ny=0) → 오버행 아님 (θ=45°)");

    // 경계: θ=45° 에서 45° 로 누운 아래쪽 면은 -cos45 와 정확히 같아 ≤ 로 포함.
    const s = Math.SQRT1_2;
    assert(
      isOver([s, -s, 0], I, TH) === true,
      "45° 로 누운 아랫면(ny=-0.7071) → 오버행 (경계 포함, ≤ 판정)",
    );
    // 44° 기울기(= 수평에서 조금 더 선 면)는 제외되어야 한다.
    const n44 = [Math.cos(deg2rad(44)), -Math.sin(deg2rad(44)), 0];
    assert(
      isOver(n44, I, TH) === false,
      `θ 보다 가파른 면(ny=${(-Math.sin(deg2rad(44))).toFixed(4)}) → 오버행 아님`,
    );
    // 각도를 올리면 게이트가 함께 열린다 (임계각이 실제로 먹히는 증거).
    //   n44 의 ny=-sin44°=-0.6947 은 게이트 -cosθ 와 θ=46° 에서 소수점 7자리까지
    //   같아 반올림에 좌우된다(경계). 방향만 보려는 것이므로 경계를 넉넉히 피해
    //   θ=40° / 50° 로 잰다.
    assert(
      isOver(n44, I, 40) === false && isOver(n44, I, 50) === true,
      `같은 면(ny=${(-Math.sin(deg2rad(44))).toFixed(4)})이 θ=40°→미검출 / θ=50°→검출 — 게이트가 각도를 따라 움직임`,
    );
    // θ=90° 경계 — `-cos(90°)` 는 -6.1e-17 (0 이 아닌 미세 음수) 이므로 ny=0 인
    //   정확한 수직 벽은 `ny <= -cosθ` 를 **간신히 벗어난다**. 이는 종전 구현과
    //   완전히 동일한 부동소수 경계 거동이다 — 이번 수정은 좌표계만 바꾸고
    //   판정식은 건드리지 않았음을 여기서 고정한다.
    assert(
      isOver(SIDE, I, 90) === false && negCosOfThreshold(90) < 0,
      `θ=90°, ny=0 은 경계 밖 (-cos90°=${negCosOfThreshold(90).toExponential(1)}) — 종전 판정식 그대로`,
    );
    // 살짝이라도 아래를 향하면 θ=90° 에서 잡힌다 (경계의 반대편 확인).
    assert(
      isOver([1, -1e-6, 0], I, 90) === true,
      "θ=90° 에서 아주 조금이라도 아래를 향한 면은 오버행 — 경계가 정확히 수평에 있음",
    );
  }

  // ── §2. ★ 핵심 — X축 180° 회전 시 위를 향하던 면이 오버행이 된다 ──────────
  console.log("\n(§2) ★ 핵심 — X축 180° 회전(모델 뒤집기): 위/아래가 뒤바뀐다:");
  {
    const R180 = world({ rx: 180 });
    console.log(
      `       UP(0,1,0) 의 world ny = ${worldNy(UP, R180).toFixed(4)} / ` +
        `DOWN(0,-1,0) 의 world ny = ${worldNy(DOWN, R180).toFixed(4)}`,
    );
    assert(
      isOver(UP, R180, TH) === true,
      "뒤집으면 위를 향하던 면(로컬 ny=+1)이 오버행이 된다 ← 회전이 반영된 증거",
    );
    assert(
      isOver(DOWN, R180, TH) === false,
      "뒤집으면 아래를 향하던 면(로컬 ny=-1)은 오버행에서 빠진다",
    );
    // Z축 180° 로도 같은 뒤집힘이 나와야 한다 (특정 축에만 되는 것이 아님).
    const Z180 = world({ rz: 180 });
    assert(isOver(UP, Z180, TH) === true, "Z축 180° 로도 동일하게 뒤집힌다");
    // Y축 회전은 위/아래를 바꾸지 않는다 (축을 가리지 않는 오작동 방지).
    const Y90 = world({ ry: 90 });
    assert(
      isOver(DOWN, Y90, TH) === true && isOver(UP, Y90, TH) === false,
      "Y축(수직축) 회전은 위/아래 판정을 바꾸지 않는다 — 기하학적으로 옳다",
    );
  }

  // ── §3. 90° 회전 — 측면이 아래를 향하게 된다 ──────────────────────────────
  console.log("\n(§3) X축 90° 회전 — 측면/윗면이 수평·수직으로 교대:");
  {
    // X축 +90°: (0,1,0) → (0,0,1) 즉 수평(ny=0), (0,0,1) → (0,-1,0) 즉 아래.
    const RX90 = world({ rx: 90 });
    console.log(
      `       UP → world ny=${worldNy(UP, RX90).toFixed(4)} / ` +
        `+Z면(0,0,1) → world ny=${worldNy([0, 0, 1], RX90).toFixed(4)}`,
    );
    assert(
      isOver(UP, RX90, TH) === false,
      "윗면은 90° 돌면 수평 법선(ny≈0) — θ=45° 에서 오버행 아님",
    );
    assert(
      isOver([0, 0, 1], RX90, TH) === true,
      "+Z 를 향하던 면이 아래(ny≈-1)를 보게 되어 오버행 ← 회전 반영",
    );
    assert(
      isOver([0, 0, -1], RX90, TH) === false,
      "-Z 를 향하던 면은 위를 보게 되어 오버행 아님",
    );

    // Z축 90°: 측면 (1,0,0) → (0,1,0) 위 / (-1,0,0) → 아래.
    const RZ90 = world({ rz: 90 });
    assert(
      isOver([-1, 0, 0], RZ90, TH) === true,
      "Z축 90° 에서 -X 측면이 아래를 향해 오버행이 된다",
    );
    assert(
      isOver(SIDE, RZ90, TH) === false,
      "같은 회전에서 +X 측면은 위를 향해 오버행 아님 (반대쪽만 잡힘)",
    );
  }

  // ── §4. 균등 스케일 — 판정을 바꾸지 않는다 ────────────────────────────────
  console.log("\n(§4) 균등 스케일 — 방향을 바꾸지 않으므로 판정 불변:");
  {
    const cases = [
      ["2배 확대", world({ sx: 2, sy: 2, sz: 2 })],
      ["0.1배 축소", world({ sx: 0.1, sy: 0.1, sz: 0.1 })],
      ["2배 + 이동", world({ sx: 2, sy: 2, sz: 2, tx: 50, ty: 30, tz: -20 })],
      ["2배 + X 180° 회전", world({ sx: 2, sy: 2, sz: 2, rx: 180 })],
    ];
    for (const [label, m] of cases) {
      const flipped = label.includes("180");
      assert(
        isOver(DOWN, m, TH) === !flipped && isOver(UP, m, TH) === flipped,
        `${label}: 판정이 회전 성분만 따른다 (스케일·이동 무영향)`,
      );
    }
    // 이동만 있는 경우 — 법선 변환에서 이동 성분이 새면 즉시 깨진다.
    const T = world({ tx: 100, ty: 200, tz: 300 });
    assert(
      Math.abs(worldNy(DOWN, T) - -1) < 1e-9,
      `순수 이동에서 world ny=${worldNy(DOWN, T).toFixed(6)} (기대 -1) — 이동 성분이 새지 않음`,
    );
  }

  // ── §5. 비균등 스케일 — 역전치(inverse-transpose)를 택한 근거 ─────────────
  console.log("\n(§5) 비균등 스케일 — 역전치 변환이 기하학적으로 옳은가:");
  {
    // 45° 로 누운 아랫면: 로컬 법선 (0.7071, -0.7071, 0) — 표면은 X 로 1,
    //   Y 로 -1 진행하는 기울기 45°.
    const s = Math.SQRT1_2;
    const N45 = [s, -s, 0];

    // X 를 2배 늘리면 같은 면이 X 로 2, Y 로 -1 진행 → 기울기 atan(1/2)=26.57°.
    //   즉 **더 누운** 면이 되므로 world ny 의 절댓값이 커져야(수평에 가까워야)
    //   한다. 해석해: 정규화된 법선 y = -2/√5 = -0.8944.
    const SX2 = world({ sx: 2 });
    const ny = worldNy(N45, SX2);
    const expected = -2 / Math.sqrt(5);
    console.log(
      `       45° 아랫면 + X2배 → world ny=${ny.toFixed(4)} ` +
        `(해석해 ${expected.toFixed(4)} = 표면 기울기 ${(
          (Math.atan(1 / 2) * 180) / Math.PI
        ).toFixed(2)}°)`,
    );
    assert(
      Math.abs(ny - expected) < 1e-9,
      "역전치 변환이 해석해와 일치 — 늘린 축 방향으로 면이 완만해지는 것을 정확히 반영",
    );

    // ★ 대조: TransformNormal(= world 행렬 직접) 을 쓰면 반대 방향으로 틀린다.
    //   (0.7071·2, -0.7071, 0) → 정규화 y = -1/√5 = -0.4472 → 면이 **더 섰다**
    //   고 오판. 실제 표면은 완만해졌으므로 명백히 틀린 부호 방향이다.
    const direct = new Vector3();
    Vector3.TransformNormalFromFloatsToRef(N45[0], N45[1], N45[2], SX2, direct);
    const nyDirect = direct.y / direct.length();
    console.log(
      `       (대조) TransformNormal 직접 사용 시 ny=${nyDirect.toFixed(4)} ` +
        `— 완만해진 면을 '더 섰다'고 오판`,
    );
    assert(
      Math.abs(nyDirect - -1 / Math.sqrt(5)) < 1e-9 &&
        Math.abs(nyDirect) < Math.abs(expected),
      "행렬 직접 사용은 실제와 반대로 움직인다 → 역전치를 택한 근거",
    );

    // 그 차이가 **판정을 실제로 뒤집는** 구간이 존재한다 (이론 차이가 아님).
    //   θ=40° 기준: 올바른 ny=-0.8944 는 오버행(-cos40=-0.766 이하),
    //   틀린 ny=-0.4472 는 오버행 아님.
    assert(
      isOver(N45, SX2, 40) === true && -1 / Math.sqrt(5) > negCosOfThreshold(40),
      "θ=40° 에서 역전치는 오버행, 직접 변환은 미검출 — 판정이 갈리는 실제 구간",
    );

    // 비균등 스케일에 회전이 섞여도 성립 (합성 순서 뒤집힘 방어).
    //   X2배 + X축 180° → 45° 아랫면이 45° 윗면이 되어 오버행에서 빠진다.
    const SX2R = world({ sx: 2, rx: 180 });
    assert(
      isOver(N45, SX2R, TH) === false && worldNy(N45, SX2R) > 0,
      `비균등 스케일 + 회전 조합에서도 뒤집힘 반영 (world ny=${worldNy(N45, SX2R).toFixed(4)})`,
    );

    // Y 축으로도 같은 논리가 성립한다 (축을 가리지 않음).
    //   Y 를 0.5배로 누르면 45° 면의 높이차만 절반이 되어 표면이 **완만해진다**
    //   (기울기 45° → atan(0.5) = 26.57°). X 를 2배 늘린 것과 표면 형상이
    //   같으므로 ny 도 같은 -2/√5 가 나와야 한다.
    const SY05 = world({ sy: 0.5 });
    const nySy = worldNy(N45, SY05);
    console.log(
      `       45° 아랫면 + Y 0.5배 → world ny=${nySy.toFixed(4)} (X2배와 동일 형상이므로 같은 값)`,
    );
    assert(
      Math.abs(nySy - expected) < 1e-9 && Math.abs(nySy) > Math.abs(-s),
      "Y 를 누르면 면이 완만해져 |ny| 증가 — X 를 늘린 것과 같은 결과 (역전치가 축을 올바르게 나눔)",
    );
    // 반대로 Y 를 늘리면 면이 서고 |ny| 가 줄어든다.
    const SY2 = world({ sy: 2 });
    assert(
      Math.abs(worldNy(N45, SY2)) < Math.abs(-s),
      `Y 를 2배로 늘리면 면이 서고 |ny| 감소 (${worldNy(N45, SY2).toFixed(4)}) — 방향 일관`,
    );
  }

  // ── §6. ★ 대조군 — 구 구현(로컬 법선)은 §2 에서 FAIL 한다 ─────────────────
  console.log("\n(§6) ★ 대조군 — 구 구현(로컬 ny 만 사용)을 같은 입력에 돌린다:");
  {
    const R180 = world({ rx: 180 });

    // 구 구현은 world 행렬을 무시하므로 뒤집어도 결과가 그대로다.
    const oldUp = isOverOld(UP, R180, TH);
    const oldDown = isOverOld(DOWN, R180, TH);
    const newUp = isOver(UP, R180, TH);
    const newDown = isOver(DOWN, R180, TH);
    console.log(
      `       X180° 회전 상태 — 윗면: 구 ${oldUp} → 신 ${newUp} / ` +
        `아랫면: 구 ${oldDown} → 신 ${newDown}`,
    );
    assert(
      oldUp === false && newUp === true,
      "구 구현은 뒤집힌 윗면을 놓친다(false) — 신 구현은 잡는다(true) = 리드가 본 증상",
    );
    assert(
      oldDown === true && newDown === false,
      "구 구현은 이제 위를 보는 면을 계속 오버행으로 칠한다 = '처음 표시된 부분이 그대로'",
    );

    // 구 구현은 **어떤 회전에서도** 결과가 변하지 않는다 — 증상의 본질.
    const rots = [
      ["X 30°", world({ rx: 30 })],
      ["X 90°", world({ rx: 90 })],
      ["X 180°", world({ rx: 180 })],
      ["Z 90°", world({ rz: 90 })],
      ["XYZ 복합", world({ rx: 37, ry: -52, rz: 111 })],
    ];
    const oldResults = rots.map(([, m]) => isOverOld(DOWN, m, TH));
    const newResults = rots.map(([, m]) => isOver(DOWN, m, TH));
    console.log(
      `       아랫면 판정 — 구: [${oldResults.join(", ")}] / 신: [${newResults.join(", ")}]`,
    );
    assert(
      oldResults.every((r) => r === true),
      `구 구현은 ${rots.length}종 회전 전부에서 동일한 결과 — 회전을 전혀 반영 못 함`,
    );
    assert(
      new Set(newResults).size > 1,
      "신 구현은 회전에 따라 결과가 달라진다 — 자세를 실제로 반영",
    );

    // 무회전에서는 구/신이 일치해야 한다 (기존 동작을 망가뜨리지 않았다).
    const I = world();
    for (const [label, n] of [["아랫면", DOWN], ["윗면", UP], ["측면", SIDE]]) {
      assert(
        isOverOld(n, I, TH) === isOver(n, I, TH),
        `무회전에서 ${label} 판정이 구/신 동일 — 기준 자체는 안 바뀜`,
      );
    }
  }

  // ── §7. ★ 변조 시험 — 이 스크립트가 실제로 버그를 잡는가 ──────────────────
  console.log("\n(§7) ★ 변조 시험 — 잘못된 구현을 이 검사들이 잡아내는가:");
  {
    // 변조 1 — 정규화 생략. 스케일이 걸리면 변환 후 길이가 1 이 아니라서
    //   ny 를 그대로 -cosθ 와 비교하면 게이트가 배율만큼 밀린다.
    const SCALE = 0.3;
    const m = world({ sx: SCALE, sy: SCALE, sz: SCALE });
    const raw = new Vector3();
    const s = Math.SQRT1_2;
    // 30° 기울기 아랫면 — ny=-0.5 로 θ=45° 게이트(-0.7071) **밖**이라
    //   정상 구현은 오버행이 아니라고 판정해야 한다.
    const N30 = [Math.cos(deg2rad(30)), -Math.sin(deg2rad(30)), 0];
    Vector3.TransformNormalFromFloatsToRef(
      N30[0],
      N30[1],
      N30[2],
      normalMatrixFromWorld(m),
      raw,
    );
    // 역전치 + 균등 축소(0.3) → 법선 길이가 1/0.3 ≈ 3.33 배로 늘어난다.
    const tamperNoNorm = raw.y <= negCosOfThreshold(TH); // 정규화 생략.
    const correct = isOver(N30, m, TH); // 정규화 적용.
    console.log(
      `       변조1 표본: 30° 아랫면 + 균등 ${SCALE}배 축소, 변환 후 법선 길이 ${raw.length().toFixed(3)} ` +
        `(정규화 전 ny=${raw.y.toFixed(3)} / 후 ${(raw.y / raw.length()).toFixed(3)})`,
    );
    assert(
      raw.length() > 1.5 && Math.abs(raw.length() - 1) > 1e-6,
      "스케일이 걸리면 변환 후 법선 길이가 1 이 아니다 — 정규화가 필요한 이유",
    );
    assert(
      tamperNoNorm === true && correct === false,
      "변조1(정규화 생략) → 30° 면(게이트 밖)을 오버행으로 오판, 정상 구현은 제외 = (§4) 가 FAIL 로 잡음",
    );
    // 축소가 아니라 확대면 반대로 **과소검출**이 된다 — 같은 버그의 다른 얼굴.
    const big = world({ sx: 3, sy: 3, sz: 3 });
    const rawBig = new Vector3();
    const N60 = [Math.cos(deg2rad(60)), -Math.sin(deg2rad(60)), 0]; // ny=-0.866, 오버행.
    Vector3.TransformNormalFromFloatsToRef(
      N60[0],
      N60[1],
      N60[2],
      normalMatrixFromWorld(big),
      rawBig,
    );
    assert(
      rawBig.y > negCosOfThreshold(TH) && isOver(N60, big, TH) === true,
      "변조1 은 3배 확대 시 60° 진짜 오버행을 놓친다(과소검출) — 정상 구현은 검출",
    );

    // 변조 2 — 부호 뒤집기(ny >= +cosθ, 즉 윗면을 오버행으로). 무회전에서
    //   즉시 (§1) 이 깨진다.
    const I = world();
    const tamperFlip = (n) => -n[1] <= negCosOfThreshold(TH);
    assert(
      tamperFlip(UP) === true && isOver(UP, I, TH) === false,
      "변조2(부호 뒤집기) → 무회전 윗면을 오버행으로 오판 = (§1) 이 FAIL 로 잡음",
    );
    assert(
      tamperFlip(DOWN) === false && isOver(DOWN, I, TH) === true,
      "변조2 는 무회전 아랫면도 놓친다 = (§1) 이 FAIL 로 잡음",
    );

    // 변조 3 — 임계 비교를 cos 대신 각도 그대로 쓰기(라디안/도 혼동).
    //   negCosOfThreshold 가 실제로 cos 를 통과하는지 sanity.
    assert(
      Math.abs(negCosOfThreshold(0) - -1) < 1e-12 &&
        Math.abs(negCosOfThreshold(90) - 0) < 1e-12 &&
        Math.abs(negCosOfThreshold(45) - -s) < 1e-12,
      "negCosOfThreshold: 0°→-1, 45°→-0.7071, 90°→0 (도 단위 cos 정상)",
    );
  }

  // ── §8. 퇴화·경계 입력 방어 ───────────────────────────────────────────────
  console.log("\n(§8) 퇴화 입력 · 결정성:");
  {
    const I = world();
    assert(
      isOver([0, 0, 0], I, TH) === false,
      "길이 0 법선 → 판정 불가, 안전면으로 처리 (NaN 누출 없음)",
    );
    // 스케일 0 이 섞이면 world 행렬이 특이행렬 → Invert 결과가 유한하지 않을 수
    //   있다. 예외로 죽지 않고 boolean 을 돌려주는지만 확인한다.
    const degenerate = world({ sy: 0 });
    const r = isOver(DOWN, degenerate, TH);
    assert(
      typeof r === "boolean",
      `퇴화 스케일(sy=0) 에서도 예외 없이 boolean 반환 (${r}) — 색칠이 중단되지 않음`,
    );
    // 결정성 — 재사용 버퍼를 쓰므로 이전 호출이 다음 호출을 오염시키면 안 된다.
    const R = world({ rx: 180 });
    const seq1 = [isOver(UP, R, TH), isOver(DOWN, R, TH), isOver(SIDE, R, TH)];
    const seq2 = [isOver(UP, R, TH), isOver(DOWN, R, TH), isOver(SIDE, R, TH)];
    assert(
      JSON.stringify(seq1) === JSON.stringify(seq2),
      "같은 입력 반복 호출 → 동일 결과 (재사용 버퍼 오염 없음)",
    );
    // 버퍼를 공유해도 순서를 바꾼 호출이 서로 간섭하지 않는다.
    const a = isOver(UP, R, TH);
    isOver(SIDE, world({ ry: 33 }), TH); // 사이에 낀 다른 호출.
    assert(a === isOver(UP, R, TH), "중간에 다른 호출이 끼어도 결과 불변");
  }

  // ── §9. 서포트 검출과 같은 기준인가 (수용 기준 5) ─────────────────────────
  console.log("\n(§9) 서포트 검출(slice-section)과 동일한 world 기준인가:");
  {
    // slice-section.extractWorldTriangles 는 getWorldMatrix() 로 **정점**을
    //   world 로 옮긴다. 그렇게 옮긴 삼각형에서 직접 계산한 면 법선과,
    //   우리가 로컬 법선을 역전치로 옮긴 법선의 **방향이 일치**해야 같은 기준이다.
    const T = world({ rx: 37, ry: -52, rz: 111, sx: 1.7, sy: 0.6, sz: 2.3 });

    // 로컬 삼각형 하나(아랫면 조각) — 로컬 법선은 외적으로 구한다.
    const p0 = new Vector3(0, 0, 0);
    const p1 = new Vector3(1, 0, 0);
    const p2 = new Vector3(0.3, -0.8, 1); // 임의 기울기.
    const localN = Vector3.Cross(p1.subtract(p0), p2.subtract(p0)).normalize();

    // (a) 정점을 world 로 옮긴 뒤 외적 — slice-section 방식.
    const w0 = Vector3.TransformCoordinates(p0, T);
    const w1 = Vector3.TransformCoordinates(p1, T);
    const w2 = Vector3.TransformCoordinates(p2, T);
    const nFromVerts = Vector3.Cross(w1.subtract(w0), w2.subtract(w0)).normalize();

    // (b) 로컬 법선을 역전치로 옮김 — overhang.ts 방식.
    const nFromNormal = new Vector3();
    Vector3.TransformNormalFromFloatsToRef(
      localN.x,
      localN.y,
      localN.z,
      normalMatrixFromWorld(T),
      nFromNormal,
    );
    nFromNormal.normalize();

    const dot = Vector3.Dot(nFromVerts, nFromNormal);
    console.log(
      `       정점기반 법선 (${nFromVerts.x.toFixed(4)}, ${nFromVerts.y.toFixed(4)}, ${nFromVerts.z.toFixed(4)}) vs ` +
        `역전치 법선 (${nFromNormal.x.toFixed(4)}, ${nFromNormal.y.toFixed(4)}, ${nFromNormal.z.toFixed(4)}) → dot=${dot.toFixed(6)}`,
    );
    assert(
      Math.abs(dot - 1) < 1e-6,
      "비균등 스케일 + 복합 회전에서도 두 경로의 world 법선이 완전히 일치 — 표시와 검출이 같은 기준",
    );

    // ★ 대조: 구 구현(로컬 법선 그대로) 은 같은 조건에서 크게 어긋난다.
    const dotOld = Vector3.Dot(nFromVerts, localN);
    console.log(`       (대조) 구 구현의 로컬 법선과 정점기반 법선 dot=${dotOld.toFixed(6)}`);
    assert(
      Math.abs(dotOld - 1) > 0.1,
      `구 구현은 검출 기준과 어긋나 있었다 (dot=${dotOld.toFixed(4)} ≠ 1) — 표시/실제 불일치의 수치 증거`,
    );
  }

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
