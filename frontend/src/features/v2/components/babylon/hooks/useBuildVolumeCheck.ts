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
import { Color3, MeshBuilder, Vector3 } from "@babylonjs/core";
import type { LinesMesh } from "@babylonjs/core";

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
      mesh.refreshBoundingInfo();
      const bb = mesh.getBoundingInfo().boundingBox;
      const aabb = {
        minX: bb.minimumWorld.x,
        minY: bb.minimumWorld.y,
        minZ: bb.minimumWorld.z,
        maxX: bb.maximumWorld.x,
        maxY: bb.maximumWorld.y,
        maxZ: bb.maximumWorld.z,
      };

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
