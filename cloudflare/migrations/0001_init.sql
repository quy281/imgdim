-- Cloudflare D1 Schema cho MKG Khao Sat
-- Tuong thich du lieu & quyen cua PocketBase v3 + ho tro R2 offload (>200KB) & Google Drive Backup.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE COLLATE NOCASE,
    username TEXT UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',           -- '' (nhan vien) | 'admin' | 'customer'
    is_superuser INTEGER NOT NULL DEFAULT 0, -- 1 cho Founder / quan tri he thong cao nhat
    password_hash TEXT NOT NULL DEFAULT '',  -- pbkdf2$... hoac legacy bcrypt ($2a$/$2b$/$2y$)
    token_version INTEGER NOT NULL DEFAULT 1,
    verified INTEGER NOT NULL DEFAULT 1,
    email_visibility INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS survey_items (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    owner_name TEXT NOT NULL DEFAULT '',
    item_id TEXT NOT NULL,
    kind TEXT NOT NULL,                      -- 'project' | 'doc'
    project_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'team',      -- 'private' | 'team'
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
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_si_owner_item ON survey_items(owner, item_id);
CREATE INDEX IF NOT EXISTS idx_si_item_id ON survey_items(item_id);
CREATE INDEX IF NOT EXISTS idx_si_project_id ON survey_items(project_id);
CREATE INDEX IF NOT EXISTS idx_si_updated_ms ON survey_items(updated_ms);
CREATE INDEX IF NOT EXISTS idx_si_scope_team ON survey_items(scope, team);

CREATE TABLE IF NOT EXISTS deletions (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'doc',
    at INTEGER NOT NULL DEFAULT 0,
    by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
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
);

CREATE INDEX IF NOT EXISTS idx_shares_project ON shares(project_id);
CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner);

CREATE TABLE IF NOT EXISTS customer_profiles (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL UNIQUE,
    team TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_profile_user ON customer_profiles(user);
CREATE INDEX IF NOT EXISTS idx_customer_profile_team ON customer_profiles(team);

CREATE TABLE IF NOT EXISTS customer_submissions (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL,
    source_project_id TEXT NOT NULL,
    submission_key TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    payload_json TEXT,
    payload_r2_key TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'submitted', -- 'submitted' | 'imported' | 'rejected'
    submitted_ms INTEGER NOT NULL DEFAULT 0,
    reviewed_by TEXT NOT NULL DEFAULT '',
    reviewed_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_submission_key ON customer_submissions(owner, submission_key);
CREATE INDEX IF NOT EXISTS idx_customer_sub_team ON customer_submissions(team, submitted_ms);

CREATE TABLE IF NOT EXISTS furniture_catalog (
    id TEXT PRIMARY KEY,
    catalog_key TEXT NOT NULL UNIQUE,
    payload_json TEXT,
    payload_r2_key TEXT NOT NULL DEFAULT '',
    updated_ms INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signup_requests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
    requested_ms INTEGER NOT NULL DEFAULT 0,
    reviewed_ms INTEGER NOT NULL DEFAULT 0,
    reviewed_by TEXT NOT NULL DEFAULT '',
    team TEXT NOT NULL DEFAULT '',
    user TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signup_status_ms ON signup_requests(status, requested_ms);

CREATE TABLE IF NOT EXISTS experience_posts (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    owner_name TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'video',
    title TEXT NOT NULL,
    desc TEXT NOT NULL DEFAULT '',
    detail_url TEXT NOT NULL,
    embed_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'public' | 'rejected'
    submitted_ms INTEGER NOT NULL DEFAULT 0,
    reviewed_by TEXT NOT NULL DEFAULT '',
    reviewed_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exp_status_ms ON experience_posts(status, submitted_ms);

CREATE TABLE IF NOT EXISTS backup_runs (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL DEFAULT 0,
    trigger_source TEXT NOT NULL DEFAULT 'cron', -- 'cron' | 'manual'
    status TEXT NOT NULL DEFAULT 'running',       -- 'running' | 'ok' | 'partial' | 'error'
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
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_started ON backup_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS backup_media_manifest (
    r2_key TEXT PRIMARY KEY,
    etag TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    gdrive_file_id TEXT NOT NULL DEFAULT '',
    gdrive_folder_id TEXT NOT NULL DEFAULT '',
    backed_up_at INTEGER NOT NULL DEFAULT 0
);
