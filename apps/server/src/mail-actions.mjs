import { validFolder, validUid } from './message-utils.mjs';

const err = (message, statusCode = 400, code = 'invalid_request') =>
  Object.assign(new Error(message), { statusCode, code });

export function imapWriteEnabled(env = process.env) {
  return env.ENABLE_IMAP_WRITE === 'true';
}

export function selectableFolders(folders) {
  return folders.filter(f => typeof f?.path === 'string' && validFolder(f.path) && !f.flags?.has('\\Noselect'));
}

export function findSpecialFolder(folders, specialUse) {
  const valid = selectableFolders(folders);
  const direct = valid.find(f => f.specialUse === specialUse);
  if (direct) return direct;
  const names =
    specialUse === '\\Trash'
      ? /^(trash|deleted messages|deleted items|papierkorb|gelöscht|gelöschte elemente)$/i
      : specialUse === '\\Archive'
        ? /^(archive|archives|archiv)$/i
        : specialUse === '\\Junk'
          ? /^(junk|spam|junk e-mail|junk-e-mail|junk email|bulk mail)$/i
          : null;
  if (!names) return null;
  return valid.find(f => names.test(f.name || '') || names.test(f.path.split(/[./]/).at(-1) || '')) || null;
}

export function archiveCreationPath(folders) {
  const valid = selectableFolders(folders);
  const existing = findSpecialFolder(valid, '\\Archive');
  if (existing) return null;
  const inbox = valid.find(f => f.path.toUpperCase() === 'INBOX');
  if (!inbox) throw err('Posteingang fehlt.', 409, 'inbox_missing');
  // Only create where we can derive the hierarchy delimiter from LIST or known children.
  const suffix = valid.find(f => f.path.startsWith(`${inbox.path}.`))
    ? '.'
    : valid.find(f => f.path.startsWith(`${inbox.path}/`))
      ? '/'
      : inbox.delimiter === '.' || inbox.delimiter === '/'
        ? inbox.delimiter
        : null;
  if (!suffix)
    throw err(
      'Ordner-Trennzeichen ist unbekannt. Archiv bitte im Webmail deines Anbieters anlegen.',
      409,
      'delimiter_unknown'
    );
  const path = `${inbox.path}${suffix}Archive`;
  if (valid.some(f => f.path.toLowerCase() === path.toLowerCase()))
    throw err('Archivordner existiert bereits.', 409, 'archive_exists');
  return path;
}

export const ACTIONS = ['markRead', 'markUnread', 'flag', 'unflag', 'archive', 'trash', 'move', 'spam', 'notSpam'];
const MOVING = new Set(['archive', 'trash', 'move', 'spam', 'notSpam']);
const MAX_BATCH = 500;

export function validateActionInput(uid, body) {
  if (!validUid(String(uid))) throw err('Ungültige Nachrichten-ID.');
  return validateBatchInput({
    ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}),
    uids: [String(uid)],
    _single: true,
    _valid: Boolean(body && typeof body === 'object' && !Array.isArray(body))
  });
}

/** Several UIDs of one folder in ONE IMAP command (UID set), e.g. drag and drop or bulk actions. */
export function validateBatchInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || body._valid === false || !validFolder(body.folder))
    throw err('Ungültiger Quellordner.');
  const action = body.action;
  if (!ACTIONS.includes(action)) throw err('Unbekannte Aktion.');
  if (action === 'move' && !validFolder(body.destination)) throw err('Ungültiger Zielordner.');
  if (!Array.isArray(body.uids) || body.uids.length < 1 || body.uids.length > MAX_BATCH)
    throw err(`Zwischen 1 und ${MAX_BATCH} Nachrichten auswählen.`);
  const uids = [...new Set(body.uids.map(String))];
  if (!uids.every(validUid)) throw err('Ungültige Nachrichten-ID.');
  return {
    uid: body._single ? uids[0] : undefined,
    uids,
    folder: body.folder,
    action,
    destination: action === 'move' ? body.destination : null
  };
}

function targetFor(action, folders, destination) {
  switch (action) {
    case 'trash':
      return findSpecialFolder(folders, '\\Trash');
    case 'archive':
      return findSpecialFolder(folders, '\\Archive');
    case 'spam':
      return findSpecialFolder(folders, '\\Junk');
    case 'notSpam':
      return folders.find(f => f.path.toUpperCase() === 'INBOX') || null;
    case 'move':
      return folders.find(f => f.path === destination) || null;
    default:
      return null;
  }
}
const MISSING = {
  archive: ['Archivordner fehlt. Bitte zuerst Archiv anlegen.', 'archive_missing'],
  trash: ['Papierkorb-Ordner konnte nicht gefunden werden.', 'destination_missing'],
  spam: ['Spam-Ordner konnte nicht gefunden werden.', 'junk_missing'],
  notSpam: ['Posteingang fehlt.', 'inbox_missing'],
  move: ['Zielordner nicht gefunden.', 'destination_missing']
};

