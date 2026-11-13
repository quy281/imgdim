// Thư viện nội thất động 2D & 3D — kích thước mm (rộng × sâu × cao), theo Neufert + thực tế thị trường VN.
// Hỗ trợ tuỳ chỉnh & quản trị từ Backend (kích thước, ký hiệu 2D/SVG, vật liệu 3D, file .glb/.gltf)
// nhưng vẫn tương thích ngược 100% với toàn bộ dự án cũ & bộ test hiện tại.
import localforage from 'localforage';

export const GROUPS = [
    { key: 'bedroom', name: 'Phòng ngủ' },
    { key: 'living', name: 'Khách + ăn' },
    { key: 'kitchen', name: 'Bếp' },
    { key: 'wc', name: 'WC' },
    { key: 'elec', name: 'Điện & TB' },
    { key: 'other', name: 'Khác' },
];

export const SYM_2D_OPTIONS = [
    { key: 'bed', label: 'Giường ngủ' },
    { key: 'headboard', label: 'Đầu giường ốp' },
    { key: 'wardrobe', label: 'Tủ áo cánh mở' },
    { key: 'wardrobe_slide', label: 'Tủ áo cửa lùa' },
    { key: 'cab', label: 'Tủ / Kệ đứng' },
    { key: 'cab_wall', label: 'Tủ treo tường' },
    { key: 'kitchen_base', label: 'Tủ bếp dưới' },
    { key: 'island', label: 'Đảo bếp + ghế bar' },
    { key: 'nightstand', label: 'Táp đầu giường' },
    { key: 'dresser', label: 'Bàn trang điểm' },
    { key: 'desk', label: 'Bàn làm việc + ghế' },
    { key: 'bench', label: 'Đôn / Ghế băng' },
    { key: 'sofa', label: 'Sofa văng' },
    { key: 'sofaL', label: 'Sofa góc L' },
    { key: 'armchair', label: 'Ghế đơn Armchair' },
    { key: 'coffee', label: 'Bàn trà' },
    { key: 'rug', label: 'Thảm trải sàn' },
    { key: 'tvstand', label: 'Kệ TV' },
    { key: 'tv', label: 'TV treo tường' },
    { key: 'table', label: 'Bàn ăn + ghế' },
    { key: 'partition', label: 'Vách lam ngăn' },
    { key: 'plant', label: 'Chậu cây xanh' },
    { key: 'toilet', label: 'Bồn cầu' },
    { key: 'basin', label: 'Lavabo' },
    { key: 'sink', label: 'Chậu rửa chén' },
    { key: 'sink2', label: 'Chậu rửa 2 hố + bàn' },
    { key: 'hob', label: 'Bếp từ' },
    { key: 'fridge', label: 'Tủ lạnh' },
    { key: 'hood', label: 'Máy hút mùi' },
    { key: 'shower', label: 'Buồng tắm đứng' },
    { key: 'glass_part', label: 'Vách kính tắm' },
    { key: 'tub', label: 'Bồn tắm nằm' },
    { key: 'washer', label: 'Máy giặt / Tháp giặt' },
    { key: 'ac_wall', label: 'Dàn lạnh treo tường' },
    { key: 'ac_cass', label: 'Máy lạnh âm trần' },
    { key: 'curtain', label: 'Rèm & Hộp rèm' },
    { key: 'socket', label: 'Ổ điện / Chờ TV' },
    { key: 'switch', label: 'Công tắc' },
    { key: 'lamp', label: 'Đèn tường' },
    { key: 'cove', label: 'Đèn hắt trần' },
    { key: 'altar', label: 'Bàn thờ' },
    { key: 'shoe_bench', label: 'Tủ giày kèm đôn' },
    { key: 'stairs', label: 'Thang bộ' },
    { key: 'box', label: 'Khối hộp chữ nhật đơn giản' },
];

export const SYM_3D_OPTIONS = [
    { key: '', label: 'Theo ký hiệu 2D (Tự động)' },
    { key: 'box', label: 'Khối hộp đặc kiến trúc' },
    { key: 'shelf_open', label: 'Kệ / Tủ mở nhiều tầng' },
    { key: 'cabinet_glass', label: 'Tủ cánh kính khung nhôm' },
    ...SYM_2D_OPTIONS.filter(x => x.key !== 'box'),
];

