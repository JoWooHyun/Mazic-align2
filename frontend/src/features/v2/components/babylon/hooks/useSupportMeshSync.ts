// 서포트 점 diff 동기화 훅 — 원본 effect #3.5 순수 이동.
//   각 support 의 rebuild key(저장 좌표+params)가 동일하면 mesh 재생성 skip.
//   stl-local 점은 mesh.parent = stlMesh 로 STL transform auto-follow → freeze 0.
//   world 저장 점은 커밋 patch 로 저장 좌표가 바뀔 때만 1회 재생성(데모 사고 방지 1차 A).
//   clipBridgeWithManifold 는 bridge-clip.ts 로 추출해 인자화(ctx, supportParams)했다.
import { useEffect } from "react";
import type { Matrix, StandardMaterial } from "@babylonjs/core";
import { createSupportMesh } from "../../../utils/support-render";
import { createRedesignSupportMesh } from "../../../support/assemble-support";
import type { SupportParams, SupportPointV2 } from "../../../support/types";
import type { STLFileV2 } from "../../../types/stl";
import type { SceneCtx } from "../scene-refs";
import { buildSupportRebuildKey } from "../support-key-inputs";
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
  /**
   * STL 로드 완료 신호 (BabylonScene 의 meshLoadTick — useFileMeshSync 콜백으로 증가).
   *
   * 데모 사고 방지 1차 B: STL 로드는 비동기라 프로젝트를 다시 열면 supports 가
   * 메시보다 먼저 도착한다. 그때 stl-local 점은 stlMesh 없이 (로컬 좌표를 world 로
   * 간주해) parent 없이 만들어지는데, 종전 deps 에는 로드 완료 신호가 없어 다시
   * 만들 계기가 없었다 → 재설계 서포트가 엉뚱한 자리에 섰다. 이 tick 으로
   * 재실행되면 아래 skip 조건(stl-local 인데 parent 없음 → 재생성)이 올바른
   * parent·위치로 다시 세운다. 브릿지 clip 도 같은 신호로 다시 시도된다
   * (support-key-inputs `buildSupportRebuildKey` 주석).
   */
  meshLoadTick: number,
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
  //   · 각 support 의 rebuild key = 저장 좌표 + params.
  //     - stl-local 점: 저장 좌표가 STL local 이라 STL transform 에 key 불변 →
  //       rebuild skip, mesh.parent = stlMesh 로 자동 follow → freeze 0.
  //     - world 저장 점: 저장 world 좌표 그대로. 모델 커밋이 좌표를 patch 하면
  //       key 가 바뀌어 새 자리에서 1회 재생성, 안 움직였으면 skip.
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
      let stlWorld: Matrix | null = null;
      if (stlMesh) {
        stlMesh.computeWorldMatrix(true);
        stlWorld = stlMesh.getWorldMatrix();
      }
      const redesign = isRedesignPoint(p);
      // key 입력(좌표 + B-18 접점 world Y) 계산은 순수 함수로 추출 — 규칙·근거는
      //   support-key-inputs.ts 주석. stl-local 점은 종전과 같은 key, world 저장
      //   점은 저장 world 좌표 그대로(로컬화 X → 커밋 patch 시 key 변경).
      //   bridgeClipReady 는 아래 Bridge clip 분기 + clipBridgeWithManifold 의
      //   전제(manifold 모듈 + 이 점의 STL 메시 + STL manifold)와 같다.
      const bridgeClipReady =
        !!mod && !!stlMesh && ctx.stlManifoldMapRef.current.has(p.stlId);
      const key = buildSupportRebuildKey(
        p,
        supportParams,
        stlWorld,
        redesign,
        bridgeClipReady,
      );

      // 재설계(island/slope) 점인데 부품 미로드면 이번엔 skip (기존 mesh 는
      //   그대로 둔다). partsReady 가 true 로 바뀌면 effect 재실행되어 세운다.
      if (redesign && !partsReady) continue;

      const existing = map.get(p.id);
      // skip 조건: key 동일 + mesh 가 stlMesh child (auto-follow). parent
      // 없는 mesh 는 STL 이동 시 world 위치 그대로 남으므로 재생성 필요.
      // 단 base 가 플레이트(Y=0, coordSpace!=='stl-local')인 재설계 점은 parent
      // 가 없어도 정상 — parent 유무 skip 조건에서 제외한다.
      // world 저장 점이 parent 없이 skip 돼도 안전한 이유: 모델 이동은 커밋 patch
      // 로 저장 좌표를 바꾸고, 그러면 key 가 달라져 skip 되지 않는다(1차 A).
      // stl-local 점이 stlMesh 미로드로 parent 없이 만들어졌으면(재오픈) 이 조건에
      // 걸리지 않으므로 meshLoadTick 재실행 때 재생성된다(1차 B).
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
  }, [supports, supportParams, partsReady, verticalSignal, meshLoadTick]);
}
