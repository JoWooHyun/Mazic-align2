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
 *   2) 아래→위로 훑으며 각 층 폴리곤이 "바로 아래층 폴리곤과 겹치는지" 판정.
 *        · 안 겹침(아래층에 연결 0)  → 아일랜드 (설계 3-1).
 *        · 겹치되 아래층 밖으로 새로 튀어나온 표면 → 오버행 (설계 3-1, 근사).
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

      // 이 폴리곤 내부 샘플점들이 아래층 폴리곤(합집합) 안에 얼마나 들어가나.
      const { overlap, total, outsidePts } = overlapWithBelow(
        pts,
        belowPolys,
        sample,
      );

      const overlapRatio = total > 0 ? overlap / total : 0;

      if (i === 0 || overlapRatio === 0) {
        // 아래층과 하나도 안 겹침(또는 최하층) → 아일랜드 후보.
        //   단 islandFloorY(리프트+plateGap) 이하 층은 제외 (수용 C).
        if (layerY[i] < islandFloorY) continue;
        islands.push({
          y: layerY[i],
          polygon: pts,
          centroid: polygonCentroid(pts),
          bbox: polygonBBox(pts),
          area,
        });
      } else if (outsidePts.length > 0) {
        // 대부분 겹치되 아래층 밖으로 새로 튀어나온 부분 존재 → 오버행 근사.
        //   튀어나온 샘플점들을 그대로 오버행 점 후보로 넘긴다 (설계 3-2 는
        //   지지반경 곡선으로 간격을 잡지만 1차는 place-points 가 단순화).
        //
        // TODO(후속): 1차는 오버행 검출각(params.overhangAngleDeg)을 실제 판정에
        //   적용하지 않는다. 여기서는 "아래층 밖으로 튀어나온 샘플 존재"라는
        //   층-겹침 근사만으로 오버행을 잡는다 — 층 폴리곤(2D 단면)만으로는
        //   모델 표면의 면 법선 각도를 직접 구할 수 없기 때문. 검출각 게이팅
        //   (누운 각 > overhangAngleDeg 인 표면만 오버행) 은 후속 단계에서 확정:
        //   docs/설계_서포트재설계_20260720.md 3-1b, 로드맵 S 결정#6 (지현규와 협의).
        overhangs.push({ y: layerY[i], points: outsidePts });
      }
    }
  }

  return { stlId, islands, overhangs, nLayers, layerHeight: lh, islandFloorY };
}

/**
 * 폴리곤 내부를 sample 간격 격자로 훑어, 각 샘플점이 아래층 폴리곤 합집합에
 * 포함되는지 센다. 반환:
 *   · overlap    : 아래층 안에 든 샘플점 수
 *   · total      : 폴리곤 내부 샘플점 총수
 *   · outsidePts : 아래층 밖으로 튀어나온 샘플점들 (오버행 후보)
 * 격자가 폴리곤을 하나도 못 담을 만큼 작으면 centroid 1점으로 폴백한다.
 */
function overlapWithBelow(
  poly: Point2[],
  belowPolys: SlicePolygon[],
  sample: number,
): { overlap: number; total: number; outsidePts: Point2[] } {
  const [minX, minZ, maxX, maxZ] = polygonBBox(poly);
  let overlap = 0;
  let total = 0;
  const outsidePts: Point2[] = [];

  const insideBelow = (x: number, z: number): boolean => {
    for (const bp of belowPolys) {
      if (pointInPolygon(x, z, bp.points as Point2[])) return true;
    }
    return false;
  };

  for (let x = minX + sample * 0.5; x < maxX; x += sample) {
    for (let z = minZ + sample * 0.5; z < maxZ; z += sample) {
      if (!pointInPolygon(x, z, poly)) continue;
      total++;
      if (insideBelow(x, z)) overlap++;
      else outsidePts.push([x, z]);
    }
  }

  // 폴리곤이 sample 보다 작아 격자에 하나도 안 걸린 경우 → centroid 1점 폴백.
  //   작은 아일랜드가 "샘플 0개"로 누락되는 것을 막는다 (수용 A 방어).
  if (total === 0) {
    const c = polygonCentroid(poly);
    total = 1;
    if (insideBelow(c[0], c[1])) overlap = 1;
    else outsidePts.push(c);
  }

  return { overlap, total, outsidePts };
}
