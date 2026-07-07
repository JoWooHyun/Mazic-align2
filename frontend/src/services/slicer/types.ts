
export interface SliceSettings {
    // Common
    layerHeight: number;      // mm
    buildWidth: number;       // mm
    buildDepth: number;       // mm
    buildHeight: number;      // mm

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

    // DLP - Display
    resolutionX: number;      // pixels (default 3840)
    resolutionY: number;      // pixels (default 2400)
    pixelSize: number;        // microns (auto-calculated)

    // DLP - Exposure
    lightPower: number;       // % (default 80)
    exposureTime: number;     // seconds, normal layers (default 2.5)
    bottomExposureTime: number; // seconds, bottom layers (default 30)
    bottomLayerCount: number;   // count (default 6)
    transitionLayerCount: number; // count, gradual transition (default 6)
    lightOffDelay: number;      // seconds, delay after exposure (default 1.0)

    // DLP - Z Movement
    liftDistance: number;     // mm (default 6.0)
    liftSpeed: number;        // mm/s, ascend speed (default 3.0)
    zLiftSpeed: number;       // mm/s (legacy, kept for compat)
    dlpRetractSpeed: number;  // mm/s, descend speed (default 3.0)
}

export interface Point {
    x: number;
    y: number;
}

export interface LayerData {
    index: number;
    z: number;
    polygons: Point[][];      // Contours of the slice
    gcode: string;            // FDM commands for this layer
    paths?: GCodePath;        // Structured path data for visualization
    imageData: string;        // Data URL for DLP mask (or Blob)
    exposureTime: number;     // Actual exposure time for this layer (seconds)
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

export interface SlicerProgress {
    progress: number; // 0 to 100
    currentLayer: number;
    totalLayers: number;
    message: string;
}

export interface SliceMetadata {
    totalLayers: number;
    layerHeight: number;
    buildWidth: number;
    buildDepth: number;
    buildHeight: number;
    resolutionX: number;
    resolutionY: number;
    exposureTime: number;
    bottomExposureTime: number;
    bottomLayerCount: number;
    estimatedTime: number;      // seconds
}

export interface SlicerResult {
    layers: LayerData[];
    fullGcode: string;
    metadata: SliceMetadata;
}

// Worker Messages
export type SlicerWorkerMessage =
    | { type: 'SLICE', payload: { meshData: Float32Array, settings: SliceSettings } }
    | { type: 'CANCEL' };

export type SlicerWorkerResponse =
    | { type: 'PROGRESS', payload: SlicerProgress }
    | { type: 'COMPLETE', payload: SlicerResult }
    | { type: 'ERROR', payload: string };
