// Settings → KI & Agenten → Erweitert: context length, maximum answer length, temperature and
// thinking for the selected model. Collapsed by default; every value can stay "automatic", and
// "Zurücksetzen" brings the model back to the defaults. The server checks the limits again.
import { useEffect, useState } from 'react';
import type { AiSettings, ModelOptions } from './ai';
import { useT } from './i18n';
import { Button } from './ui';
import { Row } from './Settings';

type Props = { settings: AiSettings; save: (body: Record<string, unknown>) => Promise<void> };

const GIB = 1024 ** 3;
const num = (value: string) => (value.trim() === '' ? null : Number(value));

export function AiAdvancedSettings({ settings, save }: Props) {
  const { t, locale } = useT();
  const limits = settings.modelLimits;
  const own: ModelOptions = settings.modelOptions?.[settings.model] || {};
  const [draft, setDraft] = useState({
    contextLength: own.contextLength?.toString() ?? '',
    maxTokens: own.maxTokens?.toString() ?? '',
    temperature: own.temperature?.toString() ?? '',
    thinking: own.thinking ?? 'auto'
  });
  // Another model selected, or saved elsewhere: show its values.
  useEffect(() => {
    setDraft({
      contextLength: own.contextLength?.toString() ?? '',
      maxTokens: own.maxTokens?.toString() ?? '',
      temperature: own.temperature?.toString() ?? '',
      thinking: own.thinking ?? 'auto'
    });
  }, [settings.model, own.contextLength, own.maxTokens, own.temperature, own.thinking]);
  if (!limits) return null;

  const fmt = (n: number) => n.toLocaleString(locale);
  const store = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    void save({
      modelOptions: {
        model: settings.model,
        contextLength: num(next.contextLength),
        maxTokens: num(next.maxTokens),
        temperature: num(next.temperature),
        thinking: next.thinking
      }
    });
  };
  const context = limits.context;
  const contextNow = num(draft.contextLength) ?? context?.default ?? 0;
  const memory = context ? (contextNow * context.mibPerToken) / 1024 : 0;
  const ramGib = settings.totalMemory ? settings.totalMemory / GIB : 0;
  const changed = Boolean(draft.contextLength || draft.maxTokens || draft.temperature || draft.thinking !== 'auto');

  return (
    <details className="settings-advanced">
      <summary>{t('Erweitert')}</summary>
      <p className="settings-description">
        {t('Gilt für das Modell {model}. Leere Felder bedeuten „Automatisch“.', { model: settings.model })}
      </p>
      {context && (
        <Row
          label={t('Kontextlänge (Tokens)')}
          hint={t(
            'Wie viel Text das Modell auf einmal lesen kann: Regeln, Frage und gefundene Mails zusammen. Die maximale Antwortlänge begrenzt dagegen nur, wie lang die Antwort werden darf. Standard {value}, erlaubt {min} bis {max}.',
            { value: fmt(context.default), min: fmt(context.min), max: fmt(context.max) }
          )}
        >
          <input
            type="number"
            inputMode="numeric"
            min={context.min}
            max={context.max}
            step={1024}
            placeholder={fmt(context.default)}
            value={draft.contextLength}
            onChange={e => setDraft(d => ({ ...d, contextLength: e.target.value }))}
            onBlur={e =>
              e.target.value !== (own.contextLength?.toString() ?? '') && store({ contextLength: e.target.value })
            }
          />
        </Row>
      )}
      {context && memory >= context.noteGib && (
        <p className="ai-hint" role="status">
          {t(
            'Diese Kontextlänge braucht etwa {gib} GB zusätzlichen Arbeitsspeicher neben dem Modell (dieser Computer hat {ram} GB). Bei zu wenig Speicher wird das Modell langsam.',
            {
              gib: memory.toLocaleString(locale, { maximumFractionDigits: 1 }),
              ram: ramGib.toLocaleString(locale, { maximumFractionDigits: 0 })
            }
          )}
        </p>
      )}
      <Row
        label={t('Max. Antwortlänge (Tokens)')}
        hint={t(
          'Obergrenze für eine Antwort (Max Tokens). Automatisch: passend zur Funktion, z. B. {example} für Fragen ans Postfach. Erlaubt {min} bis {max}.',
          { example: fmt(1500), min: fmt(limits.maxTokens.min), max: fmt(limits.maxTokens.max) }
        )}
      >
        <input
          type="number"
          inputMode="numeric"
          min={limits.maxTokens.min}
          max={limits.maxTokens.max}
          step={256}
          placeholder={t('Automatisch')}
          value={draft.maxTokens}
          onChange={e => setDraft(d => ({ ...d, maxTokens: e.target.value }))}
          onBlur={e => e.target.value !== (own.maxTokens?.toString() ?? '') && store({ maxTokens: e.target.value })}
        />
      </Row>
      {limits.temperature && (
        <Row
          label={t('Temperatur')}
          hint={t(
            'Niedrig (0 bis 0,3) antwortet sachlich und gleichbleibend, höher (bis 2) abwechslungsreicher. Automatisch: 0,2 für Fragen ans Postfach, sonst der Standard des Modells.'
          )}
        >
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={limits.temperature.max}
            step={0.1}
            placeholder={t('Automatisch')}
            value={draft.temperature}
            onChange={e => setDraft(d => ({ ...d, temperature: e.target.value }))}
            onBlur={e =>
              e.target.value !== (own.temperature?.toString() ?? '') && store({ temperature: e.target.value })
            }
          />
        </Row>
      )}
      {limits.thinking && (
        <Row
          label={t('Thinking')}
          hint={t(
            'Ob das Modell vor der Antwort nachdenkt. Gilt nur für Modelle, die das können (z. B. Qwen 3.5). Automatisch: aus bei Fragen ans Postfach, damit sie schnell bleiben.'
          )}
        >
          <select value={draft.thinking} onChange={e => store({ thinking: e.target.value as typeof draft.thinking })}>
            <option value="auto">{t('Automatisch')}</option>
            <option value="off">{t('Aus')}</option>
            <option value="low">{t('Niedrig')}</option>
            <option value="medium">{t('Mittel')}</option>
            <option value="high">{t('Hoch')}</option>
          </select>
        </Row>
      )}
      <div className="settings-actions">
        <Button
          size="sm"
          disabled={!changed}
          onClick={() => store({ contextLength: '', maxTokens: '', temperature: '', thinking: 'auto' })}
        >
          {t('Zurücksetzen')}
        </Button>
      </div>
    </details>
  );
}
