import React, { useState } from 'react';
import { ArrowLeft, Mail, Lock, User, Eye, EyeOff, Crown, LogOut } from 'lucide-react';

export default function AuthPage({ onBack, user, onLogin, onLogout, currentTier }) {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!email.trim() || !password.trim()) { setError('Vui lòng nhập đầy đủ thông tin'); return; }
        if (!isLogin && !name.trim()) { setError('Vui lòng nhập tên'); return; }

        setLoading(true);
        // Simulate auth (replace with real Supabase/Firebase auth)
        await new Promise(r => setTimeout(r, 800));

        const userData = {
            id: Date.now(),
            email: email.trim(),
            name: isLogin ? email.split('@')[0] : name.trim(),
            createdAt: Date.now(),
        };
        onLogin(userData);
        setLoading(false);
    };

    // Already logged in - show profile
    if (user) {
        const tierBadge = {
            free: { label: 'Free', color: '#64748b', bg: '#f1f5f9', icon: '🆓' },
            pro: { label: 'Pro', color: '#2563eb', bg: '#eff6ff', icon: '⭐' },
            ultra: { label: 'Ultra', color: '#9333ea', bg: '#faf5ff', icon: '🚀' },
        };
        const badge = tierBadge[currentTier] || tierBadge.free;

        return (
            <div className="auth-page">
                <div className="auth-header">
                    <button className="btn btn-icon" onClick={onBack} style={{ padding: 4 }}><ArrowLeft size={20} /></button>
                    <h2 style={{ margin: 0, fontSize: 18 }}>Tài khoản</h2>
                </div>
                <div className="auth-profile">
                    <div className="auth-avatar">{user.name?.charAt(0).toUpperCase() || '?'}</div>
                    <h3 style={{ margin: '10px 0 4px', fontSize: 20 }}>{user.name}</h3>
                    <p style={{ margin: 0, color: '#94a3b8', fontSize: 14 }}>{user.email}</p>
                    <div style={{ marginTop: 12, padding: '6px 16px', background: badge.bg, color: badge.color, borderRadius: 20, fontWeight: 600, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Crown size={14} /> {badge.icon} Gói {badge.label}
                    </div>
                    <div className="auth-actions">
                        <button className="btn auth-btn-logout" onClick={onLogout}>
                            <LogOut size={18} /> Đăng xuất
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-page">
            <div className="auth-header">
                <button className="btn btn-icon" onClick={onBack} style={{ padding: 4 }}><ArrowLeft size={20} /></button>
                <h2 style={{ margin: 0, fontSize: 18 }}>{isLogin ? 'Đăng nhập' : 'Đăng ký'}</h2>
            </div>

            <div className="auth-form-container">
                <div className="auth-logo">
                    <img src="/img/mkg-dim-icon.png" alt="logo" style={{ width: 60, height: 60, borderRadius: 14 }} />
                    <h2 style={{ margin: '10px 0 4px', fontSize: 22 }}>MKG - Dim</h2>
                    <p style={{ margin: 0, color: '#94a3b8', fontSize: 13 }}>{isLogin ? 'Đăng nhập để đồng bộ dữ liệu' : 'Tạo tài khoản mới'}</p>
                </div>

                <form className="auth-form" onSubmit={handleSubmit}>
                    {!isLogin && (
                        <div className="auth-field">
                            <User size={18} className="auth-field-icon" />
                            <input type="text" placeholder="Họ tên" value={name} onChange={e => setName(e.target.value)} />
                        </div>
                    )}
                    <div className="auth-field">
                        <Mail size={18} className="auth-field-icon" />
                        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                    </div>
                    <div className="auth-field">
                        <Lock size={18} className="auth-field-icon" />
                        <input type={showPassword ? 'text' : 'password'} placeholder="Mật khẩu" value={password} onChange={e => setPassword(e.target.value)} />
                        <button type="button" className="auth-eye" onClick={() => setShowPassword(!showPassword)}>
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>

                    {error && <div className="auth-error">{error}</div>}

                    <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
                        {loading ? 'Đang xử lý...' : (isLogin ? 'Đăng nhập' : 'Đăng ký')}
                    </button>
                </form>

                <div className="auth-switch">
                    {isLogin ? (
                        <p>Chưa có tài khoản? <button onClick={() => { setIsLogin(false); setError(''); }}>Đăng ký ngay</button></p>
                    ) : (
                        <p>Đã có tài khoản? <button onClick={() => { setIsLogin(true); setError(''); }}>Đăng nhập</button></p>
                    )}
                </div>
            </div>
        </div>
    );
}
