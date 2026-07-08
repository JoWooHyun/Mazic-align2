export type EditMode = "select" | "support" | "dental-brush";

interface EditModeControlsProps {
  mode: EditMode;
  onChange: (mode: EditMode) => void;
  className?: string;
}

/**
 * 좌상단 (GizmoControls 아래) 작은 모드 토글.
 * 'Select' = 모델 선택/이동/Gizmo 활성.
 * 'Support' = 모델 표면 클릭 → 서포트 추가, 기둥 클릭 → 삭제.
 *             선택·드래그·Gizmo 는 모두 비활성.
 * 'Dental' = 브러쉬로 표면 영역 색칠 (마스크). 마진/아일랜드 검출 입력용.
 *            선택·드래그·Gizmo 는 모두 비활성.
 */
const EditModeControls: React.FC<EditModeControlsProps> = ({
  mode,
  onChange,
  className = "",
}) => {
  return (
    <div
      className={`flex items-stretch bg-white/95 backdrop-blur rounded-md shadow border border-gray-200 text-xs overflow-hidden ${className}`}
    >
      <Btn
        active={mode === "select"}
        onClick={() => onChange("select")}
        label="Select"
      />
      <Btn
        active={mode === "support"}
        onClick={() => onChange("support")}
        label="Support"
      />
      <Btn
        active={mode === "dental-brush"}
        onClick={() => onChange("dental-brush")}
        label="Dental"
      />
    </div>
  );
};

function Btn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 transition-colors border-r border-gray-200 last:border-r-0 ${
        active
          ? "bg-primary-600 text-white"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

export default EditModeControls;
