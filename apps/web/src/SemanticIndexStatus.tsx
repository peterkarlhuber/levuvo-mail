// Status of the semantic search index (vectors of the local embedding model): not there (with the
// reason), running with "x of y" and the remaining time, paused, done, or failed. Shown in
// Settings → AI & agents, Settings → Search & offline and, compact, below the search field.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Pause, Play, RefreshCcw, Sparkles } from 'lucide-react';
import { ApiError, getJson, postJson } from './api';
import { aiErrorText } from './ai-errors';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button } from './ui';

export type SemanticIndexState = 'none' | 'running' | 'paused' | 'pending' | 'done' | 'error';
export type SemanticIndexReason =
  'ai_off' | 'search_off' | 'model_missing' | 'index_off' | 'no_messages' | 'not_started' | null;
export type SemanticIndexOverview = {
  state: SemanticIndexState;
  reason: SemanticIndexReason;
  model: string;
  paused: boolean;
  messages: number;
  vectors: number;
  etaSeconds: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  error: { code: string; at: number } | null;
};

/** Polls the status: every 1.5 s while the index is built, every 15 s otherwise. */
export function useSemanticIndexStatus(active = true) {
  const [status, setStatus] = useState<SemanticIndexOverview | null>(null);
  const load = useCallback(async () => {
    try {
      setStatus(await getJson<SemanticIndexOverview>('/api/ai/index-status'));
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    void load();
  }, [active, load]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void load(), status?.state === 'running' ? 1500 : 15000);
    return () => window.clearTimeout(timer);
  }, [active, status, load]);
  return { status, setStatus, reload: load };
}

