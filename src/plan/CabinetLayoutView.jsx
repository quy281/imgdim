import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Stage, Layer, Group, Rect, Line, Text } from 'react-konva';
import {
    X, SlidersHorizontal, Eye, EyeOff, FileDown, Share2, RotateCcw, Plus, Minus,
} from 'lucide-react';
import { catalogItem } from '../lib/furnitureCatalog';
import {
    DOOR_TYPES, MATERIAL_PALETTE, isParametricCabinet,
    resolveParametricConfig, setBayCount,
} from '../lib/parametricModel';
import { buildSixViewsBundle } from '../lib/projectionEngine';
import { generateCabinetDxf } from '../lib/dxf';
import { stageToDataURL, downloadText, shareDataURL, stamp } from '../lib/export';
import { toast } from '../ui/Toast';

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

const VIEW_TABS = [
    { id: 'all', label: 'Đủ 6 mặt' },
    { id: 'front', label: 'Mặt đứng' },
    { id: 'sectionAA', label: 'Cắt A-A' },
    { id: 'sectionBB', label: 'Cắt B-B' },
    { id: 'iso3d', label: 'Phối cảnh 3D' },
];

/**
 * Vẽ đường kích thước kỹ thuật (ngang hoặc đứng) với gióng và gạch chéo kiến trúc (tick 45°).
 */
function TechDimH({ x1, x2, yRef, yDim, val, inv, color = '#059669' }) {
    if (Math.abs(x2 - x1) < 1) return null;
    const sw = 1.0 * inv;
    const tick = 4.5 * inv;
    const ext = 6 * inv;
    const dir = yDim >= yRef ? 1 : -1;
    const txt = String(Math.round(val ?? Math.abs(x2 - x1)));
    const mid = (x1 + x2) / 2;
    return (
        <Group listening={false}>
            <Line points={[x1, yRef, x1, yDim + dir * ext]} stroke={color} strokeWidth={sw * 0.75} />
            <Line points={[x2, yRef, x2, yDim + dir * ext]} stroke={color} strokeWidth={sw * 0.75} />
            <Line points={[x1 - ext, yDim, x2 + ext, yDim]} stroke={color} strokeWidth={sw} />
            <Line points={[x1 - tick, yDim + tick, x1 + tick, yDim - tick]} stroke={color} strokeWidth={sw * 1.4} />
            <Line points={[x2 - tick, yDim + tick, x2 + tick, yDim - tick]} stroke={color} strokeWidth={sw * 1.4} />
            <Text
                text={txt}
                x={mid - 40 * inv}
                y={dir < 0 ? yDim - 13 * inv : yDim + 3 * inv}
                width={80 * inv}
                align="center"
                fontSize={9.5 * inv}
                fontFamily={FONT}
                fontStyle="700"
                fill={color}
            />
        </Group>
    );
}

function TechDimV({ y1, y2, xRef, xDim, val, inv, color = '#059669' }) {
    if (Math.abs(y2 - y1) < 1) return null;
    const sw = 1.0 * inv;
    const tick = 4.5 * inv;
    const ext = 6 * inv;
    const dir = xDim >= xRef ? 1 : -1;
    const txt = String(Math.round(val ?? Math.abs(y2 - y1)));
    const mid = (y1 + y2) / 2;
    return (
        <Group listening={false}>
            <Line points={[xRef, y1, xDim + dir * ext, y1]} stroke={color} strokeWidth={sw * 0.75} />
            <Line points={[xRef, y2, xDim + dir * ext, y2]} stroke={color} strokeWidth={sw * 0.75} />
            <Line points={[xDim, y1 - ext, xDim, y2 + ext]} stroke={color} strokeWidth={sw} />
            <Line points={[xDim - tick, y1 + tick, xDim + tick, y1 - tick]} stroke={color} strokeWidth={sw * 1.4} />
            <Line points={[xDim - tick, y2 + tick, xDim + tick, y2 - tick]} stroke={color} strokeWidth={sw * 1.4} />
            <Text
                text={txt}
                x={dir > 0 ? xDim + 4 * inv : xDim - 44 * inv}
                y={mid - 5 * inv}
                width={40 * inv}
                align={dir > 0 ? 'left' : 'right'}
                fontSize={9.5 * inv}
                fontFamily={FONT}
                fontStyle="700"
                fill={color}
            />
        </Group>
    );
}

/**
 * Render một khung nhìn 2D (u sang phải, v từ đáy lên đỉnh -> Konva y = ox_bottom - v).
 */
