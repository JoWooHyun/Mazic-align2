// 슬라이스 · 출력 핸들 그룹 — exportStl/getFdmSliceInput/getSliceMask/
//   getSliceGeometry/getSceneTopY/getBuildVolumeMm3. 원본 useImperativeHandle 의
//   해당 메서드를 순수 이동. mesh 집합(STL + 서포트)·직렬화 규약 무변경.
//   Task0 2재료(D1b): getSliceGeometry 항목에 메시 정체(kind·stlId)를 더하고(삼각형·순서 그대로),
//   2재료 표시 색 setMaterialSlotColors 를 둔다(화면 전용 — 출력 흐름의 재료 확인용).
//   D2: setMaterialSlotColors 는 씬의 재료 색 상태를 바꾸는 입구(material-display setMaterialSlotState — 색을 정하는 모든
//   지점이 상태를 읽는다), 2D 단면 패널용 재료 라벨 마스크 getSliceMaterialMask 추가(getSliceMask 무변경).
import type { SlicePolygon } from "../../../utils/slice-geometry";
import { meshesToStlBlob } from "../../../utils/stl-export";
import { computeMeshVolumeMm3 } from "../../../utils/mesh-volume";
import {
  chainSegments,
  extractWorldTriangles,
  sliceMeshAtY,
} from "../../../utils/slice-section";
import { rasterizePolygons } from "../../../utils/slice-rasterize";
import { rasterizeMaterialLabels } from "../../../utils/slice-material-mask";
import {
  DEFAULT_FDM_SETTINGS,
  type FdmSettings,
} from "../../../utils/gcode/types";
import {
  TASK0_DEFAULT_STL_SLOT,
  TASK0_SUPPORT_SLOT,
} from "../../../utils/task0/task0-material";
import type { Task0MaterialSlot } from "../../../utils/task0/task0-slice";
import type {
  BabylonSceneHandle,
  SliceGeometryItem,
} from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";
import { setMaterialSlotState } from "../material-display";

type SliceExportHandle = Pick<
  BabylonSceneHandle,
  | "exportStl"
  | "getFdmSliceInput"
  | "getSliceMask"
  | "getSliceMaterialMask"
  | "getSliceGeometry"
  | "getSceneTopY"
  | "getBuildVolumeMm3"
  | "setMaterialSlotColors"
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
    getSliceMaterialMask(sliceY, widthPx, heightPx, slots) {
      // Task0 2재료 2D 단면 (D2) — getSliceMask 와 **같은 메시 순회 순서**(STL → 서포트)·같은 자르기로 폴리곤을 모으고
      //   폴리곤마다 재료 슬롯(STL = slots[stlId] ?? 기본 B, 서포트 = A)을 붙인다. 래스터는 slice-material-mask
      //   rasterizeMaterialLabels — 합집합은 getSliceMask 와 같은 rasterizePolygons 호출이라 라벨 ≠ 0 = getSliceMask.
      const polys: SlicePolygon[] = [];
      const polySlots: Task0MaterialSlot[] = [];
      for (const [stlId, mesh] of ctx.meshMapRef.current) {
        const segs = sliceMeshAtY(mesh, sliceY);
        const slot = slots[stlId] ?? TASK0_DEFAULT_STL_SLOT;
        for (const poly of chainSegments(segs)) {
          polys.push(poly);
          polySlots.push(slot);
        }
      }
      for (const sm of ctx.supportMeshMapRef.current.values()) {
        const segs = sliceMeshAtY(sm, sliceY);
        for (const poly of chainSegments(segs)) {
          polys.push(poly);
          polySlots.push(TASK0_SUPPORT_SLOT);
        }
      }
      return rasterizeMaterialLabels(polys, polySlots, {
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
      // Task0 2재료 표시 색 (D1b → D2) — 씬의 재료 색 상태(ctx.materialSlotColorsRef)를 바꾸고 STL·서포트·단면 fill 에 적용한다
      //   (material-display setMaterialSlotState — 멱등). STL 색을 정하는 다른 지점(useEditModeSync·useFileMeshSync 로드 완료)도
      //   같은 상태를 읽으므로, 부르는 쪽(pages/viewer/hooks/useTask0Material)은 상태가 바뀔 때만 부르면 된다
      //   (D1b 의 "부모 effect 가 다시 칠한다" 순서 의존 없음).
      setMaterialSlotState(ctx, slots);
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
