# MazicAlign

Top-down 레진 프린터용 하이브리드 슬라이서 (최종 목표: 2노즐 레진 경로 도포 하이브리드 프린터 지원).
현재: **v2 아키텍처** (React + Babylon + IndexedDB, 백엔드 불요). 기준 브랜치 = `integrate/v2-mainline` (기본 브랜치).
`main`은 구 v1 — 통합 완료 후 교체 예정 (로드맵 Step 3-4).

**현재 우선순위 (2026-10 기준)**: **11월 초 외부 데모.** 서포트 고도화는 뒤로, 기본기·사고 방지 우선.
출력물은 자체 프린터(Task0)가 읽는 **`.zip` 하나** — CTB 완전 폐기(리드 결정 2026-09-28~29, 코드 제거 PR #105).
AI 체제: 2026-09-23~ Opus 5.5 시험(계획·구현·검수 전부).

## 필수 참고 문서

- `docs/인수인계_*.md` 중 **최신 날짜** — 새 세션 시작점 (지금 상태·리드 할 일·AI 다음 작업 순서)
- `docs/통합로드맵.md` — **진행 상태의 단일 진실.** 작업 시작 전 체크박스 확인, 완료 시 갱신. 최상단 "0. 11월 데모" 절이 현재 일정
- `docs/계획_11월데모_20260923.md` §0 — 데모 6주 일정 정본 (CTB 폐기·`.zip` 경로 Z1~Z5)
- `.zip` 경로 작업 시: **규격 정본 = Task0 리포 `docs/Task0_Gcode_규격서_초안.md`** (이 리포 밖, 리드 PC `Documents\Task0\docs\`),
  구현 계획 `docs/계획_Task0규격적용_20260918.md`, 협의 기록 `docs/제안_Task0협의_20260929.md`(Task0 사본과 동기화 — `docs/WORKFLOW.md` §7)
- `docs/WORKFLOW.md` — 팀 개발 흐름, AI 사이클, PR 규칙(머지=조우현), 검증 체크리스트
- `docs/아키텍처결정_20260707.md` — v2 메인라인/IndexedDB/서포트 분담 결정과 근거
- `docs/references/feedback_margin_algorithm_lock.md` — **마진 알고리즘 잠금 규약. 변경 전 지현규 컨펌 필수.**
- `docs/개발방향_*.md` — 개발자별 담당 영역 (해당 영역 작업 시 필독)

## 기술 스택

- React 18 + TypeScript + Tailwind + Vite / zustand / **Babylon.js 6**
- 데이터: **IndexedDB** (`features/v2/data/*.repo.ts` — repo 패턴 필수 경유)
- 슬라이싱: Web Worker (`workers/slice-batch.worker.ts`), manifold-3d wasm(CSG), js-clipper(G-code)
- 백엔드(Express+SQLite)는 **동결** — 실행 불요, 신규 의존 금지 (로컬 파일 브라우저만 선택적 사용)

## 실행 / 명령

```
start-dev.bat 더블클릭            # 설치+기동+브라우저 자동 (팀 표준)
cd frontend && npm run dev        # 수동 (→ http://localhost:5173/v2)
cd frontend && npm run lint       # ESLint (기존 34건은 알려진 이슈, 새 코드만 clean)
cd frontend && npx tsc --noEmit   # 타입 검사 — 0건 유지 (2026-10-02 정리)
cd frontend && npm run build      # vite build
```

```
cd frontend && npx tsx scripts/verify-<이름>.mjs   # 헤드리스 검증 (2026-10-06 기준 29종 — 개수는 `ls scripts/verify-*.mjs` 로 확인)
```

- 자동 테스트(단위테스트 프레임워크) 없음. 대신 **헤드리스 검증 스크립트 전부**(10/6 기준 29종)가 상시 PASS여야 한다
  (**Node 20.6 이상** — `verify-head-normal.mjs` 가 `node:module` register 로더 훅을 쓴다)
  (`scripts/verify-*.mjs`). ⚠️ **반드시 `npx tsx`로 실행** — plain `node`로 돌리면
  확장자 없는 TS import를 못 풀어 `ERR_MODULE_NOT_FOUND` **오탐**이 난다(실제로 두 번 속았음).
  판정은 출력 문자열이 아니라 **exit code**로 — 뮤테이션 대조군 스크립트는 정상 단언 레이블에도
  "FAIL" 문자열이 들어간다.
- 새 검증 스크립트는 **대조군 원칙**: 수정 전 구현·변조 구현이 실제로 FAIL 나는지 증명할 것.
- 사람 확인 = `docs/WORKFLOW.md`의 v2 수동 체크리스트.

## 코드 구조 (frontend/src/features/v2)

| 경로 | 역할 | 담당/주의 |
|---|---|---|
| `pages/ViewerV2Page.tsx` | 전체 통합 골격 (920줄 — 7/20 분리 직후 640에서 다시 불어남): 공유 상태 + 훅 조립 + JSX 골격 | 공용 — useCallback deps 주의. **새 기능은 여기 말고 `viewer/` 하위 훅·컴포넌트로** |
| `pages/viewer/` | ViewerV2Page의 분리 조각: `hooks/`(서포트 편집·dental·내보내기 등 8개 + types), `components/`(헤더·오버레이·사이드패널·슬라이스 모드 8개), `utils/`(4개) | 구조도: `docs/리팩토링_LLM구조_20260720.md` |
| `components/BabylonScene.tsx` | **씬 본체** (158줄): SceneCtx + 훅 호출(순서 고정) + 핸들 조립. 편집모드 select/support/dental-brush, handle 패턴 | 유승제 설계 — 구조 변경 시 리뷰 지정 |
| `components/babylon/` | 씬 기능 조각: `hooks/`(use* 10개 + setup-gizmos·setup-pointer-handlers·dispose-scene), `handle/` 빌더 6개, dental/bridge/재설계 액션. **훅 호출 순서·dispose 순서 불변식 있음** | 변경 전 `docs/리팩토링_LLM구조_20260720.md` §5 필독 |
| `support/` | 서포트 구조물 (재설계 경로: 검출→라우팅→부품 조립, 레거시 trunk/브릿지, 파라미터, 자동 생성) | **조우현**(2026-08-05 유승제→이관, AI dev-cycle로 진행) |
| `utils/dental/` | **지현규 알고리즘**: `margin-detect.ts`(🔒잠금), `margin-guard.ts`(🔒상수 잠금 — 원본 1:1 이식), `island-detection.ts`, `dental-support.ts`, `paint-mask.ts` | 지현규 — 로직 변경 시 컨펌 |
| `utils/gcode/` | FDM G-code (marlin) — 회귀 기준으로만 유지 | 조우현 이식분 — 기존 marlin 출력 바이트 보존 |
| `utils/task0/` | **Task0(자체 프린터) 출력 전부**: 상수·좌표(`task0-frame` — Task0 숫자의 단일 소스), 프로파일(`task0-profile`), G-code writer(B안 줄 채움 + 얇은 부분 채움), Task0 파서 이식(원본과 차분 검증), 투사 프레임 마스크 래스터, 커버리지 검사기, PNG·job.zip, 앱 내보내기 코어(`task0-export`) | 설계 `docs/계획_Z1_task0출력_20261002.md`. 규격 = Task0 리포 규격서. 파서 이식은 Task0 커밋에 고정 |
| `utils/slice-*` + `workers/` | 배치 슬라이스 (마스크 ZIP·G-code, 워커) | 산출물 바이트 변경 금지 원칙 |
| `utils/{exposure,print-time,mask-png}.ts` | 노광 보간, 시간 추정, 마스크 PNG | 기본값 단일 소스 유지 |
| `data/*.repo.ts` + `data/db.ts` | IndexedDB 계층 | 스키마 변경은 협의 |
| `types/printer.ts` | 프린터 프로파일 (노광 4종 + 리프트 4종, DEFAULT_* + PROFILE_FIELD_LIMITS) | 값 변경은 마스크 ZIP manifest 노광값·예상 시간 변경 — 규칙 5·6 |
| `utils/sample-models.ts` | 예제 모델(20mm 큐브·구) 바이너리 STL 코드 생성 | 비등방 도형 추가 시 Y-up 전제 재검토 |
| `components/DentalPanel.tsx` 등 | 우측 패널 UI들 | |

`src/components·pages·services`(v2 밖)는 구 v1 — 동결, 수정 금지 (Step 3-2 정리 예정).

## 수정 규칙

1. **데이터는 repo 경유** — 컴포넌트에서 IndexedDB 직접 접근 금지 (가역성 조건, ADR-2).
2. **씬은 handle 경유** — 컴포넌트가 mesh에 직접 접근하지 않는다. 새 기능은 `BabylonSceneHandle` 메서드로 노출 (exportStl/getSliceMask 패턴).
3. **마진 잠금**: `utils/dental/margin-detect.ts`의 `MARGIN_LOCK` 상수·로직, `margin-guard.ts`의 `MARGIN_GUARD_LOCK`(MARGIN_GUARD 0.5mm·MAX_PUSH 30회)·판정 로직 변경 전 지현규 컨펌. reviewer가 위반 시 FAIL 처리.
4. **painted 계약**: margin 입력은 브러쉬 painted만 (`paint-mask.ts`) — floodfill(autoFill) 결과는 별도 집합, 절대 혼입 금지.
5. **산출물 보존**: 슬라이스 마스크 PNG·ZIP·G-code 바이트가 변하는 수정은 의도적일 때만 — PR에 before/after 명시.
6. **기본값 단일 소스**: 노광/리프트 폴백은 `types/printer.ts`의 DEFAULT_* 하나만 — 화면 추정과 파일 기록이 항상 같은 값.
7. **useCallback deps**: `printerProfile` 등 반응형 값 참조 시 deps 누락 주의 (stale closure — 반복 사고 유형).
8. 단위: 길이 mm, 시간 s(속도 mm/s — G-code F 는 mm/min 환산), 온도 ℃. UI 레이블에 단위 명시.
9. 주석/커밋 한국어, 식별자 영어. 새 코드에서 새 tsc 에러·lint 경고 금지.

## 알려진 이슈 (수정 대상 아님 — 별도 정리에서만)

- tsc **0건** (2026-10-02 정리 — 12건이 전부 v2 타입 표기 문제였고 타입만 고쳐 build 산출물 바이트 동일). **이제 새 tsc 에러는 1건도 허용 안 됨**
- lint 34건: exhaustive-deps·no-explicit-any 등 (2026-09-15 재집계, 10-02 재실측 동일 — 24 errors, 10 warnings. v1 25 + v2 8 + 공용 1)
- 이 때문에 작업을 중단하지 말 것. 단 **새 코드에서 추가 금지.**

## 함정 (반복 사고 방지)

- **Tailwind 가 `src/**/*.{ts,tsx}` 의 주석·문자열 단어도 클래스로 읽는다.** `inline`·`hidden`·`block`·`fixed`·`table` 같은 단어가 TS 에 새로 들어가면
  CSS 가 늘어 build 산출물 해시가 바뀐다(Z1-a1 에서 실측 — 내부 키 `"inline"` → `trailing_comment` 로 회피). "build 산출물 동일" 을 주장하는 PR 은 이 단어를 피할 것.
- **build 산출물 비교는 같은 체크아웃 안에서**(수정 전 build 를 떠 두고 sha256 비교). `git archive` 판과 작업 트리를 비교하면 autocrlf 때문에 `index.html` 이 거짓으로 달라진다.
- **Task0 파서 이식(`utils/task0/task0-gcode-parser.ts`)을 고치면** `verify-task0-parser.mjs` 출력이 "SKIP(차분 검사)" 가 아니라 "불일치 0건" 인지 확인할 것 —
  Task0 리포·Python 이 없는 PC 에서는 차분 검사가 SKIP 되고, 그때는 미묘한 이식 오류를 못 잡는다.

## Git / PR

- 기본 브랜치 `integrate/v2-mainline`. `feat/<이름>` → PR → **조우현 머지(=최종 승인)**. **머지 후 브랜치 바로 삭제.**
- 에이전트 worktree 가 v1 초기 커밋(d6b58bd)에서 시작한 사고가 두 번 있었다 — 작업 시작 시 `origin/integrate/v2-mainline` 기준인지 확인(아니면 reset).
- PR 본문 필수: 변경 요약, AI 검수 이력(FAIL→수정 포함), **"조우현 확인 포인트"**(비개발자 실행 체크리스트).
- BabylonScene 구조·IndexedDB 스키마·마진 로직 등 설계 변경은 해당 담당자(유승제/지현규) 리뷰 지정.
- 커밋: `feat:`/`fix:`/`docs:`/`chore:` + 한국어 요약. AI 작업은 `/dev-cycle` (계획→구현→검수→PR).
