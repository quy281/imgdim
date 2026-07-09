import { registerPlugin } from '@capacitor/core';

// Register native ARRoomScan plugin (Android only).
// Web fallback always rejects — AR requires native hardware.
const ARRoomScanPlugin = registerPlugin('ARRoomScan', {
    web: {
        checkAvailability: async () => ({ available: false, status: 'WEB_NOT_SUPPORTED' }),
        startScan: async () => { throw new Error('AR not available on web'); },
    },
});

export async function checkARAvailability() {
    return ARRoomScanPlugin.checkAvailability();
}

export async function startARScan() {
    return ARRoomScanPlugin.startScan();
}

// Convert AR corners (meters) to plan nodes/walls (mm), with light ortho snap.
// corners: [{x, y}] in meters (ARCore XZ → plan XY)
// Returns: { nodes, walls } ready for a plan doc
export function buildPlanFromARCorners(corners_m, defaultThickness = 110) {
    const snapped = snapOrtho(corners_m);
    const ts = Date.now();

    const nodes = snapped.map((c, i) => ({
        id: `n_ar_${ts}_${i}`,
        x: Math.round(c.x * 1000), // m → mm
        y: Math.round(c.y * 1000),
    }));

    const walls = nodes.map((node, i) => ({
        id: `w_ar_${ts}_${i}`,
        a: node.id,
        b: nodes[(i + 1) % nodes.length].id,
        thickness: defaultThickness,
    }));

    return { nodes, walls, rooms: [] };
}

// Snap near-axis-aligned corners to exactly horizontal/vertical.
// For each wall: if the angle from H or V axis < threshDeg, snap the endpoint.
function snapOrtho(corners_m, threshDeg = 5) {
    const threshRad = threshDeg * Math.PI / 180;
    const n = corners_m.length;
    const pts = corners_m.map(c => ({ x: c.x, y: c.y }));

    for (let i = 0; i < n; i++) {
        const prev = pts[(i - 1 + n) % n];
        const curr = pts[i];
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
        const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
        if (angle < threshRad) {
            // Nearly horizontal → align Y
            curr.y = prev.y;
        } else if (Math.PI / 2 - angle < threshRad) {
            // Nearly vertical → align X
            curr.x = prev.x;
        }
    }

    return pts;
}
