#!/usr/bin/env node
/**
 * Khoi phuc (Restore) toan bo tai khoan Cloudflare tu goi backup tao boi scripts/backup-cf-account.mjs.
 * Ho tro restore ngay tren tai khoan cu HOAC chuyen sang 1 tai khoan Cloudflare moi hoan toan!
 *
 * Cach dung:
 *   node scripts/restore-cf-account.mjs --backup-dir D:\khaosat-cf-backups\cf-backup-...              # Dry-run an toan
 *   node scripts/restore-cf-account.mjs --backup-dir D:\khaosat-cf-backups\cf-backup-... --execute    # Nap len Cloudflare
 *   Tuy chon loc: --only-d1 furnitech-db,mkg-khaosat-db   --only-kv AR_KV   --skip-r2   --skip-kv   --skip-d1
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const argVal = (f, def = '') => {
    const i = args.indexOf(f);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

const BACKUP_DIR = path.resolve(argVal('--backup-dir', ''));
const EXECUTE = hasFlag('--execute');
const SKIP_D1 = hasFlag('--skip-d1');
const SKIP_KV = hasFlag('--skip-kv');
const SKIP_R2 = hasFlag('--skip-r2');
const ONLY_D1 = argVal('--only-d1') ? new Set(argVal('--only-d1').split(',').map(s => s.trim()).filter(Boolean)) : null;
const ONLY_KV = argVal('--only-kv') ? new Set(argVal('--only-kv').split(',').map(s => s.trim()).filter(Boolean)) : null;

function runWrangler(wArgs) {
    return execFileSync('npx', ['--no-install', 'wrangler', ...wArgs], {
        shell: true,
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
    });
}

async function runWranglerAsync(wArgs) {
    return execFileAsync('npx', ['--no-install', 'wrangler', ...wArgs], {
        shell: true,
        maxBuffer: 128 * 1024 * 1024,
    });
}

function guessContentType(key) {
    const k = String(key).toLowerCase();
    if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg';
    if (k.endsWith('.png')) return 'image/png';
    if (k.endsWith('.json') || k.endsWith('.json.gz')) return k.endsWith('.gz') ? 'application/gzip' : 'application/json; charset=utf-8';
    if (k.endsWith('.glb')) return 'model/gltf-binary';
    if (k.endsWith('.dae')) return 'model/vnd.collada+xml';
    return 'application/octet-stream';
}

function parseCreatedId(out) {
    const uuid = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuid) return uuid[0];
    const hex32 = out.match(/\b[0-9a-f]{32}\b/i);
    return hex32 ? hex32[0] : '';
}

async function restoreD1(manifest, mapping) {
    const existing = JSON.parse(runWrangler(['d1', 'list', '--json']));
    const byName = new Map(existing.map(d => [d.name, d.uuid]));

    for (const item of manifest.d1 || []) {
        if (ONLY_D1 && !ONLY_D1.has(item.name)) continue;
        let sqlPath = path.join(BACKUP_DIR, item.sqlFile);
        let tempSql = '';
        if (!fs.existsSync(sqlPath) && item.gzFile) {
            const gzPath = path.join(BACKUP_DIR, item.gzFile);
            if (fs.existsSync(gzPath)) {
                tempSql = path.join(BACKUP_DIR, `_tmp_restore_${item.name}.sql`);
                fs.writeFileSync(tempSql, zlib.gunzipSync(fs.readFileSync(gzPath)));
                sqlPath = tempSql;
            }
        }
        if (!fs.existsSync(sqlPath)) {
            console.warn(`! Khong tim thay file SQL cho D1 ${item.name}`);
            continue;
        }
        let targetId = byName.get(item.name) || '';
        if (!EXECUTE) {
            console.log(`  [DRY-RUN] D1 "${item.name}": se ${targetId ? `ghi de vao DB hien co (${targetId})` : 'tao DB moi & import SQL'} (${(item.bytes / 1024).toFixed(1)} KB)`);
            if (tempSql) fs.rmSync(tempSql, { force: true });
            continue;
        }
        try {
            if (!targetId) {
                console.log(`> Tao D1 moi "${item.name}"...`);
                const crOut = runWrangler(['d1', 'create', item.name]);
                targetId = parseCreatedId(crOut) || item.name;
            }
            mapping.d1[item.uuid] = { name: item.name, newId: targetId };
            console.log(`> Import SQL vao D1 "${item.name}"...`);
            execFileSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', item.name, '--remote', '--file', sqlPath, '--yes'], {
                stdio: 'inherit', shell: true,
            });
        } finally {
            if (tempSql) fs.rmSync(tempSql, { force: true });
        }
    }
}

async function restoreKV(manifest, mapping) {
    const existing = JSON.parse(runWrangler(['kv', 'namespace', 'list']));
    const byTitle = new Map(existing.map(n => [n.title, n.id]));
    const byId = new Map(existing.map(n => [n.id, n]));

    for (const ns of manifest.kv || []) {
        if (ONLY_KV && !ONLY_KV.has(ns.title)) continue;
        const bulkPath = path.join(BACKUP_DIR, ns.file);
        if (!fs.existsSync(bulkPath)) continue;
        const targetId = byId.has(ns.id) ? ns.id : (byTitle.get(ns.title) || '');

        if (!EXECUTE) {
            console.log(`  [DRY-RUN] KV "${ns.title}": ${ns.count} keys -> ${targetId ? `nap vao namespace ${targetId}` : 'tao namespace moi & bulk put'}`);
            continue;
        }

        let resolvedId = targetId;
        if (!resolvedId) {
            console.log(`> Tao KV namespace moi "${ns.title}"...`);
            const crOut = runWrangler(['kv', 'namespace', 'create', ns.title]);
            resolvedId = parseCreatedId(crOut);
            if (!resolvedId) {
                const recheck = JSON.parse(runWrangler(['kv', 'namespace', 'list']));
                resolvedId = recheck.find(x => x.title === ns.title)?.id || '';
            }
        }
        mapping.kv[ns.id] = { title: ns.title, newId: resolvedId };
        const entries = JSON.parse(fs.readFileSync(bulkPath, 'utf8'));
        if (!entries.length) {
            console.log(`> KV "${ns.title}": 0 keys (bo qua).`);
            continue;
        }
        console.log(`> Nap ${entries.length} keys vao KV "${ns.title}" (${resolvedId})...`);
        for (let i = 0; i < entries.length; i += 2000) {
            const chunk = entries.slice(i, i + 2000);
            const tmpChunk = path.join(BACKUP_DIR, `_tmp_kv_${resolvedId}_${i}.json`);
            fs.writeFileSync(tmpChunk, JSON.stringify(chunk), 'utf8');
            try {
                execFileSync('npx', ['--no-install', 'wrangler', 'kv', 'bulk', 'put', tmpChunk, '--namespace-id', resolvedId, '--remote'], {
                    stdio: 'inherit', shell: true,
                });
            } finally {
                fs.rmSync(tmpChunk, { force: true });
            }
        }
    }
}

async function restoreR2(manifest) {
    const objects = manifest.r2?.objects || [];
    if (!objects.length) return;
    const buckets = manifest.r2?.buckets || [...new Set(objects.map(o => o.bucket))];

    if (!EXECUTE) {
        console.log(`  [DRY-RUN] R2: se khoi phuc ${objects.length} file vao buckets [${buckets.join(', ')}]`);
        return;
    }

    const r2Out = runWrangler(['r2', 'bucket', 'list']);
    for (const b of buckets) {
        if (!r2Out.includes(b)) {
            console.log(`> Tao R2 bucket moi "${b}"...`);
            runWrangler(['r2', 'bucket', 'create', b]);
        }
    }

    console.log(`> Upload ${objects.length} file len R2...`);
    let idx = 0;
    let done = 0;
    const worker = async () => {
        for (;;) {
            const cur = idx++;
            if (cur >= objects.length) return;
            const o = objects[cur];
            const srcFile = path.join(BACKUP_DIR, o.file);
            if (!fs.existsSync(srcFile)) continue;
            await runWranglerAsync([
                'r2', 'object', 'put', `${o.bucket}/${o.key}`,
                '--file', srcFile,
                '--content-type', guessContentType(o.key),
                '--remote',
            ]);
            done++;
            if (done % 20 === 0 || done === objects.length) console.log(`  R2 restored ${done}/${objects.length}`);
        }
    };
    await Promise.all(Array.from({ length: Math.min(5, objects.length) }, worker));
}

async function main() {
    if (!BACKUP_DIR || !fs.existsSync(path.join(BACKUP_DIR, 'account-manifest.json'))) {
        console.error('Hay chi dinh --backup-dir tro den thu muc chua account-manifest.json');
        process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, 'account-manifest.json'), 'utf8'));
    console.log(`=== ${EXECUTE ? 'KHOI PHUC THAT LEN CLOUDFLARE' : 'KIEM TRA KHOI PHUC (DRY-RUN)'} ===`);
    console.log(`Goi backup tao luc: ${manifest.createdAt}\n`);

    const mapping = { d1: {}, kv: {} };
    if (!SKIP_D1) await restoreD1(manifest, mapping);
    if (!SKIP_KV) await restoreKV(manifest, mapping);
    if (!SKIP_R2) await restoreR2(manifest);

    if (EXECUTE) {
        const mapPath = path.join(BACKUP_DIR, 'restore-id-mapping.json');
        fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2), 'utf8');
        console.log(`\n=== HOAN TAT KHOI PHUC ===`);
        console.log(`- Bang anh xa ID moi (neu doi tai khoan CF): ${mapPath}`);
    } else {
        console.log('\nThem co `--execute` de chay khoi phuc that su.');
    }
}

main().catch(err => {
    console.error('\nLOI RESTORE:', err?.message || err);
    process.exit(1);
});
