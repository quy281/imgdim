import { genId } from './geometry.js';

export const SURFACE_PRESETS = [
    { key: 'lavabo_top', name: 'Bàn đá Lavabo', surfaceType: 'Đá Lavabo', w: 1000, h: 550, thickness: 20, defaultCutouts: ['lavabo', 'faucet'] },
    { key: 'kitchen_top', name: 'Bàn đá Bếp', surfaceType: 'Đá Bếp', w: 2400, h: 620, thickness: 20, defaultCutouts: ['hob', 'sink'] },
    { key: 'wall_elec', name: 'Tường Ổ điện / KT', surfaceType: 'Tường / Vách', w: 2400, h: 2600, thickness: 110, defaultCutouts: ['socket2'] },
    { key: 'island_top', name: 'Đảo bếp', surfaceType: 'Đá Đảo', w: 2000, h: 900, thickness: 20, defaultCutouts: ['hob'] },
    { key: 'custom', name: 'Khổ tuỳ chỉnh', surfaceType: 'Mặt phẳng', w: 1200, h: 600, thickness: 20, defaultCutouts: ['rect'] },
];

export const CUTOUT_PRESETS = {
    hob: { key: 'hob', name: 'Bếp từ / Âm', shape: 'rect', w: 680, h: 380, r: 20, color: '#f59e0b' },
    sink: { key: 'sink', name: 'Chậu rửa bát', shape: 'rect', w: 780, h: 450, r: 15, color: '#38bdf8' },
    lavabo: { key: 'lavabo', name: 'Lỗ Lavabo', shape: 'rect', w: 520, h: 380, r: 40, color: '#22d3ee' },
    faucet: { key: 'faucet', name: 'Lỗ vòi Ø35', shape: 'circle', w: 35, h: 35, r: 17.5, color: '#60a5fa' },
    pipe90: { key: 'pipe90', name: 'Ống thoát Ø90', shape: 'circle', w: 90, h: 90, r: 45, color: '#60a5fa' },
    pipe150: { key: 'pipe150', name: 'Ống hút mùi Ø150', shape: 'circle', w: 150, h: 150, r: 75, color: '#c084fc' },
    socket1: { key: 'socket1', name: 'Ổ điện đơn', shape: 'rect', w: 86, h: 86, r: 4, color: '#34d399' },
    socket2: { key: 'socket2', name: 'Ổ điện đôi', shape: 'rect', w: 156, h: 86, r: 4, color: '#34d399' },
    socket3: { key: 'socket3', name: 'Ổ điện ba', shape: 'rect', w: 226, h: 86, r: 4, color: '#34d399' },
    rect: { key: 'rect', name: 'Lỗ chữ nhật', shape: 'rect', w: 300, h: 200, r: 0, color: '#818cf8' },
};

export const ROUND_PRESETS = [
    { key: 'faucet', name: 'Lỗ vòi Ø35', d: 35 },
    { key: 'pipe60', name: 'Luồn dây Ø60', d: 60 },
    { key: 'pipe90', name: 'Ống thoát Ø90', d: 90 },
    { key: 'pipe150', name: 'Hút mùi Ø150', d: 150 },
];

export const SOCKET_PRESETS = [
    { key: 'socket1', name: 'Ổ đơn (86×86)', w: 86, h: 86 },
    { key: 'socket2', name: 'Ổ đôi (156×86)', w: 156, h: 86 },
    { key: 'socket3', name: 'Ổ ba (226×86)', w: 226, h: 86 },
    { key: 'tv_box', name: 'Hộp chờ TV (160×110)', w: 160, h: 110 },
];

