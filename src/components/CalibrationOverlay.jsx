import React from 'react';
import { Circle, Line as KonvaLine, Label, Tag, Text, Group } from 'react-konva';

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6'];
const CORNER_LABELS = ['1', '2', '3', '4'];
const N = 8;        // grid subdivisions across the board
const EXT = 4;     // how many board-lengths to extend beyond edges

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Line through p1→p2 intersected with line through p3→p4
const lineIntersect = (p1, p2, p3, p4) => {
    const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    if (Math.abs(d) < 1e-10) return null;
    const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d;
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
};

// Extend a line segment from 'anchor' through 'through' by factor
const extend = (anchor, through, factor) => ({
    x: anchor.x + (through.x - anchor.x) * factor,
    y: anchor.y + (through.y - anchor.y) * factor,
});

const CalibrationOverlay = ({ calibPoints, verticalPoints, stageScale, isCalibrating, isVerticalMode, onPointDrag, showGrid = true }) => {
    const invScale = 1 / stageScale;
    if (!calibPoints || calibPoints.length === 0) return null;

    const pts = calibPoints;
    const flatPoints = pts.flatMap(p => [p.x, p.y]);
    const closedPoints = pts.length === 4 ? [...flatPoints, pts[0].x, pts[0].y] : flatPoints;

    // ---- Compute vanishing points ----
    let vpH = null, vpV = null, vpZ = null;
    const horizontalLines = [];
    const verticalLines = [];
    const zLines = [];

    if (pts.length === 4 && showGrid) {
        const [tl, tr, br, bl] = pts;
        vpH = lineIntersect(tl, tr, bl, br); // top & bottom → horizontal VP
        vpV = lineIntersect(tl, bl, tr, br); // left & right  → depth VP

        // VP3 from vertical edge (if provided)
        if (verticalPoints && verticalPoints.length === 2) {
            const [vb, vt] = verticalPoints;
            // VP3 is the point at infinity along the vertical edge direction
            // We extend far in both directions
            vpZ = extend(vb, vt, 1000);
        }

        // ---- Horizontal grid lines (converge to vpH) ----
        // Interpolate along left/right edges, extend through vpH
        for (let i = -EXT * N; i <= (1 + EXT) * N; i++) {
            const t = i / N;
            const lp = lerp(tl, bl, t); // point on left edge
            const rp = lerp(tr, br, t); // point on right edge
            const isMain = i === 0 || i === N;
            if (vpH) {
                // Lines through vpH: extend far in both directions
                const a = extend(vpH, lp, EXT * 2);
                const b = extend(vpH, rp, EXT * 2);
                horizontalLines.push({ p1: a, p2: b, isMain });
            } else {
                // Parallel fallback
                const a = extend(rp, lp, EXT * 2);
                const b = extend(lp, rp, EXT * 2);
                horizontalLines.push({ p1: a, p2: b, isMain });
            }
        }

        // ---- Depth (Y) grid lines (converge to vpV) ----
        for (let i = -EXT * N; i <= (1 + EXT) * N; i++) {
            const t = i / N;
            const tp2 = lerp(tl, tr, t);
            const bp2 = lerp(bl, br, t);
            const isMain = i === 0 || i === N;
            if (vpV) {
                const a = extend(vpV, tp2, EXT * 2);
                const b = extend(vpV, bp2, EXT * 2);
                verticalLines.push({ p1: a, p2: b, isMain });
            } else {
                const a = extend(bp2, tp2, EXT * 2);
                const b = extend(tp2, bp2, EXT * 2);
                verticalLines.push({ p1: a, p2: b, isMain });
            }
        }

        // ---- Vertical (Z) grid lines (converge to vpZ) ----
        if (vpZ) {
            // Sample grid points across horizontal lines to create vertical convergence
            for (let i = -EXT * N; i <= (1 + EXT) * N; i++) {
                const t = i / N;
                const basePoint = lerp(tl, tr, t); // across top edge as baseline
                const isMain = i === 0 || i === N;
                const a = extend(vpZ, basePoint, EXT * 3);
                const b = extend(basePoint, vpZ, EXT * 3); // downward toward VP3
                zLines.push({ p1: a, p2: b, isMain });
            }
        } else {
            // Fallback: straight vertical lines (VP3 at infinity = vertical)
            for (let i = -EXT * N; i <= (1 + EXT) * N; i++) {
                const t = i / N;
                const basePoint = lerp(tl, tr, t);
                const isMain = i === 0 || i === N;
                const h = Math.abs(tl.y - bl.y) * (1 + EXT * 2);
                zLines.push({ p1: { x: basePoint.x, y: basePoint.y - h }, p2: { x: basePoint.x, y: basePoint.y + h }, isMain });
            }
        }
    }

    const renderGridLines = (lines, color) =>
        lines.map((gl, idx) => (
            <KonvaLine key={idx}
                points={[gl.p1.x, gl.p1.y, gl.p2.x, gl.p2.y]}
                stroke={gl.isMain ? color.replace('0.18', '0.55') : color}
                strokeWidth={(gl.isMain ? 1.5 : 0.75) * invScale}
                dash={gl.isMain ? [] : [5 * invScale, 5 * invScale]}
                listening={false}
            />
        ));

    const renderVP = (vp, label, color) => vp && (
        <>
            <Circle x={vp.x} y={vp.y} radius={9 * invScale}
                fill={color.fill} stroke={color.stroke} strokeWidth={2 * invScale} listening={false} />
            <Label x={vp.x} y={vp.y} offsetX={-14 * invScale} offsetY={7 * invScale} listening={false}>
                <Tag fill={color.tag} cornerRadius={6 * invScale} />
                <Text text={label} fill="#fff" fontSize={9 * invScale} padding={3 * invScale} fontFamily="Inter" fontStyle="700" />
            </Label>
        </>
    );

    return (
        <Group listening={isCalibrating || isVerticalMode}>
            {/* Axis 1: Horizontal lines → VP1 (orange) */}
            {renderGridLines(horizontalLines, 'rgba(245,158,11,0.18)')}
            {/* Axis 2: Depth lines → VP2 (blue) */}
            {renderGridLines(verticalLines, 'rgba(59,130,246,0.18)')}
            {/* Axis 3: Vertical lines → VP3 (purple) */}
            {renderGridLines(zLines, 'rgba(168,85,247,0.18)')}

            {/* Vanishing point markers */}
            {renderVP(vpH, 'VP1', { fill: 'rgba(245,158,11,0.7)', stroke: '#f59e0b', tag: 'rgba(245,158,11,0.9)' })}
            {renderVP(vpV, 'VP2', { fill: 'rgba(59,130,246,0.7)', stroke: '#3b82f6', tag: 'rgba(59,130,246,0.9)' })}
            {renderVP(vpZ, 'VP3', { fill: 'rgba(168,85,247,0.7)', stroke: '#a855f7', tag: 'rgba(168,85,247,0.9)' })}

            {/* Board outline */}
            {pts.length >= 2 && (
                <KonvaLine points={closedPoints}
                    stroke="#10b981" strokeWidth={2.5 * invScale}
                    dash={pts.length < 4 ? [8 * invScale, 4 * invScale] : []}
                    closed={false} listening={false} />
            )}

            {/* Edge dimension labels */}
            {pts.length === 4 && (<>
                <Label x={(pts[0].x + pts[1].x) / 2} y={(pts[0].y + pts[1].y) / 2}
                    offsetX={24 * invScale} offsetY={20 * invScale} listening={false}>
                    <Tag fill="rgba(16,185,129,0.85)" cornerRadius={8 * invScale} />
                    <Text text="300" fill="#fff" fontSize={12 * invScale} padding={5 * invScale} fontFamily="Inter" fontStyle="700" />
                </Label>
                <Label x={(pts[1].x + pts[2].x) / 2} y={(pts[1].y + pts[2].y) / 2}
                    offsetX={-8 * invScale} offsetY={10 * invScale} listening={false}>
                    <Tag fill="rgba(16,185,129,0.85)" cornerRadius={8 * invScale} />
                    <Text text="400" fill="#fff" fontSize={12 * invScale} padding={5 * invScale} fontFamily="Inter" fontStyle="700" />
                </Label>
            </>)}

            {/* Vertical edge preview (for VP3 mode) */}
            {verticalPoints && verticalPoints.length >= 1 && (
                <>
                    {verticalPoints.length === 2 && (
                        <KonvaLine points={[verticalPoints[0].x, verticalPoints[0].y, verticalPoints[1].x, verticalPoints[1].y]}
                            stroke="#a855f7" strokeWidth={2.5 * invScale} dash={[6 * invScale, 3 * invScale]} listening={false} />
                    )}
                    {verticalPoints.map((p, i) => (
                        <Circle key={`vp-${i}`} x={p.x} y={p.y} radius={8 * invScale}
                            fill="#a855f7" stroke="#fff" strokeWidth={2 * invScale} listening={false} />
                    ))}
                </>
            )}

            {/* Corner markers */}
            {pts.map((p, i) => (
                <React.Fragment key={`cal-${i}`}>
                    <Circle name="handle" x={p.x} y={p.y}
                        radius={isCalibrating ? 10 * invScale : 7 * invScale}
                        fill={COLORS[i]} stroke="#fff" strokeWidth={2.5 * invScale}
                        hitStrokeWidth={25 * invScale} draggable={isCalibrating}
                        onDragMove={(e) => onPointDrag && onPointDrag(i, { x: e.target.x(), y: e.target.y() })}
                        onDragEnd={(e) => onPointDrag && onPointDrag(i, { x: e.target.x(), y: e.target.y() }, true)}
                    />
                    <Label x={p.x} y={p.y} offsetX={-12 * invScale} offsetY={18 * invScale} listening={false}>
                        <Tag fill={COLORS[i]} cornerRadius={10 * invScale} />
                        <Text text={CORNER_LABELS[i]} fill="#fff" fontSize={10 * invScale} padding={4 * invScale} fontFamily="Inter" fontStyle="700" />
                    </Label>
                </React.Fragment>
            ))}
        </Group>
    );
};

export default CalibrationOverlay;
