// State of the message list (loaded messages, paging, selection checkboxes, filter chip) as a
// reducer, plus the pure helpers the list view derives from it. Split out of MailInstance
// (ARC-LEV-005); unit-tested in apps/web/test without a browser.
import type { Bundle, Message, MessagePage } from '../types.ts';
import { mergeSnapshot } from '../mail-sync.ts';

export const PAGE = 40;
export type Filter = 'all' | 'unread' | 'flagged' | 'attachments';

export type ListState = {
  messages: Message[];
  hasMore: boolean;
  /** Paging cursor of folder lists and folder searches (IMAP UID); null when there is none. */
  nextBeforeUid: number | null;
  loadingMore: boolean;
  /** Time of the cached data shown while the server is unreachable, else null. */
  stale: number | null;
  busy: boolean;
  error: string;
  checkedUids: number[];
  filter: Filter;
};

export const initialListState: ListState = {
  messages: [],
  hasMore: false,
  nextBeforeUid: null,
  loadingMore: false,
  stale: null,
  busy: false,
  error: '',
  checkedUids: [],
  filter: 'all'
};

export type ListAction =
  /** A folder (or view) starts loading: checkboxes cleared, error hidden. */
  | { type: 'loadStarted' }
  | { type: 'loadFinished' }
  /** A view without its own message list (follow-ups, attachment overview). */
  | { type: 'emptied' }
  /** A complete list without paging (all inboxes). */
  | { type: 'replaced'; messages: Message[] }
  | { type: 'loadFailed'; error: string }
  /** A page of a folder list or folder search (`now` stamps stale data without a cache time). */
  | { type: 'pageLoaded'; page: MessagePage; append: boolean; now: number }
  /** A page of the local index search; paging continues through the search's own cursor. */
  | { type: 'localPageLoaded'; messages: Message[]; hasMore: boolean; append: boolean }
  | { type: 'loadingMore'; value: boolean }
  /** The live inbox snapshot replaces the top of the list. */
  | { type: 'snapshotApplied'; messages: Message[] }
  | { type: 'patched'; uids: number[]; patch: Partial<Message> }
  /** Restores per-message flags (undo of a bulk flag/read change). */
  | { type: 'flagsRestored'; before: Map<number, Pick<Message, 'unread' | 'flagged'>> }
  | { type: 'removed'; uids: number[] }
  | { type: 'busy'; value: boolean }
  | { type: 'error'; error: string }
  | { type: 'checked'; uid: number; checked: boolean }
  | { type: 'checkedSet'; uids: number[] }
  | { type: 'unchecked'; uids: number[] }
  | { type: 'filter'; filter: Filter };

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, checkedUids: [], busy: true, error: '' };
    case 'loadFinished':
      return { ...state, busy: false };
    case 'emptied':
      return { ...state, messages: [], hasMore: false, nextBeforeUid: null, stale: null };
    case 'replaced':
      return { ...state, messages: action.messages, hasMore: false, nextBeforeUid: null, stale: null };
    case 'loadFailed':
      return { ...state, error: action.error, messages: [], hasMore: false };
    case 'pageLoaded': {
      const { page, append } = action;
      let messages = page.messages;
      if (append) {
        const known = new Set(state.messages.map(m => m.uid));
        messages = [...state.messages, ...page.messages.filter(m => !known.has(m.uid))];
      }
      return {
        ...state,
        messages,
        hasMore: page.hasMore,
        nextBeforeUid: page.nextBeforeUid,
        stale: page.stale ? page.cachedAt || action.now : null
      };
    }
    case 'localPageLoaded':
      return action.append
        ? { ...state, messages: [...state.messages, ...action.messages], hasMore: action.hasMore }
        : { ...state, messages: action.messages, hasMore: action.hasMore, nextBeforeUid: null };
    case 'loadingMore':
      return { ...state, loadingMore: action.value };
    case 'snapshotApplied':
      return { ...state, stale: null, messages: mergeSnapshot(state.messages, action.messages) };
    case 'patched':
      return {
        ...state,
        messages: state.messages.map(m => (action.uids.includes(m.uid) ? { ...m, ...action.patch } : m))
      };
    case 'flagsRestored':
      return {
        ...state,
        messages: state.messages.map(m => (action.before.has(m.uid) ? { ...m, ...action.before.get(m.uid) } : m))
      };
    case 'removed':
      return { ...state, messages: state.messages.filter(m => !action.uids.includes(m.uid)) };
    case 'busy':
      return { ...state, busy: action.value };
    case 'error':
      return { ...state, error: action.error };
    case 'checked':
      return {
        ...state,
        checkedUids: action.checked
          ? Array.from(new Set([...state.checkedUids, action.uid]))
          : state.checkedUids.filter(x => x !== action.uid)
      };
    case 'checkedSet':
      return { ...state, checkedUids: action.uids };
    case 'unchecked':
      return { ...state, checkedUids: state.checkedUids.filter(u => !action.uids.includes(u)) };
    case 'filter':
      return { ...state, filter: action.filter };
  }
}

