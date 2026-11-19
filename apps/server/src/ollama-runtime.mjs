// Levuvo's own Ollama: the pinned build shipped under resources/ollama (scripts/fetch-ollama.mjs),
// started and stopped by the app, independent of any Ollama installed on the computer.
//
// Isolation: its own models folder and home under the app data folder (the server writes its key
// pair to $HOME/.ollama), a port of its own chosen at start, bound to 127.0.0.1 only, Ollama's cloud
// features off (OLLAMA_NO_CLOUD), and a minimal environment: no OLLAMA_* variable of the user's own
// setup reaches it. An Ollama the user runs on 11434 is never contacted, started or stopped.
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const PASS_ENV = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'PROCESSOR_ARCHITECTURE'];
// Downloads of models may need the user's corporate proxy; the local API never goes through it.
const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'SSL_CERT_FILE'];
const START_TIMEOUT = 30_000;

/** The bundled binary, or the one named in LEVUVO_OLLAMA_BIN (development only, never from PATH). */
export function resolveOllama({ resourcesPath = process.resourcesPath, env = process.env, platform = process.platform } = {}) {
  const dir = resourcesPath ? path.join(resourcesPath, 'ollama') : '';
  const names = platform === 'win32' ? ['ollama.exe'] : ['ollama', path.join('bin', 'ollama')];
  for (const name of names) {
    const file = dir ? path.join(dir, name) : '';
    if (file && existsSync(file)) return { command: file, bundled: true };
  }
  if (env.LEVUVO_OLLAMA_BIN && existsSync(env.LEVUVO_OLLAMA_BIN)) return { command: env.LEVUVO_OLLAMA_BIN, bundled: false };
  return null;
}

/** Folders of the private runtime inside the app data folder. */
export function ollamaPaths(dataDir) {
  const base = path.join(dataDir, 'ollama');
  return { base, home: path.join(base, 'home'), models: path.join(base, 'models') };
}

export function ollamaEnv({ env = process.env, home, models, port }) {
  const out = {};
  for (const key of PASS_ENV) if (env[key]) out[key] = env[key];
  for (const key of PROXY_ENV) if (env[key]) out[key] = env[key];
  Object.assign(out, {
    HOME: home,
    USERPROFILE: home,
    OLLAMA_HOST: `127.0.0.1:${port}`,
    OLLAMA_MODELS: models,
    OLLAMA_NO_CLOUD: '1',
    // Partly downloaded models survive a restart, so a cancelled download continues later.
    OLLAMA_NOPRUNE: '1',
    OLLAMA_NOHISTORY: '1',
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1'
  });
  return out;
}

/** A free TCP port on 127.0.0.1, chosen by the operating system. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export class OllamaRuntimeError extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.kind = kind;
    this.code = `ai_${kind}`;
  }
}

export function createOllamaRuntime({
  dataDir,
  resolve = resolveOllama,
  spawn = nodeSpawn,
  fetchImpl = fetch,
  env = process.env,
  pickPort = freePort,
  logger = () => {},
  // Stops the server when Levuvo has not used it for this long; models are unloaded by Ollama
  // itself after five minutes.
  idleMs = 30 * 60 * 1000
} = {}) {
  const where = resolve({ env });
  const paths = ollamaPaths(dataDir);
  let child = null;
  let starting = null;
  let baseUrl = '';
  let version = '';
  let idleTimer = null;
  let crashes = [];
  const stderrTail = [];

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void stop(), idleMs);
    idleTimer.unref?.();
  }

  async function waitReady(url, proc) {
    const until = Date.now() + START_TIMEOUT;
    while (Date.now() < until) {
      if (proc.exitCode !== null) throw new OllamaRuntimeError('ollama_unavailable', 'Ollama ended during start');
      try {
        const res = await fetchImpl(`${url}/api/version`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return (await res.json()).version || '';
      } catch {
        /* not listening yet */
      }
      await new Promise(r => setTimeout(r, 250));
    }
    throw new OllamaRuntimeError('ollama_unavailable', 'Ollama did not start in time');
  }

  async function start() {
    if (!where) throw new OllamaRuntimeError('runtime_missing', 'no bundled Ollama');
    const now = Date.now();
    crashes = crashes.filter(t => now - t < 5 * 60 * 1000);
    if (crashes.length >= 3) throw new OllamaRuntimeError('crashed');
    mkdirSync(paths.home, { recursive: true, mode: 0o700 });
    mkdirSync(paths.models, { recursive: true, mode: 0o700 });
    const port = await pickPort();
    const url = `http://127.0.0.1:${port}`;
    const proc = spawn(where.command, ['serve'], {
      cwd: paths.base,
      env: ollamaEnv({ env, home: paths.home, models: paths.models, port }),
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    });
    const killOnExit = () => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    };
    process.once('exit', killOnExit);
    proc.once('exit', code => {
      process.removeListener('exit', killOnExit);
      if (code !== 0 && code !== null) crashes.push(Date.now());
      if (child === proc) {
        child = null;
        baseUrl = '';
      }
    });
    proc.once('error', () => {});
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', chunk => {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        // Request lines and key material are never kept, only server messages.
        if (/\[GIN\]|ssh-ed25519|public key/i.test(line)) continue;
        stderrTail.push(line.slice(0, 300));
        if (stderrTail.length > 20) stderrTail.shift();
      }
    });
    try {
      version = await waitReady(url, proc);
    } catch (err) {
      killOnExit();
      throw err;
    }
    child = proc;
    baseUrl = url;
    logger(`ollama: own runtime ${version} on ${url}`);
    return url;
  }

  /** Starts the runtime if needed and returns its address. */
  async function ensure() {
    touch();
    if (child && baseUrl) return baseUrl;
    if (!starting)
      starting = start().finally(() => {
        starting = null;
      });
    return starting;
  }

  async function stop() {
    clearTimeout(idleTimer);
    const proc = child;
    child = null;
    baseUrl = '';
    if (!proc || proc.exitCode !== null) return;
    proc.kill();
    const killer = setTimeout(() => proc.kill('SIGKILL'), 5000);
    killer.unref?.();
    await new Promise(r => (proc.exitCode !== null ? r() : proc.once('exit', r)));
    clearTimeout(killer);
  }

  return {
    available: Boolean(where),
    bundled: Boolean(where?.bundled),
    paths,
    ensure,
    stop,
    get running() {
      return Boolean(child && baseUrl);
    },
    get baseUrl() {
      return baseUrl;
    },
    diagnostics: () => ({
      available: Boolean(where),
      bundled: Boolean(where?.bundled),
      running: Boolean(child && baseUrl),
      version,
      recentErrors: stderrTail.slice(-5)
    })
  };
}
