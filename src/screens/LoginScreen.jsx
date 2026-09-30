import React, { useState } from 'react';
import { KeyRound, LogIn, PackageOpen, Ruler, ShieldCheck, Store } from 'lucide-react';

export default function LoginScreen({ onLogin }) {
    const [identity, setIdentity] = useState('');
    const [secret, setSecret] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        e?.preventDefault();
        if (!identity.trim() || !secret || busy) return;
        setBusy(true);
        setError('');
        try {
            await onLogin(identity.trim(), secret);
        } catch (err) {
            setError(err.message || 'Không đăng nhập được');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="screen">
            <div className="scroll-body" style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                minHeight: '100%',
                gap: 16,
            }}>
                <div style={{ textAlign: 'center' }}>
                    <img src="/icon.svg" alt="MKG" style={{ width: 76, height: 76, borderRadius: 18 }} />
                    <h1 style={{ margin: '12px 0 4px', fontSize: 26 }}>MKG Khảo Sát</h1>
                    <div style={{ color: 'var(--muted)', fontSize: 14, maxWidth: 330, margin: '0 auto' }}>
                        Đăng nhập để sử dụng khảo sát, quản lý ván và sàn trao đổi ván dư
                    </div>
                </div>

                <form className="card" onSubmit={submit} style={{ padding: 18 }}>
                    <div className="field">
                        <label>Tài khoản</label>
                        <input
                            type="text"
                            autoComplete="username"
                            autoFocus
                            value={identity}
                            placeholder="Số điện thoại, email hoặc username"
                            onChange={e => setIdentity(e.target.value)}
                        />
                    </div>
                    <div className="field">
                        <label>PIN hoặc mật khẩu</label>
                        <div style={{ position: 'relative' }}>
                            <KeyRound size={17} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
                            <input
                                type="password"
                                autoComplete="current-password"
                                value={secret}
                                placeholder="Nhập PIN hoặc mật khẩu"
                                onChange={e => setSecret(e.target.value)}
                                style={{ paddingLeft: 38 }}
                            />
                        </div>
                    </div>
                    {error && <div style={{ color: 'var(--red-dark)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
                    <button className="btn btn-primary btn-block" type="submit" disabled={busy || !identity.trim() || !secret}>
                        <LogIn size={17} /> {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
                    </button>
                    <div style={{ display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center', marginTop: 12, color: 'var(--muted)', fontSize: 12.5 }}>
                        <ShieldCheck size={15} /> Bắt buộc đăng nhập trước khi dùng app
                    </div>
                </form>

                <div className="card" style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    <Feature icon={<Ruler size={18} />} label="Khảo sát" />
                    <Feature icon={<PackageOpen size={18} />} label="Quản lý ván" />
                    <Feature icon={<Store size={18} />} label="Sàn ván dư" />
                </div>

                <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
                    Chưa có tài khoản? Liên hệ quản trị MKG để được cấp PIN.
                </div>
            </div>
        </div>
    );
}

function Feature({ icon, label }) {
    return (
        <div style={{
            minHeight: 64,
            border: '1px solid var(--line)',
            borderRadius: 13,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: 'var(--ink-2)',
            fontSize: 12.5,
            fontWeight: 700,
            textAlign: 'center',
        }}>
            <div style={{ color: 'var(--red-dark)' }}>{icon}</div>
            <div>{label}</div>
        </div>
    );
}
