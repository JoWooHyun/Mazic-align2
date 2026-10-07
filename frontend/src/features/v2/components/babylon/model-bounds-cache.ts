// 모델 메쉬 world AABB(실제 정점) · 피벗 캐시 — Transform 패널이 렌더마다 묻는 두 값 (데모 빈칸 #1 검수 3).
//
//   ## 왜
//   패널은 렌더마다 getModelWorldAabb(크기 표시)와 getModelWorldPivot(POSITION 표시)을 부른다. 둘 다 정점 전체를
//   훑어서(검수 실측 30만 정점 5.6 ms · 1.4 ms, 100만 18.4 ms · 4.5 ms) 슬라이더 입력·무관한 페이지 리렌더마다 쌓였다.
//   같은 상태면 다시 훑지 않는다. 값은 캐시 없이 구한 것과 **비트 단위로 같다**(아래 근거, verify-model-size (h) 실측).
//
//   ## 캐시 키 — Babylon 에서 확실히 바뀌는 값만 쓴다
//   · 정점 배열 **정체**: mesh.getVerticesData(Position) 는 버퍼가 꽉 찬 Float32Array/Array 면 **저장된 배열 그 자체**를
//     돌려준다(VertexBuffer.GetFloatData — forceCopy 가 아니면 data 반환). setVerticesData·bake 는 버퍼를 **새 배열로 교체**
//     하므로 정점이 바뀌면 정체가 바뀐다. 사본·뷰를 돌려주는 배치면 매번 새 정체라 캐시가 안 맞을 뿐 틀리지는 않는다.
//     v2 모델 정점은 로드 때만 바뀐다(stl-loader 의 bake·setVerticesData — 둘 다 새 배열). 같은 배열을 제자리에서 고쳐
//     올리는 API(updateVerticesDirectly 등)를 모델에 쓰게 되면 여기 무효화도 함께 추가할 것.
//   · world 행렬 **값**(computeWorldMatrix(true) 직후): Matrix.updateFlag 같은 "갱신 신호" 는 force 재계산마다 값이 같아도
//     새로 찍히므로 키로 못 쓴다. 값 비교는 원소 9~16 개 비교라 싸고, 같으면 결과가 수학적으로 같다.
//
//   ## AABB — 선형부(3×3)만 키, 평행이동은 더한다
//   POSITION 슬라이더처럼 위치만 바뀌면 다시 훑지 않는다. 비트 동일 근거: positionsWorldAabb(= worldVertexAabb 의 순회)는
//   정점마다 S_v = x·m0 + y·m4 + z·m8 을 만들고 fl(S_v + m12) 의 최소를 고른다. 반올림 덧셈은 단조라
//   min fl(S_v + c) = fl(min S_v + c) — 평행이동 0 으로 훑은 최소(min S_v)에 한 번 더한 값과 같다. 단 투영 성분이
//   m3 = m7 = m11 = 0, m15 = 1 인 아핀 행렬일 때만(그래야 정점별 나눗셈이 1) — 아니면 캐시 없이 positionsWorldAabb 로 훑는다.
//   선형부가 바뀌면(회전·배율) 다시 훑는데, 그 순회는 같은 식을 펼친 affineAabb 로 약 1.8배 빠르다(값은 같다).
//
//   ## 피벗 — 로컬 상자만 정점에 달려 있다
//   meshWorldBBoxCenter = computeWorldMatrix(true) + refreshBoundingInfo()(정점 사본 + 로컬 min/max) + centerWorld.
//   로컬 min/max 는 정점에만 달려 있으므로 같은 정점 배열이면 처음 한 번만 refresh 하고, 그 뒤로는
//   computeWorldMatrix(true) → getBoundingInfo()(world 상자 갱신) 의 centerWorld 만 읽는다 — refresh 경로의 마지막 단계와
//   같은 계산이라 값이 같다. (v2 의 다른 refreshBoundingInfo 호출도 전부 같은 정점에서 다시 만들 뿐이다.)
import { Matrix, VertexBuffer } from "@babylonjs/core";
import type { FloatArray, Mesh } from "@babylonjs/core";

import type { WorldAabbMm } from "../../utils/build-volume";
import { meshWorldBBoxCenter } from "../../utils/transform";
import { positionsWorldAabb } from "./hooks/useBuildVolumeCheck";

/** world 행렬의 선형부(3×3) 원소 위치 — Babylon 행 우선 16 원소 중 0·1·2·4·5·6·8·9·10. */
const LINEAR_IDX = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const;

