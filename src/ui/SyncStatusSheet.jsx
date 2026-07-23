import React, { useState, useEffect } from 'react';
import { CheckCircle2, Clock, AlertCircle, Download, RefreshCw, CloudOff, User } from 'lucide-react';
import Sheet from './Sheet';
import * as db from '../lib/db';
import * as pb from '../lib/pb';

const STATUS_ICON = {
    synced:      <CheckCircle2 size={15} color="var(--ok)" />,
    pending:     <Clock size={15} color="var(--warn)" />,
    not_synced:  <AlertCircle size={15} color="#dc2626" />,
    to_pull:     <Download size={15} color="var(--blue)" />,
    error:       <AlertCircle size={15} color="#dc2626" />,
};
const STATUS_LABEL = {
    synced:     'Đã sync',
    pending:    'Đang chờ',
    not_synced: 'Chưa lên cloud',
    to_pull:    'Cần tải về',
    error:      'Lỗi push',
};

export default function SyncStatusSheet({ open, onClose, onSync }) {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);

    useEffect(() => {
        if (open) loadStatus();
    }, [open]);

    const loadStatus = async () => {
        setLoading(true);
        setStatus(null);
        try {
            const [localProjects, localDocs, pending, remoteStatus] = await Promise.all([
                db.loadProjects(),
                db.listAllDocs(),
                db.getPending(),
                pb.fetchRemoteStatus(),
            ]);

            const pendingSet = new Set(pending.map(p => p.item_id));
            const remoteMap = new Map(remoteStatus.items.map(r => [r.item_id, r]));

            // Per-project status
            const projectRows = localProjects.map(p => {
                const rid = String(p.id);
                const rp = remoteMap.get(rid);
                const pDocs = localDocs.filter(d => String(d.projectId) === rid);
                const rDocs = remoteStatus.items.filter(r => r.kind === 'doc' && r.project_id === rid);

                let s;
                if (!rp)                                            s = pendingSet.has(rid) ? 'pending' : 'not_synced';
                else if ((p.updatedAt || 0) > (rp.updatedAt || 0)) s = 'pending';
                else                                                 s = 'synced';

                return { id: rid, name: p.name, status: s, localDocs: pDocs.length, remoteDocs: rDocs.length };
            });

            // Remote-only projects (trên server nhưng chưa về máy)
            const localIds = new Set(localProjects.map(p => String(p.id)));
            const remoteOnlyRows = remoteStatus.items
                .filter(r => r.kind === 'project' && !localIds.has(r.item_id))
                .map(r => ({ id: r.item_id, name: r.name, status: 'to_pull', localDocs: 0, remoteDocs: 0 }));

            setStatus({
                account: remoteStatus.account,
                loggedIn: pb.isLoggedIn(),
                rows: [...projectRows, ...remoteOnlyRows],
                pendingCount: pending.length,
            });
        } catch (err) {
            setStatus({ error: err.message });
        } finally {
            setLoading(false);
        }
    };

    const notOk = status?.rows?.filter(r => r.status !== 'synced').length || 0;
    const titleSuffix = loading ? '' : status?.error ? ' ⚠' : notOk > 0 ? ` (${notOk} lệch)` : ' ✓';

    return (
        <Sheet open={open} onClose={onClose} title={`Kiểm tra đồng bộ${titleSuffix}`}>
            {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 16px', color: 'var(--muted)', fontSize: 14 }}>
                    <RefreshCw size={16} className="spin" /> Đang so sánh local ↔ cloud...
                </div>
            )}

            {!loading && status?.error && (
                <div style={{ padding: '16px', color: '#dc2626', fontSize: 14 }}>
                    <AlertCircle size={15} style={{ marginRight: 6 }} />
                    {status.error}
                </div>
            )}

            {!loading && status && !status.error && (
                <>
                    {/* Account info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px 8px', fontSize: 13, color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                        {status.loggedIn ? <User size={13} /> : <CloudOff size={13} />}
                        {status.loggedIn ? `Tài khoản: ${status.account}` : 'Chưa đăng nhập'}
                    </div>

                    {/* Project rows */}
                    {status.rows.length === 0 && (
                        <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
                            Chưa có dự án nào
                        </div>
                    )}
                    {status.rows.map(row => (
                        <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--line)' }}>
                            {STATUS_ICON[row.status]}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {row.name}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
                                    {STATUS_LABEL[row.status]}
                                    {row.status === 'synced' && row.localDocs > 0 && ` · ${row.localDocs} file`}
                                    {row.status !== 'to_pull' && row.localDocs !== row.remoteDocs &&
                                        ` · local ${row.localDocs} / cloud ${row.remoteDocs}`}
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Summary + sync button */}
                    <div style={{ padding: '14px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {status.pendingCount > 0 && (
                            <div style={{ fontSize: 13, color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Clock size={13} /> {status.pendingCount} mục đang chờ đẩy lên
                            </div>
                        )}
                        <button className="btn btn-primary btn-block" onClick={onSync}>
                            <RefreshCw size={15} /> Đồng bộ lại ngay
                        </button>
                        <button className="btn btn-block" onClick={loadStatus} style={{ background: 'none', border: '1.5px solid var(--line)', color: 'var(--ink-2)' }}>
                            Làm mới danh sách
                        </button>
                    </div>
                </>
            )}
        </Sheet>
    );
}
