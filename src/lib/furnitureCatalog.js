// Thư viện nội thất — kích thước mm (rộng × sâu), theo Neufert + thực tế thị trường VN.
// w = cạnh song song mặt tường khi rot=0; d = cạnh vuông góc (chiều sâu, hướng vào phòng).
// `back: true` = có mặt lưng áp tường (dùng cho magnet). `back: false` = đặt giữa phòng.

export const GROUPS = [
    { key: 'bedroom', name: 'Phòng ngủ' },
    { key: 'living', name: 'Khách + ăn' },
    { key: 'wc', name: 'WC' },
    { key: 'kitchen', name: 'Bếp' },
    { key: 'other', name: 'Khác' },
];

export const FURNITURE = {
    bedroom: [
        { key: 'bed12', name: 'Giường 1m2', w: 1200, d: 2000, back: true, sym: 'bed' },
        { key: 'bed16', name: 'Giường 1m6', w: 1600, d: 2000, back: true, sym: 'bed' },
        { key: 'bed18', name: 'Giường 1m8', w: 1800, d: 2000, back: true, sym: 'bed' },
        { key: 'bed20', name: 'Giường 2m', w: 2000, d: 2200, back: true, sym: 'bed' },
        { key: 'wardrobe', name: 'Tủ áo', w: 2400, d: 600, back: true, sym: 'cab' },
        { key: 'nightstand', name: 'Táp đầu giường', w: 450, d: 400, back: true, sym: 'box' },
        { key: 'dresser', name: 'Bàn trang điểm', w: 1200, d: 450, back: true, sym: 'cab' },
        { key: 'desk', name: 'Bàn làm việc', w: 1200, d: 600, back: true, sym: 'box' },
    ],
    living: [
        { key: 'sofa3', name: 'Sofa văng 3 chỗ', w: 2100, d: 900, back: true, sym: 'sofa' },
        { key: 'sofaL', name: 'Sofa góc L', w: 2600, d: 1800, back: true, sym: 'sofa' },
        { key: 'coffee', name: 'Bàn trà', w: 1100, d: 600, back: false, sym: 'box' },
        { key: 'tvstand', name: 'Kệ TV', w: 1800, d: 400, back: true, sym: 'cab' },
        { key: 'table4', name: 'Bàn ăn 4 ghế', w: 1200, d: 800, back: false, sym: 'table' },
        { key: 'table6', name: 'Bàn ăn 6 ghế', w: 1600, d: 900, back: false, sym: 'table' },
        { key: 'table8', name: 'Bàn ăn 8 ghế', w: 2000, d: 1000, back: false, sym: 'table' },
        { key: 'table10', name: 'Bàn ăn 10 ghế', w: 2400, d: 1100, back: false, sym: 'table' },
        { key: 'cabinet', name: 'Tủ trang trí', w: 1200, d: 400, back: true, sym: 'cab' },
    ],
    wc: [
        { key: 'toilet', name: 'Bồn cầu', w: 400, d: 700, back: true, sym: 'toilet' },
        { key: 'lavabo1', name: 'Lavabo 1 chậu', w: 600, d: 500, back: true, sym: 'basin' },
        { key: 'lavabo2', name: 'Lavabo 2 chậu', w: 1200, d: 500, back: true, sym: 'basin' },
        { key: 'shower', name: 'Sen tắm', w: 900, d: 900, back: true, sym: 'shower' },
        { key: 'bathtub', name: 'Bồn tắm', w: 1700, d: 800, back: true, sym: 'tub' },
        { key: 'mirrorcab', name: 'Tủ gương', w: 800, d: 150, back: true, sym: 'cab' },
    ],
    kitchen: [
        // Tủ bếp chỉ có dạng chữ I — ghép 2 đoạn thành L, 3 đoạn thành U
        { key: 'kitchen15', name: 'Tủ bếp 1m5', w: 1500, d: 600, back: true, sym: 'cab' },
        { key: 'kitchen24', name: 'Tủ bếp 2m4', w: 2400, d: 600, back: true, sym: 'cab' },
        { key: 'kitchen30', name: 'Tủ bếp 3m', w: 3000, d: 600, back: true, sym: 'cab' },
        { key: 'island', name: 'Đảo bếp', w: 1800, d: 900, back: false, sym: 'box' },
        { key: 'hob', name: 'Bếp từ', w: 750, d: 450, back: true, sym: 'hob' },
        { key: 'sink', name: 'Chậu rửa', w: 800, d: 500, back: true, sym: 'basin' },
        { key: 'fridge', name: 'Tủ lạnh', w: 900, d: 750, back: true, sym: 'box' },
        { key: 'hood', name: 'Máy hút mùi', w: 900, d: 500, back: true, sym: 'box' },
    ],
    other: [
        { key: 'winecab', name: 'Tủ rượu', w: 1200, d: 450, back: true, sym: 'cab' },
        { key: 'altar', name: 'Bàn thờ', w: 1270, d: 620, back: true, sym: 'altar' },
        { key: 'altarsmall', name: 'Bàn thờ nhỏ', w: 1070, d: 480, back: true, sym: 'altar' },
        { key: 'shoecab', name: 'Tủ giày', w: 1000, d: 350, back: true, sym: 'cab' },
        { key: 'washer', name: 'Máy giặt', w: 600, d: 600, back: true, sym: 'box' },
        { key: 'stairs', name: 'Thang bộ', w: 1000, d: 3000, back: true, sym: 'stairs' },
    ],
};

const BY_KEY = new Map();
for (const g of GROUPS) for (const it of FURNITURE[g.key]) BY_KEY.set(it.key, { ...it, group: g.key });

export function catalogItem(key) { return BY_KEY.get(key) || null; }

/** Kích thước hiệu dụng: settings.furnitureDefaults[key] ghi đè catalog. */
export function defaultSize(key, settings) {
    const base = BY_KEY.get(key);
    if (!base) return { w: 600, d: 600 };
    const ov = settings?.furnitureDefaults?.[key];
    return { w: ov?.w || base.w, d: ov?.d || base.d };
}
