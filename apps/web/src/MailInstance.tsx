import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent
} from 'react';
import DOMPurify from 'dompurify';
import { isRemoteSrc } from './trackers';
import { CloudOff, Keyboard, Menu, PenSquare, RefreshCcw, X } from 'lucide-react';
import Composer, { type ComposeInitial, type OutgoingPayload } from './Composer';
import { plainToHtml, SIGNATURE_SEPARATOR } from './editor';
import MessageList, { DRAG_TYPE } from './MessageList';
import MailSidebar from './mail/MailSidebar';
import { useBundleSuggestions, useScreening } from './mail/useInboxOrder';
import { useFollowupsDue, useSnoozedEntries } from './mail/useFollowups';
import Reader, { printMessage, type ReaderAction } from './Reader';
import { ShortcutsDialog } from './Panels';
import { useUi } from './ConfirmDialog';
import { accountPath, getJson, postAction } from './api';
import { bodyText, fullDateLabel, replyAllRecipients, replyRecipient } from './format';
import { useT } from './i18n';
import { publishFolders, type MailCommand } from './command-bus';
import { isInbox, isSnoozeFolder, orderFolders, special } from './folder-utils';
import { isMissingMessage, removesMessages, snapshotApplies } from './mail-sync';
import FollowupList from './FollowupList';
import AttachmentOverview from './AttachmentOverview';
import { BundleHeader, BundleRows } from './Bundles';
import { ScreenerRow, ScreenerView } from './Screening';
import { usePrefs } from './prefs';
import type { SettingsTab } from './App';
import type {
  AccountItem,
  ApiStatus,
  Bundle,
  Detail,
  Folder,
  Identity,
  InboxSnapshot,
  Message,
  MessagePage
} from './types';

import { ATTACHMENTS, FOLLOWUPS, UNIFIED } from './mail/views';
import {
  countLabel as listCountLabel,
  initialListState,
  listReducer,
  nextAfterRemoval as nextAfter,
  PAGE,
  visibleList
} from './mail/list-state';
import ListToolbar from './mail/ListToolbar';
import ColumnResizer from './mail/ColumnResizer';
import SearchBar from './mail/SearchBar';
import { useMailSearch } from './mail/useMailSearch';
import { searchPath } from './mail/search-state';
export { ATTACHMENTS, FOLLOWUPS, UNIFIED };
const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function quotedHtml(d: Detail) {
  if (d.html) {
    const doc = DOMPurify.sanitize(d.html, {
      FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'iframe', 'svg', 'math', 'picture', 'source'],
      FORBID_ATTR: ['style', 'class', 'id', 'srcset', 'background'],
      RETURN_DOM_FRAGMENT: true
    });
    // The editor would load remote images of the quoted mail right away (tracking pixels, the
    // sender learns the reply is being written) although the reader blocks them: they become a
    // short text placeholder instead (SEC-LEV-006).
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      if (!isRemoteSrc(img.getAttribute('src'))) continue;
      const alt = (img.getAttribute('alt') || '').trim();
      img.replaceWith(alt ? document.createTextNode(`[${alt.slice(0, 200)}]`) : document.createTextNode(''));
    }
    const box = document.createElement('div');
    box.append(doc);
    const clean = box.innerHTML;
    return clean.length > 200_000 ? plainToHtml(bodyText(d).slice(0, 50_000)) : clean;
  }
  return plainToHtml(d.text.slice(0, 50_000));
}

