/**
 * Task0 G-code 파서 v0.2.1 — TypeScript 이식 (규격서 v0.3.4 §12)
 *
 * 원본: Task0 리포 `controllers/task0_gcode.py` @ 커밋 03c0519 (파서 v0.2.1)
 *       단위테스트 `test/test_task0_gcode.py` @ 03c0519 (82건)
 *       규격서 `docs/Task0_Gcode_규격서_초안.md` v0.3.4 §12(파서 규칙)·§4(명령)·§8(속도) @ a4ebc6c
 *   v0.2.1 (협의 §28-3·§30-3): G92 인자 검사(두 모드 — 잘못된 G92 줄은 버리고 위반) / Z 관련 위반 문구 숫자
 *   소수 4자리 고정 / 인자 없는 G0·G1 은 "F 단독 줄"과 따로 경고("인자 없는 이동 줄").
 *
 * 목적: MazicAlign 이 만드는 Task0 출력(.zip 안 G-code)을 Task0 와 **같은 규칙**으로 검사한다
 *   (로드맵 0절 2주차 PR-1 Z1). 공개 동작은 원본과 1:1 — 경고·오류 문구도 글자 단위로 같다.
 *   ★ 원본이 바뀌면 이 파일과 `scripts/verify-task0-parser.mjs`(원본 커밋 상수·이식 테스트)를
 *     **같은 커밋 기준으로 다시 맞춘다.** 검증 스크립트가 그 커밋의 Python 판과 차분 비교한다.
 *
 * 순수 TS — DOM/Node API 없음(문자열·정규식·수학·BigInt·DataView 만). 브라우저·Web Worker·tsx 어디서나 돈다.
 *
 * Python ↔ JS 차이를 원본 쪽으로 맞춘 지점:
 *   - 공백: str.strip()/rstrip()/split() 의 공백 = Python isspace() 29자(\x1c~\x1f·\x85 포함, U+FEFF(BOM) 제외).
 *     JS trim()·\s 와 다르므로 직접 구현(isPyWs).
 *   - 정규식: 원본 _MOVE_ARG_RE·_G92_ARG_RE 는 re.ASCII → \s = [ \t\n\r\v\f]. \Z(입력 끝) = JS `$`(m 플래그 없음).
 *   - 길이·자르기: Python 은 코드 포인트 단위(JS length 는 UTF-16 단위) — 명령 이름 40자, 첫 3글자 등.
 *   - str.upper() = toUpperCase() (둘 다 Unicode 전체 매핑 — 'ß'→'SS'). 단 Unicode 판 차이(Python 3.13=15.1,
 *     Node 22=16.0)로 16.0 신규 문자의 대문자화는 다를 수 있다(실제 G-code 에는 안 나옴).
 *   - round(x): 은행가 반올림(half-even).
 *   - 숫자→문자열: '{:g}'(유효 6자리 half-even, 'e+06' 꼴, 끝 0 제거), '{:.4f}'(정확한 10진 전개에서 소수 4자리
 *     half-even — JS toFixed 는 동률을 올리고 1e21 이상은 지수 표기라 쓰지 않음), repr(float)('1e-05'·'0.0'·'inf'),
 *     int 출력(F값)은 자리 전부(BigInt — JS String(1e21)='1e+21' 와 다름).
 *   - int/float 구분: JS number 는 하나뿐 → 안전 정수(Number.isSafeInteger)는 Python int, 나머지는 float 로 본다
 *     (인자 오류 메시지의 repr 에서만 차이가 보임: Python 300.0 → '300.0', 여기 300 → '300').
 *   - 예외: Python ValueError → name 이 'ValueError' 인 Error (메시지 동일).
 *   - 파일 읽기(parseGcodeText): 텍스트 모드 universal newlines — \r\n·\r·\n 만 줄 끝(\x85·U+2028 은 줄 끝 아님),
 *     utf-8-sig 처럼 맨 앞 BOM 1개만 제거.
 */

// ==================== 상수 ====================

/** 드라이런 이동 F (mm/min) — 10mm/s 고정 */
export const FIXED_SPEED_F = 600;
/** 실출력 순수 Z 줄 F (mm/min) — 규격서 §8 */
export const Z_SPEED_F = 300;

export type Task0FKind = 'deposit' | 'travel' | 'e_only';
/** 실출력 분류별 F 한계 (mm/min) — 규격서 §8 초안 (도포/트래블/E 단독). 키 이름은 원본 그대로(e_only) */
export const PRINT_F_LIMITS: Readonly<Record<Task0FKind, number>> = Object.freeze({
  deposit: 1800,
  travel: 6000,
  e_only: 1800,
});

export const START_MARKER = '; EXECUTABLE_BLOCK_START';
export const END_MARKER = '; EXECUTABLE_BLOCK_END';
export const LAYER_MARKER = ';LAYER_CHANGE';
const Z_MARKER_PREFIX = ';Z:';

const MOVE_CMDS = new Set(['G0', 'G1']);
const AXES = 'XYZE'; // 출력 순서 (F는 항상 마지막)
const AXES_NO_E = 'XYZ'; // 드라이런 E 제거 모드
const AXES_AND_F = 'XYZEF'; // G0/G1 인자 글자
const TOOL_CMDS = new Set(['T0', 'T1']);

// 드라이런 통과 명령 (주석만 뗀 원문 그대로). keepE=true면 DRYRUN_E_CMDS도 통과, false면 경고 없이 버림
const DRYRUN_PASS = new Set(['G28', 'G90', 'G91', 'G92', 'M400']);
const DRYRUN_E_CMDS = new Set(['M83', 'M82', 'T0', 'T1']);
// 실출력 통과 명령 (G92는 인자 검사 후 E만 있을 때 따로 판정)
const PRINT_PASS = new Set(['G90', 'M83', 'T0', 'T1', 'M400']);
// 실출력 금지 명령 → errors (사유)
const PRINT_FORBIDDEN: Record<string, string> = {
  G28: '출력 중 호밍 금지 (호밍은 Task0 시작 시퀀스만)',
  G91: '상대 좌표 금지 (G90 절대 좌표만)',
  M82: 'E 절대 모드 금지 (M83 필수)',
};

