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
import type { SupportPointV2 } from "../../support/types";
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
  opts: { layerHeightMm: number; liftMm: number },
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
  const detect = detectLayerGraph(triangles, active.id, {
    ...DEFAULT_LAYER_GRAPH_PARAMS,
    layerHeightMm: opts.layerHeightMm,
    liftMm: opts.liftMm, // plateGap-lift 연동 (수용 C).
  });

  // ── 2단계: 점 생성 ────────────────────────────────────────────────────
  const points = placeSupportPoints(detect, projectId, DEFAULT_PLACE_POINTS_PARAMS);

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
 * 검출 점을 저장 가능한 최종 형태로 확정한다 (설계 4-1 접점 준비 / S-4b-1 저장).
 *   각 점마다:
 *     1) 표면 스냅: 활성 STL 메시에 contact 바로 아래(−SNAP_RAY_MAX_MM/2)에서
 *        +Y 로 레이캐스트(상한 SNAP_RAY_MAX_MM)해 실제 표면 Y 로 contact.y 를
 *        보정. 실패(미교차) 시 원래 contact 유지.
 *     2) base 확정: [contact.x, 0, contact.z] (플레이트 Y=0). S-4a 임시 base 재계산.
 *        B-18: 접지 의도를 baseAnchor='plate' 로 함께 기록한다 (모델이 움직인
 *        뒤엔 저장 좌표만으로 구분할 수 없으므로 생성 시점에 찍는다).
 *     3) 좌표 공간: world contact/base 를 STL local 로 변환해 저장하고
 *        coordSpace='stl-local' 로 둔다(types.ts 규약 = 신규 점 정본). STL
 *        transform 시 mesh.parent=stlMesh 로 자동 동기(race 없음).
 *   활성 STL 이 없으면 world 좌표 그대로(coordSpace 미지정) 반환한다.
 *
 *   ※ S-4b-1 한계(TODO): 수직 스냅만. 경사면 법선 방향 스냅·3단 폴백은 S-4b-2.
 */
export function snapAndFinalizePoints(
  ctx: SceneCtx,
  points: SupportPointV2[],
): SupportPointV2[] {
  const scene = ctx.sceneRef.current;
  const active = getActiveStl(ctx);
  if (!scene || !active) return points;
  const { mesh } = active;
  mesh.computeWorldMatrix(true);
  const predicate = (m: AbstractMesh) => m === mesh;

  const up = new Vector3(0, 1, 0);
  return points.map((p) => {
    // 1) 표면 스냅 — contact 바로 아래에서 위로 레이.
    const [cx, cy, cz] = p.contact;
    const origin = new Vector3(cx, cy - SNAP_RAY_MAX_MM * 0.5, cz);
    const ray = new Ray(origin, up, SNAP_RAY_MAX_MM);
    const hit = scene.pickWithRay(ray, predicate);
    const snappedY =
      hit?.hit && hit.pickedPoint ? hit.pickedPoint.y : cy;

    // 2) base = 플레이트(Y=0) 바로 아래 (수직 기둥).
    const worldContact: [number, number, number] = [cx, snappedY, cz];
    const worldBase: [number, number, number] = [cx, 0, cz];

    // 3) world → stl-local 저장 (신규 점 정본, coord-space.ts 유틸 재사용).
    const localContact = worldToStlLocal(worldContact, mesh);
    const localBase = worldToStlLocal(worldBase, mesh);
    return {
      ...p,
      contact: localContact,
      base: localBase,
      coordSpace: "stl-local" as const,
      // B-18: 이 경로의 base 는 정의상 플레이트(Y=0) 접지다. 접지 의도는 점을
      //   만드는 지금만 알 수 있으므로(모델이 움직인 뒤엔 저장 좌표만 봐서는
      //   구분 불가) 여기서 명시해 둔다. S-4b-2 의 3단 폴백은 자기 결과에
      //   'model' 을 실어 보내면 된다.
      baseAnchor: "plate" as const,
    };
  });
}
