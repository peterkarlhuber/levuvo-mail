// AI settings, consent, keys and the activity log.
// Off by default. Local models (Ollama on this computer) are the default provider; a cloud provider is
// used only after the user consented to it (DSGVO Art. 6/7, documented with time and text version) and
// never for accounts marked as "no cloud AI" (e.g. professional secrecy). API keys live in the system
// keychain only. The log stores what happened, never the content of a message.
import { appendFile, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SidecarError } from './ai-sidecar.mjs';

export const CONSENT_VERSION = '2026-11-18';
export const AI_PROVIDERS = ['ollama', 'anthropic', 'openai'];
export const CLOUD_PROVIDERS = ['anthropic', 'openai'];
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
  'agents'
];
const TASK_FEATURE = {
  digest: 'digest',
  translate: 'translate',
  reply: 'reply',
  rewrite: 'rewrite',
  compose: 'compose',
  attachment_check: 'attachmentCheck',
  presend: 'attachmentCheck',
  prioritize: 'prioritize',
  classify: 'classify',
  extract: 'extract',
  assess: 'assess',
  ask: 'search',
  embed: 'search'
};
const LOG_DAYS = 30;
const LOG_MAX = 5000;
const VAULT_ID = 'ai';

export const DEFAULT_AI_SETTINGS = {
  enabled: false,
  provider: 'ollama',
  model: 'qwen3.5:9b',
  baseUrl: 'http://127.0.0.1:11434',
  embedModel: 'qwen3-embedding:0.6b',
  features: Object.fromEntries(AI_FEATURES.map(f => [f, true])),
  consents: {},
  noCloudAccounts: [],
  profile: { tone: 'auto', address: 'auto', signoff: '', instructions: '' }
};
export const AI_TONES = ['auto', 'friendly', 'formal', 'casual', 'brief'];
export const AI_ADDRESS = ['auto', 'du', 'sie'];

function invalid(message, code = 'ai_invalid') {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

const MODEL_NAME = /^[A-Za-z0-9._:/-]{1,120}$/;

export function validateAiSettings(input, current) {
  const next = { ...current, features: { ...current.features }, consents: { ...current.consents } };
  if (input.enabled !== undefined) next.enabled = input.enabled === true;
  if (input.provider !== undefined) {
    if (!AI_PROVIDERS.includes(input.provider)) throw invalid('Unbekannter KI-Anbieter.');
    next.provider = input.provider;
  }
  for (const key of ['model', 'embedModel']) {
    if (input[key] === undefined) continue;
    const value = String(input[key]).trim();
    if (!MODEL_NAME.test(value) || value.endsWith(':cloud')) throw invalid('Ungültiger Modellname.');
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
    const tmp = `${filename}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, kept.map(e => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''), { mode: 0o600 });
    await rename(tmp, filename);
  }
  let writes = 0;
  return {
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

export function createAiService({ settingsFile, vault, sidecar, log, logger = () => {} }) {
  const get = () => ({ ...DEFAULT_AI_SETTINGS, ...settingsFile.get() });
  const keyOf = provider => {
    if (!vault?.available) return '';
    try {
      return vault.get(VAULT_ID, `key-${provider}`) || '';
    } catch {
      return '';
    }
  };
  let configured = '';
  async function configure(callRaw) {
    const s = get();
    const apiKey = CLOUD_PROVIDERS.includes(s.provider) ? keyOf(s.provider) : '';
    const fingerprint = JSON.stringify([s.provider, s.model, s.baseUrl, s.embedModel, apiKey.length]);
    const call = callRaw || ((m, p) => sidecar.call(m, p, { timeout: 15000 }));
    await call('configure', {
      provider: s.provider,
      model: s.model,
      baseUrl: s.baseUrl,
      embedModel: s.embedModel,
      apiKey
    });
    configured = fingerprint;
  }
  function publicSettings() {
    const s = get();
    return {
      ...s,
      keys: Object.fromEntries(CLOUD_PROVIDERS.map(p => [p, Boolean(keyOf(p))])),
      consentVersion: CONSENT_VERSION,
      vaultAvailable: Boolean(vault?.available)
    };
  }
  function ensureAllowed(feature, accountId) {
    const s = get();
    if (!s.enabled) throw Object.assign(new SidecarError('disabled'), { statusCode: 409 });
    if (feature && s.features[feature] === false)
      throw Object.assign(new SidecarError('feature_disabled'), { statusCode: 409 });
    if (CLOUD_PROVIDERS.includes(s.provider)) {
      if (s.consents[s.provider]?.version !== CONSENT_VERSION)
        throw Object.assign(new SidecarError('consent_missing'), { statusCode: 409 });
      if (accountId && s.noCloudAccounts.includes(accountId))
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
      const next = validateAiSettings(input, current);
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
      try {
        const st = await sidecar.call('status', { probeOllama: true }, { timeout: 8000 });
        return { available: true, ...st, diagnostics: sidecar.diagnostics() };
      } catch (err) {
        return { available: false, reason: err.kind || 'runtime_missing', enabled: s.enabled };
      }
    },
    async models() {
      return sidecar.call('models', {}, { timeout: 10000 });
    },
    async pull(model) {
      if (!MODEL_NAME.test(String(model || '')) || String(model).endsWith(':cloud'))
        throw invalid('Ungültiger Modellname.');
      void log.add({ type: 'model_download', model });
      return sidecar.call('pull', { model }, { timeout: 60 * 60 * 1000 });
    },
    ensureAllowed,
    /** Runs one AI function. `accountId` decides whether a cloud model may see the content. */
    async run(kind, input, { accountId = null, source = 'user' } = {}) {
      const feature = TASK_FEATURE[kind];
      if (!feature) throw invalid('Unbekannte KI-Funktion.');
      // Embeddings always run on the local Ollama, also when a cloud model writes the answers, so the
      // per-account cloud block does not apply to them.
      const s = ensureAllowed(feature, kind === 'embed' ? null : accountId);
      const started = Date.now();
      try {
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
      logger('ai: settings, keys and log removed');
    },
    log,
    get configuredFingerprint() {
      return configured;
    }
  };
}
