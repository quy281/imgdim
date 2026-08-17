// Thư viện nội thất — kích thước mm (rộng × sâu × cao), theo Neufert + thực tế thị trường VN.
// w = cạnh song song mặt tường khi rot=0; d = cạnh vuông góc (chiều sâu, hướng vào phòng).
// h = chiều cao; z = cao độ đáy so với sàn hoàn thiện (0 = đặt trên sàn).
// `back: true` = có mặt lưng áp tường (dùng cho magnet). `back: false` = đặt giữa phòng.
// `mount: 'ceiling'` = neo từ trần xuống, z suy ra = H − h, nên sửa chiều cao trần thì
// nó đi theo chứ không nằm lơ lửng.

export const GROUPS = [
    { key: 'bedroom', name: 'Phòng ngủ' },
    { key: 'living', name: 'Khách + ăn' },
    { key: 'wc', name: 'WC' },
    { key: 'kitchen', name: 'Bếp' },
    { key: 'elec', name: 'Điện & TB' },
    { key: 'other', name: 'Khác' },
];

export const FURNITURE = {
    bedroom: [
        { key: 'bed12', name: 'Giường 1m2', w: 1200, d: 2000, h: 450, z: 0, back: true, sym: 'bed' },
        { key: 'bed16', name: 'Giường 1m6', w: 1600, d: 2000, h: 450, z: 0, back: true, sym: 'bed' },
        { key: 'bed18', name: 'Giường 1m8', w: 1800, d: 2000, h: 450, z: 0, back: true, sym: 'bed' },
        { key: 'bed20', name: 'Giường 2m', w: 2000, d: 2200, h: 450, z: 0, back: true, sym: 'bed' },
        { key: 'headboard', name: 'Đầu giường ốp', w: 2000, d: 100, h: 1200, z: 0, back: true, sym: 'cab' },
        { key: 'wardrobe', name: 'Tủ áo', w: 2400, d: 600, h: 2400, z: 0, back: true, sym: 'cab' },
        { key: 'nightstand', name: 'Táp đầu giường', w: 450, d: 400, h: 550, z: 0, back: true, sym: 'box' },
        { key: 'dresser', name: 'Bàn trang điểm', w: 1200, d: 450, h: 750, z: 0, back: true, sym: 'cab' },
        { key: 'desk', name: 'Bàn làm việc', w: 1200, d: 600, h: 750, z: 0, back: true, sym: 'box' },
    ],
    living: [
        { key: 'sofa3', name: 'Sofa văng 3 chỗ', w: 2100, d: 900, h: 800, z: 0, back: true, sym: 'sofa' },
        { key: 'sofaL', name: 'Sofa góc L', w: 2600, d: 1800, h: 800, z: 0, back: true, sym: 'sofa' },
        { key: 'coffee', name: 'Bàn trà', w: 1100, d: 600, h: 400, z: 0, back: false, sym: 'box' },
        { key: 'tvstand', name: 'Kệ TV', w: 1800, d: 400, h: 400, z: 0, back: true, sym: 'cab' },
        { key: 'tv', name: 'TV treo tường', w: 1400, d: 80, h: 800, z: 900, back: true, mount: 'wall', sym: 'tv' },
        { key: 'table4', name: 'Bàn ăn 4 ghế', w: 1200, d: 800, h: 750, z: 0, back: false, sym: 'table' },
        { key: 'table6', name: 'Bàn ăn 6 ghế', w: 1600, d: 900, h: 750, z: 0, back: false, sym: 'table' },
        { key: 'table8', name: 'Bàn ăn 8 ghế', w: 2000, d: 1000, h: 750, z: 0, back: false, sym: 'table' },
        { key: 'table10', name: 'Bàn ăn 10 ghế', w: 2400, d: 1100, h: 750, z: 0, back: false, sym: 'table' },
        { key: 'cabinet', name: 'Tủ trang trí', w: 1200, d: 400, h: 2000, z: 0, back: true, sym: 'cab' },
    ],
    wc: [
        { key: 'toilet', name: 'Bồn cầu', w: 400, d: 700, h: 400, z: 0, back: true, sym: 'toilet' },
        { key: 'lavabo1', name: 'Lavabo 1 chậu', w: 600, d: 500, h: 850, z: 0, back: true, sym: 'basin' },
        { key: 'lavabo2', name: 'Lavabo 2 chậu', w: 1200, d: 500, h: 850, z: 0, back: true, sym: 'basin' },
        { key: 'shower', name: 'Sen tắm', w: 900, d: 900, h: 2100, z: 0, back: true, sym: 'shower' },
        { key: 'bathtub', name: 'Bồn tắm', w: 1700, d: 800, h: 600, z: 0, back: true, sym: 'tub' },
        { key: 'mirrorcab', name: 'Tủ gương', w: 800, d: 150, h: 700, z: 1400, back: true, mount: 'wall', sym: 'cab' },
    ],
    kitchen: [
        // Tủ bếp chỉ có dạng chữ I — ghép 2 đoạn thành L, 3 đoạn thành U
        { key: 'kitchen15', name: 'Tủ bếp dưới 1m5', w: 1500, d: 600, h: 850, z: 0, back: true, sym: 'cab' },
        { key: 'kitchen24', name: 'Tủ bếp dưới 2m4', w: 2400, d: 600, h: 850, z: 0, back: true, sym: 'cab' },
        { key: 'kitchen30', name: 'Tủ bếp dưới 3m', w: 3000, d: 600, h: 850, z: 0, back: true, sym: 'cab' },
        // Thiếu tủ trên thì mặt đứng bếp gần như vô nghĩa
        { key: 'kitchenup24', name: 'Tủ bếp trên 2m4', w: 2400, d: 350, h: 700, z: 1500, back: true, mount: 'wall', sym: 'cab' },
        { key: 'kitchenup30', name: 'Tủ bếp trên 3m', w: 3000, d: 350, h: 700, z: 1500, back: true, mount: 'wall', sym: 'cab' },
        { key: 'island', name: 'Đảo bếp', w: 1800, d: 900, h: 850, z: 0, back: false, sym: 'box' },
        { key: 'hob', name: 'Bếp từ', w: 750, d: 450, h: 60, z: 850, back: true, sym: 'hob' },
        { key: 'sink', name: 'Chậu rửa', w: 800, d: 500, h: 200, z: 650, back: true, sym: 'basin' },
        { key: 'fridge', name: 'Tủ lạnh', w: 900, d: 750, h: 1800, z: 0, back: true, sym: 'box' },
        { key: 'hood', name: 'Máy hút mùi', w: 900, d: 500, h: 600, z: 1600, back: true, mount: 'wall', sym: 'box' },
    ],
    elec: [
        { key: 'socket', name: 'Ổ điện', w: 86, d: 30, h: 86, z: 400, back: true, mount: 'wall', sym: 'socket' },
        { key: 'socket_hi', name: 'Ổ điện cao', w: 86, d: 30, h: 86, z: 1100, back: true, mount: 'wall', sym: 'socket' },
        { key: 'switch', name: 'Công tắc', w: 86, d: 30, h: 86, z: 1200, back: true, mount: 'wall', sym: 'switch' },
        { key: 'tv_out', name: 'Chờ TV', w: 150, d: 30, h: 150, z: 900, back: true, mount: 'wall', sym: 'socket' },
        { key: 'ac_wall', name: 'Dàn lạnh treo', w: 1100, d: 250, h: 320, z: 2400, back: true, mount: 'wall', sym: 'ac' },
        { key: 'ac_cass', name: 'Máy lạnh âm trần', w: 840, d: 840, h: 250, back: false, mount: 'ceiling', sym: 'ac' },
        { key: 'wall_lamp', name: 'Đèn tường', w: 200, d: 150, h: 300, z: 1800, back: true, mount: 'wall', sym: 'lamp' },
        { key: 'cove', name: 'Đèn hắt trần', w: 2000, d: 60, h: 60, back: true, mount: 'ceiling', sym: 'cove' },
        { key: 'curtainbox', name: 'Hộp rèm', w: 2000, d: 200, h: 250, back: true, mount: 'ceiling', sym: 'box' },
    ],
    other: [
        { key: 'winecab', name: 'Tủ rượu', w: 1200, d: 450, h: 2000, z: 0, back: true, sym: 'cab' },
        { key: 'altar', name: 'Bàn thờ', w: 1270, d: 620, h: 1270, z: 0, back: true, sym: 'altar' },
        { key: 'altarsmall', name: 'Bàn thờ nhỏ', w: 1070, d: 480, h: 1070, z: 0, back: true, sym: 'altar' },
        { key: 'altarhang', name: 'Bàn thờ treo', w: 1070, d: 480, h: 200, z: 1500, back: true, mount: 'wall', sym: 'altar' },
        { key: 'shoecab', name: 'Tủ giày', w: 1000, d: 350, h: 1200, z: 0, back: true, sym: 'cab' },
        { key: 'washer', name: 'Máy giặt', w: 600, d: 600, h: 850, z: 0, back: true, sym: 'box' },
        { key: 'stairs', name: 'Thang bộ', w: 1000, d: 3000, h: 2800, z: 0, back: true, sym: 'stairs' },
    ],
};

