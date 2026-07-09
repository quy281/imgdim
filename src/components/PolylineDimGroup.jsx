import React from 'react';
import { Arrow, Label, Tag, Text, Group, Circle, Line as KonvaLine } from 'react-konva';

const PolylineDimGroup = ({ polyline, stageScale, isSelected, onSelect, onLabelEdit, onChange }) => {
    const invScale = 1 / stageScale;
    const pts = polyline.points;

    const handlePointDrag = (idx, e, commit = false) => {
        const x = e.target.x();
        const y = e.target.y();
        const newPoints = pts.map((p, i) => i === idx ? { x, y } : { ...p });
        // Enforce perpendicularity on neighbors
        if (idx > 0) {
            const prev = newPoints[idx - 1];
            const segBefore = idx >= 2 ? { dx: pts[idx - 1].x - pts[idx - 2].x, dy: pts[idx - 1].y - pts[idx - 2].y } : null;
            if (segBefore) {
                const isHoriz = Math.abs(segBefore.dx) > Math.abs(segBefore.dy);
                // Segment before was horizontal, so segment [idx-1 -> idx] must be vertical
                if (isHoriz) newPoints[idx] = { x: prev.x, y };
                else newPoints[idx] = { x, y: prev.y };
            }
        }
        if (idx < pts.length - 1) {
            const next = newPoints[idx + 1];
            const curSeg = { dx: newPoints[idx].x - (idx > 0 ? newPoints[idx - 1].x : newPoints[idx].x), dy: newPoints[idx].y - (idx > 0 ? newPoints[idx - 1].y : newPoints[idx].y) };
            if (idx > 0) {
                const isHoriz = Math.abs(curSeg.dx) > Math.abs(curSeg.dy);
                // Current segment is horizontal, so next segment must be vertical
                if (isHoriz) newPoints[idx + 1] = { x: newPoints[idx].x, y: next.y };
                else newPoints[idx + 1] = { x: next.x, y: newPoints[idx].y };
            }
        }
        const updated = { ...polyline, points: newPoints };
        // Recalculate labels
        updated.labels = newPoints.slice(0, -1).map((p, i) => {
            const np = newPoints[i + 1];
            const dx = np.x - p.x; const dy = np.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (polyline.ratio) {
                let rv = dist * polyline.ratio;
                rv = Math.round(rv / 10) * 10;
                return rv.toString();
            }
            return Math.round(dist).toString();
        });
        onChange(updated, commit);
    };

    const handleGroupDrag = (e) => {
        const dx = e.target.x(); const dy = e.target.y();
        const newPoints = pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
        onChange({ ...polyline, points: newPoints }, true);
        e.target.x(0); e.target.y(0);
    };

    const segments = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i]; const p2 = pts[i + 1];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const label = polyline.labels[i] || '';
        const color = isSelected ? '#10b981' : '#f59e0b';

        segments.push(
            <React.Fragment key={`seg-${i}`}>
                <Arrow
                    points={[p1.x, p1.y, p2.x, p2.y]}
                    stroke={color} strokeWidth={1.5 * invScale} fill={color}
                    pointerLength={6 * invScale} pointerWidth={6 * invScale}
                    hitStrokeWidth={20 * invScale}
                />
                <Arrow
                    points={[p2.x, p2.y, p1.x, p1.y]}
                    stroke={color} strokeWidth={1.5 * invScale} fill={color}
                    pointerLength={6 * invScale} pointerWidth={6 * invScale}
                    hitStrokeWidth={20 * invScale}
                />
                <Label x={midX} y={midY}
                    offsetX={((label.length * 6 + 16) / 2) * invScale}
                    offsetY={12 * invScale}
                    onClick={(e) => { e.cancelBubble = true; onLabelEdit(polyline.id, i); }}
                    onTap={(e) => { e.cancelBubble = true; onLabelEdit(polyline.id, i); }}
                    onDblClick={(e) => { e.cancelBubble = true; onLabelEdit(polyline.id, i); }}
                    onDblTap={(e) => { e.cancelBubble = true; onLabelEdit(polyline.id, i); }}
                    onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'text'; }}
                >
                    <Tag fill="rgba(0,0,0,0.75)" cornerRadius={12 * invScale} />
                    <Text text={label} fill="#fef08a" fontSize={11 * invScale} padding={6 * invScale} fontFamily="Inter" fontStyle="600" />
                </Label>
            </React.Fragment>
        );
    }

    return (
        <Group name="polyline-group" draggable
            onClick={(e) => { e.cancelBubble = true; onSelect(polyline.id); }}
            onTap={(e) => { e.cancelBubble = true; onSelect(polyline.id); }}
            onTouchStart={(e) => { e.cancelBubble = true; onSelect(polyline.id); }}
            onDragEnd={handleGroupDrag}
            onMouseEnter={(e) => { if (e.target.name() === 'polyline-group') e.target.getStage().container().style.cursor = 'move'; }}
            onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
        >
            {segments}
            {isSelected && pts.map((p, i) => (
                <Circle key={`pt-${i}`} name="handle" x={p.x} y={p.y}
                    radius={7 * invScale} fill="#10b981" stroke="#fff" strokeWidth={2 * invScale}
                    hitStrokeWidth={20 * invScale} draggable
                    onDragStart={(e) => e.cancelBubble = true}
                    onDragMove={(e) => handlePointDrag(i, e, false)}
                    onDragEnd={(e) => { e.cancelBubble = true; handlePointDrag(i, e, true); }}
                    onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'crosshair'; }}
                    onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'move'; }}
                />
            ))}
        </Group>
    );
};

export default PolylineDimGroup;
