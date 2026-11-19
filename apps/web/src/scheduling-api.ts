// Types and calls for "Termin finden", polls/offers by e-mail and booking links (server:
// routes-scheduling.mjs).
import { getJson, postJson } from './api';

export type Slot = { start: string; end: string; free?: string[]; busy?: string[]; unknown?: string[]; all?: boolean };
export type PersonSource = {
  email: string;
  name?: string;
  source: 'own' | 'calendar' | 'microsoft' | 'google' | 'unknown';
};
export type Availability = { slots: Slot[]; people: PersonSource[]; errors: { error: string; code?: string }[] };
export type Poll = {
  id: string;
  kind: 'poll' | 'offer';
  accountId: string;
  title: string;
  minutes: number;
  location: string;
  participants: { email: string; name: string }[];
  slots: Slot[];
  votes: Record<string, { slots: number[]; none: boolean; at: string }>;
  counts: string[][];
  none: string[];
  status: 'open' | 'booked' | 'cancelled' | 'expired';
  booked: { slot: number; by?: string; at: string } | null;
  timeZone: string;
  createdAt: string;
  sentTo?: string[];
};
export type BookingLink = {
  id: string;
  accountId: string;
  title: string;
  minutes: number;
  dayStart: number;
  dayEnd: number;
  weekdays: number[];
  daysAhead: number;
  noticeHours: number;
  bufferMinutes: number;
  location: string;
  enabled: boolean;
  timeZone: string;
  lang: 'de' | 'en';
  bookings: number;
  calendar: { accountId: string; url: string } | null;
  request: { url: string; subject: string } | null;
};

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Vienna';

export const scheduling = {
  list: () => getJson<{ polls: Poll[]; links: BookingLink[] }>('/api/scheduling'),
  availability: (body: Record<string, unknown>) =>
    postJson<Availability>('/api/scheduling/availability', body, 'calendar-v1'),
  createPoll: (body: Record<string, unknown>) =>
    postJson<Poll>('/api/scheduling/polls/create', { ...body, confirm: 'SEND' }, 'calendar-v1'),
  book: (id: string, slot: number) => postJson<Poll>('/api/scheduling/polls/book', { id, slot }, 'calendar-v1'),
  cancel: (id: string) => postJson<Poll>('/api/scheduling/polls/cancel', { id }, 'calendar-v1'),
  remove: (id: string) => postJson('/api/scheduling/polls/delete', { id }, 'calendar-v1'),
  saveLink: (body: Record<string, unknown>) => postJson<BookingLink>('/api/scheduling/links/save', body, 'calendar-v1'),
  removeLink: (id: string) => postJson('/api/scheduling/links/delete', { id }, 'calendar-v1')
};

export function slotText(s: Slot, locale: string) {
  const start = new Date(s.start);
  const end = new Date(s.end);
  const day = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(start);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time.format(start)}–${time.format(end)}`;
}
