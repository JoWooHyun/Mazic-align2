// 서포트 조립 코어 (S-4b-1, B안). **순수 모듈 — Babylon import 금지.**
//   부품 지오메트리(구/원뿔/원기둥) + 조립 스펙 → 단일 병합 지오메트리
//   { positions, indices } 를 낸다. 어파인 변환(스케일→회전→이동)을 부품
//   positions 에 적용해 이어붙인다. 순수 함수라 헤드리스(Node)에서 검증 가능
//   (verify-assemble-core.mjs) — 이것이 assemble-support.ts(Babylon 래퍼)와
//   분리한 이유.
//
//   설계서 `docs/설계_서포트재설계_20260720.md` 4-1(접점/핀헤드)·4-2(기둥) 정본.
//
//   ※ **임의 방향 막대**(경사 다리·기둥 연결·표면 앵커) 프리미티브는 자매 모듈
//     `assemble-strut.ts` 에 있다 (S-4b-2a). 이 파일은 수직 전용 조립만 담당한다
//     — 프루사가 Pillar(수직 전용)와 Bridge(경사)를 나눠 두는 구분과 같다
//     (`docs/연구_프루사서포트_정독_20260811.md` 6장). 두 파일은 위 행렬 유틸과
//     `SupportPartsSet` 을 공유한다.
//
//   좌표계: 부품과 동일한 로컬 좌표. **Z-up (부품 STL 규격)** 이 아니라 여기서는
//   조립 축을 **Y** 로 둔다 — 조립 결과가 씬(Y-up)에 바로 얹히도록, 부품의 Z축을
//   조립 시 Y축으로 회전시켜 배치한다(각 assemble 함수가 X축 +90° 회전 포함).
//   로컬 XZ 원점(0, y, 0) 기준 수직으로 쌓는다. Babylon 래퍼가 이 로컬 형상을
//   contact/base 방향으로 정렬·이동한다.

import type { SupportParams, SupportPointV2 } from "./types";

/**
 * 빌드플레이트 Y (world). 씬의 플레이트는 항상 여기 있다.
 */
export const PLATE_Y = 0;

/**
 * 저장된 base 의 world Y 가 "플레이트 접지를 의도한 값" 인지 볼 때 쓰는 허용치(mm).
 *   점을 만들 때 base 는 정확히 `[cx, 0, cz]` 로 찍히지만(redesign-detect-actions
 *   `snapAndFinalizePoints`), world→stl-local→world 왕복에 Babylon 의 float32
 *   행렬 반올림이 껴서 0 이 아니라 1e-5 급으로 돌아온다. 레이어 두께(50µm)의
 *   1/50 인 1e-3mm 면 왕복 노이즈보다 훨씬 위이면서, 실제 앵커 높이(최소 수 mm)
 *   와는 자릿수로 떨어져 있어 양쪽에 여유가 있다.
 */
const PLATE_CONTACT_EPS_MM = 1e-3;

/**
 * 재설계 서포트 기둥 발의 **world Y** 를 정한다 (B-18). **순수 함수**.
 *
 * ## 리드 확정 정책 (타 슬라이서 실물 대조)
 * "수직이동은 서포터 달린 상태로 올라갔다 내려오더라. 서포터랑 STL 이랑 아예 다른
 * 객체 취급이야." — 실물 화면에서 모델은 공중에 떠 있고(Z=6.71) 서포트는 **바닥에서
 * 모델까지** 늘어나 있었다. 즉 서포트는 모델에 종속된 게 아니라 **플레이트에 서 있는
 * 독립 구조물**이고 모델이 그 위에 얹혀 있다. 모델이 오르내리면 발은 바닥에 붙은 채
 * **기둥 길이만 변한다**.
 *
 * ## 왜 무조건 0 을 박지 않는가
 * S-4b-2 의 3단 폴백(경사 다리·근처 기둥 합류·모델 표면 앵커)이 들어오면 base 가
 * 플레이트가 **아닌** 곳에 앉는 점이 생긴다. 그때 0 하드코딩은 그 점들의 발을 바닥까지
 * 끌어내려 폴백을 통째로 망가뜨린다. 그래서 판정을 두 단계로 둔다:
 *   1) `baseAnchor` 가 명시돼 있으면 **그 말을 믿는다** — 'model' 이면 저장값 그대로.
 *      S-4b-2 는 폴백 결과에 `baseAnchor:'model'` 만 실어 보내면 되고 이 함수는
 *      건드릴 필요가 없다.
 *   2) 명시가 없으면(기존·옛 데이터) 저장된 base 의 world Y 가 플레이트 근처인지로
 *      **접지 의도를 추정**한다. S-4b-1 은 base 를 항상 `[cx, 0, cz]` 로 찍으므로
 *      (`snapAndFinalizePoints`) 모델이 아직 안 움직인 데이터는 여기서 걸린다.
 *
 * ⚠️ 2) 의 추정은 **모델이 이미 수직 이동된 뒤 저장된 옛 데이터**는 놓칠 수 있다
 * (발이 떠 있는 상태가 "의도된 앵커" 로 보인다). 이는 B-18 이전 데이터에만
 * 해당하고, 그 데이터는 어차피 옛 정책상 수직 이동 시 삭제됐어야 할 점들이다.
 * 신규 점은 1) 로 확정되므로 시간이 지나면 추정 경로는 비어 간다.
 *
 * @param storedBaseWorldY 저장된 base 를 world 로 되돌린 Y.
 * @param baseAnchor       점의 base 앵커 종류 (없으면 추정).
 * @returns 조립에 쓸 baseY (world).
 */
