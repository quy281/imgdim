import React from 'react';
import { Group, Shape } from 'react-konva';
import { getFloorMaterial, resolveRoomFloorMat } from '../lib/floorMaterials';

const PATTERN_CACHE = new Map();

function buildTextureCanvas(mat) {
    if (typeof document === 'undefined') return null;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    if (!g) return null;

    g.fillStyle = mat.base;
    g.fillRect(0, 0, size, size);

    if (mat.kind === 'wood') {
        const planks = 6;
        const ph = size / planks;
        for (let i = 0; i < planks; i++) {
            if (i % 2 === 1) {
                g.fillStyle = mat.alt;
                g.fillRect(0, i * ph, size, ph);
            }
            // subtle end joint staggered per row
            const jx = ((i * 97 + 43) % size);
            g.strokeStyle = mat.line;
            g.lineWidth = 1.4;
            g.beginPath();
            g.moveTo(0, i * ph);
            g.lineTo(size, i * ph);
            g.moveTo(jx, i * ph);
            g.lineTo(jx, (i + 1) * ph);
            g.stroke();

            // delicate wood grain lines
            g.strokeStyle = mat.grain;
            g.lineWidth = 0.8;
            for (let k = 0; k < 3; k++) {
                const gy = i * ph + (k + 0.7) * (ph / 3.4);
                g.beginPath();
                g.moveTo(0, gy);
                g.bezierCurveTo(size * 0.33, gy + (k % 2 ? 1.8 : -1.8), size * 0.66, gy - 1.5, size, gy);
                g.stroke();
            }
        }
    } else if (mat.kind === 'terrazzo') {
        // faint terrazzo grid
        g.strokeStyle = mat.line;
        g.lineWidth = 1.1;
        g.strokeRect(0.5, 0.5, size - 1, size - 1);
        g.beginPath();
        g.moveTo(size / 2, 0); g.lineTo(size / 2, size);
        g.moveTo(0, size / 2); g.lineTo(size, size / 2);
        g.stroke();
        // deterministic mineral flecks
        for (let i = 0; i < 65; i++) {
            const x = ((i * 73 + 19) % (size - 8)) + 4;
            const y = ((i * 137 + 31) % (size - 8)) + 4;
            const r = 1 + (i % 3) * 0.7;
            g.fillStyle = i % 3 === 0 ? mat.grain : (i % 2 === 0 ? 'rgba(148,163,184,0.22)' : 'rgba(180,165,140,0.24)');
            g.beginPath();
            g.arc(x, y, r, 0, Math.PI * 2);
            g.fill();
        }
    } else if (mat.kind === 'tile') {
        const half = size / 2;
        g.strokeStyle = mat.line;
        g.lineWidth = 1.6;
        g.strokeRect(0, 0, size, size);
        g.beginPath();
        g.moveTo(half, 0); g.lineTo(half, size);
        g.moveTo(0, half); g.lineTo(size, half);
        g.stroke();
    } else if (mat.kind === 'stone') {
        for (let i = 0; i < 90; i++) {
            const x = ((i * 61 + 13) % size);
            const y = ((i * 109 + 29) % size);
            g.fillStyle = i % 2 === 0 ? mat.grain : 'rgba(255,255,255,0.22)';
            g.fillRect(x, y, 2, 2);
        }
    } else if (mat.kind === 'grass') {
        for (let i = 0; i < 140; i++) {
            const x = ((i * 53 + 7) % size);
            const y = ((i * 97 + 17) % size);
            const w = 3 + (i % 4);
            g.fillStyle = i % 3 === 0 ? mat.alt : (i % 4 === 0 ? '#8ba85c' : mat.line);
            g.fillRect(x, y, w, 2);
        }
    }

    return c;
}

function getFloorPattern(ctx, matKey) {
    const mat = getFloorMaterial(matKey);
    const cacheKey = `${mat.key}`;
    let tile = PATTERN_CACHE.get(cacheKey);
    if (!tile) {
        tile = buildTextureCanvas(mat);
        if (tile) PATTERN_CACHE.set(cacheKey, tile);
    }
    if (!tile) return mat.base;
    try {
        const pat = ctx.createPattern(tile, 'repeat');
        if (pat && typeof pat.setTransform === 'function' && typeof DOMMatrix === 'function') {
            const s = (mat.tileMm || 900) / tile.width;
            pat.setTransform(new DOMMatrix().scale(s, s));
        }
        return pat || mat.base;
    } catch {
        return mat.base;
    }
}

/**
 * Vẽ lớp sàn nội thất cho từng phòng khép kín trong chế độ Trình bày kiến trúc.
 */
const RoomFloorsLayer = ({ plan, themeMode = 'presentation' }) => {
    const isPres = themeMode !== 'cad';
    if (!isPres || !plan?.rooms?.length || !plan?.nodes?.length) return null;

    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));

    return (
        <Group listening={false}>
            {plan.rooms.map(room => {
                const pts = (room.nodeIds || []).map(id => nodeById.get(id)).filter(Boolean);
                if (pts.length < 3) return null;
                const matKey = resolveRoomFloorMat(room);

                return (
                    <Shape
                        key={`floor-${room.id}-${matKey}`}
                        listening={false}
                        sceneFunc={(ctx) => {
                            ctx.save();
                            ctx.beginPath();
                            ctx.moveTo(pts[0].x, pts[0].y);
                            for (let i = 1; i < pts.length; i++) {
                                ctx.lineTo(pts[i].x, pts[i].y);
                            }
                            ctx.closePath();
                            ctx.fillStyle = getFloorPattern(ctx, matKey);
                            ctx.fill();
                            ctx.restore();
                        }}
                    />
                );
            })}
        </Group>
    );
};

export default RoomFloorsLayer;
