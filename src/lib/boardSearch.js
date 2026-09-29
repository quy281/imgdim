export function parseSizeQuery(q) {
    const m = String(q || '').match(/(\d{2,5})\s*[xX×*]\s*(\d{2,5})/);
    if (!m) return null;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!(w > 0 && h > 0)) return null;
    return { w, h, area: w * h, text: `${w}×${h}` };
}

export function canCutRect(bounds, req) {
    if (!req) return true;
    const bw = Math.max(Number(bounds?.width) || 0, 0);
    const bh = Math.max(Number(bounds?.height) || 0, 0);
    return (bw >= req.w && bh >= req.h) || (bw >= req.h && bh >= req.w);
}

export function fitWaste(area, req) {
    if (!req) return 0;
    return Math.max(0, Number(area || 0) - req.area);
}

export function textMatchesBoard(item, q, projectName = '') {
    const hay = `${item.title || ''} ${item.code || ''} ${item.board?.material || ''} ${item.board?.color || ''} ${item.board?.location || ''} ${item.location || ''} ${projectName}`.toLowerCase();
    return !q.trim() || hay.includes(q.trim().toLowerCase());
}
