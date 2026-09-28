import { genId, dist, polygonCentroid } from './geometry';

export const BOARD_DEFAULT_W = 1220;
export const BOARD_DEFAULT_H = 2440;

export const BOARD_MATERIALS = ['MDF', 'HDF', 'Plywood', 'Acrylic', 'Compact', 'Khác'];

export function defaultBoardCode() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `VAN-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${genId('').slice(-5).toUpperCase()}`;
}

function codePart(value) {
    return String(value || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0, 12) || 'NA';
}

export function standardBoardCode(board) {
    const bb = boardBounds(board);
    const material = codePart(board?.material || 'VAN');
    const thickness = Math.round(Number(board?.thickness || 0)) || 0;
    const color = codePart(board?.color || 'MAU');
    const location = codePart(board?.location || 'KHO');
    const w = Math.round(bb.width || BOARD_DEFAULT_W);
    const h = Math.round(bb.height || BOARD_DEFAULT_H);
    return `${material}${thickness}-${color}-${w}X${h}-${location}`;
}

export function rectOutline(w = BOARD_DEFAULT_W, h = BOARD_DEFAULT_H) {
    return [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
    ];
}

export function newBoardDoc(projectId, name) {
    const now = Date.now();
    const code = defaultBoardCode();
    return {
        id: genId('d'),
        projectId,
        type: 'board',
        name: name || code,
        board: {
            code,
            material: 'MDF',
            thickness: 18,
            color: 'Trắng',
            location: 'A1',
            grain: 'long',
            outline: [],
            notes: [],
            market: null,
        },
        settings: { gridSnap: true, gridMinor: 50, gridMajor: 500 },
        view: null,
        thumb: null,
        createdAt: now,
        updatedAt: now,
    };
}

export function boardBounds(board) {
    const pts = board?.outline || [];
    if (!pts.length) return { x: 0, y: 0, width: BOARD_DEFAULT_W, height: BOARD_DEFAULT_H };
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function boardArea(board) {
    const pts = board?.outline || [];
    if (pts.length < 3) return 0;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        s += p.x * q.y - q.x * p.y;
    }
    return Math.abs(s) / 2;
}

export function boardPerimeter(board) {
    const pts = board?.outline || [];
    let s = 0;
    for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length]);
    return s;
}

function inwardNormal(pts, idx) {
    const a = pts[idx];
    const b = pts[(idx + 1) % pts.length];
    const len = dist(a, b);
    if (!len) return { x: 0, y: 1 };
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const n1 = { x: -uy, y: ux };
    const n2 = { x: uy, y: -ux };
    const c = polygonCentroid(pts);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d1 = Math.hypot(mid.x + n1.x * 100 - c.x, mid.y + n1.y * 100 - c.y);
    const d2 = Math.hypot(mid.x + n2.x * 100 - c.x, mid.y + n2.y * 100 - c.y);
    return d1 < d2 ? n1 : n2;
}

export function insertZigzagNotch(board, edgeIdx, opts = {}) {
    const pts = board?.outline || [];
    if (pts.length < 3) return { board, warning: 'Chưa có biên ván' };
    const idx = ((edgeIdx % pts.length) + pts.length) % pts.length;
    const a = pts[idx];
    const b = pts[(idx + 1) % pts.length];
    const len = dist(a, b);
    if (len < 400) return { board, warning: 'Cạnh quá ngắn để thêm khuyết' };
    const offset = Math.min(opts.offset ?? 250, Math.max(50, len * 0.25));
    const width = Math.min(opts.width ?? 500, Math.max(100, len - offset - 80));
    const depth = opts.depth ?? 300;
    if (offset + width >= len) return { board, warning: 'Khuyết lớn hơn cạnh ván' };
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const n = inwardNormal(pts, idx);
    const at = (u, q = 0) => ({
        x: Math.round(a.x + ux * u + n.x * q),
        y: Math.round(a.y + uy * u + n.y * q),
    });
    const repl = [a, at(offset), at(offset, depth), at(offset + width, depth), at(offset + width), b];
    const next = [...pts.slice(0, idx), ...repl, ...pts.slice(idx + 2)];
    return { board: { ...board, outline: next }, warning: null };
}

export function resizeBoardSegment(board, segIdx, newLen) {
    const pts = board?.outline || [];
    if (pts.length < 2 || !(newLen > 0)) return { board, warning: null };
    const idx = ((segIdx % pts.length) + pts.length) % pts.length;
    if (idx === pts.length - 1) return { board, warning: 'Đoạn khép cuối nên sửa bằng các cạnh liền kề' };
    const a = pts[idx];
    const b = pts[idx + 1];
    const cur = dist(a, b);
    if (cur < 1) return { board, warning: null };
    const ux = (b.x - a.x) / cur;
    const uy = (b.y - a.y) / cur;
    const delta = newLen - cur;
    if (Math.abs(delta) < 0.5) return { board, warning: null };
    const next = pts.map((p, i) => i > idx
        ? { x: Math.round(p.x + ux * delta), y: Math.round(p.y + uy * delta) }
        : p);
    return { board: { ...board, outline: next }, warning: null };
}

export function moveBoardPoint(board, pointIdx, pos) {
    const pts = board?.outline || [];
    if (!pts[pointIdx]) return board;
    return { ...board, outline: pts.map((p, i) => i === pointIdx ? { ...p, ...pos } : p) };
}

export function makeBoardThumb(board) {
    const pts = board?.outline || [];
    if (pts.length < 3) return null;
    const bb = boardBounds(board);
    const pad = 60;
    const w = Math.max(1, bb.width + pad * 2);
    const h = Math.max(1, bb.height + pad * 2);
    const poly = pts.map(p => `${p.x - bb.x + pad},${p.y - bb.y + pad}`).join(' ');
    const label = `${board.code || 'Ván'} · ${board.location || ''}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#fff"/><polygon points="${poly}" fill="#f8fafc" stroke="#b71c1c" stroke-width="18" stroke-linejoin="round"/><text x="${pad}" y="${Math.max(40, pad - 12)}" font-family="Arial" font-size="90" fill="#334155">${label.replace(/[<&>"]/g, '')}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
