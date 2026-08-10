// 서포트 부품 STL 로드 완료 여부를 React state 로 노출 (S-4b-1).
//   useSupportMeshSync 가 이 값을 dep 로 삼아, 부품 로드 완료 시 effect 를
//   재실행해 그동안 skip 된 재설계 서포트 기둥을 세우게 한다.
//   initSupportParts 는 1회 로드·중복 호출 무해라 여러 컴포넌트가 불러도 안전.

import { useEffect, useState } from "react";
import { getSupportParts, initSupportParts } from "../parts-cache";

export function useSupportPartsReady(): boolean {
  const [ready, setReady] = useState<boolean>(() => getSupportParts() != null);

  useEffect(() => {
    let cancelled = false;
    if (getSupportParts() != null) {
      setReady(true);
      return;
    }
    void initSupportParts().then(() => {
      if (!cancelled) setReady(getSupportParts() != null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
