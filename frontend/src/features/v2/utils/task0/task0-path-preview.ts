/**
 * Task0 경로 미리보기 (P1) — run.gcode 텍스트 → 층별 이동(도포·트래블) → 2D 단면 위에 겹쳐 그리기 (순수 함수)
 *
 * 설계: `docs/계획_경로미리보기_20261019.md` §2 D1~D4·D8, §3 P1 (+ 구현 메모 P1 10/22 — 추출기 위치·줌·드래그).
 *
 * 경로의 출처 = 앱이 내려받게 한 **run.gcode 텍스트 그대로**(D1 — writer 를 따로 돌리지 않는다, 산출물 바이트 무관).
 *   층 분할·줄 정리는 Task0 파서 이식판(task0-gcode-parser, 드라이런·E 유지), 위치 추적 규칙은 커버리지 검사기의
 *   extractTask0DepositSegments(task0-coverage.ts)와 **같은 규칙**이다 — 도포 = X/Y 가 있는 이동 + 그 줄의 E 증가 > 0,
 *   그 밖의 X/Y 이동 = 트래블. 층 블록 시작 위치 = 파킹(규격 §9).
 *   한 가지 다름: T0/T1 줄 뒤 위치도 파킹으로 리셋한다(규격 v0.3.5 §6 툴 전환 매크로 — 리프트·파킹 후 복귀). 도포 선분은 같고
 *   전환 트래블의 출발점만 실제 기계 동작대로 (0,0) 이 된다. 계획서 D2 는 추출기를 task0-coverage.ts 에 두고 기존
 *   함수를 재정의하라고 했지만, 병렬 PR(§32 반영)이 그 파일을 고쳐 여기에 따로 둔다 — 두 추출기의 동치(deposit 만 거른
 *   결과 = extractTask0DepositSegments, JSON 같음)는 scripts/verify-task0-path-preview.mjs 가 파일 A·B·C·D 로 증명한다.
 *
 * 메모리(계획서 §5): 앱은 텍스트를 상태에 두지 않고 buildTask0PathPreview 결과(Float32Array·Uint8Array 한 벌)만 보관한다.
 *
 * 좌표:
 *   - G-code = 베드 mm. 베드 → 단면 마스크 px 는 래스터(utils/slice-rasterize rasterizePolygons)와 같은 식을
 *     bedToWorld 뒤에 합성한 것(bedToSectionPx) — px x = (wx + W/2)/W·Wpx, px y = (D/2 − wz)/D·Hpx (W·D = 플레이트).
 *     베드 Y = world Z 라 베드 Y 가 커지면 화면 위로 간다.
 *   - 단면 박스(확대 전 CSS px) u = px·boxW/Wpx — 마스크 canvas(Wpx×Hpx)를 박스에 늘린 것과 같은 비율.
 *   - 줌·이동(view) = 화면 = scale·u + (tx, ty). 마스크는 sectionViewCssTransform(같은 view)을 CSS transform 으로,
 *     경로 canvas 는 ctx.setTransform 으로 같은 변환을 써서 다시 그린다 → 두 층이 어긋날 수 없다(스크립트가 증명).
 *
 * 순수 TS — DOM/Babylon 의존 없음 (그리기는 최소 2D 컨텍스트 인터페이스만 받는다).
 */
import { parseGcodeText } from './task0-gcode-parser';
import { resolveTask0WriterParams, type Task0WriterOptions } from './task0-gcode-writer';
import { bedToWorld } from './task0-frame';
import { TASK0_SLOT_COLOR_HEX } from './task0-material';

// ==================== G-code → 이동 ====================

/** 이동 종류 — 도포(E 증가 > 0) / 트래블(그 밖의 X/Y 이동) */
export type Task0MoveKind = 'deposit' | 'travel';

/** 이동 하나 (베드 mm) */
export interface Task0PathMove {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 그 줄의 E 증가 (mm) — 트래블은 0 이하(E 없으면 0) */
  e: number;
  /** 툴 번호 (T0 = 0, T1 = 1) */
  tool: number;
  kind: Task0MoveKind;
}

export interface Task0MoveExtraction {
  /** 층별 이동 (인덱스 = 층 N, 파일 순서 그대로, 빈 층은 []) */
  layers: Task0PathMove[][];
  /** 첫 ;LAYER_CHANGE 전(프리앰블)의 X/Y 이동 수 */
  preambleMoves: number;
  /** Task0 파서(드라이런·E 유지) 경고 */
  parseWarnings: string[];
}

