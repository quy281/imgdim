// Hand-written DXF R12 (AC1009) ASCII generator — zero dependencies.
// Coordinates in real millimeters. Screen y points down, DXF y up -> emit y' = -y.
// R12 has no Unicode: non-ASCII escaped as \U+XXXX (AutoCAD reads this).
import {
    dist, bboxOfPlan, wallSegments, wallFrame, openingV, ceilingHeight,
    roomFaces, projectItemOnWall, SLAB_DEFAULT,
} from './geometry';
import { catalogItem, resolveZ } from './furnitureCatalog';

const LAYERS = [
    { name: 'WALL', color: 7 },
    { name: 'DIM', color: 3 },
    { name: 'TEXT', color: 2 },
    { name: 'ROOM', color: 4 },
    { name: 'DOOR', color: 1 },
    { name: 'WINDOW', color: 5 },
    { name: 'FURNITURE', color: 8 },
    { name: 'ELEV', color: 7 },
    { name: 'ELEV-DOOR', color: 1 },
    { name: 'ELEV-WINDOW', color: 5 },
    { name: 'ELEV-FURN', color: 8 },
    { name: 'ELEV-DIM', color: 3 },
    { name: 'ELEV-LEVEL', color: 6 },
    { name: 'ELEV-TEXT', color: 2 },
];

