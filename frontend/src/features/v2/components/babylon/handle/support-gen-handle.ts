// 서포트 생성 핸들 그룹 — generateAutoSupports/autoSupportIslands.
//   원본 useImperativeHandle 의 자동 서포트 메서드를 순수 이동. 검출 영역 자동 서포트
//   (autoSupportIslands)는 island faceFilter + 마진 가드 + 이동 후 표면 재검증 포함.
//   로직·수치·문자열 무변경.
import { Ray, Vector3 } from "@babylonjs/core";
import { autoGenerateSupportPoints } from "../../../support/utils/auto-generate";
import { guardContactAgainstMargin } from "../../../utils/dental/margin-guard";
import type { SupportPointV2 } from "../../../support/types";
import type { BabylonSceneHandle } from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";
import { disposeIslandVisualization } from "../dental-actions";

type SupportGenHandle = Pick<
  BabylonSceneHandle,
  "generateAutoSupports" | "autoSupportIslands"
>;

export function buildSupportGenHandle(ctx: SceneCtx): SupportGenHandle {
  return {
    generateAutoSupports(projectId, params) {
      const scene = ctx.sceneRef.current;
      if (!scene) return [];
      const out: SupportPointV2[] = [];
      const all = Array.from(ctx.meshMapRef.current.entries());
      for (const [stlId, mesh] of all) {
        const others = all
          .filter(([id]) => id !== stlId)
          .map(([, m]) => m);
        const pts = autoGenerateSupportPoints(
          scene,
          mesh,
          others,
          params,
          projectId,
          stlId,
        );
        out.push(...pts);
      }
      return out;
    },
    autoSupportIslands(projectId, params) {
      const scene = ctx.sceneRef.current;
      if (!scene) return null;
      const island = ctx.islandResultRef.current;
      // 아일랜드 검출 결과가 없으면 파이프라인 시작점이 없음 → null.
      if (!island || island.islandFaces.size === 0) return null;

      const stlId = island.stlId;
      const mesh = ctx.meshMapRef.current.get(stlId);
      if (!mesh) return null;

      // island face 집합 = faceFilter — 후보 접점을 검출 영역 위로만 제한.
      const others = Array.from(ctx.meshMapRef.current.entries())
        .filter(([id]) => id !== stlId)
        .map(([, m]) => m);
      const pts = autoGenerateSupportPoints(
        scene,
        mesh,
        others,
        params,
        projectId,
        stlId,
        { faceFilter: island.islandFaces },
      );

      // 같은 STL 의 마진 결과가 있으면 각 접점에 margin-guard 적용 —
      //   마진 라인 밖으로 밀어내고, 확보 못 하면 배제 (원본 scopedSupport 이식).
      //   원본 bodyR = settings.tipBottomDiameter (disc 팁 아랫면 지름 = 마진에
      //   가장 가까운 접점 부위). v2 SupportParams 에는 tipBottomDiameter 필드가
      //   없어, 접점(팁) 지름인 tipDiameterMm 를 그 대응값으로 쓴다. (마진 가드는
      //   접점 근방 클리어런스이므로 팁 지름이 가장 근접한 의미 대응.)
      const margin =
        ctx.marginRef.current && ctx.marginRef.current.stlId === stlId
          ? ctx.marginRef.current
          : null;
      if (!margin) {
        console.log(
          `[검출 영역 자동 서포트] island face ${island.islandFaces.size}면 → ` +
            `생성 ${pts.length}개 (마진 없음 — 가드 미적용)`,
        );
        // 생성 성공 시 island 검출 상태를 소진 (감사 B6): 마젠타 overlay +
        //   islandResultRef 를 정리해 같은 자리에 중복 생성/stale 결과 재사용을
        //   막는다. 페이지 islandStatus 리셋은 handleAutoSupportIslands 가 담당
        //   → 버튼 자연 비활성 (재클릭하려면 재검출). 빈 배열이면 소진하지 않아
        //   사용자가 파라미터를 바꿔 재시도할 수 있게 한다. 마진 결과는 건드리지
        //   않는다 (island 만 소진).
        if (pts.length > 0) disposeIslandVisualization(ctx, stlId);
        return pts;
      }

      const bodyR = params.tipDiameterMm;
      // 재검증용 mesh AABB — 아래→위 ray 발사 범위 (auto-generate 와 동일 규약).
      mesh.computeWorldMatrix(true);
      mesh.refreshBoundingInfo();
      const bb = mesh.getBoundingInfo().boundingBox;
      const reYTop = bb.maximumWorld.y + 1;
      const reYBelow = bb.minimumWorld.y - 1;
      const reRayLen = reYTop - reYBelow;
      const reUp = new Vector3(0, 1, 0);
      const otherMeshes = Array.from(ctx.meshMapRef.current.entries())
        .filter(([id]) => id !== stlId)
        .map(([, m]) => m);
      const PEN = 0.3; // auto-generate 와 동일 — contact 를 표면 안쪽으로 push.

      const guarded: SupportPointV2[] = [];
      let excluded = 0;
      let moved = 0;
      for (const p of pts) {
        const adj = guardContactAgainstMargin(
          p.contact,
          margin.points,
          bodyR,
        );
        if (!adj) {
          excluded++;
          continue;
        }
        const didMove =
          Math.abs(adj[0] - p.contact[0]) > 1e-6 ||
          Math.abs(adj[2] - p.contact[2]) > 1e-6;
        if (!didMove) {
          // XZ 불변 → 원본 접점 그대로 (표면 재검증 불필요).
          guarded.push(p);
          continue;
        }

        // ── 이동 후 표면 재검증 (원본 STLViewer scopedSupport 3482-3490 이식) ──
        //   가드 push 로 XZ 가 바뀌면 그 새 XZ 에서 표면을 다시 raycast 해 Y 를
        //   재스냅한다. v2 데이터는 IndexedDB 최종 커밋이라 뒤에서 보정 기회가
        //   없으므로, 히트 없음/island 이탈이면 어중간한 보정 대신 폐기한다.
        //   ray 방향은 auto-generate 와 동일(아래→위)로 맞춰 face 번호 체계 일치.
        const reOrigin = new Vector3(adj[0], reYBelow, adj[2]);
        const reInfo = scene.pickWithRay(
          new Ray(reOrigin, reUp, reRayLen),
          (m) => m === mesh,
        );
        // 1) 히트 없으면 폐기.
        if (!reInfo?.hit || !reInfo.pickedPoint) {
          excluded++;
          continue;
        }
        // 2) island faceFilter 재확인 — 이동으로 검출 영역 밖이면 폐기.
        if (
          reInfo.faceId < 0 ||
          !island.islandFaces.has(reInfo.faceId)
        ) {
          excluded++;
          continue;
        }
        const reNormal = reInfo.getNormal(true, true);
        if (!reNormal) {
          excluded++;
          continue;
        }
        // 3) 새 pickedPoint/normal 로 contact 재계산 (PEN 0.3 push 규약 포함).
        const cX = reInfo.pickedPoint.x - reNormal.x * PEN;
        const cY = reInfo.pickedPoint.y - reNormal.y * PEN;
        const cZ = reInfo.pickedPoint.z - reNormal.z * PEN;
        // 4) base 동기화 — 새 contact XZ 로. 원본 base Y 가 0(플레이트)이면 그대로
        //    유지, 다른 STL 표면(base Y>0)이었으면 새 XZ 에서 base Y 재확인.
        let baseY = 0;
        if (p.base[1] > 0 && otherMeshes.length > 0 && cY > 0) {
          const downRay = new Ray(
            new Vector3(cX, cY - 0.01, cZ),
            new Vector3(0, -1, 0),
            cY,
          );
          for (const om of otherMeshes) {
            const hit = om.intersects(downRay, false);
            if (hit.hit && hit.pickedPoint && hit.pickedPoint.y > baseY) {
              baseY = hit.pickedPoint.y;
            }
          }
        }
        moved++;
        guarded.push({
          ...p,
          contact: [cX, cY, cZ],
          base: [cX, baseY, cZ],
        });
      }
      console.log(
        `[검출 영역 자동 서포트] island face ${island.islandFaces.size}면 → ` +
          `후보 ${pts.length}개 · 마진 가드 이동 ${moved} · 배제 ${excluded} → ` +
          `생성 ${guarded.length}개 (marginPoints ${margin.points.length}개 · ` +
          `가드 ${bodyR.toFixed(2)}mm + 0.5mm)`,
      );
      // 생성 성공 시 island 검출 상태 소진 (감사 B6 — 위 마진 없음 분기와 동일).
      //   마진 결과(marginRef)는 유지, island overlay/ref 만 정리한다.
      if (guarded.length > 0) disposeIslandVisualization(ctx, stlId);
      return guarded;
    },
  };
}
