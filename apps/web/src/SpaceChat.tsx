// Chat of a shared space. Messages travel like every other space change (end-to-end encrypted
// sync mails), but without the batch pause; the app's IMAP IDLE connection fetches them as soon
// as they arrive, so they usually show up within seconds. The view waits for the next change of
// the space (long poll) instead of polling. No typing indicators and no read receipts: "unread"
// is only kept on this device.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CornerUpLeft, Pencil, Send, Sparkles, Trash2, X } from 'lucide-react';
import { Button, IconButton } from './ui';
import { useUi } from './ConfirmDialog';
import { fullDateLabel } from './format';
import { useT } from './i18n';
import { spaces, type ChatMessage, type ChatPage, type SpaceDetail } from './spaces-api';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const MAX = 10_000;
const dayOf = (iso: string) => new Date(iso).toDateString();
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function SpaceChat({ detail, onRead }: { detail: SpaceDetail; onRead: () => void }) {
  const { t } = useT();
  const ui = useUi();
  const id = detail.id;
  const [page, setPage] = useState<ChatPage | null>(null);
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // Where the "new" line goes: the first message that was unread when the chat was opened.
  const firstUnread = useRef<string | null | undefined>(undefined);

  const load = useCallback(async () => {
    const next = await spaces.chat(id);
    if (firstUnread.current === undefined) firstUnread.current = next.messages.find(m => m.unread)?.id || null;
    setPage(next);
    setError('');
    return next;
  }, [id]);

  // Load, then wait for the next change of the space and load again.
  useEffect(() => {
    const abort = new AbortController();
    let stopped = false;
    void (async () => {
      let rev = -1;
      while (!stopped) {
        const started = Date.now();
        try {
          if (rev >= 0) {
            await spaces.chatWait(id, rev, abort.signal);
            // Never faster than twice a second, whatever the server answers.
            const pause = 500 - (Date.now() - started);
            if (pause > 0) await new Promise(r => setTimeout(r, pause));
          }
          if (stopped) break;
          rev = (await load()).rev;
        } catch (err) {
          if (stopped) break;
          setError(errorText(err));
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    })();
    return () => {
      stopped = true;
      abort.abort();
    };
  }, [id, load]);

  // What is on screen while the window is in front counts as read (on this device only).
  useEffect(() => {
    const unread = page?.messages.filter(m => m.unread).map(m => m.id) || [];
    if (!unread.length) return;
    const mark = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      void spaces
        .post(`/${id}/chat/read`, { ids: unread })
        .then(onRead)
        .catch(() => {});
    };
    const timer = window.setTimeout(mark, 800);
    window.addEventListener('focus', mark);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', mark);
    };
  }, [page, id, onRead]);

  // Stay at the bottom when new messages arrive, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [page]);

  const messages = [...older, ...(page?.messages || []).filter(m => !older.some(o => o.id === m.id))];
  const byId = new Map(messages.map(m => [m.id, m]));
  const names: Record<string, string> = Object.fromEntries(
    detail.members.map(m => [m.id, m.me ? t('Du') : m.name || m.email])
  );
  const nameOf = (memberId: string) => names[memberId] || t('Unbekannt');
  const canWrite = Boolean(page?.canWrite);

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    try {
      const more = await spaces.chat(id, first.id);
      stick.current = false;
      setOlder(o => [...more.messages, ...o]);
      if (!more.more) setPage(p => (p ? { ...p, more: false } : p));
    } catch (err) {
      ui.toast({ kind: 'error', text: errorText(err) });
    }
  };

  const send = async () => {
    const value = text.trim() ? text : '';
    if (!value || sending) return;
    setSending(true);
    try {
      if (editing) await spaces.op(id, 'chat.edit', { id: editing.id, text: value });
      else await spaces.post(`/${id}/chat/post`, { text: value, replyTo: replyTo?.id || null });
      setText('');
      setReplyTo(null);
      setEditing(null);
      stick.current = true;
      await load();
    } catch (err) {
      ui.toast({ kind: 'error', text: errorText(err) });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const remove = async (m: ChatMessage) => {
    const ok = await ui.confirm({
      title: t('Nachricht löschen?'),
      message: t('Die Nachricht wird für alle Mitglieder gelöscht, auch aus ihren Kopien des Raums.'),
      confirmLabel: t('Löschen'),
      danger: true
    });
    if (!ok) return;
    try {
      await spaces.op(id, 'chat.delete', { id: m.id });
      setOlder(o => o.filter(x => x.id !== m.id));
      await load();
    } catch (err) {
      ui.toast({ kind: 'error', text: errorText(err) });
    }
  };

  const quote = (m: ChatMessage) => {
    if (!m.replyTo) return null;
    const q = byId.get(m.replyTo) || page?.quoted[m.replyTo];
    return (
      <span className="space-chat-quote">
        {q ? (
          <>
            <strong>{nameOf(q.by)}</strong> {q.text.slice(0, 160)}
          </>
        ) : (
          <em>{t('Nachricht gelöscht')}</em>
        )}
      </span>
    );
  };

  return (
    <div className="space-chat">
      <p className="muted small space-chat-note">
        {t(
          'Ende-zu-Ende-verschlüsselt über eure Postfächer. Nachrichten kommen meist innerhalb weniger Sekunden an. Es gibt keine Lesebestätigungen.'
        )}
      </p>
      {error && <p className="banner error">{error}</p>}
      <div
        className="space-chat-list"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label={t('Chat')}
        onScroll={e => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {page?.more && older.length === 0 ? (
          <button className="link-button small space-chat-more" onClick={() => void loadOlder()}>
            {t('Ältere Nachrichten laden')}
          </button>
        ) : null}
        {page && !messages.length && (
          <p className="muted space-chat-empty">
            {canWrite ? t('Noch keine Nachrichten. Schreib die erste.') : t('Noch keine Nachrichten.')}
          </p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayOf(prev.at) !== dayOf(m.at);
          const grouped = !newDay && prev && prev.by === m.by && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60_000;
          const canDelete = canWrite && (m.mine || detail.owner);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="space-chat-day" role="separator">
                  <span>
                    {new Date(m.at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
                  </span>
                </div>
              )}
              {firstUnread.current === m.id && (
                <div className="space-chat-new" role="separator">
                  <span>{t('Neu')}</span>
                </div>
              )}
              <div className={`space-chat-msg ${m.mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
                {!grouped && (
                  <span className="space-chat-meta small">
                    <strong>{nameOf(m.by)}</strong>{' '}
                    <time dateTime={m.at} title={fullDateLabel(m.at)} className="muted">
                      {timeOf(m.at)}
                    </time>
                  </span>
                )}
                <div className="space-chat-row">
                  <div className="space-chat-bubble">
                    {quote(m)}
                    <p>{m.text}</p>
                    <span className="space-chat-flags small muted">
                      {m.ai && (
                        <span className="space-chat-ai" title={t('Mit dem Assistenten geschrieben')}>
                          <Sparkles size={11} aria-hidden="true" /> {t('KI-erstellt')}
                        </span>
                      )}
                      {m.editedAt && <span>{t('bearbeitet')}</span>}
                      {grouped && (
                        <time dateTime={m.at} title={fullDateLabel(m.at)}>
                          {timeOf(m.at)}
                        </time>
                      )}
                    </span>
                  </div>
                  {canWrite && (
                    <span className="space-chat-actions">
                      <IconButton
                        size="sm"
                        label={t('Antworten')}
                        icon={<CornerUpLeft size={13} />}
                        onClick={() => (setEditing(null), setReplyTo(m), inputRef.current?.focus())}
                      />
                      {m.mine && (
                        <IconButton
                          size="sm"
                          label={t('Bearbeiten')}
                          icon={<Pencil size={13} />}
                          onClick={() => {
                            setReplyTo(null);
                            setEditing(m);
                            setText(m.text);
                            inputRef.current?.focus();
                          }}
                        />
                      )}
                      {canDelete && (
                        <IconButton
                          size="sm"
                          label={t('Löschen')}
                          icon={<Trash2 size={13} />}
                          onClick={() => void remove(m)}
                        />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      {page?.pending && (
        <p className="muted small space-chat-pending" role="status">
          {t('Wird zugestellt …')}
        </p>
      )}
      {canWrite ? (
        <form
          className="space-chat-form"
          onSubmit={e => {
            e.preventDefault();
            void send();
          }}
        >
          {(replyTo || editing) && (
            <div className="space-chat-context small">
              <span>
                {editing
                  ? t('Nachricht bearbeiten')
                  : t('Antwort an {name}: „{text}“', {
                      name: nameOf(replyTo!.by),
                      text: replyTo!.text.slice(0, 80)
                    })}
              </span>
              <IconButton
                size="sm"
                label={t('Abbrechen')}
                icon={<X size={13} />}
                onClick={() => {
                  if (editing) setText('');
                  setEditing(null);
                  setReplyTo(null);
                }}
              />
            </div>
          )}
          <div className="space-chat-input">
            <textarea
              ref={inputRef}
              rows={2}
              value={text}
              maxLength={MAX}
              aria-label={t('Nachricht')}
              placeholder={t('Nachricht an alle Mitglieder (Enter sendet, Umschalt+Enter für neue Zeile)')}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
                if (e.key === 'Escape' && (editing || replyTo)) {
                  if (editing) setText('');
                  setEditing(null);
                  setReplyTo(null);
                }
              }}
            />
            <Button type="submit" variant="primary" size="sm" disabled={!text.trim() || sending}>
              <Send size={14} /> {editing ? t('Speichern') : t('Senden')}
            </Button>
          </div>
        </form>
      ) : (
        page && (
          <p className="muted small space-chat-readonly">
            {detail.status === 'active'
              ? t('Als Leser kannst du mitlesen, aber nicht schreiben.')
              : t('Dieser Raum ist nicht mehr aktiv.')}
          </p>
        )
      )}
    </div>
  );
}
