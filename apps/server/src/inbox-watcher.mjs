// One persistent, read-only IMAP connection per account that stays in IDLE.
// The server pushes EXISTS/EXPUNGE/FETCH notifications; we then refresh a cached
// inbox snapshot. UI and background notifications read that cache instead of
// opening a new TLS login every few seconds.
import { createHash } from 'node:crypto';
import { monitorInbox } from './mailbox.mjs';
import { publicImapFailure } from './imap-diagnostics.mjs';

const DEBOUNCE_MS = 400;
const FALLBACK_REFRESH_MS = 3 * 60 * 1000;
const MIN_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

/** Changes whenever host, user or password change, so the watcher reconnects. */
export function accountFingerprint(account) {
  const { host, port, user, password, oauth } = account.imap;
  return createHash('sha256')
    .update(JSON.stringify([host, port, user, password, oauth || '']))
    .digest('hex');
}

function createWatcher(account, { clientFactory, prepare, previewCache, onSnapshot, logger, timers }) {
  let stopped = false;
  let client = null;
  let refreshTimer = null;
  let fallbackTimer = null;
  let refreshing = false;
  let refreshAgain = false;
  let backoff = MIN_BACKOFF_MS;
  let wakeUp = null;
  const state = { snapshot: null, at: null, healthy: false, error: null, connected: false };

  async function refresh() {
    if (!client || stopped) return;
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      const snapshot = await monitorInbox(client, { previewCache, accountKey: account.id });
      state.snapshot = snapshot;
      state.at = Date.now();
      state.healthy = true;
      state.error = null;
      onSnapshot?.(account.id, snapshot);
    } catch (err) {
      state.healthy = false;
      state.error = publicImapFailure(err, { connected: true }).error;
    } finally {
      refreshing = false;
      if (refreshAgain && !stopped) {
        refreshAgain = false;
        void refresh();
      }
    }
  }
  function scheduleRefresh() {
    if (refreshTimer) timers.clearTimeout(refreshTimer);
    refreshTimer = timers.setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, DEBOUNCE_MS);
  }

  async function runOnce() {
    const config = prepare ? await prepare(account) : account.imap;
    client = clientFactory(config);
    const closed = new Promise(resolve => client.once('close', resolve));
    client.on('error', () => {});
    client.on('exists', scheduleRefresh);
    client.on('expunge', scheduleRefresh);
    client.on('flags', scheduleRefresh);
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });
    state.connected = true;
    backoff = MIN_BACKOFF_MS;
    await refresh();
    fallbackTimer = timers.setInterval(() => void refresh(), FALLBACK_REFRESH_MS);
    await closed;
  }

  async function loop() {
    while (!stopped) {
      try {
        await runOnce();
        if (!stopped) logger?.('IMAP-IDLE-Verbindung beendet, neuer Aufbau folgt.');
      } catch (err) {
        state.healthy = false;
        state.error = publicImapFailure(err).error;
      } finally {
        state.connected = false;
        if (fallbackTimer) timers.clearInterval(fallbackTimer);
        fallbackTimer = null;
        const old = client;
        client = null;
        try {
          old?.close();
        } catch {
          /* already closed */
        }
      }
      if (stopped) break;
      await new Promise(resolve => {
        const timer = timers.setTimeout(resolve, backoff);
        wakeUp = () => {
          timers.clearTimeout(timer);
          resolve();
        };
      });
      wakeUp = null;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
  void loop();

  return {
    state,
    refresh: async () => {
      if (client && state.connected) await refresh();
      else wakeUp?.();
    },
    stop() {
      stopped = true;
      if (refreshTimer) timers.clearTimeout(refreshTimer);
      if (fallbackTimer) timers.clearInterval(fallbackTimer);
      wakeUp?.();
      const current = client;
      if (current)
        current.logout().catch(() => {
          try {
            current.close();
          } catch {
            /* ignore */
          }
        });
    }
  };
}

/**
 * Keeps exactly one watcher per configured account. `sync()` must be called whenever
 * the account list changes; accounts with changed credentials get a fresh connection.
 */
export function createWatcherPool({
  clientFactory,
  prepare,
  previewCache,
  onSnapshot,
  logger,
  timers = globalThis
} = {}) {
  const watchers = new Map();
  return {
    sync(accounts) {
      const wanted = new Map(accounts.filter(a => a.imap?.configured).map(a => [a.id, a]));
      for (const [id, entry] of watchers) {
        const next = wanted.get(id);
        if (!next || accountFingerprint(next) !== entry.fingerprint) {
          entry.watcher.stop();
          watchers.delete(id);
        }
      }
      for (const [id, account] of wanted) {
        if (watchers.has(id)) continue;
        watchers.set(id, {
          fingerprint: accountFingerprint(account),
          watcher: createWatcher(account, { clientFactory, prepare, previewCache, onSnapshot, logger, timers })
        });
      }
    },
    /** Latest snapshot if the IDLE connection is healthy, otherwise null. */
    snapshot(id, maxAgeMs = FALLBACK_REFRESH_MS + 60_000) {
      const state = watchers.get(id)?.watcher.state;
      if (!state?.snapshot || !state.healthy || !state.connected) return null;
      if (Date.now() - state.at > maxAgeMs) return null;
      return { ...state.snapshot, checkedAt: state.at, source: 'idle' };
    },
    status(id) {
      const state = watchers.get(id)?.watcher.state;
      return state ? { connected: state.connected, healthy: state.healthy, error: state.error, at: state.at } : null;
    },
    async refresh(id) {
      await watchers.get(id)?.watcher.refresh();
    },
    stopAll() {
      for (const entry of watchers.values()) entry.watcher.stop();
      watchers.clear();
    },
    get size() {
      return watchers.size;
    }
  };
}
