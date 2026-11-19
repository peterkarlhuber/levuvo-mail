import { ArrowLeft, Ban, Check, UserRoundSearch } from 'lucide-react';
import { useT } from './i18n';
import { Button } from './ui';
import type { Message } from './types';

export type ScreeningState = { since: string | null; allowed: string[]; blocked: string[] };

type Sender = { email: string; name: string; messages: Message[]; unread: number };

export function groupBySender(messages: Message[]): Sender[] {
  const map = new Map<string, Sender>();
  for (const m of messages) {
    const email = m.fromEmail.toLowerCase();
    const s = map.get(email) || { email, name: m.fromName || m.fromEmail, messages: [], unread: 0 };
    s.messages.push(m);
    if (m.unread) s.unread++;
    map.set(email, s);
  }
  return [...map.values()];
}

/** Row at the top of the inbox: "New senders (n)". */
export function ScreenerRow({ messages, onOpen }: { messages: Message[]; onOpen: () => void }) {
  const { t } = useT();
  const senders = groupBySender(messages);
  if (!senders.length) return null;
  return (
    <div className="bundle-rows screener-rows">
      <button type="button" className="bundle-row unread" onClick={onOpen}>
        <span className="bundle-icon bundle-screener">
          <UserRoundSearch size={16} aria-hidden="true" />
        </span>
        <span className="bundle-text">
          <strong>{t('Neue Absender')}</strong>
          <span>
            {senders
              .slice(0, 3)
              .map(s => s.name)
              .join(', ')}
          </span>
        </span>
        <span className="bundle-count">{t('{count} prüfen', { count: senders.length })}</span>
      </button>
    </div>
  );
}

/** The screener: accept a new sender (mail appears in the inbox) or block it (mail goes to spam). */
export function ScreenerView({
  messages,
  writeEnabled,
  busy,
  onBack,
  onDecide,
  onOpenMessage
}: {
  messages: Message[];
  writeEnabled: boolean;
  busy: boolean;
  onBack: () => void;
  onDecide: (email: string, decision: 'allow' | 'block', uids: number[]) => void;
  onOpenMessage: (message: Message) => void;
}) {
  const { t } = useT();
  const senders = groupBySender(messages);
  return (
    <div className="screener">
      <div className="bundle-header">
        <div className="bundle-header-top">
          <button type="button" className="text-button" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" /> {t('Posteingang')}
          </button>
          <strong>{t('Neue Absender')}</strong>
        </div>
        <p className="screener-hint">
          {t(
            'Diese Absender schreiben dir zum ersten Mal. Annehmen zeigt ihre Mails im Posteingang, Blockieren verschiebt sie in den Spam-Ordner.'
          )}
        </p>
      </div>
      {!senders.length ? (
        <div className="empty-list">
          <Check size={24} aria-hidden="true" />
          <h3>{t('Alle Absender geprüft.')}</h3>
        </div>
      ) : (
        <ul className="screener-list" aria-label={t('Neue Absender')}>
          {senders.map(s => (
            <li key={s.email} className="screener-item">
              <div className="followup-main">
                <strong>{s.name}</strong>
                <span>{s.email}</span>
                <button type="button" className="screener-subject" onClick={() => onOpenMessage(s.messages[0])}>
                  {s.messages[0].subject || t('(Ohne Betreff)')}
                  {s.messages.length > 1 ? ` · +${s.messages.length - 1}` : ''}
                </button>
              </div>
              <div className="followup-actions">
                <Button
                  size="sm"
                  icon={<Check size={14} />}
                  disabled={busy}
                  onClick={() =>
                    onDecide(
                      s.email,
                      'allow',
                      s.messages.map(m => m.uid)
                    )
                  }
                >
                  {t('Annehmen')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Ban size={14} />}
                  disabled={busy || !writeEnabled}
                  title={!writeEnabled ? t('Nur mit Schreibzugriff auf das Postfach') : undefined}
                  onClick={() =>
                    onDecide(
                      s.email,
                      'block',
                      s.messages.map(m => m.uid)
                    )
                  }
                >
                  {t('Blockieren')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