export const MAT_3D_OPTIONS = [
    { key: '', label: 'Mặc định theo mẫu', color: null },
    { key: 'oak', label: 'Gỗ sồi tự nhiên', color: '#c99a6b' },
    { key: 'oakDark', label: 'Gỗ óc chó trầm', color: '#8b5a2b' },
    { key: 'redwood', label: 'Gỗ gõ đỏ', color: '#6e2c1b' },
    { key: 'whiteMatte', label: 'Sơn trắng mờ', color: '#f8fafc' },
    { key: 'cream', label: 'Kem ấm / Vải sáng', color: '#f3efe6' },
    { key: 'stone', label: 'Đá thạch anh trắng', color: '#eef2f6' },
    { key: 'fabricWarm', label: 'Vải nỉ be ấm', color: '#d6d1c7' },
    { key: 'fabricSlate', label: 'Vải xám ghi', color: '#64748b' },
    { key: 'fabricBlue', label: 'Vải xanh Navy', color: '#476885' },
    { key: 'duvet', label: 'Chăn ga trắng xám', color: '#e2e8f0' },
    { key: 'ceramic', label: 'Sứ bóng vệ sinh', color: '#ffffff' },
    { key: 'steel', label: 'Inox / Thép xước', color: '#cbd5e1' },
    { key: 'graphite', label: 'Nhôm đen Graphite', color: '#334155' },
    { key: 'darkGlass', label: 'Kính tối / Màn hình', color: '#0f172a' },
    { key: 'mirror', label: 'Gương soi', color: '#dbeafe' },
    { key: 'brass', label: 'Đồng thau mạ vàng', color: '#d4af37' },
    { key: 'leaf', label: 'Xanh lá cây', color: '#2e7d32' },
];

