// 임의 방향 막대·접합 구 조립 프리미티브 (S-4b-2a, B안). **순수 모듈 — Babylon import 금지.**
//   assemble-core.ts 가 수직 전용(Pillar) 조립이라면, 이 파일은 **임의 두 점을
//   잇는 막대(Bridge)** 와 **꺾임점 구(Junction)** 를 만든다. S-4b-2 의 소비자는
//   전부 이 두 개로 형상을 짠다:
//     · 4-4 2단 — 경사 다리로 옆으로 피해 하강
//     · 4-6    — 기둥끼리 지그재그 연결(좌굴 방지)
//     · 4-4 3단 — 모델 표면 앵커(뒤집힌 접점까지의 다리)
//   이 PR(2a)은 **프리미티브만** 추가한다. 소비자 배선(폴백 판정·충돌 회피·기둥
//   공유)은 후속 조각(2b~) 몫이라 기존 서포트 경로는 이 파일을 아직 부르지 않는다.
//
//   설계서 `docs/설계_서포트재설계_20260720.md` 4-3(구조각 45°)·4-4(3단 폴백)·
//   4-6(기둥 연결) 이 소비자. 개념 참고 `docs/연구_프루사서포트_정독_20260811.md`
//   6장 — 프루사도 "단위 실린더를 두 벡터 회전으로 배치 + 꺾임마다 Junction 구"
//   구조다. **개념만 참고했고 코드는 이식하지 않았다(AGPL, 클린룸).**
//
//   좌표계: assemble-core 와 동일한 조립 로컬 좌표(Y-up). 부품 STL 은 Z-up 이라
//   각 함수가 Z-up→Y-up 회전을 먼저 먹인 뒤 목표 축으로 다시 돌린다.

import {
  appendTransformed,
  matMul,
  matScale,
  matTranslate,
  matZupToYup,
  rotationYToDir,
  type SupportPartsGeometry,
  type SupportPartsSet,
  type Vec3,
} from "./assemble-core";

// S-4e-1: `Vec3` 와 `rotationYToDir` 는 assemble-core 로 옮겼다 — 화살촉 법선
//   부착이 core 에서 같은 회전 유틸을 쓰는데, core → strut import 는 순환이기
//   때문이다. 정의는 core 하나뿐이고 여기서는 **그대로 재수출**하므로 기존
//   import 경로(`./assemble-strut`)와 동작은 변함이 없다(무회귀).
export { rotationYToDir, type Vec3 } from "./assemble-core";

/**
 * 길이 0 막대로 볼 임계(mm). 이보다 짧으면 축 방향을 정의할 수 없다.
 *   레이어 두께(50µm)의 1/50 인 1e-3mm — 왕복 부동소수 노이즈(1e-5급, assemble-core
 *   의 PLATE_CONTACT_EPS_MM 주석 참고)보다는 위, 실제 다리 길이(최소 수백 µm)
 *   보다는 아래라 양쪽에 여유가 있다.
 */
const MIN_STRUT_LENGTH_MM = 1e-3;

/** 빈 지오메트리 (길이 0 막대 등 퇴화 입력의 반환값). */
function emptyGeometry(): SupportPartsGeometry {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

/** 벡터 정규화. 길이가 0 에 가까우면 null. */
function normalize(v: Vec3): { dir: Vec3; length: number } | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < MIN_STRUT_LENGTH_MM) return null;
  return { dir: [v[0] / length, v[1] / length, v[2] / length], length };
}

/**
 * **임의 두 점을 잇는 원기둥 막대** (설계 4-4 2단 경사 다리 / 4-6 기둥 연결).
 *
 * 부품 cylinder(⌀1.0, Z 0→1)를 스케일 → Z-up→Y-up → 목표 축 회전 → from 이동
 * 순으로 배치한다(B안 = 부품 조립 유지, 새 지오메트리 생성 없음).
 *
 * 변환 합성 순서(열벡터 규약이라 **오른쪽부터** 적용):
 *   T(from) · R(+Y→dir) · S(radius·2, length, radius·2) · Rzy
 *   ① Rzy   : 부품 Z-up → 조립 Y-up. 부품이 Y 0→1 로 선다.
 *   ② S     : XZ 를 지름(=2r)으로, Y 를 |to−from| 로. 단위 부품이 ⌀1 이라
 *             지름을 곱해야 반경이 r 이 된다(assemble-core 의 기둥과 동일 규약).
 *   ③ R     : +Y 축을 from→to 방향으로 돌린다. **스케일 뒤에 회전** — 순서가
 *             뒤바뀌면 비균일 스케일이 회전과 섞여 단면이 타원으로 찌그러진다.
 *   ④ T     : 아래 끝 단면 중심을 from 으로.
 * 결과: 양 끝 단면 중심이 정확히 from / to, 축 방향 = (to−from) 정규화, 축에
 * 수직인 단면 반경 = radiusMm.
 *
 * @param parts    부품 세트(소비자가 주입 — 인터페이스 그대로 유지).
 * @param from     막대 시작점 (아래 끝 단면 중심).
 * @param to       막대 끝점 (위 끝 단면 중심).
 * @param radiusMm 막대 반경(mm). 지름이 아니라 **반경**.
 * @returns 병합 지오메트리. from≈to(길이 < 1e-3mm) 이면 빈 지오메트리.
 */
