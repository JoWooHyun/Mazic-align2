/**
 * 스캔라인(rectilinear) 인필 생성 유틸.
 * gcode-generator.ts 의 generateGlobalInfill 로직을 추출 — 폴리곤을
 * angle 만큼 회전해 Y 축 스캔라인과 교차시켜 채움 라인을 만든 뒤 되돌린다.
 * (동작·수치·순서는 원본과 바이트 단위로 동일.)
 */
import { Point } from './types';
import { rotatePolygons, rotateLines } from './gcode-geometry';

/**
 * 폴리곤 영역을 채우는 인필 라인(양 끝점 쌍)을 생성한다.
 * @param polys      인필 대상 폴리곤 집합
 * @param percentage 인필 밀도(0-100) — 스캔라인 간격 계산에 사용
 * @param nozzle     노즐 지름(mm)
 * @param angle      스캔라인 회전각(도, 기본 0)
 */
export function generateGlobalInfill(
    polys: Point[][],
    percentage: number,
    nozzle: number,
    angle: number = 0,
): [Point, Point][] {
    // Rotate polygons to align with scanlines (Y-axis)
    const rotatedPolys = rotatePolygons(polys, -angle);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const poly of rotatedPolys) {
        for (const p of poly) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
    }

    if (minX === Infinity) return [];

    // Clip bounds to avoid infinite loops or massive generation
    if (maxX - minX > 1000 || maxY - minY > 1000) {
        return [];
    }

    const lines: [Point, Point][] = [];
    const spacing = nozzle * (100 / percentage);

    // Scanline generation
    // We generate infinite lines and then CLIP them against the polygons using Clipper Intersection?
    // Or use the ray-casting method?
    // Clipper Intersection is robust.
    // Let's generate a "Grid" of lines as a polygon set (thin rectangles?)
    // Or just use the ray-casting method since we have rotated polys.
    // Ray-casting is fast enough for scanlines.

    let scanIndex = 0;
    for (let y = minY; y <= maxY; y += spacing) {
        const scanY = y + 0.0001;
        let intersections: number[] = [];

        for (const poly of rotatedPolys) {
            for (let i = 0; i < poly.length; i++) {
                const p1 = poly[i];
                const p2 = poly[(i + 1) % poly.length];

                if ((p1.y <= scanY && p2.y > scanY) || (p2.y <= scanY && p1.y > scanY)) {
                    const x = p1.x + (scanY - p1.y) * (p2.x - p1.x) / (p2.y - p1.y);
                    intersections.push(x);
                }
            }
        }

        intersections.sort((a, b) => a - b);

        const currentLines: [Point, Point][] = [];
        for (let i = 0; i < intersections.length; i += 2) {
            if (i + 1 < intersections.length) {
                let x1 = intersections[i];
                let x2 = intersections[i + 1];
                currentLines.push([{ x: x1, y: y }, { x: x2, y: y }]);
            }
        }

        // ZigZag Reversal
        if (scanIndex % 2 !== 0) {
            currentLines.reverse();
            for (const line of currentLines) {
                const temp = line[0];
                line[0] = line[1];
                line[1] = temp;
            }
        }

        lines.push(...currentLines);
        scanIndex++;
    }

    // Rotate lines back
    return rotateLines(lines, angle);
}