export async function performMessageAction(client, input) {
  const uids = input.uids || [String(input.uid)];
  const folders = selectableFolders(await client.list());
  const source = folders.find(f => f.path === input.folder);
  if (!source) throw err('Quellordner nicht gefunden.', 404, 'source_not_found');
  const target = targetFor(input.action, folders, input.destination);
  if (MOVING.has(input.action)) {
    if (!target) throw err(MISSING[input.action][0], 409, MISSING[input.action][1]);
    if (target.path === source.path) throw err('Quelle und Ziel sind identisch.', 409, 'same_folder');
  }
  const lock = await client.getMailboxLock(source.path); // SELECT: modifications require write access.
  try {
    if (client.mailbox?.readOnly) throw err('Der Ordner ist auf dem Server schreibgeschützt.', 403, 'mailbox_readonly');
    // Only UIDs that still exist are touched; never a sequence range.
    const existing = [];
    for await (const m of client.fetch(uids.join(','), { uid: true }, { uid: true })) {
      if (uids.includes(String(m.uid))) existing.push(String(m.uid));
    }
    if (!existing.length) throw err('Nachricht nicht mehr vorhanden. Bitte aktualisieren.', 404, 'message_missing');
    const set = existing.join(',');
    const flagOps = {
      markRead: ['add', '\\Seen'],
      markUnread: ['remove', '\\Seen'],
      flag: ['add', '\\Flagged'],
      unflag: ['remove', '\\Flagged']
    };
    if (flagOps[input.action]) {
      const [op, flag] = flagOps[input.action];
      const ok =
        op === 'add'
          ? await client.messageFlagsAdd(set, [flag], { uid: true })
          : await client.messageFlagsRemove(set, [flag], { uid: true });
      if (!ok) throw err('Markierung konnte nicht geändert werden.', 409, 'flags_rejected');
      const inverse = { markRead: 'markUnread', markUnread: 'markRead', flag: 'unflag', unflag: 'flag' }[input.action];
      return {
        ok: true,
        action: input.action,
        source: source.path,
        destination: null,
        count: existing.length,
        undo: { folder: source.path, action: inverse, uids: existing }
      };
    }
    // No COPY + \Deleted + EXPUNGE fallback: it could remove unrelated messages marked \Deleted.
    if (!client.capabilities?.has?.('MOVE'))
      throw err(
        'Der IMAP-Server unterstützt kein sicheres MOVE. Bitte im Webmail verschieben.',
        409,
        'move_unsupported'
      );
    if (input.action === 'spam') await client.messageFlagsAdd(set, ['$Junk'], { uid: true }).catch(() => {});
    if (input.action === 'notSpam') await client.messageFlagsRemove(set, ['$Junk'], { uid: true }).catch(() => {});
    const moved = await client.messageMove(set, target.path, { uid: true });
    if (!moved) throw err('Verschieben wurde vom Server abgelehnt.', 409, 'move_rejected');
    // With UIDPLUS the server reports the new UIDs (COPYUID) – that makes the move reversible.
    const map = moved.uidMap instanceof Map ? moved.uidMap : null;
    const newUids = map
      ? existing
          .map(uid => map.get(Number(uid)) ?? map.get(uid))
          .filter(Boolean)
          .map(String)
      : [];
    const undo =
      newUids.length === existing.length
        ? {
            folder: target.path,
            action: input.action === 'spam' && source.path.toUpperCase() === 'INBOX' ? 'notSpam' : 'move',
            destination: source.path,
            uids: newUids
          }
        : null;
    return {
      ok: true,
      action: input.action,
      source: source.path,
      destination: target.path,
      count: existing.length,
      undo
    };
  } finally {
    lock.release();
  }
}

export async function createArchiveFolder(client) {
  const folders = await client.list();
  const exists = findSpecialFolder(folders, '\\Archive');
  if (exists) return { created: false, folder: exists.path };
  const path = archiveCreationPath(folders);
  const created = await client.mailboxCreate(path);
  if (!created) throw err('Archivordner konnte nicht angelegt werden.', 409, 'create_rejected');
  return { created: true, folder: path };
}
