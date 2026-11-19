// Danh mục vật liệu sàn & chế độ trình bày kiến trúc 2D (Presentation Theme).

export const FLOOR_MATERIALS = [
    {
        key: 'wood_oak',
        name: 'Gỗ sồi sáng',
        kind: 'wood',
        base: '#e4dac7',
        alt: '#ddd1ba',
        line: '#cbbda2',
        grain: 'rgba(139, 108, 70, 0.14)',
        tileMm: 900,
    },
    {
        key: 'wood_warm',
        name: 'Gỗ sồi ấm',
        kind: 'wood',
        base: '#dcc29b',
        alt: '#d3b68c',
        line: '#bd9d70',
        grain: 'rgba(110, 74, 38, 0.16)',
        tileMm: 900,
    },
    {
        key: 'wood_walnut',
        name: 'Gỗ óc chó',
        kind: 'wood',
        base: '#a68262',
        alt: '#9a7554',
        line: '#7d5c3f',
        grain: 'rgba(62, 39, 22, 0.2)',
        tileMm: 900,
    },
    {
        key: 'terrazzo',
        name: 'Đá Terrazzo sáng',
        kind: 'terrazzo',
        base: '#f1f0ec',
        alt: '#e5e3dc',
        line: '#dad7cf',
        grain: 'rgba(100, 116, 139, 0.25)',
        tileMm: 600,
    },
    {
        key: 'tile_light',
        name: 'Gạch Ceramic 600',
        kind: 'tile',
        base: '#edf0f3',
        alt: '#e4e8ed',
        line: '#cbd2da',
        grain: 'rgba(148, 163, 184, 0.25)',
        tileMm: 600,
    },
    {
        key: 'rug_stone',
        name: 'Bê tông / Thảm xám',
        kind: 'stone',
        base: '#d8d5ce',
        alt: '#cecac2',
        line: '#bdb8ae',
        grain: 'rgba(71, 85, 105, 0.16)',
        tileMm: 600,
    },
    {
        key: 'grass_balcony',
        name: 'Cỏ ban công / Cây',
        kind: 'grass',
        base: '#759348',
        alt: '#69863e',
        line: '#556f30',
        grain: 'rgba(236, 253, 245, 0.2)',
        tileMm: 500,
    },
    {
        key: 'white',
        name: 'Trắng phẳng',
        kind: 'solid',
        base: '#ffffff',
        alt: '#f8fafc',
        line: '#e2e8f0',
        grain: 'rgba(148, 163, 184, 0.08)',
        tileMm: 600,
    },
];

const BY_KEY = new Map(FLOOR_MATERIALS.map(m => [m.key, m]));

export function getFloorMaterial(key) {
    return BY_KEY.get(key) || BY_KEY.get('wood_oak');
}

export function inferRoomFloorMat(room) {
    const name = String(room?.name || '').toLowerCase();
    if (/wc|toilet|vệ sinh|ve sinh|tắm|tam|bath|giặt|giat/.test(name)) return 'tile_light';
    if (/bếp|bep|kitchen|sảnh|sanh|hành lang|hanh lang|thang|kho|hall|foyer|lobby/.test(name)) return 'terrazzo';
    if (/cỏ|co|vườn|vuon|tiểu cảnh|tieu canh|bồn cây|bon cay|ban công|ban cong|balcony|logia|sân|san/.test(name)) return 'grass_balcony';
    return 'wood_oak';
}

export function resolveRoomFloorMat(room) {
    if (room?.floorMat && BY_KEY.has(room.floorMat)) return room.floorMat;
    return inferRoomFloorMat(room);
}
