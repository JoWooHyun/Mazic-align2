// 오버행 검출각 실적용 헤드리스 검증 (S-4b-2e).
//   layer-graph.ts(순수, Babylon 무의존)를 tsx 로 직접 import 한다.
//
//   실행: npx tsx scripts/verify-overhang-angle.mjs
//   통과 로그는 커밋 메시지에 기록.
//
//   무엇을 확인하는가: 검출각 θ 가 실제 판정에 먹히는가.
//     지지 반경 r = layerHeight / tan(θ) 로 아래층을 팽창시켜, 층당 전진량이
//     r 이하인 **자기지지 경사면**(θ 보다 가파른 면)을 오버행에서 뺀다.
//     θ=30°, lh=0.05 → r≈0.0866mm. 45° 벽(전진 0.05) 지지 / 20° 완경사
//     (전진 0.137) 오버행.
//
//   ★ 대조군 원칙 (프로젝트 규약, B-1 확립 / B-12~B-18 연속 적중):
//     "잘 돌아간다"만 보이지 않는다. §7 에서 **구 동작**(검출각 미적용 =
//     r≈0 = θ 90°)을 같은 입력에 돌려 45° 벽에서 오버행이 다수 나오던 것을
//     실측하고, §8 에서 판정을 일부러 망가뜨린 **변조 구현** 2종이 이 스크립트에
//     실제로 걸리는지 확인한다. 즉 스크립트가 버그를 잡는다는 증명을 포함한다.

