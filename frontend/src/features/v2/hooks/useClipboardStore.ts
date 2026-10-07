import { create } from "zustand";

/**
 * v2 모델 클립보드.
 *
 * fileName + Blob 을 그대로 보관한다. 원본이 삭제된 뒤에도 붙여넣기
 * 가능하도록 ID 가 아닌 자료를 들고 있는다. 잘라내기(Ctrl+X) 가
 * 안전해진다.
 */
export interface ClipboardItem {
  fileName: string;
  blob: Blob;
  /** 원본의 Task0 재료 슬롯 (D2) — 붙여넣은 새 STL 이 물려받는다. 원본에 없으면 없음(기본 B). */
  materialSlot?: "A" | "B";
}

interface ClipboardState {
  items: ClipboardItem[];
  set: (items: ClipboardItem[]) => void;
  clear: () => void;
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  items: [],
  set: (items) => set({ items }),
  clear: () => set({ items: [] }),
}));