export const BUILTIN_FURNITURE = {
    bedroom: [
        { key: 'bed12', name: 'Giường 1m2', w: 1200, d: 2000, h: 450, z: 0, back: true, sym: 'bed' },
        { key: 'bed16', name: 'Giường 1m6', w: 1600, d: 2000, h: 450, z: 0, back: true, sym: 'bed' },
        { key: 'bed18', name: 'Giường 1m8', w: 1800, d: 2000, h: 450, z: 0, back: true, sym: 'bed' },
        { key: 'bed20', name: 'Giường 2m', w: 2000, d: 2200, h: 450, z: 0, back: true, sym: 'bed' },
        { key: 'headboard', name: 'Đầu giường ốp', w: 2000, d: 100, h: 1200, z: 0, back: true, sym: 'headboard' },
        { key: 'wardrobe', name: 'Tủ áo cánh mở', w: 2400, d: 600, h: 2400, z: 0, back: true, sym: 'wardrobe' },
        { key: 'wardrobe_slide', name: 'Tủ áo cửa lùa', w: 2000, d: 600, h: 2400, z: 0, back: true, sym: 'wardrobe_slide' },
        { key: 'nightstand', name: 'Táp đầu giường', w: 450, d: 400, h: 550, z: 0, back: true, sym: 'nightstand' },
        { key: 'dresser', name: 'Bàn trang điểm', w: 1200, d: 450, h: 750, z: 0, back: true, sym: 'dresser' },
        { key: 'desk', name: 'Bàn làm việc', w: 1200, d: 600, h: 750, z: 0, back: true, sym: 'desk' },
        { key: 'bench_bed', name: 'Đôn cuối giường', w: 1400, d: 450, h: 450, z: 0, back: false, sym: 'bench' },
    ],
    living: [
        { key: 'sofa3', name: 'Sofa văng 3 chỗ', w: 2100, d: 900, h: 800, z: 0, back: true, sym: 'sofa' },
        { key: 'sofaL', name: 'Sofa góc L', w: 2600, d: 1800, h: 800, z: 0, back: true, sym: 'sofaL' },
        { key: 'armchair', name: 'Ghế đơn Armchair', w: 850, d: 850, h: 800, z: 0, back: false, sym: 'armchair' },
        { key: 'coffee', name: 'Bàn trà', w: 1100, d: 600, h: 400, z: 0, back: false, sym: 'coffee' },
        { key: 'rug', name: 'Thảm trải sàn', w: 2400, d: 1700, h: 12, z: 0, back: false, noSnapContact: true, sym: 'rug' },
        { key: 'tvstand', name: 'Kệ TV', w: 1800, d: 400, h: 420, z: 0, back: true, sym: 'tvstand' },
        { key: 'tv', name: 'TV treo tường', w: 1400, d: 80, h: 800, z: 900, back: true, mount: 'wall', sym: 'tv' },
        { key: 'table4', name: 'Bàn ăn 4 ghế', w: 1200, d: 800, h: 750, z: 0, back: false, sym: 'table' },
        { key: 'table6', name: 'Bàn ăn 6 ghế', w: 1600, d: 900, h: 750, z: 0, back: false, sym: 'table' },
        { key: 'table8', name: 'Bàn ăn 8 ghế', w: 2000, d: 1000, h: 750, z: 0, back: false, sym: 'table' },
        { key: 'table10', name: 'Bàn ăn 10 ghế', w: 2400, d: 1100, h: 750, z: 0, back: false, sym: 'table' },
        { key: 'cabinet', name: 'Tủ trang trí', w: 1200, d: 400, h: 2000, z: 0, back: true, sym: 'cab' },
        { key: 'partition', name: 'Vách lam ngăn', w: 1200, d: 120, h: 2600, z: 0, back: false, sym: 'partition' },
        { key: 'plant', name: 'Chậu cây xanh', w: 450, d: 450, h: 1200, z: 0, back: false, sym: 'plant' },
    ],
    kitchen: [
        // Tủ bếp dạng mô-đun — ghép nối tự hít nhau thành chữ I, L, U
        { key: 'kitchen15', name: 'Tủ bếp dưới 1m5', w: 1500, d: 600, h: 850, z: 0, back: true, sym: 'kitchen_base' },
        { key: 'kitchen24', name: 'Tủ bếp dưới 2m4', w: 2400, d: 600, h: 850, z: 0, back: true, sym: 'kitchen_base' },
        { key: 'kitchen30', name: 'Tủ bếp dưới 3m', w: 3000, d: 600, h: 850, z: 0, back: true, sym: 'kitchen_base' },
        { key: 'kitchenup24', name: 'Tủ bếp trên 2m4', w: 2400, d: 350, h: 700, z: 1500, back: true, mount: 'wall', sym: 'cab_wall' },
        { key: 'kitchenup30', name: 'Tủ bếp trên 3m', w: 3000, d: 350, h: 700, z: 1500, back: true, mount: 'wall', sym: 'cab_wall' },
        { key: 'tall_oven', name: 'Tủ cột lò nướng', w: 600, d: 600, h: 2200, z: 0, back: true, sym: 'cab' },
        { key: 'island', name: 'Đảo bếp', w: 1800, d: 900, h: 850, z: 0, back: false, sym: 'island' },
        { key: 'hob', name: 'Bếp từ', w: 750, d: 450, h: 60, z: 850, back: true, sym: 'hob' },
        { key: 'sink', name: 'Chậu rửa', w: 800, d: 500, h: 200, z: 650, back: true, sym: 'sink' },
        { key: 'sink2', name: 'Chậu rửa 2 hố + bàn', w: 1100, d: 500, h: 200, z: 650, back: true, sym: 'sink2' },
        { key: 'fridge', name: 'Tủ lạnh 2 cánh', w: 900, d: 750, h: 1800, z: 0, back: true, sym: 'fridge' },
        { key: 'fridge_sbs', name: 'Tủ lạnh Side-by-Side', w: 920, d: 750, h: 1820, z: 0, back: true, sym: 'fridge' },
        { key: 'hood', name: 'Máy hút mùi', w: 900, d: 500, h: 600, z: 1600, back: true, mount: 'wall', sym: 'hood' },
    ],
    wc: [
        { key: 'toilet', name: 'Bồn cầu', w: 400, d: 700, h: 400, z: 0, back: true, sym: 'toilet' },
        { key: 'lavabo1', name: 'Lavabo 1 chậu', w: 600, d: 500, h: 850, z: 0, back: true, sym: 'basin' },
        { key: 'lavabo2', name: 'Lavabo 2 chậu', w: 1200, d: 500, h: 850, z: 0, back: true, sym: 'basin' },
        { key: 'shower', name: 'Buồng tắm đứng', w: 900, d: 900, h: 2100, z: 0, back: true, sym: 'shower' },
        { key: 'glass_part', name: 'Vách kính tắm', w: 1000, d: 40, h: 2000, z: 0, back: false, sym: 'glass_part' },
        { key: 'bathtub', name: 'Bồn tắm nằm', w: 1700, d: 800, h: 600, z: 0, back: true, sym: 'tub' },
        { key: 'mirrorcab', name: 'Tủ gương treo', w: 800, d: 150, h: 700, z: 1400, back: true, mount: 'wall', sym: 'cab_wall' },
    ],
    elec: [
        { key: 'socket', name: 'Ổ điện', w: 86, d: 30, h: 86, z: 400, back: true, mount: 'wall', sym: 'socket' },
        { key: 'socket_hi', name: 'Ổ điện cao', w: 86, d: 30, h: 86, z: 1100, back: true, mount: 'wall', sym: 'socket' },
        { key: 'switch', name: 'Công tắc', w: 86, d: 30, h: 86, z: 1200, back: true, mount: 'wall', sym: 'switch' },
        { key: 'tv_out', name: 'Chờ TV', w: 150, d: 30, h: 150, z: 900, back: true, mount: 'wall', sym: 'socket' },
        { key: 'ac_wall', name: 'Dàn lạnh treo', w: 1100, d: 250, h: 320, z: 2400, back: true, mount: 'wall', sym: 'ac_wall' },
        { key: 'ac_cass', name: 'Máy lạnh âm trần', w: 840, d: 840, h: 250, back: false, mount: 'ceiling', sym: 'ac_cass' },
        { key: 'wall_lamp', name: 'Đèn tường', w: 200, d: 150, h: 300, z: 1800, back: true, mount: 'wall', sym: 'lamp' },
        { key: 'cove', name: 'Đèn hắt trần', w: 2000, d: 60, h: 60, back: true, mount: 'ceiling', sym: 'cove' },
        { key: 'curtainbox', name: 'Rèm & Hộp rèm', w: 2000, d: 200, h: 250, back: true, mount: 'ceiling', sym: 'curtain' },
    ],
    other: [
        { key: 'winecab', name: 'Tủ rượu', w: 1200, d: 450, h: 2000, z: 0, back: true, sym: 'cab' },
        { key: 'altar', name: 'Bàn thờ', w: 1270, d: 620, h: 1270, z: 0, back: true, sym: 'altar' },
        { key: 'altarsmall', name: 'Bàn thờ nhỏ', w: 1070, d: 480, h: 1070, z: 0, back: true, sym: 'altar' },
        { key: 'altarhang', name: 'Bàn thờ treo', w: 1070, d: 480, h: 200, z: 1500, back: true, mount: 'wall', sym: 'altar' },
        { key: 'shoecab', name: 'Tủ giày', w: 1000, d: 350, h: 1200, z: 0, back: true, sym: 'cab' },
        { key: 'shoe_bench', name: 'Tủ giày kèm đôn', w: 1400, d: 380, h: 1100, z: 0, back: true, sym: 'shoe_bench' },
        { key: 'washer', name: 'Máy giặt', w: 600, d: 600, h: 850, z: 0, back: true, sym: 'washer' },
        { key: 'washer_dryer', name: 'Tháp giặt sấy', w: 650, d: 650, h: 1750, z: 0, back: true, sym: 'washer' },
        { key: 'stairs', name: 'Thang bộ', w: 1000, d: 3000, h: 2800, z: 0, back: true, sym: 'stairs' },
    ],
};

