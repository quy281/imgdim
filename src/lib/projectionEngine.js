// Engine Chiếu Hình Học 2D (Khử nét khuất HLR), Cắt Mặt Cắt (A-A, B-B) có Hatch
// và Dựng Phối Cảnh 3D Trục Đo (Topological Sort AABB) — Zero external dependencies.
//
// Quy ước toạ độ bản vẽ 2D trả về từ các hàm chiếu:
//   u: tăng từ Trái sang Phải (mm)
//   v: tăng từ Dưới lên Trên (mm, mặt sàn/mép trước ở v=0)
// Khi vẽ lên Konva (trục Y màn hình hướng xuống), chỉ cần đổi screenY = viewHeight - v (hoặc -v).

import { generatePanels, isParametricCabinet } from './parametricModel';
import { resolveZ } from './furnitureCatalog';

const EPS = 0.05;

/**
 * Trừ danh sách đoạn che khuất `clips` khỏi đoạn `[a, b]`.
 * Trả về mảng các đoạn con `[s, e]` còn nhìn thấy.
 */
export function subtractIntervals(a, b, clips) {
    if (b - a <= EPS) return [];
    let segs = [[a, b]];
    for (let i = 0; i < clips.length && segs.length > 0; i++) {
        const [c0, c1] = clips[i];
        if (c1 - c0 <= EPS) continue;
        const next = [];
        for (let j = 0; j < segs.length; j++) {
            const [s, e] = segs[j];
            if (c1 <= s + EPS || c0 >= e - EPS) {
                next.push([s, e]);
            } else {
                if (c0 > s + EPS) next.push([s, c0]);
                if (c1 < e - EPS) next.push([c1, e]);
            }
        }
        segs = next;
    }
    return segs;
}

/**
 * Khử nét khuất chính xác (Exact 2D Box HLR) cho danh sách hình chữ nhật
 * đã sắp thứ tự từ GẦN người nhìn đến XA người nhìn.
 * `initialOccluders` cho phép truyền sẵn các tiết diện mặt cắt che phía trước.
 */
function runRectHLR(sortedRects, initialOccluders = []) {
    const occluders = [...initialOccluders];
    const segments = [];
    const visibleFills = [];

    for (const r of sortedRects) {
        const { u0, v0, u1, v1, weight = 'proj', role, color } = r;
        if (u1 - u0 <= EPS || v1 - v0 <= EPS) continue;

        // 1. Cạnh dưới (v = v0) và cạnh trên (v = v1)
        const hClipsBottom = [];
        const hClipsTop = [];
        // 2. Cạnh trái (u = u0) và cạnh phải (u = u1)
        const vClipsLeft = [];
        const vClipsRight = [];

        let fullyCovered = false;
        const isFrontCover = role === 'door' || role === 'drawer';
        for (let i = 0; i < occluders.length; i++) {
            const rawOcc = occluders[i];
            // Khe hở 2-3mm giữa hai cánh tủ không được để lộ các mẩu nét 3mm của đợt gỗ bên trong
            const seal = (!isFrontCover && rawOcc.sealGap) ? 2.5 : 0;
            const occ = seal
                ? { u0: rawOcc.u0 - seal, v0: rawOcc.v0 - seal, u1: rawOcc.u1 + seal, v1: rawOcc.v1 + seal }
                : rawOcc;
            if (occ.u0 <= u0 + EPS && occ.u1 >= u1 - EPS && occ.v0 <= v0 + EPS && occ.v1 >= v1 - EPS) {
                fullyCovered = true;
                break;
            }
            if (occ.u1 > u0 + EPS && occ.u0 < u1 - EPS) {
                if (occ.v0 <= v0 + EPS && v0 <= occ.v1 + EPS) hClipsBottom.push([occ.u0, occ.u1]);
                if (occ.v0 - EPS <= v1 && v1 <= occ.v1 + EPS) hClipsTop.push([occ.u0, occ.u1]);
            }
            if (occ.v1 > v0 + EPS && occ.v0 < v1 - EPS) {
                if (occ.u0 - EPS <= u0 && u0 <= occ.u1 + EPS) vClipsLeft.push([occ.v0, occ.v1]);
                if (occ.u0 - EPS <= u1 && u1 <= occ.u1 + EPS) vClipsRight.push([occ.v0, occ.v1]);
            }
        }

        if (!fullyCovered) {
            visibleFills.push({ u0, v0, u1, v1, role, color });
            for (const [s, e] of subtractIntervals(u0, u1, hClipsBottom)) {
                segments.push({ u1: s, v1: v0, u2: e, v2: v0, weight, role });
            }
            for (const [s, e] of subtractIntervals(u0, u1, hClipsTop)) {
                segments.push({ u1: s, v1: v1, u2: e, v2: v1, weight, role });
            }
            for (const [s, e] of subtractIntervals(v0, v1, vClipsLeft)) {
                segments.push({ u1: u0, v1: s, u2: u0, v2: e, weight, role });
            }
            for (const [s, e] of subtractIntervals(v0, v1, vClipsRight)) {
                segments.push({ u1: u1, v1: s, u2: u1, v2: e, weight, role });
            }
        }

        if (r.opaque !== false) {
            occluders.push({ u0, v0, u1, v1, sealGap: isFrontCover });
        }
    }

    return { segments, visibleFills, occluders };
}

