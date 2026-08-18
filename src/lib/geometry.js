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

// ===== Mặt đứng (khai triển tường) =====
// Chiều ngang tái dùng nguyên wallSegments/applySegmentLength ở trên.
// Chiều đứng soi gương đúng luật đó: chiều cao trần CỐ ĐỊNH, sửa một chặng thì
// phần lanh tô phía trên cửa bù — vì ngoài công trường KTS bắn 2 phát laser độc
// lập (bệ cửa và mép trên cửa), phần lên trần là phần không ai đo.

export const H_DEFAULT = 3200;      // thông thủy mặc định
export const SLAB_DEFAULT = 300;    // bề dày sàn/dầm vẽ trên trần
export const MIN_OPENING_H = 600;   // chiều cao ô cửa nhỏ nhất còn có nghĩa
// Đồ cách mặt trong tường xa hơn ngưỡng này thì không còn "thuộc" mặt tường đó —
// bằng bề rộng lối đi tối thiểu. Rộng hơn thì sofa giữa phòng lọt vào bản khai
// triển tường, chật hơn thì mất tủ kê hụt khỏi chân tường.
export const NEAR_WALL = 600;

/**
 * Cao độ ô cửa. Doc cũ không có sill/h vẫn ra số đúng nghiệp vụ.
 * `assumed` = đang là số suy đoán, chưa ai đo — UI phải phân biệt với số đã nhập.
 */
export function openingV(op, settings = {}) {
    const isDoor = op.type === 'door';
    const sill = Number.isFinite(op.sill) ? op.sill : (isDoor ? 0 : (settings.windowSill ?? 900));
    const h = Number.isFinite(op.h) ? op.h : (isDoor ? (settings.doorH ?? 2200) : (settings.windowH ?? 1400));
    return { sill, h, top: sill + h, assumed: !Number.isFinite(op.h) };
}

/** Chiều cao trần hiệu dụng của một mặt: ưu tiên số đã đo cho phòng đó. */
export function ceilingHeight(room, settings = {}) {
    return Number.isFinite(room?.h) ? room.h : (settings.ceilingH ?? H_DEFAULT);
}

/** Chuỗi cao độ của một ô cửa: bệ → ô cửa → lanh tô. Tổng luôn = H. */
export function openingVChain(op, H, settings) {
    const { sill, h } = openingV(op, settings);
    return [
        { kind: 'sill', len: sill },
        { kind: 'op', len: h },
        { kind: 'head', len: H - sill - h },
    ];
}

/**
 * Sửa một chặng cao độ của ô cửa. H cố định — 'head' (lanh tô) bù trước,
 * không đủ thì 'sill' bù. part: 'sill' | 'op' | 'head' | 'top' (cốt đỉnh cửa).
 */
export function applyOpeningVertical(plan, wallId, opId, part, value, H, settings) {
    const wall = plan.walls.find(w => w.id === wallId);
    if (!wall) return { plan, warning: null };
    const op = (wall.openings || []).find(o => o.id === opId);
    if (!op) return { plan, warning: null };
    if (value < 0) return { plan, warning: 'Số đo không hợp lệ' };

    const cur = openingV(op, settings);
    let sill = cur.sill;
    let h = cur.h;

    if (part === 'sill') {
        // Giữ chiều cao ô cửa, chỉ nâng/hạ cả ô — lanh tô tự co giãn.
        sill = value;
    } else if (part === 'top') {
        // Cốt đỉnh cửa: phép đo laser thứ hai. Giữ bệ, đổi chiều cao ô.
        h = value - sill;
    } else if (part === 'op') {
        h = value;
    } else if (part === 'head') {
        h = H - sill - value;
    } else {
        return { plan, warning: null };
    }

    if (h < MIN_OPENING_H) {
        return { plan, warning: `Ô cửa sẽ chỉ còn ${Math.round(h)}mm — tối thiểu ${MIN_OPENING_H}mm` };
    }
    if (sill < 0) return { plan, warning: 'Bệ cửa không thể âm' };
    if (sill + h > H) {
        return { plan, warning: `Vượt chiều cao trần ${Math.round(H)}mm — sửa chiều cao trần trước` };
    }

    const walls = plan.walls.map(w => w.id !== wallId ? w : {
        ...w,
        elev: true,
        openings: (w.openings || []).map(o => o.id !== opId
            ? o : { ...o, sill: Math.round(sill), h: Math.round(h) }),
    });
    return { plan: { ...plan, walls }, warning: null };
}

