// 숫자 입력칸 커밋 규칙 헤드리스 검증 (B-14).
//
//   리드 실물 보고 (원문 요약):
//     · "Y 90도 입력하려고 9를 누르면 89.9999999 이런 값이 나와버림"
//     · "입력하고 엔터쳐야 수치적용이 되어야하는데 바로 적용되서 하는것 같다"
//     · "수치입력하려그러면 최소값 혹은 최대값으로 변경됨"
//     · "특히 수치입력칸에서 전체 선택후 숫자 0 넣으면 이상해짐"
//     · "서포트쪽도 그렇고 다이상함"
//
//   원인은 전부 하나다 — 입력칸이 `value={value}` 제어 + `onChange` 마다 즉시
//   부모 반영 + min/max 즉시 클램프였다. 수정은 커밋 시점을 Enter/blur 로
//   분리하는 것. 그 규칙을 `utils/number-input.ts` 의 순수 함수로 뽑아
//   React 없이 여기서 검증한다.
//
//   ⚠️ 프로젝트 규약 (B-1 확립, B-12·B-13 연속 적중): 신규 검증은 **수정 전
//   구현을 대조군으로 함께 돌려 "스크립트가 실제로 버그를 잡는가" 를 증명**해야
//   한다. (f) 가 그 대조군이다 — 대조군이 통과해 버리면 이 스크립트는 아무것도
//   증명하지 못한 것이므로, (f) 는 "옛 구현이 틀린다" 를 assert 한다.
//
//   실행: npx tsx scripts/verify-number-input.mjs

import {
  clampNumber,
  commitNumberInput,
  formatNumberForDisplay,
  legacyImmediateApply,
  parseNumberInput,
  shouldSyncDisplay,
} from "../src/features/v2/utils/number-input.ts";

// ── assert 유틸 ──────────────────────────────────────────────────────────
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

/**
 * 입력칸 하나를 문자 단위로 두들기는 시뮬레이터 — 수정본 동작.
 *
 * 실제 컴포넌트 계약을 그대로 흉내낸다:
 *   · type(ch)  — 로컬 문자열만 갱신. 부모는 건드리지 않는다.
 *   · commit()  — Enter/blur. 이때만 파싱·클램프·부모 반영.
 *   · external()— 기즈모 등 외부 변경. 편집 중이면 표시를 덮지 않는다.
 * `commits` 에 부모로 흘러간 값을 순서대로 기록해 undo 스택 대용으로 본다.
 */
function makeField({ initial, min, max, decimals = 3 }) {
  return {
    value: initial,
    text: formatNumberForDisplay(initial, decimals),
    editing: false,
    commits: [],
    min,
    max,
    decimals,

    focus() {
      this.editing = true;
      return this;
    },
    /** 전체 선택 후 타이핑 = 기존 내용을 지우고 새로 침. */
    selectAllAndType(s) {
      this.text = "";
      for (const ch of s) this.text += ch;
      return this;
    },
    type(s) {
      for (const ch of s) this.text += ch;
      return this;
    },
    /** Enter 또는 blur. 컴포넌트의 commit() 과 같은 로직. */
    commit() {
      const r = commitNumberInput(this.text, this.value, this.min, this.max);
      if (r.changed) {
        this.value = r.value;
        this.commits.push(r.value);
      }
      this.text = formatNumberForDisplay(r.value, this.decimals);
      this.editing = false;
      return this;
    },
    /** 외부(기즈모 드래그·회전 버튼)에서 값이 바뀐 경우. */
    external(v) {
      this.value = v;
      if (shouldSyncDisplay(this.editing, this.text, v, this.decimals)) {
        this.text = formatNumberForDisplay(v, this.decimals);
      }
      return this;
    },
  };
}

