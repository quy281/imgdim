import React, { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft, Undo2, Redo2, Share2, Sun, Moon, Flame, Droplets, CircleDot,
    Plug, Maximize2, AlignHorizontalSpaceAround, AlignVerticalSpaceAround,
    Copy, Trash2, Pencil, FileDown, Image as ImageIcon, Layers, RotateCw, Plus, X,
} from 'lucide-react';
import CutoutCanvas from '../plan/CutoutCanvas';
import Sheet from '../ui/Sheet';
import NumPad from '../ui/NumPad';
import TextSheet from '../ui/TextSheet';
import Confirm from '../ui/Confirm';
import { toast } from '../ui/Toast';
import {
    SURFACE_PRESETS, ROUND_PRESETS, SOCKET_PRESETS,
    makeCutoutItem, cutoutOffsets, applyCutoutOffset, applyCutoutSize,
    centerCutout, snapCutoutPosition, clampCutout,
} from '../lib/cutoutModel';
import { generateCutoutDxf } from '../lib/cutoutDxf';
import { stageToDataURL, downloadDataURL, downloadText, shareDataURL, stamp } from '../lib/export';
import { dist } from '../lib/geometry';

export default function CutoutEditor({ doc, projectName = '', onChange, onBack }) {
    const docRef = useRef(doc);
    useEffect(() => { docRef.current = doc; }, [doc]);

    const cutout = doc.cutout || { w: 1000, h: 550, thickness: 20, theme: 'dark', refMode: 'edge', cutouts: [] };
    const [selId, setSelId] = useState(() => cutout.cutouts?.[0]?.id || null);
    const [guides, setGuides] = useState([]);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const [view, setView] = useState(doc.view || null);

    const [numpad, setNumpad] = useState(null);
    const [textSheet, setTextSheet] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [showExport, setShowExport] = useState(false);
    const [showSocketSheet, setShowSocketSheet] = useState(false);
    const [showRoundSheet, setShowRoundSheet] = useState(false);
    const [showSurfaceSheet, setShowSurfaceSheet] = useState(false);
    const [showHoleList, setShowHoleList] = useState(false);

    const [, bumpHist] = useState(0);
    const historyRef = useRef({ stack: [cutout], i: 0 });

    const stageRef = useRef(null);
    const wrapRef = useRef(null);
    const viewRef = useRef(view);
    useEffect(() => { viewRef.current = view; }, [view]);

    const gestureRef = useRef({ panning: false, last: null, pinchDist: null, pinchCenter: null });

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setStageSize({ width: el.offsetWidth, height: el.offsetHeight });
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, []);

    // Fit outer surface vào khung hiển thị lần đầu
    useEffect(() => {
        if (view || !stageSize.width || !stageSize.height) return;
        const ow = cutout.w || 1000;
        const oh = cutout.h || 550;
        const pad = 160;
        const s = Math.min(stageSize.width / (ow + pad * 2), stageSize.height / (oh + pad * 2)) * 0.85;
        setView({
            scale: Math.max(0.05, Math.min(1.8, s)),
            x: stageSize.width / 2 - (ow / 2) * s,
            y: stageSize.height / 2 - (oh / 2) * s,
        });
    }, [view, stageSize, cutout.w, cutout.h]);

    const commit = (nextCutout) => {
        const h = historyRef.current;
        h.stack = h.stack.slice(0, h.i + 1);
        h.stack.push(nextCutout);
        if (h.stack.length > 50) h.stack.shift();
        h.i = h.stack.length - 1;
        bumpHist(v => v + 1);
        onChange({ ...docRef.current, cutout: nextCutout, updatedAt: Date.now() });
    };

    const previewUpdate = (nextCutout) => {
        onChange({ ...docRef.current, cutout: nextCutout });
    };

    const canUndo = historyRef.current.i > 0;
    const canRedo = historyRef.current.i < historyRef.current.stack.length - 1;
    const undo = () => {
        const h = historyRef.current;
        if (h.i <= 0) return;
        h.i--;
        bumpHist(v => v + 1);
        onChange({ ...docRef.current, cutout: h.stack[h.i], updatedAt: Date.now() });
    };
    const redo = () => {
        const h = historyRef.current;
        if (h.i >= h.stack.length - 1) return;
        h.i++;
        bumpHist(v => v + 1);
        onChange({ ...docRef.current, cutout: h.stack[h.i], updatedAt: Date.now() });
    };

    // Pan & Zoom handlers
    const onPointerDown = (e) => {
        const touches = e.evt?.touches;
        const stage = stageRef.current;
        if (touches && touches.length >= 2) {
            gestureRef.current = {
                panning: false,
                last: null,
                pinchDist: dist({ x: touches[0].clientX, y: touches[0].clientY }, { x: touches[1].clientX, y: touches[1].clientY }),
                pinchCenter: { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 },
            };
            return;
        }
        const pt = stage.getPointerPosition();
        if (!pt) return;
        gestureRef.current = { panning: true, last: pt, pinchDist: null, pinchCenter: null };
    };

    const onPointerMove = (e) => {
        const touches = e.evt?.touches;
        const g = gestureRef.current;
        const stage = stageRef.current;
        const curV = viewRef.current;
        if (!curV || !stage) return;

        if (touches && touches.length >= 2 && g.pinchDist) {
            e.evt.preventDefault();
            const d = dist({ x: touches[0].clientX, y: touches[0].clientY }, { x: touches[1].clientX, y: touches[1].clientY });
            const c = { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
            const rect = stage.container().getBoundingClientRect();
            const sc = { x: c.x - rect.left, y: c.y - rect.top };
            const newScale = Math.max(0.04, Math.min(3.5, curV.scale * (d / g.pinchDist)));
            const wx = (sc.x - curV.x) / curV.scale;
            const wy = (sc.y - curV.y) / curV.scale;
            const nextV = {
                scale: newScale,
                x: sc.x - wx * newScale + (c.x - g.pinchCenter.x),
                y: sc.y - wy * newScale + (c.y - g.pinchCenter.y),
            };
            gestureRef.current = { ...g, pinchDist: d, pinchCenter: c };
            setView(nextV);
            return;
        }

        if (!g.panning) return;
        const pt = stage.getPointerPosition();
        if (!pt) return;
        setView({
            scale: curV.scale,
            x: curV.x + (pt.x - g.last.x),
            y: curV.y + (pt.y - g.last.y),
        });
        gestureRef.current.last = pt;
    };

    const onPointerUp = () => {
        gestureRef.current = { panning: false, last: null, pinchDist: null, pinchCenter: null };
    };

    const onWheel = (e) => {
        e.evt.preventDefault();
        const stage = stageRef.current;
        const pointer = stage.getPointerPosition();
        const curV = viewRef.current;
        if (!pointer || !curV) return;
        const by = 1.09;
        const newScale = Math.max(0.04, Math.min(3.5, e.evt.deltaY > 0 ? curV.scale / by : curV.scale * by));
        const mx = (pointer.x - curV.x) / curV.scale;
        const my = (pointer.y - curV.y) / curV.scale;
        setView({ scale: newScale, x: pointer.x - mx * newScale, y: pointer.y - my * newScale });
    };

    // ===== Thao tác bề mặt & lỗ =====
    const holes = cutout.cutouts || [];
    const selHole = holes.find(h => h.id === selId) || (holes.length === 1 ? holes[0] : null);
    const refMode = cutout.refMode === 'center' ? 'center' : 'edge';

    const updateOuterSize = (field, val) => {
        if (!(val >= 40)) { toast('Kích thước tối thiểu 40mm', 'err'); return; }
        const nextOuter = { ...cutout, [field]: Math.round(val) };
        nextOuter.cutouts = (cutout.cutouts || []).map(h => clampCutout(nextOuter, h));
        commit(nextOuter);
    };

    const applySurfacePreset = (p) => {
        const nextOuter = {
            ...cutout,
            presetKey: p.key,
            surfaceType: p.surfaceType,
            w: p.w,
            h: p.h,
            thickness: p.thickness,
        };
        nextOuter.cutouts = (cutout.cutouts || []).map(h => clampCutout(nextOuter, h));
        commit(nextOuter);
        setShowSurfaceSheet(false);
        setView(null);
        toast(`Đã đổi sang ${p.name} (${p.w}×${p.h} mm)`, 'ok');
    };

    const addHole = (presetKey, custom = {}) => {
        const cur = docRef.current.cutout;
        const nextHole = makeCutoutItem(presetKey, cur, custom);
        const next = { ...cur, cutouts: [...(cur.cutouts || []), nextHole] };
        commit(next);
        setSelId(nextHole.id);
        toast(`Đã thêm ${nextHole.name} — chạm số đo để nhập chính xác`, 'ok');
    };

    const replaceHole = (nextHole, doCommit = true) => {
        const cur = docRef.current.cutout;
        const next = {
            ...cur,
            cutouts: (cur.cutouts || []).map(h => h.id === nextHole.id ? nextHole : h),
        };
        if (doCommit) commit(next);
        else previewUpdate(next);
    };

    const handleDragHole = (hole, rawPos, doCommit) => {
        const cur = docRef.current.cutout;
        const tol = Math.max(15, 18 / (viewRef.current?.scale || 0.2));
        const res = snapCutoutPosition(cur, cur.cutouts, hole, rawPos, tol);
        const updated = { ...hole, x: res.x, y: res.y };
        if (doCommit) {
            setGuides([]);
            replaceHole(updated, true);
        } else {
            setGuides(res.guides || []);
            replaceHole(updated, false);
        }
        return { x: res.x, y: res.y };
    };

    const openOffsetPad = (hole, side, currentVal) => {
        const sideLabels = {
            left: refMode === 'center' ? 'Từ mép TRÁI tới TÂM lỗ' : 'Khoảng cách mép TRÁI lỗ',
            right: refMode === 'center' ? 'Từ mép PHẢI tới TÂM lỗ' : 'Khoảng cách mép PHẢI lỗ',
            top: refMode === 'center' ? 'Từ mép TRÊN (Hậu) tới TÂM lỗ' : 'Khoảng cách mép TRÊN (Hậu)',
            bottom: refMode === 'center' ? 'Từ mép DƯỚI (Tiền) tới TÂM lỗ' : 'Khoảng cách mép DƯỚI (Tiền)',
        };
        setNumpad({
            title: sideLabels[side] || 'Khoảng cách',
            sub: `${hole.name} · tấm ${Math.round(cutout.w)}×${Math.round(cutout.h)}mm`,
            initial: currentVal,
            onOK: (val) => {
                const updated = applyCutoutOffset(docRef.current.cutout, hole, side, val, refMode);
                replaceHole(updated, true);
            },
        });
    };

    const openHoleDimPad = (hole, dimKey) => {
        const titles = {
            w: 'Chiều rộng lỗ (W)',
            h: 'Chiều cao / sâu lỗ (H)',
            d: 'Đường kính lỗ (Ø)',
            r: 'Bán kính bo góc (R)',
        };
        setNumpad({
            title: `${titles[dimKey]} — ${hole.name}`,
            initial: dimKey === 'd' ? hole.w : hole[dimKey],
            onOK: (val) => {
                const updated = applyCutoutSize(docRef.current.cutout, hole, dimKey, val);
                replaceHole(updated, true);
            },
        });
    };

    const duplicateHole = (hole) => {
        const cur = docRef.current.cutout;
        const copy = makeCutoutItem(hole.kind, cur, {
            ...hole,
            name: `${hole.name} (2)`,
            x: hole.x + Math.min(80, Math.max(20, Math.round(hole.w * 0.2))),
            y: hole.y,
        });
        commit({ ...cur, cutouts: [...(cur.cutouts || []), copy] });
        setSelId(copy.id);
        toast('Đã nhân bản lỗ', 'ok');
    };

    const rotateHole = (hole) => {
        if (hole.shape === 'circle') return;
        const cx = hole.x + hole.w / 2;
        const cy = hole.y + hole.h / 2;
        const rotated = clampCutout(docRef.current.cutout, {
            ...hole,
            w: hole.h,
            h: hole.w,
            x: Math.round(cx - hole.h / 2),
            y: Math.round(cy - hole.w / 2),
        });
        replaceHole(rotated, true);
    };

    const removeHole = (id) => {
        const cur = docRef.current.cutout;
        const remaining = (cur.cutouts || []).filter(h => h.id !== id);
        commit({ ...cur, cutouts: remaining });
        setSelId(remaining[0]?.id || null);
    };

    const doExport = async (kind) => {
        setShowExport(false);
        const d = docRef.current;
        if (kind === 'dxf') {
            downloadText(generateCutoutDxf(d), `LoKhoet_${d.name}_${stamp()}.dxf`, 'application/dxf');
            toast('Đã xuất file CAD DXF cắt CNC (mm)', 'ok');
            return;
        }
        await new Promise(r => setTimeout(r, 90));
        const pad = 180;
        const crop = { x: -pad, y: -pad, width: (cutout.w || 1000) + pad * 2, height: (cutout.h || 550) + pad * 2 };
        const format = kind === 'share' ? 'jpg' : kind;
        const uri = stageToDataURL(stageRef.current, { crop, format });
        const fname = `LoKhoet_${d.name}_${stamp()}.${format}`;
        if (kind === 'share') {
            const res = await shareDataURL(uri, fname);
            toast(res === 'shared' ? 'Đã chia sẻ bản vẽ lỗ' : 'Đã tải xuống', 'ok');
        } else {
            downloadDataURL(uri, fname);
            toast('Đã lưu ảnh bản vẽ lỗ', 'ok');
        }
    };

    const selOffsets = selHole ? cutoutOffsets(cutout, selHole, refMode) : null;

    return (
        <div className="screen">
            {/* Header */}
            <div className="hdr">
                <button className="icon-btn" onClick={() => {
                    if (view) onChange({ ...docRef.current, view });
                    onBack();
                }}>
                    <ArrowLeft size={22} />
                </button>
                <button
                    type="button"
                    className="editor-title-location"
                    onClick={() => setTextSheet({
                        title: 'Tên bản vẽ đo lỗ',
                        initial: doc.name,
                        onOK: (name) => onChange({ ...docRef.current, name, updatedAt: Date.now() }),
                    })}
                >
                    <div className="hdr-title">{doc.name}</div>
                    <div className="hdr-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                        {cutout.surfaceType || 'Bề mặt'} {Math.round(cutout.w)}×{Math.round(cutout.h)} · {holes.length} lỗ
                        {projectName ? ` · ${projectName}` : ''}
                    </div>
                </button>
                <button className="icon-btn" style={{ opacity: canUndo ? 1 : .3 }} onClick={undo} title="Hoàn tác"><Undo2 size={20} /></button>
                <button className="icon-btn" style={{ opacity: canRedo ? 1 : .3 }} onClick={redo} title="Làm lại"><Redo2 size={20} /></button>
                <button
                    className="icon-btn"
                    title={cutout.theme === 'light' ? 'Chuyển nền tối Reekon CAD' : 'Chuyển nền sáng'}
                    onClick={() => commit({ ...cutout, theme: cutout.theme === 'light' ? 'dark' : 'light' })}
                >
                    {cutout.theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
                </button>
                <button className="icon-btn" style={{ color: 'var(--blue)' }} onClick={() => setShowExport(true)} title="Xuất CNC DXF / Ảnh">
                    <Share2 size={20} />
                </button>
            </div>

            {/* Reference bar */}
            <div className="mode-banner" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 700 }}>Đo theo:</span>
                <div className="mkg-segmented" role="group" aria-label="Gốc đo lỗ">
                    <button
                        type="button"
                        className={`mkg-segmented-tab ${refMode === 'edge' ? 'active' : ''}`}
                        onClick={() => commit({ ...cutout, refMode: 'edge' })}
                    >
                        Mép lỗ
                    </button>
                    <button
                        type="button"
                        className={`mkg-segmented-tab ${refMode === 'center' ? 'active' : ''}`}
                        onClick={() => commit({ ...cutout, refMode: 'center' })}
                    >
                        Tâm lỗ
                    </button>
                </div>
                <span className="spacer" />
                <button type="button" className="banner-btn" onClick={() => setView(null)} title="Căn vừa màn hình">
                    <Maximize2 size={12} /> Vừa khung
                </button>
                <button type="button" className="banner-btn" onClick={() => setShowHoleList(true)}>
                    <Layers size={13} /> {holes.length} lỗ
                </button>
            </div>

            {/* Canvas */}
            <div className="editor-canvas" ref={wrapRef} style={{ background: cutout.theme === 'light' ? '#f1f5f9' : '#0b1324' }}>
                {view && stageSize.width > 0 && (
                    <CutoutCanvas
                        stageRef={stageRef}
                        stageSize={stageSize}
                        view={view}
                        cutout={cutout}
                        selId={selId}
                        guides={guides}
                        onWheel={onWheel}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onSelectHole={(id) => setSelId(id)}
                        onDragHole={handleDragHole}
                        onTapOuterW={() => setNumpad({
                            title: 'Chiều rộng khổ tấm / vách (W)',
                            initial: cutout.w,
                            onOK: (v) => updateOuterSize('w', v),
                        })}
                        onTapOuterH={() => setNumpad({
                            title: 'Chiều sâu bàn / cao vách (H)',
                            initial: cutout.h,
                            onOK: (v) => updateOuterSize('h', v),
                        })}
                        onTapOffset={openOffsetPad}
                        onTapHoleDim={openHoleDimPad}
                    />
                )}

                {/* Quick read-out HUD góc trên phải giống bảng đo */}
                {selHole && selOffsets && (
                    <div className="cutout-hud">
                        <div className="cutout-hud-title">{selHole.name}</div>
                        <div className="cutout-hud-grid">
                            <span>T: <b>{selOffsets.left}</b></span>
                            <span>P: <b>{selOffsets.right}</b></span>
                            <span>Tr: <b>{selOffsets.top}</b></span>
                            <span>D: <b>{selOffsets.bottom}</b></span>
                        </div>
                    </div>
                )}

                {/* Action bar nổi cho lỗ đang chọn */}
                {selHole && (
                    <div className="float-bar">
                        <button className="fb-btn" style={{ color: 'var(--blue)' }} onClick={() => openHoleDimPad(selHole, selHole.shape === 'circle' ? 'd' : 'w')}>
                            <Maximize2 size={15} />
                            {selHole.shape === 'circle' ? `Ø${Math.round(selHole.w)}` : `${Math.round(selHole.w)}×${Math.round(selHole.h)}`}
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" style={{ color: 'var(--ok)' }} onClick={() => replaceHole(centerCutout(cutout, selHole, 'x'), true)}>
                            <AlignHorizontalSpaceAround size={15} /> Giữa X
                        </button>
                        <button className="fb-btn" style={{ color: 'var(--ok)' }} onClick={() => replaceHole(centerCutout(cutout, selHole, 'y'), true)}>
                            <AlignVerticalSpaceAround size={15} /> Giữa Y
                        </button>
                        {selHole.shape !== 'circle' && (
                            <>
                                <div className="fb-sep" />
                                <button className="fb-btn" style={{ color: 'var(--violet)' }} onClick={() => rotateHole(selHole)}>
                                    <RotateCw size={15} /> Xoay
                                </button>
                                <button className="fb-btn" style={{ color: 'var(--warn)' }} onClick={() => openHoleDimPad(selHole, 'r')}>
                                    R{Math.round(selHole.r || 0)}
                                </button>
                            </>
                        )}
                        <div className="fb-sep" />
                        <button className="fb-btn" onClick={() => setTextSheet({
                            title: 'Đặt tên lỗ khoét',
                            initial: selHole.name,
                            onOK: (name) => replaceHole({ ...selHole, name }, true),
                        })}>
                            <Pencil size={15} />
                        </button>
                        <button className="fb-btn" onClick={() => duplicateHole(selHole)} title="Nhân bản">
                            <Copy size={15} />
                        </button>
                        <button className="fb-btn" style={{ color: '#dc2626' }} onClick={() => setConfirm({
                            title: `Xoá "${selHole.name}"?`,
                            actionLabel: 'Xoá lỗ',
                            onOK: () => removeHole(selHole.id),
                        })}>
                            <Trash2 size={15} />
                        </button>
                    </div>
                )}
            </div>

            {/* Bottom bar — 1 chạm thêm lỗ bếp / chậu / lavabo / ổ điện / lỗ tròn */}
            <div className="tool-bar">
                <button className="tool" onClick={() => addHole('hob')}>
                    <Flame size={20} style={{ color: '#f59e0b' }} />
                    Bếp từ
                </button>
                <button className="tool" onClick={() => addHole('sink')}>
                    <Droplets size={20} style={{ color: '#0ea5e9' }} />
                    Chậu rửa
                </button>
                <button className="tool" onClick={() => addHole('lavabo')}>
                    <Layers size={20} style={{ color: '#06b6d4' }} />
                    Lavabo
                </button>
                <button className="tool" onClick={() => setShowSocketSheet(true)}>
                    <Plug size={20} style={{ color: '#10b981' }} />
                    Ổ điện
                </button>
                <button className="tool" onClick={() => setShowRoundSheet(true)}>
                    <CircleDot size={20} style={{ color: '#3b82f6' }} />
                    Lỗ tròn
                </button>
                <button className="tool" onClick={() => setShowSurfaceSheet(true)}>
                    <Maximize2 size={20} />
                    Khổ tấm
                </button>
            </div>

            {/* Sheet Ổ điện / công tắc */}
            <Sheet open={showSocketSheet} onClose={() => setShowSocketSheet(false)} title="Thêm lỗ ổ điện / chờ KT">
                {SOCKET_PRESETS.map(sp => (
                    <button key={sp.key} className="sheet-row" onClick={() => {
                        setShowSocketSheet(false);
                        addHole(sp.key === 'tv_box' ? 'rect' : sp.key, { name: sp.name.split(' (')[0], w: sp.w, h: sp.h, r: 4, color: '#34d399' });
                    }}>
                        <Plug size={18} style={{ color: '#10b981' }} />
                        <div style={{ flex: 1 }}>
                            {sp.name}
                            <div className="sub">Đo chuẩn tới mép hoặc chuyển "Tâm lỗ" ở trên</div>
                        </div>
                    </button>
                ))}
            </Sheet>

            {/* Sheet Lỗ tròn Ø */}
            <Sheet open={showRoundSheet} onClose={() => setShowRoundSheet(false)} title="Thêm lỗ tròn (vòi, ống thoát, hút mùi)">
                {ROUND_PRESETS.map(rp => (
                    <button key={rp.key} className="sheet-row" onClick={() => {
                        setShowRoundSheet(false);
                        addHole('faucet', { shape: 'circle', name: rp.name, w: rp.d, h: rp.d });
                    }}>
                        <CircleDot size={18} style={{ color: '#3b82f6' }} />
                        <div style={{ flex: 1 }}>{rp.name}</div>
                    </button>
                ))}
                <button className="sheet-row" onClick={() => {
                    setShowRoundSheet(false);
                    setNumpad({
                        title: 'Nhập đường kính lỗ tròn (Ø mm)',
                        initial: 45,
                        onOK: (d) => addHole('faucet', { shape: 'circle', name: `Lỗ Ø${Math.round(d)}`, w: d, h: d }),
                    });
                }}>
                    <Plus size={18} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Nhập đường kính Ø khác...</div>
                </button>
            </Sheet>

            {/* Sheet Khổ bề mặt ngoài */}
            <Sheet open={showSurfaceSheet} onClose={() => setShowSurfaceSheet(false)} title="Khổ đá / Mảng tường ngoài" sub={`Hiện tại: ${Math.round(cutout.w)} × ${Math.round(cutout.h)} mm (dày ${cutout.thickness || 20}mm)`}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <button className="btn" onClick={() => {
                        setShowSurfaceSheet(false);
                        setNumpad({ title: 'Chiều rộng W (mm)', initial: cutout.w, onOK: v => updateOuterSize('w', v) });
                    }}>Rộng: {Math.round(cutout.w)} mm</button>
                    <button className="btn" onClick={() => {
                        setShowSurfaceSheet(false);
                        setNumpad({ title: 'Sâu / Cao H (mm)', initial: cutout.h, onOK: v => updateOuterSize('h', v) });
                    }}>Sâu/Cao: {Math.round(cutout.h)} mm</button>
                </div>
                <button className="sheet-row" onClick={() => {
                    setShowSurfaceSheet(false);
                    setNumpad({
                        title: 'Độ dày đá / tường (mm)',
                        initial: cutout.thickness || 20,
                        onOK: v => commit({ ...cutout, thickness: Math.max(1, Math.round(v)) }),
                    });
                }}>
                    <Maximize2 size={18} style={{ color: 'var(--ink-2)' }} />
                    <div style={{ flex: 1 }}>Độ dày vật liệu<div className="sub">{cutout.thickness || 20} mm</div></div>
                </button>
                <div style={{ padding: '10px 0 4px', fontSize: 12.5, fontWeight: 700, color: 'var(--muted)' }}>Áp dụng mẫu chuẩn</div>
                {SURFACE_PRESETS.map(p => (
                    <button key={p.key} className="sheet-row" onClick={() => applySurfacePreset(p)}>
                        <Maximize2 size={18} style={{ color: 'var(--blue)' }} />
                        <div style={{ flex: 1 }}>
                            {p.name}
                            <div className="sub">{p.w} × {p.h} mm · dày {p.thickness}mm</div>
                        </div>
                    </button>
                ))}
            </Sheet>

            {/* Sheet Danh sách lỗ */}
            <Sheet open={showHoleList} onClose={() => setShowHoleList(false)} title={`Danh sách lỗ khoét (${holes.length})`} sub={`Đo từ mép ngoài (${refMode === 'center' ? 'theo Tâm' : 'theo Mép'})`}>
                {holes.map(h => {
                    const o = cutoutOffsets(cutout, h, refMode);
                    return (
                        <div key={h.id} className="sheet-row" style={{ cursor: 'pointer' }} onClick={() => { setSelId(h.id); setShowHoleList(false); }}>
                            <div style={{ width: 10, height: 10, borderRadius: 3, background: h.color || '#38bdf8', flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700 }}>{h.name} · {h.shape === 'circle' ? `Ø${Math.round(h.w)}` : `${Math.round(h.w)}×${Math.round(h.h)}`}</div>
                                <div className="sub">Trái {o.left} · Phải {o.right} · Trên {o.top} · Dưới {o.bottom}</div>
                            </div>
                            <button className="icon-btn" style={{ color: '#dc2626' }} onClick={(e) => { e.stopPropagation(); removeHole(h.id); }}>
                                <X size={16} />
                            </button>
                        </div>
                    );
                })}
                <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => { setShowHoleList(false); addHole('rect'); }}>
                    <Plus size={16} /> Thêm lỗ chữ nhật mới
                </button>
            </Sheet>

            {/* Export DXF / Ảnh */}
            <Sheet open={showExport} onClose={() => setShowExport(false)} title="Xuất bản vẽ Đo lỗ khoét">
                <button className="sheet-row" onClick={() => doExport('share')}>
                    <Share2 size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Chia sẻ ảnh<div className="sub">Gửi thợ đá / điện qua Zalo, Messenger...</div></div>
                </button>
                <button className="sheet-row" onClick={() => doExport('png')}>
                    <ImageIcon size={19} style={{ color: 'var(--ok)' }} />
                    <div style={{ flex: 1 }}>Tải PNG nét cao</div>
                </button>
                <button className="sheet-row" onClick={() => doExport('dxf')}>
                    <FileDown size={19} style={{ color: 'var(--violet)' }} />
                    <div style={{ flex: 1 }}>Xuất AutoCAD DXF (CNC)<div className="sub">Chuẩn mm 1:1 kèm đường cắt bo góc &amp; kích thước 4 cạnh</div></div>
                </button>
            </Sheet>

            <NumPad cfg={numpad} onClose={() => setNumpad(null)} />
            <TextSheet cfg={textSheet} onClose={() => setTextSheet(null)} />
            <Confirm cfg={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
