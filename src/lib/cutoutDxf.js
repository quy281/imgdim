import { asciiFold } from './dxf.js';
import { cutoutOffsets } from './cutoutModel.js';

const LAYERS = [
    { name: 'CUTOUT_OUTER', color: 7 },
    { name: 'CUTOUT_HOLE', color: 1 },
    { name: 'CUTOUT_DIM', color: 3 },
    { name: 'CUTOUT_LABEL', color: 2 },
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

/**
 * Tạo đa giác bo góc cho hình chữ nhật cắt CNC (toạ độ world mm, y-down -> đảo dấu khi xuất DXF).
 */
function roundedRectPoints(x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r || 0, Math.min(w, h) / 2));
    if (rad < 1) {
        return [
            { x, y },
            { x: x + w, y },
            { x: x + w, y: y + h },
            { x, y: y + h },
        ];
    }
    const pts = [];
    const corners = [
        { cx: x + w - rad, cy: y + rad, start: -Math.PI / 2, end: 0 },
        { cx: x + w - rad, cy: y + h - rad, start: 0, end: Math.PI / 2 },
        { cx: x + rad, cy: y + h - rad, start: Math.PI / 2, end: Math.PI },
        { cx: x + rad, cy: y + rad, start: Math.PI, end: (Math.PI * 3) / 2 },
    ];
    const segs = 4;
    for (const c of corners) {
        for (let i = 0; i <= segs; i++) {
            const ang = c.start + ((c.end - c.start) * i) / segs;
            pts.push({ x: c.cx + Math.cos(ang) * rad, y: c.cy + Math.sin(ang) * rad });
        }
    }
    return pts;
}

/**
 * Xuất AutoCAD DXF AC1009 (1 unit = 1 mm) cho bản vẽ đo lỗ bếp / lavabo / ổ điện.
 */
export function generateCutoutDxf(doc) {
    const cutout = doc?.cutout || { w: 1000, h: 550, cutouts: [] };
    const ow = Number(cutout.w) || 1000;
    const oh = Number(cutout.h) || 550;
    const refMode = cutout.refMode === 'center' ? 'center' : 'edge';
    const pad = 400;

    const t = [];
    const tag = (code, value) => { t.push(String(code), String(value)); };

    tag(0, 'SECTION'); tag(2, 'HEADER');
    tag(9, '$ACADVER'); tag(1, 'AC1009');
    tag(9, '$EXTMIN'); tag(10, num(-pad)); tag(20, num(-(oh + pad))); tag(30, '0.0');
    tag(9, '$EXTMAX'); tag(10, num(ow + pad)); tag(20, num(pad)); tag(30, '0.0');
    tag(0, 'ENDSEC');

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

    tag(0, 'SECTION'); tag(2, 'ENTITIES');

    const line = (layer, p1, p2) => {
        tag(0, 'LINE'); tag(8, layer);
        tag(10, num(p1.x)); tag(20, num(-p1.y)); tag(30, '0.0');
        tag(11, num(p2.x)); tag(21, num(-p2.y)); tag(31, '0.0');
    };
    const circle = (layer, cx, cy, rad) => {
        tag(0, 'CIRCLE'); tag(8, layer);
        tag(10, num(cx)); tag(20, num(-cy)); tag(30, '0.0');
        tag(40, num(rad));
    };
    const text = (layer, p, height, content) => {
        tag(0, 'TEXT'); tag(8, layer);
        tag(10, num(p.x)); tag(20, num(-p.y)); tag(30, '0.0');
        tag(40, num(height)); tag(1, dxfEscape(asciiFold(content)));
    };
    const closedPolyline = (layer, poly) => {
        tag(0, 'POLYLINE'); tag(8, layer); tag(66, 1); tag(70, 1);
        for (const p of poly) {
            tag(0, 'VERTEX'); tag(8, layer);
            tag(10, num(p.x)); tag(20, num(-p.y)); tag(30, '0.0');
        }
        tag(0, 'SEQEND');
    };

    // Khung bao ngoài
    closedPolyline('CUTOUT_OUTER', [
        { x: 0, y: 0 },
        { x: ow, y: 0 },
        { x: ow, y: oh },
        { x: 0, y: oh },
    ]);
    text('CUTOUT_LABEL', { x: 0, y: -150 }, 55, `${doc?.name || 'Do lo khoet'} (${Math.round(ow)}x${Math.round(oh)}x${Math.round(cutout.thickness || 20)}mm)`);
    text('CUTOUT_DIM', { x: ow / 2 - 60, y: -35 }, 36, `${Math.round(ow)}`);
    text('CUTOUT_DIM', { x: -120, y: oh / 2 }, 36, `${Math.round(oh)}`);

    // Từng lỗ khoét + đường dẫn định vị 4 phía
    for (const hole of (cutout.cutouts || [])) {
        const cx = hole.x + hole.w / 2;
        const cy = hole.y + hole.h / 2;
        const offs = cutoutOffsets(cutout, hole, refMode);

        if (hole.shape === 'circle') {
            circle('CUTOUT_HOLE', cx, cy, hole.w / 2);
            line('CUTOUT_DIM', { x: cx - hole.w * 0.7, y: cy }, { x: cx + hole.w * 0.7, y: cy });
            line('CUTOUT_DIM', { x: cx, y: cy - hole.h * 0.7 }, { x: cx, y: cy + hole.h * 0.7 });
        } else {
            closedPolyline('CUTOUT_HOLE', roundedRectPoints(hole.x, hole.y, hole.w, hole.h, hole.r));
        }

        // Đường định vị 4 cạnh từ tâm hoặc mép lỗ
        const rxL = refMode === 'center' ? cx : hole.x;
        const rxR = refMode === 'center' ? cx : hole.x + hole.w;
        const ryT = refMode === 'center' ? cy : hole.y;
        const ryB = refMode === 'center' ? cy : hole.y + hole.h;

        line('CUTOUT_DIM', { x: 0, y: cy }, { x: rxL, y: cy });
        line('CUTOUT_DIM', { x: rxR, y: cy }, { x: ow, y: cy });
        line('CUTOUT_DIM', { x: cx, y: 0 }, { x: cx, y: ryT });
        line('CUTOUT_DIM', { x: cx, y: ryB }, { x: cx, y: oh });

        const szTxt = hole.shape === 'circle'
            ? `D${Math.round(hole.w)}`
            : `${Math.round(hole.w)}x${Math.round(hole.h)}${hole.r > 0 ? ` R${Math.round(hole.r)}` : ''}`;
        text('CUTOUT_LABEL', { x: hole.x, y: cy - 12 }, 28, `${hole.name || 'Lo'} (${szTxt})`);
        text('CUTOUT_DIM', { x: rxL / 2, y: cy - 12 }, 24, `T:${offs.left}`);
        text('CUTOUT_DIM', { x: (rxR + ow) / 2, y: cy - 12 }, 24, `P:${offs.right}`);
        text('CUTOUT_DIM', { x: cx + 10, y: ryT / 2 }, 24, `Tr:${offs.top}`);
        text('CUTOUT_DIM', { x: cx + 10, y: (ryB + oh) / 2 }, 24, `Du:${offs.bottom}`);
    }

    tag(0, 'ENDSEC');
    tag(0, 'EOF');
    return t.join('\n') + '\n';
}
