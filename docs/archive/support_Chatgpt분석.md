# CHITUBOX 1.9.4 기반 Auto Support 알고리즘 설계서 V1

## 1. 목적

본 알고리즘의 목적은 DLP/LCD/SLA 계열 레진 3D 프린팅용 모델에 대해 자동으로 다음 구조를 생성하는 것이다.

```text
Model
  │
  ├─ Contact Point
  │      │
  │      ▼
  │     Tip
  │      │
  │      ▼
  │   Small Branch
  │      │
  │      ├── 다른 Tip과 병합
  │      ▼
  │   Main Trunk
  │      │
  │   Cross Brace
  │      │
  │      ▼
  └──── Base / Raft
```

단순히 오버행 아래에 수직 기둥을 세우는 것이 아니라,

1. Low Point 검출
2. Island 검출
3. Overhang 검출
4. Density 기반 접점 Sampling
5. 필수 접점 보존
6. Support Point 필터링
7. Support Tree 생성
8. Branch/Fork 생성
9. 충돌 회피
10. Cross Brace 생성
11. 누락 영역 재검사
12. Auto Supplement

순서로 처리한다.

---

# 2. 전체 처리 Pipeline

```text
                ┌─────────────────┐
                │   Input Mesh    │
                │ STL / OBJ / 3MF │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Mesh Preprocess │
                │ Normal / BVH    │
                └────────┬────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
    Low Point       Overhang        Layer Island
    Detector        Detector         Detector
          │              │              │
          └──────────────┼──────────────┘
                         ▼
                Support Candidates
                         │
                         ▼
                 Density Sampling
                         │
                         ▼
                  Point Filtering
                         │
                         ▼
                 Priority Sorting
                         │
                         ▼
                Support Tree Builder
                  │            │
                  ▼            ▼
               Branch        Trunk
                  │            │
                  └─────┬──────┘
                        ▼
                Collision Check
                        │
                        ▼
                   Cross Brace
                        │
                        ▼
               Coverage Validation
                        │
                        ▼
                 Auto Supplement
                        │
                        ▼
                Support Mesh Build
```

---

# 3. 핵심 자료구조

## 3.1 SupportPoint

```cpp
struct SupportPoint
{
    Vec3 position;       // 실제 모델과 접촉하는 XYZ 위치
    Vec3 normal;         // 접촉 삼각형의 법선

    float surfaceAngle;  // 플랫폼과 해당 면 사이의 각도
    float priority;      // Support 생성 우선순위

    bool mandatory;      // 반드시 유지해야 하는 Support Point인가?
    bool isLowPoint;     // Local Low Point에서 생성되었는가?
    bool isIsland;       // Island 시작점인가?
    bool isOverhang;     // 일반 Overhang Sampling Point인가?

    int triangleId;      // 원본 Mesh Triangle 번호
    int layerIndex;      // 해당 위치의 Slice Layer

    bool accepted;
};
```

여기에서 가장 중요한 것은

```cpp
mandatory
```

이다.

CHITUBOX 1.9.4의 Angle 실험에서 30° 설정에서도 중앙의 핵심 Support가 하나 남았다.

따라서 다음 Point들은 Density나 일반 Angle Sampling과 별개로 취급한다.

```text
Low Point
Island 시작점
매우 작은 독립 영역의 최초 접점
```

이들은 `mandatory = true`로 지정한다.

---

# 4. Mesh Preprocess

Auto Support를 실행하기 전에 모델에 대한 공간 자료구조를 만든다.

필요 데이터:

```text
Triangle
Vertex
Triangle Normal
Vertex Normal
Triangle adjacency
Vertex adjacency
Bounding Box
BVH
```

추천 자료구조:

```text
Mesh BVH
```

BVH는 이후 다음 작업에 계속 사용한다.

```text
Ray Casting
Support → Model Collision 검사
Model 아래쪽 교차 검사
Support 접촉 위치 검사
```

예:

```cpp
void preprocessMesh(Mesh& mesh)
{
    mesh.calculateTriangleNormals();

    mesh.buildVertexAdjacency();
    mesh.buildTriangleAdjacency();

    // Support와 모델 충돌 검사를 매우 많이 수행하기 때문에
    // 반드시 BVH와 같은 공간 가속 구조를 만들어둔다.
    mesh.buildBVH();
}
```

