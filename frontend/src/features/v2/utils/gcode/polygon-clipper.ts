/**
 * v1 PolygonClipper (frontend/src/services/slicer/PolygonClipper.ts) 이식.
 * gcode-generator.ts 가 벽/인필/갭필 계산에 사용하는 offset/union 연산.
 * js-clipper 는 frontend/package.json 에 이미 존재하는 의존성 (v1 부터 사용 중).
 */
import * as ClipperLib from 'js-clipper';
import { Point } from './types';

export class PolygonClipper {
    private static readonly SCALE = 10000; // Clipper uses integers

    /**
     * Offsets polygons by a given delta.
     * Handles positive (outwards) and negative (inwards) offsets.
     * Automatically handles merging and splitting of polygons.
     */
    public static offset(polygons: Point[][], delta: number): Point[][] {
        const scale = this.SCALE;
        const cpr = new ClipperLib.ClipperOffset();

        const paths = this.toClipperPaths(polygons);

        // JoinType: 0=Square, 1=Round, 2=Miter
        // EndType: 0=ClosedPolygon, 1=ClosedLine, 2=OpenSquare, 3=OpenRound
        cpr.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);

        const solution = new ClipperLib.Paths();
        cpr.Execute(solution, delta * scale);

        return this.fromClipperPaths(solution);
    }

    /**
     * Computes the Union of all polygons.
     * Useful for cleaning up self-intersecting or overlapping input.
     */
    public static union(polygons: Point[][]): Point[][] {
        return this.executeBooleanOp(ClipperLib.ClipType.ctUnion, polygons, []);
    }

    /**
     * Computes the Difference (Subject - Clip).
     */
    public static difference(subject: Point[][], clip: Point[][]): Point[][] {
        return this.executeBooleanOp(ClipperLib.ClipType.ctDifference, subject, clip);
    }

    /**
     * Computes the Intersection.
     */
    public static intersection(subject: Point[][], clip: Point[][]): Point[][] {
        return this.executeBooleanOp(ClipperLib.ClipType.ctIntersection, subject, clip);
    }

    private static executeBooleanOp(opType: number, subject: Point[][], clip: Point[][]): Point[][] {
        const cpr = new ClipperLib.Clipper();

        const subjPaths = this.toClipperPaths(subject);
        const clipPaths = this.toClipperPaths(clip);

        cpr.AddPaths(subjPaths, ClipperLib.PolyType.ptSubject, true);
        cpr.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);

        const solution = new ClipperLib.Paths();
        // PolyFillType: 0=EvenOdd, 1=NonZero, 2=Positive, 3=Negative
        // Use EvenOdd to correctly handle holes even if winding order is inconsistent
        cpr.Execute(opType, solution, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);

        return this.fromClipperPaths(solution);
    }

    private static toClipperPaths(polygons: Point[][]): any[] {
        const scale = this.SCALE;
        return polygons.map(poly =>
            poly.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }))
        );
    }

    private static fromClipperPaths(paths: any[]): Point[][] {
        const scale = this.SCALE;
        return paths.map(path =>
            path.map((p: any) => ({ x: p.X / scale, y: p.Y / scale }))
        );
    }
}
