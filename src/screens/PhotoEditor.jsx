import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Arrow, Group } from 'react-konva';
import {
    ArrowLeft, Undo2, Redo2, Share2, Ruler, MessageSquareText,
    Trash2, X, Pencil, Image as ImageIcon, MapPin,
    ChevronLeft, ChevronRight, Hand,
} from 'lucide-react';
import DimLine from '../photo/DimLine';
import NoteMarker from '../photo/NoteMarker';
import Sheet from '../ui/Sheet';
import NumPad from '../ui/NumPad';
import TextSheet from '../ui/TextSheet';
import { toast } from '../ui/Toast';
import { genId } from '../lib/geometry';
import { stageToDataURL, downloadDataURL, shareDataURL, stamp } from '../lib/export';
import { formatLocation, getCurrentLocation, hasLocation, openLocationMap } from '../lib/location';

const MODES = [
    { id: 'view', icon: Hand, label: 'Xem ảnh' },
    { id: 'measure', icon: Ruler, label: 'Đo' },
    { id: 'note', icon: MessageSquareText, label: 'Ghi chú' },
];

function computeFitView(doc, stageSize) {
    if (!stageSize.width || !stageSize.height || !doc?.w || !doc?.h) return null;
    const s = Math.min(stageSize.width / doc.w, stageSize.height / doc.h);
    return {
        scale: s,
        x: (stageSize.width - doc.w * s) / 2,
        y: (stageSize.height - doc.h * s) / 2,
    };
}