---

# 5. Overhang Detector

CHITUBOX 테스트 결과를 보면 Angle 값은 **Support가 필요한 면의 범위를 결정하는 임계값** 역할을 한다.

실험 결과:

```text
Angle 30° → 극히 일부
Angle 45° → 일반적인 Support 영역
Angle 60° → 더 넓은 영역
```

따라서 각 Triangle에 대해 먼저 플랫폼과 면의 각도를 계산한다.

Build 방향:

```cpp
Vec3 buildDir = {0, 0, 1};
```

Triangle Normal:

```cpp
Vec3 n;
```

플랫폼과 면 사이의 기울기:

```cpp
float angle =
    acos(abs(dot(n, buildDir))) * RAD_TO_DEG;
```

결과:

```text
Horizontal Surface → 약 0°
Vertical Surface   → 약 90°
```

단, 위쪽 면까지 Support 대상으로 들어가면 안 되므로 법선 방향을 추가 검사한다.

```cpp
if (normal.z >= 0)
{
    // 위를 향한 면이므로 일반적으로 Support 불필요
    continue;
}
```

최종 후보 조건:

```cpp
if (normal.z < 0 &&
    surfaceAngle <= supportAngle)
{
    overhangTriangle = true;
}
```

---

# 6. Layer 기반 Overhang 검증

Mesh Normal만 사용하면 복잡한 치아나 자유곡면에서 오검출이 발생할 수 있다.

따라서 Layer 기반 검증을 병행하는 것을 권장한다.

Layer 높이가:

```text
h
```

Support Angle이:

```text
θ
```

라면 이전 Layer가 다음 Layer를 지지할 수 있는 수평 거리를 다음처럼 정의할 수 있다.

[
r = h \cdot \cot(\theta)
]

예를 들어 Layer Height가 0.05 mm일 경우:

```text
θ = 30°
r ≈ 0.0866 mm

θ = 45°
r = 0.0500 mm

θ = 60°
r ≈ 0.0289 mm
```

Angle이 커질수록 허용되는 수평 확장이 작아진다.

따라서 더 많은 영역이 Unsupported로 판정된다.

이는 실제 CHITUBOX 테스트의:

```text
30° < 45° < 60°
Support 증가
```

경향과도 일치한다.

Layer Mask를 다음과 같이 정의한다.

```text
CurrentMask
PreviousMask
```

이전 Layer를 `r`만큼 확장한다.

```cpp
supportedArea = dilate(previousMask, r);
```

현재 Layer에서 차감한다.

```cpp
unsupported =
    currentMask - supportedArea;
```

이 영역이 바로 추가적인 Support 후보 영역이다.

---

# 7. Low Point Detector

이 부분은 Auto Support에서 매우 중요하다.

CHITUBOX EXE에도:

```text
DetermineSupPnt_determineLowPnts
```

라는 구조가 확인되었고, 실제 실험에서도 Angle 30°에서 핵심 Low Point가 남았다.

## 7.1 Vertex Local Minimum

각 Vertex의 1-ring Neighbor를 조사한다.

```cpp
bool isLocalLowPoint(Vertex v)
{
    for (Vertex neighbor : v.neighbors)
    {
        if (neighbor.z < v.z - epsilon)
        {
            return false;
        }
    }

    return true;
}
```

단순히 이것만 사용하면 원통 둘레처럼 동일한 Z를 가지는 Vertex가 모두 Low Point가 될 수 있다.

그래서 Plateau 처리가 필요하다.

---

# 8. Plateau Low Point

다음 형태가 있을 수 있다.

```text
────────────
```

바닥 전체가 같은 Z라면 수십~수백 개 Vertex가 모두 Low Point가 된다.

따라서 동일 높이 Vertex를 하나의 Component로 묶는다.

조건:

```cpp
abs(v1.z - v2.z) < lowPointZEpsilon
```

동일 Plateau 그룹에서 대표 Point만 뽑는다.

대표 위치 후보:

```text
Centroid
Boundary extrema
Poisson sample
```

작은 Plateau라면:

```text
Centroid 1개
```

넓다면:

```text
Density 기반 여러 개
```

를 생성한다.

---

# 9. Island Detector

