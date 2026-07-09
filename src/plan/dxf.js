// Hand-written DXF R12 (AC1009) ASCII generator — zero dependencies.
// Coordinates are emitted in real millimeters. Screen y points down, DXF y points up -> emit y' = -y.
// R12 has no Unicode: non-ASCII chars are escaped as \U+XXXX (AutoCAD understands this).
import { wallQuad, dist, contentBBox } from './planGeometry';

const LAYERS = [
    { name: 'WALL', color: 7 },
    { name: 'WALL-AXIS', color: 8 },
    { name: 'DIM', color: 3 },
    { name: 'TEXT', color: 2 },
    { name: 'ROOM', color: 4 },
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

export function generateDxf(doc) {
    const t = [];
    const tag = (code, value) => { t.push(String(code), String(value)); };

    const bb = contentBBox(doc) || { x: 0, y: 0, width: 10000, height: 8000 };
    // After the y-flip the extents become [-(y+height), -y]
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
            closedPolyline('WALL', wallQuad(a, b, w.thickness));
            line('WALL-AXIS', a, b);
            const len = dist(a, b);
            if (len > 0) {
                const nx = -(b.y - a.y) / len;
                const ny = (b.x - a.x) / len;
                const off = w.thickness / 2 + 180;
                const mid = { x: (a.x + b.x) / 2 + nx * off, y: (a.y + b.y) / 2 + ny * off };
                text('DIM', mid, 150, String(Math.round(len)));
            }
        }
        for (const r of (plan.rooms || [])) {
            text('ROOM', { x: r.cx, y: r.cy }, 250, r.name);
            text('ROOM', { x: r.cx, y: r.cy + 350 }, 180, `${(r.area / 1e6).toFixed(1)} m2 - ${(r.perimeter / 1000).toFixed(1)} m`);
        }
    }
    for (const l of (doc.lines || [])) {
        line('DIM', l.start, l.end);
        const mid = { x: (l.start.x + l.end.x) / 2, y: (l.start.y + l.end.y) / 2 - 120 };
        if (l.label) text('DIM', mid, 150, l.label);
    }
    for (const p of (doc.polylines || [])) {
        const pts = p.points || [];
        for (let i = 0; i < pts.length - 1; i++) {
            line('DIM', pts[i], pts[i + 1]);
            const label = (p.labels || [])[i];
            if (label) {
                const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 - 120 };
                text('DIM', mid, 150, label);
            }
        }
    }
    for (const n of (doc.texts || [])) {
        text('TEXT', { x: n.x, y: n.y }, 180, n.text);
    }
    // Honest unit note: R12 has no $INSUNITS, the reader must know coordinates are mm
    text('TEXT', { x: bb.x, y: bb.y - 300 }, 200, 'Don vi: mm (MKG-Dim)');

    tag(0, 'ENDSEC');
    tag(0, 'EOF');
    return t.join('\r\n') + '\r\n';
}