export default function PhotoEditor({ doc, photos = [], onSwitchPhoto, onChange, onBack }) {
    const docRef = useRef(doc);
    useEffect(() => { docRef.current = doc; }, [doc]);

    const [mode, setModeRaw] = useState('view');
    const [img, setImg] = useState(null);
    const [view, setView] = useState(doc.view || null);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const [sel, setSel] = useState(null); // {kind:'line'|'note', id}
    const [temp, setTemp] = useState(null); // live drawing line {start, end}
    const [swipeDx, setSwipeDx] = useState(0);
    const [numpad, setNumpad] = useState(null);
    const [textSheet, setTextSheet] = useState(null);
    const [showExport, setShowExport] = useState(false);
    const [, bumpHist] = useState(0);

    const stageRef = useRef(null);
    const wrapRef = useRef(null);
    const gestureRef = useRef(null);
    const lastTapRef = useRef({ time: 0, x: 0, y: 0 });
    const stripRefs = useRef(new Map());
    const historyRef = useRef({ stack: [{ lines: doc.lines || [], notes: doc.notes || [] }], i: 0 });

    const photoIdx = photos.findIndex(p => p.id === doc.id);
    const hasAlbum = photos.length > 1 && photoIdx >= 0;
    const hasPrev = hasAlbum && photoIdx > 0;
    const hasNext = hasAlbum && photoIdx < photos.length - 1;
    const fitScale = (stageSize.width && stageSize.height && doc.w && doc.h)
        ? Math.min(stageSize.width / doc.w, stageSize.height / doc.h)
        : 0;

    // ===== Reset state cleanly when switching photo inside the album =====
    useEffect(() => {
        historyRef.current = { stack: [{ lines: doc.lines || [], notes: doc.notes || [] }], i: 0 };
        setSel(null);
        setTemp(null);
        setSwipeDx(0);
        setView(doc.view || computeFitView(doc, stageSize));
        bumpHist(v => v + 1);
        const el = stripRefs.current.get(doc.id);
        if (el?.scrollIntoView) {
            try { el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch { /* ignore */ }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doc.id]);

    // ===== Hydrate image =====
    useEffect(() => {
        let alive = true;
        const image = new window.Image();
        image.onload = () => { if (alive) setImg(image); };
        image.src = doc.img;
        return () => { alive = false; };
    }, [doc.img]);

    // ===== Stage sizing =====
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setStageSize({ width: el.offsetWidth, height: el.offsetHeight });
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, []);

    // ===== Initial view fit =====
    useEffect(() => {
        if (view || !stageSize.width || !stageSize.height || !doc.w) return;
        const fitted = computeFitView(doc, stageSize);
        if (fitted) setView(fitted);
    }, [stageSize, view, doc]);

    const goPrevPhoto = useCallback(() => {
        if (!hasPrev || !onSwitchPhoto) return;
        onSwitchPhoto(photos[photoIdx - 1]);
    }, [hasPrev, onSwitchPhoto, photos, photoIdx]);

    const goNextPhoto = useCallback(() => {
        if (!hasNext || !onSwitchPhoto) return;
        onSwitchPhoto(photos[photoIdx + 1]);
    }, [hasNext, onSwitchPhoto, photos, photoIdx]);

    // ===== Keyboard Left / Right navigation =====
    useEffect(() => {
        if (!hasAlbum) return;
        const onKey = (e) => {
            if (numpad || textSheet || showExport) return;
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); goPrevPhoto(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); goNextPhoto(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [hasAlbum, numpad, textSheet, showExport, goPrevPhoto, goNextPhoto]);

    // ===== History / commit =====
    const commit = (lines, notes, ratio) => {
        const d = docRef.current;
        const l = lines !== undefined ? lines : (d.lines || []);
        const n = notes !== undefined ? notes : (d.notes || []);
        const h = historyRef.current;
        h.stack = h.stack.slice(0, h.i + 1);
        h.stack.push({ lines: l, notes: n });
        if (h.stack.length > 50) h.stack.shift();
        h.i = h.stack.length - 1;
        bumpHist(v => v + 1);
        const next = { ...d, lines: l, notes: n, updatedAt: Date.now() };
        if (ratio !== undefined) next.ratio = ratio;
        onChange(next);
        setSel(s => {
            if (!s) return s;
            if (s.kind === 'line' && !l.some(x => x.id === s.id)) return null;
            if (s.kind === 'note' && !n.some(x => x.id === s.id)) return null;
            return s;
        });
    };

    const canUndo = historyRef.current.i > 0;
    const canRedo = historyRef.current.i < historyRef.current.stack.length - 1;
    const applySnapshot = (s) => {
        onChange({ ...docRef.current, lines: s.lines, notes: s.notes, updatedAt: Date.now() });
        setSel(null);
        bumpHist(v => v + 1);
    };
    const undo = () => { const h = historyRef.current; if (h.i > 0) { h.i--; applySnapshot(h.stack[h.i]); } };
    const redo = () => { const h = historyRef.current; if (h.i < h.stack.length - 1) { h.i++; applySnapshot(h.stack[h.i]); } };

    const setMode = (m) => { setModeRaw(m); setSel(null); setTemp(null); };

    // ===== NumPad for line label =====
    const openLabelNumPad = (line, isNew) => {
        const d = docRef.current;
        const px = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
        const suggest = d.ratio ? Math.round(px * d.ratio / 10) * 10 : Math.round(px);
        setNumpad({
            title: 'Kích thước thực tế',
            initial: isNew ? suggest : (parseFloat(line.label) || suggest),
            hint: (!d.ratio && isNew) ? 'Số đo đầu tiên sẽ dùng làm tỉ lệ gợi ý cho các đường sau' : null,
            onOK: (val) => {
                const dd = docRef.current;
                const lines = (dd.lines || []).map(l => l.id === line.id ? { ...l, label: String(val) } : l);
                const ratio = dd.ratio || (px > 0 ? val / px : null);
                commit(lines, undefined, ratio);
            },
        });
    };

    // ===== Pointer handling =====
    const getPos = (e) => {
        const stage = stageRef.current;
        if (!stage) return null;
        if (e.evt?.touches?.length > 0) {
            const t = e.evt.touches[0];
            const r = stage.container().getBoundingClientRect();
            return { x: t.clientX - r.left, y: t.clientY - r.top };
        }
        if (e.evt?.changedTouches?.length > 0) {
            const t = e.evt.changedTouches[0];
            const r = stage.container().getBoundingClientRect();
            return { x: t.clientX - r.left, y: t.clientY - r.top };
        }
        return stage.getPointerPosition();
    };
    const toWorld = (p) => ({ x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale });
    const touchDist = (ts) => Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
    const touchCenter = (ts, rect) => ({
        x: (ts[0].clientX + ts[1].clientX) / 2 - rect.left,
        y: (ts[0].clientY + ts[1].clientY) / 2 - rect.top,
    });
    const isEmptyTarget = (t) => t === t.getStage?.() || t.className === 'Image';

    const onDown = (e) => {
        if (e.evt?.touches?.length === 2) {
            if (e.evt.cancelable) e.evt.preventDefault();
            const rect = stageRef.current.container().getBoundingClientRect();
            gestureRef.current = { type: 'pinch', lastDist: touchDist(e.evt.touches), lastCenter: touchCenter(e.evt.touches, rect) };
            setTemp(null);
            setSwipeDx(0);
            return;
        }
        if (e.target.name?.() === 'handle') return;
        const p = getPos(e);
        if (!p) return;
        if (mode === 'measure' && isEmptyTarget(e.target)) {
            if (e.evt?.cancelable) e.evt.preventDefault();
            const w = toWorld(p);
            gestureRef.current = { type: 'draw' };
            setTemp({ start: w, end: w });
            return;
        }
        if (e.evt?.cancelable) e.evt.preventDefault();
        const atFitZoom = !fitScale || !view || view.scale <= fitScale * 1.08;
        const canSwipe = hasAlbum && (mode === 'view' || mode === 'select') && !sel && atFitZoom && isEmptyTarget(e.target);
        gestureRef.current = { type: 'tap', sx: p.x, sy: p.y, startView: { ...view }, canSwipe };
    };

    const onMove = (e) => {
        const g = gestureRef.current;
        if (e.evt?.touches?.length === 2 && g?.type === 'pinch') {
            if (e.evt.cancelable) e.evt.preventDefault();
            const rect = stageRef.current.container().getBoundingClientRect();
            const nd = touchDist(e.evt.touches);
            const nc = touchCenter(e.evt.touches, rect);
            const oldScale = view.scale;
            const scale = oldScale * (nd / g.lastDist);
            const pointTo = { x: (nc.x - view.x) / oldScale, y: (nc.y - view.y) / oldScale };
            const dx = nc.x - g.lastCenter.x;
            const dy = nc.y - g.lastCenter.y;
            setView({ scale, x: nc.x - pointTo.x * scale + dx, y: nc.y - pointTo.y * scale + dy });
            g.lastDist = nd;
            g.lastCenter = nc;
            return;
        }
        const p = getPos(e);
        if (!p) return;
        if (g?.type === 'draw' && temp) {
            if (e.evt?.cancelable) e.evt.preventDefault();
            let end = toWorld(p);
            if (e.evt?.shiftKey) {
                const dx = end.x - temp.start.x;
                const dy = end.y - temp.start.y;
                const d = Math.hypot(dx, dy);
                const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
                end = { x: temp.start.x + Math.cos(ang) * d, y: temp.start.y + Math.sin(ang) * d };
            }
            setTemp(t => t ? { ...t, end } : t);
            return;
        }
        if (g && g.type === 'tap') {
            const dx = p.x - g.sx;
            const dy = p.y - g.sy;
            if (g.canSwipe && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.15) {
                g.type = 'swipe';
            } else if (Math.hypot(dx, dy) > 10) {
                g.type = 'pan';
            }
        }
        if (g && g.type === 'swipe') {
            if (e.evt?.cancelable) e.evt.preventDefault();
            const dx = p.x - g.sx;
            const resisted = ((dx > 0 && !hasPrev) || (dx < 0 && !hasNext)) ? dx * 0.25 : dx;
            setSwipeDx(resisted);
            return;
        }
        if (g && g.type === 'pan') {
            if (e.evt?.cancelable) e.evt.preventDefault();
            setView(v => ({ ...v, x: g.startView.x + (p.x - g.sx), y: g.startView.y + (p.y - g.sy) }));
        }
    };

    const onUp = (e) => {
        const g = gestureRef.current;
        gestureRef.current = null;
        if (!g) return;
        if (g.type === 'swipe') {
            const p = getPos(e) || { x: g.sx + swipeDx, y: g.sy };
            const dx = p.x - g.sx;
            setSwipeDx(0);
            if (dx <= -48 && hasNext) goNextPhoto();
            else if (dx >= 48 && hasPrev) goPrevPhoto();
            return;
        }
        if (g.type === 'draw') {
            const t = temp;
            setTemp(null);
            if (!t) return;
            const px = Math.hypot(t.end.x - t.start.x, t.end.y - t.start.y);
            if (px * view.scale < 14) return; // too short — treat as noise
            const line = { id: genId('l'), start: t.start, end: t.end, label: '?' };
            commit([...(docRef.current.lines || []), line], undefined);
            setSel({ kind: 'line', id: line.id });
            openLabelNumPad(line, true);
            return;
        }
        if (g.type !== 'tap') return;
        if (e.evt?.touches?.length > 0) return;
        if (!isEmptyTarget(e.target)) return;
        const p = getPos(e) || { x: g.sx, y: g.sy };
        const w = toWorld(p);
        if (mode === 'note') {
            setTextSheet({
                title: 'Ghi chú',
                placeholder: 'VD: Tường ẩm mốc, cần xử lý...',
                onOK: (text) => {
                    commit(undefined, [...(docRef.current.notes || []), { id: genId('t'), x: w.x, y: w.y, text }]);
                },
            });
            return;
        }
        // Chạm đúp ở chế độ Xem ảnh để phóng to / thu về vừa khung giống album điện thoại
        if (mode === 'view' && fitScale && view) {
            const now = Date.now();
            const prev = lastTapRef.current;
            if (now - prev.time < 300 && Math.hypot(p.x - prev.x, p.y - prev.y) < 28) {
                lastTapRef.current = { time: 0, x: 0, y: 0 };
                if (view.scale > fitScale * 1.15) {
                    const fitted = computeFitView(doc, stageSize);
                    if (fitted) setView(fitted);
                } else {
                    const targetScale = fitScale * 2.2;
                    setView({
                        scale: targetScale,
                        x: p.x - w.x * targetScale,
                        y: p.y - w.y * targetScale,
                    });
                }
                return;
            }
            lastTapRef.current = { time: now, x: p.x, y: p.y };
        }
        setSel(null);
    };

    const onWheel = (e) => {
        e.evt.preventDefault();
        const scaleBy = 1.1;
        const pointer = stageRef.current.getPointerPosition();
        const oldScale = view.scale;
        const mousePointTo = { x: (pointer.x - view.x) / oldScale, y: (pointer.y - view.y) / oldScale };
        const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
        setView({ scale: newScale, x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
    };

    // ===== Export =====
    const doExport = async (kind) => {
        setShowExport(false);
        setSel(null);
        setTemp(null);
        const d = docRef.current;
        await new Promise(r => setTimeout(r, 120));
        const crop = { x: 0, y: 0, width: d.w, height: d.h };
        const format = kind === 'share' ? 'jpg' : kind;
        const uri = stageToDataURL(stageRef.current, { crop, format, targetPx: 2560 });
        const fname = `KS_${d.name}_${stamp()}.${format === 'png' ? 'png' : 'jpg'}`;
        if (kind === 'share') {
            const r = await shareDataURL(uri, fname);
            toast(r === 'shared' ? 'Đã chia sẻ' : 'Đã tải xuống', 'ok');
        } else {
            downloadDataURL(uri, fname);
            toast('Đã lưu ảnh', 'ok');
        }
    };

    const handleBack = () => {
        if (view) onChange({ ...docRef.current, view });
        onBack();
    };

    const handleLocation = async () => {
        const d = docRef.current;
        if (hasLocation(d)) {
            openLocationMap(d.location);
            return;
        }
        const location = await getCurrentLocation();
        if (!location) {
            toast('Chưa lấy được vị trí. Kiểm tra quyền Location của trình duyệt.', 'err');
            return;
        }
        onChange({ ...d, location, updatedAt: Date.now() });
        toast('Đã lưu vị trí cho ảnh', 'ok');
    };

    const selLine = sel?.kind === 'line' ? (doc.lines || []).find(l => l.id === sel.id) : null;
    const selNote = sel?.kind === 'note' ? (doc.notes || []).find(n => n.id === sel.id) : null;

    const bannerText = () => {
        if (mode === 'measure') return 'Kéo trên ảnh để vẽ đường đo · nhập số đo laser';
        if (mode === 'note') return 'Chạm vào ảnh để đặt ghi chú';
        if (hasAlbum) return 'Vuốt trái/phải hoặc bấm mũi tên để chuyển ảnh · chạm đúp để zoom';
        return 'Chạm đúp hoặc kẹp 2 ngón để phóng to · chọn "Đo" để đo kích thước';
    };

    return (
        <div className="screen">
            <div className="hdr">
                <button className="icon-btn" onClick={handleBack}><ArrowLeft size={22} /></button>
                <button className="editor-title-location" onClick={handleLocation}>
                    <div className="hdr-title">
                        {doc.name}
                        {hasAlbum && <span className="album-hdr-count">{photoIdx + 1}/{photos.length}</span>}
                    </div>
                    <div className={`hdr-sub doc-location ${hasLocation(doc) ? 'on' : ''}`}>
                        <MapPin size={12} /> {hasLocation(doc) ? formatLocation(doc.location) : 'Lấy vị trí'}
                    </div>
                </button>
                <button className="icon-btn" style={{ opacity: canUndo ? 1 : .3 }} onClick={undo}><Undo2 size={20} /></button>
                <button className="icon-btn" style={{ opacity: canRedo ? 1 : .3 }} onClick={redo}><Redo2 size={20} /></button>
                <button className="icon-btn" style={{ color: 'var(--red-dark)' }} onClick={() => setShowExport(true)}><Share2 size={20} /></button>
            </div>

            <div className={`mode-banner ${mode}`}>
                <span>{bannerText()}</span>
                <span className="spacer" />
                {mode !== 'view' && (
                    <button className="banner-btn" onClick={() => setMode('view')}>✕ Xong</button>
                )}
            </div>

            <div className="editor-canvas" ref={wrapRef} style={{ background: '#0f172a', overflow: 'hidden' }}>
                {view && stageSize.width > 0 && (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            transform: swipeDx ? `translate3d(${swipeDx}px, 0, 0)` : undefined,
                            transition: swipeDx ? 'none' : 'transform 160ms ease-out',
                        }}
                    >
                        <Stage width={stageSize.width} height={stageSize.height} ref={stageRef}
                            scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
                            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
                            onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
                            onWheel={onWheel}>
                            <Layer>
                                {img && <KonvaImage image={img} x={0} y={0} />}
                                {(doc.lines || []).map(l => (
                                    <DimLine key={l.id} line={l} scale={view.scale}
                                        isSelected={sel?.kind === 'line' && sel.id === l.id}
                                        onSelect={(id) => setSel({ kind: 'line', id })}
                                        onLabelTap={(line) => openLabelNumPad(line, false)}
                                        onChange={(nl, commitFlag) => {
                                            const lines = (docRef.current.lines || []).map(x => x.id === nl.id ? nl : x);
                                            if (commitFlag) commit(lines, undefined);
                                            else onChange({ ...docRef.current, lines });
                                        }}
                                    />
                                ))}
                                <Group listening={mode !== 'measure'}>
                                    {(doc.notes || []).map(n => (
                                        <NoteMarker key={n.id} note={n} scale={view.scale} baseSize={16}
                                            isSelected={sel?.kind === 'note' && sel.id === n.id}
                                            onSelect={(id) => setSel({ kind: 'note', id })}
                                            onEdit={(note) => setTextSheet({
                                                title: 'Sửa ghi chú', initial: note.text,
                                                onOK: (text) => commit(undefined, (docRef.current.notes || []).map(x => x.id === note.id ? { ...x, text } : x)),
                                            })}
                                            onChange={(nn, commitFlag) => {
                                                const notes = (docRef.current.notes || []).map(x => x.id === nn.id ? nn : x);
                                                if (commitFlag) commit(undefined, notes);
                                                else onChange({ ...docRef.current, notes });
                                            }}
                                        />
                                    ))}
                                </Group>
                                {temp && (
                                    <Arrow points={[temp.start.x, temp.start.y, temp.end.x, temp.end.y]}
                                        stroke="#fbbf24" strokeWidth={2 / view.scale} fill="#fbbf24"
                                        pointerLength={7 / view.scale} pointerWidth={7 / view.scale}
                                        dash={[6 / view.scale, 5 / view.scale]} listening={false} />
                                )}
                            </Layer>
                        </Stage>
                    </div>
                )}

                {hasAlbum && (
                    <>
                        <button
                            type="button"
                            className="album-nav-btn prev"
                            disabled={!hasPrev}
                            onClick={goPrevPhoto}
                            aria-label="Ảnh trước"
                            title="Ảnh trước (←)"
                        >
                            <ChevronLeft size={24} />
                        </button>
                        <button
                            type="button"
                            className="album-nav-btn next"
                            disabled={!hasNext}
                            onClick={goNextPhoto}
                            aria-label="Ảnh tiếp theo"
                            title="Ảnh tiếp theo (→)"
                        >
                            <ChevronRight size={24} />
                        </button>
                    </>
                )}

                {selLine && (
                    <div className="float-bar">
                        <button className="fb-btn" style={{ color: 'var(--blue)' }} onClick={() => openLabelNumPad(selLine, false)}>
                            <Pencil size={16} /> Sửa số
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" style={{ color: '#dc2626' }}
                            onClick={() => { commit((docRef.current.lines || []).filter(x => x.id !== selLine.id), undefined); setSel(null); }}>
                            <Trash2 size={16} /> Xóa
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" onClick={() => setSel(null)}><X size={16} /></button>
                    </div>
                )}
                {selNote && (
                    <div className="float-bar">
                        <button className="fb-btn" style={{ color: 'var(--blue)' }} onClick={() => setTextSheet({
                            title: 'Sửa ghi chú', initial: selNote.text,
                            onOK: (text) => commit(undefined, (docRef.current.notes || []).map(x => x.id === selNote.id ? { ...x, text } : x)),
                        })}>
                            <Pencil size={16} /> Sửa
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" style={{ color: '#dc2626' }}
                            onClick={() => { commit(undefined, (docRef.current.notes || []).filter(x => x.id !== selNote.id)); setSel(null); }}>
                            <Trash2 size={16} /> Xóa
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" onClick={() => setSel(null)}><X size={16} /></button>
                    </div>
                )}
            </div>

            {hasAlbum && mode === 'view' && (
                <div className="photo-filmstrip">
                    {photos.map((p, idx) => (
                        <button
                            key={p.id}
                            type="button"
                            ref={(el) => { if (el) stripRefs.current.set(p.id, el); else stripRefs.current.delete(p.id); }}
                            className={`filmstrip-item ${p.id === doc.id ? 'on' : ''}`}
                            onClick={() => onSwitchPhoto?.(p)}
                            title={p.name || `Ảnh ${idx + 1}`}
                        >
                            <img src={p.thumb || p.img} alt={p.name || `Ảnh ${idx + 1}`} />
                            <span>{idx + 1}</span>
                        </button>
                    ))}
                </div>
            )}

            <div className="tool-bar">
                {MODES.map(m => {
                    const Icon = m.icon;
                    const on = mode === m.id;
                    return (
                        <button key={m.id} className={`tool ${on ? `on t-${m.id}` : ''}`}
                            onClick={() => setMode(on && m.id !== 'view' ? 'view' : m.id)}>
                            <Icon size={21} />
                            {m.label}
                        </button>
                    );
                })}
            </div>

            <NumPad cfg={numpad} onClose={() => setNumpad(null)} />
            <TextSheet cfg={textSheet} onClose={() => setTextSheet(null)} />

            <Sheet open={showExport} onClose={() => setShowExport(false)} title="Xuất ảnh khảo sát">
                <button className="sheet-row" onClick={() => doExport('share')}>
                    <Share2 size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Chia sẻ ảnh<div className="sub">Zalo, Messenger, Email...</div></div>
                </button>
                <button className="sheet-row" onClick={() => doExport('jpg')}>
                    <ImageIcon size={19} style={{ color: 'var(--warn)' }} />
                    <div style={{ flex: 1 }}>Tải JPG<div className="sub">Kèm số đo và ghi chú</div></div>
                </button>
                <button className="sheet-row" onClick={() => doExport('png')}>
                    <ImageIcon size={19} style={{ color: 'var(--ok)' }} />
                    <div style={{ flex: 1 }}>Tải PNG<div className="sub">Chất lượng cao nhất</div></div>
                </button>
            </Sheet>
        </div>
    );
}
