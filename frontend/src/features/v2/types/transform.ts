/**
 * v2 모델 변환.
 *
 * **저장 좌표계는 Babylon (Y-up)** — 슬라이서·서포트·G-code 코어가 전부
 * "Y = 높이" 를 전제하므로 이 의미는 절대 바꾸지 않는다.
 * 회전은 Euler degrees, XYZ 순서.
 *
 * ⚠️ 다만 **사용자 UI 표기는 Z-up** 이다 (B-13). TransformPanel 이 표시 직전에
 * `types/axis-display.ts` 로 환산하고 입력 시 역환산한다. 즉 이 인터페이스의
 * `ty` 가 높이이고, 화면에 "Z" 로 보이는 값이 그것이다. 두 개를 혼동하지 말 것.
 *
 * 옛 Transform 과 무관. quaternion 이 아닌 Euler 로 보관해 UI 표시가
 * 단순하다.
 */
export interface TransformV2 {
  tx: number; ty: number; tz: number; // mm
  rx: number; ry: number; rz: number; // deg
  sx: number; sy: number; sz: number; // 배율
}

export const IDENTITY_TRANSFORM: TransformV2 = {
  tx: 0, ty: 0, tz: 0,
  rx: 0, ry: 0, rz: 0,
  sx: 1, sy: 1, sz: 1,
};

export function isIdentity(t: TransformV2): boolean {
  return (
    t.tx === 0 && t.ty === 0 && t.tz === 0 &&
    t.rx === 0 && t.ry === 0 && t.rz === 0 &&
    t.sx === 1 && t.sy === 1 && t.sz === 1
  );
}

export function transformsEqual(a: TransformV2, b: TransformV2): boolean {
  return (
    a.tx === b.tx && a.ty === b.ty && a.tz === b.tz &&
    a.rx === b.rx && a.ry === b.ry && a.rz === b.rz &&
    a.sx === b.sx && a.sy === b.sy && a.sz === b.sz
  );
}

/** 부동소수 노이즈로 무효화가 튀지 않도록 하는 비교 허용치 (mm·배율 등 성분 비교용). */
const REDESIGN_VALID_EPS = 1e-6;

/**
 * 기둥 기울기 비교용 허용치 — **degree**(수직에서 벗어난 각도).
 *
 * mm 단위인 `REDESIGN_VALID_EPS` 와 **일부러 분리**했다. 같은 숫자를 쓰면 단위가
 * 다른 두 양에 같은 잣대를 대는 셈이라 의미가 없다.
 *
 * 값 근거 (B-15c, NullEngine 실측):
 *   · **노이즈 상한 1.2e-4°** — Babylon 은 행렬을 Float32Array 로 보관해서,
 *     피벗 프록시 `setParent` → decompose 왕복에 float32 반올림이 낀다. 수직축
 *     회전만 걸어도 기울기가 최대 1.18e-4° 흔들린다(기준 자세 9종 × 각도 5종).
 *   · **잡아야 하는 신호 0.025°+** — 실제로 0.1° 기울이면 이 값이 자세에 따라
 *     0.025°~0.1° 변한다. 즉 최악의 자세에서도 신호가 노이즈의 200배 위다.
 *   0.01° 는 노이즈의 약 85배 위, 최소 신호(0.025°)의 약 1/2.5 아래라 양쪽으로
 *   여유가 있다. 출력물 기준으로도 0.01° 기울기는 100mm 기둥에서 17µm 로
 *   레이어 두께(50µm) 미만이라 실사용상 수직이다.
 */
const REDESIGN_TILT_EPS_DEG = 0.01;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * 자세 `t` 에서 **모델 로컬 up (0,1,0) 이 world 수직(+Y)에서 벗어난 각도(deg)**.
 * 0 이면 기둥이 완전히 수직, 90 이면 옆으로 누웠다.
 *
 * ## 왜 cos 값이 아니라 각도인가
 * up 의 world Y 성분 자체(= cos 기울기)는 **수직 근처에서 2차로 둔감**하다.
 * `1-cos(t) ~ t²/2` 라 항등 자세에서 0.1° 기울여도 1.5e-6 밖에 안 변해
 * float32 노이즈(2e-6)에 묻힌다 — 임계값을 어디에 둬도 "항등 근처 미세 기울임"
 * 과 "노이즈" 를 가를 수 없다. `acos` 로 각도화하면 **모든 자세에서 1차**가 되어
 * 감도가 균일해진다(실측: 0.1° 기울임이 어느 자세에서도 0.025° 이상으로 보임).
 * `acos` 는 단조함수라 아래의 수직축 불변성은 그대로 보존된다.
 *
 * ## Babylon 합성 관례 (직접 구현하므로 반드시 일치시킬 것)
 * Babylon 의 `Quaternion.FromEulerAngles(x, y, z)` 는 `RotationYawPitchRoll(y, x, z)`
 * 와 **완전히 동일**하고(실측 차 0), 그 회전행렬은 **R = Ry(y) · Rx(x) · Rz(z)** 다.
 * 즉 Y(yaw)가 가장 바깥이다 — 이것이 순수 `ry` 델타가 이 값을 바꾸지 않는 이유다.
 *   R 의 (row=1,col=1) 성분(= 로컬 up 의 world Y)을 전개하면 Ry 는 2행/2열에
 *   관여하지 않으므로 **cos(rx)·cos(rz)** 만 남는다 → `ry` 에 대해 **정확히 불변**.
 * 이 유도는 `scripts/verify-transform-invalidate.mjs` (h) 에서 Babylon 실측
 * 행렬값과 하드코딩 대조로 검증한다.
 *
 * **Babylon 을 import 하지 않는다** — 이 파일은 헤드리스 검증 대상이다(B-1).
 */
