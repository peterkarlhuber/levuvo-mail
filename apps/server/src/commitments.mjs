// Commitment tracker ("Versprechen"): finds concrete promises in mail. A promise the user made in a
// sent mail ("I'll send you the offer by Friday") becomes a suggested task; a promise someone made
// to the user ("I'll get back to you next week") becomes a suggested reminder that fires when
// nothing arrives. Nothing is created without the user's click (EU AI Act: human oversight).
//
// The scan is opt-in (AI feature `commitments`, off by default), runs as a background job and only
// with a local model: background work never sends mail to a cloud provider. It reads only mail that
// arrived after it was switched on (at most two days back), each message once, and only the user's
// own part of it (quoted history is cut off). Suggestions hold short quotes from mail, so they are
// stored encrypted (commitments.json, keychain key), kept 60 days, and removed with "forget AI".
import { randomUUID } from 'node:crypto';
import { waitsForReply } from './briefing.mjs';

export const SCAN_BACK_MS = 2 * 86_400_000;
export const KEEP_MS = 60 * 86_400_000;
const MAX_SCANNED = 5000;
const MAX_ITEMS = 500;
const LIST_LIMIT = 20;
export const PER_RUN = 6;
const BATCH = 3;
const TEXT_CHARS = 3000;

const keyOf = (accountId, folder, uid) => `${accountId}\u0000${folder}\u0000${uid}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The part of a mail its author wrote: quoted history and forwarded parts are cut off. */
export function ownText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (
      /^\s*(On .{4,200} wrote:|Am .{4,200} schrieb .{1,200}:|-{2,}\s*(Original Message|Ursprüngliche Nachricht)\s*-*|_{5,}|From: .+|Von: .+)\s*$/i.test(
        line
      )
    )
      break;
    out.push(line);
  }
  return out.join('\n').trim().slice(0, TEXT_CHARS);
}

/** The commitments.json store. */
export function createCommitmentStore(file, { now = () => Date.now() } = {}) {
  const data = () => ({ since: {}, scanned: [], items: [], lang: 'de', timeZone: '', ...file.get() });
  const save = next => {
    const cutoff = now() - KEEP_MS;
    return file.save({
      ...next,
      scanned: next.scanned.slice(-MAX_SCANNED),
      items: next.items.filter(i => Date.parse(i.createdAt) >= cutoff).slice(-MAX_ITEMS)
    });
  };
  return {
    get: data,
    open: () =>
      data()
        .items.filter(i => i.state === 'open')
        .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.createdAt.localeCompare(a.createdAt)),
    find: id => data().items.find(i => i.id === id) || null,
    sinceFor: accountId => data().since[accountId] || null,
    isScanned: (accountId, folder, uid) => data().scanned.includes(keyOf(accountId, folder, uid)),
    async start(accountId, at) {
      const d = data();
      if (d.since[accountId]) return d.since[accountId];
      await save({ ...d, since: { ...d.since, [accountId]: at } });
      return at;
    },
    async remember({ lang, timeZone }) {
      const d = data();
      const next = { lang: lang === 'en' ? 'en' : 'de', timeZone: String(timeZone || '').slice(0, 64) };
      if (d.lang !== next.lang || d.timeZone !== next.timeZone) await save({ ...d, ...next });
    },
    /** Records scanned messages and the suggestions found in them, in one write. */
    async addScan(keys, found) {
      const d = data();
      const seen = new Set(d.items.map(i => `${i.accountId}|${i.uid}|${i.what.toLowerCase()}`));
      const items = [...d.items];
      for (const f of found) {
        const sig = `${f.accountId}|${f.uid}|${f.what.toLowerCase()}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        items.push({ id: randomUUID(), state: 'open', createdAt: new Date(now()).toISOString(), ...f });
      }
      await save({ ...d, scanned: [...d.scanned, ...keys.map(k => keyOf(...k))], items });
      return items.length - d.items.length;
    },
    async update(id, patch) {
      const d = data();
      await save({ ...d, items: d.items.map(i => (i.id === id ? { ...i, ...patch } : i)) });
    },
    async forgetAccount(accountId) {
      const d = data();
      const since = { ...d.since };
      delete since[accountId];
      await save({
        ...d,
        since,
        scanned: d.scanned.filter(k => !k.startsWith(`${accountId}\u0000`)),
        items: d.items.filter(i => i.accountId !== accountId)
      });
    },
    clear: () => file.save({ since: {}, scanned: [], items: [], lang: 'de', timeZone: '' })
  };
}

