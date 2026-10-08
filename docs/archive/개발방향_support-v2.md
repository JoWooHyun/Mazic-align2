# 개발방향: v2 서포트 시스템 (자동/수동/브릿지)

- **담당자**: 유승제
- **담당 영역**: `frontend/src/features/v2/support/` 전체, `frontend/src/features/v2/utils/{support-render, manifold-csg, bridge-path, coord-space}.ts`, `frontend/src/features/v2/data/supports.repo.ts`, `frontend/src/features/v2/hooks/useSupportsV2.ts`, 그리고 `frontend/src/features/v2/components/BabylonScene.tsx` · `pages/ViewerV2Page.tsx` 의 서포트/브릿지 관련 로직 (edit mode `"support"` 분기, `handleAddSupportAt`, `handleMove*`, `handleCommitTransform` 안 서포트 patch, `useEffect(3.5)` 등)
- **작성일 / 최종 갱신일**: 2026-07-07 / 2026-07-07

## 1. 목표

SLA/DLP 프린팅용 자동·수동 서포트 및 Bridge tube 서포트를 IndexedDB 에 저장·편집·시각화·slice 로 반영. 이번 단계에서 달성할 것:

1. Bridge tube 가 STL 표면과 **빈틈 0** 으로 만나고 **반대편 침투 X** (사용자 알고리즘 5단계)
2. STL transform (이동/회전/스케일) 시 서포트가 **race 없이 즉시 follow**
3. 파라미터 슬라이더·자동 생성·수동 추가·Bridge 편집 중 **freeze 0** (drag 중 UI 안 멈춤)

**이번 단계 범위**: 아래 Step 1 ~ Step 2 를 우선 완료. Step 3 이후 (cap 정렬 재도전, thin shell, normal 부호, Worker, migration) 는 Step 1~2 검증 후 진행 시점 재결정.

## 2. 현재 상태

| 항목 | 상태 | 비고 |
|---|---|---|
| 서포트 파라미터 스토어·프리셋·UI | 완료 | `useSupportParamsStore`, `SupportParamsPanel` (light/medium/heavy 프리셋) |
| 자동 서포트 생성 (grid + overhang) | 완료 | `autoGenerateSupportPoints` — 아래 → 위 ray, `normal.y > -cos(θ)` 오버행 판정 |
| 수동 단점 추가/편집 | 완료 | STL 표면 클릭 → `onAddSupportAt`. Gizmo 로 base X·Z 이동 |
| Bridge tube 생성 (두 점 클릭) | 완료 | `pendingBridge` → 두 번째 클릭에 lerp cps 3개로 직선 초기화 |
| Bridge 변곡점 drag / 끝점 drag / 부착 follow | 완료 | `bridge-path.ts` + `followAttachedChildren` |
| manifold-3d wasm CSG STL 침투 cut | 완료 | STL local 좌표 subtract, supportId 별 cache |
| Bridge mesh 의 `parent = stlMesh` follow | 완료 (subtract 성공 시만) | subtract 실패 fallback tube 는 parent 없음 → follow 안 됨 |
| STL cascade 삭제 (by_stl + by_base_stl) | 완료 | `deleteSupportsByStl` 양쪽 index 스캔 |
| Undo/redo 통합 (add/patch/delete) | 완료 | `useUndoStore.push({label, undo, redo})` |
| **STL local 좌표 기반 rebuild skip (freeze 0)** | 진행 중 (미커밋) | `buildSupportKey` + `useEffect(3.5)` diff, 사용자 최종 확인 대기 |
| **Bridge cap 완벽 표면 정렬 (0.1mm 침투)** | 미해결 | anchor / normal flip / mesh extend 다 실패, 체크포인트 롤백 |
| **thin shell (두께 < radius) 처리** | 미해결 | 반대편 통과 시 양쪽 cap 노출 |
| **Web Worker CSG** | 미착수 | freeze 완전 0 수렴 위한 백업 안 |
| 옛 `coordSpace='world'` supports migration | 미해결 | `stl-local` 로 자동 변환 정책 재검토 필요 |

## 3. 구현 계획 (Step)

