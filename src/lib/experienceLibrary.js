export const EXPERIENCE_LIBRARY = [
    {
        id: 'board-zigzag',
        category: 'Quản lý ván tồn',
        type: 'youtube',
        title: 'Đo ván khuyết trước khi xuất DXF',
        desc: 'Quy trình đo biên ván, đặt mã, lưu kho và kiểm tra kích thước trước khi đưa vào plan cắt.',
        embedUrl: '',
        detailUrl: 'https://mkg.vn',
        thumbTone: 'blue',
        updatedAt: 20260928,
    },
    {
        id: 'cut-price',
        category: 'Cắt ván',
        type: 'article',
        title: 'Bảng giá cắt ván và dán chỉ',
        desc: 'Xem đơn giá cắt ván, dán chỉ, khoan cam/chốt và các lưu ý khi gửi file gia công.',
        embedUrl: '',
        detailUrl: 'https://mkg.vn',
        thumbTone: 'red',
        updatedAt: 20260927,
    },
    {
        id: 'cnc-file',
        category: 'CNC / khoan',
        type: 'tiktok',
        title: 'Chuẩn bị file DXF để gia công',
        desc: 'Checklist layer, đơn vị mm, mã chi tiết và cách ghi chú để xưởng đọc file nhanh hơn.',
        embedUrl: '',
        detailUrl: 'https://mkg.vn',
        thumbTone: 'violet',
        updatedAt: 20260926,
    },
    {
        id: 'stock-code',
        category: 'Quản lý ván tồn',
        type: 'article',
        title: 'Cách đặt mã ván tồn dễ tìm trong kho',
        desc: 'Gợi ý mã theo vật liệu, dày, màu, vị trí A1/A2 để giảm nhầm lẫn khi xuất kho.',
        embedUrl: '',
        detailUrl: 'https://mkg.vn',
        thumbTone: 'green',
        updatedAt: 20260924,
    },
];

export const EXPERIENCE_CATEGORIES = [
    'Tất cả', 'Đo hiện trạng', 'Quản lý ván tồn', 'Tối ưu cắt ván',
    'Cắt ván', 'Dán chỉ', 'CNC / khoan', 'Vẽ 3D', 'Phụ kiện',
];

export function latestExperience(limit = 3) {
    return [...EXPERIENCE_LIBRARY]
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
        .slice(0, limit);
}
