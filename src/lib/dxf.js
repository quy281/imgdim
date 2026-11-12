// Hand-written DXF R12 (AC1009) ASCII generator — zero dependencies.
// Coordinates in real millimeters. Screen y points down, DXF y up -> emit y' = -y.
// R12 has no Unicode: non-ASCII escaped as \U+XXXX (AutoCAD reads this).
import {
    dist, bboxOfPlan, wallSegments, wallFrame, openingV, ceilingHeight,
    roomFaces, projectItemOnWall, SLAB_DEFAULT,
} from './geometry';
import { catalogItem, resolveZ } from './furnitureCatalog';
import { buildSixViewsBundle, projectItemDetailOnWall } from './projectionEngine';

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
    { name: 'ELEV-SWING', color: 1 },
    { name: 'ELEV-DIM', color: 3 },
    { name: 'ELEV-LEVEL', color: 6 },
    { name: 'ELEV-TEXT', color: 2 },
];

const CAB_LAYERS = [
    { name: 'CAB-FRAME', color: 7 },
    { name: 'CAB-OUTLINE', color: 7 },
    { name: 'CAB-PROJ', color: 8 },
    { name: 'CAB-CUT', color: 4 },
    { name: 'CAB-HATCH', color: 9 },
    { name: 'CAB-SWING', color: 1 },
    { name: 'CAB-DIM', color: 3 },
    { name: 'CAB-TEXT', color: 2 },
];

// Bỏ dấu tiếng Việt cho chữ trong DXF. `dxfEscape` đã sinh \U+XXXX đúng chuẩn
// AutoCAD, nhưng BricsCAD và các viewer cũ hay ra ô vuông — theo đúng lối đã
// dùng sẵn trong file này ('Don vi: mm').
export function asciiFold(str) {
    return String(str)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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
                const detail = pr.touching ? projectItemDetailOnWall(frame, it, cat, H) : null;
                items.push({
                    ...pr,
                    raw: it,
                    detail,
                    name: cat?.name || 'Noi that',
                    h: it.h ?? cat?.h ?? 800,
                    z: resolveZ(it, cat, H),
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
            text('ROOM', { x: r.cx, y: r.cy }, 250, asciiFold(r.name));
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
        const pt = (lx, ly) => ({ x: f.x + lx * cos - ly * sin, y: f.y + lx * sin + ly * cos });
        const hw = w / 2, hd = d / 2;
        closedPolyline('FURNITURE', [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)]);
        if (cat?.back) line('FURNITURE', pt(-hw, -hd), pt(hw, -hd));
        if (cat?.name) text('FURNITURE', { x: f.x - hw * 0.8, y: f.y }, 110, asciiFold(cat.name));
    }

    // ===== Khai triển tường (mặt đứng) =====
    if (faces.length) {
        let ox = bb.x;
        for (const f of faces) {
            const E = (u, z) => ({ x: ox + u, y: baseY - z });
            const { len, H, slabT, wall, frame, settings } = f;

            closedPolyline('ELEV', [E(0, 0), E(len, 0), E(len, H), E(0, H)]);
            closedPolyline('ELEV', [E(0, H), E(len, H), E(len, H + slabT), E(0, H + slabT)]);
            line('ELEV', E(-250, 0), E(len + 250, 0));

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
                if (it.detail && it.detail.segments.length > 0 && Math.abs((x1 - x0) - it.detail.width) < 40) {
                    for (const seg of it.detail.segments) {
                        const lyr = seg.weight === 'swing' ? 'ELEV-SWING' : 'ELEV-FURN';
                        line(lyr, E(x0 + seg.u1, it.z + seg.v1), E(x0 + seg.u2, it.z + seg.v2));
                    }
                } else {
                    closedPolyline('ELEV-FURN', [E(x0, it.z), E(x1, it.z), E(x1, it.z + it.h), E(x0, it.z + it.h)]);
                }
                text('ELEV-FURN', E(x0 + 60, it.z + it.h + 50), 100, `${asciiFold(it.name)} +${Math.round(it.z)}`);
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
            text('TEXT', { x: n.x, y: n.y + i * 220 }, 150, `${it.done ? '[X]' : '[ ]'} ${asciiFold(it.text)}`);
        });
    }
    text('TEXT', { x: bb.x, y: bb.y - 300 }, 200, 'Don vi: mm (MKG Khao Sat)');

    tag(0, 'ENDSEC');
    tag(0, 'EOF');
    return t.join('\r\n') + '\r\n';
}

