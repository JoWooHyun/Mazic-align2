/**
 * Task0 좌표·층 규약 — 단일 소스 (규격서 v0.3.3 §1·§3·§5·§8·§11, 협의 §25~§26)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c.
 * 설계: `docs/계획_Z1_task0출력_20261002.md` S2·S4·S6.
 *
 * writer(task0-gcode-writer.ts)·검증 스크립트·(Z3) 마스크 래스터가 **같은 변환**을 쓰도록 여기 한 곳에 둔다.
 * ★ 지금은 TASK0_DEFAULTS 가 Task0 값의 단일 소스다. Z2 에서 Task0 프린터 프로파일(types/printer.ts 쪽)로
 *   이관할 예정 — 그때 이 상수는 프로파일 기본값으로 옮기고 여기서는 지운다(규칙 6: 기본값 단일 소스).
 *
 * 좌표계:
 *   - world: Babylon Y-up. 빌드플레이트 중심이 (X, Z) = (0, 0), 높이는 Y (기존 슬라이스 규약 그대로).
 *   - 베드(G-code): 코너 원점 mm. 베드 X = world X + W/2, 베드 Y = world Z + D/2
 *     (기존 FDM 규약 `utils/gcode/fdm-gcode.ts` 머리 주석과 같다 — Z+ 가 커질수록 베드 Y 도 커짐).
 *   - 픽셀(마스크 PNG): 열 0 = 베드 X 최소, 행 0 = 베드 Y 최대(위에서 내려다본 평면도, 규격 §11).
 *     픽셀 (c, r) 은 X ∈ [ox + c·p, ox + (c+1)·p), Y ∈ [oy + (H−1−r)·p, oy + (H−r)·p) 를 덮는다.
 *     (ox, oy) = 투사 시작점, p = 피치(mm), H = 세로 픽셀 수.
 *
 * 층 규약 (규격 §3 — 마스크 경로 `workers/slice-batch.worker.ts` runPngZip 과 같은 식):
 *   층 수 = max(1, ceil(topY / lh)) (topY ≤ 0 이면 0), 층 N 단면 높이 = (N + 0.5)·lh, 층 N 의 Z = (N + 1)·lh.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음.
 */

/** Task0 기본값 묶음 — 길이 mm, 속도 mm/s, 피치 µm, 픽셀 px */
export interface Task0Defaults {
  /** 베드 가로(노즐 X 범위) mm — §1 */
  readonly bedWidthMm: number;
  /** 베드 세로(노즐 Y 범위) mm — §1 */
  readonly bedDepthMm: number;
  /** 투사 가로 픽셀 수 — §1·§11 */
  readonly projectorWidthPx: number;
  /** 투사 세로 픽셀 수 — §1·§11 */
  readonly projectorHeightPx: number;
  /** 정사각 픽셀 단일 피치 p (µm) — §1, 잠정 73 µm */
  readonly pixelPitchUm: number;
  /** 투사 시작점 X (mm) — §1 */
  readonly projectorOffsetXMm: number;
  /** 투사 시작점 Y (mm) — §1 */
  readonly projectorOffsetYMm: number;
  /** 출력 가능 영역(투사 ∩ 노즐 범위) — §1, X 10~150 × Y 10~85 고정 */
  readonly printableXMinMm: number;
  readonly printableXMaxMm: number;
  readonly printableYMinMm: number;
  readonly printableYMaxMm: number;
  /** 도포폭 w (mm) — 협의 §25-2 잠정 */
  readonly depositWidthMm: number;
  /** 시린지 상수 K = 플런저 1 mm 당 배출 부피 (mm³/mm) — §5 【미정】, 잠정 165 (10 mL 안지름 14.5 mm 가정) */
  readonly syringeKMm3PerMm: number;
  /** 과충전 배율 기본 — §5 */
  readonly overfill: number;
  /** 과충전 배율 상한 — §5 */
  readonly overfillMax: number;
  /** 리트랙트 거리 r (mm) — §5, 잠정 1.0 */
  readonly retractMm: number;
  /** 리트랙트 생략 최소 트래블 (mm) — §5 retractMinTravel 기본 1.0. 이보다 짧은 트래블은 리트랙트 생략 */
  readonly retractMinTravelMm: number;
  /** 도포 속도 (mm/s) — §8 초안 한계 F1800 */
  readonly depositSpeedMmS: number;
  /** 트래블 속도 (mm/s) — §8 초안 한계 F6000 */
  readonly travelSpeedMmS: number;
  /** E 단독 줄(리트랙트·언리트랙트) 속도 (mm/s) — §8 초안 한계 F1800 */
  readonly retractSpeedMmS: number;
  /** Task0 파킹 위치 (mm) — §9 층 경계에서 Task0 가 (0,0) 으로 파킹. 층 첫 트래블 길이 통계에만 쓴다 */
  readonly parkXMm: number;
  readonly parkYMm: number;
}

/** Task0 기본값 — 단일 소스 (Z2 에서 프린터 프로파일로 이관 예정) */
export const TASK0_DEFAULTS: Task0Defaults = Object.freeze({
  bedWidthMm: 150,
  bedDepthMm: 85,
  projectorWidthPx: 1920,
  projectorHeightPx: 1080,
  pixelPitchUm: 73,
  projectorOffsetXMm: 10,
  projectorOffsetYMm: 10,
  printableXMinMm: 10,
  printableXMaxMm: 150,
  printableYMinMm: 10,
  printableYMaxMm: 85,
  depositWidthMm: 0.5,
  syringeKMm3PerMm: 165,
  overfill: 1.0,
  overfillMax: 1.2,
  retractMm: 1.0,
  retractMinTravelMm: 1.0,
  depositSpeedMmS: 30,
  travelSpeedMmS: 100,
  retractSpeedMmS: 30,
  parkXMm: 0,
  parkYMm: 0,
});

