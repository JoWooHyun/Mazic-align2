/**
 * 축 표시 규약 — 내부 Y-up ↔ 표시 Z-up (B-13).
 *
 * ## 왜 표시 레이어에서만 바꾸는가
 *
 * 리드 요구는 "밑에 평면이 X,Y 평면이면 좋겠다" = **프린터 관례대로 Z 를 높이로
 * 표기**하라는 뜻이다(CHITUBOX 실물 캡처 ① 에서 Z=위, Y=안쪽, X=옆 확인).
 * 그런데 이 코드베이스의 내부 좌표계는 Babylon 기본 **Y-up** 이고,
 * `sliceTrianglesAtY` 를 비롯한 슬라이서·CTB·G-code·서포트 코어 약 35~40 파일이
 * "Y = 높이" 를 전제로 한다. 내부를 바꾸면 **출력물이 직접 바뀌고**
 * margin-detect(잠금 영역)까지 건드리게 된다.
 *
 * 그래서 **내부는 Y-up 그대로 두고 표시 레이어에서만 Z-up 으로 보여준다.**
 * 이건 새로 만든 규약이 아니라 이미 이 코드베이스에 있는 패턴이다 —
 * `utils/gcode/fdm-gcode.ts:12-13` 이 "Babylon (X,Z) → G-code (X,Y) /
 * Babylon Y(높이) → G-code Z" 로 똑같이 환산한다. 즉 **"내부 Y-up / 외부 Z-up"
 * 이 기존 규약**이고, 표시 레이어도 같은 방식이라 일관적이다.
 *
 * ## 매핑
 *
 * ```
 *   표시 = (x, −z, y)      dispX = intX,  dispY = −intZ,  dispZ = intY
 *   내부 = (x,  z, −y)     intX = dispX,  intY = dispZ,   intZ = −dispY
 * ```
 *
 * **부호가 핵심이다.** 단순 스왑 `(x, z, y)` 는 행렬식이 **−1(반사)** 이라
 * 좌표축 라벨은 맞아 보여도 **모든 회전 부호가 뒤집힌다**(사용자가 +90° 를
 * 넣으면 −90° 로 도는 버그). `−z` 를 써야 행렬식이 **+1(순수 회전)** 이 되어
 * 회전 방향이 보존된다. `scripts/verify-axis-display.mjs` 의 (b)·(c) 가
 * 두 후보의 행렬식과 회전 부호를 실제로 계산해 이를 증명한다.
 *
 * 검산: 내부 +Y(위) → 표시 (0, 0, 1) = +Z(위) ✅ / 내부 +Z(안쪽) → 표시 (0, −1, 0)
 *
 * ## 회전 — 단순 성분 교환은 틀린다
 *
 * 위치·스케일과 달리 **회전은 성분을 바꿔 끼우면 안 된다.** 축 치환이
 * Euler 합성 순서(Babylon 은 YXZ)와 교환되지 않기 때문이다. 실측:
 *
 * ```
 *   내부 (10, 20, 30) → 올바른 표시 (18.199, −26.132, 13.056)
 *                       단순 교환    (10,     −30,     20)     ← 전혀 다르다
 * ```
 *
 * 단축 회전(한 성분만 0 이 아닌 경우)만 우연히 일치해서, 단축으로만 검증하면
 * 이 결함을 놓친다. 올바른 방법은 **회전을 좌표 변환으로 켤레(conjugate)** 하는
 * 것이다. `R_disp = M · R_int · M⁻¹`.
 *
 * 여기서 M 자체가 회전(det +1)이므로 quaternion 으로 표현할 수 있다 —
 * M 은 `e_y → (0,0,1)`, `e_z → (0,−1,0)` 이고 이는 Babylon 에서
 * **X 축 +90° 회전**과 정확히 같다. 따라서 켤레는 quaternion 곱 하나로 끝난다.
 *
 * ```
 *   q_disp = qM · q_int · qM⁻¹        (qM = RotationAxis(X, +90°))
 *   q_int  = qM⁻¹ · q_disp · qM
 * ```
 *
 * 이 방식은 왕복 무손실이고(내적 1.000000000), 짐벌 구간에서도 성립한다.
 */
import { Quaternion, Vector3 } from "@babylonjs/core";

/** 축 3성분 벡터 (위치·스케일 공용). */
export type Vec3 = [number, number, number];