function OrthoViewport({ view, x, yBottom, title, sub, inv, children }) {
    const sw = 1.2 * inv;
    return (
        <Group listening={false}>
            {/* Nền nhẹ cho các tiết diện bị mặt phẳng cắt đi qua */}
            {(view.cutRects || []).map((cr, idx) => (
                <Rect
                    key={`cf-${idx}`}
                    x={x + cr.u0}
                    y={yBottom - cr.v1}
                    width={cr.u1 - cr.u0}
                    height={cr.v1 - cr.v0}
                    fill="rgba(207,160,110,0.22)"
                />
            ))}
            {view.segments.map((seg, idx) => {
                let stroke = '#334155';
                let width = sw;
                let dash;
                if (seg.weight === 'cut') {
                    stroke = '#0f172a';
                    width = sw * 1.85;
                } else if (seg.weight === 'outline') {
                    stroke = '#1e293b';
                    width = sw * 1.35;
                } else if (seg.weight === 'hatch') {
                    stroke = '#64748b';
                    width = sw * 0.65;
                } else if (seg.weight === 'swing') {
                    stroke = '#94a3b8';
                    width = sw * 0.85;
                    dash = [5 * inv, 4 * inv];
                } else if (seg.weight === 'thin') {
                    stroke = '#64748b';
                    width = sw * 0.8;
                }
                return (
                    <Line
                        key={idx}
                        points={[x + seg.u1, yBottom - seg.v1, x + seg.u2, yBottom - seg.v2]}
                        stroke={stroke}
                        strokeWidth={width}
                        dash={dash}
                        lineCap="round"
                    />
                );
            })}
            {children}
            <Text
                text={title}
                x={x - 100 * inv}
                y={yBottom + 34 * inv}
                width={view.width + 200 * inv}
                align="center"
                fontSize={11.5 * inv}
                fontFamily={FONT}
                fontStyle="700"
                fill="#0f172a"
            />
            {sub && (
                <Text
                    text={sub}
                    x={x - 100 * inv}
                    y={yBottom + 48 * inv}
                    width={view.width + 200 * inv}
                    align="center"
                    fontSize={9.5 * inv}
                    fontFamily={FONT}
                    fill="#64748b"
                />
            )}
        </Group>
    );
}

/**
 * Render khung nhìn Phối cảnh 3D có tô màu vật liệu & viền đen sắc nét kiểu SketchUp.
 */
function Iso3DViewport({ iso, x, yBottom, scaleFactor = 1, title, sub, inv, hitBox }) {
    const sw = 1.05 * inv;
    const W = iso.width * scaleFactor;
    const H = iso.height * scaleFactor;
    return (
        <Group>
            {hitBox && (
                <Rect
                    name="iso-orbit-zone"
                    x={x - 20 * inv}
                    y={yBottom - H - 20 * inv}
                    width={W + 40 * inv}
                    height={H + 55 * inv}
                    fill="rgba(248,250,252,0.01)"
                />
            )}
            {iso.polygons.map((poly, idx) => {
                const flat = [];
                for (const pt of poly.pts) {
                    flat.push(x + pt.u * scaleFactor, yBottom - pt.v * scaleFactor);
                }
                return (
                    <Line
                        key={idx}
                        points={flat}
                        closed
                        fill={poly.fill}
                        stroke="#1e293b"
                        strokeWidth={sw}
                        lineJoin="round"
                        listening={false}
                    />
                );
            })}
            <Text
                text={title}
                x={x - 80 * inv}
                y={yBottom + 34 * inv}
                width={W + 160 * inv}
                align="center"
                fontSize={11.5 * inv}
                fontFamily={FONT}
                fontStyle="700"
                fill="#0f172a"
                listening={false}
            />
            {sub && (
                <Text
                    text={sub}
                    x={x - 80 * inv}
                    y={yBottom + 48 * inv}
                    width={W + 160 * inv}
                    align="center"
                    fontSize={9.5 * inv}
                    fontFamily={FONT}
                    fill="#64748b"
                    listening={false}
                />
            )}
        </Group>
    );
}

