// 슬라이스 프리뷰 상태 + 마스크 ZIP / CTB / G-code / STL 내보내기 핸들러.
// (ViewerV2Page 에서 추출 — busy 가드·CancelError·downloadBlob·알림 문구 불변.)

import { useCallback, useState } from "react";

import type { STLFileV2 } from "../../../types/stl";
import type { ProjectV2 } from "../../../types/project";
import type { PrinterProfileV2 } from "../../../types/printer";
import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import { downloadBlob } from "../../../utils/stl-export";
import { sliceBatchService } from "../../../utils/slice-batch-service";
import { profileExposure } from "../utils/profile-exposure";

interface UseSliceExportArgs {
  files: STLFileV2[];
  project: ProjectV2 | null | undefined;
  supportsLength: number;
  printerProfile: PrinterProfileV2;
  sceneHandleRef: React.RefObject<BabylonSceneHandle>;
}

export function useSliceExport({
  files,
  project,
  supportsLength,
  printerProfile,
  sceneHandleRef,
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
  }>({ busy: false, done: 0, total: 0 });

  // sliceY = (layerIdx + 0.5) × layerHeight — 레이어 중심을 픽업
  const sliceYNow = (slicePreview.layerIdx + 0.5) * slicePreview.layerHeightMm;
  const layerCount = Math.max(
    1,
    Math.ceil(sceneTopY / slicePreview.layerHeightMm),
  );

  // ----- 마스크 ZIP 내보내기 -----
  const handleExportMasksZip = useCallback(async () => {
    const handle = sceneHandleRef.current;
    if (!handle || files.length === 0) return;
    if (batchExport.busy) return;
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
  ]);

  // ----- .ctb v4 내보내기 -----
  const handleExportCtb = useCallback(async () => {
    const handle = sceneHandleRef.current;
    if (!handle || files.length === 0) return;
    if (batchExport.busy) return;
    setBatchExport({ busy: true, done: 0, total: 0 });
    try {
      // 씬(Babylon Mesh)은 워커로 못 넘어가므로 world 삼각형 배열로 직렬화해 전달.
      const meshes = handle.getSliceGeometry();
      const topY = handle.getSceneTopY();
      const blob = await sliceBatchService.exportCtb(
        meshes,
        {
          layerHeightMm: slicePreview.layerHeightMm,
          widthPx: printerProfile.lcdWidthPx,
          heightPx: printerProfile.lcdHeightPx,
          plateWidthMm: printerProfile.buildVolumeMm[0],
          plateDepthMm: printerProfile.buildVolumeMm[1],
          topY,
        },
        {
          bedSizeZMm: printerProfile.buildVolumeMm[2],
          // 프로파일에 값이 없으면 undefined → 인코더 기본값 사용 (기존 산출물과 동일).
          exposureSec: printerProfile.exposureSec,
          bottomExposureSec: printerProfile.bottomExposureSec,
          bottomLayerCount: printerProfile.bottomLayerCount,
          transitionLayerCount: printerProfile.transitionLayerCount,
          // 리프트/딜레이 — 미지정 시 워커에서 DEFAULT_*(v1) 폴백. CTB 기록과 예상 시간이 같은 값 기준.
          lightOffDelaySec: printerProfile.lightOffDelaySec,
          liftDistanceMm: printerProfile.liftDistanceMm,
          liftSpeedMmS: printerProfile.liftSpeedMmS,
          retractSpeedMmS: printerProfile.retractSpeedMmS,
        },
        (done, total) => setBatchExport({ busy: true, done, total }),
      );
      // blob null = 빈 씬(topY<=0) 등으로 슬라이스할 레이어가 없음 (마스크 ZIP 과 동일).
      if (!blob) {
        // TODO: 추후 토스트로 교체 (현재 코드베이스에 토스트 인프라 없음 — 단순함 우선).
        window.alert("내보낼 레이어가 없습니다. 모델이 빌드 영역 안에 있는지 확인하세요.");
        return;
      }
      const safe = (project?.name ?? "project").replace(
        /[\\/:*?"<>|]/g,
        "_",
      );
      downloadBlob(blob, `${safe}_v3.ctb`);
    } catch (e) {
      // 취소(CancelError)는 조용히, 그 외 오류만 안내 (마스크 ZIP 과 동일 정책).
      //   취소 판별은 메시지 문자열이 아니라 name 으로 한다(마감 검수 권고).
      if (e instanceof Error && e.name === "CancelError") return;
      const msg = e instanceof Error ? e.message : String(e);
      // TODO: 추후 토스트로 교체 (현재 코드베이스에 토스트 인프라 없음 — 단순함 우선).
      window.alert(`.ctb 내보내기에 실패했습니다.\n${msg}`);
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
  ]);

  // ----- FDM G-code 내보내기 (감사 A5 — 워커로 이동) -----
  // 이전엔 SliceSidePanel 이 메인스레드 동기(exportFdmGcode)로 조립해 대형
  // 모델에서 수십 초 프리즈 + busy 가드 부재였다. 이제 마스크 ZIP/CTB 와 동일한
  // 워커 브릿지(진행률/취소/busy 가드)를 재사용한다.
  const handleExportGcode = useCallback(async () => {
    const handle = sceneHandleRef.current;
    if (!handle || files.length === 0) return;
    if (batchExport.busy) return;

    // 씬(Babylon Mesh)은 워커로 못 넘어가므로 world 삼각형 배열 + 범위 + 설정을 준비.
    const input = handle.getFdmSliceInput();
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
      const blob = new Blob([gcode], { type: "text/plain" });
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
  }, [files.length, project?.name, batchExport.busy, sceneHandleRef]);

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

  return {
    slicePreview,
    setSlicePreview,
    sceneTopY,
    setSceneTopY,
    batchExport,
    sliceYNow,
    layerCount,
    handleExportMasksZip,
    handleExportCtb,
    handleExportGcode,
    handleExportStl,
  };
}
