// Tasks (see tasks.mjs). Account-free: a task outlives its mail account.
// Shared with the AI core: the same store is available as ctx.tasks.
import { VIEWS } from './tasks.mjs';

const zoneOf = value => {
  const tz = typeof value === 'string' ? value : '';
  try {
    if (tz && tz.length <= 64) {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return tz;
    }
  } catch {
    /* unknown zone: default below */
  }
  return 'Europe/Vienna';
};

export function registerTaskRoutes(ctx) {
  const { api, requireAction, errorResponse } = ctx;
  // Sync internals (etag, last agreed state) stay on the server; the UI sees the list only.
  const withLabels = task => {
    if (!task) return task;
    const { sync, ...rest } = task;
    const out = { ...rest, list: sync?.link || null };
    if (!task.mail) return out;
    const label = ctx.accounts().find(a => a.id === task.mail.accountId)?.label || null;
    return { ...out, mail: { ...task.mail, accountLabel: label } };
  };
  api.get('/api/tasks', async (request, reply) => {
    try {
      const view = VIEWS.includes(request.query?.view) ? request.query.view : 'all';
      const timeZone = zoneOf(request.query?.tz);
      return { tasks: ctx.tasks.list({ view, timeZone }).map(withLabels) };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  const post = (path, handler) =>
    api.post(path, { bodyLimit: 64 * 1024 }, async (request, reply) => {
      if (!requireAction(request, reply, 'mail-v1')) return;
      try {
        return await handler(request.body || {});
      } catch (err) {
        return errorResponse(reply, err);
      }
    });
  post('/api/tasks/save', async b => ({ task: withLabels(await ctx.tasks.save(b.task || {})) }));
  post('/api/tasks/done', async b => {
    const r = await ctx.tasks.setDone(String(b.id || ''), b.done === true);
    return { task: withLabels(r.task), finished: r.finished ? withLabels(r.finished) : null };
  });
  post('/api/tasks/delete', async b => {
    await ctx.tasks.remove(String(b.id || ''));
    return { ok: true };
  });
  // ---------------------------------------------------------------- sync with connected lists
  const syncOrFail = () => {
    if (!ctx.taskSync)
      throw Object.assign(
        new Error('Die Aufgaben brauchen den Schlüsselbund des Systems. Er ist gerade nicht verfügbar.'),
        {
          code: 'task_locked',
          statusCode: 423
        }
      );
    return ctx.taskSync;
  };
  /** Accounts that can hold task lists. */
  const syncAccounts = () => ctx.davStore.list().map(a => ({ id: a.id, label: a.label, provider: 'caldav' }));
  api.get('/api/tasks/sync', async (_request, reply) => {
    try {
      const sync = syncOrFail();
      return { links: sync.links(), busy: sync.busy(), accounts: syncAccounts() };
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  api.get('/api/tasks/sync/sources', async (_request, reply) => {
    try {
      return await syncOrFail().sources(syncAccounts());
    } catch (err) {
      return errorResponse(reply, err);
    }
  });
  post('/api/tasks/sync/link', async b => {
    const sync = syncOrFail();
    const account = syncAccounts().find(a => a.id === b.accountId && a.provider === b.provider);
    if (!account)
      throw Object.assign(new Error('Konto nicht gefunden.'), { code: 'task_sync_account_missing', statusCode: 404 });
    // Only lists the server itself offers can be connected.
    const { lists } = await sync.sources([account]);
    const list = lists.find(l => l.listId === b.listId);
    if (!list)
      throw Object.assign(new Error('Diese Liste gibt es auf dem Server nicht.'), {
        code: 'task_list_missing',
        statusCode: 404
      });
    const link = await sync.link(
      {
        provider: account.provider,
        accountId: account.id,
        accountLabel: account.label,
        listId: list.listId,
        name: list.name
      },
      { moveLocal: b.moveLocal === true }
    );
    const result = (await sync.run(link.id))[link.id];
    return { link: sync.links().find(l => l.id === link.id) || link, result };
  });
  post('/api/tasks/sync/unlink', async b => {
    await syncOrFail().unlink(String(b.id || ''));
    return { ok: true };
  });
  post('/api/tasks/sync/run', async b => {
    const sync = syncOrFail();
    const results = await sync.run(typeof b.id === 'string' && b.id ? b.id : null);
    return { results, links: sync.links() };
  });

  // Reminders that are due now, each handed out once (desktop main process or browser window).
  post('/api/tasks/reminders/claim', async () => {
    const due = ctx.tasks.dueReminders();
    if (due.length) await ctx.tasks.markReminded(due.map(t => t.id));
    return { tasks: due.map(withLabels) };
  });
}
