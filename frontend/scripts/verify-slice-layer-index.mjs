// 슬라이스 미리보기 레이어 인덱스(최상층 시작 + 범위 클램프) 헤드리스 검증.
//
//   리드 지적: "다른 슬라이서는 슬라이스 미리보기를 0층이 아니라 끝 레이어부터
//   보여준다." 그래서 미리보기를 켤 때 layerIdx = layerCount-1 로 시작한다.
//   같이 고친 기존 버그: 층높이를 키우면 총 층수가 줄어 기존 layerIdx 가 범위를
//   벗어나는데, 패널(SliceSidePanel)의 safeLayerIdx 는 **표시만** 보정하고
//   실제 단면 높이 sliceYNow 는 raw layerIdx 를 써서 단면이 모델 위 허공을
//   가리키고 화면이 빈 채로 남았다.
//
//   검사 항목:
//     (a) layerCountFor 경계 — topY=0, lh 의 정확한 배수, 나누어떨어지지 않는 경우,
//         아주 작은 topY. 전부 1 이상의 정수이고 층수가 top 을 덮는가
//     (b) 추출 동일성 — layerCountFor 가 구 인라인식
//         Math.max(1, Math.ceil(topY/lh)) 와 광범위 조합에서 비트 단위로 같은가
//         (동작 변경 없는 순수 추출인지)
//     (c) 최상층 인덱스 layerCount-1 이 항상 유효 범위 [0, layerCount)
//     (d) 클램프된 sliceY 가 항상 (0, topY] 안에 드는가 — 여러 (topY, lh, idx) 조합
//     (e) 층높이 변경 클램프(ViewerV2Page) 가 범위를 유지하는가
//     (f) 끄고 다시 켜기 — onClose 가 layerIdx:0 으로 리셋해도 토글이 최상층으로 덮는가
//     (g) 빈 씬(topY=0) — layerCount=1, 최상층 인덱스 0, sliceY=lh/2
//     (h) **대조군 A** — 클램프 없는 구 sliceYNow 가 "층높이 증가 후 범위 이탈"에서
//         모델 top 을 넘는 sliceY(=빈 화면)를 만드는 것을 증명. 현 구현은 안 넘음
//     (i) **대조군 B** — 구 초기값(layerIdx=0)이 "최상층 시작" 기대와 다른 것을 증명
//     (j) **대조군 C** — 클램프를 Math.max 로 잘못 쓴 변형이 (d) 를 실제로 FAIL 시키는지
//         (검사가 통과만 하는 검사가 아니라는 근거)
//
//   실행: npx tsx scripts/verify-slice-layer-index.mjs

import { layerCountFor } from "../src/features/v2/pages/viewer/utils/layer-count.ts";

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

// 부동소수 허용치. 층높이는 0.01~0.3mm 규모라 누적 오차가 1e-9mm 수준이다.
const EPS = 1e-9;

// ── 검증 대상 로직의 소비자 측 재현 ───────────────────────────────────────
//   layerCountFor 는 실제 소스에서 import 한다(동어반복 방지). 그 위에 얹힌
//   호출부 공식만 여기 옮긴다 — 이건 React 훅/JSX 안이라 import 가 불가능하다.

/** 현 구현: useSliceExport 의 클램프된 sliceYNow. */
function sliceYNowFixed(topY, layerHeightMm, layerIdx) {
  const layerCount = layerCountFor(topY, layerHeightMm);
  const safeIdx = Math.min(layerIdx, layerCount - 1);
  return (safeIdx + 0.5) * layerHeightMm;
}

/** 구 구현(대조군): 클램프가 없던 sliceYNow. */
function sliceYNowLegacy(topY, layerHeightMm, layerIdx) {
  return (layerIdx + 0.5) * layerHeightMm;
}

/** 현 구현: 미리보기 토글 ON 시 layerIdx (ViewerV2Page onToggleSlicePreview). */
function topLayerIdxOnOpen(topY, layerHeightMm) {
  return layerCountFor(topY, layerHeightMm) - 1;
}

/** 현 구현: 층높이 변경 시 layerIdx 클램프 (ViewerV2Page onLayerHeightChange). */
function clampOnLayerHeightChange(topY, newLayerHeightMm, prevLayerIdx) {
  return Math.min(prevLayerIdx, layerCountFor(topY, newLayerHeightMm) - 1);
}

