import { boardArea, boardBounds, boardPerimeter } from './boardModel';
import { dist } from './geometry';
import { asciiFold } from './dxf';

const LAYERS = [
    { name: 'BOARD_OUTLINE', color: 7 },
    { name: 'BOARD_DIM', color: 3 },
    { name: 'BOARD_LABEL', color: 2 },
    { name: 'BOARD_DEFECT', color: 1 },
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

export function boardFileName(board, ext = 'dxf') {
    const clean = (s) => asciiFold(String(s || 'board'))
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'board';
    return `${clean(board?.code)}-${clean(board?.location)}.${ext}`;
}

export function generateBoardDxf(doc) {
    const board = doc.board || {};
    const pts = board.outline || [];
    const bb = boardBounds(board);
    const pad = 800;
    const minX = bb.x - pad;
    const maxX = bb.x + bb.width + pad;
    const minY = bb.y - pad;
    const maxY = bb.y + bb.height + pad;
    const t = [];
    const tag = (code, value) => { t.push(String(code), String(value)); };

    tag(0, 'SECTION'); tag(2, 'HEADER');
    tag(9, '$ACADVER'); tag(1, 'AC1009');
    tag(9, '$EXTMIN'); tag(10, num(minX)); tag(20, num(-maxY)); tag(30, '0.0');
    tag(9, '$EXTMAX'); tag(10, num(maxX)); tag(20, num(-minY)); tag(30, '0.0');
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

    if (pts.length >= 3) {
        closedPolyline('BOARD_OUTLINE', pts);
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const L = dist(a, b);
            if (L < 1) continue;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            text('BOARD_DIM', { x: mx - 90, y: my - 70 }, 90, String(Math.round(L)));
        }
    }

    text('BOARD_LABEL', { x: bb.x, y: bb.y - 420 }, 160, `Ma van: ${board.code || doc.name}`);
    text('BOARD_LABEL', { x: bb.x, y: bb.y - 230 }, 120,
        `${board.material || ''} ${board.thickness || ''}mm ${board.color || ''} - Kho ${board.location || ''}`);
    text('BOARD_LABEL', { x: bb.x, y: bb.y + bb.height + 260 }, 110,
        `Dien tich ${(boardArea(board) / 1e6).toFixed(3)} m2 - Chu vi ${(boardPerimeter(board) / 1000).toFixed(2)} m`);
    if (board.grain) {
        const y = bb.y + bb.height + 480;
        line('BOARD_LABEL', { x: bb.x, y }, { x: bb.x + Math.min(900, Math.max(250, bb.width * 0.45)), y });
        text('BOARD_LABEL', { x: bb.x, y: y + 140 }, 100, board.grain === 'long' ? 'Huong van theo chieu dai' : 'Huong van ngang');
    }

    tag(0, 'ENDSEC');
    tag(0, 'EOF');
    return t.join('\r\n') + '\r\n';
}
