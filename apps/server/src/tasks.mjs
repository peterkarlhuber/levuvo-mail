// Tasks ("Aufgaben"): title, due date or time, reminder, priority, repetition, note and an
// optional link to the mail they came from. Stored on this computer only, in tasks-local.json,
// encrypted with AES-256-GCM; the key lives in the system keychain (same model as the device
// calendar and the contacts on this device). Without the key the task list is unavailable
// instead of being replaced by an empty one.
//
// Shared interface (also used by the AI core): list({ view }), get, save, setDone, remove.
//
// Optional sync (task-sync.mjs): a task can belong to a connected list (CalDAV, Microsoft To Do,
// Google Tasks). It then carries `sync` = { link, remoteId, etag, base }; without it, it stays
// on this device. The links and the deletions still to send live in the same file (`taskSync`).
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { atomicWrite, createWriteQueue, keychainKey, seal, unseal } from './local-store.mjs';

const MAX_TASKS = 5000;
const KEY_ACCOUNT = 'local';
const KEY_NAME = 'tasks-key';
const fail = (message, code = 'task_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const PRIORITIES = ['none', 'low', 'medium', 'high'];
export const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
export const VIEWS = ['today', 'upcoming', 'overdue', 'open', 'done', 'all'];
export const SOURCES = ['manual', 'mail', 'ai'];

// ------------------------------------------------------------------ validation
function text(value, max, label) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw fail(`Ungültiges Feld: ${label}.`);
  return value;
}
function validDate(value) {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2200 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function instant(value, message) {
  const at = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(at) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw fail(message);
  return new Date(at).toISOString();
}
function validDue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw fail('Ungültige Fälligkeit.');
  if (DATE.test(value)) {
    if (!validDate(value)) throw fail('Ungültige Fälligkeit.');
    return value;
  }
  return instant(value, 'Ungültige Fälligkeit.');
}
function validRemind(value) {
  if (value === undefined || value === null || value === '') return null;
  return instant(value, 'Ungültige Erinnerung.');
}
function validRepeat(r) {
  if (!r) return null;
  if (typeof r !== 'object' || !FREQS.includes(r.freq)) throw fail('Ungültige Wiederholung.');
  const interval = Number.isInteger(r.interval) && r.interval >= 1 && r.interval <= 99 ? r.interval : 1;
  return { freq: r.freq, interval };
}
function validMail(m) {
  if (!m || typeof m !== 'object') return null;
  const uid = Number(m.uid);
  const accountId = text(m.accountId, 200, 'Konto');
  const folder = text(m.folder, 1000, 'Ordner');
  if (!accountId || !folder || !Number.isInteger(uid) || uid < 1) throw fail('Ungültiger Verweis auf die E-Mail.');
  return {
    accountId,
    folder,
    uid,
    messageId: text(m.messageId, 998, 'Message-ID') || null,
    subject: text(m.subject, 1000, 'Betreff'),
    from: text(m.from, 400, 'Absender')
  };
}

export function validateTask(input) {
  if (!input || typeof input !== 'object') throw fail('Ungültige Aufgabe.');
  const title = text(input.title, 300, 'Titel').trim();
  if (!title) throw fail('Bitte einen Titel eingeben.');
  const priority = input.priority === undefined || input.priority === null ? 'none' : input.priority;
  if (!PRIORITIES.includes(priority)) throw fail('Ungültige Priorität.');
  const due = validDue(input.due);
  const repeat = validRepeat(input.repeat);
  if (repeat && !due) throw fail('Eine Wiederholung braucht ein Fälligkeitsdatum.');
  const mail = validMail(input.mail);
  const source = SOURCES.includes(input.source) ? input.source : mail ? 'mail' : 'manual';
  return {
    title,
    notes: text(input.notes, 10_000, 'Notiz'),
    due,
    remindAt: validRemind(input.remindAt),
    priority,
    repeat,
    done: input.done === true,
    mail,
    source
  };
}

