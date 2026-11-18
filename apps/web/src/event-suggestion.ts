// Turns a detected appointment (server: event-extract.mjs) into the calendar editor's model.
// Pure, unit-tested in apps/web/test.
// Self-contained (no runtime imports) so Node can load it directly in the unit tests.
import type { EventSuggestion } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Vienna';

export type SuggestionLabels = {
  kind: Record<EventSuggestion['kind'], string>;
  reservation: string;
  fromMail: string;
  untitled: string;
};

export type SuggestedEvent = {
  summary: string;
  allDay: boolean;
  tzid?: string;
  start: string;
  end: string;
  location: string;
  description: string;
  alarms: number[];
  attendees: [];
  rrule: null;
};

/** Instants are shown in this computer's zone; floating times are taken as they are. */
function local(value: string, floating?: boolean) {
  if (floating || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value.slice(0, 16);
  const d = new Date(value);
  return `${ymd(d)}T${hm(d)}`;
}

const PREFIXED = new Set(['flight', 'train', 'bus', 'car']);

export function suggestionToEvent(
  s: EventSuggestion,
  mail: { subject?: string; from?: { name?: string; address?: string }[] },
  labels: SuggestionLabels,
  zone: string = TZ
): SuggestedEvent {
  const title = (s.summary || mail.subject || '').trim() || labels.untitled;
  const summary = PREFIXED.has(s.kind) ? `${labels.kind[s.kind]} ${title}` : title;
  const sender = mail.from?.[0];
  const description = [
    s.reservationNumber ? `${labels.reservation}: ${s.reservationNumber}` : '',
    s.description || '',
    mail.subject
      ? `${labels.fromMail}: „${mail.subject}“${sender ? ` – ${sender.name || sender.address || ''}` : ''}`
      : ''
  ]
    .filter(Boolean)
    .join('\n\n');
  const base = { summary, location: s.location || '', description, alarms: [], attendees: [] as [], rrule: null };
  if (s.allDay) return { ...base, allDay: true, start: s.start.slice(0, 10), end: s.end.slice(0, 10) };
  const start = local(s.start, s.floating);
  let end = local(s.end, s.floating);
  if (end <= start) end = start;
  if (end === start) {
    const d = new Date(`${start}:00`);
    d.setHours(d.getHours() + 1);
    end = `${ymd(d)}T${hm(d)}`;
  }
  return { ...base, allDay: false, tzid: zone, start, end };
}