레진 출력에서는 Low Point 이상으로 중요한 것이 Island다.

Slice Layer를 비교한다.

```text
Layer N-1
     ↓
Layer N
```

현재 Layer 영역 중 이전 Layer 및 기존 Support와 전혀 연결되지 않은 Connected Component를 찾는다.

```cpp
islands =
    connectedComponents(unsupportedMask);
```

각 Island가 처음 나타나는 Layer에서는 반드시 Support가 필요하다.

따라서:

```cpp
point.mandatory = true;
point.isIsland = true;
```

로 지정한다.

### Island 대표 Point

단순 Centroid보다 Distance Transform 사용을 권장한다.

```text
Island Mask

██████████
██████████
██████████
```

경계에서 가장 먼 점을 찾는다.

```cpp
point =
    maxDistanceTransform(islandMask);
```

이 위치는 Island 내부에서 비교적 안정적인 Support Point가 된다.

---

# 10. Support Candidate 통합

현재 세 가지 후보가 존재한다.

```text
Low Point
Island Point
Overhang Point
```

합친다.

```cpp
candidatePoints =
    lowPoints
    + islandPoints
    + overhangPoints;
```

Priority는 다음과 같이 둔다.

```text
Priority 100 : Island Start
Priority 90  : True Low Point
Priority 50  : 일반 Overhang
Priority 20  : Supplement 후보
```

이 값은 실제 CHITUBOX 값이 아니라 **우리 구현용 우선순위**다.

---

# 11. Density → Sampling Distance

현재 CHITUBOX의 정확한 `Density → mm` 변환식은 아직 확인되지 않았다.

따라서 내부에서는 Density를 직접 사용하지 않고 다음 값을 사용하는 구조를 권장한다.

```cpp
float contactSpacing;
```

즉:

```text
UI Density
    ↓
Density Mapper
    ↓
Contact Spacing(mm)
```

로 분리한다.

초기 구현 예:

```cpp
float densityToSpacing(float density)
{
    const float minSpacing = 1.5f;
    const float maxSpacing = 8.0f;

    float t = clamp(density / 100.0f, 0.0f, 1.0f);

    return maxSpacing -
           (maxSpacing - minSpacing) * pow(t, 0.8f);
}
```

주의:

> 이 공식은 CHITUBOX 공식이 아니다.

우리가 나중에 실제 Support Point 좌표를 측정하면서 조정할 Calibration 함수다.

따라서 반드시 Parameter화한다.

```cpp
struct DensitySettings
{
    float minSpacing;
    float maxSpacing;
    float exponent;
};
```

---

# 12. Support Point Sampling

일반 Overhang 영역에는 균일 Grid보다 **Poisson Disk Sampling**을 추천한다.

이유:

Grid:

```text
● ● ● ●
● ● ● ●
● ● ● ●
```

에서는 모델 방향에 따라 규칙적인 줄무늬가 생긴다.

Poisson Disk:

```text
●     ●
   ●
      ●    ●
 ●
```

은 일정 최소거리는 유지하면서 과도하게 규칙적이지 않다.

조건:

```cpp
distance(p1, p2) >= contactSpacing;
```

단 Mandatory Point는 먼저 삽입한다.

```cpp
samples.add(allMandatoryPoints);

for(candidate : optionalCandidates)
{
    if(distanceToNearestSample(candidate) >= spacing)
        samples.add(candidate);
}
```

---

# 13. Edge Margin

Support가 정확히 Edge 위에 있으면 접촉부 파손 및 변형 가능성이 커진다.

따라서 후보점에서 가까운 Mesh Boundary까지 거리를 계산한다.

예:

```cpp
if (distanceToEdge < edgeMargin)
{
    // 특별히 Low Point가 아니라면 제거
    if (!point.mandatory)
        reject(point);
}
```

CHITUBOX 1.9.4 설정에서도 이와 유사한 Edge Margin 값이 확인된다.

Mandatory Low Point가 정확히 Edge라면 제거하지 말고 조금 안쪽으로 이동시킨다.

---

# 14. Support Tree Builder

여기부터가 CHITUBOX 스타일 자동 Support의 핵심이다.

Contact마다 Base까지 독립적으로 기둥을 만들지 않는다.

