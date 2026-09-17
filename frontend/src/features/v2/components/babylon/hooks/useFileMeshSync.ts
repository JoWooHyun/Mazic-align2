// files→mesh 동기화 훅 — 원본 effect #2(STL 로드/제거/transform) + #3(오버행 색 재할당).
//   두 effect 는 원본에서 연속 선언(deps [files] → [overhangAngleDeg])이므로 이 훅에서도
//   그 순서로 등록한다. manifold man.delete() 짝, painted/margin/island 정리 등 무변경.
import { useEffect } from "react";
import { Mesh } from "@babylonjs/core";
import { loadStlIntoScene } from "../../../utils/stl-loader";
import { applyOverhangColors } from "../../../utils/overhang";
import { applyTransformToMesh } from "../../../utils/transform";
import { IDENTITY_TRANSFORM } from "../../../types/transform";
import { babylonMeshToManifold } from "../../../utils/manifold-csg";
import { frameCameraToMeshes } from "../../../utils/camera-views";
import type { STLFileV2 } from "../../../types/stl";
import type { SceneCtx } from "../scene-refs";
import { attachDragBehavior, refreshHighlight, syncGizmo } from "../scene-actions";
import {
  disposeIslandVisualization,
  disposeMarginVisualization,
} from "../dental-actions";
import { disposeRedesignVisualization } from "../redesign-detect-actions";

