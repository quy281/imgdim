#!/usr/bin/env node
/**
 * Cong cu chuyen du lieu (Migration) & Khoi phuc thảm hoa (Restore) cho MKG Khao Sat:
 *
 * 1) Tu file backup PocketBase (`data.db` + `storage/` — KHUYEN DUNG vi giu nguyen 100% password/PIN cu):
 *      node scripts/migrate-pb-to-cf.mjs --pb-dir C:\path\to\extracted_pb_backup --out .tmp-cf-migrate
 *
 * 2) Tu PocketBase API dang chay (https://db.mkg.vn):
 *      PB_EMAIL=founder@mkg.vn PB_PASSWORD='***' node scripts/migrate-pb-to-cf.mjs --pb-live --out .tmp-cf-migrate
 *
 * 3) Khoi phuc tu file backup Google Drive (`mkg-db-YYYY-MM-DD_HHmm.json.gz`):
 *      node scripts/migrate-pb-to-cf.mjs --restore-file C:\Downloads\mkg-db-2026-11-19.json.gz --out .tmp-cf-restore
 *
 * Them `--push --db mkg-khaosat-db --bucket mkg-khaosat-media` de day thang len Cloudflare D1 + R2 (`--remote`).
 * Mac dinh chi xuat file SQL + media staging ra thu muc `--out` de kiem tra an toan truoc khi push.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const argVal = (f, def = '') => {
    const i = args.indexOf(f);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const OUT_DIR = path.resolve(argVal('--out', '.audit_tmp/cf-migrate'));
const PB_DIR = argVal('--pb-dir');
const PB_LIVE = hasFlag('--pb-live');
const RESTORE_FILE = argVal('--restore-file');
const PB_URL = argVal('--pb-url', process.env.PB_URL || 'https://db.mkg.vn').replace(/\/+$/, '');
const PB_EMAIL = argVal('--pb-email', process.env.PB_EMAIL || '');
const PB_PASSWORD = argVal('--pb-password', process.env.PB_PASSWORD || '');
const FALLBACK_PIN = argVal('--fallback-pin', '1111');
const PUSH = hasFlag('--push');
const DB_NAME = argVal('--db', 'mkg-khaosat-db');
const BUCKET_NAME = argVal('--bucket', 'mkg-khaosat-media');
const LOCAL = hasFlag('--local');
const INLINE_JSON_LIMIT = 180_000;

function pbkdf2Node(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(String(password), salt, 100_000, 32, 'sha256');
    return `pbkdf2$100000$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function sqlLit(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
    if (typeof v === 'boolean') return v ? '1' : '0';
    const s = String(v).replace(/\0/g, '').replace(/'/g, "''");
    return `'${s}'`;
}

function makeInsert(table, cols, row) {
    const vals = cols.map(c => sqlLit(row[c]));
    return `INSERT OR REPLACE INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});`;
}

function stageBlob(outDir, key, bufOrStr, contentType = 'application/json; charset=utf-8') {
    const dest = path.join(outDir, 'r2', key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bufOrStr);
    return { key, file: dest, contentType };
}

function maybeOffloadJson(outDir, folder, id, val) {
    if (val === null || val === undefined || val === '') return { jsonText: null, r2Key: '', upload: null };
    const text = typeof val === 'string' ? val : JSON.stringify(val);
    if (text.length <= INLINE_JSON_LIMIT) return { jsonText: text, r2Key: '', upload: null };
    const key = `json-blobs/${folder}/${id}.json`;
    const upload = stageBlob(outDir, key, text, 'application/json; charset=utf-8');
    return { jsonText: null, r2Key: key, upload };
}

function parseJsonSafe(v, fallback = null) {
    if (v === null || v === undefined || v === '') return fallback;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return fallback; }
}

function findStorageFile(storageRoot, recId, filename) {
    if (!storageRoot || !filename) return null;
    // PocketBase luu theo <storage>/<collectionId>/<recId>/<filename>
    if (!fs.existsSync(storageRoot)) return null;
    for (const colDir of fs.readdirSync(storageRoot, { withFileTypes: true })) {
        if (!colDir.isDirectory()) continue;
        const candidate = path.join(storageRoot, colDir.name, recId, filename);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function fromPocketBaseBackupDir(pbDir, outDir) {
    const dataDbPath = fs.existsSync(path.join(pbDir, 'data.db'))
        ? path.join(pbDir, 'data.db')
        : path.join(pbDir, 'pb_data', 'data.db');
    const storageRoot = fs.existsSync(path.join(pbDir, 'storage'))
        ? path.join(pbDir, 'storage')
        : path.join(pbDir, 'pb_data', 'storage');

    if (!fs.existsSync(dataDbPath)) {
        throw new Error(`Khong tim thay data.db trong ${pbDir}`);
    }
    console.log(`> Doc PocketBase SQLite: ${dataDbPath}`);
    const sqlite = new DatabaseSync(dataDbPath, { readOnly: true });
    const hasTable = (name) => !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    const readTable = (name) => (hasTable(name) ? sqlite.prepare(`SELECT * FROM "${name}"`).all() : []);

    const suRows = hasTable('_superusers') ? readTable('_superusers') : (hasTable('_admins') ? readTable('_admins') : []);
    const userRows = readTable('users');
    const suEmails = new Set(suRows.map(s => String(s.email || '').toLowerCase()).filter(Boolean));

    const users = [];
    const seenEmails = new Set();
    for (const u of userRows) {
        const email = String(u.email || '').toLowerCase();
        if (email) seenEmails.add(email);
        const suMatch = suRows.find(s => String(s.email || '').toLowerCase() === email);
        users.push({
            id: u.id,
            email: u.email || '',
            username: u.username || (email.split('@')[0] || u.id),
            name: u.name || '',
            role: u.role || '',
            is_superuser: suEmails.has(email) ? 1 : 0,
            // Giu nguyen bcrypt hash tu PocketBase; neu la superuser thi dung hash su neu users rong
            password_hash: u.password || u.passwordHash || suMatch?.password || suMatch?.passwordHash || '',
            token_version: 1,
            verified: u.verified ? 1 : 1,
            email_visibility: u.emailVisibility ? 1 : 0,
            created_at: u.created || new Date().toISOString(),
            updated_at: u.updated || new Date().toISOString(),
        });
    }
    for (const s of suRows) {
        const email = String(s.email || '').toLowerCase();
        if (!email || seenEmails.has(email)) continue;
        users.push({
            id: s.id,
            email: s.email,
            username: email.split('@')[0],
            name: 'Founder',
            role: 'admin',
            is_superuser: 1,
            password_hash: s.password || s.passwordHash || '',
            token_version: 1,
            verified: 1,
            email_visibility: 1,
            created_at: s.created || new Date().toISOString(),
            updated_at: s.updated || new Date().toISOString(),
        });
    }

    const teams = [];
    const team_members = [];
    for (const t of readTable('teams')) {
        teams.push({
            id: t.id, name: t.name || '', slug: t.slug || t.id,
            created_at: t.created || new Date().toISOString(),
            updated_at: t.updated || new Date().toISOString(),
        });
        const mems = parseJsonSafe(t.members, []);
        if (Array.isArray(mems)) {
            for (const uid of new Set(mems.filter(Boolean))) {
                team_members.push({ team_id: t.id, user_id: String(uid) });
            }
        }
    }

    const uploads = [];
    const survey_items = [];
    for (const r of readTable('survey_items')) {
        const off = maybeOffloadJson(outDir, 'survey_items', r.id, parseJsonSafe(r.data, r.data));
        if (off.upload) uploads.push(off.upload);
        let photoR2 = '';
        if (r.photo) {
            const localFile = findStorageFile(storageRoot, r.id, r.photo);
            if (localFile) {
                photoR2 = `photos/${r.id}/${String(r.photo).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                uploads.push(stageBlob(outDir, photoR2, fs.readFileSync(localFile), 'image/jpeg'));
            }
        }
        survey_items.push({
            id: r.id, owner: r.owner || '', owner_name: r.owner_name || '',
            item_id: r.item_id || r.id, kind: r.kind || 'doc', project_id: r.project_id || r.item_id || '',
            name: r.name || '', scope: r.scope || 'team', team: r.team || '',
            updated_ms: Number(r.updated_ms || 0), deleted: r.deleted ? 1 : 0,
            rev: Number(r.rev || 1), schema_v: Number(r.schema_v || 3),
            photo: r.photo || '', photo_r2_key: photoR2, photo_hash: r.photo_hash || '',
            data_json: off.jsonText, data_r2_key: off.r2Key,
            created_at: r.created || new Date().toISOString(),
            updated_at: r.updated || new Date().toISOString(),
        });
    }

    const deletions = readTable('deletions').map(d => ({
        id: d.id, item_id: d.item_id, kind: d.kind || 'doc',
        at: Number(d.at || 0), by: d.by || '', created_at: d.created || new Date().toISOString(),
    }));

    const shares = readTable('shares').map(s => {
        const off = maybeOffloadJson(outDir, 'shares', s.id, parseJsonSafe(s.payload, s.payload));
        if (off.upload) uploads.push(off.upload);
        return {
            id: s.id, owner: s.owner || '', project_id: s.project_id || '',
            title: s.title || '', payload_json: off.jsonText, payload_r2_key: off.r2Key,
            revoked: s.revoked ? 1 : 0, expires: s.expires || '',
            created_at: s.created || new Date().toISOString(),
            updated_at: s.updated || new Date().toISOString(),
        };
    });

    const customer_profiles = readTable('customer_profiles').map(p => ({
        id: p.id, user: p.user, team: p.team, name: p.name || '', phone: p.phone || '',
        active: p.active === 0 ? 0 : 1,
        created_at: p.created || new Date().toISOString(),
        updated_at: p.updated || new Date().toISOString(),
    }));

    const customer_submissions = readTable('customer_submissions').map(c => {
        const off = maybeOffloadJson(outDir, 'submissions', c.id, parseJsonSafe(c.payload, c.payload));
        if (off.upload) uploads.push(off.upload);
        return {
            id: c.id, owner: c.owner, customer_name: c.customer_name || '', team: c.team || '',
            source_project_id: c.source_project_id || '', submission_key: c.submission_key || '',
            title: c.title || '', payload_json: off.jsonText, payload_r2_key: off.r2Key,
            status: c.status || 'submitted', submitted_ms: Number(c.submitted_ms || 0),
            reviewed_by: c.reviewed_by || '', reviewed_ms: Number(c.reviewed_ms || 0),
            created_at: c.created || new Date().toISOString(),
            updated_at: c.updated || new Date().toISOString(),
        };
    });

    const furniture_catalog = readTable('furniture_catalog').map(f => {
        const off = maybeOffloadJson(outDir, 'catalog', f.catalog_key, parseJsonSafe(f.payload, f.payload));
        if (off.upload) uploads.push(off.upload);
        return {
            id: f.id, catalog_key: f.catalog_key, payload_json: off.jsonText, payload_r2_key: off.r2Key,
            updated_ms: Number(f.updated_ms || 0), updated_by: f.updated_by || '',
            created_at: f.created || new Date().toISOString(),
            updated_at: f.updated || new Date().toISOString(),
        };
    });

    const signup_requests = readTable('signup_requests').map(r => ({
        id: r.id, name: r.name || '', email: r.email || '', phone: r.phone || '', note: r.note || '',
        status: r.status || 'pending', requested_ms: Number(r.requested_ms || 0),
        reviewed_ms: Number(r.reviewed_ms || 0), reviewed_by: r.reviewed_by || '',
        team: r.team || '', user: r.user || '',
        created_at: r.created || new Date().toISOString(),
        updated_at: r.updated || new Date().toISOString(),
    }));

    const experience_posts = readTable('experience_posts').map(e => ({
        id: e.id, owner: e.owner || '', owner_name: e.owner_name || '', category: e.category || '',
        type: e.type || 'video', title: e.title || '', desc: e.desc || '',
        detail_url: e.detail_url || '', embed_url: e.embed_url || '', status: e.status || 'pending',
        submitted_ms: Number(e.submitted_ms || 0), reviewed_by: e.reviewed_by || '',
        reviewed_ms: Number(e.reviewed_ms || 0),
        created_at: e.created || new Date().toISOString(),
        updated_at: e.updated || new Date().toISOString(),
    }));

    sqlite.close();
    return {
        tables: {
            users, teams, team_members, survey_items, deletions, shares,
            customer_profiles, customer_submissions, furniture_catalog, signup_requests, experience_posts,
        },
        uploads,
    };
}

async function fromPocketBaseLive(pbUrl, email, password, outDir) {
    if (!email || !password) {
        throw new Error('Thieu --pb-email / --pb-password de dang nhap superuser db.mkg.vn');
    }
    console.log(`> Dang nhap PocketBase live: ${pbUrl}`);
    const authRes = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: email, password }),
    });
    if (!authRes.ok) {
        throw new Error(`Dang nhap superuser that bai (${authRes.status}): ${await authRes.text()}`);
    }
    const { token, record: suRec } = await authRes.json();
    const listAll = async (col) => {
        const items = [];
        for (let page = 1; ; page++) {
            const res = await fetch(`${pbUrl}/api/collections/${col}/records?page=${page}&perPage=500`, {
                headers: { Authorization: token },
            });
            if (res.status === 404) return [];
            if (!res.ok) throw new Error(`Doc ${col} loi (${res.status})`);
            const j = await res.json();
            items.push(...(j.items || []));
            if (page >= (j.totalPages || 1)) break;
        }
        return items;
    };

    const fTokRes = await fetch(`${pbUrl}/api/files/token`, { method: 'POST', headers: { Authorization: token } });
    const fTok = fTokRes.ok ? (await fTokRes.json()).token : '';

    const defaultPinHash = pbkdf2Node(`mkgks-${FALLBACK_PIN}-v1`);
    const founderHash = pbkdf2Node(password);

    const pbUsers = await listAll('users');
    const suEmailLow = String(email).toLowerCase();
    const users = pbUsers.map(u => {
        const isSu = String(u.email || '').toLowerCase() === suEmailLow ? 1 : 0;
        return {
            id: u.id, email: u.email || '', username: u.username || u.email?.split('@')[0] || u.id,
            name: u.name || '', role: u.role || '', is_superuser: isSu,
            // HTTP API PocketBase an passwordHash -> dat hash PIN tam cho nhan vien/khach, giu mat khau that cho Founder
            password_hash: isSu ? founderHash : defaultPinHash,
            token_version: 1, verified: 1, email_visibility: u.emailVisibility ? 1 : 0,
            created_at: u.created || new Date().toISOString(),
            updated_at: u.updated || new Date().toISOString(),
        };
    });
    if (!users.some(u => u.is_superuser === 1)) {
        users.push({
            id: suRec.id, email: suRec.email || email, username: email.split('@')[0], name: 'Founder',
            role: 'admin', is_superuser: 1, password_hash: founderHash, token_version: 1,
            verified: 1, email_visibility: 1,
            created_at: suRec.created || new Date().toISOString(),
            updated_at: suRec.updated || new Date().toISOString(),
        });
    }

    const teams = [];
    const team_members = [];
    for (const t of await listAll('teams')) {
        teams.push({ id: t.id, name: t.name, slug: t.slug, created_at: t.created, updated_at: t.updated });
        for (const uid of new Set(t.members || [])) team_members.push({ team_id: t.id, user_id: uid });
    }

    const uploads = [];
    const survey_items = [];
    const rawItems = await listAll('survey_items');
    console.log(`> Tai ${rawItems.length} records + anh tu survey_items...`);
    for (const r of rawItems) {
        const off = maybeOffloadJson(outDir, 'survey_items', r.id, r.data);
        if (off.upload) uploads.push(off.upload);
        let photoR2 = '';
        if (r.photo) {
            const url = `${pbUrl}/api/files/survey_items/${r.id}/${encodeURIComponent(r.photo)}${fTok ? `?token=${fTok}` : ''}`;
            const imgRes = await fetch(url);
            if (imgRes.ok) {
                const buf = Buffer.from(await imgRes.arrayBuffer());
                photoR2 = `photos/${r.id}/${String(r.photo).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                uploads.push(stageBlob(outDir, photoR2, buf, imgRes.headers.get('content-type') || 'image/jpeg'));
            }
        }
        survey_items.push({
            id: r.id, owner: r.owner || '', owner_name: r.owner_name || '',
            item_id: r.item_id || r.id, kind: r.kind || 'doc', project_id: r.project_id || r.item_id || '',
            name: r.name || '', scope: r.scope || 'team', team: r.team || '',
            updated_ms: Number(r.updated_ms || 0), deleted: r.deleted ? 1 : 0,
            rev: Number(r.rev || 1), schema_v: Number(r.schema_v || 3),
            photo: r.photo || '', photo_r2_key: photoR2, photo_hash: r.photo_hash || '',
            data_json: off.jsonText, data_r2_key: off.r2Key,
            created_at: r.created || new Date().toISOString(),
            updated_at: r.updated || new Date().toISOString(),
        });
    }

    const deletions = (await listAll('deletions')).map(d => ({
        id: d.id, item_id: d.item_id, kind: d.kind || 'doc',
        at: Number(d.at || 0), by: d.by || '', created_at: d.created || new Date().toISOString(),
    }));
    const shares = (await listAll('shares')).map(s => {
        const off = maybeOffloadJson(outDir, 'shares', s.id, s.payload);
        if (off.upload) uploads.push(off.upload);
        return {
            id: s.id, owner: s.owner || '', project_id: s.project_id || '',
            title: s.title || '', payload_json: off.jsonText, payload_r2_key: off.r2Key,
            revoked: s.revoked ? 1 : 0, expires: s.expires || '',
            created_at: s.created, updated_at: s.updated,
        };
    });
    const customer_profiles = (await listAll('customer_profiles')).map(p => ({
        id: p.id, user: p.user, team: p.team, name: p.name || '', phone: p.phone || '',
        active: p.active === false ? 0 : 1, created_at: p.created, updated_at: p.updated,
    }));
    const customer_submissions = (await listAll('customer_submissions')).map(c => {
        const off = maybeOffloadJson(outDir, 'submissions', c.id, c.payload);
        if (off.upload) uploads.push(off.upload);
        return {
            id: c.id, owner: c.owner, customer_name: c.customer_name || '', team: c.team || '',
            source_project_id: c.source_project_id || '', submission_key: c.submission_key || '',
            title: c.title || '', payload_json: off.jsonText, payload_r2_key: off.r2Key,
            status: c.status || 'submitted', submitted_ms: Number(c.submitted_ms || 0),
            reviewed_by: c.reviewed_by || '', reviewed_ms: Number(c.reviewed_ms || 0),
            created_at: c.created, updated_at: c.updated,
        };
    });
    const furniture_catalog = (await listAll('furniture_catalog')).map(f => {
        const off = maybeOffloadJson(outDir, 'catalog', f.catalog_key, f.payload);
        if (off.upload) uploads.push(off.upload);
        return {
            id: f.id, catalog_key: f.catalog_key, payload_json: off.jsonText, payload_r2_key: off.r2Key,
            updated_ms: Number(f.updated_ms || 0), updated_by: f.updated_by || '',
            created_at: f.created, updated_at: f.updated,
        };
    });
    const signup_requests = (await listAll('signup_requests')).map(r => ({
        id: r.id, name: r.name || '', email: r.email || '', phone: r.phone || '', note: r.note || '',
        status: r.status || 'pending', requested_ms: Number(r.requested_ms || 0),
        reviewed_ms: Number(r.reviewed_ms || 0), reviewed_by: r.reviewed_by || '',
        team: r.team || '', user: r.user || '', created_at: r.created, updated_at: r.updated,
    }));
    const experience_posts = (await listAll('experience_posts')).map(e => ({
        id: e.id, owner: e.owner || '', owner_name: e.owner_name || '', category: e.category || '',
        type: e.type || 'video', title: e.title || '', desc: e.desc || '',
        detail_url: e.detail_url || '', embed_url: e.embed_url || '', status: e.status || 'pending',
        submitted_ms: Number(e.submitted_ms || 0), reviewed_by: e.reviewed_by || '',
        reviewed_ms: Number(e.reviewed_ms || 0), created_at: e.created, updated_at: e.updated,
    }));

    console.warn(`! Luu y: PocketBase HTTP API khong xuat duoc passwordHash -> cac tai khoan khac Founder duoc dat PIN tam '${FALLBACK_PIN}'.`);
    console.warn('! Muon giu nguyen 100% mat khau/PIN cu, hay dung --pb-dir <thu-muc-pb_backup>.');

    return {
        tables: {
            users, teams, team_members, survey_items, deletions, shares,
            customer_profiles, customer_submissions, furniture_catalog, signup_requests, experience_posts,
        },
        uploads,
    };
}

function fromCloudBackupFile(filePath) {
    const raw = fs.readFileSync(filePath);
    const jsonStr = filePath.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    const parsed = JSON.parse(jsonStr);
    if (!parsed?.tables) throw new Error('File backup khong dung dinh dang mkg-khaosat-cf-backup-v1');
    return { tables: parsed.tables, uploads: [] };
}

const TABLE_COLS = {
    users: ['id', 'email', 'username', 'name', 'role', 'is_superuser', 'password_hash', 'token_version', 'verified', 'email_visibility', 'created_at', 'updated_at'],
    teams: ['id', 'name', 'slug', 'created_at', 'updated_at'],
    team_members: ['team_id', 'user_id'],
    survey_items: ['id', 'owner', 'owner_name', 'item_id', 'kind', 'project_id', 'name', 'scope', 'team', 'updated_ms', 'deleted', 'rev', 'schema_v', 'photo', 'photo_r2_key', 'photo_hash', 'data_json', 'data_r2_key', 'created_at', 'updated_at'],
    deletions: ['id', 'item_id', 'kind', 'at', 'by', 'created_at'],
    shares: ['id', 'owner', 'project_id', 'title', 'payload_json', 'payload_r2_key', 'revoked', 'expires', 'created_at', 'updated_at'],
    customer_profiles: ['id', 'user', 'team', 'name', 'phone', 'active', 'created_at', 'updated_at'],
    customer_submissions: ['id', 'owner', 'customer_name', 'team', 'source_project_id', 'submission_key', 'title', 'payload_json', 'payload_r2_key', 'status', 'submitted_ms', 'reviewed_by', 'reviewed_ms', 'created_at', 'updated_at'],
    furniture_catalog: ['id', 'catalog_key', 'payload_json', 'payload_r2_key', 'updated_ms', 'updated_by', 'created_at', 'updated_at'],
    signup_requests: ['id', 'name', 'email', 'phone', 'note', 'status', 'requested_ms', 'reviewed_ms', 'reviewed_by', 'team', 'user', 'created_at', 'updated_at'],
    experience_posts: ['id', 'owner', 'owner_name', 'category', 'type', 'title', 'desc', 'detail_url', 'embed_url', 'status', 'submitted_ms', 'reviewed_by', 'reviewed_ms', 'created_at', 'updated_at'],
    backup_media_manifest: ['r2_key', 'etag', 'size', 'gdrive_file_id', 'gdrive_folder_id', 'backed_up_at'],
};

function runWrangler(wranglerArgs) {
    execFileSync('npx', ['--no-install', 'wrangler', ...wranglerArgs], { stdio: 'inherit', shell: true });
}

async function main() {
    if (!PB_DIR && !PB_LIVE && !RESTORE_FILE) {
        console.log('Chon 1 nguon: --pb-dir <path> | --pb-live | --restore-file <mkg-db.json.gz>');
        process.exit(1);
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });

    let data;
    if (RESTORE_FILE) data = fromCloudBackupFile(path.resolve(RESTORE_FILE));
    else if (PB_DIR) data = fromPocketBaseBackupDir(path.resolve(PB_DIR), OUT_DIR);
    else data = await fromPocketBaseLive(PB_URL, PB_EMAIL, PB_PASSWORD, OUT_DIR);

    const schemaSql = fs.readFileSync(path.resolve('cloudflare/migrations/0001_init.sql'), 'utf8');
    const lines = [schemaSql, ''];
    for (const [table, cols] of Object.entries(TABLE_COLS)) {
        const rows = data.tables[table] || [];
        for (const r of rows) lines.push(makeInsert(table, cols, r));
        console.log(`  - ${table}: ${rows.length} ban ghi`);
    }
    const sqlPath = path.join(OUT_DIR, 'migrate.sql');
    fs.writeFileSync(sqlPath, lines.join('\n'), 'utf8');
    console.log(`> Da xuat SQL: ${sqlPath} (${data.uploads.length} file R2 can upload)`);

    if (!PUSH) {
        console.log('\nChay tiep voi co --push de nap len Cloudflare D1 & R2:');
        console.log(`  node scripts/migrate-pb-to-cf.mjs ... --push --db ${DB_NAME} --bucket ${BUCKET_NAME}`);
        return;
    }

    const modeFlag = LOCAL ? '--local' : '--remote';
    console.log(`\n> Nap SQL vao D1 ${DB_NAME} (${modeFlag})...`);
    runWrangler(['d1', 'execute', DB_NAME, modeFlag, '--file', sqlPath, '--yes']);

    console.log(`> Upload ${data.uploads.length} file vao R2 ${BUCKET_NAME} (${modeFlag})...`);
    let ok = 0;
    for (const u of data.uploads) {
        runWrangler(['r2', 'object', 'put', `${BUCKET_NAME}/${u.key}`, '--file', u.file, '--content-type', u.contentType, modeFlag]);
        ok++;
        if (ok % 10 === 0 || ok === data.uploads.length) console.log(`  R2 uploaded ${ok}/${data.uploads.length}`);
    }
    console.log('\nHOAN TAT MIGRATE / RESTORE CLOUDFLARE!');
}

main().catch(err => {
    console.error('\nLOI:', err?.message || err);
    process.exit(1);
});
