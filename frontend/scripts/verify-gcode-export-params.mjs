// G-code 내보내기 파라미터/다운로드 MIME 헤드리스 검증 (B-37 / B-38).
//
//   리드 실물 발견: "G-code 보내기 하니까 슬라이스 미리보기에서 나가지던데
//   메인화면으로?" — 내보내기는 성공하는데 미리보기 모드가 풀려 튕겼다.
//   조사 중 같은 경로에서 두 번째 결함이 함께 드러났다.
//
//   B-37. 레이어 두께 미반영 (조용한 결함 — 산출물이 틀림)
//     handleExportGcode 가 handle.getFdmSliceInput() 을 **인자 없이** 불렀다.
//     그러면 DEFAULT_FDM_SETTINGS.layerHeight(0.05) 로 폴백해, 사용자가 패널에서
//     고른 두께가 G-code 에 전혀 반영되지 않는다. 마스크 ZIP·CTB 는 제대로
//     넘기는데 G-code 만 빠져 있던 비대칭. 화면 추정과 파일 내용이 어긋나므로
//     규칙 6(기본값 단일 소스)의 정신에 정면으로 위배된다.
//
//   B-38. text/plain Blob 이 SPA 를 이탈시킴 (리드가 본 증상)
//     downloadBlob 은 <a download> + click() 방식인데, Blob MIME 이 브라우저가
//     인라인 표시 가능한 타입(text/plain)이면 download 속성이 무시되고 blob URL
//     로 네비게이션하는 경우가 있다. 그러면 SPA 가 통째로 이탈했다 돌아와
//     useState 인 slicePreview 가 초기값 {on:false} 로 리셋된다 = 미리보기가 풀림.
//     .zip(application/zip) · .ctb(application/octet-stream) 는 표시 불가 타입이라
//     항상 다운로드로 처리됐다 — 한쪽만 튕긴 비대칭을 설명하는 유일한 차이.
//
//   검사 항목:
//     (a) DEFAULT_FDM_SETTINGS.layerHeight 가 실제로 0.05 — 폴백이 위험한 값임을 고정
//     (b) 사용자 두께를 넘기면 merged.layerHeight 가 그 값이 된다 (여러 두께)
//     (c) **대조군 A** — 인자를 비우면(구 구현) 두께가 무엇이든 0.05 로 고정되는 것을
//         증명. 0.05 를 고른 경우엔 우연히 맞으므로 "조용한 결함"임도 함께 보인다
//     (d) partial 병합이 layerHeight 만 덮고 나머지 기본값을 보존하는가
//     (e) 다운로드 MIME 이 인라인 표시 불가 타입인가 (G-code / ZIP / CTB 전부)
//     (f) **대조군 B** — text/plain 이 인라인 표시 가능 타입으로 분류되는 것을 증명
//         (즉 이 검사가 통과만 하는 검사가 아님)
//     (g) 소스 배선 검사 — useSliceExport.ts 가 실제로 layerHeight 를 넘기고,
//         octet-stream 을 쓰고, deps 에 layerHeightMm 이 들어 있는가(규칙 7)
//
//   실행: npx tsx scripts/verify-gcode-export-params.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_FDM_SETTINGS } from "../src/features/v2/utils/gcode/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── assert 유틸 ──────────────────────────────────────────────────────────
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ok: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

/**
 * slice-export-handle.ts 의 설정 병합과 동일한 식.
 *   const merged = { ...DEFAULT_FDM_SETTINGS, buildWidth, buildDepth, ...settings }
 * 여기서는 layerHeight 만 관심사이므로 그 부분만 재현한다.
 */
function mergeFdmSettings(settings) {
  return { ...DEFAULT_FDM_SETTINGS, ...settings };
}

/**
 * 브라우저가 인라인으로 "표시할 수 있는" MIME 인가.
 *   표시 가능 → <a download> 가 무시되고 네비게이션할 여지가 있다(B-38).
 */
function isInlineRenderable(mime) {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base.startsWith("text/")) return true;
  if (base.startsWith("image/")) return true;
  if (base === "application/pdf") return true;
  if (base === "application/json") return true;
  if (base === "application/xml") return true;
  return false;
}

console.log("\n=== (a) DEFAULT_FDM_SETTINGS.layerHeight 폴백값 고정 ===");
assert(
  DEFAULT_FDM_SETTINGS.layerHeight === 0.05,
  `폴백 두께가 0.05 (실제 ${DEFAULT_FDM_SETTINGS.layerHeight}) — 이 값이 조용히 쓰이면 B-37`,
);

console.log("\n=== (b) 사용자 두께를 넘기면 반영되는가 ===");
const USER_HEIGHTS = [0.01, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2, 0.3];
for (const lh of USER_HEIGHTS) {
  const merged = mergeFdmSettings({ layerHeight: lh });
  assert(
    merged.layerHeight === lh,
    `두께 ${lh} 를 넘기면 merged.layerHeight === ${lh}`,
  );
}