// 숫자 텍스트: 부호 + ASCII 10진수만 ('1e3', 'nan', '1_000', 전각 숫자 거부)
const NUM = '[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)';
const NUM_RE = new RegExp(`^${NUM}$`);
// G0/G1 인자 1개 = 공백 + 글자 + 숫자, 뒤는 공백 또는 끝. 원본 re.ASCII → \s 는 ASCII 6자만
const MOVE_ARG_RE = new RegExp(`[ \\t\\n\\r\\v\\f]+([XYZEFxyzef])(${NUM})(?=[ \\t\\n\\r\\v\\f]|$)`, 'g');
// G92 인자 1개 = 공백 + 글자(X/Y/Z/E) + 숫자 — 숫자 규칙은 이동 줄과 같음 (G92 E1e3 → Klipper E1·E3 방지)
const G92_ARG_RE = new RegExp(`[ \\t\\n\\r\\v\\f]+([XYZExyze])(${NUM})(?=[ \\t\\n\\r\\v\\f]|$)`, 'g');
const HUGE_NUM_LEN = 300; // 이보다 긴 인자 텍스트만 float 무한대 검사

const TOL = 0.001; // Z 검증 허용 오차 (규격서 §11 거부 조건 7: ±0.001)
const EPS = 1e-9; // 부동소수 경계 보정
const MAX_REFS = 5; // 경고 1줄에 표시할 줄/층 번호 수
const MAX_UNKNOWN_KINDS = 20; // 알 수 없는 명령을 명령별로 따로 표시하는 최대 종류 수
const MAX_CMD_NAME = 40; // 경고에 표시할 명령 이름 최대 길이 (코드 포인트)

const F_KINDS: readonly Task0FKind[] = ['deposit', 'travel', 'e_only']; // 원본 dict 순서 (검사 순서)
const F_KIND_LABEL: Record<Task0FKind, string> = { deposit: '도포', travel: '트래블', e_only: 'E 단독' };

// ==================== 타입 ====================

export interface GcodeBlock {
  /** 전송할 줄들을 '\n'으로 연결 (비어 있을 수 있음) */
  gcode: string;
  /** false = 프리앰블 */
  isLayer: boolean;
  /** 0-based 층 번호 (프리앰블 null) */
  layerIndex: number | null;
  /** 블록 시작 줄 번호(1-based): 층은 ;LAYER_CHANGE 줄, 프리앰블은 첫 명령 줄 */
  lineNo: number;
  /** 층의 첫 순수 Z 이동 값 (mm, 없으면 null) */
  z: number | null;
  /** ;Z: 값 (mm, 없으면 null) */
  markerZ: number | null;
  /** 출력 줄에 X/Y 이동이 있는지 (false = 프리앰블/빈 층 → §9 3~5단계 생략 대상) */
  hasXy: boolean;
}

export interface ParseResult {
  /** 프리앰블(있으면 0번) + 층 순서 */
  blocks: GcodeBlock[];
  /** 카테고리별 1줄로 집계 */
  warnings: string[];
  /** mode='print'에서만 채움 (dryrun은 모든 위반이 warnings) */
  errors: string[];
  /** 담은 실제 층 블록 수 (프리앰블 제외) */
  layerCount: number;
  /** ; EXECUTABLE_BLOCK_END 를 만났는지 */
  endFound: boolean;
}

export type Task0ParseMode = 'dryrun' | 'print';

export interface Task0ParseOptions {
  /** 'dryrun' | 'print' (그 외 throw). print는 항상 E 유지(keepE 무시). 기본 'dryrun' */
  mode?: Task0ParseMode;
  /** dryrun 전용. false = E 제거 + M83/M82/T0/T1 버림, true = E 유지 + 통과. 기본 false */
  keepE?: boolean;
  /** 실제 층 블록 수 제한, 0 = 전체 (프리앰블은 세지 않음). 기본 0 */
  maxLayers?: number;
  /** 층두께 (mm) — 주어지면 층 Z = (N+1)×층두께 검증. 기본 null */
  layerHeightMm?: number | null;
  /** print 분류별 F 한계 (mm/min) — 빠진 키는 PRINT_F_LIMITS. 값이 undefined 인 키는 없는 것으로 본다 */
  fLimits?: Partial<Record<Task0FKind, number>> | null;
  /** print 순수 Z 줄 F (mm/min, 슬라이서 F 무시). 기본 Z_SPEED_F */
  zSpeedF?: number;
}

// ==================== Python 의미 보조 ====================

/** Python str.isspace() 와 같은 공백 판정 (전부 BMP — 서로게이트 아님) */
function isPyWs(c: number): boolean {
  if (c <= 0x20) return c === 0x20 || (c >= 0x09 && c <= 0x0d) || (c >= 0x1c && c <= 0x1f);
  if (c < 0x85) return false;
  return (
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** Python str.strip() */
function pyStrip(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && isPyWs(s.charCodeAt(a))) a++;
  while (b > a && isPyWs(s.charCodeAt(b - 1))) b--;
  return a === 0 && b === s.length ? s : s.slice(a, b);
}

/** Python str.rstrip() */
function pyRstrip(s: string): string {
  let b = s.length;
  while (b > 0 && isPyWs(s.charCodeAt(b - 1))) b--;
  return b === s.length ? s : s.slice(0, b);
}

/** Python str.split() (인자 없음 — 공백 연속을 하나로, 빈 토큰 없음) */
function pySplit(s: string): string[] {
  const out: string[] = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    while (i < n && isPyWs(s.charCodeAt(i))) i++;
    if (i >= n) break;
    const start = i;
    while (i < n && !isPyWs(s.charCodeAt(i))) i++;
    out.push(s.slice(start, i));
  }
  return out;
}

/** i 위치 코드 포인트의 UTF-16 길이 (서로게이트 쌍이면 2, 홀로 선 서로게이트는 1 — Python 과 같은 셈) */
function cpWidth(s: string, i: number): number {
  const c = s.charCodeAt(i);
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
    const d = s.charCodeAt(i + 1);
    if (d >= 0xdc00 && d <= 0xdfff) return 2;
  }
  return 1;
}

/** Python len(s) — 코드 포인트 수 */
function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i += cpWidth(s, i)) n++;
  return n;
}

