// Esc 단계적 해제 (P3, 프루사 정합).
// (ViewerV2Page 에서 추출 — 10/15 코드 정리 R-4. 우선순위·가드·리스너 등록 불변.)
//
//   우선순위: Bridge pending 취소 → 서포트/변곡점 선택 해제 → STL 선택 해제.
//   한 번의 Esc 로는 가장 위 단계 하나만 해제하고 종료(early return)해,
//   여러 상태가 동시에 있을 때 한 방에 전부 날아가지 않도록 한다.
//   INPUT/TEXTAREA 등 텍스트 입력 중에는 브라우저 기본 동작(입력 취소 등) 유지.

import { useEffect } from "react";

import type { useSupportEditing } from "./useSupportEditing";

type SupportEditing = ReturnType<typeof useSupportEditing>;

interface UseEscapeDeselectArgs
  extends Pick<
    SupportEditing,
    | "pendingBridge"
    | "setPendingBridge"
    | "selectedCp"
    | "setSelectedCp"
    | "selectedSupportId"
    | "setSelectedSupportId"
  > {
  /** 프린터 프로파일 다이얼로그가 열려 있으면 Esc 는 다이얼로그가 처리 (P5). */
  profileDialogOpen: boolean;
  selectedIds: ReadonlySet<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
}

export function useEscapeDeselect({
  profileDialogOpen,
  pendingBridge,
  setPendingBridge,
  selectedCp,
  setSelectedCp,
  selectedSupportId,
  setSelectedSupportId,
  selectedIds,
  setSelectedIds,
}: UseEscapeDeselectArgs): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 다이얼로그가 열려 있으면 Esc는 다이얼로그가 처리 — 뷰어 선택 해제와 동시 발동 방지 (P5)
      if (profileDialogOpen) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      // 1) Bridge pending (첫 점 찍은 상태) 취소.
      if (pendingBridge) {
        setPendingBridge(null);
        return;
      }
      // 2) 서포트/변곡점 선택 해제.
      if (selectedCp) {
        setSelectedCp(null);
        return;
      }
      if (selectedSupportId) {
        setSelectedSupportId(null);
        return;
      }
      // 3) STL 선택 해제.
      if (selectedIds.size > 0) {
        setSelectedIds(new Set());
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // setSelectedIds 는 페이지 useState setter(안정)라 deps 에 넣어도 재등록 시점은 종전과 같다.
  }, [
    pendingBridge,
    selectedCp,
    selectedSupportId,
    selectedIds,
    profileDialogOpen,
    setPendingBridge,
    setSelectedCp,
    setSelectedSupportId,
    setSelectedIds,
  ]);
}
