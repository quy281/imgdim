import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Group } from 'react-konva';
import { ExternalLink, AlertCircle, RefreshCw } from 'lucide-react';
import PlanGrid from '../plan/PlanGrid';
import WallsLayer from '../plan/WallsLayer';
import RoomLabels from '../plan/RoomLabels';
import FurnitureLayer from '../plan/FurnitureLayer';
import NoteMarker from '../photo/NoteMarker';
import { bboxOfPlan } from '../lib/geometry';
import * as pb from '../lib/pb';

function fitView(plan, notes, furniture, w, h) {
    const bb = bboxOfPlan(plan, notes, furniture);
    if (!bb || !w || !h) return { scale: 1 / 10, x: w / 2, y: h / 2 };
    const pad = 60;
    const scale = Math.min((w - pad * 2) / bb.width, (h - pad * 2) / bb.height, 0.15);
    return {
        scale,
        x: w / 2 - (bb.x + bb.width / 2) * scale,
        y: h / 2 - (bb.y + bb.height / 2) * scale,
    };
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
                            onSelect={() => { }} onChange={() => { }} onRotate={() => { }} />
                        <Group listening={false}>
                            {(doc.notes || []).map(n => (
                                <NoteMarker key={n.id} note={n} scale={view.scale}
                                    isSelected={false} onSelect={() => { }} onEdit={() => { }} onChange={() => { }} />
                            ))}
                        </Group>
                    </Layer>
                </Stage>
            )}
        </div>
    );
}

function PhotoGallery({ photos }) {
    return (
        <div className="scroll-body">
            <div className="doc-grid">
                {photos.map(p => (
                    <a key={p.id} className="doc-card" href={p.thumb} target="_blank" rel="noreferrer"
                        style={{ textDecoration: 'none' }}>
                        <img className="doc-thumb" src={p.thumb} alt={p.name} />
                        <div className="doc-card-name">{p.name}</div>
                    </a>
                ))}
            </div>
        </div>
    );
}

const Centered = ({ children }) => (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, color: 'var(--muted)', fontSize: 14, textAlign: 'center' }}>
        {children}
    </div>
);

/**
 * Chế độ chỉ-xem cho người ngoài.
 *   code — link ngắn ?s=<code>, payload tải từ collection `shares`
 *   data — link cũ ?view=<base64> đã gửi ra trước đây, vẫn đọc được
 */
export default function ShareViewer({ code, data: inlineData, decodeError }) {
    const [state, setState] = useState(() =>
        inlineData ? { data: inlineData } : decodeError ? { error: 'Link không đọc được — có thể đã bị cắt ngắn khi gửi' } : { loading: true });
    const [tab, setTab] = useState(0);

    useEffect(() => {
        if (!code) return;
        let alive = true;
        pb.fetchShare(code)
            .then(res => { if (alive) setState({ data: res.payload }); })
            .catch(err => { if (alive) setState({ error: err.message }); });
        return () => { alive = false; };
    }, [code]);

    const data = state.data;
    const plans = data?.docs || [];
    const photos = data?.photos || [];
    const tabs = [
        ...plans.map((d, i) => ({ label: d.name, kind: 'plan', idx: i })),
        ...(photos.length ? [{ label: `Ảnh (${photos.length})`, kind: 'photos' }] : []),
    ];
    const active = tabs[Math.min(tab, tabs.length - 1)];

    return (
        <div className="screen" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="hdr">
                <div className="brand" style={{ gap: 10 }}>
                    <img src="/icon.svg" alt="MKG" style={{ width: 32, height: 32 }} />
                    <div style={{ minWidth: 0 }}>
                        <h1 style={{ fontSize: 15 }}>{data?.projectName || 'Mặt bằng'}</h1>
                        <div className="hdr-sub">
                            Chỉ xem · {data?.sharedBy ? `${data.sharedBy} · ` : ''}MKG Khảo Sát
                        </div>
                    </div>
                </div>
                <a href={window.location.origin} className="icon-btn" title="Mở app">
                    <ExternalLink size={20} />
                </a>
            </div>

            {state.loading && <Centered><RefreshCw size={22} className="spin" />Đang tải mặt bằng...</Centered>}

            {state.error && (
                <Centered>
                    <AlertCircle size={30} style={{ color: '#dc2626' }} />
                    <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{state.error}</div>
                    <div>Liên hệ người gửi để lấy link mới.</div>
                </Centered>
            )}

            {data && tabs.length > 1 && (
                <div style={{ display: 'flex', gap: 4, padding: '6px 12px', borderBottom: '1px solid var(--line)', overflowX: 'auto', flexShrink: 0 }}>
                    {tabs.map((t, i) => (
                        <button key={t.label + i} onClick={() => setTab(i)}
                            style={{
                                flexShrink: 0, padding: '5px 14px', borderRadius: 20, border: 'none',
                                fontSize: 13, fontWeight: i === tab ? 700 : 400,
                                background: i === tab ? 'var(--blue)' : 'var(--line)',
                                color: i === tab ? '#fff' : 'var(--ink)', cursor: 'pointer',
                            }}>
                            {t.label}
                        </button>
                    ))}
                </div>
            )}

            {data && active?.kind === 'plan' && <PlanCanvas key={active.idx} doc={plans[active.idx]} />}
            {data && active?.kind === 'photos' && <PhotoGallery photos={photos} />}
            {data && !active && <Centered>Không có dữ liệu để xem</Centered>}
        </div>
    );
}
