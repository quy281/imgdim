import React, { useMemo, useState } from 'react';
import { ArrowLeft, FileDown, Grid2X2, List, PackageOpen, Plus, Search, Store } from 'lucide-react';
import { boardArea, boardBounds, makeBoardThumb } from '../lib/boardModel';
import { boardFileName, generateBoardDxf } from '../lib/boardDxf';
import { downloadText } from '../lib/export';
import { toast } from '../ui/Toast';
import { canCutRect, fitWaste, parseSizeQuery, textMatchesBoard } from '../lib/boardSearch';

const fmtArea = (v) => `${(Number(v || 0) / 1e6).toFixed(2)}m²`;
const fmtPrice = (v) => Number(v || 0).toLocaleString('vi-VN') + 'đ';

function boardOf(doc, projectName) {
    const board = doc.board || {};
    const market = board.market || {};
    const bounds = market.bounds || boardBounds(board);
    return {
        doc,
        board,
        market,
        location: String(board.location || 'Chưa gán').trim() || 'Chưa gán',
        title: board.code || doc.name,
        thumb: market.photoThumb || board.photoThumb || market.thumb || doc.thumb || makeBoardThumb(board),
        thumbKind: market.photoThumb || board.photoThumb ? 'photo' : 'drawing',
        area: market.area || boardArea(board),
        bounds,
        projectName,
    };
}

export default function BoardInventoryScreen({ docs, projects, onBack, onCreateBoard, onOpenBoard, onOpenMarket }) {
    const [loc, setLoc] = useState('all');
    const [q, setQ] = useState('');
    const [viewMode, setViewMode] = useState('list');
    const boards = useMemo(() => docs
        .filter(d => d.type === 'board')
        .map(d => boardOf(d, projects.find(p => p.id === d.projectId)?.name || 'Kho ván'))
        .sort((a, b) => a.location.localeCompare(b.location, 'vi') || (b.doc.updatedAt || 0) - (a.doc.updatedAt || 0)),
    [docs, projects]);

    const locations = useMemo(() => {
        const set = new Set(boards.map(b => b.location));
        return ['all', ...[...set].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }))];
    }, [boards]);
    const sizeQuery = parseSizeQuery(q);
    const textQuery = sizeQuery ? q.replace(/(\d{2,5})\s*[xX×*]\s*(\d{2,5})/, '').trim() : q;
    const shown = boards
        .filter(item => (loc === 'all' || item.location === loc)
            && textMatchesBoard(item, textQuery, item.projectName)
            && canCutRect(item.bounds, sizeQuery))
        .sort((a, b) => sizeQuery
            ? fitWaste(a.area, sizeQuery) - fitWaste(b.area, sizeQuery)
            : a.location.localeCompare(b.location, 'vi') || (b.doc.updatedAt || 0) - (a.doc.updatedAt || 0));
    const groups = useMemo(() => {
        const map = new Map();
        for (const item of shown) {
            const arr = map.get(item.location) || [];
            arr.push(item);
            map.set(item.location, arr);
        }
        return [...map.entries()];
    }, [shown]);

    const exportDxf = (e, item) => {
        e.stopPropagation();
        downloadText(generateBoardDxf(item.doc), boardFileName(item.board), 'application/dxf');
        toast('Đã xuất DXF ván tồn', 'ok');
    };

    return (
        <div className="screen">
            <div className="hdr">
                <button className="icon-btn" onClick={onBack}><ArrowLeft size={22} /></button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hdr-title">Quản lý ván</div>
                    <div className="hdr-sub">Theo kho A1, A2... và biên ván đã đo</div>
                </div>
                <button className="icon-btn" onClick={onOpenMarket} title="Sàn trao đổi ván dư"><Store size={20} /></button>
            </div>

            <div className="scroll-body">
                <div className="module-tabs compact">
                    <button className="module-tab on">Quản lý ván</button>
                    <button className="module-tab" onClick={onOpenMarket}>Sàn trao đổi ván dư</button>
                </div>

                <button className="btn btn-primary btn-block" style={{ height: 48, marginBottom: 12 }} onClick={onCreateBoard}>
                    <Plus size={18} /> Tạo ván tồn
                </button>

                <div className="market-search">
                    <Search size={17} />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm mã, màu, kho A1 hoặc 300x400..." />
                </div>
                <div className="board-view-row">
                    {sizeQuery ? (
                        <span>Đang tìm tấm đủ cắt {sizeQuery.text}, xếp theo phần dư ít nhất.</span>
                    ) : <span>{shown.length} / {boards.length} tấm ván</span>}
                    <div className="segmented-mini">
                        <button className={viewMode === 'thumb' ? 'on' : ''} onClick={() => setViewMode('thumb')} title="Thumbnail">
                            <Grid2X2 size={15} />
                        </button>
                        <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')} title="List">
                            <List size={15} />
                        </button>
                    </div>
                </div>

                <div className="chip-row exp-chip-row">
                    {locations.map(x => (
                        <button key={x} className={`chip ${loc === x ? 'on' : ''}`} onClick={() => setLoc(x)}>
                            {x === 'all' ? 'Tất cả kho' : x}
                        </button>
                    ))}
                </div>

                {boards.length === 0 ? (
                    <div className="empty">
                        <PackageOpen size={52} />
                        <h3>Chưa có ván tồn</h3>
                        <p>Tạo ván tồn mới, đo biên khuyết rồi gán vị trí kho A1, A2...</p>
                    </div>
                ) : groups.map(([location, items]) => (
                    <section key={location} className="board-stock-group">
                        <div className="board-stock-head">
                            <b>Kho {location}</b>
                            <span>{items.length} tấm · {fmtArea(items.reduce((s, x) => s + x.area, 0))}</span>
                        </div>
                        <div className={`board-market-grid ${viewMode === 'thumb' ? 'thumb-mode' : 'list-mode'}`}>
                            {items.map(item => (
                                <div key={item.doc.id} className="board-market-card" onClick={() => onOpenBoard(item.doc)}>
                                    <div className={`board-market-thumb ${item.thumbKind}`}>
                                        {item.thumb ? <img src={item.thumb} alt={item.title} /> : <PackageOpen size={30} />}
                                        {item.market?.listed && <span className="board-market-status available">Trên sàn</span>}
                                    </div>
                                    <div className="board-market-body">
                                        <div className="board-market-title">{item.title}</div>
                                        <div className="board-market-meta">
                                            {item.board.material} {item.board.thickness}mm · {item.board.color || 'chưa màu'}
                                        </div>
                                        <div className="board-market-meta">
                                            {Math.round(item.bounds.width)}×{Math.round(item.bounds.height)} · {fmtArea(item.area)}
                                        </div>
                                        <div className="board-market-project">{item.projectName}</div>
                                        <div className="board-market-footer">
                                            <b>{item.market?.listed ? fmtPrice(item.market.price) : 'Chưa đăng sàn'}</b>
                                            <button className="section-action" onClick={(e) => exportDxf(e, item)}>
                                                <FileDown size={14} /> DXF
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