export interface Task0MoveOptions {
  /** 층 블록 시작 위치 = Task0 파킹 (mm) — 기본 writer 와 같은 값(resolveTask0WriterParams) */
  parkXMm?: number;
  parkYMm?: number;
}

type MoveVisitor = (
  layer: number,
  kind: Task0MoveKind,
  tool: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  e: number,
) => void;

/**
 * 블록을 돌며 X/Y 이동마다 visit 을 부른다 (layer = 층 번호, 프리앰블은 −1). 해석 규칙은
 * task0-coverage extractTask0DepositSegments 와 한 줄씩 같다(G0/G1·G90/91·M82/83·G92·T0/T1, 시작 G90·M82) —
 * T0/T1 뒤 파킹 리셋만 더했다(머리 주석).
 */
function walkTask0Moves(
  gcodeText: string,
  parkX: number,
  parkY: number,
  visit: MoveVisitor,
): { layerCount: number; parseWarnings: string[] } {
  const parsed = parseGcodeText(gcodeText, { mode: 'dryrun', keepE: true });

  // Klipper 기본 상태: G90(절대 좌표), M82(절대 E)
  let absCoord = true;
  let absExtrude = true;
  let x = parkX;
  let y = parkY;
  let ePos = 0;
  let tool = 0;
  let layerCount = 0;

  for (const blk of parsed.blocks) {
    const layer = blk.isLayer ? layerCount : -1;
    if (blk.isLayer) {
      x = parkX; // Task0 가 층 사이에 파킹 (규격 §9)
      y = parkY;
    }
    for (const raw of blk.gcode.split('\n')) {
      const line = raw.trim();
      if (line === '') continue;
      const toks = line.split(/\s+/);
      const cmd = toks[0].toUpperCase();
      const args = new Map<string, number>();
      for (const t of toks.slice(1)) args.set(t[0].toUpperCase(), Number(t.slice(1)));
      if (cmd === 'G0' || cmd === 'G1') {
        const relE = !absCoord || !absExtrude;
        const nx = args.has('X') ? (absCoord ? 0 : x) + (args.get('X') as number) : x;
        const ny = args.has('Y') ? (absCoord ? 0 : y) + (args.get('Y') as number) : y;
        let de = 0;
        if (args.has('E')) {
          const ev = args.get('E') as number;
          de = relE ? ev : ev - ePos;
          ePos = relE ? ePos + ev : ev;
        }
        if (args.has('X') || args.has('Y')) {
          visit(layer, de > 0 ? 'deposit' : 'travel', tool, x, y, nx, ny, de);
        }
        x = nx;
        y = ny;
      } else if (cmd === 'G90') absCoord = true;
      else if (cmd === 'G91') absCoord = false;
      else if (cmd === 'M82') absExtrude = true;
      else if (cmd === 'M83') absExtrude = false;
      else if (cmd === 'G92') {
        if (args.size === 0) {
          x = 0;
          y = 0;
          ePos = 0;
        } else {
          if (args.has('X')) x = args.get('X') as number;
          if (args.has('Y')) y = args.get('Y') as number;
          if (args.has('E')) ePos = args.get('E') as number;
        }
      } else if (cmd === 'T0' || cmd === 'T1') {
        tool = cmd === 'T1' ? 1 : 0;
        // 툴 전환 매크로가 리프트·파킹 뒤 돌아온다(규격 v0.3.5 §6 — §32 반영) → 전환 뒤 첫 이동은 파킹에서 출발.
        //   커버리지 추출기(extractTask0DepositSegments)는 이 리셋이 없지만 도포 선분은 같다(전환 뒤 첫 이동은 트래블 —
        //   verify-task0-path-preview (1) 동치·전환 단언). 그려지는 전환 트래블만 실제 기계 경로대로 바뀐다.
        x = parkX;
        y = parkY;
      }
    }
    if (blk.isLayer) layerCount++;
  }
  return { layerCount, parseWarnings: parsed.warnings };
}