### Step 1: diff-based rebuild skip 확정
- **수정 파일**: `frontend/src/features/v2/components/BabylonScene.tsx`
- **변경 내용**: `buildSupportKey(point, params, localContact, localBase, localCps)` 추가 + `useEffect(3.5)` 에서 `map.get(id).metadata.rebuildKey === key && mesh.parent` 이면 rebuild skip. `[clip]` console.log 제거. (working tree 에 이미 반영, 커밋 대기)
- **수용 기준**: STL 을 gizmo 로 회전/이동해도 (1) Bridge/trunk mesh 가 즉시 STL 을 따라 이동 (2) 개발자 도구 Performance 탭에서 drag 중 프레임 예산 초과 (`> 16ms`) 프레임이 0 (3) `[clip]` 로그가 콘솔에 안 찍힘.

### Step 2: subtract 실패 fallback tube 도 STL follow
- **수정 파일**: `frontend/src/features/v2/components/BabylonScene.tsx` (`useEffect(3.5)` fallback 분기)
- **변경 내용**: subtract null 반환 → 원본 tube 사용할 때도 `tube.parent = stlMesh` 를 붙이되 vertex 를 STL local 로 미리 변환 (`babylonMeshToManifold` 의 `tubeToStlLocal` 재사용). fallback 도 Step 1 의 skip 대상에 포함.
- **수용 기준**: STL 회전 시 fallback tube (침투 cut 실패한 Bridge) 도 STL 을 따라 이동.

### Step 3: Bridge cap 완벽 정렬 재도전 — mesh-level cap projection *(진행 시점 미정)*
- **수정 파일**: `frontend/src/features/v2/utils/support-render.ts`, `frontend/src/features/v2/utils/manifold-csg.ts`
- **변경 내용**: Catmull-Rom spline 대신 `createBridgeCurveTube` 결과 mesh 의 양 끝 cap ring vertex 들을 후처리로 `contactNormal` 평면에 projection. path tangent 우회 → cap 평면 표면 평행. 이후 manifold subtract.
- **수용 기준**: 굴곡 표면 (dome) 위 두 점 클릭으로 만든 Bridge 의 양 끝 cap 이 뷰포트에서 **표면 위 노출 픽셀 0** (뷰 확대 시 육안 확인).

### Step 4: thin shell 두께 raycast clamp *(진행 시점 미정)*
- **수정 파일**: `frontend/src/features/v2/components/BabylonScene.tsx` (STL pick 분기 PEN 계산)
- **변경 내용**: 픽 점에서 `-n` 방향 ray 로 반대편 표면 거리 = 두께. `PEN = min(radius + 0.1, thickness - 0.1)` 로 clamp. Bridge 에도 동일 적용 (기존 조건 `!bridge && n` 삭제).
- **수용 기준**: 두께 1.5mm STL (`_지_0629`, `denture ivoclar back 4mm.stl`) 위 Bridge 에서 반대편 표면에 cut 자국 없음.

### Step 5: normal 부호 자동 보정 — 근본 원인 파악 후 재적용 *(진행 시점 미정)*
- **수정 파일**: `frontend/src/features/v2/utils/stl-loader.ts` (또는 pick 분기)
- **변경 내용**: STL loader 단계에서 winding 부호 판정 → face normal 통일. pick 분기에서 매번 raycast 로 검증 X.
- **수용 기준**: `[bridge-add]` 로그 재활성화 후 `pick·n dot > 0` (outward) 인 케이스만 관찰.

### Step 6: Web Worker CSG (선택) *(진행 시점 미정)*
- **수정 파일**: 신규 `frontend/src/features/v2/workers/manifold.worker.ts`, `manifold-csg.ts` 리팩터
- **변경 내용**: `babylonMeshToManifold` + `subtract` + `manifoldToBabylonMesh` 를 worker 로. main → worker `postMessage({stlLocal positions/indices, tube positions/indices, params})`, worker → main `postMessage({positions, indices, normals})`. main 에서 mesh 생성.
- **수용 기준**: 새 Bridge 30 개 일괄 추가 시 UI 드래그·회전 프레임 유지 (< 20ms).

### Step 7: 옛 `coordSpace='world'` supports migration 정책 재검토 *(진행 시점 미정)*
- **수정 파일**: `frontend/src/features/v2/pages/ViewerV2Page.tsx` (현재 reverse migration), `hooks/useSupportsV2.ts`
- **변경 내용**: 신규 supports 는 저장 시점에 `stl-local` 저장. load 시 `world → stl-local` 자동 변환 (timing 안전한 `handle.worldToStlLocal` 사용, STL 로드 완료 후 1회).
- **수용 기준**: 옛 프로젝트 로드 → 재로드 후 서포트 위치 변화 0.

