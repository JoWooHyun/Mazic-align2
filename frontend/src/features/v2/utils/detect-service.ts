/**
 * 서포트 검출·점생성 워커 브릿지 (메인스레드 ↔ detect.worker) — S-2.
 *
 * `slice-batch-service` 와 같은 패턴: 매 실행마다 새 Worker 를 띄우고
 * 완료/오류/취소 시 terminate. Promise API + onProgress 콜백 + cancel().
 *
 * ## 왜 필요한가
 * 검출은 층 500개 × 층당 수만 샘플점이라 대형 모델에서 수백억 회 연산이 된다.
 * 메인스레드 동기로 돌면 **화면이 통째로 멈추고 취소도 못 한다**
 * (리드 실물: 하악 베이스에서 "생성 중…" 인 채 응답 없음).
 */
import DetectWorker from "../workers/detect.worker?worker";

import type {
  DetectDone,
  DetectRequest,
  DetectResponse,
} from "../workers/detect.messages";

export type DetectProgressFn = (
  done: number,
  total: number,
  phase: string,
) => void;

/** 사용자 취소(worker terminate)로 인한 reject. */
export class DetectCancelError extends Error {
  constructor(message = "검출 작업이 취소되었습니다") {
    super(message);
    this.name = "DetectCancelError";
  }
}

class DetectService {
  private worker: Worker | null = null;
  private pendingReject: ((e: Error) => void) | null = null;

  /** 진행 중인 검출을 취소한다. Promise 는 DetectCancelError 로 reject. */
  cancel(): void {
    this.terminate();
  }

  /** 진행 중인지. UI 버튼 상태용. */
  get busy(): boolean {
    return this.worker !== null;
  }

  private terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    // 고아 Promise 방지 — busy 고착을 막는다(slice-batch 와 같은 이유).
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingReject = null;
      reject(new DetectCancelError());
    }
  }

  /**
   * 검출·점생성을 워커에서 실행한다.
   *
   * ⚠️ `triangles` 버퍼는 **transferable 로 넘어가 호출 측에서 사용 불가**가 된다
   * (복사 비용 회피). 호출 측은 넘긴 뒤 그 배열을 다시 읽지 않아야 한다.
   */
  run(
    req: Omit<DetectRequest, "kind">,
    onProgress?: DetectProgressFn,
  ): Promise<DetectDone> {
    // 이전 작업이 남아 있으면 정리하고 새로 시작한다(연타 방지).
    this.terminate();

    return new Promise<DetectDone>((resolve, reject) => {
      const worker = new DetectWorker();
      this.worker = worker;
      this.pendingReject = reject;

      worker.onmessage = (e: MessageEvent<DetectResponse>) => {
        const msg = e.data;
        if (msg.type === "progress") {
          onProgress?.(msg.done, msg.total, msg.phase ?? "");
          return;
        }
        // 종료 응답 — 성공이든 실패든 워커를 정리한다.
        this.worker = null;
        this.pendingReject = null;
        worker.terminate();
        if (msg.type === "error") reject(new Error(msg.message));
        else resolve(msg);
      };

      worker.onerror = (ev) => {
        this.worker = null;
        this.pendingReject = null;
        worker.terminate();
        reject(new Error(ev.message || "검출 워커 오류"));
      };

      const payload: DetectRequest = { kind: "detect", ...req };
      worker.postMessage(payload, [req.triangles.buffer]);
    });
  }
}

export const detectService = new DetectService();
