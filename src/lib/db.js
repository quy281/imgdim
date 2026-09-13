// Local persistence — IndexedDB qua localforage. Offline-first: đây là nguồn sự thật,
// PocketBase (pb.js) chỉ là bản sao.
//
// LỚP USER: mỗi tài khoản có một IndexedDB database RIÊNG (`mkg-khaosat-<uid>`), nên
// user B đăng nhập trên cùng máy không thấy — và không đẩy lên cloud — dữ liệu của user A.
// Dữ liệu tạo khi chưa đăng nhập nằm ở store `anon` và được HỢP NHẤT vào tài
// khoản đầu tiên đăng nhập. Kho tài khoản đã có dữ liệu vẫn phải nhận phần offline;
// nếu chỉ copy khi kho đích rỗng thì login xong dữ liệu sẽ "biến mất" khỏi màn hình.
// Đăng xuất KHÔNG đổi store, nên dữ liệu vẫn thấy được trên máy như đã hứa với người dùng.
import localforage from 'localforage';

const PROJECTS_KEY = 'projects';
const DOC_INDEX_KEY = 'docidx';       // { [docId]: projectId }
const TOMBSTONES_KEY = 'tombstones';  // [{ item_id, kind, deletedAt }]
const PENDING_KEY = 'pending_push';   // [{ item_id, kind }]
const META_KEY = 'meta';              // { lastSyncAt, ... }

const ACTIVE_STORE_KEY = 'ks_store_id';   // localStorage: store đang mở ('anon' | uid)
const V2_MIGRATED_PREFIX = 'ks_v2_migrated_';
// Đặt ngay trong IndexedDB v2 (không dùng localStorage) để bản backup chỉ thuộc về
// đúng kho đã nhận nó đầu tiên, tránh tài khoản thứ hai trên cùng máy nhận nhầm.
const LEGACY_CLAIM_KEY = 'v3_claimed_store';
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

// Mọi thao tác IndexedDB đi qua một hàng đợi. Ngoài việc chống hai lệnh
// read-modify-write giẫm lên nhau, nó còn bảo đảm không có lệnh save nào ghi vào
// kho anon trong lúc setAccount() đang kiểm chứng rồi dọn kho đó.
let dbQueue = Promise.resolve();
function queued(fn) {
    const run = dbQueue.then(fn, fn);
    dbQueue = run.then(() => undefined, () => undefined);
    return run;
}

/** Store đang mở ('anon' hoặc uid). Gọi sau setAccount. */
export function activeStoreId() { return storeId; }

function ready() {
    if (!store) throw new Error('db.setAccount() chưa được gọi');
    return store;
}

async function allKeys(inst) {
    return await inst.keys();
}

async function isEmpty(inst) {
    const projects = await inst.getItem(PROJECTS_KEY);
    if (projects?.length) return false;
    const idx = await inst.getItem(DOC_INDEX_KEY);
    if (idx && Object.keys(idx).length) return false;
    // Tự cứu doc mồ côi nếu một lần ghi index trước đây bị race/crash.
    return !(await allKeys(inst)).some(k => String(k).startsWith('doc_'));
}

const asList = (value) => Array.isArray(value) ? value : [];
const itemId = (item) => String(item?.id ?? '');

function mergeProjects(target, source) {
    const byId = new Map();
    const withoutId = [];
    for (const p of [...asList(target), ...asList(source)]) {
        const id = itemId(p);
        if (!id) { withoutId.push(p); continue; }
        const cur = byId.get(id);
        if (!cur) {
            byId.set(id, p);
        } else if (Number(p?.updatedAt) >= Number(cur?.updatedAt)) {
            // Giữ metadata chỉ có ở cloud (ownerId...) nhưng ưu tiên nội dung
            // offline khi nó mới hơn hoặc cùng mốc.
            byId.set(id, { ...cur, ...p });
        }
    }
    return [...byId.values(), ...withoutId]
        .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
}

function mergeTombstones(target, source) {
    const byId = new Map();
    for (const t of [...asList(target), ...asList(source)]) {
        const id = String(t?.item_id ?? '');
        if (!id) continue;
        const cur = byId.get(id);
        if (!cur || Number(t.deletedAt || 0) >= Number(cur.deletedAt || 0)) {
            byId.set(id, { ...(cur || {}), ...t, item_id: id });
        }
    }
    return [...byId.values()];
}

function mergePending(target, source) {
    const byId = new Map();
    for (const p of [...asList(target), ...asList(source)]) {
        const id = String(p?.item_id ?? '');
        if (id) byId.set(id, { ...(byId.get(id) || {}), ...p, item_id: id });
    }
    return [...byId.values()];
}