const STORAGE_KEY = 'mkg_furniture_catalog_v1';
const STATE_ASSET_KEY = 'catalog_state_v1';
const GLB_PREFIX = 'glb_';

let assetStore = null;
function getAssetStore() {
    if (assetStore) return assetStore;
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return null;
    try {
        assetStore = localforage.createInstance({
            name: 'mkg-khaosat-catalog',
            storeName: 'catalog_assets',
            description: 'Custom 2D/3D furniture library assets',
        });
    } catch {
        assetStore = null;
    }
    return assetStore;
}

const BUILTIN_BY_KEY = new Map();
for (const g of GROUPS) {
    for (const it of BUILTIN_FURNITURE[g.key]) {
        BUILTIN_BY_KEY.set(it.key, { ...it, group: g.key });
    }
}

export const FURNITURE = Object.fromEntries(GROUPS.map(g => [g.key, []]));
const BY_KEY = new Map();
const GLB_MEM_CACHE = new Map();
const LISTENERS = new Set();
let catalogVersion = 0;

function emptyState() {
    return {
        version: 1,
        updatedAt: 0,
        overrides: {},
        customItems: [],
        deletedKeys: [],
    };
}

function readLocalStateSync() {
    try {
        if (typeof localStorage === 'undefined' || typeof localStorage?.getItem !== 'function') return emptyState();
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return emptyState();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return emptyState();
        return {
            version: 1,
            updatedAt: Number(parsed.updatedAt) || 0,
            overrides: parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {},
            customItems: Array.isArray(parsed.customItems) ? parsed.customItems : [],
            deletedKeys: Array.isArray(parsed.deletedKeys) ? parsed.deletedKeys : [],
        };
    } catch {
        return emptyState();
    }
}

