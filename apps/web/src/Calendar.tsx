import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCcw,
  Repeat,
  Users,
  X
} from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { CloudConsentBanner, isConsentError, type CloudError } from './CloudConsent';
import { usePrefs, type Prefs } from './prefs';
import type { AccountItem, ApiStatus, CalendarEvent, CalendarInfo } from './types';
import {
  addDays,
  DAY_MS,
  eventRange,
  hm,
  layoutDay,
  localizeCalendars,
  monthMatrix,
  movedEventModel,
  parseYmd,
  snapMinutes,
  startOfDay,
  startOfWeek,
  TZ,
  ymd
} from './calendar-utils';

type View = Prefs['calendarView'];
const HOUR_PX = 48;

type Draft = {
  event?: CalendarEvent;
  calendar: string;
  summary: string;
  location: string;
  description: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeat: '' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byday: string[];
  endMode: 'never' | 'count' | 'until';
  count: number;
  until: string;
  alarms: number[];
  attendees: string;
  notify: boolean;
};
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

function draftFrom(e: CalendarEvent | null, start: Date, allDay: boolean, calendar: string): Draft {
  if (e) {
    const r = eventRange(e);
    const endInclusive = e.allDay ? addDays(r.end, -1) : r.end;
    return {
      event: e,
      calendar: `${e.accountId}|${e.calendarUrl}`,
      summary: e.summary,
      location: e.location,
      description: e.description,
      allDay: e.allDay,
      startDate: ymd(r.start),
      startTime: hm(r.start),
      endDate: ymd(endInclusive),
      endTime: hm(r.end),
      repeat: (e.rrule?.freq as Draft['repeat']) || '',
      interval: e.rrule?.interval || 1,
      byday: e.rrule?.byday || [],
      endMode: e.rrule?.count ? 'count' : e.rrule?.until ? 'until' : 'never',
      count: e.rrule?.count || 10,
      until: e.rrule?.until || '',
      alarms: e.alarms,
      attendees: e.attendees
        .map(a => a.email)
        .filter(a => a !== e.organizer?.email)
        .join(', '),
      notify: e.attendees.length > 0
    };
  }
  const end = new Date(start.getTime() + 60 * 60_000);
  return {
    calendar,
    summary: '',
    location: '',
    description: '',
    allDay,
    startDate: ymd(start),
    startTime: hm(start),
    endDate: ymd(allDay ? start : end),
    endTime: hm(end),
    repeat: '',
    interval: 1,
    byday: [WEEKDAYS[(start.getDay() + 6) % 7]],
    endMode: 'never',
    count: 10,
    until: '',
    alarms: allDay ? [] : [15],
    attendees: '',
    notify: true
  };
}

