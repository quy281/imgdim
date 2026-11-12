// Mô hình tham số 2.5D/3D (Parametric Box Tree) cho nội thất MKG Khảo Sát.
// Từ cấu hình tham số gọn nhẹ (khoang, đợt, ngăn kéo, suốt treo, cánh, chân đế...)
// sinh ra danh sách các tấm hộp 3D rời nhau `Panel3D[]` trong hệ tọa độ cục bộ:
//   x: 0 → w  (trái sang phải khi đứng đối diện mặt trước tủ)
//   y: 0 → d  (từ mặt lưng áp tường y=0 ra mặt trước hướng vào phòng y=d)
//   z: 0 → h  (từ đáy món đồ z=0 lên đỉnh z=h)

export const DOOR_TYPES = [
    { key: 'none', label: 'Không cánh' },
    { key: 'left', label: 'Mở trái' },
    { key: 'right', label: 'Mở phải' },
    { key: 'double', label: 'Mở đôi' },
    { key: 'flap', label: 'Cánh lật' },
    { key: 'sliding', label: 'Cửa lùa' },
];

export const MATERIAL_PALETTE = [
    { key: 'oak', name: 'Sồi tự nhiên', body: '#cfa06e', front: '#f8fafc' },
    { key: 'walnut', name: 'Óc chó', body: '#7c5338', front: '#e2e8f0' },
    { key: 'all_oak', name: 'Full vân gỗ', body: '#cfa06e', front: '#d8ad7f' },
    { key: 'white_grey', name: 'Trắng · Ghi', body: '#cbd5e1', front: '#ffffff' },
    { key: 'anthracite', name: 'Xám chì', body: '#64748b', front: '#94a3b8' },
];

// Những nhóm đồ mộc dạng thùng/khoang cho phép chỉnh chi tiết khoang - đợt - cánh
const CABINET_KINDS = new Set([
    'wardrobe', 'headboard', 'nightstand', 'dresser', 'desk',
    'tvstand', 'cabinet', 'mirrorcab',
    'kitchen15', 'kitchen24', 'kitchen30', 'kitchenup24', 'kitchenup30', 'island',
    'winecab', 'altar', 'altarsmall', 'altarhang', 'shoecab',
]);

export function isParametricCabinet(kind) {
    return CABINET_KINDS.has(kind);
}

