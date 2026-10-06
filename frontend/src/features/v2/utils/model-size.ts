/**
 * 모델 크기(mm) 표시·입력 + "출력 영역에 맞춤" — 순수 계산 (데모 빈칸 #1).
 *
 * 설계: `docs/계획_11월데모_20260923.md` §3 #1 — 프루사처럼 Size(mm) ↔ Scale(%) 연동.
 * 화면 배선은 `components/TransformPanel.tsx`. 여기는 Mesh·DOM 없이 계산만 한다 —
 * 헤드리스 검증(`scripts/verify-model-size.mjs`)이 그대로 import 한다.
 *
 * ## 크기 = 모델의 world AABB (서포트 제외)
 * 출력영역 검사(useBuildVolumeCheck 의 worldVertexAabb — **실제 정점**으로 만든 타이트한 상자, B-21)와
 * 같은 상자를 쓴다(씬 핸들 getModelWorldAabb). 그래서 "크기" 칸 · "출력 영역에 맞춤" · 빨간 박스 판정이
 * 한 상자를 본다. 표시 축은 Position·Scale 과 같은 Z-up 규약(B-13) — 크기는 부호가 없으므로
 * 배율처럼 축 교환만 한다(`swapScaleAxes`, 위치용 toDisplayAxes 의 −z 부호를 붙이면 안 된다).
 *
 * ## 회전된 모델의 크기 입력
 * 배율(sx·sy·sz)은 회전 **전** 모델 로컬 축에 걸린다(matrixFromTransform: S → R → T).
 *   · 회전이 축 정렬(90° 배수)이면 world 축 하나 = 로컬 축 하나라, 그 로컬 축 배율만 바꾸면
 *     그 world 크기만 정확히 바뀐다 → "비율 유지" 를 끄면 축별로 바꿀 수 있다.
 *   · 축 정렬이 아니면 world 축 하나에 로컬 축 여럿이 섞여 있어 "그 축 크기만" 바꾸는 배율이 없다
 *     (전단이 필요한데 TransformV2 는 전단을 못 담는다). → 이때는 "비율 유지" 가 꺼져 있어도
 *     **세 축 같은 비율**로 바꾼다. 균일 배율은 world 상자도 정확히 같은 비율로 키우므로 입력한 축의
 *     크기는 정확히 입력값이 된다.
 */
import { Matrix, Quaternion } from "@babylonjs/core";

import { swapScaleAxes, type Vec3 } from "../types/axis-display";
import type { PrinterProfileV2 } from "../types/printer";
import type { TransformV2 } from "../types/transform";
import type { PrintableAreaMm, WorldAabbMm } from "./build-volume";
import { formatNumberForDisplay } from "./number-input";
import { task0PrintableAreaForProfile } from "./task0/task0-profile";
import { degToRad } from "./transform";

/**
 * 배율 한계 (%) — TransformPanel 의 Scale(%) 칸 min/max 와 **같은 값**(단일 소스).
 * 크기(mm) 입력·맞춤도 이 범위를 따른다.
 */
export const SCALE_PERCENT_MIN = 1;
export const SCALE_PERCENT_MAX = 10000;
/** 배율 한계 (배) — 위 % 값 / 100. 내부 TransformV2.sx/sy/sz 와 같은 단위. */
export const SCALE_MIN = SCALE_PERCENT_MIN / 100;
export const SCALE_MAX = SCALE_PERCENT_MAX / 100;

