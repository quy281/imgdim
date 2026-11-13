import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
    ArrowLeft, Plus, Upload, Download, CloudUpload, RotateCcw,
    Save, Copy, Trash2, Search, Eye, EyeOff, Box, Shapes, Sliders,
} from 'lucide-react';
import {
    GROUPS, SYM_2D_OPTIONS, SYM_3D_OPTIONS, MAT_3D_OPTIONS, groupName,
    listAdminCatalogItems, getBuiltinItem, getItemGlbSource,
    saveCatalogItem, resetCatalogItem, deleteCatalogItem, resetAllCatalog,
    getCatalogSyncPayload, applyCatalogSyncPayload,
    exportCatalogSnapshot, importCatalogSnapshot, subscribeCatalog,
} from '../lib/furnitureCatalog';
import { Symbol2D, itemFill } from '../plan/FurnitureLayer';
import { buildFurniture3D } from '../lib/room3dModels';
import { downloadText, stamp } from '../lib/export';
import * as pb from '../lib/pb';
import { toast } from '../ui/Toast';

const FONT = "-apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

function makeDraftFromItem(item) {
    if (!item) return null;
    return {
        key: item.key,
        name: item.name || '',
        group: item.group || 'other',
        w: Number(item.w) || 600,
        d: Number(item.d) || 600,
        h: Number(item.h) || 800,
        z: Number(item.z) || 0,
        mount: item.mount || 'floor',
        back: !!item.back,
        noSnapContact: !!item.noSnapContact,
        hidden: !!item.hidden,
        sym: item.sym || 'box',
        sym3d: item.sym3d || '',
        color2d: item.color2d || '',
        fill2d: item.fill2d || '',
        svg2d: item.svg2d || '',
        matPrimary: item.matPrimary || '',
        matSecondary: item.matSecondary || '',
        matAccent: item.matAccent || '',
        glbUrl: item.glbUrl || '',
        glbFileName: item.glbFileName || '',
        hasLocalGlb: !!item.hasLocalGlb,
        isBuiltin: !!item.isBuiltin,
        isCustom: !!item.isCustom,
        isModified: !!item.isModified,
    };
}

/** Khung preview 2D Konva trực tiếp kèm vạch kích thước Rộng × Sâu */
function Preview2DCanvas({ draft, svgValid }) {
    const boxW = 360;
    const boxH = 220;
    const w = Math.max(40, Number(draft?.w) || 600);
    const d = Math.max(40, Number(draft?.d) || 600);
    const scale = Math.min((boxW - 110) / w, (boxH - 86) / d, 0.35);
    const inv = 1 / Math.max(scale, 0.02);
    const sw = 1.25 * inv;
    const color = draft?.color2d || '#334155';
    const subColor = draft?.color2d || '#64748b';
    const cx = boxW / 2;
    const cy = boxH / 2 - 4;
    const previewCat = {
        ...draft,
        svg2d: svgValid ? draft.svg2d : '',
    };
    const previewItem = { id: 'preview', kind: draft?.key, w, d, h: draft?.h || 800, rot: 0 };
    const dimOffset = 18 * inv;
    const tk = 4 * inv;

    return (
        <Stage width={boxW} height={boxH} className="cat-stage-2d">
            <Layer>
                <Rect x={0} y={0} width={boxW} height={boxH} fill="#f8fafc" />
                <Group x={cx} y={cy} scaleX={scale} scaleY={scale}>
                    {/* Đường gợi ý mặt tường phía lưng */}
                    {draft?.back && (
                        <Line
                            points={[-w / 2 - 45 * inv, -d / 2, w / 2 + 45 * inv, -d / 2]}
                            stroke="#94a3b8"
                            strokeWidth={2 * inv}
                            dash={[6 * inv, 4 * inv]}
                        />
                    )}
                    <Rect
                        x={-w / 2}
                        y={-d / 2}
                        width={w}
                        height={d}
                        fill={itemFill(previewCat, false, false)}
                        stroke={color}
                        strokeWidth={sw * 1.4}
                    />
                    {draft?.back && (
                        <Line points={[-w / 2, -d / 2, w / 2, -d / 2]} stroke={color} strokeWidth={sw * 3} />
                    )}
                    <Symbol2D
                        sym={draft?.sym || 'box'}
                        w={w}
                        d={d}
                        sw={sw}
                        color={color}
                        subColor={subColor}
                        item={previewItem}
                        cat={previewCat}
                    />

                    {/* Đường dim Rộng W phía dưới */}
                    <Line points={[-w / 2, d / 2 + 4 * inv, -w / 2, d / 2 + dimOffset + tk]} stroke="#2563eb" strokeWidth={inv} />
                    <Line points={[w / 2, d / 2 + 4 * inv, w / 2, d / 2 + dimOffset + tk]} stroke="#2563eb" strokeWidth={inv} />
                    <Line points={[-w / 2, d / 2 + dimOffset, w / 2, d / 2 + dimOffset]} stroke="#2563eb" strokeWidth={1.2 * inv} />
                    <Text
                        x={-w / 2 - 40 * inv}
                        y={d / 2 + dimOffset + 3 * inv}
                        width={w + 80 * inv}
                        align="center"
                        text={`Rộng ${Math.round(w)} mm`}
                        fontSize={11 * inv}
                        fontFamily={FONT}
                        fontStyle="700"
                        fill="#1d4ed8"
                    />

                    {/* Đường dim Sâu D bên phải */}
                    <Line points={[w / 2 + 4 * inv, -d / 2, w / 2 + dimOffset + tk, -d / 2]} stroke="#0f766e" strokeWidth={inv} />
                    <Line points={[w / 2 + 4 * inv, d / 2, w / 2 + dimOffset + tk, d / 2]} stroke="#0f766e" strokeWidth={inv} />
                    <Line points={[w / 2 + dimOffset, -d / 2, w / 2 + dimOffset, d / 2]} stroke="#0f766e" strokeWidth={1.2 * inv} />
                    <Text
                        x={w / 2 + dimOffset + 5 * inv}
                        y={-6 * inv}
                        text={`${Math.round(d)}`}
                        fontSize={11 * inv}
                        fontFamily={FONT}
                        fontStyle="700"
                        fill="#0f766e"
                    />
                </Group>
            </Layer>
        </Stage>
    );
}

