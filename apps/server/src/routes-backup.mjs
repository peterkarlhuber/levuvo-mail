// Backup and restore routes (see backup.mjs for the format and what a backup contains).
import rateLimit from '@fastify/rate-limit';
import {
  MAX_BACKUP_BYTES,
  backupFilename,
  cancelRestore,
  collectBackupContent,
  decryptBackup,
  encryptBackup,
  pendingRestore,
  stageRestore
} from './backup.mjs';

const ACTION = 'backup-v1';
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

/** Display preferences of the web app (localStorage); small, no content. */
function cleanUiPrefs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = JSON.stringify(value);
  return text.length <= 8 * 1024 ? JSON.parse(text) : null;
}

export function registerBackupRoutes(ctx) {
  const { api, requireAction, errorResponse, backupState } = ctx;
  // While a restore waits for the restart, nothing may change the data it is about to replace.
  api.addHook('onRequest', async (request, reply) => {
    if (!backupState.pending || request.method === 'GET') return;
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/api/') || pathname.startsWith('/api/backup/')) return;
    return reply.code(409).send({
      error: 'Eine Wiederherstellung wartet auf den Neustart von Levuvo. Bis dahin sind keine Änderungen möglich.',
      code: 'backup_restart_pending'
    });
  });

  // Creating and restoring run scrypt and handle large files: a few attempts per minute are plenty
  // (and slow down guessing the password of a backup file).
  api.register(async app => {
    await app.register(rateLimit, {
      global: false,
      timeWindow: '1 minute',
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: 'Zu viele Versuche. Bitte eine Minute warten.',
        code: 'backup_rate_limited'
      })
    });
    const guard = (route, handler, { limit = 64 * 1024, max = 10 } = {}) =>
      app.post(route, { bodyLimit: limit, config: { rateLimit: { max } } }, async (request, reply) => {
        if (!requireAction(request, reply, ACTION)) return;
        try {
          return await handler(request, reply);
        } catch (err) {
          return errorResponse(reply, err);
        }
      });

    app.get('/api/backup/status', { config: { rateLimit: { max: 120 } } }, async () => {
      const pending = await pendingRestore(ctx.dataDir);
      backupState.pending = Boolean(pending);
      return {
        vaultAvailable: Boolean(ctx.store?.available),
        canRestart: typeof ctx.requestRestart === 'function',
        pending: pending ? { createdAt: pending.createdAt, stagedAt: pending.stagedAt } : null,
        restored: backupState.restored
      };
    });

    guard('/api/backup/create', async (request, reply) => {
      const password = request.body?.password;
      // Pending writes of the local stores first, so the file on disk is current.
      await Promise.all([ctx.localCalendar?.flush?.(), ctx.localContacts?.flush?.()].map(p => p?.catch?.(() => {})));
      const content = await collectBackupContent({
        dir: ctx.dataDir,
        accountsPath: ctx.accountsPath,
        vault: ctx.store
      });
      const uiPrefs = cleanUiPrefs(request.body?.uiPrefs);
      const file = await encryptBackup({ ...content, uiPrefs }, password, { app: ctx.version });
      ctx.logger('backup created');
      reply.headers({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${backupFilename()}"`
      });
      return file;
    });

    guard(
      '/api/backup/restore',
      async request => {
        const { file, password } = request.body || {};
        if (typeof file !== 'string' || !file) throw fail('Keine Sicherungsdatei ausgewählt.', 'backup_invalid');
        const backup = await decryptBackup(file, password, { ownApp: ctx.version });
        await stageRestore({ dir: ctx.dataDir, accountsPath: ctx.accountsPath, vault: ctx.store, backup });
        backupState.pending = true;
        ctx.logger(`restore staged (backup from ${backup.createdAt})`);
        return {
          ok: true,
          createdAt: backup.createdAt,
          app: backup.app,
          summary: backup.summary,
          uiPrefs: backup.uiPrefs,
          canRestart: typeof ctx.requestRestart === 'function'
        };
      },
      { limit: MAX_BACKUP_BYTES + 64 * 1024 }
    );

    guard('/api/backup/cancel', async () => {
      await cancelRestore(ctx.dataDir, ctx.store);
      backupState.pending = false;
      return { ok: true };
    });

    guard('/api/backup/restart', async () => {
      if (!(await pendingRestore(ctx.dataDir))) throw fail('Es wartet keine Wiederherstellung.', 'backup_none', 409);
      if (typeof ctx.requestRestart !== 'function')
        throw fail('Bitte Levuvo jetzt beenden und neu starten.', 'backup_manual_restart', 409);
      // Answer first; the app restarts right after.
      setTimeout(() => ctx.requestRestart(), 200).unref?.();
      return { restarting: true };
    });
  });
}
