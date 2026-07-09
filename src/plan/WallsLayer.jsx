import React from 'react';
import { Group, Line, Arc, Circle, Label, Tag, Text } from 'react-konva';
import { wallQuad, dist } from './planGeometry';

const WALL_FILL = '#334155';
const WALL_SELECTED = '#2563eb';

/**
 * Renders the wall graph: thick wall quads + node joint patches + live dimension labels.
 * Also renders door/window openings on each wall.
 * editKTMode: wall body tap → edit dimension directly.
 * placeOpeningType: 'door'|'window'|null — in this mode, tapping wall body places an opening.
 */
const WallsLayer = ({
    plan, stageScale, selectedId, interactive,
    onSelect, onLabelEdit, onNodeDrag, snapFn,
    editKTMode, placeOpeningType, onPlaceOpening, onSelectOpening, selectedOpeningId
}) => {
    const invScale = 1 / stageScale;
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const nodeTh = new Map();
    for (const w of plan.walls) {
        for (const id of [w.a, w.b]) nodeTh.set(id, Math.max(nodeTh.get(id) || 0, w.thickness));
    }
    const selWall = plan.walls.find(w => w.id === selectedId);
    const selNodeIds = selWall ? [...new Set([selWall.a, selWall.b])] : [];

    const handleWallTap = (w, e) => {
        e.cancelBubble = true;
        if (placeOpeningType) {
            // Compute t param from tap position
            const stage = e.target.getStage();
            const pos = stage.getPointerPosition();
            const a = nodeById.get(w.a), b = nodeById.get(w.b);
            if (!a || !b) return;
            const wx = (pos.x - stage.x()) / stage.scaleX();
            const wy = (pos.y - stage.y()) / stage.scaleY();
            const dx = b.x - a.x, dy = b.y - a.y;
            const len2 = dx * dx + dy * dy;
            let t = len2 > 0 ? ((wx - a.x) * dx + (wy - a.y) * dy) / len2 : 0.5;
            t = Math.max(0.05, Math.min(0.95, t));
            onPlaceOpening?.(w.id, t);
            return;
        }
        if (editKTMode) { onLabelEdit(w.id); return; }
        onSelect(w.id);
    };

    return (
        <Group listening={interactive}>
            {plan.walls.map(w => {
                const a = nodeById.get(w.a);
                const b = nodeById.get(w.b);
                if (!a || !b) return null;
                const isSel = w.id === selectedId;
                const quad = wallQuad(a, b, w.thickness);
                const openings = w.openings || [];

                // Build clip path: wall with door/window gaps
                const wallLen = dist(a, b);
                const ux = (b.x - a.x) / wallLen;
                const uy = (b.y - a.y) / wallLen;
                const h = w.thickness / 2;

                return (
                    <Group key={w.id}>
                        {/* Main wall quad */}
                        <Line
                            points={quad.flatMap(p => [p.x, p.y])}
                            closed
                            fill={isSel ? WALL_SELECTED : WALL_FILL}
                            hitStrokeWidth={Math.max(w.thickness, 20 * invScale)}
                            onClick={(e) => handleWallTap(w, e)}
                            onTap={(e) => handleWallTap(w, e)}
                            onTouchStart={(e) => handleWallTap(w, e)}
                            onMouseEnter={(e) => {
                                const cursor = placeOpeningType ? 'copy' : editKTMode ? 'text' : 'pointer';
                                e.target.getStage().container().style.cursor = cursor;
                            }}
                            onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                        />
                        {/* Opening gaps + symbols */}
                        {openings.map(op => {
                            const ct = op.t;
                            const cx = a.x + ct * (b.x - a.x);
                            const cy = a.y + ct * (b.y - a.y);
                            const hw = op.width / 2;
                            // Endpoints of opening along wall
                            const p1x = cx - hw * ux, p1y = cy - hw * uy;
                            const p2x = cx + hw * ux, p2y = cy + hw * uy;
                            // Normal direction (for arc/window line)
                            const nx = -uy, ny = ux;
                            const flip = op.flipped ? -1 : 1;
                            const isSelOp = op.id === selectedOpeningId;

                            const opColor = isSelOp ? '#2563eb' : '#f8fafc';
                            const opBg = isSelOp ? '#dbeafe' : 'white';

                            return (
                                <Group key={op.id}
                                    onClick={(e) => { e.cancelBubble = true; onSelectOpening?.(w.id, op.id); }}
                                    onTap={(e) => { e.cancelBubble = true; onSelectOpening?.(w.id, op.id); }}>
                                    {/* White gap covers the wall */}
                                    <Line
                                        points={[
                                            p1x + nx * h, p1y + ny * h,
                                            p2x + nx * h, p2y + ny * h,
                                            p2x - nx * h, p2y - ny * h,
                                            p1x - nx * h, p1y - ny * h,
                                        ]}
                                        closed fill={opBg} listening={false}
                                    />
                                    {op.type === 'door' ? (
                                        <>
                                            {/* Door panel line */}
                                            <Line points={[p1x, p1y, p2x, p2y]}
                                                stroke={opColor} strokeWidth={2 * invScale} listening={false} />
                                            {/* Door swing arc */}
                                            <Arc
                                                x={p1x} y={p1y}
                                                innerRadius={0}
                                                outerRadius={op.width}
                                                angle={90}
                                                rotation={Math.atan2(uy, ux) * 180 / Math.PI + (flip > 0 ? 0 : -90)}
                                                fill="rgba(37,99,235,0.08)"
                                                stroke={opColor} strokeWidth={1.5 * invScale}
                                                listening={false}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            {/* Window: 3 lines */}
                                            <Line points={[p1x + nx * h * 0.6, p1y + ny * h * 0.6, p2x + nx * h * 0.6, p2y + ny * h * 0.6]}
                                                stroke={opColor} strokeWidth={2 * invScale} listening={false} />
                                            <Line points={[p1x - nx * h * 0.6, p1y - ny * h * 0.6, p2x - nx * h * 0.6, p2y - ny * h * 0.6]}
                                                stroke={opColor} strokeWidth={2 * invScale} listening={false} />
                                            <Line points={[p1x, p1y, p2x, p2y]}
                                                stroke={opColor} strokeWidth={1 * invScale} dash={[4 * invScale, 3 * invScale]} listening={false} />
                                        </>
                                    )}
                                    {/* KT label */}
                                    <Label
                                        x={cx + nx * (h + 14 * invScale)}
                                        y={cy + ny * (h + 14 * invScale)}
                                        offsetX={((String(op.width).length * 6 + 16) / 2) * invScale}
                                        offsetY={10 * invScale}
                                        onClick={(e) => { e.cancelBubble = true; onSelectOpening?.(w.id, op.id); }}
                                        onTap={(e) => { e.cancelBubble = true; onSelectOpening?.(w.id, op.id); }}>
                                        <Tag fill={isSelOp ? 'rgba(37,99,235,0.9)' : 'rgba(100,116,139,0.85)'} cornerRadius={8 * invScale} />
                                        <Text text={String(op.width)} fill="#f8fafc" fontSize={10 * invScale} padding={5 * invScale} fontFamily="Inter" fontStyle="600" />
                                    </Label>
                                </Group>
                            );
                        })}
                    </Group>
                );
            })}

            {/* joint patches */}
            {plan.nodes.map(n => nodeTh.has(n.id) ? (
                <Circle key={`patch-${n.id}`} x={n.x} y={n.y} radius={nodeTh.get(n.id) / 2}
                    fill={selNodeIds.includes(n.id) ? WALL_SELECTED : WALL_FILL} listening={false} />
            ) : null)}

            {/* dimension labels */}
            {plan.walls.map(w => {
                const a = nodeById.get(w.a);
                const b = nodeById.get(w.b);
                if (!a || !b) return null;
                const len = dist(a, b);
                if (len <= 0) return null;
                const label = String(Math.round(len));
                const nx = -(b.y - a.y) / len;
                const ny = (b.x - a.x) / len;
                const off = w.thickness / 2 + 16 * invScale;
                const isSel = w.id === selectedId;
                return (
                    <Label key={`lbl-${w.id}`}
                        x={(a.x + b.x) / 2 + nx * off}
                        y={(a.y + b.y) / 2 + ny * off}
                        offsetX={((label.length * 6 + 16) / 2) * invScale}
                        offsetY={12 * invScale}
                        onClick={(e) => { e.cancelBubble = true; onLabelEdit(w.id); }}
                        onTap={(e) => { e.cancelBubble = true; onLabelEdit(w.id); }}
                        onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'text'; }}
                        onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                    >
                        <Tag fill={isSel ? 'rgba(37,99,235,0.9)' : w.edited ? '#fecaca' : 'rgba(0,0,0,0.75)'} cornerRadius={12 * invScale} />
                        <Text text={label} fill={isSel ? '#fef08a' : w.edited ? '#dc2626' : '#fef08a'} fontSize={11 * invScale} padding={6 * invScale} fontFamily="Inter" fontStyle="600" />
                    </Label>
                );
            })}

            {/* node handles of the selected wall */}
            {selWall && selNodeIds.map(id => {
                const n = nodeById.get(id);
                if (!n) return null;
                return (
                    <Circle key={`h-${id}`} name="handle" x={n.x} y={n.y}
                        radius={10 * invScale} fill="#10b981" stroke="#fff" strokeWidth={2 * invScale}
                        hitStrokeWidth={26 * invScale} draggable
                        onDragStart={(e) => { e.cancelBubble = true; }}
                        onDragMove={(e) => {
                            const p = snapFn({ x: e.target.x(), y: e.target.y() });
                            e.target.x(p.x); e.target.y(p.y);
                            onNodeDrag(id, p, false);
                        }}
                        onDragEnd={(e) => {
                            e.cancelBubble = true;
                            const p = snapFn({ x: e.target.x(), y: e.target.y() });
                            onNodeDrag(id, p, true);
                        }}
                        onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'crosshair'; }}
                        onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                    />
                );
            })}
        </Group>
    );
};

export default WallsLayer;