export function assembleStrut(
  parts: SupportPartsSet,
  from: Vec3,
  to: Vec3,
  radiusMm: number,
): SupportPartsGeometry {
  const n = normalize([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  // 길이 0 막대는 축을 정의할 수 없다 — 조용히 빈 형상. (소비자가 두 점을 붙여
  //   보낸 경우로, 접합 구만 남으면 형상상 문제 없다.)
  if (!n) return emptyGeometry();

  const diameter = radiusMm * 2;
  const accPos: number[] = [];
  const accIdx: number[] = [];

  appendTransformed(
    parts.cylinder,
    matMul(
      matTranslate(from[0], from[1], from[2]),
      matMul(
        rotationYToDir(n.dir),
        matMul(matScale(diameter, n.length, diameter), matZupToYup()),
      ),
    ),
    accPos,
    accIdx,
  );

  return {
    positions: new Float32Array(accPos),
    indices: new Uint32Array(accIdx),
  };
}

/**
 * **꺾임점 구(Junction)** — 막대·기둥이 각도로 만나는 접합부를 덮는다.
 *
 * ## 왜 필요한가 (S-4b-1 파단 이슈의 일반해)
 * 두 막대가 θ 로 만나면, 접합부 근처 슬라이스 단면이 두 원기둥의 합집합인데
 * 꺾임이 클수록 그 겹침이 얇아져 **단면적이 막대 단면보다 작아지는 구간**이
 * 생긴다 → 출력 중 그 층에서 끊어진다(파단). assemble-core 의 발↔기둥 접합에서
 * 이미 겪은 문제(기둥을 baseY 까지 겹쳐 내려 해결)의 일반형이다.
 *
 * ## 왜 구 하나면 되는가
 * 반경 R 의 구를 접합점 중심에 두면, 접합점에서 거리 R 이내의 **모든 방향**이
 * 솔리드로 채워진다. 막대 반경 r 인 두 막대가 어떤 각도로 만나든 접합점 주변
 * 반경 r 구간은 구가 통째로 덮으므로, **R ≥ r 이면 꺾임각과 무관하게** 접합부
 * 임의 단면이 최소한 구의 단면만큼은 확보된다 — 각도별 계산이 필요 없다.
 * (검증 스크립트가 45°·90° 꺾임에서 이를 수치로 확인한다.)
 *
 * @param parts    부품 세트.
 * @param center   접합점 (구 중심).
 * @param radiusMm 구 반경(mm). 보통 잇는 막대 반경 이상으로 준다.
 * @returns 병합 지오메트리. radiusMm ≤ 0 이면 빈 지오메트리.
 */
export function assembleJunctionSphere(
  parts: SupportPartsSet,
  center: Vec3,
  radiusMm: number,
): SupportPartsGeometry {
  if (!(radiusMm > 0)) return emptyGeometry();

  const accPos: number[] = [];
  const accIdx: number[] = [];
  const diameter = radiusMm * 2; // 단위 구가 ⌀1.0 이라 지름을 곱한다.

  appendTransformed(
    parts.sphere,
    matMul(
      matTranslate(center[0], center[1], center[2]),
      matScale(diameter, diameter, diameter),
    ),
    accPos,
    accIdx,
  );

  return {
    positions: new Float32Array(accPos),
    indices: new Uint32Array(accIdx),
  };
}

/**
 * **꺾임 경로 조립** — waypoints 를 순서대로 잇는 막대 + 꺾임마다 Junction 구.
 *
 * 4-4 2단(경사 다리로 비껴 내려가 다시 수직 하강)의 결과가 딱 이 형태다:
 *   [접점 아래] → [꺾임] → [비껴간 지점] → [꺾임] → [플레이트]
 * 소비자(2c)가 폴백 경로를 점 목록으로만 내면 형상 조립은 이 함수 한 번으로
 * 끝나도록 묶어 둔다. 개별 함수를 직접 부르는 것과 결과가 동일하되, **꺾임마다
 * 구를 빠뜨리지 않는다**는 보장을 함수 쪽에 두는 게 목적이다 — 빠뜨리면 파단이
 * 슬라이스 단계에서야 드러나 원인 추적이 비싸다.
 *
 * 양 끝점에는 구를 넣지 않는다. 끝은 다른 부품(화살촉 뒷구슬·바닥 발·기둥)이
 * 이어받는 자리라 여기서 구를 박으면 중복이고, 무엇이 이어지는지는 소비자만
 * 안다. 중간 꺾임점에만 넣는다.
 *
 * @param parts     부품 세트.
 * @param waypoints 경로 점 목록(순서대로). 2개 미만이면 빈 지오메트리.
 * @param radiusMm  막대 반경(mm). 꺾임 구 반경도 같은 값 — 위 4-3 단일 파라미터
 *                  정신대로 굵기를 하나로 두고, R = r 이면 파단 방지 조건
 *                  (R ≥ r)을 만족한다.
 * @returns 전 구간이 병합된 단일 지오메트리.
 */
export function assembleBentPath(
  parts: SupportPartsSet,
  waypoints: Vec3[],
  radiusMm: number,
): SupportPartsGeometry {
  if (waypoints.length < 2) return emptyGeometry();

  const accPos: number[] = [];
  const accIdx: number[] = [];

  /** 조립 결과 하나를 누적 배열에 그대로 이어붙인다(indices 오프셋 재부여). */
  const append = (geo: SupportPartsGeometry): void => {
    const vbase = accPos.length / 3;
    for (let i = 0; i < geo.positions.length; i++) accPos.push(geo.positions[i]);
    for (let i = 0; i < geo.indices.length; i++) accIdx.push(geo.indices[i] + vbase);
  };

  for (let i = 0; i < waypoints.length - 1; i++) {
    append(assembleStrut(parts, waypoints[i], waypoints[i + 1], radiusMm));
  }
  // 중간 꺾임점(양 끝 제외)에만 접합 구.
  for (let i = 1; i < waypoints.length - 1; i++) {
    append(assembleJunctionSphere(parts, waypoints[i], radiusMm));
  }

  return {
    positions: new Float32Array(accPos),
    indices: new Uint32Array(accIdx),
  };
}
