// Text templates ("Textbausteine") with placeholders, stored in templates.json (app data).
import { randomUUID } from 'node:crypto';
import { sanitizeOutgoingHtml, stripTags } from './html-mail.mjs';

const MAX_TEMPLATES = 100;
const MAX_HTML = 200 * 1024;
const fail = (message, code = 'template_invalid', statusCode = 400) =>
  Object.assign(new Error(message), { code, statusCode });

export function validateTemplate(input) {
  if (!input || typeof input !== 'object') throw fail('Ungültige Vorlage.');
  const name = String(input.name ?? '').trim();
  if (!name || name.length > 80) throw fail('Bitte einen Namen (bis 80 Zeichen) eingeben.');
  const subject = String(input.subject ?? '');
  if (subject.length > 250 || /[\r\n]/.test(subject)) throw fail('Ungültiger Betreff.');
  const html = String(input.html ?? '');
  if (html.length > MAX_HTML) throw fail('Die Vorlage ist zu groß.');
  const clean = sanitizeOutgoingHtml(html);
  if (!stripTags(clean).trim() && !/<img/i.test(clean)) throw fail('Die Vorlage ist leer.');
  const shortcut = normalizeShortcut(input.shortcut);
  return shortcut ? { name, subject, html: clean, shortcut } : { name, subject, html: clean };
}

/** Optional shortcut ("mfg"): typed as ";mfg" + space or Tab in the composer. */
export function normalizeShortcut(value) {
  const shortcut = String(value ?? '')
    .trim()
    .replace(/^;/, '')
    .toLowerCase();
  if (!shortcut) return '';
  if (!/^[\p{L}\p{N}_-]{2,20}$/u.test(shortcut))
    throw fail('Das Kürzel braucht 2–20 Buchstaben, Ziffern, - oder _.', 'template_shortcut_invalid');
  return shortcut;
}

export function createTemplateStore(file) {
  const list = () => (Array.isArray(file.get().templates) ? file.get().templates : []);
  return {
    list: () => [...list()].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    async save(input) {
      const clean = validateTemplate(input);
      const current = list();
      const id = typeof input.id === 'string' && current.some(t => t.id === input.id) ? input.id : randomUUID();
      if (!current.some(t => t.id === id) && current.length >= MAX_TEMPLATES)
        throw fail(`Höchstens ${MAX_TEMPLATES} Vorlagen.`);
      if (clean.shortcut && current.some(t => t.id !== id && t.shortcut === clean.shortcut))
        throw fail('Dieses Kürzel ist schon vergeben.', 'template_shortcut_taken', 409);
      const item = { id, ...clean, updatedAt: new Date().toISOString() };
      await file.save({ templates: [...current.filter(t => t.id !== id), item] });
      return item;
    },
    async remove(id) {
      await file.save({ templates: list().filter(t => t.id !== id) });
    }
  };
}