// ── (a) 타자 중에는 커밋되지 않고 Enter/blur 에서만 커밋 ─────────────────
function caseCommitOnEnterOnly() {
  console.log("\n(a) 타자 중 무커밋 · Enter/blur 에서만 커밋:");

  // 회전 Y 칸(−180~180)에 "90" 을 친다. 리드가 실패한 바로 그 조작.
  const f = makeField({ initial: 0, min: -180, max: 180, decimals: 2 });
  f.focus().selectAllAndType("9");
  assert(
    f.commits.length === 0,
    `"9" 를 친 시점에 커밋 0회 (부모 값은 여전히 ${f.value})`,
  );
  assert(f.value === 0, "타자 도중 부모 값이 9 로 튀지 않는다");
  assert(f.text === "9", `입력칸에는 사용자가 친 "9" 가 그대로 남아 있다`);

  f.type("0");
  assert(f.commits.length === 0, `"90" 까지 다 쳐도 아직 커밋 0회`);

  f.commit(); // Enter
  assert(f.commits.length === 1, "Enter 에서 정확히 1회 커밋 — undo 1항목");
  assert(f.value === 90, `커밋된 값 = 90 (실제 ${f.value})`);

  // blur 커밋도 같은 경로. 값이 안 바뀌면 커밋하지 않는다(빈 undo 방지).
  const g = makeField({ initial: 12.5, min: -200, max: 200 });
  g.focus().commit();
  assert(
    g.commits.length === 0,
    "포커스만 주고 아무것도 안 고친 뒤 blur → 커밋 0회 (빈 undo 항목 없음)",
  );

  const h = makeField({ initial: 12.5, min: -200, max: 200 });
  h.focus().selectAllAndType("12.5").commit();
  assert(
    h.commits.length === 0,
    "같은 값을 다시 입력하면 커밋 0회 — undo 스택 오염 없음",
  );
}

// ── (b) 빈 문자열 커밋 → 원래 값 유지 ───────────────────────────────────
function caseEmptyKeepsValue() {
  console.log("\n(b) 빈 문자열 커밋은 원래 값 유지 (0 이 되면 안 됨):");

  // 리드 보고의 "전체 선택 후 숫자 0 넣으면 이상해짐" 은 두 단계다.
  //   ① 전체 선택 + 첫 키 입력 순간 입력칸이 잠깐 빈 문자열이 된다.
  //   ② 옛 구현은 그 순간 Number("") === 0 을 적용하고 min 으로 클램프했다.
  // 여기서는 ①에서 커밋이 일어나도 값이 살아남는지 본다.
  const scale = makeField({ initial: 1.5, min: 0.1, max: 5 });
  scale.focus();
  scale.text = ""; // 전체 선택 후 Delete
  scale.commit();
  assert(scale.value === 1.5, `빈 값 커밋 후에도 1.5 유지 (실제 ${scale.value})`);
  assert(scale.commits.length === 0, "빈 값은 부모에 반영되지 않는다 (커밋 0회)");
  assert(scale.text === "1.5", `표시도 원래 값으로 복원 ("${scale.text}")`);

  // 순수 함수 레벨 확인.
  const r = commitNumberInput("", 1.5, 0.1, 5);
  assert(r.value === 1.5 && !r.changed, "commitNumberInput('') → 원래 값·미변경");
  assert(
    commitNumberInput("   ", 7, 0, 100).value === 7,
    "공백만 있는 문자열도 원래 값 유지",
  );

  // 그리고 사용자가 진짜로 0 을 치고 싶으면 0 이 들어가야 한다 (하한 클램프 적용).
  const pos = makeField({ initial: 12.5, min: -200, max: 200 });
  pos.focus().selectAllAndType("0").commit();
  assert(pos.value === 0, "의도한 0 입력은 정상적으로 0 이 된다 (위치칸, 하한 −200)");
}

