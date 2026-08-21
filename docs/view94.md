CHITUBOX V1.9.4 3D Viewer Clean-room 분석·구현 사양

0. 문서 목적

이 문서는 CHITUBOX V1.9.4의 실행 파일과 설치 폴더에서 관찰되는 3D Viewer 구조를 바탕으로, 원본 코드를 복제하지 않고 동작과 아키텍처를 독립 구현하기 위한 Clean-room 사양서다.

목표는 다른 AI 또는 개발자가 이 문서만 읽고 다음 기능을 구현할 수 있게 하는 것이다.

STL/OBJ 등 Triangle Mesh 표시

Build Plate/Grid 표시

Orbit / Zoom / 정투영·원근투영

모델 Face Picking

Support Point Picking

Screen → World 좌표 변환

수동 Support 배치에 필요한 정확한 3D 접촉점 계산

Overhang 강조

출력영역 초과 표시

Z/XYZ Clipping

모델 Shadow

Viewer와 Auto/Manual Support 모듈 연결

주의: 아래 내용은 바이너리의 문자열, RTTI, Shader 문자열, import, 호출 흐름 및 어셈블리 동작을 분석해 재구성한 것이다. 원본 소스코드를 그대로 복원하거나 복제하는 것이 목적이 아니다.

1. 분석 신뢰도 표기

[확정]: 실행파일 내부의 클래스명, Shader 문자열, import, 상수 또는 어셈블리에서 직접 확인

[높음]: 여러 직접 증거가 일치하며 동작이 거의 확실

[추정]: 구조상 가능성이 높지만 정확한 조건/이름은 미확정

2. 전체 Viewer 아키텍처

2.1 핵심 구조

[확정] 메인 3D 작업창은 Qt Quick/QML UI와 직접 작성된 C++ OpenGL Renderer가 결합된 구조다.

관찰된 주요 타입:

OpenGLItem

MainWindowRenderer

RenderBase

ModelRender

ModelRender2

PlatformRender

ShadowRender

ModelPickRender

LinePickRender

SupportPntRender

SupportPntPickRender

TriangleLineRender

BadEdgeRender

BadTriRender

ModelHintRender

SlicerDataRender

AreaSelectPntsRender

PointsSimpleRender

권장 Clean-room 구조:

UI
 │
 ▼
ViewWidget / OpenGLItem
 │
 ▼
MainRenderer
 │
 ├─ PlateRenderer
 ├─ ShadowRenderer
 ├─ ModelRenderer
 ├─ SupportRenderer
 ├─ OverlayRenderer
 └─ PickingRenderer

2.2 Qt Quick와 Render Thread

[확정] 다음 Qt Quick lifecycle API 흔적이 존재한다.

beforeSynchronizing

beforeRendering

afterRendering

sceneGraphInvalidated

setClearBeforeRendering

resetOpenGLState

QQuickWindow::update

따라서 UI 상태와 OpenGL 상태를 분리해 동기화하는 구조다.

Clean-room 구현에서도 다음 원칙을 사용한다.

UI Thread는 모델 목록, 선택 상태, Camera 명령을 관리한다.

Render Thread 또는 GL Context 소유 Thread가 GPU 자원을 관리한다.

UI 변경을 매 프레임 GPU Buffer 전체 업로드로 처리하지 않는다.

dirty flag를 두어 변경된 데이터만 갱신한다.

3. Mesh 데이터 구조

3.1 파일 Loader

[확정] 다음 Loader/Model 타입 흔적이 존재한다.

MeshLoaderBase

MeshLoaderProxy

STLMesh

ObjMesh

CADFormatMesh

SLCMesh

PhotonsMesh

PrjMesh

WowMesh

SvgMesh

SvgxMesh

STL 관련 소스 경로 문자열도 존재한다.

..\chitulayout\model\STLMesh.cpp
STLMesh::load

3.2 CPU Mesh와 GPU Mesh는 분리한다

다른 AI가 구현할 때 가장 중요한 설계 원칙이다.

CPU Mesh

계산용:

MeshData
 ├─ vertices[]
 ├─ faces[]
 ├─ faceNormals[]
 ├─ vertexNormals[]
 ├─ adjacency
 ├─ AABB
 └─ BVH / SpatialIndex

이 데이터는 다음 기능에 공통 사용한다.

Auto Support

Manual Support

Hollow

Hole

Boolean

Mesh Repair

Overhang 계산

Slicing

GPU Render Mesh

화면 출력용:

RenderMesh
 ├─ VAO
 ├─ VBO
 ├─ optional IBO
 └─ drawRanges

[확정] Picking Shader에서는 Face ID를 vertex index / 3 또는 primitive ID로 계산하는 변형이 존재하므로, Picking 경로에서는 Triangle을 3개의 연속 Vertex로 펼친 Buffer를 지원한다.

예:

Tri 0 → V0 V1 V2
Tri 1 → V3 V4 V5
Tri 2 → V6 V7 V8

Clean-room 구현은 CPU topology를 이 형식에 종속시키지 않는다.

4. Camera State

4.1 확인된 기본 Camera 값

[확정] Camera 초기화 어셈블리에서 다음 값이 직접 확인된다.

rotationX = -70°
rotationY =   0°
rotationZ = +15°

translateX =    0
translateY =  -50
translateZ = -370

rotationSensitivity = 1.0

Clean-room 데이터 구조 예:

struct CameraState {
    float rotX = -70.0f;
    float rotY = 0.0f;
    float rotZ = 15.0f;

    float tx = 0.0f;
    float ty = -50.0f;
    float tz = -370.0f;

    float orbitSensitivity = 1.0f;

    Vec3 orbitCenter = {0, 0, 0};
    bool perspective = true;
};

4.2 View Matrix

[확정] Matrix 생성은 다음 순서의 호출을 포함한다.

Identity

Camera Translation

X Rotation

Y Rotation

Z Rotation

필요 시 선택된 회전 중심점/모델 중심으로 Translation

논리식:

V = Tcamera × Rx × Ry × Rz × Tcenter

정확한 행렬 곱 방향은 사용하는 수학 라이브러리의 convention에 맞춰 검증해야 한다.

핵심은 orbitCenter를 독립 상태로 둬야 한다는 점이다.

5. Orbit 조작

5.1 Right Mouse Drag

[확정] Mouse Move 처리에서 Qt::RightButton 비트를 직접 검사한다.

마우스 이동량:

dx = mouseX - prevX
dy = mouseY - prevY

Camera 갱신:

rotX += dy × sensitivity × 0.5
rotZ += dx × sensitivity × 0.5

즉 기본 sensitivity=1일 때 약:

0.5 degree / pixel

이다.

[확정] Y축 회전값은 이 특정 Right Drag 경로에서 변경되지 않는다.

Clean-room 구현에서는 CHITUBOX의 조작감을 원하면 이 관계를 그대로 “동작 사양”으로 재현할 수 있다.

onRightDrag(dx, dy):
    camera.rotX += dy * camera.orbitSensitivity * 0.5
    camera.rotZ += dx * camera.orbitSensitivity * 0.5
    requestRedraw()

각도 wrapping/clamp의 정확한 원본 조건은 현재 미확정이다.

6. Perspective / Orthographic Projection

6.1 Perspective

[확정] Main Viewer의 QMatrix4x4::perspective() 호출 인자에서 다음 상수를 확인했다.

vertical FOV = 45°
near plane   = 1
far plane    = 6000
aspect       = viewportWidth / viewportHeight

따라서:

P = perspective(
    fovY = 45,
    aspect = W/H,
    near = 1,
    far = 6000
)

6.2 Orthographic

[확정] 정투영에서는 Camera Z 거리를 화면 scale로 사용한다.

기본적으로 D = abs(camera.tz)라고 해석할 수 있고:

left   ≈ -D
right  ≈ +D

bottom ≈ -D × H/W
top    ≈ +D × H/W

near   = -1000
far    = +2000

형태의 QMatrix4x4::ortho() 호출이 확인된다.

Clean-room 구현:

D = max(epsilon, abs(camera.tz))
halfW = D
halfH = D * viewportHeight / viewportWidth

