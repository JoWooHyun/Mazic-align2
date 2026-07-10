---
name: feedback-margin-algorithm-lock
description: 마진 찾기(findMargin) 알고리즘이 사용자가 만족한 균형 상태로 잠겨있음. 로직 변경 전 반드시 사용자 컨펌 받기.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 92cdc2bf-2cc3-4a63-be78-24998fbd1f88
---

[STLViewer.tsx](frontend/src/components/STLViewer.tsx) 의 `findMarginSignal` useEffect (마진 찾기) 는 2026-06-08 사용자 컨펌으로 균형 상태에 도달. **알고리즘 로직/임계값을 바꾸기 전에 반드시 사용자에게 변경 의도 + 위험 + 대안을 설명하고 컨펌 받기.** 임계 한 단계만 옮겨도 노이즈/끊김의 균형이 깨진다. 무단 변경 금지.

**Why:** 사용자가 여러 라운드에 걸쳐 직접 트레이드오프 (민감도 vs 노이즈, 연장 vs 잘못된 연결) 를 조정해 균형 잡음. 작은 변경이 누적되면 다시 노이즈/직선 폴백/평행 spaghetti 등 과거 사고가 재발. 이 시점이 베이스라인이라 후퇴 시 비교 기준이 되어야 함.

**How to apply:**
- 마진 알고리즘 관련 변경 요청 시 ALWAYS 변경 항목 + 예상 영향 명시한 뒤 사용자 yes 받기. "이전 균형 깨질 수 있는데 진행할까요?" 식.
- 다른 기능 수정 (서포트 / island detection 등) 작업 중에 margin 알고리즘을 부수적으로 touch 하지 말 것. 격리.
- 회귀 발생 시 이 메모의 [현재 균형 파라미터] 표를 보고 즉시 복원 가능.

## 현재 균형 파라미터 (2026-06-08 시점)

### Chain walk (보수적 = 노이즈 차단)
- `SHARP_DEG_PAINTED` = 25° (bothPainted seed 임계)
- `SHARP_DEG_GLOBAL` = 12° (chain 확장 풀)
- `DIR_TOL_DEG` = 45° (best-only)
- `SPUR_MAX` = 2.0mm
- `SEED_REGION_R` = max(brush × 3, 8mm)
- chain walk Frontier = `{ v, comingFrom }` (chainDist 없음, region only)
- best-only, sharpnessBonus 없음, 조건부 코너 분기 없음, 추가 시드 자동 발견 없음

### Endpoint Corner Extension (⑦.5 — 코너만 짧게 보조)
- `MAX_CORNER_STEPS` = 5
- `CORNER_DIR_TOL_DEG` = 150° (큰 회전 허용)
- `CORNER_SHARP_DOT` = cos(30°) (dihedral ≥ 30° 만 — 명확한 코너)
- score = `(1 - dotNN) × 1.0 + align × 0.3` (sharpness 주, align tie-breaker)

### 작은-컴포넌트 폐기 (⑦.7 — corner ext 후 noise 정리)
- `MIN_TINY_COMP_LEN` = 1.5mm — 총 edge 길이가 이보다 짧은 isolated 컴포넌트는 폐기
- bridge 단계 전 실행 → inter-component bridge 가 깨끗한 컴포넌트만 대상으로 동작

### Endpoint Bridge (degree-1 쌍)
- `BRIDGE_MAX` = 12mm
- `SURFACE_MAX` = BRIDGE_MAX × 4.5 = 54
- **직선 폴백 제거** (Dijkstra 실패 시 skip — 잘못된 직선 라인 차단)

### Inter-component Bridge (loop 등 endpoint 없는 컴포넌트)
- `INTERCOMP_BRIDGE_MAX` = 15mm
- `INTERCOMP_SURFACE_MAX` = INTERCOMP_BRIDGE_MAX × 4.5 = 67.5
- `MIN_COMP_VERTS` = 2 (단일-edge fragment 도 bridge 대상)
- Kruskal 식 (Union-Find) — 정확히 N-1 bridge, 평행 chain cross-bridge 차단

### Surface Dijkstra (sharp-weighted)
- cost = `length × (1 + dotNN² × 4)` — sharp edge (dotNN→0) 1× , smooth (dotNN→1) 5×
- `VISIT_CAP` = 10000 — UI freeze 방지
- 이 가중치로 path 가 ridge 따라감 (margin 외 detour 차단)

### 기타 인라인 상수 (2026-07-09 추기 — v2 이식 감사에서 표 누락 발견, 원본 코드 값 그대로 등재. 지현규 확인 요망)
- `PLATE_EXCL` = 0.6mm — 플레이트 근접 face 제외 높이
- `MARGIN_SAMPLE_STEP` = 0.2mm — 마진 점 dense sampling 간격
- (v2 이식 관련) margin-guard 의 `bodyR` 이 v2 에서는 UI 조절값 `tipDiameterMm`(기본 0.4) 에 연동됨
  — 원본은 고정 `tipBottomDiameter` 0.5. Issue #16 안건 4 로 지현규 답변 대기 중

## 변경 시 위험 패턴 (과거 사고)
- SHARP_DEG_GLOBAL 낮춤 (12 → 7~9°) → 평행 chain spaghetti / 거미줄
- DIR_TOL_DEG 높임 (45 → 60+°) → 노이즈 우회
- top-N 분기 (top-2 등) → 분기 폭주
- 추가 시드 자동 발견 → 무관 ridge 캐치
- BRIDGE_MAX 과대 (25mm+) → 평행 chain cross-bridge zigzag
- 직선 폴백 활성 → margin 외 직선 가로지름
- VISIT_CAP 과소 (5000) + 큰 SURFACE_MAX → Dijkstra 실패 → 직선 폴백 또는 끊김 노이즈

## 관련 메모
- [[feedback-launch-background]] (서버 기동 방식 — 무관하지만 같은 디렉토리)