/**
 * Đặt chiều cao thông thủy cho một phòng. Chặn khi thấp hơn ô cửa cao nhất —
 * đối xứng với applyWallLength chặn tường ngắn hơn tổng bề rộng cửa.
 */
export function applyCeilingHeight(plan, roomId, H, settings) {
    if (!(H > 0)) return { plan, warning: 'Chiều cao không hợp lệ' };
    const room = (plan.rooms || []).find(r => r.id === roomId);
    if (!room) return { plan, warning: null };
    const nodeIds = new Set(room.nodeIds || []);
    let tallest = 0;
    let tallestName = '';
    for (const w of plan.walls) {
        if (!nodeIds.has(w.a) || !nodeIds.has(w.b)) continue;
        for (const op of (w.openings || [])) {
            const { top } = openingV(op, settings);
            if (top > tallest) { tallest = top; tallestName = op.type === 'door' ? 'cửa đi' : 'cửa sổ'; }
        }
    }
    if (tallest > H) {
        return { plan, warning: `Trần phải cao hơn đỉnh ${tallestName} (${Math.round(tallest)}mm)` };
    }
    const rooms = (plan.rooms || []).map(r => r.id === roomId ? { ...r, h: Math.round(H) } : r);
    return { plan: { ...plan, rooms }, warning: null };
}

/**
 * Khung chiếu của một mặt đứng: hệ toạ độ (u dọc tường, z cao độ) + phía đứng nhìn.
 * `side` = +1 khi người xem ở phía pháp tuyến n. `toU` lật trục khi đứng phía ngược
 * lại — thiếu phép lật này thì bản khai triển bị lật gương, cửa nhảy từ trái sang phải.
 */
export function wallFrame(plan, wallId, room) {
    const w = plan.walls.find(x => x.id === wallId);
    if (!w) return null;
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const a = nodeById.get(w.a);
    const b = nodeById.get(w.b);
    if (!a || !b) return null;
    const len = dist(a, b);
    if (len <= 0) return null;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const nx = -uy, ny = ux;
    const side = room && Number.isFinite(room.cx)
        ? (Math.sign((room.cx - a.x) * nx + (room.cy - a.y) * ny) || 1)
        : 1;
    return {
        wall: w, a, b, len, ux, uy, nx, ny, side,
        toU: (u) => side > 0 ? u : len - u,
    };
}

/**
 * Chiếu một món nội thất lên mặt đứng. Trả về null nếu món không thuộc mặt này.
 * `touching` = áp sát tường (vẽ nét liền); ngược lại đứng trước tường (nét đứt).
 */
export function projectItemOnWall(frame, item, size) {
    const { a, ux, uy, nx, ny, len, side, wall } = frame;
    const th = ((item.rot || 0) * Math.PI) / 180;
    const cs = Math.cos(th), sn = Math.sin(th);
    const hw = (size.w || 600) / 2, hd = (size.d || 600) / 2;
    const us = [], qs = [];
    for (const [lx, ly] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
        // khớp phép quay của Konva (y hướng xuống) — giống hệt dxf.js
        const px = item.x + lx * cs - ly * sn;
        const py = item.y + lx * sn + ly * cs;
        us.push((px - a.x) * ux + (py - a.y) * uy);
        qs.push(((px - a.x) * nx + (py - a.y) * ny) * side);
    }
    const u0 = Math.min(...us), u1 = Math.max(...us);
    const qNear = Math.min(...qs), qFar = Math.max(...qs);
    const half = (wall.thickness || 110) / 2;
    if (qFar < half - 50) return null;            // nằm bên kia tường
    if (qNear > half + NEAR_WALL) return null;    // quá xa, không thuộc mặt này
    if (u1 < 0 || u0 > len) return null;
    const gap = qNear - half;
    return {
        u0: side > 0 ? u0 : len - u1,
        u1: side > 0 ? u1 : len - u0,
        gap,
        touching: gap <= 50,
    };
}

/**
 * Các mặt của một phòng, đã sắp thứ tự đọc được: A = tường có cửa đi rộng nhất
 * (hoặc tường dài nhất), rồi quay theo chiều kim đồng hồ trên màn hình.
 */
