// 기둥 상호 연결(좌굴 방지) 계획 헤드리스 검증 (S-4b-2d).
//   interconnect-pillars.ts (순수 모듈)를 tsx 로 직접 import 해 Node 에서 돌린다.
//   충돌 검사는 **해석적 장애물**(축 정렬 박스)로 만든 합성 BeamProbe 를 주입한다
//   — Babylon 없이 전 경로를 전수 검증할 수 있는 이유가 BeamProbe 인터페이스로
//   충돌을 잘라낸 설계다(`verify-route-plan.mjs` 와 같은 기법).
//
//   실행: npx tsx scripts/verify-interconnect-pillars.mjs
//
//   ★ 변조 대조군(프로젝트 규약): 핵심 판정 3종(높이 임계 / 충돌검사 / 페어 중복
//     제거)을 각각 뺀 복제 구현을 같은 입력에 돌려, **원본이 거부하는 것을 변조본이
//     통과시킨다**는 것을 실검출한다(§f). 이 대조가 없으면 스크립트는 무가치하다.
//
//   근거: `docs/설계_서포트재설계_20260720.md` 4-6·4-3,
//         `docs/연구_프루사서포트_정독_20260811.md` 5절.

import {
  planPillarInterconnect,
  DEFAULT_INTERCONNECT_H1_MM,
  DEFAULT_INTERCONNECT_H2_MM,
  DEFAULT_MIN_HEIGHT_RATIO,
  DEFAULT_LINK_DIST_FACTOR,
  DEFAULT_MAX_BRACES_PER_PILLAR,
} from "../src/features/v2/support/interconnect-pillars.ts";
import { DEFAULT_MIN_LANDING_FACTOR } from "../src/features/v2/support/route-plan.ts";
import { DEFAULT_STRUCTURAL_ANGLE_DEG } from "../src/features/v2/support/detect/preprocess-points.ts";

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 합성 장애물 + BeamProbe — 광선과의 교차를 수식으로 푼다(메시 불요).
// ─────────────────────────────────────────────────────────────────────────────

/** 축 정렬 박스. slab 법으로 광선 진입 t(≥0)를 푼다. */
function box(min, max) {
  return {
    hit(o, d) {
      let t0 = 0;
      let t1 = Infinity;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-12) {
          if (o[i] < min[i] || o[i] > max[i]) return null;
          continue;
        }
        const inv = 1 / d[i];
        let a = (min[i] - o[i]) * inv;
        let b = (max[i] - o[i]) * inv;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
        if (t0 > t1) return null;
      }
      return t0;
    },
  };
}

const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function basis(d) {
  const ax = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross3(ax, d));
  const v = norm(cross3(d, u));
  return { u, v };
}

/**
 * 합성 probe — 링 광선 근사를 실제 구현(collision-probe.ts)과 같은 규약으로 흉내낸다.
 *   중심 + 링 8가닥을 (반경 + 안전거리) 만큼 벌려 쏘고 최소 히트를 채택.
 */
function makeProbe(obstacles, safetyMm = 0.5, ringCount = 8) {
  return {
    hitDistance(from, dir, radiusMm, maxDistMm) {
      if (!(maxDistMm > 0)) return null;
      const d = norm(dir);
      const offR = Math.max(radiusMm, 0) + safetyMm;
      const { u, v } = basis(d);
      let best = null;
      for (let i = -1; i < ringCount; i++) {
        let o = [...from];
        if (i >= 0 && offR > 0) {
          const a = (2 * Math.PI * i) / ringCount;
          const cu = Math.cos(a) * offR;
          const cv = Math.sin(a) * offR;
          o = [
            from[0] + u[0] * cu + v[0] * cv,
            from[1] + u[1] * cu + v[1] * cv,
            from[2] + u[2] * cu + v[2] * cv,
          ];
        }
        for (const ob of obstacles) {
          const t = ob.hit(o, d);
          if (t !== null && t <= maxDistMm) {
            if (best === null || t < best) best = t;
          }
        }
      }
      return best;
    },
  };
}

/** 장애물 없는 probe — 항상 청명. */
const CLEAR = makeProbe([]);

// ─────────────────────────────────────────────────────────────────────────────
// 기둥 만들기 도우미
// ─────────────────────────────────────────────────────────────────────────────

const R = 0.5; // 기둥 반경 (mm)

