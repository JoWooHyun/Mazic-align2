// Z 슬라이스 미리보기 훅 — 원본 effect #5.5 순수 이동.
//   scene.clipPlane 으로 Y > sliceY 컬링 + 단면 polygon fill/outline 생성. 로직 무변경.
//   Task0 2재료(D2): fill 머티리얼은 material-display sliceFillMaterialFor 로 고른다 — 재료 색 상태가 없으면 종전 그대로
//   (STL = sliceModelMat, 서포트 = sliceSupportMat), 있으면 슬롯 fill(STL = 파일 슬롯, 서포트 = A). fill 마다 정체 표식
//   (metadata.sliceFill)을 달아 상태가 바뀌면 이미 그려진 fill 도 setMaterialSlotColors 가 바로 바꾼다(applySliceFillMaterials).
//   단면 뚜껑(2026-10-23): fill 은 메시마다 하나 — 그 메시의 단면 폴리곤 전부를 2D 마스크와 같은 nonzero 규칙으로 채운다
//   (buildSliceFillMesh → slice-cap-triangulate). 종전 폴리곤별 fan 은 오목·구멍 단면에서 실제보다 큰 판을 그렸다.
import { useEffect } from "react";
import {
  Color3,
  MeshBuilder,
  Plane,
  Vector3,
  type StandardMaterial,
} from "@babylonjs/core";
import { chainSegments, sliceMeshAtY, type SlicePolygon } from "../../../utils/slice-section";
import { buildSliceFillMesh } from "../../../utils/slice-render";
import type { STLFileV2 } from "../../../types/stl";
import type { SupportParams, SupportPointV2 } from "../../../support/types";
import type { SceneCtx } from "../scene-refs";
import { sliceFillMaterialFor, type SliceFillTag } from "../material-display";

export function useSlicePreview(
  ctx: SceneCtx,
  sliceY: number | null,
  files: STLFileV2[],
  supports: SupportPointV2[],
  supportParams: SupportParams,
): void {
  // 5.5) Z 슬라이스 미리보기:
  //   · scene.clipPlane 으로 Y > sliceY 영역 컬링.
  //   · 모든 mesh 의 단면 segment 계산 → chain → mesh 마다 fill mesh 하나(nonzero 채움).
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

    // ⚠️ 단면 fill·outline 은 반드시 평면 **아래**에 둔다 (B-34).
    //   clipPlane(0,1,0,-sliceY) 의 판정은 셰이더에서
    //   `fClipDistance = y - sliceY > 0 → discard` 다(clipPlaneFragment.js).
    //   종전엔 z-fighting 을 피하려고 fill 을 sliceY+0.005, outline 을 +0.02 로
    //   **위로** 띄웠는데, 그러면 **막으려고 만든 단면 자신이 전량 clip** 돼
    //   한 픽셀도 안 그려진다 — 속 빈 STL 껍데기만 남아 바닥·뒷면이 사라진
    //   "V자 조각"으로 보였다(리드 실물). 이 기능은 최초 구현(7ed9c80)부터
    //   한 번도 화면에 나온 적이 없다.
    //   → 부호를 뒤집어 평면 아래에 놓는다. 서로의 간격(0.003mm)은 유지되므로
    //     outline 이 fill 위에 그려지는 순서는 그대로다.
    const yFill = sliceY - 0.005;
    const yLine = sliceY - 0.002;
    const lines: Vector3[][] = [];
    // 뚜껑 삼각분할이 예외를 내도(예상 밖 입력) 화면 전체가 죽지 않게 그 메시의 뚜껑만 빼고 진행한다 — outline 은 그대로 그린다.
    const buildSafe = (polys: SlicePolygon[], mat: StandardMaterial, name: string) => {
      try {
        return buildSliceFillMesh(scene, polys, yFill, mat, name);
      } catch (e) {
        console.warn("[useSlicePreview] 단면 뚜껑 삼각분할 실패 — 이 메시는 outline 만", e);
        return null;
      }
    };

    // 모델 단면.
    for (const [stlId, mesh] of ctx.meshMapRef.current) {
      const segs = sliceMeshAtY(mesh, sliceY);
      if (segs.length === 0) continue;
      const polys = chainSegments(segs);
      const tag: SliceFillTag = { kind: "stl", stlId };
      const fillMat = sliceFillMaterialFor(ctx, tag) ?? modelMat;
      const fill = buildSafe(polys, fillMat, "v2_slice_model_fill");
      if (fill) {
        fill.metadata = { sliceFill: tag };
        ctx.sliceFillMeshesRef.current.push(fill);
      }
      for (const s of segs) {
        lines.push([
          new Vector3(s.a[0], yLine, s.a[1]),
          new Vector3(s.b[0], yLine, s.b[1]),
        ]);
      }
    }

    // 서포트 단면.
    const supportTag: SliceFillTag = { kind: "support" };
    const supportFillMat = sliceFillMaterialFor(ctx, supportTag) ?? supportMat;
    for (const sm of ctx.supportMeshMapRef.current.values()) {
      const segs = sliceMeshAtY(sm, sliceY);
      if (segs.length === 0) continue;
      const polys = chainSegments(segs);
      const fill = buildSafe(polys, supportFillMat, "v2_slice_support_fill");
      if (fill) {
        fill.metadata = { sliceFill: supportTag };
        ctx.sliceFillMeshesRef.current.push(fill);
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