```text
●      ●      ●

│      │      │
│      │      │
```

대신 가능한 경우:

```text
●      ●      ●
 \     |     /
  \    |    /
    \  |  /
      \|/
       │
       │
       │
```

형태로 병합한다.

---

# 15. Main Trunk 검색

각 Contact Point에서 아래쪽으로 Main Trunk 후보를 찾는다.

XY Spatial Index를 만든다.

```cpp
KDTree trunkTree;
```

또는 CHITUBOX 구조와 비슷하게:

```text
QuadTree
```

를 사용할 수 있다.

검색:

```cpp
nearTrunks =
    trunkTree.queryRadius(
        contact.xy,
        maxOffsetFromContact
    );
```

초기값:

```text
maxOffsetFromContact = 3 mm
```

정도를 사용할 수 있다.

---

# 16. Branch 연결 가능 조건

Contact:

```text
P
```

Main Trunk의 연결점:

```text
Q
```

수평거리:

[
d_{xy}
]

수직거리:

[
d_z
]

Branch 길이:

[
L=\sqrt{d_{xy}^2+d_z^2}
]

Branch가 수직축과 이루는 각도:

[
\phi =
\tan^{-1}\left(
\frac{d_{xy}}{d_z}
\right)
]

연결 조건:

```cpp
if (dXY <= maxOffset &&
    branchLength <= maxBranchLength &&
    angle <= maxBranchAngle &&
    !collision)
{
    connect();
}
```

초기 Parameter:

```text
maxOffset            = 3.0 mm
maxBranchLength      = 3.0 mm
maxBranchAngle       = 70°
```

CHITUBOX 1.9.4에서 확인된 설정 구조와 유사한 값이다.

---

# 17. Branch Endpoint 결정

Contact가 Main Trunk에서 2 mm 떨어져 있다고 가정한다.

```text
Contact ●
        |
        | horizontal offset = 2mm
        |
        │ Main Trunk
```

바로 수평으로 연결하면 구조적으로 좋지 않다.

최대 Branch Angle을 70°라고 하면 필요한 최소 Vertical Drop은:

[
dz_{\min}
=========

\frac{d_{xy}}{\tan(70^\circ)}
]

예:

```text
dXY = 2 mm

dz ≈ 0.73 mm
```

따라서 연결점은 Contact보다 최소 0.73 mm 아래에 위치해야 한다.

```cpp
float minimumDrop =
    dXY / tan(maxBranchAngle);
```

---

# 18. Main Trunk 생성

기존 Trunk에 연결할 수 없다면 새 Trunk를 생성한다.

```cpp
Trunk trunk;

trunk.xy = initialContact.xy;
trunk.topZ = contact.z;
trunk.bottomZ = platformZ;
```

다만 Contact 바로 아래에 모델이 있을 수 있으므로 Ray Cast를 수행한다.

```cpp
Ray ray(
    contact.position,
    Vec3(0,0,-1)
);

Hit hit = meshBVH.intersect(ray);
```

---

# 19. Platform Support / Model Support 구분

아래쪽 Ray가 Platform까지 아무것도 만나지 않으면:

```text
Contact
   │
   │
   │
Platform
```

Platform Support다.

반대로 아래쪽에서 모델을 먼저 만나면:

```text
Upper Model
     ●
     │
     │
Lower Model
██████████
```

Model-to-Model Support다.

이 경우 Bottom Geometry를 일반 Base가 아닌 **Model Contact Tail** 형태로 변경한다.

---

# 20. Collision Checker

모든 Branch/Trunk는 생성 전에 모델과 교차 여부를 검사해야 한다.

Support를 단순 Line으로 검사하면 실제 원통 반경을 무시하게 된다.

따라서 **Capsule Collision**을 사용하는 것이 좋다.

```cpp
bool collision =
    meshBVH.intersectsCapsule(
        start,
        end,
        supportRadius + clearance
    );
```

여기서:

```text
supportRadius
+
modelClearance
```

를 포함한다.

---

# 21. Auto Avoid

Branch가 모델과 충돌하면 바로 포기하지 않는다.

다음 후보를 탐색한다.

```text
기존 방향
   ↓
충돌

±15°
±30°
±45°
```

예:

```cpp
for(float angleOffset :
    {15, -15, 30, -30, 45, -45})
{
    candidate =
        rotateAroundZ(original, angleOffset);

    if(!collision(candidate))
        return candidate;
}
```

모든 경로가 실패하면:

```text
새 Main Trunk 생성
```

으로 fallback한다.

---

# 22. Support Merge

Main Trunk끼리도 너무 가까우면 병합할 수 있다.

예:

```text
│     │
│     │
│     │
```

두 Trunk의 거리가 설정값보다 작으면:

```text
 \   /
  \ /
   │
   │
```

형태로 합친다.

단 다음을 만족해야 한다.

```text
충돌 없음
Angle 제한 통과
Branch 길이 제한 통과
Trunk 직경이 충분함
```

---

# 23. Support Tree 자료구조

```cpp
enum class SupportNodeType
{
    Contact,
    Tip,
    Branch,
    Fork,
    Trunk,
    Base
};

struct SupportNode
{
    SupportNodeType type;

    Vec3 position;

    float diameter;

    SupportNode* parent;

    vector<SupportNode*> children;
};
```

예:

```text
        Contact
           │
          Tip
           │
        Branch
          /
Contact ─Fork
          │
        Trunk
          │
         Base
```

Tree 형태로 만들어두면 Support 편집도 매우 쉬워진다.

예를 들어 사용자가 Contact 하나를 삭제하면:

```text
Child 제거
   ↓
Fork Child 수 검사
   ↓
Child가 1개밖에 없으면 Fork 제거
   ↓
Trunk 재구성
```

을 수행할 수 있다.

---

# 24. Cross Brace 생성

세로 Trunk만 존재하면 높은 Support 구조가 흔들릴 수 있다.

따라서 일정 높이 이상부터 주변 Trunk를 연결한다.

예:

```text
│       │
│\     /│
│ \   / │
│  \ /  │
│  / \  │
│ /   \ │
│       │
```

초기 조건:

```text
crossStartHeight = 3 mm
maxCrossDistance = 10 mm
crossZSpacing    = 2~5 mm
```

근처 Trunk 검색:

```cpp
neighbors =
    trunkTree.queryRadius(
        current.xy,
        maxCrossDistance
    );
```

---

# 25. Cross 연결 방향

모든 Cross가 같은 높이에 생기면 복잡한 Resin Trap이 생길 수 있다.

따라서 높이를 교대로 배치한다.

```text
Z = 5mm     /
Z = 8mm     \
Z = 11mm    /
Z = 14mm    \
```

또한 같은 Pair를 계속 연결하지 않는다.

```cpp
if (alreadyConnected(A,B))
    continue;
```

---

# 26. Coverage Validation

1차 Support가 완성된 뒤 반드시 다시 검증한다.

이 단계가 없으면 복잡한 치아/피규어/자유곡면에서 작은 Island를 놓치기 쉽다.

Layer마다:

```text
Model Mask
Existing Model Support
Generated Support Mask
```

를 비교한다.

현재 Layer에서 지지되지 않는 부분:

```cpp
unsupported =
    currentModel
    - supportedFromPreviousLayer
    - supportCoverage;
```

---

# 27. Missing Region 검출

Unsupported Mask에서 Connected Component를 찾는다.

```cpp
regions =
    connectedComponents(unsupported);
```

너무 작은 Noise는 제거한다.

```cpp
if(region.area < minimumIslandArea)
    ignore();
```

큰 영역은 추가 Support 필요.

---

# 28. Supplement Point 결정

누락 영역에서 아무 곳이나 선택하지 않는다.

Distance Transform을 사용한다.

```text
██████████
██████████
██████████
```

가장자리까지 가장 먼 지점:

```text
██████████
████●█████
██████████
```

을 새로운 Support Point로 잡는다.

```cpp
p =
    region.maximumDistancePoint();
```

그리고 기존 Support와 너무 가깝다면 두 번째 최대점을 찾는다.

---

# 29. 반복 Supplement

한 번 추가했다고 끝내지 않는다.

```cpp
for(int iteration = 0;
    iteration < maxSupplementIteration;
    ++iteration)
{
    unsupported =
        evaluateCoverage();

    if(unsupported.empty())
        break;

    addSupplementPoints(unsupported);

    rebuildSupportTree();
}
```

