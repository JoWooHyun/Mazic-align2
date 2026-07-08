/**
 * dental-support — 지현규 dental disc 서포트 생성 알고리즘 (v2 이식).
 *
 * 원본: frontend/src/utils/support.utils.ts (468줄, 지현규 브랜치) 전체 이식.
 * 로직 무변경 — 순수 이동 + v2 트리 재배치. v2 에 이미 존재하는 유승제의
 * trunk/브릿지 서포트(features/v2/utils/support-render.ts 등)와 구분하기 위해
 * 파일명을 dental-support 로 명명한다.
 *
 * 의존성: @babylonjs/core 만. v1 stl.types / 다른 유틸 의존 없음 —
 * TriInfo·SupportSettings·SupportTool 등 타입은 원본에서 자기완결적으로
 * 정의되어 있어 그대로 옮긴다(v2 에 대응 타입이 없어 얇은 어댑터 불필요).
 */
import {
  Scene,
  Mesh,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  VertexData,
} from '@babylonjs/core';

/**
 * 서포트 치수 설정 (mm)
 */
export interface SupportSettings {
  tipTopDiameter: number; // 팁 상부 직경 — 모델 표면 접촉부
  tipBottomDiameter: number; // 팁 하부 직경 — tip→neck 전환부
  contactDepth: number; // 접점 깊이 — 터치팁 상부가 STL 표면에 파고드는 깊이 (mm)
  supportAngle: number; // 서포트 목이 표면과 이루는 각도 (°)
  touchTipDistance: number; // 터치 팁 거리 — 필수 서포트로부터 보조 서포트까지 간격 (mm)
}

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

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  tipTopDiameter: 0.3,
  tipBottomDiameter: 0.5,
  contactDepth: 0.2,
  supportAngle: 45,
  touchTipDistance: 1.0,
};

/**
 * 부드러운 튜브형 서포트 (치투박스식: 구형 팁 - 목 - 연결부 - 중간)
 *
 * 터치 팁 = 구(sphere). 구의 윗부분이 STL 표면을 contactDepth 만큼 침투한다.
 * 목(튜브)은 구의 '중심'에서 시작 → 구 안쪽에서 자라나와 자연스럽게 연결된다.
 *
 * 척추 = 구 중심(tubeTop) → bendPoint(목 끝) → 수직으로 플레이트.
 *   목(tubeTop→bend)은 기울어질 수 있고, 몸통(bend→플레이트)은 수직이다.
 *   bendPoint 를 옮겨 STL 을 우회한다.
 *
 * @param contactPoint  표면 접점 (월드 좌표)
 * @param _surfaceNormal 표면 법선 (현재 미사용)
 * @param bendPoint     목 끝 = 몸통 시작점. 생략 시 접점 바로 아래(수직).
 */
