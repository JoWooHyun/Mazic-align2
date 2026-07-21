/**
 * dental-support — 지현규 dental 검출용 헬퍼 모음 (v2 이식).
 *
 * 원본: frontend/src/utils/support.utils.ts (지현규 브랜치) 이식.
 * disc(원판형) 서포트는 폐기됐고(리드 결정 2026-07-21), 이 파일에는 검출
 * 워크플로우가 쓰는 순수 헬퍼만 남긴다:
 *   · readWorldTriangles      — 월드 좌표 삼각형 산출 (island-detection 등에서 사용)
 *   · createUnsupportedHighlight / createFaceOverlay / createMarginLines
 *                              — 검출 결과 시각화(미지지 점·면 그룹·마진선)
 *
 * 의존성: @babylonjs/core 만. v1 stl.types / 다른 유틸 의존 없음 —
 * TriInfo·SupportTool 등 타입은 원본에서 자기완결적으로 정의되어 있어
 * 그대로 옮긴다(v2 에 대응 타입이 없어 얇은 어댑터 불필요).
 */
import {
  Scene,
  Mesh,
  Vector3,
  StandardMaterial,
  Color3,
  VertexData,
} from '@babylonjs/core';

/** 서포트 배치 도구 — none / point(점) / mask(보호영역 칠하기) */
export type SupportTool = 'none' | 'point' | 'mask';

/** 월드 좌표 삼각형 정보 */
export interface TriInfo {
  v0: Vector3;
  v1: Vector3;
  v2: Vector3;
  centroid: Vector3;
  normal: Vector3;
  area: number;
  faceIndex: number; // 인덱스버퍼상 면 번호 (= picking faceId) — 분류 라벨 키
}

/** 메쉬의 모든 삼각형을 월드 좌표로 읽어 법선·중심·면적 계산 */
export function readWorldTriangles(mesh: Mesh): TriInfo[] {
  const pos = mesh.getVerticesData('position');
  const idx = mesh.getIndices();
  if (!pos || !idx) return [];
  const nrm = mesh.getVerticesData('normal'); // 렌더링용(=바깥쪽) 법선
  const wm = mesh.computeWorldMatrix(true);
  const getV = (i: number) =>
    Vector3.TransformCoordinates(
      new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]),
      wm
    );
  const tris: TriInfo[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t];
    const v0 = getV(i0);
    const v1 = getV(idx[t + 1]);
    const v2 = getV(idx[t + 2]);
    const cross = Vector3.Cross(v1.subtract(v0), v2.subtract(v0));
    const len = cross.length();
    if (len < 1e-9) continue;
    // 법선: 메쉬 저장 법선(바깥쪽 보장) 우선, 없으면 기하 cross
    let normal: Vector3;
    if (nrm) {
      normal = Vector3.TransformNormal(
        new Vector3(nrm[i0 * 3], nrm[i0 * 3 + 1], nrm[i0 * 3 + 2]),
        wm
      );
      const nl = normal.length();
      normal = nl > 1e-9 ? normal.scale(1 / nl) : cross.scale(1 / len);
    } else {
      normal = cross.scale(1 / len);
    }
    tris.push({
      v0,
      v1,
      v2,
      centroid: v0.add(v1).add(v2).scale(1 / 3),
      normal,
      area: len * 0.5,
      faceIndex: t / 3,
    });
  }
  return tris;
}

