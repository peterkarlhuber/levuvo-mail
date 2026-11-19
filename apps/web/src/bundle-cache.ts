// Memory of the AI bundle suggestions (PERF-LEV-009). Every message sent to the model is
// remembered, also when the model returned nothing for it, so it is never sent again on the next
// list update; failed calls back off exponentially per account; the oldest entries are dropped
// first (LRU) instead of forgetting everything at once.

export type ClassifyKey = { uid: number; folder?: string; messageId?: string | null };

export function createClassifyCache<T>({
  max = 5000,
  baseDelayMs = 30_000,
  maxDelayMs = 30 * 60_000,
  now = () => Date.now()
} = {}) {
  const entries = new Map<string, T | null>();
  const failures = new Map<string, { count: number; until: number }>();
  const keyOf = (accountId: string, m: ClassifyKey) =>
    `${accountId}\u0000${m.messageId || `${m.folder || 'INBOX'}\u0000${m.uid}`}`;

  return {
    keyOf,
    /** Whether this message was already sent to the model (with or without a result). */
    known: (accountId: string, m: ClassifyKey) => entries.has(keyOf(accountId, m)),
    /** The suggestion for a message, or undefined; a hit counts as recent use. */
    get(accountId: string, m: ClassifyKey): T | undefined {
      const key = keyOf(accountId, m);
      if (!entries.has(key)) return undefined;
      const value = entries.get(key) as T | null;
      entries.delete(key);
      entries.set(key, value);
      return value ?? undefined;
    },
    /** Records the answer for every message that was sent; `null` where the model gave none. */
    settle(accountId: string, sent: ClassifyKey[], results: Map<number, T>) {
      for (const m of sent) {
        const key = keyOf(accountId, m);
        entries.delete(key);
        entries.set(key, results.get(m.uid) ?? null);
      }
      while (entries.size > max) entries.delete(entries.keys().next().value as string);
      failures.delete(accountId);
    },
    /** A failed call: no new call for this account until the backoff has passed. */
    fail(accountId: string) {
      const count = (failures.get(accountId)?.count || 0) + 1;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (count - 1));
      failures.set(accountId, { count, until: now() + delay });
    },
    /** Whether a call may be made for this account now. */
    ready: (accountId: string) => (failures.get(accountId)?.until || 0) <= now(),
    get size() {
      return entries.size;
    }
  };
}
