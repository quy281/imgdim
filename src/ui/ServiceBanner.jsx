import React, { useEffect, useState } from 'react';
import { Edit3, ExternalLink, Save, X } from 'lucide-react';
import Sheet from './Sheet';

const STORAGE_KEY = 'mkg_service_banner_v1';

const DEFAULT_SERVICES = [
    {
        id: 'cutting',
        title: 'Cắt ván',
        text: 'Bảng giá cắt theo m dài / chi tiết',
        url: 'https://mkg.vn',
    },
    {
        id: 'edgebanding',
        title: 'Dán chỉ',
        text: 'Đơn giá chỉ PVC, acrylic, cạnh cong',
        url: 'https://mkg.vn',
    },
    {
        id: 'cnc',
        title: 'CNC / khoan',
        text: 'Gia công file DXF, khoan cam/chốt',
        url: 'https://mkg.vn',
    },
    {
        id: 'render3d',
        title: 'Vẽ 3D',
        text: 'Dựng phối cảnh, layout, hồ sơ thi công',
        url: 'https://mkg.vn',
    },
];

export default function ServiceBanner({ compact = false }) {
    const [services, setServices] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            return Array.isArray(saved) && saved.length ? saved : DEFAULT_SERVICES;
        } catch {
            return DEFAULT_SERVICES;
        }
    });
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(services);

    useEffect(() => {
        setDraft(services);
    }, [services]);

    const open = (url) => window.open(url, '_blank', 'noopener,noreferrer');
    const updateDraft = (id, patch) => {
        setDraft(list => list.map(s => s.id === id ? { ...s, ...patch } : s));
    };
    const saveDraft = () => {
        const clean = draft.map(s => ({
            ...s,
            title: String(s.title || '').trim() || 'Dịch vụ',
            text: String(s.text || '').trim(),
            url: String(s.url || '').trim() || 'https://mkg.vn',
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
        setServices(clean);
        setEditing(false);
    };

    return (
        <>
            <section className={`service-banner ${compact ? 'compact' : ''}`} aria-label="Dịch vụ hỗ trợ">
                <div className="service-banner-head">
                    <div>
                        <div className="section-eyebrow">Dịch vụ MKG</div>
                        <div className="section-heading">Bảng giá & hỗ trợ gia công</div>
                    </div>
                    <button className="section-action" onClick={() => setEditing(true)}>
                        <Edit3 size={15} /> Sửa
                    </button>
                </div>
                <div className="service-strip">
                    {services.map(s => (
                        <button key={s.id} className="service-card" onClick={() => open(s.url)}>
                            <div className="service-title">{s.title}</div>
                            <div className="service-text">{s.text}</div>
                            <div className="service-cta">
                                Xem chi tiết <ExternalLink size={13} />
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            <Sheet open={editing} onClose={() => setEditing(false)} title="Sửa banner dịch vụ"
                sub="Nội dung lưu trên máy này để xem thử giao diện.">
                {draft.map((s, i) => (
                    <div key={s.id} className="service-edit-block">
                        <div className="service-edit-title">Dịch vụ {i + 1}</div>
                        <div className="field">
                            <label>Tiêu đề</label>
                            <input value={s.title} onChange={e => updateDraft(s.id, { title: e.target.value })} />
                        </div>
                        <div className="field">
                            <label>Mô tả ngắn</label>
                            <input value={s.text} onChange={e => updateDraft(s.id, { text: e.target.value })} />
                        </div>
                        <div className="field">
                            <label>Link xem chi tiết</label>
                            <input value={s.url} onChange={e => updateDraft(s.id, { url: e.target.value })} />
                        </div>
                    </div>
                ))}
                <div className="service-edit-actions">
                    <button className="btn" onClick={() => { setDraft(services); setEditing(false); }}>
                        <X size={16} /> Hủy
                    </button>
                    <button className="btn btn-primary" onClick={saveDraft}>
                        <Save size={16} /> Lưu
                    </button>
                </div>
            </Sheet>
        </>
    );
}
