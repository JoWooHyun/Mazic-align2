// 서포트 재설계(S-4b-2c) **점 하나의 3단 폴백 라우팅**. 순수 모듈 — Babylon import 금지.
//   자매 파일은 `route-plan-core.ts` 머리 주석 참고. 소비자는 `route-plan.ts` 를 쓴다.
//
//   근거 문서:
//     · `docs/설계_서포트재설계_20260720.md` 4-3(구조각 단일 파라미터)·4-4(3단 폴백)·4-5(충돌 회피).
//     · `docs/연구_프루사서포트_정독_20260811.md` 3절(beam_mesh_hit)·4절(폴백 상세)·7절 1~3·6.
//   ⚠️ 프루사는 AGPL — **개념만** 채택했고 코드는 이식하지 않았다(클린룸).
//
//   ## 이 파일이 정하는 것
//   점 하나가 **어디를 지나 어디에 닿을지**만 정한다(1단 수직 → 2단 경사 → 3단 앵커).
//   점 목록 파이프라인(0단 기둥 합류 포함)은 `route-cluster.ts`, 형상 조립은
//   `assemble-route.ts`, 실제 모델과의 충돌 판정은 `collision-probe.ts` 가 한다.
//
//   ## 결정성
//   Math.random / Date 를 쓰지 않는다. 방위 탐색 순서·전진 스텝이 전부 고정이라
//   같은 입력이면 항상 같은 결과가 나온다.

import {
  beamStart,
  DEFAULT_WALK_AZIMUTH_COUNT,
  DOWN,
  EPS,
  MIN_SEGMENT_LENGTH_MM,
  PLATE_Y,
  resolveOptions,
  type BeamProbe,
  type PointRoute,
  type ResolvedOptions,
  type RoutePlanOptions,
  type Vec3,
} from "./route-plan-core";

/**
 * 접점 하나의 경로를 1단→2단→3단 순으로 정한다 (설계 4-4).
 *
 * 0단(기둥 합류)은 이웃을 알아야 하므로 여기가 아니라 `planClusterRoutes` 가 한다.
 *
 * @param contact 접점 world 좌표 (표면 스냅이 끝난 값).
 * @param probe   충돌 질의.
 * @param opts    구조각·길이 상한·반경 등.
 */
export function planPointRoute(
  contact: Vec3,
  probe: BeamProbe,
  opts: RoutePlanOptions,
): PointRoute {
  const cfg = resolveOptions(opts);
  const start = beamStart(contact, cfg.headClearanceMm);

  // 접점이 이미 플레이트 아래거나 화살촉조차 들어갈 높이가 안 되면 경로가 없다.
  if (start[1] - PLATE_Y <= MIN_SEGMENT_LENGTH_MM) {
    return { kind: "failed", reason: "degenerate" };
  }

  // ── 1단: 수직 하강 ─────────────────────────────────────────────────────
  //   플레이트까지의 거리만 본다 — 그 너머는 검사할 이유가 없다.
  const downRange = start[1] - PLATE_Y;
  if (probe.hitDistance(start, DOWN, cfg.strutRadiusMm, downRange) === null) {
    return { kind: "vertical" };
  }

  // ── 2단: 경사 걸어나가기 ────────────────────────────────────────────────
  const walked = planWalkOut(start, probe, cfg);
  if (walked) return walked;

  // ── 3단: 모델 표면 앵커 ─────────────────────────────────────────────────
  //   1단에서 막혔던 그 하향 빔의 **첫 히트점**이 곧 앵커 후보다. 상한 안에서
  //   다시 쏴 거리를 얻는다(1단은 플레이트까지 봤으므로 값이 다를 수 있다).
  const anchorHit = probe.hitDistance(
    start,
    DOWN,
    cfg.strutRadiusMm,
    Math.min(cfg.anchorMaxLengthMm, downRange),
  );
  if (anchorHit === null) {
    // 상한 안에서는 청명 — 1단이 막혔다는 건 상한 **너머**에 장애물이 있다는 뜻.
    //   그 자리는 앵커할 표면이 아니므로 실패다(설계 4-4 "총량 상한").
    return { kind: "failed", reason: "no-route" };
  }
  if (anchorHit < MIN_SEGMENT_LENGTH_MM) {
    // 접점 바로 밑에 표면이 붙어 있다 — 막대 길이 0. 2a 가 조용히 빈 형상을
    //   내는 상황이라 상류에서 막는다(인계 조건 2).
    return { kind: "failed", reason: "degenerate" };
  }
  return {
    kind: "anchor",
    anchorPoint: [start[0], start[1] - anchorHit, start[2]],
  };
}

