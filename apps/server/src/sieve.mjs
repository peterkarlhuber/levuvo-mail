// Server-side filter rules and vacation reply via ManageSieve (RFC 5804) and Sieve
// (RFC 5228 + fileinto, imap4flags, vacation, date). Rules run on the mail server,
// so they also work while Levuvo Mail is closed.
import net from 'node:net';
import tls from 'node:tls';
import {
  cleanVacationHtml,
  composeVacation,
  fromCidImages,
  mimeImageParts,
  textToHtml,
  toCidImages,
  vacationMime
} from './vacation.mjs';

export const SCRIPT_NAME = 'levuvo';
const MAX_RULES = 50;
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

// ---------------------------------------------------------------- ManageSieve client
function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export class ManageSieveClient {
  constructor({ host, port = 4190, user, password, timeout = 15000, servername }) {
    Object.assign(this, { host, port, user, password, timeout, servername: servername || host });
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
    this.capabilities = {};
  }

  _attach(socket) {
    this.socket = socket;
    socket.setTimeout(this.timeout, () => socket.destroy(new Error('timeout')));
    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this._pump();
    });
    socket.on('error', error => {
      this.error = error;
      this._pump();
    });
    socket.on('close', () => {
      this.closed = true;
      this._pump();
    });
  }
  _pump() {
    while (this.waiters.length) {
      const result = this._tryParse();
      if (!result) {
        if (this.error || this.closed) this.waiters.shift().reject(this.error || new Error('closed'));
        return;
      }
      this.waiters.shift().resolve(result);
    }
  }
  /** Parses one complete response: lines (with literals) up to OK/NO/BYE. */
  _tryParse() {
    const lines = [];
    let pos = 0;
    const buf = this.buffer;
    while (pos < buf.length) {
      const end = buf.indexOf('\r\n', pos);
      if (end < 0) return null;
      let line = buf.subarray(pos, end).toString('utf8');
      pos = end + 2;
      const literal = /\{(\d+)\+?\}$/.exec(line);
      if (literal) {
        const size = Number(literal[1]);
        if (buf.length < pos + size) return null;
        line = line.slice(0, literal.index) + JSON.stringify(buf.subarray(pos, pos + size).toString('utf8'));
        const after = buf.indexOf('\r\n', pos + size);
        if (after < 0) return null;
        line += buf.subarray(pos + size, after).toString('utf8');
        pos = after + 2;
      }
      if (/^(OK|NO|BYE)\b/i.test(line)) {
        this.buffer = buf.subarray(pos);
        return { status: line.slice(0, 3).trim().toUpperCase().replace(/\s/g, ''), text: line, lines };
      }
      lines.push(line);
    }
    return null;
  }
  _response() {
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this._pump();
    });
  }
  async command(text) {
    this.socket.write(`${text}\r\n`);
    const res = await this._response();
    if (res.status !== 'OK') {
      const message = /"([^"]*)"/.exec(res.text)?.[1] || res.text;
      throw Object.assign(fail(message, 'sieve_rejected', 422), { response: res.text });
    }
    return res;
  }
  _readCapabilities(res) {
    this.capabilities = {};
    for (const line of res.lines) {
      const m = /^"([^"]+)"(?:\s+"([^"]*)")?/.exec(line);
      if (m) this.capabilities[m[1].toUpperCase()] = m[2] ?? true;
    }
  }

  async connect() {
    const plain = net.connect({ host: this.host, port: this.port });
    await new Promise((resolve, reject) => {
      plain.once('connect', resolve);
      plain.once('error', reject);
    });
    this._attach(plain);
    this._readCapabilities(await this._response());
    if (!this.capabilities.STARTTLS)
      throw fail('Der Filterserver bietet keine verschlüsselte Verbindung an.', 'sieve_no_tls', 502);
    await this.command('STARTTLS');
    plain.removeAllListeners('data');
    const secure = tls.connect({
      socket: plain,
      servername: this.servername,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2'
    });
    await new Promise((resolve, reject) => {
      secure.once('secureConnect', resolve);
      secure.once('error', reject);
    });
    this.buffer = Buffer.alloc(0);
    this._attach(secure);
    this._readCapabilities(await this._response()); // capabilities are re-sent after TLS
    const auth = Buffer.from(`\0${this.user}\0${this.password}`).toString('base64');
    try {
      await this.command(`AUTHENTICATE "PLAIN" "${auth}"`);
    } catch {
      throw fail('Anmeldung am Filterserver fehlgeschlagen.', 'sieve_auth_failed', 401);
    }
    return this;
  }
  async listScripts() {
    const res = await this.command('LISTSCRIPTS');
    return res.lines
      .map(line => {
        const m = /^"((?:[^"\\]|\\.)*)"(\s+ACTIVE)?/i.exec(line);
        return m ? { name: m[1].replace(/\\(.)/g, '$1'), active: Boolean(m[2]) } : null;
      })
      .filter(Boolean);
  }
  async getScript(name) {
    const res = await this.command(`GETSCRIPT ${quote(name)}`);
    const first = res.lines[0] || '""';
    try {
      return JSON.parse(first);
    } catch {
      return '';
    }
  }
  async putScript(name, content) {
    const bytes = Buffer.byteLength(content, 'utf8');
    return this.command(`PUTSCRIPT ${quote(name)} {${bytes}+}\r\n${content}`);
  }
  async checkScript(content) {
    return this.command(`CHECKSCRIPT {${Buffer.byteLength(content, 'utf8')}+}\r\n${content}`);
  }
  /** RFC 5804 HAVESPACE: false only when the server says the script is too big or over quota. */
  async haveSpace(name, size) {
    try {
      await this.command(`HAVESPACE ${quote(name)} ${size}`);
      return true;
    } catch (err) {
      if (/\(QUOTA/i.test(err.response || '')) return false;
      return true; // servers without a working HAVESPACE: PUTSCRIPT reports it
    }
  }
  async setActive(name) {
    return this.command(`SETACTIVE ${quote(name)}`);
  }
  async logout() {
    try {
      this.socket.write('LOGOUT\r\n');
    } catch {
      /* ignore */
    }
    this.socket?.end();
  }
}

