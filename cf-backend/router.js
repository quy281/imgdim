// API Router tren Cloudflare Pages Functions (D1 + R2) cho MKG Khao Sat.
// Giữ nguyên hơp đồng HTTP/JSON/FormData với src/lib/pb.js + bo sung R2 media, offload JSON >180KB & Backup Google Drive.

import {
    genId15,
    nowIso,
    normalizeUtcCompare,
    hashPasswordPBKDF2,
    verifyPassword,
    signJwt,
    verifyJwt,
} from './crypto.js';
import {
    r2PhotoKey,
    putMediaObject,
    getMediaObject,
    deleteMediaObject,
    storeJsonWithOffload,
    loadJsonWithOffload,
} from './storage.js';
import { ensureD1Schema, inspectCollectionsMeta } from './schema.js';
import { dumpDatabaseSnapshot, gzipString, runCloudBackup, getBackupStatus } from './backup.js';

function jsonRes(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Date': new Date().toUTCString(),
            'Cache-Control': 'no-store',
            ...extraHeaders,
        },
    });
}

function errRes(message, status = 400, data = {}) {
    return jsonRes({ code: status, message, data }, status);
}

function getSecret(env) {
    return env?.JWT_SECRET || env?.CF_JWT_SECRET || 'dev-insecure-local-secret-change-in-prod';
}

function sanitizeUser(u) {
    if (!u) return null;
    return {
        id: u.id,
        email: u.email || '',
        username: u.username || '',
        name: u.name || '',
        role: u.role || '',
        verified: !!u.verified,
        emailVisibility: !!u.email_visibility,
        created: u.created_at,
        updated: u.updated_at,
    };
}

function parseBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v ?? '').trim().toLowerCase();
    return s === 'true' || s === '1';
}

