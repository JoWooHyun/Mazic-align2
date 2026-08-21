// 서포트 재설계(S-4b-2c) **빔 충돌 검사 구현** — 자체 삼각형 인덱스 기반 BeamProbe.
//   설계 `docs/설계_서포트재설계_20260720.md` 4-5(충돌 회피),
//   연구 `docs/연구_프루사서포트_정독_20260811.md` 3절(beam_mesh_hit) / 7절 항목 3,
//   재작업 근거 `docs/피드백_2c실물테스트_20260821.md` T-1·T-2.
//   ⚠️ 프루사는 AGPL — 개념만 채택(클린룸).
//
//   ## ★ 왜 Babylon 레이캐스트를 버렸나 (S-4b-2c-f 재작업)
//   2c 는 `Ray.intersectsMesh` 를 썼다. 세 가지 이유로 자체
//   `triangle-index.ts`(균일 격자 + 3D-DDA)로 갈아탔다:
//
//   1. **성능 = 실물 팅김(T-2).** `intersectsMesh` 는 가속 구조 없이 메시의 전
//      삼각형을 훑는다. bent 점 하나가 최대 ~2,700발을 쏘고 실패 점은 전수 탐색이라,
//      삼각형 수십만짜리 모델에서 각도에 따라 수백억 번의 삼각형 테스트가 되어
//      생성 버튼에 탭이 죽었다(리드 실물 확인).
//   2. **isPickable 함정이 원천 무관해졌다.** 2c 가 `scene.pickWithRay` 대신
//      `intersectsMesh` 를 고른 이유가 `_internalPick` 의 isPickable 게이트였는데,
//      이제 Babylon 을 아예 안 거치므로 그 함정 자체가 사라졌다.
//   3. **뒷면 판정을 신뢰할 수 있다.** 입력이 `extractWorldTriangles`(B-7 감김
//      정규화 관문) 출력이라 기하 법선이 바깥임을 전제할 수 있고, 인덱스가 det
//      부호로 앞/뒷면을 직접 돌려준다. pick 의 법선 보간·양면 판정에 기대지 않는다.
//
//   부수 효과가 하나 더 있다 — 이 파일이 **순수 모듈이 되어** 프로브의 실동작을
//   헤드리스로 전수 검증할 수 있다(`scripts/verify-collision-probe.mjs`).
//   2c 검수에서 사각지대로 남았던 부분이다.
//
//   ## 근사 방식 (설계 4-5 "굵은 막대를 몇 가닥 광선으로")
//   막대의 부피 충돌을 정확히 풀지 않는다. 중심 광선 1개 + 둘레 링 광선 N개를
//   반경+안전거리만큼 벌려 쏘고 **최소 히트 거리**를 채택한다. 광선이 성기면 좁은
//   돌기 사이를 스쳐 지나갈 수 있지만, 안전거리(0.5mm)가 그 오차를 흡수한다.

import { buildTriangleIndex, type TriangleIndex } from "./triangle-index";
import type { BeamProbe, Vec3 } from "./route-plan";

/**
 * 링 광선 개수 — 설계 4-5 "8~16개", 연구 3절 "8이면 거의 되나 드문 충돌, 16은 60% 느림".
 *   1차는 **8 고정**. 접점 주변만 16 으로 올리는 프루사식 세분은 하지 않는다 —
 *   우리는 빔 시작점을 화살촉 아래로 내려(route-plan headClearanceMm) 접점 근방을
 *   애초에 검사 구간에서 빼기 때문에 그 자리에서 촘촘히 쏠 이유가 적다.
 */
const RING_RAY_COUNT = 8;

/**
 * 안전거리 (mm) — 설계 4-5 값. 광선 근사가 놓치는 좁은 형상을 이 여유가 덮는다.
 *   막대 표면과 모델 사이에 이만큼 틈을 요구하는 셈이라, 출력 시 서포트가 모델
 *   표면을 스치는 것도 함께 막는다.
 */
const DEFAULT_SAFETY_DIST_MM = 0.5;