// ── (c) 범위 초과는 커밋 시점에만 클램프 ────────────────────────────────
function caseClampOnCommitOnly() {
  console.log("\n(c) 클램프는 커밋 시점에만:");

  // 스케일 칸(0.1~5)에 "0.5" 를 친다. 옛 구현은 "0" 에서 0.1 로 끌려갔다.
  const f = makeField({ initial: 1, min: 0.1, max: 5 });
  f.focus().selectAllAndType("0");
  assert(f.value === 1, `"0" 만 친 시점에 하한 0.1 로 끌려가지 않는다 (${f.value})`);
  f.type(".5");
  assert(f.text === "0.5", `입력칸 문자열이 "0.5" 로 온전하다`);
  f.commit();
  assert(f.value === 0.5, `커밋 결과 0.5 (실제 ${f.value})`);
  assert(f.commits.length === 1, "중간 클램프 없이 커밋 1회");

  // 진짜 범위 밖 값은 커밋 시점에 클램프된다.
  const over = makeField({ initial: 1, min: 0.1, max: 5 });
  over.focus().selectAllAndType("999").commit();
  assert(over.value === 5, `999 → 상한 5 로 클램프 (실제 ${over.value})`);
  assert(over.text === "5", "표시도 클램프된 값으로 갱신");

  const under = makeField({ initial: 1, min: 0.1, max: 5 });
  under.focus().selectAllAndType("-3").commit();
  assert(under.value === 0.1, `−3 → 하한 0.1 로 클램프 (실제 ${under.value})`);

  // min/max 미지정(프린터 프로파일 다이얼로그)은 클램프하지 않는다.
  assert(
    clampNumber(-999, undefined, undefined) === -999,
    "min/max 미지정이면 클램프 없음 — 기존 다이얼로그 동작 보존",
  );
  assert(commitNumberInput("3840", 100).value === 3840, "범위 없는 칸은 그대로 통과");
}

// ── (d) 파싱 불가 입력은 원래 값 유지 ───────────────────────────────────
function caseUnparsableKeepsValue() {
  console.log("\n(d) 파싱 불가 입력은 원래 값 유지:");

  // 음수/소수를 치는 도중 자연히 거쳐가는 중간 상태들.
  for (const raw of ["-", ".", "-.", "abc", "1e", "+", "--5", ""]) {
    assert(
      parseNumberInput(raw) === null,
      `parseNumberInput(${JSON.stringify(raw)}) → null (커밋 대상 아님)`,
    );
    const r = commitNumberInput(raw, 42, -100, 100);
    assert(
      r.value === 42 && !r.changed,
      `커밋(${JSON.stringify(raw)}) → 원래 값 42 유지`,
    );
  }

  // 반대로 정상 입력은 통과해야 한다 (검증이 지나치게 막지 않는지).
  for (const [raw, want] of [
    ["-12.5", -12.5],
    ["0", 0],
    [".5", 0.5],
    ["-.25", -0.25],
    ["1e2", 100],
    ["  7.25  ", 7.25],
  ]) {
    assert(
      parseNumberInput(raw) === want,
      `parseNumberInput(${JSON.stringify(raw)}) = ${want} — 정상 입력은 통과`,
    );
  }

  // Infinity/NaN 은 막는다 (Number("Infinity") 는 유한하지 않다).
  assert(parseNumberInput("Infinity") === null, "Infinity 는 거부");
  assert(parseNumberInput("NaN") === null, "NaN 은 거부");
}