export function resolveRedesignBaseY(
  storedBaseWorldY: number,
  baseAnchor?: "plate" | "model",
): number {
  // 1) 명시된 앵커가 우선. 'model' 이면 저장값 그대로 — 폴백 경로 보호.
  if (baseAnchor === "model") return storedBaseWorldY;
  if (baseAnchor === "plate") return PLATE_Y;
  // 2) 미지정(옛 데이터) — 플레이트 근처면 접지 의도로 보고 고정.
  return Math.abs(storedBaseWorldY - PLATE_Y) <= PLATE_CONTACT_EPS_MM
    ? PLATE_Y
    : storedBaseWorldY;
}

/** 조립 좌표계 3D 점/방향 [x, y, z] (mm 또는 단위벡터).
 *   S-4e-1 에서 assemble-strut.ts 에 있던 정의를 여기로 옮겼다 — 화살촉 방향
 *   유틸(`saturateHeadDir`/`rotationYToDir`)이 이 파일에 필요한데, strut 이
 *   core 를 import 하므로 반대 방향 import 는 **순환**이 된다. strut 은 이 타입을
 *   그대로 재수출하므로 기존 import 경로(`./assemble-strut`)는 무회귀다. */
export type Vec3 = [number, number, number];

/** 병합 지오메트리 (positions: xyz flat, indices: 삼각형 3개씩). */
export interface SupportPartsGeometry {
  positions: Float32Array;
  indices: Uint32Array;
}

/** 부품 3종 세트. */
export interface SupportPartsSet {
  sphere: SupportPartsGeometry;
  cone: SupportPartsGeometry;
  cylinder: SupportPartsGeometry;
}

/**
 * 화살촉 수직 서포트 조립 스펙 (전부 mm, 로컬 축 = Y 수직).
 *   surfaceY : 모델 표면 접점 Y (로컬). 앞구슬 꼭대기가 여기서 침투 깊이만큼 위로.
 *   baseY    : 바닥판(플레이트) Y (로컬). 보통 0.
 *   나머지는 SupportParams/point 에서 온다(하드코딩 금지 — 수용 4).
 */
export interface VerticalSupportSpec {
  surfaceY: number;
  baseY: number;
  /** 앞구슬(팁) 지름. = 2×point.tipRadius (없으면 params.tipDiameterMm). */
  tipDiameterMm: number;
  /** 화살촉 뒷구슬 지름 (params.headBackDiameterMm). */
  headBackDiameterMm: number;
  /** 화살촉 길이 = 앞구슬 중심 → 뒷구슬 중심 (params.headLengthMm). */
  headLengthMm: number;
  /** 접점 침투 깊이 (params.contactPenetrationMm). */
  contactPenetrationMm: number;
  /** 기둥(트렁크) 지름 (params.trunkDiameterMm). */
  trunkDiameterMm: number;
  /** 바닥 발 밑면 지름 (params.baseDiameterMm). */
  baseDiameterMm: number;
  /** 바닥 발(원뿔) 높이 = 기둥→바닥 전이 (params.baseTransitionMm). */
  baseTransitionMm: number;
  /**
   * S-4e-1 — 화살촉이 접점에서 서포트 쪽으로 나가는 방향 (world 단위벡터,
   * **포화 전 원시값**). 미지정이거나 정확히 (0,−1,0) 이면 종전 수직 경로를
   * 그대로 탄다(positions 바이트 동일). 포화(45°)는 조립이 한 번만 한다.
   *
   * ⚠️ 이 spec 은 로컬 XZ 원점 기준 조립인데 headDir 만 world 방향이다 —
   * 호출 측(assemble-support)이 월드 프레임에서 수직 조립하므로 두 축이
   * 일치하기 때문이다(파일 머리 좌표계 주석 참고).
   */
  headDir?: Vec3;
}

// ── 4×4 어파인 행렬 유틸 (row-major, column-vector 곱: v' = M·v) ──────────
//   S-4b-2a: 자매 모듈 assemble-strut.ts(임의 방향 막대)가 그대로 재사용하도록
//   export 로 연다. 행렬 규약(row-major·열벡터)이 두 파일에서 갈리면 조립 결과가
//   조용히 어긋나므로 정의는 여기 하나만 둔다.
export type Mat4 = number[]; // 길이 16.

