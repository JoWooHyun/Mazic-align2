// 슬라이스 프리뷰 상태 + 마스크 ZIP / G-code / STL / Task0 job.zip·G-code 내보내기 핸들러.
// (ViewerV2Page 에서 추출 — busy 가드·CancelError·downloadBlob·알림 문구 불변.)

import { useCallback, useEffect, useRef, useState } from "react";

import type { STLFileV2 } from "../../../types/stl";
import type { ProjectV2 } from "../../../types/project";
import type { PrinterProfileV2 } from "../../../types/printer";
import type {
  BabylonSceneHandle,
  BuildVolumeIssue,
} from "../../../components/BabylonScene";
import { downloadBlob } from "../../../utils/stl-export";
import { sliceBatchService } from "../../../utils/slice-batch-service";
import {
  TASK0_APP_JOB_GENERATOR,
  type Task0ExportReport,
  type Task0JobStage,
} from "../../../utils/task0/task0-export";
import {
  isTask0Profile,
  task0PrintableFrameForProfile,
  task0RasterFrameForProfile,
  task0WriterOptionsForProfile,
} from "../../../utils/task0/task0-profile";
import { profileExposure } from "../utils/profile-exposure";
import { previewLayerCount } from "../utils/layer-count";

/** 확인 다이얼로그 줄바꿈. */
const NL = String.fromCharCode(10);

interface UseSliceExportArgs {
  files: STLFileV2[];
  project: ProjectV2 | null | undefined;
  supportsLength: number;
  printerProfile: PrinterProfileV2;
  sceneHandleRef: React.RefObject<BabylonSceneHandle>;
  /**
   * 출력영역을 벗어난 모델 목록 (P-1). 비어 있으면 정상.
   *
   * 종전에는 이 값이 **화면 배너에만** 쓰이고 내보내기 경로는 아무도 읽지
   * 않았다. 그래서 빨간 경고를 보면서도 **잘려 나갈 모델의 ZIP/G-code 를
   * 정상 생성**할 수 있었다(프루사는 베드 밖이면 슬라이스를 막는다).
   */
  volumeIssues?: BuildVolumeIssue[];
}