/**
 * 아핀 행렬(m3 = m7 = m11 = 0, m15 = 1)로 정점 상자 — positionsWorldAabb 와 **비트 단위로 같은 값**을 약 1.8배 빨리
 * (100만 정점 19.7 → 10.9 ms, 실측). 정점마다 Vector3.TransformCoordinatesFromFloatsToRef 를 부르는 대신 같은 식을
 * 같은 순서로 펼쳤다: r = x·m0 + y·m4 + z·m8 + m12 (왼쪽부터 더함). Babylon 은 여기에 rw = 1 / (x·0 + y·0 + z·0 + 1) = 1
 * 을 곱하는데 1 을 곱해도 값이 그대로라 생략한다. 아핀이 아니면 호출하지 말 것(worldAabb 가 positionsWorldAabb 로 돌린다).
 * verify-model-size (h) 가 여러 자세에서 worldVertexAabb 와 === 로 대조한다.
 */
function affineAabb(p: FloatArray, m: ArrayLike<number>): WorldAabbMm | null {
  if (p.length < 3) return null;
  const m0 = m[0], m1 = m[1], m2 = m[2];
  const m4 = m[4], m5 = m[5], m6 = m[6];
  const m8 = m[8], m9 = m[9], m10 = m[10];
  const m12 = m[12], m13 = m[13], m14 = m[14];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    const rx = x * m0 + y * m4 + z * m8 + m12;
    const ry = x * m1 + y * m5 + z * m9 + m13;
    const rz = x * m2 + y * m6 + z * m10 + m14;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rz < minZ) minZ = rz;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
    if (rz > maxZ) maxZ = rz;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

interface Entry {
  /** 이 항목이 기억하는 정점 배열(정체 비교) */
  positions: FloatArray;
  /** 마지막으로 훑은 선형부 값 9 개 */
  linear: number[] | null;
  /** 평행이동 0 행렬로 훑은 상자 */
  linearAabb: WorldAabbMm | null;
  /** 이 정점 배열로 refreshBoundingInfo 를 했는가 (피벗용) */
  localBoxFresh: boolean;
}

export interface ModelBoundsCache {
  /** 모델 world AABB (실제 정점) — worldVertexAabb(computeWorldMatrix(true) 후)와 같은 값. 정점이 없으면 null. */
  worldAabb(mesh: Mesh): WorldAabbMm | null;
  /** 모델 피벗 = Babylon bbox 중심 — meshWorldBBoxCenter 와 같은 값 (B-9). */
  pivot(mesh: Mesh): [number, number, number];
  /** 검증용 계수 — 정점 전체 순회 횟수 (verify-model-size 가 "같으면 캐시" 를 확인) */
  readonly stats: { aabbScans: number; pivotRefreshes: number };
}

/** 씬 하나에 하나 — transform-handle 이 만든다. 메쉬를 키로 쓰는 WeakMap 이라 dispose 된 메쉬는 같이 사라진다. */
export function createModelBoundsCache(): ModelBoundsCache {
  const entries = new WeakMap<Mesh, Entry>();
  const stats = { aabbScans: 0, pivotRefreshes: 0 };

  function entryFor(mesh: Mesh, positions: FloatArray): Entry {
    let e = entries.get(mesh);
    if (!e || e.positions !== positions) {
      e = { positions, linear: null, linearAabb: null, localBoxFresh: false };
      entries.set(mesh, e);
    }
    return e;
  }

  return {
    stats,
    worldAabb(mesh) {
      mesh.computeWorldMatrix(true);
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions || positions.length < 3) return null;
      const world = mesh.getWorldMatrix();
      const m = world.m;
      const affine = m[3] === 0 && m[7] === 0 && m[11] === 0 && m[15] === 1;
      if (!affine) {
        stats.aabbScans++;
        return positionsWorldAabb(positions, world);
      }
      const e = entryFor(mesh, positions);
      const lin = e.linear;
      if (!lin || !LINEAR_IDX.every((k, i) => lin[i] === m[k])) {
        // 선형부가 바뀌었다(회전·배율) — 평행이동을 뺀 같은 행렬 값으로 다시 훑는다.
        const linearOnly = Matrix.FromArray(m);
        linearOnly.setTranslationFromFloats(0, 0, 0);
        e.linearAabb = affineAabb(positions, linearOnly.m);
        e.linear = LINEAR_IDX.map((k) => m[k]);
        stats.aabbScans++;
      }
      const a = e.linearAabb;
      if (!a) return null;
      return {
        minX: a.minX + m[12],
        maxX: a.maxX + m[12],
        minY: a.minY + m[13],
        maxY: a.maxY + m[13],
        minZ: a.minZ + m[14],
        maxZ: a.maxZ + m[14],
      };
    },
    pivot(mesh) {
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      const e = positions ? entryFor(mesh, positions) : null;
      if (!e || !e.localBoxFresh) {
        // 처음(또는 정점이 바뀐 뒤) — 원래 경로 그대로(로컬 상자를 정점에서 다시 만든다).
        stats.pivotRefreshes++;
        const c = meshWorldBBoxCenter(mesh);
        if (e) e.localBoxFresh = true;
        return [c.x, c.y, c.z];
      }
      mesh.computeWorldMatrix(true);
      const c = mesh.getBoundingInfo().boundingBox.centerWorld;
      return [c.x, c.y, c.z];
    },
  };
}
