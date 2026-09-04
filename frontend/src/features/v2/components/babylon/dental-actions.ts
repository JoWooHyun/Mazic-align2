// dental 마진/아일랜드 검출·시각화·무효화 액션 묶음 — ctx 기반.
//   원본 BabylonScene 본문 내부 함수(disposeMarginVisualization/runFindDentalMargin/
//   disposeIslandVisualization/invalidateDentalResults/cancelPendingInvalidation/
//   scheduleInvalidation/runDetectDentalIslands/fillMarginFromFace)를 순수 이동.
//   ref 접근을 ctx 인자로 바꾼 것 외 로직·수치·문자열 무변경.
import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { computePaintedFaceIds } from "../../utils/dental/paint-mask";
import {
  findMargin,
  type FindMarginStats,
} from "../../utils/dental/margin-detect";
import { readWorldTriangles } from "../../utils/dental/dental-support";
import { detectSliceIslands } from "../../utils/dental/island-detection";
import type { IslandStats } from "./babylon-scene-types";
import type { SceneCtx } from "./scene-refs";
import { disposeRedesignVisualization } from "./redesign-detect-actions";
import { getActiveStl } from "./scene-actions";

/**
 * 마진 시각화(초록 튜브) + floodfill 자동 색칠(주황) 을 정리한다.
 *   stlId 지정 시 그 STL 것만, 미지정 시 전부. marginRef 는 전부 지울 때만
 *   null 로 (부분 정리는 재검출 흐름에서 같은 STL 튜브만 교체하는 용도).
 */
export function disposeMarginVisualization(
  ctx: SceneCtx,
  stlId?: string,
): void {
  ctx.marginMarkersRef.current = ctx.marginMarkersRef.current.filter((m) => {
    if (stlId === undefined || m.metadata?.stlId === stlId) {
      m.dispose(false, true);
      return false;
    }
    return true;
  });
  // floodfill 오버레이는 stlId 별 metadata 로 구분해 정리.
  ctx.autoFillOverlayRef.current = ctx.autoFillOverlayRef.current.filter(
    (m) => {
      if (stlId === undefined || m.metadata?.stlId === stlId) {
        m.dispose(false, true);
        return false;
      }
      return true;
    },
  );
  if (stlId === undefined) {
    ctx.marginRef.current = null;
    ctx.autoFillFacesRef.current = new Set();
  } else if (ctx.marginRef.current?.stlId === stlId) {
    ctx.marginRef.current = null;
    ctx.autoFillFacesRef.current = new Set();
  }
}

/**
 * 아일랜드 마젠타 overlay + 결과 ref 를 정리한다.
 *   stlId 지정 시 그 STL 것만, 미지정 시 전부. islandResultRef 는 전부 지울 때
 *   또는 같은 STL 재검출 시 null 로.
 */
export function disposeIslandVisualization(
  ctx: SceneCtx,
  stlId?: string,
): void {
  ctx.islandMarkersRef.current = ctx.islandMarkersRef.current.filter((m) => {
    if (stlId === undefined || m.metadata?.stlId === stlId) {
      m.dispose(false, true);
      return false;
    }
    return true;
  });
  if (stlId === undefined) {
    ctx.islandResultRef.current = null;
  } else if (ctx.islandResultRef.current?.stlId === stlId) {
    ctx.islandResultRef.current = null;
  }
}

/**
 * 한 STL 의 마진·아일랜드 검출 결과를 stale 로 간주해 일괄 무효화한다
 * (감사 B1/B3). world 좌표 기반 검출 결과가 STL 변형(회전·이동)이나
 * 색칠 변경 후 옛 좌표를 참조하는 것을 막는다.
 *   · disposeMarginVisualization(stlId): 초록 튜브 + marginRef + floodfill
 *     오버레이(주황) + autoFillFacesRef 정리
 *   · disposeIslandVisualization(stlId): 마젠타 overlay + islandResultRef 정리
 *   · onDentalResultsInvalidated: 페이지의 marginStatus/islandStatus 리셋
 *
 * UX 변화: 사용자가 STL 을 회전/이동하거나 칠을 바꾸면 초록 튜브·마젠타가
 * 즉시 사라지고 dental 패널이 초기 상태로 돌아간다 — "재검출 필요"가
 * 명시적이 되어, 옛 좌표 기준으로 자동 서포트가 배치되는 사고를 막는다.
 * (해당 STL 에 검출 결과가 없으면 아무 일도 하지 않는다.)
 */