// ---------------------------------------------------------------- Rules model & script
const FIELDS = ['from', 'to', 'subject', 'any'];
const OPS = ['contains', 'is', 'not_contains'];
const ACTION_TYPES = ['move', 'markRead', 'flag', 'trash'];
const str = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max || /[\0\r]/.test(value))
    throw fail(`Ungültiger Wert: ${label}.`, 'sieve_invalid');
  return value;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateSieveConfig(input, { folderExists = () => true } = {}) {
  if (!input || typeof input !== 'object') throw fail('Ungültige Filterregeln.', 'sieve_invalid');
  const rules = Array.isArray(input.rules) ? input.rules : [];
  if (rules.length > MAX_RULES) throw fail(`Maximal ${MAX_RULES} Regeln.`, 'sieve_invalid');
  const cleanRules = rules.map((rule, index) => {
    const conditions = (Array.isArray(rule.conditions) ? rule.conditions : []).slice(0, 10).map(c => {
      if (!FIELDS.includes(c.field) || !OPS.includes(c.op)) throw fail('Ungültige Bedingung.', 'sieve_invalid');
      const value = str(c.value, 200, 'Bedingung').trim();
      if (!value) throw fail(`Regel ${index + 1}: Bedingung ohne Text.`, 'sieve_invalid');
      return { field: c.field, op: c.op, value };
    });
    const actions = (Array.isArray(rule.actions) ? rule.actions : []).slice(0, 5).map(a => {
      if (!ACTION_TYPES.includes(a.type)) throw fail('Ungültige Aktion.', 'sieve_invalid');
      if (a.type === 'move') {
        const folder = str(a.folder || '', 255, 'Ordner');
        if (!folder || !folderExists(folder)) throw fail(`Regel ${index + 1}: Zielordner fehlt.`, 'sieve_invalid');
        return { type: 'move', folder };
      }
      return { type: a.type };
    });
    if (!conditions.length || !actions.length)
      throw fail(`Regel ${index + 1}: Bedingung und Aktion erforderlich.`, 'sieve_invalid');
    return {
      name: str(rule.name || `Regel ${index + 1}`, 80, 'Name').trim() || `Regel ${index + 1}`,
      enabled: rule.enabled !== false,
      match: rule.match === 'any' ? 'any' : 'all',
      conditions,
      actions,
      stop: rule.stop !== false
    };
  });
  const v = input.vacation || {};
  // Formatted text (editor HTML); older clients send only plain `body`.
  const bodyHtml =
    typeof v.bodyHtml === 'string' ? cleanVacationHtml(v.bodyHtml) : textToHtml(str(v.body || '', 4000, 'Text'));
  const vacation = {
    enabled: v.enabled === true,
    subject: str(v.subject || '', 200, 'Betreff'),
    bodyHtml,
    includeSignature: v.includeSignature === true,
    days: Math.min(30, Math.max(1, Number.isInteger(v.days) ? v.days : 1)),
    start: v.start
      ? DATE.test(v.start)
        ? v.start
        : (() => {
            throw fail('Ungültiges Startdatum.', 'sieve_invalid');
          })()
      : '',
    end: v.end
      ? DATE.test(v.end)
        ? v.end
        : (() => {
            throw fail('Ungültiges Enddatum.', 'sieve_invalid');
          })()
      : '',
    addresses: (Array.isArray(v.addresses) ? v.addresses : [])
      .slice(0, 10)
      .map(a => str(a, 254, 'Adresse').toLowerCase())
  };
  if (vacation.enabled && !vacation.bodyHtml)
    throw fail('Bitte einen Text für die Abwesenheitsnotiz eingeben.', 'sieve_invalid');
  if (vacation.start && vacation.end && vacation.end < vacation.start)
    throw fail('Das Enddatum liegt vor dem Startdatum.', 'sieve_invalid');
  return { rules: cleanRules, vacation };
}