function mergeMeta(target, source) {
    const a = target && typeof target === 'object' ? target : {};
    const b = source && typeof source === 'object' ? source : {};
    return {
        ...b,
        ...a,
        v2Migrated: !!(a.v2Migrated || b.v2Migrated),
        lastSyncAt: Math.max(Number(a.lastSyncAt || 0), Number(b.lastSyncAt || 0)) || undefined,
        scopeDirty: [...new Set([...asList(a.scopeDirty), ...asList(b.scopeDirty)].map(String))],
    };
}

async function snapshot(inst) {
    const out = new Map();
    for (const key of await allKeys(inst)) out.set(String(key), await inst.getItem(key));
    return out;
}

/**
 * Hợp nhất một kho cũ vào kho hiện tại mà không ghi đè dữ liệu mới hơn đã có.
 * Khi cleanupSource=true, hàm chỉ dọn nguồn sau khi đọc ngược kho đích và chứng minh
 * mọi project/doc, tombstone và pending item đã sang đủ. Nếu bất kỳ lệnh nào lỗi,
 * nguồn còn nguyên để lần boot/login sau thử lại idempotently.
 */
async function mergeStores(from, to, cleanupSource) {
    const source = await snapshot(from);
    if (!source.size) return 0;

    const sourceProjects = asList(source.get(PROJECTS_KEY));
    const sourceDocKeys = [...source.keys()].filter(k => k.startsWith('doc_'));
    const sourceTombstones = asList(source.get(TOMBSTONES_KEY));
    const sourcePending = asList(source.get(PENDING_KEY));

    const targetProjects = asList(await to.getItem(PROJECTS_KEY));
    await to.setItem(PROJECTS_KEY, mergeProjects(targetProjects, sourceProjects));

    for (const key of sourceDocKeys) {
        const incoming = source.get(key);
        if (!incoming) continue;
        const current = await to.getItem(key);
        const chosen = !current || Number(incoming.updatedAt || 0) >= Number(current.updatedAt || 0)
            ? { ...(current || {}), ...incoming }
            : current;
        await to.setItem(key, chosen);
    }

    await to.setItem(TOMBSTONES_KEY,
        mergeTombstones(await to.getItem(TOMBSTONES_KEY), sourceTombstones));
    await to.setItem(PENDING_KEY,
        mergePending(await to.getItem(PENDING_KEY), sourcePending));
    await to.setItem(META_KEY,
        mergeMeta(await to.getItem(META_KEY), source.get(META_KEY)));

    // Khôi phục index từ chính các doc thật đang có, nhân tiện cứu doc mồ côi
    // do các bản cũ có thể ghi doc xong nhưng chưa kịp ghi index.
    const rebuiltIndex = {};
    for (const key of await allKeys(to)) {
        if (!String(key).startsWith('doc_')) continue;
        const doc = await to.getItem(key);
        if (doc?.id != null && doc?.projectId != null) rebuiltIndex[String(doc.id)] = doc.projectId;
    }
    await to.setItem(DOC_INDEX_KEY, rebuiltIndex);

    // Khóa tương lai: key mới mà phiên bản này chưa biết thì chỉ copy khi
    // đích chưa có, tuyệt đối không ghi đè dữ liệu tài khoản.
    const known = new Set([
        PROJECTS_KEY, DOC_INDEX_KEY, TOMBSTONES_KEY, PENDING_KEY, META_KEY, LEGACY_CLAIM_KEY,
    ]);
    for (const [key, value] of source) {
        if (known.has(key) || key.startsWith('doc_')) continue;
        if (await to.getItem(key) == null) await to.setItem(key, value);
    }

    // Verify trước khi xóa nguồn.
    const verifiedProjects = new Set(asList(await to.getItem(PROJECTS_KEY)).map(itemId));
    const verifiedTombstones = new Map(asList(await to.getItem(TOMBSTONES_KEY))
        .map(t => [String(t.item_id), Number(t.deletedAt || 0)]));
    const verifiedPending = new Set(asList(await to.getItem(PENDING_KEY)).map(p => String(p.item_id)));
    const projectsOk = sourceProjects.every(p => !itemId(p) || verifiedProjects.has(itemId(p)));
    const docsOk = (await Promise.all(sourceDocKeys.map(k => to.getItem(k)))).every(Boolean);
    const tombstonesOk = sourceTombstones.every(t =>
        verifiedTombstones.has(String(t.item_id)) &&
        verifiedTombstones.get(String(t.item_id)) >= Number(t.deletedAt || 0));
    const pendingOk = sourcePending.every(p => verifiedPending.has(String(p.item_id)));
    if (!projectsOk || !docsOk || !tombstonesOk || !pendingOk) {
        throw new Error('Không kiểm chứng được toàn bộ dữ liệu khách sau khi hợp nhất');
    }

    if (cleanupSource) {
        for (const key of source.keys()) await from.removeItem(key);
    }
    return sourceProjects.length + sourceDocKeys.length;
}

