// Sync mails for shared spaces: sending over the member's own SMTP account, receiving from the
// INBOX (and the junk folder, in case a filter got there first), and moving them into a hidden
// folder so they never clutter the normal mailbox.
//
// A sync mail is an ordinary mail with a short explanation in the body and one attachment that
// holds the encrypted, signed envelope. Mail providers see sender, recipient, date and size,
// never content. The hidden folder is also read on its own, so a second device of the same
// person still sees mails another device already moved there.
import PostalMime from 'postal-mime';
import { composeRawEmail, submitEmail } from '../send-service.mjs';
import { childFolderPath, findSpecialFolder, selectableFolders } from '../mail-actions.mjs';
import { fetchUidOne } from '../imap-fetch.mjs';

export const SPACES_HEADER = 'X-Levuvo-Space';
export const SPACES_FOLDER = 'Levuvo Spaces';
export const ENVELOPE_TYPE = 'application/vnd.levuvo.space+json';
const RETENTION_DAYS = 30;
const MAX_PER_RUN = 200;

const quote = s => `„${s}“`;

/** Subject and readable body of a sync mail. Content never appears here. */
export function mailText(kind, { spaceName = '', inviterName = '' } = {}) {
  if (kind === 'invite') {
    const who = inviterName || 'Jemand';
    return {
      subject: `Einladung in den Raum ${quote(spaceName)} · Invitation to ${quote(spaceName)}`,
      text: [
        `${who} lädt dich in den gemeinsamen Raum ${quote(spaceName)} in Levuvo Mail ein.`,
        '',
        'Öffne Levuvo Mail und wähle unter „Räume“ bei der Einladung „Beitreten“. Inhalte des Raums',
        'werden Ende-zu-Ende-verschlüsselt über eure Postfächer abgeglichen.',
        '',
        `${who} invites you to the shared space ${quote(spaceName)} in Levuvo Mail.`,
        'Open Levuvo Mail and choose “Join” on the invitation under “Spaces”.',
        '',
        'Ohne Levuvo Mail kannst du diese Nachricht ignorieren. · Without Levuvo Mail you can ignore this message.'
      ].join('\n')
    };
  }
  return {
    subject: 'Levuvo-Raum: verschlüsselter Abgleich · encrypted space sync',
    text: [
      'Diese Nachricht gleicht einen gemeinsamen Raum in Levuvo Mail ab. Der Inhalt ist',
      'Ende-zu-Ende-verschlüsselt. Levuvo Mail verschiebt sie automatisch in einen eigenen Ordner.',
      '',
      'This message syncs a shared space in Levuvo Mail. Its content is end-to-end encrypted.',
      'Levuvo Mail moves it into a separate folder automatically.'
    ].join('\n')
  };
}

const SYNC_SUBJECTS = [mailText('sync').subject, 'Einladung in den Raum'];
/**
 * Whether a fresh inbox snapshot (from the IMAP IDLE watcher) may hold new sync mails since the
 * previous one: a new message with a sync subject, or new UIDs that are already gone again (moved
 * by another device of the same person). Normal mail never triggers an extra IMAP login.
 */
export function snapshotHasSyncMail(prev, next) {
  if (!prev || !next || prev.uidValidity !== next.uidValidity) return false;
  const from = Number(prev.highestUid) || 0;
  const to = Number(next.highestUid) || 0;
  if (to <= from) return false;
  const fresh = (next.messages || []).filter(m => m.uid > from && m.uid <= to);
  if (fresh.some(m => SYNC_SUBJECTS.some(subject => String(m.subject || '').includes(subject)))) return true;
  // The snapshot lists only the newest messages; when all new UIDs fit into it but some are
  // missing, they vanished again.
  const listed = (next.messages || []).length;
  const covers = listed > 0 && Math.min(...next.messages.map(m => m.uid)) <= from + 1;
  return covers && fresh.length < to - from;
}

