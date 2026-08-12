// Pure geometry for plan docs. Coordinate system: 1 unit = 1 mm, y-down (screen).

// Id phải duy nhất GIỮA CÁC THIẾT BỊ, không chỉ trong một phiên: sync khớp record theo
// item_id, nên hai máy sinh cùng id là hai dự án khác nhau ghi đè nhau trên cloud.
// Thời gian (sắp xếp được) + số thứ tự phiên + 4 byte ngẫu nhiên từ CSPRNG.
let __seq = 0;
const rand36 = (bytes) => {
    const b = new Uint8Array(bytes);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
    else for (let i = 0; i < bytes; i++) b[i] = Math.floor(Math.random() * 256);
    return [...b].map(x => x.toString(36).padStart(2, '0')).join('');
};
export const genId = (prefix) =>
    `${prefix}${Date.now().toString(36)}${(__seq++).toString(36)}${rand36(4)}`;

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
    // Tường không được co ngắn hơn tổng bề rộng cửa đang có
    const opsSum = (wall.openings || []).reduce((s, op) => s + op.width, 0);
    if (opsSum > 0 && L < opsSum) {
        return { plan, warning: `Tường phải dài hơn tổng bề rộng cửa (${Math.round(opsSum)}mm)` };
    }
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

// ===== Segment dimensions: đoạn tường xen kẽ cửa =====
// Luật: tổng chiều dài tường CỐ ĐỊNH. Sửa 1 đoạn → cửa kề bù chênh lệch.
// Ngược lại, sửa nhãn TỔNG tường (applyWallLength) → tường dãn/co, cửa giữ bề rộng.

export const MIN_OPENING = 300; // mm — bề rộng cửa nhỏ nhất còn có nghĩa

/**
 * Chuỗi đoạn/cửa dọc tim tường theo thứ tự node a → b.
 * Trả về [{ kind:'seg'|'op', idx, len, from, to, opId?, type? }]
 * Luôn bắt đầu và kết thúc bằng 'seg' (có thể len = 0).
 */
export function wallSegments(wall, wallLen) {
    const ops = (wall.openings || [])
        .map(op => ({ ...op, c: op.t * wallLen }))
        .sort((x, y) => x.c - y.c);
    const out = [];
    let cursor = 0;
    let segIdx = 0;
    ops.forEach((op, i) => {
        const start = op.c - op.width / 2;
        const end = op.c + op.width / 2;
        out.push({ kind: 'seg', idx: segIdx++, len: start - cursor, from: cursor, to: start });
        out.push({ kind: 'op', idx: i, opId: op.id, type: op.type, len: op.width, from: start, to: end });
        cursor = end;
    });
    out.push({ kind: 'seg', idx: segIdx, len: wallLen - cursor, from: cursor, to: wallLen });
    return out;
}

// Rebuild openings từ mảng chiều dài mới của chuỗi; validate trước khi ghi.
function rebuildChain(wall, wallLen, chain, newLens) {
    for (let i = 0; i < chain.length; i++) {
        const min = chain[i].kind === 'op' ? MIN_OPENING : 0;
        if (newLens[i] < min - 0.5) {
            return {
                error: chain[i].kind === 'op'
                    ? `Cửa sẽ chỉ còn ${Math.round(newLens[i])}mm — tối thiểu ${MIN_OPENING}mm`
                    : 'Số đo vượt quá chiều dài tường',
            };
        }
    }
    const byId = new Map((wall.openings || []).map(o => [o.id, o]));
    const openings = [];
    let cur = 0;
    for (let i = 0; i < chain.length; i++) {
        const L = newLens[i];
        if (chain[i].kind === 'op') {
            const orig = byId.get(chain[i].opId);
            openings.push({ ...orig, width: Math.round(L), t: (cur + L / 2) / wallLen });
        }
        cur += L;
    }
    return { openings };
}

/**
 * Sửa chiều dài 1 đoạn tường (giữa 2 cửa, hoặc từ góc tới cửa).
 * Tổng tường không đổi — cửa kề bên phải bù, không có thì cửa kề bên trái.
 */
export function applySegmentLength(plan, wallId, segIdx, newLen) {
    const wall = plan.walls.find(w => w.id === wallId);
    if (!wall) return { plan, warning: null };
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const a = nodeById.get(wall.a);
    const b = nodeById.get(wall.b);
    if (!a || !b) return { plan, warning: null };
    const wallLen = dist(a, b);
    if (wallLen <= 0 || newLen < 0) return { plan, warning: null };

    const chain = wallSegments(wall, wallLen);
    const pos = chain.findIndex(s => s.kind === 'seg' && s.idx === segIdx);
    if (pos < 0) return { plan, warning: null };
    const delta = newLen - chain[pos].len;
    if (Math.abs(delta) < 0.5) return { plan, warning: null };

    // Cửa kề phải bù trước; không có thì cửa kề trái
    const absorbPos = chain[pos + 1]?.kind === 'op' ? pos + 1
        : chain[pos - 1]?.kind === 'op' ? pos - 1 : -1;
    if (absorbPos < 0) {
        return { plan, warning: 'Tường chưa có cửa — chạm nhãn tổng để sửa chiều dài tường' };
    }

    const newLens = chain.map(s => s.len);
    newLens[pos] = newLen;
    newLens[absorbPos] = chain[absorbPos].len - delta;

    const res = rebuildChain(wall, wallLen, chain, newLens);
    if (res.error) return { plan, warning: res.error };
    const walls = plan.walls.map(w => w.id === wallId ? { ...w, openings: res.openings } : w);
    return { plan: { ...plan, walls }, warning: null };
}

