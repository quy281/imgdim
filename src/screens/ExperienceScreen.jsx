import React, { useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, PlayCircle } from 'lucide-react';
import { EXPERIENCE_CATEGORIES, EXPERIENCE_LIBRARY } from '../lib/experienceLibrary';

export default function ExperienceScreen({ onBack }) {
    const [cat, setCat] = useState('Tất cả');
    const items = useMemo(() => EXPERIENCE_LIBRARY.filter(x => cat === 'Tất cả' || x.category === cat), [cat]);

    const openDetail = (url) => {
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="screen">
            <div className="hdr">
                <button className="icon-btn" onClick={onBack}><ArrowLeft size={22} /></button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hdr-title">Kinh nghiệm & bảng giá</div>
                    <div className="hdr-sub">Video nhúng, bài hướng dẫn, link xem chi tiết</div>
                </div>
            </div>
            <div className="scroll-body">
                <div className="chip-row exp-chip-row">
                    {EXPERIENCE_CATEGORIES.map(c => (
                        <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
                    ))}
                </div>
                <div className="experience-grid">
                    {items.map(item => (
                        <div key={item.id} className="experience-card">
                            <div className="experience-media">
                                {item.embedUrl ? (
                                    <iframe
                                        src={item.embedUrl}
                                        title={item.title}
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                        allowFullScreen
                                    />
                                ) : (
                                    <div className={`experience-placeholder tone-${item.thumbTone || 'blue'}`}>
                                        <PlayCircle size={38} />
                                        <span>{item.type === 'article' ? 'Bài viết / bảng giá' : 'Chờ gắn link nhúng'}</span>
                                    </div>
                                )}
                            </div>
                            <div className="experience-body">
                                <div className="experience-cat">{item.category}</div>
                                <div className="experience-title">{item.title}</div>
                                <div className="experience-desc">{item.desc}</div>
                                <button className="btn btn-block" onClick={() => openDetail(item.detailUrl)}>
                                    <ExternalLink size={16} /> Xem chi tiết
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
