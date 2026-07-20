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
 */
export function buildSupportKey(
  point: SupportPointV2,
  params: SupportParams,
  localContact: [number, number, number],
  localBase: [number, number, number],
  localCps: [number, number, number][] | null,
): string {
  const f = (v: number) => v.toFixed(3);
  const c = localContact.map(f).join(",");
  const b = localBase.map(f).join(",");
  const cps = localCps ? localCps.map((p) => p.map(f).join(",")).join(";") : "";
  // disc variant 는 dental 치수 스냅샷도 key 에 반영 (형상 결정 요소).
  //   trunk/bridge 는 discSettings 가 없어 빈 문자열 → 기존 key 와 동일.
  const ds = point.discSettings;
  const disc = ds
    ? [
        ds.tipTopDiameter,
        ds.tipBottomDiameter,
        ds.contactDepth,
        ds.supportAngle,
        ds.touchTipDistance,
      ].join(",")
    : "";
  return [
    point.source,
    point.variant ?? "trunk",
    c,
    b,
    cps,
    params.trunkDiameterMm,
    params.tipDiameterMm,
    params.baseDiameterMm,
    params.baseTransitionMm,
    params.tipTransitionMm,
    params.bridgeDiameterMm,
    disc,
  ].join("|");
}
