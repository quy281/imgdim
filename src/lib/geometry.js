// Pure geometry for plan docs. Coordinate system: 1 unit = 1 mm, y-down (screen).

let __seq = 0;
export const genId = (prefix) => `${prefix}${Date.now().toString(36)}${(__seq++).toString(36)}`;

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export function snapToGrid(pt, step) {
    return { x: Math.round(pt.x / step) * step, y: Math.round(pt.y / step) * step };
}

// Snap pt so the segment prev->pt becomes horizontal or vertical (whichever is closer)
export function snapOrtho(prev, pt) {
    const dx = Math.abs(pt.x - prev.x);
    const dy = Math.abs(pt.y - prev.y);
    return dx >= dy ? { x: pt.x, y: prev.y } : { x: prev.x, y: pt.y };
}

export function findNearbyNode(nodes, pt, tol) {
    let best = null;
    let bestD = tol;
    for (const n of nodes) {
        const d = dist(n, pt);
        if (d <= bestD) { best = n; bestD = d; }
    }
    return best;
}

// 4 corners of the wall rectangle along centerline a->b
export function wallQuad(a, b, thickness) {
    const len = dist(a, b);
    if (len === 0) return [a, a, a, a];
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const h = thickness / 2;
    return [
        { x: a.x + nx * h, y: a.y + ny * h },
        { x: b.x + nx * h, y: b.y + ny * h },
        { x: b.x - nx * h, y: b.y - ny * h },
        { x: a.x - nx * h, y: a.y - ny * h },
    ];
}

function buildAdjacency(walls) {
    const adj = new Map();
    for (const w of walls) {
        if (!adj.has(w.a)) adj.set(w.a, []);
        if (!adj.has(w.b)) adj.set(w.b, []);
        adj.get(w.a).push({ wall: w, other: w.b });
        adj.get(w.b).push({ wall: w, other: w.a });
    }
    return adj;
}

// Set of node ids reachable from fromNodeId without crossing excludeWallId
export function bfsReachable(walls, fromNodeId, excludeWallId) {
    const adj = buildAdjacency(walls);
    const seen = new Set([fromNodeId]);
    const queue = [fromNodeId];
    while (queue.length) {
        const cur = queue.shift();
        for (const { wall, other } of adj.get(cur) || []) {
            if (excludeWallId && wall.id === excludeWallId) continue;
            if (!seen.has(other)) { seen.add(other); queue.push(other); }
        }
    }
    return seen;
}

/**
 * Resize wall to real length L (mm) and propagate.
 * CASE 1 (tree edge): translate everything on the far side of the wall.
 * CASE 2 (axis-aligned wall inside a loop): "axis stretch" — translate every node of the
 *   component lying at/beyond node b along the wall direction, so opposite walls follow.
 * CASE 3 (diagonal wall inside a loop): only node b moves; neighbors change length.
 */
export function applyWallLength(plan, wallId, L) {
    const wall = plan.walls.find(w => w.id === wallId);
    if (!wall) return { plan, warning: null };
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const a = nodeById.get(wall.a);
    const b = nodeById.get(wall.b);
    if (!a || !b) return { plan, warning: null };
    const len = dist(a, b);
    if (len <= 0 || L <= 0) return { plan, warning: null };
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const dl = L - len;
    if (Math.abs(dl) < 0.001) return { plan, warning: null };
    const delta = { x: ux * dl, y: uy * dl };

    const reach = bfsReachable(plan.walls, wall.b, wall.id);
    let moved;
    let warning = null;
    if (!reach.has(wall.a)) {
        moved = reach;
    } else {
        const isH = Math.abs(uy) < 1e-6;
        const isV = Math.abs(ux) < 1e-6;
        if (isH || isV) {
            const comp = bfsReachable(plan.walls, wall.a, null);
            const axis = isH ? 'x' : 'y';
            const dirSign = isH ? Math.sign(ux) : Math.sign(uy);
            const bCoord = b[axis];
            const EPS = 0.5; // mm
            moved = new Set();
            for (const id of comp) {
                const n = nodeById.get(id);
                if (n && (n[axis] - bCoord) * dirSign >= -EPS) moved.add(id);
            }
            // Respect edited walls: don't split an edited wall by moving only one of its endpoints.
            // If exactly one endpoint of an edited wall is in moved, pull it out (lock it).
            // Iterate until stable — removing one node can expose another edited wall violation.
            let stable = false;
            while (!stable) {
                stable = true;
                for (const w of plan.walls) {
                    if (!w.edited || w.id === wallId) continue;
                    const aIn = moved.has(w.a);
                    const bIn = moved.has(w.b);
                    if (aIn && !bIn) { moved.delete(w.a); stable = false; break; }
                    if (bIn && !aIn) { moved.delete(w.b); stable = false; break; }
                }
            }
        } else {
            moved = new Set([wall.b]);
            warning = 'Tường nằm trong vòng khép kín và không thẳng trục — kích thước các tường kề sẽ thay đổi theo.';
        }
    }
    const newNodes = plan.nodes.map(n => moved.has(n.id) ? { ...n, x: n.x + delta.x, y: n.y + delta.y } : n);
    const newWalls = plan.walls.map(w => w.id === wallId ? { ...w, edited: true } : w);
    return { plan: { ...plan, nodes: newNodes, walls: newWalls }, warning };
}