let catalogState = readLocalStateSync();

function notifyListeners() {
    catalogVersion += 1;
    for (const fn of LISTENERS) {
        try { fn(catalogVersion); } catch { /* ignore */ }
    }
}

function sanitizeGroup(gKey) {
    return GROUPS.some(g => g.key === gKey) ? gKey : 'other';
}

function sanitizePatch(raw, base = null) {
    const out = {};
    const validStr = (v) => (typeof v === 'string' ? v.trim() : '');
    if (raw.name != null) out.name = validStr(raw.name) || base?.name || 'Mẫu mới';
    if (raw.group != null) out.group = sanitizeGroup(raw.group);
    if (raw.w != null && Number.isFinite(Number(raw.w))) out.w = Math.max(20, Math.round(Number(raw.w)));
    if (raw.d != null && Number.isFinite(Number(raw.d))) out.d = Math.max(20, Math.round(Number(raw.d)));
    if (raw.h != null && Number.isFinite(Number(raw.h))) out.h = Math.max(10, Math.round(Number(raw.h)));
    if (raw.z != null && Number.isFinite(Number(raw.z))) out.z = Math.max(0, Math.round(Number(raw.z)));
    if (raw.back !== undefined) out.back = !!raw.back;
    if (raw.noSnapContact !== undefined) out.noSnapContact = !!raw.noSnapContact;
    if (raw.mount !== undefined) {
        out.mount = raw.mount === 'wall' || raw.mount === 'ceiling' ? raw.mount : 'floor';
    }
    if (raw.sym !== undefined) out.sym = validStr(raw.sym) || base?.sym || 'box';
    if (raw.sym3d !== undefined) out.sym3d = validStr(raw.sym3d);
    if (raw.color2d !== undefined) out.color2d = validStr(raw.color2d);
    if (raw.fill2d !== undefined) out.fill2d = validStr(raw.fill2d);
    if (raw.svg2d !== undefined) out.svg2d = typeof raw.svg2d === 'string' ? raw.svg2d.trim() : '';
    if (raw.matPrimary !== undefined) out.matPrimary = validStr(raw.matPrimary);
    if (raw.matSecondary !== undefined) out.matSecondary = validStr(raw.matSecondary);
    if (raw.matAccent !== undefined) out.matAccent = validStr(raw.matAccent);
    if (raw.glbUrl !== undefined) out.glbUrl = validStr(raw.glbUrl);
    if (raw.glbFileName !== undefined) out.glbFileName = validStr(raw.glbFileName);
    if (raw.modelFormat !== undefined) out.modelFormat = validStr(raw.modelFormat).toLowerCase();
    if (raw.glbRotX != null && Number.isFinite(Number(raw.glbRotX))) out.glbRotX = Number(raw.glbRotX) % 360;
    if (raw.glbRotY != null && Number.isFinite(Number(raw.glbRotY))) out.glbRotY = Number(raw.glbRotY) % 360;
    if (raw.hasLocalGlb !== undefined) out.hasLocalGlb = !!raw.hasLocalGlb;
    if (raw.hidden !== undefined) out.hidden = !!raw.hidden;
    return out;
}

export function isDesktopCatalogSupported() {
    if (typeof window === 'undefined') return true;
    const w = window.innerWidth || 0;
    if (w < 900) return false;
    try {
        if (window.matchMedia?.('(pointer: coarse)').matches && w < 1024) return false;
    } catch { /* ignore */ }
    return true;
}

