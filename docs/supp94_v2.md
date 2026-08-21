CHITUBOX V1.9.4 Support System — Clean-room 분석·구현 사양 v2

0. 목적

이 문서는 CHITUBOX V1.9.4의 설치 폴더와 CHITUBOX.exe를 정적 분석하여 확인한
레진 3D 프린터용 Support 시스템의 구조, 파라미터, 데이터 흐름, 구현 단서를 정리한 문서다.

목적은 다른 AI/개발자가 CHITUBOX의 원본 소스코드를 복제하지 않고,
관찰된 기능과 동작을 바탕으로 독립적인 Support 엔진을 Clean-room 방식으로 구현할 수 있게 하는 것이다.

대상 범위:

Manual Support

Auto Support

Overhang / Low Point 분석

Support candidate point 생성

공간 검색

Support Tree / Fork / Trunk

Collision / Avoidance

Missing Point / Missing Triangle 검사

Auto Supplement

Tip / Middle / Bottom / Raft geometry

Cross brace

Viewer Picking과 Support Editor 연결

이 문서와 view94.md를 함께 사용하면 다음 흐름을 하나의 시스템으로 구현할 수 있다.

3D Viewer
   ↓
MeshData
   ↓
Overhang / Low Point
   ↓
Support Point Sampling
   ↓
Support Tree
   ↓
Support Mesh
   ↓
Viewer Support Editor

0.1 v2 변경사항 — 실제 CHITUBOX 실행 결과 반영

이 버전은 정적 바이너리 분석뿐 아니라, CHITUBOX V1.9.4를 실제 실행하여 동일한 단순 경사 모델에 Auto Support를 생성한 비교 결과를 추가 반영한다.

비교한 조건:

Test

Density

Angle

D20-A45

20%

45°

D50-A45

50%

45°

D80-A45

80%

45°

D70-A30

70%

30°

D70-A45

70%

45°

D70-A60

70%

60°

화면에서 공통으로 유지된 주요 설정은 다음과 같다.

Cross Width: 4.00 mm
Grid/Cross Support Start Height: 3.00 mm
Top Contact Diameter: 0.40 mm
Top Contact Depth: 0.10 mm
Upper Diameter: 0.30 mm
Lower Diameter: 0.80 mm
Connection Length: 2.00 mm

v2에서 새로 검증된 핵심

A. Angle과 Density의 역할은 분리되어 있다 — [실사용 검증 강함]

실제 결과는 다음 구조와 일치한다.

Angle
  ↓
지원 대상으로 볼 Surface / Overhang Region 결정

Density
  ↓
선택된 Region 내부의 Contact Point Sampling 밀도 결정

따라서 Angle과 Density를 하나의 동일한 계산 파라미터처럼 사용하면 안 된다.

B. Low Point / Island Start는 일반 Overhang Sampling과 별도 경로일 가능성이 매우 높다 — [실사용 검증 강함]

Density=70%, Angle=30°에서는 경사면 전체에 다수 Support가 생성되지 않았지만,
모델의 가장 낮은 시작부에는 최소 Support가 남았다.

이는 EXE에서 확인된:

DetermineSupPnt_determineLowPnts

와 매우 잘 일치한다.

Clean-room 구현은 후보군을 분리한다.

Mandatory Candidate
- Island start
- Low point

Regular Candidate
- Angle로 선택된 overhang region 내부 sample

C. Density는 Support 굵기보다 Contact Sampling 수/간격에 직접 영향을 준다 — [실사용 검증 강함]

동일한 Angle=45°에서:

Density 20% → 적은 Contact / 큰 간격
Density 50% → 중간 수준
Density 80% → 많은 Contact / 작은 간격

이 일관되게 확인됐다.

따라서:

Density
  ↓
Target point interval 또는 sampling budget
  ↓
Candidate count / spacing

구조로 구현한다.

정확한 Density → mm spacing 공식은 아직 확정하지 않는다.

D. Contact 수와 Main Trunk 수는 1:1이 아니다 — [실사용 검증 강함]

Density 증가로 Contact는 증가하지만 모든 Contact가 독립 수직 Main Trunk가 되지는 않는다.
Branch/Fork 및 기존 Trunk 공유가 화면에서 확인된다.

이 결과는:

MainSupTreeData
add-fork
add-tree

의 정적 분석과 일치한다.

따라서 Candidate 생성과 Support topology 생성을 반드시 분리한다.

E. Cross/Brace는 높이와 주변 구조를 고려한 후처리다 — [실사용 검증 중~강]

짧은 Support보다 충분한 높이를 가진 Main Support 사이에서 diagonal brace가 더 뚜렷했다.

Cross Width = 4.00 mm
Grid/Cross Support Start Height = 3.00 mm

와 실제 결과가 정합적이다.

Cross는 Contact Sampling 단계가 아니라 Tree/Trunk 확정 이후의 Structural Pass로 둔다.

0.2 실험 결과 상세 해석

Density 20%, Angle 45°

관찰:

경사 underside에 적은 수의 접점 생성

Contact 간격이 큼

긴 구조 일부에만 brace/tree 연결

독립 pillar가 상대적으로 많음

해석:

Overhang region은 검출됨
+
Sampling interval이 큰 상태

Density 50%, Angle 45°

관찰:

20%보다 Contact 증가

underside를 따라 더 균일하게 배치

일부 Contact가 인접 Main Support로 Branch/Fork 연결

diagonal 연결 증가

해석:

동일 Overhang Region
+
더 작은 Candidate spacing
+
Tree merge/brace 조건 충족 빈도 증가

Density 80%, Angle 45°

관찰:

Contact가 매우 조밀

underside 전체가 촘촘하게 지지

Contact 증가량에 비해 독립 Main Trunk는 1:1로 늘지 않음

Branch/Tree/Cross 구조가 복잡해짐

해석:

Density ↑
→ Candidate spacing ↓
→ Contact count ↑
→ Nearby contact/trunk merge opportunity ↑

Density 70%, Angle 30°

관찰:

넓은 경사 underside에 다수 Support가 생성되지 않음

모델 하단의 낮은 시작점에는 최소 Support가 남음

해석:

Regular overhang candidate는 Angle 조건에서 대부분 탈락
+
Low-point / island-start mandatory candidate는 별도 유지

이 결과는 Low Point Detector를 별도 모듈로 두어야 하는 강한 실사용 근거다.

Density 70%, Angle 45°

관찰:

underside 전반에 여러 Support 생성

Main trunk와 diagonal 구조 동시 생성

해석:

이 테스트 모델의 주요 경사면은 30°와 45° 사이에서 support 대상 판정이 크게 변한다.

45°에서 주요 overhang region이 활성화된 것으로 보인다.

Density 70%, Angle 60°

관찰:

전체적인 Support 대상 영역이 45°와 유사

30°→45° 변화만큼 큰 추가 변화는 없음

해석:

이 단순 모델에서는 45°에서 이미 주요 대상 surface가 선택되어 60°에서 추가되는 region이 많지 않은 것으로 보인다.

주의:

이 결과만으로 CHITUBOX의 정확한 angle convention 또는 normal.z threshold 수식을 확정하지 않는다.

