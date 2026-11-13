// Hand-written DXF R12 (AC1009) ASCII generator — zero dependencies.
// Coordinates in real millimeters. Screen y points down, DXF y up -> emit y' = -y.
// R12 has no Unicode: non-ASCII escaped as \U+XXXX (AutoCAD reads this).
import {
    dist, bboxOfPlan, wallSegments, wallFrame, openingV, ceilingHeight,
    roomFaces, projectItemOnWall, SLAB_DEFAULT,
} from './geometry';
import { catalogItem, resolveZ } from './furnitureCatalog';
import { projectItemDetailOnWall } from './projectionEngine';
import { parseSvgSymbol, svgToNormalizedPolylines } from './svgSymbol';

const LAYERS = [
    { name: 'WALL', color: 7 },
    { name: 'DIM', color: 3 },
    { name: 'TEXT', color: 2 },
    { name: 'ROOM', color: 4 },
    { name: 'DOOR', color: 1 },
    { name: 'WINDOW', color: 5 },
    { name: 'FURNITURE', color: 8 },
    { name: 'FURN-DETAIL', color: 9 },
    { name: 'FURN-DIM', color: 6 },
    { name: 'ELEV', color: 7 },
    { name: 'ELEV-DOOR', color: 1 },
    { name: 'ELEV-WINDOW', color: 5 },
    { name: 'ELEV-FURN', color: 8 },
    { name: 'ELEV-SWING', color: 1 },
    { name: 'ELEV-DIM', color: 3 },
    { name: 'ELEV-LEVEL', color: 6 },
    { name: 'ELEV-TEXT', color: 2 },
];