/** Python s[:count] — 앞 count 코드 포인트 */
function cpHead(s: string, count: number): string {
  let i = 0;
  for (let k = 0; k < count && i < s.length; k++) i += cpWidth(s, i);
  return s.slice(0, i);
}

/** 양의 유한 double 의 정확한 10진 전개: value = 0.digits × 10^decpt (digits 끝 0 없음) */
function exactDecimal(x: number): { digits: string; decpt: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << BigInt(32)) | BigInt(lo);
  let e2: number;
  if (expBits === 0) {
    e2 = -1074; // 비정규수
  } else {
    mant |= BigInt(1) << BigInt(52);
    e2 = expBits - 1075;
  }
  let s: string;
  let decpt: number;
  if (e2 >= 0) {
    s = (mant << BigInt(e2)).toString();
    decpt = s.length;
  } else {
    // mant × 2^e2 = mant × 5^(-e2) / 10^(-e2)
    s = (mant * BigInt(5) ** BigInt(-e2)).toString();
    decpt = s.length + e2;
  }
  let end = s.length;
  while (end > 1 && s.charCodeAt(end - 1) === 0x30) end--;
  return { digits: s.slice(0, end), decpt };
}

/**
 * 10진 전개를 앞 keep 자리로 half-even 반올림 (keep ≥ 0, keep < digits.length).
 * 결과 digits 는 끝 0 제거, 0 이 되면 ''.
 */
function roundDigitsHalfEven(digits: string, decpt: number, keep: number): { digits: string; decpt: number } {
  const head = digits.slice(0, keep);
  const next = digits.charCodeAt(keep) - 0x30;
  let restNonZero = false;
  for (let i = keep + 1; i < digits.length; i++) {
    if (digits.charCodeAt(i) !== 0x30) {
      restNonZero = true;
      break;
    }
  }
  const lastOdd = keep > 0 && (head.charCodeAt(keep - 1) - 0x30) % 2 === 1;
  const up = next > 5 || (next === 5 && (restNonZero || lastOdd));
  let out = head;
  let outDecpt = decpt;
  if (up) {
    const inc = (keep > 0 ? BigInt(head) + BigInt(1) : BigInt(1)).toString();
    if (inc.length > keep) outDecpt += 1; // 999 → 1000 자리 올림
    out = inc.length > keep ? inc.slice(0, Math.max(keep, 1)) : inc.padStart(keep, '0');
  }
  let end = out.length;
  while (end > 0 && out.charCodeAt(end - 1) === 0x30) end--;
  return { digits: out.slice(0, end), decpt: outDecpt };
}

/** Python f"{value:g}" (유효 6자리, half-even) — 원본 _fmt_num */
function fmtNum(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  const neg = value < 0 || Object.is(value, -0);
  const ax = Math.abs(value);
  if (ax === Infinity) return neg ? '-inf' : 'inf';
  let digits = '0';
  let decpt = 1;
  if (ax !== 0) {
    const ex = exactDecimal(ax);
    const r = ex.digits.length > 6 ? roundDigitsHalfEven(ex.digits, ex.decpt, 6) : ex;
    digits = r.digits;
    decpt = r.decpt;
  }
  let body: string;
  if (decpt <= -4 || decpt > 6) {
    const exp = decpt - 1;
    body =
      digits[0] +
      (digits.length > 1 ? '.' + digits.slice(1) : '') +
      'e' +
      (exp < 0 ? '-' : '+') +
      String(Math.abs(exp)).padStart(2, '0');
  } else if (decpt <= 0) {
    body = '0.' + '0'.repeat(-decpt) + digits;
  } else if (decpt >= digits.length) {
    body = digits + '0'.repeat(decpt - digits.length);
  } else {
    body = digits.slice(0, decpt) + '.' + digits.slice(decpt);
  }
  return (neg ? '-' : '') + body;
}

/** Z 관련 위반 문구 소수 자리 — 원본 _fmt_z */
const Z_DECIMALS = 4;

/**
 * Python f"{value:.4f}" — 원본 _fmt_z (Z 관련 위반 문구 숫자, 소수 4자리 고정).
 * 정확한 10진 전개에서 소수 4자리 half-even, 정수부는 자리 전부(지수 표기 없음), 음수 부호는 0 이 돼도 남는다('-0.0000').
 */
function fmtZ(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  const neg = value < 0 || Object.is(value, -0);
  const ax = Math.abs(value);
  if (ax === Infinity) return neg ? '-inf' : 'inf';
  // value = 0.digits × 10^decpt (digits '' = 0)
  let digits = '';
  let decpt = 0;
  if (ax !== 0) {
    const ex = exactDecimal(ax);
    const keep = ex.decpt + Z_DECIMALS; // 소수 4째 자리까지의 자릿수
    if (keep >= ex.digits.length) {
      digits = ex.digits;
      decpt = ex.decpt;
    } else if (keep >= 0) {
      const r = roundDigitsHalfEven(ex.digits, ex.decpt, keep);
      digits = r.digits;
      decpt = r.decpt;
    } // keep < 0: 0.5×10^-4 보다 작음 → 0
  }
  const digitAt = (i: number): string => (i >= 0 && i < digits.length ? digits[i] : '0');
  let intPart = '';
  for (let i = 0; i < decpt; i++) intPart += digitAt(i);
  let frac = '';
  for (let i = 0; i < Z_DECIMALS; i++) frac += digitAt(decpt + i);
  return (neg ? '-' : '') + (intPart === '' ? '0' : intPart) + '.' + frac;
}

/** Python max(1, int(round(value))) 를 10진 문자열로 — 원본 _f_int (F 출력값) */
function fIntText(value: number): string {
  let r = Math.floor(value);
  const d = value - r; // 정확 (소수부)
  if (d > 0.5 || (d === 0.5 && r % 2 !== 0)) r += 1; // half-even
  if (r < 1) return '1';
  return Number.isSafeInteger(r) ? String(r) : BigInt(r).toString();
}