const BY_KEY = new Map();
for (const g of GROUPS) for (const it of FURNITURE[g.key]) BY_KEY.set(it.key, { ...it, group: g.key });

export function catalogItem(key) { return BY_KEY.get(key) || null; }

/** Kích thước hiệu dụng: settings.furnitureDefaults[key] ghi đè catalog. */
export function defaultSize(key, settings) {
    const base = BY_KEY.get(key);
    if (!base) return { w: 600, d: 600, h: 800, z: 0 };
    const ov = settings?.furnitureDefaults?.[key];
    return {
        w: ov?.w || base.w,
        d: ov?.d || base.d,
        h: ov?.h || base.h || 800,
        // z = 0 là giá trị hợp lệ (đặt trên sàn) nên phải kiểm null/undefined,
        // không dùng `||` — nếu không mọi món kê sàn sẽ nhảy lên cao độ mặc định.
        z: ov?.z ?? base.z ?? 0,
    };
}

/**
 * Cao độ đáy thật của một món khi đã biết chiều cao trần.
 * Món neo trần (đèn hắt, hộp rèm, máy lạnh âm trần) treo từ trần xuống nên phải
 * đi theo khi sửa chiều cao trần, không được nằm lơ lửng ở cao độ cũ.
 */
export function resolveZ(item, cat, H) {
    const h = item.h ?? cat?.h ?? 0;
    if (cat?.mount === 'ceiling') return Math.max(0, H - h);
    return item.z ?? cat?.z ?? 0;
}
