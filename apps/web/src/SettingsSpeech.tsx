// Settings → AI & agents → Dictation: choose a Whisper model from the fixed list; choosing it downloads
// it (checked against pinned SHA-256 sums). Speech is turned into text on this device only.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, Trash2, X } from 'lucide-react';
import { postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button } from './ui';
import { Row } from './Settings';
import { formatSize } from './SettingsLocalModels';
import { speechModels, type SpeechModel, type SpeechState } from './speech';

const QUALITY: Record<SpeechModel['quality'], string> = {
  fast: 'Schnell',
  balanced: 'Ausgewogen',
  best: 'Am genauesten'
};

export function SpeechSettings() {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [state, setState] = useState<SpeechState | null>(null);
  const load = useCallback(
    () =>
      speechModels()
        .then(setState)
        .catch(() => setState(null)),
    []
  );
  useEffect(() => {
    void load();
  }, [load]);
  const running = state?.models.some(m => m.job?.state === 'running');
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(timer);
  }, [running, load]);

  if (!state) return null;
  async function act(action: 'download' | 'cancel' | 'delete', model: string) {
    try {
      await postJson(`/api/ai/speech/${action}`, { model }, 'ai-v1');
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    }
    await load();
  }
  const selected = state.models.find(m => m.id === state.selected) || null;
  const job = selected?.job;
  const pct = job && job.total ? Math.floor((job.completed / job.total) * 100) : 0;
  return (
    <>
      <Row
        label={t('Spracherkennung')}
        hint={t(
          'Whisper wandelt deine Sprache auf diesem Gerät in Text um. Die Aufnahme wird weder gespeichert noch gesendet. Das Modell wird einmal heruntergeladen und mit seiner festen Prüfsumme verglichen.'
        )}
      >
        <select
          aria-label={t('Spracherkennung')}
          value={state.selected || ''}
          disabled={Boolean(running)}
          onChange={e => {
            const id = e.target.value;
            if (id) void act('download', id);
          }}
        >
          <option value="">{t('Kein Modell (Diktieren aus)')}</option>
          {state.models.map(m => (
            <option key={m.id} value={m.id}>
              {m.name} · {t(QUALITY[m.quality])} · {formatSize(m.size, locale)}
              {m.device === 'webgpu' ? ` · ${t('braucht Grafikkarte')}` : ''}
            </option>
          ))}
        </select>
      </Row>
      {selected && (
        <div className="local-model-status" role="status" aria-live="polite">
          {job?.state === 'running' ? (
            <>
              <span>{t('{name} wird geladen … {pct} %', { name: selected.name, pct })}</span>
              <progress max={100} value={pct} aria-label={t('Fortschritt')} />
              <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => void act('cancel', selected.id)}>
                {t('Abbrechen')}
              </Button>
            </>
          ) : selected.installed ? (
            <>
              <span>
                <CheckCircle2 size={14} aria-hidden="true" />{' '}
                {t('{name} ist bereit. Lizenz {license}.', { name: selected.name, license: selected.license })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={14} />}
                onClick={async () => {
                  const ok = await confirm({
                    title: t('{name} löschen?', { name: selected.name }),
                    message: t('Diktieren ist danach aus, bis du wieder ein Modell wählst.'),
                    confirmLabel: t('Löschen'),
                    danger: true
                  });
                  if (ok) void act('delete', selected.id);
                }}
              >
                {t('Löschen')}
              </Button>
            </>
          ) : (
            <>
              <span>
                {job?.state === 'error'
                  ? t('Der Download ist fehlgeschlagen. Bitte erneut versuchen.')
                  : t('{name} ist noch nicht heruntergeladen.', { name: selected.name })}
              </span>
              <Button size="sm" icon={<Download size={14} />} onClick={() => void act('download', selected.id)}>
                {t('Herunterladen')}
              </Button>
            </>
          )}
        </div>
      )}
    </>
  );
}
