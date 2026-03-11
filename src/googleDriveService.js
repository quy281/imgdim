/**
 * Google Drive Service
 * Handles OAuth2 authentication and file upload to Google Drive
 */

const GOOGLE_CLIENT_ID = localStorage.getItem('gdrive_client_id') || '';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_FOLDER_NAME = 'MKG-Dim';

let tokenClient = null;
let accessToken = localStorage.getItem('gdrive_token') || null;
let tokenExpiry = parseInt(localStorage.getItem('gdrive_token_expiry') || '0');

// Load Google Identity Services script
function loadGsiScript() {
    return new Promise((resolve, reject) => {
        if (window.google?.accounts?.oauth2) { resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Initialize token client
async function initTokenClient(clientId) {
    await loadGsiScript();
    return new Promise((resolve) => {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPES,
            callback: (response) => {
                if (response.access_token) {
                    accessToken = response.access_token;
                    tokenExpiry = Date.now() + (response.expires_in * 1000);
                    localStorage.setItem('gdrive_token', accessToken);
                    localStorage.setItem('gdrive_token_expiry', tokenExpiry.toString());
                    resolve(response);
                }
            },
        });
        resolve(tokenClient);
    });
}

// Check if connected
export function isConnected() {
    return accessToken && tokenExpiry > Date.now();
}

// Get connected user info
export async function getUserInfo() {
    if (!isConnected()) return null;
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; }
}

// Connect to Google Drive
export async function connect(clientId) {
    if (clientId) {
        localStorage.setItem('gdrive_client_id', clientId);
    }
    const cid = clientId || localStorage.getItem('gdrive_client_id');
    if (!cid) throw new Error('Client ID chưa được cấu hình');

    await initTokenClient(cid);
    return new Promise((resolve, reject) => {
        try {
            tokenClient.callback = (response) => {
                if (response.error) { reject(new Error(response.error)); return; }
                accessToken = response.access_token;
                tokenExpiry = Date.now() + (response.expires_in * 1000);
                localStorage.setItem('gdrive_token', accessToken);
                localStorage.setItem('gdrive_token_expiry', tokenExpiry.toString());
                resolve(response);
            };
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } catch (err) { reject(err); }
    });
}

// Disconnect
export function disconnect() {
    if (accessToken) {
        try { window.google?.accounts?.oauth2?.revoke(accessToken); } catch { }
    }
    accessToken = null;
    tokenExpiry = 0;
    _rootFolderIdCache = null;
    Object.keys(_subFolderCache).forEach(k => delete _subFolderCache[k]);
    localStorage.removeItem('gdrive_token');
    localStorage.removeItem('gdrive_token_expiry');
}

// Find or create MKG-Dim folder (with cache)
let _rootFolderIdCache = null;
const _subFolderCache = {};

async function getOrCreateFolder() {
    if (_rootFolderIdCache) return _rootFolderIdCache;
    // Search for existing folder
    const q = encodeURIComponent(`name='${GDRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
        _rootFolderIdCache = searchData.files[0].id;
        return _rootFolderIdCache;
    }

    // Create folder
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: GDRIVE_FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder',
        }),
    });
    const folder = await createRes.json();
    _rootFolderIdCache = folder.id;
    return _rootFolderIdCache;
}

// Find or create subfolder (project folder)
async function getOrCreateSubFolder(parentId, folderName) {
    const cacheKey = `${parentId}_${folderName}`;
    if (_subFolderCache[cacheKey]) return _subFolderCache[cacheKey];

    const q = encodeURIComponent(`name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
        _subFolderCache[cacheKey] = searchData.files[0].id;
        return _subFolderCache[cacheKey];
    }

    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        }),
    });
    const folder = await createRes.json();
    _subFolderCache[cacheKey] = folder.id;
    return _subFolderCache[cacheKey];
}

// Upload image to Google Drive
export async function uploadImage(base64Data, fileName, projectName = '') {
    if (!isConnected()) throw new Error('Chưa kết nối Google Drive');

    const rootFolderId = await getOrCreateFolder();
    let targetFolderId = rootFolderId;

    if (projectName) {
        targetFolderId = await getOrCreateSubFolder(rootFolderId, projectName);
    }

    // Convert base64 to blob
    const byteChars = atob(base64Data);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: 'image/png' });

    // Multipart upload
    const metadata = {
        name: fileName,
        mimeType: 'image/png',
        parents: [targetFolderId],
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Upload thất bại');
    }
    return await res.json();
}

// Get storage usage
export async function getStorageInfo() {
    if (!isConnected()) return null;
    try {
        const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.storageQuota;
    } catch { return null; }
}

// List files in project folder on Google Drive
export async function listFiles(projectName = '') {
    if (!isConnected()) return [];
    try {
        const rootFolderId = await getOrCreateFolder();
        let targetFolderId = rootFolderId;
        if (projectName) {
            targetFolderId = await getOrCreateSubFolder(rootFolderId, projectName);
        }
        const res = await fetch(
            `https://www.googleapis.com/drive/v3/files?q='${targetFolderId}' in parents and trashed=false&fields=files(id,name)&pageSize=1000`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return data.files || [];
    } catch { return []; }
}
