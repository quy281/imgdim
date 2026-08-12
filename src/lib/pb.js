// PocketBase sync client — https://db.mkg.vn
//
// Collection `survey_items`: một record cho mỗi item, kind 'project' | 'doc'.
//   data        (json)  toàn bộ object đã serialize, TRỪ ảnh
//   photo       (file)  ảnh khảo sát, tách khỏi data để sync không kéo lại base64
//   photo_hash  (text)  để biết ảnh có đổi hay không
//   updated_ms  (num)   = data.updatedAt, cho phép so sánh mà KHÔNG tải data
//   scope       'private' | 'team'   ·  team (relation)  ·  deleted (bool)  ·  rev (num)
//
// SYNC HAI PHA — đây là điểm khác cốt tử so với bản v2:
//   Pha 1 chỉ tải metadata (~250 byte/record) để tính chênh lệch.
//   Pha 2 chỉ tải/đẩy đúng record thật sự lệch.
// Bản v2 tải toàn bộ `data` mỗi lần sync, gồm ảnh base64 → 20MB/lượt với 40 ảnh.
//
// Xung đột: last-write-wins trên updated_ms, nhưng mốc thời gian lấy theo ĐỒNG HỒ SERVER
// (bù lệch qua header Date) nên máy sai giờ không ăn mất dữ liệu của máy khác.

import { hashString } from './hash';

const BASE = 'https://db.mkg.vn';
const COL = 'survey_items';
const TEAMS = 'teams';
const SHARES = 'shares';
const TEAM_SLUG = 'mkg';

const AUTH_KEY = 'ks_auth';
const CLOCK_KEY = 'ks_clock_off';

export const SCHEMA_V = 3;
const META_FIELDS = 'id,item_id,kind,project_id,name,owner,owner_name,scope,team,updated_ms,deleted,rev,schema_v,photo,photo_hash';

// ===== Auth =====
export function getAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}

export function isLoggedIn() { return !!getAuth()?.token; }
export function me() { return getAuth()?.model || null; }
export function myId() { return getAuth()?.model?.id || null; }
export function myTeam() { return getAuth()?.team || null; }
/** Đang đăng nhập bằng tài khoản superuser — xem login(): vào được nhưng không sync được. */
export function isSuperuser() { return !!getAuth()?.superuser; }
export function myName() {
    const m = me();
    return m?.name || m?.username || m?.email || '';
}

function saveAuth(patch) {
    const cur = getAuth() || {};
    localStorage.setItem(AUTH_KEY, JSON.stringify({ ...cur, ...patch }));
}

export function logout() { localStorage.removeItem(AUTH_KEY); }

// ===== Đồng hồ =====
// Header `Date` của server có độ phân giải giây — đủ tốt cho last-write-wins, và loại
// hẳn trường hợp máy lệch giờ vài phút/vài ngày làm bản cũ thắng bản mới.
let clockOffset = Number(localStorage.getItem(CLOCK_KEY)) || 0;

function syncClock(res) {
    const d = res.headers.get('date');
    if (!d) return;
    const serverMs = Date.parse(d);
    if (!Number.isFinite(serverMs)) return;
    const off = serverMs - Date.now();
    // Bỏ qua lệch dưới 2s (nhiễu do độ phân giải giây + latency).
    if (Math.abs(off - clockOffset) > 2000) {
        clockOffset = off;
        localStorage.setItem(CLOCK_KEY, String(off));
    }
}

/** Mốc thời gian đã bù lệch — LUÔN dùng hàm này khi stamp updatedAt. */
export function now() { return Date.now() + clockOffset; }
export function clockSkew() { return clockOffset; }