/** 수직 기둥 — (x,z) 에서 바닥(y=0)부터 높이 h 까지. */
function pillar(id, x, z, h, radiusMm = R) {
  return {
    id,
    polyline: [
      [x, 0, z],
      [x, h, z],
    ],
    radiusMm,
  };
}

/** 꺾인 기둥(bent) — 바닥에서 중간 waypoint 를 거쳐 접점까지. 결정 ⓑ 검증용. */
function bentPillar(id, x, z, h, radiusMm = R) {
  return {
    id,
    polyline: [
      [x, 0, z],
      [x + 2, h * 0.5, z + 2],
      [x + 2, h, z + 2],
    ],
    radiusMm,
  };
}

const opts = () => ({});

// ─────────────────────────────────────────────────────────────────────────────
// 본체
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  console.log("기둥 상호 연결 계획 검증 (S-4b-2d) — interconnect-pillars.ts\n");

  // ── (a) 상수 = 설계 정본 수치 ─────────────────────────────────────────────
  console.log("(a) 확정 스펙 수치가 설계서 §4-6 / 정독 §5 와 일치하는가:");
  assert(DEFAULT_INTERCONNECT_H1_MM === 15, "1차 임계 = 15mm (설계 4-6 표)");
  assert(DEFAULT_INTERCONNECT_H2_MM === 35, "2차 임계 = 35mm (설계 4-6 표)");
  assert(DEFAULT_MIN_HEIGHT_RATIO === 0.5, "높이비 하한 = 50% (정독 5절)");
  assert(
    DEFAULT_MIN_LANDING_FACTOR === 4,
    "지면 금지 = 4×r — route-plan-core 의 기존 상수를 재사용 (정의 중복 없음)",
  );
  assert(
    DEFAULT_STRUCTURAL_ANGLE_DEG === 45,
    "구조각 = 45° — 기존 파라미터 재사용, 새 각도 상수 없음 (설계 4-3)",
  );

  // ── (b) 높이 임계 2단 ─────────────────────────────────────────────────────
  console.log("\n(b) 높이 임계 2단 — 15mm↑ 이웃 1개, 35mm↑ 이웃 2개:");
  {
    // 임계 미만 기둥만 있으면 다리가 하나도 안 생긴다.
    const low = [pillar("a", 0, 0, 10), pillar("b", 6, 0, 10), pillar("c", 12, 0, 10)];
    const rLow = planPillarInterconnect(low, CLEAR, opts());
    assert(
      rLow.report.needed === 0 && rLow.braces.length === 0,
      `10mm 기둥 3개 → 연결 불요 (needed ${rLow.report.needed}, 다리 ${rLow.braces.length})`,
    );

    // 15mm 이상이면 이웃 1개가 필요하고 실제로 연결된다.
    const mid = [pillar("a", 0, 0, 20), pillar("b", 6, 0, 20), pillar("c", 12, 0, 20)];
    const rMid = planPillarInterconnect(mid, CLEAR, opts());
    assert(rMid.report.needed === 3, `20mm 기둥 3개 → 전부 연결 필요 (needed ${rMid.report.needed})`);
    assert(
      rMid.report.connected === 3 && rMid.report.lonely === 0,
      `20mm 기둥 전부 연결 성공 (connected ${rMid.report.connected}, lonely ${rMid.report.lonely})`,
    );
    assert(rMid.braces.length > 0, `실제 다리 생성 ${rMid.braces.length}개`);

    // 35mm 이상은 이웃 2개를 요구한다 — 이웃이 1개뿐이면 외톨이로 남는다.
    const tallPair = [pillar("a", 0, 0, 40), pillar("b", 6, 0, 40)];
    const rPair = planPillarInterconnect(tallPair, CLEAR, opts());
    assert(
      rPair.report.lonely === 2 && rPair.report.connected === 0,
      `40mm 기둥이 둘뿐 → 이웃 2개를 못 채워 전부 lonely (lonely ${rPair.report.lonely})`,
    );

    // 이웃이 2개 있으면 채운다.
    const tallTrio = [pillar("a", 0, 0, 40), pillar("b", 6, 0, 40), pillar("c", 12, 0, 40)];
    const rTrio = planPillarInterconnect(tallTrio, CLEAR, opts());
    assert(
      rTrio.report.connected >= 1,
      `40mm 기둥 3개 → 이웃 2개를 채운 기둥 ${rTrio.report.connected}개`,
    );
  }

  // ── (c) 결정성 + 페어 중복 없음 ───────────────────────────────────────────
  console.log("\n(c) 결정성·페어 중복 방지(pairhash):");
  {
    const set = [
      pillar("a", 0, 0, 25),
      pillar("b", 5, 0, 25),
      pillar("c", 10, 0, 25),
      pillar("d", 5, 5, 25),
      pillar("e", 0, 5, 25),
    ];
    const r1 = planPillarInterconnect(set, CLEAR, opts());
    const r2 = planPillarInterconnect(set, CLEAR, opts());
    assert(
      JSON.stringify(r1.braces) === JSON.stringify(r2.braces),
      `같은 입력 2회 → 완전히 같은 브레이스 목록 (${r1.braces.length}개, 무작위 없음)`,
    );

    // pairhash — 같은 (기둥, 기둥) 페어가 두 번 다뤄지면 안 된다.
    // 같은 페어의 다리는 지그재그 여러 단이 나올 수 있으므로 "페어별 단 번호"가
    // 겹치지 않는지로 본다.
    const seen = new Set();
    let dup = 0;
    for (const br of r1.braces) {
      const key =
        (br.fromId < br.toId ? `${br.fromId}|${br.toId}` : `${br.toId}|${br.fromId}`) +
        `#${br.step}#${br.cross ? "x" : "z"}`;
      if (seen.has(key)) dup++;
      seen.add(key);
    }
    assert(dup === 0, `페어×단×종류 중복 0건 (총 ${r1.braces.length}개 다리)`);

    // 입력 순서를 뒤집어도 "같은 페어 집합"이 나오는가 (pairhash 정규화 확인).
    const rev = planPillarInterconnect([...set].reverse(), CLEAR, opts());
    const pairsOf = (res) =>
      new Set(
        res.braces.map((b) => (b.fromId < b.toId ? `${b.fromId}|${b.toId}` : `${b.toId}|${b.fromId}`)),
      );
    const pf = pairsOf(r1);
    const pr = pairsOf(rev);
    assert(pf.size > 0 && pr.size > 0, `페어 집합이 비어 있지 않다 (정 ${pf.size} / 역 ${pr.size})`);

    // ★ 리포트 집계가 입력 순서에 의존하지 않는가 (검수 지적 회귀 가드).
    //   브레이스는 상호적이라 뒤 순번 기둥이 앞 기둥을 고르면 앞 기둥의 이웃 수가
    //   나중에 늘어난다. 집계를 루프 안에서 확정하면 **같은 브레이스 집합인데
    //   리포트만 달라진다.** 균일 격자에서는 안 드러나므로 아래 (c2) 에서
    //   비대칭 반경 배치로 따로 검사한다.
    assert(
      r1.report.connected === rev.report.connected &&
        r1.report.lonely === rev.report.lonely &&
        r1.report.needed === rev.report.needed,
      `역순 입력에서도 needed/connected/lonely 동일 ` +
        `(정 ${r1.report.needed}/${r1.report.connected}/${r1.report.lonely} · ` +
        `역 ${rev.report.needed}/${rev.report.connected}/${rev.report.lonely})`,
    );
  }

  // ── (c2) 비대칭 반경 — 집계 순서 의존 회귀 가드 ───────────────────────────
  //   굵은 기둥 c 는 탐색 반경이 넓어 a 를 이웃으로 보지만, 가는 a 는 c 를 못 본다.
  //   c 가 a 를 골라 다리를 놓으면 a 의 이웃 수는 **a 의 차례가 끝난 뒤에** 늘어난다.
  //   집계를 루프 안에서 하면 a 가 이미 lonely 로 세어진 뒤라 갱신되지 않는다.
  console.log("\n(c2) 비대칭 반경 — 리포트가 입력 순서에 의존하지 않는가:");
  {
    const asym = [
      { id: "a", polyline: [[0, 0, 0], [0, 40, 0]], radiusMm: 0.5 },
      { id: "b", polyline: [[6, 0, 0], [6, 40, 0]], radiusMm: 0.5 },
      { id: "c", polyline: [[25, 0, 0], [25, 40, 0]], radiusMm: 2.0 },
    ];
    const fwd = planPillarInterconnect(asym, CLEAR, opts());
    const bwd = planPillarInterconnect([...asym].reverse(), CLEAR, opts());

    assert(
      fwd.braces.length === bwd.braces.length,
      `비대칭 반경에서도 브레이스 수 동일 (정 ${fwd.braces.length} / 역 ${bwd.braces.length})`,
    );
    assert(
      fwd.report.connected === bwd.report.connected &&
        fwd.report.lonely === bwd.report.lonely,
      `비대칭 반경에서도 connected/lonely 동일 ` +
        `(정 ${fwd.report.connected}/${fwd.report.lonely} · 역 ${bwd.report.connected}/${bwd.report.lonely})`,
    );

    // 브레이스에서 실제 이웃 수를 역산해 리포트와 대조 — 집계가 진실과 맞는가.
    const actualNeighbors = (res) => {
      const m = new Map();
      const seenPair = new Set();
      for (const br of res.braces) {
        const k = br.fromId < br.toId ? `${br.fromId}|${br.toId}` : `${br.toId}|${br.fromId}`;
        if (seenPair.has(k)) continue;
        seenPair.add(k);
        m.set(br.fromId, (m.get(br.fromId) ?? 0) + 1);
        m.set(br.toId, (m.get(br.toId) ?? 0) + 1);
      }
      return m;
    };
    const nb = actualNeighbors(fwd);
    // 40mm 기둥이므로 전부 need=2. 실제로 2개를 채운 기둥 수 = connected 여야 한다.
    let trulyConnected = 0;
    for (const p of asym) if ((nb.get(p.id) ?? 0) >= 2) trulyConnected++;
    assert(
      fwd.report.connected === trulyConnected,
      `connected(${fwd.report.connected}) 가 브레이스에서 역산한 실제값(${trulyConnected})과 일치`,
    );
  }

  // ── (d) 지면 4×r 금지 + zstep = 수평거리 × tan(구조각) ────────────────────
  console.log("\n(d) 지면 4×r 이내 다리 금지 / zstep = 수평거리 × tan(45°):");
  {
    const two = [pillar("a", 0, 0, 30), pillar("b", 3, 0, 30)];
    const r = planPillarInterconnect(two, CLEAR, opts());
    const minAllowed = DEFAULT_MIN_LANDING_FACTOR * R; // 4 × 0.5 = 2mm
    let below = 0;
    for (const br of r.braces) {
      if (br.from[1] < minAllowed - 1e-9 || br.to[1] < minAllowed - 1e-9) below++;
    }
    assert(
      below === 0 && r.braces.length > 0,
      `다리 ${r.braces.length}개 전부 y ≥ ${minAllowed}mm (4×r) — 지면 근처 0건`,
    );

    // zstep 확인 — 수평거리 3mm, tan(45°)=1 이므로 Δy = 3mm.
    const zig = r.braces.filter((b) => !b.cross);
    if (zig.length > 0) {
      const dy = Math.abs(zig[0].to[1] - zig[0].from[1]);
      assert(
        Math.abs(dy - 3 * Math.tan((45 * Math.PI) / 180)) < 1e-6,
        `zstep = 수평거리 3mm × tan(45°) = ${dy.toFixed(4)}mm (구조각 재사용)`,
      );
    } else {
      assert(false, "지그재그 다리가 하나도 없다 — zstep 확인 불가");
    }

    // X자 교차 — 수평거리 3mm > 2×base_r(=1mm) 이므로 cross 가 있어야 한다.
    assert(
      r.braces.some((b) => b.cross),
      `거리 3mm > 2×base_r(1mm) → X자 교차 다리 존재 (${r.braces.filter((b) => b.cross).length}개)`,
    );

    // 반대로 거리가 2×base_r 이하이면 X자가 없어야 한다.
    const near = [pillar("a", 0, 0, 30, 2), pillar("b", 3.5, 0, 30, 2)];
    const rn = planPillarInterconnect(near, CLEAR, opts());
    assert(
      !rn.braces.some((b) => b.cross),
      `거리 3.5mm ≤ 2×base_r(4mm) → X자 교차 없음 (다리 ${rn.braces.length}개)`,
    );
  }

  // ── (e) 높이비 50% 규칙 / 충돌 거절 / 기둥당 상한 ─────────────────────────
  console.log("\n(e) 높이비 50% 미달 스킵 · 충돌 거절 · 기둥당 다리 상한:");
  {
    // 40mm 기둥 옆에 10mm 기둥만 있으면 비율 0.25 < 0.5 → 연결로 안 친다.
    const uneven = [pillar("tall", 0, 0, 40), pillar("short", 4, 0, 10)];
    const ru = planPillarInterconnect(uneven, CLEAR, opts());
    assert(
      ru.report.skippedByHeightRatio > 0,
      `높이비 10/40 = 0.25 < 0.5 → 스킵 ${ru.report.skippedByHeightRatio}건`,
    );
    assert(
      ru.braces.length === 0 && ru.report.lonely === 1,
      `낮은 이웃과는 다리를 안 만든다 (다리 ${ru.braces.length}, lonely ${ru.report.lonely})`,
    );

    // 비율이 50% 이상이면 연결한다 (경계 바로 위).
    const even = [pillar("tall", 0, 0, 40), pillar("mid", 4, 0, 21), pillar("mid2", 8, 0, 21)];
    const re = planPillarInterconnect(even, CLEAR, opts());
    assert(
      re.braces.length > 0,
      `높이비 21/40 = 0.525 ≥ 0.5 → 연결 성사 (다리 ${re.braces.length}개)`,
    );

    // 충돌 — 두 기둥 사이를 벽으로 막으면 다리가 전부 거절된다.
    const wall = box([1.4, -1, -5], [1.6, 60, 5]);
    const blocked = planPillarInterconnect(
      [pillar("a", 0, 0, 30), pillar("b", 3, 0, 30)],
      makeProbe([wall]),
      opts(),
    );
    assert(
      blocked.braces.length === 0 && blocked.report.rejectedByCollision > 0,
      `사이에 벽 → 다리 0개, 충돌 거절 ${blocked.report.rejectedByCollision}건`,
    );
    assert(
      blocked.report.lonely === 2,
      `충돌로 전부 막히면 lonely 2 (외톨이 구제는 범위 밖 — 정독 5절 "후속")`,
    );

    // 기둥당 **이웃 수** 상한 — 촘촘한 격자에서 어떤 기둥도 상한을 넘지 않는다.
    //   (낱개 다리가 아니라 페어 단위로 센다 — 지그재그는 페어당 여러 단이 나온다.)
    const grid = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) grid.push(pillar(`g${i}_${j}`, i * 4, j * 4, 40));
    }
    const rg = planPillarInterconnect(grid, CLEAR, opts());
    const nb = new Map();
    for (const b of rg.braces) {
      const k = b.fromId < b.toId ? `${b.fromId}|${b.toId}` : `${b.toId}|${b.fromId}`;
      for (const id of [b.fromId, b.toId]) {
        if (!nb.has(id)) nb.set(id, new Set());
        nb.get(id).add(k);
      }
    }
    let over = 0;
    for (const s of nb.values()) if (s.size > DEFAULT_MAX_BRACES_PER_PILLAR) over++;
    assert(
      over === 0,
      `격자 16기둥 → 다리 ${rg.braces.length}개, 이웃 상한 ${DEFAULT_MAX_BRACES_PER_PILLAR} 초과 기둥 0개`,
    );

    // 이웃 탐색 거리 — max_d = linkDistFactor × r 밖이면 후보가 아니다.
    const far = [pillar("a", 0, 0, 30), pillar("b", DEFAULT_LINK_DIST_FACTOR * R + 10, 0, 30)];
    const rf = planPillarInterconnect(far, CLEAR, opts());
    assert(
      rf.braces.length === 0 && rf.report.lonely === 2,
      `max_d(${DEFAULT_LINK_DIST_FACTOR * R}mm) 밖 이웃 → 연결 없음`,
    );
  }

  // ── (e2) 결정 ⓑ — 꺾인 기둥의 높이 = 경로 전체 Y 범위 ─────────────────────
  console.log("\n(e2) 결정 ⓑ — bent 기둥 높이는 경로 전체 Y 범위(maxY − minY):");
  {
    // 꺾인 기둥이지만 Y 범위가 20mm 라 임계를 넘는다 → 연결 대상.
    const bents = [bentPillar("a", 0, 0, 20), bentPillar("b", 8, 0, 20), bentPillar("c", 16, 0, 20)];
    const rb = planPillarInterconnect(bents, CLEAR, opts());
    assert(rb.report.needed === 3, `꺾인 기둥도 Y 범위 20mm 로 임계 판정 (needed ${rb.report.needed})`);
    // 다리 양 끝이 실제로 기둥 경로 위에 있어야 한다(허공 금지).
    const byId = new Map(bents.map((p) => [p.id, p]));
    const onPath = (id, pt) => {
      const poly = byId.get(id).polyline;
      for (let i = 0; i < poly.length - 1; i++) {
        const lo = poly[i];
        const hi = poly[i + 1];
        if (pt[1] < Math.min(lo[1], hi[1]) - 1e-6 || pt[1] > Math.max(lo[1], hi[1]) + 1e-6) continue;
        const span = hi[1] - lo[1];
        const t = span === 0 ? 0 : (pt[1] - lo[1]) / span;
        const ex = lo[0] + (hi[0] - lo[0]) * t;
        const ez = lo[2] + (hi[2] - lo[2]) * t;
        if (Math.abs(ex - pt[0]) < 1e-6 && Math.abs(ez - pt[2]) < 1e-6) return true;
      }
      return false;
    };
    let offPath = 0;
    for (const br of rb.braces) {
      if (!onPath(br.fromId, br.from)) offPath++;
      if (!onPath(br.toId, br.to)) offPath++;
    }
    assert(
      offPath === 0 && rb.braces.length > 0,
      `꺾인 기둥 다리 ${rb.braces.length}개의 끝점이 전부 실제 경로 위 (허공 0건)`,
    );
  }

  // ── (f) ★ 변조 대조군 — 판정을 하나씩 빼면 실제로 FAIL 하는가 ─────────────
  console.log("\n(f) ★ 변조 대조군 — 핵심 판정 3종을 뺀 구현이 실제로 FAIL 하는가:");
  {
    let proven = 0;

    // 변조 A — 높이 임계 무력화: 모든 기둥이 연결 대상이라고 본다.
    //   원본은 (b) 에서 "10mm 기둥 3개 → 다리 0개"를 단언한다. 변조본은 다리를 만든다.
    {
      const low = [pillar("a", 0, 0, 10), pillar("b", 6, 0, 10), pillar("c", 12, 0, 10)];
      const real = planPillarInterconnect(low, CLEAR, opts());
      // 임계를 0 으로 낮춘 것이 곧 "임계 무력화" 변조와 동등하다.
      const mutated = planPillarInterconnect(low, CLEAR, { h1Mm: 0, h2Mm: 0 });
      const detected = real.braces.length === 0 && mutated.braces.length > 0;
      if (detected) proven++;
      assert(
        detected,
        `변조 A(높이 임계 무력화) → 원본 다리 0개 vs 변조본 ${mutated.braces.length}개 ` +
          `= (b) 의 "10mm 기둥은 연결 불요" 단언이 FAIL`,
      );
    }

    // 변조 B — 충돌검사 건너뛰기: 벽이 있어도 다리를 만든다.
    //   원본은 (e) 에서 "벽 → 다리 0개"를 단언한다.
    {
      const two = [pillar("a", 0, 0, 30), pillar("b", 3, 0, 30)];
      const wall = box([1.4, -1, -5], [1.6, 60, 5]);
      const real = planPillarInterconnect(two, makeProbe([wall]), opts());
      // 충돌검사를 건너뛴 구현 = 항상 청명한 probe 를 쓴 것과 결과가 같다.
      const mutated = planPillarInterconnect(two, CLEAR, opts());
      const detected = real.braces.length === 0 && mutated.braces.length > 0;
      if (detected) proven++;
      assert(
        detected,
        `변조 B(충돌검사 생략) → 원본 0개 vs 변조본 ${mutated.braces.length}개 관통 다리 ` +
          `= (e) 의 "벽이 있으면 다리 0개" 단언이 FAIL`,
      );
      // 변조본의 다리가 실제로 벽을 관통하는지 직접 확인(대조가 허수가 아님).
      let pierce = 0;
      for (const br of mutated.braces) {
        const d = [br.to[0] - br.from[0], br.to[1] - br.from[1], br.to[2] - br.from[2]];
        const len = Math.hypot(d[0], d[1], d[2]);
        const t = wall.hit(br.from, [d[0] / len, d[1] / len, d[2] / len]);
        if (t !== null && t <= len) pierce++;
      }
      assert(pierce > 0, `변조 B 의 다리 ${pierce}개가 실제로 벽을 관통한다 (관통 실검출)`);
    }

    // 변조 C — 페어 중복 제거(pairhash) 제거: 같은 페어를 여러 번 건다.
    //   원본 planPillarInterconnect 의 donePairs 를 뺀 복제 구현을 여기서 만든다.
    {
      const set = [pillar("a", 0, 0, 40), pillar("b", 5, 0, 40), pillar("c", 10, 0, 40)];
      const real = planPillarInterconnect(set, CLEAR, opts());

      // ★ 원본의 "다뤄진 페어" — 같은 페어의 지그재그 여러 단은 한 번으로 친다.
      //   pairhash 가 살아 있으면 어떤 페어도 두 번 다뤄지지 않으므로, 페어별
      //   (단, 종류) 조합이 유일해야 한다. 그 유일성이 곧 중복 0 의 증거다.
      const realKeys = real.braces.map(
        (b) =>
          (b.fromId < b.toId ? `${b.fromId}|${b.toId}` : `${b.toId}|${b.fromId}`) +
          `#${b.step}#${b.cross ? "x" : "z"}`,
      );
      const dupInReal = countDupPairs(realKeys);

      // ★ pairhash 없이 돌린 복제 — a 가 b 를 고르고, 뒤이어 b 도 a 를 고른다.
      //   같은 페어가 두 번 "다뤄지므로" 같은 단의 다리가 통째로 두 벌 나온다.
      const mutatedPairs = mutatedNoPairhash(set);
      const dupInMutated = countDupPairs(mutatedPairs);
      const detected = dupInReal === 0 && dupInMutated > 0;
      if (detected) proven++;
      assert(
        detected,
        `변조 C(pairhash 제거) → 원본 중복 페어 ${dupInReal}건 vs 변조본 ${dupInMutated}건 ` +
          `= (c) 의 "페어 중복 0건" 단언이 FAIL`,
      );
    }

    assert(proven === 3, `변조 3종 전부 실검출 (${proven}/3) — 검사가 살아 있다는 증명`);
  }

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

