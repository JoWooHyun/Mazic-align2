// 모델 삭제 확인 문구 — 사고 방지 3차 ①.
//   Delete 키·우클릭 "삭제"·툴바 삭제(useSupportEditing handleDeleteSelectedSupport)와 목록 × 버튼(StlFileList),
//   잘라내기 Ctrl+X(useClipboardActions cutModels — 사고 방지 4차(소))가 같은 문구로 묻는다. 모델 삭제는 되돌릴 수 없다(useStlFilesV2.remove 가 되돌리기 이력을 비운다) — 그래서 먼저 묻는다.
//   window.confirm 호출은 이 함수 한 곳.

import { NL } from "./text";

/** 확인 문구 마지막 줄 — 서포트도 함께 지워지고 되돌릴 수 없다는 안내. */
const DELETE_NOTICE = "모델 위 서포트도 함께 지워지며 되돌릴 수 없습니다.";

/**
 * 모델 삭제 전에 확인을 받는다.
 *
 * @param names 지울 모델의 파일 이름 (선택 순서대로). 3개를 넘으면 앞 3개만 나열하고 "외 k개".
 * @returns 지워도 되면 true. 이름이 0개면 지울 것이 없으므로 묻지 않고 false.
 */
export function confirmDeleteModels(names: readonly string[]): boolean {
  if (names.length === 0) return false;
  if (names.length === 1) {
    return window.confirm(`"${names[0]}" 을(를) 삭제할까요?${NL}${DELETE_NOTICE}`);
  }
  const lines = names.slice(0, 3).map((n) => `· ${n}`);
  if (names.length > 3) lines.push(`· 외 ${names.length - 3}개`);
  return window.confirm(
    `모델 ${names.length}개를 삭제할까요?${NL}${lines.join(NL)}${NL}${DELETE_NOTICE}`,
  );
}