0.3 v2 기준 Auto Support 데이터 흐름

정적 분석 + 실제 실행 결과를 합친 현재 우선 모델:

Mesh
 ↓
Face Normal / Adjacency / Spatial Data
 ↓
┌──────────────────────────────┐
│ 1. Mandatory Detector        │
│    - Island Start            │
│    - Local Low Point         │
└──────────────────────────────┘
             +
┌──────────────────────────────┐
│ 2. Overhang Detector         │
│    - Angle threshold         │
│    - Region selection        │
└──────────────────────────────┘
             ↓
┌──────────────────────────────┐
│ 3. Region Sampler            │
│    - Density / tip distance  │
│    - Candidate interval      │
└──────────────────────────────┘
             ↓
Mandatory + Regular Candidates
             ↓
Edge / Spacing / Clearance Filter
             ↓
Spatial Grid / Tree
             ↓
Main Support Tree Builder
 ├─ vertical
 ├─ directional
 ├─ fork
 └─ tree
             ↓
Collision / AutoAvoid
             ↓
Platform / Model Landing
             ↓
Missing Point / Triangle Coverage
             ↓
Auto Supplement
             ↓
Cross / Brace Structural Pass
             ↓
Support Mesh

0.4 v2 구현 규칙 업데이트

Rule 1 — Mandatory와 Density Sample을 분리

mandatory = detectLowPointsAndIslandStarts(mesh)

regular =
    sampleOverhangRegions(
        mesh,
        angle,
        density
    )

candidates =
    merge(mandatory, regular)

Density를 낮춰도 Mandatory Candidate가 사라지지 않도록 한다.

Rule 2 — Angle은 Region Detector에 직접 사용

overhangRegion =
    detectOverhang(mesh, supportAngle)

이후 Density가 해당 region 내부를 sampling한다.

Rule 3 — Density와 Geometry Profile을 분리

Density:
    Point distribution / target spacing

Light/Middle/Heavy:
    Tip / Branch / Trunk diameter
    Contact depth
    Bottom geometry

Rule 4 — Contact마다 Main Trunk를 만들지 않는다

for contact in contacts:
    try attach to nearby viable trunk

    if no valid trunk:
        create new trunk

Rule 5 — Cross는 Tree 완성 후 계산

Candidate
→ Tree
→ Collision/Landing
→ Supplement
→ Final Trunk Topology
→ Cross

0.5 현재 증거 수준 갱신

항목

v1 상태

v2 상태

Angle이 overhang 대상 선택에 관여

높음

실사용 검증 강함

Density가 contact spacing에 관여

높음

실사용 검증 강함

Low Point 별도 처리

높음

실사용 검증 강함

Contact와 Main Trunk가 1:1이 아님

높음

실사용 검증 강함

Fork/Tree 존재

확정(바이너리)

확정 + 실사용 정합

Cross가 구조 후처리

높음

실사용 정합 강함

Density→정확한 mm 공식

미확정

미확정

exact angle threshold 수식

미확정

미확정

Sampling distribution 종류

미확정

미확정

Tree merge cost

미확정

미확정

1. 분석 신뢰도 표기

문서의 모든 항목은 아래 세 단계로 구분한다.

[확정]

EXE의 RTTI / Qt Meta Object / 문자열 / Shader / 어셈블리

설치 폴더의 실제 설정 파일

설치 리소스
에서 직접 확인됨.

[높음]

여러 직접 증거가 서로 일치하며 구조상 거의 확실함.

[추정]

구현 구조상 가능성이 높지만 정확한 원본 조건식까지는 복원되지 않음.

중요:

[추정] 부분을 CHITUBOX의 정확한 원본 알고리즘이라고 주장하지 않는다.

2. 분석 대상

분석 기준:

CHITUBOX V1.9.4
Windows x64
Qt 5 계열
MSVC x64 binary

주요 입력 자료:

