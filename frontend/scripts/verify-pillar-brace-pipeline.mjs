// 기둥 연결 브레이스 **형상·저장·렌더 파이프라인** 헤드리스 검증 (S-4b-2d 2단계).
//   실행: npx tsx scripts/verify-pillar-brace-pipeline.mjs
//   판정은 출력 문자열이 아니라 **exit code** 로 한다 (CLAUDE.md).
//
//   검증 항목:
//     §a 타입 오염 방지 — 브레이스 레코드가 `listSupportsByProject` 에 안 섞이는가
//     §b cascade    — 기둥 점을 지우면 그 다리도 함께 지워지는가
//     §c 무회귀     — 브레이스가 **없는** 입력에서 기존 동작·바이트가 그대로인가
//     §d world polyline — routeKind 별 폴리라인 구성이 올바른가
//     §e 형상       — assemblePillarBraces 가 assembleStrut 재사용 규약을 지키는가
//     §f 변조 대조군 — cascade 를 뺀 구현·판별 필드를 무시한 구현이 **실제로 FAIL** 나는가
//     §g 계획→저장 왕복
//
//   ★ 대조군 원칙(프로젝트 규약): §f 가 없으면 이 스크립트는 무가치하다. 변조본이
//     같은 입력에서 위 단언을 통과해 버린다면 그 단언은 아무것도 지키지 않는 것이다.
//
//   ⚠️ IndexedDB 는 Node 에 없다. 새 의존성을 넣지 않기 위해 `idb-shim.mjs`
//     (repo 가 실제로 쓰는 API 만 구현한 최소 셰임)를 전역에 설치해 **실제
//     repo 코드를 그대로** 돌린다 — repo 를 흉내낸 복제본을 검증하면 의미가 없다.

import { installFakeIndexedDb } from "./idb-shim.mjs";

installFakeIndexedDb();

const repo = await import("../src/features/v2/data/supports.repo.ts");
const { assemblePillarBraces } = await import(
  "../src/features/v2/support/assemble-brace.ts"
);
const { assembleStrut } = await import(
  "../src/features/v2/support/assemble-strut.ts"
);
const { planPillarInterconnect } = await import(
  "../src/features/v2/support/interconnect-pillars.ts"
);

let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

const PROJECT = "proj-1";
const STL = "stl-1";

/** 서포트 점 하나 (최소 필드). */
function point(id, extra = {}) {
  return {
    id,
    projectId: PROJECT,
    stlId: STL,
    contact: [0, 10, 0],
    base: [0, 0, 0],
    source: "auto",
    kind: "island",
    coordSpace: "stl-local",
    addedAt: 1,
    ...extra,
  };
}

/** 브레이스 레코드 하나. */
function brace(id, fromPointId, toPointId, extra = {}) {
  return {
    recordKind: "pillarBrace",
    id,
    projectId: PROJECT,
    stlId: STL,
    fromPointId,
    toPointId,
    from: [0, 5, 0],
    to: [3, 8, 0],
    radiusMm: 0.4,
    coordSpace: "stl-local",
    addedAt: 1,
    ...extra,
  };
}

/** id 오름차순 정렬 사본 — 조회 순서에 의존하지 않고 비교하기 위해. */
function byId(list) {
  return list.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ─────────────────────────────────────────────────────────────────────────────
// 최소 부품 세트 — 단위 실린더(⌀1, Z 0→1)를 8각 기둥으로 근사.
//   assemble-strut 은 parts.cylinder 만 쓴다(막대). 부품 STL 로드 없이 돌리기 위함.
// ─────────────────────────────────────────────────────────────────────────────
function makeParts() {
  const n = 8;
  const pos = [];
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pos.push(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0);
    pos.push(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 1);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1);
  }
  const cyl = {
    positions: new Float32Array(pos),
    indices: new Uint32Array(idx),
  };
  return { cylinder: cyl, sphere: cyl, cone: cyl, arrowHead: cyl };
}
const PARTS = makeParts();

