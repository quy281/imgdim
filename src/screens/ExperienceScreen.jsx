import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Clock, ExternalLink, Plus, PlayCircle, Send, X } from 'lucide-react';
import {
    addExperiencePost,
    EXPERIENCE_CATEGORIES,
    EXPERIENCE_LIBRARY,
    loadExperienceItems,
    updateExperienceStatus,
} from '../lib/experienceLibrary';
import * as pb from '../lib/pb';

export default function ExperienceScreen({ onBack }) {
    const [cat, setCat] = useState('Tất cả');
    const [items, setItems] = useState(() => EXPERIENCE_LIBRARY.map(x => ({ ...x, status: 'public', source: 'library' })));
    const [showAdd, setShowAdd] = useState(false);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [form, setForm] = useState({
        category: EXPERIENCE_CATEGORIES[1],
        title: '',
        detailUrl: '',
        desc: '',
    });
    const canReview = pb.isAdmin();

    const refresh = async () => {
        const next = await loadExperienceItems();
        setItems(next);
    };

    useEffect(() => {
        let alive = true;
        loadExperienceItems().then(next => { if (alive) setItems(next); });
        return () => { alive = false; };
    }, []);

    const filtered = useMemo(() => items.filter(x => cat === 'Tất cả' || x.category === cat), [items, cat]);

    const openDetail = (url) => {
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const submitVideo = async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg('');
        try {
            await addExperiencePost(form);
            setForm({ category: form.category, title: '', detailUrl: '', desc: '' });
            setShowAdd(false);
            setMsg('Đã thêm video. Bạn sẽ thấy ngay, admin duyệt thì mọi người cùng thấy.');
            await refresh();
        } catch (err) {
            setMsg(err.message || 'Không thêm được video');
        } finally {
            setBusy(false);
        }
    };

    const review = async (item, status) => {
        setBusy(true);
        setMsg('');
        try {
            await updateExperienceStatus(item, status);
            setMsg(status === 'public' ? 'Đã public video.' : 'Đã từ chối video.');
            await refresh();
        } catch (err) {
            setMsg(err.message || 'Không cập nhật được trạng thái');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="screen">
            <div className="hdr">
                <button className="icon-btn" onClick={onBack}><ArrowLeft size={22} /></button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hdr-title">Kinh nghiệm & bảng giá</div>
                    <div className="hdr-sub">User thêm video, admin duyệt để public</div>
                </div>
            </div>
            <div className="scroll-body">
                <section className="experience-submit">
                    <div className="experience-submit-head">
                        <div>
                            <div className="section-eyebrow">Thư viện chung</div>
                            <div className="section-heading">Thêm video kinh nghiệm</div>
                        </div>
                        <button className="section-action" onClick={() => setShowAdd(v => !v)}>
                            {showAdd ? <X size={15} /> : <Plus size={15} />}
                            {showAdd ? 'Đóng' : 'Thêm'}
                        </button>
                    </div>
                    {showAdd && (
                        <form className="experience-submit-form" onSubmit={submitVideo}>
                            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                                {EXPERIENCE_CATEGORIES.filter(c => c !== 'Tất cả').map(c => <option key={c}>{c}</option>)}
                            </select>
                            <input
                                value={form.title}
                                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                                placeholder="Tiêu đề ngắn"
                            />
                            <input
                                value={form.detailUrl}
                                onChange={e => setForm(f => ({ ...f, detailUrl: e.target.value }))}
                                placeholder="Link YouTube, TikTok, Facebook..."
                            />
                            <textarea
                                value={form.desc}
                                onChange={e => setForm(f => ({ ...f, desc: e.target.value }))}
                                placeholder="Ghi chú ngắn cho team"
                                rows={2}
                            />
                            <button className="btn btn-primary btn-block" disabled={busy}>
                                <Send size={16} /> Gửi chờ duyệt
                            </button>
                        </form>
                    )}
                    {msg && <div className="experience-submit-msg">{msg}</div>}
                </section>
                <div className="chip-row exp-chip-row">
                    {EXPERIENCE_CATEGORIES.map(c => (
                        <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
                    ))}
                </div>
                <div className="experience-grid">
                    {filtered.map(item => (
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
                                <div className="experience-card-top">
                                    <div className="experience-cat">{item.category}</div>
                                    {item.status === 'pending' && (
                                        <span className="status-pill pending"><Clock size={12} /> Chờ duyệt</span>
                                    )}
                                    {item.status === 'rejected' && <span className="status-pill rejected">Từ chối</span>}
                                </div>
                                <div className="experience-title">{item.title}</div>
                                <div className="experience-desc">{item.desc}</div>
                                {item.ownerName && item.source !== 'library' && (
                                    <div className="experience-owner">Người gửi: {item.ownerName}</div>
                                )}
                                <button className="btn btn-block" onClick={() => openDetail(item.detailUrl)}>
                                    <ExternalLink size={16} /> Xem chi tiết
                                </button>
                                {canReview && item.source !== 'library' && item.status === 'pending' && (
                                    <div className="experience-review-actions">
                                        <button className="btn btn-primary" disabled={busy} onClick={() => review(item, 'public')}>
                                            <Check size={15} /> Duyệt
                                        </button>
                                        <button className="btn btn-danger" disabled={busy} onClick={() => review(item, 'rejected')}>
                                            <X size={15} /> Từ chối
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
