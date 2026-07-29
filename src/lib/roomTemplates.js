// Template phòng — lưu nodes + walls TƯƠNG ĐỐI (gốc 0,0 ở góc trên-trái bbox).
// Nhờ vậy lưu được cả phòng chữ nhật preset và phòng bất kỳ đã vẽ (L, vát góc).
import localforage from 'localforage';
import { genId } from './geometry';

const KEY = 'room_templates';

/** Sinh template chữ nhật W×D với node/wall tương đối. */
function rect(name, w, d) {
    const n = ['n0', 'n1', 'n2', 'n3'];
    return {
        id: `builtin_${name.replace(/\s+/g, '_')}`,
        name,
        builtin: true,
        w, d,
        nodes: [
            { id: n[0], x: 0, y: 0 },
            { id: n[1], x: w, y: 0 },
            { id: n[2], x: w, y: d },
            { id: n[3], x: 0, y: d },
        ],
        walls: [
            { a: n[0], b: n[1] },
            { a: n[1], b: n[2] },
            { a: n[2], b: n[3] },
            { a: n[3], b: n[0] },
        ],
    };
}

export const BUILTIN_TEMPLATES = [
    rect('Ngủ master', 4000, 4500),
    rect('Ngủ nhỏ', 3000, 3600),
    rect('WC', 1800, 2400),
    rect('Bếp', 3000, 3600),
    rect('Khách', 4500, 5000),
    rect('Ban công', 1500, 3000),
];

export async function loadTemplates() {
    const custom = (await localforage.getItem(KEY)) || [];
    return [...BUILTIN_TEMPLATES, ...custom];
}

export async function loadCustomTemplates() {
    return (await localforage.getItem(KEY)) || [];
}

/**
 * Lưu template từ một room đã vẽ.
 * room = { nodeIds }, plan dùng để lấy toạ độ node + độ dày tường.
 */
export async function saveTemplateFromRoom(name, plan, room) {
    const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
    const pts = (room.nodeIds || []).map(id => nodeById.get(id)).filter(Boolean);
    if (pts.length < 3) throw new Error('Phòng không đủ điểm để lưu');

    const minX = Math.min(...pts.map(p => p.x));
    const minY = Math.min(...pts.map(p => p.y));
    const maxX = Math.max(...pts.map(p => p.x));
    const maxY = Math.max(...pts.map(p => p.y));

    // đổi tên node sang id cục bộ, toạ độ về gốc 0,0
    const idMap = new Map();
    const nodes = pts.map((p, i) => {
        const local = `n${i}`;
        idMap.set(p.id, local);
        return { id: local, x: Math.round(p.x - minX), y: Math.round(p.y - minY) };
    });
    // chu tuyến theo đúng thứ tự nodeIds của room (face-walk đã sắp vòng)
    const walls = nodes.map((n, i) => ({ a: n.id, b: nodes[(i + 1) % nodes.length].id }));

    const tpl = {
        id: genId('tpl'),
        name,
        builtin: false,
        w: Math.round(maxX - minX),
        d: Math.round(maxY - minY),
        nodes,
        walls,
        createdAt: Date.now(),
    };
    const custom = await loadCustomTemplates();
    await localforage.setItem(KEY, [tpl, ...custom]);
    return tpl;
}

export async function deleteTemplate(id) {
    const custom = await loadCustomTemplates();
    await localforage.setItem(KEY, custom.filter(t => t.id !== id));
}
