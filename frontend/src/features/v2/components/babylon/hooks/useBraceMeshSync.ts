// 기둥 연결 브레이스 mesh 동기화 훅 (S-4b-2d 2단계).
//   `useSupportMeshSync` 와 **같은 diff 패턴** — rebuild key 가 같으면 재생성 skip.
//   브레이스는 STL 단위로 한 덩어리 메시를 만들므로 항목 수가 다리 수가 아니라
//   STL 수에 머문다(export·슬라이스가 다리 개수에 비례해 느려지지 않는다).
//
//   ## 🔴 왜 `ctx.supportMeshMapRef` 에 넣는가 (놓치면 조용히 깨진다)
//   이 맵은 렌더 전용이 아니다. `handle/slice-export-handle.ts` 의 **6곳**이 읽는다:
//     exportStl(:33) · getFdmSliceInput(:40) · getSliceMask(:81) ·
//     getSliceGeometry(:99) · getSceneTopY(:112) · getBuildVolumeMm3(:125)
//   밖에 두면 **화면에는 다리가 보이는데 실제 출력물(STL·CTB·G-code)에서는 빠진다.**
//   서포트 점 id 와 섞이지 않도록 `BRACE_MESH_KEY_PREFIX` 를 붙인다 — 접두사가
//   없으면 `useSupportMeshSync` 의 "newIds 에 없는 키는 dispose" 루프가 브레이스를
//   매번 지워 버린다(두 훅이 같은 맵을 공유하므로).
import { useEffect } from "react";
import type { StandardMaterial } from "@babylonjs/core";

import { createPillarBraceMesh } from "../../../support/assemble-support";
import type { PillarBraceRecord } from "../../../support/types";
import type { STLFileV2 } from "../../../types/stl";
import type { SceneCtx } from "../scene-refs";

/**
 * 브레이스 메시의 `supportMeshMapRef` 키 접두사.
 *   서포트 점 id 는 crypto.randomUUID 계열이라 이 접두사로 시작할 수 없다.
 *   `useSupportMeshSync` 도 이 접두사로 시작하는 키는 건드리지 않는다.
 */
export const BRACE_MESH_KEY_PREFIX = "brace:";

/** STL 하나치 브레이스 묶음의 재조립 판정 key. */
function buildBraceKey(
  braces: readonly PillarBraceRecord[],
  verticalSignal: string,
): string {
  const f = (v: number) => v.toFixed(3);
  return [
    verticalSignal,
    ...braces.map(
      (b) => `${b.id}@${b.from.map(f).join(",")}>${b.to.map(f).join(",")}:${f(b.radiusMm)}`,
    ),
  ].join("|");
}

export function useBraceMeshSync(
  ctx: SceneCtx,
  braces: PillarBraceRecord[],
  /** 부품 STL 로드 완료 여부. false 면 skip 후 로드되면 재실행. */
  partsReady: boolean,
  /** STL 목록. 수직 이동 감지 신호용 (useSupportMeshSync 와 같은 이유). */
  files: STLFileV2[],
): void {
  // 브레이스는 기둥과 달리 **플레이트 고정이 없어** 모델을 수직 이동해도 형상이
  //   안 변한다(전부 stl-local, parent auto-follow). 그래도 STL 이 새로 로드되면
  //   parent 를 다시 잡아야 하므로 같은 신호를 key 에 섞어 둔다 — 값이 안 바뀌면
  //   문자열도 같아 재실행·재조립이 없다(rebuild = freeze 불변식).
  const verticalSignal = files
    .map((f) => `${f.id}:${(f.transform?.ty ?? 0).toFixed(3)}`)
    .join("|");

  useEffect(() => {
    const scene = ctx.sceneRef.current;
    const mat = ctx.supportMaterialRef.current;
    if (!scene || !mat) return;
    const map = ctx.supportMeshMapRef.current;

    // STL 별로 묶는다 — 메시 1개당 parent 1개라 stlId 가 섞일 수 없다.
    const byStl = new Map<string, PillarBraceRecord[]>();
    for (const b of braces) {
      const list = byStl.get(b.stlId);
      if (list) list.push(b);
      else byStl.set(b.stlId, [b]);
    }

    // 1) 사라진 STL 묶음 dispose. **접두사가 붙은 키만** 본다 — 서포트 점 메시는
    //    `useSupportMeshSync` 소관이라 여기서 건드리면 안 된다.
    const liveKeys = new Set(
      Array.from(byStl.keys()).map((id) => `${BRACE_MESH_KEY_PREFIX}${id}`),
    );
    for (const [key, mesh] of Array.from(map)) {
      if (!key.startsWith(BRACE_MESH_KEY_PREFIX)) continue;
      if (!liveKeys.has(key)) {
        mesh.dispose();
        map.delete(key);
      }
    }

    // 부품 미로드면 기존 메시를 그대로 두고 이번엔 세우지 않는다(로드되면 재실행).
    if (!partsReady) return;

    // 2) STL 별 재조립 — key 동일하면 skip.
    for (const [stlId, list] of byStl) {
      const mapKey = `${BRACE_MESH_KEY_PREFIX}${stlId}`;
      const key = buildBraceKey(list, verticalSignal);
      const existing = map.get(mapKey);
      if (existing && existing.metadata?.rebuildKey === key) continue;
      if (existing) {
        existing.dispose();
        map.delete(mapKey);
      }

      const mesh = createPillarBraceMesh(
        scene,
        stlId,
        list,
        mat as StandardMaterial,
        ctx.meshMapRef.current,
      );
      // 부품 미로드 등으로 null 이면 이번 묶음은 skip (다음 재실행에서 재시도).
      if (!mesh) continue;
      mesh.metadata = { ...(mesh.metadata ?? {}), rebuildKey: key };
      // ★ 여기가 출력물 포함의 유일한 보장 지점 — 파일 머리 주석 참고.
      map.set(mapKey, mesh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [braces, partsReady, verticalSignal]);
}
