import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Download,
  Contact2,
  Eye,
  EyeOff,
  LoaderCircle,
  Plug,
  Plus,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { download, getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { localizeCalendars } from './calendar-utils';
import { Section } from './Settings';
import type { CalendarInfo, DavAccount } from './types';

type Form = { id?: string; label: string; serverUrl: string; username: string; password: string };
const PRESETS: { name: string; url: string; hint?: string }[] = [
  {
    name: 'Nextcloud',
    url: 'https://cloud.example.com/remote.php/dav',
    hint: 'Adresse deiner Nextcloud + /remote.php/dav. Am besten ein App-Passwort verwenden (Einstellungen → Sicherheit).'
  },
  { name: 'mailbox.org', url: 'https://dav.mailbox.org' },
  {
    name: 'iCloud',
    url: 'https://caldav.icloud.com',
    hint: 'Nur mit app-spezifischem Passwort (appleid.apple.com). Kontakte: https://contacts.icloud.com'
  },
  {
    name: 'Fastmail',
    url: 'https://caldav.fastmail.com',
    hint: 'Kontakte: https://carddav.fastmail.com · App-Passwort verwenden.'
  },
  {
    name: 'Posteo',
    url: 'https://posteo.de:8443',
    hint: 'Kalender und Adressbuch müssen in den Posteo-Einstellungen aktiviert sein.'
  }
];

export function DavSettings() {
  const { t } = useT();
  const { confirm, prompt, toast } = useUi();
  const [accounts, setAccounts] = useState<DavAccount[] | null>(null);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [edit, setEdit] = useState<Form | null>(null);
  const [busy, setBusy] = useState<'' | 'verify' | 'save'>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const d = await getJson<{ accounts: DavAccount[] }>('/api/dav/accounts');
    setAccounts(d.accounts);
    setCalendars(
      localizeCalendars(
        (await getJson<{ calendars: CalendarInfo[] }>('/api/calendar/calendars').catch(() => ({ calendars: [] })))
          .calendars,
        t
      )
    );
  }, [t]);
  useEffect(() => {
    void load().catch(e => setError((e as Error).message));
  }, [load]);

  async function verify() {
    if (!edit) return;
    setBusy('verify');
    setError('');
    setNotice('');
    try {
      const r = await postJson<{ caldav: boolean; carddav: boolean }>('/api/dav/accounts/verify', edit, 'accounts-v1');
      setNotice(
        [r.caldav && t('Kalender (CalDAV) erreichbar'), r.carddav && t('Kontakte (CardDAV) erreichbar')]
          .filter(Boolean)
          .join(' · ')
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy('save');
    setError('');
    setNotice('');
    try {
      if (edit.id)
        await postJson(
          '/api/dav/accounts/update',
          { id: edit.id, label: edit.label, password: edit.password || undefined },
          'accounts-v1'
        );
      else await postJson('/api/dav/accounts/create', edit, 'accounts-v1');
      setEdit(null);
      await load();
      setNotice(t('Gespeichert.'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function remove(a: DavAccount) {
    if (
      !(await confirm({
        title: t('{label} entfernen?', { label: a.label }),
        message: t('Nur die Verbindung auf diesem Gerät wird entfernt. Termine und Kontakte bleiben auf dem Server.'),
        confirmLabel: t('Entfernen'),
        danger: true
      }))
    )
      return;
    try {
      await postJson('/api/dav/accounts/remove', { id: a.id, confirm: 'REMOVE_DAV_ACCOUNT' }, 'accounts-v1');
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }
  async function updateCalendar(c: CalendarInfo, patch: { hidden?: boolean; color?: string }) {
    setCalendars(list => list.map(x => (x.url === c.url && x.accountId === c.accountId ? { ...x, ...patch } : x)));
    try {
      await postJson('/api/calendar/calendars/update', { accountId: c.accountId, url: c.url, ...patch }, 'calendar-v1');
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
      void load();
    }
  }
  // Device calendar: export/import as .ics, delete.
  function exportLocal(c: CalendarInfo) {
    download(`/api/calendar/local/export?url=${encodeURIComponent(c.url)}`);
  }
  function importLocal(c: CalendarInfo) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ics,text/calendar';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const r = await postJson<{ imported: number; skipped: number }>(
          '/api/calendar/local/import',
          { url: c.url, ics: await file.text() },
          'calendar-v1'
        );
        toast({
          text: r.skipped
            ? t('{count} Termine importiert, {skipped} bereits vorhanden.', { count: r.imported, skipped: r.skipped })
            : t('{count} Termine importiert.', { count: r.imported }),
          kind: 'success'
        });
      } catch (e) {
        toast({ text: (e as Error).message, kind: 'error' });
      }
    };
    input.click();
  }
  async function deleteLocal(c: CalendarInfo) {
    const ok = await confirm({
      title: t('Kalender „{name}“ löschen?', { name: c.name }),
      message: t('Alle Termine dieses Kalenders werden von diesem Gerät gelöscht. Vorher exportieren?'),
      confirmLabel: t('Löschen'),
      danger: true
    });
    if (!ok) return;
    try {
      await postJson('/api/calendar/calendars/delete', { url: c.url, confirm: 'DELETE_LOCAL_CALENDAR' }, 'calendar-v1');
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }
  async function createCalendar(accountId: string) {
    const name = await prompt({
      title: t('Neuer Kalender'),
      label: t('Name'),
      confirmLabel: t('Anlegen'),
      validate: v => (v.trim() && v.length <= 80 ? null : t('1–80 Zeichen'))
    });
    if (!name) return;
    try {
      await postJson('/api/calendar/calendars/create', { accountId, name: name.trim() }, 'calendar-v1');
      await load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }

  // CalDAV accounts plus Microsoft 365 / Google mail accounts that already show calendars.
  const calendarOwners = [
    ...(accounts || []).map(a => ({ id: a.id, label: a.label })),
    ...[
      ...new Map(
        calendars.filter(c => c.source).map(c => [c.accountId, { id: c.accountId, label: c.accountLabel || '' }])
      ).values()
    ]
  ];
  return (
    <>
      <Section
        title={t('Server-Konten')}
        description={t(
          'Microsoft 365 und Google sind über das angemeldete E-Mail-Konto automatisch dabei. Andere Anbieter verbindest du hier per CalDAV/CardDAV (z. B. Nextcloud, mailbox.org, iCloud, Fastmail, Posteo). Das Passwort liegt im Schlüsselbund.'
        )}
      >
        {accounts?.map(a => (
          <div className="managed-item" key={a.id}>
            <div className="managed-item-name">
              <strong>{a.label}</strong>
              <small>
                {a.username} · {a.serverUrl}
              </small>
            </div>
            <div className="managed-item-actions">
              <button
                className="btn small"
                disabled={Boolean(edit)}
                onClick={() => {
                  setError('');
                  setNotice('');
                  setEdit({ id: a.id, label: a.label, serverUrl: a.serverUrl, username: a.username, password: '' });
                }}
              >
                {t('Bearbeiten')}
              </button>
              <button
                className="btn small"
                aria-label={t('{label} entfernen', { label: a.label })}
                onClick={() => void remove(a)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {!edit && (
          <button
            className="btn small"
            onClick={() => {
              setError('');
              setNotice('');
              setEdit({ label: '', serverUrl: '', username: '', password: '' });
            }}
          >
            <Plus size={14} /> {t('Kalender/Kontakte verbinden')}
          </button>
        )}
        {edit && (
          <form className="managed-form" onSubmit={e => void save(e)} autoComplete="off">
            <div className="managed-form-head">
              <strong>{edit.id ? t('Verbindung bearbeiten') : t('Neue Verbindung')}</strong>
              <button type="button" className="icon-button" aria-label={t('Schließen')} onClick={() => setEdit(null)}>
                <X size={18} />
              </button>
            </div>
            {!edit.id && (
              <div className="preset-chips">
                {PRESETS.map(p => (
                  <button
                    type="button"
                    key={p.name}
                    className="chip"
                    onClick={() => setEdit({ ...edit, serverUrl: p.url, label: edit.label || p.name })}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {!edit.id && PRESETS.find(p => p.url === edit.serverUrl)?.hint && (
              <p className="managed-hint">{t(PRESETS.find(p => p.url === edit.serverUrl)!.hint!)}</p>
            )}
            <div className="managed-field-grid">
              <label>
                {t('Server-Adresse')}
                <input
                  type="url"
                  required
                  readOnly={Boolean(edit.id)}
                  value={edit.serverUrl}
                  placeholder="https://cloud.firma.at/remote.php/dav"
                  onChange={e => setEdit({ ...edit, serverUrl: e.target.value })}
                />
              </label>
              <label>
                {t('Name')}
                <input value={edit.label} maxLength={80} onChange={e => setEdit({ ...edit, label: e.target.value })} />
              </label>
              <label>
                {t('Benutzername')}
                <input
                  required
                  readOnly={Boolean(edit.id)}
                  value={edit.username}
                  onChange={e => setEdit({ ...edit, username: e.target.value })}
                />
              </label>
              <label>
                {t('Passwort')} {edit.id ? t('(leer = unverändert)') : ''}
                <input
                  type="password"
                  required={!edit.id}
                  autoComplete="new-password"
                  value={edit.password}
                  onChange={e => setEdit({ ...edit, password: e.target.value })}
                />
              </label>
            </div>
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="managed-notice">
                <Check size={14} /> {notice}
              </p>
            )}
            <div className="managed-form-buttons">
              <button
                type="button"
                className="btn"
                disabled={Boolean(busy) || !edit.serverUrl || !edit.username || (!edit.password && !edit.id)}
                onClick={() => void verify()}
              >
                {busy === 'verify' ? <LoaderCircle size={15} className="spin" /> : <Plug size={15} />}{' '}
                {t('Verbindung testen')}
              </button>
              <button type="submit" className="btn primary" disabled={Boolean(busy)}>
                {busy === 'save' ? <LoaderCircle size={15} className="spin" /> : null}{' '}
                {edit.id ? t('Speichern') : t('Verbinden')} <ArrowRight size={16} />
              </button>
            </div>
          </form>
        )}
        {!edit && notice && (
          <p className="managed-notice">
            <Check size={14} /> {notice}
          </p>
        )}
        {!edit && error && <p className="modal-error">{error}</p>}
      </Section>
      {((accounts && accounts.length > 0) || calendars.length > 0) && (
        <Section
          title={t('Kalender')}
          description={t('Ausgeblendete Kalender erscheinen nicht in der Ansicht und erzeugen keine Erinnerungen.')}
        >
          {calendars.length === 0 && (
            <p className="muted">
              <Contact2 size={14} /> {t('Keine Kalender gefunden.')}
            </p>
          )}
          {calendars.map(c => (
            <div className="calendar-setting" key={`${c.accountId}|${c.url}`}>
              <input
                type="color"
                value={c.color || '#6b7cff'}
                aria-label={t('Farbe für {name}', { name: c.name })}
                onChange={e => void updateCalendar(c, { color: e.target.value })}
              />
              <span>
                <strong>{c.name}</strong>
                <small>
                  {c.accountLabel}
                  {c.readOnly ? ` · ${t('nur lesen')}` : ''}
                </small>
              </span>
              {c.source === 'local' && (
                <>
                  <button
                    className="icon-button"
                    aria-label={t('Als .ics exportieren')}
                    title={t('Als .ics exportieren')}
                    onClick={() => exportLocal(c)}
                  >
                    <Download size={16} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t('.ics importieren')}
                    title={t('.ics importieren')}
                    onClick={() => importLocal(c)}
                  >
                    <Upload size={16} />
                  </button>
                  {calendars.filter(x => x.source === 'local').length > 1 && (
                    <button
                      className="icon-button"
                      aria-label={t('Kalender löschen')}
                      title={t('Kalender löschen')}
                      onClick={() => void deleteLocal(c)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </>
              )}
              <button
                className="icon-button"
                aria-label={c.hidden ? t('Einblenden') : t('Ausblenden')}
                title={c.hidden ? t('Einblenden') : t('Ausblenden')}
                onClick={() => void updateCalendar(c, { hidden: !c.hidden })}
              >
                {c.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          ))}
          <div className="settings-actions">
            {calendarOwners.map(a => (
              <button key={a.id} className="btn small" onClick={() => void createCalendar(a.id)}>
                <CalendarDays size={14} />{' '}
                {calendarOwners.length > 1 ? t('Neuer Kalender in {label}', { label: a.label }) : t('Neuer Kalender')}
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
