import React, { useEffect, useState, useCallback } from 'react';
import { X, Download, Share2, Printer, FileCode2, RefreshCw } from 'lucide-react';
import { renderPlanLayoutCanvas, printLayoutDataURL } from '../lib/layoutExport';
import { captureRoom3DDataURL } from './Room3DView';
import { downloadDataURL, downloadText, shareDataURL, stamp } from '../lib/export';
import { generateDxf } from '../lib/dxf';
import * as pb from '../lib/pb';
import { toast } from '../ui/Toast';

export default function PlanLayoutModal({ doc, projectName = '', onClose }) {
    const [paper, setPaper] = useState('A3');
    const [showOuterDims, setShowOuterDims] = useState(true);
    const [showWallDims, setShowWallDims] = useState(true);
    const [showFurnDims, setShowFurnDims] = useState(true);
    const [showSchedule, setShowSchedule] = useState(true);
    const [include3D, setInclude3D] = useState(true);
    const [projectTitle, setProjectTitle] = useState(() => projectName || doc?.name || 'Mặt bằng khảo sát');
    const [noteText, setNoteText] = useState('');
    const [thumb3D, setThumb3D] = useState(null);
    const [previewUrl, setPreviewUrl] = useState('');
    const [busy, setBusy] = useState(false);

    const hasContent = (doc?.plan?.walls?.length || 0) > 0 || (doc?.furniture?.length || 0) > 0;

    // Chụp sẵn 1 ảnh phối cảnh 3D góc chuẩn khi mở modal (nếu bật Góc 3D)
    useEffect(() => {
        let dead = false;
        if (!include3D || !hasContent) {
            setThumb3D(null);
            return undefined;
        }
        if (thumb3D) return undefined;
        captureRoom3DDataURL(doc, { width: 920, height: 620, cutaway: true })
            .then((url) => { if (!dead && url) setThumb3D(url); })
            .catch(() => {});
        return () => { dead = true; };
    }, [include3D, hasContent, doc, thumb3D]);

    const buildOpts = useCallback((dpiScale = 1.2) => ({
        paper,
        dpiScale,
        showOuterDims,
        showWallDims,
        showFurnDims,
        showSchedule,
        include3D,
        thumb3DDataURL: include3D ? thumb3D : null,
        projectTitle,
        authorName: pb.ownerName?.() || 'MKG Khảo Sát Studio',
        noteText,
    }), [paper, showOuterDims, showWallDims, showFurnDims, showSchedule, include3D, thumb3D, projectTitle, noteText]);

    // Kết xuất bản xem trước mỗi khi tuỳ chọn thay đổi
    useEffect(() => {
        let dead = false;
        const timer = setTimeout(async () => {
            try {
                const canvas = await renderPlanLayoutCanvas(doc, buildOpts(1.15));
                if (!dead) setPreviewUrl(canvas.toDataURL('image/png'));
            } catch (err) {
                console.warn('renderPlanLayoutCanvas:', err);
            }
        }, 60);
        return () => { dead = true; clearTimeout(timer); };
    }, [doc, buildOpts]);

    const fileBase = () => {
        const clean = String(projectTitle || doc?.name || 'Layout').replace(/[\\/:*?"<>|]/g, '').trim() || 'Layout';
        return `Layout_${clean}_${paper}_${stamp()}`;
    };

    const handleDownload = async (format) => {
        if (busy) return;
        setBusy(true);
        try {
            const canvas = await renderPlanLayoutCanvas(doc, buildOpts(2.5));
            const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
            const dataURL = canvas.toDataURL(mime, 0.94);
            downloadDataURL(dataURL, `${fileBase()}.${format}`);
            toast(`Đã tải xuống Layout ${paper} (${format.toUpperCase()})`, 'ok');
        } catch (err) {
            toast('Không thể xuất ảnh Layout: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const handleShare = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const canvas = await renderPlanLayoutCanvas(doc, buildOpts(2.2));
            const r = await shareDataURL(canvas.toDataURL('image/png'), `${fileBase()}.png`);
            toast(r === 'shared' ? 'Đã chia sẻ Layout mặt bằng' : 'Đã lưu Layout mặt bằng', 'ok');
        } catch (err) {
            toast('Lỗi chia sẻ Layout: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const handlePrintPdf = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const canvas = await renderPlanLayoutCanvas(doc, buildOpts(2.5));
            const ok = printLayoutDataURL(canvas.toDataURL('image/png'), projectTitle || doc?.name, paper);
            if (!ok) toast('Trình duyệt đã chặn cửa sổ bật lên để in PDF', 'err');
        } catch (err) {
            toast('Lỗi tạo bản in PDF: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const handleExportDxf = () => {
        try {
            const dxf = generateDxf(doc);
            downloadText(dxf, `${fileBase()}.dxf`, 'application/dxf');
            toast('Đã xuất AutoCAD DXF (kèm lớp FURN-DIM & SVG)', 'ok');
        } catch (err) {
            toast('Lỗi xuất DXF: ' + err.message, 'err');
        }
    };

    return (
        <div className="layout-modal-backdrop" role="dialog" aria-modal="true">
            <div className="layout-modal-shell">
                <div className="layout-modal-head">
                    <div>
                        <strong>Xuất Layout Mặt Bằng &amp; Kích Thước</strong>
                        <span className="layout-modal-sub"> · Chuẩn hồ sơ kỹ thuật {paper} Landscape</span>
                    </div>
                    <button className="icon-btn" onClick={onClose} title="Đóng"><X size={18} /></button>
                </div>

                <div className="layout-modal-body">
                    <div className="layout-modal-preview">
                        {previewUrl ? (
                            <img src={previewUrl} alt="Xem trước Layout mặt bằng" />
                        ) : (
                            <div className="layout-modal-loading">
                                <RefreshCw size={22} className="spin" /> Đang dàn trang bản vẽ kỹ thuật…
                            </div>
                        )}
                    </div>

                    <div className="layout-modal-controls">
                        <div className="layout-ctrl-group">
                            <label>Khổ giấy bản vẽ</label>
                            <div className="seg-row">
                                <button className={`chip ${paper === 'A3' ? 'on' : ''}`} onClick={() => setPaper('A3')}>
                                    A3 Ngang (Nét lớn)
                                </button>
                                <button className={`chip ${paper === 'A4' ? 'on' : ''}`} onClick={() => setPaper('A4')}>
                                    A4 Ngang
                                </button>
                            </div>
                        </div>

                        <div className="layout-ctrl-group">
                            <label>Tên công trình (Khung tên)</label>
                            <input
                                type="text"
                                className="cat-input"
                                value={projectTitle}
                                onChange={(e) => setProjectTitle(e.target.value)}
                                placeholder="VD: Căn hộ Vinhome S2.05"
                            />
                        </div>

                        <div className="layout-ctrl-group">
                            <label>Lớp thông tin hiển thị</label>
                            <label className="layout-check">
                                <input type="checkbox" checked={showOuterDims} onChange={(e) => setShowOuterDims(e.target.checked)} />
                                <span>Kích thước phủ bì &amp; chuỗi trục tường</span>
                            </label>
                            <label className="layout-check">
                                <input type="checkbox" checked={showWallDims} onChange={(e) => setShowWallDims(e.target.checked)} />
                                <span>Kích thước đoạn tường &amp; cửa đi / cửa sổ</span>
                            </label>
                            <label className="layout-check">
                                <input type="checkbox" checked={showFurnDims} onChange={(e) => setShowFurnDims(e.target.checked)} />
                                <span>Kích thước R×S trên từng món nội thất</span>
                            </label>
                            <label className="layout-check">
                                <input type="checkbox" checked={showSchedule} onChange={(e) => setShowSchedule(e.target.checked)} />
                                <span>Bảng thống kê kích thước nội thất</span>
                            </label>
                            <label className="layout-check">
                                <input type="checkbox" checked={include3D} onChange={(e) => setInclude3D(e.target.checked)} />
                                <span>Kèm ảnh phối cảnh 3D góc phòng</span>
                            </label>
                        </div>

                        <div className="layout-ctrl-group">
                            <label>Ghi chú kỹ thuật</label>
                            <textarea
                                className="cat-textarea"
                                rows={2}
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                placeholder="VD: Đã khảo sát cốt trần 2850mm, tường 110..."
                            />
                        </div>

                        <div className="layout-actions">
                            <button className="btn-primary" disabled={busy} onClick={() => handleDownload('png')}>
                                <Download size={16} /> {busy ? 'Đang kết xuất…' : `Tải PNG (${paper})`}
                            </button>
                            <button className="btn-secondary" disabled={busy} onClick={() => handleDownload('jpg')}>
                                <Download size={16} /> Tải JPG
                            </button>
                            <button className="btn-secondary" disabled={busy} onClick={handlePrintPdf}>
                                <Printer size={16} /> In / Lưu PDF ({paper})
                            </button>
                            <button className="btn-secondary" disabled={busy} onClick={handleShare}>
                                <Share2 size={16} /> Chia sẻ ảnh Layout
                            </button>
                            <button className="btn-secondary" onClick={handleExportDxf}>
                                <FileCode2 size={16} /> Xuất AutoCAD (.DXF)
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
