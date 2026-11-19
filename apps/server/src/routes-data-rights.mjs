// Data export, "delete all data on this device" (see data-rights.mjs) and the legal notices
// shown in Settings → About (licences of everything that ships, support period).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExport, cancelWipe, exportFilename, pendingWipe, stageWipe } from './data-rights.mjs';

const ACTION = 'privacy-v1';
const here = path.dirname(fileURLToPath(import.meta.url));
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

/** Licence files of the installed app; the AI runtime and Ollama exist only in packaged builds. */
export function noticeFiles(resourcesPath = process.resourcesPath) {
  const files = [
    { id: 'app', title: 'Levuvo Mail (npm)', file: path.resolve(here, '../../../THIRD-PARTY-NOTICES.txt') }
  ];
  if (resourcesPath) {
    files.push(
      {
        id: 'ai',
        title: 'AI runtime (Python)',
        file: path.join(resourcesPath, 'ai-runtime', 'THIRD-PARTY-PYTHON.txt')
      },
      { id: 'ollama', title: 'Ollama', file: path.join(resourcesPath, 'ollama', 'LICENSE-ollama.txt') }
    );
  }
  return files;
}

export function registerDataRightsRoutes(
  ctx,
  { wipeState, supportUntil = '', resourcesPath = process.resourcesPath } = {}
) {
  const { api, requireAction, errorResponse } = ctx;

  // While "delete all" waits for the restart, nothing may write data that is about to be removed.
  api.addHook('onRequest', async (request, reply) => {
    if (!wipeState.pending || request.method === 'GET') return;
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!pathname.startsWith('/api/') || pathname.startsWith('/api/privacy/delete-all')) return;
    return reply.code(409).send({
      error: 'Alle Daten werden beim Neustart gelöscht. Bis dahin sind keine Änderungen möglich.',
      code: 'wipe_restart_pending'
    });
  });

  api.get('/api/privacy/export', async (request, reply) => {
    try {
      const data = await buildExport({
        dir: ctx.dataDir,
        accountsPath: ctx.accountsPath,
        vault: ctx.store,
        app: ctx.version
      });
      reply
        .header('Content-Type', 'application/json; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${exportFilename()}"`)
        .header('Cache-Control', 'no-store');
      return `${JSON.stringify(data, null, 2)}\n`;
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  api.get('/api/privacy/delete-all', async () => ({
    pending: wipeState.pending,
    done: wipeState.done,
    canRestart: typeof ctx.requestRestart === 'function'
  }));

  api.post('/api/privacy/delete-all', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    try {
      if (request.body?.confirm !== 'delete-all') throw fail('Bestätigung fehlt.', 'wipe_confirm');
      await stageWipe(ctx.dataDir);
      wipeState.pending = true;
      const restarting = typeof ctx.requestRestart === 'function';
      // Answer first; the app restarts right after and removes everything before any store opens.
      if (restarting) setTimeout(() => ctx.requestRestart({ clearBrowserData: true }), 300).unref?.();
      return { pending: true, restarting };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });

  api.post('/api/privacy/delete-all/cancel', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, ACTION)) return;
    await cancelWipe(ctx.dataDir);
    wipeState.pending = Boolean(await pendingWipe(ctx.dataDir));
    return { pending: wipeState.pending };
  });

  // Settings → About: support period and the licence texts of everything that ships.
  api.get('/api/runtime/legal', async () => {
    const notices = [];
    for (const n of noticeFiles(resourcesPath)) {
      try {
        const text = await readFile(n.file, 'utf8');
        notices.push({ id: n.id, title: n.title, size: text.length });
      } catch {
        /* not part of this build (development, unpackaged) */
      }
    }
    return { version: ctx.version, supportUntil, notices };
  });
  api.get('/api/runtime/legal/:id', async (request, reply) => {
    const entry = noticeFiles(resourcesPath).find(n => n.id === request.params.id);
    if (!entry) return reply.code(404).send({ error: 'Unbekannt.' });
    try {
      const text = await readFile(entry.file, 'utf8');
      return reply.header('Content-Type', 'text/plain; charset=utf-8').header('Cache-Control', 'no-store').send(text);
    } catch {
      return reply.code(404).send({ error: 'Nicht Teil dieser Installation.' });
    }
  });
}
