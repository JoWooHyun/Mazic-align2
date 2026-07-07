import { useState, useEffect } from 'react';
import { type STLFile, AdjustmentType } from '../types/stl.types';
import {
  type SupportSettings,
  type SupportTool,
} from '@utils/support.utils';

// -0.00 같은 음수 0 표기를 0.00 으로 정규화
const formatMm = (v: number): string => {
  const r = parseFloat(v.toFixed(2));
  return (r === 0 ? 0 : r).toFixed(2);
};

interface SupporterPanelProps {
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
  supportSettings: SupportSettings; // 팁 상부/하부, 접점 깊이
  onSupportSettingsChange: (s: SupportSettings) => void;
  supportTool: SupportTool; // 현재 서포트 배치 도구
  onSetSupportTool: (tool: SupportTool) => void;
  brushThickness: number; // 보호 영역 브러쉬 두께 (mm)
  onBrushThicknessChange: (value: number) => void;
  onGenerateRegionSupports: () => void; // 자동 서포트 생성
  onAutoAngle: () => void; // 자동 각도 조절 실행
  onScopedSupport: () => void; // 선택 영역 자동 서포트 생성
  onFindMargin: () => void; // 색칠 영역에서 마진 찾기
  onClearSupports: () => void; // 선택된 STL의 서포트 모두 제거
  // Phase 1 — Island Detection
  sliceLayerHeight?: number; // 슬라이스 두께 (mm) — 기본 0.05
  onSliceLayerHeightChange?: (value: number) => void;
  onDetectIslands?: () => void; // 전체 모델 island 검출
  className?: string;
}

/**
 * 서포터(서포트) 설정 패널
 * Z축 이동 높이 / 설정 / 자동 서포터 구성 섹션으로 구성
 *
 * Z축 이동 높이: 선택된 STL의 빌드플레이트(Z=0) 대비 Z 거리 = translation.z
 */
