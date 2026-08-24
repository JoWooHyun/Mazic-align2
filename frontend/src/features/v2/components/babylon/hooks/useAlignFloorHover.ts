// 바닥면 붙이기 — 마우스가 올라간 면을 미리 하이라이트 (B-25).
//
//   리드: "치투박스는 이렇게 돼. 저 노란색 부분이 바닥붙이기 했을때 바닥 붙고
//          나서 저렇게 바뀌지. 바닥에 붙으면 이렇게 노란색계열로 바뀌고."
//   → 어느 면을 클릭하는지/클릭했는지 **눈으로 보이는 피드백**이 필요하다.
//     종전에는 아무 표시 없이 모델이 갑자기 회전해 버려서, 의도한 면이
//     맞는지 확인할 방법이 없었다.
//
//   ## 동작
//   `alignFloorMode` 가 켜져 있을 때만 동작한다. 포인터가 STL 위를 지나가면
//   그 지점의 면에 **노란 데칼**을 얹어 "이 면이 바닥에 붙는다"를 미리 보여준다.
//   모드가 꺼지거나 포인터가 모델 밖으로 나가면 즉시 지운다.
//
//   ## 왜 데칼인가
//   `useDentalBrush` 가 이미 같은 방식으로 STL 표면에 밀착하는 색칠을 한다.
//   같은 수단을 쓰면 곡면(치아)에서도 표면을 따라 정확히 붙고, 모델의 vertex
//   color(오버행 하이라이트)를 건드리지 않는다.
//
//   ## 성능
//   포인터 이동마다 `scene.pick` + 데칼 1개 생성/폐기다. 브러쉬 모드가 이미
//   같은 부하로 돌고 있고(그쪽은 매 이동마다 데칼을 **누적**한다), 이 훅은
//   **항상 1개만** 유지하므로 더 가볍다. alignFloorMode 가 꺼져 있으면
//   옵저버 자체를 걸지 않는다.
import { useEffect } from "react";
import {
  Color3,
  MeshBuilder,
  PointerEventTypes,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import type { Mesh, PointerInfo } from "@babylonjs/core";

import type { SceneCtx } from "../scene-refs";

/** 하이라이트 색 — CHITUBOX 의 바닥붙이기 피드백과 같은 계열(노랑). */
const HILITE = new Color3(1.0, 0.82, 0.15);

/** 데칼 한 변 길이 (mm). 면을 알아볼 만큼 크되 모델을 덮지 않을 정도. */
const DECAL_SIZE_MM = 6;

export function useAlignFloorHover(
  ctx: SceneCtx,
  alignFloorMode: boolean,
): void {
  useEffect(() => {
    const scene = ctx.sceneRef.current;
    if (!scene) return;
    if (!alignFloorMode) return;

    let decal: Mesh | null = null;
    let material: StandardMaterial | null = null;

    const clear = () => {
      decal?.dispose();
      decal = null;
    };

    const onMove = (info: PointerInfo) => {
      if (info.type !== PointerEventTypes.POINTERMOVE) return;

      // STL 메쉬만 대상 — 플레이트·서포트·기즈모는 제외.
      const meshes = ctx.meshMapRef.current;
      const pick = scene.pick(scene.pointerX, scene.pointerY, (m) => {
        for (const stl of meshes.values()) if (m === stl) return true;
        return false;
      });

      clear();
      if (!pick?.hit || !pick.pickedMesh || !pick.pickedPoint) return;
      const normal = pick.getNormal(true, true);
      if (!normal) return;

      if (!material) {
        material = new StandardMaterial("v2_alignFloorHover_mat", scene);
        material.diffuseColor = HILITE;
        material.emissiveColor = HILITE.scale(0.6);
        material.specularColor = new Color3(0, 0, 0);
        material.zOffset = -2; // 표면 위로 확실히 올려 z-fighting 방지
      }

      decal = MeshBuilder.CreateDecal("v2_alignFloorHover", pick.pickedMesh, {
        position: pick.pickedPoint,
        normal,
        // 투영 깊이를 얕게 — 반대편(뒷면)까지 뚫고 찍히지 않게 한다
        //   (useDentalBrush 와 같은 이유).
        size: new Vector3(DECAL_SIZE_MM, DECAL_SIZE_MM, 2),
      });
      decal.material = material;
      decal.isPickable = false;
    };

    const observer = scene.onPointerObservable.add(onMove);

    return () => {
      scene.onPointerObservable.remove(observer);
      clear();
      material?.dispose();
      material = null;
    };
  }, [ctx, alignFloorMode]);
}
