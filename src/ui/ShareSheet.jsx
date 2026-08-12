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

/**
 * Link dự phòng khi collection `shares` chưa có trên backend (chưa chạy pb-setup.mjs),
 * hoặc khi chưa đăng nhập. Nhúng dữ liệu thẳng vào URL như bản v2, NHƯNG:
 *   - mã hoá base64url ('+' → '-', '/' → '_'): '+' trong query bị đọc thành khoảng
 *     trắng, đúng lỗi làm mọi link v2 vỡ.
 *   - bỏ ảnh: thumb 360px mỗi cái ~20-40KB, nhúng vào URL là chắc chắn bị cắt.
 */
function inlineShareUrl(payload) {
    const slim = { ...payload, photos: [] };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(slim))))
        .replace(/\+/g, '-').replace(/\//g, '_');
    return `${window.location.origin}/?view=${b64}`;
}

export default function ShareSheet({ project, onClose }) {
    const [links, setLinks] = useState(null);
    const [busy, setBusy] = useState(false);
    const [days, setDays] = useState(30);
    const [error, setError] = useState(null);
    const [fallback, setFallback] = useState(null); // link dài khi chưa có collection shares

    useEffect(() => {
        if (!project) { setLinks(null); setError(null); setFallback(null); return; }
        setFallback(null);
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project?.id]);

    const load = async () => {
        setError(null);
        if (!pb.isLoggedIn()) { setLinks([]); return; }
        try {
            setLinks(await pb.listShares(project.id));
        } catch (err) {
            // 404 = collection `shares` chưa dựng. Không phải lỗi để dí vào mặt người dùng,
            // chỉ nghĩa là chưa có link ngắn nào; nút tạo link vẫn dùng được qua fallback.
            if (err.status !== 404) setError(err.message);
            setLinks([]);
        }
    };

    const create = async () => {
        setBusy(true);
        setError(null);
        try {
            const payload = await buildPayload(project);
            let res = null;
            if (pb.isLoggedIn()) {
                try {
                    res = await pb.createShare({ projectId: project.id, title: project.name, payload, days });
                } catch (err) {
                    // Chỉ rơi về link dài khi backend CHƯA có collection shares. Lỗi khác
                    // (mạng, hết phiên) phải báo, không được im lặng đưa link kém hơn.
                    if (err.status !== 404) throw err;
                }
            }
            if (res) {
                setLinks(l => [{ ...res, title: project.name, revoked: false }, ...(l || [])]);
                await copy(res.url, true);
            } else {
                const url = inlineShareUrl(payload);
                setFallback({ url, hasPhotos: (payload.photos || []).length > 0, long: url.length > 4000 });
                await copy(url, true);
            }
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
                <div style={{ padding: '14px 16px 4px', fontSize: 13.5, color: 'var(--muted)', display: 'flex', gap: 8 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--warn)' }} />
                    <div>Chưa đăng nhập nên link sẽ là bản dài, không thu hồi được. Đăng nhập để có link ngắn.</div>
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
                </>
            )}

            <div style={{ padding: pb.isLoggedIn() ? '0 16px 14px' : '10px 16px 14px' }}>
                <button className="btn btn-primary btn-block" disabled={busy} onClick={create}>
                    {busy ? <RefreshCw size={17} className="spin" /> : <Link2 size={17} />}
                    {busy ? 'Đang tạo...' : 'Tạo link mới'}
                </button>
            </div>

            {fallback && (
                <div style={{ padding: '0 16px 14px' }}>
                    <div style={{ fontSize: 12.5, fontFamily: 'ui-monospace, monospace', color: 'var(--ink-2)', wordBreak: 'break-all', background: 'var(--bg)', padding: '8px 10px', borderRadius: 8, maxHeight: 76, overflow: 'auto' }}>
                        {fallback.url}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn" style={{ flex: 1, border: '1.5px solid var(--line)', background: 'none' }}
                            onClick={() => copy(fallback.url)}>
                            <Copy size={16} /> Copy link
                        </button>
                        {navigator.share && (
                            <button className="btn" style={{ flex: 1, border: '1.5px solid var(--line)', background: 'none' }}
                                onClick={() => copy(fallback.url, true)}>
                                <Share2 size={16} /> Gửi
                            </button>
                        )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 8, display: 'flex', gap: 6 }}>
                        <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                        <div>
                            Link dạng dài ({(fallback.url.length / 1024).toFixed(1)}KB) — chưa dựng link ngắn trên cloud
                            nên <b>không thu hồi được</b>{fallback.hasPhotos && ' và không kèm ảnh khảo sát'}.
                            {fallback.long && ' Link khá dài, một số ứng dụng chat có thể cắt bớt.'}
                        </div>
                    </div>
                </div>
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
