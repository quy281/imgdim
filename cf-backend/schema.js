// Quan ly & kiem tra schema D1, tuong thich endpoint /api/collections cho UI Quan tri TeamAdminSheet.

export const DDL_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE COLLATE NOCASE,
        username TEXT UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        is_superuser INTEGER NOT NULL DEFAULT 0,
        password_hash TEXT NOT NULL DEFAULT '',
        token_version INTEGER NOT NULL DEFAULT 1,
        verified INTEGER NOT NULL DEFAULT 1,
        email_visibility INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,
    `CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS team_members (
        team_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        PRIMARY KEY (team_id, user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id)`,
    `CREATE TABLE IF NOT EXISTS survey_items (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        owner_name TEXT NOT NULL DEFAULT '',
        item_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT 'team',
        team TEXT NOT NULL DEFAULT '',
        updated_ms INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        rev INTEGER NOT NULL DEFAULT 1,
        schema_v INTEGER NOT NULL DEFAULT 3,
        photo TEXT NOT NULL DEFAULT '',
        photo_r2_key TEXT NOT NULL DEFAULT '',
        photo_hash TEXT NOT NULL DEFAULT '',
        data_json TEXT,
        data_r2_key TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_si_owner_item ON survey_items(owner, item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_si_item_id ON survey_items(item_id)`,
    `CREATE INDEX IF NOT EXISTS idx_si_project_id ON survey_items(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_si_updated_ms ON survey_items(updated_ms)`,
    `CREATE INDEX IF NOT EXISTS idx_si_scope_team ON survey_items(scope, team)`,
    `CREATE TABLE IF NOT EXISTS deletions (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'doc',
        at INTEGER NOT NULL DEFAULT 0,
        by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        payload_json TEXT,
        payload_r2_key TEXT NOT NULL DEFAULT '',
        revoked INTEGER NOT NULL DEFAULT 0,
        expires TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_shares_project ON shares(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner)`,
    `CREATE TABLE IF NOT EXISTS customer_profiles (
        id TEXT PRIMARY KEY,
        user TEXT NOT NULL UNIQUE,
        team TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_customer_profile_team ON customer_profiles(team)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profile_user ON customer_profiles(user)`,
    `CREATE TABLE IF NOT EXISTS customer_submissions (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        team TEXT NOT NULL,
        source_project_id TEXT NOT NULL,
        submission_key TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        payload_json TEXT,
        payload_r2_key TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'submitted',
        submitted_ms INTEGER NOT NULL DEFAULT 0,
        reviewed_by TEXT NOT NULL DEFAULT '',
        reviewed_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_submission_key ON customer_submissions(owner, submission_key)`,
    `CREATE INDEX IF NOT EXISTS idx_customer_sub_team ON customer_submissions(team, submitted_ms)`,
    `CREATE TABLE IF NOT EXISTS furniture_catalog (
        id TEXT PRIMARY KEY,
        catalog_key TEXT NOT NULL UNIQUE,
        payload_json TEXT,
        payload_r2_key TEXT NOT NULL DEFAULT '',
        updated_ms INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS signup_requests (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        requested_ms INTEGER NOT NULL DEFAULT 0,
        reviewed_ms INTEGER NOT NULL DEFAULT 0,
        reviewed_by TEXT NOT NULL DEFAULT '',
        team TEXT NOT NULL DEFAULT '',
        user TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_signup_status_ms ON signup_requests(status, requested_ms)`,
    `CREATE TABLE IF NOT EXISTS experience_posts (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        owner_name TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'video',
        title TEXT NOT NULL,
        desc TEXT NOT NULL DEFAULT '',
        detail_url TEXT NOT NULL,
        embed_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        submitted_ms INTEGER NOT NULL DEFAULT 0,
        reviewed_by TEXT NOT NULL DEFAULT '',
        reviewed_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_exp_status_ms ON experience_posts(status, submitted_ms)`,
    `CREATE TABLE IF NOT EXISTS backup_runs (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        finished_at INTEGER NOT NULL DEFAULT 0,
        trigger_source TEXT NOT NULL DEFAULT 'cron',
        status TEXT NOT NULL DEFAULT 'running',
        db_file_name TEXT NOT NULL DEFAULT '',
        db_gdrive_id TEXT NOT NULL DEFAULT '',
        db_r2_key TEXT NOT NULL DEFAULT '',
        db_bytes INTEGER NOT NULL DEFAULT 0,
        media_total INTEGER NOT NULL DEFAULT 0,
        media_synced INTEGER NOT NULL DEFAULT 0,
        media_skipped INTEGER NOT NULL DEFAULT 0,
        media_failed INTEGER NOT NULL DEFAULT 0,
        media_bytes INTEGER NOT NULL DEFAULT 0,
        error_text TEXT NOT NULL DEFAULT ''
    )`,
    `CREATE INDEX IF NOT EXISTS idx_backup_runs_started ON backup_runs(started_at DESC)`,
    `CREATE TABLE IF NOT EXISTS backup_media_manifest (
        r2_key TEXT PRIMARY KEY,
        etag TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0,
        gdrive_file_id TEXT NOT NULL DEFAULT '',
        gdrive_folder_id TEXT NOT NULL DEFAULT '',
        backed_up_at INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS media_blobs (
        key TEXT PRIMARY KEY,
        content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size INTEGER NOT NULL DEFAULT 0,
        data_b64 TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS r2_ledger (
        r2_key TEXT PRIMARY KEY,
        size INTEGER NOT NULL DEFAULT 0,
        updated_ms INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS quota_monthly (
        month TEXT PRIMARY KEY,
        class_a INTEGER NOT NULL DEFAULT 0,
        class_b INTEGER NOT NULL DEFAULT 0
    )`,
];

