// Password rule for "Protect with password".
const COMMON_PASSWORD_WORDS = new Set([
  'passwort',
  'password',
  'kennwort',
  'geheim',
  'secret',
  'qwertz',
  'qwerty',
  'qwertzuiop',
  'qwertyuiop',
  'asdfghjkl',
  'letmein',
  'welcome',
  'willkommen',
  'hallo',
  'admin',
  'levuvo'
]);

/** Same rule as weakPassword() in apps/server/src/protected-message.mjs (the server checks again). */
export function weakPassword(password: string) {
  const pw = password.normalize('NFC');
  const lower = pw.toLowerCase();
  if (new Set(lower).size < 5) return true;
  const codes = [...lower].map(c => c.codePointAt(0) || 0);
  const steps = codes.slice(1).map((c, i) => c - codes[i]);
  if (steps.every(d => d === 1) || steps.every(d => d === -1)) return true;
  if (/^\d+$/.test(pw) && pw.length < 16) return true;
  const core = lower.replace(/^[\d\W_]+|[\d\W_]+$/gu, '').replace(/[\s._-]+/g, '');
  return COMMON_PASSWORD_WORDS.has(core);
}
