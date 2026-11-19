// Sender screening: mail from people you have never written with waits in a "new senders"
// queue until you accept or block the sender. Decisions are stored per account in
// screening.json in the app data folder (addresses only, no message content).
// Only mail that arrives after screening was switched on is screened.

const MAX_ADDRESSES = 5000;
const MAX_CHECK = 300;
const EMAIL = /^[^\s@<>,;"]{1,64}@[^\s@<>,;"]{1,255}$/;

const fail = (message, code = 'invalid_request', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

export function normalizeEmail(value) {
  const email = String(value || '')
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email)) throw fail('Ungültige E-Mail-Adresse.');
  return email;
}

const empty = () => ({ since: null, allowed: [], blocked: [] });

/** The screening.json store: `{ accounts: { [accountId]: { since, allowed, blocked } } }`. */
export function createScreeningStore(file) {
  const all = () => ({ accounts: {}, ...file.get() });
  const read = accountId => ({ ...empty(), ...(all().accounts[accountId] || {}) });
  const write = async (accountId, entry) => {
    const data = all();
    await file.save({
      ...data,
      accounts: {
        ...data.accounts,
        [accountId]: {
          since: entry.since,
          allowed: [...new Set(entry.allowed)].slice(-MAX_ADDRESSES),
          blocked: [...new Set(entry.blocked)].slice(-MAX_ADDRESSES)
        }
      }
    });
    return read(accountId);
  };
  return {
    get: read,
    /** Starts screening for mail from now on (keeps an earlier start). */
    async start(accountId, now = new Date()) {
      const entry = read(accountId);
      if (entry.since) return entry;
      return write(accountId, { ...entry, since: now.toISOString() });
    },
    /** `allow`, `block` or `reset` (back to the queue). */
    async decide(accountId, email, decision) {
      const address = normalizeEmail(email);
      if (!['allow', 'block', 'reset'].includes(decision)) throw fail('Ungültige Entscheidung.');
      const entry = read(accountId);
      const allowed = entry.allowed.filter(e => e !== address);
      const blocked = entry.blocked.filter(e => e !== address);
      if (decision === 'allow') allowed.push(address);
      if (decision === 'block') blocked.push(address);
      return write(accountId, { ...entry, allowed, blocked });
    },
    async clear(accountId) {
      const data = all();
      const accounts = { ...data.accounts };
      delete accounts[accountId];
      await file.save({ ...data, accounts });
    }
  };
}

/** Validates the address list of POST /api/screening/check. */
export function checkInput(body) {
  const list = Array.isArray(body?.emails) ? body.emails : null;
  if (!list) throw fail('Ungültige Anfrage.');
  const emails = [];
  for (const value of list.slice(0, MAX_CHECK)) {
    try {
      emails.push(normalizeEmail(value));
    } catch {
      // ignore malformed addresses: they are never screened
    }
  }
  return [...new Set(emails)];
}

/**
 * Which of `emails` are new senders: not your own address, not accepted, not blocked and not
 * in any address book or among the people you have written to. `known` is `null` when the
 * sent-mail lookup is unavailable – then nobody is screened, so no mail is hidden by mistake.
 */
export function unknownSenders(emails, { own = [], allowed = [], blocked = [], known = null }) {
  if (!known) return [];
  const skip = new Set([...own, ...allowed, ...blocked].map(e => String(e).toLowerCase()));
  return emails.filter(e => !skip.has(e) && !known.has(e));
}

const SCAN_SENT = 1000;
const SCAN_BEFORE = 1000;

async function envelopeAddresses(client, path, { criteria = null, limit, fields }) {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    let range;
    if (criteria) {
      const ids = await client.search(criteria, { uid: true });
      const uids = (Array.isArray(ids) ? ids : []).filter(n => Number.isSafeInteger(n) && n > 0).sort((a, b) => a - b);
      if (!uids.length) return [];
      range = uids.slice(-limit).join(',');
    } else {
      const total = Number(client.mailbox?.exists || 0);
      if (!total) return [];
      range = `${Math.max(1, total - limit + 1)}:${total}`;
    }
    const out = [];
    for await (const m of client.fetch(range, { envelope: true }, criteria ? { uid: true } : undefined)) {
      // Unsolicited FETCH responses (e.g. flag updates) carry no envelope and are skipped.
      if (!m?.envelope || typeof m.envelope !== 'object') continue;
      for (const field of fields)
        for (const a of m.envelope[field] || []) if (a?.address) out.push(String(a.address).toLowerCase());
    }
    return out;
  } finally {
    lock.release();
  }
}

/**
 * Senders that count as known without a decision: everyone you have written to (recent
 * Sent folder) and everyone who wrote to your inbox before screening started.
 */
export async function knownSenders(client, { sentFolder = null, since }) {
  const known = new Set();
  if (sentFolder)
    for (const a of await envelopeAddresses(client, sentFolder, { limit: SCAN_SENT, fields: ['to', 'cc', 'bcc'] }))
      known.add(a);
  const before = new Date(since);
  if (Number.isFinite(before.getTime()))
    for (const a of await envelopeAddresses(client, 'INBOX', {
      criteria: { before },
      limit: SCAN_BEFORE,
      fields: ['from']
    }))
      known.add(a);
  return known;
}
