/**
 * Task0 G-code 내보내기 코어 (Z2) — 앱 워커와 검증 스크립트가 **같은 함수**를 부른다
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.3 @ 커밋 dfdf08c (§3·§12), 협의 §26-1.
 * 설계: `docs/계획_Z1_task0출력_20261002.md` §4·§4-2 (Z2 인계 — 워커 필수, 채움 실패면 막고 안내).
 *
 * 앱 경로: workers/slice-batch.worker.ts runTask0Gcode → 이 파일 runTask0GcodeExport → 결과를 메인으로
 *   (utils/slice-batch-service.ts exportTask0Gcode). 검증: scripts/verify-task0-export.mjs 가 이 함수를
 *   scripts/gen-task0-dryrun.mjs 와 같은 입력(파일 A·C·B)으로 불러 **같은 바이트**가 나오는지 본다(앱 = 스크립트).
 *
 * 순서:
 *   1. 층이 없으면(메시 없음·topY ≤ 0) 막음.
 *   2. generateTask0Gcode(meshes, topY, lh, writer 옵션 + 층 진행 콜백) — 진행 콜백은 출력에 영향 없음.
 *   3. writer 의 채움 실패 층(totals.thinFillFailedLayers)이 있으면 막음 — 층 번호·Z·이유.
 *   4. 같은 텍스트를 Task0 파서 이식판으로 세 모드 파싱 — print(layerHeightMm 지정) → dryrun(E 유지) →
 *      dryrun(E 제거). 경고·오류가 하나라도 있거나 층 수가 writer 와 다르면 막음("내보낼 파일은 경고 0 인 것만").
 *      실출력(job.zip) 기준은 print 모드이고, 11월 데모는 Task0 드라이런 탭에서 돌기 때문에 dryrun 두 모드도
 *      함께 본다(writer 검증 c1 과 같은 세 모드).
 *   5. 통과하면 gcode + 요약(층 수·빈 층·채움 층·길이·예상 시간 — task0-jobzip buildTask0Estimate 재사용).
 *   막을 때는 gcode 를 돌려주지 않는다(null) — 화면에 보일 이유 문장(한국어)만 돌려준다.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음(Web Worker·tsx 공통).
 */
import { task0LayerCount, task0LayerZ } from './task0-frame';
import { parseGcodeText, type Task0ParseOptions } from './task0-gcode-parser';
import { generateTask0Gcode, type Task0WriterOptions } from './task0-gcode-writer';
import {
  buildTask0Estimate,
  buildTask0Exposure,
  type Task0Estimate,
  type Task0ExposureSettings,
} from './task0-jobzip';

// ==================== 타입 ====================

/** 워커 메시지로 넘길 수 있는 writer 옵션 — 진행 콜백(함수)은 빼고, 워커가 붙인다 */
export type Task0ExportWriterOptions = Omit<Task0WriterOptions, 'onLayerDone'>;

export interface Task0ExportInput {
  /** 메시별 world 삼각형 (감김 통일 — extractWorldTriangles 결과, 서포트 포함). 읽기만 한다 */
  meshes: readonly Float32Array[];
  /** 서포트 포함 최고점 (mm, 플레이트 0 기준) — 마스크 경로와 같은 값(handle.getSceneTopY) */
  topY: number;
  /** 층두께 (mm) */
  layerHeightMm: number;
  /** writer 옵션 (프로파일에서 — task0-profile task0WriterOptionsForProfile). 빠진 값은 TASK0_DEFAULTS */
  writer?: Task0ExportWriterOptions;
  /** 예상 시간의 노광 항목용 — 빠진 값은 types/printer.ts DEFAULT_* (규칙 6) */
  exposure?: Task0ExposureSettings;
}

/** 내보내기 요약 — 길이 mm, 시간 s */
export interface Task0ExportSummary {
  layerCount: number;
  layerHeightMm: number;
  /** 빈 층 수 (XY 이동 없음 — Task0 가 파킹·블레이드·LED 를 생략) */
  emptyLayerCount: number;
  /** 얇은 부분 채움이 들어간 층 수 */
  thinFillLayerCount: number;
  /** 채움 후에도 커버리지 실패인 층 (0-based) — 비어 있어야 파일을 낸다 */
  thinFillFailedLayers: number[];
  depositMm: number;
  travelMm: number;
  /** E−r 줄 수 */
  retracts: number;
  /** 파일 줄 수 */
  lineCount: number;
  /** 규격 §11·§13 estimate 8필드 (s) — 단일 재료라 툴 전환 0 */
  estimate: Task0Estimate;
}

/** 파서 검사 한 모드의 결과 */
export interface Task0ExportParserCheck {
  /** 'print(lh=…)' · 'dryrun(keepE=true)' · 'dryrun(keepE=false)' */
  label: string;
  warnings: string[];
  errors: string[];
  layerCount: number;
}

export type Task0ExportResult =
  | {
      ok: true;
      gcode: string;
      summary: Task0ExportSummary;
      parser: Task0ExportParserCheck[];
    }
  | {
      ok: false;
      /** 막았으므로 항상 null — 파일을 돌려주지 않는다 */
      gcode: null;
      /** 화면에 보일 이유 (한국어, 층 번호는 0-based — 슬라이스 미리보기 층 번호와 같음) */
      issues: string[];
      /** 문제가 난 층 (0-based, 오름차순 — 채움 실패 층) */
      failedLayers: number[];
      /** writer 를 돌렸으면 요약, 층이 없어 돌리지 않았으면 null */
      summary: Task0ExportSummary | null;
      parser: Task0ExportParserCheck[];
    };