/**
 * Scale the entire plan by newLen/currentLen of the reference wall (first-time calibration).
 * Marks plan.calibrated so subsequent edits use applyWallLength.
 */
export function scaleAllWalls(plan, wallId, newLen) {
    const wall = plan.walls.find(w => w.id === wallId);
    if (!wall) return { plan, warning: null };
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const a = nodeById.get(wall.a);
    const b = nodeById.get(wall.b);
    if (!a || !b) return { plan, warning: null };
    const oldLen = dist(a, b);
    if (oldLen <= 0 || newLen <= 0) return { plan, warning: null };
    const s = newLen / oldLen;
    const n = plan.nodes.length || 1;
    const cx = plan.nodes.reduce((sum, nd) => sum + nd.x, 0) / n;
    const cy = plan.nodes.reduce((sum, nd) => sum + nd.y, 0) / n;
    const newNodes = plan.nodes.map(nd => ({
        ...nd,
        x: cx + (nd.x - cx) * s,
        y: cy + (nd.y - cy) * s,
    }));
    const newWalls = plan.walls.map(w => w.id === wallId ? { ...w, edited: true } : w);
    return { plan: { ...plan, nodes: newNodes, walls: newWalls, calibrated: true }, warning: null };
}

/**
 * Closest point on any wall segment to pt. Returns { wallId, t, x, y } or null.
 * Only mid-segment hits (t in [0.12, 0.88]) — near-node taps snap to the node instead.
 */
export function snapToWall(plan, pt, threshold) {
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    let best = null;
    let bestDist = threshold;
    for (const w of plan.walls) {
        const a = nodeById.get(w.a);
        const b = nodeById.get(w.b);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1) continue;
        const t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
        if (t < 0.12 || t > 0.88) continue;
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        const d = Math.hypot(pt.x - px, pt.y - py);
        if (d < bestDist) { bestDist = d; best = { wallId: w.id, t, x: px, y: py }; }
    }
    return best;
}

/**
 * Split wallId at pt into two walls joined by a new node.
 * Openings are distributed to the correct half with re-normalized t.
 */
export function splitWallAtPoint(plan, wallId, pt) {
    const wall = plan.walls.find(w => w.id === wallId);
    if (!wall) return { plan, newNodeId: null };
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const a = nodeById.get(wall.a);
    const b = nodeById.get(wall.b);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const tSplit = len2 > 0 ? Math.max(0.05, Math.min(0.95, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2)) : 0.5;
    const ops = wall.openings || [];
    const newNodeId = genId('n');
    const newNode = { id: newNodeId, x: pt.x, y: pt.y };
    const wallA = {
        id: genId('w'), a: wall.a, b: newNodeId, thickness: wall.thickness,
        openings: ops.filter(o => o.t <= tSplit).map(o => ({ ...o, t: o.t / tSplit })),
    };
    const wallB = {
        id: genId('w'), a: newNodeId, b: wall.b, thickness: wall.thickness,
        openings: ops.filter(o => o.t > tSplit).map(o => ({ ...o, t: (o.t - tSplit) / (1 - tSplit) })),
    };
    const walls = plan.walls.filter(w => w.id !== wallId).concat([wallA, wallB]);
    return { plan: { ...plan, nodes: [...plan.nodes, newNode], walls }, newNodeId };
}

// Signed area (shoelace)
export function shoelaceArea(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        s += p.x * q.y - q.x * p.y;
    }
    return s / 2;
}

export function polygonPerimeter(pts) {
    let s = 0;
    for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]);
    return s;
}

