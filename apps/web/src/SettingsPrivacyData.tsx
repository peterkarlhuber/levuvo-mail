// Settings → Privacy: "Your data" – automatic updates (CRA Annex I Part I (2)(c)), a readable
// export of the device-local data (GDPR Art. 15/20) and "Delete all data on this device"
// (GDPR Art. 17, CRA Annex I Part I (2)(m)). Server side: routes-data-rights.mjs.
import { useEffect, useState } from 'react';
import { Download, LoaderCircle, Trash2 } from 'lucide-react';
import { download, getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Row, Section, Toggle } from './Settings';

type WipeStatus = { pending: boolean; canRestart: boolean; done: { secretsComplete: boolean } | null };

export function PrivacyDataSettings() {
  const { t } = useT();
  const { confirm, toast } = useUi();
  const [autoUpdates, setAutoUpdates] = useState<boolean | null>(null);
  const [wipe, setWipe] = useState<WipeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void getJson<{ autoUpdates?: boolean }>('/api/app-settings')
      .then(s => setAutoUpdates(s.autoUpdates !== false))
      .catch(() => {});
    void getJson<WipeStatus>('/api/privacy/delete-all')
      .then(setWipe)
      .catch(() => {});
  }, []);

  async function setUpdates(value: boolean) {
    if (
      !value &&
      !(await confirm({
        title: t('Automatische Updates ausschalten?'),
        message: t(
          'Sicherheitsupdates schließen bekannte Lücken. Ohne automatische Installation musst du jedes Update selbst laden und installieren, sonst bleibt Levuvo Mail angreifbar.'
        ),
        confirmLabel: t('Ausschalten')
      }))
    )
      return;
    const next = await postJson<{ autoUpdates?: boolean }>('/api/app-settings', { autoUpdates: value }, 'mail-v1');
    setAutoUpdates(next.autoUpdates !== false);
  }

  async function deleteAll() {
    setError('');
    const ok = await confirm({
      title: t('Alle Daten auf diesem Gerät löschen?'),
      message: t(
        'Levuvo Mail löscht alles, was es auf diesem Computer gespeichert hat: Einstellungen, Konten, lokalen Kalender, Kontakte, Aufgaben, Vorlagen, Räume, Suchindex, Assistent-Daten und Modelle sowie die Einträge im Schlüsselbund. E-Mails, Termine und Kontakte auf den Servern deiner Anbieter bleiben unverändert. Das lässt sich nicht rückgängig machen; erstelle vorher eine Sicherung, wenn du die Daten noch brauchst. Levuvo Mail startet danach neu.'
      ),
      confirmLabel: t('Alles löschen'),
      danger: true
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await postJson<{ pending: boolean; restarting: boolean }>(
        '/api/privacy/delete-all',
        { confirm: 'delete-all' },
        'privacy-v1'
      );
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* storage unavailable */
      }
      setWipe(w => ({ pending: true, canRestart: res.restarting, done: w?.done ?? null }));
      if (!res.restarting) toast({ text: t('Bitte Levuvo Mail jetzt beenden und neu starten.'), kind: 'info' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const res = await postJson<{ pending: boolean }>('/api/privacy/delete-all/cancel', {}, 'privacy-v1');
    setWipe(w => (w ? { ...w, pending: res.pending } : w));
  }

  return (
    <Section title={t('Deine Daten')}>
      <Row
        label={t('Updates automatisch installieren')}
        hint={t(
          'Empfohlen. Sicherheitsupdates werden geladen und beim Beenden installiert; „Später“ verschiebt die Installation. Ausgeschaltet fragt Levuvo Mail vor jedem Download. Nur in signierten Versionen mit Update-Funktion.'
        )}
      >
        <Toggle
          label={t('Updates automatisch installieren')}
          checked={autoUpdates !== false}
          onChange={v => void setUpdates(v)}
        />
      </Row>
      <Row
        label={t('Meine Daten exportieren')}
        hint={t(
          'Lesbare Kopie (JSON) der Daten, die nur auf diesem Gerät liegen: Einstellungen, Konten ohne Passwörter, lokaler Kalender, Kontakte, Aufgaben, Vorlagen, Wiedervorlagen, Assistent-Daten. Ohne private Schlüssel und Passwörter. Die Datei ist nicht verschlüsselt.'
        )}
      >
        <button className="btn small" onClick={() => download('/api/privacy/export')}>
          <Download size={14} /> {t('Exportieren')}
        </button>
      </Row>
      <Row
        label={t('Alle Daten auf diesem Gerät löschen')}
        hint={t(
          'Setzt Levuvo Mail auf diesem Computer vollständig zurück und entfernt die Einträge im Schlüsselbund. Daten bei deinen Anbietern bleiben erhalten.'
        )}
      >
        {wipe?.pending ? (
          <div className="settings-actions">
            <span role="status">
              {wipe.canRestart
                ? t('Wird beim Neustart gelöscht …')
                : t('Wird beim nächsten Start gelöscht. Bitte Levuvo Mail beenden und neu starten.')}
            </span>
            <button className="btn small" onClick={() => void cancel()}>
              {t('Abbrechen')}
            </button>
          </div>
        ) : (
          <button className="btn small danger" disabled={busy} onClick={() => void deleteAll()}>
            {busy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />} {t('Alles löschen')}
          </button>
        )}
      </Row>
      {wipe?.done && !wipe.done.secretsComplete && (
        <p className="settings-description" role="alert">
          {t(
            'Die Daten wurden gelöscht, aber nicht alle Einträge im Schlüsselbund ließen sich entfernen. Bitte in der Schlüsselbundverwaltung (macOS) bzw. der Anmeldeinformationsverwaltung (Windows) die Einträge „at.levuvo.mail“ löschen.'
          )}
        </p>
      )}
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
    </Section>
  );
}

/** Settings → AI & agents: machine-readable marking of AI-written mails (AI Act Art. 50(2)). */
export function AiMarkingSetting() {
  const { t } = useT();
  const { confirm } = useUi();
  const [mark, setMark] = useState<boolean | null>(null);
  useEffect(() => {
    void getJson<{ markAiAssisted?: boolean }>('/api/app-settings')
      .then(s => setMark(s.markAiAssisted !== false))
      .catch(() => {});
  }, []);
  async function set(value: boolean) {
    if (
      !value &&
      !(await confirm({
        title: t('Kennzeichnung ausschalten?'),
        message: t(
          'Der EU AI Act (Art. 50) verlangt, dass KI-erzeugte Texte maschinenlesbar erkennbar sind. Ausschalten ist nur vertretbar, wenn du Texte des Assistenten immer selbst wesentlich überarbeitest. Selbst geschriebene Mails werden ohnehin nie gekennzeichnet.'
        ),
        confirmLabel: t('Ausschalten')
      }))
    )
      return;
    const next = await postJson<{ markAiAssisted?: boolean }>(
      '/api/app-settings',
      { markAiAssisted: value },
      'mail-v1'
    );
    setMark(next.markAiAssisted !== false);
  }
  return (
    <Section title={t('Kennzeichnung')}>
      <Row
        label={t('KI-geschriebene Mails kennzeichnen')}
        hint={t(
          'Empfohlen (EU AI Act Art. 50). Mails, deren Text der Assistent oder ein Agent geschrieben hat, bekommen beim Senden die unsichtbare Kopfzeile „X-Levuvo-AI-Assisted“. Nur ausschalten, wenn du solche Texte immer selbst wesentlich überarbeitest.'
        )}
      >
        <Toggle label={t('KI-geschriebene Mails kennzeichnen')} checked={mark !== false} onChange={v => void set(v)} />
      </Row>
    </Section>
  );
}
