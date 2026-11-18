// Pure helpers of the assistant UI (no imports, unit-tested in apps/web/test).

/** Text written by the user: up to the signature, the quote attribution or the quoted text. */
export function ownPart(value: string, separators: string[]) {
  const cut = separators.map(s => value.indexOf(s)).filter(i => i >= 0);
  return cut.length ? value.slice(0, Math.min(...cut)) : value;
}

/** One hour after a timed start, the same day for an all-day event. */
export function defaultEnd(start: string, allDay: boolean) {
  if (allDay) return start.slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(start);
  if (!m) return start;
  const d = new Date(Date.UTC(2000, 0, 1, Number(m[2]) + 1, Number(m[3])));
  return Number(m[2]) >= 23 ? `${m[1]}T23:59` : `${m[1]}T${d.toISOString().slice(11, 16)}`;
}

/** Inbox bundles of the app (types.ts `Bundle`) for the assistant's categories; others stay in the inbox. */
const AI_BUNDLES: Record<string, 'newsletter' | 'invoice' | 'notification'> = {
  newsletters: 'newsletter',
  finance: 'invoice',
  notifications: 'notification'
};

/** Maps `classify` items to a bundle per UID. Mail written by a person always stays in the inbox. */
export function bundleFromClassification(items: { id?: unknown; bundle?: unknown; from_person?: unknown }[]) {
  const out = new Map<number, 'newsletter' | 'invoice' | 'notification' | null>();
  for (const item of Array.isArray(items) ? items : []) {
    const uid = Number(item?.id);
    if (!Number.isSafeInteger(uid) || uid <= 0) continue;
    out.set(uid, item.from_person === true ? null : (AI_BUNDLES[String(item.bundle)] ?? null));
  }
  return out;
}
