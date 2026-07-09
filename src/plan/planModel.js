// Immutable mutations on the plan-doc data model.
import { genId, dist, detectRooms, shoelaceArea, polygonPerimeter, pointInPolygon, labelPoint } from './planGeometry';

export function createPlanDoc(name, stageSize) {
    const w = stageSize.width || 800;
    const h = stageSize.height || 600;
    const FIT = 12000; // fit ~12 m into the initial view
    const scale = Math.min((w - 40) / FIT, (h - 40) / FIT);
    const plan = { nodes: [], walls: [], rooms: [] };
    return {
        id: Date.now() + Math.random(),
        name,
        type: 'plan',
        img: null,
        imgBase64: null,
        plan,
        planHistory: [plan],
        planSettings: { wallThickness: 110, orthoMode: true, gridSnap: true, gridMinor: 100, gridMajor: 1000 },
        lines: [], texts: [], polylines: [],
        linesHistory: [[]], textsHistory: [[]], polylinesHistory: [[]], historyStep: 0,
        globalRatio: 1, // 1 canvas unit = 1 mm, so free dim lines label real mm directly
        calibPoints: null, homography: null, frameAttrs: null,
        stageScale: scale,
        stagePos: { x: (w - FIT * scale) / 2, y: (h - FIT * scale) / 2 }
    };
}

/**
 * Add a wall segment between two anchors ({ nodeId|null, x, y }).
 * Reuses existing nodes via anchor.nodeId, creates new ones otherwise.
 * closed = true when the segment ended on a pre-existing node (loop closed / joined network).
 */
export function addWallSegment(plan, fromAnchor, toAnchor, thickness) {
    let nodes = plan.nodes;
    const ensureNode = (anchor) => {
        if (anchor.nodeId) return { id: anchor.nodeId, existed: true };
        const n = { id: genId('n'), x: anchor.x, y: anchor.y };
        nodes = [...nodes, n];
        return { id: n.id, existed: false };
    };
    const from = ensureNode(fromAnchor);
    const to = ensureNode(toAnchor);
    if (from.id === to.id) {
        return { plan, startNodeId: from.id, endNodeId: to.id, closed: false, added: false };
    }
    const dup = plan.walls.find(w => (w.a === from.id && w.b === to.id) || (w.a === to.id && w.b === from.id));
    if (dup) {
        return { plan: { ...plan, nodes }, startNodeId: from.id, endNodeId: to.id, closed: to.existed, added: false };
    }
    const wall = { id: genId('w'), a: from.id, b: to.id, thickness };
    return {
        plan: { ...plan, nodes, walls: [...plan.walls, wall] },
        startNodeId: from.id,
        endNodeId: to.id,
        closed: to.existed,
        added: true
    };
}

export function deleteWall(plan, wallId) {
    const walls = plan.walls.filter(w => w.id !== wallId);
    const usedIds = new Set();
    for (const w of walls) { usedIds.add(w.a); usedIds.add(w.b); }
    const nodes = plan.nodes.filter(n => usedIds.has(n.id));
    return { ...plan, walls, nodes };
}

export function moveNode(plan, nodeId, pos) {
    return { ...plan, nodes: plan.nodes.map(n => n.id === nodeId ? { ...n, x: pos.x, y: pos.y } : n) };
}

export function renameRoom(plan, roomId, name) {
    return { ...plan, rooms: (plan.rooms || []).map(r => r.id === roomId ? { ...r, name } : r) };
}

/**
 * Re-detect rooms from geometry, preserving user-given names.
 * Match old room -> new face by node-id key first, then by old label point falling inside the new polygon.
 */
export function recomputeRooms(plan) {
    const faces = detectRooms(plan.nodes, plan.walls);
    const oldRooms = plan.rooms || [];
    const used = new Set();
    const rooms = faces.map(f => {
        const key = [...new Set(f.nodeIds)].sort().join(',');
        let old = oldRooms.find(r => r.key === key && !used.has(r.id));
        if (!old) {
            old = oldRooms.find(r => !used.has(r.id) && Number.isFinite(r.cx) && pointInPolygon({ x: r.cx, y: r.cy }, f.pts));
        }
        if (old) used.add(old.id);
        const lp = labelPoint(f.pts);
        return {
            id: old ? old.id : genId('r'),
            name: old ? old.name : null,
            key,
            nodeIds: f.nodeIds,
            area: Math.abs(shoelaceArea(f.pts)),
            perimeter: polygonPerimeter(f.pts),
            cx: lp.x,
            cy: lp.y
        };
    });
    let n = 1;
    const taken = new Set(rooms.filter(r => r.name).map(r => r.name));
    for (const r of rooms) {
        if (!r.name) {
            while (taken.has(`Phòng ${n}`)) n++;
            r.name = `Phòng ${n}`;
            taken.add(r.name);
        }
    }
    return { ...plan, rooms };
}

/** Add a door/window opening to a wall. t=0..1 position along wall. */
export function addOpening(plan, wallId, t, type, width) {
    const openingId = genId('op');
    const walls = plan.walls.map(w => {
        if (w.id !== wallId) return w;
        const openings = [...(w.openings || []), { id: openingId, type, t, width, flipped: false }];
        return { ...w, openings };
    });
    return { plan: { ...plan, walls }, openingId };
}

export function removeOpening(plan, wallId, openingId) {
    const walls = plan.walls.map(w => {
        if (w.id !== wallId) return w;
        return { ...w, openings: (w.openings || []).filter(op => op.id !== openingId) };
    });
    return { ...plan, walls };
}

export function updateOpening(plan, wallId, openingId, changes) {
    const walls = plan.walls.map(w => {
        if (w.id !== wallId) return w;
        return { ...w, openings: (w.openings || []).map(op => op.id === openingId ? { ...op, ...changes } : op) };
    });
    return { ...plan, walls };
}

export { dist };
