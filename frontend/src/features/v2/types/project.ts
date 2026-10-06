/**
 * v2 프로젝트 데이터 모델.
 *
 * 옛 Project (백엔드 DB row) 와 무관하게 다시 정의한다. 모든 시간은
 * epoch ms. id 는 클라이언트에서 crypto.randomUUID 로 발급.
 */
export interface ProjectV2 {
  id: string;
  name: string;
  /** 사용자가 식별하기 위한 짧은 코드 (영문 대문자 + 숫자, 8자리). */
  code: string;
  createdAt: number;
  lastModifiedAt: number;
  /** 환자 메모 등 자유 텍스트. 선택. */
  note?: string;
  /**
   * Task0 재료 모드 (D1b) — 'single' 단일 재료(T0 하나) / 'dual' 2재료(A = T0, B = T1, 파일별 STLFileV2.materialSlot,
   * 서포트는 항상 A). 없으면 단일 (해석은 utils/task0/task0-material.ts resolveTask0MaterialMode).
   * Task0 프로파일에서만 쓰인다. IndexedDB 레코드의 선택 필드(스토어·인덱스·버전 변경 없음).
   */
  task0MaterialMode?: "single" | "dual";
}

/** 새 프로젝트 생성 시 호출 측이 채워야 하는 필드. */
export type ProjectV2CreateInput = Pick<ProjectV2, "name"> &
  Partial<Pick<ProjectV2, "note">>;
