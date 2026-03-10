import React, { useState, useEffect } from 'react';
import { ArrowLeft, CloudOff, Cloud, HardDrive, CheckCircle, Settings2 } from 'lucide-react';
import * as GDrive from '../googleDriveService';

export default function SettingsPage({ onBack }) {
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
        setError('');
        setConnecting(true);
        try {
            await GDrive.connect();
            setConnected(true);
            const info = await GDrive.getUserInfo();
            setUserInfo(info);
            // Auto-enable upload on connect
            setAutoUpload(true);
            localStorage.setItem('gdrive_auto_upload', 'true');
        } catch (err) {
            setError('Kết nối thất bại: ' + err.message);
        }
        setConnecting(false);
    };

    const handleDisconnect = () => {
        GDrive.disconnect();
        setConnected(false);
        setUserInfo(null);
        setAutoUpload(false);
        localStorage.setItem('gdrive_auto_upload', 'false');
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
                                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Upload ảnh khi thêm vào dự án</div>
                                </div>
                                <div className={`toggle ${autoUpload ? 'active' : ''}`}>
                                    <div className="toggle-knob" />
                                </div>
                            </div>

                            <div className="settings-item" style={{ color: '#94a3b8', fontSize: 12, cursor: 'default' }}>
                                <Cloud size={16} />
                                <span>Ảnh lưu vào thư mục <strong>MKG-Dim</strong> trên Google Drive</span>
                            </div>

                            <button className="btn settings-disconnect" onClick={handleDisconnect}>
                                <CloudOff size={16} /> Ngắt kết nối
                            </button>
                        </div>
                    ) : (
                        <div className="gdrive-setup">
                            <div className="gdrive-info">
                                <Cloud size={40} color="#4285f4" />
                                <p style={{ fontSize: 14, marginTop: 12 }}>Sao lưu ảnh tự động lên Google Drive</p>
                                <p style={{ fontSize: 12, color: '#94a3b8' }}>Ảnh sẽ được lưu an toàn trên cloud</p>
                            </div>

                            {error && (
                                <div className="settings-error">
                                    {error}
                                </div>
                            )}

                            <button className="btn btn-primary settings-connect-btn" onClick={handleConnect} disabled={connecting}>
                                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" style={{ width: 20, height: 20 }} />
                                {connecting ? 'Đang kết nối...' : 'Kết nối Google Drive'}
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
                    <div className="settings-item" style={{ fontSize: 13, color: '#64748b', cursor: 'default' }}>
                        <span>Phiên bản: <strong>1.0.0</strong></span>
                    </div>
                    <div className="settings-item" style={{ fontSize: 13, color: '#64748b', cursor: 'default' }}>
                        <span>MKG - Dim © 2024</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
