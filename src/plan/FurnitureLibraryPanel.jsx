import React, { useMemo, useState } from 'react';
import {
    Search, Heart, Clock, Layers, Plus, RefreshCw, Lock, Unlock,
    LayoutGrid, List, Check, SlidersHorizontal, X, Boxes, Ruler,
} from 'lucide-react';
import Symbol2DSvg from './Symbol2DSvg';
import {
    CORE_GROUPS, FURNITURE, getCatalogVersion, isDesktopCatalogSupported, isFadiLibraryEnabled, setFadiLibraryEnabled,
} from '../lib/furnitureCatalog';
import { FLOOR_MATERIALS, resolveRoomFloorMat } from '../lib/floorMaterials';

const FAVS_KEY = 'mkg_furn_favs_v1';
const RECENT_KEY = 'mkg_furn_recent_v1';

function loadList(storageKey, max = 30) {
    try {
        const raw = localStorage.getItem(storageKey);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.slice(0, max) : [];
    } catch {
        return [];
    }
}

function saveList(storageKey, arr) {
    try {
        localStorage.setItem(storageKey, JSON.stringify(arr));
    } catch { /* ignore */ }
}

/**
 * Thư viện 2D/3D & Vật liệu kiến trúc theo layout 5D+ Library + CSS hệ Furnitech.
 * - Desktop: panel nổi neo trái trên canvas, cho phép tương tác trực tiếp với mặt bằng bên phải.
 * - Mobile: drawer/panel trượt gọn vừa màn hình dọc.
 */
