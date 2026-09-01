// 서포트 재설계(S-4) 검출·점생성 실행 + 시각화 액션 (신규, ctx 기반).
//   설계 8장 1~2단계의 "눈으로 볼 수 있게" 판정용 경로. 기존 dental island
//   경로(dental-actions.ts, 셀 래스터+마진)와 독립이다. 마진/dental 코드를
//   import 하지 않는다 (리드 결정 1).
//
//   흐름: 활성 STL → extractWorldTriangles → detectLayerGraph(1단계) →
//         placeSupportPoints(2단계) → 오버레이(아일랜드 마젠타/오버행 주황) +
//         서포트 점 구(파랑) 렌더. 점 목록을 반환(저장은 호출 측 몫)한다.

import {
  Color3,
  type AbstractMesh,
  MeshBuilder,
  Ray,
  type Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { extractWorldTriangles } from "../../utils/slice-section";
import { worldToStlLocal } from "../../utils/coord-space";
import {
  detectLayerGraph,
  placeSupportPoints,
  DEFAULT_LAYER_GRAPH_PARAMS,
  DEFAULT_PLACE_POINTS_PARAMS,
  type LayerGraphResult,
} from "../../support";
import type { LayerGraphParams } from "../../support/detect/types";
import type { PlacePointsParams } from "../../support/detect/place-points";
import type { SupportParams, SupportPointV2 } from "../../support/types";
import { makeTriangleBeamProbe } from "../../support/collision-probe";
import {
  planClusterRoutes,
  type RoutePoint,
  type RouteReport,
} from "../../support/route-plan";
import type { SceneCtx } from "./scene-refs";
import { getActiveStl } from "./scene-actions";

/** 재설계 검출·점생성 요약 통계 (패널 표시용). */
export interface RedesignDetectStats {
  islandCount: number;
  overhangCount: number;
  pointCount: number;
  nLayers: number;
  layerHeight: number;
}

/** 재설계 오버레이(아일랜드/오버행 색 + 서포트 점 구)를 모두 정리한다. */
export function disposeRedesignVisualization(ctx: SceneCtx): void {
  for (const m of ctx.redesignMarkersRef.current) m.dispose(false, true);
  ctx.redesignMarkersRef.current = [];
}

/**
 * 활성 STL 에서 재설계 검출(1단계)+점생성(2단계)을 실행하고 시각화한다.
 *   layerHeightMm 미지정 시 기본값(0.05mm). liftMm 는 진단 C 방지를 위해
 *   호출 측에서 실제 리프트 값을 넘긴다.
 *   반환: 생성된 서포트 점 + 통계 (실패 시 reason).
 */
export function runRedesignDetect(
  ctx: SceneCtx,
  projectId: string,
  opts: {
    layerHeightMm: number;
    liftMm: number;
    overhangAngleDeg?: number;
    /**
     * 검출·점생성 파라미터 덮어쓰기 (P-2). 미지정 항목은 기본값을 쓴다.
     *   사용자가 패널에서 조절한 값이 여기로 들어온다. 종전에는 이 9개가
     *   전부 모듈 상수라 UI 로 못 바꿨다(리드 결정 3 위반).
     */
    detect?: Partial<LayerGraphParams> & Partial<PlacePointsParams>;
  },
):
  | { ok: true; points: SupportPointV2[]; stats: RedesignDetectStats }
  | { ok: false; reason: string } {
  const scene = ctx.sceneRef.current;
  if (!scene) return { ok: false, reason: "씬이 준비되지 않았습니다." };
  const active = getActiveStl(ctx);
  if (!active) return { ok: false, reason: "대상 STL이 없습니다." };
  const { mesh } = active;

  mesh.computeWorldMatrix(true);
  const triangles = extractWorldTriangles(mesh);
  if (triangles.length === 0) {
    return { ok: false, reason: "분석할 삼각형이 없습니다." };
  }

  // ── 1단계: 층 그래프 검출 ─────────────────────────────────────────────
  //   overhangAngleDeg: ★ C-3(검출각 단일화) — 호출 측(useDentalWorkflow)이 뷰어
  //   하이라이트와 **같은 값**을 넘긴다. 미지정이면 종전 기본값이라 하위 호환.
  const detect = detectLayerGraph(triangles, active.id, {
    ...DEFAULT_LAYER_GRAPH_PARAMS,
    ...(opts.detect ?? {}), // P-2: 사용자 조절 값
    layerHeightMm: opts.detect?.layerHeightMm ?? opts.layerHeightMm,
    liftMm: opts.liftMm, // plateGap-lift 연동 (수용 C).
    ...(opts.overhangAngleDeg != null
      ? { overhangAngleDeg: opts.overhangAngleDeg }
      : {}),
  });

  // ── 2단계: 점 생성 ────────────────────────────────────────────────────
  const points = placeSupportPoints(detect, projectId, {
    ...DEFAULT_PLACE_POINTS_PARAMS,
    ...(opts.detect ?? {}), // P-2: 사용자 조절 값
  });

  // ── 시각화 (기존 오버레이 정리 후 새로 그림) ─────────────────────────
  disposeRedesignVisualization(ctx);
  renderDetectionOverlay(ctx, detect);
  renderSupportPointSpheres(ctx, points);

  const stats: RedesignDetectStats = {
    islandCount: detect.islands.length,
    overhangCount: detect.overhangs.length,
    pointCount: points.length,
    nLayers: detect.nLayers,
    layerHeight: detect.layerHeight,
  };
  console.log(
    `[재설계 검출·점생성] 아일랜드 ${stats.islandCount} · 오버행 ${stats.overhangCount} · ` +
      `점 ${stats.pointCount} · 층 ${stats.nLayers} · 층높이 ${stats.layerHeight}mm · ` +
      `islandFloorY ${detect.islandFloorY.toFixed(2)}mm`,
  );

  return { ok: true, points, stats };
}

/**
 * 아일랜드(마젠타)·오버행(주황) 영역을 world 좌표 선/점 마커로 표시한다.
 *   기존 v2_islandFaces 오버레이 패턴 참고. 여기서는 층 폴리곤을 얇은 선으로
 *   깔고, 각 아일랜드 무게중심에 작은 마젠타 디스크를 얹어 눈에 띄게 한다.
 *   world 좌표라 STL parent 없이 그대로 놓는다(1차 판정용 — 재변형 시 재실행).
 */
function renderDetectionOverlay(ctx: SceneCtx, detect: LayerGraphResult): void {
  const scene = ctx.sceneRef.current;
  if (!scene) return;

  const islandMat = new StandardMaterial("v2_redesignIslandMat", scene);
  islandMat.emissiveColor = new Color3(1.0, 0.2, 0.85); // 마젠타.
  islandMat.disableLighting = true;
  const overhangMat = new StandardMaterial("v2_redesignOverhangMat", scene);
  overhangMat.emissiveColor = new Color3(1.0, 0.6, 0.1); // 주황.
  overhangMat.disableLighting = true;

  // 아일랜드 외곽선(마젠타).
  for (const island of detect.islands) {
    const pathPts = island.polygon.map((p) => new Vector3(p[0], island.y, p[1]));
    if (pathPts.length >= 2) {
      pathPts.push(pathPts[0].clone()); // 닫기.
      const line = MeshBuilder.CreateLines(
        "v2_redesignIslandLine",
        { points: pathPts },
        scene,
      );
      line.color = new Color3(1.0, 0.2, 0.85);
      line.isPickable = false;
      line.renderingGroupId = 0;
      ctx.redesignMarkersRef.current.push(line);
    }
    // 무게중심 디스크(눈에 띄게).
    const disc = MeshBuilder.CreateDisc(
      "v2_redesignIslandDisc",
      { radius: 0.4, tessellation: 12 },
      scene,
    );
    disc.rotation.x = Math.PI / 2; // XZ 평면에 눕힘.
    disc.position.set(island.centroid[0], island.y, island.centroid[1]);
    disc.material = islandMat;
    disc.isPickable = false;
    disc.renderingGroupId = 0;
    ctx.redesignMarkersRef.current.push(disc);
  }

  // 오버행 점(주황 작은 디스크).
  for (const overhang of detect.overhangs) {
    for (const [x, z] of overhang.points) {
      const disc = MeshBuilder.CreateDisc(
        "v2_redesignOverhangDisc",
        { radius: 0.25, tessellation: 8 },
        scene,
      );
      disc.rotation.x = Math.PI / 2;
      disc.position.set(x, overhang.y, z);
      disc.material = overhangMat;
      disc.isPickable = false;
      disc.renderingGroupId = 0;
      ctx.redesignMarkersRef.current.push(disc);
    }
  }
}

/**
 * 서포트 점을 작은 구로 표시한다(기둥 없이 점만 — 설계 8장 2단계 완료판정).
 *   island 점=파랑, slope 점=하늘색으로 구분. 구 반경은 점의 tipRadius 를
 *   최소 0.15mm 로 보정해 사용(너무 작으면 안 보임).
 */
function renderSupportPointSpheres(
  ctx: SceneCtx,
  points: SupportPointV2[],
): void {
  const scene = ctx.sceneRef.current;
  if (!scene) return;

  const islandMat = new StandardMaterial("v2_redesignPointIslandMat", scene);
  islandMat.emissiveColor = new Color3(0.2, 0.5, 1.0); // 파랑.
  islandMat.disableLighting = true;
  const slopeMat = new StandardMaterial("v2_redesignPointSlopeMat", scene);
  slopeMat.emissiveColor = new Color3(0.3, 0.85, 1.0); // 하늘색.
  slopeMat.disableLighting = true;

  for (const p of points) {
    const r = Math.max(p.tipRadius ?? 0.2, 0.15);
    const sphere = MeshBuilder.CreateSphere(
      "v2_redesignPoint",
      { diameter: r * 2, segments: 6 },
      scene,
    );
    sphere.position.set(p.contact[0], p.contact[1], p.contact[2]);
    sphere.material = p.kind === "slope" ? slopeMat : islandMat;
    sphere.isPickable = false;
    sphere.renderingGroupId = 0;
    ctx.redesignMarkersRef.current.push(sphere);
  }
}

/** 표면 스냅 레이 최대 거리 (mm). contact 아래에서 위로 이 거리 안의 표면을 찾는다. */
const SNAP_RAY_MAX_MM = 2.0;

/**
 * 표면 스냅만 수행한다 — contact 를 실제 STL 표면 Y 로 끌어올린다 (설계 4-1 접점 준비).
 *   contact 바로 아래(−SNAP_RAY_MAX_MM/2)에서 +Y 로 레이캐스트(상한
 *   SNAP_RAY_MAX_MM)해 표면 Y 를 얻고, 실패(미교차) 시 원래 값을 유지한다.
 *
 *   S-4b-2c 에서 종전 `snapAndFinalizePoints` 의 1) 단계를 **world 좌표를 유지한
 *   채** 떼어낸 것이다. 라우팅(3단 폴백)은 world 좌표에서 돌아야 하므로 stl-local
 *   변환은 맨 마지막(`routeAndFinalizePoints` 3단계)으로 미룬다.
 *
 * @returns 각 점의 스냅된 world contact ([x, y, z]) — 입력과 같은 순서·길이.
 */
function snapContactsToSurface(
  scene: Scene,
  mesh: AbstractMesh,
  points: readonly SupportPointV2[],
): [number, number, number][] {
  const predicate = (m: AbstractMesh) => m === mesh;
  const up = new Vector3(0, 1, 0);
  return points.map((p) => {
    const [cx, cy, cz] = p.contact;
    const origin = new Vector3(cx, cy - SNAP_RAY_MAX_MM * 0.5, cz);
    const ray = new Ray(origin, up, SNAP_RAY_MAX_MM);
    const hit = scene.pickWithRay(ray, predicate);
    const snappedY = hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : cy;
    return [cx, snappedY, cz];
  });
}

/**
 * 검출 점을 **라우팅**해 저장 가능한 최종 형태로 확정한다 (S-4b-2c).
 *
 * 종전 `snapAndFinalizePoints`(S-4b-1, 전원 수직 기둥)를 대체한다. 흐름:
 *   1) **표면 스냅** — 위 `snapContactsToSurface` (world 유지).
 *   2) **라우팅** — 활성 STL 로 빔 probe 를 만들어 `planClusterRoutes` 실행.
 *      중복 제거 → 기둥 공유 클러스터 → 합류 다리 검사 → 3단 폴백(수직/경사/앵커).
 *   3) **저장 형태 변환** — 경로별로 base·routeKind·routeWaypoints 를 채우고
 *      world → stl-local 로 옮겨 `coordSpace:'stl-local'` 로 확정.
 *   실패(failed) 점은 저장 목록에서 빠지고 report 에 카운트만 남는다
 *   (연구 7절-6 "조용히 버리지 말 것" — 호출 측이 사용자에게 통지한다).
 *
 * 활성 STL 이 없으면 라우팅할 대상이 없으므로 입력을 그대로 돌려준다.
 *
 * @param params 서포트 파라미터 — 반경(trunkDiameterMm/2)과 화살촉 높이를 준다.
 */
export function routeAndFinalizePoints(
  ctx: SceneCtx,
  points: SupportPointV2[],
  params: SupportParams,
): { points: SupportPointV2[]; report: RouteReport | null } {
  const scene = ctx.sceneRef.current;
  const active = getActiveStl(ctx);
  if (!scene || !active) return { points, report: null };
  const { mesh } = active;
  mesh.computeWorldMatrix(true);

  // ── 1) 표면 스냅 (world 유지) ───────────────────────────────────────────
  const snapped = snapContactsToSurface(scene, mesh, points);

  // ── 2) 라우팅 ──────────────────────────────────────────────────────────
  //   빔 시작점은 화살촉 아래 — 앞구슬이 침투해 있는 표면 자신을 맞지 않게
  //   (route-plan headClearanceMm 주석 참고).
  //   ★ S-4b-2c-f: Babylon 레이캐스트 대신 world 삼각형 배열 + 자체 격자 인덱스.
  //     여기서 mesh 당 **1회만** 추출한다(collision-probe 파일 머리 주석 T-2).
  const probe = makeTriangleBeamProbe(extractWorldTriangles(mesh));
  const routeInput: (RoutePoint & { origin: SupportPointV2 })[] = points.map(
    (p, i) => ({
      contact: snapped[i],
      tipRadius: p.tipRadius,
      kind: p.kind,
      origin: p,
    }),
  );
  const { routes, deduped, report } = planClusterRoutes(routeInput, probe, {
    strutRadiusMm: params.trunkDiameterMm / 2,
    headClearanceMm: params.headLengthMm + params.contactPenetrationMm,
  });

  // ── 3) 저장 형태 변환 ───────────────────────────────────────────────────
  //   routes[i] ↔ deduped[i] 는 1:1 (route-plan 의 순서 계약).
  const toLocal = (w: [number, number, number]) => worldToStlLocal(w, mesh);
  const finalized: SupportPointV2[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const src = deduped[i] as RoutePoint & { origin: SupportPointV2 };
    const route = routes[i];
    const p = src.origin;
    const [cx, cy, cz] = src.contact;
    const localContact = toLocal([cx, cy, cz]);

    switch (route.kind) {
      case "vertical": {
        // ★ S-4b-1 과 **완전히 같은 저장 형태** — routeKind 조차 찍지 않는다.
        //   찍으면 buildSupportKey 문자열이 달라져 무회귀가 깨진다(수용 6).
        finalized.push({
          ...p,
          contact: localContact,
          base: toLocal([cx, 0, cz]),
          coordSpace: "stl-local",
          baseAnchor: "plate",
        });
        break;
      }
      case "bent": {
        // 발은 플레이트(Y=0) — 착지 XZ 위에 선다.
        const [lx, lz] = route.landingXZ;
        finalized.push({
          ...p,
          contact: localContact,
          base: toLocal([lx, 0, lz]),
          coordSpace: "stl-local",
          baseAnchor: "plate",
          routeKind: "bent",
          routeWaypoints: route.waypoints.map((w) => toLocal(w)),
        });
        break;
      }
      case "joinPillar": {
        // base = 기둥 합류점. ★ baseAnchor 는 반드시 'model' —
        //   'plate' 면 resolveRedesignBaseY 가 Y 를 0 으로 강제해 다리가 바닥까지
        //   늘어나며 형상이 무너진다(assemble-support buildRoutedSpec 주석).
        const pillarSrc = deduped[route.pillarPointIndex] as RoutePoint & {
          origin: SupportPointV2;
        };
        finalized.push({
          ...p,
          contact: localContact,
          base: toLocal(route.junction),
          coordSpace: "stl-local",
          baseAnchor: "model",
          routeKind: "joinPillar",
          joinPillarPointId: pillarSrc.origin.id,
        });
        break;
      }
      case "anchor": {
        // base = 모델 표면 앵커 지점. 위와 같은 이유로 'model'.
        finalized.push({
          ...p,
          contact: localContact,
          base: toLocal(route.anchorPoint),
          coordSpace: "stl-local",
          baseAnchor: "model",
          routeKind: "anchor",
        });
        break;
      }
      case "failed":
        // 저장하지 않는다. report.failed 가 이미 세었다.
        break;
    }
  }

  return { points: finalized, report };
}
