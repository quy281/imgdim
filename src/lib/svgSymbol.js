// Bộ đọc & chuẩn hoá Vector SVG 2D thuần JS (chạy tốt cả trình duyệt và SSR/Node, không cần DOMParser).
// Quy đổi toạ độ SVG về không gian chuẩn hoá [-0.5 .. +0.5] × [-0.5 .. +0.5] để vẽ lên Konva, Canvas Layout và AutoCAD DXF.

function parseAttrs(attrStr) {
    const attrs = {};
    const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(attrStr))) {
        attrs[m[1]] = m[2] !== undefined ? m[2] : (m[3] ?? '');
    }
    return attrs;
}

const numAttr = (attrs, key, fallback = 0) => {
    if (attrs[key] == null || attrs[key] === '') return fallback;
    const v = parseFloat(String(attrs[key]).replace(/px|mm|pt/gi, ''));
    return Number.isFinite(v) ? v : fallback;
};

function parsePoints(str) {
    const nums = String(str || '').trim().match(/-?\d*\.?\d+(?:[eE][+-]?\d+)?/g);
    if (!nums || nums.length < 2) return [];
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = parseFloat(nums[i]);
        const y = parseFloat(nums[i + 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
    return pts;
}

/**
 * Đọc chuỗi SVG và trả về `{ viewBox: [minX, minY, vw, vh], elements: [...] }`.
 */
export function parseSvgSymbol(svgText) {
    const raw = String(svgText || '').trim();
    if (!raw || !/<svg|<path|<rect|<circle|<ellipse|<line|<polygon|<polyline/i.test(raw)) {
        return null;
    }

    let viewBox = null;
    const svgMatch = raw.match(/<svg\b([^>]*)>/i);
    if (svgMatch) {
        const svgAttrs = parseAttrs(svgMatch[1]);
        if (svgAttrs.viewBox) {
            const nums = svgAttrs.viewBox.trim().split(/[\s,]+/).map(Number);
            if (nums.length >= 4 && nums.slice(0, 4).every(Number.isFinite) && nums[2] > 0 && nums[3] > 0) {
                viewBox = nums.slice(0, 4);
            }
        }
        if (!viewBox) {
            const w = numAttr(svgAttrs, 'width', 0);
            const h = numAttr(svgAttrs, 'height', 0);
            if (w > 0 && h > 0) viewBox = [0, 0, w, h];
        }
    }

    const elements = [];
    const tagRe = /<(path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
    let m;
    while ((m = tagRe.exec(raw))) {
        const tag = m[1].toLowerCase();
        const a = parseAttrs(m[2]);
        const common = {
            fill: a.fill || '',
            stroke: a.stroke || '',
            strokeWidth: numAttr(a, 'stroke-width', 0),
        };
        if (tag === 'path' && a.d) {
            elements.push({ type: 'path', d: a.d, ...common });
        } else if (tag === 'rect') {
            elements.push({
                type: 'rect',
                x: numAttr(a, 'x', 0),
                y: numAttr(a, 'y', 0),
                width: numAttr(a, 'width', 0),
                height: numAttr(a, 'height', 0),
                rx: numAttr(a, 'rx', numAttr(a, 'ry', 0)),
                ...common,
            });
        } else if (tag === 'circle') {
            elements.push({
                type: 'circle',
                cx: numAttr(a, 'cx', 0),
                cy: numAttr(a, 'cy', 0),
                r: numAttr(a, 'r', 0),
                ...common,
            });
        } else if (tag === 'ellipse') {
            elements.push({
                type: 'ellipse',
                cx: numAttr(a, 'cx', 0),
                cy: numAttr(a, 'cy', 0),
                rx: numAttr(a, 'rx', 0),
                ry: numAttr(a, 'ry', 0),
                ...common,
            });
        } else if (tag === 'line') {
            elements.push({
                type: 'line',
                x1: numAttr(a, 'x1', 0),
                y1: numAttr(a, 'y1', 0),
                x2: numAttr(a, 'x2', 0),
                y2: numAttr(a, 'y2', 0),
                ...common,
            });
        } else if (tag === 'polyline' || tag === 'polygon') {
            const pts = parsePoints(a.points);
            if (pts.length >= 2) {
                elements.push({
                    type: tag,
                    points: pts,
                    closed: tag === 'polygon',
                    ...common,
                });
            }
        }
    }

    if (!elements.length) return null;

    if (!viewBox) {
        // Suy ra bbox nếu file SVG thiếu cả viewBox lẫn width/height
        const polies = rawPolylinesFromElements(elements);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of polies) {
            for (const pt of p.points) {
                if (pt.x < minX) minX = pt.x;
                if (pt.y < minY) minY = pt.y;
                if (pt.x > maxX) maxX = pt.x;
                if (pt.y > maxY) maxY = pt.y;
            }
        }
        viewBox = Number.isFinite(minX) && maxX > minX && maxY > minY
            ? [minX, minY, maxX - minX, maxY - minY]
            : [0, 0, 100, 100];
    }

    return { viewBox, elements };
}

/** Giải mã path `d` sang danh sách polyline thô trong toạ độ SVG. */
function pathToPolylines(d) {
    const tokens = String(d || '').match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][+-]?\d+)?/g);
    if (!tokens || !tokens.length) return [];

    const polies = [];
    let cur = [];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    let i = 0;
    let cmd = '';

    const pushPt = (x, y) => {
        cur.push({ x, y });
        cx = x;
        cy = y;
    };
    const flush = (closed = false) => {
        if (cur.length >= 2) polies.push({ closed, points: cur, fill: '', stroke: '' });
        cur = [];
    };
    const isNum = (tok) => tok !== undefined && !/^[a-zA-Z]$/.test(tok);
    const nextNum = () => (isNum(tokens[i]) ? parseFloat(tokens[i++]) : 0);

    while (i < tokens.length) {
        if (/^[a-zA-Z]$/.test(tokens[i])) {
            cmd = tokens[i++];
            if (cmd === 'Z' || cmd === 'z') {
                cx = sx;
                cy = sy;
                flush(true);
                continue;
            }
        } else if (!cmd) {
            i++;
            continue;
        }

        switch (cmd) {
            case 'M': {
                flush(false);
                const x = nextNum(), y = nextNum();
                sx = x; sy = y;
                pushPt(x, y);
                cmd = 'L';
                break;
            }
            case 'm': {
                flush(false);
                const x = cx + nextNum(), y = cy + nextNum();
                sx = x; sy = y;
                pushPt(x, y);
                cmd = 'l';
                break;
            }
            case 'L': {
                pushPt(nextNum(), nextNum());
                break;
            }
            case 'l': {
                pushPt(cx + nextNum(), cy + nextNum());
                break;
            }
            case 'H': {
                pushPt(nextNum(), cy);
                break;
            }
            case 'h': {
                pushPt(cx + nextNum(), cy);
                break;
            }
            case 'V': {
                pushPt(cx, nextNum());
                break;
            }
            case 'v': {
                pushPt(cx, cy + nextNum());
                break;
            }
            case 'C': {
                const x1 = nextNum(), y1 = nextNum(), x2 = nextNum(), y2 = nextNum(), x = nextNum(), y = nextNum();
                const x0 = cx, y0 = cy;
                for (let s = 1; s <= 6; s++) {
                    const t = s / 6, u = 1 - t;
                    pushPt(
                        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
                        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y
                    );
                }
                break;
            }
            case 'c': {
                const x0 = cx, y0 = cy;
                const x1 = x0 + nextNum(), y1 = y0 + nextNum();
                const x2 = x0 + nextNum(), y2 = y0 + nextNum();
                const x = x0 + nextNum(), y = y0 + nextNum();
                for (let s = 1; s <= 6; s++) {
                    const t = s / 6, u = 1 - t;
                    pushPt(
                        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
                        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y
                    );
                }
                break;
            }
            case 'Q': {
                const x1 = nextNum(), y1 = nextNum(), x = nextNum(), y = nextNum();
                const x0 = cx, y0 = cy;
                for (let s = 1; s <= 5; s++) {
                    const t = s / 5, u = 1 - t;
                    pushPt(
                        u * u * x0 + 2 * u * t * x1 + t * t * x,
                        u * u * y0 + 2 * u * t * y1 + t * t * y
                    );
                }
                break;
            }
            case 'q': {
                const x0 = cx, y0 = cy;
                const x1 = x0 + nextNum(), y1 = y0 + nextNum();
                const x = x0 + nextNum(), y = y0 + nextNum();
                for (let s = 1; s <= 5; s++) {
                    const t = s / 5, u = 1 - t;
                    pushPt(
                        u * u * x0 + 2 * u * t * x1 + t * t * x,
                        u * u * y0 + 2 * u * t * y1 + t * t * y
                    );
                }
                break;
            }
            case 'S':
            case 'T': {
                if (cmd === 'S') { nextNum(); nextNum(); }
                pushPt(nextNum(), nextNum());
                break;
            }
            case 's':
            case 't': {
                if (cmd === 's') { nextNum(); nextNum(); }
                pushPt(cx + nextNum(), cy + nextNum());
                break;
            }
            case 'A': {
                nextNum(); nextNum(); nextNum(); nextNum(); nextNum();
                pushPt(nextNum(), nextNum());
                break;
            }
            case 'a': {
                nextNum(); nextNum(); nextNum(); nextNum(); nextNum();
                pushPt(cx + nextNum(), cy + nextNum());
                break;
            }
            default: {
                if (isNum(tokens[i])) i++;
                else cmd = '';
                break;
            }
        }
    }
    flush(false);
    return polies;
}

