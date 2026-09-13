import React, { useState } from 'react';
import { KeyRound, LogIn, ShieldCheck } from 'lucide-react';

export default function CustomerLoginScreen({ onLogin, wrongAccount, onLogout }) {
    const [identity, setIdentity] = useState('');
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        e?.preventDefault();
        if (!identity.trim() || !pin || busy) return;
        setBusy(true);
        setError('');
        try { await onLogin(identity.trim(), pin); }
        catch (err) { setError(err.message || 'Không đăng nhập được'); }
        finally { setBusy(false); }
    };

    return (
        <div className="screen">
            <div className="scroll-body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100%' }}>
                <div style={{ textAlign: 'center', marginBottom: 24 }}>
                    <img src="/icon.svg" alt="MKG" style={{ width: 72, height: 72, borderRadius: 18 }} />
                    <h1 style={{ margin: '12px 0 4px' }}>Khách hàng tự khảo sát</h1>
                    <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                        Đo mặt bằng, chụp hiện trạng và gửi trực tiếp cho đội phụ trách
                    </div>
                </div>

                <form className="card" onSubmit={submit} style={{ padding: 18 }}>
                    {wrongAccount && (
                        <div style={{ padding: 10, borderRadius: 10, background: 'var(--warn-soft)', marginBottom: 12, fontSize: 13 }}>
                            Bạn đang đăng nhập tài khoản nhân viên. Hãy đăng xuất trước khi vào cổng khách hàng.
                            <button type="button" className="btn btn-block" style={{ marginTop: 8 }} onClick={onLogout}>Đăng xuất tài khoản hiện tại</button>
                        </div>
                    )}
                    <div className="field">
                        <label>Số điện thoại hoặc tài khoản</label>
                        <input type="text" autoComplete="username" value={identity} placeholder="0901234567"
                            onChange={e => setIdentity(e.target.value)} disabled={wrongAccount} />
                    </div>
                    <div className="field">
                        <label>Mã PIN</label>
                        <div style={{ position: 'relative' }}>
                            <KeyRound size={17} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--muted)' }} />
                            <input type="password" inputMode="numeric" autoComplete="current-password" value={pin}
                                placeholder="••••" onChange={e => setPin(e.target.value)} disabled={wrongAccount}
                                style={{ paddingLeft: 38 }} />
                        </div>
                    </div>
                    {error && <div style={{ color: 'var(--red-dark)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
                    <button className="btn btn-primary btn-block" type="submit" disabled={busy || wrongAccount || !identity.trim() || !pin}>
                        <LogIn size={17} /> {busy ? 'Đang đăng nhập...' : 'Đăng nhập để bắt đầu'}
                    </button>
                </form>

                <div style={{ display: 'flex', gap: 7, justifyContent: 'center', alignItems: 'center', marginTop: 16, color: 'var(--muted)', fontSize: 12.5 }}>
                    <ShieldCheck size={15} /> Bạn chỉ nhìn thấy dữ liệu của chính mình
                </div>
            </div>
        </div>
    );
}
