// 슬라이스 미리보기 모드의 우측 2D 단면 패널 (1단계).
//
// 기존 `SliceMaskPreview` 를 그대로 재사용하고 크기만 키운다.
//
// ⚠️ **성능 상한 고정**: `getSliceMask` 는 메인스레드 **동기** 호출이라
//   픽셀 수를 컨테이너 크기에 맞춰 무한정 키우면 층 스크럽이 뚝뚝 끊긴다.
//   그래서 래스터 해상도는 긴 변 512px 상한으로 **고정**하고, 표시 크기는
//   CSS 로만 바꾼다(P1 부터: 칸에 맞춘 단면 박스 + 줌 — 아래). 해상도 자동 적응은 2단계 과제.
//
// Task0 2재료(D2): materialSlots 가 있으면(슬라이스 화면 + Task0 2재료) 단면을 재료 색으로 — 재료 A 주황 / B 보라 /
//   겹친 곳 B(writer 와 같은 B 우선) / 빈 곳 검정, 아래에 범례. 래스터 2회(합집합 + B)라 상한 512px 그대로 둔다.
//
// 경로 미리보기 P1 (계획 docs/계획_경로미리보기_20261019.md §3 P1 + 구현 메모 10/22):
//   - 단면 박스 = 마스크 종횡비(widthPx:heightPx)를 지키며 칸에 맞춘 크기(확대 전 최대 widthPx×heightPx CSS px — 종전 표시와 같은 크기).
//     마스크 canvas(512 상한 그대로, 그리기 무변경)와 경로 canvas 가 **같은 박스**에 겹친다(inset-0).
//   - 줌·이동: 휠 = 커서 기준 확대(1×~20×, 한 칸 ×1.2), 왼쪽 드래그 = 이동, 더블클릭·「맞춤」 = 원래대로. view 하나를 두 층이 같이 쓴다 —
//     마스크는 CSS transform(픽셀이 그대로 보이게 pixelated), 경로는 ctx.setTransform 으로 매번 다시 그려 확대해도 선이 선명하다.
//     층을 바꿔도 view 는 유지, 슬라이스 화면을 나가면(언마운트) 리셋. 휠은 passive:false 로 페이지 스크롤을 막는다.
//   - 경로(Task0 프로파일만 — task0Path !== undefined): 마지막 run.gcode 내보내기의 그 층 이동을 겹쳐 그린다(utils/task0/task0-path-preview).
//     도포 = 툴 색 띠(실제 비드 폭 w), 트래블 = 가는 선, 노즐 = 빨간 점. 진행률 = 층 안 이동 수(층을 바꾸면 100 %로).

import { useEffect, useRef, useState } from "react";

import SliceMaskPreview from "../../../components/SliceMaskPreview";
import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import { TASK0_SLOT_COLOR_HEX } from "../../../utils/task0/task0-material";
import type { Task0MaterialSlot } from "../../../utils/task0/task0-slice";
import {
  SECTION_VIEW_IDENTITY,
  SECTION_ZOOM_STEP,
  TASK0_PATH_STYLE,
  clampSectionView,
  drawTask0PathLayer,
  panSectionView,
  sectionViewCssTransform,
  task0LayerMoveCount,
  zoomSectionViewAt,
  type SectionView,
  type Task0PathPreview,
} from "../../../utils/task0/task0-path-preview";

/** 마스크 래스터 긴 변 상한 (px). 메인스레드 동기 호출이라 올리면 스크럽이 멈춘다. */
const MASK_MAX_PX = 512;

