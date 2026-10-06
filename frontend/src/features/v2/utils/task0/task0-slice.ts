/**
 * Task0 층 단면 — writer·마스크·커버리지 검사기가 함께 쓰는 단일 경로 (규격서 v0.3.3 §3, 계획 S2)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c.
 * 설계: `docs/계획_Z1_task0출력_20261002.md` S2·S4 (Z1-b1 에서 writer 안의 절차를 여기로 뺐다 — writer 출력 바이트 불변).
 *
 * 층 N 단면 = (N+0.5)·lh 에서 **메시마다** sliceTrianglesAtY → chainSegments (워커 sliceLayerMask 와 같은 절차),
 * 점은 task0-frame worldToBed 로 베드 좌표(mm). 점 순서(감김)는 그대로 둔다 — nonzero 채움이 감김으로
 * "겹친 솔리드 = 채움 / 속 빈 내벽 = 구멍" 을 가른다(slice-geometry 머리 주석). 순서를 뒤집는 후처리 금지.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음(slice-geometry 순수 코어만 사용).
 */
import { chainSegments, sliceTrianglesAtY } from '../slice-geometry';
import { TASK0_DEFAULTS, task0SliceY, worldToBed } from './task0-frame';

/** 베드 좌표(mm) 닫힌 폴리곤 — 마지막 점은 첫 점과 이어진 것으로 본다. 점 순서(감김)에 의미가 있다 */
export type Task0BedPolygon = [number, number][];

/**
 * 층 N(0-based) 의 단면 폴리곤 (베드 좌표).
 * @param meshes 메시별 world 삼각형 (삼각형당 숫자 9개, 감김 통일 — extractWorldTriangles 결과). 읽기만 한다.
 * @param layerIndex 층 번호 N — 단면 높이 task0SliceY(N, lh) = (N+0.5)·lh
 * @param layerHeightMm 층두께 lh (mm)
 */
export function task0LayerPolygonsBed(
  meshes: readonly Float32Array[],
  layerIndex: number,
  layerHeightMm: number,
  bedWidthMm: number = TASK0_DEFAULTS.bedWidthMm,
  bedDepthMm: number = TASK0_DEFAULTS.bedDepthMm,
): Task0BedPolygon[] {
  const sliceY = task0SliceY(layerIndex, layerHeightMm);
  const out: Task0BedPolygon[] = [];
  for (const tris of meshes) {
    for (const poly of chainSegments(sliceTrianglesAtY(tris, sliceY))) {
      out.push(poly.points.map(([x, z]) => worldToBed(x, z, bedWidthMm, bedDepthMm)));
    }
  }
  return out;
}
