// Subscription tier definitions
export const TIERS = {
    FREE: 'free',
    PRO: 'pro',
    ULTRA: 'ultra'
};

// Feature flags per tier
export const FEATURES = {
    // Free features
    createProject: [TIERS.FREE, TIERS.PRO, TIERS.ULTRA],
    uploadPhoto: [TIERS.FREE, TIERS.PRO, TIERS.ULTRA],
    drawDim: [TIERS.FREE, TIERS.PRO, TIERS.ULTRA],
    textNote: [TIERS.FREE, TIERS.PRO, TIERS.ULTRA],
    exportSingle: [TIERS.FREE, TIERS.PRO, TIERS.ULTRA],

    // Pro features
    cloudSync: [TIERS.PRO, TIERS.ULTRA],
    batchExport: [TIERS.PRO, TIERS.ULTRA],
    customFrame: [TIERS.PRO, TIERS.ULTRA],
    customWatermark: [TIERS.PRO, TIERS.ULTRA],
    share: [TIERS.PRO, TIERS.ULTRA],

    // Ultra features
    magicDim: [TIERS.ULTRA],
    aiSmartDim: [TIERS.ULTRA],
    snapToEdge: [TIERS.ULTRA],
    angleMeasure: [TIERS.ULTRA],
    dimStyle: [TIERS.ULTRA],
    exportPdf: [TIERS.ULTRA],
    beforeAfter: [TIERS.ULTRA],
    removeWatermark: [TIERS.ULTRA],
};

// Limits per tier
export const LIMITS = {
    [TIERS.FREE]: {
        maxProjects: 3,
        maxPhotosPerProject: 10,
    },
    [TIERS.PRO]: {
        maxProjects: Infinity,
        maxPhotosPerProject: Infinity,
    },
    [TIERS.ULTRA]: {
        maxProjects: Infinity,
        maxPhotosPerProject: Infinity,
    },
};

// Tier display info
export const TIER_INFO = {
    [TIERS.FREE]: {
        name: 'Free',
        color: '#64748b',
        bg: '#f1f5f9',
        icon: '🆓',
        price: 'Miễn phí',
        description: 'Bắt đầu đo kích thước cơ bản',
        highlights: [
            'Tối đa 3 dự án',
            'Tối đa 10 ảnh/dự án',
            'Vẽ dim thủ công',
            'Ghi chú text',
            'Xuất ảnh đơn lẻ',
        ],
    },
    [TIERS.PRO]: {
        name: 'Pro',
        color: '#2563eb',
        bg: '#eff6ff',
        icon: '⭐',
        price: '99.000đ/tháng',
        description: 'Dành cho chuyên gia & nhóm',
        highlights: [
            'Dự án & ảnh không giới hạn',
            'Đăng nhập & đồng bộ cloud',
            'Xuất toàn bộ ảnh',
            'Khung & watermark tùy chỉnh',
            'Chia sẻ ảnh',
        ],
    },
    [TIERS.ULTRA]: {
        name: 'Ultra',
        color: '#9333ea',
        bg: '#faf5ff',
        icon: '🚀',
        price: '199.000đ/tháng',
        description: 'Công nghệ AI & công cụ cao cấp',
        highlights: [
            'Tất cả tính năng Pro',
            '🪄 Magic Dim (auto 4 cạnh)',
            '🤖 AI Smart Dim (nhận diện cạnh)',
            '📐 Snap to Edge & Đo góc',
            '🎨 Tùy chỉnh style dim',
            '📋 Xuất PDF bản vẽ',
            '🔄 So sánh trước/sau',
        ],
    },
};

// Helper: check if a feature is available for a tier
export function canUseTier(tier, feature) {
    const allowed = FEATURES[feature];
    if (!allowed) return true; // unknown feature = allow
    return allowed.includes(tier);
}

// Helper: get limits for a tier
export function getTierLimits(tier) {
    return LIMITS[tier] || LIMITS[TIERS.FREE];
}

// Helper: get tier label for a locked feature
export function getRequiredTier(feature) {
    const allowed = FEATURES[feature];
    if (!allowed || allowed.length === 0) return TIERS.ULTRA;
    if (allowed.includes(TIERS.FREE)) return null; // free feature
    if (allowed.includes(TIERS.PRO)) return TIERS.PRO;
    return TIERS.ULTRA;
}