export function matMul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0) as Mat4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  }
  return out;
}

/** 비균일 스케일. **음수 스케일 금지**(winding 뒤집힘) — 뒤집기는 회전으로. */
export function matScale(sx: number, sy: number, sz: number): Mat4 {
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
}

export function matTranslate(tx: number, ty: number, tz: number): Mat4 {
  return [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1];
}

/** X축 회전 (rad). */
export function matRotX(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

/** 부품 Z-up → 조립 Y-up: Z축을 +Y 로 세우는 회전 = X축 -90°.
 *   (Z=1 인 꼭짓점이 Y=+1 로 감. cone/cylinder 의 "위"가 +Y 가 되게.) */
export function matZupToYup(): Mat4 {
  return matRotX(-Math.PI / 2);
}

/**
 * 부품 지오메트리에 어파인 변환 M 을 적용해 acc(누적 배열)에 이어붙인다.
 *   indices 는 현재 정점 오프셋만큼 밀어 재부여한다. (부품 indices 는 0..N 순번.)
 */
export function appendTransformed(
  part: SupportPartsGeometry,
  m: Mat4,
  accPos: number[],
  accIdx: number[],
): void {
  const vbase = accPos.length / 3;
  const p = part.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    accPos.push(
      m[0] * x + m[1] * y + m[2] * z + m[3],
      m[4] * x + m[5] * y + m[6] * z + m[7],
      m[8] * x + m[9] * y + m[10] * z + m[11],
    );
  }
  const idx = part.indices;
  for (let i = 0; i < idx.length; i++) accIdx.push(idx[i] + vbase);
}

/**
 * 축이 정확히 ±Y 라고 볼 임계 — **수평 성분 크기** h = hypot(d.x, d.z) 기준.
 *
 * h 가 이보다 작으면 회전을 항등/180° 로 스냅한다. 스냅이 만드는 방향 오차는
 * 최대 h 이므로 1e-9 면 10mm 막대에서 끝점 1e-8mm — 허용치(1e-4mm)의 1/10000 이라
 * 무해하다. (각도로는 6e-8° 미만.)
 *
 * ⚠️ 이 임계를 |d.x|,|d.z| **각각**에 걸면 안 된다. 두 성분이 각각 임계 아래여도
 * 합성 h 는 그 √2 배까지 커질 수 있어 경계가 흐려진다. 반드시 hypot 으로 볼 것.
 */
const AXIS_PARALLEL_EPS = 1e-9;

/**
 * **로컬 +Y 축을 단위벡터 d 로 보내는 회전 행렬** (S-4b-2a 핵심).
 *
 * ## 왜 필요한가
 * 부품(cylinder)은 조립 좌표에서 항상 +Y 로 서 있다(Z-up 부품을 matZupToYup 으로
 * 세운 결과). 경사 다리는 축이 world Y 가 아니므로, 그 +Y 축을 목표 방향 d 로
 * 정확히 돌려놓는 회전이 있어야 한다. 스케일만으로는 절대 만들 수 없다 —
 * 비균일 스케일은 축 방향을 바꾸지 못하고 늘리기만 하기 때문이다(대조군 참고).
 *
 * ## 구성 방식 — 로드리게스 회전 (a=+Y → b=d)
 * 두 단위벡터 a, b 를 잇는 최소 회전은 축 k = a×b, 각 θ = acos(a·b) 의 회전이다.
 * 로드리게스 공식 R = I + [k]ₓ + [k]ₓ²·(1−c)/s² 를 a=(0,1,0) 로 특수화하면
 * 삼각함수 호출 없이 d 성분만으로 닫힌 형태가 나온다:
 *
 *   k = a×b = (d.z, 0, −d.x),  c = a·b = d.y,  s² = |k|² = d.x² + d.z² = 1 − c²
 *   → (1−c)/s² = (1−c)/((1−c)(1+c)) = **1/(1+c)** = 1/(1 + d.y)
 *
 * 즉 `1/(1 + d.y)` 하나만 있으면 된다(k 계수 = 1). 삼각함수·역삼각함수를 안 써서
 * 축·각을 따로 정규화할 필요가 없다.
 *
 * ## ★ 분모를 (1 + d.y) 로 **직접 계산하지 않는** 이유 (수치 안정성)
 * d 가 −Y 에 가까우면 d.y ≈ −1 이라 `1 + d.y` 는 **파국적 상쇄**를 일으킨다:
 * 유효숫자가 통째로 날아가 h≈1e-7 부근에서 이미 상대오차가 100% 에 이르고
 * (실측: 10mm 막대 끝점이 0.5mm 어긋남), h 가 더 작으면 d.y 가 정확히 −1 로
 * 반올림되어 분모 0 → **inv = Infinity → 좌표 전체 NaN** 이 된다.
 *
 * 그래서 대수적으로 같지만 상쇄가 없는 형태로 바꿔 쓴다. s² = h² = 1 − d.y² 이고
 * 계수는 (1−c)/s² 였으므로, **1 + d.y 대신 h 와 d.y 로**:
 *
 *   1 + d.y = (1 − d.y²)/(1 − d.y) = h²/(1 − d.y)
 *   → 계수 = 1/(1 + d.y) = **(1 − d.y)/h²**
 *
 * `1 − d.y` 는 d.y ≈ −1 일 때 2 에 가까워 상쇄가 없고, h² 는 입력 성분에서 곧장
 * 오는 값이라 정확하다. 이 형태는 −Y 바로 옆까지 전 구간에서 안정적이며, 남는
 * 퇴화는 h = 0(정확히 ±Y) 하나뿐이다.
 *
 * ## 퇴화 케이스 (반드시 처리)
 * h = 0 이면 위 계수의 분모가 0 이다. 이때 d 가 −Y 면 a 와 정반대라 "최소 회전축"
 * 자체가 유일하지 않다(어떤 수평축으로 180° 돌려도 a 가 b 로 간다). 두 갈래를
 * 따로 박는다:
 *   · d ≈ +Y  → 회전 불필요, 항등 행렬.
 *   · d ≈ −Y  → X축 180° 회전을 **하나 골라** 쓴다. 축 대칭인 원기둥·구라 어느
 *     수평축을 고르든 결과 형상이 같으므로 임의 선택이 안전하다. (스케일 −1 로
 *     뒤집으면 삼각형 winding 이 반전되므로 금지 — assemble-core matScale 주석.)
 * 판정은 **h ≤ AXIS_PARALLEL_EPS**. 검증 스크립트가 −Y 근처를 촘촘히 훑어
 * NaN·오차 폭주가 없음을 지킨다.
 *
 * @param d 단위벡터(호출 측이 정규화 보장).
 * @returns +Y 를 d 로 보내는 4×4 회전 행렬 (row-major, 열벡터 곱).
 */
