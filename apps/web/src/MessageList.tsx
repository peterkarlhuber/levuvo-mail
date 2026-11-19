import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Archive, LoaderCircle, Mail, MailOpen, Paperclip, Star, Trash2 } from 'lucide-react';
import WhenMenu from './WhenMenu';
import { dateLabel, groupConversations } from './format';
import { useT } from './i18n';
import { navigateIndex, renderIndices, rowOffsets, scrollToShow, visibleRange } from './list-window';
import type { Message } from './types';

export const DRAG_TYPE = 'application/x-levuvo-messages';

/** Height of a row before it was measured (comfortable density with preview). */
const ESTIMATED_ROW = 76;
/** Rows rendered above and below the visible area. */
const OVERSCAN = 8;

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

  const rows = useMemo(
    () =>
      conversations && !unified
        ? groupConversations(messages)
        : messages.map(m => ({
            key: `${m.accountId || ''}:${m.folder || ''}:${m.uid}`,
            head: m,
            members: [m],
            unread: m.unread ? 1 : 0
          })),
    [conversations, unified, messages]
  );

  // Windowing (only the rows near the visible area are in the DOM, see list-window.ts).
  // Rows are positioned absolutely; heights are measured with a ResizeObserver.
  const scroller = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const measured = useRef(new Map<string, number>());
  const [measureVersion, setMeasureVersion] = useState(0);
  const [view, setView] = useState({ top: 0, height: typeof window === 'undefined' ? 800 : window.innerHeight });
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const pendingFocus = useRef(-1);
  const keys = useMemo(() => rows.map(r => r.key), [rows]);
  const estimate = useMemo(() => {
    let sum = 0;
    let n = 0;
    for (const h of measured.current.values()) {
      sum += h;
      n++;
    }
    return n ? sum / n : ESTIMATED_ROW;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offsets = useMemo(() => rowOffsets(keys, measured.current, estimate), [keys, estimate, measureVersion]);
  const isSelected = useCallback(
    (row: (typeof rows)[number]) =>
      unified ? selectedKey === `${row.head.accountId}:${row.head.uid}` : row.members.some(m => m.uid === selectedUid),
    [unified, selectedKey, selectedUid]
  );
  const selectedIndex = useMemo(() => rows.findIndex(isSelected), [rows, isSelected]);
  const focusIndex = useMemo(() => (focusKey === null ? -1 : keys.indexOf(focusKey)), [keys, focusKey]);
  const range = visibleRange(offsets, view.top, view.height, OVERSCAN);
  // The focused and the selected row stay in the DOM even when scrolled away (keyboard focus
  // is not lost, screen readers keep their position).
  const indices = renderIndices(range, [focusIndex, selectedIndex, pendingFocus.current], rows.length);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const update = () =>
      setView(v =>
        v.top === node.scrollTop && v.height === node.clientHeight
          ? v
          : { top: node.scrollTop, height: node.clientHeight }
      );
    update();
    let frame = 0;
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
    };
    node.addEventListener('scroll', onScroll, { passive: true });
    const resize = new ResizeObserver(update);
    resize.observe(node);
    return () => {
      node.removeEventListener('scroll', onScroll);
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Measure rendered rows; re-render only when a height actually changed.
  const rowObserver = useRef<ResizeObserver | null>(null);
  useLayoutEffect(() => {
    rowObserver.current = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = el.dataset.rowKey;
        const height = el.offsetHeight;
        if (key && height > 0 && measured.current.get(key) !== height) {
          measured.current.set(key, height);
          changed = true;
        }
      }
      if (changed) setMeasureVersion(v => v + 1);
    });
    return () => rowObserver.current?.disconnect();
  }, []);
  // Runs after every render on purpose; it only updates state when a height changed, so it settles.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const observer = rowObserver.current;
    const list = listRef.current;
    if (!list) return;
    observer?.disconnect();
    // Measure new rows before the browser paints, so rows never visibly jump from the
    // estimated to the real position (a click could otherwise land on the wrong row).
    let changed = false;
    list.querySelectorAll<HTMLElement>('[data-row-key]').forEach(el => {
      observer?.observe(el);
      const key = el.dataset.rowKey!;
      const height = el.offsetHeight;
      if (height > 0 && measured.current.get(key) !== height) {
        measured.current.set(key, height);
        changed = true;
      }
    });
    if (changed) setMeasureVersion(v => v + 1);
  });

  // Keep the selected row visible when the selection changes (j/k, opening from elsewhere).
  const selectedRowKey = selectedIndex >= 0 ? keys[selectedIndex] : null;
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || selectedIndex < 0) return;
    const next = scrollToShow(offsets, selectedIndex, node.scrollTop, node.clientHeight);
    if (next !== null) node.scrollTop = next;
    // Only on a change of the selection, not on every re-measurement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRowKey]);

  // Arrow keys, Home/End and Page keys move the focus between rows.
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    if (!target.classList.contains('message-item')) return;
    const row = target.closest<HTMLElement>('[data-index]');
    const node = scroller.current;
    if (!row || !node) return;
    const page = Math.max(1, Math.floor(node.clientHeight / Math.max(estimate, 1)) - 1);
    const next = navigateIndex(event.key, Number(row.dataset.index), rows.length, page);
    if (next < 0) return;
    event.preventDefault();
    event.stopPropagation();
    pendingFocus.current = next;
    const top = scrollToShow(offsets, next, node.scrollTop, node.clientHeight);
    if (top !== null) node.scrollTop = top;
    setFocusKey(keys[next]);
    setView({ top: node.scrollTop, height: node.clientHeight });
  };
  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index < 0) return;
    const button = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"] .message-item`);
    if (button) {
      pendingFocus.current = -1;
      button.focus();
    }
  });

  return (
    <div className="message-list" ref={scroller}>
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
      {rows.length > 0 && (
        <div
          ref={listRef}
          role="list"
          aria-label={t('Nachrichtenliste')}
          className="message-window"
          style={{ position: 'relative', height: offsets[rows.length] }}
          onKeyDown={onListKeyDown}
          onFocus={e => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
            if (row?.dataset.rowKey) setFocusKey(row.dataset.rowKey);
          }}
          onBlur={e => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusKey(null);
          }}
        >
          {indices.map(index => {
            const { key, head: mail, members, unread } = rows[index];
            const selected = index === selectedIndex;
            const checked = !unified && checkedUids.includes(mail.uid);
            const isUnread = unread > 0;
            const flagged = members.some(m => m.flagged);
            return (
              <div
                key={key}
                role="listitem"
                data-index={index}
                data-row-key={key}
                aria-posinset={index + 1}
                aria-setsize={hasMore ? -1 : rows.length}
                style={{ position: 'absolute', top: offsets[index], left: 0, right: 0 }}
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
        </div>
      )}
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
