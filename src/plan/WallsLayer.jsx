import React from 'react';
import { Group, Line, Arc, Circle, Label, Tag, Text } from 'react-konva';
import { wallQuad, dist, wallSegments, wallOutwardNormal } from '../lib/geometry';

const WALL_FILL = '#334155';
const WALL_SELECTED = '#2563eb';
const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * Wall graph renderer: thick wall quads, joint patches, dimension labels,
 * door/window openings, node handles for the selected wall.
 *
 * Taps are delegated upward — the editor decides what a tap means per mode:
 *   onWallTap(wallId, t)  — wall body (t = param along centerline 0..1)
 *   onLabelTap(wallId)    — dimension label
 *   onOpeningTap(wallId, openingId)
 *   onNodeDrag(nodeId, pos, commit)
 */
const WallsLayer = ({
    plan, scale, sel, listening, showHandles,
    onWallTap, onLabelTap, onOpeningTap, onSegmentTap, onNodeDrag, snapFn,
}) => {
    const inv = 1 / scale;
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const nodeTh = new Map();
    for (const w of plan.walls) {
        for (const id of [w.a, w.b]) nodeTh.set(id, Math.max(nodeTh.get(id) || 0, w.thickness));
    }
    const selWallId = sel?.kind === 'wall' ? sel.id : null;
    const selOpeningId = sel?.kind === 'opening' ? sel.id : null;
    const selWall = plan.walls.find(w => w.id === selWallId);
    const selNodeIds = selWall ? [...new Set([selWall.a, selWall.b])] : [];

    const tapWall = (w, e) => {
        e.cancelBubble = true;
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
        onWallTap(w.id, t);
    };

    return (
        <Group listening={listening}>
            {plan.walls.map(w => {
                const a = nodeById.get(w.a);
                const b = nodeById.get(w.b);
                if (!a || !b) return null;
                const isSel = w.id === selWallId;
                const quad = wallQuad(a, b, w.thickness);
                const wallLen = dist(a, b);
                if (wallLen <= 0) return null;
                const ux = (b.x - a.x) / wallLen;
                const uy = (b.y - a.y) / wallLen;
                const nx = -uy, ny = ux;
                const h = w.thickness / 2;

                return (
                    <Group key={w.id}>
                        <Line
                            points={quad.flatMap(p => [p.x, p.y])}
                            closed
                            fill={isSel ? WALL_SELECTED : WALL_FILL}
                            hitStrokeWidth={Math.max(w.thickness, 26 * inv)}
                            onClick={(e) => tapWall(w, e)}
                            onTap={(e) => tapWall(w, e)}
                            onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'pointer'; }}
                            onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                        />
                        {(w.openings || []).map(op => {
                            const cx = a.x + op.t * (b.x - a.x);
                            const cy = a.y + op.t * (b.y - a.y);
                            const hw = op.width / 2;
                            const p1x = cx - hw * ux, p1y = cy - hw * uy;
                            const p2x = cx + hw * ux, p2y = cy + hw * uy;
                            const isSelOp = op.id === selOpeningId;
                            const opColor = isSelOp ? WALL_SELECTED : '#64748b';
                            const tapOp = (e) => { e.cancelBubble = true; onOpeningTap(w.id, op.id); };

                            return (
                                <Group key={op.id} onClick={tapOp} onTap={tapOp}>
                                    {/* white gap in the wall */}
                                    <Line
                                        points={[
                                            p1x + nx * h, p1y + ny * h,
                                            p2x + nx * h, p2y + ny * h,
                                            p2x - nx * h, p2y - ny * h,
                                            p1x - nx * h, p1y - ny * h,
                                        ]}
                                        closed fill={isSelOp ? '#dbeafe' : '#ffffff'}
                                        hitStrokeWidth={Math.max(w.thickness * 1.5, 30 * inv)}
                                    />
                                    {op.type === 'door' ? (
                                        <>
                                            <Line points={[p1x, p1y, p2x, p2y]}
                                                stroke={opColor} strokeWidth={2 * inv} listening={false} />
                                            <Arc
                                                x={p1x} y={p1y}
                                                innerRadius={0}
                                                outerRadius={op.width}
                                                angle={90}
                                                rotation={Math.atan2(uy, ux) * 180 / Math.PI + (op.flipped ? -90 : 0)}
                                                fill="rgba(37,99,235,0.07)"
                                                stroke={opColor} strokeWidth={1.5 * inv}
                                                listening={false}
                                            />
                                        </>
                                    ) : (
                                        <>
                                            <Line points={[p1x + nx * h * 0.6, p1y + ny * h * 0.6, p2x + nx * h * 0.6, p2y + ny * h * 0.6]}
                                                stroke={opColor} strokeWidth={2 * inv} listening={false} />
                                            <Line points={[p1x - nx * h * 0.6, p1y - ny * h * 0.6, p2x - nx * h * 0.6, p2y - ny * h * 0.6]}
                                                stroke={opColor} strokeWidth={2 * inv} listening={false} />
                                            <Line points={[p1x, p1y, p2x, p2y]}
                                                stroke={opColor} strokeWidth={1 * inv} dash={[4 * inv, 3 * inv]} listening={false} />
                                        </>
                                    )}
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

            {/* Kích thước để ngoài thành kích thước 2 tầng: Tầng 1 chuỗi cạnh tường + cửa, Tầng 2 tổng chiều dài tường */}
            {plan.walls.map(w => {
                if (w.column) return null;
                const { nx, ny, ux, uy, a, b, len } = wallOutwardNormal(plan, w);
                if (!a || !b || len <= 0) return null;
                const isSel = w.id === selWallId;
                const hasOps = (w.openings || []).length > 0;
                const halfT = (w.thickness || 110) / 2;
                const tier1Off = halfT + 24 * inv;
                const tier2Off = halfT + (hasOps ? 52 : 24) * inv;
                const extFrom = halfT + 3 * inv;
                const extPad = 5 * inv;
                const tickSz = 4 * inv;
                const tx = (ux + nx) * 0.7071 * tickSz;
                const ty = (uy + ny) * 0.7071 * tickSz;

                const label = String(Math.round(len));
                const tapLbl = (e) => { e.cancelBubble = true; onLabelTap(w.id); };
                const segs = hasOps ? wallSegments(w, len).filter(s => s.len >= 1) : [];

                const boundaryTs = hasOps
                    ? [...new Set([0, ...segs.flatMap(s => [s.from, s.to]), len])]
                    : [0, len];

                return (
                    <Group key={`lbl-${w.id}`}>
                        {/* Đường dim Tầng 1 (khi có cửa: chuỗi đoạn + cửa nằm hoàn toàn ngoài tường) */}
                        {hasOps && (
                            <>
                                <Line
                                    points={[
                                        a.x + nx * tier1Off - ux * 4 * inv, a.y + ny * tier1Off - uy * 4 * inv,
                                        b.x + nx * tier1Off + ux * 4 * inv, b.y + ny * tier1Off + uy * 4 * inv,
                                    ]}
                                    stroke="#64748b" strokeWidth={1.1 * inv} listening={false}
                                />
                                {boundaryTs.map((tPos, bi) => {
                                    const bx = a.x + ux * tPos;
                                    const by = a.y + uy * tPos;
                                    const d1x = bx + nx * tier1Off;
                                    const d1y = by + ny * tier1Off;
                                    return (
                                        <Group key={`t1mk-${w.id}-${bi}`} listening={false}>
                                            <Line
                                                points={[bx + nx * extFrom, by + ny * extFrom, d1x + nx * extPad, d1y + ny * extPad]}
                                                stroke="rgba(100,116,139,0.5)" strokeWidth={0.9 * inv}
                                            />
                                            <Line
                                                points={[d1x - tx, d1y - ty, d1x + tx, d1y + ty]}
                                                stroke="#475569" strokeWidth={1.5 * inv}
                                            />
                                        </Group>
                                    );
                                })}
                                {segs.map(s => {
                                    const c = s.from + s.len / 2;
                                    const txt = String(Math.round(s.len));
                                    if (s.kind === 'seg') {
                                        const isLocked = !!w.segLocks?.[s.idx];
                                        const tapSeg = (e) => { e.cancelBubble = true; onSegmentTap?.(w.id, s.idx, Math.round(s.len)); };
                                        return (
                                            <Label key={`sg-${w.id}-${s.idx}`}
                                                x={a.x + ux * c + nx * tier1Off}
                                                y={a.y + uy * c + ny * tier1Off}
                                                offsetX={((txt.length * 6 + 14) / 2) * inv}
                                                offsetY={11 * inv}
                                                onClick={tapSeg}
                                                onTap={tapSeg}
                                                onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'text'; }}
                                                onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                                            >
                                                <Tag
                                                    fill={isLocked ? '#ecfdf5' : '#ffffff'}
                                                    stroke={isLocked ? '#059669' : '#2563eb'}
                                                    strokeWidth={(isLocked ? 1.6 : 1.2) * inv}
                                                    cornerRadius={6 * inv}
                                                />
                                                <Text text={txt} fill={isLocked ? '#065f46' : '#1e40af'} fontSize={10 * inv} padding={4.5 * inv} fontFamily={FONT} fontStyle="700" />
                                            </Label>
                                        );
                                    }
                                    const opSel = s.opId === selOpeningId;
                                    const tapOp = (e) => { e.cancelBubble = true; onOpeningTap?.(w.id, s.opId); };
                                    return (
                                        <Label key={`opd-${w.id}-${s.opId}`}
                                            x={a.x + ux * c + nx * tier1Off}
                                            y={a.y + uy * c + ny * tier1Off}
                                            offsetX={((txt.length * 6 + 14) / 2) * inv}
                                            offsetY={11 * inv}
                                            onClick={tapOp}
                                            onTap={tapOp}
                                            onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'pointer'; }}
                                            onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                                        >
                                            <Tag
                                                fill={opSel ? 'rgba(37,99,235,0.94)' : '#eff6ff'}
                                                stroke={opSel ? '#1d4ed8' : '#64748b'}
                                                strokeWidth={1.1 * inv}
                                                cornerRadius={6 * inv}
                                            />
                                            <Text text={txt} fill={opSel ? '#fff' : '#334155'} fontSize={10 * inv} padding={4.5 * inv} fontFamily={FONT} fontStyle="700" />
                                        </Label>
                                    );
                                })}
                            </>
                        )}

                        {/* Đường dim Tầng 2 (tổng tường — hoặc đường đơn ngoài tường khi chưa có cửa) */}
                        <Line
                            points={[
                                a.x + nx * tier2Off - ux * 4 * inv, a.y + ny * tier2Off - uy * 4 * inv,
                                b.x + nx * tier2Off + ux * 4 * inv, b.y + ny * tier2Off + uy * 4 * inv,
                            ]}
                            stroke={isSel ? '#2563eb' : '#475569'} strokeWidth={1.15 * inv} listening={false}
                        />
                        {[0, len].map((tEnd, ei) => {
                            const ex = a.x + ux * tEnd;
                            const ey = a.y + uy * tEnd;
                            const d2x = ex + nx * tier2Off;
                            const d2y = ey + ny * tier2Off;
                            return (
                                <Group key={`t2mk-${w.id}-${ei}`} listening={false}>
                                    <Line
                                        points={[
                                            ex + nx * (hasOps ? tier1Off : extFrom), ey + ny * (hasOps ? tier1Off : extFrom),
                                            d2x + nx * extPad, d2y + ny * extPad,
                                        ]}
                                        stroke="rgba(71,85,105,0.45)" strokeWidth={0.9 * inv}
                                    />
                                    <Line
                                        points={[d2x - tx, d2y - ty, d2x + tx, d2y + ty]}
                                        stroke={isSel ? '#2563eb' : '#0f172a'} strokeWidth={1.6 * inv}
                                    />
                                </Group>
                            );
                        })}

                        <Label
                            x={(a.x + b.x) / 2 + nx * tier2Off}
                            y={(a.y + b.y) / 2 + ny * tier2Off}
                            offsetX={((label.length * 6.5 + 18) / 2) * inv}
                            offsetY={13 * inv}
                            onClick={tapLbl}
                            onTap={tapLbl}
                            onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'text'; }}
                            onMouseLeave={(e) => { e.target.getStage().container().style.cursor = 'default'; }}
                        >
                            <Tag fill={isSel ? 'rgba(37,99,235,0.92)' : w.edited ? '#fecaca' : 'rgba(15,23,42,0.82)'} cornerRadius={12 * inv} />
                            <Text text={label} fill={isSel ? '#fef08a' : w.edited ? '#dc2626' : '#fef08a'}
                                fontSize={11.5 * inv} padding={6 * inv} fontFamily={FONT} fontStyle="700" />
                        </Label>
                    </Group>
                );
            })}

            {/* node handles of the selected wall */}
            {showHandles && selWall && selNodeIds.map(id => {
                const n = nodeById.get(id);
                if (!n) return null;
                return (
                    <Circle key={`h-${id}`} name="handle" x={n.x} y={n.y}
                        radius={11 * inv} fill="#10b981" stroke="#fff" strokeWidth={2.5 * inv}
                        hitStrokeWidth={30 * inv} draggable
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
