/**
 * Task0 G-code writer — B안 줄 채움 (규격서 v0.3.4 §3·§4·§5·§7·§8·§10)
 *
 * 원본 규격: Task0 리포 `docs/Task0_Gcode_규격서_초안.md` v0.3.4 @ 커밋 a4ebc6c. 협의 §25~§26·§30
 *   (v0.3.4 = Z1-c: 시작 시 프라이밍 후 E-r — 모든 툴이 리트랙트 상태로 시작, 툴의 첫 도포 앞에도 E+r).
 * 설계: `docs/계획_Z1_task0출력_20261002.md` S1~S9 (Z1-a2). 기존 marlin G-code(`utils/gcode/`)와는 별개 —
 *   그쪽 바이트는 이 파일과 무관하게 그대로다(S1).
 * 출력 검사: `utils/task0/task0-gcode-parser.ts`(Task0 파서 이식) + `scripts/verify-task0-writer.mjs`.
 *
 * 입력: world 삼각형(메시마다 Float32Array, 감김 통일된 것 — 앱에서는 `extractWorldTriangles` 결과),
 *   topY(서포트 포함 최고점, 플레이트 0 기준), 층두께 lh.
 *
 * 층 N (규격 §3 — 마스크 PNG 와 같은 단면·같은 채움 규칙):
 *   1. 단면 = (N+0.5)·lh 에서 **메시마다** sliceTrianglesAtY → chainSegments (워커 sliceLayerMask 와 같은 절차).
 *   2. 점을 베드 좌표로(task0-frame worldToBed). 아래 계산은 전부 베드 좌표 mm.
 *      (1·2 는 task0-slice.ts task0LayerPolygonsBed 한 곳 — 마스크 래스터·커버리지 검사기와 같은 단면을 쓴다.)
 *   3. 행 y_k = (층 폴리곤 최소 Y) + w/2 + k·w, y_k < (최대 Y) − w/2 + 1e-9 동안.
 *      층 Y 폭이 w 의 배수가 아니면 마지막 행 띠 위에 w 미만 띠가 남는다(Z1-b 대상 — 통계 rowRemainderMm).
 *   4. 각 행에서 모든 폴리곤 변과의 교차점을 감김 부호와 함께 모아 x 순 정렬 → **감김수 ≠ 0 구간**
 *      (= 래스터라이저 slice-rasterize.ts 와 같은 nonzero 합집합: 겹친 솔리드는 채움, 반대 감김 내벽은 구멍).
 *      수평 변 제외, yLo ≤ y < yHi 반열림 — 식의 꼴은 래스터라이저와 같다. 단 래스터는 픽셀 y(베드 Y 와
 *      반대 방향) 기준이라 베드 기준으로는 닫힌 쪽이 반대다: 행이 꼭짓점을 정확히 지나면 이 writer 는
 *      위쪽(+Y) 단면을 택한다. 그 차이로 생기는 넘침·미도포는 w/2 띠 안이라 무해(Z1-a2 검수에서 확인).
 *      맞닿은 구간(끝 = 다음 시작)은 하나로 잇는다(래스터에서는 연속 픽셀이므로).
 *   5. 구간 양끝을 w/2 씩 안쪽으로 → 1 µm 격자에 맞춘 뒤 길이 ≤ 0 이면 버림(얇은 부분은 Z1-b, 개수는 통계).
 *   6. 행 순서 +Y 단조. 행 안 방향은 서펜타인 — 도포한 행 기준으로 첫 행 +X, 다음 행 −X, … 번갈아.
 *      한 행의 여러 구간은 진행 방향 순서.
 *   7. 이동: 층 첫 트래블(파킹 → 첫 도포점) = 직선 1줄. 같은 행 안 구간 사이 = 행 선을 따라 직선.
 *      행 사이 = L자(먼저 Y 로 다음 행, 그다음 X 로 다음 구간 시작) — 다음 행 선은 아직 안 칠한 곳이라
 *      도포 영역 교차 0 이 구조적으로 보장된다(규격 §7). 길이 0 인 다리는 쓰지 않는다.
 *
 * 리트랙트 상태 기계 (규격 v0.3.4 §5, 툴 T0 하나):
 *   - 시작 상태 = **리트랙트**(Task0 가 프라이밍 후 그 자리에서 E−r 까지 하고 노즐 (0,0) 으로 넘김, §10 — 협의 §30-2).
 *     그래서 파킹 → 첫 도포점 트래블도 리트랙트 상태로 가고, 툴의 첫 도포 앞에도 E+r 이 있다(예외 없음).
 *   - 트래블 길이(L자는 두 다리 합 = 경로 길이) ≥ retractMinTravel 이고 언리트랙트 상태면 트래블 전에 E−r
 *     (정확히 retractMinTravel 이면 리트랙트). 짧은 트래블은 생략(§5 예외 — 같은 툴의 층 안 트래블).
 *   - 도포 직전에 리트랙트 상태면 E+r.
 *   - 그 층에서 도포했으면 층 블록 끝에 항상 E−r → 모든 층 블록 끝에서 툴은 리트랙트 상태.
 *   - 그래서 툴별 E 단독 줄 순변화는 층마다 0(첫 층 포함 — E+r 수 = E−r 수), 파일 전체도 0.
 *   - 빈 층은 E 줄 없음 — 이미 리트랙트 상태라 바꿀 것이 없다.
 *   채움 층(task0-fill-route 순서)도 아래 같은 travel()/deposit() 으로 내므로 같은 규칙이다.
 *
 * E (규격 §5): 도포 줄 ΔE = 길이 × w × lh × 과충전 ÷ K. 소수 5자리 + **잔차 이월** — 정확 누적값을
 *   1e-5 단위로 반올림한 값의 차분을 출력하므로 어느 줄에서 끊어도 |출력 누적 − 정확 누적| ≤ 0.5e-5.
 *   길이는 출력한 좌표(1 µm 격자)로 잰다 — 파일만 보고 같은 값을 다시 계산할 수 있게.
 *
 * 출력 형식 (규격 §4·§7·§8, 협의 §26-1):
 *   START 앞 = 단독 주석 줄 메타(Task0 는 무시) → `; EXECUTABLE_BLOCK_START` → G90 → M83 → T0 →
 *   층마다 `;LAYER_CHANGE` / `;Z:{z}` / `;HEIGHT:{lh}` / `G1 Z{z}`(F 없음, ;Z: 와 같은 글자) → 이동들.
 *   빈 층도 4줄 그대로(건너뛰기·중복 제거 금지). 숫자는 고정 소수(X/Y 3자리, E 5자리, Z·HEIGHT 는 lh 에 맞는
 *   자리 후 끝 0 정리), F 정수 — 지수 표기·`-0` 없음. 이동 줄마다 F. 명령 줄 끝 주석 없음, END 마커 없음.
 *   줄바꿈 `\n`, 파일 끝 개행 1개, 같은 입력 → 같은 바이트.
 *
 * 얇은 부분 채움 (Z1-b2 — 규격 §3 (b)(c)(d)·§7 "얇은 부분 채움"):
 *   층마다 B안 행을 만든 뒤 커버리지 검사기(task0-coverage, 1 µm 격자 행 선분 그대로)로 본다.
 *   - 통과하면 위 1~7 그대로 낸다 — **채움이 필요 없는 층은 B안 행 그대로**(파일 A·C. Z1-a2 와의 바이트 차이는
 *     Z1-c 의 리트랙트 규칙(첫 도포 앞 E+r)과 머리 메타 두 줄뿐).
 *   - 실패하면 task0-thin-fill 이 실패 성분의 중심선·점 도포를 만들고(통과할 때까지 반복), task0-fill-route 가
 *     띠 분해(띠 번호 비감소·띠마다 방향 번갈아·띠 안 X 순서)와 교차 검사 통과 트래블(L자·A* 우회)로 순서를 정한다.
 *     리트랙트·E·숫자 표기·층 머리는 위와 같은 함수로 낸다(1 mm 미만 트래블 생략도 경로 길이 기준 그대로).
 *   - 그래도 커버리지 실패이거나 경로 없는 항목이 있으면 그 층을 thinFill 'failed' 로 남긴다 — 파일을 쓰는 쪽
 *     (gen-task0-dryrun, Z2 내보내기)이 totals.thinFillFailedLayers 를 보고 막는다.
 *   - 채움이 있는 파일만 START 앞 메타에 채움 통계 줄을 더한다(없는 파일은 메타도 그대로).
 *
 * 2재료 (D1a — 규격서 v0.3.4 §5·§6, 계획 `docs/계획_하이브리드슬라이서설정_20260928.md` §5-3, 이번 조각은 라이브러리만):
 *   options.dualMaterial 이 없으면 위 단일 재료 경로 그대로(T0 하나 — 출력 바이트 불변). 있으면:
 *   - 메시마다 슬롯(dualMaterial.slots): A = T0, B = T1(규격 §6). 서포트는 A(계획 §5-2) — 호출자가 정한다.
 *   - 층마다 PA·PB 단면(같은 task0LayerPolygonsBed). 겹침 우선순위 B > A: R_B = PB, **R_A = PA − PB** —
 *     다각형 연산 없이 행 구간 단위로(행 높이에서 A 의 nonzero 구간 − B 의 nonzero 구간, 같은 반열림 규칙), 채움·검사용
 *     마스크도 raster(PA) AND NOT raster(PB)(task0-mask rasterizeTask0Region). 넘침은 합집합 PA ∪ PB 기준(규격 §3).
 *     노광 PNG 는 PA ∪ PB 한 장(모든 메시 — 지금 마스크 경로 그대로, 이번 조각에서는 만들지 않는다).
 *     경계 여유 d·부스러기 제거(계획 §5-3)는 옵션 자리만 — 0(끔)만 받는다(데모 범위, 실험값 없음).
 *   - 층 안 순서 기본 A(T0) → B(T1)(규격 §6, order 'BA' 는 실험·대조군). 툴 패스마다 위 단일 경로와 같은 B안 행 +
 *     얇은 부분 채움을 **그 재료 영역에 대해** 한다. 행 위상(띠 원점)은 그 재료 단면 Pm 의 최소 Y.
 *     층 안 두 번째 패스는 채움이 없어도 task0-fill-route 로 낸다 — 앞 패스가 칠한 선분(paintedBefore)까지 교차 검사·
 *     엄격 판정(c4b 정의)·A* 우회(전환 트래블 포함). 두 번째 패스의 행·점은 띠 방향 쪽 끝이 막히면 반대 끝으로 들어간다
 *     (서펜타인 방향 고정을 2재료 패스에서만 푼다 — 단일 재료는 그대로).
 *   - 층 계획은 실제로 내기 전에 끝까지 세운다(패스마다 계획 → 도포 선분·끝 위치를 그대로 따라 그려 다음 패스 계획). 기본 계획이
 *     실패(경로 없는 항목, 또는 채움 뒤 커버리지 실패)면 그 층만 변형을 차례로 시도해 처음 성공한 조합을 쓴다(routeVariant):
 *       앞 패스를 경로 계획으로 다시(행도 양쪽 끝 허용) 세우되 마지막 항목 방향 뒤집기·첫 띠 방향 −X, 뒤 패스 첫 띠 방향 −X,
 *       그래도 안 되면 앞 패스 끝에서부터 항목 하나씩(4개까지) 방향 뒤집기.
 *     — 앞 패스가 채움 조각 이음점(띠 경계 자름점의 µm 꺾임 때문에 엄격 판정으로는 못 떠나는 점)이나 칠한 줄 사이 좁은 틈에서
 *       끝나 다음 툴로 못 넘어가는 경우(리뷰 실측 유형 ①)를 다른 끝으로 끝내게. 패스 안에서도(2재료 패스) 막힌 항목이 생기면
 *       task0-fill-route retryOnStuck 이 그 앞 항목 방향을 뒤집어 다시 계획한다.
 *     경로 계획으로 내는 2재료 패스(앞 패스가 칠했거나 변형 계획)는 E 가 1 눈금도 안 되는 행 구간(판정에 원래 안 세는 구간)을 내지
 *     않고, 얇은 부분 채움도 그 구간을 칠한 것으로 치지 않는다 — 채움 점과 몇 µm 사이로 겹쳐 노즐이 갇히던 끝점을 없앤다.
 *     어떤 조합도 안 되면 기본 계획 그대로 thinFill 'failed'(unreachable 로 셈)로 남긴다 — 쓰는 쪽이 totals.thinFillFailedLayers
 *     로 막는다(A 가 B 를 완전히 둘러싼 층 등). **교차를 성공으로 내지 않는다**(모든 트래블은 c4 + c4b 엄격 판정 통과).
 *   - 얇은 부분 채움의 점 도포는 다른 재료(뺄 단면) 픽셀 안으로 끝이 들어가지 않게 줄인다(task0-thin-fill — B 우선).
 *   - flipOrderWhenStuck(기본 끔): 변형으로도 막힌 층만 B → A 로 다시 계획(규격 §6 【미정】 "갇힌 층은 B → A" — 측정용).
 *   - 툴 상태: 리트랙트 여부를 **툴마다** 둔다. 모든 툴 리트랙트로 시작(§10), 층 블록 끝에 모든 툴 리트랙트, 툴별 E 순변화
 *     층마다 0. 툴 전환 = (지금 툴이 언리트랙트면 길이와 무관하게) E−r → `T1`(또는 `T0`) → 트래블 → E+r → 도포(§5 전환 순서).
 *     층 첫 패스의 툴이 직전 층 끝 툴과 다르면 층 머리(G1 Z) 다음에 T 줄 — 그때는 이미 모두 리트랙트라 E−r 없음.
 *     짧은 트래블 생략(§5 예외)은 같은 툴의 층 안 트래블에만 생긴다(전환 직후 첫 트래블은 새 툴이 리트랙트 상태라 자연히).
 *     T 줄은 툴이 실제로 바뀔 때만 — 한 재료만 있는 층은 그 툴만 쓰고, 층마다 T 줄 ≤ 2. 프리앰블 `G90 M83 T0` 는 그대로.
 *   - E 잔차 이월도 툴별(플런저가 따로) — 툴마다 |출력 누적 − 정확 누적| ≤ 0.5e-5.
 *   - START 앞 메타에 2재료 줄(슬롯·순서·툴 전환 수·툴별 도포 길이·E 합)을 더한다.
 *
 * 순수 TS — DOM/Node/Babylon 의존 없음(slice-geometry 순수 코어만 사용).
 */