P = ortho(
    -halfW, +halfW,
    -halfH, +halfH,
    -1000, +2000
)

원본의 Z 부호 convention보다 사용자가 보는 조작감을 우선해 구현하면 된다.

7. Wheel Zoom

Wheel Zoom은 CHITUBOX Viewer의 중요한 특징이다.

7.1 Event Throttle

[확정]

Wheel Event가 너무 빠르게 들어올 경우 약 30 ms 이하 간격의 이벤트를 건너뛰는 경로가 있다.

Clean-room에서는 필수는 아니지만 동일한 조작감을 원하면 적용 가능하다.

7.2 Zoom Scale

[확정]

Wheel delta에 다음 계열 factor가 적용된다.

일반: multiplier 1.0

Ctrl modifier: multiplier 0.15

추가 기본 계수: 0.1

따라서 Ctrl을 누르면 Fine Zoom 성격을 갖는다.

7.3 Perspective Zoom

[확정/높음]

Perspective에서는 단순히 Camera Z만 바꾸지 않는다.

Mouse cursor를 Normalized Device Coordinate로 변환

같은 X/Y에서 서로 다른 depth로 UnProject

두 World Point 차이로 Camera Ray 계산

Ray normalize

Wheel delta에 따른 거리만큼 (tx, ty, tz)를 Ray 방향으로 이동

즉 Zoom toward cursor 형태다.

관찰된 두 depth 상수는 약:

0.999802
0.999873

다른 AI가 새로 구현할 때는 이 숫자를 그대로 의존할 필요 없이 표준 NDC near/far를 사용해 Ray를 만들면 된다.

권장 구현:

ray = screenRay(mouseX, mouseY)

distance = wheelDelta * zoomFactor

camera.position += ray.direction * distance

핵심 UX 조건:

마우스가 가리키는 모델 위치 쪽으로 확대/축소되어야 한다.

7.4 Orthographic Zoom

[확정/높음]

Orthographic에서는:

Zoom 전 cursor의 World 위치를 UnProject

Orthographic scale 변경

Zoom 후 같은 cursor 위치를 다시 UnProject

두 World 좌표 차이를 Camera Translation에 더함

따라서 Cursor 아래의 World Point가 화면에서 거의 움직이지 않는다.

권장 알고리즘:

before = unprojectCursor(mouse, camera)

camera.orthoScale *= zoomRatio

after = unprojectCursor(mouse, camera)

camera.pan += before - after

이 방식은 Viewer 사용성이 매우 좋으므로 적극 채용 권장.

8. Screen → World : UnProject

[확정] 실행파일에:

..\core\math\UnProject.cpp
UnProject::unProject

가 존재한다.

어셈블리에서는:

4×4 Matrix 비교/cache

QMatrix4x4::inverted()

Vector 변환

homogeneous w divide

를 확인했다.

Clean-room 표준 구현:

ndcX =  2 * mouseX / viewportWidth  - 1
ndcY =  1 - 2 * mouseY / viewportHeight

원근투영 Ray:

invPV = inverse(P * V)

near4 = invPV * Vec4(ndcX, ndcY, -1, 1)
far4  = invPV * Vec4(ndcX, ndcY, +1, 1)

near3 = near4.xyz / near4.w
far3  = far4.xyz  / far4.w

ray.origin = near3
ray.dir = normalize(far3 - near3)

Qt/OpenGL depth convention에 따라 NDC Z는 구현 환경에 맞춰 검증한다.

9. Face Picking

9.1 GPU Color ID Picking

[확정] ModelPickRender는 각 Triangle Face ID를 4개의 8-bit channel로 encode한다.

개념:

faceId = triangle index

분해:

R =  faceId        & 255
G = (faceId >> 8)  & 255
B = (faceId >> 16) & 255
A = (faceId >> 24) & 255

Picking Framebuffer에:

RGBA = (R,G,B,A) / 255

로 출력한다.

실행파일에는 세 가지 계열 Shader 변형이 존재한다.

별도 vertexId attribute 기반

gl_VertexID / 3

gl_PrimitiveID

9.2 Decode