export function roomFaces(plan, room) {
    if (!room?.nodeIds?.length) return [];
    const ids = room.nodeIds;
    const faces = [];
    for (let i = 0; i < ids.length; i++) {
        const a = ids[i], b = ids[(i + 1) % ids.length];
        const w = plan.walls.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
        if (!w || faces.some(f => f.wallId === w.id)) continue;
        // Cạnh cột không phải một mặt đứng riêng — trong hồ sơ nội thất nó là phần hồi
        // của mặt tường kề. Tính riêng thì sinh ra mặt "E, F" rộng 220mm, vô nghĩa.
        if (w.column) continue;
        const fr = wallFrame(plan, w.id, room);
        if (!fr) continue;
        const doorW = (w.openings || [])
            .filter(o => o.type === 'door')
            .reduce((m, o) => Math.max(m, o.width), 0);
        // góc hướng nhìn (từ phòng ra tường), mốc 0 = nhìn lên, quay thuận kim đồng hồ
        const vx = -fr.nx * fr.side, vy = -fr.ny * fr.side;
        faces.push({ wallId: w.id, len: fr.len, doorW, angle: (Math.atan2(vx, -vy) + 2 * Math.PI) % (2 * Math.PI) });
    }
    if (!faces.length) return [];
    faces.sort((p, r) => p.angle - r.angle);
    let start = faces.reduce((best, f, i) =>
        f.doorW > faces[best].doorW || (f.doorW === faces[best].doorW && f.len > faces[best].len) ? i : best, 0);
    const rotated = [...faces.slice(start), ...faces.slice(0, start)];
    return rotated.map((f, i) => ({ ...f, label: String.fromCharCode(65 + i) }));
}

/** Khung ảnh khi xuất một mặt đứng — chừa chỗ cho chuỗi kích thước và nhãn cốt. */
export function bboxOfElevation(len, H, slabT = SLAB_DEFAULT) {
    const pad = 900;
    return { x: -pad, y: -(H + slabT) - pad, width: len + pad * 2, height: H + slabT + pad * 2 };
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
    // Giữ `elev` sang cả hai nửa: chia một bức tường không làm mất công dựng mặt đứng
    // của nó — nếu mất, mặt đứng lặng lẽ biến khỏi bản xuất DXF.
    const wallA = {
        id: genId('w'), a: wall.a, b: newNodeId, thickness: wall.thickness, elev: wall.elev,
        openings: ops.filter(o => o.t <= tSplit).map(o => ({ ...o, t: o.t / tSplit })),
    };
    const wallB = {
        id: genId('w'), a: newNodeId, b: wall.b, thickness: wall.thickness, elev: wall.elev,
        openings: ops.filter(o => o.t > tSplit).map(o => ({ ...o, t: (o.t - tSplit) / (1 - tSplit) })),
    };
    const walls = plan.walls.filter(w => w.id !== wallId).concat([wallA, wallB]);
    return { plan: { ...plan, nodes: [...plan.nodes, newNode], walls }, newNodeId };
}

// ===== Cột kết cấu =====
// Vẽ tay ba cạnh của cột thì mỗi đỉnh là một lần chạm ngón tay, và tổng tường lệch —
// đo thực tế: tường 4000 thành 4201 sau khi khoét một hốc cột. Ở đây ô cột LUÔN sinh
// theo đúng trục của tường đang chạm, nên vuông góc là hệ quả của cấu trúc chứ không
// phải của độ chính xác ngón tay. Tường kề chỉ bị RÚT NGẮN, tim tường không xê dịch.

export const COLUMN_DEFAULT = 220;  // mm — tiết diện cột BTCT nhà phố phổ biến nhất
export const COLUMN_MIN = 80;
export const COLUMN_SNAP = 50;      // mm — bước làm tròn khi kéo

const snapCol = (v) => Math.max(COLUMN_MIN, Math.round(v / COLUMN_SNAP) * COLUMN_SNAP);

/**
 * Chỗ đặt cột gần `pt` nhất — ưu tiên GÓC phòng, sau đó tới thân tường.
 *   corner: { kind:'corner', nodeId, p, u1, u2, w1, w2, len1, len2 }
 *   wall:   { kind:'wall', wallId, t, p, u, n, len }
 * u1/u2 chạy dọc hai tường kề, hướng RA XA góc. `n` đã lật để trỏ vào trong phòng.
 */
