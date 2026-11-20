// AI settings, consent, keys and the activity log.
// Off by default. Local models (Ollama on this computer) are the default provider; a cloud provider is
// used only after the user consented to it (DSGVO Art. 6/7, documented with time and text version) and
// never for accounts marked as "no cloud AI" (e.g. professional secrecy). API keys live in the system
// keychain only. The log stores what happened, never the content of a message.
import { atomicWrite } from './local-store.mjs';
import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SidecarError } from './ai-sidecar.mjs';
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBED_MODEL,
  catalogEntry,
  defaultModel,
  recommendedTier
} from './ai-model-catalog.mjs';

// Raised whenever the consent text changes: every cloud consent has to be given again.
// Bumped when the consent text lists new content (2026-11-19b: attachment text and history in
// questions, habits per contact in reply suggestions): everyone is asked again.
export const CONSENT_VERSION = '2026-11-19b';
export const AI_PROVIDERS = ['ollama', 'anthropic', 'openai'];
export const CLOUD_PROVIDERS = ['anthropic', 'openai'];
/**
 * Ollama models served by Ollama's cloud (tag `cloud` or `…-cloud`, e.g. `gpt-oss:120b-cloud`):
 * their content leaves the device, so they are never accepted as a local model.
 */
export const isOllamaCloudModel = name => /:(?:[^:/]*-)?cloud$/i.test(String(name || '').trim());
export const AI_FEATURES = [
  'digest',
  'translate',
  'reply',
  'rewrite',
  'compose',
  'attachmentCheck',
  'prioritize',
  'classify',
  'extract',
  'assess',
  'search',
  'agents',
  // Opt-in (checked with === true): reads new sent and received mail in the background.
  'commitments'
];
const TASK_FEATURE = {
  digest: 'digest',
  newsletters: 'digest',
  translate: 'translate',
  reply: 'reply',
  rewrite: 'rewrite',
  compose: 'compose',
  attachment_check: 'attachmentCheck',
  presend: 'attachmentCheck',
  filter_rule: 'classify',
  automation_rule: 'classify',
  prioritize: 'prioritize',
  classify: 'classify',
  extract: 'extract',
  assess: 'assess',
  ask: 'search',
  embed: 'search',
  commitments: 'commitments'
};
const LOG_DAYS = 30;
const LOG_MAX = 5000;
const VAULT_ID = 'ai';

export const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'ollama',
  model: DEFAULT_CHAT_MODEL,
  baseUrl: 'http://127.0.0.1:11434',
  embedModel: DEFAULT_EMBED_MODEL,
  features: Object.fromEntries(AI_FEATURES.map(f => [f, f !== 'commitments'])),
  consents: {},
  noCloudAccounts: [],
  profile: { tone: 'auto', address: 'auto', signoff: '', instructions: '', learnStyle: false }
};
export const AI_TONES = ['auto', 'friendly', 'formal', 'casual', 'brief'];
export const AI_ADDRESS = ['auto', 'du', 'sie'];

function invalid(message, code = 'ai_invalid') {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

const MODEL_NAME = /^[A-Za-z0-9._:/-]{1,120}$/;

/**
 * `managed`: Levuvo Mail's own Ollama runs the local models, so only models of the fixed catalog are
 * accepted and the address is chosen by the app (the setting stays for development only).
 */
export function validateAiSettings(input, current, { managed = false } = {}) {
  const next = { ...current, features: { ...current.features }, consents: { ...current.consents } };
  if (input.enabled !== undefined) next.enabled = input.enabled === true;
  if (input.provider !== undefined) {
    if (!AI_PROVIDERS.includes(input.provider)) throw invalid('Unbekannter KI-Anbieter.');
    next.provider = input.provider;
  }
  for (const key of ['model', 'embedModel']) {
    if (input[key] === undefined) continue;
    const value = String(input[key]).trim();
    if (!MODEL_NAME.test(value) || isOllamaCloudModel(value)) throw invalid('Ungültiger Modellname.');
    if (managed && (key === 'embedModel' || next.provider === 'ollama')) {
      const entry = catalogEntry(value);
      if (!entry || entry.kind !== (key === 'embedModel' ? 'embed' : 'chat'))
        throw invalid('Dieses Modell steht nicht in der Liste.', 'ai_not_in_catalog');
      next[key] = entry.id;
      continue;
    }
    next[key] = value;
  }
  if (input.baseUrl !== undefined) {
    let url;
    try {
      url = new URL(String(input.baseUrl));
    } catch {
      throw invalid('Ollama-Adresse ungültig.');
    }
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username)
      throw invalid('Ollama muss auf diesem Computer laufen (127.0.0.1).');
    next.baseUrl = `http://${url.host}`;
  }
  if (input.features && typeof input.features === 'object') {
    for (const f of AI_FEATURES) if (input.features[f] !== undefined) next.features[f] = input.features[f] === true;
  }
  next.profile = { ...DEFAULT_AI_SETTINGS.profile, ...(current.profile || {}) };
  if (input.profile && typeof input.profile === 'object') {
    const p = input.profile;
    if (p.tone !== undefined) {
      if (!AI_TONES.includes(p.tone)) throw invalid('Unbekannter Tonfall.');
      next.profile.tone = p.tone;
    }
    if (p.address !== undefined) {
      if (!AI_ADDRESS.includes(p.address)) throw invalid('Unbekannte Anrede.');
      next.profile.address = p.address;
    }
    // Own wording and instructions: plain text, no control characters.
    const clean = (v, n) =>
      String(v ?? '')
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
        .slice(0, n);
    if (p.learnStyle !== undefined) next.profile.learnStyle = p.learnStyle === true;
    if (p.signoff !== undefined) next.profile.signoff = clean(p.signoff, 200);
    if (p.instructions !== undefined) next.profile.instructions = clean(p.instructions, 1000);
  }
  if (Array.isArray(input.noCloudAccounts))
    next.noCloudAccounts = [...new Set(input.noCloudAccounts.map(String).filter(id => /^[\w-]{1,64}$/.test(id)))];
  return next;
}

