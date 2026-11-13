// Levuvo Mail local API. Created by the Electron main process (desktop mode) or by
// server.mjs for browser-based development. Binds to 127.0.0.1 only.
import { createFollowupStore } from './followups.mjs';
import { createTemplateStore } from './templates.mjs';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import imapflow from 'imapflow';
import { validDesktopCookie, safeStaticFile, contentTypeForAsset, APP_CSP } from './desktop-runtime.mjs';
import { resolveAccount } from './accounts.mjs';
import { createAccountManager, settingsPath, openSystemVault } from './managed-accounts.mjs';
import { createSmtpTransport } from './send-service.mjs';
import { imapWriteEnabled } from './mail-actions.mjs';
import { draftEnabled } from './drafts.mjs';
import { classifyImapError, publicImapFailure } from './imap-diagnostics.mjs';
import { createWatcherPool } from './inbox-watcher.mjs';
import { createPreviewCache } from './previews.mjs';
import { createLru } from './memory-cache.mjs';
import { verifyAccountConfig } from './account-verify.mjs';
import { createOAuthManager, oauthConfigFrom } from './oauth.mjs';
import { createLocalIndex } from './local-index.mjs';
import { createDavStore, createDavService } from './dav.mjs';
import { createCloudService, DEFAULT_ENDPOINTS as CLOUD_ENDPOINTS } from './cloud.mjs';
import { createLocalCalendar } from './local-calendar.mjs';
import { createPgp } from './pgp.mjs';
import { createSmime } from './smime.mjs';
import { createDiagnostics } from './diagnostics.mjs';
import { registerAccountRoutes } from './routes-accounts.mjs';
import { registerMailRoutes } from './routes-mail.mjs';
import { registerDavRoutes } from './routes-dav.mjs';
import { registerCryptoRoutes } from './routes-crypto.mjs';

const { ImapFlow } = imapflow;
const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATIC_ROOT = path.resolve(here, '../../web/dist');
export const PACKAGE = (() => {
  try {
    return JSON.parse(readFileSync(path.resolve(here, '../../../package.json'), 'utf8'));
  } catch {
    return {};
  }
})();
export const APP_VERSION = PACKAGE.version || '0.0.0';
const LEGACY_ENV = /^(IMAP_|SMTP_|MAIL_|SENT_FOLDER$|DRAFTS_FOLDER$|ENABLE_)/;

const authOf = config =>
  config.accessToken
    ? { user: config.user, accessToken: config.accessToken }
    : { user: config.user, pass: config.password };

/** Short-lived connection for a single request. */
export function defaultImapFactory(config) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: authOf(config),
    logger: false,
    greetingTimeout: 12000,
    connectionTimeout: 12000,
    socketTimeout: 30000,
    disableAutoIdle: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }
  });
}
/** Long-lived connection for the IDLE watcher. */
export function idleImapFactory(config) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: authOf(config),
    logger: false,
    greetingTimeout: 15000,
    connectionTimeout: 15000,
    maxIdleTime: 4 * 60 * 1000,
    autoIdleDelay: 1000,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' }
  });
}

/** The desktop app never reads mail credentials from environment variables. */
export function withoutLegacyEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !LEGACY_ENV.test(key)));
}

