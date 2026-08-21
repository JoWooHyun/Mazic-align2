// 서포트 재설계(S-4b-2c) 경로 계획의 **공용 타입·상수·소도구**. 순수 모듈 — Babylon import 금지.
//   자매 파일:
//     · `route-plan.ts`    — 점 하나의 3단 폴백(공개 진입점 + 전체 재수출).
//     · `route-cluster.ts` — 점 목록 파이프라인(중복 제거·기둥 공유·합류 검사).
//   **소비자는 `route-plan.ts` 하나만** import 하면 된다. 이 파일이 따로 있는 이유는
//   두 자매가 같은 타입·상수·옵션 해석을 공유해야 하는데 어느 한쪽에 두면 순환
//   import 가 생기기 때문이다(파일당 500줄 상한도 함께 충족).
//
//   근거 문서:
//     · `docs/설계_서포트재설계_20260720.md` 4-3(구조각 단일 파라미터)·4-4(3단 폴백)·4-5(충돌 회피).
//     · `docs/연구_프루사서포트_정독_20260811.md` 3절(beam_mesh_hit)·4절(폴백 상세)·7절 1~3·6.
//   ⚠️ 프루사는 AGPL — **개념만** 채택했고 코드는 이식하지 않았다(클린룸).
//
//   ## 이 파일이 정하는 것
//   점 하나(또는 점 목록)가 **어디를 지나 어디에 닿을지**만 정한다. 형상 조립은
//   `assemble-route.ts`, 실제 모델과의 충돌 판정은 `collision-probe.ts` 가 한다.
//
//   ## 왜 충돌 검사를 콜백(BeamProbe)으로 받는가
//   충돌 검사는 Babylon 레이캐스트라 Node 에서 못 돈다. 그런데 폴백 판정 로직
//   (어느 방위로 걸어나갈지·언제 포기할지·클러스터를 언제 해산할지)은 전부 순수
//   기하라 헤드리스로 전수 검증할 수 있어야 한다. 그래서 "빔을 쏜다"는 능력만
//   인터페이스로 잘라내고 나머지를 여기 둔다 — 검증 스크립트는 해석적 장애물
//   (박스·구)로 만든 합성 probe 를 주입해 전 경로를 돌린다
//   (`scripts/verify-route-plan.mjs`).
//
//   ## 결정성
//   Math.random / Date 를 쓰지 않는다. 방위 탐색 순서·전진 스텝·클러스터 순서가
//   전부 고정이라, 같은 입력이면 입력 배열 순서와 무관하게 같은 결과가 나온다
//   (2b 의 dedupe/cluster 가 이미 정렬로 순서를 고정한다 — 그 순서를 그대로 쓴다).

import {
  DEFAULT_DEDUPE_MIN_DIST_MM,
  DEFAULT_MAX_BRIDGE_LENGTH_MM,
  DEFAULT_STRUCTURAL_ANGLE_DEG,
  type PreprocessPoint,
} from "./detect/preprocess-points";

/** world 좌표 3D 점 [x, y, z] (mm). Y = 높이축. */
export type Vec3 = [number, number, number];

/**
 * **빔(굵은 막대) 충돌 질의** — 라우팅이 모델을 뚫지 않는지 묻는 유일한 창구.
 *
 * 구현체(`collision-probe.ts`)가 링 광선·안전거리·내부 재발사를 담당하고,
 * 이 파일은 "얼마나 가서 막히는가" 라는 스칼라만 본다. 이 좁은 계약이
 * Babylon 무의존을 지키는 핵심이다(파일 머리 주석 참고).
 */