export function makeCutoutItem(presetKey = 'rect', outer = { w: 1000, h: 550 }, custom = {}) {
    const p = CUTOUT_PRESETS[presetKey] || CUTOUT_PRESETS.rect;
    const isCircle = (custom.shape || p.shape) === 'circle';
    const rawW = Number(custom.w ?? p.w) || 200;
    const rawH = isCircle ? rawW : (Number(custom.h ?? p.h) || 200);
    const w = Math.min(rawW, Math.max(20, outer.w - 20));
    const h = Math.min(rawH, Math.max(20, outer.h - 20));
    const r = isCircle ? w / 2 : Math.min(Number(custom.r ?? p.r ?? 0) || 0, Math.min(w, h) / 2);
    const x = custom.x != null ? Number(custom.x) : Math.round((outer.w - w) / 2);
    const y = custom.y != null ? Number(custom.y) : Math.round((outer.h - h) / 2);
    return clampCutout(outer, {
        id: genId('h'),
        kind: presetKey,
        name: custom.name || p.name,
        shape: isCircle ? 'circle' : 'rect',
        x,
        y,
        w: Math.round(w),
        h: Math.round(h),
        r: Math.round(r * 10) / 10,
        color: custom.color || p.color || '#38bdf8',
        note: custom.note || '',
    });
}

export function newCutoutDoc(projectId, name, presetKey = 'lavabo_top') {
    const now = Date.now();
    const preset = SURFACE_PRESETS.find(s => s.key === presetKey) || SURFACE_PRESETS[0];
    const outer = { w: preset.w, h: preset.h };
    let cutouts = [];
    if (presetKey === 'lavabo_top') {
        const lav = makeCutoutItem('lavabo', outer);
        const faucetY = Math.max(20, Math.round(lav.y / 2 - 17));
        const fau = makeCutoutItem('faucet', outer, {
            x: Math.round(outer.w / 2 - 17),
            y: faucetY,
        });
        cutouts = [lav, fau];
    } else if (presetKey === 'kitchen_top') {
        const hob = makeCutoutItem('hob', outer, {
            x: Math.round(outer.w * 0.25 - 340),
            y: Math.round((outer.h - 380) / 2),
        });
        const sink = makeCutoutItem('sink', outer, {
            x: Math.round(outer.w * 0.72 - 390),
            y: Math.round((outer.h - 450) / 2),
        });
        cutouts = [hob, sink];
    } else if (presetKey === 'wall_elec') {
        cutouts = [
            makeCutoutItem('socket2', outer, {
                x: Math.round(outer.w / 2 - 78),
                y: Math.round(outer.h - 1100 - 43), // cao độ tâm 1100mm từ sàn
            }),
        ];
    } else {
        cutouts = [makeCutoutItem(preset.defaultCutouts[0] || 'rect', outer)];
    }

    return {
        id: genId('d'),
        projectId,
        type: 'cutout',
        name: name || preset.name,
        cutout: {
            presetKey: preset.key,
            surfaceType: preset.surfaceType,
            w: preset.w,
            h: preset.h,
            thickness: preset.thickness,
            theme: 'dark',
            refMode: 'edge', // 'edge' | 'center'
            cutouts,
        },
        settings: { gridSnap: true, gridMinor: 10, gridMajor: 100 },
        view: null,
        thumb: null,
        createdAt: now,
        updatedAt: now,
    };
}

export function clampCutout(outer, hole) {
    const ow = Math.max(40, Math.round(Number(outer?.w) || 1000));
    const oh = Math.max(40, Math.round(Number(outer?.h) || 550));
    const isCircle = hole.shape === 'circle';
    const w = Math.max(10, Math.min(ow, Math.round(Number(hole.w) || 100)));
    const h = isCircle ? w : Math.max(10, Math.min(oh, Math.round(Number(hole.h) || 100)));
    const maxX = Math.max(0, ow - w);
    const maxY = Math.max(0, oh - h);
    const x = Math.max(0, Math.min(maxX, Math.round(Number(hole.x) || 0)));
    const y = Math.max(0, Math.min(maxY, Math.round(Number(hole.y) || 0)));
    const r = isCircle ? w / 2 : Math.max(0, Math.min(Math.min(w, h) / 2, Number(hole.r) || 0));
    return { ...hole, x, y, w, h, r };
}