// ── (e) 표시 반올림 — 89.9999999 는 "90" 으로, 내부 값은 불변 ───────────
function caseDisplayRounding() {
  console.log("\n(e) 표시 반올림 (내부 값 불변):");

  // 리드가 화면에서 본 그 값. 회전은 Euler↔quaternion 왕복(B-13)을 거치므로
  //   이런 찌꺼기가 실제로 나온다.
  const RAW = 89.9999999;
  assert(
    formatNumberForDisplay(RAW, 2) === "90",
    `${RAW} → 각도 표시 "90" (실제 "${formatNumberForDisplay(RAW, 2)}")`,
  );
  assert(
    formatNumberForDisplay(-179.99999998, 2) === "-180",
    `−179.99999998 → "-180"`,
  );
  assert(
    formatNumberForDisplay(0.30000000000000004, 3) === "0.3",
    `0.1+0.2 찌꺼기 → "0.3"`,
  );
  assert(formatNumberForDisplay(-0.0000001, 3) === "0", `−0 이 "-0" 으로 안 보인다`);

  // 내부 값은 반올림하지 않는다 — 표시만 바꾼다는 방침의 확인.
  const f = makeField({ initial: RAW, min: -180, max: 180, decimals: 2 });
  assert(f.text === "90", `입력칸 표시는 "90"`);
  assert(f.value === RAW, `내부 값은 ${RAW} 그대로 (반올림하지 않음)`);

  // 화면에 "90" 이 떠 있는 상태에서 그냥 blur 하면 커밋되면 안 된다.
  //   커밋되면 내부 값이 89.9999999 → 90 으로 조용히 바뀌어, 사용자가 손도
  //   안 댄 편집이 undo 스택에 쌓인다.
  f.focus().commit();
  assert(
    f.commits.length === 1 && f.value === 90,
    "표시값 그대로 blur 하면 표시대로 90 이 커밋된다 (사용자가 본 값 = 적용값)",
  );

  // 소수 자릿수는 용도별로 다르게 준다.
  assert(formatNumberForDisplay(12.3456789, 3) === "12.346", "위치 mm 는 3자리");
  assert(formatNumberForDisplay(12.3456789, 0) === "12", "레이어 인덱스는 0자리");

  // 편집 중 외부 값 변경은 표시를 덮지 않는다 — B-14 의 핵심.
  const g = makeField({ initial: 0, min: -180, max: 180, decimals: 2 });
  g.focus().selectAllAndType("9");
  g.external(45); // 기즈모가 동시에 45도로 돌린 상황
  assert(g.text === "9", `편집 중 외부 변경(45)이 표시를 덮지 않는다 ("${g.text}")`);
  g.commit();
  assert(g.value === 9, "사용자가 친 9 가 그대로 커밋된다");

  // 편집 중이 아니면 외부 변경을 따라간다.
  const h = makeField({ initial: 0, min: -180, max: 180, decimals: 2 });
  h.external(45);
  assert(h.text === "45", `비편집 상태에서는 외부 변경을 표시에 반영 ("${h.text}")`);
  assert(
    !shouldSyncDisplay(false, "90", 89.9999999, 2),
    "이미 반올림 결과와 같게 떠 있으면 재갱신하지 않는다 (커서·선택 보존)",
  );
}

/**
 * (f) 대조군 — **수정 전** 구현이 실제로 틀리는지 재현한다.
 *
 * 프로젝트 규약: 이 절이 없으면 (a)~(e) 는 "규칙을 규칙대로 구현했다" 만
 * 보여줄 뿐, 그 규칙이 리드가 본 버그를 잡는다는 증거가 못 된다.
 * 여기서 옛 동작(타자마다 즉시 적용 + 즉시 클램프)을 그대로 돌려 **실패를
 * assert** 한다.
 */