/** Python repr(float) */
function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const [mant, expText] = Math.abs(x).toExponential().split('e');
  const digits = mant.replace('.', '');
  const decpt = Number(expText) + 1;
  let body: string;
  if (decpt <= -4 || decpt > 16) {
    const exp = decpt - 1;
    body =
      digits[0] +
      (digits.length > 1 ? '.' + digits.slice(1) : '') +
      'e' +
      (exp < 0 ? '-' : '+') +
      String(Math.abs(exp)).padStart(2, '0');
  } else if (decpt <= 0) {
    body = '0.' + '0'.repeat(-decpt) + digits;
  } else if (decpt >= digits.length) {
    body = digits + '0'.repeat(decpt - digits.length) + '.0';
  } else {
    body = digits.slice(0, decpt) + '.' + digits.slice(decpt);
  }
  return sign + body;
}

const NON_PRINTABLE_RE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

/** Python repr(str) */
function pyStrRepr(s: string): string {
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (ch === quote || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (c < 0x20 || c === 0x7f) out += '\\x' + c.toString(16).padStart(2, '0');
    else if (c < 0x7f) out += ch;
    else if (!NON_PRINTABLE_RE.test(ch)) out += ch;
    else if (c <= 0xff) out += '\\x' + c.toString(16).padStart(2, '0');
    else if (c <= 0xffff) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += '\\U' + c.toString(16).padStart(8, '0');
  }
  return out + quote;
}

/** Python repr(value) — 인자 오류 메시지용 (안전 정수 number 는 Python int 로 본다) */
function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : pyFloatRepr(value);
  if (typeof value === 'string') return pyStrRepr(value);
  return String(value);
}

/** Python 처럼 코드 포인트 순 정렬 */
function sortedByCodePoint(items: string[]): string[] {
  return [...items].sort((a, b) => {
    const pa = Array.from(a);
    const pb = Array.from(b);
    const n = Math.min(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const d = (pa[i].codePointAt(0) ?? 0) - (pb[i].codePointAt(0) ?? 0);
      if (d !== 0) return d;
    }
    return pa.length - pb.length;
  });
}

/** Python ValueError 대응 */
function valueError(message: string): Error {
  const e = new Error(message);
  e.name = 'ValueError';
  return e;
}

/** 원본 _check_positive — 양의 유한 수가 아니면 throw, 맞으면 number 로 돌려준다 */
function checkPositive(name: string, value: unknown): number {
  let ok = false;
  if (typeof value === 'number') {
    ok = Number.isFinite(value) && value > 0;
  } else if (typeof value === 'bigint') {
    ok = Number.isFinite(Number(value)) && value > BigInt(0); // float 로 못 바꾸는 큰 int → 거부 (원본 OverflowError)
  }
  if (!ok) throw valueError(`${name}는 양의 유한 수 (받은 값: ${pyRepr(value)})`);
  return Number(value);
}

// ==================== 공개 함수 ====================

/** ';' 이후(주석) 제거 + 앞뒤 공백 제거 */
export function stripComment(line: string): string {
  const semi = line.indexOf(';');
  return pyStrip(semi >= 0 ? line.slice(0, semi) : line);
}

/**
 * 수동 Send 칸용 — G0/G1 한 줄을 드라이런 규칙으로 정리 (주석 제거 후 처리)
 * @returns "G1 X.. Y.. Z.. [E..] F{FIXED_SPEED_F}" / 남는 축이 없거나 잘못된 줄이면 null
 */
export function normalizeDryrunMotion(line: string, keepE: boolean): string | null {
  const code = stripComment(line);
  if (!code) return null;
  const tokens = pySplit(code);
  const cmd = tokens[0].toUpperCase();
  if (!MOVE_CMDS.has(cmd)) return null;
  const params = parseMoveArgs(code.slice(tokens[0].length), tokens.length - 1);
  if (params === null) return null;
  return formatMove(cmd, params, keepE ? AXES : AXES_NO_E, String(FIXED_SPEED_F));
}

/**
 * 첫 토큰이 공백 없이 붙은 이동 명령인지 (`G1X10`, `g0z5` — Klipper는 G1 + X10으로 읽음)
 * G0/G1 바로 뒤가 축 글자(X/Y/Z/E/F)인 경우만 true. `G10`/`G11`/`G17` 등 다른 G 코드는 false
 */
export function isUnspacedMove(token: string): boolean {
  const t = cpHead(token, 3).toUpperCase();
  if (cpLength(t) !== 3) return false;
  const head2 = cpHead(t, 2);
  return MOVE_CMDS.has(head2) && AXES_AND_F.includes(t.slice(head2.length));
}

/**
 * G-code 줄들을 블록(프리앰블 + 층)으로 분할·정리·검증 — 원본 parse_gcode_lines
 * 잘못된 인자는 throw (name 'ValueError', 메시지는 원본과 같음 — 인자 이름도 원본 snake_case)
 */
export function parseGcodeLines(lines: Iterable<string>, opts: Task0ParseOptions = {}): ParseResult {
  const mode: unknown = opts.mode === undefined ? 'dryrun' : opts.mode;
  if (mode !== 'dryrun' && mode !== 'print') {
    throw valueError(`mode는 'dryrun' 또는 'print' (받은 값: ${pyRepr(mode)})`);
  }
  const lhRaw: unknown = opts.layerHeightMm;
  const lh = lhRaw === undefined || lhRaw === null ? null : checkPositive('layer_height_mm', lhRaw);

  const merged: Record<string, unknown> = { ...PRINT_F_LIMITS };
  const fLimits = opts.fLimits as Record<string, unknown> | null | undefined;
  if (fLimits) {
    const keys = Object.keys(fLimits).filter((k) => fLimits[k] !== undefined);
    if (keys.length > 0) {
      const unknown = keys.filter((k) => !Object.prototype.hasOwnProperty.call(PRINT_F_LIMITS, k));
      if (unknown.length > 0) {
        const known = sortedByCodePoint([...F_KINDS]).map(pyRepr).join(', ');
        const got = sortedByCodePoint(unknown).map(pyRepr).join(', ');
        throw valueError(`f_limits 키는 [${known}]만 (받은 키: [${got}])`);
      }
      for (const k of keys) merged[k] = fLimits[k];
    }
  }
  const limits = {} as Record<Task0FKind, number>;
  for (const key of F_KINDS) limits[key] = checkPositive(`f_limits[${pyRepr(key)}]`, merged[key]);
  const zSpeedF = checkPositive('z_speed_f', opts.zSpeedF === undefined ? Z_SPEED_F : opts.zSpeedF);

  const parser = new Parser(mode, Boolean(opts.keepE), opts.maxLayers, lh, limits, zSpeedF);
  return parser.run(lines);
}

