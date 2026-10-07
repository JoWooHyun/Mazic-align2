// Task0 2재료 재료 색 (D2) — 씬의 "재료 색 상태"(ctx.materialSlotColorsRef)를 STL·서포트·슬라이스 단면 fill 의 표시 색에
//   적용하는 공용 함수. 화면 전용(산출물 무관 — 머티리얼 색·fill 머티리얼 지정만 바꾼다, 정점 데이터·메시 형상 무변경).
//
//   왜 상태인가 (D1b 검수 남은 위험): D1b 는 handle setMaterialSlotColors 가 색만 칠하고, useEditModeSync·useFileMeshSync 가
//   STL 색을 setModelDiffuseMode 로 되돌리면 부모 effect(useTask0Material)가 다시 칠하는 **effect 순서**에 기댔다 — 슬라이스
//   진입 뒤 끝나는 비동기 메시 로드가 있으면 그 STL 만 원래 색으로 남았다. 이제 "STL 표시 색을 정하는 모든 지점"
//   (useEditModeSync·useFileMeshSync 로드 완료·setMaterialSlotColors)이 applyModelDisplayColor 하나를 부르고, 그 함수가 상태를 읽는다
//   — 상태가 있으면 슬롯 색, 없으면(단일·Task0 아님·슬라이스 밖) 종전 setModelDiffuseMode 그대로.
//   서포트는 머티리얼 하나를 모든 서포트 메시가 같이 쓴다(useSceneBootstrap 의 createSupportMaterial 1회 — 다시 만들어지는 서포트
//   메시도 같은 머티리얼을 받는다: useSupportMeshSync → createSupportMesh·createRedesignSupportMesh·clipBridgeWithManifold) →
//   머티리얼 색을 상태에 맞춰 두면 서포트 메시 재생성과 무관하게 유지된다.
//   슬라이스 단면 fill 은 메시마다 정체 표식(metadata.sliceFill)을 달고(useSlicePreview), 상태가 바뀌면 이미 그려진 fill 의
//   머티리얼도 바로 바꾼다(applySliceFillMaterials — 머티리얼 참조만 바꿔 층 스크럽 비용 무관).
//
//   새 훅·훅 호출 순서 변경 없음(`docs/리팩토링_LLM구조_20260720.md` §5 불변식 1) — 기존 훅 안의 호출 한 줄을 바꿨다.
import { Color3, StandardMaterial, type Mesh } from "@babylonjs/core";
import {
  MODEL_DIFFUSE_COLOR,
  MODEL_DIFFUSE_COLOR_OVERHANG,
  setModelDiffuseMode,
} from "../../utils/stl-loader";
import {
  TASK0_DEFAULT_STL_SLOT,
  TASK0_SUPPORT_SLOT,
  task0SlotColorRgb,
} from "../../utils/task0/task0-material";
import type { Task0MaterialSlot } from "../../utils/task0/task0-slice";
import type { SceneCtx } from "./scene-refs";

/** 재료 색 상태 — STL id → 재료 슬롯 (없는 id 는 기본 B). null = 상태 없음(원래 색) */
export type MaterialSlotColors = Readonly<Record<string, Task0MaterialSlot>>;

/** 슬라이스 단면 fill 메시의 정체 (useSlicePreview 가 metadata.sliceFill 에 단다) */
export interface SliceFillTag {
  kind: "stl" | "support";
  /** kind 'stl' 이면 그 STL id */
  stlId?: string;
}

/** 이 함수들이 읽고 쓰는 SceneCtx 조각 (검증 스크립트가 가짜 ctx 로 부를 수 있게 좁힌다) */
export type MaterialDisplayCtx = Pick<
  SceneCtx,
  | "materialSlotColorsRef"
  | "meshMapRef"
  | "supportMaterialRef"
  | "editModeRef"
  | "sliceFillMeshesRef"
  | "sliceModelMatRef"
  | "sliceSupportMatRef"
  | "sliceSlotMatsRef"
>;

/**
 * STL 표시 색 (순수 — 색 결정만). 상태가 있으면 그 파일 슬롯 색(없는 id 는 기본 B), 없으면 setModelDiffuseMode 가 칠할 색
 * (overhang = 서포트 탭 흰색 / 그 밖 청록빛 파랑 — utils/stl-loader 상수). 새 Color3 를 돌려준다(상수 오염 방지).
 */
export function modelDisplayColor(
  slots: MaterialSlotColors | null,
  stlId: string,
  overhang: boolean,
): Color3 {
  if (slots !== null) {
    return Color3.FromArray(task0SlotColorRgb(slots[stlId] ?? TASK0_DEFAULT_STL_SLOT));
  }
  return (overhang ? MODEL_DIFFUSE_COLOR_OVERHANG : MODEL_DIFFUSE_COLOR).clone();
}

/**
 * STL 메시 하나의 표시 색을 정한다 — **STL 표시 색을 정하는 모든 지점이 이 함수를 부른다**(useEditModeSync·useFileMeshSync
 * 로드 완료·setMaterialSlotState). 상태가 없으면 종전 setModelDiffuseMode(mesh, overhang) 그대로(색·멱등 동작 같음).
 * @param overhang 서포트 탭(오버행 색 표시) 여부 — 부르는 쪽의 편집 모드
 */