/**
 * Sinh các đoạn thẳng gạch chéo 45° (Hatch mặt cắt gỗ/MDF) bên trong hình chữ nhật [u0, v0, u1, v1].
 */
export function generateRectHatch(u0, v0, u1, v1, step = 14) {
    const w = u1 - u0, h = v1 - v0;
    if (w <= 1 || h <= 1) return [];
    // Tấm ván mỏng thì bước hatch dày hơn để nhìn rõ sọc cắt
    const pitch = Math.max(6, Math.min(step, Math.min(w, h) * 0.85));
    const lines = [];
    // Phương trình đường chéo 45°: u - v = c, với c chạy từ (u0 - v1) đến (u1 - v0)
    const cMin = u0 - v1;
    const cMax = u1 - v0;
    for (let c = cMin + pitch * 0.5; c < cMax; c += pitch) {
        // Giao của u = v + c với [u0, u1] x [v0, v1]
        const va = Math.max(v0, u0 - c);
        const vb = Math.min(v1, u1 - c);
        if (vb - va > 0.5) {
            lines.push({ u1: va + c, v1: va, u2: vb + c, v2: vb, weight: 'hatch' });
        }
    }
    return lines;
}

/**
 * Ký hiệu kỹ thuật chiều mở cánh tủ trên Mặt đứng (nét đứt chéo về phía bản lề / mũi tên lùa).
 */
function buildDoorSwingSymbols(panel, u0, v0, u1, v1) {
    const sw = panel.swing;
    if (!sw) return [];
    const midU = (u0 + u1) / 2;
    const midV = (v0 + v1) / 2;
    if (sw === 'left') {
        // Bản lề bên trái (u0): đỉnh nhọn nằm ở bản lề trái
        return [
            { u1: u1, v1: v0, u2: u0, v2: midV, weight: 'swing' },
            { u1: u0, v1: midV, u2: u1, v2: v1, weight: 'swing' },
        ];
    }
    if (sw === 'right') {
        // Bản lề bên phải (u1)
        return [
            { u1: u0, v1: v0, u2: u1, v2: midV, weight: 'swing' },
            { u1: u1, v1: midV, u2: u0, v2: v1, weight: 'swing' },
        ];
    }
    if (sw === 'flap') {
        // Cánh lật mở lên: bản lề ở cạnh trên (v1)
        return [
            { u1: u0, v1: v0, u2: midU, v2: v1, weight: 'swing' },
            { u1: midU, v1: v1, u2: u1, v2: v0, weight: 'swing' },
        ];
    }
    if (sw === 'sliding_left' || sw === 'sliding_right') {
        const dir = sw === 'sliding_left' ? -1 : 1;
        const len = Math.min(160, (u1 - u0) * 0.35);
        const head = Math.min(35, len * 0.3);
        const sx = midU - (dir * len) / 2;
        const ex = midU + (dir * len) / 2;
        return [
            { u1: sx, v1: midV, u2: ex, v2: midV, weight: 'swing' },
            { u1: ex - dir * head, v1: midV + head * 0.65, u2: ex, v2: midV, weight: 'swing' },
            { u1: ex - dir * head, v1: midV - head * 0.65, u2: ex, v2: midV, weight: 'swing' },
        ];
    }
    return [];
}