interface SliceSectionPaneProps {
  sceneHandleRef: React.RefObject<BabylonSceneHandle>;
  sliceY: number;
  /** LCD 가로 픽셀 — 마스크 종횡비 산출용. */
  lcdWidthPx: number;
  /** LCD 세로 픽셀 — 마스크 종횡비 산출용. */
  lcdHeightPx: number;
  /**
   * Task0 2재료 (D2) — STL id → 재료 슬롯 (슬라이스 화면 + Task0 2재료일 때만, 아니면 null — useTask0Material sliceSlots).
   * 있으면 단면을 재료 색(A 주황 / B 보라 / 겹친 곳 B)으로 그리고 아래 범례를 보인다. 없으면 지금까지의 흑백 마스크.
   */
  materialSlots?: Readonly<Record<string, Task0MaterialSlot>> | null;
  /** 현재 층 (범위 클램프된 값 — 층 레일과 같은 값). 경로 미리보기의 층 N = run.gcode 층 N (계획서 F6) */
  layerIdx?: number;
  /**
   * 경로 미리보기 (P1 — useSliceExport task0Path). undefined = Task0 프로파일 아님(경로 도구 없음),
   * null = 경로 없음(아직 run.gcode 를 안 냈거나 입력이 바뀜 — 안내 문구).
   */
  task0Path?: Task0PathPreview | null;
}

/** 범례 색 견본 — 3D 재료 색·재료 카드와 같은 값 */
function LegendSwatch({ slot }: { slot: Task0MaterialSlot }) {
  return (
    <span
      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
      style={{ backgroundColor: TASK0_SLOT_COLOR_HEX[slot] }}
    />
  );
}

/** 경로 범례 견본 — 띠(도포) / 가는 선(트래블) / 점(노즐) */
function PathSwatch({ color, kind }: { color: string; kind: "band" | "line" | "dot" }) {
  const cls =
    kind === "band"
      ? "w-3 h-1.5 rounded-sm"
      : kind === "line"
        ? "w-3 h-px"
        : "w-2 h-2 rounded-full";
  return (
    <span
      className={`${cls} flex-shrink-0`}
      style={{ backgroundColor: color }}
    />
  );
}

