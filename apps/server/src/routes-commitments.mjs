// Routes of the commitment tracker (commitments.mjs): the open suggestions, "accept" (task for an own
// promise, reminder for someone else's) and "dismiss". The background scan is a job of the app.
import { internalApi } from './internal-api.mjs';
import { messageForAi } from './ai-payloads.mjs';
import { scanCommitments } from './commitments.mjs';
import { validateWhen } from './followups.mjs';

const ACTION = 'ai-v1';
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

export function registerCommitmentRoutes(ctx) {
  const { api, ai, requireAction } = ctx;
  const store = ctx.commitments;
  if (!store) return;
  const send = (reply, err) => {
    const status = err.statusCode && err.statusCode < 600 ? err.statusCode : 500;
    return reply.code(status).send({
      error: status < 500 ? err.message : 'Speichern fehlgeschlagen.',
      code: err.code || 'commitments_failed'
    });
  };

  const deps = () => ({
    ai,
    store,
    accounts: ctx.accounts(),
    ownAddresses: ctx.ownAddresses(),
    listFolder: (accountId, folder, limit) => internalApi(ctx).messages(accountId, { folder, limit }),
    // The local index has the text already; the server is asked only when it is off.
    readText: async (accountId, folder, uid) => {
      const indexed = await ctx.localIndex?.text?.(accountId, folder, uid).catch(() => null);
      if (indexed?.text) return indexed;
      return messageForAi(await internalApi(ctx).message(accountId, folder, uid));
    }
  });
  let running = null;
  const scan = () => {
    running ||= scanCommitments(deps()).finally(() => {
      running = null;
    });
    return running;
  };
  ctx.scanCommitments = scan;
  ctx.jobs?.register('commitments', scan, { every: 15 * 60_000, firstDelay: 2 * 60_000 });
  ctx.aiForgetHooks?.push(() => store.clear());

  const state = () => {
    const s = ai.get();
    return { enabled: Boolean(s.enabled && s.features?.commitments === true), local: s.provider === 'ollama' };
  };

  api.get('/api/commitments', async (request, reply) => {
    try {
      await store.remember({ lang: request.query?.lang, timeZone: request.query?.tz });
      const labels = new Map(ctx.accounts().map(a => [a.id, a.label || '']));
      return {
        ...state(),
        items: store.open().map(i => ({ ...i, accountLabel: labels.get(i.accountId) || '' }))
      };
    } catch (err) {
      return send(reply, err);
    }
  });

  const post = (path, handler) =>
    api.post(path, { bodyLimit: 4 * 1024 }, async (request, reply) => {
      if (!requireAction(request, reply, ACTION)) return;
      try {
        return await handler(request.body || {});
      } catch (err) {
        return send(reply, err);
      }
    });

  post('/api/commitments/scan', async () => {
    if (!state().enabled) throw fail('Der Versprechen-Tracker ist ausgeschaltet.', 'commitments_off', 409);
    if (!state().local) throw fail('Läuft nur mit einem lokalen Modell.', 'ai_cloud_auto', 409);
    return scan();
  });

  post('/api/commitments/dismiss', async b => {
    const item = store.find(String(b.id || ''));
    if (!item) throw fail('Vorschlag nicht gefunden.', 'commitments_missing', 404);
    await store.update(item.id, { state: 'dismissed', doneAt: new Date().toISOString() });
    void ai.log.add({ type: 'apply', kind: 'commitment', source: 'dismiss' });
    return { ok: true };
  });

  // "Übernehmen": the user clicked it. Own promise → task with a link to the mail; someone else's
  // promise → follow-up reminder on that mail (it clears itself when an answer arrives).
  post('/api/commitments/accept', async b => {
    const item = store.find(String(b.id || ''));
    if (!item || item.state !== 'open') throw fail('Vorschlag nicht gefunden.', 'commitments_missing', 404);
    const title = String(b.title ?? item.what)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, 300);
    if (!title) throw fail('Titel fehlt.', 'commitments_invalid');
    let created;
    if (item.direction === 'mine') {
      if (!ctx.tasks?.save) throw fail('Aufgaben sind noch nicht verfügbar.', 'task_locked', 423);
      const due = typeof b.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : item.due || null;
      const task = await ctx.tasks.save({
        title,
        due,
        notes: item.quote ? `„${item.quote}“` : '',
        mail: {
          accountId: item.accountId,
          folder: item.folder,
          uid: item.uid,
          messageId: item.messageId,
          subject: item.subject,
          from: item.who
        },
        source: 'ai'
      });
      created = { type: 'task', id: task.id };
    } else {
      const remindAt = validateWhen(b.remindAt);
      if (item.messageId) {
        const f = await ctx.followups.addFollowup({
          accountId: item.accountId,
          messageId: item.messageId,
          subject: item.subject,
          to: item.who ? [item.who] : [],
          due: remindAt,
          kind: 'promise',
          what: title
        });
        created = { type: 'followup', id: f.id };
      } else {
        // Without a Message-ID an answer cannot be recognized: a task with the same date instead.
        if (!ctx.tasks?.save) throw fail('Aufgaben sind noch nicht verfügbar.', 'task_locked', 423);
        const task = await ctx.tasks.save({
          title,
          due: remindAt,
          notes: item.quote ? `„${item.quote}“` : '',
          mail: {
            accountId: item.accountId,
            folder: item.folder,
            uid: item.uid,
            subject: item.subject,
            from: item.who
          },
          source: 'ai'
        });
        created = { type: 'task', id: task.id };
      }
    }
    await store.update(item.id, { state: 'accepted', doneAt: new Date().toISOString(), created });
    void ai.log.add({ type: 'apply', kind: 'commitment', source: item.direction });
    return { ok: true, created };
  });
}
