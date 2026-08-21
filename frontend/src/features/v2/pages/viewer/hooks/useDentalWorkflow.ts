// Dental 브러쉬 색칠 / 마진 찾기 / 아일랜드 검출 / 검출→서포트(2-4) 상태·핸들러.
// (ViewerV2Page 에서 추출 — busy 라벨 페인트 순서·undo·통지 동작 불변.)

import { useCallback, useState } from "react";

import { useUndoStore } from "../../../hooks/useUndoStore";
import * as supportRepo from "../../../data/supports.repo";
import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import type { SupportParams } from "../../../support";
import type { AddSupports, RefreshSupports } from "./types";

/**
 * 동기(수십~수백 초) 검출 작업을 busy 라벨이 먼저 페인트된 뒤 시작하도록
 * 감싸는 헬퍼. requestAnimationFrame(다음 프레임 직전) → setTimeout(0)(프레임
 * 커밋 후) 로 라벨 페인트를 보장한 뒤 동기 작업(work)을 실행한다.
 * (handleFindMargin / handleDetectIslands 의 동일 패턴 통합 — 의미 불변.)
 */
function runWithBusy(
  setBusy: (v: boolean) => void,
  work: () => void,
): void {
  setBusy(true);
  requestAnimationFrame(() => {
    setTimeout(() => {
      try {
        work();
      } finally {
        setBusy(false);
      }
    }, 0);
  });
}

type MarginStatus = { ok: boolean; message: string } | null;
type IslandStatus =
  | {
      ok: true;
      totalIslandFaces: number;
      nSlices: number;
      layersWithIsland: number;
    }
  | { ok: false; message: string }
  | null;

interface UseDentalWorkflowArgs {
  projectId: string | undefined;
  supportParams: SupportParams;
  sceneHandleRef: React.RefObject<BabylonSceneHandle>;
  layerHeightMm: number;
  addSupports: AddSupports;
  refreshSupports: RefreshSupports;
}

