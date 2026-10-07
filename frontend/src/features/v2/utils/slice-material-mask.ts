import { rasterizePolygons, type RasterOpts } from "./slice-rasterize";
import type { SlicePolygon } from "./slice-section";
import { task0SlotColorRgb } from "./task0/task0-material";
import type { Task0MaterialSlot } from "./task0/task0-slice";

/** 단면 라벨 — 0 빈 곳 / 1 재료 A(T0) / 2 재료 B(T1) */
export type SliceMaterialLabel = 0 | 1 | 2;

/**
 * Task0 2재료 단면 라벨 마스크 (D2 — 슬라이스 화면 2D 단면 패널의 2색 미리보기, 화면 전용).
 *
 * data[i] = 0 빈 곳 / 1 재료 A(T0) / 2 재료 B(T1). width × height, 1 byte/pixel (좌표 규약은 slice-rasterize SliceMask 와 같다).
 */
export interface SliceMaterialLabelMask {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * 폴리곤마다 재료 슬롯이 붙은 단면 → 라벨 마스크.
 *
 * 방식 (래스터 2회):
 *   ① 합집합 = rasterizePolygons(polygons) — 1bpp 미리보기(handle getSliceMask)와 **같은 폴리곤·같은 순서·같은 함수** 호출이라
 *      라벨 ≠ 0 인 픽셀 집합이 getSliceMask 결과와 정확히 같다(같은 x 의 교차점 정렬 순서까지 같아야 한 픽셀 차이도 없다 —
 *      그래서 폴리곤 순서를 바꾸지 않는다).
 *   ② B = rasterizePolygons(슬롯 B 폴리곤만, 순서 유지).
 *   라벨 = 합집합 ? (B ? 2 : 1) : 0 — **겹친 곳은 B** (writer 의 B 우선 R_A = PA − PB, 규격 v0.3.4 §6·D1a 와 같은 규칙).
 *   합집합 안에서 B 가 아닌 곳 = A (보통 모델에서는 raster(PA) AND NOT raster(PB) 와 같다 — 다른 메시끼리 감김이 상쇄되는
 *   뒤집힌 메시 겹침에서만 다를 수 있고, 그때도 라벨은 노광 마스크(모든 메시 합집합 = 층 PNG)를 따른다).
 *
 * 순수 TS — DOM/Babylon 의존 없음.
 * @param slots polygons 와 같은 길이 — 폴리곤마다 'A' | 'B' (서포트 = A, STL = 파일 슬롯 — 부르는 쪽이 정한다)
 */
export function rasterizeMaterialLabels(
  polygons: SlicePolygon[],
  slots: readonly Task0MaterialSlot[],
  opts: RasterOpts,
): SliceMaterialLabelMask {
  if (slots.length !== polygons.length) {
    throw new RangeError(
      `재료 슬롯 수 ${slots.length} ≠ 폴리곤 수 ${polygons.length}`,
    );
  }
  const union = rasterizePolygons(polygons, opts);
  const polysB = polygons.filter((_, i) => slots[i] === "B");
  const maskB = polysB.length > 0 ? rasterizePolygons(polysB, opts) : null;
  const data = new Uint8Array(union.data.length);
  for (let i = 0; i < data.length; i++) {
    if (!union.data[i]) continue;
    data[i] = maskB !== null && maskB.data[i] ? 2 : 1;
  }
  return { width: union.width, height: union.height, data };
}

/**
 * 라벨 → 화면 색 [r, g, b] (0~255) — 0 = 검정(빈 곳), 1 = 재료 A 색, 2 = 재료 B 색.
 * 색 값은 task0-material TASK0_SLOT_COLOR_HEX 한 곳(3D 재료 색·재료 카드 견본과 같은 값 — task0SlotColorRgb 로 읽는다).
 */
export function materialLabelRgb(label: SliceMaterialLabel): [number, number, number] {
  if (label === 0) return [0, 0, 0];
  const [r, g, b] = task0SlotColorRgb(label === 1 ? "A" : "B");
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
