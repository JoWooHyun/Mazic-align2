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
//
//   ## Task0 출력 가능 영역 (Z2)
//   printableArea 를 주면(Task0 프로파일) 대칭 플레이트 검사 대신 **비대칭 출력 가능 영역**
//   (투사 ∩ 노즐 범위)으로 **모델과 서포트**를 함께 본다 — Task0 는 서포트도 도포·노광하기 때문.
//   판정은 순수 함수 `checkItemsInPrintableArea`(utils/build-volume.ts, 검증 스크립트와 공유).
//   서포트는 붙은 모델별로 묶어 한 건으로 올린다(kind "support"). printableArea 가 없으면 기존 검사
//   그대로(모델만, 대칭) — 서포트 신호도 deps 에 넣지 않아 재실행 빈도까지 종전과 같다.
//   영역 테두리는 이 훅 끝에서 usePrintableAreaOutline 으로 그린다(BabylonScene 훅 목록 불변).
import { useEffect, useRef } from "react";
import { Color3, MeshBuilder, VertexBuffer, Vector3 } from "@babylonjs/core";
import type { FloatArray, LinesMesh, Matrix, Mesh, Scene } from "@babylonjs/core";

import type { SceneCtx } from "../scene-refs";
import type { STLFileV2 } from "../../../types/stl";
import type { SupportParams, SupportPointV2 } from "../../../support/types";
import { usePrintableAreaOutline } from "./usePrintableAreaOutline";
import {
  checkBuildVolume,
  checkItemsInPrintableArea,
  describeViolation,
  hasViolation,
  type AreaCheckModel,
  type AreaCheckSupport,
  type BuildVolumeViolation,
  type PrintableAreaMm,
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
  /**
   * 위반 대상 (Z2). 없거나 "model" = 모델(기존). "support" = Task0 출력 가능 영역을 벗어난 서포트 묶음 —
   * stlId 는 `<붙은 모델 id>#supports`(모델을 못 찾으면 `none#supports`)라 모델 id 와 겹치지 않고,
   * sinkDepthMm 은 항상 0(플레이트 위로 올리기 대상 아님).
   */
  kind?: "model" | "support";
}

/** Task0 서포트 검사에 쓰는 신호 — 서포트 메시가 바뀌면(목록·파라미터·부품 로드) 다시 검사한다. */
export interface BuildVolumeSupportSignal {
  supports: SupportPointV2[];
  supportParams: SupportParams;
  partsReady: boolean;
}