/**
 * Khoảng cách 4 chiều từ lỗ ra 4 mép của bề mặt ngoài (mm).
 * Hỗ trợ refMode = 'edge' (mép lỗ) hoặc 'center' (tâm lỗ).
 */
export function cutoutOffsets(outer, hole, refMode = 'edge') {
    const ow = Number(outer?.w) || 0;
    const oh = Number(outer?.h) || 0;
    if (refMode === 'center') {
        const cx = hole.x + hole.w / 2;
        const cy = hole.y + hole.h / 2;
        return {
            left: Math.round(cx),
            right: Math.round(ow - cx),
            top: Math.round(cy),
            bottom: Math.round(oh - cy),
        };
    }
    return {
        left: Math.round(hole.x),
        right: Math.round(ow - (hole.x + hole.w)),
        top: Math.round(hole.y),
        bottom: Math.round(oh - (hole.y + hole.h)),
    };
}

export function applyCutoutOffset(outer, hole, side, valMm, refMode = 'edge') {
    const v = Number(valMm);
    if (!Number.isFinite(v) || v < 0) return hole;
    const ow = Math.max(40, Number(outer?.w) || 1000);
    const oh = Math.max(40, Number(outer?.h) || 550);
    let { x, y } = hole;
    if (refMode === 'center') {
        if (side === 'left') x = v - hole.w / 2;
        else if (side === 'right') x = ow - v - hole.w / 2;
        else if (side === 'top') y = v - hole.h / 2;
        else if (side === 'bottom') y = oh - v - hole.h / 2;
    } else {
        if (side === 'left') x = v;
        else if (side === 'right') x = ow - v - hole.w;
        else if (side === 'top') y = v;
        else if (side === 'bottom') y = oh - v - hole.h;
    }
    return clampCutout(outer, { ...hole, x, y });
}

export function applyCutoutSize(outer, hole, dimKey, valMm) {
    const v = Number(valMm);
    if (!Number.isFinite(v)) return hole;
    const ow = Math.max(40, Number(outer?.w) || 1000);
    const oh = Math.max(40, Number(outer?.h) || 550);
    const cx = hole.x + hole.w / 2;
    const cy = hole.y + hole.h / 2;

    if (dimKey === 'r') {
        if (v < 0 || hole.shape === 'circle') return hole;
        return clampCutout(outer, { ...hole, r: v });
    }
    if (v <= 0) return hole;

    if (hole.shape === 'circle' || dimKey === 'd') {
        const dia = Math.max(8, Math.min(Math.min(ow, oh), Math.round(v)));
        return clampCutout(outer, {
            ...hole,
            w: dia,
            h: dia,
            r: dia / 2,
            x: Math.round(cx - dia / 2),
            y: Math.round(cy - dia / 2),
        });
    }
    if (dimKey === 'w') {
        const w = Math.max(10, Math.min(ow, Math.round(v)));
        return clampCutout(outer, { ...hole, w });
    }
    if (dimKey === 'h') {
        const h = Math.max(10, Math.min(oh, Math.round(v)));
        return clampCutout(outer, { ...hole, h });
    }
    return hole;
}

export function centerCutout(outer, hole, axis = 'both') {
    const ow = Number(outer?.w) || 1000;
    const oh = Number(outer?.h) || 550;
    const next = { ...hole };
    if (axis === 'x' || axis === 'both') next.x = Math.round((ow - hole.w) / 2);
    if (axis === 'y' || axis === 'both') next.y = Math.round((oh - hole.h) / 2);
    return clampCutout(outer, next);
}

/**
 * Tự động hít trục giữa bề mặt & căn hàng với các lỗ xung quanh khi kéo tay.
 */
