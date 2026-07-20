// 서포트 점 diff 동기화 훅 — 원본 effect #3.5 순수 이동.
//   각 support 의 rebuild key(STL local 좌표+params)가 동일하면 mesh 재생성 skip.
//   mesh.parent = stlMesh 로 STL transform auto-follow → freeze 0. clipBridgeWithManifold
//   는 bridge-clip.ts 로 추출해 인자화(ctx, supportParams)했다. 로직·수치 무변경.
import { useEffect } from "react";
import { Matrix, StandardMaterial, Vector3 } from "@babylonjs/core";
import { createSupportMesh } from "../../../utils/support-render";
import { createSupport as createDiscSupport } from "../../../utils/dental/dental-support";
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

      // disc variant — 지현규 dental disc 서포트. trunk/bridge 렌더
      //   (createSupportMesh) 와 완전 분기. contact 는 world 좌표(manual
      //   support 와 동일 규약)이며, createDiscSupport 가 그 지점부터
      //   plate(Y=0)까지 world-space mesh 를 만든다. parent 없음 →
      //   기존 manual/world support 와 동일하게 STL transform 시 재빌드.
      if (p.variant === "disc") {
        const ds = p.discSettings;
        // discSettings 없는 disc = 데이터 이상 → skip. existing 은 위에서 이미
        //   dispose 됐으므로 map 에서도 지워 disposed mesh 가 잔류하지 않게 한다
        //   (감사 B5 — export/슬라이스가 map 값을 순회하므로 잔류 시 유령 mesh).
        if (!ds) {
          map.delete(p.id);
          continue;
        }
        const discMesh = createDiscSupport(
          scene,
          new Vector3(p.contact[0], p.contact[1], p.contact[2]),
          p.contactNormal
            ? new Vector3(
                p.contactNormal[0],
                p.contactNormal[1],
                p.contactNormal[2],
              )
            : new Vector3(0, 1, 0),
          ds,
        );
        // 목이 너무 짧은 등 생성 실패 → skip. existing dispose 후 map 잔류를
        //   막아 disposed mesh 가 export/슬라이스 경로에 남지 않게 한다 (감사 B5).
        if (!discMesh) {
          map.delete(p.id);
          continue;
        }
        // dental createSupport 는 호출마다 자체 StandardMaterial 을
        //   새로 만든다. disc 는 parent 가 없어 rebuild skip 이 안 되고
        //   effect 마다 전량 재생성되므로, mesh dispose 지점(1928/1968)
        //   이 material 을 지우지 않으면 무한 누적된다. 개별 material 을
        //   공용 supportMaterial 로 교체하고 원본을 즉시 dispose →
        //   두 dispose 지점 모두에서 릭 없음 (mesh 만 지워도 안전).
        const ownMat = discMesh.material;
        discMesh.material = mat;
        ownMat?.dispose();
        // 선택/삭제(support 모드)용 metadata — createSupportMesh 와 동일
        //   규약 (type/supportId/stlId) + rebuildKey.
        discMesh.isPickable = ctx.editModeRef.current === "support";
        discMesh.metadata = {
          type: "support",
          supportId: p.id,
          stlId: p.stlId,
          baseStlId: p.baseStlId,
          rebuildKey: key,
        };
        map.set(p.id, discMesh);
        continue;
      }

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