function rebuildCatalog() {
    BY_KEY.clear();
    const deleted = new Set(catalogState.deletedKeys || []);
    const grouped = Object.fromEntries(GROUPS.map(g => [g.key, []]));

    for (const g of GROUPS) {
        for (const base of BUILTIN_FURNITURE[g.key]) {
            const ov = catalogState.overrides?.[base.key];
            const merged = {
                mount: 'floor',
                ...base,
                group: g.key,
                ...(ov || {}),
                key: base.key,
                isBuiltin: true,
                isCustom: false,
                isModified: !!(ov && Object.keys(ov).length > 0),
                hidden: !!(ov?.hidden || deleted.has(base.key)),
            };
            if (!merged.sym) merged.sym = base.sym || 'box';
            merged.group = sanitizeGroup(merged.group);
            BY_KEY.set(merged.key, merged);
            if (!merged.hidden) grouped[merged.group].push(merged);
        }
    }

    for (const c of catalogState.customItems || []) {
        if (!c?.key || deleted.has(c.key)) continue;
        const clean = sanitizePatch(c);
        const item = {
            mount: 'floor',
            back: true,
            sym: 'box',
            z: 0,
            w: 1000,
            d: 600,
            h: 800,
            ...clean,
            key: String(c.key).trim(),
            group: sanitizeGroup(c.group),
            isBuiltin: false,
            isCustom: true,
            isModified: true,
            hidden: !!c.hidden,
        };
        BY_KEY.set(item.key, item);
        if (!item.hidden) grouped[item.group].push(item);
    }

    for (const g of GROUPS) {
        const target = FURNITURE[g.key];
        target.splice(0, target.length, ...grouped[g.key]);
    }
}

rebuildCatalog();

function persistState(touchUpdatedAt = true) {
    if (touchUpdatedAt) {
        catalogState = { ...catalogState, updatedAt: Date.now() };
    }
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage?.setItem === 'function') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(catalogState));
        }
    } catch (err) {
        console.warn('catalog localStorage write:', err);
    }
    const st = getAssetStore();
    if (st) {
        st.setItem(STATE_ASSET_KEY, catalogState).catch(() => {});
    }
    rebuildCatalog();
    notifyListeners();
}

export function subscribeCatalog(listener) {
    LISTENERS.add(listener);
    return () => LISTENERS.delete(listener);
}

export function getCatalogVersion() {
    return catalogVersion;
}

export function groupName(groupKey) {
    return GROUPS.find(g => g.key === groupKey)?.name || 'Khác';
}

export async function initCatalogStore() {
    const st = getAssetStore();
    if (!st) return;
    try {
        const storedState = await st.getItem(STATE_ASSET_KEY);
        if (storedState && Number(storedState.updatedAt || 0) > Number(catalogState.updatedAt || 0)) {
            catalogState = {
                ...emptyState(),
                ...storedState,
                overrides: storedState.overrides || {},
                customItems: Array.isArray(storedState.customItems) ? storedState.customItems : [],
                deletedKeys: Array.isArray(storedState.deletedKeys) ? storedState.deletedKeys : [],
            };
            try {
                if (typeof localStorage !== 'undefined' && typeof localStorage?.setItem === 'function') {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(catalogState));
                }
            } catch { /* ignore */ }
            rebuildCatalog();
        }
        const keys = await st.keys();
        await Promise.all(
            keys.filter(k => String(k).startsWith(GLB_PREFIX)).map(async (k) => {
                const itemKey = String(k).slice(GLB_PREFIX.length);
                const val = await st.getItem(k);
                if (typeof val === 'string' && val) GLB_MEM_CACHE.set(itemKey, val);
            })
        );
        notifyListeners();
    } catch (err) {
        console.warn('initCatalogStore:', err);
    }
}

export function getItemGlbSource(key) {
    if (!key) return '';
    return GLB_MEM_CACHE.get(key) || BY_KEY.get(key)?.glbUrl || '';
}

export function getBuiltinItem(key) {
    return BUILTIN_BY_KEY.get(key) || null;
}

export function listAdminCatalogItems() {
    return [...BY_KEY.values()];
}

function slugKey(name) {
    const base = String(name || 'mau_moi')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'mau_moi';
    let candidate = `custom_${base}`;
    let idx = 2;
    while (BY_KEY.has(candidate) || BUILTIN_BY_KEY.has(candidate)) {
        candidate = `custom_${base}_${idx++}`;
    }
    return candidate;
}

/**
 * Lưu chỉnh sửa mẫu gốc hoặc thêm/sửa mẫu tự tạo.
 * opts: { glbDataUrl?: string, clearGlb?: boolean }
 */
