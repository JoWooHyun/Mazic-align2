// 서포트 점 diff 동기화 훅 — 원본 effect #3.5 순수 이동.
//   각 support 의 rebuild key(STL local 좌표+params)가 동일하면 mesh 재생성 skip.
//   mesh.parent = stlMesh 로 STL transform auto-follow → freeze 0. clipBridgeWithManifold
//   는 bridge-clip.ts 로 추출해 인자화(ctx, supportParams)했다. 로직·수치 무변경.
import { useEffect } from "react";
import { Matrix, StandardMaterial, Vector3 } from "@babylonjs/core";
import { createSupportMesh } from "../../../utils/support-render";
import type { SupportParams, SupportPointV2 } from "../../../support/types";
import type { SceneCtx } from "../scene-refs";
import { buildSupportKey } from "../support-keys";
import { clipBridgeWithManifold } from "../bridge-clip";

export function useSupportMeshSync(
  ctx: SceneCtx,
  supports: SupportPointV2[],
  supportParams: SupportParams,
): void {
  // 3.5) 서포트 점 동기화 — diff-based.
  //   · 각 support 의 rebuild key = STL local 좌표 + params (STL transform
  //     은 world 만 바꾸고 local 은 안 바꿈 → key 동일 → rebuild skip).
  //   · mesh.parent = stlMesh 라 STL transform 시 자동 follow → freeze 0.
  //   · 삭제된 support: dispose. 추가/변경된 support: 재생성.
  useEffect(() => {
    const scene = ctx.sceneRef.current;
    const mat = ctx.supportMaterialRef.current;
    if (!scene || !mat) return;

    const mod = ctx.manifoldModuleRef.current;
    const map = ctx.supportMeshMapRef.current;

    // 1) 삭제된 support mesh dispose.
    const newIds = new Set(supports.map((s) => s.id));
    for (const [id, mesh] of Array.from(map)) {
      if (!newIds.has(id)) {
        mesh.dispose();
        map.delete(id);
        // Bridge subtract 결과 캐시도 함께 정리 (감사 B9). 캐시는 point.id 키라
        //   (buildBridgeClipKey 호출부 set/get 참조) 삭제된 support 의 clip 산출물이
        //   세션 내내 잔류하지 않게 한다. 삭제 후 같은 id 재사용은 없다.
        ctx.bridgeClipCacheRef.current.delete(id);
      }
    }

    // 2) 각 support 처리 — key 동일하면 skip.
    for (const p of supports) {
      const stlMesh = ctx.meshMapRef.current.get(p.stlId);
      let stlInvWorld: Matrix | null = null;
      if (stlMesh) {
        stlMesh.computeWorldMatrix(true);
        stlInvWorld = Matrix.Invert(stlMesh.getWorldMatrix());
      }
      const toLocal = (
        w: [number, number, number],
      ): [number, number, number] => {
        if (!stlInvWorld) return w;
        const v = Vector3.TransformCoordinates(
          new Vector3(w[0], w[1], w[2]),
          stlInvWorld,
        );
        return [v.x, v.y, v.z];
      };
      const lc = toLocal(p.contact);
      const lb = toLocal(p.base);
      const lcps = p.curveControlPoints
        ? p.curveControlPoints.map(toLocal)
        : null;
      const key = buildSupportKey(p, supportParams, lc, lb, lcps);

      const existing = map.get(p.id);
      // skip 조건: key 동일 + mesh 가 stlMesh child (auto-follow). parent
      // 없는 mesh 는 STL 이동 시 world 위치 그대로 남으므로 재생성 필요.
      if (
        existing &&
        existing.metadata?.rebuildKey === key &&
        existing.parent
      ) {
        continue;
      }
      if (existing) existing.dispose();

      const m = createSupportMesh(
        scene,
        p,
        supportParams,
        mat,
        ctx.meshMapRef.current,
      );
      m.isPickable = ctx.editModeRef.current === "support";

      let finalMesh = m;
      // Bridge — manifold-3d 로 STL 침투 부분 깎아내기.
      if (
        p.source === "bridge" &&
        mod &&
        ctx.stlManifoldMapRef.current.size > 0
      ) {
        const clipped = clipBridgeWithManifold(
          ctx,
          supportParams,
          m,
          p,
          mat as StandardMaterial,
          scene,
          mod,
        );
        if (clipped) {
          clipped.isPickable = ctx.editModeRef.current === "support";
          finalMesh = clipped;
        }
      }
      finalMesh.metadata = {
        ...(finalMesh.metadata ?? {}),
        rebuildKey: key,
      };
      map.set(p.id, finalMesh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supports, supportParams]);
}
