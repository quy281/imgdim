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
// Phạm vi mặc định khi dự án chưa có trường scope (dữ liệu tạo trước khi có lớp user).
// 'team' → dữ liệu cũ tự vào team MKG, không phải chuyển tay từng dự án.
export const SCOPE_DEFAULT = 'team';
const META_FIELDS = 'id,item_id,kind,project_id,name,owner,owner_name,scope,team,updated_ms,deleted,rev,schema_v,photo,photo_hash';

// ===== Auth =====
export function getAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}

export function isLoggedIn() { return !!getAuth()?.token; }
export function me() { return getAuth()?.model || null; }
export function myId() { return getAuth()?.model?.id || null; }
export function isSuperuser() { return !!getAuth()?.superuser; }
export function myName() {
    const m = me();
    return m?.name || m?.username || m?.email || '';
}

// ===== Danh tính ghi dữ liệu (khác với danh tính đăng nhập, cho tài khoản superuser) =====
// `owner` trên survey_items là relation → collection `users`. Superuser xác thực qua bảng
// riêng `_superusers` — id của nó KHÔNG tồn tại trong `users`, nên nếu dùng thẳng myId()
// làm owner, PocketBase từ chối record vì "giá trị quan hệ không tồn tại" và sync coi như
// chết. resolveIdentity() tự tìm-hoặc-tạo một record `users` cùng email để làm danh tính
// ghi dữ liệu; ownerId()/ownerName() LUÔN dùng khi ghi lên cloud, còn myId()/myName() chỉ
// để hiển thị "ai đang đăng nhập trên máy này".
export function ownerId() { return getAuth()?.identityId || myId(); }
export function ownerName() { return getAuth()?.identityName || myName(); }
/** Tất cả team mà danh tính hiện tại thuộc về (superuser: toàn bộ team, vì bỏ qua rule). */
export function myTeams() { return getAuth()?.teams || (getAuth()?.team ? [getAuth().team] : []); }
/** Team "chính" — dùng làm mặc định khi dự án đổi sang phạm vi team mà chưa chọn team cụ thể. */
export function myTeam() {
    const teams = myTeams();
    if (!teams.length) return null;
    // KHÔNG lấy bừa team đầu danh sách. Superuser thấy MỌI team, kể cả team họ không
    // thuộc về — gán dự án vào team đó thì đồng nghiệp mở app lên thấy trống trơn mà
    // không có lỗi nào báo. Ưu tiên team mình thật sự là thành viên, rồi tới team gốc.
    const mine = teams.filter(t => t.mine);
    const pool = mine.length ? mine : teams;
    return pool.find(t => t.slug === TEAM_SLUG) || pool[0];
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
        try {
            const j = await res.json();
            msg = j.message || msg;
            // PocketBase trả lỗi validate theo từng field trong j.data (vd: "owner: giá trị
            // quan hệ không tồn tại", "password: độ dài phải từ 8 ký tự"). Không lộ ra thì
            // toast chỉ hiện "Failed to create record." — không ai đoán được vì sao.
            if (j.data && typeof j.data === 'object') {
                const details = Object.entries(j.data)
                    .map(([field, e]) => e?.message ? `${field}: ${e.message}` : null)
                    .filter(Boolean);
                if (details.length) msg = `${msg} (${details.join('; ')})`;
            }
        } catch { /* giữ statusText */ }
        throw new PbError(msg, res.status);
    }
    if (res.status === 204) return null;
    return res.json();
}

/** Escape giá trị nhét vào filter của PocketBase. */
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const q = (filter) => `filter=${encodeURIComponent(filter)}`;

// Mật khẩu ngẫu nhiên cho record `users` tự tạo (superuser đăng nhập qua _superusers,
// không ai cần biết mật khẩu này) và cho addTeamMember() khi admin không tự đặt mật khẩu.
function randomPassword(len = 16) {
    const bytes = new Uint8Array(len);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
    return [...bytes].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, len);
}
/** PocketBase mặc định từ chối mật khẩu ngắn hơn — không tự ý hạ ràng buộc này. */
export const PASSWORD_MIN = 8;

// ===== PIN =====
// Người đi khảo sát bấm 4 số, không gõ mật khẩu. Nhưng PocketBase từ chối mật khẩu
// dưới 8 ký tự, nên PIN được NỞ ra thành mật khẩu thật một cách xác định.
//
// Nói thẳng: đây KHÔNG phải một lớp bảo mật. PIN 4 số vẫn là 10^4 tổ hợp và công
// thức nở nằm trong JS tải về máy khách. Nó chỉ để thoả ràng buộc độ dài, và để sau
// này đổi độ dài PIN không phải đổi cơ chế. Chỗ bảo vệ thật là: mỗi người tự đổi PIN
// sau khi nhận tài khoản, và phiên hết hạn sau 30 ngày.
export const PIN_MIN = 4;
export const PIN_MAX = 8;
const PIN_RE = /^\d{4,8}$/;

export const isPin = (s) => PIN_RE.test(String(s || '').trim());

export function pinToPassword(pin) {
    const s = String(pin ?? '').trim();
    if (!PIN_RE.test(s)) throw new PbError(`PIN phải là ${PIN_MIN}–${PIN_MAX} chữ số`, 400);
    return `mkgks-${s}-v1`;
}

// ===== Thời hạn phiên =====
// 30 ngày kể từ lần ĐĂNG NHẬP, không phải từ lần gia hạn token — gia hạn mà dịch mốc
// thì phiên sống vĩnh viễn và con số 30 ngày thành vô nghĩa.
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86400_000;

/** Quản trị không hết hạn (họ cần vào bất cứ lúc nào để cấp tài khoản). */
const sessionExempt = (a) => !!a?.superuser || a?.role === 'admin';

/** Mốc hết hạn, hoặc null nếu phiên này không hết hạn. */
export function sessionExpiresAt() {
    const a = getAuth();
    if (!a?.token || !a.loginAt || sessionExempt(a)) return null;
    return a.loginAt + SESSION_MS;
}

export function sessionExpired() {
    const at = sessionExpiresAt();
    return at != null && Date.now() > at;
}

/** Số ngày còn lại, null nếu không hết hạn. Để UI nhắc trước khi người dùng ra công trường. */
export function sessionDaysLeft() {
    const at = sessionExpiresAt();
    return at == null ? null : Math.max(0, Math.ceil((at - Date.now()) / 86400_000));
}

export function myRole() { return getAuth()?.role || ''; }
/** Quản trị ứng dụng: cấp tài khoản, gán team. KHÔNG phải superuser (không sửa được schema). */
export function isAdmin() { return isSuperuser() || myRole() === 'admin'; }

/**
 * Tìm-hoặc-tạo record `users` cùng email — danh tính để GHI dữ liệu (owner, team.members)
 * khi phiên đăng nhập thực tế là superuser (bảng `_superusers`, không thuộc `users`).
 */
