import React, { useState } from 'react';
import {
    FolderOpen, Plus, Settings, MoreVertical, Pencil, Trash2,
    Cloud, CloudOff, RefreshCw, LogIn, LogOut, CheckCircle2,
    Share2, ListChecks, Users, Lock, ShieldCheck, Check, KeyRound,
} from 'lucide-react';
import Sheet from '../ui/Sheet';
import TextSheet from '../ui/TextSheet';
import Confirm from '../ui/Confirm';
import { toast } from '../ui/Toast';
import * as pb from '../lib/pb';

const fmtSince = (ts) => {
    if (!ts) return 'Cloud';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'vừa xong';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} phút trước`;
    return `${Math.floor(m / 60)} giờ trước`;
};

export default function ProjectsScreen({
    projects, account, syncBusy, syncMsg, lastSyncAt,
    onOpen, onCreate, onRename, onDelete, onSetScope, onShare,
    onSync, onOpenSyncStatus, onOpenTeamAdmin, onLogin, onLogout,
}) {
    const [textSheet, setTextSheet] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [menuFor, setMenuFor] = useState(null);
    const [teamPickerFor, setTeamPickerFor] = useState(null); // project object
    const [showSettings, setShowSettings] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loggingIn, setLoggingIn] = useState(false);
    const [pinForm, setPinForm] = useState(null); // { old, next, again }
    const [pinBusy, setPinBusy] = useState(false);

    const logged = pb.isLoggedIn();
    // ownerId() chứ không myId(): với superuser, myId() là id trong _superusers, không
    // khớp project.ownerId (được ghi bằng ownerId() lúc tạo — xem App.jsx createProject).
    const myId = pb.ownerId();
    const teams = pb.myTeams();
    const team = teams[0] || null;
    // Nhãn phải nói ĐÚNG cái đang lưu, không rơi về team của người đang xem. Bản cũ rơi
    // về team?.name nên cùng một dự án hiện "Team Đội 1" trên máy này và "Team MKG" trên
    // máy kia — không có gì đổi ngoài người xem, và không ai lần ra được dự án thật sự
    // đang chia sẻ cho ai.
    const teamNameOf = (p) => {
        if (!p.teamId) return null;
        return teams.find(t => t.id === p.teamId)?.name || '(đội khác)';
    };

    const doLogin = async () => {
        if (!email.trim() || !password) return;
        setLoggingIn(true);
        try {
            await onLogin(email.trim(), password);
            setPassword('');
            setShowSettings(false);
        } catch { /* toast đã báo */ } finally {
            setLoggingIn(false);
        }
    };

    const daysLeft = logged ? pb.sessionDaysLeft() : null;

    const doChangePin = async () => {
        const { old, next, again } = pinForm;
        if (next !== again) { toast('Hai lần nhập PIN mới không giống nhau', 'err'); return; }
        setPinBusy(true);
        try {
            await pb.changePin(old, next);
            setPinForm(null);
            toast('Đã đổi PIN — lần sau đăng nhập bằng PIN mới', 'ok');
        } catch (err) {
            // 400 ở đây gần như luôn là sai PIN cũ; thông báo của PocketBase quá kỹ thuật.
            toast(err.status === 400 && /oldPassword|password/i.test(err.message)
                ? 'PIN hiện tại không đúng' : err.message, 'err');
        } finally {
            setPinBusy(false);
        }
    };

    const fmtDate = (ts) => new Date(ts).toLocaleDateString('vi-VN');
    // Không có scope = team (mặc định mới) — xem SCOPE_DEFAULT trong pb.js.
    const isTeam = (p) => (p.scope || pb.SCOPE_DEFAULT) === 'team';
    const isMine = (p) => !p.ownerId || !myId || p.ownerId === myId;

    return (
        <div className="screen">
            <div className="hdr">
                <div className="brand">
                    <img src="/icon.svg" alt="MKG" />
                    <div style={{ minWidth: 0 }}>
                        <h1>MKG Khảo Sát</h1>
                        <div className="hdr-sub">
                            {logged ? (account?.email || pb.myName()) : 'Khảo sát hiện trạng nội thất'}
                        </div>
                    </div>
                </div>
                <div className={`sync-chip ${syncBusy ? 'busy' : logged ? 'on' : 'off'}`}
                    onClick={() => logged && onOpenSyncStatus?.()}>
                    {syncBusy ? <RefreshCw size={13} className="spin" /> : logged ? <Cloud size={13} /> : <CloudOff size={13} />}
                    {syncBusy ? (syncMsg ? syncMsg.replace(/^Đang /, '').replace(/\.\.\.$/, '') : 'Đang sync')
                        : logged ? fmtSince(lastSyncAt) : 'Offline'}
                </div>
                <button className="icon-btn" onClick={() => setShowSettings(true)}><Settings size={21} /></button>
            </div>

            <div className="scroll-body">
                <button className="btn btn-primary btn-block" style={{ height: 52, fontSize: 15.5, marginBottom: 16 }}
                    onClick={() => setTextSheet({
                        title: 'Dự án mới',
                        label: 'Tên công trình',
                        placeholder: 'VD: Biệt thự anh Minh — Q2',
                        onOK: onCreate,
                    })}>
                    <Plus size={20} /> Dự án khảo sát mới
                </button>

                {projects.length === 0 ? (
                    <div className="empty">
                        <FolderOpen size={52} />
                        <h3>Chưa có dự án nào</h3>
                        <p>Tạo dự án đầu tiên để bắt đầu khảo sát công trình</p>
                    </div>
                ) : (
                    projects.map(p => (
                        <div key={p.id} className="card project-card" onClick={() => onOpen(p.id)}>
                            <div className="project-icon"><FolderOpen size={23} /></div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="project-name">{p.name}</div>
                                {/* Hiện CẢ hai việc: chia sẻ cho đội nào, và của ai. Bản cũ thấy
                                    dự án của đồng nghiệp thì thay tên đội bằng tên người, nên
                                    không cách nào biết nó đang chia sẻ tới đâu. */}
                                <div className="project-meta" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    {isTeam(p) ? (
                                        teamNameOf(p)
                                            ? <><Users size={11.5} style={{ color: 'var(--blue)' }} />Team {teamNameOf(p)}</>
                                            : <><Users size={11.5} style={{ color: 'var(--warn)' }} />
                                                <span style={{ color: 'var(--warn)' }}>chưa gắn đội</span></>
                                    ) : <><Lock size={11} /> Riêng tư</>}
                                    {!isMine(p) && <>
                                        <span style={{ opacity: .5 }}>·</span>
                                        {p.ownerName || 'Đồng nghiệp'}
                                    </>}
                                    <span style={{ opacity: .5 }}>·</span>{fmtDate(p.createdAt)}
                                </div>
                            </div>
                            <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setMenuFor(p); }}>
                                <MoreVertical size={19} />
                            </button>
                        </div>
                    ))
                )}
            </div>

            {/* Menu từng dự án */}
            <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name}>
                <button className="sheet-row" onClick={() => {
                    const p = menuFor;
                    setMenuFor(null);
                    setTextSheet({ title: 'Đổi tên dự án', initial: p.name, onOK: (name) => onRename(p.id, name) });
                }}>
                    <Pencil size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Đổi tên</div>
                </button>

                {logged && teams.length > 1 ? (
                    // Nhiều team (Academy/Labs...) → mở picker thay vì đoán team nào.
                    <button className="sheet-row" onClick={() => { setTeamPickerFor(menuFor); setMenuFor(null); }}>
                        <Users size={19} style={{ color: 'var(--blue)' }} />
                        <div style={{ flex: 1 }}>
                            Đổi phạm vi chia sẻ
                            <div className="sub">
                                {!menuFor || !isTeam(menuFor) ? 'Đang: Riêng tư'
                                    : teamNameOf(menuFor) ? `Đang chia sẻ: Team ${teamNameOf(menuFor)}`
                                        : 'Chia sẻ theo đội nhưng CHƯA gắn đội — chưa ai khác đọc được'}
                            </div>
                        </div>
                    </button>
                ) : logged && (
                    <button className="sheet-row" onClick={() => {
                        const p = menuFor;
                        setMenuFor(null);
                        onSetScope(p.id, isTeam(p) ? 'private' : 'team', team);
                    }}>
                        {menuFor && isTeam(menuFor)
                            ? <><Lock size={19} style={{ color: 'var(--ink-2)' }} />
                                <div style={{ flex: 1 }}>Chuyển về riêng tư
                                    <div className="sub">Chỉ mình thấy trên các máy của mình</div></div></>
                            : <><Users size={19} style={{ color: 'var(--blue)' }} />
                                <div style={{ flex: 1 }}>Chia sẻ cho team {team?.name || 'MKG'}
                                    <div className="sub">Cả team xem và sửa được dự án này</div></div></>}
                    </button>
                )}

                <button className="sheet-row" onClick={() => { const p = menuFor; setMenuFor(null); onShare(p); }}>
                    <Share2 size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>
                        Chia sẻ link xem
                        <div className="sub">Link ngắn gửi khách — thu hồi được</div>
                    </div>
                </button>

                <button className="sheet-row" style={{ color: '#dc2626' }} onClick={() => {
                    const p = menuFor;
                    setMenuFor(null);
                    setConfirm({
                        title: `Xóa "${p.name}"?`,
                        message: isTeam(p)
                            ? 'Dự án đang chia sẻ với team — xóa sẽ mất trên máy của tất cả thành viên.'
                            : 'Toàn bộ mặt bằng và ảnh khảo sát trong dự án sẽ bị xóa.',
                        actionLabel: 'Xóa dự án',
                        onOK: () => onDelete(p.id),
                    });
                }}>
                    <Trash2 size={19} />
                    <div style={{ flex: 1 }}>Xóa dự án</div>
                </button>
            </Sheet>

            {/* Picker phạm vi khi có nhiều hơn 1 team */}
            <Sheet open={!!teamPickerFor} onClose={() => setTeamPickerFor(null)}
                title="Chia sẻ với ai?" sub={teamPickerFor?.name}>
                <button className="sheet-row" onClick={() => {
                    onSetScope(teamPickerFor.id, 'private');
                    setTeamPickerFor(null);
                }}>
                    <Lock size={19} style={{ color: 'var(--ink-2)' }} />
                    <div style={{ flex: 1 }}>Riêng tư<div className="sub">Chỉ mình thấy trên các máy của mình</div></div>
                    {teamPickerFor && !isTeam(teamPickerFor) && <Check size={18} style={{ color: 'var(--ok)' }} />}
                </button>
                {teams.map(t => (
                    <button key={t.id} className="sheet-row" onClick={() => {
                        onSetScope(teamPickerFor.id, 'team', t);
                        setTeamPickerFor(null);
                    }}>
                        <Users size={19} style={{ color: 'var(--blue)' }} />
                        <div style={{ flex: 1 }}>Team {t.name}<div className="sub">Cả team xem và sửa được dự án này</div></div>
                        {teamPickerFor && isTeam(teamPickerFor) && (teamPickerFor.teamId || team?.id) === t.id &&
                            <Check size={18} style={{ color: 'var(--ok)' }} />}
                    </button>
                ))}
            </Sheet>

            {/* Cài đặt / tài khoản */}
            <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Đồng bộ & tài khoản"
                sub="Dữ liệu lưu trên máy, tự đồng bộ lên cloud khi đăng nhập.">
                {logged ? (
                    <>
                        <div className="sheet-row" style={{ borderBottom: '1px solid var(--line)' }}>
                            <CheckCircle2 size={20} style={{ color: daysLeft != null && daysLeft <= 3 ? 'var(--warn)' : 'var(--ok)' }} />
                            <div style={{ flex: 1 }}>
                                {pb.myName() || account?.email}
                                <div className="sub">
                                    {daysLeft == null
                                        ? 'Tài khoản quản trị — phiên không hết hạn'
                                        : daysLeft === 0
                                            ? 'Phiên hết hạn hôm nay — đăng nhập lại để không mất đồng bộ'
                                            : `Còn ${daysLeft} ngày trước khi phải đăng nhập lại`}
                                </div>
                            </div>
                        </div>
                        <div className="sheet-row" style={{ borderBottom: '1px solid var(--line)' }}>
                            <Users size={20} style={{ color: team ? 'var(--blue)' : 'var(--muted)' }} />
                            <div style={{ flex: 1 }}>
                                {team ? `Team ${team.name}` : 'Chưa thuộc team nào'}
                                <div className="sub">
                                    {team ? 'Dự án đặt phạm vi team sẽ hiện cho cả team'
                                        : 'Nhờ Founder thêm tài khoản vào team để dùng dữ liệu chung'}
                                </div>
                            </div>
                        </div>
                        <button className="sheet-row" onClick={() => { setShowSettings(false); onSync(); }}>
                            <RefreshCw size={19} style={{ color: 'var(--blue)' }} className={syncBusy ? 'spin' : ''} />
                            <div style={{ flex: 1 }}>Đồng bộ ngay<div className="sub">Kéo về + đẩy lên toàn bộ</div></div>
                        </button>
                        <button className="sheet-row" onClick={() => { setShowSettings(false); onOpenSyncStatus?.(); }}>
                            <ListChecks size={19} style={{ color: 'var(--blue)' }} />
                            <div style={{ flex: 1 }}>Kiểm tra đồng bộ<div className="sub">So sánh local ↔ cloud từng dự án</div></div>
                        </button>
                        {!pb.isSuperuser() && (
                            <button className="sheet-row" onClick={() => setPinForm({ old: '', next: '', again: '' })}>
                                <KeyRound size={19} style={{ color: 'var(--violet)' }} />
                                <div style={{ flex: 1 }}>
                                    Đổi mã PIN
                                    <div className="sub">Đổi ngay nếu vẫn đang dùng PIN quản trị giao</div>
                                </div>
                            </button>
                        )}
                        {pb.isAdmin() && (
                            <button className="sheet-row" onClick={() => { setShowSettings(false); onOpenTeamAdmin?.(); }}>
                                <ShieldCheck size={19} style={{ color: 'var(--blue)' }} />
                                <div style={{ flex: 1 }}>Quản lý team & người dùng<div className="sub">Cấp tài khoản, gán team</div></div>
                            </button>
                        )}
                        {pinForm && (
                            <div style={{ padding: '4px 0 12px' }}>
                                <div className="field">
                                    <label>PIN hiện tại</label>
                                    <input type="password" inputMode="numeric" value={pinForm.old} placeholder="••••"
                                        onChange={e => setPinForm(f => ({ ...f, old: e.target.value }))} />
                                </div>
                                <div className="field">
                                    <label>PIN mới ({pb.PIN_MIN}–{pb.PIN_MAX} chữ số)</label>
                                    <input type="password" inputMode="numeric" value={pinForm.next} placeholder="••••"
                                        onChange={e => setPinForm(f => ({ ...f, next: e.target.value }))} />
                                </div>
                                <div className="field">
                                    <label>Nhập lại PIN mới</label>
                                    <input type="password" inputMode="numeric" value={pinForm.again} placeholder="••••"
                                        onChange={e => setPinForm(f => ({ ...f, again: e.target.value }))}
                                        onKeyDown={e => { if (e.key === 'Enter') doChangePin(); }} />
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button className="btn btn-block" onClick={() => setPinForm(null)}>Hủy</button>
                                    <button className="btn btn-primary btn-block" disabled={pinBusy} onClick={doChangePin}>
                                        {pinBusy ? 'Đang đổi...' : 'Đổi PIN'}
                                    </button>
                                </div>
                            </div>
                        )}
                        <button className="sheet-row" style={{ color: '#dc2626' }} onClick={() => { onLogout(); setShowSettings(false); }}>
                            <LogOut size={19} />
                            <div style={{ flex: 1 }}>Đăng xuất<div className="sub">Dữ liệu vẫn giữ trên máy này</div></div>
                        </button>
                    </>
                ) : (
                    <>
                        <div className="field">
                            {/* type="text" chứ không phải "email": bảng users cho đăng nhập bằng
                                username, mà input email sẽ bị trình duyệt chặn khi nhập "kts1". */}
                            <label>Tên đăng nhập</label>
                            <input type="text" value={email} placeholder="kts1"
                                autoCapitalize="none" autoCorrect="off" spellCheck="false"
                                onChange={e => setEmail(e.target.value)} autoComplete="username" />
                        </div>
                        <div className="field">
                            <label>Mã PIN (hoặc mật khẩu quản trị)</label>
                            {/* inputMode numeric → điện thoại bật bàn số, không phải bàn chữ.
                                Vẫn là type=password để PIN không hiện giữa công trường. */}
                            <input type="password" inputMode="numeric" value={password} placeholder="••••"
                                onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                                onKeyDown={e => { if (e.key === 'Enter') doLogin(); }} />
                        </div>
                        <button className="btn btn-primary btn-block" disabled={loggingIn} onClick={doLogin}>
                            <LogIn size={18} /> {loggingIn ? 'Đang đăng nhập...' : 'Đăng nhập để đồng bộ'}
                        </button>
                        <div style={{ fontSize: 12, color: 'var(--muted)', paddingTop: 12, lineHeight: 1.55 }}>
                            Phiên đăng nhập dùng được {pb.SESSION_DAYS} ngày rồi phải đăng nhập lại.
                            Nhận PIN từ quản trị, và đổi ngay sau lần đăng nhập đầu.
                            <div style={{ marginTop: 8 }}>
                                <b>Quản trị</b>: dán email và mật khẩu superuser PocketBase vào đúng hai ô
                                trên — ô PIN nhận cả mật khẩu dài.
                            </div>
                        </div>
                    </>
                )}
                <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', paddingTop: 14 }}>
                    MKG Khảo Sát v3.0 · db.mkg.vn
                </div>
            </Sheet>

            <TextSheet cfg={textSheet} onClose={() => setTextSheet(null)} />
            <Confirm cfg={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