export async function buildSyncMail({ from, fromName = '', to, kind, spaceName, inviterName, envelope }) {
  const { subject, text } = mailText(kind, { spaceName, inviterName });
  const headers = { [SPACES_HEADER]: `v1; ${kind === 'invite' ? 'invite' : 'sync'}` };
  // Sync mails are machine-generated: no out-of-office replies, no read receipts.
  if (kind !== 'invite')
    Object.assign(headers, {
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
      Precedence: 'bulk'
    });
  return composeRawEmail(
    { name: fromName, address: from },
    {
      to: [to],
      cc: [],
      subject,
      text,
      attachments: [{ filename: 'levuvo-space.json', content: JSON.stringify(envelope), contentType: ENVELOPE_TYPE }]
    },
    { headers }
  );
}

// Largest raw sync mail: a 30 MiB envelope in base64 plus headers. Bigger ones are not even
// downloaded (anyone can send a mail with the X-Levuvo-Space header).
export const MAX_SYNC_MAIL_BYTES = 42 * 1024 * 1024;
async function fetchSyncSource(client, uid) {
  const meta = await fetchUidOne(client, uid, { size: true });
  if (!meta || !Number.isSafeInteger(meta.size) || meta.size > MAX_SYNC_MAIL_BYTES) return null;
  return fetchUidOne(client, uid, { source: true });
}

/** Highest sync format this version understands (header "X-Levuvo-Space: v<N>" and envelope.v). */
export const SYNC_VERSION = 1;
const versionOf = value => {
  const m = /^\s*v(\d{1,4})\b/i.exec(String(value || ''));
  return m ? Number(m[1]) : 0;
};

/**
 * Reads the envelope from a raw sync mail, or null if it is none. A mail in a newer format than
 * this version understands comes back as { future: <version> } and is kept for after an update.
 */
