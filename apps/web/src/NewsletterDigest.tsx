import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Newspaper, Sparkles, X } from 'lucide-react';
import { aiEnabled, aiErrorText, runAi, type AiResult } from './ai';
import { ApiError } from './api';
import { IconButton } from './ui';
import { useT } from './i18n';
import { weekOfNewsletters } from './newsletter-week';
import type { Message } from './types';

type Digest = { highlights: string[]; items: { id: string; summary: string }[] };
/**
 * "Wochenüberblick": one AI summary of the week's newsletters instead of reading them one by one.
 * Runs only when the user asks; the result is marked as AI-generated and links to each mail.
 */
export function NewsletterDigest({
  messages,
  accountId,
  folder,
  onOpenMessage
}: {
  messages: Message[];
  accountId: string;
  folder: string;
  onOpenMessage?: (message: Message) => void;
}) {
  const { t, lang } = useT();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState<{ data: AiResult<Digest>; week: Message[] } | null>(null);
  const week = useMemo(() => weekOfNewsletters(messages), [messages]);
  useEffect(() => {
    void aiEnabled('digest').then(setAvailable);
  }, []);
  if (!available || !week.length) return null;

  async function run() {
    setBusy(true);
    setError('');
    try {
      const data = await runAi<Digest>('newsletters', {
        account: accountId,
        refs: week.map(m => ({ folder, uid: m.uid })),
        lang
      });
      setShown({ data, week });
    } catch (err) {
      setError(aiErrorText(err instanceof ApiError ? err.code : undefined, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="newsletter-digest">
      {!shown && (
        <button className="btn small" onClick={() => void run()} disabled={busy}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <Newspaper size={14} />}{' '}
          {t('Wochenüberblick ({count} Newsletter)', { count: week.length })}
        </button>
      )}
      {error && (
        <div className="reader-security warning" role="status">
          {error}
        </div>
      )}
      {shown && (
        <div className="reader-ai-card" role="region" aria-live="polite" aria-label={t('Wochenüberblick')}>
          <div className="reader-ai-head">
            <span className="ai-label" title={t('Von einer KI erstellt. Bitte prüfen.')}>
              <Sparkles size={12} /> {t('KI-generiert')} · {shown.data.model}
            </span>
            <IconButton size="sm" label={t('Schließen')} icon={<X size={14} />} onClick={() => setShown(null)} />
          </div>
          {shown.data.result.highlights.length > 0 && (
            <ul className="ai-summary">
              {shown.data.result.highlights.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          <ul className="newsletter-digest-items">
            {shown.data.result.items.map(item => {
              const m = shown.week[Number(item.id.slice(1)) - 1];
              if (!m) return null;
              return (
                <li key={item.id}>
                  <button type="button" className="text-button" onClick={() => onOpenMessage?.(m)}>
                    {m.fromName || m.fromEmail}
                  </button>
                  <span>{item.summary}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
