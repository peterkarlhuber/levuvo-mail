// Account metadata is kept in a private local file; secrets ONLY reside in the
// operating system credential vault. There is no plaintext fallback.
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { buildAccounts } from './accounts.mjs';
import { mailConfig } from './config.mjs';
import { smtpConfig, isEmail } from './send-utils.mjs';
import { sanitizeOutgoingHtml } from './html-mail.mjs';

const SERVICE = 'at.levuvo.mail';
const MAX_ACCOUNTS = 5;
const VALID_ID = /^(?:primary|account[2-5]|managed-[a-f0-9]{12})$/;

export function settingsPath(env = process.env, home = os.homedir(), platform = process.platform) {
  const base =
    platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : platform === 'win32'
        ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
        : env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'Levuvo Mail', 'accounts.json');
}

export async function openSystemVault(importer = () => import('@napi-rs/keyring')) {
  try {
    const { Entry } = await importer();
    // Fail closed if the module is unavailable; never write secrets to JSON.
    return {
      available: true,
      get: (id, kind) => {
        try {
          return new Entry(SERVICE, `${id}:${kind}`).getPassword() || '';
        } catch (err) {
          if (/no entry|not found|not exist|notfound|no such|item not found/i.test(String(err?.message))) return '';
          throw err;
        }
      },
      set: (id, kind, value) => new Entry(SERVICE, `${id}:${kind}`).setPassword(value),
      delete: (id, kind) => {
        try {
          return new Entry(SERVICE, `${id}:${kind}`).deletePassword();
        } catch (err) {
          if (!/no entry|not found|not exist|notfound|no such|item not found/i.test(String(err?.message))) throw err;
        }
      }
    };
  } catch {
    return { available: false };
  }
}

function invalid(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
function string(value, max = 160) {
  if (typeof value !== 'string' || value.length > max || /[\0\r]/.test(value)) invalid('Ungültiger Textwert.');
  return value.trim();
}
function boundedPort(value, allowed) {
  const port = Number(value);
  if (!Number.isInteger(port) || !allowed.includes(port)) invalid('Ungültiger Mail-Port.');
  return port;
}
function host(value) {
  const valueClean = string(value, 253);
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(valueClean) || valueClean.includes('..'))
    invalid('Ungültiger Servername.');
  return valueClean;
}
function folder(value) {
  const v = string(value || '', 240);
  if (/\n|[\x01-\x1f\x7f]/.test(v)) invalid('Ungültiger Ordnerpfad.');
  return v;
}
function signatureHtml(value) {
  if (typeof value !== 'string') invalid('Ungültige Signatur.');
  if (value.length > 300 * 1024) invalid('Die Signatur ist zu groß (max. 300 KB inkl. Bilder).');
  return value.trim() ? sanitizeOutgoingHtml(value) : '';
}
/** Additional sender addresses (aliases) of the same mailbox. */
function identities(list, user) {
  if (!Array.isArray(list) || list.length > 10) invalid('Maximal zehn Absenderadressen.');
  const seen = new Set([user]);
  return list
    .map(item => {
      if (!item || typeof item !== 'object') invalid('Ungültige Absenderadresse.');
      const email = string(item.email ?? '', 254).toLowerCase();
      if (!isEmail(email)) invalid(`Ungültige Absenderadresse: ${email || '–'}`);
      if (seen.has(email)) return null;
      seen.add(email);
      return { email, name: string(item.name ?? '', 120), signatureHtml: signatureHtml(item.signatureHtml ?? '') };
    })
    .filter(Boolean);
}