/**
 * "출력 영역에 맞춤" 의 가장자리 여유 (mm) — 가로·세로 각 변과 높이 위쪽.
 *
 * 근거:
 *   · 기존 서포트(자동·수동)는 접점이 모델 표면에 있고 발이 그 바로 아래라, 발판이 모델 상자 밖으로
 *     **발판 반지름**만큼 나올 수 있다. 기본 바닥 지름 1.5 mm(반지름 0.75)를 2 mm 가 덮는다.
 *     Task0 는 서포트도 출력 가능 영역 검사 대상이다(Z2) — 맞춘 직후 서포트 때문에 빨간 박스가 뜨지 않게.
 *   · 영역 경계에 딱 붙이면 float32 world 행렬(Babylon) 반올림만으로 경계를 µm 단위로 넘을 수 있다.
 *   · 마스크 픽셀(수십 µm)·노즐 도포폭(0.5 mm, Task0) 가장자리 여유.
 * 2 mm 는 위를 덮으면서 140 × 75 mm 영역(Task0)에서 잃는 면적이 작다(각 축 3~5 %).
 */
export const FIT_MARGIN_MM = 2;

/**
 * 맞춤 바닥의 최소 높이 (mm) = 1 µm. 바닥을 플레이트(Y = 0)에 **딱** 놓으면 Babylon world 행렬(float32)
 * 반올림만으로 최저점이 −3e-6 mm 쯤 되어 출력영역 검사(허용 1e-6)가 "플레이트 아래로 내려감" 을
 * 띄운다(verify-model-size 실측 — 20 mm 큐브를 X 90° 눕힌 경우). 잡음은 world 크기 2000 mm 에서도
 * ~1e-4 mm 라 1 µm 면 넉넉하고, 레이어(수십 µm)에 비하면 출력에 영향이 없다.
 */
export const FIT_FLOOR_CLEARANCE_MM = 0.001;

/** 이 크기(mm) 이하인 축은 두께가 없는 것으로 본다 — 0 에서는 비율을 정의할 수 없다. */
const DEGENERATE_MM = 1e-6;

/**
 * 회전행렬 원소가 0/±1 인지 보는 허용치. 1e-4 rad ≈ 0.0057°.
 * 기즈모 왕복 float32 잡음(최대 ~1.2e-4° ≈ 2e-6 rad, B-15c)보다 50배 위라 "90° 배수" 가 잡음으로
 * 놓치지 않고, 그보다 크게 기운 회전은 축 정렬이 아니라고 본다.
 */
const AXIS_ALIGN_EPS = 1e-4;

/** 표시 축 → world(내부) 축 인덱스. 크기·배율은 부호 없는 축 교환이라 [0, 2, 1] (표시 Y = 내부 Z, 표시 Z = 내부 Y). */
const DISPLAY_TO_WORLD_AXIS = swapScaleAxes([0, 1, 2]);

/**
 * world AABB → 표시 크기 [X, Y, Z] mm (Z-up, B-13). 표시 Z = 높이(내부 Y).
 */
export function toDisplaySize(aabb: WorldAabbMm): Vec3 {
  return swapScaleAxes([
    aabb.maxX - aabb.minX,
    aabb.maxY - aabb.minY,
    aabb.maxZ - aabb.minZ,
  ]);
}

/**
 * 회전이 축 정렬(90° 배수)이면 `out[w]` = world(내부) 축 w 를 담당하는 **로컬 축** 인덱스. 아니면 null.
 *
 * Babylon 회전행렬은 행벡터 규약이라 world_w = Σ_j local_j · m[4j + w] — 로컬 축 j 의 world 방향이
 * 행 j 다. 열 w 에서 |원소| ≈ 1 인 행이 정확히 하나이고 나머지가 ≈ 0 이면 축 정렬이다.
 * 메쉬와 같은 합성(Quaternion.FromEulerAngles — applyTransformToMesh 와 동일)을 쓴다.
 */
export function axisAlignedLocalAxes(rotationDeg: Vec3): Vec3 | null {
  const m = Matrix.Identity();
  Quaternion.FromEulerAngles(
    degToRad(rotationDeg[0]),
    degToRad(rotationDeg[1]),
    degToRad(rotationDeg[2]),
  ).toRotationMatrix(m);
  const e = m.m;
  const out: Vec3 = [0, 0, 0];
  for (let w = 0; w < 3; w++) {
    let found = -1;
    for (let j = 0; j < 3; j++) {
      const v = Math.abs(e[4 * j + w]);
      if (v > 1 - AXIS_ALIGN_EPS) {
        if (found >= 0) return null;
        found = j;
      } else if (v > AXIS_ALIGN_EPS) {
        return null;
      }
    }
    if (found < 0) return null;
    out[w] = found;
  }
  return out;
}

