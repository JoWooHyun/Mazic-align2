import type { ViewPreset } from "../utils/camera-views";

interface ViewControlsProps {
  onSetView: (preset: ViewPreset) => void;
  onFit: () => void;
  className?: string;
}

/**
 * 뷰포트 우측 상단에 떠 있는 작은 카메라 컨트롤 바.
 * 옛 ViewerControls 와 무관하게 v2 안에서 다시 짠다.
 */
const ViewControls: React.FC<ViewControlsProps> = ({
  onSetView,
  onFit,
  className = "",
}) => {
  return (
    <div
      className={`flex flex-col items-stretch bg-white/95 backdrop-blur rounded-md shadow border border-gray-200 text-xs ${className}`}
    >
      <Btn label="Home" onClick={() => onSetView("home")} />
      <Btn label="Fit" onClick={onFit} />
      <Divider />
      <Btn label="Top" onClick={() => onSetView("top")} />
      <Btn label="Bottom" onClick={() => onSetView("bottom")} />
      <Btn label="Front" onClick={() => onSetView("front")} />
      <Btn label="Back" onClick={() => onSetView("back")} />
      <Btn label="Left" onClick={() => onSetView("left")} />
      <Btn label="Right" onClick={() => onSetView("right")} />
      <Divider />
      <Btn label="Iso" onClick={() => onSetView("iso")} />
    </div>
  );
};

function Btn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 text-gray-700 hover:bg-gray-100 transition-colors text-left"
    >
      {label}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-gray-200" />;
}

export default ViewControls;
