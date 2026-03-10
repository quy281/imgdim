import React from 'react';
import { X, Lock, Star, Rocket } from 'lucide-react';
import { TIERS, TIER_INFO } from '../tierConfig';
import { getRequiredTier } from '../TierContext';

export default function UpgradeModal({ feature, onClose, onShowPricing }) {
    const requiredTier = getRequiredTier(feature);
    const tierInfo = TIER_INFO[requiredTier] || TIER_INFO[TIERS.PRO];

    const featureNames = {
        cloudSync: 'Đồng bộ Cloud',
        batchExport: 'Xuất toàn bộ ảnh',
        customFrame: 'Khung tùy chỉnh',
        customWatermark: 'Watermark tùy chỉnh',
        share: 'Chia sẻ ảnh',
        magicDim: 'Magic Dim',
        aiSmartDim: 'AI Smart Dim',
        snapToEdge: 'Snap to Edge',
        angleMeasure: 'Đo góc',
        dimStyle: 'Tùy chỉnh Style Dim',
        exportPdf: 'Xuất PDF bản vẽ',
        beforeAfter: 'So sánh trước/sau',
        removeWatermark: 'Xóa watermark',
    };

    return (
        <div className="upgrade-overlay" onClick={onClose}>
            <div className="upgrade-modal" onClick={e => e.stopPropagation()}>
                <button className="upgrade-close" onClick={onClose}><X size={20} /></button>

                <div className="upgrade-icon" style={{ background: tierInfo.bg, color: tierInfo.color }}>
                    <Lock size={32} />
                </div>

                <h2 className="upgrade-title">Tính năng {tierInfo.name}</h2>
                <p className="upgrade-desc">
                    <strong>{featureNames[feature] || feature}</strong> yêu cầu gói <span style={{ color: tierInfo.color, fontWeight: 700 }}>{tierInfo.icon} {tierInfo.name}</span>
                </p>

                <div className="upgrade-tier-card" style={{ borderColor: tierInfo.color }}>
                    <div className="upgrade-tier-header" style={{ background: tierInfo.bg, color: tierInfo.color }}>
                        <span>{tierInfo.icon} {tierInfo.name}</span>
                        <span style={{ fontWeight: 700, fontSize: 18 }}>{tierInfo.price}</span>
                    </div>
                    <ul className="upgrade-features">
                        {tierInfo.highlights.map((h, i) => (
                            <li key={i}>{h}</li>
                        ))}
                    </ul>
                </div>

                <div className="upgrade-actions">
                    <button className="btn btn-primary upgrade-btn" style={{ background: tierInfo.color }}
                        onClick={() => { onClose(); onShowPricing?.(); }}>
                        {requiredTier === TIERS.ULTRA ? <Rocket size={18} /> : <Star size={18} />}
                        Nâng cấp lên {tierInfo.name}
                    </button>
                    <button className="btn upgrade-btn-secondary" onClick={onClose}>
                        Để sau
                    </button>
                </div>
            </div>
        </div>
    );
}