// ===== Tầng HTTP =====
export class PbError extends Error {
    constructor(msg, status) { super(msg); this.status = status; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const isTransient = (err) => !err.status || err.status === 429 || err.status >= 500;

async function api(path, opts = {}, tries = 3) {
    let lastErr;
    for (let attempt = 0; attempt < tries; attempt++) {
        if (attempt > 0) await sleep(400 * 2 ** (attempt - 1));
        try {
            return await once(path, opts);
        } catch (err) {
            lastErr = err;
            if (!isTransient(err)) throw err;
        }
    }
    throw lastErr;
}

async function once(path, opts) {
    const auth = getAuth();
    const headers = { ...(opts.headers || {}) };
    const isForm = opts.body instanceof FormData;
    if (!isForm && opts.body) headers['Content-Type'] = 'application/json';
    if (auth?.token) headers.Authorization = auth.token;

    let res;
    try {
        res = await fetch(`${BASE}/api/${path}`, { ...opts, headers });
    } catch (err) {
        throw new PbError(navigator.onLine === false ? 'Không có mạng' : `Không kết nối được server (${err.message})`, 0);
    }
    syncClock(res);

    // CHỈ 401 mới là hết phiên. 403 là "không đủ quyền cho record này" — đăng xuất vì
    // 403 sẽ đá người dùng ra khỏi app chỉ vì một record lỗi.
    if (res.status === 401) {
        logout();
        throw new PbError('Phiên đăng nhập hết hạn — vui lòng đăng nhập lại', 401);
    }
    if (!res.ok) {
        let msg = res.statusText;
        try { const j = await res.json(); msg = j.message || msg; } catch { /* giữ statusText */ }
        throw new PbError(msg, res.status);
    }
    if (res.status === 204) return null;
    return res.json();
}

/** Escape giá trị nhét vào filter của PocketBase. */
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const q = (filter) => `filter=${encodeURIComponent(filter)}`;

export async function login(identity, password) {
    // Bảng `users` cho đăng nhập bằng email HOẶC username (identityFields của server).
    let data, superuser = false;
    try {
        data = await api('collections/users/auth-with-password', {
            method: 'POST',
            body: JSON.stringify({ identity, password }),
        }, 1);
    } catch (err) {
        if (err.status !== 400) throw err;
        // Rơi về `_superusers` để Founder vẫn vào được khi chưa có record trong `users`.
        // Lưu ý: superuser bỏ qua mọi API rule NHƯNG id của nó không thuộc bảng `users`,
        // nên field `owner` (relation → users) sẽ bị từ chối → không sync được. fullSync
        // báo lỗi rõ thay vì thất bại âm thầm.
        try {
            data = await api('collections/_superusers/auth-with-password', {
                method: 'POST',
                body: JSON.stringify({ identity, password }),
            }, 1);
            superuser = true;
        } catch {
            throw new PbError('Sai tài khoản hoặc mật khẩu', 400);
        }
    }
    saveAuth({ token: data.token, model: data.record, team: null, superuser });
    // Team lấy ngay sau khi đăng nhập; thất bại thì vẫn dùng app được ở chế độ riêng tư.
    try {
        const t = await api(`collections/${TEAMS}/records?perPage=1&${q(`slug='${esc(TEAM_SLUG)}'`)}`);
        if (t.items?.length) saveAuth({ team: { id: t.items[0].id, name: t.items[0].name } });
    } catch { /* chưa dựng collection teams — bỏ qua */ }
    return data.record;
}

/**
 * Kiểm tra token còn sống thật hay không, và gia hạn.
 *
 * BẮT BUỘC phải có: PocketBase KHÔNG trả 401 khi token sai ở endpoint đọc — nó coi như
 * khách và trả 200 với danh sách rỗng. Nếu chỉ tin localStorage thì token hết hạn sẽ làm
 * app báo "đồng bộ xong, 0 thay đổi" trong khi thực tế đang là khách: máy mới thấy trống
 * trơn, máy cũ push nào cũng lỗi. Chỉ `auth-refresh` mới trả 401 rõ ràng.
 * Trả về true nếu phiên còn dùng được, false nếu đã bị đăng xuất.
 */
let sessionCheckedAt = 0;
let verifiedToken = null;
export async function ensureSession(force) {
    if (!isLoggedIn()) return false;
    const token = getAuth().token;
    // Throttle theo CẢ thời gian và token: token đổi (đăng nhập lại, hoặc bản lưu bị
    // thay từ tab khác) thì phải xác thực lại ngay, không ăn theo lần kiểm trước.
    if (!force && verifiedToken === token && Date.now() - sessionCheckedAt < 10 * 60_000) return true;
    // Phiên superuser phải refresh ở đúng bảng của nó, không thì bị 401 và đá ra ngay khi boot.
    const col = isSuperuser() ? '_superusers' : 'users';
    try {
        const res = await api(`collections/${col}/auth-refresh`, { method: 'POST' }, 2);
        saveAuth({ token: res.token, model: res.record, superuser: isSuperuser() });
        sessionCheckedAt = Date.now();
        verifiedToken = res.token;
        return true;
    } catch (err) {
        if (err.status === 401) return false; // api() đã logout
        return true; // lỗi mạng — đừng đá người dùng ra, thử lại lần sau
    }
}

/** Nạp lại thông tin team (dùng khi Founder mới thêm mình vào team). */
export async function refreshTeam() {
    if (!isLoggedIn()) return null;
    try {
        const t = await api(`collections/${TEAMS}/records?perPage=1&${q(`slug='${esc(TEAM_SLUG)}'`)}`);
        const team = t.items?.length ? { id: t.items[0].id, name: t.items[0].name } : null;
        saveAuth({ team });
        return team;
    } catch { return myTeam(); }
}

// ===== Ảnh: tách khỏi data JSON =====
export function photoHashOf(doc) {
    if (doc?.type !== 'photo') return '';
    return doc.photoHash || (doc.img ? hashString(doc.img) : '');
}

function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const mime = head.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
});

