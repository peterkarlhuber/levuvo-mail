// Local, rule-based checks before sending (GDPR Art. 5(1)(f), 9, 32). They run on this device without
// AI, only warn at the moment of sending and leave the decision to the user. Nothing is logged,
// counted or reported (docs/compliance/GDPR.md § "Guardrails"). Keep them conservative: a warning
// that fires on every invoice mail teaches people to click it away.

export type ComplianceIssue = {
  kind: 'open-recipients' | 'sensitive-unencrypted' | 'special-category';
  /** German source text for t(); `vars` fills its placeholders. */
  text: string;
  vars?: Record<string, string | number>;
  /** German source texts for t(), joined into `{what}`. */
  items?: string[];
};

export type ComplianceInput = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  /** Encrypted end to end (PGP, S/MIME) or as a password-protected message. */
  encrypted: boolean;
};

/** Open recipients from this many external addresses on … */
export const OPEN_RECIPIENTS_LIMIT = 10;
/** … and at least this many different external domains (a circular, not a meeting with one firm). */
export const OPEN_DOMAINS_LIMIT = 3;

const domainOf = (address: string) => {
  const m = /@([^\s@>]+)>?\s*$/.exec(address.trim());
  return m ? m[1].toLowerCase() : '';
};

function external(from: string, addresses: string[]) {
  const own = domainOf(from);
  return addresses.filter(a => {
    const d = domainOf(a);
    return d && d !== own;
  });
}

/** Luhn check for payment card numbers (13–19 digits). */
export function luhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Austrian social security number: NNNC DDMMYY, check digit C = weighted sum mod 11. */
export function austrianSvnr(digits: string): boolean {
  if (!/^\d{10}$/.test(digits) || digits[0] === '0') return false;
  const w = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6];
  const sum = [...digits].reduce((s, d, i) => s + Number(d) * w[i], 0);
  const check = sum % 11;
  if (check === 10 || check !== Number(digits[3])) return false;
  const day = Number(digits.slice(4, 6));
  const month = Number(digits.slice(6, 8));
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

function cardNumber(text: string) {
  for (const m of text.matchAll(/(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g)) {
    if (luhn(m[0].replace(/[ -]/g, ''))) return true;
  }
  return false;
}

function svnr(text: string) {
  // Only next to a label, so that ten-digit order or phone numbers do not trigger it.
  const re =
    /(?:sozialversicherungs(?:nummer|nr\.?)|sv-?(?:nummer|nr\.?)|svnr|social security(?: number)?)\D{0,12}(\d{4}\s?\d{6})/gi;
  for (const m of text.matchAll(re)) if (austrianSvnr(m[1].replace(/\s/g, ''))) return true;
  return false;
}

function password(text: string) {
  // "Passwort: X7!kq…" – a label followed by a value on the same line, not "Passwort vergessen?".
  return /(?:^|\s)(?:passwor[dt]|kennwort|password|pin|tan)\s*[:=]\s*\S{4,}/im.test(text);
}

// Special categories (Art. 9 GDPR): health only. Terms that rarely appear in everyday business mail;
// religion, ethnicity or sexual orientation cannot be detected reliably by words and are left to the
// optional AI check.
const HEALTH =
  /\b(?:diagnose|befund|arztbrief|krankmeldung|krankenstandsbestätigung|arbeitsunfähigkeitsbescheinigung|au-bescheinigung|attest|therapiebericht|laborwerte|schwangerschaft|hiv|psychiatrisch\w*|diagnosis|medical report|sick note|lab results|pregnancy)\b/i;

/** Local checks before sending; empty when nothing applies. */
export function complianceIssues(input: ComplianceInput): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const open = external(input.from, [...input.to, ...input.cc]);
  const openDomains = new Set(open.map(domainOf));
  if (open.length >= OPEN_RECIPIENTS_LIMIT && openDomains.size >= OPEN_DOMAINS_LIMIT)
    issues.push({
      kind: 'open-recipients',
      text: '{count} externe Empfänger sehen alle Adressen unter „An“ und „Cc“. Für Rundschreiben „Bcc“ verwenden (DSGVO Art. 5 und 32).',
      vars: { count: open.length }
    });

  const outside = external(input.from, [...input.to, ...input.cc, ...input.bcc]).length > 0;
  if (input.encrypted || !outside) return issues;
  const body = `${input.subject}\n${input.text}`;
  const found: string[] = [];
  if (cardNumber(body)) found.push('eine Kartennummer');
  if (svnr(body)) found.push('eine Sozialversicherungsnummer');
  if (password(body)) found.push('ein Passwort oder einen Code');
  if (found.length)
    issues.push({
      kind: 'sensitive-unencrypted',
      text: 'Die Mail enthält {what} und geht unverschlüsselt an externe Empfänger. Besser verschlüsselt oder mit Passwort senden.',
      items: found
    });
  if (HEALTH.test(body))
    issues.push({
      kind: 'special-category',
      text: 'Die Mail enthält offenbar Gesundheitsdaten (besondere Kategorie, DSGVO Art. 9) und geht unverschlüsselt an externe Empfänger. Nur senden, wenn das nötig und erlaubt ist, am besten verschlüsselt.'
    });
  return issues;
}

/** Every German text these checks can produce (for the translation test). */
export const COMPLIANCE_TEXTS = [
  '{count} externe Empfänger sehen alle Adressen unter „An“ und „Cc“. Für Rundschreiben „Bcc“ verwenden (DSGVO Art. 5 und 32).',
  'Die Mail enthält {what} und geht unverschlüsselt an externe Empfänger. Besser verschlüsselt oder mit Passwort senden.',
  'Die Mail enthält offenbar Gesundheitsdaten (besondere Kategorie, DSGVO Art. 9) und geht unverschlüsselt an externe Empfänger. Nur senden, wenn das nötig und erlaubt ist, am besten verschlüsselt.',
  'eine Kartennummer',
  'eine Sozialversicherungsnummer',
  'ein Passwort oder einen Code'
];
