import React, { useState } from 'react';
import { FolderPlus, FolderOpen, Trash2, Edit3, Camera, Crown, User, Settings } from 'lucide-react';

export default function ProjectList({ projects, onOpenProject, onCreateProject, onDeleteProject, onRenameProject, onShowPricing, currentTier, maxProjects, onShowAuth, user, onShowSettings }) {
    const [newName, setNewName] = useState('');
    const isAtLimit = projects.length >= maxProjects;

    const handleCreate = () => {
        if (isAtLimit) {
            onShowPricing?.();
            return;
        }
        const name = newName.trim() || `Dự án ${new Date().toLocaleDateString('vi-VN')}`;
        onCreateProject(name);
        setNewName('');
    };

    const tierBadge = {
        free: { label: 'Free', color: '#64748b', bg: '#f1f5f9' },
        pro: { label: 'Pro', color: '#2563eb', bg: '#eff6ff' },
        ultra: { label: 'Ultra', color: '#9333ea', bg: '#faf5ff' },
    };
    const badge = tierBadge[currentTier] || tierBadge.free;

    return (
        <div className="project-list-page">
            <div className="project-header">
                <div className="project-header-left">
                    <img src="/img/mkg-dim-icon.png" alt="logo" className="project-logo" />
                    <div>
                        <h1>MKG - Dim</h1>
                        <p>Quản lý dự án đo kích thước</p>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className="btn btn-icon" onClick={onShowSettings}
                        style={{ padding: 6, borderRadius: '50%', background: '#f1f5f9', border: '1px solid #e2e8f0', width: 36, height: 36, minWidth: 36, minHeight: 36 }}>
                        <Settings size={18} color="#64748b" />
                    </button>
                    <button className="btn" onClick={onShowPricing}
                        style={{ padding: '6px 12px', background: badge.bg, color: badge.color, border: `1px solid ${badge.color}33`, fontWeight: 600, fontSize: 12, borderRadius: 20 }}>
                        <Crown size={14} /> {badge.label}
                    </button>
                    <button className="btn btn-icon" onClick={onShowAuth}
                        style={{ padding: 6, borderRadius: '50%', background: user ? '#dbeafe' : '#f1f5f9', border: '1px solid #e2e8f0', width: 36, height: 36, minWidth: 36, minHeight: 36 }}>
                        {user ? <span style={{ fontWeight: 700, fontSize: 14, color: '#2563eb' }}>{user.name?.charAt(0).toUpperCase()}</span> : <User size={18} color="#94a3b8" />}
                    </button>
                </div>
            </div>

            <div className="project-create-bar">
                <input
                    type="text"
                    placeholder="Tên dự án mới..."
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                    className="project-input"
                />
                <button className="btn btn-primary" onClick={handleCreate} style={isAtLimit ? { background: '#94a3b8' } : {}}>
                    {isAtLimit ? <><Crown size={18} /> Nâng cấp</> : <><FolderPlus size={18} /> Tạo mới</>}
                </button>
                {isAtLimit && <div style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'nowrap' }}>{projects.length}/{maxProjects} dự án</div>}
            </div>

            {projects.length === 0 ? (
                <div className="project-empty">
                    <Camera size={48} style={{ color: '#94a3b8', marginBottom: 10 }} />
                    <p>Chưa có dự án nào</p>
                    <p style={{ fontSize: 13, color: '#94a3b8' }}>Tạo dự án mới để bắt đầu chụp và ghi kích thước</p>
                </div>
            ) : (
                <div className="project-grid">
                    {projects.map(p => (
                        <div key={p.id} className="project-card" onClick={() => onOpenProject(p.id)}>
                            <div className="project-card-icon"><FolderOpen size={32} /></div>
                            <div className="project-card-info">
                                <div className="project-card-name">{p.name}</div>
                                <div className="project-card-date">{new Date(p.createdAt).toLocaleDateString('vi-VN')}</div>
                                {p.docCount > 0 && <div className="project-card-count">{p.docCount} ảnh</div>}
                            </div>
                            <div className="project-card-actions" onClick={e => e.stopPropagation()}>
                                <button className="btn btn-icon btn-sm" onClick={() => {
                                    const n = prompt('Đổi tên dự án:', p.name);
                                    if (n && n.trim()) onRenameProject(p.id, n.trim());
                                }} title="Đổi tên"><Edit3 size={14} /></button>
                                <button className="btn btn-icon btn-sm btn-danger" onClick={() => {
                                    if (confirm(`Xóa dự án "${p.name}"?`)) onDeleteProject(p.id);
                                }} title="Xóa"><Trash2 size={14} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
