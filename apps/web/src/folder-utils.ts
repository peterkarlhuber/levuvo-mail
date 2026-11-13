// Folder ordering for the sidebar (unit-tested in apps/web/test).
import type { Folder } from './types';

const SPECIAL_ORDER = ['\\Inbox', '\\Drafts', '\\Sent', '\\Archive', '\\Junk', '\\Trash'];
export const isInbox = (f: Folder) => f.specialUse === '\\Inbox' || f.path.toUpperCase() === 'INBOX';
export const special = (f: Folder) => (isInbox(f) ? '\\Inbox' : f.specialUse || '');

/** Special folders first, then the rest as a tree (children right after their parent). */
export function orderFolders(folders: Folder[]) {
  const top = SPECIAL_ORDER.flatMap(s => folders.filter(f => special(f) === s));
  const rest = folders
    .filter(f => !top.includes(f))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  return [...top, ...rest].map(f => {
    const parts = f.delimiter ? f.path.split(f.delimiter) : [f.path];
    // "INBOX.Projekte" is shown as a top-level folder on servers with an INBOX namespace.
    const depth = Math.max(0, parts.length - 1 - (parts.length > 1 && parts[0].toUpperCase() === 'INBOX' ? 1 : 0));
    return { folder: f, depth: special(f) ? 0 : depth };
  });
}

/** The server folder that holds snoozed messages ("Zurückgestellt"). */
export const isSnoozeFolder = (f: Folder) =>
  ['Zurückgestellt', 'Snoozed'].includes(f.path.split(f.delimiter || '/').at(-1) || '');
