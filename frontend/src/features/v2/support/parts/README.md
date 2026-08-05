# 서포트 부품 STL (S-4b-1, B안 = 부품 STL 조립)

서포트 형상을 코드의 MeshBuilder 로 직접 만들지 않고, 이 폴더의 **단위 크기
프리미티브 STL** 을 로드 → 스케일 → 배치 → 병합해 화살촉+기둥을 조립한다
(리드 결정 2026-08-05, 설계서 `docs/설계_서포트재설계_20260720.md` 9장 결정 #7).
부품이 데이터라 나중에 형상 교체·다양화가 쉽다.

## 규격 (CHITUBOX 관례 준수)

- **단위 크기**: 지름 ⌀1.0mm (반지름 0.5mm).
- **좌표계**: Z-up. 조립 코어(`assemble-core.ts`)가 부품을 스케일·회전·이동해
  최종 형상을 만든 뒤, Babylon 래퍼(`assemble-support.ts`)에서 씬 좌표로 옮긴다.
- **바닥 Z=0**: 방향성 있는 부품(cone/cylinder)은 바닥면이 Z=0 에서 시작한다.

| 파일 | 형상 | 크기 (단위) |
|---|---|---|
| `sphere.stl` | 구 | ⌀1.0, 중심 원점 |
| `cone.stl` | 원뿔 | 밑면 ⌀1.0 (Z=0), 꼭짓점 (0,0,1) |
| `cylinder.stl` | 원기둥 | ⌀1.0, Z 0→1 |

## CHITUBOX 원본 미사용 (중요)

CHITUBOX 원본 STL 은 재배포 우려로 **쓰지 않는다.** 여기 3종은 전부
`frontend/scripts/gen-support-parts.mjs` 로 자체 생성한 것이다.

## 재생성

```
cd frontend
node scripts/gen-support-parts.mjs
```

원주 분할 수는 스크립트의 `SEGMENTS`(기본 24)로 조절한다. 산출물은 바이너리 STL
(80바이트 헤더 + uint32 삼각형 수 + 50바이트/삼각형)이며, 로더
(`parts-cache.ts`)의 자체 파서가 이 포맷을 읽는다.
