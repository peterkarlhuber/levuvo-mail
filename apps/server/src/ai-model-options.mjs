// Advanced model settings, per model: context length, maximum answer length, temperature and
// thinking. Every value is optional; an unset value means "automatic", i.e. the default chosen here
// or per AI function. Limits follow the memory of this computer and the size of the model.
//
// Context length matters most for local models: Ollama's own default is small (often 4,096
// tokens), and a longer prompt is cut at the start, where the rules of the system prompt are. The
// app's own Ollama therefore runs with the context length of the selected model, and the mails
// given to a question are trimmed to fit (`mailBudget`).
import { catalogEntry, recommendedTier } from './ai-model-catalog.mjs';

export const THINKING = ['auto', 'off', 'low', 'medium', 'high'];
export const CONTEXT_MIN = 2048;
export const CONTEXT_MAX = 131_072;
export const MAX_TOKENS_MIN = 256;
export const MAX_TOKENS_MAX = 16_384;
export const TEMPERATURE_MAX = 2;

// Memory of the context (KV cache) per token, by model size, in MiB. Estimates for the models of
// the catalog at 16-bit precision, rounded up.
const MIB_PER_TOKEN = { small: 0.12, standard: 0.16, large: 0.25 };
const DEFAULT_CONTEXT = { small: 8192, standard: 16_384, large: 32_768 };
// Kept free for the operating system, Levuvo Mail and other programs.
const RESERVE_GIB = 4;
// Above this much context memory the settings show a note.
export const MEMORY_NOTE_GIB = 2;

const GIB = 1024 ** 3;
const tierOf = (model, totalBytes) => {
  const entry = catalogEntry(model);
  if (entry && entry.kind === 'chat' && MIB_PER_TOKEN[entry.tier]) return entry.tier;
  // A model outside the catalog (development, own Ollama): assume it fits this computer.
  const tier = recommendedTier(totalBytes);
  return MIB_PER_TOKEN[tier] ? tier : 'standard';
};

/** Context memory in GiB for `tokens` tokens of `model`. */
export function contextMemoryGib(model, tokens, totalBytes) {
  return (tokens * MIB_PER_TOKEN[tierOf(model, totalBytes)]) / 1024;
}

/**
 * Limits and defaults for `model` on this computer. Cloud models get no context or temperature
 * setting: the provider decides the context, and its reasoning models reject a temperature.
 */
export function modelLimits(model, { provider = 'ollama', totalBytes }) {
  if (provider !== 'ollama')
    return {
      local: false,
      maxTokens: { min: MAX_TOKENS_MIN, max: MAX_TOKENS_MAX },
      thinking: false
    };
  const tier = tierOf(model, totalBytes);
  const entry = catalogEntry(model);
  const modelGib = entry ? entry.size / GIB : 0;
  const freeGib = Math.max(0, totalBytes / GIB - modelGib - RESERVE_GIB);
  const fits = Math.floor((freeGib * 1024) / MIB_PER_TOKEN[tier] / 1024) * 1024;
  const max = Math.max(4096, Math.min(CONTEXT_MAX, fits));
  return {
    local: true,
    context: {
      min: CONTEXT_MIN,
      max,
      default: Math.min(DEFAULT_CONTEXT[tier], max),
      mibPerToken: MIB_PER_TOKEN[tier],
      noteGib: MEMORY_NOTE_GIB
    },
    maxTokens: { min: MAX_TOKENS_MIN, max: MAX_TOKENS_MAX },
    temperature: { min: 0, max: TEMPERATURE_MAX },
    // Whether the model thinks is only known to Ollama; the setting is offered and ignored by
    // models that do not think.
    thinking: true
  };
}

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: 'ai_invalid' });
}

/**
 * Checks one model's advanced settings from the client. `null` (or a missing key) means automatic.
 * Returns the cleaned object, or null when everything is automatic ("Zurücksetzen").
 */
export function validateModelOptions(input, model, { provider, totalBytes }) {
  const limits = modelLimits(model, { provider, totalBytes });
  const out = {};
  const num = (value, min, max, message, integer = true) => {
    if (value === null || value === undefined || value === '') return undefined;
    const n = Number(value);
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) throw invalid(message);
    return n;
  };
  if (limits.local) {
    const c = num(input.contextLength, limits.context.min, limits.context.max, 'Kontextlänge außerhalb der Grenzen.');
    if (c !== undefined) out.contextLength = c;
    const temp = num(input.temperature, 0, TEMPERATURE_MAX, 'Temperatur außerhalb der Grenzen.', false);
    if (temp !== undefined) out.temperature = Math.round(temp * 100) / 100;
  }
  const m = num(input.maxTokens, MAX_TOKENS_MIN, MAX_TOKENS_MAX, 'Antwortlänge außerhalb der Grenzen.');
  if (m !== undefined) out.maxTokens = m;
  if (input.thinking !== undefined && input.thinking !== null && input.thinking !== 'auto') {
    if (!limits.thinking || !THINKING.includes(input.thinking)) throw invalid('Unbekannte Thinking-Stufe.');
    out.thinking = input.thinking;
  }
  return Object.keys(out).length ? out : null;
}

/** The settings in effect for the selected model: stored values, else the defaults. */
export function effectiveModelOptions(settings, totalBytes) {
  const limits = modelLimits(settings.model, { provider: settings.provider, totalBytes });
  const own = settings.modelOptions?.[settings.model] || {};
  const contextLength = limits.local ? Math.min(own.contextLength ?? limits.context.default, limits.context.max) : null;
  return {
    contextLength,
    maxTokens: own.maxTokens ?? null,
    temperature: limits.local ? (own.temperature ?? null) : null,
    thinking: own.thinking ?? 'auto'
  };
}

/**
 * How many characters of mail fit into a question: the context minus the answer, the rules and the
 * question (about 2,500 tokens), at roughly three characters per token. Cloud models keep the
 * fixed budget they always had.
 */
export function mailBudget({ contextLength, maxTokens }) {
  if (!contextLength) return 60_000;
  const tokens = contextLength - (maxTokens ?? 1500) - 2500;
  return Math.max(4000, Math.min(60_000, tokens * 3));
}
