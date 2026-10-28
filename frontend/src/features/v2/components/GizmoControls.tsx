import type { GizmoMode } from "./BabylonScene";

interface GizmoControlsProps {
  mode: GizmoMode;
  onChange: (mode: GizmoMode) => void;
  /** 단일 선택이 아니면 비활성 안내. */
  enabled: boolean;
  className?: string;
}

/**
 * 좌측 상단 작은 Gizmo 모드 토글 (None / Move / Rotate / Scale).
 * 단일 선택일 때만 동작한다.
 */
const GizmoControls: React.FC<GizmoControlsProps> = ({
  mode,
  onChange,
  enabled,
  className = "",
}) => {
  return (
    <div
      className={`flex items-stretch bg-white/95 backdrop-blur rounded-md shadow border border-gray-200 text-xs overflow-hidden ${className}`}
    >
      <Btn
        active={mode === "none"}
        disabled={false}
        onClick={() => onChange("none")}
        label="끄기"
      />
      <Btn
        active={mode === "translate"}
        disabled={!enabled}
        onClick={() => onChange("translate")}
        label="이동"
      />
      <Btn
        active={mode === "rotate"}
        disabled={!enabled}
        onClick={() => onChange("rotate")}
        label="회전"
      />
      <Btn
        active={mode === "scale"}
        disabled={!enabled}
        onClick={() => onChange("scale")}
        label="배율"
      />
    </div>
  );
};

interface BtnProps {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}

function Btn({ active, disabled, onClick, label }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 transition-colors border-r border-gray-200 last:border-r-0 ${
        active
          ? "bg-primary-600 text-white"
          : disabled
          ? "text-gray-300 cursor-not-allowed"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

export default GizmoControls;
