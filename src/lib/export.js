// Stage export + file download / Web Share.

/**
 * Render the Konva stage to a data URL at survey-report resolution.
 * crop = world-coords box; target long edge ~3000px (capped 4096 to avoid mobile OOM).
 */
export function stageToDataURL(stage, { crop, format = 'png', quality = 0.92, targetPx = 3000 }) {
    const oldScale = stage.scaleX();
    const oldPos = stage.position();
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    const maxDim = Math.max(crop.width, crop.height);
    const pixelRatio = Math.min(targetPx / maxDim, 4096 / maxDim, 4);
    const uri = stage.toDataURL({
        pixelRatio,
        mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png',
        quality,
        x: crop.x, y: crop.y, width: crop.width, height: crop.height,
    });
    stage.scale({ x: oldScale, y: oldScale });
    stage.position(oldPos);
    return uri;
}

export function downloadDataURL(uri, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = uri;
    link.click();
}

export function downloadText(str, filename, mime = 'application/octet-stream') {
    const blob = new Blob([str], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = filename;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Share an image via Web Share API (mobile); falls back to download. Returns 'shared'|'downloaded'. */
export async function shareDataURL(uri, filename) {
    try {
        const blob = await (await fetch(uri)).blob();
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: filename });
            return 'shared';
        }
    } catch (err) {
        if (err?.name === 'AbortError') return 'shared'; // user closed the share sheet
    }
    downloadDataURL(uri, filename);
    return 'downloaded';
}

export function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
