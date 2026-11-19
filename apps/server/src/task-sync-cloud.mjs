// Microsoft To Do (Microsoft Graph /me/todo) and Google Tasks (Tasks API v1) for the task sync
// (task-sync.mjs), with the Microsoft 365 / Google mail accounts signed in with OAuth.
//
// Microsoft To Do: title, note, due date (day only), reminder, priority (low/normal/high),
// repetition and done. Finishing a repeating task there creates the next one itself.
// Google Tasks: title, note, due date (day only) and done; reminder, priority and repetition
// stay on this device (the API has none).
//
// The task scopes (Tasks.ReadWrite, auth/tasks) are asked for separately from mail and calendar,
// so accounts signed in before keep working; they get a one-time consent for tasks.
import { stripTags } from './html-mail.mjs';

export const TASK_ENDPOINTS = {
  graph: 'https://graph.microsoft.com/v1.0',
  googleTasks: 'https://tasks.googleapis.com/tasks/v1'
};
const MAX_ITEMS = 5000;
const MAX_PAGES = 60;
const fail = (message, code, statusCode = 502, extra = {}) =>
  Object.assign(new Error(message), { code, statusCode, ...extra });
// A list longer than the limits is never taken as complete: the sync engine reads tasks missing
// from a pull as "deleted there", so a cut-off pull would delete tasks here.
const incomplete = () =>
  fail(
    'Die Liste beim Anbieter ist zu groß für den Abgleich. Zur Sicherheit wurde nichts geändert.',
    'task_sync_incomplete'
  );
const consent = account =>
  fail(
    'Für die Aufgaben dieses Kontos ist eine einmalige Freigabe beim Anbieter nötig.',
    'tasks_consent_required',
    403,
    { accountId: account.id, provider: account.provider }
  );

