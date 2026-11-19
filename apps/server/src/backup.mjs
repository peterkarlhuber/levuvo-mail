// Backup and restore of everything Levuvo keeps on this device (settings, accounts without
// passwords, local calendar incl. attachments, local contacts, templates, snooze/follow-up data,
// own PGP/S/MIME keys, assistant settings and log). Also used to move to a new computer.
//
// The backup file is encrypted with a password chosen by the user (scrypt → AES-256-GCM): the
// keys of the local stores live in the OS keychain and do not travel with the file, so the
// backup carries the decrypted content, protected by that password instead.
//
// Never part of a backup: account passwords, OAuth tokens, CalDAV/CardDAV passwords and AI API
// keys (they stay in the keychain and are entered again after a move), the search index (rebuilt
// from the server) and the installation ID (a second device must not take over scheduled sends).
//
// Restoring never edits live data: the content is checked, re-encrypted with this device's keys
// and staged in `restore-pending/`. On the next start, before any store opens, the staged files
// replace the current ones; the current ones are kept in `before-restore/<time>/` first.
import { atomicWrite } from './local-store.mjs';
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip as gunzipCb, gzip as gzipCb } from 'node:zlib';

const scrypt = promisify(scryptCb);
const gzip = promisify(gzipCb);
const gunzip = promisify(gunzipCb);

export const BACKUP_FORMAT = 'levuvo-backup';
export const BACKUP_VERSION = 1;
export const MIN_PASSWORD = 12;
const MAX_PASSWORD = 1024;
export const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 };
// Upper bounds for values read from a file: a crafted header must not make scrypt run for minutes.
const KDF_LIMITS = { minN: 2 ** 14, maxN: 2 ** 20, maxR: 16, maxP: 4 };
export const MAX_BACKUP_BYTES = 160 * 1024 * 1024; // the encrypted file
const MAX_CONTENT_BYTES = 200 * 1024 * 1024; // all files together, decrypted
const PENDING_DIR = 'restore-pending';
const SAFETY_DIR = 'before-restore';
const SAFETY_STAMP = 'safety-copy.txt';
const KEEP_SAFETY_COPIES = 3;
const SAFETY_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const LOCAL = 'local';

/**
 * Shared spaces (spaces/store.mjs) are a folder of files that stay encrypted with the keychain
 * entry `spaces-key`; the member identity `spaces-identity` decrypts the space keys sent to this
 * device. The folder is copied as is, and both entries always travel and are set together.
 */
const SPACES_DIR = 'spaces';
const SPACES_SECRETS = ['spaces-key', 'spaces-identity'];
const STAGED_SECRET = name => `restore-pending-${name}`;
const PREVIOUS_SECRET = name => `${name}-before-restore`;
const STAGED_CRYPTO = name => `restore-pending-crypto-${name}`;
const SPACE_PATH = /^(?:[a-f0-9]{32}\.lvs|index\.lvs|blobs\/[a-f0-9]{16,64}\.\d{1,6})$/;
const MAX_SPACE_FILES = 50_000;

/**
 * Files in the data folder that a backup contains. `encrypted` names the keychain entry
 * (account `local`) whose key encrypts the file on disk; the backup holds the decrypted JSON.
 */
export const BACKUP_FILES = {
  'accounts.json': { kind: 'json' },
  'app-settings.json': { kind: 'json' },
  // Snoozed mails and follow-ups (subjects, sender addresses), encrypted like the other stores.
  'followups.json': { kind: 'json', encrypted: 'followups-key' },
  // Sender screening decisions (allowed / blocked addresses per account).
  'screening.json': { kind: 'json', encrypted: 'screening-key' },
  'templates.json': { kind: 'json' },
  'dav.json': { kind: 'json' },
  'cloud.json': { kind: 'json' },
  'crypto.json': { kind: 'json' },
  'calendar-local.json': { kind: 'json', encrypted: 'calendar-key' },
  'contacts-local.json': { kind: 'json', encrypted: 'contacts-key' },
  'tasks-local.json': { kind: 'json', encrypted: 'tasks-key' },
  'ai.json': { kind: 'json' },
  'ai-log.jsonl': { kind: 'jsonl' },
  // Own assistant routines. ai-semantic.json (index progress) stays out: vectors are rebuilt.
  'ai-skills.json': { kind: 'json' },
  // MCP settings and agents (token hashes only). mcp-approvals.json is short-lived and stays out.
  'mcp.json': { kind: 'json' }
};