/**
 * 크기 입력이 받을 만한가 — 0·음수·NaN·무한대는 **거부**(클램프해서 받지 않는다).
 * 지금 그 축 크기가 0(두께 없는 모델)이면 비율을 정의할 수 없으므로 역시 거부.
 */
export function isValidSizeInput(valueMm: number, currentMm: number): boolean {
  return (
    Number.isFinite(valueMm) &&
    valueMm > 0 &&
    Number.isFinite(currentMm) &&
    currentMm > DEGENERATE_MM
  );
}

// ── "보인 값 그대로" 가드 (검수 1) ──────────────────────────────────────
//   NumberInput 은 B-14 규약대로 "보인 값 = 적용값" 이다 — 포커스만 주고 빠져나와도 표시 문자열("12.35")을 커밋하고,
//   원래 값(12.3456…)과 다르면 changed 다. Position·Rotation 은 그게 맞다(89.9999999 → 90). 그런데 크기·배율 칸에서는
//   그 미세 차이가 **배율 변경**(k = 1.00035)이 되어 undo 항목 + 덴탈 결과 무효화 + 재설계 서포트 삭제(B-1)까지 일으켰다.
//   실제 STL 크기·맞춤 배율은 거의 다 둥글지 않다. → 이 두 칸만 "표시 문자열이 실제로 바뀐 입력" 일 때 받는다
//   (NumberInput 공용 동작은 그대로, 칸의 isValid 로 건다). 표시 자릿수는 칸 decimals 와 이 가드가 같은 상수를 쓴다.

/** 크기(mm) 칸 표시 소수 자리 */
export const SIZE_DECIMALS = 2;
/** Scale(%) 칸 표시 소수 자리 */
export const SCALE_PERCENT_DECIMALS = 1;

/** 입력 v 가 지금 값 cur 와 **다르게 보이는가** — 같은 표시 문자열이면 false(포커스 후 그대로 빠져나온 것). */
export function changesDisplayedValue(
  v: number,
  cur: number,
  decimals: number,
): boolean {
  return formatNumberForDisplay(v, decimals) !== formatNumberForDisplay(cur, decimals);
}

/** 크기(mm) 칸 — 보인 값 그대로면 false */
export function isSizeInputChange(v: number, cur: number): boolean {
  return changesDisplayedValue(v, cur, SIZE_DECIMALS);
}

/** Scale(%) 칸 — 보인 값 그대로면 false (v·cur 는 % 값) */
export function isScalePercentInputChange(v: number, cur: number): boolean {
  return changesDisplayedValue(v, cur, SCALE_PERCENT_DECIMALS);
}

export interface SizeInputArgs {
  /** 지금 내부 배율 (sx, sy, sz) */
  scale: Vec3;
  /** 지금 내부 회전 (rx, ry, rz) deg */
  rotationDeg: Vec3;
  /** 지금 표시 크기 [X, Y, Z] mm (toDisplaySize) — scale·rotationDeg 와 **같은 시점**의 값 */
  displaySize: Vec3;
  /** 입력한 표시 축 (0/1/2 = 표시 X/Y/Z) */
  axis: 0 | 1 | 2;
  /** 입력한 새 크기 mm */
  valueMm: number;
  /** "비율 유지" 켜짐 */
  uniform: boolean;
}

/**
 * 크기 입력 → 새 내부 배율 (sx, sy, sz). 거부면 null.
 *
 * 비율 k = 새 크기 / 지금 크기.
 *   · 비율 유지 ON, 또는 축 정렬이 아닌 회전 → 세 배율 모두 × k (모양 유지, 입력 축은 정확히 입력값).
 *   · 비율 유지 OFF + 축 정렬 → 그 world 축을 담당하는 로컬 축 배율만 × k.
 * 배율 한계(SCALE_MIN~SCALE_MAX)를 넘는 k 는 Scale(%) 칸처럼 **한계로 맞춘다**(세 축이면 같은 k 로 — 비율 유지).
 */
