// 서포트 점 전처리 헤드리스 검증 (S-4b-2b) — 중복 제거 + 기둥 공유 클러스터링.
//   preprocess-points.ts(순수, Babylon 무의존)를 tsx 로 직접 import 한다.
//
//   실행: npx tsx scripts/verify-preprocess-points.mjs
//   통과 로그는 커밋 메시지에 기록.
//
//   ★ 대조군 원칙 (프로젝트 규약, B-1 확립 / B-12~B-18 연속 적중):
//     이 스크립트는 "잘 돌아간다"만 보이지 않는다. **전처리 없이 점마다 기둥**인
//     현재 동작을 대조군으로 함께 돌려 기둥 수를 비교하고(§5), 반경을 무시한
//     잘못된 클러스터링이 **도달 불가능한 멤버**를 만드는 것을 이 스크립트가
//     실제로 잡아내는지 확인한다(§6). 즉 스크립트가 버그를 잡는다는 증명을 포함한다.

import {
  DEFAULT_MAX_BRIDGE_LENGTH_MM,
  DEFAULT_MAX_MEMBERS_PER_PILLAR,
  DEFAULT_STRUCTURAL_ANGLE_DEG,
  canBridgeReach,
  clusterForSharedPillars,
  dedupeSupportPoints,
  maxBridgeReachMm,
} from "../src/features/v2/support/detect/preprocess-points.ts";

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
  }
}

