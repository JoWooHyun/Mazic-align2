---
description: 계획(플래너) → 구현(coder) → 검수(reviewer) → 재작업 루프 → PR 로 기능을 개발한다
argument-hint: <작업 내용 또는 통합로드맵 항목 번호>
---

다음 작업을 MazicAlign 개발 사이클로 수행하세요: $ARGUMENTS

`docs/WORKFLOW.md` §3 "AI 개발 사이클" 절차를 따릅니다. 대상은 **v2** (`frontend/src/features/v2/`), 기준 브랜치는 `integrate/v2-mainline`.

## 1단계: 계획 (직접 수행)

1. 이 작업과 관련된 내용을 다음에서 확인:
   - `CLAUDE.md`(수정 규칙 1~9·코드 구조·알려진 이슈), `docs/WORKFLOW.md`
   - `docs/인수인계_*.md` 중 최신 — 현재 상태·결정 대기·운영 주의
   - `docs/통합로드맵.md` — 최상단 "0. 11월 데모" 절과 해당 항목
   - `docs/계획_11월데모_20260923.md` §0 — 데모 일정·범위
   - `.zip` 경로(Task0) 작업이면: Task0 리포 `docs/Task0_Gcode_규격서_초안.md`(규격 정본) + `docs/계획_Task0규격적용_20260918.md`
2. 관련 코드를 읽고 현재 구조 파악.
3. 다음을 포함한 구현 계획 작성:
   - 수정 파일 목록 + 의존성 순서
   - 각 파일의 구체적 변경 내용
   - **수용 기준**: 완료 판정에 쓸 구체적·검증 가능한 조건 목록 (산출물 바이트 보존 여부, 새 검증 스크립트·대조군 포함)
4. 로드맵·데모 계획·규격서와 충돌하거나 범위가 모호하면 **코딩 전에 사용자에게 확인**.
5. 브랜치: `origin/integrate/v2-mainline` 에서 `feat/<이름>` (문서만이면 `docs/<주제>-<날짜>`).

## 2단계: 구현

`coder` 서브에이전트에게 계획 전체(파일 목록, 변경 내용, 수용 기준)를 전달하여 구현시킵니다.
계획을 요약하지 말고 그대로 전달하세요. 함께 전달할 것:
- 작업 브랜치/worktree 와 기준 커밋 — "시작 시 `origin/integrate/v2-mainline` 기준인지 확인, 아니면 reset"
- 완료 전 검증 명령(`npx tsc --noEmit` / `npm run lint` / `npx tsx scripts/verify-*.mjs` 전부 exit 0 / `npm run build`)과 기준선(tsc 0 / lint 34)

## 3단계: 검수

`reviewer` 서브에이전트에게 작업 목표 + 수용 기준 + 검토 대상(브랜치·worktree)을 전달하여 diff를 검토시킵니다.
reviewer 는 자동 검증을 직접 재실행합니다.

## 4단계: 판정 및 분기

reviewer의 결과를 그대로 수용하지 말고 직접 타당성을 판단한 뒤:

- **FAIL이 타당하면**: 문제 목록과 수정 지시를 `coder`에게 전달하여 재작업 → 3단계로.
  재작업은 최대 3회. 그래도 FAIL이면 중단하고 현재 상태·문제·선택지를 사용자에게 보고.
- **PASS이면**:
  1. 커밋(`feat:`/`fix:`/`docs:`/`chore:` + 한국어 요약) → push → **PR 생성** (대상 `integrate/v2-mainline`).
     PR 본문: 무엇을/왜, 수정 파일, AI 검수 이력(FAIL→수정 포함), 자동 검증 실측, 산출물 바이트 변화 여부,
     **"조우현 확인 포인트"**(`docs/WORKFLOW.md` §4-2 에서 해당 항목을 골라 "무엇을 누르면 무엇이 보여야 정상인지")
  2. `docs/통합로드맵.md` 해당 체크박스 갱신을 같은 PR 에 포함
  3. 사용자에게 결과 요약 + PR 링크 + 확인 포인트 안내. 작업일지는 세션 마감 때 `/worklog`
  4. 머지는 조우현이 한다. 머지 후 브랜치·worktree 삭제