/**
 * Chiếu vuông góc 2D có khử nét khuất cho 1 trong 5 hướng:
 *   'front' | 'back' | 'left' | 'right' | 'plan'
 */
export function projectOrthographic(panels, config, viewType = 'front', opts = {}) {
    const { w, d, h } = config;
    const hideDoors = !!opts.hideDoors;
    const filtered = panels.filter(p => {
        if (hideDoors && p.role === 'door') return false;
        if (viewType === 'front' && p.role === 'drawer_box' && !hideDoors) return false;
        return true;
    });

    const mapped = [];
    const swings = [];

    for (const p of filtered) {
        let u0, v0, u1, v1, depthNear;
        switch (viewType) {
            case 'front': // nhìn từ +Y vào -Y: u = x, v = z
                u0 = p.x; u1 = p.x + p.dx;
                v0 = p.z; v1 = p.z + p.dz;
                depthNear = -(p.y + p.dy); // nhỏ hơn = gần người xem hơn
                break;
            case 'back': // nhìn từ -Y vào +Y: u = w - (x+dx), v = z
                u0 = w - (p.x + p.dx); u1 = w - p.x;
                v0 = p.z; v1 = p.z + p.dz;
                depthNear = p.y;
                break;
            case 'left': // nhìn từ -X vào +X: u = y (lưng trái, mặt trước phải), v = z
                u0 = p.y; u1 = p.y + p.dy;
                v0 = p.z; v1 = p.z + p.dz;
                depthNear = p.x;
                break;
            case 'right': // nhìn từ +X vào -X: u = d - (y+dy), v = z
                u0 = d - (p.y + p.dy); u1 = d - p.y;
                v0 = p.z; v1 = p.z + p.dz;
                depthNear = -(p.x + p.dx);
                break;
            case 'plan': // nhìn từ +Z xuống -Z: u = x, v = d - y (lưng ở trên v=d, mặt trước ở dưới v=0)
            default:
                u0 = p.x; u1 = p.x + p.dx;
                v0 = d - (p.y + p.dy); v1 = d - p.y;
                depthNear = -(p.z + p.dz);
                break;
        }

        // Ưu tiên mặt cánh/mặt bàn đứng trước khi cùng độ sâu
        const roleBias = (p.role === 'door' || p.role === 'drawer' || p.role === 'countertop') ? -0.01 : 0;
        mapped.push({
            u0, v0, u1, v1,
            sortKey: depthNear + roleBias,
            weight: (p.role === 'side' || p.role === 'countertop' || p.role === 'top' || p.role === 'bottom') ? 'outline' : 'proj',
            role: p.role,
            color: p.color,
            opaque: p.role !== 'rod',
            panel: p,
        });

        if (viewType === 'front' && p.role === 'door' && !hideDoors) {
            swings.push(...buildDoorSwingSymbols(p, u0, v0, u1, v1));
        }
    }

    mapped.sort((a, b) => a.sortKey - b.sortKey);
    const { segments, visibleFills } = runRectHLR(mapped);

    // Nếu đang bật "Ẩn cánh" trên Mặt đứng nhưng vẫn muốn thấy đường chia khoang cánh mờ thì tùy chọn
    const width = (viewType === 'left' || viewType === 'right') ? d : w;
    const height = viewType === 'plan' ? d : h;

    return {
        viewType,
        width,
        height,
        segments: [...segments, ...swings],
        fills: visibleFills,
    };
}

/**
 * Mặt cắt đứng A-A tại toạ độ `x = xCut` (nhìn sang phải +X, hệ trục u = y: 0→d, v = z: 0→h).
 * Khớp hướng chiếu chuẩn với Mặt đứng & Mặt bên trái.
 */