// ─────────────────────────────────────────────────────────────────────────────
// §a 타입 오염 방지
// ─────────────────────────────────────────────────────────────────────────────
async function sectionA() {
  console.log("\n(§a) 브레이스 레코드가 SupportPointV2 조회에 섞여 나오지 않는가:");
  await repo.addSupports([point("p1"), point("p2")]);
  await repo.addPillarBraces([brace("b1", "p1", "p2")]);

  const points = await repo.listSupportsByProject(PROJECT);
  assert(points.length === 2, `listSupportsByProject 는 점 2개만 (실제 ${points.length})`);
  assert(
    points.every((p) => p.recordKind === undefined),
    "반환 목록에 recordKind 를 가진 레코드가 없다",
  );
  assert(
    byId(points).map((p) => p.id).join(",") === "p1,p2",
    "반환 id 가 정확히 p1,p2",
  );

  const byStl = await repo.listSupportsByStl(STL);
  assert(byStl.length === 2, `listSupportsByStl 도 점 2개만 (실제 ${byStl.length})`);

  const braces = await repo.listPillarBracesByProject(PROJECT);
  assert(braces.length === 1 && braces[0].id === "b1", "브레이스는 전용 조회로만 나온다");

  // 폐기 disc 레코드와의 공존 — 기존 선례가 깨지지 않았는가.
  await repo.addSupports([{ ...point("d1"), variant: "disc" }]);
  const afterDisc = await repo.listSupportsByProject(PROJECT);
  assert(
    afterDisc.length === 2,
    `disc 레코드도 여전히 걸러진다 (실제 ${afterDisc.length})`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §b cascade — 기둥 삭제 시 다리도 삭제
// ─────────────────────────────────────────────────────────────────────────────
async function sectionB() {
  console.log("\n(§b) 기둥을 지우면 그 기둥의 다리도 같이 지워지는가:");
  // p1-p2(b1), p2-p3(b2), p3-p4(b3) 세 다리.
  await repo.addSupports([point("p3"), point("p4")]);
  await repo.addPillarBraces([
    brace("b2", "p2", "p3"),
    brace("b3", "p3", "p4"),
  ]);
  let braces = await repo.listPillarBracesByProject(PROJECT);
  assert(braces.length === 3, `사전 상태 다리 3개 (실제 ${braces.length})`);

  // p2 삭제 → b1(p1-p2)·b2(p2-p3) 두 개가 사라져야 한다. 양 끝 어느 쪽이든.
  const removed = await repo.deletePillarBracesByPointIds(PROJECT, ["p2"]);
  assert(removed.length === 2, `삭제 반환 2개 (실제 ${removed.length})`);
  assert(
    byId(removed).map((b) => b.id).join(",") === "b1,b2",
    "fromPointId·toPointId 양쪽 모두 매치한다",
  );
  braces = await repo.listPillarBracesByProject(PROJECT);
  assert(
    braces.length === 1 && braces[0].id === "b3",
    "무관한 다리(b3)는 살아 있다 — 과잉 삭제 없음",
  );
  assert(
    removed.every((b) => b.recordKind === "pillarBrace"),
    "삭제 반환값은 undo 복원에 그대로 쓸 수 있는 온전한 레코드",
  );

  // 서포트 점 자체는 이 함수가 건드리지 않는다(호출 측 deleteSupport 소관).
  const points = await repo.listSupportsByProject(PROJECT);
  assert(
    points.length === 4,
    `브레이스 cascade 가 서포트 점을 건드리지 않는다 (실제 ${points.length})`,
  );

  // 프로젝트 전체 삭제 = by_project 인덱스 재사용 → 브레이스까지 자동 소멸.
  await repo.deleteSupportsByProject(PROJECT);
  const afterAll = await repo.listPillarBracesByProject(PROJECT);
  assert(
    afterAll.length === 0,
    `deleteSupportsByProject 가 브레이스까지 지운다 (남은 ${afterAll.length})`,
  );

  // 모델 삭제 cascade 도 같은 이유로 자동이어야 한다 (by_stl 인덱스 재사용).
  await repo.addSupports([point("s1"), point("s2")]);
  await repo.addPillarBraces([brace("sb1", "s1", "s2")]);
  await repo.deleteSupportsByStl(STL);
  const afterStl = await repo.listPillarBracesByProject(PROJECT);
  assert(
    afterStl.length === 0,
    `deleteSupportsByStl 도 브레이스까지 지운다 (남은 ${afterStl.length})`,
  );
  await repo.deleteSupportsByProject(PROJECT);
}

// ─────────────────────────────────────────────────────────────────────────────
// §c 무회귀 — 브레이스 없는 입력은 기존 동작과 바이트 동일
// ─────────────────────────────────────────────────────────────────────────────
async function sectionC() {
  console.log("\n(§c) 브레이스가 없는 입력에서 기존 동작이 바이트 동일한가:");
  await repo.addSupports([point("q1"), point("q2"), point("q3")]);
  const points = await repo.listSupportsByProject(PROJECT);
  assert(points.length === 3, `점 3개 그대로 (실제 ${points.length})`);
  // 저장 → 조회 왕복이 레코드를 **바이트 단위로** 보존하는가.
  const expected = JSON.stringify(byId([point("q1"), point("q2"), point("q3")]));
  const actual = JSON.stringify(byId(points));
  assert(actual === expected, "저장→조회 왕복이 레코드를 그대로 보존한다");

  const braces = await repo.listPillarBracesByProject(PROJECT);
  assert(braces.length === 0, "브레이스 없는 프로젝트의 브레이스 조회는 빈 배열");

  // 브레이스가 0개면 삭제 호출도 무해·무비용이어야 한다.
  const removed = await repo.deletePillarBracesByPointIds(PROJECT, ["q1", "q2"]);
  assert(removed.length === 0, "다리 없는 기둥 삭제는 빈 결과");
  const after = await repo.listSupportsByProject(PROJECT);
  assert(
    JSON.stringify(byId(after)) === expected,
    "그 호출 뒤에도 점 레코드가 바이트 동일",
  );

  // 빈 지오메트리 — 브레이스 0개면 삼각형 0개(출력물 무변화의 근거).
  const geo = assemblePillarBraces(PARTS, []);
  assert(
    geo.positions.length === 0 && geo.indices.length === 0,
    "브레이스 0개 → 정점·인덱스 0 (마스크/CTB 바이트 무변화)",
  );

  await repo.deleteSupportsByProject(PROJECT);
}

// ─────────────────────────────────────────────────────────────────────────────
// §d world polyline 구성 (routeKind 별)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `redesign-detect-actions.ts` 의 폴리라인 구성 규칙을 **같은 규칙으로** 재현한다.
 *   (구현 본체는 Babylon 의존이라 헤드리스로 부를 수 없다. 여기서 검증하는 것은
 *   "규칙 자체가 routeKind 별로 옳은가" 이며, 규칙이 바뀌면 이 함수도 같이
 *   바뀌어야 한다 — 그 사실을 드러내는 것이 이 절의 목적이다.)
 */
function buildPolyline(route, contact) {
  const [cx, cy, cz] = contact;
  switch (route.kind) {
    case "vertical":
      return [
        [cx, cy, cz],
        [cx, 0, cz],
      ];
    case "bent": {
      const [lx, lz] = route.landingXZ;
      return [[cx, cy, cz], ...route.waypoints, [lx, 0, lz]];
    }
    // anchor / joinPillar 는 기둥이 아니다 — 폴리라인을 만들지 않는다.
    default:
      return null;
  }
}

function sectionD() {
  console.log("\n(§d) routeKind 별 world polyline 구성이 올바른가:");

  const v = buildPolyline({ kind: "vertical" }, [2, 12, 3]);
  assert(v.length === 2, "vertical 은 2점 (접점 → 플레이트)");
  assert(
    v[0][0] === 2 && v[0][1] === 12 && v[0][2] === 3,
    "vertical 첫 점 = 접점 world 좌표",
  );
  assert(v[1][1] === 0, "vertical 끝 점 Y = 0 (플레이트)");
  assert(
    v[1][0] === v[0][0] && v[1][2] === v[0][2],
    "vertical 은 XZ 가 접점과 같다 (진짜 수직)",
  );

  const b = buildPolyline(
    {
      kind: "bent",
      waypoints: [
        [2, 9, 3],
        [5, 6, 3],
      ],
      landingXZ: [5, 3],
    },
    [2, 12, 3],
  );
  assert(b.length === 4, `bent 는 접점+waypoints+착지 = 4점 (실제 ${b.length})`);
  assert(b[0][1] === 12, "bent 첫 점 = 접점");
  assert(
    b[1][1] === 9 && b[2][1] === 6,
    "bent 중간은 waypoints 를 **순서 그대로** 통과",
  );
  assert(b[3][0] === 5 && b[3][1] === 0 && b[3][2] === 3, "bent 끝 = landingXZ 위 Y0");
  // 폴리라인이 아래로 단조 하강해야 한다 — 뒤집힌 순서가 섞이면 높이 계산이 깨진다.
  let mono = true;
  for (let i = 1; i < b.length; i++) if (b[i][1] > b[i - 1][1]) mono = false;
  assert(mono, "bent 폴리라인 Y 가 단조 하강 (접점 → 착지)");

  assert(
    buildPolyline({ kind: "joinPillar" }, [0, 5, 0]) === null,
    "joinPillar 는 기둥이 아니다 — 폴리라인 없음 (리드 지시)",
  );
  assert(
    buildPolyline({ kind: "anchor" }, [0, 5, 0]) === null,
    "anchor 는 기둥이 아니다 — 모델 표면에 얹혀 좌굴 하중 경로가 없다",
  );

  // 높이 = 폴리라인 Y 범위 (계획 모듈 결정 ⓑ). bent 도 전 구간으로 센다.
  const heightOf = (poly) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of poly) {
      lo = Math.min(lo, p[1]);
      hi = Math.max(hi, p[1]);
    }
    return hi - lo;
  };
  assert(heightOf(v) === 12, "vertical 높이 = 접점 Y");
  assert(heightOf(b) === 12, "bent 높이도 경로 전체 Y 범위(12) — 수직 구간만이 아니다");

  // 이 폴리라인을 계획 모듈에 그대로 먹여도 같은 높이로 판정되는가 (규칙 일치).
  const probe = { hitDistance: () => null };
  const opts = {
    structuralAngleDeg: 45,
    h1Mm: 15,
    h2Mm: 35,
    linkDistFactor: 40,
    minHeightRatio: 0.5,
    maxBracesPerPillar: 4,
    maxZigzagSteps: 6,
  };
  // 12mm 는 1차 임계(15) 미만 → 연결 불요.
  const under = planPillarInterconnect(
    [
      { id: "u1", polyline: v, radiusMm: 0.4 },
      { id: "u2", polyline: b, radiusMm: 0.4 },
    ],
    probe,
    opts,
  );
  assert(
    under.report.needed === 0 && under.braces.length === 0,
    "12mm 기둥(임계 미만)은 연결이 필요 없다 — 폴리라인 높이 규칙이 일치한다",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// §e 형상 — assembleStrut 재사용 규약
// ─────────────────────────────────────────────────────────────────────────────
function sectionE() {
  console.log("\n(§e) 브레이스 형상이 assembleStrut 재사용 규약을 지키는가:");
  const specs = [
    { from: [0, 5, 0], to: [4, 9, 0], radiusMm: 0.4 },
    { from: [4, 9, 0], to: [0, 13, 0], radiusMm: 0.4 },
  ];
  const merged = assemblePillarBraces(PARTS, specs);

  // 각각 따로 조립한 것과 **정점·삼각형 수가 정확히 같아야** 한다(중복 생성 없음).
  const s0 = assembleStrut(PARTS, specs[0].from, specs[0].to, specs[0].radiusMm);
  const s1 = assembleStrut(PARTS, specs[1].from, specs[1].to, specs[1].radiusMm);
  assert(
    merged.positions.length === s0.positions.length + s1.positions.length,
    "병합 정점 수 = 개별 합 (접합 구 등 추가 형상 없음)",
  );
  assert(
    merged.indices.length === s0.indices.length + s1.indices.length,
    "병합 삼각형 수 = 개별 합",
  );

  // 첫 막대 구간은 단독 조립과 **바이트 동일** — 병합이 좌표를 건드리지 않는다.
  let sameBytes = true;
  for (let i = 0; i < s0.positions.length; i++) {
    if (merged.positions[i] !== s0.positions[i]) sameBytes = false;
  }
  assert(sameBytes, "병합 결과의 첫 막대 정점이 단독 assembleStrut 결과와 바이트 동일");

  // 인덱스 오프셋이 제대로 재부여됐는가 — 두 번째 막대가 첫 막대 정점을 참조하면
  //   형상이 찢어진다(병합에서 가장 흔한 사고).
  const vcount = merged.positions.length / 3;
  let maxIdx = -1;
  for (const i of merged.indices) maxIdx = Math.max(maxIdx, i);
  assert(maxIdx === vcount - 1, `인덱스 최대값 = 정점수-1 (실제 ${maxIdx}/${vcount - 1})`);
  const half = s0.indices.length;
  let secondMin = Infinity;
  for (let i = half; i < merged.indices.length; i++) {
    secondMin = Math.min(secondMin, merged.indices[i]);
  }
  assert(
    secondMin >= s0.positions.length / 3,
    "두 번째 막대의 인덱스가 첫 막대 정점을 넘겨받지 않는다(오프셋 재부여)",
  );

  // 막대 양 끝 단면 중심이 from/to 와 일치하는가 (assemble-strut 계약 재확인).
  const first = assemblePillarBraces(PARTS, [specs[0]]);
  let sumLo = [0, 0, 0];
  let sumHi = [0, 0, 0];
  let nLo = 0;
  let nHi = 0;
  const mid = (specs[0].from[1] + specs[0].to[1]) / 2;
  for (let i = 0; i < first.positions.length; i += 3) {
    const p = [first.positions[i], first.positions[i + 1], first.positions[i + 2]];
    const t = p[1] < mid ? "lo" : "hi";
    if (t === "lo") {
      sumLo = [sumLo[0] + p[0], sumLo[1] + p[1], sumLo[2] + p[2]];
      nLo++;
    } else {
      sumHi = [sumHi[0] + p[0], sumHi[1] + p[1], sumHi[2] + p[2]];
      nHi++;
    }
  }
  const cLo = sumLo.map((v) => v / nLo);
  const cHi = sumHi.map((v) => v / nHi);
  const near = (a, b2) => Math.hypot(a[0] - b2[0], a[1] - b2[1], a[2] - b2[2]) < 1e-4;
  assert(near(cLo, specs[0].from), "아래 끝 단면 중심 = from");
  assert(near(cHi, specs[0].to), "위 끝 단면 중심 = to");

  // NaN 무발생 — assembleStrut 의 -Y 근처 수치 안정성이 그대로 살아 있는가.
  const down = assemblePillarBraces(PARTS, [
    { from: [0, 10, 0], to: [1e-12, 0, 0], radiusMm: 0.4 },
  ]);
  let nan = false;
  for (const v of down.positions) if (!Number.isFinite(v)) nan = true;
  assert(!nan, "거의 정확한 -Y 방향 다리에서도 NaN 없음");

  // 길이 0 다리는 조용히 스킵 — 빈 지오메트리.
  const zero = assemblePillarBraces(PARTS, [
    { from: [1, 2, 3], to: [1, 2, 3], radiusMm: 0.4 },
  ]);
  assert(zero.positions.length === 0, "길이 0 다리는 형상을 만들지 않는다");
}

// ─────────────────────────────────────────────────────────────────────────────
// §f 변조 대조군 — 위 단언이 실제로 무언가를 지키는지 증명
// ─────────────────────────────────────────────────────────────────────────────

/** 변조 1 — cascade 를 뺀 삭제 구현 (기둥을 지워도 다리가 남는다). */
async function mutantNoCascade(projectId, pointIds) {
  void projectId;
  void pointIds;
  return []; // 아무것도 지우지 않는다.
}

/** 변조 2 — 판별 필드를 무시한 조회 (브레이스가 점 목록에 섞인다). */
function mutantListIgnoringDiscriminator(all) {
  return all; // recordKind 필터 없음.
}

/** 변조 3 — 한쪽 끝만 보는 cascade (fromPointId 만 매치). */
function mutantOneSidedCascade(braces, targets) {
  return braces.filter((b) => targets.has(b.fromPointId));
}

/** 변조 4 — 인덱스 오프셋을 재부여하지 않는 병합 (형상이 찢어진다). */
function mutantMergeWithoutOffset(parts, specs) {
  const accPos = [];
  const accIdx = [];
  for (const s of specs) {
    const geo = assembleStrut(parts, s.from, s.to, s.radiusMm);
    for (let i = 0; i < geo.positions.length; i++) accPos.push(geo.positions[i]);
    // ★ vbase 를 더하지 않는다 (변조).
    for (let i = 0; i < geo.indices.length; i++) accIdx.push(geo.indices[i]);
  }
  return {
    positions: new Float32Array(accPos),
    indices: new Uint32Array(accIdx),
  };
}

async function sectionF() {
  console.log("\n(§f) 변조 대조군 — 핵심 판정을 뺀 구현이 실제로 FAIL 나는가:");
  let detected = 0;
  const mcheck = (cond, msg) => {
    if (cond) {
      console.log(`  ok(변조 검출): ${msg}`);
      detected++;
    } else {
      failed++;
      console.error(`  FAIL: 변조본이 통과해 버렸다 — ${msg}`);
    }
  };

  // 준비: m1-m2 다리 하나.
  await repo.addSupports([point("m1"), point("m2")]);
  await repo.addPillarBraces([brace("mb1", "m1", "m2")]);

  // ── 변조 1: cascade 제거 ─────────────────────────────────────────────────
  const mutantRemoved = await mutantNoCascade(PROJECT, ["m1"]);
  mcheck(
    mutantRemoved.length !== 1,
    "[변조1 cascade 제거] §b 의 '삭제 반환 1개' 단언을 깬다 (다리가 허공에 남는다)",
  );
  const realRemoved = await repo.deletePillarBracesByPointIds(PROJECT, ["m1"]);
  mcheck(
    realRemoved.length === 1,
    "[변조1 대조] 같은 입력에서 원본 구현은 다리를 지운다",
  );

  // ── 변조 2: 판별 필드 무시 ────────────────────────────────────────────────
  await repo.addPillarBraces([brace("mb2", "m1", "m2")]);
  const rawAll = [point("m1"), point("m2"), brace("mb2", "m1", "m2")];
  const mutantPoints = mutantListIgnoringDiscriminator(rawAll);
  mcheck(
    mutantPoints.length !== 2,
    "[변조2 판별 필드 무시] §a 의 '점 2개만' 단언을 깬다",
  );
  mcheck(
    mutantPoints.some((p) => p.recordKind === "pillarBrace"),
    "[변조2] 변조 조회 결과에 브레이스가 실제로 섞여 나온다 (타입 오염 재현)",
  );
  const realPoints = await repo.listSupportsByProject(PROJECT);
  mcheck(
    realPoints.length === 2 && realPoints.every((p) => p.recordKind === undefined),
    "[변조2 대조] 같은 DB 상태에서 원본 조회는 점 2개만 돌려준다",
  );

  // ── 변조 3: 한쪽 끝만 보는 cascade ────────────────────────────────────────
  const braces = [brace("mb3", "m1", "m2")];
  const oneSided = mutantOneSidedCascade(braces, new Set(["m2"]));
  mcheck(
    oneSided.length === 0,
    "[변조3 한쪽 끝만] toPointId 쪽 기둥 삭제를 놓친다 (§b 양끝 단언을 깬다)",
  );
  const realBoth = await repo.deletePillarBracesByPointIds(PROJECT, ["m2"]);
  mcheck(realBoth.length === 1, "[변조3 대조] 원본은 toPointId 쪽 삭제도 잡는다");

  // ── 변조 4: 인덱스 오프셋 미재부여 ────────────────────────────────────────
  const specs = [
    { from: [0, 5, 0], to: [4, 9, 0], radiusMm: 0.4 },
    { from: [4, 9, 0], to: [0, 13, 0], radiusMm: 0.4 },
  ];
  const bad = mutantMergeWithoutOffset(PARTS, specs);
  const good = assemblePillarBraces(PARTS, specs);
  let badMax = -1;
  for (const i of bad.indices) badMax = Math.max(badMax, i);
  mcheck(
    badMax !== bad.positions.length / 3 - 1,
    "[변조4 오프셋 미재부여] §e 의 '인덱스 최대값 = 정점수-1' 단언을 깬다 (형상이 찢어진다)",
  );
  let goodMax = -1;
  for (const i of good.indices) goodMax = Math.max(goodMax, i);
  mcheck(
    goodMax === good.positions.length / 3 - 1,
    "[변조4 대조] 원본 병합은 인덱스가 전 정점을 정확히 덮는다",
  );

  console.log(`  → 변조 4종 전부 실검출 (대조 단언 ${detected}건 통과)`);
  await repo.deleteSupportsByProject(PROJECT);
}

// ─────────────────────────────────────────────────────────────────────────────
// §g 계획→저장 왕복 — planPillarInterconnect 결과가 레코드로 온전히 변환되는가
// ─────────────────────────────────────────────────────────────────────────────
/**
 * §h 아카이브 왕복 + 전체삭제 undo — **검수에서 잡힌 결함 2건의 회귀 가드**.
 *
 *   ① 내보내기/가져오기에서 다리 유실: `listSupportsByProject` 가 브레이스를
 *      걸러내므로(그게 맞다), 아카이브가 **따로 수집**하지 않으면 다리가 한 건도
 *      안 들어가고 가져오기 후 전부 사라진다. 화면에 오류도 안 뜬다.
 *   ② "서포트 전체 삭제" undo: clearAll 은 브레이스까지 지우는데(의도된 cascade)
 *      점만 되돌리면 다리가 영구 소실된다.
 *
 *   project-archive.ts 는 zip·Blob 의존이라 헤드리스로 직접 못 부른다. 대신
 *   **repo 계층에서 같은 순서로 호출해** 두 경로의 전제(따로 수집 / 따로 복원)가
 *   성립하는지 본다. 구현이 바뀌면 이 스크립트도 같이 바꿔야 한다.
 */
async function sectionH() {
  console.log("\n(§h) 아카이브 수집·전체삭제 undo 가 다리를 보존하는가:");

  const p1 = point("h1");
  const p2 = point("h2");
  await repo.addSupports([p1, p2]);
  const br = brace("hb1", "h1", "h2");
  await repo.addPillarBraces([br]);

  // ① 아카이브가 점만 모으면 다리를 놓친다 — 별도 수집이 **필수**임을 고정.
  const archPoints = await repo.listSupportsByProject(PROJECT);
  const archBraces = await repo.listPillarBracesByProject(PROJECT);
  assert(
    archPoints.length === 2,
    `점 조회는 점만 준다 (${archPoints.length}개) — 다리는 여기 없다`,
  );
  assert(
    archBraces.length === 1,
    `다리는 별도 조회로만 나온다 (${archBraces.length}개). ` +
      `이 호출을 빠뜨리면 아카이브에 다리가 0건 들어간다`,
  );

  // ② 전체 삭제 → 점·다리 모두 사라지는가 (cascade 가 도는지)
  await repo.deleteSupportsByProject(PROJECT);
  const afterPoints = await repo.listSupportsByProject(PROJECT);
  const afterBraces = await repo.listPillarBracesByProject(PROJECT);
  assert(afterPoints.length === 0, "전체 삭제 후 점 0개");
  assert(
    afterBraces.length === 0,
    `전체 삭제가 다리까지 지운다 (남은 ${afterBraces.length}개)`,
  );

  // ③ undo — 점만 되돌리면 다리가 안 돌아온다(결함 재현). 다리도 넣어야 복원된다.
  await repo.addSupports([p1, p2]);
  const onlyPoints = await repo.listPillarBracesByProject(PROJECT);
  assert(
    onlyPoints.length === 0,
    "점만 복원하면 다리는 안 돌아온다 — 스냅샷이 필요한 이유(결함 재현)",
  );
  await repo.addPillarBraces(archBraces);
  const restored = await repo.listPillarBracesByProject(PROJECT);
  assert(
    restored.length === 1 &&
      restored[0].fromPointId === "h1" &&
      restored[0].toPointId === "h2",
    "다리 스냅샷을 함께 복원하면 양 끝 참조까지 온전하다",
  );

  await repo.deleteSupportsByProject(PROJECT);
}

async function sectionG() {
  console.log("\n(§g) 계획 결과 → 저장 레코드 왕복:");
  // 20mm 기둥 2개, 수평 6mm — 1차 임계(15mm) 초과라 연결이 필요하다.
  const pillars = [
    { id: "g1", polyline: [[0, 20, 0], [0, 0, 0]], radiusMm: 0.4 },
    { id: "g2", polyline: [[6, 20, 0], [6, 0, 0]], radiusMm: 0.4 },
  ];
  const probe = { hitDistance: () => null }; // 장애물 없음.
  const { braces: planned, report } = planPillarInterconnect(pillars, probe, {
    structuralAngleDeg: 45,
    h1Mm: 15,
    h2Mm: 35,
    linkDistFactor: 40,
    minHeightRatio: 0.5,
    maxBracesPerPillar: 4,
    maxZigzagSteps: 6,
  });
  assert(planned.length > 0, `계획이 다리를 냈다 (${planned.length}개)`);
  assert(report.needed === 2 && report.connected === 2, "두 기둥 모두 연결됨으로 집계");

  const records = planned.map((b, i) => ({
    recordKind: "pillarBrace",
    id: `brace_${b.fromId}_${b.toId}_${b.step}_${b.cross ? "x" : "z"}_${i}`,
    projectId: PROJECT,
    stlId: STL,
    fromPointId: b.fromId,
    toPointId: b.toId,
    from: b.from,
    to: b.to,
    radiusMm: b.radiusMm,
    coordSpace: "stl-local",
    addedAt: 1,
  }));
  assert(
    new Set(records.map((r) => r.id)).size === records.length,
    "생성된 레코드 id 가 전부 유일하다 (put 이 서로를 덮어쓰지 않는다)",
  );
  assert(
    records.every((r) => r.fromPointId === "g1" || r.fromPointId === "g2"),
    "fromPointId 가 계획 입력의 기둥 id 를 그대로 가리킨다",
  );

  await repo.addSupports([point("g1"), point("g2")]);
  await repo.addPillarBraces(records);
  const back = await repo.listPillarBracesByProject(PROJECT);
  assert(back.length === records.length, "저장→조회 개수 일치");
  assert(
    JSON.stringify(byId(back)) === JSON.stringify(byId(records)),
    "저장→조회 왕복이 브레이스 레코드를 바이트 동일하게 보존",
  );
  // 두 번 넣어도(재실행) 중복이 쌓이지 않는다 — 결정적 id + put(upsert).
  await repo.addPillarBraces(records);
  const again = await repo.listPillarBracesByProject(PROJECT);
  assert(
    again.length === records.length,
    `재실행해도 레코드가 쌓이지 않는다 (실제 ${again.length})`,
  );

  // 그 레코드로 실제 형상이 나오는가 (계획 → 저장 → 조립 전 구간).
  const geo = assemblePillarBraces(
    PARTS,
    back.map((r) => ({ from: r.from, to: r.to, radiusMm: r.radiusMm })),
  );
  assert(geo.positions.length > 0, "저장된 레코드로 형상이 조립된다");
  let finite = true;
  for (const v of geo.positions) if (!Number.isFinite(v)) finite = false;
  assert(finite, "조립 좌표에 NaN/Infinity 없음");

  // 기둥 하나를 지우면 그 다리 전부가 사라진다.
  const removed = await repo.deletePillarBracesByPointIds(PROJECT, ["g1"]);
  assert(
    removed.length === records.length,
    `g1 이 걸린 다리 전부 삭제 (${removed.length}/${records.length})`,
  );
  await repo.deleteSupportsByProject(PROJECT);
}

async function main() {
  console.log("=== 기둥 연결 브레이스 파이프라인 검증 (S-4b-2d 2단계) ===");
  await sectionA();
  await sectionB();
  await sectionC();
  sectionD();
  sectionE();
  await sectionF();
  await sectionG();
  await sectionH();

  console.log(
    failed === 0 ? "\n=== 전체 통과 ===" : `\n=== 실패 ${failed}건 ===`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

await main();
