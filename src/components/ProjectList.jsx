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
        const name = newName.trim() || `D\u1ef1 \u00e1n ${new Date().toLocaleDateString('vi-VN')}`;
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
                        <p>Qu\u1ea3n l\u00fd d\u1ef1 \u00e1n \u0111o k\u00edch th\u01b0\u1edbc</p>
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
                    placeholder="T\u00ean d\u1ef1 \u00e1n m\u1edbi..."
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                    className="project-input"
                />
                <button className="btn btn-primary" onClick={handleCreate} style={isAtLimit ? { background: '#94a3b8' } : {}}>
                    {isAtLimit ? <><Crown size={18} /> N\u00e2ng c\u1ea5p</> : <><FolderPlus size={18} /> T\u1ea1o m\u1edbi</>}
                </button>
                {isAtLimit && <div style={{ fontSize: 11, color: '#ef4444', whiteSpace: 'nowrap' }}>{projects.length}/{maxProjects} d\u1ef1 \u00e1n</div>}
            </div>

            {projects.length === 0 ? (
                <div className="project-empty">
                    <Camera size={48} style={{ color: '#94a3b8', marginBottom: 10 }} />
                    <p>Ch\u01b0a c\u00f3 d\u1ef1 \u00e1n n\u00e0o</p>
                    <p style={{ fontSize: 13, color: '#94a3b8' }}>T\u1ea1o d\u1ef1 \u00e1n m\u1edbi \u0111\u1ec3 b\u1eaft \u0111\u1ea7u ch\u1ee5p v\u00e0 ghi k\u00edch th\u01b0\u1edbc</p>
                </div>
            ) : (
                <div className="project-grid">
                    {projects.map(p => (
                        <div key={p.id} className="project-card" onClick={() => onOpenProject(p.id)}>
                            <div className="project-card-icon"><FolderOpen size={32} /></div>
                            <div className="project-card-info">
                                <div className="project-card-name">{p.name}</div>
                                <div className="project-card-date">{new Date(p.createdAt).toLocaleDateString('vi-VN')}</div>
                                {p.docCount > 0 && <div className="project-card-count">{p.docCount} \u1ea3nh</div>}
                            </div>
                            <div className="project-card-actions" onClick={e => e.stopPropagation()}>
                                <button className="btn btn-icon btn-sm" onClick={() => {
                                    const n = prompt('\u0110\u1ed5i t\u00ean d\u1ef1 \u00e1n:', p.name);
                                    if (n && n.trim()) onRenameProject(p.id, n.trim());
                                }} title="\u0110\u1ed5i t\u00ean"><Edit3 size={14} /></button>
                                <button className="btn btn-icon btn-sm btn-danger" onClick={() => {
                                    if (confirm(`X\u00f3a d\u1ef1 \u00e1n "${p.name}"?`)) onDeleteProject(p.id);
                                }} title="X\u00f3a"><Trash2 size={14} /></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