/**
 * Sửa bề rộng cửa. Tổng tường không đổi — đoạn kề phải bù, không đủ thì đoạn kề trái.
 */
export function applyOpeningWidth(plan, wallId, opId, newWidth) {
    const wall = plan.walls.find(w => w.id === wallId);
    if (!wall) return { plan, warning: null };
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const a = nodeById.get(wall.a);
    const b = nodeById.get(wall.b);
    if (!a || !b) return { plan, warning: null };
    const wallLen = dist(a, b);
    if (wallLen <= 0) return { plan, warning: null };
    if (newWidth < MIN_OPENING) return { plan, warning: `Bề rộng tối thiểu ${MIN_OPENING}mm` };

    const chain = wallSegments(wall, wallLen);
    const pos = chain.findIndex(s => s.kind === 'op' && s.opId === opId);
    if (pos < 0) return { plan, warning: null };
    const delta = newWidth - chain[pos].len;
    if (Math.abs(delta) < 0.5) return { plan, warning: null };

    const newLens = chain.map(s => s.len);
    newLens[pos] = newWidth;
    // đoạn kề phải bù; nếu âm thì thử đoạn kề trái
    if (chain[pos + 1] && chain[pos + 1].len - delta >= -0.5) {
        newLens[pos + 1] = chain[pos + 1].len - delta;
    } else if (chain[pos - 1] && chain[pos - 1].len - delta >= -0.5) {
        newLens[pos - 1] = chain[pos - 1].len - delta;
    } else {
        return { plan, warning: 'Không đủ chỗ trên tường cho bề rộng này' };
    }

    const res = rebuildChain(wall, wallLen, chain, newLens);
    if (res.error) return { plan, warning: res.error };
    const walls = plan.walls.map(w => w.id === wallId ? { ...w, openings: res.openings } : w);
    return { plan: { ...plan, walls }, warning: null };
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
 * Magnet nội thất vào tường: lưng áp sát MẶT TRONG tường, đồng thời quay theo hướng tường.
 * item = { x, y } (tâm), depth = chiều sâu d (mm), tol = ngưỡng hút (mm).
 * Trả về { x, y, rot } hoặc null nếu không có tường nào trong ngưỡng.
 */
export function snapFurnitureToWall(plan, item, depth, tol) {
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    let best = null;
    let bestGap = tol;
    for (const w of plan.walls) {
        const a = nodeById.get(w.a);
        const b = nodeById.get(w.b);
        if (!a || !b) continue;
        const len = dist(a, b);
        if (len < 1) continue;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        const nx = -uy, ny = ux;
        const rx = item.x - a.x, ry = item.y - a.y;
        const along = rx * ux + ry * uy;
        // chỉ hút khi tâm nằm trong phạm vi dọc tường (cho phép tràn nhẹ ra 2 đầu)
        if (along < -depth || along > len + depth) continue;
        const perp = rx * nx + ry * ny;
        const side = perp >= 0 ? 1 : -1;
        const rest = w.thickness / 2 + depth / 2; // khoảng cách tâm↔tim tường khi áp sát
        const gap = Math.abs(Math.abs(perp) - rest);
        if (gap < bestGap) {
            // hướng lưng phải chỉ về tường: local (0,-1) sau khi quay θ = (sinθ, -cosθ)
            const rot = Math.round(Math.atan2(-side * nx, side * ny) * 180 / Math.PI);
            const aln = Math.round(along / 10) * 10;
            bestGap = gap;
            best = {
                x: a.x + ux * aln + nx * side * rest,
                y: a.y + uy * aln + ny * side * rest,
                rot: ((rot % 360) + 360) % 360,
            };
        }
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
export function bboxOfPlan(plan, notes, furniture) {
    const xs = [];
    const ys = [];
    const push = (p) => {
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) { xs.push(p.x); ys.push(p.y); }
    };
    (plan?.nodes || []).forEach(push);
    (notes || []).forEach(n => push({ x: n.x, y: n.y }));
    // Nội thất: lấy bán kính bao (đủ cho mọi góc quay) quanh tâm
    (furniture || []).forEach(f => {
        const r = Math.hypot(f.w || 600, f.d || 600) / 2;
        push({ x: f.x - r, y: f.y - r });
        push({ x: f.x + r, y: f.y + r });
    });
    if (!xs.length) return null;
    const maxTh = plan?.walls?.length ? Math.max(...plan.walls.map(w => w.thickness || 0)) : 0;
    const pad = maxTh / 2 + 400;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
