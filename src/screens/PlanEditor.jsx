import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Group } from 'react-konva';
import {
    ArrowLeft, Undo2, Redo2, Share2, BrickWall, Ruler, DoorOpen, AppWindow,
    MessageSquareText, Settings2, Trash2, X, Pencil, FlipHorizontal2, Image as ImageIcon, FileDown,
} from 'lucide-react';
import PlanGrid from '../plan/PlanGrid';
import WallsLayer from '../plan/WallsLayer';
import RoomLabels from '../plan/RoomLabels';
import DrawPreview from '../plan/DrawPreview';
import NoteMarker from '../photo/NoteMarker';
import Sheet from '../ui/Sheet';
import NumPad from '../ui/NumPad';
import TextSheet from '../ui/TextSheet';
import Confirm from '../ui/Confirm';
import { toast } from '../ui/Toast';
import {
    genId, dist, snapToGrid, snapOrtho, findNearbyNode,
    applyWallLength, scaleAllWalls, snapToWall, splitWallAtPoint, bboxOfPlan,
} from '../lib/geometry';
import {
    addWallSegment, deleteWall, moveNode, renameRoom, recomputeRooms,
    addOpening, removeOpening, updateOpening,
} from '../lib/planModel';
import { generateDxf } from '../lib/dxf';
import { stageToDataURL, downloadDataURL, downloadText, shareDataURL, stamp } from '../lib/export';

const MODES = [
    { id: 'draw', icon: BrickWall, label: 'Tường' },
    { id: 'editKT', icon: Ruler, label: 'Sửa KT' },
    { id: 'door', icon: DoorOpen, label: 'Cửa' },
    { id: 'window', icon: AppWindow, label: 'Cửa sổ' },
    { id: 'note', icon: MessageSquareText, label: 'Ghi chú' },
];