import { checkTask0LayerCoverage, type Task0DepositSegment } from './task0-coverage';
import { routeTask0FillLayer, type Task0RouteResult } from './task0-fill-route';
import { TASK0_DEFAULTS, task0LayerCount, task0LayerZ } from './task0-frame';
import {
  TASK0_SLOT_TOOL,
  task0LayerPolygonsBed,
  task0SplitMeshesBySlot,
  type Task0BedPolygon,
  type Task0MaterialSlot,
} from './task0-slice';
import { findTask0ThinFills, type Task0ThinFillResult } from './task0-thin-fill';

// ==================== 타입 ====================

/** writer 선택 옵션 — 빠진 값은 TASK0_DEFAULTS (길이 mm, 속도 mm/s) */
export interface Task0WriterOptions {
  depositWidthMm?: number;
  syringeKMm3PerMm?: number;
  overfill?: number;
  retractMm?: number;
  retractMinTravelMm?: number;
  depositSpeedMmS?: number;
  travelSpeedMmS?: number;
  retractSpeedMmS?: number;
  bedWidthMm?: number;
  bedDepthMm?: number;
  parkXMm?: number;
  parkYMm?: number;
  /** 얇은 부분 채움 (기본 true). false 는 대조군·실험용 — 앱은 기본값만 쓴다 */
  thinFill?: boolean;
  /**
   * 채움 층 트래블 우회 (기본 true). false 는 대조군 전용 — 교차하는 트래블을 그대로 낸다
   * (2재료면 층 안 두 번째 툴 패스의 트래블·전환 트래블에도 같이 적용)
   */
  thinFillDetour?: boolean;
  /**
   * 층 진행 콜백 (Z2 — 앱 워커 진행률). 층 하나를 다 쓸 때마다 (끝낸 층 수, 전체 층 수) 로 부른다.
   * 출력 바이트·통계에는 영향이 없다(읽기만 하는 알림).
   */
  onLayerDone?: (done: number, total: number) => void;
  /**
   * 2재료 (D1a — 머리 주석 "2재료"). 없으면 단일 재료 경로(T0 하나 — 출력 바이트 그대로).
   * 앱은 아직 쓰지 않는다 — D1b 에서 파일별 재료 지정·manifest 2재료와 함께 붙인다.
   */
  dualMaterial?: Task0DualMaterialOptions;
}

/** 2재료 옵션 (D1a) */
export interface Task0DualMaterialOptions {
  /** 메시마다 재료 슬롯 (meshes 와 같은 길이). A = T0, B = T1 (규격 §6). 서포트는 A (계획 §5-2) — 호출자가 정한다 */
  slots: readonly Task0MaterialSlot[];
  /** 층 안 툴 순서 — 기본 'AB' (규격 §6 A(T0) → B(T1)). 'BA' 는 실험·대조군용(겹침 우선순위는 순서와 무관하게 B) */
  order?: 'AB' | 'BA';
  /** 겹침 우선순위 차집합 (기본 true — R_A = PA − PB). false 는 대조군 전용: 겹친 곳에 두 재료를 다 도포 */
  subtractOverlap?: boolean;
  /**
   * 툴별 리트랙트 상태 (기본 true). false 는 대조군 전용: 상태 하나를 두 툴이 같이 쓰고 T 전환 때 E−r 없이 이어 간다
   * (툴을 모르는 상태 기계 — 툴별 검사가 잡아야 한다)
   */
  perToolRetract?: boolean;
  /** 경계 여유 d (mm, 계획 §5-3) — 자리만. D1a 는 0 만 받는다(데모 범위, 실험값 없음) */
  boundaryInsetMm?: number;
  /** 부스러기 제거 최소 면적 (mm², 계획 §5-3) — 자리만. D1a 는 0(끔)만 받는다 */
  minFragmentAreaMm2?: number;
  /**
   * 기본 순서·변형 계획으로도 경로 없는 항목이 남는 층만 순서를 뒤집어(B → A) 다시 계획 (기본 false).
   * 규격 §6 【미정】 "B 가 A 안에 갇힌 층은 B → A" — Task0 판단 전이라 기본 끔, 켜면 얼마나 줄어드는지 측정용.
   */
  flipOrderWhenStuck?: boolean;
}

