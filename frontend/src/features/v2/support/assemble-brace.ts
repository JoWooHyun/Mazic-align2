// 서포트 재설계(S-4b-2d 2단계) **기둥 연결 브레이스 형상 조립**. 순수 모듈 — Babylon import 금지.
//   `interconnect-pillars.ts` 가 계획한 다리(`PillarBrace`)를 실제 지오메트리로 만든다.
//
//   ## 새 프리미티브를 만들지 않는다
//   다리는 "임의 방향 막대" 하나다 — `assemble-strut.ts` 의 `assembleStrut` 가 정확히
//   그 용도로 이미 있고, 그 파일 머리 주석이 **4-6(기둥끼리 지그재그 연결)을 예정
//   소비자로 명시**한다. 새로 만들면 회전 수치 안정성(−Y 근처 파국적 상쇄 처리)을
//   다시 증명해야 하고 `verify-assemble-strut.mjs` 의 보장 밖으로 나간다.
//
//   ## 좌표계 — assemble-route 규약
//   **world 좌표를 그대로 받아 world 에 조립**한다(shift=0). 다리는 두 기둥에
//   걸쳐 있어 "로컬 XZ 원점 기준"이 의미가 없기 때문이다 — assemble-route.ts 가
//   폴백 경로에서 같은 이유로 같은 선택을 했다. 호출 측은 결과를 평행이동 없이
//   inv(world) 로 로컬화만 하면 된다.
//
//   ## 양 끝에 접합 구(Junction)를 넣지 않는 이유
//   다리의 양 끝은 **기둥 옆면에 파고든다**. 기둥 반경 ≥ 다리 반경이므로
//   (계획 모듈이 `radiusMm = min(두 기둥 반경)` 으로 정한다) 접합부 단면은 이미
//   기둥 단면이 보장한다 — 구를 더 박으면 중복 체적만 늘고 슬라이스 단면이
//   불필요하게 굵어진다. `assembleBentPath` 가 "양 끝에는 구를 넣지 않는다"고
//   한 것과 같은 논지다.

import { assembleStrut, type Vec3 } from "./assemble-strut";
import type {
  SupportPartsGeometry,
  SupportPartsSet,
} from "./assemble-core";

/** 다리 하나의 조립 스펙 — 저장 레코드에서 world 로 편 것. */
export interface BraceSpec {
  /** 시작 world 좌표. */
  from: Vec3;
  /** 끝 world 좌표. */
  to: Vec3;
  /** 다리 반경 (mm). 지름이 아니라 **반경**. */
  radiusMm: number;
}

/** 빈 지오메트리 (입력 0개 등 퇴화 입력의 반환값). */
function emptyGeometry(): SupportPartsGeometry {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

/**
 * 브레이스 여러 개를 **하나의 지오메트리로** 병합 조립한다.
 *
 * 한 덩어리로 묶는 이유: 다리는 개별 삭제 대상이 아니고(리드 확정 "자동으로만"),
 * 메시를 다리마다 쪼개면 `supportMeshMapRef` 항목 수가 다리 수만큼 늘어
 * `slice-export-handle.ts` 의 6곳이 전부 그만큼 더 순회한다(export·슬라이스
 * 마스크가 다리 개수에 비례해 느려진다). 기둥 단위로 묶으면 항목 수가 기둥 수에
 * 머문다.
 *
 * @param parts  부품 세트(소비자가 주입 — assemble-strut 과 같은 인터페이스).
 * @param braces 다리 목록 (world 좌표).
 * @returns 전 구간이 병합된 단일 지오메트리. 빈 입력이면 빈 지오메트리.
 */
export function assemblePillarBraces(
  parts: SupportPartsSet,
  braces: readonly BraceSpec[],
): SupportPartsGeometry {
  if (braces.length === 0) return emptyGeometry();

  const accPos: number[] = [];
  const accIdx: number[] = [];

  for (const b of braces) {
    // 길이 0 다리는 assembleStrut 이 빈 지오메트리로 돌려준다(조용히 스킵).
    const geo = assembleStrut(parts, b.from, b.to, b.radiusMm);
    const vbase = accPos.length / 3;
    for (let i = 0; i < geo.positions.length; i++) accPos.push(geo.positions[i]);
    for (let i = 0; i < geo.indices.length; i++) accIdx.push(geo.indices[i] + vbase);
  }

  return {
    positions: new Float32Array(accPos),
    indices: new Uint32Array(accIdx),
  };
}
