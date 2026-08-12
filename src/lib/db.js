// Local persistence — IndexedDB qua localforage. Offline-first: đây là nguồn sự thật,
// PocketBase (pb.js) chỉ là bản sao.
//
// LỚP USER: mỗi tài khoản có một IndexedDB database RIÊNG (`mkg-khaosat-<uid>`), nên
// user B đăng nhập trên cùng máy không thấy — và không đẩy lên cloud — dữ liệu của user A.
// Dữ liệu tạo khi chưa đăng nhập nằm ở store `anon` và được NHẬN (adopt) vào tài khoản
// đầu tiên đăng nhập, nếu tài khoản đó còn rỗng. Đăng xuất KHÔNG đổi store, nên dữ liệu
// vẫn thấy được trên máy như đã hứa với người dùng.
import localforage from 'localforage';

const PROJECTS_KEY = 'projects';
const DOC_INDEX_KEY = 'docidx';       // { [docId]: projectId }
const TOMBSTONES_KEY = 'tombstones';  // [{ item_id, kind, deletedAt }]
const PENDING_KEY = 'pending_push';   // [{ item_id, kind }]
const META_KEY = 'meta';              // { lastSyncAt, ... }

const ACTIVE_STORE_KEY = 'ks_store_id';   // localStorage: store đang mở ('anon' | uid)
const V2_MIGRATED_PREFIX = 'ks_v2_migrated_';
const TOMBSTONE_TTL = 90 * 24 * 3600 * 1000; // giữ 90 ngày rồi dọn

const instanceFor = (id) => localforage.createInstance({
    name: `mkg-khaosat-${id}`,
    storeName: 'ks',
    description: 'MKG Khao Sat local storage',
});

// Store v2 (trước khi có lớp user) — chỉ đọc, để di trú một lần.
const legacyStore = () => localforage.createInstance({ name: 'mkg-khaosat', storeName: 'ks_store' });

let store = null;
let storeId = null;

/** Store đang mở ('anon' hoặc uid). Gọi sau setAccount. */
export function activeStoreId() { return storeId; }

function ready() {
    if (!store) throw new Error('db.setAccount() chưa được gọi');
    return store;
}

async function allKeys(inst) {
    try { return await inst.keys(); } catch { return []; }
}

async function isEmpty(inst) {
    const projects = await inst.getItem(PROJECTS_KEY);
    if (projects?.length) return false;
    const idx = await inst.getItem(DOC_INDEX_KEY);
    return !idx || Object.keys(idx).length === 0;
}

async function copyAll(from, to) {
    const keys = await allKeys(from);
    for (const k of keys) {
        const v = await from.getItem(k);
        if (v !== null && v !== undefined) await to.setItem(k, v);
    }
    return keys.length;
}

/**
 * Mở store cho tài khoản `uid` (null = chưa đăng nhập → store 'anon').
 * Trả về { storeId, adopted, migratedV2 } để App có thể báo cho người dùng.
 */
export async function setAccount(uid) {
    const target = uid ? String(uid) : 'anon';
    const prev = localStorage.getItem(ACTIVE_STORE_KEY);
    const inst = instanceFor(target);
    let adopted = 0;
    let migratedV2 = 0;

    // 1. Di trú store v2 một lần cho mỗi store đích.
    const v2Flag = V2_MIGRATED_PREFIX + target;
    if (!localStorage.getItem(v2Flag)) {
        const legacy = legacyStore();
        if (!(await isEmpty(legacy)) && await isEmpty(inst)) {
            migratedV2 = await copyAll(legacy, inst);
        }
        localStorage.setItem(v2Flag, '1');
    }

    // 2. Nhận dữ liệu tạo lúc chưa đăng nhập vào tài khoản, nếu tài khoản còn rỗng.
    if (uid && prev === 'anon' && await isEmpty(inst)) {
        const anon = instanceFor('anon');
        if (!(await isEmpty(anon))) {
            adopted = await copyAll(anon, inst);
            // Xóa bản anon để không bị nhận lần hai vào tài khoản khác.
            for (const k of await allKeys(anon)) await anon.removeItem(k);
        }
    }

    store = inst;
    storeId = target;
    localStorage.setItem(ACTIVE_STORE_KEY, target);
    return { storeId: target, adopted, migratedV2 };
}

/** Store nào đang được dùng ở lần chạy trước — để boot đúng khi chưa đăng nhập. */
export function lastStoreId() { return localStorage.getItem(ACTIVE_STORE_KEY) || 'anon'; }

// ===== Projects (mảng meta object) =====
export async function loadProjects() {
    return (await ready().getItem(PROJECTS_KEY)) || [];
}

