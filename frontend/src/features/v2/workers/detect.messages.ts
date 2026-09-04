/**
 * 서포트 검출·점생성 워커 ↔ 메인 브릿지 메시지 프로토콜 (S-2).
 *
 * ## 왜 워커로 옮기는가
 * 검출은 층마다 폴리곤을 잘라 격자 샘플점을 찍고, 각 점이 아래층에 지지되는지
 * 확인한다. 하악 아치(80×80mm, 높이 25mm) 기준으로 층 500개 × 층당 7만 점 ≈
 * **3,500만 샘플점**이고, 점마다 폴리곤 순회가 들어가 수백억 회 연산이 된다.
 * 이것을 메인스레드에서 동기로 돌면 **브라우저가 통째로 멈춘다**
 * (리드 실물: 하악 베이스 20.7MB 에서 버튼이 "생성 중…" 인 채 응답 없음).
 *
 * 워커로 옮기면 화면이 살아 있고, 진행률을 보여줄 수 있고, 취소도 된다.
 *
 * ## 무엇이 넘어가는가
 * Babylon Mesh 는 워커로 못 넘어가므로 **world 삼각형 flat 배열**(삼각형당
 * 9 float)만 넘긴다. 슬라이스 워커(`slice-batch.messages.ts`)와 같은 방식이며,
 * 검출 코어(`detect/layer-graph.ts`, `detect/place-points.ts`)는 이미 Babylon
 * 무의존 순수 모듈이라 그대로 재사용된다 — **산출물이 동기 경로와 동일하다.**
 */
import type { LayerGraphParams } from "../support/detect/types";
import type { PlacePointsParams } from "../support/detect/place-points";
import type { SupportPointV2 } from "../support/types";

/** 검출 요청. */
export interface DetectRequest {
  kind: "detect";
  /** world 삼각형 (삼각형당 9 float). transferable. */
  triangles: Float32Array;
  /** 결과 점에 실릴 STL id. */
  stlId: string;
  /** 결과 점에 실릴 프로젝트 id. */
  projectId: string;
  /** 층 그래프 검출 파라미터 (liftMm 포함, 호출 측이 완성해 넘긴다). */
  layerGraph: LayerGraphParams;
  /** 점 생성 파라미터. */
  placePoints: PlacePointsParams;
}

/** 진행률 — 처리한 층 / 전체 층. */
export interface DetectProgress {
  type: "progress";
  done: number;
  total: number;
  /** 현재 단계 표시용 ("층 슬라이스" / "겹침 판정" 등). */
  phase?: string;
}

/** 완료 — 생성된 서포트 점 + 통계. */
export interface DetectDone {
  type: "done";
  points: SupportPointV2[];
  stats: {
    islandCount: number;
    overhangCount: number;
    pointCount: number;
    nLayers: number;
    layerHeight: number;
    islandFloorY: number;
  };
}

/** 오류. */
export interface DetectError {
  type: "error";
  message: string;
}

export type DetectResponse = DetectProgress | DetectDone | DetectError;
