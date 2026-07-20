// 슬라이스 · 출력 핸들 그룹 — exportStl/getFdmSliceInput/getSliceMask/
//   getSliceGeometry/getSceneTopY/getBuildVolumeMm3. 원본 useImperativeHandle 의
//   해당 메서드를 순수 이동. mesh 집합(STL + 서포트)·직렬화 규약 무변경.
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
import type { BabylonSceneHandle } from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";

type SliceExportHandle = Pick<
  BabylonSceneHandle,
  | "exportStl"
  | "getFdmSliceInput"
  | "getSliceMask"
  | "getSliceGeometry"
  | "getSceneTopY"
  | "getBuildVolumeMm3"
>;

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
      const out: { triangles: Float32Array }[] = [];
      for (const mesh of ctx.meshMapRef.current.values()) {
        const tris = extractWorldTriangles(mesh);
        if (tris.length > 0) out.push({ triangles: tris });
      }
      for (const sm of ctx.supportMeshMapRef.current.values()) {
        const tris = extractWorldTriangles(sm);
        if (tris.length > 0) out.push({ triangles: tris });
      }
      return out;
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