/**
 * 화면에 남기는 마지막 내보내기 결과 (앱 — useSliceExport 상태, 슬라이스 패널 표시).
 *   ok: 내려받은 파일 이름 + 요약 / 막힘: 이유 문장들(층 번호·문구).
 */
export type Task0ExportReport =
  | { ok: true; fileName: string; summary: Task0ExportSummary }
  | { ok: false; issues: string[] };

/** 결과를 메인에 보일 때 줄이는 개수 — 층 번호 목록·파서 경고 */
export const TASK0_EXPORT_MAX_LISTED = 8;

// ==================== 본체 ====================

/** 소수 자리 고정 후 끝 0 정리 (Z 표시용) */
function trimNum(v: number, decimals: number): string {
  let s = v.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** 파서 세 모드 — print 가 실출력(job.zip) 기준, dryrun 둘은 Task0 드라이런 탭 */
function parserModes(lh: number): { label: string; opt: Task0ParseOptions }[] {
  return [
    { label: `print(lh=${trimNum(lh, 6)})`, opt: { mode: 'print', layerHeightMm: lh } },
    { label: 'dryrun(keepE=true)', opt: { mode: 'dryrun', keepE: true } },
    { label: 'dryrun(keepE=false)', opt: { mode: 'dryrun', keepE: false } },
  ];
}

/**
 * Task0 G-code 를 만들고 검사한다 — 통과하면 gcode, 아니면 gcode 없이 이유.
 * @param onLayerDone 층 진행 (끝낸 층 수, 전체 층 수) — 워커가 스로틀해서 메인에 알린다
 */
export function runTask0GcodeExport(
  input: Task0ExportInput,
  onLayerDone?: (done: number, total: number) => void,
): Task0ExportResult {
  const lh = input.layerHeightMm;
  const layerCountExpected = Number.isFinite(lh) && lh > 0 ? task0LayerCount(input.topY, lh) : 0;
  if (input.meshes.length === 0 || layerCountExpected === 0) {
    return {
      ok: false,
      gcode: null,
      issues: ['슬라이스할 층이 없습니다 — 모델이 플레이트 위에 있는지 확인하세요.'],
      failedLayers: [],
      summary: null,
      parser: [],
    };
  }

  const result = generateTask0Gcode(input.meshes, input.topY, lh, { ...input.writer, onLayerDone });
  const t = result.totals;
  const exposure = buildTask0Exposure(t.layerCount, lh, input.exposure ?? {});
  const summary: Task0ExportSummary = {
    layerCount: t.layerCount,
    layerHeightMm: lh,
    emptyLayerCount: t.emptyLayers.length,
    thinFillLayerCount: t.thinFillLayers.length,
    thinFillFailedLayers: [...t.thinFillFailedLayers],
    depositMm: t.depositMm,
    travelMm: t.travelMm,
    retracts: t.retracts,
    lineCount: t.lineCount,
    estimate: buildTask0Estimate(result.layers, result.params, exposure.exposureSecByLayer),
  };

  const issues: string[] = [];
  // (3) 채움 실패 — 노즐이 이미 칠한 비드에 갇히는 퇴화 단면 등 (계획서 §4-2)
  const failed = t.thinFillFailedLayers;
  if (failed.length > 0) {
    const zDecimals = 6;
    const listed = failed
      .slice(0, TASK0_EXPORT_MAX_LISTED)
      .map((n) => `층 ${n} (Z ${trimNum(task0LayerZ(n, lh), zDecimals)} mm)`);
    const more = failed.length > TASK0_EXPORT_MAX_LISTED ? ` 외 ${failed.length - TASK0_EXPORT_MAX_LISTED}개 층` : '';
    issues.push(
      `얇은 부분 채움 실패 ${failed.length}개 층: ${listed.join(', ')}${more} — ` +
        '노즐이 방금 칠한 비드 사이에 갇히는 단면이라 도포 경로가 노광 영역을 다 덮지 못합니다(규격 §3 커버리지). ' +
        '모델 배치·방향이나 층 두께를 바꿔 보세요.',
    );
  }

  // (4) Task0 파서 이식판 — 세 모드 경고·오류 0, 층 수 일치
  const parser: Task0ExportParserCheck[] = [];
  for (const { label, opt } of parserModes(lh)) {
    const r = parseGcodeText(result.gcode, opt);
    parser.push({ label, warnings: r.warnings, errors: r.errors, layerCount: r.layerCount });
    const msgs = [...r.errors.map((e) => `오류: ${e}`), ...r.warnings.map((w) => `경고: ${w}`)];
    for (const m of msgs.slice(0, TASK0_EXPORT_MAX_LISTED)) issues.push(`Task0 파서 ${label} ${m}`);
    if (msgs.length > TASK0_EXPORT_MAX_LISTED) {
      issues.push(`Task0 파서 ${label} 경고·오류 외 ${msgs.length - TASK0_EXPORT_MAX_LISTED}건`);
    }
    if (r.layerCount !== t.layerCount) {
      issues.push(`Task0 파서 ${label} 층 수 ${r.layerCount} ≠ writer 층 수 ${t.layerCount}`);
    }
  }

  if (issues.length > 0) {
    return { ok: false, gcode: null, issues, failedLayers: [...failed], summary, parser };
  }
  return { ok: true, gcode: result.gcode, summary, parser };
}