/** 기본값을 채우고 검사한 writer 설정 (F 는 mm/min 정수) */
export interface Task0WriterParams {
  depositWidthMm: number;
  syringeKMm3PerMm: number;
  overfill: number;
  retractMm: number;
  retractMinTravelMm: number;
  depositF: number;
  travelF: number;
  retractF: number;
  bedWidthMm: number;
  bedDepthMm: number;
  parkXMm: number;
  parkYMm: number;
}

/** 층별 통계 (Z2 시간 추정·Z1-b 커버리지용) — 길이 mm */
export interface Task0LayerStats {
  /** 0-based 층 번호 */
  index: number;
  /** 층 Z = (N+1)·lh */
  z: number;
  /** XY 이동이 없는 층(= Task0 빈 층 — 파킹·블레이드·LED 생략) */
  empty: boolean;
  /** 단면 폴리곤 수 (0 = 형상 없는 층) */
  polygons: number;
  /** 도포한 행 수 */
  rows: number;
  /** 도포 줄 수 */
  segments: number;
  /** 폭이 w 이하라 버린 구간 수 (Z1-b 에서 중심선·점 도포로 메울 대상) */
  narrowDropped: number;
  /**
   * 행 자리를 다 놓고 층 단면 맨 위(최대 Y)에 남는 띠 높이 (mm, 0 ≤ 값 < w, 1 µm 반올림) —
   * (최대 Y − 최소 Y) − 행 자리 수 × w. 층 전체 기준이라 섬마다 다른 나머지는 Z1-b 커버리지 검사가 맡는다
   */
  rowRemainderMm: number;
  /** 도포 길이 합 */
  depositMm: number;
  /** 트래블 길이 합 — 층 첫 트래블은 파킹 위치에서 잰다 */
  travelMm: number;
  /** E−r 줄 수 */
  retracts: number;
  /** E+r 줄 수 */
  unretracts: number;
  /** 이 층 도포 줄 E 의 출력값 합 (mm) */
  extrusionMm: number;
  /** 얇은 부분 채움 — none: 행만으로 커버리지 통과, filled: 채움으로 통과, failed: 채움 후에도 실패(파일 쓰면 안 됨) */
  thinFill: 'none' | 'filled' | 'failed';
  /** 띠로 자른 중심선 채움 조각 수 */
  fillPieces: number;
  /** 점 도포 수 */
  fillDots: number;
  /** 채움(중심선·점) 도포 줄 수 — 행 도포 줄이 아닌 것 */
  fillSegments: number;
  /** 우회 트래블 수 (X 먼저 L자 + A* — B안 직선·L자가 칠한 곳을 가로지를 때) */
  detourTravels: number;
  /** 경로가 없어 칠하지 못한 항목 수 (채움·2재료 두 번째 패스 — > 0 이면 thinFill 'failed') */
  unreachable: number;
  /**
   * (D2) 툴 패스별 경로 없는 항목 수 — byTool 과 같은 모양(단일 재료 [T0], 2재료 [T0, T1]), 합 = unreachable.
   * 쓰는 쪽(task0-export)이 실패 층 이유를 가른다(B 패스가 막힘 = 칠한 A 에 갇힌 B 등). 통계일 뿐 출력 바이트와 무관
   */
  unreachableByTool: number[];
  /** 이 층 블록의 T 줄 수 (= 툴 전환 수, 단일 재료 0) */
  toolChanges: number;
  /** 툴별 통계 — 단일 재료 [T0], 2재료 [T0, T1] */
  byTool: Task0ToolStats[];
  /** (2재료) 쓴 계획 변형 번호 — 0 = 기본 계획, 1 이상 = 기본이 막혀 바꾼 계획 (머리 주석 "층 계획") */
  routeVariant: number;
  /** (2재료) flipOrderWhenStuck 로 이 층만 B → A 로 냈는지 */
  orderFlipped: boolean;
}

/** 툴별 통계 (D1a) — 길이 mm */
export interface Task0ToolStats {
  /** 툴 번호 (T0 = 0, T1 = 1) */
  tool: number;
  segments: number;
  depositMm: number;
  /** 이 툴의 E−r 줄 수 (T 전환 직전 E−r 포함) */
  retracts: number;
  unretracts: number;
  extrusionMm: number;
}

export interface Task0GcodeTotals {
  layerCount: number;
  /** 빈 층 번호 (XY 이동 없음) */
  emptyLayers: number[];
  /** 단면은 있는데 도포가 0 인 층 — 마스크에 흰 픽셀이 있어도 Task0 가 노광을 생략한다(Z1-b 대상) */
  sectionWithoutDeposit: number[];
  depositMm: number;
  travelMm: number;
  retracts: number;
  unretracts: number;
  segments: number;
  narrowDropped: number;
  /** 층별 rowRemainderMm 의 최댓값 (mm) */
  rowRemainderMaxMm: number;
  /** 도포 E 출력값 합 (mm) */
  extrusionMm: number;
  /** 도포 E 정확 합 (mm) — extrusionMm 과의 차이 ≤ 0.5e-5 */
  extrusionExactMm: number;
  /** 채움이 들어간 층 번호 (thinFill 'filled') */
  thinFillLayers: number[];
  /** 채움 후에도 커버리지 실패이거나 경로 없는 항목이 남은 층 — 비어 있어야 파일을 쓴다 */
  thinFillFailedLayers: number[];
  fillPieces: number;
  fillDots: number;
  fillSegments: number;
  detourTravels: number;
  unreachable: number;
  /** 2재료 출력인지 (dualMaterial 옵션) */
  dualMaterial: boolean;
  /** 툴 전환 수 = 층 블록 안 T 줄 수 (프리앰블 T0 제외 — job.zip manifest toolChangeCount 와 같은 셈) */
  toolChanges: number;
  /** 툴별 합계 — 단일 재료 [T0], 2재료 [T0, T1] */
  byTool: Task0ToolStats[];
  /** (2재료) 기본 계획이 막혀 변형 계획을 쓴 층 */
  routeVariantLayers: number[];
  /** (2재료) 순서를 B → A 로 뒤집은 층 (flipOrderWhenStuck) */
  orderFlippedLayers: number[];
  /** 파일 줄 수 (끝 개행 기준) */
  lineCount: number;
  /** 출력한 XY 좌표 범위 (이동이 하나도 없으면 null) */
  xyBounds: { xMin: number; xMax: number; yMin: number; yMax: number } | null;
}

export interface Task0GcodeResult {
  gcode: string;
  layers: Task0LayerStats[];
  totals: Task0GcodeTotals;
  params: Task0WriterParams;
}

// ==================== 상수 ====================

/** 좌표 격자 (1 µm) — X/Y 소수 3자리 */
const UM_PER_MM = 1000;
/** E 단위 (1e-5 mm) — E 소수 5자리 */
const E_TICKS_PER_MM = 100000;
/** 행 반복 종료 여유 (계획서 S5) */
const ROW_EPS = 1e-9;
/** 맞닿은 구간 잇기 허용치 (mm) */
const SPAN_JOIN_EPS = 1e-9;
/** 트래블 리트랙트 판정 여유 (mm) — 1.0 mm 가 부동소수로 0.9999… 가 돼도 리트랙트 쪽으로 */
const TRAVEL_EPS = 1e-9;

/** START 앞 메타 첫 줄 — 리트랙트 규칙 판(spec)을 함께 적는다 (Z1-c: v0.3.4 첫 도포 앞 E+r) */
export const TASK0_WRITER_ID = 'MazicAlign v2 task0-gcode-writer (Z1-c, spec v0.3.4)';

// ==================== 설정 ====================

