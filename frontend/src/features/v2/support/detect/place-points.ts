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
import type { IslandRegion, LayerGraphResult, Point2 } from "./types";
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
   *   ※ B-22 부터 이 값은 **수평(XZ) 격자 간격**을 뜻한다.
   */
  overhangSpacingMm: number;
  /**
   * 오버행 점의 **수직(높이) 방향 간격** (mm) — B-22.
   *
   * 검출은 층(기본 0.05mm)마다 오버행 영역을 내놓기 때문에, 수평 격자만으로
   * 중복을 걸러도 **같은 자리에 층마다 점이 쌓인다.** 이 값이 "세로로 이만큼
   * 떨어져야 별개 점으로 본다"는 기준이 되어 그 누적을 끊는다.
   *
   * 미지정이면 `overhangSpacingMm` 과 같은 값을 쓴다(등방 격자).
   * 값을 키우면 세로로 더 성기게, 줄이면 더 촘촘하게 찍힌다.
   */
  verticalSpacingMm?: number;
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

  // ★ B-22 — 오버행 점 중복 제거를 **전체 층에 걸쳐 한 번에** 한다.
  //
  //   ## 왜 (리드 실물: "서포트 아직도 너무많다")
  //   종전에는 `overhangContacts` 안에서 층 하나마다 `seen` Set 을 새로 만들어
  //   XZ 격자 중복만 걸렀다. 그런데 이 함수는 `OverhangRegion`(=층) **마다**
  //   호출되므로, 같은 XZ 라도 **층이 다르면 별개 점으로 살아남았다.**
  //   층높이 0.05mm → 12mm 모델이면 최대 240층이 같은 자리에 쌓인다
  //   (세로로 긴 경사면일수록 폭발 — 리드가 본 1,000+ 가 이 형태).
  //
  //   ## 무엇을 바꿨나
  //   `seen` 을 이 루프 **바깥**으로 올리고, 키에 **Y 도 함께** 양자화해 넣는다.
  //   즉 XZ 격자가 아니라 **3D 격자** 중복 제거가 된다.
  //     · 수직 방향 셀 크기 = `verticalSpacingMm`(기본 = overhangSpacingMm).
  //     · 같은 기둥 자리에 세로로 촘촘히 쌓이던 점이 이 간격마다 1개로 줄어든다.
  //
  //   ## 왜 XZ 만이 아니라 Y 도 남기나 (전부 뭉개면 안 되는 이유)
  //   XZ 만으로 뭉개면 **높이가 다른 별개의 오버행**(예: 위·아래 두 층의 서로
  //   다른 돌출부)이 하나로 합쳐져 **아래쪽만 받치고 위는 안 받치게 된다.**
  //   Y 를 격자에 포함하면 "같은 자리 + 비슷한 높이"만 합쳐지므로 안전하다.
  //
  //   ## 검출 로직은 건드리지 않는다
  //   `layer-graph.ts`(S-4b-2e 검수 통과분)는 무변경이다. 검출이 내놓는 영역은
  //   그대로이고, 그 위에서 **점을 몇 개 찍을지**만 바뀐다.
  //   ⚠️ 셀 인덱스는 `Math.floor` 로 낸다. `Math.round` 를 쓰면 셀 경계가 반 칸씩
  //   어긋나 **첫 칸만 폭이 절반**이 된다(검증 §1 이 실측으로 잡아낸 결함 —
  //   240층 벽에서 첫 두 점 간격이 3mm 가 아니라 1.5mm 로 나왔다). floor 는 모든
  //   칸의 폭이 정확히 step 이라 "남은 점들의 최소 간격 ≥ step" 이 항상 성립한다.
  const seenOverhang = new Set<string>();
  const step = Math.max(params.overhangSpacingMm, 1e-3);
  const vStep = Math.max(
    params.verticalSpacingMm ?? params.overhangSpacingMm,
    1e-3,
  );
  for (const overhang of detect.overhangs) {
    const iy = Math.floor(overhang.y / vStep);
    for (const [x, z] of overhang.points) {
      const key = `${Math.floor(x / step)},${Math.floor(z / step)},${iy}`;
      if (seenOverhang.has(key)) continue;
      seenOverhang.add(key);
      out.push(
        makePoint([x, z], overhang.y, "slope", projectId, detect.stlId, params, now),
      );
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

// (구 `overhangContacts` 제거 — B-22. 층별로 호출돼 **층 하나 안에서만** 중복을
//  걸렀기 때문에 같은 자리에 층마다 점이 쌓였다. 이제 `placeSupportPoints` 가
//  전체 층에 걸친 3D 격자로 한 번에 거른다.)

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