function makeDefaultBays(kind, w, h) {
    switch (kind) {
        case 'wardrobe': {
            const n = Math.max(1, Math.min(6, Math.round(w / 800)));
            return Array.from({ length: n }, (_, i) => (
                i === 0
                    ? { widthRatio: 1, shelves: Math.max(3, Math.round(h / 520) - 1), drawers: 0, hangingRod: false, door: w / n >= 680 ? 'double' : 'left' }
                    : { widthRatio: 1, shelves: 1, drawers: 2, drawerTotalH: 420, hangingRod: true, door: w / n >= 680 ? 'double' : (i % 2 ? 'left' : 'right') }
            ));
        }
        case 'kitchen15':
        case 'kitchen24':
        case 'kitchen30': {
            const n = Math.max(2, Math.min(6, Math.round(w / 750)));
            return Array.from({ length: n }, (_, i) => (
                i === 0
                    ? { widthRatio: 1, shelves: 0, drawers: 3, drawerTotalH: h - 140, hangingRod: false, door: 'none' }
                    : { widthRatio: 1, shelves: 1, drawers: 0, hangingRod: false, door: w / n >= 650 ? 'double' : 'right' }
            ));
        }
        case 'kitchenup24':
        case 'kitchenup30': {
            const n = Math.max(2, Math.min(6, Math.round(w / 750)));
            return Array.from({ length: n }, (_, i) => ({
                widthRatio: 1,
                shelves: 1,
                drawers: 0,
                hangingRod: false,
                door: i === 1 ? 'flap' : (w / n >= 650 ? 'double' : 'left'),
            }));
        }
        case 'tvstand': {
            const n = Math.max(2, Math.min(4, Math.round(w / 600)));
            return Array.from({ length: n }, (_, i) => (
                i === Math.floor(n / 2)
                    ? { widthRatio: 1, shelves: 1, drawers: 0, hangingRod: false, door: 'none' }
                    : { widthRatio: 1, shelves: 0, drawers: 1, drawerTotalH: h - 90, hangingRod: false, door: 'none' }
            ));
        }
        case 'shoecab': {
            const n = Math.max(1, Math.min(3, Math.round(w / 650)));
            return Array.from({ length: n }, (_, i) => ({
                widthRatio: 1,
                shelves: 4,
                drawers: i === 0 ? 1 : 0,
                drawerTotalH: 180,
                hangingRod: false,
                door: w / n >= 650 ? 'double' : 'left',
            }));
        }
        case 'winecab':
        case 'cabinet': {
            const n = Math.max(1, Math.min(4, Math.round(w / 600)));
            return Array.from({ length: n }, (_, i) => ({
                widthRatio: 1,
                shelves: 4,
                drawers: i === 0 ? 2 : 0,
                drawerTotalH: 400,
                hangingRod: false,
                door: i === 0 ? 'none' : (w / n >= 650 ? 'double' : 'right'),
            }));
        }
        case 'mirrorcab': {
            const n = w >= 700 ? 2 : 1;
            return Array.from({ length: n }, (_, i) => ({
                widthRatio: 1,
                shelves: 2,
                drawers: 0,
                hangingRod: false,
                door: n === 1 ? 'left' : (i === 0 ? 'left' : 'right'),
            }));
        }
        case 'nightstand':
            return [{ widthRatio: 1, shelves: 0, drawers: 2, drawerTotalH: Math.max(240, h - 120), hangingRod: false, door: 'none' }];
        case 'dresser':
        case 'desk':
            return [
                { widthRatio: 1.8, shelves: 0, drawers: 1, drawerTotalH: 140, hangingRod: false, door: 'none', kneehole: true },
                { widthRatio: 1, shelves: 0, drawers: 3, drawerTotalH: Math.max(420, h - 120), hangingRod: false, door: 'none' },
            ];
        case 'island': {
            const n = Math.max(2, Math.round(w / 800));
            return Array.from({ length: n }, (_, i) => ({
                widthRatio: 1,
                shelves: 1,
                drawers: i === 0 ? 3 : 0,
                drawerTotalH: h - 140,
                hangingRod: false,
                door: i === 0 ? 'none' : 'double',
            }));
        }
        case 'headboard': {
            const n = Math.max(3, Math.round(w / 500));
            return Array.from({ length: n }, () => ({
                widthRatio: 1, shelves: 0, drawers: 0, hangingRod: false, door: 'none',
            }));
        }
        default: {
            const n = Math.max(1, Math.min(4, Math.round(w / 800)));
            return Array.from({ length: n }, () => ({
                widthRatio: 1,
                shelves: h >= 900 ? 2 : 1,
                drawers: 0,
                hangingRod: false,
                door: w / n >= 650 ? 'double' : 'left',
            }));
        }
    }
}

/**
 * Cấu hình tham số mặc định theo chủng loại món đồ và kích thước bao.
 */
export function defaultParametricConfig(kind, size = {}) {
    const w = Math.max(200, Number(size.w) || 1200);
    const d = Math.max(100, Number(size.d) || 600);
    const h = Math.max(150, Number(size.h) || 850);

    const isWallHung = kind === 'kitchenup24' || kind === 'kitchenup30' || kind === 'mirrorcab' || kind === 'altarhang';
    const hasCountertop = kind === 'kitchen15' || kind === 'kitchen24' || kind === 'kitchen30' || kind === 'island';

    let plinthH = 80;
    if (isWallHung || kind === 'headboard') plinthH = 0;
    else if (hasCountertop) plinthH = 100;
    else if (h <= 550) plinthH = 50;

    return {
        boardT: 18,
        backT: d <= 180 ? 9 : 9,
        plinthH,
        countertopT: hasCountertop ? 20 : 0,
        palette: 'oak',
        colorBody: '#cfa06e',
        colorFront: '#f8fafc',
        bays: makeDefaultBays(kind, w, h),
        cutBayIndex: 0,
        zCutRatio: 0.55,
    };
}

