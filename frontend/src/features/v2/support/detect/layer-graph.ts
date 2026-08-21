// 서포트 재설계(S-4) 1단계 — 2D 층 그래프로 아일랜드/오버행 검출 (신규).
//   설계서 3-1 "슬라이스된 2D 층 폴리곤들을 아래에서 위로 훑는다".
//
//   ▸ 기존 utils/dental/island-detection.ts 와의 차이(리드 결정):
//       · 저건 셀 래스터(cellSize 격자) + margin/dental 연동 경로. 이 파일은
//         slice-section 의 층 폴리곤(chainSegments)을 직접 쓰는 독립 경로다.
//       · 마진/dental 코드를 import 하지 않는다 (마진과 독립 — 리드 결정 1).
//   ▸ 격자 필터링(auto-generate.ts)과도 무관: 받칠 곳을 먼저 찾아 그 위에 점을
//     찍는 국소·능동 방식(설계 7장). 이 파일은 "받칠 곳 찾기"까지만 담당.
//
//   모든 수치는 LayerGraphParams 로 주입(하드코딩 상수 금지 — 리드 결정 3).

import {
  chainSegments,
  sliceTrianglesAtY,
  type SlicePolygon,
} from "../../utils/slice-geometry";
import {
  distanceToPolygonEdges,
  polygonArea,
  polygonBBox,
  polygonCentroid,
  pointInPolygon,
} from "./polygon-2d";
import type {
  IslandRegion,
  LayerGraphParams,
  LayerGraphResult,
  OverhangRegion,
  Point2,
} from "./types";

/**
 * world 삼각형 배열(삼각형당 9 float)에서 아일랜드/오버행을 검출한다.
 *
 * 알고리즘 개요:
 *   1) yMin~yMax 를 layerHeight 로 나눠 각 층 중앙 Y 에서 슬라이스 → 층 폴리곤.
 *   2) 아래→위로 훑으며 각 층 폴리곤이 "바로 아래층 폴리곤에 지지되는지" 판정.
 *        · 하나도 지지 안 됨(아래층에 연결 0) → 아일랜드 (설계 3-1).
 *        · 지지되되 지지 반경 r 밖으로 튀어나온 표면 → 오버행 (설계 3-1/3-1b).
 *   3) islandFloorY = 리프트 + plateGap 이하 층은 아일랜드에서 제외
 *        (진단서 "리프트로 뜬 모델 바닥 전체 아일랜드 오검출" 방지 — 수용 C).
 *
 * 반도(peninsula) 세분화는 1차 생략 (설계 3-1 TODO).
 */