/**
 * 파일 내용 파싱 — 원본 parse_gcode_file 의 문자열판 (인자는 parseGcodeLines 와 같음)
 * text 는 BOM 을 남긴 채 디코드한 문자열(TextDecoder 라면 ignoreBOM: true)을 넘긴다 — 여기서 맨 앞 BOM 1개만
 * 지운다(utf-8-sig). 줄 나누기는 Python 텍스트 모드와 같다: \r\n·\r·\n 이 줄 끝, 마지막 줄 끝 없으면 그대로 한 줄.
 */
export function parseGcodeText(text: string, opts: Task0ParseOptions = {}): ParseResult {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return parseGcodeLines(iterTextLines(body), opts);
}

// ==================== 내부 ====================

/** Python 텍스트 모드 파일 반복 — 줄 끝 문자는 떼고 돌려준다 (파서는 줄마다 strip 만 쓰므로 결과 같음) */
function* iterTextLines(text: string): Generator<string> {
  const n = text.length;
  let start = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x0a || c === 0x0d) {
      yield text.slice(start, i);
      if (c === 0x0d && i + 1 < n && text.charCodeAt(i + 1) === 0x0a) i++;
      start = i + 1;
    }
  }
  if (start < n) yield text.slice(start);
}

type MoveParams = Map<string, string>;

/**
 * 인자 파싱 공통 → {대문자 글자: 원래 숫자 텍스트}. 규칙 위반이면 null — 원본 _parse_args
 * rest = 명령 토큰 뒤 문자열, ntok = 그 안의 공백 분리 토큰 수, argRe = 허용 글자별 정규식(g 플래그).
 * 각 토큰 = 허용 글자 1개 + 10진수, 유한값, 같은 글자 중복 금지. 인자 0개면 빈 Map
 */
function parseArgs(rest: string, ntok: number, argRe: RegExp): MoveParams | null {
  const upper = rest.toUpperCase();
  const params: MoveParams = new Map();
  let pairs = 0;
  argRe.lastIndex = 0;
  for (let m = argRe.exec(upper); m !== null; m = argRe.exec(upper)) {
    pairs++;
    params.set(m[1], m[2]); // dict(pairs) — 중복 글자는 뒤 값
  }
  if (pairs !== ntok) return null;
  if (params.size !== ntok) return null; // 같은 글자 중복
  if (rest.length > HUGE_NUM_LEN && cpLength(rest) > HUGE_NUM_LEN) {
    for (const v of params.values()) if (!Number.isFinite(Number(v))) return null;
  }
  return params;
}

/**
 * G0/G1 인자 파싱 (글자 X/Y/Z/E/F, F > 0) → {대문자 글자: 원래 숫자 텍스트}. 규칙 위반이면 null
 */
function parseMoveArgs(rest: string, ntok: number): MoveParams | null {
  const params = parseArgs(rest, ntok, MOVE_ARG_RE);
  if (params === null) return null;
  const f = params.get('F');
  if (f !== undefined && Number(f) <= 0) return null; // Klipper가 거부하는 속도 (F0/음수)
  return params;
}

/** '{G0|G1} X.. Y.. Z.. E.. F..' — axes 중 있는 축만 이 순서로, 원래 숫자 텍스트 그대로. 남는 축이 없으면 null */
function formatMove(cmd: string, params: MoveParams, axes: string, fText: string): string | null {
  const parts: string[] = [];
  for (const a of axes) {
    const v = params.get(a);
    if (v !== undefined) parts.push(a + v);
  }
  if (parts.length === 0) return null;
  return `${cmd} ${parts.join(' ')} F${fText}`;
}

type KwValue = string | number;

/** 경고/위반 카테고리 1개 — 메시지 1줄로 집계 */
class Category {
  count = 0;
  refs: number[] = [];
  peak: number | null = null;

  constructor(
    readonly template: string,
    readonly refLabel: string,
    readonly violation: boolean,
    readonly kw: Record<string, KwValue>,
  ) {}

  message(): string {
    let refs = '';
    if (this.refs.length > 0) {
      const more = this.count > this.refs.length ? ' …' : '';
      refs = ` (${this.refLabel} ${this.refs.join(', ')}${more})`;
    }
    const values: Record<string, KwValue> = {
      n: this.count,
      refs,
      peak: this.peak !== null ? fmtNum(this.peak) : '',
      ...this.kw,
    };
    return this.template.replace(/\{(\w+)\}/g, (_m, key: string) => String(values[key]));
  }
}

interface AddOptions {
  ref?: number;
  violation?: boolean;
  refLabel?: string;
  peak?: number;
  kw?: Record<string, KwValue>;
}

/** 카테고리별 집계 (처음 나온 순서 유지) */
class Tally {
  private cats = new Map<string, Category>();

  add(key: string, template: string, o: AddOptions = {}): Category {
    let cat = this.cats.get(key);
    if (cat === undefined) {
      cat = new Category(template, o.refLabel ?? '줄', o.violation ?? false, o.kw ?? {});
      this.cats.set(key, cat);
    }
    cat.count += 1;
    if (o.ref !== undefined && cat.refs.length < MAX_REFS) cat.refs.push(o.ref);
    if (o.peak !== undefined && (cat.peak === null || o.peak > cat.peak)) cat.peak = o.peak;
    return cat;
  }

  has(key: string): boolean {
    return this.cats.has(key);
  }

  /** [warnings, errors] — print 모드의 위반만 errors */
  split(isPrint: boolean): [string[], string[]] {
    const warnings: string[] = [];
    const errors: string[] = [];
    for (const cat of this.cats.values()) (isPrint && cat.violation ? errors : warnings).push(cat.message());
    return [warnings, errors];
  }
}

/** 알 수 없는 명령 집계 키 — 원본 튜플 키 ("unknown", name) */
const unknownKey = (name: string): string => `\u0000unknown\u0000${name}`;

