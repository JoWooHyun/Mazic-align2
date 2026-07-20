/**
 * G-code 생성용 순수 기하 유틸.
 * gcode-generator.ts 에서 추출 — settings 나 인스턴스 상태에 의존하지 않는
 * 폴리곤/라인 회전, 경로 길이, 경로 순서 최적화 함수만 모았다.
 * (동작·수치·순서는 원본 GCodeGenerator 메서드와 바이트 단위로 동일.)
 */
import { Point } from './types';

/** 최근접 시작점 우선으로 경로(폴리곤) 인쇄 순서를 최적화한다. */
export function optimizePaths(paths: Point[][], startPoint: Point): Point[][] {
    const optimized: Point[][] = [];
    const remaining = [...paths];
    let currentPos = startPoint;

    while (remaining.length > 0) {
        let nearestIndex = -1;
        let minDist = Infinity;

        for (let i = 0; i < remaining.length; i++) {
            const p = remaining[i][0];
            const dist = Math.hypot(p.x - currentPos.x, p.y - currentPos.y);
            if (dist < minDist) {
                minDist = dist;
                nearestIndex = i;
            }
        }

        if (nearestIndex !== -1) {
            const nextPath = remaining[nearestIndex];
            optimized.push(nextPath);
            remaining.splice(nearestIndex, 1);
            currentPos = nextPath[0]; // Or end? Closed loop ends at start.
        } else {
            break;
        }
    }
    return optimized;
}

/** 폐루프 경로의 둘레 길이(마지막→처음 변 포함)를 계산한다. */
export function calculatePathLength(path: Point[]): number {
    let len = 0;
    for (let i = 0; i < path.length; i++) {
        const p1 = path[i];
        const p2 = path[(i + 1) % path.length];
        len += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }
    return len;
}

/** 폴리곤 집합을 원점 기준 angle(도)만큼 회전한다. */
export function rotatePolygons(polys: Point[][], angle: number): Point[][] {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return polys.map(poly => poly.map(p => ({
        x: p.x * cos - p.y * sin,
        y: p.x * sin + p.y * cos
    })));
}

/** 라인 집합(양 끝점 쌍)을 원점 기준 angle(도)만큼 회전한다. */
export function rotateLines(lines: [Point, Point][], angle: number): [Point, Point][] {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return lines.map(line => [
        { x: line[0].x * cos - line[0].y * sin, y: line[0].x * sin + line[0].y * cos },
        { x: line[1].x * cos - line[1].y * sin, y: line[1].x * sin + line[1].y * cos }
    ]);
}
