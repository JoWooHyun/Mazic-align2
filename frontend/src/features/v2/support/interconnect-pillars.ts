// 서포트 재설계(S-4b-2d) **기둥 상호 연결(좌굴 방지) 계획 모듈**. 순수 모듈 — Babylon import 금지.
//   근거 문서:
//     · `docs/설계_서포트재설계_20260720.md` 4-6(기둥끼리 연결 — 좌굴 방지)·4-3(구조각 45° 단일).
//     · `docs/연구_프루사서포트_정독_20260811.md` 5절(interconnect_pillars 알고리즘 상세).
//   ⚠️ 프루사는 AGPL — **개념만** 채택했고 코드는 이식하지 않았다(클린룸).
//
//   ## 이 파일이 정하는 것 (그리고 정하지 않는 것)
//   "어느 기둥과 어느 기둥 사이에, 어느 높이에, 어떤 다리를 걸 것인가"만 정한다.
//   **지오메트리 조립·저장 스키마·렌더는 범위 밖**(다음 단계). 이 PR 이 계획만
//   다루는 이유는 현행 저장 스키마가 "점 1개 = 경로 1개"라 **두 점에 걸친
//   구조물을 담을 자리가 없기** 때문이다 — 자료구조 선택(점 소유 필드 vs 별도
//   엔티티)이 저장·undo·삭제 cascade·캐시키에 전부 파급되므로, 계획 로직을 먼저
//   순수 모듈로 확정·검증한 뒤 분리해 다룬다. 그래서 여기서는 `SupportPointV2` 를
//   건드리지 않고, 이 모듈 **자체의 좁은 입력 타입**(`PillarInput`)만 받는다.
//
//   ## 왜 `planClusterRoutes` 시그니처·`RouteReport` 를 안 건드리는가
//   건드리면 `verify-route-plan.mjs` 가 회귀한다. 브레이스 통계는 이 모듈이
//   **자체 리포트 타입**(`InterconnectReport`)으로 돌려준다.
//
//   ## 충돌 검사는 콜백(BeamProbe)으로 주입한다
//   `route-plan-core.ts` 와 같은 규약이다. 판정 로직은 전부 순수 기하라
//   헤드리스로 전수 검증할 수 있어야 해서, "빔을 쏜다"는 능력만 인터페이스로
//   잘라낸다 — 검증(`scripts/verify-interconnect-pillars.mjs`)은 해석적 장애물로
//   만든 합성 probe 를 끼운다.
//
//   ## 결정성
//   Math.random / Date 를 쓰지 않는다. 이웃 후보 정렬의 동점은 **기둥 id 문자열
//   비교**로 깨고, 페어 순회는 입력 순서를 그대로 쓴다. 같은 입력이면 항상 같은
//   브레이스 목록이 나온다.

import {
  DEFAULT_MIN_LANDING_FACTOR,
  EPS,
  MIN_SEGMENT_LENGTH_MM,
  PLATE_Y,
  type BeamProbe,
  type Vec3,
} from "./route-plan-core";
import { DEFAULT_STRUCTURAL_ANGLE_DEG } from "./detect/preprocess-points";

// ─────────────────────────────────────────────────────────────────────────────
// 기본 상수
//   UI 노출(SupportParams 확장)은 S-4d 몫이라 여기서는 모듈 상수로만 둔다
//   — `route-plan-core.ts` 의 기존 관례와 동일.
//   ⚠️ 레거시 `params.bridgeDiameterMm` 는 **재사용 금지**. `types.ts:41-44` 주석이
//   구형 **수동** Bridge 서포트를 "cross-brace"라 부르지만 완전히 별개 기능이다
//   (사용자가 두 점을 클릭해 만드는 곡선 튜브). 엮으면 레거시 굵기와 함께 회귀한다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1차 임계 (mm) — 이 높이를 넘는 기둥은 이웃 **1개**와 연결해야 한다.
 *   설계 4-6 표 "15mm 이상 → 이웃 1개". 연구 5절 H1(solo 최대 높이)의 우리 값.
 */
export const DEFAULT_INTERCONNECT_H1_MM = 15;

/**
 * 2차 임계 (mm) — 이 높이를 넘는 기둥은 이웃 **2개**와 연결해야 한다.
 *   설계 4-6 표 "35mm 이상 → 이웃 2개". 연구 5절 H2.
 */
