import React, { useState, useEffect } from 'react';
import { ArrowLeft, CloudOff, Cloud, HardDrive, CheckCircle, AlertCircle, Settings2, ExternalLink } from 'lucide-react';
import * as GDrive from '../googleDriveService';

export default function SettingsPage({ onBack, onGDriveChange }) {
    const [clientId, setClientId] = useState(localStorage.getItem('gdrive_client_id') || '');
    const [connected, setConnected] = useState(GDrive.isConnected());
    const [userInfo, setUserInfo] = useState(null);
    const [connecting, setConnecting] = useState(false);
    const [error, setError] = useState('');
    const [autoUpload, setAutoUpload] = useState(localStorage.getItem('gdrive_auto_upload') === 'true');

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

    return (
        <div className="settings-page">
            <div className="settings-header">
                <button className="btn btn-icon" onClick={onBack} style={{ padding: 4 }}><ArrowLeft size={20} /></button>
                <h2 style={{ margin: 0, fontSize: 18 }}>Cài đặt</h2>
            </div>

            <div className="settings-content">
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
                        <span>Phiên bản: <strong>1.0.0</strong></span>
                    </div>
                    <div className="settings-item" style={{ fontSize: 13, color: '#64748b' }}>
                        <span>MKG - Dim © 2024</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
