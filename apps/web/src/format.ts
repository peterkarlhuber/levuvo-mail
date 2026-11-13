import type { Address, Detail, Message } from './types';

let LOCALE = 'de-AT';
/** Set by the app shell whenever the UI language changes. */
export function setFormatLocale(locale: string) {
  LOCALE = locale;
}
export const currentLocale = () => LOCALE;

export function dateLabel(date: string | null, now = new Date()) {
  if (!date) return '–';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '–';
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }).format(d);
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(
    LOCALE,
    sameYear ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: '2-digit', year: 'numeric' }
  ).format(d);
}

export function fullDateLabel(date: string | null) {
  if (!date) return '–';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(x => x[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export function prettySize(bytes: number) {
  if (!Number.isFinite(bytes)) return '–';
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export function addressLabel(items: Address[]) {
  return items.map(a => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ');
}

/** "Re: AW: Fwd: Angebot" → "angebot" for conversation grouping. */
export function normalizeSubject(subject: string) {
  return subject
    .replace(/^(\s*(re|aw|wg|fw|fwd|antw|sv|vs)(\[\d+\])?\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();
}

export type ConversationRow = { key: string; head: Message; members: Message[]; unread: number };

/**
 * Groups the loaded messages into conversations: replies are linked to their parent via
 * Message-ID/In-Reply-To (union-find); only messages without such a link fall back to the
 * normalized subject. Order follows the list (newest first).
 */
export function groupConversations(messages: Message[]): ConversationRow[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const add = (id: string) => {
    if (!parent.has(id)) parent.set(id, id);
  };
  for (const m of messages) {
    if (!m.messageId) continue;
    add(m.messageId);
    if (m.inReplyTo) {
      add(m.inReplyTo);
      parent.set(find(m.messageId), find(m.inReplyTo));
    }
  }
  const linkedRoots = new Map<string, number>();
  for (const m of messages)
    if (m.messageId) linkedRoots.set(find(m.messageId), (linkedRoots.get(find(m.messageId)) || 0) + 1);
  const keyOf = (m: Message) => {
    const root = m.messageId ? find(m.messageId) : null;
    if (root && ((linkedRoots.get(root) || 0) > 1 || m.inReplyTo)) return `ref:${root}`;
    const subject = normalizeSubject(m.subject);
    return subject ? `subject:${subject}` : `uid:${m.accountId || ''}:${m.uid}`;
  };
  const map = new Map<string, ConversationRow>();
  for (const message of messages) {
    const key = keyOf(message);
    const row = map.get(key);
    if (row) {
      row.members.push(message);
      if (message.unread) row.unread++;
    } else {
      map.set(key, { key, head: message, members: [message], unread: message.unread ? 1 : 0 });
    }
  }
  return [...map.values()];
}

/** Plain text from HTML for quoting (used when a mail has no text part). */
export function htmlToPlainText(html: string) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style,script,head,title').forEach(node => node.remove());
  doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  doc.querySelectorAll('p,div,tr,li,h1,h2,h3,h4,blockquote').forEach(node => node.append('\n'));
  return (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export function bodyText(detail: Detail) {
  return detail.text || htmlToPlainText(detail.html);
}

export function quote(text: string, limit = 20_000) {
  return text
    .slice(0, limit)
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

const sameAddress = (a: string, b: string | null | undefined) =>
  Boolean(b) && a.toLowerCase() === String(b).toLowerCase();

/** Recipients for "Allen antworten": sender (or Reply-To) plus all others, without yourself. */
export function replyAllRecipients(detail: Detail, own: string | null) {
  const primary = detail.replyTo.length ? detail.replyTo : detail.from;
  const seen = new Set<string>();
  const pick = (list: Address[]) =>
    list
      .map(a => a.email)
      .filter(email => {
        const key = email.toLowerCase();
        if (!email || sameAddress(email, own) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  const fromSelf = primary.some(a => sameAddress(a.email, own));
  const to = pick(fromSelf ? detail.to : [...primary, ...detail.to]);
  const cc = pick(detail.cc);
  return { to, cc };
}

export function replyRecipient(detail: Detail, own: string | null) {
  if (detail.replyTo[0]?.email) return detail.replyTo[0].email;
  if (sameAddress(detail.from[0]?.email || '', own)) return detail.to[0]?.email || '';
  return detail.from[0]?.email || '';
}