export const DEFAULT_INTERCONNECT_H2_MM = 35;

/**
 * 이웃 후보 탐색 거리의 **반경 배수** — max_d = 이 값 × strutRadiusMm.
 *   연구 5절 "이웃 후보: 반경 비례 거리 max_d = link_dist × r/기준r 내".
 *   우리는 기준 반경 개념을 따로 두지 않고 반경 비례 배수 하나로 단순화했다
 *   (설계 4-3 의 "파라미터를 늘리지 않는다" 정신). 반경 0.5mm 기준 20mm —
 *   경사 다리 최대 길이(15mm)보다 넉넉해 후보가 마르지 않는다.
 */
export const DEFAULT_LINK_DIST_FACTOR = 40;

/**
 * "연결됨"으로 인정하는 **높이비 하한**.
 *   연구 5절 "짧은 쪽/긴 쪽 높이비 50% 이상일 때만 연결됨으로 인정".
 *   낮은 기둥에 매달아 봐야 긴 기둥의 좌굴을 못 막으므로 카운트에 안 넣는다.
 */
export const DEFAULT_MIN_HEIGHT_RATIO = 0.5;

/**
 * 기둥 하나가 붙을 수 있는 **이웃 수 상한** — 프루사 max_bridges_on_pillar(연구 5절) 대응.
 *
 * ## 세는 단위가 "다리"가 아니라 "이웃"인 이유
 * 지그재그는 페어 하나당 여러 단의 다리를 만든다(단 수는 `maxZigzagSteps` 가
 * 따로 제한한다). 그래서 이 상한을 낱개 다리로 세면 **페어 하나가 상한을 통째로
 * 먹어** 두 번째 이웃을 못 고르고, 2차 임계(이웃 2개) 규칙이 성립하지 못한다.
 * 프루사가 막으려는 것도 "한 기둥에 이웃이 우글거리는 것"이므로 이웃 단위로 센다.
 * 2차 임계(2개)를 채우고도 이웃이 나를 고를 여지를 남기는 값으로 4 를 쓴다.
 */
export const DEFAULT_MAX_BRACES_PER_PILLAR = 4;

/**
 * 지그재그 다리를 **몇 단까지** 걸어 올릴지 상한.
 *   높이 임계(15/35mm)와 zstep(수평거리 × tan 45°) 조합에서 다리가 무한정
 *   쌓이지 않게 막는 안전장치. 필요한 연결 수(1~2)보다 넉넉하다.
 */
export const DEFAULT_MAX_ZIGZAG_STEPS = 6;

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 기둥 하나의 **최소 입력** — `SupportPointV2` 를 직접 받지 않는다(순수성 유지).
 *   소비자(다음 단계의 조립 쪽)가 저장 점 → 이 형태로 얇게 변환해 넘긴다.
 */
export interface PillarInput {
  /** 기둥 식별자. 브레이스 결과가 이 id 로 페어를 가리킨다. 중복 금지. */
  id: string;
  /**
   * 기둥 경로 폴리라인 (world, 위→아래 또는 아래→위 어느 순서든 무방).
   *   수직 기둥이면 [접점, 착지점] 2개, `bent`/`joinPillar` 면 waypoints 를
   *   포함한 전 구간. 2개 미만이면 그 기둥은 무시된다.
   */
  polyline: readonly Vec3[];
  /** 이 기둥의 반경 (mm). 다리 굵기·이웃 거리·지면 금지 높이의 기준. */
  radiusMm: number;
}

/** 브레이스 다리 하나 — 두 기둥 사이에 걸리는 막대 1개. */
export interface PillarBrace {
  /** 시작 기둥 id. */
  fromId: string;
  /** 끝 기둥 id. */
  toId: string;
  /** 시작 world 좌표 (fromId 기둥 위의 점). */
  from: Vec3;
  /** 끝 world 좌표 (toId 기둥 위의 점). */
  to: Vec3;
  /** 다리 반경 (mm) — 두 기둥 반경 중 작은 쪽. */
  radiusMm: number;
  /**
   * 어느 지그재그 단인가 (0-based). X자 교차로 추가된 다리는 짝이 되는
   * 지그재그 다리와 같은 단 번호를 갖는다.
   */
  step: number;
  /** X자 교차(cross)로 추가된 다리인가 — 설계 4-6/연구 5절 "거리 > 2×base_r". */
  cross: boolean;
}

