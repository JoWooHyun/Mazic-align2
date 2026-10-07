// 슬라이스 · 출력 핸들 그룹 — exportStl/getFdmSliceInput/getSliceMask/
//   getSliceGeometry/getSceneTopY/getBuildVolumeMm3. 원본 useImperativeHandle 의
//   해당 메서드를 순수 이동. mesh 집합(STL + 서포트)·직렬화 규약 무변경.
//   Task0 2재료(D1b): getSliceGeometry 항목에 메시 정체(kind·stlId)를 더하고(삼각형·순서 그대로),
//   2재료 표시 색 setMaterialSlotColors 를 둔다(화면 전용 — 출력 흐름의 재료 확인용).
import { Color3, StandardMaterial } from "@babylonjs/core";
import { meshesToStlBlob } from "../../../utils/stl-export";
import { computeMeshVolumeMm3 } from "../../../utils/mesh-volume";
import {
  chainSegments,
  extractWorldTriangles,
  sliceMeshAtY,
} from "../../../utils/slice-section";
import { rasterizePolygons } from "../../../utils/slice-rasterize";
import {
  DEFAULT_FDM_SETTINGS,
  type FdmSettings,
} from "../../../utils/gcode/types";
import { setModelDiffuseMode } from "../../../utils/stl-loader";
import {
  TASK0_DEFAULT_STL_SLOT,
  TASK0_SUPPORT_SLOT,
  task0SlotColorRgb,
} from "../../../utils/task0/task0-material";
import type {
  BabylonSceneHandle,
  SliceGeometryItem,
} from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";

type SliceExportHandle = Pick<
  BabylonSceneHandle,
  | "exportStl"
  | "getFdmSliceInput"
  | "getSliceMask"
  | "getSliceGeometry"
  | "getSceneTopY"
  | "getBuildVolumeMm3"
  | "setMaterialSlotColors"
>;

/**
 * 서포트 머티리얼의 칠하기 전 색 (setMaterialSlotColors) — 되돌릴 때 쓴다. 머티리얼 객체 기준이라 씬이 새로 만들어지면
 * (새 머티리얼) 자연히 비어 있다. 서포트 기본색 상수는 utils/support-render.ts createSupportMaterial 한 곳에 있어 복사하지 않는다.
 */
const supportBaseColor = new WeakMap<StandardMaterial, Color3>();