export function detectLayerGraph(
  triangles: Float32Array,
  stlId: string,
  params: LayerGraphParams,
): LayerGraphResult {
  const lh = Math.max(params.layerHeightMm, 1e-3);
  const islandFloorY = params.liftMm + params.plateGapMm;

  // ── Y 범위 ──────────────────────────────────────────────────────────
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let t = 1; t + 8 < triangles.length + 1; t += 9) {
    const y0 = triangles[t];
    const y1 = triangles[t + 3];
    const y2 = triangles[t + 6];
    const lo = Math.min(y0, y1, y2);
    const hi = Math.max(y0, y1, y2);
    if (lo < yMin) yMin = lo;
    if (hi > yMax) yMax = hi;
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || yMax <= yMin) {
    return {
      stlId,
      islands: [],
      overhangs: [],
      nLayers: 0,
      layerHeight: lh,
      islandFloorY,
    };
  }

  const nLayers = Math.max(1, Math.ceil((yMax - yMin) / lh));

  // ── 각 층 폴리곤 (층 중앙 Y 에서 슬라이스) ────────────────────────────
  const layerPolys: SlicePolygon[][] = new Array(nLayers);
  const layerY: number[] = new Array(nLayers);
  for (let i = 0; i < nLayers; i++) {
    // 층 중앙(경계 코플레너 회피). 최상층은 yMax 를 넘지 않게 clamp.
    const y = Math.min(yMin + (i + 0.5) * lh, yMax - lh * 0.01);
    layerY[i] = y;
    const segs = sliceTrianglesAtY(triangles, y);
    layerPolys[i] = chainSegments(segs);
  }

  const islands: IslandRegion[] = [];
  const overhangs: OverhangRegion[] = [];
  const sample = Math.max(params.overlapSampleMm, 1e-3);
  const reach = supportReachMm(lh, params.overhangAngleDeg);

  // ── 아래→위 훑기 ─────────────────────────────────────────────────────
  for (let i = 0; i < nLayers; i++) {
    const polys = layerPolys[i];
    if (polys.length === 0) continue;
    const belowPolys = i > 0 ? layerPolys[i - 1] : [];

    for (const poly of polys) {
      const pts = poly.points as Point2[];
      if (pts.length < 3) continue;
      const area = polygonArea(pts);
      if (area < 1e-6) continue;

      // 이 폴리곤 내부 샘플점들이 아래층 폴리곤(합집합)에 얼마나 지지되나.
      //   지지 = 아래층 안 또는 아래층 경계에서 reach(r) 이내 (검출각 게이팅).
      const { overlap, total, outsidePts } = overlapWithBelow(
        pts,
        belowPolys,
        sample,
        reach,
      );

      const overlapRatio = total > 0 ? overlap / total : 0;

      if (i === 0 || overlapRatio === 0) {
        // 아래층에 하나도 지지되지 않음(또는 최하층) → 아일랜드 후보.
        //   단 islandFloorY(리프트+plateGap) 이하 층은 제외 (수용 C).
        //
        // ★ 의미 변화 (S-4b-2e, 설계 3-1 "겹침"의 정밀화): overlapRatio 가
        //   이제 **r-팽창을 포함한 지지 수**로 계산되므로, 아래층 폴리곤과
        //   직접 겹치지 않더라도 경계에서 r 이내에 걸친 조각은 overlapRatio>0
        //   이 되어 아일랜드가 아니게 된다. 물리적으로 "아래층 테두리가 검출각
        //   규칙 안에서 받쳐 주는" 경우라 아일랜드도 오버행도 아닌 것이 옳다.
        //   아래층에서 r 보다 멀리 완전히 분리된 조각은 종전대로 아일랜드다.
        if (layerY[i] < islandFloorY) continue;
        islands.push({
          y: layerY[i],
          polygon: pts,
          centroid: polygonCentroid(pts),
          bbox: polygonBBox(pts),
          area,
        });
      } else if (outsidePts.length > 0) {
        // 대부분 지지되되 지지 반경 r 밖으로 튀어나온 부분 존재 → 오버행.
        //   튀어나온 샘플점들을 그대로 오버행 점 후보로 넘긴다 (설계 3-2 는
        //   지지반경 곡선으로 간격을 잡지만 1차는 place-points 가 단순화).
        //
        //   검출각 게이팅이 실제로 적용된 지점이다 (S-4b-2e). 스스로 버티는
        //   가파른 면(층당 전진 ≤ r)은 outsidePts 에 들어오지 않으므로 여기서
        //   걸러진다 — 구 동작의 서포트 점 과다(B-3, 풀아치 1,490점)의 원인.
        overhangs.push({ y: layerY[i], points: outsidePts });
      }
    }
  }

  return { stlId, islands, overhangs, nLayers, layerHeight: lh, islandFloorY };
}

/**
 * 오버행 검출각 θ 에 대응하는 **층당 지지 반경 r (mm)** — 표준 층-팽창 방식.
 *   설계 3-1b: θ 는 "모델 표면이 플랫폼(수평)과 이루는 기울기"이고, 표면이 θ
 *   보다 완만하면(수평에 가까우면) 오버행이다.
 *
 *   표면 기울기 α 인 면의 층당 수평 전진량은 lh / tan(α) 이므로
 *       α < θ  ⇔  lh/tan(α) > lh/tan(θ) = r
 *   즉 "아래층 경계에서 r 보다 멀리 튀어나온 샘플만 오버행"이 검출각 판정과
 *   정확히 같다. r 이내로 전진한 면은 θ 보다 가팔라 스스로 버틴다.
 *
 *   수치 예 (θ=30°, lh=0.05mm → r = 0.05/tan30° ≈ 0.0866mm):
 *     · 45° 벽   : 층당 전진 0.05mm  < r  → 지지됨(오버행 아님)
 *     · 20° 완경사: 층당 전진 0.137mm > r  → 오버행
 *
 *   클램프 [1°, 90°]:
 *     · 하한 1° — θ→0 이면 r→∞ 라 모델 전체가 "지지됨"이 되어 검출이 죽는다.
 *       0 나눗셈(tan0=0)도 함께 막는다. 사용자 한계값(0°)이 들어와도 안전.
 *     · 상한 90° — tan(90°) 는 JS 에서 Infinity 가 아니라 ~1.633e16 이므로
 *       r ≈ 3e-18 로 사실상 0 이 된다. 이는 "모든 돌출이 오버행" = 검출각
 *       미적용(구 동작)과 같아 방향이 옳다. 별도 상한 축소(89.9° 등)를 두면
 *       오히려 r 이 유한한 값(≈2.9e-5)으로 남아 구 동작 재현이 흐려지므로
 *       90° 를 그대로 허용하고, 음수 방지로 하한 0 만 건다.
 */
