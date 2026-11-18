import { useCallback, useEffect, useState } from 'react';
import { Bot, Download, LoaderCircle, RefreshCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { getJson, postJson } from './api';
import {
  aiStatus,
  forgetAiCache,
  isCloud,
  saveAiSettings,
  type AiFeature,
  type AiProvider,
  type AiRuntime,
  type AiSettings
} from './ai';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Row, Section, Segmented, Toggle } from './Settings';
import { McpSettings } from './SettingsMcp';
import type { AccountItem } from './types';

type LogEntry = {
  at: string;
  type: string;
  kind?: string;
  tool?: string;
  provider?: string;
  model?: string;
  ok?: boolean;
  error?: string;
  agent?: string;
  source?: string;
  reason?: string;
};

const FEATURES: { id: AiFeature; label: string; hint: string }[] = [
  {
    id: 'digest',
    label: 'Zusammenfassen & Kernaussagen',
    hint: 'Wer will was bis wann, Fristen, Beträge, offene Fragen'
  },
  { id: 'translate', label: 'Übersetzen', hint: 'Fremdsprachige Nachrichten im Lesebereich' },
  { id: 'reply', label: 'Antwortvorschläge', hint: 'Im eigenen Ton, gelernt aus den letzten gesendeten Nachrichten' },
  { id: 'rewrite', label: 'Umformulieren', hint: 'Kürzer, höflicher, formeller, auf Englisch' },
  { id: 'compose', label: 'Stichpunkte zu Nachricht', hint: 'Aus Stichpunkten eine fertige Nachricht' },
  { id: 'attachmentCheck', label: 'Vergessene Anhänge', hint: 'Prüft vor dem Senden, ob ein Anhang erwähnt wird' },
  { id: 'prioritize', label: 'Priorisierung', hint: 'Was heute wirklich deine Antwort braucht' },
  { id: 'classify', label: 'Bündel & Screening', hint: 'Sortiert Nachrichten in Bündel' },
  {
    id: 'extract',
    label: 'Termine & Aufgaben erkennen',
    hint: 'Vorschläge aus freiem Text, nie automatisch eingetragen'
  },
  { id: 'assess', label: 'Phishing- & Betrugseinschätzung', hint: 'Begründung zusätzlich zu den festen Prüfregeln' },
  { id: 'search', label: 'Semantische Suche & Fragen', hint: 'Suche nach Bedeutung, Antworten mit Quellnachricht' },
  { id: 'agents', label: 'Agenten & Routinen', hint: 'Bereitet Entwürfe vor, die du freigibst' }
];

const PROVIDER_NAMES: Record<AiProvider, string> = { ollama: 'Ollama', anthropic: 'Anthropic', openai: 'OpenAI' };

