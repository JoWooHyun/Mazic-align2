import type { GizmoMode } from './STLViewer';

interface ToolbarProps {
  activeMode: GizmoMode;
  onModeChange: (mode: GizmoMode) => void;
  className?: string;
}

const tools: { mode: GizmoMode; label: string; shortcut: string; icon: JSX.Element }[] = [
  {
    mode: 'select',
    label: 'Select',
    shortcut: 'Q',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
      </svg>
    ),
  },
  {
    mode: 'move',
    label: 'Move',
    shortcut: 'W',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 13l-5 5m0 0l-5-5" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12H3m18 0h-2" />
      </svg>
    ),
  },
  {
    mode: 'rotate',
    label: 'Rotate',
    shortcut: 'E',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
  {
    mode: 'scale',
    label: 'Scale',
    shortcut: 'R',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
      </svg>
    ),
  },
];

const Toolbar: React.FC<ToolbarProps> = ({ activeMode, onModeChange, className = '' }) => {
  return (
    <div className={`flex flex-col space-y-1 bg-gray-800 bg-opacity-90 rounded-lg p-1.5 ${className}`}>
      {tools.map((tool) => {
        const isActive = activeMode === tool.mode;
        return (
          <button
            key={tool.mode}
            onClick={() => onModeChange(tool.mode)}
            className={`p-2 rounded-md transition-colors ${
              isActive
                ? 'bg-primary-600 text-white'
                : 'text-gray-400 hover:bg-gray-700 hover:text-white'
            }`}
            title={`${tool.label} (${tool.shortcut})`}
            aria-label={tool.label}
          >
            {tool.icon}
          </button>
        );
      })}
    </div>
  );
};

export default Toolbar;
