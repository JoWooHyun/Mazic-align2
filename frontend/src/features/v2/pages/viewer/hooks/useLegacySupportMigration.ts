// 잘못된 옛 마이그레이션 되돌리기 (stl-local → world) — 옛 데이터 서포트 점 전용.
// (ViewerV2Page 에서 추출 — 10/15 코드 정리 R-4. 대상 판정·1.5s 대기·patch 내용 불변.)
//
// 0c83dd2 의 timing 문제로 stl-local 좌표가 STL transform 적용 전
// 기준으로 저장 → 새로고침 시 saved transform 이 한 번 더 곱해져
// 위치 어긋남. 사용자가 현재 보고 있는 위치 (= 잘못된 위치) 를
// 그대로 world 좌표로 받아 적고 coordSpace='world' 로 되돌림.
// 이후 race 옛 동작으로 복귀 (transform 시 patch chain). 새 supports
// 에 timing-safe stl-local 도입은 별도 commit.
// 대상은 **kind 없는 옛 데이터 점만** — 재설계 점(kind='island'|'slope')은
// S-4b-1 의 timing-safe stl-local 이 정본이라 되돌리면 안 된다. 되돌리면
// 1.5s 뒤 supports 가 바뀌어 서포트가 재생성·점프한다(B-2).

import { useEffect } from "react";

import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import type { SupportPointV2 } from "../../../support/types";
import { withSaveReport } from "../../../utils/save-failure";
import type { PatchSupport } from "./types";

interface UseLegacySupportMigrationArgs {
  /** 모델 목록 로딩 중이면 기다린다(씬에 STL 이 아직 없다). */
  filesLoading: boolean;
  supports: SupportPointV2[];
  patchSupport: PatchSupport;
  sceneHandleRef: React.RefObject<BabylonSceneHandle>;
}

export function useLegacySupportMigration({
  filesLoading,
  supports,
  patchSupport,
  sceneHandleRef,
}: UseLegacySupportMigrationArgs): void {
  useEffect(() => {
    if (filesLoading) return;
    if (supports.length === 0) return;
    const toRevert = supports.filter(
      (s) => s.coordSpace === "stl-local" && s.kind == null,
    );
    if (toRevert.length === 0) return;
    const handle = sceneHandleRef.current;
    if (!handle) return;
    // STL transform 이 BabylonScene 의 비동기 STL 로드 후 적용되는
    // 시점까지 충분히 대기 (1.5s — Promise.all 안의 applyTransform 보장).
    const t = setTimeout(() => {
      void (async () => {
        for (const s of toRevert) {
          const newContact = handle.stlLocalToWorld(s.stlId, s.contact);
          if (!newContact) continue;
          const newBase = handle.stlLocalToWorld(s.stlId, s.base) ?? s.base;
          let newCps = s.curveControlPoints;
          if (newCps) {
            newCps = newCps.map(
              (cp) => handle.stlLocalToWorld(s.stlId, cp) ?? cp,
            ) as typeof newCps;
          }
          await withSaveReport(
            "옛 서포트 좌표 변환",
            patchSupport(s.id, {
              contact: newContact,
              base: newBase,
              ...(newCps ? { curveControlPoints: newCps } : {}),
              coordSpace: "world",
            }),
          );
        }
      })();
    }, 1500);
    return () => clearTimeout(t);
    // sceneHandleRef 는 ref 객체(안정)라 deps 에 넣어도 재실행 시점은 종전 [filesLoading, supports, patchSupport] 와 같다.
  }, [filesLoading, supports, patchSupport, sceneHandleRef]);
}