/** 구 인라인식(추출 전 원본) — (b) 동일성 대조용. */
function legacyLayerCount(topY, lh) {
  return Math.max(1, Math.ceil(topY / lh));
}

// 실사용 범위의 조합. 층높이는 패널 슬라이더 범위(0.01~0.3mm).
const TOPS = [0, 0.001, 0.01, 0.02, 0.05, 0.1, 1, 3.7, 10, 20, 42.195, 150, 200];
const LHS = [0.01, 0.02, 0.025, 0.03, 0.05, 0.1, 0.15, 0.2, 0.3];

// ── (a) layerCountFor 경계 ───────────────────────────────────────────────
function caseBoundaries() {
  console.log("\n(a) layerCountFor 경계값");

  assert(layerCountFor(0, 0.05) === 1, "빈 씬 topY=0 → 1층 (0층 아님)");
  assert(layerCountFor(1, 0.05) === 20, "정확한 배수 topY=1, lh=0.05 → 20층");
  assert(layerCountFor(20, 0.05) === 400, "정확한 배수 topY=20, lh=0.05 → 400층");
  assert(
    layerCountFor(1.01, 0.05) === 21,
    "나누어떨어지지 않음 topY=1.01, lh=0.05 → 21층 (올림)",
  );
  assert(
    layerCountFor(0.001, 0.05) === 1,
    "아주 작은 topY=0.001 (lh 보다 작음) → 1층",
  );
  assert(
    layerCountFor(0.05, 0.05) === 1,
    "topY 가 딱 한 층 topY=lh=0.05 → 1층",
  );

  // 전 조합에서 불변식: 1 이상 정수 + 총 층수가 top 을 덮는다.
  let allInt = true;
  let allGe1 = true;
  let allCover = true;
  for (const topY of TOPS) {
    for (const lh of LHS) {
      const n = layerCountFor(topY, lh);
      if (!Number.isInteger(n)) allInt = false;
      if (!(n >= 1)) allGe1 = false;
      // n 층이면 n*lh 가 topY 이상이어야 모델 전체가 덮인다.
      if (n * lh + EPS < topY) allCover = false;
    }
  }
  assert(allInt, `전 조합(${TOPS.length}×${LHS.length}) 정수 반환`);
  assert(allGe1, "전 조합 1 이상 — 음수 인덱스(layerCount-1 < 0) 원천 차단");
  assert(allCover, "전 조합 layerCount×lh ≥ topY — 모델 전체를 덮음");
}

// ── (b) 추출 동일성 (동작 변경 없는 순수 추출인가) ───────────────────────
function caseExtractionIdentity() {
  console.log("\n(b) 구 인라인식과의 동일성 — 순수 추출 확인");

  let mismatch = null;
  let n = 0;
  for (const topY of TOPS) {
    for (const lh of LHS) {
      n++;
      const now = layerCountFor(topY, lh);
      const old = legacyLayerCount(topY, lh);
      if (!Object.is(now, old)) mismatch = { topY, lh, now, old };
    }
  }
  assert(
    mismatch === null,
    mismatch === null
      ? `${n}개 조합 전부 구식과 비트 동일 — 동작 변경 없음`
      : `구식과 불일치: topY=${mismatch.topY} lh=${mismatch.lh} 현재=${mismatch.now} 구식=${mismatch.old}`,
  );
}

// ── (c) 최상층 인덱스가 항상 유효 범위 ───────────────────────────────────
function caseTopIdxValid() {
  console.log("\n(c) 최상층 인덱스 = layerCount-1 의 유효성");

  let allValid = true;
  let bad = null;
  for (const topY of TOPS) {
    for (const lh of LHS) {
      const count = layerCountFor(topY, lh);
      const idx = topLayerIdxOnOpen(topY, lh);
      if (!(idx >= 0 && idx < count && Number.isInteger(idx))) {
        allValid = false;
        bad = { topY, lh, idx, count };
      }
    }
  }
  assert(
    allValid,
    allValid
      ? "전 조합에서 0 ≤ layerIdx < layerCount (음수·이탈 없음)"
      : `범위 이탈: topY=${bad.topY} lh=${bad.lh} idx=${bad.idx} count=${bad.count}`,
  );

  assert(
    topLayerIdxOnOpen(20, 0.05) === 399,
    "topY=20, lh=0.05 → 최상층 인덱스 399 (총 400층의 끝)",
  );
}

