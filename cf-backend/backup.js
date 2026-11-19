// Engine sao luu dinh ky D1 + R2 -> Google Drive (tang dan / incremental, it RAM, an toan 128MB).

import { genId15 } from './crypto.js';
import {
    isGdriveConfigured,
    getGdriveAccessToken,
    findOrCreateFolder,
    uploadFileToDrive,
    pruneOldDriveFiles,
} from './gdrive.js';

const BACKUP_TABLES = [
    'users',
    'teams',
    'team_members',
    'survey_items',
    'deletions',
    'shares',
    'customer_profiles',
    'customer_submissions',
    'furniture_catalog',
    'signup_requests',
    'experience_posts',
    'backup_media_manifest',
    'media_blobs',
];

export async function dumpDatabaseSnapshot(db) {
    const tables = {};
    for (const table of BACKUP_TABLES) {
        const rows = [];
        const pageSize = table === 'media_blobs' ? 20 : 400;
        for (let offset = 0; ; offset += pageSize) {
            const res = await db.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).bind(pageSize, offset).all().catch(() => ({ results: [] }));
            const batch = res?.results || [];
            rows.push(...batch);
            if (batch.length < pageSize) break;
        }
        tables[table] = rows;
    }
    return {
        format: 'mkg-khaosat-cf-backup-v1',
        exportedAt: new Date().toISOString(),
        exportedMs: Date.now(),
        tables,
    };
}

export async function gzipString(text) {
    const bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream === 'function') {
        const cs = new CompressionStream('gzip');
        const writer = cs.writable.getWriter();
        writer.write(bytes);
        writer.close();
        const buf = await new Response(cs.readable).arrayBuffer();
        return new Uint8Array(buf);
    }
    return bytes;
}