/** Khung preview 3D Three.js trực tiếp với sàn + tường mẫu + file GLB/tham số */
function Preview3DCanvas({ draft, glbDataOverride, showWall }) {
    const mountRef = useRef(null);

    useEffect(() => {
        const container = mountRef.current;
        if (!container || !draft) return;

        const width = Math.max(container.clientWidth || 360, 260);
        const height = Math.max(container.clientHeight || 250, 220);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xeef2f7);

        const camera = new THREE.PerspectiveCamera(40, width / height, 20, 40000);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height);
        renderer.shadowMap.enabled = true;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.maxPolarAngle = Math.PI * 0.49;

        const hemi = new THREE.HemisphereLight(0xffffff, 0xd6cfc2, 1.0);
        hemi.position.set(0, 6000, 0);
        scene.add(hemi);
        const sun = new THREE.DirectionalLight(0xfffcf2, 1.05);
        sun.position.set(2800, 4200, 3200);
        sun.castShadow = true;
        scene.add(sun);

        const w = Math.max(60, Number(draft.w) || 600);
        const d = Math.max(40, Number(draft.d) || 600);
        const h = Math.max(20, Number(draft.h) || 800);
        const z0 = Math.max(0, Number(draft.z) || 0);
        const maxDim = Math.max(w, d, h + z0, 900);

        const floorSize = Math.max(2600, maxDim * 2.4);
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(floorSize, floorSize),
            new THREE.MeshStandardMaterial({ color: 0xeaddcf, roughness: 0.78 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        const grid = new THREE.GridHelper(floorSize, Math.max(6, Math.round(floorSize / 400)), 0xcbd5e1, 0xe2e8f0);
        grid.position.y = 1;
        scene.add(grid);

        if (showWall) {
            const wallH = Math.max(2800, z0 + h + 400);
            const wall = new THREE.Mesh(
                new THREE.BoxGeometry(Math.max(w + 1000, 2200), wallH, 100),
                new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.88 })
            );
            wall.position.set(0, wallH / 2, -d / 2 - 52);
            wall.receiveShadow = true;
            scene.add(wall);
        }

        const catFor3d = {
            ...draft,
            glbData: glbDataOverride !== undefined ? glbDataOverride : getItemGlbSource(draft.key),
        };
        const model = buildFurniture3D({ id: 'p3d', kind: draft.key, w, d, h, z: z0 }, catFor3d, 2800);
        model.position.set(0, z0, 0);
        scene.add(model);

        const centerY = z0 + h * 0.45;
        controls.target.set(0, centerY, 0);
        const camDist = maxDim * 1.95;
        camera.position.set(camDist * 0.78, centerY + camDist * 0.56, camDist * 0.92);
        controls.update();

        let animId = 0;
        const animate = () => {
            animId = requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        };
        animate();

        const ro = new ResizeObserver(() => {
            const nw = Math.max(container.clientWidth || 300, 200);
            const nh = Math.max(container.clientHeight || 240, 200);
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
        });
        ro.observe(container);

        return () => {
            cancelAnimationFrame(animId);
            ro.disconnect();
            controls.dispose();
            scene.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
            renderer.dispose();
        };
    }, [draft, glbDataOverride, showWall]);

    return <div className="cat-stage-3d" ref={mountRef} />;
}