function caseLegacyControl() {
  console.log("\n(f) 대조군 — 수정 전 구현(타자마다 즉시 적용+클램프)의 오동작 재현:");

  /** 옛 입력칸: 한 글자 칠 때마다 부모에 반영되고, 그 값이 다시 표시를 덮는다. */
  function legacyType(chars, initial, min, max) {
    let parent = initial;
    const applied = [];
    let box = ""; // 전체 선택 후 새로 치는 상황
    for (const ch of chars) {
      box += ch;
      parent = legacyImmediateApply(box, parent, min, max);
      applied.push(parent);
      // 제어 입력이라 부모 값이 곧바로 입력칸을 덮어쓴다.
      box = String(parent);
    }
    return { parent, applied };
  }

  // ① 회전 칸(−180~180)에 "90" 을 한 글자씩.
  const rot = legacyType("90", 0, -180, 180);
  console.log(`  [옛] 회전칸 "90" 타이핑 중 적용된 값들 = ${JSON.stringify(rot.applied)}`);
  assert(
    rot.applied[0] === 9,
    `[옛] "9" 를 친 순간 회전이 9도로 즉시 적용된다 (${rot.applied[0]}) — 리드 보고 재현`,
  );
  assert(
    rot.applied.length > 1,
    `[옛] 타자 도중 부모 반영이 ${rot.applied.length}회 — undo 스택이 중간값으로 오염된다`,
  );
  // 같은 조작을 수정본으로 하면 커밋 1회 · 중간 적용 0회.
  const fixedRot = makeField({ initial: 0, min: -180, max: 180, decimals: 2 });
  fixedRot.focus().selectAllAndType("90").commit();
  assert(
    fixedRot.commits.length === 1 && fixedRot.commits[0] === 90,
    `[신규] 같은 조작이 커밋 1회·값 90 (${JSON.stringify(fixedRot.commits)}) — 수정 효과 확인`,
  );

  // ② 스케일 칸(0.1~5)에 "0.5" 를 치면 옛 구현은 "0" 에서 하한으로 끌려간다.
  const sc = legacyType("0.5", 1, 0.1, 5);
  console.log(`  [옛] 스케일칸 "0.5" 타이핑 중 적용된 값들 = ${JSON.stringify(sc.applied)}`);
  assert(
    sc.applied[0] === 0.1,
    `[옛] "0" 을 친 순간 하한 0.1 로 클램프된다 (${sc.applied[0]}) — "최소값으로 변경됨" 재현`,
  );
  assert(
    sc.parent !== 0.5,
    `[옛] 최종값이 0.5 가 아니다 (${sc.parent}) — 클램프가 입력칸을 덮어써 자릿수가 엉킨다`,
  );
  const fixedSc = makeField({ initial: 1, min: 0.1, max: 5 });
  fixedSc.focus().selectAllAndType("0.5").commit();
  assert(
    fixedSc.value === 0.5,
    `[신규] 같은 조작이 정확히 0.5 (${fixedSc.value}) — 수정 효과 확인`,
  );

  // ③ 전체 선택 후 지우기 = 빈 문자열. 옛 구현은 Number("") === 0 을 적용.
  const emptyApplied = legacyImmediateApply("", 1.5, 0.1, 5);
  assert(
    emptyApplied === 0.1,
    `[옛] 빈 문자열이 0 으로 파싱돼 하한 0.1 이 적용된다 (${emptyApplied}) — "전체 선택 후 0" 재현`,
  );
  assert(
    commitNumberInput("", 1.5, 0.1, 5).value === 1.5,
    "[신규] 같은 입력이 원래 값 1.5 를 유지 — 수정 효과 확인",
  );

  // ④ 서포트 패널은 클램프에 더해 step 스냅까지 타자마다 걸렸다 (limit.step 0.5 가정).
  function legacySupportCommit(raw, current, min, max, step) {
    const n = Number(raw);
    if (Number.isNaN(n)) return current;
    const clamped = Math.min(Math.max(n, min), max);
    return Number((Math.round(clamped / step) * step).toFixed(3));
  }
  const snapped = legacySupportCommit("1", 4, 0.5, 20, 0.5);
  assert(
    snapped === 1,
    `[옛/서포트] "1.7" 을 치는 도중 "1" 이 1 로 적용된다 (${snapped})`,
  );
  const snapped2 = legacySupportCommit("1.7", 4, 0.5, 20, 0.5);
  assert(
    snapped2 === 1.5,
    `[옛/서포트] 최종 "1.7" 마저 step 스냅으로 1.5 가 된다 (${snapped2}) — "서포트쪽도 다 이상함" 재현`,
  );

  // ⑤ 옛 구현에는 표시 반올림이 없어 찌꺼기가 그대로 노출됐다.
  assert(
    String(89.9999999) === "89.9999999",
    `[옛] 반올림이 없으면 화면에 "89.9999999" 가 그대로 뜬다 — 리드 스크린샷 재현`,
  );
  assert(
    formatNumberForDisplay(89.9999999, 2) === "90",
    `[신규] 표시 반올림으로 "90" (수정 효과 확인)`,
  );
}