export function rotationYToDir(d: Vec3): Mat4 {
  const [dx, dy, dz] = d;

  // 퇴화: 축이 ±Y 와 평행 → 로드리게스 분모(1 + dy)가 0 으로 반올림돼 무의미.
  //   **수평 성분의 합성 크기**로 판정한다(성분별 판정은 위 상수 주석의 ⚠️ 참고).
  if (Math.hypot(dx, dz) <= AXIS_PARALLEL_EPS) {
    if (dy >= 0) {
      // +Y → +Y : 항등.
      return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    }
    // +Y → −Y : X축 180°. (Y→−Y, Z→−Z. det=+1 이라 winding 보존.)
    return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];
  }

  // 로드리게스(a=+Y 특수화): k=(dz, 0, −dx).
  //   계수 = 1/(1 + dy) 를 **상쇄 없는 등가식 (1 − dy)/h²** 로 계산한다
  //   (위 주석 "★ 분모를 …" 절 — −Y 근처 정밀도·NaN 방지의 핵심).
  const kx = dz;
  const kz = -dx;
  const h2 = dx * dx + dz * dz;
  const inv = (1 - dy) / h2;

  // [k]ₓ (외적 행렬, ky=0):
  //   [  0   −kz    0 ]
  //   [ kz    0   −kx ]
  //   [  0    kx    0 ]
  // [k]ₓ² :
  //   [ −kz²      0     kx·kz ]
  //   [   0   −kx²−kz²    0   ]
  //   [ kx·kz     0     −kx²  ]
  const kx2 = kx * kx;
  const kz2 = kz * kz;
  const kxz = kx * kz;

  const m00 = 1 - kz2 * inv;
  const m01 = -kz;
  const m02 = kxz * inv;
  const m10 = kz;
  const m11 = 1 - (kx2 + kz2) * inv;
  const m12 = -kx;
  const m20 = kxz * inv;
  const m21 = kx;
  const m22 = 1 - kx2 * inv;

  return [
    m00, m01, m02, 0,
    m10, m11, m12, 0,
    m20, m21, m22, 0,
    0, 0, 0, 1,
  ];
}

/**
 * **화살촉이 눕는 한계각 (deg)** — 설계 4-3 "45° 단일 규칙" 1번 항목.
 *
 * 접점이 표면 법선을 따라가되 수직(−Y)에서 이 각을 넘게 눕지는 못한다. 너무
 * 누우면 접점 자체가 약해지기 때문이다(설계 4-1 "방향"). 설계가 **전 시스템
 * 단일 각**으로 못 박은 값이라 파라미터로 노출하지 않는다 — 경사 다리·기둥
 * 연결도 같은 45° 를 쓴다.
 */
export const HEAD_MAX_TILT_DEG = 45;

/**
 * 수평 성분이 0 이라고 볼 임계. 이 아래면 방위를 정의할 수 없어 수직으로 떨어뜨린다.
 *   (rotationYToDir 의 AXIS_PARALLEL_EPS 와 같은 취지·같은 크기.)
 */
const HEAD_HORIZONTAL_EPS = 1e-9;