function parseFieldsParam(url) {
    const raw = url.searchParams.get('fields');
    if (!raw) return null;
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

function projectFields(obj, fieldsSet) {
    if (!fieldsSet || !fieldsSet.size) return obj;
    const out = {};
    for (const k of fieldsSet) {
        if (k in obj) out[k] = obj[k];
    }
    return out;
}

function parseFilterOrValues(filter, field) {
    if (!filter) return null;
    const parts = filter.split('||').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;
    const vals = [];
    const re = new RegExp(`^${field}\\s*=\\s*(['"])(.*)\\1$`);
    for (const p of parts) {
        const m = p.match(re);
        if (!m) return null;
        vals.push(m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
    }
    return vals;
}

function parseFilterEq(filter, field) {
    if (!filter) return null;
    const m = filter.match(new RegExp(`(?:^|&&|\\s)${field}\\s*=\\s*(['"])((?:\\\\.|[^\\\\])*?)\\1`));
    if (!m) return null;
    return m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

async function readBody(req) {
    const ct = req.headers.get('content-type') || '';
    if (ct.includes('multipart/form-data')) {
        const form = await req.formData();
        const fields = {};
        let photoFile = null;
        for (const [k, v] of form.entries()) {
            if (typeof File !== 'undefined' && v instanceof File) {
                if (k === 'photo') photoFile = v;
            } else if (v && typeof v === 'object' && typeof v.arrayBuffer === 'function') {
                if (k === 'photo') photoFile = v;
            } else {
                fields[k] = v;
            }
        }
        return { fields, photoFile, isForm: true };
    }
    const text = await req.text();
    if (!text) return { fields: {}, photoFile: null, isForm: false };
    try {
        return { fields: JSON.parse(text), photoFile: null, isForm: false };
    } catch {
        return { fields: {}, photoFile: null, isForm: false };
    }
}

async function authenticateRequest(req, env) {
    const raw = req.headers.get('authorization') || '';
    if (!raw) return { auth: null, invalid: false };
    const payload = await verifyJwt(raw, getSecret(env));
    if (!payload || payload.typ !== 'auth' || !payload.sub) {
        return { auth: null, invalid: true };
    }
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first();
    if (!user || Number(user.token_version || 1) !== Number(payload.tv || 1)) {
        return { auth: null, invalid: true };
    }
    if (payload.su && !user.is_superuser) {
        return { auth: null, invalid: true };
    }
    return {
        auth: {
            id: user.id,
            role: user.role || '',
            su: !!payload.su && !!user.is_superuser,
            user,
        },
        invalid: false,
    };
}

const isStaff = (auth) => !!auth && auth.role !== 'customer';
const isAdmin = (auth) => !!auth && (auth.su || auth.role === 'admin');

async function userTeamIds(db, userId) {
    const res = await db.prepare('SELECT team_id FROM team_members WHERE user_id = ?').bind(userId).all();
    return new Set((res.results || []).map(r => r.team_id));
}

async function canAccessSurveyRow(db, auth, row) {
    if (!isStaff(auth)) return false;
    if (auth.su) return true;
    if (row.owner === auth.id) return true;
    if (row.scope === 'team' && row.team) {
        const tm = await db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?')
            .bind(row.team, auth.id).first();
        if (tm) return true;
    }
    return false;
}

async function formatSurveyRow(env, row, fieldsSet) {
    const needData = !fieldsSet || fieldsSet.has('data');
    const data = needData ? await loadJsonWithOffload(env, row.data_json, row.data_r2_key) : undefined;
    const full = {
        id: row.id,
        owner: row.owner,
        owner_name: row.owner_name || '',
        item_id: row.item_id,
        kind: row.kind,
        project_id: row.project_id,
        name: row.name || '',
        scope: row.scope || 'team',
        team: row.team || '',
        updated_ms: Number(row.updated_ms || 0),
        deleted: !!row.deleted,
        rev: Number(row.rev || 1),
        schema_v: Number(row.schema_v || 3),
        photo: row.photo || '',
        photo_hash: row.photo_hash || '',
        ...(needData ? { data } : {}),
        created: row.created_at,
        updated: row.updated_at,
    };
    return projectFields(full, fieldsSet);
}

async function handleUsers(req, env, auth, subPath, url) {
    // Auth endpoints
    if (req.method === 'POST' && subPath === '/auth-with-password') {
        const { fields } = await readBody(req);
        const ident = String(fields.identity || '').trim();
        const pw = String(fields.password ?? '');
        if (!ident || !pw) return errRes('Failed to authenticate.', 400);
        const user = await env.DB.prepare(
            'SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?) LIMIT 1'
        ).bind(ident, ident).first();
        if (!user) return errRes('Failed to authenticate.', 400);
        const { ok, needsUpgrade } = await verifyPassword(pw, user.password_hash);
        if (!ok) return errRes('Failed to authenticate.', 400);
        if (needsUpgrade) {
            try {
                const newHash = await hashPasswordPBKDF2(pw);
                await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
                    .bind(newHash, nowIso(), user.id).run();
            } catch { /* giu nguyen hash cu neu loi tam */ }
        }
        const token = await signJwt(
            { sub: user.id, role: user.role || '', su: false, tv: user.token_version || 1, typ: 'auth' },
            getSecret(env),
        );
        return jsonRes({ token, record: sanitizeUser(user) });
    }

    if (req.method === 'POST' && subPath === '/auth-refresh') {
        if (!auth || auth.su) return errRes('The request requires valid record authorization token.', 401);
        const token = await signJwt(
            { sub: auth.id, role: auth.role, su: false, tv: auth.user.token_version || 1, typ: 'auth' },
            getSecret(env),
        );
        return jsonRes({ token, record: sanitizeUser(auth.user) });
    }

    // CRUD /api/collections/users/records
    const filter = url.searchParams.get('filter') || '';
    if (req.method === 'GET' && subPath === '/records') {
        if (!auth) {
            // Tra emptyBankHint khi chua co user nao: chi cho phep dem = 0 neu he thong trong
            const cnt = await env.DB.prepare('SELECT COUNT(*) as c FROM users').first();
            if (Number(cnt?.c || 0) === 0) {
                return jsonRes({ items: [], page: 1, perPage: 30, totalItems: 0, totalPages: 1 });
            }
            return errRes('Only admins can list users.', 403);
        }
        const fieldsSet = parseFieldsParam(url);
        let rows;
        if (isAdmin(auth)) {
            const roleEq = parseFilterEq(filter, 'role');
            const emailEq = parseFilterEq(filter, 'email');
            const unameEq = parseFilterEq(filter, 'username');
            if (emailEq && unameEq) {
                rows = (await env.DB.prepare('SELECT * FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)').bind(unameEq, emailEq).all()).results;
            } else if (emailEq) {
                rows = (await env.DB.prepare('SELECT * FROM users WHERE LOWER(email)=LOWER(?)').bind(emailEq).all()).results;
            } else if (roleEq !== null) {
                rows = (await env.DB.prepare('SELECT * FROM users WHERE role = ?').bind(roleEq).all()).results;
            } else {
                rows = (await env.DB.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 500').all()).results;
            }
        } else {
            rows = [auth.user];
        }
        const items = (rows || []).map(u => projectFields(sanitizeUser(u), fieldsSet));
        return jsonRes({ items, page: 1, perPage: items.length || 30, totalItems: items.length, totalPages: 1 });
    }

    if (req.method === 'POST' && subPath === '/records') {
        if (!isAdmin(auth)) return errRes('Only admins can create users.', 403);
        const { fields } = await readBody(req);
        const email = String(fields.email || '').trim().toLowerCase();
        const username = String(fields.username || '').trim();
        const pw = String(fields.password || '');
        const pwc = String(fields.passwordConfirm ?? pw);
        if (!email || !email.includes('@')) return errRes('Failed to create record.', 400, { email: { message: 'Email khong hop le' } });
        if (pw.length < 8) return errRes('Failed to create record.', 400, { password: { message: 'Do dai toi thieu 8 ky tu' } });
        if (pw !== pwc) return errRes('Failed to create record.', 400, { passwordConfirm: { message: 'Mat khau xac nhan khong khop' } });
        const role = ['admin', 'customer', ''].includes(fields.role || '') ? (fields.role || '') : '';
        const id = genId15();
        const ts = nowIso();
        const pwHash = await hashPasswordPBKDF2(pw);
        const finalUname = (username || email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '') + id.slice(0, 4)) || null;
        try {
            await env.DB.prepare(
                `INSERT INTO users (id, email, username, name, role, is_superuser, password_hash, token_version, verified, email_visibility, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?, ?, ?)`
            ).bind(id, email, finalUname, String(fields.name || '').trim(), role, pwHash, fields.verified === false ? 0 : 1, fields.emailVisibility ? 1 : 0, ts, ts).run();
        } catch (e) {
            return errRes('Failed to create record.', 400, { email: { message: e.message || 'Tai khoan da ton tai' } });
        }
        const created = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
        return jsonRes(sanitizeUser(created));
    }

    const recMatch = subPath.match(/^\/records\/([^/]+)$/);
    if (recMatch) {
        const recId = decodeURIComponent(recMatch[1]);
        const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(recId).first();
        if (!target) return errRes('The requested resource wasn\'t found.', 404);
        const selfEdit = !!auth && auth.id === recId;
        if (!selfEdit && !isAdmin(auth)) return errRes('Forbidden.', 403);

        if (req.method === 'GET') return jsonRes(sanitizeUser(target));
        if (req.method === 'PATCH') {
            const { fields } = await readBody(req);
            const sets = [];
            const params = [];
            if ('name' in fields) { sets.push('name = ?'); params.push(String(fields.name || '').trim()); }
            if ('username' in fields && fields.username) { sets.push('username = ?'); params.push(String(fields.username).trim()); }
            if ('role' in fields) {
                if (!isAdmin(auth) && fields.role !== target.role) return errRes('Khong du quyen doi role', 403);
                sets.push('role = ?'); params.push(String(fields.role || ''));
            }
            if ('password' in fields && fields.password) {
                const pw = String(fields.password);
                if (pw.length < 8) return errRes('Failed to update record.', 400, { password: { message: 'Do dai toi thieu 8 ky tu' } });
                if ('passwordConfirm' in fields && String(fields.passwordConfirm) !== pw) {
                    return errRes('Failed to update record.', 400, { passwordConfirm: { message: 'Khong khop mat khau' } });
                }
                if (!isAdmin(auth)) {
                    const oldPw = String(fields.oldPassword ?? '');
                    const chk = await verifyPassword(oldPw, target.password_hash);
                    if (!chk.ok) return errRes('Failed to update record.', 400, { oldPassword: { message: 'Mat khau cu khong dung' } });
                }
                const newHash = await hashPasswordPBKDF2(pw);
                sets.push('password_hash = ?', 'token_version = token_version + 1');
                params.push(newHash);
            }
            if (sets.length) {
                sets.push('updated_at = ?');
                params.push(nowIso(), recId);
                await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
            }
            const updated = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(recId).first();
            return jsonRes(sanitizeUser(updated));
        }
        if (req.method === 'DELETE') {
            if (!isAdmin(auth)) return errRes('Forbidden.', 403);
            await env.DB.prepare('DELETE FROM team_members WHERE user_id = ?').bind(recId).run();
            await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(recId).run();
            return new Response(null, { status: 204 });
        }
    }
    return errRes('Not found', 404);
}

async function handleSuperusers(req, env, auth, subPath) {
    if (req.method === 'POST' && subPath === '/auth-with-password') {
        const { fields } = await readBody(req);
        const ident = String(fields.identity || '').trim();
        const pw = String(fields.password ?? '');
        if (!ident || !pw) return errRes('Failed to authenticate.', 400);
        const user = await env.DB.prepare(
            'SELECT * FROM users WHERE is_superuser = 1 AND (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) LIMIT 1'
        ).bind(ident, ident).first();
        if (!user) return errRes('Failed to authenticate.', 400);
        const { ok, needsUpgrade } = await verifyPassword(pw, user.password_hash);
        if (!ok) return errRes('Failed to authenticate.', 400);
        if (needsUpgrade) {
            try {
                const newHash = await hashPasswordPBKDF2(pw);
                await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
                    .bind(newHash, nowIso(), user.id).run();
            } catch { /* ignore */ }
        }
        const token = await signJwt(
            { sub: user.id, role: user.role || '', su: true, tv: user.token_version || 1, typ: 'auth' },
            getSecret(env),
        );
        return jsonRes({ token, record: sanitizeUser(user) });
    }

    if (req.method === 'POST' && subPath === '/auth-refresh') {
        if (!auth || !auth.su) return errRes('The request requires valid superuser authorization token.', 401);
        const token = await signJwt(
            { sub: auth.id, role: auth.role, su: true, tv: auth.user.token_version || 1, typ: 'auth' },
            getSecret(env),
        );
        return jsonRes({ token, record: sanitizeUser(auth.user) });
    }
    return errRes('Not found', 404);
}

async function formatTeamRow(db, t, { expandMembers = false, auth = null } = {}) {
    const memRows = await db.prepare('SELECT user_id FROM team_members WHERE team_id = ?').bind(t.id).all();
    const members = (memRows.results || []).map(r => r.user_id);
    const out = {
        id: t.id, name: t.name, slug: t.slug, members,
        created: t.created_at, updated: t.updated_at,
    };
    if (expandMembers && isAdmin(auth) && members.length) {
        const placeholders = members.map(() => '?').join(',');
        const uRes = await db.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).bind(...members).all();
        out.expand = { members: (uRes.results || []).map(sanitizeUser) };
    }
    return out;
}

async function handleTeams(req, env, auth, subPath, url) {
    if (!auth) return errRes('Unauthorized', 401);
    const expandMembers = (url.searchParams.get('expand') || '').split(',').includes('members');
    const filter = url.searchParams.get('filter') || '';

    if (req.method === 'GET' && subPath === '/records') {
        const slugEq = parseFilterEq(filter, 'slug');
        let rows;
        if (slugEq) {
            rows = (await env.DB.prepare('SELECT * FROM teams WHERE slug = ?').bind(slugEq).all()).results || [];
        } else if (isAdmin(auth)) {
            rows = (await env.DB.prepare('SELECT * FROM teams ORDER BY name ASC').all()).results || [];
        } else if (isStaff(auth)) {
            rows = (await env.DB.prepare(
                `SELECT DISTINCT t.* FROM teams t
                 JOIN team_members tm ON tm.team_id = t.id
                 WHERE tm.user_id = ? ORDER BY t.name ASC`
            ).bind(auth.id).all()).results || [];
        } else {
            rows = [];
        }
        const items = [];
        for (const t of rows) {
            if (!isAdmin(auth)) {
                const mem = await env.DB.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').bind(t.id, auth.id).first();
                if (!mem) continue;
            }
            items.push(await formatTeamRow(env.DB, t, { expandMembers, auth }));
        }
        return jsonRes({ items, page: 1, perPage: 200, totalItems: items.length, totalPages: 1 });
    }

    if (req.method === 'POST' && subPath === '/records') {
        if (!isAdmin(auth)) return errRes('Forbidden', 403);
        const { fields } = await readBody(req);
        const name = String(fields.name || '').trim();
        const slug = String(fields.slug || '').trim();
        if (!name || !slug) return errRes('Failed to create record.', 400);
        const id = genId15();
        const ts = nowIso();
        try {
            await env.DB.prepare('INSERT INTO teams (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
                .bind(id, name, slug, ts, ts).run();
        } catch (e) {
            return errRes('Failed to create record.', 400, { slug: { message: e.message } });
        }
        const members = Array.isArray(fields.members) ? fields.members : [];
        for (const uid of [...new Set(members.filter(Boolean))]) {
            await env.DB.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)').bind(id, uid).run();
        }
        const rec = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first();
        return jsonRes(await formatTeamRow(env.DB, rec, { expandMembers, auth }));
    }

    const m = subPath.match(/^\/records\/([^/]+)$/);
    if (m) {
        const id = decodeURIComponent(m[1]);
        const team = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first();
        if (!team) return errRes('Not found', 404);
        if (req.method === 'GET') {
            if (!isAdmin(auth)) {
                const ok = await env.DB.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').bind(id, auth.id).first();
                if (!ok) return errRes('Forbidden', 403);
            }
            return jsonRes(await formatTeamRow(env.DB, team, { expandMembers, auth }));
        }
        if (req.method === 'PATCH') {
            if (!isAdmin(auth)) return errRes('Forbidden', 403);
            const { fields } = await readBody(req);
            if ('name' in fields || 'slug' in fields) {
                await env.DB.prepare('UPDATE teams SET name = ?, slug = ?, updated_at = ? WHERE id = ?')
                    .bind(String(fields.name ?? team.name), String(fields.slug ?? team.slug), nowIso(), id).run();
            }
            if (Array.isArray(fields.members)) {
                await env.DB.prepare('DELETE FROM team_members WHERE team_id = ?').bind(id).run();
                for (const uid of [...new Set(fields.members.filter(Boolean))]) {
                    await env.DB.prepare('INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)').bind(id, uid).run();
                }
            }
            const next = await env.DB.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first();
            return jsonRes(await formatTeamRow(env.DB, next, { expandMembers, auth }));
        }
        if (req.method === 'DELETE') {
            if (!isAdmin(auth)) return errRes('Forbidden', 403);
            await env.DB.prepare('DELETE FROM team_members WHERE team_id = ?').bind(id).run();
            await env.DB.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();
            return new Response(null, { status: 204 });
        }
    }
    return errRes('Not found', 404);
}

async function handleSurveyItems(req, env, auth, subPath, url) {
    if (!auth) return jsonRes({ items: [], page: 1, perPage: 500, totalItems: 0, totalPages: 1 });
    if (!isStaff(auth)) return errRes('Customer accounts cannot access internal survey records.', 403);

    const fieldsSet = parseFieldsParam(url);
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const perPage = Math.min(1000, Math.max(1, Number(url.searchParams.get('perPage') || 500)));

    if (req.method === 'GET' && subPath === '/records') {
        const filter = url.searchParams.get('filter') || '';
        const itemIds = parseFilterOrValues(filter, 'item_id');
        const projectIds = parseFilterOrValues(filter, 'project_id');
        const where = [];
        const params = [];

        if (!auth.su) {
            where.push(`(owner = ? OR (scope = 'team' AND team != '' AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = survey_items.team AND tm.user_id = ?)))`);
            params.push(auth.id, auth.id);
        }
        if (itemIds?.length) {
            where.push(`item_id IN (${itemIds.map(() => '?').join(',')})`);
            params.push(...itemIds);
        } else if (projectIds?.length) {
            where.push(`project_id IN (${projectIds.map(() => '?').join(',')})`);
            params.push(...projectIds);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const cntRow = await env.DB.prepare(`SELECT COUNT(*) as c FROM survey_items ${whereSql}`).bind(...params).first();
        const totalItems = Number(cntRow?.c || 0);
        const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
        const offset = (page - 1) * perPage;

        const needData = !fieldsSet || fieldsSet.has('data');
        const cols = needData
            ? '*'
            : 'id,owner,owner_name,item_id,kind,project_id,name,scope,team,updated_ms,deleted,rev,schema_v,photo,photo_hash,created_at,updated_at';
        const rows = (await env.DB.prepare(
            `SELECT ${cols} FROM survey_items ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
        ).bind(...params, perPage, offset).all()).results || [];

        const items = await Promise.all(rows.map(r => formatSurveyRow(env, r, fieldsSet)));
        return jsonRes({ items, page, perPage, totalItems, totalPages });
    }

    if (req.method === 'POST' && subPath === '/records') {
        const { fields, photoFile } = await readBody(req);
        const targetOwner = String(fields.owner || auth.id);
        if (!auth.su && targetOwner !== auth.id) return errRes('Owner mismatch', 403);
        const id = genId15();
        const ts = nowIso();
        let dataVal = fields.data;
        if (typeof dataVal === 'string') {
            try { dataVal = JSON.parse(dataVal); } catch { /* keep string */ }
        }
        const { jsonText, r2Key } = await storeJsonWithOffload(env, 'survey_items', id, dataVal);

        let photoName = '';
        let photoR2Key = '';
        if (photoFile) {
            photoName = photoFile.name || `${fields.item_id || id}.jpg`;
            const buf = await photoFile.arrayBuffer();
            photoR2Key = r2PhotoKey(id, photoName);
            await putMediaObject(env, photoR2Key, buf, photoFile.type || 'image/jpeg');
        }

        try {
            await env.DB.prepare(
                `INSERT INTO survey_items (
                    id, owner, owner_name, item_id, kind, project_id, name, scope, team,
                    updated_ms, deleted, rev, schema_v, photo, photo_r2_key, photo_hash,
                    data_json, data_r2_key, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                id, targetOwner, String(fields.owner_name || ''), String(fields.item_id || ''),
                String(fields.kind || 'doc'), String(fields.project_id || ''),
                String(fields.name || ''), String(fields.scope || 'team'), String(fields.team || ''),
                Number(fields.updated_ms || 0), parseBool(fields.deleted) ? 1 : 0,
                Number(fields.rev || 1), Number(fields.schema_v || 3),
                photoName, photoR2Key, String(fields.photo_hash || ''),
                jsonText, r2Key, ts, ts,
            ).run();
        } catch (err) {
            if (photoR2Key) await deleteMediaObject(env, photoR2Key);
            if (r2Key) await deleteMediaObject(env, r2Key);
            return errRes('Failed to create record.', 400, { item_id: { message: err.message } });
        }
        const rec = await env.DB.prepare('SELECT * FROM survey_items WHERE id = ?').bind(id).first();
        return jsonRes(await formatSurveyRow(env, rec, fieldsSet));
    }

    const m = subPath.match(/^\/records\/([^/]+)$/);
    if (m) {
        const id = decodeURIComponent(m[1]);
        const rec = await env.DB.prepare('SELECT * FROM survey_items WHERE id = ?').bind(id).first();
        if (!rec) return errRes('Not found', 404);
        if (!(await canAccessSurveyRow(env.DB, auth, rec))) return errRes('Forbidden', 403);

        if (req.method === 'GET') {
            return jsonRes(await formatSurveyRow(env, rec, fieldsSet));
        }

        if (req.method === 'PATCH') {
            const { fields, photoFile } = await readBody(req);
            if ('owner' in fields && !auth.su && fields.owner !== rec.owner) {
                return errRes('Cannot reassign owner', 403);
            }
            const sets = [];
            const params = [];

            const scalarCols = ['owner', 'owner_name', 'kind', 'project_id', 'name', 'scope', 'team', 'photo_hash'];
            for (const c of scalarCols) {
                if (c in fields) { sets.push(`${c} = ?`); params.push(String(fields[c] ?? '')); }
            }
            if ('updated_ms' in fields) { sets.push('updated_ms = ?'); params.push(Number(fields.updated_ms || 0)); }
            if ('rev' in fields) { sets.push('rev = ?'); params.push(Number(fields.rev || rec.rev)); }
            if ('schema_v' in fields) { sets.push('schema_v = ?'); params.push(Number(fields.schema_v || 3)); }
            if ('deleted' in fields) { sets.push('deleted = ?'); params.push(parseBool(fields.deleted) ? 1 : 0); }

            if ('data' in fields) {
                let dataVal = fields.data;
                if (typeof dataVal === 'string') {
                    try { dataVal = JSON.parse(dataVal); } catch { /* keep */ }
                }
                const { jsonText, r2Key } = await storeJsonWithOffload(env, 'survey_items', rec.id, dataVal, rec.data_r2_key);
                sets.push('data_json = ?', 'data_r2_key = ?');
                params.push(jsonText, r2Key);
            }
            if (photoFile) {
                const photoName = photoFile.name || `${rec.item_id || rec.id}.jpg`;
                const newKey = r2PhotoKey(rec.id, photoName);
                await putMediaObject(env, newKey, await photoFile.arrayBuffer(), photoFile.type || 'image/jpeg');
                if (rec.photo_r2_key && rec.photo_r2_key !== newKey) {
                    await deleteMediaObject(env, rec.photo_r2_key);
                }
                sets.push('photo = ?', 'photo_r2_key = ?');
                params.push(photoName, newKey);
            }
            if (sets.length) {
                sets.push('updated_at = ?');
                params.push(nowIso(), id);
                await env.DB.prepare(`UPDATE survey_items SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
            }
            const next = await env.DB.prepare('SELECT * FROM survey_items WHERE id = ?').bind(id).first();
            return jsonRes(await formatSurveyRow(env, next, fieldsSet));
        }

        if (req.method === 'DELETE') {
            if (!isAdmin(auth) && rec.owner !== auth.id) return errRes('Forbidden', 403);
            if (rec.photo_r2_key) await deleteMediaObject(env, rec.photo_r2_key);
            if (rec.data_r2_key) await deleteMediaObject(env, rec.data_r2_key);
            await env.DB.prepare('DELETE FROM survey_items WHERE id = ?').bind(id).run();
            return new Response(null, { status: 204 });
        }
    }
    return errRes('Not found', 404);
}

async function handleDeletions(req, env, auth, subPath) {
    if (!isStaff(auth)) return errRes('Forbidden', 403);
    if (req.method === 'GET' && subPath === '/records') {
        const rows = (await env.DB.prepare('SELECT * FROM deletions ORDER BY at DESC LIMIT 2000').all()).results || [];
        return jsonRes({ items: rows, page: 1, perPage: 2000, totalItems: rows.length, totalPages: 1 });
    }
    if (req.method === 'POST' && subPath === '/records') {
        const { fields } = await readBody(req);
        const id = genId15();
        const ts = nowIso();
        try {
            await env.DB.prepare('INSERT INTO deletions (id, item_id, kind, at, by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(id, String(fields.item_id || ''), String(fields.kind || 'doc'), Number(fields.at || 0), String(fields.by || ''), ts).run();
        } catch (err) {
            return errRes('Failed to create record.', 400, { item_id: { message: err.message } });
        }
        const rec = await env.DB.prepare('SELECT * FROM deletions WHERE id = ?').bind(id).first();
        return jsonRes(rec);
    }
    const m = subPath.match(/^\/records\/([^/]+)$/);
    if (m && req.method === 'DELETE') {
        if (!isAdmin(auth)) return errRes('Forbidden', 403);
        await env.DB.prepare('DELETE FROM deletions WHERE id = ?').bind(decodeURIComponent(m[1])).run();
        return new Response(null, { status: 204 });
    }
    return errRes('Not found', 404);
}

async function formatShareRow(env, r) {
    const payload = await loadJsonWithOffload(env, r.payload_json, r.payload_r2_key);
    return {
        id: r.id, owner: r.owner, project_id: r.project_id, title: r.title,
        payload, revoked: !!r.revoked, expires: r.expires || '',
        created: r.created_at, updated: r.updated_at,
    };
}

async function handleShares(req, env, auth, subPath, url) {
    if (req.method === 'GET' && subPath === '/records') {
        if (!isStaff(auth)) return errRes('Forbidden', 403);
        const filter = url.searchParams.get('filter') || '';
        const pid = parseFilterEq(filter, 'project_id');
        const owner = parseFilterEq(filter, 'owner');
        let rows;
        if (pid) {
            rows = (await env.DB.prepare('SELECT * FROM shares WHERE owner = ? AND project_id = ? ORDER BY created_at DESC LIMIT 200')
                .bind(auth.id, pid).all()).results || [];
        } else {
            rows = (await env.DB.prepare('SELECT * FROM shares WHERE owner = ? ORDER BY created_at DESC LIMIT 200')
                .bind(owner && isAdmin(auth) ? owner : auth.id).all()).results || [];
        }
        const items = await Promise.all(rows.map(r => formatShareRow(env, r)));
        return jsonRes({ items, page: 1, perPage: 200, totalItems: items.length, totalPages: 1 });
    }

    if (req.method === 'POST' && subPath === '/records') {
        if (!isStaff(auth)) return errRes('Forbidden', 403);
        const { fields } = await readBody(req);
        if (!auth.su && fields.owner && fields.owner !== auth.id) return errRes('Forbidden', 403);
        const id = genId15();
        const ts = nowIso();
        const { jsonText, r2Key } = await storeJsonWithOffload(env, 'shares', id, fields.payload ?? null);
        await env.DB.prepare(
            `INSERT INTO shares (id, owner, project_id, title, payload_json, payload_r2_key, revoked, expires, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            id, String(fields.owner || auth.id), String(fields.project_id || ''),
            String(fields.title || ''), jsonText, r2Key,
            parseBool(fields.revoked) ? 1 : 0, String(fields.expires || ''), ts, ts,
        ).run();
        const rec = await env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(id).first();
        return jsonRes(await formatShareRow(env, rec));
    }

    const m = subPath.match(/^\/records\/([^/]+)$/);
    if (m) {
        const code = decodeURIComponent(m[1]);
        const rec = await env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(code).first();
        if (!rec) return errRes('Not found', 404);
        if (req.method === 'GET') {
            const nowCmp = normalizeUtcCompare(nowIso());
            const expCmp = normalizeUtcCompare(rec.expires);
            const expired = !!expCmp && expCmp <= nowCmp;
            if (rec.revoked || expired) return errRes('Link da bi thu hoi hoac het han', 404);
            return jsonRes(await formatShareRow(env, rec));
        }
        if (!isStaff(auth) || (!auth.su && rec.owner !== auth.id)) return errRes('Forbidden', 403);
        if (req.method === 'PATCH') {
            const { fields } = await readBody(req);
            await env.DB.prepare('UPDATE shares SET revoked = ?, updated_at = ? WHERE id = ?')
                .bind(parseBool(fields.revoked) ? 1 : 0, nowIso(), code).run();
            const next = await env.DB.prepare('SELECT * FROM shares WHERE id = ?').bind(code).first();
            return jsonRes(await formatShareRow(env, next));
        }
        if (req.method === 'DELETE') {
            if (rec.payload_r2_key) await deleteMediaObject(env, rec.payload_r2_key);
            await env.DB.prepare('DELETE FROM shares WHERE id = ?').bind(code).run();
            return new Response(null, { status: 204 });
        }
    }
    return errRes('Not found', 404);
}

async function handleCustomerProfiles(req, env, auth, subPath, url) {
    if (!auth) return errRes('Unauthorized', 401);
    const filter = url.searchParams.get('filter') || '';
    const expandUser = (url.searchParams.get('expand') || '').split(',').includes('user');

    const format = async (r) => {
        const out = {
            id: r.id, user: r.user, team: r.team, name: r.name, phone: r.phone,
            active: !!r.active, created: r.created_at, updated: r.updated_at,
        };
        if (expandUser) {
            const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(r.user).first();
            if (u) out.expand = { user: sanitizeUser(u) };
        }
        return out;
    };

    if (req.method === 'GET' && subPath === '/records') {
        const userEq = parseFilterEq(filter, 'user');
        const teamEq = parseFilterEq(filter, 'team');
        let rows;
        if (userEq) {
            rows = (await env.DB.prepare('SELECT * FROM customer_profiles WHERE user = ?').bind(userEq).all()).results || [];
        } else if (teamEq) {
            rows = (await env.DB.prepare('SELECT * FROM customer_profiles WHERE team = ? ORDER BY name ASC').bind(teamEq).all()).results || [];
        } else {
            rows = (await env.DB.prepare('SELECT * FROM customer_profiles ORDER BY name ASC').all()).results || [];
        }
        const myTeams = isStaff(auth) && !isAdmin(auth) ? await userTeamIds(env.DB, auth.id) : null;
        const visible = [];
        for (const r of rows) {
            if (isAdmin(auth) || r.user === auth.id || (myTeams && r.team && myTeams.has(r.team))) {
                visible.push(await format(r));
            }
        }
        return jsonRes({ items: visible, page: 1, perPage: 500, totalItems: visible.length, totalPages: 1 });
    }

    if (req.method === 'POST' && subPath === '/records') {
        if (!isAdmin(auth)) return errRes('Forbidden', 403);
        const { fields } = await readBody(req);
        const id = genId15();
        const ts = nowIso();
        await env.DB.prepare(
            `INSERT INTO customer_profiles (id, user, team, name, phone, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, String(fields.user), String(fields.team), String(fields.name || ''), String(fields.phone || ''), fields.active === false ? 0 : 1, ts, ts).run();
        return jsonRes(await format(await env.DB.prepare('SELECT * FROM customer_profiles WHERE id = ?').bind(id).first()));
    }

    const m = subPath.match(/^\/records\/([^/]+)$/);
    if (m && req.method === 'PATCH') {
        if (!isAdmin(auth)) return errRes('Forbidden', 403);
        const id = decodeURIComponent(m[1]);
        const rec = await env.DB.prepare('SELECT * FROM customer_profiles WHERE id = ?').bind(id).first();
        if (!rec) return errRes('Not found', 404);
        const { fields } = await readBody(req);
        await env.DB.prepare(
            `UPDATE customer_profiles SET team=?, name=?, phone=?, active=?, updated_at=? WHERE id=?`
        ).bind(
            String(fields.team ?? rec.team),
            String(fields.name ?? rec.name),
            String(fields.phone ?? rec.phone),
            'active' in fields ? (parseBool(fields.active) ? 1 : 0) : rec.active,
            nowIso(),
            id,
        ).run();
        return jsonRes(await format(await env.DB.prepare('SELECT * FROM customer_profiles WHERE id = ?').bind(id).first()));
    }
    return errRes('Not found', 404);
}

async function formatSubmissionRow(env, r) {
    const payload = await loadJsonWithOffload(env, r.payload_json, r.payload_r2_key);
    return {
        id: r.id, owner: r.owner, customer_name: r.customer_name, team: r.team,
        source_project_id: r.source_project_id, submission_key: r.submission_key,
        title: r.title, payload, status: r.status,
        submitted_ms: Number(r.submitted_ms || 0),
        reviewed_by: r.reviewed_by || '',
        reviewed_ms: Number(r.reviewed_ms || 0),
        created: r.created_at, updated: r.updated_at,
    };
}

async function handleCustomerSubmissions(req, env, auth, subPath, url) {
    if (!auth) return errRes('Unauthorized', 401);
    const filter = url.searchParams.get('filter') || '';

    if (req.method === 'GET' && subPath === '/records') {
        const keyEq = parseFilterEq(filter, 'submission_key');
        const ownerEq = parseFilterEq(filter, 'owner');
        let rows;
        if (keyEq && ownerEq) {
            rows = (await env.DB.prepare('SELECT * FROM customer_submissions WHERE owner = ? AND submission_key = ?')
                .bind(ownerEq, keyEq).all()).results || [];
        } else {
            rows = (await env.DB.prepare('SELECT * FROM customer_submissions ORDER BY submitted_ms DESC LIMIT 200').all()).results || [];
        }
        const myTeams = isStaff(auth) && !isAdmin(auth) ? await userTeamIds(env.DB, auth.id) : null;
        const visible = [];
        for (const r of rows) {
            if (isAdmin(auth) || r.owner === auth.id || (myTeams && r.team && myTeams.has(r.team))) {
                visible.push(await formatSubmissionRow(env, r));
            }
        }
        return jsonRes({ items: visible, page: 1, perPage: 200, totalItems: visible.length, totalPages: 1 });
    }

    if (req.method === 'POST' && subPath === '/records') {
        if (auth.role !== 'customer') return errRes('Only customer accounts can submit surveys.', 403);
        const { fields } = await readBody(req);
        if (fields.owner !== auth.id || !fields.team || fields.status !== 'submitted') {
            return errRes('Invalid customer submission fields', 403);
        }
        const id = genId15();
        const ts = nowIso();
        const { jsonText, r2Key } = await storeJsonWithOffload(env, 'submissions', id, fields.payload ?? null);
        try {
            await env.DB.prepare(
                `INSERT INTO customer_submissions (
                    id, owner, customer_name, team, source_project_id, submission_key,
                    title, payload_json, payload_r2_key, status, submitted_ms, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?)`
            ).bind(
                id, auth.id, String(fields.customer_name || ''), String(fields.team),
                String(fields.source_project_id || ''), String(fields.submission_key || ''),
                String(fields.title || ''), jsonText, r2Key, Number(fields.submitted_ms || Date.now()), ts, ts,
            ).run();
        } catch (err) {
            if (r2Key) await deleteMediaObject(env, r2Key);
            return errRes('Failed to create record.', 400, { submission_key: { message: err.message } });
        }
        return jsonRes(await formatSubmissionRow(env, await env.DB.prepare('SELECT * FROM customer_submissions WHERE id = ?').bind(id).first()));
    }

    const m = subPath.match(/^\/records\/([^/]+)$/);
    if (m && req.method === 'PATCH') {
        if (!isStaff(auth)) return errRes('Forbidden', 403);
        const id = decodeURIComponent(m[1]);
        const rec = await env.DB.prepare('SELECT * FROM customer_submissions WHERE id = ?').bind(id).first();
        if (!rec) return errRes('Not found', 404);
        if (!isAdmin(auth)) {
            const mem = await env.DB.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').bind(rec.team, auth.id).first();
            if (!mem) return errRes('Forbidden', 403);
        }
        const { fields } = await readBody(req);
        // Khoa cac truong snapshot bat bien giong rule PocketBase
        for (const locked of ['owner', 'team', 'payload', 'submission_key', 'source_project_id']) {
            if (locked in fields) return errRes(`Truong ${locked} khong duoc sua`, 403);
        }
        await env.DB.prepare(
            `UPDATE customer_submissions SET status = ?, reviewed_by = ?, reviewed_ms = ?, updated_at = ? WHERE id = ?`
        ).bind(
            String(fields.status || rec.status),
            String(fields.reviewed_by || auth.id),
            Number(fields.reviewed_ms || Date.now()),
            nowIso(),
            id,
        ).run();
        return jsonRes(await formatSubmissionRow(env, await env.DB.prepare('SELECT * FROM customer_submissions WHERE id = ?').bind(id).first()));
    }
    return errRes('Not found', 404);
}

async function handleFurnitureCatalog(req, env, auth, subPath, url) {
    if (!auth) return errRes('Unauthorized', 401);
    const filter = url.searchParams.get('filter') || '';
    const format = async (r) => ({
        id: r.id,
        catalog_key: r.catalog_key,
        payload: await loadJsonWithOffload(env, r.payload_json, r.payload_r2_key),
        updated_ms: Number(r.updated_ms || 0),
        updated_by: r.updated_by || '',
        created: r.created_at,
        updated: r.updated_at,
    });

    if (req.method === 'GET' && subPath === '/records') {
        const keyEq = parseFilterEq(filter, 'catalog_key');
        const rows = keyEq
            ? (await env.DB.prepare('SELECT * FROM furniture_catalog WHERE catalog_key = ?').bind(keyEq).all()).results || []
            : (await env.DB.prepare('SELECT * FROM furniture_catalog ORDER BY catalog_key ASC').all()).results || [];
        const items = await Promise.all(rows.map(format));
        return jsonRes({ items, page: 1, perPage: 50, totalItems: items.length, totalPages: 1 });
    }

    if (req.method === 'POST' && subPath === '/records') {
        if (!isAdmin(auth)) return errRes('Only admins can push cloud catalog.', 403);
        const { fields } = await readBody(req);
        const key = String(fields.catalog_key || '').trim();
        if (!key) return errRes('Missing catalog_key', 400);
        const id = genId15();
        const ts = nowIso();
        const { jsonText, r2Key } = await storeJsonWithOffload(env, 'catalog', key, fields.payload ?? null);
        await env.DB.prepare(
            `INSERT INTO furniture_catalog (id, catalog_key, payload_json, payload_r2_key, updated_ms, updated_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, key, jsonText, r2Key, Number(fields.updated_ms || Date.now()), String(fields.updated_by || ''), ts, ts).run();
        return jsonRes(await format(await env.DB.prepare('SELECT * FROM furniture_catalog WHERE id = ?').bind(id).first()));
    }

    const m = subPath.match(/^\/records\/([^/]+)$/);
    if (m && req.method === 'PATCH') {
        if (!isAdmin(auth)) return errRes('Only admins can update cloud catalog.', 403);
        const id = decodeURIComponent(m[1]);
        const rec = await env.DB.prepare('SELECT * FROM furniture_catalog WHERE id = ?').bind(id).first();
        if (!rec) return errRes('Not found', 404);
        const { fields } = await readBody(req);
        const key = String(fields.catalog_key || rec.catalog_key);
        let jsonText = rec.payload_json;
        let r2Key = rec.payload_r2_key;
        if ('payload' in fields) {
            const res = await storeJsonWithOffload(env, 'catalog', key, fields.payload, rec.payload_r2_key);
            jsonText = res.jsonText;
            r2Key = res.r2Key;
        }
        await env.DB.prepare(
            `UPDATE furniture_catalog SET catalog_key=?, payload_json=?, payload_r2_key=?, updated_ms=?, updated_by=?, updated_at=? WHERE id=?`
        ).bind(
            key, jsonText, r2Key,
            Number(fields.updated_ms ?? rec.updated_ms),
            String(fields.updated_by ?? rec.updated_by),
            nowIso(),
            id,
        ).run();
        return jsonRes(await format(await env.DB.prepare('SELECT * FROM furniture_catalog WHERE id = ?').bind(id).first()));
    }
    return errRes('Not found', 404);
}

function slugifyCatalogKey(name, prefix) {
    const base = String(name || 'mau_sketchup')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'mau_sketchup';
    return `${prefix}${base}`;
}

const SKETCHUP_ROOM_LABELS = {
    bedroom: 'Phòng ngủ',
    living: 'Khách + ăn',
    kitchen: 'Bếp',
    wc: 'WC',
    elec: 'Điện & TB',
    other: 'Khác',
};

function sanitizeIncomingSketchUpItem(raw, key, isFadi) {
    const validStr = (v) => (typeof v === 'string' ? v.trim() : '');
    const mount = raw.mount === 'wall' || raw.mount === 'ceiling' ? raw.mount : 'floor';
    const glbData = validStr(raw.glbData || raw.modelDataUrl || '');
    const validGroups = new Set(['bedroom', 'living', 'kitchen', 'wc', 'elec', 'other']);
    const group = isFadi ? 'fadi' : (validGroups.has(raw.group) ? raw.group : 'other');
    const rawRoom = validStr(raw.fadiRoom || (raw.group && raw.group !== 'fadi' ? raw.group : ''));
    const fadiRoom = isFadi ? (SKETCHUP_ROOM_LABELS[rawRoom] || rawRoom || 'Khác') : '';
    return {
        key,
        name: validStr(raw.name) || 'Mẫu SketchUp',
        library: isFadi ? 'fadi' : 'global',
        group,
        ...(fadiRoom ? { fadiRoom } : {}),
        w: Math.max(20, Math.round(Number(raw.w) || 1000)),
        d: Math.max(20, Math.round(Number(raw.d) || 600)),
        h: Math.max(10, Math.round(Number(raw.h) || 800)),
        z: Math.max(0, Math.round(Number(raw.z) || 0)),
        mount,
        back: raw.back !== undefined ? !!raw.back : true,
        noSnapContact: !!raw.noSnapContact,
        sym: validStr(raw.sym) || 'cab',
        svg2d: typeof raw.svg2d === 'string' ? raw.svg2d.trim() : '',
        glbFileName: validStr(raw.glbFileName) || `${key}.dae`,
        modelFormat: validStr(raw.modelFormat || (glbData ? 'dae' : '')).toLowerCase(),
        glbRotX: Number(raw.glbRotX) || 0,
        glbRotY: Number(raw.glbRotY) || 0,
        hasLocalGlb: !!glbData,
        isBuiltin: false,
        isCustom: true,
    };
}

async function handleSketchUpDirectImport(req, env, auth) {
    if (req.method !== 'POST') return errRes('Method not allowed', 405);
    if (!auth) return errRes('Cần đăng nhập tài khoản MKG để đẩy thư viện', 401);
    if (!isStaff(auth)) return errRes('Chỉ tài khoản nhân viên hoặc quản trị mới có quyền đẩy thư viện', 403);

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.items) || !body.items.length) {
        return errRes('Gói dữ liệu SketchUp trống hoặc không hợp lệ', 400);
    }

    const reqLib = body.library === 'fadi' ? 'fadi' : body.library === 'global' ? 'global' : 'auto';
    const buckets = { global: [], fadi: [] };
    for (const raw of body.items) {
        if (!raw || typeof raw !== 'object') continue;
        const isFadi = reqLib === 'fadi'
            || (reqLib === 'auto' && (raw.library === 'fadi' || raw.group === 'fadi'));
        buckets[isFadi ? 'fadi' : 'global'].push(raw);
    }

    const nowMs = Date.now();
    const updatedBy = auth.user?.name || auth.user?.email || 'sketchup';
    const savedSummaries = [];
    const touchedCatalogs = [];

    for (const catalogKey of ['global', 'fadi']) {
        const incoming = buckets[catalogKey];
        if (!incoming.length) continue;
        const isFadi = catalogKey === 'fadi';

        const existingRec = await env.DB.prepare('SELECT * FROM furniture_catalog WHERE catalog_key = ?').bind(catalogKey).first();
        const existingPayload = existingRec
            ? await loadJsonWithOffload(env, existingRec.payload_json, existingRec.payload_r2_key)
            : null;

        const payload = existingPayload && typeof existingPayload === 'object'
            ? {
                version: 1,
                ...(isFadi ? { library: 'fadi' } : { overrides: existingPayload.overrides || {} }),
                updatedAt: nowMs,
                customItems: Array.isArray(existingPayload.customItems) ? [...existingPayload.customItems] : [],
                deletedKeys: Array.isArray(existingPayload.deletedKeys) ? [...existingPayload.deletedKeys] : [],
                glbAssets: existingPayload.glbAssets && typeof existingPayload.glbAssets === 'object'
                    ? { ...existingPayload.glbAssets } : {},
            }
            : {
                version: 1,
                ...(isFadi ? { library: 'fadi' } : { overrides: {} }),
                updatedAt: nowMs,
                customItems: [],
                deletedKeys: [],
                glbAssets: {},
            };

        const usedKeys = new Set(payload.customItems.map(x => x?.key).filter(Boolean));

        for (const raw of incoming) {
            const cleanName = String(raw.name || 'Mẫu SketchUp').trim() || 'Mẫu SketchUp';
            const rawKey = typeof raw.key === 'string' ? raw.key.trim() : '';
            let idx = -1;
            if (rawKey) {
                idx = payload.customItems.findIndex(x => x?.key === rawKey);
            }
            if (idx === -1) {
                const nameLower = cleanName.toLowerCase();
                idx = payload.customItems.findIndex(x => String(x?.name || '').trim().toLowerCase() === nameLower);
            }

            let finalKey = idx >= 0 ? payload.customItems[idx].key : rawKey;
            if (!finalKey) {
                const baseKey = slugifyCatalogKey(cleanName, isFadi ? 'fadi_' : 'custom_');
                finalKey = baseKey;
                let suffix = 2;
                while (usedKeys.has(finalKey)) {
                    finalKey = `${baseKey}_${suffix++}`;
                }
            }
            usedKeys.add(finalKey);

            const entry = sanitizeIncomingSketchUpItem(raw, finalKey, isFadi);
            const glbData = typeof (raw.glbData || raw.modelDataUrl) === 'string' ? (raw.glbData || raw.modelDataUrl).trim() : '';
            if (glbData) {
                payload.glbAssets[finalKey] = glbData;
                entry.hasLocalGlb = true;
            }
            payload.deletedKeys = payload.deletedKeys.filter(k => k !== finalKey);

            if (idx >= 0) payload.customItems[idx] = { ...payload.customItems[idx], ...entry };
            else payload.customItems.push(entry);

            savedSummaries.push({
                key: finalKey,
                name: entry.name,
                library: catalogKey,
                group: entry.group,
                w: entry.w,
                d: entry.d,
                h: entry.h,
            });
        }

        const { jsonText, r2Key } = await storeJsonWithOffload(env, 'catalog', catalogKey, payload, existingRec?.payload_r2_key || null);
        const ts = nowIso();
        if (existingRec?.id) {
            await env.DB.prepare(
                `UPDATE furniture_catalog SET payload_json=?, payload_r2_key=?, updated_ms=?, updated_by=?, updated_at=? WHERE id=?`
            ).bind(jsonText, r2Key, nowMs, updatedBy, ts, existingRec.id).run();
        } else {
            await env.DB.prepare(
                `INSERT INTO furniture_catalog (id, catalog_key, payload_json, payload_r2_key, updated_ms, updated_by, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(genId15(), catalogKey, jsonText, r2Key, nowMs, updatedBy, ts, ts).run();
        }
        touchedCatalogs.push(catalogKey);
    }

    return jsonRes({
        ok: true,
        count: savedSummaries.length,
        updatedAt: nowMs,
        catalogs: touchedCatalogs,
        items: savedSummaries,
    });
}

async function handleSignupRequests(req, env, auth, subPath) {
    if (req.method === 'POST' && subPath === '/records') {
        const { fields } = await readBody(req);
        const id = genId15();
        const ts = nowIso();
        await env.DB.prepare(
            `INSERT INTO signup_requests (id, name, email, phone, note, status, requested_ms, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
        ).bind(id, String(fields.name || ''), String(fields.email || ''), String(fields.phone || ''), String(fields.note || ''), Number(fields.requested_ms || Date.now()), ts, ts).run();
        const rec = await env.DB.prepare('SELECT * FROM signup_requests WHERE id = ?').bind(id).first();
        return jsonRes({ ...rec, created: rec.created_at, updated: rec.updated_at });
    }
    if (!isAdmin(auth)) return errRes('Forbidden', 403);
    if (req.method === 'GET' && subPath === '/records') {
        const rows = (await env.DB.prepare('SELECT * FROM signup_requests ORDER BY requested_ms DESC LIMIT 200').all()).results || [];
        return jsonRes({ items: rows, page: 1, perPage: 200, totalItems: rows.length, totalPages: 1 });
    }
    const m = subPath.match(/^\/records\/([^/]+)$/);
    if (m) {
        const id = decodeURIComponent(m[1]);
        const rec = await env.DB.prepare('SELECT * FROM signup_requests WHERE id = ?').bind(id).first();
        if (!rec) return errRes('Not found', 404);
        if (req.method === 'GET') return jsonRes(rec);
        if (req.method === 'PATCH') {
            const { fields } = await readBody(req);
            await env.DB.prepare(
                `UPDATE signup_requests SET status=?, team=?, user=?, reviewed_by=?, reviewed_ms=?, updated_at=? WHERE id=?`
            ).bind(
                String(fields.status ?? rec.status),
                String(fields.team ?? rec.team),
                String(fields.user ?? rec.user),
                String(fields.reviewed_by ?? rec.reviewed_by),
                Number(fields.reviewed_ms ?? Date.now()),
                nowIso(),
                id,
            ).run();
            return jsonRes(await env.DB.prepare('SELECT * FROM signup_requests WHERE id = ?').bind(id).first());
        }
    }
    return errRes('Not found', 404);
}

async function handleExperiencePosts(req, env, auth, subPath) {
    if (!isStaff(auth)) return errRes('Forbidden', 403);
    if (req.method === 'GET' && subPath === '/records') {
        const rows = isAdmin(auth)
            ? (await env.DB.prepare('SELECT * FROM experience_posts ORDER BY submitted_ms DESC LIMIT 200').all()).results || []
            : (await env.DB.prepare(`SELECT * FROM experience_posts WHERE status = 'public' OR owner = ? ORDER BY submitted_ms DESC LIMIT 200`).bind(auth.id).all()).results || [];
        return jsonRes({ items: rows, page: 1, perPage: 200, totalItems: rows.length, totalPages: 1 });
    }
    if (req.method === 'POST' && subPath === '/records') {
        const { fields } = await readBody(req);
        if (fields.owner !== auth.id || fields.status !== 'pending') return errRes('Invalid post owner/status', 403);
        const id = genId15();
        const ts = nowIso();
        await env.DB.prepare(
            `INSERT INTO experience_posts (id, owner, owner_name, category, type, title, desc, detail_url, embed_url, status, submitted_ms, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
        ).bind(
            id, auth.id, String(fields.owner_name || ''), String(fields.category || ''),
            String(fields.type || 'video'), String(fields.title || ''), String(fields.desc || ''),
            String(fields.detail_url || ''), String(fields.embed_url || ''), Number(fields.submitted_ms || Date.now()), ts, ts,
        ).run();
        return jsonRes(await env.DB.prepare('SELECT * FROM experience_posts WHERE id = ?').bind(id).first());
    }
    const m = subPath.match(/^\/records\/([^/]+)$/);
    if (m && req.method === 'PATCH') {
        if (!isAdmin(auth)) return errRes('Forbidden', 403);
        const id = decodeURIComponent(m[1]);
        const rec = await env.DB.prepare('SELECT * FROM experience_posts WHERE id = ?').bind(id).first();
        if (!rec) return errRes('Not found', 404);
        const { fields } = await readBody(req);
        await env.DB.prepare(
            `UPDATE experience_posts SET status=?, reviewed_by=?, reviewed_ms=?, updated_at=? WHERE id=?`
        ).bind(String(fields.status ?? rec.status), String(fields.reviewed_by ?? auth.id), Number(fields.reviewed_ms ?? Date.now()), nowIso(), id).run();
        return jsonRes(await env.DB.prepare('SELECT * FROM experience_posts WHERE id = ?').bind(id).first());
    }
    return errRes('Not found', 404);
}

async function handleFiles(req, env, auth, subPath, url) {
    if (req.method === 'POST' && subPath === '/files/token') {
        if (!auth) return errRes('Unauthorized', 401);
        const token = await signJwt({ sub: auth.id, role: auth.role, su: auth.su, typ: 'file' }, getSecret(env), 300);
        return jsonRes({ token });
    }
    const m = subPath.match(/^\/files\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (req.method === 'GET' && m) {
        const col = decodeURIComponent(m[1]);
        const recordId = decodeURIComponent(m[2]);
        const filename = decodeURIComponent(m[3]);
        if (col !== 'survey_items') return errRes('Unsupported file collection', 404);

        // Xac thuc bang Authorization header hoac ?token=...
        let effectiveAuth = auth;
        const qTok = url.searchParams.get('token');
        if (!effectiveAuth && qTok) {
            const p = await verifyJwt(qTok, getSecret(env));
            if (p && p.typ === 'file' && p.sub) {
                effectiveAuth = { id: p.sub, role: p.role || '', su: !!p.su };
            }
        }
        if (!isStaff(effectiveAuth)) return errRes('Unauthorized file access', 403);

        const rec = await env.DB.prepare('SELECT * FROM survey_items WHERE id = ?').bind(recordId).first();
        if (!rec) return errRes('Not found', 404);
        if (!(await canAccessSurveyRow(env.DB, effectiveAuth, rec))) return errRes('Forbidden', 403);

        const key = rec.photo_r2_key || r2PhotoKey(recordId, filename);
        const obj = await getMediaObject(env, key);
        if (!obj) return errRes('File not found in R2', 404);

        const headers = new Headers();
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
        headers.set('Cache-Control', 'private, max-age=300');
        headers.set('Date', new Date().toUTCString());
        if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
        return new Response(obj.body, { status: 200, headers });
    }
    return errRes('Not found', 404);
}

async function handleBackupEndpoints(req, env, auth, subPath) {
    const cronSecret = env?.BACKUP_SECRET;
    const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const isCronSecret = !!cronSecret && !!bearer && bearer === cronSecret;

    if (req.method === 'GET' && subPath === '/backup/status') {
        if (!isAdmin(auth) && !isCronSecret) return errRes('Forbidden', 403);
        return jsonRes(await getBackupStatus(env));
    }

    if (req.method === 'POST' && subPath === '/backup/run') {
        if (!isAdmin(auth) && !isCronSecret) return errRes('Forbidden', 403);
        const { fields } = await readBody(req).catch(() => ({ fields: {} }));
        const result = await runCloudBackup(env, {
            triggerSource: isCronSecret ? 'cron' : 'manual',
            mediaBatchLimit: fields?.mediaBatchLimit,
        });
        return jsonRes(result);
    }

    if (req.method === 'GET' && subPath === '/backup/download') {
        if (!isAdmin(auth)) return errRes('Forbidden', 403);
        const snapshot = await dumpDatabaseSnapshot(env.DB);
        const gz = await gzipString(JSON.stringify(snapshot));
        const isGz = typeof CompressionStream === 'function';
        const stamp = new Date().toISOString().slice(0, 10);
        return new Response(gz, {
            status: 200,
            headers: {
                'Content-Type': isGz ? 'application/gzip' : 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="mkg-khaosat-backup-${stamp}.json${isGz ? '.gz' : ''}"`,
                'Cache-Control': 'no-store',
                'Date': new Date().toUTCString(),
            },
        });
    }
    return errRes('Not found', 404);
}

export async function handleApiRequest(request, env) {
    try {
        if (!env?.DB) {
            return errRes('Cloudflare D1 binding (DB) chua duoc gan cho Pages Project.', 503);
        }
        const url = new URL(request.url);
        const subPath = url.pathname.replace(/^\/api/, '') || '/';

        if (request.method === 'GET' && subPath === '/health') {
            return jsonRes({
                code: 200,
                message: 'API is healthy.',
                data: { backend: 'cloudflare', d1: !!env.DB, r2: !!env.MEDIA },
            });
        }

        const { auth, invalid } = await authenticateRequest(request, env);
        // Cac endpoint cho phep khach vãng lai (auth-with-password, public share GET, signup POST) khong bi chan boi token cu
        const isPublicAuthRoute = subPath.includes('/auth-with-password')
            || (request.method === 'POST' && subPath === '/collections/signup_requests/records')
            || (request.method === 'GET' && /^\/collections\/shares\/records\/[^/]+$/.test(subPath));
        if (invalid && !isPublicAuthRoute && !subPath.startsWith('/files/')) {
            return errRes('Invalid or expired token', 401);
        }

        if (subPath === '/backup/status' || subPath === '/backup/run' || subPath === '/backup/download') {
            return await handleBackupEndpoints(request, env, auth, subPath);
        }
        if (subPath === '/catalog/sketchup-import') {
            return await handleSketchUpDirectImport(request, env, auth);
        }
        if (subPath.startsWith('/files/')) {
            return await handleFiles(request, env, auth, subPath, url);
        }

        // Schema inspection & provision (/api/collections)
        if (subPath === '/collections' || subPath.startsWith('/collections/')) {
            if (subPath === '/collections' && request.method === 'GET') {
                if (!auth?.su) return errRes('Only superusers can inspect backend schema.', 403);
                return jsonRes(await inspectCollectionsMeta(env.DB));
            }
            if (subPath === '/collections' && request.method === 'POST') {
                if (!auth?.su) return errRes('Forbidden', 403);
                await ensureD1Schema(env.DB);
                return jsonRes({ ok: true, id: 'd1_ready' });
            }
        }

        const colMatch = subPath.match(/^\/collections\/([^/]+)(\/.*)?$/);
        if (colMatch) {
            const col = colMatch[1];
            const colSub = colMatch[2] || '';
            if (col === 'users') return await handleUsers(request, env, auth, colSub, url);
            if (col === '_superusers') return await handleSuperusers(request, env, auth, colSub);
            if (col === 'teams') return await handleTeams(request, env, auth, colSub, url);
            if (col === 'survey_items') return await handleSurveyItems(request, env, auth, colSub, url);
            if (col === 'deletions') return await handleDeletions(request, env, auth, colSub);
            if (col === 'shares') return await handleShares(request, env, auth, colSub, url);
            if (col === 'customer_profiles') return await handleCustomerProfiles(request, env, auth, colSub, url);
            if (col === 'customer_submissions') return await handleCustomerSubmissions(request, env, auth, colSub, url);
            if (col === 'furniture_catalog') return await handleFurnitureCatalog(request, env, auth, colSub, url);
            if (col === 'signup_requests') return await handleSignupRequests(request, env, auth, colSub);
            if (col === 'experience_posts') return await handleExperiencePosts(request, env, auth, colSub);
            if (!colSub && (request.method === 'GET' || request.method === 'PATCH')) {
                if (!auth?.su) return errRes('Forbidden', 403);
                if (request.method === 'PATCH') await ensureD1Schema(env.DB);
                const meta = await inspectCollectionsMeta(env.DB);
                const found = meta.items.find(c => c.name === col);
                return found ? jsonRes(found) : errRes('Collection not found', 404);
            }
        }

        return errRes('Endpoint not found', 404);
    } catch (err) {
        console.error('CF API Error:', err);
        return errRes(err?.message || 'Internal Server Error', err?.status || 500);
    }
}