// File field đặt protected:true → phải có token mới đọc được. Token sống ~2 phút.
let fileToken = { value: null, at: 0 };
async function getFileToken() {
    if (fileToken.value && Date.now() - fileToken.at < 90_000) return fileToken.value;
    const res = await api('files/token', { method: 'POST' });
    fileToken = { value: res.token, at: Date.now() };
    return res.token;
}

async function downloadPhoto(recordId, filename) {
    const token = await getFileToken().catch(() => null);
    const url = `${BASE}/api/files/${COL}/${recordId}/${encodeURIComponent(filename)}${token ? `?token=${token}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new PbError(`Không tải được ảnh (${res.status})`, res.status);
    return blobToDataUrl(await res.blob());
}

// ===== Pha 1: chỉ metadata =====
async function fetchMeta() {
    const items = [];
    let legacy = false;
    for (let page = 1; ; page++) {
        const res = await api(`collections/${COL}/records?page=${page}&perPage=500&sort=-updated&fields=${META_FIELDS}`);
        const batch = res.items || [];
        // Backend chưa chạy pb-setup.mjs → chưa có cột updated_ms. Rơi về chế độ cũ
        // (phải tải cả `data` để so sánh) thay vì hỏng.
        if (page === 1 && batch.length && !('updated_ms' in batch[0])) { legacy = true; break; }
        items.push(...batch);
        if (page >= (res.totalPages || 1)) break;
    }
    if (!legacy) return { items, legacy: false };

    const full = [];
    for (let page = 1; ; page++) {
        const res = await api(`collections/${COL}/records?page=${page}&perPage=200&sort=-updated`);
        full.push(...(res.items || []));
        if (page >= (res.totalPages || 1)) break;
    }
    return {
        legacy: true,
        items: full.map(r => ({
            ...r,
            updated_ms: Number(r.data?.updatedAt) || 0,
            deleted: !!r.data?._deleted,
            schema_v: r.schema_v || 2,
            _data: r.data,
        })),
    };
}

const keyOf = (owner, itemId) => `${owner || ''}/${itemId}`;

