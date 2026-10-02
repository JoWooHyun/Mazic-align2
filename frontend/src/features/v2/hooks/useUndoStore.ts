import { create } from "zustand";

/**
 * v2 Undo/Redo 스택.
 *
 * 각 entry 는 `undo` / `redo` 두 콜백을 들고 있다 — 인보크 하면 그
 * 변경을 되돌리거나 다시 적용한다. 데이터 스냅샷이 아니라 콜백
 * 기반이라 비동기 DB 변경에도 자연스럽다.
 *
 * push 시 future 는 비운다 (브랜치 끊김).
 *
 * 실행 규칙 (정리_20261001 §4-2 신규 3·6):
 * - **진행 중 무시**: undo/redo 콜백을 await 하는 동안(busy) 들어온 undo/redo
 *   호출은 버린다(큐에 쌓지 않음). Ctrl+Z 연타·키 반복으로 같은 항목이 두 번
 *   실행되던 사고 방지. 꾹 누르면 하나 끝날 때마다 다음 반복 키가 다음 항목을
 *   되돌린다.
 * - **실패 항목 폐기**: 콜백이 throw 하면 그 항목을 이력에서 버린다(반대편
 *   스택으로도 옮기지 않음). 다음 호출은 그 앞 항목으로 진행하고,
 *   undo()/redo() 자체는 절대 reject 하지 않는다.
 * - **clear 세대**: clear() 는 gen 을 올린다. await 중 clear 가 불렸으면(프로젝트
 *   전환·STL 삭제) 끝난 항목을 이력에 되살리지 않는다.
 * - 스택에서 뺄 때는 위치(slice)가 아니라 entry identity 로 찾는다 — await 중
 *   다른 변화가 있어도 엉뚱한 항목을 빼지 않게.
 */

type Cb = () => Promise<void> | void;

export interface UndoEntry {
  label: string;
  undo: Cb;
  redo: Cb;
}

interface UndoState {
  past: UndoEntry[];
  future: UndoEntry[];
  /** undo/redo 콜백 실행 중. true 인 동안 새 undo/redo 호출은 무시된다. */
  busy: boolean;
  /** clear 세대 카운터 — clear() 마다 +1. 진행 중 작업이 끝났을 때 비교용. */
  gen: number;
  push: (entry: UndoEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clear: () => void;
  /** 디버그용. */
  _peek: () => { past: number; future: number };
}

const MAX_DEPTH = 100;

export const useUndoStore = create<UndoState>((set, get) => ({
  past: [],
  future: [],
  busy: false,
  gen: 0,

  push: (entry) =>
    set((s) => {
      const past = [...s.past, entry];
      while (past.length > MAX_DEPTH) past.shift();
      return { past, future: [] };
    }),

  undo: async () => {
    const { busy, past, gen } = get();
    if (busy || past.length === 0) return;
    const entry = past[past.length - 1];
    set({ busy: true });
    try {
      await entry.undo();
      set((s) =>
        s.gen !== gen
          ? {}
          : {
              past: s.past.filter((e) => e !== entry),
              future: [...s.future, entry],
            },
      );
    } catch (err) {
      // 실패 항목은 버린다 — 남겨 두면 Ctrl+Z 마다 같은 실패를 반복해 이력이 막힌다.
      console.warn(`[undo] "${entry.label}" 되돌리기 실패 — 이력에서 제외:`, err);
      set((s) =>
        s.gen !== gen ? {} : { past: s.past.filter((e) => e !== entry) },
      );
    } finally {
      set({ busy: false });
    }
  },

  redo: async () => {
    const { busy, future, gen } = get();
    if (busy || future.length === 0) return;
    const entry = future[future.length - 1];
    set({ busy: true });
    try {
      await entry.redo();
      set((s) =>
        s.gen !== gen
          ? {}
          : {
              past: [...s.past, entry],
              future: s.future.filter((e) => e !== entry),
            },
      );
    } catch (err) {
      // 실패 항목은 버린다 — undo 와 대칭.
      console.warn(`[redo] "${entry.label}" 다시 실행 실패 — 이력에서 제외:`, err);
      set((s) =>
        s.gen !== gen ? {} : { future: s.future.filter((e) => e !== entry) },
      );
    } finally {
      set({ busy: false });
    }
  },

  // busy 는 건드리지 않는다 — 진행 중 작업의 finally 가 내린다.
  clear: () => set((s) => ({ past: [], future: [], gen: s.gen + 1 })),

  _peek: () => ({ past: get().past.length, future: get().future.length }),
}));
