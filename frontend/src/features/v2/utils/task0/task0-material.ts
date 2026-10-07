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
 *   - (D2) 재료 이름 `ProjectV2.task0MaterialNames?: { A?, B? }` — 없거나 빈 슬롯은 기본 이름(A 모델레진 / B 템프레진 —
 *     task0-jobzip 상수). 정규화는 normalizeTask0MaterialName 한 곳(화면 표시·저장·manifest 공통), manifest 에는 2재료일 때만.
 *   IndexedDB 는 레코드에 선택 필드만 더한다(스토어·인덱스·DB 버전 그대로 — data/db.ts).
 *   (D2) 복제·붙여넣기는 원본 STL 의 materialSlot 을 물려받는다(task0CopySlotInit — repo createStlFile init). 새 파일은 기본 B.
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
import { TASK0_DEFAULT_MATERIAL_NAME, TASK0_DEFAULT_MATERIAL_NAME_B } from './task0-jobzip';
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

// ==================== 재료 이름 (D2) ====================

/**
 * 재료 이름 최대 길이 (유니코드 코드 포인트 수). 규격서 v0.3.4 §11 은 materials[].name 을 Task0 GUI 가 표시만 하는 자유 문자열로
 * 둔다(길이 제한 없음) — 표시 칸(Task0 GUI 재료 라벨·우리 재료 카드 한 줄)에 들어가는 길이로 잡았다. 기본 이름(4자)이나
 * 제품명 수준("Formlabs Dental LT V2" 21자)은 들어가고, 붙여넣은 긴 문장은 잘린다.
 */
export const TASK0_MATERIAL_NAME_MAX_LENGTH = 24;

/** 슬롯별 재료 이름 (기본값을 채운 값) */
export type Task0MaterialNames = Record<Task0MaterialSlot, string>;

/** 재료 이름 기본값 — A = 모델레진, B = 템프레진 (task0-jobzip 상수 한 곳 — manifest 기본값과 같은 값) */
export const TASK0_DEFAULT_MATERIAL_NAMES: Readonly<Task0MaterialNames> = Object.freeze({
  A: TASK0_DEFAULT_MATERIAL_NAME,
  B: TASK0_DEFAULT_MATERIAL_NAME_B,
});

/** 공백으로 바꿀 줄바꿈·탭 계열 (코드 포인트) — 탭·LF·VT·FF·CR·NEL(C1)·줄/문단 구분자 */
const NAME_SPACE_LIKE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029]);

/** 버릴 문자 — C0(U+0000~001F)·DEL·C1(U+0080~009F) 제어문자, BOM, 짝 없는 서로게이트 */
function isNameDropped(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0xfeff || (cp >= 0xd800 && cp <= 0xdfff);
}

/**
 * 재료 이름 정규화 — 화면 표시(재료 카드)·저장(repo)·manifest(task0-export)가 **이 함수 하나**를 쓴다.
 *   줄바꿈·탭 → 공백, 제어문자(C0·DEL·C1)·BOM·짝 없는 서로게이트 제거, 앞뒤 공백 제거, 최대 TASK0_MATERIAL_NAME_MAX_LENGTH
 *   코드 포인트(서로게이트 쌍을 가르지 않는다)로 자른 뒤 다시 앞뒤 공백 제거, 비면 fallback. 문자열이 아니면 fallback.
 *   (정규식 대신 코드 포인트 순회 — 제어문자 정규식은 lint no-control-regex 대상)
 */
export function normalizeTask0MaterialName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  let kept = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    if (NAME_SPACE_LIKE.has(cp)) kept += ' ';
    else if (!isNameDropped(cp)) kept += ch;
  }
  let name = kept.trim();
  const cps = Array.from(name);
  if (cps.length > TASK0_MATERIAL_NAME_MAX_LENGTH) name = cps.slice(0, TASK0_MATERIAL_NAME_MAX_LENGTH).join('').trim();
  return name === '' ? fallback : name;
}

/** 프로젝트 → 슬롯별 재료 이름 (정규화·기본값 채움). 옛 레코드(필드 없음)·모르는 값 → 기본 이름 */
export function resolveTask0MaterialNames(
  project: Pick<ProjectV2, 'task0MaterialNames'> | null | undefined,
): Task0MaterialNames {
  const stored = project?.task0MaterialNames;
  const raw = stored !== null && typeof stored === 'object' ? stored : undefined;
  return {
    A: normalizeTask0MaterialName(raw?.A, TASK0_DEFAULT_MATERIAL_NAMES.A),
    B: normalizeTask0MaterialName(raw?.B, TASK0_DEFAULT_MATERIAL_NAMES.B),
  };
}

/**
 * 저장할 재료 이름 필드 — 지금 저장값(current)에서 slot 만 raw 로 바꾼 값(정규화). 기본 이름과 같은 슬롯은 빼고,
 * 둘 다 기본이면 undefined(레코드는 기본값으로 읽힌다). 저장은 부르는 쪽이 repo 경유로(규칙 1 — useProjectV2.update).
 */
export function task0MaterialNamesWith(
  current: ProjectV2['task0MaterialNames'],
  slot: Task0MaterialSlot,
  raw: string,
): ProjectV2['task0MaterialNames'] {
  const names = resolveTask0MaterialNames({ task0MaterialNames: current });
  names[slot] = normalizeTask0MaterialName(raw, TASK0_DEFAULT_MATERIAL_NAMES[slot]);
  const out: { A?: string; B?: string } = {};
  if (names.A !== TASK0_DEFAULT_MATERIAL_NAMES.A) out.A = names.A;
  if (names.B !== TASK0_DEFAULT_MATERIAL_NAMES.B) out.B = names.B;
  return out.A === undefined && out.B === undefined ? undefined : out;
}

/**
 * 내보내기 코어(task0-export materialName·materialNameB — job.zip manifest materials[].name)에 넘길 이름.
 * **2재료일 때만** 사용자 이름, 단일 재료는 아무것도 넘기지 않는다(manifest 는 기본 이름 그대로 — 단일 산출물 바이트 불변 우선).
 */
export function task0ExportMaterialNames(
  mode: Task0MaterialMode,
  names: Task0MaterialNames,
): { materialName?: string; materialNameB?: string } {
  return mode === 'dual' ? { materialName: names.A, materialNameB: names.B } : {};
}

// ==================== 복제·붙여넣기 슬롯 상속 (D2) ====================

/**
 * 복제·붙여넣기로 새로 만드는 STL 레코드가 원본에서 물려받을 재료 슬롯 — 원본에 슬롯이 있으면 그 값, 없으면(기본 B) 필드 없음.
 * repo createStlFile 의 init 으로 넘긴다(규칙 1). 드롭·파일 열기·예제(새 파일)는 이 함수를 쓰지 않는다 — 기본(B) 그대로.
 */
export function task0CopySlotInit(
  src: Pick<STLFileV2, 'materialSlot'> | null | undefined,
): Pick<STLFileV2, 'materialSlot'> {
  const s = src?.materialSlot;
  return s === 'A' || s === 'B' ? { materialSlot: s } : {};
}