function timestampSlug(ms = Date.now()) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    // Hien thi theo gio VN UTC+7 de de nhan biet ngay backup
    const vn = new Date(d.getTime() + 7 * 3600_000);
    return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}_${pad(vn.getUTCHours())}${pad(vn.getUTCMinutes())}`;
}

async function listAllR2Objects(bucket, excludePrefix = 'backups/') {
    const out = [];
    let cursor;
    for (;;) {
        const listed = await bucket.list({ cursor, limit: 500 });
        for (const obj of listed.objects || []) {
            if (excludePrefix && obj.key.startsWith(excludePrefix)) continue;
            out.push(obj);
        }
        if (!listed.truncated || !listed.cursor) break;
        cursor = listed.cursor;
    }
    return out;
}

async function pruneOldR2Backups(bucket, keepCount = 30) {
    const listed = await bucket.list({ prefix: 'backups/db/', limit: 500 });
    const items = [...(listed.objects || [])].sort((a, b) => a.key.localeCompare(b.key)).reverse();
    if (items.length <= keepCount) return 0;
    let deleted = 0;
    for (const obj of items.slice(keepCount)) {
        await bucket.delete(obj.key).catch(() => {});
        deleted++;
    }
    return deleted;
}

export async function runCloudBackup(env, opts = {}) {
    if (!env?.DB) throw new Error('Thieu binding D1 (DB)');
    const triggerSource = opts.triggerSource || 'cron';
    const mediaBatchLimit = Math.max(1, Number(opts.mediaBatchLimit ?? env.BACKUP_MEDIA_BATCH ?? 45));
    const keepSnapshots = Math.max(3, Number(opts.keepSnapshots ?? env.GDRIVE_KEEP_SNAPSHOTS ?? 30));
    const runId = 'bk_' + genId15();
    const startedAt = Date.now();
    const isGz = typeof CompressionStream === 'function';
    const snapshotName = `mkg-db-${timestampSlug(startedAt)}.json${isGz ? '.gz' : ''}`;
    const r2BackupKey = `backups/db/${snapshotName}`;

    await env.DB.prepare(
        `INSERT INTO backup_runs (id, started_at, trigger_source, status, db_file_name, db_r2_key)
         VALUES (?, ?, ?, 'running', ?, ?)`
    ).bind(runId, startedAt, triggerSource, snapshotName, env.MEDIA ? r2BackupKey : '').run();

    let dbGdriveId = '';
    let dbBytes = 0;
    let mediaTotal = 0;
    let mediaSynced = 0;
    let mediaSkipped = 0;
    let mediaFailed = 0;
    let mediaBytes = 0;
    let mediaPending = 0;
    const errors = [];

    try {
        // 1. Chup toan bo database D1 & nen gzip
        const snapshot = await dumpDatabaseSnapshot(env.DB);
        const gzBytes = await gzipString(JSON.stringify(snapshot));
        dbBytes = gzBytes.byteLength;

        // 2. Luu 1 ban du phong noi bo tren R2 (neu R2 da bat)
        if (env.MEDIA) {
            await env.MEDIA.put(r2BackupKey, gzBytes, {
                httpMetadata: { contentType: isGz ? 'application/gzip' : 'application/json' },
            });
            await pruneOldR2Backups(env.MEDIA, keepSnapshots).catch(() => {});
        }

        // 3. Day ban chup D1 + media moi sang Google Drive (off-site)
        if (!opts.skipGdrive && isGdriveConfigured(env)) {
            const token = await getGdriveAccessToken(env);
            const rootId = env.GDRIVE_FOLDER_ID
                ? env.GDRIVE_FOLDER_ID
                : await findOrCreateFolder(env, token, 'MKG-KhaoSat-Backups');
            const dbFolderId = await findOrCreateFolder(env, token, 'db-snapshots', rootId);
            const mediaFolderId = await findOrCreateFolder(env, token, 'media-files', rootId);

            const uploadedDb = await uploadFileToDrive(env, token, {
                name: snapshotName,
                parentId: dbFolderId,
                mimeType: isGz ? 'application/gzip' : 'application/json',
                body: gzBytes,
                byteLength: gzBytes.byteLength,
            });
            dbGdriveId = uploadedDb?.id || '';
            await pruneOldDriveFiles(env, token, dbFolderId, keepSnapshots).catch(() => {});

            if (env.MEDIA) {
                const objects = await listAllR2Objects(env.MEDIA, 'backups/');
                mediaTotal = objects.length;

                const manifestRows = new Map();
                const mfRes = await env.DB.prepare('SELECT r2_key, etag, gdrive_file_id FROM backup_media_manifest').all();
                for (const r of mfRes.results || []) manifestRows.set(r.r2_key, r);

                const subfolderCache = new Map();
                const folderForCategory = async (catName) => {
                    if (subfolderCache.has(catName)) return subfolderCache.get(catName);
                    const id = await findOrCreateFolder(env, token, catName, mediaFolderId);
                    subfolderCache.set(catName, id);
                    return id;
                };

                const todo = [];
                for (const obj of objects) {
                    const existing = manifestRows.get(obj.key);
                    const etag = obj.httpEtag || obj.etag || String(obj.size);
                    if (existing && existing.etag === etag && existing.gdrive_file_id) {
                        mediaSkipped++;
                    } else {
                        todo.push({ obj, etag, existingId: existing?.gdrive_file_id || '' });
                    }
                }

                const batch = todo.slice(0, mediaBatchLimit);
                mediaPending = Math.max(0, todo.length - batch.length);

                for (const item of batch) {
                    const key = item.obj.key;
                    try {
                        const r2Obj = await env.MEDIA.get(key);
                        if (!r2Obj) continue;
                        const parts = key.split('/');
                        const category = parts.length > 1 ? parts[0] : 'other';
                        const flatName = parts.slice(1).join('__') || key;
                        const targetFolderId = await folderForCategory(category);
                        const mimeType = r2Obj.httpMetadata?.contentType || 'application/octet-stream';

                        const uploaded = await uploadFileToDrive(env, token, {
                            name: flatName,
                            parentId: targetFolderId,
                            mimeType,
                            body: r2Obj.body,
                            byteLength: r2Obj.size,
                            existingFileId: item.existingId,
                        });
                        const fileId = uploaded?.id || item.existingId || '';
                        await env.DB.prepare(
                            `INSERT INTO backup_media_manifest (r2_key, etag, size, gdrive_file_id, gdrive_folder_id, backed_up_at)
                             VALUES (?, ?, ?, ?, ?, ?)
                             ON CONFLICT(r2_key) DO UPDATE SET
                                etag=excluded.etag, size=excluded.size,
                                gdrive_file_id=excluded.gdrive_file_id,
                                gdrive_folder_id=excluded.gdrive_folder_id,
                                backed_up_at=excluded.backed_up_at`
                        ).bind(key, item.etag, r2Obj.size || 0, fileId, targetFolderId, Date.now()).run();

                        mediaSynced++;
                        mediaBytes += Number(r2Obj.size || 0);
                    } catch (err) {
                        mediaFailed++;
                        errors.push(`${key}: ${err.message}`);
                    }
                }
            }
        } else if (!opts.skipGdrive) {
            errors.push('Chua cau hinh Google Drive secrets — da chup snapshot noi bo R2.');
        }

        const status = mediaFailed > 0 || (errors.length && !dbGdriveId) ? 'partial' : 'ok';
        const finishedAt = Date.now();
        await env.DB.prepare(
            `UPDATE backup_runs SET
                finished_at=?, status=?, db_gdrive_id=?, db_bytes=?,
                media_total=?, media_synced=?, media_skipped=?, media_failed=?, media_bytes=?, error_text=?
             WHERE id=?`
        ).bind(
            finishedAt, status, dbGdriveId, dbBytes,
            mediaTotal, mediaSynced, mediaSkipped, mediaFailed, mediaBytes, errors.slice(0, 8).join('\n'),
            runId,
        ).run();

        return {
            runId, status, snapshotName, r2BackupKey: env.MEDIA ? r2BackupKey : '',
            dbGdriveId, dbBytes, mediaTotal, mediaSynced, mediaSkipped, mediaPending, mediaFailed, mediaBytes,
            gdriveConfigured: isGdriveConfigured(env),
            errors,
        };
    } catch (err) {
        await env.DB.prepare(
            `UPDATE backup_runs SET finished_at=?, status='error', error_text=? WHERE id=?`
        ).bind(Date.now(), String(err?.message || err), runId).run().catch(() => {});
        throw err;
    }
}

export async function getBackupStatus(env) {
    const runsRes = await env.DB.prepare(
        `SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 15`
    ).all().catch(() => ({ results: [] }));
    const mfRow = await env.DB.prepare(
        `SELECT COUNT(*) as count, COALESCE(SUM(size), 0) as total_bytes FROM backup_media_manifest`
    ).first().catch(() => ({ count: 0, total_bytes: 0 }));

    let r2MediaCount = null;
    if (env.MEDIA) {
        const objs = await listAllR2Objects(env.MEDIA, 'backups/').catch(() => null);
        if (objs) r2MediaCount = objs.length;
    }

    return {
        backend: 'cloudflare',
        d1Ready: !!env.DB,
        r2Ready: !!env.MEDIA,
        gdriveConfigured: isGdriveConfigured(env),
        manifestCount: Number(mfRow?.count || 0),
        manifestBytes: Number(mfRow?.total_bytes || 0),
        r2MediaCount,
        runs: runsRes?.results || [],
    };
}
