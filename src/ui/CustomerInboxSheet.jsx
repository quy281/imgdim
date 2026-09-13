import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, Download, Inbox, RefreshCw, UserRoundCheck } from 'lucide-react';
import Sheet from './Sheet';
import { toast } from './Toast';
import * as pb from '../lib/pb';

const fmt = (ts) => ts ? new Date(ts).toLocaleString('vi-VN') : '';

export default function CustomerInboxSheet({ open, onClose, onImport }) {
    const [items, setItems] = useState(null);
    const [selected, setSelected] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = async () => {
        setItems(null);
        try { setItems(await pb.listCustomerSubmissions()); }
        catch (err) { setItems([]); toast('Không tải được dữ liệu khách gửi: ' + err.message, 'err'); }
    };

    useEffect(() => {
        if (open) { setSelected(null); load(); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const importOne = async () => {
        if (!selected || busy) return;
        setBusy(true);
        try {
            await onImport(selected);
            setSelected(null);
            await load();
        } catch (err) {
            toast('Không nhập được dữ liệu: ' + err.message, 'err');
        } finally { setBusy(false); }
    };

    const pending = (items || []).filter(x => x.status === 'submitted');
    const done = (items || []).filter(x => x.status !== 'submitted');
    const shown = [...pending, ...done];
    const docs = selected?.payload?.docs || [];

    return (
        <Sheet open={open} onClose={onClose} title={selected ? selected.title : `Dữ liệu khách gửi${pending.length ? ` (${pending.length})` : ''}`}>
            {selected ? (
                <>
                    <button className="sheet-row" onClick={() => setSelected(null)}>
                        <ArrowLeft size={18} /><div style={{ flex: 1 }}>Quay lại hộp thư</div>
                    </button>
                    <div style={{ padding: 16 }}>
                        <div style={{ fontWeight: 700, marginBottom: 5 }}>{selected.title}</div>
                        <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
                            Khách: {selected.customerName || selected.owner}<br />
                            Gửi lúc: {fmt(selected.submittedAt)}<br />
                            {docs.filter(d => d.type === 'plan').length} mặt bằng · {docs.filter(d => d.type === 'photo').length} ảnh
                        </div>
                        {selected.status === 'submitted' ? (
                            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy} onClick={importOne}>
                                {busy ? <RefreshCw size={17} className="spin" /> : <Download size={17} />}
                                {busy ? 'Đang nhập...' : 'Kiểm tra xong — nhập vào dự án'}
                            </button>
                        ) : (
                            <div style={{ marginTop: 16, color: 'var(--ok)', fontSize: 13 }}>
                                <CheckCircle2 size={16} /> Submission này đã được xử lý.
                            </div>
                        )}
                    </div>
                </>
            ) : items === null ? (
                <div style={{ padding: 18, color: 'var(--muted)' }}><RefreshCw size={16} className="spin" /> Đang tải...</div>
            ) : shown.length === 0 ? (
                <div className="empty" style={{ padding: 30 }}>
                    <Inbox size={46} /><h3>Chưa có dữ liệu khách gửi</h3>
                </div>
            ) : shown.map(item => (
                <button key={item.id} className="sheet-row" onClick={() => setSelected(item)}>
                    {item.status === 'submitted'
                        ? <Clock size={18} style={{ color: 'var(--warn)' }} />
                        : <CheckCircle2 size={18} style={{ color: 'var(--ok)' }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div>{item.title}</div>
                        <div className="sub"><UserRoundCheck size={12} /> {item.customerName || 'Khách hàng'} · {fmt(item.submittedAt)}</div>
                    </div>
                    <span style={{ fontSize: 11.5, color: item.status === 'submitted' ? 'var(--warn)' : 'var(--muted)' }}>
                        {item.status === 'submitted' ? 'CHỜ DUYỆT' : 'ĐÃ NHẬP'}
                    </span>
                </button>
            ))}
        </Sheet>
    );
}