// ------------------------------------------------------------------ dates and views
const pad = n => String(n).padStart(2, '0');
/** Calendar day of a due value in a time zone (dates are taken as they are). */
export function dayIn(due, timeZone) {
  if (!due) return null;
  if (DATE.test(due)) return due;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(due))
      .map(p => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDaysYmd(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Tasks of a view, relative to `now` in `timeZone`:
 * today (due today or overdue), upcoming (next 7 days, after today), overdue, open, done, all.
 */
export function filterTasks(list, view = 'open', { now = new Date(), timeZone = 'Europe/Vienna' } = {}) {
  const today = dayIn(now.toISOString(), timeZone);
  const week = addDaysYmd(today, 7);
  const overdue = t => {
    if (!t.due || t.done) return false;
    if (DATE.test(t.due)) return t.due < today;
    return Date.parse(t.due) < now.getTime();
  };
  const day = t => dayIn(t.due, timeZone);
  const pick = {
    today: t => !t.done && t.due && (day(t) <= today || overdue(t)),
    upcoming: t => !t.done && t.due && day(t) > today && day(t) <= week,
    overdue: t => overdue(t),
    open: t => !t.done,
    done: t => t.done,
    all: () => true
  }[VIEWS.includes(view) ? view : 'open'];
  return sortTasks(list.filter(pick));
}

const RANK = { high: 0, medium: 1, low: 2, none: 3 };
/** Open tasks first (by due date, undated last, then priority), then done ones (latest first). */
export function sortTasks(list) {
  const dueKey = t => (t.due ? (DATE.test(t.due) ? `${t.due}T00:00` : t.due) : '9999');
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return String(b.doneAt || '').localeCompare(String(a.doneAt || ''));
    return (
      dueKey(a).localeCompare(dueKey(b)) ||
      (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3) ||
      String(a.createdAt).localeCompare(String(b.createdAt))
    );
  });
}

/** Next due value of a repeating task (dates step in days/months, times keep the clock time). */
export function nextDue(due, repeat) {
  if (!due || !repeat) return null;
  const step = (y, m, d) => {
    const n = repeat.interval;
    if (repeat.freq === 'DAILY') return [y, m, d + n];
    if (repeat.freq === 'WEEKLY') return [y, m, d + 7 * n];
    if (repeat.freq === 'MONTHLY') return [y, m + n, d];
    return [y + n, m, d];
  };
  // The 31st of a month falls on the last day of shorter months instead of rolling over.
  const clamp = (y, m, d) => {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d, last)));
  };
  if (DATE.test(due)) {
    const [y, m, d] = due.split('-').map(Number);
    const [ny, nm, nd] = step(y, m - 1, d);
    const dt = ['MONTHLY', 'YEARLY'].includes(repeat.freq) ? clamp(ny, nm, nd) : new Date(Date.UTC(ny, nm, nd));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  // A due time keeps its local clock time (the server runs on the user's device): stepping in UTC
  // moved a 09:00 task to 08:00/10:00 across a daylight saving change and could tip the day.
  const t = new Date(due);
  const [ny, nm, nd] = step(t.getFullYear(), t.getMonth(), t.getDate());
  const day = ['MONTHLY', 'YEARLY'].includes(repeat.freq) ? Math.min(nd, new Date(ny, nm + 1, 0).getDate()) : nd;
  return new Date(ny, nm, day, t.getHours(), t.getMinutes(), t.getSeconds(), 0).toISOString();
}

// ------------------------------------------------------------------ store
/**
 * A repeating task that is finished: the open task moves to its next due date (the reminder moves
 * by the same amount), the finished occurrence becomes a done copy without repetition that stays
 * on this device.
 */