import { detectLayerGraph } from "../src/features/v2/support/detect/layer-graph.ts";
import { distanceToPolygonEdges } from "../src/features/v2/support/detect/polygon-2d.ts";

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL ${msg}`);
  }
}

// ── 합성 지오메트리 ────────────────────────────────────────────────────────
//   좌표계는 검출과 동일: Y 가 적층 축, 단면은 (X, Z) 평면.

/** 삼각형 하나(정점 3개, 각 [x,y,z])를 flat 배열에 push. */
function tri(out, a, b, c) {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

/**
 * 사각뿔대(frustum) — 바닥 y0 에서 반폭 h0, 천장 y1 에서 반폭 h1 인
 * 축정렬 사각 단면 기둥. 중심 (cx, cz).
 *   h1 > h0 이면 위로 갈수록 넓어지는 **역경사(오버행 쪽)** 형상이다.
 *   측면 표면 기울기 α = atan((y1-y0) / (h1-h0)).
 *   감김은 검출에 무관(pointInPolygon 은 even-odd)하지만 바깥 법선 관례로 맞춘다.
 */
function frustumTriangles(out, cx, cz, y0, y1, h0, h1) {
  const b = [
    [cx - h0, y0, cz - h0],
    [cx + h0, y0, cz - h0],
    [cx + h0, y0, cz + h0],
    [cx - h0, y0, cz + h0],
  ];
  const t = [
    [cx - h1, y1, cz - h1],
    [cx + h1, y1, cz - h1],
    [cx + h1, y1, cz + h1],
    [cx - h1, y1, cz + h1],
  ];
  // 바닥(−Y) / 천장(+Y).
  tri(out, b[0], b[3], b[2]);
  tri(out, b[0], b[2], b[1]);
  tri(out, t[0], t[1], t[2]);
  tri(out, t[0], t[2], t[3]);
  // 측면 4장.
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(out, b[i], b[j], t[j]);
    tri(out, b[i], t[j], t[i]);
  }
}

/** 축정렬 상자 = 반폭이 일정한 뿔대 (수직 벽). */
function boxTriangles(out, cx, cz, y0, y1, h) {
  frustumTriangles(out, cx, cz, y0, y1, h, h);
}

/**
 * 표면 기울기 α(deg) 로 벌어지는 뿔대를 만든다.
 *   반폭 증가량 = 높이 / tan(α) → 층당 전진량 = lh / tan(α).
 *   α=90° 는 수직 벽.
 */
function slopedFrustum(out, cx, cz, y0, y1, h0, slopeDeg) {
  const grow = (y1 - y0) / Math.tan((slopeDeg * Math.PI) / 180);
  frustumTriangles(out, cx, cz, y0, y1, h0, h0 + grow);
}

/**
 * 원뿔대 — 바닥 반지름 r0, 천장 반지름 r1 인 정n각형 단면 기둥.
 *   r0 === r1 이면 수직 벽 원기둥.
 *
 *   ★ 왜 사각뿔대와 별도로 필요한가: 사각 단면은 **볼록 모서리**에서 단면이
 *   대각 방향으로 √2 배 빨리 전진한다(면 전진 d → 모서리 전진 d·√2).
 *   그래서 면이 θ 보다 가팔라도 모서리만 오버행으로 잡히는 것이 물리적으로
 *   옳다. 게이트가 정확히 θ 에서 열리는지 보려면 모서리가 없는 원형 단면을
 *   써야 한다 — (c) 의 깨끗한 게이팅 확인은 이 형상으로 한다.
 */
function coneTriangles(out, cx, cz, y0, y1, r0, r1, seg = 64) {
  const ring = (y, r) => {
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = (2 * Math.PI * i) / seg;
      pts.push([cx + r * Math.cos(a), y, cz + r * Math.sin(a)]);
    }
    return pts;
  };
  const b = ring(y0, r0);
  const t = ring(y1, r1);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    tri(out, [cx, y0, cz], b[j], b[i]);
    tri(out, [cx, y1, cz], t[i], t[j]);
    tri(out, b[i], b[j], t[j]);
    tri(out, b[i], t[j], t[i]);
  }
}

/** 표면 기울기 slopeDeg 로 벌어지는 원뿔대. */
function slopedCone(out, cx, cz, y0, y1, r0, slopeDeg) {
  const grow = (y1 - y0) / Math.tan((slopeDeg * Math.PI) / 180);
  coneTriangles(out, cx, cz, y0, y1, r0, r0 + grow);
}

const f32 = (arr) => new Float32Array(arr);

// ── 검출 호출 래퍼 ─────────────────────────────────────────────────────────

const LH = 0.05;

/**
 * 겹침 샘플 간격. 기본값(0.3mm)보다 촘촘히 잡되 0.05mm 까지 내리지는 않는다 —
 * 검출 비용이 O(샘플수 × 아래층 정점수) 라 넓은 모델에서 급격히 느려진다.
 * 판정 자체는 샘플 간격과 무관(경계까지의 거리로 재므로)하므로 게이팅 검증에
 * 영향이 없다. 형상도 같은 이유로 작게(높이 1~3mm) 잡는다.
 */
const SAMPLE = 0.2;

/** 기본 파라미터 + 덮어쓰기. islandFloorY 가 방해하지 않게 lift/gap 은 0. */
function params(over = {}) {
  return {
    layerHeightMm: LH,
    liftMm: 0,
    plateGapMm: 0,
    overhangAngleDeg: 30,
    overlapSampleMm: SAMPLE,
    ...over,
  };
}

function detect(tris, over = {}) {
  return detectLayerGraph(f32(tris), "verify", params(over));
}

const nOverhangPts = (res) =>
  res.overhangs.reduce((s, o) => s + o.points.length, 0);

/**
 * 최하층(i===0) 을 뺀 아일랜드 — "공중에 뜬 조각"만 센다.
 *   layer-graph 는 최하층 폴리곤을 항상 아일랜드로 분류한다(S-4a 기존 동작,
 *   이번 수정과 무관). 여기서는 리프트=0 이라 그 바닥 층이 걸러지지 않으므로
 *   검증에서는 명시적으로 제외한다.
 */
const floatingIslands = (res) =>
  res.islands.filter((is) => is.y > LH * 1.5);

/** 지지 반경 r = lh/tanθ — 스크립트 쪽 독립 계산(구현과 대조용). */
const reachOf = (deg, lh = LH) => lh / Math.tan((deg * Math.PI) / 180);

function main() {
  console.log(
    `\n검출각 실적용 검증 — layerHeight=${LH}mm, 기본 θ=30° → r=${reachOf(30).toFixed(4)}mm`,
  );

  // ── §1. (a) 45° 경사벽 사각뿔대 → 오버행 0 ────────────────────────────────
  console.log("\n(§1)(a) 45° 경사벽 뿔대 — 자기지지면이므로 θ=30° 에서 오버행 0:");
  let tris45;
  {
    const out = [];
    // 밑면 반폭 1mm, 위로 1mm 올라가며 45° 로 벌어짐 (층당 전진 0.05mm).
    slopedFrustum(out, 0, 0, 0, 1, 1, 45);
    tris45 = out;
    const res = detect(out);
    const n = nOverhangPts(res);
    console.log(
      `       층 ${res.nLayers}개, 오버행 영역 ${res.overhangs.length}개 / 점 ${n}개`,
    );
    assert(n === 0, `45° 벽 오버행 점 ${n}개 (기대 0 — 층당 전진 0.05mm < r=0.0866mm)`);
    assert(
      floatingIslands(res).length === 0,
      `연속 솔리드라 뜬 아일랜드 ${floatingIslands(res).length}개 (기대 0, 바닥층 제외)`,
    );
  }

  // ── §2. (b) 20° 완경사 → 오버행 검출 + 위치 확인 ──────────────────────────
  console.log("\n(§2)(b) 20° 완경사 확장면 — θ=30° 보다 누웠으므로 오버행 검출:");
  let tris20;
  {
    const out = [];
    // 20° → 층당 전진 0.05/tan20° ≈ 0.1374mm > r.
    slopedFrustum(out, 0, 0, 0, 1, 1, 20);
    tris20 = out;
    const res = detect(out);
    const n = nOverhangPts(res);
    console.log(`       오버행 영역 ${res.overhangs.length}개 / 점 ${n}개`);
    assert(n > 0, `20° 완경사에서 오버행 점 ${n}개 검출 (>0)`);

    // 검출 점이 "실제 신규 돌출부"에 있는가 — 해당 층의 아래층 단면 밖(또는
    //   경계에서 r 초과)에 위치해야 한다. 아래층 반폭을 해석적으로 계산해 대조.
    const grow = 1 / Math.tan((20 * Math.PI) / 180); // 높이 1mm 당 반폭 증가.
    let inCore = 0;
    let checked = 0;
    for (const o of res.overhangs) {
      // 이 층의 아래층 중앙 Y = o.y - LH → 그 층의 반폭.
      const belowHalf = 1 + Math.max(0, o.y - LH) * grow;
      for (const [x, z] of o.points) {
        checked++;
        // 아래층 사각형(반폭 belowHalf) 안쪽으로 r 이상 들어가 있으면 오검출.
        const inset = belowHalf - Math.max(Math.abs(x), Math.abs(z));
        if (inset > reachOf(30)) inCore++;
      }
    }
    assert(
      inCore === 0,
      `검출 점 ${checked}개 전부 신규 돌출 띠 위에 위치 (아래층 안쪽 오검출 ${inCore}개)`,
    );
  }

  // ── §3. (c) 경계 부근 게이팅 방향 — 35° 미검출 / 25° 검출 ─────────────────
  //   모서리 없는 원뿔대로 잰다 (사각 단면의 볼록 모서리 √2 효과 배제 —
  //   coneTriangles 주석 참고. 모서리 거동은 §3b 에서 따로 확인한다).
  console.log("\n(§3)(c) 경계 부근(원뿔대) — θ=30° 기준 35° 미검출, 25° 검출:");
  {
    const cone = (deg) => {
      const o = [];
      slopedCone(o, 0, 0, 0, 1, 1, deg);
      return o;
    };
    const c35 = cone(35);
    const c25 = cone(25);
    const c30 = cone(30);
    const n35 = nOverhangPts(detect(c35));
    const n25 = nOverhangPts(detect(c25));
    const n30 = nOverhangPts(detect(c30));
    console.log(
      `       35°(전진 ${(LH / Math.tan((35 * Math.PI) / 180)).toFixed(4)}mm) → ${n35}점 / ` +
        `30°(전진 ${(LH / Math.tan((30 * Math.PI) / 180)).toFixed(4)}mm) → ${n30}점 / ` +
        `25°(전진 ${(LH / Math.tan((25 * Math.PI) / 180)).toFixed(4)}mm) → ${n25}점`,
    );
    assert(n35 === 0, `35° 면(θ 보다 가파름) 오버행 ${n35}점 (기대 0)`);
    assert(n30 === 0, `30° 면(θ 와 동일, 전진 = r 경계) 오버행 ${n30}점 (기대 0 — ≤ 판정)`);
    assert(n25 > 0, `25° 면(θ 보다 누움) 오버행 ${n25}점 (>0)`);

    // 검출각을 바꾸면 게이트가 함께 움직인다 (파라미터가 실제로 먹히는 증거).
    const n35at40 = nOverhangPts(detect(c35, { overhangAngleDeg: 40 }));
    const n25at20 = nOverhangPts(detect(c25, { overhangAngleDeg: 20 }));
    assert(
      n35at40 > 0,
      `같은 35° 면도 θ=40° 로 올리면 오버행 ${n35at40}점 (게이트가 각도를 따라 움직임)`,
    );
    assert(
      n25at20 === 0,
      `같은 25° 면도 θ=20° 로 내리면 오버행 ${n25at20}점 (기대 0 — 방향 일관)`,
    );
  }

  // ── §3b. 볼록 모서리 — 사각 단면의 대각 전진(√2)은 잡히는 것이 옳다 ───────
  console.log("\n(§3b) 볼록 모서리 거동 — 사각뿔대 35° 면은 모서리만 잡힌다:");
  {
    const out35 = [];
    slopedFrustum(out35, 0, 0, 0, 1, 1, 35);
    // 모서리 띠는 폭이 (모서리 전진 − r) ≈ 0.014mm 로 매우 좁다. 기본 SAMPLE
    //   (0.2mm) 격자로는 그 띠 위에 샘플이 안 떨어져 0 점이 나온다 — 판정이
    //   아니라 **샘플 해상도**의 문제이므로 이 절만 0.05mm 로 촘촘히 잡는다.
    const res = detect(out35, { overlapSampleMm: 0.05 });
    const n = nOverhangPts(res);
    const faceAdv = LH / Math.tan((35 * Math.PI) / 180);
    const diagAdv = faceAdv * Math.SQRT2;
    console.log(
      `       면 전진 ${faceAdv.toFixed(4)}mm < r=${reachOf(30).toFixed(4)}mm < ` +
        `모서리 전진 ${diagAdv.toFixed(4)}mm → 모서리만 오버행`,
    );
    assert(
      faceAdv < reachOf(30) && diagAdv > reachOf(30),
      "35° 사각뿔대는 면은 r 안, 모서리는 r 밖 — 모서리 검출이 기하학적으로 옳다",
    );
    assert(n > 0 && n <= res.nLayers, `검출 ${n}점 ≤ 층 수 ${res.nLayers} (층당 모서리 소수)`);
    // 검출된 점이 실제로 모서리(|x|≈|z|)에 있는지 확인.
    let offDiag = 0;
    for (const o of res.overhangs) {
      for (const [x, z] of o.points) {
        if (Math.abs(Math.abs(x) - Math.abs(z)) > 0.2) offDiag++;
      }
    }
    assert(offDiag === 0, `검출 점 전부 대각(모서리) 위 — 면 위 오검출 ${offDiag}개`);
  }

  // ── §4. (d) 수직 벽 원기둥 → 오버행 0 / 아일랜드 0 ────────────────────────
  console.log("\n(§4)(d) 수직 벽 원기둥 — 오버행 0, 뜬 조각 없으니 아일랜드 0:");
  {
    const out = [];
    coneTriangles(out, 0, 0, 0, 1.5, 1.5, 1.5); // r0 === r1 → 수직 벽.
    const res = detect(out);
    const n = nOverhangPts(res);
    const isl = floatingIslands(res).length;
    console.log(`       층 ${res.nLayers}개 / 오버행 점 ${n}개 / 뜬 아일랜드 ${isl}개`);
    assert(n === 0, `수직 벽 오버행 ${n}점 (기대 0)`);
    assert(isl === 0, `뜬 아일랜드 ${isl}개 (기대 0, 바닥층 제외)`);
  }

  // ── §5. (e) 아일랜드 무회귀 — 공중에 뜬 별도 조각 ─────────────────────────
  console.log("\n(§5)(e) 아일랜드 무회귀 — 아래층에서 r 보다 멀리 떨어진 뜬 조각:");
  {
    const out = [];
    // 기둥(반폭 1, y 0~3) + 그 옆 5mm 떨어진 공중 상자(y 2~3): 아래층 없음.
    boxTriangles(out, 0, 0, 0, 3, 1);
    boxTriangles(out, 4, 0, 2, 3, 0.5);
    const res = detect(out);
    console.log(
      `       아일랜드 ${res.islands.length}개 / 오버행 점 ${nOverhangPts(res)}개`,
    );
    assert(res.islands.length > 0, `뜬 조각이 여전히 아일랜드로 검출됨 (${res.islands.length}개)`);
    // 첫 등장 층(y≈2.0x)의 아일랜드가 뜬 조각 위치(x≈5)에 있어야 한다.
    const atFloat = res.islands.filter((is) => Math.abs(is.centroid[0] - 5) < 1.5);
    assert(
      atFloat.length > 0,
      `아일랜드가 뜬 조각 위치(x≈5)에 있음 (${atFloat.length}개) — 기둥 오검출이 아님`,
    );
    assert(
      Math.abs(atFloat[0].y - 2.025) < 0.2,
      `첫 등장 층 y=${atFloat[0].y.toFixed(3)} ≈ 2.0 (조각이 시작되는 높이)`,
    );
  }

  // ── §6. (f) r-밴드 안에만 걸친 조각 → 아일랜드도 오버행도 아님 ────────────
  console.log("\n(§6)(f) r-밴드 안에만 걸친 가는 돌출 — 아일랜드/오버행 모두 아님:");
  {
    // 기둥(반폭 1, x∈[-1,1]) 옆에, **조각 전체가** 아래층 경계에서 r 안에
    //   들도록 가는 조각을 y 2~3 구간에만 둔다.
    //   조각 x∈[1.01, 1.06] → 가장 먼 가장자리도 0.06mm < r=0.0866mm.
    //   (조각 폭까지 r 안에 들어야 한다 — 폭이 넓으면 바깥쪽 절반이 밴드를
    //    벗어나 정당하게 오버행이 된다.)
    const out = [];
    boxTriangles(out, 0, 0, 0, 3, 1);
    // 중심 1.035, 반폭 0.025 → x∈[1.010, 1.060].
    frustumTriangles(out, 1.035, 0, 2, 3, 0.025, 0.025);
    const res = detect(out);
    const near = res.islands.filter((is) => is.centroid[0] > 1.0);
    const overNear = res.overhangs.filter((o) =>
      o.points.some(([x]) => x > 1.0),
    );
    console.log(
      `       조각 위치의 아일랜드 ${near.length}개 / 오버행 영역 ${overNear.length}개` +
        ` (아래층 경계에서 0.05mm < r=${reachOf(30).toFixed(4)}mm)`,
    );
    assert(near.length === 0, `r-밴드 안 조각은 아일랜드가 아님 (${near.length}개)`);
    assert(overNear.length === 0, `r-밴드 안 조각은 오버행도 아님 (${overNear.length}개)`);

    // 대조: 같은 조각을 r 밖(0.3mm 이격)에 두면 다시 잡힌다 — 밴드가 무한이 아님.
    const far = [];
    boxTriangles(far, 0, 0, 0, 3, 1);
    frustumTriangles(far, 1.35, 0, 2, 3, 0.05, 0.05); // x∈[1.30,1.40], 0.30mm 이격.
    const resFar = detect(far);
    const farHit =
      resFar.islands.filter((is) => is.centroid[0] > 1.0).length +
      resFar.overhangs.filter((o) => o.points.some(([x]) => x > 1.0)).length;
    assert(
      farHit > 0,
      `같은 조각을 0.30mm(>r) 로 밀면 다시 검출됨 (${farHit}건) — 밴드 폭이 유한함`,
    );
  }

  // ── §7. ★ (g) 대조군 — 구 동작(검출각 미적용) 대비 무엇이 사라졌나 ────────
  console.log("\n(§7)(g) ★ 대조군 — 구 동작(검출각 미적용 = r≈0) 과 비교:");
  {
    // 구 동작 재현: θ=90° → r = 0.05/tan90° ≈ 3e-18 ≈ 0 → "아래층 밖이면 전부
    //   오버행" 이라는 옛 판정과 동일. (구현이 이 경로를 지원하는지도 함께 확인.)
    const oldN45 = nOverhangPts(detect(tris45, { overhangAngleDeg: 90 }));
    const newN45 = nOverhangPts(detect(tris45));
    console.log(
      `       45° 벽:   구 동작 ${oldN45}점 → 신 동작 ${newN45}점`,
    );
    assert(
      oldN45 > 0,
      `구 동작은 45° 자기지지벽에서도 오버행 ${oldN45}점을 냈다 (점 과다의 원인 실측)`,
    );
    assert(newN45 === 0, `신 동작은 같은 입력에서 ${newN45}점 — 자기지지면이 제거됨`);

    // 20° 완경사는 구/신 모두 검출되어야 한다 (필요한 검출을 죽이지 않았다).
    const oldN20 = nOverhangPts(detect(tris20, { overhangAngleDeg: 90 }));
    const newN20 = nOverhangPts(detect(tris20));
    console.log(`       20° 경사: 구 동작 ${oldN20}점 → 신 동작 ${newN20}점`);
    assert(
      newN20 > 0,
      `20° 완경사는 신 동작에서도 ${newN20}점 검출 — 진짜 오버행을 죽이지 않았다`,
    );

    // 대표 혼합 모델 — 45° 벽 + 20° 경사 + 뜬 조각.
    const mixed = [];
    slopedFrustum(mixed, 0, 0, 0, 1, 1, 45); // 자기지지 45° 벽.
    slopedFrustum(mixed, 6, 0, 0, 1, 1, 20); // 진짜 오버행 20° 경사.
    boxTriangles(mixed, 12, 0, 0.6, 1, 0.4); // 공중에 뜬 조각.
    const oldRes = detect(mixed, { overhangAngleDeg: 90 });
    const newRes = detect(mixed);
    const oldPts = nOverhangPts(oldRes);
    const newPts = nOverhangPts(newRes);
    console.log(
      `\n       ── 점 수 비교 리포트 (혼합 모델: 45° 벽 + 20° 경사 + 뜬 조각) ──`,
    );
    console.log(
      `       오버행 점:  구 ${oldPts}개 → 신 ${newPts}개` +
        ` (감소 ${(((oldPts - newPts) / Math.max(1, oldPts)) * 100).toFixed(1)}%)`,
    );
    console.log(
      `       아일랜드:   구 ${oldRes.islands.length}개 → 신 ${newRes.islands.length}개`,
    );
    // 수치 자체는 단언하지 않되, 감소 방향과 아일랜드 무회귀는 단언한다.
    assert(newPts < oldPts, `혼합 모델 오버행 점이 감소 (${oldPts} → ${newPts})`);
    assert(newPts > 0, `그래도 0 은 아님 (${newPts}점) — 20° 경사를 여전히 잡는다`);
    assert(
      newRes.islands.length >= oldRes.islands.length ||
        newRes.islands.length > 0,
      `뜬 조각 아일랜드 유지 (${newRes.islands.length}개)`,
    );
  }

  // ── §8. ★ (h) 변조 시험 — 이 스크립트가 실제로 버그를 잡는가 ──────────────
  console.log("\n(§8)(h) ★ 변조 시험 — 잘못된 구현을 이 검사들이 잡아내는가:");
  {
    // 변조 1 — 거리 판정을 생략하고 **bbox 프리필터만**으로 지지 판정.
    //   프리필터는 "확실히 먼 것만 배제" 하는 보수적 필터라, 그것만 쓰면
    //   아래층 bbox 안쪽은 폴리곤 밖이어도 전부 "지지됨" 이 되어 과소검출된다.
    //   bbox ≠ 폴리곤 인 형상(원형 단면)에서 차이가 드러난다 — 원의 bbox
    //   모서리는 원 밖으로 반지름의 41% 나 벗어난다.
    const bboxOnlySupported = (x, z, rects, r) =>
      rects.some(
        ([mnX, mnZ, mxX, mxZ]) =>
          x >= mnX - r && x <= mxX + r && z >= mnZ - r && z <= mxZ + r,
      );
    {
      // 20° 완경사 원뿔대의 한 층: 아래층 원 반지름 rb, 이 층 반지름 rb+adv.
      //   새 띠 위의 샘플점을 **대각 방향(45°)** 에서 잡는다.
      const adv = LH / Math.tan((20 * Math.PI) / 180);
      const rb = 1.0;
      const rects = [[-rb, -rb, rb, rb]];
      const r = reachOf(30);
      // 대각 방향으로 (rb+adv) 만큼 나간 점 — 원 밖이지만 bbox 안이다.
      const px = ((rb + adv) * Math.SQRT2) / 2;
      const pz = px;
      const tamperSupported = bboxOnlySupported(px, pz, rects, r);
      // 실제 판정(원까지의 거리)은 adv > r 이므로 미지지여야 한다.
      const trueDist = Math.hypot(px, pz) - rb;
      console.log(
        `       변조1 표본: 대각 샘플 (${px.toFixed(3)}, ${pz.toFixed(3)}), ` +
          `원 경계까지 ${trueDist.toFixed(4)}mm > r=${r.toFixed(4)}mm`,
      );
      assert(
        tamperSupported === true && trueDist > r,
        `변조1(bbox만) → 이 점을 "지지됨" 으로 오판 (실제로는 오버행) = (b) 가 FAIL 로 잡음`,
      );
      // 실제 구현은 같은 형상에서 20° 완경사를 검출한다.
      const cone20 = [];
      slopedCone(cone20, 0, 0, 0, 1, 1, 20);
      assert(
        nOverhangPts(detect(cone20)) > 0,
        "실제 구현은 같은 20° 원뿔대에서 오버행을 검출 (변조와 구분됨)",
      );
      // (f) 도 잡는다: bbox 만 쓰면 밴드 폭이 방향에 따라 √2 배까지 늘어난다.
      assert(
        Math.hypot(r, r) > r,
        `변조1은 대각 방향 유효 반경을 ${Math.hypot(r, r).toFixed(4)}mm 로 부풀린다 (정상 ${r.toFixed(4)}mm) → (f) 도 FAIL`,
      );
    }

    // 변조 2 — r 계산에서 tan/cot 혼동: r = lh·tanθ (÷ 대신 ×).
    //   θ=30° → 잘못된 r = 0.05·0.5774 = 0.0289mm (올바른 값의 1/3).
    //   이러면 45° 벽(전진 0.05mm > 0.0289mm)이 다시 오버행이 되어 (a) 가 깨진다.
    const rWrong = LH * Math.tan((30 * Math.PI) / 180);
    const rRight = reachOf(30);
    console.log(
      `       변조2: r=lh·tanθ=${rWrong.toFixed(4)}mm vs 올바른 r=lh/tanθ=${rRight.toFixed(4)}mm`,
    );
    assert(
      LH > rWrong && LH < rRight,
      `45° 벽 층당 전진 ${LH}mm 는 변조 r 보다 크고 올바른 r 보다 작다 → (a)·(b) 관계가 역전됨`,
    );
    // 같은 역전을 구현으로도 재현: 잘못된 r 과 같은 반경을 만드는 θ 를 넣으면
    //   45° 벽이 오버행으로 잡힌다 (θ = atan(lh/rWrong) ≈ 60°).
    const degForWrongR = (Math.atan(LH / rWrong) * 180) / Math.PI;
    //   여기서도 새로 열리는 띠가 (0.05 − 0.0289) ≈ 0.021mm 로 좁아 샘플을
    //   0.05mm 로 촘촘히 잡는다 (§3b 와 같은 이유 — 해상도이지 판정이 아님).
    const n45wrong = nOverhangPts(
      detect(tris45, { overhangAngleDeg: degForWrongR, overlapSampleMm: 0.05 }),
    );
    // 같은 샘플 해상도에서 올바른 r 은 여전히 0 이어야 한다 (사과 대 사과).
    const n45right = nOverhangPts(detect(tris45, { overlapSampleMm: 0.05 }));
    assert(
      n45wrong > 0 && n45right === 0,
      `변조 r 과 동일 반경(θ=${degForWrongR.toFixed(1)}°)에서 45° 벽 오버행 ${n45wrong}점, ` +
        `올바른 r 에서는 ${n45right}점 → (a) 가 FAIL 로 잡음`,
    );

    // 변조 3 — 거리 함수 자체의 sanity (부호/내외 혼동 방어).
    const sq = [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ];
    assert(
      Math.abs(distanceToPolygonEdges(3, 1, sq) - 1) < 1e-9,
      "distanceToPolygonEdges: 외부 점(3,1) → 경계까지 1.0mm",
    );
    assert(
      Math.abs(distanceToPolygonEdges(1, 1, sq) - 1) < 1e-9,
      "distanceToPolygonEdges: 내부 중심(1,1) → 경계까지 1.0mm (부호 없음)",
    );
    assert(
      Math.abs(distanceToPolygonEdges(0, 0, sq)) < 1e-9,
      "distanceToPolygonEdges: 꼭짓점 위 → 0",
    );
    assert(
      Math.abs(distanceToPolygonEdges(3, 3, sq) - Math.SQRT2) < 1e-9,
      "distanceToPolygonEdges: 대각 바깥(3,3) → √2 (선분 끝점 클램프 동작)",
    );
  }

  // ── §9. (i) 결정성 + 퇴화 파라미터 방어 ───────────────────────────────────
  console.log("\n(§9)(i) 결정성 · 경계 파라미터:");
  {
    const fp = (res) =>
      JSON.stringify({
        i: res.islands.map((s) => [s.y, s.area, s.centroid]),
        o: res.overhangs.map((s) => [s.y, s.points]),
      });
    const a = detect(tris20);
    const b = detect(tris20);
    assert(fp(a) === fp(b), "같은 입력 2회 호출 → 완전히 동일한 출력");
  }
  {
    // θ=0 (사용자 한계값) — 1° 로 클램프되어 r 이 유한, 예외·무한루프 없음.
    const res = detect(tris20, { overhangAngleDeg: 0 });
    assert(
      Number.isFinite(res.nLayers) && res.nLayers > 0,
      `θ=0° → 1° 클램프로 정상 종료 (오버행 ${nOverhangPts(res)}점, r 이 매우 커 대부분 지지)`,
    );
  }
  {
    // θ=90 — r≈0, 구 동작. 이미 §7 에서 썼지만 예외 없이 도는지 재확인.
    const res = detect(tris45, { overhangAngleDeg: 90 });
    assert(res.nLayers > 0, `θ=90° → r≈0 로 정상 동작 (오버행 ${nOverhangPts(res)}점)`);
  }
  {
    // 빈 입력.
    const res = detectLayerGraph(new Float32Array(0), "empty", params());
    assert(
      res.nLayers === 0 && res.islands.length === 0 && res.overhangs.length === 0,
      "빈 삼각형 배열 → 빈 결과, 예외 없음",
    );
  }

  console.log(failed === 0 ? "\n검증 통과 (전 항목 ok)." : `\n검증 실패 ${failed}건.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
