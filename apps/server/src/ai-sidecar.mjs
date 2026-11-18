// AI sidecar: the Python process (apps/ai, Orkexa) that runs the language model calls.
// It is started on first use, talks newline-delimited JSON-RPC over stdin/stdout, gets a minimal
// environment (no mail credentials, no session secret) and is stopped when idle.
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_LINE = 16 * 1024 * 1024;
const PASS_ENV = ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL'];
const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'];

/**
 * Where the Python runtime is. Packaged apps ship their own runtime under resources/ai-runtime
 * (built by scripts/build-ai-runtime.mjs); development uses LEVUVO_AI_PYTHON or python3 with apps/ai.
 */
export function resolveSidecar({
  resourcesPath = process.resourcesPath,
  env = process.env,
  platform = process.platform
} = {}) {
  const bundled = resourcesPath ? path.join(resourcesPath, 'ai-runtime') : '';
  const bundledPython = bundled
    ? platform === 'win32'
      ? path.join(bundled, 'python', 'python.exe')
      : path.join(bundled, 'python', 'bin', 'python3')
    : '';
  if (bundledPython && existsSync(bundledPython)) {
    // -I: isolated mode, ignores PYTHON* variables and the user's site-packages.
    return { command: bundledPython, args: ['-I', '-m', 'levuvo_ai'], cwd: bundled, bundled: true, pythonPath: '' };
  }
  const source = path.resolve(here, '../../ai');
  const command = env.LEVUVO_AI_PYTHON || (platform === 'win32' ? 'python' : 'python3');
  return { command, args: ['-m', 'levuvo_ai'], cwd: source, bundled: false, pythonPath: source };
}

export function sidecarEnv(env = process.env, pythonPath = '') {
  const out = {};
  for (const key of PASS_ENV) if (env[key]) out[key] = env[key];
  for (const key of PROXY_ENV) if (env[key]) out[key] = env[key];
  // Local Ollama must never go through a proxy.
  const noProxy = [env.NO_PROXY || env.no_proxy, '127.0.0.1', 'localhost', '::1'].filter(Boolean).join(',');
  out.NO_PROXY = noProxy;
  out.no_proxy = noProxy;
  out.PYTHONDONTWRITEBYTECODE = '1';
  out.PYTHONUTF8 = '1';
  out.PYTHONUNBUFFERED = '1';
  if (pythonPath) out.PYTHONPATH = pythonPath;
  return out;
}

export class SidecarError extends Error {
  constructor(kind, message) {
    super(message || kind);
    this.kind = kind;
    this.code = `ai_${kind}`;
  }
}

export function createSidecar({
  spawn = nodeSpawn,
  resolve = resolveSidecar,
  env = process.env,
  logger = () => {},
  idleMs = 15 * 60 * 1000,
  timeoutMs = 180_000,
  onStart = async () => {}
} = {}) {
  let child = null;
  let starting = null;
  let nextId = 1;
  let buffer = '';
  let idleTimer = null;
  let crashes = [];
  const pending = new Map();
  const stderrTail = [];

  function failAll(kind) {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new SidecarError(kind));
    }
    pending.clear();
  }
  function onLine(line) {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const p = pending.get(msg?.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new SidecarError(msg.error?.data?.kind || 'internal', msg.error.message));
    else p.resolve(msg.result);
  }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!pending.size) void stop();
    }, idleMs);
    idleTimer.unref?.();
  }
  async function start() {
    if (child) return child;
    if (starting) return starting;
    const now = Date.now();
    crashes = crashes.filter(t => now - t < 5 * 60 * 1000);
    if (crashes.length >= 3) throw new SidecarError('crashed');
    starting = (async () => {
      const where = resolve({ env });
      let proc;
      try {
        proc = spawn(where.command, where.args, {
          cwd: where.cwd,
          env: sidecarEnv(env, where.pythonPath),
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        });
      } catch {
        throw new SidecarError('runtime_missing');
      }
      await new Promise((resolveSpawn, rejectSpawn) => {
        proc.once('spawn', resolveSpawn);
        proc.once('error', () => rejectSpawn(new SidecarError('runtime_missing')));
      });
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > MAX_LINE) {
          logger('ai sidecar: oversized message, restarting');
          proc.kill();
          return;
        }
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          onLine(line);
        }
      });
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', chunk => {
        for (const line of String(chunk).split('\n').filter(Boolean)) {
          stderrTail.push(line.slice(0, 300));
          if (stderrTail.length > 20) stderrTail.shift();
        }
      });
      proc.on('exit', code => {
        if (child === proc) child = null;
        buffer = '';
        if (code !== 0 && code !== null) crashes.push(Date.now());
        failAll('stopped');
      });
      proc.stdin.on('error', () => {});
      child = proc;
      try {
        await onStart(rawCall);
      } catch (err) {
        logger(`ai sidecar: configuration failed (${err.kind || err.message})`);
      }
      return proc;
    })();
    try {
      return await starting;
    } finally {
      starting = null;
    }
  }
  function rawCall(method, params = {}, { timeout = timeoutMs } = {}) {
    if (!child) return Promise.reject(new SidecarError('stopped'));
    const id = nextId++;
    return new Promise((resolveCall, rejectCall) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectCall(new SidecarError('timeout'));
      }, timeout);
      timer.unref?.();
      pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  async function call(method, params = {}, options = {}) {
    await start();
    try {
      return await rawCall(method, params, options);
    } finally {
      armIdle();
    }
  }
  async function stop() {
    clearTimeout(idleTimer);
    const proc = child;
    if (!proc) return;
    child = null;
    failAll('stopped');
    try {
      proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'shutdown' })}\n`);
      proc.stdin.end();
    } catch {
      /* already gone */
    }
    const killer = setTimeout(() => proc.kill(), 3000);
    killer.unref?.();
    await new Promise(r => {
      if (proc.exitCode !== null) return r();
      proc.once('exit', r);
    });
    clearTimeout(killer);
  }
  return {
    call,
    stop,
    get running() {
      return Boolean(child);
    },
    diagnostics: () => ({ running: Boolean(child), recentErrors: stderrTail.slice(-5) })
  };
}