export function normalizeAccount(input, current = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Ungültige Kontodaten.');
  const user = string(input.user ?? current.user ?? '', 254).toLowerCase();
  if (!isEmail(user)) invalid('Bitte eine gültige E-Mail-Adresse eingeben.');
  const smtpUser = string(input.smtpUser || current.smtpUser || user, 254).toLowerCase();
  if (!isEmail(smtpUser)) invalid('Ungültiger SMTP-Benutzername.');
  const entry = {
    id: current.id || '',
    label: string(input.label ?? current.label ?? user, 80) || user,
    user,
    smtpUser,
    imapHost: host(input.imapHost ?? current.imapHost ?? ''),
    imapPort: boundedPort(input.imapPort ?? current.imapPort ?? 993, [993]),
    smtpHost: host(input.smtpHost ?? current.smtpHost ?? ''),
    smtpPort: boundedPort(input.smtpPort ?? current.smtpPort ?? 587, [465, 587]),
    sentFolder: folder(input.sentFolder ?? current.sentFolder ?? ''),
    draftsFolder: folder(input.draftsFolder ?? current.draftsFolder ?? ''),
    signature: string(input.signature ?? current.signature ?? '', 2000),
    signatureHtml: signatureHtml(input.signatureHtml ?? current.signatureHtml ?? ''),
    displayName: string(input.displayName ?? current.displayName ?? '', 120),
    identities: identities(input.identities ?? current.identities ?? [], user),
    sieveHost: (input.sieveHost ?? current.sieveHost) ? host(input.sieveHost ?? current.sieveHost) : '',
    sievePort: boundedPort(input.sievePort ?? current.sievePort ?? 4190, [4190, 2000]),
    auth: (input.auth ?? current.auth) === 'oauth2' ? 'oauth2' : 'password',
    oauthProvider: ['microsoft', 'google'].includes(input.oauthProvider ?? current.oauthProvider)
      ? (input.oauthProvider ?? current.oauthProvider)
      : ''
  };
  return entry;
}
function validateSecret(value, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024 || /\0/.test(value))
    invalid('Passwort fehlt oder ist ungültig.');
  return value;
}
function envForLegacy(env, registry) {
  const masked = { ...env };
  for (const item of registry) {
    if (item.id === 'primary') {
      masked.IMAP_USER = '';
      masked.IMAP_PASSWORD = '';
      masked.SMTP_USER = '';
      masked.SMTP_PASSWORD = '';
    }
    const match = /^account([2-5])$/.exec(item.id);
    if (match) {
      masked[`MAIL_ACCOUNT_${match[1]}_USER`] = '';
      masked[`MAIL_ACCOUNT_${match[1]}_PASSWORD`] = '';
    }
  }
  return masked;
}
export function metadataForPublic(item) {
  const { id, label, user, smtpUser, imapHost, imapPort, smtpHost, smtpPort, sentFolder, draftsFolder, signature } =
    item;
  return {
    signatureHtml: item.signatureHtml || '',
    displayName: item.displayName || '',
    identities: item.identities || [],
    sieveHost: item.sieveHost || '',
    sievePort: item.sievePort || 4190,
    auth: item.auth || 'password',
    oauthProvider: item.oauthProvider || '',
    id,
    label,
    user,
    smtpUser,
    imapHost,
    imapPort,
    smtpHost,
    smtpPort,
    sentFolder,
    draftsFolder,
    signature,
    managed: true
  };
}

function configFor(item, imapPassword, smtpPassword) {
  return {
    imap: { host: item.imapHost, port: item.imapPort, user: item.user, password: imapPassword },
    smtp: { host: item.smtpHost, port: item.smtpPort, user: item.smtpUser, password: smtpPassword || imapPassword }
  };
}
const CONNECTION_FIELDS = ['user', 'smtpUser', 'imapHost', 'imapPort', 'smtpHost', 'smtpPort'];

