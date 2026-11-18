// Client Google Drive API v3 thuan Web Standards (khong phu thuoc SDK nang).
// Ho tro ca 2 kieu xac thuc:
//   1. OAuth2 Refresh Token (GDRIVE_CLIENT_ID + GDRIVE_CLIENT_SECRET + GDRIVE_REFRESH_TOKEN)
//      -> Khuyen dung cho Google Drive ca nhan (15GB / Google One 2TB), khong dinh loi 403 storageQuotaExceeded.
//   2. Service Account JWT RS256 (GDRIVE_SERVICE_ACCOUNT_JSON)
//      -> Dung cho Shared Drive cua Google Workspace.

const GDRIVE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GDRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const GDRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

let cachedToken = { value: '', expMs: 0, cacheKey: '' };

function pemToArrayBuffer(pem) {
    const clean = String(pem || '')
        .replace(/-----BEGIN [^-]+-----/g, '')
        .replace(/-----END [^-]+-----/g, '')
        .replace(/\s+/g, '');
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
}

function b64UrlJson(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isGdriveConfigured(env) {
    if (!env) return false;
    const hasOAuth = !!(env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET && env.GDRIVE_REFRESH_TOKEN);
    const hasSA = !!env.GDRIVE_SERVICE_ACCOUNT_JSON;
    return hasOAuth || hasSA;
}

export async function getGdriveAccessToken(env) {
    const customTokenUrl = env.GDRIVE_TOKEN_URL || GDRIVE_TOKEN_URL;
    const hasOAuth = !!(env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET && env.GDRIVE_REFRESH_TOKEN);
    const cacheKey = hasOAuth
        ? `oauth:${env.GDRIVE_CLIENT_ID}:${String(env.GDRIVE_REFRESH_TOKEN).slice(0, 8)}`
        : `sa:${String(env.GDRIVE_SERVICE_ACCOUNT_JSON || '').slice(0, 24)}`;

    if (cachedToken.value && cachedToken.cacheKey === cacheKey && Date.now() < cachedToken.expMs - 60_000) {
        return cachedToken.value;
    }

    if (hasOAuth) {
        const body = new URLSearchParams({
            client_id: env.GDRIVE_CLIENT_ID,
            client_secret: env.GDRIVE_CLIENT_SECRET,
            refresh_token: env.GDRIVE_REFRESH_TOKEN,
            grant_type: 'refresh_token',
        });
        const res = await fetch(customTokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.access_token) {
            throw new Error(`Google OAuth token loi (${res.status}): ${j.error_description || j.error || 'unknown'}`);
        }
        cachedToken = {
            value: j.access_token,
            expMs: Date.now() + (Number(j.expires_in) || 3500) * 1000,
            cacheKey,
        };
        return cachedToken.value;
    }

    if (env.GDRIVE_SERVICE_ACCOUNT_JSON) {
        const sa = typeof env.GDRIVE_SERVICE_ACCOUNT_JSON === 'string'
            ? JSON.parse(env.GDRIVE_SERVICE_ACCOUNT_JSON)
            : env.GDRIVE_SERVICE_ACCOUNT_JSON;
        const nowSec = Math.floor(Date.now() / 1000);
        const header = b64UrlJson({ alg: 'RS256', typ: 'JWT' });
        const claim = b64UrlJson({
            iss: sa.client_email,
            scope: 'https://www.googleapis.com/auth/drive',
            aud: sa.token_uri || GDRIVE_TOKEN_URL,
            iat: nowSec,
            exp: nowSec + 3600,
        });
        const signingInput = `${header}.${claim}`;
        const key = await crypto.subtle.importKey(
            'pkcs8',
            pemToArrayBuffer(sa.private_key),
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
            false,
            ['sign'],
        );
        const sig = new Uint8Array(
            await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
        );
        const jwt = `${signingInput}.${b64UrlBytes(sig)}`;
        const body = new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        });
        const res = await fetch(sa.token_uri || customTokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.access_token) {
            throw new Error(`Google SA token loi (${res.status}): ${j.error_description || j.error || 'unknown'}`);
        }
        cachedToken = {
            value: j.access_token,
            expMs: Date.now() + (Number(j.expires_in) || 3500) * 1000,
            cacheKey,
        };
        return cachedToken.value;
    }

    throw new Error('Chua cau hinh Google Drive credentials (GDRIVE_REFRESH_TOKEN hoac GDRIVE_SERVICE_ACCOUNT_JSON).');
}

