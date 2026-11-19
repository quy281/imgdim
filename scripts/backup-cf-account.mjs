#!/usr/bin/env node
/**
 * Backup toan bo tai khoan Cloudflare (tat ca D1 Databases, KV Namespaces, R2 Buckets & cau hinh Pages/Workers).
 *
 * Cach dung:
 *   node scripts/backup-cf-account.mjs
 *   node scripts/backup-cf-account.mjs --out D:\khaosat-cf-backups --keep 14
 *   node scripts/backup-cf-account.mjs --skip-r2
 *   node scripts/backup-cf-account.mjs --install-schedule   (tao tac vu Windows chay tu dong 03:00 sang hang ngay)
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const argVal = (f, def = '') => {
    const i = args.indexOf(f);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const BASE_OUT = path.resolve(argVal('--out', 'D:\\khaosat-cf-backups'));
const KEEP_RUNS = Math.max(1, Number(argVal('--keep', '10')) || 10);
const SKIP_R2 = hasFlag('--skip-r2');
const SKIP_KV = hasFlag('--skip-kv');
const SKIP_D1 = hasFlag('--skip-d1');
const MAX_BUFFER = 128 * 1024 * 1024;

function runWranglerSync(wArgs, opts = {}) {
    return execFileSync('npx', ['--no-install', 'wrangler', ...wArgs], {
        shell: true,
        maxBuffer: MAX_BUFFER,
        encoding: opts.buffer ? undefined : 'utf8',
        ...opts,
    });
}

async function runWranglerAsync(wArgs, opts = {}) {
    return execFileAsync('npx', ['--no-install', 'wrangler', ...wArgs], {
        shell: true,
        maxBuffer: MAX_BUFFER,
        encoding: opts.buffer ? 'buffer' : 'utf8',
        ...opts,
    });
}

function safeName(s) {
    return String(s || 'item').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function stampNow() {
    const vn = new Date(Date.now() + 7 * 3600_000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}_${pad(vn.getUTCHours())}${pad(vn.getUTCMinutes())}${pad(vn.getUTCSeconds())}`;
}

function stripAnsi(s) {
    return String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function installWindowsSchedule(outDir) {
    const repoDir = path.resolve('.');
    const cmd = `node "${path.join(repoDir, 'scripts', 'backup-cf-account.mjs')}" --out "${outDir}" --keep ${KEEP_RUNS}`;
    const taskName = 'MKG-Cloudflare-Account-Backup';
    execFileSync('schtasks', [
        '/Create', '/F',
        '/TN', taskName,
        '/SC', 'DAILY',
        '/ST', '03:00',
        '/TR', `cmd /c "cd /d ${repoDir} && ${cmd} >> "${path.join(outDir, 'backup.log')}" 2>&1"`,
    ], { stdio: 'inherit', shell: true });
    console.log(`\n> Da tao lich Windows Task Scheduler "${taskName}" chay luc 03:00 sang hang ngay.`);
}

function sqlLiteral(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'object') {
        if (v.type === 'Buffer' && Array.isArray(v.data)) {
            return `X'${Buffer.from(v.data).toString('hex')}'`;
        }
        return `'${JSON.stringify(v).replace(/\0/g, '').replace(/'/g, "''")}'`;
    }
    return `'${String(v).replace(/\0/g, '').replace(/'/g, "''")}'`;
}

function quoteCmdArg(s) {
    if (process.platform !== 'win32') return s;
    return `"${String(s).replace(/"/g, '\\"')}"`;
}

function d1QueryJson(dbName, sql) {
    const out = runWranglerSync(['d1', 'execute', dbName, '--remote', '--json', '--command', quoteCmdArg(sql)]);
    const clean = stripAnsi(out);
    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');
    if (start < 0 || end <= start) {
        throw new Error(`Khong doc duoc JSON tu D1: ${clean.slice(0, 120)}`);
    }
    const parsed = JSON.parse(clean.slice(start, end + 1));
    return parsed?.[0]?.results || [];
}

function exportD1FallbackPaginated(dbName, sqlFile) {
    const workDir = path.dirname(sqlFile);
    console.log(`  ! Chuyen sang che do export tung bang phan trang cho "${dbName}"...`);
    runWranglerSync(['d1', 'export', dbName, '--remote', '--no-data', '--output', sqlFile]);
    const schemaHeader = fs.readFileSync(sqlFile, 'utf8');
    const outStream = fs.createWriteStream(sqlFile, { encoding: 'utf8' });
    outStream.write('PRAGMA defer_foreign_keys = ON;\n');
    outStream.write(schemaHeader.trimEnd() + '\n\n');

    const tbls = d1QueryJson(
        dbName,
        `SELECT name FROM sqlite_master WHERE type='table' AND SUBSTR(name, 1, 7) != 'sqlite_' AND SUBSTR(name, 1, 4) != '_cf_' ORDER BY name`,
        workDir,
    ).map(r => r.name);

    let totalRows = 0;
    for (const tbl of tbls) {
        const btTbl = '`' + tbl.replace(/`/g, '``') + '`';
        const safeTbl = tbl.replace(/"/g, '""');
        const cntRow = d1QueryJson(dbName, `SELECT COUNT(*) AS c FROM ${btTbl}`, workDir)[0];
        const count = Number(cntRow?.c || 0);
        if (!count) continue;

        const colsInfo = d1QueryJson(dbName, `PRAGMA table_info(${btTbl})`, workDir);
        const colNames = colsInfo.map(c => c.name);
        const colsBtSql = colNames.map(c => '`' + c.replace(/`/g, '``') + '`').join(', ');
        const colsSql = colNames.map(c => `"${c.replace(/"/g, '""')}"`).join(', ');

        let offset = 0;
        let pageSize = 250;
        while (offset < count) {
            let batch;
            try {
                batch = d1QueryJson(
                    dbName,
                    `SELECT ${colsBtSql} FROM ${btTbl} LIMIT ${pageSize} OFFSET ${offset}`,
                    workDir,
                );
            } catch (err) {
                if (pageSize > 1) {
                    pageSize = Math.max(1, Math.floor(pageSize / 4));
                    continue;
                }
                throw err;
            }
            if (!batch.length) break;
            for (const row of batch) {
                const vals = colNames.map(c => sqlLiteral(row[c])).join(', ');
                outStream.write(`INSERT OR REPLACE INTO "${safeTbl}" (${colsSql}) VALUES (${vals});\n`);
                totalRows++;
            }
            offset += batch.length;
        }
        console.log(`    - ${tbl}: ${count} dong`);
    }
    return new Promise((resolve, reject) => {
        outStream.on('error', reject);
        outStream.end(() => resolve(totalRows));
    });
}

async function exportAllD1(backupDir) {
    const raw = runWranglerSync(['d1', 'list', '--json']);
    const dbs = JSON.parse(raw);
    const d1Dir = path.join(backupDir, 'd1');
    fs.mkdirSync(d1Dir, { recursive: true });
    const exported = [];

    for (const db of dbs) {
        const sqlFile = path.join(d1Dir, `${safeName(db.name)}.sql`);
        console.log(`> Export D1 "${db.name}" (${db.uuid})...`);
        let method = 'd1-export';
        try {
            runWranglerSync(['d1', 'export', db.name, '--remote', '--output', sqlFile]);
        } catch {
            await exportD1FallbackPaginated(db.name, sqlFile);
            method = 'paginated-table-export';
        }
        const size = fs.statSync(sqlFile).size;
        const gzFile = `${sqlFile}.gz`;
        fs.writeFileSync(gzFile, zlib.gzipSync(fs.readFileSync(sqlFile)));
        exported.push({
            name: db.name,
            uuid: db.uuid,
            method,
            sqlFile: path.relative(backupDir, sqlFile).replace(/\\/g, '/'),
            gzFile: path.relative(backupDir, gzFile).replace(/\\/g, '/'),
            bytes: size,
            gzBytes: fs.statSync(gzFile).size,
        });
        console.log(`  OK [${method}] (${(size / 1024).toFixed(1)} KB SQL -> ${(fs.statSync(gzFile).size / 1024).toFixed(1)} KB .gz)`);
    }
    return { dbs, exported };
}

async function exportAllKV(backupDir) {
    const raw = runWranglerSync(['kv', 'namespace', 'list']);
    const namespaces = JSON.parse(raw);
    const kvDir = path.join(backupDir, 'kv');
    fs.mkdirSync(kvDir, { recursive: true });
    const summary = [];

    for (const ns of namespaces) {
        const keysRaw = runWranglerSync(['kv', 'key', 'list', '--namespace-id', ns.id, '--remote']);
        const keys = JSON.parse(keysRaw);
        const fileBase = `${safeName(ns.title)}__${ns.id}`;
        const outFile = path.join(kvDir, `${fileBase}.bulk.json`);

        if (!keys.length) {
            fs.writeFileSync(outFile, '[]', 'utf8');
            summary.push({ id: ns.id, title: ns.title, count: 0, file: path.relative(backupDir, outFile).replace(/\\/g, '/') });
            console.log(`> KV "${ns.title}" (${ns.id}): 0 key`);
            continue;
        }

        console.log(`> Export KV "${ns.title}" (${ns.id}): ${keys.length} keys...`);
        const entries = new Array(keys.length);
        let usedBulkText = false;

        // Thu bulk get truoc (nhanh gap 20 lan cho namespace thuan text)
        try {
            const keyNames = keys.map(k => k.name);
            const mapValues = {};
            const tmpKeys = path.join(kvDir, `_tmp_keys_${ns.id}.json`);
            for (let i = 0; i < keyNames.length; i += 80) {
                const slice = keyNames.slice(i, i + 80);
                fs.writeFileSync(tmpKeys, JSON.stringify(slice), 'utf8');
                try {
                    const bulkOut = runWranglerSync(['kv', 'bulk', 'get', tmpKeys, '--namespace-id', ns.id, '--remote']);
                    Object.assign(mapValues, JSON.parse(bulkOut));
                } finally {
                    fs.rmSync(tmpKeys, { force: true });
                }
            }
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const item = { key: k.name, value: mapValues[k.name] ?? '' };
                if (k.expiration) item.expiration = k.expiration;
                if (k.metadata !== undefined) item.metadata = k.metadata;
                entries[i] = item;
            }
            usedBulkText = true;
        } catch {
            // Co gia tri nhi phan (vd file .glb trong AR_KV) -> doc Buffer tung key an toan
            let idx = 0;
            const worker = async () => {
                for (;;) {
                    const cur = idx++;
                    if (cur >= keys.length) return;
                    const k = keys[cur];
                    const { stdout } = await runWranglerAsync(
                        ['kv', 'key', 'get', k.name, '--namespace-id', ns.id, '--remote'],
                        { buffer: true },
                    );
                    const buf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
                    const item = { key: k.name, value: buf.toString('base64'), base64: true };
                    if (k.expiration) item.expiration = k.expiration;
                    if (k.metadata !== undefined) item.metadata = k.metadata;
                    entries[cur] = item;
                }
            };
            await Promise.all(Array.from({ length: Math.min(6, keys.length) }, worker));
        }

        fs.writeFileSync(outFile, JSON.stringify(entries), 'utf8');
        summary.push({
            id: ns.id,
            title: ns.title,
            count: entries.length,
            mode: usedBulkText ? 'text-bulk' : 'binary-base64',
            file: path.relative(backupDir, outFile).replace(/\\/g, '/'),
            bytes: fs.statSync(outFile).size,
        });
        console.log(`  OK (${entries.length} keys, mode=${usedBulkText ? 'text-bulk' : 'binary-base64'})`);
    }
    return { namespaces, summary };
}

function extractR2KeysFromSqlFiles(backupDir, d1Exported) {
    const keys = new Set();
    for (const item of d1Exported) {
        const sqlPath = path.join(backupDir, item.sqlFile);
        if (!fs.existsSync(sqlPath)) continue;
        const sqlText = fs.readFileSync(sqlPath, 'utf8');
        const db = new DatabaseSync(':memory:');
        try {
            db.exec(sqlText);
        } catch {
            // Bo qua statement dac thu D1 neu co
            for (const stmt of sqlText.split(/;\r?\n/)) {
                if (!stmt.trim() || /^PRAGMA\b/i.test(stmt.trim())) continue;
                try { db.exec(stmt + ';'); } catch { /* ignore */ }
            }
        }
        const tbls = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
        if (tbls.has('r2_ledger')) {
            for (const r of db.prepare('SELECT r2_key FROM r2_ledger').all()) {
                if (r.r2_key) keys.add(String(r.r2_key));
            }
        }
        if (tbls.has('survey_items')) {
            for (const r of db.prepare('SELECT photo_r2_key, data_r2_key FROM survey_items').all()) {
                if (r.photo_r2_key && !String(r.photo_r2_key).startsWith('d1:')) keys.add(String(r.photo_r2_key));
                if (r.data_r2_key && !String(r.data_r2_key).startsWith('d1:')) keys.add(String(r.data_r2_key));
            }
        }
        for (const [tbl, col] of [['shares', 'payload_r2_key'], ['customer_submissions', 'payload_r2_key'], ['furniture_catalog', 'payload_r2_key']]) {
            if (tbls.has(tbl)) {
                for (const r of db.prepare(`SELECT ${col} as k FROM "${tbl}"`).all()) {
                    if (r.k && !String(r.k).startsWith('d1:')) keys.add(String(r.k));
                }
            }
        }
        db.close();
    }
    return [...keys];
}

