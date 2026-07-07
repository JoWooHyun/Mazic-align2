# MazicAlign

Top-down 레진 프린터용 하이브리드 슬라이서 (최종 목표: 2노즐 레진 경로 도포 하이브리드 프린터 지원).
현재 단계: DLP/레진 슬라이서 최소 완결 워크플로우 구축.

## ⚠️ 메인라인 전환 진행 중 (2026-07-07 결정)

- **새 메인라인은 `integrate/v2-mainline` 브랜치** (유승제 v2 기반: `features/v2/`, IndexedDB, undo, 프린터 프로파일, ctb).
  현재 `main`은 구 v1 — 신규 기능 작업은 `docs/통합로드맵.md`의 이식 순서를 따를 것.
- 데이터 계층: **IndexedDB** (Express/SQLite 백엔드는 동결 — 삭제 금지, 신규 의존 금지). 근거: `docs/아키텍처결정_20260707.md`
- 서포트 분담: 유승제=구조물 생성/편집, 지현규=배치 판단(마진/아일랜드). 검출 결과 → 서포트 생성 입력으로 연결.
- 팀 브랜치: `feat/slicer-step1-2`(조우현 슬라이서), `dev/ji-margin-island`(지현규), `integrate/v2-mainline`(유승제 v2)
  — 전부 origin(popcaron/MazicAlign)에 반입 완료. 이 절은 통합 완료 후 삭제한다.

## 필수 참고 문서

- `docs/WORKFLOW.md` — **팀 개발 흐름과 AI 역할 분담. 작업 시작 전 반드시 읽을 것.**
- `docs/개발방향_*.md` — 개발자별 담당 영역의 개발 방향. 해당 영역 작업 시 반드시 읽을 것.
  (신규 작성 시 `docs/templates/개발방향_템플릿.md` 양식을 따를 것)
- `docs/references/` — 알고리즘 잠금 규약 등 작업 시 구속력 있는 참고 자료.
  특히 `feedback_margin_algorithm_lock.md`: **마진 찾기 알고리즘은 잠금 상태 — 임계값·로직 변경 전 반드시 담당자(지현규) 컨펌.**
- `MazicAlign_개발계획서.txt` — 기능 명세 및 구현 계획 (Step 단위)
- `MazicAlign_작업일지_*.txt` — 날짜별 작업 내역. 작업 완료 시 갱신할 것 (`/worklog`)

## 기술 스택

- **Frontend**: React 18 + TypeScript + Tailwind CSS + Vite / 상태관리 zustand
- **3D**: Babylon.js 6 (ArcRotateCamera, GizmoManager)
- **슬라이싱**: Web Worker (`SlicerWorker.ts`), js-clipper, JSZip
- **Backend**: Express + better-sqlite3 (로컬 전용)

## 명령어

```
cd frontend && npm run dev      # 개발 서버 (Vite)
cd frontend && npm run build    # 빌드 (tsc 포함 안 됨, vite build)
cd frontend && npm run lint     # ESLint (max-warnings 0)
cd backend  && npm run dev      # 백엔드 (tsx watch)
```

- 자동화된 테스트 없음. 검증은 `npm run dev` 실행 후 수동 확인 (docs/WORKFLOW.md의 검증 체크리스트 참고).

## 코드 구조 (frontend/src)

| 경로 | 역할 |
|---|---|
| `services/slicer/types.ts` | SliceSettings, SlicerResult, LayerData 등 **모든 슬라이서 타입의 기반** |
| `services/slicer/SliceEngine.ts` | Z축 레이어 슬라이싱 |
| `services/slicer/GCodeGenerator.ts` | FDM G-code (헤더/푸터/리트랙션/팬) |
| `services/slicer/ImageGenerator.ts` | DLP 마스크 PNG (동적 해상도) |
| `services/slicer/SlicerWorker.ts` | Web Worker 진입점, 결과 조립 |
| `services/slicer/SlicerService.ts` | 메인스레드↔워커 브릿지 |
| `components/Slicer/SlicerPanel.tsx` | DLP/FDM 설정 UI |
| `components/STLViewer.tsx` | Babylon 뷰어 (forwardRef, STLViewerHandle) |
| `pages/ViewerPage.tsx` | 전체 통합 (드래그앤드롭, 내보내기, 툴바) |
| `utils/babylon.utils.ts` | 빌드 플레이트, 씬 유틸 |
| `hooks/` | useSTLFiles, useKeyboardShortcuts 등 |

## 수정 규칙

1. **의존성 순서 준수**: 타입 변경은 `types.ts` → 서비스 → UI 순으로. `ViewerPage.tsx`는 항상 마지막에 통합.
2. `SliceEngine.ts`와 `types.ts`의 LayerData는 타입 호환을 유지할 것.
3. 슬라이싱 로직 변경 시 SlicerWorker(워커 스레드)와 SlicerService(메인 스레드) 양쪽 영향 확인.
4. UI는 CHITUBOX를 레퍼런스로 함 (설정 항목 이름, 배치).
5. 단위: 길이 mm, 시간 s, 온도 ℃. UI 레이블에 단위 명시.
6. 주석/문서/커밋 메시지는 한국어, 코드 식별자는 영어.

## 알려진 이슈 (수정 대상 아님 — 별도 정리 작업에서만 처리)

- @types/ import 스타일 경고 (~10개 파일), NodeJS.Timeout 타입 미인식, unused variables,
  LoginPage의 login/register 미존재, js-clipper 모듈 타입 이슈.
- 이 에러들 때문에 작업을 중단하지 말 것. 단, **새로 작성하는 코드에서 새 타입 에러를 만들지 말 것.**

## Git

- `main` 직접 커밋 금지. `feat/<기능명>` 브랜치 → PR → 리뷰 → 머지.
- 커밋 단위: 개발계획서의 Step 또는 그 하위 작업 단위.
- 커밋 메시지: `feat:`, `fix:`, `docs:`, `refactor:` prefix + 한국어 요약.
