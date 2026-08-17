import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Stage, Layer } from 'react-konva';
import { X, Share2, Ruler } from 'lucide-react';
import ElevationLayer from './ElevationLayer';
import { wallFrame, ceilingHeight, bboxOfElevation, SLAB_DEFAULT, dist } from '../lib/geometry';

/**
 * Mini sơ đồ phòng chỉ rõ đang đứng nhìn mặt nào — SVG thuần, không dựng Stage
 * Konva thứ hai. Đây là thứ chống lạc hướng trên màn hình nhỏ, và cũng chính là
 * ký hiệu hướng nhìn của hồ sơ kiến trúc.
 */
function PlanKey({ plan, room, frame, size = 74 }) {
    const pts = useMemo(() => {
        if (!room?.nodeIds) return [];
        const byId = new Map(plan.nodes.map(n => [n.id, n]));
        return room.nodeIds.map(id => byId.get(id)).filter(Boolean);
    }, [plan, room]);
    if (pts.length < 3 || !frame) return null;

    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 10;
    const s = Math.min((size - pad * 2) / Math.max(maxX - minX, 1), (size - pad * 2) / Math.max(maxY - minY, 1));
    const tx = (p) => ({ x: pad + (p.x - minX) * s, y: pad + (p.y - minY) * s });
    const poly = pts.map(p => { const q = tx(p); return `${q.x},${q.y}`; }).join(' ');
    const a = tx(frame.a), b = tx(frame.b);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // mũi tên chỉ hướng nhìn: từ trong phòng ra tường
    const vx = -frame.nx * frame.side, vy = -frame.ny * frame.side;
    const tail = { x: mid.x - vx * 13, y: mid.y - vy * 13 };

    return (
        <svg width={size} height={size} style={{ display: 'block' }}>
            <polygon points={poly} fill="rgba(148,163,184,0.18)" stroke="#94a3b8" strokeWidth="1" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2563eb" strokeWidth="3.5" strokeLinecap="round" />
            <line x1={tail.x} y1={tail.y} x2={mid.x} y2={mid.y} stroke="#2563eb" strokeWidth="1.6"
                markerEnd="url(#ekarrow)" />
            <defs>
                <marker id="ekarrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="#2563eb" />
                </marker>
            </defs>
        </svg>
    );
}

/**
 * Màn hình khai triển tường. Là overlay TRONG PlanEditor (không phải screen riêng)
 * để dùng chung commit/history — sửa cao độ ở đây rồi quay ra mặt bằng bấm Undo
 * vẫn hoàn tác được.
 */
export default function ElevationView({
    doc, elev, onClose, onPick, onSegmentTap, onOpeningTap, onVerticalTap, onCeilingTap, onExport,
}) {
    const wrapRef = useRef(null);
    const stageRef = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [selOpId, setSelOpId] = useState(null);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setSize({ width: el.offsetWidth, height: el.offsetHeight });
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, []);

    const plan = doc.plan;
    const room = elev.roomId ? (plan.rooms || []).find(r => r.id === elev.roomId) : null;
    const face = elev.faces.find(f => f.wallId === elev.wallId) || elev.faces[0];
    const frame = face ? wallFrame(plan, face.wallId, room) : null;
    const settings = doc.settings || {};
    const H = ceilingHeight(room, settings);
    const slabT = settings.slabT ?? SLAB_DEFAULT;

    // Fit cả 4 mặt theo CÙNG một tỉ lệ — khác tỉ lệ thì so sánh chiều cao giữa
    // các mặt cho kết quả sai, mà nhìn vẫn "đẹp".
    const view = useMemo(() => {
        if (!frame || !size.width) return null;
        const maxLen = Math.max(...elev.faces.map(f => f.len), frame.len);
        const bb = bboxOfElevation(maxLen, H, slabT);
        const s = Math.min(size.width / bb.width, size.height / bb.height) * 0.96;
        return {
            scale: s,
            x: size.width / 2 - (bb.x + bb.width / 2) * s,
            y: size.height / 2 - (bb.y + bb.height / 2) * s,
        };
    }, [frame, size, H, slabT, elev.faces]);

    const selOp = selOpId && frame
        ? (frame.wall.openings || []).find(o => o.id === selOpId)
        : null;

    return (
        <div className="elev-screen">
            <div className="mode-banner elev">
                <span>
                    {room ? `${room.name || 'Phòng'} — mặt ${face?.label}` : 'Khai triển tường'}
                    {' · '}
                    {Number.isFinite(room?.h) ? `trần ${Math.round(H)}` : `trần ~${Math.round(H)} (chưa đo)`}
                </span>
                <span className="spacer" />
                <button className="banner-btn" onClick={onCeilingTap}>
                    <Ruler size={13} /> Cao trần
                </button>
                {onExport && <button className="banner-btn" onClick={onExport}><Share2 size={13} /> Xuất</button>}
            </div>

            <div className="elev-canvas" ref={wrapRef}>
                {view && frame && (
                    <Stage width={size.width} height={size.height} ref={stageRef}
                        scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
                        onMouseDown={(e) => { if (e.target === e.target.getStage()) setSelOpId(null); }}
                        onTouchStart={(e) => { if (e.target === e.target.getStage()) setSelOpId(null); }}>
                        <Layer>
                            <ElevationLayer
                                frame={frame} plan={plan} furniture={doc.furniture}
                                settings={settings} H={H} slabT={slabT} scale={view.scale}
                                selOpId={selOpId}
                                onSegmentTap={onSegmentTap}
                                onOpeningTap={(wallId, opId) => { setSelOpId(opId); onOpeningTap?.(wallId, opId); }}
                                onVerticalTap={onVerticalTap}
                                onCeilingTap={onCeilingTap}
                            />
                        </Layer>
                    </Stage>
                )}

                {room && frame && (
                    <div className="elev-key">
                        <PlanKey plan={plan} room={room} frame={frame} />
                        <div className="elev-key-cap">mặt {face?.label}</div>
                    </div>
                )}

                {selOp && (
                    <div className="float-bar">
                        <button className="fb-btn" style={{ color: 'var(--blue)' }}
                            onClick={() => onVerticalTap?.(selOp.id, 'sill', null)}>
                            Bệ
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" style={{ color: 'var(--blue)' }}
                            onClick={() => onVerticalTap?.(selOp.id, 'op', null)}>
                            Cao ô cửa
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" onClick={() => setSelOpId(null)}><X size={16} /></button>
                    </div>
                )}
            </div>

            <div className="elev-faces">
                {elev.faces.map(f => (
                    <button key={f.wallId}
                        className={`chip ${f.wallId === face?.wallId ? 'on' : ''}`}
                        onClick={() => { setSelOpId(null); onPick(f.wallId); }}>
                        {f.label}
                    </button>
                ))}
                <span style={{ flex: 1 }} />
                <button className="chip" onClick={onClose}><X size={15} /> Đóng</button>
            </div>
        </div>
    );
}