export function sizeInputToScale(a: SizeInputArgs): Vec3 | null {
  const cur = a.displaySize[a.axis];
  if (!isValidSizeInput(a.valueMm, cur)) return null;
  const k = a.valueMm / cur;

  const local = a.uniform ? null : axisAlignedLocalAxes(a.rotationDeg);
  const targets = local ? [local[DISPLAY_TO_WORLD_AXIS[a.axis]]] : [0, 1, 2];

  const affected = targets.map((j) => a.scale[j]);
  if (affected.some((s) => !Number.isFinite(s) || s <= 0)) return null;
  const kMin = SCALE_MIN / Math.min(...affected);
  const kMax = SCALE_MAX / Math.max(...affected);
  if (!(kMin <= kMax)) return null;
  const kc = Math.min(Math.max(k, kMin), kMax);

  const out: Vec3 = [a.scale[0], a.scale[1], a.scale[2]];
  for (const j of targets) out[j] = a.scale[j] * kc;
  return out;
}

// ── 출력 영역에 맞춤 ──────────────────────────────────────────────────────

/** 맞춤 대상 영역 — world X/Z 사각형 + 높이 상한. */
export interface ModelFitRegion {
  area: PrintableAreaMm;
  /** 높이 상한 mm. 0 이하이면 높이 제한 없음(checkPrintableArea 와 같은 규칙). */
  heightMm: number;
  /** Task0 출력 가능 영역이면 true (문구용). */
  task0: boolean;
}

/**
 * 프로파일 → 맞춤 영역. **빨간 박스 판정과 같은 출처**다:
 *   · Task0 프로파일 → task0PrintableAreaForProfile (useBuildVolumeCheck 의 printableAreaMm 과 같은 값)
 *   · 그 외 → 빌드 크기 buildVolumeMm[0]·[1] 의 플레이트 중심 대칭 사각형 (checkBuildVolume 과 같은 모양)
 *   · 높이 → buildVolumeMm[2] (두 검사 모두 plateHeightMm = buildVolumeMm[2])
 */
export function modelFitRegionForProfile(p: PrinterProfileV2): ModelFitRegion {
  const [w, d, h] = p.buildVolumeMm;
  const task0Area = task0PrintableAreaForProfile(p);
  if (task0Area) {
    return {
      area: {
        minX: task0Area.minX,
        maxX: task0Area.maxX,
        minZ: task0Area.minZ,
        maxZ: task0Area.maxZ,
      },
      heightMm: h,
      task0: true,
    };
  }
  return {
    area: { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 },
    heightMm: h,
    task0: false,
  };
}

/**
 * "다시 맞춰도 그대로" 로 보는 허용치. 이미 맞춘 모델을 또 맞추면 상자를 float32 world 행렬로 다시 재서
 * k = 1 ± 1e-8, 위치 ± 1e-7 mm 수준의 잡음이 나온다(검수 실측 k = 1.0000000134, ty −2.4e-7). 그걸 새 커밋으로
 * 만들면 undo 가 한 번 더 쌓이고 덴탈 결과가 또 무효화된다 → 이 안이면 **무변경**(커밋 없음).
 * 1e-6 배 = 140 mm 에서 0.14 µm, 1e-4 mm = 0.1 µm — 둘 다 눈에도 출력에도 안 보이는 크기.
 */
export const FIT_UNCHANGED_SCALE_EPS = 1e-6;
export const FIT_UNCHANGED_MOVE_MM = 1e-4;