export async function createAccountManager({
  env = process.env,
  filename = settingsPath(env),
  vault = null,
  verify = null
} = {}) {
  const store = vault || (await openSystemVault());
  let managed = [];
  try {
    const document = JSON.parse(await readFile(filename, 'utf8'));
    if (document.version !== 1 || !Array.isArray(document.accounts) || document.accounts.length > MAX_ACCOUNTS)
      invalid('Lokale Kontodatei ist ungültig.', 500);
    managed = document.accounts.map(item => {
      if (!VALID_ID.test(item.id)) invalid('Ungültige gespeicherte Konto-ID.', 500);
      return normalizeAccount(item, { id: item.id });
    });
    if (new Set(managed.map(x => x.id)).size !== managed.length) invalid('Doppelte gespeicherte Konto-ID.', 500);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  async function persist(next) {
    await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const data = JSON.stringify({ version: 1, accounts: next }, null, 2) + '\n';
    const tmp = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(tmp, data, { flag: 'wx', mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, filename);
    } catch (err) {
      const { unlink } = await import('node:fs/promises');
      try {
        await unlink(tmp);
      } catch {}
      throw err;
    }
    managed = next;
  }
  function requireVault() {
    if (!store.available)
      invalid(
        'Der Schlüsselbund des Betriebssystems ist nicht verfügbar. Bitte entsperren und Levuvo Mail neu starten.',
        503
      );
  }
  // Login test before anything is stored. Network problems may be overridden by an
  // explicit user choice (allowUnverified); wrong passwords or TLS errors never.
  async function check(item, imapPassword, smtpPassword, allowUnverified) {
    if (!verify) return true;
    try {
      await verify(configFor(item, imapPassword, smtpPassword));
      return true;
    } catch (err) {
      if (allowUnverified === true && err.retryable === true) return false;
      throw err;
    }
  }
  function getSecret(id, kind) {
    if (!store.available) return '';
    try {
      return store.get(id, kind) || '';
    } catch {
      return '';
    }
  }
  function setSecret(id, kind, value) {
    requireVault();
    store.set(id, kind, value);
  }
  function getCredentials(item) {
    if (!store.available) return { imapPassword: '', smtpPassword: '' };
    try {
      return { imapPassword: store.get(item.id, 'imap'), smtpPassword: store.get(item.id, 'smtp') };
    } catch {
      return { imapPassword: '', smtpPassword: '' };
    } // Locked OS vault: never fall back to plaintext.
  }
  function all() {
    const legacy = buildAccounts(envForLegacy(env, managed));
    const ids = new Set(managed.map(m => m.id));
    const results = legacy.filter(a => a.imap.configured && !ids.has(a.id));
    for (const m of managed) {
      const { imapPassword, smtpPassword } = getCredentials(m);
      const values = {
        IMAP_HOST: m.imapHost,
        IMAP_PORT: String(m.imapPort),
        IMAP_USER: m.user,
        IMAP_PASSWORD: imapPassword,
        SMTP_HOST: m.smtpHost,
        SMTP_PORT: String(m.smtpPort),
        SMTP_USER: m.smtpUser,
        SMTP_PASSWORD: smtpPassword || imapPassword,
        ENABLE_SEND: env.ENABLE_SEND
      };
      const imap = mailConfig(values);
      const smtp = smtpConfig(values);
      if (m.auth === 'oauth2') {
        // OAuth accounts carry no password; access tokens are minted per connection.
        const hasToken = Boolean(getSecret(m.id, 'oauth'));
        Object.assign(imap, { password: '', configured: hasToken, oauth: m.oauthProvider });
        Object.assign(smtp, {
          password: '',
          configured: hasToken && [465, 587].includes(smtp.port),
          oauth: m.oauthProvider
        });
      }
      results.push({
        id: m.id,
        label: m.label,
        imap,
        smtp,
        sentFolder: m.sentFolder,
        draftsFolder: m.draftsFolder,
        signature: m.signature,
        signatureHtml: m.signatureHtml || '',
        displayName: m.displayName || '',
        identities: m.identities || [],
        sieve: { host: m.sieveHost || m.imapHost, port: m.sievePort || 4190 },
        auth: m.auth || 'password',
        managed: true
      });
    }
    results.sort((a, b) =>
      a.id === 'primary'
        ? -1
        : b.id === 'primary'
          ? 1
          : (a.id.startsWith('account') ? 0 : 1) - (b.id.startsWith('account') ? 0 : 1)
    );
    if (results.length > MAX_ACCOUNTS) invalid('Maximal fünf Konten erlaubt.', 409);
    if (
      new Set(results.filter(a => a.imap.configured).map(a => a.imap.user.toLowerCase())).size !==
      results.filter(a => a.imap.configured).length
    )
      invalid('Doppelte Postfachadresse.', 409);
    return results;
  }
  function listManagement() {
    const stored = new Map(managed.map(m => [m.id, m]));
    return all().map(a =>
      stored.has(a.id)
        ? metadataForPublic(stored.get(a.id))
        : { id: a.id, label: a.label, user: a.imap.user, managed: false, configured: a.imap.configured }
    );
  }
  async function create(input) {
    requireVault();
    if (all().length >= MAX_ACCOUNTS) invalid('Maximal fünf Konten erlaubt.', 409);
    const item = normalizeAccount(input);
    if (all().some(a => a.imap.user.toLowerCase() === item.user))
      invalid('Dieses Postfach ist bereits eingerichtet.', 409);
    const password = validateSecret(input.password);
    const smtpPassword = validateSecret(input.smtpPassword, true) || password;
    const verified = await check(item, password, smtpPassword, input.allowUnverified);
    item.id = `managed-${randomBytes(6).toString('hex')}`;
    store.set(item.id, 'imap', password);
    try {
      store.set(item.id, 'smtp', smtpPassword);
      await persist([...managed, item]);
    } catch (err) {
      try {
        store.delete(item.id, 'imap');
        store.delete(item.id, 'smtp');
      } catch {}
      throw err;
    }
    return { ...metadataForPublic(item), verified };
  }
  async function update(id, input) {
    requireVault();
    const prior = managed.find(a => a.id === id);
    if (!prior) invalid('Dieses Konto ist nicht über die Oberfläche verwaltet.', 404);
    const next = normalizeAccount(input, prior);
    if (all().some(a => a.id !== id && a.imap.user.toLowerCase() === next.user))
      invalid('E-Mail-Adresse wird bereits verwendet.', 409);
    const updated = managed.map(a => (a.id === id ? next : a));
    const previous = getCredentials(prior);
    const nextImap = input.password ? validateSecret(input.password) : previous.imapPassword;
    const nextSmtp = input.smtpPassword
      ? validateSecret(input.smtpPassword)
      : input.password && previous.smtpPassword === previous.imapPassword
        ? nextImap
        : previous.smtpPassword;
    const connectionChanged =
      prior.auth !== 'oauth2' &&
      (Boolean(input.password || input.smtpPassword) || CONNECTION_FIELDS.some(field => next[field] !== prior[field]));
    const verified = connectionChanged ? await check(next, nextImap, nextSmtp, input.allowUnverified) : true;
    const changes = [];
    if (input.password) changes.push(['imap', validateSecret(input.password), previous.imapPassword]);
    if (input.smtpPassword) changes.push(['smtp', validateSecret(input.smtpPassword), previous.smtpPassword]);
    else if (input.password && previous.smtpPassword === previous.imapPassword) {
      // One shared Hetzner login: rotate both saved copies together.
      changes.push(['smtp', validateSecret(input.password), previous.smtpPassword]);
    }
    try {
      for (const [kind, secret] of changes) store.set(id, kind, secret);
      await persist(updated);
    } catch (err) {
      for (const [kind, , old] of changes)
        try {
          if (old) store.set(id, kind, old);
          else store.delete(id, kind);
        } catch {}
      throw err;
    }
    return { ...metadataForPublic(next), verified };
  }
  /** Account signed in with OAuth2 (Microsoft 365 / Google). Only the refresh token is stored. */
  async function createOAuth({ provider, email, refreshToken, label, imapHost, smtpHost, smtpPort, verifyToken }) {
    requireVault();
    if (all().length >= MAX_ACCOUNTS) invalid('Maximal fünf Konten erlaubt.', 409);
    const item = normalizeAccount({
      label: label || email,
      user: email,
      imapHost,
      smtpHost,
      smtpPort,
      auth: 'oauth2',
      oauthProvider: provider
    });
    if (all().some(a => a.imap.user.toLowerCase() === item.user))
      invalid('Dieses Postfach ist bereits eingerichtet.', 409);
    if (typeof refreshToken !== 'string' || refreshToken.length < 10 || refreshToken.length > 8192)
      invalid('Anmeldung unvollständig.');
    if (verifyToken) await verifyToken(item);
    item.id = `managed-${randomBytes(6).toString('hex')}`;
    store.set(item.id, 'oauth', refreshToken);
    try {
      await persist([...managed, item]);
    } catch (err) {
      try {
        store.delete(item.id, 'oauth');
      } catch {}
      throw err;
    }
    return { ...metadataForPublic(item), verified: true };
  }
  // "Verbindung testen" in the form: tests the entered values without saving them.
  async function verifyInput(input) {
    if (!verify) invalid('Verbindungstest ist nicht verfügbar.', 503);
    const prior = input?.id ? managed.find(a => a.id === input.id) : null;
    if (input?.id && !prior) invalid('Konto nicht gefunden.', 404);
    const item = normalizeAccount(input, prior || {});
    const previous = prior ? getCredentials(prior) : { imapPassword: '', smtpPassword: '' };
    const imapPassword = input.password ? validateSecret(input.password) : previous.imapPassword;
    if (!imapPassword) invalid('Bitte ein Passwort eingeben.');
    const smtpPassword = input.smtpPassword
      ? validateSecret(input.smtpPassword)
      : input.password
        ? imapPassword
        : previous.smtpPassword || imapPassword;
    await verify(configFor(item, imapPassword, smtpPassword));
    return { ok: true };
  }
  async function adopt(id) {
    requireVault();
    if (managed.some(item => item.id === id)) invalid('Bereits in den Schlüsselbund übernommen.', 409);
    const account = all().find(item => item.id === id);
    if (!account || !account.imap.configured || !account.smtp.configured)
      invalid('Dieses Konto ist nicht vollständig konfiguriert.', 412);
    const item = normalizeAccount(
      {
        label: account.label,
        user: account.imap.user,
        smtpUser: account.smtp.user,
        imapHost: account.imap.host,
        imapPort: account.imap.port,
        smtpHost: account.smtp.host,
        smtpPort: account.smtp.port,
        sentFolder: account.sentFolder,
        draftsFolder: account.draftsFolder,
        signature: account.signature
      },
      { id }
    );
    store.set(id, 'imap', account.imap.password);
    try {
      store.set(id, 'smtp', account.smtp.password);
      await persist([...managed, item]);
    } catch (err) {
      try {
        store.delete(id, 'imap');
        store.delete(id, 'smtp');
      } catch {}
      throw err;
    }
    return metadataForPublic(item);
  }
  async function remove(id) {
    requireVault();
    const item = managed.find(m => m.id === id);
    if (!item) invalid('Dieses Konto ist nicht über die Oberfläche verwaltet.', 404);
    // The underlying mailbox and messages are NEVER deleted.
    await persist(managed.filter(a => a.id !== id));
    let cleanupFailed = false;
    for (const kind of ['imap', 'smtp', 'oauth', 'index-key'])
      try {
        store.delete(id, kind);
      } catch {
        cleanupFailed = true;
      }
    return { removed: true, cleanupFailed };
  }
  return {
    all,
    listManagement,
    create,
    update,
    adopt,
    remove,
    verifyInput,
    createOAuth,
    getSecret,
    setSecret,
    get vaultAvailable() {
      return Boolean(store.available);
    },
    metadataFile: filename
  };
}
