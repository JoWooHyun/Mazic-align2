/**
 * 축 표시 규약 — 내부 world(Babylon Y-up) ↔ 표시(= STL 좌표 = 베드 좌표, Z-up).
 *
 * 수치 패널·뷰포트 좌표 숫자는 **STL 파일 좌표 = Task0 베드 좌표**(원점만 다름)다.
 * 다른 슬라이서(CHITUBOX·PrusaSlicer)와 같은 숫자, 같은 회전 방향(오른손 규칙)이다
 * (리드 결정 2026-10-12 "다른 슬라이서처럼", 2026-10-15 실행 — 인수인계_20261013 §3-1·§4-2 #1).
 *
 * ## 왜 표시 레이어에서만 바꾸는가 (B-13)
 *
 * 이 코드베이스의 내부 좌표계는 Babylon 기본 **Y-up** 이고, `sliceTrianglesAtY` 를 비롯한
 * 슬라이서·마스크·G-code·서포트 코어 약 35~40 파일이 "Y = 높이" 를 전제로 한다. 내부를 바꾸면
 * **출력물이 직접 바뀌고** margin-detect(잠금 영역)까지 건드리게 된다.
 * 그래서 **내부는 Y-up 그대로 두고 표시 레이어에서만 Z-up 으로 보여준다** — `utils/gcode/fdm-gcode.ts`
 * 가 "Babylon (X,Z) → G-code (X,Y) / Babylon Y(높이) → G-code Z" 로 환산하는 것과 같은 규약이다.
 * 저장값 TransformV2(내부 Euler) 의 의미는 이 모듈과 무관하게 그대로다.
 *
 * ## 매핑 — y/z 교환(반사)
 *
 * ```
 *   표시 = (x, z, y)      dispX = wX,  dispY = wZ,  dispZ = wY
 *   내부 = (x, z, y)      같은 식 — 자기 자신이 역함수 (M · M = I)
 * ```
 *
 * 근거(전부 코드 사실):
 *   - Babylon `STLFileLoader` 는 STL (sx, sy, sz) 를 world (sx, sz, sy) 로 넣는다 — y/z 교환(det −1).
 *     우리 `utils/stl-loader.ts` 는 그 위에 회전을 더 얹지 않는다(2026-10-13 #140, CLAUDE.md 함정 "STL 축").
 *   - Task0 베드 좌표(`utils/task0/task0-frame.ts` worldToBed): 베드 X = wX + W/2, 베드 Y = wZ + D/2, 높이 = wY.
 *   → 표시를 **로더 교환의 역**(= 같은 교환)으로 잡으면 표시 = STL 좌표 = 베드 좌표(원점 오프셋만 다름).
 *     물리 축은 X = 오른쪽, Y = 안쪽(Front 카메라에서 멀어지는 쪽), Z = 위 — 오른손 좌표계다.
 *
 * 검산: world +Y(위) → 표시 +Z / world +Z(안쪽) → 표시 +Y / STL (1, 2, 3) → world (1, 3, 2) → 표시 (1, 2, 3).
 *
 * ## 회전 — 행렬 켤레 (quaternion 켤레는 못 쓴다)
 *
 * 위치·스케일은 성분을 바꿔 끼우면 끝나지만 **회전은 성분 교환으로 환산하면 안 된다.**
 * 단축 회전만 우연히 맞고(표시 X = −내부 X, 표시 Y = −내부 Z, 표시 Z = −내부 Y) 복합 회전은
 * Euler 합성 순서가 축 교환과 맞지 않아 틀린다. 표시 프레임에서 본 회전은 좌표 변환의 **켤레**다:
 *
 * ```
 *   R_disp = M · R_int · M⁻¹ = M · R_int · M        (M = y/z 교환 행렬, M⁻¹ = M)
 *   R_int  = M · R_disp · M
 * ```
 *
 * M 이 반사(det −1)라 quaternion 으로 나타낼 수 없다 — 종전처럼 `qM · q · qM⁻¹` 로는 못 한다.
 * 그래서 3×3 행렬로 켤레한다(양쪽에 M 을 곱하기 = 행과 열의 y/z 를 **함께** 맞바꾸기).
 * det(R_disp) = det(M)² · det(R_int) = +1 이므로 R_disp 는 표시(오른손) 프레임의 순수 회전이다.
 * 한쪽만 곱하면(M · R) det −1 인 반사가 되어 회전이 아니다.
 * 근거·대조군은 `scripts/verify-axis-display.mjs` (c)·(d)·(e).
 *
 * ## 표시 Euler 규약 — 이 모듈이 정한다 (Babylon 내부 규약을 그대로 쓰지 않는다)
 *
 * 표시 Euler (α, β, γ)° = **고정축 X → Y → Z 순서 회전**(extrinsic XYZ), 오른손 규칙, 열벡터(v' = R · v):
 *
 * ```
 *   R_disp = Rz(γ) · Ry(β) · Rx(α)
 *   Rx(a) = [[1, 0, 0], [0, c, −s], [0, s, c]]
 *   Ry(b) = [[c, 0, s], [0, 1, 0], [−s, 0, c]]
 *   Rz(g) = [[c, −s, 0], [s, c, 0], [0, 0, 1]]
 * ```
 *
 * PrusaSlicer 의 회전 합성(Rz · Ry · Rx)과 같은 식이다. 물리 의미(검증 (c)):
 * 표시 Z +90° = 위에서 봐서 반시계(베드 +X → +Y), X +90° = 베드 +Y → +Z, Y +90° = 베드 +Z → +X.
 * 행렬 → Euler 는 β = atan2(−R20, √(R00² + R10²)), α = atan2(R21, R22), γ = atan2(R10, R00)
 * (β = ±90° 짐벌이면 γ = 0, α = atan2(−R12, R11)). 범위: α·γ ∈ [−180, 180], β ∈ [−90, 90].
 *
 * 내부 쪽(TransformV2 rx/ry/rz)은 Babylon 규약 그대로 — `Quaternion.FromEulerAngles` 로 만들고
 * `toEulerAngles` 로 되돌린다(메쉬에 실제로 거는 식 `utils/transform.ts` 와 같다).
 * quaternion ↔ 행렬은 표준식(열벡터 — Babylon `Matrix.FromQuaternionToRef` 의 전치와 같다)을
 * float64 로 직접 계산한다. Babylon Matrix 는 Float32Array 라 왕복마다 1e-7 찌꺼기가 붙는다.
 *
 * ## 종전 (x, −z, y) 회전 켤레를 썼던 이유와 #140 뒤 틀린 이유
 *
 * B-13(2026-07) 은 표시 = (x, −z, y) 였다. det +1 인 순수 회전(Babylon X 축 +90°)이라 quaternion 켤레
 * 한 번으로 회전까지 옮길 수 있었고, 당시 검증은 "단순 교환 (x, z, y) 는 반사라 회전 부호가 뒤집힌다" 를
 * 단언했다. 그때 STL 로더는 로더 교환 위에 X −90° 가 한 번 더 걸려 **STL Y 가 위**였으므로(치과 STL 이
 * 90° 눕혀 읽힘) 표시 숫자가 STL 과 같은지는 애초에 맞출 수 없었다.
 * 2026-10-13 #140 이 그 X −90° 를 걷어 STL Z 가 위가 되자 (x, −z, y) 는 **표시 Y = −STL Y = −(베드 Y − D/2)**
 * 로 보이게 됐다(Z 는 맞음). 표시 프레임이 베드 프레임의 Y 거울상(왼손)이라 표시 X·Z 축 회전의 물리
 * 방향도 다른 슬라이서와 반대였다.
 * "반사는 회전 부호를 뒤집는다" 는 종전 단언은 **회전을 성분 교환으로 옮길 때** 맞는 말이다.
 * 회전을 행렬로 켤레하면 반사 매핑에서도 물리 회전은 그대로 옮겨지고, 로더 교환을 정확히 되돌리는
 * 이 매핑이 오히려 오른손 표시 프레임을 준다.
 */
