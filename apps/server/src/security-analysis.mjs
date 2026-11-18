// Phishing and authenticity checks for a received message. Purely local: uses the
// Authentication-Results header added by the receiving mail server plus heuristics.
// Result levels: ok < info < warning < danger.

import { domainToUnicode } from 'node:url';
import { stripTags } from './html-mail.mjs';

const LEVEL = { ok: 0, info: 1, warning: 2, danger: 3 };
const DANGEROUS_EXT =
  /\.(exe|scr|com|pif|bat|cmd|vbs|vbe|js|jse|wsf|wsh|hta|msi|msix|ps1|psm1|jar|lnk|reg|iso|img|vhd|cpl|appx|dmg|pkg|app|sh)$/i;
const MACRO_EXT = /\.(docm|xlsm|pptm|dotm|xltm|xlam|ppam)$/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|ace|cab|gz|tgz)$/i;
// HTML/SVG attachments open a local page in the browser: a common way to show a fake login form.
const HTML_EXT = /\.(html?|shtml|xhtml|svgz?|mht(ml)?)$/i;

/**
 * Brands that phishing mails impersonate most often, with the registrable domains they really
 * send from. Used for display-name impersonation and look-alike domains. Kept deliberately
 * small: a missing legitimate domain causes a false warning, so only add well-known ones.
 */
export const BRANDS = {
  paypal: ['paypal.com', 'paypal.de', 'paypal.at', 'paypal.ch', 'paypal.me', 'paypal-communication.com'],
  amazon: [
    'amazon.com',
    'amazon.de',
    'amazon.at',
    'amazon.co.uk',
    'amazon.fr',
    'amazon.it',
    'amazon.es',
    'amazon.nl',
    'amazonses.com',
    'amazonaws.com'
  ],
  apple: ['apple.com', 'icloud.com', 'me.com', 'mac.com'],
  microsoft: [
    'microsoft.com',
    'office.com',
    'office365.com',
    'outlook.com',
    'live.com',
    'hotmail.com',
    'microsoftonline.com',
    'microsoft365.com',
    'azure.com',
    'sharepoint.com'
  ],
  google: ['google.com', 'gmail.com', 'googlemail.com', 'youtube.com', 'google.de'],
  netflix: ['netflix.com'],
  spotify: ['spotify.com'],
  facebook: ['facebook.com', 'facebookmail.com', 'meta.com'],
  instagram: ['instagram.com', 'facebookmail.com'],
  linkedin: ['linkedin.com'],
  ebay: ['ebay.com', 'ebay.de', 'ebay.at', 'ebay.co.uk'],
  dhl: ['dhl.com', 'dhl.de', 'dhl.at', 'deutschepost.de', 'dpdhl.com'],
  dpd: ['dpd.com', 'dpd.de', 'dpd.at'],
  fedex: ['fedex.com'],
  ups: ['ups.com'],
  sparkasse: ['sparkasse.de', 'sparkasse.at', 's-ip.de', 'sparkasse-online.de'],
  commerzbank: ['commerzbank.de', 'commerzbank.com'],
  postbank: ['postbank.de'],
  volksbank: ['volksbank.de', 'volksbank.at', 'vr.de'],
  raiffeisen: ['raiffeisen.at', 'raiffeisen.ch', 'rbinternational.com'],
  postfinance: ['postfinance.ch'],
  ing: ['ing.de', 'ing.com', 'ing.at'],
  docusign: ['docusign.com', 'docusign.net'],
  dropbox: ['dropbox.com', 'dropboxmail.com'],
  telekom: ['telekom.de', 't-online.de', 'telekom.com'],
  vodafone: ['vodafone.de', 'vodafone.com', 'vodafone.at'],
  a1: ['a1.net', 'a1.at']
};
// Brands whose regional members send from their own domains ("sparkasse-koelnbonn.de",
// "raiffeisen-leasing.at"): any registrable domain containing the brand name counts as genuine.
const FEDERATED = new Set(['sparkasse', 'volksbank', 'raiffeisen']);
const isFederatedMember = (brand, domain) => FEDERATED.has(brand) && labelOf(domain).includes(brand);
// Words that phishing display names add around a brand ("PayPal Service", "Amazon Kundenservice").
const BRAND_FILLER = new Set(
  'service services support team kundenservice kundendienst customer care security sicherheit konto account accounts info information noreply no reply notification notifications benachrichtigung benachrichtigungen billing rechnung online banking bank de at ch com inc gmbh ag the der die das'.split(
    ' '
  )
);
// Confusable characters (digits, Cyrillic and Greek look-alikes) mapped to the Latin letter they imitate.
const CONFUSABLE = {
  0: 'o',
  1: 'l',
  3: 'e',
  5: 's',
  '|': 'l',
  i: 'l',
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'l',
  ӏ: 'l',
  ј: 'j',
  ԁ: 'd',
  ѕ: 's',
  һ: 'h',
  ո: 'n',
  ο: 'o',
  α: 'a',
  ρ: 'p',
  ν: 'v',
  τ: 't',
  ι: 'l',
  κ: 'k'
};

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

