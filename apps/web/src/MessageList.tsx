import { useEffect, useRef, useState } from 'react';
import { AlarmClock, Archive, LoaderCircle, Mail, MailOpen, Paperclip, Star, Trash2 } from 'lucide-react';
import WhenMenu from './WhenMenu';
import { dateLabel, groupConversations } from './format';
import { useT } from './i18n';
import type { Message } from './types';

export const DRAG_TYPE = 'application/x-levuvo-messages';

type Props = {
  messages: Message[];
  selectedUid: number | null;
  selectedKey?: string | null;
  checkedUids: number[];
  busy: boolean;
  bulkBusy: boolean;
  conversations: boolean;
  unified: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  draggable: boolean;
  folder: string;
  accountId: string;
  emptyText?: string;
  onSelect: (message: Message) => void;
  onToggleChecked: (uid: number, checked: boolean) => void;
  onToggleFlag?: (message: Message) => void;
  /** Hover actions on a row (only in real folders with write access). */
  quick?: {
    archive: boolean;
    trash: boolean;
    onAction: (message: Message, action: 'archive' | 'trash' | 'markRead' | 'markUnread') => void;
    onSnooze: (message: Message, until: Date) => void;
  };
  onLoadMore: () => void;
};

export default function MessageList(props: Props) {
  const {
    messages,
    selectedUid,
    selectedKey = null,
    checkedUids,
    busy,
    bulkBusy,
    conversations,
    unified,
    hasMore,
    loadingMore
  } = props;
  const { t } = useT();
  const sentinel = useRef<HTMLDivElement>(null);
  const [snoozeFor, setSnoozeFor] = useState<number | null>(null);
  const { onLoadMore } = props;
  // Infinite scroll: load the next page when the end of the list becomes visible.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) onLoadMore();
      },
      { rootMargin: '240px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, messages.length]);

  const rows =
    conversations && !unified
      ? groupConversations(messages)
      : messages.map(m => ({
          key: `${m.accountId || ''}:${m.folder || ''}:${m.uid}`,
          head: m,
          members: [m],
          unread: m.unread ? 1 : 0
        }));

  return (
    <div className="message-list" aria-label={t('Nachrichtenliste')} role="list">
      {busy && !messages.length && (
        <div className="empty-list">
          <LoaderCircle size={22} className="spin" />
          <span>{t('Nachrichten werden geladen …')}</span>
        </div>
      )}
      {!busy && !messages.length && (
        <div className="empty-list">
          <Mail size={24} />
          <h3>{t('Alles erledigt.')}</h3>
          <p>{props.emptyText || t('In diesem Ordner sind keine Nachrichten.')}</p>
        </div>
      )}
      {rows.map(({ key, head: mail, members, unread }) => {
        const selected = unified
          ? selectedKey === `${mail.accountId}:${mail.uid}`
          : members.some(m => m.uid === selectedUid);
        const checked = !unified && checkedUids.includes(mail.uid);
        const isUnread = unread > 0;
        const flagged = members.some(m => m.flagged);
        return (
          <div
            key={key}
            role="listitem"
            className={`message-row ${checked ? 'checked' : ''} ${isUnread ? 'unread' : ''} ${selected ? 'selected' : ''} ${flagged ? 'flagged' : ''}`}
            draggable={props.draggable && !bulkBusy}
            onDragStart={e => {
              const uids = checked ? checkedUids : members.map(m => m.uid);
              e.dataTransfer.setData(
                DRAG_TYPE,
                JSON.stringify({ accountId: props.accountId, folder: props.folder, uids })
              );
              e.dataTransfer.setData('text/plain', mail.subject);
              e.dataTransfer.effectAllowed = 'move';
              const ghost = document.createElement('div');
              ghost.className = 'drag-ghost';
              ghost.textContent =
                uids.length > 1 ? t('{count} Nachrichten', { count: uids.length }) : mail.subject.slice(0, 60);
              document.body.appendChild(ghost);
              e.dataTransfer.setDragImage(ghost, 12, 12);
              window.setTimeout(() => ghost.remove(), 0);
            }}
          >
            {!unified && (
              <label className="message-select" title={t('Für Sammelaktion auswählen')}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => props.onToggleChecked(mail.uid, e.target.checked)}
                  disabled={bulkBusy}
                  aria-label={t('Auswählen: {subject}', { subject: mail.subject })}
                />
              </label>
            )}
            <button
              className="message-item"
              onClick={() => props.onSelect(mail)}
              aria-current={selected ? 'true' : undefined}
            >
              <span className="message-main">
                <span className="message-topline">
                  <strong>{mail.fromName}</strong>
                  {members.length > 1 && (
                    <span
                      className="thread-count"
                      title={t('{count} Nachrichten in dieser Konversation', { count: members.length })}
                    >
                      {members.length}
                    </span>
                  )}
                  {mail.hasAttachments && (
                    <Paperclip size={12} className="attachment-flag" aria-label={t('Mit Anhang')} />
                  )}
                  <time dateTime={mail.date || undefined}>{dateLabel(mail.date)}</time>
                </span>
                <span className="message-subject">
                  {isUnread && <span className="unread-dot" aria-label={t('Ungelesen')} />}
                  {mail.subject}
                </span>
                {mail.preview ? <span className="message-preview">{mail.preview}</span> : null}
                {(unified || mail.accountLabel) && mail.accountLabel && (
                  <span className="account-badge">
                    {mail.accountLabel}
                    {mail.folder && mail.folder !== 'INBOX' ? ` · ${mail.folder}` : ''}
                  </span>
                )}
              </span>
            </button>
            {props.quick && !unified && (
              <div
                className={`row-actions ${snoozeFor === mail.uid ? 'open' : ''}`}
                role="group"
                aria-label={t('Schnellaktionen')}
              >
                {props.quick.archive && (
                  <button
                    title={t('Archivieren (E)')}
                    aria-label={t('Archivieren')}
                    onClick={() => props.quick!.onAction(mail, 'archive')}
                  >
                    <Archive size={14} />
                  </button>
                )}
                {props.quick.trash && (
                  <button
                    title={t('In den Papierkorb (Entf)')}
                    aria-label={t('In den Papierkorb')}
                    onClick={() => props.quick!.onAction(mail, 'trash')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button
                  title={isUnread ? t('Als gelesen markieren (U)') : t('Als ungelesen markieren (U)')}
                  aria-label={isUnread ? t('Als gelesen markieren') : t('Als ungelesen markieren')}
                  onClick={() => props.quick!.onAction(mail, isUnread ? 'markRead' : 'markUnread')}
                >
                  {isUnread ? <MailOpen size={14} /> : <Mail size={14} />}
                </button>
                <span className="menu-anchor">
                  <button
                    title={t('Zurückstellen (B)')}
                    aria-label={t('Zurückstellen')}
                    aria-expanded={snoozeFor === mail.uid}
                    onClick={() => setSnoozeFor(snoozeFor === mail.uid ? null : mail.uid)}
                  >
                    <AlarmClock size={14} />
                  </button>
                  {snoozeFor === mail.uid && (
                    <WhenMenu
                      title={t('Zurückstellen bis')}
                      onClose={() => setSnoozeFor(null)}
                      onPick={date => {
                        setSnoozeFor(null);
                        props.quick!.onSnooze(mail, date);
                      }}
                    />
                  )}
                </span>
              </div>
            )}
            {props.onToggleFlag && !unified && (
              <button
                className={`flag-button ${flagged ? 'on' : ''}`}
                aria-pressed={flagged}
                aria-label={flagged ? t('Markierung entfernen') : t('Markieren')}
                title={flagged ? t('Markierung entfernen (S)') : t('Markieren (S)')}
                onClick={() => props.onToggleFlag!(mail)}
                disabled={bulkBusy}
              >
                <Star size={14} fill={flagged ? 'currentColor' : 'none'} />
              </button>
            )}
          </div>
        );
      })}
      {hasMore && (
        <div ref={sentinel} className="load-more">
          <button onClick={props.onLoadMore} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <LoaderCircle size={14} className="spin" /> {t('Lädt …')}
              </>
            ) : (
              t('Ältere Nachrichten laden')
            )}
          </button>
        </div>
      )}
    </div>
  );
}