import { Quaternion } from "@babylonjs/core";

/** 축 3성분 벡터 (위치·스케일 공용). */
export type Vec3 = [number, number, number];

/**
 * 3×3 행렬 — 행 우선 9성분 `[R00, R01, R02, R10, R11, R12, R20, R21, R22]`, 열벡터 규약(v' = R · v).
 */
type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * 내부 → 표시 좌표축 변환. `(x, y, z)_world → (x, z, y)_disp` = STL·베드 축.
 *
 * 위치(mm)·방향벡터에 쓴다. 베드 좌표와는 원점만 다르다(베드 X = 표시 X + W/2, 베드 Y = 표시 Y + D/2).
 */
export function toDisplayAxes(v: Vec3): Vec3 {
  return [v[0], v[2], v[1]];
}

/**
 * 표시 → 내부 좌표축 변환. y/z 교환은 자기 자신이 역함수라 `toDisplayAxes` 와 같은 식 — 왕복 무손실.
 */
export function fromDisplayAxes(v: Vec3): Vec3 {
  return [v[0], v[2], v[1]];
}

/**
 * 스케일 축 교환. `dispSY = intSZ`, `dispSZ = intSY`. 위치와 같은 y/z 교환이고
 * 배율·크기에는 부호가 붙지 않는다(음수 배율 = 모델 뒤집힘). 자기 자신이 역함수.
 */
