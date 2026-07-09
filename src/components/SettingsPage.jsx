import React, { useState, useEffect } from 'react';
import { ArrowLeft, CloudOff, Cloud, HardDrive, CheckCircle, AlertCircle, Settings2, ExternalLink, RefreshCw, LogIn, LogOut } from 'lucide-react';
import * as GDrive from '../googleDriveService';
import { login, logout as pbLogout, isLoggedIn, getModel, pushPlans, pullPlans } from '../pb';
import { loadDocs } from '../db';

export default function SettingsPage({ onBack, onGDriveChange }) {
    const [clientId, setClientId] = useState(localStorage.getItem('gdrive_client_id') || '');
    const [connected, setConnected] = useState(GDrive.isConnected());
    const [userInfo, setUserInfo] = useState(null);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState('');
    const [autoUpload, setAutoUpload] = useState(localStorage.getItem('gdrive_auto_upload') === 'true');

    // PocketBase sync state
    const [pbEmail, setPbEmail] = useState('');
    const [pbPassword, setPbPassword] = useState('');
    const [pbLogged, setPbLogged] = useState(isLoggedIn());
    const [pbModel, setPbModel] = useState(getModel());
    const [pbSyncing, setPbSyncing] = useState(false);
    const [pbProgress, setPbProgress] = useState('');
    const [pbError, setPbError] = useState('');
    const [pbSuccess, setPbSuccess] = useState('');

    useEffect(() => {
        if (connected) {
            GDrive.getUserInfo().then(info => setUserInfo(info));
        }
    }, [connected]);

    const handleConnect = async () => {
        if (!clientId.trim()) { setError('Vui lòng nhập Google Client ID'); return; }
        setError('');
        setConnecting(true);
        try {
            await GDrive.connect(clientId.trim());
            setConnected(true);
            const info = await GDrive.getUserInfo();
            setUserInfo(info);
            onGDriveChange?.(true);
        } catch (err) {
            setError('Kết nối thất bại: ' + err.message);
        }
        setConnecting(false);
    };

    const handleDisconnect = () => {
        GDrive.disconnect();
        setConnected(false);
        setUserInfo(null);
        onGDriveChange?.(false);
    };

    const toggleAutoUpload = () => {
        const next = !autoUpload;
        setAutoUpload(next);
        localStorage.setItem('gdrive_auto_upload', next.toString());
    };

    // PocketBase handlers
    const handlePbLogin = async () => {
        if (!pbEmail.trim() || !pbPassword.trim()) { setPbError('Vui lòng nhập email và mật khẩu'); return; }
        setPbError(''); setPbSuccess('');
        setPbSyncing(true);
        try {
            const model = await login(pbEmail.trim(), pbPassword.trim());
            setPbLogged(true);
            setPbModel(model);
            setPbSuccess('Đăng nhập thành công!');
        } catch (err) {
            setPbError('Đăng nhập thất bại: ' + err.message);
        }
        setPbSyncing(false);
    };

    const handlePbLogout = () => {
        pbLogout();
        setPbLogged(false);
        setPbModel(null);
        setPbSuccess('');
    };

    const handlePbPush = async () => {
        setPbError(''); setPbSuccess('');
        setPbSyncing(true);
        try {
            // Load all docs from all projects — we only sync plan docs
            const allProjects = JSON.parse(localStorage.getItem('mgkdim_projects') || '[]');
            let allDocs = [];
            for (const p of allProjects) {
                try {
                    const docs = await loadDocs(p.id);
                    allDocs = allDocs.concat(docs.filter(d => d.type === 'plan'));
                } catch { /* ignore */ }
            }
            if (allDocs.length === 0) { setPbSuccess('Không có mặt bằng nào để sync.'); setPbSyncing(false); return; }
            await pushPlans(allDocs, (msg) => setPbProgress(msg));
            setPbSuccess(`Đã đẩy ${allDocs.length} mặt bằng lên cloud!`);
        } catch (err) {
            setPbError('Lỗi upload: ' + err.message);
        }
        setPbProgress('');
        setPbSyncing(false);
    };

    const handlePbPull = async () => {
        setPbError(''); setPbSuccess('');
        setPbSyncing(true);
        try {
            const incoming = await pullPlans([]);
            if (incoming.length === 0) {
                setPbSuccess('Dữ liệu đã cập nhật nhất rồi!');
            } else {
                setPbSuccess(`Đã tải ${incoming.length} mặt bằng mới từ cloud. Vào lại dự án để thấy thay đổi.`);
            }
        } catch (err) {
            setPbError('Lỗi tải: ' + err.message);
        }
        setPbSyncing(false);
    };

    return (
        <div className="settings-page">
            <div className="settings-header">
                <button className="btn btn-icon" onClick={onBack} style={{ padding: 4 }}><ArrowLeft size={20} /></button>
                <h2 style={{ margin: 0, fontSize: 18 }}>Cài đặt</h2>
            </div>

            <div className="settings-content">
                {/* PocketBase Sync Section */}
                <div className="settings-section">
                    <div className="settings-section-header">
                        <RefreshCw size={20} color="#6366f1" />
                        <h3>Đồng bộ đa thiết bị</h3>
                    </div>

                    {pbLogged ? (
                        <div className="gdrive-connected">
                            <div className="gdrive-status">
                                <CheckCircle size={20} color="#22c55e" />
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 14 }}>Đã đăng nhập</div>
                                    {pbModel && <div style={{ fontSize: 12, color: '#94a3b8' }}>{pbModel.email}</div>}
                                </div>
                            </div>

                            {pbProgress && (
                                <div style={{ fontSize: 12, color: '#6366f1', padding: '6px 0', display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <RefreshCw size={12} className="spin-icon" /> {pbProgress}
                                </div>
                            )}
                            {pbError && <div className="settings-error"><AlertCircle size={14} /> {pbError}</div>}
                            {pbSuccess && <div className="settings-success"><CheckCircle size={14} /> {pbSuccess}</div>}

                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={handlePbPush} disabled={pbSyncing}>
                                    <RefreshCw size={16} /> {pbSyncing ? 'Đang sync...' : 'Đẩy lên'}
                                </button>
                                <button className="btn" style={{ flex: 1, justifyContent: 'center', border: '1px solid #6366f1', color: '#6366f1' }} onClick={handlePbPull} disabled={pbSyncing}>
                                    <RefreshCw size={16} /> Kéo về
                                </button>
                            </div>

                            <button className="btn settings-disconnect" style={{ marginTop: 8 }} onClick={handlePbLogout}>
                                <LogOut size={16} /> Đăng xuất
                            </button>
                        </div>
                    ) : (
                        <div className="gdrive-setup">
                            <div className="gdrive-info">
                                <RefreshCw size={32} color="#6366f1" />
                                <p>Đăng nhập để đồng bộ mặt bằng giữa các thiết bị</p>
                            </div>

                            <div className="settings-input-group">
                                <label>Email</label>
                                <input type="email" value={pbEmail} onChange={e => setPbEmail(e.target.value)} placeholder="your@email.com" className="settings-input" />
                            </div>
                            <div className="settings-input-group" style={{ marginTop: 8 }}>
                                <label>Mật khẩu</label>
                                <input type="password" value={pbPassword} onChange={e => setPbPassword(e.target.value)} placeholder="••••••••" className="settings-input"
                                    onKeyDown={e => { if (e.key === 'Enter') handlePbLogin(); }} />
                            </div>

                            {pbError && <div className="settings-error"><AlertCircle size={14} /> {pbError}</div>}

                            <button className="btn btn-primary settings-connect-btn" onClick={handlePbLogin} disabled={pbSyncing}>
                                <LogIn size={18} /> {pbSyncing ? 'Đang đăng nhập...' : 'Đăng nhập'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Google Drive Section */}
                <div className="settings-section">
                    <div className="settings-section-header">
                        <HardDrive size={20} color="#4285f4" />
                        <h3>Google Drive</h3>
                    </div>

                    {connected ? (
                        <div className="gdrive-connected">
                            <div className="gdrive-status">
                                <CheckCircle size={20} color="#22c55e" />
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 14 }}>Đã kết nối</div>
                                    {userInfo && <div style={{ fontSize: 12, color: '#94a3b8' }}>{userInfo.email}</div>}
                                </div>
                            </div>

                            <div className="settings-item" onClick={toggleAutoUpload}>
                                <div>
                                    <div style={{ fontWeight: 500, fontSize: 14 }}>Tự động lưu lên Drive</div>
                                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Tự động upload khi xuất ảnh</div>
                                </div>
                                <div className={`toggle ${autoUpload ? 'active' : ''}`}>
                                    <div className="toggle-knob" />
                                </div>
                            </div>

                            <div className="settings-item" style={{ color: '#94a3b8', fontSize: 12 }}>
                                <Cloud size={16} />
                                <span>Ảnh sẽ lưu vào thư mục <strong>MKG-Dim</strong> trên Google Drive</span>
                            </div>

                            <button className="btn settings-disconnect" onClick={handleDisconnect}>
                                <CloudOff size={16} /> Ngắt kết nối
                            </button>
                        </div>
                    ) : (
                        <div className="gdrive-setup">
                            <div className="gdrive-info">
                                <Cloud size={32} color="#4285f4" />
                                <p>Kết nối Google Drive để tự động lưu ảnh lên cloud</p>
                            </div>

                            <div className="settings-input-group">
                                <label>Google Client ID</label>
                                <input
                                    type="text"
                                    value={clientId}
                                    onChange={e => setClientId(e.target.value)}
                                    placeholder="xxxx.apps.googleusercontent.com"
                                    className="settings-input"
                                />
                                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="settings-help-link">
                                    <ExternalLink size={12} /> Lấy Client ID từ Google Cloud Console
                                </a>
                            </div>

                            {error && (
                                <div className="settings-error">
                                    <AlertCircle size={14} /> {error}
                                </div>
                            )}

                            <button className="btn btn-primary settings-connect-btn" onClick={handleConnect} disabled={connecting}>
                                <HardDrive size={18} /> {connecting ? 'Đang kết nối...' : 'Kết nối Google Drive'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="settings-section">
                    <div className="settings-section-header">
                        <Settings2 size={20} color="#64748b" />
                        <h3>Thông tin</h3>
                    </div>
                    <div className="settings-item" style={{ fontSize: 13, color: '#64748b' }}>
                        <span>Phiên bản: <strong>1.1.0</strong></span>
                    </div>
                    <div className="settings-item" style={{ fontSize: 13, color: '#64748b' }}>
                        <span>MKG - Dim © 2025</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
