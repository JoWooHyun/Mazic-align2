# MazicAlign v2 개발 정리 — 2026-07-07

## 1. 배경

- MazicAlign v2 = 의치/덴처용 3D 프린팅 SLA 서포트 생성 도구
- Stack: React 18 + Babylon.js 6.49 + Vite + TypeScript, wasm CSG = manifold-3d
- 핵심 이슈 = **Bridge tube 서포트의 STL 침투 처리** (2026-06 부터 지속)

## 2. 사용자 요구 (Bridge tube)

1. STL mesh 구조 확인
2. Bridge a, b 지점이 STL mesh 표면과 vertex-level 일치
3. void 0 (smooth 연결)
4. 0.1mm 침투 (최소)
5. 0.1mm 이상 다른 mesh 벽 안 만남 (thin shell 반대편 통과 X)

부가:
- freeze 0 (drag 중 안 멈춤)
- STL 이동/회전 시 Bridge 가 함께 follow
- Bridge 중심선은 직선 유지 (휨 금지)

## 3. 시도 이력 — 폐기된 접근

| 시도 | 방식 | 결과 |
|---|---|---|
| A | SDF voxel + ShaderMaterial fragment discard | thin shell inside 9.5% → 실패 |
| B | 단순 Babylon CSG | 웹 다운 |
| B+ | setTimeout 디바운스 + CSG cache | 여전히 멈춤 |
| C | 양 끝 PEN ray cast | thin shell PEN 너무 작아 cap 노출 |
| Cap deformation | Bridge 마다 ray cast × cap ring × 2 | 다운 |

## 4. 현재 채택 — 체크포인트 `f4b64cf` (2026-06-29)

- **manifold-3d wasm CSG** — Babylon CSG 대비 ~100배 빠름
- STL → manifold 변환 1회 (약 3초, cache), `mesh.merge()` 로 vertex dedup → NotManifold 회피
- STL winding flip (Babylon CW ↔ manifold CCW)
- Bridge tube.subtract(STL) → clipped mesh + `parent = stlMesh` 자동 follow
- Bridge clip cache: `supportId + STL local 좌표 + params` 기준

성능:
- STL 초기 변환 3초 (1회)
- Bridge subtract miss 시 ~150ms, hit 시 0ms

## 5. 2026-07-01 ~ 07-02 실패 시도 (전부 롤백됨)

- **PEN = radius + 0.1** — cap 평면 방향 오정렬로 노출
- **path 양 끝 tangent extend** — cps 위치에 따라 방향 예측 불가 → 더 나빠짐
- **base/contact 근처 anchor 삽입** (surface 안/밖 방향 모두) — Catmull-Rom overshoot 로 tube 가 표면 위 크게 솟음
- **normal 부호 자동 보정** (+n ray hit → flip) — 효과 안 나타남 (hot reload 이슈 의심)

→ 사용자 요청으로 `checkpoint-2026-06-29` 태그로 롤백.

## 6. 2026-07-06 — 방향 전환

사용자가 침투 완벽 X 감수하고 **STL follow + freeze 0** 우선 요구.

### 적용된 개선 (working tree, 미커밋)

- `buildSupportKey` — STL local 좌표 + params 기준 rebuild key
- **useEffect diff-based** — key 동일 + `mesh.parent` 존재 시 rebuild **skip** (mesh 그대로, parent 로 world 자동 이동)
- `console.log [clip]` 제거

### 원리

1. STL 이동 → `handleCommitTransform` → supports state patch (world 좌표 갱신)
2. useEffect fire → 각 support 의 STL local 좌표 계산 → **이전과 동일** → key 동일 → skip
3. mesh 는 `parent = stlMesh` 라 Babylon 이 world matrix 자동 계산 → 즉시 이동
4. rebuild 하나도 안 일어남 → freeze 0

## 7. 미해결 과제 (우선순위)

1. **Bridge cap 완벽 침투** — 침투 0.1mm + 반대편 안 만남 + 굴곡 표면 대응 방법 미확정
   - 유력 후보: mesh-level cap vertex projection (cap 평면 강제 정렬)
   - 또는: normal 부호 문제 근본 원인 (STL loader winding) 파악
2. **thin shell 처리** — 두께 < radius+0.1 인 경우 cap 노출
3. **Web Worker CSG** — subtract 를 background 로 (사용자 결정 대기)
4. **옛 supports 좌표 migration** — 필요 시 world → STL local 변환

## 8. 반복 발견된 함정

- STL loader winding 에 따라 normal 이 inward 일 수 있음 — 부호 검증 후 사용
- Catmull-Rom spline 양 끝 tangent 는 짧은 anchor 로 제어 어려움 → cps 자체 수정이 안전
- 큰 코드 변경 후 반드시 dev server 재시작 + Ctrl+Shift+R (hot reload 신뢰 X)
- 체크포인트 tag 는 실패 시 빠른 롤백 안전판
- git push 는 `feat/support-and-edit-tools` 브랜치로 감. default `main` 페이지에서 안 보임 → 브랜치 스위처 필요

## 9. 주요 파일

| 위치 | 역할 |
|---|---|
| `frontend/src/features/v2/utils/support-render.ts` | Bridge mesh 생성 (`createSupportMesh`, `createBridgeCurveTube`) |
| `frontend/src/features/v2/utils/manifold-csg.ts` | STL ↔ manifold 변환, subtract |
| `frontend/src/features/v2/components/BabylonScene.tsx` | STL follow, rebuild key, supports useEffect |
| `frontend/src/features/v2/pages/ViewerV2Page.tsx` | Bridge 생성 UI, `handleCommitTransform`, follow attached children |
| `checkpoint-2026-06-29` (tag) | manifold-3d 도입 완료 시점 (안전 롤백 지점) |

## 10. Sample / 업로드 정책

- 모든 git push/pull 대상 = `admin-zero-lab/MazicAlign-v2` (단일 origin)
- default = `main`. 개발은 `feat/support-and-edit-tools` 브랜치
- STL 샘플은 프로젝트 루트에 `_이니셜_MMDD_설명.stl` 형식으로 저장
