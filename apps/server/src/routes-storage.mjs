// Where Levuvo Mail keeps its data on this computer (Settings → Privacy): the folders with their
// sizes, and, in the desktop app, a button that shows a folder in Finder or Explorer. Paths and
// sizes only; nothing here reads file contents.
import { existsSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ollamaPaths } from './ollama-runtime.mjs';

const MAX_ENTRIES = 50_000;

/** The folders shown in Settings, in display order. */
export function storageFolders(dir) {
  return [
    { id: 'data', path: dir },
    { id: 'models', path: ollamaPaths(dir).models },
    { id: 'index', path: path.join(dir, 'index') },
    { id: 'spaces', path: path.join(dir, 'spaces') },
    { id: 'restore', path: path.join(dir, 'before-restore') }
  ];
}

/** Bytes of all files below `root` (symbolic links are not followed); null when it does not exist. */
export async function folderBytes(root, { limit = MAX_ENTRIES } = {}) {
  let total = 0;
  let seen = 0;
  const stack = [root];
  try {
    if (!(await lstat(root)).isDirectory()) return null;
  } catch {
    return null;
  }
  while (stack.length && seen < limit) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++seen > limit) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile())
        try {
          total += (await lstat(full)).size;
        } catch {
          /* removed meanwhile */
        }
    }
  }
  return total;
}

export function registerStorageRoutes(ctx, { dir, openFolder = null }) {
  const { api, requireAction } = ctx;
  api.get('/api/storage', async () => {
    const folders = storageFolders(dir);
    const items = [];
    for (const f of folders) items.push({ ...f, exists: existsSync(f.path), bytes: await folderBytes(f.path) });
    return { dataDir: dir, platform: process.platform, canOpen: typeof openFolder === 'function', folders: items };
  });
  api.post('/api/storage/open', { bodyLimit: 1024 }, async (request, reply) => {
    if (!requireAction(request, reply, 'mail-v1')) return;
    if (typeof openFolder !== 'function')
      return reply.code(409).send({ error: 'Nur in der Desktop-App möglich.', code: 'storage_not_desktop' });
    // Only the known folders, never a path from the request.
    const target = storageFolders(dir).find(f => f.id === String(request.body?.id || ''));
    if (!target) return reply.code(404).send({ error: 'Unbekannter Ordner.', code: 'not_found' });
    await openFolder(existsSync(target.path) ? target.path : dir);
    return { opened: target.id };
  });
}
