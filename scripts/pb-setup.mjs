#!/usr/bin/env node
/**
 * PocketBase schema setup cho MKG Khảo Sát v3 — idempotent, chạy lại nhiều lần vẫn an toàn.
 *
 *   PB_URL=https://db.mkg.vn PB_EMAIL=... PB_PASSWORD=... node scripts/pb-setup.mjs --dry-run
 *   PB_URL=https://db.mkg.vn PB_EMAIL=... PB_PASSWORD=... node scripts/pb-setup.mjs
 *
 * Cần credential superuser (_superusers). Script KHÔNG lưu credential xuống đĩa.
 *
 * Việc nó làm:
 *   1. Backup toàn bộ schema hiện tại ra scripts/.pb-backup-<ts>.json
 *   2. Tạo collection `teams` (+ team MKG, nạp toàn bộ user hiện có làm thành viên)
 *   3. Tạo collection `shares` (link chia sẻ ngắn, id 10 ký tự)
 *   4. Thêm field vào `survey_items`: scope, team, updated_ms, deleted, rev, schema_v,
 *      photo (file, protected), photo_hash  + index + API rules team-aware
 *   5. Backfill record cũ: updated_ms = data.updatedAt, scope = private, rev = 1, schema_v = 2
 *
 * Cờ:
 *   --dry-run        chỉ in kế hoạch, không ghi
 *   --skip-backfill  bỏ bước 5
 *   --enable-rev-cas thêm điều kiện optimistic-concurrency vào updateRule.
 *                    CHỈ bật sau khi đã test bằng một tài khoản thành viên thật —
 *                    nếu rule sai, mọi lệnh sửa sẽ bị 403. Xem README-pb.md.
 *   --add-users "email1:Tên A,email2:Tên B"   tạo hàng loạt user + thêm vào team,
 *                    in ra mật khẩu MỘT LẦN (không lưu, không hiện lại được). Bỏ ":Tên"
 *                    nếu không cần tên hiển thị. Tài khoản đã tồn tại thì chỉ thêm vào team.
 *   --password "..."  dùng chung 1 mật khẩu cho --add-users thay vì tự sinh ngẫu nhiên
 *                    (>= 8 ký tự — PocketBase từ chối mật khẩu ngắn hơn, kể cả "1111").
 *   --team <slug>    team đích cho --add-users (mặc định 'mkg')
 *
 * Ví dụ tạo 3 user cùng mật khẩu (không khuyến khích — mỗi người nên đổi mật khẩu riêng
 * ngay sau khi nhận, hoặc để trống --password cho mỗi người một mật khẩu ngẫu nhiên):
 *   node scripts/pb-setup.mjs --skip-backfill \
 *     --add-users "an@mkg.vn:Anh An,binh@mkg.vn:Chị Bình" --password "mkg-2026-tam"
 */

const URL_BASE = (process.env.PB_URL || 'https://db.mkg.vn').replace(/\/+$/, '');
const EMAIL = process.env.PB_EMAIL;
const PASSWORD = process.env.PB_PASSWORD;
const DRY = process.argv.includes('--dry-run');
const SKIP_BACKFILL = process.argv.includes('--skip-backfill');
const REV_CAS = process.argv.includes('--enable-rev-cas');
const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const ADD_USERS = argValue('--add-users');
const ADD_USERS_PASSWORD = argValue('--password');
const ADD_USERS_TEAM_SLUG = argValue('--team') || 'mkg';

const TEAM_NAME = 'MKG';
const TEAM_SLUG = 'mkg';
// Phải khớp SCOPE_DEFAULT trong src/lib/pb.js. 'team' = mọi dự án chưa đặt phạm vi đều
// thuộc team MKG; muốn giữ riêng thì đổi trong menu dự án trên app.
const SCOPE_DEFAULT = 'team';