export function useFileMeshSync(
  ctx: SceneCtx,
  files: STLFileV2[],
  overhangAngleDeg: number,
  /**
   * STL 로드가 **실제로 끝났을 때**(meshMapRef 에 등록된 뒤) 호출된다 (H3).
   *
   * 로드는 `Promise.all(...).then(...)` 안에서 완료되므로, 같은 커밋에서 도는
   * 다른 훅들은 `meshMapRef.current.get(id)` 가 아직 undefined 다. 메쉬가 있어야
   * 동작하는 소비자(출력영역 검사 등)가 "새로 불러온 모델"을 놓치지 않도록
   * 완료 시점을 알린다.
   */
  onMeshesLoaded?: () => void,
): void {
  // 2) files 변경 시 메쉬 동기화
  useEffect(() => {
    const scene = ctx.sceneRef.current;
    const camera = ctx.cameraRef.current;
    if (!scene || !camera) return;

    let cancelled = false;

    const currentIds = new Set(ctx.meshMapRef.current.keys());
    const nextIds = new Set(files.map((f) => f.id));

    for (const id of currentIds) {
      if (!nextIds.has(id)) {
        const removedMesh = ctx.meshMapRef.current.get(id) ?? null;
        // 이 STL 의 dental-brush 색칠(painted 점 + 오버레이 데칼) 정리.
        //   오버레이 데칼은 STL mesh 의 child 라 dispose 로 함께 사라지지만
        //   paintPointsRef/paintOverlaysRef 배열은 stale ref 로 남으므로
        //   여기서 해당 mesh 엔트리를 제거해 stale painted 카운트를 막는다.
        if (removedMesh) {
          for (let i = ctx.paintPointsRef.current.length - 1; i >= 0; i--) {
            if (ctx.paintPointsRef.current[i].mesh === removedMesh) {
              ctx.paintPointsRef.current.splice(i, 1);
              ctx.paintOverlaysRef.current.splice(i, 1);
            }
          }
        }
        // 이 STL 의 마진 시각화(초록 튜브) + floodfill 오버레이(주황) 도 정리.
        //   튜브/오버레이는 mesh child 라 dispose 로 함께 사라지지만 ref/marginRef
        //   가 stale 로 남으므로 명시적으로 제거.
        disposeMarginVisualization(ctx, id);
        // 이 STL 의 아일랜드 마젠타 overlay + 결과 ref 도 정리 (2-3b 패턴).
        disposeIslandVisualization(ctx, id);
        // 재설계 검출 오버레이(파란 점)도 정리 — world 좌표 고정이라
        //   모델을 지워도 허공에 그대로 남는다(리드 실물 발견).
        //   stlId 구분이 없는 활성 STL 전용 디버그 오버레이라 통째로 지운다.
        disposeRedesignVisualization(ctx);
        removedMesh?.dispose();
        ctx.meshMapRef.current.delete(id);
        // 이 STL 의 painted 목록도 비었음을 부모에 통지 (세션 상태 sync).
        ctx.onPaintedFacesChangeRef.current?.(id, []);
        // manifold 객체도 dispose
        const m = ctx.stlManifoldMapRef.current.get(id);
        if (m) {
          m.delete();
          ctx.stlManifoldMapRef.current.delete(id);
        }
      }
    }

    const newFiles = files.filter((f) => !currentIds.has(f.id));
    const wasEmpty = currentIds.size === 0;

    Promise.all(
      newFiles.map(async (f) => {
        try {
          const mesh = await loadStlIntoScene(
            scene,
            f.blob,
            f.fileName,
            ctx.liftRef.current,
          );
          if (cancelled) {
            mesh.dispose();
            return null;
          }
          // ★ transform 을 **먼저** 적용한 뒤 색칠한다 (B-35). 색칠이 world
          //   법선으로 판정하므로, 순서가 뒤집히면 저장된 자세가 아직 반영되지
          //   않은 world 행렬로 칠해진다(프로젝트를 다시 열었을 때 회전이
          //   무시된 색). 아래 effect #3 이 곧바로 덮어쓰긴 하지만, 한 프레임
          //   틀린 색이 보이지 않도록 여기서도 순서를 맞춘다.
          applyTransformToMesh(mesh, f.transform ?? IDENTITY_TRANSFORM);
          applyOverhangColors(mesh, ctx.overhangRef.current);
          mesh.isPickable = true;
          attachDragBehavior(ctx, mesh, f.id);
          ctx.meshMapRef.current.set(f.id, mesh);
          // STL 의 manifold 객체 생성 (한 번, STL local 좌표 — transform
          // 적용 X). Bridge subtract 시 Bridge 도 STL local 로 변환해
          // 동일 공간에서 boolean → STL transform 변경 무관 cache hit.
          const mod = ctx.manifoldModuleRef.current;
          if (mod) {
            const t0 = performance.now();
            const man = babylonMeshToManifold(mesh, mod, null);
            if (man) {
              ctx.stlManifoldMapRef.current.set(f.id, man);
              const status = man.status();
              console.log(
                `[manifold] STL ${f.fileName} → status=${status} (${(performance.now() - t0).toFixed(0)} ms, numTri=${man.numTri()})`,
              );
            }
          }
          return mesh;
        } catch (e) {
          console.error("[v2] STL 로드 실패", f.fileName, e);
          return null;
        }
      }),
    ).then((loaded) => {
      if (cancelled) return;
      if (wasEmpty && loaded.some((m) => m !== null)) {
        frameCameraToMeshes(
          camera,
          loaded.filter((m): m is Mesh => m !== null),
        );
      }
      refreshHighlight(ctx);
      // load 가 끝난 뒤에야 mesh 가 존재하므로 여기서 다시 attach.
      syncGizmo(ctx);
      // 메쉬가 meshMapRef 에 올라온 **뒤** 소비자에게 알린다 (H3).
      //   실제로 새로 로드된 것이 있을 때만 — 없으면 불필요한 리렌더가 된다.
      if (loaded.some((m) => m !== null)) onMeshesLoaded?.();
    });

    // 기존 메쉬들은 transform 변경 가능성 체크
    for (const f of files) {
      if (currentIds.has(f.id)) {
        const mesh = ctx.meshMapRef.current.get(f.id);
        if (mesh) {
          applyTransformToMesh(mesh, f.transform ?? IDENTITY_TRANSFORM);
        }
      }
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // 3) 임계각 변경 **또는 transform 커밋** 시 모든 메쉬 색 재할당
  //
  // ★ B-35 — deps 에 `files` 를 더한다. 색칠이 world 법선 기준이 된 이상
  //   (overhang.ts 참고) 모델 자세가 바뀔 때마다 다시 칠해야 한다. 종전에는
  //   deps 가 [overhangAngleDeg] 뿐이라 각도를 건드릴 때만 갱신됐다.
  //
  //   왜 `files` 가 그 신호인가: transform 커밋은 useTransformCommit →
  //   useStlFilesV2.updateTransform → repo.updateStlFile → refresh() →
  //   setFiles(await listStlFilesByProject(...)) 로 이어져 **IndexedDB 에서
  //   새로 읽은 배열**이 들어온다. 즉 이동·회전·크기 커밋마다 참조가 바뀐다.
  //
  //   ⚠️ 드래그 **중**(previewTransform)은 camera-handle 이 mesh 를 직접
  //   건드릴 뿐 files 를 갱신하지 않는다 → 매 프레임 전 정점 순회가 도는 일은
  //   없고, 커밋 후 1회만 돈다. 전 정점 루프를 프레임 경로에 올리지 않기 위한
  //   의도적 선택이다.
  //
  //   순서: 이 effect 는 위 #2 보다 **뒤에** 선언돼 있고, #2 는 기존 메쉬의
  //   transform 을 동기적으로 적용한다(아래쪽 for 루프). 따라서 같은 커밋에서
  //   여기 도달했을 때 메쉬는 이미 새 자세다 — world 법선이 최신이다.
  //   (새로 로드되는 메쉬는 #2 의 비동기 then 안에서 자체적으로 색칠한다.)
  useEffect(() => {
    for (const mesh of ctx.meshMapRef.current.values()) {
      applyOverhangColors(mesh, overhangAngleDeg);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overhangAngleDeg, files]);
}
