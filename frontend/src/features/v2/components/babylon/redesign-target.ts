// 서포트 재설계 생성의 **대상 모델 고정** (정리_20261001 §4-2 신규 9).
//
//   재설계 서포트 생성은 검출을 워커에서 돌리느라 수 초~수십 초 걸린다. 그 사이
//   사용자가 다른 모델을 클릭하면 선택(getActiveStl)이 바뀌는데, 종전 라우팅 확정
//   (`routeAndFinalizePoints`)은 **끝나는 시점의 선택**을 다시 읽어 그 모델 기준으로
//   표면 스냅·충돌 검사·stl-local 변환을 했다. 점의 stlId 는 시작 모델이라, 좌표는
//   엉뚱한 모델 기준인 채로 시작 모델에 붙어 저장됐다.
//
//   → 시작 시점(`prepareRedesignDetectInput`)의 stlId·world 행렬을 잡아 두고, 확정은
//     **그 stlId 의 메시로만** 한다. 그 사이 모델이 사라졌거나 움직였으면 검출 결과
//     (시작 자세의 world 삼각형으로 계산)가 더는 현재 모델과 맞지 않으므로 저장하지
//     않고 다시 생성하게 한다 — 어긋난 서포트가 출력물에 찍히는 것보다 안전하다.
//
//   Babylon 무의존 순수 모듈 — 헤드리스 검증(scripts/verify-support-regen.mjs)이
//   그대로 import 한다.

/** 생성 시작 시점에 고정한 대상 모델. */
export interface RedesignTarget {
  /** 생성을 시작한 STL id. */
  stlId: string;
  /** 시작 시점 world 행렬 (Babylon `Matrix.asArray()` 16개 사본). */
  worldMatrix: readonly number[];
}

/**
 * "같은 자세" 판정 허용오차 (행렬 원소별 절대값).
 *   같은 transform 에서 다시 계산한 행렬은 비트 단위로 같지만, 기즈모 부모 교체
 *   (setParent) 왕복 같은 분해·재합성 반올림은 1e-6 수준으로 흔들 수 있다.
 *   사용자가 실제로 옮긴 것(0.01mm·0.01° 이상)과는 수십 배 떨어져 있다.
 */
export const TARGET_MATRIX_EPS = 1e-4;

/** 두 world 행렬(16개)이 허용오차 안에서 같은가. 길이가 16이 아니면 false. */
export function sameWorldMatrix(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  eps: number = TARGET_MATRIX_EPS,
): boolean {
  if (a.length !== 16 || b.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    // NaN 도 "다름" 으로 — `!(x <= eps)` 형태로 쓴다.
    if (!(Math.abs(a[i] - b[i]) <= eps)) return false;
  }
  return true;
}

/**
 * 고정해 둔 대상 모델의 메시를 찾는다. **현재 선택은 보지 않는다.**
 *
 * @param meshMap      stlId → 메시 (씬의 meshMapRef).
 * @param target       시작 시점에 잡아 둔 대상.
 * @param currentWorld 메시의 현재 world 행렬(16개)을 돌려주는 함수.
 * @returns 대상 메시, 또는 저장하면 안 되는 이유.
 */
export function resolveRedesignTarget<M>(
  meshMap: ReadonlyMap<string, M>,
  target: RedesignTarget,
  currentWorld: (mesh: M) => ArrayLike<number>,
): { ok: true; mesh: M } | { ok: false; reason: string } {
  const mesh = meshMap.get(target.stlId);
  if (!mesh) {
    return {
      ok: false,
      reason: "서포트 생성을 시작한 모델이 사라져 결과를 저장하지 않았습니다.",
    };
  }
  if (!sameWorldMatrix(currentWorld(mesh), target.worldMatrix)) {
    return {
      ok: false,
      reason:
        "생성 중 모델이 움직여 결과를 저장하지 않았습니다. 서포트 생성을 다시 실행하세요.",
    };
  }
  return { ok: true, mesh };
}
