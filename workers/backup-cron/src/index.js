import { runCloudBackup, getBackupStatus } from '../../../cf-backend/backup.js';

export default {
    async scheduled(event, env, ctx) {
        const task = runCloudBackup(env, { triggerSource: 'cron' })
            .then(res => {
                console.log('[MKG Backup Cron]', JSON.stringify({
                    runId: res.runId,
                    status: res.status,
                    dbBytes: res.dbBytes,
                    mediaSynced: res.mediaSynced,
                    mediaSkipped: res.mediaSkipped,
                    mediaPending: res.mediaPending,
                    mediaFailed: res.mediaFailed,
                }));
            })
            .catch(err => {
                console.error('[MKG Backup Cron FAILED]', err?.stack || err?.message || err);
            });
        ctx.waitUntil(task);
    },

    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === '/health') {
            return Response.json({ ok: true, service: 'mkg-khaosat-backup-cron' });
        }

        const secret = env?.BACKUP_SECRET;
        const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
        if (!secret || auth !== secret) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (request.method === 'GET' && url.pathname === '/status') {
            return Response.json(await getBackupStatus(env));
        }

        if (request.method === 'POST' && url.pathname === '/run') {
            const body = await request.json().catch(() => ({}));
            const res = await runCloudBackup(env, {
                triggerSource: 'manual',
                mediaBatchLimit: body?.mediaBatchLimit,
                skipGdrive: !!body?.skipGdrive,
            });
            return Response.json(res);
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
    },
};