export function polygonCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        const cross = p.x * q.y - q.x * p.y;
        a += cross;
        cx += (p.x + q.x) * cross;
        cy += (p.y + q.y) * cross;
    }
    a /= 2;
    if (Math.abs(a) < 1e-9) {
        const n = pts.length || 1;
        return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
    }
    return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(pt, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const pi = pts[i], pj = pts[j];
        if ((pi.y > pt.y) !== (pj.y > pt.y) &&
            pt.x < ((pj.x - pi.x) * (pt.y - pi.y)) / (pj.y - pi.y) + pi.x) {
            inside = !inside;
        }
    }
    return inside;
}

// Label anchor: centroid if inside, else bbox center if inside, else centroid
export function labelPoint(pts) {
    const c = polygonCentroid(pts);
    if (pointInPolygon(c, pts)) return c;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const bc = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    if (pointInPolygon(bc, pts)) return bc;
    return c;
}

const MIN_ROOM_AREA = 100000; // 0.1 m² in mm²

/**
 * Face-walk over the planar wall graph. Every directed edge belongs to exactly one face;
 * per connected component the face with the largest |area| is the outer face and is dropped.
 */
export function detectRooms(nodes, walls) {
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const out = new Map();
    for (const w of walls) {
        if (w.a === w.b) continue;
        const a = nodeById.get(w.a);
        const b = nodeById.get(w.b);
        if (!a || !b) continue;
        if (!out.has(w.a)) out.set(w.a, []);
        if (!out.has(w.b)) out.set(w.b, []);
        out.get(w.a).push({ to: w.b, angle: Math.atan2(b.y - a.y, b.x - a.x) });
        out.get(w.b).push({ to: w.a, angle: Math.atan2(a.y - b.y, a.x - b.x) });
    }
    for (const list of out.values()) list.sort((p, q) => p.angle - q.angle);

    const visited = new Set();
    const faces = [];
    for (const [from, list] of out) {
        for (const { to } of list) {
            if (visited.has(from + '>' + to)) continue;
            const cycle = [];
            let u = from, v = to;
            let ok = false;
            for (let guard = 0; guard < 20000; guard++) {
                visited.add(u + '>' + v);
                cycle.push(u);
                const edges = out.get(v);
                if (!edges || !edges.length) break;
                const un = nodeById.get(u);
                const vn = nodeById.get(v);
                const backAngle = Math.atan2(un.y - vn.y, un.x - vn.x);
                let idx = -1, bestDiff = Infinity;
                for (let i = 0; i < edges.length; i++) {
                    if (edges[i].to !== u) continue;
                    const d = Math.abs(edges[i].angle - backAngle);
                    if (d < bestDiff) { bestDiff = d; idx = i; }
                }
                if (idx === -1) break;
                const next = edges[(idx - 1 + edges.length) % edges.length];
                u = v; v = next.to;
                if (u === from && v === to) { ok = true; break; }
            }
            if (!ok || cycle.length < 3) continue;
            const pts = cycle.map(id => nodeById.get(id));
            const area = shoelaceArea(pts);
            faces.push({ nodeIds: cycle, pts, area });
        }
    }

    const compOf = new Map();
    for (const n of nodes) {
        if (compOf.has(n.id)) continue;
        const comp = bfsReachable(walls, n.id, null);
        for (const id of comp) compOf.set(id, n.id);
    }
    const byComp = new Map();
    for (const f of faces) {
        const c = compOf.get(f.nodeIds[0]);
        if (!byComp.has(c)) byComp.set(c, []);
        byComp.get(c).push(f);
    }
    const rooms = [];
    for (const group of byComp.values()) {
        if (group.length < 2) continue;
        let outerIdx = 0;
        for (let i = 1; i < group.length; i++) {
            if (Math.abs(group[i].area) > Math.abs(group[outerIdx].area)) outerIdx = i;
        }
        group.forEach((f, i) => {
            if (i !== outerIdx && Math.abs(f.area) >= MIN_ROOM_AREA) rooms.push(f);
        });
    }
    return rooms;
}

// Bounding box of a plan (walls + notes), with padding for labels
export function bboxOfPlan(plan, notes) {
    const xs = [];
    const ys = [];
    const push = (p) => {
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { xs.push(p.x); ys.push(p.y); }
    };
    (plan?.nodes || []).forEach(push);
    (notes || []).forEach(n => push({ x: n.x, y: n.y }));
    if (!xs.length) return null;
    const maxTh = plan?.walls?.length ? Math.max(...plan.walls.map(w => w.thickness || 0)) : 0;
    const pad = maxTh / 2 + 400;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