async function exportR2Buckets(backupDir, d1Exported) {
    let bucketOut = '';
    try {
        bucketOut = runWranglerSync(['r2', 'bucket', 'list']);
    } catch {
        return { buckets: [], objects: [] };
    }
    const buckets = [];
    for (const line of stripAnsi(bucketOut).split(/\r?\n/)) {
        const m = line.match(/^name:\s+(.+)$/i);
        if (m) buckets.push(m[1].trim());
    }
    if (!buckets.length) return { buckets: [], objects: [] };

    const r2Dir = path.join(backupDir, 'r2');
    fs.mkdirSync(r2Dir, { recursive: true });
    const knownKeys = extractR2KeysFromSqlFiles(backupDir, d1Exported);
    const objects = [];

    // Hien map tat ca key R2 duoc chi danh vao bucket mkg-khaosat-media (hoac bucket duy nhat)
    const primaryBucket = buckets.includes('mkg-khaosat-media') ? 'mkg-khaosat-media' : buckets[0];
    if (knownKeys.length) {
        console.log(`> Export ${knownKeys.length} file R2 tu "${primaryBucket}"...`);
        let idx = 0;
        let done = 0;
        const worker = async () => {
            for (;;) {
                const cur = idx++;
                if (cur >= knownKeys.length) return;
                const key = knownKeys[cur];
                const dest = path.join(r2Dir, primaryBucket, key);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                try {
                    await runWranglerAsync(['r2', 'object', 'get', `${primaryBucket}/${key}`, '--file', dest, '--remote']);
                    objects.push({ bucket: primaryBucket, key, file: path.relative(backupDir, dest).replace(/\\/g, '/'), bytes: fs.statSync(dest).size });
                } catch (err) {
                    console.warn(`  ! Bo qua R2 ${key}: ${err.message.split('\n')[0]}`);
                } finally {
                    done++;
                    if (done % 20 === 0 || done === knownKeys.length) console.log(`  R2 downloaded ${done}/${knownKeys.length}`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(5, knownKeys.length) }, worker));
    }
    return { buckets, objects };
}

function captureInventory(backupDir) {
    const invDir = path.join(backupDir, 'inventory');
    fs.mkdirSync(invDir, { recursive: true });
    let pagesText = '';
    try {
        pagesText = stripAnsi(runWranglerSync(['pages', 'project', 'list']));
        fs.writeFileSync(path.join(invDir, 'pages-projects.txt'), pagesText, 'utf8');
    } catch { /* ignore */ }
    let whoamiText = '';
    try {
        whoamiText = stripAnsi(runWranglerSync(['whoami']));
        fs.writeFileSync(path.join(invDir, 'account-whoami.txt'), whoamiText, 'utf8');
    } catch { /* ignore */ }

    const secretsGuide = `# Danh sach cac bien bi mat (Secrets) Cloudflare KHONG cho phep tai nguoc tu API.
# Hay tu dien/giu ban sao trong trinh quan ly mat khau ca nhan (Bitwarden/1Password) de restore nhanh:
- Pages "imgdim": JWT_SECRET, BACKUP_SECRET, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN
- Worker "mkg-khaosat-backup-cron": BACKUP_SECRET, GDRIVE_CLIENT_ID, GDRIVE_CLIENT_SECRET, GDRIVE_REFRESH_TOKEN
- Cac Worker/Pages khac neu co API key, DB password, Telegram/Zalo bot token...
`;
    fs.writeFileSync(path.join(invDir, 'SECRETS-CHECKLIST.txt'), secretsGuide, 'utf8');
    return { pagesCaptured: !!pagesText };
}

function pruneOldBackupDirs(baseDir, keepCount) {
    if (!fs.existsSync(baseDir)) return 0;
    const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith('cf-backup-'))
        .map(d => d.name)
        .sort()
        .reverse();
    let removed = 0;
    for (const d of dirs.slice(keepCount)) {
        fs.rmSync(path.join(baseDir, d), { recursive: true, force: true });
        removed++;
    }
    return removed;
}

