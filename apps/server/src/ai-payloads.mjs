// Pure mappers between mail/calendar data and what the AI and agents see or create. No routes, no
// protocol, no I/O: both the AI routes and the MCP server use them (ARC-LEV-001 removed the import
// cycle routes-ai.mjs <-> mcp-server.mjs that sharing them used to need).
import { htmlToText } from './html-mail.mjs';

const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const emails = v =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
    .map(x => String(x).trim())
    .filter(Boolean)
    .slice(0, 30);

const addr = list =>
  (list || [])
    .map(a => (a.name ? `${a.name} <${a.email}>` : a.email))
    .filter(Boolean)
    .join(', ');

export function messageForAi(detail) {
  const text = detail.text?.trim() ? detail.text : htmlToText(detail.html || '');
  return {
    from: addr(detail.from),
    to: addr([...(detail.to || []), ...(detail.cc || [])]),
    date: detail.date || '',
    subject: detail.subject || '',
    text: String(text || '').slice(0, 20_000),
    attachments: (detail.attachments || []).map(a => a.filename).slice(0, 20)
  };
}

const AUTH_VALUES = /^(pass|fail|softfail|neutral|none|temperror|permerror|policy)$/;
/**
 * Facts from Levuvo's own checks, given to the model as trusted: only ratings and fixed codes.
 * Everything the sender controls (link texts and targets, Reply-To, file names, domains) goes into
 * the untrusted part with the message (securityDetails), never next to the instructions.
 */
export function securityFacts(detail) {
  const sec = detail.security || {};
  const facts = { client_rating: ['ok', 'info', 'warning', 'danger'].includes(sec.level) ? sec.level : 'unknown' };
  for (const [k, v] of Object.entries(sec.auth || {}))
    if (['spf', 'dkim', 'dmarc'].includes(k) && AUTH_VALUES.test(String(v))) facts[k] = v;
  for (const c of (sec.checks || []).slice(0, 12))
    if (/^[a-z_]{1,40}$/.test(String(c.code)) && ['ok', 'info', 'warning', 'danger'].includes(c.level))
      facts[`check_${c.code}`] = c.level;
  facts.attachments = (detail.attachments || []).length;
  return facts;
}
/** The sender-controlled details of the checks, for the untrusted part of the prompt. */
export function securityDetails(detail) {
  const lines = [];
  for (const c of (detail.security?.checks || []).slice(0, 12)) {
    const extra = ['shown', 'actual', 'replyTo', 'filename', 'domain']
      .map(k => c[k])
      .filter(Boolean)
      .map(v => String(v).slice(0, 300))
      .join(' → ');
    if (extra) lines.push(`${String(c.code).slice(0, 40)}: ${extra}`);
  }
  const files = (detail.attachments || []).map(a => String(a.filename || '').slice(0, 200)).slice(0, 10);
  if (files.length) lines.push(`attachments: ${files.join(', ')}`);
  return lines.join('\n');
}

/**
 * Lasting label for what an agent created (AIS-LEV-008, AI Act Art. 50): stays with the event or
 * contact after the agent log has been cleared. `null` for what the user applied themselves.
 */
export function agentOrigin(agent) {
  const name = String(agent?.name || '')
    .replace(/[^\p{L}\p{N} ._@+-]/gu, '')
    .trim()
    .slice(0, 60);
  return name ? `KI-erstellt / AI-generated (Levuvo Mail, Agent: ${name})` : 'KI-erstellt / AI-generated (Levuvo Mail)';
}
const withOrigin = (text, origin, max) => {
  if (!origin) return text;
  const note = `\n\n— ${origin}`;
  return `${text.slice(0, Math.max(0, max - note.length))}${note}`.replace(/^\n\n/, '');
};

/** @param {{origin?: string|null}} [o] origin: label of an agent that created it (agentOrigin). */
export function eventPayload(a, { origin = null } = {}) {
  const allDay = a.allDay === true;
  const cut = v => str(v, 40).slice(0, allDay ? 10 : 16);
  return {
    accountId: str(a.calendarAccountId, 100) || 'local',
    calendarUrl: str(a.calendarUrl, 1000) || null,
    event: {
      summary: str(a.summary, 300),
      start: cut(a.start),
      end: cut(a.end),
      allDay,
      tzid: allDay ? undefined : str(a.timeZone, 64) || 'Europe/Vienna',
      location: str(a.location, 300),
      description: withOrigin(str(a.description, 4000), origin, 4000),
      attendees: emails(a.attendees).map(email => ({ email })),
      alarms: [15]
    }
  };
}
export function contactPayload(a, { origin = null } = {}) {
  return {
    addressBookUrl: 'local-contacts:',
    contact: {
      name: str(a.name, 250),
      emails: emails(a.emails).map(value => ({ value, type: 'work' })),
      phones: (Array.isArray(a.phones) ? a.phones : []).slice(0, 5).map(v => ({ value: str(v, 40), type: 'work' })),
      organization: str(a.organization, 200),
      title: str(a.title, 120),
      address: str(a.address, 400),
      note: withOrigin(str(a.note, 2000), origin, 2000)
    }
  };
}

/** Free slots within working hours, not overlapping any (non all-day) event. */
export function freeSlots(events, { from, to, minutes, dayStart = 8, dayEnd = 18, max = 20 }) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 62 * 86400_000) return [];
  const busy = events
    .filter(e => !e.allDay)
    .map(e => [Date.parse(e.start), Date.parse(e.end)])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e))
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  const step = 15 * 60_000;
  const len = minutes * 60_000;
  for (let t = Math.ceil(from / step) * step; t + len <= to && out.length < max; t += step) {
    const d = new Date(t);
    const h = d.getHours() + d.getMinutes() / 60;
    const day = d.getDay();
    if (day === 0 || day === 6 || h < dayStart || h + minutes / 60 > dayEnd) continue;
    if (busy.some(([s, e]) => s < t + len && e > t)) continue;
    out.push({ start: new Date(t).toISOString(), end: new Date(t + len).toISOString() });
    t += len - step;
  }
  return out;
}
