// Local persistence — IndexedDB via localforage. Offline-first: this is the source of truth,
// PocketBase sync (pb.js) mirrors it.
import localforage from 'localforage';

localforage.config({
    name: 'mkg-khaosat',
    storeName: 'ks_store',
    description: 'MKG Khao Sat local storage',
});

const PROJECTS_KEY = 'projects';
const DOC_INDEX_KEY = 'docidx'; // { [docId]: projectId }
const TOMBSTONES_KEY = 'tombstones'; // [{ item_id, deletedAt }]

// ===== Projects (array of meta objects) =====
export async function loadProjects() {
    return (await localforage.getItem(PROJECTS_KEY)) || [];
}

export async function saveProjects(projects) {
    await localforage.setItem(PROJECTS_KEY, projects);
}

// ===== Docs (one key per doc, small index for listing) =====
async function loadIndex() {
    return (await localforage.getItem(DOC_INDEX_KEY)) || {};
}

export async function getDoc(id) {
    return await localforage.getItem(`doc_${id}`);
}

export async function putDoc(doc) {
    await localforage.setItem(`doc_${doc.id}`, doc);
    const idx = await loadIndex();
    if (idx[doc.id] !== doc.projectId) {
        idx[doc.id] = doc.projectId;
        await localforage.setItem(DOC_INDEX_KEY, idx);
    }
}

export async function deleteDoc(id) {
    await localforage.removeItem(`doc_${id}`);
    const idx = await loadIndex();
    if (id in idx) {
        delete idx[id];
        await localforage.setItem(DOC_INDEX_KEY, idx);
    }
}

export async function listDocs(projectId) {
    const idx = await loadIndex();
    const ids = Object.keys(idx).filter(id => idx[id] === projectId);
    const docs = await Promise.all(ids.map(id => localforage.getItem(`doc_${id}`)));
    return docs.filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function listAllDocs() {
    const idx = await loadIndex();
    const docs = await Promise.all(Object.keys(idx).map(id => localforage.getItem(`doc_${id}`)));
    return docs.filter(Boolean);
}

export async function deleteProjectDocs(projectId) {
    const docs = await listDocs(projectId);
    for (const d of docs) await deleteDoc(d.id);
    return docs.map(d => d.id);
}

// ===== Tombstones (deleted item ids pending remote delete) =====
export async function addTombstone(itemId) {
    const list = (await localforage.getItem(TOMBSTONES_KEY)) || [];
    if (!list.some(t => t.item_id === itemId)) {
        list.push({ item_id: itemId, deletedAt: Date.now() });
        await localforage.setItem(TOMBSTONES_KEY, list);
    }
}

export async function getTombstones() {
    return (await localforage.getItem(TOMBSTONES_KEY)) || [];
}

export async function removeTombstones(itemIds) {
    const set = new Set(itemIds);
    const list = (await localforage.getItem(TOMBSTONES_KEY)) || [];
    await localforage.setItem(TOMBSTONES_KEY, list.filter(t => !set.has(t.item_id)));
}

// ===== Pending push queue (survives app close; cleared on successful sync) =====
const PENDING_KEY = 'pending_push';

export async function markPending(itemId, kind) {
    const list = (await localforage.getItem(PENDING_KEY)) || [];
    const id = String(itemId);
    if (!list.some(p => p.item_id === id)) {
        list.push({ item_id: id, kind });
        await localforage.setItem(PENDING_KEY, list);
    }
}

export async function getPending() {
    return (await localforage.getItem(PENDING_KEY)) || [];
}

export async function clearPending(itemIds) {
    const set = new Set(itemIds.map(String));
    const list = (await localforage.getItem(PENDING_KEY)) || [];
    await localforage.setItem(PENDING_KEY, list.filter(p => !set.has(p.item_id)));
}
