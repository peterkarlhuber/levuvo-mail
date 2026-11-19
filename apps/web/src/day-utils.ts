// Pure helpers of "Mein Tag" (morning briefing) and the meeting preparation. No DOM, no API: tested in
// apps/web/test/day.test.mjs.

/** Start and end of the local day of `now`, as ISO instants (what the server's range expects). */
export function localDay(now: Date = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString(), key: dayKey(now) };
}

/** YYYY-MM-DD of the local date. */
export function dayKey(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Greeting for the time of day. Returns a German source text for t(). */
export function greetingFor(now: Date = new Date()) {
  const h = now.getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Guten Tag';
  return 'Guten Abend';
}

/**
 * Whether "Mein Tag" opens by itself now: switched on, not yet shown today, and only once there is
 * something to show (accounts loaded).
 */
export function shouldAutoOpen({
  enabled,
  lastShown,
  today,
  ready
}: {
  enabled: boolean;
  lastShown: string | null;
  today: string;
  ready: boolean;
}) {
  return enabled && ready && lastShown !== today;
}

export type RankItem = {
  accountId: string;
  uid: number;
  priority: 'high' | 'normal' | 'low';
  needsReply: boolean;
  reason: string;
};
type ReplyRef = { accountId: string; uid: number };

/**
 * Applies the AI ranking to the waiting mails: mails the AI says need an answer (or are high
 * priority) come first, low-priority mails without a needed answer are moved to the end. Mails the
 * AI did not rate keep their place. Nothing is removed: the user still sees every mail.
 */
export function applyRanking<T extends ReplyRef>(replies: T[], items: RankItem[]) {
  const byKey = new Map(items.map(i => [`${i.accountId}|${i.uid}`, i]));
  const score = (r: T) => {
    const i = byKey.get(`${r.accountId}|${r.uid}`);
    if (!i) return 1;
    if (i.priority === 'high' || i.needsReply) return 0;
    return i.priority === 'low' ? 2 : 1;
  };
  return replies
    .map((r, n) => ({ r, n, s: score(r) }))
    .sort((a, b) => a.s - b.s || a.n - b.n)
    .map(({ r }) => ({ ...r, ai: byKey.get(`${r.accountId}|${r.uid}`) || null }));
}