/** 미지지 구역 점 표기 — 미지지 삼각형마다 중심에 빨간 점 1개를 찍는다 */
export function createUnsupportedHighlight(
  scene: Scene,
  tris: TriInfo[],
  parentMesh?: Mesh
): Mesh | null {
  if (tris.length === 0) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  tris.forEach((t, i) => {
    // 삼각형 중심 + 법선 방향으로 살짝 띄워 z-fighting 방지
    const off = t.normal.scale(0.2);
    positions.push(
      t.centroid.x + off.x,
      t.centroid.y + off.y,
      t.centroid.z + off.z
    );
    indices.push(i);
  });
  const mesh = new Mesh(`unsupportedPoints_${Date.now()}`, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.renderingGroupId = 1; // 모델에 가려지지 않고 항상 보이게

  const mat = new StandardMaterial('unsupportedMat', scene);
  mat.emissiveColor = new Color3(1, 0.1, 0.1);
  mat.disableLighting = true;
  mat.pointsCloud = true; // 정점을 점으로 렌더링
  mat.pointSize = 8;
  mesh.material = mat;
  // STL 메쉬에 부착 → 이후 applyTransform 으로 모델이 재배치돼도 함께 따라감
  if (parentMesh) mesh.setParent(parentMesh);
  return mesh;
}

/** 면 그룹 오버레이 — 주어진 삼각형들을 단색으로 표면 위에 채워 표시 */
export function createFaceOverlay(
  scene: Scene,
  tris: TriInfo[],
  rgb: [number, number, number]
): Mesh | null {
  if (tris.length === 0) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  let k = 0;
  for (const t of tris) {
    const off = t.normal.scale(0.08); // 표면 위로 살짝 띄워 z-fighting 방지
    for (const v of [t.v0, t.v1, t.v2]) {
      positions.push(v.x + off.x, v.y + off.y, v.z + off.z);
    }
    indices.push(k, k + 1, k + 2);
    k += 3;
  }
  const mesh = new Mesh(
    `faceGroup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    scene
  );
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  const mat = new StandardMaterial('faceGroupMat', scene);
  mat.emissiveColor = new Color3(rgb[0], rgb[1], rgb[2]);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.zOffset = -1; // 모델 표면 위에 렌더
  mesh.material = mat;
  return mesh;
}

/**
 * 마진 경계선 — 면 라벨(1=외면 / 2=내면)이 서로 다른 두 삼각형이 공유하는
 * edge 들을 모아 굵은 튜브(사각 단면) 메쉬로 그린다. 내·외면 경계 = 마진.
 * 1px 선은 잘 안 보이므로 실제 3D 두께를 가진 지오메트리로 표기.
 */
export function createMarginLines(
  scene: Scene,
  tris: TriInfo[],
  labels: Uint8Array
): Mesh | null {
  const r = (v: Vector3): string =>
    `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(
      v.z * 1000
    )}`;
  const edgeMap = new Map<string, { p1: Vector3; p2: Vector3; label: number }>();
  const segs: [Vector3, Vector3][] = [];
  for (const t of tris) {
    const lab = labels[t.faceIndex];
    if (!lab) continue;
    const edges: [Vector3, Vector3][] = [
      [t.v0, t.v1],
      [t.v1, t.v2],
      [t.v2, t.v0],
    ];
    for (const [a, b] of edges) {
      const ka = r(a);
      const kb = r(b);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const prev = edgeMap.get(key);
      if (!prev) {
        edgeMap.set(key, { p1: a, p2: b, label: lab });
      } else if (prev.label !== lab) {
        segs.push([prev.p1, prev.p2]); // 라벨 다른 두 면이 공유 → 마진 edge
      }
    }
  }
  if (segs.length === 0) return null;

  // 각 마진 edge 를 굵은 사각 단면 박스로 → 잘 보이는 선
  const RAD = 0.4; // 단면 반경 (mm)
  const positions: number[] = [];
  const indices: number[] = [];
  // 박스 12 삼각형 (backFaceCulling off 이므로 winding 무관)
  const BOX = [
    0, 1, 3, 0, 3, 2, 4, 7, 5, 4, 6, 7, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3, 0,
    4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6,
  ];
  let vbase = 0;
  for (const [p1, p2] of segs) {
    const dir = p2.subtract(p1);
    const len = dir.length();
    if (len < 1e-4) continue;
    dir.scaleInPlace(1 / len);
    let u = Vector3.Cross(dir, new Vector3(0, 1, 0));
    if (u.lengthSquared() < 1e-6) u = Vector3.Cross(dir, new Vector3(1, 0, 0));
    u.normalize();
    const w = Vector3.Cross(dir, u).normalize();
    for (const e of [p1, p2]) {
      for (const su of [-1, 1]) {
        for (const sw of [-1, 1]) {
          positions.push(
            e.x + u.x * su * RAD + w.x * sw * RAD,
            e.y + u.y * su * RAD + w.y * sw * RAD,
            e.z + u.z * su * RAD + w.z * sw * RAD
          );
        }
      }
    }
    for (const ix of BOX) indices.push(vbase + ix);
    vbase += 8;
  }
  if (indices.length === 0) return null;

  const mesh = new Mesh(`marginTube_${Date.now()}`, scene);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;
  mesh.renderingGroupId = 1; // 모델 위에 항상 보이게

  const mat = new StandardMaterial('marginMat', scene);
  mat.emissiveColor = new Color3(1, 0.92, 0.15); // 밝은 노랑
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mesh.material = mat;
  return mesh;
}
