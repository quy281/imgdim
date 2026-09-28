import React, { useState, useRef } from 'react';
import {
    ArrowLeft, Camera, Images, PencilRuler, MoreVertical, Pencil, Trash2, FileText,
    PackageOpen,
} from 'lucide-react';
import Sheet from '../ui/Sheet';
import TextSheet from '../ui/TextSheet';
import Confirm from '../ui/Confirm';
import ServiceBanner from '../ui/ServiceBanner';
import ExperiencePreview from '../ui/ExperiencePreview';

export default function ProjectScreen({ project, docs, onBack, onOpenDoc, onCreatePlan, onCreateBoard, onImportPhotos, onRenameProject, onRenameDoc, onDeleteDoc, onOpenExperience }) {
    const [filter, setFilter] = useState('all');
    const [menuFor, setMenuFor] = useState(null); // doc object
    const [textSheet, setTextSheet] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const cameraRef = useRef(null);
    const galleryRef = useRef(null);

    const shown = docs.filter(d => filter === 'all' || d.type === filter);
    const plans = docs.filter(d => d.type === 'plan').length;
    const photos = docs.filter(d => d.type === 'photo').length;
    const boards = docs.filter(d => d.type === 'board').length;
    const fmtPrice = (v) => Number(v || 0).toLocaleString('vi-VN') + 'đ';

    const pickFiles = async (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        if (files.length) await onImportPhotos(files);
    };

    return (
        <div className="screen">
            <div className="hdr">
                <button className="icon-btn" onClick={onBack}><ArrowLeft size={22} /></button>
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => setTextSheet({
                    title: 'Đổi tên dự án', initial: project.name, onOK: (name) => onRenameProject(project.id, name),
                })}>
                    <div className="hdr-title">{project.name}</div>
                    <div className="hdr-sub">{plans} mặt bằng · {photos} ảnh · {boards} ván</div>
                </div>
            </div>

            <div className="scroll-body">
                <div className="chip-row">
                    <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Tất cả</button>
                    <button className={`chip ${filter === 'plan' ? 'on' : ''}`} onClick={() => setFilter('plan')}>Mặt bằng</button>
                    <button className={`chip ${filter === 'photo' ? 'on' : ''}`} onClick={() => setFilter('photo')}>Ảnh</button>
                    <button className={`chip ${filter === 'board' ? 'on' : ''}`} onClick={() => setFilter('board')}>Ván tồn</button>
                </div>

                {shown.length === 0 ? (
                    <div className="empty">
                        <FileText size={52} />
                        <h3>{docs.length === 0 ? 'Bắt đầu khảo sát' : 'Không có mục nào'}</h3>
                        <p>Chụp ảnh hiện trạng, vẽ mặt bằng hoặc đo ván tồn bằng các nút bên dưới</p>
                    </div>
                ) : (
                    <div className="doc-grid">
                        {shown.map(d => (
                            <div key={d.id} className="doc-card" onClick={() => onOpenDoc(d)}>
                                {d.thumb
                                    ? <img className="doc-thumb" src={d.thumb} alt={d.name} />
                                    : <div className="doc-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
                                        {d.type === 'plan' ? <PencilRuler size={30} /> : d.type === 'board' ? <PackageOpen size={30} /> : <Images size={30} />}
                                    </div>}
                                <div className="doc-type-badge">{d.type === 'plan' ? '📐 MB' : d.type === 'board' ? '📦 Ván' : '📷'}</div>
                                {d.type === 'board' && d.board?.market?.listed && (
                                    <div className="doc-market-badge">
                                        Kho bán · {fmtPrice(d.board.market.price)}
                                    </div>
                                )}
                                <button className="doc-kebab" onClick={(e) => { e.stopPropagation(); setMenuFor(d); }}>
                                    <MoreVertical size={16} />
                                </button>
                                <div className="doc-card-name">{d.name}</div>
                            </div>
                        ))}
                    </div>
                )}

                <ExperiencePreview compact onOpenExperience={onOpenExperience} />
                <ServiceBanner compact />
            </div>

            <div className="bottom-bar">
                <div className="btn btn-primary file-btn" onClick={() => cameraRef.current?.click()}>
                    <Camera size={19} /> Chụp
                    <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={pickFiles} onClick={e => e.stopPropagation()} />
                </div>
                <div className="btn file-btn" onClick={() => galleryRef.current?.click()}>
                    <Images size={19} /> Thư viện
                    <input ref={galleryRef} type="file" accept="image/*" multiple onChange={pickFiles} onClick={e => e.stopPropagation()} />
                </div>
                <button className="btn" style={{ borderColor: '#f5c6c4', color: 'var(--red-dark)', background: 'var(--red-soft)' }} onClick={onCreatePlan}>
                    <PencilRuler size={19} /> Mặt bằng
                </button>
                <button className="btn" style={{ borderColor: '#bfdbfe', color: 'var(--blue)', background: 'var(--blue-soft)' }} onClick={onCreateBoard}>
                    <PackageOpen size={19} /> Ván tồn
                </button>
            </div>

            {/* Per-doc menu */}
            <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name}>
                <button className="sheet-row" onClick={() => {
                    const d = menuFor;
                    setMenuFor(null);
                    setTextSheet({ title: 'Đổi tên', initial: d.name, onOK: (name) => onRenameDoc(d.id, name) });
                }}>
                    <Pencil size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Đổi tên</div>
                </button>
                <button className="sheet-row" style={{ color: '#dc2626' }} onClick={() => {
                    const d = menuFor;
                    setMenuFor(null);
                    setConfirm({
                        title: `Xóa "${d.name}"?`,
                        actionLabel: 'Xóa',
                        onOK: () => onDeleteDoc(d.id),
                    });
                }}>
                    <Trash2 size={19} />
                    <div style={{ flex: 1 }}>Xóa</div>
                </button>
            </Sheet>

            <TextSheet cfg={textSheet} onClose={() => setTextSheet(null)} />
            <Confirm cfg={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