// ── (d) sliceY 가 항상 (0, topY] 범위 ────────────────────────────────────
function caseSliceYInRange() {
  console.log("\n(d) 클램프된 sliceY 가 (0, topY] 안에 드는가");

  // 층높이를 키워 범위를 벗어난 상황을 포함해 과감한 idx 까지 넣는다.
  const IDXS = [0, 1, 5, 50, 399, 1000, 99999];
  let allPositive = true;
  let allWithinTop = true;
  let worst = null;
  let n = 0;

  // 상한은 topY 가 아니라 **topY + lh/2** 다. layerCount 는 ceil 이라 topY 가
  //   lh 의 배수가 아니면 마지막 층이 top 위로 조금 삐져나오고, 그 층의 *중심*은
  //   최대 반 층(lh/2)까지 topY 를 넘는다. 예: topY=200, lh=0.15 → 1334층,
  //   최상층 중심 200.025mm. 이건 정상이다 — 단면이 모델을 스치며 지나가는
  //   마지막 한 겹이라 화면에 형상이 남는다. 반면 클램프가 없으면 sliceY 가
  //   수십~수백 mm 씩 뛰어 **완전한 허공**을 가리킨다(대조군 A: 119.85mm).
  const overshootBound = (lh) => lh / 2 + EPS;

  for (const topY of TOPS) {
    if (topY <= 0) continue; // 빈 씬은 (g) 에서 따로
    for (const lh of LHS) {
      for (const idx of IDXS) {
        n++;
        const y = sliceYNowFixed(topY, lh, idx);
        if (!(y > 0)) allPositive = false;
        if (y > topY + overshootBound(lh)) {
          allWithinTop = false;
          worst = { topY, lh, idx, y };
        }
      }
    }
  }
  assert(allPositive, `${n}개 조합 sliceY > 0 (바닥 아래로 안 내려감)`);
  assert(
    allWithinTop,
    allWithinTop
      ? `${n}개 조합 sliceY ≤ topY + 반 층 — 모델 위 허공을 가리키지 않음`
      : `허공 지시: topY=${worst.topY} lh=${worst.lh} idx=${worst.idx} → sliceY=${worst.y}`,
  );

  // 최상층에서 sliceY 는 top 바로 아래 마지막 레이어 중심이어야 한다.
  const y = sliceYNowFixed(20, 0.05, topLayerIdxOnOpen(20, 0.05));
  assert(
    Math.abs(y - 19.975) < EPS,
    `topY=20, lh=0.05 최상층 sliceY=${y} ≈ 19.975 (마지막 층 중심)`,
  );
}

// ── (e) 층높이 변경 클램프 ───────────────────────────────────────────────
function caseLayerHeightChange() {
  console.log("\n(e) 층높이 변경 시 layerIdx 클램프");

  // 리드가 지적한 실제 시나리오: 20mm 모델, 0.05mm 최상층(399) → 0.3mm 로 변경.
  const topY = 20;
  const prevIdx = topLayerIdxOnOpen(topY, 0.05); // 399
  const newLh = 0.3;
  const newCount = layerCountFor(topY, newLh); // 67
  const newIdx = clampOnLayerHeightChange(topY, newLh, prevIdx);

  assert(prevIdx === 399, `0.05mm 최상층 인덱스 ${prevIdx} = 399`);
  assert(
    newIdx === newCount - 1,
    `0.3mm 로 변경 후 layerIdx ${newIdx} = 새 최상층 ${newCount - 1} (클램프됨)`,
  );
  assert(
    sliceYNowFixed(topY, newLh, newIdx) <= topY + EPS,
    "변경 후 sliceY 가 topY 이내 — 화면이 비지 않음",
  );

  // 층높이를 **줄이는** 방향은 층수가 늘어나므로 클램프가 개입하면 안 된다
  // (Math.min 이라 그대로 통과 — 사용자가 보던 위치를 유지).
  const keep = clampOnLayerHeightChange(topY, 0.02, 100);
  assert(keep === 100, "층높이를 줄일 때는 기존 layerIdx 100 유지 (불필요한 이동 없음)");

  // 전 조합에서 클램프 결과가 항상 유효 범위.
  let allValid = true;
  for (const t of TOPS) {
    for (const lh of LHS) {
      const count = layerCountFor(t, lh);
      const idx = clampOnLayerHeightChange(t, lh, 99999);
      if (!(idx >= 0 && idx < count)) allValid = false;
    }
  }
  assert(allValid, "전 조합에서 클램프 결과가 0 ≤ idx < layerCount");
}