export function useSliceExport({
  files,
  project,
  supportsLength,
  printerProfile,
  sceneHandleRef,
  volumeIssues,
}: UseSliceExportArgs) {
  const [slicePreview, setSlicePreview] = useState<{
    on: boolean;
    layerIdx: number;
    layerHeightMm: number;
  }>({ on: false, layerIdx: 0, layerHeightMm: 0.05 });
  const [sceneTopY, setSceneTopY] = useState(0);
  const [batchExport, setBatchExport] = useState<{
    busy: boolean;
    done: number;
    total: number;
    /** 진행 단계 — Task0 job.zip 만 (G-code 생성 / 층 이미지 / 묶기·검사). 다른 내보내기는 없음 */
    stage?: Task0JobStage;
  }>({ busy: false, done: 0, total: 0 });
  const [task0Report, setTask0Report] = useState<Task0ExportReport | null>(
    null,
  );

  // 마지막 Task0 결과는 그때의 입력(모델·서포트·프로파일·층두께)에만 맞다 (Z2 인계) — 입력이 바뀌거나 슬라이스 화면을
  //   나가면 지운다. 모델·서포트 편집은 슬라이스 화면 밖에서만 되므로(편집 잠금) 화면을 나갈 때 지우면 서포트만 옮긴
  //   경우(개수 그대로)도 덮인다. 내보내기 도중 입력이 바뀌면 끝난 결과를 화면에 올리지 않는다(epoch 비교 — 파일·알림은
  //   그대로 나가고, 패널 요약만 생략).
  const task0ReportEpochRef = useRef(0);
  useEffect(() => {
    task0ReportEpochRef.current += 1;
    setTask0Report(null);
  }, [
    files,
    supportsLength,
    printerProfile,
    slicePreview.layerHeightMm,
    slicePreview.on,
  ]);

  // Task0 프로파일이면 job.zip·run.gcode 와 같은 정규화 topY 로 센다(Z3) — 기존 프로파일은 종전 식 그대로.
  const layerCount = previewLayerCount(
    sceneTopY,
    slicePreview.layerHeightMm,
    printerProfile,
  );
  // sliceY = (layerIdx + 0.5) × layerHeight — 레이어 중심을 픽업.
  //   ⚠️ layerIdx 를 **반드시 클램프**한다: 층높이를 키우면 layerCount 가 줄어
  //   기존 layerIdx 가 범위를 벗어나고, 그러면 단면이 모델 위 허공을 가리켜
  //   화면이 빈 채로 남는다(패널은 safeLayerIdx 로 표시만 보정하고 있었다).
  const safeIdx = Math.min(slicePreview.layerIdx, layerCount - 1);
  const sliceYNow = (safeIdx + 0.5) * slicePreview.layerHeightMm;

  /**
   * 출력영역을 벗어난 모델이 있으면 사용자에게 확인을 받는다 (P-1).
   *
   * ## 왜 하드 차단이 아니라 확인인가
   * 프루사는 베드 밖이면 슬라이스를 아예 막지만, 우리는 **의도적으로 일부를
   * 잘라 뽑는 사용**(플레이트보다 큰 모델의 일부만 출력)을 막을 근거가 없다.
   * "모르고 뽑는 것"만 막으면 목적은 달성된다 — 설계서 4-1 의 미세조각 필터를
   * 두지 않기로 한 것과 같은 판단(판단은 사용자 몫, 도구는 알려만 준다).
   *
   * @returns 계속 진행해도 되면 true.
   */
  const confirmIfOutOfBounds = useCallback((): boolean => {
    if (!volumeIssues || volumeIssues.length === 0) return true;
    const names = volumeIssues
      .slice(0, 3)
      .map((it) => `· ${it.fileName} — ${it.message}`)
      .join(NL);
    const more =
      volumeIssues.length > 3 ? `${NL}· 외 ${volumeIssues.length - 3}개` : "";
    // Task0 (Z2) — 서포트까지 검사하고, 잘려 나가는 게 아니라 영역 밖 경로가 그대로 나간다.
    //   기존 프로파일 문구는 종전 그대로.
    const head = isTask0Profile(printerProfile)
      ? `⚠️ Task0 출력 가능 영역을 벗어난 항목(모델·서포트)이 ${volumeIssues.length}건 있습니다.${NL}` +
        `이대로 내보내면 영역 밖 도포 경로는 노광되지 않거나(투사 밖) 노즐 이동 범위를 넘을 수 있습니다.${NL}${NL}`
      : `⚠️ 출력영역을 벗어난 모델이 ${volumeIssues.length}개 있습니다.${NL}` +
        `이대로 내보내면 벗어난 부분이 잘려 나갑니다.${NL}${NL}`;
    return window.confirm(
      `${head}${names}${more}${NL}${NL}계속 내보낼까요?`,
    );
  }, [volumeIssues, printerProfile]);

  // ----- 마스크 ZIP 내보내기 -----
  const handleExportMasksZip = useCallback(async () => {
    const handle = sceneHandleRef.current;
    if (!handle || files.length === 0) return;
    if (batchExport.busy) return;
    if (!confirmIfOutOfBounds()) return; // P-1
    setBatchExport({ busy: true, done: 0, total: 0 });
    try {
      // 씬(Babylon Mesh)은 워커로 못 넘어가므로 world 삼각형 배열로 직렬화해 전달.
      const meshes = handle.getSliceGeometry();
      const topY = handle.getSceneTopY();
      const blob = await sliceBatchService.exportPngZip(
        meshes,
        {
          layerHeightMm: slicePreview.layerHeightMm,
          widthPx: printerProfile.lcdWidthPx,
          heightPx: printerProfile.lcdHeightPx,
          plateWidthMm: printerProfile.buildVolumeMm[0],
          plateDepthMm: printerProfile.buildVolumeMm[1],
          topY,
          // 프로파일에 노광 설정이 있을 때만 manifest 에 노광 배열 동봉 (기존 프로파일 하위 호환).
          exposure: profileExposure(printerProfile),
        },
        (done, total) => setBatchExport({ busy: true, done, total }),
      );
      // blob null = 빈 씬(topY<=0) 등으로 슬라이스할 레이어가 없음. 무음으로 끝나면
      //   사용자가 왜 파일이 안 나오는지 알 수 없으므로 안내한다.
      if (!blob) {
        // TODO: 추후 토스트로 교체 (현재 코드베이스에 토스트 인프라 없음 — 단순함 우선).
        window.alert("내보낼 레이어가 없습니다. 모델이 빌드 영역 안에 있는지 확인하세요.");
        return;
      }
      const safe = (project?.name ?? "project").replace(
        /[\\/:*?"<>|]/g,
        "_",
      );
      const lh = slicePreview.layerHeightMm.toFixed(3).replace(".", "_");
      downloadBlob(blob, `${safe}_layers_${lh}mm.zip`);
    } catch (e) {
      // 사용자 취소(CancelError)는 정상 흐름이라 조용히 넘긴다. 그 외 오류만
      //   사용자에게 안내 (unhandled rejection 방지 + 피드백).
      //   취소 판별은 메시지 문자열이 아니라 name 으로 한다(마감 검수 권고).
      if (e instanceof Error && e.name === "CancelError") return;
      const msg = e instanceof Error ? e.message : String(e);
      // TODO: 추후 토스트로 교체 (현재 코드베이스에 토스트 인프라 없음 — 단순함 우선).
      window.alert(`마스크 ZIP 내보내기에 실패했습니다.\n${msg}`);
    } finally {
      setBatchExport({ busy: false, done: 0, total: 0 });
    }
  }, [
    files.length,
    project?.name,
    slicePreview.layerHeightMm,
    batchExport.busy,
    printerProfile,
    sceneHandleRef,
    confirmIfOutOfBounds, // P-1
  ]);

  // ----- FDM G-code 내보내기 (감사 A5 — 워커로 이동) -----
  // 이전엔 SliceSidePanel 이 메인스레드 동기(exportFdmGcode)로 조립해 대형
  // 모델에서 수십 초 프리즈 + busy 가드 부재였다. 이제 마스크 ZIP 과 동일한
  // 워커 브릿지(진행률/취소/busy 가드)를 재사용한다.
  const handleExportGcode = useCallback(async () => {
    const handle = sceneHandleRef.current;
    if (!handle || files.length === 0) return;
    if (batchExport.busy) return;
    if (!confirmIfOutOfBounds()) return; // P-1

    // 씬(Babylon Mesh)은 워커로 못 넘어가므로 world 삼각형 배열 + 범위 + 설정을 준비.
    //
    // ⚠️ layerHeight 를 반드시 넘긴다. 인자를 비우면 DEFAULT_FDM_SETTINGS 의
    //   0.05 로 폴백해, 사용자가 패널에서 고른 두께가 G-code 에 전혀 반영되지
    //   않는다(마스크 ZIP 은 넘기는데 G-code 만 빠져 있던 비대칭 — B-37).
    const input = handle.getFdmSliceInput({
      layerHeight: slicePreview.layerHeightMm,
    });
    if (!input) {
      // 모델이 없거나 유효 슬라이스 범위가 없음 (동기 경로의 null 반환과 동일 상황).
      // TODO: 추후 토스트로 교체 (현재 코드베이스에 토스트 인프라 없음 — 단순함 우선).
      window.alert("내보낼 G-code 가 없습니다. 모델을 먼저 불러오세요.");
      return;
    }

    setBatchExport({ busy: true, done: 0, total: 0 });
    try {
      const gcode = await sliceBatchService.exportGcode(
        input.meshes,
        input.settings,
        input.range,
        (done, total) => setBatchExport({ busy: true, done, total }),
      );
      // gcode null = 슬라이스할 레이어가 없음 (getFdmSliceInput 이 이미 걸러내므로
      //   보통 도달하지 않지만, 방어적으로 안내).
      if (!gcode) {
        window.alert("내보낼 G-code 가 없습니다. 모델을 먼저 불러오세요.");
        return;
      }
      // ⚠️ text/plain 으로 만들면 브라우저가 "표시 가능한 타입"으로 보고
      //   download 속성을 무시한 채 blob URL 로 네비게이션하는 경우가 있다.
      //   그러면 SPA 가 통째로 이탈했다 돌아와 slicePreview 가 초기값으로
      //   리셋된다(= 미리보기 모드가 풀려 메인화면으로 튕김 — B-38).
      //   .zip 이 멀쩡했던 이유도 이것은 표시 불가 타입이기 때문.
      const blob = new Blob([gcode], { type: "application/octet-stream" });
      const safe = (project?.name ?? "project").replace(/[\\/:*?"<>|]/g, "_");
      downloadBlob(blob, `${safe}.gcode`);
    } catch (e) {
      // 사용자 취소(CancelError)는 정상 흐름 — 조용히 넘긴다. 그 외 오류만 안내.
      //   (메시지 문자열이 아니라 name 으로 판별 — 마감 검수 권고.)
      if (e instanceof Error && e.name === "CancelError") return;
      const msg = e instanceof Error ? e.message : String(e);
      // TODO: 추후 토스트로 교체 (현재 코드베이스에 토스트 인프라 없음 — 단순함 우선).
      window.alert(`G-code 내보내기에 실패했습니다.\n${msg}`);
    } finally {
      setBatchExport({ busy: false, done: 0, total: 0 });
    }
  }, [
    files.length,
    project?.name,
    batchExport.busy,
    sceneHandleRef,
    // 규칙 7: layerHeightMm 을 새로 참조하므로 deps 에 반드시 넣는다.
    //   빠지면 stale closure 로 "처음 진입 시점의 두께"가 계속 쓰인다.
    slicePreview.layerHeightMm,
    confirmIfOutOfBounds, // P-1
  ]);

  // ----- STL 내보내기 -----
  // Chrome/Edge 의 File System Access API (showSaveFilePicker) 우선 사용 —
  // 사용자가 매 저장 시 위치 직접 선택 (작업 디렉토리 등). 다운로드 폴더
  // 안 거쳐서 보안 프로그램 우회. 미지원 브라우저는 기존 downloadBlob fallback.
  const handleExportStl = useCallback(async () => {
    if (files.length === 0) return;
    const blob = sceneHandleRef.current?.exportStl();
    if (!blob) return;
    const safe = (project?.name ?? "project").replace(/[\\/:*?"<>|]/g, "_");
    const suffix = supportsLength > 0 ? "_supported" : "";
    const fileName = `${safe}${suffix}.stl`;

    const w = window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName?: string;
        types?: {
          description?: string;
          accept: Record<string, string[]>;
        }[];
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };

    if (typeof w.showSaveFilePicker === "function") {
      try {
        const handle = await w.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: "STL binary",
              accept: { "model/stl": [".stl"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (e) {
        // 사용자 취소 (AbortError) → 그대로 종료, fallback X.
        if ((e as { name?: string })?.name === "AbortError") return;
        // 기타 오류 → fallback.
      }
    }

    downloadBlob(blob, fileName);
  }, [files.length, project?.name, supportsLength, sceneHandleRef]);

  /**
   * Task0 출력 가능 영역 차단 (Z3) — 벗어난 항목(모델·서포트)이 있으면 확인이 아니라 이유를 알리고 **막는다**.
   *
   * 기존 프로파일의 P-1(confirmIfOutOfBounds)은 "일부를 잘라 뽑는 사용" 을 허락하지만 Task0 에는 그런 출력이 없다 —
   * 투사 밖은 노광되지 않고, 노즐 범위(Y 85) 밖 이동은 Task0(Klipper)가 거부한다. 코어(task0-export 1-b)도 writer 전에
   * 같은 영역으로 막으므로 여기는 워커를 띄우기 전에 화면이 이미 아는 이유를 바로 알리는 몫이다.
   * (confirmIfOutOfBounds 는 그대로 — Task0 두 핸들러는 그것을 부르지 않는다.)
   * @returns 막았으면 true.
   */
  const alertIfOutOfTask0Area = useCallback((): boolean => {
    if (!volumeIssues || volumeIssues.length === 0) return false;
    const names = volumeIssues
      .slice(0, 3)
      .map((it) => `· ${it.fileName} — ${it.message}`)
      .join(NL);
    const more =
      volumeIssues.length > 3 ? `${NL}· 외 ${volumeIssues.length - 3}개` : "";
    window.alert(
      `⚠️ Task0 출력 가능 영역을 벗어난 항목(모델·서포트)이 ${volumeIssues.length}건 있어 내보낼 수 없습니다.${NL}` +
        `영역 안으로 옮긴 뒤 다시 내보내세요(투사 밖은 노광되지 않고, 노즐 범위 밖 이동은 Task0 가 거부합니다).${NL}${NL}` +
        `${names}${more}`,
    );
    return true;
  }, [volumeIssues]);

  // ----- Task0 job.zip 내보내기 (Z3) — Task0 프로파일의 주 내보내기 -----
  // run.gcode(Z2 와 같은 검사) + 층 마스크 PNG(투사 프레임) + manifest·exposure·preview 를 워커에서 만들고 자기 검사까지
  // 한다(utils/task0/task0-export.ts runTask0JobZipExport). 마스크 ZIP 과 같은 mesh 집합(STL + 서포트)·같은 topY 를 넘겨
  // writer 와 층 마스크가 같은 단면에서 나온다(계획서 §4 Z3). 막히면 파일 없이 이유만(reject 아님).
  // 진행률은 단계와 함께(G-code 생성 → 층 이미지 → 묶기·검사), 취소·busy 는 다른 내보내기와 같은 인프라.
  // ⚠️ handleExportStl 뒤·handleExportTask0Gcode 앞에 둔다 — verify-task0-export 가 handleExportTask0Gcode ~ return 구간의
  //   deps 를, verify-gcode-export-params 가 handleExportGcode ~ handleExportStl 구간을 잘라 검사한다.
  const handleExportTask0JobZip = useCallback(async () => {
    const handle = sceneHandleRef.current;
    if (!handle || files.length === 0) return;
    if (batchExport.busy) return;
    if (!isTask0Profile(printerProfile)) return; // 버튼은 Task0 프로파일에서만 보인다
    if (alertIfOutOfTask0Area()) return; // Task0 는 출력 가능 영역 밖이면 막는다 (confirm 아님)
    const epoch = task0ReportEpochRef.current;
    setBatchExport({ busy: true, done: 0, total: 0 });
    setTask0Report(null);
    try {
      const meshes = handle.getSliceGeometry();
      const topY = handle.getSceneTopY();
      const layerHeightMm = slicePreview.layerHeightMm;
      const result = await sliceBatchService.exportTask0JobZip(
        meshes,
        {
          topY,
          layerHeightMm,
          writer: task0WriterOptionsForProfile(printerProfile),
          // manifest·exposure.json 노광 — 프로파일에 노광 값이 없으면 DEFAULT_* (규칙 6).
          exposure: profileExposure(printerProfile),
          frame: task0RasterFrameForProfile(printerProfile),
          printable: task0PrintableFrameForProfile(printerProfile),
          generator: TASK0_APP_JOB_GENERATOR,
        },
        (done, total, stage) =>
          setBatchExport({ busy: true, done, total, stage }),
      );
      const sameInputs = task0ReportEpochRef.current === epoch;
      if (!result.ok) {
        // 파일을 만들지 않았다 — 어느 층이 왜 막혔는지 알린다.
        if (sameInputs) {
          setTask0Report({ ok: false, kind: "jobzip", issues: result.issues });
        }
        window.alert(
          `Task0 job.zip 을 내보내지 않았습니다.${NL}${NL}` +
            result.issues.map((s) => `· ${s}`).join(NL),
        );
        return;
      }
      const safe = (project?.name ?? "project").replace(/[\\/:*?"<>|]/g, "_");
      const lh = layerHeightMm.toFixed(3).replace(".", "_");
      const fileName = `${safe}_task0_${lh}mm.job.zip`;
      downloadBlob(result.blob, fileName);
      if (sameInputs) {
        setTask0Report({
          ok: true,
          kind: "jobzip",
          fileName,
          summary: result.summary,
          job: result.job,
        });
      }
    } catch (e) {
      // 사용자 취소(CancelError)는 정상 흐름 — 조용히 넘긴다.
      if (e instanceof Error && e.name === "CancelError") return;
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`Task0 job.zip 내보내기에 실패했습니다.${NL}${msg}`);
    } finally {
      setBatchExport({ busy: false, done: 0, total: 0 });
    }
  }, [
    files.length,
    project?.name,
    batchExport.busy,
    sceneHandleRef,
    // 규칙 7: 프로파일(베드·투사 프레임·노광)과 층두께를 새로 참조하므로 deps 에 반드시 넣는다.
    printerProfile,
    slicePreview.layerHeightMm,
    alertIfOutOfTask0Area, // Task0 출력 가능 영역 차단
  ]);

  // ----- Task0 G-code(run.gcode) 내보내기 (Z2) — Task0 프로파일의 보조 내보내기(run.gcode 만) -----
  // 마스크 ZIP 과 같은 mesh 집합(STL + 서포트)·같은 topY 를 워커로 넘긴다(Z3 job.zip 의 마스크와
  // 도포 경로가 같은 단면에서 나오도록). 워커가 writer → 채움 실패 층 → Task0 파서 검사까지 하고,
  // 막히면 파일 없이 이유만 돌아온다(reject 아님). 진행률·취소·busy 는 다른 내보내기와 같은 인프라.
  // ⚠️ 이 핸들러는 handleExportStl 뒤에 둔다 — verify-gcode-export-params 가 handleExportGcode 본문을
  //   "handleExportGcode ~ handleExportStl" 구간으로 잘라 deps 를 검사한다.
  const handleExportTask0Gcode = useCallback(async () => {
    const handle = sceneHandleRef.current;
    if (!handle || files.length === 0) return;
    if (batchExport.busy) return;
    if (!isTask0Profile(printerProfile)) return; // 버튼은 Task0 프로파일에서만 보인다
    if (alertIfOutOfTask0Area()) return; // Task0 는 출력 가능 영역 밖이면 막는다 (confirm 아님)
    const epoch = task0ReportEpochRef.current;
    setBatchExport({ busy: true, done: 0, total: 0 });
    setTask0Report(null);
    try {
      const meshes = handle.getSliceGeometry();
      const topY = handle.getSceneTopY();
      const layerHeightMm = slicePreview.layerHeightMm;
      const result = await sliceBatchService.exportTask0Gcode(
        meshes,
        {
          topY,
          layerHeightMm,
          writer: task0WriterOptionsForProfile(printerProfile),
          // 예상 시간의 노광 항목 — 프로파일에 노광 값이 없으면 DEFAULT_* (규칙 6).
          exposure: profileExposure(printerProfile),
          printable: task0PrintableFrameForProfile(printerProfile),
        },
        (done, total) => setBatchExport({ busy: true, done, total }),
      );
      const sameInputs = task0ReportEpochRef.current === epoch;
      if (!result.ok) {
        // 파일을 만들지 않았다 — 어느 층이 왜 막혔는지 알린다.
        if (sameInputs) {
          setTask0Report({ ok: false, kind: "gcode", issues: result.issues });
        }
        window.alert(
          `Task0 G-code 를 내보내지 않았습니다.${NL}${NL}` +
            result.issues.map((s) => `· ${s}`).join(NL),
        );
        return;
      }
      // octet-stream — text/plain 이면 브라우저가 blob URL 로 이동해 미리보기가 풀린다(B-38).
      const blob = new Blob([result.gcode], {
        type: "application/octet-stream",
      });
      const safe = (project?.name ?? "project").replace(/[\\/:*?"<>|]/g, "_");
      const lh = layerHeightMm.toFixed(3).replace(".", "_");
      const fileName = `${safe}_task0_${lh}mm.gcode`;
      downloadBlob(blob, fileName);
      if (sameInputs) {
        setTask0Report({ ok: true, kind: "gcode", fileName, summary: result.summary });
      }
    } catch (e) {
      // 사용자 취소(CancelError)는 정상 흐름 — 조용히 넘긴다.
      if (e instanceof Error && e.name === "CancelError") return;
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(`Task0 G-code 내보내기에 실패했습니다.${NL}${msg}`);
    } finally {
      setBatchExport({ busy: false, done: 0, total: 0 });
    }
  }, [
    files.length,
    project?.name,
    batchExport.busy,
    sceneHandleRef,
    // 규칙 7: 프로파일(베드 크기·노광)과 층두께를 새로 참조하므로 deps 에 반드시 넣는다.
    printerProfile,
    slicePreview.layerHeightMm,
    alertIfOutOfTask0Area, // Task0 출력 가능 영역 차단
  ]);

  return {
    slicePreview,
    setSlicePreview,
    sceneTopY,
    setSceneTopY,
    batchExport,
    sliceYNow,
    layerCount,
    handleExportMasksZip,
    handleExportGcode,
    handleExportStl,
    handleExportTask0JobZip,
    handleExportTask0Gcode,
    task0Report,
  };
}
