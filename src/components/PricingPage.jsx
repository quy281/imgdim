import React from 'react';
import { ArrowLeft, Check, Star, Rocket, Zap } from 'lucide-react';
import { TIERS, TIER_INFO } from '../tierConfig';

export default function PricingPage({ currentTier, onBack, onSelectTier }) {
    const tiers = [TIERS.FREE, TIERS.PRO, TIERS.ULTRA];
    const icons = { free: Zap, pro: Star, ultra: Rocket };

    return (
        <div className="pricing-page">
            <div className="pricing-header">
                <button className="btn btn-icon" onClick={onBack} style={{ padding: 4 }}><ArrowLeft size={20} /></button>
                <div>
                    <h1 style={{ margin: 0, fontSize: 20 }}>Nâng cấp MKG-Dim</h1>
                    <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>Chọn gói phù hợp với nhu cầu</p>
                </div>
            </div>

            <div className="pricing-cards">
                {tiers.map(tier => {
                    const info = TIER_INFO[tier];
                    const Icon = icons[tier];
                    const isCurrent = tier === currentTier;
                    const isPopular = tier === TIERS.PRO;

                    return (
                        <div key={tier}
                            className={`pricing-card ${isCurrent ? 'current' : ''} ${isPopular ? 'popular' : ''}`}
                            style={{ '--tier-color': info.color, '--tier-bg': info.bg }}
                        >
                            {isPopular && <div className="pricing-badge">Phổ biến nhất</div>}

                            <div className="pricing-card-icon" style={{ background: info.bg, color: info.color }}>
                                <Icon size={28} />
                            </div>

                            <h3 className="pricing-card-name" style={{ color: info.color }}>
                                {info.icon} {info.name}
                            </h3>
                            <div className="pricing-card-price">{info.price}</div>
                            <p className="pricing-card-desc">{info.description}</p>

                            <ul className="pricing-card-features">
                                {info.highlights.map((h, i) => (
                                    <li key={i}><Check size={14} color={info.color} /> {h}</li>
                                ))}
                            </ul>

                            <button
                                className={`btn pricing-card-btn ${isCurrent ? '' : 'btn-primary'}`}
                                style={isCurrent ? { background: '#f1f5f9', color: '#94a3b8', cursor: 'default' } : { background: info.color }}
                                onClick={() => !isCurrent && onSelectTier?.(tier)}
                                disabled={isCurrent}
                            >
                                {isCurrent ? 'Gói hiện tại' : `Chọn ${info.name}`}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