/**
 * Local files that are deliberately not part of a backup, with the reason. Every data file the
 * app writes is either in BACKUP_FILES or here; a test checks this, so a new store cannot be
 * forgotten silently.
 */
export const NOT_BACKED_UP = {
  'instance.json': 'installation ID of this device',
  'ai-semantic.json': 'progress of the semantic index; vectors are rebuilt',
  'mcp-approvals.json': 'short-lived approvals that expire',
  // Levuvo Mail's own Ollama: models (gigabytes, pinned by digest, downloaded again from the fixed list)
  // and the key pair the server creates for itself.
  'ollama/': 'models of the own Ollama; downloaded again from the fixed model list',
  '*.lvdb': 'search index; rebuilt from the mailbox',
  '*.lvx': 'search index before 2.3; migrated and deleted'
};

const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });

function checkPassword(password) {
  if (typeof password !== 'string' || /\0/.test(password) || password.length > MAX_PASSWORD)
    throw fail('Ungültiges Passwort.', 'backup_password');
  if ([...password].length < MIN_PASSWORD)
    throw fail('Das Passwort braucht mindestens 12 Zeichen.', 'backup_password_short');
  return password;
}

async function deriveKey(password, salt, { N, r, p }) {
  return scrypt(password.normalize('NFC'), salt, 32, { N, r, p, maxmem: 256 * N * r + 32 * 1024 * 1024 });
}

/** The parts of the header that the authentication tag covers. */
const headerAad = h =>
  Buffer.from(
    JSON.stringify([h.format, h.version, h.createdAt, h.app, h.kdf.name, h.kdf.N, h.kdf.r, h.kdf.p, h.kdf.salt]),
    'utf8'
  );

function boxEncrypt(key, text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: body.toString('base64')
  });
}
function boxDecrypt(key, raw) {
  const box = JSON.parse(raw);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}
const isBox = raw => raw.trimStart().startsWith('{"v":1');

function vaultKey(vault, name) {
  if (!vault?.available) return null;
  const hex = vault.get(LOCAL, name);
  return /^[0-9a-f]{64}$/i.test(hex || '') ? Buffer.from(hex, 'hex') : null;
}

