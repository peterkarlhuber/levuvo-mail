import { AiMarkingSetting } from './SettingsPrivacyData';
import { useCallback, useEffect, useState } from 'react';
import { Bot, Download, LoaderCircle, RefreshCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { getJson, postJson } from './api';
import {
  aiStatus,
  DEFAULT_LOCAL_MODEL,
  EMBED_MODELS,
  LOCAL_MODELS,
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
import { Button } from './ui';
import { Row, Section, Segmented, Toggle } from './Settings';
import { McpSettings } from './SettingsMcp';
import { LocalModelSettings } from './SettingsLocalModels';
import { AiAdvancedSettings } from './SettingsAiAdvanced';
import { SemanticIndexStatus } from './SemanticIndexStatus';
import { StyleProfileSettings } from './SettingsStyle';
import { SpeechSettings } from './SettingsSpeech';
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

const FEATURES: { id: AiFeature; label: string; hint: string; optIn?: boolean }[] = [
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
  { id: 'agents', label: 'Agenten & Routinen', hint: 'Bereitet Entwürfe vor, die du freigibst' },
  { id: 'dictation', label: 'Diktieren', hint: 'Sprache wird auf diesem Gerät zu Text, mit Whisper' },
  {
    id: 'commitments',
    label: 'Versprechen-Tracker',
    hint: 'Liest neue gesendete und empfangene Mails im Hintergrund (nur mit lokalem Modell) und schlägt Aufgaben und Erinnerungen zu Zusagen vor. Standardmäßig aus.',
    optIn: true
  }
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
          'Für jede KI-Funktion, die du aufrufst, werden die dafür nötigen Inhalte an {provider} übertragen und dort verarbeitet, möglicherweise außerhalb der EU: die betroffenen Nachrichten; bei Antwortvorschlägen und „Stichpunkte zu fertiger Mail“ zusätzlich bis zu fünf deiner gesendeten Mails als Stilprobe und, wenn „Stil pro Kontakt lernen“ an ist, deine Anrede- und Grußgewohnheiten mit diesem Empfänger; bei Fragen an das Postfach die gefundenen Mails aller nicht gesperrten Konten samt Text ihrer PDF- und Textanhänge und die letzten zwei Fragen und Antworten; bei Aufgaben und Routinen des Assistenten die Mails, Termine, Kontakte und Aufgaben, die er dafür liest, und Inhalte von Räumen, die Cloud-KI erlauben. Für Konten, die du unten sperrst, wird nichts übertragen. Das Einsortieren im Hintergrund läuft nur mit einem lokalen Modell. Ohne diese Einwilligung bleibt alles lokal. Du kannst sie jederzeit widerrufen.',
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
    await save({ provider, model: provider === 'ollama' ? DEFAULT_LOCAL_MODEL : settings.model });
  }

  async function changeEmbedModel(input: HTMLInputElement) {
    const embedModel = input.value.trim();
    if (!settings || !embedModel || embedModel === settings.embedModel) return;
    const ok = await confirm({
      title: t('Suchmodell wechseln?'),
      message: t(
        'Der Suchindex wird mit {model} im Hintergrund neu aufgebaut. Bis dahin findet die semantische Suche weniger.',
        { model: embedModel }
      ),
      confirmLabel: t('Wechseln')
    });
    if (!ok) {
      input.value = settings.embedModel;
      return;
    }
    await save({ embedModel });
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
  const profile = { tone: 'auto', address: 'auto', signoff: '', instructions: '', ...settings.profile };
  const cloud = isCloud(settings.provider);
  const bundled = settings.localRuntime === 'bundled';
  const runtimeLine = !runtime?.available
    ? t('KI-Komponente nicht verfügbar ({reason}).', { reason: runtime?.reason || '–' })
    : settings.provider === 'ollama'
      ? runtime.ollama?.running
        ? t('Ollama {version} läuft auf diesem Computer.', { version: runtime.ollama.version || '' })
        : bundled
          ? t('Das eigene Ollama von Levuvo Mail startet beim ersten Gebrauch.')
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
        {bundled && (
          <LocalModelSettings
            enabled={settings.enabled}
            cloud={cloud}
            save={async body => {
              await save(body);
            }}
          />
        )}
        {!cloud && !bundled && (
          <>
            <Row label={t('Ollama-Adresse')} hint={t('Nur Adressen auf diesem Computer.')}>
              <input
                defaultValue={settings.baseUrl}
                onBlur={e => e.target.value !== settings.baseUrl && void save({ baseUrl: e.target.value })}
              />
            </Row>
            <Row
              label={t('Sprachmodell')}
              hint={t(LOCAL_MODELS.find(m => m.id === settings.model)?.note ?? 'Eigenes Modell aus Ollama.')}
            >
              <input
                list="ai-models"
                defaultValue={settings.model}
                onBlur={e => e.target.value !== settings.model && void save({ model: e.target.value })}
              />
              <datalist id="ai-models">
                {LOCAL_MODELS.map(m => (
                  <option key={m.id} value={m.id}>
                    {t(m.note)}
                  </option>
                ))}
                {models
                  .filter(m => !LOCAL_MODELS.some(p => p.id === m))
                  .map(m => (
                    <option key={m} value={m} />
                  ))}
              </datalist>
              {runtime?.ollama?.running && !models.includes(settings.model) && (
                <Button
                  size="sm"
                  icon={<Download size={14} />}
                  disabled={busy === 'pull'}
                  onClick={() => void pull(settings.model)}
                >
                  {t('Herunterladen')}
                </Button>
              )}
            </Row>
            <Row
              label={t('Modell für die Suche')}
              hint={t('Läuft immer lokal, auch bei Cloud-KI. {note}', {
                note: t(EMBED_MODELS.find(m => m.id === settings.embedModel)?.note ?? '')
              })}
            >
              <input
                list="ai-embed-models"
                defaultValue={settings.embedModel}
                onBlur={e => void changeEmbedModel(e.target)}
              />
              <datalist id="ai-embed-models">
                {EMBED_MODELS.map(m => (
                  <option key={m.id} value={m.id}>
                    {t(m.note)}
                  </option>
                ))}
              </datalist>
              {runtime?.ollama?.running && !models.some(m => m.startsWith(settings.embedModel)) && (
                <Button
                  size="sm"
                  icon={<Download size={14} />}
                  disabled={busy === 'pull'}
                  onClick={() => void pull(settings.embedModel)}
                >
                  {t('Herunterladen')}
                </Button>
              )}
            </Row>
            <SemanticIndexStatus />
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
              <Button
                size="sm"
                disabled={!key || busy === 'save'}
                onClick={() => void save({ apiKey: key, keyProvider: settings.provider }).then(() => setKey(''))}
              >
                {t('Speichern')}
              </Button>
            </Row>
            <div className="settings-actions">
              <Button
                size="sm"
                variant="danger"
                onClick={() =>
                  void save({
                    provider: 'ollama',
                    consent: { provider: settings.provider, granted: false },
                    model: DEFAULT_LOCAL_MODEL
                  })
                }
              >
                {t('Einwilligung widerrufen')}
              </Button>
            </div>
          </>
        )}
        <AiAdvancedSettings settings={settings} save={save} />
      </Section>

      <Section title={t('Funktionen')} description={t('Jede Funktion lässt sich einzeln abschalten.')}>
        {FEATURES.map(f => (
          <Row key={f.id} label={t(f.label)} hint={t(f.hint)}>
            <Toggle
              label={t(f.label)}
              checked={f.optIn ? settings.features[f.id] === true : settings.features[f.id] !== false}
              onChange={v => void save({ features: { [f.id]: v } })}
            />
          </Row>
        ))}
      </Section>

      <Section
        title={t('Schreibstil')}
        description={t(
          'Gilt für Antwortvorschläge, Umformulieren und Stichpunkte zu Mail. Ohne Angaben orientiert sich die KI an deinen gesendeten Mails. Die Sicherheitsregeln der KI lassen sich nicht ändern.'
        )}
      >
        <Row label={t('Tonfall')}>
          <select
            value={profile.tone}
            onChange={e => void save({ profile: { tone: e.target.value } })}
            aria-label={t('Tonfall')}
          >
            <option value="auto">{t('Wie in meinen Mails')}</option>
            <option value="friendly">{t('Freundlich')}</option>
            <option value="formal">{t('Förmlich')}</option>
            <option value="casual">{t('Locker')}</option>
            <option value="brief">{t('Möglichst kurz')}</option>
          </select>
        </Row>
        <Row label={t('Anrede')} hint={t('Für deutschsprachige Mails.')}>
          <select
            value={profile.address}
            onChange={e => void save({ profile: { address: e.target.value } })}
            aria-label={t('Anrede')}
          >
            <option value="auto">{t('Wie in der Unterhaltung')}</option>
            <option value="du">{t('Du-Form')}</option>
            <option value="sie">{t('Sie-Form')}</option>
          </select>
        </Row>
        <Row
          wide
          label={t('Grußformel')}
          hint={t('Zum Beispiel „Liebe Grüße“. Die Signatur fügt Levuvo Mail selbst an.')}
        >
          <input
            maxLength={200}
            defaultValue={profile.signoff}
            onBlur={e => e.target.value !== profile.signoff && void save({ profile: { signoff: e.target.value } })}
          />
        </Row>
        <Row
          wide
          label={t('Eigene Anweisungen')}
          hint={t('Zum Beispiel „Keine Ausrufezeichen, Termine immer mit Wochentag“.')}
        >
          <textarea
            rows={4}
            maxLength={1000}
            defaultValue={profile.instructions}
            onBlur={e =>
              e.target.value !== profile.instructions && void save({ profile: { instructions: e.target.value } })
            }
          />
        </Row>
        <StyleProfileSettings onToggle={on => save({ profile: { learnStyle: on } })} />
      </Section>

      <Section
        title={t('Diktieren')}
        description={t(
          'Im Editor auf „Diktieren“ klicken, sprechen, „Fertig“: der Text erscheint an der Schreibmarke.'
        )}
      >
        <SpeechSettings />
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

      <AiMarkingSetting />

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
          <Button size="sm" icon={<RefreshCcw size={14} />} onClick={() => void load()}>
            {t('Aktualisieren')}
          </Button>
          <Button
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={async () => {
              await postJson('/api/ai/log/clear', {}, 'ai-v1');
              void load();
            }}
          >
            {t('Protokoll leeren')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={14} />}
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
            {t('Alle KI-Daten löschen')}
          </Button>
        </div>
      </Section>
    </>
  );
}