/**
 * **화살촉 방향 45° 포화** (설계 4-1 방향 + 4-3 단일 각). **순수 함수**.
 *
 * 입력 `dir` 은 접점에서 **서포트 쪽(자유 공간)으로 나가는** 단위벡터다. 평평한
 * 밑면이면 (0,−1,0) 이고, 이때 결과도 (0,−1,0) 이라 종전 수직 조립과 정확히
 * 같은 형상이 나온다(무회귀 지점).
 *
 * 수직축 −Y 와 dir 이 이루는 극각 θ 가 한계를 넘으면 **수평 방위는 유지한 채
 * 극각만** 한계로 줄인다:
 *   h = normalize(dx, 0, dz),  out = h·sin(maxTilt) + (0,−1,0)·cos(maxTilt)
 * 방위를 유지하는 이유 — 화살촉이 "표면이 향한 쪽"으로 붙는다는 성질은 지키고
 * 눕는 정도만 잡는 게 설계 의도이기 때문이다.
 *
 * 경계 처리:
 *   · 수평 성분이 ~0 → 방위를 정할 수 없으므로 (0,−1,0). dir 이 +Y(윗면 법선)로
 *     들어와도 여기서 수직으로 떨어진다.
 *   · dir.y ≥ 0 (옆면·윗면 법선) → 위 식이 그대로 45° 로 눕혀 준다. 이런 dir 은
 *     θ ≥ 90° 라 항상 포화 대상이다.
 *   · 길이 0/NaN → (0,−1,0). 호출 측이 못 걸러도 형상이 NaN 으로 터지지 않게.
 *
 * @param dir       접점에서 서포트 쪽으로 나가는 방향(정규화 불필요 — 여기서 함).
 * @param maxTiltDeg 한계각(deg). 보통 `HEAD_MAX_TILT_DEG`.
 * @returns 포화된 단위벡터.
 */
export function saturateHeadDir(dir: Vec3, maxTiltDeg: number): Vec3 {
  const down: Vec3 = [0, -1, 0];
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 0) || !Number.isFinite(len)) return down;
  const dx = dir[0] / len;
  const dy = dir[1] / len;
  const dz = dir[2] / len;

  const maxTilt = (maxTiltDeg * Math.PI) / 180;
  // 극각 θ = −Y 와 dir 의 사이각. cos θ = dir·(0,−1,0) = −dy.
  const cosTheta = Math.min(1, Math.max(-1, -dy));
  const theta = Math.acos(cosTheta);
  if (theta <= maxTilt) return [dx, dy, dz];

  const h = Math.hypot(dx, dz);
  if (h <= HEAD_HORIZONTAL_EPS) return down; // 방위 불명 → 수직.
  const s = Math.sin(maxTilt);
  const c = Math.cos(maxTilt);
  return [(dx / h) * s, -c, (dz / h) * s];
}

/**
 * **이 점의 화살촉을 접점 법선 방향으로 기울이는가** (S-4e-1). **순수 함수**.
 *
 * rebuild key(`support-keys.ts` `buildSupportKey` 의 법선 항목)와 조립
 * (`assemble-support.ts` `createRedesignSupportMesh` 의 headDir 게이트)이 **이 함수
 * 하나를 같이 부른다**. 두 판정이 갈리면 "형상은 바뀌었는데 key 가 그대로라 재조립
 * 누락" 또는 "형상은 같은데 key 만 달라져 헛재조립" 이 생기므로 조건을 한곳에 둔다.
 *
 * 세 조건이 모두 참일 때만 true:
 *   1) **재설계 점** — `kind` 가 'island' | 'slope'. 화살촉 조립 경로를 타는 종류가
 *      정확히 이 둘이다(`useSupportMeshSync.isRedesignPoint` 와 같은 기준).
 *      kind 'manual'·미지정(trunk/bridge/manual source) 점은 기존 `createSupportMesh`
 *      경로라 화살촉이 없다. 그 점들도 contactNormal 을 저장하지만(useSupportEditing
 *      — 시각화 구슬 lift 용) 여기서는 **절대 소비하지 않는다**.
 *   2) `params.headAlignNormal` 이 켜짐. (옛 저장 params 에 필드가 없으면 falsy → off.)
 *   3) 저장된 `contactNormal` 이 있음. 옛 데이터는 없으므로 종전 수직 폴백.
 *
 * 타입 가드라 true 분기에서 `point.contactNormal` 이 확정 타입으로 좁혀진다.
 */
export function usesHeadNormal<
  P extends Pick<SupportPointV2, "kind" | "contactNormal">,
>(
  point: P,
  params: Pick<SupportParams, "headAlignNormal">,
): point is P & { contactNormal: [number, number, number] } {
  return (
    (point.kind === "island" || point.kind === "slope") &&
    !!params.headAlignNormal &&
    point.contactNormal != null
  );
}