async function main() {
    if (hasFlag('--install-schedule')) {
        fs.mkdirSync(BASE_OUT, { recursive: true });
        installWindowsSchedule(BASE_OUT);
        return;
    }

    const backupDir = path.join(BASE_OUT, `cf-backup-${stampNow()}`);
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`=== BAT DAU BACKUP TOAN BO TAI KHOAN CLOUDFLARE ===`);
    console.log(`Thu muc dich: ${backupDir}\n`);

    const d1Result = SKIP_D1 ? { dbs: [], exported: [] } : await exportAllD1(backupDir);
    const kvResult = SKIP_KV ? { namespaces: [], summary: [] } : await exportAllKV(backupDir);
    const r2Result = SKIP_R2 ? { buckets: [], objects: [] } : await exportR2Buckets(backupDir, d1Result.exported);
    const invResult = captureInventory(backupDir);

    const manifest = {
        format: 'mkg-cloudflare-account-backup-v1',
        createdAt: new Date().toISOString(),
        d1: d1Result.exported,
        kv: kvResult.summary,
        r2: { buckets: r2Result.buckets, objectCount: r2Result.objects.length, objects: r2Result.objects },
        inventory: invResult,
    };
    fs.writeFileSync(path.join(backupDir, 'account-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const guide = `HUONG DAN KHOI PHUC (RESTORE) GOI BACKUP NAY:
Chay thu (an toan, khong sua cloud):
  node scripts/restore-cf-account.mjs --backup-dir "${backupDir}"

Chay khoi phuc that len Cloudflare:
  node scripts/restore-cf-account.mjs --backup-dir "${backupDir}" --execute
`;
    fs.writeFileSync(path.join(backupDir, 'RESTORE-GUIDE.txt'), guide, 'utf8');

    const pruned = pruneOldBackupDirs(BASE_OUT, KEEP_RUNS);
    console.log('\n=== HOAN TAT BACKUP TOAN TAI KHOAN ===');
    console.log(`- D1 DBs: ${d1Result.exported.length}`);
    console.log(`- KV Namespaces: ${kvResult.summary.length} (tong ${kvResult.summary.reduce((s, x) => s + x.count, 0)} keys)`);
    console.log(`- R2 Files: ${r2Result.objects.length}`);
    if (pruned > 0) console.log(`- Da don ${pruned} ban backup cu (giu ${KEEP_RUNS} ban gan nhat).`);
    console.log(`- Huong dan restore: ${path.join(backupDir, 'RESTORE-GUIDE.txt')}`);
}

main().catch(err => {
    console.error('\nLOI BACKUP:', err?.message || err);
    process.exit(1);
});