/**
 * Mở store cho tài khoản `uid` (null = chưa đăng nhập → store 'anon').
 * options.adoptAnon=false dùng cho cổng khách: không để tài khoản khách vô tình nhận
 * dữ liệu nội bộ từng được tạo ẩn danh trên cùng điện thoại.
 * Trả về { storeId, adopted, migratedV2 } để App có thể báo cho người dùng.
 */
export function setAccount(uid, options = {}) {
    return queued(async () => {
        const target = uid ? String(uid) : 'anon';
        const inst = instanceFor(target);
        let adopted = 0;
        let migratedV2 = 0;

        // 1. Di trú store v2 bằng cùng phép merge an toàn, kể cả khi store đích đã có
        // dữ liệu. Bản v2 được giữ nguyên làm đường lùi; cờ nằm trong store đích để không
        // merge lại bản backup cũ ở mọi lần boot.
        const meta = (await inst.getItem(META_KEY)) || {};
        try {
            const legacy = legacyStore();
            if (!(await isEmpty(legacy))) {
                let claimedBy = await legacy.getItem(LEGACY_CLAIM_KEY);

                // Các máy đã di trú ở một bản trước chưa có claim bền vững. Kho đang
                // mang cờ v2Migrated là bằng chứng nó đã nhận backup, nên ghi claim bù.
                if (!claimedBy && meta.v2Migrated) {
                    await legacy.setItem(LEGACY_CLAIM_KEY, target);
                    claimedBy = target;
                }

                if (!meta.v2Migrated && (!claimedBy || String(claimedBy) === target)) {
                    // Claim TRƯỚC khi merge. Nếu merge lỗi, cùng target được thử lại còn
                    // tài khoản khác tuyệt đối không thể nhận nhầm dữ liệu trong backup.
                    if (!claimedBy) await legacy.setItem(LEGACY_CLAIM_KEY, target);
                    migratedV2 = await mergeStores(legacy, inst, false);
                    await inst.setItem(META_KEY, {
                        ...((await inst.getItem(META_KEY)) || {}),
                        v2Migrated: true,
                    });
                } else if (!meta.v2Migrated && String(claimedBy) !== target) {
                    // Backup đã thuộc kho khác: ghi dấu để kho này không kiểm lại mãi.
                    await inst.setItem(META_KEY, { ...meta, v2Migrated: true });
                }
            }
        } catch (err) {
            // Đọc/merge store cũ lỗi thì KHÔNG đánh dấu, để lần mở sau thử lại.
            console.warn('migrate v2:', err);
        }
        // Dọn cờ localStorage của bản trước để không ai còn đọc tới nó.
        localStorage.removeItem(V2_MIGRATED_PREFIX + target);

        // 2. Luôn thử cứu kho anon khi đã đăng nhập, kể cả khi kho đích đã
        // có dữ liệu hoặc lần login hỏng trước đã đổi ACTIVE_STORE_KEY. Phép merge
        // idempotent và hàng đợi phía trên ngăn save chen vào giữa merge/verify/cleanup.
        if (uid && target !== 'anon' && options.adoptAnon !== false) {
            const anon = instanceFor('anon');
            if ((await allKeys(anon)).length) adopted = await mergeStores(anon, inst, true);
        }

        store = inst;
        storeId = target;
        localStorage.setItem(ACTIVE_STORE_KEY, target);
        return { storeId: target, adopted, migratedV2 };
    });
}

/** Store nào đang được dùng ở lần chạy trước — để boot đúng khi chưa đăng nhập. */
export function lastStoreId() { return localStorage.getItem(ACTIVE_STORE_KEY) || 'anon'; }

// ===== Projects (mảng meta object) =====
export function loadProjects() {
    return queued(async () => (await ready().getItem(PROJECTS_KEY)) || []);
}

export function saveProjects(projects) {
    return queued(async () => { await ready().setItem(PROJECTS_KEY, projects); });
}

/**
 * Ghi project bằng hàm biến đổi, đọc-sửa-ghi trong cùng một lượt.
 * Chống mất dữ liệu khi sync (chạy lâu) và người dùng tạo dự án chen vào giữa.
 */
export function mutateProjects(fn) {
    return queued(async () => {
        const cur = (await ready().getItem(PROJECTS_KEY)) || [];
        const next = fn(cur);
        await ready().setItem(PROJECTS_KEY, next);
        return next;
    });
}

// ===== Docs (một key mỗi doc, index nhỏ để liệt kê) =====
async function loadIndex(inst) {
    return (await inst.getItem(DOC_INDEX_KEY)) || {};
}