/**
 * Hợp nhất cấu hình mặc định và phần người dùng đã chỉnh trong `item.param`.
 */
export function resolveParametricConfig(item, cat) {
    const w = Math.max(120, Number(item?.w || cat?.w || 600));
    const d = Math.max(60, Number(item?.d || cat?.d || 600));
    const h = Math.max(80, Number(item?.h ?? cat?.h ?? 800));
    const base = defaultParametricConfig(item?.kind, { w, d, h });
    const ov = item?.param || {};
    const bays = Array.isArray(ov.bays) && ov.bays.length > 0
        ? ov.bays.map(b => ({
            widthRatio: Math.max(0.2, Number(b.widthRatio) || 1),
            shelves: Math.max(0, Math.min(10, Math.round(Number(b.shelves) || 0))),
            drawers: Math.max(0, Math.min(6, Math.round(Number(b.drawers) || 0))),
            drawerTotalH: b.drawerTotalH ? Number(b.drawerTotalH) : undefined,
            hangingRod: !!b.hangingRod,
            door: b.door || 'none',
            kneehole: !!b.kneehole,
        }))
        : base.bays;

    return {
        ...base,
        ...ov,
        w,
        d,
        h,
        boardT: Math.max(12, Math.min(36, Number(ov.boardT ?? base.boardT) || 18)),
        backT: Math.max(3, Math.min(18, Number(ov.backT ?? base.backT) || 9)),
        plinthH: Math.max(0, Math.min(Math.floor(h * 0.4), Number(ov.plinthH ?? base.plinthH) || 0)),
        countertopT: Math.max(0, Math.min(60, Number(ov.countertopT ?? base.countertopT) || 0)),
        bays,
        cutBayIndex: Math.max(0, Math.min(bays.length - 1, Number(ov.cutBayIndex ?? base.cutBayIndex) || 0)),
        zCutRatio: Math.max(0.15, Math.min(0.85, Number(ov.zCutRatio ?? base.zCutRatio) || 0.55)),
    };
}

/**
 * Thay đổi nhanh số lượng khoang đứng, giữ cấu hình các khoang cũ nếu có.
 */
export function setBayCount(config, newCount) {
    const n = Math.max(1, Math.min(6, Math.round(newCount)));
    const cur = config.bays || [];
    if (cur.length === n) return config;
    const nextBays = Array.from({ length: n }, (_, i) => {
        if (cur[i]) return { ...cur[i] };
        const tpl = cur[cur.length - 1] || { widthRatio: 1, shelves: 2, drawers: 0, hangingRod: false, door: 'left' };
        return { ...tpl };
    });
    return {
        ...config,
        bays: nextBays,
        cutBayIndex: Math.min(config.cutBayIndex || 0, n - 1),
    };
}

/**
 * Dựng mô hình hộp 3D cho các món không phải tủ khoang (giường, sofa, bàn, thiết bị...)
 * để mọi món nội thất đều xem được đủ 6 mặt và phối cảnh 3D.
 */