export function invalidateDentalResults(ctx: SceneCtx, stlId: string): void {
  // ★ 재설계 검출 오버레이(파란 점)도 함께 정리한다.
  //   이 점들은 **world 좌표 고정**이라 STL 을 회전/이동하면 허공에 그대로 남는다
  //   (리드 실물: "검출 점생성하고 stl 회전시키면 점들이 그대로 남아있다").
  //   마진 초록 튜브·아일랜드 마젠타가 같은 이유로 이미 여기서 정리되는데,
  //   재설계 오버레이만 이 경로에 빠져 있었다.
  //   ⚠️ marginRef/islandResultRef 와 달리 재설계 마커에는 stlId 가 없다.
  //   활성 STL 한 개에 대해서만 그려지는 디버그 오버레이라 통째로 지운다.
  const hadRedesign = ctx.redesignMarkersRef.current.length > 0;
  if (hadRedesign) disposeRedesignVisualization(ctx);

  const hadMargin = ctx.marginRef.current?.stlId === stlId;
  const hadIsland = ctx.islandResultRef.current?.stlId === stlId;
  if (!hadMargin && !hadIsland) return;
  disposeMarginVisualization(ctx, stlId);
  disposeIslandVisualization(ctx, stlId);
  ctx.onDentalResultsInvalidatedRef.current?.(stlId);
}

/**
 * 예약된 지연 무효화 타이머를 취소한다 (해당 stlId 것만).
 *   · 더블탭 floodfill 경로: 첫 클릭이 예약한 무효화를 취소해 marginRef 유지
 *     (감사 B3 회귀 방지, 원본 워크플로우).
 *   · 검출 성공 경로: 검출이 최신 painted 를 이미 소비했으므로 그 예약은
 *     무의미 — 만료 시 방금 만든 유효 결과를 지우는 레이스를 없앤다.
 *   pendingInvalidationsRef(컴포넌트 레벨) 를 참조하므로 브러쉬 effect 안팎
 *   어디서든(검출 함수 포함) 호출 가능하다.
 */
export function cancelPendingInvalidation(ctx: SceneCtx, stlId: string): void {
  const t = ctx.pendingInvalidationsRef.current.get(stlId);
  if (t !== undefined) {
    clearTimeout(t);
    ctx.pendingInvalidationsRef.current.delete(stlId);
  }
}

/**
 * 색칠 변경에 따른 무효화를 더블클릭 윈도우(Scene.DoubleClickDelay, 기본
 * 300ms)만큼 미뤄 예약한다.
 *   ⚠️ 왜 지연인가: 마진→더블탭 채우기 워크플로우에서 더블클릭의 "첫 클릭"
 *   이 painted 를 바꿔 POINTERUP flush 가 즉시 marginRef 를 null 로 만들면,
 *   뒤이어 도착하는 POINTERDOUBLETAP 의 fillMarginFromFace 가 마진 없음으로
 *   거부된다(회귀). 따라서 painted "통지"는 즉시 하되, "무효화"만 미룬다. 그
 *   사이 더블탭이 오거나 검출이 실행되면 cancelPendingInvalidation 으로 취소.
 */
export function scheduleInvalidation(ctx: SceneCtx, stlId: string): void {
  cancelPendingInvalidation(ctx, stlId); // 중복 예약 방지 (직전 예약을 갱신).
  const t = setTimeout(() => {
    ctx.pendingInvalidationsRef.current.delete(stlId);
    invalidateDentalResults(ctx, stlId);
  }, Scene.DoubleClickDelay);
  ctx.pendingInvalidationsRef.current.set(stlId, t);
}

/**
 * 색칠 영역에서 마진을 찾아 초록 튜브로 시각화하고 결과를 marginRef 에 보관.
 *   원본 findMarginSignal useEffect 의 [UI/씬 의존부] 이식 — 알고리즘 코어는
 *   findMargin(margin-detect.ts, 잠금) 이 담당한다. 성공/실패를 반환해 호출자
 *   (useImperativeHandle)가 패널로 전달한다.
 */
