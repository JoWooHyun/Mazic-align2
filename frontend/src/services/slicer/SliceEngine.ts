import { Point, LayerData, SliceSettings } from './types';

/**
 * Core slicing engine.
 * Intersects a 3D mesh with Z-planes to generate 2D contours.
 * Implements robust slicing with epsilon perturbation and quantized connectivity.
 */
export class SliceEngine {
    private positions: Float32Array;
    private settings: SliceSettings;

    // Precision settings
    private readonly EPSILON = 1e-5; // For Z-perturbation
    private readonly QUANTIZE_SCALE = 1000; // 1 micron precision (if units are mm)

    constructor(positions: Float32Array, settings: SliceSettings) {
        this.positions = positions;
        this.settings = settings;
    }

    public slice(): LayerData[] {
        const layers: LayerData[] = [];
        const { layerHeight } = this.settings;

        // 1. Calculate Bounds
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let i = 2; i < this.positions.length; i += 3) {
            const z = this.positions[i];
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }

        // 첫 층은 최저면(minZ)에서 시작한다 — 과거 startZ = minZ + layerHeight 로 되돌아가
        // 첫 층 단면이 통째로 누락(서포트가 첫 층에 안 잡히는 회귀)된 사고가 두 번 있었음.
        // 정본: f7208ed. v2 이식(features/v2/utils/gcode/fdm-gcode.ts)도 이 공식 기준.
        const startZ = minZ;
        const totalLayers = Math.ceil((maxZ - minZ) / layerHeight) + 1;

        console.log(`[SliceEngine] Slicing from Z=${minZ} to ${maxZ}, layers=${totalLayers}`);

        // 2. Iterate Layers
        for (let i = 0; i < totalLayers; i++) {
            // Perturb Z to avoid coplanar triangles
            const z = startZ + i * layerHeight;
            const sliceZ = z + this.EPSILON;

            if (sliceZ > maxZ) break;

            const segments = this.getLayerSegments(sliceZ);
            const polygons = this.connectSegments(segments);

            layers.push({
                index: i,
                z: z, // Store nominal Z
                polygons: polygons,
                gcode: '', // To be filled by GCodeGenerator
                imageData: '', // To be filled by ImageGenerator
                exposureTime: 0, // To be filled by SlicerWorker
            });
        }

        return layers;
    }

    /**
     * Find all intersection segments of triangles with the Z plane.
     */
    private getLayerSegments(z: number): [Point, Point][] {
        const segments: [Point, Point][] = [];
        const p = this.positions;

        for (let i = 0; i < p.length; i += 9) {
            // Triangle vertices
            const v1 = { x: p[i], y: p[i + 1], z: p[i + 2] };
            const v2 = { x: p[i + 3], y: p[i + 4], z: p[i + 5] };
            const v3 = { x: p[i + 6], y: p[i + 7], z: p[i + 8] };

            // Check if triangle intersects Z plane
            // Simple check: not all above or all below
            const above = (v1.z >= z ? 1 : 0) + (v2.z >= z ? 1 : 0) + (v3.z >= z ? 1 : 0);

            if (above === 0 || above === 3) continue;

            // Calculate intersection points
            const points: Point[] = [];

            if ((v1.z < z && v2.z >= z) || (v1.z >= z && v2.z < z)) {
                points.push(this.intersect(v1, v2, z));
            }
            if ((v2.z < z && v3.z >= z) || (v2.z >= z && v3.z < z)) {
                points.push(this.intersect(v2, v3, z));
            }
            if ((v3.z < z && v1.z >= z) || (v3.z >= z && v1.z < z)) {
                points.push(this.intersect(v3, v1, z));
            }

            if (points.length === 2) {
                // Quantize points to ensure connectivity
                const p1 = this.quantize(points[0]);
                const p2 = this.quantize(points[1]);

                // Filter zero-length segments
                if (p1.x !== p2.x || p1.y !== p2.y) {
                    segments.push([p1, p2]);
                }
            }
        }

        return segments;
    }

    private intersect(p1: { x: number, y: number, z: number }, p2: { x: number, y: number, z: number }, z: number): Point {
        const t = (z - p1.z) / (p2.z - p1.z);
        return {
            x: p1.x + t * (p2.x - p1.x),
            y: p1.y + t * (p2.y - p1.y)
        };
    }

    private quantize(p: Point): Point {
        return {
            x: Math.round(p.x * this.QUANTIZE_SCALE) / this.QUANTIZE_SCALE,
            y: Math.round(p.y * this.QUANTIZE_SCALE) / this.QUANTIZE_SCALE
        };
    }

    private getPointKey(p: Point): string {
        // Using integer keys for map lookup avoids floating point issues
        const ix = Math.round(p.x * this.QUANTIZE_SCALE);
        const iy = Math.round(p.y * this.QUANTIZE_SCALE);
        return `${ix},${iy}`;
    }

    /**
     * Connect unsorted segments into closed polygons using an adjacency graph.
     * O(N) complexity (average).
     */
    private connectSegments(segments: [Point, Point][]): Point[][] {
        const polygons: Point[][] = [];
        const adjacency = new Map<string, Point[]>();

        // 1. Build Adjacency Graph
        for (const [p1, p2] of segments) {
            const k1 = this.getPointKey(p1);
            const k2 = this.getPointKey(p2);

            if (!adjacency.has(k1)) adjacency.set(k1, []);
            if (!adjacency.has(k2)) adjacency.set(k2, []);

            // Add connections (undirected for robustness)
            adjacency.get(k1)!.push(p2);
            adjacency.get(k2)!.push(p1);
        }

        // 2. Traverse Graph to find loops
        for (const startKey of adjacency.keys()) {
            if (adjacency.get(startKey)!.length === 0) continue;

            const poly: Point[] = [];

            // Start traversing
            const startPoint = this.parseKey(startKey);
            poly.push(startPoint);

            let currK = startKey;

            while (true) {
                const nList = adjacency.get(currK);
                if (!nList || nList.length === 0) {
                    // Dead end
                    break;
                }

                // Pick a neighbor
                const next = nList.pop()!;
                const nextK = this.getPointKey(next);

                // Remove the reverse connection (curr from next's list)
                const nextList = adjacency.get(nextK);
                if (nextList) {
                    const idx = nextList.findIndex(p => this.getPointKey(p) === currK);
                    if (idx !== -1) {
                        nextList.splice(idx, 1);
                    }
                }

                // Add to poly
                poly.push(next);

                // Move
                currK = nextK;

                // Check if closed
                if (currK === startKey) {
                    break;
                }
            }

            // Filter small polygons (noise)
            if (poly.length > 2) {
                // Optional: Check area
                polygons.push(poly);
            }
        }

        return polygons;
    }

    private parseKey(key: string): Point {
        const [x, y] = key.split(',').map(Number);
        return {
            x: x / this.QUANTIZE_SCALE,
            y: y / this.QUANTIZE_SCALE
        };
    }
}
