import type { TransformV2 } from "./transform";

/**
 * v2 STL 파일 메타 + Blob + Transform.
 *
 * 옛 STLFile 과 무관. 한 프로젝트에 여러 개. Blob 은 IndexedDB 가
 * 그대로 보관 (브라우저가 직렬화한다).
 *
 * `transform` 이 없는 옛 레코드는 호출 측이 IDENTITY_TRANSFORM 으로
 * 처리한다.
 */
export interface STLFileV2 {
  id: string;
  projectId: string;
  fileName: string;
  blob: Blob;
  fileSize: number;
  addedAt: number;
  transform?: TransformV2;
  /**
   * Task0 2재료 재료 슬롯 (D1b) — A = T0, B = T1 (규격서 v0.3.4 §6). 없으면 B
   * (`docs/계획_하이브리드슬라이서설정_20260928.md` §5-2 — 해석은 utils/task0/task0-material.ts resolveStlMaterialSlot).
   * 프로젝트 재료 모드가 2재료일 때만 쓰인다. IndexedDB 레코드의 선택 필드(스토어·인덱스·버전 변경 없음).
   */
  materialSlot?: "A" | "B";
}
