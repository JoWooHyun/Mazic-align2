/**
 * Task0 2재료 (D1b) — 재료 모드·파일별 재료 슬롯의 기본값과 "메시마다 슬롯" 결정 (앱 배선용 순수 함수)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.4 @ 커밋 a4ebc6c §6(A = T0, B = T1, 층 안 A → B)·§11(manifest materials[]).
 * 설계: `docs/계획_하이브리드슬라이서설정_20260928.md` §5-1(① 역할 자동: 서포트 = A, ② 파일별 A/B)·§5-2(인식·저장 —
 *   `STLFileV2.materialSlot?`, 기본 B, 서포트·브릿지·트렁크는 항상 A), `docs/계획_Z1_task0출력_20261002.md` §4-5(D1b 인계).
 *
 * 데이터 (규칙 1 — 저장·갱신은 repo 경유, 여기는 읽은 값의 기본값 해석만):
 *   - 프로젝트 재료 모드 `ProjectV2.task0MaterialMode?: 'single' | 'dual'` — 없으면(옛 레코드·새 프로젝트) 'single'.
 *   - STL 재료 슬롯 `STLFileV2.materialSlot?: 'A' | 'B'` — 없으면 'B'(계획 §5-2 — 모델 = B, 서포트 = A 가 ① 역할 자동의 기본).
 *   IndexedDB 는 레코드에 선택 필드만 더한다(스토어·인덱스·DB 버전 그대로 — data/db.ts).
 *
 * 메시마다 슬롯 (task0MeshSlots):
 *   씬 handle getSliceGeometry() 가 돌려주는 항목(삼각형 + kind 'stl' | 'support' + stlId)과 같은 순서로 슬롯을 낸다 —
 *   서포트는 **항상 A**(붙은 STL 의 슬롯과 무관), STL 은 그 파일의 materialSlot(기본 B). 단일 모드면 슬롯을 만들지 않는다
 *   (task0ExportMaterialSlots → undefined → 내보내기 코어가 dualMaterial 없이 = 단일 재료 바이트 그대로).
 *
 * 순수 TS — DOM/Babylon 의존 없음 (워커·검증 스크립트 공통).
 */
import type { ProjectV2 } from '../../types/project';
import type { STLFileV2 } from '../../types/stl';
import type { Task0MaterialSlot } from './task0-slice';

/** 프로젝트 재료 모드 — 단일 재료(T0 하나) / 2재료(A = T0, B = T1) */
export type Task0MaterialMode = 'single' | 'dual';

/** 재료 모드 기본값 — 옛 프로젝트 레코드(필드 없음)는 단일 (지금까지의 출력 그대로) */
export const TASK0_DEFAULT_MATERIAL_MODE: Task0MaterialMode = 'single';

/** STL 재료 슬롯 기본값 — 계획 §5-2 "materialSlot?: 'A' | 'B' (기본 B)" */
export const TASK0_DEFAULT_STL_SLOT: Task0MaterialSlot = 'B';

/** 서포트 메시의 슬롯 — 계획 §5-2 "서포트 mesh 는 항상 A. 브릿지·트렁크도 동일" */
export const TASK0_SUPPORT_SLOT: Task0MaterialSlot = 'A';

/** 프로젝트 → 재료 모드 (필드가 없거나 모르는 값이면 기본값) */
export function resolveTask0MaterialMode(
  project: Pick<ProjectV2, 'task0MaterialMode'> | null | undefined,
): Task0MaterialMode {
  const m = project?.task0MaterialMode;
  return m === 'single' || m === 'dual' ? m : TASK0_DEFAULT_MATERIAL_MODE;
}

/** STL 레코드 → 재료 슬롯 (필드가 없거나 모르는 값이면 기본 B) */
export function resolveStlMaterialSlot(file: Pick<STLFileV2, 'materialSlot'> | null | undefined): Task0MaterialSlot {
  const s = file?.materialSlot;
  return s === 'A' || s === 'B' ? s : TASK0_DEFAULT_STL_SLOT;
}

/** 슬라이스 입력 메시의 정체 — 씬 handle getSliceGeometry() 항목의 일부 (components/babylon/babylon-scene-types.ts) */
export interface Task0SliceMeshTag {
  kind: 'stl' | 'support';
  /** kind 'stl' 이면 그 STL id, 'support' 면 붙은 STL id(모르면 없음 — 슬롯 결정에는 쓰지 않는다) */
  stlId?: string;
}

/**
 * 메시마다 재료 슬롯 — items 와 같은 길이·같은 순서. 서포트 → A, STL → 그 파일의 materialSlot(기본 B).
 * STL id 가 목록에 없으면(그럴 일은 없지만) 기본 B.
 */
export function task0MeshSlots(
  items: readonly Task0SliceMeshTag[],
  files: readonly Pick<STLFileV2, 'id' | 'materialSlot'>[],
): Task0MaterialSlot[] {
  const byId = new Map(files.map((f) => [f.id, f] as const));
  return items.map((it) =>
    it.kind === 'support' ? TASK0_SUPPORT_SLOT : resolveStlMaterialSlot(it.stlId === undefined ? undefined : byId.get(it.stlId)),
  );
}

/**
 * 내보내기 코어(task0-export materialSlots)에 넘길 슬롯 — 2재료 모드면 task0MeshSlots, 단일 모드면 undefined
 * (코어가 dualMaterial 없이 단일 재료 경로 = 바이트 그대로).
 */
export function task0ExportMaterialSlots(
  mode: Task0MaterialMode,
  items: readonly Task0SliceMeshTag[],
  files: readonly Pick<STLFileV2, 'id' | 'materialSlot'>[],
): Task0MaterialSlot[] | undefined {
  return mode === 'dual' ? task0MeshSlots(items, files) : undefined;
}

/**
 * 재료 표시 색 (화면 전용 — 산출물과 무관). 3D 씬(handle setMaterialSlotColors)과 목록·패널 표식이 같은 값을 쓴다.
 * A = 주황(서포트도 A 라 같은 색), B = 보라. rgb 는 hex 에서 계산(0~1) — 값은 한 곳.
 */
export const TASK0_SLOT_COLOR_HEX: Readonly<Record<Task0MaterialSlot, string>> = Object.freeze({
  A: '#F59E0B',
  B: '#8B5CF6',
});

/** '#RRGGBB' → [r, g, b] (0~1) */
export function task0SlotColorRgb(slot: Task0MaterialSlot): [number, number, number] {
  const hex = TASK0_SLOT_COLOR_HEX[slot];
  const v = (i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
  return [v(0), v(1), v(2)];
}
