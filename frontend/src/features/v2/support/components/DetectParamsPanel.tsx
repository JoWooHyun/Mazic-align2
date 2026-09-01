import NumberInput from "../../components/common/NumberInput";
import {
  useDetectParamsStore,
  type DetectParams,
} from "../hooks/useDetectParamsStore";
import { SUPPORT_DETECT_PARAM_LIMITS } from "../utils/defaults";

/**
 * 재설계 서포트 **검출·점생성** 파라미터 패널 (P-2).
 *
 * ## 왜 만들었나
 * `SUPPORT_DETECT_PARAM_LIMITS` 는 한계값까지 선언돼 있었지만 **읽는 컴포넌트가
 * 하나도 없는 죽은 코드**였다. 그래서 9개 값이 사실상 모듈 상수로 굳어 있었고,
 * 리드 결정 3("모든 값 사용자 조절 가능")과 어긋났다. 특히 B-22 의
 * `verticalSpacingMm` 는 **점 개수를 직접 좌우**하는데 UI 가 없어, 실물에서
 * "서포트가 너무 많다/적다" 를 사용자가 직접 조정할 수 없었다.
 *
 * ## 검출각이 여기 없는 이유
 * 오버행 **검출각**은 뷰어의 빨간 하이라이트와 **같은 값**이어야 한다(판정서 C-3).
 * 단일 출처가 `useSupportParamsStore.overhangAngleDeg`(서포트 패널의 "오버행
 * 임계각")이므로 여기서 중복 노출하지 않는다 — 두 곳에서 소유하면 값이 어긋나던
 * 원래 버그로 되돌아간다.
 */

/** 패널에 노출할 키 순서 (의미 그룹으로 묶어 읽기 쉽게). */
/** 노출 키는 한계값이 정의된 것만 (layerHeightMm 은 슬라이스 패널 소유라 제외). */
type DetectRowKey = Extract<
  keyof DetectParams,
  keyof typeof SUPPORT_DETECT_PARAM_LIMITS
>;

const ROWS: Array<{
  key: DetectRowKey;
  hint?: string;
}> = [
  { key: "plateGapMm", hint: "이 높이 이하는 아일랜드로 보지 않는다" },
  { key: "overlapSampleMm", hint: "층 겹침을 확인하는 샘플 간격" },
  { key: "tipRadiusMm", hint: "각 점이 요구하는 접점 반경" },
  { key: "smallAreaMm2", hint: "이보다 작은 아일랜드는 중심 1점만" },
  { key: "elongatedAspect", hint: "이 종횡비 이상이면 가늘고 긴 것 → 양 끝 2점" },
  { key: "fillSpacingMm", hint: "큰 아일랜드 내부를 채우는 간격" },
  {
    key: "overhangSpacingMm",
    hint: "오버행 점의 가로 간격. 키우면 점이 줄어든다",
  },
  {
    key: "verticalSpacingMm",
    hint: "오버행 점의 세로 간격. 키우면 점이 크게 줄어든다 (B-22)",
  },
];

interface DetectParamsPanelProps {
  className?: string;
}

const DetectParamsPanel: React.FC<DetectParamsPanelProps> = ({
  className = "",
}) => {
  const params = useDetectParamsStore((s) => s.params);
  const setParam = useDetectParamsStore((s) => s.setParam);
  const reset = useDetectParamsStore((s) => s.reset);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-800">검출 · 점 생성</h4>
        <button
          onClick={reset}
          className="px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 rounded transition-colors"
        >
          기본값
        </button>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        받칠 곳을 고르고 점을 몇 개 찍을지 정합니다. 서포트가 너무 많으면
        <b> 오버행 점 간격(세로)</b>을 키우세요.
        <br />
        ※ 오버행 <b>검출각</b>은 위 서포트 패널의 &quot;오버행 임계각&quot;과
        같은 값을 씁니다.
      </p>

      <div className="space-y-3">
        {ROWS.map(({ key, hint }) => {
          const limit = SUPPORT_DETECT_PARAM_LIMITS[key];
          const value = params[key] ?? 0;
          const commit = (raw: number) => {
            if (Number.isNaN(raw)) return;
            const clamped = Math.min(Math.max(raw, limit.min), limit.max);
            const stepped = Math.round(clamped / limit.step) * limit.step;
            setParam(key, Number(stepped.toFixed(3)));
          };
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">
                  {limit.label}
                </label>
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
                  onChange={(e) => commit(Number(e.target.value))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                {/* 숫자칸은 Enter/blur 에서만 커밋 (B-14 규약). */}
                <NumberInput
                  min={limit.min}
                  max={limit.max}
                  step={limit.step}
                  decimals={3}
                  value={value}
                  onChange={commit}
                  ariaLabel={limit.label}
                  className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                />
                <span className="w-8 text-xs text-gray-500">{limit.unit}</span>
              </div>
              {hint && (
                <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DetectParamsPanel;
