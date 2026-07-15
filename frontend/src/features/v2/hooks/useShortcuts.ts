import { useEffect } from "react";
import { create } from "zustand";

/**
 * v2 키보드 단축키 인프라.
 *
 * - useShortcutsListener: 페이지 루트에서 한 번 호출. 글로벌
 *   keydown 리스너를 설치한다.
 * - useShortcutHandler:   각 기능 컴포넌트가 자기 액션 핸들러를
 *   등록·해제한다.
 *
 * 등록된 핸들러가 없으면 키 조합이 눌려도 아무 일 안 일어나고
 * 브라우저 기본 동작도 막지 않는다. 따라서 인프라만 설치해 두고
 * 액션은 다음 단계에서 채워 넣어도 안전하다.
 *
 * INPUT / TEXTAREA / contentEditable 위에서는 항상 패스해서
 * 브라우저의 텍스트 단축키(Ctrl+A 전체 선택 등)를 유지한다.
 */

export type ShortcutAction =
  | "undo"
  | "redo"
  | "selectAll"
  | "copy"
  | "cut"
  | "paste"
  | "delete"
  // ----- 뷰 프리셋 (숫자키, modifier 없음 — 프루사 동일) -----
  | "viewIso" // 0
  | "viewTop" // 1
  | "viewBottom" // 2
  | "viewFront" // 3
  | "viewBack" // 4
  | "viewLeft" // 5
  | "viewRight" // 6
  // ----- 줌 (modifier 없음) -----
  | "zoomFit" // Z: 선택 있으면 선택, 없으면 전체
  | "viewPlate" // B: 플레이트 전체 뷰
  // ----- 도구 (Gizmo 모드, modifier 없음 — 프루사 동일) -----
  | "toolMove" // M
  | "toolRotate" // R
  | "toolScale"; // S

type Handler = () => void;

interface ShortcutsState {
  handlers: Partial<Record<ShortcutAction, Handler>>;
  setHandler: (action: ShortcutAction, handler: Handler | undefined) => void;
}

const useShortcutsStore = create<ShortcutsState>((set) => ({
  handlers: {},
  setHandler: (action, handler) =>
    set((s) => {
      const next = { ...s.handlers };
      if (handler) {
        next[action] = handler;
      } else {
        delete next[action];
      }
      return { handlers: next };
    }),
}));

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * 키 이벤트 → 액션 해석.
 *
 * requiresMeta=true 인 액션은 Ctrl/Cmd 를 함께 눌러야 발동한다(리스너에서 검사).
 * requiresMeta=false 인 뷰/도구 단축키는 프루사와 동일하게 modifier 없이 동작하며,
 *   여기서 Ctrl/Cmd/Alt 가 눌린 경우엔 아예 해석하지 않아 브라우저·기존 meta
 *   단축키(Ctrl+Z 등)와 충돌하지 않게 한다. Shift 는 뷰/도구 키 판정에 관여하지
 *   않는다(dental 색칠·두께 조정 등 Shift 조합과 분리).
 */
function resolveAction(e: KeyboardEvent): {
  action: ShortcutAction;
  requiresMeta: boolean;
} | null {
  if (e.key === "Delete" || e.key === "Backspace") {
    return { action: "delete", requiresMeta: false };
  }
  const key = e.key.toLowerCase();

  // ----- modifier 조합 액션 (Ctrl/Cmd) -----
  if (key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey)
    return { action: "undo", requiresMeta: true };
  if (key === "y") return { action: "redo", requiresMeta: true };
  if (key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey)
    return { action: "redo", requiresMeta: true };
  if (key === "a") return { action: "selectAll", requiresMeta: true };
  if (key === "c") return { action: "copy", requiresMeta: true };
  if (key === "x") return { action: "cut", requiresMeta: true };
  if (key === "v") return { action: "paste", requiresMeta: true };

  // ----- modifier 없는 뷰/줌/도구 단축키 (프루사 동일) -----
  // Ctrl/Cmd/Alt 동반 시엔 무시 → 브라우저 단축키 및 위 meta 액션과 비충돌.
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  switch (e.key) {
    case "0":
      return { action: "viewIso", requiresMeta: false };
    case "1":
      return { action: "viewTop", requiresMeta: false };
    case "2":
      return { action: "viewBottom", requiresMeta: false };
    case "3":
      return { action: "viewFront", requiresMeta: false };
    case "4":
      return { action: "viewBack", requiresMeta: false };
    case "5":
      return { action: "viewLeft", requiresMeta: false };
    case "6":
      return { action: "viewRight", requiresMeta: false };
  }
  // 문자키는 대소문자 무관하게 처리.
  switch (key) {
    case "z":
      return { action: "zoomFit", requiresMeta: false };
    case "b":
      return { action: "viewPlate", requiresMeta: false };
    case "m":
      return { action: "toolMove", requiresMeta: false };
    case "r":
      return { action: "toolRotate", requiresMeta: false };
    case "s":
      return { action: "toolScale", requiresMeta: false };
  }
  return null;
}

/**
 * 페이지 루트(예: ViewerV2Page)에서 한 번 호출.
 */
export function useShortcutsListener(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 텍스트 입력에서는 브라우저 기본 동작 유지 (Delete 키 포함).
      if (isTextEditingTarget(e.target)) return;

      const resolved = resolveAction(e);
      if (!resolved) return;

      if (resolved.requiresMeta && !(e.ctrlKey || e.metaKey)) return;

      const handler = useShortcutsStore.getState().handlers[resolved.action];
      if (!handler) return;

      e.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * 액션 핸들러를 등록·해제한다.
 * handler 가 null / undefined 면 해제.
 *
 * 사용 예:
 *   useShortcutHandler('undo', () => undoStack.pop());
 */
export function useShortcutHandler(
  action: ShortcutAction,
  handler: Handler | null | undefined,
): void {
  const setHandler = useShortcutsStore((s) => s.setHandler);
  useEffect(() => {
    if (!handler) return;
    setHandler(action, handler);
    return () => setHandler(action, undefined);
  }, [action, handler, setHandler]);
}

/**
 * 테스트·디버그용. 현재 등록된 액션 목록.
 */
export function _peekRegisteredActions(): ShortcutAction[] {
  return Object.keys(useShortcutsStore.getState().handlers) as ShortcutAction[];
}
