// Placeholders in text templates. Unknown values stay visible (e.g. "{Vorname}") so that
// nothing is silently left empty.
export type TemplateVars = { firstName?: string; lastName?: string; fullName?: string; sender?: string; date?: string };
export type Template = {
  id: string;
  name: string;
  subject: string;
  html: string;
  shortcut?: string;
  updatedAt?: string;
};

const KEYS: Record<string, keyof TemplateVars> = {
  vorname: 'firstName',
  firstname: 'firstName',
  nachname: 'lastName',
  lastname: 'lastName',
  name: 'fullName',
  fullname: 'fullName',
  absender: 'sender',
  sender: 'sender',
  datum: 'date',
  date: 'date'
};
export const PLACEHOLDERS = ['{Vorname}', '{Nachname}', '{Name}', '{Absender}', '{Datum}'];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function fillTemplate(text: string, vars: TemplateVars, { html = true } = {}) {
  return text.replace(/\{([A-Za-zÄÖÜäöü]+)\}/g, (match, key: string) => {
    const field = KEYS[key.toLowerCase()];
    const value = field ? vars[field] : undefined;
    if (!value) return match;
    return html ? escapeHtml(value) : value;
  });
}

/** "Anna Berger" → first/last name; an address alone gives no name. */
export function nameParts(fullName: string) {
  const clean = fullName.replace(/["']/g, '').trim();
  if (!clean || clean.includes('@')) return {};
  const parts = clean.split(/\s+/);
  return { fullName: clean, firstName: parts[0], lastName: parts.length > 1 ? parts.at(-1) : undefined };
}

/** Keys that expand a shortcut typed right before the cursor (";mfg" + space or Tab). */
export const SHORTCUT_KEYS = [' ', 'Tab'];

/** The template whose shortcut ends the text before the cursor, e.g. "Danke ;mfg". */
export function shortcutAt(before: string, templates: Template[]) {
  const m = /(?:^|[\s(]);([\p{L}\p{N}_-]{2,20})$/u.exec(before);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const template = templates.find(t => t.shortcut === key);
  return template ? { template, length: key.length + 1 } : null;
}