export function sliceSectionAA(panels, config, xCut, baysInfo = [], opts = {}) {
    const { d, h, plinthH } = config;
    const hideDoors = !!opts.hideDoors;

    const cutRects = [];
    const cutSegments = [];
    const hatchSegments = [];
    const bgPanels = [];

    for (const p of panels) {
        if (hideDoors && p.role === 'door') continue;
        const x0 = p.x, x1 = p.x + p.dx;
        if (x0 <= xCut + EPS && xCut <= x1 - EPS) {
            // Tấm bị mặt phẳng A-A cắt qua!
            const u0 = p.y, u1 = p.y + p.dy;
            const v0 = p.z, v1 = p.z + p.dz;
            cutRects.push({ u0, v0, u1, v1, role: p.role, color: p.color });
            cutSegments.push(
                { u1: u0, v1: v0, u2: u1, v2: v0, weight: 'cut', role: p.role },
                { u1: u1, v1: v0, u2: u1, v2: v1, weight: 'cut', role: p.role },
                { u1: u1, v1: v1, u2: u0, v2: v1, weight: 'cut', role: p.role },
                { u1: u0, v1: v1, u2: u0, v2: v0, weight: 'cut', role: p.role },
            );
            if (p.role !== 'rod' && p.role !== 'drawer_box') {
                hatchSegments.push(...generateRectHatch(u0, v0, u1, v1));
            }
        } else if (x0 >= xCut - EPS) {
            // Nằm phía sau mặt phẳng cắt (nhìn về phía +X) -> chiếu nét thấy mảnh
            bgPanels.push({
                u0: p.y, v0: p.z,
                u1: p.y + p.dy, v1: p.z + p.dz,
                sortKey: x0,
                weight: 'thin',
                role: p.role,
                color: p.color,
                opaque: p.role !== 'rod',
            });
        }
    }

    bgPanels.sort((a, b) => a.sortKey - b.sortKey);
    const bgHLR = runRectHLR(bgPanels, cutRects);

    // Suốt treo quần áo bị cắt ngang: vẽ thêm ký hiệu tâm tròn nhỏ
    const bay = baysInfo.find(b => b.x0 - 20 <= xCut && xCut <= b.x1 + 20) || baysInfo[0];
    const clearDimsZ = [];
    if (plinthH >= 30) {
        clearDimsZ.push({ v0: 0, v1: plinthH, val: Math.round(plinthH) });
    }
    if (bay?.clearZonesZ?.length) {
        for (const cz of bay.clearZonesZ) {
            if (cz.z1 - cz.z0 >= 40) {
                clearDimsZ.push({ v0: cz.z0, v1: cz.z1, val: Math.round(cz.z1 - cz.z0) });
            }
        }
    }

    return {
        viewType: 'sectionAA',
        width: d,
        height: h,
        xCut,
        cutRects,
        segments: [...bgHLR.segments, ...hatchSegments, ...cutSegments],
        clearDimsZ,
    };
}

/**
 * Mặt cắt ngang B-B tại cao độ `z = zCut` (nhìn từ trên xuống -Z, hệ trục u = x: 0→w, v = d - y: 0→d).
 * Khớp thẳng trục ngang `u = x` với Mặt đứng và Mặt bằng.
 */
export function sliceSectionBB(panels, config, zCut, baysInfo = [], opts = {}) {
    const { w, d } = config;
    const hideDoors = !!opts.hideDoors;

    const cutRects = [];
    const cutSegments = [];
    const hatchSegments = [];
    const belowPanels = [];

    for (const p of panels) {
        if (hideDoors && p.role === 'door') continue;
        const z0 = p.z, z1 = p.z + p.dz;
        const u0 = p.x, u1 = p.x + p.dx;
        const v0 = d - (p.y + p.dy), v1 = d - p.y;

        if (z0 <= zCut + EPS && zCut <= z1 - EPS) {
            cutRects.push({ u0, v0, u1, v1, role: p.role, color: p.color });
            cutSegments.push(
                { u1: u0, v1: v0, u2: u1, v2: v0, weight: 'cut', role: p.role },
                { u1: u1, v1: v0, u2: u1, v2: v1, weight: 'cut', role: p.role },
                { u1: u1, v1: v1, u2: u0, v2: v1, weight: 'cut', role: p.role },
                { u1: u0, v1: v1, u2: u0, v2: v0, weight: 'cut', role: p.role },
            );
            if (p.role !== 'rod') {
                hatchSegments.push(...generateRectHatch(u0, v0, u1, v1));
            }
        } else if (z1 <= zCut + EPS) {
            // Tấm nằm thấp hơn mặt cắt B-B (đợt dưới, đáy tủ) -> chiếu nét mảnh bên dưới
            belowPanels.push({
                u0, v0, u1, v1,
                sortKey: -z1,
                weight: 'thin',
                role: p.role,
                color: p.color,
                opaque: p.role !== 'rod',
            });
        }
    }

    belowPanels.sort((a, b) => a.sortKey - b.sortKey);
    const bgHLR = runRectHLR(belowPanels, cutRects);

    const clearDimsX = (baysInfo || [])
        .filter(b => b.clearW >= 40)
        .map(b => ({ u0: b.x0, u1: b.x1, val: Math.round(b.clearW) }));

    return {
        viewType: 'sectionBB',
        width: w,
        height: d,
        zCut,
        cutRects,
        segments: [...bgHLR.segments, ...hatchSegments, ...cutSegments],
        clearDimsX,
    };
}