export interface ModelFitResult {
  /** 맞춘 transform — 회전(rx/ry/rz)은 입력 그대로, 배율은 세 축 같은 비율, 위치만 옮긴다. */
  transform: TransformV2;
  /** 곱한 균일 비율 (1 ± FIT_UNCHANGED_SCALE_EPS 면 정확히 1 — 가운데로 옮기기만) */
  scale: number;
  /** 맞춘 뒤 예상 world AABB */
  aabb: WorldAabbMm;
}

/** 맞출 수 없는 이유 — describeFitFailure 가 안내 문구로 바꾼다. */
export type FitFailureReason =
  /** 모델 상자·배율을 읽을 수 없음(두께가 전부 0, NaN 등) */
  | "measure"
  /** 영역이 양쪽 여유보다 좁거나, 바닥 위로 남은 높이가 여유보다 작음 */
  | "space"
  /** 최소 배율로 줄여도 안 들어감 */
  | "scale";

export type FitPlan =
  | { status: "fit"; result: ModelFitResult }
  /** 이미 맞춰져 있다 — 커밋하지 않는다(연타해도 undo 1회) */
  | { status: "unchanged" }
  | { status: "impossible"; reason: FitFailureReason };

/**
 * 모델을 **균일 배율 + 이동**으로 영역 안에 최대한 크게 맞추는 계획.
 *
 *   · 가용 크기 = 영역 가로·세로 − 양쪽 여유, 높이 = 높이 상한 − 바닥 − 위 여유.
 *   · 비율 k = min(가용 / 지금 크기) — 두께 0 인 축은 제외. 배율 한계(SCALE_MIN~MAX)를 넘지 않게 맞추고,
 *     최소 배율로도 안 들어가면 impossible("scale").
 *   · 바닥 = **지금 바닥 높이(기존 리프트)** 그대로 — 서포트용으로 띄워 둔 모델을 바닥에 눕히지 않는다.
 *     플레이트에 닿아 있거나 파고든 모델이면 플레이트 위(FIT_FLOOR_CLEARANCE_MM = 1 µm)로 둔다.
 *   · 가로·세로는 영역 가운데.
 *   · k 가 1 ± FIT_UNCHANGED_SCALE_EPS 면 정확히 1 로 둔다(가운데로 옮기기만 — 배율을 안 건드리므로 재설계
 *     서포트도 B-1 무효화 대상이 아니다). 그러고도 위치 변화가 FIT_UNCHANGED_MOVE_MM 이하면 unchanged.
 *
 * 수학: 배율을 k 배 하고 위치도 k 배 하면 world 상자가 원점 기준으로 정확히 k 배가 된다
 * (world' = R(kS)v + kT = k·world). 그 뒤 평행이동만 더한다. Babylon float32 행렬을 거치지 않아
 * 회전 성분(rx/ry/rz)이 비트 단위로 그대로다(Euler 재분해 없음).
 */
