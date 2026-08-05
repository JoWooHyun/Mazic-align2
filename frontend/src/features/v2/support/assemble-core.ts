// 서포트 조립 코어 (S-4b-1, B안). **순수 모듈 — Babylon import 금지.**
//   부품 지오메트리(구/원뿔/원기둥) + 조립 스펙 → 단일 병합 지오메트리
//   { positions, indices } 를 낸다. 어파인 변환(스케일→회전→이동)을 부품
//   positions 에 적용해 이어붙인다. 순수 함수라 헤드리스(Node)에서 검증 가능
//   (verify-assemble-core.mjs) — 이것이 assemble-support.ts(Babylon 래퍼)와
//   분리한 이유.
//
//   설계서 `docs/설계_서포트재설계_20260720.md` 4-1(접점/핀헤드)·4-2(기둥) 정본.
//
//   좌표계: 부품과 동일한 로컬 좌표. **Z-up (부품 STL 규격)** 이 아니라 여기서는
//   조립 축을 **Y** 로 둔다 — 조립 결과가 씬(Y-up)에 바로 얹히도록, 부품의 Z축을
//   조립 시 Y축으로 회전시켜 배치한다(각 assemble 함수가 X축 +90° 회전 포함).
//   로컬 XZ 원점(0, y, 0) 기준 수직으로 쌓는다. Babylon 래퍼가 이 로컬 형상을
//   contact/base 방향으로 정렬·이동한다.

/** 병합 지오메트리 (positions: xyz flat, indices: 삼각형 3개씩). */
export interface SupportPartsGeometry {
  positions: Float32Array;
  indices: Uint32Array;
}

/** 부품 3종 세트. */
export interface SupportPartsSet {
  sphere: SupportPartsGeometry;
  cone: SupportPartsGeometry;
  cylinder: SupportPartsGeometry;
}

/**
 * 화살촉 수직 서포트 조립 스펙 (전부 mm, 로컬 축 = Y 수직).
 *   surfaceY : 모델 표면 접점 Y (로컬). 앞구슬 꼭대기가 여기서 침투 깊이만큼 위로.
 *   baseY    : 바닥판(플레이트) Y (로컬). 보통 0.
 *   나머지는 SupportParams/point 에서 온다(하드코딩 금지 — 수용 4).
 */
export interface VerticalSupportSpec {
  surfaceY: number;
  baseY: number;
  /** 앞구슬(팁) 지름. = 2×point.tipRadius (없으면 params.tipDiameterMm). */
  tipDiameterMm: number;
  /** 화살촉 뒷구슬 지름 (params.headBackDiameterMm). */
  headBackDiameterMm: number;
  /** 화살촉 길이 = 앞구슬 중심 → 뒷구슬 중심 (params.headLengthMm). */
  headLengthMm: number;
  /** 접점 침투 깊이 (params.contactPenetrationMm). */
  contactPenetrationMm: number;
  /** 기둥(트렁크) 지름 (params.trunkDiameterMm). */
  trunkDiameterMm: number;
  /** 바닥 발 밑면 지름 (params.baseDiameterMm). */
  baseDiameterMm: number;
  /** 바닥 발(원뿔) 높이 = 기둥→바닥 전이 (params.baseTransitionMm). */
  baseTransitionMm: number;
}

// ── 4×4 어파인 행렬 유틸 (row-major, column-vector 곱: v' = M·v) ──────────
type Mat4 = number[]; // 길이 16.

function matMul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0) as Mat4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  }
  return out;
}

/** 비균일 스케일. **음수 스케일 금지**(winding 뒤집힘) — 뒤집기는 회전으로. */
function matScale(sx: number, sy: number, sz: number): Mat4 {
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
}

function matTranslate(tx: number, ty: number, tz: number): Mat4 {
  return [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1];
}

/** X축 회전 (rad). */
function matRotX(a: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

/** 부품 Z-up → 조립 Y-up: Z축을 +Y 로 세우는 회전 = X축 -90°.
 *   (Z=1 인 꼭짓점이 Y=+1 로 감. cone/cylinder 의 "위"가 +Y 가 되게.) */
function matZupToYup(): Mat4 {
  return matRotX(-Math.PI / 2);
}

/**
 * 부품 지오메트리에 어파인 변환 M 을 적용해 acc(누적 배열)에 이어붙인다.
 *   indices 는 현재 정점 오프셋만큼 밀어 재부여한다. (부품 indices 는 0..N 순번.)
 */
function appendTransformed(
  part: SupportPartsGeometry,
  m: Mat4,
  accPos: number[],
  accIdx: number[],
): void {
  const vbase = accPos.length / 3;
  const p = part.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    accPos.push(
      m[0] * x + m[1] * y + m[2] * z + m[3],
      m[4] * x + m[5] * y + m[6] * z + m[7],
      m[8] * x + m[9] * y + m[10] * z + m[11],
    );
  }
  const idx = part.indices;
  for (let i = 0; i < idx.length; i++) accIdx.push(idx[i] + vbase);
}

