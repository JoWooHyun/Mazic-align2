// 서포트 재설계(S-4b-2b) 점 전처리 — 중복 제거 + 기둥 공유 클러스터링 (신규).
//   근거 문서:
//     · `docs/연구_프루사서포트_정독_20260811.md` 2장(파이프라인 ①·②·③), 7절 항목 5.
//     · `docs/설계_서포트재설계_20260720.md` 4-3(구조각 단일 파라미터), 4-4(경사 다리 최대 15mm).
//   ⚠️ 프루사는 AGPL — **개념만** 채택했고 코드는 이식하지 않았다(클린룸).
//
//   ## 왜 이 파일이 있는가 (B-3 정공법 전반부)
//   현재 우리 재설계 경로는 **점마다 기둥 1개**라 실물에서 서포트가 1,300개까지 불어난다(B-3).
//   프루사는 점마다 기둥을 세우지 않는다 — 지면 직행 가능한 점들을 클러스터로 묶어
//   **중심 1개만 기둥**을 세우고, 나머지 점은 그 기둥에 **경사 다리로 합류**시킨다.
//   이 파일은 그 전반부(순수 기하)를 구현한다.
//
//   ## 이 파일의 범위 — 순수 XZ/높이 기하만
//   ▸ 충돌 검사(모델 관통 여부)는 **하지 않는다**. 여기 결과는 어디까지나 **후보**이고,
//     S-4b-2c 가 빔 충돌 검사로 걸러낸다(막힌 멤버는 개별 기둥으로 되돌아간다).
//   ▸ 배선(redesign-detect-actions·place-points 연결)도 2c 의 몫이다. 이 파일은 순수 함수뿐.
//   ▸ 저장 스키마 무변경 — SupportPointV2 는 손대지 않는다. 전처리는 **생성 시점의 인메모리 변환**.
//
//   ▸ Babylon 무의존(헤드리스 검증 가능): `scripts/verify-preprocess-points.mjs`.
//   ▸ 모든 수치는 옵션으로 주입(하드코딩 상수 금지 — 리드 결정 3).

/**
 * 전처리 입력 점 하나. `SupportPointV2` 의 부분집합만 요구한다 —
 * 저장 타입에 결합하지 않기 위해 구조적으로 최소한만 받는다(2c 가 어떤 형태의
 * 점 목록을 들고 오든 어댑터 없이 쓸 수 있게).
 */
export interface PreprocessPoint {
  /** 모델 표면에 닿는 끝점 (world 좌표 [x, y, z]). y 가 접점 높이. */
  contact: [number, number, number];
  /** 이 점이 요구하는 팁 반경 (mm). 미지정이면 0 으로 본다(설계 3-4). */
  tipRadius?: number;
}

/** 중복 제거 결과 — 남은 점 + 어떤 입력 인덱스들이 이 점으로 합쳐졌는지. */
export interface DedupedPoint<T extends PreprocessPoint = PreprocessPoint> {
  /** 대표로 남긴 점 (입력 객체를 그대로 참조 — 복사하지 않는다). */
  point: T;
  /** 대표점의 원본 입력 인덱스. */
  index: number;
  /** 이 대표점에 흡수된 점들의 원본 입력 인덱스 (대표 자신은 제외). 진단·통지용. */
  mergedIndices: number[];
}

/**
 * 기둥 공유 클러스터 하나 (설계 4-4 / 프루사 ③ ROUTING_GROUND 대응).
 *
 * `pillarIndex` 자리에 **기둥 1개**를 세우고, `memberIndices` 의 점들은 각자
 * 접점에서 그 기둥으로 **경사 다리**를 내려 합류시킨다.
 *
 * ⚠️ **이것은 후보다.** 여기서는 순수 기하(수평 도달 거리·다리 길이)만 확인했다.
 *    실제로 그 다리가 모델을 관통하는지는 S-4b-2c 의 빔 충돌 검사가 판정하며,
 *    막힌 멤버는 클러스터에서 떨어져 나와 자기 기둥을 갖게 된다.
 */