/**
 * "시작점이 모델 내부" 로 볼 관통 거리 상한의 **기본값** (mm) — T-1 수정.
 *
 * ## 왜 0.4 인가 (2c 의 1.0 에서 축소)
 * 이 허용치의 설계 의도는 **화살촉 침투(contactPenetrationMm = 0.2mm)** 처럼
 * 접점이 표면에 의도적으로 얕게 박힌 경우만 용서하는 것이다. 그 2배인 0.4mm 를
 * 여유로 잡는다 — 스냅 오차·부동소수 잡음까지 덮으면서, 그보다 깊은 겹침은
 * 걸러낸다.
 * 2c 의 1.0mm 는 이 의도보다 5배 관대해서, 경사면·벽면 접점의 기둥이 표면에
 * ~1mm 파묻혀도 "청명" 판정을 받았다. 리드 실물 확인 결과 그만큼 파묻힌 기둥은
 * 표면 흠집으로 나타난다(`docs/피드백_2c실물테스트_20260821.md` T-1, 사진).
 */
const DEFAULT_INSIDE_TOLERANCE_MM = 0.4;

/**
 * 내부 히트에서 재발사할 때 진입점을 넘겨 밀어내는 여유 (mm).
 *   0 이면 같은 삼각형을 다시 맞아 무한 루프가 된다.
 */
const REEMIT_EPS_MM = 0.01;

/**
 * 한 광선당 내부 재발사 최대 횟수.
 *   얇은 벽을 여러 겹 지나는 경우를 위해 몇 번은 허용하되, 병적인 메시(자기교차·
 *   뒤집힌 법선)에서 루프가 폭주하지 않도록 상한을 둔다. 초과하면 **보수적으로**
 *   거리 0(막힘)을 돌려준다 — 판정이 애매하면 서포트를 안 세우는 쪽이 안전하다.
 */
const MAX_REEMIT = 4;

/** `makeTriangleBeamProbe` 옵션. */
export interface TriangleBeamProbeOptions {
  /** 링 광선 개수. 기본 8. */
  ringRayCount?: number;
  /** 안전거리 (mm). 기본 0.5. */
  safetyDistMm?: number;
  /**
   * 시작점이 "모델 내부" 로 판정되는 관통 거리 상한 (mm). 기본 0.4.
   *   위 `DEFAULT_INSIDE_TOLERANCE_MM` 주석의 근거 참고. 검증 스크립트가 구 동작
   *   (1.0)을 재현해 대조하는 데도 쓴다.
   */
  insideToleranceMm?: number;
  /** 격자 셀 크기 (mm). 미지정이면 인덱스가 bbox·삼각형 수에서 유도한다. */
  cellSizeMm?: number;
}

/**
 * world 삼각형 배열 하나를 대상으로 하는 `BeamProbe` 를 만든다.
 *
 * 대상이 STL **1개**인 이유: 프루사도 자기 메시만 검사한다(연구 3절). 다른
 * 오브젝트나 다른 서포트와의 충돌은 이 단계의 관심사가 아니다.
 *
 * @param triangles 호출 측이 `extractWorldTriangles(mesh)` 로 뽑아 넘긴 world
 *                  삼각형 배열(삼각형당 9 float). 그 함수가 감김을 정규화하므로
 *                  뒷면 판정을 신뢰할 수 있다(파일 머리 주석 3).
 */