/** Trả về danh sách metadata để UI so sánh local ↔ cloud (rẻ, không tải data). */
export async function fetchRemoteStatus() {
    if (!isLoggedIn()) return { items: [], account: null, team: null };
    const { items, legacy } = await fetchMeta();
    return {
        account: me()?.email || me()?.username || '(unknown)',
        team: myTeam(),
        legacy,
        items: items.map(r => ({
            item_id: r.item_id,
            kind: r.kind,
            project_id: r.project_id,
            name: r.name,
            owner: r.owner,
            ownerName: r.owner_name || '',
            scope: r.scope || 'private',
            deleted: !!r.deleted,
            updatedAt: r.updated_ms || 0,
        })),
    };
}

// ===== Push =====
function buildPayload({ kind, item, scope, teamId, legacy }) {
    const isPhoto = kind === 'doc' && item.type === 'photo';
    const base = {
        owner: myId(),
        item_id: String(item.id),
        kind,
        project_id: String(item.projectId || item.id),
        name: item.name || '',
    };

    // Backend CHƯA chạy pb-setup.mjs: field `photo` không tồn tại. Nếu vẫn bóc `img` ra
    // khỏi `data` rồi gửi vào field đó thì ảnh biến mất khỏi cloud — máy khác kéo về
    // được doc ảnh rỗng. Ở chế độ này giữ nguyên hình dạng payload của v2.
    if (legacy) {
        return { fields: { ...base, data: item }, photoDataUrl: null, legacy: true };
    }

    const data = isPhoto ? { ...item } : item;
    if (isPhoto) delete data.img;
    return {
        fields: {
            ...base,
            owner_name: myName(),
            scope: scope || 'private',
            team: scope === 'team' ? (teamId || '') : '',
            updated_ms: Number(item.updatedAt) || 0,
            deleted: false,
            schema_v: SCHEMA_V,
            photo_hash: isPhoto ? photoHashOf(item) : '',
            data,
        },
        photoDataUrl: isPhoto ? item.img : null,
    };
}

async function writeRecord(recId, fields, photoDataUrl, rev, legacy) {
    // Chế độ tương thích: không gửi `rev` vì cột đó chưa có trên backend.
    const body = legacy ? { ...fields } : { ...fields, rev: (rev || 0) + 1 };
    const path = recId ? `collections/${COL}/records/${recId}` : `collections/${COL}/records`;
    const method = recId ? 'PATCH' : 'POST';

    if (!photoDataUrl) {
        return api(path, { method, body: JSON.stringify(body) });
    }
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) {
        form.append(k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''));
    }
    form.append('photo', dataUrlToBlob(photoDataUrl), `${fields.item_id}.jpg`);
    return api(path, { method, body: form });
}

/**
 * Sync hai chiều đầy đủ.
 *
 * local = {
 *   projects: [],            // mảng project meta (có .scope, .ownerId)
 *   docs: [],                // toàn bộ doc
 *   tombstones: [],          // [{ item_id, kind, deletedAt }]
 *   scopeDirty: [projectId], // dự án vừa đổi phạm vi → buộc đẩy lại cả doc
 * }
 */
