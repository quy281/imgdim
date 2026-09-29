import React, { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Line, Text, Circle, Group, Rect } from 'react-konva';
import {
    ArrowLeft, FileDown, Info, Maximize2, PackageOpen, PenLine, RotateCw,
    Save, Settings2, Store, UploadCloud,
} from 'lucide-react';
import PlanGrid from '../plan/PlanGrid';
import Sheet from '../ui/Sheet';
import NumPad from '../ui/NumPad';
import TextSheet from '../ui/TextSheet';
import Confirm from '../ui/Confirm';
import { toast } from '../ui/Toast';
import { dist, snapToGrid } from '../lib/geometry';
import {
    BOARD_DEFAULT_H, BOARD_DEFAULT_W, BOARD_MATERIALS, boardArea, boardBounds,
    boardPerimeter, makeBoardThumb, moveBoardPoint, rectOutline,
    resizeBoardSegment, standardBoardCode,
} from '../lib/boardModel';
import { boardFileName, generateBoardDxf } from '../lib/boardDxf';
import { downloadText } from '../lib/export';
import { fileToPhoto } from '../lib/image';

const segmentMid = (pts, i) => {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

const boardSnapTolerance = (scale) => Math.max(45, Math.min(140, 30 / (scale || 1)));

const snapToBoardBoundary = (pt, scale) => {
    const tol = boardSnapTolerance(scale);
    let x = pt.x;
    let y = pt.y;
    if (pt.y >= -tol && pt.y <= BOARD_DEFAULT_H + tol) {
        if (Math.abs(pt.x) <= tol) x = 0;
        if (Math.abs(pt.x - BOARD_DEFAULT_W) <= tol) x = BOARD_DEFAULT_W;
    }
    if (pt.x >= -tol && pt.x <= BOARD_DEFAULT_W + tol) {
        if (Math.abs(pt.y) <= tol) y = 0;
        if (Math.abs(pt.y - BOARD_DEFAULT_H) <= tol) y = BOARD_DEFAULT_H;
    }
    return { x, y };
};

const orthoPoint = (prev, pt) => {
    if (!prev) return pt;
    return Math.abs(pt.x - prev.x) >= Math.abs(pt.y - prev.y)
        ? { x: pt.x, y: prev.y }
        : { x: prev.x, y: pt.y };
};

const closeOrthogonal = (draft) => {
    if (draft.length < 3) return draft;
    const first = draft[0];
    const last = draft[draft.length - 1];
    if (first.x === last.x || first.y === last.y) return draft;
    const c1 = { x: first.x, y: last.y };
    const c2 = { x: last.x, y: first.y };
    const d1 = Math.hypot(c1.x - last.x, c1.y - last.y);
    const d2 = Math.hypot(c2.x - last.x, c2.y - last.y);
    const corner = d1 <= d2 ? c1 : c2;
    return Math.hypot(corner.x - last.x, corner.y - last.y) < 1 ? draft : [...draft, corner];
};

const movePointOrtho = (outline, idx, raw) => {
    if (!outline[idx] || outline.length < 3) return raw;
    const prev = outline[(idx - 1 + outline.length) % outline.length];
    const next = outline[(idx + 1) % outline.length];
    const c1 = { x: prev.x, y: next.y };
    const c2 = { x: next.x, y: prev.y };
    const d1 = Math.hypot(c1.x - raw.x, c1.y - raw.y);
    const d2 = Math.hypot(c2.x - raw.x, c2.y - raw.y);
    return d1 <= d2 ? c1 : c2;
};

const moveOpenPathPoint = (path, idx, raw, scale) => {
    const p = snapToBoardBoundary(raw, scale);
    const prev = path[idx - 1];
    const next = path[idx + 1];
    if (prev && next) {
        const c1 = snapToBoardBoundary({ x: prev.x, y: next.y }, scale);
        const c2 = snapToBoardBoundary({ x: next.x, y: prev.y }, scale);
        const d1 = Math.hypot(c1.x - p.x, c1.y - p.y);
        const d2 = Math.hypot(c2.x - p.x, c2.y - p.y);
        return d1 <= d2 ? c1 : c2;
    }
    if (prev) return snapToBoardBoundary(orthoPoint(prev, p), scale);
    if (next) return snapToBoardBoundary(orthoPoint(next, p), scale);
    return p;
};

const resizeOpenPathSegment = (path, idx, newLen) => {
    const a = path[idx];
    const b = path[idx + 1];
    if (!a || !b || !(newLen > 0)) return path;
    const cur = dist(a, b);
    if (cur < 1) return path;
    const ux = (b.x - a.x) / cur;
    const uy = (b.y - a.y) / cur;
    const delta = newLen - cur;
    if (Math.abs(delta) < 0.5) return path;
    return path.map((p, i) => i > idx
        ? { x: Math.round(p.x + ux * delta), y: Math.round(p.y + uy * delta) }
        : p);
};

export default function BoardEditor({ doc, onChange, onBack }) {
    const docRef = useRef(doc);
    useEffect(() => { docRef.current = doc; }, [doc]);

    const [mode, setMode] = useState((doc.board?.outline || []).length ? 'select' : 'free');
    const [selSeg, setSelSeg] = useState(null);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const [view, setView] = useState(doc.view || null);
    const [numpad, setNumpad] = useState(null);
    const [textSheet, setTextSheet] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [showInfo, setShowInfo] = useState(false);
    const [showExport, setShowExport] = useState(false);
    const [showMarket, setShowMarket] = useState(false);
    const [marketDraft, setMarketDraft] = useState({ code: '', title: '', price: '', desc: '', status: 'available', photoThumb: '' });
    const [draft, setDraft] = useState([]);
    const stageRef = useRef(null);
    const wrapRef = useRef(null);
    const marketPhotoRef = useRef(null);

    const board = doc.board || { outline: rectOutline() };
    const pts = board.outline || [];
    const settings = doc.settings || {};

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setStageSize({ width: el.offsetWidth, height: el.offsetHeight });
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        measure();
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        if (view || !stageSize.width || !stageSize.height) return;
        const bb = boardBounds(board);
        const s = Math.min((stageSize.width - 90) / Math.max(bb.width, 800), (stageSize.height - 120) / Math.max(bb.height, 800));
        setView({
            scale: Math.max(0.12, Math.min(1.3, s)),
            x: (stageSize.width - bb.width * s) / 2 - bb.x * s,
            y: (stageSize.height - bb.height * s) / 2 - bb.y * s,
        });
    }, [view, stageSize, board]);

    const commit = (nextBoard, extra = {}) => {
        const d = docRef.current;
        const next = {
            ...d,
            board: nextBoard,
            view,
            thumb: makeBoardThumb(nextBoard),
            updatedAt: Date.now(),
            ...extra,
        };
        onChange(next);
        docRef.current = next;
    };

    const worldPoint = () => {
        const st = stageRef.current;
        const p = st?.getPointerPosition();
        const v = view || { x: 0, y: 0, scale: 1 };
        if (!p) return null;
        let pt = { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
        pt = snapToGrid(pt, settings.gridMinor || 50);
        return snapToBoardBoundary(pt, v.scale);
    };

    const onWheel = (e) => {
        e.evt.preventDefault();
        const old = view || { x: 0, y: 0, scale: 1 };
        const pointer = stageRef.current.getPointerPosition();
        if (!pointer) return;
        const factor = e.evt.deltaY > 0 ? 0.9 : 1.1;
        const scale = Math.max(0.06, Math.min(4, old.scale * factor));
        const mouse = { x: (pointer.x - old.x) / old.scale, y: (pointer.y - old.y) / old.scale };
        setView({ scale, x: pointer.x - mouse.x * scale, y: pointer.y - mouse.y * scale });
    };

    const startFree = () => {
        setDraft([]);
        setSelSeg(null);
        setMode('free');
        toast('Chấm từng điểm quanh biên ván — app tự khóa ngang/dọc', 'ok');
    };

    const addDraftPoint = () => {
        const p = worldPoint();
        if (!p) return;
        setDraft(cur => {
            const next = snapToBoardBoundary(orthoPoint(cur[cur.length - 1], p), v.scale);
            if (cur.length && dist(cur[cur.length - 1], next) < 10) return cur;
            return [...cur, next];
        });
    };

    const saveDraft = () => {
        if (draft.length < 3) { toast('Cần ít nhất 3 điểm để tạo biên ván', 'err'); return; }
        commit({ ...board, outline: closeOrthogonal(draft) });
        setDraft([]);
        setMode('select');
    };

    const openSegPad = (idx) => {
        const a = pts[idx];
        const b = pts[(idx + 1) % pts.length];
        if (!a || !b) return;
        setNumpad({
            title: 'Chiều dài đoạn biên',
            initial: Math.round(dist(a, b)),
            hint: idx === pts.length - 1 ? 'Đoạn cuối khép biên: nên sửa các cạnh liền kề để giữ hình ổn định.' : null,
            onOK: (val) => {
                const r = resizeBoardSegment(docRef.current.board, idx, val);
                commit(r.board);
                if (r.warning) toast(r.warning, 'err');
            },
        });
    };

    const openDraftSegPad = (idx) => {
        const a = draft[idx];
        const b = draft[idx + 1];
        if (!a || !b) return;
        setNumpad({
            title: 'Chiều dài đoạn đang vẽ',
            initial: Math.round(dist(a, b)),
            hint: 'Đoạn sau điểm này sẽ dịch theo để giữ đường zigzag vuông góc.',
            onOK: (val) => setDraft(cur => resizeOpenPathSegment(cur, idx, val)
                .map(p => snapToBoardBoundary(p, v.scale))),
        });
    };

    const exportDxf = () => {
        setShowExport(false);
        downloadText(generateBoardDxf(docRef.current), boardFileName(docRef.current.board), 'application/dxf');
        toast('Đã xuất DXF ván', 'ok');
    };

    const openMarketSheet = () => {
        const cur = docRef.current.board || board;
        if ((cur.outline || []).length < 3) {
            toast('Vẽ và lưu biên ván trước khi đăng lên sàn trao đổi', 'err');
            return;
        }
        const code = standardBoardCode(cur);
        const b = boardBounds(cur);
        setMarketDraft({
            code: cur.market?.code || code,
            title: cur.market?.title || `${cur.material || 'Ván'} ${cur.thickness || 18}mm ${cur.color || ''} ${Math.round(b.width)}×${Math.round(b.height)}`,
            price: cur.market?.price ? String(cur.market.price) : '',
            desc: cur.market?.desc || `Ván tồn kho ${cur.location || ''}, diện tích ${(boardArea(cur) / 1e6).toFixed(3)} m², có file DXF theo biên thực tế.`,
            status: cur.market?.status || 'available',
            photoThumb: cur.market?.photoThumb || '',
        });
        setShowMarket(true);
    };

    const pickMarketPhoto = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const photo = await fileToPhoto(file);
            setMarketDraft(d => ({ ...d, photoThumb: photo.thumb }));
            toast('Đã thêm ảnh chụp tấm ván', 'ok');
        } catch (err) {
            console.warn('market photo:', err);
            toast('Không đọc được ảnh ván', 'err');
        }
    };

    const publishMarket = () => {
        const cur = docRef.current.board || board;
        const price = Number(String(marketDraft.price || '').replace(/[^\d]/g, ''));
        if (!price) { toast('Nhập giá trao đổi trước khi đăng sàn', 'err'); return; }
        const code = marketDraft.code?.trim() || standardBoardCode(cur);
        const listedBoard = { ...cur, code };
        const nextBoard = {
            ...listedBoard,
            market: {
                listed: true,
                code,
                title: marketDraft.title?.trim() || code,
                desc: marketDraft.desc?.trim() || '',
                price,
                status: marketDraft.status || 'available',
                listedAt: Date.now(),
                dxfFile: boardFileName(listedBoard),
                thumb: makeBoardThumb(listedBoard),
                photoThumb: marketDraft.photoThumb || '',
                area: boardArea(listedBoard),
                bounds: boardBounds(listedBoard),
            },
        };
        commit(nextBoard, { name: code });
        setShowMarket(false);
        toast('Đã đăng ván lên sàn trao đổi', 'ok');
    };

    const saveMeta = (patch) => {
        const nextBoard = { ...docRef.current.board, ...patch };
        commit(nextBoard, patch.code ? { name: patch.code } : {});
    };

    const bb = boardBounds(board);
    const contentBounds = { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
    const points = pts.flatMap(p => [p.x, p.y]);
    const v = view || { x: 0, y: 0, scale: 1 };

    return (
        <div className="screen">
            <div className="hdr">
                <button className="icon-btn" onClick={onBack}><ArrowLeft size={22} /></button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hdr-title">{board.code || doc.name}</div>
                    <div className="hdr-sub">
                        {board.material} {board.thickness}mm · {board.color} · Kho {board.location}
                    </div>
                </div>
                {board.market?.listed && (
                    <div className="sync-chip on"><Store size={13} /> Trên sàn</div>
                )}
                <button className="icon-btn" onClick={() => setShowInfo(true)}><Info size={20} /></button>
                <button className="icon-btn" style={{ color: 'var(--red-dark)' }} onClick={() => setShowExport(true)}><FileDown size={20} /></button>
            </div>

            <div className={`mode-banner ${mode === 'free' ? 'draw' : ''}`}>
                {mode === 'free'
                    ? `Vẽ tự do vuông góc: ${draft.length} điểm · nền mờ 1220×2440`
                    : `${Math.round(bb.width)}×${Math.round(bb.height)}mm · ${(boardArea(board) / 1e6).toFixed(2)}m²`}
                <div className="spacer" />
                {mode === 'free' && (
                    <button className="banner-btn solid" onClick={saveDraft}><Save size={14} /> Lưu biên</button>
                )}
            </div>

            <div ref={wrapRef} className="editor-canvas">
                <Stage
                    ref={stageRef}
                    width={stageSize.width}
                    height={stageSize.height}
                    scaleX={v.scale}
                    scaleY={v.scale}
                    x={v.x}
                    y={v.y}
                    draggable={mode !== 'free'}
                    onDragEnd={e => setView({ ...v, x: e.target.x(), y: e.target.y() })}
                    onWheel={onWheel}
                    onClick={() => { if (mode === 'free') addDraftPoint(); }}
                    onTap={() => { if (mode === 'free') addDraftPoint(); }}
                >
                    <Layer>
                        <PlanGrid
                            stageScale={v.scale}
                            stagePos={{ x: v.x, y: v.y }}
                            stageSize={stageSize}
                            contentBounds={contentBounds}
                            gridMinor={settings.gridMinor || 50}
                            gridMajor={settings.gridMajor || 500}
                        />
                        <Rect
                            x={0}
                            y={0}
                            width={BOARD_DEFAULT_W}
                            height={BOARD_DEFAULT_H}
                            fill="#b71c1c"
                            opacity={0.06}
                            stroke="#b71c1c"
                            strokeWidth={Math.max(2 / v.scale, 5)}
                            dash={[80, 55]}
                            listening={false}
                        />
                        <Text
                            x={18}
                            y={18}
                            text="1220×2440"
                            fontSize={Math.max(12 / v.scale, 38)}
                            fill="#b71c1c"
                            opacity={0.35}
                            listening={false}
                        />
                        {pts.length >= 3 && (
                            <Line
                                points={points}
                                closed
                                fill="#f8fafc"
                                stroke="#b71c1c"
                                strokeWidth={Math.max(3 / v.scale, 8)}
                                lineJoin="round"
                            />
                        )}
                        <Rect
                            x={0}
                            y={0}
                            width={BOARD_DEFAULT_W}
                            height={BOARD_DEFAULT_H}
                            stroke="#2563eb"
                            strokeWidth={Math.max(1 / v.scale, 3)}
                            dash={[70, 45]}
                            opacity={0.28}
                            listening={false}
                        />
                        {pts.map((p, i) => {
                            const b = pts[(i + 1) % pts.length];
                            const mid = segmentMid(pts, i);
                            const L = b ? Math.round(dist(p, b)) : 0;
                            const on = selSeg === i;
                            return (
                                <Group key={`seg-${i}`}>
                                    <Line
                                        points={[p.x, p.y, b.x, b.y]}
                                        stroke={on ? '#2563eb' : 'rgba(37,99,235,0.01)'}
                                        strokeWidth={Math.max(18 / v.scale, 26)}
                                        lineCap="round"
                                        onClick={(e) => { e.cancelBubble = true; setSelSeg(i); }}
                                        onTap={(e) => { e.cancelBubble = true; setSelSeg(i); }}
                                    />
                                    <Text
                                        x={mid.x - 75}
                                        y={mid.y - 22}
                                        text={`${L}`}
                                        fontSize={Math.max(13 / v.scale, 42)}
                                        fontStyle="bold"
                                        fill={on ? '#2563eb' : '#334155'}
                                        padding={4 / v.scale}
                                        onClick={(e) => { e.cancelBubble = true; setSelSeg(i); openSegPad(i); }}
                                        onTap={(e) => { e.cancelBubble = true; setSelSeg(i); openSegPad(i); }}
                                    />
                                </Group>
                            );
                        })}
                        {pts.map((p, i) => (
                            <Circle
                                key={`pt-${i}`}
                                x={p.x}
                                y={p.y}
                                radius={Math.max(7 / v.scale, 15)}
                                fill="#fff"
                                stroke="#b71c1c"
                                strokeWidth={Math.max(2 / v.scale, 5)}
                                draggable
                                onDragMove={(e) => {
                                    const raw = snapToBoardBoundary(snapToGrid(e.target.position(), settings.gridMinor || 50), v.scale);
                                    const pos = movePointOrtho(docRef.current.board?.outline || [], i, raw);
                                    e.target.position(pos);
                                    const next = moveBoardPoint(docRef.current.board, i, { x: Math.round(pos.x), y: Math.round(pos.y) });
                                    onChange({ ...docRef.current, board: next, thumb: makeBoardThumb(next), updatedAt: Date.now() });
                                }}
                                onDragEnd={(e) => {
                                    const raw = snapToBoardBoundary(snapToGrid(e.target.position(), settings.gridMinor || 50), v.scale);
                                    const pos = movePointOrtho(docRef.current.board?.outline || [], i, raw);
                                    commit(moveBoardPoint(docRef.current.board, i, { x: Math.round(pos.x), y: Math.round(pos.y) }));
                                }}
                            />
                        ))}
                        {draft.length > 0 && (
                            <>
                                <Line
                                    points={draft.flatMap(p => [p.x, p.y])}
                                    stroke="#2563eb"
                                    strokeWidth={Math.max(3 / v.scale, 8)}
                                    lineJoin="round"
                                />
                                {draft.slice(0, -1).map((p, i) => {
                                    const b = draft[i + 1];
                                    const mid = { x: (p.x + b.x) / 2, y: (p.y + b.y) / 2 };
                                    const L = Math.round(dist(p, b));
                                    return (
                                        <Group key={`draft-seg-${i}`}>
                                            <Line
                                                points={[p.x, p.y, b.x, b.y]}
                                                stroke="rgba(37,99,235,0.01)"
                                                strokeWidth={Math.max(18 / v.scale, 28)}
                                                lineCap="round"
                                                onClick={(e) => { e.cancelBubble = true; openDraftSegPad(i); }}
                                                onTap={(e) => { e.cancelBubble = true; openDraftSegPad(i); }}
                                            />
                                            <Text
                                                x={mid.x - 75}
                                                y={mid.y - 22}
                                                text={`${L}`}
                                                fontSize={Math.max(13 / v.scale, 42)}
                                                fontStyle="bold"
                                                fill="#2563eb"
                                                padding={4 / v.scale}
                                                onClick={(e) => { e.cancelBubble = true; openDraftSegPad(i); }}
                                                onTap={(e) => { e.cancelBubble = true; openDraftSegPad(i); }}
                                            />
                                        </Group>
                                    );
                                })}
                                {draft.map((p, i) => (
                                    <Circle
                                        key={`draft-${i}`}
                                        x={p.x}
                                        y={p.y}
                                        radius={Math.max(6 / v.scale, 14)}
                                        fill="#2563eb"
                                        draggable
                                        onClick={(e) => { e.cancelBubble = true; }}
                                        onTap={(e) => { e.cancelBubble = true; }}
                                        onDragMove={(e) => {
                                            const raw = snapToGrid(e.target.position(), settings.gridMinor || 50);
                                            const pos = moveOpenPathPoint(draft, i, raw, v.scale);
                                            e.target.position(pos);
                                            setDraft(cur => cur.map((q, j) => j === i ? { x: Math.round(pos.x), y: Math.round(pos.y) } : q));
                                        }}
                                        onDragEnd={(e) => {
                                            const raw = snapToGrid(e.target.position(), settings.gridMinor || 50);
                                            const pos = moveOpenPathPoint(draft, i, raw, v.scale);
                                            setDraft(cur => cur.map((q, j) => j === i ? { x: Math.round(pos.x), y: Math.round(pos.y) } : q));
                                        }}
                                    />
                                ))}
                            </>
                        )}
                    </Layer>
                </Stage>

                {selSeg != null && mode !== 'free' && (
                    <div className="float-bar">
                        <button className="fb-btn" style={{ color: 'var(--warn)' }} onClick={() => openSegPad(selSeg)}>
                            <Maximize2 size={16} /> Sửa số
                        </button>
                    </div>
                )}
            </div>

            <div className="tool-bar">
                <button className={`tool ${mode === 'free' ? 'on t-draw' : ''}`} onClick={startFree}>
                    <PenLine size={21} />
                    Vẽ tự do
                </button>
                <button className="tool" onClick={() => setShowInfo(true)}>
                    <Settings2 size={21} />
                    Thông tin
                </button>
                <button className={`tool ${board.market?.listed ? 'on t-measure' : ''}`} onClick={openMarketSheet}>
                    <UploadCloud size={21} />
                    Đăng sàn
                </button>
            </div>

            <Sheet open={showInfo} onClose={() => setShowInfo(false)} title="Thông tin ván tồn"
                sub={`${(boardArea(board) / 1e6).toFixed(3)} m² · chu vi ${(boardPerimeter(board) / 1000).toFixed(2)} m`}>
                <button className="sheet-row" onClick={() => setTextSheet({
                    title: 'Mã ván',
                    initial: board.code,
                    onOK: (code) => saveMeta({ code }),
                })}>
                    <PackageOpen size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Mã ván<div className="sub">{board.code}</div></div>
                </button>
                <div className="field">
                    <label>Vật liệu</label>
                    <select value={board.material || 'MDF'} onChange={e => saveMeta({ material: e.target.value })}>
                        {BOARD_MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                </div>
                <button className="sheet-row" onClick={() => setNumpad({
                    title: 'Độ dày ván',
                    initial: board.thickness || 18,
                    onOK: (thickness) => saveMeta({ thickness }),
                })}>
                    <Maximize2 size={19} style={{ color: 'var(--warn)' }} />
                    <div style={{ flex: 1 }}>Độ dày<div className="sub">{board.thickness || 18} mm</div></div>
                </button>
                <button className="sheet-row" onClick={() => setTextSheet({
                    title: 'Màu / mã màu',
                    initial: board.color,
                    onOK: (color) => saveMeta({ color }),
                })}>
                    <Info size={19} style={{ color: 'var(--violet)' }} />
                    <div style={{ flex: 1 }}>Màu<div className="sub">{board.color || 'Chưa nhập'}</div></div>
                </button>
                <button className="sheet-row" onClick={() => setTextSheet({
                    title: 'Vị trí kho',
                    initial: board.location,
                    placeholder: 'A1, A2...',
                    onOK: (location) => saveMeta({ location }),
                })}>
                    <PackageOpen size={19} style={{ color: 'var(--ok)' }} />
                    <div style={{ flex: 1 }}>Vị trí kho<div className="sub">{board.location || 'Chưa nhập'}</div></div>
                </button>
                <button className="sheet-row" onClick={() => saveMeta({ grain: board.grain === 'long' ? 'cross' : 'long' })}>
                    <RotateCw size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Hướng vân<div className="sub">{board.grain === 'cross' ? 'Ngang' : 'Theo chiều dài'}</div></div>
                </button>
                <button className="sheet-row" onClick={openMarketSheet}>
                    <Store size={19} style={{ color: 'var(--ok)' }} />
                    <div style={{ flex: 1 }}>
                        Sàn trao đổi
                        <div className="sub">{board.market?.listed ? `${board.market.price?.toLocaleString('vi-VN')}đ · ${board.market.dxfFile}` : 'Chuẩn hóa mã, giá trao đổi, kèm thumbnail và DXF'}</div>
                    </div>
                </button>
            </Sheet>

            <Sheet open={showExport} onClose={() => setShowExport(false)} title="Xuất ván tồn">
                <button className="sheet-row" onClick={exportDxf}>
                    <FileDown size={19} style={{ color: 'var(--violet)' }} />
                    <div style={{ flex: 1 }}>Xuất DXF<div className="sub">{boardFileName(board)}</div></div>
                </button>
            </Sheet>

            <Sheet open={showMarket} onClose={() => setShowMarket(false)} title="Đăng lên sàn trao đổi ván dư"
                sub="Chuẩn hóa mã ván, nhập giá trao đổi và lưu thumbnail/file DXF.">
                <button className="sheet-row" onClick={() => setMarketDraft(d => ({ ...d, code: standardBoardCode(docRef.current.board || board) }))}>
                    <PackageOpen size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>
                        Chuẩn hóa mã ván
                        <div className="sub">{marketDraft.code || standardBoardCode(board)}</div>
                    </div>
                </button>
                <div className="field">
                    <label>Mã ván trao đổi</label>
                    <input value={marketDraft.code} onChange={e => setMarketDraft(d => ({ ...d, code: e.target.value }))} />
                </div>
                <div className="field">
                    <label>Tên hiển thị</label>
                    <input value={marketDraft.title} onChange={e => setMarketDraft(d => ({ ...d, title: e.target.value }))} />
                </div>
                <div className="field">
                    <label>Giá trao đổi (VND)</label>
                    <input inputMode="numeric" value={marketDraft.price}
                        onChange={e => setMarketDraft(d => ({ ...d, price: e.target.value.replace(/[^\d]/g, '') }))}
                        placeholder="VD: 350000" />
                </div>
                <div className="field">
                    <label>Trạng thái</label>
                    <select value={marketDraft.status} onChange={e => setMarketDraft(d => ({ ...d, status: e.target.value }))}>
                        <option value="available">Đang trao đổi</option>
                        <option value="reserved">Giữ chỗ</option>
                        <option value="sold">Đã trao đổi</option>
                    </select>
                </div>
                <input
                    ref={marketPhotoRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={pickMarketPhoto}
                />
                <button className="sheet-row" onClick={() => marketPhotoRef.current?.click()}>
                    {marketDraft.photoThumb ? (
                        <img className="market-photo-mini" src={marketDraft.photoThumb} alt="Ảnh ván" />
                    ) : (
                        <PackageOpen size={19} style={{ color: 'var(--ok)' }} />
                    )}
                    <div style={{ flex: 1 }}>
                        Ảnh chụp tấm ván
                        <div className="sub">{marketDraft.photoThumb ? 'Sàn trao đổi sẽ ưu tiên ảnh này làm thumbnail' : 'Nên chụp ảnh thật của tấm ván trước khi đăng sàn'}</div>
                    </div>
                </button>
                <div className="field">
                    <label>Mô tả</label>
                    <input value={marketDraft.desc} onChange={e => setMarketDraft(d => ({ ...d, desc: e.target.value }))} />
                </div>
                <div className="market-preview">
                    <div className="market-preview-title">Gói đăng sàn sẽ gồm</div>
                    <div>Thumbnail: {marketDraft.photoThumb ? 'ảnh chụp tấm ván' : makeBoardThumb(board) ? 'hình biên vẽ' : 'chưa có'}</div>
                    <div>File vẽ: {boardFileName({ ...board, code: marketDraft.code || board.code })}</div>
                    <div>Diện tích: {(boardArea(board) / 1e6).toFixed(3)} m²</div>
                </div>
                <button className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={publishMarket}>
                    <UploadCloud size={17} /> Đăng lên sàn
                </button>
            </Sheet>

            <NumPad cfg={numpad} onClose={() => setNumpad(null)} />
            <TextSheet cfg={textSheet} onClose={() => setTextSheet(null)} />
            <Confirm cfg={confirm} onClose={() => setConfirm(null)} />
        </div>
    );
}