type Props = {
  accountId: string;
  accounts: AccountItem[];
  visible: boolean;
  inboxSnapshot?: InboxSnapshot;
  /** Asks for a fresh inbox snapshot (after a local change made the cached one outdated). */
  onLocalChange?: () => void;
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
  onLocalChange,
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
  const [list, dispatchList] = useReducer(listReducer, initialListState);
  const { messages, hasMore, nextBeforeUid, loadingMore, stale, busy, error, checkedUids, filter } = list;
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const requestSeq = useRef(0);
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
  const pendingOpen = useRef<number | null>(initialOpen?.uid ?? null);
  const [listWidth, setListWidth] = useState(prefs.listWidth);

  const unified = folder === UNIFIED;
  const followupView = folder === FOLLOWUPS;
  const attachmentView = folder === ATTACHMENTS;
  // Views without their own message list (follow-ups, attachment overview).
  const panelView = followupView || attachmentView;
  // The last real folder: the attachment overview starts there.
  const lastRealFolder = useRef('INBOX');
  if (!folder.startsWith('\u0000')) lastRealFolder.current = folder;
  const accountReady = Boolean(status?.configured);
  // The list loader is defined further down; the search reloads the folder through this ref.
  const loadMessagesRef = useRef<(path: string) => Promise<void>>(async () => {});
  const search = useMailSearch({
    accountId,
    folder,
    accountReady,
    unified,
    list,
    dispatchList,
    requestSeq,
    reload: path => void loadMessagesRef.current(path)
  });
  const { query, scope, everywhere, searching } = search;
  const searchTotal = search.total;
  const searchBusy = search.busy;
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

  // Inbox bundles and sender screening: only in the inbox itself, not while searching.
  const plainInbox =
    Boolean(currentFolder && isInbox(currentFolder)) && !unified && !everywhere && !searching && !query.trim();
  const bundling = prefs.bundles && plainInbox;
  // Sender screening (decisions, unknown senders, blocked mail to spam) and optional AI bundles.
  const runActionRef = useRef<(action: ReaderAction, uids: number[]) => Promise<boolean>>(async () => false);
  const { screeningOn, blockedSenders, unknownSenders, screened, screener, setScreener, decideSender } = useScreening({
    enabled: prefs.screening,
    accountReady: Boolean(status?.configured),
    accountId,
    plainInbox,
    messages,
    writeEnabled,
    actionBusy,
    runAction: (action, uids) => runActionRef.current(action, uids)
  });
  const bundled = useBundleSuggestions(bundling, messages, accountId);
  const visibleMessages = useMemo(
    () =>
      visibleList({
        messages: bundled,
        query,
        searching,
        unified,
        filter,
        screening: screeningOn ? { screener, unknown: unknownSenders, blocked: blockedSenders } : null,
        bundling,
        bundle
      }),
    [
      bundled,
      query,
      searching,
      unified,
      filter,
      bundling,
      bundle,
      screeningOn,
      screener,
      unknownSenders,
      blockedSenders
    ]
  );
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

  const applyPage = useCallback(
    (page: MessagePage, append: boolean) => dispatchList({ type: 'pageLoaded', page, append, now: Date.now() }),
    []
  );

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
      dispatchList({ type: 'loadStarted' });
      try {
        if (path === FOLLOWUPS || path === ATTACHMENTS) {
          dispatchList({ type: 'emptied' });
          return;
        }
        if (path === UNIFIED) {
          const data = await getJson<{ messages: Message[] }>('/api/unified');
          if (seq !== requestSeq.current) return;
          dispatchList({ type: 'replaced', messages: data.messages });
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
        if (seq === requestSeq.current) dispatchList({ type: 'loadFailed', error: (e as Error).message });
      } finally {
        if (seq === requestSeq.current) dispatchList({ type: 'loadFinished' });
      }
    },
    [accountId, applyPage, selectUid]
  );
  loadMessagesRef.current = loadMessages;

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
        dispatchList({ type: 'error', error: (e as Error).message });
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
        dispatchList({
          type: 'error',
          error: t('Die lokale Mailverbindung ist nicht erreichbar. Bitte Levuvo Mail neu starten.')
        });
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
    if (everywhere) return search.loadMoreLocal();
    if (!hasMore || loadingMore || nextBeforeUid === null || unified) return;
    dispatchList({ type: 'loadingMore', value: true });
    const seq = requestSeq.current;
    try {
      const path = searching
        ? searchPath({ scope: 'folder', term: query.trim(), folder, limit: PAGE }, { beforeUid: nextBeforeUid })
        : `/api/messages?folder=${encodeURIComponent(folder)}&limit=${PAGE}&beforeUid=${nextBeforeUid}`;
      const page = await getJson<MessagePage>(path, accountId);
      if (seq === requestSeq.current) applyPage(page, true);
    } catch (e) {
      dispatchList({ type: 'error', error: (e as Error).message });
    } finally {
      dispatchList({ type: 'loadingMore', value: false });
    }
  }, [
    hasMore,
    loadingMore,
    nextBeforeUid,
    unified,
    everywhere,
    search,
    searching,
    folder,
    query,
    accountId,
    applyPage
  ]);

  // Live updates: the IDLE snapshot replaces the top of the inbox list.
  const appliedSnapshot = useRef(0);
  // Time the last change made here (move, delete, read state) was sent. A snapshot taken before it
  // may still show the old state: applied, a deleted message came back and deleting it again failed.
  // Recorded before the request goes out, because the server may apply the change before the
  // response arrives and a snapshot started in between must not count as newer.
  const localChangeAt = useRef(0);
  const onLocalChangeRef = useRef(onLocalChange);
  onLocalChangeRef.current = onLocalChange;
  useEffect(() => {
    if (!accountReady || !inboxSnapshot) return;
    if (!snapshotApplies(inboxSnapshot.checkedAt, appliedSnapshot.current, localChangeAt.current)) return;
    if (inboxSnapshot.unseen !== null)
      setFolders(old => old.map(f => (f.path.toUpperCase() === 'INBOX' ? { ...f, unseen: inboxSnapshot.unseen } : f)));
    if (folder.toUpperCase() !== 'INBOX' || query.trim() || busy || actionBusy) return;
    appliedSnapshot.current = inboxSnapshot.checkedAt;
    dispatchList({ type: 'snapshotApplied', messages: inboxSnapshot.messages });
  }, [inboxSnapshot, folder, accountReady, query, busy, actionBusy]);

  useEffect(() => {
    if (!unified) return;
    const timer = window.setInterval(() => {
      void getJson<{ messages: Message[] }>('/api/unified')
        .then(d => dispatchList({ type: 'replaced', messages: d.messages }))
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
    // Not while another action runs: a message being deleted must not get a late "mark read".
    if (!detail || !prefs.markReadOnOpen || !writeEnabled || isDraftFolder || detail.stale || actionBusy) return;
    const item = messages.find(m => m.uid === detail.uid);
    if (!item?.unread) return;
    const timer = window.setTimeout(() => {
      localChangeAt.current = Date.now();
      postAction(`/api/messages/${detail.uid}/action`, { folder, action: 'markRead' }, accountId)
        .then(() => {
          onLocalChangeRef.current?.();
          dispatchList({ type: 'patched', uids: [detail.uid], patch: { unread: false } });
          setFolders(old =>
            old.map(f =>
              f.path === folder && typeof f.unseen === 'number' ? { ...f, unseen: Math.max(0, f.unseen - 1) } : f
            )
          );
        })
        .catch(e => {
          // Gone on the server (stale row): no error, a fresh snapshot removes the row.
          if (isMissingMessage(e)) onLocalChangeRef.current?.();
          /* otherwise it stays unread */
        });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [detail, prefs.markReadOnOpen, writeEnabled, isDraftFolder, folder, accountId, messages, actionBusy]);

  const chooseFolder = (path: string) => {
    search.reset();
    ++requestSeq.current;
    dispatchList({ type: 'checkedSet', uids: [] });
    setReaderOpen(false);
    selectUid(null, false);
    setFolder(path);
    setBundle(null);
    setScreener(false);
    setMobileSidebar(false);
    void loadMessages(path);
  };

  const refresh = () => {
    if (searching) search.run(query);
    else void loadMessages(folder);
    void loadFolders(false);
  };

  // ------------------------------------------------------------------ snooze & follow-up
  const snoozed = useSnoozedEntries(inSnoozeFolder, accountId, messages.length);
  const [followupsDue, setFollowupsDue] = useFollowupsDue();

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
      dispatchList({ type: 'removed', uids });
      dispatchList({ type: 'unchecked', uids });
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
      dispatchList({ type: 'error', error: (e as Error).message });
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
    detail && inSnoozeFolder
      ? snoozed.find(
          s =>
            (s.messageId && s.messageId === detail.messageId) ||
            (!s.messageId && s.snoozeUid && s.snoozeUid === String(detail.uid))
        )
      : undefined;

  const nextAfterRemoval = (uids: number[]) => nextAfter(visibleMessages, uids);

  /** One request for one or many messages (server: batch-action, max 500). */
  // The screening hook moves blocked mail with the current runAction.
  useEffect(() => {
    runActionRef.current = (action, uids) => runAction(action, uids);
  });
  async function runAction(action: ReaderAction, uids: number[], destination?: string, source = folder) {
    if (!writeEnabled || !uids.length || actionBusy) return false;
    if ((action === 'archive' && !archiveExists) || (action === 'trash' && isTrash && source === folder)) return false;
    setActionBusy(true);
    dispatchList({ type: 'error', error: '' });
    localChangeAt.current = Date.now();
    try {
      type Undo = { folder: string; action: ReaderAction; uids: string[]; destination?: string } | null;
      const data = await postAction<{ destination: string | null; count: number; undo?: Undo }>(
        '/api/messages/batch-action',
        { folder: source, action, uids, ...(action === 'move' ? { destination } : {}) },
        accountId
      );
      onLocalChangeRef.current?.();
      if (!removesMessages(action)) {
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
        dispatchList({ type: 'patched', uids, patch });
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
                  dispatchList({ type: 'flagsRestored', before })
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
        dispatchList({ type: 'removed', uids });
        const destination = folders.find(f => f.path === data.destination);
        // A trash folder the server just created is not in the list yet.
        if (!destination && data.destination) void loadFolders(false);
        const target = destination ? folderLabel(destination) : action === 'trash' ? t('Papierkorb') : data.destination;
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
      dispatchList({ type: 'unchecked', uids });
      return true;
    } catch (e) {
      if (isMissingMessage(e)) {
        // None of the messages exist on the server any more: the rows were stale (e.g. from an
        // outdated snapshot). Not an error for the user; drop them and fetch the current state.
        onLocalChangeRef.current?.();
        if (source === folder) {
          if (removesMessages(action)) {
            if (selectedUid !== null && uids.includes(selectedUid)) selectUid(nextAfterRemoval(uids), false);
            dispatchList({ type: 'removed', uids });
            dispatchList({ type: 'unchecked', uids });
          } else if (!searching) void loadMessages(folder);
          void loadFolders(false);
        }
        return false;
      }
      dispatchList({ type: 'error', error: (e as Error).message });
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
      dispatchList({ type: 'error', error: (e as Error).message });
    } finally {
      setActionBusy(false);
    }
  };

  // ------------------------------------------------------------------ folder management
  const validateFolderName = (v: string) =>
    // eslint-disable-next-line no-control-regex
    /^[^/\\.%*\u0000-\u001f]{1,80}$/.test(v.trim()) ? null : t('1–80 Zeichen, ohne / \\ . % *');
  async function manageFolder(op: 'create' | 'rename' | 'delete', target?: Folder) {
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
  async function switchAccount(id: string) {
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
  }
  async function dropOn(e: DragEvent, f: Folder) {
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
      source: { folder: detail.folder, uid: detail.uid },
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
    dispatchList({ type: 'error', error: '' });
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
      dispatchList({ type: 'error', error: (err as Error).message });
    } finally {
      setComposeBusy(false);
    }
  };

  const beginEditDraft = async () => {
    if (!detail?.draftId || !detail.uidValidity || !isDraftFolder || selectedUid === null || composeBusy) return;
    setComposeBusy(true);
    dispatchList({ type: 'error', error: '' });
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
        ...(detail.aiGenerated ? { aiGenerated: detail.aiGenerated } : {}),
        draftUid: selectedUid,
        draftUidValidity: detail.uidValidity,
        attachments: files.filter(f => !detail.attachments.find(a => a.filename === f.name)?.embedded),
        scheduledFor: detail.scheduledFor
      });
    } catch (err) {
      dispatchList({ type: 'error', error: (err as Error).message });
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
        dispatchList({ type: 'checkedSet', uids: [] });
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
        // MessageList scrolls the selected row into view (it is virtualized).
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
    else if (c.type === 'attachments') chooseFolder(ATTACHMENTS);
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

  const listTitle = followupView
    ? t('Nachfassen')
    : attachmentView
      ? t('Anhänge')
      : unified
        ? t('Alle Posteingänge')
        : everywhere
          ? t('Suche in allen Ordnern')
          : folderLabel(currentFolder);
  const countLabel = listCountLabel(t, {
    searchBusy,
    searching,
    searchTotal,
    checkedCount,
    unified,
    filter,
    visibleCount: visibleMessages.length,
    loadedCount: messages.length,
    folderTotal: currentFolder?.total,
    folderUnseen: currentFolder?.unseen
  });

  return (
    <div className="app-shell">
      <div className="workspace" style={{ '--mail-list-width': `${listWidth}px` } as CSSProperties}>
        <MailSidebar
          accountId={accountId}
          accounts={accounts}
          account={account}
          status={status}
          folder={folder}
          folders={folders}
          ordered={ordered}
          followupsDue={followupsDue}
          writeEnabled={writeEnabled}
          actionBusy={actionBusy}
          mobileOpen={mobileSidebar}
          folderLabel={folderLabel}
          acceptsDrop={acceptsDrop}
          onChooseFolder={chooseFolder}
          onNewMessage={beginNewMessage}
          onDrop={(e, f) => void dropOn(e, f)}
          onManageFolder={(op, target) => void manageFolder(op, target)}
          onMarkLoadedRead={path => {
            if (path === folder)
              void runAction(
                'markRead',
                messages.filter(m => m.unread).map(m => m.uid)
              );
            else chooseFolder(path);
          }}
          onSwitchAccount={id => void switchAccount(id)}
          onOpenAccounts={() => onOpenSettings('accounts')}
          onCloseMobile={() => setMobileSidebar(false)}
        />
        <main className="message-column">
          <div className="message-header">
            <div className="message-title-row">
              <button
                className="mobile-menu icon-button"
                aria-label={t('Ordner')}
                aria-expanded={mobileSidebar}
                onClick={() => setMobileSidebar(!mobileSidebar)}
              >
                <Menu size={20} />
              </button>
              <h1>
                {listTitle}
                <span className="period">.</span>
              </h1>
              <button
                className="compose-fab"
                onClick={beginNewMessage}
                disabled={!status?.configured}
                aria-label={t('Neue Nachricht')}
                title={t('Neue Nachricht')}
              >
                <PenSquare size={22} aria-hidden="true" />
              </button>
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
            {!unified && !panelView && (
              <SearchBar
                query={query}
                scope={scope}
                disabled={!accountReady}
                folderName={folderLabel(currentFolder)}
                onChange={value => search.run(value)}
                onClear={search.clear}
                onToggleScope={search.toggleScope}
              />
            )}
            {!panelView && (
              <ListToolbar
                selectable={!unified && !everywhere}
                allChecked={allChecked}
                visibleCount={visibleUids.length}
                checkedCount={checkedCount}
                countLabel={countLabel}
                filter={filter}
                writeEnabled={writeEnabled}
                actionBusy={actionBusy}
                archiveExists={archiveExists}
                isJunk={isJunk}
                isTrash={isTrash}
                isDraftFolder={isDraftFolder}
                onCheckAll={checked => dispatchList({ type: 'checkedSet', uids: checked ? visibleUids : [] })}
                onClearChecked={() => dispatchList({ type: 'checkedSet', uids: [] })}
                onFilter={value => dispatchList({ type: 'filter', filter: value })}
                onBulkAction={mutateSelected}
                onBulkSnooze={date =>
                  void snooze(
                    checkedUids.filter(uid => visibleUids.includes(uid)),
                    date
                  )
                }
              />
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
              <button aria-label={t('Meldung schließen')} onClick={() => dispatchList({ type: 'error', error: '' })}>
                <X size={15} />
              </button>
            </div>
          )}
          {attachmentView ? (
            <AttachmentOverview
              accountId={accountId}
              folders={folders}
              initialFolder={lastRealFolder.current}
              folderLabel={folderLabel}
              onOpenMessage={(path, uid) => {
                pendingOpen.current = uid;
                chooseFolder(path);
              }}
            />
          ) : followupView ? (
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
                  window.setTimeout(() => search.run(subject.slice(0, 80)), 50);
                }
              }}
            />
          ) : (
            <>
              {screeningOn && !screener && !bundle && (
                <ScreenerRow messages={screened} onOpen={() => setScreener(true)} />
              )}
              {screener && screeningOn ? (
                <ScreenerView
                  messages={screened}
                  writeEnabled={writeEnabled}
                  busy={actionBusy}
                  onBack={() => setScreener(false)}
                  onDecide={(email, decision, uids) => void decideSender(email, decision, uids)}
                  onOpenMessage={openMessage}
                />
              ) : null}
              {bundling &&
                !screener &&
                (bundle ? (
                  <BundleHeader
                    bundle={bundle}
                    messages={bundled}
                    accountId={accountId}
                    folder={folder}
                    writeEnabled={writeEnabled}
                    onBack={() => setBundle(null)}
                    onAction={(action, uids) => void runAction(action, uids)}
                  />
                ) : (
                  <BundleRows messages={bundled} onOpen={setBundle} />
                ))}
              {!(screener && screeningOn) && (
                <MessageList
                  messages={visibleMessages}
                  selectedUid={selectedUid}
                  selectedKey={selectedKey}
                  checkedUids={checkedUids}
                  busy={busy || searchBusy}
                  bulkBusy={actionBusy}
                  conversations={prefs.conversations && !everywhere}
                  unified={unified || everywhere}
                  hasMore={hasMore && (!query.trim() || searching || everywhere)}
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
                  onToggleChecked={(uid, checked) => dispatchList({ type: 'checked', uid, checked })}
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
            </>
          )}
          <ColumnResizer width={listWidth} onResize={setListWidth} onCommit={width => setPrefs({ listWidth: width })} />
        </main>
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
