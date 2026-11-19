// Sync of the task list with lists on a server: CalDAV (VTODO), and through providers added
// later, Microsoft To Do and Google Tasks. The list on this device stays the default; a list
// is only synced after the user connected it, and only the tasks in that list are sent.
//
// Only the task itself is sent (title, note, due date, reminder, priority, repetition, done).
// The link to a mail, the origin ("from the AI") and the reminder state stay on this device.
//
// Each synced task keeps `sync.base`, the state both sides agreed on at the last sync. A sync
// is a three-way merge per field: a field changed on one side only takes that change; a field
// changed on both sides takes the newer change (last-modified of the server copy against the
// local updatedAt) and counts as a conflict in the result. A deletion on one side and a change
// on the other keeps the changed task (no data is lost). What a provider cannot store
// (Google Tasks: no reminder, no repetition, no time of day) is never overwritten from there.
//
// Adapters (task-sync-caldav.mjs …) offer:
//   caps                               { fields: [...], dueTime, priority(p) → p, advancesRepeats }
//   lists(account)                     [{ id, name }]
//   pull(link)                         [{ remoteId, etag, modified, fields, raw }] (all, or it throws)
//   create(link, fields)               { remoteId, etag, fields? }
//   update(link, item, patch, fields)  { etag, fields? }    item from pull(); throws code task_sync_conflict
//   remove(link, remoteId, etag)       404 counts as done
import { randomUUID } from 'node:crypto';
import { advanceRepeat, dayIn, PRIORITIES, FREQS, syncStateOf } from './tasks.mjs';

