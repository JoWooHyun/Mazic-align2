// 서포트 재설계(S-4) 검출·점생성 전용 타입.
//   설계서 `docs/설계_서포트재설계_20260720.md` 3장(점 찍기 인터페이스) 기반.
//   기존 utils/dental/island-detection.ts (셀 래스터·마진 연동)와 무관한 독립
//   경로다. 마진/dental 타입을 import 하지 않는다 (리드 결정 1: 마진과 독립).

/** world 좌표 2D 점 (X, Z). 층 폴리곤은 Y 평면 위라 Y 생략. */
export type Point2 = [number, number];

/**
 * 아일랜드(공중에 뜬 조각) 하나 — 어느 층에서 "처음 등장하고 아래층에 연결이
 * 하나도 없는" 폴리곤 컴포넌트.
 *   설계 3-1 "아래층과 하나도 안 겹치면 아일랜드".
 */
export interface IslandRegion {
  /** 이 아일랜드가 처음 등장한 층의 world Y (mm). */
  y: number;
  /** 층 폴리곤 외곽선 (world X/Z). 점찍기·시각화에 그대로 쓴다. */
  polygon: Point2[];
  /** 폴리곤 무게중심 (world X, Z). 작은 아일랜드 1점 배치용. */
  centroid: Point2;
  /** 폴리곤의 XZ 바운딩박스 [minX, minZ, maxX, maxZ]. 3분기 근사 판정용. */
  bbox: [number, number, number, number];
  /** 폴리곤 면적 (mm²). 크기 3분기 경계 판정용. */
  area: number;
}

/**
 * 오버행(처지는 가장자리) 영역 하나 — 아래층보다 바깥으로 튀어나온 down-facing
 * 표면. 1차 버전은 각 층 폴리곤 중 아래층과 안 겹치는 "새로 튀어나온" 부분을
 * 근사로 잡는다(반도 세분화는 3-1 TODO).
 */
export interface OverhangRegion {
  /** 이 오버행이 나타난 층의 world Y (mm). */
  y: number;
  /** 튀어나온 부분을 샘플한 점들 (world X/Z). 점찍기·시각화 입력. */
  points: Point2[];
}

/** 층 그래프 검출 결과. 아일랜드 + 오버행 영역 목록. */
export interface LayerGraphResult {
  /** 어떤 STL 의 결과인지 (단일 슬롯 소유·정리 판정용). */
  stlId: string;
  islands: IslandRegion[];
  overhangs: OverhangRegion[];
  /** 슬라이스한 층 수 (디버그·통계용). */
  nLayers: number;
  /** 검출에 쓴 층 두께 (mm). */
  layerHeight: number;
  /** 아일랜드 분류에서 제외한 하한 Y (mm) = 리프트+plateGap (진단 C 재현 방지). */
  islandFloorY: number;
}

/**
 * 층 그래프 검출 파라미터. 모든 수치는 사용자 조절 파라미터의 기본값에서
 * 오며(리드 결정 3), 하드코딩 상수로 박지 않는다. 호출 측(핸들)이 SupportParams
 * 등에서 채워 넘긴다.
 */
export interface LayerGraphParams {
  /** 슬라이스 층 두께 (mm). 슬라이스 프리뷰 층높이와 정합. */
  layerHeightMm: number;
  /**
   * 모델 리프트 높이 (mm). 이 높이 + plateGap 이하의 층은 아일랜드 분류에서
   * 제외한다 — 진단서 "리프트로 뜬 모델의 바닥 전체 아일랜드 오검출" 방지.
   *   plateGap:0 하드코딩 금지 (리드 지시). liftMm 와 연동.
   */
  liftMm: number;
  /**
   * plate(빌드플레이트) 인접 여유 (mm). 리프트에 더해 이 값 이하의 층까지
   * 아일랜드에서 제외한다. 슬라이스 첫 층의 노이즈 흡수용.
   */
  plateGapMm: number;
  /**
   * 오버행 검출 기준각 (deg). 설계 3-1b. 모델 표면(층 폴리곤 가장자리)이
   * 이보다 더 누우면(수평에 가까우면) 오버행으로 판정. CHITUBOX 기본 30°.
   *   현재 미적용 — 후속 단계 예정. layer-graph.ts 참고
   *   (1차 오버행은 층-겹침 근사로만 판정, 이 각도는 아직 안 읽힘).
   */
  overhangAngleDeg: number;
  /**
   * 층 겹침 판정 샘플 간격 (mm). 폴리곤 겹침을 point-in-polygon 샘플로
   * 근사할 때의 격자 간격. 작을수록 정밀하지만 느리다.
   */
  overlapSampleMm: number;
}
