// 서포트 rebuild key 의 **입력** 계산 — useSupportMeshSync 루프에서 순수 추출.
//   씬·mesh 없이 행렬만 받으므로 헤드리스 검증이 가능하다
//   (scripts/verify-support-follow.mjs). Babylon 은 행렬 수학(Vector3)만 쓴다.
//
//   ## 데모 사고 방지 1차 A — world 저장 점은 로컬화하지 않는다
//   종전에는 world 저장 점(coordSpace !== 'stl-local' — 자동·수동·브릿지 등)의
//   key 를 `inv(현재 STL world) × 저장 world` 로 로컬화해 만들었다. 그런데 모델
//   transform 커밋(useTransformCommit)은 저장 world 좌표를 **같은 변환으로 patch**
//   하므로, 새 world 를 새 역행렬로 로컬화하면 값이 그대로다 → key 불변 → world
//   점은 parent 가 없어도 skip 되는 조건이라 **메시가 옛 world 위치에 남았다**
//   (슬라이스·내보내기도 메시를 읽어 옛 자리로 나감).
//   world 점의 메시는 저장 world 좌표만으로 형상이 정해지므로(parent 없음), key 도
//   저장 world 좌표를 **그대로** 쓰는 것이 맞다. 그러면 커밋 patch 로 좌표가 바뀔
//   때만 key 가 바뀌어 1회 재생성되고, 안 움직였으면 key 동일 → skip 유지
//   (rebuild=freeze 불변식 보존: 드래그 프레임마다가 아니라 커밋 때 1회).
//
//   stl-local 점은 **종전과 바이트 단위로 같은 입력**을 낸다 (B-2·B-18 불변식):
//   저장 좌표(이미 로컬) 그대로 + 재설계 점만 접점 world Y.
import { Vector3, type Matrix } from "@babylonjs/core";
import type { SupportParams, SupportPointV2 } from "../../support/types";
import { buildSupportKey } from "./support-keys";

type Vec3 = [number, number, number];

/** buildSupportKey 에 넘길 좌표 3종 + 재설계 점 world Y. */
export interface SupportKeyInputs {
  contact: Vec3;
  base: Vec3;
  cps: Vec3[] | null;
  /** 재설계 stl-local 점 + STL 로드됨 일 때만 값. 그 외 undefined. */
  surfaceWorldY: number | undefined;
}

/**
 * rebuild key 입력 계산 (순수).
 *
 * @param point    서포트 점 (저장 좌표 그대로)
 * @param stlWorld 점의 stlId STL 의 **현재 world 행렬**. 미로드면 null.
 * @param redesign 재설계(island/slope) 조립 경로 점인지 (useSupportMeshSync 판정).
 */
export function resolveSupportKeyInputs(
  point: SupportPointV2,
  stlWorld: Matrix | null,
  redesign: boolean,
): SupportKeyInputs {
  const isLocal = point.coordSpace === "stl-local";
  // B-18: 재설계 기둥은 발이 플레이트(world Y=0)에 고정돼 모델이 오르내리면
  //   **기둥 길이 자체가 변한다** — parent auto-follow 로는 안 되는 형상 변화라
  //   반드시 재조립해야 한다. local 좌표만 담긴 key 는 수직 이동에 불변이므로
  //   접점의 world Y 를 섞어 "길이가 달라졌으면 재조립" 이 되게 한다.
  //   ※ stl-local 점만 대상 — world 저장 점은 contact 가 이미 world 라 world
  //     matrix 를 또 곱하면 안 된다(그 경로는 저장 좌표 변화로만 key 가 바뀐다).
  const surfaceWorldY =
    redesign && stlWorld && isLocal
      ? Vector3.TransformCoordinates(
          new Vector3(point.contact[0], point.contact[1], point.contact[2]),
          stlWorld,
        ).y
      : undefined;
  // 좌표는 coordSpace 와 무관하게 **저장값 그대로** — stl-local 은 이미 로컬이라
  //   (B-2: 또 로컬화하면 inv(world) 이중 곱), world 는 위 머리 주석 이유로.
  return {
    contact: point.contact,
    base: point.base,
    cps: point.curveControlPoints ?? null,
    surfaceWorldY,
  };
}

/**
 * 서포트 mesh rebuild key (순수) — useSupportMeshSync 가 점마다 호출한다.
 *
 * `resolveSupportKeyInputs` + `buildSupportKey` 에, world 저장 **브릿지**만
 * clip 가능 여부 표식을 덧붙인다.
 *
 * ## 브릿지 clip 표식 — 왜 필요한가
 * 브릿지 형상은 저장 좌표뿐 아니라 **STL 메시·manifold 가 준비됐는지**에도
 * 달려 있다(준비되면 STL 침투부를 깎아 parent=stlMesh 로 붙이고, 아니면 깎지 않은
 * 튜브). 프로젝트를 다시 열면 STL 로드가 비동기라 브릿지가 먼저 **깎이지 않은
 * 채** 만들어질 수 있는데, key 가 저장 world 좌표만 담으면 STL 로드 후
 * (meshLoadTick 재실행) key 가 같아 skip → 영영 안 깎인다. 종전 로컬화 key 는
 * "메시 없으면 world 그대로 / 있으면 로컬" 로 우연히 달라져 이 경우를 다시
 * 만들었으므로, 그 역할만 명시적 표식으로 남긴다.
 * stl-local 점·비브릿지 점에는 아무것도 붙이지 않는다(stl-local key 무변경).
 *
 * @param bridgeClipReady 이 점의 STL 메시 + manifold 모듈 + STL manifold 가
 *   모두 준비돼 clip 을 시도할 수 있는지. 브릿지가 아니면 무시된다.
 */
export function buildSupportRebuildKey(
  point: SupportPointV2,
  params: SupportParams,
  stlWorld: Matrix | null,
  redesign: boolean,
  bridgeClipReady: boolean,
): string {
  const k = resolveSupportKeyInputs(point, stlWorld, redesign);
  const key = buildSupportKey(
    point,
    params,
    k.contact,
    k.base,
    k.cps,
    k.surfaceWorldY,
  );
  if (point.source === "bridge" && point.coordSpace !== "stl-local") {
    return `${key}|clip:${bridgeClipReady ? 1 : 0}`;
  }
  return key;
}