/**
 * **화살촉 접점(앞구슬+원뿔+뒷구슬) 조립** — 설계 4-1.
 *
 * S-4b-2c 에서 `assembleVerticalSupport` 안에 있던 블록을 **로직 무변경으로**
 * export 함수로 승격한 것이다(2a 가 행렬 유틸을 승격한 것과 같은 방식). 3단 폴백의
 * 경사·앵커·합류 경로(`assemble-route.ts`)도 접점은 똑같이 수직 화살촉이라, 같은
 * 코드를 복제하는 대신 하나를 공유한다 — 복제하면 접점 규약(침투 깊이·구슬 배치)이
 * 두 곳에서 갈릴 수 있다.
 *
 * 좌표는 **로컬 XZ 원점 기준 수직**(축 = Y). 호출 측이 XZ 로 평행이동한다.
 *
 * @param headLengthMm 화살촉 길이(축소 보정이 끝난 값 — 보정은 호출 측 책임).
 * @returns 뒷구슬 중심 Y(= 기둥이 시작되는 자리). 호출 측이 이어서 쓴다.
 */
export function appendArrowHead(
  parts: SupportPartsSet,
  spec: Pick<
    VerticalSupportSpec,
    "surfaceY" | "tipDiameterMm" | "headBackDiameterMm" | "contactPenetrationMm"
  >,
  headLengthMm: number,
  accPos: number[],
  accIdx: number[],
): number {
  const tipR = spec.tipDiameterMm * 0.5;
  // 앞구슬 중심 Y (설계 4-1: 꼭대기가 침투 깊이만큼 파고듦).
  const frontCenterY = spec.surfaceY + spec.contactPenetrationMm - tipR;
  // 뒷구슬 중심 Y = 앞구슬 중심에서 화살촉 길이만큼 아래.
  const backCenterY = frontCenterY - headLengthMm;

  // ── 앞구슬: sphere ⌀tip, 중심 frontCenterY ──────────────────────────────
  appendTransformed(
    parts.sphere,
    matMul(
      matTranslate(0, frontCenterY, 0),
      matScale(spec.tipDiameterMm, spec.tipDiameterMm, spec.tipDiameterMm),
    ),
    accPos,
    accIdx,
  );

  // ── 화살촉 원뿔: 밑면 ⌀headBack·높이 headLen, 꼭짓점=앞구슬 중심(위로 좁아짐) ─
  //   cone 로컬: 밑면 Z=0, 꼭짓점 Z=1. Z-up→Y-up 후 밑면은 Y=0·꼭짓점 Y=1.
  //   → 스케일 (headBack, headLen, headBack) 후 밑면 = backCenterY 로 이동하면
  //     꼭짓점이 backCenterY+headLen = frontCenterY 에 온다. (좁아짐 = 위.)
  appendTransformed(
    parts.cone,
    matMul(
      matTranslate(0, backCenterY, 0),
      matMul(
        matScale(spec.headBackDiameterMm, headLengthMm, spec.headBackDiameterMm),
        matZupToYup(),
      ),
    ),
    accPos,
    accIdx,
  );

  // ── 뒷구슬: sphere ⌀headBack, 중심 backCenterY ─────────────────────────
  appendTransformed(
    parts.sphere,
    matMul(
      matTranslate(0, backCenterY, 0),
      matScale(
        spec.headBackDiameterMm,
        spec.headBackDiameterMm,
        spec.headBackDiameterMm,
      ),
    ),
    accPos,
    accIdx,
  );

  return backCenterY;
}

/**
 * **법선 방향 화살촉 조립** (S-4e-1, 설계 4-1 "방향") — world 좌표.
 *
 * `appendArrowHead` 가 로컬 −Y 로 쌓는 것을 그대로 쓰되, 그 로컬 형상을
 * `headDir` 로 돌려 접점에 얹는다:
 *   ① 로컬에서 surfaceY=0 기준으로 정방향 화살촉을 만든다(−Y 로 뻗음).
 *   ② `rotationYToDir(−headDir)` 로 회전 — +Y 를 −headDir 로 보내므로 로컬의
 *      **−Y 축이 headDir** 로 간다. headDir=(0,−1,0) 이면 rotationYToDir((0,1,0))
 *      = 항등이라 **종전 수직 조립과 수치가 정확히 같다**(무회귀).
 *   ③ 접점 world 좌표로 평행이동.
 * 회전을 스케일 뒤에 두는 순서 규약은 assembleStrut 과 같다(비균일 스케일이
 * 회전과 섞이면 단면이 찌그러진다).
 *
 * @param headDir      **포화된**(45° 이내) 단위벡터. 포화는 호출 측 책임 —
 *                     이 함수는 방향을 그대로 믿는다.
 * @param headLengthMm 화살촉 길이(축소 보정이 끝난 값 — 보정은 호출 측 책임).
 * @returns 뒷구슬 중심의 **world 좌표**(= 기둥·다리가 시작되는 자리).
 */