/** parseGcodeLines 본체 (1회용) */
class Parser {
  private readonly isPrint: boolean;
  private readonly keepE: boolean;
  private readonly dryAxes: string;
  private readonly maxLayers: number;
  private readonly tally = new Tally();
  private readonly blocks: GcodeBlock[] = [];
  private layerCount = 0;
  private modalF: number | null = null; // Klipper F modal 추적 (원본 F, 클램프 전)
  private prevZ: number | null = null; // 직전(마지막으로 Z가 있던) 층의 z
  private readonly unknownKinds = new Set<string>();
  private readonly unknownOther = new Set<string>();

  // 블록 상태
  private inLayer = false;
  private lines: string[] = [];
  private hasXy = false;
  private blockLine: number | null = null;
  private markerSeen = false;
  private markerZ: number | null = null;
  private firstZ: number | null = null; // 층의 첫 순수 Z 이동 값
  private badFirst = false; // 첫 순수 Z 전에 T/XY/E 이동이 나옴

  constructor(
    mode: Task0ParseMode,
    keepE: boolean,
    maxLayers: number | undefined,
    private readonly lh: number | null,
    private readonly limits: Record<Task0FKind, number>,
    private readonly zSpeedF: number,
  ) {
    this.isPrint = mode === 'print';
    this.keepE = this.isPrint ? true : keepE;
    this.dryAxes = this.keepE ? AXES : AXES_NO_E;
    this.maxLayers = maxLayers && maxLayers > 0 ? maxLayers : 0;
    this.resetBlock(false, 0);
  }

  // ---------- 블록 상태 ----------

  private resetBlock(inLayer: boolean, lineNo: number): void {
    this.inLayer = inLayer;
    this.lines = [];
    this.hasXy = false;
    this.blockLine = inLayer ? lineNo : null; // 프리앰블은 첫 명령 줄에서 설정
    this.markerSeen = false;
    this.markerZ = null;
    this.firstZ = null;
    this.badFirst = false;
  }

  /** 현재 블록 마감 — 층은 항상 추가(빈 층 포함), 프리앰블은 출력 줄이 있을 때만 */
  private closeBlock(): void {
    if (this.inLayer) {
      const idx = this.layerCount;
      this.checkLayer(idx);
      this.blocks.push({
        gcode: this.lines.join('\n'),
        isLayer: true,
        layerIndex: idx,
        lineNo: this.blockLine ?? 0,
        z: this.firstZ,
        markerZ: this.markerZ,
        hasXy: this.hasXy,
      });
      this.layerCount += 1;
    } else if (this.lines.length > 0) {
      this.blocks.push({
        gcode: this.lines.join('\n'),
        isLayer: false,
        layerIndex: null,
        lineNo: this.blockLine || 0,
        z: null,
        markerZ: null,
        hasXy: this.hasXy,
      });
    }
  }

  /** 층 검증 (규격서 §3 불변식 1, §4-3, §11-7) — 위반은 카테고리별 집계, 층 번호는 1-based 표시 */
  private checkLayer(idx: number): void {
    const t = this.tally;
    const n = idx + 1;
    const z = this.firstZ;
    const mz = this.markerZ;
    if (this.badFirst || z === null) {
      t.add('first_not_z', '층 첫 이동이 G1 Z가 아님 {n}층{refs} — XY·E·T보다 G1 Z가 먼저 (규격서 §3 불변식 1)', {
        ref: n,
        violation: true,
        refLabel: '층',
      });
    }
    if (!this.markerSeen) {
      t.add('no_zmarker', ';Z: 마커 없는 층 {n}개{refs} (규격서 §4-3)', { ref: n, violation: true, refLabel: '층' });
    }
    if (z !== null && mz !== null && Math.abs(z - mz) > TOL + EPS) {
      // 첫 사례 값은 카테고리가 처음 생길 때만 기록 (원본 _first_kw)
      const kw: Record<string, KwValue> = t.has('z_mismatch') ? {} : { k: n, m: fmtZ(mz), z: fmtZ(z) };
      t.add('z_mismatch', ';Z:와 G1 Z 불일치 {n}층{refs} — 첫 사례 층 {k}: ;Z:{m} ≠ G1 Z{z}', {
        ref: n,
        violation: true,
        refLabel: '층',
        kw,
      });
    }
    if (this.lh !== null && z !== null) {
      const expect = (idx + 1) * this.lh;
      if (Math.abs(z - expect) > TOL + EPS) {
        const kw: Record<string, KwValue> = t.has('z_lh')
          ? {}
          : { lh: fmtZ(this.lh), k: n, z: fmtZ(z), e: fmtZ(expect) };
        t.add('z_lh', 'Z ≠ (N+1)×층두께 {n}층{refs} — 층두께 {lh}, 첫 사례 층 {k}: Z{z} (기대 Z{e})', {
          ref: n,
          violation: true,
          refLabel: '층',
          kw,
        });
      }
    }
    if (z !== null) {
      if (this.prevZ !== null && z < this.prevZ - TOL - EPS) {
        const kw: Record<string, KwValue> = t.has('z_down') ? {} : { k: n, z: fmtZ(z), p: fmtZ(this.prevZ) };
        t.add('z_down', 'Z가 이전 층보다 작음 {n}층{refs} — 첫 사례 층 {k}: Z{z} < 이전 Z{p}', {
          ref: n,
          violation: true,
          refLabel: '층',
          kw,
        });
      }
      this.prevZ = z;
    }
  }

  // ---------- 본체 ----------

