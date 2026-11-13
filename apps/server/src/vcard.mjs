// vCard (3.0/4.0) parsing via ical.js and vCard 3.0 output (widest compatibility,
// e.g. Nextcloud, iOS, Android).
import ICAL from 'ical.js';
import { randomUUID } from 'node:crypto';

const fail = message => Object.assign(new Error(message), { statusCode: 400, code: 'contact_invalid' });
const typeOf = p => {
  const t = p.getParameter('type');
  return (
    String(Array.isArray(t) ? t[0] : t || '')
      .toLowerCase()
      .replace(/^pref$/, '') || 'other'
  );
};

export function parseVCard(text) {
  let comp;
  try {
    const parsed = ICAL.parse(String(text));
    comp = new ICAL.Component(Array.isArray(parsed[0]) ? parsed[0] : parsed);
  } catch {
    return null;
  }
  const n = comp.getFirstPropertyValue('n');
  const fn = comp.getFirstPropertyValue('fn') || (Array.isArray(n) ? [n[1], n[0]].filter(Boolean).join(' ') : '');
  const org = comp.getFirstPropertyValue('org');
  const adr = comp.getFirstPropertyValue('adr');
  return {
    uid: String(comp.getFirstPropertyValue('uid') || ''),
    name: String(fn || '').trim(),
    firstName: Array.isArray(n) ? String(n[1] || '') : '',
    lastName: Array.isArray(n) ? String(n[0] || '') : '',
    emails: comp
      .getAllProperties('email')
      .map(p => ({
        value: String(p.getFirstValue() || '')
          .replace(/^mailto:/i, '')
          .trim(),
        type: typeOf(p)
      }))
      .filter(e => e.value),
    phones: comp
      .getAllProperties('tel')
      .map(p => ({
        value: String(p.getFirstValue() || '')
          .replace(/^tel:/i, '')
          .trim(),
        type: typeOf(p)
      }))
      .filter(e => e.value),
    organization: Array.isArray(org) ? org.filter(Boolean).join(', ') : String(org || ''),
    title: String(comp.getFirstPropertyValue('title') || ''),
    address: Array.isArray(adr) ? adr.flat().filter(Boolean).join(', ') : String(adr || ''),
    birthday: (() => {
      const b = comp.getFirstPropertyValue('bday');
      return b ? String(b.toString?.() || b).slice(0, 10) : '';
    })(),
    note: String(comp.getFirstPropertyValue('note') || '')
  };
}

// RFC 6350 §3.4 escaping
const esc = v =>
  String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[,;]/g, m => `\\${m}`);
/** Line folding at 75 octets (RFC 6350 §3.2). */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  for (const ch of line) {
    if (Buffer.byteLength(current + ch, 'utf8') > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
    }
    current += ch;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const TYPES = new Set(['home', 'work', 'cell', 'other', 'fax', 'voice', 'mobile']);
export function validateContact(input) {
  if (!input || typeof input !== 'object') throw fail('Ungültiger Kontakt.');
  const s = (v, max) => {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string' || v.length > max || v.includes('\0')) throw fail('Ungültiges Feld.');
    return v.trim();
  };
  const list = (arr, validate) =>
    (Array.isArray(arr) ? arr : [])
      .slice(0, 10)
      .map(x => ({ value: validate(s(x?.value, 254)), type: TYPES.has(x?.type) ? x.type : 'other' }))
      .filter(x => x.value);
  const contact = {
    firstName: s(input.firstName, 120),
    lastName: s(input.lastName, 120),
    name: s(input.name, 250),
    emails: list(input.emails, v => {
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw fail(`Ungültige E-Mail-Adresse: ${v}`);
      return v;
    }),
    phones: list(input.phones, v => {
      if (v && !/^[+\d\s()/.-]{3,40}$/.test(v)) throw fail(`Ungültige Telefonnummer: ${v}`);
      return v;
    }),
    organization: s(input.organization, 200),
    title: s(input.title, 120),
    address: s(input.address, 400),
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(input.birthday || '') ? input.birthday : '',
    note: s(input.note, 4000)
  };
  if (!contact.name)
    contact.name =
      [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
      contact.organization ||
      contact.emails[0]?.value ||
      '';
  if (!contact.name) throw fail('Bitte einen Namen oder eine E-Mail-Adresse eingeben.');
  return contact;
}

export function buildVCard(contact, uid = randomUUID()) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'PRODID:-//Levuvo//Levuvo Mail 2.0//DE',
    `UID:${esc(uid)}`,
    `FN:${esc(contact.name)}`,
    `N:${esc(contact.lastName)};${esc(contact.firstName)};;;`
  ];
  for (const e of contact.emails)
    lines.push(`EMAIL;TYPE=INTERNET${e.type !== 'other' ? `,${e.type.toUpperCase()}` : ''}:${esc(e.value)}`);
  for (const p of contact.phones)
    lines.push(`TEL${p.type !== 'other' ? `;TYPE=${p.type.toUpperCase()}` : ''}:${esc(p.value)}`);
  if (contact.organization) lines.push(`ORG:${esc(contact.organization)}`);
  if (contact.title) lines.push(`TITLE:${esc(contact.title)}`);
  if (contact.address) lines.push(`ADR;TYPE=WORK:;;${esc(contact.address)};;;;`);
  if (contact.birthday) lines.push(`BDAY:${contact.birthday}`);
  if (contact.note) lines.push(`NOTE:${esc(contact.note)}`);
  lines.push(`REV:${new Date().toISOString().replace(/\.\d{3}/, '')}`, 'END:VCARD');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
