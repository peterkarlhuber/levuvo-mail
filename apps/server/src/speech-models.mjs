// Speech recognition models for dictation (Whisper, ONNX). Like the language models of Levuvo's own
// Ollama they come from a fixed list, are downloaded on request and are checked file by file against
// pinned SHA-256 sums and sizes; a file with other content is deleted again (fail closed). They are
// served to the app's own page only, which runs Whisper locally (WebGPU, else WebAssembly). Audio
// never leaves the device and never reaches this server.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, statfs as fsStatfs } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { SPEECH_CATALOG } from './speech-catalog.mjs';

export { SPEECH_CATALOG };
export const SPEECH_DISK_RESERVE = 1024 ** 3;
const HOST = 'https://huggingface.co';
const STALL_MS = 120_000;

export class SpeechModelError extends Error {
  constructor(kind, message, statusCode = 409) {
    super(message);
    this.kind = kind;
    this.code = `ai_${kind}`;
    this.statusCode = statusCode;
  }
}

export const speechEntry = id => SPEECH_CATALOG.find(m => m.id === id) || null;
const totalSize = entry => entry.files.reduce((n, f) => n + f.size, 0);

/** The local path of a model file, only for files of the fixed list (no path from the request). */
export function speechFilePath(dir, id, file) {
  const entry = speechEntry(id);
  const known = entry?.files.find(f => f.path === file);
  if (!known) return null;
  return path.join(dir, entry.id, ...known.path.split('/'));
}

/**
 * @param {object} o
 * @param {string} o.dir  folder for the models (app data/speech)
 */
export function createSpeechModels({
  dir,
  fetchImpl = fetch,
  statfs = fsStatfs,
  log = null,
  catalog = SPEECH_CATALOG,
  host = HOST
}) {
  const jobs = new Map();
  const entryOf = id => {
    const entry = catalog.find(m => m.id === id);
    if (!entry) throw new SpeechModelError('not_in_catalog', 'Dieses Modell steht nicht in der Liste.', 400);
    return entry;
  };
  const fileOf = (entry, f) => path.join(dir, entry.id, ...f.path.split('/'));

  async function installed(entry) {
    for (const f of entry.files) {
      const s = await stat(fileOf(entry, f)).catch(() => null);
      if (!s || s.size !== f.size) return false;
    }
    return true;
  }

  async function sha256(file) {
    const hash = createHash('sha256');
    const { createReadStream } = await import('node:fs');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  }

  async function fetchFile(entry, f, job) {
    const target = fileOf(entry, f);
    // A complete file from an earlier run is checked again instead of downloaded again.
    const have = await stat(target).catch(() => null);
    if (have?.size === f.size && (await sha256(target)) === f.sha256) {
      job.completed += f.size;
      return;
    }
    await mkdir(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    const url = `${host}/${entry.repo}/resolve/${entry.revision}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetchImpl(url, { signal: job.abort.signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new SpeechModelError('download_failed', `HTTP ${res.status}`, 502);
    const hash = createHash('sha256');
    let bytes = 0;
    let stall;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => job.abort.abort(new Error('stalled')), STALL_MS);
    };
    arm();
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > f.size) return cb(new SpeechModelError('checksum_mismatch', 'Datei zu groß.'));
        hash.update(chunk);
        job.completed += chunk.length;
        arm();
        cb(null, chunk);
      }
    });
    try {
      await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(part));
    } finally {
      clearTimeout(stall);
    }
    if (bytes !== f.size || hash.digest('hex') !== f.sha256) {
      await rm(part, { force: true });
      throw new SpeechModelError('checksum_mismatch', 'Prüfsumme stimmt nicht.');
    }
    await rename(part, target);
  }

  async function run(entry, job) {
    try {
      const fs = await statfs(dir).catch(() => null);
      if (fs && fs.bavail * fs.bsize < totalSize(entry) + SPEECH_DISK_RESERVE)
        throw new SpeechModelError('disk_full', 'Zu wenig Speicherplatz.');
      for (const f of entry.files) await fetchFile(entry, f, job);
      job.state = 'done';
      void log?.add({ type: 'download', kind: 'speech-model', model: entry.id, ok: true });
    } catch (err) {
      const cancelled = job.abort.signal.aborted && job.cancelled;
      job.state = cancelled ? 'cancelled' : 'error';
      job.error = cancelled ? null : err.kind || 'download_failed';
      if (err.kind === 'checksum_mismatch') await rm(path.join(dir, entry.id), { recursive: true, force: true });
      if (!cancelled)
        void log?.add({ type: 'download', kind: 'speech-model', model: entry.id, ok: false, error: job.error });
    }
  }

  const publicJob = j =>
    j ? { state: j.state, completed: j.completed, total: j.total, error: j.error || null } : null;

  return {
    async list() {
      await mkdir(dir, { recursive: true }).catch(() => {});
      const models = [];
      for (const m of catalog)
        models.push({
          id: m.id,
          name: m.name,
          size: totalSize(m),
          quality: m.quality,
          languages: m.languages,
          license: m.license,
          device: m.device,
          dtype: m.dtype,
          installed: await installed(m),
          job: publicJob(
            jobs.get(m.id)?.state === 'running' || jobs.get(m.id)?.state === 'error' ? jobs.get(m.id) : null
          )
        });
      return { models };
    },
    async download(id) {
      const entry = entryOf(id);
      const running = jobs.get(id);
      if (running?.state === 'running') return publicJob(running);
      const job = {
        state: 'running',
        completed: 0,
        total: totalSize(entry),
        error: null,
        abort: new AbortController()
      };
      jobs.set(id, job);
      job.done = run(entry, job);
      return publicJob(job);
    },
    cancel(id) {
      const job = jobs.get(id);
      if (job?.state === 'running') {
        job.cancelled = true;
        job.abort.abort();
      }
      return publicJob(job);
    },
    async remove(id) {
      const entry = entryOf(id);
      this.cancel(id);
      await jobs.get(id)?.done;
      jobs.delete(id);
      await rm(path.join(dir, entry.id), { recursive: true, force: true });
      return { removed: true };
    },
    /** Absolute path of an installed file of the list, else null. */
    async file(id, file) {
      const entry = catalog.find(m => m.id === id);
      const known = entry?.files.find(f => f.path === file);
      if (!known) return null;
      const p = fileOf(entry, known);
      const s = await stat(p).catch(() => null);
      return s?.size === known.size ? p : null;
    },
    isInstalled: async id => {
      const entry = catalog.find(m => m.id === id);
      return entry ? installed(entry) : false;
    },
    /** Partial downloads (".part") of all models. */
    async discardPartial() {
      for (const m of catalog) {
        const base = path.join(dir, m.id);
        const walk = async d => {
          for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) await walk(p);
            else if (e.name.endsWith('.part')) await rm(p, { force: true });
          }
        };
        await walk(base);
      }
      return { discarded: true };
    },
    jobs
  };
}
