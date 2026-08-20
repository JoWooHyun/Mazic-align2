// 서포트 재설계(S-4b-2c) **점 목록 파이프라인** — 중복 제거 → 기둥 공유 → 합류 검사 → 폴백.
//   순수 모듈 — Babylon import 금지. 자매 파일은 `route-plan-core.ts` 머리 주석 참고.
//   소비자는 `route-plan.ts` 를 import 한다(이 파일의 함수를 그대로 재수출한다).
//
//   근거: `docs/연구_프루사서포트_정독_20260811.md` 7절 항목 1(폴백 순서에 "근처 기둥
//   합류" 0단 추가) / `docs/설계_서포트재설계_20260720.md` 4-4.

import {
  canBridgeReach,
  clusterForSharedPillars,
  dedupeSupportPoints,
} from "./detect/preprocess-points";
import {
  beamStart,
  DOWN,
  ANGLE_EPS_RAD,
  EPS,
  MIN_SEGMENT_LENGTH_MM,
  PLATE_Y,
  resolveOptions,
  type BeamProbe,
  type PointRoute,
  type ResolvedOptions,
  type RoutePlanOptions,
  type RoutePoint,
  type RouteReport,
  type Vec3,
} from "./route-plan-core";
// ★ 배럴(`route-plan.ts`)이 아니라 구현 파일을 직접 가리킨다 — 배럴을 거치면
//   배럴 → cluster → 배럴 의 순환 import 가 된다.
import { planPointRoute } from "./route-point";

/**
 * 점 목록 전체를 라우팅한다 (0단 합류 포함 — 프루사 7절-1 폴백 순서).
 *
 * ## 순서
 *   1. `dedupeSupportPoints`(2b) — 0.1mm 이내 중복을 합쳐 **대표점만** 라우팅.
 *   2. `clusterForSharedPillars`(2b) — 기둥 공유 후보(순수 기하, 충돌 미검사).
 *   3. 클러스터 중심의 **1단(수직)이 성립할 때만** 그 클러스터를 유지한다.
 *   4. 유지된 클러스터의 멤버마다 **합류 다리 검사**(`tryJoinPillar`) → 통과하면
 *      joinPillar, 실패하면 그 멤버만 개별 `planPointRoute` 로 폴백.
 *   5. 클러스터에 안 속한 점은 전부 개별 `planPointRoute`.
 *
 * ## ★ routes 배열의 순서 계약
 * 반환 `routes[i]` 는 **`dedupeSupportPoints` 결과의 i 번째 대표점**(= 함께 반환하는
 * `deduped[i]`)에 대응한다(1:1, 같은 순서). 소비자는 이 순서로 저장 점을 만들면
 * 되고, joinPillar 의 `pillarPointIndex` 도 같은 배열의 인덱스다. 실패 점 통계도
 * 소비자가 이 인덱스로 되짚을 수 있다.
 *
 * @returns routes(대표점 순서) + 대표점 목록 + 집계 리포트.
 */