export function applyModelDisplayColor(
  ctx: Pick<MaterialDisplayCtx, "materialSlotColorsRef">,
  stlId: string,
  mesh: Mesh,
  overhang: boolean,
): void {
  const slots = ctx.materialSlotColorsRef.current;
  if (slots === null) {
    setModelDiffuseMode(mesh, overhang);
    return;
  }
  const mat = mesh.material;
  if (!(mat instanceof StandardMaterial)) return;
  const next = modelDisplayColor(slots, stlId, overhang);
  if (mat.diffuseColor.equals(next)) return; // 멱등
  mat.diffuseColor = next;
}

/**
 * 서포트 머티리얼의 칠하기 전 색 — 상태를 걷을 때 되돌린다. 머티리얼 객체 기준이라 씬이 새로 만들어지면(새 머티리얼) 자연히
 * 비어 있다. 서포트 기본색 상수는 utils/support-render.ts createSupportMaterial 한 곳에 있어 복사하지 않는다(D1b 와 같은 방식).
 */
const supportBaseColor = new WeakMap<StandardMaterial, Color3>();

/** 서포트(공유 머티리얼) 표시 색 — 상태가 있으면 재료 A 색(서포트는 항상 A), 없으면 칠하기 전 색으로 */
export function applySupportDisplayColor(
  ctx: Pick<MaterialDisplayCtx, "materialSlotColorsRef" | "supportMaterialRef">,
): void {
  const mat = ctx.supportMaterialRef.current;
  if (!mat) return;
  if (ctx.materialSlotColorsRef.current !== null) {
    if (!supportBaseColor.has(mat)) supportBaseColor.set(mat, mat.diffuseColor.clone());
    mat.diffuseColor = Color3.FromArray(task0SlotColorRgb(TASK0_SUPPORT_SLOT));
    return;
  }
  const base = supportBaseColor.get(mat);
  if (base) {
    mat.diffuseColor = base.clone();
    supportBaseColor.delete(mat);
  }
}

/**
 * 단면 fill 머티리얼 — 상태가 없으면 종전 그대로(STL = sliceModelMat 밝은 회색, 서포트 = sliceSupportMat 하늘색),
 * 있으면 슬롯 fill(STL = 그 파일 슬롯, 서포트 = A). 슬롯 fill 머티리얼은 부트스트랩에서 만든다(sliceSlotMatsRef).
 */
export function sliceFillMaterialFor(
  ctx: Pick<
    MaterialDisplayCtx,
    "materialSlotColorsRef" | "sliceModelMatRef" | "sliceSupportMatRef" | "sliceSlotMatsRef"
  >,
  tag: SliceFillTag,
): StandardMaterial | null {
  const slots = ctx.materialSlotColorsRef.current;
  if (slots === null) {
    return tag.kind === "stl" ? ctx.sliceModelMatRef.current : ctx.sliceSupportMatRef.current;
  }
  const slot: Task0MaterialSlot =
    tag.kind === "support"
      ? TASK0_SUPPORT_SLOT
      : (tag.stlId !== undefined ? slots[tag.stlId] : undefined) ?? TASK0_DEFAULT_STL_SLOT;
  return ctx.sliceSlotMatsRef.current?.[slot] ?? null;
}

/** 이미 그려진 단면 fill 전부의 머티리얼을 지금 상태에 맞춘다 (참조만 바꾼다 — 메시 재생성 없음) */
export function applySliceFillMaterials(
  ctx: Pick<
    MaterialDisplayCtx,
    | "materialSlotColorsRef"
    | "sliceFillMeshesRef"
    | "sliceModelMatRef"
    | "sliceSupportMatRef"
    | "sliceSlotMatsRef"
  >,
): void {
  for (const fm of ctx.sliceFillMeshesRef.current) {
    const tag = (fm.metadata as { sliceFill?: SliceFillTag } | null)?.sliceFill;
    if (!tag) continue;
    const mat = sliceFillMaterialFor(ctx, tag);
    if (mat && fm.material !== mat) fm.material = mat;
  }
}

/**
 * 재료 색 상태를 바꾸고 씬 전체에 적용한다 (handle setMaterialSlotColors 본체 — 멱등).
 * slots = STL id → 슬롯이면 STL 은 슬롯 색, 서포트는 A 색, 단면 fill 은 슬롯 fill. null 이면 원래 색
 * (STL = 지금 편집 모드의 표시 색 — setModelDiffuseMode, 서포트 = 칠하기 전 색, fill = 종전 머티리얼).
 * 상태는 복사해 둔다 — 부르는 쪽 객체가 나중에 바뀌어도 씬 상태는 그대로.
 */
export function setMaterialSlotState(
  ctx: MaterialDisplayCtx,
  slots: MaterialSlotColors | null,
): void {
  ctx.materialSlotColorsRef.current = slots === null ? null : Object.freeze({ ...slots });
  const overhang = ctx.editModeRef.current === "support";
  for (const [stlId, mesh] of ctx.meshMapRef.current) {
    applyModelDisplayColor(ctx, stlId, mesh, overhang);
  }
  applySupportDisplayColor(ctx);
  applySliceFillMaterials(ctx);
}
