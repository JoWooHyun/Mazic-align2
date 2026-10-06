// 출력영역(빌드 볼륨) 초과 판정 — 순수 모듈 (Babylon 무의존).
//
//   근거: `docs/판정_CHITUBOX분석_20260821.md` C-2.
//     분석 문서 `docs/view94.md` 15장 "Build Volume 초과 표시" + Acceptance Test
//     "모델을 Plate 밖으로 옮기면 해당 부분이 경고색 / 완전히 내부로 들어오면 정상색".
//
//   ## 왜 CPU AABB 인가 (문서의 Shader 방식을 채택하지 않은 이유)
//   문서는 Fragment Shader 에서 world 좌표를 볼륨 min/max 와 비교해 즉시 색을
//   바꾸라고 권한다. 우리는 그 길을 가지 않는다:
//     · 우리 모델 머티리얼은 `StandardMaterial` + **vertex color 기반 오버행
//       하이라이트**(`utils/overhang.ts`)를 쓴다. 커스텀 셰이더를 끼우면 그
//       하이라이트와 색 채널을 두고 충돌한다.
//     · 문서 15장 스스로도 "다만 출력 가능 여부 **최종 판정은 별도의 CPU AABB
//       검사로도 수행**한다"고 적는다. 우리에게 필요한 건 그 최종 판정이다
//       (경고를 띄우고 Export 전에 알려주는 것이 목적이지, 면 단위 그라데이션이
//       목적이 아니다).
//   → AABB 비교는 모델당 6회 비교라 매 프레임 돌려도 무해하다.
//
//   ## 판정 기준
//   빌드 볼륨은 플레이트 중앙 원점 기준이다(`utils/scene-setup.ts` 의 CreateGround
//   가 원점 중심). 즉 X ∈ [-w/2, +w/2], Z ∈ [-d/2, +d/2], Y ∈ [0, h].
//   Y 하한이 0 인 것은 플레이트 아래로 파고든 모델을 잡기 위함이다.

/** 빌드 볼륨 크기 (mm). 모두 양수. */
export interface BuildVolumeMm {
  widthMm: number;
  depthMm: number;
  /** 높이 상한. 0 이하이면 높이 검사를 하지 않는다(프로파일 미설정 등). */
  heightMm: number;
}