function ScopeDialog({ title, onChoose }: { title: string; onChoose: (scope: 'this' | 'all' | null) => void }) {
  const { t } = useT();
  return (
    <div
      className="modal-scrim confirm-scrim"
      role="presentation"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onChoose(null);
      }}
    >
      <div
        className="confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={e => {
          if (e.key === 'Escape') onChoose(null);
        }}
      >
        <h2>{title}</h2>
        <p>{t('Dieser Termin gehört zu einer Serie.')}</p>
        <div className="confirm-actions vertical">
          <button className="btn primary" autoFocus onClick={() => onChoose('this')}>
            {t('Nur diesen Termin')}
          </button>
          <button className="btn" onClick={() => onChoose('all')}>
            {t('Alle Termine der Serie')}
          </button>
          <button className="btn" onClick={() => onChoose(null)}>
            {t('Abbrechen')}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventEditor({
  draft: initial,
  calendars,
  ownAddresses,
  onClose,
  onSaved
}: {
  draft: Draft;
  calendars: CalendarInfo[];
  ownAddresses: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scopeFor, setScopeFor] = useState<null | 'save' | 'delete'>(null);
  const e = d.event;
  const writable = calendars.filter(c => !c.readOnly);
  const cal = calendars.find(c => `${c.accountId}|${c.url}` === d.calendar);
  const invitedByOther = Boolean(
    e?.organizer && e.attendees.length && !ownAddresses.includes(e.organizer.email.toLowerCase())
  );
  const readOnly = Boolean(cal?.readOnly) || invitedByOther;
  const set = (patch: Partial<Draft>) => setD(old => ({ ...old, ...patch }));
  const attendeeList = d.attendees
    .split(/[\s,;]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  function model() {
    const endDate = d.allDay ? ymd(addDays(parseYmd(d.endDate), 1)) : d.endDate;
    return {
      summary: d.summary.trim(),
      location: d.location,
      description: d.description,
      allDay: d.allDay,
      tzid: d.allDay ? undefined : e?.tzid || TZ,
      start: d.allDay ? d.startDate : `${d.startDate}T${d.startTime}`,
      end: d.allDay ? endDate : `${endDate}T${d.endTime}`,
      rrule: d.repeat
        ? {
            freq: d.repeat,
            interval: d.interval,
            byday: d.repeat === 'WEEKLY' ? d.byday : [],
            count: d.endMode === 'count' ? d.count : null,
            until: d.endMode === 'until' ? d.until : null
          }
        : null,
      alarms: d.alarms,
      attendees: attendeeList.map(email => ({
        email,
        name: '',
        partstat: e?.attendees.find(a => a.email === email)?.partstat || 'NEEDS-ACTION'
      }))
    };
  }
  async function save(scope?: 'this' | 'all') {
    if (!d.summary.trim()) {
      setError(t('Bitte einen Titel eingeben.'));
      return;
    }
    const m = model();
    if (m.end < m.start || (!d.allDay && m.end === m.start)) {
      setError(t('Das Ende muss nach dem Beginn liegen.'));
      return;
    }
    const bad = attendeeList.find(a => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
    if (bad) {
      setError(t('Ungültige Adresse: {address}', { address: bad }));
      return;
    }
    const [accountId, ...rest] = d.calendar.split('|');
    // Another calendar chosen for an existing event: it moves there (as a whole).
    const moving = Boolean(e) && d.calendar !== `${e!.accountId}|${e!.calendarUrl}`;
    if (e?.recurring && !scope && !moving) {
      setScopeFor('save');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await postJson<{ invited: number }>(
        '/api/calendar/events/save',
        {
          accountId: e?.accountId || accountId,
          calendarUrl: rest.join('|'),
          url: e?.url,
          etag: e?.etag,
          scope: scope || 'all',
          recurrenceId: e?.recurrenceId || null,
          seriesId: e?.seriesId || null,
          ...(e ? { targetAccountId: accountId, sourceCalendarUrl: e.calendarUrl } : {}),
          organizer: e?.organizer?.email,
          event: scope === 'this' ? { ...m, rrule: null } : m,
          notify: d.notify && attendeeList.length > 0
        },
        'calendar-v1'
      );
      toast({
        text: r.invited
          ? t('Gespeichert. Einladungen gesendet: {count}.', { count: r.invited })
          : t('Termin gespeichert.'),
        kind: 'success'
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(scope?: 'this' | 'all') {
    if (!e) return;
    if (e.recurring && !scope) {
      setScopeFor('delete');
      return;
    }
    if (
      !e.recurring &&
      !(await confirm({ title: t('Termin löschen?'), message: e.summary, confirmLabel: t('Löschen'), danger: true }))
    )
      return;
    const notify =
      !invitedByOther &&
      e.attendees.length > 0 &&
      scope !== 'this' &&
      (await confirm({
        title: t('Absage senden?'),
        message: t('Die Teilnehmenden per E-Mail über die Absage informieren?'),
        confirmLabel: t('Absage senden'),
        cancelLabel: t('Ohne Nachricht')
      }));
    setBusy(true);
    try {
      await postJson(
        '/api/calendar/events/delete',
        {
          accountId: e.accountId,
          url: e.url,
          etag: e.etag,
          calendarUrl: e.calendarUrl,
          seriesId: e.seriesId || null,
          scope: scope || 'all',
          recurrenceId: e.recurrenceId,
          notify
        },
        'calendar-v1'
      );
      toast({ text: t('Termin gelöscht.'), kind: 'success' });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  const alarmOptions = [0, 5, 10, 15, 30, 60, 120, 1440, 2880];
  const alarmLabel = (m: number) =>
    m === 0
      ? t('Zum Beginn')
      : m < 60
        ? t('{n} Minuten vorher', { n: m })
        : m < 1440
          ? t('{n} Stunden vorher', { n: m / 60 })
          : t('{n} Tage vorher', { n: m / 1440 });
  const dayNames = WEEKDAYS.map((_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2024, 0, 1 + i))
  );

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={ev => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <form
        className="modal-card event-editor"
        role="dialog"
        aria-modal="true"
        aria-label={e ? t('Termin bearbeiten') : t('Neuer Termin')}
        onSubmit={ev => {
          ev.preventDefault();
          if (!readOnly) void save();
        }}
        onKeyDown={ev => {
          if (ev.key === 'Escape' && !scopeFor) {
            ev.stopPropagation();
            onClose();
          }
        }}
      >
        <header>
          <h2>{e ? (readOnly ? t('Termin') : t('Termin bearbeiten')) : t('Neuer Termin')}</h2>
          <button type="button" className="icon-button" aria-label={t('Schließen')} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {invitedByOther && (
          <p className="managed-hint">
            {t(
              'Einladung von {name}. Änderungen nimmt der Organisator vor; deine Antwort gibst du in der Einladungs-E-Mail.',
              { name: e?.organizer?.name || e?.organizer?.email || '' }
            )}
          </p>
        )}
        <fieldset disabled={readOnly || busy}>
          <input
            className="event-title"
            aria-label={t('Titel')}
            placeholder={t('Titel')}
            value={d.summary}
            autoFocus={!e}
            maxLength={300}
            onChange={ev => set({ summary: ev.target.value })}
          />
          <div className="event-grid">
            <label>
              {t('Kalender')}
              <select
                value={d.calendar}
                onChange={ev => set({ calendar: ev.target.value })}
                disabled={readOnly}
                title={e ? t('Einen anderen Kalender wählen, um den Termin dorthin zu verschieben.') : undefined}
              >
                {(readOnly ? calendars : writable).map(c => (
                  <option key={`${c.accountId}|${c.url}`} value={`${c.accountId}|${c.url}`}>
                    {c.name}
                    {c.accountLabel ? ` · ${c.accountLabel}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={d.allDay} onChange={ev => set({ allDay: ev.target.checked })} />{' '}
              {t('Ganztägig')}
            </label>
            <label>
              {t('Beginn')}
              <span className="date-time">
                <input
                  type="date"
                  required
                  value={d.startDate}
                  onChange={ev => {
                    const delta = parseYmd(ev.target.value).getTime() - parseYmd(d.startDate).getTime();
                    set({ startDate: ev.target.value, endDate: ymd(new Date(parseYmd(d.endDate).getTime() + delta)) });
                  }}
                />
                {!d.allDay && (
                  <input
                    type="time"
                    required
                    value={d.startTime}
                    onChange={ev => set({ startTime: ev.target.value })}
                  />
                )}
              </span>
            </label>
            <label>
              {t('Ende')}
              <span className="date-time">
                <input type="date" required value={d.endDate} onChange={ev => set({ endDate: ev.target.value })} />
                {!d.allDay && (
                  <input type="time" required value={d.endTime} onChange={ev => set({ endTime: ev.target.value })} />
                )}
              </span>
            </label>
            {!d.allDay && <small className="muted">{t('Zeitzone: {tz}', { tz: e?.tzid || TZ })}</small>}
          </div>
          <label>
            {t('Ort')}
            <input value={d.location} maxLength={500} onChange={ev => set({ location: ev.target.value })} />
          </label>
          <div className="event-grid">
            <label>
              {t('Wiederholung')}
              <select value={d.repeat} onChange={ev => set({ repeat: ev.target.value as Draft['repeat'] })}>
                <option value="">{t('Keine')}</option>
                <option value="DAILY">{t('Täglich')}</option>
                <option value="WEEKLY">{t('Wöchentlich')}</option>
                <option value="MONTHLY">{t('Monatlich')}</option>
                <option value="YEARLY">{t('Jährlich')}</option>
              </select>
            </label>
            {d.repeat && (
              <label>
                {t('Intervall')}
                <span className="date-time">
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={d.interval}
                    onChange={ev => set({ interval: Math.max(1, Math.min(99, Number(ev.target.value) || 1)) })}
                  />
                  <span>
                    {d.repeat === 'DAILY'
                      ? t('Tage')
                      : d.repeat === 'WEEKLY'
                        ? t('Wochen')
                        : d.repeat === 'MONTHLY'
                          ? t('Monate')
                          : t('Jahre')}
                  </span>
                </span>
              </label>
            )}
          </div>
          {d.repeat === 'WEEKLY' && (
            <div className="weekday-picker" role="group" aria-label={t('Wochentage')}>
              {WEEKDAYS.map((w, i) => (
                <button
                  type="button"
                  key={w}
                  className={d.byday.includes(w) ? 'active' : ''}
                  aria-pressed={d.byday.includes(w)}
                  onClick={() => set({ byday: d.byday.includes(w) ? d.byday.filter(x => x !== w) : [...d.byday, w] })}
                >
                  {dayNames[i]}
                </button>
              ))}
            </div>
          )}
          {d.repeat && (
            <div className="event-grid">
              <label>
                {t('Endet')}
                <select value={d.endMode} onChange={ev => set({ endMode: ev.target.value as Draft['endMode'] })}>
                  <option value="never">{t('Nie')}</option>
                  <option value="count">{t('Nach Anzahl')}</option>
                  <option value="until">{t('Am Datum')}</option>
                </select>
              </label>
              {d.endMode === 'count' && (
                <label>
                  {t('Anzahl')}
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={d.count}
                    onChange={ev => set({ count: Math.max(1, Math.min(999, Number(ev.target.value) || 1)) })}
                  />
                </label>
              )}
              {d.endMode === 'until' && (
                <label>
                  {t('Bis')}
                  <input
                    type="date"
                    value={d.until}
                    min={d.startDate}
                    onChange={ev => set({ until: ev.target.value })}
                  />
                </label>
              )}
            </div>
          )}
          <label>
            {t('Erinnerung')}
            <select
              value={d.alarms[0] ?? ''}
              onChange={ev => set({ alarms: ev.target.value === '' ? [] : [Number(ev.target.value)] })}
            >
              <option value="">{t('Keine')}</option>
              {alarmOptions.map(m => (
                <option key={m} value={m}>
                  {alarmLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Teilnehmende (E-Mail-Adressen)')}
            <input
              value={d.attendees}
              placeholder="anna@firma.at, ben@kunde.at"
              onChange={ev => set({ attendees: ev.target.value })}
            />
          </label>
          {e && e.attendees.length > 0 && (
            <ul className="attendee-list">
              {e.attendees.map(a => (
                <li key={a.email}>
                  <span className={`partstat ${a.partstat.toLowerCase()}`} />
                  {a.name || a.email}
                  <small>
                    {(
                      { ACCEPTED: t('Zugesagt'), DECLINED: t('Abgesagt'), TENTATIVE: t('Vielleicht') } as Record<
                        string,
                        string
                      >
                    )[a.partstat] || t('Offen')}
                  </small>
                </li>
              ))}
            </ul>
          )}
          {attendeeList.length > 0 && (
            <label className="toggle">
              <input type="checkbox" checked={d.notify} onChange={ev => set({ notify: ev.target.checked })} />{' '}
              {e ? t('Aktualisierung per E-Mail senden') : t('Einladung per E-Mail senden')}
            </label>
          )}
          <label>
            {t('Beschreibung')}
            <textarea
              rows={4}
              maxLength={10_000}
              value={d.description}
              onChange={ev => set({ description: ev.target.value })}
            />
          </label>
        </fieldset>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <footer className="event-actions">
          {e && !cal?.readOnly && (
            <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
              {t('Löschen')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            {readOnly ? t('Schließen') : t('Abbrechen')}
          </button>
          {!readOnly && (
            <button type="submit" className="btn primary" disabled={busy || !writable.length}>
              {busy ? <LoaderCircle size={15} className="spin" /> : null} {t('Speichern')}
            </button>
          )}
        </footer>
        {scopeFor && (
          <ScopeDialog
            title={scopeFor === 'save' ? t('Änderung speichern') : t('Termin löschen')}
            onChoose={scope => {
              const which = scopeFor;
              setScopeFor(null);
              if (scope) void (which === 'save' ? save(scope) : remove(scope));
            }}
          />
        )}
      </form>
    </div>
  );
}

export default function CalendarModule({
  accounts,
  onOpenSettings
}: {
  accounts: AccountItem[];
  onOpenSettings: () => void;
}) {
  const { t, locale } = useT();
  const { toast, confirm } = useUi();
  const [prefs, setPrefs] = usePrefs();
  const drag = useRef<{ e: CalendarEvent; grab: number } | null>(null);
  const [dropOn, setDropOn] = useState('');
  const [miniMonth, setMiniMonth] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState<View>(prefs.calendarView);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [cloudErrors, setCloudErrors] = useState<CloudError[]>([]);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Draft | null>(null);
  const [own, setOwn] = useState<string[]>([]);
  const [now, setNow] = useState(() => new Date());
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => setMiniMonth(anchor), [anchor]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    void Promise.all(accounts.map(a => getJson<ApiStatus>('/api/status', a.id).catch(() => null))).then(list =>
      setOwn(list.flatMap(s => s?.identities || []).map(i => i.email.toLowerCase()))
    );
  }, [accounts]);

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor, to: addDays(anchor, 1), days: [anchor] };
    if (view === 'week') {
      const s = startOfWeek(anchor);
      return { from: s, to: addDays(s, 7), days: Array.from({ length: 7 }, (_, i) => addDays(s, i)) };
    }
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const s = startOfWeek(first);
      return { from: s, to: addDays(s, 42), days: Array.from({ length: 42 }, (_, i) => addDays(s, i)) };
    }
    return { from: anchor, to: addDays(anchor, 60), days: [] };
  }, [view, anchor]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const cals = await getJson<{ calendars: CalendarInfo[]; errors?: CloudError[] }>('/api/calendar/calendars');
      setCalendars(localizeCalendars(cals.calendars, t));
      setCloudErrors(cals.errors || []);
      if (!cals.calendars.length) {
        setEvents([]);
        setErrors((cals.errors || []).filter(e => !isConsentError(e)).map(e => e.error));
        return;
      }
      const data = await getJson<{ events: CalendarEvent[]; errors?: CloudError[] }>(
        `/api/calendar/events?from=${range.from.toISOString()}&to=${range.to.toISOString()}`
      );
      setEvents(data.events);
      setErrors(
        [...(cals.errors || []), ...(data.errors || [])]
          .filter(e => !isConsentError(e))
          .map(e => (e.calendar ? `${e.calendar}: ${e.error}` : e.error))
      );
    } catch (e) {
      setErrors([(e as Error).message]);
      setCalendars(c => c ?? []);
    } finally {
      setBusy(false);
    }
  }, [range.from, range.to, t]);
  useEffect(() => {
    void load();
  }, [load]);
  // Scroll the time grid to the working day, or earlier when an event starts before.
  const scrolledFor = useRef('');
  useEffect(() => {
    if ((view !== 'week' && view !== 'day') || !grid.current) return;
    const key = `${view}|${ymd(range.from)}|${events.length > 0}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    const firstHour = Math.min(
      8,
      ...events
        .filter(e => !e.allDay)
        .map(e => new Date(e.start))
        .filter(d => d >= range.from && d < range.to)
        .map(d => d.getHours())
    );
    grid.current.scrollTo({ top: HOUR_PX * Math.max(0, firstHour - 0.5) });
  }, [view, range.from, range.to, events]);

  const changeView = (v: View) => {
    setView(v);
    setPrefs({ calendarView: v });
  };
  const step = (dir: number) =>
    setAnchor(a =>
      view === 'day'
        ? addDays(a, dir)
        : view === 'week'
          ? addDays(a, 7 * dir)
          : view === 'month'
            ? new Date(a.getFullYear(), a.getMonth() + dir, 1)
            : addDays(a, 30 * dir)
    );
  const firstWritable = calendars?.find(c => !c.readOnly && !c.hidden) || calendars?.find(c => !c.readOnly);
  const openNew = (start: Date, allDay = false) => {
    if (!firstWritable) {
      toast({ text: t('Kein beschreibbarer Kalender verbunden.'), kind: 'error' });
      return;
    }
    setEditor(draftFrom(null, start, allDay, `${firstWritable.accountId}|${firstWritable.url}`));
  };
  const openEvent = (e: CalendarEvent) =>
    setEditor(draftFrom(e, new Date(), e.allDay, `${e.accountId}|${e.calendarUrl}`));

  // Drag & drop: move single events (series are changed in the editor with a choice of scope).
  const canMove = (e: CalendarEvent) =>
    !e.recurring &&
    !calendars?.find(c => c.accountId === e.accountId && c.url === e.calendarUrl)?.readOnly &&
    !(e.organizer && e.attendees.length && !own.includes(e.organizer.email.toLowerCase()));
  const dragProps = (e: CalendarEvent) =>
    canMove(e)
      ? {
          draggable: true,
          onDragStart: (ev: React.DragEvent<HTMLElement>) => {
            const r = ev.currentTarget.getBoundingClientRect();
            drag.current = { e, grab: ((ev.clientY - r.top) / HOUR_PX) * 60 };
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', e.summary);
          },
          onDragEnd: () => {
            drag.current = null;
            setDropOn('');
          }
        }
      : {};
  const dropProps = (
    key: string,
    target: (
      ev: React.DragEvent<HTMLElement>,
      dragged: { e: CalendarEvent; grab: number }
    ) => { day: Date; minutes?: number } | null
  ) => ({
    onDragOver: (ev: React.DragEvent<HTMLElement>) => {
      if (!drag.current) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      if (dropOn !== key) setDropOn(key);
    },
    onDragLeave: (ev: React.DragEvent<HTMLElement>) => {
      if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setDropOn(d => (d === key ? '' : d));
    },
    onDrop: (ev: React.DragEvent<HTMLElement>) => {
      const dragged = drag.current;
      drag.current = null;
      setDropOn('');
      if (!dragged) return;
      ev.preventDefault();
      const to = target(ev, dragged);
      if (to) void moveEvent(dragged.e, to);
    }
  });
  async function moveEvent(e: CalendarEvent, target: { day: Date; minutes?: number }, undo = false) {
    const m = movedEventModel(e, target);
    const before = eventRange(e);
    if ((e.allDay ? e.start : `${ymd(before.start)}T${hm(before.start)}`) === m.start) return;
    if (e.allDay !== m.allDay) return;
    const notify =
      !undo &&
      e.attendees.length > 0 &&
      (await confirm({
        title: t('Teilnehmende informieren?'),
        message: t('Die neue Zeit per E-Mail an alle Teilnehmenden senden?'),
        confirmLabel: t('Senden'),
        cancelLabel: t('Ohne Nachricht')
      }));
    setEvents(list =>
      list.map(x =>
        x === e
          ? {
              ...x,
              start: m.allDay ? m.start : new Date(m.start).toISOString(),
              end: m.allDay ? m.end : new Date(m.end).toISOString()
            }
          : x
      )
    );
    try {
      await postJson(
        '/api/calendar/events/save',
        {
          accountId: e.accountId,
          calendarUrl: e.calendarUrl,
          url: e.url,
          etag: undo ? undefined : e.etag,
          scope: 'all',
          recurrenceId: null,
          seriesId: null,
          organizer: e.organizer?.email,
          event: {
            summary: e.summary,
            allDay: m.allDay,
            tzid: m.tzid,
            start: m.start,
            end: m.end,
            location: e.location,
            description: e.description,
            rrule: null,
            attendees: e.attendees,
            alarms: e.alarms
          },
          notify
        },
        'calendar-v1'
      );
      if (!undo)
        toast({
          text: t('„{title}“ verschoben.', { title: e.summary || t('(Ohne Titel)') }),
          kind: 'success',
          action: {
            label: t('Rückgängig'),
            run: () =>
              void moveEvent(
                {
                  ...e,
                  ...m,
                  start: m.allDay ? m.start : new Date(m.start).toISOString(),
                  end: m.allDay ? m.end : new Date(m.end).toISOString()
                },
                { day: before.start, minutes: before.start.getHours() * 60 + before.start.getMinutes() },
                true
              )
          }
        });
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    }
    void load();
  }
  async function toggleCalendar(c: CalendarInfo) {
    setCalendars(list => list?.map(x => (x === c ? { ...x, hidden: !x.hidden } : x)) || null);
    await postJson(
      '/api/calendar/calendars/update',
      { accountId: c.accountId, url: c.url, hidden: !c.hidden },
      'calendar-v1'
    ).catch(() => {});
    void load();
  }

  const title =
    view === 'month'
      ? new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(anchor)
      : view === 'day'
        ? new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(
            anchor
          )
        : view === 'week'
          ? (() => {
              const s = range.days[0];
              const e = range.days[6];
              const f = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
              return `${f.format(s)} – ${f.format(e)} ${e.getFullYear()}`;
            })()
          : t('Ab {date}', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(anchor) });
  const timeFmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const ranged = events.map(e => ({ e, ...eventRange(e) }));
  const onDay = (day: Date) => ranged.filter(x => x.start < addDays(day, 1) && x.end > day);

  if (calendars === null)
    return (
      <div className="module-loading">
        <LoaderCircle className="spin" size={18} />
      </div>
    );
  if (!calendars.length)
    return (
      <div className="empty-module">
        <CalendarDays size={34} />
        <h2>
          {t('Kalender verbinden')}
          <span className="period">.</span>
        </h2>
        <p>
          {t(
            'Microsoft 365 und Google werden über das angemeldete E-Mail-Konto eingebunden. Andere Anbieter verbindest du per CalDAV – z. B. Nextcloud, mailbox.org, iCloud, Fastmail oder Posteo.'
          )}
        </p>
        <CloudConsentBanner errors={cloudErrors} onDone={load} />
        {errors.length > 0 && <p className="modal-error">{errors[0]}</p>}
        <button className="btn primary" onClick={onOpenSettings}>
          {t('Kalender-Konto verbinden')}
        </button>
      </div>
    );

  const timeGrid = (days: Date[]) => (
    <div className="time-grid-wrap">
      <div className="time-grid-head" style={{ '--days': days.length } as CSSProperties}>
        <span />
        {days.map(d => (
          <button
            key={ymd(d)}
            className={`day-head ${ymd(d) === ymd(now) ? 'today' : ''}`}
            onClick={() => {
              setAnchor(d);
              changeView('day');
            }}
          >
            <small>{new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)}</small>
            <strong>{d.getDate()}</strong>
          </button>
        ))}
        <span className="allday-label">{t('ganztägig')}</span>
        {days.map(d => (
          <div
            key={ymd(d)}
            className={`allday-cell ${dropOn === `a${ymd(d)}` ? 'drop-target' : ''}`}
            onDoubleClick={() => openNew(d, true)}
            {...dropProps(`a${ymd(d)}`, (_ev, dragged) => (dragged.e.allDay ? { day: d } : null))}
          >
            {onDay(d)
              .filter(x => x.e.allDay || x.end.getTime() - x.start.getTime() >= DAY_MS)
              .map(x => (
                <button
                  key={`${x.e.uid}${x.e.recurrenceId || ''}`}
                  {...dragProps(x.e)}
                  className="event-chip"
                  style={{ '--c': x.e.color } as CSSProperties}
                  onClick={() => openEvent(x.e)}
                >
                  {x.e.summary}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="time-grid" ref={grid} style={{ '--days': days.length } as CSSProperties}>
        <div className="hours">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} style={{ top: h * HOUR_PX }}>
              {h ? timeFmt.format(new Date(2024, 0, 1, h)) : ''}
            </span>
          ))}
        </div>
        {days.map(day => {
          const timed = onDay(day).filter(x => !x.e.allDay && x.end.getTime() - x.start.getTime() < DAY_MS);
          const layout = layoutDay(
            timed.map(x => ({
              start: x.start < day ? day : x.start,
              end: x.end > addDays(day, 1) ? addDays(day, 1) : x.end
            }))
          );
          return (
            <div
              key={ymd(day)}
              className={`day-column ${dropOn === `t${ymd(day)}` ? 'drop-target' : ''}`}
              {...dropProps(`t${ymd(day)}`, (ev, dragged) => {
                if (dragged.e.allDay) return null;
                const y = ev.clientY - ev.currentTarget.getBoundingClientRect().top;
                return { day, minutes: snapMinutes((y / HOUR_PX) * 60 - dragged.grab) };
              })}
              onClick={ev => {
                if (ev.target !== ev.currentTarget) return;
                const y = ev.nativeEvent.offsetY;
                const minutes = Math.floor((y / HOUR_PX) * 2) * 30;
                openNew(
                  new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60)
                );
              }}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="hour-line" style={{ top: h * HOUR_PX }} />
              ))}
              {ymd(day) === ymd(now) && (
                <span className="now-line" style={{ top: (now.getHours() + now.getMinutes() / 60) * HOUR_PX }} />
              )}
              {timed.map((x, i) => {
                const s = x.start < day ? day : x.start;
                const e = x.end > addDays(day, 1) ? addDays(day, 1) : x.end;
                const top = ((s.getTime() - day.getTime()) / 3_600_000) * HOUR_PX;
                const height = Math.max(20, ((e.getTime() - s.getTime()) / 3_600_000) * HOUR_PX - 2);
                const l = layout[i];
                return (
                  <button
                    key={`${x.e.uid}${x.e.recurrenceId || ''}${i}`}
                    {...dragProps(x.e)}
                    className="event-block"
                    title={x.e.summary}
                    style={
                      {
                        top,
                        height,
                        left: `calc(${(l.col / l.cols) * 100}% + 2px)`,
                        width: `calc(${100 / l.cols}% - 4px)`,
                        '--c': x.e.color
                      } as CSSProperties
                    }
                    onClick={() => openEvent(x.e)}
                  >
                    <strong>{x.e.summary || t('(Ohne Titel)')}</strong>
                    <small>
                      {timeFmt.format(x.start)}
                      {height > 34 && x.e.location ? ` · ${x.e.location}` : ''}
                    </small>
                    {x.e.recurring && <Repeat size={10} className="event-icon" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );

  const month = (
    <div className="month-grid">
      {range.days.slice(0, 7).map(d => (
        <div key={`h${ymd(d)}`} className="month-head">
          {new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d)}
        </div>
      ))}
      {range.days.map(d => {
        const list = onDay(d).sort(
          (a, b) => Number(b.e.allDay) - Number(a.e.allDay) || a.start.getTime() - b.start.getTime()
        );
        return (
          <div
            key={ymd(d)}
            className={`month-cell ${d.getMonth() !== anchor.getMonth() ? 'outside' : ''} ${ymd(d) === ymd(now) ? 'today' : ''} ${dropOn === `m${ymd(d)}` ? 'drop-target' : ''}`}
            {...dropProps(`m${ymd(d)}`, () => ({ day: d }))}
            onDoubleClick={ev => {
              if (ev.target === ev.currentTarget)
                openNew(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9), false);
            }}
          >
            <button
              className="month-day"
              onClick={() => {
                setAnchor(d);
                changeView('day');
              }}
            >
              {d.getDate()}
            </button>
            {list.slice(0, 3).map(x => (
              <button
                key={`${x.e.uid}${x.e.recurrenceId || ''}`}
                {...dragProps(x.e)}
                className={`event-chip ${x.e.allDay ? '' : 'timed'}`}
                style={{ '--c': x.e.color } as CSSProperties}
                onClick={() => openEvent(x.e)}
              >
                {!x.e.allDay && <span className="chip-time">{timeFmt.format(x.start)}</span>}
                {x.e.summary}
              </button>
            ))}
            {list.length > 3 && (
              <button
                className="more-chip"
                onClick={() => {
                  setAnchor(d);
                  changeView('day');
                }}
              >
                {t('+{count} weitere', { count: list.length - 3 })}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  const agendaDays = Array.from({ length: 60 }, (_, i) => addDays(anchor, i))
    .map(d => ({ d, list: onDay(d).sort((a, b) => a.start.getTime() - b.start.getTime()) }))
    .filter(x => x.list.length);
  const agenda = (
    <div className="agenda">
      {agendaDays.length === 0 && <p className="muted">{t('Keine Termine in den nächsten 60 Tagen.')}</p>}
      {agendaDays.map(({ d, list }) => (
        <section key={ymd(d)} className={ymd(d) === ymd(now) ? 'today' : ''}>
          <h3>{new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(d)}</h3>
          {list.map(x => (
            <button
              key={`${x.e.uid}${x.e.recurrenceId || ''}`}
              className="agenda-item"
              style={{ '--c': x.e.color } as CSSProperties}
              onClick={() => openEvent(x.e)}
            >
              <span className="agenda-time">
                {x.e.allDay ? t('ganztägig') : `${timeFmt.format(x.start)} – ${timeFmt.format(x.end)}`}
              </span>
              <span className="agenda-title">
                <strong>{x.e.summary || t('(Ohne Titel)')}</strong>
                {x.e.location && (
                  <small>
                    <MapPin size={11} /> {x.e.location}
                  </small>
                )}
              </span>
              {x.e.attendees.length > 0 && <Users size={13} />}
              {x.e.recurring && <Repeat size={13} />}
            </button>
          ))}
        </section>
      ))}
    </div>
  );

  return (
    <div className="calendar-module">
      <aside className="calendar-sidebar">
        <button
          className="compose-button"
          onClick={() =>
            openNew(
              new Date(
                anchor.getFullYear(),
                anchor.getMonth(),
                anchor.getDate(),
                Math.min(17, new Date().getHours() + 1)
              )
            )
          }
        >
          <Plus size={17} />
          <span>{t('Neuer Termin')}</span>
        </button>
        <MiniMonth
          month={miniMonth}
          selected={range.days.length ? range.days : [anchor]}
          today={now}
          busyDays={new Set(ranged.flatMap(x => (x.start >= range.from && x.start < range.to ? [ymd(x.start)] : [])))}
          locale={locale}
          onMonth={setMiniMonth}
          onPick={d => {
            setAnchor(d);
            if (view === 'month' || view === 'agenda') changeView('day');
          }}
        />
        <h3>{t('Kalender')}</h3>
        {calendars.map(c => (
          <button
            key={`${c.accountId}|${c.url}`}
            className={`calendar-toggle ${c.hidden ? 'off' : ''}`}
            onClick={() => void toggleCalendar(c)}
            title={c.accountLabel}
          >
            <span className="swatch" style={{ background: c.hidden ? 'transparent' : c.color, borderColor: c.color }} />
            <span>
              <span>{c.name}</span>
              {calendars.filter(x => x.name === c.name).length > 1 && c.accountLabel && <small>{c.accountLabel}</small>}
            </span>
            {c.hidden ? <EyeOff size={13} /> : <Eye size={13} className="hover-only" />}
          </button>
        ))}
        {calendars.every(c => c.source === 'local') && (
          <p className="calendar-local-hint">
            {t(
              'Termine werden nur auf diesem Gerät gespeichert. Für Handy und andere Geräte einen Kalender verbinden.'
            )}
          </p>
        )}
        <button className="text-button subtle" onClick={onOpenSettings}>
          {calendars.every(c => c.source === 'local') ? t('Kalender verbinden') : t('Kalender verwalten')}
        </button>
      </aside>
      <main className="calendar-main">
        <header className="calendar-toolbar">
          <button className="btn small" onClick={() => setAnchor(startOfDay(new Date()))}>
            {t('Heute')}
          </button>
          <button className="icon-button" aria-label={t('Zurück')} onClick={() => step(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button className="icon-button" aria-label={t('Weiter')} onClick={() => step(1)}>
            <ChevronRight size={18} />
          </button>
          <h1>
            {title}
            <span className="period">.</span>
          </h1>
          <button className="icon-button" aria-label={t('Aktualisieren')} onClick={() => void load()} disabled={busy}>
            <RefreshCcw size={16} className={busy ? 'spin' : ''} />
          </button>
          <div className="segmented" role="radiogroup" aria-label={t('Ansicht')}>
            {(['day', 'week', 'month', 'agenda'] as View[]).map(v => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                className={view === v ? 'active' : ''}
                onClick={() => changeView(v)}
              >
                {{ day: t('Tag'), week: t('Woche'), month: t('Monat'), agenda: t('Agenda') }[v]}
              </button>
            ))}
          </div>
        </header>
        <CloudConsentBanner errors={cloudErrors} onDone={load} />
        {errors.length > 0 && (
          <div className="error-banner" role="alert">
            <span>{errors[0]}</span>
            <button onClick={() => setErrors([])} aria-label={t('Meldung schließen')}>
              <X size={14} />
            </button>
          </div>
        )}
        <div className="calendar-body">
          {view === 'month' ? month : view === 'agenda' ? agenda : timeGrid(range.days)}
        </div>
      </main>
      {editor && (
        <EventEditor
          draft={editor}
          calendars={calendars}
          ownAddresses={own}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** Small month overview: jump to any day; days with events are marked. */
function MiniMonth({
  month,
  selected,
  today,
  busyDays,
  locale,
  onMonth,
  onPick
}: {
  month: Date;
  selected: Date[];
  today: Date;
  busyDays: Set<string>;
  locale: string;
  onMonth: (d: Date) => void;
  onPick: (d: Date) => void;
}) {
  const { t } = useT();
  const days = monthMatrix(month);
  const sel = new Set(selected.map(ymd));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow' });
  const label = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month);
  const shift = (n: number) => onMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <div className="mini-month" aria-label={label}>
      <div className="mini-month-head">
        <strong>{label}</strong>
        <button className="icon-button" aria-label={t('Voriger Monat')} onClick={() => shift(-1)}>
          <ChevronLeft size={15} />
        </button>
        <button className="icon-button" aria-label={t('Nächster Monat')} onClick={() => shift(1)}>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="mini-month-grid" role="grid">
        {days.slice(0, 7).map(d => (
          <span key={`h${ymd(d)}`} className="mini-weekday" aria-hidden="true">
            {weekday.format(d)}
          </span>
        ))}
        {days.map(d => {
          const key = ymd(d);
          return (
            <button
              key={key}
              className={[
                'mini-day',
                d.getMonth() !== month.getMonth() ? 'outside' : '',
                key === ymd(today) ? 'today' : '',
                sel.has(key) ? 'selected' : '',
                busyDays.has(key) ? 'busy' : ''
              ].join(' ')}
              aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(d)}
              aria-current={key === ymd(today) ? 'date' : undefined}
              onClick={() => onPick(d)}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
