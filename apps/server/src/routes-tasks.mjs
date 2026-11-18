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
  const withLabels = task => {
    if (!task?.mail) return task;
    const label = ctx.accounts().find(a => a.id === task.mail.accountId)?.label || null;
    return { ...task, mail: { ...task.mail, accountLabel: label } };
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
  // Reminders that are due now, each handed out once (desktop main process or browser window).
  post('/api/tasks/reminders/claim', async () => {
    const due = ctx.tasks.dueReminders();
    if (due.length) await ctx.tasks.markReminded(due.map(t => t.id));
    return { tasks: due.map(withLabels) };
  });
}
