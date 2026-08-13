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

/** 부동소수 노이즈로 무효화가 튀지 않도록 하는 비교 허용치. */
const REDESIGN_VALID_EPS = 1e-6;

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
 * **예외 2: 수직축(내부 Babylon Y = `ry`) 회전** (B-15). 모델이 팽이처럼 제자리에서
 * 돌 뿐 기둥은 여전히 수직이고 접지 높이도 그대로다 → 예외 1과 완전히 같은 논리로
 * 유지한다. 정책 설계 때 "회전 = 기둥이 기울어짐" 으로 세 축을 뭉뚱그린 탓에 이
 * 축까지 삭제하고 있었다 — **리드 실물 테스트에서 "바닥과 수평인 노란 링을 돌려도
 * 서포트가 사라진다" 로 발견**됐다.
 *   수학적 근거: Babylon `Quaternion.FromEulerAngles(rx,ry,rz)` 는 Y 를 가장 바깥
 *   인자로 합성한다(world yaw). 그래서 `rx/rz` 가 이미 0 이 아닌 기울어진 상태에서도
 *   순수 `ry` 델타는 world Y 축 둘레 회전이며, 모델 로컬 up 의 Y 성분(=플레이트에
 *   대한 기울기)이 변하지 않는다.
 *
 * 나머지 두 회전축 `rx`/`rz` 는 기둥을 실제로 기울이므로 무효가 맞다. 스케일은
 * `sy` 는 물론 균일 스케일도 접점 위치·접지가 달라지므로 전부 무효다.
 *
 * 따라서 rx/rz(기울이는 회전)·sx/sy/sz(스케일)·ty(수직 이동) 중 하나라도 실제로
 * 바뀌면 무효(false), tx/tz/ry 만 바뀌었으면 유효(true).
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
  // ry(수직축 회전)는 의도적으로 검사하지 않는다 — 위 예외 2.
  //   다른 축이 하나라도 함께 바뀌면 그 항이 걸려 어차피 false 가 되므로,
  //   "수직축 회전 + 기울임 동반" 은 별도 처리 없이 올바르게 무효가 된다.
  return !(
    changed(start.rx, end.rx) ||
    changed(start.rz, end.rz) ||
    changed(start.sx, end.sx) ||
    changed(start.sy, end.sy) ||
    changed(start.sz, end.sz) ||
    changed(start.ty, end.ty)
  );
}