export function swapScaleAxes(s: Vec3): Vec3 {
  return [s[0], s[2], s[1]];
}

/**
 * quaternion → 회전 행렬 (표준식, 열벡터). Babylon `Matrix.FromQuaternionToRef` 결과의 전치와 같다.
 */
function quaternionToMat3(q: Quaternion): Mat3 {
  const { x, y, z, w } = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

/**
 * 회전 행렬 → quaternion (Shepperd 방식 — 대각합이 작아도 안정). `quaternionToMat3` 의 역.
 */
function mat3ToQuaternion(r: Mat3): Quaternion {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = r;
  const trace = r00 + r11 + r22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return new Quaternion((r21 - r12) * s, (r02 - r20) * s, (r10 - r01) * s, 0.25 / s);
  }
  if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
    return new Quaternion(0.25 * s, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s);
  }
  if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
    return new Quaternion((r01 + r10) / s, 0.25 * s, (r12 + r21) / s, (r02 - r20) / s);
  }
  const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
  return new Quaternion((r02 + r20) / s, (r12 + r21) / s, 0.25 * s, (r10 - r01) / s);
}

/**
 * 반사 켤레 `M · R · M` (M = y/z 교환 행렬, M⁻¹ = M) — 행과 열의 y/z 를 **함께** 맞바꾼다.
 * 내부 → 표시, 표시 → 내부 모두 이 함수 하나다(M · (M · R · M) · M = R).
 */
function conjugateBySwapYZ(r: Mat3): Mat3 {
  return [
    r[0], r[2], r[1],
    r[6], r[8], r[7],
    r[3], r[5], r[4],
  ];
}

/**
 * 표시 Euler (라디안) → 회전 행렬. `R = Rz(γ) · Ry(β) · Rx(α)` — 모듈 주석의 규약.
 */
function eulerXyzToMat3(a: number, b: number, g: number): Mat3 {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);
  return [
    cb * cg, sa * sb * cg - ca * sg, ca * sb * cg + sa * sg,
    cb * sg, sa * sb * sg + ca * cg, ca * sb * sg - sa * cg,
    -sb, sa * cb, ca * cb,
  ];
}