## 4. 인터페이스 / 다른 영역과의 경계 (중요)

### 4.1 담당 영역이 외부에 공개하는 것

| 심볼 | 위치 | 소비 측 |
|---|---|---|
| `SupportParams` (interface) | `support/types.ts` | `SupportParamsPanel`, `BabylonScene`, `auto-generate`, `support-render`, `defaults.ts` |
| `SupportParamKey` (type) | `support/types.ts` | `SupportParamsPanel` (슬라이더 rendering) |
| `SupportPointV2` (interface) | `support/types.ts` | `supports.repo`, `useSupportsV2`, `BabylonScene`, `ViewerV2Page`, `stl-export` |
| `DEFAULT_SUPPORT_PARAMS`, `SUPPORT_PARAM_LIMITS` | `support/utils/defaults.ts` | `SupportParamsPanel`, `useSupportParamsStore` reset |
| `useSupportParamsStore` (zustand) | `support/hooks/useSupportParamsStore.ts` | `SupportParamsPanel`, `ViewerV2Page` (BabylonScene 에 prop 전달), overhang 시각화 |
| `SupportParamsPanel` (컴포넌트) | `support/components/SupportParamsPanel.tsx` | `ViewerV2Page` 우측 패널 |
| `useSupportsV2()` → `{ supports, addMany, patchSupport, remove, clearAll, clearForStl, refresh }` | `hooks/useSupportsV2.ts` | `ViewerV2Page` |
| `autoGenerateSupportPoints(scene, mesh, others, params, projectId, stlId)` | `support/utils/auto-generate.ts` | `BabylonScene.handle.generateAutoSupports` |
| `getBridgePathPoint / findClosestT / isStraightCps / straightCps / insertControlPoint / removeControlPoint` | `utils/bridge-path.ts` | `BabylonScene` (Bridge 위 클릭 t 계산, cp 편집), `ViewerV2Page.followAttachedChildren` |

### 4.2 `BabylonScene` props / handle 중 서포트 관련 (= 담당 영역과 STL·씬·edit-tool 담당 사이 계약)

| 접점 | 담당 방향 | 내용 |
|---|---|---|
| `supports: SupportPointV2[]` | 밖 → 안 | 렌더 대상 서포트 목록 |
| `supportParams: SupportParams` | 밖 → 안 | 굵기 등 mesh 파라미터 |
| `onAddSupportAt(stlId, contact, normal?, attachedTo?)` | 안 → 밖 | STL/기둥 표면 픽 시 새 서포트 요청. `contact` 는 이미 표면 안쪽 push 된 좌표 |
| `onPickSupport(id \| null)` | 안 → 밖 | 서포트 선택 변경 |
| `onMoveSupport(id, newBaseXZ)` | 안 → 밖 | trunk gizmo 이동 결과 |
| `onMoveBridgeControlPoint(id, idx, pos)` | 안 → 밖 | 변곡점 drag 종료 |
| `onMoveBridgeEndpoint(id, "base" \| "contact", pos)` | 안 → 밖 | 끝점 drag 종료 |
| `onDoublePickBridgeTube(id, hitPoint)` | 안 → 밖 | Bridge tube 더블 클릭 → cp 추가 |
| `onSelectBridgeControlPoint(id, idx)` | 안 → 밖 | cp 단일 클릭 (Delete 처리용) |
| `pendingBridgePoint`, `bridgeMode` | 밖 → 안 | Bridge 두 단계 클릭 상태 |
| `selectedSupportId` | 밖 → 안 | 강조 표시 |
| `editMode: "select" \| "support"` | 밖 → 안 | 모드별 픽 분기 |
| `handle.generateAutoSupports(projectId, params) → SupportPointV2[]` | 밖에서 호출 | 자동 생성 (repo 저장은 호출측) |
| `handle.autoRouteBridge(base, contact, cps, excludeStlIds)` | 밖에서 호출 | Bridge 자동 우회 (현재 미호출) |
| `handle.worldToStlLocal / stlLocalToWorld` | 밖에서 호출 | migration/reverse 에 사용 |

### 4.3 담당 영역이 의존하는 외부 (변경 시 이쪽 코드도 영향)