추천:

```text
maxSupplementIteration = 3~5
```

정도.

---

# 30. 최종 Geometry Generator

Tree 데이터가 확정된 뒤 실제 STL/Triangle Mesh를 만든다.

Contact 구조:

```text
         Model
████████████████
        ╱
       ● Contact
       │
       │ Tip
       │
```

Parameter 예:

```text
Contact diameter : 0.50 mm
Contact depth    : 0.30 mm

Upper diameter   : 0.30 mm
Lower diameter   : 0.80 mm

Connection length: 2.00 mm
```

이 값들은 현재 CHITUBOX 테스트 화면에 보이는 Light 설정값을 예로 든 것이다.

---

# 31. 전체 의사코드

```cpp
SupportResult generateAutoSupport(
    Mesh& mesh,
    SupportSettings settings)
{
    // ----------------------------------------------------
    // STEP 1
    // Mesh 전처리
    // ----------------------------------------------------

    preprocessMesh(mesh);

    // Triangle Normal, adjacency, BVH 등을 생성한다.


    // ----------------------------------------------------
    // STEP 2
    // Low Point 검출
    // ----------------------------------------------------

    auto lowPoints =
        detectLowPoints(mesh);

    // Low Point는 Density와 무관하게
    // 매우 높은 우선순위를 부여한다.

    for(auto& p : lowPoints)
    {
        p.mandatory = true;
        p.priority = 90;
    }


    // ----------------------------------------------------
    // STEP 3
    // Layer Island 검출
    // ----------------------------------------------------

    auto islandPoints =
        detectLayerIslands(
            mesh,
            settings.layerHeight,
            settings.supportAngle
        );

    for(auto& p : islandPoints)
    {
        // Island 시작점은 반드시 지지해야 한다.
        p.mandatory = true;
        p.priority = 100;
    }


    // ----------------------------------------------------
    // STEP 4
    // Angle 기반 Overhang 검출
    // ----------------------------------------------------

    auto overhangRegions =
        detectOverhang(
            mesh,
            settings.supportAngle
        );


    // ----------------------------------------------------
    // STEP 5
    // Density → Contact 간격
    // ----------------------------------------------------

    float spacing =
        densityToSpacing(
            settings.density
        );

    // CHITUBOX 정확한 공식이 확인되기 전까지는
    // 독립된 Calibration 함수로 관리한다.


    // ----------------------------------------------------
    // STEP 6
    // 일반 Support Point Sampling
    // ----------------------------------------------------

    auto normalPoints =
        poissonSample(
            overhangRegions,
            spacing
        );

    for(auto& p : normalPoints)
    {
        p.priority = 50;
    }


    // ----------------------------------------------------
    // STEP 7
    // 후보점 통합
    // ----------------------------------------------------

    vector<SupportPoint> candidates;

    candidates += islandPoints;
    candidates += lowPoints;
    candidates += normalPoints;


    // ----------------------------------------------------
    // STEP 8
    // 중복 제거
    // ----------------------------------------------------

    removeDuplicatePoints(
        candidates,
        settings.minimumPointDistance
    );

    // 단 Mandatory Point는 우선 보존한다.


    // ----------------------------------------------------
    // STEP 9
    // Edge / Model 거리 필터
    // ----------------------------------------------------

    filterEdgePoints(candidates);
    filterInvalidContact(candidates);


    // ----------------------------------------------------
    // STEP 10
    // Priority 순 정렬
    // ----------------------------------------------------

    sort(
        candidates.begin(),
        candidates.end(),
        [](auto& A, auto& B)
        {
            return A.priority >
                   B.priority;
        }
    );


    // ----------------------------------------------------
    // STEP 11
    // Main Support Tree 생성
    // ----------------------------------------------------

    SupportForest forest;

    for(auto& contact : candidates)
    {
        // 해당 Contact와 연결 가능한
        // 기존 Main Trunk 검색

        auto trunks =
            findNearbyTrunks(
                contact,
                settings.maxOffset
            );

        bool connected = false;

        for(auto& trunk : trunks)
        {
            if(canConnect(
                contact,
                trunk,
                settings))
            {
                // 가까운 기존 Trunk에
                // Branch/Fork 형태로 연결한다.

                connectToTrunk(
                    contact,
                    trunk
                );

                connected = true;
                break;
            }
        }

        if(!connected)
        {
            // 기존 Trunk와 연결할 수 없다면
            // 새로운 독립 Main Trunk를 생성한다.

            createNewTrunk(contact);
        }
    }


    // ----------------------------------------------------
    // STEP 12
    // Collision 및 Auto Avoid
    // ----------------------------------------------------

    for(auto& branch : forest.branches)
    {
        if(collisionWithModel(branch))
        {
            if(!findAvoidPath(branch))
            {
                // 우회 경로도 없다면
                // 해당 Contact용 새 Trunk 생성

                splitToNewTrunk(branch);
            }
        }
    }


    // ----------------------------------------------------
    // STEP 13
    // Cross Brace 생성
    // ----------------------------------------------------

    generateCrossBraces(
        forest,
        settings.crossSettings
    );


    // ----------------------------------------------------
    // STEP 14
    // Coverage 재검증
    // ----------------------------------------------------

    for(int i = 0;
        i < settings.maxSupplementPass;
        ++i)
    {
        auto missing =
            findUnsupportedRegions(
                mesh,
                forest
            );

        if(missing.empty())
            break;


        // ------------------------------------------------
        // STEP 15
        // Missing Region 자동 보완
        // ------------------------------------------------

        auto supplementPoints =
            createSupplementPoints(
                missing
            );

        addPointsToSupportForest(
            supplementPoints,
            forest
        );
    }


    // ----------------------------------------------------
    // STEP 16
    // Support Mesh 생성
    // ----------------------------------------------------

    return buildSupportGeometry(
        forest,
        settings
    );
}
```