function uprightTiltDeg(t: TransformV2): number {
  const upWorldY = Math.cos(t.rx * DEG_TO_RAD) * Math.cos(t.rz * DEG_TO_RAD);
  // 부동소수 오차로 |cos| 가 1 을 아주 살짝 넘으면 acos 가 NaN 이 된다.
  return Math.acos(Math.max(-1, Math.min(1, upWorldY))) * RAD_TO_DEG;
}

/**
 * start→end 변형이 **재설계 서포트(kind='island'|'slope')를 유효하게 두는지** (B-1).
 *
 * 재설계 서포트는 stl-local 좌표로 모델에 부착돼 변형을 그대로 따라간다. 그래서
 * 모델을 기울이면 기둥이 함께 기울어 출력이 불가능해진다 → 리드 확정 정책은
 * CHITUBOX 식 무효화(삭제 + 안내).
 *
 * **예외 1: 순수 XZ 평행이동**. 서포트 전체가 수평으로 같이 움직여도 기둥의 수직성과
 * 바닥 접지(Y=0)가 그대로 보존되므로 기하학적으로 여전히 유효하다 → 유지한다.
 *
 * **예외 2: 수직축(내부 Babylon Y) 회전** (B-15). 모델이 팽이처럼 제자리에서 돌 뿐
 * 기둥은 여전히 수직이고 접지 높이도 그대로다 → 예외 1과 완전히 같은 논리로 유지한다.
 * 정책 설계 때 "회전 = 기둥이 기울어짐" 으로 세 축을 뭉뚱그린 탓에 이 축까지 삭제하고
 * 있었다 — **리드 실물 테스트에서 "바닥과 수평인 노란 링을 돌려도 서포트가 사라진다"
 * 로 발견**됐다.
 *
 * ## 판정 방식: Euler 성분 비교 → **기하학적 불변량** (B-15c)
 *
 * B-15 는 `ry` 항만 빼는 방식이었는데 **실물에서 여전히 삭제됐다**. 원인은 `ry` 가
 * 아니라 **`rx`/`rz` 성분 비교 자체**였다:
 *   Babylon 은 행렬을 `Float32Array` 로 보관한다. 회전 기즈모는 피벗 프록시에
 *   `setParent` 로 붙였다 떼는데(B-9), 이 왕복의 decompose 에 float32 반올림이
 *   껴서 **수직축 회전만 해도 `rx`/`rz` 가 1e-6~1.2e-4° 씩 흔들린다**. 옛 허용치가
 *   1e-6 이라 이 노이즈가 그대로 "기울임" 으로 오판됐다. (NullEngine 실측: 기준
 *   자세 `rx=15,ry=-30,rz=45` 에서 drx=1e-6, `rx=89.5` 부근에서 drx=1.25e-4)
 *
 * 그래서 판정을 성분 비교가 아니라 **"기둥이 기울었는가" 의 진짜 정의**로 바꾼다:
 *   **모델 로컬 up (0,1,0) 이 수직에서 벗어난 각도**(`uprightTiltDeg`)가 보존되면
 *   기둥은 여전히 수직이다. 이 값은
 *     · 수직축(world Y) 회전에 대해 **정확히 불변**이고,
 *     · `rx`/`rz`/`ry` 를 개별로 볼 필요가 없으며,
 *     · Euler 재분해의 표현 분기(gimbal 근처에서 `rz` 를 0 으로 접는 등)와 무관하다.
 *   Euler 각이 어떻게 재분해되든 up 벡터라는 **기하학적 실체**는 하나뿐이다.
 *
 * 스케일은 `sy` 는 물론 균일 스케일도 접점 위치·접지가 달라지므로 전부 무효다.
 * `ty`(수직 이동)도 접지가 깨지므로 현행대로 무효 유지 (별건 B-18 리드 결정 대기).
 *
 * 따라서 **기둥 기울기 각도**·sx/sy/sz(스케일)·ty(수직 이동) 중 하나라도 실제로
 * 바뀌면 무효(false), tx/tz(수평 이동)와 수직축 회전만이면 유효(true).
 *
 * ⚠️ 여기 rx/ry/rz 는 **내부 Babylon 축(Y-up)** 이다. B-13 이 바꾼 것은 표시뿐이라
 * 화면에 "Z축 회전" 으로 보이는 것이 내부 `ry` 다. 혼동하지 말 것.
 */
export function transformKeepsRedesignValid(
  start: TransformV2,
  end: TransformV2,
): boolean {
  const changed = (a: number, b: number) =>
    Math.abs(a - b) > REDESIGN_VALID_EPS;
  // 회전은 rx/ry/rz 를 **개별로 보지 않는다** — 성분 비교는 float32 노이즈와
  //   Euler 재분해 분기에 취약하다(위 B-15c). 기둥 수직성이라는 불변량 하나로
  //   판정하면 세 축을 어떻게 재분해했든 결과가 같다.
  const tilted =
    Math.abs(uprightTiltDeg(start) - uprightTiltDeg(end)) > REDESIGN_TILT_EPS_DEG;
  // 스케일·ty 는 단위가 있는 성분이라 지금까지처럼 성분 비교 그대로 (정책 무변경).
  return !(
    tilted ||
    changed(start.sx, end.sx) ||
    changed(start.sy, end.sy) ||
    changed(start.sz, end.sz) ||
    changed(start.ty, end.ty)
  );
}
