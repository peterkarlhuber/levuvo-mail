// "Termin finden": free times across the calendars of several people, then either enter the
// event at once, start a poll by e-mail (everyone says which times work) or offer times to
// someone outside the team (the first time picked is booked). No server of our own: the
// proposals are ordinary e-mails with mailto: links (see apps/server/src/scheduling.mjs).
import { useMemo, useState } from 'react';
import { CalendarCheck, CircleHelp, LoaderCircle, Search, Send, Users } from 'lucide-react';
import RecipientInput from './RecipientInput';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button, Dialog, Field, Segmented } from './ui';
import { scheduling, slotText, timeZone, type Availability, type Slot } from './scheduling-api';
import type { AccountItem, CalendarInfo } from './types';

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const parseAddresses = (value: string) =>
  [
    ...new Set(
      value
        .split(/[,;\n]/)
        .map(v => (/<([^>]+)>/.exec(v)?.[1] || v).trim().toLowerCase())
        .filter(v => EMAIL.test(v))
    )
  ].slice(0, 20);

export function FindTimeDialog({
  accounts,
  calendars,
  onClose,
  onCreate,
  onSent
}: {
  accounts: AccountItem[];
  calendars: CalendarInfo[];
  onClose: () => void;
  /** Enter one time directly (opens the event editor with the attendees). */
  onCreate: (slot: Slot, attendees: string[]) => void;
  onSent: () => void;
}) {
  const { t, lang, locale } = useT();
  const { toast } = useUi();
  const mailAccounts = accounts.filter(a => a.configured);
  const [accountId, setAccountId] = useState(mailAccounts[0]?.id || '');
  const [people, setPeople] = useState('');
  const [calendarOf, setCalendarOf] = useState<Record<string, string>>({});
  const [minutes, setMinutes] = useState(30);
  const [days, setDays] = useState(14);
  const [dayStart, setDayStart] = useState(9);
  const [dayEnd, setDayEnd] = useState(17);
  const [weekend, setWeekend] = useState(false);
  const [result, setResult] = useState<Availability | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<'poll' | 'offer'>('poll');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const emails = useMemo(() => parseAddresses(people), [people]);
  const otherCalendars = calendars.filter(c => !c.hidden);

  async function search() {
    setBusy(true);
    setError('');
    setPicked([]);
    try {
      const from = new Date();
      setResult(
        await scheduling.availability({
          from: from.toISOString(),
          to: new Date(from.getTime() + days * 86_400_000).toISOString(),
          minutes,
          dayStart,
          dayEnd,
          weekdays: weekend ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5],
          timeZone: timeZone(),
          participants: emails.map(email => ({ email, calendarUrl: calendarOf[email] || '' }))
        })
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const slots = result?.slots || [];
  const chosen = slots.filter(s => picked.includes(s.start));
  const toggle = (s: Slot) =>
    setPicked(p => (p.includes(s.start) ? p.filter(x => x !== s.start) : p.length >= 8 ? p : [...p, s.start]));
  const knownCount = result ? result.people.filter(p => p.source !== 'unknown').length : 0;
  const sourceLabel = {
    own: t('deine Kalender'),
    calendar: t('freigegebener Kalender'),
    microsoft: t('Microsoft 365 (frei/belegt)'),
    google: t('Google (frei/belegt)'),
    unknown: t('Kalender nicht lesbar: stimmt per Mail ab')
  };

  async function send() {
    setBusy(true);
    setError('');
    try {
      await scheduling.createPoll({
        kind: mode,
        accountId,
        title: title.trim(),
        location,
        message,
        minutes,
        participants: emails,
        slots: chosen.map(s => ({ start: s.start, end: s.end })),
        lang,
        timeZone: timeZone()
      });
      toast({
        text:
          mode === 'poll'
            ? t('Abstimmung an {count} Personen gesendet. Antworten erscheinen unter „Abstimmungen“.', {
                count: emails.length
              })
            : t('Zeiten an {count} Personen gesendet. Die erste gewählte Zeit wird automatisch eingetragen.', {
                count: emails.length
              }),
        kind: 'success'
      });
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t('Termin finden')}
      description={t(
        'Sucht Zeiten, zu denen alle frei sind. Wessen Kalender Levuvo Mail nicht lesen kann, stimmt per Mail ab.'
      )}
      onClose={onClose}
      size="lg"
      dismissible={false}
      className="find-time"
      footer={
        <>
          <Button onClick={onClose}>{t('Schließen')}</Button>
          {chosen.length === 1 && (
            <Button icon={<CalendarCheck size={14} />} onClick={() => onCreate(chosen[0], emails)}>
              {t('Termin eintragen und einladen')}
            </Button>
          )}
          <Button
            variant="primary"
            icon={<Send size={14} />}
            disabled={!chosen.length || !emails.length || !title.trim() || !accountId}
            busy={busy && !!result}
            onClick={() => void send()}
          >
            {mode === 'poll' ? t('Abstimmung senden') : t('Zeiten anbieten')}
          </Button>
        </>
      }
    >
      <div className="find-time-form">
        <RecipientInput
          accountId={accountId}
          label={t('Mit wem?')}
          value={people}
          onChange={setPeople}
          placeholder={t('anna@firma.at, bert@firma.at')}
          autoFocus
        />
        {emails.length > 0 && otherCalendars.length > 0 && (
          <details className="find-time-calendars">
            <summary>{t('Kalender der Personen zuordnen (optional)')}</summary>
            <p className="muted">
              {t(
                'Für Kolleginnen und Kollegen in Microsoft 365 oder Google fragt Levuvo Mail nur „frei/belegt“ ab. Hat dir jemand seinen Kalender freigegeben (z. B. Nextcloud), wähle ihn hier.'
              )}
            </p>
            {emails.map(email => (
              <Field key={email} label={email}>
                <select
                  value={calendarOf[email] || ''}
                  onChange={e => setCalendarOf(c => ({ ...c, [email]: e.target.value }))}
                >
                  <option value="">{t('automatisch')}</option>
                  {otherCalendars.map(c => (
                    <option key={`${c.accountId}|${c.url}`} value={c.url}>
                      {c.name}
                      {c.accountLabel ? ` (${c.accountLabel})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </details>
        )}
        <div className="find-time-row">
          <Field label={t('Dauer')}>
            <select value={minutes} onChange={e => setMinutes(Number(e.target.value))}>
              {[15, 30, 45, 60, 90, 120].map(m => (
                <option key={m} value={m}>
                  {t('{minutes} Minuten', { minutes: m })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Zeitraum')}>
            <select value={days} onChange={e => setDays(Number(e.target.value))}>
              {[7, 14, 30, 60].map(d => (
                <option key={d} value={d}>
                  {t('nächste {days} Tage', { days: d })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Von')}>
            <select value={dayStart} onChange={e => setDayStart(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Bis')}>
            <select value={dayEnd} onChange={e => setDayEnd(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => h + 1).map(h => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="toggle small">
          <input type="checkbox" checked={weekend} onChange={e => setWeekend(e.target.checked)} />{' '}
          {t('Auch am Wochenende')}
        </label>
        <Button
          icon={busy && !result ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />}
          disabled={busy || dayEnd <= dayStart}
          onClick={() => void search()}
        >
          {t('Freie Zeiten suchen')}
        </Button>
      </div>
      {result && (
        <section className="find-time-result" aria-live="polite">
          <ul className="find-time-people">
            {result.people.map(p => (
              <li key={p.email} className={p.source === 'unknown' ? 'unknown' : ''}>
                {p.source === 'unknown' ? (
                  <CircleHelp size={13} aria-hidden="true" />
                ) : (
                  <Users size={13} aria-hidden="true" />
                )}
                <span>{p.email === 'me' ? t('Du') : p.name || p.email}</span>
                <small>{sourceLabel[p.source]}</small>
              </li>
            ))}
          </ul>
          {slots.length === 0 ? (
            <p className="muted">
              {t('Keine freie Zeit gefunden. Versuche einen längeren Zeitraum oder andere Uhrzeiten.')}
            </p>
          ) : (
            <>
              <p className="muted">
                {t('Wähle bis zu 8 Zeiten für die Mail, oder eine Zeit, um sie direkt einzutragen.')}
              </p>
              <ul className="find-time-slots">
                {slots.map(s => (
                  <li key={s.start}>
                    <label className={picked.includes(s.start) ? 'picked' : ''}>
                      <input type="checkbox" checked={picked.includes(s.start)} onChange={() => toggle(s)} />
                      <span className="slot-time">{slotText(s, locale)}</span>
                      <span className={`slot-fit ${s.all ? 'all' : ''}`}>
                        {s.all
                          ? t('alle frei')
                          : t('{free} von {count} frei', { free: s.free?.length || 0, count: knownCount })}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.errors.length > 0 && <p className="muted">{t('Einige Kalender konnten nicht abgefragt werden.')}</p>}
        </section>
      )}
      {chosen.length > 0 && emails.length > 0 && (
        <section className="find-time-send">
          <Segmented
            label={t('Wie weiter?')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'poll', label: t('Team abstimmen lassen') },
              { value: 'offer', label: t('Externen Zeiten anbieten') }
            ]}
          />
          <p className="muted">
            {mode === 'poll'
              ? t(
                  'Jede Person bekommt eine Mail mit den Zeiten und klickt an, was passt. Du legst danach den Termin fest.'
                )
              : t(
                  'Wer zuerst eine Zeit anklickt, bekommt sie: Levuvo Mail trägt den Termin ein und schickt die Einladung, sobald die Antwort ankommt.'
                )}
          </p>
          <div className="find-time-row">
            <Field label={t('Titel')} required>
              <input value={title} maxLength={200} onChange={e => setTitle(e.target.value)} />
            </Field>
            <Field label={t('Ort')}>
              <input value={location} maxLength={300} onChange={e => setLocation(e.target.value)} />
            </Field>
            {mailAccounts.length > 1 && (
              <Field label={t('Senden von')}>
                <select value={accountId} onChange={e => setAccountId(e.target.value)}>
                  {mailAccounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <Field label={t('Nachricht (optional)')}>
            <textarea rows={2} maxLength={2000} value={message} onChange={e => setMessage(e.target.value)} />
          </Field>
        </section>
      )}
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
