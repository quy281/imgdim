import React, { useState } from 'react';
import { CloudUpload, FolderOpen, LogOut, Plus, Send, UserRoundCheck } from 'lucide-react';
import TextSheet from '../ui/TextSheet';
import Confirm from '../ui/Confirm';

const fmtTime = (ts) => ts ? new Date(ts).toLocaleString('vi-VN') : '';

export default function CustomerHomeScreen({ projects, account, onOpen, onCreate, onSubmit, onLogout, submittingId }) {
    const [textSheet, setTextSheet] = useState(null);
    const [confirm, setConfirm] = useState(null);

    return (
        <div className="screen">
            <div className="hdr">
                <div className="brand">
                    <img src="/icon.svg" alt="MKG" />
                    <div style={{ minWidth: 0 }}>
                        <h1>Khảo sát cho khách</h1>
                        <div className="hdr-sub">{account?.name || account?.username || account?.email}</div>
                    </div>
                </div>
                <button className="icon-btn" onClick={onLogout} aria-label="Đăng xuất"><LogOut size={20} /></button>
            </div>

            <div className="scroll-body">
                <div style={{ padding: 12, borderRadius: 12, background: 'var(--blue-soft)', color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
                    <UserRoundCheck size={17} style={{ color: 'var(--blue)', verticalAlign: 'middle', marginRight: 7 }} />
                    Dữ liệu tự lưu trên điện thoại. Khi hoàn tất, bấm <b>Gửi cho nhân viên</b> và chờ thông báo thành công.
                </div>

                <button className="btn btn-primary btn-block" style={{ height: 50, marginBottom: 16 }} onClick={() => setTextSheet({
                    title: 'Công trình cần khảo sát', label: 'Tên hoặc địa chỉ công trình',
                    placeholder: 'VD: Nhà anh Minh — 25 Nguyễn Huệ', onOK: onCreate,
                })}>
                    <Plus size={19} /> Tạo bản khảo sát mới
                </button>

                {projects.length === 0 ? (
                    <div className="empty">
                        <FolderOpen size={50} />
                        <h3>Chưa có bản khảo sát</h3>
                        <p>Tạo công trình, thêm mặt bằng hoặc ảnh rồi gửi cho nhân viên MKG.</p>
                    </div>
                ) : projects.map(p => (
                    <div key={p.id} className="card project-card" style={{ display: 'block' }}>
                        <div onClick={() => onOpen(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                            <div className="project-icon"><FolderOpen size={23} /></div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="project-name">{p.name}</div>
                                <div className="project-meta">
                                    {p.customerSubmittedAt ? `Đã gửi ${fmtTime(p.customerSubmittedAt)}` : 'Bản nháp trên điện thoại'}
                                </div>
                            </div>
                        </div>
                        <button className="btn btn-block" style={{ marginTop: 12 }} disabled={submittingId === p.id}
                            onClick={() => setConfirm({
                                title: p.customerSubmittedAt ? 'Gửi phiên bản cập nhật?' : 'Gửi dữ liệu cho nhân viên?',
                                message: 'Hệ thống sẽ gửi toàn bộ mặt bằng và ảnh của công trình này tới đội phụ trách. Bản trên điện thoại vẫn được giữ nguyên.',
                                actionLabel: p.customerSubmittedAt ? 'Gửi cập nhật' : 'Gửi dữ liệu',
                                onOK: () => onSubmit(p),
                            })}>
                            {submittingId === p.id ? <CloudUpload size={17} className="spin" /> : <Send size={17} />}
                            {submittingId === p.id ? 'Đang gửi...' : p.customerSubmittedAt ? 'Gửi bản cập nhật' : 'Gửi cho nhân viên'}
                        </button>
                    </div>
                ))}
            </div>

            <TextSheet cfg={textSheet} onClose={() => setTextSheet(null)} />
            <Confirm cfg={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