export function createSupport(
  scene: Scene,
  contactPoint: Vector3,
  _surfaceNormal: Vector3,
  settings: SupportSettings,
  bendPoint?: Vector3,
  color?: Color3
): Mesh | null {
  const CONN = 1.6; // 연결부(목→중간) 길이

  // 반경 프로파일
  const neckR = Math.max(settings.tipBottomDiameter / 2, 0.1);
  const bodyR = Math.max(settings.tipBottomDiameter, neckR * 1.6);
  // 터치 팁 = 구. tipTopDiameter 로 크기 결정, 최소 목 두께 이상.
  const sphereR = Math.max(settings.tipTopDiameter / 2, neckR);

  // 구 중심 — 구의 꼭대기가 (접점 + contactDepth) 가 되도록.
  // → 구는 STL 표면을 정확히 contactDepth 만큼 침투한다.
  const sphereCenter = new Vector3(
    contactPoint.x,
    contactPoint.y + settings.contactDepth - sphereR,
    contactPoint.z
  );
  // 튜브 시작점 = 구의 중심. 목의 윗부분이 구 안에 묻혀 자라나오므로
  //   목이 기울어도 끊김 없이 자연스럽게 연결된다.
  //   (구 바닥의 한 점에서만 만나면 목이 기울 때 연결이 끊겨 보인다)
  const tubeTop = sphereCenter.clone();

  // bendPoint 기본값 — 접점 바로 아래(수직 서포트)
  const bend =
    bendPoint ??
    new Vector3(
      contactPoint.x,
      Math.max(0.5, contactPoint.y - 4),
      contactPoint.z
    );
  const plate = new Vector3(bend.x, 0, bend.z);

  const neckLen = Vector3.Distance(tubeTop, bend); // 목 길이(기울 수 있음)
  const bodyLen = Math.max(0, bend.y); // bend → 플레이트 (수직)
  if (neckLen < CONN + 0.5) return null; // 목이 너무 짧음

  // 반경 프로파일 (시작점에서의 누적거리 d) — 목→연결부→중간 매끄럽게
  const dConnStart = neckLen - CONN; // 연결부 = 목의 마지막 CONN 구간
  const smoothstep = (a: number, b: number, t: number): number => {
    const x = Math.min(1, Math.max(0, t));
    return a + (b - a) * x * x * (3 - 2 * x);
  };
  const radiusAt = (d: number): number => {
    if (d <= dConnStart) return neckR; // 목 (가늘게)
    if (d <= neckLen)
      return smoothstep(neckR, bodyR, (d - dConnStart) / CONN); // 연결부
    return bodyR; // 중간(body)
  };

  // 척추 path — 목(tubeTop→bend, 기울 수 있음) + 몸통(bend→플레이트, 수직)
  const STEP = 0.35;
  const path: Vector3[] = [];
  const nN = Math.max(1, Math.ceil(neckLen / STEP));
  for (let i = 0; i <= nN; i++) path.push(Vector3.Lerp(tubeTop, bend, i / nN));
  if (bodyLen > 1e-3) {
    const nB = Math.max(1, Math.ceil(bodyLen / STEP));
    for (let i = 1; i <= nB; i++) path.push(Vector3.Lerp(bend, plate, i / nB));
  }
  const tube = MeshBuilder.CreateTube(
    'supportTube',
    {
      path,
      radiusFunction: (_i: number, distance: number) => radiusAt(distance),
      tessellation: 14,
      cap: Mesh.CAP_ALL,
    },
    scene
  );

  // 터치 팁 구
  const tipSphere = MeshBuilder.CreateSphere(
    'supportTip',
    { diameter: sphereR * 2, segments: 12 },
    scene
  );
  tipSphere.position.copyFrom(sphereCenter);

  const support = Mesh.MergeMeshes(
    [tube, tipSphere],
    true,
    true,
    undefined,
    false,
    false
  );
  if (!support) return null;
  support.name = `support_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  support.isPickable = false;

  const mat = new StandardMaterial('supportMat', scene);
  mat.diffuseColor = color ?? new Color3(0.35, 0.65, 0.95);
  mat.specularColor = new Color3(0.12, 0.12, 0.12);
  support.material = mat;
  return support;
}

/** 2D 점들의 볼록 껍질 (XZ 평면, Andrew monotone chain) */
function convexHullXZ(
  pts: { x: number; z: number }[]
): { x: number; z: number }[] {
  const uniq = pts.filter(
    (p, i) => pts.findIndex((q) => q.x === p.x && q.z === p.z) === i
  );
  if (uniq.length < 3) return uniq;
  const p = [...uniq].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (
    o: { x: number; z: number },
    a: { x: number; z: number },
    b: { x: number; z: number }
  ) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: { x: number; z: number }[] = [];
  for (const pt of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0
    )
      lower.pop();
    lower.push(pt);
  }
  const upper: { x: number; z: number }[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0
    )
      upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * 영역 지정 솔리드 서포트
 * footprint(XZ 점들)의 볼록 껍질을 빌드플레이트(Y=0)부터 topY 까지 수직 압출한
 * 단일 솔리드 메쉬. grid pattern 이 아닌 solid support polygon.
 */
export function createSolidRegionSupport(
  scene: Scene,
  footprintPoints: { x: number; z: number }[],
  topY: number
): Mesh | null {
  if (topY < 0.5) return null;
  const hull = convexHullXZ(footprintPoints);
  if (hull.length < 3) return null;

  const n = hull.length;
  const cx = hull.reduce((s, p) => s + p.x, 0) / n;
  const cz = hull.reduce((s, p) => s + p.z, 0) / n;

  const positions: number[] = [];
  for (const p of hull) positions.push(p.x, 0, p.z); // 0..n-1   바닥 링
  for (const p of hull) positions.push(p.x, topY, p.z); // n..2n-1  윗 링
  positions.push(cx, 0, cz); // 2n     바닥 중심
  positions.push(cx, topY, cz); // 2n+1   윗 중심
  const cBot = 2 * n;
  const cTop = 2 * n + 1;

  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, n + j, i, n + j, n + i); // 옆면 (사각형)
    indices.push(cBot, j, i); // 바닥면 (fan)
    indices.push(cTop, n + i, n + j); // 윗면 (fan)
  }

  const mesh = new Mesh(`regionSupport_${Date.now()}`, scene);
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.applyToMesh(mesh);
  mesh.isPickable = false;

  const mat = new StandardMaterial('regionSupportMat', scene);
  mat.diffuseColor = new Color3(0.35, 0.65, 0.95);
  mat.specularColor = new Color3(0.12, 0.12, 0.12);
  mat.backFaceCulling = false;
  mesh.material = mat;

  return mesh;
}
