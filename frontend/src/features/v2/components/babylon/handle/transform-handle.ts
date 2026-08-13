// 좌표 변환 · 지오메트리 질의 핸들 그룹 — worldToStlLocal/stlLocalToWorld/
//   autoRouteBridge/findSurfaceBelow/projectToStlSurface. 원본 useImperativeHandle
//   의 해당 메서드를 순수 이동. 로직·수치 무변경.
import { Mesh, Ray, Vector3 } from "@babylonjs/core";
import {
  worldToStlLocal as worldToStlLocalUtil,
  stlLocalToWorld as stlLocalToWorldUtil,
} from "../../../utils/coord-space";
import { meshWorldBBoxCenter } from "../../../utils/transform";
import type { BabylonSceneHandle } from "../babylon-scene-types";
import type { SceneCtx } from "../scene-refs";

type TransformHandle = Pick<
  BabylonSceneHandle,
  | "worldToStlLocal"
  | "stlLocalToWorld"
  | "getModelWorldPivot"
  | "autoRouteBridge"
  | "findSurfaceBelow"
  | "projectToStlSurface"
>;

export function buildTransformHandle(ctx: SceneCtx): TransformHandle {
  return {
    worldToStlLocal(stlId, world) {
      const stlMesh = ctx.meshMapRef.current.get(stlId);
      if (!stlMesh) return null;
      return worldToStlLocalUtil(world, stlMesh);
    },
    stlLocalToWorld(stlId, local) {
      const stlMesh = ctx.meshMapRef.current.get(stlId);
      if (!stlMesh) return null;
      return stlLocalToWorldUtil(local, stlMesh);
    },
    getModelWorldPivot(id) {
      const mesh = ctx.meshMapRef.current.get(id);
      if (!mesh) return null;
      const c = meshWorldBBoxCenter(mesh);
      return [c.x, c.y, c.z];
    },
    autoRouteBridge(base, contact, cps, excludeStlIds) {
      const SAFETY_MM = 5;
      const excluded = new Set(excludeStlIds);
      const candidates: Mesh[] = [];
      for (const [id, m] of ctx.meshMapRef.current) {
        if (!excluded.has(id)) candidates.push(m);
      }
      if (candidates.length === 0) return cps;

      // 경로 4 segment 가 어느 한 STL 과라도 교차하는지 검사.
      const path = [
        new Vector3(base[0], base[1], base[2]),
        new Vector3(cps[0][0], cps[0][1], cps[0][2]),
        new Vector3(cps[1][0], cps[1][1], cps[1][2]),
        new Vector3(cps[2][0], cps[2][1], cps[2][2]),
        new Vector3(contact[0], contact[1], contact[2]),
      ];
      let collides = false;
      for (let i = 0; i < path.length - 1 && !collides; i++) {
        const dir = path[i + 1].subtract(path[i]);
        const len = dir.length();
        if (len < 1e-6) continue;
        dir.scaleInPlace(1 / len);
        const ray = new Ray(path[i], dir, len);
        for (const mesh of candidates) {
          const hit = mesh.intersects(ray, false);
          if (hit.hit) {
            collides = true;
            break;
          }
        }
      }
      if (!collides) return cps;

      // 충분히 높은 시작점에서 각 변곡점 (X, Z) 으로 -Y ray.
      // 그 위치의 가장 가까운 STL 상단 + SAFETY 로 lift.
      let maxY = 0;
      for (const mesh of candidates) {
        mesh.computeWorldMatrix(true);
        const y = mesh.getBoundingInfo().boundingBox.maximumWorld.y;
        if (y > maxY) maxY = y;
      }
      const startY = maxY + 100;

      const liftCp = (cp: [number, number, number]): [number, number, number] => {
        const origin = new Vector3(cp[0], startY, cp[2]);
        const ray = new Ray(origin, new Vector3(0, -1, 0), startY);
        let surfaceY = 0;
        for (const mesh of candidates) {
          const hit = mesh.intersects(ray, false);
          if (hit.hit && hit.pickedPoint && hit.pickedPoint.y > surfaceY) {
            surfaceY = hit.pickedPoint.y;
          }
        }
        return [cp[0], Math.max(cp[1], surfaceY + SAFETY_MM), cp[2]];
      };

      return [liftCp(cps[0]), liftCp(cps[1]), liftCp(cps[2])];
    },
    findSurfaceBelow(x, z, startY, excludeStlIds) {
      const excluded = new Set(excludeStlIds);
      const candidates: Mesh[] = [];
      for (const [id, m] of ctx.meshMapRef.current) {
        if (!excluded.has(id)) candidates.push(m);
      }
      if (candidates.length === 0) return 0;

      const origin = new Vector3(x, startY, z);
      const ray = new Ray(origin, new Vector3(0, -1, 0), startY);
      let bestY = 0;
      for (const mesh of candidates) {
        const hit = mesh.intersects(ray, false);
        if (hit.hit && hit.pickedPoint && hit.pickedPoint.y > bestY) {
          bestY = hit.pickedPoint.y;
        }
      }
      return bestY;
    },
    projectToStlSurface(stlId, point, hintNormal) {
      const stlMesh = ctx.meshMapRef.current.get(stlId);
      const scene = ctx.sceneRef.current;
      if (!stlMesh || !scene) return null;

      const origin = new Vector3(point[0], point[1], point[2]);
      const predicate = (m: import("@babylonjs/core").AbstractMesh) =>
        m === stlMesh;

      type Hit = {
        pt: Vector3;
        normal: Vector3;
        dist: number;
      };
      let best: Hit | null = null;

      const tryDir = (dx: number, dy: number, dz: number) => {
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-6) return;
        const dir = new Vector3(dx / len, dy / len, dz / len);
        const ray = new Ray(origin, dir, 200);
        const pick = scene.pickWithRay(ray, predicate);
        if (
          pick?.hit &&
          pick.pickedPoint &&
          typeof pick.distance === "number"
        ) {
          const n =
            pick.getNormal(true, true) ?? new Vector3(0, 1, 0);
          if (!best || pick.distance < best.dist) {
            best = {
              pt: pick.pickedPoint.clone(),
              normal: n.clone(),
              dist: pick.distance,
            };
          }
        }
      };

      if (hintNormal) {
        tryDir(hintNormal[0], hintNormal[1], hintNormal[2]);
        tryDir(-hintNormal[0], -hintNormal[1], -hintNormal[2]);
      } else {
        tryDir(1, 0, 0);
        tryDir(-1, 0, 0);
        tryDir(0, 1, 0);
        tryDir(0, -1, 0);
        tryDir(0, 0, 1);
        tryDir(0, 0, -1);
      }
      if (!best) return null;

      // normal 이 안쪽을 향하면 뒤집어 (outward) — point 가 STL 밖에
      // 있을 때 origin → pt 방향과 normal 의 dot 가 양수여야 outward.
      const bestHit: Hit = best;
      const toOrigin = origin.subtract(bestHit.pt);
      if (Vector3.Dot(bestHit.normal, toOrigin) < 0) {
        bestHit.normal.scaleInPlace(-1);
      }

      // 반대편 두께: 표면 점에서 inward normal 방향으로 ray, 같은
      // 메쉬 다음 hit. 모델이 너무 두꺼우면 200mm 까지만 본다.
      const inward = bestHit.normal.scale(-1);
      const insideOrigin = bestHit.pt.add(inward.scale(0.05));
      const insideRay = new Ray(insideOrigin, inward, 200);
      const farPick = scene.pickWithRay(insideRay, predicate);
      const thickness =
        farPick?.hit && typeof farPick.distance === "number"
          ? farPick.distance + 0.05
          : Number.POSITIVE_INFINITY;

      return {
        point: [bestHit.pt.x, bestHit.pt.y, bestHit.pt.z],
        normal: [
          bestHit.normal.x,
          bestHit.normal.y,
          bestHit.normal.z,
        ],
        thickness,
      };
    },
  };
}