Mouse 좌표의 한 Pixel을 glReadPixels()로 읽고:

faceId =
    R
  + G * 256
  + B * 65536
  + A * 16777216

로 복원한다.

9.3 Picking Pass와 Z Clip

[확정] Picking Shader도 topVisibleHeight / bottomVisibleHeight clipping을 적용한다.

즉 화면에서 숨긴 부분이 Picking 대상이 되는 오류를 방지한다.

9.4 Clean-room 개선 권장

CHITUBOX 호환 동작은 RGBA8 Picking으로 가능하다.

새 구현이 OpenGL 3.3+라면 더 안전한 방법:

R32UI Integer Picking Buffer

를 권장한다.

장점:

sRGB 변환 영향 없음

MSAA color blending 문제 없음

ID encode/decode 불필요

32-bit ID 직접 저장

RGBA8을 쓰면 Picking FBO에서는:

MSAA OFF 또는 resolve 주의

Blending OFF

sRGB conversion OFF

nearest/exact color 유지

가 필요하다.

10. 정확한 3D 접촉점 계산

Face Picking만으로는 Triangle 번호만 알 수 있다.

Manual Support를 달려면 정확한 World Position이 필요하다.

권장 Pipeline:

Mouse
 ↓
GPU Picking
 ↓
modelId + faceId
 ↓
Screen Ray
 ↓
CPU Mesh의 선택 Face 조회
 ↓
Ray-Triangle Intersection
 ↓
World Contact Point
 ↓
Barycentric Coordinate
 ↓
Interpolated / Face Normal

권장 결과 구조:

struct PickHit {
    bool hit;
    uint32_t modelId;
    uint32_t faceId;

    Vec3 worldPos;
    Vec3 normal;

    float u;
    float v;
    float w;

    float distance;
};

Ray-Triangle은 Möller–Trumbore를 사용하면 충분하다.

이 PickHit 하나를 다음 기능에서 공유한다.

Manual Support

Support Tip 이동

Hole 위치 지정

Measurement

Brush Face Selection

Local Overhang 검사

11. Support Point Picking

[확정]

별도 클래스:

SupportPntRender

SupportPntPickRender

가 존재한다.

Support Point는 GPU Point Primitive로 표시하며:

gl_PointSize = pointSize

를 사용한다.

Picking Renderer에서는 각 Point에 고유 ID/Color를 부여한다.

따라서 Model Face와 Support Control Point를 서로 다른 Picking layer로 분리해야 한다.

권장 ID 구조:

Object Type + Object ID

예:

0x01xxxxxx = Model Face
0x02xxxxxx = Support Tip
0x03xxxxxx = Support Node
0x04xxxxxx = Gizmo

또는 FBO를 종류별로 분리해도 된다.

12. Area Selection

[확정] AreaSelectPntsRender가 존재하며 Point ID Picking 방식과 연결되는 Shader가 확인된다.

Box Selection 구현:

Selection rectangle bounds 계산

Picking FBO의 해당 rectangle만 Readback

Pixel ID 집합 생성

중복 제거

선택 Point 목록 반환

큰 화면 전체를 항상 glReadPixels 하지 말고 필요한 Rectangle만 읽는다.

13. Model Rendering

13.1 Transform

[확정]

Vertex Transform의 논리 구조:

clipPos = Projection × View × Model × vertex

Normal은 별도의 Normal Matrix를 사용한다.

13.2 Lighting

[확정]

렌더링은 복잡한 PBR가 아니라 빠른 전통적 lighting이다.

핵심:

ambient 성분 ≈ baseColor × 0.3
diffuse 성분 ≈ color × 0.7 × N·L

불투명 상태에서는 작은 Specular를 추가한다.

관찰된 Specular 성격:

strength ≈ 0.3
shininess exponent ≈ 10

Clean-room에서는 아래 정도면 시각적으로 충분하다.

N = normalize(normal)
L = normalize(lightPos - worldPos)

diff = max(dot(N, L), 0)

color = base * (0.3 + 0.7 * diff)

if opaque:
    color += specular(...)

14. Overhang Highlight

[확정]