function generateNonCabinetPanels(item, cat, cfg) {
    const { w, d, h } = cfg;
    const sym = cat?.sym || 'box';
    const panels = [];
    const add = (id, role, x, y, z, dx, dy, dz, color, extra = {}) => {
        if (dx <= 1 || dy <= 1 || dz <= 1) return;
        panels.push({ id, role, x, y, z, dx, dy, dz, color, ...extra });
    };

    const wood = cfg.colorBody || '#cfa06e';
    const fabric = '#e2e8f0';
    const white = '#f8fafc';
    const dark = '#475569';

    if (sym === 'bed') {
        const frameH = Math.min(300, h * 0.68);
        const mattH = Math.max(80, h - frameH);
        const headH = Math.max(h + 500, 950);
        const headT = Math.min(90, d * 0.06);
        add('headboard', 'back', 0, 0, 0, w, headT, headH, wood);
        add('bed_frame', 'bottom', 0, headT, 0, w, d - headT, frameH, wood);
        add('mattress', 'shelf', 30, headT + 15, frameH, w - 60, d - headT - 45, mattH, white);
        const pw = Math.min(620, (w - 180) / 2);
        if (w >= 1400) {
            add('pillow_l', 'top', 70, headT + 40, frameH + mattH, pw, 280, 90, fabric);
            add('pillow_r', 'top', w - 70 - pw, headT + 40, frameH + mattH, pw, 280, 90, fabric);
        } else {
            add('pillow_c', 'top', (w - pw) / 2, headT + 40, frameH + mattH, pw, 280, 90, fabric);
        }
        return {
            panels,
            baysInfo: [{ index: 0, x0: 30, x1: w - 30, clearW: w - 60, z0: 0, z1: h }],
            xCutDefault: w / 2,
            zCutDefault: frameH * 0.6,
        };
    }

    if (sym === 'sofa') {
        const seatH = Math.min(420, h * 0.52);
        const armW = Math.min(200, w * 0.11);
        const backD = Math.min(220, d * 0.25);
        add('sofa_back', 'back', 0, 0, 0, w, backD, h, fabric);
        add('sofa_arm_l', 'side', 0, backD, 0, armW, d - backD, Math.min(h * 0.78, 620), fabric);
        add('sofa_arm_r', 'side', w - armW, backD, 0, armW, d - backD, Math.min(h * 0.78, 620), fabric);
        add('sofa_seat', 'bottom', armW, backD, 0, w - armW * 2, d - backD, seatH, '#cbd5e1');
        return {
            panels,
            baysInfo: [{ index: 0, x0: armW, x1: w - armW, clearW: w - armW * 2, z0: 0, z1: h }],
            xCutDefault: w / 2,
            zCutDefault: seatH * 0.8,
        };
    }

    if (sym === 'table' || item?.kind === 'coffee') {
        const topT = 36;
        const leg = Math.min(65, w * 0.08, d * 0.1);
        const inX = 40, inY = 40;
        add('tbl_top', 'top', 0, 0, h - topT, w, d, topT, wood);
        add('leg_fl', 'side', inX, d - inY - leg, 0, leg, leg, h - topT, wood);
        add('leg_fr', 'side', w - inX - leg, d - inY - leg, 0, leg, leg, h - topT, wood);
        add('leg_bl', 'side', inX, inY, 0, leg, leg, h - topT, wood);
        add('leg_br', 'side', w - inX - leg, inY, 0, leg, leg, h - topT, wood);
        return {
            panels,
            baysInfo: [{ index: 0, x0: inX + leg, x1: w - inX - leg, clearW: w - (inX + leg) * 2, z0: 0, z1: h - topT }],
            xCutDefault: w / 2,
            zCutDefault: h * 0.5,
        };
    }

    if (sym === 'altar' && item?.kind !== 'altarhang') {
        const topT = 40;
        const leg = 80;
        add('altar_top', 'top', 0, 0, h - topT, w, d, topT, '#7c5338');
        add('altar_apron', 'shelf', leg, d - 60, h - topT - 180, w - leg * 2, 30, 180, '#7c5338');
        add('altar_shelf', 'shelf', leg, 40, Math.round(h * 0.35), w - leg * 2, d - 80, 25, '#7c5338');
        add('leg_fl', 'side', 0, d - leg, 0, leg, leg, h - topT, '#7c5338');
        add('leg_fr', 'side', w - leg, d - leg, 0, leg, leg, h - topT, '#7c5338');
        add('leg_bl', 'side', 0, 0, 0, leg, leg, h - topT, '#7c5338');
        add('leg_br', 'side', w - leg, 0, 0, leg, leg, h - topT, '#7c5338');
        return {
            panels,
            baysInfo: [{ index: 0, x0: leg, x1: w - leg, clearW: w - leg * 2, z0: 0, z1: h - topT }],
            xCutDefault: w / 2,
            zCutDefault: h * 0.5,
        };
    }

    // Mặc định: khối hộp kỹ thuật (tủ lạnh, máy giặt, TV, thiết bị...)
    add('body_box', 'side', 0, 0, 0, w, d, h, sym === 'tv' ? dark : white);
    return {
        panels,
        baysInfo: [{ index: 0, x0: 0, x1: w, clearW: w, z0: 0, z1: h }],
        xCutDefault: w / 2,
        zCutDefault: h / 2,
    };
}

