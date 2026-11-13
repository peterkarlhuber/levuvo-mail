// Pure date/layout helpers for the calendar (unit-tested in apps/web/test).
import type { CalendarEvent } from './types';

export const DAY_MS = 86_400_000;
export const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Vienna';
export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7)); // Monday

/** Local start/end of an event as Date (all-day end is exclusive). */
export function eventRange(e: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>) {
  if (e.allDay) {
    const s = parseYmd(e.start);
    const en = parseYmd(e.end || e.start);
    return { start: s, end: en > s ? en : addDays(s, 1) };
  }
  return { start: new Date(e.start), end: new Date(e.end || e.start) };
}

/** Columns for overlapping timed events in one day. */
export function layoutDay(events: { start: Date; end: Date }[]) {
  const sorted = events
    .map((e, i) => ({ i, s: e.start.getTime(), e: Math.max(e.end.getTime(), e.start.getTime() + 15 * 60_000) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out: { col: number; cols: number }[] = new Array(events.length);
  let cluster: typeof sorted = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols: number[] = [];
    for (const item of cluster) {
      let c = cols.findIndex(end => end <= item.s);
      if (c < 0) {
        c = cols.length;
        cols.push(item.e);
      } else cols[c] = item.e;
      out[item.i] = { col: c, cols: 0 };
    }
    for (const item of cluster) out[item.i].cols = cols.length;
    cluster = [];
  };
  for (const item of sorted) {
    if (cluster.length && item.s >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = cluster.length === 1 ? item.e : Math.max(clusterEnd, item.e);
  }
  if (cluster.length) flush();
  return out;
}

/** Rounds to the nearest step in minutes (default 15). */
export const snapMinutes = (minutes: number, step = 15) =>
  Math.max(0, Math.min(24 * 60 - step, Math.round(minutes / step) * step));

/**
 * Editor model for an event moved by drag & drop: same length, new start. Timed events keep
 * their time when dropped on a day (month view) unless a new time is given.
 */
export function movedEventModel(e: CalendarEvent, target: { day: Date; minutes?: number }) {
  const { start, end } = eventRange(e);
  const length = end.getTime() - start.getTime();
  if (e.allDay) {
    const days = Math.max(1, Math.round(length / DAY_MS));
    const s = startOfDay(target.day);
    return { allDay: true, start: ymd(s), end: ymd(addDays(s, days)), tzid: null as string | null };
  }
  const minutes = target.minutes ?? start.getHours() * 60 + start.getMinutes();
  const s = new Date(
    target.day.getFullYear(),
    target.day.getMonth(),
    target.day.getDate(),
    Math.floor(minutes / 60),
    minutes % 60
  );
  const en = new Date(s.getTime() + length);
  return { allDay: false, start: `${ymd(s)}T${hm(s)}`, end: `${ymd(en)}T${hm(en)}`, tzid: TZ };
}

/** 6 weeks × 7 days for a small month overview (weeks start on Monday). */
export function monthMatrix(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const s = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(s, i));
}

/** The device calendar's built-in names follow the UI language (the server stores German names). */
export function localizeCalendars<T extends { source?: string; name: string; accountLabel?: string }>(
  list: T[],
  t: (text: string) => string
): T[] {
  return list.map(c =>
    c.source === 'local'
      ? { ...c, accountLabel: t('Auf diesem Gerät'), name: c.name === 'Persönlich' ? t('Persönlich') : c.name }
      : c
  );
}