export default function CabinetLayoutView({
    doc, itemId, onSelectItem, onUpdateItem, onAskNumPad, onClose,
}) {
    const wrapRef = useRef(null);
    const stageRef = useRef(null);
    const gestureRef = useRef(null);

    const [size, setSize] = useState({ width: 0, height: 0 });
    const [focusView, setFocusView] = useState('all');
    const [hideDoors, setHideDoors] = useState(false);
    const [showConfig, setShowConfig] = useState(false);
    const [orbit, setOrbit] = useState({ yaw: -34, pitch: 22 });
    const [view, setView] = useState(null);
    const [busy, setBusy] = useState(false);

    const allItems = doc.furniture || [];
    const item = allItems.find(f => f.id === itemId) || allItems[0];
    const itemIndex = allItems.findIndex(f => f.id === item?.id);
    const cat = item ? catalogItem(item.kind) : null;
    const canEditBays = item ? isParametricCabinet(item.kind) && item.kind !== 'altar' && item.kind !== 'altarsmall' : false;

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setSize({ width: el.offsetWidth, height: el.offsetHeight });
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, [showConfig]);

    const bundle = useMemo(() => {
        if (!item) return null;
        return buildSixViewsBundle(item, cat, {
            hideDoors,
            yawDeg: orbit.yaw,
            pitchDeg: orbit.pitch,
        });
    }, [item, cat, hideDoors, orbit]);

    // Tính bố cục toạ độ (mm) cho toàn tờ 6 khung nhìn hoặc khung nhìn đơn đang phóng to
    const layout = useMemo(() => {
        if (!bundle) return null;
        const { w, d, h } = bundle.config;
        const { front, left, sectionAA, plan, sectionBB, iso3d } = bundle.views;

        if (focusView !== 'all') {
            if (focusView === 'iso3d') {
                const pad = Math.max(250, iso3d.width * 0.16);
                return {
                    mode: 'iso3d',
                    bbox: { x: -pad, y: -iso3d.height - pad, width: iso3d.width + pad * 2, height: iso3d.height + pad * 2.3 },
                };
            }
            const target = bundle.views[focusView];
            const padX = Math.max(380, target.width * 0.22);
            const padY = Math.max(380, target.height * 0.22);
            return {
                mode: focusView,
                target,
                bbox: { x: -padX, y: -target.height - padY, width: target.width + padX * 2, height: target.height + padY * 2.2 },
            };
        }

        const colGap = Math.max(580, Math.max(w, h) * 0.30);
        const rowGap = Math.max(660, Math.max(h, d) * 0.32);

        // Cột 1: Mặt đứng & Mặt bằng; Cột 2: Mặt bên (trên) & Cắt B-B (dưới); Cột 3: Cắt A-A (trên) & 3D (dưới)
        const col1X = 0;
        const col2X = col1X + w + colGap;
        const col3X = col2X + Math.max(d, w * 0.52) + colGap;

        const topRowBottomY = 0; // Sàn z=0 của hàng trên nằm ở y = 0 (đỉnh ở y = -h)
        const btmRowTopY = topRowBottomY + rowGap;
        const btmRowBottomY = btmRowTopY + d;

        // Co giãn nhẹ Phối cảnh 3D để cân xứng đẹp mắt ở góc dưới phải (giống tỉ lệ 1:40 trên tờ Betagon)
        const targetIsoH = Math.max(d * 1.25, h * 0.56);
        const isoScale = targetIsoH / Math.max(1, iso3d.height);
        const isoX = Math.max(col2X + w + colGap * 0.65, col3X);
        const isoBottomY = btmRowBottomY + (targetIsoH - d) * 0.25;

        const pad = Math.max(460, Math.max(w, h) * 0.20);
        const maxRight = Math.max(col3X + d, isoX + iso3d.width * isoScale);
        const minTop = -h - pad;
        const maxBtm = Math.max(btmRowBottomY, isoBottomY) + pad * 1.15;

        return {
            mode: 'all',
            col1X, col2X, col3X,
            topRowBottomY,
            btmRowBottomY,
            isoX, isoBottomY, isoScale,
            bbox: {
                x: -pad,
                y: minTop,
                width: maxRight + pad * 2,
                height: maxBtm - minTop,
            },
        };
    }, [bundle, focusView]);

    // Tự căn vừa khung hình khi đổi món đồ hoặc đổi tab khung nhìn
    const fitKey = `${item?.id}-${focusView}-${size.width}x${size.height}`;
    const lastFitKey = useRef('');
    useEffect(() => {
        if (!layout || !size.width || !size.height) return;
        if (lastFitKey.current === fitKey) return;
        lastFitKey.current = fitKey;
        const bb = layout.bbox;
        const s = Math.min(size.width / bb.width, size.height / bb.height) * 0.94;
        setView({
            scale: s,
            x: size.width / 2 - (bb.x + bb.width / 2) * s,
            y: size.height / 2 - (bb.y + bb.height / 2) * s,
        });
    }, [fitKey, layout, size]);

    if (!item || !bundle || !layout) return null;

    const cfg = bundle.config;
    const activeBayIdx = Math.min(cfg.cutBayIndex || 0, cfg.bays.length - 1);
    const activeBay = cfg.bays[activeBayIdx] || cfg.bays[0];

    const saveParam = (patch) => {
        const nextParam = { ...(item.param || {}), ...cfg, ...patch };
        delete nextParam.w;
        delete nextParam.d;
        delete nextParam.h;
        onUpdateItem({ ...item, param: nextParam });
    };

    const updateBay = (bayIdx, bayPatch) => {
        const nextBays = cfg.bays.map((b, i) => (i === bayIdx ? { ...b, ...bayPatch } : b));
        saveParam({ bays: nextBays, cutBayIndex: bayIdx });
    };

    // ===== Xử lý Kéo Pan / Zoom & Kéo Xoay 3D trực tiếp =====
    const getPtr = (e) => {
        const stage = stageRef.current;
        if (!stage) return null;
        if (e.evt?.touches?.length > 0) {
            const t = e.evt.touches[0];
            const r = stage.container().getBoundingClientRect();
            return { x: t.clientX - r.left, y: t.clientY - r.top };
        }
        return stage.getPointerPosition();
    };

    const onDown = (e) => {
        if (!view) return;
        if (e.evt?.touches?.length === 2) {
            const ts = e.evt.touches;
            const dist = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
            const r = stageRef.current.container().getBoundingClientRect();
            const center = {
                x: (ts[0].clientX + ts[1].clientX) / 2 - r.left,
                y: (ts[0].clientY + ts[1].clientY) / 2 - r.top,
            };
            gestureRef.current = { type: 'pinch', lastDist: dist, lastCenter: center };
            return;
        }
        const p = getPtr(e);
        if (!p) return;
        const isOrbitTarget = focusView === 'iso3d' || e.target?.name?.() === 'iso-orbit-zone';
        if (isOrbitTarget) {
            gestureRef.current = { type: 'orbit', sx: p.x, sy: p.y, startOrbit: { ...orbit } };
        } else {
            gestureRef.current = { type: 'pan', sx: p.x, sy: p.y, startView: { ...view } };
        }
    };

    const onMove = (e) => {
        const g = gestureRef.current;
        if (!g || !view) return;
        if (e.evt?.touches?.length === 2 && g.type === 'pinch') {
            if (e.evt.cancelable) e.evt.preventDefault();
            const ts = e.evt.touches;
            const nd = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
            const r = stageRef.current.container().getBoundingClientRect();
            const nc = {
                x: (ts[0].clientX + ts[1].clientX) / 2 - r.left,
                y: (ts[0].clientY + ts[1].clientY) / 2 - r.top,
            };
            const scale = view.scale * (nd / g.lastDist);
            const pt = { x: (nc.x - view.x) / view.scale, y: (nc.y - view.y) / view.scale };
            setView({
                scale,
                x: nc.x - pt.x * scale + (nc.x - g.lastCenter.x),
                y: nc.y - pt.y * scale + (nc.y - g.lastCenter.y),
            });
            g.lastDist = nd;
            g.lastCenter = nc;
            return;
        }
        const p = getPtr(e);
        if (!p) return;
        if (e.evt?.cancelable) e.evt.preventDefault();
        if (g.type === 'orbit') {
            const dYaw = (p.x - g.sx) * 0.45;
            const dPitch = (p.y - g.sy) * 0.35;
            setOrbit({
                yaw: ((g.startOrbit.yaw + dYaw + 180) % 360) - 180,
                pitch: Math.max(-35, Math.min(65, g.startOrbit.pitch + dPitch)),
            });
        } else if (g.type === 'pan') {
            setView(v => ({
                ...v,
                x: g.startView.x + (p.x - g.sx),
                y: g.startView.y + (p.y - g.sy),
            }));
        }
    };

    const onUp = () => { gestureRef.current = null; };

    const onWheel = (e) => {
        if (!view) return;
        e.evt.preventDefault();
        const stage = stageRef.current;
        const ptr = stage.getPointerPosition();
        const factor = e.evt.deltaY > 0 ? 1 / 1.1 : 1.1;
        const nextScale = view.scale * factor;
        const pt = { x: (ptr.x - view.x) / view.scale, y: (ptr.y - view.y) / view.scale };
        setView({ scale: nextScale, x: ptr.x - pt.x * nextScale, y: ptr.y - pt.y * nextScale });
    };

    // ===== Xuất Ảnh 6 Mặt & Xuất DXF Kỹ Thuật =====
    const exportImage = async () => {
        if (busy || !stageRef.current) return;
        setBusy(true);
        try {
            await new Promise(r => setTimeout(r, 80));
            const uri = stageToDataURL(stageRef.current, { crop: layout.bbox, format: 'png' });
            const cleanName = (cat?.name || item.kind || 'Noi_that').replace(/[\\/:*?"<>|]/g, '');
            const r = await shareDataURL(uri, `BT_${cleanName}_${stamp()}.png`);
            toast(r === 'shared' ? 'Đã chia sẻ bản vẽ 6 mặt' : 'Đã lưu ảnh bản vẽ 6 mặt', 'ok');
        } catch (err) {
            toast('Lỗi xuất ảnh: ' + err.message, 'err');
        } finally {
            setBusy(false);
        }
    };

    const exportDxf = (batchAll) => {
        const dxfStr = generateCabinetDxf(doc, batchAll ? null : item.id);
        if (!dxfStr) { toast('Không có dữ liệu nội thất', 'err'); return; }
        const suffix = batchAll
            ? `HangLoat_${allItems.length}Mon`
            : (cat?.name || item.kind).replace(/\s+/g, '_');
        downloadText(dxfStr, `BT_${doc.name}_${suffix}_${stamp()}.dxf`, 'application/dxf');
        toast(batchAll
            ? `Đã xuất DXF hàng loạt (${allItems.length} tờ bản vẽ nội thất)`
            : 'Đã xuất DXF bổ kỹ thuật 5 hình chiếu', 'ok');
    };

    const inv = 1 / (view?.scale || 0.1);
    const { w, d, h } = cfg;
    const { front, left, sectionAA, plan, sectionBB, iso3d } = bundle.views;

    return (
        <div className="elev-screen cab-layout-screen">
            {/* Thanh tiêu đề trên cùng */}
            <div className="mode-banner elev" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontWeight: 700 }}>
                    [{String(itemIndex + 1).padStart(2, '0')}/{String(allItems.length).padStart(2, '0')}]{' '}
                    {cat?.name || 'Nội thất'} · {Math.round(w)}×{Math.round(d)}×{Math.round(h)}
                </span>
                <span className="spacer" />
                <button className="banner-btn" onClick={() => setHideDoors(v => !v)}>
                    {hideDoors ? <Eye size={13} /> : <EyeOff size={13} />}
                    {hideDoors ? 'Đóng cánh' : 'Ẩn cánh'}
                </button>
                <button
                    className={`banner-btn ${showConfig ? 'solid' : ''}`}
                    onClick={() => setShowConfig(v => !v)}
                >
                    <SlidersHorizontal size={13} /> Kết cấu
                </button>
                <button className="banner-btn" onClick={() => exportDxf(false)} title="Xuất DXF món đang xem">
                    <FileDown size={13} /> DXF
                </button>
                {allItems.length > 1 && (
                    <button className="banner-btn" onClick={() => exportDxf(true)} title="Xuất DXF hàng loạt toàn bộ nội thất">
                        <FileDown size={13} /> DXF ({allItems.length})
                    </button>
                )}
                <button className="banner-btn" disabled={busy} onClick={exportImage}>
                    <Share2 size={13} /> Ảnh
                </button>
            </div>

            {/* Hàng chọn chế độ xem nhanh */}
            <div className="cab-subbar">
                {VIEW_TABS.map(t => (
                    <button
                        key={t.id}
                        className={`cab-pill ${focusView === t.id ? 'on' : ''}`}
                        onClick={() => setFocusView(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
                <span style={{ flex: 1 }} />
                {(focusView === 'all' || focusView === 'iso3d') && (
                    <button
                        className="cab-pill"
                        onClick={() => setOrbit(o => ({ yaw: o.yaw < 0 ? 34 : -34, pitch: 22 }))}
                        title="Đổi góc nhìn phối cảnh 3D trái/phải"
                    >
                        <RotateCcw size={12} /> Đổi góc 3D
                    </button>
                )}
            </div>

            {/* Vùng chính: Bảng vẽ kỹ thuật Konva + Bảng chỉnh tham số (nếu mở) */}
            <div className="cab-body">
                <div className="elev-canvas" ref={wrapRef} style={{ background: '#f8fafc' }}>
                    {view && size.width > 0 && (
                        <Stage
                            width={size.width}
                            height={size.height}
                            ref={stageRef}
                            scaleX={view.scale}
                            scaleY={view.scale}
                            x={view.x}
                            y={view.y}
                            onMouseDown={onDown}
                            onMouseMove={onMove}
                            onMouseUp={onUp}
                            onTouchStart={onDown}
                            onTouchMove={onMove}
                            onTouchEnd={onUp}
                            onWheel={onWheel}
                        >
                            <Layer>
                                {/* Tờ nền trắng kỹ thuật */}
                                <Rect
                                    x={layout.bbox.x + 40}
                                    y={layout.bbox.y + 40}
                                    width={layout.bbox.width - 80}
                                    height={layout.bbox.height - 80}
                                    fill="#ffffff"
                                    stroke="#cbd5e1"
                                    strokeWidth={1.2 * inv}
                                    listening={false}
                                />

                                {layout.mode === 'all' && (
                                    <>
                                        {/* 1. MẶT ĐỨNG */}
                                        <OrthoViewport
                                            view={front}
                                            x={layout.col1X}
                                            yBottom={layout.topRowBottomY}
                                            title="MẶT ĐỨNG"
                                            sub={hideDoors ? 'Đã ẩn cánh (thấy lòng tủ)' : `${cfg.bays.length} khoang`}
                                            inv={inv}
                                        >
                                            {/* Đường cắt dọc A-A màu đỏ */}
                                            <Line
                                                points={[
                                                    layout.col1X + bundle.xCut, layout.topRowBottomY + 26 * inv,
                                                    layout.col1X + bundle.xCut, layout.topRowBottomY - h - 26 * inv,
                                                ]}
                                                stroke="#dc2626"
                                                strokeWidth={1.3 * inv}
                                                dash={[8 * inv, 5 * inv]}
                                            />
                                            <Text text="A" x={layout.col1X + bundle.xCut + 5 * inv} y={layout.topRowBottomY - h - 30 * inv}
                                                fontSize={10.5 * inv} fontFamily={FONT} fontStyle="800" fill="#dc2626" />
                                            <Text text="A" x={layout.col1X + bundle.xCut + 5 * inv} y={layout.topRowBottomY + 14 * inv}
                                                fontSize={10.5 * inv} fontFamily={FONT} fontStyle="800" fill="#dc2626" />

                                            {/* Đường cắt ngang B-B màu đỏ */}
                                            <Line
                                                points={[
                                                    layout.col1X - 26 * inv, layout.topRowBottomY - bundle.zCut,
                                                    layout.col1X + w + 26 * inv, layout.topRowBottomY - bundle.zCut,
                                                ]}
                                                stroke="#dc2626"
                                                strokeWidth={1.3 * inv}
                                                dash={[8 * inv, 5 * inv]}
                                            />
                                            <Text text="B" x={layout.col1X - 38 * inv} y={layout.topRowBottomY - bundle.zCut - 13 * inv}
                                                fontSize={10.5 * inv} fontFamily={FONT} fontStyle="800" fill="#dc2626" />
                                            <Text text="B" x={layout.col1X + w + 28 * inv} y={layout.topRowBottomY - bundle.zCut - 13 * inv}
                                                fontSize={10.5 * inv} fontFamily={FONT} fontStyle="800" fill="#dc2626" />

                                            <TechDimH x1={layout.col1X} x2={layout.col1X + w} yRef={layout.topRowBottomY - h} yDim={layout.topRowBottomY - h - 22 * inv} val={w} inv={inv} />
                                            <TechDimV y1={layout.topRowBottomY - h} y2={layout.topRowBottomY} xRef={layout.col1X} xDim={layout.col1X - 24 * inv} val={h} inv={inv} />
                                        </OrthoViewport>

                                        {/* 2. MẶT BÊN TRÁI */}
                                        <OrthoViewport
                                            view={left}
                                            x={layout.col2X}
                                            yBottom={layout.topRowBottomY}
                                            title="MẶT BÊN TRÁI"
                                            inv={inv}
                                        >
                                            <Line
                                                points={[
                                                    layout.col2X - 18 * inv, layout.topRowBottomY - bundle.zCut,
                                                    layout.col2X + d + 18 * inv, layout.topRowBottomY - bundle.zCut,
                                                ]}
                                                stroke="#dc2626"
                                                strokeWidth={1.1 * inv}
                                                dash={[7 * inv, 5 * inv]}
                                            />
                                            <TechDimH x1={layout.col2X} x2={layout.col2X + d} yRef={layout.topRowBottomY - h} yDim={layout.topRowBottomY - h - 22 * inv} val={d} inv={inv} />
                                            <TechDimV y1={layout.topRowBottomY - h} y2={layout.topRowBottomY} xRef={layout.col2X + d} xDim={layout.col2X + d + 22 * inv} val={h} inv={inv} />
                                        </OrthoViewport>

                                        {/* 3. MẶT CẮT A-A */}
                                        <OrthoViewport
                                            view={sectionAA}
                                            x={layout.col3X}
                                            yBottom={layout.topRowBottomY}
                                            title="MẶT CẮT A-A"
                                            sub={`Cắt qua Khoang ${activeBayIdx + 1}`}
                                            inv={inv}
                                        >
                                            <TechDimH x1={layout.col3X} x2={layout.col3X + d} yRef={layout.topRowBottomY - h} yDim={layout.topRowBottomY - h - 22 * inv} val={d} inv={inv} />
                                            {sectionAA.clearDimsZ.map((cz, i) => (
                                                <TechDimV
                                                    key={i}
                                                    y1={layout.topRowBottomY - cz.v1}
                                                    y2={layout.topRowBottomY - cz.v0}
                                                    xRef={layout.col3X + d}
                                                    xDim={layout.col3X + d + 22 * inv}
                                                    val={cz.val}
                                                    inv={inv}
                                                    color="#2563eb"
                                                />
                                            ))}
                                            <TechDimV y1={layout.topRowBottomY - h} y2={layout.topRowBottomY} xRef={layout.col3X + d} xDim={layout.col3X + d + 48 * inv} val={h} inv={inv} />
                                        </OrthoViewport>

                                        {/* 4. MẶT BẰNG */}
                                        <OrthoViewport
                                            view={plan}
                                            x={layout.col1X}
                                            yBottom={layout.btmRowBottomY}
                                            title="MẶT BẰNG"
                                            inv={inv}
                                        >
                                            <Line
                                                points={[
                                                    layout.col1X + bundle.xCut, layout.btmRowBottomY + 18 * inv,
                                                    layout.col1X + bundle.xCut, layout.btmRowBottomY - d - 18 * inv,
                                                ]}
                                                stroke="#dc2626"
                                                strokeWidth={1.1 * inv}
                                                dash={[7 * inv, 5 * inv]}
                                            />
                                            <TechDimH x1={layout.col1X} x2={layout.col1X + w} yRef={layout.btmRowBottomY - d} yDim={layout.btmRowBottomY - d - 22 * inv} val={w} inv={inv} />
                                            <TechDimV y1={layout.btmRowBottomY - d} y2={layout.btmRowBottomY} xRef={layout.col1X} xDim={layout.col1X - 24 * inv} val={d} inv={inv} />
                                        </OrthoViewport>

                                        {/* 5. MẶT CẮT B-B */}
                                        <OrthoViewport
                                            view={sectionBB}
                                            x={layout.col2X}
                                            yBottom={layout.btmRowBottomY}
                                            title="MẶT CẮT B-B"
                                            sub={`Cắt tại cao độ +${Math.round(bundle.zCut)}mm`}
                                            inv={inv}
                                        >
                                            {sectionBB.clearDimsX.map((cx, i) => (
                                                <TechDimH
                                                    key={i}
                                                    x1={layout.col2X + cx.u0}
                                                    x2={layout.col2X + cx.u1}
                                                    yRef={layout.btmRowBottomY - d}
                                                    yDim={layout.btmRowBottomY - d - 20 * inv}
                                                    val={cx.val}
                                                    inv={inv}
                                                    color="#2563eb"
                                                />
                                            ))}
                                            <TechDimH x1={layout.col2X} x2={layout.col2X + w} yRef={layout.btmRowBottomY - d} yDim={layout.btmRowBottomY - d - 40 * inv} val={w} inv={inv} />
                                            <TechDimV y1={layout.btmRowBottomY - d} y2={layout.btmRowBottomY} xRef={layout.col2X + w} xDim={layout.col2X + w + 22 * inv} val={d} inv={inv} />
                                        </OrthoViewport>

                                        {/* 6. PHỐI CẢNH 3D */}
                                        <Iso3DViewport
                                            iso={iso3d}
                                            x={layout.isoX}
                                            yBottom={layout.isoBottomY}
                                            scaleFactor={layout.isoScale}
                                            title="PHỐI CẢNH 3D"
                                            sub="Chạm kéo vào hình để xoay 3D"
                                            inv={inv}
                                            hitBox
                                        />
                                    </>
                                )}

                                {layout.mode === 'iso3d' && (
                                    <Iso3DViewport
                                        iso={iso3d}
                                        x={0}
                                        yBottom={0}
                                        scaleFactor={1}
                                        title={`PHỐI CẢNH 3D — ${(cat?.name || '').toUpperCase()}`}
                                        sub="Kéo ngón tay / chuột để xoay mọi góc 360°"
                                        inv={inv}
                                        hitBox
                                    />
                                )}

                                {layout.mode !== 'all' && layout.mode !== 'iso3d' && layout.target && (
                                    <OrthoViewport
                                        view={layout.target}
                                        x={0}
                                        yBottom={0}
                                        title={VIEW_TABS.find(t => t.id === layout.mode)?.label?.toUpperCase() || ''}
                                        inv={inv}
                                    >
                                        <TechDimH x1={0} x2={layout.target.width} yRef={-layout.target.height} yDim={-layout.target.height - 24 * inv} val={layout.target.width} inv={inv} />
                                        <TechDimV y1={-layout.target.height} y2={0} xRef={0} xDim={-26 * inv} val={layout.target.height} inv={inv} />
                                        {layout.mode === 'sectionAA' && sectionAA.clearDimsZ.map((cz, i) => (
                                            <TechDimV key={i} y1={-cz.v1} y2={-cz.v0} xRef={layout.target.width} xDim={layout.target.width + 24 * inv} val={cz.val} inv={inv} color="#2563eb" />
                                        ))}
                                        {layout.mode === 'sectionBB' && sectionBB.clearDimsX.map((cx, i) => (
                                            <TechDimH key={i} x1={cx.u0} x2={cx.u1} yRef={-layout.target.height} yDim={-layout.target.height - 46 * inv} val={cx.val} inv={inv} color="#2563eb" />
                                        ))}
                                    </OrthoViewport>
                                )}
                            </Layer>
                        </Stage>
                    )}
                </div>

                {/* Bảng chỉnh Kết cấu Tham số (Parametric Inspector) */}
                {showConfig && (
                    <div className="cab-inspector">
                        <div className="cab-sec-title">Kích thước bao & Cao độ (mm)</div>
                        <div className="cab-dim-grid">
                            {[
                                { k: 'w', lbl: 'Rộng W', v: w },
                                { k: 'd', lbl: 'Sâu D', v: d },
                                { k: 'h', lbl: 'Cao H', v: h },
                                { k: 'z', lbl: 'Cách sàn Z', v: item.z ?? cat?.z ?? 0, zero: true },
                            ].map(f => (
                                <button
                                    key={f.k}
                                    className="cab-num-btn"
                                    onClick={() => onAskNumPad({
                                        title: `${cat?.name || 'Nội thất'} — ${f.lbl}`,
                                        initial: Math.round(f.v),
                                        allowZero: f.zero,
                                        onOK: (val) => onUpdateItem({ ...item, [f.k]: val }),
                                    })}
                                >
                                    <span>{f.lbl}</span>
                                    <strong>{Math.round(f.v)}</strong>
                                </button>
                            ))}
                        </div>

                        {canEditBays ? (
                            <>
                                <div className="cab-sec-title">Vật liệu, Ván & Chân đế</div>
                                <div className="cab-inline-row">
                                    <span>Ván:</span>
                                    {[17, 18].map(tv => (
                                        <button key={tv} className={`cab-mini-chip ${cfg.boardT === tv ? 'on' : ''}`}
                                            onClick={() => saveParam({ boardT: tv })}>
                                            {tv}mm
                                        </button>
                                    ))}
                                    <span style={{ marginLeft: 6 }}>Đế:</span>
                                    {[0, 60, 80, 100].map(pv => (
                                        <button key={pv} className={`cab-mini-chip ${cfg.plinthH === pv ? 'on' : ''}`}
                                            onClick={() => saveParam({ plinthH: pv })}>
                                            {pv}
                                        </button>
                                    ))}
                                </div>

                                <div className="cab-inline-row" style={{ marginTop: 6 }}>
                                    {MATERIAL_PALETTE.map(mp => (
                                        <button
                                            key={mp.key}
                                            className={`cab-swatch ${cfg.palette === mp.key ? 'on' : ''}`}
                                            title={mp.name}
                                            onClick={() => saveParam({ palette: mp.key, colorBody: mp.body, colorFront: mp.front })}
                                        >
                                            <span style={{ background: mp.body }} />
                                            <span style={{ background: mp.front }} />
                                            {mp.name}
                                        </button>
                                    ))}
                                </div>

                                <div className="cab-sec-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>Chia khoang đứng ({cfg.bays.length} khoang)</span>
                                    <span className="cab-stepper">
                                        <button onClick={() => saveParam(setBayCount(cfg, cfg.bays.length - 1))}><Minus size={13} /></button>
                                        <b>{cfg.bays.length}</b>
                                        <button onClick={() => saveParam(setBayCount(cfg, cfg.bays.length + 1))}><Plus size={13} /></button>
                                    </span>
                                </div>

                                <div className="cab-inline-row">
                                    {cfg.bays.map((_, idx) => (
                                        <button
                                            key={idx}
                                            className={`cab-mini-chip ${activeBayIdx === idx ? 'on' : ''}`}
                                            onClick={() => saveParam({ cutBayIndex: idx })}
                                        >
                                            Khoang {idx + 1}
                                        </button>
                                    ))}
                                </div>

                                {activeBay && (
                                    <div className="cab-bay-card">
                                        <div className="cab-bay-row">
                                            <span>Số đợt ngang</span>
                                            <span className="cab-stepper">
                                                <button onClick={() => updateBay(activeBayIdx, { shelves: Math.max(0, activeBay.shelves - 1) })}><Minus size={13} /></button>
                                                <b>{activeBay.shelves}</b>
                                                <button onClick={() => updateBay(activeBayIdx, { shelves: Math.min(8, activeBay.shelves + 1) })}><Plus size={13} /></button>
                                            </span>
                                        </div>
                                        <div className="cab-bay-row">
                                            <span>Số ngăn kéo dưới</span>
                                            <span className="cab-stepper">
                                                <button onClick={() => updateBay(activeBayIdx, { drawers: Math.max(0, activeBay.drawers - 1) })}><Minus size={13} /></button>
                                                <b>{activeBay.drawers}</b>
                                                <button onClick={() => updateBay(activeBayIdx, { drawers: Math.min(5, activeBay.drawers + 1) })}><Plus size={13} /></button>
                                            </span>
                                        </div>
                                        <div className="cab-bay-row">
                                            <span>Suốt treo quần áo</span>
                                            <button
                                                className={`cab-mini-chip ${activeBay.hangingRod ? 'on' : ''}`}
                                                onClick={() => updateBay(activeBayIdx, { hangingRod: !activeBay.hangingRod })}
                                            >
                                                {activeBay.hangingRod ? 'Có suốt treo' : 'Không'}
                                            </button>
                                        </div>
                                        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', marginTop: 4 }}>Kiểu cánh Khoang {activeBayIdx + 1}:</div>
                                        <div className="cab-inline-row" style={{ marginTop: 4 }}>
                                            {DOOR_TYPES.map(dt => (
                                                <button
                                                    key={dt.key}
                                                    className={`cab-mini-chip ${activeBay.door === dt.key ? 'on' : ''}`}
                                                    onClick={() => updateBay(activeBayIdx, { door: dt.key })}
                                                >
                                                    {dt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="cab-sec-title">Cao độ vết cắt B-B</div>
                                <div className="cab-inline-row">
                                    {[
                                        { r: 0.22, lbl: 'Thấp (qua ngăn kéo)' },
                                        { r: 0.55, lbl: 'Giữa tủ' },
                                        { r: 0.82, lbl: 'Cao (đợt trên)' },
                                    ].map(opt => (
                                        <button
                                            key={opt.r}
                                            className={`cab-mini-chip ${Math.abs((cfg.zCutRatio || 0.55) - opt.r) < 0.08 ? 'on' : ''}`}
                                            onClick={() => saveParam({ zCutRatio: opt.r })}
                                        >
                                            {opt.lbl}
                                        </button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>
                                Món này thuộc nhóm hình học cố định — bạn có thể chỉnh kích thước Rộng × Sâu × Cao ở trên và xoay xem Phối cảnh 3D.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Thanh chuyển nhanh toàn bộ nội thất trong mặt bằng (Dàn hàng loạt) */}
            <div className="elev-faces">
                {allItems.map((it, idx) => {
                    const c = catalogItem(it.kind);
                    return (
                        <button
                            key={it.id}
                            className={`chip ${it.id === item.id ? 'on' : ''}`}
                            onClick={() => onSelectItem(it.id)}
                        >
                            {String(idx + 1).padStart(2, '0')} · {c?.name || it.kind}
                        </button>
                    );
                })}
                <span style={{ flex: 1 }} />
                <button className="chip" onClick={onClose}><X size={15} /> Đóng</button>
            </div>
        </div>
    );
}