| 접점 | 위치 | 상대 담당 |
|---|---|---|
| `STLFileV2` type | `types/stl.ts` | STL 관리 담당 미지정 |
| `useStlFilesV2` | `hooks/useStlFilesV2.ts` | STL 관리 담당 미지정 |
| `TransformV2` type | `types/transform.ts` | Transform/Gizmo 담당 미지정 |
| `useUndoStore` | `hooks/useUndoStore.ts` | Undo 담당 미지정 |
| STL loader → Babylon Mesh (winding·normal 부호) | `utils/stl-loader.ts` | 미지정. **Step 5 관련** — normal 부호 문제의 근본은 여기 |
| `meshesToStlBlob` (`utils/stl-export.ts`) | 서포트 mesh 도 export 함 | 미지정 |
| `sliceMeshAtY`, `rasterizePolygons`, `buildPolygonFillMesh` | `utils/slice-*.ts` | 미지정 |
| BabylonScene 안의 STL mesh map (`meshMapRef`) | `BabylonScene.tsx` (공유) | 미지정과 공용 |
| manifold-3d wasm (`manifold.wasm`) 로딩 | Vite dep-optimize | 미지정 |
| IndexedDB 스토어 스키마 (`STORE_SUPPORTS`, indices `by_project`, `by_stl`, `by_base_stl`) | `data/db.ts` | 미지정 |

**협의 필요 케이스**:
- `SupportPointV2` 에 필드 추가/삭제 → repo, useSupportsV2, BabylonScene, ViewerV2Page, stl-export 6곳 동시 변경
- STL loader 의 normal 부호 정책 변경 → 서포트 자동 생성·수동 push 두 곳 즉시 영향
- STL cascade 삭제 정책 변경 → `deleteSupportsByStl` 의 `by_base_stl` 인덱스 스캔 로직 재검토
- Gizmo commit 흐름 변경 → `handleCommitTransform` 안 서포트 patch chain 이 이 계약에 의존

## 5. 검증 방법

`npm run dev` (Vite `:5173`) 로 `localhost:5173/v2` 진입 후:

1. `denture ivoclar back 4mm.stl` 로드 → **자동 생성** 클릭 → STL 저면에 서포트 점 생성 확인
2. Support 파라미터 슬라이더 (기둥 굵기 0.6 → 1.0) → mesh 굵기 즉시 바뀜 (`buildSupportKey` 갱신 → 재생성)
3. Bridge 모드 ON → dome 양쪽 두 점 클릭 → 직선 tube 생성, 양 끝 cap 이 표면 안쪽으로 잠김
4. Bridge 위 변곡점 (노랑 sphere) drag → 곡선으로 변형
5. Bridge tube 더블 클릭 → 변곡점 1개 추가 (path 위 hit t 위치)
6. STL 선택 후 gizmo 회전 (Rotate 모드, Z +90°) → **드래그 중 서포트 즉시 따라가고 프레임 안 끊김**
7. STL 삭제 → 그 STL 이 base 또는 contact 인 서포트 모두 사라짐 (`deleteSupportsByStl` cascade)
8. Undo (`Ctrl+Z`) × 3 → 위 편집 역순 복구
9. **STL 내보내기** → 결과 STL 안에 서포트 tube 포함 (mesh union)

## 6. 비범위 (이번에 하지 않는 것)

- STL 로드/파싱 파이프라인 (`utils/stl-loader.ts`) — Step 5 는 인터페이스만 확인, 구현은 STL 담당
- Slice mask · CTB export · Layer preview — 소비만 함, 로직은 slice 담당
- Transform Gizmo 인프라 (Babylon `GizmoManager` wrapping) — commit 시 서포트 patch 만 이쪽
- 프로젝트/파일 관리 UI (`ProjectsV2Page`, `StlFileList`) — Repo 만 사용
- Undo/Redo 스토어 자체 (`useUndoStore`) — push 만 이쪽
- 카메라 프리셋·bounding-box fit — `applyViewPreset`, `frameCameraToMeshes` 소비만
- 프린터 프로파일 (`usePrinterProfileStore`) — `plateWidthMm/plateDepthMm` 만 소비
- GitHub 프로젝트 sync (`utils/github-projects.ts`, `PROJECT_ARCHIVE`) — 서포트 데이터는 archive 에 포함되지만 archive 형식은 별도 담당