export function appendArrowHeadDir(
  parts: SupportPartsSet,
  spec: Pick<
    VerticalSupportSpec,
    "tipDiameterMm" | "headBackDiameterMm" | "contactPenetrationMm"
  >,
  headLengthMm: number,
  contactWorld: Vec3,
  headDir: Vec3,
  accPos: number[],
  accIdx: number[],
): Vec3 {
  // ① 로컬(접점 원점, 축 −Y) 화살촉.
  const localPos: number[] = [];
  const localIdx: number[] = [];
  appendArrowHead(
    parts,
    { ...spec, surfaceY: 0 },
    headLengthMm,
    localPos,
    localIdx,
  );

  // ② 로컬 −Y → headDir 회전, ③ 접점으로 이동.
  const m = matMul(
    matTranslate(contactWorld[0], contactWorld[1], contactWorld[2]),
    rotationYToDir([-headDir[0], -headDir[1], -headDir[2]]),
  );
  appendTransformed(
    { positions: new Float32Array(localPos), indices: new Uint32Array(localIdx) },
    m,
    accPos,
    accIdx,
  );

  // 뒷구슬 중심 = 접점에서 headDir 로 (화살촉 길이 + 앞구슬 반경 − 침투 깊이).
  //   로컬 backCenterY = (contactPenetration − tipR) − headLen 이고, 로컬 −Y 가
  //   headDir 이므로 world 이동량은 그 절댓값 = headLen + tipR − contactPenetration.
  const tipR = spec.tipDiameterMm * 0.5;
  const d = headLengthMm + tipR - spec.contactPenetrationMm;
  return [
    contactWorld[0] + headDir[0] * d,
    contactWorld[1] + headDir[1] * d,
    contactWorld[2] + headDir[2] * d,
  ];
}

/**
 * 화살촉 수직 서포트 조립 (설계 4-1/4-2). 로컬 XZ 원점 기준 수직(축 = Y).
 *
 * 위(모델 표면)→아래(바닥) 순서, y 좌표는 로컬:
 *  - 앞구슬(설계 4-1): sphere 를 ⌀tip 으로 스케일, 중심 Y =
 *      surfaceY + contactPenetrationMm − tipRadius. 구 꼭대기가 표면을 침투
 *      깊이만큼 파고든다.
 *  - 화살촉 원뿔(4-1): cone 을 밑면 ⌀headBack·높이 headLengthMm 로, 꼭짓점이
 *      앞구슬 중심에 오도록(위로 좁아짐). cone 로컬은 밑면 Z=0·꼭짓점 Z=1 →
 *      Z-up→Y-up 회전으로 밑면 아래(뒷구슬쪽)·꼭짓점 위(앞구슬쪽)에 놓인다.
 *  - 뒷구슬(4-1): sphere 를 ⌀headBack 으로, 중심 = 원뿔 밑면 중심.
 *  - 기둥(4-2): cylinder 를 ⌀trunk 로, 뒷구슬 중심 → baseY(플레이트)까지. 발
 *      원뿔과 겹치게 baseY 까지 내려 접합부 단면적 0 수렴을 막는다(리뷰 #1).
 *  - 바닥 발(4-2 전이): cone 을 넓은 밑면 ⌀base 가 Y=baseY(플레이트)에 닿고 위로
 *      좁아져 기둥에 연결. 높이 baseTransitionMm (기둥과 겹침, union 무해).
 *
 * 총 높이(surfaceY−baseY)가 baseTransitionMm+headLengthMm 보다 작으면 화살촉+
 * 바닥 전이 구간을 비례 축소(기존 createSupportMesh 의 0.95 축소 패턴 참고).
 */