export function columnTargetAt(plan, pt, tol) {
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const node = findNearbyNode(plan.nodes, pt, tol);
    if (node) {
        const around = plan.walls
            .filter(w => w.a === node.id || w.b === node.id)
            .map(w => {
                const other = nodeById.get(w.a === node.id ? w.b : w.a);
                const len = other ? dist(node, other) : 0;
                if (!other || len < 1) return null;
                return { wall: w, len, ux: (other.x - node.x) / len, uy: (other.y - node.y) / len };
            })
            .filter(Boolean);
        // Đúng HAI tường: node chữ T/chữ thập mà xoá đi thì tường thứ ba mồ côi.
        if (around.length === 2) {
            const [p, q] = around;
            // Hai tường thẳng hàng không phải góc — đó là chỗ nối, đặt cột kiểu góc ở đó vô nghĩa.
            if (Math.abs(p.ux * q.ux + p.uy * q.uy) < 0.4) {
                return {
                    kind: 'corner', nodeId: node.id, p: { x: node.x, y: node.y },
                    w1: p.wall, w2: q.wall, len1: p.len, len2: q.len,
                    u1: { x: p.ux, y: p.uy }, u2: { x: q.ux, y: q.uy },
                };
            }
        }
    }

    const hit = snapToWall(plan, pt, tol);
    if (!hit) return null;
    const wall = plan.walls.find(w => w.id === hit.wallId);
    const a = nodeById.get(wall.a), b = nodeById.get(wall.b);
    const len = dist(a, b);
    if (len < 1) return null;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let n = { x: -u.y, y: u.x };
    // Lật pháp tuyến về phía CÓ PHÒNG: cột kết cấu lộ vào trong nhà là ca chiếm đa số.
    const probe = { x: hit.x + n.x * 300, y: hit.y + n.y * 300 };
    const inside = (plan.rooms || []).some(r => {
        const pts = (r.nodeIds || []).map(id => nodeById.get(id)).filter(Boolean);
        return pts.length >= 3 && pointInPolygon(probe, pts);
    });
    if (!inside) n = { x: -n.x, y: -n.y };
    return { kind: 'wall', wallId: wall.id, t: hit.t, p: { x: hit.x, y: hit.y }, u, n, len };
}

/** Kích thước cột suy từ điểm đang kéo tới — đã làm tròn về bước COLUMN_SNAP. */
export function columnSizeFromDrag(target, pt) {
    const rx = pt.x - target.p.x, ry = pt.y - target.p.y;
    if (target.kind === 'corner') {
        return {
            a: snapCol(rx * target.u1.x + ry * target.u1.y),
            b: snapCol(rx * target.u2.x + ry * target.u2.y),
        };
    }
    return {
        // Cột giữa tường mọc đều hai bên điểm chạm → kéo một nửa, ăn cả hai.
        a: snapCol(Math.abs(rx * target.u.x + ry * target.u.y) * 2),
        b: snapCol(rx * target.n.x + ry * target.n.y),
    };
}

/** 4 đỉnh ô cột để vẽ preview. */
export function columnPolygon(target, a, b) {
    if (target.kind === 'corner') {
        const { p, u1, u2 } = target;
        return [
            { x: p.x, y: p.y },
            { x: p.x + u1.x * a, y: p.y + u1.y * a },
            { x: p.x + u1.x * a + u2.x * b, y: p.y + u1.y * a + u2.y * b },
            { x: p.x + u2.x * b, y: p.y + u2.y * b },
        ];
    }
    const { p, u, n } = target;
    const h = a / 2;
    const q1 = { x: p.x - u.x * h, y: p.y - u.y * h };
    const q2 = { x: p.x + u.x * h, y: p.y + u.y * h };
    return [q1, q2, { x: q2.x + n.x * b, y: q2.y + n.y * b }, { x: q1.x + n.x * b, y: q1.y + n.y * b }];
}

/** Rút ngắn tường ở đầu chạm `atNodeId` đi `cut` mm, nối vào node mới. */
function shortenWallEnd(wall, atNodeId, newNodeId, oldLen, cut) {
    const newLen = oldLen - cut;
    const atA = wall.a === atNodeId;
    const openings = (wall.openings || []).map(o => {
        const s = o.t * oldLen;              // vị trí tuyệt đối tính từ đầu `a` cũ
        const s2 = atA ? s - cut : s;
        return { ...o, t: Math.max(0.02, Math.min(0.98, s2 / newLen)) };
    });
    return { ...wall, a: atA ? newNodeId : wall.a, b: atA ? wall.b : newNodeId, openings };
}

