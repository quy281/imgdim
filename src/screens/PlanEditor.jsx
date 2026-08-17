import React, { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Group } from 'react-konva';
import {
    ArrowLeft, Undo2, Redo2, Share2, BrickWall, Ruler, DoorOpen, AppWindow,
    MessageSquareText, Settings2, Trash2, X, Pencil, FlipHorizontal2, Image as ImageIcon, FileDown,
    ClipboardList, Check, Sofa, RotateCw, Maximize2, LayoutTemplate, Frame,
} from 'lucide-react';
import PlanGrid from '../plan/PlanGrid';
import WallsLayer from '../plan/WallsLayer';
import RoomLabels from '../plan/RoomLabels';
import DrawPreview from '../plan/DrawPreview';
import FurnitureLayer from '../plan/FurnitureLayer';
import ElevationView from '../plan/ElevationView';
import { GROUPS, FURNITURE, catalogItem, defaultSize } from '../lib/furnitureCatalog';
import NoteMarker from '../photo/NoteMarker';
import Sheet from '../ui/Sheet';
import NumPad from '../ui/NumPad';
import TextSheet from '../ui/TextSheet';
import ChecklistSheet from '../ui/ChecklistSheet';
import Confirm from '../ui/Confirm';
import { toast } from '../ui/Toast';
import {
    genId, dist, snapToGrid, snapOrtho, findNearbyNode,
    applyWallLength, scaleAllWalls, snapToWall, splitWallAtPoint, bboxOfPlan,
    applySegmentLength, applyOpeningWidth, wallSegments, snapFurnitureToWall,
    roomFaces, ceilingHeight, openingV, applyOpeningVertical, applyCeilingHeight,
} from '../lib/geometry';
import {
    addWallSegment, deleteWall, moveNode, renameRoom, recomputeRooms,
    addOpening, removeOpening, updateOpening, insertTemplate,
} from '../lib/planModel';
import { loadTemplates, saveTemplateFromRoom, deleteTemplate } from '../lib/roomTemplates';
import { generateDxf } from '../lib/dxf';
import { stageToDataURL, downloadDataURL, downloadText, shareDataURL, stamp } from '../lib/export';