---

# 32. 권장 모듈 분리

실제 프로그램에서는 한 파일에 전부 넣으면 안 된다.

예를 들어 Core 구조를 다음처럼 분리한다.

```text
supalg/
    SupGen
    LowDet
    OvrDet
    IslDet
    Sampler
    Tree
    Coll
    Brace
    Suppl
    MeshGen
```

역할:

| 모듈        | 역할                       |
| --------- | ------------------------ |
| `SupGen`  | 전체 Auto Support Pipeline |
| `LowDet`  | Low Point Detector       |
| `OvrDet`  | Overhang Detector        |
| `IslDet`  | Layer Island Detector    |
| `Sampler` | Density/Poisson Sampling |
| `Tree`    | Branch/Fork/Main Trunk   |
| `Coll`    | BVH Collision            |
| `Brace`   | Cross Support            |
| `Suppl`   | Missing Area 보완          |
| `MeshGen` | 실제 Support Mesh 생성       |

---

# 33. 구현 우선순위

처음부터 Tree까지 전부 만들면 디버깅이 매우 어렵다.

## Phase 1

먼저 다음만 구현한다.

```text
Mesh
 ↓
Overhang
 ↓
Low Point
 ↓
Support Point
 ↓
Vertical Support
```

즉:

```text
●
│
│
│
Platform
```

까지만 만든다.

이 단계에서는 Branch/Fork를 만들지 않는다.

목적:

> Support Point가 제대로 생성되는지 검증

---

# 34. Phase 2

다음으로 Density 구현.

테스트:

```text
20%
50%
80%
100%
```

CHITUBOX 테스트 모델과 동일하게 비교한다.

확인:

```text
Support Point 개수
Point 평균 거리
Edge 거리
Low Point 유지 여부
```

---

# 35. Phase 3

Angle 구현.

테스트:

```text
30°
45°
60°
```

현재 실험 결과와 비교한다.

특히:

```text
30° → Low Point 중심
45° → 일반 Support
60° → 더 넓은 영역
```

이 패턴이 나오는지 확인한다.

---

# 36. Phase 4

Support Tree를 추가한다.

```text
Contact
 ↓
Branch
 ↓
Fork
 ↓
Main Trunk
```

여기부터 CHITUBOX와 외형적인 차이가 크게 줄어든다.

---

# 37. Phase 5

Collision + Auto Avoid.

복잡한 치아나 덴탈 모델에서는 반드시 필요하다.

단순 Cylinder에서는 문제없어도 치아 Undercut에서는 Support가 모델을 쉽게 관통한다.

---

# 38. Phase 6