export const SYNC_FIELDS = ['title', 'notes', 'due', 'remindAt', 'priority', 'repeat', 'done'];
const MAX_LINKS = 10;
const MAX_TASKS = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (message, code = 'task_sync_failed', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ------------------------------------------------------------------ projection
/** The fields of a local task as the provider can hold them. */
export function project(task, caps, timeZone) {
  const out = {};
  for (const field of caps.fields) {
    if (field === 'due') {
      const due = task.due || null;
      out.due = due && !caps.dueTime && !DATE.test(due) ? dayIn(due, timeZone) : due;
    } else if (field === 'priority') {
      out.priority = caps.priority ? caps.priority(task.priority || 'none') : task.priority || 'none';
    } else if (field === 'done') out.done = task.done === true;
    else if (field === 'repeat') out.repeat = task.repeat || null;
    else if (field === 'remindAt') out.remindAt = task.remindAt || null;
    else out[field] = task[field] ?? '';
  }
  return out;
}

/** Values from a server, checked like a task from the user (unusable values become empty). */
export function cleanRemote(fields, caps) {
  const out = {};
  const instant = v => {
    const at = Date.parse(v);
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(at)
      ? new Date(at).toISOString()
      : null;
  };
  const strip = (v, max) =>
    String(v ?? '')
      .replace(/\0/g, '')
      .slice(0, max);
  for (const field of caps.fields) {
    const v = fields[field];
    if (field === 'title') out.title = strip(v, 300).trim() || 'Ohne Titel';
    else if (field === 'notes') out.notes = strip(v, 10_000);
    else if (field === 'due') out.due = typeof v === 'string' && DATE.test(v) ? v : v ? instant(v) : null;
    else if (field === 'remindAt') out.remindAt = v ? instant(v) : null;
    else if (field === 'priority') out.priority = PRIORITIES.includes(v) ? v : 'none';
    else if (field === 'done') out.done = v === true;
    else if (field === 'repeat')
      out.repeat =
        v && FREQS.includes(v.freq)
          ? {
              freq: v.freq,
              interval: Number.isInteger(v.interval) && v.interval >= 1 && v.interval <= 99 ? v.interval : 1
            }
          : null;
  }
  if (out.repeat && !out.due) out.repeat = null;
  return out;
}

/** Writes projected values into a local task; a value that already matches the projection stays. */
export function applyFields(task, fields, caps, timeZone) {
  const next = { ...task };
  const current = project(task, caps, timeZone);
  for (const [field, value] of Object.entries(fields)) {
    // Equal in the provider's terms (e.g. the day of a timed due date): the local value stays.
    if (same(current[field], value)) continue;
    next[field] = value;
  }
  if (next.repeat && !next.due) next.repeat = null;
  if (next.remindAt !== task.remindAt) next.remindedAt = null;
  if (next.done !== task.done) next.doneAt = next.done ? task.doneAt || new Date().toISOString() : null;
  return next;
}

/**
 * Three-way merge of one task. Returns { merged, conflicts: [field] }; `merged` is in projected form.
 * `localNewer` decides fields changed on both sides.
 */
export function mergeFields(base, local, remote, localNewer) {
  const merged = {};
  const conflicts = [];
  for (const field of Object.keys(local)) {
    const b = base ? base[field] : undefined;
    const lc = !base || !same(local[field], b);
    const rc = !base || !same(remote[field], b);
    if (same(local[field], remote[field])) merged[field] = remote[field];
    else if (lc && !rc) merged[field] = local[field];
    else if (rc && !lc) merged[field] = remote[field];
    else {
      merged[field] = localNewer ? local[field] : remote[field];
      conflicts.push(field);
    }
  }
  return { merged, conflicts };
}
const patchOf = (merged, remote) =>
  Object.fromEntries(Object.entries(merged).filter(([field, value]) => !same(value, remote?.[field])));

// ------------------------------------------------------------------ engine
/**
 * @param {object} o
 * @param {{ get(): object, save(v): Promise }} o.file   the task file (tasks-local.json)
 * @param {Record<string, object>} o.adapters            provider → adapter
 */
export function createTaskSync({
  file,
  adapters,
  now = () => new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Vienna',
  logger = () => {}
}) {
  const state = () => syncStateOf(file.get());
  const saveSync = async (links, tombstones) => {
    const current = file.get();
    await file.save({ ...current, taskSync: { links, tombstones } });
  };
  const adapterOf = provider => {
    const a = adapters[provider];
    if (!a) throw fail('Dieser Dienst ist für Aufgaben nicht verfügbar.', 'task_sync_provider', 404);
    return a;
  };
  const running = new Map(); // link id → promise

  async function syncLink(link) {
    const adapter = adapterOf(link.provider);
    const caps = adapter.caps;
    const stamp = () => now().toISOString();
    const remoteItems = await adapter.pull(link);
    const remote = new Map(remoteItems.map(r => [r.remoteId, { ...r, fields: cleanRemote(r.fields, caps) }]));
    const snapshot = file.get();
    const tasks = (Array.isArray(snapshot.tasks) ? snapshot.tasks : []).filter(t => t.sync?.link === link.id);
    const tombstones = state().tombstones.filter(t => t.link === link.id);
    const ops = []; // { id, expected, task?, sync?, remove? }
    const added = [];
    const doneTombstones = [];
    const result = { pushed: 0, pulled: 0, created: 0, deleted: 0, conflicts: [], errors: 0 };
    const known = new Set();
    const attempt = async (what, fn) => {
      try {
        return await fn();
      } catch (err) {
        if (err.code === 'task_sync_conflict') return undefined; // changed meanwhile: next round
        result.errors++;
        logger(`task sync ${link.provider} ${what}: ${err.code || 'failed'}`);
        if (err.code?.startsWith?.('oauth_') || /consent_required$/.test(err.code || '')) throw err;
        return undefined;
      }
    };

    // Deletions made here: delete there, unless it was changed there since.
    for (const tomb of tombstones) {
      const item = remote.get(tomb.remoteId);
      known.add(tomb.remoteId);
      if (!item) {
        doneTombstones.push(tomb);
        continue;
      }
      const untouched = (tomb.etag && item.etag === tomb.etag) || (tomb.base && same(item.fields, tomb.base));
      if (untouched) {
        const ok = await attempt('remove', () => adapter.remove(link, tomb.remoteId, item.etag));
        if (ok !== undefined) {
          result.deleted++;
          doneTombstones.push(tomb);
        }
      } else {
        // Changed on the server after it was deleted here: the changed task comes back.
        doneTombstones.push(tomb);
        known.delete(tomb.remoteId);
      }
    }

    // A list that is suddenly empty while many tasks were synced is treated as an error, not as
    // "delete everything" (e.g. a server that answered with an empty list by mistake).
    const syncedHere = tasks.filter(t => t.sync.remoteId);
    const suspicious = remote.size === 0 && syncedHere.length >= 10;
    if (suspicious) result.errors++;

    for (const task of tasks) {
      const local = project(task, caps, timeZone);
      const sync = task.sync;
      if (!sync.remoteId) {
        // New in this list (or moved into it): create on the server.
        const made = await attempt('create', () => adapter.create(link, local));
        if (made?.remoteId) {
          known.add(made.remoteId);
          ops.push({
            id: task.id,
            expected: task.updatedAt,
            sync: {
              link: link.id,
              remoteId: made.remoteId,
              etag: made.etag || '',
              base: made.fields ? cleanRemote(made.fields, caps) : local
            }
          });
          result.pushed++;
        }
        continue;
      }
      known.add(sync.remoteId);
      const item = remote.get(sync.remoteId);
      if (!item) {
        if (suspicious) continue;
        if (sync.base && same(local, sync.base)) {
          ops.push({ id: task.id, expected: task.updatedAt, remove: true });
          result.deleted++;
        } else {
          // Deleted there, changed here: keep it and create it again.
          const made = await attempt('create', () => adapter.create(link, local));
          if (made?.remoteId) {
            known.add(made.remoteId);
            ops.push({
              id: task.id,
              expected: task.updatedAt,
              sync: { link: link.id, remoteId: made.remoteId, etag: made.etag || '', base: local }
            });
            result.pushed++;
          }
        }
        continue;
      }
      const localNewer = !item.modified || Date.parse(task.updatedAt) >= Date.parse(item.modified);
      const { merged, conflicts } = mergeFields(sync.base, local, item.fields, localNewer);
      if (conflicts.length) result.conflicts.push({ id: task.id, title: task.title, fields: conflicts });
      let next = applyFields(task, merged, caps, timeZone);
      // Finished on another device: a repeating task moves on to its next date here, unless the
      // provider does that itself (Microsoft To Do makes a new task for the next date).
      if (next.done && !task.done && next.repeat && next.due && !caps.advancesRepeats) {
        const { next: following, finished } = advanceRepeat(next, stamp());
        added.push(finished);
        next = following;
      }
      const final = project(next, caps, timeZone);
      const patch = patchOf(final, item.fields);
      let etag = item.etag;
      let base = item.fields;
      if (Object.keys(patch).length) {
        const r = await attempt('update', () => adapter.update(link, item, patch, final));
        if (!r) continue;
        etag = r.etag || '';
        base = r.fields ? cleanRemote(r.fields, caps) : final;
        result.pushed++;
      }
      const changedHere = SYNC_FIELDS.some(f => !same(next[f], task[f]));
      if (changedHere) result.pulled++;
      ops.push({
        id: task.id,
        expected: task.updatedAt,
        task: changedHere ? next : null,
        sync: { link: link.id, remoteId: sync.remoteId, etag, base }
      });
    }

    // New on the server: take over.
    for (const item of remote.values()) {
      if (known.has(item.remoteId)) continue;
      const at = stamp();
      const fresh = {
        id: randomUUID(),
        title: 'Ohne Titel',
        notes: '',
        due: null,
        remindAt: null,
        remindedAt: null,
        priority: 'none',
        repeat: null,
        done: false,
        doneAt: null,
        mail: null,
        source: 'manual',
        createdAt: at,
        updatedAt: at
      };
      const task = applyFields(fresh, item.fields, caps, timeZone);
      if (task.done) task.doneAt = item.modified || at;
      added.push({
        ...task,
        sync: { link: link.id, remoteId: item.remoteId, etag: item.etag || '', base: item.fields }
      });
      result.created++;
    }

    // Commit against the current file: a task edited during the sync keeps the edit and only
    // takes the new sync data, so the edit goes out next time.
    const current = file.get();
    let list = Array.isArray(current.tasks) ? [...current.tasks] : [];
    for (const op of ops) {
      const i = list.findIndex(t => t.id === op.id);
      if (i < 0) continue;
      const untouched = list[i].updatedAt === op.expected;
      if (op.remove) {
        if (untouched) list.splice(i, 1);
        continue;
      }
      if (list[i].sync?.link !== link.id) continue; // moved to another list meanwhile
      const base = untouched && op.task ? { ...op.task, updatedAt: stamp() } : list[i];
      list[i] = { ...base, sync: untouched ? op.sync : { ...op.sync, base: list[i].sync?.base ?? op.sync.base } };
    }
    const room = Math.max(0, MAX_TASKS - list.length);
    list = [...list, ...added.slice(0, room)];
    const sync = syncStateOf(current);
    const gone = new Set(doneTombstones.map(t => `${t.link}|${t.remoteId}`));
    const links = sync.links.map(l =>
      l.id === link.id
        ? {
            ...l,
            lastSync: stamp(),
            lastError: suspicious
              ? 'Die Liste beim Anbieter ist leer. Zur Sicherheit wurde hier nichts gelöscht.'
              : result.errors
                ? 'Einige Aufgaben ließen sich nicht abgleichen. Der nächste Abgleich versucht es erneut.'
                : null,
            lastErrorCode: suspicious ? 'task_sync_empty' : result.errors ? 'task_sync_partial' : null
          }
        : l
    );
    await file.save({
      ...current,
      tasks: list,
      taskSync: { links, tombstones: sync.tombstones.filter(t => !gone.has(`${t.link}|${t.remoteId}`)) }
    });
    return result;
  }

  async function runLink(link) {
    if (running.has(link.id)) return running.get(link.id);
    const job = syncLink(link)
      .catch(async err => {
        logger(`task sync ${link.provider}: ${err.code || 'failed'}`);
        const s = state();
        await saveSync(
          s.links.map(l =>
            l.id === link.id
              ? {
                  ...l,
                  lastSync: now().toISOString(),
                  lastError: err.message,
                  lastErrorCode: err.code || 'task_sync_failed'
                }
              : l
          ),
          s.tombstones
        ).catch(() => {});
        return { error: err.message, code: err.code || 'task_sync_failed' };
      })
      .finally(() => running.delete(link.id));
    running.set(link.id, job);
    return job;
  }

  const publicLink = l => ({
    id: l.id,
    provider: l.provider,
    accountId: l.accountId,
    accountLabel: l.accountLabel || '',
    listId: l.listId,
    name: l.name,
    lastSync: l.lastSync || null,
    lastError: l.lastError || null,
    lastErrorCode: l.lastErrorCode || null
  });

  return {
    links: () => state().links.map(publicLink),
    /** Lists on the servers that can be connected (per account, with errors per account). */
    async sources(accounts) {
      const out = [];
      const errors = [];
      for (const account of accounts) {
        const adapter = adapters[account.provider];
        if (!adapter) continue;
        try {
          for (const l of await adapter.lists(account))
            out.push({
              provider: account.provider,
              accountId: account.id,
              accountLabel: account.label,
              listId: l.id,
              name: l.name,
              connected: state().links.some(
                x => x.provider === account.provider && x.accountId === account.id && x.listId === l.id
              )
            });
        } catch (err) {
          errors.push({
            provider: account.provider,
            accountId: account.id,
            accountLabel: account.label,
            error: err.message,
            code: err.code || 'task_sync_failed'
          });
        }
      }
      return { lists: out, errors };
    },
    async link({ provider, accountId, accountLabel = '', listId, name }, { moveLocal = false } = {}) {
      adapterOf(provider);
      const s = state();
      if (typeof listId !== 'string' || !listId || listId.length > 2000)
        throw fail('Ungültige Liste.', 'task_sync_invalid');
      if (s.links.length >= MAX_LINKS) throw fail(`Höchstens ${MAX_LINKS} verbundene Listen.`, 'task_sync_limit', 409);
      if (s.links.some(l => l.provider === provider && l.accountId === accountId && l.listId === listId))
        throw fail('Diese Liste ist schon verbunden.', 'task_sync_exists', 409);
      const item = {
        id: `tl-${randomUUID()}`,
        provider,
        accountId: String(accountId),
        accountLabel: String(accountLabel).slice(0, 200),
        listId,
        name: String(name || 'Aufgaben').slice(0, 200),
        createdAt: now().toISOString(),
        lastSync: null,
        lastError: null
      };
      const current = file.get();
      const tasks = Array.isArray(current.tasks) ? current.tasks : [];
      await file.save({
        ...current,
        // Optional: the open tasks on this device move into the new list.
        tasks: moveLocal
          ? tasks.map(t =>
              !t.sync && !t.done ? { ...t, sync: { link: item.id, remoteId: null, etag: '', base: null } } : t
            )
          : tasks,
        taskSync: { links: [...s.links, item], tombstones: s.tombstones }
      });
      return publicLink(item);
    },
    /** Disconnects a list: its tasks stay on this device, nothing is deleted on the server. */
    async unlink(id) {
      const current = file.get();
      const s = syncStateOf(current);
      if (!s.links.some(l => l.id === id)) throw fail('Diese Liste ist nicht verbunden.', 'task_list_missing', 404);
      await file.save({
        ...current,
        tasks: (current.tasks || []).map(t => (t.sync?.link === id ? { ...t, sync: null } : t)),
        taskSync: { links: s.links.filter(l => l.id !== id), tombstones: s.tombstones.filter(t => t.link !== id) }
      });
    },
    /** An account was removed: its lists are disconnected the same way. */
    async forgetAccount(accountId) {
      for (const l of state().links.filter(x => x.accountId === accountId)) await this.unlink(l.id);
    },
    /** Syncs one list or all; never throws, errors are kept on the list. */
    async run(id = null) {
      const links = state().links.filter(l => !id || l.id === id);
      if (id && !links.length) throw fail('Diese Liste ist nicht verbunden.', 'task_list_missing', 404);
      const results = {};
      for (const link of links) results[link.id] = await runLink(link);
      return results;
    },
    busy: () => running.size > 0
  };
}

/** Runs a sync shortly after local changes and on a fixed interval while lists are connected. */
export function scheduleTaskSync(sync, { delayMs = 4000, intervalMs = 10 * 60_000, firstMs = 30_000 } = {}) {
  let timer = null;
  const fire = () => {
    timer = null;
    if (sync.links().length) void sync.run().catch(() => {});
  };
  const interval = setInterval(fire, intervalMs);
  interval.unref?.();
  timer = setTimeout(fire, firstMs);
  timer.unref?.();
  return {
    soon() {
      if (!sync.links().length) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
      timer.unref?.();
    },
    stop() {
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    }
  };
}
