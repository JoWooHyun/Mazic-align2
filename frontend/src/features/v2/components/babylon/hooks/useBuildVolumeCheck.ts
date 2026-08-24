// 출력영역(빌드 볼륨) 초과 검사 훅 — C-2.
//   근거: `docs/판정_CHITUBOX분석_20260821.md` C-2 / 분석 문서 `docs/view94.md` 15장.
//
//   ## 하는 일
//   files/transform 이 바뀔 때마다 각 STL 의 **world AABB** 를 빌드 볼륨과 비교해
//   ① 벗어난 모델을 경고색 외곽선(빨간 박스)으로 표시하고
//   ② 위반 목록을 콜백으로 올려보낸다(페이지가 배너를 띄운다).
//
//   ## 왜 훅 순서 맨 뒤인가
//   `BabylonScene.tsx` 의 훅 호출 순서는 **불변식 1**(원본 effect 선언 순서)로
//   고정돼 있고 cleanup 순서가 그 순서에 의존한다. 이 훅은 씬 상태를 읽기만 하고
//   아무도 이 훅에 의존하지 않으므로, 기존 순서를 흔들지 않도록 **맨 끝**에 붙인다.
//
//   ## 왜 mesh 를 건드리지 않는가
//   모델 머티리얼의 vertex color 는 오버행 하이라이트가 쓰고 있다(`utils/overhang.ts`).
//   경고를 mesh 색으로 칠하면 두 표시가 같은 채널을 두고 싸운다. 그래서 **별도의
//   외곽선 박스 메시**로 그린다 — 오버행 색을 보존하면서 "이 모델이 범위를 벗어남"이
//   한눈에 보인다.
import { useEffect } from "react";
import { Color3, MeshBuilder, VertexBuffer, Vector3 } from "@babylonjs/core";
import type { LinesMesh, Mesh } from "@babylonjs/core";

import type { SceneCtx } from "../scene-refs";
import type { STLFileV2 } from "../../../types/stl";
import {
  checkBuildVolume,
  describeViolation,
  hasViolation,
  type BuildVolumeViolation,
} from "../../../utils/build-volume";

/** 페이지로 올려보내는 위반 1건. */
export interface BuildVolumeIssue {
  stlId: string;
  fileName: string;
  message: string;
  violation: BuildVolumeViolation;
  /**
   * 플레이트 아래로 파고든 깊이 (mm, 양수). 안 파고들었으면 0.
   *
   * 회전하면 모델이 실제로 플레이트를 파고든다(우리는 CHITUBOX 처럼 회전 후
   * 자동 안착을 하지 않는다 — B-12 에서 리드가 A안(현행 유지)으로 확정).
   * 그래서 이 값을 함께 올려보내, 배너가 **"플레이트에 내리기" 원클릭 버튼**을
   * 제공할 수 있게 한다. 사용자가 ty 를 손으로 계산할 필요가 없다.
   */
  sinkDepthMm: number;
}

/** 경고 외곽선 색 — 오버행 빨강(255,82,82)과 구분되도록 더 진한 주황빨강. */
const WARN_COLOR = new Color3(1.0, 0.25, 0.1);

/** 외곽선 박스 메시 이름 접두사. dispose 대상 식별용. */
const WARN_MESH_PREFIX = "v2_volumeWarn_";

export function useBuildVolumeCheck(
  ctx: SceneCtx,
  files: STLFileV2[],
  plateWidthMm: number,
  plateDepthMm: number,
  plateHeightMm: number,
  onIssues?: (issues: BuildVolumeIssue[]) => void,
): void {
  useEffect(() => {
    const scene = ctx.sceneRef.current;
    if (!scene) return;

    // 이전 경고 박스 정리 (매번 새로 그린다 — 모델 수가 적어 비용이 무의미).
    for (const m of scene.meshes.slice()) {
      if (m.name.startsWith(WARN_MESH_PREFIX)) m.dispose();
    }

    const issues: BuildVolumeIssue[] = [];

    for (const f of files) {
      const mesh = ctx.meshMapRef.current.get(f.id);
      if (!mesh) continue;

      mesh.computeWorldMatrix(true);
      const aabb = worldVertexAabb(mesh);
      if (!aabb) continue;

      const violation = checkBuildVolume(aabb, {
        widthMm: plateWidthMm,
        depthMm: plateDepthMm,
        heightMm: plateHeightMm,
      });
      if (!hasViolation(violation)) continue;

      const message = describeViolation(violation);
      if (message) {
        issues.push({
          stlId: f.id,
          fileName: f.fileName,
          message,
          violation,
          // 파고든 깊이 = 최저점이 플레이트(Y=0) 아래로 내려간 만큼.
          sinkDepthMm: aabb.minY < 0 ? -aabb.minY : 0,
        });
      }

      // 벗어난 모델의 AABB 를 빨간 와이어박스로 감싼다.
      const box = buildAabbWireframe(aabb, `${WARN_MESH_PREFIX}${f.id}`, scene);
      box.color = WARN_COLOR;
      box.isPickable = false;
      // 모델에 파묻혀도 보이도록 그룹 1 (bridge handle 과 같은 규약 —
      //   useSceneBootstrap 이 그룹 1 의 depth 를 새로 클리어한다).
      box.renderingGroupId = 1;
    }

    onIssues?.(issues);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, plateWidthMm, plateDepthMm, plateHeightMm]);
}

