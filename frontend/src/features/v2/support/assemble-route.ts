// 서포트 재설계(S-4b-2c) **라우팅된 점 1개의 형상 조립**. 순수 모듈 — Babylon import 금지.
//   `route-plan.ts` 가 정한 경로(bent / anchor / joinPillar)를 실제 지오메트리로 만든다.
//   1단(vertical)은 종전 `assembleVerticalSupport` 가 그대로 담당한다 — 이 파일은
//   **폴백 경로 전용**이고, 기존 수직 경로의 코드는 한 줄도 건드리지 않는다(무회귀).
//
//   근거: `docs/설계_서포트재설계_20260720.md` 4-1(접점)·4-3(단일 굵기)·4-4(3단 폴백).
//
//   ## 좌표계 — ★ 여기만 다르다
//   assemble-core / assemble-strut 은 "로컬 XZ 원점 기준" 조립이고 호출 측이 XZ 로
//   평행이동한다. 이 파일은 **world 좌표를 그대로** 받아 world 에 조립한다. 폴백
//   경로는 접점과 착지점의 XZ 가 다르므로 "원점 기준"이 의미가 없기 때문이다.
//   호출 측(assemble-support.ts)은 이 결과를 평행이동 없이 inv(world) 로 로컬화만
//   하면 된다.

import {
  appendArrowHead,
  appendArrowHeadDir,
  appendTransformed,
  saturateHeadDir,
  HEAD_MAX_TILT_DEG,
  matMul,
  matRotX,
  matScale,
  matTranslate,
  matZupToYup,
  type SupportPartsGeometry,
  type SupportPartsSet,
  type VerticalSupportSpec,
} from "./assemble-core";
import {
  assembleBentPath,
  assembleJunctionSphere,
  assembleStrut,
  type Vec3,
} from "./assemble-strut";

/**
 * 라우팅된 서포트 1개의 조립 스펙.
 *   치수 항목은 `VerticalSupportSpec` 과 같은 의미(같은 params 에서 온다). 다만
 *   surfaceY/baseY 대신 **world 좌표**로 접점과 경로를 받는다(위 좌표계 주석).
 */
export interface RoutedSupportSpec {
  /** 접점 world 좌표. 화살촉이 여기 붙는다(방향은 headDir). */
  contactWorld: Vec3;
  /** 앞구슬(팁) 지름 = 2×point.tipRadius (없으면 params.tipDiameterMm). */
  tipDiameterMm: number;
  /** 화살촉 뒷구슬 지름 (params.headBackDiameterMm). */
  headBackDiameterMm: number;
  /** 화살촉 길이 = 앞구슬 중심 → 뒷구슬 중심 (params.headLengthMm). */
  headLengthMm: number;
  /** 접점 침투 깊이 (params.contactPenetrationMm). */
  contactPenetrationMm: number;
  /** 기둥·다리 지름 (params.trunkDiameterMm) — 설계 4-3 단일 굵기. */
  trunkDiameterMm: number;
  /** 바닥 발 밑면 지름 (params.baseDiameterMm). bent 에서만 쓴다. */
  baseDiameterMm: number;
  /** 바닥 발(원뿔) 높이 (params.baseTransitionMm). bent 에서만 쓴다. */
  baseTransitionMm: number;
  /**
   * S-4e-1 — 접점 화살촉이 나가는 방향 (world 단위벡터, **포화 전 원시값**).
   *   미지정이면 종전대로 수직(−Y). 포화(45°)는 조립이 한 번만 한다.
   *   경로(꺾임·앵커·합류)는 이 방향으로 옮겨진 **뒷구슬 중심**에서 시작한다.
   */
  headDir?: Vec3;
  /** 경로. `route-plan.ts` 의 PointRoute 를 world 좌표로 편 것. */
  route:
    | {
        kind: "bent";
        /** 중간 꺾임점(전환점) world 목록. 양 끝은 포함하지 않는다. */
        worldWaypoints: Vec3[];
        /** 최종 착지 XZ (플레이트 위). */
        baseXZ: [number, number];
        /** 착지 Y (보통 플레이트 0). */
        baseY: number;
      }
    | {
        kind: "anchor";
        /** 뒤집힌 화살촉이 닿을 모델 표면 world 점. */
        anchorWorld: Vec3;
      }
    | {
        kind: "joinPillar";
        /** 중심 기둥에 다리가 붙는 world 점. */
        junctionWorld: Vec3;
      };
}