Overhang 표시에는 World/Model transformed Normal의 Z 성분을 사용한다.

논리:

modelHangZ = normal.z

그리고 threshold hangZ보다 작은 경우 기본 모델색과 Red를 혼합한다.

위험도가 커질수록 Red 비중이 커진다.

Clean-room:

if normalZ < hangZ:
    ratio = clamp(
        (hangZ - normalZ) / (hangZ + 1),
        0, 1
    )

    displayColor =
        mix(baseColor, overhangRed, ratio)

중요:

Auto Support가 사용하는 Overhang threshold와 Viewer의 hangZ 계산을 같은 utility 함수로 통일한다.

예를 들어:

support angle
    ↓
normal Z threshold
    ├─ Viewer red highlight
    └─ Support candidate detection

이렇게 해야 화면 표시와 실제 Auto Support 결과가 어긋나지 않는다.

15. Build Volume 초과 표시

[확정]

Shader에서 World Position을 Build Volume Min/Max와 비교한다.

다음 조건 중 하나라도 만족하면 경고색:

x < minX
x > maxX
y < minY
y > maxY
z > maxZ
z < allowedMinZ

Clean-room에서는 CPU에서 매 프레임 Triangle 검사를 하지 않고 Shader에서 즉시 색을 바꾸는 것이 좋다.

다만 출력 가능 여부 최종 판정은 별도의 CPU AABB 검사로도 수행한다.

16. Build Plate 접촉 표시

[확정]

abs(z)가 대략 layerHeight / 2 안에 들어오면 초록색 계열로 표시하는 Shader 경로가 있다.

Clean-room 용도:

모델이 Plate에 닿았는지 시각화

“Drop to plate” 기능 확인

음수 Z penetration 표시

17. Z / XYZ Clipping

[확정]

다음 uniform이 존재한다.

topVisibleHeight

bottomVisibleHeight

xyzVisibleMin

xyzVisibleMax

cutHeight

Fragment 단계에서 범위 밖 fragment를 discard한다.

즉 Mesh 자체를 매번 재절단하지 않고 GPU에서 시각적 clipping을 한다.

권장:

if worldZ < bottomVisibleZ or worldZ > topVisibleZ:
    discard

XYZ box clipping도 동일.

cutHeight 주변의 아주 얇은 구간은 단면 위치를 강조하는 별도 표시가 가능하다.

18. Platform / Grid

[확정]

Build Plate Grid는 단순 배경 PNG가 아니라 Shader 좌표 계산으로 생성하는 방식이다.

관찰된 parameter:

platformGridWidth

platformGridSpacing

machineLeftEdge

machineRightEdge

machineTopEdge

machineBottomEdge

periphery transparency 계열

Clean-room:

period = gridLineWidth + gridSpacing

fx = mod(abs(worldX), period)
fy = mod(abs(worldY), period)

if fx < lineWidth or fy < lineWidth:
    gridColor
else:
    plateColor

프린터 크기가 바뀌어도 Texture 교체가 필요 없다.

19. Shadow

[확정] ShadowRender.cpp 흔적과 Vertex의 Z를 0으로 만드는 Shader가 있다.

즉 모델을 Build Plate 방향으로 납작하게 투영해 Shadow를 만든다.

Clean-room:

shadowPos = modelMatrix * vertex
shadowPos.z = plateZ
clipPos = P * V * shadowPos

슬라이서에서는 복잡한 Shadow Map보다 이 방식이 빠르고 충분하다.

20. View Axis / Perspective UI

[확정] QML/Meta-object에서 다음 기능이 관찰된다.

home

front

back

left

right

top

bottom

setViewAxis

restoreViewAxia

perspective

get_perspective

switchPerspective

qmlXRotate

qmlYRotate

qmlZRotate

qmlViewCtrlAngle

mouseClickRotateCenter

특히 QML에는:

setViewAxis("top")
setViewAxis("front")
setViewAxis("left")
setViewAxis("home")

호출이 있다.

Clean-room에서는 View Cube 또는 Axis 버튼이 Camera preset을 호출하도록 한다.

21. Orbit Center

[높음]

