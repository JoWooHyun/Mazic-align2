/**
 * 서포트 검출·점생성 워커 (S-2).
 *
 * 메인스레드에서 world 삼각형 배열을 받아 층 그래프 검출 → 점 생성을 수행하고,
 * 진행률을 중간중간 보고한 뒤 점 목록을 돌려준다.
 * **메인스레드 프리즈를 없애는 것이 목적**이다 — 하악 아치 같은 대형 모델에서
 * 검출은 수백억 회 연산이라 동기로 돌면 브라우저가 통째로 멈춘다.
 *
 * 순수 코어(`detect/layer-graph.ts`, `detect/place-points.ts`)를 그대로
 * 재사용하므로 **산출 점 목록은 동기 경로와 동일하다.**
 * Babylon 은 import 하지 않는다 (slice-batch.worker 와 같은 규약).
 */
import { detectLayerGraph } from "../support/detect/layer-graph";
import { placeSupportPoints } from "../support/detect/place-points";
import type {
  DetectRequest,
  DetectResponse,
} from "./detect.messages";

/** 진행률 보고 최소 간격 (ms). 너무 잦으면 postMessage 자체가 비용이 된다. */
const PROGRESS_THROTTLE_MS = 100;

function post(msg: DetectResponse): void {
  (self as unknown as Worker).postMessage(msg);
}

self.onmessage = (e: MessageEvent<DetectRequest>) => {
  const req = e.data;
  if (!req || req.kind !== "detect") return;

  try {
    let lastPost = 0;
    const onProgress = (done: number, total: number, phase: string) => {
      const now = Date.now();
      if (now - lastPost < PROGRESS_THROTTLE_MS) return;
      lastPost = now;
      post({ type: "progress", done, total, phase });
    };

    // 1단계: 층 그래프 검출.
    const detect = detectLayerGraph(
      req.triangles,
      req.stlId,
      req.layerGraph,
      onProgress,
    );

    // 2단계: 점 생성. (검출 결과 크기에 비례라 층 루프보다 훨씬 싸다.)
    post({
      type: "progress",
      done: detect.nLayers * 2,
      total: detect.nLayers * 2,
      phase: "점 생성",
    });
    const points = placeSupportPoints(detect, req.projectId, req.placePoints);

    post({
      type: "done",
      points,
      stats: {
        islandCount: detect.islands.length,
        overhangCount: detect.overhangs.length,
        pointCount: points.length,
        nLayers: detect.nLayers,
        layerHeight: detect.layerHeight,
        islandFloorY: detect.islandFloorY,
      },
    });
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