/** Wall-clock time in an IANA zone → UTC ISO (Graph returns times in the zone they were set in). */
export function zonedToUtc(local, timeZone) {
  const clean = String(local).replace(/\.\d+$/, '');
  const asUtc = Date.parse(`${clean}Z`);
  if (!Number.isFinite(asUtc)) return null;
  if (!timeZone || /^(utc|gmt|etc\/utc|coordinated universal time)$/i.test(timeZone))
    return new Date(asUtc).toISOString();
  let offset;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      })
        .formatToParts(new Date(asUtc))
        .map(p => [p.type, p.value])
    );
    offset =
      Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`) - asUtc;
  } catch {
    offset = 0; // unknown (e.g. Windows) zone name: taken as UTC
  }
  return new Date(asUtc - offset).toISOString();
}

function caller(account, { token, fetchImpl, allowed }) {
  return async (method, url, body, extraHeaders = {}) => {
    if (!allowed(url)) throw fail('Der Anbieter verweist auf eine fremde Adresse.', 'task_sync_foreign_url');
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${await token(account)}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (err) {
      if (err.code === 'cloud_consent_required') throw consent(account);
      if (err.code?.startsWith?.('oauth_')) throw err;
      throw fail('Der Aufgabendienst des Anbieters ist nicht erreichbar.', 'task_sync_unreachable', 503);
    }
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) throw consent(account);
    if (res.status === 404)
      throw fail('Die Aufgabe oder Liste gibt es beim Anbieter nicht mehr.', 'task_sync_not_found', 404);
    if (res.status === 409 || res.status === 412)
      throw fail('Die Aufgabe wurde beim Anbieter geändert.', 'task_sync_conflict', 409);
    if (!res.ok) throw fail('Der Anbieter hat die Änderung abgelehnt.', 'task_sync_rejected');
    return data;
  };
}
// Only well-formed ETags are sent (they come from the provider's own responses).
const ifMatch = etag =>
  typeof etag === 'string' && etag && etag.length < 300 && !/[\r\n]/.test(etag) ? { 'If-Match': etag } : {};
const ignoreMissing = async fn => {
  try {
    await fn();
  } catch (err) {
    if (err.code !== 'task_sync_not_found') throw err;
  }
  return true;
};

// ------------------------------------------------------------------ Microsoft To Do
const GRAPH_TYPES = { daily: 'DAILY', weekly: 'WEEKLY', absoluteMonthly: 'MONTHLY', absoluteYearly: 'YEARLY' };
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const IMPORTANCE_IN = { high: 'high', low: 'low', normal: 'none' };
const IMPORTANCE_OUT = { high: 'high', low: 'low', medium: 'normal', none: 'normal' };

function graphRepeatIn(rec) {
  const p = rec?.pattern;
  const freq = p && GRAPH_TYPES[p.type];
  if (!freq) return null;
  if (freq === 'WEEKLY' && (p.daysOfWeek || []).length > 1) return null; // several weekdays: not representable
  return { freq, interval: Number(p.interval) || 1 };
}
function graphRepeatOut(repeat, due) {
  if (!repeat || !due) return null;
  const d = new Date(`${due}T00:00:00Z`);
  const type = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'absoluteMonthly', YEARLY: 'absoluteYearly' }[repeat.freq];
  const pattern = { type, interval: repeat.interval };
  if (type === 'weekly') pattern.daysOfWeek = [WEEKDAYS[d.getUTCDay()]];
  if (type === 'absoluteMonthly' || type === 'absoluteYearly') pattern.dayOfMonth = d.getUTCDate();
  if (type === 'absoluteYearly') pattern.month = d.getUTCMonth() + 1;
  return { pattern, range: { type: 'noEnd', startDate: due } };
}
const utcLocal = iso => new Date(iso).toISOString().replace('Z', '');

export function graphTaskIn(t) {
  const body = t.body?.content || '';
  return {
    remoteId: t.id,
    etag: t['@odata.etag'] || '',
    modified: t.lastModifiedDateTime || null,
    fields: {
      title: t.title || '',
      notes: t.body?.contentType === 'html' ? stripTags(body.replace(/<(br|\/p|\/div)[^>]*>/gi, '\n')).trim() : body,
      due: t.dueDateTime?.dateTime ? String(t.dueDateTime.dateTime).slice(0, 10) : null,
      remindAt:
        t.isReminderOn && t.reminderDateTime?.dateTime
          ? zonedToUtc(t.reminderDateTime.dateTime, t.reminderDateTime.timeZone)
          : null,
      priority: IMPORTANCE_IN[t.importance] || 'none',
      repeat: graphRepeatIn(t.recurrence),
      done: t.status === 'completed'
    }
  };
}
/** Graph body for the given fields; `all` gives the due date a repetition needs. */
export function graphTaskOut(patch, all = patch) {
  const out = {};
  if ('title' in patch) out.title = patch.title;
  if ('notes' in patch) out.body = { content: patch.notes || '', contentType: 'text' };
  if ('due' in patch)
    out.dueDateTime = patch.due ? { dateTime: `${patch.due}T00:00:00.0000000`, timeZone: 'UTC' } : null;
  if ('remindAt' in patch) {
    out.isReminderOn = Boolean(patch.remindAt);
    out.reminderDateTime = patch.remindAt ? { dateTime: utcLocal(patch.remindAt), timeZone: 'UTC' } : null;
  }
  if ('priority' in patch) out.importance = IMPORTANCE_OUT[patch.priority] || 'normal';
  // A new due date moves the start of a repetition along.
  if ('repeat' in patch || ('due' in patch && all.repeat)) out.recurrence = graphRepeatOut(all.repeat, all.due);
  if ('done' in patch) out.status = patch.done ? 'completed' : 'notStarted';
  return out;
}

export function createGraphTasks({ accounts, token, fetchImpl = globalThis.fetch, endpoints = TASK_ENDPOINTS }) {
  const base = endpoints.graph;
  const call = account => caller(account, { token, fetchImpl, allowed: url => url.startsWith(`${base}/`) });
  const accountOf = id => {
    const a = accounts().find(x => x.id === id && x.provider === 'microsoft');
    if (!a) throw fail('Das Konto gibt es nicht mehr.', 'task_sync_account_missing', 404);
    return a;
  };
  const listUrl = listId => `${base}/me/todo/lists/${encodeURIComponent(listId)}/tasks`;
  async function all(account, url) {
    const out = [];
    let next = url;
    for (let page = 0; next; page++) {
      if (page >= MAX_PAGES) throw incomplete();
      const data = await call(account)('GET', next);
      if (!Array.isArray(data.value))
        throw fail('Der Anbieter hat eine unerwartete Antwort geschickt.', 'task_sync_bad_response');
      out.push(...data.value);
      if (out.length > MAX_ITEMS) throw incomplete();
      next = typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null;
    }
    return out;
  }
  return {
    caps: {
      fields: ['title', 'notes', 'due', 'remindAt', 'priority', 'repeat', 'done'],
      dueTime: false,
      priority: p => (p === 'medium' ? 'none' : p),
      advancesRepeats: true
    },
    async lists(ref) {
      const account = accountOf(ref.id);
      return (await all(account, `${base}/me/todo/lists`)).map(l => ({
        id: String(l.id),
        name: String(l.displayName || 'Aufgaben').slice(0, 200)
      }));
    },
    async pull(link) {
      const account = accountOf(link.accountId);
      return (await all(account, `${listUrl(link.listId)}?$top=100`)).map(graphTaskIn);
    },
    async create(link, fields) {
      const account = accountOf(link.accountId);
      const t = await call(account)('POST', listUrl(link.listId), graphTaskOut(fields));
      return { remoteId: String(t.id), etag: t['@odata.etag'] || '' };
    },
    async update(link, item, patch, all) {
      const account = accountOf(link.accountId);
      // If-Match: a change made there since the pull is not overwritten (412 → next round merges).
      const t = await call(account)(
        'PATCH',
        `${listUrl(link.listId)}/${encodeURIComponent(item.remoteId)}`,
        graphTaskOut(patch, all),
        ifMatch(item.etag)
      );
      return { etag: t['@odata.etag'] || '' };
    },
    async remove(link, remoteId, etag) {
      const account = accountOf(link.accountId);
      return ignoreMissing(() =>
        call(account)('DELETE', `${listUrl(link.listId)}/${encodeURIComponent(remoteId)}`, undefined, ifMatch(etag))
      );
    }
  };
}

// ------------------------------------------------------------------ Google Tasks
export function googleTaskIn(t) {
  return {
    remoteId: t.id,
    etag: t.etag || '',
    modified: t.updated || null,
    fields: {
      title: t.title || '',
      notes: t.notes || '',
      // Google keeps the day only (the time part is always midnight UTC).
      due: typeof t.due === 'string' ? t.due.slice(0, 10) : null,
      done: t.status === 'completed'
    }
  };
}
export function googleTaskOut(patch) {
  const out = {};
  if ('title' in patch) out.title = patch.title;
  if ('notes' in patch) out.notes = patch.notes || '';
  if ('due' in patch) out.due = patch.due ? `${patch.due}T00:00:00.000Z` : null;
  if ('done' in patch) {
    out.status = patch.done ? 'completed' : 'needsAction';
    if (!patch.done) out.completed = null;
  }
  return out;
}

export function createGoogleTasks({ accounts, token, fetchImpl = globalThis.fetch, endpoints = TASK_ENDPOINTS }) {
  const base = endpoints.googleTasks || TASK_ENDPOINTS.googleTasks;
  const call = account => caller(account, { token, fetchImpl, allowed: url => url.startsWith(`${base}/`) });
  const accountOf = id => {
    const a = accounts().find(x => x.id === id && x.provider === 'google');
    if (!a) throw fail('Das Konto gibt es nicht mehr.', 'task_sync_account_missing', 404);
    return a;
  };
  const listUrl = listId => `${base}/lists/${encodeURIComponent(listId)}/tasks`;
  async function all(account, url) {
    const out = [];
    let pageToken = '';
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw incomplete();
      const u = new URL(url);
      if (pageToken) u.searchParams.set('pageToken', pageToken);
      const data = await call(account)('GET', u.toString());
      // Google leaves "items" out when a list (or the last page) is empty.
      if (data.items !== undefined && !Array.isArray(data.items))
        throw fail('Der Anbieter hat eine unerwartete Antwort geschickt.', 'task_sync_bad_response');
      out.push(...(data.items || []));
      if (out.length > MAX_ITEMS) throw incomplete();
      if (typeof data.nextPageToken !== 'string' || !data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return out;
  }
  return {
    caps: { fields: ['title', 'notes', 'due', 'done'], dueTime: false, advancesRepeats: false },
    async lists(ref) {
      const account = accountOf(ref.id);
      return (await all(account, `${base}/users/@me/lists?maxResults=100`)).map(l => ({
        id: String(l.id),
        name: String(l.title || 'Aufgaben').slice(0, 200)
      }));
    },
    async pull(link) {
      const account = accountOf(link.accountId);
      const items = await all(
        account,
        `${listUrl(link.listId)}?maxResults=100&showCompleted=true&showHidden=true&showDeleted=false`
      );
      return items.filter(t => !t.deleted).map(googleTaskIn);
    },
    async create(link, fields) {
      const account = accountOf(link.accountId);
      const t = await call(account)('POST', listUrl(link.listId), googleTaskOut(fields));
      return { remoteId: String(t.id), etag: t.etag || '' };
    },
    async update(link, item, patch) {
      const account = accountOf(link.accountId);
      const t = await call(account)(
        'PATCH',
        `${listUrl(link.listId)}/${encodeURIComponent(item.remoteId)}`,
        googleTaskOut(patch),
        ifMatch(item.etag)
      );
      return { etag: t.etag || '' };
    },
    async remove(link, remoteId, etag) {
      const account = accountOf(link.accountId);
      return ignoreMissing(() =>
        call(account)('DELETE', `${listUrl(link.listId)}/${encodeURIComponent(remoteId)}`, undefined, ifMatch(etag))
      );
    }
  };
}
