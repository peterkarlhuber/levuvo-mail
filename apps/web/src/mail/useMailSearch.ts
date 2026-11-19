// Mail search: debounced server search in the open folder (IMAP) or everywhere (local, encrypted
// index), with paging of the index results. Split out of MailInstance (ARC-LEV-005).
import { useEffect, useReducer, useRef, type Dispatch, type MutableRefObject } from 'react';
import { getJson } from '../api';
import type { Message, MessagePage } from '../types';
import { PAGE, type ListAction, type ListState } from './list-state';
import {
  initialSearchState,
  MIN_SEARCH,
  SEARCH_DELAY,
  searchMode,
  searchPath,
  searchReducer,
  type SearchScope
} from './search-state';

type LocalPage = { messages: Message[]; total: number; nextCursor?: string | null };

type Options = {
  accountId: string;
  folder: string;
  accountReady: boolean;
  unified: boolean;
  list: ListState;
  dispatchList: Dispatch<ListAction>;
  /** Counter of list requests; a response for an older counter value is dropped. */
  requestSeq: MutableRefObject<number>;
  /** Loads the folder list again (search cleared). */
  reload: (path: string) => void;
};

export function useMailSearch(o: Options) {
  const [state, dispatch] = useReducer(searchReducer, initialSearchState);
  const timer = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const { everywhere, searching } = searchMode(state.query, state.scope, o.unified);

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    abort.current?.abort();
    abort.current = null;
  };
  useEffect(() => () => stop(), []);

  /** Sets the query and searches after a short typing pause. */
  const run = (value: string, nextScope: SearchScope = state.scope) => {
    o.dispatchList({ type: 'checkedSet', uids: [] });
    dispatch({ type: 'typed', query: value });
    ++o.requestSeq.current;
    o.dispatchList({ type: 'busy', value: false });
    stop();
    if (!o.accountReady || o.unified) return;
    const term = value.trim();
    if (term.length < MIN_SEARCH) {
      o.dispatchList({ type: 'error', error: '' });
      if (state.total !== null) {
        dispatch({ type: 'totalCleared' });
        o.reload(o.folder);
      }
      return;
    }
    dispatch({ type: 'pending' });
    const seq = o.requestSeq.current;
    const { folder, accountId } = o;
    timer.current = window.setTimeout(async () => {
      timer.current = null;
      const controller = new AbortController();
      abort.current = controller;
      const path = searchPath({ scope: nextScope, term, folder, limit: PAGE });
      try {
        if (nextScope === 'everywhere') {
          const data = await getJson<LocalPage>(path, undefined, controller.signal);
          if (controller.signal.aborted || seq !== o.requestSeq.current) return;
          dispatch({ type: 'results', total: data.total });
          o.dispatchList({
            type: 'localPageLoaded',
            messages: data.messages,
            hasMore: Boolean(data.nextCursor),
            append: false
          });
          dispatch({ type: 'cursor', cursor: data.nextCursor ?? null });
        } else {
          const data = await getJson<MessagePage>(path, accountId, controller.signal);
          if (controller.signal.aborted || seq !== o.requestSeq.current) return;
          dispatch({ type: 'results', total: data.total });
          o.dispatchList({ type: 'pageLoaded', page: data, append: false, now: Date.now() });
        }
      } catch (err) {
        if (!controller.signal.aborted && seq === o.requestSeq.current)
          o.dispatchList({ type: 'error', error: (err as Error).message });
      } finally {
        if (seq === o.requestSeq.current) dispatch({ type: 'settled' });
      }
    }, SEARCH_DELAY);
  };

  /** Next page of the index search ("everywhere"). */
  const loadMoreLocal = async () => {
    if (!o.list.hasMore || o.list.loadingMore || state.cursor === null) return;
    o.dispatchList({ type: 'loadingMore', value: true });
    const seq = o.requestSeq.current;
    try {
      const data = await getJson<LocalPage>(
        searchPath(
          { scope: 'everywhere', term: state.query.trim(), folder: o.folder, limit: PAGE },
          { cursor: state.cursor }
        )
      );
      if (seq !== o.requestSeq.current) return;
      o.dispatchList({
        type: 'localPageLoaded',
        messages: data.messages,
        hasMore: Boolean(data.nextCursor),
        append: true
      });
      dispatch({ type: 'cursor', cursor: data.nextCursor ?? null });
    } catch (e) {
      o.dispatchList({ type: 'error', error: (e as Error).message });
    } finally {
      o.dispatchList({ type: 'loadingMore', value: false });
    }
  };

  const clear = () => {
    dispatch({ type: 'scope', scope: 'folder' });
    run('', 'folder');
  };

  const toggleScope = () => {
    const next: SearchScope = state.scope === 'everywhere' ? 'folder' : 'everywhere';
    dispatch({ type: 'scope', scope: next });
    if (state.query.trim().length >= MIN_SEARCH) run(state.query, next);
    else if (next === 'folder' && state.total !== null) o.reload(o.folder);
  };

  /** Folder change: drops a running search and starts empty in the new folder. */
  const reset = () => {
    stop();
    dispatch({ type: 'reset' });
  };

  return { ...state, everywhere, searching, run, clear, toggleScope, reset, stop, loadMoreLocal };
}