export interface SharedPillarCluster {
  /** 기둥을 세울 중심점의 입력 인덱스 (`clusterForSharedPillars` 입력 기준). */
  pillarIndex: number;
  /** 기둥에 다리로 합류할 점들의 입력 인덱스. 중심 자신은 포함하지 않는다. */
  memberIndices: number[];
  /** 기둥 XZ 위치 = 중심점의 contact XZ ([x, z]). 기둥은 여기 수직으로 선다. */
  pillarXZ: [number, number];
}

/** 클러스터링 옵션. 설계 4-3 "단일 각도 파라미터, 사용자 조절" 원칙을 따른다. */
export interface ClusterPillarsOptions {
  /**
   * 구조각 (deg) — 설계 4-3. **연직(수직 아래)에서 잰 최대 기울기**로,
   * 프루사의 "극각 45° 포화"와 같은 정의다(연구 문서 4절).
   * 기본 45°. 0 에 가까우면 거의 수직(다리가 옆으로 못 감), 90 에 가까우면 거의 수평.
   */
  structuralAngleDeg?: number;
  /** 경사 다리 최대 길이 (mm) — 설계 4-4 "약 15mm, 너무 길면 스스로 휜다". 기본 15. */
  maxBridgeLengthMm?: number;
  /**
   * 다리 착지점이 플레이트에서 최소한 이만큼은 위여야 한다 (mm).
   * 연구 문서 5절 "지면 근처 다리 금지(최소 4×r 위)"의 일반화. 기본 0 = 제약 없음.
   * 바닥 접점(높이 0) 점이 자기 발밑에 붙는 퇴화 케이스를 막는 용도.
   */
  minBridgeLandingHeightMm?: number;
  /**
   * 기둥 1개가 받을 수 있는 최대 다리(멤버) 수 — 프루사 max_bridges_on_pillar
   * (연구 5절). 상한 없으면 탐욕 시드가 메가 클러스터를 만든다(실물 실측:
   * 기둥 3개에 다리 978개 — 물리적으로 비정상 하중). 초과 후보는 다음 라운드로
   * 되돌려 클러스터가 자연 분할된다. 기본 8.
   */
  maxMembersPerPillar?: number;
}

/** `dedupeSupportPoints` 기본 최소 거리 (mm) — 프루사 전처리 ①과 같은 0.1mm. */
export const DEFAULT_DEDUPE_MIN_DIST_MM = 0.1;

/** 구조각 기본값 (deg, 연직 기준) — 설계 4-3. */
export const DEFAULT_STRUCTURAL_ANGLE_DEG = 45;

/** 경사 다리 최대 길이 기본값 (mm) — 설계 4-4. */
export const DEFAULT_MAX_BRIDGE_LENGTH_MM = 15;

/**
 * 기둥당 최대 다리 수 기본값 — 프루사 max_bridges_on_pillar(연구 5절) 대응.
 *   프루사도 유한한 소수(기본 3)를 쓴다. 우리는 검출 밀도가 더 높아 8 로 둔다 —
 *   기둥 하나가 감당할 하중을 제한하면서도 기둥 수가 과하게 늘지 않는 절충점.
 */
export const DEFAULT_MAX_MEMBERS_PER_PILLAR = 8;

/** 부동소수 비교 여유 (mm). 0.1mm 경계에서 float 오차로 판정이 뒤집히지 않게. */
const EPS = 1e-9;

// ─────────────────────────────────────────────────────────────────────────────
// 1. 중복 제거
// ─────────────────────────────────────────────────────────────────────────────

