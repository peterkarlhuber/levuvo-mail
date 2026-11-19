// The local writing-style profile: how the user greets, signs off and addresses each contact
// (du/Sie), learned from mails the user sent. Opt-in (AI settings → Writing style), computed on
// this device from the encrypted search index without any model, stored encrypted (keychain key),
// deletable per contact or as a whole, never part of a backup and never sent anywhere. Reply
// suggestions get the habits for the one recipient they answer, plus a few of the user's own mails
// to that person as style samples.

const MAX_MAILS = 400;
const MAX_CONTACTS = 500;
const EMAIL = /^[^\s@<>,;]{1,64}@[^\s@<>,;]{1,255}$/;

const GREETING =
  /^(hallo|hallöchen|hi|hey|hej|servus|grüß (dich|euch|gott)|grüezi|moin|liebe[rs]?|sehr geehrte[rs]?|geehrte[rs]?|guten (morgen|tag|abend)|dear|hello|good (morning|afternoon|evening)|hiya)\b/i;
const CLOSING =
  /^(lg|glg|vlg|mfg|bg|lg und danke|liebe grüße|liebe grüsse|viele grüße|viele grüsse|beste grüße|beste grüsse|herzliche grüße|schöne grüße|freundliche grüße|mit freundlichen grüßen|mit besten grüßen|mit lieben grüßen|grüße|gruß|danke und (lg|liebe grüße|viele grüße)|danke( dir| euch| ihnen)?( schon)?( im voraus)?!?|ciao|bis bald|best|best regards|kind regards|warm regards|regards|cheers|thanks|many thanks|thank you|br|all the best|yours)\b[^\n]{0,30}$/i;

/** The part of a sent mail the user wrote: up to the quoted history or a forwarded block. */
export function ownPart(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(
      /\n(?:>|-{2,} ?(?:Original|Ursprüngliche|Weitergeleitete|Forwarded)|On .{4,200} wrote:|Am .{4,200} schrieb|Von: |From: )/
    )[0]
    .trim();
}

const lines = text =>
  text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

/** Greeting line ("Hallo Anna,"), closing line ("LG"), form of address and length of one mail. */
export function analyzeMail(text) {
  const own = ownPart(text);
  const ls = lines(own);
  const first = ls[0] || '';
  const greeting = first.length <= 60 && GREETING.test(first) ? first.replace(/\s+/g, ' ') : '';
  let closing = '';
  // The closing is one of the last lines (the name or a signature may follow it).
  for (const l of ls.slice(-6).reverse()) {
    if (l.length <= 50 && CLOSING.test(l)) {
      closing = l.replace(/\s+/g, ' ');
      break;
    }
  }
  const body = own.replace(/^.*\n/, ' ');
  const informal = (body.match(/\b(du|dich|dir|dein(e[mnrs]?)?|euch|euer|eure[mnrs]?)\b/gi) || []).length;
  // "Sie/Ihnen/Ihr" in the middle of a sentence (capitalised after a lower-case word) is the formal you.
  const formal = (body.match(/[a-zäöüß,] (Sie|Ihnen|Ihre[mnrs]?|Ihr)\b/g) || []).length;
  const address = informal > formal ? 'du' : formal > informal ? 'sie' : '';
  const words = own.split(/\s+/).filter(Boolean).length;
  return { greeting, closing, address, words };
}

