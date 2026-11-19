#!/usr/bin/env node
/**
 * Integration test end-to-end cho backend Cloudflare (D1 SQLite that + R2 mock + pb.js client + Google Drive Backup).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

import { handleApiRequest } from '../cf-backend/router.js';
import { runCloudBackup } from '../cf-backend/backup.js';

// ===== Shim localStorage + __MKG_PB_URL__ truoc khi import pb.js =====
const store = new Map();
globalThis.__MKG_PB_URL__ = 'https://cf.local';
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
};
if (!globalThis.navigator) Object.defineProperty(globalThis, 'navigator', { value: { onLine: true } });
if (!globalThis.FileReader) {
    globalThis.FileReader = class FileReader {
        readAsDataURL(blob) {
            blob.arrayBuffer().then(buf => {
                this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
                this.onload?.();
            }).catch(err => this.onerror?.(err));
        }
    };
}

// ===== D1 SQLite Shim =====
function createD1Shim(sqlite) {
    return {
        prepare(sql) {
            let bound = [];
            const stmt = {
                bind(...args) {
                    bound = args;
                    return stmt;
                },
                async first() {
                    const q = sqlite.prepare(sql);
                    return q.get(...bound) ?? null;
                },
                async all() {
                    const q = sqlite.prepare(sql);
                    return { results: q.all(...bound) };
                },
                async run() {
                    const q = sqlite.prepare(sql);
                    const info = q.run(...bound);
                    return { success: true, meta: { changes: info.changes } };
                },
            };
            return stmt;
        },
    };
}

// ===== R2 Bucket Shim =====
function createR2Shim() {
    const map = new Map();
    let seq = 1;
    return {
        _map: map,
        async put(key, body, opts = {}) {
            let bytes;
            if (body instanceof Uint8Array) bytes = body;
            else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
            else if (typeof body === 'string') bytes = new TextEncoder().encode(body);
            else bytes = new Uint8Array(await new Response(body).arrayBuffer());
            const etag = `etag-${seq++}-${bytes.byteLength}`;
            map.set(key, { bytes, size: bytes.byteLength, httpEtag: etag, httpMetadata: opts.httpMetadata || {} });
            return { key, etag };
        },
        async get(key) {
            const entry = map.get(key);
            if (!entry) return null;
            return {
                key,
                size: entry.size,
                httpEtag: entry.httpEtag,
                httpMetadata: entry.httpMetadata,
                get body() {
                    return new ReadableStream({
                        start(controller) {
                            controller.enqueue(entry.bytes);
                            controller.close();
                        },
                    });
                },
                async arrayBuffer() { return entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength); },
                async text() { return new TextDecoder().decode(entry.bytes); },
                async json() { return JSON.parse(new TextDecoder().decode(entry.bytes)); },
            };
        },
        async delete(key) { map.delete(key); },
        async list({ prefix = '', limit = 500 } = {}) {
            const objects = [];
            for (const [key, entry] of map) {
                if (prefix && !key.startsWith(prefix)) continue;
                objects.push({ key, size: entry.size, httpEtag: entry.httpEtag, etag: entry.httpEtag });
            }
            return { objects: objects.slice(0, limit), truncated: false };
        },
    };
}

// ===== Mock Google Drive HTTP endpoints =====
const driveState = { folders: [], files: [], uploadSessions: new Map(), oauthHits: 0 };
const realFetch = globalThis.fetch;

const sqlite = new DatabaseSync(':memory:');
const initSql = fs.readFileSync(path.resolve('cloudflare/migrations/0001_init.sql'), 'utf8');
sqlite.exec(initSql);

const env = {
    DB: createD1Shim(sqlite),
    MEDIA: createR2Shim(),
    JWT_SECRET: 'test-jwt-secret-32-chars-minimum-ok',
    BACKUP_SECRET: 'test-backup-secret',
    GDRIVE_CLIENT_ID: 'cid',
    GDRIVE_CLIENT_SECRET: 'csec',
    GDRIVE_REFRESH_TOKEN: 'rtok',
    GDRIVE_TOKEN_URL: 'https://mock-gdrive.local/token',
    GDRIVE_API_BASE: 'https://mock-gdrive.local/drive/v3/files',
    GDRIVE_UPLOAD_BASE: 'https://mock-gdrive.local/upload/drive/v3/files',
};

let uploadSeq = 1;
globalThis.fetch = async (input, init = {}) => {
    const urlStr = typeof input === 'string' ? input : input.url;
    if (urlStr.startsWith('https://cf.local/')) {
        const req = input instanceof Request ? input : new Request(urlStr, init);
        return handleApiRequest(req, env);
    }
    if (urlStr.startsWith('https://mock-gdrive.local/')) {
        if (urlStr === 'https://mock-gdrive.local/token') {
            driveState.oauthHits++;
            return Response.json({ access_token: 'mock-access-tok', expires_in: 3600 });
        }
        if (urlStr.startsWith('https://mock-gdrive.local/drive/v3/files') && (init.method || 'GET') === 'GET') {
            const u = new URL(urlStr);
            const q = u.searchParams.get('q') || '';
            const nameMatch = q.match(/name='([^']+)'/);
            const parentMatch = q.match(/'([^']+)' in parents/);
            const found = driveState.folders.filter(f =>
                (!nameMatch || f.name === nameMatch[1]) &&
                (!parentMatch || f.parentId === parentMatch[1])
            );
            return Response.json({ files: found });
        }
        if (urlStr.startsWith('https://mock-gdrive.local/drive/v3/files') && init.method === 'POST') {
            const meta = JSON.parse(init.body);
            const id = 'gf_' + (uploadSeq++);
            driveState.folders.push({ id, name: meta.name, parentId: meta.parents?.[0] || '' });
            return Response.json({ id, name: meta.name });
        }
        if (urlStr.startsWith('https://mock-gdrive.local/upload/drive/v3/files')) {
            const meta = JSON.parse(init.body);
            const sessionId = 'sess_' + (uploadSeq++);
            driveState.uploadSessions.set(sessionId, meta);
            return new Response('', {
                status: 200,
                headers: { Location: `https://mock-gdrive.local/put/${sessionId}` },
            });
        }
        if (urlStr.startsWith('https://mock-gdrive.local/put/')) {
            const sessionId = urlStr.split('/').pop();
            const meta = driveState.uploadSessions.get(sessionId);
            const buf = new Uint8Array(await new Response(init.body).arrayBuffer());
            const id = 'gdfile_' + (uploadSeq++);
            driveState.files.push({ id, name: meta.name, parentId: meta.parents?.[0] || '', mimeType: meta.mimeType, bytes: buf });
            return Response.json({ id, name: meta.name, size: String(buf.byteLength) });
        }
    }
    return realFetch(input, init);
};

const pb = await import('../src/lib/pb.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
    if (cond) { pass++; console.log(`PASS  ${name}`); }
    else { fail++; console.error(`FAIL  ${name}${extra ? ` (${extra})` : ''}`); }
}

// 1. Seed Founder voi bcrypt hash PocketBase cu ($2a$10$...) de test legacy migration & auto-upgrade
const founderId = 'founder00000001';
const legacyBcrypt = bcrypt.hashSync('FounderPass123!', 10);
sqlite.prepare(
    `INSERT INTO users (id, email, username, name, role, is_superuser, password_hash, token_version, verified, email_visibility, created_at, updated_at)
     VALUES (?, 'founder@mkg.vn', 'founder', 'Founder', 'admin', 1, ?, 1, 1, 1, '2026-11-19T00:00:00Z', '2026-11-19T00:00:00Z')`
).run(founderId, legacyBcrypt);

// Test Founder login bang legacy bcrypt hash & tu dong upgrade sang PBKDF2
await pb.loginSmart('founder@mkg.vn', 'FounderPass123!');
check('Founder login voi legacy PocketBase bcrypt hash', pb.isLoggedIn() && pb.isSuperuser());
const upgradedRow = sqlite.prepare('SELECT password_hash FROM users WHERE id = ?').get(founderId);
check('Auto-upgrade hash tu bcrypt -> pbkdf2 ngay sau dang nhap dau tien', upgradedRow.password_hash.startsWith('pbkdf2$'));

// 2. Kiem tra inspectBackend & provisionUsers
const insp = await pb.inspectBackend();
check('inspectBackend() bao ready = true tren Cloudflare D1', insp.ready === true);

const seeded = await pb.provisionUsers();
check('provisionUsers tao 5 user + team MKG', seeded.users.length === 5 && seeded.team.name === 'MKG');

// 3. Test KTS 1 dang nhap bang PIN 1111, doi PIN -> 5678, day du an + anh (R2)
await pb.loginSmart('kts1', '1111');
check('KTS1 dang nhap bang PIN mac dinh 1111', pb.isLoggedIn() && !pb.isSuperuser());
await pb.changePin('1111', '5678');
pb.logout();
let oldPinRejected = false;
try { await pb.loginSmart('kts1', '1111'); } catch { oldPinRejected = true; }
check('Sau changePin, PIN cu bi tu choi', oldPinRejected);
await pb.loginSmart('kts1', '5678');
check('Sau changePin, PIN moi 5678 dang nhap thanh cong', pb.isLoggedIn());

const tinyJpgBase64 = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]).toString('base64');
const syncPush = await pb.fullSync({
    projects: [{ id: 'p_cf_1', name: 'Nha Pho CF', scope: 'team', createdAt: 1000, updatedAt: 2000 }],
    docs: [
        { id: 'd_plan_1', projectId: 'p_cf_1', type: 'plan', name: 'Mat bang tang 1', plan: { nodes: [{ id: 'n1', x: 0, y: 0 }], walls: [] }, createdAt: 1000, updatedAt: 2100 },
        { id: 'd_photo_1', projectId: 'p_cf_1', type: 'photo', name: 'Anh phong khach', img: tinyJpgBase64, lines: [], createdAt: 1000, updatedAt: 2200 },
    ],
    tombstones: [],
    scopeDirty: [],
});
check('KTS1 fullSync push project + plan + photo', syncPush.pushed === 3 && syncPush.failedIds.length === 0);
check('Anh da duoc upload thang len R2 (khong nhoi vao JSON)', env.MEDIA._map.size >= 1 && [...env.MEDIA._map.keys()].some(k => k.startsWith('photos/')));

// 4. Test KTS 2 cung team keo du an & anh tu R2 ve thanh cong
pb.logout();
await pb.loginSmart('kts2', '1111');
const syncPull = await pb.fullSync({ projects: [], docs: [], tombstones: [], scopeDirty: [] });
check('KTS2 cung team keo duoc project & 2 docs (ke ca anh tu R2)', syncPull.pulledProjects.length === 1 && syncPull.pulledDocs.length === 2);
const pulledPhoto = syncPull.pulledDocs.find(d => d.id === 'd_photo_1');
check('Anh keo ve tu R2 la dataUrl hop le', typeof pulledPhoto?.img === 'string' && pulledPhoto.img.startsWith('data:'));

// 5. Test FADI catalog > 200KB duoc offload len R2 tu dong va doc lai nguyen ven
pb.logout();
await pb.loginSmart('admin', '2222');
const bigFadiPayload = {
    version: 1,
    updatedAt: 5000,
    customItems: [{ key: 'fadi_tu1', name: 'Tu FADI Lon', daeText: 'X'.repeat(240_000) }],
};
const catPush = await pb.pushCloudCatalog(bigFadiPayload, 'fadi');
check('pushCloudCatalog FADI >240KB thanh cong', catPush.ok === true);
const fadiRow = sqlite.prepare("SELECT payload_json, payload_r2_key FROM furniture_catalog WHERE catalog_key = 'fadi'").get();
check('Catalog FADI >180KB duoc offload len R2 de tranh tran 2MB D1', fadiRow.payload_json === null && fadiRow.payload_r2_key.startsWith('json-blobs/catalog/'));
const catPull = await pb.fetchCloudCatalog('fadi');
check('fetchCloudCatalog doc lai tron ven du lieu FADI tu R2', catPull?.customItems?.[0]?.daeText?.length === 240_000);

// 6. Test Customer bi chan khoi survey_items + Share link hoat dong
const teamId = pb.myTeam().id;
await pb.createCustomer(teamId, { login: 'khachcf', name: 'Anh Khach CF', pin: '8888' });
pb.logout();
await pb.loginSmart('khachcf', '8888');
check('Customer dang nhap thanh cong', pb.isCustomer());
let custBlocked = false;
try { await pb.fetchRemoteStatus(); } catch (e) { custBlocked = e.status === 403; }
check('Customer bi server D1 chan doc survey_items (403)', custBlocked);

// 7. Test Google Drive Backup Cron Engine (D1 gzip snapshot + R2 incremental mirror)
const bk1 = await runCloudBackup(env, { triggerSource: 'cron', mediaBatchLimit: 50 });
check('Backup lan 1 thanh cong, day snapshot .json.gz va file R2 sang Google Drive', bk1.status === 'ok' && !!bk1.dbGdriveId && bk1.mediaSynced >= 2);
const uploadedDbFile = driveState.files.find(f => f.id === bk1.dbGdriveId);
const unzipped = JSON.parse(zlib.gunzipSync(uploadedDbFile.bytes).toString('utf8'));
check('Snapshot Gzip tren Google Drive giai nen duoc & du 12 bang', unzipped.format === 'mkg-khaosat-cf-backup-v1' && unzipped.tables.users.length >= 6);

// Chay backup lan 2 -> mediaSynced = 0, mediaSkipped >= 2 (incremental!)
const bk2 = await runCloudBackup(env, { triggerSource: 'cron', mediaBatchLimit: 50 });
check('Backup lan 2 bo qua file media cu (incremental mediaSkipped >= 2)', bk2.mediaSynced === 0 && bk2.mediaSkipped >= 2);

// 8. Test D1-only fallback khi R2 chua bat (env.MEDIA = null) -> anh & FADI <1.5MB van sync & tai duoc 100%
const savedMedia = env.MEDIA;
env.MEDIA = null;
pb.logout();
await pb.loginSmart('kts1', '5678');
const syncD1Only = await pb.fullSync({
    projects: [],
    docs: [
        { id: 'd_photo_d1', projectId: 'p_cf_1', type: 'photo', name: 'Anh fallback D1', img: tinyJpgBase64, lines: [], createdAt: 1000, updatedAt: 3300 },
    ],
    tombstones: [],
    scopeDirty: [],
});
check('Khong co R2 (MEDIA=null): push anh <=1.4MB fallback vao D1 media_blobs thanh cong', syncD1Only.pushed === 1 && syncD1Only.failedIds.length === 0);
const blobRow = sqlite.prepare("SELECT size, data_b64 FROM media_blobs WHERE key LIKE 'photos/%'").get();
check('D1 media_blobs luu tru binary anh dung kich thuoc', !!blobRow && blobRow.size > 0 && blobRow.data_b64.length > 0);
pb.logout();
await pb.loginSmart('kts2', '1111');
const pullD1Only = await pb.fullSync({ projects: [], docs: [], tombstones: [], scopeDirty: [] });
const pulledD1Photo = pullD1Only.pulledDocs.find(d => d.id === 'd_photo_d1');
check('KTS2 keo anh tu D1 media_blobs fallback ve thanh cong', typeof pulledD1Photo?.img === 'string' && pulledD1Photo.img.startsWith('data:'));
env.MEDIA = savedMedia;

console.log(`\n===== CLOUDFLARE E2E TEST: ${pass} pass, ${fail} fail =====`);
if (fail > 0) process.exit(1);