async function resolveIdentity(email) {
    const found = await api(`collections/users/records?perPage=1&${q(`email='${esc(email)}'`)}`);
    if (found.items?.length) return found.items[0];
    const password = randomPassword();
    const local = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g, '') || 'user';
    return api('collections/users/records', {
        method: 'POST',
        body: JSON.stringify({
            email, password, passwordConfirm: password,
            username: `${local}${Math.random().toString(36).slice(2, 6)}`,
            emailVisibility: true, verified: true,
        }),
    });
}

async function ensureTeamMembership(teamId, identityId) {
    if (!teamId || !identityId) return;
    try {
        const rec = await api(`collections/${TEAMS}/records/${teamId}`);
        if (!(rec.members || []).includes(identityId)) {
            await api(`collections/${TEAMS}/records/${teamId}`, {
                method: 'PATCH',
                body: JSON.stringify({ members: [...(rec.members || []), identityId] }),
            });
        }
    } catch (err) { console.warn('ensureTeamMembership:', err.message); }
}

/**
 * Nạp danh tính-ghi-dữ-liệu (nếu superuser) + toàn bộ team. Không throw — mọi lỗi ở đây
 * chỉ làm app chạy chế độ hạn chế hơn (riêng tư / chưa sync được), không chặn đăng nhập.
 */
async function resolveIdentityAndTeams(email, superuser) {
    if (superuser && !getAuth()?.identityId) {
        try {
            const identity = await resolveIdentity(email);
            saveAuth({ identityId: identity.id, identityName: identity.name || identity.username || identity.email });
        } catch (err) { console.warn('resolveIdentity:', err.message); }
    }
    let teams = myTeams();
    try {
        const res = await api(`collections/${TEAMS}/records?perPage=200&sort=name`);
        // `mine` là thứ myTeam() dựa vào để không gán dự án vào team mình không ở trong.
        const uid = getAuth()?.identityId || getAuth()?.model?.id || null;
        teams = (res.items || []).map(t => ({
            id: t.id, name: t.name, slug: t.slug,
            mine: !!uid && (t.members || []).includes(uid),
        }));
        saveAuth({ teams });
        saveAuth({ team: myTeam() });   // sau khi teams đã lưu, myTeam() mới chọn đúng
    } catch { /* chưa dựng collection teams, hoặc lỗi mạng — giữ cache cũ */ }
    const identityId = getAuth()?.identityId;
    if (superuser && identityId) {
        const primary = teams.find(t => t.slug === TEAM_SLUG) || teams[0];
        if (primary) await ensureTeamMembership(primary.id, identityId);
    }
    return teams;
}

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
    saveAuth({
        token: data.token, model: data.record, superuser,
        role: superuser ? '' : (data.record.role || ''),
        loginAt: Date.now(),
        team: null, teams: [], identityId: null, identityName: null,
    });
    await resolveIdentityAndTeams(data.record.email, superuser);
    return data.record;
}

/**
 * Đăng nhập bằng tên ngắn (username) hoặc email, với PIN hoặc mật khẩu thật.
 * Toàn số 4–8 ký tự thì thử PIN trước rồi mới rơi về mật khẩu thô — nhờ vậy Founder
 * vẫn vào được bằng mật khẩu superuser cũ mà không cần hai ô nhập khác nhau.
 */
export async function loginSmart(identity, secret) {
    const s = String(secret ?? '');
    if (isPin(s)) {
        try {
            return await login(identity, pinToPassword(s));
        } catch (err) {
            if (err.status !== 400) throw err;   // lỗi mạng/server thì đừng thử lại vô ích
        }
    }
    try {
        return await login(identity, s);
    } catch (err) {
        if (err.status !== 400) throw err;
        const hint = await emptyBackendHint();
        throw hint ? new PbError(hint, 400) : err;
    }
}

/**
 * PocketBase cố tình trả cùng một lỗi "Failed to authenticate" cho cả sai mật khẩu lẫn
 * tài khoản không tồn tại (chống dò tên tài khoản). Hệ quả: khi backend chưa cấp tài
 * khoản nào, người dùng thấy "Sai tài khoản hoặc mật khẩu" và cứ thử lại PIN hàng chục
 * lần — trong khi việc cần làm hoàn toàn khác. Chỉ chạy SAU khi đã thất bại nên luồng
 * đăng nhập bình thường không tốn thêm request nào.
 */
async function emptyBackendHint() {
    try {
        const res = await api('collections/users/records?perPage=1&fields=id', {}, 1);
        if (Array.isArray(res?.items) && (res.totalItems || 0) === 0) {
            return 'Hệ thống chưa có tài khoản nào. Đăng nhập bằng tài khoản superuser của '
                + 'PocketBase, rồi vào Cài đặt → Quản lý team & người dùng → Dựng ngay → '
                + 'Cấp sẵn tổ khảo sát.';
        }
    } catch {
        // Đọc bị chặn = backend đã dựng xong và rule đang chạy → không kết luận gì thêm.
    }
    return null;
}

/**
 * Tự đổi PIN. PocketBase thu hồi mọi token khi mật khẩu đổi, nên phải đăng nhập lại
 * ngay trong cùng một lượt — không thì phiên chết giữa lúc đang đo ngoài công trường.
 */