export function AiSettingsPanel({ accounts }: { accounts: AccountItem[] }) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [runtime, setRuntime] = useState<AiRuntime | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState('');
  const [key, setKey] = useState('');

  const load = useCallback(async () => {
    const st = await aiStatus().catch(() => null);
    if (!st) return;
    setSettings(st.settings);
    setRuntime(st.runtime);
    if (st.runtime.available && st.runtime.ollama?.running)
      void getJson<{ models: { name: string }[] }>('/api/ai/models')
        .then(r => setModels(r.models.map(m => m.name)))
        .catch(() => setModels([]));
    void getJson<{ entries: LogEntry[] }>('/api/ai/log')
      .then(r => setLog(r.entries))
      .catch(() => {});
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(body: Record<string, unknown>) {
    setBusy('save');
    try {
      setSettings(await saveAiSettings(body));
      forgetAiCache();
      void load();
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    } finally {
      setBusy('');
    }
  }

  async function chooseProvider(provider: AiProvider) {
    if (!settings) return;
    if (isCloud(provider) && settings.consents[provider]?.version !== settings.consentVersion) {
      const ok = await confirm({
        title: t('Cloud-KI von {provider} verwenden?', { provider: PROVIDER_NAMES[provider] }),
        message: t(
          'Für jede KI-Funktion, die du aufrufst, wird der Inhalt der betroffenen Nachrichten an {provider} übertragen und dort verarbeitet, möglicherweise außerhalb der EU. Für Konten, die du unten sperrst, wird nichts übertragen. Ohne diese Einwilligung bleibt alles lokal. Du kannst sie jederzeit widerrufen.',
          { provider: PROVIDER_NAMES[provider] }
        ),
        confirmLabel: t('Einwilligen'),
        danger: true
      });
      if (!ok) return;
      await save({
        provider,
        consent: { provider, granted: true },
        model: provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-5.5-mini'
      });
      return;
    }
    await save({ provider, model: provider === 'ollama' ? 'qwen3.5:4b' : settings.model });
  }

  async function pull(model: string) {
    setBusy('pull');
    toast({ text: t('{model} wird heruntergeladen. Das kann einige Minuten dauern.', { model }), kind: 'info' });
    try {
      await postJson('/api/ai/pull', { model }, 'ai-v1');
      toast({ text: t('{model} ist bereit.', { model }), kind: 'success' });
      void load();
    } catch (err) {
      toast({ text: (err as Error).message, kind: 'error' });
    } finally {
      setBusy('');
    }
  }

  if (!settings) return <LoaderCircle className="spin" size={18} />;
  const cloud = isCloud(settings.provider);
  const runtimeLine = !runtime?.available
    ? t('KI-Komponente nicht verfügbar ({reason}).', { reason: runtime?.reason || '–' })
    : settings.provider === 'ollama'
      ? runtime.ollama?.running
        ? t('Ollama {version} läuft auf diesem Computer.', { version: runtime.ollama.version || '' })
        : t('Ollama läuft nicht. Bitte Ollama installieren und starten (ollama.com).')
      : t('Cloud-Modell von {provider}.', { provider: PROVIDER_NAMES[settings.provider] });

  return (
    <>
      <Section
        title={t('KI-Assistent')}
        description={t(
          'Optional und standardmäßig aus. Mit einem lokalen Modell (Ollama) verlässt kein Inhalt deinen Computer. KI-Ergebnisse sind immer gekennzeichnet und werden nie ohne dein Zutun übernommen, gesendet, verschoben oder gelöscht.'
        )}
      >
        <Row label={t('KI-Funktionen')} hint={runtimeLine}>
          <Toggle label={t('KI-Funktionen')} checked={settings.enabled} onChange={v => void save({ enabled: v })} />
        </Row>
        <Row
          label={t('Modell-Anbieter')}
          hint={
            cloud
              ? t('Cloud: Inhalte werden an den Anbieter übertragen.')
              : t('Lokal: nichts verlässt diesen Computer.')
          }
        >
          <Segmented
            label={t('Modell-Anbieter')}
            value={settings.provider}
            onChange={p => void chooseProvider(p)}
            options={[
              { value: 'ollama', label: t('Lokal (Ollama)') },
              { value: 'anthropic', label: 'Anthropic' },
              { value: 'openai', label: 'OpenAI' }
            ]}
          />
        </Row>
        {!cloud && (
          <>
            <Row label={t('Ollama-Adresse')} hint={t('Nur Adressen auf diesem Computer.')}>
              <input
                defaultValue={settings.baseUrl}
                onBlur={e => e.target.value !== settings.baseUrl && void save({ baseUrl: e.target.value })}
              />
            </Row>
            <Row label={t('Sprachmodell')} hint={t('Empfohlen: qwen3.5:4b (Apache-2.0-Lizenz), ab 8 GB RAM.')}>
              <input
                list="ai-models"
                defaultValue={settings.model}
                onBlur={e => e.target.value !== settings.model && void save({ model: e.target.value })}
              />
              <datalist id="ai-models">
                {models.map(m => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {runtime?.ollama?.running && !models.includes(settings.model) && (
                <button className="btn small" disabled={busy === 'pull'} onClick={() => void pull(settings.model)}>
                  <Download size={14} /> {t('Herunterladen')}
                </button>
              )}
            </Row>
            <Row label={t('Modell für die Suche')} hint={t('Läuft immer lokal, auch bei Cloud-KI.')}>
              <input
                list="ai-models"
                defaultValue={settings.embedModel}
                onBlur={e => e.target.value !== settings.embedModel && void save({ embedModel: e.target.value })}
              />
              {runtime?.ollama?.running && !models.some(m => m.startsWith(settings.embedModel)) && (
                <button className="btn small" disabled={busy === 'pull'} onClick={() => void pull(settings.embedModel)}>
                  <Download size={14} /> {t('Herunterladen')}
                </button>
              )}
            </Row>
          </>
        )}
        {cloud && (
          <>
            <Row label={t('Modell')}>
              <input
                defaultValue={settings.model}
                onBlur={e => e.target.value !== settings.model && void save({ model: e.target.value })}
              />
            </Row>
            <Row
              label={t('API-Schlüssel')}
              hint={
                settings.keys[settings.provider]
                  ? t('Im Schlüsselbund gespeichert.')
                  : t('Wird nur im Schlüsselbund gespeichert.')
              }
            >
              <input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} />
              <button
                className="btn small"
                disabled={!key || busy === 'save'}
                onClick={() => void save({ apiKey: key, keyProvider: settings.provider }).then(() => setKey(''))}
              >
                {t('Speichern')}
              </button>
            </Row>
            <div className="settings-actions">
              <button
                className="btn small danger"
                onClick={() =>
                  void save({
                    provider: 'ollama',
                    consent: { provider: settings.provider, granted: false },
                    model: 'qwen3.5:4b'
                  })
                }
              >
                {t('Einwilligung widerrufen')}
              </button>
            </div>
          </>
        )}
      </Section>

      <Section title={t('Funktionen')} description={t('Jede Funktion lässt sich einzeln abschalten.')}>
        {FEATURES.map(f => (
          <Row key={f.id} label={t(f.label)} hint={t(f.hint)}>
            <Toggle
              label={t(f.label)}
              checked={settings.features[f.id] !== false}
              onChange={v => void save({ features: { [f.id]: v } })}
            />
          </Row>
        ))}
      </Section>

      <Section
        title={t('Keine Cloud-KI für diese Konten')}
        description={t(
          'Für gesperrte Konten verarbeiten nur lokale Modelle Inhalte, zum Beispiel bei Berufsgeheimnissen oder sensiblen Daten.'
        )}
      >
        {accounts.map(a => (
          <Row key={a.id} label={a.label}>
            <Toggle
              label={a.label}
              checked={settings.noCloudAccounts.includes(a.id)}
              onChange={v =>
                void save({
                  noCloudAccounts: v
                    ? [...settings.noCloudAccounts, a.id]
                    : settings.noCloudAccounts.filter(id => id !== a.id)
                })
              }
            />
          </Row>
        ))}
      </Section>

      <McpSettings />

      <Section
        title={t('KI-Protokoll')}
        description={t(
          'Was die KI und Agenten getan haben, ohne Nachrichteninhalte. Bleibt 30 Tage auf diesem Gerät und dient nicht der Leistungskontrolle.'
        )}
      >
        <div className="ai-log">
          {log.length === 0 && <small>{t('Noch keine Einträge.')}</small>}
          {log.slice(0, 60).map((e, i) => (
            <div className="status-line" key={`${e.at}-${i}`}>
              {e.type === 'tool' || e.type === 'agent' ? <Bot size={14} /> : <ShieldCheck size={14} />}
              <span>
                <strong>{[e.agent, e.kind || e.tool || e.type].filter(Boolean).join(' · ')}</strong>
                <small>
                  {new Date(e.at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
                  {e.provider ? ` · ${e.provider}${e.model ? ` ${e.model}` : ''}` : ''}
                  {e.ok === false ? ` · ${t('fehlgeschlagen')} (${e.error || e.reason || ''})` : ''}
                </small>
              </span>
            </div>
          ))}
        </div>
        <div className="settings-actions">
          <button className="btn small" onClick={() => void load()}>
            <RefreshCcw size={14} /> {t('Aktualisieren')}
          </button>
          <button
            className="btn small"
            onClick={async () => {
              await postJson('/api/ai/log/clear', {}, 'ai-v1');
              void load();
            }}
          >
            <Trash2 size={14} /> {t('Protokoll leeren')}
          </button>
          <button
            className="btn small danger"
            onClick={async () => {
              if (
                await confirm({
                  title: t('Alle KI-Daten löschen?'),
                  message: t(
                    'Einstellungen, Einwilligungen, API-Schlüssel, Protokoll, Agenten-Zugänge und der semantische Suchindex werden auf diesem Gerät gelöscht. Deine Nachrichten bleiben unverändert.'
                  ),
                  confirmLabel: t('Alles löschen'),
                  danger: true
                })
              ) {
                await postJson('/api/ai/forget', { confirm: 'FORGET_AI' }, 'ai-v1');
                forgetAiCache();
                void load();
              }
            }}
          >
            <Trash2 size={14} /> {t('Alle KI-Daten löschen')}
          </button>
        </div>
      </Section>
    </>
  );
}