export function asciiFold(str) {
    return String(str)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/**
 * Các mặt đứng cần xuất: chỉ tường KTS đã thật sự dựng (wall.elev), gom theo phòng.
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
            if (!wall?.elev) continue;
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

/** Vẽ chi tiết CAD 2D nội thất trên mặt bằng xuất AutoCAD DXF */
function emitFurniture2DCad(sym, w, d, pt, closedPolyline, line, circle) {
    const hw = w / 2, hd = d / 2;
    const rectPts = (x0, y0, rw, rh) => [pt(x0, y0), pt(x0 + rw, y0), pt(x0 + rw, y0 + rh), pt(x0, y0 + rh)];

    if (sym === 'sofaL') {
        const mainD = Math.min(d * 0.52, 920);
        const chaiseW = Math.min(w * 0.37, 980);
        const chaiseX = hw - chaiseW;
        closedPolyline('FURNITURE', [
            pt(-hw, -hd), pt(hw, -hd), pt(hw, hd),
            pt(chaiseX, hd), pt(chaiseX, -hd + mainD), pt(-hw, -hd + mainD),
        ]);
        const backD = Math.min(d * 0.13, 210);
        line('FURN-DETAIL', pt(-hw, -hd + backD), pt(hw, -hd + backD));
        line('FURN-DETAIL', pt(chaiseX, -hd + backD), pt(chaiseX, -hd + mainD));
        return;
    }

    closedPolyline('FURNITURE', rectPts(-hw, -hd, w, d));

    switch (sym) {
        case 'bed': {
            const hb = Math.min(70, d * 0.045);
            const pilD = Math.min(d * 0.19, 320);
            const gap = Math.min(w * 0.045, 65);
            line('FURN-DETAIL', pt(-hw, -hd + hb), pt(hw, -hd + hb));
            if (w > 1300) {
                const pw = (w - gap * 3) / 2;
                closedPolyline('FURN-DETAIL', rectPts(-hw + gap, -hd + hb + gap * 0.7, pw, pilD));
                closedPolyline('FURN-DETAIL', rectPts(gap / 2, -hd + hb + gap * 0.7, pw, pilD));
            } else {
                closedPolyline('FURN-DETAIL', rectPts(-hw + gap, -hd + hb + gap * 0.7, w - gap * 2, pilD));
            }
            const sy = -hd + hb + pilD + gap * 1.8;
            line('FURN-DETAIL', pt(-hw, sy), pt(hw, sy));
            line('FURN-DETAIL', pt(-hw, sy + 180), pt(hw - 220, sy + 180));
            line('FURN-DETAIL', pt(hw - 220, sy + 180), pt(hw, sy));
            break;
        }
        case 'wardrobe':
        case 'wardrobe_slide': {
            const doorBand = sym === 'wardrobe_slide' ? 85 : 40;
            line('FURN-DETAIL', pt(-hw, hd - doorBand), pt(hw, hd - doorBand));
            line('FURN-DETAIL', pt(-hw + 30, 0), pt(hw - 30, 0));
            const nBays = Math.max(2, Math.round(w / (sym === 'wardrobe_slide' ? 950 : 580)));
            for (let i = 1; i < nBays; i++) {
                const bx = -hw + (w / nBays) * i;
                line('FURN-DETAIL', pt(bx, -hd), pt(bx, hd - doorBand));
            }
            break;
        }
        case 'sofa':
        case 'armchair': {
            const arm = Math.min(w * 0.12, 200);
            const back = Math.min(d * 0.24, 220);
            line('FURN-DETAIL', pt(-hw, -hd + back), pt(hw, -hd + back));
            line('FURN-DETAIL', pt(-hw + arm, -hd + back), pt(-hw + arm, hd));
            line('FURN-DETAIL', pt(hw - arm, -hd + back), pt(hw - arm, hd));
            break;
        }
        case 'table': {
            const cw = Math.min(420, Math.min(w, d) * 0.44);
            const cd = cw * 0.55;
            const n = Math.max(2, Math.round(w / 650));
            for (let i = 0; i < n; i++) {
                const cx = -hw + (w / n) * (i + 0.5);
                closedPolyline('FURN-DETAIL', rectPts(cx - cw / 2, -hd - cd, cw, cd));
                closedPolyline('FURN-DETAIL', rectPts(cx - cw / 2, hd, cw, cd));
            }
            break;
        }
        case 'toilet': {
            line('FURN-DETAIL', pt(-hw, -hd + d * 0.28), pt(hw, -hd + d * 0.28));
            circle('FURN-DETAIL', pt(0, d * 0.14), Math.min(hw * 0.75, d * 0.28));
            break;
        }
        case 'basin':
        case 'sink':
        case 'sink2': {
            const n = w >= 780 ? 2 : 1;
            const spanW = sym === 'sink2' ? w * 0.66 : w;
            for (let i = 0; i < n; i++) {
                const cx = -hw + (spanW / n) * (i + 0.5);
                circle('FURN-DETAIL', pt(cx, 0), Math.min((spanW / n) * 0.34, d * 0.32));
            }
            break;
        }
        case 'hob': {
            const r = Math.min(w, d) * 0.17;
            circle('FURN-DETAIL', pt(-w * 0.22, 0), r);
            circle('FURN-DETAIL', pt(w * 0.22, 0), r * 0.85);
            break;
        }
        case 'shower': {
            line('FURN-DETAIL', pt(-hw, -hd), pt(hw, hd));
            line('FURN-DETAIL', pt(hw, -hd), pt(-hw, hd));
            circle('FURN-DETAIL', pt(0, 0), 45);
            break;
        }
        case 'tub': {
            closedPolyline('FURN-DETAIL', rectPts(-hw + w * 0.07, -hd + d * 0.11, w * 0.86, d * 0.78));
            break;
        }
        default:
            break;
    }
}

export function generateDxf(doc) {
    const t = [];
    const tag = (code, value) => { t.push(String(code), String(value)); };

    const bb = bboxOfPlan(doc.plan, doc.notes, doc.furniture) || { x: 0, y: 0, width: 10000, height: 8000 };

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
    const circle = (layer, center, r) => {
        tag(0, 'CIRCLE'); tag(8, layer);
        tag(10, num(center.x)); tag(20, num(-center.y)); tag(30, '0.0');
        tag(40, num(r));
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

    for (const f of (doc.furniture || [])) {
        const cat = catalogItem(f.kind);
        const w = f.w || cat?.w || 600;
        const d = f.d || cat?.d || 600;
        const th = ((f.rot || 0) * Math.PI) / 180;
        const cos = Math.cos(th), sin = Math.sin(th);
        const pt = (lx, ly) => ({ x: f.x + lx * cos - ly * sin, y: f.y + lx * sin + ly * cos });
        const hw = w / 2, hd = d / 2;

        const parsedSvg = cat?.svg2d ? parseSvgSymbol(cat.svg2d) : null;
        if (parsedSvg) {
            closedPolyline('FURNITURE', [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)]);
            const polies = svgToNormalizedPolylines(parsedSvg);
            for (const poly of polies) {
                const worldPts = poly.points.map(p => pt(p.x * w, p.y * d));
                if (worldPts.length < 2) continue;
                if (poly.closed) {
                    closedPolyline('FURN-DETAIL', worldPts);
                } else {
                    for (let i = 0; i < worldPts.length - 1; i++) {
                        line('FURN-DETAIL', worldPts[i], worldPts[i + 1]);
                    }
                }
            }
        } else {
            emitFurniture2DCad(cat?.sym, w, d, pt, closedPolyline, line, circle);
        }

        if (cat?.back) line('FURNITURE', pt(-hw, -hd), pt(hw, -hd));
        if (cat?.name) text('FURNITURE', { x: f.x - hw * 0.7, y: f.y }, 105, asciiFold(cat.name));

        // Kích thước nội thất trên layer FURN-DIM
        const dimY = hd + 90;
        const tk = 35;
        line('FURN-DIM', pt(-hw, hd + 18), pt(-hw, dimY + tk));
        line('FURN-DIM', pt(hw, hd + 18), pt(hw, dimY + tk));
        line('FURN-DIM', pt(-hw, dimY), pt(hw, dimY));
        line('FURN-DIM', pt(-hw - tk * 0.6, dimY + tk * 0.6), pt(-hw + tk * 0.6, dimY - tk * 0.6));
        line('FURN-DIM', pt(hw - tk * 0.6, dimY + tk * 0.6), pt(hw + tk * 0.6, dimY - tk * 0.6));
        text('FURN-DIM', pt(-hw * 0.35, dimY + 35), 85, `${Math.round(w)}x${Math.round(d)}`);
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