export async function changePin(oldPin, newPin) {
    if (!isLoggedIn()) throw new PbError('Chưa đăng nhập', 401);
    if (isSuperuser()) {
        throw new PbError('Tài khoản superuser đổi mật khẩu trong PocketBase Admin, không đổi ở đây', 400);
    }
    if (String(oldPin) === String(newPin)) throw new PbError('PIN mới phải khác PIN cũ', 400);
    const newPass = pinToPassword(newPin);
    const id = myId();
    if (!id) throw new PbError('Không xác định được tài khoản đang đăng nhập', 400);
    await api(`collections/users/records/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
            oldPassword: pinToPassword(oldPin),
            password: newPass,
            passwordConfirm: newPass,
        }),
    }, 1);
    const ident = me()?.username || me()?.email;
    await login(ident, newPass);
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
    // Kiểm hạn TRƯỚC cả throttle: hết 30 ngày thì phải đá ra ngay, không đợi lượt kiểm sau.
    if (sessionExpired()) {
        logout();
        return false;
    }
    const token = getAuth().token;
    // Throttle theo CẢ thời gian và token: token đổi (đăng nhập lại, hoặc bản lưu bị
    // thay từ tab khác) thì phải xác thực lại ngay, không ăn theo lần kiểm trước.
    if (!force && verifiedToken === token && Date.now() - sessionCheckedAt < 10 * 60_000) return true;
    // Phiên superuser phải refresh ở đúng bảng của nó, không thì bị 401 và đá ra ngay khi boot.
    const col = isSuperuser() ? '_superusers' : 'users';
    try {
        const res = await api(`collections/${col}/auth-refresh`, { method: 'POST' }, 2);
        if (!res?.token || !res?.record) {
            // Phản hồi 200 nhưng sai hình dạng mong đợi — KHÔNG được ghi đè token tốt đang
            // có bằng `undefined`: saveAuth merge xong, JSON.stringify âm thầm xóa mất key
            // đó khỏi bản lưu, và người dùng bị đăng xuất ngầm mà không có lỗi nào cả.
            console.warn('ensureSession: phản hồi auth-refresh bất thường', res);
            return true; // coi như lỗi mạng — giữ phiên cũ, thử lại lần sau
        }
        // Cập nhật cả `role` — Founder cấp quyền quản trị cho ai đó thì máy họ nhận được
        // ở lượt gia hạn kế tiếp, không phải đăng xuất/đăng nhập lại. `loginAt` giữ nguyên:
        // gia hạn token KHÔNG được dịch mốc 30 ngày (xem sessionExpiresAt).
        saveAuth({
            token: res.token, model: res.record, superuser: isSuperuser(),
            role: isSuperuser() ? '' : (res.record.role || ''),
        });
        sessionCheckedAt = Date.now();
        verifiedToken = res.token;
        return true;
    } catch (err) {
        if (err.status === 401) return false; // api() đã logout
        return true; // lỗi mạng — đừng đá người dùng ra, thử lại lần sau
    }
}

/** Nạp lại danh sách team (dùng khi Founder mới thêm mình vào team, hoặc mới tạo team mới). */
export async function refreshTeam() {
    if (!isLoggedIn()) return null;
    const teams = await resolveIdentityAndTeams(me()?.email, isSuperuser());
    return teams[0] || null;
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

/**
 * Chạy song song có giới hạn.
 *
 * Sync trước đây gọi từng request MỘT, nối đuôi nhau: 100 doc × ~0.4s = gần một phút
 * chỉ để chờ mạng, trong khi băng thông nằm không. Nó còn làm mọi màn hình khác (xem
 * team, kiểm tra đồng bộ) phải xếp hàng phía sau nên cảm giác là "app treo".
 *
 * Giới hạn 6 vì trình duyệt cũng chỉ mở khoảng 6 kết nối cho mỗi host — đặt cao hơn
 * không nhanh thêm, chỉ dồn thêm việc vào hàng đợi. `fn` phải TỰ bắt lỗi của nó; ném
 * ra ngoài sẽ làm các worker còn lại chạy mồ côi.
 */
const SYNC_LIMIT = 6;

export async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            out[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

/** Trả về danh sách metadata để UI so sánh local ↔ cloud (rẻ, không tải data). */
export async function fetchRemoteStatus() {
    if (!isLoggedIn()) return { items: [], account: null, team: null };
    const { items, legacy } = await fetchMeta();
    return {
        account: me()?.email || me()?.username || '(unknown)',
        team: myTeam(),
        legacy,
        totalRemote: items.length,
        myTeamId: myTeam()?.id || null,
        items: items.map(r => ({
            item_id: r.item_id,
            kind: r.kind,
            project_id: r.project_id,
            name: r.name,
            owner: r.owner,
            ownerName: r.owner_name || '',
            scope: r.scope || SCOPE_DEFAULT,
            // Giá trị THÔ, chưa áp mặc định. `scope` ở trên đã bị mặc định hoá thành
            // 'team' nên nhìn vào nó thì record hỏng vẫn có vẻ đúng — đúng cái bẫy làm
            // dự án hiện "Team MKG" trên máy chủ sở hữu mà đồng nghiệp không đọc được.
            rawScope: r.scope || '',
            team: r.team || '',
            deleted: !!r.deleted,
            updatedAt: r.updated_ms || 0,
        })),
    };
}

// ===== Push =====
function buildPayload({ kind, item, scope, teamId, legacy }) {
    const isPhoto = kind === 'doc' && item.type === 'photo';
    const base = {
        owner: ownerId(),
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
            owner_name: ownerName(),
            scope: scope || SCOPE_DEFAULT,
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
    if (navigator.onLine === false) throw new PbError('Không có mạng', 0);
    if (!(await ensureSession())) throw new PbError('Phiên đăng nhập hết hạn — vui lòng đăng nhập lại', 401);
    // Superuser cần một danh tính trong bảng `users` để ghi được owner (xem resolveIdentity).
    // login()/refreshTeam() đã thử việc này; nếu lần đó lỗi mạng thì thử lại một lần ở đây
    // thay vì chặn cứng — chỉ báo lỗi khi vẫn không có sau khi thử lại.
    if (isSuperuser() && !getAuth()?.identityId) {
        await resolveIdentityAndTeams(me()?.email, true).catch(() => {});
        if (!getAuth()?.identityId) {
            throw new PbError('Không tạo được tài khoản đồng bộ cho quản trị viên trong bảng `users`. '
                + 'Kiểm tra kết nối mạng rồi thử đồng bộ lại.', 500);
        }
    }

    const uid = ownerId();
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

    // Chưa biết team thì nạp lại NGAY, trước khi tính payload. Đây là cái bẫy đã làm
    // đồng nghiệp không thấy dữ liệu: máy đăng nhập lúc collection `teams` chưa tồn tại
    // sẽ đẩy mọi dự án lên với team rỗng, rule đọc theo team không khớp, và không có
    // lỗi nào hiện ra vì bản thân việc đẩy vẫn thành công.
    if (!myTeam()) await refreshTeam().catch(() => {});
    const defaultTeamId = myTeam()?.id || null;
    // Vẫn không có team sau khi nạp lại → những dự án này lên cloud nhưng KHÔNG ai
    // ngoài chủ sở hữu đọc được. Phải báo, không được im lặng.
    const orphanTeam = defaultTeamId ? [] : local.projects
        .filter(pr => (pr.scope || SCOPE_DEFAULT) === 'team' && !pr.teamId)
        .map(pr => pr.name || String(pr.id));
    const scopeOfProject = new Map(local.projects.map(pr => [String(pr.id), pr.scope || SCOPE_DEFAULT]));
    // Team CỤ THỂ của từng dự án — dự án cũ chưa từng chọn team thì dùng team chính làm
    // mặc định, giữ nguyên hành vi một-team hiện tại.
    const teamIdOfProject = new Map(local.projects.map(pr => [String(pr.id), pr.teamId || defaultTeamId]));
    const localMap = new Map([
        ...local.projects.map(pr => [String(pr.id), {
            kind: 'project', item: pr, scope: pr.scope || SCOPE_DEFAULT, teamId: pr.teamId || defaultTeamId,
        }]),
        ...local.docs.map(d => [String(d.id), {
            kind: 'doc', item: d, scope: scopeOfProject.get(String(d.projectId)) || SCOPE_DEFAULT,
            teamId: teamIdOfProject.get(String(d.projectId)) || defaultTeamId,
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
    let delDone = 0;
    await mapLimit(local.tombstones, SYNC_LIMIT, async (t) => {
        const rec = remoteByItem.get(t.item_id)?.find(r => r.owner === uid) || remoteByItem.get(t.item_id)?.[0];
        if (!rec) {
            // Chưa từng lên cloud. Giữ tombstone (db.js tự dọn sau 90 ngày) để nếu máy
            // khác đẩy item này lên thì lần sync sau ta vẫn xóa được.
            return;
        }
        if (rec.deleted) { clearedTombstones.push(t.item_id); return; }
        if ((rec.updated_ms || 0) > t.deletedAt) { clearedTombstones.push(t.item_id); return; } // cloud mới hơn → thắng
        p(`Đang xóa trên cloud ${++delDone}/${local.tombstones.length}...`);
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
    });

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
            // So với giá trị THÔ, không dùng mặc định: record chưa có scope (dữ liệu cũ
            // hoặc script backfill bỏ sót) phải được đẩy một lần để ghi scope vào, nếu
            // không thì rule đọc theo team `scope = "team"` sẽ không khớp và đồng nghiệp
            // vẫn không thấy dự án.
            (rec.scope || '') !== loc.scope ||
            // Chuyển dự án sang team KHÁC (nhiều team) — id team lệch dù scope vẫn 'team'.
            (loc.scope === 'team' && (rec.team || '') !== (loc.teamId || ''))
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
    let pullDone = 0;
    await mapLimit(toPull, SYNC_LIMIT, async (rec) => {
        try {
            const full = legacy && rec._data ? { data: rec._data, ...rec } : await api(`collections/${COL}/records/${rec.id}`);
            const data = full.data;
            if (!data || typeof data !== 'object') return;
            const item = { ...data, ownerId: rec.owner, ownerName: rec.owner_name || '' };
            if (rec.kind === 'project') {
                item.scope = rec.scope || SCOPE_DEFAULT;
                item.teamId = rec.team || null;
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
        } finally {
            // Đếm theo việc ĐÃ XONG, không theo chỉ số vòng lặp: chạy song song thì thứ
            // tự hoàn thành không còn khớp thứ tự trong danh sách.
            p(`Đang tải về ${++pullDone}/${toPull.length}...`);
        }
    });

    // ===== 4. Push =====
    let pushed = 0;
    let migrated = 0;
    const failedIds = [];
    const scopeSynced = new Set();
    let pushDone = 0;
    await mapLimit(toPush, SYNC_LIMIT, async ({ kind, item, scope, teamId, rec, reason }) => {
        const { fields, photoDataUrl } = buildPayload({ kind, item, scope, teamId, legacy });
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
        } finally {
            p(`Đang đẩy lên ${++pushDone}/${toPush.length}...`);
        }
    });
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
        orphanTeam,
        legacy,
    };
}

// ===== Link chia sẻ =====
// Payload nằm trên server, không nhúng vào URL → link chỉ ~35 ký tự, gửi Zalo/Messenger
// được, và thu hồi được bất cứ lúc nào.
export async function createShare({ projectId, title, payload, days }) {
    if (!isLoggedIn()) throw new PbError('Cần đăng nhập để tạo link chia sẻ', 401);
    const body = {
        owner: ownerId(),
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
    const filter = projectId ? `project_id='${esc(projectId)}'` : `owner='${esc(ownerId())}'`;
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

// ===== Quản lý team & thành viên (chỉ superuser — xem createRule/updateRule của `teams`) =====
// Hai thao tác PATCH-team (thêm/xoá thành viên) và tạo `users` record đều cần bỏ qua API
// rule, nên chỉ chạy được khi phiên hiện tại là superuser. Rule phía server đã khoá việc
// này (teams.createRule/updateRule = null); check ở đây chỉ để báo lỗi sớm, gọn hơn.
function requireSuperuser() {
    if (!isSuperuser()) throw new PbError('Thao tác này cần tài khoản superuser của PocketBase', 403);
}

/**
 * Quản người (tạo tài khoản, gán team) mở cho cả `role=admin`, không đòi superuser.
 * Đây là chỗ tách hai tầng quyền: quản trị ứng dụng cấp được tài khoản, nhưng KHÔNG
 * sửa được cấu trúc dữ liệu và không đọc được thẳng cơ sở dữ liệu.
 */
function requireAdmin() {
    if (!isAdmin()) throw new PbError('Chỉ tài khoản quản trị mới thực hiện được thao tác này', 403);
}

/** Toàn bộ team (thành viên thường chỉ thấy team của mình; superuser thấy tất cả). */
export async function listTeams() {
    if (!isLoggedIn()) return [];
    const res = await api(`collections/${TEAMS}/records?perPage=200&sort=name`);
    return (res.items || []).map(t => ({ id: t.id, name: t.name, slug: t.slug, memberCount: (t.members || []).length }));
}

export async function createTeam(name) {
    requireAdmin();
    const clean = (name || '').trim();
    if (!clean) throw new PbError('Tên team không được để trống', 400);
    const base = clean.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'team';
    const rec = await api(`collections/${TEAMS}/records`, {
        method: 'POST',
        // Hậu tố ngẫu nhiên: slug có unique index, tránh phải kiểm trùng trước khi tạo.
        body: JSON.stringify({ name: clean, slug: `${base}-${Math.random().toString(36).slice(2, 6)}`, members: [] }),
    });
    return { id: rec.id, name: rec.name, slug: rec.slug };
}

/**
 * Danh sách thành viên kèm email/tên. `expand` bị chặn bởi viewRule của `users` khi người
 * gọi không phải superuser (thành viên thường không đọc được record của nhau) — khi đó vẫn
 * trả về id để UI không trống trơn, chỉ thiếu tên hiển thị.
 */
export async function getTeamMembers(teamId) {
    const rec = await api(`collections/${TEAMS}/records/${teamId}?expand=members`);
    const expanded = rec.expand?.members;
    if (Array.isArray(expanded) && expanded.length === (rec.members || []).length) {
        return expanded.map(u => ({ id: u.id, email: u.email || '', name: u.name || u.username || u.email || u.id }));
    }
    return (rec.members || []).map(id => ({ id, email: '', name: '(ẩn — cần quyền quản trị để xem)' }));
}

/**
 * Thêm người vào team — tự tạo tài khoản `users` nếu email chưa có, hoặc gắn tài khoản có
 * sẵn vào team. password bỏ trống → tự sinh ngẫu nhiên, TRẢ VỀ MỘT LẦN để admin copy gửi;
 * PocketBase không cho đọc lại mật khẩu sau khi tạo.
 */
export async function addTeamMember(teamId, email, opts = {}) {
    requireAdmin();
    const clean = (email || '').trim().toLowerCase();
    if (!clean.includes('@')) throw new PbError('Email không hợp lệ', 400);
    // Admin gõ 4 số thì phải hiểu là PIN, y như màn đăng nhập — nếu không, tài khoản tạo
    // ra có mật khẩu thô "1111" mà PocketBase từ chối, hoặc "11111111" lệch cơ chế PIN.
    const raw = (opts.password || '').trim();
    const password = raw ? (isPin(raw) ? pinToPassword(raw) : raw) : randomPassword(12);
    if (password.length < PASSWORD_MIN) {
        throw new PbError(`PIN phải từ ${PIN_MIN} chữ số, hoặc mật khẩu từ ${PASSWORD_MIN} ký tự`, 400);
    }
    const found = await api(`collections/users/records?perPage=1&${q(`email='${esc(clean)}'`)}`);
    let user, created = false;
    if (found.items?.length) {
        user = found.items[0];
    } else {
        const local = (clean.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g, '') || 'user';
        user = await api('collections/users/records', {
            method: 'POST',
            body: JSON.stringify({
                email: clean, password, passwordConfirm: password,
                name: (opts.name || '').trim(),
                username: `${local}${Math.random().toString(36).slice(2, 6)}`,
                emailVisibility: true, verified: true,
            }),
        });
        created = true;
    }
    const team = await api(`collections/${TEAMS}/records/${teamId}`);
    if (!(team.members || []).includes(user.id)) {
        await api(`collections/${TEAMS}/records/${teamId}`, {
            method: 'PATCH',
            body: JSON.stringify({ members: [...(team.members || []), user.id] }),
        });
    }
    // Trả về thứ admin sẽ ĐỌC CHO người dùng nghe: PIN gốc, không phải chuỗi đã nở.
    return { userId: user.id, email: user.email, created, password: created ? (raw || password) : null };
}

export async function removeTeamMember(teamId, userId) {
    requireAdmin();
    const team = await api(`collections/${TEAMS}/records/${teamId}`);
    await api(`collections/${TEAMS}/records/${teamId}`, {
        method: 'PATCH',
        body: JSON.stringify({ members: (team.members || []).filter(id => id !== userId) }),
    });
}

// ===== Dựng schema backend ngay trong app (chỉ superuser) =====
// Dùng PocketBase JS SDK cho thao tác schema — cleaner API, tự retry 429.
// Idempotent: bấm lại nhiều lần vẫn an toàn, mỗi bước kiểm "đã có thì bỏ qua".
import PocketBase from 'pocketbase';

const F = {
    id: (pattern = '[a-z0-9]{15}', len = 15, charset = 'a-z0-9') => ({
        name: 'id', type: 'text', system: true, primaryKey: true, required: true,
        autogeneratePattern: pattern, pattern: `^[${charset}]+$`, min: len, max: len,
    }),
    date: (name, onUpdate) => ({ name, type: 'autodate', onCreate: true, onUpdate }),
    text: (name, max = 255, required = false) => ({ name, type: 'text', max, required }),
    num: (name) => ({ name, type: 'number', onlyInt: true }),
    bool: (name) => ({ name, type: 'bool' }),
    rel: (name, collectionId, maxSelect, cascadeDelete = false, required = false) =>
        ({ name, type: 'relation', collectionId, maxSelect, minSelect: 0, cascadeDelete, required }),
};

const READ_RULE = 'owner = @request.auth.id || (scope = "team" && team.members.id ?= @request.auth.id)';
const OWNER_GUARD = '(@request.body.owner:isset = false || @request.body.owner = owner)';
const WRITE_RULE = `(${READ_RULE}) && ${OWNER_GUARD}`;

const WANT_INDEXES = [
    'CREATE UNIQUE INDEX `idx_si_owner_item` ON `survey_items` (`owner`, `item_id`)',
    'CREATE INDEX `idx_si_updated_ms` ON `survey_items` (`updated_ms`)',
    'CREATE INDEX `idx_si_scope_team` ON `survey_items` (`scope`, `team`)',
];
const idxName = (sql) => sql.match(/INDEX\s+`?(\w+)`?/i)?.[1];

// ===== Hai tầng quyền =====
// `role = "admin"` cấp được tài khoản và gán team, nhưng KHÔNG sửa được schema và
// không đọc thẳng cơ sở dữ liệu — việc đó vẫn phải là superuser. Nhờ vậy tài khoản
// quản trị dùng PIN 4 số không kéo theo toàn quyền cơ sở dữ liệu.
const IS_ADMIN = '@request.auth.role = "admin"';
// Người dùng tự sửa record của mình, nhưng KHÔNG tự nâng mình lên admin.
const USERS_SELF = `(id = @request.auth.id && (@request.body.role:isset = false || @request.body.role = role))`;
const USERS_RULES = {
    listRule: `id = @request.auth.id || ${IS_ADMIN}`,
    viewRule: `id = @request.auth.id || ${IS_ADMIN}`,
    createRule: IS_ADMIN,
    updateRule: `${USERS_SELF} || ${IS_ADMIN}`,
    deleteRule: IS_ADMIN,
};
const TEAMS_RULES = {
    listRule: `members.id ?= @request.auth.id || ${IS_ADMIN}`,
    viewRule: `members.id ?= @request.auth.id || ${IS_ADMIN}`,
    createRule: IS_ADMIN,
    updateRule: IS_ADMIN,
    deleteRule: IS_ADMIN,
};

function makePbClient() {
    const pb = new PocketBase(BASE);
    const auth = getAuth();
    if (auth?.token) pb.authStore.save(auth.token, auth.model || {});
    return pb;
}

/**
 * Bóc lý do THẬT ra khỏi lỗi của SDK.
 *
 * SDK chỉ đặt `message` là câu chung chung kiểu "Failed to update collection." — lý do
 * nằm trong `response.data`, lồng theo từng field: {fields:{"3":{name:{message:"..."}}}}.
 * Không bóc ra thì người dùng chỉ thấy "thất bại" và không ai đoán nổi cột nào sai.
 */
function sdkMsg(err) {
    const body = err?.response || err?.data || {};
    const base = body.message || err?.message || 'Lỗi không rõ';
    const parts = [];
    const walk = (obj, prefix) => {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
            const path = prefix ? `${prefix}.${k}` : k;
            if (typeof v?.message === 'string') parts.push(`${path}: ${v.message}`);
            else if (v && typeof v === 'object') walk(v, path);
        }
    };
    walk(body.data, '');
    return parts.length ? `${base} — ${parts.join('; ')}` : base;
}

async function listAllRecords(col, fields) {
    const out = [];
    for (let page = 1; ; page++) {
        const res = await api(`collections/${col}/records?page=${page}&perPage=500${fields ? `&fields=${fields}` : ''}`);
        out.push(...(res.items || []));
        if (page >= (res.totalPages || 1)) break;
    }
    return out;
}

/** Xem backend còn thiếu gì. Không sửa gì cả. */
export async function inspectBackend() {
    requireSuperuser();
    const all = await api('collections?perPage=200');
    const byName = new Map((all.items || []).map(c => [c.name, c]));
    const users = byName.get('users');
    const survey = byName.get(COL);
    if (!users) {
        throw new PbError(
            `Không tìm thấy collection users trên ${BASE}. `
            + 'Tài khoản này đang thấy một project PocketBase khác.', 404);
    }
    const have = new Set((survey?.fields || []).map(f => f.name));
    const haveIdx = new Set((survey?.indexes || []).map(idxName));
    return {
        surveyExists: !!survey,
        teams: !!byName.get(TEAMS),
        shares: !!byName.get(SHARES),
        missingFields: survey
            ? ['scope', 'team', 'updated_ms', 'deleted', 'rev', 'schema_v', 'photo', 'photo_hash', 'owner_name']
                .filter(n => !have.has(n))
            : [],
        missingIndexes: WANT_INDEXES.map(idxName).filter(n => !haveIdx.has(n)),
        rulesOk: !!survey && survey.listRule === READ_RULE && survey.updateRule === WRITE_RULE,
        userCount: null,
    };
}

/**
 * Dựng đầy đủ schema v3 qua PocketBase SDK. onProgress(text) để UI hiện tiến độ.
 * Trả về mảng dòng log để hiện lại cho người dùng.
 * Hoạt động cả khi survey_items chưa tồn tại (fresh install) lẫn khi đã có nhưng thiếu cột.
 */
export async function provisionBackend(onProgress, onBackup) {
    requireSuperuser();
    const log = [];
    const warnings = [];
    const say = (s) => { log.push(s); onProgress?.(s); };
    // Bước phụ hỏng thì GHI LẠI rồi đi tiếp. Bỏ dở cả lượt vì một cột không thêm được
    // là mất luôn phần teams/shares — đúng thứ đang chặn việc tạo tài khoản.
    const warn = (step, err) => {
        const m = `⚠ ${step}: ${sdkMsg(err)}`;
        warnings.push(m);
        log.push(m);
        onProgress?.(m);
    };

    const pb = makePbClient();

    // Tải toàn bộ schema hiện tại qua SDK
    let allCols;
    try {
        allCols = await pb.collections.getFullList({ batch: 200 });
    } catch (err) {
        throw new PbError(`Không đọc được cấu trúc PocketBase: ${sdkMsg(err)}`, err.status || 0);
    }

    // Tải bản sao TRƯỚC khi sửa — thao tác trên dữ liệu thật, file này để khôi phục.
    if (onBackup) {
        try {
            onBackup(JSON.stringify(allCols, null, 2));
            say('Đã tải bản sao cấu trúc cũ về máy');
        } catch (err) { console.warn('backup schema:', err.message); }
    }

    const byName = new Map(allCols.map(c => [c.name, c]));
    let usersCol = byName.get('users');
    if (!usersCol) {
        throw new PbError('Không tìm thấy collection users — sai project PocketBase', 404);
    }

    // ===== 0. users: cột role/username, đăng nhập bằng tên ngắn, token 30 ngày =====
    // `username` bị bỏ khỏi collection users mặc định từ PocketBase 0.23, nên phải tự
    // thêm lại — không có nó thì không đăng nhập được bằng tên ngắn, chỉ còn gõ email.
    {
        const have = new Set(usersCol.fields.map(f => f.name));
        const addU = [];
        if (!have.has('role')) {
            addU.push({ name: 'role', type: 'select', values: ['admin'], maxSelect: 1 });
        }
        if (!have.has('username')) addU.push(F.text('username', 60));

        // BƯỚC 1 — thêm cột trước, RIÊNG một lượt. identityFields được PocketBase kiểm
        // theo cột đang có; gộp chung một lượt thì nó soi trạng thái cũ và từ chối vì
        // "username không tồn tại", làm hỏng cả lần dựng.
        //
        // Thêm TỪNG cột một: gộp cả hai mà một cột sai thì PocketBase từ chối cả lượt và
        // ta không biết cột nào có lỗi.
        let addedU = 0;
        for (const f of addU) {
            try {
                usersCol = await pb.collections.update(usersCol.id, {
                    fields: [...usersCol.fields, f],
                });
                addedU++;
                say(`users: thêm cột ${f.name}`);
            } catch (err) {
                warn(`users — thêm cột ${f.name}`, err);
            }
        }
        // Đọc lại từ collection VỪA trả về, không suy ra từ danh sách định thêm: cột nào
        // thêm hụt thì bước sau phải biết, nếu không nó khai username làm identityField
        // trong khi cột không tồn tại và PocketBase đổ cả lượt.
        const hasUsername = usersCol.fields.some(f => f.name === 'username');

        // Unique index cho username: chỉ áp cho hàng CÓ username. Index unique thường sẽ
        // đổ ngay nếu backend đang có từ hai tài khoản username rỗng trở lên — SQLite coi
        // hai chuỗi rỗng là trùng nhau (khác với NULL).
        const uIdx = new Set((usersCol.indexes || []).map(idxName));
        const newUIdx = uIdx.has('idx_users_username')
            ? []
            : ["CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`) WHERE `username` != ''"];

        const ident = usersCol.passwordAuth?.identityFields || ['email'];
        // Không có cột username thì tuyệt đối KHÔNG khai nó là identityField — PocketBase
        // sẽ từ chối cả lượt, và người dùng mất luôn phần rule đi kèm.
        const wantIdent = hasUsername ? [...new Set([...ident, 'username'])] : ident;
        const identChanged = wantIdent.length !== ident.length;
        const tokenChanged = usersCol.authToken?.duration !== SESSION_DAYS * 86400;
        const rulesChanged = usersCol.listRule !== USERS_RULES.listRule;

        // BƯỚC 2 — giờ cột đã có thật, mới bật đăng nhập bằng tên ngắn.
        if (newUIdx.length || identChanged || tokenChanged || rulesChanged) {
            try {
                usersCol = await pb.collections.update(usersCol.id, {
                    indexes: [...(usersCol.indexes || []), ...newUIdx],
                    passwordAuth: { ...(usersCol.passwordAuth || {}), enabled: true, identityFields: wantIdent },
                    authToken: { ...(usersCol.authToken || {}), duration: SESSION_DAYS * 86400 },
                    ...USERS_RULES,
                });
                say(`users: đăng nhập bằng ${wantIdent.join('/')}, phiên ${SESSION_DAYS} ngày, quyền quản trị`);
            } catch (err) {
                // Thử lại KHÔNG kèm index — unique index là thứ hay đổ nhất khi dữ liệu
                // sẵn có đã trùng, mà rule + hạn phiên thì quan trọng hơn nhiều.
                try {
                    usersCol = await pb.collections.update(usersCol.id, {
                        passwordAuth: { ...(usersCol.passwordAuth || {}), enabled: true, identityFields: wantIdent },
                        authToken: { ...(usersCol.authToken || {}), duration: SESSION_DAYS * 86400 },
                        ...USERS_RULES,
                    });
                    say(`users: đặt quyền + phiên ${SESSION_DAYS} ngày (bỏ qua unique index username)`);
                } catch (err2) {
                    warn('users — đặt quyền và hạn phiên', err2);
                }
            }
        } else if (!addedU) {
            say('users: đã đủ cột và quyền');
        }
    }

    // ===== 1. teams =====
    let teamsCol = byName.get(TEAMS);
    if (teamsCol) {
        if (teamsCol.listRule !== TEAMS_RULES.listRule) {
            try {
                teamsCol = await pb.collections.update(teamsCol.id, TEAMS_RULES);
                say('Collection teams: cập nhật quyền cho tài khoản quản trị');
            } catch (err) {
                warn('teams — cập nhật quyền', err);
            }
        } else {
            say('Collection teams: đã có');
        }
    } else {
        teamsCol = await pb.collections.create({
            name: TEAMS, type: 'base',
            fields: [
                F.id(), F.text('name', 120, true), F.text('slug', 60, true),
                F.rel('members', usersCol.id, 500),
                F.date('created', false), F.date('updated', true),
            ],
            indexes: ['CREATE UNIQUE INDEX `idx_teams_slug` ON `teams` (`slug`)'],
            ...TEAMS_RULES,
        });
        say('Collection teams: đã tạo');
    }

    // ===== 2. shares =====
    if (byName.get(SHARES)) {
        say('Collection shares: đã có');
    } else {
        const sharesBody = {
            name: SHARES, type: 'base',
            fields: [
                F.id('[a-zA-Z0-9]{10}', 10, 'a-zA-Z0-9'),
                F.rel('owner', usersCol.id, 1, true, true),
                F.text('project_id', 60), F.text('title', 200),
                { name: 'payload', type: 'json', maxSize: 5_000_000 },
                { name: 'expires', type: 'date' }, F.bool('revoked'),
                F.date('created', false), F.date('updated', true),
            ],
            indexes: ['CREATE INDEX `idx_shares_owner` ON `shares` (`owner`)'],
            listRule: 'owner = @request.auth.id',
            viewRule: 'revoked = false && (expires = "" || expires > @now)',
            createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
            updateRule: 'owner = @request.auth.id',
            deleteRule: 'owner = @request.auth.id',
        };
        try {
            await pb.collections.create(sharesBody);
            say('Collection shares: đã tạo (mã 10 ký tự)');
        } catch {
            sharesBody.fields[0] = F.id();
            await pb.collections.create(sharesBody);
            say('Collection shares: đã tạo (mã 15 ký tự — bản PB cũ)');
        }
    }

    // ===== 3. survey_items: TẠO MỚI nếu chưa có, hoặc PATCH thêm cột còn thiếu =====
    let surveyCol = byName.get(COL);

    const V3_FIELDS = [
        { name: 'scope', type: 'select', values: ['private', 'team'], maxSelect: 1 },
        F.rel('team', teamsCol.id, 1),
        F.num('updated_ms'),
        F.bool('deleted'),
        F.num('rev'),
        F.num('schema_v'),
        {
            name: 'photo', type: 'file', maxSelect: 1, maxSize: 6_000_000, protected: true,
            mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], thumbs: [],
        },
        F.text('photo_hash', 64),
        F.text('owner_name', 120),
    ];

    const SURVEY_RULES = {
        listRule: READ_RULE, viewRule: READ_RULE,
        createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
        updateRule: WRITE_RULE,
        deleteRule: 'owner = @request.auth.id',
    };

    if (!surveyCol) {
        // Fresh install: tạo luôn với đầy đủ schema v3
        surveyCol = await pb.collections.create({
            name: COL, type: 'base',
            fields: [
                F.rel('owner', usersCol.id, 1, true, true),
                F.text('item_id', 60, true),
                F.text('kind', 20),
                F.text('project_id', 60),
                F.text('name', 255),
                { name: 'data', type: 'json', maxSize: 20_000_000 },
                ...V3_FIELDS,
                F.date('created', false), F.date('updated', true),
            ],
            indexes: WANT_INDEXES,
            ...SURVEY_RULES,
        });
        say(`Collection ${COL}: đã tạo mới với đầy đủ schema v3`);
    } else {
        // Patch: chỉ thêm những cột còn thiếu
        const existing = new Set(surveyCol.fields.map(f => f.name));
        const toAdd = V3_FIELDS.filter(f => !existing.has(f.name));

        const haveIdx = new Set((surveyCol.indexes || []).map(idxName));
        let newIndexes = WANT_INDEXES.filter(sql => !haveIdx.has(idxName(sql)));

        // Unique index (owner,item_id): kiểm trùng trước để không hỏng lượt PATCH
        if (newIndexes.some(sql => idxName(sql) === 'idx_si_owner_item')) {
            const recs = await listAllRecords(COL, 'id,owner,item_id');
            const seen = new Map();
            let dup = 0;
            for (const r of recs) {
                const k = `${r.owner}/${r.item_id}`;
                if (seen.has(k)) dup++; else seen.set(k, r.id);
            }
            if (dup > 0) {
                newIndexes = newIndexes.filter(sql => idxName(sql) !== 'idx_si_owner_item');
                say(`Bỏ qua unique index: có ${dup} bản ghi trùng (owner, item_id) — dọn trong PB Admin trước`);
            }
        }

        // BƯỚC 1 — CHỈ thêm cột, tuyệt đối không kèm rule.
        //
        // Đây là chỗ đã làm hỏng cả việc chia sẻ theo team: SURVEY_RULES tham chiếu
        // `scope` và `team.members.id`, mà PocketBase soi rule theo trạng thái HIỆN TẠI
        // của collection. Gửi cột mới và rule dùng chính cột đó trong một lượt thì nó
        // thấy `team` chưa tồn tại và từ chối TOÀN BỘ lượt — survey_items ở nguyên
        // schema cũ, app rơi về chế độ tương thích, và chế độ đó đẩy lên KHÔNG kèm
        // scope/team nên đồng nghiệp không bao giờ đọc được.
        if (toAdd.length) {
            try {
                surveyCol = await pb.collections.update(surveyCol.id, {
                    fields: [...surveyCol.fields, ...toAdd],
                });
                say(`survey_items: thêm ${toAdd.length} cột (${toAdd.map(f => f.name).join(', ')})`);
            } catch (err) {
                warn('survey_items — thêm cột', err);
            }
        }

        // BƯỚC 2 — giờ cột đã có thật, mới đặt rule và index.
        const nowHas = new Set(surveyCol.fields.map(f => f.name));
        const canTeamRule = nowHas.has('scope') && nowHas.has('team');
        if (!canTeamRule) {
            warn('survey_items — quyền theo team', new Error(
                'thiếu cột scope/team nên chưa đặt được quyền đọc chung team'));
        } else if (newIndexes.length || surveyCol.listRule !== READ_RULE) {
            try {
                await pb.collections.update(surveyCol.id, {
                    indexes: [...(surveyCol.indexes || []), ...newIndexes],
                    ...SURVEY_RULES,
                });
                say(`survey_items: đặt quyền đọc chung team, ${newIndexes.length} index`);
            } catch (err) {
                // Bỏ index ra thử lại: index chỉ để chạy nhanh, còn rule mới là thứ quyết
                // định đồng nghiệp có đọc được dữ liệu hay không.
                try {
                    await pb.collections.update(surveyCol.id, SURVEY_RULES);
                    say('survey_items: đặt quyền đọc chung team (bỏ qua index)');
                } catch (err2) {
                    warn('survey_items — đặt quyền', err2);
                }
            }
        } else {
            say('survey_items: đã đủ cột và quyền');
        }
    }

    // ===== 4. Team MKG + nạp toàn bộ user =====
    const users = await listAllRecords('users', 'id,email');
    const memberIds = users.map(u => u.id);
    const found = await api(`collections/${TEAMS}/records?perPage=1&${q(`slug='${TEAM_SLUG}'`)}`);
    let team;
    if (found.items?.length) {
        team = found.items[0];
        const missing = memberIds.filter(id => !(team.members || []).includes(id));
        if (missing.length) {
            await api(`collections/${TEAMS}/records/${team.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ members: [...new Set([...(team.members || []), ...memberIds])] }),
            });
            say(`Team MKG: thêm ${missing.length} thành viên`);
        } else {
            say(`Team MKG: đã có, ${memberIds.length} thành viên`);
        }
    } else {
        team = await api(`collections/${TEAMS}/records`, {
            method: 'POST',
            body: JSON.stringify({ name: 'MKG', slug: TEAM_SLUG, members: memberIds }),
        });
        say(`Team MKG: đã tạo với ${memberIds.length} thành viên`);
    }

    // ===== 5. Backfill record cũ (chỉ khi survey_items đã tồn tại trước) =====
    const recs = await listAllRecords(COL, 'id,item_id,updated_ms,scope,team,rev,schema_v,data,deleted');
    let done = 0;
    for (const r of recs) {
        const ms = Number(r.data?.updatedAt) || 0;
        const isDel = !!r.data?._deleted;
        const patch = {};
        if (!r.updated_ms && ms) patch.updated_ms = ms;
        if (!r.scope) patch.scope = SCOPE_DEFAULT;
        if (!r.team && SCOPE_DEFAULT === 'team') patch.team = team.id;
        if (!r.rev) patch.rev = 1;
        if (!r.schema_v) patch.schema_v = 2;
        if (isDel && !r.deleted) patch.deleted = true;
        if (!Object.keys(patch).length) continue;
        try {
            await api(`collections/${COL}/records/${r.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
            done++;
            if (done % 25 === 0) onProgress?.(`Đang cập nhật dữ liệu cũ: ${done}/${recs.length}`);
        } catch (err) {
            console.warn('backfill', r.id, err.message);
        }
    }
    if (recs.length) say(`Dữ liệu cũ: cập nhật ${done}/${recs.length} bản ghi`);

    // Nạp lại team vào phiên hiện tại để app dùng được ngay, không cần đăng nhập lại.
    await refreshTeam().catch(() => {});
    say(warnings.length
        ? `Xong nhưng có ${warnings.length} bước chưa đạt — xem chi tiết bên dưới`
        : 'Xong — đã sẵn sàng cấp tài khoản');
    return { log, warnings };
}

// ===== Cấp sẵn tài khoản cho tổ khảo sát =====
// PIN giao ban đầu dùng chung để phát cho nhanh; mỗi người TỰ ĐỔI sau khi nhận máy
// (changePin). Chừng nào chưa ai đổi thì cột `owner` trên bản ghi chưa đáng tin, vì
// ai cũng đăng nhập được vào tên người khác — nên UI phải nhắc việc đổi PIN.
export const SEED_PIN_KTS = '1111';
export const SEED_PIN_ADMIN = '2222';
export const SEED_DOMAIN = 'mkg.vn';

export const SEED_USERS = [
    { username: 'kts1', name: 'KTS 1', pin: SEED_PIN_KTS },
    { username: 'kts2', name: 'KTS 2', pin: SEED_PIN_KTS },
    { username: 'kts3', name: 'KTS 3', pin: SEED_PIN_KTS },
    { username: 'kts4', name: 'KTS 4', pin: SEED_PIN_KTS },
    { username: 'admin', name: 'Quản trị', pin: SEED_PIN_ADMIN, role: 'admin' },
];

/**
 * Tạo sẵn 4 tài khoản KTS + 1 quản trị, nạp cả vào team MKG.
 *
 * Idempotent nhưng KHÔNG reset PIN của tài khoản đã tồn tại — ai đã đổi PIN riêng thì
 * bấm lại nút này không đá họ ra khỏi máy của chính họ. Trả về danh sách kèm PIN của
 * những tài khoản VỪA tạo, để admin copy đi giao một lần.
 */
export async function provisionUsers(onProgress) {
    requireAdmin();
    const p = (m) => onProgress?.(m);
    const out = [];

    // Team MKG phải có trước, vì tài khoản tạo ra là để vào đó.
    p('Đang kiểm team MKG...');
    let team;
    const foundTeam = await api(`collections/${TEAMS}/records?perPage=1&${q(`slug='${TEAM_SLUG}'`)}`);
    if (foundTeam.items?.length) {
        team = foundTeam.items[0];
    } else {
        team = await api(`collections/${TEAMS}/records`, {
            method: 'POST',
            body: JSON.stringify({ name: 'MKG', slug: TEAM_SLUG, members: [] }),
        });
    }

    for (const u of SEED_USERS) {
        const email = `${u.username}@${SEED_DOMAIN}`;
        p(`Đang tạo ${u.username}...`);
        // Tra theo CẢ username và email: tài khoản có thể đã tạo tay bằng một trong hai.
        let rec = null;
        try {
            const f = await api(`collections/users/records?perPage=1&${q(`username='${esc(u.username)}' || email='${esc(email)}'`)}`);
            rec = f.items?.[0] || null;
        } catch (err) {
            // `username` chưa có trên collection → lọc theo mỗi email.
            const f = await api(`collections/users/records?perPage=1&${q(`email='${esc(email)}'`)}`);
            rec = f.items?.[0] || null;
            console.warn('provisionUsers filter:', err.message);
        }

        if (rec) {
            // Chỉ vá phần THIẾU (tên, quyền admin), tuyệt đối không đụng tới mật khẩu.
            const patch = {};
            if (u.role && rec.role !== u.role) patch.role = u.role;
            if (!rec.name) patch.name = u.name;
            if (!rec.username) patch.username = u.username;
            if (Object.keys(patch).length) {
                rec = await api(`collections/users/records/${rec.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
            }
            out.push({ username: u.username, email, name: rec.name || u.name, role: rec.role || '', created: false, pin: null });
        } else {
            const password = pinToPassword(u.pin);
            const created = await api('collections/users/records', {
                method: 'POST',
                body: JSON.stringify({
                    email, password, passwordConfirm: password,
                    username: u.username, name: u.name,
                    ...(u.role ? { role: u.role } : {}),
                    emailVisibility: true, verified: true,
                }),
            });
            rec = created;
            out.push({ username: u.username, email, name: u.name, role: u.role || '', created: true, pin: u.pin });
        }

        if (rec && !(team.members || []).includes(rec.id)) {
            team = await api(`collections/${TEAMS}/records/${team.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ members: [...(team.members || []), rec.id] }),
            });
        }
    }

    await refreshTeam().catch(() => {});
    return { team: { id: team.id, name: team.name }, users: out };
}
