// 서포트 재설계(S-4b-2c) **빔 충돌 검사 구현** — Babylon 레이캐스트 기반 BeamProbe.
//   설계 `docs/설계_서포트재설계_20260720.md` 4-5(충돌 회피),
//   연구 `docs/연구_프루사서포트_정독_20260811.md` 3절(beam_mesh_hit) / 7절 항목 3.
//   ⚠️ 프루사는 AGPL — 개념만 채택(클린룸).
//
//   ## 이 파일의 위치
//   판정 로직(`route-plan.ts`)은 Babylon 무의존 순수 모듈이고, 실제 메시와 부딪히는
//   부분만 여기 격리한다. 그래서 이 파일은 **Babylon 을 쓰는 유일한 서포트 기하 파일**
//   이며, 검증 스크립트는 이 자리에 합성 probe 를 끼워 순수 로직을 전수 검증한다.
//
//   ## 근사 방식 (설계 4-5 "굵은 막대를 몇 가닥 광선으로")
//   막대의 부피 충돌을 정확히 풀지 않는다. 중심 광선 1개 + 둘레 링 광선 N개를
//   반경+안전거리만큼 벌려 쏘고 **최소 히트 거리**를 채택한다. 광선이 성기면 좁은
//   돌기 사이를 스쳐 지나갈 수 있지만, 안전거리(0.5mm)가 그 오차를 흡수한다.

import { Ray, Vector3, type AbstractMesh, type Scene } from "@babylonjs/core";
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

/** `makeStlBeamProbe` 옵션. */
export interface StlBeamProbeOptions {
  /** 링 광선 개수. 기본 8. */
  ringRayCount?: number;
  /** 안전거리 (mm). 기본 0.5. */
  safetyDistMm?: number;
}

/**
 * 활성 STL 메시 하나를 대상으로 하는 `BeamProbe` 를 만든다.
 *
 * 대상이 STL **1개**인 이유: 프루사도 자기 메시만 검사한다(연구 3절). 다른
 * 오브젝트나 다른 서포트와의 충돌은 이 단계의 관심사가 아니다.
 *
 * ## ★ 왜 `scene.pickWithRay` 가 아니라 `ray.intersectsMesh` 인가 (실 API 확인)
 * Babylon 소스를 직접 확인한 결과:
 *   · `Scene.prototype._internalPick`(Culling/ray.js)은 `!mesh.isEnabled() ||
 *     !mesh.isVisible || !mesh.isPickable` 인 메시를 **건너뛴다**. STL 메시의
 *     `isPickable` 은 편집 모드에 따라 바뀌므로, pickWithRay 를 쓰면 모드에 따라
 *     충돌 검사가 조용히 "전부 청명"이 되는 사고가 난다.
 *   · `Ray.intersectsMesh` → `mesh.intersects` 는 그 게이트를 거치지 않는다.
 * 그래서 `intersectsMesh` 를 직접 쓴다.
 *
 * ## ★ 뒷면(내부) 히트 검출 — 확인 결과 별도 조치 불필요
 * `Ray.intersectsTriangle`(Culling/ray.js)의 Möller–Trumbore 구현은 판별식 det 의
 * **부호를 보지 않는다**(det === 0 만 배제). 즉 **양면 검출**이라 뒤집힌 면·내부에서
 * 나가는 면도 그대로 히트로 잡힌다. `sideOrientation` 이나 `fastCheck` 를 만질
 * 필요가 없다. (fastCheck 는 "가장 가까운 히트" 대신 "첫 히트"를 쓰는 옵션이라
 * 여기서는 기본값 = 가장 가까운 히트를 그대로 쓴다.)
 * 내부 판정은 히트 면 법선과 광선 방향의 **내적 부호**로 한다 — 양수면 광선이
 * 면의 뒤에서 앞으로 나가는 것, 곧 그 구간이 모델 내부였다는 뜻이다.
 */
export function makeStlBeamProbe(
  scene: Scene,
  stlMesh: AbstractMesh,
  opts: StlBeamProbeOptions = {},
): BeamProbe {
  const ringCount = Math.max(opts.ringRayCount ?? RING_RAY_COUNT, 0);
  const safety = Math.max(opts.safetyDistMm ?? DEFAULT_SAFETY_DIST_MM, 0);
  stlMesh.computeWorldMatrix(true);
  // scene 은 현재 직접 쓰지 않지만(intersectsMesh 가 메시만 본다), 호출 규약상
  //   씬 수명과 묶어 두는 편이 오용을 줄인다. 참조만 유지.
  void scene;

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
        const hit = castOne(stlMesh, origin, d, maxDistMm);
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
 * @returns 첫 **유효** 히트까지의 거리, 청명이면 null. 시작점이 모델 내부로
 *          판정되면 0(즉시 막힘).
 */
function castOne(
  mesh: AbstractMesh,
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
): number | null {
  let traveled = 0;
  const o = new Vector3(origin[0], origin[1], origin[2]);
  const dv = new Vector3(dir[0], dir[1], dir[2]);

  for (let attempt = 0; attempt <= MAX_REEMIT; attempt++) {
    const remain = maxDist - traveled;
    if (remain <= 0) return null;

    const ray = new Ray(o.clone(), dv, remain);
    const pick = ray.intersectsMesh(mesh);
    if (!pick.hit || pick.pickedPoint == null) return null;

    const dist = pick.distance;
    const normal = pick.getNormal(true, false);
    // 법선을 못 얻으면 판정 불가 → 보수적으로 막힘으로 본다.
    if (!normal) return traveled + dist;

    const facing = normal.x * dir[0] + normal.y * dir[1] + normal.z * dir[2];
    if (facing <= 0) {
      // 앞면 히트 = 정상적으로 바깥에서 모델에 부딪혔다.
      return traveled + dist;
    }

    // 뒷면 히트 = 이 구간은 **모델 내부**를 지나왔다는 뜻(연구 3절 is_inside).
    //   관통 거리가 막대 굵기보다 크면 시작점 자체가 내부 깊숙이 있다고 보고
    //   즉시 실패(거리 0). 짧으면 화살촉 침투(0.2mm) 같은 얕은 겹침이라
    //   빠져나온 지점에서 다시 쏜다.
    if (traveled + dist > INSIDE_TOLERANCE_MM) return 0;

    traveled += dist + REEMIT_EPS_MM;
    o.set(
      origin[0] + dir[0] * traveled,
      origin[1] + dir[1] * traveled,
      origin[2] + dir[2] * traveled,
    );
  }
  // 재발사 상한 초과 — 병적인 메시. 보수적으로 막힘.
  return 0;
}

/**
 * "시작점이 모델 내부" 로 볼 관통 거리 상한 (mm).
 *   연구 3절은 2r+sd(막대 굵기+안전거리)를 쓴다. 우리는 막대 반경이 호출마다
 *   달라 광선 단위로는 알기 어렵고, 실제로 걸러야 할 얕은 겹침은 화살촉 침투
 *   깊이(0.2mm)급이다. 그보다 넉넉한 1mm 를 상한으로 둔다 — 이보다 깊이 파묻힌
 *   시작점은 어떤 굵기의 기둥을 세워도 모델 안에서 출발하는 셈이라 막는 게 맞다.
 */
const INSIDE_TOLERANCE_MM = 1.0;

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
