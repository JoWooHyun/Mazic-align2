// Dental 브러쉬 색칠 / 마진 찾기 / 아일랜드 검출 / 검출→서포트(2-4) 상태·핸들러.
// (ViewerV2Page 에서 추출 — busy 라벨 페인트 순서·통지 동작 불변.)
// 2026-10-07 신규 8·9·11: 검출 영역 자동 서포트·재설계 생성은 "자동 세트 교체 + undo 1회"(auto-support-replace),
//   재설계 확정은 시작 시점 대상 모델 고정(redesign-target), 언마운트 시 검출 취소·저장 금지.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDetectParamsStore } from "../../../support/hooks/useDetectParamsStore";
import {
  detectService,
  DetectCancelError,
} from "../../../utils/detect-service";
import {
  DEFAULT_LAYER_GRAPH_PARAMS,
  DEFAULT_PLACE_POINTS_PARAMS,
} from "../../../support";

import * as supportRepo from "../../../data/supports.repo";
import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import type { RedesignTarget } from "../../../components/babylon/redesign-target";
import type { SupportParams } from "../../../support";
import type { STLFileV2 } from "../../../types/stl";
import type { RefreshSupports } from "./types";
import {
  applyAutoSupportReplace,
  commitRedesignGeneration,
  formatAutoReplaceNotice,
  makeUndoPusher,
  type AutoReplaceResult,
} from "../utils/auto-support-replace";
// busy 라벨 선표시 헬퍼 — Support 탭 자동 생성도 같은 보장을 쓰도록 utils 로 옮겼다(사고 방지 3차 ④, 의미 불변).
import { runWithBusy } from "../utils/run-with-busy";

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
  refreshSupports: RefreshSupports;
  /** 뷰포트 하단 안내(5초) — 자동 서포트 교체 결과 알림 (신규 8). */
  onNotice: (message: string) => void;
  /**
   * 데모 수정 1차 ③ — 현재 선택. 두 개 이상이면 "서포트 생성(재설계)"가 선택한 모델을 하나씩 차례로 만든다.
   */
  selectedIds: ReadonlySet<string>;
  /** 데모 수정 1차 ③ — 모델 목록. 여러 모델 생성의 순서(files 순서)와 실패 문구의 모델 이름. */
  files: STLFileV2[];
}