export default function SliceSectionPane({
  sceneHandleRef,
  sliceY,
  lcdWidthPx,
  lcdHeightPx,
  materialSlots = null,
  layerIdx = 0,
  task0Path,
}: SliceSectionPaneProps) {
  // LCD 종횡비를 유지한 채 긴 변을 MASK_MAX_PX 로 맞춘다 — 단면이 프린터
  //   화면과 같은 비율로 보이게. 프로파일 값이 이상하면 정사각으로 폴백.
  const w = lcdWidthPx > 0 ? lcdWidthPx : MASK_MAX_PX;
  const h = lcdHeightPx > 0 ? lcdHeightPx : MASK_MAX_PX;
  const scale = MASK_MAX_PX / Math.max(w, h);
  const widthPx = Math.max(1, Math.round(w * scale));
  const heightPx = Math.max(1, Math.round(h * scale));

  // ── 단면 박스 크기: 칸(stage)에 종횡비 그대로 맞추되 확대 전 크기는 widthPx×heightPx 를 넘지 않는다(종전 표시와 같음) ──
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit =
    stage && stage.w > 0 && stage.h > 0
      ? Math.min(1, stage.w / widthPx, stage.h / heightPx)
      : 1;
  const boxW = widthPx * fit;
  const boxH = heightPx * fit;

  // ── 줌·이동 view (마스크·경로 공용) — 렌더 때 박스 크기로 자른다(창 크기가 바뀌어도 빈 테두리 없음) ──
  const [viewRaw, setViewRaw] = useState<SectionView>(SECTION_VIEW_IDENTITY);
  const view = clampSectionView(viewRaw, boxW, boxH);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // 휠 확대 — React onWheel 은 passive 라 preventDefault 가 안 먹는다 → addEventListener(passive:false).
  //   박스는 늘 렌더되므로 한 번만 붙인다. 크기는 이벤트 때 박스 사각형에서 읽는다(박스 자체는 transform 이 없다).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // 페이지 스크롤 막기
      e.stopPropagation();
      if (e.deltaY === 0) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const factor = e.deltaY < 0 ? SECTION_ZOOM_STEP : 1 / SECTION_ZOOM_STEP;
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      setViewRaw((v) => zoomSectionViewAt(v, cx, cy, factor, r.width, r.height));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setDragging(true);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    const r = e.currentTarget.getBoundingClientRect();
    setViewRaw((v) => panSectionView(v, dx, dy, r.width, r.height));
  };
  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };
  const resetView = () => setViewRaw(SECTION_VIEW_IDENTITY);

  // ── 경로 미리보기 (P1) ──
  const pathTools = task0Path !== undefined; // Task0 프로파일
  const [showPath, setShowPath] = useState(true); // 리드 10/22 — 기본 켬
  const moveCount = task0Path ? task0LayerMoveCount(task0Path, layerIdx) : 0;
  // 진행률 — 이 경로·이 층에서 고른 값만 쓴다(층·경로가 바뀌면 자동으로 100 % — 따로 지우는 effect 없음)
  const [progress, setProgress] = useState<{
    path: Task0PathPreview;
    layer: number;
    shown: number;
  } | null>(null);
  const shown =
    task0Path && progress && progress.path === task0Path && progress.layer === layerIdx
      ? Math.min(progress.shown, moveCount)
      : moveCount;
  const drawPath = !!task0Path && showPath;
  const pathCanvasRef = useRef<HTMLCanvasElement>(null);

  // 경로 canvas — 박스 CSS 크기 × devicePixelRatio 로 촘촘하게, view 는 setTransform 으로(마스크 CSS transform 과 같은 변환).
  useEffect(() => {
    const canvas = pathCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(boxW * dpr));
    const ch = Math.max(1, Math.round(boxH * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!task0Path || !showPath) return;
    // 박스 u → backing px 비율 (반올림한 backing 크기 기준 — 마스크 층과 소수 px 도 안 어긋나게)
    const sx = cw / boxW;
    const sy = ch / boxH;
    ctx.setTransform(
      sx * view.scale,
      0,
      0,
      sy * view.scale,
      sx * view.tx,
      sy * view.ty,
    );
    drawTask0PathLayer(ctx, {
      path: task0Path,
      layer: layerIdx,
      shown,
      widthPx,
      heightPx,
      boxW,
      boxH,
      scale: view.scale,
    });
  }, [
    task0Path,
    showPath,
    layerIdx,
    shown,
    view.scale,
    view.tx,
    view.ty,
    boxW,
    boxH,
    widthPx,
    heightPx,
  ]);

  const pct = moveCount > 0 ? Math.round((shown / moveCount) * 100) : 100;
  const zoomed = view.scale !== 1 || view.tx !== 0 || view.ty !== 0;

  return (
    <section className="flex-1 min-w-0 bg-gray-900 flex flex-col items-center justify-center p-4">
      {pathTools && (
        <div className="w-full mb-2 flex items-center gap-3 text-xs text-gray-300 select-none">
          <label
            className={`flex items-center gap-1 flex-shrink-0 ${task0Path ? "cursor-pointer" : "opacity-50"}`}
            title={task0Path ? undefined : "run.gcode 만 내보내면 경로가 생깁니다"}
          >
            <input
              type="checkbox"
              checked={showPath}
              disabled={!task0Path}
              onChange={(e) => setShowPath(e.target.checked)}
            />
            경로 보기
          </label>
          {drawPath && task0Path && moveCount > 0 && (
            <>
              <input
                type="range"
                min={0}
                max={moveCount}
                step={1}
                value={shown}
                onChange={(e) =>
                  setProgress({
                    path: task0Path,
                    layer: layerIdx,
                    shown: Number(e.target.value),
                  })
                }
                aria-label="층 안 진행률 (이동 수)"
                className="flex-1 min-w-0 cursor-pointer"
              />
              <span className="font-mono flex-shrink-0">
                {pct}% · {shown}/{moveCount} 이동
              </span>
            </>
          )}
          {drawPath && moveCount === 0 && (
            <span className="text-gray-500">이 층은 이동 없음</span>
          )}
        </div>
      )}

      <div
        ref={stageRef}
        className="flex-1 min-h-0 w-full flex items-center justify-center"
      >
        <div className="border border-gray-300 rounded shadow-sm">
          <div
            ref={boxRef}
            className={`relative overflow-hidden bg-black select-none touch-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ width: boxW, height: boxH }}
            title="휠 = 확대·축소 · 드래그 = 이동 · 더블클릭 = 원래대로"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onDoubleClick={(e) => {
              e.stopPropagation();
              resetView();
            }}
          >
            {/* 마스크 층 — 그리기 무변경(512 상한), 확대는 CSS transform 만(pixelated — 실제 마스크 픽셀이 보인다) */}
            <div
              className="absolute inset-0"
              style={{
                transform: sectionViewCssTransform(view),
                transformOrigin: "0 0",
              }}
            >
              <SliceMaskPreview
                sceneHandleRef={sceneHandleRef}
                sliceY={sliceY}
                widthPx={widthPx}
                heightPx={heightPx}
                className="w-full h-full [&>canvas]:block [&>canvas]:w-full [&>canvas]:h-full [&>canvas]:border-0 [&>canvas]:rounded-none [&>canvas]:shadow-none"
                materialSlots={materialSlots}
              />
            </div>
            {/* 경로 층 — CSS 확대하지 않고 같은 view 로 다시 그린다 */}
            <canvas
              ref={pathCanvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none"
            />
            <div className="absolute top-1 right-1 flex items-center gap-1 text-[11px]">
              <span className="px-1 rounded bg-black/60 text-gray-200 font-mono">
                ×{view.scale.toFixed(1)}
              </span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={resetView}
                disabled={!zoomed}
                className="px-1.5 rounded bg-black/60 text-gray-200 hover:bg-black/80 disabled:opacity-40 cursor-pointer disabled:cursor-default"
                title="확대·이동을 처음으로"
              >
                맞춤
              </button>
            </div>
          </div>
        </div>
      </div>

      {materialSlots ? (
        <p className="mt-3 text-xs text-gray-400 select-none flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span className="flex items-center gap-1">
            <LegendSwatch slot="A" /> 주황 = 재료 A(T0)
          </span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <LegendSwatch slot="B" /> 보라 = 재료 B(T1)
          </span>
          {/* 데모 수정 1차 ⑤ — 캡션의 해상도(가로×세로 px) 표기 삭제(리드 10/12). 래스터 상한 512 는 그대로. */}
          <span>· 겹친 곳은 B</span>
        </p>
      ) : (
        <p className="mt-3 text-xs text-gray-400 select-none">
          단면 마스크 (흰 = 노광 영역)
        </p>
      )}
      {pathTools &&
        (task0Path ? (
          drawPath && (
            <p className="mt-1 text-xs text-gray-400 select-none flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <span className="flex items-center gap-1">
                <PathSwatch color={TASK0_SLOT_COLOR_HEX.A} kind="band" /> 주황 띠 = T0 도포
              </span>
              {task0Path.usesT1 && (
                <span className="flex items-center gap-1">
                  · <PathSwatch color={TASK0_SLOT_COLOR_HEX.B} kind="band" /> 보라 띠 = T1 도포
                </span>
              )}
              <span className="flex items-center gap-1">
                · <PathSwatch color={TASK0_PATH_STYLE.travelColor} kind="line" /> 가는 선 = 트래블
              </span>
              <span className="flex items-center gap-1">
                · <PathSwatch color={TASK0_PATH_STYLE.nozzleColor} kind="dot" /> 빨간 점 = 노즐
              </span>
            </p>
          )
        ) : (
          <p className="mt-1 text-xs text-gray-500 select-none text-center">
            경로 없음 — run.gcode 를 내보내면 보입니다 (「run.gcode 만」 내보내기 — job.zip 내보내기는 경로를 남기지 않습니다)
          </p>
        ))}
    </section>
  );
}
