import { useCallback, useEffect, useRef, useState } from 'react';
import { ArchiveRestore, Check, Download, LoaderCircle, RotateCcw, Upload, X } from 'lucide-react';
import { getJson, postForBlob, postJson, saveBlob } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { prefsForBackup, restorePrefs } from './prefs';
import { Section } from './Settings';

const MIN_PASSWORD = 12;

type Status = {
  vaultAvailable: boolean;
  canRestart: boolean;
  pending: { createdAt: string; stagedAt: string } | null;
  restored: { createdAt: string; appliedAt: string } | null;
};
type Summary = {
  accounts: number;
  davAccounts: number;
  calendars: number;
  events: number;
  contacts: number;
  templates: number;
  snoozed: number;
  followups: number;
  ownKeys: number;
  settings: boolean;
  assistant: boolean;
  spaces?: number;
};
type RestoreResult = { createdAt: string; summary: Summary; uiPrefs: unknown; canRestart: boolean };

const backupName = () => `levuvo-backup-${new Date().toISOString().slice(0, 10)}.levuvo`;

/** `restoreOnly`: on the welcome screen of a new computer, before any account exists. */
export function BackupSettings({ restoreOnly = false }: { restoreOnly?: boolean }) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [status, setStatus] = useState<Status | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [busy, setBusy] = useState<'' | 'create' | 'restore' | 'restart' | 'cancel'>('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<RestoreResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const load = useCallback(() => getJson<Status>('/api/backup/status').then(setStatus), []);
  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  const passwordProblem =
    password.length > 0 && [...password].length < MIN_PASSWORD
      ? t('Mindestens {count} Zeichen.', { count: MIN_PASSWORD })
      : repeat && repeat !== password
        ? t('Die Passwörter stimmen nicht überein.')
        : '';

  async function create() {
    setBusy('create');
    setError('');
    try {
      const blob = await postForBlob('/api/backup/create', { password, uiPrefs: prefsForBackup() }, 'backup-v1');
      saveBlob(blob, backupName());
      setPassword('');
      setRepeat('');
      toast({ text: t('Sicherung erstellt. Bewahre sie an einem zweiten Ort auf.'), kind: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function restore() {
    if (!file) return;
    setError('');
    let createdAt: string;
    let text: string;
    try {
      text = await file.text();
      createdAt = String(JSON.parse(text)?.createdAt || '');
    } catch {
      setError(t('Das ist keine Sicherung von Levuvo Mail.'));
      return;
    }
    const ok = await confirm({
      title: t('Sicherung wiederherstellen?'),
      message: t(
        'Einstellungen, Konten, lokale Kontakte und Kalender, Vorlagen, Wiedervorlagen, eigene Schlüssel, Räume und Assistent-Daten auf diesem Gerät werden durch die Sicherung vom {date} ersetzt. Die bisherigen Daten werden vorher als Sicherheitskopie aufbewahrt. Levuvo Mail startet danach neu.',
        { date: createdAt ? when(createdAt) : '–' }
      ),
      confirmLabel: t('Wiederherstellen'),
      danger: true
    });
    if (!ok) return;
    setBusy('restore');
    try {
      const done = await postJson<RestoreResult>(
        '/api/backup/restore',
        { file: text, password: restorePassword },
        'backup-v1'
      );
      // View preferences live in the app window; they are taken over before the restart.
      restorePrefs(done.uiPrefs);
      setResult(done);
      setRestorePassword('');
      setFile(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function restart() {
    setBusy('restart');
    setError('');
    try {
      await postJson('/api/backup/restart', {}, 'backup-v1');
    } catch (e) {
      setError((e as Error).message);
      setBusy('');
    }
  }

  async function cancel() {
    setBusy('cancel');
    try {
      await postJson('/api/backup/cancel', {}, 'backup-v1');
      setResult(null);
      await load();
      toast({ text: t('Wiederherstellung abgebrochen. Es wurde nichts geändert.'), kind: 'info' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const summaryLines = (s: Summary) =>
    [
      t('{count} E-Mail-Konten (ohne Passwörter)', { count: s.accounts }),
      s.davAccounts ? t('{count} Kalender-/Kontaktkonten (ohne Passwörter)', { count: s.davAccounts }) : '',
      t('{count} Termine in {calendars} lokalen Kalendern', { count: s.events, calendars: s.calendars }),
      t('{count} lokale Kontakte', { count: s.contacts }),
      t('{count} Vorlagen', { count: s.templates }),
      t('{count} Wiedervorlagen und {followups} Antwort-Erinnerungen', { count: s.snoozed, followups: s.followups }),
      s.ownKeys ? t('{count} eigene Schlüssel (PGP/S/MIME)', { count: s.ownKeys }) : '',
      s.assistant ? t('Einstellungen und Protokoll des Assistenten') : '',
      s.spaces ? t('{count} gemeinsame Räume', { count: s.spaces }) : ''
    ].filter(Boolean);

  const pending = status?.pending;
  return (
    <>
      {status && !status.vaultAvailable && (
        <p className="compose-warning">
          {t(
            'Der Schlüsselbund ist nicht verfügbar. Sichern und Wiederherstellen sind erst möglich, wenn er erreichbar ist.'
          )}
        </p>
      )}
      {status?.restored && (
        <p className="managed-notice">
          <Check size={14} />{' '}
          {t(
            'Wiederhergestellt aus der Sicherung vom {date}. Passwörter und Anmeldungen bitte unter Konten neu eingeben, falls nötig.',
            {
              date: when(status.restored.createdAt)
            }
          )}
        </p>
      )}
      {(pending || result) && (
        <Section
          title={t('Wiederherstellung bereit')}
          description={t(
            'Die Sicherung vom {date} wurde geprüft. Sie wird beim Neustart übernommen; bis dahin sind keine Änderungen möglich.',
            { date: when(result?.createdAt || pending!.createdAt) }
          )}
        >
          {result && (
            <ul className="plain-list">
              {summaryLines(result.summary).map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {status && !status.canRestart && (
            <p className="managed-hint">{t('Bitte Levuvo Mail jetzt beenden und neu starten.')}</p>
          )}
          <div className="settings-actions">
            {status?.canRestart && (
              <button className="btn primary small" disabled={Boolean(busy)} onClick={() => void restart()}>
                {busy === 'restart' ? <LoaderCircle size={14} className="spin" /> : <RotateCcw size={14} />}{' '}
                {t('Jetzt neu starten')}
              </button>
            )}
            <button className="btn small" disabled={Boolean(busy)} onClick={() => void cancel()}>
              <X size={14} /> {t('Abbrechen')}
            </button>
          </div>
        </Section>
      )}

      {!restoreOnly && (
        <>
          <Section
            title={t('Sicherung erstellen')}
            description={t(
              'Sichert alles, was nur auf diesem Gerät liegt: Einstellungen, Konten (ohne Passwörter), lokale Kontakte, lokalen Kalender mit Anhängen, Vorlagen, Wiedervorlagen, eigene PGP/S/MIME-Schlüssel, gemeinsame Räume und die Daten des Assistenten. Die Datei ist mit deinem Passwort verschlüsselt (AES-256). Ohne dieses Passwort lässt sie sich nicht öffnen, auch nicht von Levuvo Mail.'
            )}
          >
            <div className="managed-field-grid backup-fields">
              <label>
                {t('Passwort für die Sicherung')}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </label>
              <label>
                {t('Passwort wiederholen')}
                <input
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={e => setRepeat(e.target.value)}
                />
              </label>
            </div>
            {passwordProblem && <p className="managed-hint">{passwordProblem}</p>}
            <p className="managed-hint">
              {t(
                'Speichere die Datei an einem zweiten Ort (USB-Stick, NAS, Cloud-Ordner) und notiere das Passwort sicher. Passwörter der Postfächer, Anmeldungen und API-Schlüssel sind nicht enthalten; der Suchindex wird neu aufgebaut.'
              )}
            </p>
            <div className="settings-actions">
              <button
                className="btn primary small"
                disabled={
                  Boolean(busy) ||
                  Boolean(pending) ||
                  !status?.vaultAvailable ||
                  [...password].length < MIN_PASSWORD ||
                  password !== repeat
                }
                onClick={() => void create()}
              >
                {busy === 'create' ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}{' '}
                {t('Sicherung speichern')}
              </button>
            </div>
          </Section>
        </>
      )}

      <Section
        title={t('Wiederherstellen oder auf neuen Rechner umziehen')}
        description={t(
          'Wähle eine Sicherung von Levuvo Mail (.levuvo) und gib ihr Passwort ein. Die Daten werden geprüft und beim Neustart übernommen. Danach die Passwörter der Konten einmal neu eingeben.'
        )}
      >
        <div className="settings-actions">
          <button className="btn small" disabled={Boolean(busy)} onClick={() => fileInput.current?.click()}>
            <Upload size={14} /> {file ? file.name : t('Sicherungsdatei wählen')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".levuvo,application/octet-stream,application/json"
            hidden
            onChange={e => {
              setFile(e.target.files?.[0] || null);
              setError('');
              e.target.value = '';
            }}
          />
        </div>
        {file && (
          <div className="managed-field-grid backup-fields">
            <label>
              {t('Passwort der Sicherung')}
              <input
                type="password"
                autoComplete="off"
                value={restorePassword}
                onChange={e => setRestorePassword(e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="settings-actions">
          <button
            className="btn small"
            disabled={Boolean(busy) || !file || !restorePassword || !status?.vaultAvailable}
            onClick={() => void restore()}
          >
            {busy === 'restore' ? <LoaderCircle size={14} className="spin" /> : <ArchiveRestore size={14} />}{' '}
            {t('Wiederherstellen')}
          </button>
        </div>
      </Section>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