/**
 * 변조 C 전용 — pairhash(페어 중복 방지) 를 **뺀** 이웃 선택 복제.
 *   원본과 같은 순서로 기둥을 돌며 "가까운 이웃부터 필요한 수만큼" 고르되,
 *   이미 다룬 페어인지 보지 않는다. 그 결과 (a,b) 와 (b,a) 가 둘 다 나온다.
 * @returns 정규화된 페어 키 배열(중복 포함).
 */
function mutatedNoPairhash(pillars) {
  const out = [];
  const list = pillars.map((p, i) => {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of p.polyline) {
      minY = Math.min(minY, v[1]);
      maxY = Math.max(maxY, v[1]);
    }
    return { id: p.id, order: i, r: p.radiusMm, x: p.polyline[0][0], z: p.polyline[0][2], h: maxY - minY };
  });
  for (const a of list) {
    const need = a.h >= DEFAULT_INTERCONNECT_H2_MM ? 2 : a.h >= DEFAULT_INTERCONNECT_H1_MM ? 1 : 0;
    if (need === 0) continue;
    const cands = list
      .filter((b) => b.id !== a.id)
      .map((b) => ({ b, d: Math.hypot(b.x - a.x, b.z - a.z) }))
      .filter((c) => c.d <= DEFAULT_LINK_DIST_FACTOR * a.r)
      .sort((u, v) => (u.d !== v.d ? u.d - v.d : u.b.order - v.b.order));
    let taken = 0;
    for (const c of cands) {
      if (taken >= need) break;
      const short = Math.min(a.h, c.b.h);
      const long = Math.max(a.h, c.b.h);
      if (short / long < DEFAULT_MIN_HEIGHT_RATIO) continue;
      // ★ 여기서 pairhash 검사를 하지 않는다 (변조).
      out.push(a.id < c.b.id ? `${a.id}|${c.b.id}` : `${c.b.id}|${a.id}`);
      taken++;
    }
  }
  return out;
}

/** 정규화된 페어 키 배열에서 중복 건수를 센다. */
function countDupPairs(keys) {
  const seen = new Set();
  let dup = 0;
  for (const k of keys) {
    if (seen.has(k)) dup++;
    seen.add(k);
  }
  return dup;
}

main();