console.log("\n=== (c) 대조군 A — 구 구현(인자 없음)은 항상 0.05 로 고정 ===");
let silentlyWrong = 0;
for (const lh of USER_HEIGHTS) {
  // 구 구현: getFdmSliceInput() — settings 자체를 안 넘김
  const oldMerged = mergeFdmSettings(undefined);
  if (lh !== 0.05) {
    silentlyWrong++;
    assert(
      oldMerged.layerHeight !== lh,
      `구 구현은 두께 ${lh} 를 무시하고 ${oldMerged.layerHeight} 를 쓴다 (결함 재현)`,
    );
  } else {
    assert(
      oldMerged.layerHeight === lh,
      `두께 0.05 에서는 구 구현도 우연히 일치 — 그래서 조용한 결함이었다`,
    );
  }
}
assert(
  silentlyWrong === USER_HEIGHTS.length - 1,
  `0.05 를 뺀 ${USER_HEIGHTS.length - 1}종 두께 전부에서 구 구현이 틀렸다`,
);

console.log("\n=== (d) partial 병합이 나머지 기본값을 보존하는가 ===");
const merged = mergeFdmSettings({ layerHeight: 0.2 });
const otherKeys = Object.keys(DEFAULT_FDM_SETTINGS).filter(
  (k) => k !== "layerHeight",
);
assert(otherKeys.length > 0, `layerHeight 외 기본 설정 키가 존재 (${otherKeys.length}개)`);
let preserved = true;
for (const k of otherKeys) {
  if (merged[k] !== DEFAULT_FDM_SETTINGS[k]) preserved = false;
}
assert(preserved, "layerHeight 만 덮고 나머지 기본값은 전부 보존");

console.log("\n=== (e) 다운로드 MIME 이 인라인 표시 불가 타입인가 ===");
const DOWNLOAD_MIMES = {
  "G-code (수정 후)": "application/octet-stream",
  "마스크 ZIP": "application/zip",
  CTB: "application/octet-stream",
};
for (const [label, mime] of Object.entries(DOWNLOAD_MIMES)) {
  assert(
    !isInlineRenderable(mime),
    `${label} = ${mime} — 인라인 표시 불가라 항상 다운로드로 처리됨`,
  );
}

console.log("\n=== (f) 대조군 B — text/plain 은 인라인 표시 가능 ===");
assert(
  isInlineRenderable("text/plain"),
  "구 구현의 text/plain 은 표시 가능 타입 = 네비게이션 위험 (결함 재현)",
);
assert(
  isInlineRenderable("text/plain;charset=utf-8"),
  "charset 파라미터가 붙어도 동일하게 표시 가능으로 분류",
);

console.log("\n=== (g) 소스 배선 검사 (useSliceExport.ts) ===");
const srcPath = path.join(
  __dirname,
  "../src/features/v2/pages/viewer/hooks/useSliceExport.ts",
);
const src = fs.readFileSync(srcPath, "utf8");

// G-code 핸들러 본문만 잘라낸다 (다른 핸들러의 동명 문자열에 속지 않도록).
const gcodeStart = src.indexOf("const handleExportGcode");
assert(gcodeStart > 0, "handleExportGcode 를 소스에서 찾음");
const gcodeEnd = src.indexOf("const handleExportStl", gcodeStart);
const gcodeBody = src.slice(gcodeStart, gcodeEnd > 0 ? gcodeEnd : src.length);

assert(
  /getFdmSliceInput\(\s*\{/.test(gcodeBody),
  "getFdmSliceInput 을 인자 없이 부르지 않는다 (B-37 재발 방지)",
);
assert(
  /layerHeight:\s*slicePreview\.layerHeightMm/.test(gcodeBody),
  "layerHeight 로 slicePreview.layerHeightMm 을 넘긴다",
);
assert(
  !/type:\s*["']text\/plain["']/.test(gcodeBody),
  "G-code Blob 이 text/plain 이 아니다 (B-38 재발 방지)",
);
assert(
  /type:\s*["']application\/octet-stream["']/.test(gcodeBody),
  "G-code Blob 이 application/octet-stream 이다",
);

// 규칙 7 — deps 배열에 layerHeightMm 이 들어 있는가.
//   useCallback 을 닫는 `}, [ ... ]);` 중 **마지막** 것이 이 핸들러의 deps 다
//   (본문 중간의 객체 리터럴에 속지 않도록 lastIndexOf 로 뒤에서 찾는다).
const depsClose = gcodeBody.lastIndexOf("}, [");
assert(depsClose > 0, "handleExportGcode 의 deps 배열 시작 위치를 찾음");
const depsMatch =
  depsClose > 0
    ? gcodeBody.slice(depsClose).match(/\}\s*,\s*\[([\s\S]*?)\]\s*\)/)
    : null;
assert(depsMatch !== null, "handleExportGcode 의 useCallback deps 배열을 찾음");
if (depsMatch) {
  assert(
    /slicePreview\.layerHeightMm/.test(depsMatch[1]),
    "규칙 7 — deps 에 slicePreview.layerHeightMm 이 있다 (stale closure 방지)",
  );
}

// ── 결과 ────────────────────────────────────────────────────────────────
console.log("");
if (failed > 0) {
  console.error(`실패 ${failed}건`);
  process.exit(1);
}
console.log("전체 통과");
process.exit(0);