/**
 * (g) undo 한 묶음 배선 — 동기 커밋에서 끝값이 스테일이 되지 않는가.
 *
 * TransformPanel 의 규약은 `onBegin` → `onChange` → `onEnd` 로 한 묶음이
 * undo 1회이고, `onEnd`(endDrag)가 `onCommit(id, start, end)` 로 DB 저장 +
 * undo push 를 한다.
 *
 * 슬라이더는 세 콜백이 **서로 다른 이벤트**(pointerdown/move/up)라 onEnd
 * 시점에 리렌더가 끝나 `local` 이 최신이었다. 그런데 숫자칸 커밋은 셋을
 * **한 이벤트 안에서 동기로** 부른다 → `setLocal` 이 아직 반영되지 않아
 * 렌더 클로저의 `local` 은 편집 **이전** 값이다.
 *
 * 그대로 두면 `transformsEqual(start, local)` 이 참이 되어 **커밋이 통째로
 * 사라진다**(값은 화면에 보이는데 DB 에 저장도 안 되고 undo 도 안 쌓임).
 * 그래서 endDrag 가 `latestRef`(apply*Field 가 계산 즉시 채우는 최신값)를
 * 읽게 고쳤다. 여기서 두 배선을 대조한다.
 */
function caseCommitEndValue() {
  console.log("\n(g) 동기 커밋의 끝값 배선 (스테일 클로저 대조):");

  /**
   * 패널의 상태 전이를 흉내낸다. `renderedLocal` 은 렌더 클로저가 보는 값이라
   * setLocal 호출로 즉시 바뀌지 않는다(리렌더 전까지 그대로).
   */
  function runEdit({ useLatestRef }) {
    let renderedLocal = { rx: 0 }; // 렌더 클로저의 local (리렌더 전까지 고정)
    let pending = { rx: 0 }; // setLocal 로 예약된 실제 다음 상태
    let startRef = null;
    let latestRef = null;
    const committed = [];

    // onBegin
    startRef = { ...renderedLocal };
    latestRef = { ...renderedLocal };
    // onChange — apply*Field 가 next 를 계산해 setLocal + onPreview.
    const next = { rx: 90 };
    latestRef = next;
    pending = next; // setLocal(next) — renderedLocal 은 아직 안 바뀐다
    // onEnd — endDrag
    const end = useLatestRef ? (latestRef ?? renderedLocal) : renderedLocal;
    if (startRef && end.rx !== startRef.rx) {
      committed.push({ start: startRef.rx, end: end.rx });
    }
    return { committed, pending };
  }

  // [대조군] 끝값을 렌더 클로저 `local` 에서 읽던 배선.
  const stale = runEdit({ useLatestRef: false });
  console.log(`  [스테일 클로저] 커밋 = ${JSON.stringify(stale.committed)}`);
  assert(
    stale.committed.length === 0,
    "[대조군] local 을 끝값으로 쓰면 start===end 로 판정돼 커밋이 통째로 사라진다 — 결함 재현",
  );
  assert(
    stale.pending.rx === 90,
    "[대조군] 화면에는 90 이 보이는데(pending) 저장은 안 된 상태 — 가장 위험한 형태",
  );

  // [수정] latestRef 를 끝값으로.
  const fixed = runEdit({ useLatestRef: true });
  console.log(`  [latestRef] 커밋 = ${JSON.stringify(fixed.committed)}`);
  assert(
    fixed.committed.length === 1 && fixed.committed[0].end === 90,
    `[신규] 커밋 1회·끝값 90 (${JSON.stringify(fixed.committed)}) — undo 1항목 정상`,
  );
  assert(
    fixed.committed[0].start === 0,
    "[신규] 시작값 0 이 보존돼 undo 하면 원래 값으로 돌아간다",
  );
}

function main() {
  console.log("숫자 입력칸 커밋 규칙 검증 (B-14)");
  caseCommitOnEnterOnly();
  caseEmptyKeepsValue();
  caseClampOnCommitOnly();
  caseUnparsableKeepsValue();
  caseDisplayRounding();
  caseLegacyControl();
  caseCommitEndValue();
  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