export function createAiLog(filename) {
  let queue = Promise.resolve();
  async function read() {
    try {
      const lines = (await readFile(filename, 'utf8')).split('\n').filter(Boolean);
      return lines.flatMap(l => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }
  async function prune() {
    const cutoff = Date.now() - LOG_DAYS * 86400_000;
    const kept = (await read()).filter(e => Date.parse(e.at) >= cutoff).slice(-LOG_MAX);
    await atomicWrite(filename, kept.map(e => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
  }
  let writes = 0;
  // The 30-day limit also holds while the AI is not used: old lines are removed at the start and
  // twice a day, not only when new entries are written.
  const sweep = () => {
    queue = queue
      .then(async () => {
        if ((await read()).some(e => !(Date.parse(e.at) >= Date.now() - LOG_DAYS * 86400_000))) await prune();
      })
      .catch(() => {});
    return queue;
  };
  // The twice-daily sweep is registered as a background job by the app (background-jobs.mjs).
  void sweep();
  return {
    sweep,
    add(entry) {
      const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
      queue = queue
        .then(async () => {
          await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
          await appendFile(filename, `${line}\n`, { mode: 0o600 });
          if (++writes % 200 === 1) await prune();
        })
        .catch(() => {});
      return queue;
    },
    async list(limit = 200) {
      await queue;
      const cutoff = Date.now() - LOG_DAYS * 86400_000;
      return (await read())
        .filter(e => Date.parse(e.at) >= cutoff)
        .slice(-limit)
        .reverse();
    },
    async clear() {
      await queue;
      await writeFile(filename, '', { mode: 0o600 }).catch(() => {});
    }
  };
}

export function createAiService({
  settingsFile,
  vault,
  sidecar,
  log,
  logger = () => {},
  // Levuvo Mail's own Ollama (ollama-runtime.mjs) and its model manager (ollama-models.mjs). Without
  // them (development without a bundled binary) the configured address is used.
  localRuntime = null,
  models = null,
  totalmem = os.totalmem
}) {
  const managed = Boolean(localRuntime?.available);
  // First start: the language model that fits the memory of this computer.
  const get = () => {
    const stored = settingsFile.get() || {};
    const s = { ...DEFAULT_AI_SETTINGS, ...stored };
    if (!stored.model) s.model = defaultModel(recommendedTier(totalmem()));
    return s;
  };
  /** The Ollama address for this request: the own runtime (started on demand) or the setting. */
  async function localUrl(s) {
    if (!managed) return s.baseUrl;
    return localRuntime.ensure();
  }
  // Downloaded-and-verified check of the catalog models, cached briefly (it asks Ollama).
  const ready = new Map();
  async function ensureModelReady(id) {
    if (!managed || !models) return;
    const hit = ready.get(id);
    if (hit && Date.now() - hit < 60_000) return;
    if (!(await models.isReady(id))) throw Object.assign(new SidecarError('model_missing'), { statusCode: 409 });
    ready.set(id, Date.now());
  }
  const keyOf = provider => {
    if (!vault?.available) return '';
    try {
      return vault.get(VAULT_ID, `key-${provider}`) || '';
    } catch {
      return '';
    }
  };
  // Fingerprint of the settings the running sidecar confirmed; '' while it is unconfirmed (new
  // process, failed configure, changed settings). Tasks only run on a confirmed configuration.
  let configured = '';
  const fingerprintOf = (s, apiKey, url) => JSON.stringify([s.provider, s.model, url, s.embedModel, apiKey.length]);
  async function effectiveUrl(s) {
    try {
      return await localUrl(s);
    } catch (err) {
      // A cloud model still answers; only embeddings (search) need the local runtime then.
      if (CLOUD_PROVIDERS.includes(s.provider)) return DEFAULT_AI_SETTINGS.baseUrl;
      throw err;
    }
  }
  async function configure(callRaw) {
    configured = '';
    const s = get();
    const apiKey = CLOUD_PROVIDERS.includes(s.provider) ? keyOf(s.provider) : '';
    const baseUrl = await effectiveUrl(s);
    const fingerprint = fingerprintOf(s, apiKey, baseUrl);
    const call = callRaw || ((m, p) => sidecar.call(m, p, { timeout: 15000 }));
    await call('configure', {
      provider: s.provider,
      model: s.model,
      baseUrl,
      embedModel: s.embedModel,
      apiKey
    });
    configured = fingerprint;
  }
  /** Fails closed: a task never runs on a sidecar that still has an older provider configured. */
  async function ensureConfigured() {
    const s = get();
    let url;
    try {
      url = await effectiveUrl(s);
    } catch (err) {
      throw Object.assign(new SidecarError(err.kind === 'runtime_missing' ? 'runtime_missing' : 'unreachable'), {
        statusCode: 503,
        cause: err
      });
    }
    const want = fingerprintOf(s, CLOUD_PROVIDERS.includes(s.provider) ? keyOf(s.provider) : '', url);
    if (configured === want && sidecar.running) return;
    try {
      await configure();
    } catch (err) {
      throw Object.assign(new SidecarError('not_configured'), { statusCode: 503, cause: err });
    }
    if (configured !== want) throw Object.assign(new SidecarError('not_configured'), { statusCode: 503 });
  }
  function publicSettings() {
    const s = get();
    return {
      ...s,
      keys: Object.fromEntries(CLOUD_PROVIDERS.map(p => [p, Boolean(keyOf(p))])),
      consentVersion: CONSENT_VERSION,
      vaultAvailable: Boolean(vault?.available),
      localRuntime: managed ? 'bundled' : 'external'
    };
  }
  /** True when content of this account must not reach the configured (cloud) model. */
  function cloudBlocked(accountId, s = get()) {
    return CLOUD_PROVIDERS.includes(s.provider) && Boolean(accountId) && s.noCloudAccounts.includes(accountId);
  }
  /**
   * `accountId` is the account the request is about; `sources` lists the account of every piece
   * of mail content in the model input (e.g. the hits of a question across all accounts). All of
   * them must be allowed for the configured provider.
   */
  function ensureAllowed(feature, accountId, sources = []) {
    const s = get();
    if (!s.enabled) throw Object.assign(new SidecarError('disabled'), { statusCode: 409 });
    if (feature && s.features[feature] === false)
      throw Object.assign(new SidecarError('feature_disabled'), { statusCode: 409 });
    if (CLOUD_PROVIDERS.includes(s.provider)) {
      if (s.consents[s.provider]?.version !== CONSENT_VERSION)
        throw Object.assign(new SidecarError('consent_missing'), { statusCode: 409 });
      if ([accountId, ...sources].some(id => cloudBlocked(id, s)))
        throw Object.assign(new SidecarError('cloud_blocked'), { statusCode: 409 });
      if (!keyOf(s.provider)) throw Object.assign(new SidecarError('auth'), { statusCode: 409 });
    }
    return s;
  }
  return {
    get,
    publicSettings,
    configure,
    async save(input) {
      const current = get();
      const next = validateAiSettings(input, current, { managed });
      if (input.apiKey !== undefined) {
        const provider = String(input.keyProvider || next.provider);
        if (!CLOUD_PROVIDERS.includes(provider)) throw invalid('Für lokale Modelle wird kein Schlüssel benötigt.');
        if (!vault?.available)
          throw invalid('Schlüsselbund nicht verfügbar. Der API-Schlüssel wird nicht gespeichert.', 'ai_vault');
        const key = String(input.apiKey).trim();
        if (key && !/^[\x21-\x7e]{8,300}$/.test(key)) throw invalid('API-Schlüssel ungültig.');
        if (key) vault.set(VAULT_ID, `key-${provider}`, key);
        else vault.delete?.(VAULT_ID, `key-${provider}`);
      }
      if (input.consent && typeof input.consent === 'object') {
        const provider = String(input.consent.provider);
        if (!CLOUD_PROVIDERS.includes(provider)) throw invalid('Unbekannter KI-Anbieter.');
        if (input.consent.granted === true)
          next.consents[provider] = { version: CONSENT_VERSION, at: new Date().toISOString() };
        else delete next.consents[provider];
      }
      if (
        CLOUD_PROVIDERS.includes(next.provider) &&
        next.enabled &&
        next.consents[next.provider]?.version !== CONSENT_VERSION
      )
        throw invalid('Für Cloud-KI ist zuerst die Einwilligung nötig.', 'ai_consent_missing');
      await settingsFile.save(next);
      void log.add({ type: 'settings', provider: next.provider, model: next.model, enabled: next.enabled });
      configured = '';
      if (sidecar.running) await configure().catch(() => {});
      return publicSettings();
    },
    async status() {
      const s = get();
      // The own runtime starts when the AI is on, so the settings can show its models.
      if (managed && s.enabled) await localRuntime.ensure().catch(() => {});
      try {
        const st = await sidecar.call('status', { probeOllama: true }, { timeout: 8000 });
        return {
          available: true,
          ...st,
          diagnostics: sidecar.diagnostics(),
          local: managed ? localRuntime.diagnostics() : null
        };
      } catch (err) {
        return {
          available: false,
          reason: err.kind || 'runtime_missing',
          enabled: s.enabled,
          local: managed ? localRuntime.diagnostics() : null
        };
      }
    },
    async models() {
      return sidecar.call('models', {}, { timeout: 10000 });
    },
    async pull(model) {
      if (!MODEL_NAME.test(String(model || '')) || isOllamaCloudModel(model)) throw invalid('Ungültiger Modellname.');
      // Own runtime: only catalog models, with progress and digest check (ollama-models.mjs).
      if (managed && models) return models.download(String(model));
      void log.add({ type: 'model_download', model });
      return sidecar.call('pull', { model }, { timeout: 60 * 60 * 1000 });
    },
    ensureAllowed,
    cloudBlocked: id => cloudBlocked(id),
    /** Runs one AI function. `accountId` decides whether a cloud model may see the content. */
    async run(kind, input, { accountId = null, sources = [], source = 'user' } = {}) {
      const feature = TASK_FEATURE[kind];
      if (!feature) throw invalid('Unbekannte KI-Funktion.');
      // Embeddings always run on the local Ollama, also when a cloud model writes the answers, so the
      // per-account cloud block does not apply to them.
      const s = kind === 'embed' ? ensureAllowed(feature, null) : ensureAllowed(feature, accountId, sources);
      const started = Date.now();
      try {
        await ensureConfigured();
        if (kind === 'embed') await ensureModelReady(s.embedModel);
        else if (s.provider === 'ollama') await ensureModelReady(s.model);
        const result = await sidecar.call('task', { kind, input });
        // Background indexing would flood the log; the indexer writes one entry per run instead.
        if (source !== 'index')
          void log.add({
            type: 'task',
            kind,
            provider: kind === 'embed' ? 'ollama' : s.provider,
            model: s.model,
            accountId,
            source,
            ok: true,
            ms: Date.now() - started
          });
        return result;
      } catch (err) {
        void log.add({
          type: 'task',
          kind,
          provider: s.provider,
          model: s.model,
          accountId,
          source,
          ok: false,
          error: err.kind || 'internal'
        });
        throw err;
      }
    },
    async agent(params, { accountId = null, source = 'routine' } = {}) {
      const s = ensureAllowed('agents', accountId);
      const started = Date.now();
      try {
        await ensureConfigured();
        if (s.provider === 'ollama') await ensureModelReady(s.model);
        const result = await sidecar.call('agent', params, { timeout: 15 * 60 * 1000 });
        void log.add({
          type: 'agent',
          provider: s.provider,
          model: s.model,
          source,
          ok: true,
          steps: result.steps?.length || 0,
          ms: Date.now() - started
        });
        return result;
      } catch (err) {
        void log.add({
          type: 'agent',
          provider: s.provider,
          model: s.model,
          source,
          ok: false,
          error: err.kind || 'internal'
        });
        throw err;
      }
    },
    /** Removes keys, consents and the log (the "forget everything" button). */
    async forget() {
      for (const p of CLOUD_PROVIDERS)
        try {
          vault?.delete?.(VAULT_ID, `key-${p}`);
        } catch {
          /* already gone */
        }
      await settingsFile.save({ ...DEFAULT_AI_SETTINGS });
      await log.clear();
      await sidecar.stop();
      ready.clear();
      logger('ai: settings, keys and log removed');
    },
    log,
    managed,
    localModels: models,
    localRuntime,
    get configuredFingerprint() {
      return configured;
    }
  };
}