export function saveCatalogItem(itemPatch, opts = {}) {
    const requestedKey = String(itemPatch?.key || '').trim();
    const builtin = requestedKey ? BUILTIN_BY_KEY.get(requestedKey) : null;
    let finalKey = requestedKey;
    const glbIncoming = opts.glbDataUrl !== undefined ? opts.glbDataUrl : opts.glbData;
    const isClearGlb = !!opts.clearGlb || glbIncoming === '';

    if (builtin) {
        const clean = sanitizePatch(itemPatch, builtin);
        if (isClearGlb) {
            clean.hasLocalGlb = false;
            clean.glbFileName = '';
            clean.modelFormat = '';
            clean.glbUrl = '';
        } else if (glbIncoming) {
            clean.hasLocalGlb = true;
        }
        const nextOv = { ...(catalogState.overrides?.[finalKey] || {}), ...clean };
        const deletedSet = new Set(catalogState.deletedKeys || []);
        if (clean.hidden === false) deletedSet.delete(finalKey);
        catalogState = {
            ...catalogState,
            overrides: { ...catalogState.overrides, [finalKey]: nextOv },
            deletedKeys: [...deletedSet],
        };
    } else {
        if (!finalKey) finalKey = slugKey(itemPatch?.name);
        const existingIdx = (catalogState.customItems || []).findIndex(x => x.key === finalKey);
        const existing = existingIdx >= 0 ? catalogState.customItems[existingIdx] : null;
        const clean = sanitizePatch(itemPatch, existing);
        if (isClearGlb) {
            clean.hasLocalGlb = false;
            clean.glbFileName = '';
            clean.modelFormat = '';
            clean.glbUrl = '';
        } else if (glbIncoming) {
            clean.hasLocalGlb = true;
        }
        const nextItem = {
            key: finalKey,
            name: 'Mẫu nội thất mới',
            group: 'other',
            w: 1000,
            d: 600,
            h: 800,
            z: 0,
            back: true,
            mount: 'floor',
            sym: 'cab',
            ...(existing || {}),
            ...clean,
        };
        const nextCustom = [...(catalogState.customItems || [])];
        if (existingIdx >= 0) nextCustom[existingIdx] = nextItem;
        else nextCustom.unshift(nextItem);
        catalogState = {
            ...catalogState,
            customItems: nextCustom,
            deletedKeys: (catalogState.deletedKeys || []).filter(k => k !== finalKey),
        };
    }

    const st = getAssetStore();
    if (isClearGlb) {
        GLB_MEM_CACHE.delete(finalKey);
        if (st) st.removeItem(`${GLB_PREFIX}${finalKey}`).catch(() => {});
    } else if (glbIncoming) {
        GLB_MEM_CACHE.set(finalKey, glbIncoming);
        if (st) st.setItem(`${GLB_PREFIX}${finalKey}`, glbIncoming).catch(() => {});
    }

    persistState(true);
    return catalogItem(finalKey);
}

export function resetCatalogItem(key) {
    if (!key) return null;
    const nextOv = { ...(catalogState.overrides || {}) };
    delete nextOv[key];
    catalogState = {
        ...catalogState,
        overrides: nextOv,
        deletedKeys: (catalogState.deletedKeys || []).filter(k => k !== key),
    };
    GLB_MEM_CACHE.delete(key);
    const st = getAssetStore();
    if (st) st.removeItem(`${GLB_PREFIX}${key}`).catch(() => {});
    persistState(true);
    return catalogItem(key);
}

export function deleteCatalogItem(key) {
    if (!key) return;
    if (BUILTIN_BY_KEY.has(key)) {
        const nextOv = {
            ...(catalogState.overrides || {}),
            [key]: { ...(catalogState.overrides?.[key] || {}), hidden: true },
        };
        catalogState = { ...catalogState, overrides: nextOv };
    } else {
        catalogState = {
            ...catalogState,
            customItems: (catalogState.customItems || []).filter(x => x.key !== key),
        };
        GLB_MEM_CACHE.delete(key);
        const st = getAssetStore();
        if (st) st.removeItem(`${GLB_PREFIX}${key}`).catch(() => {});
    }
    persistState(true);
}

export function resetAllCatalog() {
    catalogState = emptyState();
    const keys = [...GLB_MEM_CACHE.keys()];
    GLB_MEM_CACHE.clear();
    const st = getAssetStore();
    if (st) {
        for (const k of keys) st.removeItem(`${GLB_PREFIX}${k}`).catch(() => {});
    }
    persistState(true);
}

export function getCatalogSyncPayload() {
    return {
        version: 1,
        updatedAt: catalogState.updatedAt || Date.now(),
        overrides: catalogState.overrides || {},
        customItems: catalogState.customItems || [],
        deletedKeys: catalogState.deletedKeys || [],
    };
}

