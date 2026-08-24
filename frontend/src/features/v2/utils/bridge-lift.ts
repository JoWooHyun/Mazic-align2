// Bridge 핸들 sphere 의 표면 띄우기(lift) 공용 유틸 — R-1.
//
//   Bridge 끝점 좌표는 표면 **안쪽으로 push** 된 상태로 저장된다(서포트 메시 cap 이
//   표면 밖으로 튀지 않게). 그대로 sphere 를 그리면 모델에 파묻혀 잡을 수 없으므로,
//   표시할 때만 normal 방향으로 LIFT 만큼 끌어낸다(`liftOut`). 드래그가 끝나 저장할
//   때는 그 반대로 되돌린다(`undoLift`).
//
//   ## 왜 별도 파일인가 (R-1)
//   종전에는 `useBridgeVisualization.ts` 의 **effect 지역 함수**로만 존재했는데
//   `setup-gizmos.ts` 가 import 없이 같은 이름을 참조하고 있었다(원본 BabylonScene
//   시절의 잔재를 리팩토링이 충실히 보존한 것). 타입 에러로 계속 잡혀 있었고,
//   **Bridge 끝점 gizmo 드래그 커밋 경로에서 런타임 ReferenceError 가 나는**
//   잠복 버그였다. 두 소비자가 같은 정의를 쓰도록 여기로 올린다.

/** 표면에서 띄우는 거리 (mm). 두 소비자가 같은 값을 써야 왕복이 정확히 상쇄된다. */
export const BRIDGE_LIFT_MM = 0.8;

/** 저장 좌표 → 표시 좌표. normal 이 없으면 그대로. */
export function liftOut(
  pos: [number, number, number],
  n: [number, number, number] | undefined,
): [number, number, number] {
  if (!n) return [pos[0], pos[1], pos[2]];
  return [
    pos[0] + n[0] * BRIDGE_LIFT_MM,
    pos[1] + n[1] * BRIDGE_LIFT_MM,
    pos[2] + n[2] * BRIDGE_LIFT_MM,
  ];
}

/** 표시 좌표 → 저장 좌표. `liftOut` 의 역함수라 왕복 무손실. */
export function undoLift(
  pos: { x: number; y: number; z: number },
  n: [number, number, number] | undefined,
): [number, number, number] {
  if (!n) return [pos.x, pos.y, pos.z];
  return [
    pos.x - n[0] * BRIDGE_LIFT_MM,
    pos.y - n[1] * BRIDGE_LIFT_MM,
    pos.z - n[2] * BRIDGE_LIFT_MM,
  ];
}