export function assembleVerticalSupport(
  parts: SupportPartsSet,
  spec: VerticalSupportSpec,
): SupportPartsGeometry {
  const accPos: number[] = [];
  const accIdx: number[] = [];

  const trunkD = spec.trunkDiameterMm;
  const baseD = spec.baseDiameterMm;

  // 형상 축소: 총 높이가 (바닥 전이 + 화살촉 길이) 보다 작으면 두 구간을 비례
  //   축소한다. (기존 createSupportMesh 의 0.95 축소 패턴과 동일한 취지.)
  const total = spec.surfaceY - spec.baseY;
  let headLen = spec.headLengthMm;
  let baseTrans = spec.baseTransitionMm;
  const need = baseTrans + headLen;
  if (need > 0 && total > 0 && need >= total) {
    const scale = (total / need) * 0.95;
    headLen *= scale;
    baseTrans *= scale;
  }

  // ── 화살촉(앞구슬+원뿔+뒷구슬) ─────────────────────────────────────────
  //   S-4b-2c 에서 위 `appendArrowHead` 로 승격 — **로직 무변경**(같은 순서·같은
  //   행렬). 반환값이 종전의 backCenterY 다.
  //
  //   ★ S-4e-1: headDir 이 수직(0,−1,0) 이 아니면 화살촉만 그 방향으로 기울이고
  //     (`appendArrowHeadDir`) 기둥·발은 **뒷구슬 바로 아래**로 옮겨 세운다.
  //     프루사 기본형과 같은 배치다 — 헤드가 법선으로 붙고, 그 접합점에서 기둥이
  //     곧장 수직으로 내려간다(연구 정독 2절 ①PINHEADS).
  //     headDir 미지정/수직이면 **종전 코드 경로 그대로**라 positions 바이트가
  //     동일하다(무회귀).
  //
  //     ⚠️ 알려진 한계 — 라우팅(route-plan / route-cluster)은 기울임을 모르고
  //     **접점 XZ 기준**으로 경로를 정해 두었다. 기울이면 조립 쪽 시작점만
  //     뒷구슬(접점에서 최대 headLen·sin45° ≈ 0.71mm 비껴남)로 옮겨 가므로:
  //       (a) joinPillar 합류점(junction)은 **옛 접점 XZ 기준**으로 잡힌 좌표라,
  //           중심점 기둥이 뒷구슬 아래로 옮겨가면 합류 다리 끝이 기둥 축에서
  //           벗어나 합류부 겹침이 부족해진다(45° 에서 단면의 수 % 수준).
  //       (b) bent/anchor/joinPillar 의 **첫 다리**는 라우팅이 가정한 접점 XZ 가
  //           아니라 기울어진 뒷구슬에서 출발한다(assemble-route). 그래서 다리
  //           각이 45° 를 넘을 수 있고, 그 선분은 충돌 검사를 받지 않았다.
  //       (c) 그래서 `headAlignNormal` 기본값은 **off** 다(utils/defaults.ts).
  //     정석 수정(점별 시작점을 라우팅에 반영)은 후속 S-4e-1b 몫이다.
  let backCenterY: number;
  let pillarX = 0;
  let pillarZ = 0;
  const rawDir = spec.headDir;
  const tilted =
    rawDir != null && !(rawDir[0] === 0 && rawDir[1] === -1 && rawDir[2] === 0);
  if (tilted && rawDir) {
    const headDir = saturateHeadDir(rawDir, HEAD_MAX_TILT_DEG);
    const back = appendArrowHeadDir(
      parts,
      spec,
      headLen,
      [0, spec.surfaceY, 0],
      headDir,
      accPos,
      accIdx,
    );
    pillarX = back[0];
    backCenterY = back[1];
    pillarZ = back[2];
  } else {
    backCenterY = appendArrowHead(parts, spec, headLen, accPos, accIdx);
  }

  // ── 기둥: cylinder ⌀trunk, 뒷구슬 중심(backCenterY) → baseY(플레이트) ─────
  //   cylinder 로컬 Z 0→1 → Y-up 후 Y 0→1. 높이 = backCenterY − baseY.
  //   ★ footTopY 가 아니라 baseY 까지 세워 발 원뿔과 겹치게 한다(리뷰 수정 #1).
  //     발 cone 은 footTopY 에서 꼭짓점(⌀0)으로 끝나 기둥과 점 접합이 되면
  //     그 구간(발 위쪽 ~baseTrans)이 ⌀trunk 보다 가늘어져 슬라이스 단면적 0
  //     근접 → 출력 파단. 기둥을 baseY 까지 내려 발과 겹치면 슬라이스 union 이
  //     둘을 합쳐 footTopY 근방 단면이 항상 ≥ ⌀trunk 로 유지된다(중복 솔리드
  //     무해 — 기존 검증에서 확인된 사실).
  const trunkH = Math.max(backCenterY - spec.baseY, 1e-4);
  appendTransformed(
    parts.cylinder,
    matMul(
      // S-4e-1: 기울지 않은 경우 pillarX/Z 는 0 이라 종전과 동일한 행렬이다.
      matTranslate(pillarX, spec.baseY, pillarZ),
      matMul(matScale(trunkD, trunkH, trunkD), matZupToYup()),
    ),
    accPos,
    accIdx,
  );

  // ── 바닥 발: 넓은 밑면 ⌀base 가 Y=baseY(플레이트), 위로 좁아져 기둥에 연결 ──
  //   설계 4-2 전이: "넓은 면이 아래". cone 로컬 밑면 Z=0·꼭짓점 Z=1 →
  //   Z-up→Y-up 후 밑면 Y=0·꼭짓점 Y=+1. 스케일 (base, baseTrans, base) 후 Y
  //   이동 baseY: 밑면(넓음) = baseY, 꼭짓점(좁음) = baseY+baseTrans = footTopY.
  //   → 플레이트에 넓게 닿고 위로 좁아져 ⌀trunk 기둥에 이어진다.
  appendTransformed(
    parts.cone,
    matMul(
      matTranslate(pillarX, spec.baseY, pillarZ),
      matMul(matScale(baseD, baseTrans, baseD), matZupToYup()),
    ),
    accPos,
    accIdx,
  );

  return {
    positions: new Float32Array(accPos),
    indices: new Uint32Array(accIdx),
  };
}
