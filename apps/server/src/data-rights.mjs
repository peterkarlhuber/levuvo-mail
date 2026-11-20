// Data subject rights on this device (GDPR Art. 15, 17, 20) and secure removal of all data and
// settings (CRA Annex I Part I (2)(m)).
//
// Export: a readable JSON copy of the data that exists only on this device – the same files a
// backup contains, decrypted, without any secret (no private keys, no passwords, no tokens).
//
// Delete all: removing files while the stores are open would let them write their state back, so
// deletion is staged like a restore: a marker file is written, the app restarts, and before any
// store opens `applyPendingWipe` removes every Levuvo file in the data folder and every keychain
// entry of Levuvo Mail. The browser storage of the window (view preferences) is cleared by the
// web app and the desktop shell.
import { readdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BACKUP_FILES, NOT_BACKED_UP, collectBackupContent } from './backup.mjs';

export const EXPORT_FORMAT = 'levuvo-data-export';
export const WIPE_MARKER = 'wipe-pending.json';

/**
 * Everything Levuvo Mail itself writes into the data folder: the files of BACKUP_FILES and
 * NOT_BACKED_UP plus these folders. The data folder is also Electron's userData folder, so
 * nothing else in it (Chromium's caches and storage) is removed by name.
 */
export const LEVUVO_DIRS = ['index/', 'spaces/', 'ollama/', 'before-restore/', 'restore-pending/'];
// Leftover siblings of known files: interrupted atomic writes (`<file>.<12 hex>.tmp`, see
// local-store.mjs), older `.tmp`/`.bak` names and damaged files set aside as `<file>.corrupt-<time>`
// (app.mjs, local-calendar.mjs). They can hold a full plain copy of the data (F-GOV-002).
const LEFTOVER = [/\.[a-f0-9]{12}\.tmp$/, /\.(tmp|bak)(-[\w-]+)?$/, /\.corrupt-[\w-]+$/];

/** Names (and folder names with a trailing slash) in the data folder that belong to Levuvo. */
export function levuvoEntries(names) {
  const known = new Set([...Object.keys(BACKUP_FILES), ...Object.keys(NOT_BACKED_UP), ...LEVUVO_DIRS, WIPE_MARKER]);
  const patterns = [...known].filter(k => k.startsWith('*.')).map(k => k.slice(1));
  return names.filter(({ name, dir }) => {
    const key = dir ? `${name}/` : name;
    if (known.has(key)) return true;
    if (!dir && patterns.some(ext => name.endsWith(ext))) return true;
    if (dir) return false;
    return LEFTOVER.some(re => {
      const base = name.replace(re, '');
      return base !== name && (known.has(base) || patterns.some(ext => base.endsWith(ext)));
    });
  });
}

/** Readable export of the device-local data. */
export async function buildExport({ dir, accountsPath, vault, app, now = new Date() }) {
  const content = await collectBackupContent({ dir, accountsPath, vault });
  const files = {};
  for (const [name, text] of Object.entries(content.files)) {
    if (BACKUP_FILES[name]?.kind === 'jsonl')
      files[name] = text
        .split('\n')
        .filter(l => l.trim())
        .map(l => JSON.parse(l));
    else files[name] = JSON.parse(text);
  }
  return {
    format: EXPORT_FORMAT,
    version: 1,
    app,
    createdAt: now.toISOString(),
    note: "Readable copy of the data Levuvo Mail keeps only on this device (GDPR Art. 15/20). Mails, events and contacts on your providers' servers are not included; export them there or with vCard/ICS/.eml export. Private keys, passwords and sign-in tokens are never exported. Shared spaces are stored end-to-end encrypted and are listed by count only; export their content in Spaces. This file is NOT encrypted: store it carefully and delete it when no longer needed.",
    files,
    spaces: { encryptedFiles: Object.keys(content.spaces || {}).length }
  };
}

export const exportFilename = (now = new Date()) => `levuvo-mail-data-${now.toISOString().slice(0, 10)}.json`;

export async function stageWipe(dir, now = new Date()) {
  await writeFile(path.join(dir, WIPE_MARKER), `${JSON.stringify({ requestedAt: now.toISOString() })}\n`, {
    mode: 0o600
  });
}

export async function pendingWipe(dir) {
  try {
    return JSON.parse(await readFile(path.join(dir, WIPE_MARKER), 'utf8'));
  } catch {
    return null;
  }
}

export async function cancelWipe(dir) {
  await rm(path.join(dir, WIPE_MARKER), { force: true });
}

/**
 * Runs at start before any store opens. Removes every keychain entry of Levuvo Mail and every
 * Levuvo file in the data folder (the marker last, so an interrupted wipe is repeated).
 * Returns null when nothing was staged, otherwise what was removed.
 */
export async function applyPendingWipe({ dir, accountsPath, vault, logger = () => {} }) {
  if (!(await pendingWipe(dir))) return null;
  let secrets = 0;
  let secretsComplete = true;
  if (vault?.available && typeof vault.list === 'function') {
    try {
      for (const { id, kind } of vault.list()) {
        vault.delete(id, kind);
        secrets += 1;
      }
    } catch (err) {
      secretsComplete = false;
      logger(`wipe: keychain entries could not all be removed (${err.code || err.message})`);
    }
  } else secretsComplete = false;
  const entries = levuvoEntries(
    (await readdir(dir, { withFileTypes: true }).catch(() => [])).map(e => ({ name: e.name, dir: e.isDirectory() }))
  );
  let files = 0;
  for (const { name, dir: isDir } of entries) {
    if (name === WIPE_MARKER) continue;
    await rm(path.join(dir, name), { recursive: isDir, force: true });
    files += 1;
  }
  if (accountsPath && path.dirname(accountsPath) !== dir) {
    await rm(accountsPath, { force: true });
    files += 1;
  }
  await rm(path.join(dir, WIPE_MARKER), { force: true });
  logger(`wipe: removed ${files} entries and ${secrets} keychain entries`);
  return { files, secrets, secretsComplete };
}
