// Settings for video calls: which Jitsi server new call links use (empty = the EU default).
import { useEffect, useState } from 'react';
import { postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Row, Section } from './Settings';
import { loadVideoSettings, setVideoSettings } from './VideoCall';
import type { VideoSettings as VideoSettingsState } from './video-call';

/** Settings: which Jitsi server new call links use. */
export function VideoSettings() {
  const { t } = useT();
  const { toast } = useUi();
  const [state, setState] = useState<VideoSettingsState | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadVideoSettings()
      .then(s => {
        setState(s);
        setValue(s.custom);
      })
      .catch(err => setError((err as Error).message));
  }, []);
  const save = async (server: string) => {
    setBusy(true);
    setError('');
    try {
      const next = await postJson<VideoSettingsState>('/api/video/settings', { server }, 'mail-v1');
      setVideoSettings(next);
      setState(next);
      setValue(next.custom);
      toast({ kind: 'info', text: t('Gespeichert.') });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title={t('Videocalls')}
      description={t(
        'Levuvo Mail erstellt Links für Videocalls mit Jitsi Meet, mit einem zufälligen Raumnamen, den niemand erraten kann. Der Call selbst läuft im Browser. Standard ist ein Server in Deutschland (Freifunk München); du kannst auch einen eigenen Jitsi-Server eintragen.'
      )}
    >
      <Row
        label={t('Jitsi-Server')}
        hint={
          state
            ? t('Leer lassen für den Standard: {server}', { server: state.defaultServer.replace('https://', '') })
            : undefined
        }
        wide
      >
        <form
          className="video-server-form"
          onSubmit={e => {
            e.preventDefault();
            void save(value);
          }}
        >
          <input
            type="url"
            inputMode="url"
            placeholder={state?.defaultServer || 'https://'}
            value={value}
            maxLength={300}
            aria-invalid={error ? true : undefined}
            onChange={e => setValue(e.target.value)}
          />
          <button type="submit" className="btn small" disabled={busy || !state}>
            {t('Speichern')}
          </button>
          {state?.custom && (
            <button type="button" className="btn small ghost" disabled={busy} onClick={() => void save('')}>
              {t('Standard verwenden')}
            </button>
          )}
        </form>
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        {state && (
          <small className="muted">
            {t('Neue Links verwenden: {server}', { server: state.server.replace('https://', '') })}
          </small>
        )}
      </Row>
    </Section>
  );
}
