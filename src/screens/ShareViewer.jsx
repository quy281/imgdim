import React, { useState } from 'react';
import { Stage, Layer, Group } from 'react-konva';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import PlanGrid from '../plan/PlanGrid';
import WallsLayer from '../plan/WallsLayer';
import RoomLabels from '../plan/RoomLabels';
import FurnitureLayer from '../plan/FurnitureLayer';
import NoteMarker from '../photo/NoteMarker';
import { bboxOfPlan } from '../lib/geometry';
import { useRef, useEffect } from 'react';

function fitView(plan, notes, furniture, w, h) {
    const bb = bboxOfPlan(plan, notes, furniture);
    if (!bb || !w || !h) return { scale: 1 / 10, x: w / 2, y: h / 2 };
    const pad = 60;
    const scale = Math.min((w - pad * 2) / bb.width, (h - pad * 2) / bb.height, 0.15);
    const x = w / 2 - (bb.x + bb.width / 2) * scale;
    const y = h / 2 - (bb.y + bb.height / 2) * scale;
    return { scale, x, y };
}

function PlanCanvas({ doc }) {
    const wrapRef = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setSize({ width: el.offsetWidth, height: el.offsetHeight }));
        ro.observe(el);
        setSize({ width: el.offsetWidth, height: el.offsetHeight });
        return () => ro.disconnect();
    }, []);

    const view = size.width > 0 ? fitView(doc.plan, doc.notes, doc.furniture, size.width, size.height) : null;

    return (
        <div ref={wrapRef} style={{ flex: 1, minHeight: 0, background: '#e9edf2', position: 'relative', touchAction: 'none' }}>
            {view && (
                <Stage width={size.width} height={size.height}
                    scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}>
                    <Layer>
                        <PlanGrid stageScale={view.scale} stagePos={{ x: view.x, y: view.y }} stageSize={size}
                            contentBounds={bboxOfPlan(doc.plan, doc.notes, doc.furniture)}
                            gridMinor={100} gridMajor={1000} />
                        <WallsLayer plan={doc.plan} scale={view.scale} sel={null}
                            listening={false} showHandles={false} />
                        <RoomLabels plan={doc.plan} scale={view.scale} listening={false} />
                        <FurnitureLayer items={doc.furniture} scale={view.scale} sel={null} listening={false}
                            onSelect={() => {}} onChange={() => {}} onRotate={() => {}} />
                        <Group listening={false}>
                            {(doc.notes || []).map(n => (
                                <NoteMarker key={n.id} note={n} scale={view.scale}
                                    isSelected={false} onSelect={() => {}} onEdit={() => {}} onChange={() => {}} />
                            ))}
                        </Group>
                    </Layer>
                </Stage>
            )}
        </div>
    );
}

export default function ShareViewer({ data }) {
    const [activeIdx, setActiveIdx] = useState(0);

    // data = { v: 1, projectName, docs: [{id, name, plan, notes}] }
    const docs = data?.docs || [];
    const active = docs[activeIdx];

    return (
        <div className="screen" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="hdr">
                <div className="brand" style={{ gap: 10 }}>
                    <img src="/icon.svg" alt="MKG" style={{ width: 32, height: 32 }} />
                    <div style={{ minWidth: 0 }}>
                        <h1 style={{ fontSize: 15 }}>{data?.projectName || 'Mặt bằng'}</h1>
                        <div className="hdr-sub">Chỉ xem · MKG Khảo Sát</div>
                    </div>
                </div>
                <a href="https://do.mkg.vn" className="icon-btn" title="Mở app">
                    <ExternalLink size={20} />
                </a>
            </div>

            {/* Doc tabs (if multiple plans) */}
            {docs.length > 1 && (
                <div style={{ display: 'flex', gap: 4, padding: '6px 12px', borderBottom: '1px solid var(--line)', overflowX: 'auto', flexShrink: 0 }}>
                    {docs.map((d, i) => (
                        <button key={d.id} onClick={() => setActiveIdx(i)}
                            style={{
                                flexShrink: 0, padding: '5px 14px', borderRadius: 20,
                                border: 'none', fontSize: 13, fontWeight: i === activeIdx ? 700 : 400,
                                background: i === activeIdx ? 'var(--blue)' : 'var(--line)',
                                color: i === activeIdx ? '#fff' : 'var(--ink)',
                                cursor: 'pointer',
                            }}>
                            {d.name}
                        </button>
                    ))}
                </div>
            )}

            {active ? (
                <PlanCanvas doc={active} />
            ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14 }}>
                    Không có dữ liệu mặt bằng
                </div>
            )}
        </div>
    );
}