export async function ensureD1Schema(db) {
    for (const sql of DDL_STATEMENTS) {
        await db.prepare(sql).run();
    }
}

const IS_STAFF = '@request.auth.id != "" && @request.auth.role != "customer"';
const READ_RULE = `(${IS_STAFF}) && (owner = @request.auth.id || (scope = "team" && team != "" && team.members.id ?= @request.auth.id))`;
const OWNER_GUARD = '(@request.body.owner:isset = false || @request.body.owner = owner)';
const WRITE_RULE = `(${READ_RULE}) && ${OWNER_GUARD}`;
const SURVEY_CREATE_RULE = `${IS_STAFF} && @request.body.owner = @request.auth.id`;
const IS_ADMIN = '@request.auth.role = "admin"';
const SURVEY_DELETE_RULE = `(${IS_STAFF} && owner = @request.auth.id) || ${IS_ADMIN}`;
const STAFF_TEAM_MEMBER = `(${IS_STAFF}) && team != "" && team.members.id ?= @request.auth.id`;
const CUSTOMER_ACCESS_RULE = `user = @request.auth.id || ${IS_ADMIN} || (${STAFF_TEAM_MEMBER})`;
const CUSTOMER_SUBMISSION_READ = `owner = @request.auth.id || ${IS_ADMIN} || (${STAFF_TEAM_MEMBER})`;
const EXPERIENCE_READ_RULE = `${IS_STAFF} && (status = "public" || owner = @request.auth.id || ${IS_ADMIN})`;

async function tableInfo(db, name) {
    const res = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind(name).first();
    if (!res) return null;
    const cols = await db.prepare(`PRAGMA table_info("${name}")`).all();
    return (cols.results || []).map(c => ({ name: c.name }));
}

async function tableIndexes(db, name) {
    const res = await db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`).bind(name).all();
    return (res.results || []).map(r => `CREATE INDEX \`${r.name}\``);
}

/**
 * Tra ve metadata tuong thich API /api/collections cho inspectBackend() trong src/lib/pb.js.
 */
