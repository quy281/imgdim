import React, { useState, useEffect } from 'react';
import { ArrowLeft, CloudOff, Cloud, HardDrive, CheckCircle, AlertCircle, Settings2, ExternalLink, Trash2 } from 'lucide-react';
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
        if (!clientId.trim()) { setError('Vui l\u00f2ng nh\u1eadp Google Client ID'); return; }
        setError('');
        setConnecting(true);
        try {
            await GDrive.connect(clientId.trim());
            setConnected(true);
            const info = await GDrive.getUserInfo();
            setUserInfo(info);
            onGDriveChange?.(true);
        } catch (err) {
            setError('K\u1ebft n\u1ed1i th\u1ea5t b\u1ea1i: ' + err.message);
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
                <h2 style={{ margin: 0, fontSize: 18 }}>C\u00e0i \u0111\u1eb7t</h2>
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
                                    <div style={{ fontWeight: 600, fontSize: 14 }}>\u0110\u00e3 k\u1ebft n\u1ed1i</div>
                                    {userInfo && <div style={{ fontSize: 12, color: '#94a3b8' }}>{userInfo.email}</div>}
                                </div>
                            </div>

                            <div className="settings-item" onClick={toggleAutoUpload}>
                                <div>
                                    <div style={{ fontWeight: 500, fontSize: 14 }}>T\u1ef1 \u0111\u1ed9ng l\u01b0u l\u00ean Drive</div>
                                    <div style={{ fontSize: 12, color: '#94a3b8' }}>T\u1ef1 \u0111\u1ed9ng upload khi xu\u1ea5t \u1ea3nh</div>
                                </div>
                                <div className={`toggle ${autoUpload ? 'active' : ''}`}>
                                    <div className="toggle-knob" />
                                </div>
                            </div>

                            <div className="settings-item" style={{ color: '#94a3b8', fontSize: 12 }}>
                                <Cloud size={16} />
                                <span>\u1ea2nh s\u1ebd l\u01b0u v\u00e0o th\u01b0 m\u1ee5c <strong>MKG-Dim</strong> tr\u00ean Google Drive</span>
                            </div>

                            <button className="btn settings-disconnect" onClick={handleDisconnect}>
                                <CloudOff size={16} /> Ng\u1eaft k\u1ebft n\u1ed1i
                            </button>
                        </div>
                    ) : (
                        <div className="gdrive-setup">
                            <div className="gdrive-info">
                                <Cloud size={32} color="#4285f4" />
                                <p>K\u1ebft n\u1ed1i Google Drive \u0111\u1ec3 t\u1ef1 \u0111\u1ed9ng l\u01b0u \u1ea3nh l\u00ean cloud</p>
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
                                    <ExternalLink size={12} /> L\u1ea5y Client ID t\u1eeb Google Cloud Console
                                </a>
                            </div>

                            {error && (
                                <div className="settings-error">
                                    <AlertCircle size={14} /> {error}
                                </div>
                            )}

                            <button className="btn btn-primary settings-connect-btn" onClick={handleConnect} disabled={connecting}>
                                <HardDrive size={18} /> {connecting ? '\u0110ang k\u1ebft n\u1ed1i...' : 'K\u1ebft n\u1ed1i Google Drive'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="settings-section">
                    <div className="settings-section-header">
                        <Settings2 size={20} color="#64748b" />
                        <h3>Th\u00f4ng tin</h3>
                    </div>
                    <div className="settings-item" style={{ fontSize: 13, color: '#64748b' }}>
                        <span>Phi\u00ean b\u1ea3n: <strong>1.0.0</strong></span>
                    </div>
                    <div className="settings-item" style={{ fontSize: 13, color: '#64748b' }}>
                        <span>MKG - Dim \u00a9 2024</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
