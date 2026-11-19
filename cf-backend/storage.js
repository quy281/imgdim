// Quan ly luu tru lon tren Cloudflare R2 (uu tien) + tu dong fallback D1 `media_blobs` (<1.4MB) khi R2 chua bat.
// Tich hop khoa an toan chi phi (Free Tier Guardrail):
//   - R2 Free: 10 GB storage, 1M Class A writes/thang, 10M Class B reads/thang, 0d egress.
//   - Gioi han cung tai 8 GB / 800K writes / 8M reads de chan ghi som truoc khi phat sinh cuoc.

export const INLINE_JSON_LIMIT = 180_000;
const MAX_D1_BLOB_BYTES = 1_400_000;

export const R2_SAFE_BYTES_CAP = 8 * 1024 * 1024 * 1024; // 8 GB (< 10 GB Free)
export const R2_SAFE_CLASS_A_CAP = 800_000;                // 800K writes/thang (< 1M Free)
export const R2_SAFE_CLASS_B_CAP = 8_000_000;              // 8M reads/thang (< 10M Free)
export const MAX_SINGLE_OBJECT_BYTES = 20 * 1024 * 1024;   // 20 MB toi da / 1 file

function currentMonthKey() {
    return new Date().toISOString().slice(0, 7); // YYYY-MM
}

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

export async function getR2QuotaStats(env) {
    const month = currentMonthKey();
    if (!env?.DB) {
        return {
            month,
            r2Bytes: 0,
            r2Count: 0,
            r2CapBytes: R2_SAFE_BYTES_CAP,
            classA: 0,
            classACap: R2_SAFE_CLASS_A_CAP,
            classB: 0,
            classBCap: R2_SAFE_CLASS_B_CAP,
        };
    }
    const [led, qm] = await Promise.all([
        env.DB.prepare('SELECT COALESCE(SUM(size), 0) as total_bytes, COUNT(*) as cnt FROM r2_ledger')
            .first().catch(() => ({ total_bytes: 0, cnt: 0 })),
        env.DB.prepare('SELECT class_a, class_b FROM quota_monthly WHERE month = ?')
            .bind(month).first().catch(() => ({ class_a: 0, class_b: 0 })),
    ]);
    return {
        month,
        r2Bytes: Number(led?.total_bytes || 0),
        r2Count: Number(led?.cnt || 0),
        r2CapBytes: R2_SAFE_BYTES_CAP,
        classA: Number(qm?.class_a || 0),
        classACap: R2_SAFE_CLASS_A_CAP,
        classB: Number(qm?.class_b || 0),
        classBCap: R2_SAFE_CLASS_B_CAP,
    };
}

export async function assertAndRecordR2Write(env, key, newSize) {
    if (newSize > MAX_SINGLE_OBJECT_BYTES) {
        const err = new Error(`File qua lon (${Math.round(newSize / (1024 * 1024))} MB > gioi han 20 MB)`);
        err.status = 413;
        throw err;
    }
    if (!env?.DB) return;
    const rawKey = stripD1Prefix(key);
    const month = currentMonthKey();
    const [stats, existing] = await Promise.all([
        getR2QuotaStats(env),
        env.DB.prepare('SELECT size FROM r2_ledger WHERE r2_key = ?').bind(rawKey).first().catch(() => null),
    ]);
    const oldSize = Number(existing?.size || 0);
    const projectedBytes = stats.r2Bytes - oldSize + newSize;
    if (projectedBytes > R2_SAFE_BYTES_CAP) {
        const err = new Error('Da cham nguong an toan 8 GB / 10 GB Free R2 — tam khoa ghi de tranh phat sinh phi.');
        err.status = 507;
        throw err;
    }
    if (stats.classA >= R2_SAFE_CLASS_A_CAP) {
        const err = new Error('Da cham nguong an toan 800K luot ghi/thang tren R2 Free — tam khoa ghi de tranh phat sinh phi.');
        err.status = 429;
        throw err;
    }
    await env.DB.prepare(
        `INSERT INTO r2_ledger (r2_key, size, updated_ms) VALUES (?, ?, ?)
         ON CONFLICT(r2_key) DO UPDATE SET size = excluded.size, updated_ms = excluded.updated_ms`
    ).bind(rawKey, newSize, Date.now()).run().catch(() => {});
    await env.DB.prepare(
        `INSERT INTO quota_monthly (month, class_a, class_b) VALUES (?, 1, 0)
         ON CONFLICT(month) DO UPDATE SET class_a = class_a + 1`
    ).bind(month).run().catch(() => {});
}

export async function recordR2Delete(env, key) {
    if (!env?.DB || !key) return;
    const rawKey = stripD1Prefix(key);
    await env.DB.prepare('DELETE FROM r2_ledger WHERE r2_key = ?').bind(rawKey).run().catch(() => {});
}

export async function checkAndRecordR2Read(env) {
    if (!env?.DB) return;
    const month = currentMonthKey();
    const qm = await env.DB.prepare('SELECT class_b FROM quota_monthly WHERE month = ?')
        .bind(month).first().catch(() => null);
    if (qm && Number(qm.class_b || 0) >= R2_SAFE_CLASS_B_CAP) {
        const err = new Error('Da cham nguong an toan 8M luot doc/thang tren R2 Free.');
        err.status = 429;
        throw err;
    }
    await env.DB.prepare(
        `INSERT INTO quota_monthly (month, class_a, class_b) VALUES (?, 0, 1)
         ON CONFLICT(month) DO UPDATE SET class_b = class_b + 1`
    ).bind(month).run().catch(() => {});
}

export async function putMediaObject(env, key, body, contentType = 'application/octet-stream') {
    const rawKey = stripD1Prefix(key);
    const bytes = await bodyToUint8Array(body);

    if (env.MEDIA) {
        await assertAndRecordR2Write(env, rawKey, bytes.byteLength);
        await env.MEDIA.put(rawKey, bytes, { httpMetadata: { contentType } });
        if (env.DB) {
            await env.DB.prepare('DELETE FROM media_blobs WHERE key = ?').bind(rawKey).run().catch(() => {});
        }
        return rawKey;
    }
    if (!env.DB) {
        throw new Error('Thieu ca R2 (MEDIA) va D1 (DB).');
    }
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
        await checkAndRecordR2Read(env);
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
        await recordR2Delete(env, rawKey);
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