mouseClickRotateCenter라는 property/signal이 존재하고, View Matrix 생성 코드에는 선택된 객체/점과 관련된 추가 Translation 경로가 있다.

따라서 Camera는 단순 World Origin 고정 Orbit만 사용하는 것이 아니라, 클릭한 모델 또는 선택 중심을 Orbit Center로 사용할 수 있는 구조로 보는 것이 타당하다.

권장:

orbitCenterMode:
  - World
  - Selection
  - ClickPoint

Manual Support 작업에서는 클릭점 회전이 매우 유용하다.

22. Keyboard View Translation

[확정/부분 미확정]

Keyboard event 처리 중 Ctrl modifier를 확인하는 경로에서 Camera X/Y Translation을 바꾸는 코드가 있다.

이동량은 대략:

step = abs(camera.tz) / 370

형태다.

즉 Zoom Level에 비례하여 Pan 속도가 달라진다.

정확한 Key → 방향 mapping 전체는 아직 미복원 상태다.

새 구현에서는:

panStep = abs(camera.tz) / 370

개념만 채용하고 키 설정은 UX에 맞게 정의하면 된다.

23. 3D Mouse 입력

[높음]

onMouse3DMove(std::vector<float>&) 형태의 메서드와 translation/rotation state를 동시에 갱신하는 코드가 확인된다.

SpaceMouse류 장치 지원용일 가능성이 높다.

최소 Viewer 구현에는 필요 없으므로 Phase 2 이후로 미룬다.

24. Render Pass 권장 순서

권장 Main Pass:

1. Clear
2. Build Plate
3. Procedural Grid
4. Model Shadow
5. Model Mesh
6. Support Mesh
7. Selected Face / Triangle Line
8. Support Control Points
9. Error / Bad Edge Overlay
10. Gizmo / Hint Overlay

별도 Picking Pass:

A. Model Face ID
B. Support Point ID
C. Gizmo ID

Picking Pass는 클릭 또는 선택이 필요한 프레임에서만 실행한다.

25. Viewer ↔ Support 연결 인터페이스

Auto/Manual Support와 Viewer를 절대 별도 세계로 만들면 안 된다.

공통 Mesh:

MeshData
 ├─ Viewer
 ├─ OverhangDetector
 ├─ LowPointDetector
 ├─ SupportSampler
 ├─ CollisionChecker
 └─ Slicer

Manual Support:

Mouse Click
 ↓
Face Picking
 ↓
PickHit
 ↓
Support Tip 생성
 ↓
Collision 검사
 ↓
Support Tree 갱신
 ↓
Support Renderer 갱신

Auto Support:

MeshData
 ↓
Overhang / Low Point
 ↓
Candidate
 ↓
Support Tree
 ↓
Support Mesh
 ↓
Viewer Support Renderer

26. 권장 프로젝트 모듈 구조

폴더명은 간단하게 유지한다.

src/
 ├─ view/
 │   ├─ scene
 │   ├─ state
 │   └─ input
 │
 ├─ cam/
 │   ├─ camera
 │   └─ unproj
 │
 ├─ mesh/
 │   ├─ load
 │   ├─ data
 │   └─ bvh
 │
 ├─ rend/
 │   ├─ main
 │   ├─ model
 │   ├─ plate
 │   ├─ shadow
 │   └─ supp
 │
 ├─ pick/
 │   ├─ fbo
 │   ├─ face
 │   ├─ point
 │   └─ ray
 │
 ├─ shdr/
 │   ├─ model
 │   ├─ plate
 │   ├─ pick
 │   └─ shadow
 │
 ├─ geom/
 │   ├─ raytri
 │   └─ xform
 │
 └─ supp/
     └─ viewer integration

실제 언어에 따라 확장자는 달라져도 역할은 유지한다.

27. 필수 API

Camera

setViewport(w, h)
resetHome()
setView(axis)
setPerspective(bool)
orbit(dx, dy)
pan(dx, dy)
zoom(mouseX, mouseY, wheelDelta, fineMode)
setOrbitCenter(worldPoint)
viewMatrix()
projectionMatrix()
screenRay(x, y)

