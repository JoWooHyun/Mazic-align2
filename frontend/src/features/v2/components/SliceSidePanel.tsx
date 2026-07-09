import { useMemo } from "react";

import { useCurrentProfile } from "../hooks/usePrinterProfileStore";
import {
  DEFAULT_EXPOSURE_SEC,
  DEFAULT_BOTTOM_EXPOSURE_SEC,
  DEFAULT_BOTTOM_LAYER_COUNT,
} from "../types/printer";
import { estimatePrintTimeSec } from "../utils/print-time";
import { sliceBatchService } from "../utils/slice-batch-service";
import type { BabylonSceneHandle } from "./BabylonScene";
import SliceMaskPreview from "./SliceMaskPreview";

/** SLA 레진 평균 밀도 (g/cm³). 메이커마다 1.05 ~ 1.15. */
const RESIN_DENSITY_G_PER_CM3 = 1.1;

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return `${m}분 ${s}초`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}시간 ${mm}분`;
}

interface Props {
  onClose: () => void;
  sceneHandleRef: React.RefObject<BabylonSceneHandle | null>;

  sliceYNow: number;
  layerIdx: number;
  layerHeightMm: number;
  layerCount: number;
  sceneTopY: number;

  onLayerIdxChange: (i: number) => void;
  onLayerHeightChange: (mm: number) => void;

  onExportMasksZip: () => void;
  onExportCtb: () => void;
  batchBusy: boolean;
  batchDone: number;
  batchTotal: number;

  modelCount: number;
}

/**
 * Viewport 옆에 붙는 슬라이스 미리보기 사이드 패널 (modal 아님).
 *
 * 메인 viewport 가 가려지지 않도록 별도 좁은 column 으로 추가. 사용자가
 * 3D 뷰의 시점/배율을 그대로 유지한 채 layer scrub 을 할 수 있다.
 */
const SliceSidePanel: React.FC<Props> = ({
  onClose,
  sceneHandleRef,
  sliceYNow,
  layerIdx,
  layerHeightMm,
  layerCount,
  sceneTopY,
  onLayerIdxChange,
  onLayerHeightChange,
  onExportMasksZip,
  onExportCtb,
  batchBusy,
  batchDone,
  batchTotal,
  modelCount,
}) => {
  const safeLayerIdx = Math.min(layerIdx, Math.max(0, layerCount - 1));

  // 예상 출력 시간 추정에 쓰는 현재 프린터 프로파일 (노광 + 리프트/딜레이).
  const printerProfile = useCurrentProfile();

  // G-code 내보내기: DEFAULT_FDM_SETTINGS 로 슬라이스한 전체 문자열을
  // .gcode 텍스트 파일로 즉시 다운로드. 설정 UI 는 이번 범위 아님.
  const handleExportGcode = () => {
    const handle = sceneHandleRef.current;
    if (!handle) return;
    const gcode = handle.exportFdmGcode();
    // gcode null = STL 이 없거나 슬라이스할 지오메트리가 없음. 무음이면 사용자가
    //   버튼을 눌러도 아무 일이 없어 보이므로 안내한다.
    if (!gcode) {
      // TODO: 추후 토스트로 교체 (현재 코드베이스에 토스트 인프라 없음 — 단순함 우선).
      window.alert("내보낼 G-code 가 없습니다. 모델을 먼저 불러오세요.");
      return;
    }
    const blob = new Blob([gcode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "print.gcode";
    a.click();
    URL.revokeObjectURL(url);
  };

  // 출력 시간·레진 추정. modelCount / layerCount / sceneTopY 가 바뀔
  // 때만 다시 계산. mesh transform 이 바뀌면 sceneTopY 가 함께 갱신
  // 되니 무관해 보여도 dep 에 들어가야 정확.
  const stats = useMemo(() => {
    const handle = sceneHandleRef.current;
    if (!handle || modelCount === 0) {
      return { volumeMl: 0, resinG: 0, printSec: 0 };
    }
    const { model, support } = handle.getBuildVolumeMm3();
    const volumeMm3 = model + support;
    const volumeMl = volumeMm3 / 1000;
    const resinG = volumeMl * RESIN_DENSITY_G_PER_CM3;
    // v1 합산식(노광 + lightOffDelay + 리프트 왕복) 기반 프로파일 추정.
    const printSec = estimatePrintTimeSec(layerCount, printerProfile);
    return { volumeMl, resinG, printSec };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelCount, layerCount, sceneTopY, sceneHandleRef, printerProfile]);

  return (
    <aside className="w-[420px] border-l border-gray-200 bg-white flex flex-col overflow-y-auto">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            슬라이스 미리보기
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            LCD 1bpp 마스크 (흰 = 모델 영역)
          </p>
        </div>
        <button
          onClick={onClose}
          disabled={batchBusy}
          className="text-gray-400 hover:text-gray-700 text-lg leading-none disabled:opacity-30"
          title="닫기"
        >
          ×
        </button>
      </header>

      <div className="p-4 flex flex-col gap-4">
        <div className="flex items-center justify-center bg-gray-50 rounded p-2">
          <SliceMaskPreview
            sceneHandleRef={sceneHandleRef}
            sliceY={sliceYNow}
            widthPx={380}
            heightPx={240}
          />
        </div>

        <Card title="출력 추정">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <span className="text-gray-500">레진 부피</span>
            <span className="text-gray-800 font-mono text-right">
              {stats.volumeMl.toFixed(2)} ml
            </span>
            <span className="text-gray-500">레진 무게</span>
            <span className="text-gray-800 font-mono text-right">
              {stats.resinG.toFixed(2)} g
            </span>
            <span className="text-gray-500">출력 시간</span>
            <span className="text-gray-800 font-mono text-right">
              {formatDuration(stats.printSec)}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            기준: {printerProfile.name} · 노광{" "}
            {(printerProfile.exposureSec ?? DEFAULT_EXPOSURE_SEC).toFixed(1)}s ·
            바닥 {printerProfile.bottomLayerCount ?? DEFAULT_BOTTOM_LAYER_COUNT}층{" "}
            {(printerProfile.bottomExposureSec ?? DEFAULT_BOTTOM_EXPOSURE_SEC).toFixed(1)}s · 레진 ~1.1
            g/cm³
          </p>
        </Card>

        <Card title="레이어 두께">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0.01}
              max={0.3}
              step={0.005}
              value={layerHeightMm}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v) && v > 0) onLayerHeightChange(v);
              }}
              className="w-24 px-2 py-1 text-sm border border-gray-300 rounded"
            />
            <span className="text-xs text-gray-500">mm</span>
            <span className="ml-auto text-xs text-gray-500">
              총 {layerCount} layer
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            모델 top: {sceneTopY.toFixed(2)} mm
          </p>
        </Card>

        <Card title="현재 레이어">
          <div className="flex items-center gap-2 mb-2">
            <input
              type="range"
              min={0}
              max={Math.max(0, layerCount - 1)}
              step={1}
              value={safeLayerIdx}
              onChange={(e) => onLayerIdxChange(Number(e.target.value))}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            <input
              type="number"
              min={0}
              max={Math.max(0, layerCount - 1)}
              step={1}
              value={safeLayerIdx}
              onChange={(e) => onLayerIdxChange(Number(e.target.value))}
              className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
            />
          </div>
          <p className="text-xs text-gray-500 font-mono">
            Z = {sliceYNow.toFixed(3)} mm
          </p>
        </Card>

        <Card title="내보내기">
          {batchBusy ? (
            <div className="text-sm text-gray-700">
              진행 중… {batchDone} / {batchTotal}
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2 overflow-hidden">
                <div
                  className="bg-primary-600 h-2 transition-all"
                  style={{
                    width:
                      batchTotal > 0
                        ? `${(batchDone / batchTotal) * 100}%`
                        : "0%",
                  }}
                />
              </div>
              {/* 취소 (감사 A4) — 워커 terminate → 진행 중 Promise reject.
                  ViewerV2Page 의 export 핸들러가 finally 에서 busy 를 풀고,
                  catch 는 "취소" 메시지를 조용히 넘긴다. */}
              <button
                onClick={() => sliceBatchService.cancel()}
                className="mt-3 w-full px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                onClick={onExportMasksZip}
                disabled={modelCount === 0}
                className="px-3 py-2 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                마스크 ZIP
              </button>
              <button
                onClick={handleExportGcode}
                disabled={modelCount === 0}
                className="px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                G-code 내보내기
              </button>
              <button
                onClick={onExportCtb}
                disabled
                title="ChiTuBox 강제 종료 — spec 재검토 중"
                className="px-3 py-2 text-sm border border-gray-300 text-gray-400 rounded cursor-not-allowed"
              >
                .ctb (검증 중)
              </button>
            </div>
          )}
        </Card>
      </div>
    </aside>
  );
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded p-3">
      <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

export default SliceSidePanel;