async function readIfExists(filename) {
  try {
    return await readFile(filename, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Where a backup file lives on disk (accounts.json may sit outside the data folder in tests). */
export const fileLocation = (dir, name, accountsPath) =>
  name === 'accounts.json' && accountsPath ? accountsPath : path.join(dir, name);

/** PGP fingerprints and S/MIME IDs of own keys, whose private part is in the keychain. */
function ownKeyNames(cryptoJson) {
  const names = [];
  for (const k of cryptoJson?.pgp?.own || [])
    if (/^[A-F0-9]{16,64}$/i.test(String(k?.fingerprint || ''))) names.push(`pgp:${k.fingerprint}`);
  for (const c of cryptoJson?.smime?.own || [])
    if (/^[A-Za-z0-9_-]{1,128}$/.test(String(c?.id || ''))) names.push(`smime:${c.id}`);
  return names;
}

// Stores whose file carries a format version: a backup from a newer Levuvo with a newer format
// would otherwise be restored and then fail (or be reset) at the next start (DB-LEV-005).
const FORMAT_CHECKS = {
  'accounts.json': v => v.version === 1 && Array.isArray(v.accounts),
  'dav.json': v => v.version === 1 && Array.isArray(v.accounts)
};
const versionParts = v =>
  String(v || '')
    .split(/[.-]/)
    .slice(0, 3)
    .map(x => Number.parseInt(x, 10) || 0);
/** True when `backupApp` is a newer Levuvo version than `ownApp` (major, minor, patch). */
export function newerApp(backupApp, ownApp) {
  const [a, b] = [versionParts(backupApp), versionParts(ownApp)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function parseJsonFile(name, text) {
  if (BACKUP_FILES[name].kind === 'jsonl') {
    for (const line of text.split('\n')) if (line.trim()) JSON.parse(line);
    return null;
  }
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('object expected');
  return value;
}

/** What a backup contains, for display before and after restoring. Counts only, no content. */
export function summarize(files, spaces = null) {
  const json = name => {
    try {
      return files[name] && BACKUP_FILES[name].kind === 'json' ? JSON.parse(files[name]) : null;
    } catch {
      return null;
    }
  };
  const count = value => (Array.isArray(value) ? value.length : 0);
  const crypto = json('crypto.json');
  const calendar = json('calendar-local.json');
  return {
    accounts: count(json('accounts.json')?.accounts),
    davAccounts: count(json('dav.json')?.accounts),
    calendars: count(calendar?.calendars),
    events: count(calendar?.objects),
    contacts: count(json('contacts-local.json')?.contacts),
    templates: count(json('templates.json')?.templates),
    snoozed: count(json('followups.json')?.snoozed),
    followups: count(json('followups.json')?.followups),
    ownKeys: count(crypto?.pgp?.own) + count(crypto?.smime?.own),
    settings: Boolean(files['app-settings.json']),
    assistant: Boolean(files['ai.json'] || files['ai-log.jsonl'] || files['mcp.json']),
    spaces: Object.keys(spaces || {}).filter(p => /^[a-f0-9]{32}\.lvs$/.test(p)).length
  };
}

/** Files of the spaces folder as relative path → base64, only names the spaces store writes. */
async function collectSpaces(dir) {
  const root = path.join(dir, SPACES_DIR);
  const out = {};
  const walk = async rel => {
    const entries = await readdir(path.join(root, rel), { withFileTypes: true }).catch(err => {
      if (err.code === 'ENOENT') return [];
      throw err;
    });
    for (const entry of entries) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory() && name === 'blobs') await walk(name);
      else if (entry.isFile() && SPACE_PATH.test(name)) {
        if (Object.keys(out).length >= MAX_SPACE_FILES)
          throw fail('Die Daten sind zu groß für eine Sicherung.', 'backup_too_large', 413);
        out[name] = (await readFile(path.join(root, name))).toString('base64');
      }
    }
  };
  await walk('');
  return out;
}

/** Collects the device data (decrypted) into a plain object. Fails instead of leaving data out. */
export async function collectBackupContent({ dir, accountsPath, vault }) {
  const files = {};
  let total = 0;
  for (const [name, spec] of Object.entries(BACKUP_FILES)) {
    const raw = await readIfExists(fileLocation(dir, name, accountsPath));
    if (raw === null || raw.trim() === '') continue;
    let text = raw;
    if (spec.encrypted && isBox(raw)) {
      const key = vaultKey(vault, spec.encrypted);
      try {
        if (!key) throw new TypeError('key missing');
        text = boxDecrypt(key, raw);
      } catch {
        throw fail(
          'Kalender, Kontakte oder Aufgaben auf diesem Gerät sind gesperrt (Schlüsselbund). Die Sicherung wäre unvollständig und wurde nicht erstellt.',
          'backup_locked',
          423
        );
      }
    }
    try {
      parseJsonFile(name, text);
    } catch {
      throw fail(
        'Eine Datei auf diesem Gerät ist beschädigt. Die Sicherung wurde nicht erstellt.',
        'backup_source_corrupt',
        422
      );
    }
    total += Buffer.byteLength(text);
    if (total > MAX_CONTENT_BYTES) throw fail('Die Daten sind zu groß für eine Sicherung.', 'backup_too_large', 413);
    files[name] = text;
  }
  const secrets = {};
  if (files['crypto.json']) {
    const names = ownKeyNames(JSON.parse(files['crypto.json']));
    if (names.length && !vault?.available)
      throw fail(
        'Der Schlüsselbund ist nicht verfügbar; die privaten Schlüssel könnten nicht gesichert werden.',
        'backup_locked',
        423
      );
    for (const name of names) {
      const value = vault.get('crypto', name);
      if (value) secrets[name] = value;
    }
  }
  const spaces = await collectSpaces(dir);
  for (const value of Object.values(spaces)) {
    total += value.length;
    if (total > MAX_CONTENT_BYTES) throw fail('Die Daten sind zu groß für eine Sicherung.', 'backup_too_large', 413);
  }
  const localSecrets = {};
  if (Object.keys(spaces).length) {
    for (const name of SPACES_SECRETS) {
      const value = vault?.available ? vault.get(LOCAL, name) : '';
      if (!value)
        throw fail(
          'Die Räume auf diesem Gerät sind gesperrt (Schlüsselbund). Die Sicherung wäre unvollständig und wurde nicht erstellt.',
          'backup_locked',
          423
        );
      localSecrets[name] = value;
    }
  }
  return { files, secrets, spaces, localSecrets };
}

/** Encrypts backup content with a password. Returns the file content (UTF-8 JSON text). */
export async function encryptBackup(content, password, { app = '', kdf = DEFAULT_KDF, now = new Date() } = {}) {
  checkPassword(password);
  const salt = randomBytes(16);
  const header = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    app: String(app),
    kdf: { name: 'scrypt', N: kdf.N, r: kdf.r, p: kdf.p, salt: salt.toString('base64') }
  };
  const key = await deriveKey(password, salt, kdf);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(headerAad(header));
  const plain = await gzip(
    Buffer.from(JSON.stringify({ ...content, summary: summarize(content.files, content.spaces) }), 'utf8')
  );
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return `${JSON.stringify({
    ...header,
    cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') },
    data: data.toString('base64')
  })}\n`;
}

/** Reads the unencrypted header (date and app version) without the password. */
export function readBackupHeader(text) {
  let doc;
  try {
    doc = JSON.parse(String(text));
  } catch {
    throw fail('Das ist keine Sicherung von Levuvo Mail.', 'backup_invalid');
  }
  if (doc?.format !== BACKUP_FORMAT) throw fail('Das ist keine Sicherung von Levuvo Mail.', 'backup_invalid');
  if (doc.version !== BACKUP_VERSION)
    throw fail(
      'Diese Sicherung stammt aus einer neueren Version von Levuvo Mail. Bitte zuerst aktualisieren.',
      'backup_version'
    );
  const kdf = doc.kdf || {};
  const N = Number(kdf.N);
  const r = Number(kdf.r);
  const p = Number(kdf.p);
  if (
    kdf.name !== 'scrypt' ||
    !Number.isInteger(N) ||
    N < KDF_LIMITS.minN ||
    N > KDF_LIMITS.maxN ||
    (N & (N - 1)) !== 0 ||
    !Number.isInteger(r) ||
    r < 1 ||
    r > KDF_LIMITS.maxR ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > KDF_LIMITS.maxP ||
    typeof kdf.salt !== 'string' ||
    doc.cipher?.name !== 'aes-256-gcm' ||
    typeof doc.cipher.iv !== 'string' ||
    typeof doc.cipher.tag !== 'string' ||
    typeof doc.data !== 'string' ||
    typeof doc.createdAt !== 'string'
  )
    throw fail('Die Sicherung ist beschädigt.', 'backup_invalid');
  return { doc, createdAt: doc.createdAt, app: String(doc.app || ''), kdf: { N, r, p } };
}

/** Decrypts and checks a backup file. Wrong password and tampering give the same answer. */
export async function decryptBackup(text, password, { ownApp = '' } = {}) {
  checkPassword(password);
  const { doc, kdf } = readBackupHeader(text);
  let plain;
  try {
    const key = await deriveKey(password, Buffer.from(doc.kdf.salt, 'base64'), kdf);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(doc.cipher.iv, 'base64'));
    decipher.setAAD(headerAad({ ...doc, kdf: { ...doc.kdf, N: kdf.N, r: kdf.r, p: kdf.p } }));
    decipher.setAuthTag(Buffer.from(doc.cipher.tag, 'base64'));
    plain = Buffer.concat([decipher.update(Buffer.from(doc.data, 'base64')), decipher.final()]);
  } catch {
    throw fail('Falsches Passwort oder beschädigte Sicherung.', 'backup_password_wrong', 422);
  }
  let content;
  try {
    const json = await gunzip(plain, { maxOutputLength: MAX_CONTENT_BYTES + 1024 * 1024 });
    content = JSON.parse(json.toString('utf8'));
  } catch {
    throw fail('Die Sicherung ist beschädigt.', 'backup_invalid');
  }
  if (ownApp && newerApp(doc.app, ownApp))
    throw fail(
      'Diese Sicherung stammt aus einer neueren Version von Levuvo Mail. Bitte zuerst aktualisieren.',
      'backup_version'
    );
  return validateContent(content, doc);
}

function validateContent(content, doc) {
  const files = {};
  const given = content?.files && typeof content.files === 'object' ? content.files : null;
  if (!given) throw fail('Die Sicherung ist beschädigt.', 'backup_invalid');
  for (const [name, text] of Object.entries(given)) {
    // Unknown names are ignored (a newer version may add files); never used as a path.
    if (!Object.hasOwn(BACKUP_FILES, name)) continue;
    if (typeof text !== 'string') throw fail('Die Sicherung ist beschädigt.', 'backup_invalid');
    let value;
    try {
      value = parseJsonFile(name, text);
    } catch {
      throw fail('Die Sicherung ist beschädigt.', 'backup_invalid');
    }
    if (FORMAT_CHECKS[name] && !FORMAT_CHECKS[name](value))
      throw fail(
        typeof value.version === 'number' && value.version > 1
          ? 'Diese Sicherung stammt aus einer neueren Version von Levuvo Mail. Bitte zuerst aktualisieren.'
          : 'Die Sicherung ist beschädigt.',
        typeof value.version === 'number' && value.version > 1 ? 'backup_version' : 'backup_invalid'
      );
    files[name] = text;
  }
  const allowed = new Set(files['crypto.json'] ? ownKeyNames(JSON.parse(files['crypto.json'])) : []);
  const secrets = {};
  for (const [name, value] of Object.entries(content.secrets || {}))
    if (allowed.has(name) && typeof value === 'string' && value.length <= 64 * 1024) secrets[name] = value;
  const uiPrefs =
    content.uiPrefs && typeof content.uiPrefs === 'object' && !Array.isArray(content.uiPrefs) ? content.uiPrefs : null;
  const spaces = {};
  const givenSpaces = content.spaces && typeof content.spaces === 'object' ? content.spaces : {};
  for (const [name, value] of Object.entries(givenSpaces)) {
    // Only the names the spaces store writes; anything else (e.g. "../x") is refused, never a path.
    if (!SPACE_PATH.test(name) || typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
      throw fail('Die Sicherung ist beschädigt.', 'backup_invalid');
    spaces[name] = value;
  }
  const localSecrets = {};
  if (Object.keys(spaces).length) {
    for (const name of SPACES_SECRETS) {
      const value = content.localSecrets?.[name];
      if (typeof value !== 'string' || !value || value.length > 64 * 1024)
        throw fail('Die Sicherung ist beschädigt.', 'backup_invalid');
      localSecrets[name] = value;
    }
    if (!/^[0-9a-f]{64}$/i.test(localSecrets['spaces-key']))
      throw fail('Die Sicherung ist beschädigt.', 'backup_invalid');
  }
  return {
    files,
    secrets,
    spaces,
    localSecrets,
    uiPrefs,
    createdAt: doc.createdAt,
    app: String(doc.app || ''),
    summary: summarize(files, spaces)
  };
}

const writePrivate = (filename, text) => atomicWrite(filename, text);

/** This device's key for a local store; created only where no encrypted file exists yet. */
async function deviceKey(vault, name, currentFile) {
  const existing = vaultKey(vault, name);
  if (existing) return existing;
  const raw = await readIfExists(currentFile);
  if (raw && isBox(raw))
    throw fail(
      'Der Schlüssel für Kalender, Kontakte oder Aufgaben fehlt im Schlüsselbund. Die Wiederherstellung wurde abgebrochen.',
      'backup_locked',
      423
    );
  const hex = randomBytes(32).toString('hex');
  vault.set(LOCAL, name, hex);
  return Buffer.from(hex, 'hex');
}

/**
 * Stages a decrypted backup for the next start. Calendar and contacts are encrypted again with
 * this device's keys; own private keys go straight into the keychain (never to disk).
 */
export async function stageRestore({ dir, accountsPath, vault, backup }) {
  if (!vault?.available)
    throw fail(
      'Der Schlüsselbund des Systems ist nicht verfügbar. Ohne ihn ist keine Wiederherstellung möglich.',
      'backup_locked',
      423
    );
  const pending = path.join(dir, PENDING_DIR);
  await rm(pending, { recursive: true, force: true });
  await mkdir(pending, { recursive: true, mode: 0o700 });
  const staged = [];
  for (const [name, spec] of Object.entries(BACKUP_FILES)) {
    const text = backup.files[name];
    if (text === undefined) continue;
    const out = spec.encrypted
      ? boxEncrypt(await deviceKey(vault, spec.encrypted, fileLocation(dir, name, accountsPath)), text)
      : text;
    await writePrivate(path.join(pending, name), out);
    staged.push(name);
  }
  // Private keys wait under a staging name too and replace the current ones only at the restart;
  // cancelling removes them again.
  const cryptoSecrets = Object.keys(backup.secrets);
  for (const [name, value] of Object.entries(backup.secrets)) vault.set(LOCAL, STAGED_CRYPTO(name), value);
  const spaces = Object.entries(backup.spaces || {});
  for (const [name, value] of spaces) {
    const target = path.join(pending, SPACES_DIR, ...name.split('/'));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, Buffer.from(value, 'base64'), { mode: 0o600 });
  }
  if (spaces.length) {
    // The spaces keys replace this device's ones only at the restart; until then they wait in the
    // keychain under a staging name (never on disk), so cancelling leaves the current spaces intact.
    await mkdir(path.join(pending, SPACES_DIR), { recursive: true, mode: 0o700 });
    for (const name of SPACES_SECRETS) vault.set(LOCAL, STAGED_SECRET(name), backup.localSecrets[name]);
    staged.push(SPACES_DIR);
  }
  // The manifest is written last: without it, a half-written staging folder is never applied.
  await writePrivate(
    path.join(pending, 'manifest.json'),
    JSON.stringify({
      version: 1,
      createdAt: backup.createdAt,
      stagedAt: new Date().toISOString(),
      files: staged,
      cryptoSecrets
    })
  );
  return { staged };
}

export async function pendingRestore(dir) {
  try {
    const manifest = JSON.parse(await readFile(path.join(dir, PENDING_DIR, 'manifest.json'), 'utf8'));
    return manifest?.version === 1 && Array.isArray(manifest.files) ? manifest : null;
  } catch {
    return null;
  }
}

export async function cancelRestore(dir, vault = null) {
  const manifest = await pendingRestore(dir);
  await rm(path.join(dir, PENDING_DIR), { recursive: true, force: true });
  for (const name of stagedCryptoNames(manifest)) {
    try {
      vault?.delete?.(LOCAL, STAGED_CRYPTO(name));
    } catch {
      /* best effort */
    }
  }
  for (const name of SPACES_SECRETS) {
    try {
      vault?.delete?.(LOCAL, STAGED_SECRET(name));
    } catch {
      /* best effort */
    }
  }
}

const stagedCryptoNames = manifest =>
  (Array.isArray(manifest?.cryptoSecrets) ? manifest.cryptoSecrets : []).filter(
    n => typeof n === 'string' && /^[\w.:-]{1,200}$/.test(n)
  );

/** Moves the staged private keys to their real keychain names (again safe after an interruption). */
function applyCryptoSecrets(vault, manifest) {
  if (!vault?.available) return;
  for (const name of stagedCryptoNames(manifest)) {
    const value = vault.get(LOCAL, STAGED_CRYPTO(name));
    if (!value) continue; // applied before an interruption
    vault.set('crypto', name, value);
    vault.delete?.(LOCAL, STAGED_CRYPTO(name));
  }
}

/** Replaces the spaces folder and, together with it, both spaces keychain entries. */
async function applySpaces({ dir, pending, safety, vault, staged }) {
  const target = path.join(dir, SPACES_DIR);
  const source = path.join(pending, SPACES_DIR);
  const hasStaged = staged && (await stat(source).catch(() => null));
  if (!staged || hasStaged) {
    // The backup replaces everything: spaces the backup does not have are set aside as well.
    await rename(target, path.join(safety, SPACES_DIR)).catch(err => {
      if (err.code !== 'ENOENT') throw err;
    });
    if (hasStaged) await rename(source, target);
  }
  if (!staged || !vault?.available) return;
  const next = SPACES_SECRETS.map(name => [name, vault.get(LOCAL, STAGED_SECRET(name))]);
  if (next.some(([, value]) => !value)) return; // already applied before an interruption
  for (const [name] of next) {
    // The set-aside copy stays readable with the previous keys.
    const previous = vault.get(LOCAL, name);
    if (previous) vault.set(LOCAL, PREVIOUS_SECRET(name), previous);
  }
  for (const [name, value] of next) vault.set(LOCAL, name, value);
  for (const [name] of next) vault.delete?.(LOCAL, STAGED_SECRET(name));
}

const accountIdentity = a =>
  JSON.stringify(
    ['user', 'smtpUser', 'imapHost', 'smtpHost', 'sieveHost', 'auth', 'oauthProvider'].map(k =>
      String(a?.[k] ?? '').toLowerCase()
    )
  );
const davIdentity = a => JSON.stringify([String(a?.serverUrl ?? ''), String(a?.username ?? '').toLowerCase()]);

function accountsOf(text) {
  try {
    const doc = JSON.parse(text);
    return Array.isArray(doc?.accounts) ? doc.accounts : [];
  } catch {
    return [];
  }
}

/** Search index files and key of accounts that are gone after a restore. */
export async function dropOrphanIndexes(dir, vault, before, after) {
  const keep = new Set(after.map(a => a?.id).filter(id => typeof id === 'string'));
  for (const old of before) {
    if (typeof old?.id !== 'string' || keep.has(old.id)) continue;
    const base = path.join(dir, 'index', old.id.replace(/[^a-z0-9-]/gi, ''));
    for (const suffix of ['.lvdb', '.lvdb-wal', '.lvdb-shm', '.lvdb-journal', '.lvx'])
      await rm(`${base}${suffix}`, { force: true }).catch(() => {});
    try {
      if (vault?.available) vault.delete?.(old.id, 'index-key');
    } catch {
      /* best effort */
    }
  }
}

/**
 * Passwords in the keychain belong to an account ID. When the restored file gives an ID to a
 * different mailbox (other server or login), the old password must not be sent to it.
 */
function dropStaleSecrets(vault, before, after, identity, kinds) {
  if (!vault?.available) return;
  const next = new Map(accountsOf(after).map(a => [a?.id, identity(a)]));
  for (const old of accountsOf(before)) {
    if (typeof old?.id !== 'string' || next.get(old.id) === identity(old)) continue;
    for (const kind of kinds) {
      try {
        vault.delete?.(old.id, kind);
      } catch {
        /* best effort */
      }
    }
  }
}

/**
 * Applies a staged restore. Runs at start-up before any store reads its file. Safe to run again
 * after an interruption: each staged file is moved only once, the manifest goes last.
 */
export async function applyPendingRestore({ dir, accountsPath, vault, logger = () => {}, now = new Date() }) {
  const manifest = await pendingRestore(dir);
  if (!manifest) return null;
  const pending = path.join(dir, PENDING_DIR);
  // A run that was interrupted continues in the same safety copy: one complete set of the data
  // from before the restore, and the "before" state of the accounts is read from there.
  const stampFile = path.join(pending, SAFETY_STAMP);
  const stamp = String((await readIfExists(stampFile)) || '').trim() || now.toISOString().replace(/[:.]/g, '-');
  if (!/^[0-9TZ-]{10,40}$/.test(stamp))
    throw Object.assign(new Error('Die Sicherung ist beschädigt.'), { code: 'backup_invalid' });
  await writeFile(stampFile, stamp, { mode: 0o600 });
  const safety = path.join(dir, SAFETY_DIR, stamp);
  await mkdir(safety, { recursive: true, mode: 0o700 });
  const staged = new Set(manifest.files.filter(name => Object.hasOwn(BACKUP_FILES, name)));
  const spacesStaged = manifest.files.includes(SPACES_DIR);
  const before = async (name, location) =>
    (await readIfExists(path.join(safety, name))) || (await readIfExists(location)) || '';
  const beforeAccounts = await before('accounts.json', fileLocation(dir, 'accounts.json', accountsPath));
  const beforeDav = await before('dav.json', path.join(dir, 'dav.json'));
  for (const name of Object.keys(BACKUP_FILES)) {
    const target = fileLocation(dir, name, accountsPath);
    const source = path.join(pending, name);
    const hasStaged = staged.has(name) && (await stat(source).catch(() => null));
    if (staged.has(name) && !hasStaged) continue; // already applied before an interruption
    // The backup replaces everything: a file the backup does not have is set aside as well.
    await rename(target, path.join(safety, name)).catch(err => {
      if (err.code !== 'ENOENT') throw err;
    });
    if (hasStaged) await rename(source, target);
  }
  await applySpaces({ dir, pending, safety, vault, staged: spacesStaged });
  applyCryptoSecrets(vault, manifest);
  dropStaleSecrets(
    vault,
    beforeAccounts,
    (await readIfExists(fileLocation(dir, 'accounts.json', accountsPath))) || '',
    accountIdentity,
    ['imap', 'smtp', 'oauth']
  );
  dropStaleSecrets(vault, beforeDav, (await readIfExists(path.join(dir, 'dav.json'))) || '', davIdentity, ['dav']);
  // The search index of an account that still exists stays: it is bound to the mailbox identity
  // and checks it on load. An account the backup does not have loses its index and index key,
  // like a removed account (otherwise readable personal data would stay without any way to delete it).
  await dropOrphanIndexes(
    dir,
    vault,
    accountsOf(beforeAccounts),
    accountsOf((await readIfExists(fileLocation(dir, 'accounts.json', accountsPath))) || '')
  );
  await rm(pending, { recursive: true, force: true });
  await pruneSafetyCopies(dir);
  logger(`restore applied (backup from ${manifest.createdAt}); previous data kept in ${SAFETY_DIR}/${stamp}`);
  return { createdAt: manifest.createdAt, files: [...staged], safetyCopy: path.join(SAFETY_DIR, stamp) };
}

/**
 * Safety copies are personal data outside the active stores: at most the last three restores,
 * and none older than 30 days (checked at every start, not only after a restore).
 */
export async function pruneSafetyCopies(dir, { now = Date.now() } = {}) {
  const root = path.join(dir, SAFETY_DIR);
  const entries = (await readdir(root).catch(() => [])).sort();
  const keep = new Set(entries.slice(Math.max(0, entries.length - KEEP_SAFETY_COPIES)));
  for (const name of entries) {
    const at = await stat(path.join(root, name))
      .then(st => st.mtimeMs)
      .catch(() => now);
    if (keep.has(name) && now - at < SAFETY_MAX_AGE_MS) continue;
    await rm(path.join(root, name), { recursive: true, force: true });
  }
}

/** File name for a new backup, e.g. levuvo-backup-2026-11-18.levuvo */
export const backupFilename = (now = new Date()) => `levuvo-backup-${now.toISOString().slice(0, 10)}.levuvo`;
