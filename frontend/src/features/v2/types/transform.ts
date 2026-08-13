/**
 * v2 모델 변환.
 *
 * 좌표계는 Babylon (Y-up). 사용자 UI 에서도 Y 가 "위" 라고 안내한다.
 * 회전은 Euler degrees, XYZ 순서.
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

/** 부동소수 노이즈로 무효화가 튀지 않도록 하는 비교 허용치. */
const REDESIGN_VALID_EPS = 1e-6;

/**
 * start→end 변형이 **재설계 서포트(kind='island'|'slope')를 유효하게 두는지** (B-1).
 *
 * 재설계 서포트는 stl-local 좌표로 모델에 부착돼 변형을 그대로 따라간다. 그래서
 * 모델을 회전하면 기둥이 함께 기울어 출력이 불가능해진다 → 리드 확정 정책은
 * CHITUBOX 식 무효화(삭제 + 안내).
 *
 * **예외: 순수 XZ 평행이동**. 서포트 전체가 수평으로 같이 움직여도 기둥의 수직성과
 * 바닥 접지(Y=0)가 그대로 보존되므로 기하학적으로 여전히 유효하다 → 유지한다.
 *
 * 따라서 rx/ry/rz(회전)·sx/sy/sz(스케일)·ty(수직 이동) 중 하나라도 실제로 바뀌면
 * 무효(false), tx/tz 만 바뀌었으면 유효(true).
 */
export function transformKeepsRedesignValid(
  start: TransformV2,
  end: TransformV2,
): boolean {
  const changed = (a: number, b: number) =>
    Math.abs(a - b) > REDESIGN_VALID_EPS;
  return !(
    changed(start.rx, end.rx) ||
    changed(start.ry, end.ry) ||
    changed(start.rz, end.rz) ||
    changed(start.sx, end.sx) ||
    changed(start.sy, end.sy) ||
    changed(start.sz, end.sz) ||
    changed(start.ty, end.ty)
  );
}
