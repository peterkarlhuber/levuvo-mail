// Safe wrappers around ImapFlow FETCH.
//
// ImapFlow hands every untagged FETCH that arrives while a FETCH command runs to the
// result, including unsolicited updates the server pushes on its own, e.g.
// `* 7 FETCH (UID 42 FLAGS (\Seen))` after another connection marked a message read.
// `client.fetchOne()` simply returns the first of those entries, so it can return the
// wrong message or an entry without the requested fields. The helpers here only accept
// entries for the requested UID that carry every requested field.

const isObject = value => value !== null && typeof value === 'object';

/**
 * True for the stand-in Dovecot returns for a message that another connection has already
 * expunged (deleted or moved elsewhere) while this connection has not been told yet:
 * `RFC822.SIZE 0`, `INTERNALDATE` 1970-01-01, an all-NIL `ENVELOPE` and an empty body.
 * The message no longer exists, so such an entry must never be listed or opened; listed,
 * it showed up as an empty "(no subject)" row from "Unknown" that could not be deleted.
 */
export function isExpungedPlaceholder(message) {
  if (!isObject(message)) return false;
  // No real message has zero bytes.
  if (message.size === 0) return true;
  if ((Buffer.isBuffer(message.source) || message.source instanceof Uint8Array) && message.source.length === 0)
    return true;
  const date = message.internalDate;
  const epoch = date instanceof Date && date.getTime() === 0;
  const emptyEnvelope = isObject(message.envelope) && !Object.values(message.envelope).some(v => v !== undefined);
  return epoch && (emptyEnvelope || message.envelope === undefined);
}

function hasBodyPart(message, key) {
  const parts = message?.bodyParts;
  if (!(parts instanceof Map)) return false;
  const name = typeof key === 'string' ? key : key?.key;
  if (typeof name !== 'string') return false;
  return parts.has(name) || parts.has(name.toLowerCase());
}

/** True when `message` carries every field `query` asked for (the UID itself is checked separately). */
export function hasRequestedFields(message, query = {}) {
  if (!isObject(message) || isExpungedPlaceholder(message)) return false;
  if (query.source && !Buffer.isBuffer(message.source) && !(message.source instanceof Uint8Array)) return false;
  if (query.size && (!Number.isSafeInteger(message.size) || message.size < 0)) return false;
  if (query.flags && !(message.flags instanceof Set)) return false;
  if (query.envelope && !isObject(message.envelope)) return false;
  if (query.bodyStructure && !isObject(message.bodyStructure)) return false;
  if (query.internalDate && message.internalDate === undefined) return false;
  if (query.headers && message.headers === undefined) return false;
  if (Array.isArray(query.bodyParts) && !query.bodyParts.every(part => hasBodyPart(message, part))) return false;
  return true;
}

function validUid(uid) {
  return Number.isSafeInteger(uid) && uid > 0;
}

/**
 * True when `message` is a complete answer to our own UID FETCH: it has a valid UID,
 * the UID is one we asked for (when `wanted` is given) and every requested field is present.
 */
export function isRequestedFetchResult(message, query = {}, wanted = null) {
  const uid = message?.uid;
  if (!validUid(uid)) return false;
  if (wanted && !wanted.has(uid)) return false;
  return hasRequestedFields(message, query);
}

/** Builds a Set of numeric UIDs from an array or a comma separated list. */
export function uidSet(uids) {
  const list = Array.isArray(uids) ? uids : String(uids ?? '').split(',');
  return new Set(list.map(Number).filter(validUid));
}

function mergeEntry(target, entry) {
  for (const [key, value] of Object.entries(entry)) {
    if (value === undefined) continue;
    if (key === 'bodyParts' && value instanceof Map) {
      const parts = target.bodyParts instanceof Map ? target.bodyParts : new Map();
      for (const [part, data] of value) parts.set(part, data);
      target.bodyParts = parts;
    } else if (target[key] === undefined) {
      target[key] = value;
    }
  }
  return target;
}

/**
 * Replacement for `client.fetchOne(uid, query, { uid: true })` that ignores unsolicited
 * FETCH responses. Returns the entry for exactly this UID with all requested fields,
 * merging several partial entries for the same UID if needed, or null when none fits.
 * `options.optional` names requested fields whose absence is tolerated.
 */
export async function fetchUidOne(client, uid, query = {}, { optional = [] } = {}) {
  const wanted = Number(uid);
  if (!validUid(wanted)) return null;
  const fullQuery = { ...query, uid: true };
  // Fields listed in `optional` are fetched but not required for a usable answer.
  const required = { ...fullQuery };
  for (const field of optional) delete required[field];
  const matches = [];
  let gone = false;
  // Always drain the iterator: leaving it early would cut the running FETCH short.
  for await (const message of client.fetch(String(wanted), fullQuery, { uid: true })) {
    if (isObject(message) && message.uid === wanted) {
      // The message is gone on the server: nothing usable can be merged from other entries.
      if (isExpungedPlaceholder(message)) gone = true;
      else matches.push(message);
    }
  }
  if (gone) return null;
  // A complete answer wins outright; otherwise merge partial entries for this UID.
  const complete = matches.find(message => hasRequestedFields(message, required));
  if (complete) return complete;
  if (!matches.length) return null;
  // Prefer the fields of entries that carry the most data: our own answer comes first,
  // unsolicited flag updates only fill gaps.
  const merged = matches
    .slice()
    .sort((a, b) => Object.keys(b).length - Object.keys(a).length)
    .reduce((acc, entry) => mergeEntry(acc, entry), {});
  return hasRequestedFields(merged, required) ? merged : null;
}
