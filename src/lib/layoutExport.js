// Bộ xuất bản vẽ Layout Mặt Bằng Kiến Trúc có Kích Thước (chuẩn A3 / A4 Landscape, tỷ lệ kiến trúc 1:25..1:200).
// Bao gồm 3 tầng kích thước (tổng phủ bì, chuỗi trục, đoạn tường & cửa, kích thước từng món nội thất),
// Bảng thống kê nội thất, Góc 3D sơ bộ, Thước tỷ lệ, Hoa gió Bắc và Khung tên MKG.
import { dist, wallSegments, wallQuad } from './geometry';
import { catalogItem, groupName } from './furnitureCatalog';
import { parseSvgSymbol, svgToNormalizedPolylines } from './svgSymbol';

export const STANDARD_SCALES = [20, 25, 30, 40, 50, 75, 100, 125, 150, 200];

const FONT_FAMILY = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

/**
 * Chọn tỷ lệ kiến trúc chuẩn (1:20 .. 1:200) sao cho mặt bằng `(spanW_mm × spanH_mm)` vừa khung giấy `(viewportW_mm × viewportH_mm)`.
 */
export function pickArchitecturalScale(spanW_mm, spanH_mm, viewportW_mm, viewportH_mm) {
    const sw = Math.max(100, Number(spanW_mm) || 4000);
    const sh = Math.max(100, Number(spanH_mm) || 3000);
    const vw = Math.max(20, Number(viewportW_mm) || 260);
    const vh = Math.max(20, Number(viewportH_mm) || 220);
    const rawScale = Math.max(sw / vw, sh / vh);
    for (const s of STANDARD_SCALES) {
        if (s >= rawScale) return s;
    }
    return STANDARD_SCALES[STANDARD_SCALES.length - 1];
}

/**
 * Tính khung bao phủ bì (gồm nửa bề dày tường) và chuỗi tọa độ các điểm nút tường theo trục X & Y.
 */
export function computePlanOuterDimensions(plan) {
    const nodes = plan?.nodes || [];
    const walls = plan?.walls || [];
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const rawXs = [];
    const rawYs = [];

    for (const w of walls) {
        const a = nodeById.get(w.a), b = nodeById.get(w.b);
        if (!a || !b) continue;
        const halfT = (w.thickness || 110) / 2;
        minX = Math.min(minX, a.x - halfT, b.x - halfT);
        maxX = Math.max(maxX, a.x + halfT, b.x + halfT);
        minY = Math.min(minY, a.y - halfT, b.y - halfT);
        maxY = Math.max(maxY, a.y + halfT, b.y + halfT);
        rawXs.push(a.x, b.x);
        rawYs.push(a.y, b.y);
    }

    if (!Number.isFinite(minX)) {
        for (const n of nodes) {
            minX = Math.min(minX, n.x);
            maxX = Math.max(maxX, n.x);
            minY = Math.min(minY, n.y);
            maxY = Math.max(maxY, n.y);
            rawXs.push(n.x);
            rawYs.push(n.y);
        }
    }

    if (!Number.isFinite(minX)) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, totalW: 0, totalH: 0, xChain: [], yChain: [] };
    }

    const filterAxis = (arr, startBound, endBound) => {
        const sorted = [...arr, startBound, endBound]
            .filter(Number.isFinite)
            .sort((u, v) => u - v);
        const dedup = [];
        for (const v of sorted) {
            if (!dedup.length) {
                dedup.push(v);
            } else if (v - dedup[dedup.length - 1] >= 80) {
                dedup.push(v);
            }
        }
        // Đảm bảo điểm cuối cùng luôn khớp mép phủ bì ngoài cùng
        if (dedup.length && Math.abs(dedup[dedup.length - 1] - endBound) > 10) {
            if (endBound - dedup[dedup.length - 1] < 80 && dedup.length > 1) {
                dedup[dedup.length - 1] = endBound;
            } else {
                dedup.push(endBound);
            }
        }
        const chain = [];
        for (let i = 0; i < dedup.length - 1; i++) {
            const len = Math.round(dedup[i + 1] - dedup[i]);
            if (len >= 80) chain.push({ from: dedup[i], to: dedup[i + 1], len });
        }
        return chain;
    };

    const xChain = filterAxis(rawXs, minX, maxX);
    const yChain = filterAxis(rawYs, minY, maxY);

    return {
        minX,
        minY,
        maxX,
        maxY,
        totalW: Math.round(maxX - minX),
        totalH: Math.round(maxY - minY),
        xChain,
        yChain,
    };
}

/**
 * Tổng hợp bảng thống kê kích thước nội thất theo loại + quy cách (R × S × C).
 */
export function buildFurnitureSchedule(doc) {
    const map = new Map();
    for (const f of (doc?.furniture || [])) {
        const cat = catalogItem(f.kind);
        const w = Math.round(f.w || cat?.w || 600);
        const d = Math.round(f.d || cat?.d || 600);
        const h = Math.round(f.h ?? cat?.h ?? 800);
        const key = `${f.kind}__${w}x${d}x${h}`;
        if (!map.has(key)) {
            map.set(key, {
                kind: f.kind,
                name: cat?.name || f.kind || 'Nội thất',
                groupName: groupName(cat?.group),
                w,
                d,
                h,
                qty: 0,
            });
        }
        map.get(key).qty += 1;
    }

    const list = [...map.values()].map((row, idx) => ({
        index: idx + 1,
        code: `F${String(idx + 1).padStart(2, '0')}`,
        ...row,
    }));
    return list;
}