/**
 * 메쉬의 **실제 정점**을 world 로 옮겨 만든 타이트한 AABB (B-21).
 *
 * ## 왜 `boundingBox.minimumWorld` 를 안 쓰는가 — 회전 오탐의 진짜 원인
 * Babylon 의 `BoundingBox._update` 는 **로컬 AABB 의 8 꼭짓점만** world 로 변환해
 * 다시 축정렬 상자를 만든다(`boundingBox.js:127-132`). 그래서 모델을 회전시키면
 * 상자가 실제 형상보다 **부풀어 오른다** — 20mm 판을 45° 돌리면 X 폭이 28.28mm
 * 로 계산된다(√2 배). 실제 모델은 그대로인데 경계상자만 커지니, 플레이트 안에
 * 잘 들어와 있는데도 "출력영역을 벗어남" 경고가 떴다(리드 실물 발견).
 *
 * 정점을 직접 훑으면 회전해도 항상 **형상에 딱 맞는** 상자가 나온다.
 *
 * ## 비용
 * 정점 수에 선형이고, 이 훅은 files(= transform) 가 바뀔 때만 돈다. 10만 정점
 * 기준 한 자릿수 ms 라 드래그 중에도 문제되지 않는다. 그래도 커지면 그때
 * 캐시(CX-2 삼각형 캐싱 과제)와 함께 다루는 것이 맞다.
 *
 * 정점을 못 읽으면 null → 호출 측이 그 모델을 건너뛴다(경고 안 띄움).
 */
function worldVertexAabb(mesh: Mesh) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions || positions.length < 3) return null;

  const world = mesh.getWorldMatrix();
  const p = new Vector3();
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i + 2 < positions.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(
      positions[i],
      positions[i + 1],
      positions[i + 2],
      world,
      p,
    );
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * AABB 12 모서리를 LineSystem 으로 그린다.
 *   `MeshBuilder.CreateBox` + wireframe 머티리얼 대신 선을 직접 쓰는 이유는
 *   머티리얼을 새로 만들지 않아 dispose 누수 여지가 없기 때문이다
 *   (`scene-setup.ts` 의 격자/외곽선과 같은 방식).
 */
function buildAabbWireframe(
  a: {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
  },
  name: string,
  scene: Parameters<typeof MeshBuilder.CreateLineSystem>[2],
): LinesMesh {
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const { minX, minY, minZ, maxX, maxY, maxZ } = a;

  const c = [
    v(minX, minY, minZ), // 0
    v(maxX, minY, minZ), // 1
    v(maxX, minY, maxZ), // 2
    v(minX, minY, maxZ), // 3
    v(minX, maxY, minZ), // 4
    v(maxX, maxY, minZ), // 5
    v(maxX, maxY, maxZ), // 6
    v(minX, maxY, maxZ), // 7
  ];

  const lines = [
    // 아래 사각
    [c[0], c[1]],
    [c[1], c[2]],
    [c[2], c[3]],
    [c[3], c[0]],
    // 위 사각
    [c[4], c[5]],
    [c[5], c[6]],
    [c[6], c[7]],
    [c[7], c[4]],
    // 기둥 4
    [c[0], c[4]],
    [c[1], c[5]],
    [c[2], c[6]],
    [c[3], c[7]],
  ];

  return MeshBuilder.CreateLineSystem(name, { lines }, scene);
}
