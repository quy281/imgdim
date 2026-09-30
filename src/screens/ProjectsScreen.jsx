import React, { useState } from 'react';
import {
    FolderOpen, Plus, Settings, MoreVertical, Pencil, Trash2,
    Cloud, CloudOff, RefreshCw, LogIn, LogOut, CheckCircle2,
    Share2, ListChecks, Users, Lock, ShieldCheck, Check, KeyRound, Inbox, AlertCircle,
    UserPlus, Store, PackageOpen, Grid2X2, List, Images, PencilRuler,
} from 'lucide-react';
import Sheet from '../ui/Sheet';
import TextSheet from '../ui/TextSheet';
import Confirm from '../ui/Confirm';
import ServiceBanner from '../ui/ServiceBanner';
import ExperiencePreview from '../ui/ExperiencePreview';
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
    projects, projectStats = {}, account, syncBusy, syncMsg, syncError, lastSyncAt,
    onOpen, onCreate, onRename, onDelete, onSetScope, onShare,
    onSync, onOpenSyncStatus, onOpenTeamAdmin, onOpenCustomerInbox, customerInboxCount,
    onLogin, onLogout, onOpenExperience, onOpenBoardInventory, onOpenBoardMarket, boardMarketCount = 0,
}) {
    const [textSheet, setTextSheet] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [menuFor, setMenuFor] = useState(null);
    const [teamPickerFor, setTeamPickerFor] = useState(null); // project object
    const [showSettings, setShowSettings] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loggingIn, setLoggingIn] = useState(false);
    const [signupOpen, setSignupOpen] = useState(false);
    const [signupBusy, setSignupBusy] = useState(false);
    const [signupForm, setSignupForm] = useState({ name: '', email: '', phone: '', note: '' });
    const [pinForm, setPinForm] = useState(null); // { old, next, again }
    const [pinBusy, setPinBusy] = useState(false);
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('ks_project_view') || 'list');
    // Đội mặc định nằm ở localStorage (không phải state) — cần cờ này để ô chọn vẽ lại.
    const [, setDefaultTick] = useState(0);

    const logged = pb.isLoggedIn();
    const syncProblem = logged && syncError;
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

    const doSignup = async () => {
        setSignupBusy(true);
        try {
            await pb.submitSignupRequest(signupForm);
            setSignupForm({ name: '', email: '', phone: '', note: '' });
            setSignupOpen(false);
            toast('Đã gửi đăng ký — admin sẽ kích hoạt tài khoản rồi gửi PIN cho bạn', 'ok');
        } catch (err) {
            toast('Không gửi được đăng ký: ' + err.message, 'err');
        } finally {
            setSignupBusy(false);
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
    const setProjectView = (mode) => {
        setViewMode(mode);
        localStorage.setItem('ks_project_view', mode);
    };
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
                <div className={`sync-chip ${syncBusy ? 'busy' : syncProblem ? 'err' : logged ? 'on' : 'off'}`}
                    onClick={() => logged && onOpenSyncStatus?.()}>
                    {syncBusy ? <RefreshCw size={13} className="spin" />
                        : syncProblem ? <AlertCircle size={13} />
                            : logged ? <Cloud size={13} /> : <CloudOff size={13} />}
                    {syncBusy ? (syncMsg ? syncMsg.replace(/^Đang /, '').replace(/\.\.\.$/, '') : 'Đang sync')
                        : syncProblem ? (syncError.readOnly ? 'Chỉ tải về' : syncError.needsSetup ? 'Cần dựng' : 'Lỗi sync')
                            : logged ? fmtSince(lastSyncAt) : 'Offline'}
                </div>
                <button className="icon-btn" onClick={() => setShowSettings(true)}><Settings size={21} /></button>
            </div>

            <div className="scroll-body">
                <div className="module-tabs">
                    <button className="module-tab on">Khảo sát</button>
                    <button className="module-tab" onClick={onOpenBoardInventory}>
                        <PackageOpen size={15} /> Quản lý ván
                    </button>
                    <button className="module-tab" onClick={onOpenBoardMarket}>
                        <Store size={15} /> Sàn trao đổi ván dư
                        {!!boardMarketCount && <b>{boardMarketCount}</b>}
                    </button>
                </div>

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
                    <>
                        <div className="board-view-row project-view-row">
                            <span>{projects.length} dự án khảo sát</span>
                            <div className="segmented-mini">
                                <button className={viewMode === 'thumb' ? 'on' : ''} onClick={() => setProjectView('thumb')} title="Thumbnail">
                                    <Grid2X2 size={15} />
                                </button>
                                <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setProjectView('list')} title="List">
                                    <List size={15} />
                                </button>
                            </div>
                        </div>
                        <div className={viewMode === 'thumb' ? 'project-grid thumb-mode' : 'project-grid list-mode'}>
                            {projects.map(p => {
                                const stats = projectStats[p.id] || { photos: 0, plans: 0, total: 0 };
                                return (
                                    <div key={p.id} className="card project-card project-card-rich" onClick={() => onOpen(p.id)}>
                                        <div className={`project-thumb ${stats.thumb ? 'has-thumb' : ''}`}>
                                            {stats.thumb
                                                ? <img src={stats.thumb} alt={p.name} />
                                                : <FolderOpen size={viewMode === 'thumb' ? 34 : 23} />}
                                        </div>
                                        <div className="project-main">
                                            <div className="project-name">{p.name}</div>
                                            <div className="project-stats">
                                                <span><PencilRuler size={13} />{stats.plans || 0} bản vẽ</span>
                                                <span><Images size={13} />{stats.photos || 0} hình</span>
                                            </div>
                                            {/* Hiện CẢ hai việc: chia sẻ cho đội nào, và của ai. Bản cũ thấy
                                                dự án của đồng nghiệp thì thay tên đội bằng tên người, nên
                                                không cách nào biết nó đang chia sẻ tới đâu. */}
                                            <div className="project-meta">
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
                                        <button className="icon-btn project-menu-btn" onClick={(e) => { e.stopPropagation(); setMenuFor(p); }}>
                                            <MoreVertical size={19} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                <ExperiencePreview onOpenExperience={onOpenExperience} />
                <ServiceBanner />
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
                        {syncError && (
                            <div style={{
                                margin: '10px 0', padding: 12, borderRadius: 12,
                                background: syncError.needsSetup ? 'var(--warn-soft)' : '#fee2e2',
                                color: syncError.needsSetup ? 'var(--ink)' : '#7f1d1d',
                                fontSize: 12.5, lineHeight: 1.55,
                            }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                    <AlertCircle size={16} style={{ color: syncError.needsSetup ? 'var(--warn)' : '#dc2626', flexShrink: 0, marginTop: 1 }} />
                                    <div style={{ flex: 1 }}>
                                        <b>{syncError.readOnly ? 'Có thể tải cloud về; gửi lên đang tạm dừng.' : syncError.needsSetup ? 'Tài khoản đang chưa sync được vì backend chưa dựng đủ.' : 'Đồng bộ đang lỗi.'}</b>
                                        <div>{syncError.message}</div>
                                        {syncError.needsSetup && (
                                            <button className="btn btn-primary btn-block" style={{ marginTop: 10 }}
                                                onClick={() => { setShowSettings(false); onOpenTeamAdmin?.(); }}>
                                                <ShieldCheck size={15} />
                                                {pb.isSuperuser() ? 'Mở Quản lý team để Dựng ngay' : 'Mở hướng dẫn đăng nhập superuser'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        <button className="sheet-row" onClick={() => { setShowSettings(false); onSync(); }}>
                            <RefreshCw size={19} style={{ color: 'var(--blue)' }} className={syncBusy ? 'spin' : ''} />
                            <div style={{ flex: 1 }}>Đồng bộ ngay<div className="sub">Kéo về + đẩy lên toàn bộ</div></div>
                        </button>
                        <button className="sheet-row" onClick={() => { setShowSettings(false); onOpenSyncStatus?.(); }}>
                            <ListChecks size={19} style={{ color: 'var(--blue)' }} />
                            <div style={{ flex: 1 }}>Kiểm tra đồng bộ<div className="sub">So sánh local ↔ cloud từng dự án</div></div>
                        </button>
                        <button className="sheet-row" onClick={() => { setShowSettings(false); onOpenCustomerInbox?.(); }}>
                            <Inbox size={19} style={{ color: 'var(--blue)' }} />
                            <div style={{ flex: 1 }}>
                                Dữ liệu khách gửi
                                <div className="sub">{customerInboxCount ? `${customerInboxCount} bản đang chờ duyệt` : 'Hộp thư khảo sát từ khách hàng'}</div>
                            </div>
                            {!!customerInboxCount && (
                                <span style={{ minWidth: 24, height: 24, borderRadius: 12, background: 'var(--warn)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12 }}>
                                    {customerInboxCount}
                                </span>
                            )}
                        </button>
                        {/* Founder và quản trị ở TẤT CẢ đội, nên app không thể đoán dự án mới
                            thuộc đội nào — đoán sai là dự án rơi vào đội khác và người cần
                            xem thì không thấy. Bắt chọn một lần, còn hơn đoán mỗi lần. */}
                        {teams.length > 1 && (
                            <div className="field" style={{ padding: '10px 0 4px' }}>
                                <label>Đội mặc định cho dự án mới</label>
                                <select value={pb.defaultTeamId() || (team?.id || '')}
                                    onChange={e => { pb.setDefaultTeamId(e.target.value); setDefaultTick(t => t + 1); }}>
                                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                </select>
                            </div>
                        )}
                        {!pb.isSuperuser() && (
                            <button className="sheet-row" onClick={() => setPinForm({ old: '', next: '', again: '' })}>
                                <KeyRound size={19} style={{ color: 'var(--violet)' }} />
                                <div style={{ flex: 1 }}>
                                    Đổi mã PIN
                                    <div className="sub">Đổi ngay nếu vẫn đang dùng PIN quản trị giao</div>
                                </div>
                            </button>
                        )}
                        {(pb.isAdmin() || syncError?.needsSetup) && (
                            <button className="sheet-row" onClick={() => { setShowSettings(false); onOpenTeamAdmin?.(); }}>
                                <ShieldCheck size={19} style={{ color: 'var(--blue)' }} />
                                <div style={{ flex: 1 }}>
                                    {pb.isAdmin() ? 'Quản lý team & người dùng' : 'Dựng backend đồng bộ'}
                                    <div className="sub">
                                        {pb.isAdmin() ? 'Cấp tài khoản, gán team' : 'Cần đăng nhập superuser PocketBase để nâng schema'}
                                    </div>
                                </div>
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
                        <button className="btn btn-block" style={{ marginTop: 8, border: '1.5px solid var(--line)', background: 'none', color: 'var(--ink-2)' }}
                            onClick={() => setSignupOpen(v => !v)}>
                            <UserPlus size={17} /> Chưa có tài khoản? Đăng ký sử dụng
                        </button>
                        {signupOpen && (
                            <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                                <div className="field">
                                    <label>Họ tên</label>
                                    <input type="text" value={signupForm.name} placeholder="Nguyễn Văn A"
                                        onChange={e => setSignupForm(f => ({ ...f, name: e.target.value }))} />
                                </div>
                                <div className="field">
                                    <label>Email</label>
                                    <input type="text" value={signupForm.email} placeholder="ten@mkg.vn"
                                        autoCapitalize="none" autoCorrect="off" spellCheck="false"
                                        onChange={e => setSignupForm(f => ({ ...f, email: e.target.value }))} />
                                </div>
                                <div className="field">
                                    <label>Số điện thoại (tùy chọn)</label>
                                    <input type="text" value={signupForm.phone} placeholder="090..."
                                        onChange={e => setSignupForm(f => ({ ...f, phone: e.target.value }))} />
                                </div>
                                <div className="field">
                                    <label>Ghi chú / đội muốn vào (tùy chọn)</label>
                                    <input type="text" value={signupForm.note} placeholder="VD: đội Sunrise"
                                        onChange={e => setSignupForm(f => ({ ...f, note: e.target.value }))}
                                        onKeyDown={e => { if (e.key === 'Enter') doSignup(); }} />
                                </div>
                                <button className="btn btn-primary btn-block" disabled={signupBusy} onClick={doSignup}>
                                    {signupBusy ? <RefreshCw size={15} className="spin" /> : <UserPlus size={15} />}
                                    Gửi đăng ký chờ duyệt
                                </button>
                            </div>
                        )}
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