/**
 * G-code 텍스트 → 층별 이동(도포 + 트래블, 파일 순서). 객체 배열이라 큰 파일에서는 무겁다 — 검증·대조용.
 * 앱은 buildTask0PathPreview(같은 해석, 타입 배열)를 쓴다.
 */
export function extractTask0Moves(gcodeText: string, options: Task0MoveOptions = {}): Task0MoveExtraction {
  const d = resolveTask0WriterParams();
  const parkX = options.parkXMm ?? d.parkXMm;
  const parkY = options.parkYMm ?? d.parkYMm;
  const layers: Task0PathMove[][] = [];
  let preambleMoves = 0;
  const { layerCount, parseWarnings } = walkTask0Moves(gcodeText, parkX, parkY, (layer, kind, tool, x0, y0, x1, y1, e) => {
    if (layer < 0) {
      preambleMoves++;
      return;
    }
    while (layers.length <= layer) layers.push([]);
    layers[layer].push({ x0, y0, x1, y1, e, tool, kind });
  });
  while (layers.length < layerCount) layers.push([]);
  return { layers, preambleMoves, parseWarnings };
}

// ==================== 앱 보관용 (타입 배열) ====================

/** flags 비트 — 도포 */
export const TASK0_MOVE_FLAG_DEPOSIT = 1;
/** flags 비트 — T1 (없으면 T0) */
export const TASK0_MOVE_FLAG_T1 = 2;

/**
 * 앱이 보관하는 경로 (run.gcode 텍스트는 버린다 — 계획서 §5 메모리).
 * 층 i 의 이동 = 인덱스 [layerStart[i], layerStart[i + 1]). 좌표는 베드 mm (float32 — 화면 표시용 정밀도).
 */
export interface Task0PathPreview {
  layerCount: number;
  /** 길이 layerCount + 1 */
  layerStart: Uint32Array;
  /** 이동마다 x0, y0, x1, y1 (길이 4 × 이동 수) */
  xy: Float32Array;
  /** 이동마다 TASK0_MOVE_FLAG_* 비트 */
  flags: Uint8Array;
  /** 전체 이동 수 / 그중 도포 수 */
  moveCount: number;
  depositCount: number;
  /** T1 도포가 하나라도 있는지 (범례 표시용) */
  usesT1: boolean;
  /** 층 시작 위치 = 파킹 (베드 mm) — 진행률 0 % 의 노즐 */
  parkXMm: number;
  parkYMm: number;
  /** 도포폭 w (mm) — 비드 폭으로 그린다 */
  depositWidthMm: number;
  /** G-code 의 베드 크기 (writer 와 같은 값 — world ↔ 베드) */
  bedWidthMm: number;
  bedDepthMm: number;
  /** 단면 래스터의 플레이트 크기 (getSliceMask 의 plateWRef/plateDRef 와 같은 출처 — 프로파일 buildVolumeMm) */
  plateWidthMm: number;
  plateDepthMm: number;
}

export interface Task0PathPreviewInput {
  /** writer 옵션 (앱: task0WriterOptionsForProfile(printerProfile)) — 도포폭·파킹·베드는 resolveTask0WriterParams 로 */
  writer?: Task0WriterOptions;
  /** 단면 래스터 플레이트 크기 (mm) — 앱: printerProfile.buildVolumeMm[0]·[1] (= 씬 plateWRef/plateDRef) */
  plateWidthMm: number;
  plateDepthMm: number;
}