Mesh

load(path)
worldAABB()
face(faceId)
worldFace(faceId, transform)
buildBVH()

Picker

pickModelFace(x, y)
pickSupportPoint(x, y)
raycastFace(modelId, faceId, ray)
boxSelect(rect)

Renderer

uploadModel(model)
updateTransform(modelId)
updateSupport(supportData)
setClipRange(zMin, zMax)
setOverhangAngle(angle)
render()
renderPicking()

28. 구현 순서

Phase 1 — 최소 3D Viewer

완료 조건:

STL 읽기

Triangle 표시

Build Plate 표시

Depth Test 정상

모델 Transform 정상

Phase 2 — Camera

완료 조건:

Home Camera

Right Drag Orbit

Wheel Zoom

Perspective/Orthographic 전환

Front/Back/Left/Right/Top/Bottom

Phase 3 — Picking

완료 조건:

클릭한 Model 식별

정확한 Face ID

Screen Ray 계산

정확한 World Hit Point

Normal 반환

Phase 4 — Support Editor 기반

완료 조건:

클릭 위치에 Support Tip 표시

Support Point 선택

Support Point 삭제/이동

Support Render

Phase 5 — DLP용 표시 기능

완료 조건:

Overhang Highlight

Build Volume 초과 Red

Plate Contact Green

Z Clip

Cut Plane

Shadow

Grid

Phase 6 — 성능

완료 조건:

큰 STL에서도 Camera 조작 시 GPU Buffer 재업로드 없음

Picking은 필요할 때만

BVH 구축

Background Mesh preprocessing

Render thread blocking 최소화

29. Acceptance Test

다른 AI는 아래 테스트를 통과할 때까지 완료라고 판단하지 않는다.

Camera

Home 시 (-70, 0, 15) 계열 시점이 나타남

Right Drag 세로 이동 → X rotation

Right Drag 가로 이동 → Z rotation

Perspective FOV 45°

Near 1 / Far 6000

Orthographic 전환 시 모델이 갑자기 사라지지 않음

Zoom

Cursor가 모델의 특정 점 위에 있을 때 Wheel 확대

확대 후 그 점이 화면에서 크게 벗어나지 않음

Ctrl Zoom은 일반 Zoom보다 훨씬 미세함

Picking

Cube STL을 사용한다.

12 Triangle 모두 서로 다른 Face ID로 선택 가능

Back Face가 Depth Test를 무시하고 선택되는 현상이 없어야 함

Z Clip으로 숨긴 Face는 선택되면 안 됨

화면 모서리에서도 World Hit 오차가 작아야 함

Overhang

45° threshold 테스트 모델:

상향면은 기본색

위험한 하향면은 Red

Angle 변경 시 강조 범위도 즉시 변함

Auto Support detector와 Viewer 결과가 같은 threshold utility를 사용함

Build Volume

모델을 Plate 밖으로 옮기면 해당 부분이 경고색

완전히 내부로 들어오면 정상색

Support

Model Face 클릭 → 정확한 Contact Point

Tip 선택 → 다른 Support와 구분 가능

모델을 회전/이동해도 Tip 위치가 올바르게 유지됨

30. 성능 원칙

Camera 이동 때문에 VBO를 재생성하지 않는다.

Model Transform은 Matrix Uniform으로 처리한다.

Overhang 색은 가능하면 Shader에서 계산한다.

Clip은 시각화 단계에서는 Fragment discard를 사용한다.

CPU 계산용 Mesh와 GPU Render Buffer를 분리한다.

Picking FBO는 항상 전체 해상도로 매 프레임 렌더할 필요 없다.

대형 Mesh는 BVH 또는 공간 Index를 반드시 구축한다.

Support Geometry 변경 시 Support Buffer만 dirty 처리한다.

UI thread에서 대형 STL parsing을 하지 않는다.

31. 현재 미확정 항목

다음은 구현을 막는 요소는 아니지만 CHITUBOX V1.9.4와 1:1로 비교하려면 추가 분석 가능하다.

Left/Middle mouse의 전체 Camera 조작 mapping

