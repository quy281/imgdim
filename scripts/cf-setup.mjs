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

function r2Block(bucketExists) {
    if (bucketExists) {
        return `[[r2_buckets]]
binding = "MEDIA"
bucket_name = "${BUCKET_NAME}"`;
    }
    return `# Bo comment khoi nay sau khi bat R2 tren Dashboard va chay: node scripts/cf-setup.mjs --provision
# [[r2_buckets]]
# binding = "MEDIA"
# bucket_name = "${BUCKET_NAME}"`;
}

function updateCronWranglerToml(dbId, bucketExists) {
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

${r2Block(bucketExists)}
`;
    fs.writeFileSync(WORKER_TOML, content, 'utf8');
}

function writePagesWranglerToml(dbId, bucketExists) {
    const outPath = path.resolve('wrangler.toml');
    const content = `name = "${PAGES_PROJECT}"
pages_build_output_dir = "dist"
compatibility_date = "2026-01-01"

[[d1_databases]]
binding = "DB"
database_name = "${DB_NAME}"
database_id = "${dbId || '<D1_DATABASE_ID>'}"

${r2Block(bucketExists)}
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

    console.log('\n> Kiem tra R2...');
    let r2List = runCapture(['r2', 'bucket', 'list']);
    if (!r2List.ok && !r2List.out.includes('10042')) {
        r2List = runCapture(['r2', 'bucket', 'list']);
    }
    const r2Disabled = !r2List.ok && r2List.out.includes('10042');
    const existingHasR2 = fs.existsSync(path.resolve('wrangler.toml'))
        && /\n\[\[r2_buckets\]\]/.test(fs.readFileSync(path.resolve('wrangler.toml'), 'utf8'));
    let bucketExists = r2List.ok ? r2List.out.includes(BUCKET_NAME) : (!r2Disabled && existingHasR2);
    if (r2Disabled) {
        console.log('! R2 CHUA DUOC BAT tren Cloudflare Dashboard (code 10042).');
        console.log('  Hay mo https://dash.cloudflare.com -> muc R2 Object Storage -> bam Enable R2 (goi 10GB free, 0d egress).');
        console.log('  Sau khi bat xong, chay lai: node scripts/cf-setup.mjs --provision --deploy-cron --deploy-pages');
    } else if (!r2List.ok) {
        console.warn('! Loi tam thoi khi kiem tra R2; giu nguyen cau hinh bucket hien co.');
    } else if (!bucketExists && hasFlag('--provision')) {
        console.log(`> Tao R2 bucket "${BUCKET_NAME}"...`);
        execFileSync('npx', ['--no-install', 'wrangler', 'r2', 'bucket', 'create', BUCKET_NAME], { stdio: 'inherit', shell: true });
        bucketExists = true;
    } else {
        console.log(`  R2 bucket ${BUCKET_NAME}: ${bucketExists ? 'SAN SANG' : 'chua tao (chay --provision)'}`);
    }

    if (dbId && hasFlag('--provision')) {
        console.log('> Ap schema 0001_init.sql len D1 (--remote)...');
        execFileSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', DB_NAME, '--remote', '--file', MIGRATION_SQL, '--yes'], {
            stdio: 'inherit', shell: true,
        });
        updateCronWranglerToml(dbId, bucketExists);
        writePagesWranglerToml(dbId, bucketExists);
    }

    if (hasFlag('--deploy-cron')) {
        if (!dbId) {
            console.error('Can D1 san sang truoc khi deploy cron worker.');
            process.exit(1);
        }
        updateCronWranglerToml(dbId, bucketExists);
        console.log('\n> Deploy Cron Worker mkg-khaosat-backup-cron...');
        try {
            execFileSync('npx', ['--no-install', 'wrangler', 'deploy'], {
                cwd: path.resolve('workers/backup-cron'), stdio: 'inherit', shell: true,
            });
        } catch (err) {
            console.warn('! Luu y: Cron trigger tren Worker gap gioi han (vi du: 5/5 Cron Free cua Cloudflare).');
            console.warn('  Worker endpoint van da duoc upload; co the dung GitHub Actions (.github/workflows/daily-backup.yml) de goi backup 02:00 sang hang ngay!');
        }
    }

    if (hasFlag('--secrets')) {
        const jwtSecret = crypto.randomBytes(32).toString('hex');
        const backupSecret = crypto.randomBytes(24).toString('hex');
        const tmpDir = path.resolve('.audit_tmp');
        fs.mkdirSync(tmpDir, { recursive: true });
        const pagesSecFile = path.join(tmpDir, `pages-sec-${Date.now()}.json`);
        const workerSecFile = path.join(tmpDir, `worker-sec-${Date.now()}.json`);
        try {
            fs.writeFileSync(pagesSecFile, JSON.stringify({ JWT_SECRET: jwtSecret, BACKUP_SECRET: backupSecret }), 'utf8');
            fs.writeFileSync(workerSecFile, JSON.stringify({ BACKUP_SECRET: backupSecret }), 'utf8');
            console.log('\n> Nap JWT_SECRET & BACKUP_SECRET len Pages Project (imgdim)...');
            execFileSync('npx', ['--no-install', 'wrangler', 'pages', 'secret', 'bulk', pagesSecFile, '--project-name', PAGES_PROJECT], {
                stdio: 'inherit', shell: true,
            });
            console.log('\n> Nap BACKUP_SECRET len Cron Worker...');
            execFileSync('npx', ['--no-install', 'wrangler', 'secret', 'bulk', workerSecFile], {
                cwd: path.resolve('workers/backup-cron'), stdio: 'inherit', shell: true,
            });
        } finally {
            fs.rmSync(pagesSecFile, { force: true });
            fs.rmSync(workerSecFile, { force: true });
        }
    }

    if (hasFlag('--deploy-pages')) {
        if (!dbId) {
            console.error('Can D1 san sang truoc khi deploy Pages.');
            process.exit(1);
        }
        writePagesWranglerToml(dbId, bucketExists);
        console.log('\n> Build & Deploy Cloudflare Pages (imgdim)...');
        execFileSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
        execFileSync('npx', ['--no-install', 'wrangler', 'pages', 'deploy', 'dist', '--project-name', PAGES_PROJECT], {
            stdio: 'inherit', shell: true,
        });
    }
}

main().catch(err => {
    console.error(err?.message || err);
    process.exit(1);
});