/**
 * One scan pass. Returns { ran, scanned, found } or { ran: false, reason }.
 * @param {object} deps
 * @param {object} deps.ai the AI service (get, run)
 * @param {ReturnType<typeof createCommitmentStore>} deps.store
 * @param {Array<{id:string, sentFolder?:string}>} deps.accounts
 * @param {string[]} deps.ownAddresses
 * @param {(accountId:string, folder:string, limit:number) => Promise<{messages?:object[]}>} deps.listFolder
 * @param {(accountId:string, folder:string, uid:number) => Promise<{text?:string}|null>} deps.readText
 */
export async function scanCommitments(deps, { now = Date.now(), perRun = PER_RUN } = {}) {
  const { ai, store } = deps;
  const s = ai.get();
  if (!s.enabled || s.features?.commitments !== true) return { ran: false, reason: 'off' };
  if (s.provider !== 'ollama') return { ran: false, reason: 'cloud' };
  const own = new Set((deps.ownAddresses || []).map(a => String(a).toLowerCase()));
  const { lang, timeZone } = store.get();
  let budget = perRun;
  let scanned = 0;
  let found = 0;
  for (const account of deps.accounts || []) {
    if (budget <= 0) break;
    const since = Date.parse(await store.start(account.id, new Date(now).toISOString())) - SCAN_BACK_MS;
    const sources = [
      { folder: account.sentFolder || 'Sent', direction: 'mine' },
      { folder: 'INBOX', direction: 'theirs' }
    ];
    const todo = [];
    for (const src of sources) {
      const listed = await deps.listFolder(account.id, src.folder, LIST_LIMIT).catch(() => null);
      for (const m of listed?.messages || []) {
        const at = Date.parse(m.date || '');
        if (!Number.isFinite(at) || at < since || store.isScanned(account.id, src.folder, m.uid)) continue;
        // Received: only mail a person wrote to the user. Sent: everything the user wrote.
        if (src.direction === 'theirs' && !waitsForReply({ ...m, answered: false }, { own, since })) continue;
        todo.push({ ...src, m });
      }
    }
    for (let i = 0; i < todo.length && budget > 0; i += BATCH) {
      const batch = todo.slice(i, Math.min(i + BATCH, i + budget));
      const loaded = [];
      for (const [n, item] of batch.entries()) {
        const doc = await deps.readText(account.id, item.folder, item.m.uid).catch(() => null);
        const text = ownText(doc?.text || item.m.preview || '');
        loaded.push({ ...item, id: `m${n + 1}`, text });
      }
      budget -= batch.length;
      const input = loaded.filter(l => l.text);
      let items = [];
      if (input.length) {
        const result = await ai.run(
          'commitments',
          {
            lang,
            me: [...own].join(', '),
            now: new Date(now).toISOString().slice(0, 16),
            timeZone,
            messages: input.map(l => ({
              id: l.id,
              from: l.direction === 'mine' ? [...own][0] || '' : `${l.m.fromName || ''} <${l.m.fromEmail || ''}>`,
              to: (l.m.to || []).map(a => a.address || a).join(', '),
              date: l.m.date,
              subject: l.m.subject,
              text: l.text
            }))
          },
          { accountId: account.id, source: 'commitments' }
        );
        items = result.items || [];
      }
      const suggestions = [];
      for (const it of items) {
        const l = input.find(x => x.id === it.id);
        // The direction follows the folder: a sent mail never holds someone else's promise.
        if (!l || it.direction !== l.direction) continue;
        const counterpart =
          l.direction === 'theirs'
            ? String(l.m.fromEmail || '')
            : String(it.who || '').toLowerCase() || String(l.m.to?.[0]?.address || l.m.to?.[0] || '').toLowerCase();
        suggestions.push({
          accountId: account.id,
          folder: l.folder,
          uid: l.m.uid,
          messageId: l.m.messageId || null,
          subject: String(l.m.subject || '').slice(0, 300),
          direction: l.direction,
          what: String(it.what || '').slice(0, 120),
          who: counterpart.slice(0, 200),
          whoName: l.direction === 'theirs' ? String(l.m.fromName || '').slice(0, 120) : '',
          due: DATE.test(it.due || '') ? it.due : null,
          quote: String(it.quote || '').slice(0, 300)
        });
      }
      found += await store.addScan(
        loaded.map(l => [account.id, l.folder, l.m.uid]),
        suggestions
      );
      scanned += loaded.length;
    }
  }
  return { ran: true, scanned, found };
}