/**
 * Cột ăn góc: bỏ đỉnh góc, thay bằng ba đỉnh tạo hốc chữ nhật a×b nằm gọn trong góc.
 * a đo dọc tường w1, b đo dọc tường w2. Trả về { plan, columnId } | { plan, error }.
 */
export function insertCornerColumn(plan, target, a, b) {
    const { nodeId, p, u1, u2, w1, w2, len1, len2 } = target;
    if (a < COLUMN_MIN || b < COLUMN_MIN) return { plan, error: `Cạnh cột tối thiểu ${COLUMN_MIN}mm` };
    if (a > len1 - COLUMN_MIN || b > len2 - COLUMN_MIN) {
        return { plan, error: 'Cột lớn hơn tường kề — giảm kích thước lại' };
    }
    const colId = genId('c');
    const n1 = { id: genId('n'), x: p.x + u1.x * a, y: p.y + u1.y * a };
    const n2 = { id: genId('n'), x: p.x + u2.x * b, y: p.y + u2.y * b };
    const nc = { id: genId('n'), x: p.x + u1.x * a + u2.x * b, y: p.y + u1.y * a + u2.y * b };
    const th = w1.thickness;
    const walls = plan.walls.map(w => {
        if (w.id === w1.id) return shortenWallEnd(w, nodeId, n1.id, len1, a);
        if (w.id === w2.id) return shortenWallEnd(w, nodeId, n2.id, len2, b);
        return w;
    }).concat([
        { id: genId('w'), a: n1.id, b: nc.id, thickness: th, openings: [], column: colId },
        { id: genId('w'), a: nc.id, b: n2.id, thickness: th, openings: [], column: colId },
    ]);
    const nodes = plan.nodes.filter(n => n.id !== nodeId).concat([n1, nc, n2]);
    return { plan: { ...plan, nodes, walls }, columnId: colId };
}

/**
 * Cột giữa tường: chèn bướu a (dọc tường) × b (vuông góc). Tường gốc tách thành năm đoạn.
 * Cửa nằm lọt trong phạm vi cột bị bỏ — cột không thể đè lên ô cửa.
 */
export function insertWallColumn(plan, target, a, b) {
    const { wallId, t, u, n, len } = target;
    if (a < COLUMN_MIN || b < COLUMN_MIN) return { plan, error: `Cạnh cột tối thiểu ${COLUMN_MIN}mm` };
    const wall = plan.walls.find(w => w.id === wallId);
    if (!wall) return { plan, error: 'Không tìm thấy tường' };
    const nodeById = new Map(plan.nodes.map(x => [x.id, x]));
    const A = nodeById.get(wall.a);
    const s = t * len, s1 = s - a / 2, s2 = s + a / 2;
    if (s1 < COLUMN_MIN || s2 > len - COLUMN_MIN) {
        return { plan, error: 'Cột chạm vào góc — kéo vào giữa tường hoặc thu bề rộng' };
    }
    const colId = genId('c');
    const at = (d) => ({ x: A.x + u.x * d, y: A.y + u.y * d });
    const m1 = { id: genId('n'), ...at(s1) };
    const m2 = { id: genId('n'), ...at(s2) };
    const c1 = { id: genId('n'), x: m1.x + n.x * b, y: m1.y + n.y * b };
    const c2 = { id: genId('n'), x: m2.x + n.x * b, y: m2.y + n.y * b };

    const keepA = [], keepB = [];
    let dropped = 0;
    for (const o of wall.openings || []) {
        const os = o.t * len;
        if (os < s1) keepA.push({ ...o, t: Math.min(0.98, os / s1) });
        else if (os > s2) keepB.push({ ...o, t: Math.max(0.02, (os - s2) / (len - s2)) });
        else dropped++;
    }

    const seg = (na, nb, openings, col) => ({
        id: genId('w'), a: na, b: nb, thickness: wall.thickness, elev: wall.elev,
        openings: openings || [], ...(col ? { column: colId } : {}),
    });
    const walls = plan.walls.filter(w => w.id !== wallId).concat([
        seg(wall.a, m1.id, keepA),
        seg(m1.id, c1.id, [], true),
        seg(c1.id, c2.id, [], true),
        seg(c2.id, m2.id, [], true),
        seg(m2.id, wall.b, keepB),
    ]);
    return {
        plan: { ...plan, nodes: [...plan.nodes, m1, c1, c2, m2], walls },
        columnId: colId, droppedOpenings: dropped,
    };
}