/**
 * contact 기준으로 `minDistMm` 이내에 몰린 점들을 하나로 합친다.
 *   프루사 파이프라인 ① PINHEADS 의 "중복점 제거(0.1mm)"와 같은 개념
 *   (연구 문서 2장 ①, 7절 항목 5).
 *
 * ## 왜 필요한가
 * 아일랜드 격자 점찍기와 오버행 점찍기는 **서로를 모른다**. 같은 자리를 양쪽이
 * 각각 찍으면 사실상 같은 접점에 기둥이 2개 선다. 0.1mm 는 접점 앞구슬 지름
 * (⌀0.4mm, 설계 4-1)보다 훨씬 작아 "실질적으로 같은 자리"의 안전한 경계다.
 *
 * ## 남길 점을 고르는 기준 (근거)
 * 겹친 무리에서 **tipRadius 가 큰 점**을 남긴다. 팁 반경은 "이 자리가 요구하는
 * 접점 굵기"이므로(설계 3-4), 굵은 요구를 가는 점으로 대체하면 그 자리의 지지력이
 * 부족해진다 — 반대로 굵은 쪽을 남기면 가는 요구는 자동으로 충족된다.
 * **안전한 방향으로 실패하도록** 최대값을 취하는 것이다.
 *
 * ## 결정성 (같은 입력이면 같은 출력)
 * 입력 순서에 의존하면 셔플만으로 결과가 달라진다. 그래서 **먼저 정렬**한 뒤
 * 훑는다. 정렬 기준(전부 tie-break 까지 전순서):
 *   ① tipRadius 내림차순 — 위 "굵은 쪽을 남긴다" 기준을 순서로 표현.
 *   ② contact.x → ③ contact.y → ④ contact.z 오름차순 — 좌표 사전식.
 *   ⑤ 원본 인덱스 오름차순 — 좌표까지 완전히 같은 점의 최종 tie-break.
 * 정렬 후 앞에서부터 "이미 채택된 점과 minDist 이내면 흡수"로 훑으므로,
 * 입력을 어떻게 섞어도 채택 집합과 그 순서가 같다.
 *
 * @param points    전처리할 점 목록 (입력 객체는 변형하지 않는다).
 * @param minDistMm 이 거리 이내면 같은 점으로 본다 (mm). 기본 0.1.
 * @returns 남은 점들. 반환 순서 = 위 정렬 기준 순서(결정적).
 */
export function dedupeSupportPoints<T extends PreprocessPoint>(
  points: readonly T[],
  minDistMm: number = DEFAULT_DEDUPE_MIN_DIST_MM,
): DedupedPoint<T>[] {
  if (points.length === 0) return [];

  // minDist <= 0 이면 "합치지 않음" — 정렬만 해서 결정적 순서로 그대로 돌려준다.
  const minDist = Math.max(minDistMm, 0);
  const minDistSq = minDist * minDist;

  const order = points
    .map((_, i) => i)
    .sort((a, b) => compareForDedupe(points[a], points[b], a, b));

  const kept: DedupedPoint<T>[] = [];
  for (const idx of order) {
    const c = points[idx].contact;
    let host: DedupedPoint<T> | undefined;
    if (minDist > 0) {
      for (const k of kept) {
        if (distSq3(c, k.point.contact) <= minDistSq + EPS) {
          host = k;
          break;
        }
      }
    }
    if (host) host.mergedIndices.push(idx);
    else kept.push({ point: points[idx], index: idx, mergedIndices: [] });
  }

  // 흡수된 인덱스도 결정적으로 (정렬 순서가 아닌 원본 인덱스 오름차순).
  for (const k of kept) k.mergedIndices.sort((a, b) => a - b);
  return kept;
}

