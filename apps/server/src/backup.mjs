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
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
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
const KEEP_SAFETY_COPIES = 3;
const LOCAL = 'local';

/**
 * Files in the data folder that a backup contains. `encrypted` names the keychain entry
 * (account `local`) whose key encrypts the file on disk; the backup holds the decrypted JSON.
 */
export const BACKUP_FILES = {
  'accounts.json': { kind: 'json' },
  'app-settings.json': { kind: 'json' },
  'followups.json': { kind: 'json' },
  'templates.json': { kind: 'json' },
  'dav.json': { kind: 'json' },
  'cloud.json': { kind: 'json' },
  'crypto.json': { kind: 'json' },
  'calendar-local.json': { kind: 'json', encrypted: 'calendar-key' },
  'contacts-local.json': { kind: 'json', encrypted: 'contacts-key' },
  'tasks-local.json': { kind: 'json', encrypted: 'tasks-key' },
  'ai.json': { kind: 'json' },
  'ai-log.jsonl': { kind: 'jsonl' },
  // MCP settings and agents (token hashes only). mcp-approvals.json is short-lived and stays out.
  'mcp.json': { kind: 'json' }
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
export function summarize(files) {
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
    assistant: Boolean(files['ai.json'] || files['ai-log.jsonl'] || files['mcp.json'])
  };
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
  return { files, secrets };
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
  const plain = await gzip(Buffer.from(JSON.stringify({ ...content, summary: summarize(content.files) }), 'utf8'));
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
    throw fail('Das ist keine Levuvo-Sicherung.', 'backup_invalid');
  }
  if (doc?.format !== BACKUP_FORMAT) throw fail('Das ist keine Levuvo-Sicherung.', 'backup_invalid');
  if (doc.version !== BACKUP_VERSION)
    throw fail(
      'Diese Sicherung stammt aus einer neueren Version von Levuvo. Bitte zuerst aktualisieren.',
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
export async function decryptBackup(text, password) {
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
    try {
      parseJsonFile(name, text);
    } catch {
      throw fail('Die Sicherung ist beschädigt.', 'backup_invalid');
    }
    files[name] = text;
  }
  const allowed = new Set(files['crypto.json'] ? ownKeyNames(JSON.parse(files['crypto.json'])) : []);
  const secrets = {};
  for (const [name, value] of Object.entries(content.secrets || {}))
    if (allowed.has(name) && typeof value === 'string' && value.length <= 64 * 1024) secrets[name] = value;
  const uiPrefs =
    content.uiPrefs && typeof content.uiPrefs === 'object' && !Array.isArray(content.uiPrefs) ? content.uiPrefs : null;
  return { files, secrets, uiPrefs, createdAt: doc.createdAt, app: String(doc.app || ''), summary: summarize(files) };
}

async function writePrivate(filename, text) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const tmp = `${filename}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, text, { mode: 0o600 });
    await rename(tmp, filename);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

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
  for (const [name, value] of Object.entries(backup.secrets)) vault.set('crypto', name, value);
  // The manifest is written last: without it, a half-written staging folder is never applied.
  await writePrivate(
    path.join(pending, 'manifest.json'),
    JSON.stringify({ version: 1, createdAt: backup.createdAt, stagedAt: new Date().toISOString(), files: staged })
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

export async function cancelRestore(dir) {
  await rm(path.join(dir, PENDING_DIR), { recursive: true, force: true });
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
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const safety = path.join(dir, SAFETY_DIR, stamp);
  await mkdir(safety, { recursive: true, mode: 0o700 });
  const staged = new Set(manifest.files.filter(name => Object.hasOwn(BACKUP_FILES, name)));
  const beforeAccounts = (await readIfExists(fileLocation(dir, 'accounts.json', accountsPath))) || '';
  const beforeDav = (await readIfExists(path.join(dir, 'dav.json'))) || '';
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
  dropStaleSecrets(
    vault,
    beforeAccounts,
    (await readIfExists(fileLocation(dir, 'accounts.json', accountsPath))) || '',
    accountIdentity,
    ['imap', 'smtp', 'oauth']
  );
  dropStaleSecrets(vault, beforeDav, (await readIfExists(path.join(dir, 'dav.json'))) || '', davIdentity, ['dav']);
  // The search index stays: it is bound to the mailbox identity and checks it on load.
  await rm(pending, { recursive: true, force: true });
  await pruneSafetyCopies(dir);
  logger(`restore applied (backup from ${manifest.createdAt}); previous data kept in ${SAFETY_DIR}/${stamp}`);
  return { createdAt: manifest.createdAt, files: [...staged], safetyCopy: path.join(SAFETY_DIR, stamp) };
}

async function pruneSafetyCopies(dir) {
  const root = path.join(dir, SAFETY_DIR);
  const entries = (await readdir(root).catch(() => [])).sort();
  for (const old of entries.slice(0, Math.max(0, entries.length - KEEP_SAFETY_COPIES)))
    await rm(path.join(root, old), { recursive: true, force: true });
}

/** File name for a new backup, e.g. levuvo-backup-2026-11-18.levuvo */
export const backupFilename = (now = new Date()) => `levuvo-backup-${now.toISOString().slice(0, 10)}.levuvo`;
