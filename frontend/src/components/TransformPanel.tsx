import { useState, useEffect, useRef } from 'react';
import { STLFile, AdjustmentType } from '@types/stl.types';

interface TransformPanelProps {
  selectedFile: STLFile | null;
  onTransformChange: (
    type: AdjustmentType,
    axis: 'x' | 'y' | 'z',
    value: number
  ) => void;
  onPreview?: (
    type: AdjustmentType,
    axis: 'x' | 'y' | 'z',
    value: number
  ) => void;
  onReset: () => void;
  gizmoActive: boolean; // 회전/이동 기즈모 표시 여부
  onToggleGizmo: () => void; // Rotation 버튼 토글
  className?: string;
}

/**
 * Transform 조정 패널 컴포넌트
 * STL 파일의 위치, 회전, 스케일 조정
 */
const TransformPanel: React.FC<TransformPanelProps> = ({
  selectedFile,
  onTransformChange,
  onPreview,
  onReset,
  gizmoActive,
  onToggleGizmo,
  className = '',
}) => {
  const [translation, setTranslation] = useState({ x: 0, y: 0, z: 0 });
  const [rotation, setRotation] = useState({ x: 0, y: 0, z: 0 });
  const [scale, setScale] = useState({ x: 1, y: 1, z: 1 });
  const [uniformScale, setUniformScale] = useState(true);

  // Dragging state to prevent spurious commits
  const isDragging = useRef(false);

  // Track last committed values to prevent duplicates
  const lastCommittedValues = useRef<{ [key: string]: number }>({});

  // 선택된 파일의 Transform 데이터 로드
  useEffect(() => {
    if (selectedFile) {
      // Preview transform이 있으면 그것을 우선 사용 (UI 동기화)
      const transform = selectedFile.previewTransform || selectedFile.currentTransform;

      setTranslation(transform.translation);

      // Quaternion을 Euler 각도로 변환 (간단한 근사)
      const q = transform.rotation;
      const euler = quaternionToEuler(q);
      setRotation(euler);

      setScale(transform.scale);

      // Reset last committed values when file changes
      lastCommittedValues.current = {};
    }
  }, [selectedFile]);

  /**
   * Quaternion을 Euler 각도로 변환 (도 단위)
   */
  const quaternionToEuler = (q: { x: number; y: number; z: number; w: number }) => {
    // Roll (x-axis rotation)
    const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
    const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    // Pitch (y-axis rotation)
    const sinp = 2 * (q.w * q.y - q.z * q.x);
    const pitch = Math.abs(sinp) >= 1
      ? Math.sign(sinp) * Math.PI / 2
      : Math.asin(sinp);

    // Yaw (z-axis rotation)
    const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
    const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    return {
      x: (roll * 180) / Math.PI,
      y: (pitch * 180) / Math.PI,
      z: (yaw * 180) / Math.PI,
    };
  };
  /**
   * Translation 변경 핸들러 (Preview)
    */
  const handleTranslationChange = (axis: 'x' | 'y' | 'z', value: number) => {
    setTranslation((prev) => ({ ...prev, [axis]: value }));
    // Always use preview during any change
    if (onPreview) {
      onPreview(AdjustmentType.TRANSLATION, axis, value);
    }
  };

  /**
   * Translation 커밋 핸들러 (Final) - ONLY called on mouse/touch release or blur
   */
  const handleTranslationCommit = (axis: 'x' | 'y' | 'z', value: number) => {
    // Clear dragging state first
    isDragging.current = false;

    // Always commit on release (this is only called by onMouseUp/onTouchEnd/onBlur)
    const key = `translation-${axis}`;
    const lastValue = lastCommittedValues.current[key];

    // Only commit if value actually changed
    if (lastValue === undefined || Math.abs(lastValue - value) > 0.0001) {
      lastCommittedValues.current[key] = value;
      onTransformChange(AdjustmentType.TRANSLATION, axis, value);
    }
  };

  /**
   * Rotation 변경 핸들러 (Preview)
   */
  const handleRotationChange = (axis: 'x' | 'y' | 'z', value: number) => {
    setRotation((prev) => ({ ...prev, [axis]: value }));
    // Always use preview during any change
    if (onPreview) {
      onPreview(AdjustmentType.ROTATION, axis, value);
    }
  };

  /**
   * Rotation 커밋 핸들러 (Final) - ONLY called on mouse/touch release or blur
   */
  const handleRotationCommit = (axis: 'x' | 'y' | 'z', value: number) => {
    // Clear dragging state first
    isDragging.current = false;

    // Always commit on release
    const key = `rotation-${axis}`;
    const lastValue = lastCommittedValues.current[key];

    if (lastValue === undefined || Math.abs(lastValue - value) > 0.0001) {
      lastCommittedValues.current[key] = value;
      onTransformChange(AdjustmentType.ROTATION, axis, value);
    }
  };

  /**
   * Scale 변경 핸들러 (Preview)
   */
  const handleScaleChange = (axis: 'x' | 'y' | 'z', value: number) => {
    if (uniformScale) {
      setScale({ x: value, y: value, z: value });
      if (onPreview) {
        onPreview(AdjustmentType.SCALE, 'x', value);
        onPreview(AdjustmentType.SCALE, 'y', value);
        onPreview(AdjustmentType.SCALE, 'z', value);
      }
    } else {
      setScale((prev) => ({ ...prev, [axis]: value }));
      if (onPreview) {
        onPreview(AdjustmentType.SCALE, axis, value);
      }
    }
  };

  /**
   * Scale 커밋 핸들러 (Final) - ONLY called on mouse/touch release or blur
   */
  const handleScaleCommit = (axis: 'x' | 'y' | 'z', value: number) => {
    // Clear dragging state first
    isDragging.current = false;

    // Always commit on release
    if (uniformScale) {
      // For uniform scale, commit all three axes together
      const key = `scale-uniform`;
      const lastValue = lastCommittedValues.current[key];

      if (lastValue === undefined || Math.abs(lastValue - value) > 0.0001) {
        lastCommittedValues.current[key] = value;
        // Commit all three axes with the same value
        onTransformChange(AdjustmentType.SCALE, 'x', value);
        onTransformChange(AdjustmentType.SCALE, 'y', value);
        onTransformChange(AdjustmentType.SCALE, 'z', value);
      }
    } else {
      // For non-uniform scale, commit individual axis
      const key = `scale-${axis}`;
      const lastValue = lastCommittedValues.current[key];

      if (lastValue === undefined || Math.abs(lastValue - value) > 0.0001) {
        lastCommittedValues.current[key] = value;
        onTransformChange(AdjustmentType.SCALE, axis, value);
      }
    }
  };

  if (!selectedFile) {
    return (
      <div className={`p-4 text-center text-gray-400 ${className}`}>
        Select a file to adjust transform
      </div>
    );
  }

  return (
    <div className={`p-4 bg-white rounded-lg shadow ${className}`}>
      {/* 헤더 */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Transform</h3>
        <button
          onClick={onReset}
          className="px-3 py-1 text-sm text-primary-600 hover:bg-primary-50 rounded transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Translation */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Position</h4>
        <div className="space-y-2">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={`translation-${axis}`} className="flex items-center space-x-3">
              <label className="w-4 text-sm font-medium text-gray-600 uppercase">
                {axis}
              </label>
              <input
                type="range"
                min="-100"
                max="100"
                step="0.1"
                value={translation[axis]}
                onMouseDown={() => { isDragging.current = true; }}
                onTouchStart={() => { isDragging.current = true; }}
                onChange={(e) => handleTranslationChange(axis, parseFloat(e.target.value))}
                onMouseUp={(e) => handleTranslationCommit(axis, parseFloat((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => handleTranslationCommit(axis, parseFloat((e.target as HTMLInputElement).value))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <input
                type="number"
                value={translation[axis].toFixed(1)}
                onChange={(e) => handleTranslationChange(axis, parseFloat(e.target.value) || 0)}
                onBlur={(e) => handleTranslationCommit(axis, parseFloat(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleTranslationCommit(axis, parseFloat((e.target as HTMLInputElement).value) || 0);
                  }
                }}
                className="w-16 px-2 py-1 text-sm border border-gray-300 rounded"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Rotation */}
      <div className="mb-6">
        <button
          onClick={onToggleGizmo}
          className={`w-full mb-3 flex items-center justify-between px-3 py-2 rounded text-sm font-medium transition-colors ${
            gizmoActive
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <span>Rotation</span>
          <span className="text-xs font-normal">
            {gizmoActive ? '기즈모 켜짐' : '클릭하여 기즈모 표시'}
          </span>
        </button>
        <div className="space-y-2">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <div key={`rotation-${axis}`} className="flex items-center space-x-3">
              <label className="w-4 text-sm font-medium text-gray-600 uppercase">
                {axis}
              </label>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={rotation[axis]}
                onMouseDown={() => { isDragging.current = true; }}
                onTouchStart={() => { isDragging.current = true; }}
                onChange={(e) => handleRotationChange(axis, parseFloat(e.target.value))}
                onMouseUp={(e) => handleRotationCommit(axis, parseFloat((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => handleRotationCommit(axis, parseFloat((e.target as HTMLInputElement).value))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <input
                type="number"
                value={Math.round(rotation[axis])}
                onChange={(e) => handleRotationChange(axis, parseFloat(e.target.value) || 0)}
                onBlur={(e) => handleRotationCommit(axis, parseFloat(e.target.value) || 0)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleRotationCommit(axis, parseFloat((e.target as HTMLInputElement).value) || 0);
                  }
                }}
                className="w-16 px-2 py-1 text-sm border border-gray-300 rounded"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Scale */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-gray-700">Scale</h4>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={uniformScale}
              onChange={(e) => setUniformScale(e.target.checked)}
              className="w-4 h-4 text-primary-600 rounded"
            />
            <span className="text-xs text-gray-600">Uniform</span>
          </label>
        </div>
        <div className="space-y-2">
          {uniformScale ? (
            <div className="flex items-center space-x-3">
              <label className="w-4 text-sm font-medium text-gray-600">
                XYZ
              </label>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.01"
                value={scale.x}
                onMouseDown={() => { isDragging.current = true; }}
                onTouchStart={() => { isDragging.current = true; }}
                onChange={(e) => handleScaleChange('x', parseFloat(e.target.value))}
                onMouseUp={(e) => handleScaleCommit('x', parseFloat((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => handleScaleCommit('x', parseFloat((e.target as HTMLInputElement).value))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <input
                type="number"
                value={scale.x.toFixed(2)}
                onChange={(e) => handleScaleChange('x', parseFloat(e.target.value) || 1)}
                onBlur={(e) => handleScaleCommit('x', parseFloat(e.target.value) || 1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleScaleCommit('x', parseFloat((e.target as HTMLInputElement).value) || 1);
                  }
                }}
                className="w-16 px-2 py-1 text-sm border border-gray-300 rounded"
              />
            </div>
          ) : (
            (['x', 'y', 'z'] as const).map((axis) => (
              <div key={`scale-${axis}`} className="flex items-center space-x-3">
                <label className="w-4 text-sm font-medium text-gray-600 uppercase">
                  {axis}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.01"
                  value={scale[axis]}
                  onMouseDown={() => { isDragging.current = true; }}
                  onTouchStart={() => { isDragging.current = true; }}
                  onChange={(e) => handleScaleChange(axis, parseFloat(e.target.value))}
                  onMouseUp={(e) => handleScaleCommit(axis, parseFloat((e.target as HTMLInputElement).value))}
                  onTouchEnd={(e) => handleScaleCommit(axis, parseFloat((e.target as HTMLInputElement).value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <input
                  type="number"
                  value={scale[axis].toFixed(2)}
                  onChange={(e) => handleScaleChange(axis, parseFloat(e.target.value) || 1)}
                  onBlur={(e) => handleScaleCommit(axis, parseFloat(e.target.value) || 1)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleScaleCommit(axis, parseFloat((e.target as HTMLInputElement).value) || 1);
                    }
                  }}
                  className="w-16 px-2 py-1 text-sm border border-gray-300 rounded"
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* 현재 파일 정보 */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500 truncate">
          Editing: {selectedFile.fileName}
        </p>
      </div>
    </div>
  );
};

export default TransformPanel;
