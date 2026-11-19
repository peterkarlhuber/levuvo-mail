import { getJson, postJson } from './api';

// Client of the local AI functions (routes-ai.mjs). Every result is marked as AI-generated in the UI
// (EU AI Act Art. 50) and never applied without the user's action.

export type AiProvider = 'ollama' | 'anthropic' | 'openai';
export type AiFeature =
  | 'digest'
  | 'translate'
  | 'reply'
  | 'rewrite'
  | 'compose'
  | 'attachmentCheck'
  | 'prioritize'
  | 'classify'
  | 'extract'
  | 'assess'
  | 'search'
  | 'agents';

export type AiProfile = {
  tone: 'auto' | 'friendly' | 'formal' | 'casual' | 'brief';
  address: 'auto' | 'du' | 'sie';
  signoff: string;
  instructions: string;
};
export type AiSettings = {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  baseUrl: string;
  embedModel: string;
  features: Record<AiFeature, boolean>;
  consents: Partial<Record<AiProvider, { version: string; at: string }>>;
  noCloudAccounts: string[];
  profile?: AiProfile;
  keys: Partial<Record<AiProvider, boolean>>;
  consentVersion: string;
  vaultAvailable: boolean;
};

export type AiRuntime = {
  available: boolean;
  reason?: string;
  version?: string;
  orkexa?: string;
  ollama?: { running: boolean; version?: string };
};

export type MessageRef = { folder: string; uid: number };

export type AiResult<T> = { kind: string; result: T; provider: AiProvider; model: string; generated: true };

export const isCloud = (p: AiProvider) => p !== 'ollama';

/** Suggested local models. All are open-weight with a permissive license; any other Ollama model works too. */
export const DEFAULT_LOCAL_MODEL = 'qwen3.5:9b';
export const LOCAL_MODELS = [
  { id: 'qwen3.5:9b', note: 'Standard, ab 16 GB RAM (Apache 2.0)' },
  { id: 'qwen3.5:4b', note: 'Klein, ab 8 GB RAM (Apache 2.0)' },
  { id: 'qwen3.5:27b', note: 'Groß, ab 32 GB RAM (Apache 2.0)' },
  { id: 'mistral-small3.2', note: 'Groß, ab 32 GB RAM (Apache 2.0)' }
];
export const DEFAULT_EMBED_MODEL = 'qwen3-embedding:0.6b';
export const EMBED_MODELS = [
  { id: 'qwen3-embedding:0.6b', note: 'Standard, klein und mehrsprachig (Apache 2.0)' },
  { id: 'bge-m3', note: 'Alternative, mehrsprachig (MIT)' }
];

export const aiSettings = () => getJson<AiSettings>('/api/ai/settings');
export const aiStatus = () => getJson<{ settings: AiSettings; runtime: AiRuntime }>('/api/ai/status');
export const saveAiSettings = (body: Record<string, unknown>) =>
  postJson<AiSettings>('/api/ai/settings', body, 'ai-v1');

export function runAi<T>(
  kind: string,
  {
    account,
    refs,
    input,
    lang
  }: { account?: string; refs?: MessageRef[]; input?: Record<string, unknown>; lang: string }
) {
  return postJson<AiResult<T>>('/api/ai/run', { kind, account, refs, input, lang }, 'ai-v1');
}

let cached: { at: number; value: AiSettings | null } = { at: 0, value: null };
/** Settings with a short cache, for deciding whether to show AI buttons. */
export async function aiEnabled(feature: AiFeature): Promise<boolean> {
  if (Date.now() - cached.at > 30_000) {
    cached = { at: Date.now(), value: await aiSettings().catch(() => null) };
  }
  return Boolean(cached.value?.enabled && cached.value.features[feature] !== false);
}
/**
 * Whether the configured model runs on this device. Work the user did not start (sorting the
 * inbox in the background) only runs with a local model, never by sending every new message to a
 * cloud provider.
 */
export async function aiLocal(): Promise<boolean> {
  await aiEnabled('classify');
  return cached.value?.provider === 'ollama';
}
export function forgetAiCache() {
  cached = { at: 0, value: null };
}

/** Readable reason for an AI error code (ai_*). */
export function aiErrorText(code: string | undefined, t: (s: string) => string) {
  switch (code) {
    case 'ai_disabled':
      return t('KI ist ausgeschaltet. In den Einstellungen unter „KI & Agenten“ einschalten.');
    case 'ai_unreachable':
      return t('Das KI-Modell ist nicht erreichbar. Läuft Ollama?');
    case 'ai_model_missing':
      return t('Das gewählte Modell ist nicht installiert. In den Einstellungen herunterladen.');
    case 'ai_runtime_missing':
      return t('Die KI-Komponente fehlt in dieser Installation.');
    case 'ai_consent_missing':
      return t('Für Cloud-KI fehlt die Einwilligung.');
    case 'ai_cloud_blocked':
      return t('Für dieses Konto ist Cloud-KI gesperrt.');
    case 'ai_not_configured':
      return t('Der KI-Anbieter ließ sich nicht umstellen. Bitte die KI-Einstellungen prüfen.');
    case 'ai_auth':
      return t('API-Schlüssel fehlt oder ist ungültig.');
    case 'ai_timeout':
      return t('Das Modell hat zu lange gebraucht.');
    case 'ai_feature_disabled':
      return t('Diese KI-Funktion ist ausgeschaltet.');
    default:
      return t('KI-Funktion fehlgeschlagen.');
  }
}

export { defaultEnd, ownPart } from './ai-utils';
