export function hasLocation(doc) {
    return Number.isFinite(doc?.location?.lat) && Number.isFinite(doc?.location?.lng);
}

export function formatLocation(location) {
    if (!hasLocation({ location })) return 'Chưa có vị trí';
    const acc = Number(location.accuracy || 0);
    const accuracy = acc ? ` ±${Math.round(acc)}m` : '';
    return `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}${accuracy}`;
}

export function mapsUrl(location) {
    if (!hasLocation({ location })) return null;
    return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
}

export function openLocationMap(location) {
    const url = mapsUrl(location);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

export async function getCurrentLocation(timeoutMs = 7000) {
    if (!navigator.geolocation) return null;
    try {
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: timeoutMs,
                maximumAge: 60_000,
            });
        });
        return {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            capturedAt: Date.now(),
        };
    } catch {
        return null;
    }
}