/**
 * Đọc lại hình dạng cột TỪ CHÍNH các node của nó, không giữ bản ghi song song.
 * Bản ghi song song sẽ lệch ngay khi ai đó kéo tay một đỉnh; suy ngược thì luôn khớp
 * với thứ đang hiển thị. Trả về { kind, a, b, ... } hoặc null.
 */
export function columnParts(plan, columnId) {
    const cw = plan.walls.filter(w => w.column === columnId);
    if (!cw.length) return null;
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const deg = new Map();
    for (const w of cw) {
        deg.set(w.a, (deg.get(w.a) || 0) + 1);
        deg.set(w.b, (deg.get(w.b) || 0) + 1);
    }
    const ends = [...deg].filter(([, d]) => d === 1).map(([id]) => id);
    if (ends.length !== 2) return null;

    if (cw.length === 2) {
        // Góc: hai đoạn n1–nc, nc–n2. Đỉnh góc cũ suy ra bằng n1 + n2 − nc.
        const ncId = [...deg].find(([, d]) => d === 2)?.[0];
        const n1 = nodeById.get(ends[0]), n2 = nodeById.get(ends[1]), nc = nodeById.get(ncId);
        if (!n1 || !n2 || !nc) return null;
        const p = { x: n1.x + n2.x - nc.x, y: n1.y + n2.y - nc.y };
        const a = dist(p, n1), b = dist(p, n2);
        if (a < 1 || b < 1) return null;
        return {
            kind: 'corner', a, b, p, ids: { n1: n1.id, nc: nc.id, n2: n2.id },
            u1: { x: (n1.x - p.x) / a, y: (n1.y - p.y) / a },
            u2: { x: (n2.x - p.x) / b, y: (n2.y - p.y) / b },
        };
    }
    if (cw.length === 3) {
        // Giữa tường: chuỗi m1–c1–c2–m2. m1/m2 là hai đầu bậc 1.
        const m1 = nodeById.get(ends[0]), m2 = nodeById.get(ends[1]);
        const c1Id = cw.find(w => w.a === m1.id || w.b === m1.id);
        const c2Id = cw.find(w => w.a === m2.id || w.b === m2.id);
        const c1 = nodeById.get(c1Id.a === m1.id ? c1Id.b : c1Id.a);
        const c2 = nodeById.get(c2Id.a === m2.id ? c2Id.b : c2Id.a);
        if (!c1 || !c2) return null;
        const a = dist(m1, m2), b = dist(m1, c1);
        if (a < 1 || b < 1) return null;
        return {
            kind: 'wall', a, b, ids: { m1: m1.id, c1: c1.id, c2: c2.id, m2: m2.id },
            mid: { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 },
            u: { x: (m2.x - m1.x) / a, y: (m2.y - m1.y) / a },
            n: { x: (c1.x - m1.x) / b, y: (c1.y - m1.y) / b },
        };
    }
    return null;
}

/**
 * Đổi kích thước cột đã đặt — chỉ dời node, không đụng tường, nên góc vẫn vuông tuyệt đối
 * và các số đo đã nhập tay ở chỗ khác không bị động vào.
 */
export function resizeColumn(plan, columnId, a, b) {
    const c = columnParts(plan, columnId);
    if (!c) return { plan, error: 'Không đọc được hình dạng cột' };
    if (a < COLUMN_MIN || b < COLUMN_MIN) return { plan, error: `Cạnh cột tối thiểu ${COLUMN_MIN}mm` };
    const move = new Map();
    if (c.kind === 'corner') {
        const { p, u1, u2, ids } = c;
        move.set(ids.n1, { x: p.x + u1.x * a, y: p.y + u1.y * a });
        move.set(ids.n2, { x: p.x + u2.x * b, y: p.y + u2.y * b });
        move.set(ids.nc, { x: p.x + u1.x * a + u2.x * b, y: p.y + u1.y * a + u2.y * b });
    } else {
        const { mid, u, n, ids } = c;
        const h = a / 2;
        const m1 = { x: mid.x - u.x * h, y: mid.y - u.y * h };
        const m2 = { x: mid.x + u.x * h, y: mid.y + u.y * h };
        move.set(ids.m1, m1);
        move.set(ids.m2, m2);
        move.set(ids.c1, { x: m1.x + n.x * b, y: m1.y + n.y * b });
        move.set(ids.c2, { x: m2.x + n.x * b, y: m2.y + n.y * b });
    }
    const nodes = plan.nodes.map(nd => move.has(nd.id) ? { ...nd, ...move.get(nd.id) } : nd);
    return { plan: { ...plan, nodes }, error: null };
}