/**
 * Sinh danh sách tấm ván 3D `Panel3D[]` và thông tin khoang lọt lòng từ món nội thất.
 */
export function generatePanels(item, cat) {
    const cfg = resolveParametricConfig(item, cat);

    if (!isParametricCabinet(item?.kind) || (item?.kind === 'altar' || item?.kind === 'altarsmall')) {
        return { config: cfg, ...generateNonCabinetPanels(item, cat, cfg) };
    }

    const { w, d, h, boardT: T, backT, plinthH, countertopT, bays, colorBody, colorFront } = cfg;
    const panels = [];
    const add = (id, role, x, y, z, dx, dy, dz, color, extra = {}) => {
        if (dx <= 0.5 || dy <= 0.5 || dz <= 0.5) return;
        panels.push({
            id, role,
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            z: Math.round(z * 10) / 10,
            dx: Math.round(dx * 10) / 10,
            dy: Math.round(dy * 10) / 10,
            dz: Math.round(dz * 10) / 10,
            color,
            ...extra,
        });
    };

    // Ốp đầu giường: các tấm lam/nệm chia đều, không có hồi/cánh
    if (item?.kind === 'headboard') {
        const gap = 4;
        const n = Math.max(1, bays.length);
        const segW = (w - gap * (n - 1)) / n;
        for (let i = 0; i < n; i++) {
            add(`hb_${i}`, 'door', i * (segW + gap), 0, 0, segW, d, h, i % 2 === 0 ? colorBody : colorFront, { bayIndex: i });
        }
        return {
            config: cfg,
            panels,
            baysInfo: bays.map((_, i) => ({ index: i, x0: i * (segW + gap), x1: i * (segW + gap) + segW, clearW: segW, z0: 0, z1: h, clearZonesZ: [] })),
            xCutDefault: segW / 2,
            zCutDefault: h * 0.5,
        };
    }

    const hasDoorsAny = bays.some(b => b.door && b.door !== 'none');
    const doorZone = hasDoorsAny ? T + 2 : 0; // vùng cánh phủ ngoài mặt trước thùng
    const carcassD = Math.max(60, d - doorZone);
    const bodyTopZ = h - countertopT;
    const innerBottomZ = plinthH + T;
    const innerTopZ = bodyTopZ - T;
    const innerH = Math.max(40, innerTopZ - innerBottomZ);

    // 1. Mặt bàn đá / mặt bàn gỗ phủ trên cùng (tủ bếp dưới, đảo bếp...)
    if (countertopT > 0) {
        add('countertop', 'countertop', 0, 0, bodyTopZ, w, d, countertopT, '#e2e8f0');
    }

    // 2. Hai tấm hồi trái - phải (chạy suốt từ sàn z=0 lên dưới mặt đá/đỉnh tủ)
    add('side_left', 'side', 0, 0, 0, T, carcassD, bodyTopZ, colorBody);
    add('side_right', 'side', w - T, 0, 0, T, carcassD, bodyTopZ, colorBody);

    // 3. Chân đế (thụt mặt trước 35mm chuẩn thi công xưởng)
    if (plinthH > 0) {
        const setback = Math.min(35, carcassD * 0.25);
        // kiểm tra có khoang ngồi bàn trang điểm/bàn làm việc không (kneehole không có chân đế)
        const hasKneehole = bays.some(b => b.kneehole);
        if (!hasKneehole) {
            add('plinth_front', 'plinth', T, Math.max(backT, carcassD - setback - T), 0, w - T * 2, T, plinthH, colorBody);
            add('plinth_back', 'plinth', T, backT, 0, w - T * 2, T, plinthH, colorBody);
        }
    }

    // 4. Chia chiều rộng lọt lòng cho các khoang
    const totalRatio = bays.reduce((s, b) => s + (b.widthRatio || 1), 0) || 1;
    const numDividers = Math.max(0, bays.length - 1);
    const totalClearW = Math.max(40, w - T * 2 - numDividers * T);

    const baysInfo = [];
    let curX = T;

    for (let i = 0; i < bays.length; i++) {
        const bay = bays[i];
        const ratio = (bay.widthRatio || 1) / totalRatio;
        const bayClearW = i === bays.length - 1
            ? Math.max(30, (w - T) - curX)
            : Math.round(totalClearW * ratio);
        const bx0 = curX;
        const bx1 = bx0 + bayClearW;

        // Vách ngăn đứng giữa khoang i và i+1
        if (i < bays.length - 1) {
            const divZ0 = bay.kneehole ? 0 : innerBottomZ;
            // Nếu khoang bên cạnh là kneehole (gầm bàn ngồi), vách ngăn phải chạm sàn làm chân bàn!
            const nextKneehole = bays[i + 1]?.kneehole;
            const actualDivZ0 = (bay.kneehole || nextKneehole) ? 0 : innerBottomZ;
            add(`divider_${i}`, 'divider', bx1, backT, actualDivZ0, T, carcassD - backT, innerTopZ - actualDivZ0, colorBody, { bayIndex: i });
        }

        // Khoang ngồi bàn làm việc / bàn trang điểm (kneehole): chỉ có hộc ngăn kéo mỏng dưới mặt bàn, bên dưới trống để chân
        if (bay.kneehole) {
            const apronH = bay.drawers > 0 ? Math.min(180, Math.max(110, bay.drawerTotalH || 140)) : 0;
            add(`top_bay_${i}`, 'top', bx0, 0, innerTopZ, bayClearW, carcassD, T, colorBody, { bayIndex: i });
            if (apronH > 0) {
                const btmZ = innerTopZ - apronH;
                add(`kh_btm_${i}`, 'bottom', bx0, backT, btmZ, bayClearW, carcassD - backT, T, colorBody, { bayIndex: i });
                add(`kh_drw_${i}`, 'drawer', bx0 + 2, carcassD, btmZ + 2, bayClearW - 4, T, apronH - 4, colorFront, { bayIndex: i });
            }
            baysInfo.push({
                index: i, x0: bx0, x1: bx1, clearW: bayClearW,
                z0: 0, z1: innerTopZ - apronH,
                clearZonesZ: [{ z0: 0, z1: innerTopZ - apronH, label: 'Gầm bàn' }],
            });
            curX = bx1 + T;
            continue;
        }

        // Đáy & đình khoang (nếu không có kneehole thì ghép liền hoặc theo khoang; ghép liền khi không có kneehole nhìn chuẩn mặt cắt hơn)
        // Xác định biên phủ ngoài mặt cánh của khoang i (dùng chung cho cả mặt ngăn kéo ngoài & cánh trên)
        const coverLeft = i === 0 ? T - 2 : T / 2 - 1.5;
        const coverRight = i === bays.length - 1 ? T - 2 : T / 2 - 1.5;
        const frontCoverX0 = bx0 - coverLeft;
        const frontCoverW = bayClearW + coverLeft + coverRight;
        const frontPlaneY = hasDoorsAny ? carcassD + 2 : carcassD;

        const clearZonesZ = [];
        let availZ0 = innerBottomZ;
        const availZ1 = innerTopZ;

        // 5. Cụm ngăn kéo dưới cùng trong khoang
        const nDrawers = Math.max(0, bay.drawers || 0);
        if (nDrawers > 0) {
            const maxDrwZone = Math.min(innerH - (bay.shelves > 0 || bay.hangingRod ? 220 : 0), bay.drawerTotalH || nDrawers * 200);
            const drwZoneH = Math.max(nDrawers * 100, maxDrwZone);
            const hasTopCapShelf = drwZoneH < innerH - 40;
            const capZ = innerBottomZ + drwZoneH;
            const drwCoverZ0 = plinthH + 2;
            const drwCoverZ1 = hasTopCapShelf ? (capZ + T / 2 - 1.5) : (bodyTopZ - 2);
            const frontAreaH = drwCoverZ1 - drwCoverZ0;
            const gap = 3;
            const eachFrontH = (frontAreaH - gap * (nDrawers - 1)) / nDrawers;
            const boxDepth = Math.max(80, carcassD - backT - 35);

            for (let dIdx = 0; dIdx < nDrawers; dIdx++) {
                const fz = drwCoverZ0 + dIdx * (eachFrontH + gap);
                add(`drw_front_${i}_${dIdx}`, 'drawer', frontCoverX0, frontPlaneY, fz, frontCoverW, T, eachFrontH, colorFront, { bayIndex: i });
                // Thùng hộc kéo bên trong lòng khoang (thấy rõ khi cắt A-A)
                const boxZ0 = Math.max(innerBottomZ + 6, fz + 10);
                const boxZ1 = Math.min(hasTopCapShelf ? capZ - 6 : innerTopZ - 6, fz + eachFrontH - 10);
                if (boxZ1 - boxZ0 > 35) {
                    add(`drw_box_${i}_${dIdx}`, 'drawer_box', bx0 + 12, carcassD - boxDepth, boxZ0, bayClearW - 24, boxDepth, boxZ1 - boxZ0, colorBody, { bayIndex: i });
                }
                clearZonesZ.push({ z0: Math.round(fz), z1: Math.round(fz + eachFrontH), label: 'Ngăn kéo' });
            }

            if (hasTopCapShelf) {
                add(`drw_cap_${i}`, 'shelf', bx0, backT, capZ, bayClearW, carcassD - backT - 5, T, colorBody, { bayIndex: i });
                availZ0 = capZ + T;
            } else {
                availZ0 = availZ1;
            }
        }

        // 6. Các đợt ngang chia đều trong khoảng không gian còn lại [availZ0, availZ1]
        const remainH = availZ1 - availZ0;
        const nShelves = remainH > 140 ? Math.max(0, bay.shelves || 0) : 0;
        const shelfSetback = 12; // đợt thụt vào 12mm so với mép thùng

        if (nShelves > 0 && remainH > (nShelves + 1) * 70) {
            if (bay.hangingRod && nShelves === 1 && remainH >= 900) {
                // Khoang treo quần áo có 1 đợt trên (khoang chăn màn trên cao ~360-420mm)
                const topCompartmentH = Math.min(420, Math.max(280, Math.round(remainH * 0.24)));
                const sz = availZ1 - topCompartmentH - T;
                add(`shelf_${i}_0`, 'shelf', bx0, backT, sz, bayClearW, carcassD - backT - shelfSetback, T, colorBody, { bayIndex: i });
                clearZonesZ.push({ z0: Math.round(availZ0), z1: Math.round(sz), label: 'Khoang treo' });
                clearZonesZ.push({ z0: Math.round(sz + T), z1: Math.round(availZ1), label: 'Đợt trên' });

                // Suốt treo quần áo nằm dưới đợt trên 65mm
                const rodZ = sz - 65;
                const rodY = backT + (carcassD - backT) * 0.5;
                add(`rod_${i}`, 'rod', bx0 + 6, rodY - 12, rodZ - 15, bayClearW - 12, 24, 30, '#94a3b8', { bayIndex: i });
            } else {
                const step = (remainH - nShelves * T) / (nShelves + 1);
                let prevZ = availZ0;
                for (let sIdx = 0; sIdx < nShelves; sIdx++) {
                    const sz = prevZ + step;
                    add(`shelf_${i}_${sIdx}`, 'shelf', bx0, backT, sz, bayClearW, carcassD - backT - shelfSetback, T, colorBody, { bayIndex: i });
                    clearZonesZ.push({ z0: Math.round(prevZ), z1: Math.round(sz), label: `Tầng ${sIdx + 1}` });
                    prevZ = sz + T;
                }
                clearZonesZ.push({ z0: Math.round(prevZ), z1: Math.round(availZ1), label: `Tầng ${nShelves + 1}` });

                if (bay.hangingRod) {
                    const rodZ = availZ1 - 75;
                    const rodY = backT + (carcassD - backT) * 0.5;
                    add(`rod_${i}`, 'rod', bx0 + 6, rodY - 12, rodZ - 15, bayClearW - 12, 24, 30, '#94a3b8', { bayIndex: i });
                }
            }
        } else if (remainH > 40) {
            clearZonesZ.push({ z0: Math.round(availZ0), z1: Math.round(availZ1), label: 'Lọt lòng' });
            if (bay.hangingRod && remainH >= 400) {
                const rodZ = availZ1 - 75;
                const rodY = backT + (carcassD - backT) * 0.5;
                add(`rod_${i}`, 'rod', bx0 + 6, rodY - 12, rodZ - 15, bayClearW - 12, 24, 30, '#94a3b8', { bayIndex: i });
            }
        }

        // 7. Cánh tủ phủ mặt trước khoang
        if (bay.door && bay.door !== 'none' && remainH > 80) {
            const doorX0 = frontCoverX0;
            const doorW = frontCoverW;
            const doorZ0 = availZ0 === innerBottomZ ? plinthH + 2 : (availZ0 - T / 2 + 1.5);
            const doorZ1 = bodyTopZ - 2;
            const doorH = doorZ1 - doorZ0;
            const doorY = frontPlaneY;

            if (bay.door === 'double') {
                const halfW = (doorW - 3) / 2;
                add(`door_${i}_L`, 'door', doorX0, doorY, doorZ0, halfW, T, doorH, colorFront, { bayIndex: i, swing: 'left' });
                add(`door_${i}_R`, 'door', doorX0 + halfW + 3, doorY, doorZ0, halfW, T, doorH, colorFront, { bayIndex: i, swing: 'right' });
            } else if (bay.door === 'sliding') {
                const halfW = doorW * 0.52;
                add(`door_${i}_SL`, 'door', doorX0, carcassD - T, doorZ0, halfW, T, doorH, colorFront, { bayIndex: i, swing: 'sliding_right' });
                add(`door_${i}_SR`, 'door', doorX0 + doorW - halfW, doorY, doorZ0, halfW, T, doorH, colorFront, { bayIndex: i, swing: 'sliding_left' });
            } else {
                add(`door_${i}`, 'door', doorX0, doorY, doorZ0, doorW, T, doorH, colorFront, { bayIndex: i, swing: bay.door });
            }
        }

        baysInfo.push({
            index: i,
            x0: bx0,
            x1: bx1,
            clearW: bayClearW,
            z0: innerBottomZ,
            z1: innerTopZ,
            clearZonesZ,
        });

        curX = bx1 + T;
    }

    // 8. Đáy, đình và tấm hậu chung cho các khoang thường (không phải gầm bàn kneehole)
    const hasKneehole = bays.some(b => b.kneehole);
    if (!hasKneehole) {
        add('bottom_main', 'bottom', T, 0, plinthH, w - T * 2, carcassD, T, colorBody);
        add('top_main', 'top', T, 0, innerTopZ, w - T * 2, carcassD, T, colorBody);
        add('back_main', 'back', T, 0, plinthH + T, w - T * 2, backT, innerH, colorBody);
    } else {
        // Riêng phần tủ có khoang không phải kneehole vẫn có đáy/hậu riêng
        for (let i = 0; i < bays.length; i++) {
            if (bays[i].kneehole) continue;
            const bi = baysInfo[i];
            add(`btm_bay_${i}`, 'bottom', bi.x0, 0, plinthH, bi.clearW, carcassD, T, colorBody);
            add(`top_bay_${i}`, 'top', bi.x0, 0, innerTopZ, bi.clearW, carcassD, T, colorBody);
            add(`back_bay_${i}`, 'back', bi.x0, 0, plinthH + T, bi.clearW, backT, innerH, colorBody);
        }
    }

    const targetBay = baysInfo[cfg.cutBayIndex] || baysInfo[0];
    const xCutDefault = targetBay ? (targetBay.x0 + targetBay.x1) / 2 : w / 2;
    const zCutDefault = Math.round(plinthH + innerH * cfg.zCutRatio);

    return {
        config: cfg,
        panels,
        baysInfo,
        xCutDefault,
        zCutDefault,
    };
}