export interface BeamProbe {
  /**
   * from(world)에서 dir(단위벡터) 방향으로 **반경 radiusMm 굵기의 빔**을 쏜다.
   *
   * @returns 첫 장애물까지의 거리(mm). maxDistMm 안에 아무것도 없으면 null(청명).
   *          from 이 모델 내부라 즉시 막힌 경우는 0 을 돌려준다.
   */
  hitDistance(from: Vec3, dir: Vec3, radiusMm: number, maxDistMm: number): number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 기본 상수
//   UI 노출(SupportParams 확장)은 S-4d 몫이라 여기서는 모듈 상수로만 둔다.
//   구조각·다리 길이는 2b 에 이미 정의돼 있으므로 **import 해서 쓴다**(정의 중복 금지).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 3단(모델 표면 앵커)에서 허용하는 **최대 앵커 길이** (mm) — 설계 4-4 3단
 * "모델에 얹는 가지에는 실리는 총량 상한(약 10mm)". 이보다 멀리 있는 표면에
 * 얹으면 그 긴 막대의 하중이 고스란히 모델 표면 한 점에 걸려 자국·변형이 커진다.
 */
export const DEFAULT_ANCHOR_MAX_LENGTH_MM = 10;

/**
 * 2단(경사 걸어나가기) 방위 탐색 개수 — 0° 부터 360/N° 간격으로 **고정 순서** 탐색.
 *   8 방향이면 45° 간격. 프루사도 방위를 고정 격자로 훑는다(연구 4절). 순서가
 *   고정이라 같은 입력에 항상 같은 방위가 뽑힌다(결정성) — 무작위 시드 불요.
 */
export const DEFAULT_WALK_AZIMUTH_COUNT = 8;

/**
 * 다리 착지점이 플레이트에서 최소한 떠 있어야 하는 높이의 **반경 배수**.
 *   연구 5절 "지면 근처 다리 금지 = 4×r". minLanding = 이 값 × strutRadiusMm.
 *
 * ## 왜 켜는가 (S-4b-2b 에서는 0 = 끔이었다)
 * 착지점이 바닥 코앞이면 그 아래 남는 수직 구간이 발(원뿔 전이) 높이보다 짧아
 * 접합부가 뭉개지고, 다리가 바닥 발 위에 거의 수평으로 얹혀 지지력이 안 나온다.
 * 2b 는 충돌 검사가 없어 이 제약을 켤 근거를 확정할 수 없었지만(옵션만 열어 둠),
 * 실제 경로를 만드는 2c 에서는 켠다.
 */
export const DEFAULT_MIN_LANDING_FACTOR = 4;

/**
 * 퇴화(degenerate) 구간 임계 (mm) — 이보다 짧은 막대는 만들지 않는다.
 *   assemble-strut 의 MIN_STRUT_LENGTH_MM 과 같은 값. 2a 의 `assembleStrut` 은
 *   길이 0 막대를 **조용히 빈 지오메트리**로 넘기므로, 상류인 여기서 막아
 *   "형상이 소리 없이 사라지는" 경로를 없앤다(인계 조건 2).
 */
export const MIN_SEGMENT_LENGTH_MM = 1e-3;

/** 부동소수 비교 여유. 각도·길이 경계에서 판정이 뒤집히지 않게. */
export const EPS = 1e-9;

/** 빌드플레이트 Y (world). assemble-core 의 PLATE_Y 와 같은 값(순수 모듈 독립 유지). */
export const PLATE_Y = 0;

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

/** 라우팅 옵션. 수치는 전부 주입 가능(하드코딩 금지 원칙). */
export interface RoutePlanOptions {
  /** 구조각 (deg, 연직 기준) — 설계 4-3. 기본 45 (2b 상수). */
  structuralAngleDeg?: number;
  /** 경사 다리 최대 길이 (mm) — 설계 4-4. 기본 15 (2b 상수). */
  maxBridgeLengthMm?: number;
  /** 모델 표면 앵커 최대 길이 (mm) — 설계 4-4 3단. 기본 10. */
  anchorMaxLengthMm?: number;
  /** 다리·기둥 반경 (mm). 소비자가 `params.trunkDiameterMm / 2` 로 준다. */
  strutRadiusMm: number;
  /**
   * 화살촉이 차지하는 수직 구간 (mm) — 보통 headLengthMm + contactPenetrationMm.
   *
   * ## 왜 필요한가
   * 접점은 정의상 **모델 표면 위**다. 거기서 곧장 아래로 빔을 쏘면 앞구슬이
   * 침투해 있는 표면 자신을 즉시 맞아 전 점이 "막힘" 판정을 받는다. 그래서 빔
   * 시작점을 접점이 아니라 **화살촉 아래**(= 실제로 기둥이 시작되는 자리)로
   * 내린다. 프루사도 핀헤드 뒤에서부터 검사한다(연구 3절 "0.2 침투 전제").
   */
  headClearanceMm: number;
  /** 중복 제거 최소 거리 (mm). 기본 0.1 (2b 상수). */
  dedupeMinDistMm?: number;
}

/** 점 하나의 라우팅 결과. */
export type PointRoute =
  /** 1단 — 접점 아래가 청명. 기존 수직 기둥 그대로. */
  | { kind: "vertical" }
  /**
   * 0단 — 중심 기둥에 경사 다리로 합류.
   *   pillarPointIndex = 중심점의 인덱스(`planClusterRoutes` 의 routes 배열 기준),
   *   junction = 다리가 기둥에 붙는 world 좌표.
   */
  | { kind: "joinPillar"; pillarPointIndex: number; junction: Vec3 }
  /**
   * 2단 — 경사로 비껴 내려간 뒤 수직 하강.
   *   waypoints = 중간 꺾임점(전환점) 목록, landingXZ = 최종 착지 XZ(플레이트).
   */
  | { kind: "bent"; waypoints: Vec3[]; landingXZ: [number, number] }
  /** 3단 — 아래 모델 표면에 앵커. anchorPoint = 뒤집힌 화살촉이 닿을 world 점. */
  | { kind: "anchor"; anchorPoint: Vec3 }
  /**
   * 실패 — 저장하지 않고 **카운트해서 통지**한다(연구 7절-6 "조용히 버리지 말 것").
   *   · 'no-route'   : 3단까지 다 시도했지만 닿을 곳이 없다.
   *   · 'degenerate' : 경로를 만들면 길이 0 구간이 생긴다(위 MIN_SEGMENT_LENGTH_MM).
   */
  | { kind: "failed"; reason: "no-route" | "degenerate" };

/** 파이프라인 집계 (사용자 통지·진단용). */
export interface RouteReport {
  /** 입력 점 수. */
  input: number;
  /** 중복 제거 후 남은 점 수 = routes 배열 길이. */
  afterDedupe: number;
  /** 실제로 유지된 기둥 공유 클러스터 수(멤버가 1개 이상 붙은 것만). */
  clusters: number;
  /** joinPillar 로 합류한 멤버 수. */
  joined: number;
  /** vertical 점 수. */
  vertical: number;
  /** bent 점 수. */
  bent: number;
  /** anchor 점 수. */
  anchored: number;
  /** 실패 점 수(저장 제외). */
  failed: number;
  /** 실패 점 중 아일랜드에서 나온 점 수 — 아일랜드 실패는 출력 자체가 무너진다. */
  failedIslandCount: number;
  /** 퇴화로 거절된 경로 수(길이 0 구간 방지). failed 와 겹칠 수 있다. */
  degenerateStruts: number;
}

/** `planClusterRoutes` 입력 점 — 2b 의 PreprocessPoint 에 실패 통지용 kind 만 얹었다. */
export interface RoutePoint extends PreprocessPoint {
  /** 검출 출처. 'island' 실패는 별도로 센다(RouteReport.failedIslandCount). */
  kind?: "island" | "slope" | "manual";
}

// ─────────────────────────────────────────────────────────────────────────────
// 공용 소도구
// ─────────────────────────────────────────────────────────────────────────────

/** 수직 하향 단위벡터. */
export const DOWN: Vec3 = [0, -1, 0];

/** 각도 비교 여유 (rad). 1e-9 rad ≈ 6e-8° — 부동소수 잡음만 흡수한다. */
export const ANGLE_EPS_RAD = 1e-9;

/**
 * 빔 시작점 — 접점에서 화살촉 높이만큼 아래(= 기둥이 실제로 시작하는 자리).
 *   RoutePlanOptions.headClearanceMm 주석의 근거 참고.
 */
export function beamStart(contact: Vec3, headClearanceMm: number): Vec3 {
  return [contact[0], contact[1] - headClearanceMm, contact[2]];
}

/** 옵션 기본값을 채운 내부 표현 (매 호출 재계산 방지 + 파생값 선계산). */
export interface ResolvedOptions extends RoutePlanOptions {
  structuralAngleDeg: number;
  structuralAngleRad: number;
  maxBridgeLengthMm: number;
  anchorMaxLengthMm: number;
  dedupeMinDistMm: number;
  walkAzimuthCount: number;
  /** 다리 착지점 최소 높이 (mm) = DEFAULT_MIN_LANDING_FACTOR × strutRadiusMm. */
  minLandingMm: number;
}

export function resolveOptions(opts: RoutePlanOptions): ResolvedOptions {
  const angleDeg = clamp(opts.structuralAngleDeg ?? DEFAULT_STRUCTURAL_ANGLE_DEG, 0, 90);
  const r = Math.max(opts.strutRadiusMm, 0);
  return {
    ...opts,
    strutRadiusMm: r,
    structuralAngleDeg: angleDeg,
    structuralAngleRad: (angleDeg * Math.PI) / 180,
    maxBridgeLengthMm: Math.max(opts.maxBridgeLengthMm ?? DEFAULT_MAX_BRIDGE_LENGTH_MM, 0),
    anchorMaxLengthMm: Math.max(opts.anchorMaxLengthMm ?? DEFAULT_ANCHOR_MAX_LENGTH_MM, 0),
    dedupeMinDistMm: opts.dedupeMinDistMm ?? DEFAULT_DEDUPE_MIN_DIST_MM,
    headClearanceMm: Math.max(opts.headClearanceMm, 0),
    walkAzimuthCount: DEFAULT_WALK_AZIMUTH_COUNT,
    minLandingMm: DEFAULT_MIN_LANDING_FACTOR * r,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
