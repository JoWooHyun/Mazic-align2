// Task0 출력 가능 영역 테두리 훅 — Z2.
//   근거: Task0 규격서 v0.3.3 §1 (출력 가능 영역 = 투사 ∩ 노즐 범위, X 10~150 × Y 10~85 mm),
//   `docs/계획_Z1_task0출력_20261002.md` §4 Z2 인계(플레이트 원점 ≠ 출력 가능 영역 중심).
//
//   ## 하는 일
//   area(world X/Z, 비대칭)가 있으면 플레이트 위에 그 사각형을 주황 선으로 그린다. 플레이트(= 노즐 범위
//   150 × 85)보다 작고 한쪽으로 치우쳐 있어서, 선이 없으면 "플레이트 안인데 왜 경고냐"가 된다.
//   area 가 없으면(기존 프로파일) 아무것도 그리지 않는다.
//
//   ## 어디서 부르나
//   useBuildVolumeCheck(#7) **안 끝**에서 부른다(검사 effect 다음). BabylonScene 의 훅 호출 목록은
//   불변식 1(훅 호출 순서)로 고정돼 있고 verify-support-follow 가 그 목록을 그대로 단언하므로 거기에
//   줄을 늘리지 않는다. 씬을 읽고 선 메시 하나만 만들며 아무도 이 훅에 의존하지 않으니 #7 과 #8 사이
//   effect 하나가 늘어도 cleanup 순서 불변식(bootstrap 먼저, brush 는 그 뒤)에는 영향이 없다.
//
//   ## 정리
//   선 메시(LinesMesh)라 머티리얼을 새로 만들지 않는다(scene-setup 외곽선과 같은 방식 — 누수 여지 0).
//   재실행·언마운트 때 그 메시만 지운다. 언마운트에서는 bootstrap cleanup(#1)이 먼저 돌아
//   scene.dispose 가 이미 회수했을 수 있으므로 isDisposed 를 확인한다.
import { useEffect } from "react";
import { Color3, MeshBuilder, Vector3 } from "@babylonjs/core";

import type { SceneCtx } from "../scene-refs";
import type { PrintableAreaMm } from "../../../utils/build-volume";

/** 테두리 메시 이름 */
const OUTLINE_MESH_NAME = "v2_printableArea_outline";
/** 주황 — 플레이트 외곽선(회청)·앞쪽 표시(청록)·축 색과 구분되고, 경고 박스(주황빨강)보다 밝다. */
const OUTLINE_COLOR = new Color3(1.0, 0.65, 0.15);
/** 높이 — 격자(0.01)·플레이트 외곽선(0.02) 위 */
const OUTLINE_Y = 0.03;

export function usePrintableAreaOutline(
  ctx: SceneCtx,
  area: PrintableAreaMm | null | undefined,
): void {
  // 값으로 비교 — 호출부가 새 객체를 넘겨도 숫자가 같으면 다시 그리지 않는다.
  const minX = area?.minX;
  const maxX = area?.maxX;
  const minZ = area?.minZ;
  const maxZ = area?.maxZ;

  useEffect(() => {
    const scene = ctx.sceneRef.current;
    if (!scene) return;
    if (
      minX === undefined ||
      maxX === undefined ||
      minZ === undefined ||
      maxZ === undefined
    ) {
      return;
    }
    const areaLine = MeshBuilder.CreateLines(
      OUTLINE_MESH_NAME,
      {
        points: [
          new Vector3(minX, OUTLINE_Y, minZ),
          new Vector3(maxX, OUTLINE_Y, minZ),
          new Vector3(maxX, OUTLINE_Y, maxZ),
          new Vector3(minX, OUTLINE_Y, maxZ),
          new Vector3(minX, OUTLINE_Y, minZ),
        ],
      },
      scene,
    );
    areaLine.color = OUTLINE_COLOR;
    areaLine.isPickable = false;
    return () => {
      if (!areaLine.isDisposed()) areaLine.dispose();
    };
    // ctx 의 ref 인스턴스는 안정적이다(scene-refs) — 값 4개만 본다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minX, maxX, minZ, maxZ]);
}