/**
 * Điều chỉnh độ sáng mã màu hex để tạo khối nổi 3D tự nhiên giống SketchUp.
 */
function shadeHex(hex, factor) {
    const clean = String(hex || '#cbd5e1').replace('#', '');
    const full = clean.length === 3
        ? clean.split('').map(c => c + c).join('')
        : clean.padEnd(6, 'c');
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return '#cbd5e1';
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const r = clamp(((n >> 16) & 255) * factor);
    const g = clamp(((n >> 8) & 255) * factor);
    const b = clamp((n & 255) * factor);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/**
 * Chiếu Phối cảnh Trục đo 3D (Isometric / Axonometric) với sắp xếp che khuất chính xác
 * (Topological Sort trên các hộp AABB rời nhau) — xoay mượt mọi góc không bao giờ lỗi đè mặt.
 */
export function projectAxonometric3D(panels, opts = {}) {
    const yaw = ((opts.yawDeg ?? -34) * Math.PI) / 180;
    const pitch = ((opts.pitchDeg ?? 22) * Math.PI) / 180;
    const hideDoors = !!opts.hideDoors;

    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    const sinP = Math.sin(pitch), cosP = Math.cos(pitch);

    // Vector hướng mắt nhìn từ tâm vật thể ra camera
    const camX = sinY * cosP;
    const camY = cosY * cosP;
    const camZ = sinP;

    // Hệ trục trực chuẩn trên mặt phẳng màn hình (u sang phải, v hướng lên)
    const proj = (x, y, z) => ({
        u: x * cosY - y * sinY,
        v: z * cosP - (x * sinY + y * cosY) * sinP,
    });

    const active = panels.filter(p => !(hideDoors && p.role === 'door'));
    if (!active.length) {
        return { polygons: [], width: 100, height: 100, minU: 0, minV: 0 };
    }

    // Dựng thông tin chiếu 2D bbox cho từng hộp để kiểm tra thứ tự che khuất
    const boxes = active.map((p, idx) => {
        const x0 = p.x, x1 = p.x + p.dx;
        const y0 = p.y, y1 = p.y + p.dy;
        const z0 = p.z, z1 = p.z + p.dz;
        const corners = [
            proj(x0, y0, z0), proj(x1, y0, z0), proj(x1, y1, z0), proj(x0, y1, z0),
            proj(x0, y0, z1), proj(x1, y0, z1), proj(x1, y1, z1), proj(x0, y1, z1),
        ];
        let bu0 = Infinity, bv0 = Infinity, bu1 = -Infinity, bv1 = -Infinity;
        for (const c of corners) {
            if (c.u < bu0) bu0 = c.u;
            if (c.u > bu1) bu1 = c.u;
            if (c.v < bv0) bv0 = c.v;
            if (c.v > bv1) bv1 = c.v;
        }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
        return {
            idx, p, x0, x1, y0, y1, z0, z1, corners,
            bu0, bv0, bu1, bv1,
            depth: cx * camX + cy * camY + cz * camZ,
        };
    });

    // Đồ thị thứ tự vẽ: cạnh i -> j nghĩa là hộp i nằm SAU hộp j (phải vẽ i trước j)
    const n = boxes.length;
    const adj = Array.from({ length: n }, () => []);
    const inDeg = new Int32Array(n);

    for (let i = 0; i < n; i++) {
        const A = boxes[i];
        for (let j = i + 1; j < n; j++) {
            const B = boxes[j];
            // Không chồng lấn trên màn hình 2D -> không phụ thuộc nhau
            if (A.bu1 <= B.bu0 + EPS || B.bu1 <= A.bu0 + EPS || A.bv1 <= B.bv0 + EPS || B.bv1 <= A.bv0 + EPS) {
                continue;
            }
            // Kiểm tra mặt phẳng phân cách dọc theo 3 trục X, Y, Z
            let order = 0; // <0: A sau B; >0: B sau A
            if (A.x1 <= B.x0 + EPS && Math.abs(camX) > 1e-4) {
                order = camX > 0 ? -1 : 1;
            } else if (B.x1 <= A.x0 + EPS && Math.abs(camX) > 1e-4) {
                order = camX > 0 ? 1 : -1;
            } else if (A.y1 <= B.y0 + EPS && Math.abs(camY) > 1e-4) {
                order = camY > 0 ? -1 : 1;
            } else if (B.y1 <= A.y0 + EPS && Math.abs(camY) > 1e-4) {
                order = camY > 0 ? 1 : -1;
            } else if (A.z1 <= B.z0 + EPS && Math.abs(camZ) > 1e-4) {
                order = camZ > 0 ? -1 : 1;
            } else if (B.z1 <= A.z0 + EPS && Math.abs(camZ) > 1e-4) {
                order = camZ > 0 ? 1 : -1;
            }
            if (order < 0) {
                adj[i].push(j);
                inDeg[j]++;
            } else if (order > 0) {
                adj[j].push(i);
                inDeg[i]++;
            }
        }
    }

    // Kahn's topological sort (ưu tiên hộp xa hơn trước nếu cùng bậc)
    const ready = [];
    for (let i = 0; i < n; i++) if (inDeg[i] === 0) ready.push(i);
    ready.sort((a, b) => boxes[a].depth - boxes[b].depth);

    const ordered = [];
    const visited = new Uint8Array(n);
    while (ready.length > 0) {
        const u = ready.shift();
        visited[u] = 1;
        ordered.push(boxes[u]);
        for (const v of adj[u]) {
            inDeg[v]--;
            if (inDeg[v] === 0) {
                ready.push(v);
                ready.sort((a, b) => boxes[a].depth - boxes[b].depth);
            }
        }
    }
    // Phòng trường hợp cực hiếm có 2 hộp chạm chéo tạo chu trình -> đẩy nốt theo depth
    if (ordered.length < n) {
        const rest = boxes.filter((_, i) => !visited[i]).sort((a, b) => a.depth - b.depth);
        ordered.push(...rest);
    }

    // Sinh đa giác 3 mặt nhìn thấy (Back-face culling) cho từng hộp theo thứ tự từ xa đến gần
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const b of boxes) {
        if (b.bu0 < minU) minU = b.bu0;
        if (b.bu1 > maxU) maxU = b.bu1;
        if (b.bv0 < minV) minV = b.bv0;
        if (b.bv1 > maxV) maxV = b.bv1;
    }

    const polygons = [];
    for (const b of ordered) {
        const c = b.corners;
        const base = b.p.color || '#cfa06e';
        // c[0..3]: đáy z0 ((x0,y0),(x1,y0),(x1,y1),(x0,y1)); c[4..7]: đỉnh z1
        if (camZ > 1e-4) {
            polygons.push({ pts: [c[4], c[5], c[6], c[7]], fill: shadeHex(base, 1.07), role: b.p.role });
        } else if (camZ < -1e-4) {
            polygons.push({ pts: [c[0], c[3], c[2], c[1]], fill: shadeHex(base, 0.72), role: b.p.role });
        }
        if (camY > 1e-4) {
            // Mặt trước (+Y): c[3], c[2], c[6], c[7]
            polygons.push({ pts: [c[3], c[2], c[6], c[7]], fill: shadeHex(base, 0.98), role: b.p.role });
        } else if (camY < -1e-4) {
            // Mặt lưng (-Y): c[0], c[1], c[5], c[4]
            polygons.push({ pts: [c[0], c[1], c[5], c[4]], fill: shadeHex(base, 0.85), role: b.p.role });
        }
        if (camX < -1e-4) {
            // Mặt hồi trái (-X): c[0], c[3], c[7], c[4]
            polygons.push({ pts: [c[0], c[3], c[7], c[4]], fill: shadeHex(base, 0.82), role: b.p.role });
        } else if (camX > 1e-4) {
            // Mặt hồi phải (+X): c[1], c[2], c[6], c[5]
            polygons.push({ pts: [c[1], c[2], c[6], c[5]], fill: shadeHex(base, 0.82), role: b.p.role });
        }
    }

    // Dịch toàn bộ đa giác về góc gốc (0, 0) để đồng nhất với các khung nhìn 2D
    const normPolygons = polygons.map(poly => ({
        ...poly,
        pts: poly.pts.map(pt => ({ u: pt.u - minU, v: pt.v - minV })),
    }));

    return {
        viewType: 'iso3d',
        width: Math.max(1, maxU - minU),
        height: Math.max(1, maxV - minV),
        polygons: normPolygons,
    };
}

