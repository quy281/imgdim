// Hệ thống Magnet thông minh (Tường + Góc/Cột + Đồ nội thất gần nhau)
// & Scale 4 chiều (Trái / Phải / Trước / Sau, giữ cố định cạnh đối diện).
// Đơn vị: mm, toạ độ màn hình (X sang phải, Y hướng xuống, góc quay rot thuận kim đồng hồ).

import { dist } from './geometry';
import { catalogItem } from './furnitureCatalog';

const normDeg = (d) => ((Math.round(d) % 360) + 360) % 360;

/** Vector cơ sở local của món nội thất ở góc quay `rot` (độ). */
export function furnitureBasis(rot = 0) {
    const th = (rot * Math.PI) / 180;
    const cs = Math.cos(th), sn = Math.sin(th);
    return {
        // +X local: Trái -> Phải
        right: { x: cs, y: sn },
        // +Y local: Lưng (-d/2) -> Mặt trước (+d/2)
        front: { x: -sn, y: cs },
    };
}

/** 4 đỉnh thế giới [TL(back-left), TR(back-right), BR(front-right), BL(front-left)] */
export function furnitureCorners(item) {
    const cat = catalogItem(item.kind);
    const w = item.w || cat?.w || 600;
    const d = item.d || cat?.d || 600;
    const hw = w / 2, hd = d / 2;
    const { right, front } = furnitureBasis(item.rot || 0);
    const pt = (lx, ly) => ({
        x: item.x + lx * right.x + ly * front.x,
        y: item.y + lx * right.y + ly * front.y,
    });
    return [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)];
}

/** Kiểm tra 2 món nội thất có giao nhau theo phương đứng Z để hút chạm cạnh 0mm hay không. */
function canContactSnap(itemA, catA, itemB, catB) {
    if (catA?.noSnapContact || catB?.noSnapContact) return false;
    const wA = itemA.w || catA?.w || 600, dA = itemA.d || catA?.d || 600;
    const wB = itemB.w || catB?.w || 600, dB = itemB.d || catB?.d || 600;
    // Không để ổ điện/công tắc siêu nhỏ làm khựng chuyển động của đồ lớn
    const aTiny = wA < 180 && dA < 80;
    const bTiny = wB < 180 && dB < 80;
    if (aTiny !== bTiny) return false;

    // Bếp từ / chậu rửa đặt TRÊN mặt tủ bếp dưới: dùng căn lề (align) thay vì đẩy ra ngoài tủ
    const onCounterKeys = new Set(['hob', 'sink', 'sink2']);
    const baseCounterKeys = new Set(['kitchen15', 'kitchen24', 'kitchen30', 'island']);
    if ((onCounterKeys.has(itemA.kind) && baseCounterKeys.has(itemB.kind)) ||
        (onCounterKeys.has(itemB.kind) && baseCounterKeys.has(itemA.kind))) {
        return false;
    }

    if (catA?.mount === 'ceiling' !== (catB?.mount === 'ceiling')) return false;
    const zA0 = itemA.z ?? catA?.z ?? 0;
    const zA1 = zA0 + (itemA.h ?? catA?.h ?? 800);
    const zB0 = itemB.z ?? catB?.z ?? 0;
    const zB1 = zB0 + (itemB.h ?? catB?.h ?? 800);
    // Giao nhau theo chiều cao Z (cho phép lệch nhẹ 20mm)
    return Math.min(zA1, zB1) > Math.max(zA0, zB0) + 20;
}

