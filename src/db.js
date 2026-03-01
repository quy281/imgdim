import localforage from 'localforage';

// Configure localforage
localforage.config({
    name: 'mkg-dim',
    storeName: 'dim_store',
    description: 'MKG Dim local storage'
});

const PROJECTS_KEY = 'projects';

// ====== PROJECTS ======
export async function loadProjects() {
    const data = await localforage.getItem(PROJECTS_KEY);
    return data || [];
}

export async function saveProjects(projects) {
    await localforage.setItem(PROJECTS_KEY, projects);
}

// ====== DOCS (images per project) ======
function docKey(projectId) {
    return `docs_${projectId}`;
}

/**
 * Load docs for a project. Each doc is stored as:
 * { id, name, imgBase64, lines, texts, linesHistory, historyStep, globalRatio, frameAttrs, stageScale, stagePos }
 * Note: `img` (HTMLImageElement) is NOT stored; it will be re-created from imgBase64 on load.
 */
export async function loadDocs(projectId) {
    const data = await localforage.getItem(docKey(projectId));
    return data || [];
}

export async function saveDocs(projectId, docs) {
    // Strip the HTMLImageElement before saving (it can't be serialized)
    const serializable = docs.map(d => {
        const { img, ...rest } = d;
        return rest;
    });
    await localforage.setItem(docKey(projectId), serializable);
}

export async function deleteProjectDocs(projectId) {
    await localforage.removeItem(docKey(projectId));
}
