import React, { useState, useEffect } from 'react';
import {
    CheckCircle2, Clock, AlertCircle, Download, RefreshCw, CloudOff, User, Users, Lock,
} from 'lucide-react';
import Sheet from './Sheet';
import * as db from '../lib/db';
import * as pb from '../lib/pb';

const STATUS_ICON = {
    synced: <CheckCircle2 size={15} color="var(--ok)" />,
    pending: <Clock size={15} color="var(--warn)" />,
    not_synced: <AlertCircle size={15} color="#dc2626" />,
    to_pull: <Download size={15} color="var(--blue)" />,
};
const STATUS_LABEL = {
    synced: 'Đã sync',
    pending: 'Đang chờ đẩy lên',
    not_synced: 'Chưa lên cloud',
    to_pull: 'Cần tải về',
};

export default function SyncStatusSheet({ open, onClose, onSync, onRepairTeam }) {
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);

    useEffect(() => {
        if (open) loadStatus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const loadStatus = async () => {
        setLoading(true);
        setStatus(null);
        try {
            const [localProjects, localDocs, pending, meta, remote] = await Promise.all([
                db.loadProjects(),
                db.listAllDocs(),
                db.getPending(),
                db.getMeta(),
                pb.fetchRemoteStatus(),
            ]);

            const pendingSet = new Set(pending.map(p => p.item_id));
            // Khớp theo (owner, item_id): hai tài khoản có thể trùng item_id mà là hai dự án khác nhau.
            // ownerId() chứ không myId(): với superuser, danh tính ghi lên cloud là record `users`
            // liên kết (xem pb.js), khác với id đăng nhập thô trong _superusers.
            const uid = pb.ownerId();
            const key = (owner, id) => `${owner || ''}/${id}`;
            const remoteMap = new Map(remote.items.filter(r => !r.deleted).map(r => [key(r.owner, r.item_id), r]));
            const remoteByItem = new Map();
            for (const r of remote.items) if (!r.deleted) remoteByItem.set(r.item_id, r);

            const findRemote = (p) => remoteMap.get(key(p.ownerId || uid, String(p.id))) || remoteByItem.get(String(p.id));

            const projectRows = localProjects.map(p => {
                const rid = String(p.id);
                const rp = findRemote(p);
                const pDocs = localDocs.filter(d => String(d.projectId) === rid);
                const rDocs = remote.items.filter(r => r.kind === 'doc' && r.project_id === rid && !r.deleted);
                const docsPending = pDocs.filter(d => {
                    const rd = remoteByItem.get(String(d.id));
                    return !rd || (d.updatedAt || 0) > (rd.updatedAt || 0);
                }).length;

                let s;
                if (!rp) s = pendingSet.has(rid) ? 'pending' : 'not_synced';
                else if ((p.updatedAt || 0) > (rp.updatedAt || 0) || docsPending > 0) s = 'pending';
                else s = 'synced';

                return {
                    id: rid, name: p.name, status: s, scope: p.scope || pb.SCOPE_DEFAULT,
                    mine: !p.ownerId || !uid || p.ownerId === uid, ownerName: p.ownerName,
                    localDocs: pDocs.length, remoteDocs: rDocs.length, docsPending,
                };
            });

            const localIds = new Set(localProjects.map(p => String(p.id)));
            const remoteOnly = remote.items
                .filter(r => r.kind === 'project' && !r.deleted && !localIds.has(r.item_id))
                .map(r => ({
                    id: r.item_id, name: r.name, status: 'to_pull', scope: r.scope,
                    mine: r.owner === uid, ownerName: r.ownerName,
                    localDocs: 0, remoteDocs: remote.items.filter(x => x.kind === 'doc' && x.project_id === r.item_id).length,
                    docsPending: 0,
                }));

            setStatus({
                account: remote.account,
                team: remote.team,
                legacy: remote.legacy,
                loggedIn: pb.isLoggedIn(),
                totalRemote: remote.totalRemote,
                myTeamId: remote.myTeamId,
                // Bản ghi mang phạm vi team nhưng THIẾU id team thì đồng nghiệp không đọc
                // được, dù trên máy chủ sở hữu nó vẫn hiện "Team MKG". Đây là chỗ duy nhất
                // nhìn ra được điều đó, nên phải đếm riêng.
                brokenShare: remote.items.filter(r =>
                    !r.deleted && (r.rawScope !== 'team' || !r.team)).length,
                wrongTeam: remote.items.filter(r =>
                    !r.deleted && r.rawScope === 'team' && r.team && remote.myTeamId
                    && r.team !== remote.myTeamId).length,
                rows: [...projectRows, ...remoteOnly],
                pendingCount: pending.length,
                lastSyncAt: meta.lastSyncAt,
                skew: pb.clockSkew(),
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
                    <div style={{ padding: '10px 16px 8px', fontSize: 13, color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {status.loggedIn ? <User size={13} /> : <CloudOff size={13} />}
                            {status.loggedIn ? `Tài khoản: ${status.account}` : 'Chưa đăng nhập'}
                        </div>
                        {status.loggedIn && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                <Users size={13} />
                                {status.team ? `Team ${status.team.name}` : 'Chưa thuộc team'}
                                <span style={{ opacity: .6 }}>· cloud: {status.totalRemote} bản ghi</span>
                            </div>
                        )}
                        {status.loggedIn && status.brokenShare > 0 && (
                            <div style={{
                                marginTop: 8, padding: 9, borderRadius: 9, background: 'var(--warn-soft)',
                                color: 'var(--ink)', fontSize: 12, lineHeight: 1.5,
                            }}>
                                <b>{status.brokenShare} bản ghi chưa gắn team.</b> Chúng đã lên cloud nhưng
                                đồng nghiệp KHÔNG đọc được — trên máy này vẫn hiện “Team MKG” nên nhìn
                                không ra. Bấm “Gắn team &amp; đẩy lại” bên dưới để sửa.
                            </div>
                        )}
                        {status.loggedIn && status.wrongTeam > 0 && (
                            <div style={{
                                marginTop: 8, padding: 9, borderRadius: 9, background: 'var(--warn-soft)',
                                fontSize: 12, lineHeight: 1.5,
                            }}>
                                <b>{status.wrongTeam} bản ghi đang gắn team KHÁC</b> với team của tài khoản
                                này — người trong team đó mới đọc được.
                            </div>
                        )}
                        {Math.abs(status.skew || 0) > 60_000 && (
                            <div style={{ color: 'var(--warn)', marginTop: 4 }}>
                                Đồng hồ máy lệch {Math.round(status.skew / 60000)} phút so với server — đã tự bù khi sync.
                            </div>
                        )}
                        {status.legacy && (
                            <div style={{ color: 'var(--warn)', marginTop: 4 }}>
                                Đang chạy chế độ tương thích: dữ liệu vẫn an toàn và đồng bộ đúng, nhưng
                                mỗi lượt sync phải tải cả ảnh nên chậm, và chưa dùng được dữ liệu chung team.
                                Chạy <b>scripts/pb-setup.mjs</b> một lần để bật đầy đủ — không cần cập nhật app.
                            </div>
                        )}
                    </div>

                    {status.rows.length === 0 && (
                        <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
                            Chưa có dự án nào
                        </div>
                    )}
                    {status.rows.map(row => (
                        <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: '1px solid var(--line)' }}>
                            {STATUS_ICON[row.status]}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    {row.scope === 'team' ? <Users size={12} style={{ color: 'var(--blue)', flexShrink: 0 }} /> : <Lock size={11} style={{ color: 'var(--muted)', flexShrink: 0 }} />}
                                    {row.name}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
                                    {STATUS_LABEL[row.status]}
                                    {row.docsPending > 0 && ` · ${row.docsPending} file chờ`}
                                    {!row.mine && row.ownerName && ` · của ${row.ownerName}`}
                                    {row.status !== 'to_pull' && row.localDocs !== row.remoteDocs
                                        ? ` · local ${row.localDocs} / cloud ${row.remoteDocs}`
                                        : row.status === 'synced' && row.localDocs > 0 ? ` · ${row.localDocs} file` : ''}
                                </div>
                            </div>
                        </div>
                    ))}

                    <div style={{ padding: '14px 16px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {status.pendingCount > 0 && (
                            <div style={{ fontSize: 13, color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Clock size={13} /> {status.pendingCount} mục đang chờ đẩy lên
                            </div>
                        )}
                        <button className="btn btn-primary btn-block" onClick={onSync}>
                            <RefreshCw size={15} /> Đồng bộ lại ngay
                        </button>
                        {(status.brokenShare > 0 || status.wrongTeam > 0) && onRepairTeam && (
                            <button className="btn btn-block" onClick={onRepairTeam}
                                style={{ background: 'var(--warn)', color: '#fff', border: 'none' }}>
                                <Users size={15} /> Gắn team &amp; đẩy lại
                            </button>
                        )}
                        <button className="btn btn-block" onClick={loadStatus} style={{ background: 'none', border: '1.5px solid var(--line)', color: 'var(--ink-2)' }}>
                            Làm mới danh sách
                        </button>
                    </div>
                </>
            )}
        </Sheet>
    );
}