export function runFindDentalMargin(
  ctx: SceneCtx,
):
  | { ok: true; stats: FindMarginStats }
  | { ok: false; reason: string } {
  const scene = ctx.sceneRef.current;
  if (!scene) return { ok: false, reason: "씬이 준비되지 않았습니다." };
  const active = getActiveStl(ctx);
  if (!active) {
    // 원본 console.warn('마진 찾기: 대상 STL이 없습니다.') → UI 문구.
    return { ok: false, reason: "대상 STL이 없습니다." };
  }
  const { id: stlId, mesh } = active;
  // painted 계약 그대로 — 이 STL 의 색칠 face index (autoFill 제외 버전).
  const paintedFaceIds = computePaintedFaceIds(mesh, ctx.paintPointsRef.current);

  const res = findMargin({
    mesh,
    paintedFaceIds,
    brushThickness: ctx.brushThicknessRef.current,
  });
  if (!res.ok) {
    // 원본 각 early-return console.warn 문구를 사용자 UI 문구로 변환.
    const reasonText: Record<typeof res.reason, string> = {
      "no-geometry": "모델 지오메트리를 읽을 수 없습니다.",
      "no-painted-faces":
        "색칠 영역이 없습니다. 먼저 브러쉬로 마진 부근을 칠하세요.",
      "no-seed":
        "색칠 영역 안에서 마진(급격히 꺾이는 모서리)을 찾지 못했습니다. 마진 라인 위를 칠했는지 확인하세요.",
      "empty-margin": "마진 라인을 구성하지 못했습니다.",
    };
    return { ok: false, reason: reasonText[res.reason] };
  }

  // 모든 STL 의 기존 마진 시각화·floodfill 을 정리한다 (감사 B4). marginRef 는
  //   단일 슬롯이므로 다른 STL 의 초록 튜브가 남으면 "보이지만 무효"가 된다
  //   (A 검출 → B 검출 시 A 튜브 잔존). 검출 진입 시 전체를 지워 화면=단일 슬롯
  //   유효 결과를 일치시킨다. floodfill 오버레이·autoFillFacesRef 도 함께 초기화.
  //   (아일랜드는 다른 단일 슬롯 — 여기서 건드리지 않는다. 마진+아일랜드 공존이
  //   autoSupportIslands 마진 가드의 전제이므로 교차 정리는 하지 않는다. 다중
  //   STL 을 개별 슬롯으로 동시에 유지하려면 향후 Map 다중화가 옵션이나, 현재는
  //   단일 슬롯 의미론을 유지한다.)
  disposeMarginVisualization(ctx);
  ctx.marginRef.current = { ...res.result, stlId };
  // 이 검출이 최신 painted 를 방금 소비했으므로, 색칠 스트로크가 예약해 둔
  //   지연 무효화는 무의미해진다. 취소하지 않으면 300ms 뒤 만료 타이머가
  //   방금 만든 이 유효 마진을 지워버린다(신선 결과 파괴 레이스).
  cancelPendingInvalidation(ctx, stlId);

  // 마진 라인 — 각 세그먼트를 얇은 튜브로 만들고 merge (원본 verbatim).
  //   WebGL LineSystem 은 thickness 1px 고정 → 두꺼운 선 표현 불가 →
  //   3D 튜브로 대체. 모델과 같은 렌더링 그룹 + 깊이 검사로 투과 없이 표시.
  const tubeBatch: Mesh[] = [];
  for (const e of res.result.edges) {
    const len = Vector3.Distance(e.pa, e.pb);
    if (len < 1e-6) continue;
    const tube = MeshBuilder.CreateTube(
      "v2_marginSeg",
      {
        path: [e.pa, e.pb],
        radius: 0.025, // ≈ 0.05mm 두께 (절반)
        tessellation: 6,
        cap: Mesh.NO_CAP,
      },
      scene,
    );
    tubeBatch.push(tube);
  }
  if (tubeBatch.length > 0) {
    const marginMesh = Mesh.MergeMeshes(
      tubeBatch,
      true,
      true,
      undefined,
      false,
      false,
    );
    if (marginMesh) {
      marginMesh.name = "v2_marginLines";
      marginMesh.isPickable = false;
      marginMesh.renderingGroupId = 0;
      marginMesh.metadata = { stlId };
      const mat = new StandardMaterial("v2_marginMat", scene);
      mat.emissiveColor = new Color3(0.2, 1, 0.4);
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      marginMesh.material = mat;
      marginMesh.setParent(mesh); // STL 회전·이동 추종 (원본 이식).
      ctx.marginMarkersRef.current.push(marginMesh);
    }
  }

  // 원본 console.log 문구 이식 (통계 — 디버그용).
  const s = res.result.stats;
  console.log(
    `[마진 찾기] 색칠 ${s.paintedFaceCount}면 · 시드 엣지 ${s.seedEdgeCount} · ` +
      `전역 sharp 엣지 ${s.globalSharpEdgeCount} · 마진 엣지 ${s.marginEdgeCount} (spur-trim + corner-ext 후) · ` +
      `corner extension ${s.cornerExtSteps}스텝 · 작은-컴포넌트 폐기 ${s.droppedTinyComps}엣지 · ` +
      `endpoint bridge ${s.surfacePathCount}쌍(${s.bridgeSegCount}세그) · 직선폴백 ${s.straightFallbackCount}쌍 · ` +
      `컴포넌트 간 bridge ${s.interCompPathCount}쌍 (region R=${s.seedRegionR.toFixed(1)}mm)`,
  );

  return { ok: true, stats: s };
}

