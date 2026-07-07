import type { ViewMode } from './STLViewer';

interface ViewerControlsProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetView?: () => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  className?: string;
}

const viewModeConfig: { mode: ViewMode; label: string; icon: JSX.Element }[] = [
  {
    mode: 'solid',
    label: 'Solid',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
  },
  {
    mode: 'wireframe',
    label: 'Wireframe',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 12h16M12 4v16M4 5l8 7m0 0l8-7M4 19l8-7m0 0l8 7" />
      </svg>
    ),
  },
  {
    mode: 'xray',
    label: 'X-Ray',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
      </svg>
    ),
  },
];

/**
 * 뷰어 컨트롤 컴포넌트
 * 3D 뷰어의 줌, 리셋 등 제어 버튼 제공
 */
const ViewerControls: React.FC<ViewerControlsProps> = ({
  onZoomIn,
  onZoomOut,
  onResetView,
  viewMode = 'solid',
  onViewModeChange,
  className = '',
}) => {
  const buttonClass =
    'p-3 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 transition-colors';

  return (
    <div className={`flex flex-col space-y-2 ${className}`}>
      {/* 줌 인 */}
      {onZoomIn && (
        <button
          onClick={onZoomIn}
          className={buttonClass}
          title="Zoom In"
          aria-label="Zoom In"
        >
          <svg
            className="w-5 h-5 text-gray-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"
            />
          </svg>
        </button>
      )}

      {/* 줌 아웃 */}
      {onZoomOut && (
        <button
          onClick={onZoomOut}
          className={buttonClass}
          title="Zoom Out"
          aria-label="Zoom Out"
        >
          <svg
            className="w-5 h-5 text-gray-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"
            />
          </svg>
        </button>
      )}

      {/* 뷰 리셋 */}
      {onResetView && (
        <button
          onClick={onResetView}
          className={buttonClass}
          title="Reset View"
          aria-label="Reset View"
        >
          <svg
            className="w-5 h-5 text-gray-700"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      )}

      {/* 뷰 모드 전환 */}
      {onViewModeChange && (
        <>
          <div className="border-t border-gray-200 my-1" />
          {viewModeConfig.map((cfg) => (
            <button
              key={cfg.mode}
              onClick={() => onViewModeChange(cfg.mode)}
              className={`p-3 rounded-lg shadow-sm transition-colors border ${
                viewMode === cfg.mode
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
              title={cfg.label}
              aria-label={cfg.label}
            >
              {cfg.icon}
            </button>
          ))}
        </>
      )}
    </div>
  );
};

export default ViewerControls;
