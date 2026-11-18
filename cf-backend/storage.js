// Quan ly luu tru lon tren Cloudflare R2 (anh khao sat + offload JSON lon hon 180KB tranh gioi han 2MB cua D1).

export const INLINE_JSON_LIMIT = 180_000;

export function r2PhotoKey(recordId, filename = 'photo.jpg') {
    const clean = String(filename || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    return `photos/${recordId}/${clean}`;
}

export function r2BlobKey(folder, id) {
    return `json-blobs/${folder}/${id}.json`;
}

export async function putMediaObject(env, key, body, contentType = 'application/octet-stream') {
    if (!env.MEDIA) {
        throw new Error('Chua gan R2 bucket (binding MEDIA). Hay bat Cloudflare R2 tren Dashboard.');
    }
    await env.MEDIA.put(key, body, {
        httpMetadata: { contentType },
    });
    return key;
}

export async function getMediaObject(env, key) {
    if (!env.MEDIA || !key) return null;
    return env.MEDIA.get(key);
}

export async function deleteMediaObject(env, key) {
    if (!env.MEDIA || !key) return;
    try {
        await env.MEDIA.delete(key);
    } catch (err) {
        console.warn('deleteMediaObject:', key, err?.message);
    }
}

export async function storeJsonWithOffload(env, folder, id, value, oldR2Key = '') {
    if (value === undefined || value === null) {
        if (oldR2Key) await deleteMediaObject(env, oldR2Key);
        return { jsonText: null, r2Key: '' };
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= INLINE_JSON_LIMIT) {
        if (oldR2Key) await deleteMediaObject(env, oldR2Key);
        return { jsonText: text, r2Key: '' };
    }
    if (!env.MEDIA) {
        // Neu chua gan R2 nhung duoi nguong an toan 1.5MB cua D1 thi van cho ghi tam vao D1.
        if (text.length < 1_500_000) {
            return { jsonText: text, r2Key: '' };
        }
        throw new Error('Du lieu lon hon 1.5MB va R2 (binding MEDIA) chua duoc bat.');
    }
    const key = r2BlobKey(folder, id);
    await env.MEDIA.put(key, text, {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    if (oldR2Key && oldR2Key !== key) {
        await deleteMediaObject(env, oldR2Key);
    }
    return { jsonText: null, r2Key: key };
}

export async function loadJsonWithOffload(env, jsonText, r2Key) {
    if (r2Key && env.MEDIA) {
        const obj = await env.MEDIA.get(r2Key);
        if (obj) {
            const raw = await obj.text();
            try { return JSON.parse(raw); } catch { return raw; }
        }
    }
    if (!jsonText) return null;
    if (typeof jsonText === 'string') {
        try { return JSON.parse(jsonText); } catch { return jsonText; }
    }
    return jsonText;
}
