/**
 * v2 슬라이스 결과(월드 좌표 polygon)를 GCodeGenerator 입력으로 변환.
 *
 * 좌표 매핑:
 *   Babylon 은 Y-up. slice-section.ts 의 sliceMeshAtY(mesh, y) 는 world
 *   (X, Z) 평면 좌표를, y(높이) 는 별도 인자로 받는다.
 *     Babylon (X, Z) → G-code (X, Y)
 *     Babylon Y (높이) → G-code Z
 *
 *   플레이트 원점 규약은 slice-rasterize.ts 의 RasterOpts 주석을 그대로
 *   따른다: "빌드플레이트는 (0,0) 중심" — world 좌표 X ∈ [-W/2, W/2],
 *   Z ∈ [-D/2, D/2]. G-code 는 관례상 플레이트 코너 (0,0) ~
 *   (buildWidth, buildDepth) 좌표계이므로, world → G-code 변환 시
 *   X' = X + buildWidth/2, Y' = Z + buildDepth/2 로 오프셋한다.
 *   (slice-rasterize.ts 의 pixel_x = (X + W/2)/W 와 동일한 X 오프셋.
 *    G-code 의 Y 축은 Z+ 가 커질수록 커지는 방향으로 두어, 래스터의
 *    "pixel_y 는 Z+ 가 위(값 작음)"인 이미지 좌표계와는 달리 일반적인
 *    데카르트 좌표계를 유지한다 — G-code 뷰어들은 Y+ 를 화면 위로
 *    그리므로 코너 원점 + Y+ 정방향이 표준적이라는 판단이다. 래스터
 *    마스크는 픽셀 좌표라 Z 플립, G-code 는 데카르트라 무플립 — 실기
 *    검증 필요.)
 *
 * 레이어 Z 오프셋 (v1 SliceEngine 정정 이식 — 감사 A1):
 *   이전 v2 는 z(i) = minZ + (i+1)*layerHeight 로 첫 층(Z=minZ ~
 *   minZ+layerHeight)을 통째로 건너뛰었다. 이는 v1 이 이미 커밋 f7208ed
 *   에서 고친 "첫 레이어 누락" 버그의 재도입이었다(주석의 v1 인용도 반대로
 *   되어 있었다). v1 SliceEngine.slice() 의 실제(수정된) 공식은:
 *     startZ = minZ,  z(i) = startZ + i*layerHeight  (i = 0-based)
 *     sliceZ = z + EPSILON            // 공면 삼각형 회피용 미세 섭동
 *     totalLayers = ceil((maxZ - minZ) / layerHeight) + 1
 *   즉 i=0 은 최저면 바로 위(z = minZ)에서 샘플링되어 첫 출력 층에 모델·
 *   서포트 foot 단면이 그대로 포함된다.
 *
 *   v2 는 호출 측(BabylonScene.tsx 의 exportFdmGcode)이 대상 mesh 들의
 *   실제 world bounding 최저 Y 를 range.yMin 으로(= v1 의 minZ) 넘기므로
 *   그 자리에 그대로 대입해 동일 공식을 적용한다:
 *     z(i) = range.yMin + i * layerHeight          // G-code 층 Z(공칭)
 *     sampleY = z + EPSILON                          // 실제 슬라이스 평면
 *
 *   ※ 이 수정으로 G-code 산출물이 의도적으로 달라진다(첫 층 추가 + 전체
 *      레이어 Z 가 layerHeight 만큼 하향). 회귀가 아니라 v1 과의 정합을
 *      회복하는 의도적 변경이다.
 *   ※ DLP/CTB 경로((i + 0.5) 중앙 샘플링)는 별개 규약이므로 여기서 건드리지
 *      않는다.
 */
import type { Mesh } from '@babylonjs/core';
import { sliceMeshAtY, chainSegments } from '../slice-section';
import { GCodeGenerator } from './gcode-generator';
import { FdmSettings, Point } from './types';

/** 공면 삼각형 회피용 Z 섭동 (v1 SliceEngine 의 EPSILON = 1e-5 와 동일). */
const SLICE_EPSILON = 1e-5;

export interface FdmSliceRange {
    /** 슬라이스 시작 높이 (mm). 대상 mesh 들의 world bounding 최저 Y. */
    yMin: number;
    /** 슬라이스 종료 높이 (mm). 대상 mesh 들의 world bounding 최고 Y. */
    yMax: number;
}

/** world (X, Z) 좌표 polygon 들을 G-code 좌표계 Point[][] 로 변환 (코너 원점 오프셋). */
function toGcodePolygons(
    worldPolys: { points: [number, number][] }[],
    buildWidth: number,
    buildDepth: number,
): Point[][] {
    const halfW = buildWidth / 2;
    const halfD = buildDepth / 2;
    return worldPolys.map(poly =>
        poly.points.map(([x, z]) => ({ x: x + halfW, y: z + halfD }))
    );
}

/**
 * 여러 mesh 를 한 레이어 높이 y 에서 슬라이스하고, 세그먼트를 합쳐 하나의
 * polygon 집합으로 체이닝한다 (여러 모델이 같은 레이어에 함께 존재하는
 * 경우를 대비).
 */
function sliceLayerPolygons(meshes: Mesh[], y: number): { points: [number, number][] }[] {
    const segs = meshes.flatMap(mesh => sliceMeshAtY(mesh, y));
    return chainSegments(segs);
}

/**
 * FDM G-code 전체를 생성한다.
 * header + (레이어별 preamble+layer) + footer 순으로 조립.
 */
export function generateFdmGcode(
    meshes: Mesh[],
    settings: FdmSettings,
    range: FdmSliceRange,
): string {
    const generator = new GCodeGenerator(settings);
    const { layerHeight } = settings;

    // v1 SliceEngine 과 동일: ceil(높이/lh) + 1 (첫 층 포함).
    const totalLayers = Math.ceil((range.yMax - range.yMin) / layerHeight) + 1;

    let fullGcode = generator.generateHeader();

    for (let i = 0; i < totalLayers; i++) {
        // v1 SliceEngine 정정 공식(감사 A1): z(i) = base + i*layerHeight.
        // i=0 이 최저면(z = yMin) → 첫 층이 누락되지 않는다.
        const z = range.yMin + i * layerHeight;
        // 실제 슬라이스 평면은 공면 삼각형 회피를 위해 EPSILON 만큼 섭동한다
        // (v1 의 sliceZ = z + EPSILON). 층 Z 좌표는 공칭 z 를 그대로 쓴다.
        const sampleY = z + SLICE_EPSILON;
        if (sampleY > range.yMax) break;

        const worldPolys = sliceLayerPolygons(meshes, sampleY);
        const gcodePolys = toGcodePolygons(worldPolys, settings.buildWidth, settings.buildDepth);

        const { gcode } = generator.generateLayer(gcodePolys, z, i);
        fullGcode += gcode;
    }

    fullGcode += generator.generateFooter();

    return fullGcode;
}
