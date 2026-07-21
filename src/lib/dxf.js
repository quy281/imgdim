// Hand-written DXF R12 (AC1009) ASCII generator — zero dependencies.
// Coordinates in real millimeters. Screen y points down, DXF y up -> emit y' = -y.
// R12 has no Unicode: non-ASCII escaped as \U+XXXX (AutoCAD reads this).
import { dist, bboxOfPlan } from './geometry';

const LAYERS = [
    { name: 'WALL', color: 7 },
    { name: 'DIM', color: 3 },
    { name: 'TEXT', color: 2 },
    { name: 'ROOM', color: 4 },
    { name: 'DOOR', color: 1 },
    { name: 'WINDOW', color: 5 },
];

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

    const bb = bboxOfPlan(doc.plan, doc.notes) || { x: 0, y: 0, width: 10000, height: 8000 };
    const extMin = { x: bb.x, y: -(bb.y + bb.height) };
    const extMax = { x: bb.x + bb.width, y: -bb.y };

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