const SupporterPanel: React.FC<SupporterPanelProps> = ({
  selectedFile,
  onTransformChange,
  onPreview,
  supportSettings,
  onSupportSettingsChange,
  supportTool,
  onSetSupportTool,
  brushThickness,
  onBrushThicknessChange,
  onGenerateRegionSupports,
  onAutoAngle,
  onScopedSupport,
  onFindMargin,
  onClearSupports,
  sliceLayerHeight = 0.05,
  onSliceLayerHeightChange,
  onDetectIslands,
  className = '',
}) => {
  const updateSetting = (key: keyof SupportSettings, value: number) => {
    onSupportSettingsChange({ ...supportSettings, [key]: value });
  };
  const [zLiftHeight, setZLiftHeight] = useState(0);

  // 선택된 STL의 Z 거리(빌드플레이트 대비)를 Z축 이동 높이에 반영
  useEffect(() => {
    if (selectedFile) {
      const t = selectedFile.previewTransform || selectedFile.currentTransform;
      setZLiftHeight(t.translation.z);
    } else {
      setZLiftHeight(0);
    }
  }, [selectedFile]);

  const handleZChange = (value: number) => {
    setZLiftHeight(value);
    onPreview?.(AdjustmentType.TRANSLATION, 'z', value);
  };

  const handleZCommit = (value: number) => {
    onTransformChange(AdjustmentType.TRANSLATION, 'z', value);
  };

  const numberInput =
    'w-24 px-2 py-1 text-sm text-right border border-gray-300 rounded';
  // STL 이 선택(활성화)되지 않으면 영역 지정·서포트 기능을 모두 비활성화
  const noStl = !selectedFile;
  const disabledCls = ' disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className={`p-4 bg-white rounded-lg shadow ${className}`}>
      {/* Z축 이동 높이 — 선택 STL의 빌드플레이트 대비 Z 거리 */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-200">
        <label className="text-sm font-medium text-gray-700">
          Z축 이동 높이 (mm)
        </label>
        <input
          type="number"
          step="0.1"
          value={formatMm(zLiftHeight)}
          disabled={!selectedFile}
          onChange={(e) => handleZChange(parseFloat(e.target.value) || 0)}
          onBlur={(e) => handleZCommit(parseFloat(e.target.value) || 0)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleZCommit(parseFloat((e.target as HTMLInputElement).value) || 0);
            }
          }}
          className={`${numberInput} ${
            !selectedFile ? 'bg-gray-100 text-gray-400' : ''
          }`}
        />
      </div>

      {/* 설정 */}
      <div className="py-4 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">설정</h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">팁 상부 직경 (mm)</label>
            <input
              type="number"
              step="0.01"
              value={supportSettings.tipTopDiameter}
              onChange={(e) =>
                updateSetting('tipTopDiameter', parseFloat(e.target.value) || 0)
              }
              className={numberInput}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">팁 하부 직경 (mm)</label>
            <input
              type="number"
              step="0.01"
              value={supportSettings.tipBottomDiameter}
              onChange={(e) =>
                updateSetting('tipBottomDiameter', parseFloat(e.target.value) || 0)
              }
              className={numberInput}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">접점 깊이 (mm)</label>
            <input
              type="number"
              step="0.01"
              value={supportSettings.contactDepth}
              onChange={(e) =>
                updateSetting('contactDepth', parseFloat(e.target.value) || 0)
              }
              className={numberInput}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">터치 팁 거리 (mm)</label>
            <input
              type="number"
              step="0.1"
              value={supportSettings.touchTipDistance}
              onChange={(e) =>
                updateSetting('touchTipDistance', parseFloat(e.target.value) || 0)
              }
              className={numberInput}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">서포트 각도 (°)</label>
            <input
              type="number"
              step="1"
              min="0"
              max="90"
              value={supportSettings.supportAngle}
              onChange={(e) =>
                updateSetting('supportAngle', parseFloat(e.target.value) || 0)
              }
              className={numberInput}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600">슬라이스 두께 (mm)</label>
            <input
              type="number"
              step="0.01"
              min="0.02"
              max="0.2"
              value={sliceLayerHeight}
              onChange={(e) =>
                onSliceLayerHeightChange?.(parseFloat(e.target.value) || 0.05)
              }
              className={numberInput}
            />
          </div>
        </div>
      </div>

      {/* 영역 설정 */}
      <div className="py-4 border-b border-gray-200">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">
          영역 설정
        </h4>

        {/* 영역 지정 (보호 영역 브러쉬) */}
        <button
          disabled={noStl}
          onClick={() =>
            onSetSupportTool(supportTool === 'mask' ? 'none' : 'mask')
          }
          className={`w-full px-3 py-2 rounded text-sm font-medium transition-colors text-center ${
            supportTool === 'mask'
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }${disabledCls}`}
        >
          브러쉬로 영역 지정
        </button>
        {supportTool === 'mask' && (
          <div className="flex items-center justify-between mt-2">
            <label className="text-sm text-gray-600">브러쉬 두께 (mm)</label>
            <input
              type="number"
              step="0.5"
              min="0.5"
              value={brushThickness}
              onChange={(e) =>
                onBrushThicknessChange(parseFloat(e.target.value) || 0)
              }
              className={numberInput}
            />
          </div>
        )}

        <button
          disabled={noStl}
          onClick={onFindMargin}
          className={`w-full mt-3 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded hover:bg-gray-200 transition-colors${disabledCls}`}
        >
          마진 찾기
        </button>
        <p className="mt-1 text-xs text-gray-400">
          브러쉬로 마진 일부만 살짝 칠하고 누르세요. 색칠 영역의 sharp 모서리를
          시드로 삼아, 방향이 연속적으로 이어지는 동안만 따라가 마진 폐곡선을
          완성합니다(갑작스런 예각 분기는 자동 배제).
        </p>

        <button
          disabled={noStl}
          onClick={onScopedSupport}
          className={`w-full mt-3 px-3 py-2 bg-primary-600 text-white text-sm font-medium rounded hover:bg-primary-700 transition-colors${disabledCls}`}
        >
          선택 영역 자동 서포트 생성
        </button>
        <p className="mt-2 text-xs text-gray-400">
          색칠 영역이 플레이트를 마주보도록 회전 후, 그 영역 안의 미지지
          지오메트리에만 서포트를 생성합니다 (마진 0.5mm 가드).
        </p>

        <button
          disabled={noStl}
          onClick={onDetectIslands}
          className={`w-full mt-3 px-3 py-2 bg-fuchsia-600 text-white text-sm font-medium rounded hover:bg-fuchsia-700 transition-colors${disabledCls}`}
        >
          Island 검출 (전체 모델)
        </button>
        <p className="mt-2 text-xs text-gray-400">
          선택 STL 을 슬라이스 두께 간격으로 자르고 ChiTuBox/Cura 표준
          4-connected component 로 island 를 판정합니다. 결과는 뷰어
          우측 슬라이더로 한 층씩 확인 가능.
        </p>
      </div>

      {/* 서포트 편집 도구 */}
      <div className="py-4">
        <div className="flex items-center space-x-2">
          <button
            disabled={noStl}
            className={`p-2 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition-colors${disabledCls}`}
            title="초기화"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            disabled={noStl}
            onClick={() =>
              onSetSupportTool(supportTool === 'point' ? 'none' : 'point')
            }
            className={`p-2 border rounded transition-colors ${
              supportTool === 'point'
                ? 'border-primary-600 bg-primary-600 text-white'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }${disabledCls}`}
            title="서포트 추가 (점)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            disabled={noStl}
            className={`p-2 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition-colors${disabledCls}`}
            title="서포트 제거"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button
            disabled={noStl}
            className={`p-2 border border-gray-300 rounded text-gray-600 hover:bg-gray-50 transition-colors${disabledCls}`}
            title="서포트 편집"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>

      </div>

      {/* 자동 서포트 생성 */}
      <button
        disabled={noStl}
        onClick={onGenerateRegionSupports}
        className={`w-full mb-2 px-3 py-2 bg-primary-600 text-white text-sm font-medium rounded hover:bg-primary-700 transition-colors${disabledCls}`}
      >
        자동 서포트 생성
      </button>

      {/* 모두 지우기 — 패널 최하단 */}
      <button
        disabled={noStl}
        onClick={onClearSupports}
        className={`w-full px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition-colors${disabledCls}`}
      >
        모두 지우기
      </button>
    </div>
  );
};

export default SupporterPanel;
