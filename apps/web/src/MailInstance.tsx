import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import DOMPurify from 'dompurify';
import {
  AlarmClock,
  Archive,
  BellRing,
  CheckCheck,
  ChevronDown,
  CloudOff,
  FilePenLine,
  FolderPlus,
  Globe2,
  GripVertical,
  Inbox,
  Keyboard,
  Mail,
  Mails,
  Menu,
  MoreHorizontal,
  Paperclip,
  PenSquare,
  RefreshCcw,
  Search,
  Send,
  ShieldAlert,
  Star,
  Trash2,
  X
} from 'lucide-react';
import Composer, { type ComposeInitial, type OutgoingPayload } from './Composer';
import { plainToHtml, SIGNATURE_SEPARATOR } from './editor';
import MessageList, { DRAG_TYPE } from './MessageList';
import Reader, { printMessage, type ReaderAction } from './Reader';
import { ShortcutsDialog } from './Panels';
import { useUi } from './ConfirmDialog';
import { accountPath, getJson, postAction } from './api';
import { bodyText, fullDateLabel, replyAllRecipients, replyRecipient } from './format';
import { useT } from './i18n';
import { publishFolders, type MailCommand } from './command-bus';
import { isInbox, isSnoozeFolder, orderFolders, special } from './folder-utils';
import FollowupList from './FollowupList';
import WhenMenu from './WhenMenu';
import { usePrefs } from './prefs';
import type { SettingsTab } from './App';
import type { AccountItem, ApiStatus, Detail, Folder, Identity, InboxSnapshot, Message, MessagePage } from './types';

export const UNIFIED = '\u0000unified';
export const FOLLOWUPS = '\u0000followups';
const PAGE = 40;
type Filter = 'all' | 'unread' | 'flagged' | 'attachments';
const PROTECTED = new Set(['\\Inbox', '\\Drafts', '\\Sent', '\\Trash', '\\Junk', '\\Archive']);

function folderIcon(folder: Folder) {
  if (isSnoozeFolder(folder)) return AlarmClock;
  switch (folder.specialUse) {
    case '\\Inbox':
      return Inbox;
    case '\\Sent':
      return Send;
    case '\\Drafts':
      return FilePenLine;
    case '\\Archive':
      return Archive;
    case '\\Trash':
      return Trash2;
    case '\\Junk':
      return ShieldAlert;
    default:
      return folder.path.toUpperCase() === 'INBOX' ? Inbox : Mail;
  }
}
/** Newest snapshot replaces the top of the list; older pages that were loaded stay. */
function mergeSnapshot(current: Message[], snapshot: Message[]) {
  if (!snapshot.length) return [];
  const oldestInSnapshot = Math.min(...snapshot.map(m => m.uid));
  const flags = new Map(current.map(m => [m.uid, m.flagged]));
  return [
    ...snapshot.map(m => (m.flagged === undefined && flags.has(m.uid) ? { ...m, flagged: flags.get(m.uid) } : m)),
    ...current.filter(m => m.uid < oldestInSnapshot)
  ];
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function quotedHtml(d: Detail) {
  if (d.html) {
    const clean = DOMPurify.sanitize(d.html, {
      FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'iframe', 'svg', 'math'],
      FORBID_ATTR: ['style', 'class', 'id']
    });
    return clean.length > 200_000 ? plainToHtml(bodyText(d).slice(0, 50_000)) : clean;
  }
  return plainToHtml(d.text.slice(0, 50_000));
}

type Props = {
  accountId: string;
  accounts: AccountItem[];
  visible: boolean;
  inboxSnapshot?: InboxSnapshot;
  pollState: Record<string, { checkedAt: number | null; error?: string }>;
  initialOpen: { uid: number; folder: string | null } | null;
  pendingCompose: { initial: ComposeInitial; nonce: number } | null;
  onPendingComposeTaken: () => void;
  onSelectAccount: (id: string, open?: { uid: number; folder?: string }) => void;
  onSubmitCompose: (
    accountId: string,
    payload: OutgoingPayload,
    initial: ComposeInitial,
    sendAt: string | null
  ) => void;
  onOpenSettings: (tab: SettingsTab) => void;
};

