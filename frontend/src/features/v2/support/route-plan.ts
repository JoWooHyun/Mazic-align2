// 서포트 재설계(S-4b-2c) **경로 계획 공개 진입점**. 순수 모듈 — Babylon import 금지.
//   설계 `docs/설계_서포트재설계_20260720.md` 4-4(3단 폴백)·4-5(충돌 회피),
//   연구 `docs/연구_프루사서포트_정독_20260811.md` 3·4절, 7절 1~3·6.
//   ⚠️ 프루사는 AGPL — **개념만** 채택했고 코드는 이식하지 않았다(클린룸).
//
//   ## 왜 파일이 넷으로 나뉘어 있나
//   경로 계획은 설명이 긴 알고리즘이라 한 파일에 두면 500줄 상한을 넘는다. 역할로
//   갈랐고, **소비자는 이 파일 하나만 import 하면 된다**(전부 여기서 재수출한다):
//
//     · `route-plan-core.ts` — 공용 타입·상수·옵션 해석. 나머지 셋이 공유한다.
//     · `route-point.ts`     — 점 하나의 3단 폴백(1단 수직 → 2단 경사 → 3단 앵커).
//     · `route-cluster.ts`   — 점 목록 파이프라인(중복 제거 → 기둥 공유 → 0단 합류).
//     · `route-plan.ts`      — 이 파일. 재수출만 한다(로직 없음).
//
//   core 를 따로 둔 이유는 순환 import 방지다 — cluster 가 point 를 부르므로 공용
//   타입을 둘 중 하나에 두면 고리가 생긴다.
//
//   ## 충돌 검사는 콜백(BeamProbe)으로 주입한다
//   판정 로직은 전부 순수 기하라 헤드리스로 전수 검증할 수 있어야 하는데, 실제
//   충돌은 Babylon 레이캐스트라 Node 에서 못 돈다. 그래서 "빔을 쏜다"는 능력만
//   인터페이스로 잘라냈다. 구현체는 `collision-probe.ts`(Babylon), 검증 스크립트
//   (`scripts/verify-route-plan.mjs`)는 해석적 장애물로 만든 합성 probe 를 끼운다.

export {
  DEFAULT_ANCHOR_MAX_LENGTH_MM,
  DEFAULT_MIN_LANDING_FACTOR,
  DEFAULT_WALK_AZIMUTH_COUNT,
} from "./route-plan-core";
export type {
  BeamProbe,
  PointRoute,
  RoutePlanOptions,
  RoutePoint,
  RouteReport,
  Vec3,
} from "./route-plan-core";
export { planPointRoute } from "./route-point";
export { planClusterRoutes } from "./route-cluster";
