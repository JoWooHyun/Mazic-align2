import { useEffect, useRef, useState } from "react";

import {
  commitNumberInput,
  formatNumberForDisplay,
  shouldSyncDisplay,
} from "../../utils/number-input";

interface NumberInputProps {
  /** 외부(부모)가 들고 있는 실제 값. 편집 중이 아닐 때만 표시에 반영된다. */
  value: number;
  /** 커밋(Enter / blur) 시점에만 호출된다. 타자 도중에는 호출되지 않는다. */
  onChange: (v: number) => void;
  /** 커밋 시점에만 적용되는 범위. 입력 중에는 클램프하지 않는다. */
  min?: number;
  max?: number;
  /** 스피너 증감 폭. 값 검증에는 쓰지 않는다. */
  step?: number;
  /**
   * 표시 반올림 자릿수. 내부 값은 반올림하지 않는다.
   * 위치 mm 는 3, 각도 deg 는 2, 배율 × 는 3 처럼 용도별로 준다.
   */
  decimals?: number;
  /**
   * 편집 시작 시 1회 호출 (undo 단위의 시작). TransformPanel 의 beginDrag.
   * 실제로 커밋이 일어나기 **직전** 에 호출되므로 타자 중간값은 undo 스택에
   * 쌓이지 않는다 — 상세는 아래 커밋 흐름 주석 참고.
   */
  onBegin?: () => void;
  /** 편집 종료 시 1회 호출 (undo 단위의 끝). TransformPanel 의 endDrag. */
  onEnd?: () => void;
  disabled?: boolean;
  className?: string;
  /** 접근성 라벨. 축 문자만 옆에 붙는 좁은 칸에서 쓴다. */
  ariaLabel?: string;
}

/**
 * 커밋형 숫자 입력칸 (B-14).
 *
 * 기존 입력칸은 `value={value}` 제어 + `onChange` 마다 즉시 부모 반영이라
 * 타자 도중의 반쪽 숫자가 그대로 적용됐다. 그래서 리드 실물 테스트에서
 * "90 을 치려고 9 를 누르면 89.9999999 가 나온다", "전체 선택 후 0 을 넣으면
 * 이상해진다", "최소값/최대값으로 변경된다" 가 전부 한 원인에서 나왔다.
 * 원인·규칙은 `utils/number-input.ts` 주석 참고.
 *
 * 이 컴포넌트의 계약:
 *   · 입력 중에는 **로컬 문자열**만 갱신하고 부모에 반영하지 않는다.
 *   · 커밋 = **Enter 또는 blur**. 그때만 파싱·클램프·`onChange`.
 *   · 빈 값·파싱 불가 커밋은 **원래 값 유지** (0 으로 떨어뜨리지 않는다).
 *   · Esc 는 편집을 취소하고 원래 값으로 되돌린다.
 *   · 외부 값 변화(기즈모 드래그 등)는 **편집 중이 아닐 때만** 표시에 반영.
 *
 * ⚠️ 슬라이더(`type="range"`)는 여기 해당 없다. 드래그는 연속 조작이라
 * 실시간 프리뷰가 맞다 — 호출부에서 슬라이더는 종전 그대로 둔다.
 *
 * ── undo 단위 ────────────────────────────────────────────────────────────
 * 호출부(TransformPanel)의 규약은 `onBegin` → `onChange`(들) → `onEnd` 로
 * 한 묶음이 undo 1회다. 기존 배선은 `onFocus={onBegin} onBlur={onEnd}` 였는데,
 * 그 사이에 타자 중간값이 여러 번 `onChange` 로 흘러 들어갔다.
 * 여기서는 **커밋이 실제로 값을 바꿀 때만** `onBegin` → `onChange` → `onEnd`
 * 를 한 자리에서 연달아 부른다. 포커스만 주고 아무것도 안 고치거나, 고쳤다가
 * 원래 값으로 되돌리면 셋 다 부르지 않는다 → 빈 undo 항목이 쌓이지 않는다.
 */
const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  min,
  max,
  step,
  decimals = 3,
  onBegin,
  onEnd,
  disabled = false,
  className = "",
  ariaLabel,
}) => {
  // 편집 중 표시 문자열. 부모 값과 독립적으로 살아 있는 것이 이 수정의 핵심.
  const [text, setText] = useState(() =>
    formatNumberForDisplay(value, decimals),
  );
  // 포커스 보유 여부 = 편집 중. ref 인 이유는 아래 useEffect 가 이 값을 읽되
  //   포커스 변화 자체로 동기화를 다시 돌릴 필요는 없기 때문.
  const editingRef = useRef(false);
  // Esc 취소용 — 편집을 시작한 시점의 부모 값.
  const valueAtFocusRef = useRef(value);

  // 외부에서 값이 바뀌면(기즈모 드래그, 회전 버튼, Reset 등) 표시를 따라가게
  //   한다. 단 **편집 중에는 덮어쓰지 않는다** — 덮어쓰면 타자 중 커서가 튀고
  //   자릿수가 엉킨다(B-14 의 근본 증상).
  useEffect(() => {
    setText((prev) =>
      shouldSyncDisplay(editingRef.current, prev, value, decimals)
        ? formatNumberForDisplay(value, decimals)
        : prev,
    );
  }, [value, decimals]);

  /**
   * 커밋. Enter / blur 에서 호출한다.
   * 값이 실제로 바뀔 때만 undo 한 묶음(onBegin → onChange → onEnd)을 낸다.
   *
   * @returns 커밋 후 표시에 쓸 값 (파싱 실패면 원래 값).
   */
  function commit(raw: string): number {
    const result = commitNumberInput(raw, value, min, max);
    if (result.changed) {
      onBegin?.();
      onChange(result.value);
      onEnd?.();
    }
    return result.value;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      // Enter 로 커밋. 폼 안에 있을 경우의 submit 은 막는다.
      e.preventDefault();
      const applied = commit(text);
      // 클램프·파싱 실패로 실제 값이 달라졌으면 표시도 맞춰 준다.
      setText(formatNumberForDisplay(applied, decimals));
    } else if (e.key === "Escape") {
      // 편집 취소 — 포커스 시점 값으로 되돌린다. 커밋하지 않는다.
      e.preventDefault();
      setText(formatNumberForDisplay(valueAtFocusRef.current, decimals));
      e.currentTarget.blur();
    }
  }

  function handleFocus() {
    editingRef.current = true;
    valueAtFocusRef.current = value;
  }

  function handleBlur() {
    editingRef.current = false;
    const applied = commit(text);
    setText(formatNumberForDisplay(applied, decimals));
  }

  return (
    <input
      type="number"
      // min/max 는 커밋 시점 클램프로 처리한다. DOM 속성으로 걸면 브라우저가
      //   타자 중간값을 범위 밖으로 판정해 :invalid 스타일이 깜빡이므로 넘기지
      //   않는다. 스피너 증감 폭인 step 만 그대로 전달한다.
      step={step}
      value={text}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={className}
    />
  );
};

export default NumberInput;
