// Settings → Booking links: an address people write to (a mailto: link for a signature or web
// page). Levuvo Mail answers with free times from the own calendars; a click on a time books it
// and sends the invitation. Works without a server of our own, while Levuvo Mail is open.
import { useEffect, useState } from 'react';
import { Copy, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Section } from './Settings';
import { Button, Field } from './ui';
import { scheduling, timeZone, type BookingLink } from './scheduling-api';
import type { AccountItem } from './types';

const DAYS = [1, 2, 3, 4, 5, 6, 0];

export function BookingSettings({ accounts }: { accounts: AccountItem[] }) {
  const { t, lang } = useT();
  const { confirm, toast } = useUi();
  const [links, setLinks] = useState<BookingLink[] | null>(null);
  const [error, setError] = useState('');
  const load = () =>
    scheduling
      .list()
      .then(r => setLinks(r.links || []))
      .catch(e => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  const mailAccounts = accounts.filter(a => a.configured);

  async function add() {
    try {
      await scheduling.saveLink({
        accountId: mailAccounts[0]?.id,
        title: t('Gespräch'),
        minutes: 30,
        dayStart: 9,
        dayEnd: 17,
        timeZone: timeZone(),
        lang,
        enabled: false
      });
      void load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }

  return (
    <Section
      title={t('Buchungslinks')}
      description={t(
        'Ein Link für deine Signatur oder Webseite. Wer ihn anklickt, schreibt dir eine Mail; Levuvo Mail antwortet automatisch mit freien Zeiten aus deinen Kalendern. Ein Klick auf eine Zeit bucht sie, und beide bekommen eine Kalendereinladung. Ohne eigenen Server und ohne Dienst eines Dritten: Es läuft, solange Levuvo Mail geöffnet ist. Termintitel oder andere Details deines Kalenders werden nie gezeigt.'
      )}
    >
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {!links && !error && (
        <p className="muted">
          <LoaderCircle size={14} className="spin" /> {t('Lädt …')}
        </p>
      )}
      {links?.map(l => (
        <LinkCard
          key={l.id}
          link={l}
          accounts={mailAccounts}
          onChange={load}
          onRemove={async () => {
            if (
              !(await confirm({
                title: t('Buchungslink „{title}“ löschen?', { title: l.title }),
                message: t('Wer den Link noch verwendet, bekommt keine Antwort mehr.'),
                confirmLabel: t('Löschen'),
                danger: true
              }))
            )
              return;
            await scheduling.removeLink(l.id).catch(() => {});
            void load();
          }}
        />
      ))}
      <Button
        icon={<Plus size={14} />}
        disabled={!mailAccounts.length || (links?.length || 0) >= 20}
        onClick={() => void add()}
      >
        {t('Neuer Buchungslink')}
      </Button>
    </Section>
  );
}

function LinkCard({
  link,
  accounts,
  onChange,
  onRemove
}: {
  link: BookingLink;
  accounts: AccountItem[];
  onChange: () => void;
  onRemove: () => void;
}) {
  const { t, locale } = useT();
  const { toast } = useUi();
  const [draft, setDraft] = useState(link);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(link);
  const set = (patch: Partial<BookingLink>) => setDraft(d => ({ ...d, ...patch }));
  const dayName = (d: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 10, 22 + d));

  async function save(patch: Partial<BookingLink> = {}) {
    setBusy(true);
    try {
      await scheduling.saveLink({ ...draft, ...patch, request: undefined });
      toast({ text: t('Buchungslink gespeichert.'), kind: 'success' });
      onChange();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ text: t('In die Zwischenablage kopiert.'), kind: 'success' });
    } catch {
      toast({ text: t('Kopieren nicht möglich.'), kind: 'error' });
    }
  }

  return (
    <div className={`booking-card ${link.enabled ? '' : 'off'}`}>
      <div className="booking-head">
        <label className="toggle">
          <input
            type="checkbox"
            checked={link.enabled}
            disabled={busy}
            onChange={e => void save({ enabled: e.target.checked })}
          />{' '}
          <strong>{link.title}</strong>
        </label>
        <small className="muted">{t('{count} Buchungen', { count: link.bookings })}</small>
        <button className="icon-button" aria-label={t('Buchungslink löschen')} onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="booking-grid">
        <Field label={t('Titel')}>
          <input value={draft.title} maxLength={120} onChange={e => set({ title: e.target.value })} />
        </Field>
        <Field label={t('Dauer')}>
          <select value={draft.minutes} onChange={e => set({ minutes: Number(e.target.value) })}>
            {[15, 30, 45, 60, 90, 120].map(m => (
              <option key={m} value={m}>
                {t('{minutes} Minuten', { minutes: m })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Von')}>
          <select value={draft.dayStart} onChange={e => set({ dayStart: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Bis')}>
          <select value={draft.dayEnd} onChange={e => set({ dayEnd: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => h + 1).map(h => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Buchbar für')}>
          <select value={draft.daysAhead} onChange={e => set({ daysAhead: Number(e.target.value) })}>
            {[7, 14, 30, 60].map(d => (
              <option key={d} value={d}>
                {t('nächste {days} Tage', { days: d })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Vorlauf')}>
          <select value={draft.noticeHours} onChange={e => set({ noticeHours: Number(e.target.value) })}>
            {[0, 2, 12, 24, 48].map(h => (
              <option key={h} value={h}>
                {h === 0 ? t('keiner') : t('{hours} Stunden', { hours: h })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Puffer')}>
          <select value={draft.bufferMinutes} onChange={e => set({ bufferMinutes: Number(e.target.value) })}>
            {[0, 5, 10, 15, 30].map(m => (
              <option key={m} value={m}>
                {m === 0 ? t('keiner') : t('{minutes} Minuten', { minutes: m })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Ort')}>
          <input value={draft.location} maxLength={300} onChange={e => set({ location: e.target.value })} />
        </Field>
        {accounts.length > 1 && (
          <Field label={t('Konto')}>
            <select value={draft.accountId} onChange={e => set({ accountId: e.target.value })}>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('Sprache der Antworten')}>
          <select value={draft.lang} onChange={e => set({ lang: e.target.value as 'de' | 'en' })}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </Field>
      </div>
      <fieldset className="booking-days">
        <legend>{t('Wochentage')}</legend>
        {DAYS.map(d => (
          <label key={d} className="toggle small">
            <input
              type="checkbox"
              checked={draft.weekdays.includes(d)}
              onChange={e =>
                set({ weekdays: e.target.checked ? [...draft.weekdays, d] : draft.weekdays.filter(x => x !== d) })
              }
            />{' '}
            {dayName(d)}
          </label>
        ))}
      </fieldset>
      {dirty && (
        <Button variant="primary" size="sm" busy={busy} onClick={() => void save()}>
          {t('Änderungen speichern')}
        </Button>
      )}
      {link.request && (
        <div className="booking-share">
          <p className="muted">{t('Diesen Link in die Signatur oder auf die Webseite stellen:')}</p>
          <code>{link.request.url}</code>
          <div className="booking-share-actions">
            <Button size="sm" icon={<Copy size={13} />} onClick={() => void copy(link.request!.url)}>
              {t('Link kopieren')}
            </Button>
            <Button
              size="sm"
              icon={<Copy size={13} />}
              onClick={() =>
                void copy(
                  `<a href="${link.request!.url.replace(/"/g, '&quot;')}">${link.title.replace(/[<>&"]/g, '')}</a>`
                )
              }
            >
              {t('Als HTML kopieren')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