/** Small JSON settings file (non-secret data only). */
export async function createJsonFile(filename, fallback) {
  let value = fallback;
  try {
    value = { ...fallback, ...JSON.parse(await readFile(filename, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') value = fallback;
  }
  return {
    get: () => value,
    async save(next) {
      value = next;
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const tmp = `${filename}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, filename);
    }
  };
}

export async function createMailServer({
  desktop = false,
  sessionSecret = '',
  env = process.env,
  vault = null,
  accountsFile,
  dataDir,
  staticRoot = DEFAULT_STATIC_ROOT,
  browserPort = 3001,
  imapFactory = defaultImapFactory,
  watcherFactory = idleImapFactory,
  smtpFactory = createSmtpTransport,
  oauthProviders,
  cloudEndpoints,
  fetchImpl = globalThis.fetch,
  watch = true,
  background = true,
  logger = () => {}
} = {}) {
  if (desktop && !/^[a-f0-9]{64}$/.test(sessionSecret)) throw new Error('Desktop-Sitzungsschlüssel fehlt.');
  const effectiveEnv = desktop ? { ...withoutLegacyEnv(env), ENABLE_SEND: 'true' } : env;
  const accountsPath = accountsFile || settingsPath(effectiveEnv);
  const dir = dataDir || path.dirname(accountsPath);
  const store = vault || (await openSystemVault());
  const api = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  let activePort = desktop ? 0 : browserPort;
  const allowedBrowserOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);

  const accountManager = await createAccountManager({
    env: effectiveEnv,
    filename: accountsPath,
    vault: store,
    verify: config => verifyAccountConfig(config, { imapFactory, smtpFactory })
  });
  const oauth = createOAuthManager({ config: oauthConfigFrom(PACKAGE, env), providers: oauthProviders, fetchImpl });
  const diagnostics = createDiagnostics({ version: APP_VERSION });
  const cryptoMeta = await createJsonFile(path.join(dir, 'crypto.json'), {});
  const settings = await createJsonFile(path.join(dir, 'app-settings.json'), { crashReports: false, localIndex: true });
  const followups = createFollowupStore(
    await createJsonFile(path.join(dir, 'followups.json'), { snoozed: [], followups: [] })
  );
  const templates = createTemplateStore(await createJsonFile(path.join(dir, 'templates.json'), { templates: [] }));
  const davStore = await createDavStore({ filename: path.join(dir, 'dav.json'), vault: store });
  const davService = createDavService({ store: davStore, fetchImpl });
  // A locked keychain must not stop the app: the device calendar is then simply missing.
  const localCalendar = await createLocalCalendar({
    filename: path.join(dir, 'calendar-local.json'),
    vault: store
  }).catch(err => {
    logger(`local calendar unavailable: ${err.code || err.message}`);
    return null;
  });
  const pgp = createPgp({ meta: cryptoMeta, vault: store });
  const smime = createSmime({ meta: cryptoMeta, vault: store });
  const localIndex = createLocalIndex({
    dir: path.join(dir, 'index'),
    getKey: async id => {
      if (!store.available || settings.get().localIndex === false) return null;
      try {
        let key = store.get(id, 'index-key');
        if (!key) {
          key = randomBytes(32).toString('hex');
          store.set(id, 'index-key', key);
        }
        return Buffer.from(key, 'hex');
      } catch {
        return null;
      }
    }
  });

  const writeGloballyEnabled = desktop || imapWriteEnabled(effectiveEnv);
  const draftsGloballyEnabled = desktop || draftEnabled(effectiveEnv);
  const previewCache = createPreviewCache();
  const listCache = createLru(60);
  const detailCache = createLru(25);

  /** IMAP/SMTP settings with a fresh OAuth access token where needed. */
  async function withToken(account, config) {
    if (!config.oauth) return config;
    const accessToken = await oauth.accessToken(
      account.id,
      config.oauth,
      accountManager.getSecret(account.id, 'oauth'),
      token => accountManager.setSecret(account.id, 'oauth', token)
    );
    return { ...config, accessToken };
  }
  const imapConfig = account => withToken(account, account.imap);
  const cloudPrefs = await createJsonFile(path.join(dir, 'cloud.json'), { hidden: [], colors: {} });
  const cloud = createCloudService({
    accounts: () => accounts,
    prefs: cloudPrefs,
    fetchImpl,
    endpoints: cloudEndpoints || CLOUD_ENDPOINTS,
    logger: line => logger(line),
    token: account =>
      oauth.accessToken(
        account.id,
        account.oauthProvider,
        accountManager.getSecret(account.id, 'oauth'),
        token => accountManager.setSecret(account.id, 'oauth', token),
        { resource: 'cloud' }
      )
  });
  const smtpConfigFor = account => withToken(account, account.smtp);

  const watchers = createWatcherPool({
    clientFactory: watcherFactory,
    prepare: account => imapConfig(account),
    previewCache,
    logger
  });

  let accounts = [];
  function refreshAccounts() {
    accounts = accountManager.all();
    if (watch) watchers.sync(accounts);
    const ids = new Set(accounts.map(a => a.id));
    listCache.deleteWhere(key => !ids.has(key.split('|')[0]));
    detailCache.deleteWhere(key => !ids.has(key.split('|')[0]));
    for (const id of ids) if (!accounts.some(a => a.id === id)) localIndex.unload(id);
    return accounts;
  }
  refreshAccounts();

  api.addHook('onSend', async (_request, reply, payload) => {
    if (!reply.getHeader('cache-control')) reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (!reply.getHeader('x-frame-options')) reply.header('X-Frame-Options', 'DENY');
    if (!reply.getHeader('cross-origin-resource-policy')) reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    if (
      String(reply.getHeader('content-type') || '').startsWith('text/html') &&
      !reply.getHeader('content-security-policy')
    ) {
      reply.header('Content-Security-Policy', APP_CSP);
    }
    return payload;
  });

  // OAuth redirect from the system browser carries no session cookie; it is protected
  // by the single-use, unguessable `state` value instead.
  const COOKIE_FREE = new Set(['/oauth/callback']);
  api.addHook('onRequest', async (request, reply) => {
    const host = String(request.headers.host || '').toLowerCase();
    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (desktop) {
      const expectedOrigin = `http://127.0.0.1:${activePort}`;
      if (
        host !== `127.0.0.1:${activePort}` ||
        (origin && origin !== expectedOrigin) ||
        (request.method !== 'GET' && origin !== expectedOrigin) ||
        (fetchSite === 'cross-site' && !COOKIE_FREE.has(pathname))
      ) {
        return reply.code(403).send({ error: 'Nur lokale Desktop-Anfragen erlaubt.' });
      }
      if (COOKIE_FREE.has(pathname) && request.method === 'GET') return;
      if (!validDesktopCookie(request.headers.cookie, sessionSecret)) {
        return reply.code(401).send({ error: 'Desktop-Sitzung fehlt oder ist abgelaufen.' });
      }
    } else if (
      !(host === `127.0.0.1:${browserPort}` || host === `localhost:${browserPort}`) ||
      (origin && !allowedBrowserOrigins.has(origin)) ||
      (request.method !== 'GET' && !allowedBrowserOrigins.has(origin)) ||
      (fetchSite === 'cross-site' && !COOKIE_FREE.has(pathname))
    ) {
      return reply.code(403).send({ error: 'Nur lokaler Zugriff erlaubt.' });
    }
    if (pathname.startsWith('/api/')) {
      const accountFree =
        /^\/api\/(runtime|accounts|unified|oauth|dav|calendar|contacts\/(list|save|delete|export|import)|crypto|diagnostics|app-settings|index|search\/local|invitations\/calendars|followups|templates)(\/|$)/.test(
          pathname
        );
      if (accountFree) return;
      const ids = new URL(request.url, 'http://127.0.0.1').searchParams.getAll('account');
      if (ids.length > 1) return reply.code(400).send({ error: 'Konto darf nur einmal angegeben werden.' });
      try {
        request.mailAccount = resolveAccount(accounts, ids[0]);
      } catch (err) {
        return reply.code(err.statusCode || 400).send({ error: err.message });
      }
    }
  });

  async function withImap(fn, account, { retryConnect = true } = {}) {
    if (!account.imap.configured)
      throw Object.assign(new Error('Postfach ist noch nicht eingerichtet.'), { statusCode: 412 });
    const config = await imapConfig(account);
    for (let attempt = 0; attempt < (retryConnect ? 2 : 1); attempt++) {
      const client = imapFactory(config);
      client.on?.('error', () => {});
      try {
        try {
          await client.connect();
        } catch (err) {
          err.imapPhase = 'connect';
          if (attempt === 0 && retryConnect && classifyImapError(err).retryable) {
            await new Promise(resolve => setTimeout(resolve, 300));
            continue;
          }
          diagnostics.record('imap', classifyImapError(err).code);
          throw err;
        }
        try {
          return await fn(client);
        } catch (err) {
          err.imapPhase ??= 'command';
          throw err;
        }
      } finally {
        try {
          await client.logout();
        } catch {
          try {
            client.close();
          } catch {
            /* ignore */
          }
        }
      }
    }
    throw new Error('IMAP-Verbindung nicht möglich.');
  }
  function errorResponse(reply, err) {
    if (err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({
        error: err.message,
        code: err.code || 'invalid_request',
        field: err.field,
        retryable: err.retryable === true
      });
    }
    if (err.code && /^(oauth|dav|sieve|smime|pgp|cloud|unsubscribe|calendar|protected)_/.test(err.code)) {
      diagnostics.record(err.code.split('_')[0], err.code);
      return reply.code(err.statusCode || 502).send({ error: err.message, code: err.code });
    }
    return reply.code(502).send(publicImapFailure(err, { connected: err.imapPhase === 'command' }));
  }
  const isOffline = err => ['imap_temporarily_unavailable', 'imap_dns_failed'].includes(classifyImapError(err).code);
  async function cachedRead(reply, cache, key, load) {
    try {
      const data = await load();
      if (key) cache.set(key, { data, at: Date.now() });
      return data;
    } catch (err) {
      const cached = key ? cache.get(key) : undefined;
      if (cached && isOffline(err)) return { ...cached.data, stale: true, cachedAt: cached.at };
      return errorResponse(reply, err);
    }
  }
  function requireAction(request, reply, action) {
    if (
      request.headers['x-levuvo-action'] !== action ||
      !String(request.headers['content-type'] || '')
        .toLowerCase()
        .startsWith('application/json')
    ) {
      reply.code(403).send({ error: 'Lokale Aktion nicht autorisiert.' });
      return false;
    }
    return true;
  }
  /** From header for an account and an optional alias. */
  function fromFor(account, email) {
    const own = account.smtp.user || account.imap.user;
    const target = (email || own).toLowerCase();
    if (target === own.toLowerCase() || target === account.imap.user.toLowerCase())
      return { name: account.displayName || '', address: account.imap.user };
    const alias = (account.identities || []).find(i => i.email === target);
    if (!alias)
      throw Object.assign(new Error('Diese Absenderadresse ist für das Konto nicht eingerichtet.'), {
        statusCode: 400,
        code: 'identity_unknown'
      });
    return { name: alias.name || account.displayName || '', address: alias.email };
  }
  const accountAddresses = a =>
    [a.imap.user, ...(a.identities || []).map(i => i.email)].filter(Boolean).map(e => e.toLowerCase());
  const ownAddresses = () => accounts.flatMap(accountAddresses);

  const ctx = {
    api,
    desktop,
    env: effectiveEnv,
    logger,
    store,
    accountManager,
    oauth,
    diagnostics,
    settings,
    cryptoMeta,
    davStore,
    davService,
    localCalendar,
    cloud,
    fetchImpl,
    pgp,
    smime,
    localIndex,
    followups,
    templates,
    watchers,
    previewCache,
    listCache,
    detailCache,
    writeGloballyEnabled,
    draftsGloballyEnabled,
    imapFactory,
    smtpFactory,
    watch,
    accounts: () => accounts,
    refreshAccounts,
    withImap,
    imapConfig,
    smtpConfigFor,
    errorResponse,
    cachedRead,
    requireAction,
    fromFor,
    ownAddresses,
    accountAddresses,
    port: () => activePort,
    version: APP_VERSION
  };

  api.get('/api/runtime', async () => ({ desktop, version: APP_VERSION, platform: process.platform }));
  registerAccountRoutes(ctx);
  registerMailRoutes(ctx);
  registerDavRoutes(ctx);
  registerCryptoRoutes(ctx);

  if (desktop) {
    api.get('/', async (_request, reply) => {
      let page;
      try {
        page = await readFile(path.join(staticRoot, 'index.html'));
      } catch {
        return reply.code(503).send({ error: 'Oberfläche fehlt. Bitte npm run build ausführen.' });
      }
      return reply.type('text/html; charset=utf-8').send(page);
    });
    api.get('/*', async (request, reply) => {
      const filepath = safeStaticFile(staticRoot, request.url);
      if (!filepath) return reply.code(404).send({ error: 'Datei nicht gefunden.' });
      let content;
      try {
        content = await readFile(filepath);
      } catch {
        return reply.code(404).send({ error: 'Datei nicht gefunden.' });
      }
      return reply.type(contentTypeForAsset(filepath)).send(content);
    });
  }
  api.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Unbekannter Endpunkt.' }));

  const timers = [];
  return {
    api,
    accountManager,
    watchers,
    settings,
    davService,
    ctx,
    get port() {
      return activePort;
    },
    async listen() {
      const address = await api.listen({ host: '127.0.0.1', port: desktop ? 0 : browserPort });
      activePort = Number(new URL(address).port);
      logger(
        `Levuvo Mail ${APP_VERSION} · API ${address} · ${desktop ? 'Desktop' : 'Browser'} · Konten: ${accounts.length} · Schlüsselbund ${accountManager.vaultAvailable ? 'verfügbar' : 'nicht verfügbar'}`
      );
      if (background) timers.push(...ctx.startBackgroundJobs());
      return { address, port: activePort };
    },
    setPortForTesting(port) {
      activePort = port;
    },
    async close() {
      for (const t of timers) clearInterval(t);
      watchers.stopAll();
      await api.close();
    }
  };
}