/**
 * 라우팅된 점 하나를 조립한다 (설계 4-4 폴백 3종).
 *
 * 공통: 경로의 꺾임은 화살촉 **아래**(뒷구슬 중심)에서 시작한다. 화살촉 방향은
 * S-4e-1 부터 `spec.headDir`(표면 법선, 45° 포화)을 따르며, 미지정이면 종전대로
 * 수직이다 — 설계 4-1 "접점은 법선을 따라 붙되 수평 45°보다 눕지 못하게".
 *
 * @returns world 좌표계 병합 지오메트리.
 */
export function assembleRoutedSupport(
  parts: SupportPartsSet,
  spec: RoutedSupportSpec,
): SupportPartsGeometry {
  const accPos: number[] = [];
  const accIdx: number[] = [];
  const [cx, cy, cz] = spec.contactWorld;
  const strutR = spec.trunkDiameterMm * 0.5;

  // ── 화살촉 ─────────────────────────────────────────────────────────────
  //   S-4e-1: headDir 이 있으면 그 방향(45° 포화)으로 기울여 붙이고, 없으면
  //   **종전 수직 경로 그대로** 탄다(무회귀). 어느 쪽이든 경로는 뒷구슬 중심에서
  //   시작한다 — 기울면 그 시작점이 접점 XZ 에서 최대 headLen·sin45° ≈ 0.71mm
  //   비껴난다(assemble-core 의 같은 주석 참고).
  //   ★ headDir 이 정확히 (0,−1,0)(평평한 밑면) 이면 **종전 분기로 떨어뜨린다**.
  //     회전 행렬이 항등이라 형상은 같지만, 행렬 곱을 한 번 더 거치면 float32
  //     마지막 자리가 1e-6mm 급으로 흔들려 positions 바이트가 달라진다 —
  //     "평평한 밑면은 수정 전과 바이트 동일" 계약을 정확히 지키려면 경로 자체를
  //     타지 말아야 한다(assemble-core 의 같은 short-circuit 과 짝).
  const rawDir =
    spec.headDir &&
    !(spec.headDir[0] === 0 && spec.headDir[1] === -1 && spec.headDir[2] === 0)
      ? spec.headDir
      : undefined;
  let headBottom: Vec3;
  if (rawDir) {
    headBottom = appendArrowHeadDir(
      parts,
      spec,
      spec.headLengthMm,
      spec.contactWorld,
      saturateHeadDir(rawDir, HEAD_MAX_TILT_DEG),
      accPos,
      accIdx,
    );
  } else {
    //   appendArrowHead 는 로컬 XZ 원점 기준이므로, 임시 배열에 담아 XZ 로 옮긴다.
    const headSpec: Pick<
      VerticalSupportSpec,
      "surfaceY" | "tipDiameterMm" | "headBackDiameterMm" | "contactPenetrationMm"
    > = {
      surfaceY: cy,
      tipDiameterMm: spec.tipDiameterMm,
      headBackDiameterMm: spec.headBackDiameterMm,
      contactPenetrationMm: spec.contactPenetrationMm,
    };
    const headPos: number[] = [];
    const headIdx: number[] = [];
    const backCenterY = appendArrowHead(
      parts,
      headSpec,
      spec.headLengthMm,
      headPos,
      headIdx,
    );
    appendRaw(accPos, accIdx, headPos, headIdx, cx, 0, cz);
    /** 화살촉 아래 = 경로가 시작되는 자리 (world). */
    headBottom = [cx, backCenterY, cz];
  }

  switch (spec.route.kind) {
    case "bent": {
      // 경로: 화살촉 아래 → 전환점들 → 발 꼭대기(착지 XZ 위, baseY+발높이).
      //   발 원뿔의 꼭짓점이 baseY+baseTransitionMm 이므로 마지막 수직 막대는
      //   **baseY 까지** 내려 발과 겹친다 — assemble-core 기둥이 baseY 까지
      //   내려가는 것과 같은 이유(접합부 단면적 0 수렴 = 파단 방지).
      const { worldWaypoints, baseXZ, baseY } = spec.route;
      const path: Vec3[] = [
        headBottom,
        ...worldWaypoints,
        [baseXZ[0], baseY, baseXZ[1]],
      ];
      append(accPos, accIdx, assembleBentPath(parts, path, strutR));

      // 바닥 발: 넓은 밑면이 baseY, 위로 좁아져 막대에 연결 (assemble-core 4-2 전이와 동일).
      appendTransformed(
        parts.cone,
        matMul(
          matTranslate(baseXZ[0], baseY, baseXZ[1]),
          matMul(
            matScale(spec.baseDiameterMm, spec.baseTransitionMm, spec.baseDiameterMm),
            matZupToYup(),
          ),
        ),
        accPos,
        accIdx,
      );
      break;
    }

    case "anchor": {
      // 화살촉 아래 → 앵커 지점까지 막대(수직) + 앵커 지점에 **뒤집힌 화살촉**.
      const anchor = spec.route.anchorWorld;
      append(accPos, accIdx, assembleStrut(parts, anchor, headBottom, strutR));
      appendInvertedHead(parts, spec, anchor, accPos, accIdx);
      break;
    }

    case "joinPillar": {
      // 화살촉 아래 → 중심 기둥의 합류점까지 경사 막대 + 합류점 접합 구.
      //   기둥 자체는 중심점이 세운다(여기서 세우면 이중 기둥이 된다).
      const j = spec.route.junctionWorld;
      append(accPos, accIdx, assembleStrut(parts, j, headBottom, strutR));
      // 접합 구 반경 = 막대 반경 (2a 주석의 R ≥ r 조건 충족 = 파단 방지).
      append(accPos, accIdx, assembleJunctionSphere(parts, j, strutR));
      break;
    }
  }

  return {
    positions: new Float32Array(accPos),
    indices: new Uint32Array(accIdx),
  };
}