// ===== Helpers vẽ Canvas 2D kiến trúc =====

function drawArchDimLine(ctx, x1, y1, x2, y2, labelText, offsetPx = 0, opts = {}) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 6) return;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;

    const ox1 = x1 + nx * offsetPx, oy1 = y1 + ny * offsetPx;
    const ox2 = x2 + nx * offsetPx, oy2 = y2 + ny * offsetPx;
    const sign = offsetPx >= 0 ? 1 : -1;
    const ext = opts.extPx ?? 10;
    const tick = opts.tickPx ?? 5.5;
    const color = opts.color || '#0f766e';
    const fontSize = opts.fontSize || 11;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.lineWidth || 1.1;

    // Hai chân gióng
    if (Math.abs(offsetPx) > 2) {
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(x1 + nx * sign * 3, y1 + ny * sign * 3);
        ctx.lineTo(ox1 + nx * sign * ext, oy1 + ny * sign * ext);
        ctx.moveTo(x2 + nx * sign * 3, y2 + ny * sign * 3);
        ctx.lineTo(ox2 + nx * sign * ext, oy2 + ny * sign * ext);
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // Đường kích thước chính
    ctx.beginPath();
    ctx.moveTo(ox1 - ux * 4, oy1 - uy * 4);
    ctx.lineTo(ox2 + ux * 4, oy2 + uy * 4);
    ctx.stroke();

    // Tick xiên 45 độ chuẩn bản vẽ kiến trúc
    const tx = (ux + nx) * 0.7071 * tick;
    const ty = (uy + ny) * 0.7071 * tick;
    ctx.lineWidth = (opts.lineWidth || 1.1) * 1.5;
    ctx.beginPath();
    ctx.moveTo(ox1 - tx, oy1 - ty);
    ctx.lineTo(ox1 + tx, oy1 + ty);
    ctx.moveTo(ox2 - tx, oy2 - ty);
    ctx.lineTo(ox2 + tx, oy2 + ty);
    ctx.stroke();

    // Chữ kích thước nằm giữa, tự lật để không lộn ngược
    let angle = Math.atan2(dy, dx);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;

    ctx.translate((ox1 + ox2) / 2, (oy1 + oy2) / 2);
    ctx.rotate(angle);
    ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`;
    const textW = ctx.measureText(labelText).width + 8;
    ctx.fillStyle = opts.bgColor || 'rgba(255,255,255,0.92)';
    ctx.fillRect(-textW / 2, -fontSize * 0.72, textW, fontSize * 1.24);
    ctx.fillStyle = opts.textColor || color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, 0, -1);
    ctx.restore();
}

function defaultFillForCat(cat) {
    if (!cat) return 'rgba(241,245,249,0.78)';
    if (cat.fill2d) return cat.fill2d;
    if (cat.sym === 'rug') return 'rgba(254,249,195,0.34)';
    if (cat.group === 'wc' || cat.sym === 'sink' || cat.sym === 'sink2') return 'rgba(224,242,254,0.6)';
    if (['wardrobe', 'wardrobe_slide', 'cab', 'dresser', 'desk', 'nightstand', 'tvstand', 'table', 'altar', 'shoe_bench'].includes(cat.sym)) {
        return 'rgba(254,243,199,0.52)';
    }
    if (['bed', 'sofa', 'sofaL', 'armchair', 'bench'].includes(cat.sym)) return 'rgba(226,232,240,0.62)';
    return 'rgba(241,245,249,0.78)';
}

function drawFurnitureSymbolCanvas(ctx, f, cat, w, d, code, showFurnDims) {
    const hw = w / 2, hd = d / 2;
    const stroke = cat?.color2d || '#334155';
    const subStroke = '#64748b';
    const fill = defaultFillForCat(cat);

    ctx.save();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.35;

    const parsedSvg = cat?.svg2d ? parseSvgSymbol(cat.svg2d) : null;
    if (parsedSvg) {
        if (cat.sym !== 'rug') {
            ctx.fillRect(-hw, -hd, w, d);
            ctx.strokeRect(-hw, -hd, w, d);
        }
        const polies = svgToNormalizedPolylines(parsedSvg);
        for (const poly of polies) {
            if (!poly.points?.length) continue;
            ctx.beginPath();
            ctx.moveTo(poly.points[0].x * w, poly.points[0].y * d);
            for (let i = 1; i < poly.points.length; i++) {
                ctx.lineTo(poly.points[i].x * w, poly.points[i].y * d);
            }
            if (poly.closed) ctx.closePath();
            if (poly.fill && poly.fill !== 'none') {
                ctx.fillStyle = poly.fill;
                ctx.fill();
            }
            ctx.strokeStyle = poly.stroke && poly.stroke !== 'none' && poly.stroke !== 'currentColor' ? poly.stroke : stroke;
            ctx.stroke();
        }
    } else {
        // Khung bao chính
        ctx.fillRect(-hw, -hd, w, d);
        ctx.strokeRect(-hw, -hd, w, d);

        // Vạch lưng áp tường đậm hơn
        if (cat?.back) {
            ctx.save();
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-hw, -hd);
            ctx.lineTo(hw, -hd);
            ctx.stroke();
            ctx.restore();
        }

        // Chi tiết CAD đặc trưng cho các nhóm phổ biến
        ctx.strokeStyle = subStroke;
        ctx.lineWidth = 1;
        switch (cat?.sym) {
            case 'bed': {
                const hb = Math.min(d * 0.06, 6);
                const pD = Math.min(d * 0.19, 26);
                const gap = Math.min(w * 0.05, 8);
                ctx.fillStyle = 'rgba(148,163,184,0.28)';
                ctx.fillRect(-hw, -hd, w, hb);
                ctx.strokeRect(-hw, -hd, w, hb);
                const two = w > 55;
                const pw = two ? (w - gap * 3) / 2 : (w - gap * 2);
                ctx.fillStyle = '#ffffff';
                if (two) {
                    ctx.fillRect(-hw + gap, -hd + hb + gap * 0.6, pw, pD);
                    ctx.strokeRect(-hw + gap, -hd + hb + gap * 0.6, pw, pD);
                    ctx.fillRect(-hw + gap * 2 + pw, -hd + hb + gap * 0.6, pw, pD);
                    ctx.strokeRect(-hw + gap * 2 + pw, -hd + hb + gap * 0.6, pw, pD);
                } else {
                    ctx.fillRect(-hw + gap, -hd + hb + gap * 0.6, pw, pD);
                    ctx.strokeRect(-hw + gap, -hd + hb + gap * 0.6, pw, pD);
                }
                const sy = -hd + hb + pD + gap * 1.4;
                ctx.beginPath();
                ctx.moveTo(-hw + 2, sy);
                ctx.lineTo(hw - 2, sy);
                ctx.stroke();
                break;
            }
            case 'wardrobe':
            case 'wardrobe_slide': {
                ctx.beginPath();
                ctx.moveTo(-hw, -hd + d * 0.14);
                ctx.lineTo(hw, -hd + d * 0.14);
                ctx.moveTo(-hw + 3, -hd + d * 0.45);
                ctx.lineTo(hw - 3, -hd + d * 0.45);
                ctx.stroke();
                const bays = Math.max(2, Math.round(w / 24));
                for (let i = 1; i < bays; i++) {
                    const bx = -hw + (w / bays) * i;
                    ctx.beginPath();
                    ctx.moveTo(bx, -hd);
                    ctx.lineTo(bx, hd);
                    ctx.stroke();
                }
                break;
            }
            case 'sofa':
            case 'sofaL': {
                const arm = Math.min(w * 0.11, 14);
                const backD = Math.min(d * 0.24, 18);
                ctx.strokeRect(-hw, -hd, arm, d);
                ctx.strokeRect(hw - arm, -hd, arm, d);
                ctx.strokeRect(-hw + arm, -hd, w - arm * 2, backD);
                break;
            }
            case 'toilet': {
                const tankD = d * 0.27;
                ctx.strokeRect(-hw + w * 0.1, -hd, w * 0.8, tankD);
                ctx.beginPath();
                ctx.ellipse(0, hd * 0.22, w * 0.36, (d - tankD) * 0.43, 0, 0, Math.PI * 2);
                ctx.stroke();
                break;
            }
            case 'basin':
            case 'sink':
            case 'sink2': {
                ctx.beginPath();
                ctx.ellipse(0, 0, w * 0.36, d * 0.34, 0, 0, Math.PI * 2);
                ctx.stroke();
                break;
            }
            case 'hob': {
                for (const cx of [-w * 0.22, w * 0.22]) {
                    ctx.beginPath();
                    ctx.arc(cx, 0, Math.min(w, d) * 0.22, 0, Math.PI * 2);
                    ctx.stroke();
                }
                break;
            }
            case 'stairs': {
                const steps = Math.max(4, Math.min(14, Math.round(d / 12)));
                for (let i = 1; i < steps; i++) {
                    const sy = -hd + (d / steps) * i;
                    ctx.beginPath();
                    ctx.moveTo(-hw, sy);
                    ctx.lineTo(hw, sy);
                    ctx.stroke();
                }
                break;
            }
            default: {
                // Dấu chéo nhẹ góc cho tủ kệ hoặc đường gân
                if (cat?.sym === 'cab' || cat?.sym === 'kitchen_base' || cat?.sym === 'island') {
                    ctx.beginPath();
                    ctx.moveTo(-hw + 3, -hd + 3);
                    ctx.lineTo(hw - 3, hd - 3);
                    ctx.stroke();
                }
                break;
            }
        }
    }
    ctx.restore();

    // Tên + Mã F01 + kích thước (xoay ngược để luôn đọc thuận chiều)
    ctx.save();
    ctx.rotate(-((f.rot || 0) * Math.PI) / 180);
    const fs = Math.max(8, Math.min(11, Math.min(w, d) * 0.22));
    const dimLabel = `${Math.round(f.w || cat?.w || 600)}×${Math.round(f.d || cat?.d || 600)}`;
    const tagText = code ? `${code} ${cat?.name || ''}` : (cat?.name || '');

    if (w > 26 && d > 18) {
        ctx.font = `700 ${fs}px ${FONT_FAMILY}`;
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, 0, showFurnDims ? -fs * 0.55 : 0, Math.max(w, d) * 0.92);
        if (showFurnDims) {
            ctx.font = `600 ${Math.max(7.5, fs * 0.85)}px ${FONT_FAMILY}`;
            ctx.fillStyle = '#1e40af';
            ctx.fillText(dimLabel, 0, fs * 0.6, Math.max(w, d) * 0.92);
        }
    } else if (code) {
        ctx.font = `700 8.5px ${FONT_FAMILY}`;
        ctx.fillStyle = '#1e40af';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(code, 0, 0);
    }
    ctx.restore();
}

function loadImageAsync(src) {
    return new Promise((resolve) => {
        if (!src || typeof Image === 'undefined') return resolve(null);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

/**
 * Kết xuất toàn bộ bản vẽ Layout Mặt Bằng Kiến Trúc A3 / A4 có đầy đủ 3 tầng kích thước,
 * bảng thống kê nội thất, ảnh phối cảnh 3D (tuỳ chọn) và khung tên MKG ra `HTMLCanvasElement`.
 */
export async function renderPlanLayoutCanvas(doc, opts = {}) {
    const paper = opts.paper === 'A4' ? 'A4' : 'A3';
    const dpiScale = Math.max(1, Math.min(3, Number(opts.dpiScale) || 2));
    const baseW = paper === 'A4' ? 1754 : 2200;
    const baseH = paper === 'A4' ? 1240 : 1555;

    const showOuterDims = opts.showOuterDims !== false;
    const showWallDims = opts.showWallDims !== false;
    const showFurnDims = opts.showFurnDims !== false;
    const showSchedule = opts.showSchedule !== false;
    const include3D = opts.include3D !== false;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(baseW * dpiScale);
    canvas.height = Math.round(baseH * dpiScale);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpiScale, dpiScale);

    // 1. Nền giấy trắng + khung kép chuẩn bản vẽ kỹ thuật
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, baseW, baseH);

    const M = 26;
    const innerM = 40;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(M, M, baseW - M * 2, baseH - M * 2);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.strokeRect(innerM, innerM, baseW - innerM * 2, baseH - innerM * 2);

    // Mốc lưới toạ độ A-B-C-D / 1-2-3 quanh viền
    const innerW = baseW - innerM * 2;
    const innerH = baseH - innerM * 2;
    const hasRightCol = showSchedule || (include3D && !!opts.thumb3DDataURL);
    const rightColW = hasRightCol ? Math.round(innerW * 0.275) : 0;
    const mainX = innerM;
    const mainY = innerM;
    const mainW = innerW - rightColW;
    const mainH = innerH;

    ctx.font = `700 10px ${FONT_FAMILY}`;
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
    for (let i = 0; i < cols.length; i++) {
        const tx = mainX + (mainW * (i + 0.5)) / cols.length;
        ctx.fillText(cols[i], tx, (M + innerM) / 2);
        ctx.fillText(cols[i], tx, baseH - (M + innerM) / 2);
    }
    const rows = ['1', '2', '3', '4'];
    for (let i = 0; i < rows.length; i++) {
        const ty = innerM + (innerH * (i + 0.5)) / rows.length;
        ctx.fillText(rows[i], (M + innerM) / 2, ty);
        ctx.fillText(rows[i], baseW - (M + innerM) / 2, ty);
    }

    // 2. Tính khung bao & tỷ lệ chuẩn cho mặt bằng + nội thất
    const plan = doc?.plan || { nodes: [], walls: [], rooms: [] };
    const nodes = plan.nodes || [];
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const outer = computePlanOuterDimensions(plan);

    let minX = outer.totalW > 0 ? outer.minX : Infinity;
    let minY = outer.totalH > 0 ? outer.minY : Infinity;
    let maxX = outer.totalW > 0 ? outer.maxX : -Infinity;
    let maxY = outer.totalH > 0 ? outer.maxY : -Infinity;

    for (const f of (doc?.furniture || [])) {
        const cat = catalogItem(f.kind);
        const r = Math.hypot((f.w || cat?.w || 600) / 2, (f.d || cat?.d || 600) / 2);
        minX = Math.min(minX, f.x - r);
        maxX = Math.max(maxX, f.x + r);
        minY = Math.min(minY, f.y - r);
        maxY = Math.max(maxY, f.y + r);
    }
    if (!Number.isFinite(minX)) {
        minX = 0; minY = 0; maxX = 4000; maxY = 3000;
    }

    const spanW_mm = Math.max(800, maxX - minX);
    const spanH_mm = Math.max(800, maxY - minY);

    // Vùng chừa cho 2 hàng đường kích thước phủ bì trên/trái + thước tỷ lệ dưới
    const padLeft = showOuterDims ? 115 : 55;
    const padTop = showOuterDims ? 110 : 55;
    const padRight = 55;
    const padBottom = 88;
    const drawW = Math.max(200, mainW - padLeft - padRight);
    const drawH = Math.max(200, mainH - padTop - padBottom);

    // Giả định khổ giấy A3 dài ~420mm => ~0.27mm/px trên viewport vẽ chuẩn kiến trúc
    const paperViewportW_mm = drawW * (paper === 'A4' ? 297 / baseW : 420 / baseW);
    const paperViewportH_mm = drawH * (paper === 'A4' ? 210 / baseH : 297 / baseH);
    const archScale = pickArchitecturalScale(spanW_mm, spanH_mm, paperViewportW_mm, paperViewportH_mm);

    // Chỉnh tỷ lệ pixel/mm sao cho vừa khung, ưu tiên bám chuẩn tỷ lệ archScale nếu khớp
    const pxPerMm = Math.min(drawW / spanW_mm, drawH / spanH_mm);
    const contentW_px = spanW_mm * pxPerMm;
    const contentH_px = spanH_mm * pxPerMm;
    const offX = mainX + padLeft + (drawW - contentW_px) / 2 - minX * pxPerMm;
    const offY = mainY + padTop + (drawH - contentH_px) / 2 - minY * pxPerMm;
    const toX = (wx) => offX + wx * pxPerMm;
    const toY = (wy) => offY + wy * pxPerMm;

    // Cắt vùng vẽ mặt bằng
    ctx.save();
    ctx.beginPath();
    ctx.rect(mainX + 2, mainY + 2, mainW - 4, mainH - 4);
    ctx.clip();

    // Lưới nền kiến trúc nhẹ 500mm / 1000mm
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    const gridStepMm = spanW_mm > 12000 ? 1000 : 500;
    const startGx = Math.floor((minX - 1000) / gridStepMm) * gridStepMm;
    const endGx = Math.ceil((maxX + 1000) / gridStepMm) * gridStepMm;
    const startGy = Math.floor((minY - 1000) / gridStepMm) * gridStepMm;
    const endGy = Math.ceil((maxY + 1000) / gridStepMm) * gridStepMm;
    ctx.beginPath();
    for (let gx = startGx; gx <= endGx; gx += gridStepMm) {
        const px = toX(gx);
        ctx.moveTo(px, mainY);
        ctx.lineTo(px, mainY + mainH);
    }
    for (let gy = startGy; gy <= endGy; gy += gridStepMm) {
        const py = toY(gy);
        ctx.moveTo(mainX, py);
        ctx.lineTo(mainX + mainW, py);
    }
    ctx.stroke();

    // 3. Sàn các phòng + nhãn diện tích
    for (const r of (plan.rooms || [])) {
        const pts = (r.nodeIds || []).map(id => nodeById.get(id)).filter(Boolean);
        if (pts.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(toX(pts[0].x), toY(pts[0].y));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(pts[i].x), toY(pts[i].y));
        ctx.closePath();
        const isWc = /wc|vệ sinh|tắm|toilet/i.test(r.name || '');
        ctx.fillStyle = isWc ? 'rgba(224,242,254,0.45)' : 'rgba(248,250,252,0.85)';
        ctx.fill();

        if (Number.isFinite(r.cx) && Number.isFinite(r.cy)) {
            ctx.save();
            ctx.fillStyle = '#0f172a';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `700 13px ${FONT_FAMILY}`;
            ctx.fillText(r.name || 'PHÒNG', toX(r.cx), toY(r.cy) - 8);
            ctx.font = `600 11px ${FONT_FAMILY}`;
            ctx.fillStyle = '#475569';
            ctx.fillText(
                `${(r.area / 1e6).toFixed(2)} m² · CV ${(r.perimeter / 1000).toFixed(2)} m`,
                toX(r.cx),
                toY(r.cy) + 9
            );
            ctx.restore();
        }
    }

    // 4. Vẽ tường, cột, cửa đi, cửa sổ & kích thước tường (tầng 1)
    for (const w of (plan.walls || [])) {
        const a = nodeById.get(w.a), b = nodeById.get(w.b);
        if (!a || !b) continue;
        const len = dist(a, b);
        if (len < 1) continue;
        const th = w.thickness || 110;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        const nx = -uy, ny = ux;
        const segs = wallSegments(w, len);

        for (const s of segs) {
            const pA = { x: a.x + ux * s.from, y: a.y + uy * s.from };
            const pB = { x: a.x + ux * s.to, y: a.y + uy * s.to };
            if (s.kind === 'seg') {
                const qPts = wallQuad(pA, pB, th);
                ctx.beginPath();
                ctx.moveTo(toX(qPts[0].x), toY(qPts[0].y));
                for (let i = 1; i < 4; i++) ctx.lineTo(toX(qPts[i].x), toY(qPts[i].y));
                ctx.closePath();
                ctx.fillStyle = w.column ? '#1e293b' : '#cbd5e1';
                ctx.fill();
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1.6;
                ctx.stroke();

                if (showWallDims && s.to - s.from >= 220) {
                    drawArchDimLine(
                        ctx,
                        toX(pA.x), toY(pA.y),
                        toX(pB.x), toY(pB.y),
                        `${Math.round(s.to - s.from)}`,
                        Math.max(16, (th / 2) * pxPerMm + 14),
                        { color: '#334155', fontSize: 10, tickPx: 4, extPx: 6 }
                    );
                }
            } else {
                const op = (w.openings || []).find(o => o.id === s.opId);
                if (!op) continue;
                const opW = s.to - s.from;
                if (op.type === 'door') {
                    const hinge = pA;
                    const swingAngle = Math.atan2(uy, ux) + (op.flipped ? -Math.PI / 2 : Math.PI / 2);
                    const leafEnd = { x: hinge.x + Math.cos(swingAngle) * opW, y: hinge.y + Math.sin(swingAngle) * opW };
                    ctx.save();
                    ctx.strokeStyle = '#dc2626';
                    ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    ctx.moveTo(toX(hinge.x), toY(hinge.y));
                    ctx.lineTo(toX(leafEnd.x), toY(leafEnd.y));
                    ctx.stroke();
                    ctx.setLineDash([4, 3]);
                    ctx.lineWidth = 1.1;
                    const a0 = Math.atan2(pB.y - hinge.y, pB.x - hinge.x);
                    const a1 = swingAngle;
                    ctx.beginPath();
                    ctx.arc(toX(hinge.x), toY(hinge.y), opW * pxPerMm, a0, a1, !!op.flipped);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    if (showWallDims) {
                        const midX = (pA.x + pB.x) / 2, midY = (pA.y + pB.y) / 2;
                        ctx.font = `700 9.5px ${FONT_FAMILY}`;
                        ctx.fillStyle = '#b91c1c';
                        ctx.textAlign = 'center';
                        ctx.fillText(`D ${Math.round(opW)}`, toX(midX + nx * 160), toY(midY + ny * 160));
                    }
                    ctx.restore();
                } else {
                    const hT = (th / 2) * 0.72;
                    ctx.save();
                    ctx.fillStyle = '#e0f2fe';
                    ctx.strokeStyle = '#0284c7';
                    ctx.lineWidth = 1.3;
                    const qWin = wallQuad(pA, pB, th * 0.72);
                    ctx.beginPath();
                    ctx.moveTo(toX(qWin[0].x), toY(qWin[0].y));
                    for (let i = 1; i < 4; i++) ctx.lineTo(toX(qWin[i].x), toY(qWin[i].y));
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(toX(pA.x + nx * hT * 0.1), toY(pA.y + ny * hT * 0.1));
                    ctx.lineTo(toX(pB.x + nx * hT * 0.1), toY(pB.y + ny * hT * 0.1));
                    ctx.stroke();
                    if (showWallDims) {
                        const midX = (pA.x + pB.x) / 2, midY = (pA.y + pB.y) / 2;
                        ctx.font = `700 9.5px ${FONT_FAMILY}`;
                        ctx.fillStyle = '#0369a1';
                        ctx.textAlign = 'center';
                        ctx.fillText(`W ${Math.round(opW)}`, toX(midX + nx * 160), toY(midY + ny * 160));
                    }
                    ctx.restore();
                }
            }
        }
    }

    // 5. Nội thất 2D + mã F01 + kích thước món đồ
    const schedule = buildFurnitureSchedule(doc);
    const codeBySpec = new Map(schedule.map(row => [`${row.kind}__${row.w}x${row.d}x${row.h}`, row.code]));

    for (const f of (doc?.furniture || [])) {
        const cat = catalogItem(f.kind);
        const wMm = Math.round(f.w || cat?.w || 600);
        const dMm = Math.round(f.d || cat?.d || 600);
        const hMm = Math.round(f.h ?? cat?.h ?? 800);
        const wPx = wMm * pxPerMm;
        const dPx = dMm * pxPerMm;
        const code = codeBySpec.get(`${f.kind}__${wMm}x${dMm}x${hMm}`) || '';

        ctx.save();
        ctx.translate(toX(f.x), toY(f.y));
        ctx.rotate(((f.rot || 0) * Math.PI) / 180);
        drawFurnitureSymbolCanvas(ctx, f, cat, wPx, dPx, code, showFurnDims);

        // Đường dim cạnh W phía trước món đồ khi đủ rộng
        if (showFurnDims && wPx >= 34 && cat?.sym !== 'rug') {
            drawArchDimLine(
                ctx,
                -wPx / 2, dPx / 2,
                wPx / 2, dPx / 2,
                `${wMm}`,
                11,
                { color: '#1d4ed8', fontSize: 9, tickPx: 3.5, extPx: 4, lineWidth: 0.9 }
            );
        }
        ctx.restore();
    }

    // 6. Hệ kích thước phủ bì tầng 2 & tầng 3 (chuỗi trục + tổng phủ bì)
    if (showOuterDims && outer.totalW > 0 && outer.totalH > 0) {
        const topBaseY = toY(minY);
        const leftBaseX = toX(minX);

        // Tầng 2: Chuỗi kích thước từng khoảng trục ngang & đứng
        if (outer.xChain.length > 1) {
            for (const seg of outer.xChain) {
                drawArchDimLine(
                    ctx,
                    toX(seg.from), topBaseY,
                    toX(seg.to), topBaseY,
                    `${seg.len}`,
                    -36,
                    { color: '#0f766e', fontSize: 10.5 }
                );
            }
        }
        if (outer.yChain.length > 1) {
            for (const seg of outer.yChain) {
                drawArchDimLine(
                    ctx,
                    leftBaseX, toY(seg.from),
                    leftBaseX, toY(seg.to),
                    `${seg.len}`,
                    36,
                    { color: '#0f766e', fontSize: 10.5 }
                );
            }
        }

        // Tầng 3: Kích thước tổng phủ bì ngoài cùng
        drawArchDimLine(
            ctx,
            toX(outer.minX), topBaseY,
            toX(outer.maxX), topBaseY,
            `${outer.totalW} mm`,
            -68,
            { color: '#0f172a', fontSize: 12, lineWidth: 1.4 }
        );
        drawArchDimLine(
            ctx,
            leftBaseX, toY(outer.minY),
            leftBaseX, toY(outer.maxY),
            `${outer.totalH} mm`,
            68,
            { color: '#0f172a', fontSize: 12, lineWidth: 1.4 }
        );
    }

    // 7. Thước tỷ lệ + Hoa gió Bắc ở góc dưới vùng bản vẽ
    const barY = mainY + mainH - 28;
    const barX = mainX + 26;
    const oneMeterPx = 1000 * pxPerMm;
    const meters = oneMeterPx * 3 <= 280 ? 3 : oneMeterPx * 2 <= 280 ? 2 : 1;
    const segCount = meters * 2; // chia mỗi 0.5m
    const stepPx = (oneMeterPx * meters) / segCount;

    ctx.save();
    ctx.font = `700 10.5px ${FONT_FAMILY}`;
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'left';
    ctx.fillText(`THƯỚC TỶ LỆ (ĐƠN VỊ: MM) · KHUYẾN NGHỊ TỶ LỆ ~ 1:${archScale}`, barX, barY - 14);
    for (let i = 0; i < segCount; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#0f172a' : '#ffffff';
        ctx.fillRect(barX + i * stepPx, barY - 6, stepPx, 7);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX + i * stepPx, barY - 6, stepPx, 7);
    }
    ctx.fillStyle = '#475569';
    ctx.font = `600 9.5px ${FONT_FAMILY}`;
    ctx.fillText('0', barX, barY + 12);
    ctx.textAlign = 'center';
    for (let m = 1; m <= meters; m++) {
        ctx.fillText(`${m}m`, barX + oneMeterPx * m, barY + 12);
    }

    // Hoa gió Bắc (North Arrow)
    const nx = mainX + mainW - 44;
    const ny = barY - 14;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(nx, ny, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.moveTo(nx, ny - 13);
    ctx.lineTo(nx - 6, ny + 6);
    ctx.lineTo(nx, ny + 2);
    ctx.lineTo(nx + 6, ny + 6);
    ctx.closePath();
    ctx.fill();
    ctx.font = `800 10px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('B', nx, ny - 21);
    ctx.restore();

    ctx.restore(); // Kết thúc vùng clip main viewport

    // 8. Cột thông tin kỹ thuật bên phải (3D + Bảng KT nội thất + Ghi chú + Khung tên)
    if (hasRightCol) {
        const rx = mainX + mainW;
        let curY = innerM;

        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(rx, innerM);
        ctx.lineTo(rx, innerM + innerH);
        ctx.stroke();

        const titleBlockH = 195;
        const noteBoxH = opts.noteText ? 76 : 0;
        const availH = innerH - titleBlockH - noteBoxH;

        // 8a. Khung phối cảnh 3D sơ bộ
        const thumbImg = include3D && opts.thumb3DDataURL ? await loadImageAsync(opts.thumb3DDataURL) : null;
        if (thumbImg) {
            const boxH = Math.min(Math.round(availH * 0.42), Math.round(rightColW * 0.66));
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(rx, curY, rightColW, 28);
            ctx.fillStyle = '#0f172a';
            ctx.font = `700 11.5px ${FONT_FAMILY}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('GÓC PHỐI CẢNH 3D SƠ BỘ', rx + 12, curY + 14);

            const pad = 8;
            const imgBoxW = rightColW - pad * 2;
            const imgBoxH = boxH - 28 - pad;
            const sc = Math.min(imgBoxW / thumbImg.width, imgBoxH / thumbImg.height);
            const dw = thumbImg.width * sc, dh = thumbImg.height * sc;
            ctx.drawImage(
                thumbImg,
                rx + pad + (imgBoxW - dw) / 2,
                curY + 28 + (imgBoxH - dh) / 2,
                dw,
                dh
            );
            curY += boxH;
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(rx, curY);
            ctx.lineTo(rx + rightColW, curY);
            ctx.stroke();
        }

        // 8b. Bảng thống kê kích thước nội thất
        if (showSchedule) {
            const tableTop = curY;
            const tableBottom = innerM + innerH - titleBlockH - noteBoxH;
            ctx.fillStyle = '#f1f5f9';
            ctx.fillRect(rx, tableTop, rightColW, 28);
            ctx.fillStyle = '#0f172a';
            ctx.font = `700 11.5px ${FONT_FAMILY}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(`THỐNG KÊ NỘI THẤT (${(doc?.furniture || []).length} MÓN)`, rx + 12, tableTop + 14);

            const headerY = tableTop + 28;
            const colCode = rx + 8;
            const colName = rx + 46;
            const colDim = rx + rightColW - 142;
            const colQty = rx + rightColW - 22;

            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(rx, headerY, rightColW, 22);
            ctx.fillStyle = '#334155';
            ctx.font = `700 10px ${FONT_FAMILY}`;
            ctx.fillText('Mã', colCode, headerY + 11);
            ctx.fillText('Hạng mục', colName, headerY + 11);
            ctx.fillText('R×S×C (mm)', colDim, headerY + 11);
            ctx.textAlign = 'right';
            ctx.fillText('SL', colQty + 10, headerY + 11);

            const rowH = 22;
            let rowY = headerY + 22;
            const maxRows = Math.max(1, Math.floor((tableBottom - rowY - 8) / rowH));
            const shown = schedule.slice(0, maxRows);

            for (let i = 0; i < shown.length; i++) {
                const it = shown[i];
                if (i % 2 === 1) {
                    ctx.fillStyle = '#f8fafc';
                    ctx.fillRect(rx + 1, rowY, rightColW - 2, rowH);
                }
                ctx.fillStyle = '#1d4ed8';
                ctx.font = `700 10px ${FONT_FAMILY}`;
                ctx.textAlign = 'left';
                ctx.fillText(it.code, colCode, rowY + rowH / 2);

                ctx.fillStyle = '#0f172a';
                ctx.font = `600 10px ${FONT_FAMILY}`;
                ctx.fillText(it.name, colName, rowY + rowH / 2, colDim - colName - 6);

                ctx.fillStyle = '#334155';
                ctx.font = `500 10px ${FONT_FAMILY}`;
                ctx.fillText(`${it.w}×${it.d}×${it.h}`, colDim, rowY + rowH / 2);

                ctx.fillStyle = '#0f172a';
                ctx.font = `700 10px ${FONT_FAMILY}`;
                ctx.textAlign = 'right';
                ctx.fillText(String(it.qty), colQty + 10, rowY + rowH / 2);

                ctx.strokeStyle = '#e2e8f0';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(rx, rowY + rowH);
                ctx.lineTo(rx + rightColW, rowY + rowH);
                ctx.stroke();

                rowY += rowH;
            }
            if (schedule.length > maxRows) {
                ctx.fillStyle = '#64748b';
                ctx.font = `italic 10px ${FONT_FAMILY}`;
                ctx.textAlign = 'left';
                ctx.fillText(`… và ${schedule.length - maxRows} loại khác (xem file DXF)`, colCode, rowY + 12);
            }
            if (!schedule.length) {
                ctx.fillStyle = '#94a3b8';
                ctx.font = `500 11px ${FONT_FAMILY}`;
                ctx.textAlign = 'center';
                ctx.fillText('Chưa bố trí nội thất trên mặt bằng', rx + rightColW / 2, rowY + 26);
            }
        }

        // 8c. Ghi chú khảo sát
        if (opts.noteText) {
            const ny = innerM + innerH - titleBlockH - noteBoxH;
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(rx, ny);
            ctx.lineTo(rx + rightColW, ny);
            ctx.stroke();
            ctx.fillStyle = '#0f172a';
            ctx.font = `700 10.5px ${FONT_FAMILY}`;
            ctx.textAlign = 'left';
            ctx.fillText('GHI CHÚ KỸ THUẬT:', rx + 12, ny + 16);
            ctx.font = `500 10.5px ${FONT_FAMILY}`;
            ctx.fillStyle = '#334155';
            ctx.fillText(String(opts.noteText), rx + 12, ny + 38, rightColW - 24);
        }

        // 8d. Khung tên chuẩn MKG (Title Block)
        const tbY = innerM + innerH - titleBlockH;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(rx, tbY, rightColW, 38);
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 13px ${FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('MKG · BỐ TRÍ MẶT BẰNG NỘI THẤT', rx + 12, tbY + 19);

        const dateStr = new Date().toLocaleDateString('vi-VN');
        const rowsTB = [
            ['CÔNG TRÌNH', opts.projectTitle || doc?.name || 'Khảo sát mặt bằng'],
            ['BẢN VẼ', doc?.name || 'Mặt bằng kích thước nội thất'],
            ['PHỦ BÌ TỔNG', outer.totalW > 0 ? `${outer.totalW} × ${outer.totalH} mm` : `${Math.round(spanW_mm)} × ${Math.round(spanH_mm)} mm`],
            ['TỶ LỆ / KHỔ', `~ 1:${archScale}  ·  ${paper} Ngang  ·  Ngày ${dateStr}`],
            ['THỰC HIỆN', opts.authorName || 'MKG Khảo Sát Studio'],
        ];
        const rowStep = (titleBlockH - 38) / rowsTB.length;
        rowsTB.forEach(([k, v], idx) => {
            const y0 = tbY + 38 + idx * rowStep;
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(rx, y0);
            ctx.lineTo(rx + rightColW, y0);
            ctx.stroke();

            ctx.fillStyle = '#64748b';
            ctx.font = `700 9.5px ${FONT_FAMILY}`;
            ctx.fillText(k, rx + 12, y0 + rowStep / 2);

            ctx.fillStyle = '#0f172a';
            ctx.font = `700 11px ${FONT_FAMILY}`;
            ctx.fillText(String(v), rx + 104, y0 + rowStep / 2, rightColW - 116);
        });
    } else {
        // Nhãn gọn dưới góc phải khi ẩn toàn bộ cột phải
        ctx.save();
        ctx.fillStyle = '#0f172a';
        ctx.font = `800 12px ${FONT_FAMILY}`;
        ctx.textAlign = 'right';
        ctx.fillText(
            `${opts.projectTitle || doc?.name || 'MẶT BẰNG'} · Tỷ lệ ~1:${archScale} (${paper})`,
            baseW - innerM - 16,
            baseH - innerM - 18
        );
        ctx.restore();
    }

    return canvas;
}

/**
 * Mở cửa sổ in / lưu PDF chuẩn A3 hoặc A4 Landscape từ ảnh dataURL Layout.
 */
export function printLayoutDataURL(dataURL, title = 'Layout Mặt Bằng', paper = 'A3') {
    if (typeof window === 'undefined' || !dataURL) return false;
    const win = window.open('', '_blank');
    if (!win) return false;
    const safeTitle = String(title).replace(/[<>]/g, '');
    const p = paper === 'A4' ? 'A4' : 'A3';
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>
@page { size: ${p} landscape; margin: 0; }
html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #fff; display: flex; align-items: center; justify-content: center; }
img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
</style></head><body><img src="${dataURL}" alt="${safeTitle}" />
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 180); };</script>
</body></html>`);
    win.document.close();
    return true;
}