Auto Supplement.

이 단계가 들어가면 실제 상용 슬라이서 수준에 가까워진다.

```text
1차 Auto Support
      ↓
Slice Validation
      ↓
Missing Island
      ↓
Supplement
```

---

# 39. 매우 중요한 구현 원칙

Auto Support 알고리즘 내부에서는

```text
Density
```

를 직접 사용하지 않는 것을 권장한다.

반드시:

```text
Density
   ↓
Spacing
```

으로 변환한다.

마찬가지로 GUI의:

```text
Light
Middle
Heavy
```

도 알고리즘이 되어서는 안 된다.

실제 내부에서는:

```text
Tip Diameter
Trunk Diameter
Contact Depth
Branch Length
Base Diameter
```

와 같은 실제 치수만 사용한다.

즉:

```text
GUI Profile
     ↓
Parameter Set
     ↓
Auto Support Algorithm
```

구조로 만든다.

---

# 40. 최종 권장 Architecture

```text
                GUI
                 │
                 ▼
          Support Settings
                 │
                 ▼
        AutoSupportController
                 │
       ┌─────────┼─────────┐
       ▼         ▼         ▼
    Mesh      Layer     Geometry
   Analysis   Analysis   Settings
       │         │
       └────┬────┘
            ▼
      Candidate Generator
            │
            ▼
       Point Sampler
            │
            ▼
       Support Tree
            │
            ▼
      Collision Solver
            │
            ▼
       Supplementer
            │
            ▼
      Geometry Builder
            │
            ▼
        Support Mesh
```

---

# 41. V1에서 가장 중요한 4개 Class

처음 개발한다면 우선 다음 네 개부터 만든다.

```cpp
class LowPointDetector;

class OverhangDetector;

class SupportPointSampler;

class SupportTreeBuilder;
```

그리고 이후:

```cpp
class CollisionChecker;
class IslandDetector;
class SupportSupplementer;
class SupportMeshGenerator;
```

를 붙인다.

---

# 42. 현재 CHITUBOX 분석과의 대응 관계

현재까지 확인된 CHITUBOX 1.9.4 내부 흔적과 우리 설계를 대응시키면 다음과 같다.

| CHITUBOX 내부 흔적                     | 우리 설계                            |
| ---------------------------------- | -------------------------------- |
| `DetermineSupPnt_determineLowPnts` | `LowPointDetector`               |
| `LayerSupportSamp`                 | `SupportPointSampler` / Layer 분석 |
| `DetermSupPntTreeData`             | Support Point Spatial Index      |
| `MainSupTreeData`                  | `SupportTreeBuilder`             |
| `add-fork`                         | Fork 생성                          |
| `add-tree`                         | Tree 병합                          |
| `AutoAvoidTri`                     | `CollisionChecker / AutoAvoid`   |
| `ColDetectTri`                     | Collision Triangle               |
| `SelMissPnts`                      | Missing Point 검사                 |
| `SelMissTris`                      | Missing Surface 검사               |
| `AutoSupplement`                   | `SupportSupplementer`            |
| `ygAddSupport`                     | 최종 Support Geometry 생성 계층 추정     |

따라서 현재 설계 방향은 CHITUBOX 1.9.4에서 관찰된 구조와 상당히 잘 대응한다.

---

# 43. 다음 개발 목표

첫 번째 실제 개발 목표는 다음으로 잡는다.

```text
STL 입력
 ↓
Triangle Normal 계산
 ↓
30/45/60° Overhang 표시
 ↓
Low Point 표시
 ↓
Density별 Support Point 표시
```

아직 Support 기둥을 만들 필요도 없다.

3D Viewer에서:

```text
빨강 : Overhang
노랑 : Low Point
초록 : Island
흰색 : 일반 Support Candidate
```

식으로 Debug Overlay를 표시하는 것이 좋다.

이 결과가 정상이어야 그 뒤 Support Tree가 정상적으로 만들어진다.

**Auto Support 품질의 70% 이상은 사실 기둥 모양보다 `어디에 Support Point를 찍느냐`에서 결정된다.**

따라서 첫 개발 단계에서는 `LowPointDetector + OverhangDetector + SupportPointSampler` 세 모듈의 정확도를 가장 우선해야 한다.