export function makeTriangleBeamProbe(
  triangles: Float32Array,
  opts: TriangleBeamProbeOptions = {},
): BeamProbe {
  const ringCount = Math.max(opts.ringRayCount ?? RING_RAY_COUNT, 0);
  const safety = Math.max(opts.safetyDistMm ?? DEFAULT_SAFETY_DIST_MM, 0);
  const insideTol = Math.max(opts.insideToleranceMm ?? DEFAULT_INSIDE_TOLERANCE_MM, 0);
  const index = buildTriangleIndex(triangles, opts.cellSizeMm);

  return {
    hitDistance(from: Vec3, dir: Vec3, radiusMm: number, maxDistMm: number): number | null {
      if (!(maxDistMm > 0)) return null;
      const d = normalize(dir);
      if (!d) return null;

      // 광선을 벌려 놓을 오프셋 반경 = 막대 반경 + 안전거리.
      const offsetR = Math.max(radiusMm, 0) + safety;
      const { u, v } = orthonormalBasis(d);

      let best: number | null = null;
      // 중심 광선(오프셋 0) + 링 광선 ringCount 개.
      for (let i = -1; i < ringCount; i++) {
        let ox = 0;
        let oy = 0;
        let oz = 0;
        if (i >= 0 && offsetR > 0) {
          const a = (2 * Math.PI * i) / ringCount;
          const cu = Math.cos(a) * offsetR;
          const cv = Math.sin(a) * offsetR;
          ox = u[0] * cu + v[0] * cv;
          oy = u[1] * cu + v[1] * cv;
          oz = u[2] * cu + v[2] * cv;
        }
        const origin: Vec3 = [from[0] + ox, from[1] + oy, from[2] + oz];
        const hit = castOne(index, origin, d, maxDistMm, insideTol);
        if (hit !== null) {
          // 링 광선은 시작점이 옆으로 밀려 있지만, 막대 축 기준 진행 거리로 보면
          //   같은 파라미터 t 라 그대로 비교해도 된다(오프셋이 축에 수직이므로).
          if (best === null || hit < best) best = hit;
          if (best <= 0) return 0; // 더 볼 것 없음.
        }
      }
      return best;
    },
  };
}

/**
 * 광선 1가닥 — 내부 시작 재발사 포함 (연구 3절).
 *
 * @param insideTol 시작점이 내부로 판정되는 관통 거리 상한 (mm).
 * @returns 첫 **유효** 히트까지의 거리, 청명이면 null. 시작점이 모델 내부로
 *          판정되면 0(즉시 막힘).
 */
function castOne(
  index: TriangleIndex,
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  insideTol: number,
): number | null {
  let traveled = 0;
  const o: Vec3 = [origin[0], origin[1], origin[2]];

  for (let attempt = 0; attempt <= MAX_REEMIT; attempt++) {
    const remain = maxDist - traveled;
    if (remain <= 0) return null;

    const hit = index.raycast(o, dir, remain);
    if (hit === null) return null;

    if (!hit.backface) {
      // 앞면 히트 = 정상적으로 바깥에서 모델에 부딪혔다.
      return traveled + hit.distance;
    }

    // 뒷면 히트 = 이 구간은 **모델 내부**를 지나왔다는 뜻(연구 3절 is_inside).
    //   시작점부터 이 exit 까지의 거리가 허용치를 넘으면 시작점 자체가 내부
    //   깊숙이 있다고 보고 즉시 실패(거리 0). 짧으면 화살촉 침투(0.2mm) 같은
    //   얕은 겹침이라 빠져나온 지점에서 다시 쏜다.
    if (traveled + hit.distance > insideTol) return 0;

    traveled += hit.distance + REEMIT_EPS_MM;
    o[0] = origin[0] + dir[0] * traveled;
    o[1] = origin[1] + dir[1] * traveled;
    o[2] = origin[2] + dir[2] * traveled;
  }
  // 재발사 상한 초과 — 병적인 메시. 보수적으로 막힘.
  return 0;
}

/** 벡터 정규화. 길이 0 이면 null. */
function normalize(v: Vec3): Vec3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 0)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * d 에 수직인 정규직교 기저 (u, v) — 링 광선을 배치할 평면.
 *   d 와 가장 안 나란한 축을 골라 외적한다(평행 선택 시 0 벡터가 되는 것 방지).
 */
function orthonormalBasis(d: Vec3): { u: Vec3; v: Vec3 } {
  const ax: Vec3 =
    Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(ax, d)) ?? [1, 0, 0];
  const v = normalize(cross(d, u)) ?? [0, 0, 1];
  return { u, v };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
