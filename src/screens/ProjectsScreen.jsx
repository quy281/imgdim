import React, { useState } from 'react';
import {
    FolderOpen, Plus, Settings, MoreVertical, Pencil, Trash2,
    Cloud, CloudOff, RefreshCw, LogIn, LogOut, CheckCircle2,
} from 'lucide-react';
import Sheet from '../ui/Sheet';
import TextSheet from '../ui/TextSheet';
import Confirm from '../ui/Confirm';
import * as pb from '../lib/pb';

export default function ProjectsScreen({ projects, syncBusy, onOpen, onCreate, onRename, onDelete, onSync, onLogin, onLogout }) {
    const [textSheet, setTextSheet] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [menuFor, setMenuFor] = useState(null); // project object
    const [showSettings, setShowSettings] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loggingIn, setLoggingIn] = useState(false);

    const logged = pb.isLoggedIn();
    const account = pb.me();

    const doLogin = async () => {
        if (!email.trim() || !password) return;
        setLoggingIn(true);
        try {
            await onLogin(email.trim(), password);
            setPassword('');
        } finally {
            setLoggingIn(false);
        }
    };

    const fmtDate = (ts) => new Date(ts).toLocaleDateString('vi-VN');

    return (
        <div className="screen">
            <div className="hdr">
                <div className="brand">
                    <img src="/icon.svg" alt="MKG" />
                    <div style={{ minWidth: 0 }}>
                        <h1>MKG Khảo Sát</h1>
                        <div className="hdr-sub">Khảo sát hiện trạng nội thất</div>
                    </div>
                </div>
                <div className={`sync-chip ${syncBusy ? 'busy' : logged ? 'on' : 'off'}`}>
                    {syncBusy ? <RefreshCw size={13} className="spin" /> : logged ? <Cloud size={13} /> : <CloudOff size={13} />}
                    {syncBusy ? 'Đang sync' : logged ? 'Cloud' : 'Offline'}
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
                                <div className="project-meta">{fmtDate(p.createdAt)}</div>
                            </div>
                            <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setMenuFor(p); }}>
                                <MoreVertical size={19} />
                            </button>
                        </div>
                    ))
                )}
            </div>

            {/* Per-project menu */}
            <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name}>
                <button className="sheet-row" onClick={() => {
                    const p = menuFor;
                    setMenuFor(null);
                    setTextSheet({ title: 'Đổi tên dự án', initial: p.name, onOK: (name) => onRename(p.id, name) });
                }}>
                    <Pencil size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Đổi tên</div>
                </button>
                <button className="sheet-row" style={{ color: '#dc2626' }} onClick={() => {
                    const p = menuFor;
                    setMenuFor(null);
                    setConfirm({
                        title: `Xóa "${p.name}"?`,
                        message: 'Toàn bộ mặt bằng và ảnh khảo sát trong dự án sẽ bị xóa.',
                        actionLabel: 'Xóa dự án',
                        onOK: () => onDelete(p.id),
                    });
                }}>
                    <Trash2 size={19} />
                    <div style={{ flex: 1 }}>Xóa dự án</div>
                </button>
            </Sheet>

            {/* Settings / account */}
            <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Đồng bộ & tài khoản"
                sub="Dữ liệu lưu trên máy, tự đồng bộ lên cloud khi đăng nhập.">
                {logged ? (
                    <>
                        <div className="sheet-row" style={{ borderBottom: '1px solid var(--line)' }}>
                            <CheckCircle2 size={20} style={{ color: 'var(--ok)' }} />
                            <div style={{ flex: 1 }}>
                                Đã đăng nhập
                                <div className="sub">{account?.email}</div>
                            </div>
                        </div>
                        <button className="sheet-row" onClick={() => { setShowSettings(false); onSync(); }}>
                            <RefreshCw size={19} style={{ color: 'var(--blue)' }} className={syncBusy ? 'spin' : ''} />
                            <div style={{ flex: 1 }}>Đồng bộ ngay<div className="sub">Kéo về + đẩy lên toàn bộ</div></div>
                        </button>
                        <button className="sheet-row" style={{ color: '#dc2626' }} onClick={() => { onLogout(); setShowSettings(false); }}>
                            <LogOut size={19} />
                            <div style={{ flex: 1 }}>Đăng xuất</div>
                        </button>
                    </>
                ) : (
                    <>
                        <div className="field">
                            <label>Email</label>
                            <input type="email" value={email} placeholder="email@mkg.vn"
                                onChange={e => setEmail(e.target.value)} autoComplete="username" />
                        </div>
                        <div className="field">
                            <label>Mật khẩu</label>
                            <input type="password" value={password} placeholder="••••••••"
                                onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                                onKeyDown={e => { if (e.key === 'Enter') doLogin(); }} />
                        </div>
                        <button className="btn btn-primary btn-block" disabled={loggingIn} onClick={doLogin}>
                            <LogIn size={18} /> {loggingIn ? 'Đang đăng nhập...' : 'Đăng nhập để đồng bộ'}
                        </button>
                    </>
                )}
                <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--muted)', paddingTop: 14 }}>
                    MKG Khảo Sát v2.0 · db.mkg.vn
                </div>
            </Sheet>

            <TextSheet cfg={textSheet} onClose={() => setTextSheet(null)} />
            <Confirm cfg={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
