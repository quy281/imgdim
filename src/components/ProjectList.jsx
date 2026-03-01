import React, { useState } from 'react';
import { FolderPlus, FolderOpen, Trash2, Edit3, Camera } from 'lucide-react';

export default function ProjectList({ projects, onOpenProject, onCreateProject, onDeleteProject, onRenameProject }) {
    const [newName, setNewName] = useState('');

    const handleCreate = () => {
        const name = newName.trim() || `Dự án ${new Date().toLocaleDateString('vi-VN')}`;
        onCreateProject(name);
        setNewName('');
    };

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
                <button className="btn btn-primary" onClick={handleCreate}>
                    <FolderPlus size={18} /> Tạo mới
                </button>
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
