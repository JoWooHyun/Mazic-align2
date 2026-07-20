// Bridge 변곡점 좌표를 끝점 이동에 맞춰 다시 계산하는 순수 함수 모음.
// ViewerV2Page 의 서포트 편집/커밋 핸들러에서 반복되던 비례 이동 수학을
// 배선과 분리해 추출한다 (동작 불변 — 원본 식 그대로).

type Vec3 = [number, number, number];

/**
 * base·contact 끝점이 (oldBase→newBase, oldContact→newContact) 로 이동했을 때,
 * 각 변곡점을 t = (i+1)/(n+1) 위치 기준 (Δbase × (1-t)) + (Δcontact × t) 만큼
 * 함께 이동시킨다. 사용자가 휘어놓은 곡선 모양이 그대로 유지된다.
 * (handleMoveBridgeEndpoint / followAttachedChildren 곡선 유지 분기 공용.)
 */
export function proportionalMoveCps(
  cps: Vec3[],
  oldBase: Vec3,
  newBase: Vec3,
  oldContact: Vec3,
  newContact: Vec3,
): Vec3[] {
  const dBase: Vec3 = [
    newBase[0] - oldBase[0],
    newBase[1] - oldBase[1],
    newBase[2] - oldBase[2],
  ];
  const dContact: Vec3 = [
    newContact[0] - oldContact[0],
    newContact[1] - oldContact[1],
    newContact[2] - oldContact[2],
  ];
  const n = cps.length;
  return cps.map((cp, i): Vec3 => {
    const t = (i + 1) / (n + 1);
    const w0 = 1 - t;
    return [
      cp[0] + dBase[0] * w0 + dContact[0] * t,
      cp[1] + dBase[1] * w0 + dContact[1] * t,
      cp[2] + dBase[2] * w0 + dContact[2] * t,
    ];
  });
}
