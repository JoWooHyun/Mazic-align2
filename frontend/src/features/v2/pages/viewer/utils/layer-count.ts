// 씬 최고점·층높이 → 총 레이어 수. (useSliceExport 에서 추출 — 동작 불변.)

import type { PrinterProfileV2 } from "../../../types/printer";
import { task0NormalizeTopY } from "../../../utils/task0/task0-frame";
import { isTask0Profile } from "../../../utils/task0/task0-profile";

/**
 * 씬 최고점·층높이로 총 레이어 수를 구한다.
 *
 * 미리보기 토글 핸들러(ViewerV2Page)와 useSliceExport 가 같은 수를 필요로 한다 —
 * 두 곳이 각자 계산하면 갈라진다(규칙 6 의 정신).
 *
 * 훅이 아닌 순수 함수라 별도 모듈로 둔다: useSliceExport 는 Vite 전용
 * `?worker` import 체인(slice-batch-service)을 끌고 와 헤드리스 검증 스크립트
 * (npx tsx)에서 import 가 불가능하다.
 */
export function layerCountFor(topY: number, layerHeightMm: number): number {
  return Math.max(1, Math.ceil(topY / layerHeightMm));
}

/**
 * 미리보기 층 수 (Z3) — Task0 프로파일이면 topY 를 task0-frame task0NormalizeTopY(1 µm 반올림)로 읽은 뒤 센다.
 *
 * job.zip·run.gcode 의 층 수는 내보내기 코어 입구에서 정규화한 topY 로 정한다(float32 최고점 0.30000001 → 0.3).
 * 미리보기가 정규화 없이 세면 같은 모델에서 화면 "총 N layer" 가 파일보다 한 층 많아 보인다 → Task0 일 때만 맞춘다.
 * 기존 프로파일은 layerCountFor 그대로 — 마스크 ZIP 층 수(워커 runPngZip 의 같은 식)와 같아야 하므로 바꾸지 않는다
 * (Task0 프로파일에서는 마스크 ZIP 버튼이 숨겨져 있어 산출물에 영향 없음).
 */
export function previewLayerCount(
  topY: number,
  layerHeightMm: number,
  profile: Pick<PrinterProfileV2, "outputKind">,
): number {
  return layerCountFor(
    isTask0Profile(profile) ? task0NormalizeTopY(topY) : topY,
    layerHeightMm,
  );
}
