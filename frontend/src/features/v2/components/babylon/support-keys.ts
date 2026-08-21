// 서포트 mesh 재생성 판정용 key 빌더. BabylonScene 에서 순수 이동 — 로직 무변경.
import type { SupportParams, SupportPointV2 } from "../../support/types";

export function buildBridgeClipKey(
  point: SupportPointV2,
  params: SupportParams,
): string {
  const f = (v: number) => v.toFixed(3);
  const c = point.contact.map(f).join(",");
  const b = point.base.map(f).join(",");
  const cps = (point.curveControlPoints ?? [])
    .map((p) => p.map(f).join(","))
    .join(";");
  return `${c}|${b}|${cps}|${params.bridgeDiameterMm}`;
}

/**
 * support 전체 rebuild 판정용 key. STL local 좌표 기준이라 STL transform
 * 이 변경되어도 (world 좌표는 바뀌지만 local 좌표 = 원래 값) key 동일 →
 * mesh 재생성 skip. mesh.parent = stlMesh 로 auto-follow 되므로 world
 * 위치는 자동 이동. rebuild = freeze 원인이므로 이 skip 이 핵심.
 *
 * localContact/localBase 는 stlInvWorld 로 미리 변환한 좌표를 전달.
 *
 * ## B-18 예외 — 재설계 점의 세로 위치
 * 위 "local 좌표라 transform 되어도 key 불변" 은 **재설계(island/slope) 점의 수직
 * 이동에는 그대로 쓸 수 없다**. 재설계 기둥은 발이 플레이트(world Y=0)에 고정돼
 * 있어서(assemble-core `resolveRedesignBaseY`) 모델이 오르내리면 **기둥 길이 자체가
 * 달라진다** — parent auto-follow 로는 표현할 수 없는 형상 변화다. local 좌표만으로
 * key 를 만들면 key 가 그대로라 재조립이 skip 되고, 옛 길이의 기둥이 모델을 따라
 * 떠올라 발이 바닥에서 뜬다.
 * 그래서 재설계 점에 한해 `redesignSurfaceWorldY`(접점의 world Y)를 key 에 섞는다.
 * 이 값이 곧 기둥 길이를 결정하는 유일한 입력이다. 다른 경로(trunk/bridge/manual)와
 * 옛 호출부는 인자를 주지 않으면 종전과 **완전히 같은 key** 를 얻는다(무회귀).
 */
export function buildSupportKey(
  point: SupportPointV2,
  params: SupportParams,
  localContact: [number, number, number],
  localBase: [number, number, number],
  localCps: [number, number, number][] | null,
  /** 재설계 점 전용 — 접점의 world Y. 없으면 key 에 아무것도 더하지 않는다. */
  redesignSurfaceWorldY?: number,
): string {
  const f = (v: number) => v.toFixed(3);
  const c = localContact.map(f).join(",");
  const b = localBase.map(f).join(",");
  const cps = localCps ? localCps.map((p) => p.map(f).join(",")).join(";") : "";
  // S-4b-2c: 폴백 경로(bent/anchor/joinPillar)는 형상이 통째로 달라지므로 경로
  //   종류와 꺾임점을 key 에 섞는다.
  //   ★ 미지정(기존 데이터·1단 수직) 점에서는 **아무 항목도 붙이지 않는다** —
  //     빈 문자열을 넣기만 해도 구분자 '|' 가 늘어 key 가 달라지므로, 배열
  //     자체를 조건부로 이어 붙여 종전 key 문자열과 **바이트 단위로 동일**하게
  //     유지한다(무회귀 — 수용 6, verify-route-plan §키 무회귀가 확인).
  const routeParts: (string | number)[] = point.routeKind
    ? [
        point.routeKind,
        // cps 와 같은 포맷(소수 3자리, 축은 콤마·점은 세미콜론).
        point.routeWaypoints
          ? point.routeWaypoints.map((p) => p.map(f).join(",")).join(";")
          : "",
      ]
    : [];
  return [
    point.source,
    // 재설계(island/slope) 점은 화살촉 조립 경로라 kind·tipRadius·새 파라미터가
    //   형상에 영향 → key 에 포함해 값 변경 시 재조립. 기존 점은 kind undefined
    //   라 "" 로 들어가 종전 key 와 사실상 동일(경로 무변경).
    point.kind ?? "",
    point.tipRadius ?? "",
    c,
    b,
    cps,
    params.trunkDiameterMm,
    params.tipDiameterMm,
    params.baseDiameterMm,
    params.baseTransitionMm,
    params.tipTransitionMm,
    params.bridgeDiameterMm,
    params.headBackDiameterMm,
    params.headLengthMm,
    params.contactPenetrationMm,
    // B-18: 재설계 점만 world Y 를 섞는다. undefined 면 "" 라 종전 key 와 동일.
    redesignSurfaceWorldY != null ? redesignSurfaceWorldY.toFixed(3) : "",
    ...routeParts,
  ].join("|");
}
