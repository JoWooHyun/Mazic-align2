/**
 * 배치 슬라이스/출력 워커 브릿지 (메인스레드 ↔ slice-batch.worker).
 *
 * v1 SlicerService 패턴을 v2 로 이식: 매 export 마다 새 Worker 를 띄우고
 * 완료/오류/취소 시 terminate. Promise API + onProgress 콜백 + cancel().
 */
import SliceBatchWorker from "../workers/slice-batch.worker?worker";

import type { FdmSettings } from "./gcode/types";
import type {
  CtbRequest,
  GcodeRequest,
  PngZipRequest,
  SliceBatchRequest,
  SliceBatchResponse,
  WorkerMeshGeometry,
  WorkerSliceOptions,
} from "../workers/slice-batch.messages";

export type BatchProgress = (done: number, total: number) => void;

/**
 * 사용자 취소(worker terminate)로 인한 reject 를 나타내는 에러.
 * 호출자는 e.name === "CancelError" 로 판별한다(메시지 문자열 의존 제거 —
 * 마감 검수 권고).
 */
export class CancelError extends Error {
  constructor(message = "배치 슬라이스 작업이 취소되었습니다") {
    super(message);
    this.name = "CancelError";
  }
}

/** world 삼각형 배열들의 transferable 목록 (ArrayBuffer). */
function transfersOf(meshes: WorkerMeshGeometry[]): Transferable[] {
  return meshes.map((m) => m.triangles.buffer);
}

class SliceBatchService {
  private worker: Worker | null = null;
  /** 진행 중 작업의 reject. terminate/cancel 시 고아 Promise 를 정리한다. */
  private pendingReject: ((e: Error) => void) | null = null;

  /** 진행 중 작업을 취소 (worker terminate). Promise 는 reject 된다. */
  cancel(): void {
    this.terminate();
  }

  private terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    // 진행 중이던 Promise 가 있으면 고아로 두지 않고 reject — busy 고착 방지.
    // 취소 판별은 메시지 문자열이 아니라 CancelError(name) 로 한다.
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingReject = null;
      reject(new CancelError());
    }
  }

  /** PNG-ZIP 내보내기. 빈 씬(topY<=0)이면 null. */
  exportPngZip(
    meshes: WorkerMeshGeometry[],
    options: WorkerSliceOptions,
    onProgress?: BatchProgress,
  ): Promise<Blob | null> {
    const req: PngZipRequest = { kind: "pngzip", meshes, options };
    return this.run(req, transfersOf(meshes), onProgress);
  }

  /** CTB 내보내기. 빈 씬(topY<=0)이면 null. */
  exportCtb(
    meshes: WorkerMeshGeometry[],
    options: WorkerSliceOptions,
    ctb: CtbRequest["ctb"],
    onProgress?: BatchProgress,
  ): Promise<Blob | null> {
    const req: CtbRequest = { kind: "ctb", meshes, options, ctb };
    return this.run(req, transfersOf(meshes), onProgress);
  }

  /**
   * FDM G-code 내보내기 (감사 A5 — 메인스레드 프리즈 해소).
   * 대상 mesh 가 없거나 슬라이스 범위(range.yMax<=yMin)가 비면 null.
   * 진행률·취소는 PNG-ZIP/CTB 경로와 동일 인프라(onProgress / cancel) 재사용.
   */
  exportGcode(
    meshes: WorkerMeshGeometry[],
    settings: FdmSettings,
    range: GcodeRequest["range"],
    onProgress?: BatchProgress,
  ): Promise<string | null> {
    const req: GcodeRequest = { kind: "gcode", meshes, settings, range };
    return this.run(req, transfersOf(meshes), onProgress);
  }

  /**
   * 워커 요청을 실행하고 종료 응답(done / gcode-done)을 결과로 resolve 한다.
   * PNG-ZIP/CTB 는 Blob|null, G-code 는 string|null 을 돌려주므로 반환 타입은
   * 요청 종류에서 추론한다(오버로드).
   */
  private run(
    req: PngZipRequest | CtbRequest,
    transfer: Transferable[],
    onProgress?: BatchProgress,
  ): Promise<Blob | null>;
  private run(
    req: GcodeRequest,
    transfer: Transferable[],
    onProgress?: BatchProgress,
  ): Promise<string | null>;
  private run(
    req: SliceBatchRequest,
    transfer: Transferable[],
    onProgress?: BatchProgress,
  ): Promise<Blob | string | null> {
    return new Promise((resolve, reject) => {
      this.terminate(); // 이전 작업이 남아 있으면 정리(고아 Promise reject 포함).
      const worker = new SliceBatchWorker();
      this.worker = worker;
      this.pendingReject = reject;

      worker.onmessage = (e: MessageEvent<SliceBatchResponse>) => {
        const msg = e.data;
        switch (msg.type) {
          case "progress":
            onProgress?.(msg.done, msg.total);
            break;
          case "done":
            // 정상 완료 — terminate 가 이 Promise 를 reject 하지 않도록 먼저 클리어.
            this.pendingReject = null;
            this.terminate();
            resolve(
              msg.buffer === null
                ? null
                : new Blob([msg.buffer], { type: msg.mime }),
            );
            break;
          case "gcode-done":
            this.pendingReject = null;
            this.terminate();
            resolve(msg.gcode);
            break;
          case "error":
            this.pendingReject = null;
            this.terminate();
            reject(new Error(msg.message));
            break;
        }
      };

      worker.onerror = (e) => {
        this.pendingReject = null;
        this.terminate();
        reject(new Error(e.message || "slice-batch worker error"));
      };

      worker.postMessage(req, transfer);
    });
  }
}

/** 앱 전역에서 재사용하는 단일 인스턴스 (v1 slicerService 와 동일 스타일). */
export const sliceBatchService = new SliceBatchService();