function rawPolylinesFromElements(elements) {
    const out = [];
    for (const el of elements || []) {
        if (el.type === 'rect') {
            out.push({
                closed: true,
                fill: el.fill,
                stroke: el.stroke,
                points: [
                    { x: el.x, y: el.y },
                    { x: el.x + el.width, y: el.y },
                    { x: el.x + el.width, y: el.y + el.height },
                    { x: el.x, y: el.y + el.height },
                ],
            });
        } else if (el.type === 'line') {
            out.push({
                closed: false,
                fill: '',
                stroke: el.stroke,
                points: [{ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }],
            });
        } else if (el.type === 'polyline' || el.type === 'polygon') {
            out.push({
                closed: el.type === 'polygon' || !!el.closed,
                fill: el.fill,
                stroke: el.stroke,
                points: el.points,
            });
        } else if (el.type === 'circle' && el.r > 0) {
            const pts = [];
            for (let k = 0; k < 20; k++) {
                const a = (k / 20) * Math.PI * 2;
                pts.push({ x: el.cx + Math.cos(a) * el.r, y: el.cy + Math.sin(a) * el.r });
            }
            out.push({ closed: true, fill: el.fill, stroke: el.stroke, points: pts });
        } else if (el.type === 'ellipse' && el.rx > 0 && el.ry > 0) {
            const pts = [];
            for (let k = 0; k < 24; k++) {
                const a = (k / 24) * Math.PI * 2;
                pts.push({ x: el.cx + Math.cos(a) * el.rx, y: el.cy + Math.sin(a) * el.ry });
            }
            out.push({ closed: true, fill: el.fill, stroke: el.stroke, points: pts });
        } else if (el.type === 'path') {
            for (const p of pathToPolylines(el.d)) {
                out.push({ ...p, fill: el.fill, stroke: el.stroke });
            }
        }
    }
    return out;
}

/**
 * Chuyển đối tượng SVG đã parse sang mảng polyline chuẩn hoá `[-0.5 .. +0.5] × [-0.5 .. +0.5]`.
 */
export function svgToNormalizedPolylines(parsed) {
    if (!parsed || !parsed.elements?.length) return [];
    const [vx, vy, vw, vh] = parsed.viewBox || [0, 0, 100, 100];
    const safeW = vw > 0 ? vw : 100;
    const safeH = vh > 0 ? vh : 100;
    return rawPolylinesFromElements(parsed.elements).map(poly => ({
        closed: poly.closed,
        fill: poly.fill,
        stroke: poly.stroke,
        points: poly.points.map(pt => ({
            x: (pt.x - vx) / safeW - 0.5,
            y: (pt.y - vy) / safeH - 0.5,
        })),
    }));
}