export function advanceRepeat(task, stamp) {
  const finished = {
    ...task,
    id: randomUUID(),
    repeat: null,
    remindAt: null,
    remindedAt: null,
    done: true,
    doneAt: stamp,
    sync: null,
    createdAt: stamp,
    updatedAt: stamp
  };
  const due = nextDue(task.due, task.repeat);
  const shift = DATE.test(task.due)
    ? Date.parse(`${due}T00:00:00Z`) - Date.parse(`${task.due}T00:00:00Z`)
    : Date.parse(due) - Date.parse(task.due);
  const next = {
    ...task,
    due,
    done: false,
    doneAt: null,
    remindAt: task.remindAt ? new Date(Date.parse(task.remindAt) + shift).toISOString() : null,
    remindedAt: null,
    updatedAt: stamp
  };
  return { next, finished };
}

/** Sync part of the file: connected lists and deletions not yet sent. */
export const syncStateOf = state => ({
  links: Array.isArray(state?.taskSync?.links) ? state.taskSync.links : [],
  tombstones: Array.isArray(state?.taskSync?.tombstones) ? state.taskSync.tombstones : []
});
/** A synced task that leaves its list (deleted or moved): its remote copy is deleted on the next sync. */
function tombstoneFor(task) {
  if (!task?.sync?.link || !task.sync.remoteId) return null;
  return {
    link: task.sync.link,
    remoteId: task.sync.remoteId,
    etag: task.sync.etag || '',
    base: task.sync.base || null
  };
}

/**
 * `file` is { get(): { tasks, taskSync? }, save(next) } – encrypted on disk (openTaskFile) or in
 * memory (tests). `onChange` runs after every change made through the store (used to start a sync).
 */
export function createTaskStore(file, { now = () => new Date(), onChange = () => {} } = {}) {
  const list = () => (Array.isArray(file.get().tasks) ? file.get().tasks : []);
  const write = async (tasks, tombstones = [], { notify = true } = {}) => {
    const state = file.get();
    const next = { ...state, tasks };
    if (tombstones.length) {
      const sync = syncStateOf(state);
      next.taskSync = { ...state.taskSync, links: sync.links, tombstones: [...sync.tombstones, ...tombstones] };
    }
    await file.save(next);
    if (!notify) return;
    try {
      onChange();
    } catch {
      /* a failing listener must not fail the change */
    }
  };
  /** `list` in the input: a connected list's id, '' or null for this device, undefined = unchanged. */
  const syncFor = (input, existing) => {
    const current = existing?.sync || null;
    if (input.list === undefined) return { sync: current, gone: null };
    const target = typeof input.list === 'string' && input.list ? input.list : null;
    if ((current?.link || null) === target) return { sync: current, gone: null };
    if (target && !syncStateOf(file.get()).links.some(l => l.id === target))
      throw fail('Diese Liste ist nicht mehr verbunden.', 'task_list_missing', 404);
    return {
      sync: target ? { link: target, remoteId: null, etag: '', base: null } : null,
      gone: tombstoneFor(current && existing)
    };
  };
  const store = {
    available: true,
    list: ({ view = 'all', timeZone } = {}) => filterTasks(list(), view, { now: now(), timeZone }),
    get: id => list().find(t => t.id === id) || null,
    async save(input) {
      const clean = validateTask(input);
      const current = list();
      const existing = typeof input.id === 'string' ? current.find(t => t.id === input.id) : null;
      if (!existing && current.length >= MAX_TASKS) throw fail(`Höchstens ${MAX_TASKS} Aufgaben.`);
      const stamp = now().toISOString();
      const { sync, gone } = syncFor(input, existing);
      const item = {
        id: existing?.id || randomUUID(),
        ...clean,
        // The mail link and the origin are set when the task is made and kept on later edits.
        mail: clean.mail || existing?.mail || null,
        source: existing?.source || clean.source,
        doneAt: clean.done ? existing?.doneAt || stamp : null,
        // A changed reminder time rings again.
        remindedAt: existing && existing.remindAt === clean.remindAt ? existing.remindedAt || null : null,
        sync,
        createdAt: existing?.createdAt || stamp,
        updatedAt: stamp
      };
      await write([...current.filter(t => t.id !== item.id), item], gone ? [gone] : []);
      return item;
    },
    /**
     * Done/undone. A repeating task stays open with its next due date (and reminder moved by the
     * same amount); the finished occurrence is kept as a done copy without repetition.
     */
    async setDone(id, done) {
      const task = list().find(t => t.id === id);
      if (!task) throw fail('Die Aufgabe gibt es nicht mehr.', 'task_missing', 404);
      if (!(done === true && task.repeat && task.due && !task.done))
        return { task: await store.save({ ...task, done: done === true }), finished: null };
      const { next, finished } = advanceRepeat(task, now().toISOString());
      await write([...list().filter(t => t.id !== id), next, finished]);
      return { task: next, finished };
    },
    async remove(id) {
      const gone = tombstoneFor(list().find(t => t.id === id));
      await write(
        list().filter(t => t.id !== id),
        gone ? [gone] : []
      );
    },
    /** Open tasks whose reminder time has come and that were not announced yet. */
    dueReminders() {
      const t = now().getTime();
      return list().filter(x => !x.done && x.remindAt && !x.remindedAt && Date.parse(x.remindAt) <= t);
    },
    async markReminded(ids) {
      const set = new Set(ids);
      const stamp = now().toISOString();
      await write(
        list().map(t => (set.has(t.id) ? { ...t, remindedAt: stamp } : t)),
        [],
        { notify: false }
      );
    },
    /** An account was removed: its mail links go, the tasks stay. */
    async forgetAccount(accountId) {
      const current = list();
      if (!current.some(t => t.mail?.accountId === accountId)) return;
      await write(current.map(t => (t.mail?.accountId === accountId ? { ...t, mail: null } : t)));
    }
  };
  return store;
}

