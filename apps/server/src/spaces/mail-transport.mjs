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

/** Reads the envelope from a raw sync mail, or null if it is none. */
export async function parseSyncMail(source) {
  const parsed = await PostalMime.parse(source, { attachmentEncoding: 'arraybuffer' });
  const header = (parsed.headers || []).find(h => h.key === SPACES_HEADER.toLowerCase());
  if (!header) return null;
  const part = (parsed.attachments || []).find(a => a.mimeType === ENVELOPE_TYPE || a.filename === 'levuvo-space.json');
  if (!part) return null;
  const raw = Buffer.from(part.content);
  if (raw.length > 30 * 1024 * 1024) return null;
  try {
    return { envelope: JSON.parse(raw.toString('utf8')), from: parsed.from?.address || '' };
  } catch {
    return null;
  }
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
        // 1. The hidden folder: mails another device of this person already moved there.
        const index = store.index();
        const cursor = index.cursors?.[accountId] || {};
        let validity;
        let lock = await client.getMailboxLock(hidden.path);
        try {
          validity = String(client.mailbox?.uidValidity || '');
          const last = cursor.uidValidity === validity ? Number(cursor.last || 0) : 0;
          cursor.last = last;
          const uids = ((await client.search({ uid: `${last + 1}:*` }, { uid: true })) || []).filter(u => u > last);
          for (const uid of uids.slice(0, MAX_PER_RUN)) {
            const message = await fetchUidOne(client, uid, { source: true });
            const mail = message?.source ? await parseSyncMail(message.source).catch(() => null) : null;
            if (mail && !(await handleSafe(mail))) break;
            cursor.last = uid;
          }
          // Transport mails are not kept forever: everything is in each member's local copy.
          const before = new Date(Date.now() - RETENTION_DAYS * 86400_000);
          const old = ((await client.search({ before }, { uid: true })) || []).filter(
            u => u <= Number(cursor.last || 0)
          );
          if (old.length) await client.messageDelete(old.join(','), { uid: true });
        } finally {
          lock.release();
        }
        // 2. New sync mails in the inbox (or junk): process, then move into the hidden folder.
        let movedAny = false;
        const sources = [
          folders.find(f => f.path.toUpperCase() === 'INBOX'),
          findSpecialFolder(folders, '\\Junk')
        ].filter(Boolean);
        for (const folder of sources) {
          lock = await client.getMailboxLock(folder.path);
          try {
            const uids =
              (await client.search({ header: { [SPACES_HEADER.toLowerCase()]: 'v1' } }, { uid: true })) || [];
            const moved = [];
            for (const uid of uids.slice(0, MAX_PER_RUN)) {
              const message = await fetchUidOne(client, uid, { source: true });
              if (!message?.source) continue;
              const mail = await parseSyncMail(message.source).catch(() => null);
              // Mails that only pretend to be sync mails stay where they are.
              if (!mail) continue;
              if (await handleSafe(mail)) moved.push(uid);
            }
            if (moved.length) {
              await client.messageMove(moved.join(','), hidden.path, { uid: true });
              movedAny = true;
            }
          } finally {
            lock.release();
          }
        }
        // Mails moved just now were handled already: skip them on the next pass.
        if (movedAny) {
          const status = await client.status(hidden.path, { uidNext: true, uidValidity: true }).catch(() => null);
          if (status?.uidNext && String(status.uidValidity || validity) === validity)
            cursor.last = Number(status.uidNext) - 1;
        }
        index.cursors = {
          ...(index.cursors || {}),
          [accountId]: { uidValidity: validity, last: Number(cursor.last || 0) }
        };
        await store.saveIndex(index);
      }, account);
      return processed;
    }
  };
}