/**
 * Gỡ cột: trả tường về nguyên trạng trước khi khoét. Có hàm này thì cột mới là thứ
 * sửa được — không có, đặt nhầm mà lỡ tay đóng app là mắc kẹt vĩnh viễn với hốc sai.
 */
export function removeColumn(plan, columnId) {
    const c = columnParts(plan, columnId);
    if (!c) return { plan, error: 'Không đọc được hình dạng cột' };
    const colIds = new Set(plan.walls.filter(w => w.column === columnId).map(w => w.id));
    const rest = plan.walls.filter(w => !colIds.has(w.id));
    const nb = new Map(plan.nodes.map(n => [n.id, n]));

    if (c.kind === 'corner') {
        const apex = { id: genId('n'), x: c.p.x, y: c.p.y };
        // cut âm = kéo dài lại đúng phần đã cắt, cửa dịch theo đúng khoảng đó
        const walls = rest.map(w => {
            if (w.a === c.ids.n1 || w.b === c.ids.n1) {
                const other = nb.get(w.a === c.ids.n1 ? w.b : w.a);
                return shortenWallEnd(w, c.ids.n1, apex.id, dist(nb.get(c.ids.n1), other), -c.a);
            }
            if (w.a === c.ids.n2 || w.b === c.ids.n2) {
                const other = nb.get(w.a === c.ids.n2 ? w.b : w.a);
                return shortenWallEnd(w, c.ids.n2, apex.id, dist(nb.get(c.ids.n2), other), -c.b);
            }
            return w;
        });
        const drop = new Set([c.ids.n1, c.ids.nc, c.ids.n2]);
        return {
            plan: { ...plan, nodes: plan.nodes.filter(n => !drop.has(n.id)).concat([apex]), walls },
            error: null,
        };
    }

    // Giữa tường: hàn hai nửa còn lại thành một tường liền.
    const segA = rest.find(w => w.a === c.ids.m1 || w.b === c.ids.m1);
    const segB = rest.find(w => w.a === c.ids.m2 || w.b === c.ids.m2);
    if (!segA || !segB) return { plan, error: 'Cột không còn nối vào tường nào' };
    const endA = segA.a === c.ids.m1 ? segA.b : segA.a;
    const endB = segB.a === c.ids.m2 ? segB.b : segB.a;
    const pA = nb.get(endA), pB = nb.get(endB);
    const lenA = dist(pA, nb.get(c.ids.m1));
    const lenB = dist(nb.get(c.ids.m2), pB);
    const total = lenA + c.a + lenB;
    const ops = [];
    for (const o of segA.openings || []) {
        const s = segA.a === endA ? o.t * lenA : (1 - o.t) * lenA;   // khoảng cách từ endA
        ops.push({ ...o, t: s / total });
    }
    for (const o of segB.openings || []) {
        const s = segB.a === c.ids.m2 ? o.t * lenB : (1 - o.t) * lenB; // khoảng cách từ m2
        ops.push({ ...o, t: (lenA + c.a + s) / total });
    }
    const merged = {
        id: genId('w'), a: endA, b: endB,
        thickness: segA.thickness, elev: segA.elev || segB.elev, openings: ops,
    };
    const drop = new Set([c.ids.m1, c.ids.c1, c.ids.c2, c.ids.m2]);
    return {
        plan: {
            ...plan,
            nodes: plan.nodes.filter(n => !drop.has(n.id)),
            walls: rest.filter(w => w.id !== segA.id && w.id !== segB.id).concat([merged]),
        },
        error: null,
    };
}

/** Tất cả cột đang có trong plan, kèm kích thước đọc ngược từ node. */
export function listColumns(plan) {
    const ids = [...new Set(plan.walls.filter(w => w.column).map(w => w.column))];
    return ids.map(id => ({ id, ...columnParts(plan, id) })).filter(c => c.kind);
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