/** Visual skeleton of a domain label: "paypa1", "pаypal" (Cyrillic а) and "paypal" all map to "paypal". */
export function skeleton(label) {
  return [...String(label || '').toLowerCase()]
    .map(ch => CONFUSABLE[ch] ?? ch)
    .join('')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/cl/g, 'd')
    .replace(/[-_.]/g, '');
}

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else if (a[i + 1] === b[j] && a[i] === b[j + 1]) {
      i += 2; // transposition ("paypla")
      j += 2;
    } else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const labelOf = domain => baseDomain(domain).split('.')[0] || '';

/**
 * Does `domain` imitate one of the `targets` (registrable domains) without being one of them?
 * Returns `{ imitates, level }` or null:
 * - danger: same visual skeleton ("paypa1", "pаypal" with Cyrillic а, "rnicrosoft").
 * - warning (only with `loose`, labels of 6+ characters): one typo ("amazom", "paypall"),
 *   or the brand as one part of a hyphenated label ("paypal-secure").
 * The same label under another TLD ("amazon.pl") is never flagged: too many legitimate cases.
 */
export function imitatedDomain(domain, targets, { loose = true } = {}) {
  const raw = String(domain || '').toLowerCase();
  const host = domainToUnicode(raw) || raw;
  const base = baseDomain(host);
  if (!base || targets.some(t => baseDomain(t) === base)) return null;
  const label = labelOf(host);
  const shape = skeleton(label);
  const parts = label.split('-').filter(Boolean).map(skeleton);
  let typo = null;
  for (const target of targets) {
    const targetLabel = labelOf(target);
    // 3-letter brands (dhl, ups, ing) collide with too many real names ("dhi", "lng").
    if (targetLabel.length < 4 || label === targetLabel) continue;
    const targetShape = skeleton(targetLabel);
    if (shape === targetShape) return { imitates: target, level: 'danger' };
    if (!loose || typo || targetLabel.length < 6) continue;
    if (editDistanceAtMostOne(shape, targetShape) || (parts.length > 1 && parts.includes(targetShape)))
      typo = { imitates: target, level: 'warning' };
  }
  return typo;
}

const ALL_BRAND_DOMAINS = Object.values(BRANDS).flat();
const isFederatedDomain = domain => [...FEDERATED].some(brand => isFederatedMember(brand, domain));

