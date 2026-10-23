/**
 * 슬라이스 미리보기 3D 단면 뚜껑(cap)의 삼각분할 — Babylon 의존 없는 순수 함수.
 *
 * 왜: 종전 buildPolygonFillMesh 는 폴리곤마다 point[0] 기준 fan 으로 채웠다. 볼록 단면에서만 맞고,
 *   · 오목 단면(치과 아치·C 자)이면 fan 삼각형이 폴리곤 밖으로 넘쳐 실제보다 큰 판이 그려졌고
 *     (리드 실기 2026-10-23 — 부분 아치 398 mm² 단면이 fan 1650 mm², 얇은 아치 껍데기 107 mm² 가 7251 mm²),
 *   · 속 빈 모델의 내벽(반대 감김 내곽)도 별도 폴리곤으로 **채워** 구멍이 메워졌다.
 *
 * 어떻게: 2D 마스크(slice-rasterize rasterizePolygons)와 **같은 의미**로 채운다 — nonzero 감김.
 *   1) 한 메시의 단면 폴리곤 전부를 js-clipper 로 nonzero union → PolyTree(외곽 + 구멍 + 구멍 속 섬).
 *      겹친 솔리드(같은 감김)는 합쳐지고, 반대 감김 내곽은 구멍으로 남는다. 자가 교차·중복 점도 여기서 정리된다.
 *   2) 외곽 하나와 그 구멍들을 earcut(mapbox, ISC)으로 삼각분할. earcut 은 감김 방향을 따지지 않는다.
 *
 * 좌표: 입력·출력 모두 world (X, Z) mm. 클리퍼는 정수 좌표라 SCALE(1e4 → 0.1 µm 격자)로 키워 넣고 되돌린다
 *   (gcode/polygon-clipper 와 같은 배율. ±150 mm × 1e4 = 1.5e6 < js-clipper loRange 4.7e7 — 빠른 정수 경로).
 *
 * 화면 표시 전용 — 출력 마스크 PNG·ZIP·G-code 는 이 함수를 쓰지 않는다(바이트 무관).
 */
// 기본 import — js-clipper 는 module.exports = ClipperLib 인 CJS 라 Node(헤드리스 검증)에서는 namespace import 에 이름이 안 붙는다.
// 기본 import 는 Vite·Node 양쪽에서 module.exports 객체 그대로다.
import ClipperLib from "js-clipper";
import earcut from "earcut";

import type { SlicePolygon } from "./slice-geometry";

/** 클리퍼 정수 배율 (mm → 0.1 µm). */
const SCALE = 10000;

/** js-clipper 정수 좌표점 — 읽고 쓰는 X·Y 만 최소 선언(모듈 타입이 느슨해 경계에서 좁힌다). */
interface ClipperIntPoint {
  X: number;
  Y: number;
}

/** js-clipper PolyNode 중 이 파일이 쓰는 부분. */
interface ClipperPolyNode {
  Contour(): ClipperIntPoint[];
  Childs(): ClipperPolyNode[];
}

/** 단면 뚜껑 삼각분할 결과 — 평면 위 2D (world X, Z) 정점과 삼각형 인덱스. */
export interface SliceCapTriangulation {
  /** 정점 좌표 (x0, z0, x1, z1, …) mm. */
  points: Float64Array;
  /** 삼각형 정점 인덱스 (3 개씩). */
  indices: Uint32Array;
}

/**
 * 한 메시의 단면 폴리곤들 → nonzero 채움 영역의 삼각분할.
 *
 * 퇴화 입력(점 < 3, 넓이 0)은 클리퍼가 버리므로 빈 결과가 나온다. 감김 방향은 그대로 받는다 —
 * 폴리곤 점 순서를 뒤집으면 겹친 솔리드 vs 구멍 구분이 깨진다(slice-geometry SlicePolygon 주석).
 */
export function triangulateSliceSection(polygons: readonly SlicePolygon[]): SliceCapTriangulation {
  const paths: ClipperIntPoint[][] = [];
  for (const poly of polygons) {
    const pts = poly.points;
    if (pts.length < 3) continue;
    const path: ClipperIntPoint[] = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      path[i] = { X: Math.round(pts[i][0] * SCALE), Y: Math.round(pts[i][1] * SCALE) };
    }
    paths.push(path);
  }
  if (paths.length === 0) return { points: new Float64Array(0), indices: new Uint32Array(0) };

  // nonzero union — rasterizePolygons 의 감김수 ≠ 0 규칙과 같다.
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    tree,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );

  const outPoints: number[] = [];
  const outIndices: number[] = [];

  // 외곽 하나 + 그 구멍들 → earcut. 구멍 속 섬(구멍의 자식)은 다시 외곽으로 처리한다.
  const emitOuter = (outer: ClipperPolyNode): void => {
    const holes = outer.Childs();
    const flat: number[] = [];
    const holeIndices: number[] = [];
    const pushPath = (path: ClipperIntPoint[]): void => {
      for (const p of path) flat.push(p.X, p.Y);
    };
    const contour = outer.Contour();
    if (contour.length >= 3) {
      pushPath(contour);
      for (const h of holes) {
        const hp = h.Contour();
        if (hp.length < 3) continue;
        holeIndices.push(flat.length / 2);
        pushPath(hp);
      }
      // 정수 좌표 그대로 넣는다(earcut 의 면적·교차 판정이 정확해진다). 인덱스는 이 외곽 묶음 안 번호.
      const tri = earcut(flat, holeIndices.length > 0 ? holeIndices : null, 2);
      const base = outPoints.length / 2;
      for (let i = 0; i < flat.length; i++) outPoints.push(flat[i] / SCALE);
      for (const t of tri) outIndices.push(base + t);
    }
    for (const h of holes) for (const island of h.Childs()) emitOuter(island);
  };

  for (const outer of (tree as ClipperPolyNode).Childs()) emitOuter(outer);

  return { points: Float64Array.from(outPoints), indices: Uint32Array.from(outIndices) };
}
