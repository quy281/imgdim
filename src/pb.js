/**
 * PocketBase sync client for MKG-Dim.
 * URL: https://db.mkg.vn
 * Collection: dim_plans — one record per plan doc, owned by the logged-in user.
 * Schema: { id, user, doc_id(string), name, data(json), updated }
 */

const PB_URL = 'https://db.mkg.vn';

// --- Auth token persistence ---
const TOKEN_KEY = 'pb_token';
const MODEL_KEY = 'pb_model';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getModel() { try { return JSON.parse(localStorage.getItem(MODEL_KEY)); } catch { return null; } }
export function isLoggedIn() { return !!getToken(); }

function saveAuth(token, model) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(MODEL_KEY, JSON.stringify(model));
}

export function clearAuth() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MODEL_KEY);
}

// --- HTTP helpers ---
async function pbFetch(path, opts = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}), ...(opts.headers || {}) };
    const res = await fetch(`${PB_URL}/api/${path}`, { ...opts, headers });
    if (!res.ok) {
        let msg;
        try { const j = await res.json(); msg = j.message || j.code || res.statusText; } catch { msg = res.statusText; }
        throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
}

// --- Auth ---
export async function login(email, password) {
    const data = await pbFetch('collections/users/auth-with-password', {
        method: 'POST',
        body: JSON.stringify({ identity: email, password }),
    });
    saveAuth(data.token, data.record);
    return data.record;
}

export async function logout() {
    clearAuth();
}

// --- Plan sync ---
const COLLECTION = 'dim_plans';

/**
 * Upload all local plan docs to PocketBase.
 * - If a remote record with the same doc_id exists: update it.
 * - Otherwise: create a new record.
 * `docs` = array of plain-serializable doc objects (no Image objects).
 */
export async function pushPlans(docs, onProgress) {
    const planDocs = docs.filter(d => d.type === 'plan');
    for (let i = 0; i < planDocs.length; i++) {
        const doc = planDocs[i];
        onProgress?.(`${i + 1}/${planDocs.length}: ${doc.name}`);
        const payload = {
            doc_id: String(doc.id),
            name: doc.name,
            data: JSON.stringify(serializeDoc(doc)),
        };
        // Check if exists
        try {
            const existing = await pbFetch(`collections/${COLLECTION}/records?filter=(doc_id='${doc.id}')&perPage=1`);
            if (existing.items?.length > 0) {
                await pbFetch(`collections/${COLLECTION}/records/${existing.items[0].id}`, {
                    method: 'PATCH',
                    body: JSON.stringify(payload),
                });
            } else {
                await pbFetch(`collections/${COLLECTION}/records`, {
                    method: 'POST',
                    body: JSON.stringify(payload),
                });
            }
        } catch (err) {
            console.warn(`Sync failed for doc ${doc.name}:`, err);
        }
    }
}

/**
 * Pull all remote plan docs that are newer than local.
 * Returns array of deserialized doc objects to merge into local state.
 */
export async function pullPlans(localDocs) {
    const remote = await pbFetch(`collections/${COLLECTION}/records?perPage=200&sort=-updated`);
    const localMap = new Map(localDocs.map(d => [String(d.id), d]));
    const incoming = [];
    for (const rec of (remote.items || [])) {
        const local = localMap.get(rec.doc_id);
        const remoteUpdated = new Date(rec.updated).getTime();
        const localUpdated = local ? (local.updatedAt || 0) : 0;
        if (!local || remoteUpdated > localUpdated) {
            try {
                const doc = deserializeDoc(JSON.parse(rec.data));
                incoming.push(doc);
            } catch (err) {
                console.warn(`Deserialize failed for ${rec.name}:`, err);
            }
        }
    }
    return incoming;
}

// --- Serialization ---
function serializeDoc(doc) {
    // Strip non-serializable fields (Image objects, etc.)
    return {
        ...doc,
        img: null,
        imgBase64: null,
        updatedAt: Date.now(),
    };
}

function deserializeDoc(raw) {
    return { ...raw, img: null };
}