function supportReachMm(lh: number, overhangAngleDeg: number): number {
  const deg = Math.min(90, Math.max(1, overhangAngleDeg));
  const r = lh / Math.tan((deg * Math.PI) / 180);
  return Number.isFinite(r) && r > 0 ? r : 0;
}

/**
 * 폴리곤 내부를 sample 간격 격자로 훑어, 각 샘플점이 아래층 폴리곤 합집합에
 * **지지되는지** 센다. 지지 = 아래층 안이거나, 아래층 경계에서 수평거리
 * supportReachMm(r) 이내 (검출각 게이팅 — supportReachMm 주석 참고).
 * 반환:
 *   · overlap    : 아래층에 지지된 샘플점 수
 *   · total      : 폴리곤 내부 샘플점 총수
 *   · outsidePts : r 밖으로 튀어나온 미지지 샘플점들 (오버행 후보)
 * 격자가 폴리곤을 하나도 못 담을 만큼 작으면 centroid 1점으로 폴백한다.
 */
function overlapWithBelow(
  poly: Point2[],
  belowPolys: SlicePolygon[],
  sample: number,
  reach: number,
): { overlap: number; total: number; outsidePts: Point2[] } {
  const [minX, minZ, maxX, maxZ] = polygonBBox(poly);
  let overlap = 0;
  let total = 0;
  const outsidePts: Point2[] = [];

  // 아래층 폴리곤별 점 배열 + bbox 를 미리 1회만 계산해 재사용한다
  //   (샘플점마다 bbox 를 다시 구하면 O(샘플수 × 정점수) 로 커진다).
  const below = belowPolys.map((bp) => {
    const points = bp.points as Point2[];
    return { points, bbox: polygonBBox(points) };
  });

  /** 샘플점이 아래층에 지지되는가 (내부이거나 경계에서 r 이내). */
  const supportedByBelow = (x: number, z: number): boolean => {
    for (const b of below) {
      if (pointInPolygon(x, z, b.points)) return true;
    }
    if (reach <= 0) return false;
    for (const b of below) {
      // bbox 프리필터 — bbox 를 r 만큼 확장해도 안 걸리면 거리 판정 생략.
      const [bMinX, bMinZ, bMaxX, bMaxZ] = b.bbox;
      if (
        x < bMinX - reach ||
        x > bMaxX + reach ||
        z < bMinZ - reach ||
        z > bMaxZ + reach
      ) {
        continue;
      }
      if (distanceToPolygonEdges(x, z, b.points) <= reach) return true;
    }
    return false;
  };

  for (let x = minX + sample * 0.5; x < maxX; x += sample) {
    for (let z = minZ + sample * 0.5; z < maxZ; z += sample) {
      if (!pointInPolygon(x, z, poly)) continue;
      total++;
      if (supportedByBelow(x, z)) overlap++;
      else outsidePts.push([x, z]);
    }
  }

  // 폴리곤이 sample 보다 작아 격자에 하나도 안 걸린 경우 → centroid 1점 폴백.
  //   작은 아일랜드가 "샘플 0개"로 누락되는 것을 막는다 (수용 A 방어).
  //   폴백도 같은 지지 판정(팽창 포함)을 쓴다.
  if (total === 0) {
    const c = polygonCentroid(poly);
    total = 1;
    if (supportedByBelow(c[0], c[1])) overlap = 1;
    else outsidePts.push(c);
  }

  return { overlap, total, outsidePts };
}