export function snapCutoutPosition(outer, allHoles, activeHole, pos, tol = 22) {
    const ow = Number(outer?.w) || 1000;
    const oh = Number(outer?.h) || 550;
    let x = Math.max(0, Math.min(ow - activeHole.w, Math.round(pos.x)));
    let y = Math.max(0, Math.min(oh - activeHole.h, Math.round(pos.y)));
    const guides = [];

    const cx = x + activeHole.w / 2;
    const cy = y + activeHole.h / 2;
    const midX = ow / 2;
    const midY = oh / 2;

    let snappedX = false;
    let snappedY = false;

    if (Math.abs(cx - midX) <= tol) {
        x = Math.round(midX - activeHole.w / 2);
        snappedX = true;
        guides.push({ x1: midX, y1: 0, x2: midX, y2: oh, kind: 'center' });
    }
    if (Math.abs(cy - midY) <= tol) {
        y = Math.round(midY - activeHole.h / 2);
        snappedY = true;
        guides.push({ x1: 0, y1: midY, x2: ow, y2: midY, kind: 'center' });
    }

    for (const o of (allHoles || [])) {
        if (!o || o.id === activeHole.id) continue;
        const ocx = o.x + o.w / 2;
        const ocy = o.y + o.h / 2;
        if (!snappedX && Math.abs((x + activeHole.w / 2) - ocx) <= tol) {
            x = Math.round(ocx - activeHole.w / 2);
            snappedX = true;
            guides.push({ x1: ocx, y1: Math.min(y, o.y), x2: ocx, y2: Math.max(y + activeHole.h, o.y + o.h), kind: 'align' });
        }
        if (!snappedY && Math.abs((y + activeHole.h / 2) - ocy) <= tol) {
            y = Math.round(ocy - activeHole.h / 2);
            snappedY = true;
            guides.push({ x1: Math.min(x, o.x), y1: ocy, x2: Math.max(x + activeHole.w, o.x + o.w), y2: ocy, kind: 'align' });
        }
        if (!snappedY && Math.abs(y - o.y) <= tol) {
            y = o.y;
            snappedY = true;
            guides.push({ x1: Math.min(x, o.x), y1: y, x2: Math.max(x + activeHole.w, o.x + o.w), y2: y, kind: 'align' });
        }
    }

    const clamped = clampCutout(outer, { ...activeHole, x, y });
    return { x: clamped.x, y: clamped.y, guides };
}

export function makeCutoutThumb(cutout) {
    if (typeof document === 'undefined' || !cutout) return null;
    const size = 360;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;

    const isDark = cutout.theme !== 'light';
    ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
    ctx.fillRect(0, 0, size, size);

    const ow = Math.max(1, Number(cutout.w) || 1000);
    const oh = Math.max(1, Number(cutout.h) || 550);
    const pad = 42;
    const s = Math.min((size - pad * 2) / ow, (size - pad * 2) / oh);
    const ox = (size - ow * s) / 2;
    const oy = (size - oh * s) / 2;

    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.05)' : '#ffffff';
    ctx.strokeStyle = isDark ? '#f8fafc' : '#0f172a';
    ctx.lineWidth = 2.2;
    ctx.fillRect(ox, oy, ow * s, oh * s);
    ctx.strokeRect(ox, oy, ow * s, oh * s);

    for (const hole of (cutout.cutouts || [])) {
        const hx = ox + hole.x * s;
        const hy = oy + hole.y * s;
        const hw = Math.max(3, hole.w * s);
        const hh = Math.max(3, hole.h * s);
        ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.22)' : 'rgba(37, 99, 235, 0.14)';
        ctx.strokeStyle = hole.color || '#38bdf8';
        ctx.lineWidth = 1.8;
        if (hole.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(hx + hw / 2, hy + hh / 2, hw / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        } else {
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(hx, hy, hw, hh, Math.min((hole.r || 0) * s, hw / 2, hh / 2));
            else ctx.rect(hx, hy, hw, hh);
            ctx.fill();
            ctx.stroke();
        }
    }

    ctx.fillStyle = isDark ? '#cbd5e1' : '#334155';
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(ow)} × ${Math.round(oh)} mm`, size / 2, size - 16);

    try {
        return c.toDataURL('image/jpeg', 0.82);
    } catch {
        return null;
    }
}
