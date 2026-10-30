import { useEffect, useRef } from "react";

import type { BabylonSceneHandle } from "./BabylonScene";
import { materialLabelRgb } from "../utils/slice-material-mask";
import type { Task0MaterialSlot } from "../utils/task0/task0-slice";

interface SliceMaskPreviewProps {
  sceneHandleRef: React.RefObject<BabylonSceneHandle | null>;
  sliceY: number;
  /** 미니맵 픽셀 크기. */
  widthPx?: number;
  heightPx?: number;
  className?: string;
  /**
   * Task0 2재료 (D2) — STL id → 재료 슬롯. 있으면 재료 색으로 그린다(재료 A 주황 / B 보라 / 겹친 곳 B / 빈 곳 검정 —
   * handle getSliceMaterialMask). 없으면 지금까지의 1bpp 흑백 마스크 그대로.
   */
  materialSlots?: Readonly<Record<string, Task0MaterialSlot>> | null;
  /**
   * true 면 canvas 를 부드럽게(imageRendering auto) 줄여 보인다 — 래스터가 화면 픽셀보다 촘촘할 때(1024 래스터를
   *   작은 박스에 띄울 때) pixelated(최근접) 축소는 1~2 px 짜리 얇은 벽을 통째로 건너뛸 수 있어서. 기본 false = 종전 pixelated.
   */
  smooth?: boolean;
}

/**
 * 슬라이스 평면의 1bpp 마스크를 canvas 로 미리보기.
 *
 * 흰색 = 모델/서포트가 있는 영역 (LCD 가 빛을 막을 곳), 검정 = 빈
 * 곳 (빛이 통과). 내보내는 마스크 ZIP 의 레이어 PNG 도 같은 색 매핑.
 *
 * Task0 2재료(D2 — materialSlots 가 있을 때)는 같은 영역을 재료 색으로 칠한다(라벨 ≠ 0 인 픽셀 = 흑백 마스크의 흰 픽셀).
 * 래스터는 합집합 + 재료 B 두 번(utils/slice-material-mask) — 메인스레드 동기 호출이라 해상도 상한은 부르는 쪽 그대로.
 */
const SliceMaskPreview: React.FC<SliceMaskPreviewProps> = ({
  sceneHandleRef,
  sliceY,
  widthPx = 320,
  heightPx = 200,
  className = "",
  materialSlots = null,
  smooth = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = sceneHandleRef.current;
    if (!handle) return;

    // Task0 2재료 (D2) — 재료 색 라벨 마스크 (0 빈 곳 / 1 A / 2 B)
    if (materialSlots) {
      const labels = handle.getSliceMaterialMask(sliceY, widthPx, heightPx, materialSlots);
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      const palette = [materialLabelRgb(0), materialLabelRgb(1), materialLabelRgb(2)];
      const img = ctx2d.createImageData(labels.width, labels.height);
      for (let i = 0; i < labels.data.length; i++) {
        const [r, g, b] = palette[labels.data[i]] ?? palette[0];
        const off = i * 4;
        img.data[off + 0] = r;
        img.data[off + 1] = g;
        img.data[off + 2] = b;
        img.data[off + 3] = 255;
      }
      ctx2d.putImageData(img, 0, 0);
      return;
    }

    const mask = handle.getSliceMask(sliceY, widthPx, heightPx);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = ctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const v = mask.data[i] ? 255 : 0;
      const off = i * 4;
      img.data[off + 0] = v;
      img.data[off + 1] = v;
      img.data[off + 2] = v;
      img.data[off + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [sceneHandleRef, sliceY, widthPx, heightPx, materialSlots]);

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        width={widthPx}
        height={heightPx}
        className="border border-gray-300 rounded shadow-sm"
        style={{ imageRendering: smooth ? "auto" : "pixelated" }}
      />
    </div>
  );
};

export default SliceMaskPreview;