/** A store that only reports why it is locked (no keychain, wrong key, damaged file). */
export function lockedTaskStore(error) {
  const locked = () => {
    throw error;
  };
  return {
    available: false,
    error,
    list: locked,
    get: locked,
    save: async () => locked(),
    setDone: async () => locked(),
    remove: async () => locked(),
    dueReminders: () => [],
    markReminded: async () => {},
    forgetAccount: async () => {}
  };
}

// ------------------------------------------------------------------ encrypted file

/** tasks-local.json, encrypted; throws (code task_locked, 423) when it cannot be opened. */
export async function openTaskFile({ filename, vault }) {
  let raw = null;
  try {
    raw = await readFile(filename, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const exists = raw !== null && raw.trim() !== '';
  // A new key only while no file exists: a fresh key for an existing file would make it
  // unreadable and the next save would overwrite every task.
  const key = keychainKey(vault, KEY_NAME, { create: !exists, account: KEY_ACCOUNT });
  if (!key)
    throw fail(
      'Die Aufgaben brauchen den Schlüsselbund des Systems. Er ist gerade nicht verfügbar.',
      'task_locked',
      423
    );
  let state = { tasks: [] };
  if (exists) {
    try {
      const parsed = JSON.parse(unseal(key, raw));
      // Keep every part of the saved state: `taskSync` holds the connected lists and the
      // deletions still to send. Dropping it here silently disconnected every list on restart.
      state = { ...(parsed && typeof parsed === 'object' ? parsed : {}) };
      state.tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    } catch {
      throw fail('Die Aufgaben lassen sich mit dem Schlüssel aus dem Schlüsselbund nicht öffnen.', 'task_locked', 423);
    }
  }
  const writes = createWriteQueue();
  return {
    get: () => state,
    save(next) {
      state = next;
      const snapshot = seal(key, JSON.stringify(next));
      return writes.push(() => atomicWrite(filename, snapshot));
    },
    flush: () => writes.flush()
  };
}
