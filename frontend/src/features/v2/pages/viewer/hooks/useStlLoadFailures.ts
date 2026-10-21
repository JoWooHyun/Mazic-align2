// 손상 STL 상태 (사고 방지 3차 ⑤ C5) — 씬이 메시로 못 올린 STL 의 id → 사유, 파일당 한 번 알림.
// (ViewerV2Page 에서 추출 — 10/15 코드 정리 R-4. 상태·알림 문구·정리 effect 불변.)
//   목록에 "⚠ 손상" 으로 보이고(StlFileList loadFailed), 파일을 지우면 아래 effect 가 뺀다.
//   종전엔 console.error 만 남아 사용자는 모델이 왜 안 보이는지 몰랐다.

import { useCallback, useEffect, useRef, useState } from "react";

import type { STLFileV2 } from "../../../types/stl";
import { NL } from "../utils/text";

/**
 * 모델이 하나 이상 있고 **전부** 메시로 못 올렸는가 (사고 방지 4차(소) — 슬라이스 진입 알림 문구 분기).
 *   그때는 기다려도 층이 생기지 않으므로 "불러오는 중" 대신 "목록에서 지워 주세요" 로 안내한다.
 */
export function isEveryModelLoadFailed(
  files: readonly Pick<STLFileV2, "id">[],
  loadFailed: ReadonlyMap<string, string>,
): boolean {
  return files.length > 0 && files.every((f) => loadFailed.has(f.id));
}

/**
 * 손상 STL 표시·알림 상태.
 *
 * @param files 현재 모델 목록 — 사라진(삭제된) id 를 표시·알림 기록에서 빼는 데 쓴다.
 * @returns loadFailed(id → 사유, StlFileList 에 넘김)·handleStlLoadError(BabylonScene onStlLoadError 에 넘김).
 */
export function useStlLoadFailures(files: STLFileV2[]): {
  loadFailed: ReadonlyMap<string, string>;
  handleStlLoadError: (stlId: string, fileName: string, message: string) => void;
} {
  const [loadFailed, setLoadFailed] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  // 이미 알린 파일 — files 가 바뀔 때마다 씬이 못 올린 파일을 다시 시도·재실패하므로(useFileMeshSync) 알림은 파일당 한 번.
  const loadFailAlertedRef = useRef<Set<string>>(new Set());
  const handleStlLoadError = useCallback(
    (stlId: string, fileName: string, message: string) => {
      setLoadFailed((prev) =>
        prev.get(stlId) === message ? prev : new Map(prev).set(stlId, message),
      );
      if (loadFailAlertedRef.current.has(stlId)) return;
      loadFailAlertedRef.current.add(stlId);
      window.alert(
        `"${fileName}" 을(를) 불러오지 못했습니다 — 손상된 STL 일 수 있습니다.${NL}${message}${NL}${NL}` +
          `왼쪽 목록에서 삭제해 주세요. 이 모델은 슬라이스·내보내기에 포함되지 않습니다.`,
      );
    },
    [],
  );
  // files 에서 사라진(삭제된) id 는 표시·알림 기록에서 뺀다. 바뀐 것이 없으면 같은 Map 을 돌려 리렌더를 막는다.
  useEffect(() => {
    const ids = new Set(files.map((f) => f.id));
    for (const id of loadFailAlertedRef.current) {
      if (!ids.has(id)) loadFailAlertedRef.current.delete(id);
    }
    setLoadFailed((prev) => {
      let next: Map<string, string> | null = null;
      for (const id of prev.keys()) {
        if (ids.has(id)) continue;
        if (!next) next = new Map(prev);
        next.delete(id);
      }
      return next ?? prev;
    });
  }, [files]);

  return { loadFailed, handleStlLoadError };
}
