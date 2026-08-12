// Photo import (resize + compress + thumbnail) and plan thumbnails.
import { hashString } from './hash';

const MAX_EDGE = 1600;   // survey photos: plenty for reference, light for sync
const THUMB_EDGE = 360;

async function decodeFile(file) {
    // createImageBitmap honors EXIF orientation in modern browsers
    if (typeof createImageBitmap === 'function') {
        try {
            return await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch { /* fall through */ }
    }
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = reject;
        img.src = url;
    });
}

function drawScaled(src, maxEdge, quality) {
    const sw = src.width, sh = src.height;
    const s = Math.min(1, maxEdge / Math.max(sw, sh));
    const w = Math.round(sw * s);
    const h = Math.round(sh * s);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src, 0, 0, w, h);
    return { dataURL: canvas.toDataURL('image/jpeg', quality), w, h };
}

/** file -> { base64, hash, w, h, thumb } */
export async function fileToPhoto(file) {
    const bmp = await decodeFile(file);
    const main = drawScaled(bmp, MAX_EDGE, 0.85);
    const thumb = drawScaled(bmp, THUMB_EDGE, 0.7);
    if (bmp.close) bmp.close();
    return {
        base64: main.dataURL, hash: hashString(main.dataURL),
        w: main.w, h: main.h, thumb: thumb.dataURL,
    };
}

/** Render a small white-background preview of the wall graph. */
export function makePlanThumb(plan) {
    const size = THUMB_EDGE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const nodes = plan?.nodes || [];
    const walls = plan?.walls || [];
    if (nodes.length && walls.length) {
        const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
        const pad = 30;
        const s = Math.min((size - pad * 2) / w, (size - pad * 2) / h);
        const ox = (size - w * s) / 2 - minX * s;
        const oy = (size - h * s) / 2 - minY * s;
        const nodeById = new Map(nodes.map(n => [n.id, n]));

        ctx.strokeStyle = '#334155';
        ctx.lineCap = 'round';
        for (const wall of walls) {
            const a = nodeById.get(wall.a);
            const b = nodeById.get(wall.b);
            if (!a || !b) continue;
            ctx.lineWidth = Math.max(2, (wall.thickness || 110) * s);
            ctx.beginPath();
            ctx.moveTo(a.x * s + ox, a.y * s + oy);
            ctx.lineTo(b.x * s + ox, b.y * s + oy);
            ctx.stroke();
        }
    } else {
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '600 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Chưa vẽ', size / 2, size / 2);
    }
    return canvas.toDataURL('image/jpeg', 0.8);
}