export async function inspectCollectionsMeta(db) {
    const tables = [
        'users', 'teams', 'survey_items', 'shares', 'deletions',
        'customer_profiles', 'customer_submissions', 'signup_requests',
        'experience_posts', 'furniture_catalog',
    ];
    const items = [];
    for (const t of tables) {
        const cols = await tableInfo(db, t);
        if (!cols) continue;
        const idx = await tableIndexes(db, t);
        const apiFields = cols.map(c => {
            if (c.name === 'data_json') return { name: 'data' };
            if (c.name === 'payload_json') return { name: 'payload' };
            return c;
        });
        if (t === 'users') {
            items.push({
                id: 'users', name: 'users', type: 'auth',
                fields: [...apiFields.filter(c => c.name !== 'role'), { name: 'role', type: 'select', values: ['admin', 'customer'] }],
                indexes: idx,
            });
        } else if (t === 'survey_items') {
            items.push({
                id: 'survey_items', name: 'survey_items', type: 'base',
                fields: apiFields,
                indexes: idx,
                listRule: READ_RULE,
                viewRule: READ_RULE,
                createRule: SURVEY_CREATE_RULE,
                updateRule: WRITE_RULE,
                deleteRule: SURVEY_DELETE_RULE,
            });
        } else if (t === 'shares') {
            items.push({
                id: 'shares', name: 'shares', type: 'base',
                fields: apiFields, indexes: idx,
                listRule: `owner = @request.auth.id && @request.auth.role != "customer"`,
                viewRule: 'revoked = false && (expires = "" || expires > @now)',
                createRule: `${IS_STAFF} && @request.body.owner = @request.auth.id`,
                updateRule: `owner = @request.auth.id && @request.auth.role != "customer"`,
                deleteRule: `owner = @request.auth.id && @request.auth.role != "customer"`,
            });
        } else if (t === 'deletions') {
            items.push({
                id: 'deletions', name: 'deletions', type: 'base',
                fields: apiFields, indexes: idx,
                listRule: IS_STAFF, viewRule: IS_STAFF, createRule: IS_STAFF, updateRule: IS_STAFF, deleteRule: IS_ADMIN,
            });
        } else if (t === 'customer_profiles') {
            items.push({
                id: 'customer_profiles', name: 'customer_profiles', type: 'base',
                fields: apiFields, indexes: idx,
                listRule: CUSTOMER_ACCESS_RULE, viewRule: CUSTOMER_ACCESS_RULE,
                createRule: IS_ADMIN, updateRule: IS_ADMIN, deleteRule: IS_ADMIN,
            });
        } else if (t === 'customer_submissions') {
            items.push({
                id: 'customer_submissions', name: 'customer_submissions', type: 'base',
                fields: apiFields, indexes: idx,
                listRule: CUSTOMER_SUBMISSION_READ, viewRule: CUSTOMER_SUBMISSION_READ,
                createRule: '@request.auth.role = "customer" && @request.body.owner = @request.auth.id && @request.body.team != "" && @request.body.status = "submitted"',
                updateRule: `(${IS_ADMIN} || (${STAFF_TEAM_MEMBER})) && @request.body.owner:isset = false && @request.body.team:isset = false && @request.body.payload:isset = false && @request.body.submission_key:isset = false && @request.body.source_project_id:isset = false`,
                deleteRule: IS_ADMIN,
            });
        } else if (t === 'signup_requests') {
            items.push({
                id: 'signup_requests', name: 'signup_requests', type: 'base',
                fields: cols, indexes: idx,
                listRule: IS_ADMIN, viewRule: IS_ADMIN, createRule: '', updateRule: IS_ADMIN, deleteRule: IS_ADMIN,
            });
        } else if (t === 'experience_posts') {
            items.push({
                id: 'experience_posts', name: 'experience_posts', type: 'base',
                fields: cols, indexes: idx,
                listRule: EXPERIENCE_READ_RULE, viewRule: EXPERIENCE_READ_RULE,
                createRule: `${IS_STAFF} && @request.body.owner = @request.auth.id && @request.body.status = "pending"`,
                updateRule: IS_ADMIN, deleteRule: IS_ADMIN,
            });
        } else {
            items.push({ id: t, name: t, type: 'base', fields: cols, indexes: idx });
        }
    }
    return { items, page: 1, perPage: 200, totalItems: items.length, totalPages: 1 };
}