/** 결정적 의사난수 (시드 고정) — 셔플·격자 지터에 사용. 재현성 필수. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 시드 고정 셔플 (Fisher-Yates). */
function shuffled(arr, seed) {
  const a = [...arr];
  const rnd = makeRng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const p = (x, y, z, tipRadius) => ({ contact: [x, y, z], tipRadius });

/** 남은 대표점들의 contact 를 정렬된 문자열로 — 결정성 비교용 지문. */
function fingerprint(kept) {
  return kept
    .map((k) => k.point.contact.map((v) => v.toFixed(6)).join(","))
    .join(" | ");
}

function horizDist(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function main() {
  // ── §1. 중복 제거 — 거리 경계 ──────────────────────────────────────────────
  console.log("\n(§1) 중복 제거 — 0.1mm 경계:");
  {
    // 0.05mm 떨어진 두 점 → 하나로.
    const kept = dedupeSupportPoints([p(0, 5, 0, 0.2), p(0.05, 5, 0, 0.2)], 0.1);
    assert(kept.length === 1, "0.05mm 이격(0.1mm 이내) 두 점 → 1개로 합쳐짐");
    assert(kept[0].mergedIndices.length === 1, "흡수된 점이 mergedIndices 에 기록됨");
  }
  {
    // 정확히 0.1mm — 경계 포함(<=)으로 합쳐진다.
    const kept = dedupeSupportPoints([p(0, 5, 0, 0.2), p(0.1, 5, 0, 0.2)], 0.1);
    assert(kept.length === 1, "정확히 0.1mm → 경계 포함으로 합쳐짐 (<= 판정)");
  }
  {
    // 0.11mm — 유지.
    const kept = dedupeSupportPoints([p(0, 5, 0, 0.2), p(0.11, 5, 0, 0.2)], 0.1);
    assert(kept.length === 2, "0.11mm 이격 → 2개 그대로 유지");
  }
  {
    // 3D 거리로 판정 — Y 로만 벌어진 경우도 잡는다.
    const kept = dedupeSupportPoints([p(0, 5, 0, 0.2), p(0, 5.05, 0, 0.2)], 0.1);
    assert(kept.length === 1, "Y 로만 0.05mm 이격 → 3D 거리로 판정해 합쳐짐");
  }

  // ── §2. 중복 제거 — 남길 점 기준(tipRadius 최대) ─────────────────────────
  console.log("\n(§2) 중복 제거 — 굵은 팁을 남긴다 (안전 방향 실패):");
  {
    const kept = dedupeSupportPoints(
      [p(0, 5, 0, 0.2), p(0.03, 5, 0, 0.5), p(0.06, 5, 0, 0.35)],
      0.1,
    );
    assert(kept.length === 1, "0.1mm 안에 몰린 3점 → 1개");
    assert(
      kept[0].point.tipRadius === 0.5,
      `남은 점의 tipRadius=${kept[0].point.tipRadius} → 최대값 0.5 채택(가는 팁으로 대체하지 않음)`,
    );
    assert(
      kept[0].mergedIndices.join(",") === "0,2",
      "흡수 인덱스는 원본 인덱스 오름차순으로 기록",
    );
  }

  // ── §3. 중복 제거 — 결정성 (입력 셔플 무관) ──────────────────────────────
  console.log("\n(§3) 중복 제거 — 순서 무관 결정성:");
  {
    const base = [];
    const rnd = makeRng(20260820);
    // 무리 20개 × 각 3~4점 (일부는 0.1mm 이내로 몰림, 일부는 떨어짐).
    for (let c = 0; c < 20; c++) {
      const cx = rnd() * 30;
      const cz = rnd() * 30;
      const cy = 2 + rnd() * 10;
      base.push(p(cx, cy, cz, 0.2 + rnd() * 0.3));
      base.push(p(cx + 0.04, cy, cz, 0.2 + rnd() * 0.3));
      base.push(p(cx + 0.3, cy, cz, 0.2 + rnd() * 0.3));
    }
    const ref = dedupeSupportPoints(base, 0.1);
    const refFp = fingerprint(ref);
    let allSame = true;
    for (const seed of [1, 7, 42, 1234, 99999]) {
      const fp = fingerprint(dedupeSupportPoints(shuffled(base, seed), 0.1));
      if (fp !== refFp) allSame = false;
    }
    assert(allSame, `입력 5가지 셔플 → 동일 출력 (대표점 ${ref.length}개, 지문 일치)`);
    assert(
      ref.length < base.length,
      `실제로 줄었음: ${base.length}점 → ${ref.length}점 (합쳐질 게 없으면 무의미한 테스트)`,
    );
  }

  // ── §4. 클러스터 반경 — 유도식과 도달 가능성 ─────────────────────────────
  console.log("\n(§4) 클러스터 반경 = min(h·tanθ, Lmax·sinθ):");
  {
    // 기본값 45° / 15mm.
    const r5 = maxBridgeReachMm(5);
    assert(Math.abs(r5 - 5) < 1e-9, `h=5mm, 45° → Rmax=${r5.toFixed(4)} (구조각 지배: h·tan45°=h)`);
    const rHi = maxBridgeReachMm(50);
    const cap = DEFAULT_MAX_BRIDGE_LENGTH_MM * Math.sin((DEFAULT_STRUCTURAL_ANGLE_DEG * Math.PI) / 180);
    assert(
      Math.abs(rHi - cap) < 1e-9,
      `h=50mm → Rmax=${rHi.toFixed(4)} = Lmax·sin45°=${cap.toFixed(4)} (다리길이 지배)`,
    );
    const rCross = maxBridgeReachMm(cap);
    assert(
      Math.abs(rCross - cap) < 1e-9,
      `h=${cap.toFixed(4)}mm 가 두 상한의 교차점 (그 위로는 길이 제한이 지배)`,
    );
    assert(maxBridgeReachMm(0) === 0, "h=0(바닥 접점) → Rmax=0, 옆으로 못 감");
    // 구조각을 좁히면 도달 거리가 준다 (사용자 조절 파라미터가 실제로 먹힘).
    const r30 = maxBridgeReachMm(5, 30);
    assert(r30 < r5, `구조각 30° → Rmax=${r30.toFixed(4)} < 45° 의 ${r5.toFixed(4)} (파라미터 반영)`);
  }

  // ── §5. 클러스터링 — 반경 안/밖, 중심, 그리고 ★기둥 수 절감 (대조군) ──────
  console.log("\n(§5) 클러스터링 — 반경 안은 묶고 밖은 독립:");
  {
    // h=5mm → Rmax=5mm. 3mm 떨어진 점은 묶이고, 8mm 떨어진 점은 독립.
    const pts = [p(0, 5, 0, 0.2), p(3, 5, 0, 0.2), p(20, 5, 0, 0.2)];
    const cl = clusterForSharedPillars(pts);
    assert(cl.length === 2, `반경 안 2점 + 먼 1점 → 클러스터 ${cl.length}개 (기대 2)`);
    const big = cl.find((c) => c.memberIndices.length === 1);
    assert(!!big, "가까운 두 점이 한 클러스터(기둥1+멤버1)로 묶임");
    const solo = cl.find((c) => c.memberIndices.length === 0);
    assert(!!solo && solo.pillarIndex === 2, "20mm 떨어진 점은 독립 기둥");
  }
  {
    // 중심 선정 기준: 거리합 최소. 일직선 0/4/8 (h=10 → Rmax=10) → 가운데(4)가 중심.
    const pts = [p(0, 10, 0, 0.2), p(4, 10, 0, 0.2), p(8, 10, 0, 0.2)];
    const cl = clusterForSharedPillars(pts);
    assert(cl.length === 1, "일직선 3점이 모두 서로 도달 → 클러스터 1개");
    assert(
      cl[0].pillarIndex === 1,
      `중심 = 인덱스 ${cl[0].pillarIndex} → 거리합 최소인 가운데 점(기대 1). 양끝은 거리합 12, 가운데는 8`,
    );
    assert(
      cl[0].pillarXZ[0] === 4 && cl[0].pillarXZ[1] === 0,
      "pillarXZ 가 중심점의 contact XZ 와 일치 (기둥은 여기 수직으로 선다)",
    );
  }

  console.log("\n(§5b) ★ 기둥 수 절감 — 대조군: 전처리 없이 점마다 기둥:");
  {
    // 4mm 격자 유사 분포 121점(11×11), 접점 높이 8mm (Rmax=8mm).
    //   대조군 = 현재 동작(점마다 기둥) = 121개.
    const pts = [];
    const rnd = makeRng(4242);
    for (let ix = 0; ix < 11; ix++) {
      for (let iz = 0; iz < 11; iz++) {
        // 실제 검출 점은 정확한 격자가 아니므로 소폭 지터(±0.3mm)를 준다.
        pts.push(p(ix * 4 + (rnd() - 0.5) * 0.6, 8, iz * 4 + (rnd() - 0.5) * 0.6, 0.2));
      }
    }
    const controlPillars = pts.length; // 대조군: 전처리 없이 점마다 기둥.
    const cl = clusterForSharedPillars(pts);
    const pillars = cl.length;
    const cut = ((1 - pillars / controlPillars) * 100).toFixed(1);
    console.log(
      `       대조군(점마다 기둥) ${controlPillars}개 → 기둥 공유 ${pillars}개 (절감 ${cut}%)`,
    );
    assert(
      pillars < controlPillars,
      `기둥 수가 실제로 줄었다: ${controlPillars} → ${pillars}`,
    );
    assert(
      pillars <= controlPillars * 0.4,
      `절감률 ${cut}% ≥ 60% — B-3(1,300개 과다) 완화에 유의미한 규모`,
    );
    // 점 유실 금지: 모든 점이 정확히 한 클러스터에 (기둥 또는 멤버로) 속한다.
    const seen = new Set();
    let dup = false;
    for (const c of cl) {
      for (const i of [c.pillarIndex, ...c.memberIndices]) {
        if (seen.has(i)) dup = true;
        seen.add(i);
      }
    }
    assert(!dup && seen.size === pts.length, `점 유실·중복 없음: 전 ${pts.length}점이 정확히 1회씩 배정`);

    // 1,300점 규모에서의 환산 (B-3 실물 수치 대비 감).
    console.log(
      `       → 같은 비율이면 1,300개 서포트는 약 ${Math.round(1300 * (pillars / controlPillars))}개 기둥으로.`,
    );
  }

  // ── §6. ★ 도달 가능성 전수 확인 + 잘못된 클러스터링을 잡는가 ──────────────
  console.log("\n(§6) 다리 도달 가능성 — 전 멤버 전수 확인:");
  {
    // 높이가 섞인 분포에서 전수 확인 (낮은 점은 반경이 작아 못 묶여야 정상).
    const pts = [];
    const rnd = makeRng(777);
    for (let i = 0; i < 200; i++) {
      pts.push(p(rnd() * 40, 0.5 + rnd() * 20, rnd() * 40, 0.2));
    }
    const opts = { structuralAngleDeg: 45, maxBridgeLengthMm: 15 };
    const cl = clusterForSharedPillars(pts, opts);
    let bad = 0;
    let worstSlackRatio = 0;
    for (const c of cl) {
      const pillarC = pts[c.pillarIndex].contact;
      for (const m of c.memberIndices) {
        const d = horizDist(pts[m].contact, pillarC);
        const h = pts[m].contact[1];
        if (!canBridgeReach(d, h, opts)) bad++;
        const rmax = maxBridgeReachMm(h, 45, 15);
        if (rmax > 0) worstSlackRatio = Math.max(worstSlackRatio, d / rmax);
      }
    }
    const memberCount = cl.reduce((s, c) => s + c.memberIndices.length, 0);
    assert(
      bad === 0,
      `멤버 ${memberCount}개 전수 확인 — 도달 불가 ${bad}개 (최대 반경 사용률 ${(worstSlackRatio * 100).toFixed(1)}%)`,
    );
    assert(memberCount > 0, `멤버가 실제로 존재함 (${memberCount}개) — 전부 독립이면 무의미한 테스트`);
  }

  console.log("\n(§6b) ★ 대조군: 반경을 무시한 잘못된 클러스터링은 잡히는가:");
  {
    // 잘못된 구현 흉내 — "고정 반경 12mm 로 그냥 묶는다"(높이를 안 본다).
    //   낮은 점(h=1mm, Rmax=1mm)이 10mm 떨어진 기둥에 묶이는 사고를 재현한다.
    const pts = [p(0, 1, 0, 0.2), p(10, 1, 0, 0.2), p(5, 1, 0, 0.2)];
    const opts = { structuralAngleDeg: 45, maxBridgeLengthMm: 15 };

    // (a) 잘못된 클러스터링: 전부 한 기둥에 묶어버림.
    const wrong = [{ pillarIndex: 0, memberIndices: [1, 2] }];
    let wrongBad = 0;
    for (const m of wrong[0].memberIndices) {
      if (!canBridgeReach(horizDist(pts[m].contact, pts[0].contact), pts[m].contact[1], opts)) {
        wrongBad++;
      }
    }
    assert(
      wrongBad === 2,
      `반경 무시 클러스터링 → 도달 불가 멤버 ${wrongBad}개를 검사가 잡아냄 (h=1mm 는 1mm 밖으로 못 감)`,
    );

    // (b) 실제 구현: 같은 입력에서 도달 불가 멤버를 만들지 않는다.
    const real = clusterForSharedPillars(pts, opts);
    let realBad = 0;
    for (const c of real) {
      for (const m of c.memberIndices) {
        if (
          !canBridgeReach(
            horizDist(pts[m].contact, pts[c.pillarIndex].contact),
            pts[m].contact[1],
            opts,
          )
        ) {
          realBad++;
        }
      }
    }
    assert(realBad === 0, "실제 구현은 같은 입력에서 도달 불가 멤버 0개");
    assert(
      real.length === 3,
      `낮은 점들(h=1mm)은 서로 못 닿아 각자 기둥 → 클러스터 ${real.length}개 (기대 3). 무리하게 안 묶는다`,
    );
  }

  // ── §6c. ★ T-3 — 기둥당 다리 상한 (S-4b-2c-f 추가) ───────────────────────
  console.log(`\n(§6c) ★ 기둥당 다리 상한(기본 ${DEFAULT_MAX_MEMBERS_PER_PILLAR}) — 메가 클러스터 분할:`);
  {
    // 계획서 지정 케이스: 한 자리에 도달 가능한 점 10개(중심1+멤버9)
    //   → 상한 8 이면 8개 + 1개로 갈라져야 한다.
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (2 * Math.PI * i) / 10;
      pts.push(p(Math.cos(a), 10, Math.sin(a), 0.2));
    }

    // 대조군 — 상한을 크게 주면 구 동작(전부 한 기둥)이 재현된다.
    const unlimited = clusterForSharedPillars(pts, { maxMembersPerPillar: 1000 });
    assert(
      unlimited.length === 1 && unlimited[0].memberIndices.length === 9,
      `★ 대조군: 상한 없으면 기둥 1개에 다리 9개 — 실물 T-3(기둥 3개에 978다리)의 축소 재현`,
    );

    // 기본 상한 적용.
    const capped = clusterForSharedPillars(pts);
    const sizes = capped.map((c) => c.memberIndices.length).sort((a, b) => b - a);
    console.log(`       상한 없음 → 멤버 9개 / 기본 상한 → 클러스터 크기 [${sizes.join(", ")}]`);
    assert(
      capped.length === 2,
      `멤버 9개 입력 → 클러스터 ${capped.length}개로 분할 (기대 2: 8개 + 1개)`,
    );
    assert(
      sizes[0] === DEFAULT_MAX_MEMBERS_PER_PILLAR,
      `첫 기둥이 정확히 상한 ${DEFAULT_MAX_MEMBERS_PER_PILLAR}개를 받음 (${sizes[0]})`,
    );
    // 초과분이 유실되지 않고 다음 라운드로 되돌아갔는가.
    const seen = new Set();
    for (const c of capped) for (const i of [c.pillarIndex, ...c.memberIndices]) seen.add(i);
    assert(seen.size === pts.length, `전 ${pts.length}점이 배정됨 (초과 후보가 유실되지 않음)`);
  }

  // ── §7. 클러스터링 결정성 ────────────────────────────────────────────────
  console.log("\n(§7) 클러스터링 — 순서 무관 결정성:");
  {
    // 셔플하면 인덱스가 바뀌므로, 인덱스가 아닌 **기둥 XZ 집합**을 지문으로 쓴다.
    const pts = [];
    const rnd = makeRng(31337);
    for (let i = 0; i < 120; i++) pts.push(p(rnd() * 25, 4 + rnd() * 8, rnd() * 25, 0.2));
    const fp = (cl) =>
      cl
        .map((c) => `${c.pillarXZ[0].toFixed(6)},${c.pillarXZ[1].toFixed(6)}`)
        .sort()
        .join(" | ");
    const ref = fp(clusterForSharedPillars(pts));
    let same = true;
    for (const seed of [3, 11, 555]) {
      if (fp(clusterForSharedPillars(shuffled(pts, seed))) !== ref) same = false;
    }
    assert(same, "입력 3가지 셔플 → 동일한 기둥 위치 집합");
    // 같은 입력 반복 호출도 당연히 동일.
    assert(fp(clusterForSharedPillars(pts)) === ref, "동일 입력 반복 호출 → 동일 출력");
  }

  // ── §8. 경계 케이스 ──────────────────────────────────────────────────────
  console.log("\n(§8) 경계 케이스:");
  {
    assert(dedupeSupportPoints([]).length === 0, "빈 입력 → dedupe 빈 배열");
    assert(clusterForSharedPillars([]).length === 0, "빈 입력 → 클러스터 빈 배열");
  }
  {
    const one = [p(1, 5, 2, 0.3)];
    const kept = dedupeSupportPoints(one);
    assert(kept.length === 1 && kept[0].index === 0, "점 1개 → dedupe 그대로 1개");
    const cl = clusterForSharedPillars(one);
    assert(
      cl.length === 1 && cl[0].memberIndices.length === 0,
      "점 1개 → 멤버 없는 단독 기둥 클러스터 1개",
    );
  }
  {
    // 전부 같은 위치 5점.
    const same = [0, 1, 2, 3, 4].map(() => p(3, 7, 3, 0.25));
    const kept = dedupeSupportPoints(same);
    assert(kept.length === 1, "전부 같은 위치 5점 → 1개로 합쳐짐");
    assert(kept[0].mergedIndices.length === 4, "나머지 4개가 흡수 기록됨");
    // dedupe 를 끄고(0mm) 클러스터링하면 한 기둥에 전부 멤버로.
    const cl = clusterForSharedPillars(same);
    assert(
      cl.length === 1 && cl[0].memberIndices.length === 4,
      "같은 위치 점들은 수평거리 0 → 한 클러스터(기둥1+멤버4)",
    );
  }
  {
    // 높이 0 (바닥 접점) — 반경 0 이라 아무도 못 묶인다. 무한루프도 없어야 한다.
    const floor = [p(0, 0, 0, 0.2), p(2, 0, 0, 0.2), p(4, 0, 0, 0.2)];
    const cl = clusterForSharedPillars(floor);
    assert(
      cl.length === 3 && cl.every((c) => c.memberIndices.length === 0),
      "높이 0 바닥 접점 3점 → 각자 독립 기둥 3개 (Rmax=0)",
    );
    // 같은 자리 + 높이 0 은 수평거리 0 이라 묶인다 (반경 0 이어도 거리 0 은 통과).
    const stacked = [p(0, 0, 0, 0.2), p(0, 0, 0, 0.2)];
    assert(
      clusterForSharedPillars(stacked).length === 1,
      "높이 0 + 수평거리 0 → 같은 축이므로 한 클러스터 (다리 길이 0)",
    );
  }
  {
    // minBridgeLandingHeightMm — 지면 근처 다리 금지(연구 5절)가 실제로 먹히는가.
    const pts = [p(0, 5, 0, 0.2), p(4.5, 5, 0, 0.2)];
    const free = clusterForSharedPillars(pts, { minBridgeLandingHeightMm: 0 });
    const guarded = clusterForSharedPillars(pts, { minBridgeLandingHeightMm: 2 });
    assert(free.length === 1, "착지 하한 0 → 4.5mm 이격 두 점이 묶임 (h=5, Rmax=5)");
    assert(
      guarded.length === 2,
      "착지 하한 2mm → 착지 Y=0.5mm 라 거부, 각자 기둥 (지면 근처 다리 금지)",
    );
  }
  {
    // 퇴화 파라미터로도 무한루프·예외 없이 끝나는가.
    const pts = [p(0, 5, 0, 0.2), p(1, 5, 0, 0.2)];
    assert(
      clusterForSharedPillars(pts, { structuralAngleDeg: 0 }).length === 2,
      "구조각 0° → 다리가 옆으로 못 감, 전부 독립 기둥",
    );
    assert(
      clusterForSharedPillars(pts, { maxBridgeLengthMm: 0 }).length === 2,
      "다리 최대 길이 0 → 전부 독립 기둥",
    );
  }

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