// ── (f) 끄고 다시 켜기 ───────────────────────────────────────────────────
function caseReopen() {
  console.log("\n(f) 끄고 다시 켜기 — onClose 리셋을 토글이 덮는가");

  const topY = 20;
  const lh = 0.05;

  // 1) 켠다 → 최상층
  let state = { on: true, layerIdx: topLayerIdxOnOpen(topY, lh), layerHeightMm: lh };
  assert(state.layerIdx === 399, `첫 ON → 최상층 ${state.layerIdx}`);

  // 2) 사용자가 중간층으로 이동
  state = { ...state, layerIdx: 42 };

  // 3) onClose — ViewerV2Page 가 { on:false, layerIdx:0, layerHeightMm:0.05 } 로 리셋
  state = { on: false, layerIdx: 0, layerHeightMm: 0.05 };
  assert(state.layerIdx === 0, "닫기 후 내부 상태는 layerIdx 0 으로 리셋");

  // 4) 다시 켠다 — 토글 핸들러가 layerIdx 를 최상층으로 **덮어쓴다**
  state = {
    ...state,
    on: true,
    layerIdx: topLayerIdxOnOpen(topY, state.layerHeightMm),
  };
  assert(
    state.layerIdx === 399,
    `다시 ON → 리셋된 0 을 덮고 최상층 ${state.layerIdx} (0층으로 안 열림)`,
  );
}

// ── (g) 빈 씬 ────────────────────────────────────────────────────────────
function caseEmptyScene() {
  console.log("\n(g) 빈 씬 (모델 없음, sceneTopY=0)");

  const lh = 0.05;
  const count = layerCountFor(0, lh);
  const idx = topLayerIdxOnOpen(0, lh);

  assert(count === 1, `layerCount ${count} = 1 (0 이 아니라 1 — 슬라이더 max=0 유효)`);
  assert(idx === 0, `최상층 인덱스 ${idx} = 0 (음수 아님)`);
  assert(
    Math.abs(sliceYNowFixed(0, lh, idx) - 0.025) < EPS,
    "sliceY = lh/2 = 0.025 — NaN/음수 없음",
  );
  // 씬이 비어도 과거 layerIdx 가 남아 있으면 클램프가 0 으로 끌어내린다.
  assert(
    sliceYNowFixed(0, lh, 999) === sliceYNowFixed(0, lh, 0),
    "빈 씬에서 잔여 layerIdx 999 도 0 으로 클램프",
  );
}

// ── (h) 대조군 A — 클램프 없는 구 구현이 허공을 가리킨다 ─────────────────
function caseControlA() {
  console.log("\n(h) 대조군 A — 구 sliceYNow(클램프 없음)가 실제로 깨지는가");

  // 리드 시나리오 그대로: 20mm 모델, 0.05mm 최상층(399) → 0.3mm 로 변경.
  const topY = 20;
  const idx = 399;
  const newLh = 0.3;

  const legacy = sliceYNowLegacy(topY, newLh, idx); // (399+0.5)*0.3 = 119.85
  const fixed = sliceYNowFixed(topY, newLh, idx);

  assert(
    legacy > topY,
    `구 구현 sliceY=${legacy.toFixed(3)}mm > topY=${topY}mm — 모델 위 허공 (화면 빈 버그 재현)`,
  );
  assert(
    fixed <= topY + EPS,
    `현 구현 sliceY=${fixed.toFixed(3)}mm ≤ topY=${topY}mm — 수정으로 해소`,
  );
  assert(
    legacy !== fixed,
    "구/현 구현 결과가 실제로 다름 — 클램프가 동작한다는 증거",
  );

  // 최상층 시작이 이 버그를 훨씬 자주 노출시킨다: layerIdx 가 항상 최대치라
  // 층높이를 **조금만** 키워도 바로 범위를 벗어난다.
  const slightly = sliceYNowLegacy(topY, 0.06, topLayerIdxOnOpen(topY, 0.05));
  assert(
    slightly > topY,
    `0.05→0.06mm 소폭 변경만으로도 구 구현은 sliceY=${slightly.toFixed(3)}mm 로 이탈`,
  );

  // 범위 안에 있을 때는 두 구현이 같아야 한다 (클램프가 정상 케이스를 안 건드림).
  let sameWhenInRange = true;
  for (const t of TOPS) {
    if (t <= 0) continue;
    for (const lh of LHS) {
      const maxIdx = layerCountFor(t, lh) - 1;
      for (const i of [0, Math.floor(maxIdx / 2), maxIdx]) {
        if (sliceYNowLegacy(t, lh, i) !== sliceYNowFixed(t, lh, i)) {
          sameWhenInRange = false;
        }
      }
    }
  }
  assert(
    sameWhenInRange,
    "범위 내 인덱스에서는 구/현 결과 동일 — 클램프가 정상 동작을 바꾸지 않음",
  );
}