/** Chiếu đa giác 4 đỉnh lên một trục đơn vị `axis`. */
function projectCorners(corners, axis) {
    let min = Infinity, max = -Infinity;
    for (const p of corners) {
        const v = p.x * axis.x + p.y * axis.y;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    return { min, max, mid: (min + max) / 2 };
}

/**
 * Thu thập các mặt trong của tường song song với pháp tuyến `axis` (tức tường vuông góc với `axis`).
 * Trả về danh sách ứng viên toạ độ mặt tường dọc theo `axis` mà vật thể đang nằm gần.
 */
function collectWallFacesAlongAxis(plan, axis, orthoAxis, itemOrthoMin, itemOrthoMax, itemAxisMid) {
    if (!plan?.walls?.length) return [];
    const nodeById = new Map((plan.nodes || []).map(n => [n.id, n]));
    const out = [];
    for (const w of plan.walls) {
        const a = nodeById.get(w.a), b = nodeById.get(w.b);
        if (!a || !b) continue;
        const len = dist(a, b);
        if (len < 1) continue;
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
        const nx = -uy, ny = ux;
        // Pháp tuyến tường phải gần song song với `axis`
        const dotN = nx * axis.x + ny * axis.y;
        if (Math.abs(dotN) < 0.96) continue;

        // Kiểm tra phạm vi chồng lấn theo phương dọc tường (`orthoAxis`)
        const oa = a.x * orthoAxis.x + a.y * orthoAxis.y;
        const ob = b.x * orthoAxis.x + b.y * orthoAxis.y;
        const wMin = Math.min(oa, ob), wMax = Math.max(oa, ob);
        if (itemOrthoMax < wMin - 250 || itemOrthoMin > wMax + 250) continue;

        const wallCenterCoord = a.x * axis.x + a.y * axis.y;
        const halfT = (w.thickness || 110) / 2;
        // Chọn mặt trong của tường phía hướng về tâm món đồ
        const side = itemAxisMid >= wallCenterCoord ? 1 : -1;
        const faceCoord = wallCenterCoord + side * halfT;

        // Đoạn thẳng mặt tường để vẽ đường gióng snap
        const shiftX = (dotN >= 0 ? nx : -nx) * side * halfT;
        const shiftY = (dotN >= 0 ? ny : -ny) * side * halfT;
        out.push({
            coord: faceCoord,
            wallId: w.id,
            p1: { x: a.x + shiftX, y: a.y + shiftY },
            p2: { x: b.x + shiftX, y: b.y + shiftY },
        });
    }
    return out;
}

/**
 * Magnet thông minh khi kéo đặt nội thất:
 *  1. Hút mặt lưng vào mặt trong tường gần nhất & tự xoay hướng vào phòng (cho món `back: true`).
 *     Món `back: false` (bàn ăn, vách kính, đôn...) cũng hít sát mặt tường gần nhất mà không ép xoay.
 *  2. Hút kịch góc tường / mép cột (0mm khe hở) khi đẩy về gần tường vuông góc.
 *  3. Hút sát cạnh (0mm) vào đồ nội thất kế bên (táp đầu giường sát giường, các cục tủ bếp/tủ lạnh sát nhau)
 *     VÀ gióng thẳng mép / thẳng trục tâm với đồ lân cận (bàn trà + kệ TV + TV treo tường gióng tim sofa).
 *
 * Trả về: `{ x, y, rot, snappedWall, snappedFurn, guides: [{ x1, y1, x2, y2, kind }] }`
 */
export function snapFurnitureSmart(plan, otherItems, movingItem, opts = {}) {
    const scale = opts.scale || 0.1;
    const cat = catalogItem(movingItem.kind);
    const w = movingItem.w || cat?.w || 600;
    const d = movingItem.d || cat?.d || 600;
    const wallTol = opts.wallTol ?? Math.max(260, 44 / scale);
    const cornerTol = opts.cornerTol ?? Math.max(200, 34 / scale);
    const furnTol = opts.furnTol ?? Math.max(160, 28 / scale);

    let curRot = movingItem.rot || 0;
    let curX = movingItem.x;
    let curY = movingItem.y;
    let lockedV = false;
    let snappedWall = false;
    let snappedFurn = false;
    const guides = [];

    // ===== BƯỚC 1: Hút mặt lưng vào tường chính (có tự xoay cho món `back: true`) =====
    if (cat?.back && plan?.walls?.length) {
        const nodeById = new Map((plan.nodes || []).map(n => [n.id, n]));
        let best = null;
        let bestGap = wallTol;
        for (const wall of plan.walls) {
            const a = nodeById.get(wall.a), b = nodeById.get(wall.b);
            if (!a || !b) continue;
            const len = dist(a, b);
            if (len < 1) continue;
            const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
            const nx = -uy, ny = ux;
            const rx = curX - a.x, ry = curY - a.y;
            const along = rx * ux + ry * uy;
            const overhang = Math.max(d, w * 0.45);
            if (along < -overhang || along > len + overhang) continue;
            const perp = rx * nx + ry * ny;
            const side = perp >= 0 ? 1 : -1;
            const halfT = (wall.thickness || 110) / 2;
            const rest = halfT + d / 2;
            const gap = Math.abs(Math.abs(perp) - rest);
            if (gap < bestGap) {
                bestGap = gap;
                const rot = normDeg(Math.atan2(-side * nx, side * ny) * 180 / Math.PI);
                best = {
                    x: a.x + ux * along + nx * side * rest,
                    y: a.y + uy * along + ny * side * rest,
                    rot,
                    guide: {
                        x1: a.x + nx * side * halfT,
                        y1: a.y + ny * side * halfT,
                        x2: b.x + nx * side * halfT,
                        y2: b.y + ny * side * halfT,
                        kind: 'wall',
                    },
                };
            }
        }
        if (best) {
            curX = best.x;
            curY = best.y;
            curRot = best.rot;
            lockedV = true;
            snappedWall = true;
            guides.push(best.guide);
        }
    }

    const { right, front } = furnitureBasis(curRot);
    let u = curX * right.x + curY * right.y;
    let v = curX * front.x + curY * front.y;
    const hw = w / 2, hd = d / 2;

    // ===== BƯỚC 2: Ứng viên hút theo trục ngang U (Góc tường/Cột + Đồ nội thất gần nhau) =====
    const uCandidates = [];
    const pushU = (delta, priority, guide) => {
        const abs = Math.abs(delta);
        uCandidates.push({ delta, score: abs * priority, guide });
    };

    // 2a. Góc tường vuông góc / Cột dọc trục U
    const perpWallsU = collectWallFacesAlongAxis(plan, right, front, v - hd, v + hd, u);
    for (const wf of perpWallsU) {
        const dLeft = wf.coord - (u - hw);
        if (Math.abs(dLeft) <= cornerTol) {
            pushU(dLeft, 0.72, { x1: wf.p1.x, y1: wf.p1.y, x2: wf.p2.x, y2: wf.p2.y, kind: 'wall' });
        }
        const dRight = wf.coord - (u + hw);
        if (Math.abs(dRight) <= cornerTol) {
            pushU(dRight, 0.72, { x1: wf.p1.x, y1: wf.p1.y, x2: wf.p2.x, y2: wf.p2.y, kind: 'wall' });
        }
    }

    // 2b. Tường song song trục U (khi chưa khoá lưng `lockedV`, ví dụ bàn ăn, đảo bếp, món xoay tay)
    const vCandidates = [];
    const pushV = (delta, priority, guide) => {
        const abs = Math.abs(delta);
        vCandidates.push({ delta, score: abs * priority, guide });
    };
    if (!lockedV && !cat?.noSnapContact) {
        const perpWallsV = collectWallFacesAlongAxis(plan, front, right, u - hw, u + hw, v);
        for (const wf of perpWallsV) {
            const dBack = wf.coord - (v - hd);
            if (Math.abs(dBack) <= cornerTol) {
                pushV(dBack, 0.75, { x1: wf.p1.x, y1: wf.p1.y, x2: wf.p2.x, y2: wf.p2.y, kind: 'wall' });
            }
            const dFront = wf.coord - (v + hd);
            if (Math.abs(dFront) <= cornerTol) {
                pushV(dFront, 0.75, { x1: wf.p1.x, y1: wf.p1.y, x2: wf.p2.x, y2: wf.p2.y, kind: 'wall' });
            }
        }
    }

    // ===== BƯỚC 3: Đồ nội thất gần nhau (Chạm cạnh 0mm + Gióng mép + Gióng trục tâm) =====
    const makeGuideLineAlongFront = (uCoord, vA, vB, kind) => ({
        x1: uCoord * right.x + vA * front.x,
        y1: uCoord * right.y + vA * front.y,
        x2: uCoord * right.x + vB * front.x,
        y2: uCoord * right.y + vB * front.y,
        kind,
    });
    const makeGuideLineAlongRight = (vCoord, uA, uB, kind) => ({
        x1: uA * right.x + vCoord * front.x,
        y1: uA * right.y + vCoord * front.y,
        x2: uB * right.x + vCoord * front.x,
        y2: uB * right.y + vCoord * front.y,
        kind,
    });

    for (const other of (otherItems || [])) {
        if (!other || other.id === movingItem.id) continue;
        const centerDist = Math.hypot(other.x - curX, other.y - curY);
        if (centerDist > 6200) continue;

        const oCat = catalogItem(other.kind);
        const oCorners = furnitureCorners(other);
        const ou = projectCorners(oCorners, right);
        const ov = projectCorners(oCorners, front);
        const contactOk = canContactSnap(movingItem, cat, other, oCat);

        const vOverlap = Math.min(v + hd, ov.max) - Math.max(v - hd, ov.min);
        const uOverlap = Math.min(u + hw, ou.max) - Math.max(u - hw, ou.min);
        const vSpanMin = Math.min(v - hd, ov.min) - 120;
        const vSpanMax = Math.max(v + hd, ov.max) + 120;
        const uSpanMin = Math.min(u - hw, ou.min) - 120;
        const uSpanMax = Math.max(u + hw, ou.max) + 120;

        // 3a. Chạm cạnh Trái-Phải (0mm khe hở) khi hai món nằm ngang hàng nhau
        if (contactOk && vOverlap > -220) {
            const dTouchLeft = ou.max - (u - hw); // cạnh trái của ta chạm cạnh phải của đồ bên
            if (Math.abs(dTouchLeft) <= furnTol) {
                pushU(dTouchLeft, 0.70, makeGuideLineAlongFront(ou.max, vSpanMin, vSpanMax, 'furn'));
            }
            const dTouchRight = ou.min - (u + hw); // cạnh phải của ta chạm cạnh trái của đồ bên
            if (Math.abs(dTouchRight) <= furnTol) {
                pushU(dTouchRight, 0.70, makeGuideLineAlongFront(ou.min, vSpanMin, vSpanMax, 'furn'));
            }
        }

        // 3b. Gióng thẳng mép Trái/Phải & Gióng tim (Center Axis) theo phương U
        // (VD: Tủ bếp trên gióng thẳng mép tủ bếp dưới; bàn trà + kệ TV + TV gióng tim sofa)
        if (centerDist <= 5800) {
            const alignTol = furnTol * 0.88;
            const dCenterU = ou.mid - u;
            if (Math.abs(dCenterU) <= alignTol) {
                pushU(dCenterU, 0.86, makeGuideLineAlongFront(ou.mid, Math.min(v, ov.mid), Math.max(v, ov.mid), 'align'));
            }
            if (centerDist <= 3800) {
                const dAlignLeft = ou.min - (u - hw);
                if (Math.abs(dAlignLeft) <= alignTol) {
                    pushU(dAlignLeft, 0.90, makeGuideLineAlongFront(ou.min, vSpanMin, vSpanMax, 'align'));
                }
                const dAlignRight = ou.max - (u + hw);
                if (Math.abs(dAlignRight) <= alignTol) {
                    pushU(dAlignRight, 0.90, makeGuideLineAlongFront(ou.max, vSpanMin, vSpanMax, 'align'));
                }
            }
        }

        // 3c. Theo phương sâu V (nếu chưa bị khoá cứng vào tường bởi Bước 1)
        if (!lockedV) {
            if (contactOk && uOverlap > -220) {
                const dTouchBack = ov.max - (v - hd); // lưng ta chạm mặt trước đồ kia (VD: đôn cuối giường)
                if (Math.abs(dTouchBack) <= furnTol) {
                    pushV(dTouchBack, 0.70, makeGuideLineAlongRight(ov.max, uSpanMin, uSpanMax, 'furn'));
                }
                const dTouchFront = ov.min - (v + hd); // mặt trước ta chạm lưng đồ kia
                if (Math.abs(dTouchFront) <= furnTol) {
                    pushV(dTouchFront, 0.70, makeGuideLineAlongRight(ov.min, uSpanMin, uSpanMax, 'furn'));
                }
            }
            if (centerDist <= 3800) {
                const alignTol = furnTol * 0.88;
                const dAlignBack = ov.min - (v - hd);
                if (Math.abs(dAlignBack) <= alignTol) {
                    pushV(dAlignBack, 0.85, makeGuideLineAlongRight(ov.min, uSpanMin, uSpanMax, 'align'));
                }
                const dAlignFront = ov.max - (v + hd);
                if (Math.abs(dAlignFront) <= alignTol) {
                    pushV(dAlignFront, 0.85, makeGuideLineAlongRight(ov.max, uSpanMin, uSpanMax, 'align'));
                }
                const dCenterV = ov.mid - v;
                if (Math.abs(dCenterV) <= alignTol) {
                    pushV(dCenterV, 0.90, makeGuideLineAlongRight(ov.mid, Math.min(u, ou.mid), Math.max(u, ou.mid), 'align'));
                }
            }
        }
    }

    // Chọn ứng viên tốt nhất trên U và V độc lập nhau (có thể vừa kịch góc vừa chạm tường!)
    if (uCandidates.length) {
        uCandidates.sort((a, b) => a.score - b.score);
        u += uCandidates[0].delta;
        guides.push(uCandidates[0].guide);
        if (uCandidates[0].guide.kind === 'wall') snappedWall = true;
        else snappedFurn = true;
    } else if (snappedWall) {
        // Khi trượt dọc tường mà chưa chạm góc/đồ khác thì làm tròn mượt 10mm
        u = Math.round(u / 10) * 10;
    }

    if (!lockedV && vCandidates.length) {
        vCandidates.sort((a, b) => a.score - b.score);
        v += vCandidates[0].delta;
        guides.push(vCandidates[0].guide);
        if (vCandidates[0].guide.kind === 'wall') snappedWall = true;
        else snappedFurn = true;
    }

    let finalX = u * right.x + v * front.x;
    let finalY = u * right.y + v * front.y;

    // Nếu hoàn toàn tự do giữa phòng (không dính bất kỳ nam châm nào), dùng hàm bắt lưới mặc định
    if (!snappedWall && !snappedFurn && opts.fallbackSnap) {
        const p = opts.fallbackSnap({ x: finalX, y: finalY });
        finalX = p.x;
        finalY = p.y;
    }

    return {
        x: Math.round(finalX * 10) / 10,
        y: Math.round(finalY * 10) / 10,
        rot: curRot,
        snappedWall,
        snappedFurn,
        guides,
    };
}

/**
 * Scale 4 chiều bằng kéo tay cầm trên cạnh (`edge`: 'left' | 'right' | 'back' | 'front').
 * Cạnh đối diện được NEO CỐ ĐỊNH tuyệt đối trong toạ độ mặt bằng; cạnh đang kéo tự động
 * magnet vào mặt tường / cột / mép đồ nội thất gần đó!
 */
export function resizeFurnitureEdge(item, edge, worldPt, plan, otherItems, opts = {}) {
    const scale = opts.scale || 0.1;
    const cat = catalogItem(item.kind);
    const curW = item.w || cat?.w || 600;
    const curD = item.d || cat?.d || 600;
    const minSize = opts.minSize ?? ((curW < 180 || curD < 100) ? 50 : 150);
    const snapTol = opts.snapTol ?? Math.min(130, Math.max(45, 15 / scale));

    const { right, front } = furnitureBasis(item.rot || 0);
    const uCenter = item.x * right.x + item.y * right.y;
    const vCenter = item.x * front.x + item.y * front.y;
    const uLeft = uCenter - curW / 2;
    const uRight = uCenter + curW / 2;
    const vBack = vCenter - curD / 2;
    const vFront = vCenter + curD / 2;

    const guides = [];
    const isU = edge === 'left' || edge === 'right';

    if (isU) {
        const startEdgeU = edge === 'right' ? uRight : uLeft;
        let targetU = worldPt.x * right.x + worldPt.y * right.y;
        const cands = [];
        const tolForRef = (refCoord) => (Math.abs(refCoord - startEdgeU) < 3 ? 22 : snapTol);

        // Hút vào tường/cột vuông góc
        const wallFaces = collectWallFacesAlongAxis(plan, right, front, vBack, vFront, uCenter);
        for (const wf of wallFaces) {
            const diff = wf.coord - targetU;
            if (Math.abs(diff) <= tolForRef(wf.coord)) {
                cands.push({ coord: wf.coord, score: Math.abs(diff) * 0.75, guide: { x1: wf.p1.x, y1: wf.p1.y, x2: wf.p2.x, y2: wf.p2.y, kind: 'wall' } });
            }
        }
        // Hút vào mép đồ nội thất lân cận
        for (const other of (otherItems || [])) {
            if (!other || other.id === item.id) continue;
            if (Math.hypot(other.x - item.x, other.y - item.y) > 5500) continue;
            const oc = furnitureCorners(other);
            const ou = projectCorners(oc, right);
            const ov = projectCorners(oc, front);
            const vSpan0 = Math.min(vBack, ov.min) - 100;
            const vSpan1 = Math.max(vFront, ov.max) + 100;
            for (const refU of [ou.min, ou.max]) {
                const diff = refU - targetU;
                if (Math.abs(diff) <= tolForRef(refU)) {
                    cands.push({
                        coord: refU,
                        score: Math.abs(diff) * 0.82,
                        guide: {
                            x1: refU * right.x + vSpan0 * front.x,
                            y1: refU * right.y + vSpan0 * front.y,
                            x2: refU * right.x + vSpan1 * front.x,
                            y2: refU * right.y + vSpan1 * front.y,
                            kind: 'furn',
                        },
                    });
                }
            }
        }
        if (cands.length) {
            cands.sort((a, b) => a.score - b.score);
            targetU = cands[0].coord;
            guides.push(cands[0].guide);
        }

        let newW, newUCenter;
        if (edge === 'right') {
            const rawW = cands.length ? (targetU - uLeft) : Math.round((targetU - uLeft) / 10) * 10;
            newW = Math.max(minSize, Math.round(rawW));
            newUCenter = uLeft + newW / 2;
        } else {
            const rawW = cands.length ? (uRight - targetU) : Math.round((uRight - targetU) / 10) * 10;
            newW = Math.max(minSize, Math.round(rawW));
            newUCenter = uRight - newW / 2;
        }
        return {
            item: {
                ...item,
                w: newW,
                x: Math.round((newUCenter * right.x + vCenter * front.x) * 10) / 10,
                y: Math.round((newUCenter * right.y + vCenter * front.y) * 10) / 10,
            },
            guides,
        };
    }

    // Scale theo chiều sâu ('front' | 'back')
    const startEdgeV = edge === 'front' ? vFront : vBack;
    const tolForRefV = (refCoord) => (Math.abs(refCoord - startEdgeV) < 3 ? 22 : snapTol);
    let targetV = worldPt.x * front.x + worldPt.y * front.y;
    const cands = [];
    const wallFaces = collectWallFacesAlongAxis(plan, front, right, uLeft, uRight, vCenter);
    for (const wf of wallFaces) {
        const diff = wf.coord - targetV;
        if (Math.abs(diff) <= tolForRefV(wf.coord)) {
            cands.push({ coord: wf.coord, score: Math.abs(diff) * 0.75, guide: { x1: wf.p1.x, y1: wf.p1.y, x2: wf.p2.x, y2: wf.p2.y, kind: 'wall' } });
        }
    }
    for (const other of (otherItems || [])) {
        if (!other || other.id === item.id) continue;
        if (Math.hypot(other.x - item.x, other.y - item.y) > 5500) continue;
        const oc = furnitureCorners(other);
        const ou = projectCorners(oc, right);
        const ov = projectCorners(oc, front);
        const uSpan0 = Math.min(uLeft, ou.min) - 100;
        const uSpan1 = Math.max(uRight, ou.max) + 100;
        for (const refV of [ov.min, ov.max]) {
            const diff = refV - targetV;
            if (Math.abs(diff) <= tolForRefV(refV)) {
                cands.push({
                    coord: refV,
                    score: Math.abs(diff) * 0.82,
                    guide: {
                        x1: uSpan0 * right.x + refV * front.x,
                        y1: uSpan0 * right.y + refV * front.y,
                        x2: uSpan1 * right.x + refV * front.x,
                        y2: uSpan1 * right.y + refV * front.y,
                        kind: 'furn',
                    },
                });
            }
        }
    }
    if (cands.length) {
        cands.sort((a, b) => a.score - b.score);
        targetV = cands[0].coord;
        guides.push(cands[0].guide);
    }

    let newD, newVCenter;
    if (edge === 'front') {
        const rawD = cands.length ? (targetV - vBack) : Math.round((targetV - vBack) / 10) * 10;
        newD = Math.max(minSize, Math.round(rawD));
        newVCenter = vBack + newD / 2;
    } else {
        const rawD = cands.length ? (vFront - targetV) : Math.round((vFront - targetV) / 10) * 10;
        newD = Math.max(minSize, Math.round(rawD));
        newVCenter = vFront - newD / 2;
    }
    return {
        item: {
            ...item,
            d: newD,
            x: Math.round((uCenter * right.x + newVCenter * front.x) * 10) / 10,
            y: Math.round((uCenter * right.y + newVCenter * front.y) * 10) / 10,
        },
        guides,
    };
}

/**
 * Scale 1 phía bằng số nhập chính xác (NumPad), giữ cố định cạnh đối diện.
 */
export function resizeFurnitureEdgeByValue(item, edge, newSizeMm) {
    const cat = catalogItem(item.kind);
    const curW = item.w || cat?.w || 600;
    const curD = item.d || cat?.d || 600;
    const minSize = (curW < 180 || curD < 100) ? 50 : 150;
    const val = Math.max(minSize, Math.round(newSizeMm));
    const { right, front } = furnitureBasis(item.rot || 0);
    const uCenter = item.x * right.x + item.y * right.y;
    const vCenter = item.x * front.x + item.y * front.y;

    if (edge === 'right' || edge === 'left') {
        const newU = edge === 'right'
            ? (uCenter - curW / 2) + val / 2
            : (uCenter + curW / 2) - val / 2;
        return {
            ...item,
            w: val,
            x: Math.round((newU * right.x + vCenter * front.x) * 10) / 10,
            y: Math.round((newU * right.y + vCenter * front.y) * 10) / 10,
        };
    }
    const newV = edge === 'front'
        ? (vCenter - curD / 2) + val / 2
        : (vCenter + curD / 2) - val / 2;
    return {
        ...item,
        d: val,
        x: Math.round((uCenter * right.x + newV * front.x) * 10) / 10,
        y: Math.round((uCenter * right.y + newV * front.y) * 10) / 10,
    };
}
