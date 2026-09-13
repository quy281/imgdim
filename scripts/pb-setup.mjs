#!/usr/bin/env node
/**
 * PocketBase schema setup cho MKG Khao Sat.
 *
 * App va CLI dung CHUNG logic provisionBackend() trong src/lib/pb.js. Nho vay
 * chay script hay bam "Dung ngay" trong app deu tao cung bang, cung API rule,
 * cung chinh sach fail-closed cho backend chua du schema.
 *
 *   PB_EMAIL=founder@mkg.vn PB_PASSWORD='***' node scripts/pb-setup.mjs --dry-run
 *   PB_EMAIL=founder@mkg.vn PB_PASSWORD='***' node scripts/pb-setup.mjs
 *
 * Tuy chon:
 *   PB_URL=https://db.mkg.vn  mac dinh la https://db.mkg.vn
 *   --add-users "email1:Ten A,email2:Ten B"
 *   --password "2580"        PIN 4-8 so hoac mat khau that >= 8 ky tu
 *   --team <slug>            team dich cho --add-users, mac dinh "mkg"
 */

const URL_BASE = (process.env.PB_URL || 'https://db.mkg.vn').replace(/\/+$/, '');
const EMAIL = process.env.PB_EMAIL;
const PASSWORD = process.env.PB_PASSWORD;
const DRY = process.argv.includes('--dry-run');
const argValue = (flag) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};
const ADD_USERS = argValue('--add-users');
const ADD_USERS_PASSWORD = argValue('--password');
const ADD_USERS_TEAM_SLUG = argValue('--team') || 'mkg';

const log = (...a) => console.log(...a);
const step = (s) => log(`\n> ${s}`);

if (!EMAIL || !PASSWORD) {
    console.error(`
Thieu credential superuser.

  PB_EMAIL=<email superuser> PB_PASSWORD=<mat khau> node scripts/pb-setup.mjs --dry-run

Chay --dry-run truoc de xem trang thai, roi chay lai khong co co de ap that.
`);
    process.exit(1);
}

// src/lib/pb.js la module browser, nen CLI can shim localStorage truoc khi import.
const storage = new Map();
globalThis.__MKG_PB_URL__ = URL_BASE;
globalThis.localStorage = {
    getItem: (k) => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
    key: (i) => [...storage.keys()][i] || null,
    get length() { return storage.size; },
};

const details = (state) => {
    const missing = [];
    if (!state.surveyExists) missing.push('survey_items');
    if (!state.teams) missing.push('teams');
    if (!state.shares) missing.push('shares');
    if (!state.deletions) missing.push('deletions');
    if (!state.customerProfilesReady) missing.push('customer_profiles');
    if (!state.customerSubmissionsReady) missing.push('customer_submissions');
    if (!state.customerRole) missing.push('users.role=customer');
    if (state.missingFields?.length) missing.push(`survey_items fields: ${state.missingFields.join(', ')}`);
    if (state.missingIndexes?.length) missing.push(`indexes: ${state.missingIndexes.join(', ')}`);
    if (!state.rulesOk) missing.push('survey_items API rules');
    if (!state.auxiliaryRulesOk) missing.push('shares/deletions API rules');
    return missing;
};

async function main() {
    step(`Server: ${URL_BASE}`);
    const pb = await import('../src/lib/pb.js');

    step('Dang nhap superuser');
    await pb.login(EMAIL, PASSWORD);
    if (!pb.isSuperuser()) {
        throw new Error('Tai khoan da dang nhap khong phai superuser PocketBase.');
    }
    log(`  ok - ${pb.me()?.email || EMAIL}`);

    if (DRY) {
        step('Kiem tra schema hien tai');
        const state = await pb.inspectBackend();
        const missing = details(state);
        if (!missing.length) {
            log('  schema da san sang.');
        } else {
            for (const item of missing) log(`  thieu: ${item}`);
        }
        if (ADD_USERS) log('  [dry-run] khong tao user nao.');
        log(`\n${state.ready ? 'OK' : 'CAN AP'} - bo --dry-run de provision that.`);
        return;
    }

    step('Provision schema');
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = join('scripts', `.pb-backup-${stamp}.json`);
    const result = await pb.provisionBackend(
        (msg) => log(`  ${msg}`),
        (json) => {
            writeFileSync(backupFile, json, 'utf8');
            log(`  Da backup schema -> ${backupFile}`);
        },
    );
    if (result.warnings?.length) {
        step('Can xem lai');
        for (const w of result.warnings) log(`  ${w}`);
    }

    if (ADD_USERS) {
        step(`Tao user hang loat -> team "${ADD_USERS_TEAM_SLUG}"`);
        const teams = await pb.listTeams();
        const team = teams.find(t => t.slug === ADD_USERS_TEAM_SLUG);
        if (!team) throw new Error(`Khong tim thay team slug="${ADD_USERS_TEAM_SLUG}".`);

        const entries = ADD_USERS.split(',').map(s => s.trim()).filter(Boolean).map(s => {
            const [email, ...rest] = s.split(':');
            return { email: email.trim(), name: rest.join(':').trim() };
        });
        const made = [];
        for (const entry of entries) {
            if (!entry.email.includes('@')) {
                log(`  bo qua "${entry.email}" - email khong hop le`);
                continue;
            }
            const res = await pb.addTeamMember(team.id, entry.email, {
                name: entry.name,
                password: ADD_USERS_PASSWORD || '',
            });
            made.push(res);
            log(`  ${entry.email} - ${res.created ? 'da tao' : 'da co, da gan team'}`);
        }
        if (made.length) {
            log('\n  LUU LAI NGAY - mat khau/PIN chi hien mot lan:');
            for (const r of made) log(`    ${r.email.padEnd(28)} ${r.password || '(tai khoan co san - khong doi mat khau)'}`);
        }
    }

    step('Xong');
    const finalState = await pb.inspectBackend();
    log(finalState.ready
        ? '  Backend da san sang cho nhan vien va cong khach hang.'
        : `  Backend van con thieu: ${details(finalState).join('; ')}`);
}

main().catch(err => {
    console.error(`\nX ${err.message}`);
    if (err.body) console.error(JSON.stringify(err.body, null, 2));
    process.exit(1);
});
