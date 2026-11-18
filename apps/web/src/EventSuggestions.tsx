// "Appointment detected" card in the reader: flights, hotels, tickets, .ics files and dates in the
// text (detected on the server, see apps/server/src/event-extract.mjs) go into a calendar with
// one click. Nothing is added without that click.
import { useEffect, useState } from 'react';
import {
  BedDouble,
  Bus,
  CalendarCheck,
  CalendarPlus,
  Car,
  Plane,
  Ticket,
  TrainFront,
  UtensilsCrossed,
  X
} from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { localizeCalendars } from './calendar-utils';
import { suggestionToEvent } from './event-suggestion';
import type { CalendarInfo, Detail, EventSuggestion } from './types';

const ICONS = {
  flight: Plane,
  train: TrainFront,
  bus: Bus,
  hotel: BedDouble,
  car: Car,
  restaurant: UtensilsCrossed,
  event: Ticket,
  calendar: CalendarPlus,
  date: CalendarPlus
} as const;

export function EventSuggestions({ detail }: { detail: Detail }) {
  const { t, locale } = useT();
  const { toast } = useUi();
  const list = detail.eventSuggestions || [];
  const [calendars, setCalendars] = useState<CalendarInfo[] | null>(null);
  const [target, setTarget] = useState('');
  const [added, setAdded] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!list.length) return;
    getJson<{ calendars: CalendarInfo[] }>('/api/invitations/calendars')
      .then(d => {
        const cals = localizeCalendars(d.calendars, t);
        setCalendars(cals);
        const pick = cals.find(c => c.source === 'local') || cals.find(c => c.primary) || cals[0];
        setTarget(pick ? `${pick.accountId}|${pick.url}` : '');
      })
      .catch(() => setCalendars([]));
    // Only once per message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.folder, detail.uid]);

  if (!list.length || hidden) return null;

  const kindLabel: Record<EventSuggestion['kind'], string> = {
    flight: t('Flug'),
    train: t('Zugfahrt'),
    bus: t('Busfahrt'),
    hotel: t('Hotel'),
    car: t('Mietwagen'),
    restaurant: t('Tischreservierung'),
    event: t('Veranstaltung'),
    calendar: t('Kalenderdatei'),
    date: t('Termin erkannt')
  };
  const labels = {
    kind: kindLabel,
    reservation: t('Buchungsnummer'),
    fromMail: t('Aus der E-Mail'),
    untitled: t('(Ohne Titel)')
  };

  function when(s: EventSuggestion) {
    const e = suggestionToEvent(s, detail, labels);
    if (e.allDay) {
      const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
      const start = new Date(`${e.start}T12:00:00`);
      const last = new Date(`${e.end}T12:00:00`);
      last.setDate(last.getDate() - 1);
      return last > start ? `${fmt.format(start)} – ${fmt.format(last)}` : fmt.format(start);
    }
    const s0 = new Date(e.start);
    const e0 = new Date(e.end);
    const day = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(s0);
    const sameDay = s0.toDateString() === e0.toDateString();
    const end = new Intl.DateTimeFormat(
      locale,
      sameDay ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }
    ).format(e0);
    return `${day} – ${end}`;
  }

  async function add(index: number) {
    const [accountId, ...rest] = target.split('|');
    if (!accountId) return;
    setBusy(index);
    try {
      await postJson(
        '/api/calendar/events/save',
        {
          accountId,
          calendarUrl: rest.join('|'),
          scope: 'all',
          event: suggestionToEvent(list[index], detail, labels)
        },
        'calendar-v1'
      );
      setAdded(a => ({ ...a, [index]: true }));
      toast({ text: t('Im Kalender eingetragen.'), kind: 'success' });
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="event-suggestions">
      {list.map((s, i) => {
        const Icon = ICONS[s.kind] || CalendarPlus;
        const e = suggestionToEvent(s, detail, labels);
        return (
          <div className="invitation-card event-suggestion" key={`${s.start}|${i}`}>
            <div className="invitation-icon">
              <Icon size={22} />
            </div>
            <div className="invitation-body">
              <small>{kindLabel[s.kind] || kindLabel.date}</small>
              <strong>{e.summary}</strong>
              <span>{when(s)}</span>
              {s.location && <span>{s.location}</span>}
              {s.reservationNumber && (
                <span className="muted">
                  {labels.reservation}: {s.reservationNumber}
                </span>
              )}
              <div className="invitation-actions">
                {calendars && calendars.length > 1 && i === 0 && (
                  <select value={target} onChange={ev => setTarget(ev.target.value)} aria-label={t('Kalender')}>
                    {calendars.map(c => (
                      <option key={`${c.accountId}|${c.url}`} value={`${c.accountId}|${c.url}`}>
                        {c.name}
                        {c.accountLabel ? ` · ${c.accountLabel}` : ''}
                      </option>
                    ))}
                  </select>
                )}
                {calendars && !calendars.length ? (
                  <small className="muted">{t('Kein beschreibbarer Kalender vorhanden.')}</small>
                ) : added[i] ? (
                  <span className="event-suggestion-done">
                    <CalendarCheck size={14} /> {t('Im Kalender')}
                  </span>
                ) : (
                  <button className="btn small" disabled={busy !== null || !target} onClick={() => void add(i)}>
                    <CalendarPlus size={14} /> {t('In den Kalender übernehmen')}
                  </button>
                )}
              </div>
            </div>
            {i === 0 && (
              <button
                className="icon-button event-suggestion-close"
                title={t('Ausblenden')}
                onClick={() => setHidden(true)}
              >
                <X size={15} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