function positiveOr(name: string, value: number | undefined, fallback: number): number {
  const v = value === undefined ? fallback : value;
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} 는 양의 유한 수여야 함 (받은 값: ${String(v)})`);
  return v;
}

function finiteOr(name: string, value: number | undefined, fallback: number): number {
  const v = value === undefined ? fallback : value;
  if (!Number.isFinite(v)) throw new RangeError(`${name} 는 유한 수여야 함 (받은 값: ${String(v)})`);
  return v;
}

/** mm/s → F (mm/min 정수, 최소 1) */
function speedToF(name: string, value: number | undefined, fallback: number): number {
  return Math.max(1, Math.round(positiveOr(name, value, fallback) * 60));
}

/** 옵션에 기본값을 채우고 검사한다 — 검증 스크립트도 같은 값을 쓰도록 공개 */
export function resolveTask0WriterParams(options: Task0WriterOptions = {}): Task0WriterParams {
  const d = TASK0_DEFAULTS;
  const overfill = positiveOr('overfill', options.overfill, d.overfill);
  if (overfill > d.overfillMax) {
    throw new RangeError(`overfill 상한 ${d.overfillMax} 초과 (받은 값: ${overfill}) — 규격 §5`);
  }
  return {
    depositWidthMm: positiveOr('depositWidthMm', options.depositWidthMm, d.depositWidthMm),
    syringeKMm3PerMm: positiveOr('syringeKMm3PerMm', options.syringeKMm3PerMm, d.syringeKMm3PerMm),
    overfill,
    retractMm: positiveOr('retractMm', options.retractMm, d.retractMm),
    retractMinTravelMm: positiveOr('retractMinTravelMm', options.retractMinTravelMm, d.retractMinTravelMm),
    depositF: speedToF('depositSpeedMmS', options.depositSpeedMmS, d.depositSpeedMmS),
    travelF: speedToF('travelSpeedMmS', options.travelSpeedMmS, d.travelSpeedMmS),
    retractF: speedToF('retractSpeedMmS', options.retractSpeedMmS, d.retractSpeedMmS),
    bedWidthMm: positiveOr('bedWidthMm', options.bedWidthMm, d.bedWidthMm),
    bedDepthMm: positiveOr('bedDepthMm', options.bedDepthMm, d.bedDepthMm),
    parkXMm: finiteOr('parkXMm', options.parkXMm, d.parkXMm),
    parkYMm: finiteOr('parkYMm', options.parkYMm, d.parkYMm),
  };
}

// ==================== 숫자 표기 ====================

/** 정수 n 을 10^decimals 로 나눈 고정 소수 문자열 — 지수 표기·`-0` 이 나올 수 없다 */
function fixedFromInt(n: number, decimals: number): string {
  const neg = n < 0;
  const a = Math.abs(n);
  const scale = 10 ** decimals;
  const ip = Math.floor(a / scale);
  const fp = a - ip * scale;
  return (neg ? '-' : '') + String(ip) + '.' + String(fp).padStart(decimals, '0');
}

/** mm → 1 µm 격자 정수 */
function toUm(mm: number): number {
  const u = Math.round(mm * UM_PER_MM);
  return u === 0 ? 0 : u; // -0 정리
}

/** lh 를 정확히 나타내는 소수 자리 (최소 4, 최대 6) — Z·HEIGHT 표기용 */
function layerNumberDecimals(lh: number): number {
  for (let d = 4; d < 6; d++) {
    const s = lh * 10 ** d;
    if (Math.abs(s - Math.round(s)) < 1e-6) return d;
  }
  return 6;
}

/** 양수 고정 소수 후 끝 0 정리 ('0.3000' → '0.3', '10.0000' → '10') */
function trimmedFixed(v: number, decimals: number): string {
  let s = v.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

/** 메타 주석용 숫자 (소수 6자리 후 끝 0 정리) */
function metaNum(v: number): string {
  return trimmedFixed(v, 6);
}

// ==================== 단면 → 행 구간 ====================

/** 래스터라이저 Edge 와 같은 모양 — 베드 좌표 */
interface ScanEdge {
  yLo: number;
  yHi: number;
  xAtLo: number;
  dxPerY: number;
  /** 감김 부호 — 베드 Y 가 늘어나는 변이 +1 */
  dir: 1 | -1;
}

interface LayerSection {
  /** yLo 오름차순 */
  edges: ScanEdge[];
  yMin: number;
  yMax: number;
}

/** 단면 폴리곤(베드 좌표) → 변 목록 + Y 범위 */
function buildSection(polys: Task0BedPolygon[]): LayerSection {
  const edges: ScanEdge[] = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pts of polys) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a[1] < yMin) yMin = a[1];
      if (a[1] > yMax) yMax = a[1];
      if (a[1] === b[1]) continue; // 수평 변은 행 교차에 기여 없음 (래스터라이저와 같음)
      const rising = a[1] < b[1];
      const lo = rising ? a : b;
      const hi = rising ? b : a;
      edges.push({
        yLo: lo[1],
        yHi: hi[1],
        xAtLo: lo[0],
        dxPerY: (b[0] - a[0]) / (b[1] - a[1]),
        dir: rising ? 1 : -1,
      });
    }
  }
  edges.sort((p, q) => p.yLo - q.yLo);
  return { edges, yMin, yMax };
}

/** 한 행의 감김수 ≠ 0 구간 (x 오름차순, 맞닿은 구간은 이음). active 는 yLo ≤ y < yHi 인 변만 */
function nonzeroSpans(active: ScanEdge[], y: number): [number, number][] {
  const hits: { x: number; dir: 1 | -1 }[] = [];
  for (const e of active) hits.push({ x: e.xAtLo + e.dxPerY * (y - e.yLo), dir: e.dir });
  hits.sort((p, q) => p.x - q.x);

  const spans: [number, number][] = [];
  let winding = 0;
  let start = 0;
  for (const h of hits) {
    const before = winding;
    winding += h.dir;
    if (before === 0 && winding !== 0) {
      start = h.x;
    } else if (before !== 0 && winding === 0) {
      const last = spans.length > 0 ? spans[spans.length - 1] : null;
      if (last !== null && start - last[1] <= SPAN_JOIN_EPS) last[1] = h.x;
      else spans.push([start, h.x]);
    }
  }
  // 길이 0 구간(꼭짓점에서만 스치는 행)은 형상이 아니므로 조용히 뺀다
  return spans.filter(([s, e]) => e - s > SPAN_JOIN_EPS);
}

interface FillRow {
  /** 행 높이 (µm) */
  yUm: number;
  /** 행 자리 번호 k (y = 최소 Y + (k+0.5)·w) — 채움 층의 띠 번호와 같다 */
  slot: number;
  /** 도포 구간 [시작, 끝] (µm, 오름차순) */
  spans: [number, number][];
}

/**
 * 정렬된 구간 목록 a − b (둘 다 x 오름차순·서로 안 겹침, 반열림 [시작, 끝)) — 2재료 R_A = PA − PB 를 행 하나에서.
 * 길이 0 조각은 뺀다(nonzeroSpans 와 같은 허용치).
 */
function subtractSpans(a: [number, number][], b: [number, number][]): [number, number][] {
  if (b.length === 0) return a;
  const out: [number, number][] = [];
  let j = 0;
  for (const [s, e] of a) {
    while (j < b.length && b[j][1] <= s) j++;
    let cur = s;
    for (let k = j; k < b.length && b[k][0] < e; k++) {
      if (b[k][0] > cur) out.push([cur, b[k][0]]);
      if (b[k][1] > cur) cur = b[k][1];
      if (cur >= e) break;
    }
    if (cur < e) out.push([cur, e]);
  }
  return out.filter(([s, e]) => e - s > SPAN_JOIN_EPS);
}

/**
 * B안 행 목록 — 도포할 구간이 있는 행만, +Y 오름차순.
 * rowRemainderMm = 행 자리(slots 개)를 다 놓고 단면 맨 위에 남는 띠 높이 (형상 없는 층은 0)
 * exclude(2재료 D1a) = 행마다 빼는 단면 — 그 행 높이의 nonzero 구간을 w/2 줄이기 전에 뺀다(R_A = PA − PB).
 *   행 위상·종료 조건은 section(PA) 그대로.
 */
function fillRows(
  section: LayerSection,
  w: number,
  exclude: LayerSection | null = null,
): { rows: FillRow[]; narrowDropped: number; rowRemainderMm: number } {
  const rows: FillRow[] = [];
  let narrowDropped = 0;
  const half = w / 2;
  const { edges } = section;
  let next = 0;
  let active: ScanEdge[] = [];
  let slots = 0;
  for (; ; slots++) {
    const y = section.yMin + (slots + 0.5) * w;
    if (!(y < section.yMax - half + ROW_EPS)) break;
    while (next < edges.length && edges[next].yLo <= y) active.push(edges[next++]);
    active = active.filter((e) => y >= e.yLo && y < e.yHi);
    let raw = nonzeroSpans(active, y);
    if (exclude !== null) {
      raw = subtractSpans(raw, nonzeroSpans(exclude.edges.filter((e) => y >= e.yLo && y < e.yHi), y));
    }
    const spans: [number, number][] = [];
    for (const [s, e] of raw) {
      const a = toUm(s + half);
      const b = toUm(e - half);
      if (b > a) spans.push([a, b]);
      else narrowDropped++;
    }
    if (spans.length > 0) rows.push({ yUm: toUm(y), slot: slots, spans });
  }
  const rowRemainderMm = Number.isFinite(section.yMin)
    ? Math.max(0, toUm(section.yMax - section.yMin - slots * w)) / UM_PER_MM
    : 0;
  return { rows, narrowDropped, rowRemainderMm };
}

// ==================== 얇은 부분 채움 (Z1-b2) · 툴 패스 계획 ====================

/** 우회 격자 범위 = 단면 bbox + 이 여유 (mm) — 형상 바깥을 돌아갈 자리. 출력 가능 영역으로 자른다 */
const DETOUR_REGION_MARGIN_MM = 1.5;

/**
 * 정확 E 가 1 눈금(1e-5 mm) 이상인 도포 선분만 — 잔차 이월이라 그보다 짧은 줄은 출력 E 가 0 일 수 있고,
 * 커버리지 검사기는 G-code 에서 E 증가 > 0 인 줄만 도포로 본다. 그래서 writer 안의 검사는 이런 줄을 빼고(보수적)
 * 판정한다 — 빼고 통과하면 실제 출력(그 줄이 E 1 눈금으로 나와도)도 통과한다(도포가 늘면 (a)(b)(c)(d) 는 나빠지지 않고,
 * 행 구간은 단면 안이라 넘침도 그대로).
 */
function countedSegments(segs: readonly Task0DepositSegment[], eRatePerMm: number): Task0DepositSegment[] {
  return segs.filter((s) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0) * eRatePerMm * E_TICKS_PER_MM >= 1);
}

/** 행 → 검사기 도포 선분 (1 µm 격자 좌표 그대로 — G-code 를 다시 읽은 값과 같은 double) */
function rowSegments(rows: FillRow[]): Task0DepositSegment[] {
  const out: Task0DepositSegment[] = [];
  for (const row of rows) {
    const y = row.yUm / UM_PER_MM;
    for (const [a, b] of row.spans) out.push({ x0: a / UM_PER_MM, y0: y, x1: b / UM_PER_MM, y1: y, e: 1, tool: 0 });
  }
  return out;
}

/** 툴 패스 하나의 계획 — route 가 있으면 그 순서로, 없으면 B안 행 그대로 낸다 */
interface PassPlan {
  status: 'none' | 'filled' | 'failed';
  /** 낼 순서 (null = B안 행 그대로) */
  route: Task0RouteResult | null;
}

/** 층 안 툴 패스 — 단일 재료는 [모든 메시 T0] 하나, 2재료는 [A(T0), B(T1)] (순서 옵션) */
interface LayerPass {
  tool: number;
  /** 이 재료 단면 Pm */
  polys: Task0BedPolygon[];
  /** 재료 영역에서 뺄 단면 (2재료 A = PB) — 없으면 [] */
  exclude: Task0BedPolygon[];
  /** 넘침 기준 단면 (2재료 = PA ∪ PB) — null 이면 흰 영역 그대로 */
  overflow: Task0BedPolygon[] | null;
  /** 우회 격자 범위를 잡을 단면 (단일 = polys, 2재료 = 합집합) */
  regionPolys: Task0BedPolygon[];
  section: LayerSection;
  rows: FillRow[];
  narrowDropped: number;
  rowRemainderMm: number;
}

/**
 * 툴 패스 하나의 계획 — 행만으로 커버리지를 통과하고 앞 패스가 칠한 것도 없으면 null(B안 행 그대로).
 * 통과 못 하면 채움을 만들고(task0-thin-fill) 순서·트래블을 정한 뒤(task0-fill-route), 낼 도포 선분 그대로 다시 검사한다.
 * paintedBefore 가 있으면(2재료 두 번째 패스) 채움이 없어도 task0-fill-route 로 — 전환 트래블·패스 안 트래블이 앞 툴이
 * 칠한 곳을 피하게(교차 검사·우회). 경로 없는 항목이 있으면 'failed'.
 */
function planPass(
  pass: LayerPass,
  startUm: [number, number],
  paintedBefore: Task0DepositSegment[],
  w: number,
  eRatePerMm: number,
  thinFillOn: boolean,
  detour: boolean,
  variant: PassVariant | null = null,
  dualPass = false,
): PassPlan | null {
  const { polys, section, rows } = pass;
  if (polys.length === 0) return null; // 이 재료 단면이 없는 층 (행도 없다)
  const exclude = pass.exclude.length > 0 ? pass.exclude : undefined;
  const overflow = pass.overflow ?? undefined;
  // 앞 패스가 칠한 것이 있거나 변형 계획이면 행만이어도 경로 계획 (2재료 전용 — 단일 재료는 둘 다 없음)
  const mustRoute = paintedBefore.length > 0 || variant !== null;
  let fills: Task0ThinFillResult | null = null;
  if (thinFillOn) {
    const all = rowSegments(rows);
    const counted = countedSegments(all, eRatePerMm);
    const found = findTask0ThinFills(
      polys,
      counted,
      { depositWidthMm: w, eRatePerMm, bandOriginMm: section.yMin, excludePolygonsBed: exclude, overflowPolygonsBed: overflow },
      // 2재료 경로 계획은 판정에 안 세는 아주 짧은 행 구간을 내지 않으므로(아래 routeRows) 칠한 것으로 빼지도 않는다
      mustRoute ? [] : all.filter((sg) => !counted.includes(sg)),
    );
    if (!(found.iterations === 0 && found.pass)) fills = found;
  }
  if (fills === null && !mustRoute) return null;
  if (fills !== null && !mustRoute && fills.centerlines.length === 0 && fills.dots.length === 0) {
    return { status: 'failed', route: null };
  }

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const pts of pass.regionPolys) {
    for (const [x, y] of pts) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  const d = TASK0_DEFAULTS;
  const m = DETOUR_REGION_MARGIN_MM;
  // 2재료 경로 계획(mustRoute)에서는 E 가 1 눈금도 안 되는 아주 짧은 행 구간을 뺀다 — 판정에 원래 안 세는 구간이라 커버리지는
  //   그대로이고(위 countedSegments), 채움 점 도포와 몇 µm 사이로 겹쳐 노즐이 갇히는 끝점(엄격 판정으로 못 떠남)을 없앤다.
  //   단일 재료(mustRoute 아님)는 예전 그대로 낸다.
  const routeRows = mustRoute
    ? rows
        .map((row) => ({ ...row, spans: row.spans.filter(([a, b]) => ((b - a) / UM_PER_MM) * eRatePerMm * E_TICKS_PER_MM >= 1) }))
        .filter((row) => row.spans.length > 0)
    : rows;
  const route = routeTask0FillLayer({
    rows: routeRows,
    centerlines: fills?.centerlines ?? [],
    dots: fills?.dots ?? [],
    bandOriginMm: section.yMin,
    depositWidthMm: w,
    regionMm: {
      xMin: Math.max(d.printableXMinMm, xMin - m),
      xMax: Math.min(d.printableXMaxMm, xMax + m),
      yMin: Math.max(d.printableYMinMm, yMin - m),
      yMax: Math.min(d.printableYMaxMm, yMax + m),
    },
    startUm,
    detour,
    paintedBefore,
    // 2재료 패스(앞 패스가 칠했거나 변형 계획)만 — 행·점도 막히면 반대 끝으로, 변형이면 첫 띠 방향·마지막 항목 방향
    rowsEitherWay: mustRoute ? true : undefined,
    firstBandDir: variant?.firstBandDir,
    reverseLastItem: variant?.reverseLastItem,
    flipItems: variant?.flipItems,
    // 2재료 패스만 — 막힌 항목이 생기면 앞 항목 방향을 뒤집어 다시 (통과하는 계획은 그대로)
    retryOnStuck: dualPass ? true : undefined,
  });
  if (fills === null) return { status: route.unreachable === 0 ? 'none' : 'failed', route };
  const final = checkTask0LayerCoverage(polys, countedSegments(route.painted, eRatePerMm), {
    depositWidthMm: w,
    excludePolygonsBed: exclude,
    overflowPolygonsBed: overflow,
  });
  const ok = fills.pass && final.pass && route.unreachable === 0;
  return { status: ok ? 'filled' : 'failed', route };
}

/** 층 thinFill 합치기 — failed > filled > none */
function worseFill(a: PassPlan['status'], b: PassPlan['status']): PassPlan['status'] {
  if (a === 'failed' || b === 'failed') return 'failed';
  return a === 'filled' || b === 'filled' ? 'filled' : 'none';
}

/** 경로 계획 변형 (2재료 — 기본 계획이 막힌 층에서만) */
interface PassVariant {
  firstBandDir: 1 | -1;
  reverseLastItem: boolean;
  /** 방향을 뒤집을 항목 번호 (task0-fill-route emittedSeqs) */
  flipItems?: readonly number[];
}

/** 앞 패스(층에서 처음 도포하는 패스) 변형 — null = 기본(단일 재료와 같은 계획) */
const FIRST_PASS_VARIANTS: readonly (PassVariant | null)[] = [
  null,
  { firstBandDir: 1, reverseLastItem: true },
  { firstBandDir: -1, reverseLastItem: false },
  { firstBandDir: -1, reverseLastItem: true },
];
/** 앞 패스 끝 항목 뒤집어 보기 — 끝에서 몇 개까지 */
const FLIP_BACK_MAX = 4;
/** 끝 항목 뒤집기의 바탕 변형 (경로 계획, 첫 띠 +X, 마지막 항목 그대로) — 항목 번호도 이 모드의 계획에서 잡는다 */
const FLIP_PROBE: PassVariant = { firstBandDir: 1, reverseLastItem: false };
/** 뒤 패스 변형 — null = 기본(첫 띠 +X) */
const LATER_PASS_VARIANTS: readonly (PassVariant | null)[] = [null, { firstBandDir: -1, reverseLastItem: false }];

/**
 * 패스 계획을 내보낼 때와 똑같이 따라 그린 도포 선분(mm)과 끝 위치(µm) — 다음 패스 계획의 paintedBefore·시작점.
 * 실제 출력(travel/deposit)과 같은 µm 점이라 같은 선분이 된다.
 */
function tracePass(pass: LayerPass, plan: PassPlan | null, startUm: [number, number]): { segs: Task0DepositSegment[]; end: [number, number] } {
  const segs: Task0DepositSegment[] = [];
  let [x, y] = startUm;
  const dep = (nx: number, ny: number): void => {
    segs.push({ x0: x / UM_PER_MM, y0: y / UM_PER_MM, x1: nx / UM_PER_MM, y1: ny / UM_PER_MM, e: 1, tool: pass.tool });
    x = nx;
    y = ny;
  };
  if (plan !== null && plan.route !== null) {
    for (const step of plan.route.steps) {
      if (step.travel.length > 0) [x, y] = step.travel[step.travel.length - 1];
      for (const [px, py] of step.deposit) dep(px, py);
    }
  } else {
    pass.rows.forEach((row, rowIdx) => {
      const forward = rowIdx % 2 === 0;
      const spans = forward ? row.spans : [...row.spans].reverse();
      for (const [a, b] of spans) {
        x = forward ? a : b;
        y = row.yUm;
        dep(forward ? b : a, row.yUm);
      }
    });
  }
  return { segs, end: [x, y] };
}

/** 층 계획 하나 — 패스마다 계획 (순서대로) */
interface LayerPlan {
  passes: LayerPass[];
  plans: (PassPlan | null)[];
  /** 경로 없는 항목 수 합 */
  unreachable: number;
  /** 'failed' 인 패스가 있는지 */
  failed: boolean;
}

/**
 * 순서대로 패스를 계획 — 처음 도포하는 패스는 first 변형, 그 뒤 패스는 later 변형(앞 패스가 칠한 선분·끝 위치를 받아).
 */
function planLayer(
  passes: LayerPass[],
  parkUm: [number, number],
  first: PassVariant | null,
  later: PassVariant | null,
  w: number,
  eRatePerMm: number,
  thinFillOn: boolean,
  detour: boolean,
  dualPass: boolean,
): LayerPlan {
  const plans: (PassPlan | null)[] = [];
  const painted: Task0DepositSegment[] = [];
  let pos = parkUm;
  let unreachable = 0;
  let failed = false;
  for (const pass of passes) {
    const plan = planPass(pass, pos, painted.slice(), w, eRatePerMm, thinFillOn, detour, painted.length === 0 ? first : later, dualPass);
    plans.push(plan);
    if (plan !== null) {
      unreachable += plan.route?.unreachable ?? 0;
      if (plan.status === 'failed') failed = true;
    }
    const traced = tracePass(pass, plan, pos);
    if (traced.segs.length > 0) {
      painted.push(...traced.segs);
      pos = traced.end;
    }
  }
  return { passes, plans, unreachable, failed };
}

// ==================== 2재료 설정 (D1a) ====================

interface ResolvedDual {
  meshes: Record<Task0MaterialSlot, Float32Array[]>;
  order: 'AB' | 'BA';
  subtractOverlap: boolean;
  perToolRetract: boolean;
  flipOrderWhenStuck: boolean;
}

/** dualMaterial 옵션 검사 — 없으면 null(단일 재료) */
function resolveDualMaterial(
  opt: Task0DualMaterialOptions | undefined,
  meshes: readonly Float32Array[],
): ResolvedDual | null {
  if (opt === undefined) return null;
  const split = task0SplitMeshesBySlot(meshes, opt.slots);
  const order = opt.order ?? 'AB';
  if (order !== 'AB' && order !== 'BA') throw new RangeError(`dualMaterial.order 는 'AB' 또는 'BA' (받은 값: ${String(order)})`);
  const placeholders: [string, number | undefined][] = [
    ['boundaryInsetMm', opt.boundaryInsetMm],
    ['minFragmentAreaMm2', opt.minFragmentAreaMm2],
  ];
  for (const [name, v] of placeholders) {
    if (v !== undefined && v !== 0) {
      throw new RangeError(`dualMaterial.${name} 는 D1a 에서 0 만 받는다 — 자리만 둔 옵션(계획 §5-3, 실험값 없음) (받은 값: ${String(v)})`);
    }
  }
  return {
    meshes: split,
    order,
    subtractOverlap: opt.subtractOverlap ?? true,
    perToolRetract: opt.perToolRetract ?? true,
    flipOrderWhenStuck: opt.flipOrderWhenStuck ?? false,
  };
}

// ==================== 본체 ====================

/**
 * world 삼각형 → Task0 G-code (B안 줄 채움).
 * @param meshes 메시별 world 삼각형 (삼각형당 9 float, 감김 통일 — extractWorldTriangles 결과). 읽기만 한다.
 *   2재료(options.dualMaterial)면 slots 로 메시마다 재료를 나눈다 — 노광 마스크는 여전히 이 meshes 전부(PA ∪ PB).
 * @param topY 서포트 포함 최고점 (mm, 플레이트 0 기준) — 층 수 = task0LayerCount(topY, lh)
 * @param layerHeightMm 층두께 lh (mm)
 */
export function generateTask0Gcode(
  meshes: readonly Float32Array[],
  topY: number,
  layerHeightMm: number,
  options: Task0WriterOptions = {},
): Task0GcodeResult {
  if (!Number.isFinite(layerHeightMm) || layerHeightMm <= 0) {
    throw new RangeError(`layerHeightMm 는 양의 유한 수여야 함 (받은 값: ${String(layerHeightMm)})`);
  }
  if (!Number.isFinite(topY)) throw new RangeError(`topY 는 유한 수여야 함 (받은 값: ${String(topY)})`);
  const params = resolveTask0WriterParams(options);
  const dual = resolveDualMaterial(options.dualMaterial, meshes);
  const lh = layerHeightMm;
  const w = params.depositWidthMm;
  const eRatePerMm = (w * lh * params.overfill) / params.syringeKMm3PerMm;
  const retractTicks = Math.max(1, Math.round(params.retractMm * E_TICKS_PER_MM));
  const retractLine = `G1 E${fixedFromInt(-retractTicks, 5)} F${params.retractF}`;
  const unretractLine = `G1 E${fixedFromInt(retractTicks, 5)} F${params.retractF}`;
  const parkXUm = toUm(params.parkXMm);
  const parkYUm = toUm(params.parkYMm);
  const thinFillOn = options.thinFill ?? true;
  const detourOn = options.thinFillDetour ?? true;

  const layerCount = task0LayerCount(topY, lh);
  const zDecimals = layerNumberDecimals(lh);
  const heightText = trimmedFixed(lh, zDecimals);

  const body: string[] = ['; EXECUTABLE_BLOCK_START', 'G90', 'M83', 'T0'];
  const layers: Task0LayerStats[] = [];
  const toolCount = dual === null ? 1 : 2;

  // 툴별 리트랙트 상태 — 시작은 모든 툴 리트랙트 (v0.3.4 §10: Task0 가 프라이밍 후 E−r 까지 하고 넘김).
  // perToolRetract=false(대조군 전용)면 두 툴이 상태 하나(칸 0)를 같이 쓴다.
  const retracted: boolean[] = new Array<boolean>(toolCount).fill(true);
  const stateOf = (t: number): number => (dual !== null && !dual.perToolRetract ? 0 : t);
  let tool = 0; // 지금 툴 — 프리앰블 T0
  const eExact: number[] = new Array<number>(toolCount).fill(0); // 툴별 도포 E 정확 누적
  const eTicks: number[] = new Array<number>(toolCount).fill(0); // 툴별 도포 E 출력 누적 (1e-5 단위)

  let bxMin = Infinity;
  let bxMax = -Infinity;
  let byMin = Infinity;
  let byMax = -Infinity;
  const touch = (xu: number, yu: number): void => {
    if (xu < bxMin) bxMin = xu;
    if (xu > bxMax) bxMax = xu;
    if (yu < byMin) byMin = yu;
    if (yu > byMax) byMax = yu;
  };

  for (let n = 0; n < layerCount; n++) {
    const z = task0LayerZ(n, lh);
    const zText = trimmedFixed(z, zDecimals);
    body.push(';LAYER_CHANGE', `;Z:${zText}`, `;HEIGHT:${heightText}`, `G1 Z${zText}`);

    // 1) 단면·행 — 마스크와 같은 절차 (메시마다 자르고 잇기, task0-slice 공유 함수). 툴 패스마다 따로
    let passes: LayerPass[];
    let polygonCount: number;
    if (dual === null) {
      const polys = task0LayerPolygonsBed(meshes, n, lh, params.bedWidthMm, params.bedDepthMm);
      const section = buildSection(polys);
      passes = [{ tool: 0, polys, exclude: [], overflow: null, regionPolys: polys, section, ...fillRows(section, w) }];
      polygonCount = polys.length;
    } else {
      // 2재료 — R_B = PB, R_A = PA − PB (B 우선, 행 구간 차집합). 넘침·우회 범위는 합집합
      const pa = task0LayerPolygonsBed(dual.meshes.A, n, lh, params.bedWidthMm, params.bedDepthMm);
      const pb = task0LayerPolygonsBed(dual.meshes.B, n, lh, params.bedWidthMm, params.bedDepthMm);
      const union = pa.concat(pb);
      const secA = buildSection(pa);
      const secB = buildSection(pb);
      const passA: LayerPass = {
        tool: TASK0_SLOT_TOOL.A,
        polys: pa,
        exclude: dual.subtractOverlap ? pb : [],
        overflow: union,
        regionPolys: union,
        section: secA,
        ...fillRows(secA, w, dual.subtractOverlap ? secB : null),
      };
      const passB: LayerPass = {
        tool: TASK0_SLOT_TOOL.B,
        polys: pb,
        exclude: [],
        overflow: union,
        regionPolys: union,
        section: secB,
        ...fillRows(secB, w),
      };
      passes = dual.order === 'AB' ? [passA, passB] : [passB, passA];
      polygonCount = union.length;
    }

    const byTool: Task0ToolStats[] = [];
    for (let t = 0; t < toolCount; t++) {
      byTool.push({ tool: t, segments: 0, depositMm: 0, retracts: 0, unretracts: 0, extrusionMm: 0 });
    }
    const stat: Task0LayerStats = {
      index: n,
      z,
      empty: true,
      polygons: polygonCount,
      rows: passes.reduce((acc, ps) => acc + ps.rows.length, 0),
      segments: 0,
      narrowDropped: passes.reduce((acc, ps) => acc + ps.narrowDropped, 0),
      rowRemainderMm: passes.reduce((acc, ps) => Math.max(acc, ps.rowRemainderMm), 0),
      depositMm: 0,
      travelMm: 0,
      retracts: 0,
      unretracts: 0,
      extrusionMm: 0,
      thinFill: 'none',
      fillPieces: 0,
      fillDots: 0,
      fillSegments: 0,
      detourTravels: 0,
      unreachable: 0,
      unreachableByTool: new Array<number>(toolCount).fill(0),
      toolChanges: 0,
      byTool,
      routeVariant: 0,
      orderFlipped: false,
    };

    // 2) 경로 — Task0 가 층 사이에 파킹하므로 층 시작 위치 = 파킹 (통계용)
    let posX = parkXUm;
    let posY = parkYUm;
    const layerTicks: number[] = new Array<number>(toolCount).fill(0);

    /** 트래블 (목표점들을 차례로 직선) — 길이 0 다리는 버림, 합계로 리트랙트 판정 (같은 툴의 층 안 트래블) */
    const travel = (targets: [number, number][]): void => {
      const legs: [number, number][] = [];
      let lenMm = 0;
      let cx = posX;
      let cy = posY;
      for (const [x, y] of targets) {
        if (x === cx && y === cy) continue;
        lenMm += Math.hypot(x - cx, y - cy) / UM_PER_MM;
        legs.push([x, y]);
        cx = x;
        cy = y;
      }
      if (legs.length === 0) return;
      const st = stateOf(tool);
      if (!retracted[st] && lenMm >= params.retractMinTravelMm - TRAVEL_EPS) {
        body.push(retractLine);
        retracted[st] = true;
        stat.retracts++;
        byTool[tool].retracts++;
      }
      for (const [x, y] of legs) {
        body.push(`G1 X${fixedFromInt(x, 3)} Y${fixedFromInt(y, 3)} F${params.travelF}`);
        touch(x, y);
      }
      stat.travelMm += lenMm;
      posX = cx;
      posY = cy;
    };

    /** 도포 한 줄 (현재 위치 → 목표) — 지금 툴 */
    const deposit = (x: number, y: number): void => {
      const st = stateOf(tool);
      if (retracted[st]) {
        body.push(unretractLine);
        retracted[st] = false;
        stat.unretracts++;
        byTool[tool].unretracts++;
      }
      const lenMm = Math.hypot(x - posX, y - posY) / UM_PER_MM;
      eExact[tool] += lenMm * eRatePerMm;
      const t = Math.round(eExact[tool] * E_TICKS_PER_MM);
      const dt = t - eTicks[tool]; // 잔차 이월 — 툴별 누적 반올림의 차분 (항상 ≥ 0)
      eTicks[tool] = t;
      layerTicks[tool] += dt;
      body.push(`G1 X${fixedFromInt(x, 3)} Y${fixedFromInt(y, 3)} E${fixedFromInt(dt, 5)} F${params.depositF}`);
      touch(x, y);
      stat.segments++;
      stat.depositMm += lenMm;
      byTool[tool].segments++;
      byTool[tool].depositMm += lenMm;
      posX = x;
      posY = y;
    };

    // 1-b) 층 계획 — 패스마다 얇은 부분 채움·경로(단일 재료는 패스 하나, 기본 계획만 = 예전 그대로).
    //      2재료에서 기본 계획에 경로 없는 항목이 있으면 변형을 차례로 시도 (머리 주석 "층 계획")
    const park: [number, number] = [parkXUm, parkYUm];
    const planOf = (seq: LayerPass[], first: PassVariant | null, later: PassVariant | null): LayerPlan =>
      planLayer(seq, park, first, later, w, eRatePerMm, thinFillOn, detourOn, dual !== null);
    let chosen = planOf(passes, null, null);
    const ok = (pl: LayerPlan): boolean => pl.unreachable === 0 && !pl.failed;
    if (dual !== null && !ok(chosen)) {
      const search = (seq: LayerPass[]): { plan: LayerPlan; index: number } | null => {
        let index = 0;
        for (const first of FIRST_PASS_VARIANTS) {
          for (const later of LATER_PASS_VARIANTS) {
            if (index++ === 0) continue; // 기본 (위에서 이미)
            const cand = planOf(seq, first, later);
            if (ok(cand)) return { plan: cand, index: index - 1 };
          }
        }
        // 앞 패스 마지막 항목들(끝에서 FLIP_BACK_MAX 개까지)을 하나씩 뒤집어 — 앞 패스가 끝난 자리를 바꿔 다음 패스로 떠날 수
        //   있게 (앞 패스 끝이 칠한 줄 사이 좁은 틈에 갇힌 경우). 항목 번호는 뒤집기와 **같은 변형 모드**(경로 계획, 1 눈금 미만
        //   행 구간 뺌)로 세운 앞 패스 자신의 emittedSeqs 에서 잡는다 — 기본 계획(B안 행이면 경로 계획이 아예 없고, 있어도 행 구간
        //   구성이 달라 번호가 어긋난다)이나 다른 패스의 번호를 쓰지 않는다. 이 탐침 계획 자체는 후보로 쓰지 않는다.
        const probe = planOf(seq, FLIP_PROBE, null);
        let route: Task0RouteResult | null = null;
        for (let i = 0; i < seq.length; i++) {
          const pl = probe.plans[i];
          if (tracePass(seq[i], pl, park).segs.length === 0) continue; // 도포 없는 패스는 건너뜀 (변형은 처음 도포하는 패스에)
          route = pl?.route ?? null;
          break;
        }
        if (route !== null) {
          const emitted = route.emittedSeqs;
          for (let k = 1; k <= FLIP_BACK_MAX && k <= emitted.length; k++) {
            for (const later of LATER_PASS_VARIANTS) {
              index++;
              const cand = planOf(seq, { ...FLIP_PROBE, flipItems: [emitted[emitted.length - k]] }, later);
              if (ok(cand)) return { plan: cand, index: index - 1 };
            }
          }
        }
        return null;
      };
      const found = search(passes);
      if (found !== null) {
        chosen = found.plan;
        stat.routeVariant = found.index;
      } else if (dual.flipOrderWhenStuck) {
        const flippedSeq = [...passes].reverse();
        const base = planOf(flippedSeq, null, null);
        const alt = ok(base) ? { plan: base, index: 0 } : search(flippedSeq);
        if (alt !== null) {
          chosen = alt.plan;
          stat.routeVariant = alt.index;
          stat.orderFlipped = true;
        }
      }
    }

    for (let pi = 0; pi < chosen.passes.length; pi++) {
      const pass = chosen.passes[pi];
      const plan = chosen.plans[pi];
      if (plan !== null) {
        stat.thinFill = worseFill(stat.thinFill, plan.status);
        stat.fillPieces += plan.route?.fillPieces ?? 0;
        stat.fillDots += plan.route?.dots ?? 0;
        stat.detourTravels += plan.route?.detourTravels ?? 0;
        stat.unreachable += plan.route?.unreachable ?? 0;
        stat.unreachableByTool[pass.tool] += plan.route?.unreachable ?? 0;
      }
      const willDeposit = plan !== null && plan.route !== null ? plan.route.steps.length > 0 : pass.rows.length > 0;
      if (!willDeposit) continue;
      if (tool !== pass.tool) {
        // 툴 전환 (규격 §5·§6) — E−r(지금 툴이 언리트랙트면 길이와 무관) → T → 트래블 → E+r → 도포.
        // 층 첫 패스면 이미 모든 툴 리트랙트라 T 줄만. perToolRetract=false(대조군)는 E−r 없이 상태를 이어 간다.
        if (dual !== null && dual.perToolRetract && !retracted[stateOf(tool)]) {
          body.push(retractLine);
          retracted[stateOf(tool)] = true;
          stat.retracts++;
          byTool[tool].retracts++;
        }
        body.push(`T${pass.tool}`);
        tool = pass.tool;
        stat.toolChanges++;
      }

      if (plan !== null && plan.route !== null) {
        // 채움 층·두 번째 툴 패스 — 띠 순서·트래블은 task0-fill-route 가 정했다 (층 첫 트래블은 파킹에서 직선)
        for (const step of plan.route.steps) {
          if (step.travel.length > 0) travel(step.travel);
          for (const [x, y] of step.deposit) {
            deposit(x, y);
            if (step.kind !== 'row') stat.fillSegments++;
          }
        }
      } else {
        let firstMove = true;
        pass.rows.forEach((row, rowIdx) => {
          const forward = rowIdx % 2 === 0; // 서펜타인: 도포한 첫 행 +X
          const spans = forward ? row.spans : [...row.spans].reverse();
          spans.forEach(([a, b], spanIdx) => {
            const sx = forward ? a : b;
            const ex = forward ? b : a;
            if (firstMove) travel([[sx, row.yUm]]); // 층 첫 트래블 = 직선
            else if (spanIdx === 0) travel([[posX, row.yUm], [sx, row.yUm]]); // 행 사이 L자 (Y 먼저)
            else travel([[sx, row.yUm]]); // 같은 행 안 — 행 선을 따라
            firstMove = false;
            deposit(ex, row.yUm);
          });
        });
      }
    }

    // 3) 층 끝 — 도포했으면 항상 리트랙트 (§5). 마지막 줄이 지금 툴의 도포라 지금 툴만 언리트랙트 상태이고
    //    (앞 툴은 전환 때 리트랙트), 도포 안 한 층은 이미 모든 툴 리트랙트 → 툴마다 층마다 E+r 수 = E−r 수
    if (stat.segments > 0) {
      body.push(retractLine);
      retracted[stateOf(tool)] = true;
      stat.retracts++;
      byTool[tool].retracts++;
      stat.empty = false;
    }
    let ticks = 0;
    for (let t = 0; t < toolCount; t++) {
      byTool[t].extrusionMm = layerTicks[t] / E_TICKS_PER_MM;
      ticks += layerTicks[t];
    }
    stat.extrusionMm = ticks / E_TICKS_PER_MM;
    layers.push(stat);
    options.onLayerDone?.(n + 1, layerCount);
  }

  const sumOf = (pick: (s: Task0LayerStats) => number): number => layers.reduce((acc, s) => acc + pick(s), 0);
  let eTicksAll = 0;
  let eExactAll = 0;
  const byToolTotal: Task0ToolStats[] = [];
  for (let t = 0; t < toolCount; t++) {
    eTicksAll += eTicks[t];
    eExactAll += eExact[t];
    byToolTotal.push({
      tool: t,
      segments: sumOf((s) => s.byTool[t].segments),
      depositMm: sumOf((s) => s.byTool[t].depositMm),
      retracts: sumOf((s) => s.byTool[t].retracts),
      unretracts: sumOf((s) => s.byTool[t].unretracts),
      extrusionMm: eTicks[t] / E_TICKS_PER_MM,
    });
  }
  const totals: Task0GcodeTotals = {
    layerCount,
    emptyLayers: layers.filter((s) => s.empty).map((s) => s.index),
    sectionWithoutDeposit: layers.filter((s) => s.empty && s.polygons > 0).map((s) => s.index),
    depositMm: sumOf((s) => s.depositMm),
    travelMm: sumOf((s) => s.travelMm),
    retracts: sumOf((s) => s.retracts),
    unretracts: sumOf((s) => s.unretracts),
    segments: sumOf((s) => s.segments),
    narrowDropped: sumOf((s) => s.narrowDropped),
    rowRemainderMaxMm: layers.reduce((acc, s) => Math.max(acc, s.rowRemainderMm), 0),
    thinFillLayers: layers.filter((s) => s.thinFill === 'filled').map((s) => s.index),
    thinFillFailedLayers: layers.filter((s) => s.thinFill === 'failed').map((s) => s.index),
    fillPieces: sumOf((s) => s.fillPieces),
    fillDots: sumOf((s) => s.fillDots),
    fillSegments: sumOf((s) => s.fillSegments),
    detourTravels: sumOf((s) => s.detourTravels),
    unreachable: sumOf((s) => s.unreachable),
    dualMaterial: dual !== null,
    toolChanges: sumOf((s) => s.toolChanges),
    byTool: byToolTotal,
    routeVariantLayers: layers.filter((s) => s.routeVariant > 0).map((s) => s.index),
    orderFlippedLayers: layers.filter((s) => s.orderFlipped).map((s) => s.index),
    extrusionMm: eTicksAll / E_TICKS_PER_MM,
    extrusionExactMm: eExactAll,
    lineCount: 0,
    xyBounds:
      bxMin === Infinity
        ? null
        : { xMin: bxMin / UM_PER_MM, xMax: bxMax / UM_PER_MM, yMin: byMin / UM_PER_MM, yMax: byMax / UM_PER_MM },
  };

  // START 앞 메타 — 단독 주석 줄 (Task0 는 START 이전을 무시)
  const header: string[] = [
    `; ${TASK0_WRITER_ID}`,
    '; Task0 G-code spec v0.3.4 (B pattern: serpentine 0 deg row fill, L moves between rows)',
    `; layerCount: ${layerCount}`,
    `; layerHeightMm: ${heightText}`,
    `; topYMm: ${metaNum(topY)}`,
    `; depositWidthMm: ${metaNum(w)}`,
    `; syringeKMm3PerMm: ${metaNum(params.syringeKMm3PerMm)}`,
    `; overfill: ${metaNum(params.overfill)}`,
    `; retractMm: ${fixedFromInt(retractTicks, 5)}`,
    `; retractMinTravelMm: ${metaNum(params.retractMinTravelMm)}`,
    `; depositF: ${params.depositF}`,
    `; travelF: ${params.travelF}`,
    `; retractF: ${params.retractF}`,
    `; emptyLayerCount: ${totals.emptyLayers.length}`,
    `; depositTotalMm: ${totals.depositMm.toFixed(3)}`,
    `; extrusionTotalMm: ${fixedFromInt(eTicksAll, 5)}`,
  ];
  // 채움이 있는 파일만 (없는 파일의 메타는 위 줄들 그대로)
  if (totals.thinFillLayers.length > 0 || totals.thinFillFailedLayers.length > 0) {
    header.push(
      '; thinFill: Z1-b2 centerline and dot fill where rows miss (bands of width w, band index non-decreasing, detour travels)',
      `; thinFillLayerCount: ${totals.thinFillLayers.length}`,
      `; thinFillFailedLayerCount: ${totals.thinFillFailedLayers.length}`,
      `; thinFillPieceCount: ${totals.fillPieces}`,
      `; thinFillDotCount: ${totals.fillDots}`,
      `; detourTravelCount: ${totals.detourTravels}`,
    );
  }
  // 2재료만 (D1a — 단일 재료 파일의 메타는 위 줄들 그대로)
  if (dual !== null) {
    header.push(
      '; dualMaterial: D1a slot A = T0, slot B = T1, one tool after the other in a layer, overlap goes to B (A rows minus B rows)',
      `; materialOrder: ${dual.order === 'AB' ? 'A then B' : 'B then A'}`,
      `; materialMeshCount: A ${dual.meshes.A.length} B ${dual.meshes.B.length}`,
      `; toolChangeCount: ${totals.toolChanges}`,
      `; depositTotalMmT0: ${byToolTotal[0].depositMm.toFixed(3)}`,
      `; depositTotalMmT1: ${byToolTotal[1].depositMm.toFixed(3)}`,
      `; extrusionTotalMmT0: ${fixedFromInt(eTicks[0], 5)}`,
      `; extrusionTotalMmT1: ${fixedFromInt(eTicks[1], 5)}`,
      '; boundaryInsetMm: 0',
      '; minFragmentAreaMm2: 0',
    );
  }

  const lines = header.concat(body);
  totals.lineCount = lines.length;
  return { gcode: lines.join('\n') + '\n', layers, totals, params };
}
