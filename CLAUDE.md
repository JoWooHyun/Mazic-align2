# MazicAlign

Top-down 레진 프린터용 하이브리드 슬라이서 (최종 목표: 2노즐 레진 경로 도포 하이브리드 프린터 지원).
현재: **v2 아키텍처** (React + Babylon + IndexedDB, 백엔드 불요). 기준 브랜치 = `integrate/v2-mainline` (기본 브랜치).
`main`은 구 v1 — 통합 완료 후 교체 예정 (로드맵 Step 3-4).

## 필수 참고 문서

- `docs/통합로드맵.md` — **진행 상태의 단일 진실.** 작업 시작 전 체크박스 확인, 완료 시 갱신.
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
cd frontend && npm run lint       # ESLint (기존 40건은 알려진 이슈, 새 코드만 clean)
cd frontend && npm run build      # vite build
```

- 자동 테스트 없음. 검증 = `docs/WORKFLOW.md`의 v2 수동 체크리스트.

## 코드 구조 (frontend/src/features/v2)

| 경로 | 역할 | 담당/주의 |
|---|---|---|
| `pages/ViewerV2Page.tsx` | 전체 통합 (상태·배선, 1,700+줄) | 공용 — useCallback deps 주의 |
| `components/BabylonScene.tsx` | **씬 소유** (2,500+줄). 편집모드 select/support/dental-brush, handle 패턴 | 유승제 설계 — 구조 변경 시 리뷰 지정 |
| `support/` | 서포트 구조물 (trunk/브릿지, 파라미터, 자동 생성) | 유승제 |
| `utils/dental/` | **지현규 알고리즘**: `margin-detect.ts`(🔒잠금), `island-detection.ts`, `dental-support.ts`, `paint-mask.ts` | 지현규 — 로직 변경 시 컨펌 |
| `utils/gcode/` | FDM G-code (2노즐 하이브리드 대비) | 조우현 이식분 |
| `utils/slice-*` + `workers/` | 배치 슬라이스 (마스크/CTB, 워커) | 산출물 바이트 변경 금지 원칙 |
| `utils/{exposure,print-time,ctb-encoder,mask-png}.ts` | 노광 보간, 시간 추정, 출력 포맷 | 기본값 단일 소스 유지 |
| `data/*.repo.ts` + `data/db.ts` | IndexedDB 계층 | 스키마 변경은 협의 |
| `types/printer.ts` | 프린터 프로파일 (노광 4종 + 리프트 4종, DEFAULT_*) | |
| `components/DentalPanel.tsx` 등 | 우측 패널 UI들 | |

`src/components·pages·services`(v2 밖)는 구 v1 — 동결, 수정 금지 (Step 3-2 정리 예정).

## 수정 규칙

1. **데이터는 repo 경유** — 컴포넌트에서 IndexedDB 직접 접근 금지 (가역성 조건, ADR-2).
2. **씬은 handle 경유** — 컴포넌트가 mesh에 직접 접근하지 않는다. 새 기능은 `BabylonSceneHandle` 메서드로 노출 (exportStl/getSliceMask 패턴).
3. **마진 잠금**: `utils/dental/margin-detect.ts`의 `MARGIN_LOCK` 상수·로직 변경 전 지현규 컨펌. reviewer가 위반 시 FAIL 처리.
4. **painted 계약**: margin 입력은 브러쉬 painted만 (`paint-mask.ts`) — floodfill(autoFill) 결과는 별도 집합, 절대 혼입 금지.
5. **산출물 보존**: 슬라이스 마스크 PNG/CTB 바이트가 변하는 수정은 의도적일 때만 — PR에 before/after 명시.
6. **기본값 단일 소스**: 노광/리프트 폴백은 `types/printer.ts`의 DEFAULT_* 하나만 — 화면 추정과 파일 기록이 항상 같은 값.
7. **useCallback deps**: `printerProfile` 등 반응형 값 참조 시 deps 누락 주의 (stale closure — 반복 사고 유형).
8. 단위: 길이 mm, 시간 s(속도 mm/s — CTB 기록 시 mm/min 환산), 온도 ℃. UI 레이블에 단위 명시.
9. 주석/커밋 한국어, 식별자 영어. 새 코드에서 새 tsc 에러·lint 경고 금지.

## 알려진 이슈 (수정 대상 아님 — 별도 정리에서만)

- tsc 13건: BabylonScene(undoLift), ViewerV2Page(Cps 튜플), auto-generate, project-archive, zip-store
- lint 40건: exhaustive-deps 14, no-explicit-any 10, prefer-const 7 등 (2026-07-08 첫 집계)
- 이 때문에 작업을 중단하지 말 것. 단 **새 코드에서 추가 금지.**

## Git / PR

- 기본 브랜치 `integrate/v2-mainline`. `feat/<이름>` → PR → **조우현 머지(=최종 승인)**.
- PR 본문 필수: 변경 요약, AI 검수 이력(FAIL→수정 포함), **"조우현 확인 포인트"**(비개발자 실행 체크리스트).
- BabylonScene 구조·IndexedDB 스키마·마진 로직 등 설계 변경은 해당 담당자(유승제/지현규) 리뷰 지정.
- 커밋: `feat:`/`fix:`/`docs:`/`chore:` + 한국어 요약. AI 작업은 `/dev-cycle` (계획→구현→검수→PR).