/** 중복 제거 정렬 비교자 — 위 doc 의 ①~⑤ 기준. */
function compareForDedupe(
  a: PreprocessPoint,
  b: PreprocessPoint,
  ia: number,
  ib: number,
): number {
  const ra = a.tipRadius ?? 0;
  const rb = b.tipRadius ?? 0;
  if (ra !== rb) return rb - ra; // ① 굵은 팁 우선.
  for (let axis = 0; axis < 3; axis++) {
    // ②③④ 좌표 사전식.
    if (a.contact[axis] !== b.contact[axis]) return a.contact[axis] - b.contact[axis];
  }
  return ia - ib; // ⑤ 최종 tie-break.
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 기둥 공유 클러스터링
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 멤버 점이 중심 기둥까지 **경사 다리로 닿을 수 있는 최대 수평 거리** (mm).
 *
 * ## 유도 (기하학적 근거)
 * 다리는 멤버의 접점(높이 h)에서 출발해 아래로 내려가 기둥 옆면에 붙는다.
 * 다리 방향과 연직(수직 아래)이 이루는 각을 θ 라 하면, 수평 이동 R 과 하강 D 는
 *
 *     R = L·sin θ ,  D = L·cos θ   (L = 다리 길이)
 *
 * 두 개의 상한이 동시에 걸린다.
 *
 *   (a) **구조각 상한** (설계 4-3): θ ≤ θmax. 다리는 θmax 보다 더 누울 수 없다.
 *       기둥에 붙는 지점은 플레이트(Y=0)보다 아래로 갈 수 없으므로 하강은 D ≤ h.
 *       R = D·tan θ 이고 θ ≤ θmax, D ≤ h 이므로
 *
 *           R ≤ h · tan θmax                                        … (a)
 *
 *       즉 **접점이 높을수록 더 멀리 뻗는다.** 바닥 접점(h=0)은 0 — 옆으로 못 간다.
 *
 *   (b) **다리 최대 길이 상한** (설계 4-4, 약 15mm): L ≤ Lmax.
 *       R = L·sin θ ≤ Lmax·sin θmax                                 … (b)
 *
 *       (sin 은 [0°, 90°] 에서 증가하므로 θ = θmax 일 때 R 이 최대.)
 *
 * 둘 다 만족해야 하므로 **최소값**이 실제 도달 거리다.
 *
 *     Rmax(h) = min( h·tan θmax ,  Lmax·sin θmax )
 *
 * θmax=45°, Lmax=15 의 기본값이면 Rmax(h) = min(h, 10.6066mm) — 접점 높이가
 * 10.6066mm 를 넘으면 다리 길이 제한이 지배한다.
 *
 * @param contactHeightMm 멤버 접점의 플레이트 기준 높이 h (mm). 음수는 0 으로 클램프.
 * @param structuralAngleDeg 구조각 θmax (deg, 연직 기준).
 * @param maxBridgeLengthMm 다리 최대 길이 Lmax (mm).
 */
export function maxBridgeReachMm(
  contactHeightMm: number,
  structuralAngleDeg: number = DEFAULT_STRUCTURAL_ANGLE_DEG,
  maxBridgeLengthMm: number = DEFAULT_MAX_BRIDGE_LENGTH_MM,
): number {
  const h = Math.max(contactHeightMm, 0);
  const theta = (clamp(structuralAngleDeg, 0, 90) * Math.PI) / 180;
  const byAngle = h * Math.tan(theta); // … (a)
  const byLength = Math.max(maxBridgeLengthMm, 0) * Math.sin(theta); // … (b)
  return Math.min(byAngle, byLength);
}

/**
 * 멤버가 그 기둥에 실제로 닿을 수 있는지 — `maxBridgeReachMm` 유도를 그대로
 * 되짚는 판정. 클러스터링 내부에서도 쓰고, 검증 스크립트가 **전수 확인**할 때도 쓴다.
 *
 * @param horizDistMm 멤버 접점 XZ ↔ 기둥 XZ 수평 거리 (mm).
 * @param contactHeightMm 멤버 접점 높이 h (mm).
 */
export function canBridgeReach(
  horizDistMm: number,
  contactHeightMm: number,
  opts: ClusterPillarsOptions = {},
): boolean {
  const angle = opts.structuralAngleDeg ?? DEFAULT_STRUCTURAL_ANGLE_DEG;
  const maxLen = opts.maxBridgeLengthMm ?? DEFAULT_MAX_BRIDGE_LENGTH_MM;
  const minLanding = opts.minBridgeLandingHeightMm ?? 0;
  if (horizDistMm > maxBridgeReachMm(contactHeightMm, angle, maxLen) + EPS) return false;

  // 착지 높이 제약: 수평 R 을 가는 데 필요한 **최소 하강**은 R / tan θmax
  // (구조각보다 더 눕힐 수 없으므로 그보다 덜 내려갈 수는 없다).
  const theta = (clamp(angle, 0, 90) * Math.PI) / 180;
  const t = Math.tan(theta);
  const minDrop = t <= EPS ? (horizDistMm > EPS ? Infinity : 0) : horizDistMm / t;
  return Math.max(contactHeightMm, 0) - minDrop >= minLanding - EPS;
}

/**
 * 지면 직행 가능한 점들을 묶어 **클러스터당 기둥 1개**로 줄인다
 * (프루사 ③ ROUTING_GROUND 대응, 연구 문서 2장·7절 항목 5 / 설계 4-4).
 *
 * ## 알고리즘 (결정적 탐욕법)
 * 1. 점들을 **접점이 높은 순**으로 정렬한다(tie-break 은 좌표·인덱스 사전식).
 *    높은 점부터 잡는 이유: 도달 거리 Rmax 는 접점 높이에 비례하므로(위 (a)),
 *    높은 점일수록 넓게 품을 수 있다 — 큰 클러스터가 먼저 자리를 잡아야 기둥이 덜 남는다.
 * 2. 아직 어디에도 안 속한 점을 시드로 잡고, **양방향으로 다리가 성립하는** 점들을
 *    후보 멤버로 모은다. "양방향"인 이유는 중심이 나중에 바뀔 수 있어서다 —
 *    시드에서만 닿으면 중심 교체 후 못 닿는 멤버가 생긴다.
 * 3. 후보 무리에서 **중심을 고른다**(아래 기준). 중심이 정해지면 그 중심에 실제로
 *    닿지 못하는 후보는 **떨어뜨려 다음 라운드로 되돌린다**(도달 불가 멤버 0 보장).
 * 3b. **기둥당 다리 상한**(`maxMembersPerPillar`, 기본 8) 을 적용한다 — 가까운
 *    순으로 N개만 남기고 나머지는 다음 라운드로 되돌린다. 상한이 없으면 탐욕
 *    시드가 메가 클러스터를 만든다(실물: 기둥 3개에 다리 978개, T-3).
 * 4. 남은 점이 없을 때까지 반복. 멤버가 없는 클러스터는 곧 "혼자 선 기둥"이다.
 *
 * ## 중심 선정 기준 (근거)
 * 기둥은 중심점의 XZ 에 서므로 **멤버들의 다리가 짧을수록 좋다**(재료·좌굴·충돌 위험이
 * 모두 다리 길이에 비례). 그래서 후보들 중 **다른 후보들까지의 수평 거리 합이 최소**인
 * 점을 중심으로 삼는다(이산 기하 중앙점). 무게중심 좌표를 쓰지 않고 **후보 중 하나**를
 * 고르는 이유는, 기둥이 어차피 어떤 점의 접점 아래에 서야 그 점이 다리 없이 수직으로
 * 내려가기 때문 — 무게중심에 세우면 모든 점이 다리를 필요로 해 오히려 손해다.
 * 동점이면 ① 접점이 높은 쪽(긴 다리를 감당할 여유가 큼) → ② 좌표·인덱스 사전식으로
 * 가른다. 전부 전순서라 결과는 결정적이다.
 *
 * ## ⚠️ 결과는 후보다
 * 충돌 검사는 하지 않았다. S-4b-2c 가 빔 검사로 각 다리를 확인하고, 막힌 멤버는
 * 클러스터에서 떼어 개별 기둥으로 되돌린다. 즉 이 함수의 기둥 수는 **하한**이고
 * 실제 기둥 수는 그 이상이 된다.
 *
 * @param points 전처리(중복 제거)된 점 목록.
 * @param opts   구조각·다리 최대 길이 등. 전부 옵셔널(기본 45° / 15mm).
 * @returns 클러스터 목록. 순서는 결정적(위 1의 정렬 순서로 시드가 잡힌 순).
 */
export function clusterForSharedPillars(
  points: readonly PreprocessPoint[],
  opts: ClusterPillarsOptions = {},
): SharedPillarCluster[] {
  const n = points.length;
  if (n === 0) return [];

  const order = [...Array(n).keys()].sort((a, b) =>
    compareBySeedPriority(points[a], points[b], a, b),
  );

  const taken = new Array<boolean>(n).fill(false);
  const clusters: SharedPillarCluster[] = [];
  let remaining = n;

  while (remaining > 0) {
    // (2) 아직 안 잡힌 첫 시드 — order 가 결정적이라 시드도 결정적.
    const seed = order.find((i) => !taken[i]);
    if (seed === undefined) break;

    // 양방향 도달 가능한 후보 모으기 (시드 포함).
    const candidates = [seed];
    for (const i of order) {
      if (i === seed || taken[i]) continue;
      const d = horizDist(points[i].contact, points[seed].contact);
      if (
        canBridgeReach(d, points[i].contact[1], opts) &&
        canBridgeReach(d, points[seed].contact[1], opts)
      ) {
        candidates.push(i);
      }
    }

    // (3) 중심 선정 + 중심에 못 닿는 후보 탈락.
    const pillar = pickPillarIndex(points, candidates);
    const reachable: number[] = [];
    for (const i of candidates) {
      if (i === pillar) continue;
      const d = horizDist(points[i].contact, points[pillar].contact);
      if (canBridgeReach(d, points[i].contact[1], opts)) reachable.push(i);
      // 못 닿으면 taken 을 세우지 않아 다음 라운드에서 자기 클러스터를 갖는다.
    }

    // (3b) 기둥당 다리 상한 — 중심에서 **수평거리 가까운 순**으로 최대 N개만
    //   채택한다(짧은 다리가 구조적으로 유리하고, 먼 멤버는 다른 시드 주변에서
    //   더 짧은 다리를 얻을 가능성이 크다). 남은 후보는 taken 을 안 세워
    //   다음 라운드로 돌아가고, 거기서 자기 클러스터를 이룬다 = 자연 분할.
    const maxMembers = Math.max(opts.maxMembersPerPillar ?? DEFAULT_MAX_MEMBERS_PER_PILLAR, 0);
    let members = reachable;
    if (reachable.length > maxMembers) {
      members = [...reachable]
        .sort((a, b) => compareByBridgeCost(points, a, b, pillar))
        .slice(0, maxMembers);
    }

    taken[pillar] = true;
    remaining--;
    for (const i of members) {
      taken[i] = true;
      remaining--;
    }
    members.sort((a, b) => a - b); // 결정적 출력.
    clusters.push({
      pillarIndex: pillar,
      memberIndices: members,
      pillarXZ: [points[pillar].contact[0], points[pillar].contact[2]],
    });
  }

  return clusters;
}

/** 시드 정렬 — 접점 높은 순, 그다음 좌표·인덱스 사전식 (전순서 = 결정적). */
function compareBySeedPriority(
  a: PreprocessPoint,
  b: PreprocessPoint,
  ia: number,
  ib: number,
): number {
  if (a.contact[1] !== b.contact[1]) return b.contact[1] - a.contact[1]; // 높은 순.
  for (const axis of [0, 2, 1]) {
    if (a.contact[axis] !== b.contact[axis]) return a.contact[axis] - b.contact[axis];
  }
  return ia - ib;
}

/**
 * 다리 채택 우선순위 — 중심 기둥까지 **수평거리 가까운 순** (기둥당 상한용).
 *   동거리 tie-break 은 이 파일의 전순서 규약(높은 점 → 좌표·인덱스 사전식)을
 *   그대로 재사용한다. 전순서라 상한을 걸어도 결과는 결정적이다.
 */
function compareByBridgeCost(
  points: readonly PreprocessPoint[],
  a: number,
  b: number,
  pillar: number,
): number {
  const pc = points[pillar].contact;
  const da = horizDist(points[a].contact, pc);
  const db = horizDist(points[b].contact, pc);
  if (da !== db) return da - db;
  return compareBySeedPriority(points[a], points[b], a, b);
}

/** 중심 선정 — 후보들까지의 수평거리 합 최소, 동점이면 높은 점 → 좌표·인덱스 순. */
function pickPillarIndex(
  points: readonly PreprocessPoint[],
  candidates: readonly number[],
): number {
  let best = candidates[0];
  let bestCost = Infinity;
  for (const i of candidates) {
    let cost = 0;
    for (const j of candidates) {
      if (i !== j) cost += horizDist(points[i].contact, points[j].contact);
    }
    if (cost < bestCost - EPS) {
      best = i;
      bestCost = cost;
    } else if (
      cost <= bestCost + EPS &&
      i !== best &&
      compareBySeedPriority(points[i], points[best], i, best) < 0
    ) {
      // 동점 tie-break: 높은 점 우선 → 좌표·인덱스 사전식.
      best = i;
      bestCost = Math.min(bestCost, cost);
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// 공용 소도구
// ─────────────────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function distSq3(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/** XZ 평면 수평 거리 (Y = 높이축). */
function horizDist(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dz);
}
