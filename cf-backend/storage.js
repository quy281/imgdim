// Quan ly luu tru lon tren Cloudflare R2 (uu tien) + tu dong fallback D1 `media_blobs` (<1.4MB) khi R2 chua bat.

export const INLINE_JSON_LIMIT = 180_000;
const MAX_D1_BLOB_BYTES = 1_400_000;

function bytesToBase64(bytes) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function bodyToUint8Array(body) {
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (typeof body === 'string') return new TextEncoder().encode(body);
    return new Uint8Array(await new Response(body).arrayBuffer());
}

const stripD1Prefix = (k) => (k.startsWith('d1:') ? k.slice(3) : k);

export function r2PhotoKey(recordId, filename = 'photo.jpg') {
    const clean = String(filename || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
    return `photos/${recordId}/${clean}`;
}

export function r2BlobKey(folder, id) {
    return `json-blobs/${folder}/${id}.json`;
}

export async function putMediaObject(env, key, body, contentType = 'application/octet-stream') {
    const rawKey = stripD1Prefix(key);
    if (env.MEDIA) {
        await env.MEDIA.put(rawKey, body, { httpMetadata: { contentType } });
        if (env.DB) {
            await env.DB.prepare('DELETE FROM media_blobs WHERE key = ?').bind(rawKey).run().catch(() => {});
        }
        return rawKey;
    }
    if (!env.DB) {
        throw new Error('Thieu ca R2 (MEDIA) va D1 (DB).');
    }
    const bytes = await bodyToUint8Array(body);
    if (bytes.byteLength > MAX_D1_BLOB_BYTES) {
        throw new Error(`File (${Math.round(bytes.byteLength / 1024)}KB) vuot gioi han fallback D1 — can bat Cloudflare R2 tren Dashboard.`);
    }
    const b64 = bytesToBase64(bytes);
    await env.DB.prepare(
        `INSERT OR REPLACE INTO media_blobs (key, content_type, size, data_b64, updated_at)
         VALUES (?, ?, ?, ?, ?)`
    ).bind(rawKey, contentType, bytes.byteLength, b64, new Date().toISOString()).run();
    return `d1:${rawKey}`;
}

export async function getMediaObject(env, key) {
    if (!key) return null;
    const rawKey = stripD1Prefix(key);
    if (!key.startsWith('d1:') && env.MEDIA) {
        const obj = await env.MEDIA.get(rawKey);
        if (obj) return obj;
    }
    if (env.DB) {
        const row = await env.DB.prepare('SELECT content_type, size, data_b64 FROM media_blobs WHERE key = ?')
            .bind(rawKey).first().catch(() => null);
        if (row?.data_b64 != null) {
            const bytes = base64ToBytes(row.data_b64);
            return {
                key: rawKey,
                size: Number(row.size || bytes.byteLength),
                httpMetadata: { contentType: row.content_type || 'application/octet-stream' },
                httpEtag: `d1-${bytes.byteLength}`,
                body: bytes,
                async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
                async text() { return new TextDecoder().decode(bytes); },
            };
        }
    }
    return null;
}

export async function deleteMediaObject(env, key) {
    if (!key) return;
    const rawKey = stripD1Prefix(key);
    if (env.MEDIA) {
        try { await env.MEDIA.delete(rawKey); } catch (err) {
            console.warn('deleteMediaObject R2:', rawKey, err?.message);
        }
    }
    if (env.DB) {
        try { await env.DB.prepare('DELETE FROM media_blobs WHERE key = ?').bind(rawKey).run(); } catch { /* ignore */ }
    }
}

export async function storeJsonWithOffload(env, folder, id, value, oldKey = '') {
    if (value === undefined || value === null) {
        if (oldKey) await deleteMediaObject(env, oldKey);
        return { jsonText: null, r2Key: '' };
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.length <= INLINE_JSON_LIMIT) {
        if (oldKey) await deleteMediaObject(env, oldKey);
        return { jsonText: text, r2Key: '' };
    }
    const key = r2BlobKey(folder, id);
    if (env.MEDIA) {
        const stored = await putMediaObject(env, key, text, 'application/json; charset=utf-8');
        if (oldKey && stripD1Prefix(oldKey) !== stripD1Prefix(stored)) {
            await deleteMediaObject(env, oldKey);
        }
        return { jsonText: null, r2Key: stored };
    }
    if (text.length < 1_500_000) {
        return { jsonText: text, r2Key: '' };
    }
    throw new Error('Du lieu lon hon 1.5MB — hay bat Cloudflare R2 tren Dashboard de luu khong gioi han.');
}

export async function loadJsonWithOffload(env, jsonText, blobKey) {
    if (blobKey) {
        const obj = await getMediaObject(env, blobKey);
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
