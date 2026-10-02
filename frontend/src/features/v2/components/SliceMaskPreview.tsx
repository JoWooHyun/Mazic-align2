import { useEffect, useRef } from "react";

import type { BabylonSceneHandle } from "./BabylonScene";

interface SliceMaskPreviewProps {
  sceneHandleRef: React.RefObject<BabylonSceneHandle | null>;
  sliceY: number;
  /** 미니맵 픽셀 크기. */
  widthPx?: number;
  heightPx?: number;
  className?: string;
}

/**
 * 슬라이스 평면의 1bpp 마스크를 canvas 로 미리보기.
 *
 * 흰색 = 모델/서포트가 있는 영역 (LCD 가 빛을 막을 곳), 검정 = 빈
 * 곳 (빛이 통과). 내보내는 마스크 ZIP 의 레이어 PNG 도 같은 색 매핑.
 */
const SliceMaskPreview: React.FC<SliceMaskPreviewProps> = ({
  sceneHandleRef,
  sliceY,
  widthPx = 320,
  heightPx = 200,
  className = "",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = sceneHandleRef.current;
    if (!handle) return;

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
  }, [sceneHandleRef, sliceY, widthPx, heightPx]);

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        width={widthPx}
        height={heightPx}
        className="border border-gray-300 rounded shadow-sm"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
};

export default SliceMaskPreview;