/**
 * 화살촉 수직 서포트 조립 (설계 4-1/4-2). 로컬 XZ 원점 기준 수직(축 = Y).
 *
 * 위(모델 표면)→아래(바닥) 순서, y 좌표는 로컬:
 *  - 앞구슬(설계 4-1): sphere 를 ⌀tip 으로 스케일, 중심 Y =
 *      surfaceY + contactPenetrationMm − tipRadius. 구 꼭대기가 표면을 침투
 *      깊이만큼 파고든다.
 *  - 화살촉 원뿔(4-1): cone 을 밑면 ⌀headBack·높이 headLengthMm 로, 꼭짓점이
 *      앞구슬 중심에 오도록(위로 좁아짐). cone 로컬은 밑면 Z=0·꼭짓점 Z=1 →
 *      Z-up→Y-up 회전으로 밑면 아래(뒷구슬쪽)·꼭짓점 위(앞구슬쪽)에 놓인다.
 *  - 뒷구슬(4-1): sphere 를 ⌀headBack 으로, 중심 = 원뿔 밑면 중심.
 *  - 기둥(4-2): cylinder 를 ⌀trunk 로, 뒷구슬 중심 → (baseY + baseTransitionMm).
 *  - 바닥 발(4-2 전이): cone 을 넓은 밑면 ⌀base 가 Y=baseY(플레이트)에 닿고 위로
 *      좁아져 기둥에 연결. 높이 baseTransitionMm.
 *
 * 총 높이(surfaceY−baseY)가 baseTransitionMm+headLengthMm 보다 작으면 화살촉+
 * 바닥 전이 구간을 비례 축소(기존 createSupportMesh 의 0.95 축소 패턴 참고).
 */
export function assembleVerticalSupport(
  parts: SupportPartsSet,
  spec: VerticalSupportSpec,
): SupportPartsGeometry {
  const accPos: number[] = [];
  const accIdx: number[] = [];

  const tipR = spec.tipDiameterMm * 0.5;
  const trunkD = spec.trunkDiameterMm;
  const baseD = spec.baseDiameterMm;

  // 형상 축소: 총 높이가 (바닥 전이 + 화살촉 길이) 보다 작으면 두 구간을 비례
  //   축소한다. (기존 createSupportMesh 의 0.95 축소 패턴과 동일한 취지.)
  const total = spec.surfaceY - spec.baseY;
  let headLen = spec.headLengthMm;
  let baseTrans = spec.baseTransitionMm;
  const need = baseTrans + headLen;
  if (need > 0 && total > 0 && need >= total) {
    const scale = (total / need) * 0.95;
    headLen *= scale;
    baseTrans *= scale;
  }

  // 앞구슬 중심 Y (설계 4-1: 꼭대기가 침투 깊이만큼 파고듦).
  const frontCenterY = spec.surfaceY + spec.contactPenetrationMm - tipR;
  // 뒷구슬 중심 Y = 앞구슬 중심에서 화살촉 길이만큼 아래.
  const backCenterY = frontCenterY - headLen;
  // 바닥 발 상단(=기둥 하단) Y.
  const footTopY = spec.baseY + baseTrans;

  // ── 앞구슬: sphere ⌀tip, 중심 frontCenterY ──────────────────────────────
  appendTransformed(
    parts.sphere,
    matMul(
      matTranslate(0, frontCenterY, 0),
      matScale(spec.tipDiameterMm, spec.tipDiameterMm, spec.tipDiameterMm),
    ),
    accPos,
    accIdx,
  );

  // ── 화살촉 원뿔: 밑면 ⌀headBack·높이 headLen, 꼭짓점=앞구슬 중심(위로 좁아짐) ─
  //   cone 로컬: 밑면 Z=0, 꼭짓점 Z=1. Z-up→Y-up 후 밑면은 Y=0·꼭짓점 Y=1.
  //   → 스케일 (headBack, headLen, headBack) 후 밑면 = backCenterY 로 이동하면
  //     꼭짓점이 backCenterY+headLen = frontCenterY 에 온다. (좁아짐 = 위.)
  appendTransformed(
    parts.cone,
    matMul(
      matTranslate(0, backCenterY, 0),
      matMul(
        matScale(spec.headBackDiameterMm, headLen, spec.headBackDiameterMm),
        matZupToYup(),
      ),
    ),
    accPos,
    accIdx,
  );

  // ── 뒷구슬: sphere ⌀headBack, 중심 backCenterY ─────────────────────────
  appendTransformed(
    parts.sphere,
    matMul(
      matTranslate(0, backCenterY, 0),
      matScale(
        spec.headBackDiameterMm,
        spec.headBackDiameterMm,
        spec.headBackDiameterMm,
      ),
    ),
    accPos,
    accIdx,
  );

  // ── 기둥: cylinder ⌀trunk, 뒷구슬 중심(backCenterY) → footTopY ──────────
  //   cylinder 로컬 Z 0→1 → Y-up 후 Y 0→1. 높이 = backCenterY − footTopY.
  const trunkH = Math.max(backCenterY - footTopY, 1e-4);
  appendTransformed(
    parts.cylinder,
    matMul(
      matTranslate(0, footTopY, 0),
      matMul(matScale(trunkD, trunkH, trunkD), matZupToYup()),
    ),
    accPos,
    accIdx,
  );

  // ── 바닥 발: 넓은 밑면 ⌀base 가 Y=baseY(플레이트), 위로 좁아져 기둥에 연결 ──
  //   설계 4-2 전이: "넓은 면이 아래". cone 로컬 밑면 Z=0·꼭짓점 Z=1 →
  //   Z-up→Y-up 후 밑면 Y=0·꼭짓점 Y=+1. 스케일 (base, baseTrans, base) 후 Y
  //   이동 baseY: 밑면(넓음) = baseY, 꼭짓점(좁음) = baseY+baseTrans = footTopY.
  //   → 플레이트에 넓게 닿고 위로 좁아져 ⌀trunk 기둥에 이어진다.
  appendTransformed(
    parts.cone,
    matMul(
      matTranslate(0, spec.baseY, 0),
      matMul(matScale(baseD, baseTrans, baseD), matZupToYup()),
    ),
    accPos,
    accIdx,
  );

  return {
    positions: new Float32Array(accPos),
    indices: new Uint32Array(accIdx),
  };
}
