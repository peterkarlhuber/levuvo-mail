// State of the mail search (query, scope, hit count, local index cursor, progress) as a reducer.
// Split out of MailInstance (ARC-LEV-005); unit-tested in apps/web/test without a browser.

export type SearchScope = 'folder' | 'everywhere';
/** Server-side search starts at this many characters; below, the loaded list is filtered locally. */
export const MIN_SEARCH = 2;
/** Typing pause before the search request. */
export const SEARCH_DELAY = 350;

export type SearchState = {
  query: string;
  scope: SearchScope;
  /** Hits of the last server or index search; null when no search result is shown. */
  total: number | null;
  /** Paging cursor of the local index search; null when there is no further page. */
  cursor: string | null;
  busy: boolean;
};

export const initialSearchState: SearchState = { query: '', scope: 'folder', total: null, cursor: null, busy: false };

export type SearchAction =
  | { type: 'typed'; query: string }
  | { type: 'pending' }
  | { type: 'settled' }
  | { type: 'results'; total: number }
  | { type: 'cursor'; cursor: string | null }
  | { type: 'totalCleared' }
  | { type: 'scope'; scope: SearchScope }
  /** Folder change: empty query, search in this folder (the index cursor is left as it was). */
  | { type: 'reset' };

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'typed':
      return { ...state, query: action.query, busy: false };
    case 'pending':
      return { ...state, busy: true };
    case 'settled':
      return { ...state, busy: false };
    case 'results':
      return { ...state, total: action.total };
    case 'cursor':
      return { ...state, cursor: action.cursor };
    case 'totalCleared':
      return { ...state, total: null };
    case 'scope':
      return { ...state, scope: action.scope };
    case 'reset':
      return { ...state, query: '', scope: 'folder', total: null, busy: false };
  }
}

/**
 * What the query means for the list: `searching` = server search in this folder or everywhere,
 * `everywhere` = local index across folders and accounts. All inboxes have no server search.
 */
export function searchMode(query: string, scope: SearchScope, unified: boolean) {
  const long = query.trim().length >= MIN_SEARCH;
  return { everywhere: scope === 'everywhere' && long, searching: long && !unified };
}

/** Request path of a search page (folder search pages by UID, index search by cursor). */
export function searchPath(
  o: { scope: SearchScope; term: string; folder: string; limit: number },
  page?: { beforeUid?: number | null; cursor?: string | null }
) {
  const q = encodeURIComponent(o.term);
  if (o.scope === 'everywhere')
    return `/api/search/local?q=${q}&limit=${o.limit}${page?.cursor ? `&cursor=${encodeURIComponent(page.cursor)}` : ''}`;
  return `/api/search?folder=${encodeURIComponent(o.folder)}&q=${q}&limit=${o.limit}${
    page?.beforeUid != null ? `&beforeUid=${page.beforeUid}` : ''
  }`;
}
