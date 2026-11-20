// Composer contents for answering, forwarding and editing the message in the reader.
// Split out of MailInstance (ARC-LEV-005).
import DOMPurify from 'dompurify';
import { accountPath } from '../api';
import { isRemoteSrc } from '../trackers';
import { plainToHtml, SIGNATURE_SEPARATOR } from '../editor';
import { bodyText, fullDateLabel, replyAllRecipients, replyRecipient } from '../format';
import type { ComposeInitial } from '../Composer';
import type { Detail, Identity } from '../types';

type Translate = (text: string, vars?: Record<string, string | number>) => string;

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The original message as quotable HTML (sanitized, without remote images). */
export function quotedHtml(d: Detail) {
  if (d.html) {
    const doc = DOMPurify.sanitize(d.html, {
      FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'iframe', 'svg', 'math', 'picture', 'source'],
      FORBID_ATTR: ['style', 'class', 'id', 'srcset', 'background'],
      RETURN_DOM_FRAGMENT: true
    });
    // The editor would load remote images of the quoted mail right away (tracking pixels, the
    // sender learns the reply is being written) although the reader blocks them: they become a
    // short text placeholder instead (SEC-LEV-006).
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      if (!isRemoteSrc(img.getAttribute('src'))) continue;
      const alt = (img.getAttribute('alt') || '').trim();
      img.replaceWith(alt ? document.createTextNode(`[${alt.slice(0, 200)}]`) : document.createTextNode(''));
    }
    const box = document.createElement('div');
    box.append(doc);
    const clean = box.innerHTML;
    return clean.length > 200_000 ? plainToHtml(bodyText(d).slice(0, 50_000)) : clean;
  }
  return plainToHtml(d.text.slice(0, 50_000));
}

/** The identity a reply is sent from: the address the message went to, else the first one. */
export function defaultIdentity(identities: Identity[], d?: Detail | null) {
  if (d) {
    const addresses = [...d.to, ...d.cc, ...(d.bcc || [])].map(a => a.email.toLowerCase());
    const match = identities.find(i => addresses.includes(i.email.toLowerCase()));
    if (match) return match;
  }
  return identities[0];
}

export const signatureFor = (identity?: Identity) =>
  identity?.signatureHtml ? `${SIGNATURE_SEPARATOR}${identity.signatureHtml}` : '';

export function newMessage(identity?: Identity): ComposeInitial {
  return {
    mode: 'new',
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    html: `<p></p>${signatureFor(identity)}`,
    from: identity?.email
  };
}

export function replyTo(
  t: Translate,
  detail: Detail,
  o: { identity?: Identity; own: string | null; all: boolean }
): ComposeInitial {
  const recipients = o.all
    ? replyAllRecipients(detail, o.own)
    : { to: [replyRecipient(detail, o.own)], cc: [] as string[] };
  const attribution = t('Am {date} schrieb {name}:', {
    date: fullDateLabel(detail.date),
    name: detail.from[0]?.name || detail.from[0]?.email || ''
  });
  return {
    mode: o.all ? 'replyAll' : 'reply',
    from: o.identity?.email,
    to: recipients.to.join(', '),
    cc: recipients.cc.join(', '),
    bcc: '',
    subject: /^(re|aw):/i.test(detail.subject) ? detail.subject : `Re: ${detail.subject}`,
    html: `<p></p>${signatureFor(o.identity)}<p>${escapeHtml(attribution)}</p><blockquote>${quotedHtml(detail)}</blockquote>`,
    inReplyTo: detail.messageId || undefined,
    references: detail.messageId || undefined,
    source: { folder: detail.folder, uid: detail.uid },
    security: detail.crypto?.encrypted ? { method: detail.crypto.method, sign: true, encrypt: true } : undefined
  };
}

/** `files` is null when the attachments were too large to take over. */
export function forwardOf(
  t: Translate,
  detail: Detail,
  o: { identity?: Identity; files: File[] | null }
): ComposeInitial {
  const from = detail.from[0]?.name ? `${detail.from[0].name} <${detail.from[0].email}>` : detail.from[0]?.email || '';
  const head = `<p>---------- ${escapeHtml(t('Weitergeleitete Nachricht'))} ----------<br>${escapeHtml(t('Von'))}: ${escapeHtml(from)}<br>${escapeHtml(t('Datum'))}: ${escapeHtml(fullDateLabel(detail.date))}<br>${escapeHtml(t('Betreff'))}: ${escapeHtml(detail.subject)}<br>${escapeHtml(t('An'))}: ${escapeHtml(detail.to.map(a => a.email).join(', '))}</p>`;
  return {
    mode: 'forward',
    from: o.identity?.email,
    to: '',
    cc: '',
    bcc: '',
    subject: /^(fwd|wg):/i.test(detail.subject) ? detail.subject : `Fwd: ${detail.subject}`,
    html: `<p></p>${signatureFor(o.identity)}${head}${quotedHtml(detail)}`,
    attachments: o.files || [],
    notice:
      o.files === null
        ? t('Die Anhänge sind zusammen größer als 8 MB bzw. mehr als acht und wurden nicht übernommen.')
        : undefined
  };
}

/** A saved draft opened again in the composer (`files`: all attachments of the draft). */
export function draftEdit(detail: Detail, o: { identities: Identity[]; uid: number; files: File[] }): ComposeInitial {
  const fromAddress = detail.from[0]?.email?.toLowerCase();
  return {
    mode: 'new',
    from: o.identities.find(i => i.email.toLowerCase() === fromAddress)?.email,
    to: detail.to.map(a => a.email).join(', '),
    cc: detail.cc.map(a => a.email).join(', '),
    bcc: (detail.bcc || []).map(a => a.email).join(', '),
    subject: detail.subject === '(Ohne Betreff)' ? '' : detail.subject,
    ...(detail.html
      ? { html: DOMPurify.sanitize(detail.html), format: 'html' as const }
      : { text: detail.text, format: 'text' as const }),
    draftId: detail.draftId || undefined,
    ...(detail.aiGenerated ? { aiGenerated: detail.aiGenerated } : {}),
    draftUid: o.uid,
    draftUidValidity: detail.uidValidity,
    attachments: o.files.filter(f => !detail.attachments.find(a => a.filename === f.name)?.embedded),
    scheduledFor: detail.scheduledFor
  };
}

/** Downloads the attachments to take into the composer; null when there are more than eight or over 8 MB. */
export async function fetchAttachments(
  t: Translate,
  d: Detail,
  o: { folder: string; accountId: string; onlyFiles: boolean }
) {
  const list = d.attachments.filter(a => !o.onlyFiles || !a.embedded);
  if (list.length > 8 || list.reduce((n, a) => n + a.size, 0) > 8_000_000) return null;
  const files: File[] = [];
  for (const att of list) {
    const response = await fetch(
      accountPath(
        `/api/messages/${d.uid}/attachments/${att.index}?folder=${encodeURIComponent(o.folder)}`,
        o.accountId
      ),
      { cache: 'no-store' }
    );
    if (!response.ok) throw new Error(t('Anhang {name} konnte nicht geladen werden.', { name: att.filename }));
    const blob = await response.blob();
    if (blob.size !== att.size) throw new Error(t('Anhang {name} ist unvollständig.', { name: att.filename }));
    files.push(new File([blob], att.filename, { type: att.mimeType || 'application/octet-stream' }));
  }
  return files;
}
