// 서포트 점 diff 동기화 훅 — 원본 effect #3.5 순수 이동.
//   각 support 의 rebuild key(STL local 좌표+params)가 동일하면 mesh 재생성 skip.
//   mesh.parent = stlMesh 로 STL transform auto-follow → freeze 0. clipBridgeWithManifold
//   는 bridge-clip.ts 로 추출해 인자화(ctx, supportParams)했다. 로직·수치 무변경.
import { useEffect } from "react";
import { Matrix, StandardMaterial, Vector3 } from "@babylonjs/core";
import { createSupportMesh } from "../../../utils/support-render";
import { createRedesignSupportMesh } from "../../../support/assemble-support";
import type { SupportParams, SupportPointV2 } from "../../../support/types";
import type { STLFileV2 } from "../../../types/stl";
import type { SceneCtx } from "../scene-refs";
import { buildSupportKey } from "../support-keys";
import { clipBridgeWithManifold } from "../bridge-clip";

/** 재설계(화살촉+수직 기둥) 경로로 갈 점인지. kind 있는 점만 새 경로. */
function isRedesignPoint(p: SupportPointV2): boolean {
  return p.kind === "island" || p.kind === "slope";
}

export function useSupportMeshSync(
  ctx: SceneCtx,
  supports: SupportPointV2[],
  supportParams: SupportParams,
  /** 부품 STL 로드 완료 여부. false 면 재설계 점은 skip 후 로드되면 재실행. */
  partsReady: boolean,
  /** STL 목록. B-18 수직 이동 감지용 (아래 verticalSignal 주석 참고). */
  files: STLFileV2[],
): void {
  // B-18: 모델을 수직 이동하면 재설계 기둥의 **길이가 달라져** 재조립이 필요한데,
  //   이 effect 의 종전 deps([supports, supportParams, partsReady])에는 모델
  //   transform 이 없어 아예 재실행되지 않았다(수직 이동은 supports 를 건드리지
  //   않으므로). 그래서 **각 STL 의 세로 위치만** 뽑아 문자열 신호로 만들어 dep 에
  //   넣는다. 배열이 아니라 문자열이라 값이 같으면 참조도 같아 재실행이 없다.
  //   ⚠️ ty 만 담는다 — tx/tz·회전·스케일까지 넣으면 수평 드래그 매 프레임마다
  //   전체 서포트가 재조립돼 freeze 원인이 된다(이 훅의 핵심 불변식: rebuild=freeze).
  //   수평 이동·수직축 회전은 parent auto-follow 로 이미 올바르게 따라가므로
  //   재조립할 이유가 없다.
  const verticalSignal = files
    .map((f) => `${f.id}:${(f.transform?.ty ?? 0).toFixed(3)}`)
    .join("|");
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
      // stl-local 점은 저장 좌표가 **이미 로컬**이라 그대로 키에 쓴다.
      //   toLocal 을 또 걸면 inv(world) 가 이중으로 곱해져, 모델 transform 후
      //   effect 가 재실행될 때마다 키가 달라진다 → 불필요한 재생성(B-2).
      //   그대로 쓰면 transform 후에도 키 불변 = 재생성 skip, parent follow 유지.
      //   world 점(구 경로)은 기존대로 inv(world) 로 로컬화한다.
      const isLocal = p.coordSpace === "stl-local";
      const lc = isLocal ? p.contact : toLocal(p.contact);
      const lb = isLocal ? p.base : toLocal(p.base);
      const lcps = p.curveControlPoints
        ? isLocal
          ? p.curveControlPoints
          : p.curveControlPoints.map(toLocal)
        : null;
      const redesign = isRedesignPoint(p);
      // B-18: 재설계 기둥은 발이 플레이트(world Y=0)에 고정돼 모델이 오르내리면
      //   **기둥 길이 자체가 변한다** — parent auto-follow 로는 안 되는 형상 변화라
      //   반드시 재조립해야 한다. local 좌표만 담긴 key 는 수직 이동에 불변이므로
      //   접점의 world Y 를 섞어 "길이가 달라졌으면 재조립" 이 되게 한다.
      //   (다른 경로는 인자를 안 넘겨 종전 key 유지 — 무회귀.)
      //   ※ stl-local 점만 대상 — world 저장 점은 p.contact 가 이미 world 라
      //     world matrix 를 또 곱하면 안 된다(그 경로는 종전대로 key 불변).
      const surfaceWorldY =
        redesign && stlMesh && isLocal
          ? Vector3.TransformCoordinates(
              new Vector3(p.contact[0], p.contact[1], p.contact[2]),
              stlMesh.getWorldMatrix(),
            ).y
          : undefined;
      const key = buildSupportKey(
        p,
        supportParams,
        lc,
        lb,
        lcps,
        surfaceWorldY,
      );

      // 재설계(island/slope) 점인데 부품 미로드면 이번엔 skip (기존 mesh 는
      //   그대로 둔다). partsReady 가 true 로 바뀌면 effect 재실행되어 세운다.
      if (redesign && !partsReady) continue;

      const existing = map.get(p.id);
      // skip 조건: key 동일 + mesh 가 stlMesh child (auto-follow). parent
      // 없는 mesh 는 STL 이동 시 world 위치 그대로 남으므로 재생성 필요.
      // 단 base 가 플레이트(Y=0, coordSpace!=='stl-local')인 재설계 점은 parent
      // 가 없어도 정상 — parent 유무 skip 조건에서 제외한다.
      if (
        existing &&
        existing.metadata?.rebuildKey === key &&
        (existing.parent || p.coordSpace !== "stl-local")
      ) {
        continue;
      }
      if (existing) existing.dispose();

      // 재설계 점 → 화살촉+수직 기둥 조립 경로. 그 외(trunk/bridge/manual) →
      //   기존 createSupportMesh 경로(무변경).
      const m = redesign
        ? createRedesignSupportMesh(
            scene,
            p,
            supportParams,
            mat as StandardMaterial,
            ctx.meshMapRef.current,
          )
        : createSupportMesh(
            scene,
            p,
            supportParams,
            mat,
            ctx.meshMapRef.current,
          );
      // 부품 미로드 등으로 null 이면 이번 점은 skip (다음 재실행에서 재시도).
      if (!m) continue;
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
  }, [supports, supportParams, partsReady, verticalSignal]);
}
