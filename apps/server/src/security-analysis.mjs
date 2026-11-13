// Phishing and authenticity checks for a received message. Purely local: uses the
// Authentication-Results header added by the receiving mail server plus heuristics.
// Result levels: ok < info < warning < danger.

const LEVEL = { ok: 0, info: 1, warning: 2, danger: 3 };
const DANGEROUS_EXT =
  /\.(exe|scr|com|pif|bat|cmd|vbs|vbe|js|jse|wsf|wsh|hta|msi|msix|ps1|psm1|jar|lnk|reg|iso|img|vhd|cpl|appx|dmg|pkg|app|sh)$/i;
const MACRO_EXT = /\.(docm|xlsm|pptm|dotm|xltm|xlam|ppam)$/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|ace|cab|gz|tgz)$/i;

const domainOf = email =>
  String(email || '')
    .toLowerCase()
    .split('@')[1] || '';
/** Registrable-ish domain: last two labels (three for common 2nd-level ccTLDs). */
export function baseDomain(host) {
  const parts = String(host || '')
    .toLowerCase()
    .replace(/\.$/, '')
    .split('.')
    .filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const twoLevel = /^(co|com|org|net|gv|ac|or|gov|edu)\.[a-z]{2}$/.test(parts.slice(-2).join('.'));
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

/** Parses the FIRST Authentication-Results header (added by the receiving server). */
export function parseAuthenticationResults(value) {
  const result = {};
  if (!value) return result;
  for (const method of ['spf', 'dkim', 'dmarc']) {
    const match = new RegExp(`\\b${method}=([a-z]+)`, 'i').exec(value);
    if (match) result[method] = match[1].toLowerCase();
  }
  return result;
}

function headerValues(parsed, name) {
  return (parsed.headers || []).filter(h => String(h.key).toLowerCase() === name).map(h => String(h.value || ''));
}

/** Links whose visible text is a URL/domain different from the real target. */
export function findDeceptiveLinks(html) {
  const issues = [];
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  let checked = 0;
  while ((m = anchor.exec(html || '')) && checked < 500) {
    checked++;
    const href = m[1].trim();
    const text = m[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .trim();
    let target;
    try {
      target = new URL(href);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(target.protocol)) continue;
    const shown = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#]|$)/i.exec(text);
    if (shown && baseDomain(shown[1]) !== baseDomain(target.hostname)) {
      issues.push({ shown: shown[1].toLowerCase(), actual: target.hostname.toLowerCase() });
    } else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(target.hostname)) {
      issues.push({ shown: text.slice(0, 80), actual: target.hostname });
    }
    if (issues.length >= 5) break;
  }
  return issues;
}

/**
 * @param parsed postal-mime result
 * @param {{ knownSender?: boolean }} context
 */
export function analyzeMessage(parsed, { knownSender = null } = {}) {
  const checks = [];
  const add = (level, code, params = {}) => checks.push({ level, code, ...params });
  const from = parsed.from || {};
  const fromEmail = String(from.address || '').toLowerCase();
  const fromDomain = domainOf(fromEmail);

  const auth = parseAuthenticationResults(headerValues(parsed, 'authentication-results')[0]);
  if (auth.dmarc === 'fail') add('danger', 'dmarc_fail', { domain: fromDomain });
  else if (auth.dmarc === 'pass') add('ok', 'dmarc_pass', { domain: fromDomain });
  if (auth.spf && ['fail', 'softfail'].includes(auth.spf) && auth.dmarc !== 'pass') add('warning', 'spf_fail');
  if (auth.dkim === 'fail' && auth.dmarc !== 'pass') add('warning', 'dkim_fail');
  if (!auth.dmarc && !auth.spf && !auth.dkim) add('info', 'auth_unknown');

  // Display name pretends to be another address: "PayPal <service@paypal.com>" <x@evil.example>
  const nameEmail = /[\w.+-]+@([\w-]+\.)+[a-z]{2,}/i.exec(String(from.name || ''));
  if (nameEmail && nameEmail[0].toLowerCase() !== fromEmail)
    add('danger', 'display_name_spoof', { shown: nameEmail[0].toLowerCase(), actual: fromEmail });

  const replyTo = (parsed.replyTo || []).map(r => String(r.address || '').toLowerCase()).filter(Boolean);
  if (replyTo.length && replyTo.some(r => baseDomain(domainOf(r)) !== baseDomain(fromDomain)))
    add('warning', 'reply_to_differs', { replyTo: replyTo[0] });

  if (/(^|\.)xn--/.test(fromDomain)) add('warning', 'punycode_domain', { domain: fromDomain });

  const links = findDeceptiveLinks(parsed.html || '');
  if (links.length)
    add('danger', 'deceptive_link', { shown: links[0].shown, actual: links[0].actual, count: links.length });

  for (const att of parsed.attachments || []) {
    const name = String(att.filename || '');
    if (
      DANGEROUS_EXT.test(name) ||
      (/\.(pdf|docx?|xlsx?|jpe?g|png|txt)\.[a-z0-9]{2,4}$/i.test(name) && DANGEROUS_EXT.test(name))
    ) {
      add('danger', 'dangerous_attachment', { filename: name.slice(0, 120) });
    } else if (MACRO_EXT.test(name)) add('warning', 'macro_attachment', { filename: name.slice(0, 120) });
    else if (ARCHIVE_EXT.test(name)) add('info', 'archive_attachment', { filename: name.slice(0, 120) });
  }

  if (knownSender === false && checks.some(c => LEVEL[c.level] >= LEVEL.warning)) add('info', 'first_contact');

  const level = checks.reduce((max, c) => (LEVEL[c.level] > LEVEL[max] ? c.level : max), 'ok');
  return { level, auth, checks };
}
