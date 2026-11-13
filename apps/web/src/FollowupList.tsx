import { useCallback, useEffect, useState } from 'react';
import { BellRing, Check, Clock, LoaderCircle, Send } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { fullDateLabel } from './format';
import { useT } from './i18n';
import WhenMenu from './WhenMenu';
import type { AccountItem } from './types';

export type Followup = {
  id: string;
  accountId: string;
  accountLabel?: string;
  messageId: string;
  subject: string;
  to: string[];
  due: string;
  state: 'waiting' | 'due';
  createdAt: string;
};

/** Sent messages that are waiting for an answer (and those whose time is up). */
export default function FollowupList({
  accounts,
  onChanged,
  onShowSent
}: {
  accounts: AccountItem[];
  onChanged: (due: number) => void;
  onShowSent: (accountId: string, subject: string) => void;
}) {
  const { t } = useT();
  const { toast } = useUi();
  const [items, setItems] = useState<Followup[] | null>(null);
  const [remindFor, setRemindFor] = useState<string | null>(null);
  const load = useCallback(async () => {
    const d = await getJson<{ items: Followup[] }>('/api/followups');
    setItems(d.items);
    onChanged(d.items.filter(i => i.state === 'due').length);
  }, [onChanged]);
  useEffect(() => {
    void load().catch(() => setItems([]));
  }, [load]);

  async function dismiss(f: Followup) {
    await postJson('/api/followups/dismiss', { id: f.id }, 'mail-v1');
    toast({ text: t('Als erledigt markiert.'), kind: 'success' });
    void load();
  }
  async function remind(f: Followup, due: Date) {
    try {
      await postJson('/api/followups/remind', { id: f.id, due: due.toISOString() }, 'mail-v1');
      toast({ text: t('Erinnerung am {when}.', { when: fullDateLabel(due.toISOString()) }), kind: 'success' });
      void load();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }

  if (!items)
    return (
      <div className="empty-list">
        <LoaderCircle className="spin" size={20} />
      </div>
    );
  if (!items.length)
    return (
      <div className="empty-list">
        <BellRing size={24} />
        <h3>{t('Nichts offen.')}</h3>
        <p>{t('Beim Senden „Nachfassen“ wählen – Levuvo Mail erinnert dich, wenn bis dahin keine Antwort kommt.')}</p>
      </div>
    );
  const due = items.filter(i => i.state === 'due');
  const waiting = items.filter(i => i.state !== 'due');
  const row = (f: Followup) => (
    <div key={f.id} className={`followup-row ${f.state === 'due' ? 'due' : ''}`} role="listitem">
      <div className="followup-main">
        <strong>{f.subject || t('(Ohne Betreff)')}</strong>
        <span>
          {t('An')}: {f.to.join(', ')}
          {accounts.length > 1 && f.accountLabel ? ` · ${f.accountLabel}` : ''}
        </span>
        <small>
          {f.state === 'due'
            ? t('Keine Antwort seit {when}', { when: fullDateLabel(f.createdAt) })
            : t('Erinnerung am {when}', { when: fullDateLabel(f.due) })}
        </small>
      </div>
      <div className="followup-actions">
        <button
          className="icon-button"
          title={t('In „Gesendet“ zeigen')}
          aria-label={t('In „Gesendet“ zeigen')}
          onClick={() => onShowSent(f.accountId, f.subject)}
        >
          <Send size={15} />
        </button>
        <span className="menu-anchor">
          <button
            className="icon-button"
            title={t('Später erinnern')}
            aria-label={t('Später erinnern')}
            onClick={() => setRemindFor(remindFor === f.id ? null : f.id)}
          >
            <Clock size={15} />
          </button>
          {remindFor === f.id && (
            <WhenMenu
              title={t('Erneut erinnern')}
              onClose={() => setRemindFor(null)}
              onPick={date => {
                setRemindFor(null);
                void remind(f, date);
              }}
            />
          )}
        </span>
        <button className="btn small" onClick={() => void dismiss(f)}>
          <Check size={14} /> {t('Erledigt')}
        </button>
      </div>
    </div>
  );
  return (
    <div className="followup-list message-list" role="list" aria-label={t('Nachfassen')}>
      {due.length > 0 && <h3 className="list-section">{t('Keine Antwort erhalten')}</h3>}
      {due.map(row)}
      {waiting.length > 0 && <h3 className="list-section">{t('Wartet auf Antwort')}</h3>}
      {waiting.map(row)}
    </div>
  );
}