/** "noch etwa 4 Minuten" / "about 4 minutes left". */
export function remainingText(seconds: number, t: ReturnType<typeof useT>['t']) {
  if (seconds < 60) return t('noch weniger als 1 Minute');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? t('noch etwa 1 Minute') : t('noch etwa {n} Minuten', { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m
    ? t('noch etwa {h} Std. {m} Min.', { h, m })
    : h === 1
      ? t('noch etwa 1 Stunde')
      : t('noch etwa {h} Stunden', { h });
}

export function reasonText(reason: SemanticIndexReason, t: ReturnType<typeof useT>['t']) {
  switch (reason) {
    case 'ai_off':
      return t('Nicht vorhanden: Die KI-Funktionen sind ausgeschaltet (Einstellungen → KI & Agenten).');
    case 'search_off':
      return t('Nicht vorhanden: Die Suche nach Bedeutung ist ausgeschaltet (KI & Agenten → Funktionen).');
    case 'model_missing':
      return t('Nicht vorhanden: Das Modell für die Suche ist noch nicht heruntergeladen.');
    case 'index_off':
      return t('Nicht vorhanden: Der lokale Suchindex ist ausgeschaltet (Einstellungen → Suche & Offline).');
    case 'no_messages':
      return t(
        'Noch nicht vorhanden: Der lokale Suchindex hat noch keine Nachrichten. Er wird im Hintergrund aufgebaut.'
      );
    default:
      return t('Noch nicht vorhanden. Der Aufbau startet automatisch in den nächsten Minuten.');
  }
}

/**
 * @param compact  one quiet line without buttons (below the search field); hidden when the index
 *                 is done or AI search is off.
 */
export function SemanticIndexStatus({ compact = false, active = true }: { compact?: boolean; active?: boolean }) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const { status, setStatus } = useSemanticIndexStatus(active);
  const [busy, setBusy] = useState(false);
  if (!status?.state) return null;
  const n = (v: number) => v.toLocaleString(locale);
  const pct = status.messages ? Math.min(100, Math.floor((status.vectors / status.messages) * 100)) : 0;
  const time = (ms: number) => new Date(ms).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

  async function act(action: 'pause' | 'resume' | 'rebuild') {
    if (action === 'rebuild') {
      const ok = await confirm({
        title: t('Suchindex neu aufbauen?'),
        message: t(
          'Alle Einträge für die Suche nach Bedeutung werden verworfen und mit dem gewählten Modell neu berechnet. Bis dahin findet die Suche nach Bedeutung weniger.'
        ),
        confirmLabel: t('Neu aufbauen')
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      setStatus(await postJson<SemanticIndexOverview>(`/api/ai/index/${action}`, {}, 'ai-v1'));
    } catch (err) {
      toast({ text: aiErrorText((err as ApiError).code, t), kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  let text: string;
  switch (status.state) {
    case 'running':
      text = [
        t('Läuft: {done} von {total} Nachrichten ({pct} %)', {
          done: n(status.vectors),
          total: n(status.messages),
          pct
        }),
        status.etaSeconds !== null ? remainingText(status.etaSeconds, t) : t('Restzeit wird berechnet …')
      ].join(' · ');
      break;
    case 'paused':
      text = t('Pausiert bei {done} von {total} Nachrichten.', { done: n(status.vectors), total: n(status.messages) });
      break;
    case 'pending':
      text = t('Unvollständig: {done} von {total} Nachrichten. Der Rest folgt beim nächsten Durchlauf.', {
        done: n(status.vectors),
        total: n(status.messages)
      });
      break;
    case 'done':
      text = status.finishedAt
        ? t('Fertig: {total} Nachrichten durchsuchbar · Stand {time}', {
            total: n(status.messages),
            time: time(status.finishedAt)
          })
        : t('Fertig: {total} Nachrichten durchsuchbar', { total: n(status.messages) });
      break;
    case 'error':
      text = t('Fehler: {reason} Bisher {done} von {total} Nachrichten.', {
        reason: aiErrorText(status.error?.code, t),
        done: n(status.vectors),
        total: n(status.messages)
      });
      break;
    default:
      text = reasonText(status.reason, t);
  }

  if (compact) {
    if (status.state === 'done' || status.reason === 'ai_off' || status.reason === 'search_off') return null;
    return (
      <p className={`semantic-index-hint${status.state === 'error' ? ' error' : ''}`} role="status" aria-live="polite">
        <Sparkles size={12} aria-hidden="true" />
        <span>
          {t('Suche nach Bedeutung')}: {text}
        </span>
      </p>
    );
  }

  const tone =
    status.state === 'done' ? ' ok' : status.state === 'error' ? ' error' : status.state === 'paused' ? ' warn' : '';
  const icon =
    status.state === 'done' ? (
      <CheckCircle2 size={14} aria-hidden="true" />
    ) : status.state === 'error' ? (
      <AlertTriangle size={14} aria-hidden="true" />
    ) : status.state === 'paused' ? (
      <Pause size={14} aria-hidden="true" />
    ) : (
      <Sparkles size={14} aria-hidden="true" />
    );
  const canRun = !['ai_off', 'search_off', 'model_missing', 'index_off', 'no_messages'].includes(status.reason || '');
  return (
    <div className={`local-model-status semantic-index-status${tone}`} role="status" aria-live="polite">
      {icon}
      <span>
        <strong>{t('Suchindex für die Suche nach Bedeutung')}</strong> {text}
      </span>
      {status.state === 'running' && <progress max={100} value={pct} aria-label={t('Fortschritt des Suchindex')} />}
      <span className="semantic-index-actions">
        {status.state === 'running' && (
          <Button size="sm" icon={<Pause size={14} />} disabled={busy} onClick={() => void act('pause')}>
            {t('Pausieren')}
          </Button>
        )}
        {(status.state === 'paused' ||
          status.state === 'pending' ||
          status.state === 'error' ||
          (status.state === 'none' && status.reason === 'not_started')) && (
          <Button size="sm" icon={<Play size={14} />} disabled={busy} onClick={() => void act('resume')}>
            {status.state === 'paused'
              ? t('Fortsetzen')
              : status.state === 'error'
                ? t('Erneut versuchen')
                : t('Jetzt indexieren')}
          </Button>
        )}
        {canRun && status.messages > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCcw size={14} />}
            disabled={busy}
            onClick={() => void act('rebuild')}
          >
            {t('Neu indexieren')}
          </Button>
        )}
      </span>
    </div>
  );
}