export function getDoc(id) {
    return queued(async () => await ready().getItem(`doc_${id}`));
}

export function putDoc(doc) {
    return queued(async () => {
        const inst = ready();
        await inst.setItem(`doc_${doc.id}`, doc);
        const idx = await loadIndex(inst);
        if (idx[doc.id] !== doc.projectId) {
            idx[doc.id] = doc.projectId;
            await inst.setItem(DOC_INDEX_KEY, idx);
        }
    });
}

async function deleteDocFrom(inst, id) {
    await inst.removeItem(`doc_${id}`);
    const idx = await loadIndex(inst);
    if (id in idx) {
        delete idx[id];
        await inst.setItem(DOC_INDEX_KEY, idx);
    }
}

export function deleteDoc(id) {
    return queued(async () => deleteDocFrom(ready(), id));
}

async function listDocsFrom(inst, projectId) {
    const idx = await loadIndex(inst);
    const ids = Object.keys(idx).filter(id => idx[id] === projectId);
    const docs = await Promise.all(ids.map(id => inst.getItem(`doc_${id}`)));
    return docs.filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export function listDocs(projectId) {
    return queued(async () => listDocsFrom(ready(), projectId));
}

export function listAllDocs() {
    return queued(async () => {
        const inst = ready();
        const idx = await loadIndex(inst);
        const docs = await Promise.all(Object.keys(idx).map(id => inst.getItem(`doc_${id}`)));
        return docs.filter(Boolean);
    });
}

export function deleteProjectDocs(projectId) {
    return queued(async () => {
        const inst = ready();
        const docs = await listDocsFrom(inst, projectId);
        for (const d of docs) await deleteDocFrom(inst, d.id);
        return docs.map(d => d.id);
    });
}

// ===== Tombstones =====
// Ghi cho MỌI lần xóa, kể cả khi chưa đăng nhập / đang offline — nếu không, sync sau sẽ
// kéo bản trên cloud về và item "hồi sinh".
export function addTombstone(itemId, kind, deletedAt) {
    return queued(async () => {
        const inst = ready();
        const list = (await inst.getItem(TOMBSTONES_KEY)) || [];
        const id = String(itemId);
        const at = deletedAt || Date.now();
        const i = list.findIndex(t => t.item_id === id);
        if (i >= 0) list[i] = { ...list[i], kind: kind || list[i].kind, deletedAt: Math.max(list[i].deletedAt || 0, at) };
        else list.push({ item_id: id, kind: kind || 'doc', deletedAt: at });
        await inst.setItem(TOMBSTONES_KEY, list);
    });
}

export function getTombstones() {
    return queued(async () => {
        const inst = ready();
        const list = (await inst.getItem(TOMBSTONES_KEY)) || [];
        const cutoff = Date.now() - TOMBSTONE_TTL;
        const live = list.filter(t => (t.deletedAt || 0) > cutoff);
        if (live.length !== list.length) await inst.setItem(TOMBSTONES_KEY, live);
        return live;
    });
}

export function removeTombstones(itemIds) {
    return queued(async () => {
        if (!itemIds?.length) return;
        const inst = ready();
        const set = new Set(itemIds.map(String));
        const list = (await inst.getItem(TOMBSTONES_KEY)) || [];
        await inst.setItem(TOMBSTONES_KEY, list.filter(t => !set.has(t.item_id)));
    });
}

// ===== Hàng đợi chờ đẩy lên (sống qua lần đóng app; xóa khi push xong) =====
export function markPending(itemId, kind) {
    return queued(async () => {
        const inst = ready();
        const list = (await inst.getItem(PENDING_KEY)) || [];
        const id = String(itemId);
        if (!list.some(p => p.item_id === id)) {
            list.push({ item_id: id, kind });
            await inst.setItem(PENDING_KEY, list);
        }
    });
}

export function getPending() {
    return queued(async () => (await ready().getItem(PENDING_KEY)) || []);
}

export function clearPending(itemIds) {
    return queued(async () => {
        if (!itemIds?.length) return;
        const inst = ready();
        const set = new Set(itemIds.map(String));
        const list = (await inst.getItem(PENDING_KEY)) || [];
        await inst.setItem(PENDING_KEY, list.filter(p => !set.has(p.item_id)));
    });
}

// ===== Meta =====
export function getMeta() {
    return queued(async () => (await ready().getItem(META_KEY)) || {});
}

export function setMeta(patch) {
    return queued(async () => {
        const inst = ready();
        const cur = (await inst.getItem(META_KEY)) || {};
        const next = { ...cur, ...patch };
        await inst.setItem(META_KEY, next);
        return next;
    });
}
