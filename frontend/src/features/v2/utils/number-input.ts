// 숫자 입력칸의 파싱·클램프·커밋 규칙 (B-14).
//
//   리드 실물 보고: "수치 입력하려그러면 최소값 혹은 최대값으로 변경됨",
//   "Y 90 도 입력하려고 9 를 누르면 89.9999999 이런 값이 나와버림",
//   "전체 선택 후 0 넣으면 이상해짐", "입력하고 엔터쳐야 적용되어야 하는데
//   바로 적용된다".
//
//   원인은 전부 하나다 — 기존 입력칸이 `value={value}` 로 제어되면서
//   `onChange` 마다 즉시 부모에 반영하고 즉시 클램프했다. 그래서
//     · "90" 을 치는 중 "9" 가 회전값으로 적용되고, 그 값이 다시 `value` 로
//       입력칸을 덮어써 자릿수가 엉킨다. 회전은 Euler↔quaternion 왕복을
//       거치므로 부동소수 찌꺼기(89.9999999)가 그대로 노출된다.
//     · 전체 선택 후 지우면 순간 빈 문자열이 되는데 `Number("") === 0` 이라
//       0 이 적용되고, 범위 하한(스케일 0.1 등)으로 클램프돼 값이 튄다.
//     · 타자 중간값("1" → 100 범위 밖 "1" 등)이 범위를 벗어나면 즉시 클램프.
//
//   해결 규칙은 **커밋 시점 분리**다. 입력 중에는 문자열을 그대로 두고,
//   Enter / blur 때만 파싱·클램프·부모 반영한다. 이 파일은 그 규칙을 React
//   와 무관한 순수 함수로 담아 헤드리스 검증(scripts/verify-number-input.mjs)
//   이 가능하게 한다. 컴포넌트는 components/common/NumberInput.tsx.

/** 커밋 판정 결과. */
export interface CommitResult {
  /**
   * 부모에 반영할 값. `changed` 가 false 면 원래 값 그대로다.
   * **파싱 불가·빈 문자열이면 0 이 아니라 원래 값**이 들어온다 — 리드가 보고한
   * "전체 선택 후 0 넣으면 이상해짐" 의 직접 원인이 `Number("") === 0` 이었다.
   */
  value: number;
  /** 부모에 실제로 알려야 하는가 (원래 값과 다른가). */
  changed: boolean;
  /** 클램프가 걸렸는가. 표시 문자열을 클램프값으로 되돌릴 때 쓴다. */
  clamped: boolean;
}

/**
 * 입력 문자열을 숫자로 파싱한다. **커밋 시점에만** 호출한다.
 *
 * 타자 도중 자연스럽게 거쳐가는 중간 상태("", "-", ".", "-.", "1e")는
 * 숫자가 아니므로 `null` 을 돌려준다. 호출자는 이때 원래 값을 유지해야지
 * 0 으로 떨어뜨리면 안 된다.
 */
export function parseNumberInput(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * min/max 클램프. **커밋 시점에만** 적용한다.
 *
 * 입력 중에 클램프하면 "100" 을 치려고 "1" 을 누른 순간 하한으로 끌려가
 * 리드가 본 "최소값 혹은 최대값으로 변경됨" 이 된다. min/max 가 없으면 통과.
 */
export function clampNumber(
  value: number,
  min?: number,
  max?: number,
): number {
  let v = value;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

/**
 * 편집 문자열을 커밋한다. 입력칸의 Enter / blur 에서 한 번 호출한다.
 *
 * @param raw       입력칸에 사용자가 쳐 놓은 문자열
 * @param current   현재 부모 값 (파싱 실패 시 되돌아갈 기준)
 * @param min/max   커밋 시점에만 적용할 범위
 */
export function commitNumberInput(
  raw: string,
  current: number,
  min?: number,
  max?: number,
): CommitResult {
  const parsed = parseNumberInput(raw);
  // 빈 값·파싱 불가 → 원래 값 유지. 0 으로 만들지 않는다.
  if (parsed === null) {
    return { value: current, changed: false, clamped: false };
  }
  const clamped = clampNumber(parsed, min, max);
  return {
    value: clamped,
    changed: clamped !== current,
    clamped: clamped !== parsed,
  };
}

/**
 * 표시용 반올림. **표시만** 바꾸고 내부 값은 건드리지 않는다.
 *
 * 회전값이 Euler↔quaternion 왕복을 거치며 89.9999999 같은 부동소수 찌꺼기를
 * 달고 오는데(B-13 환산 경로), 그대로 입력칸에 그리면 리드가 본 그 화면이 된다.
 * 소수 자릿수는 용도별로 다르므로(위치 mm 는 촘촘히, 각도는 성기게) prop 으로
 * 받는다.
 *
 * `-0` 이 "-0" 으로 그려지는 것을 막기 위해 0 을 더해 부호를 정규화한다.
 */
export function formatNumberForDisplay(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "";
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  // `+ 0` 으로 -0 → 0 정규화. toFixed 후 불필요한 뒤쪽 0 은 Number 로 떨군다.
  return String(Number(rounded.toFixed(decimals)) + 0);
}

/**
 * 외부 값이 바뀌었을 때 표시 문자열을 갈아끼워야 하는가.
 *
 * **편집 중(포커스 있음)에는 절대 덮어쓰지 않는다** — 이것이 B-14 의 핵심이다.
 * 편집 중이 아닐 때만, 그리고 현재 표시 문자열이 새 값과 다르게 보일 때만
 * 갱신한다. 표시 반올림을 거쳐 비교하므로 89.9999999 → "90" 이 이미 떠 있으면
 * 재갱신하지 않는다(커서·선택 상태 보존).
 */
export function shouldSyncDisplay(
  editing: boolean,
  displayText: string,
  externalValue: number,
  decimals: number,
): boolean {
  if (editing) return false;
  return displayText !== formatNumberForDisplay(externalValue, decimals);
}

/**
 * 대조군 — **수정 전** 동작. 타자 한 글자마다 즉시 파싱 + 즉시 클램프.
 *
 * `onChange={(e) => onChange(Number(e.target.value))}` + `min`/`max` 가 걸린
 * 제어 입력이 실제로 하던 일이다. 검증 스크립트가 "스크립트가 정말 버그를
 * 잡는가" 를 증명하는 데 쓴다(프로젝트 규약: B-1 확립).
 *
 * 브라우저의 `<input type="number">` 는 파싱 불가 입력에 빈 문자열을 준다.
 * 그래서 `Number("")` 가 0 이 되는 경로가 실제로 열려 있었다.
 */
export function legacyImmediateApply(
  raw: string,
  current: number,
  min?: number,
  max?: number,
): number {
  const n = Number(raw);
  if (Number.isNaN(n)) return current;
  // 기존 입력칸은 min/max 속성으로 즉시 클램프된 값이 부모에 흘러갔다.
  return clampNumber(n, min, max);
}
