import NumberInput from "../../components/common/NumberInput";
import { useSupportParamsStore } from "../hooks/useSupportParamsStore";
import {
  SUPPORT_PARAM_LIMITS,
  DEFAULT_SUPPORT_PARAMS,
} from "../utils/defaults";
import type { SupportParams } from "../types";

type Preset = "light" | "medium" | "heavy";

const PRESETS: Record<Preset, Partial<SupportParams>> = {
  light: {
    overhangAngleDeg: 35,
    contactSpacingMm: 8,
    trunkDiameterMm: 0.6,
    tipDiameterMm: 0.3,
    baseDiameterMm: 1.2,
  },
  medium: {
    overhangAngleDeg: 45,
    contactSpacingMm: 4,
    trunkDiameterMm: 0.8,
    tipDiameterMm: 0.4,
    baseDiameterMm: 1.5,
  },
  heavy: {
    overhangAngleDeg: 55,
    contactSpacingMm: 2.5,
    trunkDiameterMm: 1.0,
    tipDiameterMm: 0.5,
    baseDiameterMm: 2.0,
  },
};

const PRESET_LABEL: Record<Preset, string> = {
  light: "Light",
  medium: "Medium",
  heavy: "Heavy",
};

interface SupportParamsPanelProps {
  /** 자동 생성 동작. 없으면 버튼 비활성. */
  onAutoGenerate?: () => void;
  /** 전부 삭제. 없으면 버튼 비활성. */
  onClearAll?: () => void;
  /** 현재 등록된 서포트 점 수. */
  supportCount?: number;
  /** 자동 생성 진행 중 표시. */
  busy?: boolean;
  className?: string;
}

/**
 * 서포트 파라미터 패널.
 *
 * 모든 값은 useSupportParamsStore 에서 읽고 쓴다. 오버행 시각화 /
 * 자동 생성 / 수동 편집도 같은 스토어를 본다.
 */
const SupportParamsPanel: React.FC<SupportParamsPanelProps> = ({
  onAutoGenerate,
  onClearAll,
  supportCount = 0,
  busy = false,
  className = "",
}) => {
  const params = useSupportParamsStore((s) => s.params);
  const setParam = useSupportParamsStore((s) => s.setParam);
  const reset = useSupportParamsStore((s) => s.reset);

  const isAtDefault =
    JSON.stringify(params) === JSON.stringify(DEFAULT_SUPPORT_PARAMS);

  return (
    <div className={`p-4 bg-white rounded-lg shadow ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Support</h3>
        <button
          onClick={reset}
          disabled={isAtDefault}
          className="px-3 py-1 text-sm text-primary-600 hover:bg-primary-50 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Reset
        </button>
      </div>

      <div className="mb-3 flex items-center gap-1">
        <span className="text-xs font-semibold text-gray-600 mr-1">프리셋</span>
        {(Object.keys(PRESETS) as Preset[]).map((p) => (
          <button
            key={p}
            onClick={() => {
              const patch = PRESETS[p];
              for (const k of Object.keys(patch) as Array<
                keyof SupportParams
              >) {
                setParam(k, patch[k] as never);
              }
            }}
            className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-primary-50 hover:border-primary-400 hover:text-primary-700 transition-colors"
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <label
          htmlFor="support-auto-trunk"
          className="text-sm font-medium text-gray-700 cursor-pointer"
        >
          기둥 굵기 자동 조정
        </label>
        <input
          id="support-auto-trunk"
          type="checkbox"
          checked={params.autoSizeTrunk}
          onChange={(e) => setParam("autoSizeTrunk", e.target.checked)}
          className="w-4 h-4 text-primary-600 rounded cursor-pointer"
        />
      </div>

      <div className="space-y-3">
        {(Object.keys(SUPPORT_PARAM_LIMITS) as Array<
          keyof typeof SUPPORT_PARAM_LIMITS
        >).map((key) => (
          <ParamRow
            key={key}
            paramKey={key}
            value={params[key]}
            disabled={key === "trunkDiameterMm" && params.autoSizeTrunk}
            onChange={(v) => setParam(key, v)}
          />
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">서포트</span>
          <span className="text-xs text-gray-500">
            현재 {supportCount} 개
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onAutoGenerate}
            disabled={!onAutoGenerate || busy}
            className="flex-1 px-3 py-2 text-sm bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? "생성 중…" : "자동 생성"}
          </button>
          <button
            onClick={onClearAll}
            disabled={!onClearAll || supportCount === 0 || busy}
            className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            전부 삭제
          </button>
        </div>
      </div>
    </div>
  );
};

interface ParamRowProps {
  paramKey: keyof typeof SUPPORT_PARAM_LIMITS;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}

const ParamRow: React.FC<ParamRowProps> = ({
  paramKey,
  value,
  disabled,
  onChange,
}) => {
  const limit = SUPPORT_PARAM_LIMITS[paramKey];

  const commit = (raw: number) => {
    if (Number.isNaN(raw)) return;
    const clamped = Math.min(Math.max(raw, limit.min), limit.max);
    const stepped = Math.round(clamped / limit.step) * limit.step;
    onChange(Number(stepped.toFixed(3)));
  };

  return (
    <div className={disabled ? "opacity-40" : ""}>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium text-gray-700">{limit.label}</label>
        <span className="text-xs text-gray-500">
          {limit.min}–{limit.max} {limit.unit}
        </span>
      </div>
      <div className="flex items-center space-x-3">
        <input
          type="range"
          min={limit.min}
          max={limit.max}
          step={limit.step}
          value={value}
          disabled={disabled}
          onChange={(e) => commit(Number(e.target.value))}
          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:cursor-not-allowed"
        />
        {/* 숫자칸은 Enter/blur 에서만 커밋 (B-14). 슬라이더는 종전대로 즉시 반영.
            리드가 "서포트쪽도 다 이상함" 으로 보고한 칸이다 — 여기는 클램프에
            더해 step 스냅까지 타자마다 걸려서, step 0.5 인 항목에 "1.7" 을
            치면 "1" 이 1.0 으로, "1.7" 이 1.5 로 끌려갔다. */}
        <NumberInput
          min={limit.min}
          max={limit.max}
          step={limit.step}
          decimals={3}
          value={value}
          disabled={disabled}
          onChange={commit}
          ariaLabel={limit.label}
          className="w-20 px-2 py-1 text-sm border border-gray-300 rounded disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        <span className="w-6 text-xs text-gray-500">{limit.unit}</span>
      </div>
    </div>
  );
};

export default SupportParamsPanel;
