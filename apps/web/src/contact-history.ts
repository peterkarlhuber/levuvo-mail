// Contact history ("mini CRM"): one timeline of mails, appointments, tasks and notes about a
// person. Pure helpers (unit-tested in apps/web/test, no runtime imports).
import type { ContactMail } from './contact-card';
import type { Task } from './tasks';
import type { CalendarEvent } from './types';

export type ContactNote = { id: string; email: string; text: string; createdAt: string; updatedAt: string };
export type HistoryMail = ContactMail & { accountId?: string; accountLabel?: string; fromEmail?: string };
export type HistoryKind = 'mail' | 'event' | 'task' | 'note';
export type HistoryItem =
  | { kind: 'mail'; key: string; at: string; mail: HistoryMail }
  | { kind: 'event'; key: string; at: string; event: CalendarEvent }
  | { kind: 'task'; key: string; at: string; task: Task }
  | { kind: 'note'; key: string; at: string; note: ContactNote };

const lower = (s: string | null | undefined) =>
  String(s || '')
    .trim()
    .toLowerCase();

/** The person's addresses: trimmed, lower case, without duplicates or empty ones. */
export function historyAddresses(emails: (string | null | undefined)[]): string[] {
  return [...new Set(emails.map(lower).filter(e => /^[^\s@]+@[^\s@]+$/.test(e)))];
}

/** Whether an event involves one of the addresses (organizer or attendee). */
export function eventInvolves(e: CalendarEvent, addresses: string[]) {
  const set = new Set(addresses);
  return set.has(lower(e.organizer?.email)) || (e.attendees || []).some(a => set.has(lower(a.email)));
}

const eventAt = (e: CalendarEvent) => (e.allDay ? `${e.start}T12:00:00` : e.start);

/**
 * One timeline, newest first. Mails and events are de-duplicated (the same mail can come from two
 * address searches, a series occurrence once per start). Upcoming appointments sort at the top.
 */
export function buildTimeline(
  {
    mails = [],
    events = [],
    tasks = [],
    notes = []
  }: { mails?: HistoryMail[]; events?: CalendarEvent[]; tasks?: Task[]; notes?: ContactNote[] },
  addresses: string[]
): HistoryItem[] {
  const out: HistoryItem[] = [];
  const seen = new Set<string>();
  const once = (key: string) => (seen.has(key) ? false : (seen.add(key), true));
  for (const m of mails) {
    const key = `mail|${m.accountId || ''}|${m.folder}|${m.uid}`;
    if (m.date && once(key)) out.push({ kind: 'mail', key, at: m.date, mail: m });
  }
  for (const e of events) {
    const key = `event|${e.uid || e.url}|${e.start}`;
    if (eventInvolves(e, addresses) && once(key)) out.push({ kind: 'event', key, at: eventAt(e), event: e });
  }
  for (const t of tasks) {
    const key = `task|${t.id}`;
    if (once(key)) out.push({ kind: 'task', key, at: t.createdAt, task: t });
  }
  for (const n of notes) {
    const key = `note|${n.id}`;
    if (once(key)) out.push({ kind: 'note', key, at: n.createdAt, note: n });
  }
  const time = (s: string) => {
    const v = new Date(s).getTime();
    return Number.isFinite(v) ? v : 0;
  };
  return out.sort((a, b) => time(b.at) - time(a.at));
}

/** Count per kind, for the filter buttons. */
export function countKinds(items: HistoryItem[]): Record<HistoryKind, number> {
  const out: Record<HistoryKind, number> = { mail: 0, event: 0, task: 0, note: 0 };
  for (const i of items) out[i.kind]++;
  return out;
}