export type VisibleOptions = {
  /** Messages after the bundle suggestions were applied. */
  messages: Message[];
  query: string;
  /** A server-side search is active (two or more characters, not in all inboxes). */
  searching: boolean;
  unified: boolean;
  filter: Filter;
  screening?: { screener: boolean; unknown: Set<string>; blocked: Set<string> } | null;
  /** Inbox bundles are shown; `bundle` is the open one. */
  bundling: boolean;
  bundle: Bundle | null;
};

/** The rows the list shows: local quick filter, sender screening, bundles and the filter chip. */
export function visibleList(o: VisibleOptions) {
  let list = o.messages;
  if (!o.searching && !o.unified && o.query.trim()) {
    const q = o.query.trim().toLowerCase();
    list = list.filter(m => `${m.subject} ${m.fromName} ${m.fromEmail}`.toLowerCase().includes(q));
  }
  const screening = o.screening;
  if (screening) {
    const held = (m: Message) => screening.unknown.has(m.fromEmail.toLowerCase());
    list = screening.screener
      ? list.filter(held)
      : list.filter(m => !held(m) && !screening.blocked.has(m.fromEmail.toLowerCase()));
  }
  const screener = Boolean(screening?.screener);
  if (o.bundling && !screener) list = o.bundle ? list.filter(m => m.bundle === o.bundle) : list.filter(m => !m.bundle);
  if (o.filter === 'unread') list = list.filter(m => m.unread);
  if (o.filter === 'flagged') list = list.filter(m => m.flagged);
  if (o.filter === 'attachments') list = list.filter(m => m.hasAttachments);
  return list;
}

/** The message to select after `uids` left the list: the one now at the first removed position. */
export function nextAfterRemoval(visible: Message[], uids: number[]) {
  const index = visible.findIndex(m => uids.includes(m.uid));
  const rest = visible.filter(m => !uids.includes(m.uid));
  return rest[Math.min(index, rest.length - 1)]?.uid ?? null;
}

type Translate = (text: string, vars?: Record<string, string | number>) => string;
export type CountOptions = {
  searchBusy: boolean;
  searching: boolean;
  searchTotal: number | null;
  checkedCount: number;
  unified: boolean;
  filter: Filter;
  visibleCount: number;
  loadedCount: number;
  folderTotal?: number | null;
  folderUnseen?: number | null;
};

/** The count line above the list (search progress, hits, selection, folder totals). */
export function countLabel(t: Translate, o: CountOptions) {
  if (o.searchBusy) return t('Suche läuft …');
  if (o.searching) return t('{count} Treffer', { count: o.searchTotal ?? 0 });
  if (o.checkedCount) return t('{count} ausgewählt', { count: o.checkedCount });
  if (o.unified) return t('{count} neueste', { count: o.visibleCount });
  if (o.filter !== 'all') return t('{count} von {total} geladenen', { count: o.visibleCount, total: o.loadedCount });
  const all = t('{count} Nachrichten', { count: o.folderTotal ?? o.visibleCount });
  return o.folderUnseen ? `${all} · ${t('{count} ungelesen', { count: o.folderUnseen })}` : all;
}