export function planClusterRoutes<T extends RoutePoint>(
  points: readonly T[],
  probe: BeamProbe,
  opts: RoutePlanOptions,
): { routes: PointRoute[]; deduped: T[]; report: RouteReport } {
  const cfg = resolveOptions(opts);

  // (1) 중복 제거 — 이후 모든 인덱스는 이 대표점 배열 기준이다.
  const kept = dedupeSupportPoints(points, cfg.dedupeMinDistMm);
  const deduped = kept.map((k) => k.point);
  const n = deduped.length;

  const routes = new Array<PointRoute>(n);
  const assigned = new Array<boolean>(n).fill(false);
  const report: RouteReport = {
    input: points.length,
    afterDedupe: n,
    clusters: 0,
    joined: 0,
    vertical: 0,
    bent: 0,
    anchored: 0,
    failed: 0,
    failedIslandCount: 0,
    degenerateStruts: 0,
  };
  if (n === 0) return { routes, deduped, report };

  // (2) 기둥 공유 후보. minLanding 을 켜서 부른다 — 2b 는 기본 0(끔)이라
  //     명시하지 않으면 바닥 코앞에 붙는 다리가 후보로 올라온다.
  const clusters = clusterForSharedPillars(deduped, {
    structuralAngleDeg: cfg.structuralAngleDeg,
    maxBridgeLengthMm: cfg.maxBridgeLengthMm,
    minBridgeLandingHeightMm: cfg.minLandingMm,
  });

  for (const cluster of clusters) {
    const pi = cluster.pillarIndex;
    if (cluster.memberIndices.length === 0) continue; // 혼자 선 기둥 — (5)에서 처리.

    // (3) 중심이 수직으로 못 서면 **클러스터를 해산**한다.
    //     근거: 중심이 bent 로 가면 기둥이 접점 아래가 아니라 착지점 위에 서게 돼
    //     멤버들이 계산해 둔 합류 기하(수평거리·착지 높이)가 통째로 어긋난다.
    //     기둥 위치를 옮겨 재계산하는 대신 단순·결정적으로 해산하고 전원 개별
    //     라우팅한다. (해산한 클러스터는 report.clusters 에 세지 않는다.)
    const pillarContact = deduped[pi].contact as Vec3;
    const pillarStart = beamStart(pillarContact, cfg.headClearanceMm);
    const pillarVertical =
      pillarStart[1] - PLATE_Y > MIN_SEGMENT_LENGTH_MM &&
      probe.hitDistance(
        pillarStart,
        DOWN,
        cfg.strutRadiusMm,
        pillarStart[1] - PLATE_Y,
      ) === null;
    if (!pillarVertical) continue;

    // 중심은 수직 기둥으로 확정.
    routes[pi] = { kind: "vertical" };
    assigned[pi] = true;
    report.clusters++;

    // (4) 멤버별 합류 다리 검사.
    for (const mi of cluster.memberIndices) {
      const join = tryJoinPillar(
        deduped[mi].contact as Vec3,
        pillarContact,
        pi,
        probe,
        cfg,
      );
      if (join.route) {
        routes[mi] = join.route;
        assigned[mi] = true;
      } else if (join.degenerate) {
        report.degenerateStruts++;
      }
      // 실패한 멤버는 assigned 를 안 세워 (5)에서 개별 라우팅된다.
    }
  }

  // (5) 아직 배정 안 된 점 — 개별 3단 폴백.
  for (let i = 0; i < n; i++) {
    if (assigned[i]) continue;
    routes[i] = planPointRoute(deduped[i].contact as Vec3, probe, cfg);
  }

  // 집계.
  for (let i = 0; i < n; i++) {
    const r = routes[i];
    switch (r.kind) {
      case "vertical":
        report.vertical++;
        break;
      case "joinPillar":
        report.joined++;
        break;
      case "bent":
        report.bent++;
        break;
      case "anchor":
        report.anchored++;
        break;
      case "failed":
        report.failed++;
        if (deduped[i].kind === "island") report.failedIslandCount++;
        if (r.reason === "degenerate") report.degenerateStruts++;
        break;
    }
  }

  return { routes, deduped, report };
}

/**
 * 멤버 한 점이 중심 기둥에 **경사 다리로 합류**할 수 있는지 (0단).
 *
 * ## 왜 2b 의 `canBridgeReach` 만으로는 부족한가 (인계 조건 1)
 * `canBridgeReach` 는 기둥을 **무한히 높은 막대**로 본다 — 기둥 꼭대기를 모른다.
 * 실제로는 기둥도 자기 접점 아래(화살촉 뒤)에서 시작하므로, 멤버가 기둥보다
 * 훨씬 높으면 다리가 **기둥이 존재하지 않는 허공**에 붙는다. 그래서 착지 Y 를
 * `pillarTopY` 로 **클램프**하고, 클램프된 실제 기하로 길이·각도를 다시 잰다.
 *
 * ## 검사 항목 (전부 통과해야 합류)
 *   ① 착지 Y ≥ minLanding      — 바닥 코앞 다리 금지(연구 5절).
 *   ② 다리 길이 ≤ maxBridge    — 설계 4-4 "너무 길면 스스로 휜다".
 *   ③ 다리 각도 ≤ 구조각        — 설계 4-3. 클램프로 더 눕는 경우를 여기서 잡는다.
 *   ④ 다리 빔이 청명            — 설계 4-5 충돌 회피.
 */
