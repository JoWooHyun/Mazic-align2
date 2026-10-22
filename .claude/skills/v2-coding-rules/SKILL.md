---
name: v2-coding-rules
description: MazicAlign v2 구현 공통 규칙(시작 전 확인·수정 규칙·완료 전 검증·보고 형식). coder·coder-sonnet·fixer 에이전트에 프리로드된다. 사람이 직접 부를 일은 없다.
---

# MazicAlign v2 구현 공통 규칙

대상은 **v2** (`frontend/src/features/v2/`). 기준 브랜치 `integrate/v2-mainline`.
이 문서는 `.claude/agents/coder.md`·`coder-sonnet.md`·`fixer.md` 가 공유한다 — 규칙을 고치면 여기 한 곳만 고친다.

## 시작 전 확인

- 작업 트리가 `origin/integrate/v2-mainline` 기준인지 확인:
  `git fetch origin && git merge-base --is-ancestor origin/integrate/v2-mainline HEAD && echo OK`
  (또는 플래너가 준 기준 커밋 해시와 `git log --oneline -1` 대조).
  worktree 가 v1 초기 커밋(d6b58bd)에서 시작한 사고가 두 번 있었다 — 다르면 플래너가 지시한 기준으로 reset 후 시작.
- 루트 `CLAUDE.md` 의 **수정 규칙 1~10**, 코드 구조 표, **함정** 절을 읽는다.

## 규칙

1. `CLAUDE.md` 수정 규칙 1~10 을 따른다. 특히:
   - 데이터는 `data/*.repo.ts` 경유(1), 씬은 `BabylonSceneHandle` 경유(2)
   - 🔒 `utils/dental/margin-detect.ts`(MARGIN_LOCK)·`margin-guard.ts`(MARGIN_GUARD_LOCK) 상수·로직은 계획에 지현규 컨펌 근거가 없으면 손대지 말 것(3)
   - painted 와 floodfill 결과 혼입 금지(4), 산출물 바이트 보존(5), 노광·리프트 기본값은 `types/printer.ts` DEFAULT_* 하나(6)
   - `printerProfile` 등 반응형 값을 쓰는 useCallback/useEffect 의 deps 누락 금지(7)
   - Task0 내보내기는 경고하고 진행 — 품질 문제로 파일 생성을 막지 않는다(10)
2. **전달받은 계획의 범위를 벗어나지 않는다.** 계획에 없는 리팩터링, 파일 이동, 의존성 추가 금지.
   계획이 잘못됐다고 판단되면 코드를 고치지 말고 그 이유를 보고한다.
3. **v2 밖(`src/components`·`src/pages`·`src/services`, 즉 구 v1)은 동결 — 수정 금지.** 백엔드도 동결.
4. `components/babylon/` 은 **훅 호출 순서·dispose 순서 불변식**이 있다 — 건드리면 `docs/리팩토링_LLM구조_20260720.md` §5 를 먼저 읽는다.
5. `pages/ViewerV2Page.tsx` 에 기능을 더하지 말고 `pages/viewer/` 하위 훅·컴포넌트로 분리한다(계획이 달리 지시하면 그대로).
6. `CLAUDE.md`·`.claude/` 아래 파일은 수정하지 않는다 — 사실이 틀렸으면 보고만 한다(플래너가 고친다).
7. 기존 코드 스타일(네이밍, 주석 밀도, Tailwind 클래스 패턴)을 그대로 따른다. 주석·커밋은 한국어, 식별자는 영어.
8. 새 tsc 에러·lint 경고를 만들지 않는다. 기준선은 `CLAUDE.md` "알려진 이슈" 절(tsc 0, lint 는 적힌 건수 그대로 — 전부 동결된 v1·공용).
9. 새 헤드리스 검증 스크립트를 만들면 **대조군 원칙**: 수정 전 구현·변조 구현에서 실제로 FAIL(exit ≠ 0) 나는 것을 확인한다.
10. Tailwind 가 TS 주석·문자열의 `inline`·`hidden`·`block`·`fixed`·`table` 같은 단어도 클래스로 읽는다 — "build 산출물 동일" 을 주장할 변경이면 이 단어를 피한다.
11. 확신이 없는 부분은 추측으로 구현하지 말고 보고서에 "불확실" 로 명시한다.

## 완료 전 검증 (전부 직접 실행)

```
cd frontend
npx tsc --noEmit                          # 0건
npm run lint                              # CLAUDE.md 알려진 건수 그대로(새 경고 0)
for f in scripts/verify-*.mjs; do npx tsx "$f" >/dev/null 2>&1 || echo "FAIL $f"; done   # 전부 exit 0
npm run build                             # 성공
```

- 검증 스크립트는 반드시 `npx tsx` 로(plain `node` 는 `ERR_MODULE_NOT_FOUND` 오탐), 판정은 **exit code** 로
  (대조군 스크립트는 정상 레이블에도 "FAIL" 문자열이 들어간다).
- `verify-task0-parser` 는 worktree 에서 Task0 리포를 못 찾아 SKIP 될 수 있다 — `TASK0_DIR=C:/Users/JoWooHyun/Documents/Task0` 를 주고 돌린다.
- 산출물(마스크 PNG·ZIP·G-code) 바이트가 바뀌는 변경이면 before/after 를 보고에 적는다.
- 문서·주석만 바꾼 경우에도 tsc·lint 는 돌린다(주석 단어가 Tailwind·lint 에 걸리는 일이 있었다).

## 보고 형식 (최종 보고 — 한국어)

- 수정한 파일 목록과 각 파일의 변경 요약
- 수용 기준 각 항목에 대한 충족 여부
- 위 검증 4종의 **실측** 결과(tsc·lint 건수, 검증 스크립트 통과 수/전체 수, build) — 실패했으면 실패했다고 쓴다
- 계획과 다르게 구현한 부분이 있다면 그 이유
- 확신이 없거나 결정을 미룬 부분
