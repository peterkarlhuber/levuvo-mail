// State of the reader (selected message, open/closed on narrow screens, loaded detail) as a
// reducer, plus the keyboard navigation through the list. Split out of MailInstance
// (ARC-LEV-005); unit-tested in apps/web/test without a browser.
import type { Detail, Message } from '../types.ts';

export type ReaderState = {
  /** Selected message of this account's folder list. */
  selectedUid: number | null;
  /** `accountId:uid` of the selection; identifies rows of lists across accounts. */
  selectedKey: string | null;
  open: boolean;
  detail: Detail | null;
  busy: boolean;
  error: string;
  /** Bumped by "retry" to load the detail again. */
  reload: number;
};

export const initialReaderState: ReaderState = {
  selectedUid: null,
  selectedKey: null,
  open: false,
  detail: null,
  busy: false,
  error: '',
  reload: 0
};

export type ReaderAction =
  /** Selects a message of this account (null clears); `open` shows the reader on narrow screens. */
  | { type: 'selected'; uid: number | null; accountId: string; open: boolean }
  /** Moves only the cross-account selection (all inboxes, search everywhere). */
  | { type: 'keySelected'; key: string }
  | { type: 'closed' }
  | { type: 'detailRequested' }
  | { type: 'detailCleared' }
  | { type: 'detailLoaded'; detail: Detail }
  | { type: 'detailFailed'; error: string }
  | { type: 'detailSettled' }
  | { type: 'detailPatched'; patch: Partial<Detail> }
  | { type: 'retried' };

export function readerReducer(state: ReaderState, action: ReaderAction): ReaderState {
  switch (action.type) {
    case 'selected':
      return {
        ...state,
        selectedUid: action.uid,
        selectedKey: action.uid === null ? null : `${action.accountId}:${action.uid}`,
        open: action.uid !== null && action.open ? true : state.open
      };
    case 'keySelected':
      return { ...state, selectedKey: action.key };
    case 'closed':
      return { ...state, open: false };
    case 'detailRequested':
      return { ...state, detail: null, error: '', busy: true };
    case 'detailCleared':
      return { ...state, detail: null, error: '', busy: false };
    case 'detailLoaded':
      return { ...state, detail: action.detail };
    case 'detailFailed':
      return { ...state, error: action.error };
    case 'detailSettled':
      return { ...state, busy: false };
    case 'detailPatched':
      return state.detail ? { ...state, detail: { ...state.detail, ...action.patch } } : state;
    case 'retried':
      return { ...state, reload: state.reload + 1 };
  }
}

/**
 * The row `j` (down) or `k` (up) moves to. `keyed` lists (several accounts) compare by
 * `accountId:uid`, folder lists by UID. Without a selection, `j` starts at the top.
 */
export function stepSelection(
  visible: Message[],
  dir: 'down' | 'up',
  o: { keyed: boolean; selectedKey: string | null; selectedUid: number | null }
) {
  if (!visible.length) return null;
  const index = visible.findIndex(m =>
    o.keyed ? `${m.accountId}:${m.uid}` === o.selectedKey : m.uid === o.selectedUid
  );
  const next = dir === 'down' ? Math.min(visible.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
  return visible[next];
}
