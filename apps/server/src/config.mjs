export const DEFAULT_PAGE_SIZE = 40;
export const MAX_PAGE_SIZE = 100;

export function mailConfig(env = process.env) {
  const user = (env.IMAP_USER || '').trim();
  const password = env.IMAP_PASSWORD || '';
  return {
    host: (env.IMAP_HOST || 'mail.your-server.de').trim(),
    port: Number(env.IMAP_PORT || 993),
    user,
    password,
    configured: Boolean(user && password)
  };
}

export function folderName(folder) {
  if (folder.specialUse === '\\Inbox' || folder.path?.toUpperCase() === 'INBOX') return 'Posteingang';
  if (folder.specialUse === '\\Sent') return 'Gesendet';
  if (folder.specialUse === '\\Drafts') return 'Entwürfe';
  if (folder.specialUse === '\\Trash') return 'Papierkorb';
  if (folder.specialUse === '\\Junk') return 'Spam';
  if (folder.specialUse === '\\Archive') return 'Archiv';
  return folder.name || folder.path || 'Ordner';
}

export function cleanLimit(raw, fallback = DEFAULT_PAGE_SIZE) {
  const n = Number(raw ?? fallback);
  return Number.isInteger(n) ? Math.min(MAX_PAGE_SIZE, Math.max(1, n)) : fallback;
}

/** Optional paging cursor: only UIDs strictly below this value are returned. */
export function cleanBeforeUid(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw);
  if (!/^[1-9]\d{0,9}$/.test(text)) {
    throw Object.assign(new Error('Ungültiger Seitenzeiger.'), { statusCode: 400 });
  }
  const n = Number(text);
  if (n > 4294967296) throw Object.assign(new Error('Ungültiger Seitenzeiger.'), { statusCode: 400 });
  return n;
}

const addressList = items =>
  (Array.isArray(items) ? items : [])
    .filter(a => typeof a?.address === 'string')
    .map(a => ({ name: String(a.name || ''), email: a.address }));

export function toMessageInfo(message) {
  const envelope = message.envelope || {};
  const from = (envelope.from || [])[0] || {};
  const flags = message.flags;
  return {
    uid: message.uid,
    seq: message.seq,
    fromName: from.name || from.address || 'Unbekannt',
    fromEmail: from.address || '',
    to: addressList(envelope.to),
    subject: envelope.subject || '(Ohne Betreff)',
    date: message.internalDate?.toISOString?.() || envelope.date?.toISOString?.() || null,
    unread: !flags?.has('\\Seen'),
    flagged: Boolean(flags?.has('\\Flagged')),
    answered: Boolean(flags?.has('\\Answered')),
    messageId: typeof envelope.messageId === 'string' ? envelope.messageId : null,
    inReplyTo: typeof envelope.inReplyTo === 'string' ? envelope.inReplyTo : null
  };
}