const escDriveQ = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

function apiBase(env) {
    return (env?.GDRIVE_API_BASE || GDRIVE_FILES_URL).replace(/\/+$/, '');
}

function uploadBase(env) {
    return (env?.GDRIVE_UPLOAD_BASE || GDRIVE_UPLOAD_URL).replace(/\/+$/, '');
}

export async function findOrCreateFolder(env, token, name, parentId = '') {
    const qParts = [
        `mimeType='${FOLDER_MIME}'`,
        `name='${escDriveQ(name)}'`,
        'trashed=false',
    ];
    if (parentId) qParts.push(`'${escDriveQ(parentId)}' in parents`);
    const url = `${apiBase(env)}?q=${encodeURIComponent(qParts.join(' and '))}`
        + '&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`GDrive findFolder ${name} failed (${res.status}): ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    if (data.files?.length) return data.files[0].id;

    const meta = {
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
    };
    const createRes = await fetch(`${apiBase(env)}?supportsAllDrives=true&fields=id,name`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(meta),
    });
    if (!createRes.ok) {
        const txt = await createRes.text().catch(() => '');
        throw new Error(`GDrive createFolder ${name} failed (${createRes.status}): ${txt.slice(0, 200)}`);
    }
    const created = await createRes.json();
    return created.id;
}

/**
 * Upload file qua Google Drive Resumable Upload API.
 * Stream truc tiep ReadableStream hoac Uint8Array/ArrayBuffer khong can gom het vao base64.
 */
export async function uploadFileToDrive(env, token, {
    name,
    parentId,
    mimeType = 'application/octet-stream',
    body,
    byteLength,
    existingFileId = '',
}) {
    const initUrl = existingFileId
        ? `${uploadBase(env)}/${encodeURIComponent(existingFileId)}?uploadType=resumable&supportsAllDrives=true&fields=id,name,size`
        : `${uploadBase(env)}?uploadType=resumable&supportsAllDrives=true&fields=id,name,size`;
    const initMethod = existingFileId ? 'PATCH' : 'POST';

    const meta = existingFileId
        ? { name, mimeType }
        : { name, mimeType, ...(parentId ? { parents: [parentId] } : {}) };

    const initHeaders = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
    };
    if (Number.isFinite(byteLength) && byteLength >= 0) {
        initHeaders['X-Upload-Content-Length'] = String(byteLength);
    }

    const initRes = await fetch(initUrl, {
        method: initMethod,
        headers: initHeaders,
        body: JSON.stringify(meta),
    });
    if (!initRes.ok) {
        const txt = await initRes.text().catch(() => '');
        throw new Error(`GDrive init upload failed (${initRes.status}): ${txt.slice(0, 240)}`);
    }
    const sessionUri = initRes.headers.get('location');
    if (!sessionUri) {
        throw new Error('GDrive khong tra ve upload session Location header.');
    }

    const putHeaders = { 'Content-Type': mimeType };
    if (Number.isFinite(byteLength) && byteLength >= 0) {
        putHeaders['Content-Length'] = String(byteLength);
    }
    const putRes = await fetch(sessionUri, {
        method: 'PUT',
        headers: putHeaders,
        body,
    });
    if (!putRes.ok) {
        const txt = await putRes.text().catch(() => '');
        throw new Error(`GDrive PUT data failed (${putRes.status}): ${txt.slice(0, 240)}`);
    }
    return putRes.json();
}

export async function pruneOldDriveFiles(env, token, parentId, keepCount = 30) {
    if (!parentId || !keepCount || keepCount < 1) return 0;
    const url = `${apiBase(env)}?q=${encodeURIComponent(`'${escDriveQ(parentId)}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`)}`
        + '&orderBy=createdTime desc&pageSize=200&fields=files(id,name,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return 0;
    const data = await res.json().catch(() => ({}));
    const files = data.files || [];
    if (files.length <= keepCount) return 0;
    let deleted = 0;
    for (const f of files.slice(keepCount)) {
        const del = await fetch(`${apiBase(env)}/${encodeURIComponent(f.id)}?supportsAllDrives=true`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);
        if (del?.ok) deleted++;
    }
    return deleted;
}