/**
 * **뒤집힌 화살촉**(설계 4-4 3단) — 아래를 향한 모델 표면에 얹는 접점.
 *
 * 정방향 화살촉을 X축 180° 로 돌려 배치한다. **matScale(-1) 로 뒤집으면 안 된다**
 * — 음수 스케일은 삼각형 winding 을 반전시켜 법선이 뒤집힌다(assemble-core
 * matScale 주석의 규약). 회전은 det=+1 이라 winding 이 보존된다.
 *
 * 뒤집힌 뒤의 기하: 앞구슬이 앵커 지점 **아래쪽**으로 침투 깊이만큼 파고들고,
 * 뒷구슬이 그 위 headLengthMm 지점에 온다 — 정방향의 정확한 거울상이다.
 *
 * ※ S-4e-1 범위 밖: 이쪽은 **수직(뒤집힌) 고정**으로 남긴다. 라우팅(route-plan)이
 *   앵커 착지면의 법선을 내주지 않아 기울일 근거가 없기 때문이다. 앵커 면 법선을
 *   경로 결과에 실어 오는 것이 선행 조건.
 */
function appendInvertedHead(
  parts: SupportPartsSet,
  spec: RoutedSupportSpec,
  anchorWorld: Vec3,
  accPos: number[],
  accIdx: number[],
): void {
  // 로컬 원점 기준·surfaceY=0 으로 정방향 화살촉을 만든 뒤 통째로 뒤집는다.
  const localPos: number[] = [];
  const localIdx: number[] = [];
  appendArrowHead(
    parts,
    {
      surfaceY: 0,
      tipDiameterMm: spec.tipDiameterMm,
      headBackDiameterMm: spec.headBackDiameterMm,
      contactPenetrationMm: spec.contactPenetrationMm,
    },
    spec.headLengthMm,
    localPos,
    localIdx,
  );

  const m = matMul(
    matTranslate(anchorWorld[0], anchorWorld[1], anchorWorld[2]),
    matRotX(Math.PI),
  );
  appendTransformed(
    { positions: new Float32Array(localPos), indices: new Uint32Array(localIdx) },
    m,
    accPos,
    accIdx,
  );
}

/** 조립 결과 하나를 누적 배열에 이어붙인다(indices 오프셋 재부여). */
function append(
  accPos: number[],
  accIdx: number[],
  geo: SupportPartsGeometry,
): void {
  const vbase = accPos.length / 3;
  for (let i = 0; i < geo.positions.length; i++) accPos.push(geo.positions[i]);
  for (let i = 0; i < geo.indices.length; i++) accIdx.push(geo.indices[i] + vbase);
}

/** 평면 배열을 평행이동하며 이어붙인다(임시 로컬 조립 → world 배치용). */
function appendRaw(
  accPos: number[],
  accIdx: number[],
  pos: readonly number[],
  idx: readonly number[],
  tx: number,
  ty: number,
  tz: number,
): void {
  const vbase = accPos.length / 3;
  for (let i = 0; i < pos.length; i += 3) {
    accPos.push(pos[i] + tx, pos[i + 1] + ty, pos[i + 2] + tz);
  }
  for (let i = 0; i < idx.length; i++) accIdx.push(idx[i] + vbase);
}