export async function fullSync(local, onProgress) {
    if (!isLoggedIn()) throw new PbError('Chưa đăng nhập', 401);
    if (isSuperuser()) {
        throw new PbError('Đang đăng nhập bằng tài khoản quản trị — không đồng bộ được. '
            + 'Cần một tài khoản trong bảng users để dữ liệu có chủ sở hữu.', 403);
    }
    if (navigator.onLine === false) throw new PbError('Không có mạng', 0);
    if (!(await ensureSession())) throw new PbError('Phiên đăng nhập hết hạn — vui lòng đăng nhập lại', 401);

    const uid = myId();
    const team = myTeam();
    const p = (m) => onProgress?.(m);

    p('Đang so sánh với cloud...');
    const { items: remote, legacy } = await fetchMeta();
    const remoteByKey = new Map();
    const remoteByItem = new Map();
    for (const r of remote) {
        remoteByKey.set(keyOf(r.owner, r.item_id), r);
        if (!remoteByItem.has(r.item_id)) remoteByItem.set(r.item_id, []);
        remoteByItem.get(r.item_id).push(r);
    }

    const scopeOfProject = new Map(local.projects.map(pr => [String(pr.id), pr.scope || 'private']));
    const localMap = new Map([
        ...local.projects.map(pr => [String(pr.id), { kind: 'project', item: pr, scope: pr.scope || 'private' }]),
        ...local.docs.map(d => [String(d.id), {
            kind: 'doc', item: d, scope: scopeOfProject.get(String(d.projectId)) || 'private',
        }]),
    ]);
    const tombstoneMap = new Map(local.tombstones.map(t => [t.item_id, t]));
    const scopeDirty = new Set((local.scopeDirty || []).map(String));

    // Tra record trên cloud cho một item local. Item tạo lúc chưa đăng nhập chưa có
    // ownerId → nếu trên cloud chỉ có duy nhất một record cùng item_id thì nhận record đó.
    const findRemote = (id, item) => {
        const own = remoteByKey.get(keyOf(item.ownerId || uid, id));
        if (own) return own;
        const any = remoteByItem.get(id);
        return any?.length === 1 ? any[0] : null;
    };

    // ===== 1. Đẩy các lệnh xóa (soft-delete) =====
    const clearedTombstones = [];
    let deleted = 0;
    for (const t of local.tombstones) {
        const rec = remoteByItem.get(t.item_id)?.find(r => r.owner === uid) || remoteByItem.get(t.item_id)?.[0];
        if (!rec) {
            // Chưa từng lên cloud. Giữ tombstone (db.js tự dọn sau 90 ngày) để nếu máy
            // khác đẩy item này lên thì lần sync sau ta vẫn xóa được.
            continue;
        }
        if (rec.deleted) { clearedTombstones.push(t.item_id); continue; }
        if ((rec.updated_ms || 0) > t.deletedAt) { clearedTombstones.push(t.item_id); continue; } // cloud mới hơn → thắng
        p('Đang xóa trên cloud...');
        try {
            // `data._deleted` là dấu xóa mà CẢ HAI schema đều đọc được; các cột kia chỉ
            // gửi khi backend đã có, để không dựa vào việc PocketBase bỏ qua field lạ.
            const delBody = {
                name: '_deleted_',
                data: { id: t.item_id, _deleted: true, updatedAt: t.deletedAt },
            };
            if (!legacy) Object.assign(delBody, {
                deleted: true,
                updated_ms: t.deletedAt,
                rev: (rec.rev || 0) + 1,
                schema_v: SCHEMA_V,
            });
            await api(`collections/${COL}/records/${rec.id}`, { method: 'PATCH', body: JSON.stringify(delBody) });
            deleted++;
            clearedTombstones.push(t.item_id);
            rec.deleted = true;
            rec.updated_ms = t.deletedAt;
        } catch (err) {
            console.warn('soft-delete failed:', t.item_id, err.message);
            // Giữ tombstone để thử lại lần sync sau.
        }
    }

    // ===== 2. Quyết định pull / push =====
    const toPull = [];
    const deletedProjects = [];
    const deletedDocs = [];
    for (const rec of remote) {
        const t = tombstoneMap.get(rec.item_id);
        if (t && (rec.updated_ms || 0) <= t.deletedAt) continue; // ta vừa xóa, đừng kéo về
        const loc = localMap.get(rec.item_id);
        if (rec.deleted) {
            if (loc && (rec.updated_ms || 0) >= (loc.item.updatedAt || 0)) {
                (rec.kind === 'project' ? deletedProjects : deletedDocs).push(rec.item_id);
            }
            continue;
        }
        if (!loc || (rec.updated_ms || 0) > (loc.item.updatedAt || 0)) toPull.push(rec);
    }

    const toPush = [];
    for (const [id, loc] of localMap) {
        const rec = findRemote(id, loc.item);
        // Cloud đã xóa và mốc xóa không cũ hơn local → tôn trọng lệnh xóa, không đẩy lại.
        if (rec?.deleted && (rec.updated_ms || 0) >= (loc.item.updatedAt || 0)) continue;
        const stale = !rec || (loc.item.updatedAt || 0) > (rec.updated_ms || 0);
        // Backend chưa có cột scope/schema_v → đổi phạm vi và migrate đều vô nghĩa, mà
        // điều kiện lại luôn đúng nên sẽ đẩy lại toàn bộ dự án ở MỌI lượt sync.
        const scopeChanged = !legacy && rec && (
            scopeDirty.has(String(loc.kind === 'doc' ? loc.item.projectId : loc.item.id)) ||
            (rec.scope || 'private') !== loc.scope
        );
        // Record còn ở schema cũ (ảnh nằm trong JSON) → đẩy lại để tách ảnh ra file field.
        const needsMigrate = !legacy && rec && (rec.schema_v || 2) < SCHEMA_V
            && loc.kind === 'doc' && loc.item.type === 'photo';
        if (stale || scopeChanged || needsMigrate) toPush.push({ ...loc, rec, reason: stale ? 'edit' : scopeChanged ? 'scope' : 'migrate' });
    }

    // ===== 3. Pha 2 — chỉ tải record thực sự lệch =====
    const pulledProjects = [];
    const pulledDocs = [];
    const pullFailed = [];
    for (let i = 0; i < toPull.length; i++) {
        const rec = toPull[i];
        p(`Đang tải về ${i + 1}/${toPull.length}...`);
        try {
            const full = legacy && rec._data ? { data: rec._data, ...rec } : await api(`collections/${COL}/records/${rec.id}`);
            const data = full.data;
            if (!data || typeof data !== 'object') continue;
            const item = { ...data, ownerId: rec.owner, ownerName: rec.owner_name || '' };
            if (rec.kind === 'project') {
                item.scope = rec.scope || 'private';
                pulledProjects.push(item);
            } else {
                // Ảnh nằm ở file field từ schema_v 3 → tải riêng, và chỉ khi hash đổi.
                if (item.type === 'photo') {
                    const localDoc = localMap.get(rec.item_id)?.item;
                    const wantHash = rec.photo_hash || '';
                    if (!item.img && rec.photo) {
                        if (localDoc?.img && wantHash && photoHashOf(localDoc) === wantHash) {
                            item.img = localDoc.img;          // ảnh không đổi — dùng lại bản trên máy
                            item.photoHash = wantHash;
                        } else {
                            p(`Đang tải ảnh ${i + 1}/${toPull.length}...`);
                            item.img = await downloadPhoto(rec.id, rec.photo);
                            item.photoHash = hashString(item.img);
                        }
                    } else if (item.img) {
                        item.photoHash = hashString(item.img); // record schema cũ
                    }
                }
                pulledDocs.push(item);
            }
        } catch (err) {
            pullFailed.push(rec.item_id);
            console.warn('pull failed:', rec.name, err.message);
        }
    }

    // ===== 4. Push =====
    let pushed = 0;
    let migrated = 0;
    const failedIds = [];
    const scopeSynced = new Set();
    for (let i = 0; i < toPush.length; i++) {
        const { kind, item, scope, rec, reason } = toPush[i];
        p(`Đang đẩy lên ${i + 1}/${toPush.length}...`);
        const { fields, photoDataUrl } = buildPayload({ kind, item, scope, teamId: team?.id, legacy });
        // Migrate/đổi scope không phải người dùng sửa nội dung → giữ nguyên mốc thời gian
        // để máy khác không phải tải lại doc.
        if (reason !== 'edit' && rec && !legacy) fields.updated_ms = rec.updated_ms || fields.updated_ms;
        // Sửa dự án team của ĐỒNG NGHIỆP: không được gửi owner, vì rule chống chiếm record
        // (@request.body.owner = owner) sẽ trả 403 và mất luôn bản sửa.
        if (rec && rec.owner && rec.owner !== uid) {
            delete fields.owner;
            delete fields.owner_name;
        }
        // Ảnh đã đúng hash trên cloud thì không upload lại.
        const skipPhoto = rec && photoDataUrl && rec.photo && rec.photo_hash === fields.photo_hash;
        try {
            await writeRecord(rec?.id, fields, skipPhoto ? null : photoDataUrl, rec?.rev, legacy);
            pushed++;
            if (reason === 'migrate') migrated++;
            if (reason === 'scope') scopeSynced.add(String(kind === 'doc' ? item.projectId : item.id));
        } catch (err) {
            failedIds.push(String(item.id));
            console.warn('push failed:', item.name, err.status, err.message);
        }
    }
    // Chỉ báo đã xong việc đổi scope khi TOÀN BỘ item của dự án đó đẩy được.
    for (const pid of scopeDirty) {
        const anyFailed = toPush.some(t =>
            String(t.kind === 'doc' ? t.item.projectId : t.item.id) === pid &&
            failedIds.includes(String(t.item.id)));
        if (anyFailed) scopeSynced.delete(pid);
        else scopeSynced.add(pid);
    }

    return {
        pulledProjects, pulledDocs, deletedProjects, deletedDocs,
        pushed, migrated, deleted, failedIds, pullFailed, clearedTombstones,
        scopeSynced: [...scopeSynced],
        legacy,
    };
}