  run(lines: Iterable<string>): ParseResult {
    const t = this.tally;
    // 반복자를 직접 돌린다 — for..of 의 break 는 제너레이터를 닫아 END 뒤 집계를 못 한다
    const it = lines[Symbol.iterator]();
    let lineNo = 0;
    let started = false;
    let endFound = false;
    let stopped = false;

    for (let step = it.next(); !step.done; step = it.next()) {
      lineNo += 1;
      const s = pyStrip(step.value);
      if (!started) {
        if (s === START_MARKER) started = true;
        continue;
      }
      if (!s) continue;
      if (s.charCodeAt(0) === 0x3b /* ; */) {
        if (s === LAYER_MARKER) {
          this.closeBlock();
          if (this.maxLayers && this.layerCount >= this.maxLayers) {
            stopped = true; // 제한 도달 — 다음 층은 담지 않음 (마지막 층 중복 추가 없음)
            break;
          }
          this.resetBlock(true, lineNo);
        } else if (s === END_MARKER) {
          this.closeBlock();
          endFound = true;
          break;
        } else if (this.inLayer && !this.markerSeen && s.startsWith(Z_MARKER_PREFIX)) {
          this.markerSeen = true;
          this.parseZMarker(s, lineNo);
        }
        continue;
      }
      this.command(s, lineNo);
    }

    if (!started) {
      t.add('no_start', 'EXECUTABLE_BLOCK_START 마커 없음 — 실행할 블록 없음 (규격서 §4-3)', { violation: true });
    } else if (endFound) {
      // END 뒤 명령은 무시 (개수만 셈)
      for (let step = it.next(); !step.done; step = it.next()) {
        lineNo += 1;
        const s = pyStrip(step.value);
        if (s && s.charCodeAt(0) !== 0x3b) {
          t.add('after_end', 'EXECUTABLE_BLOCK_END 뒤 명령 {n}줄 무시{refs} (규격서 §4-2)', { ref: lineNo });
        }
      }
    } else if (!stopped) {
      this.closeBlock(); // 파일 끝 (END 없음 — END는 필수 아님, §4-2)
    }

    const [warnings, errors] = t.split(this.isPrint);
    return { blocks: this.blocks, warnings, errors, layerCount: this.layerCount, endFound };
  }

  /** 층 안 첫 ;Z: 값 — 파싱 실패는 위반 */
  private parseZMarker(s: string, lineNo: number): void {
    const text = pyStrip(s.slice(Z_MARKER_PREFIX.length));
    let val: number | null = null;
    if (NUM_RE.test(text)) {
      val = Number(text);
      if (!Number.isFinite(val)) val = null;
    }
    if (val === null) {
      this.tally.add('bad_zmarker', '잘못된 ;Z: 값 {n}줄{refs}', { ref: lineNo, violation: true });
    } else {
      this.markerZ = val;
    }
  }

  /** 명령 줄 1개 (빈 줄·';' 시작 줄 아님) */
  private command(s: string, lineNo: number): void {
    const t = this.tally;
    const semi = s.indexOf(';');
    let code: string;
    if (semi >= 0) {
      code = pyRstrip(s.slice(0, semi));
      // 집계 키는 내부용(출력에 안 나옴) — 원본 키(영단어 '인라인')를 그대로 쓰면 Tailwind 가 display 클래스로
      // 읽어 빌드 CSS 가 바뀐다(src/**/*.ts 스캔). 그래서 이름만 바꿈
      t.add('trailing_comment', '명령 줄 끝 주석 {n}줄{refs} — 주석 떼고 실행 (규격서 §4-2)', { ref: lineNo });
    } else {
      code = s;
    }
    if (this.blockLine === null) this.blockLine = lineNo; // 프리앰블 시작 = 첫 명령 줄

    const tokens = pySplit(code);
    const cmd = tokens[0].toUpperCase();
    if (MOVE_CMDS.has(cmd)) {
      this.move(cmd, code.slice(tokens[0].length), tokens.length - 1, lineNo);
      return;
    }
    if (isUnspacedMove(cmd)) {
      // G1X10 — Klipper는 이동으로 실행하지만 여기서 버리면 G90 웨이포인트가 빠짐 → 위반
      t.add('unspaced_move', '공백 없는 이동 줄 {n}줄{refs} — 버림 (명령과 인자 사이 공백 필수, 규격서 §4-1)', {
        ref: lineNo,
        violation: true,
      });
      return;
    }

    // 불변식 1은 모드 필터 이전 원본 기준 (dryrun E 제거 모드에서 T가 버려져도 검출)
    if (TOOL_CMDS.has(cmd) && this.inLayer && this.firstZ === null) this.badFirst = true;

    if (cmd === 'MANUAL_STEPPER') {
      t.add('blade', '블레이드 명령(MANUAL_STEPPER) {n}줄 제거{refs} — Task0가 삽입 (규격서 §4-2)', { ref: lineNo });
      return;
    }

    if (this.isPrint) {
      if (PRINT_PASS.has(cmd)) {
        this.lines.push(code);
        return;
      }
      if (cmd === 'G92') {
        const args = this.g92Args(code, tokens, lineNo);
        if (args === null) return; // 잘못된 G92 줄 — 버림 (위반 집계는 g92Args)
        if (g92ResetsXyz(args)) {
          t.add('p_g92', 'G92 좌표 재설정 {n}줄{refs} — X/Y/Z 재설정 금지 (G92 E만 허용)', {
            ref: lineNo,
            violation: true,
          });
        } else {
          this.lines.push(code);
        }
        return;
      }
      const reason = Object.prototype.hasOwnProperty.call(PRINT_FORBIDDEN, cmd) ? PRINT_FORBIDDEN[cmd] : undefined;
      if (reason !== undefined) {
        t.add('p_' + cmd, '{cmd} {n}줄{refs} — {reason}', { ref: lineNo, violation: true, kw: { cmd, reason } });
        return;
      }
    } else {
      if (DRYRUN_PASS.has(cmd)) {
        if (cmd === 'G92') {
          const args = this.g92Args(code, tokens, lineNo);
          if (args === null) return; // 잘못된 G92 줄 — 버림 (경고 집계는 g92Args)
          if (g92ResetsXyz(args)) {
            t.add('g92_xyz', 'G92 좌표 재설정(X/Y/Z) {n}줄{refs} — 층 Z 기준이 틀어질 수 있음', { ref: lineNo });
          }
        }
        this.lines.push(code);
        return;
      }
      if (DRYRUN_E_CMDS.has(cmd)) {
        if (this.keepE) this.lines.push(code);
        return; // E 제거 모드: 경고 없이 버림
      }
    }

    this.unknown(cmd, lineNo);
  }