// ── (i) 대조군 B — 구 초기값(0층)은 최상층 기대와 다르다 ─────────────────
function caseControlB() {
  console.log("\n(i) 대조군 B — 구 초기값 layerIdx=0 이 기대와 다른가");

  const topY = 20;
  const lh = 0.05;
  const legacyIdx = 0; // 구현 전: useState 초기값 그대로 열림
  const nowIdx = topLayerIdxOnOpen(topY, lh);

  assert(
    legacyIdx !== nowIdx,
    `구 초기 인덱스 ${legacyIdx} ≠ 현 최상층 ${nowIdx} — "끝 레이어부터" 요구가 실제 반영됨`,
  );
  assert(
    sliceYNowFixed(topY, lh, legacyIdx) < 0.1,
    `구 초기 sliceY=${sliceYNowFixed(topY, lh, legacyIdx)}mm — 바닥 한 겹이라 거의 안 보였음`,
  );
  assert(
    Math.abs(sliceYNowFixed(topY, lh, nowIdx) - (topY - lh / 2)) < EPS,
    "현 초기 sliceY = topY - lh/2 — 모델 꼭대기 단면",
  );
}

// ── (j) 대조군 C — 잘못된 클램프 변형은 (d) 를 FAIL 시켜야 한다 ──────────
function caseControlC() {
  console.log("\n(j) 대조군 C — 클램프를 Math.max 로 잘못 쓴 변형");

  /** 오구현: Math.min 대신 Math.max — 범위를 전혀 제한하지 못한다. */
  function sliceYNowBroken(topY, lh, idx) {
    const count = layerCountFor(topY, lh);
    const badIdx = Math.max(idx, count - 1); // 버그
    return (badIdx + 0.5) * lh;
  }

  const topY = 20;
  const broken = sliceYNowBroken(topY, 0.3, 399);
  assert(
    broken > topY,
    `Math.max 변형은 sliceY=${broken.toFixed(3)}mm 로 여전히 이탈 — (d) 검사가 이 버그를 잡아낸다`,
  );

  // 검사 자체가 변형을 실제로 FAIL 판정하는지 직접 돌려본다.
  //   (d) 와 **완전히 같은 상한**(topY + lh/2)을 쓴다 — 느슨해진 상한으로도
  //   오구현이 여전히 잡혀야 대조군으로서 의미가 있다.
  let caught = 0;
  let total = 0;
  for (const lh of LHS) {
    for (const idx of [0, 399, 99999]) {
      total++;
      if (sliceYNowBroken(topY, lh, idx) > topY + lh / 2 + EPS) caught++;
    }
  }
  assert(
    caught > 0,
    `(d) 의 범위 검사가 오구현을 ${caught}/${total} 조합에서 검출 — 통과만 하는 검사가 아님`,
  );

  // 반대로 **정상 구현**은 같은 조합에서 한 건도 안 걸려야 한다 (거짓 양성 없음).
  let falsePositive = 0;
  for (const lh of LHS) {
    for (const idx of [0, 399, 99999]) {
      if (sliceYNowFixed(topY, lh, idx) > topY + lh / 2 + EPS) falsePositive++;
    }
  }
  assert(
    falsePositive === 0,
    "동일 조합에서 현 구현은 0건 검출 — 검사가 정상 구현을 잘못 잡지 않음",
  );
}

// ── main ────────────────────────────────────────────────────────────────
function main() {
  console.log("슬라이스 미리보기 레이어 인덱스 검증 (최상층 시작 + 범위 클램프)");

  caseBoundaries();
  caseExtractionIdentity();
  caseTopIdxValid();
  caseSliceYInRange();
  caseLayerHeightChange();
  caseReopen();
  caseEmptyScene();
  caseControlA();
  caseControlB();
  caseControlC();

  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