모든 Keyboard shortcut → Camera direction mapping

View Axis별 정확한 Euler preset

Orbit angle clamp/wrap 조건

Orbit Center를 선택하는 정확한 UI 조건

Main Viewer의 모든 light position/intensity 기본값

Transparency sorting 방식

Picking FBO의 정확한 internal format

Multi-model ID와 Face ID를 어떤 외부 구조로 결합하는지

매우 큰 Mesh를 chunking하는 정확한 기준

ModelRender와 ModelRender2의 사용 조건

하지만 위 항목을 몰라도 독립 Viewer 구현에는 문제가 없다.

32. 다른 AI에게 주는 구현 지시문

아래 지시와 이 문서 전체를 함께 제공한다.

AI 작업 명령

너는 DLP/LCD/SLA 레진 3D 프린터용 슬라이서의 3D Viewer를 구현한다.

CHITUBOX의 원본 코드를 복제하지 말고, 이 문서에 기술된 관찰된 기능과 동작만 Clean-room 방식으로 재구현한다.

우선순위는 다음과 같다.

Mesh 정확성
>
Camera 안정성
>
Picking 정확성
>
Support 편집 연동
>
시각 효과

구현 시 반드시 다음 원칙을 지킨다.

CPU topology Mesh와 GPU Render Mesh를 분리한다.

모든 계산 기능은 하나의 MeshData를 공유한다.

Camera는 rotX/rotY/rotZ, translation, orbitCenter, projection mode를 독립 상태로 관리한다.

기본 Home Camera는 회전 (-70°, 0°, 15°), 이동 (0, -50, -370)를 시작값으로 사용한다.

Perspective는 FOV 45°, near 1, far 6000을 기본값으로 한다.

Right Drag Orbit은 기본적으로 rotX += dy*0.5, rotZ += dx*0.5 동작을 구현한다.

Wheel Zoom은 화면 중앙 고정 Zoom이 아니라 cursor-anchored Zoom으로 구현한다.

Face Picking은 GPU ID Buffer를 사용한다. OpenGL 3.3+에서는 R32UI를 우선 권장하고 RGBA8은 fallback으로 사용한다.

Picking으로 얻은 Face ID와 CPU Ray-Triangle Intersection을 결합하여 정확한 worldPos, normal, barycentric coordinate를 반환한다.

Manual Support, Hole, Measurement는 동일한 PickHit API를 공유한다.

Overhang 표시와 Auto Support Overhang 판정은 반드시 동일한 angle→normal threshold 함수를 공유한다.

Build Volume 경고, Z Clip, Grid, Shadow는 GPU Shader 중심으로 처리한다.

Camera 조작 시 Mesh GPU Buffer를 재업로드하지 않는다.

기능을 한 번에 모두 만들지 말고 Phase 1~6 순서로 구현하고 각 Phase의 Acceptance Test를 통과시킨다.

각 구현 단계마다 다음을 출력한다.

변경 파일

각 파일의 책임

핵심 알고리즘

테스트 방법

현재 미구현 항목

다음 단계

코드를 작성하기 전 현재 프로젝트의 Renderer, Mesh, Camera 구조를 먼저 분석하고, 기존 구조와 충돌하지 않는 최소 변경안을 제시한다.

33. 최종 Viewer 데이터 흐름

             FILE
              │
              ▼
          MeshLoader
              │
              ▼
           MeshData
        ┌─────┼───────────┐
        │     │           │
        │     │           │
        ▼     ▼           ▼
      BVH   Renderer   Support Algo
        │     │           │
        │     ▼           │
        │   GPU Mesh      │
        │     │           │
        │     ▼           │
        │   Viewer        │
        │     │           │
        │     ▼           │
Mouse ──┼─► Picking FBO   │
        │     │           │
        │     ▼           │
        │   Face ID       │
        │     │           │
        └────►Raycast     │
              │           │
              ▼           │
           PickHit        │
              │           │
              ├──────────►Manual Support
              ├──────────►Hole
              ├──────────►Measure
              └──────────►Selection

이 구조를 Viewer와 Support 시스템의 공통 기반으로 사용한다.