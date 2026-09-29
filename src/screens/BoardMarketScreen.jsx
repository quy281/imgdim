import React, { useMemo, useState } from 'react';
import { ArrowLeft, Box, FileDown, Grid2X2, List, PackageOpen, Search, Store } from 'lucide-react';
import { boardArea, boardBounds, makeBoardThumb } from '../lib/boardModel';
import { boardFileName, generateBoardDxf } from '../lib/boardDxf';
import { downloadText } from '../lib/export';
import { toast } from '../ui/Toast';
import { canCutRect, fitWaste, parseSizeQuery, textMatchesBoard } from '../lib/boardSearch';

const fmtPrice = (v) => `${Number(v || 0).toLocaleString('vi-VN')}đ`;
const fmtArea = (v) => `${(Number(v || 0) / 1e6).toFixed(2)}m²`;

const statusLabel = {
    available: 'Đang trao đổi',
    reserved: 'Giữ chỗ',
    sold: 'Đã trao đổi',
};

function boardOf(doc) {
    const board = doc.board || {};
    const market = board.market || {};
    const bounds = market.bounds || boardBounds(board);
    const area = market.area || boardArea(board);
    return {
        doc,
        board,
        market,
        bounds,
        area,
        status: market.status || 'available',
        title: market.title || board.code || doc.name,
        code: market.code || board.code || doc.name,
        thumb: market.photoThumb || board.photoThumb || market.thumb || doc.thumb || makeBoardThumb(board),
        thumbKind: market.photoThumb || board.photoThumb ? 'photo' : 'drawing',
    };
}

export default function BoardMarketScreen({ docs, projects, onBack, onOpenBoard, onOpenInventory }) {
    const [filter, setFilter] = useState('available');
    const [q, setQ] = useState('');
    const [viewMode, setViewMode] = useState('list');
    const boards = useMemo(() => docs
        .filter(d => d.type === 'board' && d.board?.market?.listed)
        .map(boardOf)
        .sort((a, b) => Number(b.market.listedAt || b.doc.updatedAt || 0) - Number(a.market.listedAt || a.doc.updatedAt || 0)),
    [docs]);

    const projectName = (id) => projects.find(p => p.id === id)?.name || 'Dự án';
    const sizeQuery = parseSizeQuery(q);
    const textQuery = sizeQuery ? q.replace(/(\d{2,5})\s*[xX×*]\s*(\d{2,5})/, '').trim() : q;
    const shown = boards
        .filter(item => (filter === 'all' || item.status === filter)
            && textMatchesBoard(item, textQuery, projectName(item.doc.projectId))
            && canCutRect(item.bounds, sizeQuery))
        .sort((a, b) => sizeQuery
            ? fitWaste(a.area, sizeQuery) - fitWaste(b.area, sizeQuery)
            : Number(b.market.listedAt || b.doc.updatedAt || 0) - Number(a.market.listedAt || a.doc.updatedAt || 0));
    const stats = boards.reduce((acc, item) => {
        acc.count += 1;
        acc.area += item.area || 0;
        acc.value += Number(item.market.price || 0);
        return acc;
    }, { count: 0, area: 0, value: 0 });

    const exportDxf = (e, item) => {
        e.stopPropagation();
        downloadText(generateBoardDxf(item.doc), boardFileName(item.board), 'application/dxf');
        toast('Đã xuất DXF ván bán', 'ok');
    };

    return (
        <div className="screen">
            <div className="hdr">
                <button className="icon-btn" onClick={onBack}><ArrowLeft size={22} /></button>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="hdr-title">Sàn trao đổi ván dư</div>
                    <div className="hdr-sub">Các tấm ván dư đã chuẩn hóa mã, giá và file vẽ</div>
                </div>
            </div>

            <div className="scroll-body">
                <div className="module-tabs compact">
                    <button className="module-tab" onClick={onOpenInventory}>Quản lý ván</button>
                    <button className="module-tab on">Sàn trao đổi ván dư</button>
                </div>

                <section className="market-hero">
                    <div className="market-hero-icon"><Store size={24} /></div>
                    <div className="market-stat">
                        <b>{stats.count}</b>
                        <span>tấm trao đổi</span>
                    </div>
                    <div className="market-stat">
                        <b>{fmtArea(stats.area)}</b>
                        <span>diện tích</span>
                    </div>
                    <div className="market-stat">
                        <b>{fmtPrice(stats.value)}</b>
                        <span>giá trị</span>
                    </div>
                </section>

                <div className="market-search">
                    <Search size={17} />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm mã, màu, kho A1 hoặc 300x400..." />
                </div>
                <div className="board-view-row">
                    {sizeQuery ? (
                        <span>Đang tìm tấm đủ cắt {sizeQuery.text}, xếp theo phần dư ít nhất.</span>
                    ) : <span>{shown.length} / {boards.length} tấm trên sàn</span>}
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
                    {[
                        ['available', 'Đang trao đổi'],
                        ['reserved', 'Giữ chỗ'],
                        ['sold', 'Đã trao đổi'],
                        ['all', 'Tất cả'],
                    ].map(([key, label]) => (
                        <button key={key} className={`chip ${filter === key ? 'on' : ''}`} onClick={() => setFilter(key)}>
                            {label}
                        </button>
                    ))}
                </div>

                {shown.length === 0 ? (
                    <div className="empty">
                        <PackageOpen size={52} />
                        <h3>Chưa có ván trên sàn</h3>
                        <p>Vào Quản lý ván, mở một tấm ván rồi bật đăng lên sàn trao đổi.</p>
                    </div>
                ) : (
                    <div className={`board-market-grid ${viewMode === 'thumb' ? 'thumb-mode' : 'list-mode'}`}>
                        {shown.map(item => (
                            <div key={item.doc.id} className="board-market-card" onClick={() => onOpenBoard(item.doc)}>
                                <div className={`board-market-thumb ${item.thumbKind}`}>
                                    {item.thumb
                                        ? <img src={item.thumb} alt={item.title} />
                                        : <Box size={34} />}
                                    <span className={`board-market-status ${item.status}`}>
                                        {statusLabel[item.status] || item.status}
                                    </span>
                                </div>
                                <div className="board-market-body">
                                    <div className="board-market-title">{item.title}</div>
                                    <div className="board-market-code">{item.code}</div>
                                    <div className="board-market-meta">
                                        {item.board.material} {item.board.thickness}mm · {item.board.color || 'chưa màu'}
                                    </div>
                                    <div className="board-market-meta">
                                        Kho {item.board.location || 'chưa gán'} · {Math.round(item.bounds.width)}×{Math.round(item.bounds.height)} · {fmtArea(item.area)}
                                    </div>
                                    <div className="board-market-project">{projectName(item.doc.projectId)}</div>
                                    <div className="board-market-footer">
                                        <b>{fmtPrice(item.market.price)}</b>
                                        <button className="section-action" onClick={(e) => exportDxf(e, item)}>
                                            <FileDown size={14} /> DXF
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
