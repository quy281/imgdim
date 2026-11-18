#!/usr/bin/env node
/**
 * Script thiet lap ha tang Cloudflare D1 + R2 + Cron Worker cho MKG Khao Sat.
 *
 * Cac lenh:
 *   node scripts/cf-setup.mjs --check        # Kiem tra D1, R2, wrangler login
 *   node scripts/cf-setup.mjs --provision    # Tao D1 DB, chay migration 0001_init.sql, tao R2 neu da bat
 *   node scripts/cf-setup.mjs --deploy-cron  # Deploy Worker Cron backup dinh ky (yeu cau R2 da bat)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);

const DB_NAME = 'mkg-khaosat-db';
const BUCKET_NAME = 'mkg-khaosat-media';
const PAGES_PROJECT = 'imgdim';
const WORKER_TOML = path.resolve('workers/backup-cron/wrangler.toml');
const MIGRATION_SQL = path.resolve('cloudflare/migrations/0001_init.sql');

function runCapture(wranglerArgs, opts = {}) {
    try {
        const out = execFileSync('npx', ['--no-install', 'wrangler', ...wranglerArgs], {
            encoding: 'utf8',
            shell: true,
            ...opts,
        });
        return { ok: true, out };
    } catch (err) {
        return { ok: false, out: (err.stdout || '') + '\n' + (err.stderr || err.message) };
    }
}

function parseD1Uuid(listOut, dbName) {
    for (const line of listOut.split(/\r?\n/)) {
        if (!line.includes(dbName)) continue;
        const m = line.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (m) return m[0];
    }
    return '';
}

function updateCronWranglerToml(dbId) {
    const content = `name = "mkg-khaosat-backup-cron"
main = "src/index.js"
compatibility_date = "2026-01-01"

[triggers]
# Chay tu dong luc 02:00 sang gio Viet Nam (19:00 UTC) hang ngay
crons = ["0 19 * * *"]

[[d1_databases]]
binding = "DB"
database_name = "${DB_NAME}"
database_id = "${dbId}"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "${BUCKET_NAME}"
`;
    fs.writeFileSync(WORKER_TOML, content, 'utf8');
}

function generateWranglerPagesExample(dbId) {
    const outPath = path.resolve('wrangler.pages.toml.example');
    const content = `# Doi ten thanh wrangler.toml SAU KHI da bat R2 tren Cloudflare Dashboard va tao bucket "${BUCKET_NAME}".
name = "${PAGES_PROJECT}"
pages_build_output_dir = "dist"
compatibility_date = "2026-01-01"

[[d1_databases]]
binding = "DB"
database_name = "${DB_NAME}"
database_id = "${dbId || '<D1_DATABASE_ID>'}"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "${BUCKET_NAME}"
`;
    fs.writeFileSync(outPath, content, 'utf8');
}

async function main() {
    console.log('> Kiem tra dang nhap Cloudflare Wrangler...');
    const who = runCapture(['whoami']);
    if (!who.ok) {
        console.error(who.out);
        process.exit(1);
    }
    console.log(who.out.trim());

    console.log('\n> Kiem tra D1...');
    const d1List = runCapture(['d1', 'list']);
    let dbId = parseD1Uuid(d1List.out, DB_NAME);
    if (!dbId && hasFlag('--provision')) {
        console.log(`> Tao D1 database "${DB_NAME}"...`);
        const created = runCapture(['d1', 'create', DB_NAME]);
        if (!created.ok) {
            console.error(created.out);
            process.exit(1);
        }
        dbId = parseD1Uuid(created.out, DB_NAME) || parseD1Uuid(runCapture(['d1', 'list']).out, DB_NAME);
    }
    console.log(`  D1 ${DB_NAME}: ${dbId || 'chua tao (chay --provision)'}`);

    if (dbId && hasFlag('--provision')) {
        console.log('> Ap schema 0001_init.sql len D1 (--remote)...');
        execFileSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', DB_NAME, '--remote', '--file', MIGRATION_SQL, '--yes'], {
            stdio: 'inherit', shell: true,
        });
        updateCronWranglerToml(dbId);
        generateWranglerPagesExample(dbId);
    } else if (dbId) {
        generateWranglerPagesExample(dbId);
    }

    console.log('\n> Kiem tra R2...');
    const r2List = runCapture(['r2', 'bucket', 'list']);
    let r2Enabled = r2List.ok;
    let bucketExists = r2Enabled && r2List.out.includes(BUCKET_NAME);
    if (!r2Enabled) {
        console.log('! R2 CHUA DUOC BAT tren Cloudflare Dashboard (code 10042).');
        console.log('  Hay mo https://dash.cloudflare.com -> muc R2 Object Storage -> bam Enable R2 (goi 10GB free, 0d egress).');
        console.log('  Sau khi bat xong, chay lai: node scripts/cf-setup.mjs --provision');
    } else if (!bucketExists && hasFlag('--provision')) {
        console.log(`> Tao R2 bucket "${BUCKET_NAME}"...`);
        execFileSync('npx', ['--no-install', 'wrangler', 'r2', 'bucket', 'create', BUCKET_NAME], { stdio: 'inherit', shell: true });
        bucketExists = true;
    } else {
        console.log(`  R2 bucket ${BUCKET_NAME}: ${bucketExists ? 'SAN SANG' : 'chua tao (chay --provision)'}`);
    }

    if (hasFlag('--secrets')) {
        const jwtSecret = crypto.randomBytes(32).toString('hex');
        const backupSecret = crypto.randomBytes(24).toString('hex');
        console.log('\n> Nap JWT_SECRET & BACKUP_SECRET len Pages Project...');
        execFileSync('npx', ['--no-install', 'wrangler', 'pages', 'secret', 'put', 'JWT_SECRET', '--project-name', PAGES_PROJECT], {
            input: jwtSecret, stdio: ['pipe', 'inherit', 'inherit'], shell: true,
        });
        execFileSync('npx', ['--no-install', 'wrangler', 'pages', 'secret', 'put', 'BACKUP_SECRET', '--project-name', PAGES_PROJECT], {
            input: backupSecret, stdio: ['pipe', 'inherit', 'inherit'], shell: true,
        });
        execFileSync('npx', ['--no-install', 'wrangler', 'secret', 'put', 'BACKUP_SECRET'], {
            cwd: path.resolve('workers/backup-cron'), input: backupSecret, stdio: ['pipe', 'inherit', 'inherit'], shell: true,
        });
    }

    if (hasFlag('--deploy-cron')) {
        if (!dbId || !bucketExists) {
            console.error('Can D1 va R2 bucket san sang truoc khi deploy cron worker.');
            process.exit(1);
        }
        execFileSync('npx', ['--no-install', 'wrangler', 'deploy'], {
            cwd: path.resolve('workers/backup-cron'), stdio: 'inherit', shell: true,
        });
    }
}

main().catch(err => {
    console.error(err?.message || err);
    process.exit(1);
});