function most(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best = '';
  let n = 0;
  for (const [v, c] of counts)
    if (c > n) {
      best = v;
      n = c;
    }
  return best;
}
const median = nums => {
  const s = nums.filter(n => n > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Greeting with the first name replaced, so habits can be compared across contacts. */
export function greetingPattern(greeting) {
  return greeting.replace(/^(\S+(?: (?:geehrte[rs]?|Herr|Frau|Morgen|Tag|Abend))*)\s+.+?([,!]?)$/i, '$1 …$2');
}

function summarize(items) {
  return {
    greeting: most(items.map(i => i.greeting)),
    closing: most(items.map(i => i.closing)),
    address: most(items.map(i => i.address)),
    words: median(items.map(i => i.words)),
    count: items.length,
    last:
      items
        .map(i => i.date || '')
        .sort()
        .at(-1) || ''
  };
}

/** Builds the profile of one account from its sent mails ({ to, date, text }). */
export function buildProfile(mails, ownAddresses = []) {
  const own = new Set(ownAddresses.map(a => a.toLowerCase()));
  const byContact = new Map();
  const all = [];
  for (const m of mails.slice(0, MAX_MAILS)) {
    const a = { ...analyzeMail(m.text), date: m.date };
    all.push({ ...a, greeting: a.greeting ? greetingPattern(a.greeting) : '' });
    // The main recipient is the first address that is not the user's own.
    const to = String(m.to || '')
      .toLowerCase()
      .split(/\s+/)
      .find(x => EMAIL.test(x) && !own.has(x));
    if (!to) continue;
    if (!byContact.has(to)) {
      if (byContact.size >= MAX_CONTACTS) continue;
      byContact.set(to, []);
    }
    byContact.get(to).push(a);
  }
  const contacts = {};
  for (const [email, items] of byContact) contacts[email] = summarize(items);
  return { builtAt: new Date().toISOString(), mails: all.length, overall: summarize(all), contacts };
}

/**
 * @param {object} o
 * @param {object} o.file        { get, save } (sealed JSON file, { accounts: {} })
 * @param {object} o.localIndex  local index with sentBy()
 */
export function createStyleProfiles({ file, localIndex }) {
  const data = () => file.get()?.accounts || {};
  const write = accounts => file.save({ accounts });
  return {
    persistent: file.persistent !== false,
    /** Learns (again) from the sent mail in the index. Returns the summary or null without index. */
    async learn(account, ownAddresses) {
      if (typeof localIndex?.sentBy !== 'function') return null;
      const mails = await localIndex.sentBy(account.id, ownAddresses, { limit: MAX_MAILS });
      const profile = buildProfile(mails, ownAddresses);
      // Contacts the user deleted stay deleted until they write to them again after that.
      const prev = data()[account.id];
      for (const [email, when] of Object.entries(prev?.removed || {}))
        if (profile.contacts[email] && profile.contacts[email].last <= when) delete profile.contacts[email];
      profile.removed = prev?.removed || {};
      await write({ ...data(), [account.id]: profile });
      return profile;
    },
    get: accountId => data()[accountId] || null,
    /** Habits with one recipient, or null. */
    contact(accountId, email) {
      const p = data()[accountId];
      const key = String(email || '').toLowerCase();
      return p?.contacts?.[key] ? { email: key, ...p.contacts[key] } : null;
    },
    overall: accountId => data()[accountId]?.overall || null,
    async removeContact(accountId, email) {
      const p = data()[accountId];
      const key = String(email || '').toLowerCase();
      if (!p?.contacts?.[key]) return false;
      const { [key]: gone, ...rest } = p.contacts;
      await write({
        ...data(),
        [accountId]: { ...p, contacts: rest, removed: { ...(p.removed || {}), [key]: gone.last || p.builtAt } }
      });
      return true;
    },
    async clear(accountId = null) {
      if (!accountId) return write({});
      const rest = { ...data() };
      delete rest[accountId];
      return write(rest);
    }
  };
}

/** The user's own text of their recent mails to one contact, as style samples. */
export async function contactSamples(localIndex, accountId, ownAddresses, email, limit = 3) {
  if (typeof localIndex?.sentBy !== 'function' || !EMAIL.test(String(email || ''))) return [];
  const mails = await localIndex.sentBy(accountId, ownAddresses, { limit, to: email }).catch(() => []);
  return mails.map(m => ownPart(m.text).slice(0, 1200)).filter(Boolean);
}