/**
 * 활성 STL 전체에 대해 슬라이스 기반 아일랜드(미지지 영역)를 검출하고 마젠타
 * overlay 로 시각화한다.
 *   원본 STLViewer 의 detectIslandsSignal useEffect [씬/시각화 의존부] 이식 —
 *   알고리즘 코어는 detectSliceIslands(island-detection.ts, 잠금) 담당.
 *   호출 파라미터는 원본과 동일:
 *     · cellSize = layerHeight = lh (원본 sliceLayerHeight)
 *     · supportAngle 45° (원본 DEFAULT_SUPPORT_SETTINGS.supportAngle — v2 에는
 *       support-settings ref 가 없어 그 기본값을 명시. detectSliceIslands 의
 *       supportAngle ?? 45 기본과도 동일 → 수치 무변경.)
 *     · downFacingOnly true · minIslandCells 1 · plateGap 0
 *   debugLayers 는 전달하지 않는다(원본의 임시 진단 [41,42,43] 은 v2 에서 비활성이
 *   정답 — 지현규 문서 Step 2 의도).
 */
export function runDetectDentalIslands(
  ctx: SceneCtx,
  layerHeightMm?: number,
):
  | { ok: true; stats: IslandStats }
  | { ok: false; reason: string } {
  const scene = ctx.sceneRef.current;
  if (!scene) return { ok: false, reason: "씬이 준비되지 않았습니다." };
  const active = getActiveStl(ctx);
  if (!active) {
    // 원본 console.warn('Island 검출: 대상 STL이 없습니다.') → UI 문구.
    return { ok: false, reason: "대상 STL이 없습니다." };
  }
  const { id: stlId, mesh } = active;

  // 현재 STL 각도(회전/이동) 정확 반영 — worldMatrix 갱신 (원본 이식).
  mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo();

  const tris = readWorldTriangles(mesh);
  if (tris.length === 0) {
    // 원본 console.warn('Island 검출: 분석할 삼각형이 없습니다.') → UI 문구.
    return { ok: false, reason: "분석할 삼각형이 없습니다." };
  }

  const lh = layerHeightMm ?? 0.05; // 원본 sliceLayerHeight 기본 0.05mm.
  const t0 = performance.now();
  const result = detectSliceIslands({
    tris,
    cellSize: lh, // 라스터화 정밀도 = layer 두께 (원본 verbatim).
    layerHeight: lh,
    // 원본 supportSettingsRef.current.supportAngle (기본 45°). v2 는 support
    //   설정 ref 가 없어 그 기본값을 명시 — detectSliceIslands 기본과 동일.
    supportAngle: 45,
    // 위 향한 면(n.y > 0)은 서포트 불필요 → island 결과에서 제외 (원본 verbatim).
    downFacingOnly: true,
    minIslandCells: 1, // 슬라이스 sim 미지지 정의 일치 — 1-cell piece 도 포착.
    plateGap: 0, // plate 인접 layer 도 island 검출 (낮은 Y 의 piece 도 포착).
    // debugLayers 전달 안 함 — 원본 임시 진단 [41,42,43] 은 v2 에서 비활성.
  });
  const tDetect = performance.now() - t0;

  // 모든 STL 의 기존 island 시각화를 정리한다 (감사 B4). islandResultRef 는 단일
  //   슬롯이므로 다른 STL 의 마젠타 overlay 가 남으면 "보이지만 무효"가 된다.
  //   검출 진입 시 전체를 지워 화면=단일 슬롯 유효 결과를 일치시킨다. (마진은
  //   다른 단일 슬롯 — 여기서 건드리지 않는다: 마진+아일랜드 공존이
  //   autoSupportIslands 마진 가드의 전제. 위 runFindDentalMargin 주석 참조.)
  disposeIslandVisualization(ctx);
  // 슬림 보관 (감사 B7): islandFaces + stlId 만. result 의 나머지 대형 중간산물
  //   (sliceCells/sliceFaceCells/perLayer*)은 아래 overlay·통계 계산에서 지역
  //   변수 result 로 즉시 소비하고 폐기 — ref 로 세션 상주시키지 않는다.
  ctx.islandResultRef.current = { stlId, islandFaces: result.islandFaces };
  // 마진 검출과 동일 이유 — 이 검출이 최신 painted 를 소비했으므로 색칠이
  //   예약한 지연 무효화를 취소한다. 없으면 만료 타이머가 방금 만든 이 유효
  //   아일랜드 결과를 지운다(신선 결과 파괴 레이스).
  cancelPendingInvalidation(ctx, stlId);

  // Island face overlay — 검출된 island face 의 실제 STL triangle 을 표면
  //   conforming 마젠타로 표시 (원본 시각화 verbatim). mesh index 버퍼에서
  //   local vertex 를 직접 읽어 overlay.parent=mesh 로 얹는다.
  const meshIndices = mesh.getIndices();
  const meshPositions = mesh.getVerticesData("position");
  if (meshIndices && meshPositions && result.islandFaces.size > 0) {
    const positions: number[] = [];
    const indices: number[] = [];
    let vIdx = 0;
    for (const f of result.islandFaces) {
      for (let kk = 0; kk < 3; kk++) {
        const vi = meshIndices[f * 3 + kk];
        positions.push(
          meshPositions[vi * 3],
          meshPositions[vi * 3 + 1],
          meshPositions[vi * 3 + 2],
        );
      }
      indices.push(vIdx, vIdx + 1, vIdx + 2);
      vIdx += 3;
    }
    if (indices.length > 0) {
      const overlay = new Mesh("v2_islandFaces", scene);
      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      const norms: number[] = [];
      VertexData.ComputeNormals(positions, indices, norms);
      vd.normals = norms;
      vd.applyToMesh(overlay);
      const mat = new StandardMaterial("v2_islandFacesMat", scene);
      mat.emissiveColor = new Color3(1.0, 0.2, 0.85); // 마젠타 (원본 verbatim).
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.specularColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.zOffset = -1; // STL 표면보다 살짝 앞으로 — z-fighting 차단.
      overlay.material = mat;
      overlay.isPickable = false;
      overlay.renderingGroupId = 0;
      overlay.metadata = { stlId, kind: "islandFaces" };
      // local vertex → 직접 parent 할당 (setParent 아님 — worldMatrix 승계).
      overlay.parent = mesh;
      ctx.islandMarkersRef.current.push(overlay);
    }
  }

  const layersWithIsland = result.perLayerIslandCount.reduce(
    (n, c) => (c > 0 ? n + 1 : n),
    0,
  );

  // 원본 console.log 문구 이식 (통계 — 디버그용).
  const totalIslandCells = result.perLayerIslandCells.reduce(
    (s, c) => s + c.size,
    0,
  );
  console.log(
    `[Island 검출] 전체 face ${tris.length} · island face ${result.islandFaces.size} · ` +
      `island cell ${totalIslandCells} · layers ${result.nSlices} · ` +
      `layerHeight ${result.layerHeight}mm · cellSize ${result.cellSize}mm · ` +
      `supportAngle 45° (dSafe ${result.dSafe.toFixed(3)}mm, prevLayers ${result.prevLayers}, ` +
      `cellAdjR ${result.cellAdjR}) · ${tDetect.toFixed(0)}ms`,
  );

  return {
    ok: true,
    stats: {
      totalIslandFaces: result.islandFaces.size,
      nSlices: result.nSlices,
      layersWithIsland,
      layerHeight: result.layerHeight,
    },
  };
}

// fillMarginFromFace 는 dental-floodfill.ts 로 분리 (파일 500줄 상한 준수).
