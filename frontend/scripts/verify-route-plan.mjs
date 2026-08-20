// 3단 폴백 라우팅 + 라우팅 형상 조립 헤드리스 검증 (S-4b-2c).
//   route-plan.ts / assemble-route.ts (둘 다 순수 모듈)를 tsx 로 직접 import 해
//   Node 에서 돌린다. 충돌 검사는 **해석적 장애물**(축 정렬 박스·구)로 만든 합성
//   BeamProbe 를 주입한다 — Babylon 없이 전 경로를 전수 검증할 수 있는 이유가
//   BeamProbe 인터페이스로 충돌을 잘라낸 설계다.
//
//   실행: npx tsx scripts/verify-route-plan.mjs
//
//   ★ 대조군(프로젝트 규약, B-1 확립): "수정 전 동작 = 무조건 수직"을 같은 장애물에
//     통과시켜 **관통이 실제로 발생**함을 스크립트가 검출하고, 새 라우팅은 같은
//     입력에서 관통 0 임을 대조한다(§h).
//   ★ 변조 시험: 핵심 판정 3종을 각각 뺀 복제본을 만들어 해당 테스트가 실제로
//     FAIL 하는지 확인한다(§i). 검사가 살아 있다는 증명.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  planPointRoute,
  planClusterRoutes,
  DEFAULT_ANCHOR_MAX_LENGTH_MM,
  DEFAULT_MIN_LANDING_FACTOR,
  DEFAULT_WALK_AZIMUTH_COUNT,
} from "../src/features/v2/support/route-plan.ts";
import { assembleRoutedSupport } from "../src/features/v2/support/assemble-route.ts";
import { buildSupportKey } from "../src/features/v2/components/babylon/support-keys.ts";
import { sliceTrianglesAtY } from "../src/features/v2/utils/slice-geometry.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARTS = join(__dirname, "..", "src", "features", "v2", "support", "parts");

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}
function approx(a, b, tol, msg) {
  assert(
    Math.abs(a - b) <= tol,
    `${msg} (${a.toExponential(3)} ≈ ${b.toExponential(3)}, tol ${tol})`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 합성 장애물 + BeamProbe — 광선과의 교차를 수식으로 푼다(메시 불요).
// ─────────────────────────────────────────────────────────────────────────────

/** 축 정렬 박스. {min:[x,y,z], max:[x,y,z]} */
function box(min, max) {
  return {
    /** slab 법 — 광선 [o + t·d] 가 박스에 들어가는 최소 t(≥0). 없으면 null. */
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
    /** 점이 박스 안인가 (판정용). */
    contains(p) {
      return (
        p[0] >= min[0] && p[0] <= max[0] &&
        p[1] >= min[1] && p[1] <= max[1] &&
        p[2] >= min[2] && p[2] <= max[2]
      );
    },
  };
}

/**
 * 합성 probe — 링 광선 근사를 실제 구현과 같은 방식으로 흉내낸다.
 *   중심 + 링 8가닥을 (반경 + 안전거리) 만큼 벌려 쏘고 최소 히트를 채택.
 *   실제 collision-probe.ts 와 같은 근사 규약이라, 여기서 통과한 라우팅은
 *   Babylon 쪽에서도 같은 판정을 받는다.
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

const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
function basis(d) {
  const ax = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(ax, d));
  const v = norm(cross(d, u));
  return { u, v };
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// 공통 옵션 — 실제 배선(redesign-detect-actions)이 주는 값과 같은 형태.
const R = 0.5; // strutRadiusMm (trunkDiameterMm 1.0 기준).
const HEAD = 1.2; // headClearanceMm = headLengthMm(1.0) + contactPenetrationMm(0.2).
const OPTS = { strutRadiusMm: R, headClearanceMm: HEAD };
const MIN_LANDING = DEFAULT_MIN_LANDING_FACTOR * R; // 2.0mm.

/** 라우팅 입력 점 만들기. */
const pt = (x, y, z, kind = "island") => ({ contact: [x, y, z], tipRadius: 0.2, kind });

// ─────────────────────────────────────────────────────────────────────────────
// STL 부품 로드 (조립 통합 테스트용)
// ─────────────────────────────────────────────────────────────────────────────

function parseBinaryStl(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  const indices = new Uint32Array(count * 3);
  let off = 84;
  let pi = 0;
  for (let t = 0; t < count; t++) {
    off += 12;
    for (let v = 0; v < 3; v++) {
      positions[pi++] = dv.getFloat32(off, true);
      positions[pi++] = dv.getFloat32(off + 4, true);
      positions[pi++] = dv.getFloat32(off + 8, true);
      off += 12;
    }
    off += 2;
  }
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}
const loadPart = (n) => parseBinaryStl(readFileSync(join(PARTS, n)));

function toTriangleArray(geo) {
  const tris = new Float32Array(geo.indices.length * 3);
  for (let i = 0; i < geo.indices.length; i++) {
    const k = geo.indices[i] * 3;
    tris[i * 3] = geo.positions[k];
    tris[i * 3 + 1] = geo.positions[k + 1];
    tris[i * 3 + 2] = geo.positions[k + 2];
  }
  return tris;
}
function hasSectionAt(tris, y) {
  const segs = sliceTrianglesAtY(tris, y);
  return !!segs && segs.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 변조본 — 핵심 판정을 하나씩 뺀 복제 구현 (§i 에서 실검출 확인)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 변조 A — 걸어나가기에서 **하향 검사 제거**: 경사 구간만 청명하면 바로 채택.
 *   진짜 구현은 "그 자리에서 플레이트까지 내려갈 수 있는가"를 함께 본다.
 */
function tamperedWalkNoDownCheck(contact, probe, opts) {
  const theta = Math.PI / 4;
  const r = opts.strutRadiusMm;
  const start = [contact[0], contact[1] - opts.headClearanceMm, contact[2]];
  if (probe.hitDistance(start, [0, -1, 0], r, start[1]) === null) {
    return { kind: "vertical" };
  }
  for (let a = 0; a < DEFAULT_WALK_AZIMUTH_COUNT; a++) {
    const phi = (2 * Math.PI * a) / DEFAULT_WALK_AZIMUTH_COUNT;
    const dir = [
      Math.sin(theta) * Math.cos(phi),
      -Math.cos(theta),
      Math.sin(theta) * Math.sin(phi),
    ];
    for (let t = r; t <= 15 + 1e-9; t += r) {
      const turn = [start[0] + dir[0] * t, start[1] + dir[1] * t, start[2] + dir[2] * t];
      if (turn[1] < MIN_LANDING) break;
      if (probe.hitDistance(start, dir, r, t) !== null) break;
      // ★ 여기서 하향 검사를 하지 않는다 (변조).
      return { kind: "bent", waypoints: [turn], landingXZ: [turn[0], turn[2]] };
    }
  }
  return { kind: "failed", reason: "no-route" };
}

/**
 * 변조 B — 합류 착지점 **클램프 제거**: 기둥 꼭대기를 무시하고 이상적 착지만 본다.
 *   진짜 구현은 landingY = min(ideal, pillarTopY) 로 클램프한다.
 */
function tamperedJoinNoClamp(memberContact, pillarContact, opts) {
  const start = [
    memberContact[0],
    memberContact[1] - opts.headClearanceMm,
    memberContact[2],
  ];
  const horiz = Math.hypot(
    pillarContact[0] - start[0],
    pillarContact[2] - start[2],
  );
  const idealY = start[1] - horiz / Math.tan(Math.PI / 4); // tan45 = 1.
  // ★ pillarTopY 클램프 없음 (변조).
  const landingY = idealY;
  if (landingY < MIN_LANDING) return null;
  const drop = start[1] - landingY;
  const length = Math.hypot(horiz, drop);
  if (length > 15) return null;
  return { junction: [pillarContact[0], landingY, pillarContact[2]], length };
}

/** 변조 C — minLanding 제거: 착지 하한을 보지 않는다. */
function tamperedJoinNoMinLanding(memberContact, pillarContact, opts) {
  const start = [
    memberContact[0],
    memberContact[1] - opts.headClearanceMm,
    memberContact[2],
  ];
  const horiz = Math.hypot(
    pillarContact[0] - start[0],
    pillarContact[2] - start[2],
  );
  const pillarTopY = pillarContact[1] - opts.headClearanceMm;
  const landingY = Math.min(start[1] - horiz, pillarTopY);
  // ★ landingY >= MIN_LANDING 검사 없음 (변조).
  const drop = start[1] - landingY;
  const length = Math.hypot(horiz, drop);
  if (length > 15) return null;
  return { junction: [pillarContact[0], landingY, pillarContact[2]], length };
}

// ─────────────────────────────────────────────────────────────────────────────

function main() {
  console.log("=== S-4b-2c 라우팅 검증 ===");
  console.log(
    `  옵션: r=${R}mm, headClearance=${HEAD}mm, minLanding=${MIN_LANDING}mm ` +
      `(=${DEFAULT_MIN_LANDING_FACTOR}×r), 앵커 상한=${DEFAULT_ANCHOR_MAX_LENGTH_MM}mm, ` +
      `방위 ${DEFAULT_WALK_AZIMUTH_COUNT}개`,
  );

  // ── (a) 장애물 없음 → 전원 vertical ─────────────────────────────────────
  console.log("\n(a) 장애물 없음 → 전원 수직 (기존 결과와 동일):");
  {
    const probe = makeProbe([]);
    const pts = [pt(0, 10, 0), pt(30, 12, 0), pt(-20, 8, 15)];
    const { routes, report } = planClusterRoutes(pts, probe, OPTS);
    assert(
      routes.every((r) => r.kind === "vertical"),
      `전원 vertical (${routes.map((r) => r.kind).join(", ")})`,
    );
    assert(report.vertical === 3 && report.bent === 0 && report.anchored === 0,
      `report: 수직 ${report.vertical} · 경사 ${report.bent} · 앵커 ${report.anchored}`);
    assert(report.failed === 0, "실패 0");
    // 저장 형태 무회귀의 근거: vertical 경로는 waypoints 가 없다.
    assert(
      routes.every((r) => !("waypoints" in r)),
      "vertical 은 routeWaypoints 를 만들지 않는다 (저장 형태 = S-4b-1 과 동일)",
    );
  }

  // ── (b) 점 바로 아래 박스 → bent ────────────────────────────────────────
  console.log("\n(b) 점 바로 아래 박스 → 경사로 비껴 하강:");
  {
    // 접점 (0, 20, 0). 아래 Y 0~8, XZ −4..4 박스.
    //   ★ 접점 높이의 조건: 45° 로 내려가면서 옆으로 빠지려면, 화살촉 아래 시작점이
    //     박스 윗면보다 **(반폭 + 반경 + 안전거리)** 이상 높아야 한다. 그보다 낮으면
    //     경사 경로가 옆으로 다 빠지기 전에 박스 윗면에 처박힌다 — 알고리즘의 성질
    //     이지 버그가 아니며, 그 경우는 (c) 처럼 3단 앵커로 넘어간다.
    //     여기서는 여유(20−1.2−8 = 10.8mm > 4+0.5+0.5)를 두고 2단을 시험한다.
    const obst = box([-4, 0, -4], [4, 8, 4]);
    const probe = makeProbe([obst]);
    const route = planPointRoute([0, 20, 0], probe, OPTS);
    assert(route.kind === "bent", `경로 = ${route.kind} (기대 bent)`);
    if (route.kind === "bent") {
      const turn = route.waypoints[0];
      const start = [0, 20 - HEAD, 0];
      const horiz = Math.hypot(turn[0] - start[0], turn[2] - start[2]);
      const drop = start[1] - turn[1];
      const len = Math.hypot(horiz, drop);
      const angleDeg = (Math.atan2(horiz, drop) * 180) / Math.PI;
      console.log(
        `      전환점 [${turn.map((v) => v.toFixed(3)).join(", ")}] · ` +
          `경사길이 ${len.toFixed(3)}mm · 각 ${angleDeg.toFixed(6)}°`,
      );
      approx(angleDeg, 45, 1e-6, "경사각 = 구조각 45°");
      assert(len <= 15 + 1e-9, `경사 길이 ${len.toFixed(3)}mm ≤ 15mm`);
      assert(turn[1] >= MIN_LANDING - 1e-9, `착지 Y ${turn[1].toFixed(3)} ≥ ${MIN_LANDING}mm`);
      assert(!obst.contains(turn), "전환점이 박스 밖");
      // 착지 XZ 도 박스 밖(수직 하강 구간이 박스를 안 지난다).
      assert(
        !obst.contains([route.landingXZ[0], 1, route.landingXZ[1]]),
        "착지 수직 구간이 박스를 지나지 않음",
      );
      // 실제로 하향 빔이 청명한지 재확인 (구현이 검사했다는 주장의 독립 검증).
      assert(
        probe.hitDistance(turn, [0, -1, 0], R, turn[1]) === null,
        "전환점 아래 하향 빔이 플레이트까지 청명",
      );
    }
  }

  // ── (c) 바닥까지 전부 막힘 + 10mm 이내 표면 → anchor ────────────────────
  console.log("\n(c) 사방 막힘 + 아래 표면 5mm → 모델 앵커:");
  {
    // 넓은 판(Y 0~5) 이 모든 방향을 덮어 걸어나가기도 못 한다.
    const slab = box([-500, 0, -500], [500, 5, 500]);
    const probe = makeProbe([slab]);
    const contactY = 5 + HEAD + 3; // 표면 위 3mm 지점에서 화살촉 아래가 시작.
    const route = planPointRoute([0, contactY, 0], probe, OPTS);
    assert(route.kind === "anchor", `경로 = ${route.kind} (기대 anchor)`);
    if (route.kind === "anchor") {
      console.log(`      앵커점 [${route.anchorPoint.map((v) => v.toFixed(3)).join(", ")}]`);
      approx(route.anchorPoint[1], 5, 1e-6, "앵커 Y = 판 윗면(첫 히트점)");
      const dist = contactY - HEAD - route.anchorPoint[1];
      assert(
        dist <= DEFAULT_ANCHOR_MAX_LENGTH_MM + 1e-9,
        `앵커 거리 ${dist.toFixed(3)}mm ≤ 상한 ${DEFAULT_ANCHOR_MAX_LENGTH_MM}mm`,
      );
    }
  }

  // ── (d) 앵커도 불가 (히트 12mm) → failed ────────────────────────────────
  console.log("\n(d) 앵커 상한 초과(히트 12mm) → 실패 + 카운트:");
  {
    const slab = box([-500, 0, -500], [500, 5, 500]);
    const probe = makeProbe([slab]);
    const contactY = 5 + HEAD + 12; // 화살촉 아래에서 표면까지 12mm.
    const route = planPointRoute([0, contactY, 0], probe, OPTS);
    assert(route.kind === "failed", `경로 = ${route.kind} (기대 failed)`);
    if (route.kind === "failed") {
      assert(route.reason === "no-route", `사유 = ${route.reason} (기대 no-route)`);
    }
    // 카운트가 실제로 report 에 실리는가 (island 실패는 따로 센다).
    const { report } = planClusterRoutes([pt(0, contactY, 0, "island")], probe, OPTS);
    assert(report.failed === 1, `report.failed = ${report.failed} (기대 1)`);
    assert(
      report.failedIslandCount === 1,
      `report.failedIslandCount = ${report.failedIslandCount} (기대 1) — 조용히 버리지 않는다`,
    );
  }

  // ── (e) ★ 인계 조건 1 — 착지점 pillarTopY 클램프 → 합류 거부 ────────────
  console.log("\n(e) ★ 높은 멤버 + 낮은 중심 기둥 → 클램프로 다리 초과 → 합류 거부:");
  {
    const probe = makeProbe([]);
    // 멤버 h=20mm, 기둥 h=3mm, 수평 3mm.
    //   이상적 착지 = 20−1.2−3 = 15.8mm 인데 기둥 꼭대기는 3−1.2 = 1.8mm 뿐.
    //   클램프하면 drop = 18.8−1.8 = 17mm → 다리 길이 √(3²+17²)=17.26mm > 15mm.
    //   게다가 착지 1.8mm < minLanding 2.0mm 라 어느 쪽으로도 거부돼야 한다.
    const member = pt(3, 20, 0);
    const pillar = pt(0, 3, 0);
    const { routes, report } = planClusterRoutes([member, pillar], probe, OPTS);
    const kinds = routes.map((r) => r.kind);
    console.log(`      경로 = [${kinds.join(", ")}], 합류 ${report.joined}개`);
    assert(report.joined === 0, `합류 0개 — 클램프된 기하가 상한을 넘어 거부됨`);
    assert(
      routes.every((r) => r.kind === "vertical"),
      "두 점 모두 개별 수직 기둥으로 폴백 (장애물이 없으니 vertical)",
    );
    // 클램프가 없다면 어떻게 되는가 (변조본 대조 — §i 와 짝).
    const bad = tamperedJoinNoClamp(member.contact, pillar.contact, OPTS);
    assert(
      bad !== null,
      `클램프 없는 변조본은 같은 입력을 통과시킨다 (길이 ${bad ? bad.length.toFixed(3) : "-"}mm, ` +
        `착지 Y ${bad ? bad.junction[1].toFixed(3) : "-"}mm) — 기둥이 없는 허공에 다리를 붙인다`,
    );
    if (bad) {
      const pillarTopY = pillar.contact[1] - HEAD;
      assert(
        bad.junction[1] > pillarTopY + 1e-9,
        `변조본의 착지 Y ${bad.junction[1].toFixed(3)} > 기둥 꼭대기 ${pillarTopY.toFixed(3)} — ` +
          "허공 부착이 실제로 발생",
      );
    }
  }

  // ── (f) minLanding — 낮은 멤버의 합류 다리 거부 ─────────────────────────
  console.log(`\n(f) minLanding(${MIN_LANDING}mm) — 접점이 낮은 멤버의 합류 거부:`);
  {
    const probe = makeProbe([]);
    // 두 점 모두 h=2.5mm (화살촉 아래 1.3mm < minLanding 2.0mm). 수평 1mm.
    //   어떤 다리를 놓아도 착지가 1.3mm 이하라 minLanding 을 못 넘는다.
    const pts = [pt(0, 2.5, 0), pt(1, 2.5, 0)];
    const { routes, report } = planClusterRoutes(pts, probe, OPTS);
    console.log(`      경로 = [${routes.map((r) => r.kind).join(", ")}]`);
    assert(report.joined === 0, `합류 0개 — 접점이 낮아 다리가 바닥 코앞에 붙는다`);
    assert(report.vertical === 2, `두 점 모두 자기 수직 기둥 (${report.vertical}개)`);
    // minLanding 을 안 보는 변조본은 통과시킨다.
    const bad = tamperedJoinNoMinLanding(pts[1].contact, pts[0].contact, OPTS);
    assert(
      bad !== null && bad.junction[1] < MIN_LANDING,
      `minLanding 없는 변조본은 착지 Y ${bad ? bad.junction[1].toFixed(3) : "-"}mm ` +
        `(< ${MIN_LANDING}mm) 다리를 만든다`,
    );
  }

  // ── (g) 결정성 — 입력 셔플 3회 ──────────────────────────────────────────
  console.log("\n(g) 결정성 — 입력 순서를 섞어도 같은 결과:");
  {
    const obst = box([-3, 0, -3], [3, 6, 3]);
    const probe = makeProbe([obst]);
    const base = [
      pt(0, 12, 0), pt(2, 12, 1), pt(-2, 11, -1),
      pt(9, 10, 0), pt(11, 10, 2), pt(-9, 9, 4),
      pt(0, 3, 9), pt(20, 14, -8),
    ];
    const sig = (pts) => {
      const { routes, deduped, report } = planClusterRoutes(pts, probe, OPTS);
      // 대표점 좌표를 키로 붙여 순서 의존을 배제한 정규 서명을 만든다.
      const rows = routes.map((r, i) => {
        const c = deduped[i].contact.map((v) => v.toFixed(6)).join(",");
        const extra =
          r.kind === "bent"
            ? r.waypoints.map((w) => w.map((v) => v.toFixed(6)).join(",")).join(";")
            : r.kind === "anchor"
              ? r.anchorPoint.map((v) => v.toFixed(6)).join(",")
              : r.kind === "joinPillar"
                ? r.junction.map((v) => v.toFixed(6)).join(",")
                : "";
        return `${c}=>${r.kind}[${extra}]`;
      });
      rows.sort();
      return rows.join("|") + "##" + JSON.stringify(report);
    };
    const ref = sig(base);
    const shuffles = [
      [3, 1, 7, 0, 5, 2, 6, 4],
      [7, 6, 5, 4, 3, 2, 1, 0],
      [2, 5, 0, 6, 1, 7, 4, 3],
    ];
    let same = 0;
    for (const perm of shuffles) {
      if (sig(perm.map((i) => base[i])) === ref) same++;
    }
    assert(same === 3, `셔플 3회 모두 동일한 결과 (${same}/3)`);
    // 이 케이스가 실제로 다양한 경로를 만들었는지 (전부 vertical 이면 무의미).
    const { report } = planClusterRoutes(base, probe, OPTS);
    console.log(`      report: ${JSON.stringify(report)}`);
    assert(
      report.vertical + report.bent + report.joined + report.anchored ===
        report.afterDedupe - report.failed,
      "집계 합계가 대표점 수와 일치",
    );
  }

  // ── (h) ★ 대조군 — 수정 전 동작(무조건 수직)은 관통한다 ─────────────────
  console.log("\n(h) ★ 대조군 — 수정 전(무조건 수직) vs 새 라우팅, 같은 장애물:");
  {
    // (b) 와 같은 박스. 접점은 그 위 충분한 높이에 흩어 둔다(위 (b) 의 여유 조건).
    const obst = box([-4, 0, -4], [4, 8, 4]);
    const probe = makeProbe([obst]);
    const pts = [pt(0, 20, 0), pt(2, 20.5, 1), pt(-2, 19.5, -2), pt(3, 21, -3)];

    // 대조군: 수정 전 동작 = 모든 점을 접점 아래 그대로 수직 하강.
    let controlPierced = 0;
    for (const p of pts) {
      const start = [p.contact[0], p.contact[1] - HEAD, p.contact[2]];
      if (probe.hitDistance(start, [0, -1, 0], R, start[1]) !== null) controlPierced++;
    }
    console.log(`      대조군(무조건 수직): ${pts.length}점 중 관통 ${controlPierced}점`);
    assert(
      controlPierced === pts.length,
      `수정 전 동작은 이 입력에서 전 점(${controlPierced}/${pts.length})이 모델을 관통한다 ` +
        "— 검사 자체가 실제 문제를 잡는다는 증명",
    );

    // 새 라우팅: 만들어진 모든 구간을 다시 빔 검사해 관통 0 을 확인.
    const { routes, deduped } = planClusterRoutes(pts, probe, OPTS);
    let newPierced = 0;
    let checked = 0;
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      const c = deduped[i].contact;
      const start = [c[0], c[1] - HEAD, c[2]];
      const segs = [];
      if (r.kind === "vertical") {
        segs.push([start, [start[0], 0, start[2]]]);
      } else if (r.kind === "bent") {
        const path = [start, ...r.waypoints, [r.landingXZ[0], 0, r.landingXZ[1]]];
        for (let k = 0; k + 1 < path.length; k++) segs.push([path[k], path[k + 1]]);
      } else if (r.kind === "joinPillar") {
        segs.push([start, r.junction]);
      } else if (r.kind === "anchor") {
        segs.push([start, r.anchorPoint]);
      }
      for (const [a, b] of segs) {
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const L = Math.hypot(d[0], d[1], d[2]);
        if (L < 1e-9) continue;
        checked++;
        // 앵커/합류의 끝점은 정의상 표면·기둥에 닿으므로 살짝 못 미치게 검사한다.
        const margin = r.kind === "anchor" ? 0.05 : 0;
        if (probe.hitDistance(a, norm(d), R, L - margin) !== null) newPierced++;
      }
    }
    console.log(`      새 라우팅: 구간 ${checked}개 검사, 관통 ${newPierced}개`);
    assert(newPierced === 0, `새 라우팅은 같은 입력에서 관통 0 (${newPierced}/${checked})`);
    assert(checked >= pts.length, `실제로 구간이 만들어짐 (${checked}개)`);
  }

  // ── (i) ★ 변조 시험 3종 — 검사가 실제로 잡는가 ──────────────────────────
  console.log("\n(i) ★ 변조 시험 — 판정을 하나씩 빼면 해당 테스트가 FAIL 하는가:");
  {
    // 변조 A: 걸어나가기 하향 검사 제거 → (b) 가 깨진다. ((b) 와 같은 기하)
    const obst = box([-4, 0, -4], [4, 8, 4]);
    const probe = makeProbe([obst]);
    const tA = tamperedWalkNoDownCheck([0, 20, 0], probe, OPTS);
    let aBad = false;
    if (tA.kind === "bent") {
      const turn = tA.waypoints[0];
      // 변조본의 전환점에서 하향이 막혀 있으면 = 잘못된 경로를 냈다.
      aBad = probe.hitDistance(turn, [0, -1, 0], R, turn[1]) !== null;
    }
    assert(
      aBad,
      "변조 A(하향 검사 제거) → 하향이 막힌 전환점을 채택 = (b) 의 '하향 청명' 단언이 FAIL",
    );
    const real = planPointRoute([0, 20, 0], probe, OPTS);
    assert(
      real.kind === "bent" &&
        probe.hitDistance(real.waypoints[0], [0, -1, 0], R, real.waypoints[0][1]) === null,
      "실제 구현은 같은 입력에서 하향이 청명한 전환점만 채택",
    );

    // 변조 B: 착지 클램프 제거 → (e) 가 깨진다. (§e 에서 이미 실검출 확인)
    const bB = tamperedJoinNoClamp([3, 20, 0], [0, 3, 0], OPTS);
    assert(bB !== null, "변조 B(클램프 제거) → (e) 가 거부해야 할 합류를 통과시킴 = (e) FAIL");

    // 변조 C: minLanding 제거 → (f) 가 깨진다.
    const bC = tamperedJoinNoMinLanding([1, 2.5, 0], [0, 2.5, 0], OPTS);
    assert(
      bC !== null && bC.junction[1] < MIN_LANDING,
      "변조 C(minLanding 제거) → (f) 가 거부해야 할 저공 다리를 통과시킴 = (f) FAIL",
    );
  }

  // ── 조립 통합 — bent / anchor / joinPillar 각 1케이스 층 스캔 ────────────
  console.log("\n(조립 통합) 경로별 형상을 층 스캔해 단면 누락 0 확인:");
  {
    const parts = {
      sphere: loadPart("sphere.stl"),
      cone: loadPart("cone.stl"),
      cylinder: loadPart("cylinder.stl"),
    };
    const dims = {
      tipDiameterMm: 0.4,
      headBackDiameterMm: 1.0,
      headLengthMm: 1.0,
      contactPenetrationMm: 0.2,
      trunkDiameterMm: 1.0,
      baseDiameterMm: 3.0,
      baseTransitionMm: 1.5,
    };
    const LAYER = 0.05;

    /** [y0, y1] 구간을 50µm 로 훑어 단면 없는 층 수를 센다. */
    const scan = (geo, y0, y1, label) => {
      const tris = toTriangleArray(geo);
      const n = Math.floor((y1 - y0) / LAYER) + 1;
      let missing = 0;
      for (let i = 0; i < n; i++) {
        if (!hasSectionAt(tris, y0 + i * LAYER)) missing++;
      }
      console.log(`      ${label}: 층 ${n}개 중 단면 없음 ${missing}개`);
      assert(missing === 0, `${label} 전 층에 단면 존재 (누락 ${missing}/${n})`);
    };

    // bent — 접점 (0,12,0), 전환점 (7,3.8,0), 착지 XZ (7,0).
    const bent = assembleRoutedSupport(parts, {
      ...dims,
      contactWorld: [0, 12, 0],
      route: {
        kind: "bent",
        worldWaypoints: [[7, 3.8, 0]],
        baseXZ: [7, 0],
        baseY: 0,
      },
    });
    scan(bent, 0.1, 11.5, "bent(경사+발)");

    // anchor — 접점 (0,10,0), 앵커 (0,5,0).
    const anchor = assembleRoutedSupport(parts, {
      ...dims,
      contactWorld: [0, 10, 0],
      route: { kind: "anchor", anchorWorld: [0, 5, 0] },
    });
    scan(anchor, 5.1, 9.8, "anchor(막대)");
    {
      // 뒤집힌 화살촉이 앵커 지점 **아래**로 침투하는지 (거울상 확인).
      const tris = toTriangleArray(anchor);
      assert(
        hasSectionAt(tris, 5 - dims.contactPenetrationMm * 0.5),
        `뒤집힌 화살촉이 앵커 표면 아래(Y=${(5 - dims.contactPenetrationMm * 0.5).toFixed(2)})까지 침투`,
      );
      // winding 보존(음수 스케일 금지 규약) — 정점이 유한하고 NaN 이 없어야 한다.
      let bad = 0;
      for (const v of anchor.positions) if (!Number.isFinite(v)) bad++;
      assert(bad === 0, `앵커 형상에 NaN/Infinity 없음 (${bad}개)`);
    }

    // joinPillar — 멤버 접점 (5,12,0) → 합류점 (0,6,0).
    const join = assembleRoutedSupport(parts, {
      ...dims,
      contactWorld: [5, 12, 0],
      route: { kind: "joinPillar", junctionWorld: [0, 6, 0] },
    });
    scan(join, 6.1, 11.5, "joinPillar(경사 다리)");
    {
      // 합류점 근방에 접합 구가 실제로 있는지 (파단 방지 — 2a 의 R ≥ r).
      const tris = toTriangleArray(join);
      assert(hasSectionAt(tris, 6.0), "합류점 Y=6.0 에 단면 존재 (접합 구)");
      assert(
        hasSectionAt(tris, 6 - dims.trunkDiameterMm * 0.25),
        "합류점 아래 반경 안쪽에도 단면 존재 (구가 접합부를 덮는다)",
      );
    }
  }

  // ── 키 무회귀 — routeKind 미설정 점의 key 가 수정 전과 **바이트 단위로 동일** ──
  //   (수용 6) 수정 전 key 포맷을 스크립트에 **독립 재현**해 대조한다. 구현을
  //   그대로 부르면 같은 버그를 두 번 쓰는 셈이라 의미가 없다.
  console.log("\n(키 무회귀) routeKind 미설정 점의 buildSupportKey 는 종전과 동일한가:");
  {
    const params = {
      trunkDiameterMm: 1.0, tipDiameterMm: 0.4, baseDiameterMm: 3.0,
      baseTransitionMm: 1.5, tipTransitionMm: 0.8, bridgeDiameterMm: 2.0,
      headBackDiameterMm: 1.0, headLengthMm: 1.0, contactPenetrationMm: 0.2,
    };
    const f = (v) => v.toFixed(3);
    /** 수정 전(S-4b-1) key 포맷을 그대로 옮겨 적은 참조 구현. */
    const legacyKey = (point, lc, lb, lcps, surfY) =>
      [
        point.source,
        point.kind ?? "",
        point.tipRadius ?? "",
        lc.map(f).join(","),
        lb.map(f).join(","),
        lcps ? lcps.map((p) => p.map(f).join(",")).join(";") : "",
        params.trunkDiameterMm, params.tipDiameterMm, params.baseDiameterMm,
        params.baseTransitionMm, params.tipTransitionMm, params.bridgeDiameterMm,
        params.headBackDiameterMm, params.headLengthMm, params.contactPenetrationMm,
        surfY != null ? surfY.toFixed(3) : "",
      ].join("|");

    const cases = [
      // [설명, point, localContact, localBase, cps, surfaceWorldY]
      ["옛 trunk 점", { source: "auto" }, [1, 2, 3], [1, 0, 3], null, undefined],
      ["재설계 수직 점", { source: "auto", kind: "island", tipRadius: 0.2 },
        [1, 5, 2], [1, 0, 2], null, 7.25],
      ["bridge 점(cps 있음)", { source: "bridge" }, [0, 1, 0], [2, 3, 4],
        [[1, 1, 1], [2, 2, 2], [3, 3, 3]], undefined],
    ];
    let mismatch = 0;
    for (const [label, point, lc, lb, cps, sy] of cases) {
      const now = buildSupportKey(point, params, lc, lb, cps, sy);
      const before = legacyKey(point, lc, lb, cps, sy);
      if (now !== before) {
        mismatch++;
        console.error(`      ${label}\n        수정후: ${now}\n        수정전: ${before}`);
      }
      assert(now === before, `${label} — key 문자열이 수정 전과 동일`);
    }
    assert(mismatch === 0, `미지정 점 ${cases.length}종 전부 무회귀 (불일치 ${mismatch})`);

    // 반대로 routeKind 가 붙으면 key 는 **달라져야** 한다(재조립 트리거).
    const vertical = { source: "auto", kind: "island", tipRadius: 0.2 };
    const bentPt = { ...vertical, routeKind: "bent", routeWaypoints: [[2, 3, 0]] };
    const kV = buildSupportKey(vertical, params, [1, 5, 2], [1, 0, 2], null, 7.25);
    const kB = buildSupportKey(bentPt, params, [1, 5, 2], [1, 0, 2], null, 7.25);
    assert(kV !== kB, "routeKind='bent' 는 key 가 달라진다 (형상 변경 → 재조립)");
    const bentPt2 = { ...bentPt, routeWaypoints: [[2, 4, 0]] };
    const kB2 = buildSupportKey(bentPt2, params, [1, 5, 2], [1, 0, 2], null, 7.25);
    assert(kB !== kB2, "꺾임점이 달라지면 key 도 달라진다");
  }

  console.log(
    failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
