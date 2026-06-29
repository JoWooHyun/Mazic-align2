# Bridge tube STL 침투 처리 작업 정리

마지막 업데이트: 2026-06-29
기준 commit: `526be4b` (js-clipper 의존성). 이후 working tree = manifold-3d 도입.

## 사용자 요구

A→B 두 점 사이 **직선** Bridge tube 가 STL 표면과 만나는 부분:
- **빈틈 0** (cap 가장자리/옆면이 표면 안쪽 묻혀 매끈한 노출선)
- **반대편 침투 X** (cap 이 모델 두께 뚫고 반대편으로 노출 X)
- **굴곡 표면** 에서도 동일

사용자 알고리즘 (최종):
1. STL mesh 구조 확인
2. Bridge a, b 지점이 STL mesh 와 vertex level 일치
3. void 0 (smooth 연결)
4. 0.1mm 침투
5. 0.1mm 이상 다른 mesh 벽 안 만남

## 시도 정리

### C — 양 끝 PEN ray cast (폐기)
- thin shell STL 에서 PEN clamp 매우 작음 → cap 가장자리 외부 노출

### B — 단순 CSG (다운, 폐기)
- 큰 STL × Babylon CSG = 컴퓨터 다운

### B+ — setTimeout 디바운스 + cache (멈춤, 폐기)
- 300ms 디바운스 도 멈춤 보고 → revert

### A — SDF voxel + ShaderMaterial discard (실효성 X, 폐기)
- thin shell STL inside 9.5% → cap 가장자리 outside → discard 안 됨
- dilate / flood fill / 3축 vote / LINEAR threshold 모두 효과 X

### Cap mesh vertex deformation (성능 X, 폐기)
- Bridge 마다 cap ring × 2 ray cast → 다운

### ✅ manifold-3d wasm CSG (현재 working tree)
- npm: `manifold-3d` (wasm 기반 CSG, 기존 Babylon CSG 보다 100배 빠름)
- STL → manifold 변환 시 `mesh.merge()` 호출 (vertex dedup → manifold 화)
- triVerts winding flip (Babylon left-handed CW → manifold CCW outward)
- Bridge tube manifold.subtract(STL manifold) → STL 안 부분 cut
- 결과 mesh winding 다시 flip (Babylon CW) → stl-export 일관 처리
- **cache**: supportId + (contact, base, cps, diameter) — 같으면 vertex data 재사용 (manifold 호출 X)

성능:
- STL → manifold 변환 1회 (큰 STL 약 3초)
- Bridge subtract 1회 약 150~200ms (cache miss 시)
- cache hit 시 0ms

알려진 한계:
- STL 회전 시 patch chain → contact 좌표 매번 변경 → cache key 변경 → 매번 miss (Bridge 수 × ~150ms freeze)
- 향후: STL local 좌표 기반 subtract 또는 디바운스로 해결

## 현재 working tree (526be4b 이후)

| 파일 | 변경 |
|---|---|
| `package.json` | `manifold-3d` 추가 |
| `utils/manifold-csg.ts` | **신규** — ensureManifoldReady, babylonMeshToManifold, manifoldToBabylonMesh, applyInverseTransform |
| `components/BabylonScene.tsx` | manifold import, refs (manifoldModuleRef, stlManifoldMapRef, bridgeClipCacheRef), STL load 시 manifold 생성, supports useEffect 의 Bridge 면 clipBridgeWithManifold, cache key/lookup, PEN = 0.1mm |
| `support-render.ts` | createSupportMesh material 타입 Material → StandardMaterial (manifold 결과 mesh 도 StandardMaterial) |
| `stl-sdf.ts` | 삭제 (A 폐기) |
| `bridge-clip-material.ts` | 삭제 (A 폐기) |

## 핵심 동작

1. **STL load** → `babylonMeshToManifold(stlMesh)` → `mesh.merge()` → `Manifold` 생성 → `stlManifoldMapRef.set(stlId, manifold)`
2. **Bridge mesh 생성** → `clipBridgeWithManifold(tube, point, ...)`
   - cache hit (같은 supportId+좌표+굵기) → vertex data 로 mesh 즉시 생성
   - miss → `tubeMan.subtract(stlMan)` → 결과 → `manifoldToBabylonMesh` (winding flip) → cache 저장
3. **STL export** → 모든 mesh 의 indices winding swap (Babylon CW → STL CCW). manifold 결과도 동일 적용됨.

## dev 환경

- `:5173` = Vite dev server (최신 hot reload)
- `:5000` = backend Express
- start-dev.bat 의 자동 열기 URL: `localhost:5173/v2`