export default function MailInstance({
  accountId,
  accounts,
  visible,
  inboxSnapshot,
  pollState,
  initialOpen,
  pendingCompose,
  onPendingComposeTaken,
  onSelectAccount,
  onSubmitCompose,
  onOpenSettings
}: Props) {
  const { t, locale } = useT();
  const { confirm, prompt, toast } = useUi();
  const [prefs, setPrefs] = usePrefs();
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState(initialOpen?.folder || 'INBOX');
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBeforeUid, setNextBeforeUid] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stale, setStale] = useState<number | null>(null);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'folder' | 'everywhere'>('folder');
  const [filter, setFilter] = useState<Filter>('all');
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchTimer = useRef<number | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [composer, setComposer] = useState<ComposeInitial | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [reloadDetail, setReloadDetail] = useState(0);
  const [readerOpen, setReaderOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [composeBusy, setComposeBusy] = useState(false);
  const [checkedUids, setCheckedUids] = useState<number[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const pendingOpen = useRef<number | null>(initialOpen?.uid ?? null);
  const resizeAnchor = useRef<{ x: number; width: number } | null>(null);
  const [listWidth, setListWidth] = useState(prefs.listWidth);
  const [snoozed, setSnoozed] = useState<{ id: string; messageId: string | null; until: string }[]>([]);
  const [followupsDue, setFollowupsDue] = useState(0);
  const [bulkSnooze, setBulkSnooze] = useState(false);

  const unified = folder === UNIFIED;
  const followupView = folder === FOLLOWUPS;
  const everywhere = scope === 'everywhere' && query.trim().length >= 2;
  const searching = query.trim().length >= 2 && !unified;
  const accountReady = Boolean(status?.configured);
  const writeEnabled = Boolean(status?.configured && status?.writeEnabled) && !unified && !everywhere;
  const currentFolder = folders.find(f => f.path === folder);
  const archiveExists = folders.some(
    f =>
      f.specialUse === '\\Archive' || /^(?:archive|archives|archiv)$/i.test(f.name || f.path.split(/[./]/).at(-1) || '')
  );
  const isTrash = currentFolder?.specialUse === '\\Trash';
  const inSnoozeFolder = Boolean(currentFolder && isSnoozeFolder(currentFolder));
  const isJunk = currentFolder?.specialUse === '\\Junk' || /^(junk|spam)$/i.test(currentFolder?.name || '');
  const isDraftFolder = currentFolder?.specialUse === '\\Drafts';
  const identities: Identity[] = status?.identities?.length
    ? status.identities
    : status?.sender
      ? [{ email: status.sender, name: status.displayName || '', signatureHtml: status.signatureHtml }]
      : [];
  const ordered = useMemo(() => orderFolders(folders), [folders]);
  // Names of system folders follow the UI language (the server reports German names).
  const folderLabel = (f?: Folder) => {
    if (!f) return folder;
    const names: Record<string, string> = {
      '\\Inbox': t('Posteingang'),
      '\\Sent': t('Gesendet'),
      '\\Drafts': t('Entwürfe'),
      '\\Trash': t('Papierkorb'),
      '\\Junk': t('Spam'),
      '\\Archive': t('Archiv')
    };
    if (isSnoozeFolder(f)) return t('Zurückgestellt');
    return names[special(f)] || f.name;
  };

  const visibleMessages = useMemo(() => {
    let list = messages;
    if (!searching && !unified && query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(m => `${m.subject} ${m.fromName} ${m.fromEmail}`.toLowerCase().includes(q));
    }
    if (filter === 'unread') list = list.filter(m => m.unread);
    if (filter === 'flagged') list = list.filter(m => m.flagged);
    if (filter === 'attachments') list = list.filter(m => m.hasAttachments);
    return list;
  }, [messages, query, searching, unified, filter]);
  const visibleUids = useMemo(() => visibleMessages.map(m => m.uid), [visibleMessages]);
  const selected =
    unified || everywhere
      ? visibleMessages.find(m => `${m.accountId}:${m.uid}` === selectedKey) || null
      : messages.find(m => m.uid === selectedUid) || null;

  const allChecked = visibleUids.length > 0 && visibleUids.every(uid => checkedUids.includes(uid));
  const checkedCount = checkedUids.filter(uid => visibleUids.includes(uid)).length;
  const account = accounts.find(a => a.id === accountId);
  const health = pollState[accountId];
  const pushState = status?.push;
  const connectionLabel = stale
    ? t('Offline')
    : pushState?.connected
      ? t('Live')
      : health?.error || pushState?.error
        ? t('Gestört')
        : t('Verbinde …');

  const applyPage = useCallback((page: MessagePage, append: boolean) => {
    setMessages(old => {
      if (!append) return page.messages;
      const known = new Set(old.map(m => m.uid));
      return [...old, ...page.messages.filter(m => !known.has(m.uid))];
    });
    setHasMore(page.hasMore);
    setNextBeforeUid(page.nextBeforeUid);
    setStale(page.stale ? page.cachedAt || Date.now() : null);
  }, []);

  const selectUid = useCallback(
    (uid: number | null, open = true) => {
      setSelectedUid(uid);
      setSelectedKey(uid === null ? null : `${accountId}:${uid}`);
      if (uid !== null && open) setReaderOpen(true);
    },
    [accountId]
  );

  const loadMessages = useCallback(
    async (path: string) => {
      const seq = ++requestSeq.current;
      setCheckedUids([]);
      setBusy(true);
      setError('');
      try {
        if (path === FOLLOWUPS) {
          setMessages([]);
          setHasMore(false);
          setNextBeforeUid(null);
          setStale(null);
          return;
        }
        if (path === UNIFIED) {
          const data = await getJson<{ messages: Message[] }>('/api/unified');
          if (seq !== requestSeq.current) return;
          setMessages(data.messages);
          setHasMore(false);
          setNextBeforeUid(null);
          setStale(null);
          return;
        }
        const page = await getJson<MessagePage>(
          `/api/messages?folder=${encodeURIComponent(path)}&limit=${PAGE}`,
          accountId
        );
        if (seq !== requestSeq.current) return;
        applyPage(page, false);
        if (pendingOpen.current !== null) {
          selectUid(pendingOpen.current);
          pendingOpen.current = null;
        }
      } catch (e) {
        if (seq === requestSeq.current) {
          setError((e as Error).message);
          setMessages([]);
          setHasMore(false);
        }
      } finally {
        if (seq === requestSeq.current) setBusy(false);
      }
    },
    [accountId, applyPage, selectUid]
  );

  const loadFolders = useCallback(
    async (select = true) => {
      try {
        const data = await getJson<{ folders: Folder[] }>('/api/folders', accountId);
        setFolders(data.folders);
        if (select) {
          const wanted = initialOpen?.folder && data.folders.find(x => x.path === initialOpen.folder);
          const first = wanted || data.folders.find(x => x.path.toUpperCase() === 'INBOX') || data.folders[0];
          if (first) {
            setFolder(first.path);
            await loadMessages(first.path);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [accountId, loadMessages, initialOpen?.folder]
  );

  useEffect(() => {
    let active = true;
    getJson<ApiStatus>('/api/status', accountId)
      .then(s => {
        if (!active) return;
        setStatus(s);
        if (s.configured) void loadFolders();
      })
      .catch(() => {
        if (!active) return;
        setStatus({
          configured: false,
          mailbox: null,
          readOnly: true,
          smtpConfigured: false,
          sendEnabled: false,
          sender: null
        });
        setError(t('Die lokale Mailverbindung ist nicht erreichbar. Bitte Levuvo Mail neu starten.'));
      });
    return () => {
      active = false;
    };
  }, [accountId, loadFolders]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push status for the status pill.
  useEffect(() => {
    let active = true;
    const load = () =>
      getJson<ApiStatus>('/api/status', accountId)
        .then(s => {
          if (active) setStatus(old => (old ? { ...old, push: s.push } : old));
        })
        .catch(() => {});
    const timer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accountId]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || nextBeforeUid === null || unified || everywhere) return;
    setLoadingMore(true);
    const seq = requestSeq.current;
    try {
      const path = searching
        ? `/api/search?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(query.trim())}&limit=${PAGE}&beforeUid=${nextBeforeUid}`
        : `/api/messages?folder=${encodeURIComponent(folder)}&limit=${PAGE}&beforeUid=${nextBeforeUid}`;
      const page = await getJson<MessagePage>(path, accountId);
      if (seq === requestSeq.current) applyPage(page, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextBeforeUid, unified, everywhere, searching, folder, query, accountId, applyPage]);

  // Live updates: the IDLE snapshot replaces the top of the inbox list.
  const appliedSnapshot = useRef(0);
  useEffect(() => {
    if (!accountReady || !inboxSnapshot || inboxSnapshot.checkedAt <= appliedSnapshot.current) return;
    if (inboxSnapshot.unseen !== null)
      setFolders(old => old.map(f => (f.path.toUpperCase() === 'INBOX' ? { ...f, unseen: inboxSnapshot.unseen } : f)));
    if (folder.toUpperCase() !== 'INBOX' || query.trim() || busy || actionBusy) return;
    appliedSnapshot.current = inboxSnapshot.checkedAt;
    setStale(null);
    setMessages(old => mergeSnapshot(old, inboxSnapshot.messages));
  }, [inboxSnapshot, folder, accountReady, query, busy, actionBusy]);

  useEffect(() => {
    if (!unified) return;
    const timer = window.setInterval(() => {
      void getJson<{ messages: Message[] }>('/api/unified')
        .then(d => setMessages(d.messages))
        .catch(() => {});
    }, 25_000);
    return () => window.clearInterval(timer);
  }, [unified]);

  // Sent/scheduled elsewhere (outbox in the app shell) → refresh lists that show it.
  useEffect(() => {
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<{ accountId: string }>).detail?.accountId !== accountId) return;
      void loadFolders(false);
      if (currentFolder && ['\\Sent', '\\Drafts'].includes(currentFolder.specialUse || '') && !query.trim())
        void loadMessages(folder);
    };
    window.addEventListener('levuvo:mail-changed', onChanged);
    return () => window.removeEventListener('levuvo:mail-changed', onChanged);
  }, [accountId, currentFolder, folder, query, loadFolders, loadMessages]);

  // A composer requested by the app shell (undo send, "write e-mail" from contacts).
  useEffect(() => {
    if (!pendingCompose || !status) return;
    const initial = pendingCompose.initial;
    // A plain "new message" request (menu, contacts) gets the default sender and signature.
    if (initial.mode === 'new' && initial.html === undefined && initial.text === undefined && !initial.draftUid) {
      const id = identities[0];
      setComposer({
        ...initial,
        from: id?.email,
        html: `<p></p>${id?.signatureHtml ? `${SIGNATURE_SEPARATOR}${id.signatureHtml}` : ''}`
      });
    } else setComposer(initial);
    setComposerKey(k => k + 1);
    onPendingComposeTaken();
  }, [pendingCompose, status, onPendingComposeTaken]); // eslint-disable-line react-hooks/exhaustive-deps

  // Message detail (never marks as read by itself; see markReadOnOpen below).
  const detailKey = unified || everywhere ? null : selectedUid;
  useEffect(() => {
    setDetail(null);
    setDetailError('');
    if (!accountReady || detailKey === null) {
      setDetailBusy(false);
      return;
    }
    const controller = new AbortController();
    setDetailBusy(true);
    void getJson<Detail>(
      `/api/messages/${detailKey}?folder=${encodeURIComponent(folder)}`,
      accountId,
      controller.signal
    )
      .then(message => {
        if (!controller.signal.aborted) setDetail(message);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setDetailError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailBusy(false);
      });
    return () => controller.abort();
  }, [folder, detailKey, accountReady, reloadDetail, accountId]);

  useEffect(() => {
    if (!detail || !prefs.markReadOnOpen || !writeEnabled || isDraftFolder || detail.stale) return;
    const item = messages.find(m => m.uid === detail.uid);
    if (!item?.unread) return;
    const timer = window.setTimeout(() => {
      postAction(`/api/messages/${detail.uid}/action`, { folder, action: 'markRead' }, accountId)
        .then(() => {
          setMessages(old => old.map(m => (m.uid === detail.uid ? { ...m, unread: false } : m)));
          setFolders(old =>
            old.map(f =>
              f.path === folder && typeof f.unseen === 'number' ? { ...f, unseen: Math.max(0, f.unseen - 1) } : f
            )
          );
        })
        .catch(() => {
          /* stays unread */
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [detail, prefs.markReadOnOpen, writeEnabled, isDraftFolder, folder, accountId, messages]);

  const stopSearch = () => {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = null;
    searchAbort.current?.abort();
    searchAbort.current = null;
  };
  useEffect(() => () => stopSearch(), []);

  const chooseFolder = (path: string) => {
    stopSearch();
    ++requestSeq.current;
    setCheckedUids([]);
    setReaderOpen(false);
    selectUid(null, false);
    setFolder(path);
    setQuery('');
    setScope('folder');
    setSearchTotal(null);
    setSearchBusy(false);
    setMobileSidebar(false);
    void loadMessages(path);
  };

  // Server-side search after a short typing pause: this folder (IMAP) or everywhere (local index).
  const search = (value: string, nextScope = scope) => {
    setCheckedUids([]);
    setQuery(value);
    ++requestSeq.current;
    setBusy(false);
    stopSearch();
    setSearchBusy(false);
    if (!accountReady || unified) return;
    const term = value.trim();
    if (term.length < 2) {
      setError('');
      if (searchTotal !== null) {
        setSearchTotal(null);
        void loadMessages(folder);
      }
      return;
    }
    setSearchBusy(true);
    const seq = requestSeq.current;
    searchTimer.current = window.setTimeout(async () => {
      searchTimer.current = null;
      const controller = new AbortController();
      searchAbort.current = controller;
      try {
        if (nextScope === 'everywhere') {
          const data = await getJson<{ messages: Message[]; total: number }>(
            `/api/search/local?q=${encodeURIComponent(term)}`,
            undefined,
            controller.signal
          );
          if (controller.signal.aborted || seq !== requestSeq.current) return;
          setSearchTotal(data.total);
          setMessages(data.messages);
          setHasMore(false);
          setNextBeforeUid(null);
        } else {
          const data = await getJson<MessagePage>(
            `/api/search?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(term)}&limit=${PAGE}`,
            accountId,
            controller.signal
          );
          if (controller.signal.aborted || seq !== requestSeq.current) return;
          setSearchTotal(data.total);
          applyPage(data, false);
        }
      } catch (err) {
        if (!controller.signal.aborted && seq === requestSeq.current) setError((err as Error).message);
      } finally {
        if (seq === requestSeq.current) setSearchBusy(false);
      }
    }, 350);
  };

  const refresh = () => {
    if (searching) search(query);
    else void loadMessages(folder);
    void loadFolders(false);
  };

  // ------------------------------------------------------------------ snooze & follow-up
  useEffect(() => {
    if (!inSnoozeFolder) {
      setSnoozed([]);
      return;
    }
    let active = true;
    getJson<{ items: { id: string; messageId: string | null; until: string }[] }>('/api/snoozed', accountId)
      .then(d => {
        if (active) setSnoozed(d.items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [inSnoozeFolder, accountId, messages.length]);

  useEffect(() => {
    let active = true;
    const load = () =>
      getJson<{ items: { state: string }[] }>('/api/followups')
        .then(d => {
          if (active) setFollowupsDue(d.items.filter(i => i.state === 'due').length);
        })
        .catch(() => {});
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function snooze(uids: number[], until: Date) {
    if (!writeEnabled || !uids.length) return;
    setActionBusy(true);
    try {
      const r = await postAction<{ snoozed: number; until: string; ids: string[] }>(
        '/api/messages/snooze',
        { folder, uids, until: until.toISOString() },
        accountId
      );
      if (selectedUid !== null && uids.includes(selectedUid)) selectUid(nextAfterRemoval(uids), false);
      setMessages(old => old.filter(m => !uids.includes(m.uid)));
      setCheckedUids(old => old.filter(u => !uids.includes(u)));
      toast({
        text: t('Zurückgestellt bis {when}.', { when: fullDateLabel(r.until) }),
        kind: 'success',
        timeout: 8000,
        action: {
          label: t('Rückgängig'),
          run: () => {
            void Promise.all(r.ids.map(id => postAction('/api/snoozed/wake', { id }, accountId)))
              .then(() => {
                void loadMessages(folder);
                void loadFolders(false);
              })
              .catch((e: Error) => toast({ text: e.message, kind: 'error' }));
          }
        }
      });
      void loadFolders(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }
  async function wake(id: string) {
    try {
      await postAction('/api/snoozed/wake', { id }, accountId);
      toast({ text: t('Zurück im Posteingang.'), kind: 'success' });
      void loadMessages(folder);
      void loadFolders(false);
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }
  const snoozedEntry =
    detail && inSnoozeFolder ? snoozed.find(s => s.messageId && s.messageId === detail.messageId) : undefined;

  const nextAfterRemoval = (uids: number[]) => {
    const index = visibleMessages.findIndex(m => uids.includes(m.uid));
    const rest = visibleMessages.filter(m => !uids.includes(m.uid));
    return rest[Math.min(index, rest.length - 1)]?.uid ?? null;
  };

  /** One request for one or many messages (server: batch-action, max 500). */
  async function runAction(action: ReaderAction, uids: number[], destination?: string, source = folder) {
    if (!writeEnabled || !uids.length || actionBusy) return false;
    if ((action === 'archive' && !archiveExists) || (action === 'trash' && isTrash && source === folder)) return false;
    setActionBusy(true);
    setError('');
    try {
      type Undo = { folder: string; action: ReaderAction; uids: string[]; destination?: string } | null;
      const data = await postAction<{ destination: string | null; count: number; undo?: Undo }>(
        '/api/messages/batch-action',
        { folder: source, action, uids, ...(action === 'move' ? { destination } : {}) },
        accountId
      );
      if (['markRead', 'markUnread', 'flag', 'unflag'].includes(action)) {
        const patch: Partial<Message> =
          action === 'markRead'
            ? { unread: false }
            : action === 'markUnread'
              ? { unread: true }
              : { flagged: action === 'flag' };
        const changedUnread =
          action === 'markRead' || action === 'markUnread'
            ? messages.filter(m => uids.includes(m.uid) && m.unread !== (action === 'markUnread')).length
            : 0;
        const before = new Map(
          messages.filter(m => uids.includes(m.uid)).map(m => [m.uid, { unread: m.unread, flagged: m.flagged }])
        );
        setMessages(old => old.map(m => (uids.includes(m.uid) ? { ...m, ...patch } : m)));
        if (uids.length > 1 && data.undo) {
          const undo = data.undo;
          toast({
            text: t('{count} Nachrichten geändert.', { count: uids.length }),
            kind: 'success',
            timeout: 8000,
            action: {
              label: t('Rückgängig'),
              run: () => {
                void postAction('/api/messages/batch-action', undo, accountId).then(() =>
                  setMessages(old => old.map(m => (before.has(m.uid) ? { ...m, ...before.get(m.uid) } : m)))
                );
              }
            }
          });
        }
        if (detail && uids.includes(detail.uid) && 'flagged' in patch) setDetail({ ...detail, flagged: patch.flagged });
        if (changedUnread)
          setFolders(old =>
            old.map(f =>
              f.path === source && typeof f.unseen === 'number'
                ? { ...f, unseen: Math.max(0, f.unseen + (action === 'markUnread' ? changedUnread : -changedUnread)) }
                : f
            )
          );
      } else if (source === folder) {
        if (selectedUid !== null && uids.includes(selectedUid)) selectUid(nextAfterRemoval(uids), false);
        setMessages(old => old.filter(m => !uids.includes(m.uid)));
        const destination = folders.find(f => f.path === data.destination);
        const target = destination ? folderLabel(destination) : data.destination;
        const undo = data.undo;
        toast({
          text:
            uids.length === 1
              ? t('Nach „{folder}“ verschoben.', { folder: target || '' })
              : t('{count} Nachrichten nach „{folder}“ verschoben.', { count: uids.length, folder: target || '' }),
          kind: 'success',
          timeout: undo ? 8000 : 5000,
          // Undo moves the messages back (their new UIDs come from the server's COPYUID reply).
          action: undo
            ? {
                label: t('Rückgängig'),
                run: () => {
                  void postAction('/api/messages/batch-action', undo, accountId)
                    .then(() => {
                      toast({ text: t('Rückgängig gemacht.'), kind: 'info' });
                      void loadMessages(folder);
                      void loadFolders(false);
                    })
                    .catch((e: Error) => toast({ text: e.message, kind: 'error' }));
                }
              }
            : undefined
        });
        void loadFolders(false);
      }
      setCheckedUids(old => old.filter(u => !uids.includes(u)));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  const mutateMessage = (action: ReaderAction, destination?: string) => {
    if (selectedUid === null) return;
    void runAction(action, [selectedUid], destination);
  };
  const mutateSelected = (action: ReaderAction) => {
    const uids = checkedUids.filter(uid => visibleUids.includes(uid));
    void runAction(action, uids);
  };

  const createArchive = async () => {
    if (!writeEnabled || actionBusy) return;
    if (
      !(await confirm({
        title: t('Archivordner anlegen?'),
        message: t('Auf dem Mailserver wird ein neuer Ordner „Archive“ angelegt.'),
        confirmLabel: t('Anlegen')
      }))
    )
      return;
    setActionBusy(true);
    try {
      const data = await postAction<{ folder: string }>(
        '/api/folders/create-archive',
        { confirm: 'CREATE_ARCHIVE' },
        accountId
      );
      await loadFolders(false);
      toast({ text: t('Archivordner „{folder}“ ist bereit.', { folder: data.folder }), kind: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  // ------------------------------------------------------------------ folder management
  const validateFolderName = (v: string) =>
    // eslint-disable-next-line no-control-regex
    /^[^/\\.%*\u0000-\u001f]{1,80}$/.test(v.trim()) ? null : t('1–80 Zeichen, ohne / \\ . % *');
  async function manageFolder(op: 'create' | 'rename' | 'delete', target?: Folder) {
    setFolderMenu(null);
    let name = '';
    if (op === 'create') {
      const v = await prompt({
        title: target ? t('Unterordner in „{folder}“', { folder: target.name }) : t('Neuer Ordner'),
        label: t('Name'),
        confirmLabel: t('Anlegen'),
        validate: validateFolderName
      });
      if (v === null) return;
      name = v.trim();
    } else if (op === 'rename' && target) {
      const v = await prompt({
        title: t('Ordner umbenennen'),
        label: t('Name'),
        value: target.name,
        confirmLabel: t('Umbenennen'),
        validate: validateFolderName
      });
      if (v === null || v.trim() === target.name) return;
      name = v.trim();
    } else if (op === 'delete' && target) {
      if (
        !(await confirm({
          title: t('Ordner „{folder}“ löschen?', { folder: target.name }),
          message: t('Nur leere Ordner ohne Unterordner können gelöscht werden. Bitte Nachrichten vorher verschieben.'),
          confirmLabel: t('Löschen'),
          danger: true
        }))
      )
        return;
    }
    try {
      const r = await postAction<{ path?: string }>(
        '/api/folders/manage',
        {
          op,
          path: op === 'create' ? undefined : target?.path,
          parent: op === 'create' ? target?.path || '' : undefined,
          name
        },
        accountId
      );
      await loadFolders(false);
      if (op === 'delete' && target?.path === folder) chooseFolder(folders.find(isInbox)?.path || 'INBOX');
      if (op === 'rename' && target?.path === folder && r.path) chooseFolder(r.path);
      toast({
        text:
          op === 'create' ? t('Ordner angelegt.') : op === 'rename' ? t('Ordner umbenannt.') : t('Ordner gelöscht.'),
        kind: 'success'
      });
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }

  const acceptsDrop = (e: DragEvent, f: Folder) =>
    writeEnabled && f.path !== folder && Array.from(e.dataTransfer.types).includes(DRAG_TYPE);
  async function dropOn(e: DragEvent, f: Folder) {
    setDropTarget(null);
    if (!acceptsDrop(e, f)) return;
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as {
        accountId: string;
        folder: string;
        uids: number[];
      };
      if (data.accountId !== accountId || !Array.isArray(data.uids) || !data.uids.length) return;
      const action: ReaderAction = f.specialUse === '\\Trash' ? 'trash' : f.specialUse === '\\Junk' ? 'spam' : 'move';
      await runAction(action, data.uids.slice(0, 500), action === 'move' ? f.path : undefined, data.folder);
    } catch {
      /* foreign drag data */
    }
  }

  // ------------------------------------------------------------------ composer entry points
  const defaultIdentity = (d?: Detail | null) => {
    if (d) {
      const addresses = [...d.to, ...d.cc, ...(d.bcc || [])].map(a => a.email.toLowerCase());
      const match = identities.find(i => addresses.includes(i.email.toLowerCase()));
      if (match) return match;
    }
    return identities[0];
  };
  const signatureFor = (identity?: Identity) =>
    identity?.signatureHtml ? `${SIGNATURE_SEPARATOR}${identity.signatureHtml}` : '';
  const open = (initial: ComposeInitial) => {
    setComposer(initial);
    setComposerKey(k => k + 1);
    setMobileSidebar(false);
  };
  const beginNewMessage = () => {
    const id = defaultIdentity();
    open({ mode: 'new', to: '', cc: '', bcc: '', subject: '', html: `<p></p>${signatureFor(id)}`, from: id?.email });
  };
  const attribution = (d: Detail) =>
    t('Am {date} schrieb {name}:', { date: fullDateLabel(d.date), name: d.from[0]?.name || d.from[0]?.email || '' });
  const beginReply = (all = false) => {
    if (!detail) return;
    const id = defaultIdentity(detail);
    const own = id?.email || status?.sender || null;
    const recipients = all ? replyAllRecipients(detail, own) : { to: [replyRecipient(detail, own)], cc: [] };
    open({
      mode: all ? 'replyAll' : 'reply',
      from: id?.email,
      to: recipients.to.join(', '),
      cc: recipients.cc.join(', '),
      bcc: '',
      subject: /^(re|aw):/i.test(detail.subject) ? detail.subject : `Re: ${detail.subject}`,
      html: `<p></p>${signatureFor(id)}<p>${escapeHtml(attribution(detail))}</p><blockquote>${quotedHtml(detail)}</blockquote>`,
      inReplyTo: detail.messageId || undefined,
      references: detail.messageId || undefined,
      security: detail.crypto?.encrypted ? { method: detail.crypto.method, sign: true, encrypt: true } : undefined
    });
  };

  async function fetchAttachments(d: Detail, onlyFiles: boolean) {
    const list = d.attachments.filter(a => !onlyFiles || !a.embedded);
    if (list.length > 8 || list.reduce((n, a) => n + a.size, 0) > 8 * 1024 * 1024) return null;
    const files: File[] = [];
    for (const att of list) {
      const response = await fetch(
        accountPath(`/api/messages/${d.uid}/attachments/${att.index}?folder=${encodeURIComponent(folder)}`, accountId),
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error(t('Anhang {name} konnte nicht geladen werden.', { name: att.filename }));
      const blob = await response.blob();
      if (blob.size !== att.size) throw new Error(t('Anhang {name} ist unvollständig.', { name: att.filename }));
      files.push(new File([blob], att.filename, { type: att.mimeType || 'application/octet-stream' }));
    }
    return files;
  }

  const beginForward = async () => {
    if (!detail || composeBusy) return;
    setComposeBusy(true);
    setError('');
    try {
      const files = await fetchAttachments(detail, true);
      const id = defaultIdentity(detail);
      const from = detail.from[0]?.name
        ? `${detail.from[0].name} <${detail.from[0].email}>`
        : detail.from[0]?.email || '';
      const head = `<p>---------- ${escapeHtml(t('Weitergeleitete Nachricht'))} ----------<br>${escapeHtml(t('Von'))}: ${escapeHtml(from)}<br>${escapeHtml(t('Datum'))}: ${escapeHtml(fullDateLabel(detail.date))}<br>${escapeHtml(t('Betreff'))}: ${escapeHtml(detail.subject)}<br>${escapeHtml(t('An'))}: ${escapeHtml(detail.to.map(a => a.email).join(', '))}</p>`;
      open({
        mode: 'forward',
        from: id?.email,
        to: '',
        cc: '',
        bcc: '',
        subject: /^(fwd|wg):/i.test(detail.subject) ? detail.subject : `Fwd: ${detail.subject}`,
        html: `<p></p>${signatureFor(id)}${head}${quotedHtml(detail)}`,
        attachments: files || [],
        notice:
          files === null
            ? t('Die Anhänge sind zusammen größer als 8 MiB bzw. mehr als acht und wurden nicht übernommen.')
            : undefined
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setComposeBusy(false);
    }
  };

  const beginEditDraft = async () => {
    if (!detail?.draftId || !detail.uidValidity || !isDraftFolder || selectedUid === null || composeBusy) return;
    setComposeBusy(true);
    setError('');
    try {
      const files = await fetchAttachments(detail, false);
      if (files === null)
        throw new Error(
          t('Der Entwurf enthält mehr als acht Anhänge oder über 8 MiB und kann hier nicht bearbeitet werden.')
        );
      const fromAddress = detail.from[0]?.email?.toLowerCase();
      open({
        mode: 'new',
        from: identities.find(i => i.email.toLowerCase() === fromAddress)?.email,
        to: detail.to.map(a => a.email).join(', '),
        cc: detail.cc.map(a => a.email).join(', '),
        bcc: (detail.bcc || []).map(a => a.email).join(', '),
        subject: detail.subject === '(Ohne Betreff)' ? '' : detail.subject,
        ...(detail.html
          ? { html: DOMPurify.sanitize(detail.html), format: 'html' as const }
          : { text: detail.text, format: 'text' as const }),
        draftId: detail.draftId,
        draftUid: selectedUid,
        draftUidValidity: detail.uidValidity,
        attachments: files.filter(f => !detail.attachments.find(a => a.filename === f.name)?.embedded),
        scheduledFor: detail.scheduledFor
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setComposeBusy(false);
    }
  };

  const openMessage = (message: Message) => {
    if ((unified || everywhere) && message.accountId) {
      const targetFolder = message.folder || 'INBOX';
      if (message.accountId === accountId) {
        pendingOpen.current = message.uid;
        chooseFolder(folders.find(f => f.path === targetFolder)?.path || folders.find(isInbox)?.path || 'INBOX');
      } else {
        onSelectAccount(message.accountId, { uid: message.uid, folder: targetFolder });
      }
      return;
    }
    selectUid(message.uid);
  };

  // Keyboard shortcuts (inactive while typing, in dialogs, in the composer or in other modules).
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event: KeyboardEvent) => {
    if (!visible || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || composer || shortcuts)
      return;
    if (document.querySelector('.confirm-scrim, .preview-scrim, .palette-scrim')) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    )
      return;
    const key = event.key;
    const run = (fn: () => void) => {
      event.preventDefault();
      fn();
    };
    if (key === '?') return run(() => setShortcuts(true));
    if (key === 'Escape')
      return run(() => {
        setCheckedUids([]);
        setReaderOpen(false);
      });
    if (key === 'n' || key === 'c') return run(beginNewMessage);
    if (key === '/') return run(() => document.querySelector<HTMLInputElement>('.searchbox input')?.focus());
    if (key === 'j' || key === 'k') {
      if (!visibleMessages.length) return;
      return run(() => {
        const keyed = unified || everywhere;
        const index = visibleMessages.findIndex(m =>
          keyed ? `${m.accountId}:${m.uid}` === selectedKey : m.uid === selectedUid
        );
        const next =
          key === 'j' ? Math.min(visibleMessages.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
        const m = visibleMessages[next];
        if (keyed) setSelectedKey(`${m.accountId}:${m.uid}`);
        else selectUid(m.uid);
        document.querySelectorAll<HTMLElement>('.message-row')[next]?.scrollIntoView({ block: 'nearest' });
      });
    }
    if (!detail || detailBusy) return;
    if (key === 'r') return run(() => beginReply(false));
    if (key === 'a') return run(() => beginReply(true));
    if (key === 'f') return run(() => void beginForward());
    if (key === 'u') return run(() => mutateMessage(selected?.unread ? 'markRead' : 'markUnread'));
    if (key === 's') return run(() => mutateMessage(detail.flagged ? 'unflag' : 'flag'));
    if (key === 'b') return run(() => document.querySelector<HTMLButtonElement>('[data-snooze]')?.click());
    if (key === 'e' && archiveExists) return run(() => mutateMessage('archive'));
    if (key === '!') return run(() => mutateMessage(isJunk ? 'notSpam' : 'spam'));
    if ((key === 'Delete' || key === '#') && !isTrash) return run(() => mutateMessage('trash'));
    if (key === 'p')
      return run(() =>
        printMessage(detail, { from: t('Von'), to: t('An'), cc: 'CC', date: t('Datum'), attachments: t('Anhänge') })
      );
  };
  // Commands from the palette (Ctrl/⌘+K).
  const commandHandler = useRef<(c: MailCommand) => void>(() => {});
  commandHandler.current = (c: MailCommand) => {
    if (!visible) return;
    if (c.type === 'compose') beginNewMessage();
    else if (c.type === 'search') document.querySelector<HTMLInputElement>('.searchbox input')?.focus();
    else if (c.type === 'followups') chooseFolder(FOLLOWUPS);
    else if (c.type === 'shortcuts') setShortcuts(true);
    else if (c.type === 'folder') chooseFolder(c.path);
  };
  useEffect(() => {
    const onCommand = (e: Event) => commandHandler.current((e as CustomEvent<MailCommand>).detail);
    window.addEventListener('levuvo:command', onCommand);
    return () => window.removeEventListener('levuvo:command', onCommand);
  }, []);
  useEffect(() => {
    if (visible)
      publishFolders(
        accountId,
        ordered
          .map(o => o.folder)
          .filter(f => f.selectable !== false)
          .map(f => ({ path: f.path, label: folderLabel(f), unseen: f.unseen }))
      );
    // folderLabel only depends on the language, which re-renders anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, accountId, ordered]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const resizeList = (width: number) => setListWidth(Math.max(300, Math.min(680, Math.round(width))));
  const listTitle = followupView
    ? t('Nachfassen')
    : unified
      ? t('Alle Posteingänge')
      : everywhere
        ? t('Suche in allen Ordnern')
        : folderLabel(currentFolder);
  const menuFolder = folderMenu ? folders.find(f => f.path === folderMenu.path) : null;
  const filters: { id: Filter; label: string; icon?: typeof Star }[] = [
    { id: 'all', label: t('Alle') },
    { id: 'unread', label: t('Ungelesen') },
    { id: 'flagged', label: t('Markiert'), icon: Star },
    { id: 'attachments', label: t('Anhang'), icon: Paperclip }
  ];
  const countLabel = searchBusy
    ? t('Suche läuft …')
    : searching
      ? t('{count} Treffer', { count: searchTotal ?? 0 })
      : checkedCount
        ? t('{count} ausgewählt', { count: checkedCount })
        : unified
          ? t('{count} neueste', { count: visibleMessages.length })
          : filter !== 'all'
            ? t('{count} von {total} geladenen', { count: visibleMessages.length, total: messages.length })
            : `${t('{count} Nachrichten', { count: currentFolder?.total ?? visibleMessages.length })}${currentFolder?.unseen ? ` · ${t('{count} ungelesen', { count: currentFolder.unseen })}` : ''}`;

  return (
    <div className="app-shell">
      <div className="workspace" style={{ '--mail-list-width': `${listWidth}px` } as CSSProperties}>
        <aside className={`sidebar ${mobileSidebar ? 'sidebar-open' : ''}`}>
          <div className="sidebar-inner">
            <div className="sidebar-brand">
              <img src="/levuvo-header-logo.png" alt="Levuvo" className="brand-image" />
              <span className="brand-product">
                mail<span className="brand-dot">.</span>
              </span>
            </div>
            <button className="compose-button" onClick={beginNewMessage} disabled={!status?.configured}>
              <PenSquare size={17} />
              <span>{t('Neue Nachricht')}</span>
            </button>
            <nav className="folders" aria-label={t('Ordner')}>
              {accounts.length > 1 && (
                <button onClick={() => chooseFolder(UNIFIED)} className={`folder-item ${unified ? 'active' : ''}`}>
                  <Mails size={16} strokeWidth={1.8} />
                  <span>{t('Alle Posteingänge')}</span>
                </button>
              )}
              <button
                onClick={() => chooseFolder(FOLLOWUPS)}
                className={`folder-item ${followupView ? 'active' : ''}`}
                title={t('Gesendete Nachrichten ohne Antwort')}
              >
                <BellRing size={16} strokeWidth={1.8} />
                <span>{t('Nachfassen')}</span>
                {followupsDue > 0 && (
                  <span className="folder-count attention" aria-label={t('{count} fällig', { count: followupsDue })}>
                    {followupsDue}
                  </span>
                )}
              </button>
              {ordered.map(({ folder: f, depth }) => {
                const Icon = folderIcon(f);
                const count = ['\\Sent', '\\Drafts', '\\Trash', '\\Junk'].includes(f.specialUse || '')
                  ? null
                  : f.unseen;
                return (
                  <div
                    key={f.path}
                    className={`folder-row ${dropTarget === f.path ? 'drop-target' : ''}`}
                    style={{ '--depth': depth } as CSSProperties}
                    onDragOver={e => {
                      if (acceptsDrop(e, f)) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        setDropTarget(f.path);
                      }
                    }}
                    onDragLeave={() => setDropTarget(old => (old === f.path ? null : old))}
                    onDrop={e => void dropOn(e, f)}
                    onContextMenu={e => {
                      if (!writeEnabled) return;
                      e.preventDefault();
                      setFolderMenu({ path: f.path, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <button
                      onClick={() => chooseFolder(f.path)}
                      className={`folder-item ${folder === f.path ? 'active' : ''}`}
                      title={f.path}
                    >
                      <Icon size={16} strokeWidth={1.8} />
                      <span>{folderLabel(f)}</span>
                      {count ? (
                        <span className="folder-count" aria-label={t('{count} ungelesen', { count })}>
                          {count > 999 ? '999+' : count}
                        </span>
                      ) : null}
                    </button>
                    {writeEnabled && (
                      <button
                        className="folder-more"
                        aria-label={t('Ordneraktionen: {folder}', { folder: f.name })}
                        onClick={e => {
                          const r = e.currentTarget.getBoundingClientRect();
                          setFolderMenu({ path: f.path, x: r.left, y: r.bottom });
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
              {writeEnabled && (
                <button className="folder-item add-folder" onClick={() => void manageFolder('create')}>
                  <FolderPlus size={16} strokeWidth={1.8} />
                  <span>{t('Neuer Ordner')}</span>
                </button>
              )}
            </nav>
            <div className="sidebar-footer">
              <label className="account-card account-picker">
                <span className="account-avatar">{(account?.label || 'L').trim().charAt(0).toUpperCase()}</span>
                <span className="account-data">
                  <strong>{account?.label || t('Konto')}</strong>
                  <small>{status?.mailbox || t('Nicht verbunden')}</small>
                </span>
                {accounts.length > 1 && <ChevronDown size={15} />}
                <select
                  aria-label={t('Konto wechseln')}
                  value={accountId}
                  disabled={accounts.length < 2 || actionBusy}
                  onChange={async e => {
                    const id = e.target.value;
                    if (
                      composer &&
                      !(await confirm({
                        title: t('Konto wechseln?'),
                        message: t('Der offene Editor wird geschlossen. Nicht gespeicherte Änderungen gehen verloren.'),
                        confirmLabel: t('Wechseln')
                      }))
                    )
                      return;
                    setComposer(null);
                    onSelectAccount(id);
                  }}
                >
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.mailbox || t('Nicht verbunden')}
                    </option>
                  ))}
                </select>
              </label>
              <button className="text-button subtle account-settings-link" onClick={() => onOpenSettings('accounts')}>
                {t('Konten & Signaturen')}
              </button>
              <div className="sidebar-motto">Less effort. More impact.</div>
            </div>
          </div>
        </aside>
        {mobileSidebar && (
          <button className="mobile-overlay" aria-label={t('Menü schließen')} onClick={() => setMobileSidebar(false)} />
        )}
        {folderMenu && menuFolder && (
          <>
            <button className="menu-dismiss" aria-label={t('Menü schließen')} onClick={() => setFolderMenu(null)} />
            <div
              className="menu floating"
              role="menu"
              style={{ left: folderMenu.x, top: folderMenu.y }}
              onKeyDown={e => {
                if (e.key === 'Escape') setFolderMenu(null);
              }}
            >
              <button role="menuitem" onClick={() => void manageFolder('create', menuFolder)}>
                {t('Unterordner anlegen')}
              </button>
              {!PROTECTED.has(special(menuFolder)) && (
                <button role="menuitem" onClick={() => void manageFolder('rename', menuFolder)}>
                  {t('Umbenennen')}
                </button>
              )}
              {!PROTECTED.has(special(menuFolder)) && (
                <button role="menuitem" className="danger" onClick={() => void manageFolder('delete', menuFolder)}>
                  {t('Löschen')}
                </button>
              )}
              {menuFolder.unseen ? (
                <button
                  role="menuitem"
                  onClick={() => {
                    setFolderMenu(null);
                    if (menuFolder.path === folder)
                      void runAction(
                        'markRead',
                        messages.filter(m => m.unread).map(m => m.uid)
                      );
                    else chooseFolder(menuFolder.path);
                  }}
                >
                  {t('Geladene als gelesen markieren')}
                </button>
              ) : null}
            </div>
          </>
        )}
        <main className="message-column">
          <div className="message-header">
            <div className="message-title-row">
              <button
                className="mobile-menu icon-button"
                aria-label={t('Menü')}
                onClick={() => setMobileSidebar(!mobileSidebar)}
              >
                <Menu size={20} />
              </button>
              <h1>
                {listTitle}
                <span className="period">.</span>
              </h1>
              <span
                className={`connection-pill ${stale ? 'offline' : pushState?.connected ? 'live' : health?.error || pushState?.error ? 'error' : ''}`}
                title={
                  stale
                    ? t('Mailserver nicht erreichbar – zuletzt geladene Daten werden angezeigt.')
                    : pushState?.connected
                      ? t('Neue E-Mails erscheinen sofort (IMAP IDLE).')
                      : pushState?.error || health?.error || t('Verbindung wird aufgebaut.')
                }
              >
                <span className="pill-dot" />
                {connectionLabel}
              </span>
              <button
                className="icon-button"
                title={t('Tastenkürzel (?)')}
                aria-label={t('Tastenkürzel')}
                onClick={() => setShortcuts(true)}
              >
                <Keyboard size={17} />
              </button>
              <button
                onClick={refresh}
                className="icon-button"
                title={t('Aktualisieren')}
                aria-label={t('Aktualisieren')}
                disabled={busy}
              >
                <RefreshCcw size={17} className={busy ? 'spin' : ''} />
              </button>
            </div>
            {!unified && !followupView && (
              <div className="search-row">
                <label className="searchbox">
                  <Search size={16} />
                  <input
                    type="search"
                    aria-label={t('Suchen')}
                    disabled={!accountReady}
                    placeholder={
                      scope === 'everywhere'
                        ? t('Alle Ordner und Konten durchsuchen (auch offline)')
                        : t('In „{folder}“ suchen', { folder: folderLabel(currentFolder) })
                    }
                    value={query}
                    maxLength={120}
                    onChange={e => search(e.target.value)}
                  />
                  {query && (
                    <button
                      aria-label={t('Suche löschen')}
                      onClick={() => {
                        setScope('folder');
                        search('', 'folder');
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </label>
                <button
                  className={`scope-toggle ${scope === 'everywhere' ? 'active' : ''}`}
                  aria-pressed={scope === 'everywhere'}
                  title={t('Überall suchen (lokaler, verschlüsselter Suchindex)')}
                  onClick={() => {
                    const next = scope === 'everywhere' ? 'folder' : 'everywhere';
                    setScope(next);
                    if (query.trim().length >= 2) search(query, next);
                    else if (next === 'folder' && searchTotal !== null) void loadMessages(folder);
                  }}
                >
                  <Globe2 size={15} />
                  <span>{t('Überall')}</span>
                </button>
              </div>
            )}
            {!followupView && (
              <div className="list-toolbar">
                {!unified && !everywhere && (
                  <label className="select-all">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={e => setCheckedUids(e.target.checked ? visibleUids : [])}
                      disabled={!visibleUids.length || actionBusy}
                      aria-label={t('Alle sichtbaren auswählen')}
                    />
                  </label>
                )}
                {checkedCount > 0 ? (
                  <div className="bulk-toolbar" aria-label={t('Sammelaktionen')}>
                    <span aria-live="polite">{countLabel}</span>
                    <button
                      disabled={!writeEnabled || actionBusy}
                      onClick={() => mutateSelected('markRead')}
                      title={t('Als gelesen markieren')}
                      aria-label={t('Als gelesen markieren')}
                    >
                      <CheckCheck size={14} />
                    </button>
                    <button
                      disabled={!writeEnabled || actionBusy}
                      onClick={() => mutateSelected('markUnread')}
                      title={t('Als ungelesen markieren')}
                      aria-label={t('Als ungelesen markieren')}
                    >
                      <Mail size={14} />
                    </button>
                    <button
                      disabled={!writeEnabled || actionBusy}
                      onClick={() => mutateSelected('flag')}
                      title={t('Markieren')}
                      aria-label={t('Markieren')}
                    >
                      <Star size={14} />
                    </button>
                    <button
                      disabled={!writeEnabled || actionBusy || !archiveExists}
                      onClick={() => mutateSelected('archive')}
                      title={t('Archivieren')}
                      aria-label={t('Archivieren')}
                    >
                      <Archive size={14} />
                    </button>
                    <button
                      disabled={!writeEnabled || actionBusy}
                      onClick={() => mutateSelected(isJunk ? 'notSpam' : 'spam')}
                      title={isJunk ? t('Kein Spam') : t('Als Spam markieren')}
                      aria-label={isJunk ? t('Kein Spam') : t('Als Spam markieren')}
                    >
                      <ShieldAlert size={14} />
                    </button>
                    <button
                      disabled={!writeEnabled || actionBusy || isTrash}
                      onClick={() => mutateSelected('trash')}
                      title={t('In den Papierkorb')}
                      aria-label={t('In den Papierkorb')}
                    >
                      <Trash2 size={14} />
                    </button>
                    <span className="menu-anchor">
                      <button
                        disabled={!writeEnabled || actionBusy || isDraftFolder}
                        onClick={() => setBulkSnooze(!bulkSnooze)}
                        title={t('Zurückstellen')}
                        aria-label={t('Zurückstellen')}
                        aria-expanded={bulkSnooze}
                      >
                        <AlarmClock size={14} />
                      </button>
                      {bulkSnooze && (
                        <WhenMenu
                          title={t('Zurückstellen bis')}
                          onClose={() => setBulkSnooze(false)}
                          onPick={date => {
                            setBulkSnooze(false);
                            void snooze(
                              checkedUids.filter(uid => visibleUids.includes(uid)),
                              date
                            );
                          }}
                        />
                      )}
                    </span>
                    <button
                      disabled={actionBusy}
                      onClick={() => setCheckedUids([])}
                      title={t('Auswahl aufheben')}
                      aria-label={t('Auswahl aufheben')}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="list-count" aria-live="polite">
                      {countLabel}
                    </span>
                    {!unified && !everywhere && (
                      <div className="filter-chips" role="group" aria-label={t('Filter')}>
                        {filters.map(f => (
                          <button
                            key={f.id}
                            className={filter === f.id ? 'active' : ''}
                            aria-pressed={filter === f.id}
                            onClick={() => setFilter(f.id)}
                          >
                            {f.icon && <f.icon size={12} />}
                            {f.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {stale && (
            <div className="offline-banner">
              <CloudOff size={15} />
              <span>
                {t('Offline – Stand von {time}. Änderungen sind erst wieder online möglich.', {
                  time: new Date(stale).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
                })}
              </span>
              <button onClick={refresh}>{t('Erneut verbinden')}</button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={refresh} disabled={busy}>
                {t('Erneut versuchen')}
              </button>
              <button aria-label={t('Meldung schließen')} onClick={() => setError('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {followupView ? (
            <FollowupList
              accounts={accounts}
              onChanged={setFollowupsDue}
              onShowSent={(id, subject) => {
                const sent = folders.find(f => f.specialUse === '\\Sent');
                if (id !== accountId) {
                  onSelectAccount(id);
                  return;
                }
                if (sent) {
                  chooseFolder(sent.path);
                  window.setTimeout(() => search(subject.slice(0, 80)), 50);
                }
              }}
            />
          ) : (
            <MessageList
              messages={visibleMessages}
              selectedUid={selectedUid}
              selectedKey={selectedKey}
              checkedUids={checkedUids}
              busy={busy || searchBusy}
              bulkBusy={actionBusy}
              conversations={prefs.conversations && !everywhere}
              unified={unified || everywhere}
              hasMore={hasMore && (!query.trim() || searching) && !everywhere}
              loadingMore={loadingMore}
              draggable={writeEnabled}
              folder={folder}
              accountId={accountId}
              emptyText={
                everywhere
                  ? t(
                      'Keine Treffer im lokalen Suchindex. Der Index wird im Hintergrund aufgebaut (Einstellungen → Suche & Offline).'
                    )
                  : filter !== 'all'
                    ? t('Keine passenden Nachrichten unter den geladenen.')
                    : undefined
              }
              onSelect={openMessage}
              onToggleChecked={(uid, checked) =>
                setCheckedUids(old => (checked ? Array.from(new Set([...old, uid])) : old.filter(x => x !== uid)))
              }
              onToggleFlag={writeEnabled ? m => void runAction(m.flagged ? 'unflag' : 'flag', [m.uid]) : undefined}
              quick={
                writeEnabled && !isDraftFolder
                  ? {
                      archive: archiveExists && currentFolder?.specialUse !== '\\Archive',
                      trash: !isTrash,
                      onAction: (m, action) => void runAction(action, [m.uid]),
                      onSnooze: (m, until) => void snooze([m.uid], until)
                    }
                  : undefined
              }
              onLoadMore={() => void loadMore()}
            />
          )}
        </main>
        <div
          className="column-resizer"
          role="separator"
          aria-label={t('Listenbreite ändern')}
          aria-orientation="vertical"
          aria-valuemin={300}
          aria-valuemax={680}
          aria-valuenow={listWidth}
          tabIndex={0}
          title={t('Ziehen oder Pfeiltasten · Doppelklick setzt zurück')}
          onPointerDown={e => {
            if (e.button !== 0) return;
            resizeAnchor.current = { x: e.clientX, width: listWidth };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (resizeAnchor.current) resizeList(resizeAnchor.current.width + e.clientX - resizeAnchor.current.x);
          }}
          onPointerUp={e => {
            resizeAnchor.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            setPrefs({ listWidth });
          }}
          onPointerCancel={() => {
            resizeAnchor.current = null;
          }}
          onDoubleClick={() => {
            resizeList(400);
            setPrefs({ listWidth: 400 });
          }}
          onKeyDown={e => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            e.stopPropagation();
            const w = Math.max(300, Math.min(680, listWidth + (e.key === 'ArrowRight' ? 20 : -20)));
            setListWidth(w);
            setPrefs({ listWidth: w });
          }}
        >
          <GripVertical size={14} />
        </div>
        <Reader
          accountId={accountId}
          message={unified || everywhere ? null : selected}
          detail={unified || everywhere ? null : detail}
          detailBusy={detailBusy || composeBusy}
          detailError={detailError}
          folders={folders}
          folder={folder}
          writeEnabled={writeEnabled}
          draftsEnabled={Boolean(status?.draftsEnabled)}
          actionBusy={actionBusy}
          archiveExists={archiveExists}
          isTrash={isTrash}
          isJunk={isJunk}
          isDraftFolder={isDraftFolder}
          open={readerOpen}
          onClose={() => setReaderOpen(false)}
          onRetry={() => setReloadDetail(n => n + 1)}
          onReply={() => beginReply(false)}
          onReplyAll={() => beginReply(true)}
          onForward={() => void beginForward()}
          onEditDraft={() => void beginEditDraft()}
          onAction={mutateMessage}
          onCreateArchive={() => void createArchive()}
          onSnooze={until => selectedUid !== null && void snooze([selectedUid], until)}
          snoozedUntil={snoozedEntry?.until || null}
          onWake={snoozedEntry ? () => void wake(snoozedEntry.id) : undefined}
          onUnsubscribed={!isTrash ? () => mutateMessage('trash') : undefined}
          onOpenThreadMessage={(path, uid) => {
            if (path === folder) selectUid(uid);
            else {
              pendingOpen.current = uid;
              chooseFolder(path);
            }
          }}
        />
      </div>
      {composer && status && (
        <Composer
          key={composerKey}
          accountId={accountId}
          initial={composer}
          identities={identities}
          sendEnabled={Boolean(status.sendEnabled)}
          draftsEnabled={Boolean(status.draftsEnabled)}
          onClose={() => {
            setComposer(null);
            if (isDraftFolder) void loadMessages(folder);
          }}
          onSubmit={(payload, restore, sendAt) => {
            setComposer(null);
            onSubmitCompose(accountId, payload, restore, sendAt);
            if (isDraftFolder && restore.draftUid) window.setTimeout(() => void loadMessages(folder), 1500);
          }}
        />
      )}
      {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
    </div>
  );
}