export async function saveProjects(projects) {
    await ready().setItem(PROJECTS_KEY, projects);
}

/**
 * Ghi project bằng hàm biến đổi, đọc-sửa-ghi trong cùng một lượt.
 * Chống mất dữ liệu khi sync (chạy lâu) và người dùng tạo dự án chen vào giữa.
 */
export async function mutateProjects(fn) {
    const cur = (await ready().getItem(PROJECTS_KEY)) || [];
    const next = fn(cur);
    await ready().setItem(PROJECTS_KEY, next);
    return next;
}

// ===== Docs (một key mỗi doc, index nhỏ để liệt kê) =====
async function loadIndex() {
    return (await ready().getItem(DOC_INDEX_KEY)) || {};
}

export async function getDoc(id) {
    return await ready().getItem(`doc_${id}`);
}

export async function putDoc(doc) {
    await ready().setItem(`doc_${doc.id}`, doc);
    const idx = await loadIndex();
    if (idx[doc.id] !== doc.projectId) {
        idx[doc.id] = doc.projectId;
        await ready().setItem(DOC_INDEX_KEY, idx);
    }
}

export async function deleteDoc(id) {
    await ready().removeItem(`doc_${id}`);
    const idx = await loadIndex();
    if (id in idx) {
        delete idx[id];
        await ready().setItem(DOC_INDEX_KEY, idx);
    }
}

export async function listDocs(projectId) {
    const idx = await loadIndex();
    const ids = Object.keys(idx).filter(id => idx[id] === projectId);
    const docs = await Promise.all(ids.map(id => ready().getItem(`doc_${id}`)));
    return docs.filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function listAllDocs() {
    const idx = await loadIndex();
    const docs = await Promise.all(Object.keys(idx).map(id => ready().getItem(`doc_${id}`)));
    return docs.filter(Boolean);
}

export async function deleteProjectDocs(projectId) {
    const docs = await listDocs(projectId);
    for (const d of docs) await deleteDoc(d.id);
    return docs.map(d => d.id);
}

// ===== Tombstones =====
// Ghi cho MỌI lần xóa, kể cả khi chưa đăng nhập / đang offline — nếu không, sync sau sẽ
// kéo bản trên cloud về và item "hồi sinh".
export async function addTombstone(itemId, kind, deletedAt) {
    const list = (await ready().getItem(TOMBSTONES_KEY)) || [];
    const id = String(itemId);
    const at = deletedAt || Date.now();
    const i = list.findIndex(t => t.item_id === id);
    if (i >= 0) list[i] = { ...list[i], kind: kind || list[i].kind, deletedAt: Math.max(list[i].deletedAt || 0, at) };
    else list.push({ item_id: id, kind: kind || 'doc', deletedAt: at });
    await ready().setItem(TOMBSTONES_KEY, list);
}

export async function getTombstones() {
    const list = (await ready().getItem(TOMBSTONES_KEY)) || [];
    const cutoff = Date.now() - TOMBSTONE_TTL;
    const live = list.filter(t => (t.deletedAt || 0) > cutoff);
    if (live.length !== list.length) await ready().setItem(TOMBSTONES_KEY, live);
    return live;
}

export async function removeTombstones(itemIds) {
    if (!itemIds?.length) return;
    const set = new Set(itemIds.map(String));
    const list = (await ready().getItem(TOMBSTONES_KEY)) || [];
    await ready().setItem(TOMBSTONES_KEY, list.filter(t => !set.has(t.item_id)));
}

// ===== Hàng đợi chờ đẩy lên (sống qua lần đóng app; xóa khi push xong) =====
export async function markPending(itemId, kind) {
    const list = (await ready().getItem(PENDING_KEY)) || [];
    const id = String(itemId);
    if (!list.some(p => p.item_id === id)) {
        list.push({ item_id: id, kind });
        await ready().setItem(PENDING_KEY, list);
    }
}

export async function getPending() {
    return (await ready().getItem(PENDING_KEY)) || [];
}

export async function clearPending(itemIds) {
    if (!itemIds?.length) return;
    const set = new Set(itemIds.map(String));
    const list = (await ready().getItem(PENDING_KEY)) || [];
    await ready().setItem(PENDING_KEY, list.filter(p => !set.has(p.item_id)));
}

// ===== Meta =====
export async function getMeta() {
    return (await ready().getItem(META_KEY)) || {};
}

export async function setMeta(patch) {
    const cur = (await ready().getItem(META_KEY)) || {};
    const next = { ...cur, ...patch };
    await ready().setItem(META_KEY, next);
    return next;
}