const sieveString = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
function condition(c) {
  const match = c.op === 'is' ? ':is' : ':contains';
  const neg = c.op === 'not_contains' ? 'not ' : '';
  const v = sieveString(c.value);
  switch (c.field) {
    case 'from':
      return `${neg}address :all ${match} "from" ${v}`;
    case 'to':
      return `${neg}address :all ${match} ["to", "cc"] ${v}`;
    case 'subject':
      return `${neg}header ${match} "subject" ${v}`;
    default:
      return `${neg}header ${match} ["from", "to", "cc", "subject"] ${v}`;
  }
}

/**
 * Generates the Sieve script. The JSON model is embedded so it can be edited again.
 * `format: 'html'` sends the reply as MIME (`vacation :mime`) with text and HTML versions and
 * the images inline; `'text'` is the fallback for servers without it. `signatureHtml` is the
 * account signature, appended when the reply asks for it.
 */
export function buildSieveScript(config, { trashFolder = '', signatureHtml = '', format = 'html' } = {}) {
  const v = config.vacation;
  let model = config;
  let reason = '';
  let mime = false;
  if (v.enabled) {
    const content = composeVacation(v, signatureHtml);
    if (format === 'html') {
      // Body images travel once, in the MIME part; the model refers to them by Content-ID.
      const body = toCidImages(v.bodyHtml, 'body');
      const sig = toCidImages(content.tail, 'sig');
      model = { ...config, vacation: { ...v, bodyHtml: body.html } };
      reason = vacationMime({ html: body.html + sig.html, text: content.text, parts: [...body.parts, ...sig.parts] });
      mime = true;
    } else reason = content.text;
  }
  const lines = [
    '# Levuvo Mail – automatisch erzeugt. Bitte in Levuvo Mail bearbeiten.',
    `# levuvo-rules: ${Buffer.from(JSON.stringify(model)).toString('base64')}`,
    'require ["fileinto", "imap4flags", "vacation", "date", "relational"];',
    ''
  ];
  if (v.enabled) {
    const tests = [];
    if (v.start) tests.push(`currentdate :value "ge" "date" ${sieveString(v.start)}`);
    if (v.end) tests.push(`currentdate :value "le" "date" ${sieveString(v.end)}`);
    const args = [`:days ${v.days}`];
    if (v.subject.trim()) args.push(`:subject ${sieveString(v.subject.trim())}`);
    if (v.addresses.length) args.push(`:addresses [${v.addresses.map(sieveString).join(', ')}]`);
    if (mime) args.push(':mime');
    const action = `vacation ${args.join(' ')} ${sieveString(reason)};`;
    lines.push('# Abwesenheitsnotiz');
    lines.push(tests.length ? `if allof (${tests.join(', ')}) {\n  ${action}\n}` : action, '');
  }
  for (const rule of config.rules) {
    if (!rule.enabled) continue;
    const test = rule.conditions.map(condition);
    const flags = rule.actions
      .filter(a => a.type === 'markRead' || a.type === 'flag')
      .map(a => `  addflag ${a.type === 'markRead' ? '"\\\\Seen"' : '"\\\\Flagged"'};`);
    const target =
      rule.actions.find(a => a.type === 'move')?.folder ||
      (rule.actions.some(a => a.type === 'trash') && trashFolder ? trashFolder : '');
    const body = [...flags];
    if (target) body.push(`  fileinto ${sieveString(target)};`);
    if (rule.stop) body.push('  stop;');
    lines.push(`# ${rule.name.replace(/[\r\n]/g, ' ')}`);
    lines.push(`if ${rule.match === 'any' ? 'anyof' : 'allof'} (${test.join(', ')}) {`, ...body, '}', '');
  }
  return `${lines
    .join('\r\n')
    .replace(/\n/g, '\r\n')
    .replace(/\r\r\n/g, '\r\n')}\r\n`;
}