export function applyCatalogSyncPayload(payload, { force = false } = {}) {
    if (!payload || typeof payload !== 'object') return false;
    const remoteTs = Number(payload.updatedAt) || 0;
    const localTs = Number(catalogState.updatedAt) || 0;
    if (!force && remoteTs <= localTs) return false;
    catalogState = {
        version: 1,
        updatedAt: remoteTs || Date.now(),
        overrides: payload.overrides && typeof payload.overrides === 'object' ? payload.overrides : {},
        customItems: Array.isArray(payload.customItems) ? payload.customItems : [],
        deletedKeys: Array.isArray(payload.deletedKeys) ? payload.deletedKeys : [],
    };
    if (payload.glbAssets && typeof payload.glbAssets === 'object') {
        const st = getAssetStore();
        for (const [k, v] of Object.entries(payload.glbAssets)) {
            if (typeof v === 'string' && v) {
                GLB_MEM_CACHE.set(k, v);
                if (st) st.setItem(`${GLB_PREFIX}${k}`, v).catch(() => {});
            }
        }
    }
    persistState(false);
    return true;
}

export function exportCatalogSnapshot({ includeGlb = false } = {}) {
    const snap = {
        app: 'MKG_CATALOG',
        exportedAt: new Date().toISOString(),
        ...getCatalogSyncPayload(),
    };
    if (includeGlb && GLB_MEM_CACHE.size > 0) {
        snap.glbAssets = Object.fromEntries(GLB_MEM_CACHE.entries());
    }
    return JSON.stringify(snap, null, 2);
}

export function isSketchUpPackage(obj) {
    return !!(obj && typeof obj === 'object' && obj.app === 'MKG_SKETCHUP_EXPORT' && Array.isArray(obj.items));
}

/**
 * Nhập 1 hoặc nhiều món nội thất từ gói `.mkglib.json` xuất bởi Plugin SketchUp MKG.
 * Trả về { count, items }.
 */
export function importSketchUpPackage(jsonStringOrObj) {
    const obj = typeof jsonStringOrObj === 'string'
        ? JSON.parse(jsonStringOrObj)
        : jsonStringOrObj;
    if (!isSketchUpPackage(obj)) {
        throw new Error('Không phải gói .mkglib.json xuất từ Plugin SketchUp MKG');
    }
    if (!obj.items.length) {
        throw new Error('Gói SketchUp không chứa món nội thất nào');
    }
    const savedItems = [];
    for (const raw of obj.items) {
        if (!raw || typeof raw !== 'object') continue;
        const rawKey = typeof raw.key === 'string' ? raw.key.trim() : '';
        const glbData = raw.glbData || raw.modelDataUrl || '';
        const saved = saveCatalogItem({
            key: rawKey.startsWith('custom_') ? rawKey : '',
            name: String(raw.name || 'Mẫu SketchUp').trim() || 'Mẫu SketchUp',
            group: raw.group || 'other',
            w: Number(raw.w) || 1000,
            d: Number(raw.d) || 600,
            h: Number(raw.h) || 800,
            z: Number(raw.z) || 0,
            mount: raw.mount || 'floor',
            back: raw.back !== undefined ? !!raw.back : true,
            noSnapContact: !!raw.noSnapContact,
            sym: raw.sym || 'cab',
            svg2d: typeof raw.svg2d === 'string' ? raw.svg2d : '',
            glbFileName: raw.glbFileName || (rawKey ? `${rawKey}.dae` : 'sketchup_model.dae'),
            modelFormat: raw.modelFormat || (glbData ? 'dae' : ''),
            glbRotX: Number(raw.glbRotX) || 0,
            glbRotY: Number(raw.glbRotY) || 0,
            hasLocalGlb: !!glbData,
        }, glbData ? { glbData } : {});
        if (saved) savedItems.push(saved);
    }
    if (!savedItems.length) {
        throw new Error('Không đọc được dữ liệu món hợp lệ trong gói SketchUp');
    }
    return { count: savedItems.length, items: savedItems };
}

export function importCatalogSnapshot(jsonStringOrObj) {
    const obj = typeof jsonStringOrObj === 'string'
        ? JSON.parse(jsonStringOrObj)
        : jsonStringOrObj;
    if (!obj || typeof obj !== 'object') {
        throw new Error('File cấu hình thư viện không hợp lệ');
    }
    if (isSketchUpPackage(obj)) {
        const res = importSketchUpPackage(obj);
        return res.count;
    }
    if (!obj.overrides && !obj.customItems) {
        throw new Error('Thiếu dữ liệu overrides / customItems');
    }
    applyCatalogSyncPayload({ ...obj, updatedAt: Date.now() }, { force: true });
    return listAdminCatalogItems().length;
}

export function catalogItem(key) {
    return BY_KEY.get(key) || null;
}

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
