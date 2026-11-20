// Suggestions of the commitment tracker (server: commitments.mjs). An own promise from a sent mail
// becomes a task with one click; a promise someone made to you becomes a reminder that fires when
// nothing arrives. Found by the AI (labelled, EU AI Act Art. 50); nothing is created without a click.
import { useCallback, useEffect, useState } from 'react';
import { BellPlus, Handshake, ListPlus, Sparkles, X } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { reminderFor } from './day-utils';
import { useT } from './i18n';
import { tasksChanged } from './TaskDialog';
import { formatTaskDate } from './tasks';
import { Button } from './ui';

export type Commitment = {
  id: string;
  accountId: string;
  accountLabel: string;
  folder: string;
  uid: number;
  subject: string;
  direction: 'mine' | 'theirs';
  what: string;
  who: string;
  whoName: string;
  due: string | null;
  quote: string;
};
type Answer = { enabled: boolean; local: boolean; items: Commitment[] };

const CHANGED = 'levuvo:commitments-changed';

/** Open suggestions; reloads when one is accepted or dismissed anywhere in the app. */
export function useCommitments() {
  const { lang } = useT();
  const [data, setData] = useState<Answer | null>(null);
  const load = useCallback(async () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const r = await getJson<Answer>(`/api/commitments?lang=${lang}&tz=${encodeURIComponent(tz)}`).catch(() => null);
    setData(r && Array.isArray(r.items) ? r : null);
  }, [lang]);
  useEffect(() => {
    void load();
    window.addEventListener(CHANGED, load);
    window.addEventListener('levuvo:tasks-changed', load);
    return () => {
      window.removeEventListener(CHANGED, load);
      window.removeEventListener('levuvo:tasks-changed', load);
    };
  }, [load]);
  return { data, reload: load };
}

export function CommitmentList({
  items,
  onOpenMail,
  compact = false
}: {
  items: Commitment[];
  onOpenMail?: (c: Commitment) => void;
  compact?: boolean;
}) {
  const { t, locale } = useT();
  const { toast } = useUi();
  const [busy, setBusy] = useState('');
  if (!items.length) return null;
  const when = (d: string) => formatTaskDate(locale, d, { weekday: 'short' });

  async function act(c: Commitment, action: 'accept' | 'dismiss') {
    setBusy(c.id);
    try {
      const body: Record<string, unknown> = { id: c.id };
      if (action === 'accept' && c.direction === 'theirs') body.remindAt = reminderFor(c.due).toISOString();
      await postJson(`/api/commitments/${action}`, body, 'ai-v1');
      window.dispatchEvent(new Event(CHANGED));
      if (action === 'accept') {
        if (c.direction === 'mine') tasksChanged();
        toast({
          text:
            c.direction === 'mine'
              ? t('Aufgabe angelegt.')
              : t('Erinnerung am {when}, falls bis dahin nichts kommt.', {
                  when: when(reminderFor(c.due).toISOString())
                }),
          kind: 'success'
        });
      }
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    } finally {
      setBusy('');
    }
  }

  return (
    <div className={`commitments ${compact ? 'is-compact' : ''}`}>
      <p className="ai-label" title={t('Von einer KI erstellt. Bitte prüfen.')}>
        <Sparkles size={12} aria-hidden="true" /> {t('Von der KI in deinen Mails gefunden. Bitte prüfen.')}
      </p>
      <ul>
        {items.map(c => (
          <li key={c.id} className="commitment">
            <Handshake size={15} aria-hidden="true" className="commitment-icon" />
            <div className="commitment-main">
              <strong>{c.what}</strong>
              <span className="commitment-meta">
                {c.direction === 'mine'
                  ? t('Du hast {who} zugesagt', { who: c.who || t('jemandem') })
                  : t('{who} hat dir zugesagt', { who: c.whoName || c.who || t('Jemand') })}
                {c.due ? ` · ${t('bis {when}', { when: when(c.due) })}` : ''}
              </span>
              {!compact && c.quote && <q className="commitment-quote">{c.quote}</q>}
              {onOpenMail && (
                <button type="button" className="link-button commitment-mail" onClick={() => onOpenMail(c)}>
                  {c.subject || t('(Ohne Betreff)')}
                </button>
              )}
            </div>
            <div className="commitment-actions">
              <Button
                size="sm"
                busy={busy === c.id}
                icon={c.direction === 'mine' ? <ListPlus size={13} /> : <BellPlus size={13} />}
                onClick={() => void act(c, 'accept')}
              >
                {c.direction === 'mine' ? t('Als Aufgabe') : t('Erinnern, falls nichts kommt')}
              </Button>
              <button
                type="button"
                className="icon-button"
                disabled={busy === c.id}
                title={t('Verwerfen')}
                aria-label={t('Vorschlag „{what}“ verwerfen', { what: c.what })}
                onClick={() => void act(c, 'dismiss')}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