/** 자라는 Float32Array (두 배씩) */
class F32Builder {
  buf = new Float32Array(1024);
  len = 0;
  push4(a: number, b: number, c: number, d: number): void {
    if (this.len + 4 > this.buf.length) {
      const next = new Float32Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = a;
    this.buf[this.len++] = b;
    this.buf[this.len++] = c;
    this.buf[this.len++] = d;
  }
}

/** 자라는 Uint8Array (두 배씩) */
class U8Builder {
  buf = new Uint8Array(256);
  len = 0;
  push(v: number): void {
    if (this.len >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
}

/** run.gcode 텍스트 → 앱 보관용 경로 (extractTask0Moves 와 같은 해석, 프리앰블 이동은 버린다) */
export function buildTask0PathPreview(gcodeText: string, input: Task0PathPreviewInput): Task0PathPreview {
  const p = resolveTask0WriterParams(input.writer ?? {});
  const xy = new F32Builder();
  const flags = new U8Builder();
  const starts: number[] = [];
  let depositCount = 0;
  let usesT1 = false;
  const { layerCount } = walkTask0Moves(gcodeText, p.parkXMm, p.parkYMm, (layer, kind, tool, x0, y0, x1, y1) => {
    if (layer < 0) return;
    while (starts.length <= layer) starts.push(flags.len);
    xy.push4(x0, y0, x1, y1);
    let f = 0;
    if (kind === 'deposit') {
      f |= TASK0_MOVE_FLAG_DEPOSIT;
      depositCount++;
      if (tool === 1) usesT1 = true;
    }
    if (tool === 1) f |= TASK0_MOVE_FLAG_T1;
    flags.push(f);
  });
  while (starts.length < layerCount) starts.push(flags.len);
  const layerStart = new Uint32Array(layerCount + 1);
  for (let i = 0; i < layerCount; i++) layerStart[i] = starts[i];
  layerStart[layerCount] = flags.len;
  return {
    layerCount,
    layerStart,
    // 남는 꼬리를 잘라 보관 (slice = 복사 — 자라던 버퍼는 버려진다)
    xy: xy.buf.slice(0, xy.len),
    flags: flags.buf.slice(0, flags.len),
    moveCount: flags.len,
    depositCount,
    usesT1,
    parkXMm: p.parkXMm,
    parkYMm: p.parkYMm,
    depositWidthMm: p.depositWidthMm,
    bedWidthMm: p.bedWidthMm,
    bedDepthMm: p.bedDepthMm,
    plateWidthMm: input.plateWidthMm,
    plateDepthMm: input.plateDepthMm,
  };
}

/** 층 N 의 이동 수 (범위 밖 층은 0) */
export function task0LayerMoveCount(path: Task0PathPreview, layer: number): number {
  if (!(layer >= 0 && layer < path.layerCount)) return 0;
  return path.layerStart[layer + 1] - path.layerStart[layer];
}

// ==================== 진행률 ====================

/** 진행률 p % (0~100) → 보일 이동 수 = ⌊p·n/100⌋ (범위 밖은 자름) */
export function task0ShownMovesForPercent(n: number, percent: number): number {
  const p = Math.min(100, Math.max(0, percent));
  return Math.min(n, Math.max(0, Math.floor((p * n) / 100)));
}

/**
 * 이동 shown 개를 그렸을 때 노즐 위치 (베드 mm) — 0 이면 파킹, 아니면 이동 shown 번째(1-based)의 끝점.
 * 층에 이동이 없으면 파킹.
 */
export function task0NozzleAt(path: Task0PathPreview, layer: number, shown: number): [number, number] {
  const n = task0LayerMoveCount(path, layer);
  const k = Math.min(n, Math.max(0, Math.floor(shown)));
  if (k === 0) return [path.parkXMm, path.parkYMm];
  const i = path.layerStart[layer] + k - 1;
  return [path.xy[4 * i + 2], path.xy[4 * i + 3]];
}

// ==================== 좌표 ====================

/** 베드 → 단면 px 에 필요한 값 */
export interface Task0SectionFrame {
  bedWidthMm: number;
  bedDepthMm: number;
  plateWidthMm: number;
  plateDepthMm: number;
  /** 단면 마스크 canvas 픽셀 수 (SliceSectionPane widthPx·heightPx) */
  widthPx: number;
  heightPx: number;
}

/**
 * 베드 (X, Y) mm → 단면 마스크 px (x, y) — rasterizePolygons 의 world → px 식(slice-rasterize.ts)에 bedToWorld 를 합성.
 * 픽셀 (c, r) 은 [c, c+1) × [r, r+1) 을 덮는다 (중심 = c + 0.5).
 */
export function bedToSectionPx(bedX: number, bedY: number, f: Task0SectionFrame): [number, number] {
  const [wx, wz] = bedToWorld(bedX, bedY, f.bedWidthMm, f.bedDepthMm);
  return [
    ((wx + f.plateWidthMm / 2) / f.plateWidthMm) * f.widthPx,
    ((f.plateDepthMm / 2 - wz) / f.plateDepthMm) * f.heightPx,
  ];
}

// ==================== 줌·이동 (view) ====================

/** 화면 = scale·u + (tx, ty) — u = 단면 박스의 확대 전 CSS px, (tx, ty) 도 CSS px */
export interface SectionView {
  scale: number;
  tx: number;
  ty: number;
}

export const SECTION_VIEW_IDENTITY: SectionView = Object.freeze({ scale: 1, tx: 0, ty: 0 });
/** 확대 배율 범위 */
export const SECTION_ZOOM_MIN = 1;
export const SECTION_ZOOM_MAX = 20;
/** 휠 한 칸 배율 */
export const SECTION_ZOOM_STEP = 1.2;

/** 배율을 [MIN, MAX] 로, 이동은 확대된 내용이 박스를 늘 덮도록(빈 테두리가 안 보이게) 자른다 */
export function clampSectionView(v: SectionView, boxW: number, boxH: number): SectionView {
  const s = Math.min(SECTION_ZOOM_MAX, Math.max(SECTION_ZOOM_MIN, Number.isFinite(v.scale) ? v.scale : 1));
  const clampT = (t: number, size: number): number => {
    const lo = size * (1 - s);
    if (!Number.isFinite(t)) return 0;
    return Math.min(0, Math.max(lo, t));
  };
  return { scale: s, tx: clampT(v.tx, boxW), ty: clampT(v.ty, boxH) };
}

/**
 * 커서 (cx, cy)(박스 안 CSS px) 기준 확대 — 커서 아래의 점이 확대 뒤에도 커서 아래에 남는다(배율·이동 자르기 전).
 * factor > 1 확대, < 1 축소.
 */
export function zoomSectionViewAt(
  v: SectionView,
  cx: number,
  cy: number,
  factor: number,
  boxW: number,
  boxH: number,
): SectionView {
  const cur = clampSectionView(v, boxW, boxH);
  const s = Math.min(SECTION_ZOOM_MAX, Math.max(SECTION_ZOOM_MIN, cur.scale * factor));
  const k = s / cur.scale;
  return clampSectionView({ scale: s, tx: cx - k * (cx - cur.tx), ty: cy - k * (cy - cur.ty) }, boxW, boxH);
}

/** 드래그 (dx, dy) CSS px 만큼 이동 */
export function panSectionView(v: SectionView, dx: number, dy: number, boxW: number, boxH: number): SectionView {
  const cur = clampSectionView(v, boxW, boxH);
  return clampSectionView({ scale: cur.scale, tx: cur.tx + dx, ty: cur.ty + dy }, boxW, boxH);
}

/** 확대 전 박스 좌표 (u, v) → 화면(박스 안 CSS px) */
export function applySectionView(view: SectionView, u: number, v: number): [number, number] {
  return [view.scale * u + view.tx, view.scale * v + view.ty];
}

/** 마스크 층 CSS transform (transform-origin 0 0 과 함께) — applySectionView 와 같은 변환 */
export function sectionViewCssTransform(view: SectionView): string {
  return `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
}

// ==================== 그리기 ====================

/** 그리기 규약 (계획서 D4) — 화면 전용 색 */
export const TASK0_PATH_STYLE = Object.freeze({
  /** 도포 띠 알파 */
  depositAlpha: 0.85,
  /** 트래블 — 회청색 반투명 1 px */
  travelColor: 'rgba(148, 163, 184, 0.5)',
  travelWidthPx: 1,
  /** 노즐 — 빨간 점 반지름 (화면 px) */
  nozzleColor: '#EF4444',
  nozzleRadiusPx: 4,
  /** 도포 띠가 화면에서 이보다 얇으면 이 폭 (px) */
  minDepositWidthPx: 1,
});

/** 툴 → 도포 띠 색 (재료 색과 같은 값 — T0 = A 주황, T1 = B 보라) */
export function task0ToolColorHex(tool: number): string {
  return tool === 1 ? TASK0_SLOT_COLOR_HEX.B : TASK0_SLOT_COLOR_HEX.A;
}

/** 경로 그리기가 쓰는 2D 컨텍스트 부분 (CanvasRenderingContext2D 의 부분집합 — 스크립트는 기록용 가짜를 넘긴다) */
export interface Task0PathCtx {
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fill(): void;
}

export interface Task0PathDrawParams {
  path: Task0PathPreview;
  layer: number;
  /** 그릴 이동 수 (0 ~ 층 이동 수). 층 이동 수와 같으면 노즐을 숨긴다 */
  shown: number;
  /** 단면 마스크 canvas 픽셀 수 */
  widthPx: number;
  heightPx: number;
  /** 단면 박스 CSS 크기 (확대 전) */
  boxW: number;
  boxH: number;
  /** 현재 view 배율 — 선 폭·노즐 반지름을 화면 px 로 맞추는 데만 쓴다(변환 자체는 호출자가 ctx 에 건다) */
  scale: number;
}

/**
 * 층 하나의 경로를 **확대 전 박스 좌표 u** 로 그린다. 호출자는 ctx.setTransform(dpr·scale, 0, 0, dpr·scale, dpr·tx, dpr·ty)
 * 를 먼저 건다 → 화면 = applySectionView(view, u). 선 폭은 u 단위라 화면 px 로 원하는 값 ÷ scale.
 * 같은 (종류·툴) 이 이어지는 구간은 경로 하나로 묶어 한 번에 그린다(겹친 곳 알파가 두 번 쌓이지 않음).
 */
export function drawTask0PathLayer(ctx: Task0PathCtx, d: Task0PathDrawParams): void {
  const { path } = d;
  const n = task0LayerMoveCount(path, d.layer);
  const shown = Math.min(n, Math.max(0, Math.floor(d.shown)));
  const frame: Task0SectionFrame = {
    bedWidthMm: path.bedWidthMm,
    bedDepthMm: path.bedDepthMm,
    plateWidthMm: path.plateWidthMm,
    plateDepthMm: path.plateDepthMm,
    widthPx: d.widthPx,
    heightPx: d.heightPx,
  };
  const kx = d.boxW / d.widthPx;
  const ky = d.boxH / d.heightPx;
  const toU = (bx: number, by: number): [number, number] => {
    const [px, py] = bedToSectionPx(bx, by, frame);
    return [px * kx, py * ky];
  };
  const scale = d.scale > 0 ? d.scale : 1;
  // 1 mm 의 박스 u 길이 — 가로·세로 비율이 아주 조금 다를 수 있어(플레이트 종횡비 ≠ 마스크 종횡비) 기하 평균
  const uPerMm = Math.sqrt(((d.widthPx / path.plateWidthMm) * kx) * ((d.heightPx / path.plateDepthMm) * ky));
  const depositWidthU = Math.max(path.depositWidthMm * uPerMm, TASK0_PATH_STYLE.minDepositWidthPx / scale);
  const travelWidthU = TASK0_PATH_STYLE.travelWidthPx / scale;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const base = path.layerStart[d.layer] ?? 0;
  let i = 0;
  while (i < shown) {
    const f = path.flags[base + i];
    let j = i;
    ctx.beginPath();
    let lastX = NaN;
    let lastY = NaN;
    while (j < shown && path.flags[base + j] === f) {
      const o = 4 * (base + j);
      const [ax, ay] = toU(path.xy[o], path.xy[o + 1]);
      const [bx, by] = toU(path.xy[o + 2], path.xy[o + 3]);
      if (ax !== lastX || ay !== lastY) ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      lastX = bx;
      lastY = by;
      j++;
    }
    if ((f & TASK0_MOVE_FLAG_DEPOSIT) !== 0) {
      ctx.globalAlpha = TASK0_PATH_STYLE.depositAlpha;
      ctx.strokeStyle = task0ToolColorHex((f & TASK0_MOVE_FLAG_T1) !== 0 ? 1 : 0);
      ctx.lineWidth = depositWidthU;
    } else {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = TASK0_PATH_STYLE.travelColor;
      ctx.lineWidth = travelWidthU;
    }
    ctx.stroke();
    i = j;
  }
  ctx.globalAlpha = 1;
  // 노즐 — 진행 끝점(0 이면 파킹). 전부 그렸으면 숨긴다(v1 과 같음). 이동이 없는 층도 숨긴다.
  if (n > 0 && shown < n) {
    const [nx, ny] = task0NozzleAt(path, d.layer, shown);
    const [ux, uy] = toU(nx, ny);
    ctx.beginPath();
    ctx.fillStyle = TASK0_PATH_STYLE.nozzleColor;
    ctx.arc(ux, uy, TASK0_PATH_STYLE.nozzleRadiusPx / scale, 0, Math.PI * 2);
    ctx.fill();
  }
}
