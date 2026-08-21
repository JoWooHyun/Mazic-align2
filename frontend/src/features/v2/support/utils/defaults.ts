import type { SupportParams } from "../types";
import type { LayerGraphParams } from "../detect/types";
import type { PlacePointsParams } from "../detect/place-points";

/**
 * 일반적인 SLA 출력 기준의 무난한 시작 값.
 * 단위: deg / mm.
 */
export const DEFAULT_SUPPORT_PARAMS: SupportParams = {
  overhangAngleDeg: 45,
  trunkDiameterMm: 0.8,
  tipDiameterMm: 0.4,
  baseDiameterMm: 1.5,
  tipTransitionMm: 1.0,
  baseTransitionMm: 3.0,
  autoSizeTrunk: false,
  contactSpacingMm: 4.0,
  liftMm: 5.0,
  bridgeDiameterMm: 1.2,
  // 서포트 재설계(S-4b) 화살촉 접점 기본값 (설계 4-1). 재설계 경로 전용.
  //   이번 PR 은 새 파라미터의 UI 슬라이더를 만들지 않는다(S-4d 몫) — 값만 동작.
  headBackDiameterMm: 1.0,
  headLengthMm: 1.0,
  contactPenetrationMm: 0.2,
};

/**
 * 각 파라미터의 허용 범위. UI 슬라이더 / 유효성 검사 양쪽에서 쓴다.
 *   ※ 재설계(S-4b) 신규 파라미터(headBackDiameterMm / headLengthMm /
 *     contactPenetrationMm)는 이번 PR 에서 슬라이더를 만들지 않으므로(S-4d 몫)
 *     여기서 제외한다. 기본값(DEFAULT_SUPPORT_PARAMS)으로만 동작한다.
 */
export const SUPPORT_PARAM_LIMITS: Record<
  keyof Omit<
    SupportParams,
    | "autoSizeTrunk"
    | "headBackDiameterMm"
    | "headLengthMm"
    | "contactPenetrationMm"
  >,
  { min: number; max: number; step: number; unit: string; label: string }
> = {
  overhangAngleDeg: { min: 10, max: 80, step: 1, unit: "°", label: "오버행 임계각" },
  trunkDiameterMm: { min: 0.1, max: 20.0, step: 0.1, unit: "mm", label: "기둥 굵기" },
  tipDiameterMm: { min: 0.1, max: 20.0, step: 0.1, unit: "mm", label: "팁 지름" },
  baseDiameterMm: { min: 0.1, max: 20.0, step: 0.1, unit: "mm", label: "바닥 지름" },
  tipTransitionMm: { min: 0.1, max: 20.0, step: 0.1, unit: "mm", label: "팁 전이 길이" },
  baseTransitionMm: { min: 0.1, max: 20.0, step: 0.1, unit: "mm", label: "바닥 전이 길이" },
  contactSpacingMm: { min: 1.5, max: 15.0, step: 0.5, unit: "mm", label: "접점 간격" },
  liftMm: { min: 0, max: 30, step: 0.5, unit: "mm", label: "모델 리프트" },
  bridgeDiameterMm: { min: 0.5, max: 10.0, step: 0.1, unit: "mm", label: "Bridge 굵기" },
};

// ─────────────────────────────────────────────────────────────────────────
// 서포트 재설계(S-4) 검출·점생성 파라미터 기본값 (신규, 별도 경로).
//   기존 SupportParams(격자/구조물 경로)와 분리한다 — 기존 값·동작 무변경.
//   모든 값은 사용자 조절 파라미터의 "기본값"이며 하드코딩 상수가 아니다
//   (리드 결정 3). 정식 UI 는 설계 8장 5단계 몫이라 이 PR 은 기본값만 노출.

/**
 * 층 그래프 검출 기본값 (설계 3-1/3-1b).
 *   · overhangAngleDeg 30° = 설계 검출각(3-1b, CHITUBOX 기본)과 정합.
 *     (기존 SupportParams.overhangAngleDeg 45° 는 격자/구조 경로용 — 별개.)
 *     S-4b-2e 부터 **실제 판정에 적용**된다: 지지 반경 r = layerHeightMm/tanθ
 *     로 아래층을 팽창시켜, r 안에 드는 가파른 자기지지면은 오버행에서 뺀다
 *     (30°/0.05mm → r≈0.0866mm). 값을 키우면 더 많이, 줄이면 더 적게 잡힌다.
 *   · plateGapMm + liftMm 연동은 검출 호출 시 실제 liftMm 를 채워 넘긴다
 *     (진단서 "리프트로 뜬 모델 바닥 전체 아일랜드 오검출" 방지 — 수용 C).
 */
export const DEFAULT_LAYER_GRAPH_PARAMS: Omit<LayerGraphParams, "liftMm"> = {
  layerHeightMm: 0.05,
  plateGapMm: 0.2,
  overhangAngleDeg: 30,
  overlapSampleMm: 0.3,
};

/**
 * 점 생성 기본값 (설계 3-2/3-3/3-4).
 *   1차 근사: 아일랜드 3분기 경계·간격은 실측 회귀 전의 출발점 값(설계 3-3).
 *   지지반경 곡선(3-2)은 fill/overhang 고정 간격으로 단순화 (TODO).
 */
export const DEFAULT_PLACE_POINTS_PARAMS: PlacePointsParams = {
  tipRadiusMm: 0.2, // = tipDiameterMm 0.4 의 반경 (설계 4-1 앙구슬 ⌀0.4).
  smallAreaMm2: 1.0, // 반경 ~0.5mm 급 아일랜드는 중심 1점 (수용 A).
  elongatedAspect: 3.0, // 긴변/짧은변 3 이상이면 가늘고 긴 것 → 양 끝 2점.
  fillSpacingMm: 3.0, // 큰 아일랜드 내부 격자 간격 (지지반경 곡선 1차 근사).
  overhangSpacingMm: 3.0, // 오버행 점 간격 (지지반경 곡선 1차 근사).
};

/**
 * 재설계 검출·점생성 파라미터 허용 범위. 정식 UI(5단계) 전이라 슬라이더는
 * 아직 없지만, 값이 사용자 조절 파라미터임을 명시하고 향후 UI 가 참조하도록
 * 한계를 함께 둔다 (리드 결정 3 — 모든 값 사용자 조절 가능 유지).
 */
export const SUPPORT_DETECT_PARAM_LIMITS = {
  overhangAngleDeg: { min: 0, max: 90, step: 1, unit: "°", label: "오버행 검출각" },
  plateGapMm: { min: 0, max: 5, step: 0.05, unit: "mm", label: "플레이트 여유" },
  overlapSampleMm: { min: 0.1, max: 2, step: 0.05, unit: "mm", label: "겹침 샘플 간격" },
  tipRadiusMm: { min: 0.05, max: 5, step: 0.05, unit: "mm", label: "팁 반경" },
  smallAreaMm2: { min: 0.1, max: 20, step: 0.1, unit: "mm²", label: "작은 아일랜드 경계" },
  elongatedAspect: { min: 1.5, max: 10, step: 0.5, unit: "", label: "가늘고 긴 종횡비" },
  fillSpacingMm: { min: 0.5, max: 15, step: 0.5, unit: "mm", label: "내부 격자 간격" },
  overhangSpacingMm: { min: 0.5, max: 15, step: 0.5, unit: "mm", label: "오버행 점 간격" },
} as const;