/**
 * Xuất DXF Bổ Kỹ Thuật Nội Thất (1 món hoặc Hàng loạt tất cả món trong mặt bằng).
 * Mỗi món sinh 1 khung bản vẽ chuẩn tỉ lệ 1:1 (mm) gồm 5 hình chiếu vector căn gióng:
 *   Hàng trên: MẶT ĐỨNG | MẶT BÊN TRÁI | MẶT CẮT A-A (có Hatch & dim tầng đợt)
 *   Hàng dưới: MẶT BẰNG | MẶT CẮT B-B (có Hatch & dim khoang) + Khung tên MKG bên phải.
 */
export function generateCabinetDxf(doc, onlyItemId = null) {
    const allItems = (doc?.furniture || []).filter(it => !onlyItemId || it.id === onlyItemId);
    if (!allItems.length) return '';

    const t = [];
    const tag = (code, value) => { t.push(String(code), String(value)); };

    // Dựng trước toàn bộ bundle để biết chính xác khổ bao $EXTMIN/$EXTMAX
    const sheets = allItems.map((it, idx) => {
        const cat = catalogItem(it.kind);
        const bundle = buildSixViewsBundle(it, cat);
        const { w, d, h } = bundle.config;
        const colGap = Math.max(550, w * 0.25);
        const rowGap = Math.max(650, h * 0.28);
        const pad = 550;
        const titleBlockW = Math.max(900, Math.round((w + d * 2) * 0.24));
        const contentW = w + colGap + d + colGap + d;
        const contentH = h + rowGap + d;
        const sheetW = pad + contentW + pad + titleBlockW;
        const sheetH = pad + contentH + pad + 350;
        return { it, cat, bundle, idx, colGap, rowGap, pad, titleBlockW, sheetW, sheetH };
    });

    const SHEET_GAP = 900;
    const totalW = sheets.reduce((s, sh) => s + sh.sheetW + SHEET_GAP, 0);
    const maxH = sheets.reduce((m, sh) => Math.max(m, sh.sheetH), 3000);

    tag(0, 'SECTION'); tag(2, 'HEADER');
    tag(9, '$ACADVER'); tag(1, 'AC1009');
    tag(9, '$EXTMIN'); tag(10, '0'); tag(20, '0'); tag(30, '0.0');
    tag(9, '$EXTMAX'); tag(10, num(totalW)); tag(20, num(maxH)); tag(30, '0.0');
    tag(0, 'ENDSEC');

    tag(0, 'SECTION'); tag(2, 'TABLES');
    tag(0, 'TABLE'); tag(2, 'LTYPE'); tag(70, 1);
    tag(0, 'LTYPE'); tag(2, 'CONTINUOUS'); tag(70, 0); tag(3, 'Solid line'); tag(72, 65); tag(73, 0); tag(40, '0.0');
    tag(0, 'ENDTAB');
    tag(0, 'TABLE'); tag(2, 'LAYER'); tag(70, CAB_LAYERS.length);
    for (const l of CAB_LAYERS) {
        tag(0, 'LAYER'); tag(2, l.name); tag(70, 0); tag(62, l.color); tag(6, 'CONTINUOUS');
    }
    tag(0, 'ENDTAB');
    tag(0, 'ENDSEC');

    tag(0, 'SECTION'); tag(2, 'ENTITIES');

    // Ở hàm này dùng toạ độ CAD chuẩn (X sang phải, Y hướng lên)
    const line = (layer, x1, y1, x2, y2) => {
        tag(0, 'LINE'); tag(8, layer);
        tag(10, num(x1)); tag(20, num(y1)); tag(30, '0.0');
        tag(11, num(x2)); tag(21, num(y2)); tag(31, '0.0');
    };
    const rect = (layer, x, y, w, h) => {
        tag(0, 'POLYLINE'); tag(8, layer); tag(66, 1); tag(70, 1);
        for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) {
            tag(0, 'VERTEX'); tag(8, layer);
            tag(10, num(px)); tag(20, num(py)); tag(30, '0.0');
        }
        tag(0, 'SEQEND');
    };
    const text = (layer, x, y, height, content) => {
        tag(0, 'TEXT'); tag(8, layer);
        tag(10, num(x)); tag(20, num(y)); tag(30, '0.0');
        tag(40, num(height)); tag(1, dxfEscape(asciiFold(content)));
    };
    const dimH = (x1, x2, yRef, yDim, label) => {
        line('CAB-DIM', x1, yRef, x1, yDim);
        line('CAB-DIM', x2, yRef, x2, yDim);
        line('CAB-DIM', x1 - 25, yDim, x2 + 25, yDim);
        text('CAB-DIM', (x1 + x2) / 2 - 90, yDim + 35, 75, String(Math.round(label ?? Math.abs(x2 - x1))));
    };
    const dimV = (y1, y2, xRef, xDim, label) => {
        line('CAB-DIM', xRef, y1, xDim, y1);
        line('CAB-DIM', xRef, y2, xDim, y2);
        line('CAB-DIM', xDim, y1 - 25, xDim, y2 + 25);
        text('CAB-DIM', xDim + (xDim < xRef ? -180 : 40), (y1 + y2) / 2 - 35, 75, String(Math.round(label ?? Math.abs(y2 - y1))));
    };
    const emitView = (view, ox, oy, title) => {
        for (const seg of view.segments) {
            let lyr = 'CAB-PROJ';
            if (seg.weight === 'cut') lyr = 'CAB-CUT';
            else if (seg.weight === 'hatch') lyr = 'CAB-HATCH';
            else if (seg.weight === 'swing') lyr = 'CAB-SWING';
            else if (seg.weight === 'outline') lyr = 'CAB-OUTLINE';
            line(lyr, ox + seg.u1, oy + seg.v1, ox + seg.u2, oy + seg.v2);
        }
        text('CAB-TEXT', ox + view.width * 0.2, oy - 260, 95, title);
    };

    let sheetX = 0;
    for (const sh of sheets) {
        const { it, cat, bundle, idx, colGap, rowGap, pad, titleBlockW, sheetW, sheetH } = sh;
        const { w, d, h } = bundle.config;
        const { front, left, sectionAA, plan, sectionBB } = bundle.views;

        // Khung bản vẽ & Khung tên bên phải (giống bố cục Betagon Layout)
        rect('CAB-FRAME', sheetX, 0, sheetW, sheetH);
        const tbX = sheetX + sheetW - titleBlockW;
        line('CAB-FRAME', tbX, 0, tbX, sheetH);
        const rows = [0.14, 0.28, 0.44, 0.68, 0.85];
        for (const r of rows) line('CAB-FRAME', tbX, sheetH * r, tbX + titleBlockW, sheetH * r);

        const itemName = cat?.name || it.kind || 'NOI THAT';
        text('CAB-TEXT', tbX + 60, sheetH * 0.91, 120, 'MKG NOI THAT');
        text('CAB-TEXT', tbX + 60, sheetH * 0.75, 90, `DU AN: ${doc.name || 'Khao sat'}`);
        text('CAB-TEXT', tbX + 60, sheetH * 0.54, 115, `${itemName.toUpperCase()} #${idx + 1}`);
        text('CAB-TEXT', tbX + 60, sheetH * 0.47, 85, `KT: ${Math.round(w)} x ${Math.round(d)} x ${Math.round(h)} mm`);
        text('CAB-TEXT', tbX + 60, sheetH * 0.34, 85, `VAN: ${bundle.config.boardT}mm - HAU: ${bundle.config.backT}mm`);
        text('CAB-TEXT', tbX + 60, sheetH * 0.20, 85, `TY LE: 1:1 (mm)`);
        text('CAB-TEXT', tbX + 60, sheetH * 0.05, 110, `TO: ${String(idx + 1).padStart(2, '0')}/${String(sheets.length).padStart(2, '0')}`);

        // Tọa độ gốc các khung nhìn (Hàng dưới: Mặt bằng & Cắt B-B; Hàng trên: Mặt đứng, Mặt bên, Cắt A-A)
        const rowBottomY = pad + 180;
        const rowTopY = rowBottomY + d + rowGap;
        const col1X = sheetX + pad;
        const col2X = col1X + w + colGap;
        const col3X = col2X + d + colGap;

        // 1. MẶT ĐỨNG + ký hiệu cắt A-A, B-B + Dim bao
        emitView(front, col1X, rowTopY, 'MAT DUNG');
        dimH(col1X, col1X + w, rowTopY + h, rowTopY + h + 150, w);
        dimV(rowTopY, rowTopY + h, col1X, col1X - 160, h);
        // Đường cắt A-A (dọc) & B-B (ngang) trên Mặt đứng
        line('CAB-SWING', col1X + bundle.xCut, rowTopY - 90, col1X + bundle.xCut, rowTopY + h + 90);
        text('CAB-SWING', col1X + bundle.xCut + 25, rowTopY + h + 95, 85, 'A');
        text('CAB-SWING', col1X + bundle.xCut + 25, rowTopY - 120, 85, 'A');
        line('CAB-SWING', col1X - 90, rowTopY + bundle.zCut, col1X + w + 90, rowTopY + bundle.zCut);
        text('CAB-SWING', col1X - 170, rowTopY + bundle.zCut + 20, 85, 'B');
        text('CAB-SWING', col1X + w + 105, rowTopY + bundle.zCut + 20, 85, 'B');

        // 2. MẶT BÊN TRÁI
        emitView(left, col2X, rowTopY, 'MAT BEN TRAI');
        dimH(col2X, col2X + d, rowTopY, rowTopY - 130, d);
        dimV(rowTopY, rowTopY + h, col2X + d, col2X + d + 140, h);

        // 3. MẶT CẮT A-A + chuỗi dim cao độ tầng đợt bên trong
        emitView(sectionAA, col3X, rowTopY, 'MAT CAT A-A');
        dimH(col3X, col3X + d, rowTopY, rowTopY - 130, d);
        for (const cz of sectionAA.clearDimsZ) {
            dimV(rowTopY + cz.v0, rowTopY + cz.v1, col3X + d, col3X + d + 130, cz.val);
        }
        dimV(rowTopY, rowTopY + h, col3X + d, col3X + d + 290, h);

        // 4. MẶT BẰNG (căn thẳng cột với MẶT ĐỨNG)
        emitView(plan, col1X, rowBottomY, 'MAT BANG');
        dimH(col1X, col1X + w, rowBottomY + d, rowBottomY + d + 130, w);
        dimV(rowBottomY, rowBottomY + d, col1X, col1X - 160, d);

        // 5. MẶT CẮT B-B + chuỗi dim lọt lòng từng khoang đứng
        const bbX = col2X;
        emitView(sectionBB, bbX, rowBottomY, 'MAT CAT B-B');
        for (const cx of sectionBB.clearDimsX) {
            dimH(bbX + cx.u0, bbX + cx.u1, rowBottomY + d, rowBottomY + d + 120, cx.val);
        }
        dimH(bbX, bbX + w, rowBottomY + d, rowBottomY + d + 260, w);
        dimV(rowBottomY, rowBottomY + d, bbX + w, bbX + w + 140, d);

        sheetX += sheetW + SHEET_GAP;
    }

    tag(0, 'ENDSEC');
    tag(0, 'EOF');
    return t.join('\r\n') + '\r\n';
}
