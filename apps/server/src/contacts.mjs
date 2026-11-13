// Address suggestions for the composer, derived on demand from envelope headers
// of recent sent and received mail. Kept in memory only, never written to disk.
import { findSentFolder } from './send-utils.mjs';

const SCAN = 250;

async function envelopes(client, path) {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const total = Number(client.mailbox?.exists || 0);
    if (!total) return [];
    const out = [];
    for await (const m of client.fetch(`${Math.max(1, total - SCAN + 1)}:${total}`, { envelope: true })) {
      // Unsolicited FETCH responses (e.g. flag updates) carry no envelope and are skipped.
      if (m?.envelope && typeof m.envelope === 'object') out.push(m.envelope);
    }
    return out;
  } finally {
    lock.release();
  }
}

/** Frequency-ranked contacts. Recipients of own sent mail weigh more than senders. */
export async function collectContacts(client, { ownAddress, sentFolder = '' }) {
  const score = new Map();
  const own = String(ownAddress || '').toLowerCase();
  const add = (list, weight) => {
    for (const entry of Array.isArray(list) ? list : []) {
      const email = String(entry?.address || '').trim();
      if (!email || email.length > 254 || !email.includes('@') || email.toLowerCase() === own) continue;
      if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)@/i.test(email)) continue;
      const key = email.toLowerCase();
      const current = score.get(key) || { email, name: '', score: 0 };
      current.score += weight;
      const name = String(entry?.name || '').trim();
      if (name && !current.name && name.toLowerCase() !== key) current.name = name.slice(0, 120);
      score.set(key, current);
    }
  };
  const folders = await client.list();
  const sent = findSentFolder(folders, sentFolder);
  if (sent)
    for (const e of await envelopes(client, sent.path)) {
      add(e.to, 3);
      add(e.cc, 2);
      add(e.bcc, 2);
    }
  for (const e of await envelopes(client, 'INBOX')) {
    add(e.from, 1);
    add(e.replyTo, 1);
    add(e.cc, 0.5);
  }
  return [...score.values()].sort((a, b) => b.score - a.score).slice(0, 1500);
}

export function filterContacts(contacts, query, limit = 8) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (q.length < 1 || q.length > 120) return [];
  const starts = [];
  const contains = [];
  for (const c of contacts) {
    const email = c.email.toLowerCase();
    const name = c.name.toLowerCase();
    if (email.startsWith(q) || name.startsWith(q) || name.split(/\s+/).some(part => part.startsWith(q))) starts.push(c);
    else if (email.includes(q) || name.includes(q)) contains.push(c);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit).map(({ email, name }) => ({ email, name }));
}
