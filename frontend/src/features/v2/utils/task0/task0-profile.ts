/**
 * Task0 프린터 프로파일 — 빌트인 정의 · 판정 · 프로파일 → Task0 값 (Z2, 규격서 v0.3.3 §1)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c.
 * 설계: `docs/계획_Z1_task0출력_20261002.md` §4·§4-2 (Z2 인계).
 *
 * 값의 출처 (규칙 6 — 기본값 단일 소스):
 *   - Task0 숫자는 전부 task0-frame.ts TASK0_DEFAULTS 한 곳. 빌트인 프로파일은 그 값을 **참조**만 하고,
 *     프로파일의 Task0 선택 필드(types/printer.ts Task0ProfileFields)가 비면 거기로 폴백한다.
 *   - 베드 크기 = buildVolumeMm[0]·[1] (뷰어 플레이트와 같은 값이라 world ↔ 베드 변환이 화면과 맞는다).
 *     투사 해상도·피치 = lcdWidthPx·lcdHeightPx·pixelPitchUm.
 *   - 출력 높이 = TASK0_DEFAULTS.zTravelMaxMm(2000) — 뷰어에서 높이는 출력영역 검사의 높이 상한에만 쓰인다
 *     (플레이트·격자·카메라 맞춤은 가로·세로만 씀 — scene-setup·camera-views 확인). 그래서 표시용 높이를 따로 두지 않았다.
 *
 * 순수 TS — DOM/Babylon 의존 없음.
 */
import type { PrinterProfileV2 } from '../../types/printer';
import {
  TASK0_DEFAULTS,
  task0PrintableWorldRect,
  type Task0PrintableFrame,
  type Task0PrintableWorldRect,
  type Task0ProjectorFrame,
} from './task0-frame';
import type { Task0WriterOptions } from './task0-gcode-writer';
import type { Task0RasterFrame } from './task0-mask';

/** 빌트인 Task0 프로파일 id — 새 설치(저장값 없음)의 기본 선택 (hooks/usePrinterProfileStore.ts) */
export const TASK0_PROFILE_ID = 'mazicalign-task0';

/**
 * 빌트인 Task0 프로파일. 노광·리프트 필드는 두지 않는다 — 노광은 types/printer.ts DEFAULT_* 폴백
 * (Task0 예상 시간의 노광 항목), 리프트는 Task0 가 층 경계 동작을 직접 한다(규격 §9).
 * task0 필드도 두지 않는다 — 전부 TASK0_DEFAULTS 폴백.
 */
export const TASK0_BUILT_IN_PROFILE: PrinterProfileV2 = {
  id: TASK0_PROFILE_ID,
  name: 'Task0 하이브리드 (MazicAlign)',
  lcdWidthPx: TASK0_DEFAULTS.projectorWidthPx,
  lcdHeightPx: TASK0_DEFAULTS.projectorHeightPx,
  pixelPitchUm: TASK0_DEFAULTS.pixelPitchUm,
  buildVolumeMm: [TASK0_DEFAULTS.bedWidthMm, TASK0_DEFAULTS.bedDepthMm, TASK0_DEFAULTS.zTravelMaxMm],
  outputKind: 'task0',
};

/** Task0 출력 프로파일인지 — outputKind 가 없으면(기존 프로파일·저장값) false */
export function isTask0Profile(p: Pick<PrinterProfileV2, 'outputKind'>): boolean {
  return p.outputKind === 'task0';
}

/** 프로파일에서 읽은 Task0 좌표 값 (베드 mm, 피치 µm, 픽셀 px) */
export interface Task0ProfileFrame extends Task0PrintableFrame, Task0ProjectorFrame {
  bedWidthMm: number;
  bedDepthMm: number;
  projectorWidthPx: number;
}