const MODES = [
    { id: 'draw', icon: BrickWall, label: 'Tường' },
    { id: 'editKT', icon: Ruler, label: 'Sửa KT' },
    { id: 'door', icon: DoorOpen, label: 'Cửa' },
    { id: 'window', icon: AppWindow, label: 'Cửa sổ' },
    { id: 'furniture', icon: Sofa, label: 'Nội thất' },
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
    const [checklistSheet, setChecklistSheet] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const [openingSheet, setOpeningSheet] = useState(null); // {wallId, openingId}
    const [showExport, setShowExport] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showNotes, setShowNotes] = useState(false);
    const [showFurnPicker, setShowFurnPicker] = useState(false);
    const [furnGroup, setFurnGroup] = useState('bedroom');
    const [showFurnSizes, setShowFurnSizes] = useState(false);
    const [templates, setTemplates] = useState(null); // null = chưa mở picker
    const [roomMenu, setRoomMenu] = useState(null);
    // Lưu wallId đang xem, KHÔNG lưu chỉ số: danh sách mặt được tính lại sau mỗi commit,
    // chỉ số sẽ trôi và nhảy sang mặt khác giữa chừng.
    const [elev, setElev] = useState(null); // { roomId, faces:[{wallId,len,label}], wallId }
    const [, bumpHist] = useState(0);

    const stageRef = useRef(null);
    const wrapRef = useRef(null);
    const gestureRef = useRef(null);
    const historyRef = useRef({ stack: [{ plan: doc.plan, notes: doc.notes || [], furniture: doc.furniture || [] }], i: 0 });

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
        const bb = bboxOfPlan(doc.plan, doc.notes, doc.furniture);
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
    const syncEphemeral = (plan, notes, furniture) => {
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
            if (s.kind === 'furniture' && !(furniture || []).some(f => f.id === s.id)) return null;
            return s;
        });
        // Mặt đứng đang mở mà tường/phòng của nó biến mất (undo, xóa tường) → đóng lại,
        // không thì overlay treo màn trắng. Tường còn nhưng đổi hình thì cập nhật độ dài.
        setElev(e => {
            if (!e) return e;
            const room = (plan.rooms || []).find(r => r.id === e.roomId);
            if (!room) return null;
            const faces = roomFaces(plan, room);
            if (!faces.length) return null;
            // giữ đúng mặt đang xem; chỉ rơi về mặt đầu khi tường đó thật sự biến mất
            const stillThere = faces.some(f => f.wallId === e.wallId);
            return { ...e, faces, wallId: stillThere ? e.wallId : faces[0].wallId };
        });
    };

    // ===== History / commit =====
    const commit = (plan, notes, furniture) => {
        const d = docRef.current;
        const p = plan !== undefined ? plan : d.plan;
        const n = notes !== undefined ? notes : (d.notes || []);
        const f = furniture !== undefined ? furniture : (d.furniture || []);
        const h = historyRef.current;
        h.stack = h.stack.slice(0, h.i + 1);
        h.stack.push({ plan: p, notes: n, furniture: f });
        if (h.stack.length > 50) h.stack.shift();
        h.i = h.stack.length - 1;
        bumpHist(v => v + 1);
        onChange({ ...d, plan: p, notes: n, furniture: f, updatedAt: Date.now() });
        syncEphemeral(p, n, f);
    };

    const applySnapshot = (s) => {
        const f = s.furniture || [];
        onChange({ ...docRef.current, plan: s.plan, notes: s.notes, furniture: f, updatedAt: Date.now() });
        syncEphemeral(s.plan, s.notes, f);
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
        if (m === 'furniture') { setChain(null); setShowFurnPicker(true); return; }
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

    // ===== NumPad cho đoạn tường giữa các cửa =====
    // Tổng tường giữ nguyên — cửa kề bù chênh lệch.
    const openSegmentNumPad = (wallId, segIdx, curLen) => {
        const plan = docRef.current.plan;
        const wall = plan.walls.find(w => w.id === wallId);
        if (!wall) return;
        const nOps = (wall.openings || []).length;
        setNumpad({
            title: 'Đoạn tường',
            initial: curLen,
            hint: nOps === 1
                ? 'Tổng tường giữ nguyên — bề rộng cửa tự bù theo'
                : 'Tổng tường giữ nguyên — cửa kề bên phải tự bù',
            onOK: (val) => {
                const p = docRef.current.plan;
                const { plan: next, warning } = applySegmentLength(p, wallId, segIdx, val);
                if (next !== p) commit(recomputeRooms(next), undefined);
                if (warning) toast(warning, 'err');
            },
        });
    };

    // ===== Nội thất =====
    const furnList = () => docRef.current.furniture || [];

    // Magnet tường: chỉ áp dụng cho món có mặt lưng; ngoài ngưỡng thì bắt lưới.
    const placeFurniture = (item, doCommit, node) => {
        const cat = catalogItem(item.kind);
        let next;
        if (cat?.back) {
            const tol = Math.max(280, 46 / (view?.scale || 1));
            const hit = snapFurnitureToWall(docRef.current.plan, item, item.d, tol);
            next = hit ? { ...item, ...hit } : { ...item, ...snapFn({ x: item.x, y: item.y }) };
        } else {
            next = { ...item, ...snapFn({ x: item.x, y: item.y }) };
        }
        // kéo node Konva về đúng chỗ đã snap để thấy hiệu ứng hút ngay khi đang kéo
        if (node) {
            node.x(next.x);
            node.y(next.y);
            node.rotation(next.rot || 0);
        }
        const list = furnList().map(f => f.id === next.id ? next : f);
        if (doCommit) commit(undefined, undefined, list);
        else onChange({ ...docRef.current, furniture: list });
        return next;
    };

    const addFurniture = (key) => {
        const { w, d, h, z } = defaultSize(key, docRef.current.settings);
        // đặt vào giữa vùng đang xem
        const cx = view ? (stageSize.width / 2 - view.x) / view.scale : 0;
        const cy = view ? (stageSize.height / 2 - view.y) / view.scale : 0;
        const item = { id: genId('f'), kind: key, x: Math.round(cx), y: Math.round(cy), w, d, h, z, rot: 0 };
        const cat = catalogItem(key);
        let placed = item;
        if (cat?.back) {
            const hit = snapFurnitureToWall(docRef.current.plan, item, d, Math.max(900, 120 / (view?.scale || 1)));
            if (hit) placed = { ...item, ...hit };
        }
        commit(undefined, undefined, [...furnList(), placed]);
        setShowFurnPicker(false);
        setModeRaw('select');
        setSel({ kind: 'furniture', id: placed.id });
        toast(`${cat?.name || 'Nội thất'} — kéo để đặt, chạm 2 lần để quay`, 'ok');
    };

    const rotateFurniture = (item) => {
        const rot = ((item.rot || 0) + 90) % 360;
        commit(undefined, undefined, furnList().map(f => f.id === item.id ? { ...f, rot } : f));
    };

    const removeFurniture = (id) => {
        commit(undefined, undefined, furnList().filter(f => f.id !== id));
        setSel(null);
    };

    const resizeFurniture = (item) => {
        setNumpad({
            title: 'Chiều rộng (mm)',
            initial: item.w,
            onOK: (wv) => setNumpad({
                title: 'Chiều sâu (mm)',
                initial: item.d,
                onOK: (dv) => {
                    const upd = { ...item, w: wv, d: dv };
                    const list = furnList().map(f => f.id === item.id ? upd : f);
                    commit(undefined, undefined, list);
                },
            }),
        });
    };

    // ===== Mặt đứng (khai triển tường) =====
    const openCeilingNumPad = (roomId, opts = {}) => {
        const plan = docRef.current.plan;
        const room = (plan.rooms || []).find(r => r.id === roomId);
        if (!room) return;
        const cur = ceilingHeight(room, docRef.current.settings);
        setNumpad({
            title: `Chiều cao thông thủy${room.name ? ` — ${room.name}` : ''}`,
            initial: Math.round(cur),
            hint: 'Đo một lần, áp cho cả 4 mặt của phòng',
            onOK: (val) => {
                const p = docRef.current.plan;
                const { plan: next, warning } = applyCeilingHeight(p, roomId, val, docRef.current.settings);
                if (next !== p) commit(next, undefined);
                if (warning) toast(warning, 'err');
            },
        });
    };

    const openElevation = (room) => {
        const plan = docRef.current.plan;
        if (!plan.calibrated) {
            toast('Nhập số đo laser cho một tường trước để có tỉ lệ thật', 'err');
            return;
        }
        const faces = roomFaces(plan, room);
        if (!faces.length) { toast('Phòng chưa khép kín — chưa dựng được mặt đứng', 'err'); return; }
        setSel(null);
        setElev({ roomId: room.id, faces, wallId: faces[0].wallId });
        // Chưa đo trần thì hỏi luôn — phát laser đầu tiên khi bước vào phòng.
        // Mở màn hình TRƯỚC rồi mới hỏi: bấm Hủy vẫn xem được với số mặc định.
        if (!Number.isFinite(room.h)) openCeilingNumPad(room.id);
    };

    const elevRoom = () => (docRef.current.plan.rooms || []).find(r => r.id === elev?.roomId);
    const elevH = () => ceilingHeight(elevRoom(), docRef.current.settings);

    const openVerticalNumPad = (opId, part, value) => {
        const el = elev;
        if (!el) return;
        const wallId = el.wallId;
        const wall = docRef.current.plan.walls.find(w => w.id === wallId);
        const op = (wall?.openings || []).find(o => o.id === opId);
        if (!op) return;
        const v = openingV(op, docRef.current.settings);
        const TITLES = {
            sill: 'Cao độ bệ cửa (từ sàn)',
            op: 'Chiều cao ô cửa',
            head: 'Từ đỉnh cửa lên trần',
            top: 'Cốt đỉnh cửa (từ sàn)',
        };
        const CUR = { sill: v.sill, op: v.h, head: elevH() - v.top, top: v.top };
        setNumpad({
            title: TITLES[part] || 'Cao độ',
            initial: Math.round(value ?? CUR[part] ?? 0),
            allowZero: part === 'sill',
            hint: part === 'sill'
                ? 'Chiều cao trần giữ nguyên — phần trên cửa tự bù'
                : 'Chiều cao trần giữ nguyên',
            onOK: (val) => {
                const p = docRef.current.plan;
                const { plan: next, warning } = applyOpeningVertical(
                    p, wallId, opId, part, val, elevH(), docRef.current.settings);
                if (next !== p) commit(next, undefined);
                if (warning) toast(warning, 'err');
            },
        });
    };

    // ===== Template phòng =====
    const openTemplatePicker = async () => {
        setTemplates(await loadTemplates());
    };

    const insertTpl = (tpl) => {
        // đặt template vào giữa vùng đang xem, bắt lưới góc trên-trái
        const cx = view ? (stageSize.width / 2 - view.x) / view.scale : 0;
        const cy = view ? (stageSize.height / 2 - view.y) / view.scale : 0;
        const at = snapFn({ x: cx - tpl.w / 2, y: cy - tpl.d / 2 });
        const { plan, added, shared } = insertTemplate(
            docRef.current.plan, tpl, at, settings.thickness || 110,
        );
        if (!added) { toast('Template trùng hoàn toàn với tường có sẵn', 'err'); return; }
        commit(recomputeRooms(plan), undefined);
        setTemplates(null);
        setModeRaw('select');
        setChain(null);
        toast(shared > 0
            ? `Đã chèn ${tpl.name} — dùng chung ${shared} tường có sẵn`
            : `Đã chèn ${tpl.name} (${tpl.w}×${tpl.d})`, 'ok');
    };

    const saveRoomAsTemplate = (room) => {
        setTextSheet({
            title: 'Lưu thành template',
            label: 'Tên template',
            initial: room.name || '',
            placeholder: 'VD: Ngủ con 3.2x3.8',
            onOK: async (name) => {
                try {
                    await saveTemplateFromRoom(name, docRef.current.plan, room);
                    toast(`Đã lưu template "${name}"`, 'ok');
                } catch (err) {
                    toast(err.message, 'err');
                }
            },
        });
    };

    const removeTpl = async (tpl) => {
        await deleteTemplate(tpl.id);
        setTemplates(await loadTemplates());
        toast('Đã xóa template', 'ok');
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
                commit(recomputeRooms(res.plan), undefined);
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
            const newNote = { id: genId('t'), x: w.x, y: w.y, items: [] };
            setChecklistSheet({
                note: newNote,
                onSave: (note) => {
                    if (!note.items?.length) return;
                    commit(undefined, [...(docRef.current.notes || []), note]);
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
            const s = docRef.current.settings || {};
            const width = type === 'door' ? (s.doorWidth || 900) : (s.windowWidth || 1200);
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
        setRoomMenu(r);
    };

    const onNodeDrag = (nodeId, pos, commitFlag) => {
        const p = moveNode(docRef.current.plan, nodeId, pos);
        if (commitFlag) commit(recomputeRooms(p), undefined);
        else onChange({ ...docRef.current, plan: p });
    };

    const toggleNoteItem = (noteId, itemId) => {
        const notes = (docRef.current.notes || []).map(n => {
            if (n.id !== noteId) return n;
            return { ...n, items: (n.items || []).map(it => it.id === itemId ? { ...it, done: !it.done } : it) };
        });
        commit(undefined, notes);
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
        const bb = bboxOfPlan(d.plan, d.notes, d.furniture);
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
    const selFurn = sel?.kind === 'furniture' ? (doc.furniture || []).find(f => f.id === sel.id) : null;

    const bannerText = () => {
        if (mode === 'draw') return chain
            ? 'Chạm điểm tiếp theo · chạm vào điểm cũ để khép phòng'
            : 'Chạm để đặt điểm bắt đầu tường';
        if (mode === 'editKT') return 'Chạm tường để nhập số đo laser · nhãn đỏ = đã nhập';
        if (mode === 'door') return `Chạm vào tường để đặt cửa đi (${settings.doorWidth || 900}mm)`;
        if (mode === 'window') return `Chạm vào tường để đặt cửa sổ (${settings.windowWidth || 1200}mm)`;
        if (mode === 'furniture') return 'Chọn món trong danh sách để thêm vào mặt bằng';
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
                <button className={`icon-btn${showNotes ? ' icon-btn-on' : ''}`}
                    style={showNotes ? { color: 'var(--blue)', background: 'var(--blue-soft)' } : {}}
                    onClick={() => setShowNotes(v => !v)}>
                    <ClipboardList size={20} />
                    {(doc.notes || []).length > 0 && (
                        <span style={{ position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)' }} />
                    )}
                </button>
                <button className="icon-btn" style={{ color: 'var(--red-dark)' }} onClick={() => setShowExport(true)}><Share2 size={20} /></button>
            </div>

            {/* Mặt đứng — overlay trong chính màn hình này để dùng chung undo/history */}
            {elev && (
                <ElevationView
                    doc={doc} elev={elev}
                    onClose={() => setElev(null)}
                    onPick={(wallId) => setElev(e => ({ ...e, wallId }))}
                    onSegmentTap={openSegmentNumPad}
                    onVerticalTap={openVerticalNumPad}
                    onCeilingTap={() => openCeilingNumPad(elev.roomId)}
                />
            )}

            {/* Mode banner */}
            <div className={`mode-banner ${mode}`}>
                <span>{bannerText()}</span>
                <span className="spacer" />
                {mode === 'draw' && (
                    <button className="banner-btn" onClick={openTemplatePicker}>▦ Template</button>
                )}
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
                                contentBounds={bboxOfPlan(doc.plan, doc.notes, doc.furniture)}
                                gridMinor={settings.gridMinor || 100} gridMajor={settings.gridMajor || 1000}
                            />
                            <WallsLayer
                                plan={doc.plan} scale={view.scale} sel={sel}
                                listening={listening} showHandles={mode === 'select'}
                                onWallTap={onWallTap}
                                onLabelTap={(id) => openWallNumPad(id)}
                                onOpeningTap={onOpeningTap}
                                onSegmentTap={openSegmentNumPad}
                                onNodeDrag={onNodeDrag}
                                snapFn={snapFn}
                            />
                            <RoomLabels plan={doc.plan} scale={view.scale} listening={mode === 'select'} onTap={onRoomTap} />
                            <FurnitureLayer
                                items={doc.furniture} scale={view.scale} sel={sel}
                                listening={mode === 'select'}
                                onSelect={(id) => { setSel({ kind: 'furniture', id }); setOpeningSheet(null); }}
                                onChange={(item, doCommit) => placeFurniture(item, doCommit)}
                                onRotate={rotateFurniture}
                            />
                            <Group listening={mode === 'select'}>
                                {(doc.notes || []).map(n => (
                                    <NoteMarker key={n.id} note={n} scale={view.scale}
                                        isSelected={sel?.kind === 'note' && sel.id === n.id}
                                        onSelect={(id) => { setSel({ kind: 'note', id }); setOpeningSheet(null); }}
                                        onEdit={(note) => setChecklistSheet({
                                            note,
                                            onSave: (updated) => commit(undefined, (docRef.current.notes || []).map(x => x.id === updated.id ? updated : x)),
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
                        <button className="fb-btn" style={{ color: 'var(--blue)' }} onClick={() => setChecklistSheet({
                            note: selNote,
                            onSave: (updated) => commit(undefined, (docRef.current.notes || []).map(x => x.id === updated.id ? updated : x)),
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

                {selFurn && mode === 'select' && (
                    <div className="float-bar">
                        <button className="fb-btn" style={{ color: 'var(--violet)' }} onClick={() => rotateFurniture(selFurn)}>
                            <RotateCw size={16} /> Quay 90°
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" style={{ color: 'var(--blue)' }} onClick={() => resizeFurniture(selFurn)}>
                            <Maximize2 size={16} /> {selFurn.w}×{selFurn.d}
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" style={{ color: '#dc2626' }} onClick={() => removeFurniture(selFurn.id)}>
                            <Trash2 size={16} />
                        </button>
                        <div className="fb-sep" />
                        <button className="fb-btn" onClick={() => setSel(null)}><X size={16} /></button>
                    </div>
                )}

                {/* Notes side panel */}
                {showNotes && (
                    <div className="notes-panel">
                        <div className="notes-panel-hdr">
                            <ClipboardList size={15} />
                            <span style={{ flex: 1 }}>Ghi chú ({(doc.notes || []).length})</span>
                            <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setShowNotes(false)}>
                                <X size={15} />
                            </button>
                        </div>
                        <div className="notes-panel-body">
                            {(doc.notes || []).length === 0 ? (
                                <div className="notes-empty">Chưa có ghi chú</div>
                            ) : (doc.notes || []).map(note => {
                                const items = note.items || (note.text ? [{ id: '_', text: note.text, done: false }] : []);
                                const done = items.filter(it => it.done).length;
                                return (
                                    <div key={note.id} className="note-card">
                                        {items.length > 0 && (
                                            <div className="note-card-meta">{done}/{items.length} xong</div>
                                        )}
                                        {items.map(it => (
                                            <button key={it.id} className="note-item" onClick={() => toggleNoteItem(note.id, it.id)}>
                                                <span className={`note-cb${it.done ? ' done' : ''}`}>
                                                    {it.done && <Check size={10} strokeWidth={3} color="#fff" />}
                                                </span>
                                                <span className="note-text" style={{ textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--muted)' : 'var(--ink)' }}>
                                                    {it.text}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                );
                            })}
                        </div>
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
            <ChecklistSheet cfg={checklistSheet} onClose={() => setChecklistSheet(null)} />
            <Confirm cfg={confirm} onClose={() => setConfirm(null)} />

            {/* Room menu */}
            <Sheet open={!!roomMenu} onClose={() => setRoomMenu(null)}
                title={roomMenu?.name || 'Phòng'}
                sub={roomMenu ? `${(roomMenu.area / 1e6).toFixed(1)} m² · chu vi ${(roomMenu.perimeter / 1000).toFixed(1)} m (tim tường)` : ''}>
                <button className="sheet-row" onClick={() => {
                    const r = roomMenu;
                    setRoomMenu(null);
                    setTextSheet({
                        title: 'Tên phòng',
                        initial: r.name,
                        onOK: (name) => commit(renameRoom(docRef.current.plan, r.id, name), undefined),
                    });
                }}>
                    <Pencil size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>Đổi tên phòng</div>
                </button>
                <button className="sheet-row" onClick={() => {
                    const r = roomMenu;
                    setRoomMenu(null);
                    openElevation(r);
                }}>
                    <Frame size={19} style={{ color: 'var(--blue)' }} />
                    <div style={{ flex: 1 }}>
                        Dựng mặt đứng 4 mặt
                        <div className="sub">
                            {Number.isFinite(roomMenu?.h)
                                ? `Cao trần ${Math.round(roomMenu.h)}mm`
                                : 'Sẽ hỏi chiều cao trần một lần'}
                        </div>
                    </div>
                </button>
                <button className="sheet-row" onClick={() => {
                    const r = roomMenu;
                    setRoomMenu(null);
                    saveRoomAsTemplate(r);
                }}>
                    <LayoutTemplate size={19} style={{ color: 'var(--violet)' }} />
                    <div style={{ flex: 1 }}>
                        Lưu thành template
                        <div className="sub">Dùng lại cho dự án khác</div>
                    </div>
                </button>
            </Sheet>

            {/* Template picker */}
            <Sheet open={!!templates} onClose={() => setTemplates(null)}
                title="Template phòng" sub="Chèn vào giữa vùng đang xem · tường trùng sẽ dùng chung">
                <div style={{ maxHeight: '54vh', overflowY: 'auto' }}>
                    {(templates || []).map(t => (
                        <div key={t.id} className="sheet-row" style={{ cursor: 'pointer' }} onClick={() => insertTpl(t)}>
                            <LayoutTemplate size={18} style={{ color: t.builtin ? 'var(--muted)' : 'var(--violet)' }} />
                            <div style={{ flex: 1 }}>
                                {t.name}
                                <div className="sub">
                                    {t.w} × {t.d} mm · {t.nodes.length} điểm
                                    {!t.builtin && ' · của tôi'}
                                </div>
                            </div>
                            {!t.builtin && (
                                <button className="icon-btn" style={{ color: '#dc2626' }}
                                    onClick={(e) => { e.stopPropagation(); removeTpl(t); }}>
                                    <Trash2 size={16} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </Sheet>

            {/* Furniture picker */}
            <Sheet open={showFurnPicker} onClose={() => { setShowFurnPicker(false); setModeRaw('select'); }}
                title="Thêm nội thất" sub="Món có mặt lưng sẽ tự hút vào tường khi kéo gần">
                <div className="chip-row" style={{ marginBottom: 6 }}>
                    {GROUPS.map(g => (
                        <button key={g.key} className={`chip ${furnGroup === g.key ? 'on' : ''}`}
                            onClick={() => setFurnGroup(g.key)}>
                            {g.name}
                        </button>
                    ))}
                </div>
                <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
                    {FURNITURE[furnGroup].map(it => {
                        const sz = defaultSize(it.key, settings);
                        return (
                            <button key={it.key} className="sheet-row" onClick={() => addFurniture(it.key)}>
                                <Sofa size={18} style={{ color: it.back ? 'var(--blue)' : 'var(--muted)' }} />
                                <div style={{ flex: 1 }}>
                                    {it.name}
                                    <div className="sub">{sz.w} × {sz.d} mm{it.back ? ' · hút tường' : ''}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
                <button className="sheet-row" style={{ borderTop: '1px solid var(--line)', marginTop: 4 }}
                    onClick={() => { setShowFurnPicker(false); setShowFurnSizes(true); }}>
                    <Settings2 size={18} style={{ color: 'var(--ink-2)' }} />
                    <div style={{ flex: 1 }}>Sửa kích thước mặc định<div className="sub">Áp dụng cho món thêm sau</div></div>
                </button>
            </Sheet>

            {/* Furniture default sizes */}
            <Sheet open={showFurnSizes} onClose={() => setShowFurnSizes(false)}
                title="Kích thước mặc định" sub="Chạm để sửa — chỉ ảnh hưởng món thêm mới">
                <div className="chip-row" style={{ marginBottom: 6 }}>
                    {GROUPS.map(g => (
                        <button key={g.key} className={`chip ${furnGroup === g.key ? 'on' : ''}`}
                            onClick={() => setFurnGroup(g.key)}>
                            {g.name}
                        </button>
                    ))}
                </div>
                <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                    {FURNITURE[furnGroup].map(it => {
                        const sz = defaultSize(it.key, settings);
                        const custom = !!settings.furnitureDefaults?.[it.key];
                        const saveSize = (w, d) => onChange({
                            ...docRef.current,
                            settings: {
                                ...docRef.current.settings,
                                furnitureDefaults: { ...(docRef.current.settings?.furnitureDefaults || {}), [it.key]: { w, d } },
                            },
                        });
                        return (
                            <button key={it.key} className="sheet-row" onClick={() => setNumpad({
                                title: `${it.name} — chiều rộng`,
                                initial: sz.w,
                                onOK: (wv) => setNumpad({
                                    title: `${it.name} — chiều sâu`,
                                    initial: sz.d,
                                    onOK: (dv) => saveSize(wv, dv),
                                }),
                            })}>
                                <div style={{ flex: 1 }}>
                                    {it.name}
                                    <div className="sub" style={custom ? { color: 'var(--blue)', fontWeight: 600 } : {}}>
                                        {sz.w} × {sz.d} mm{custom ? ' · đã sửa' : ''}
                                    </div>
                                </div>
                                <Ruler size={16} style={{ color: 'var(--muted)' }} />
                            </button>
                        );
                    })}
                </div>
            </Sheet>

            {/* Opening detail */}
            <Sheet open={!!(openingSheet && selOpening)} onClose={() => setOpeningSheet(null)}
                title={selOpening?.type === 'door' ? 'Cửa đi' : 'Cửa sổ'}>
                {selOpening && (
                    <>
                        <button className="sheet-row" onClick={() => setNumpad({
                            title: `Chiều rộng ${selOpening.type === 'door' ? 'cửa đi' : 'cửa sổ'}`,
                            initial: selOpening.width,
                            hint: 'Tổng tường giữ nguyên — đoạn tường kề tự bù',
                            onOK: (val) => {
                                const p = docRef.current.plan;
                                const { plan: next, warning } = applyOpeningWidth(p, openingSheet.wallId, openingSheet.openingId, val);
                                if (next !== p) commit(recomputeRooms(next), undefined);
                                if (warning) toast(warning, 'err');
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

                <div style={{ padding: '12px 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>Bề rộng cửa mặc định</div>
                <button className="sheet-row" onClick={() => setNumpad({
                    title: 'Bề rộng cửa đi', initial: settings.doorWidth || 900,
                    onOK: (val) => onChange({ ...docRef.current, settings: { ...docRef.current.settings, doorWidth: val } }),
                })}>
                    <DoorOpen size={19} style={{ color: 'var(--warn)' }} />
                    <div style={{ flex: 1 }}>Cửa đi<div className="sub">{settings.doorWidth || 900} mm</div></div>
                </button>
                <button className="sheet-row" onClick={() => setNumpad({
                    title: 'Bề rộng cửa sổ', initial: settings.windowWidth || 1200,
                    onOK: (val) => onChange({ ...docRef.current, settings: { ...docRef.current.settings, windowWidth: val } }),
                })}>
                    <AppWindow size={19} style={{ color: 'var(--ok)' }} />
                    <div style={{ flex: 1 }}>Cửa sổ<div className="sub">{settings.windowWidth || 1200} mm</div></div>
                </button>
            </Sheet>
        </div>
    );
}
