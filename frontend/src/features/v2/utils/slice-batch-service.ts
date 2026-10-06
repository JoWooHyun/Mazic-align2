/**
 * 배치 슬라이스/출력 워커 브릿지 (메인스레드 ↔ slice-batch.worker).
 *
 * v1 SlicerService 패턴을 v2 로 이식: 매 export 마다 새 Worker 를 띄우고
 * 완료/오류/취소 시 terminate. Promise API + onProgress 콜백 + cancel().
 */
import SliceBatchWorker from "../workers/slice-batch.worker?worker";

import type { FdmSettings } from "./gcode/types";
import type {
  Task0ExportParserCheck,
  Task0ExportResult,
  Task0ExportSummary,
  Task0JobStage,
  Task0JobZipExportResult,
  Task0JobZipSummary,
} from "./task0/task0-export";
import type {
  GcodeRequest,
  PngZipRequest,
  SliceBatchRequest,
  SliceBatchResponse,
  Task0GcodeRequest,
  Task0JobZipRequest,
  WorkerMeshGeometry,
  WorkerSliceOptions,
} from "../workers/slice-batch.messages";

/**
 * 진행률 콜백. stage 는 Task0 job.zip 만 넘긴다(G-code 생성 / 층 이미지 / 묶기·검사 — 단계마다 done/total 을 새로 센다).
 * 다른 경로는 (done, total) 만 — 기존 호출부는 그대로.
 */
export type BatchProgress = (
  done: number,
  total: number,
  stage?: Task0JobStage,
) => void;

/**
 * Task0 job.zip 내보내기 결과 (Z3) — 통과면 zip 을 Blob(application/zip)으로, 막혔으면 워커 결과(이유) 그대로.
 */
export type Task0JobZipOutcome =
  | {
      ok: true;
      blob: Blob;
      summary: Task0ExportSummary;
      job: Task0JobZipSummary;
      parser: Task0ExportParserCheck[];
    }
  | Extract<Task0JobZipExportResult, { ok: false }>;

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

  /**
   * FDM G-code 내보내기 (감사 A5 — 메인스레드 프리즈 해소).
   * 대상 mesh 가 없거나 슬라이스 범위(range.yMax<=yMin)가 비면 null.
   * 진행률·취소는 PNG-ZIP 경로와 동일 인프라(onProgress / cancel) 재사용.
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
   * Task0 G-code(run.gcode) 내보내기 (Z2). 워커에서 writer → 채움 실패 층 확인 → Task0 파서 검사를 돌린다.
   * 결과는 통과(gcode + 요약) 또는 막힘(gcode null + 이유) — 막힘은 reject 가 아니라 정상 resolve 다.
   * 진행률(층 단위)·취소는 다른 경로와 같은 인프라(onProgress / cancel).
   */
  exportTask0Gcode(
    meshes: WorkerMeshGeometry[],
    input: Omit<Task0GcodeRequest, "kind" | "meshes">,
    onProgress?: BatchProgress,
  ): Promise<Task0ExportResult> {
    const req: Task0GcodeRequest = { kind: "task0-gcode", meshes, ...input };
    return this.run(req, transfersOf(meshes), onProgress);
  }

  /**
   * Task0 job.zip 내보내기 (Z3). 워커에서 run.gcode(위와 같은 검사) → 층 마스크 PNG → manifest·exposure·preview →
   * zip → 자기 검사까지 한다. 통과면 zip 을 Blob(application/zip)으로, 막혔으면 이유를 resolve 한다(reject 아님).
   * 진행률은 단계(stage)와 함께, 취소는 다른 경로와 같은 cancel(worker terminate).
   */
  async exportTask0JobZip(
    meshes: WorkerMeshGeometry[],
    input: Omit<Task0JobZipRequest, "kind" | "meshes">,
    onProgress?: BatchProgress,
  ): Promise<Task0JobZipOutcome> {
    const req: Task0JobZipRequest = { kind: "task0-jobzip", meshes, ...input };
    const r = await this.run(req, transfersOf(meshes), onProgress);
    if (!r.ok) return r;
    return {
      ok: true,
      blob: new Blob([r.zip], { type: "application/zip" }),
      summary: r.summary,
      job: r.job,
      parser: r.parser,
    };
  }

  /**
   * 워커 요청을 실행하고 종료 응답(done / gcode-done / task0-done / task0-job-done)을 결과로 resolve 한다.
   * PNG-ZIP 은 Blob|null, G-code 는 string|null, Task0 는 Task0ExportResult 를 돌려주므로
   * 반환 타입은 요청 종류에서 추론한다(오버로드).
   */
  private run(
    req: PngZipRequest,
    transfer: Transferable[],
    onProgress?: BatchProgress,
  ): Promise<Blob | null>;
  private run(
    req: GcodeRequest,
    transfer: Transferable[],
    onProgress?: BatchProgress,
  ): Promise<string | null>;
  private run(
    req: Task0GcodeRequest,
    transfer: Transferable[],
    onProgress?: BatchProgress,
  ): Promise<Task0ExportResult>;
  private run(
    req: Task0JobZipRequest,
    transfer: Transferable[],
    onProgress?: BatchProgress,
  ): Promise<Task0JobZipExportResult>;
  private run(
    req: SliceBatchRequest,
    transfer: Transferable[],
    onProgress?: BatchProgress,
  ): Promise<
    Blob | string | Task0ExportResult | Task0JobZipExportResult | null
  > {
    return new Promise((resolve, reject) => {
      this.terminate(); // 이전 작업이 남아 있으면 정리(고아 Promise reject 포함).
      const worker = new SliceBatchWorker();
      this.worker = worker;
      this.pendingReject = reject;

      worker.onmessage = (e: MessageEvent<SliceBatchResponse>) => {
        const msg = e.data;
        switch (msg.type) {
          case "progress":
            onProgress?.(msg.done, msg.total, msg.stage);
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
          case "task0-done":
            this.pendingReject = null;
            this.terminate();
            resolve(msg.result);
            break;
          case "task0-job-done":
            this.pendingReject = null;
            this.terminate();
            resolve(msg.result);
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