CHITUBOX.exe
CHITUBOX V1.9.4 설치 폴더
resource/machine/@default.cfg
resource/support/*.stl

3. 확인된 Support 클래스/자료구조

EXE의 MSVC RTTI에서 다음 타입이 직접 확인된다.

3.1 Core Support

[확정]

SupportGroup
SupportSet
ygAddSupport

LayerSupportSamp
DetermSupPntTreeData
MainSupTreeData

3.2 Background Job / Operation

[확정]

SwitchToSupModeOp
SwitchToSupModeJob

UpdateRaftShapeOp
UpdateRaftShapeJob

AutoSupplementOp
AutoSupplementJob

RealTimeSupPntsOp
RealTimeSupPntsJob

3.3 Spatial / Geometry

[확정]

ModelStructPnt
ModelStructPntQuadTree

DelaunayTriangulateTri

QuadTreeIntDataBase
QuadTreeIntBase

TriangulatePathSeg
TriangulatePathSegTree
TriangulatePathPnt
TriangulatePathPntTree

주의:

DelaunayTriangulateTri의 존재는 확인됐지만
Auto Support가 반드시 Delaunay를 사용하는지까지는 현재 직접 증명하지 않았다.

따라서 Clean-room 구현에서는 선택적인 후보 알고리즘으로 취급한다.

3.4 Collision / Avoidance

[확정]

ColDetectTri
AutoAvoidTri
AutoAvoidOp
autoAvoid

3.5 Missing Support 검사

[확정]

SelMissPntsOp
SelMissPntsJob

SelMissTrisOp
SelMissTrisJob

Qt Meta Object에는 다음 이름도 직접 존재한다.

selTris_selMissPnts
selMissPntsJob
selMissTrisJob

즉 지원되지 않은 영역을 단순 Point 하나로만 판단하지 않고,
Point와 Triangle을 별도의 작업으로 검사하는 구조가 존재한다.

4. UI / SupportSet에서 확인된 공개 동작

Qt Meta Object에서 SupportSet 관련 다음 인터페이스가 확인된다.

[확정]

OnDoubleClick
OnLeftMousePress
OnLeftMousePressMove
OnLeftMouseReleaseMove
OnLeftMouseRelease
OnWheelEvent

setCurrentSupportStatus
getState

tryToAutoSupport
autoSupport

clearAll
tryToClearAll

switchSupportMode_Slot

Support 상태:

supportStateIndex
supportTypeIndex
supportStyleSwitch

mbRealTimeAddSup
bShowSupportGuideLine
bMagneticAttraction

그리고 실제 Support 추가 객체:

ygAddSupport

가 별도로 존재한다.

따라서 구현은 다음처럼 분리하는 것이 좋다.

Support UI Controller
       │
       ▼
SupportSet / Support Editor
       │
       ├─ Manual operations
       ├─ Auto Support command
       └─ Undo / Redo
       │
       ▼
Support geometry / tree backend

5. Undo / Redo

EXE 내부 소스 경로 문자열:

..\chitulayout\support\SupportSet.cpp

및 다음 메서드 이름이 직접 존재한다.

[확정]

SupportSet::initUndoRedoList
SupportSet::undo
SupportSet::redo
SupportSet::clearUndoRedoList
SupportSet::deleteUndoRedoFrontNode_

따라서 Support Editor는 단순 Mesh를 직접 수정하는 방식보다
Command 또는 snapshot 단위 Undo/Redo 구조를 가져가는 것이 적합하다.

Clean-room 권장:

struct SupportCommand {
    virtual void apply() = 0;
    virtual void undo() = 0;
};

또는 Tree snapshot / delta 방식.

6. Support Profile 기본값

아래 값은 V1.9.4의 실제:

resource/machine/@default.cfg

에서 확인된 값이다.

6.1 Global

Parameter

Default

의미

supportWeight

middle

Light / Middle / Heavy profile

supportLengthMin

5.0 mm

최소 Support 길이

supportDensity

50 %

Auto Support density

autoSupportAngle

45°

자동 지지 각도

touchTipDistance

4 mm

상단 접촉점 거리

middleSupportDistance

8 mm

Main/Middle support 계열 거리

supportConnMinHeight

3.0 mm

연결 구조 생성 최소 높이

supportCrossDiameter

1.0 mm

Cross brace 직경

supportCrossEnable

1

Cross 사용

supportInShellEnable

1

Hollow shell 내부 support 허용

minimalSupportCrossSpacingZ

2 mm

Cross의 최소 Z 간격

maximalSupportCrossSpacingXY

10 mm

Cross 연결 최대 XY 거리

supportMarginFromEdge

0.5 mm

Edge에서 Support Point 이격

supportSpacingFromModel

1.2 mm

Support body와 Model 최소 이격

supportMaxSmallPillarLength

3 mm

Small pillar 최대 길이

supportMaxOffsetFromContact

3 mm

Contact에서 Main Support 최대 offset

supportCrossWidth

4

Manual support가 주변 pillar에 연결되는 범위 계열

modelBottomSupportDensity

100

Contact spacing / trunk spacing 병합 기준 계열

distForkToHornEnd

0.0

Fork intersection과 upper support end 간 거리

heightOfBoss

1.0 mm

Bottom boss 높이

diameterOfBossBottom

2.2 mm

Bottom boss 직경

triggerHeightOfLowMidSupDiam

1.0 mm

Middle 하단 직경 변화 시작 높이

touchTipDistance 관련 중요한 개발자 주석

설정 파일의 중국어 주석은:

顶部接触距离，这个距离生效时，支撑密度将会无效

의미:

상단 접촉 거리. 이 값이 적용되면 Support Density는 무효가 된다.

따라서 [높음]

Auto Support의 point spacing 입력은 최소 두 경로를 지원한다고 보는 것이 타당하다.

직접 Contact Distance
또는
Density 기반 spacing

정확한 Density → mm 변환식은 현재 정적으로 완전히 복원되지 않았다.

절대로 임의 공식을 “CHITUBOX 공식”이라고 명명하지 않는다.

7. Light / Middle / Heavy Geometry

7.1 Light

항목

값

Tip Up Diameter

0.30 mm

Tip Down Diameter

0.8 mm

Tip Length

2.0 mm

Tip Contact Depth

0.3 mm

Middle Diameter

0.8 mm

Middle Diameter2

1.0 mm

Max Connect Angle

70°

Small Pillar Diameter

0.4 mm

Small Pillar Upper Contact Depth

0.25 mm

Small Pillar Lower Contact Depth

0.25 mm

Bottom Diameter

10 mm

Bottom Thickness

0.8 mm

Tail Diameter

0.4 mm

Tail Contact Depth

0.2 mm

7.2 Middle

항목

값

Tip Up Diameter

0.4 mm

Tip Down Diameter

1.2 mm

Tip Length

2.0 mm

Tip Contact Depth

0.4 mm

Middle Diameter

1.2 mm

Middle Diameter2

2.0 mm

Max Connect Angle

70°

Small Pillar Diameter

0.5 mm

Small Pillar Upper Contact Depth

0.3 mm

Small Pillar Lower Contact Depth

0.3 mm

Bottom Diameter

12 mm

Bottom Thickness

1.0 mm

Tail Diameter

0.6 mm

Tail Contact Depth

0.2 mm

7.3 Heavy

항목

값

Tip Up Diameter

0.6 mm

Tip Down Diameter

1.5 mm

Tip Length

3.0 mm

Tip Contact Depth

0.6 mm

Middle Diameter

1.5 mm

Middle Diameter2

2.5 mm

Max Connect Angle

70°

Small Pillar Diameter

0.5 mm

Small Pillar Upper Contact Depth

0.3 mm

Small Pillar Lower Contact Depth

0.3 mm

Bottom Diameter

12 mm

Bottom Thickness

1.0 mm

Tail Diameter

2.0 mm

Tail Contact Depth

0.3 mm

결론

[높음]

Light / Middle / Heavy는 별도의 Auto Support 알고리즘 세 종류라기보다는:

공통 Support Algorithm
        +
Geometry Parameter Profile

형태로 구현하는 것이 가장 적절하다.

8. 설치된 Support Primitive

실제 설치 폴더:

resource/support/

에서 다음 STL이 확인된다.

파일

Triangle 수

SUPPORT_Cube.stl

12

SUPPORT_Prism.stl

52

SUPPORT_TOP_Pyramid.stl

52

cylinder8.stl

28

cylinder16.stl

60

cylinder20.stl

76

cylinder32.stl

124

SUPPORT_sphere.stl

480

SUPPORT_Cylinder.stl

502

SUPPORT_TOP_Cone.stl

776

SUPPORT_BOTTOM_Cone.stl

776

SUPPORT_BOTTOM_Skate.stl

1042

high_precision_sphere.stl

12600

이것은 Support geometry가 다음 primitive 조합으로 구성될 수 있음을 직접 보여준다.

Contact Tip
   │
 Cone / Pyramid
   │
 Small Pillar
   │
 Cylinder
   │
 Main Trunk
   │
 Bottom / Skate / Cone

Clean-room 구현에서는 STL 파일을 런타임에 복제할 필요는 없다.

더 좋은 방식:

procedural cone
procedural cylinder
procedural sphere
procedural skate/base

를 생성하고,
세그먼트 수만 품질 단계에 따라 바꾼다.

9. Support 생성 Mode — 매우 중요한 직접 분석 결과

CHITUBOX EXE 안에는 다음 문자열이 존재한다.

[확정]

add-default
add-perp
add-vert
add-dir
add-turn-dir
add-slim
add-fork
add-layer
add-tree

더 중요한 점은
실제 x64 switch jump table을 분석하여 enum → mode mapping까지 확인했다.

9.1 실제 Mode Mapping

[확정]

0 → add-default
1 → add-perp
2 → add-vert
3 → add-dir
4 → add-turn-dir
5 → add-slim
6 → add-fork
7 → add-layer
8 → add-tree

이것은 단순 문자열 목록이 아니라
실제 Support 추가 코드의 switch dispatch에서 확인된 매핑이다.

의미

Support를 단순히:

Point → Vertical Cylinder

하나로 취급하면 안 된다.

Support engine 내부에는 최소한 다음 “생성 전략” 개념이 존재한다.

Default
Perpendicular
Vertical
Directional
Turn Direction
Slim
Fork
Layer
Tree

정확한 각 mode의 원본 geometry 규칙은 전부 복원되지 않았으나
Fork와 Tree가 실제 별도 생성 mode라는 사실은 확정이다.

10. Auto Support Entry Point

실행파일 및 Qt Meta Object에서 다음 함수/command가 확인된다.

[확정]

tryToAutoSupport
autoSupport

autoSupportAll
autoSupportPlatform

removeAllSupport

즉 자동 Support는 최소한:

전체 대상
Platform 기준 대상

을 구분할 수 있는 진입점이 존재한다.

Clean-room API 권장:

enum class AutoSupportTarget {
    SelectedModels,
    AllModels
};

enum class SupportLandingPolicy {
    PlatformPreferred,
    ModelAllowed
};

11. Background Job 구조

다음 Job이 존재한다.

[확정]

SwitchToSupModeJob
UpdateRaftShapeJob
AutoSupplementJob
RealTimeSupPntsJob
SelMissPntsJob
SelMissTrisJob

따라서 큰 계산을 UI Thread에서 수행하는 구조로 만들면 안 된다.

Clean-room:

UI Thread
   │
   ├─ requestAutoSupport()
   │
   ▼
Worker
   │
   ├─ Analyze Mesh
   ├─ Sample
   ├─ Build Tree
   ├─ Collision
   └─ Build Support
   │
   ▼
Result
   │
   ▼
UI / Renderer update

필수:

cancel token
progress callback
thread-safe result transfer

12. Low Point Detection

EXE에 QtConcurrent 타입명이 직접 남아 있다.

[확정]

DetermineSupPnt_determineLowPnts

그리고 실행 코드에:

ERROR! determ low pnts

로그가 존재한다.

12.1 Binary 위치

[확정]

분석된 주요 함수 범위:

0x140134B00
~
0x1401362B8

크기:

0x17B8 = 약 6072 bytes

즉 Low Point 처리는 단순 한 줄 비교가 아니라
상당한 전처리와 자료구조 처리를 포함하는 큰 함수다.

12.2 관찰된 구조

[확정/높음]

어셈블리에서 확인되는 특징:

Triangle 단위로 보이는 3 반복 loop

Vertex/triangle index container 처리

중복 제거용 hash 계열 자료구조

좌표 vector 처리

여러 temporary point collection

실패/누락 상태 검사

따라서:

모든 vertex 중 z가 가장 작은 것만 찾기

정도의 단순 알고리즘이 아니다.

12.3 Clean-room Low Point 정의

정확한 CHITUBOX inequality는 아직 미복원 상태이므로
독립 구현에서는 아래 기준을 권장한다.

Vertex Local Minimum

Vertex v의 one-ring neighbor를 N(v)라 할 때:

v.z <= n.z + epsilon
for all n ∈ N(v)

이며

적어도 하나의 neighbor는
n.z > v.z + epsilon

이어야 한다.

Plateau 처리

같은 높이의 vertex cluster는 하나의 plateau component로 묶고,
cluster 전체가 주변보다 낮으면 대표 point를 1개 선택한다.

우선순위

1. Island first point
2. strict local minimum
3. overhang region low boundary
4. broad overhang interior sample

이 순서를 권장한다.

13. Support Point Interval / Raster Mapping — 새로운 직접 분석 결과

sup pnt interval not found 로그를 포함하는 주요 함수:

[확정]

0x14013D0F0
~
0x14013E3FA

크기:

0x130A = 약 4874 bytes

13.1 이 함수에서 확인된 중요한 계산

어셈블리에서 후보 3D/2D 위치의 X/Y를
규칙적인 2D grid cell index로 변환하는 계산이 확인된다.

논리적으로:

ix = floor((x - originX) / cellSizeX)
iy = floor((y - originY) / cellSizeY)

index = ix * gridHeight + iy

형태다.

실제 binary에서는:

grid width / height
cell size X / Y
origin X / Y

에 해당하는 값들을 이용하여
1차원 cell index를 계산한다.

의미

[높음]

Support candidate 처리 중 적어도 일부 단계는
완전한 O(N²) point-to-point 비교만 쓰지 않고,
2D spatial grid/raster lookup을 사용한다.

따라서 Clean-room 구현에서도:

XY Uniform Grid
또는
Spatial Hash

를 사용하면 적절하다.

14. QuadTree 존재

RTTI에서:

[확정]

DetermSupPntTreeData
ModelStructPntQuadTree
QuadTreeIntDataBase
QuadTreeIntBase

가 확인된다.

따라서 Support Engine은 공간 검색을 위한 Tree 계열 자료구조를 실제로 가지고 있다.

권장 Clean-room 구조:

Mesh collision:
    BVH

Support candidate:
    Spatial Hash / KD-tree / QuadTree

2D layer point:
    Uniform Grid or QuadTree

용도를 분리한다.

15. LayerSupportSamp

RTTI에서:

[확정]

LayerSupportSamp

가 존재한다.

이 명칭은 Auto Support candidate 데이터를
layer/sampling 관점으로 관리하는 별도 구조가 있음을 보여준다.

그러나 현재 정적 분석만으로:

Grid sampling
Poisson disk sampling
Delaunay sampling
Contour sampling

중 어느 하나를 CHITUBOX가 정확히 최종 방식으로 사용한다고 단정할 수 없다.

따라서 Clean-room에서는 다음 hybrid 방식을 권장한다.

Layer / overhang region extraction
       ↓
mandatory low points
       ↓
boundary sampling
       ↓
interior Poisson / blue-noise sample
       ↓
minimum-distance filtering

16. Overhang Candidate

V1.9.4 설정:

autoSupportAngle = 45°

Viewer Shader는 transformed normal의:

normal.z

를 기준으로 overhang red highlight를 수행한다.

따라서 Support detector와 Viewer는 반드시 같은 기준 함수를 공유해야 한다.

Clean-room 예:

float angleToNormalZThreshold(float angleDeg);
bool needsSupport(const Vec3& worldNormal, float angleDeg);

주의:

각도 정의가 “platform과 surface 사이 각도”인지
“build direction과 normal 사이 각도”인지에 따라 부호가 달라진다.

UI에서 실제 30/45/60° 결과를 비교하여 convention을 검증한다.

17. Candidate Point 생성 권장 Pipeline

CHITUBOX에서 직접 확인된 개념과
안전한 Clean-room 구현을 합치면:

Mesh
 ↓
Build adjacency + BVH
 ↓
Overhang triangles
 ↓
Connected overhang regions
 ↓
Low points
 ↓
Layer/region sampling
 ↓
Candidate points
 ↓
Edge margin filter
 ↓
Model clearance filter
 ↓
Point spacing filter
 ↓
Mandatory points + regular points

Candidate 데이터 구조:

enum class CandidateKind {
    IslandStart,
    LowPoint,
    Boundary,
    OverhangInterior,
    Supplemental
};

struct SupportCandidate {
    Vec3 position;
    Vec3 normal;

    uint32_t modelId;
    uint32_t faceId;

    CandidateKind kind;

    float loadScore;
    float priority;
};

18. Edge Margin

설정:

supportMarginFromEdge = 0.5 mm

[확정]

설정 주석:

Support가 edge에서 떨어지는 거리.

Clean-room에서는 candidate의 barycentric distance 또는
triangle/region boundary의 shortest distance를 계산한다.

if distanceToOverhangBoundary < edgeMargin:
    moveInward()
    or reject()

Low Point / Island Start 같은 mandatory point는
무조건 reject하지 말고 별도 규칙을 둔다.

19. Model Clearance

설정:

supportSpacingFromModel = 1.2 mm

[확정]

주석 의미:

Support와 model이 너무 가까워 붙는 것을 방지하기 위한 최소 거리.

따라서 Tip 아래의 branch/trunk는 model surface와 별도의 clearance가 필요하다.

Clean-room:

Tip contact:
    model 접촉 허용

Tip 아래 일정 길이 이후:
    clearance ≥ supportSpacingFromModel

Segment clearance는 BVH capsule query 또는
cylinder-vs-mesh approximation으로 처리한다.

20. Main Support Tree

RTTI:

[확정]

MainSupTreeData

후보점용:

DetermSupPntTreeData

와 별도로 존재한다.

따라서:

Candidate spatial index

와

최종 Support topology/tree

는 서로 다른 자료구조로 보는 것이 타당하다.

Clean-room 자료구조:

enum class SupportNodeType {
    Contact,
    TipEnd,
    Branch,
    Trunk,
    CrossAnchor,
    ModelFoot,
    PlatformFoot
};

struct SupportNode {
    NodeId id;
    SupportNodeType type;
    Vec3 position;

    std::vector<NodeId> parents;
    std::vector<NodeId> children;
};

struct SupportEdge {
    NodeId a;
    NodeId b;
    float radiusA;
    float radiusB;
};

21. Contact → Trunk Merge 관련 직접 파라미터

21.1 Main offset

supportMaxOffsetFromContact = 3 mm

[확정]

개발자 주석:

Main Support가 Contact Point로부터 떨어질 수 있는 최대 offset.

즉 Contact 바로 아래에 항상 독립 pillar를 세울 필요가 없다.

● Contact A
 \
  \
   ● Branch
   │
   │ Main trunk
   │
  /
 /
● Contact B

형태가 허용된다.

21.2 Small pillar

supportMaxSmallPillarLength = 3 mm

[확정]

따라서 Contact/Fork 주변의 짧은 branch에 길이 제한이 있다.

21.3 Connect angle

Light/Middle/Heavy 모두:

supportMiddleMaxConnectAngle = 70°

[확정]

즉 branch/trunk 연결은 각도 제한을 고려해야 한다.

정확한 원본 angle 기준축은 추가 검증 필요.

22. modelBottomSupportDensity의 의미

설정:

modelBottomSupportDensity = 100

개발자 주석 번역:

Support point spacing과 main trunk spacing의 비율이
특정 값보다 작을 때 support를 merge한다.

따라서 [높음]

CHITUBOX에는 Contact Point와 Main Trunk를
1:1 관계로 유지하지 않고,
spacing ratio 기반 merge 판단이 존재한다.

정확한 단위/정규화 방식은 현재 미확정.

Clean-room에서는 다음처럼 정의 가능:

mergeScore =
    contactSpacing / targetTrunkSpacing

if mergeScore < mergeThreshold:
    tryMerge()

단, 이것을 CHITUBOX 원본 공식이라고 주장하지 않는다.

23. Fork / Tree

별도 mode:

add-fork
add-tree

가 실제 switch에서 확인되었다.

[확정]

따라서 Clean-room Support Tree Builder는 최소 다음 연산을 지원한다.

CreateVerticalTrunk()
CreateDirectionalBranch()
CreateFork()
MergeIntoTree()

권장 merge 조건:

canMerge(contact, trunk):

    if XYOffset > maxOffset:
        return false

    if branchLength > maxSmallPillarLength:
        return false

    if connectAngle > maxConnectAngle:
        return false

    if collision(branch):
        return false

    if modelClearance(branch) < minClearance:
        return false

    return true

24. Tree 생성 Cost Function 권장

정확한 CHITUBOX 원본 cost는 확인되지 않았다.

Clean-room에서는:

cost =
      w1 * branchLength
    + w2 * horizontalOffset
    + w3 * anglePenalty
    + w4 * collisionPenalty
    + w5 * trunkCountPenalty
    + w6 * loadPenalty

를 사용한다.

목표:

Support contact는 충분히 많게
Main trunk는 필요 이상으로 많지 않게
Branch는 짧게
급격한 각도는 피하게
Model 관통은 금지

25. Support Landing

Support Bottom 파라미터와
Tail Contact 파라미터가 서로 별도로 존재한다.

[확정]

예:

supportBottomShape
supportBottomDiameter
supportBottomThickness

supportTouchTailShape
supportTouchTailDiameter
supportTailTouchDepth
supportTouchTailPoint

따라서 Support 아래 방향 ray/collision 결과에 따라:

Platform Landing
또는
Model Landing

을 구분하는 구조로 구현하는 것이 적절하다.

Clean-room:

hit = castDown(branchPoint)

if no model before platform:
    createPlatformFoot()
else:
    createModelTailContact(hit)

26. Collision / Auto Avoid

다음 타입이 직접 존재한다.

[확정]

ColDetectTri
AutoAvoidTri
autoAvoid
AutoAvoidOp

이것은 Support/geometry 연결 시 Triangle collision을
별도의 구조로 다룬다는 강한 증거다.

Clean-room 권장:

Branch candidate
     ↓
Capsule / segment collision
     ↓
collision?
  ┌──┴──┐
 No    Yes
 │      │
Use   search alternate trunk
       ↓
     offset / turn
       ↓
    no valid path?
       ↓
    new trunk

Avoid 기능은 Support의 안전성을 위해
Tree merge보다 우선한다.

27. Cross Brace

설정에서 직접 확인:

supportCrossEnable = 1
supportCrossDiameter = 1.0 mm
supportConnMinHeight = 3.0 mm
minimalSupportCrossSpacingZ = 2 mm
maximalSupportCrossSpacingXY = 10 mm

[확정]

Clean-room 기본 규칙:

for each trunk A:

    if A.height < supportConnMinHeight:
        continue

    neighbors =
        spatialIndex.queryRadiusXY(
            A,
            maximalSupportCrossSpacingXY
        )

    for B in neighbors:

        choose braceZ

        if abs(braceZ - previousBraceZ) <
           minimalSupportCrossSpacingZ:
            continue

        if brace collision:
            continue

        createBrace(
            diameter = supportCrossDiameter
        )

Cross는 main structural supports가 완성된 이후 생성한다.

28. Manual Support의 주변 Pillar 연결

설정:

supportCrossWidth = 4

개발자 주석:

Manual Support를 추가할 때 주변에 pillar가 있으면
platform까지 내리지 않고 옆 Support에 직접 연결한다.

[확정]

따라서 Manual Support도 Auto Support와
동일한 Tree Builder를 재사용해야 한다.

나쁜 설계:

Manual Support engine
Auto Support engine

두 개를 완전히 따로 구현.

좋은 설계:

Contact Candidate Source
 ├─ Manual click
 └─ Auto sampler
        ↓
Common Support Tree Builder

29. Viewer Picking → Manual Support

view94.md의 PickHit를 그대로 사용한다.

struct PickHit {
    bool hit;
    uint32_t modelId;
    uint32_t faceId;

    Vec3 worldPos;
    Vec3 normal;

    float u, v, w;
};

Manual Support:

Mouse click
 ↓
GPU Face Picking
 ↓
CPU ray / triangle intersection
 ↓
PickHit
 ↓
ContactNode
 ↓
Tree Builder
 ↓
Collision check
 ↓
Support geometry

30. Real-Time Support Point

다음이 직접 확인된다.

[확정]

mbRealTimeAddSup
realTimeSupPnts
realTimeSupPntsJob
RealTimeSupPntsOp
RealTimeSupPntsJob

즉 마우스 이동/편집 중
Support Point 후보를 background에서 계산하고
guide/preview를 표시할 수 있는 구조가 존재한다.

Clean-room에서는:

Mouse hover / move
      ↓
debounce
      ↓
async candidate calculation
      ↓
preview only
      ↓
click
      ↓
commit support

형태로 구현한다.

31. Auto Supplement

다음이 직접 확인된다.

[확정]

autoSupplement
autoSupplementJob

AutoSupplementOp
AutoSupplementJob

autoSupplementDone_Slot

따라서 Auto Support 생성 이후
보완을 수행하는 별도 operation/job 계층이 존재한다.

32. Missing Points / Missing Triangles

다음이 직접 확인된다.

[확정]

SelMissPntsOp
SelMissPntsJob

SelMissTrisOp
SelMissTrisJob

Qt Meta Object:

selTris_selMissPnts
selMissPntsJob
selMissTrisJob

따라서 최소한 개념적으로:

Point coverage check
+
Triangle / area coverage check

를 별도로 수행한다.

중요한 설계 의미

단순히:

각 Candidate에 pillar 하나 달았으니 끝

으로 Auto Support를 종료하면 안 된다.

1차 결과를 다시 검사하여
지원이 부족한 surface/region을 찾는 후처리가 필요하다.

33. Clean-room Unsupported Region 검사

33.1 Point Coverage

각 mandatory/sample point에서
기존 support contact까지의 geodesic/XY 거리 검사:

if nearestContactDistance > allowedSpacing:
    markMissingPoint()

33.2 Triangle Coverage

큰 Triangle 또는 넓은 surface patch는
vertex들이 지지되어 있어도 중앙이 멀 수 있다.

각 overhang face/patch에 대해:

nearest support distance
supported projected area
local span
curvature

를 계산한다.

33.3 Supplemental Candidate

missing point
또는
missing triangle centroid / medial point

를 우선 candidate로 넣고
Tree Builder를 다시 실행한다.

34. 권장 Auto Supplement Pipeline

정확한 CHITUBOX 내부 call order라고 단정하지 않고,
확인된 Job 구조를 재현하기 위한 Clean-room 순서다.

Initial Auto Support
       ↓
Build support tree
       ↓
Collision validation
       ↓
Point coverage analysis
       ↓
Triangle/region coverage analysis
       ↓
Generate missing candidates
       ↓
AutoSupplement
       ↓
Tree re-optimization
       ↓
Cross brace

Cross brace를 최종 topology 이후에 만드는 것을 권장한다.

35. Support Point Grid / Spatial Hash

앞서 분석된 binary에서
candidate 좌표를 2D grid index로 매핑하는 코드가 확인됐다.

Clean-room 구현:

struct CellCoord {
    int x;
    int y;
};

CellCoord cell(Vec2 p) {
    return {
        floor((p.x - origin.x) / cellSize.x),
        floor((p.y - origin.y) / cellSize.y)
    };
}

그리고:

cell → candidate list
cell → support trunk list

를 유지한다.

주변 검색은 3×3 또는 radius에 따라 확장.

Support 수가 많아져도 O(N²)를 피할 수 있다.

36. BVH와 Support Spatial Index 분리

추천:

Mesh BVH
    → raycast
    → collision
    → distance to model

Support Spatial Hash
    → nearest candidate
    → nearest trunk
    → merge
    → cross brace

서로 목적이 다르므로 하나의 tree에 모든 것을 넣지 않는다.

37. 정확히 확인되지 않은 부분

현재 V1.9.4 정적 분석만으로 다음은 확정하지 않는다.

37.1 Density formula

supportDensity = 50
       ↓
spacing = ? mm

정확한 변환식 미확정.

37.2 Sampling distribution

최종 point distribution이:

Grid
Poisson disk
Delaunay
random jitter
layer contour

중 어떤 조합인지 정확히 미확정.

37.3 Low Point inequality

Local-minimum 판정의 exact epsilon,
normal 조건, edge 처리식은 미확정.

37.4 Tree cost

어떤 후보 trunk를 우선 선택하는지에 대한
정확한 original cost function은 미확정.

37.5 AutoAvoid 경로탐색

회피 시:

offset
turn
new trunk

중 어떤 우선순위인지 정확히 미확정.

이 항목들은 실제 CHITUBOX 결과 비교 테스트를 통해 추가로 좁힌다.

38. 테스트를 통한 역검증 계획

같은 STL, 같은 위치/회전을 사용한다.

Test A — Density

Middle
Angle 45°

Density 20
Density 50
Density 80

기록:

Contact count
Main trunk count
평균 contact spacing
평균 trunk spacing
Fork count

이 테스트로 Density → spacing 관계를 추정한다.

Test B — Angle

Density 50

Angle 30
Angle 45
Angle 60

기록:

support contact 위치
overhang red 영역
총 contact 수

Viewer와 Auto Support의 angle convention을 맞춘다.

Test C — Fork

가까운 2~5개의 낮은 돌출부가 있는 단순 모델.

측정:

몇 mm 간격까지 trunk merge?
branch 최대 수평 offset?
branch angle?

Test D — Collision

Support 경로 바로 아래에 다른 model surface가 있는 형상.

확인:

model에 landing?
옆으로 우회?
새 trunk 생성?

Test E — Flat Overhang

큰 수평 plate.

확인:

sampling pattern
edge margin
interior spacing

39. 구현할 Support Engine 구조

권장 구조:

supp/
 ├─ para/
 │   └─ SupportProfile
 │
 ├─ detect/
 │   ├─ OverhangDetector
 │   ├─ LowPointDetector
 │   └─ IslandDetector
 │
 ├─ samp/
 │   ├─ LayerSampler
 │   ├─ PointSampler
 │   └─ SpatialGrid
 │
 ├─ tree/
 │   ├─ SupportTree
 │   ├─ TreeBuilder
 │   └─ MergeCost
 │
 ├─ coll/
 │   ├─ CollisionChecker
 │   └─ AutoAvoid
 │
 ├─ miss/
 │   ├─ PointCoverage
 │   ├─ TriangleCoverage
 │   └─ Supplement
 │
 ├─ geom/
 │   ├─ TipBuilder
 │   ├─ BranchBuilder
 │   ├─ TrunkBuilder
 │   ├─ BottomBuilder
 │   ├─ CrossBuilder
 │   └─ SupportMesher
 │
 └─ edit/
     ├─ ManualSupport
     └─ UndoCommand

신규 폴더명을 짧게 유지해야 한다면 위와 같이 6자 이내 이름을 사용한다.

40. 핵심 데이터 구조

40.1 Profile

struct SupportProfile {
    float tipUpDiameter;
    float tipDownDiameter;
    float tipLength;
    float tipTouchDepth;

    float middleDiameter;
    float middleDiameter2;
    float maxConnectAngle;

    float smallPillarDiameter;
    float maxSmallPillarLength;

    float bottomDiameter;
    float bottomThickness;

    float edgeMargin;
    float modelClearance;
    float maxContactOffset;

    bool crossEnabled;
    float crossDiameter;
    float crossMinHeight;
    float crossMinSpacingZ;
    float crossMaxSpacingXY;
};

40.2 Candidate

struct SupportCandidate {
    Vec3 pos;
    Vec3 normal;

    ModelId model;
    FaceId face;

    CandidateKind kind;

    float priority;
    bool mandatory;
};

40.3 Tree

using NodeId = uint32_t;

struct SupportNode {
    NodeId id;
    SupportNodeType type;
    Vec3 pos;
};

struct SupportEdge {
    NodeId a;
    NodeId b;

    float radiusA;
    float radiusB;
};

struct SupportTree {
    std::vector<SupportNode> nodes;
    std::vector<SupportEdge> edges;
};

41. Clean-room Auto Support 의사코드

SupportResult generateAutoSupport(
    MeshData& mesh,
    const SupportProfile& profile,
    const AutoSupportSettings& settings)
{
    // 1. Geometry preprocessing
    mesh.ensureFaceNormals();
    mesh.ensureAdjacency();
    mesh.ensureBVH();

    // 2. Detect
    auto overhang =
        detectOverhang(
            mesh,
            settings.angle
        );

    auto lowPoints =
        detectLowPoints(
            mesh,
            overhang
        );

    // 3. Sample
    auto samples =
        sampleOverhangRegions(
            mesh,
            overhang,
            settings
        );

    auto candidates =
        mergeMandatoryAndRegular(
            lowPoints,
            samples
        );

    // 4. Filter
    filterEdgeMargin(
        candidates,
        profile.edgeMargin
    );

    enforcePointSpacing(
        candidates,
        settings
    );

    // 5. Build tree
    SupportTree tree;

    for(auto& c : priorityOrder(candidates))
    {
        auto trunkCandidates =
            findNearbyTrunks(c);

        auto best =
            chooseMergeTarget(
                c,
                trunkCandidates,
                profile
            );

        if(best.valid)
            createFork(tree, c, best);
        else
            createNewTrunk(tree, c);
    }

    // 6. Landing / collision
    resolveLandings(tree, mesh);
    resolveCollisions(tree, mesh);

    // 7. Coverage
    auto missingPoints =
        findMissingPoints(
            mesh,
            overhang,
            tree
        );

    auto missingFaces =
        findMissingFaces(
            mesh,
            overhang,
            tree
        );

    // 8. Supplement
    supplement(
        tree,
        missingPoints,
        missingFaces
    );

    // 9. Structural brace
    if(profile.crossEnabled)
        addCrossBraces(tree, profile);

    // 10. Mesh
    return buildSupportMesh(
        tree,
        profile
    );
}

이 코드는 CHITUBOX 원본 소스가 아니라
확인된 동작 구조를 바탕으로 작성한 독립 구현용 의사코드다.

42. Tree Builder 상세

권장 우선순위:

Mandatory Low Point
    >
Island Start
    >
Boundary Candidate
    >
Interior Candidate
    >
Supplement Candidate

각 Contact마다:

nearbyTrunks =
    trunkGrid.queryRadius(
        contact.xy,
        maxOffset
    )

best = none

for trunk in nearbyTrunks:

    branch = segment(contact, trunk)

    if length(branch) > maxSmallPillarLength:
        continue

    if angle(branch, trunkAxis) > maxConnectAngle:
        continue

    if collision(branch):
        continue

    score = mergeCost(branch, trunk)

    if score < best.score:
        best = trunk

if best:
    addFork(contact, best)
else:
    createTrunk(contact)

43. Support Geometry 생성

각 Tree Edge는 직접 mesh primitive로 변환한다.

Tip

contact point
     ▼
small diameter
     /\
    /  \
   /    \
larger diameter

Branch

두 point A, B 사이 cylinder/cone:

center = (A+B)/2
length = |B-A|
axis   = normalize(B-A)

Z cylinder primitive를 axis 방향으로 회전시킨다.

Joint

Fork joint에서 gap이 생기지 않도록:

sphere
또는
overlapping cones/cylinders

를 사용한다.

Bottom

Platform landing:

trunk
  │
 boss
  │
skate / cone / base

Model landing:

trunk
  │
tail contact
  ▼
model surface

44. Support Mesh와 Logical Tree를 분리

중요:

SupportTree

가 진짜 데이터다.

SupportMesh는 표시/슬라이싱을 위한 파생 결과로 취급한다.

나쁜 구조:

STL geometry를 수정해서 Support 상태를 관리

좋은 구조:

SupportTree
  ↓
rebuild only dirty geometry
  ↓
SupportRenderMesh

이 구조면 Support node 이동/삭제/Undo가 쉬워진다.

45. Manual Support 편집 규칙

Add

PickHit
 ↓
Contact node
 ↓
Tree Builder

Delete

선택 node가 Contact이면:

해당 branch 제거
 ↓
사용하지 않는 fork/trunk prune
 ↓
Cross 재생성

Move

Tip 이동:

Contact 위치 변경
 ↓
local tree rebuild
 ↓
collision check

전체 Support를 매번 처음부터 생성하지 않는다.

46. Support Statistics

EXE에는 다음 통계 문자열이 직접 존재한다.

[확정]

total Support Num:
Up Touch Support Num:
Main Support Num:

그리고 메서드:

getTotalSupportNum
getTotalUpTouchSupportNum
getTotalMainSupportNum

가 확인된다.

따라서 Clean-room에서도 최소 다음 통계를 유지한다.

struct SupportStats {
    int total;
    int contactCount;
    int mainTrunkCount;
    int forkCount;
    int crossCount;
};

이 값은 CHITUBOX 결과와 비교하는 역검증에도 매우 유용하다.

47. 단계별 구현 계획

Phase 1 — Manual Support Primitive

완료 조건:

Viewer Face Pick 가능

클릭점 Contact 생성

Vertical support 1개 생성

Tip/Middle/Bottom profile 반영

삭제 가능

Phase 2 — Mesh Analysis

완료 조건:

normals

adjacency

BVH

overhang triangles

overhang region

low point

Phase 3 — Auto Point Sampling

완료 조건:

mandatory low points

region sampling

edge margin

point spacing

candidate visualization

아직 Tree를 만들지 말고
candidate point만 화면에 표시하여 검증한다.

Phase 4 — Support Tree

완료 조건:

independent trunk

nearby trunk query

fork

tree merge

angle limit

offset limit

branch length limit

Phase 5 — Collision / Landing

완료 조건:

branch vs mesh

model clearance

platform landing

model landing

avoid/new trunk fallback

Phase 6 — Supplement

완료 조건:

missing point

missing triangle/region

supplemental candidate

local tree rebuild

Phase 7 — Cross / Raft

완료 조건:

cross brace

min height

max XY

min Z spacing

bottom / raft geometry

Phase 8 — Performance

완료 조건:

worker thread

cancellation

BVH

support spatial grid

local dirty rebuild

48. Acceptance Test

48.1 Manual Support

Cube 또는 경사 test model.

클릭한 triangle 위치에 정확히 tip 생성

model 이동 후 support 위치 일관성

삭제 후 orphan trunk가 남지 않음

48.2 Low Point

원뿔/구/다중 돌기 모델.

최초 출력되는 최저점이 mandatory candidate가 됨

동일 높이 plateau에서 과도하게 수십 개 생성되지 않음

48.3 Edge Margin

Flat overhang.

boundary 바로 위에 support가 붙지 않음

설정값 변경 시 candidate가 안쪽/바깥쪽으로 변함

48.4 Tree

서로 가까운 contact 3개.

일정 거리 이내에서 fork 가능

offset > 3 mm이면 무리한 merge 금지

branch > 3 mm이면 새 trunk 후보

angle > profile max angle이면 merge 금지

위 값은 기본 profile에서 시작하고,
최종 UX는 테스트로 조정한다.

48.5 Collision

Branch 사이에 model wall을 둔다.

branch가 model을 관통하면 실패

다른 trunk 또는 새 trunk를 선택

48.6 Cross

서로 가까운 긴 trunk 2개.

높이 < 3 mm에서는 cross 없음

XY > 10 mm에서는 cross 없음

Z spacing < 2 mm로 중복 cross 생성 금지

48.7 Supplement

넓은 overhang.

1차 sampling을 일부러 성기게 설정.

1차 결과 후 unsupported area 검출

supplemental point 추가

기존 tree 전체를 불필요하게 재생성하지 않음

49. CHITUBOX와 비교할 데이터

스크린샷만 찍지 말고 가능하면 다음 값을 함께 기록한다.

STL
Model transform
Support profile
Angle
Density

그리고 결과:

Total Support
Up Touch Support
Main Support

화면에서 가능하면:

front
side
isometric

3장.

가장 가치 있는 비교:

Density 20 / 50 / 80
Angle 30 / 45 / 60

50. 다른 AI에게 주는 구현 지시문

아래 내용을 이 문서 및 view94.md와 같이 전달한다.

AI 작업 명령

너는 DLP/LCD/SLA 레진 3D 프린터용 슬라이서의
Manual + Auto Support Engine을 구현한다.

CHITUBOX의 원본 코드를 복제하거나 추출하려 하지 말고,
supp94.md에 정리된 관찰된 기능과 동작을
Clean-room 방식으로 독립 구현한다.

view94.md의 Viewer / Picking / MeshData 구조와 반드시 연결한다.

가장 중요한 설계 규칙

CPU 계산용 MeshData와 GPU 표시용 Mesh를 분리한다.

Support의 원본 데이터는 Mesh가 아니라 SupportTree다.

Manual과 Auto Support는 같은 Tree Builder를 사용한다.

Auto Support는 아래 순서를 기본으로 한다.

Overhang
→ Low Point
→ Candidate Sampling
→ Filtering
→ Tree/Fork
→ Collision/Landing
→ Missing Coverage
→ Supplement
→ Cross
→ Mesh

OverhangDetector는 Viewer의 overhang highlight와 동일 threshold 함수를 사용한다.

Candidate search와 trunk search는 Spatial Grid/Tree를 사용한다.

Mesh collision은 BVH를 사용한다.

UI Thread에서 Auto Support 전체 계산을 하지 않는다.

Worker는 cancel 가능해야 한다.

정확히 확인되지 않은 CHITUBOX 공식을 임의로 꾸며서 “원본 공식”이라고 부르지 않는다.

구현 전

현재 프로젝트에서 다음을 먼저 조사한다.

Mesh data model
Renderer
Camera
Picking
Transform
Thread model
Undo/Redo

그 다음 기존 구조와 충돌하지 않는 최소 변경안을 제시한다.

구현 순서

반드시:

Phase 1
→ Test
→ Phase 2
→ Test
...

방식으로 진행한다.

한 번에 모든 기능을 대량 생성하지 않는다.

각 단계 완료 보고

매 단계마다:

변경 파일

각 파일 책임

핵심 알고리즘

사용한 수학/자료구조

테스트 방법

테스트 결과

미구현 기능

다음 단계

를 보고한다.

51. 최종 시스템 구조

                       MeshData
                          │
           ┌──────────────┼──────────────┐
           │              │              │
           ▼              ▼              ▼
        Viewer        Mesh BVH       Adjacency
           │              │              │
           │              │              ▼
           │              │        OverhangDetector
           │              │              │
           │              │              ▼
           │              │        LowPointDetector
           │              │              │
           │              │              ▼
           │              │          PointSampler
           │              │              │
           │              │              ▼
           │              │         Candidates
           │              │              │
           │              │              ▼
Mouse ─► Picking          │         SpatialGrid
           │              │              │
           ▼              │              ▼
        PickHit            └──────► TreeBuilder
           │                              │
           │                              ▼
           └──────────────►         SupportTree
                                          │
                         ┌────────────────┼───────────────┐
                         │                │               │
                         ▼                ▼               ▼
                   Collision         Supplement        Cross
                         │                │               │
                         └────────────────┼───────────────┘
                                          ▼
                                      SupportMesh
                                          │
                          ┌───────────────┴──────────────┐
                          ▼                              ▼
                       Viewer                         Slicer

52. 현재 결론 — v2

V1.9.4의 정적 분석과 실제 Auto Support 비교 테스트를 합치면 다음은 매우 강하게 지지된다.

CHITUBOX V1.9.4의 Auto Support는
단순 Vertical Support Engine이 아니다.

전체 시스템은 적어도 개념적으로 다음 단계가 분리되어 있다.

Angle 기반 Overhang Region
+
Low Point / Island Start Mandatory Candidate
+
Density 기반 Region Sampling
+
Spatial Search
+
Main Support Tree / Fork
+
Collision / Auto Avoid
+
Missing Point / Missing Triangle
+
Auto Supplement
+
Cross Brace
+
Model / Platform Landing

실제 실행 결과에서는:

Angle 30°
→ 일반 경사면 Support가 거의 사라져도
  최저 시작 지점 Support는 남음

Density 20 → 50 → 80
→ 같은 Angle에서 Contact가 점점 촘촘해짐

Contact 증가
≠
Main Trunk 1:1 증가

가 확인됐다.

따라서 가장 중요한 구현 원칙은 다음이다.

Support Contact 생성 문제와 Main Support 구조 생성 문제를 반드시 분리한다.

Contact
  ↓
Short Branch
  ↓
Fork
  ↓
Shared Main Trunk

그리고 역할을 명확히 나눈다.

Angle   → 대상 Region
Density → Contact Sampling
Profile → Support Geometry

아직 추가 실험이 필요한 부분:

Density → exact mm spacing
Angle → exact normal.z threshold
Sampling distribution
Tree merge cost
AutoAvoid 우선순위
Supplement coverage threshold

이 항목은 중간 Angle/Density sweep과 실제 결과 계수화로 추가 검증한다.