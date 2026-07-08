/**
 * paint-mask — 지현규 브러쉬(mask 도구) painted 영역의 순수 판정/파생 코어 (v2 이식).
 *
 * 원본: frontend/src/components/STLViewer.tsx (지현규 브랜치)
 *   · maskRef 구조         (약 140~147줄) — painted 점을 STL local 좌표 + 법선 + 반경으로 저장
 *   · isMasked(centroid,n) (약 536~552줄) — 한 점이 어떤 painted 점의 반경 안 + 같은쪽 법선인지
 *   · paintedSet 산출       (약 1985~1993줄) — readWorldTriangles(mesh) 로 tri 마다 isMasked 로 판정
 *
 * 씬(픽킹/데칼/오버레이) 의존부는 BabylonScene 이 담당하고, 이 파일은
 *   painted 점 집합 + mesh 지오메트리 → painted face index 집합
 * 의 순수 파생만 담는다. 수치/판정 로직은 원본 verbatim (변경 금지 — 지현규 계약).
 *
 * ⚠️ painted 계약 (통합로드맵 2-3): 여기서 산출하는 face index 는
 *    margin-detect.ts 의 findMargin({ paintedFaceIds }) 입력과 1:1 동일하다.
 *    - 인덱스 정의: readWorldTriangles 와 동일하게 index buffer 상 삼각형 번호
 *      (faceIndex = t/3, t 는 index buffer offset). 비퇴화(cross len ≥ 1e-9)
 *      삼각형만 후보 — 퇴화 tri 는 원본과 동일하게 continue 로 건너뛴다.
 *    - isMasked 는 centroid + face normal 만 사용 (원본 1988줄 호출과 동일).
 *      autoFillFaces(마진 floodfill 자동 색칠, 원본 isMasked 의 세번째 인자
 *      경로)는 이 조각 범위 밖이라 포함하지 않는다 — 계약과 일치.
 *
 * ※ 세션 상태: painted 점은 세션(메모리)에만 존재한다. IndexedDB 영속화는
 *   이번 조각 범위 밖 — 향후 별도 조각에서 supports.repo 유사 패턴으로 처리.
 */
import { Matrix, Mesh, Vector3 } from "@babylonjs/core";

/**
 * painted 점 하나 — 원본 maskRef 엔트리와 동일 구조.
 *   mesh:        색칠된 STL mesh (isMasked 시 최신 world matrix 로 회전/이동 추적)
 *   localPoint:  월드 클릭점을 mesh local 로 변환해 저장 (모델 회전 따라감)
 *   localNormal: 칠한 face 의 법선(local) — 정면/뒷면 구분용
 *   radius:      브러쉬 반경 (mm) = 두께/2
 */
export interface PaintPoint {
  mesh: Mesh;
  localPoint: Vector3;
  localNormal: Vector3;
  radius: number;
}

/**
 * 한 점 p (+ 옵션 법선 n) 이 painted 점 집합 안에 있는지.
 * 원본 isMasked(p, n) verbatim (autoFillFaces 경로 제외 — 이 조각 범위 밖).
 *   n 이 주어지면 칠한 면과 같은 쪽일 때만 인정 → 얇은 벽 반대편 제외.
 */
export function isMasked(
  points: readonly PaintPoint[],
  p: Vector3,
  n?: Vector3,
): boolean {
  for (const m of points) {
    // 로컬 좌표 → 현재 월드 좌표 (모델 회전/이동 추적)
    const wm = m.mesh.getWorldMatrix();
    const wp = Vector3.TransformCoordinates(m.localPoint, wm);
    if (Vector3.Distance(p, wp) >= m.radius) continue;
    if (n) {
      const mn = Vector3.TransformNormal(m.localNormal, wm);
      if (Vector3.Dot(mn, n) <= 0) continue; // 반대편 면 → 마스크 아님
    }
    return true;
  }
  return false;
}

/**
 * 한 STL mesh 에 대해 painted face index 집합을 산출한다.
 *
 * 원본 마진 찾기 useEffect (1982~1993줄) 의 산출과 동치:
 *   const tris = readWorldTriangles(mesh);
 *   for (const t of tris)
 *     if (isMasked(t.centroid, t.normal)) paintedSet.add(t.faceIndex);
 *
 * readWorldTriangles 를 별도 import 하지 않고 동일한 월드 삼각형 계산
 * (법선: 저장 법선 우선, 없으면 기하 cross / 퇴화 tri skip / faceIndex=t/3)
 * 을 여기 인라인으로 옮겼다 — 원본 support.utils.ts:readWorldTriangles 와 1:1.
 *
 * @param mesh          대상 STL mesh
 * @param points        전체 painted 점 (여러 STL 것이 섞여 있어도 됨 — isMasked 가
 *                      각 점의 mesh world matrix 로 판정하므로 필터 불필요.
 *                      단 다른 mesh 의 점은 이 mesh 표면과 겹치지 않는 한 영향 없음)
 * @param onlyThisMesh  이 mesh 에 속한 점만 고려 (기본 true — 원본은 활성 STL 한정)
 */
export function computePaintedFaceIds(
  mesh: Mesh,
  points: readonly PaintPoint[],
  onlyThisMesh = true,
): Set<number> {
  const painted = new Set<number>();
  const relevant = onlyThisMesh
    ? points.filter((pt) => pt.mesh === mesh)
    : points;
  if (relevant.length === 0) return painted;

  const pos = mesh.getVerticesData("position");
  const idx = mesh.getIndices();
  if (!pos || !idx) return painted;
  const nrm = mesh.getVerticesData("normal"); // 렌더링용(=바깥쪽) 법선
  const wm = mesh.computeWorldMatrix(true);
  const getV = (i: number): Vector3 =>
    Vector3.TransformCoordinates(
      new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]),
      wm,
    );

  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t];
    const v0 = getV(i0);
    const v1 = getV(idx[t + 1]);
    const v2 = getV(idx[t + 2]);
    const cross = Vector3.Cross(v1.subtract(v0), v2.subtract(v0));
    const len = cross.length();
    if (len < 1e-9) continue; // 퇴화 tri — 원본과 동일하게 건너뜀
    // 법선: 메쉬 저장 법선(바깥쪽 보장) 우선, 없으면 기하 cross
    let normal: Vector3;
    if (nrm) {
      normal = Vector3.TransformNormal(
        new Vector3(nrm[i0 * 3], nrm[i0 * 3 + 1], nrm[i0 * 3 + 2]),
        wm,
      );
      const nl = normal.length();
      normal = nl > 1e-9 ? normal.scale(1 / nl) : cross.scale(1 / len);
    } else {
      normal = cross.scale(1 / len);
    }
    const centroid = v0.add(v1).add(v2).scale(1 / 3);
    const faceIndex = t / 3;
    if (isMasked(relevant, centroid, normal)) painted.add(faceIndex);
  }
  return painted;
}

/**
 * 월드 클릭점·법선을 mesh local 로 변환해 PaintPoint 를 만든다.
 * 원본 addMaskPoint (1062~1068줄) 의 maskRef.push 부분 verbatim.
 */
export function makePaintPoint(
  mesh: Mesh,
  worldPoint: Vector3,
  worldNormal: Vector3,
  diameter: number,
): PaintPoint {
  const invWm = Matrix.Invert(mesh.getWorldMatrix());
  return {
    mesh,
    localPoint: Vector3.TransformCoordinates(worldPoint, invWm),
    localNormal: Vector3.TransformNormal(worldNormal, invWm),
    radius: diameter / 2,
  };
}