/** 픽셀 변환에 필요한 투사 값만 */
export type Task0ProjectorFrame = Pick<
  Task0Defaults,
  'projectorHeightPx' | 'pixelPitchUm' | 'projectorOffsetXMm' | 'projectorOffsetYMm'
>;

/** 출력 가능 영역 값만 */
export type Task0PrintableFrame = Pick<
  Task0Defaults,
  'printableXMinMm' | 'printableXMaxMm' | 'printableYMinMm' | 'printableYMaxMm'
>;

/**
 * world (X, Z) → 베드 (X, Y) mm. 베드 X = x + W/2, 베드 Y = z + D/2.
 * world 원점(플레이트 중심)이 베드 가운데 (W/2, D/2) 로 간다.
 */
export function worldToBed(
  x: number,
  z: number,
  bedWidthMm: number = TASK0_DEFAULTS.bedWidthMm,
  bedDepthMm: number = TASK0_DEFAULTS.bedDepthMm,
): [number, number] {
  return [x + bedWidthMm / 2, z + bedDepthMm / 2];
}

/** 베드 (X, Y) → world (X, Z) mm — worldToBed 의 역 */
export function bedToWorld(
  bedX: number,
  bedY: number,
  bedWidthMm: number = TASK0_DEFAULTS.bedWidthMm,
  bedDepthMm: number = TASK0_DEFAULTS.bedDepthMm,
): [number, number] {
  return [bedX - bedWidthMm / 2, bedY - bedDepthMm / 2];
}

/**
 * 베드 (X, Y) mm → 그 점을 덮는 픽셀 [열, 행] (정수, 투사 범위 밖이면 범위 밖 번호 그대로).
 * 열 0 = X 최소, 행 0 = Y 최대. 픽셀 경계 위의 점은 반열림 규칙([시작, 끝))대로
 * X 는 경계 오른쪽 열, Y 는 경계 위쪽 픽셀(= 행 번호가 작은 쪽)에 속한다.
 */
export function bedToPixel(
  bedX: number,
  bedY: number,
  frame: Task0ProjectorFrame = TASK0_DEFAULTS,
): [number, number] {
  const p = frame.pixelPitchUm / 1000;
  const col = Math.floor((bedX - frame.projectorOffsetXMm) / p);
  const row = frame.projectorHeightPx - 1 - Math.floor((bedY - frame.projectorOffsetYMm) / p);
  return [col, row];
}

/** 픽셀 [열, 행] → 그 픽셀 중심의 베드 (X, Y) mm */
export function pixelCenterToBed(
  col: number,
  row: number,
  frame: Task0ProjectorFrame = TASK0_DEFAULTS,
): [number, number] {
  const p = frame.pixelPitchUm / 1000;
  return [
    frame.projectorOffsetXMm + (col + 0.5) * p,
    frame.projectorOffsetYMm + (frame.projectorHeightPx - row - 0.5) * p,
  ];
}

/** 베드 점이 출력 가능 영역 안인지 (경계 포함) */
export function isInPrintableArea(
  bedX: number,
  bedY: number,
  frame: Task0PrintableFrame = TASK0_DEFAULTS,
): boolean {
  return (
    bedX >= frame.printableXMinMm &&
    bedX <= frame.printableXMaxMm &&
    bedY >= frame.printableYMinMm &&
    bedY <= frame.printableYMaxMm
  );
}

/**
 * 층 수 — 마스크 경로(runPngZip)와 **같은 식**: topY ≤ 0 이면 0, 아니면 max(1, ceil(topY / lh)).
 * topY = 서포트 포함 최고점 (플레이트 0 기준, mm). 식을 바꾸면 G-code 층 수 ≠ PNG 수 가 된다.
 */
export function task0LayerCount(topY: number, layerHeightMm: number): number {
  if (topY <= 0) return 0;
  return Math.max(1, Math.ceil(topY / layerHeightMm));
}

/** 층 N(0-based) 의 Z = (N + 1)·lh — `;Z:` 와 층 첫 `G1 Z` 값 (규격 §3) */
export function task0LayerZ(layerIndex: number, layerHeightMm: number): number {
  return (layerIndex + 1) * layerHeightMm;
}

/** 층 N(0-based) 의 단면 높이 = (N + 0.5)·lh — 마스크 PNG 와 같은 단면 (규격 §3) */
export function task0SliceY(layerIndex: number, layerHeightMm: number): number {
  return (layerIndex + 0.5) * layerHeightMm;
}

/**
 * 시간 추정 상수 (s) — 규격서 v0.3.3 §13 (잠정). job.zip manifest `estimate` 계산에 쓴다(task0-jobzip.ts).
 * 층당 시간 = 도포 + 트래블 + 툴전환 횟수 × toolChangeSec + parkSec + bladeSec + layerOverheadSec + 노광.
 */
export interface Task0TimeConstants {
  /** 툴 전환 1회 (퍼지 도입 시 5~15) */
  readonly toolChangeSec: number;
  /** 층당 노즐 파킹 */
  readonly parkSec: number;
  /** 층당 블레이드 (스윕 140 mm @ 20 mm/s 왕복 + 리프트) */
  readonly bladeSec: number;
  /** 층당 오버헤드 */
  readonly layerOverheadSec: number;
}

/** 시간 추정 상수 — 규격서 §13 값 그대로 (바뀌면 규격서와 함께) */
export const TASK0_TIME_CONSTANTS: Task0TimeConstants = Object.freeze({
  toolChangeSec: 0.5,
  parkSec: 3,
  bladeSec: 15,
  layerOverheadSec: 2,
});
