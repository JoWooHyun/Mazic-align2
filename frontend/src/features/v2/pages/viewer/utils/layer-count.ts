// 씬 최고점·층높이 → 총 레이어 수. (useSliceExport 에서 추출 — 동작 불변.)

/**
 * 씬 최고점·층높이로 총 레이어 수를 구한다.
 *
 * 미리보기 토글 핸들러(ViewerV2Page)와 useSliceExport 가 같은 수를 필요로 한다 —
 * 두 곳이 각자 계산하면 갈라진다(규칙 6 의 정신).
 *
 * 훅이 아닌 순수 함수라 별도 모듈로 둔다: useSliceExport 는 Vite 전용
 * `?worker` import 체인(slice-batch-service)을 끌고 와 헤드리스 검증 스크립트
 * (npx tsx)에서 import 가 불가능하다.
 */
export function layerCountFor(topY: number, layerHeightMm: number): number {
  return Math.max(1, Math.ceil(topY / layerHeightMm));
}
