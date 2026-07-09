import { Mesh, Ray, Scene, Vector3 } from "@babylonjs/core";

import type { SupportParams, SupportPointV2 } from "../types";

/**
 * 자동 서포트 점 생성.
 *
 * 알고리즘:
 *   1. 모델의 world AABB 의 XZ 범위에 contactSpacingMm 간격 격자.
 *   2. 각 격자 칸 중심에서 모델 아래 (-Y 너머) 에서 위로 ray 발사.
 *   3. scene.pickWithRay 의 first hit = 모델 아랫면 후보.
 *   4. 그 hit 의 면 법선이 -Y 와 임계각 이내이면 오버행 → contact 등록.
 *   5. base 는 (contact.x, 0, contact.z) — 빌드플레이트.
 *
 * 위 → 아래로 쏘면 multiPickWithRay 가 mesh 당 first hit (= 윗면)
 * 만 주기 때문에 0 개가 나온다. 그래서 아래 → 위 방향으로 픽한다.
 *
 * mesh.isPickable = true 가 보장돼 있어야 한다.
 */
export function autoGenerateSupportPoints(
  scene: Scene,
  mesh: Mesh,
  otherStlMeshes: Mesh[],
  params: SupportParams,
  projectId: string,
  stlId: string,
  opts?: {
    /**
     * 후보 접점(contact)을 이 face index 집합 위로만 제한한다 (index buffer 상
     * 삼각형 번호 = picking faceId). 지현규 island 검출 결과의 island face 집합을
     * 넘겨 "검출 영역에만 자동 서포트" 를 만드는 데 쓴다.
     *
     * 미지정(undefined) 시 기존 동작과 산출 완전 동일 — 기존 그리드/오버행 판정
     * 로직은 무변경이며, 이 필터는 후보 생성 지점에 가산적(추가) 조건으로만 작동.
     */
    faceFilter?: Set<number>;
  },
): SupportPointV2[] {
  const faceFilter = opts?.faceFilter;
  mesh.refreshBoundingInfo();
  const bb = mesh.getBoundingInfo().boundingBox;
  const minX = bb.minimumWorld.x;
  const maxX = bb.maximumWorld.x;
  const minZ = bb.minimumWorld.z;
  const maxZ = bb.maximumWorld.z;
  const yTop = bb.maximumWorld.y + 1;
  const yBelow = bb.minimumWorld.y - 1;
  const rayLen = yTop - yBelow;

  const step = params.contactSpacingMm;
  if (step <= 0) return [];
  const overhangCos = Math.cos((params.overhangAngleDeg * Math.PI) / 180);


  const points: SupportPointV2[] = [];
  const now = Date.now();
  const direction = new Vector3(0, 1, 0); // 아래에서 위로
  const predicate = (m: unknown) => m === mesh;

  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      const origin = new Vector3(x, yBelow, z);
      const ray = new Ray(origin, direction, rayLen);

      const info = scene.pickWithRay(
        ray,
        predicate as (m: Mesh) => boolean,
      );
      if (!info?.hit || !info.pickedPoint) continue;

      // faceFilter 지정 시 — 후보 접점이 그 face 집합 위여야만 통과 (가산적 조건).
      //   info.faceId 는 readWorldTriangles/island-detection 의 faceIndex 와 같은
      //   index buffer 삼각형 번호라 island face 집합과 직접 대조된다. 미지정 시
      //   이 블록은 스킵되어 기존 산출과 완전 동일.
      if (faceFilter && (info.faceId < 0 || !faceFilter.has(info.faceId)))
        continue;

      const normal = info.getNormal(true, true);
      if (!normal) continue;

      // 오버행: 법선이 -Y 와 임계각 이내.
      if (normal.y > -overhangCos) continue;

      // contact 가 빌드플레이트에 너무 붙어있으면 서포트가 0 길이라
      // 의미 없음 → skip.
      if (info.pickedPoint.y <= 0.5) continue;

      // contact 를 표면 안쪽으로 살짝 push → 서포트 끝이 모델에 박혀
      // void 없이 부착. normal 은 자동 생성 시 이미 위에서 구함.
      const PEN = 0.3;
      const contactX = info.pickedPoint.x - normal.x * PEN;
      const contactY = info.pickedPoint.y - normal.y * PEN;
      const contactZ = info.pickedPoint.z - normal.z * PEN;

      // base 결정: contact 에서 -Y 로 다른 STL 들과 raycast → 가장
      // 가까운 표면 Y. 없으면 0 (빌드플레이트).
      let baseY = 0;
      if (otherStlMeshes.length > 0 && contactY > 0) {
        const downRay = new Ray(
          new Vector3(contactX, contactY - 0.01, contactZ),
          new Vector3(0, -1, 0),
          contactY,
        );
        for (const om of otherStlMeshes) {
          const hit = om.intersects(downRay, false);
          if (hit.hit && hit.pickedPoint && hit.pickedPoint.y > baseY) {
            baseY = hit.pickedPoint.y;
          }
        }
      }

      points.push({
        id: crypto.randomUUID(),
        projectId,
        stlId,
        contact: [contactX, contactY, contactZ],
        base: [contactX, baseY, contactZ],
        source: "auto",
        addedAt: now,
      });
    }
  }

  return points;
}