export function parseLevuvoScript(script) {
  const m = /# levuvo-rules: ([A-Za-z0-9+/=]+)/.exec(String(script || ''));
  if (!m) return null;
  let config;
  try {
    config = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
  const v = config?.vacation;
  if (v && typeof v === 'object') {
    // Scripts from before 2.6 hold plain text only.
    if (typeof v.bodyHtml !== 'string') v.bodyHtml = textToHtml(v.body || '');
    delete v.body;
    v.includeSignature = v.includeSignature === true;
    v.bodyHtml = fromCidImages(v.bodyHtml, mimeImageParts(script));
  }
  return config;
}

/** Reads rules, vacation and whether a foreign script is active. */
export async function loadSieve(client) {
  const scripts = await client.listScripts();
  const active = scripts.find(s => s.active) || null;
  const own = scripts.find(s => s.name === SCRIPT_NAME);
  const config = own ? parseLevuvoScript(await client.getScript(SCRIPT_NAME)) : null;
  return {
    available: true,
    capabilities: (client.capabilities.SIEVE || '').split(/\s+/).filter(Boolean),
    config: config || {
      rules: [],
      vacation: {
        enabled: false,
        subject: '',
        bodyHtml: '',
        includeSignature: false,
        days: 1,
        start: '',
        end: '',
        addresses: []
      }
    },
    foreignActive: active && active.name !== SCRIPT_NAME ? active.name : null,
    active: active?.name === SCRIPT_NAME
  };
}

/**
 * Stores and activates the script. The formatted reply needs `vacation :mime`; a server that
 * rejects it gets the plain-text reply instead (`format: 'text'` in the result).
 */
export async function saveSieve(client, config, { trashFolder, replaceForeign = false, signatureHtml = '' }) {
  const scripts = await client.listScripts();
  const foreign = scripts.find(s => s.active && s.name !== SCRIPT_NAME);
  if (foreign && !replaceForeign) {
    throw fail(
      `Auf dem Server ist bereits das Filterskript „${foreign.name}“ aktiv. Ersetzen bestätigen, um Levuvo-Regeln zu aktivieren.`,
      'sieve_foreign_active',
      409
    );
  }
  let format = config.vacation.enabled ? 'html' : 'none';
  let script = buildSieveScript(config, { trashFolder, signatureHtml, format: 'html' });
  try {
    await client.checkScript(script);
  } catch (err) {
    if (format !== 'html') throw err;
    format = 'text';
    script = buildSieveScript(config, { trashFolder, signatureHtml, format: 'text' });
    await client.checkScript(script);
  }
  if (!(await client.haveSpace(SCRIPT_NAME, Buffer.byteLength(script, 'utf8'))))
    throw fail(
      'Die Abwesenheitsnotiz ist für deinen Mailserver zu groß. Bitte ein kleineres Logo verwenden oder die Signatur weglassen.',
      'sieve_too_large',
      413
    );
  await client.putScript(SCRIPT_NAME, script);
  await client.setActive(SCRIPT_NAME);
  return { ok: true, active: true, format };
}