export function planFit(
  t: TransformV2,
  aabb: WorldAabbMm,
  region: ModelFitRegion,
  marginMm: number = FIT_MARGIN_MM,
): FitPlan {
  const w = aabb.maxX - aabb.minX;
  const h = aabb.maxY - aabb.minY;
  const d = aabb.maxZ - aabb.minZ;
  if (![w, h, d, aabb.minY].every(Number.isFinite)) {
    return { status: "impossible", reason: "measure" };
  }
  const scales = [t.sx, t.sy, t.sz];
  if (scales.some((s) => !Number.isFinite(s) || s <= 0)) {
    return { status: "impossible", reason: "measure" };
  }

  const { area } = region;
  const availW = area.maxX - area.minX - 2 * marginMm;
  const availD = area.maxZ - area.minZ - 2 * marginMm;
  const bottomY = Math.max(FIT_FLOOR_CLEARANCE_MM, aabb.minY);
  const hasHeight = region.heightMm > 0;
  const availH = hasHeight ? region.heightMm - bottomY - marginMm : Infinity;
  if (!(availW > 0 && availD > 0 && availH > 0)) {
    return { status: "impossible", reason: "space" };
  }

  const ratios: number[] = [];
  if (w > DEGENERATE_MM) ratios.push(availW / w);
  if (d > DEGENERATE_MM) ratios.push(availD / d);
  if (hasHeight && h > DEGENERATE_MM) ratios.push(availH / h);
  if (ratios.length === 0) return { status: "impossible", reason: "measure" };
  let k = Math.min(...ratios);

  // 배율 한계 — 더 키울 수 없으면 한계까지만(그래도 영역 안), 최소로도 안 들어가면 포기.
  const kMax = SCALE_MAX / Math.max(...scales);
  const kMin = SCALE_MIN / Math.min(...scales);
  if (k > kMax) k = kMax;
  if (k < kMin) return { status: "impossible", reason: "scale" };
  // 재측정 잡음 수준의 비율은 1 — 이미 최대 크기인 모델은 옮기기만 한다.
  if (Math.abs(k - 1) <= FIT_UNCHANGED_SCALE_EPS) k = 1;

  const cx = (area.minX + area.maxX) / 2;
  const cz = (area.minZ + area.maxZ) / 2;
  // k 배 한 상자의 기준점을 목표로 옮기는 평행이동.
  const dx = cx - (k * (aabb.minX + aabb.maxX)) / 2;
  const dy = bottomY - k * aabb.minY;
  const dz = cz - (k * (aabb.minZ + aabb.maxZ)) / 2;

  const transform: TransformV2 = {
    tx: k * t.tx + dx,
    ty: k * t.ty + dy,
    tz: k * t.tz + dz,
    rx: t.rx,
    ry: t.ry,
    rz: t.rz,
    sx: t.sx * k,
    sy: t.sy * k,
    sz: t.sz * k,
  };
  // 이미 맞춰져 있음 — 연타·재맞춤이 커밋(undo 항목·덴탈 무효화)을 또 만들지 않게.
  if (
    k === 1 &&
    Math.abs(transform.tx - t.tx) <= FIT_UNCHANGED_MOVE_MM &&
    Math.abs(transform.ty - t.ty) <= FIT_UNCHANGED_MOVE_MM &&
    Math.abs(transform.tz - t.tz) <= FIT_UNCHANGED_MOVE_MM
  ) {
    return { status: "unchanged" };
  }
  return {
    status: "fit",
    result: {
      transform,
      scale: k,
      aabb: {
        minX: cx - (k * w) / 2,
        maxX: cx + (k * w) / 2,
        minY: bottomY,
        maxY: bottomY + k * h,
        minZ: cz - (k * d) / 2,
        maxZ: cz + (k * d) / 2,
      },
    },
  };
}

/** planFit 의 결과만 — 맞출 수 없거나 이미 맞춰져 있으면 null(커밋할 것이 없음). */
export function computeFitTransform(
  t: TransformV2,
  aabb: WorldAabbMm,
  region: ModelFitRegion,
  marginMm: number = FIT_MARGIN_MM,
): ModelFitResult | null {
  const plan = planFit(t, aabb, region, marginMm);
  return plan.status === "fit" ? plan.result : null;
}

/** 맞출 수 없을 때의 짧은 안내 (패널이 window.alert 로 띄운다 — 뷰어의 기존 알림 수단). */
export function describeFitFailure(
  reason: FitFailureReason,
  region: ModelFitRegion,
  marginMm: number = FIT_MARGIN_MM,
): string {
  const where = region.task0 ? "Task0 출력 가능 영역" : "출력영역(빌드 크기)";
  const why =
    reason === "space"
      ? `영역이 가장자리 여유(${marginMm} mm)보다 좁거나, 모델 바닥 위로 남은 높이가 없습니다.`
      : reason === "scale"
        ? `최소 배율(${SCALE_PERCENT_MIN} %)로 줄여도 영역에 들어가지 않습니다.`
        : "모델 크기를 읽을 수 없습니다.";
  return `${where}에 맞출 수 없습니다 — ${why}`;
}
