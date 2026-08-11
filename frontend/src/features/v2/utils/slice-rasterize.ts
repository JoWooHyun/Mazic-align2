import type { SlicePolygon } from "./slice-section";

export interface RasterOpts {
  widthPx: number;
  heightPx: number;
  /** 빌드플레이트 가로 / 세로 (mm). polygon 좌표는 같은 단위. */
  plateWidthMm: number;
  plateDepthMm: number;
}

export interface SliceMask {
  width: number;
  height: number;
  /** width × height 길이의 0/1 비트맵 (1 byte/pixel). 색조 없는 1bpp. */
  data: Uint8Array;
}

/**
 * 닫힌 polygon 들의 union 을 빌드플레이트 영역에 1bpp 마스크로 그린다.
 *
 * 좌표계:
 *   · polygon 좌표 = world (X, Z). 빌드플레이트는 (0,0) 중심.
 *   · pixel (0, 0)  = 좌상단.
 *       pixel_x = (X + W/2) / W × widthPx
 *       pixel_y = (D/2 - Z) / D × heightPx   ← Z+ 가 위
 *
 * 알고리즘: 행 단위 scanline + **nonzero 감김 규칙**(B-7). 각 row 에서
 * polygon edge 와의 교차점을 (x, 감김 부호) 로 모아 x 순으로 정렬하고,
 * 왼쪽부터 감김수를 누적해 **감김수 ≠ 0 인 구간을 칠한다**.
 *
 * 감김 부호는 edge 의 진행 방향(폴리곤 점 순서 = 단면 선분 방향, slice-geometry
 * 참고)에서 나온다. 그 결과:
 *   · 서로 겹친 별개 솔리드 → 둘 다 같은 감김 → 감김수 2 → **채움**(= union).
 *   · 속 빈 모델의 내벽 → 바깥 윤곽과 반대 감김 → 감김수 0 → **구멍 보존**.
 *
 * 예전 even-odd 규칙은 이 둘을 구분하지 못해 겹친 솔리드를 XOR 로 지웠고
 * (마스크에 검은 구멍 = 미경화), 동심 단면인 조립 서포트가 도넛이 됐다.
 * 폴리곤 점 순서를 뒤집는 후처리를 넣으면 이 구분이 깨진다.
 */
export function rasterizePolygons(
  polygons: SlicePolygon[],
  opts: RasterOpts,
): SliceMask {
  const W = opts.widthPx;
  const H = opts.heightPx;
  const data = new Uint8Array(W * H);

  if (polygons.length === 0) return { width: W, height: H, data };

  const plateW = opts.plateWidthMm;
  const plateD = opts.plateDepthMm;

  // 미리 모든 edge 의 (z 시작, z 끝, x 시작 + 기울기) 를 수집한다.
  // 매 row 마다 polygon 점을 재방문하는 대신 edge 단위 순회가 빠름.
  type Edge = {
    yMin: number;
    yMax: number;
    xAtYMin: number;
    dxPerY: number;
    /** 감김 부호. 픽셀 좌표에서 아래로 향하면 +1, 위로 향하면 −1. */
    dir: 1 | -1;
  };
  const edges: Edge[] = [];

  for (const poly of polygons) {
    const pts = poly.points;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];

      // world → pixel y. (Z+ 가 위 → 작은 pixel y)
      const ay = ((plateD / 2 - a[1]) / plateD) * H;
      const by = ((plateD / 2 - b[1]) / plateD) * H;
      const ax = ((a[0] + plateW / 2) / plateW) * W;
      const bx = ((b[0] + plateW / 2) / plateW) * W;

      if (ay === by) continue; // 수평 edge 는 scanline 채움에 기여 X.

      const yMin = Math.min(ay, by);
      const yMax = Math.max(ay, by);
      const xAtYMin = ay < by ? ax : bx;
      const dxPerY = (bx - ax) / (by - ay);
      // a→b 는 폴리곤 점 순서 = 단면 선분 방향. 픽셀 y 가 늘어나는 쪽이 +1.
      const dir: 1 | -1 = ay < by ? 1 : -1;

      edges.push({ yMin, yMax, xAtYMin, dxPerY, dir });
    }
  }

  // row 단위 fill (nonzero 감김 규칙).
  for (let py = 0; py < H; py++) {
    const yCenter = py + 0.5;
    const hits: { x: number; dir: 1 | -1 }[] = [];

    for (const e of edges) {
      // edge 가 row 를 가로지름? (yMin <= y < yMax)
      if (yCenter < e.yMin || yCenter >= e.yMax) continue;
      const dy = yCenter - e.yMin;
      hits.push({ x: e.xAtYMin + e.dxPerY * dy, dir: e.dir });
    }

    hits.sort((a, b) => a.x - b.x);

    // 왼쪽부터 감김수를 누적하며, 감김수 ≠ 0 인 구간 [x_i, x_{i+1}) 을 칠한다.
    const rowOff = py * W;
    let winding = 0;
    for (let i = 0; i + 1 < hits.length; i++) {
      winding += hits[i].dir;
      if (winding === 0) continue;
      const x0 = Math.max(0, Math.floor(hits[i].x));
      const x1 = Math.min(W, Math.ceil(hits[i + 1].x));
      for (let px = x0; px < x1; px++) {
        data[rowOff + px] = 1;
      }
    }
  }

  return { width: W, height: H, data };
}