/** 프로파일 → Task0 좌표 값. 선택 필드가 비면 TASK0_DEFAULTS (규칙 6) */
export function resolveTask0ProfileFrame(p: PrinterProfileV2): Task0ProfileFrame {
  const f = p.task0 ?? {};
  const d = TASK0_DEFAULTS;
  return {
    bedWidthMm: p.buildVolumeMm[0],
    bedDepthMm: p.buildVolumeMm[1],
    projectorWidthPx: p.lcdWidthPx,
    projectorHeightPx: p.lcdHeightPx,
    pixelPitchUm: p.pixelPitchUm,
    projectorOffsetXMm: f.projectorOffsetXMm ?? d.projectorOffsetXMm,
    projectorOffsetYMm: f.projectorOffsetYMm ?? d.projectorOffsetYMm,
    printableXMinMm: f.printableXMinMm ?? d.printableXMinMm,
    printableXMaxMm: f.printableXMaxMm ?? d.printableXMaxMm,
    printableYMinMm: f.printableYMinMm ?? d.printableYMinMm,
    printableYMaxMm: f.printableYMaxMm ?? d.printableYMaxMm,
  };
}

/**
 * Task0 프로파일이면 world 기준 출력 가능 영역(비대칭), 아니면 null(기존 대칭 플레이트 검사 그대로).
 * 변환은 task0-frame task0PrintableWorldRect(bedToWorld) — 상수를 여기 두지 않는다.
 */
export function task0PrintableAreaForProfile(p: PrinterProfileV2): Task0PrintableWorldRect | null {
  if (!isTask0Profile(p)) return null;
  const f = resolveTask0ProfileFrame(p);
  return task0PrintableWorldRect(f, f.bedWidthMm, f.bedDepthMm);
}

/**
 * 프로파일 → 층 마스크 투사 프레임 (Z3 job.zip — task0-mask rasterizeTask0Mask·manifest projector).
 * 값은 resolveTask0ProfileFrame 그대로(선택 필드가 비면 TASK0_DEFAULTS) — 워커 메시지로 넘기도록 래스터에 필요한 다섯 값만.
 */
export function task0RasterFrameForProfile(p: PrinterProfileV2): Task0RasterFrame {
  const f = resolveTask0ProfileFrame(p);
  return {
    projectorWidthPx: f.projectorWidthPx,
    projectorHeightPx: f.projectorHeightPx,
    pixelPitchUm: f.pixelPitchUm,
    projectorOffsetXMm: f.projectorOffsetXMm,
    projectorOffsetYMm: f.projectorOffsetYMm,
  };
}

/**
 * 프로파일 → 출력 가능 영역 (베드 mm — Z3 내보내기 코어의 writer 전 차단, task0-export 머리 주석 1-b).
 * 값은 resolveTask0ProfileFrame 그대로(선택 필드가 비면 TASK0_DEFAULTS) — 워커 메시지로 넘기도록 네 값만.
 * 화면 테두리·배너(task0PrintableAreaForProfile)와 같은 출처라 "화면에서 안이면 내보내기도 안" 이다.
 */
export function task0PrintableFrameForProfile(p: PrinterProfileV2): Task0PrintableFrame {
  const f = resolveTask0ProfileFrame(p);
  return {
    printableXMinMm: f.printableXMinMm,
    printableXMaxMm: f.printableXMaxMm,
    printableYMinMm: f.printableYMinMm,
    printableYMaxMm: f.printableYMaxMm,
  };
}

/**
 * 프로파일 → writer 옵션. 지금은 베드 크기만 넘긴다(world → 베드 변환이 뷰어 플레이트와 같도록).
 * 도포폭·K·속도 등은 writer 의 TASK0_DEFAULTS 폴백 그대로 — 프로파일에서 속도를 받게 되면 규격 §8 한계
 * (도포·E 단독 F1800, 트래블 F6000)를 PROFILE_FIELD_LIMITS 로 막을 것(계획서 §4 Z2 인계).
 * 출력 가능 영역은 writer 의 채움 우회 범위가 아직 TASK0_DEFAULTS 를 쓴다 — 빌트인 값과 같다.
 */
export function task0WriterOptionsForProfile(
  p: PrinterProfileV2,
): Pick<Task0WriterOptions, 'bedWidthMm' | 'bedDepthMm'> {
  const f = resolveTask0ProfileFrame(p);
  return { bedWidthMm: f.bedWidthMm, bedDepthMm: f.bedDepthMm };
}