// ===== Link chia sẻ =====
// Payload nằm trên server, không nhúng vào URL → link chỉ ~35 ký tự, gửi Zalo/Messenger
// được, và thu hồi được bất cứ lúc nào.
export async function createShare({ projectId, title, payload, days }) {
    if (!isLoggedIn()) throw new PbError('Cần đăng nhập để tạo link chia sẻ', 401);
    const body = {
        owner: myId(),
        project_id: String(projectId),
        title: title || '',
        payload,
        revoked: false,
        expires: days ? new Date(now() + days * 86400_000).toISOString().replace('T', ' ').slice(0, 19) + 'Z' : '',
    };
    const rec = await api(`collections/${SHARES}/records`, { method: 'POST', body: JSON.stringify(body) });
    return { code: rec.id, url: shareUrl(rec.id), expires: rec.expires, created: rec.created };
}

export function shareUrl(code) {
    return `${window.location.origin}/?s=${code}`;
}

export async function listShares(projectId) {
    if (!isLoggedIn()) return [];
    const filter = projectId ? `project_id='${esc(projectId)}'` : `owner='${esc(myId())}'`;
    const res = await api(`collections/${SHARES}/records?perPage=200&sort=-created&${q(filter)}`);
    return (res.items || []).map(r => ({
        code: r.id, url: shareUrl(r.id), title: r.title, projectId: r.project_id,
        revoked: !!r.revoked, expires: r.expires, created: r.created,
    }));
}

export async function revokeShare(code) {
    await api(`collections/${SHARES}/records/${code}`, { method: 'PATCH', body: JSON.stringify({ revoked: true }) });
}

/** Đọc share công khai theo code — không cần đăng nhập. */
export async function fetchShare(code) {
    if (!/^[A-Za-z0-9]{6,20}$/.test(code)) throw new PbError('Link không hợp lệ', 400);
    let rec;
    try {
        rec = await api(`collections/${SHARES}/records/${encodeURIComponent(code)}`, {}, 2);
    } catch (err) {
        if (err.status === 404) throw new PbError('Link đã bị thu hồi hoặc hết hạn', 404);
        throw err;
    }
    return { code: rec.id, title: rec.title, payload: rec.payload, created: rec.created };
}
