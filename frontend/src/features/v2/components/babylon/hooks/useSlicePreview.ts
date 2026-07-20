// Z 슬라이스 미리보기 훅 — 원본 effect #5.5 순수 이동.
//   scene.clipPlane 으로 Y > sliceY 컬링 + 단면 polygon fill/outline 생성. 로직 무변경.
import { useEffect } from "react";
import {
  Color3,
  MeshBuilder,
  Plane,
  Vector3,
} from "@babylonjs/core";
import { chainSegments, sliceMeshAtY } from "../../../utils/slice-section";
import { buildPolygonFillMesh } from "../../../utils/slice-render";
import type { STLFileV2 } from "../../../types/stl";
import type { SupportParams, SupportPointV2 } from "../../../support/types";
import type { SceneCtx } from "../scene-refs";

export function useSlicePreview(
  ctx: SceneCtx,
  sliceY: number | null,
  files: STLFileV2[],
  supports: SupportPointV2[],
  supportParams: SupportParams,
): void {
  // 5.5) Z 슬라이스 미리보기:
  //   · scene.clipPlane 으로 Y > sliceY 영역 컬링.
  //   · 모든 mesh 의 단면 segment 계산 → chain → polygon fill mesh.
  //   · outline 라인은 polygon 경계 위에 얇게 그려 강조.
  useEffect(() => {
    const scene = ctx.sceneRef.current;
    const modelMat = ctx.sliceModelMatRef.current;
    const supportMat = ctx.sliceSupportMatRef.current;
    if (!scene || !modelMat || !supportMat) return;

    // 기존 fill / outline 정리.
    for (const fm of ctx.sliceFillMeshesRef.current) fm.dispose();
    ctx.sliceFillMeshesRef.current = [];
    ctx.sliceOutlineRef.current?.dispose();
    ctx.sliceOutlineRef.current = null;

    if (sliceY == null) {
      scene.clipPlane = null;
      return;
    }

    scene.clipPlane = new Plane(0, 1, 0, -sliceY);

    const yFill = sliceY + 0.005;
    const yLine = sliceY + 0.02;
    const lines: Vector3[][] = [];

    // 모델 단면.
    for (const mesh of ctx.meshMapRef.current.values()) {
      const segs = sliceMeshAtY(mesh, sliceY);
      if (segs.length === 0) continue;
      const polys = chainSegments(segs);
      for (const p of polys) {
        const fill = buildPolygonFillMesh(
          scene,
          p,
          yFill,
          modelMat,
          "v2_slice_model_fill",
        );
        if (fill) ctx.sliceFillMeshesRef.current.push(fill);
      }
      for (const s of segs) {
        lines.push([
          new Vector3(s.a[0], yLine, s.a[1]),
          new Vector3(s.b[0], yLine, s.b[1]),
        ]);
      }
    }

    // 서포트 단면.
    for (const sm of ctx.supportMeshMapRef.current.values()) {
      const segs = sliceMeshAtY(sm, sliceY);
      if (segs.length === 0) continue;
      const polys = chainSegments(segs);
      for (const p of polys) {
        const fill = buildPolygonFillMesh(
          scene,
          p,
          yFill,
          supportMat,
          "v2_slice_support_fill",
        );
        if (fill) ctx.sliceFillMeshesRef.current.push(fill);
      }
      for (const s of segs) {
        lines.push([
          new Vector3(s.a[0], yLine, s.a[1]),
          new Vector3(s.b[0], yLine, s.b[1]),
        ]);
      }
    }

    if (lines.length > 0) {
      const ol = MeshBuilder.CreateLineSystem(
        "v2_slice_outline",
        { lines },
        scene,
      );
      ol.color = new Color3(1.0, 0.55, 0.15);
      ol.isPickable = false;
      ctx.sliceOutlineRef.current = ol;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliceY, files, supports, supportParams]);
}