/**
 * Dựng trọn bộ 6 khung nhìn tiêu chuẩn (giống Betagon Layout) cho 1 món đồ nội thất
 * chỉ trong 1 lần gọi (~1–2ms).
 */
export function buildSixViewsBundle(item, cat, opts = {}) {
    const { config, panels, baysInfo, xCutDefault, zCutDefault } = generatePanels(item, cat);
    const xCut = Number.isFinite(opts.xCut) ? opts.xCut : xCutDefault;
    const zCut = Number.isFinite(opts.zCut) ? opts.zCut : zCutDefault;
    const hideDoors = !!opts.hideDoors;

    const front = projectOrthographic(panels, config, 'front', { hideDoors });
    const left = projectOrthographic(panels, config, 'left', { hideDoors });
    const sectionAA = sliceSectionAA(panels, config, xCut, baysInfo, { hideDoors });
    const plan = projectOrthographic(panels, config, 'plan', { hideDoors });
    const sectionBB = sliceSectionBB(panels, config, zCut, baysInfo, { hideDoors });
    const iso3d = projectAxonometric3D(panels, {
        hideDoors,
        yawDeg: opts.yawDeg ?? -34,
        pitchDeg: opts.pitchDeg ?? 22,
    });

    return {
        config,
        panels,
        baysInfo,
        xCut,
        zCut,
        views: { front, left, sectionAA, plan, sectionBB, iso3d },
    };
}