/** 짐벌(β = ±90°) 판정 문턱 — cos β 가 이보다 작으면 α·γ 가 한 축으로 겹친 것으로 보고 γ = 0 으로 둔다. */
const GIMBAL_EPS = 1e-9;

/**
 * 회전 행렬 → 표시 Euler (라디안) `[α, β, γ]`. `eulerXyzToMat3` 의 역.
 */
function mat3ToEulerXyz(r: Mat3): Vec3 {
  const cb = Math.hypot(r[0], r[3]);
  const b = Math.atan2(-r[6], cb);
  if (cb > GIMBAL_EPS) {
    return [Math.atan2(r[7], r[8]), b, Math.atan2(r[3], r[0])];
  }
  // 짐벌 — γ = 0 으로 두면 β 부호와 무관하게 R11 = cos α, R12 = −sin α.
  return [Math.atan2(-r[5], r[4]), b, 0];
}

/**
 * 내부 회전 quaternion → 표시 프레임 회전의 quaternion (`M · R_int · M` 을 quaternion 으로).
 *
 * 성분 교환이 아니라 **행렬 켤레**다 — 위 모듈 주석의 근거 참고.
 */
export function toDisplayQuaternion(q: Quaternion): Quaternion {
  return mat3ToQuaternion(conjugateBySwapYZ(quaternionToMat3(q)));
}

/**
 * 표시 quaternion → 내부 quaternion. `R_int = M · R_disp · M` — `toDisplayQuaternion` 과 같은 식(M⁻¹ = M).
 */
export function fromDisplayQuaternion(q: Quaternion): Quaternion {
  return mat3ToQuaternion(conjugateBySwapYZ(quaternionToMat3(q)));
}

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/**
 * 내부 Euler 각(도, Babylon 규약 — `Quaternion.FromEulerAngles`) → 표시 Euler 각(도, 모듈 주석의 XYZ 규약).
 *
 * 회전 행렬의 반사 켤레를 경유한다. 성분 교환으로 대체하면 복합 회전에서 틀린다.
 */
export function toDisplayEulerDeg(r: Vec3): Vec3 {
  const q = Quaternion.FromEulerAngles(
    r[0] * DEG_TO_RAD,
    r[1] * DEG_TO_RAD,
    r[2] * DEG_TO_RAD,
  );
  const e = mat3ToEulerXyz(conjugateBySwapYZ(quaternionToMat3(q)));
  return [e[0] * RAD_TO_DEG, e[1] * RAD_TO_DEG, e[2] * RAD_TO_DEG];
}

/**
 * 표시 Euler 각(도) → 내부 Euler 각(도). `toDisplayEulerDeg` 의 역.
 *
 * Euler 표현은 다대일(같은 자세를 여러 각으로 쓸 수 있다)이라 각 성분이
 * 원래 숫자로 되돌아오지 않을 수 있지만, **자세는 정확히 왕복**한다.
 */
export function fromDisplayEulerDeg(r: Vec3): Vec3 {
  const rDisp = eulerXyzToMat3(
    r[0] * DEG_TO_RAD,
    r[1] * DEG_TO_RAD,
    r[2] * DEG_TO_RAD,
  );
  const e = mat3ToQuaternion(conjugateBySwapYZ(rDisp)).toEulerAngles();
  return [e.x * RAD_TO_DEG, e.y * RAD_TO_DEG, e.z * RAD_TO_DEG];
}

/**
 * 표시 축 라벨. 인덱스 0/1/2 = 표시 X/Y/Z.
 *
 * 색은 프린터 관례(X 빨강, Y 초록, Z 파랑)를 그대로 쓴다. 내부 축과의 대응은
 * 위 매핑에 따라 **표시 Z(파랑) = 내부 Y(위)**, 표시 Y(초록) = 내부 Z(안쪽) 이므로,
 * 화면에서 위로 뻗는 선이 파랑이어야 규약과 맞는다.
 */
export const DISPLAY_AXIS_LABELS = ["X", "Y", "Z"] as const;