// Bỏ dấu tiếng Việt cho chữ trong DXF. `dxfEscape` đã sinh \U+XXXX đúng chuẩn
// AutoCAD, nhưng BricsCAD và các viewer cũ hay ra ô vuông — theo đúng lối đã
// dùng sẵn trong file này ('Don vi: mm').
export function asciiFold(str) {
    return String(str)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/**
 * Các mặt đứng cần xuất: chỉ tường KTS đã thật sự dựng (wall.elev), gom theo phòng.
 * Trả về đủ dữ liệu để vẽ, không cần đụng lại plan.
 */
export function elevationFaces(doc) {
    const plan = doc?.plan;
    if (!plan?.walls?.length) return [];
    const settings = doc.settings || {};
    const slabT = settings.slabT ?? SLAB_DEFAULT;
    const out = [];
    for (const room of (plan.rooms || [])) {
        const H = ceilingHeight(room, settings);
        for (const f of roomFaces(plan, room)) {
            const wall = plan.walls.find(w => w.id === f.wallId);
            if (!wall?.elev) continue; // chưa dựng thì không đoán hộ
            const frame = wallFrame(plan, f.wallId, room);
            if (!frame) continue;
            const items = [];
            for (const it of (doc.furniture || [])) {
                const cat = catalogItem(it.kind);
                const pr = projectItemOnWall(frame, it, {
                    w: it.w || cat?.w || 600, d: it.d || cat?.d || 600,
                });
                if (!pr) continue;
                items.push({
                    ...pr, name: cat?.name || 'Noi that',
                    h: it.h ?? cat?.h ?? 800, z: resolveZ(it, cat, H),
                });
            }
            out.push({
                label: f.label, roomName: room.name, wall, frame, items,
                len: frame.len, H, slabT, settings,
            });
        }
    }
    return out;
}

const num = (v) => {
    const r = Math.round(v * 100) / 100;
    return Object.is(r, -0) ? '0' : String(r);
};

function dxfEscape(str) {
    let out = '';
    for (const ch of String(str)) {
        const code = ch.codePointAt(0);
        if (code >= 32 && code < 127) out += ch;
        else out += '\\U+' + code.toString(16).toUpperCase().padStart(4, '0');
    }
    return out;
}

const normDeg = (d) => ((d % 360) + 360) % 360;

export function generateDxf(doc) {
    const t = [];
    const tag = (code, value) => { t.push(String(code), String(value)); };

    const bb = bboxOfPlan(doc.plan, doc.notes, doc.furniture) || { x: 0, y: 0, width: 10000, height: 8000 };

    // Khung bản vẽ phải bao CẢ mặt đứng — thiếu thì Zoom Extents trong AutoCAD
    // bỏ sót, KTS mở file tưởng chưa xuất mặt đứng.
    const faces = elevationFaces(doc);
    const GAP = 3500, PITCH = 2500;
    const baseY = bb.y + bb.height + GAP;
    const elevW = faces.reduce((s, f) => s + f.len + PITCH, 0);
    const elevTop = faces.reduce((m, f) => Math.max(m, f.H + f.slabT), 0);
    const scrMinX = bb.x;
    const scrMaxX = faces.length ? Math.max(bb.x + bb.width, bb.x + elevW) : bb.x + bb.width;
    const scrMinY = faces.length ? Math.min(bb.y, baseY - elevTop - 1000) : bb.y;
    const scrMaxY = faces.length ? baseY + 1800 : bb.y + bb.height;
    const extMin = { x: scrMinX, y: -scrMaxY };
    const extMax = { x: scrMaxX, y: -scrMinY };

    // === HEADER ===
    tag(0, 'SECTION'); tag(2, 'HEADER');
    tag(9, '$ACADVER'); tag(1, 'AC1009');
    tag(9, '$EXTMIN'); tag(10, num(extMin.x)); tag(20, num(extMin.y)); tag(30, '0.0');
    tag(9, '$EXTMAX'); tag(10, num(extMax.x)); tag(20, num(extMax.y)); tag(30, '0.0');
    tag(0, 'ENDSEC');

    // === TABLES ===
    tag(0, 'SECTION'); tag(2, 'TABLES');
    tag(0, 'TABLE'); tag(2, 'LTYPE'); tag(70, 1);
    tag(0, 'LTYPE'); tag(2, 'CONTINUOUS'); tag(70, 0); tag(3, 'Solid line'); tag(72, 65); tag(73, 0); tag(40, '0.0');
    tag(0, 'ENDTAB');
    tag(0, 'TABLE'); tag(2, 'LAYER'); tag(70, LAYERS.length);
    for (const l of LAYERS) {
        tag(0, 'LAYER'); tag(2, l.name); tag(70, 0); tag(62, l.color); tag(6, 'CONTINUOUS');
    }
    tag(0, 'ENDTAB');
    tag(0, 'ENDSEC');

    // === ENTITIES ===
    tag(0, 'SECTION'); tag(2, 'ENTITIES');

    const line = (layer, p1, p2) => {
        tag(0, 'LINE'); tag(8, layer);
        tag(10, num(p1.x)); tag(20, num(-p1.y)); tag(30, '0.0');
        tag(11, num(p2.x)); tag(21, num(-p2.y)); tag(31, '0.0');
    };
    const text = (layer, p, height, content) => {
        tag(0, 'TEXT'); tag(8, layer);
        tag(10, num(p.x)); tag(20, num(-p.y)); tag(30, '0.0');
        tag(40, num(height)); tag(1, dxfEscape(content));
    };
    const arc = (layer, center, r, a1, a2) => {
        tag(0, 'ARC'); tag(8, layer);
        tag(10, num(center.x)); tag(20, num(-center.y)); tag(30, '0.0');
        tag(40, num(r)); tag(50, num(normDeg(a1))); tag(51, num(normDeg(a2)));
    };
    const closedPolyline = (layer, pts) => {
        tag(0, 'POLYLINE'); tag(8, layer); tag(66, 1); tag(70, 1);
        for (const p of pts) {
            tag(0, 'VERTEX'); tag(8, layer);
            tag(10, num(p.x)); tag(20, num(-p.y)); tag(30, '0.0');
        }
        tag(0, 'SEQEND');
    };

    const plan = doc.plan;
    if (plan) {
        const nodeById = new Map(plan.nodes.map(n => [n.id, n]));
        for (const w of plan.walls) {
            const a = nodeById.get(w.a);
            const b = nodeById.get(w.b);
            if (!a || !b) continue;
            line('WALL', a, b);
            const len = dist(a, b);
            if (len > 0) {
                const nx = -(b.y - a.y) / len;
                const ny = (b.x - a.x) / len;
                const off = w.thickness / 2 + 180;
                const mid = { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off };
                text('DIM', mid, 150, String(Math.round(len)));

                // Openings: span line + symbol
                const ux = (b.x - a.x) / len;
                const uy = (b.y - a.y) / len;
                const thetaScreenDeg = Math.atan2(uy, ux) * 180 / Math.PI;
                for (const op of (w.openings || [])) {
                    const cx = a.x + op.t * (b.x - a.x);
                    const cy = a.y + op.t * (b.y - a.y);
                    const hw = op.width / 2;
                    const p1 = { x: cx - hw * ux, y: cy - hw * uy };
                    const p2 = { x: cx + hw * ux, y: cy + hw * uy };
                    if (op.type === 'door') {
                        line('DOOR', p1, p2);
                        // Screen arc sweeps [start, start+90] clockwise-on-screen (y-down positive).
                        // Mirroring to DXF (y-up) reverses orientation: CCW from -(start+90) to -start.
                        const startScreen = thetaScreenDeg + (op.flipped ? -90 : 0);
                        arc('DOOR', p1, op.width, -(startScreen + 90), -startScreen);
                        text('DOOR', { x: cx, y: cy - 120 }, 120, `D${Math.round(op.width)}`);
                    } else {
                        const h = w.thickness / 2;
                        const nx2 = -uy, ny2 = ux;
                        line('WINDOW', { x: p1.x + nx2 * h * 0.6, y: p1.y + ny2 * h * 0.6 }, { x: p2.x + nx2 * h * 0.6, y: p2.y + ny2 * h * 0.6 });
                        line('WINDOW', { x: p1.x - nx2 * h * 0.6, y: p1.y - ny2 * h * 0.6 }, { x: p2.x - nx2 * h * 0.6, y: p2.y - ny2 * h * 0.6 });
                        line('WINDOW', p1, p2);
                        text('WINDOW', { x: cx, y: cy - 120 }, 120, `W${Math.round(op.width)}`);
                    }
                }
            }
        }
        for (const r of (plan.rooms || [])) {
            text('ROOM', { x: r.cx, y: r.cy }, 250, r.name);
            text('ROOM', { x: r.cx, y: r.cy + 350 }, 180, `${(r.area / 1e6).toFixed(1)} m2 - ${(r.perimeter / 1000).toFixed(1)} m`);
        }
    }
    // Nội thất: hình chữ nhật đã quay + tên (layer FURNITURE để KTS tắt/mở riêng)
    for (const f of (doc.furniture || [])) {
        const cat = catalogItem(f.kind);
        const w = f.w || cat?.w || 600;
        const d = f.d || cat?.d || 600;
        const th = ((f.rot || 0) * Math.PI) / 180;
        const cos = Math.cos(th), sin = Math.sin(th);
        // local (lx,ly) -> world: khớp phép quay của Konva (y hướng xuống)
        const pt = (lx, ly) => ({ x: f.x + lx * cos - ly * sin, y: f.y + lx * sin + ly * cos });
        const hw = w / 2, hd = d / 2;
        closedPolyline('FURNITURE', [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)]);
        // vạch lưng dày (mặt áp tường)
        if (cat?.back) line('FURNITURE', pt(-hw, -hd), pt(hw, -hd));
        if (cat?.name) text('FURNITURE', { x: f.x - hw * 0.8, y: f.y }, 110, cat.name);
    }

    // ===== Khai triển tường (mặt đứng) =====
    // Xếp thành hàng ngang DƯỚI mặt bằng, cốt ±0.000 của mọi mặt nằm trên cùng một
    // đường — đúng cách trình bày hồ sơ kiến trúc. Toạ độ ở đây là toạ độ MÀN HÌNH
    // (y xuống), các helper line/text tự lật sang hệ DXF y-lên.
    if (faces.length) {
        let ox = bb.x;
        for (const f of faces) {
            const E = (u, z) => ({ x: ox + u, y: baseY - z });
            const { len, H, slabT, wall, frame, settings } = f;

            closedPolyline('ELEV', [E(0, 0), E(len, 0), E(len, H), E(0, H)]);
            closedPolyline('ELEV', [E(0, H), E(len, H), E(len, H + slabT), E(0, H + slabT)]);
            line('ELEV', E(-250, 0), E(len + 250, 0)); // đường sàn kéo dài

            for (const s of wallSegments(wall, len)) {
                if (s.kind !== 'op') continue;
                const op = (wall.openings || []).find(o => o.id === s.opId);
                if (!op) continue;
                const { sill, h, top } = openingV(op, settings);
                const ua = frame.toU(s.from), ub = frame.toU(s.to);
                const x0 = Math.min(ua, ub), x1 = Math.max(ua, ub);
                const layer = op.type === 'door' ? 'ELEV-DOOR' : 'ELEV-WINDOW';
                closedPolyline(layer, [E(x0, sill), E(x1, sill), E(x1, top), E(x0, top)]);
                if (op.type === 'window') {
                    line(layer, E(x0, sill + h / 2), E(x1, sill + h / 2));
                }
                text('ELEV-DIM', E((x0 + x1) / 2 - 200, top + 120), 120, `+${Math.round(top)}`);
                text('ELEV-DIM', E((x0 + x1) / 2 - 150, sill + h / 2), 120, String(Math.round(h)));
                if (sill > 0) text('ELEV-DIM', E((x0 + x1) / 2 - 150, sill / 2), 120, String(Math.round(sill)));
            }

            for (const it of f.items) {
                const x0 = Math.min(it.u0, it.u1), x1 = Math.max(it.u0, it.u1);
                closedPolyline('ELEV-FURN', [E(x0, it.z), E(x1, it.z), E(x1, it.z + it.h), E(x0, it.z + it.h)]);
                text('ELEV-FURN', E(x0 + 60, it.z + it.h / 2), 110, `${asciiFold(it.name)} +${Math.round(it.z)}`);
            }

            // chuỗi kích thước ngang
            for (const s of wallSegments(wall, len)) {
                if (s.len < 1) continue;
                const ua = frame.toU(s.from), ub = frame.toU(s.to);
                text('ELEV-DIM', E((ua + ub) / 2 - 150, -350), 130, String(Math.round(s.len)));
            }
            text('ELEV-DIM', E(len / 2 - 200, -750), 160, String(Math.round(len)));
            text('ELEV-LEVEL', E(-250, -180), 130, '+-0.000');
            text('ELEV-LEVEL', E(len + 60, H), 130, `+${(H / 1000).toFixed(3)}`);
            text('ELEV-TEXT', E(0, -1250), 220,
                `KHAI TRIEN ${f.label}${f.roomName ? ' - ' + asciiFold(f.roomName) : ''}`);

            ox += len + PITCH;
        }
    }

    for (const n of (doc.notes || [])) {
        const items = n.items || (n.text ? [{ text: n.text, done: false }] : []);
        items.forEach((it, i) => {
            text('TEXT', { x: n.x, y: n.y + i * 220 }, 150, `${it.done ? '[X]' : '[ ]'} ${it.text}`);
        });
    }
    text('TEXT', { x: bb.x, y: bb.y - 300 }, 200, 'Don vi: mm (MKG Khao Sat)');

    tag(0, 'ENDSEC');
    tag(0, 'EOF');
    return t.join('\r\n') + '\r\n';
}