/**
 * 내부 → 표시 좌표축 변환. `(x, y, z)_int → (x, −z, y)_disp`.
 *
 * 위치(mm)·방향벡터에 쓴다. 스케일은 부호가 없으므로 `toDisplayScale` 을 쓸 것.
 */
export function toDisplayAxes(v: Vec3): Vec3 {
  return [v[0], -v[2], v[1]];
}

/**
 * 표시 → 내부 좌표축 변환. `toDisplayAxes` 의 정확한 역함수라 왕복 무손실.
 */
export function fromDisplayAxes(v: Vec3): Vec3 {
  return [v[0], v[2], -v[1]];
}

/**
 * 스케일 축 교환. **부호를 붙이지 않는다** — 배율에 음수 부호를 넣으면
 * 모델이 뒤집히므로, 축만 바꿔 끼운다. `dispSY = intSZ`, `dispSZ = intSY`.
 *
 * 대칭이라 역변환도 같은 함수다(자기 자신이 역함수).
 */
export function swapScaleAxes(s: Vec3): Vec3 {
  return [s[0], s[2], s[1]];
}

/**
 * 표시 축 변환에 대응하는 회전 quaternion (M 을 quaternion 으로 표현한 것).
 *
 * `e_y → (0,0,1)`, `e_z → (0,−1,0)` 이므로 Babylon 좌표계에서 X 축 +90°.
 */
function displayBasisQuaternion(): Quaternion {
  return Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI / 2);
}

/**
 * 내부 회전 quaternion → 표시 규약의 quaternion. `q_disp = qM · q_int · qM⁻¹`.
 *
 * 성분 교환이 아니라 **켤레**다 — 위 모듈 주석의 근거 참고.
 */
export function toDisplayQuaternion(q: Quaternion): Quaternion {
  const qm = displayBasisQuaternion();
  return qm.multiply(q).multiply(Quaternion.Inverse(qm));
}

/**
 * 표시 quaternion → 내부 quaternion. `q_int = qM⁻¹ · q_disp · qM`.
 */
export function fromDisplayQuaternion(q: Quaternion): Quaternion {
  const qm = displayBasisQuaternion();
  return Quaternion.Inverse(qm).multiply(q).multiply(qm);
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * 내부 Euler 각(도, XYZ 표기) → 표시 Euler 각(도).
 *
 * quaternion 을 경유한다. 성분 교환으로 대체하면 복합 회전에서 틀린다.
 */
export function toDisplayEulerDeg(r: Vec3): Vec3 {
  const q = Quaternion.FromEulerAngles(
    r[0] * DEG_TO_RAD,
    r[1] * DEG_TO_RAD,
    r[2] * DEG_TO_RAD,
  );
  const e = toDisplayQuaternion(q).toEulerAngles();
  return [e.x * RAD_TO_DEG, e.y * RAD_TO_DEG, e.z * RAD_TO_DEG];
}

/**
 * 표시 Euler 각(도) → 내부 Euler 각(도). `toDisplayEulerDeg` 의 역.
 *
 * Euler 표현은 다대일(같은 자세를 여러 각으로 쓸 수 있다)이라 각 성분이
 * 원래 숫자로 되돌아오지 않을 수 있지만, **자세(quaternion)는 정확히 왕복**한다.
 */
export function fromDisplayEulerDeg(r: Vec3): Vec3 {
  const q = Quaternion.FromEulerAngles(
    r[0] * DEG_TO_RAD,
    r[1] * DEG_TO_RAD,
    r[2] * DEG_TO_RAD,
  );
  const e = fromDisplayQuaternion(q).toEulerAngles();
  return [e.x * RAD_TO_DEG, e.y * RAD_TO_DEG, e.z * RAD_TO_DEG];
}

/**
 * 표시 축 라벨. 인덱스 0/1/2 = 표시 X/Y/Z.
 *
 * 색은 프린터 관례(X 빨강, Y 초록, Z 파랑)를 그대로 쓴다. 내부 축과의 대응은
 * 위 매핑에 따라 **표시 Z(파랑) = 내부 Y(위)** 이므로, 화면에서 위로 뻗는 선이
 * 파랑이어야 규약과 맞는다.
 */
export const DISPLAY_AXIS_LABELS = ["X", "Y", "Z"] as const;
