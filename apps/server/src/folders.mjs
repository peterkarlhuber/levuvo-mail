// Folder management: create, rename and delete (empty folders only).
// Special folders (Inbox, Sent, Drafts, Trash, Junk, Archive) are protected.
import { validFolder } from './message-utils.mjs';
import { selectableFolders } from './mail-actions.mjs';

const err = (message, statusCode = 400, code = 'invalid_request') =>
  Object.assign(new Error(message), { statusCode, code });
const PROTECTED = new Set(['\\Inbox', '\\Sent', '\\Drafts', '\\Trash', '\\Junk', '\\Archive', '\\All', '\\Flagged']);

export function validFolderName(name) {
  return (
    typeof name === 'string' &&
    name.trim().length >= 1 &&
    name.trim().length <= 80 &&
    !/[\x00-\x1f\x7f/\\%*.]/.test(name) &&
    !/^\s|\s$/.test(name)
  );
}

/** Hierarchy delimiter as reported by LIST (falls back to the INBOX children). */
export function delimiterOf(folders) {
  const withDelimiter = folders.find(f => f.delimiter === '.' || f.delimiter === '/');
  if (withDelimiter) return withDelimiter.delimiter;
  if (folders.some(f => /^INBOX\./i.test(f.path))) return '.';
  if (folders.some(f => /^INBOX\//i.test(f.path))) return '/';
  return null;
}

/** Folders on servers with an "INBOX." namespace (Dovecot/Hetzner) must live below INBOX. */
export function newFolderPath(folders, name, parentPath = '') {
  if (!validFolderName(name))
    throw err('Ordnername: 1–80 Zeichen, ohne / \\ . % * und Steuerzeichen.', 400, 'folder_name_invalid');
  const delimiter = delimiterOf(folders);
  if (!delimiter) throw err('Ordner-Trennzeichen ist unbekannt.', 409, 'delimiter_unknown');
  let parent = parentPath;
  if (parent && !folders.some(f => f.path === parent))
    throw err('Übergeordneter Ordner nicht gefunden.', 404, 'parent_missing');
  const inboxNamespace =
    folders.some(f => f.path.toUpperCase().startsWith(`INBOX${delimiter}`)) &&
    !folders.some(f => !f.path.toUpperCase().startsWith('INBOX'));
  if (!parent && inboxNamespace) parent = folders.find(f => f.path.toUpperCase() === 'INBOX')?.path || 'INBOX';
  const path = parent ? `${parent}${delimiter}${name.trim()}` : name.trim();
  if (folders.some(f => f.path.toLowerCase() === path.toLowerCase()))
    throw err('Ein Ordner mit diesem Namen existiert bereits.', 409, 'folder_exists');
  if (!validFolder(path)) throw err('Ordnerpfad ist zu lang.', 400, 'folder_name_invalid');
  return path;
}

function guard(folder) {
  if (!folder) throw err('Ordner nicht gefunden.', 404, 'folder_missing');
  if (PROTECTED.has(folder.specialUse) || folder.path.toUpperCase() === 'INBOX') {
    throw err('Systemordner können nicht umbenannt oder gelöscht werden.', 409, 'folder_protected');
  }
}

export async function manageFolder(client, input) {
  const all = await client.list();
  const folders = selectableFolders(all);
  if (input.op === 'create') {
    const path = newFolderPath(all, input.name, input.parent || '');
    const result = await client.mailboxCreate(path);
    if (!result) throw err('Ordner konnte nicht angelegt werden.', 409, 'create_rejected');
    await client.mailboxSubscribe?.(path).catch(() => {});
    return { ok: true, op: 'create', path };
  }
  const folder = folders.find(f => f.path === input.path);
  guard(folder);
  if (input.op === 'rename') {
    if (!validFolderName(input.name))
      throw err('Ordnername: 1–80 Zeichen, ohne / \\ . % * und Steuerzeichen.', 400, 'folder_name_invalid');
    const delimiter = folder.delimiter || delimiterOf(all) || '.';
    const cut = folder.path.lastIndexOf(delimiter);
    const target = cut > 0 ? `${folder.path.slice(0, cut)}${delimiter}${input.name.trim()}` : input.name.trim();
    if (all.some(f => f.path.toLowerCase() === target.toLowerCase()))
      throw err('Ein Ordner mit diesem Namen existiert bereits.', 409, 'folder_exists');
    const result = await client.mailboxRename(folder.path, target);
    if (!result) throw err('Ordner konnte nicht umbenannt werden.', 409, 'rename_rejected');
    return { ok: true, op: 'rename', path: target };
  }
  if (input.op === 'delete') {
    // Only empty folders without subfolders: deleting a folder deletes its mail permanently.
    if (
      all.some(
        f => f.path !== folder.path && f.path.startsWith(`${folder.path}${folder.delimiter || delimiterOf(all) || '.'}`)
      )
    ) {
      throw err('Der Ordner enthält Unterordner. Bitte zuerst diese löschen.', 409, 'folder_has_children');
    }
    const status = await client.status(folder.path, { messages: true });
    if (Number(status?.messages) !== 0)
      throw err(
        'Nur leere Ordner können gelöscht werden. Bitte Nachrichten vorher verschieben.',
        409,
        'folder_not_empty'
      );
    const result = await client.mailboxDelete(folder.path);
    if (!result) throw err('Ordner konnte nicht gelöscht werden.', 409, 'delete_rejected');
    return { ok: true, op: 'delete', path: folder.path };
  }
  throw err('Unbekannte Ordneraktion.');
}

export function validateFolderInput(body) {
  if (!body || typeof body !== 'object' || !['create', 'rename', 'delete'].includes(body.op))
    throw err('Unbekannte Ordneraktion.');
  if (body.op !== 'create' && !validFolder(body.path)) throw err('Ungültiger Ordner.');
  if (body.op === 'create' && body.parent && !validFolder(body.parent)) throw err('Ungültiger Ordner.');
  return {
    op: body.op,
    path: body.path,
    parent: body.parent || '',
    name: typeof body.name === 'string' ? body.name : ''
  };
}