/** Bộ chọn nhanh chất liệu 3D + màu #hex tuỳ chọn */
function MaterialPicker({ label, value, onChange }) {
    const isHex = typeof value === 'string' && value.startsWith('#');
    return (
        <div className="cat-mat-field">
            <div className="cat-mat-head">
                <span>{label}</span>
                <label className="cat-hex-pick" title="Chọn màu RGB tuỳ ý">
                    <input
                        type="color"
                        value={isHex ? value : '#c99a6b'}
                        onChange={(e) => onChange(e.target.value)}
                    />
                    <span>{isHex ? value.toUpperCase() : 'Màu tuỳ ý'}</span>
                </label>
            </div>
            <div className="mat-swatch-grid">
                {MAT_3D_OPTIONS.map((m) => {
                    const active = (value || '') === m.key;
                    return (
                        <button
                            key={m.key || '_default'}
                            type="button"
                            className={`mat-swatch-btn ${active ? 'on' : ''}`}
                            onClick={() => onChange(m.key)}
                            title={m.label}
                        >
                            <span
                                className="mat-swatch-dot"
                                style={{ background: m.color || 'linear-gradient(135deg,#fff,#cbd5e1)' }}
                            />
                            <span className="mat-swatch-lbl">{m.key ? m.label : 'Mặc định'}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default function CatalogAdminScreen({ onBack }) {
    const [, setTick] = useState(0);
    const [search, setSearch] = useState('');
    const [groupFilter, setGroupFilter] = useState('all');
    const [selectedKey, setSelectedKey] = useState(() => listAdminCatalogItems()[0]?.key || '');
    const [draft, setDraft] = useState(() => makeDraftFromItem(listAdminCatalogItems()[0]));
    const [pendingGlbData, setPendingGlbData] = useState(undefined);
    const [tab, setTab] = useState('info');
    const [showWall3D, setShowWall3D] = useState(true);
    const [cloudBusy, setCloudBusy] = useState(false);

    const jsonInputRef = useRef(null);
    const svgInputRef = useRef(null);
    const glbInputRef = useRef(null);

    useEffect(() => subscribeCatalog(() => setTick(t => t + 1)), []);

    const items = listAdminCatalogItems();

    const filteredItems = useMemo(() => {
        const q = search.trim().toLowerCase();
        return items.filter((it) => {
            if (groupFilter === 'modified' && !it.isModified) return false;
            if (groupFilter !== 'all' && groupFilter !== 'modified' && it.group !== groupFilter) return false;
            if (!q) return true;
            return it.name.toLowerCase().includes(q) || it.key.toLowerCase().includes(q);
        });
    }, [items, search, groupFilter]);

    const selectItem = (item) => {
        setSelectedKey(item.key);
        setDraft(makeDraftFromItem(item));
        setPendingGlbData(undefined);
    };

    const selectedOrig = useMemo(() => items.find(i => i.key === selectedKey) || null, [items, selectedKey]);
    const modifiedCount = useMemo(() => items.filter(i => i.isModified).length, [items]);
    const svgValid = useMemo(() => {
        if (!draft?.svg2d?.trim()) return true;
        return /<(svg|path|rect|circle|ellipse|line|polygon|polyline)\b/i.test(draft.svg2d);
    }, [draft?.svg2d]);

    const patchDraft = (patch) => setDraft(prev => (prev ? { ...prev, ...patch } : prev));

    const handleCreateNew = () => {
        const newDraft = {
            key: '',
            name: 'Mẫu nội thất mới',
            group: groupFilter !== 'all' && groupFilter !== 'modified' ? groupFilter : 'other',
            w: 1200,
            d: 600,
            h: 850,
            z: 0,
            mount: 'floor',
            back: true,
            noSnapContact: false,
            hidden: false,
            sym: 'cab',
            sym3d: '',
            color2d: '',
            fill2d: '',
            svg2d: '',
            matPrimary: 'oak',
            matSecondary: '',
            matAccent: '',
            glbUrl: '',
            glbFileName: '',
            hasLocalGlb: false,
            isBuiltin: false,
            isCustom: true,
        };
        const created = saveCatalogItem(newDraft);
        setSelectedKey(created.key);
        setDraft(makeDraftFromItem(created));
        setPendingGlbData(undefined);
        toast('Đã thêm mẫu mới vào thư viện', 'ok');
    };

    const handleSave = () => {
        if (!draft) return;
        if (!draft.name.trim()) {
            toast('Vui lòng nhập tên món nội thất', 'err');
            return;
        }
        const saved = saveCatalogItem(draft, pendingGlbData !== undefined ? { glbData: pendingGlbData } : {});
        setSelectedKey(saved.key);
        setDraft(makeDraftFromItem(saved));
        setPendingGlbData(undefined);
        toast(`Đã lưu "${saved.name}"`, 'ok');
    };

    const handleDuplicate = () => {
        if (!draft) return;
        const glbSrc = pendingGlbData !== undefined ? pendingGlbData : getItemGlbSource(draft.key);
        const clone = saveCatalogItem({
            ...draft,
            key: '',
            name: `${draft.name} (Bản sao)`,
            isBuiltin: false,
            isCustom: true,
        }, glbSrc ? { glbData: glbSrc } : {});
        setSelectedKey(clone.key);
        setDraft(makeDraftFromItem(clone));
        setPendingGlbData(undefined);
        toast(`Đã nhân bản thành "${clone.name}"`, 'ok');
    };

    const handleDeleteOrResetItem = () => {
        if (!draft) return;
        if (getBuiltinItem(draft.key)) {
            if (!window.confirm(`Khôi phục "${draft.name}" về thông số 2D/3D gốc mặc định?`)) return;
            const restored = resetCatalogItem(draft.key);
            if (restored) {
                setDraft(makeDraftFromItem(restored));
                setPendingGlbData(undefined);
            }
            toast('Đã khôi phục mẫu về mặc định', 'ok');
        } else {
            if (!window.confirm(`Xoá vĩnh viễn mẫu tự tạo "${draft.name}"?`)) return;
            deleteCatalogItem(draft.key);
            const next = listAdminCatalogItems()[0];
            if (next) selectItem(next);
            toast('Đã xoá mẫu tự tạo', 'ok');
        }
    };

    const handleResetAll = () => {
        if (!window.confirm('Khôi phục TOÀN BỘ thư viện 2D & 3D về mặc định ban đầu? Mọi mẫu thêm mới và tuỳ chỉnh sẽ bị xoá.')) return;
        resetAllCatalog();
        const first = listAdminCatalogItems()[0];
        if (first) selectItem(first);
        toast('Đã khôi phục toàn bộ thư viện gốc', 'ok');
    };

    const handleExportJson = () => {
        const json = exportCatalogSnapshot({ includeGlb: true });
        downloadText(json, `MKG_ThuVien_2D_3D_${stamp()}.json`, 'application/json');
        toast('Đã xuất file JSON thư viện 2D & 3D', 'ok');
    };

    const handleImportJson = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const text = await file.text();
            await importCatalogSnapshot(text);
            const cur = listAdminCatalogItems().find(i => i.key === selectedKey) || listAdminCatalogItems()[0];
            if (cur) selectItem(cur);
            toast('Đã nhập thư viện JSON thành công', 'ok');
        } catch (err) {
            toast('File JSON không hợp lệ: ' + err.message, 'err');
        }
    };

    const handleUploadSvg = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const text = await file.text();
            patchDraft({ svg2d: text.trim() });
            toast(`Đã nạp ký hiệu SVG từ ${file.name}`, 'ok');
        } catch (err) {
            toast('Không đọc được file SVG: ' + err.message, 'err');
        }
    };

    const handleUploadGlb = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > 15 * 1024 * 1024) {
            toast('File 3D quá lớn (>15MB), vui lòng nén nhẹ trước khi tải lên', 'err');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            setPendingGlbData(dataUrl);
            patchDraft({ glbFileName: file.name, hasLocalGlb: true });
            toast(`Đã nạp mô hình 3D "${file.name}" (${Math.round(file.size / 1024)} KB) — nhấn Lưu thay đổi để áp dụng`, 'ok');
        };
        reader.onerror = () => toast('Không đọc được file .glb/.gltf', 'err');
        reader.readAsDataURL(file);
    };

    const handleSyncCloud = async () => {
        if (cloudBusy) return;
        if (!pb.isLoggedIn()) {
            toast('Vui lòng đăng nhập tài khoản trước khi đồng bộ Cloud', 'err');
            return;
        }
        setCloudBusy(true);
        try {
            const res = await pb.pushCloudCatalog(getCatalogSyncPayload());
            if (res.ok) {
                toast('Đã đẩy cấu hình thư viện 2D/3D lên Cloud', 'ok');
            } else {
                const remote = await pb.fetchCloudCatalog();
                if (remote) {
                    applyCatalogSyncPayload(remote, { force: true });
                    const cur = listAdminCatalogItems().find(i => i.key === selectedKey) || listAdminCatalogItems()[0];
                    if (cur) selectItem(cur);
                    toast('Đã tải cấu hình thư viện mới từ Cloud', 'ok');
                } else {
                    toast('Không đẩy được lên Cloud: ' + (res.reason || 'Cần quyền Admin hoặc collection furniture_catalog'), 'err');
                }
            }
        } catch (err) {
            toast('Lỗi đồng bộ Cloud: ' + err.message, 'err');
        } finally {
            setCloudBusy(false);
        }
    };

    return (
        <div className="cat-admin-page">
            <header className="cat-admin-header">
                <div className="cat-admin-title-row">
                    <button className="icon-btn" onClick={onBack} title="Quay lại ứng dụng">
                        <ArrowLeft size={19} />
                    </button>
                    <div>
                        <h1>Backend Quản Trị Thư Viện 2D &amp; 3D</h1>
                        <div className="cat-admin-sub">
                            {items.length} mẫu nội thất · {modifiedCount} mẫu đang tuỳ chỉnh (Áp dụng tức thì cho 2D, 3D &amp; Layout)
                        </div>
                    </div>
                </div>

                <div className="cat-admin-toolbar">
                    <button className="cat-btn primary" onClick={handleCreateNew}>
                        <Plus size={15} /> Thêm món mới
                    </button>
                    <button className="cat-btn" onClick={() => jsonInputRef.current?.click()}>
                        <Upload size={15} /> Nhập JSON
                    </button>
                    <button className="cat-btn" onClick={handleExportJson}>
                        <Download size={15} /> Xuất JSON
                    </button>
                    <button className="cat-btn" disabled={cloudBusy} onClick={handleSyncCloud}>
                        <CloudUpload size={15} /> {cloudBusy ? 'Đang đồng bộ…' : 'Đồng bộ Cloud'}
                    </button>
                    <button className="cat-btn danger" onClick={handleResetAll}>
                        <RotateCcw size={15} /> Khôi phục gốc
                    </button>
                    <input ref={jsonInputRef} type="file" accept=".json,application/json" hidden onChange={handleImportJson} />
                </div>
            </header>

            <div className="cat-admin-body">
                {/* Cột 1: Danh sách món nội thất */}
                <aside className="cat-sidebar">
                    <div className="cat-search-box">
                        <Search size={15} />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Tìm tên hoặc mã nội thất…"
                        />
                    </div>
                    <div className="cat-group-chips">
                        <button className={`chip ${groupFilter === 'all' ? 'on' : ''}`} onClick={() => setGroupFilter('all')}>
                            Tất cả ({items.length})
                        </button>
                        <button className={`chip ${groupFilter === 'modified' ? 'on' : ''}`} onClick={() => setGroupFilter('modified')}>
                            Đã sửa ({modifiedCount})
                        </button>
                        {GROUPS.map(g => (
                            <button
                                key={g.key}
                                className={`chip ${groupFilter === g.key ? 'on' : ''}`}
                                onClick={() => setGroupFilter(g.key)}
                            >
                                {g.name}
                            </button>
                        ))}
                    </div>

                    <div className="cat-list">
                        {filteredItems.map((it) => {
                            const active = it.key === selectedKey;
                            const hasGlb = !!(it.glbUrl || it.hasLocalGlb || getItemGlbSource(it.key));
                            return (
                                <button
                                    key={it.key}
                                    className={`cat-list-item ${active ? 'on' : ''} ${it.hidden ? 'muted' : ''}`}
                                    onClick={() => selectItem(it)}
                                >
                                    <div className="cat-item-top">
                                        <span className="cat-item-name">{it.name}</span>
                                        <div className="cat-item-badges">
                                            {it.isCustom && <span className="cat-badge custom">Mới</span>}
                                            {!it.isCustom && it.isModified && <span className="cat-badge mod">Đã sửa</span>}
                                            {it.svg2d && <span className="cat-badge svg">SVG</span>}
                                            {hasGlb && <span className="cat-badge glb">GLB</span>}
                                            {it.hidden && <span className="cat-badge off">Ẩn</span>}
                                        </div>
                                    </div>
                                    <div className="cat-item-meta">
                                        <span>{groupName(it.group)}</span>
                                        <span>{it.w}×{it.d}×{it.h} mm</span>
                                    </div>
                                </button>
                            );
                        })}
                        {!filteredItems.length && (
                            <div className="cat-empty">Không tìm thấy món phù hợp</div>
                        )}
                    </div>
                </aside>

                {/* Cột 2: Live Preview 2D + 3D */}
                <section className="cat-preview-col">
                    {draft && (
                        <>
                            <div className="cat-preview-card">
                                <div className="cat-preview-head">
                                    <span>Ký hiệu 2D CAD &amp; Kích thước</span>
                                    <span className="cat-preview-meta">{draft.w} × {draft.d} mm</span>
                                </div>
                                <div className="cat-preview-stage">
                                    <Preview2DCanvas draft={draft} svgValid={svgValid} />
                                </div>
                            </div>

                            <div className="cat-preview-card">
                                <div className="cat-preview-head">
                                    <span>Mô hình 3D tương tác (Kéo xoay 360°)</span>
                                    <button
                                        type="button"
                                        className="cat-mini-btn"
                                        onClick={() => setShowWall3D(v => !v)}
                                    >
                                        {showWall3D ? <Eye size={13} /> : <EyeOff size={13} />}
                                        {showWall3D ? ' Đang hiện tường mẫu' : ' Đang ẩn tường mẫu'}
                                    </button>
                                </div>
                                <div className="cat-preview-stage">
                                    <Preview3DCanvas draft={draft} glbDataOverride={pendingGlbData} showWall={showWall3D} />
                                </div>
                            </div>
                        </>
                    )}
                </section>

                {/* Cột 3: Bảng chỉnh sửa 3 tab */}
                <section className="cat-inspector-col">
                    {draft && (
                        <>
                            <div className="cat-inspector-tabs">
                                <button className={`cat-tab ${tab === 'info' ? 'on' : ''}`} onClick={() => setTab('info')}>
                                    <Sliders size={14} /> Thông số
                                </button>
                                <button className={`cat-tab ${tab === '2d' ? 'on' : ''}`} onClick={() => setTab('2d')}>
                                    <Shapes size={14} /> Thư viện 2D
                                </button>
                                <button className={`cat-tab ${tab === '3d' ? 'on' : ''}`} onClick={() => setTab('3d')}>
                                    <Box size={14} /> Thư viện 3D
                                </button>
                            </div>

                            <div className="cat-inspector-body">
                                {tab === 'info' && (
                                    <div className="cat-form">
                                        <div className="cat-field">
                                            <label>Tên món nội thất</label>
                                            <input
                                                className="cat-input"
                                                value={draft.name}
                                                onChange={(e) => patchDraft({ name: e.target.value })}
                                            />
                                        </div>

                                        <div className="cat-field">
                                            <label>Nhóm phòng / Danh mục</label>
                                            <select
                                                className="cat-select"
                                                value={draft.group}
                                                onChange={(e) => patchDraft({ group: e.target.value })}
                                            >
                                                {GROUPS.map(g => (
                                                    <option key={g.key} value={g.key}>{g.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="cat-grid-2">
                                            <div className="cat-field">
                                                <label>Rộng mặc định W (mm)</label>
                                                <input
                                                    type="number"
                                                    className="cat-input"
                                                    min={20}
                                                    value={draft.w}
                                                    onChange={(e) => patchDraft({ w: Number(e.target.value) || 0 })}
                                                />
                                            </div>
                                            <div className="cat-field">
                                                <label>Sâu mặc định D (mm)</label>
                                                <input
                                                    type="number"
                                                    className="cat-input"
                                                    min={20}
                                                    value={draft.d}
                                                    onChange={(e) => patchDraft({ d: Number(e.target.value) || 0 })}
                                                />
                                            </div>
                                            <div className="cat-field">
                                                <label>Cao mặc định H (mm)</label>
                                                <input
                                                    type="number"
                                                    className="cat-input"
                                                    min={10}
                                                    value={draft.h}
                                                    onChange={(e) => patchDraft({ h: Number(e.target.value) || 0 })}
                                                />
                                            </div>
                                            <div className="cat-field">
                                                <label>Cao độ đáy Z (mm)</label>
                                                <input
                                                    type="number"
                                                    className="cat-input"
                                                    min={0}
                                                    value={draft.z}
                                                    onChange={(e) => patchDraft({ z: Number(e.target.value) || 0 })}
                                                />
                                            </div>
                                        </div>

                                        <div className="cat-field">
                                            <label>Kiểu lắp đặt trên không gian</label>
                                            <select
                                                className="cat-select"
                                                value={draft.mount}
                                                onChange={(e) => patchDraft({ mount: e.target.value })}
                                            >
                                                <option value="floor">Đặt sàn (Floor)</option>
                                                <option value="wall">Treo tường (Wall mounted)</option>
                                                <option value="ceiling">Âm / Treo trần (Ceiling)</option>
                                            </select>
                                        </div>

                                        <label className="cat-check">
                                            <input
                                                type="checkbox"
                                                checked={draft.back}
                                                onChange={(e) => patchDraft({ back: e.target.checked })}
                                            />
                                            <span>Có mặt lưng áp sát tường (Hít nam châm tường)</span>
                                        </label>

                                        <label className="cat-check">
                                            <input
                                                type="checkbox"
                                                checked={draft.noSnapContact}
                                                onChange={(e) => patchDraft({ noSnapContact: e.target.checked })}
                                            />
                                            <span>Không đẩy hít vào cạnh đồ khác (Thảm, bàn giữa)</span>
                                        </label>

                                        <label className="cat-check">
                                            <input
                                                type="checkbox"
                                                checked={draft.hidden}
                                                onChange={(e) => patchDraft({ hidden: e.target.checked })}
                                            />
                                            <span>Ẩn khỏi danh sách thêm nội thất</span>
                                        </label>
                                    </div>
                                )}

                                {tab === '2d' && (
                                    <div className="cat-form">
                                        <div className="cat-field">
                                            <label>Ký hiệu CAD 2D chuẩn</label>
                                            <select
                                                className="cat-select"
                                                value={draft.sym}
                                                onChange={(e) => patchDraft({ sym: e.target.value })}
                                            >
                                                {SYM_2D_OPTIONS.map(o => (
                                                    <option key={o.key} value={o.key}>{o.label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="cat-grid-2">
                                            <div className="cat-field">
                                                <label>Màu nét 2D</label>
                                                <div className="cat-color-row">
                                                    <input
                                                        type="color"
                                                        value={draft.color2d || '#475569'}
                                                        onChange={(e) => patchDraft({ color2d: e.target.value })}
                                                    />
                                                    <button type="button" className="cat-mini-btn" onClick={() => patchDraft({ color2d: '' })}>
                                                        Mặc định
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="cat-field">
                                                <label>Màu nền 2D</label>
                                                <div className="cat-color-row">
                                                    <input
                                                        type="color"
                                                        value={draft.fill2d && draft.fill2d.startsWith('#') ? draft.fill2d : '#f1f5f9'}
                                                        onChange={(e) => patchDraft({ fill2d: e.target.value })}
                                                    />
                                                    <button type="button" className="cat-mini-btn" onClick={() => patchDraft({ fill2d: '' })}>
                                                        Mặc định
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="cat-field">
                                            <div className="cat-label-row">
                                                <label>Ký hiệu Vector SVG tuỳ biến (Ưu tiên hơn CAD chuẩn)</label>
                                                <div className="cat-label-actions">
                                                    <button type="button" className="cat-mini-btn" onClick={() => svgInputRef.current?.click()}>
                                                        <Upload size={12} /> Tải file .svg
                                                    </button>
                                                    {draft.svg2d && (
                                                        <button type="button" className="cat-mini-btn" onClick={() => patchDraft({ svg2d: '' })}>
                                                            Xoá SVG
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <input ref={svgInputRef} type="file" accept=".svg,image/svg+xml" hidden onChange={handleUploadSvg} />
                                            <textarea
                                                className="cat-textarea mono"
                                                rows={7}
                                                value={draft.svg2d}
                                                onChange={(e) => patchDraft({ svg2d: e.target.value })}
                                                placeholder='<svg viewBox="0 0 100 60"><rect x="2" y="2" width="96" height="56" fill="none" stroke="currentColor"/></svg>'
                                            />
                                            {!svgValid && (
                                                <div className="cat-warn-text">Mã SVG chưa có thẻ hình học hợp lệ (&lt;svg&gt;, &lt;path&gt;, &lt;rect&gt;…)</div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {tab === '3d' && (
                                    <div className="cat-form">
                                        <div className="cat-field">
                                            <label>Kiểu mô hình 3D tham số</label>
                                            <select
                                                className="cat-select"
                                                value={draft.sym3d}
                                                onChange={(e) => patchDraft({ sym3d: e.target.value })}
                                            >
                                                {SYM_3D_OPTIONS.map(o => (
                                                    <option key={o.key || '_auto'} value={o.key}>{o.label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <MaterialPicker
                                            label="Chất liệu chính (Thân / Bọc chính)"
                                            value={draft.matPrimary}
                                            onChange={(v) => patchDraft({ matPrimary: v })}
                                        />
                                        <MaterialPicker
                                            label="Chất liệu phụ (Cánh / Chăn / Mặt đệm)"
                                            value={draft.matSecondary}
                                            onChange={(v) => patchDraft({ matSecondary: v })}
                                        />
                                        <MaterialPicker
                                            label="Chất liệu nhấn (Tay nắm / Inox / Gối / Kính)"
                                            value={draft.matAccent}
                                            onChange={(v) => patchDraft({ matAccent: v })}
                                        />

                                        <div className="cat-glb-box">
                                            <div className="cat-label-row">
                                                <label>Mô hình 3D nâng cao (.GLB / .GLTF)</label>
                                                <div className="cat-label-actions">
                                                    <button type="button" className="cat-mini-btn" onClick={() => glbInputRef.current?.click()}>
                                                        <Upload size={12} /> Tải file .glb
                                                    </button>
                                                    {(draft.hasLocalGlb || draft.glbUrl || pendingGlbData) && (
                                                        <button
                                                            type="button"
                                                            className="cat-mini-btn"
                                                            onClick={() => {
                                                                setPendingGlbData('');
                                                                patchDraft({ glbUrl: '', glbFileName: '', hasLocalGlb: false });
                                                            }}
                                                        >
                                                            Gỡ file 3D
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <input ref={glbInputRef} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden onChange={handleUploadGlb} />
                                            {(draft.glbFileName || (draft.hasLocalGlb && pendingGlbData !== '')) && (
                                                <div className="cat-glb-status">
                                                    Đang dùng file 3D cục bộ: <b>{draft.glbFileName || 'model.glb'}</b> (tự căn vừa {draft.w}×{draft.d}×{draft.h}mm)
                                                </div>
                                            )}
                                            <input
                                                className="cat-input"
                                                value={draft.glbUrl}
                                                onChange={(e) => patchDraft({ glbUrl: e.target.value })}
                                                placeholder="Hoặc dán URL file .glb / .gltf công khai…"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="cat-inspector-foot">
                                <button className="cat-btn primary" onClick={handleSave}>
                                    <Save size={15} /> Lưu thay đổi
                                </button>
                                <button className="cat-btn" onClick={handleDuplicate}>
                                    <Copy size={15} /> Nhân bản
                                </button>
                                <button className="cat-btn danger" onClick={handleDeleteOrResetItem}>
                                    {selectedOrig?.isBuiltin ? <RotateCcw size={15} /> : <Trash2 size={15} />}
                                    {selectedOrig?.isBuiltin ? ' Mặc định' : ' Xoá món'}
                                </button>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
}
