import React, { useState, useEffect } from 'react';
import { Link2, Copy, Share2, Trash2, Clock, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import Sheet from './Sheet';
import { toast } from './Toast';
import * as db from '../lib/db';
import * as pb from '../lib/pb';

const EXPIRY = [
    { days: 7, label: '7 ngày' },
    { days: 30, label: '30 ngày' },
    { days: 0, label: 'Không hết hạn' },
];

const fmtDate = (s) => {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T'));
    return Number.isNaN(+d) ? '' : d.toLocaleDateString('vi-VN');
};

/**
 * Payload gửi lên server, KHÔNG nhúng vào URL — nhờ vậy link chỉ ~35 ký tự và không
 * phụ thuộc giới hạn độ dài URL của Zalo/Messenger.
 * Ảnh chỉ đưa thumb 360px: đủ cho khách xem hiện trạng, nhẹ hơn ảnh gốc ~15 lần.
 */
async function buildPayload(project) {
    const docs = await db.listDocs(project.id);
    const plans = docs.filter(d => d.type === 'plan');
    const photos = docs.filter(d => d.type === 'photo' && d.thumb);
    if (!plans.length && !photos.length) throw new Error('Dự án chưa có mặt bằng hoặc ảnh nào để chia sẻ');
    return {
        v: 3,
        projectName: project.name,
        sharedBy: pb.myName(),
        docs: plans.map(d => ({
            id: d.id, name: d.name, plan: d.plan,
            notes: d.notes || [], furniture: d.furniture || [],
        })),
        photos: photos.map(d => ({ id: d.id, name: d.name, thumb: d.thumb, lines: d.lines || [], w: d.w, h: d.h })),
    };
}

export default function ShareSheet({ project, onClose }) {
    const [links, setLinks] = useState(null);
    const [busy, setBusy] = useState(false);
    const [days, setDays] = useState(30);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!project) { setLinks(null); setError(null); return; }
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project?.id]);

    const load = async () => {
        setError(null);
        if (!pb.isLoggedIn()) { setLinks([]); return; }
        try {
            setLinks(await pb.listShares(project.id));
        } catch (err) {
            setError(err.message);
            setLinks([]);
        }
    };

    const create = async () => {
        setBusy(true);
        setError(null);
        try {
            const payload = await buildPayload(project);
            const res = await pb.createShare({ projectId: project.id, title: project.name, payload, days });
            setLinks(l => [{ ...res, title: project.name, revoked: false }, ...(l || [])]);
            await copy(res.url, true);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const copy = async (url, silentShare) => {
        try {
            if (silentShare && navigator.share) {
                await navigator.share({ title: project.name, text: `Mặt bằng: ${project.name}`, url });
                return;
            }
            await navigator.clipboard.writeText(url);
            toast('Đã copy link — dán vào Zalo/Messenger để gửi', 'ok');
        } catch (err) {
            if (err.name === 'AbortError') return;
            toast('Không copy được — bấm giữ để chọn link', 'err');
        }
    };

    const revoke = async (code) => {
        try {
            await pb.revokeShare(code);
            setLinks(l => l.map(x => x.code === code ? { ...x, revoked: true } : x));
            toast('Đã thu hồi link', 'ok');
        } catch (err) {
            toast('Không thu hồi được: ' + err.message, 'err');
        }
    };

    const live = (links || []).filter(l => !l.revoked);

    return (
        <Sheet open={!!project} onClose={onClose} title="Chia sẻ link xem"
            sub={project ? `${project.name} — người nhận chỉ xem, không sửa được` : ''}>

            {!pb.isLoggedIn() && (
                <div style={{ padding: '14px 16px', fontSize: 13.5, color: 'var(--muted)', display: 'flex', gap: 8 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--warn)' }} />
                    <div>Cần đăng nhập để tạo link ngắn. Link được lưu trên cloud nên thu hồi được bất cứ lúc nào.</div>
                </div>
            )}

            {error && (
                <div style={{ padding: '12px 16px', fontSize: 13.5, color: '#dc2626', display: 'flex', gap: 8 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
                </div>
            )}

            {pb.isLoggedIn() && (
                <>
                    <div style={{ padding: '10px 16px 4px', fontSize: 12.5, color: 'var(--muted)' }}>Thời hạn link</div>
                    <div className="chip-row" style={{ padding: '0 16px 12px' }}>
                        {EXPIRY.map(e => (
                            <button key={e.days} className={`chip ${days === e.days ? 'on' : ''}`}
                                onClick={() => setDays(e.days)}>{e.label}</button>
                        ))}
                    </div>
                    <div style={{ padding: '0 16px 14px' }}>
                        <button className="btn btn-primary btn-block" disabled={busy} onClick={create}>
                            {busy ? <RefreshCw size={17} className="spin" /> : <Link2 size={17} />}
                            {busy ? 'Đang tạo...' : 'Tạo link mới'}
                        </button>
                    </div>
                </>
            )}

            {links === null && pb.isLoggedIn() && (
                <div style={{ padding: '4px 16px 16px', fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <RefreshCw size={14} className="spin" /> Đang tải link đã tạo...
                </div>
            )}

            {live.length > 0 && (
                <div style={{ borderTop: '1px solid var(--line)' }}>
                    <div style={{ padding: '10px 16px 6px', fontSize: 12.5, color: 'var(--muted)' }}>
                        {live.length} link đang hoạt động
                    </div>
                    {live.map(l => (
                        <div key={l.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
                            <CheckCircle2 size={15} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {l.url.replace(/^https?:\/\//, '')}
                                </div>
                                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Clock size={11} />
                                    {l.expires ? `hết hạn ${fmtDate(l.expires)}` : 'không hết hạn'}
                                </div>
                            </div>
                            <button className="icon-btn" title="Copy" onClick={() => copy(l.url)}><Copy size={17} /></button>
                            {navigator.share && (
                                <button className="icon-btn" title="Gửi" onClick={() => copy(l.url, true)}><Share2 size={17} /></button>
                            )}
                            <button className="icon-btn" title="Thu hồi" style={{ color: '#dc2626' }} onClick={() => revoke(l.code)}>
                                <Trash2 size={17} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </Sheet>
    );
}