  /**
   * G92 인자 검사 (두 모드 공통) → {대문자 글자: 숫자 텍스트}, 인자 없으면 빈 Map.
   * 잘못된 줄(X/Y/Z/E 외 글자, 숫자 아님, 같은 글자 중복)은 위반 집계 후 null — 원본 _g92_args
   */
  private g92Args(code: string, tokens: string[], lineNo: number): MoveParams | null {
    const args = parseArgs(code.slice(tokens[0].length), tokens.length - 1, G92_ARG_RE);
    if (args === null) {
      this.tally.add('bad_g92', '잘못된 G92 줄 {n}줄{refs} — 버림 (인자는 X/Y/Z/E + 10진수, 중복 금지)', {
        ref: lineNo,
        violation: true,
      });
    }
    return args;
  }

  /** 알 수 없는 명령 — 버리고 명령별 집계 (종류가 많으면 '그 외'로 합침) */
  private unknown(cmd: string, lineNo: number): void {
    const name = cpLength(cmd) <= MAX_CMD_NAME ? cmd : cpHead(cmd, MAX_CMD_NAME) + '…';
    if (this.unknownKinds.has(name) || this.unknownKinds.size < MAX_UNKNOWN_KINDS) {
      this.unknownKinds.add(name);
      this.tally.add(unknownKey(name), '알 수 없는 명령 버림: {cmd} ×{n}{refs}', { ref: lineNo, kw: { cmd: name } });
    } else {
      this.unknownOther.add(name);
      const cat = this.tally.add('unknown_other', '알 수 없는 명령 버림: 그 외 {kinds}종 ×{n}{refs}', {
        ref: lineNo,
        kw: { kinds: 0 },
      });
      cat.kw.kinds = this.unknownOther.size;
    }
  }

  /** G0/G1 이동 줄 (rest = 명령 토큰 뒤 문자열, ntok = 인자 토큰 수) */
  private move(cmd: string, rest: string, ntok: number, lineNo: number): void {
    const t = this.tally;
    const params = parseMoveArgs(rest, ntok);
    if (params === null) {
      t.add('bad_move', '잘못된 이동 줄 {n}줄{refs} — 버림 (인자는 X/Y/Z/E/F + 10진수, 중복 금지)', {
        ref: lineNo,
        violation: true,
      });
      return;
    }
    if (params.size === 0) {
      // 인자 없는 G0/G1 — F 단독 줄과 같은 등급(경고)이지만 따로 집계. modal F 변화 없음
      t.add('no_args', '인자 없는 이동 줄 {n}줄{refs} — 버림', { ref: lineNo });
      return;
    }
    const fText = params.get('F');
    if (fText !== undefined) this.modalF = Number(fText); // Klipper F modal (F 단독 줄 포함, 클램프 전 값)
    const hasE = params.has('E');
    const hasZ = params.has('Z');
    const xy = params.has('X') || params.has('Y');
    if (!(xy || hasE || hasZ)) {
      t.add('f_only', 'F 단독 줄 {n}줄{refs} — 버림 (규격서 §4-2)', { ref: lineNo });
      return;
    }
    if (hasZ && (xy || hasE)) {
      // 경사 Z-hop 등 — 줄은 그대로 두고(드라이런 F600) 위반만 집계. 프리앰블 포함 전 구간
      t.add('z_mixed', 'Z와 XY/E 동시 이동 {n}줄{refs} — Z는 층 첫 G1 Z 한 줄로만 (규격서 §7)', {
        ref: lineNo,
        violation: true,
      });
    }

    if (this.inLayer) {
      const pureZ = !(xy || hasE);
      if (this.firstZ === null) {
        // 불변식 1 (원본 기준): 첫 순수 Z 이동 전에 XY/E 이동이 나오면 위반
        if (pureZ) this.firstZ = Number(params.get('Z'));
        else this.badFirst = true;
      } else if (pureZ) {
        // 첫 순수 Z 뒤의 순수 Z (수직 Z-hop 등) — 출력은 그대로, 위반만 집계. 섞인 줄은 z_mixed만
        t.add('z_extra', '층 안 Z 이동 {n}줄{refs} — 층 첫 G1 Z 말고는 Z 금지 (규격서 §7)', {
          ref: lineNo,
          violation: true,
        });
      }
    }

    let out: string | null;
    if (this.isPrint) {
      let kind: Task0FKind | null;
      if (xy) kind = hasE ? 'deposit' : 'travel';
      else if (hasE) kind = 'e_only';
      else kind = null; // 순수 Z
      let f: number;
      if (kind === null) {
        f = this.zSpeedF; // 슬라이서 F 무시 (규격서 §8)
      } else {
        f = this.printF(kind, lineNo);
        if (hasZ) f = Math.min(f, this.zSpeedF); // Z 섞인 줄(위반) 방어 — Z 속도를 넘지 않게
      }
      out = formatMove(cmd, params, AXES, fIntText(f));
    } else {
      out = formatMove(cmd, params, this.dryAxes, String(FIXED_SPEED_F));
      if (out === null) return; // E 제거 모드의 E 단독 줄 — 정상 동작, 경고 없음
    }

    this.lines.push(out as string);
    if (xy) this.hasXy = true;
  }

  /** 실출력 F — modal F를 분류별 한계로 클램프. modal 없음 → 한계값 + 경고 */
  private printF(kind: Task0FKind, lineNo: number): number {
    const limit = this.limits[kind];
    const mf = this.modalF;
    if (mf === null) {
      this.tally.add('no_f', 'F 미지정 이동 {n}줄{refs} — 한계값 사용', { ref: lineNo });
      return limit;
    }
    if (mf > limit) {
      this.tally.add('clamp_' + kind, '{label} F 클램프 {n}줄{refs} — 최대 원래 F{peak}, 한계 F{limit}', {
        ref: lineNo,
        peak: mf,
        kw: { label: F_KIND_LABEL[kind], limit: fmtNum(limit) },
      });
      return limit;
    }
    return mf;
  }
}

/** G92(인자 검사 통과)가 X/Y/Z 좌표를 재설정하는지 — 인자 없는 G92는 Klipper에서 전 축 재설정 */
function g92ResetsXyz(args: MoveParams): boolean {
  return args.size === 0 || args.has('X') || args.has('Y') || args.has('Z');
}
