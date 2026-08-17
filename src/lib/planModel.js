// Immutable mutations on plan data + doc/project factories.
import { genId, detectRooms, shoelaceArea, polygonPerimeter, pointInPolygon, labelPoint } from './geometry';

// ===== Factories =====
export function newProject(name) {
    const now = Date.now();
    // Mặc định 'team': cả team MKG xem và sửa được, khớp cách làm production ở Labs.
    // Muốn giữ riêng thì đổi phạm vi trong menu dự án. Dự án CHƯA có trường scope cũng
    // được coi là 'team' (xem SCOPE_DEFAULT trong pb.js) nên dữ liệu cũ tự vào team.
    // ownerId do App gán sau khi biết tài khoản đang đăng nhập.
    return { id: genId('p'), name, scope: 'team', createdAt: now, updatedAt: now };
}

export function newPlanDoc(projectId, name) {
    const now = Date.now();
    return {
        id: genId('d'),
        projectId,
        type: 'plan',
        name,
        plan: { nodes: [], walls: [], rooms: [], calibrated: false },
        notes: [],
        furniture: [],
        settings: {
            thickness: 110, ortho: true, gridSnap: true, gridMinor: 100, gridMajor: 1000,
            doorWidth: 900, windowWidth: 1200, furnitureDefaults: {},
        },
        view: null, // computed on first open
        thumb: null,
        createdAt: now,
        updatedAt: now,
    };
}

export function newPhotoDoc(projectId, name, photo) {
    const now = Date.now();
    return {
        id: genId('d'),
        projectId,
        type: 'photo',
        name,
        img: photo.base64,
        photoHash: photo.hash, // để sync biết ảnh có đổi hay không, khỏi upload lại
        w: photo.w,
        h: photo.h,
        thumb: photo.thumb,
        lines: [],
        notes: [],
        ratio: null,
        view: null,
        createdAt: now,
        updatedAt: now,
    };
}

// ===== Wall graph mutations =====
/**
 * Add a wall segment between two anchors ({ nodeId|null, x, y }).
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
    const wall = { id: genId('w'), a: from.id, b: to.id, thickness, openings: [] };
    return {
        plan: { ...plan, nodes, walls: [...plan.walls, wall] },
        startNodeId: from.id,
        endNodeId: to.id,
        closed: to.existed,
        added: true,
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
 * Re-detect rooms from geometry, preserving user-given names
 * (match by node-id key first, then by old label point inside new polygon).
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
            // Chiều cao thông thủy là số ĐO TAY — recompute chạy sau mỗi lần sửa tường,
            // không giữ lại thì sửa một bức tường là mất trắng số đã đo.
            h: old?.h,
            key,
            nodeIds: f.nodeIds,
            area: Math.abs(shoelaceArea(f.pts)),
            perimeter: polygonPerimeter(f.pts),
            cx: lp.x,
            cy: lp.y,
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

// ===== Openings (doors/windows) =====
// wall.openings = [{ id, type:'door'|'window', t:0..1, width, flipped }]
/**
 * Chèn template phòng: góc trên-trái bbox của template đặt tại `at`.
 * Node mới nằm trong `tol` mm của node có sẵn → dùng lại node cũ, và tường trùng
 * thì bỏ qua — nhờ vậy chèn phòng cạnh phòng cũ sẽ dùng chung tường, không đè 2 lớp.
 */
export function insertTemplate(plan, tpl, at, thickness, tol = 150) {
    const idMap = new Map();
    const nodes = [...plan.nodes];
    for (const tn of tpl.nodes) {
        const p = { x: Math.round(at.x + tn.x), y: Math.round(at.y + tn.y) };
        const hit = nodes.find(n => Math.hypot(n.x - p.x, n.y - p.y) <= tol);
        if (hit) {
            idMap.set(tn.id, hit.id);
        } else {
            const nid = genId('n');
            nodes.push({ id: nid, x: p.x, y: p.y });
            idMap.set(tn.id, nid);
        }
    }
    const walls = [...plan.walls];
    let added = 0;
    let shared = 0;
    for (const tw of tpl.walls) {
        const a = idMap.get(tw.a);
        const b = idMap.get(tw.b);
        if (!a || !b || a === b) continue;
        if (walls.some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a))) { shared++; continue; }
        walls.push({ id: genId('w'), a, b, thickness, openings: [] });
        added++;
    }
    return { plan: { ...plan, nodes, walls }, added, shared };
}

export function addOpening(plan, wallId, t, type, width) {
    const openingId = genId('op');
    const walls = plan.walls.map(w => {
        if (w.id !== wallId) return w;
        return { ...w, openings: [...(w.openings || []), { id: openingId, type, t, width, flipped: false }] };
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