/**
 * Chiếu trực tiếp chi tiết món đồ nội thất lên Mặt Đứng Tường Phòng (`ElevationLayer` & `dxf.js`).
 * Tự nhận biết món đồ đang quay Mặt trước, Mặt lưng hay Mặt bên về phía người nhìn trong phòng!
 */
export function projectItemDetailOnWall(frame, item, cat, H) {
    if (!isParametricCabinet(item?.kind)) return null;
    const { nx, ny, side } = frame;
    // Pháp tuyến hướng từ tường vào lòng phòng
    const roomInX = nx * side;
    const roomInY = ny * side;

    // Pháp tuyến mặt trước của tủ (trong local là (0, +1), quay góc rot trên màn hình y-xuống)
    const th = ((item.rot || 0) * Math.PI) / 180;
    const frontX = -Math.sin(th);
    const frontY = Math.cos(th);
    // Trục ngang phải của tủ (local (+1, 0))
    const rightX = Math.cos(th);
    const rightY = Math.sin(th);

    const dotFront = frontX * roomInX + frontY * roomInY;
    const dotRight = rightX * roomInX + rightY * roomInY;

    let viewType = 'front';
    if (dotFront >= 0.7) viewType = 'front';
    else if (dotFront <= -0.7) viewType = 'back';
    else if (dotRight <= -0.7) viewType = 'left'; // mặt hồi trái (-X) quay vào lòng phòng
    else if (dotRight >= 0.7) viewType = 'right';
    else return null; // xoay góc chéo tự do thì giữ khung hộp cơ bản

    const { config, panels } = generatePanels(item, cat);
    const proj = projectOrthographic(panels, config, viewType, { hideDoors: false });
    const zBase = resolveZ(item, cat, H);

    return {
        viewType,
        zBase,
        width: proj.width,
        height: proj.height,
        segments: proj.segments,
    };
}