export function buildSliceExportHandle(ctx: SceneCtx): SliceExportHandle {
  return {
    exportStl() {
      const stl = Array.from(ctx.meshMapRef.current.values());
      const supports = Array.from(ctx.supportMeshMapRef.current.values());
      if (stl.length === 0) return null;
      return meshesToStlBlob([...stl, ...supports]);
    },
    getFdmSliceInput(settings) {
      // exportStl 과 동일한 mesh 집합 (STL + 서포트).
      const stl = Array.from(ctx.meshMapRef.current.values());
      const supports = Array.from(ctx.supportMeshMapRef.current.values());
      if (stl.length === 0) return null;
      const meshes = [...stl, ...supports];

      // getSceneTopY 가 top(maximumWorld.y) 을 구하는 방식과 대칭으로
      // bottom(minimumWorld.y) 도 함께 구해 실제 슬라이스 범위를 정한다.
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const mesh of meshes) {
        mesh.computeWorldMatrix(true);
        const bb = mesh.getBoundingInfo().boundingBox;
        if (bb.minimumWorld.y < yMin) yMin = bb.minimumWorld.y;
        if (bb.maximumWorld.y > yMax) yMax = bb.maximumWorld.y;
      }
      if (yMin === Infinity || yMax <= yMin) return null;

      const merged: FdmSettings = {
        ...DEFAULT_FDM_SETTINGS,
        // buildWidth/buildDepth 는 getSliceMask 와 동일한 출처(plateWRef/plateDRef).
        buildWidth: ctx.plateWRef.current,
        buildDepth: ctx.plateDRef.current,
        ...settings,
      };

      // 씬(Babylon Mesh)은 워커로 못 넘어가므로 world 삼각형 배열로 직렬화.
      // (generateFdmGcode 의 Mesh 버전이 하던 추출과 동일 — extractWorldTriangles.)
      const out: { triangles: Float32Array }[] = [];
      for (const mesh of meshes) {
        const tris = extractWorldTriangles(mesh);
        if (tris.length > 0) out.push({ triangles: tris });
      }
      if (out.length === 0) return null;

      return { meshes: out, settings: merged, range: { yMin, yMax } };
    },
    getSliceMask(sliceY, widthPx, heightPx) {
      const polys = [];
      for (const mesh of ctx.meshMapRef.current.values()) {
        const segs = sliceMeshAtY(mesh, sliceY);
        polys.push(...chainSegments(segs));
      }
      for (const sm of ctx.supportMeshMapRef.current.values()) {
        const segs = sliceMeshAtY(sm, sliceY);
        polys.push(...chainSegments(segs));
      }
      return rasterizePolygons(polys, {
        widthPx,
        heightPx,
        plateWidthMm: ctx.plateWRef.current,
        plateDepthMm: ctx.plateDRef.current,
      });
    },
    getSliceGeometry() {
      // getSliceMask 와 동일한 mesh 집합 (STL + 서포트) 을 world 삼각형으로.
      //   Task0 2재료(D1b): 항목마다 메시 정체(kind·stlId)를 붙인다 — 삼각형·순서는 그대로(마스크 ZIP 바이트 무관).
      const out: SliceGeometryItem[] = [];
      for (const [stlId, mesh] of ctx.meshMapRef.current) {
        const tris = extractWorldTriangles(mesh);
        if (tris.length > 0) out.push({ triangles: tris, kind: "stl", stlId });
      }
      // 서포트 mesh map 의 키 = 서포트 id → 붙은 STL id 는 서포트 레코드에서 (재료 슬롯은 항상 A — stlId 는 참고용)
      const stlOfSupport = new Map(ctx.supportsRef.current.map((s) => [s.id, s.stlId]));
      for (const [supportId, sm] of ctx.supportMeshMapRef.current) {
        const tris = extractWorldTriangles(sm);
        if (tris.length > 0) out.push({ triangles: tris, kind: "support", stlId: stlOfSupport.get(supportId) });
      }
      return out;
    },
    setMaterialSlotColors(slots) {
      // Task0 2재료 표시 색 (D1b) — 머티리얼 diffuseColor 만 바꾼다. STL 머티리얼은 메시마다 따로(stl-loader),
      //   서포트 머티리얼은 모든 서포트가 하나를 같이 쓴다(supportMaterialRef).
      //   ⚠ useEditModeSync 가 편집 모드·files·supports·잠금이 바뀔 때 STL 색을 setModelDiffuseMode 로 되돌린다 —
      //   부르는 쪽(pages/viewer/hooks/useTask0Material)이 같은 커밋의 뒤(부모 effect)에서 다시 부르므로 칠한 색이 남는다.
      const supportMat = ctx.supportMaterialRef.current;
      if (slots === null) {
        const overhang = ctx.editModeRef.current === "support";
        for (const mesh of ctx.meshMapRef.current.values()) setModelDiffuseMode(mesh, overhang);
        const base = supportMat ? supportBaseColor.get(supportMat) : undefined;
        if (supportMat && base) {
          supportMat.diffuseColor = base.clone();
          supportBaseColor.delete(supportMat);
        }
        return;
      }
      for (const [stlId, mesh] of ctx.meshMapRef.current) {
        const mat = mesh.material;
        if (!(mat instanceof StandardMaterial)) continue;
        mat.diffuseColor = Color3.FromArray(task0SlotColorRgb(slots[stlId] ?? TASK0_DEFAULT_STL_SLOT));
      }
      if (supportMat) {
        if (!supportBaseColor.has(supportMat)) supportBaseColor.set(supportMat, supportMat.diffuseColor.clone());
        supportMat.diffuseColor = Color3.FromArray(task0SlotColorRgb(TASK0_SUPPORT_SLOT));
      }
    },
    getSceneTopY() {
      let top = 0;
      for (const mesh of ctx.meshMapRef.current.values()) {
        mesh.computeWorldMatrix(true);
        const y = mesh.getBoundingInfo().boundingBox.maximumWorld.y;
        if (y > top) top = y;
      }
      for (const sm of ctx.supportMeshMapRef.current.values()) {
        sm.computeWorldMatrix(true);
        const y = sm.getBoundingInfo().boundingBox.maximumWorld.y;
        if (y > top) top = y;
      }
      return top;
    },
    getBuildVolumeMm3() {
      let model = 0;
      for (const mesh of ctx.meshMapRef.current.values()) {
        model += computeMeshVolumeMm3(mesh);
      }
      let support = 0;
      for (const sm of ctx.supportMeshMapRef.current.values()) {
        support += computeMeshVolumeMm3(sm);
      }
      return { model, support };
    },
  };
}