export async function parseSyncMail(source) {
  if (!source || source.length > MAX_SYNC_MAIL_BYTES) return null;
  const parsed = await PostalMime.parse(source, { attachmentEncoding: 'arraybuffer' });
  const header = (parsed.headers || []).find(h => h.key === SPACES_HEADER.toLowerCase());
  if (!header) return null;
  const headerVersion = versionOf(header.value);
  if (headerVersion > SYNC_VERSION) return { future: headerVersion, from: parsed.from?.address || '' };
  const part = (parsed.attachments || []).find(a => a.mimeType === ENVELOPE_TYPE || a.filename === 'levuvo-space.json');
  if (!part) return null;
  const raw = Buffer.from(part.content);
  if (raw.length > 30 * 1024 * 1024) return null;
  let envelope;
  try {
    envelope = JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
  if (Number.isInteger(envelope?.v) && envelope.v > SYNC_VERSION)
    return { future: envelope.v, from: parsed.from?.address || '' };
  return { envelope, from: parsed.from?.address || '' };
}

// Inbox mails whose envelope could not be handled (e.g. the local copy could not be saved) are
// tried again later with growing pauses, at most this many times.
const MAX_INBOX_TRIES = 8;
// A mail in the hidden folder that fails this often is passed over, so it cannot block the rest.
const MAX_HIDDEN_TRIES = 10;
const MAX_FUTURE = 500;
const retryDelay = n => Math.min(6 * 3600_000, 60_000 * 2 ** n);

/** Per-account receive state, kept in the spaces index. Old cursors ({ uidValidity, last }) still work. */
function cursorState(saved) {
  const c = saved && typeof saved === 'object' ? saved : {};
  const uids = v => (Array.isArray(v) ? v.filter(u => Number.isSafeInteger(u) && u > 0) : []);
  return {
    uidValidity: String(c.uidValidity || ''),
    last: Number(c.last || 0),
    // UIDs this device itself moved into the hidden folder (from the MOVE answer): already handled.
    done: uids(c.done),
    // Hidden-folder mails in a newer format, read again once an update understands them.
    future: Array.isArray(c.future) ? c.future.filter(f => Number.isSafeInteger(f?.uid) && f.v > 0) : [],
    stuck: c.stuck && typeof c.stuck === 'object' ? { ...c.stuck } : {},
    // INBOX and junk: the highest UID looked at, and mails to try again later.
    folders: Object.fromEntries(
      Object.entries(c.folders && typeof c.folders === 'object' ? c.folders : {}).map(([path, f]) => [
        path,
        {
          uidValidity: String(f?.uidValidity || ''),
          seen: Number(f?.seen || 0),
          retry: f?.retry && typeof f.retry === 'object' ? { ...f.retry } : {}
        }
      ])
    )
  };
}

/**
 * @param {object} ctx  app context (accounts, withImap, smtpConfigFor, smtpFactory, fromFor)
 * @param {{ index():object, saveIndex(i?:object):Promise<void> }} store
 */
export function createMailTransport(ctx, store) {
  const accountOf = id => {
    const account = ctx.accounts().find(a => a.id === id);
    if (!account) throw Object.assign(new Error('Konto nicht gefunden.'), { code: 'spaces_account_missing' });
    return account;
  };
  return {
    async send({ accountId, from, to, kind, spaceName, inviterName, envelope }) {
      const account = accountOf(accountId);
      if (!account.smtp?.configured && account.smtp?.configured !== undefined)
        throw Object.assign(new Error('Versand ist für dieses Konto nicht eingerichtet.'), { code: 'smtp_missing' });
      const sender = ctx.fromFor(account, from);
      const raw = await buildSyncMail({
        from: sender.address,
        fromName: sender.name,
        to,
        kind,
        spaceName,
        inviterName,
        envelope
      });
      const smtp = await ctx.smtpConfigFor(account);
      // Never copied into "Sent": these mails are transport, not correspondence.
      const result = await submitEmail(smtp, { to: [to], cc: [], bcc: [] }, raw, ctx.smtpFactory(smtp));
      if (result.rejected?.length) throw Object.assign(new Error('Empfänger abgelehnt.'), { code: 'smtp_rejected' });
    },

    /** Fetches new sync mails of one account and hands each envelope to `handle`. */
    async receive(accountId, handle) {
      const account = accountOf(accountId);
      let processed = 0;
      await ctx.withImap(async client => {
        const folders = await client.list();
        let hidden = selectableFolders(folders).find(f => f.path.split(/[./]/).at(-1) === SPACES_FOLDER);
        if (!hidden) {
          const path = childFolderPath(folders, SPACES_FOLDER, SPACES_FOLDER);
          await client.mailboxCreate(path).catch(() => null);
          hidden = { path };
        }
        const handleSafe = async mail => {
          try {
            await handle(mail.envelope, mail.from);
            processed++;
            return true;
          } catch {
            return false;
          }
        };
        const read = async uid => {
          const message = await fetchSyncSource(client, uid);
          return message?.source ? parseSyncMail(message.source).catch(() => null) : null;
        };
        const before = JSON.stringify(store.index().cursors?.[accountId] || null);
        const cursor = cursorState(store.index().cursors?.[accountId]);

        // 1. The hidden folder: mails another device of this person already moved there. The
        //    cursor only ever moves over mails that were actually read (or that this device moved
        //    there itself, known from the MOVE answer), never to UIDNEXT: a second device may
        //    have moved other mails in meanwhile.
        let lock = await client.getMailboxLock(hidden.path);
        try {
          const validity = String(client.mailbox?.uidValidity || '');
          if (cursor.uidValidity !== validity)
            Object.assign(cursor, { uidValidity: validity, last: 0, done: [], future: [], stuck: {} });
          // Mails in a newer format, kept from before an update: read them again now if possible.
          const future = [];
          for (const f of cursor.future) {
            if (f.v > SYNC_VERSION) {
              future.push(f);
              continue;
            }
            const mail = await read(f.uid);
            if (mail?.future) future.push({ uid: f.uid, v: mail.future });
            else if (mail?.envelope && !(await handleSafe(mail))) future.push(f);
          }
          cursor.future = future;
          const done = new Set(cursor.done);
          const uids = ((await client.search({ uid: `${cursor.last + 1}:*` }, { uid: true })) || [])
            .filter(u => u > cursor.last)
            .sort((a, b) => a - b);
          for (const uid of uids.slice(0, MAX_PER_RUN)) {
            if (!done.has(uid)) {
              const mail = await read(uid);
              if (mail?.future) {
                cursor.future = [...cursor.future, { uid, v: mail.future }].slice(-MAX_FUTURE);
              } else if (mail && !(await handleSafe(mail))) {
                // Try again next run, unless this one mail keeps failing.
                const tries = (cursor.stuck[uid] || 0) + 1;
                if (tries < MAX_HIDDEN_TRIES) {
                  cursor.stuck = { [uid]: tries };
                  break;
                }
              }
            }
            cursor.last = uid;
            cursor.stuck = {};
          }
          cursor.done = [...done].filter(u => u > cursor.last);
          // Transport mails are not kept forever: everything is in each member's local copy.
          // Mails waiting for an update stay.
          const keep = new Set(cursor.future.map(f => f.uid));
          const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000);
          const old = ((await client.search({ before: cutoff }, { uid: true })) || []).filter(
            u => u <= cursor.last && !keep.has(u)
          );
          if (old.length) await client.messageDelete(old.join(','), { uid: true });
        } finally {
          lock.release();
        }

        // 2. New sync mails in the inbox (or junk): process, then move into the hidden folder.
        //    Only UIDs above the last one looked at are searched; mails that are no sync mail
        //    (or too large) are never downloaded twice.
        const sources = [
          folders.find(f => f.path.toUpperCase() === 'INBOX'),
          findSpecialFolder(folders, '\\Junk')
        ].filter(Boolean);
        for (const folder of sources) {
          lock = await client.getMailboxLock(folder.path);
          try {
            const validity = String(client.mailbox?.uidValidity || '');
            let state = cursor.folders[folder.path];
            if (!state || state.uidValidity !== validity) state = { uidValidity: validity, seen: 0, retry: {} };
            const now = Date.now();
            const due = Object.entries(state.retry)
              .filter(([, r]) => !(r?.at > now))
              .map(([uid]) => Number(uid));
            const fresh = (
              (await client.search(
                { uid: `${state.seen + 1}:*`, header: { [SPACES_HEADER.toLowerCase()]: true } },
                { uid: true }
              )) || []
            )
              .filter(u => u > state.seen)
              .sort((a, b) => a - b)
              .slice(0, MAX_PER_RUN);
            const retry = { ...state.retry };
            let seen = state.seen;
            const moved = [];
            const handled = new Set();
            for (const uid of [...due, ...fresh]) {
              if (uid > seen) seen = uid;
              const mail = await read(uid);
              delete retry[uid];
              // Mails that only pretend to be sync mails (or are too large) stay where they are.
              if (!mail) continue;
              if (mail.future) {
                // A newer format: out of the inbox; the hidden folder keeps it for after an update.
                moved.push(uid);
                continue;
              }
              if (await handleSafe(mail)) {
                moved.push(uid);
                handled.add(uid);
                continue;
              }
              const tries = (state.retry[uid]?.n || 0) + 1;
              if (tries < MAX_INBOX_TRIES) retry[uid] = { n: tries, at: now + retryDelay(tries) };
            }
            if (moved.length) {
              const result = await client.messageMove(moved.join(','), hidden.path, { uid: true });
              const sameFolder = String(result?.uidValidity || '') === cursor.uidValidity;
              for (const [from, to] of result?.uidMap instanceof Map ? result.uidMap : [])
                if (sameFolder && handled.has(from) && to > cursor.last) cursor.done.push(to);
            }
            cursor.folders[folder.path] = { uidValidity: validity, seen, retry };
          } finally {
            lock.release();
          }
        }
        cursor.done = cursor.done.slice(-5000);
        // Saved only when something changed, and merged into the index as it is now: invitations
        // accepted or declined while this run was busy are not brought back.
        if (JSON.stringify(cursor) !== before)
          await store.updateIndex(index => ({ ...index, cursors: { ...(index.cursors || {}), [accountId]: cursor } }));
      }, account);
      return processed;
    }
  };
}
