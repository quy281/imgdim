#!/usr/bin/env node
/**
 * Helper lay Google Drive OAuth2 Refresh Token (dung My Drive ca nhan, tranh loi 403 storageQuotaExceeded).
 *
 * Cach dung:
 *   GDRIVE_CLIENT_ID=... GDRIVE_CLIENT_SECRET=... node scripts/gdrive-auth.mjs [--push-cf]
 */

import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import readline from 'node:readline/promises';
import path from 'node:path';

const PUSH_CF = process.argv.includes('--push-cf');
const PAGES_PROJECT = 'imgdim';
const WORKER_DIR = path.resolve('workers/backup-cron');

function openBrowser(url) {
    try {
        if (process.platform === 'win32') {
            spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
            spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
        } else {
            spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
        }
    } catch { /* fallback in URL ra console */ }
}

function putSecret(targetArgs, name, val) {
    execFileSync('npx', ['--no-install', 'wrangler', ...targetArgs, name], {
        input: String(val),
        stdio: ['pipe', 'inherit', 'inherit'],
        shell: true,
    });
}

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const clientId = process.env.GDRIVE_CLIENT_ID || (await rl.question('Nhap Google OAuth Client ID: ')).trim();
    const clientSecret = process.env.GDRIVE_CLIENT_SECRET || (await rl.question('Nhap Google OAuth Client Secret: ')).trim();
    rl.close();

    if (!clientId || !clientSecret) {
        throw new Error('Thieu GDRIVE_CLIENT_ID hoac GDRIVE_CLIENT_SECRET (tao OAuth Desktop app trong Google Cloud Console).');
    }

    const codePromise = new Promise((resolve, reject) => {
        const srv = http.createServer((req, res) => {
            const u = new URL(req.url, 'http://127.0.0.1');
            const err = u.searchParams.get('error');
            const code = u.searchParams.get('code');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            if (err) {
                res.end(`<h3>That bai: ${err}</h3>`);
                srv.close();
                reject(new Error(err));
                return;
            }
            if (code) {
                res.end('<h3>Da cap quyen Google Drive Backup! Quay lai terminal de xem ket qua.</h3>');
                srv.close();
                resolve({ code, redirectUri: `http://127.0.0.1:${srv.address().port}/callback` });
                return;
            }
            res.end('Waiting for callback...');
        });
        srv.listen(0, '127.0.0.1', () => {
            const port = srv.address().port;
            const redirectUri = `http://127.0.0.1:${port}/callback`;
            const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            authUrl.searchParams.set('client_id', clientId);
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/drive.file');
            authUrl.searchParams.set('access_type', 'offline');
            authUrl.searchParams.set('prompt', 'consent');
            console.log('\nMo trinh duyet de dang nhap Google Drive:');
            console.log(authUrl.toString(), '\n');
            openBrowser(authUrl.toString());
        });
    });

    const { code, redirectUri } = await codePromise;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }).toString(),
    });
    const tokJson = await tokenRes.json();
    if (!tokenRes.ok || !tokJson.refresh_token) {
        throw new Error(`Doi refresh_token that bai: ${JSON.stringify(tokJson)}`);
    }

    console.log('\n=== THANH CONG! Luu lai 3 gia tri nay ===');
    console.log('GDRIVE_CLIENT_ID=', clientId);
    console.log('GDRIVE_CLIENT_SECRET=', clientSecret);
    console.log('GDRIVE_REFRESH_TOKEN=', tokJson.refresh_token);

    if (PUSH_CF) {
        console.log('\n> Dang nap secrets len Cloudflare Pages (imgdim) & Backup Worker...');
        for (const [k, v] of [
            ['GDRIVE_CLIENT_ID', clientId],
            ['GDRIVE_CLIENT_SECRET', clientSecret],
            ['GDRIVE_REFRESH_TOKEN', tokJson.refresh_token],
        ]) {
            putSecret(['pages', 'secret', 'put', '--project-name', PAGES_PROJECT], k, v);
            execFileSync('npx', ['--no-install', 'wrangler', 'secret', 'put', k], {
                cwd: WORKER_DIR,
                input: String(v),
                stdio: ['pipe', 'inherit', 'inherit'],
                shell: true,
            });
        }
        console.log('> Xong! Backup Cron se tu dong day D1 + R2 sang Google Drive moi dem.');
    }
}

main().catch(err => {
    console.error('\nLOI:', err?.message || err);
    process.exit(1);
});