if (!EMAIL || !PASSWORD) {
    console.error(`
Thiếu credential superuser.

  PB_EMAIL=<email superuser>  PB_PASSWORD=<mật khẩu>  node scripts/pb-setup.mjs --dry-run

Chạy --dry-run trước để xem kế hoạch, rồi chạy lại không có cờ để áp thật.
`);
    process.exit(1);
}

let token = null;
const log = (...a) => console.log(...a);
const step = (s) => log(`\n▸ ${s}`);
const PASSWORD_MIN = 8; // ràng buộc mặc định của PocketBase — "1111" sẽ bị từ chối thẳng.

async function randomPassword(len = 12) {
    const { randomBytes } = await import('node:crypto');
    return randomBytes(len).toString('base64url').slice(0, len);
}

async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = token;
    const res = await fetch(`${URL_BASE}/api/${path}`, { ...opts, headers });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    if (!res.ok) {
        const detail = json ? JSON.stringify(json.data || json.message || json) : text.slice(0, 300);
        const err = new Error(`${opts.method || 'GET'} ${path} → ${res.status} ${detail}`);
        err.status = res.status;
        err.body = json;
        throw err;
    }
    return json;
}

// ===== Field builders =====
const idField = (pattern = '[a-z0-9]{15}', len = 15, charset = 'a-z0-9') => ({
    name: 'id', type: 'text', system: true, primaryKey: true, required: true,
    autogeneratePattern: pattern, pattern: `^[${charset}]+$`, min: len, max: len,
});
const autodate = (name, onUpdate) => ({ name, type: 'autodate', onCreate: true, onUpdate });
const text = (name, max = 255, required = false) => ({ name, type: 'text', max, required });
const num = (name) => ({ name, type: 'number', onlyInt: true });
const bool = (name) => ({ name, type: 'bool' });
const rel = (name, collectionId, maxSelect, cascadeDelete = false, required = false) =>
    ({ name, type: 'relation', collectionId, maxSelect, minSelect: 0, cascadeDelete, required });

// ===== Rules =====
// Đọc được: của mình, HOẶC của team mà mình là thành viên khi dự án đặt scope=team.
const READ_RULE = 'owner = @request.auth.id || (scope = "team" && team.members.id ?= @request.auth.id)';
// Sửa: như trên, nhưng cấm đổi chủ sở hữu (chống chiếm record của người khác).
const OWNER_GUARD = '(@request.body.owner:isset = false || @request.body.owner = owner)';
// Optimistic concurrency: chỉ nhận rev tăng. rev = 0 là cửa thoát cho record chưa backfill.
const REV_GUARD = '(@request.body.rev:isset = false || rev = 0 || @request.body.rev > rev)';
const WRITE_RULE = REV_CAS
    ? `(${READ_RULE}) && ${OWNER_GUARD} && ${REV_GUARD}`
    : `(${READ_RULE}) && ${OWNER_GUARD}`;

