import React, { useState, useEffect } from 'react';
import {
    Users, Plus, ArrowLeft, Trash2, Copy, RefreshCw, AlertCircle, UserPlus,
} from 'lucide-react';
import Sheet from './Sheet';
import { toast } from './Toast';
import * as pb from '../lib/pb';

/**
 * Quản lý team & thành viên — chỉ superuser mở được (ProjectsScreen gate ở nút mở).
 * Server cũng khoá cứng: teams.createRule/updateRule = null (xem pb-setup.mjs), nên kể cả
 * gọi thẳng API cũng bị từ chối nếu không phải superuser — đây là lớp UI, không phải lớp
 * bảo mật duy nhất.
 */
export default function TeamAdminSheet({ open, onClose }) {
    const [teams, setTeams] = useState(null);
    const [error, setError] = useState(null);
    const [selected, setSelected] = useState(null); // team object đang xem thành viên
    const [members, setMembers] = useState(null);
    const [creatingTeam, setCreatingTeam] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');
    const [addForm, setAddForm] = useState(null); // { email, name, password } | null
    const [revealed, setRevealed] = useState(null); // { email, password } — hiện một lần sau khi tạo
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (open) { load(); setSelected(null); setRevealed(null); setAddForm(null); }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const load = async () => {
        setError(null);
        try {
            setTeams(await pb.listTeams());
        } catch (err) {
            // PocketBase trả 404 "Missing collection context." khi collection `teams` chưa
            // tồn tại — nghĩa là pb-setup.mjs chưa chạy thành công, không phải lỗi ở đây.
            // Hiện thẳng message nội bộ đó ("Missing collection context.") chỉ gây hoang mang.
            setError(err.status === 404
                ? 'Backend chưa có collection `teams` — chạy scripts/pb-setup.mjs để tạo trước.'
                : err.message);
            setTeams([]);
        }
    };

    const openTeam = async (t) => {
        setSelected(t);
        setMembers(null);
        setAddForm(null);
        try { setMembers(await pb.getTeamMembers(t.id)); }
        catch (err) { toast('Không tải được thành viên: ' + err.message, 'err'); setMembers([]); }
    };

    const doCreateTeam = async () => {
        const name = newTeamName.trim();
        if (!name || busy) return;
        setBusy(true);
        try {
            await pb.createTeam(name);
            setNewTeamName('');
            setCreatingTeam(false);
            await load();
            toast(`Đã tạo team ${name}`, 'ok');
        } catch (err) {
            toast('Không tạo được team: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const doAddMember = async () => {
        const email = (addForm?.email || '').trim();
        if (!email.includes('@')) { toast('Nhập email hợp lệ', 'err'); return; }
        setBusy(true);
        try {
            const res = await pb.addTeamMember(selected.id, email, {
                name: addForm.name, password: addForm.password,
            });
            setAddForm(null);
            await Promise.all([openTeam(selected), load()]);
            if (res.created && res.password) setRevealed({ email: res.email, password: res.password });
            else toast('Đã thêm vào team', 'ok');
        } catch (err) {
            toast('Không thêm được: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const doRemove = async (m) => {
        setBusy(true);
        try {
            await pb.removeTeamMember(selected.id, m.id);
            await Promise.all([openTeam(selected), load()]);
            toast('Đã xóa khỏi team', 'ok');
        } catch (err) {
            toast('Không xóa được: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const copy = async (text) => {
        try { await navigator.clipboard.writeText(text); toast('Đã copy', 'ok'); }
        catch { toast('Không copy được — bấm giữ để chọn', 'err'); }
    };

    return (
        <Sheet open={open} onClose={onClose}
            title={selected ? `Team ${selected.name}` : 'Quản lý team & người dùng'}
            sub={selected ? undefined : 'Chỉ quản trị viên nhìn thấy mục này'}>

            {selected && (
                <button className="sheet-row" onClick={() => { setSelected(null); setRevealed(null); setAddForm(null); }}>
                    <ArrowLeft size={19} style={{ color: 'var(--ink-2)' }} />
                    <div style={{ flex: 1 }}>Quay lại danh sách team</div>
                </button>
            )}

            {error && (
                <div style={{ padding: '12px 16px', color: '#dc2626', fontSize: 13.5, display: 'flex', gap: 8 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
                </div>
            )}

            {/* ===== Danh sách team ===== */}
            {!selected && !error && (
                <>
                    {teams === null && (
                        <div style={{ padding: '16px', display: 'flex', gap: 8, color: 'var(--muted)', fontSize: 13.5 }}>
                            <RefreshCw size={15} className="spin" /> Đang tải...
                        </div>
                    )}
                    {teams?.map(t => (
                        <button key={t.id} className="sheet-row" onClick={() => openTeam(t)}>
                            <Users size={19} style={{ color: 'var(--blue)' }} />
                            <div style={{ flex: 1 }}>{t.name}<div className="sub">{t.memberCount} thành viên</div></div>
                        </button>
                    ))}
                    <div style={{ padding: '12px 16px' }}>
                        {creatingTeam ? (
                            <div className="field">
                                <label>Tên team mới</label>
                                <input autoFocus type="text" value={newTeamName} placeholder="VD: Academy"
                                    onChange={e => setNewTeamName(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') doCreateTeam(); }} />
                                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                    <button className="btn" style={{ flex: 1 }} onClick={() => { setCreatingTeam(false); setNewTeamName(''); }}>Hủy</button>
                                    <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy || !newTeamName.trim()} onClick={doCreateTeam}>
                                        Tạo
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button className="btn btn-block" style={{ border: '1.5px dashed var(--line)', background: 'none', color: 'var(--ink-2)' }}
                                onClick={() => setCreatingTeam(true)}>
                                <Plus size={17} /> Team mới
                            </button>
                        )}
                    </div>
                </>
            )}

            {/* ===== Thành viên của 1 team ===== */}
            {selected && (
                <>
                    {members === null && (
                        <div style={{ padding: '16px', display: 'flex', gap: 8, color: 'var(--muted)', fontSize: 13.5 }}>
                            <RefreshCw size={15} className="spin" /> Đang tải thành viên...
                        </div>
                    )}
                    {members?.length === 0 && (
                        <div style={{ padding: '16px', color: 'var(--muted)', fontSize: 13.5 }}>Chưa có thành viên</div>
                    )}
                    {members?.map(m => (
                        <div key={m.id} className="sheet-row">
                            <Users size={17} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                                {m.email && <div className="sub">{m.email}</div>}
                            </div>
                            <button className="icon-btn" style={{ color: '#dc2626' }} onClick={() => doRemove(m)} title="Xóa khỏi team">
                                <Trash2 size={17} />
                            </button>
                        </div>
                    ))}

                    {revealed && (
                        <div style={{ margin: '10px 16px', padding: 12, borderRadius: 10, background: 'var(--warn-soft)', border: '1px solid #f0d999' }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--warn)', marginBottom: 6 }}>
                                Lưu lại ngay — mật khẩu chỉ hiện một lần
                            </div>
                            <div style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>{revealed.email}</div>
                            <div style={{ fontSize: 15, fontFamily: 'ui-monospace, monospace', fontWeight: 700, marginTop: 2 }}>
                                {revealed.password}
                            </div>
                            <button className="btn" style={{ marginTop: 8, border: '1.5px solid var(--line)', background: 'none' }}
                                onClick={() => copy(`${revealed.email} / ${revealed.password}`)}>
                                <Copy size={15} /> Copy
                            </button>
                        </div>
                    )}

                    {addForm ? (
                        <div style={{ padding: '12px 16px' }}>
                            <div className="field">
                                <label>Email</label>
                                <input autoFocus type="text" value={addForm.email} placeholder="ten@mkg.vn"
                                    onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label>Tên hiển thị (tùy chọn)</label>
                                <input type="text" value={addForm.name} placeholder="Nguyễn Văn A"
                                    onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
                            </div>
                            <div className="field">
                                <label>Mật khẩu (bỏ trống để tự sinh — tối thiểu {pb.PASSWORD_MIN} ký tự)</label>
                                <input type="text" value={addForm.password} placeholder="Tự sinh ngẫu nhiên"
                                    onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') doAddMember(); }} />
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn" style={{ flex: 1 }} onClick={() => setAddForm(null)}>Hủy</button>
                                <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={doAddMember}>
                                    {busy ? <RefreshCw size={15} className="spin" /> : <UserPlus size={15} />} Thêm
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div style={{ padding: '12px 16px' }}>
                            <button className="btn btn-block" style={{ border: '1.5px dashed var(--line)', background: 'none', color: 'var(--ink-2)' }}
                                onClick={() => { setAddForm({ email: '', name: '', password: '' }); setRevealed(null); }}>
                                <UserPlus size={17} /> Thêm người vào team
                            </button>
                        </div>
                    )}
                </>
            )}
        </Sheet>
    );
}
