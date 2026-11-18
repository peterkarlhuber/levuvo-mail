// Pure helpers for the reader's contact card (unit-tested in apps/web/test, no runtime imports).
import type { CalendarEvent, Contact } from './types';

export type ContactMail = {
  accountId?: string;
  folder: string;
  uid: number;
  subject: string;
  date: string | null;
  fromEmail?: string;
  hasAttachments?: boolean;
};

const same = (a: string | undefined | null, b: string) =>
  String(a || '')
    .trim()
    .toLowerCase() === b;

/** The address book entry with this email address (the most complete one if there are several). */
export function pickContact(contacts: Contact[], email: string): Contact | null {
  const wanted = email.trim().toLowerCase();
  const matches = contacts.filter(c => (c.emails || []).some(e => same(e.value, wanted)));
  if (!matches.length) return null;
  const score = (c: Contact) =>
    (c.name ? 2 : 0) + (c.organization ? 1 : 0) + (c.title ? 1 : 0) + (c.phones?.length ? 1 : 0) + (c.note ? 1 : 0);
  return [...matches].sort((a, b) => score(b) - score(a))[0];
}

/** Events where the person is organizer or attendee: next ones first, then the latest past ones. */
export function sharedEvents(
  events: CalendarEvent[],
  email: string,
  now = new Date(),
  limit = { upcoming: 3, past: 2 }
) {
  const wanted = email.trim().toLowerCase();
  const end = (e: CalendarEvent) =>
    e.allDay ? new Date(`${e.end || e.start}T00:00:00`).getTime() : new Date(e.end || e.start).getTime();
  const start = (e: CalendarEvent) =>
    e.allDay ? new Date(`${e.start}T00:00:00`).getTime() : new Date(e.start).getTime();
  const seen = new Set<string>();
  const mine = events.filter(e => {
    if (!(same(e.organizer?.email, wanted) || (e.attendees || []).some(a => same(a.email, wanted)))) return false;
    const key = `${e.uid || e.url}|${e.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const t = now.getTime();
  const upcoming = mine
    .filter(e => end(e) >= t)
    .sort((a, b) => start(a) - start(b))
    .slice(0, limit.upcoming);
  const past = mine
    .filter(e => end(e) < t)
    .sort((a, b) => start(b) - start(a))
    .slice(0, limit.past);
  return { upcoming, past };
}