/** world AABB (mm). Babylon boundingBox 의 minimumWorld/maximumWorld 와 같은 의미. */
export interface WorldAabbMm {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** 어느 방향으로 벗어났는지. 모두 false 면 볼륨 안. */
export interface BuildVolumeViolation {
  minX: boolean;
  maxX: boolean;
  minZ: boolean;
  maxZ: boolean;
  /** 플레이트 아래로 파고듦 (Y < 0). */
  belowPlate: boolean;
  /** 최대 높이 초과 (Y > heightMm). heightMm <= 0 이면 항상 false. */
  aboveMax: boolean;
}

/** 위반이 하나라도 있으면 true. */
export function hasViolation(v: BuildVolumeViolation): boolean {
  return (
    v.minX || v.maxX || v.minZ || v.maxZ || v.belowPlate || v.aboveMax
  );
}

/**
 * world AABB 가 빌드 볼륨을 벗어났는지 축별로 판정한다.
 *
 * 경계에 정확히 걸친 경우(= 값이 같음)는 **위반이 아니다** — 플레이트 가장자리에
 * 딱 맞춘 배치를 경고로 띄우면 오탐이 된다. 부동소수 잡음을 흡수하려고
 * `epsMm`(기본 1e-6) 만큼 여유를 둔다.
 */
export function checkBuildVolume(
  aabb: WorldAabbMm,
  volume: BuildVolumeMm,
  epsMm = 1e-6,
): BuildVolumeViolation {
  const halfW = Math.max(volume.widthMm, 0) / 2;
  const halfD = Math.max(volume.depthMm, 0) / 2;
  const h = volume.heightMm;

  return {
    minX: aabb.minX < -halfW - epsMm,
    maxX: aabb.maxX > halfW + epsMm,
    minZ: aabb.minZ < -halfD - epsMm,
    maxZ: aabb.maxZ > halfD + epsMm,
    belowPlate: aabb.minY < -epsMm,
    aboveMax: h > 0 && aabb.maxY > h + epsMm,
  };
}

/**
 * 위반 내용을 사용자용 한국어 문구로 만든다. 위반이 없으면 null.
 *   축 이름은 **표시 좌표계(Z-up)** 기준으로 적는다 — 사용자가 보는 패널이
 *   Z-up 이므로(B-13, `types/axis-display.ts`) 내부 Y-up 명칭을 그대로 쓰면
 *   "높이가 Y"라고 읽혀 혼란스럽다. 내부 Y(높이) = 표시 Z.
 */
export function describeViolation(
  v: BuildVolumeViolation,
  /** 영역 이름 — 기본 "출력영역"(기존 문구 그대로). Task0 는 "출력 가능 영역"(Z2). */
  areaLabel = "출력영역",
): string | null {
  if (!hasViolation(v)) return null;
  const parts: string[] = [];
  if (v.minX || v.maxX) parts.push("X");
  if (v.minZ || v.maxZ) parts.push("Y"); // 내부 Z(안쪽) = 표시 Y
  if (v.aboveMax) parts.push("높이");
  const axes = parts.length > 0 ? `${parts.join("·")} 방향` : "";
  if (v.belowPlate) {
    return axes
      ? `${areaLabel}을 벗어남 (${axes}) + 플레이트 아래로 내려감`
      : "모델이 플레이트 아래로 내려감";
  }
  return `${areaLabel}을 벗어남 (${axes})`;
}

// ── Task0 출력 가능 영역 (Z2) ─────────────────────────────────────────────
//   Task0 는 플레이트(= 노즐 범위 150 × 85) 안에서도 **투사 ∩ 노즐 범위**(X 10~150 × Y 10~85)만 출력된다.
//   그 영역은 플레이트 중심 원점 기준으로 비대칭이라(world X −65~75 × Z −32.5~42.5) 위의 대칭 판정
//   (checkBuildVolume)으로는 잡을 수 없다. 또 서포트도 도포·노광되므로 **모델과 서포트를 함께** 본다.
//   영역 값은 utils/task0/task0-frame.ts task0PrintableWorldRect 가 베드 좌표에서 변환해 준다(여기에 상수 없음).
//   기존 프로파일은 이 경로를 쓰지 않는다 — checkBuildVolume 은 그대로다.

/** world 출력 가능 영역 (mm). X ∈ [minX, maxX], Z ∈ [minZ, maxZ] — 비대칭 가능. */
export interface PrintableAreaMm {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * world AABB 가 출력 가능 영역(비대칭)을 벗어났는지 — checkBuildVolume 과 같은 모양·같은 경계 규칙
 * (경계에 딱 맞은 것은 위반 아님, epsMm 여유). 높이는 Y ∈ [0, heightMm] (heightMm ≤ 0 이면 상한 검사 안 함).
 */
export function checkPrintableArea(
  aabb: WorldAabbMm,
  area: PrintableAreaMm,
  heightMm: number,
  epsMm = 1e-6,
): BuildVolumeViolation {
  return {
    minX: aabb.minX < area.minX - epsMm,
    maxX: aabb.maxX > area.maxX + epsMm,
    minZ: aabb.minZ < area.minZ - epsMm,
    maxZ: aabb.maxZ > area.maxZ + epsMm,
    belowPlate: aabb.minY < -epsMm,
    aboveMax: heightMm > 0 && aabb.maxY > heightMm + epsMm,
  };
}

/** 영역 검사 대상 모델 하나 */
export interface AreaCheckModel {
  id: string;
  aabb: WorldAabbMm;
}

/** 영역 검사 대상 서포트 하나 — parentId = 붙은 모델 id (모델을 못 찾으면 null) */
export interface AreaCheckSupport {
  parentId: string | null;
  aabb: WorldAabbMm;
}

/**
 * 영역 밖 항목 하나. 서포트는 **붙은 모델별로 묶는다**(모델 하나에 서포트가 수백 개라 하나씩 띄우면
 * 경고 목록이 의미를 잃는다) — count = 묶음 안 위반 서포트 수, aabb = 그들의 합집합, violation = 방향 OR.
 */
export interface AreaCheckEntry {
  kind: "model" | "support";
  /** model: 모델 id / support: 붙은 모델 id (없으면 null) */
  id: string | null;
  count: number;
  aabb: WorldAabbMm;
  violation: BuildVolumeViolation;
}

/**
 * 모델 + 서포트를 출력 가능 영역으로 검사한다 (순수 — useBuildVolumeCheck 와 검증 스크립트가 함께 쓴다).
 *   - 모델: checkPrintableArea 전부(가로·세로·플레이트 아래·높이).
 *   - 서포트: **가로·세로(X/Z)만** 본다. 서포트 바닥은 플레이트(Y = 0)에 세우는 구조라 Y 하한 검사는
 *     부품 조립의 부동소수 잡음으로 오탐만 내고, 플레이트 아래로 파고든 모델은 모델 검사가 이미 잡는다.
 * 순서: 모델(입력 순서) → 서포트 묶음(그 묶음의 첫 위반이 나온 순서).
 */
export function checkItemsInPrintableArea(
  models: readonly AreaCheckModel[],
  supports: readonly AreaCheckSupport[],
  area: PrintableAreaMm,
  heightMm: number,
  epsMm = 1e-6,
): AreaCheckEntry[] {
  const out: AreaCheckEntry[] = [];
  for (const m of models) {
    const violation = checkPrintableArea(m.aabb, area, heightMm, epsMm);
    if (hasViolation(violation)) out.push({ kind: "model", id: m.id, count: 1, aabb: { ...m.aabb }, violation });
  }
  const groups = new Map<string | null, AreaCheckEntry>();
  for (const s of supports) {
    const full = checkPrintableArea(s.aabb, area, 0, epsMm);
    const violation: BuildVolumeViolation = { ...full, belowPlate: false, aboveMax: false };
    if (!hasViolation(violation)) continue;
    const g = groups.get(s.parentId);
    if (!g) {
      const entry: AreaCheckEntry = { kind: "support", id: s.parentId, count: 1, aabb: { ...s.aabb }, violation };
      groups.set(s.parentId, entry);
      out.push(entry);
      continue;
    }
    g.count++;
    g.aabb = {
      minX: Math.min(g.aabb.minX, s.aabb.minX),
      minY: Math.min(g.aabb.minY, s.aabb.minY),
      minZ: Math.min(g.aabb.minZ, s.aabb.minZ),
      maxX: Math.max(g.aabb.maxX, s.aabb.maxX),
      maxY: Math.max(g.aabb.maxY, s.aabb.maxY),
      maxZ: Math.max(g.aabb.maxZ, s.aabb.maxZ),
    };
    g.violation = {
      minX: g.violation.minX || violation.minX,
      maxX: g.violation.maxX || violation.maxX,
      minZ: g.violation.minZ || violation.minZ,
      maxZ: g.violation.maxZ || violation.maxZ,
      belowPlate: false,
      aboveMax: false,
    };
  }
  return out;
}
