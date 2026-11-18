// Synthetic IMAP client for large-mailbox tests and the benchmark (AUD-011).
// Only generated test data, no real mail. Counts what a real server would send: UIDs in
// SEARCH responses, FETCH responses and approximate bytes on the wire.

const WORDS = [
  'Angebot',
  'Rechnung',
  'Termin',
  'Projekt',
  'Vertrag',
  'Bestellung',
  'Lieferung',
  'Besprechung',
  'Bericht',
  'Urlaub',
  'Reise',
  'Newsletter',
  'Kunde',
  'Budget',
  'Planung',
  'Freigabe'
];

/** Deterministic text for message `uid`. */
export function syntheticText(uid, chars = 1200) {
  let out = '';
  let x = uid * 2654435761;
  while (out.length < chars) {
    x = (x * 1103515245 + 12345) >>> 0;
    out += `${WORDS[(x >>> 16) % WORDS.length]} ${(x >>> 8) % 997} `;
  }
  return out.slice(0, chars);
}

/**
 * @param {number} count messages in the folder
 * @param {{ gapEvery?: number, textChars?: number, condstore?: boolean }} options
 *   `gapEvery`: every n-th UID is missing (expunged), so UIDs are sparse.
 */
export function syntheticMailbox(count, { gapEvery = 0, textChars = 1200, condstore = true } = {}) {
  const uids = [];
  for (let uid = 1; uids.length < count; uid++) if (!gapEvery || uid % gapEvery) uids.push(uid);
  const present = new Set(uids);
  const stats = { searches: 0, searchUids: 0, fetches: 0, fetchMessages: 0, bytes: 0 };
  const base = Date.UTC(2020, 0, 1);
  const envelopeOf = uid => ({
    uid,
    seq: 0,
    envelope: {
      subject: `${WORDS[uid % WORDS.length]} ${uid}`,
      from: [{ name: `Absender ${uid % 300}`, address: `absender${uid % 300}@example.invalid` }],
      to: [{ address: 'ich@example.invalid' }],
      date: new Date(base + uid * 60_000)
    },
    internalDate: new Date(base + uid * 60_000),
    flags: new Set(uid % 3 ? ['\\Seen'] : []),
    bodyStructure: { type: 'text/plain', part: '1', size: textChars }
  });
  const seqIndex = uid => uids.indexOf(uid);
  const modseq = 1000n;
  const client = {
    stats,
    uids,
    enabled: new Set(condstore ? ['CONDSTORE'] : []),
    get mailbox() {
      return {
        exists: uids.length,
        uidValidity: 4242n,
        uidNext: (uids.at(-1) || 0) + 1,
        ...(condstore ? { highestModseq: modseq } : {})
      };
    },
    async getMailboxLock() {
      return { release() {} };
    },
    async noop() {},
    async search(query) {
      stats.searches++;
      let list;
      if (query.uid) {
        const [low, high] = query.uid.split(':').map(Number);
        list = [];
        // Binary search keeps the fake fast at 100k; a real server does the same work.
        let i = lowerBound(uids, low);
        for (; i < uids.length && uids[i] <= high; i++) list.push(uids[i]);
      } else list = uids.slice();
      if (query.text) {
        const needle = String(query.text).toLowerCase();
        list = list.filter(uid => envelopeOf(uid).envelope.subject.toLowerCase().includes(needle));
      }
      if (query.seen === false) list = list.filter(uid => uid % 3 === 0);
      stats.searchUids += list.length;
      stats.bytes += 12 + list.reduce((n, uid) => n + String(uid).length + 1, 0);
      return list;
    },
    async *fetch(range, query, options = {}) {
      stats.fetches++;
      let list;
      if (Array.isArray(range)) list = range.filter(uid => present.has(uid));
      else if (range === '1:*') {
        list = options.changedSince ? [] : uids;
      } else {
        const [a, b] = String(range).split(':');
        if (options.uid) {
          const low = Number(a);
          const high = b === '*' ? Infinity : Number(b ?? a);
          list = uids.filter(uid => uid >= low && uid <= high);
        } else {
          const start = Number(a);
          const end = b === '*' ? uids.length : Number(b ?? a);
          list = uids.slice(start - 1, end);
        }
      }
      for (const uid of list) {
        stats.fetchMessages++;
        if (query.bodyParts) {
          const text = syntheticText(uid, textChars);
          stats.bytes += text.length + 40;
          yield { uid, bodyParts: new Map(query.bodyParts.map(p => [p.key, Buffer.from(text)])) };
        } else if (query.envelope) {
          stats.bytes += 400;
          const message = envelopeOf(uid);
          message.seq = seqIndex(uid) + 1;
          yield message;
        } else {
          stats.bytes += 40;
          yield { uid, flags: envelopeOf(uid).flags };
        }
      }
    },
    resetStats() {
      for (const key of Object.keys(stats)) stats[key] = 0;
    },
    expunge(uid) {
      const i = uids.indexOf(uid);
      if (i >= 0) uids.splice(i, 1);
      present.delete(uid);
    },
    append() {
      const uid = (uids.at(-1) || 0) + 1;
      uids.push(uid);
      present.add(uid);
      return uid;
    }
  };
  return client;
}

function lowerBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