export function useDentalWorkflow({
  projectId,
  supportParams,
  sceneHandleRef,
  layerHeightMm,
  addSupports,
  refreshSupports,
}: UseDentalWorkflowArgs) {
  // dental-brush 색칠 두께 (mm). 씬 SHIFT+휠 로도 갱신됨.
  const [brushThicknessMm, setBrushThicknessMm] = useState(3);
  // stlId → painted face index 목록 (세션 상태). margin/island 조각 입력.
  // painted 는 IndexedDB 에 저장하지 않는다 (이 조각 범위 밖).
  const [paintedFaces, setPaintedFaces] = useState<Record<string, number[]>>(
    {},
  );
  // 마진 찾기 결과 상태 (세션). null = 미실행. ok=false → 실패 사유 표시.
  const [marginStatus, setMarginStatus] = useState<MarginStatus>(null);
  // 아일랜드 검출 결과 상태 (세션). null = 미실행.
  const [islandStatus, setIslandStatus] = useState<IslandStatus>(null);
  // 마진 찾기·아일랜드 검출은 메인스레드 동기 실행이라 진행률/취소는 불가하지만
  //   (감사 #1·#2, 워커 이전은 별도 과제), 최소한 클릭 직후 버튼 라벨을 busy 로
  //   바꿔 "죽은 게 아님"을 보이게 한다. 실제 동기 작업은 setTimeout(0) 뒤에
  //   실행해 busy 라벨이 먼저 페인트되도록 한다(runWithBusy).
  const [marginBusy, setMarginBusy] = useState(false);
  const [islandBusy, setIslandBusy] = useState(false);
  // 검출 영역 자동 서포트(2-4) 생성 진행 중 — 버튼 비활성/문구용.
  const [islandSupportBusy, setIslandSupportBusy] = useState(false);
  // 검출 영역 자동 서포트 완료 결과 문구 (감사 #5).
  const [islandSupportResult, setIslandSupportResult] = useState<string | null>(
    null,
  );
  // 서포트 재설계(S-4) 검출·점생성 진행/결과 상태 (검증용 병행 경로).
  const [redesignBusy, setRedesignBusy] = useState(false);
  const [redesignStatus, setRedesignStatus] =
    useState<{ ok: boolean; message: string } | null>(null);

  // ----- Dental 브러쉬 색칠 -----
  // 씬이 색칠 변경을 통지 → stlId 별 painted face 목록 갱신. 빈 목록이면 제거.
  const handlePaintedFacesChange = useCallback(
    (stlId: string, faceIds: number[]) => {
      setPaintedFaces((prev) => {
        const next = { ...prev };
        if (faceIds.length === 0) delete next[stlId];
        else next[stlId] = faceIds;
        return next;
      });
    },
    [],
  );

  const handleClearDentalPaint = useCallback(() => {
    sceneHandleRef.current?.clearDentalPaint();
    setPaintedFaces({});
    // clearDentalPaint 는 씬에서 마진·아일랜드 시각화도 함께 정리하므로 상태도 초기화.
    setMarginStatus(null);
    setIslandStatus(null);
  }, [sceneHandleRef]);

  // BabylonScene 이 STL 변형·색칠 변경으로 마진·아일랜드 검출 결과를 내부에서
  //   무효화했을 때(감사 B1/B3) 호출된다. 씬 쪽 시각화·ref 는 이미 정리됐으므로
  //   여기서는 UI 상태만 초기 상태로 되돌려 "재검출 필요"를 명시적으로 표시한다.
  //   marginStatus/islandStatus 는 현재 단일 슬롯(B4 기지 한계)이라 stlId 무관하게
  //   둘 다 리셋한다 (콜백 시그니처의 stlId 는 향후 다중 슬롯 대비용으로만 전달됨).
  const handleDentalResultsInvalidated = useCallback(() => {
    setMarginStatus(null);
    setIslandStatus(null);
  }, []);

  // ----- Dental 마진 찾기 (2-3b) -----
  //   씬에서 색칠 영역 → findMargin → 초록 튜브 시각화. 성공/실패 사유를
  //   패널 문구로 표시. painted 0 이면 패널 버튼이 비활성이라 여기 도달 X.
  const handleFindMargin = useCallback(() => {
    if (marginBusy) return;
    runWithBusy(setMarginBusy, () => {
      const res = sceneHandleRef.current?.findDentalMargin();
      if (!res) return;
      if (res.ok) {
        setMarginStatus({
          ok: true,
          message: `마진 검출 완료 · 마진 엣지 ${res.stats.marginEdgeCount}개 (색칠 ${res.stats.paintedFaceCount}면)`,
        });
      } else {
        setMarginStatus({ ok: false, message: res.reason });
      }
    });
  }, [marginBusy, sceneHandleRef]);

  const handleClearMargin = useCallback(() => {
    sceneHandleRef.current?.clearDentalMargin();
    setMarginStatus(null);
  }, [sceneHandleRef]);

  // ----- Dental 아일랜드 검출 (2-3c) -----
  //   활성 STL 전체를 슬라이스 → detectSliceIslands → 마젠타 overlay.
  //   레이어 높이는 슬라이스 프리뷰가 쓰는 값(layerHeightMm)을 재사용.
  const handleDetectIslands = useCallback(() => {
    if (islandBusy) return;
    // 이전 자동 서포트 결과 문구는 재검출 시 무효 → 정리.
    setIslandSupportResult(null);
    runWithBusy(setIslandBusy, () => {
      const res = sceneHandleRef.current?.detectDentalIslands(layerHeightMm);
      if (!res) return;
      if (res.ok) {
        setIslandStatus({
          ok: true,
          totalIslandFaces: res.stats.totalIslandFaces,
          nSlices: res.stats.nSlices,
          layersWithIsland: res.stats.layersWithIsland,
        });
      } else {
        setIslandStatus({ ok: false, message: res.reason });
      }
    });
  }, [layerHeightMm, islandBusy, sceneHandleRef]);

  const handleClearIslands = useCallback(() => {
    sceneHandleRef.current?.clearDentalIslands();
    setIslandStatus(null);
    setIslandSupportResult(null);
  }, [sceneHandleRef]);

  // ----- 서포트 재설계(S-4) 검출·점생성 (설계 8장 1~2단계, 검증용 병행 경로) -----
  //   기존 아일랜드 경로와 독립. 활성 STL 을 층 그래프로 검출 → 아일랜드/오버행
  //   색 표시 → 검출 영역에서 직접 서포트 점 생성(크기별 3분기) → 점만 구로 표시.
  //   기둥은 세우지 않는다(2단계). 점을 IndexedDB 에 저장하지 않는다 — 저장하면
  //   useSupportMeshSync 가 기둥을 세워 "점만" 원칙(설계 8장 2단계)에 어긋난다.
  //   liftMm 는 진단서 "리프트로 뜬 모델 바닥 전체 아일랜드 오검출" 방지(수용 C).
  const handleRunRedesignDetect = useCallback(() => {
    if (redesignBusy) return;
    runWithBusy(setRedesignBusy, () => {
      const res = sceneHandleRef.current?.runRedesignDetect(projectId ?? "", {
        layerHeightMm,
        liftMm: supportParams.liftMm,
        // ★ C-3: 뷰어 빨간 하이라이트와 같은 각도로 검출한다.
        overhangAngleDeg: supportParams.overhangAngleDeg,
      });
      if (!res) return;
      if (res.ok) {
        setRedesignStatus({
          ok: true,
          message:
            `아일랜드 ${res.stats.islandCount} · 오버행 ${res.stats.overhangCount} · ` +
            `서포트 점 ${res.stats.pointCount}개 (층 ${res.stats.nLayers})`,
        });
      } else {
        setRedesignStatus({ ok: false, message: res.reason });
      }
    });
  }, [
    redesignBusy,
    projectId,
    layerHeightMm,
    supportParams.liftMm,
    supportParams.overhangAngleDeg, // C-3: 검출각이 바뀌면 재검출해야 한다.
    sceneHandleRef,
  ]);

  const handleClearRedesignDetect = useCallback(() => {
    sceneHandleRef.current?.clearRedesignDetect();
    setRedesignStatus(null);
  }, [sceneHandleRef]);

  // ----- 서포트 생성(재설계) — 점 생성 + 표면 스냅 + 라우팅 + IndexedDB 저장 (S-4b-2c) -----
  //   디버그 "재설계 검출·점생성"(handleRunRedesignDetect)과 달리, 여기서는 생성된
  //   점을 표면 스냅한 뒤 **빔 충돌 검사로 3단 폴백 라우팅**
  //   (routeAndFinalizeRedesignPoints)하고 저장한다. 저장되면 useSupportMeshSync 가
  //   경로별 형상(수직 기둥 / 경사 다리 / 기둥 합류 / 모델 앵커)을 자동으로 세운다.
  //   저장·undo 배선은 handleAutoSupportIslands 패턴을 그대로 따른다.
  const handleGenerateRedesignSupports = useCallback(async () => {
    if (!projectId || redesignBusy) return;
    setRedesignBusy(true);
    setRedesignStatus(null);
    try {
      const res = sceneHandleRef.current?.runRedesignDetect(projectId, {
        layerHeightMm,
        liftMm: supportParams.liftMm,
        // ★ C-3: 뷰어 빨간 하이라이트와 같은 각도로 검출한다.
        overhangAngleDeg: supportParams.overhangAngleDeg,
      });
      if (!res) return;
      if (!res.ok) {
        setRedesignStatus({ ok: false, message: res.reason });
        return;
      }
      // 표면 스냅 + 3단 폴백 라우팅 + world→stl-local 변환 (S-4b-2c).
      const routed = sceneHandleRef.current?.routeAndFinalizeRedesignPoints(
        res.points,
        supportParams,
      );
      const finalized = routed?.points ?? res.points;
      const report = routed?.report ?? null;
      if (report) {
        console.log("[재설계 라우팅]", report);
      }
      if (finalized.length === 0) {
        setRedesignStatus({ ok: true, message: "생성할 서포트 점이 없습니다." });
        return;
      }
      await addSupports(finalized);
      // 검출 디버그 오버레이(마젠타/주황/파랑 점) 정리 — 저장이 끝나면 기둥이
      //   실물로 서므로 오버레이는 역할이 끝났다. world 좌표 고정이라 남겨두면
      //   모델을 움직였을 때 허공에 떠 보인다(B-4). 상태 메시지는 통계 표시용으로
      //   유지하고, 디버그 버튼 경로(handleRunRedesignDetect)는 점 눈확인이
      //   목적이므로 오버레이를 그대로 둔다.
      sceneHandleRef.current?.clearRedesignDetect();
      // 라우팅 요약 — 실패 점이 있으면 저장은 성공(ok:true)이되 경고 문구를 붙인다.
      //   실패를 조용히 삼키면 "서포트가 안 붙은 자리"를 사용자가 모른 채 출력한다
      //   (연구 7절-6). 아일랜드 실패는 출력 자체가 무너지므로 따로 센다.
      let routeSummary = "";
      if (report) {
        routeSummary =
          ` · 점 ${report.input}(중복 제거 후 ${report.afterDedupe})` +
          ` → 기둥 ${report.clusters} · 합류 ${report.joined} · 수직 ${report.vertical}` +
          ` · 경사 ${report.bent} · 앵커 ${report.anchored} · 실패 ${report.failed}`;
        if (report.failed > 0) {
          routeSummary +=
            ` · ⚠️ 실패 ${report.failed}개(아일랜드 ${report.failedIslandCount}개)` +
            " — 서포트가 못 닿은 점";
        }
        if (report.degenerateStruts > 0) {
          routeSummary += ` · 퇴화 거절 ${report.degenerateStruts}개`;
        }
      }
      setRedesignStatus({
        ok: true,
        message:
          `서포트 점 ${finalized.length}개 저장 · 뷰어에 기둥 생성 ` +
          `(아일랜드 ${res.stats.islandCount} · 오버행 ${res.stats.overhangCount})` +
          routeSummary,
      });
      const ids = finalized.map((p) => p.id);
      useUndoStore.getState().push({
        label: "redesign-supports",
        undo: async () => {
          for (const id of ids) await supportRepo.deleteSupport(id);
          await refreshSupports();
        },
        redo: async () => {
          await addSupports(finalized);
        },
      });
    } catch (e) {
      // 저장/스냅 중 예외도 사용자에게 실패 사유를 남긴다(감사 #5 취지).
      setRedesignStatus({
        ok: false,
        message: `서포트 생성 실패: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setRedesignBusy(false);
    }
  }, [
    projectId,
    redesignBusy,
    layerHeightMm,
    // S-4b-2c: 라우팅이 반경(trunkDiameterMm)·화살촉 높이까지 보므로 params
    //   객체 전체를 의존성으로 둔다(종전엔 liftMm 만 썼다).
    supportParams,
    addSupports,
    refreshSupports,
    sceneHandleRef,
  ]);

  // ----- 검출 영역 자동 서포트 (Step 2-4, ADR-3: 검출→생성 파이프라인) -----
  //   아일랜드 검출 결과의 island 영역에만 자동 서포트를 생성한다. BabylonScene 이
  //   faceFilter + 마진 가드까지 적용해 점을 반환하면, 여기서 기존 자동 생성 배선
  //   (addSupports → undo push)과 동일 패턴으로 저장한다.
  const handleAutoSupportIslands = useCallback(async () => {
    if (!projectId || islandSupportBusy) return;
    setIslandSupportBusy(true);
    setIslandSupportResult(null);
    try {
      const generated =
        sceneHandleRef.current?.autoSupportIslands(projectId, supportParams) ??
        null;
      // null = 아일랜드 검출 결과 없음. 빈 배열 = 검출됐으나 생성점 0 (가드 배제 등).
      if (!generated || generated.length === 0) {
        // 생성 0개도 무통지이던 문제(감사 #5) — 배제 사유를 짧게 알린다.
        if (generated) {
          setIslandSupportResult(
            "검출 영역에서 생성할 서포트가 없습니다 (마진 가드 등으로 배제).",
          );
        }
        return;
      }

      const ids = generated.map((p) => p.id);
      await addSupports(generated);
      // 완료 통지 (감사 #5) — Support 탭의 "현재 N 개" 로 연결됨을 안내.
      setIslandSupportResult(
        `서포트 ${generated.length}개 생성됨 · Support 탭 "현재 개수" 에 반영`,
      );

      // 생성 성공 → 아일랜드 검출 상태 소진 (감사 B6). 씬 쪽은 autoSupportIslands
      //   내부에서 마젠타 overlay + islandResultRef 를 이미 정리했다. 여기서 페이지
      //   islandStatus 를 null 로 되돌리면 DentalPanel 의 "검출 영역 자동 서포트"
      //   버튼이 자연스럽게 비활성화되어, 같은 자리에 중복 생성/stale 재사용을 막는다
      //   (재생성하려면 명시적 재검출 필요). 마진 상태는 건드리지 않는다.
      setIslandStatus(null);

      useUndoStore.getState().push({
        label: "island-auto-supports",
        undo: async () => {
          for (const id of ids) {
            await supportRepo.deleteSupport(id);
          }
          await refreshSupports();
        },
        redo: async () => {
          await addSupports(generated);
        },
      });
    } finally {
      setIslandSupportBusy(false);
    }
  }, [
    projectId,
    islandSupportBusy,
    supportParams,
    addSupports,
    refreshSupports,
    sceneHandleRef,
  ]);

  return {
    // 상태
    brushThicknessMm,
    setBrushThicknessMm,
    paintedFaces,
    marginStatus,
    setMarginStatus,
    islandStatus,
    setIslandStatus,
    marginBusy,
    islandBusy,
    islandSupportBusy,
    islandSupportResult,
    redesignBusy,
    redesignStatus,
    // 핸들러
    handlePaintedFacesChange,
    handleClearDentalPaint,
    handleDentalResultsInvalidated,
    handleFindMargin,
    handleClearMargin,
    handleDetectIslands,
    handleClearIslands,
    handleAutoSupportIslands,
    handleRunRedesignDetect,
    handleClearRedesignDetect,
    handleGenerateRedesignSupports,
  };
}