/** Task0 위반 문구의 영역 이름 */
const TASK0_AREA_LABEL = "출력 가능 영역";

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
  /**
   * STL 로드 완료 tick (H3). 값이 바뀌면 재검사한다.
   *
   * 로드는 `useFileMeshSync` 의 `Promise.all(...).then(...)` 안에서 끝나므로,
   * `files` 만 deps 로 두면 **새로 불러온 모델은 아직 meshMapRef 에 없어 검사에서
   * 통째로 빠진다.** 그러면 크기 초과 모델을 올려도 경고가 안 뜬다(기능이 정작
   * 제 목적에 안 동작). 로드 완료 신호를 받아 다시 돈다.
   */
  meshLoadTick?: number,
  /**
   * Task0 출력 가능 영역 (world, 비대칭 — Z2). 주면 이 영역으로 모델과 서포트를 검사한다.
   * null/undefined 면 기존 검사(모델만, 대칭 플레이트) 그대로.
   */
  printableArea?: PrintableAreaMm | null,
  /** printableArea 가 있을 때만 쓰는 서포트 재검사 신호. */
  supportSignal?: BuildVolumeSupportSignal,
): void {
  // onIssues 를 ref 로 미러링한다 (M3).
  //   deps 에서 제외하면 effect 가 **첫 렌더의 콜백을 영구 캡처**한다. 지금은
  //   호출부가 `setVolumeIssues`(안정적)라 무해하지만, 인라인 화살표로 바뀌는
  //   순간 조용히 낡은 클로저를 계속 부르게 된다 — 이 폴더의 다른 콜백들이
  //   전부 `scene-refs.ts` 에서 ref 미러링되는 것과 같은 이유로 구조적으로 막는다.
  const onIssuesRef = useRef(onIssues);
  onIssuesRef.current = onIssues;

  // Task0 영역은 값(숫자 4개)으로 비교 — 호출부가 새 객체를 넘겨도 값이 같으면 재실행하지 않는다.
  //   서포트 신호는 Task0 일 때만 deps 에 들어간다(기존 프로파일은 재실행 빈도도 종전과 같게).
  const area = printableArea ?? null;
  const areaKey = area
    ? `${area.minX},${area.maxX},${area.minZ},${area.maxZ}`
    : "";
  const supportsDep = area ? supportSignal?.supports : undefined;
  const supportParamsDep = area ? supportSignal?.supportParams : undefined;
  const partsReadyDep = area ? supportSignal?.partsReady : undefined;

  useEffect(() => {
    const scene = ctx.sceneRef.current;
    if (!scene) return;

    // 이전 경고 박스 정리 (매번 새로 그린다 — 모델 수가 적어 비용이 무의미).
    for (const m of scene.meshes.slice()) {
      if (m.name.startsWith(WARN_MESH_PREFIX)) m.dispose();
    }

    // Task0 (Z2) — 비대칭 출력 가능 영역, 모델 + 서포트. 아니면 아래 기존 검사(대칭 플레이트, 모델만).
    const issues: BuildVolumeIssue[] = area
      ? collectPrintableAreaIssues(ctx, scene, files, area, plateHeightMm)
      : [];
    const plateCheckFiles = area ? [] : files; // Task0 면 기존 검사는 건너뛴다

    for (const f of plateCheckFiles) {
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

    onIssuesRef.current?.(issues);

    // 언마운트/재실행 시 경고 박스를 확실히 정리한다 (M2).
    //   종전에는 "다음 실행 맨 앞"에서만 지워서, 마지막 실행 이후에는 남아 있었다
    //   (scene.dispose 가 회수하므로 누수는 아니나, 이 폴더의 정리 규약과 어긋난다).
    return () => {
      for (const m of scene.meshes.slice()) {
        if (m.name.startsWith(WARN_MESH_PREFIX)) m.dispose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    files,
    plateWidthMm,
    plateDepthMm,
    plateHeightMm,
    meshLoadTick,
    areaKey,
    supportsDep,
    supportParamsDep,
    partsReadyDep,
  ]);

  // Task0 출력 가능 영역 테두리 (Z2). 검사 effect 뒤에 붙인다 — BabylonScene 의 훅 호출 목록
  //   (불변식 1, verify-support-follow 가 고정)을 바꾸지 않으려고 이 훅 안에서 부른다.
  //   영역이 없으면(기존 프로파일) 아무것도 그리지 않는다.
  usePrintableAreaOutline(ctx, area);
}

/**
 * Task0 출력 가능 영역 검사 (Z2) — 모델·서포트 world AABB 를 모아 순수 판정(checkItemsInPrintableArea)에
 * 넘기고, 위반 항목마다 경고 박스를 그린 뒤 BuildVolumeIssue 로 돌려준다.
 * 서포트의 붙은 모델은 supportsRef(서포트 점의 stlId)로 찾는다 — 메시 맵 키 = 서포트 점 id.
 */
function collectPrintableAreaIssues(
  ctx: SceneCtx,
  scene: Scene,
  files: STLFileV2[],
  area: PrintableAreaMm,
  heightMm: number,
): BuildVolumeIssue[] {
  const names = new Map<string, string>();
  const models: AreaCheckModel[] = [];
  for (const f of files) {
    names.set(f.id, f.fileName);
    const mesh = ctx.meshMapRef.current.get(f.id);
    if (!mesh) continue;
    mesh.computeWorldMatrix(true);
    const aabb = worldVertexAabb(mesh);
    if (aabb) models.push({ id: f.id, aabb });
  }

  const parentOf = new Map<string, string>();
  for (const p of ctx.supportsRef.current) parentOf.set(p.id, p.stlId);
  const supports: AreaCheckSupport[] = [];
  for (const [id, sm] of ctx.supportMeshMapRef.current) {
    sm.computeWorldMatrix(true);
    const aabb = worldVertexAabb(sm);
    if (!aabb) continue;
    const parent = parentOf.get(id);
    supports.push({
      parentId: parent !== undefined && names.has(parent) ? parent : null,
      aabb,
    });
  }

  const issues: BuildVolumeIssue[] = [];
  for (const e of checkItemsInPrintableArea(models, supports, area, heightMm)) {
    const what = describeViolation(e.violation, TASK0_AREA_LABEL) ?? "";
    const parentName = e.id !== null ? names.get(e.id) : undefined;
    const issue: BuildVolumeIssue =
      e.kind === "model" && e.id !== null
        ? {
            stlId: e.id,
            fileName: parentName ?? e.id,
            message: what,
            violation: e.violation,
            sinkDepthMm: e.aabb.minY < 0 ? -e.aabb.minY : 0,
            kind: "model",
          }
        : {
            stlId: `${e.id ?? "none"}#supports`,
            fileName: parentName ? `${parentName} 서포트` : "서포트",
            message: `서포트 ${e.count}개 — ${what}`,
            violation: e.violation,
            sinkDepthMm: 0,
            kind: "support",
          };
    issues.push(issue);

    // 위반 항목(서포트는 묶음 합집합)을 같은 빨간 와이어박스로 감싼다.
    const box = buildAabbWireframe(e.aabb, `${WARN_MESH_PREFIX}${issue.stlId}`, scene);
    box.color = WARN_COLOR;
    box.isPickable = false;
    box.renderingGroupId = 1;
  }
  return issues;
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
 *
 * 씬 핸들 getModelWorldAabb(transform-handle.ts → model-bounds-cache.ts)도 같은 순회
 * (positionsWorldAabb)를 쓴다 — Transform 패널의 "크기 (mm)" 와 "출력 영역에 맞춤" 이 이 검사와
 * **같은 상자**를 보게(데모 빈칸 #1). 호출 전에 mesh.computeWorldMatrix(true) 로 world 행렬을
 * 최신으로 만들어 둘 것.
 */
export function worldVertexAabb(mesh: Mesh) {
  return positionsWorldAabb(
    mesh.getVerticesData(VertexBuffer.PositionKind),
    mesh.getWorldMatrix(),
  );
}

/**
 * worldVertexAabb 의 순회 본체 — 정점 배열 + world 행렬 → 타이트한 world AABB (데모 빈칸 #1 에서 분리, 로직 그대로).
 * model-bounds-cache 가 평행이동을 뺀 행렬로 같은 순회를 돌려 캐시한다.
 */
export function positionsWorldAabb(
  positions: FloatArray | null,
  world: Matrix,
) {
  if (!positions || positions.length < 3) return null;

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