export default function FurnitureLibraryPanel({
    open,
    onClose,
    doc,
    furnSource, // 'local' | 'online' (FADI)
    onChangeSource,
    furnGroup,
    onChangeGroup,
    furnRotLock,
    onToggleRotLock,
    furnInsertRot,
    onPickInsertRot,
    showFurnDims,
    onToggleShowFurnDims,
    planTheme,
    onChangePlanTheme,
    onApplyFloorMat,
    onAddFurniture,
    onPullFadi,
    fadiSyncBusy,
    onOpenCatalogAdmin,
}) {
    const [topTab, setTopTab] = useState('model'); // 'model' | 'material'
    const [smartFilter, setSmartFilter] = useState(null); // null | 'active' | 'favorites' | 'recent'
    const [fadiSubRoom, setFadiSubRoom] = useState('__all__');
    const [searchQuery, setSearchQuery] = useState('');
    const [viewStyle, setViewStyle] = useState('grid'); // 'grid' | 'list'
    const [favKeys, setFavKeys] = useState(() => loadList(FAVS_KEY, 80));
    const [recentKeys, setRecentKeys] = useState(() => loadList(RECENT_KEY, 16));
    const [selectedRoomId, setSelectedRoomId] = useState('__all__');

    const settings = doc?.settings || {};
    const rooms = doc?.plan?.rooms || [];
    const placedItems = doc?.furniture || [];
    const showAdminAction = isDesktopCatalogSupported() && typeof onOpenCatalogAdmin === 'function';
    const catVer = getCatalogVersion();

    // Toàn bộ item đang có theo từng key để tra cứu nhanh cho Active / Favorites / Recent
    const allItemsMap = useMemo(() => {
        const m = new Map();
        for (const g of CORE_GROUPS) {
            for (const it of (FURNITURE[g.key] || [])) {
                m.set(it.key, it);
            }
        }
        for (const it of (FURNITURE.fadi || [])) {
            m.set(it.key, it);
        }
        return m;
    }, [doc, furnSource, fadiSyncBusy, catVer]);

    const activeKindKeys = useMemo(() => {
        const seen = [];
        const set = new Set();
        for (const f of placedItems) {
            if (f?.kind && !set.has(f.kind) && allItemsMap.has(f.kind)) {
                set.add(f.kind);
                seen.push(f.kind);
            }
        }
        return seen;
    }, [placedItems, allItemsMap]);

    const favItemList = useMemo(
        () => favKeys.map(k => allItemsMap.get(k)).filter(Boolean),
        [favKeys, allItemsMap]
    );
    const recentItemList = useMemo(
        () => recentKeys.map(k => allItemsMap.get(k)).filter(Boolean),
        [recentKeys, allItemsMap]
    );

    // Các danh mục con của FADI (nếu có fadiRoom)
    const fadiCategories = useMemo(() => {
        const fadiList = FURNITURE.fadi || [];
        const counts = new Map();
        for (const it of fadiList) {
            const room = (it.fadiRoom || 'Chung').trim() || 'Chung';
            counts.set(room, (counts.get(room) || 0) + 1);
        }
        const cats = [{ key: '__all__', name: 'Tất cả FADI', count: fadiList.length }];
        for (const [k, count] of counts.entries()) {
            cats.push({ key: k, name: k, count });
        }
        return cats;
    }, [catVer, fadiSyncBusy]);

    const toggleFavorite = (e, key) => {
        e.stopPropagation();
        setFavKeys(prev => {
            const exists = prev.includes(key);
            const next = exists ? prev.filter(x => x !== key) : [key, ...prev].slice(0, 80);
            saveList(FAVS_KEY, next);
            return next;
        });
    };

    const handleInsert = (key) => {
        setRecentKeys(prev => {
            const next = [key, ...prev.filter(x => x !== key)].slice(0, 16);
            saveList(RECENT_KEY, next);
            return next;
        });
        onAddFurniture(key);
    };

    const handleSourceSwitch = (nextSource) => {
        if (nextSource === 'online' && !isFadiLibraryEnabled()) {
            setFadiLibraryEnabled(true);
        }
        setSmartFilter(null);
        onChangeSource(nextSource);
    };

    // Nguồn item đang hiển thị ở lưới bên phải
    const visibleItems = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        let list = [];
        if (q) {
            const pool = furnSource === 'online'
                ? (FURNITURE.fadi || [])
                : CORE_GROUPS.flatMap(g => FURNITURE[g.key] || []);
            list = pool.filter(it =>
                (it.name || '').toLowerCase().includes(q)
                || (it.key || '').toLowerCase().includes(q)
            );
        } else if (smartFilter === 'active') {
            list = activeKindKeys.map(k => allItemsMap.get(k)).filter(Boolean);
        } else if (smartFilter === 'favorites') {
            list = favItemList;
        } else if (smartFilter === 'recent') {
            list = recentItemList;
        } else if (furnSource === 'online') {
            const allFadi = FURNITURE.fadi || [];
            list = fadiSubRoom === '__all__'
                ? allFadi
                : allFadi.filter(it => ((it.fadiRoom || 'Chung').trim() || 'Chung') === fadiSubRoom);
        } else {
            const safeGroup = CORE_GROUPS.some(g => g.key === furnGroup) ? furnGroup : 'bedroom';
            list = FURNITURE[safeGroup] || [];
        }
        return list;
    }, [
        searchQuery, smartFilter, furnSource, furnGroup, fadiSubRoom,
        activeKindKeys, favItemList, recentItemList, allItemsMap,
        catVer, fadiSyncBusy,
    ]);

    const activeFloorKeyForSelection = useMemo(() => {
        if (!rooms.length) return null;
        if (selectedRoomId === '__all__') {
            const first = resolveRoomFloorMat(rooms[0]);
            return rooms.every(r => resolveRoomFloorMat(r) === first) ? first : null;
        }
        const rm = rooms.find(r => r.id === selectedRoomId);
        return rm ? resolveRoomFloorMat(rm) : null;
    }, [rooms, selectedRoomId]);

    if (!open) return null;

    return (
        <>
            <div className="flib-backdrop" onClick={onClose} />
            <aside className="flib-panel mkg-folder-card" role="dialog" aria-label="Thư viện 2D/3D và Vật liệu">
                {/* Compact window bar */}
                <div className="flib-hdr">
                    <div className="flib-title">
                        <Boxes size={15} className="flib-brand-ic" />
                        <span>MKG Library</span>
                        <span className="flib-ver">2D/3D</span>
                    </div>
                    <div className="flib-hdr-actions">
                        {showAdminAction && (
                            <button
                                type="button"
                                className="mkg-icon-btn"
                                title="Mở Quản trị Thư viện 2D/3D"
                                onClick={onOpenCatalogAdmin}
                            >
                                <Plus size={15} />
                            </button>
                        )}
                        <button
                            type="button"
                            className="mkg-icon-btn"
                            title="Thu gọn bảng thư viện"
                            onClick={onClose}
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Top Level Tabs: MẪU ĐỒ | VẬT LIỆU */}
                <div className="flib-top-tabs">
                    <button
                        type="button"
                        className={`flib-top-tab ${topTab === 'model' ? 'on' : ''}`}
                        onClick={() => setTopTab('model')}
                    >
                        MẪU ĐỒ
                    </button>
                    <button
                        type="button"
                        className={`flib-top-tab ${topTab === 'material' ? 'on' : ''}`}
                        onClick={() => setTopTab('material')}
                    >
                        VẬT LIỆU
                    </button>
                </div>

                {topTab === 'model' ? (
                    <>
                        {/* Sub-toolbar matching 5D+ Library row */}
                        <div className="flib-toolbar">
                            <div className="flib-toolbar-row1">
                                <div className="mkg-segmented flib-src-seg">
                                    <button
                                        type="button"
                                        className={`mkg-segmented-tab ${furnSource === 'local' ? 'active' : ''}`}
                                        onClick={() => handleSourceSwitch('local')}
                                    >
                                        Mặc định
                                    </button>
                                    <button
                                        type="button"
                                        className={`mkg-segmented-tab ${furnSource === 'online' ? 'active' : ''}`}
                                        onClick={() => handleSourceSwitch('online')}
                                    >
                                        FADI
                                    </button>
                                </div>

                                <div className="mkg-quick-bar flib-search-wrap">
                                    <Search size={13} className="flib-search-ic" />
                                    <input
                                        type="text"
                                        className="flib-search-input"
                                        placeholder="Tìm mẫu..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                    {searchQuery && (
                                        <button
                                            type="button"
                                            className="flib-clear-btn"
                                            onClick={() => setSearchQuery('')}
                                            aria-label="Xoá tìm kiếm"
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="flib-toolbar-row2">
                                <button
                                    type="button"
                                    className={`flib-lock-pill ${furnRotLock ? 'on' : ''}`}
                                    onClick={onToggleRotLock}
                                    title="Khoá góc xoay khi thả đồ mới — không bị magnet tự xoay theo tường"
                                >
                                    {furnRotLock ? <Lock size={12} /> : <Unlock size={12} />}
                                    <span>Khoá xoay</span>
                                    <span className={`flib-switch ${furnRotLock ? 'on' : ''}`}>
                                        <span className="flib-switch-knob" />
                                    </span>
                                </button>

                                <div className="flib-tool-icons">
                                    <button
                                        type="button"
                                        className="mkg-icon-btn"
                                        disabled={fadiSyncBusy}
                                        onClick={() => onPullFadi(false, furnSource)}
                                        title={furnSource === 'online' ? 'Tải lại Thư viện FADI từ Cloud' : 'Tải lại Thư viện Kho chung từ Cloud'}
                                    >
                                        <RefreshCw size={14} className={fadiSyncBusy ? 'spin' : ''} />
                                    </button>
                                    <button
                                        type="button"
                                        className={`mkg-icon-btn ${showFurnDims ? 'is-on' : ''}`}
                                        onClick={onToggleShowFurnDims}
                                        title={showFurnDims ? 'Đang hiện kích thước W×D trên đồ' : 'Đang ẩn kích thước trên đồ'}
                                    >
                                        <Ruler size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        className="mkg-icon-btn"
                                        onClick={() => setViewStyle(s => s === 'grid' ? 'list' : 'grid')}
                                        title={viewStyle === 'grid' ? 'Chuyển danh sách gọn' : 'Chuyển lưới 2 cột'}
                                    >
                                        {viewStyle === 'grid' ? <List size={14} /> : <LayoutGrid size={14} />}
                                    </button>
                                </div>
                            </div>

                            {furnRotLock && (
                                <div className="flib-rot-strip">
                                    <span>Góc đặt:</span>
                                    {[0, 90, 180, 270].map(deg => (
                                        <button
                                            key={deg}
                                            type="button"
                                            className={`flib-rot-btn ${furnInsertRot === deg ? 'on' : ''}`}
                                            onClick={() => onPickInsertRot(deg)}
                                        >
                                            {deg}°
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Two-column Split Body: Categories left + 2-Column 2D Preview Grid right */}
                        <div className="flib-body">
                            <nav className="flib-sidebar">
                                <button
                                    type="button"
                                    className={`flib-cat-row ${smartFilter === 'active' && !searchQuery ? 'on' : ''}`}
                                    onClick={() => { setSearchQuery(''); setSmartFilter('active'); }}
                                >
                                    <span className="flib-cat-label">
                                        <Layers size={13} /> Đang dùng
                                    </span>
                                    <span className="flib-cat-count">{activeKindKeys.length}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`flib-cat-row ${smartFilter === 'favorites' && !searchQuery ? 'on' : ''}`}
                                    onClick={() => { setSearchQuery(''); setSmartFilter('favorites'); }}
                                >
                                    <span className="flib-cat-label">
                                        <Heart size={13} /> Yêu thích
                                    </span>
                                    <span className="flib-cat-count">{favItemList.length}</span>
                                </button>
                                <button
                                    type="button"
                                    className={`flib-cat-row ${smartFilter === 'recent' && !searchQuery ? 'on' : ''}`}
                                    onClick={() => { setSearchQuery(''); setSmartFilter('recent'); }}
                                >
                                    <span className="flib-cat-label">
                                        <Clock size={13} /> Gần đây
                                    </span>
                                    <span className="flib-cat-count">{recentItemList.length}</span>
                                </button>

                                <div className="flib-cat-divider">
                                    <span />
                                    {showAdminAction && (
                                        <button
                                            type="button"
                                            className="flib-cat-add"
                                            onClick={onOpenCatalogAdmin}
                                            title="Thêm / Sửa mẫu mới"
                                        >
                                            <Plus size={12} />
                                        </button>
                                    )}
                                </div>

                                {furnSource === 'online' ? (
                                    fadiCategories.map(cat => {
                                        const on = !smartFilter && !searchQuery && fadiSubRoom === cat.key;
                                        return (
                                            <button
                                                key={cat.key}
                                                type="button"
                                                className={`flib-cat-row ${on ? 'on' : ''}`}
                                                onClick={() => {
                                                    setSearchQuery('');
                                                    setSmartFilter(null);
                                                    setFadiSubRoom(cat.key);
                                                }}
                                            >
                                                <span className="flib-cat-label">{cat.name}</span>
                                                <span className="flib-cat-count">{cat.count}</span>
                                            </button>
                                        );
                                    })
                                ) : (
                                    CORE_GROUPS.map(g => {
                                        const count = (FURNITURE[g.key] || []).length;
                                        const on = !smartFilter && !searchQuery && furnGroup === g.key;
                                        return (
                                            <button
                                                key={g.key}
                                                type="button"
                                                className={`flib-cat-row ${on ? 'on' : ''}`}
                                                onClick={() => {
                                                    setSearchQuery('');
                                                    setSmartFilter(null);
                                                    onChangeGroup(g.key);
                                                }}
                                            >
                                                <span className="flib-cat-label">{g.name}</span>
                                                <span className="flib-cat-count">{count}</span>
                                            </button>
                                        );
                                    })
                                )}
                            </nav>

                            <div className="flib-content">
                                {visibleItems.length > 0 ? (
                                    <div className={`flib-grid ${viewStyle === 'list' ? 'list' : ''}`}>
                                        {visibleItems.map(it => {
                                            const ov = settings.furnitureDefaults?.[it.key];
                                            const w = Math.round(ov?.w || it.w || 600);
                                            const d = Math.round(ov?.d || it.d || 600);
                                            const isFav = favKeys.includes(it.key);
                                            const isUsed = activeKindKeys.includes(it.key);

                                            return (
                                                <div
                                                    key={it.key}
                                                    role="button"
                                                    tabIndex={0}
                                                    className={`flib-card ${isUsed ? 'used' : ''}`}
                                                    onClick={() => handleInsert(it.key)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            handleInsert(it.key);
                                                        }
                                                    }}
                                                    title={`${it.name} (${w}×${d} mm) — Bấm để chèn vào mặt bằng`}
                                                >
                                                    <div className="flib-card-preview">
                                                        {isUsed && <span className="flib-used-dot" title="Đang có trong bản vẽ" />}
                                                        <button
                                                            type="button"
                                                            className={`flib-fav-btn ${isFav ? 'on' : ''}`}
                                                            onClick={(e) => toggleFavorite(e, it.key)}
                                                            aria-label="Yêu thích"
                                                        >
                                                            <Heart size={12} fill={isFav ? 'currentColor' : 'none'} />
                                                        </button>
                                                        <Symbol2DSvg cat={it} size={viewStyle === 'list' ? 42 : 66} />
                                                    </div>
                                                    <div className="flib-card-info">
                                                        <div className="flib-card-name">{it.name}</div>
                                                        <div className="flib-card-dim">{w}×{d}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flib-empty">
                                        {furnSource === 'online' && (FURNITURE.fadi || []).length === 0 ? (
                                            <>
                                                <div className="flib-empty-title">Thư viện FADI chưa có dữ liệu</div>
                                                <div className="flib-empty-sub">
                                                    Đồng bộ từ Cloud FADI hoặc dùng mục Mặc định.
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn flib-empty-btn"
                                                    disabled={fadiSyncBusy}
                                                    onClick={() => onPullFadi(false, 'online')}
                                                >
                                                    <RefreshCw size={13} className={fadiSyncBusy ? 'spin' : ''} />
                                                    {fadiSyncBusy ? 'Đang tải…' : 'Tải Cloud FADI'}
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <div className="flib-empty-title">Không có mẫu nào</div>
                                                <div className="flib-empty-sub">Thử chọn danh mục khác hoặc xoá từ khoá tìm.</div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    /* VẬT LIỆU & CHỦ ĐỀ TRÌNH BÀY 2D */
                    <div className="flib-mat-body">
                        <div className="flib-mat-sec">
                            <div className="flib-mat-label">
                                <SlidersHorizontal size={13} /> Chế độ hiển thị mặt bằng
                            </div>
                            <div className="mkg-segmented">
                                <button
                                    type="button"
                                    className={`mkg-segmented-tab ${planTheme !== 'cad' ? 'active' : ''}`}
                                    onClick={() => onChangePlanTheme('presentation')}
                                >
                                    Trình bày 2D
                                </button>
                                <button
                                    type="button"
                                    className={`mkg-segmented-tab ${planTheme === 'cad' ? 'active' : ''}`}
                                    onClick={() => onChangePlanTheme('cad')}
                                >
                                    Kỹ thuật CAD
                                </button>
                            </div>
                        </div>

                        <div className="flib-mat-sec">
                            <div className="flib-mat-label">
                                Chọn phòng áp dụng vật liệu ({rooms.length})
                            </div>
                            {rooms.length === 0 ? (
                                <div className="flib-mat-hint">
                                    Vẽ khép kín tường thành phòng để đổ vật liệu sàn (gỗ, gạch terrazzo, cỏ ban công...).
                                </div>
                            ) : (
                                <div className="flib-room-pills">
                                    <button
                                        type="button"
                                        className={`flib-room-pill ${selectedRoomId === '__all__' ? 'on' : ''}`}
                                        onClick={() => setSelectedRoomId('__all__')}
                                    >
                                        Tất cả phòng
                                    </button>
                                    {rooms.map(r => (
                                        <button
                                            key={r.id}
                                            type="button"
                                            className={`flib-room-pill ${selectedRoomId === r.id ? 'on' : ''}`}
                                            onClick={() => setSelectedRoomId(r.id)}
                                        >
                                            {r.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {rooms.length > 0 && (
                            <div className="flib-mat-sec">
                                <div className="flib-mat-label-row">
                                    <span>Vật liệu lát sàn</span>
                                    <button
                                        type="button"
                                        className="flib-reset-mat-btn"
                                        onClick={() => onApplyFloorMat(selectedRoomId, '')}
                                        title="Khôi phục tự động nhận diện gỗ/gạch/ban công theo tên phòng"
                                    >
                                        Tự động theo tên phòng
                                    </button>
                                </div>
                                <div className="flib-mat-grid">
                                    {FLOOR_MATERIALS.map(mat => {
                                        const isOn = activeFloorKeyForSelection === mat.key;
                                        return (
                                            <button
                                                key={mat.key}
                                                type="button"
                                                className={`flib-mat-card ${isOn ? 'on' : ''}`}
                                                onClick={() => {
                                                    if (planTheme === 'cad') onChangePlanTheme('presentation');
                                                    onApplyFloorMat(selectedRoomId, mat.key);
                                                }}
                                            >
                                                <div
                                                    className={`flib-swatch kind-${mat.kind}`}
                                                    style={{
                                                        backgroundColor: mat.base,
                                                        borderColor: mat.line,
                                                        '--sw-alt': mat.alt,
                                                        '--sw-line': mat.line,
                                                    }}
                                                >
                                                    {isOn && (
                                                        <span className="flib-swatch-chk">
                                                            <Check size={11} strokeWidth={3} />
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flib-mat-name">{mat.name}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </aside>
        </>
    );
}