export function useDentalWorkflow({
  projectId,
  supportParams,
  sceneHandleRef,
  layerHeightMm,
  refreshSupports,
  onNotice,
  selectedIds,
  files,
}: UseDentalWorkflowArgs) {
  // P-2: 검출·점생성 파라미터(사용자 조절). 스토어에서 직접 읽어
  //   프롭 스레딩 없이 최신값을 쓴다.
  const detectParams = useDetectParamsStore((st) => st.params);
  /** 검출 진행률 (S-2). null 이면 진행 중 아님. */
  const [redesignProgress, setRedesignProgress] = useState<{
    done: number;
    total: number;
    phase: string;
  } | null>(null);
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

  // 뷰어 이탈 신호 (신규 11). 재설계 생성은 워커 검출을 기다리는 동안 뷰어를
  //   떠날 수 있다(프로젝트 목록으로 등). 언마운트되면 진행 중 검출을 취소하고,
  //   이미 끝나 넘어온 결과도 저장하지 않는다(commitRedesignGeneration 의 isCancelled).
  //   StrictMode 개발 모드의 mount→cleanup→mount 에서도 다시 true 로 돌아온다.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      detectService.cancel();
    };
  }, []);
  // 최신 모델 목록 (사고 방지 4차(소)) — 여러 모델 차례 생성은 검출을 await 하는 사이 모델이 지워질 수 있어,
  //   저장 직전에 콜백 클로저(시작 시점 files)가 아니라 이 ref 로 "아직 있는가" 를 본다.
  const filesRef = useRef(files);
  filesRef.current = files;

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
  /**
   * 워커로 검출·점생성을 돌린다 (S-2). 진행률 보고 + 취소 가능.
   *
   * 종전에는 메인스레드 동기라 대형 모델(하악 아치 등)에서 **화면이 통째로
   * 멈췄다** — 층 500개 × 층당 수만 샘플점이면 수백억 회 연산이다.
   * 씬 접근(삼각형 추출)과 시각화만 handle 을 거치고, 계산은 워커가 한다.
   *
   * 신규 9: 입력을 만드는 순간의 활성 STL(id·world 행렬)을 `target` 으로 함께
   * 돌려준다 — 이것이 이 생성의 대상 모델이다. 검출 중 선택이 바뀌어도 확정·저장은
   * target 기준으로 한다.
   *
   * 데모 수정 1차 ③: `stlId` 를 주면 그 모델을 검출한다(여러 모델 차례 생성). 없으면 종전대로 활성 STL.
   *   `phasePrefix`(예: "모델 2/3 · ")는 진행률 문구 앞에 붙는다 — 빈 문자열이면 종전 문구 그대로.
   *   입력 준비 실패는 상태 문구를 직접 쓰지 않고 `{ ok: false, reason }` 으로 돌려준다 — 여러 모델이면
   *   사유를 모아 두고 다음 모델로 넘어가야 해서다(한 모델 경로는 호출 측이 종전과 같은 문구를 쓴다).
   *   null = 씬 핸들 없음(종전과 같이 조용히 끝).
   */
  const runDetectInWorker = useCallback(async (stlId?: string, phasePrefix = "") => {
    const prep = sceneHandleRef.current?.prepareRedesignDetectInput(stlId);
    if (!prep) return null;
    if (!prep.ok) {
      return { ok: false as const, reason: prep.reason };
    }
    const target: RedesignTarget = {
      stlId: prep.stlId,
      worldMatrix: prep.worldMatrix,
    };
    setRedesignProgress({ done: 0, total: 1, phase: `${phasePrefix}준비` });
    try {
      const detected = await detectService.run(
        {
          triangles: prep.triangles,
          stlId: prep.stlId,
          projectId: projectId ?? "",
          layerGraph: {
            ...DEFAULT_LAYER_GRAPH_PARAMS,
            ...detectParams,
            // ★ B-31: 층높이의 단일 출처는 슬라이스 패널 — 검출 스토어는 이 키를 갖지 않는다.
            layerHeightMm,
            liftMm: supportParams.liftMm,
            // ★ C-3: 뷰어 빨간 하이라이트와 같은 각도로 검출한다.
            overhangAngleDeg: supportParams.overhangAngleDeg,
          },
          placePoints: { ...DEFAULT_PLACE_POINTS_PARAMS, ...detectParams },
        },
        (done, total, phase) =>
          setRedesignProgress({
            done,
            total,
            // 접두가 있으면 빈 단계명도 "처리 중"으로 채운다(패널은 빈 문구일 때만 "처리 중"을 보인다).
            phase: phasePrefix ? `${phasePrefix}${phase || "처리 중"}` : phase,
          }),
      );
      return { ok: true as const, detected, target };
    } finally {
      setRedesignProgress(null);
    }
  }, [
    projectId,
    layerHeightMm,
    supportParams.liftMm,
    supportParams.overhangAngleDeg,
    detectParams,
    sceneHandleRef,
  ]);

  /** 진행 중인 검출을 취소한다 (S-2). */
  const handleCancelRedesign = useCallback(() => {
    detectService.cancel();
  }, []);

  const handleRunRedesignDetect = useCallback(async () => {
    if (redesignBusy) return;
    setRedesignBusy(true);
    setRedesignStatus(null);
    try {
      // 디버그 경로는 종전(활성 1개) 그대로 — 데모 수정 1차 ③ 의 여러 모델 차례 생성은 서포트 생성 버튼만.
      const run = await runDetectInWorker();
      if (!run) return;
      if (!run.ok) {
        setRedesignStatus({ ok: false, message: run.reason });
        return;
      }
      const res = run.detected;
      sceneHandleRef.current?.renderRedesignPoints(res.points);
      setRedesignStatus({
        ok: true,
        message:
          `아일랜드 ${res.stats.islandCount} · 오버행 ${res.stats.overhangCount} · ` +
          `서포트 점 ${res.stats.pointCount}개 (층 ${res.stats.nLayers})`,
      });
    } catch (e) {
      if (e instanceof DetectCancelError) {
        setRedesignStatus({ ok: false, message: "검출을 취소했습니다." });
      } else {
        setRedesignStatus({
          ok: false,
          message: `검출 실패: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    } finally {
      setRedesignBusy(false);
    }
  }, [redesignBusy, runDetectInWorker, sceneHandleRef]);

  const handleClearRedesignDetect = useCallback(() => {
    sceneHandleRef.current?.clearRedesignDetect();
    setRedesignStatus(null);
  }, [sceneHandleRef]);

  // ----- 서포트 생성(재설계) — 점 생성 + 표면 스냅 + 라우팅 + IndexedDB 저장 (S-4b-2c) -----
  //   디버그 "재설계 검출·점생성"(handleRunRedesignDetect)과 달리, 여기서는 생성된
  //   점을 표면 스냅한 뒤 **빔 충돌 검사로 3단 폴백 라우팅**
  //   (routeAndFinalizeRedesignPoints)하고 저장한다. 저장되면 useSupportMeshSync 가
  //   경로별 형상(수직 기둥 / 경사 다리 / 기둥 합류 / 모델 앵커)을 자동으로 세운다.
  //
  //   재실행 = 교체 (D5 / 신규 8): 대상 모델의 기존 자동 서포트(일반 자동·검출 영역
  //   자동·이전 재설계 모두 source "auto")를 새 세트로 바꾼다 — 한 transaction,
  //   undo 한 번이면 옛 세트로 복귀(auto-support-replace.ts).
  //   대상 모델 고정 (신규 9): 시작 시점의 stlId·world 행렬(target)로만 확정한다.
  //   뷰어 이탈 (신규 11): 언마운트되면 저장하지 않고, 라우팅을 못 하면 원시 점으로
  //   폴백하지 않는다(commitRedesignGeneration).
  //   연타: redesignBusy 로 버튼이 비활성화되고 여기서도 한 번 더 막는다.
  //
  //   데모 수정 1차 ③ — 여러 모델 선택 → 선택한 모델을 **하나씩 차례로**(files 순서, 리드 10/12).
  //   선택이 하나·없음이면 종전대로 활성 1개. 모델 하나 = 위 흐름 한 번(검출 → 확정 →
  //   교체 저장)이라 undo 도 모델마다 1회다(auto-support-replace 가 모델 단위 — 그대로 둔다).
  //   여러 모델일 때: 한 모델이 거절·점 없음·실패면 사유를 모아 두고 다음 모델로 계속, 뷰어 이탈(cancelled·
  //   aliveRef)·검출 취소(DetectCancelError)면 즉시 중단. 문구·안내는 끝난 뒤 한 번에.
  //   한 모델일 때: 문구·안내·예외 처리 전부 종전 그대로.
  const handleGenerateRedesignSupports = useCallback(async () => {
    if (!projectId || redesignBusy) return;
    setRedesignBusy(true);
    setRedesignStatus(null);
    // 대상: 두 개 이상 선택이면 files 순서대로 그 모델들. 하나·없음은 모델을 지정하지 않는다(undefined) —
    //   종전 경로(활성 STL = 선택 첫 번째, 없으면 씬 첫 번째) 그대로라 한 모델 동작이 바뀌지 않는다.
    const picked = files.filter((f) => selectedIds.has(f.id)).map((f) => f.id);
    const targetIds: (string | undefined)[] = picked.length > 1 ? picked : [undefined];
    const multi = targetIds.length > 1;
    const nameOf = (id: string | undefined) =>
      files.find((f) => f.id === id)?.fileName ?? id ?? "활성 모델";
    // 여러 모델 결과 모음.
    let savedModels = 0;
    let savedPoints = 0;
    let routeFailed = 0;
    let routeFailedIsland = 0;
    const skipped: string[] = [];
    const replaced: AutoReplaceResult = {
      removedCount: 0,
      addedCount: 0,
      keptAttachedCount: 0,
    };
    try {
      for (const [idx, stlId] of targetIds.entries()) {
        // 뷰어를 떠났으면 다음 모델로 가지 않는다(신규 11 — 저장도 안내도 하지 않는다).
        if (!aliveRef.current) return;
        try {
          // S-2: 검출은 워커에서. 화면이 안 멈추고 진행률·취소가 된다.
          const run = await runDetectInWorker(
            stlId,
            multi ? `모델 ${idx + 1}/${targetIds.length} · ` : "",
          );
          if (!run) return;
          if (!run.ok) {
            if (!multi) {
              setRedesignStatus({ ok: false, message: run.reason });
              return;
            }
            skipped.push(`${nameOf(stlId)} — ${run.reason}`);
            continue;
          }
          const { detected: res, target } = run;
          const outcome = await commitRedesignGeneration({
            isCancelled: () => !aliveRef.current,
            // 표면 스냅 + 3단 폴백 라우팅 + world→stl-local 변환 (S-4b-2c) — 대상은 target.
            route: () => {
              const routed = sceneHandleRef.current?.routeAndFinalizeRedesignPoints(
                res.points,
                supportParams,
                target,
              );
              // 사고 방지 4차(소) — 라우팅 뒤·저장 앞: 검출을 기다리는 사이 이 모델이 지워졌으면 저장하지 않고 건너뛴다
              //   (지운 모델에 서포트 레코드가 되살아나지 않게). commitRedesignGeneration 은 route → save 사이에
              //   await 가 없어 이 확인이 곧 replaceSupportsInProject 직전이다.
              if (routed?.ok && !filesRef.current.some((f) => f.id === target.stlId)) {
                return { ok: false, reason: "삭제됨 — 서포트를 저장하지 않았습니다." };
              }
              return routed;
            },
            save: (points) =>
              applyAutoSupportReplace({
                label: "redesign-supports",
                targetStlIds: new Set([target.stlId]),
                generated: points,
                replace: (pick, add) =>
                  supportRepo.replaceSupportsInProject(projectId, pick, add),
                refresh: refreshSupports,
                pushUndo: makeUndoPusher(),
              }),
          });
          // 뷰어를 떠났다 — 저장도 안내도 하지 않는다(남은 모델도 하지 않는다).
          if (outcome.kind === "cancelled") return;
          if (outcome.kind === "rejected") {
            if (!multi) {
              setRedesignStatus({ ok: false, message: outcome.reason });
              return;
            }
            skipped.push(`${nameOf(target.stlId)} — ${outcome.reason}`);
            continue;
          }
          const report = outcome.report;
          console.debug("[재설계 라우팅]", report);
          if (outcome.kind === "empty") {
            if (!multi) {
              setRedesignStatus({ ok: true, message: "생성할 서포트 점이 없습니다." });
              return;
            }
            skipped.push(`${nameOf(target.stlId)} — 생성할 서포트 점이 없습니다`);
            continue;
          }
          const finalized = outcome.points;
          // 검출 디버그 오버레이(마젠타/주황/파랑 점) 정리 — 저장이 끝나면 기둥이
          //   실물로 서므로 오버레이는 역할이 끝났다. world 좌표 고정이라 남겨두면
          //   모델을 움직였을 때 허공에 떠 보인다(B-4). 상태 메시지는 통계 표시용으로
          //   유지하고, 디버그 버튼 경로(handleRunRedesignDetect)는 점 눈확인이
          //   목적이므로 오버레이를 그대로 둔다.
          sceneHandleRef.current?.clearRedesignDetect();
          if (multi) {
            // 여러 모델 — 합계만 모으고 문구·안내는 루프가 끝난 뒤 한 번에.
            savedModels++;
            savedPoints += finalized.length;
            routeFailed += report?.failed ?? 0;
            routeFailedIsland += report?.failedIslandCount ?? 0;
            replaced.removedCount += outcome.result.removedCount;
            replaced.addedCount += outcome.result.addedCount;
            replaced.keptAttachedCount += outcome.result.keptAttachedCount;
            continue;
          }
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
          // undo 항목은 applyAutoSupportReplace 가 이미 남겼다 — 여기서는 교체 안내만.
          const notice = formatAutoReplaceNotice(outcome.result);
          if (notice) onNotice(notice);
        } catch (e) {
          // 한 모델이면 종전대로 바깥 catch 가 알린다. 여러 모델이면 검출 취소만 전체 중단,
          //   나머지 예외(저장 실패 등)는 그 모델만 건너뛴다 — 교체는 한 transaction 이라 그 모델의
          //   기존 서포트는 그대로다.
          if (!multi || e instanceof DetectCancelError) throw e;
          skipped.push(
            `${nameOf(stlId)} — 서포트 생성 실패: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      if (multi) {
        let message =
          `모델 ${targetIds.length}개 중 ${savedModels}개 생성 · 서포트 점 합계 ${savedPoints}개` +
          " (되돌리기는 모델별)";
        if (routeFailed > 0) {
          message +=
            ` · ⚠️ 실패 ${routeFailed}개(아일랜드 ${routeFailedIsland}개)` +
            " — 서포트가 못 닿은 점";
        }
        if (skipped.length > 0) {
          message += ` · 건너뛴 모델 ${skipped.length}개: ${skipped.join(" / ")}`;
        }
        setRedesignStatus({ ok: skipped.length === 0, message });
        const notice = formatAutoReplaceNotice(replaced);
        if (notice) onNotice(`${notice} · 되돌리기는 모델별`);
      }
    } catch (e) {
      // 여러 모델 도중 검출을 취소했다 — 이미 끝난 모델은 저장돼 있으므로 몇 개까지 됐는지 알린다.
      if (multi && e instanceof DetectCancelError) {
        setRedesignStatus({
          ok: false,
          message:
            `검출을 취소했습니다 — 모델 ${targetIds.length}개 중 ${savedModels}개 생성` +
            " (되돌리기는 모델별)",
        });
        return;
      }
      // 저장/스냅 중 예외도 사용자에게 실패 사유를 남긴다(감사 #5 취지).
      //   교체는 한 transaction 이라 저장 실패 시 기존 서포트는 그대로다.
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
    // 데모 수정 1차 ③ — 대상 모델 목록(선택·files 순서·이름).
    files,
    selectedIds,
    // S-4b-2c: 라우팅이 반경(trunkDiameterMm)·화살촉 높이까지 보므로 params
    //   객체 전체를 의존성으로 둔다(종전엔 liftMm 만 썼다).
    supportParams,
    // S-2: 검출 입력(층높이·검출 파라미터)은 이 콜백이 안에 품고 있으므로
    //   개별 값 대신 콜백 자체를 의존성으로 둔다 — 규칙 7(deps 누락) 준수.
    runDetectInWorker,
    refreshSupports,
    sceneHandleRef,
    onNotice,
  ]);

  // ----- 검출 영역 자동 서포트 (Step 2-4, ADR-3: 검출→생성 파이프라인) -----
  //   아일랜드 검출 결과의 island 영역에만 자동 서포트를 생성한다. BabylonScene 이
  //   faceFilter + 마진 가드까지 적용해 점을 반환하면, 여기서 기존 자동 생성 배선
  //   과 동일 패턴으로 저장한다 — 재실행 = 교체 (D5 / 신규 8): 그 모델의 기존 자동
  //   서포트를 새 세트로 바꾼다(auto-support-replace.ts). 대상 모델은 아일랜드 검출
  //   대상 STL 하나(점이 전부 그 stlId) — 생성이 동기라 도중에 선택이 바뀔 틈이 없다.
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

      const result = await applyAutoSupportReplace({
        label: "island-auto-supports",
        targetStlIds: new Set(generated.map((p) => p.stlId)),
        generated,
        replace: (pick, add) =>
          supportRepo.replaceSupportsInProject(projectId, pick, add),
        refresh: refreshSupports,
        pushUndo: makeUndoPusher(),
      });
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

      const notice = formatAutoReplaceNotice(result);
      if (notice) onNotice(notice);
    } catch (e) {
      // 생성(씬) 또는 교체 저장 실패. 교체는 한 transaction 이라 실패하면 기존
      //   서포트는 그대로다.
      setIslandSupportResult(
        `서포트 생성 실패 — 기존 서포트는 그대로입니다. ` +
          `(${e instanceof Error ? e.message : String(e)})`,
      );
    } finally {
      setIslandSupportBusy(false);
    }
  }, [
    projectId,
    islandSupportBusy,
    supportParams,
    refreshSupports,
    sceneHandleRef,
    onNotice,
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
    // S-2 워커 경로 — 진행률 표시 + 취소.
    redesignProgress,
    handleCancelRedesign,
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
