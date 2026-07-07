/**
 * v1 (frontend/src/services/slicer/types.ts) 의 FDM G-code 관련 타입만 이식.
 * DLP(노광/해상도) 필드는 v2 FDM 파이프라인에 불필요하므로 제외.
 */

export interface Point {
    x: number;
    y: number;
}

export interface PathSegment {
    x: number;
    y: number;
    type: 'move' | 'extrude' | 'retract';
    extrusion?: number; // E value
}

export interface GCodePath {
    segments: PathSegment[];
    totalExtrusion: number;
}

/**
 * v1 SliceSettings 에서 GCodeGenerator 가 실제로 소비하는 FDM 필드만 추출.
 * buildWidth/buildDepth 는 슬라이스 좌표 변환(어댑터)에서 별도로 쓰이므로 포함.
 */
export interface FdmSettings {
    // Common
    layerHeight: number;      // mm
    buildWidth: number;       // mm
    buildDepth: number;       // mm

    // FDM (Material)
    fdmSpeed: number;         // mm/s (XY Speed)
    fdmExtrusionRate: number; // mm/s (Extruder Speed)
    nozzleDiameter: number;   // mm
    wallCount: number;        // Count
    infillPercentage: number; // 0-100
    infillPattern: 'lines' | 'grid' | 'zigzag';
    infillOverlapPercentage: number;
    wallOverlapPercentage: number;
    outerWallOverlapPercentage: number;
    wallPrintOrder: 'inner-to-outer' | 'outer-to-inner';
    printOrder: 'walls-first' | 'infill-first';
    enableGapFilling: boolean;

    // FDM - Temperature
    nozzleTemp: number;              // degrees C (default 200)
    bedTemp: number;                 // degrees C (default 60)

    // FDM - Retraction
    enableRetraction: boolean;       // default true
    retractLength: number;           // mm (default 5.0)
    retractSpeed: number;            // mm/s (default 40)
    retractZHop: number;             // mm (default 0.2)
    retractMinTravelDistance: number; // mm, threshold (default 1.0)

    // FDM - Fan Control
    fanSpeed: number;                // 0-100% (default 100)
    fanDisableLayerCount: number;    // first N layers without fan (default 2)
}

/** v1 SlicerPanel.tsx 의 초기 state 값과 동일 (frontend/src/components/Slicer/SlicerPanel.tsx). */
export const DEFAULT_FDM_SETTINGS: FdmSettings = {
    // Common
    layerHeight: 0.05,
    buildWidth: 192,
    buildDepth: 120,

    // FDM
    fdmSpeed: 60,
    fdmExtrusionRate: 1.0,
    nozzleDiameter: 0.4,
    wallCount: 2,
    infillPercentage: 100,
    infillPattern: 'lines',
    infillOverlapPercentage: 15,
    wallOverlapPercentage: 0,
    outerWallOverlapPercentage: 0,
    wallPrintOrder: 'inner-to-outer',
    printOrder: 'walls-first',
    enableGapFilling: true,

    // FDM - Temperature
    nozzleTemp: 200,
    bedTemp: 60,

    // FDM - Retraction
    enableRetraction: true,
    retractLength: 5.0,
    retractSpeed: 40,
    retractZHop: 0.2,
    retractMinTravelDistance: 1.0,

    // FDM - Fan
    fanSpeed: 100,
    fanDisableLayerCount: 2,
};
