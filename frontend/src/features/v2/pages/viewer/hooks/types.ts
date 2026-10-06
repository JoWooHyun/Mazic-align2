// viewer 하위 훅들이 공유하는 의존성 타입.
// 데이터 훅의 반환 타입을 ReturnType 으로 파생시켜 시그니처 드리프트를 막는다.

import type { useProjectV2 } from "../../../hooks/useProjectsV2";
import type { useStlFilesV2 } from "../../../hooks/useStlFilesV2";
import type { useSupportsV2 } from "../../../hooks/useSupportsV2";

/** useStlFilesV2 의 add — 생성된 STL(.id 포함)을 반환. */
export type AddStlFile = ReturnType<typeof useStlFilesV2>["add"];
/** useStlFilesV2 의 remove. */
export type RemoveStlFile = ReturnType<typeof useStlFilesV2>["remove"];
/** useStlFilesV2 의 updateTransform. */
export type UpdateTransform = ReturnType<typeof useStlFilesV2>["updateTransform"];
/** useStlFilesV2 의 updateMaterialSlot (Task0 2재료 D1b). */
export type UpdateMaterialSlot = ReturnType<typeof useStlFilesV2>["updateMaterialSlot"];
/** useProjectV2 의 update (프로젝트 필드 갱신 — Task0 재료 모드 D1b). */
export type UpdateProject = ReturnType<typeof useProjectV2>["update"];

/** useSupportsV2 의 addMany. */
export type AddSupports = ReturnType<typeof useSupportsV2>["addMany"];
/** useSupportsV2 의 clearAll. */
export type ClearAllSupports = ReturnType<typeof useSupportsV2>["clearAll"];
/** useSupportsV2 의 refresh. */
export type RefreshSupports = ReturnType<typeof useSupportsV2>["refresh"];
/** useSupportsV2 의 patchSupport. */
export type PatchSupport = ReturnType<typeof useSupportsV2>["patchSupport"];
