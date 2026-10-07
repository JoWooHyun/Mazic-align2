// 슬라이스 미리보기 모드의 우측 2D 단면 패널 (1단계).
//
// 기존 `SliceMaskPreview` 를 그대로 재사용하고 크기만 키운다.
//
// ⚠️ **성능 상한 고정**: `getSliceMask` 는 메인스레드 **동기** 호출이라
//   픽셀 수를 컨테이너 크기에 맞춰 무한정 키우면 층 스크럽이 뚝뚝 끊긴다.
//   그래서 래스터 해상도는 긴 변 512px 상한으로 **고정**하고, 컨테이너가
//   그보다 크면 CSS(`max-w-full max-h-full` + object-contain 대용 wrapper)로
//   확대 표시만 한다. 해상도 자동 적응은 2단계 과제.
//
// Task0 2재료(D2): materialSlots 가 있으면(슬라이스 화면 + Task0 2재료) 단면을 재료 색으로 — 재료 A 주황 / B 보라 /
//   겹친 곳 B(writer 와 같은 B 우선) / 빈 곳 검정, 아래에 범례. 래스터 2회(합집합 + B)라 상한 512px 그대로 둔다.

import SliceMaskPreview from "../../../components/SliceMaskPreview";
import type { BabylonSceneHandle } from "../../../components/BabylonScene";
import { TASK0_SLOT_COLOR_HEX } from "../../../utils/task0/task0-material";
import type { Task0MaterialSlot } from "../../../utils/task0/task0-slice";

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

export default function SliceSectionPane({
  sceneHandleRef,
  sliceY,
  lcdWidthPx,
  lcdHeightPx,
  materialSlots = null,
}: SliceSectionPaneProps) {
  // LCD 종횡비를 유지한 채 긴 변을 MASK_MAX_PX 로 맞춘다 — 단면이 프린터
  //   화면과 같은 비율로 보이게. 프로파일 값이 이상하면 정사각으로 폴백.
  const w = lcdWidthPx > 0 ? lcdWidthPx : MASK_MAX_PX;
  const h = lcdHeightPx > 0 ? lcdHeightPx : MASK_MAX_PX;
  const scale = MASK_MAX_PX / Math.max(w, h);
  const widthPx = Math.max(1, Math.round(w * scale));
  const heightPx = Math.max(1, Math.round(h * scale));

  return (
    <section className="flex-1 min-w-0 bg-gray-900 flex flex-col items-center justify-center p-4">
      <SliceMaskPreview
        sceneHandleRef={sceneHandleRef}
        sliceY={sliceY}
        widthPx={widthPx}
        heightPx={heightPx}
        className="max-w-full max-h-full flex items-center justify-center [&>canvas]:max-w-full [&>canvas]:max-h-full [&>canvas]:object-contain"
        materialSlots={materialSlots}
      />
      {materialSlots ? (
        <p className="mt-3 text-xs text-gray-400 select-none flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <span className="flex items-center gap-1">
            <LegendSwatch slot="A" /> 주황 = 재료 A(T0)
          </span>
          <span>·</span>
          <span className="flex items-center gap-1">
            <LegendSwatch slot="B" /> 보라 = 재료 B(T1)
          </span>
          <span>· 겹친 곳은 B · {widthPx}×{heightPx}px</span>
        </p>
      ) : (
        <p className="mt-3 text-xs text-gray-400 select-none">
          LCD 1bpp 마스크 (흰 = 모델 영역) · {widthPx}×{heightPx}px
        </p>
      )}
    </section>
  );
}
