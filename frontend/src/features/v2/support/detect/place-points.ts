// 서포트 재설계(S-4) 2단계 — 검출 영역에서 서포트 점 직접 생성 (신규).
//   설계서 3-3(아일랜드 크기별 3분기) + 3-2(지지반경 곡선) + 3-4(점 목록 계약).
//
//   ▸ 격자 필터링이 아니다(설계 7장 핵심): 받쳐야 할 곳(아일랜드·오버행)에서
//     직접 점을 찍으므로, 아무리 작은 아일랜드도 반드시 최소 1점을 받는다
//     (진단서 "생성 0개" 재현 방지 — 수용 A).
//   ▸ 미세 조각 필터 없음(리드 결정 2). 작은 부위에 큰 점이 걸려도 거르지 않음.
//   ▸ 이 PR 은 점만 생성(기둥 없음). base 는 임시로 contact 바로 아래(플레이트).
//
//   모든 수치는 PlacePointsParams 로 주입(하드코딩 상수 금지 — 리드 결정 3).

import type { SupportPointV2 } from "../types";
import type { IslandRegion, LayerGraphResult, OverhangRegion, Point2 } from "./types";
import { pointInPolygon } from "./polygon-2d";

/** 점 생성 파라미터. 모든 값 사용자 조절 기본값에서 온다. */
export interface PlacePointsParams {
  /** 접점(팁) 반경 기본값 (mm). 각 점의 tipRadius 로 실린다 (설계 3-4). */
  tipRadiusMm: number;
  /**
   * 아일랜드 크기 3분기 경계 (mm²). 설계 3-3 "작음/가늘고김/큼".
   *   · area <= smallAreaMm2         → 중심 1점.
   *   · 그 외 종횡비가 길면(가늘고 긴 것) → 양 끝 2점.
   *   · 그 외(큰 것)                  → 바운딩박스 격자 여러 점.
   * "실측 회귀값"이 정본이나(설계 3-3) 1차는 근사 기본값(리드 결정 3).
   */
  smallAreaMm2: number;
  /**
   * "가늘고 긴" 판정 종횡비 임계 (긴변/짧은변). 이 이상이면 양 끝 2점.
   */
  elongatedAspect: number;
  /**
   * 큰 아일랜드 내부 점 간격 (mm). 설계 3-2 는 z높이별 지지반경 곡선으로
   * 간격을 정하지만, 1차는 고정 간격으로 단순화(설계 3-3/3-2 1차 허용).
   *   TODO(설계 3-2): z높이 기반 지지반경 곡선으로 교체.
   */
  fillSpacingMm: number;
  /**
   * 오버행 점 간격 (mm). 설계 3-2 지지반경 곡선의 1차 단순화(고정 간격).
   *   TODO(설계 3-2): 지지반경 곡선 적용.
   */
  overhangSpacingMm: number;
}

/**
 * 층 그래프 검출 결과에서 서포트 점 목록을 만든다 (설계 3-4 계약 산출).
 *   각 점: { contact, base(임시=contact 바로 아래 플레이트), tipRadius,
 *            kind, source:'auto' }.
 *   contact 의 Y 는 검출된 층 Y (표면 스냅은 3단계 구조물 생성이 담당).
 */
export function placeSupportPoints(
  detect: LayerGraphResult,
  projectId: string,
  params: PlacePointsParams,
): SupportPointV2[] {
  const out: SupportPointV2[] = [];
  const now = Date.now();

  for (const island of detect.islands) {
    for (const c of islandContacts(island, params)) {
      out.push(makePoint(c, island.y, "island", projectId, detect.stlId, params, now));
    }
  }

  for (const overhang of detect.overhangs) {
    for (const c of overhangContacts(overhang, params)) {
      out.push(makePoint(c, overhang.y, "slope", projectId, detect.stlId, params, now));
    }
  }

  return out;
}

/**
 * 아일랜드 크기별 3분기 접점 XZ 목록 (설계 3-3).
 *   1차는 뼈대(스켈레톤) 대신 바운딩박스/무게중심 근사 (설계 3-3 명시 허용).
 */
function islandContacts(
  island: IslandRegion,
  params: PlacePointsParams,
): Point2[] {
  const [minX, minZ, maxX, maxZ] = island.bbox;
  const w = Math.max(maxX - minX, 1e-6);
  const d = Math.max(maxZ - minZ, 1e-6);
  const longSide = Math.max(w, d);
  const shortSide = Math.min(w, d);
  const aspect = longSide / shortSide;

  // (1) 작음 → 중심 1점.
  if (island.area <= params.smallAreaMm2) {
    return [island.centroid];
  }

  // (2) 가늘고 긴 것 → 긴 축 양 끝 2점 (시소 회전 방지, 설계 3-3).
  if (aspect >= params.elongatedAspect) {
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    // 긴 축 방향 양 끝(바운딩박스 20%/80% 지점) — 근사.
    if (w >= d) {
      return [
        [minX + w * 0.2, cz],
        [minX + w * 0.8, cz],
      ];
    }
    return [
      [cx, minZ + d * 0.2],
      [cx, minZ + d * 0.8],
    ];
  }

  // (3) 큰 것 → 바운딩박스 격자로 여러 점 (설계 3-3 "굵은 부분은 둘레+내부 격자").
  //   1차는 내부 격자만(둘레 세분화는 후속). 격자점이 폴리곤 밖이면 스킵하되,
  //   전멸하면 centroid 1점으로 폴백(작은 아일랜드가 0개 되는 사고 방지).
  const step = Math.max(params.fillSpacingMm, 1e-3);
  const grid: Point2[] = [];
  for (let x = minX + step * 0.5; x < maxX; x += step) {
    for (let z = minZ + step * 0.5; z < maxZ; z += step) {
      if (pointInPolygon(x, z, island.polygon)) grid.push([x, z]);
    }
  }
  return grid.length > 0 ? grid : [island.centroid];
}

/**
 * 오버행 점 XZ 목록 (설계 3-2 의 1차 단순화 — 고정 간격 그리드 스냅).
 *   검출된 튀어나온 샘플점들을 overhangSpacing 격자 셀당 1점으로 성글게 한다.
 */
function overhangContacts(
  overhang: OverhangRegion,
  params: PlacePointsParams,
): Point2[] {
  const step = Math.max(params.overhangSpacingMm, 1e-3);
  const seen = new Set<string>();
  const out: Point2[] = [];
  for (const [x, z] of overhang.points) {
    const key = `${Math.round(x / step)},${Math.round(z / step)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([x, z]);
  }
  return out;
}

/** 한 접점 XZ + 층 Y → SupportPointV2 (base 는 임시 플레이트). */
function makePoint(
  xz: Point2,
  y: number,
  kind: "island" | "slope",
  projectId: string,
  stlId: string,
  params: PlacePointsParams,
  now: number,
): SupportPointV2 {
  return {
    id: crypto.randomUUID(),
    projectId,
    stlId,
    contact: [xz[0], y, xz[1]],
    // base 임시 = contact 바로 아래 플레이트(Y=0). 3단계 구조물 생성이 실제
    //   base(충돌 회피·경사 다리)를 다시 계산한다.
    base: [xz[0], 0, xz[1]],
    source: "auto",
    tipRadius: params.tipRadiusMm,
    kind,
    addedAt: now,
  };
}