/** 이 모듈 자체의 집계 리포트 — `RouteReport` 를 건드리지 않기 위해 분리했다. */
export interface InterconnectReport {
  /** 임계를 넘어 연결이 **필요했던** 기둥 수. */
  needed: number;
  /** 필요한 이웃 수를 실제로 채운 기둥 수. */
  connected: number;
  /** 필요했지만 하나도 못 채운 외톨이 기둥 수 (구제는 범위 밖 — 연구 5절 "후속"). */
  lonely: number;
  /** 빔 충돌검사에 걸려 거절된 다리 수. */
  rejectedByCollision: number;
  /** 높이비 50% 미달로 "연결됨" 인정에서 스킵된 페어 수. */
  skippedByHeightRatio: number;
  /** 실제로 만들어진 다리 수 (= 반환 배열 길이). */
  braces: number;
}

/** 계획 옵션. 수치는 전부 주입 가능(하드코딩 금지 원칙). */
export interface InterconnectOptions {
  /**
   * 구조각 (deg, 연직 기준) — 설계 4-3 **전 시스템 45° 단일**.
   *   기본값은 2b 의 `DEFAULT_STRUCTURAL_ANGLE_DEG` 를 import 해서 쓴다
   *   (새 각도 상수 도입 금지 — 정의 중복도 금지).
   */
  structuralAngleDeg?: number;
  /** 1차 임계 (mm). 기본 15. */
  h1Mm?: number;
  /** 2차 임계 (mm). 기본 35. */
  h2Mm?: number;
  /** 이웃 탐색 거리 반경 배수. 기본 40. */
  linkDistFactor?: number;
  /** 높이비 하한. 기본 0.5. */
  minHeightRatio?: number;
  /** 기둥당 다리 수 상한. 기본 4. */
  maxBracesPerPillar?: number;
  /** 지그재그 단 수 상한. 기본 6. */
  maxZigzagSteps?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 표현
// ─────────────────────────────────────────────────────────────────────────────

/** 전처리된 기둥 — 입력 폴리라인에서 계획에 필요한 값만 뽑아 둔 것. */
interface Pillar {
  id: string;
  /** 입력 순서 (동점 처리·페어 정규화용). */
  order: number;
  radiusMm: number;
  /** 경로 전체의 최저 Y (mm). */
  minY: number;
  /** 경로 전체의 최고 Y (mm). */
  maxY: number;
  /**
   * 기둥 높이 (mm) = maxY − minY.
   *
   * ## 왜 `contact.y − base.y` 가 아니라 경로 전체 Y 범위인가
   * `bent`/`joinPillar` 경로는 꺾여 있어 "수직 구간 높이"와 접점–착지 높이차가
   * 서로 다르다. 좌굴은 **구조물이 세로로 얼마나 길게 서 있는가**에서 오므로,
   * waypoints 를 포함한 경로 전체의 Y 범위를 높이로 본다(리드 결정 ⓑ).
   * 15/35mm 판정은 전부 이 값으로 한다.
   */
  heightMm: number;
  /** 지면 금지 하한 (mm, world Y) = minY + DEFAULT_MIN_LANDING_FACTOR × r. */
  minBraceY: number;
  /** 폴리라인을 Y 오름차순으로 정규화한 것 (아래 → 위). */
  path: Vec3[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 공개 진입점
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 기둥 목록을 받아 **좌굴 방지 브레이스 다리 목록**을 계획한다.
 *
 * ## 순서 (설계 4-6 + 연구 5절)
 *   1. 입력 폴리라인 → 내부 표현(높이·지면 금지 하한). 높이 기준은 결정 ⓑ.
 *   2. 임계(15/35mm)를 넘는 기둥마다 필요한 이웃 수(1/2)를 정한다.
 *   3. 이웃 후보 = 반경 비례 거리(max_d) 안, **가까운 순**. 동점은 id 로 깬다.
 *   4. 페어마다 pairhash 로 **중복 방지**, 높이비 50% 미만이면 "연결됨" 불인정.
 *   5. 지그재그 다리 — zstep = 수평거리 × tan(구조각). 단마다 시작/끝 기둥을
 *      교대로 올려가며 건다. 수평거리 > 2×base_r 이면 **X자 교차** 다리 추가.
 *   6. 다리마다 **빔 충돌검사** 통과 시에만 채택. 지면 4×r 이내에는 금지.
 *
 * ## 범위 밖
 *   · 외톨이 기둥 구제(보조 기둥 신설) — 연구 5절 원문이 "생략 가능(후속)".
 *   · 지오메트리 조립·저장·렌더 — 다음 단계(결정 ⓐ).
 *
 * @param pillars 기둥 목록. 입력 순서가 결과 순서를 정한다(결정성).
 * @param probe   빔 충돌 질의. 라우팅과 같은 인터페이스를 쓴다.
 * @returns 브레이스 목록 + 자체 리포트.
 */
export function planPillarInterconnect(
  pillars: readonly PillarInput[],
  probe: BeamProbe,
  opts: InterconnectOptions = {},
): { braces: PillarBrace[]; report: InterconnectReport } {
  const cfg = resolveInterconnectOptions(opts);
  const report: InterconnectReport = {
    needed: 0,
    connected: 0,
    lonely: 0,
    rejectedByCollision: 0,
    skippedByHeightRatio: 0,
    braces: 0,
  };

  const list = preparePillars(pillars);
  const braces: PillarBrace[] = [];
  if (list.length < 2) return { braces, report };

  /**
   * 기둥별 **이웃 수** — 상한(maxBracesPerPillar) 판정용.
   *   낱개 다리가 아니라 페어(이웃) 단위로 센다 — 상수 주석의 근거 참고.
   */
  const neighborCount = new Map<string, number>();
  /** 기둥별 "연결됨"으로 인정된 이웃 수 — 높이비 50% 이상 페어만 센다. */
  const linkCount = new Map<string, number>();
  /** ★ pairhash — 이미 다룬 페어를 다시 만들지 않는다(연구 5절). */
  const donePairs = new Set<string>();

  for (const a of list) {
    const need = requiredNeighborCount(a.heightMm, cfg);
    if (need === 0) continue;
    report.needed++;

    // (3) 이웃 후보 — 반경 비례 거리 안, 가까운 순. 동점은 id 로 깨 결정적.
    const candidates = findNeighborCandidates(a, list, cfg);

    for (const b of candidates) {
      if ((linkCount.get(a.id) ?? 0) >= need) break;

      // (4) pairhash — 페어 중복 방지. 순서 무관하게 같은 키가 나오도록 정규화.
      const key = pairKey(a, b);
      if (donePairs.has(key)) continue;

      // (4) 높이비 — 50% 미만이면 "연결됨"으로 안 친다(연구 5절).
      //     이 경우 다리 자체를 만들지 않고 페어를 소비하지도 않는다
      //     (더 나은 이웃이 뒤에 있을 수 있으므로 pairhash 에 넣지 않는다).
      const shorter = Math.min(a.heightMm, b.heightMm);
      const longer = Math.max(a.heightMm, b.heightMm);
      if (longer <= EPS || shorter / longer < cfg.minHeightRatio - EPS) {
        report.skippedByHeightRatio++;
        continue;
      }

      // (7) 기둥당 이웃 수 상한 — 양쪽 모두 여유가 있어야 건다.
      if (
        (neighborCount.get(a.id) ?? 0) >= cfg.maxBracesPerPillar ||
        (neighborCount.get(b.id) ?? 0) >= cfg.maxBracesPerPillar
      ) {
        continue;
      }

      // ★ pairhash 등록은 여기서 — 위 조건들로 걸러진 페어는 아직 "다뤄진" 것이
      //   아니므로(상한이 풀릴 일은 없지만 의미상 소비하지 않는다) 실제로 다리를
      //   시도하는 시점에 등록한다. 충돌로 전부 거절돼도 재시도하지 않는다
      //   (같은 기하에 같은 probe → 같은 결과. 재시도는 낭비다).
      donePairs.add(key);

      // (5)(6) 지그재그 + X자 + 충돌검사.
      const made = planZigzagBraces(a, b, probe, cfg, report);
      if (made.length === 0) continue;

      braces.push(...made);
      neighborCount.set(a.id, (neighborCount.get(a.id) ?? 0) + 1);
      neighborCount.set(b.id, (neighborCount.get(b.id) ?? 0) + 1);
      linkCount.set(a.id, (linkCount.get(a.id) ?? 0) + 1);
      linkCount.set(b.id, (linkCount.get(b.id) ?? 0) + 1);
    }

  }

  // ⚠️ connected/lonely 는 **모든 페어 루프가 끝난 뒤** 한 번에 센다.
  //   브레이스는 상호적이라(위에서 linkCount 를 양쪽 다 올린다) 뒤 순번 기둥이
  //   앞 기둥을 골라 앞 기둥의 이웃 수가 **나중에** 늘어날 수 있다. 루프 안에서
  //   확정하면 그 시점에 이미 lonely 로 세어진 뒤라 갱신되지 않아, **같은
  //   브레이스 집합인데 입력 순서만 바꾸면 리포트가 달라진다**(검수 지적).
  //   재현: 탐색 반경이 좁은 기둥이 넓은 기둥보다 앞에 오는 비대칭 반경 배치.
  //   lonely 는 ⑨ 외톨이 구제(후속)의 입력이 될 값이라 오집계를 고정하면
  //   구제가 불필요한 기둥에 보조 기둥을 세우게 된다.
  for (const p of list) {
    const need = requiredNeighborCount(p.heightMm, cfg);
    if (need <= 0) continue;
    if ((linkCount.get(p.id) ?? 0) >= need) report.connected++;
    else report.lonely++;
  }

  report.braces = braces.length;
  return { braces, report };
}

// ─────────────────────────────────────────────────────────────────────────────
// 옵션 해석
// ─────────────────────────────────────────────────────────────────────────────

/** 옵션 기본값을 채운 내부 표현 (파생값 선계산). */
interface ResolvedInterconnectOptions {
  structuralAngleDeg: number;
  /** tan(구조각) — zstep 계산에 쓴다. 45° 면 1. */
  tanStructural: number;
  h1Mm: number;
  h2Mm: number;
  linkDistFactor: number;
  minHeightRatio: number;
  maxBracesPerPillar: number;
  maxZigzagSteps: number;
}

function resolveInterconnectOptions(opts: InterconnectOptions): ResolvedInterconnectOptions {
  // 구조각은 0/90 을 배제한다 — tan 이 0 또는 발산해 zstep 이 무의미해진다.
  const angleDeg = clamp(opts.structuralAngleDeg ?? DEFAULT_STRUCTURAL_ANGLE_DEG, 1, 89);
  const h1 = Math.max(opts.h1Mm ?? DEFAULT_INTERCONNECT_H1_MM, 0);
  return {
    structuralAngleDeg: angleDeg,
    tanStructural: Math.tan((angleDeg * Math.PI) / 180),
    h1Mm: h1,
    // h2 가 h1 보다 낮으면 2단 규칙이 1단을 삼킨다 — h1 이상으로 올린다.
    h2Mm: Math.max(opts.h2Mm ?? DEFAULT_INTERCONNECT_H2_MM, h1),
    linkDistFactor: Math.max(opts.linkDistFactor ?? DEFAULT_LINK_DIST_FACTOR, 0),
    minHeightRatio: clamp(opts.minHeightRatio ?? DEFAULT_MIN_HEIGHT_RATIO, 0, 1),
    maxBracesPerPillar: Math.max(
      Math.floor(opts.maxBracesPerPillar ?? DEFAULT_MAX_BRACES_PER_PILLAR),
      0,
    ),
    maxZigzagSteps: Math.max(
      Math.floor(opts.maxZigzagSteps ?? DEFAULT_MAX_ZIGZAG_STEPS),
      0,
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 전처리
// ─────────────────────────────────────────────────────────────────────────────

/** 입력 폴리라인 → 내부 표현. 점 2개 미만·id 중복은 버린다. */
function preparePillars(pillars: readonly PillarInput[]): Pillar[] {
  const out: Pillar[] = [];
  const seenIds = new Set<string>();
  for (const p of pillars) {
    if (!p || p.polyline.length < 2) continue;
    if (seenIds.has(p.id)) continue;
    seenIds.add(p.id);

    let minY = Infinity;
    let maxY = -Infinity;
    for (const v of p.polyline) {
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
    }
    const r = Math.max(p.radiusMm, 0);
    // 결정 ⓑ — 높이 = 경로 전체의 Y 범위(Pillar.heightMm 주석 참고).
    const heightMm = maxY - minY;
    if (!(heightMm > EPS)) continue;

    // 폴리라인을 아래 → 위로 정규화해 두면 이후 "높이 y 의 기둥 위 점"을
    // 단조 탐색으로 구할 수 있다.
    const path = [...p.polyline].sort((u, v) => u[1] - v[1]);

    out.push({
      id: p.id,
      order: out.length,
      radiusMm: r,
      minY,
      maxY,
      heightMm,
      // (7) 지면 4×r 이내 다리 금지 — `DEFAULT_MIN_LANDING_FACTOR` 재사용.
      //     기준은 플레이트가 아니라 **그 기둥의 최저점**이다(경사 착지 기둥도 동일 규칙).
      minBraceY: Math.max(minY, PLATE_Y) + DEFAULT_MIN_LANDING_FACTOR * r,
      path,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 임계·이웃 후보
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 높이 임계 2단 — 필요한 이웃 수 (설계 4-6 표 / 연구 5절 H1·H2).
 *   15mm↑ → 1개, 35mm↑ → 2개, 그 아래는 연결 불요.
 */
function requiredNeighborCount(heightMm: number, cfg: ResolvedInterconnectOptions): number {
  if (heightMm >= cfg.h2Mm - EPS) return 2;
  if (heightMm >= cfg.h1Mm - EPS) return 1;
  return 0;
}

/**
 * 이웃 후보 — 반경 비례 거리 max_d 안에 있는 기둥을 **가까운 순**으로.
 *   연구 5절. 동점은 입력 순서(order)로 깨 결정적으로 만든다.
 */
function findNeighborCandidates(
  a: Pillar,
  list: readonly Pillar[],
  cfg: ResolvedInterconnectOptions,
): Pillar[] {
  // max_d = link_dist × r — 반경이 굵을수록 멀리까지 손을 뻗는다(연구 5절).
  const maxD = cfg.linkDistFactor * a.radiusMm;
  const scored: { p: Pillar; d: number }[] = [];
  for (const b of list) {
    if (b.id === a.id) continue;
    // 스스로가 임계 미만인 기둥도 이웃이 될 수 있다(붙잡아 주는 쪽).
    const d = horizontalDistance(a, b);
    if (d > maxD + EPS) continue;
    if (d < MIN_SEGMENT_LENGTH_MM) continue; // 같은 자리 = 다리를 만들 수 없다.
    scored.push({ p: b, d });
  }
  scored.sort((x, y) => (Math.abs(x.d - y.d) > EPS ? x.d - y.d : x.p.order - y.p.order));
  return scored.map((s) => s.p);
}

/** 두 기둥의 수평(XZ) 거리 — 대표점은 각 경로의 최저점 XZ 를 쓴다. */
function horizontalDistance(a: Pillar, b: Pillar): number {
  const pa = a.path[0];
  const pb = b.path[0];
  return Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
}

/**
 * ★ pairhash — 페어 중복 방지 키 (연구 5절).
 *   id 를 사전순으로 정규화해 (a,b) 와 (b,a) 가 같은 키가 되게 한다.
 *   구분자는 U+0000 — 기둥 id 에 절대 들어갈 수 없는 문자라, `"x" + "y|z"` 와
 *   `"x|y" + "z"` 가 같은 키로 뭉개지는 사고를 원천 차단한다.
 */
function pairKey(a: Pillar, b: Pillar): string {
  return a.id < b.id ? `${a.id}\u0000${b.id}` : `${b.id}\u0000${a.id}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 지그재그 다리
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 두 기둥 사이 **지그재그 다리**를 계획한다 (설계 4-6 / 연구 5절).
 *
 * ## 지그재그란
 * 두 기둥을 한 높이에서 수평으로만 잇지 않는다. 다리 자체가 구조각만큼
 * 기울어야 하므로(설계 4-3 — 전 시스템 45° 단일), 한 단 오를 때마다
 * **zstep = 수평거리 × tan(구조각)** 만큼 Y 가 올라간다. 시작/끝을 교대로
 * 올리며 걸면 지그재그 사다리 모양이 된다.
 *
 * ## X자 교차
 * 수평거리 > 2×base_r 이면 다리가 길어 한 가닥으로는 비틀림을 못 막는다.
 * 같은 단에 반대 방향 다리를 하나 더 걸어 X 를 만든다(연구 5절 dynamic 모드).
 *
 * ## 충돌
 * 다리마다 빔 충돌검사를 하고 **통과한 것만** 채택한다. 거절은 리포트에 센다.
 */
function planZigzagBraces(
  a: Pillar,
  b: Pillar,
  probe: BeamProbe,
  cfg: ResolvedInterconnectOptions,
  report: InterconnectReport,
): PillarBrace[] {
  const out: PillarBrace[] = [];
  const dist = horizontalDistance(a, b);
  if (!(dist >= MIN_SEGMENT_LENGTH_MM)) return out;

  // zstep = 수평거리 × tan(구조각) — 설계 4-6/연구 5절.
  const zstep = dist * cfg.tanStructural;
  if (!(zstep > EPS)) return out;

  const radiusMm = Math.min(a.radiusMm, b.radiusMm);
  // X자 교차 판정 기준 base_r — 두 기둥 중 굵은 쪽을 쓴다(보수적).
  const baseR = Math.max(a.radiusMm, b.radiusMm);
  const needCross = dist > 2 * baseR + EPS;

  // 다리를 걸 수 있는 공통 Y 구간 — 양쪽 기둥의 지면 금지 하한 위, 꼭대기 아래.
  const loY = Math.max(a.minBraceY, b.minBraceY);
  const hiY = Math.min(a.maxY, b.maxY);
  if (!(hiY - loY > EPS)) return out;

  for (let step = 0; step < cfg.maxZigzagSteps; step++) {
    // 교대(지그재그) — 짝수 단은 a 가 아래, 홀수 단은 b 가 아래.
    const lowY = loY + step * zstep;
    const highY = lowY + zstep;
    if (highY > hiY + EPS) break;

    const aIsLow = step % 2 === 0;
    const from = pointOnPillar(aIsLow ? a : b, lowY);
    const to = pointOnPillar(aIsLow ? b : a, highY);
    if (from === null || to === null) break;

    const fromId = aIsLow ? a.id : b.id;
    const toId = aIsLow ? b.id : a.id;

    // (6) 빔 충돌검사 — 통과한 다리만 채택.
    if (beamClear(probe, from, to, radiusMm)) {
      out.push({ fromId, toId, from, to, radiusMm, step, cross: false });
    } else {
      report.rejectedByCollision++;
    }

    // (3) X자 교차 — 같은 단에서 반대 대각선을 하나 더.
    if (needCross) {
      const cFrom = pointOnPillar(aIsLow ? b : a, lowY);
      const cTo = pointOnPillar(aIsLow ? a : b, highY);
      if (cFrom !== null && cTo !== null) {
        if (beamClear(probe, cFrom, cTo, radiusMm)) {
          out.push({
            fromId: toId,
            toId: fromId,
            from: cFrom,
            to: cTo,
            radiusMm,
            step,
            cross: true,
          });
        } else {
          report.rejectedByCollision++;
        }
      }
    }
  }

  return out;
}

/**
 * 높이 y 에서 기둥 경로 위의 world 점을 구한다.
 *   경로가 꺾여 있어도(bent/joinPillar) 그 높이의 실제 XZ 를 써야 다리가
 *   허공에 걸리지 않는다. 구간 사이는 선형 보간.
 *
 * @returns 경로의 Y 범위 밖이면 null.
 */
function pointOnPillar(p: Pillar, y: number): Vec3 | null {
  if (y < p.minY - EPS || y > p.maxY + EPS) return null;
  const path = p.path; // Y 오름차순으로 정규화돼 있다.
  for (let i = 0; i < path.length - 1; i++) {
    const lo = path[i];
    const hi = path[i + 1];
    if (y < lo[1] - EPS || y > hi[1] + EPS) continue;
    const span = hi[1] - lo[1];
    if (span <= EPS) return [lo[0], y, lo[2]];
    const t = (y - lo[1]) / span;
    return [lo[0] + (hi[0] - lo[0]) * t, y, lo[2] + (hi[2] - lo[2]) * t];
  }
  return null;
}

/**
 * 두 점을 잇는 빔이 청명한가 — `BeamProbe` 규약(`route-plan-core.ts`) 그대로.
 *   길이 안에 장애물이 있으면 false. 퇴화(길이 0) 구간도 false.
 */
function beamClear(probe: BeamProbe, from: Vec3, to: Vec3, radiusMm: number): boolean {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  if (!(len >= MIN_SEGMENT_LENGTH_MM)) return false;
  const dir: Vec3 = [dx / len, dy / len, dz / len];
  const hit = probe.hitDistance(from, dir, radiusMm, len);
  return hit === null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
