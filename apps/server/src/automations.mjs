// Automations ("Automatisierungen"): rules that Levuvo Mail runs on new mail in the inbox, e.g.
// "invoices from X into folder Y and create a task". Unlike server filters (sieve.mjs) they run in
// the app, so they can also create tasks; they work while Levuvo Mail is open (new mail is checked
// again on the next start). A rule can be written in the editor or described in words: the local
// AI then proposes a rule, which the user checks in plain words and with a dry run before
// switching it on. Rules never delete, forward or send anything.
//
// This module is pure: validation, matching and planning. routes-automations.mjs runs them.

export const MAX_RULES = 50;
export const FIELDS = ['from', 'to', 'subject', 'text', 'any', 'attachment'];
export const OPS = ['contains', 'not_contains', 'is', 'ends_with'];
export const ACTION_TYPES = ['move', 'markRead', 'flag', 'task'];

const fail = (message, code = 'automation_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });
const str = (value, max, label) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max || /[\0\r\n]/.test(value))
    throw fail(`Ungültiges Feld: ${label}.`);
  return value;
};

/** Validates one rule. `folderExists(accountId, path)` checks move targets when known. */
export function validateRule(input, { folderExists = () => true } = {}) {
  if (!input || typeof input !== 'object') throw fail('Ungültige Regel.');
  const name = str(input.name, 80, 'Name').trim();
  if (!name) throw fail('Bitte der Regel einen Namen geben.');
  const accountId = str(input.accountId, 200, 'Konto');
  const raw = Array.isArray(input.conditions) ? input.conditions : [];
  if (!raw.length) throw fail('Die Regel braucht mindestens eine Bedingung.');
  if (raw.length > 10) throw fail('Höchstens 10 Bedingungen.');
  const conditions = raw.map(c => {
    if (!FIELDS.includes(c?.field)) throw fail('Ungültige Bedingung.');
    if (c.field === 'attachment') return { field: 'attachment', op: c.op === 'no' ? 'no' : 'yes', value: '' };
    if (!OPS.includes(c.op)) throw fail('Ungültige Bedingung.');
    const value = str(c.value, 200, 'Wert').trim();
    if (!value) throw fail('Bitte bei jeder Bedingung einen Wert eingeben.');
    return { field: c.field, op: c.op, value };
  });
  const rawActions = Array.isArray(input.actions) ? input.actions : [];
  if (!rawActions.length) throw fail('Die Regel braucht mindestens eine Aktion.');
  if (rawActions.length > 5) throw fail('Höchstens 5 Aktionen.');
  const seen = new Set();
  const actions = rawActions.map(a => {
    if (!ACTION_TYPES.includes(a?.type))
      throw fail('Ungültige Aktion. Löschen, Weiterleiten und Senden sind nicht möglich.');
    if (seen.has(a.type)) throw fail('Jede Aktion nur einmal pro Regel.');
    seen.add(a.type);
    if (a.type === 'move') {
      const folder = str(a.folder, 1000, 'Ordner').trim();
      if (!folder) throw fail('Bitte einen Zielordner wählen.');
      if (!folderExists(accountId, folder)) throw fail(`Den Ordner „${folder}“ gibt es nicht.`, 'automation_folder');
      return { type: 'move', folder };
    }
    if (a.type === 'task') {
      const dueDays = Number.isInteger(a.dueDays) && a.dueDays >= 0 && a.dueDays <= 365 ? a.dueDays : null;
      return {
        type: 'task',
        title: str(a.title, 300, 'Aufgabentitel').trim() || '{subject}',
        dueDays,
        priority: ['none', 'low', 'medium', 'high'].includes(a.priority) ? a.priority : 'none'
      };
    }
    return { type: a.type };
  });
  if (seen.has('move') && actions.findIndex(a => a.type === 'move') !== actions.length - 1)
    actions.push(
      ...actions.splice(
        actions.findIndex(a => a.type === 'move'),
        1
      )
    ); // move runs last
  return {
    name,
    accountId,
    enabled: input.enabled === true,
    match: input.match === 'any' ? 'any' : 'all',
    conditions,
    actions,
    stop: input.stop !== false,
    origin: input.origin === 'ai' ? 'ai' : 'manual'
  };
}

// ------------------------------------------------------------------ matching
const lower = v => String(v || '').toLowerCase();
function fieldValues(field, m) {
  const from = [m.fromEmail, m.fromName].filter(Boolean).map(lower);
  const to = (Array.isArray(m.to) ? m.to : [m.to])
    .filter(Boolean)
    .map(x => lower(typeof x === 'string' ? x : x.email || x.address || ''));
  const subject = [lower(m.subject)];
  const text = [lower(m.preview || m.text)];
  if (field === 'from') return from;
  if (field === 'to') return to;
  if (field === 'subject') return subject;
  if (field === 'text') return text;
  return [...from, ...to, ...subject, ...text];
}
const addressOf = v => (/<([^>]+)>/.exec(v)?.[1] || v).trim();
export function testCondition(c, m) {
  if (c.field === 'attachment') return c.op === 'no' ? !m.hasAttachments : Boolean(m.hasAttachments);
  const value = lower(c.value);
  const values = fieldValues(c.field, m);
  switch (c.op) {
    case 'contains':
      return values.some(v => v.includes(value));
    case 'not_contains':
      return !values.some(v => v.includes(value));
    case 'is':
      return values.some(v => v === value || addressOf(v) === value);
    case 'ends_with':
      return values.some(v => addressOf(v).endsWith(value));
    default:
      return false;
  }
}
export function matches(rule, m) {
  const results = rule.conditions.map(c => testCondition(c, m));
  return rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/**
 * What the rules would do with one message: a list of { rule, actions }. Rules are tried in order;
 * a rule with `stop` ends the list once it matched. Only enabled rules unless `includeDisabled`.
 */
export function plan(rules, m, { accountId = '', includeDisabled = false } = {}) {
  const out = [];
  for (const rule of rules) {
    if (!includeDisabled && !rule.enabled) continue;
    if (rule.accountId && accountId && rule.accountId !== accountId) continue;
    if (!matches(rule, m)) continue;
    out.push({ rule, actions: rule.actions });
    if (rule.stop) break;
  }
  return out;
}

/** "{subject}" and "{from}" in a task title. */
export function fillTitle(template, m) {
  return (
    String(template || '{subject}')
      .replace(/\{subject\}/g, m.subject || '')
      .replace(/\{from\}/g, m.fromName || m.fromEmail || '')
      .replace(/[\r\n\0]/g, ' ')
      .trim()
      .slice(0, 300) ||
    String(m.subject || '').slice(0, 300) ||
    '–'
  );
}

/** The task a rule creates for a message (due in `dueDays` days, on the local calendar day). */
export function taskFor(action, m, { accountId, folder = 'INBOX', now = new Date(), timeZone = 'Europe/Vienna' } = {}) {
  let due = null;
  if (action.dueDays !== null && action.dueDays !== undefined) {
    const day = new Date(now.getTime() + action.dueDays * 86_400_000);
    due = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
  }
  return {
    title: fillTitle(action.title, m),
    due,
    priority: action.priority || 'none',
    source: 'mail',
    mail: {
      accountId,
      folder,
      uid: m.uid,
      messageId: m.messageId || null,
      subject: String(m.subject || '').slice(0, 1000),
      from: String(m.fromName || m.fromEmail || '').slice(0, 400)
    }
  };
}