/** Display name that is just a brand ("PayPal", "Amazon Kundenservice") – the brand key, or null. */
export function brandInName(name) {
  const words = String(name || '')
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(w => [...w].map(ch => (/[a-z]/.test(ch) ? ch : (CONFUSABLE[ch] ?? ch))).join(''))
    .filter(w => !BRAND_FILLER.has(w));
  if (words.length !== 1) return null;
  const word = words[0].replace(/1/g, 'l');
  return Object.hasOwn(BRANDS, word) ? word : null;
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
    const text = stripTags(m[2]).replace(/&amp;/g, '&').trim();
    let target;
    try {
      target = new URL(href);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(target.protocol)) continue;
    // "https://www.paypal.com@evil.example/" – everything before @ is a user name, not the host.
    if (target.username) {
      issues.push({ shown: decodeURIComponent(target.username).toLowerCase().slice(0, 80), actual: target.hostname });
      if (issues.length >= 5) break;
      continue;
    }
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

/** Hosts of all http(s) links in the HTML body (deduplicated, capped). */
function linkHosts(html) {
  const hosts = new Set();
  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']\s*(https?:\/\/[^"'\s]+)/gi)) {
    try {
      hosts.add(new URL(m[1]).hostname.toLowerCase());
    } catch {
      // ignore malformed links
    }
    if (hosts.size >= 200) break;
  }
  return [...hosts];
}

/**
 * @param parsed postal-mime result
 * @param {{ knownSender?: boolean | null, ownAddresses?: string[] }} context
 *   `ownAddresses`: the account's own addresses – look-alikes of their domains are flagged
 *   (a classic in CEO fraud: "levuv0.at" instead of "levuvo.at").
 */
export function analyzeMessage(parsed, { knownSender = null, ownAddresses = [] } = {}) {
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

  // Look-alike of a well-known brand or of the user's own domain ("paypa1.com", "levuv0.at").
  const ownDomains = [...new Set(ownAddresses.map(domainOf).filter(Boolean))];
  const lookalikeTargets = [...ownDomains, ...ALL_BRAND_DOMAINS];
  let imitated = fromDomain && !isFederatedDomain(fromDomain) ? imitatedDomain(fromDomain, lookalikeTargets) : null;
  // A contact you already write with ("telecom.de") is not warned about a mere typo-distance match.
  if (imitated?.level === 'warning' && knownSender === true) imitated = null;
  if (imitated) add(imitated.level, 'lookalike_domain', { domain: fromDomain, imitates: imitated.imitates });

  // Display name is a brand, but the address is not from that brand ("PayPal" <x@mailer.example>).
  const brand = brandInName(from.name);
  if (
    brand &&
    fromDomain &&
    knownSender !== true &&
    !imitated &&
    !BRANDS[brand].some(d => baseDomain(d) === baseDomain(fromDomain)) &&
    !isFederatedMember(brand, fromDomain)
  )
    add('warning', 'brand_impersonation', { brand: String(from.name).trim().slice(0, 60), actual: fromEmail });

  // Links: only exact visual imitations – newsletters link to many legitimate "brand-xyz" hosts.
  const lookalikeLink = linkHosts(parsed.html)
    .filter(host => baseDomain(host) !== baseDomain(fromDomain))
    .map(host => ({ host, match: imitatedDomain(host, lookalikeTargets, { loose: false }) }))
    .find(l => l.match);
  if (lookalikeLink)
    add('danger', 'lookalike_link', { domain: lookalikeLink.host, imitates: lookalikeLink.match.imitates });

  // A login form inside the message itself – legitimate senders link to their website instead.
  if (/<form\b[\s\S]{0,20000}?<input\b[^>]*type\s*=\s*["']?password/i.test(parsed.html || ''))
    add('danger', 'password_form');

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
    // Inline parts (an SVG logo referenced by the HTML body) are not attachments the user opens.
    else if (HTML_EXT.test(name) && !att.related && !att.contentId)
      add('warning', 'html_attachment', { filename: name.slice(0, 120) });
    else if (ARCHIVE_EXT.test(name)) add('info', 'archive_attachment', { filename: name.slice(0, 120) });
  }

  if (knownSender === false && checks.some(c => LEVEL[c.level] >= LEVEL.warning)) add('info', 'first_contact');

  const level = checks.reduce((max, c) => (LEVEL[c.level] > LEVEL[max] ? c.level : max), 'ok');
  return { level, auth, checks };
}
