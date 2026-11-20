// Out-of-office reply for accounts signed in with Microsoft 365 / Outlook.com or Google, stored
// with the provider (Microsoft Graph mailboxSettings.automaticRepliesSetting, Gmail
// users.settings.vacation), so it also answers while Levuvo Mail is closed. These accounts have
// no ManageSieve; the provider is the only place the reply can live.
//
// Images: both providers keep the reply as HTML but give it no place for embedded images, so
// images inside the text (data: URIs, e.g. the logo from the signature) are left out and the
// UI says so; images from https addresses stay. Text, formatting and links are kept.
//
// The editor content (with the "append signature" choice) is kept on this device in an
// encrypted file, so the editor shows it again. If the reply was changed elsewhere (webmail,
// Outlook), the provider's version wins.
import { createHash } from 'node:crypto';
import { htmlToText, sanitizeOutgoingHtml } from './html-mail.mjs';
import { TIMEOUTS, withTimeout } from './http-timeout.mjs';
import { zonedToUtc } from './task-sync-cloud.mjs';
import { cleanVacationHtml, composeVacation, textToHtml, withoutEmbeddedImages } from './vacation.mjs';

export const AUTO_REPLY_ENDPOINTS = {
  graph: 'https://graph.microsoft.com/v1.0',
  gmail: 'https://gmail.googleapis.com/gmail/v1'
};
export const AUDIENCES = ['all', 'contacts', 'internal'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const fail = (message, code, statusCode = 400, extra = {}) =>
  Object.assign(new Error(message), { code, statusCode, ...extra });
const consent = account =>
  fail(
    'Für die Abwesenheitsnotiz dieses Kontos ist eine einmalige Freigabe beim Anbieter nötig.',
    'autoreply_consent_required',
    403,
    { accountId: account.id, provider: account.oauthProvider }
  );
/** Same text, whatever HTML the provider turned it into. */
const fingerprint = html =>
  createHash('sha256')
    .update(
      htmlToText(sanitizeOutgoingHtml(String(html || '')))
        .replace(/\s+/g, ' ')
        .trim()
    )
    .digest('hex');

/** Local midnight of a YYYY-MM-DD day (the app runs on the user's computer, in their zone). */
const localMidnight = day => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
const localDay = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Checks the request; `provider` decides which fields exist. */
export function validateAutoReply(input, provider) {
  const v = input && typeof input === 'object' ? input : {};
  const day = (value, message) => {
    if (!value) return '';
    if (typeof value !== 'string' || !DATE.test(value)) throw fail(message, 'autoreply_invalid');
    return value;
  };
  if (typeof v.subject === 'string' && (v.subject.length > 200 || /[\r\n\0]/.test(v.subject)))
    throw fail('Ungültiger Wert: Betreff.', 'autoreply_invalid');
  const reply = {
    enabled: v.enabled === true,
    subject: provider === 'google' ? String(v.subject || '') : '',
    bodyHtml: cleanVacationHtml(typeof v.bodyHtml === 'string' ? v.bodyHtml : ''),
    includeSignature: v.includeSignature === true,
    start: day(v.start, 'Ungültiges Startdatum.'),
    end: day(v.end, 'Ungültiges Enddatum.'),
    audience: AUDIENCES.includes(v.audience) ? v.audience : 'all'
  };
  if (reply.enabled && !reply.bodyHtml)
    throw fail('Bitte einen Text für die Abwesenheitsnotiz eingeben.', 'autoreply_invalid');
  if (reply.start && reply.end && reply.end < reply.start)
    throw fail('Das Enddatum liegt vor dem Startdatum.', 'autoreply_invalid');
  if (provider === 'microsoft' && Boolean(reply.start) !== Boolean(reply.end))
    throw fail('Für Microsoft 365 bitte Start- und Enddatum angeben oder beide leer lassen.', 'autoreply_invalid');
  return reply;
}

// ------------------------------------------------------------------ provider mapping
/** Graph automaticRepliesSetting → model fields (dates in the user's zone). */
export function fromGraph(s = {}) {
  const at = t => (t?.dateTime ? Date.parse(zonedToUtc(t.dateTime, t.timeZone || 'UTC')) : NaN);
  const scheduled = s.status === 'scheduled';
  const start = scheduled ? at(s.scheduledStartDateTime) : NaN;
  const end = scheduled ? at(s.scheduledEndDateTime) : NaN;
  return {
    enabled: s.status === 'alwaysEnabled' || scheduled,
    subject: '',
    html: s.externalReplyMessage || s.internalReplyMessage || '',
    start: Number.isFinite(start) ? localDay(start) : '',
    end: Number.isFinite(end) ? localDay(end - 1) : '',
    audience: s.externalAudience === 'none' ? 'internal' : s.externalAudience === 'contactsOnly' ? 'contacts' : 'all'
  };
}

export function toGraph(reply, html) {
  const utc = ms => ({ dateTime: new Date(ms).toISOString().replace(/\.\d+Z$/, ''), timeZone: 'UTC' });
  const setting = {
    status: !reply.enabled ? 'disabled' : reply.start ? 'scheduled' : 'alwaysEnabled',
    externalAudience: reply.audience === 'internal' ? 'none' : reply.audience === 'contacts' ? 'contactsOnly' : 'all',
    internalReplyMessage: html,
    externalReplyMessage: html
  };
  if (reply.start && reply.end) {
    setting.scheduledStartDateTime = utc(localMidnight(reply.start));
    setting.scheduledEndDateTime = utc(localMidnight(reply.end) + DAY_MS); // end day included
  }
  return { automaticRepliesSetting: setting };
}

export function fromGmail(s = {}) {
  const start = Number(s.startTime);
  const end = Number(s.endTime);
  return {
    enabled: s.enableAutoReply === true,
    subject: s.responseSubject || '',
    html: s.responseBodyHtml || textToHtml(s.responseBodyPlainText || ''),
    start: s.startTime && Number.isFinite(start) ? localDay(start) : '',
    end: s.endTime && Number.isFinite(end) ? localDay(end - 1) : '',
    audience: s.restrictToDomain ? 'internal' : s.restrictToContacts ? 'contacts' : 'all'
  };
}

export function toGmail(reply, html, text) {
  const body = {
    enableAutoReply: reply.enabled,
    responseSubject: reply.subject,
    responseBodyHtml: html,
    responseBodyPlainText: text,
    restrictToContacts: reply.audience === 'contacts',
    restrictToDomain: reply.audience === 'internal'
  };
  if (reply.start) body.startTime = String(localMidnight(reply.start));
  if (reply.end) body.endTime = String(localMidnight(reply.end) + DAY_MS);
  return body;
}

// ------------------------------------------------------------------ service
/**
 * `token(account)`: access token with the mailbox-settings consent. `file`: encrypted JSON file
 * (createSealedJsonFile) for the editor content per account.
 */
export function createAutoReplyService({ token, fetchImpl: rawFetch, endpoints = AUTO_REPLY_ENDPOINTS, file, logger }) {
  const fetchImpl = withTimeout(rawFetch, TIMEOUTS.api);
  const supported = account => account?.auth === 'oauth2' && ['microsoft', 'google'].includes(account.oauthProvider);

  async function call(account, method, url, body) {
    const allowed = account.oauthProvider === 'microsoft' ? endpoints.graph : endpoints.gmail;
    if (!url.startsWith(`${allowed}/`)) throw fail('Unerwartete Adresse.', 'autoreply_foreign_url', 502);
    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${await token(account)}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (err) {
      if (err.code === 'cloud_consent_required') throw consent(account);
      if (err.code?.startsWith?.('oauth_')) throw err;
      throw fail('Der Anbieter ist nicht erreichbar. Bitte später erneut versuchen.', 'autoreply_unreachable', 503);
    }
    const data = await res.json().catch(() => ({}));
    logger?.(`autoreply ${account.oauthProvider} ${method} ${res.status}`);
    if (res.status === 403 && /SERVICE_DISABLED|accessNotConfigured/i.test(JSON.stringify(data)))
      throw fail(
        'Die Gmail-API ist im Google-Projekt dieser App nicht aktiviert (siehe docs/OAUTH-SETUP.md).',
        'autoreply_api_disabled',
        409
      );
    if (res.status === 401 || res.status === 403) throw consent(account);
    if (!res.ok) throw fail('Der Anbieter hat die Abwesenheitsnotiz abgelehnt.', 'autoreply_rejected', 502);
    return data;
  }
  const url = (account, ...parts) =>
    account.oauthProvider === 'microsoft'
      ? `${endpoints.graph}/me/mailboxSettings${parts.length ? `/${parts.join('/')}` : ''}`
      : `${endpoints.gmail}/users/me/settings/vacation`;

  async function read(account) {
    return account.oauthProvider === 'microsoft'
      ? fromGraph(await call(account, 'GET', url(account, 'automaticRepliesSetting')))
      : fromGmail(await call(account, 'GET', url(account)));
  }
  const saved = id => file.get().accounts?.[id] || null;
  async function remember(id, entry) {
    const all = { ...(file.get().accounts || {}) };
    if (entry) all[id] = entry;
    else delete all[id];
    await file.save({ ...file.get(), accounts: all });
  }

  return {
    supported,
    async load(account) {
      if (!supported(account)) throw fail('Nicht verfügbar.', 'autoreply_unsupported', 409);
      const remote = await read(account);
      const mine = saved(account.id);
      // Our own last save, unchanged at the provider: show the editor content with the choice.
      const same = mine && mine.fingerprint === fingerprint(remote.html);
      return {
        available: true,
        provider: account.oauthProvider,
        reply: {
          enabled: remote.enabled,
          subject: remote.subject,
          bodyHtml: same ? mine.bodyHtml : remote.html ? sanitizeOutgoingHtml(remote.html) : '',
          includeSignature: same ? mine.includeSignature === true : false,
          start: remote.start,
          end: remote.end,
          audience: remote.audience
        }
      };
    },
    async save(account, input, { signatureHtml = '' } = {}) {
      if (!supported(account)) throw fail('Nicht verfügbar.', 'autoreply_unsupported', 409);
      const reply = validateAutoReply(input, account.oauthProvider);
      const content = composeVacation(reply, signatureHtml);
      const { html, removed } = withoutEmbeddedImages(content.html);
      if (account.oauthProvider === 'microsoft') await call(account, 'PATCH', url(account), toGraph(reply, html));
      else await call(account, 'PUT', url(account), toGmail(reply, html, content.text));
      // What the provider keeps (it may rewrite the HTML) identifies our version next time.
      const stored = await read(account).catch(() => ({ html }));
      await remember(account.id, {
        bodyHtml: reply.bodyHtml,
        includeSignature: reply.includeSignature,
        fingerprint: fingerprint(stored.html)
      }).catch(() => {});
      return { ok: true, removedImages: removed };
    },
    forget: id => remember(id, null).catch(() => {})
  };
}
