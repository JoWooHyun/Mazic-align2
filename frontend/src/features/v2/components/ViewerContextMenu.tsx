import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface Props {
  /** 화면(뷰포트) 좌표 X (px). */
  x: number;
  /** 화면(뷰포트) 좌표 Y (px). */
  y: number;
  /** 열림 여부. false 면 렌더하지 않는다. */
  open: boolean;
  /** 바깥 클릭 / Esc / 스크롤 / 항목 실행 시 닫기. */
  onClose: () => void;
  /** 메뉴 항목 목록 (P5: 삭제 / 복제 / 줌투핏). */
  items: ContextMenuItem[];
}

/**
 * 뷰포트 우클릭 컨텍스트 메뉴 (프루사 정합 P5).
 * (x, y) 화면 좌표에 절대 위치로 뜬다. 화면 경계를 넘으면 좌/상으로 뒤집어 보정.
 * 바깥 클릭 · Esc · 스크롤 시 닫힌다.
 */
const ViewerContextMenu: React.FC<Props> = ({
  x,
  y,
  open,
  onClose,
  items,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  // 실제 렌더 위치 (경계 보정 후). 초기엔 요청 좌표.
  const [pos, setPos] = useState({ x, y });

  // 열릴 때마다 요청 좌표로 초기화 후, 메쉬 크기 측정해 경계 보정.
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 오른쪽/아래로 넘치면 좌/상으로 뒤집는다 (간단 보정).
    const nextX = x + rect.width > vw ? Math.max(0, x - rect.width) : x;
    const nextY = y + rect.height > vh ? Math.max(0, y - rect.height) : y;
    setPos({ x: nextX, y: nextY });
  }, [open, x, y]);

  // 바깥 클릭 · Esc · 스크롤 시 닫기.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    // capture 로 등록해 다른 핸들러보다 먼저 닫힌다.
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[140px] py-1 bg-white rounded-md shadow-xl border border-gray-200 text-sm"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
          className="w-full px-3 py-1.5 text-left text-gray-700 hover:bg-gray-100 disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-default"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};

export default ViewerContextMenu;