/**
 * 2단 — **경사 걸어나가기** (연구 4절 create_ground_pillar 의 구현 모델).
 *
 * ## 알고리즘
 * 방위각 φ 를 `DEFAULT_WALK_AZIMUTH_COUNT` 개 고정 순서로 훑는다. 각 방위에서
 * 극각은 구조각 θ 로 **포화**시킨 경사 방향
 *
 *     d = (sinθ·cosφ, −cosθ, sinθ·sinφ)
 *
 * 으로 반경 r 단위씩 전진하며 매 스텝에서 두 가지를 본다:
 *   ① 시작점 → 현재 위치까지의 **경사 구간이 청명한가** (다리 자신이 안 뚫는가)
 *   ② 현재 위치에서 **하향 빔이 플레이트까지 청명한가** (여기서 내려갈 수 있는가)
 * ②가 처음 뚫리는 지점이 전환점이다.
 *
 * ## 왜 극각을 고정하나 (2변수 탐색을 안 하는 이유)
 * 구조각은 "이보다 더 누우면 다리가 처진다" 는 **상한**이므로, 같은 수평거리를
 * 벌 때 가장 적게 내려가는(=착지 여유가 큰) 선택이 곧 상한각이다. 연구 4절의
 * 프루사 Legacy 경로도 "방위각 유지, 극각만 45° 포화" 다. 극각까지 훑는 2변수
 * 탐색은 최적화 라이브러리를 부르는 deepsearch 쪽 경로이고, 우리는 결정적·단순
 * 쪽을 택했다(연구 7절-2).
 *
 * ## ⚠️ 알 려진 한계 (버그 아님 — 검증 스크립트 (b) 주석에 근거)
 * 45° 로 내려가면서 옆으로 빠지므로, 장애물 **윗면보다 (반폭 + 반경 + 안전거리)
 * 이상 높지 않은** 접점은 옆으로 다 빠지기 전에 윗면에 처박힌다. 그런 점은
 * 2단이 실패하고 3단(모델 앵커)으로 넘어간다 — 설계가 3단을 둔 이유가 바로 이것.
 *
 * @returns 성립하는 첫 경로, 전 방위 실패면 null.
 */
function planWalkOut(
  start: Vec3,
  probe: BeamProbe,
  cfg: ResolvedOptions,
): PointRoute | null {
  const theta = cfg.structuralAngleRad;
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  // 구조각 0° = 경사가 아예 안 된다(수직만 허용) → 걸어나갈 수 없다.
  if (sinT <= EPS) return null;

  const r = cfg.strutRadiusMm;
  const step = Math.max(r, MIN_SEGMENT_LENGTH_MM); // 반경 단위 전진(연구 4절).
  const maxLen = cfg.maxBridgeLengthMm;

  for (let a = 0; a < DEFAULT_WALK_AZIMUTH_COUNT; a++) {
    const phi = (2 * Math.PI * a) / DEFAULT_WALK_AZIMUTH_COUNT;
    const dir: Vec3 = [sinT * Math.cos(phi), -cosT, sinT * Math.sin(phi)];

    for (let t = step; t <= maxLen + EPS; t += step) {
      const turn: Vec3 = [
        start[0] + dir[0] * t,
        start[1] + dir[1] * t,
        start[2] + dir[2] * t,
      ];
      // 착지 높이 하한 — 이보다 낮아지면 이 방위는 더 가 봐야 소용없다
      //   (t 가 커질수록 turn.y 는 단조 감소하므로 즉시 포기).
      if (turn[1] < cfg.minLandingMm - EPS) break;
      // 전환점 아래 남는 수직 구간이 퇴화면 그 자리는 못 쓴다.
      if (turn[1] - PLATE_Y <= MIN_SEGMENT_LENGTH_MM) break;

      // ① 경사 구간 자체가 청명한가 (start → turn 전체를 매번 다시 검사한다.
      //    스텝별 부분 검사만 하면 굵은 빔이 스텝 사이를 스쳐 지나가는 경우를
      //    놓친다 — 매 스텝 전 구간 재발사가 안전한 쪽이다).
      if (probe.hitDistance(start, dir, r, t) !== null) break;

      // ② 그 자리에서 플레이트까지 수직으로 내려갈 수 있는가.
      if (probe.hitDistance(turn, DOWN, r, turn[1] - PLATE_Y) === null) {
        return {
          kind: "bent",
          waypoints: [turn],
          landingXZ: [turn[0], turn[2]],
        };
      }
    }
  }
  return null;
}