async function main() {
    // In RÕ server đang gọi — trước đây script im lặng dùng URL_BASE, nên nếu PowerShell
    // còn sót PB_URL từ việc khác (rất dễ xảy ra khi một terminal quản lý nhiều hệ thống),
    // nó âm thầm gọi nhầm server mà không ai biết cho tới khi thấy lỗi khó hiểu.
    step(`Server: ${URL_BASE}`);
    if (process.env.PB_URL) {
        log(`  ⚠ PB_URL đang được set tường minh trong môi trường = "${process.env.PB_URL}"`);
        log('  Nếu không cố ý trỏ tới server khác, xoá biến này (PowerShell: Remove-Item Env:\\PB_URL)');
        log('  rồi chạy lại — mặc định sẽ dùng https://db.mkg.vn.');
    }

    step('Đăng nhập superuser');
    const auth = await api('collections/_superusers/auth-with-password', {
        method: 'POST',
        body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
    });
    token = auth.token;
    log(`  ok — ${auth.record?.email}`);

    step('Đọc schema hiện tại');
    const all = await api('collections?perPage=200');
    const byName = new Map(all.items.map(c => [c.name, c]));
    log(`  ${all.items.length} collection tại ${URL_BASE}: ${all.items.map(c => c.name).join(', ')}`);

    const usersCol = byName.get('users');
    const surveyCol = byName.get('survey_items');
    if (!usersCol || !surveyCol) {
        const missing = [!usersCol && 'users', !surveyCol && 'survey_items'].filter(Boolean).join(', ');
        // "users" là collection hệ thống PocketBase tự tạo — không thể thiếu trong một
        // project đã khởi tạo. Thiếu nó gần như chắc chắn nghĩa là ĐANG NHẦM SERVER/PROJECT,
        // không phải project chứa app Khảo Sát, dù tài khoản đăng nhập được bình thường
        // (superuser của project A vẫn login được vào chính project A dù A khác project B).
        throw new Error(
            `Không tìm thấy collection ${missing} tại ${URL_BASE}.\n`
            + `  Tài khoản này đăng nhập được nhưng đang thấy MỘT PROJECT KHÁC (có lẽ CRM/ERP/automation),\n`
            + `  không phải project chứa app Khảo Sát. Kiểm tra: có server/subdomain PocketBase nào khác\n`
            + `  dành riêng cho app này không? Nếu có, chạy lại với PB_URL=<url đúng>.`
        );
    }

    // Backup schema trước khi sửa gì
    if (!DRY) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = path.join('scripts', `.pb-backup-${stamp}.json`);
        await fs.writeFile(file, JSON.stringify(all.items, null, 2), 'utf8');
        log(`  đã backup schema → ${file}`);
    }

    // ===== 1. teams =====
    step('Collection `teams`');
    let teamsCol = byName.get('teams');
    if (teamsCol) {
        log('  đã có — bỏ qua');
    } else if (DRY) {
        log('  [dry-run] sẽ tạo: name, slug (unique), members (relation users, nhiều)');
    } else {
        teamsCol = await api('collections', {
            method: 'POST',
            body: JSON.stringify({
                name: 'teams', type: 'base',
                fields: [
                    idField(),
                    text('name', 120, true),
                    text('slug', 60, true),
                    rel('members', usersCol.id, 500),
                    autodate('created', false),
                    autodate('updated', true),
                ],
                indexes: ['CREATE UNIQUE INDEX `idx_teams_slug` ON `teams` (`slug`)'],
                // Thành viên đọc được team của mình. Tạo/sửa/xóa team: chỉ superuser
                // (Founder quản lý thành viên trong PB Admin UI).
                listRule: 'members.id ?= @request.auth.id',
                viewRule: 'members.id ?= @request.auth.id',
                createRule: null, updateRule: null, deleteRule: null,
            }),
        });
        log(`  đã tạo (id ${teamsCol.id})`);
    }

    // ===== 2. shares =====
    step('Collection `shares`');
    if (byName.get('shares')) {
        log('  đã có — bỏ qua');
    } else if (DRY) {
        log('  [dry-run] sẽ tạo: code = id 10 ký tự, owner, project_id, title, payload, expires, revoked');
    } else {
        const sharesBody = {
            name: 'shares', type: 'base',
            fields: [
                idField('[a-zA-Z0-9]{10}', 10, 'a-zA-Z0-9'),
                rel('owner', usersCol.id, 1, true, true),
                text('project_id', 60),
                text('title', 200),
                { name: 'payload', type: 'json', maxSize: 5_000_000 },
                { name: 'expires', type: 'date' },
                bool('revoked'),
                autodate('created', false),
                autodate('updated', true),
            ],
            indexes: ['CREATE INDEX `idx_shares_owner` ON `shares` (`owner`)'],
            // Chủ sở hữu liệt kê được link của mình để thu hồi.
            listRule: 'owner = @request.auth.id',
            // Người ngoài xem được BẰNG ID (10 ký tự, không đoán được) — hết hạn/thu hồi thì 404.
            viewRule: 'revoked = false && (expires = "" || expires > @now)',
            createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
            updateRule: 'owner = @request.auth.id',
            deleteRule: 'owner = @request.auth.id',
        };
        let created;
        try {
            created = await api('collections', { method: 'POST', body: JSON.stringify(sharesBody) });
        } catch (err) {
            // Bản PocketBase cũ không cho tùy biến độ dài id → rơi về id mặc định 15 ký tự.
            log(`  id 10 ký tự bị từ chối (${err.status}) — dùng id mặc định 15 ký tự`);
            sharesBody.fields[0] = idField();
            created = await api('collections', { method: 'POST', body: JSON.stringify(sharesBody) });
        }
        log(`  đã tạo (id ${created.id}, độ dài code ${created.fields.find(f => f.name === 'id')?.max})`);
    }

    // ===== 3. survey_items — thêm field + index + rules =====
    step('Collection `survey_items`');
    const teamsId = teamsCol?.id || byName.get('teams')?.id;
    const existing = new Map(surveyCol.fields.map(f => [f.name, f]));
    const wanted = [
        { name: 'scope', def: { name: 'scope', type: 'select', values: ['private', 'team'], maxSelect: 1 } },
        { name: 'team', def: teamsId ? rel('team', teamsId, 1) : null },
        { name: 'updated_ms', def: num('updated_ms') },
        { name: 'deleted', def: bool('deleted') },
        { name: 'rev', def: num('rev') },
        { name: 'schema_v', def: num('schema_v') },
        {
            name: 'photo', def: {
                name: 'photo', type: 'file', maxSelect: 1, maxSize: 6_000_000, protected: true,
                mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], thumbs: [],
            },
        },
        { name: 'photo_hash', def: text('photo_hash', 64) },
        // Tên hiển thị của người tạo. Cần vì rule của `users` không cho thành viên
        // đọc record của nhau, nên không expand được owner để lấy email.
        { name: 'owner_name', def: text('owner_name', 120) },
    ];
    const toAdd = wanted.filter(w => w.def && !existing.has(w.name));
    log(`  field cần thêm: ${toAdd.length ? toAdd.map(w => w.name).join(', ') : '(không có)'}`);

    const wantIndexes = [
        'CREATE UNIQUE INDEX `idx_si_owner_item` ON `survey_items` (`owner`, `item_id`)',
        'CREATE INDEX `idx_si_updated_ms` ON `survey_items` (`updated_ms`)',
        'CREATE INDEX `idx_si_scope_team` ON `survey_items` (`scope`, `team`)',
    ];
    const idxName = (sql) => sql.match(/INDEX\s+`?([\w]+)`?/i)?.[1];
    const haveIdx = new Set((surveyCol.indexes || []).map(idxName));
    const newIndexes = wantIndexes.filter(sql => !haveIdx.has(idxName(sql)));
    log(`  index cần thêm: ${newIndexes.length ? newIndexes.map(idxName).join(', ') : '(không có)'}`);
    log(`  listRule  → ${READ_RULE}`);
    log(`  updateRule → ${WRITE_RULE}`);
    if (!REV_CAS) log('  (rev CAS TẮT — bật bằng --enable-rev-cas sau khi test với tài khoản thành viên)');

    if (DRY) {
        log('\n[dry-run] Chưa ghi gì — kể cả team MKG, backfill, và --add-users nếu có.');
        log('Bỏ cờ --dry-run để áp thật.');
        return;
    }

    // Trùng (owner,item_id) sẽ làm unique index tạo thất bại — kiểm tra trước để báo rõ.
    if (newIndexes.some(sql => idxName(sql) === 'idx_si_owner_item')) {
        const dups = await findDuplicates();
        if (dups.length) {
            log(`\n  ⚠ Có ${dups.length} cặp (owner,item_id) trùng — bỏ qua unique index.`);
            for (const d of dups.slice(0, 10)) log(`    ${d.owner}/${d.item_id} × ${d.ids.length}: ${d.ids.join(', ')}`);
            log('    Dọn trùng trong PB Admin rồi chạy lại script để thêm unique index.');
            newIndexes.splice(newIndexes.findIndex(sql => idxName(sql) === 'idx_si_owner_item'), 1);
        }
    }

    // PATCH collection thay thế toàn bộ mảng fields → phải gộp, giữ nguyên field cũ (kèm id) để không mất dữ liệu.
    const updated = await api(`collections/${surveyCol.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
            fields: [...surveyCol.fields, ...toAdd.map(w => w.def)],
            indexes: [...(surveyCol.indexes || []), ...newIndexes],
            listRule: READ_RULE,
            viewRule: READ_RULE,
            createRule: '@request.auth.id != "" && @request.body.owner = @request.auth.id',
            updateRule: WRITE_RULE,
            deleteRule: 'owner = @request.auth.id',
        }),
    });
    log(`  đã cập nhật — ${updated.fields.length} field, ${updated.indexes.length} index`);

    // ===== 4. Team MKG + nạp thành viên =====
    step(`Team "${TEAM_NAME}"`);
    const users = await listAll('users', 'id,email');
    const found = await api(`collections/teams/records?perPage=1&filter=${encodeURIComponent(`slug='${TEAM_SLUG}'`)}`);
    const memberIds = users.map(u => u.id);
    let team;
    if (found.items?.length) {
        team = found.items[0];
        const missing = memberIds.filter(id => !(team.members || []).includes(id));
        if (missing.length) {
            team = await api(`collections/teams/records/${team.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ members: [...new Set([...(team.members || []), ...memberIds])] }),
            });
            log(`  đã thêm ${missing.length} thành viên`);
        } else {
            log('  đã có, thành viên đầy đủ');
        }
    } else {
        team = await api('collections/teams/records', {
            method: 'POST',
            body: JSON.stringify({ name: TEAM_NAME, slug: TEAM_SLUG, members: memberIds }),
        });
        log(`  đã tạo (id ${team.id}) với ${memberIds.length} thành viên`);
    }
    log(`  thành viên: ${users.map(u => u.email).join(', ') || '(chưa có user nào)'}`);

    // ===== 5. Backfill record cũ =====
    if (SKIP_BACKFILL) {
        step('Backfill — bỏ qua (--skip-backfill)');
    } else {
        step('Backfill record cũ');
        const records = await listAll('survey_items', 'id,item_id,updated_ms,scope,team,rev,schema_v,data,deleted');
        let done = 0, skipped = 0;
        for (const r of records) {
            const ms = Number(r.data?.updatedAt) || 0;
            const isDel = !!r.data?._deleted;
            // Mặc định TẤT CẢ vào team MKG. Dự án đã được đặt riêng tư thì tôn trọng,
            // không kéo ngược lại thành team.
            const scope = r.scope || SCOPE_DEFAULT;
            const teamId = scope === 'team' ? team.id : null;
            const need = (r.updated_ms || 0) !== ms || r.scope !== scope
                || (r.team || null) !== teamId || !r.rev || r.deleted !== isDel;
            if (!need) { skipped++; continue; }
            try {
                await api(`collections/survey_items/records/${r.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                        updated_ms: ms,
                        scope,
                        team: teamId,
                        deleted: isDel,
                        rev: r.rev || 1,
                        schema_v: r.schema_v || 2,
                    }),
                });
                done++;
            } catch (err) {
                log(`  ⚠ ${r.item_id}: ${err.message}`);
            }
        }
        const teamCount = records.filter(r => (r.scope || SCOPE_DEFAULT) === 'team').length;
        log(`  ${records.length} record — cập nhật ${done}, đã đúng ${skipped}`);
        log(`  ${teamCount} record vào team ${TEAM_NAME}, ${records.length - teamCount} giữ riêng tư`);
    }

    // ===== 6. Tạo hàng loạt user (tùy chọn, --add-users) =====
    if (ADD_USERS) {
        step(`Tạo user hàng loạt → team "${ADD_USERS_TEAM_SLUG}"`);
        if (ADD_USERS_PASSWORD && ADD_USERS_PASSWORD.length < PASSWORD_MIN) {
            // Chặn TRƯỚC khi tạo bất cứ gì — "1111" rơi đúng vào đây, không tạo nửa vời.
            throw new Error(`--password "${ADD_USERS_PASSWORD}" chỉ có ${ADD_USERS_PASSWORD.length} ký tự — `
                + `PocketBase yêu cầu tối thiểu ${PASSWORD_MIN}. Không tạo user nào.`);
        }
        const entries = ADD_USERS.split(',').map(s => s.trim()).filter(Boolean).map(s => {
            const [email, ...rest] = s.split(':');
            return { email: email.trim(), name: rest.join(':').trim() };
        });
        const teamRes = await api(`collections/teams/records?perPage=1&filter=${encodeURIComponent(`slug='${ADD_USERS_TEAM_SLUG}'`)}`);
        if (!teamRes.items?.length) throw new Error(`Không tìm thấy team slug="${ADD_USERS_TEAM_SLUG}"`);
        const targetTeamId = teamRes.items[0].id;

        const results = [];
        for (const { email, name } of entries) {
            if (!email.includes('@')) { log(`  ⚠ bỏ qua "${email}" — không phải email hợp lệ`); continue; }
            const password = ADD_USERS_PASSWORD || await randomPassword();
            const found = await api(`collections/users/records?perPage=1&filter=${encodeURIComponent(`email='${email}'`)}`);
            let user, created = false;
            if (found.items?.length) {
                user = found.items[0];
                log(`  ${email} — đã có tài khoản, chỉ thêm vào team`);
            } else {
                const local = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g, '') || 'user';
                user = await api('collections/users/records', {
                    method: 'POST',
                    body: JSON.stringify({
                        email, password, passwordConfirm: password, name: name || '',
                        username: `${local}${Math.random().toString(36).slice(2, 6)}`,
                        emailVisibility: true, verified: true,
                    }),
                });
                created = true;
                log(`  ${email} — đã tạo tài khoản mới`);
            }
            const fresh = await api(`collections/teams/records/${targetTeamId}`);
            if (!(fresh.members || []).includes(user.id)) {
                await api(`collections/teams/records/${targetTeamId}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ members: [...(fresh.members || []), user.id] }),
                });
            }
            results.push({ email, password: created ? password : '(tài khoản có sẵn — không đổi mật khẩu)' });
        }
        if (results.length) {
            log('\n  LƯU LẠI NGAY — mật khẩu không hiện lại được sau bước này:');
            for (const r of results) log(`    ${r.email.padEnd(28)} ${r.password}`);
        }
    }

    log(`\n✓ Xong. Dán vào src/lib/pb.js nếu id team thay đổi: TEAM_SLUG='${TEAM_SLUG}'\n`);
}

async function listAll(col, fields) {
    const out = [];
    for (let page = 1; ; page++) {
        const q = `collections/${col}/records?page=${page}&perPage=500${fields ? `&fields=${fields}` : ''}`;
        const res = await api(q);
        out.push(...(res.items || []));
        if (page >= (res.totalPages || 1)) break;
    }
    return out;
}

async function findDuplicates() {
    const recs = await listAll('survey_items', 'id,owner,item_id');
    const seen = new Map();
    for (const r of recs) {
        const k = `${r.owner}/${r.item_id}`;
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k).push(r.id);
    }
    return [...seen.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([k, ids]) => ({ owner: k.split('/')[0], item_id: k.split('/')[1], ids }));
}

main().catch(err => {
    console.error(`\n✗ ${err.message}`);
    if (err.body) console.error(JSON.stringify(err.body, null, 2));
    process.exit(1);
});
