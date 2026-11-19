import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArchiveRestore,
  Bell,
  Bot,
  BookOpen,
  CalendarDays,
  Check,
  Download,
  FileStack,
  Filter,
  Info,
  KeyRound,
  LoaderCircle,
  Mail,
  Moon,
  Plug,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  Workflow,
  X,
  CalendarClock
} from 'lucide-react';
import AccountSettings from './AccountSettings';
import { download, getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { Segmented } from './ui';
import { useT } from './i18n';
import { usePrefs } from './prefs';
import { ShortcutsDialog } from './Panels';
import { ManualView } from './ManualView';
import { FiltersSettings } from './SettingsFilters';
import { AutomationSettings } from './SettingsAutomations';
import { BookingSettings } from './SettingsBooking';
import { DavSettings } from './SettingsDav';
import { SecuritySettings } from './SettingsSecurity';
import { TemplateSettings } from './SettingsTemplates';
import { BackupSettings } from './SettingsBackup';
import { AiSettingsPanel } from './SettingsAi';
import { SemanticIndexStatus } from './SemanticIndexStatus';
import { formatBytes } from './format';
import { StorageLocations } from './StorageLocations';
import { PrivacyDataSettings } from './SettingsPrivacyData';
import { AboutCompliance } from './AboutCompliance';
import { PrivacyCockpit } from './PrivacyCockpit';
import type { SettingsTab } from './App';
import type { AccountItem, ApiStatus, Runtime } from './types';

type Props = {
  tab: SettingsTab;
  onTab: (tab: SettingsTab) => void;
  runtime: Runtime;
  accounts: AccountItem[];
  pollState: Record<string, { checkedAt: number | null; error?: string }>;
  notificationState: NotificationPermission | 'unsupported';
  onRequestNotifications: () => void;
  onAccountsChanged: () => Promise<void>;
  onCheckNow: () => void;
  onClose: () => void;
};

export function Section({
  title,
  children,
  description
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {description && <p className="settings-description">{description}</p>}
      {children}
    </section>
  );
}
export function Row({
  label,
  hint,
  wide,
  children
}: {
  label: string;
  hint?: string;
  /** Free-text field: placed below the label at full row width. */
  wide?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const control = useRef<HTMLDivElement>(null);
  // Fields inside a row get the row's label and hint as accessible name and description,
  // unless they carry their own (WCAG 1.3.1 / 4.1.2).
  useLayoutEffect(() => {
    const fields = [
      ...(control.current?.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea') ?? [])
    ];
    fields.forEach(el => {
      const named =
        el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby') && !el.dataset.rowLabel) ||
        ((el as HTMLInputElement).labels?.length && !el.dataset.rowLabel);
      if (!named) {
        // A single field gets the row's visible <label>; several share it via aria-labelledby.
        if (fields.length === 1 && (!el.id || el.id === `${id}-field`)) el.id = `${id}-field`;
        else el.setAttribute('aria-labelledby', `${id}-label`);
        el.dataset.rowLabel = '1';
      }
      if (hint && !el.getAttribute('aria-describedby')) el.setAttribute('aria-describedby', `${id}-hint`);
    });
  });
  return (
    <div className={wide ? 'settings-row settings-row--wide' : 'settings-row'}>
      <div className="settings-row-label">
        <label id={`${id}-label`} htmlFor={`${id}-field`}>
          {label}
        </label>
        {hint && <small id={`${id}-hint`}>{hint}</small>}
      </div>
      <div className="settings-row-control" ref={control}>
        {children}
      </div>
    </div>
  );
}
export { Segmented };
export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

function General() {
  const { t } = useT();
  const [prefs, setPrefs] = usePrefs();
  return (
    <>
      <Section title={t('Darstellung')}>
        <Row label={t('Sprache')}>
          <Segmented
            label={t('Sprache')}
            value={prefs.language}
            onChange={v => setPrefs({ language: v })}
            options={[
              { value: 'system', label: t('System') },
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' }
            ]}
          />
        </Row>
        <Row label={t('Design')}>
          <Segmented
            label={t('Design')}
            value={prefs.theme}
            onChange={v => setPrefs({ theme: v })}
            options={[
              { value: 'system', label: t('System') },
              {
                value: 'light',
                label: (
                  <>
                    <Sun size={13} /> {t('Hell')}
                  </>
                )
              },
              {
                value: 'dark',
                label: (
                  <>
                    <Moon size={13} /> {t('Dunkel')}
                  </>
                )
              }
            ]}
          />
        </Row>
        <Row label={t('Dichte')}>
          <Segmented
            label={t('Dichte')}
            value={prefs.density}
            onChange={v => setPrefs({ density: v })}
            options={[
              { value: 'comfortable', label: t('Komfortabel') },
              { value: 'compact', label: t('Kompakt') }
            ]}
          />
        </Row>
      </Section>
      <Section title={t('Lesen')}>
        <Row label={t('Beim Öffnen als gelesen markieren')}>
          <Toggle
            label={t('Beim Öffnen als gelesen markieren')}
            checked={prefs.markReadOnOpen}
            onChange={v => setPrefs({ markReadOnOpen: v })}
          />
        </Row>
        <Row
          label={t('Konversationen gruppieren')}
          hint={t('Nachrichten mit gleichem Betreff werden zusammengefasst.')}
        >
          <Toggle
            label={t('Konversationen gruppieren')}
            checked={prefs.conversations}
            onChange={v => setPrefs({ conversations: v })}
          />
        </Row>
        <Row
          label={t('Posteingang bündeln')}
          hint={t('Newsletter, Rechnungen und Benachrichtigungen erscheinen gesammelt oben im Posteingang.')}
        >
          <Toggle label={t('Posteingang bündeln')} checked={prefs.bundles} onChange={v => setPrefs({ bundles: v })} />
        </Row>
        <Row
          label={t('Neue Absender zuerst prüfen')}
          hint={t(
            'Mails von Absendern, die nicht in deinen Kontakten stehen und denen du nie geschrieben hast, warten unter „Neue Absender“, bis du sie annimmst oder blockierst. Gilt für Mails ab dem Einschalten.'
          )}
        >
          <Toggle
            label={t('Neue Absender zuerst prüfen')}
            checked={prefs.screening}
            onChange={v => setPrefs({ screening: v })}
          />
        </Row>
      </Section>
      <Section title={t('Schreiben')}>
        <Row label={t('Standardformat')}>
          <Segmented
            label={t('Standardformat')}
            value={prefs.composeMode}
            onChange={v => setPrefs({ composeMode: v })}
            options={[
              { value: 'html', label: t('Formatiert') },
              { value: 'text', label: t('Nur Text') }
            ]}
          />
        </Row>
        <Row
          label={t('Senden rückgängig machen')}
          hint={t('So lange kannst du eine gesendete Nachricht noch zurückholen.')}
        >
          <select
            value={prefs.sendDelay}
            onChange={e => setPrefs({ sendDelay: Number(e.target.value) })}
            aria-label={t('Senden rückgängig machen')}
          >
            {[0, 5, 10, 20, 30].map(s => (
              <option key={s} value={s}>
                {s === 0 ? t('Aus') : t('{seconds} Sekunden', { seconds: s })}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      <Section title={t('Kalender')}>
        <Row label={t('Startansicht')}>
          <Segmented
            label={t('Startansicht')}
            value={prefs.calendarView}
            onChange={v => setPrefs({ calendarView: v })}
            options={[
              { value: 'day', label: t('Tag') },
              { value: 'week', label: t('Woche') },
              { value: 'month', label: t('Monat') },
              { value: 'agenda', label: t('Agenda') }
            ]}
          />
        </Row>
      </Section>
    </>
  );
}

function Accounts({
  accounts,
  pollState,
  onAccountsChanged
}: Pick<Props, 'accounts' | 'pollState' | 'onAccountsChanged'>) {
  const { t, locale } = useT();
  const [status, setStatus] = useState<Record<string, ApiStatus | null>>({});
  const [test, setTest] = useState<Record<string, { state: 'busy' | 'ok' | 'error'; message: string }>>({});
  useEffect(() => {
    let active = true;
    void Promise.all(
      accounts.map(async a => [a.id, await getJson<ApiStatus>('/api/status', a.id).catch(() => null)] as const)
    ).then(entries => {
      if (active) setStatus(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [accounts]);
  async function runTest(id: string) {
    setTest(o => ({ ...o, [id]: { state: 'busy', message: '' } }));
    try {
      await getJson('/api/connection', id);
      setTest(o => ({ ...o, [id]: { state: 'ok', message: t('Verbindung zum Mailserver erfolgreich.') } }));
    } catch (e) {
      setTest(o => ({ ...o, [id]: { state: 'error', message: (e as Error).message } }));
    }
  }
  return (
    <>
      <AccountSettings onChanged={onAccountsChanged} />
      {accounts.length > 0 && (
        <Section title={t('Verbindungsstatus')}>
          {accounts.map(a => {
            const push = status[a.id]?.push;
            const checked = pollState[a.id]?.checkedAt;
            const tt = test[a.id];
            return (
              <div className="status-line" key={a.id}>
                <span className={`pill-dot ${push?.connected ? 'live' : push?.error ? 'error' : ''}`} />
                <span>
                  <strong>{a.label}</strong>
                  <small>
                    {push?.connected ? t('Live (IMAP IDLE)') : push?.error || t('Verbinde …')}
                    {checked
                      ? ` · ${t('geprüft {time}', { time: new Date(checked).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}`
                      : ''}
                  </small>
                </span>
                <button className="btn small" disabled={tt?.state === 'busy'} onClick={() => void runTest(a.id)}>
                  {tt?.state === 'busy' ? <LoaderCircle size={14} className="spin" /> : <Plug size={14} />}{' '}
                  {t('Testen')}
                </button>
                {tt && tt.state !== 'busy' && (
                  <small className={tt.state === 'ok' ? 'ok-text' : 'error-text'}>{tt.message}</small>
                )}
              </div>
            );
          })}
        </Section>
      )}
    </>
  );
}

function Notifications({
  runtime,
  notificationState,
  onRequestNotifications,
  onCheckNow
}: Pick<Props, 'runtime' | 'notificationState' | 'onRequestNotifications' | 'onCheckNow'>) {
  const { t } = useT();
  return (
    <Section
      title={t('Mitteilungen')}
      description={
        runtime.desktop
          ? t(
              'Levuvo Mail zeigt neue E-Mails und Terminerinnerungen als Systemmitteilung – auch wenn das Fenster geschlossen ist und die App im Hintergrund (Tray/Menüleiste) läuft. Die Erlaubnis verwaltest du in den Systemeinstellungen deines Betriebssystems.'
            )
          : t('Im Browser braucht Levuvo Mail deine Erlaubnis für Mitteilungen.')
      }
    >
      {!runtime.desktop && (
        <Row label={t('Browser-Mitteilungen')}>
          {notificationState === 'granted' ? (
            <span className="ok-text">
              <Check size={14} /> {t('Erlaubt')}
            </span>
          ) : notificationState === 'unsupported' ? (
            <span>{t('Nicht unterstützt')}</span>
          ) : (
            <button className="btn small" onClick={onRequestNotifications}>
              <Bell size={14} /> {t('Erlauben')}
            </button>
          )}
        </Row>
      )}
      <Row label={t('Jetzt auf neue E-Mails prüfen')}>
        <button className="btn small" onClick={onCheckNow}>
          <RefreshCcw size={14} /> {t('Prüfen')}
        </button>
      </Row>
    </Section>
  );
}

type IndexRun = { at: number; added: number; removed: number; complete: boolean; error: string | null };
type IndexStatus = {
  enabled: boolean;
  running?: boolean;
  runs?: number;
  accounts: {
    accountId: string;
    label: string;
    messages: number;
    folders: number;
    updatedAt: string | null;
    checkedAt?: string | null;
    bytes?: number;
    lastRun?: IndexRun | null;
  }[];
};
function SearchIndex() {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [status, setStatus] = useState<IndexStatus | null>(null);
  // Set by "Update now": the pass number it waits for, so the result can be reported once it ends.
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const load = useCallback(
    () =>
      getJson<IndexStatus>('/api/index/status')
        .then(next => {
          setStatus(next);
          return next;
        })
        .catch(() => {
          setStatus(null);
          return null;
        }),
    []
  );
  useEffect(() => {
    void load();
    const timer = window.setInterval(load, waitingFor !== null ? 1000 : 5000);
    return () => window.clearInterval(timer);
  }, [load, waitingFor]);
  // The pass started by "Update now" ended: say what it found, also when nothing was new.
  useEffect(() => {
    if (waitingFor === null || !status || status.running || (status.runs ?? 0) < waitingFor) return;
    setWaitingFor(null);
    const runs = status.accounts.map(a => a.lastRun).filter((r): r is IndexRun => Boolean(r));
    const failed = runs.filter(r => r.error).length;
    const added = runs.reduce((n, r) => n + r.added, 0);
    const removed = runs.reduce((n, r) => n + r.removed, 0);
    if (failed)
      toast({
        text:
          failed === 1
            ? t('Index aktualisiert, aber ein Konto war nicht erreichbar.')
            : t('Index aktualisiert, aber {count} Konten waren nicht erreichbar.', { count: failed }),
        kind: 'error'
      });
    else if (added || removed)
      toast({
        text: t('Index aktualisiert: {added} neu, {removed} entfernt.', {
          added: added.toLocaleString(locale),
          removed: removed.toLocaleString(locale)
        }),
        kind: 'info'
      });
    else toast({ text: t('Index ist aktuell. Nichts Neues gefunden.'), kind: 'info' });
  }, [status, waitingFor, toast, t, locale]);
  async function setEnabled(enabled: boolean) {
    if (
      !enabled &&
      !(await confirm({
        title: t('Suchindex abschalten?'),
        message: t(
          'Der lokale Index wird gelöscht. Die Suche „Überall“ und das Offline-Lesen sind dann nicht verfügbar.'
        ),
        confirmLabel: t('Abschalten'),
        danger: true
      }))
    )
      return;
    await postJson('/api/app-settings', { localIndex: enabled }, 'mail-v1');
    if (enabled) await postJson('/api/index/sync', {}, 'mail-v1');
    void load();
  }
  async function updateNow() {
    try {
      const { pass } = await postJson<{ pass?: number }>('/api/index/sync', {}, 'mail-v1');
      setWaitingFor(pass ?? (status?.runs ?? 0) + 1);
      void load();
    } catch {
      toast({ text: t('Index konnte nicht aktualisiert werden.'), kind: 'error' });
    }
  }
  const stamp = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
  const updating = waitingFor !== null || Boolean(status?.running);
  return (
    <>
      <Section
        title={t('Suche & Offline')}
        description={t(
          'Levuvo Mail legt einen verschlüsselten Suchindex (AES-256, Schlüssel im Schlüsselbund) auf diesem Gerät an: Volltextsuche über alle Ordner und Konten – auch ohne Internet. Indexiert werden Betreff, Absender und die ersten 3.000 Zeichen Text, keine Anhänge.'
        )}
      >
        <Row label={t('Lokaler Suchindex')}>
          <Toggle
            label={t('Lokaler Suchindex')}
            checked={status?.enabled !== false}
            onChange={v => void setEnabled(v)}
          />
        </Row>
        {status?.enabled &&
          status.accounts.map(a => {
            const checked = a.checkedAt || a.updatedAt;
            return (
              <div className="status-line" key={a.accountId}>
                <Search size={14} />
                <span>
                  <strong>{a.label}</strong>
                  <small>
                    {t('{count} Nachrichten in {folders} Ordnern', {
                      count: (a.messages || 0).toLocaleString(locale),
                      folders: a.folders || 0
                    })}
                    {typeof a.bytes === 'number' && a.bytes > 0 ? ` · ${formatBytes(a.bytes, locale)}` : ''}
                    {updating
                      ? ` · ${t('wird aktualisiert …')}`
                      : checked
                        ? ` · ${t('Stand {time}', { time: stamp(checked) })}`
                        : ` · ${t('wird aufgebaut …')}`}
                    {!updating && a.lastRun?.error ? ` · ${t('letzte Aktualisierung fehlgeschlagen')}` : ''}
                  </small>
                </span>
              </div>
            );
          })}
        {status?.enabled && (
          <div className="settings-actions">
            <button className="btn small" disabled={updating} onClick={() => void updateNow()}>
              <RefreshCcw size={14} className={updating ? 'spin' : ''} />{' '}
              {updating ? t('Wird aktualisiert …') : t('Jetzt aktualisieren')}
            </button>
            <button
              className="btn small"
              disabled={updating}
              onClick={async () => {
                if (await confirm({ title: t('Index neu aufbauen?'), confirmLabel: t('Neu aufbauen') })) {
                  await postJson('/api/index/clear', {}, 'mail-v1');
                  await updateNow();
                }
              }}
            >
              <Trash2 size={14} /> {t('Neu aufbauen')}
            </button>
          </div>
        )}
      </Section>
      <Section
        title={t('Suche nach Bedeutung')}
        description={t(
          'Mit eingeschalteter KI berechnet das lokale Modell für die Suche aus jeder Nachricht im Suchindex einen Eintrag, damit der Assistent Nachrichten auch ohne die genauen Wörter findet. Das passiert immer auf diesem Computer.'
        )}
      >
        <SemanticIndexStatus />
      </Section>
    </>
  );
}

function Privacy({ onOpenAiLog }: { onOpenAiLog: () => void }) {
  const { t } = useT();
  const [settings, setSettings] = useState<{ crashReports: boolean } | null>(null);
  useEffect(() => {
    void getJson<{ crashReports: boolean }>('/api/app-settings')
      .then(setSettings)
      .catch(() => {});
  }, []);
  async function set(crashReports: boolean) {
    setSettings(await postJson('/api/app-settings', { crashReports }, 'mail-v1'));
  }
  return (
    <>
      <PrivacyCockpit onOpenAiLog={onOpenAiLog} />
      <Section
        title={t('Datenschutz')}
        description={t(
          'Levuvo Mail hat keinen eigenen Server und kein Tracking. Deine E-Mails, Kontakte und Termine gehen nur an die Server deiner Anbieter. Updates werden direkt über die GitHub-Releases von Levuvo Mail geprüft.'
        )}
      >
        <Row
          label={t('Absturzberichte senden')}
          hint={t(
            'Freiwillig. Bei einem Absturz wird ein technischer Bericht mit einem Speicherabbild an den Hersteller von Levuvo Mail übermittelt. Das Abbild kann Teile gerade geöffneter E-Mails oder Adressen enthalten. Nur wirksam, wenn dieser Build eine Berichtsadresse enthält; nach Änderung bitte neu starten.'
          )}
        >
          <Toggle
            label={t('Absturzberichte senden')}
            checked={Boolean(settings?.crashReports)}
            onChange={v => void set(v)}
          />
        </Row>
        <Row
          label={t('Diagnosebericht')}
          hint={t(
            'Für den Support: Version, System, Fehlerzähler und Verbindungsstatus. Keine Inhalte, keine Adressen. Du entscheidest, ob du ihn weitergibst.'
          )}
        >
          <button className="btn small" onClick={() => download('/api/diagnostics')}>
            <Download size={14} /> {t('Herunterladen')}
          </button>
        </Row>
      </Section>
      <PrivacyDataSettings />
      <Section
        title={t('Gespeicherte Daten auf diesem Gerät')}
        description={t('Wo Levuvo Mail Daten auf diesem Computer speichert. Der Speicherort lässt sich nicht ändern.')}
      >
        <StorageLocations />
      </Section>
    </>
  );
}

function Help() {
  const { t } = useT();
  const [shortcuts, setShortcuts] = useState(false);
  const topics: [string, string][] = [
    [
      t('Erste Schritte'),
      t(
        'Konto hinzufügen (Einstellungen → Konten). Bei Microsoft 365 und Gmail „Mit Microsoft/Google anmelden“ verwenden, sonst E-Mail-Adresse und Passwort. Die Verbindung wird vor dem Speichern geprüft.'
      )
    ],
    [
      t('Ordner & Ablage'),
      t(
        'Nachrichten per Drag & Drop auf einen Ordner ziehen. Rechtsklick auf einen Ordner: Unterordner anlegen, umbenennen, löschen. Mit dem Stern markierst du wichtige Nachrichten, die Filter oben zeigen Ungelesene, Markierte oder Nachrichten mit Anhang.'
      )
    ],
    [
      t('Senden rückgängig & später senden'),
      t(
        'Nach „Senden“ bleibt die Nachricht einige Sekunden zurückholbar (Einstellungen → Allgemein). Über den Pfeil neben „Senden“ planst du den Versand; geplante Nachrichten liegen in „Entwürfe“ und werden versendet, solange Levuvo Mail läuft (auch im Hintergrund).'
      )
    ],
    [
      t('Befehlspalette & Schnellaktionen'),
      t(
        'Strg/⌘ + K öffnet die Befehlspalette: ein paar Buchstaben tippen, um zu schreiben, zu suchen, einen Ordner, ein Konto oder eine Einstellung zu öffnen. In der Nachrichtenliste erscheinen beim Darüberfahren Archivieren, Löschen, Gelesen und Zurückstellen. Fast jede Aktion lässt sich aus der Meldung unten rückgängig machen.'
      )
    ],
    [
      t('Zurückstellen & Nachfassen'),
      t(
        'Zurückstellen (Taste B) nimmt eine Nachricht aus dem Posteingang und bringt sie zur gewählten Zeit ungelesen zurück. „Nachfassen“ beim Senden erinnert dich, wenn bis dahin keine Antwort kam – zu finden unter „Nachfassen“ in der Ordnerleiste.'
      )
    ],
    [
      t('Phishing-Warnungen'),
      t(
        'Levuvo Mail wertet die Absenderprüfung deines Mailservers (SPF, DKIM, DMARC) aus und warnt vor gefälschten Absendernamen, irreführenden Links und gefährlichen Anhängen. Eine Warnung ist ein Hinweis, kein Beweis – im Zweifel den Absender auf anderem Weg kontaktieren.'
      )
    ],
    [
      t('Filter & Abwesenheit'),
      t(
        'Regeln (z. B. „Von enthält rechnung@ → in Ordner Buchhaltung“) und die Abwesenheitsnotiz laufen direkt auf deinem Mailserver (Sieve) und wirken daher auch, wenn Levuvo Mail geschlossen ist. Voraussetzung: dein Anbieter bietet ManageSieve an.'
      )
    ],
    [
      t('Kalender & Kontakte'),
      t(
        'Microsoft 365 und Google sind über das angemeldete Konto automatisch dabei (einmalig „Zugriff freigeben“). Andere Anbieter verbindest du per CalDAV/CardDAV (z. B. Nextcloud, mailbox.org, iCloud mit App-Passwort, Fastmail). Einladungen in E-Mails beantwortest du direkt in der Nachricht; Termine lassen sich per Drag & Drop verschieben.'
      )
    ],
    [
      t('Verschlüsselung'),
      t(
        'Für jeden Empfänger ohne Einrichtung: beim Schreiben „Mit Passwort schützen“ wählen und das Passwort auf anderem Weg (SMS, Telefon) mitteilen – der Empfänger öffnet die Datei im Browser. OpenPGP: Schlüssel erzeugen oder importieren (Einstellungen → Sicherheit). S/MIME: Zertifikat als .p12 importieren. Beim Verfassen „Signieren“/„Verschlüsseln“ wählen.'
      )
    ],
    [
      t('Offline'),
      t(
        'Ohne Verbindung zeigt Levuvo Mail die zuletzt geladenen Listen und Nachrichten sowie Treffer aus dem lokalen Suchindex. Änderungen (Verschieben, Senden) sind erst wieder online möglich.'
      )
    ]
  ];
  return (
    <>
      <Section
        title={t('Handbuch')}
        description={t(
          'Schritt für Schritt erklärt: Einrichtung, E-Mail, Kalender, Kontakte, Aufgaben, Räume, Assistent und Einstellungen. Fragen dazu beantwortet auch der Assistent.'
        )}
      >
        <ManualView />
      </Section>
      <Section title={t('Kurzhilfe')}>
        {topics.map(([title, text]) => (
          <details key={title} className="help-topic">
            <summary>{title}</summary>
            <p>{text}</p>
          </details>
        ))}
        <div className="settings-actions">
          <button className="btn small" onClick={() => setShortcuts(true)}>
            {t('Tastenkürzel anzeigen')}
          </button>
        </div>
      </Section>
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </>
  );
}

function About({ runtime }: { runtime: Runtime }) {
  const { t } = useT();
  return (
    <>
      <Section title="Levuvo Mail">
        <div className="about-card">
          <img src="/levuvo-header-logo.png" alt="Levuvo Mail" className="brand-image" />
          <div>
            <strong>Levuvo Mail {runtime.version}</strong>
            <small>
              {runtime.desktop ? t('Desktop-App') : t('Browser (Entwicklung)')}
              {runtime.platform ? ` · ${runtime.platform}` : ''}
            </small>
          </div>
        </div>
        <p className="about-motto">Less effort. More impact.</p>
      </Section>
      <Section title={t('Impressum')}>
        <p className="settings-description">
          {t(
            'Angaben gemäß § 5 ECG / § 25 MedienG – bitte vor der Veröffentlichung mit den Firmendaten ersetzen (siehe docs/IMPRESSUM.md).'
          )}
        </p>
        <address className="legal-block">
          Levuvo [Rechtsform]
          <br />
          [Straße Hausnummer]
          <br />
          [PLZ Ort], Österreich
          <br />
          E-Mail: [kontakt@levuvo.at]
          <br />
          [Firmenbuchnummer · Firmenbuchgericht · UID]
        </address>
      </Section>
      <AboutCompliance />
    </>
  );
}

export default function Settings(props: Props) {
  const { t } = useT();
  const tabs: { id: SettingsTab; label: string; icon: typeof Mail }[] = [
    { id: 'general', label: t('Allgemein'), icon: SlidersHorizontal },
    { id: 'accounts', label: t('Konten'), icon: Mail },
    { id: 'templates', label: t('Vorlagen'), icon: FileStack },
    { id: 'filters', label: t('Filter & Abwesenheit'), icon: Filter },
    { id: 'automations', label: t('Automatisierungen'), icon: Workflow },
    { id: 'dav', label: t('Kalender & Kontakte'), icon: CalendarDays },
    { id: 'booking', label: t('Buchungslinks'), icon: CalendarClock },
    { id: 'security', label: t('Sicherheit'), icon: KeyRound },
    { id: 'search', label: t('Suche & Offline'), icon: Search },
    { id: 'ai', label: t('KI & Agenten'), icon: Bot },
    { id: 'notifications', label: t('Mitteilungen'), icon: Bell },
    { id: 'privacy', label: t('Datenschutz'), icon: ShieldCheck },
    { id: 'backup', label: t('Sicherung'), icon: ArchiveRestore },
    { id: 'help', label: t('Hilfe'), icon: BookOpen },
    { id: 'about', label: t('Über'), icon: Info }
  ];
  const current = tabs.find(x => x.id === props.tab) || tabs[0];
  return (
    <div className="settings-module">
      <nav className="settings-nav" aria-label={t('Einstellungen')}>
        <h2>
          {t('Einstellungen')}
          <span className="period">.</span>
        </h2>
        {tabs.map(x => (
          <button
            key={x.id}
            className={props.tab === x.id ? 'active' : ''}
            aria-current={props.tab === x.id ? 'page' : undefined}
            onClick={() => props.onTab(x.id)}
          >
            <x.icon size={16} />
            {x.label}
          </button>
        ))}
      </nav>
      <main className="settings-content">
        <header className="settings-head">
          <h1>
            {current.label}
            <span className="period">.</span>
          </h1>
          <button
            className="icon-button"
            aria-label={t('Schließen')}
            title={t('Zurück zu E-Mail')}
            onClick={props.onClose}
          >
            <X size={20} />
          </button>
        </header>
        {props.tab === 'general' && <General />}
        {props.tab === 'accounts' && (
          <Accounts accounts={props.accounts} pollState={props.pollState} onAccountsChanged={props.onAccountsChanged} />
        )}
        {props.tab === 'templates' && <TemplateSettings />}
        {props.tab === 'filters' && <FiltersSettings accounts={props.accounts} />}
        {props.tab === 'automations' && <AutomationSettings accounts={props.accounts} />}
        {props.tab === 'booking' && <BookingSettings accounts={props.accounts} />}
        {props.tab === 'dav' && <DavSettings />}
        {props.tab === 'security' && <SecuritySettings />}
        {props.tab === 'search' && <SearchIndex />}
        {props.tab === 'ai' && <AiSettingsPanel accounts={props.accounts} />}
        {props.tab === 'notifications' && (
          <Notifications
            runtime={props.runtime}
            notificationState={props.notificationState}
            onRequestNotifications={props.onRequestNotifications}
            onCheckNow={props.onCheckNow}
          />
        )}
        {props.tab === 'privacy' && <Privacy onOpenAiLog={() => props.onTab('ai')} />}
        {props.tab === 'backup' && <BackupSettings />}
        {props.tab === 'help' && <Help />}
        {props.tab === 'about' && <About runtime={props.runtime} />}
      </main>
    </div>
  );
}
