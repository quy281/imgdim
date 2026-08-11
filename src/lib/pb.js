// PocketBase sync client — https://db.mkg.vn, collection `survey_items`.
// One record per item: kind 'project' | 'doc'. `data` holds the full serialized object.
// Conflict resolution: last-write-wins on data.updatedAt (client clock).

const BASE = 'https://db.mkg.vn';
const COL = 'survey_items';
const AUTH_KEY = 'ks_auth';

// ===== Auth =====
export function getAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}

export function isLoggedIn() { return !!getAuth()?.token; }
export function me() { return getAuth()?.model || null; }

function saveAuth(token, model) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token, model }));
}

export function logout() { localStorage.removeItem(AUTH_KEY); }

async function api(path, opts = {}) {
    const auth = getAuth();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (auth?.token) headers.Authorization = auth.token;
    const res = await fetch(`${BASE}/api/${path}`, { ...opts, headers });
    if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error('Phiên đăng nhập hết hạn — vui lòng đăng nhập lại');
    }
    if (!res.ok) {
        let msg = res.statusText;
        try { const j = await res.json(); msg = j.message || msg; } catch { /* keep statusText */ }
        throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
}

export async function login(identity, password) {
    const payload = JSON.stringify({ identity, password });
    const headers = { 'Content-Type': 'application/json' };

    // 1. Thử đăng nhập bằng bảng users
    let res = await fetch(`${BASE}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers,
        body: payload,
    });

    // 2. Nếu thất bại, thử đăng nhập bằng bảng _superusers (PB v0.22+)
    if (!res.ok) {
        res = await fetch(`${BASE}/api/collections/_superusers/auth-with-password`, {
            method: 'POST',
            headers,
            body: payload,
        });
    }

    // 3. Nếu vẫn thất bại, thử đăng nhập bằng Admin API legacy (/api/admins)
    if (!res.ok) {
        res = await fetch(`${BASE}/api/admins/auth-with-password`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ email: identity, password }),
        });
    }

    if (!res.ok) {
        let msg = 'Sai tài khoản hoặc mật khẩu';
        try { const j = await res.json(); if (j.message && res.status !== 400) msg = j.message; } catch { /* default */ }
        throw new Error(msg);
    }

    const data = await res.json();
    const record = data.record || data.admin || { id: 'admin', email: identity, username: identity };
    saveAuth(data.token, record);
    return record;
}

// ===== Records =====
async function listRemote() {
    const items = [];
    let page = 1;
    for (; ;) {
        const res = await api(`collections/${COL}/records?page=${page}&perPage=200&sort=-updated`);
        items.push(...(res.items || []));
        if (page >= (res.totalPages || 1)) break;
        page++;
    }
    return items;
}

/** Upsert a single item. kind: 'project'|'doc'. item must have .id and .updatedAt. */
export async function pushItem(kind, item, projectId) {
    const owner = me()?.id;
    if (!owner) throw new Error('Chưa đăng nhập');
    const payload = {
        owner,
        item_id: String(item.id),
        kind,
        project_id: String(projectId || item.projectId || item.id),
        name: item.name || '',
        data: item,
    };
    const found = await api(`collections/${COL}/records?filter=(item_id='${item.id}')&perPage=1&fields=id`);
    if (found.items?.length) {
        return api(`collections/${COL}/records/${found.items[0].id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    }
    return api(`collections/${COL}/records`, { method: 'POST', body: JSON.stringify(payload) });
}

/** Lightweight status fetch — trả về danh sách item trên remote để so sánh với local. */
export async function fetchRemoteStatus() {
    if (!isLoggedIn()) return { items: [], account: null };
    const remote = await listRemote();
    return {
        account: me()?.email || me()?.username || '(unknown)',
        items: remote.map(r => ({
            item_id: r.item_id,
            kind: r.kind,
            project_id: r.project_id,
            name: r.name,
            updatedAt: r.data?.updatedAt || 0,
        })),
    };
}

/** Soft-delete: đánh dấu _deleted=true thay vì xóa record để thiết bị khác biết và xóa local. */
export async function deleteRemote(itemId, kind) {
    const owner = me()?.id;
    if (!owner) return;
    const deletedAt = Date.now();
    const payload = {
        owner,
        item_id: String(itemId),
        kind: kind || 'doc',
        project_id: String(itemId),
        name: '_deleted_',
        data: { id: itemId, _deleted: true, updatedAt: deletedAt },
    };
    const found = await api(`collections/${COL}/records?filter=(item_id='${itemId}')&perPage=1&fields=id`);
    if (found.items?.length) {
        await api(`collections/${COL}/records/${found.items[0].id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
        // Chưa từng lên remote — tạo marker để thiết bị khác biết item này đã bị xóa
        await api(`collections/${COL}/records`, { method: 'POST', body: JSON.stringify(payload) });
    }
}

/**
 * Full two-way sync (last-write-wins on data.updatedAt).
 * local = { projects: [], docs: [], tombstones: [] }
 * Returns { pulledProjects, pulledDocs, pushed, deleted, clearedTombstones }
 */
export async function fullSync(local, onProgress) {
    const owner = me()?.id;
    onProgress?.('Đang tải dữ liệu cloud...');
    const remote = await listRemote();
    const remoteMap = new Map(remote.map(r => [r.item_id, r]));
    const localMap = new Map([
        ...local.projects.map(p => [String(p.id), { kind: 'project', item: p }]),
        ...local.docs.map(d => [String(d.id), { kind: 'doc', item: d }]),
    ]);
    const tombstoneMap = new Map(local.tombstones.map(t => [t.item_id, t]));

    // 1. Deletions (tombstone fallback): soft-delete remote records whose tombstone is newer
    const clearedTombstones = [];
    let deleted = 0;
    for (const t of local.tombstones) {
        const rec = remoteMap.get(t.item_id);
        if (rec && !rec.data?._deleted && (rec.data?.updatedAt || 0) <= t.deletedAt) {
            onProgress?.('Đang xóa trên cloud...');
            try {
                const payload = {
                    owner,
                    item_id: t.item_id,
                    kind: rec.kind,
                    project_id: rec.project_id,
                    name: '_deleted_',
                    data: { id: t.item_id, _deleted: true, updatedAt: t.deletedAt },
                };
                await api(`collections/${COL}/records/${rec.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
                deleted++;
                clearedTombstones.push(t.item_id);
            } catch { /* retry next sync */ }
        } else {
            clearedTombstones.push(t.item_id);
        }
    }

    // 2. Pull: remote records newer than local; detect remote deletions
    const pulledProjects = [];
    const pulledDocs = [];
    const deletedProjects = []; // bị xóa trên remote → cần xóa local
    const deletedDocs = [];
    for (const rec of remoteMap.values()) {
        if (!rec.data) continue;
        const t = tombstoneMap.get(rec.item_id);
        if (t && (rec.data.updatedAt || 0) <= t.deletedAt) continue;
        const loc = localMap.get(rec.item_id);
        if (rec.data._deleted) {
            // Remote đánh dấu xóa — xóa local nếu remote mới hơn hoặc local không có
            if (!loc || (rec.data.updatedAt || 0) >= (loc.item.updatedAt || 0)) {
                if (rec.kind === 'project') deletedProjects.push(rec.item_id);
                else deletedDocs.push(rec.item_id);
            }
            continue;
        }
        if (!loc || (rec.data.updatedAt || 0) > (loc.item.updatedAt || 0)) {
            if (rec.kind === 'project') pulledProjects.push(rec.data);
            else pulledDocs.push(rec.data);
        }
    }

    // 3. Push: local items newer than remote (bỏ qua item đã bị remote xóa)
    let pushed = 0;
    const failedIds = [];
    const toPush = [];
    for (const [id, loc] of localMap) {
        const rec = remoteMap.get(id);
        // Nếu remote đã soft-delete với timestamp >= local → không push lại
        if (rec?.data?._deleted && (rec.data.updatedAt || 0) >= (loc.item.updatedAt || 0)) continue;
        if (!rec || (loc.item.updatedAt || 0) > (rec.data?.updatedAt || 0)) toPush.push({ ...loc, rec });
    }
    for (let i = 0; i < toPush.length; i++) {
        const { kind, item, rec } = toPush[i];
        onProgress?.(`Đang đẩy lên ${i + 1}/${toPush.length}...`);
        const payload = {
            owner,
            item_id: String(item.id),
            kind,
            project_id: String(item.projectId || item.id),
            name: item.name || '',
            data: item,
        };
        try {
            if (rec) await api(`collections/${COL}/records/${rec.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
            else await api(`collections/${COL}/records`, { method: 'POST', body: JSON.stringify(payload) });
            pushed++;
        } catch (err) {
            failedIds.push(String(item.id));
            console.warn('push failed:', item.name, err.message);
        }
    }

    return { pulledProjects, pulledDocs, pushed, deleted, clearedTombstones, failedIds, deletedProjects, deletedDocs };
}