export default function PlanEditor({ doc, onChange, onBack }) {
    const docRef = useRef(doc);
    useEffect(() => { docRef.current = doc; }, [doc]);

    const [mode, setModeRaw] = useState(doc.plan.walls.length ? 'select' : 'draw');
    const [chain, setChain] = useState(null);
    const [preview, setPreview] = useState(null);
    const [sel, setSel] = useState(null); // {kind:'wall'|'opening'|'note', id, wallId?}
    const [view, setView] = useState(doc.view || null);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const [numpad, setNumpad] = useState(null);
    const [textSheet, setTextSheet] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [openingSheet, setOpeningSheet] = useState(null); // {wallId, openingId}
    const [showExport, setShowExport] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [, bumpHist] = useState(0);

    const stageRef = useRef(null);
    const wrapRef = useRef(null);
    const gestureRef = useRef(null);
    const historyRef = useRef({ stack: [{ plan: doc.plan, notes: doc.notes || [] }], i: 0 });

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
        if (view || !stageSize.width || !stageSize.height) return;
        const bb = bboxOfPlan(doc.plan, doc.notes);
        let v;
        if (bb && bb.width > 0) {
            const s = Math.min((stageSize.width - 60) / bb.width, (stageSize.height - 60) / bb.height);
            v = { scale: s, x: (stageSize.width - bb.width * s) / 2 - bb.x * s, y: (stageSize.height - bb.height * s) / 2 - bb.y * s };
        } else {
            const FIT = 12000;
            const s = Math.min((stageSize.width - 40) / FIT, (stageSize.height - 40) / FIT);
            v = { scale: s, x: (stageSize.width - FIT * s) / 2, y: (stageSize.height - FIT * s) / 2 };
        }
        setView(v);
    }, [stageSize, view, doc.plan, doc.notes]);

    // ===== Ephemeral state refresh after plan changes =====
    const syncEphemeral = (plan, notes) => {
        setChain(c => {
            if (!c) return c;
            if (c.anchor.nodeId) {
                const nd = plan.nodes.find(n => n.id === c.anchor.nodeId);
                if (!nd) return null;
                return { anchor: { nodeId: nd.id, x: nd.x, y: nd.y } };
            }
            return c;
        });
        setSel(s => {
            if (!s) return s;
            if (s.kind === 'wall' && !plan.walls.some(w => w.id === s.id)) return null;
            if (s.kind === 'opening') {
                const w = plan.walls.find(x => x.id === s.wallId);
                if (!w || !(w.openings || []).some(o => o.id === s.id)) return null;
            }
            if (s.kind === 'note' && !notes.some(n => n.id === s.id)) return null;
            return s;
        });
    };

    // ===== History / commit =====
    const commit = (plan, notes) => {
        const d = docRef.current;
        const p = plan !== undefined ? plan : d.plan;
        const n = notes !== undefined ? notes : (d.notes || []);
        const h = historyRef.current;
        h.stack = h.stack.slice(0, h.i + 1);
        h.stack.push({ plan: p, notes: n });
        if (h.stack.length > 50) h.stack.shift();
        h.i = h.stack.length - 1;
        bumpHist(v => v + 1);
        onChange({ ...d, plan: p, notes: n, updatedAt: Date.now() });
        syncEphemeral(p, n);
    };

    const applySnapshot = (s) => {
        onChange({ ...docRef.current, plan: s.plan, notes: s.notes, updatedAt: Date.now() });
        syncEphemeral(s.plan, s.notes);
        setPreview(null);
        setOpeningSheet(null);
        bumpHist(v => v + 1);
    };

    const canUndo = historyRef.current.i > 0;
    const canRedo = historyRef.current.i < historyRef.current.stack.length - 1;
    const undo = () => { const h = historyRef.current; if (h.i > 0) { h.i--; applySnapshot(h.stack[h.i]); } };
    const redo = () => { const h = historyRef.current; if (h.i < h.stack.length - 1) { h.i++; applySnapshot(h.stack[h.i]); } };

    // ===== Mode switching =====
    const setMode = (m) => {
        setModeRaw(m);
        setSel(null);
        setPreview(null);
        setOpeningSheet(null);
        if (m === 'draw') {
            // resume from the end of the last wall so the next segment continues the outline
            const plan = docRef.current.plan;
            if (plan.walls.length) {
                const lw = plan.walls[plan.walls.length - 1];
                const nd = plan.nodes.find(n => n.id === lw.b);
                setChain(nd ? { anchor: { nodeId: nd.id, x: nd.x, y: nd.y } } : null);
            } else {
                setChain(null);
            }
        } else {
            setChain(null);
        }
    };

    // ===== Geometry helpers =====
    const resolvePoint = (worldPt, anchorPt) => {
        const s = docRef.current.settings || {};
        const tol = 24 / (view?.scale || 1);
        const near = findNearbyNode(docRef.current.plan.nodes, worldPt, tol);
        if (near) return { nodeId: near.id, x: near.x, y: near.y };
        let pt = worldPt;
        if (s.gridSnap !== false) pt = snapToGrid(pt, s.gridMinor || 100);
        if (anchorPt && s.ortho !== false) pt = snapOrtho(anchorPt, pt);
        return { nodeId: null, x: pt.x, y: pt.y };
    };

    const snapFn = (pt) => {
        const s = docRef.current.settings || {};
        return s.gridSnap !== false ? snapToGrid(pt, s.gridMinor || 100) : pt;
    };

    // ===== NumPad for wall dimension =====
    const openWallNumPad = (wallId, planArg, isAuto) => {
        const plan = planArg || docRef.current.plan;
        const wall = plan.walls.find(w => w.id === wallId);
        if (!wall) return;
        const a = plan.nodes.find(n => n.id === wall.a);
        const b = plan.nodes.find(n => n.id === wall.b);
        if (!a || !b) return;
        const cur = Math.round(dist(a, b));
        setNumpad({
            title: isAuto ? 'Số đo laser — tường đầu tiên' : 'Chiều dài tường',
            initial: cur,
            hint: !plan.calibrated ? 'Lần nhập đầu tiên: toàn bộ hình sẽ scale theo tỉ lệ này' : null,
            onOK: (val) => {
                const p = docRef.current.plan;
                if (!p.calibrated) {
                    const { plan: scaled } = scaleAllWalls(p, wallId, val);
                    commit(recomputeRooms(scaled), undefined);
                    toast('Đã hiệu chỉnh tỉ lệ toàn mặt bằng', 'ok');
                } else {
                    const { plan: resized, warning } = applyWallLength(p, wallId, val);
                    commit(recomputeRooms(resized), undefined);
                    if (warning) toast(warning);
                }
            },
        });
    };

    // ===== Tap dispatch =====
    const handleTapEmpty = (w) => {
        if (mode === 'draw') {
            if (!chain) {
                setChain({ anchor: resolvePoint(w, null) });
                setPreview(null);
                return;
            }
            const anchorPt = { x: chain.anchor.x, y: chain.anchor.y };
            let end = resolvePoint(w, anchorPt);
            if (dist(anchorPt, end) < 50) return; // accidental double tap
            let plan = docRef.current.plan;
            if (!end.nodeId) {
                const hit = snapToWall(plan, end, 20 / view.scale);
                if (hit) {
                    const r = splitWallAtPoint(plan, hit.wallId, hit);
                    plan = r.plan;
                    end = { nodeId: r.newNodeId, x: hit.x, y: hit.y };
                }
            }
            const res = addWallSegment(plan, chain.anchor, end, docRef.current.settings?.thickness || 110);
            if (res.added) {
                const newPlan = recomputeRooms(res.plan);
                commit(newPlan, undefined);
                if (!newPlan.calibrated && newPlan.walls.length === 1) {
                    openWallNumPad(newPlan.walls[0].id, newPlan, true);
                }
            }
            if (res.closed) {
                setChain(null);
                setPreview(null);
                if (res.added) toast('Đã khép kín — phòng được tạo tự động', 'ok');
            } else {
                setChain({ anchor: { nodeId: res.endNodeId, x: end.x, y: end.y } });
            }
            return;
        }
        if (mode === 'note') {
            setTextSheet({
                title: 'Ghi chú',
                placeholder: 'VD: Trần thạch cao hỏng, ổ điện lệch...',
                onOK: (text) => {
                    const d = docRef.current;
                    commit(undefined, [...(d.notes || []), { id: genId('t'), x: w.x, y: w.y, text }]);
                },
            });
            return;
        }
        if (mode === 'door' || mode === 'window') {
            toast(`Chạm vào một bức tường để đặt ${mode === 'door' ? 'cửa đi' : 'cửa sổ'}`);
            return;
        }
        if (mode === 'select') {
            setSel(null);
            setOpeningSheet(null);
        }
    };

    const onWallTap = (wallId, t) => {
        if (mode === 'editKT') { openWallNumPad(wallId); return; }
        if (mode === 'door' || mode === 'window') {
            const type = mode === 'door' ? 'door' : 'window';
            const width = type === 'door' ? 900 : 1200;
            const { plan, openingId } = addOpening(docRef.current.plan, wallId, t, type, width);
            commit(plan, undefined);
            setModeRaw('select');
            setChain(null);
            setSel({ kind: 'opening', id: openingId, wallId });
            setOpeningSheet({ wallId, openingId });
            return;
        }
        setSel({ kind: 'wall', id: wallId });
        setOpeningSheet(null);
    };

    const onOpeningTap = (wallId, openingId) => {
        setSel({ kind: 'opening', id: openingId, wallId });
        setOpeningSheet({ wallId, openingId });
    };

    const onRoomTap = (roomId) => {
        const r = (docRef.current.plan.rooms || []).find(x => x.id === roomId);
        if (!r) return;
        setTextSheet({
            title: 'Tên phòng',
            initial: r.name,
            onOK: (name) => commit(renameRoom(docRef.current.plan, roomId, name), undefined),
        });
    };

    const onNodeDrag = (nodeId, pos, commitFlag) => {
        const p = moveNode(docRef.current.plan, nodeId, pos);
        if (commitFlag) commit(recomputeRooms(p), undefined);
        else onChange({ ...docRef.current, plan: p });
    };

    // ===== Pointer / gesture handling (tap-end pattern: drag pans, clean tap acts) =====
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

    const onDown = (e) => {
        if (e.evt?.touches?.length === 2) {
            if (e.evt.cancelable) e.evt.preventDefault();
            const rect = stageRef.current.container().getBoundingClientRect();
            gestureRef.current = { type: 'pinch', lastDist: touchDist(e.evt.touches), lastCenter: touchCenter(e.evt.touches, rect) };
            return;
        }
        if (e.target.name?.() === 'handle') return;
        if (e.evt?.cancelable) e.evt.preventDefault();
        const p = getPos(e);
        if (!p) return;
        gestureRef.current = { type: 'tap', sx: p.x, sy: p.y, startView: { ...view } };
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
        if (g && g.type === 'tap') {
            if (Math.hypot(p.x - g.sx, p.y - g.sy) > 10) g.type = 'pan';
        }
        if (g && g.type === 'pan') {
            if (e.evt?.cancelable) e.evt.preventDefault();
            setView(v => ({ ...v, x: g.startView.x + (p.x - g.sx), y: g.startView.y + (p.y - g.sy) }));
        }
        if (mode === 'draw' && chain) {
            const w = toWorld(p);
            setPreview(resolvePoint(w, { x: chain.anchor.x, y: chain.anchor.y }));
        }
    };

    const onUp = (e) => {
        const g = gestureRef.current;
        gestureRef.current = null;
        if (!g || g.type !== 'tap') return;
        if (e.evt?.touches?.length > 0) return; // another finger still down
        const t = e.target;
        const isEmpty = t === t.getStage?.() || t.name?.() === 'plan-grid';
        if (!isEmpty) return;
        const p = getPos(e) || { x: g.sx, y: g.sy };
        handleTapEmpty(toWorld(p));
    };

    const onWheel = (e) => {
        e.evt.preventDefault();
        const scaleBy = 1.1;
        const stage = stageRef.current;
        const pointer = stage.getPointerPosition();
        const oldScale = view.scale;
        const mousePointTo = { x: (pointer.x - view.x) / oldScale, y: (pointer.y - view.y) / oldScale };
        const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
        setView({ scale: newScale, x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
    };

    // ===== Export =====
    const doExport = async (kind) => {
        setShowExport(false);
        setSel(null);
        setChain(null);
        setPreview(null);
        setOpeningSheet(null);
        const d = docRef.current;
        if (kind === 'dxf') {
            downloadText(generateDxf(d), `KS_${d.name}_${stamp()}.dxf`, 'application/dxf');
            toast('Đã xuất DXF (mm) — mở bằng AutoCAD', 'ok');
            return;
        }
        const bb = bboxOfPlan(d.plan, d.notes);
        if (!bb) { toast('Chưa có gì để xuất', 'err'); return; }
        await new Promise(r => setTimeout(r, 120));
        const crop = { x: bb.x - 500, y: bb.y - 500, width: bb.width + 1000, height: bb.height + 1000 };
        const format = kind === 'share' ? 'jpg' : kind;
        const uri = stageToDataURL(stageRef.current, { crop, format });
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

    // ===== Derived =====
    const settings = doc.settings || {};
    const listening = mode === 'select' || mode === 'editKT' || mode === 'door' || mode === 'window';
    const selOpening = openingSheet
        ? (doc.plan.walls.find(w => w.id === openingSheet.wallId)?.openings || []).find(o => o.id === openingSheet.openingId)
        : null;
    const selNote = sel?.kind === 'note' ? (doc.notes || []).find(n => n.id === sel.id) : null;

    const bannerText = () => {
        if (mode === 'draw') return chain
            ? 'Chạm điểm tiếp theo · chạm vào điểm cũ để khép phòng'
            : 'Chạm để đặt điểm bắt đầu tường';
        if (mode === 'editKT') return 'Chạm tường để nhập số đo laser · nhãn đỏ = đã nhập';
        if (mode === 'door') return 'Chạm vào tường để đặt cửa đi (900mm)';
        if (mode === 'window') return 'Chạm vào tường để đặt cửa sổ (1200mm)';
        if (mode === 'note') return 'Chạm vào vị trí cần ghi chú';
        return doc.plan.walls.length
            ? 'Chạm đối tượng để chọn · kéo để di chuyển · véo để zoom'
            : 'Bấm "Tường" bên dưới để bắt đầu vẽ mặt bằng';
    };

    return (
        <div className="screen">
            {/* Top bar */}
            <div className="hdr">
                <button className="icon-btn" onClick={handleBack}><ArrowLeft size={22} /></button>
                <div className="hdr-title">{doc.name}</div>
                <button className="icon-btn" style={{ opacity: canUndo ? 1 : .3 }} onClick={undo}><Undo2 size={20} /></button>
                <button className="icon-btn" style={{ opacity: canRedo ? 1 : .3 }} onClick={redo}><Redo2 size={20} /></button>
                <button className="icon-btn" onClick={() => setShowSettings(true)}><Settings2 size={20} /></button>
                <button className="icon-btn" style={{ color: 'var(--red-dark)' }} onClick={() => setShowExport(true)}><Share2 size={20} /></button>
            </div>

            {/* Mode banner */}
            <div className={`mode-banner ${mode}`}>
                <span>{bannerText()}</span>
                <span className="spacer" />
                {mode === 'draw' && chain && (
                    <>
                        <button className="banner-btn" onClick={() => { setChain(null); setPreview(null); }}>Điểm mới</button>
                        <button className="banner-btn solid" onClick={() => setMode('select')}>✓ Xong</button>
                    </>
                )}
                {mode !== 'select' && !(mode === 'draw' && chain) && (
                    <button className="banner-btn" onClick={() => setMode('select')}>✕ Thoát</button>
                )}
            </div>

            {/* Canvas */}
            <div className="editor-canvas" ref={wrapRef}>
                {view && stageSize.width > 0 && (
                    <Stage width={stageSize.width} height={stageSize.height} ref={stageRef}
                        scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
                        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
                        onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
                        onWheel={onWheel}>
                        <Layer>
                            <PlanGrid
                                stageScale={view.scale} stagePos={{ x: view.x, y: view.y }} stageSize={stageSize}
                                contentBounds={bboxOfPlan(doc.plan, doc.notes)}
                                gridMinor={settings.gridMinor || 100} gridMajor={settings.gridMajor || 1000}
                            />
                            <WallsLayer
                                plan={doc.plan} scale={view.scale} sel={sel}
                                listening={listening} showHandles={mode === 'select'}
                                onWallTap={onWallTap}
                                onLabelTap={(id) => openWallNumPad(id)}
                                onOpeningTap={onOpeningTap}
                                onNodeDrag={onNodeDrag}
                                snapFn={snapFn}
                            />
                            <RoomLabels plan={doc.plan} scale={view.scale} listening={mode === 'select'} onTap={onRoomTap} />
                            <Group listening={mode === 'select'}>
                                {(doc.notes || []).map(n => (
                                    <NoteMarker key={n.id} note={n} scale={view.scale}
                                        isSelected={sel?.kind === 'note' && sel.id === n.id}
                                        onSelect={(id) => { setSel({ kind: 'note', id }); setOpeningSheet(null); }}
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
                            {mode === 'draw' && (
                                <DrawPreview anchor={chain?.anchor} preview={preview}
                                    thickness={settings.thickness || 110} scale={view.scale} />
                            )}
                        </Layer>
                    </Stage>
                )}

                {/* Selection action bar */}
                {sel?.kind === 'wall' && mode === 'select' && (
                    <div className="float-bar">
                        <button className="fb-btn" style={{ color: 'var(--blue)' }} onClick={() => openWallNumPad(sel.id)}>
                            <Ruler size={16} /> Sửa KT
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" style={{ color: '#dc2626' }} onClick={() => setConfirm({
                            title: 'Xóa tường này?', actionLabel: 'Xóa tường',
                            onOK: () => { commit(recomputeRooms(deleteWall(docRef.current.plan, sel.id)), undefined); setSel(null); },
                        })}>
                            <Trash2 size={16} /> Xóa
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" onClick={() => setSel(null)}><X size={16} /></button>
                    </div>
                )}
                {selNote && mode === 'select' && (
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

            {/* Mode toolbar */}
            <div className="tool-bar">
                {MODES.map(m => {
                    const Icon = m.icon;
                    const on = mode === m.id;
                    return (
                        <button key={m.id} className={`tool ${on ? `on t-${m.id}` : ''}`}
                            onClick={() => setMode(on ? 'select' : m.id)}>
                            <Icon size={21} />
                            {m.label}
                        </button>
                    );
                })}
            </div>

            {/* ===== Sheets ===== */}
            <NumPad cfg={numpad} onClose={() => setNumpad(null)} />
            <TextSheet cfg={textSheet} onClose={() => setTextSheet(null)} />
            <Confirm cfg={confirm} onClose={() => setConfirm(null)} />

            {/* Opening detail */}
            <Sheet open={!!(openingSheet && selOpening)} onClose={() => setOpeningSheet(null)}
                title={selOpening?.type === 'door' ? 'Cửa đi' : 'Cửa sổ'}>
                {selOpening && (
                    <>
                        <button className="sheet-row" onClick={() => setNumpad({
                            title: `Chiều rộng ${selOpening.type === 'door' ? 'cửa đi' : 'cửa sổ'}`,
                            initial: selOpening.width,
                            onOK: (val) => {
                                commit(updateOpening(docRef.current.plan, openingSheet.wallId, openingSheet.openingId, { width: val }), undefined);
                            },
                        })}>
                            <Ruler size={19} style={{ color: 'var(--blue)' }} />
                            <div style={{ flex: 1 }}>Chiều rộng<div className="sub">{selOpening.width} mm</div></div>
                        </button>
                        {selOpening.type === 'door' && (
                            <button className="sheet-row" onClick={() => {
                                commit(updateOpening(docRef.current.plan, openingSheet.wallId, openingSheet.openingId, { flipped: !selOpening.flipped }), undefined);
                            }}>
                                <FlipHorizontal2 size={19} style={{ color: 'var(--violet)' }} />
                                <div style={{ flex: 1 }}>Đảo chiều mở cửa</div>
                            </button>
                        )}
                        <button className="sheet-row" style={{ color: '#dc2626' }} onClick={() => {
                            commit(removeOpening(docRef.current.plan, openingSheet.wallId, openingSheet.openingId), undefined);
                            setOpeningSheet(null);
                            setSel(null);
                        }}>
                            <Trash2 size={19} />
                            <div style={{ flex: 1 }}>Xóa {selOpening.type === 'door' ? 'cửa đi' : 'cửa sổ'}</div>
                        </button>
                    </>
                )}
            </Sheet>

            {/* Export */}
            <Sheet open={showExport} onClose={() => setShowExport(false)} title="Xuất mặt bằng">
                <button className="sheet-row" onClick={() => doExport('share')}>
                    <Share2 size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Chia sẻ ảnh<div className="sub">Zalo, Messenger, Email...</div></div>
                </button>
                <button className="sheet-row" onClick={() => doExport('png')}>
                    <ImageIcon size={19} style={{ color: 'var(--ok)' }} />
                    <div style={{ flex: 1 }}>Tải PNG<div className="sub">Nét cao, nền trắng</div></div>
                </button>
                <button className="sheet-row" onClick={() => doExport('jpg')}>
                    <ImageIcon size={19} style={{ color: 'var(--warn)' }} />
                    <div style={{ flex: 1 }}>Tải JPG<div className="sub">Nhẹ, gửi nhanh</div></div>
                </button>
                <button className="sheet-row" onClick={() => doExport('dxf')}>
                    <FileDown size={19} style={{ color: 'var(--violet)' }} />
                    <div style={{ flex: 1 }}>Xuất DXF<div className="sub">Mở AutoCAD, đơn vị mm</div></div>
                </button>
            </Sheet>

            {/* Draw settings */}
            <Sheet open={showSettings} onClose={() => setShowSettings(false)} title="Thiết lập vẽ">
                <div style={{ padding: '6px 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>Độ dày tường</div>
                <div className="chip-row">
                    {[110, 220].map(t => (
                        <button key={t} className={`chip ${settings.thickness === t ? 'on' : ''}`}
                            onClick={() => onChange({ ...docRef.current, settings: { ...settings, thickness: t } })}>
                            {t} mm
                        </button>
                    ))}
                    <button className={`chip ${![110, 220].includes(settings.thickness) ? 'on' : ''}`}
                        onClick={() => setNumpad({
                            title: 'Độ dày tường', initial: settings.thickness || 110,
                            onOK: (val) => onChange({ ...docRef.current, settings: { ...docRef.current.settings, thickness: val } }),
                        })}>
                        Khác...
                    </button>
                </div>
                <button className="sheet-row" onClick={() => onChange({ ...docRef.current, settings: { ...settings, ortho: settings.ortho === false } })}>
                    <div style={{ flex: 1 }}>Vẽ vuông góc<div className="sub">Tự động khóa ngang / dọc</div></div>
                    <div className={`sync-chip ${settings.ortho !== false ? 'on' : 'off'}`}>{settings.ortho !== false ? 'BẬT' : 'TẮT'}</div>
                </button>
                <button className="sheet-row" onClick={() => onChange({ ...docRef.current, settings: { ...settings, gridSnap: settings.gridSnap === false } })}>
                    <div style={{ flex: 1 }}>Bắt lưới 100mm<div className="sub">Điểm vẽ dính vào lưới</div></div>
                    <div className={`sync-chip ${settings.gridSnap !== false ? 'on' : 'off'}`}>{settings.gridSnap !== false ? 'BẬT' : 'TẮT'}</div>
                </button>
            </Sheet>
        </div>
    );
}