function tryJoinPillar(
  memberContact: Vec3,
  pillarContact: Vec3,
  pillarPointIndex: number,
  probe: BeamProbe,
  cfg: ResolvedOptions,
): { route: PointRoute | null; degenerate: boolean } {
  const memberStart = beamStart(memberContact, cfg.headClearanceMm);
  const pillarTopY = pillarContact[1] - cfg.headClearanceMm;

  const dx = pillarContact[0] - memberStart[0];
  const dz = pillarContact[2] - memberStart[2];
  const horiz = Math.hypot(dx, dz);
  if (horiz <= MIN_SEGMENT_LENGTH_MM) {
    // 기둥과 사실상 같은 XZ — 다리가 아니라 수직이다. 합류로 처리하지 않는다.
    return { route: null, degenerate: false };
  }

  const tanT = Math.tan(cfg.structuralAngleRad);
  // 구조각으로 수평거리 horiz 를 가면 이만큼 내려간다. 단, 기둥 꼭대기보다
  //   위에는 붙을 수 없으므로 pillarTopY 로 **클램프**한다(위 인계 조건 1).
  const idealY = tanT <= EPS ? -Infinity : memberStart[1] - horiz / tanT;
  const landingY = Math.min(idealY, pillarTopY);

  // ① 착지 하한.
  if (landingY < cfg.minLandingMm - EPS) return { route: null, degenerate: false };

  const drop = memberStart[1] - landingY;
  if (drop < -EPS) {
    // 멤버가 기둥 꼭대기보다 낮다 — 위로 붙는 다리는 만들지 않는다.
    return { route: null, degenerate: false };
  }
  const length = Math.hypot(horiz, drop);
  if (length < MIN_SEGMENT_LENGTH_MM) return { route: null, degenerate: true };

  // ② 길이 상한.
  if (length > cfg.maxBridgeLengthMm + EPS) return { route: null, degenerate: false };

  // ③ 연직 기준 각도 상한. (클램프로 drop 이 줄면 각이 더 눕는다 — 여기서 걸린다.)
  const angle = Math.atan2(horiz, Math.max(drop, 0));
  if (angle > cfg.structuralAngleRad + ANGLE_EPS_RAD) {
    return { route: null, degenerate: false };
  }

  // 2b 의 순수 기하 판정과도 어긋나지 않는지 교차 확인(같은 규약을 두 번 쓰는
  //   비용은 무시할 만하고, 두 모듈이 갈라지면 여기서 드러난다).
  if (
    !canBridgeReach(horiz, memberStart[1], {
      structuralAngleDeg: cfg.structuralAngleDeg,
      maxBridgeLengthMm: cfg.maxBridgeLengthMm,
      minBridgeLandingHeightMm: cfg.minLandingMm,
    })
  ) {
    return { route: null, degenerate: false };
  }

  // ④ 다리 빔 충돌.
  const junction: Vec3 = [pillarContact[0], landingY, pillarContact[2]];
  const dir: Vec3 = [
    (junction[0] - memberStart[0]) / length,
    (junction[1] - memberStart[1]) / length,
    (junction[2] - memberStart[2]) / length,
  ];
  if (probe.hitDistance(memberStart, dir, cfg.strutRadiusMm, length) !== null) {
    return { route: null, degenerate: false };
  }

  return {
    route: { kind: "joinPillar", pillarPointIndex, junction },
    degenerate: false,
  };
}
