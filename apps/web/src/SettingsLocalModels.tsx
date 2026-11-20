// Local models of Levuvo Mail's own Ollama: a fixed list to choose from. Choosing a model that is on this
// computer switches to it; choosing one that is not shows its size and a download button, and it
// becomes active once it is downloaded and verified. Downloads have a progress bar, cancel, resume
// and delete. The search model can be switched; its index is then
// rebuilt in the background and its progress is shown here.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Download, Pause, Play, Trash2, X } from 'lucide-react';
import { ApiError, getJson, postJson } from './api';
import { aiErrorText } from './ai-errors';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { Button } from './ui';
import { Row } from './Settings';
import { formatBytes } from './format';
import { SemanticIndexStatus } from './SemanticIndexStatus';

type Tier = 'small' | 'standard' | 'large' | 'search';
type Fit = 'good' | 'tight' | 'too_big';
type Job = {
  status: 'downloading' | 'verifying' | 'done' | 'canceled' | 'error';
  completed: number;
  total: number;
  error: string | null;
};
export type LocalModel = {
  id: string;
  name: string;
  vendor: string;
  origin: string;
  eu: boolean;
  kind: 'chat' | 'embed';
  tier: Tier;
  license: string;
  licenseUrl: string;
  size: number;
  default: boolean;
  fit: Fit;
  installed: boolean;
  mismatch: boolean;
  job: Job | null;
};
type IndexProgress = { accountId: string; messages: number | null; vectors: number | null; running: boolean };
export type LocalModelsState = {
  reachable: boolean;
  ram: number;
  recommendedTier: Tier;
  freeBytes: number | null;
  models: LocalModel[];
  selected: { model: string; embedModel: string; provider: string };
  index: IndexProgress[];
  runtime: { version?: string; running?: boolean };
};

const TIERS: { tier: Tier; label: string }[] = [
  { tier: 'small', label: 'Klein, ab 8 GB Arbeitsspeicher' },
  { tier: 'standard', label: 'Standard, ab 16 GB Arbeitsspeicher' },
  { tier: 'large', label: 'Groß, ab 32 GB Arbeitsspeicher' }
];
const TIER_NAMES: Record<Tier, string> = { small: 'Klein', standard: 'Standard', large: 'Groß', search: 'Suche' };

// Kept free next to a download (DISK_RESERVE in apps/server/src/ollama-models.mjs).
const DISK_RESERVE = 2 * 1024 ** 3;

const busy = (j: Job | null) => j?.status === 'downloading' || j?.status === 'verifying';

/** Model, download and disk sizes: the app-wide formatter, so all numbers on this page agree. */
export const formatSize = (bytes: number, locale: string) => formatBytes(bytes, locale);

export function percent(job: Job | null) {
  if (!job || !job.total) return 0;
  return Math.min(100, Math.floor((job.completed / job.total) * 100));
}

export function LocalModelSettings({
  save,
  enabled,
  cloud = false
}: {
  save: (body: Record<string, unknown>) => Promise<void>;
  enabled: boolean;
  /** A cloud model writes the answers: only the (always local) search model is chosen here. */
  cloud?: boolean;
}) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const [state, setState] = useState<LocalModelsState | null>(null);
  const [failed, setFailed] = useState('');
  // Chosen in the list but not downloaded yet: the active model stays until this one is ready.
  const [pending, setPending] = useState<{ chat?: string; embed?: string }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await getJson<LocalModelsState>('/api/ai/local-models'));
      setFailed('');
    } catch (err) {
      setFailed(aiErrorText((err as ApiError).code, t));
    }
  }, [t]);

  // Fast refresh while something downloads or the index is rebuilt, slow otherwise.
  const active = Boolean(state?.models.some(m => busy(m.job)) || state?.index.some(i => i.running));
  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);
  useEffect(() => {
    if (!enabled) return;
    timer.current = setTimeout(() => void load(), active ? 1000 : 15000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, active, state, load]);

  async function act(action: 'download' | 'cancel' | 'delete', model: string, activate = false) {
    try {
      // `activate`: the model chosen in the list becomes active once it is verified, also when this
      // page is closed during the download (the server switches it, not this component).
      await postJson(`/api/ai/local-models/${action}`, activate ? { model, activate } : { model }, 'ai-v1');
    } catch (err) {
      toast({ text: aiErrorText((err as ApiError).code, t), kind: 'error' });
    }
    void load();
  }

  async function choose(kind: 'chat' | 'embed', id: string) {
    if (!state) return;
    const entry = state.models.find(m => m.id === id);
    if (!entry) return;
    if (entry.fit === 'too_big') {
      const ok = await confirm({
        title: t('Modell zu groß für diesen Computer?'),
        message: t(
          '{name} braucht mehr Arbeitsspeicher, als dieser Computer hat. Es kann sehr langsam laufen oder gar nicht starten.',
          { name: entry.name }
        ),
        confirmLabel: t('Trotzdem wählen')
      });
      if (!ok) return;
    }
    if (kind === 'embed') {
      const ok = await confirm({
        title: t('Suchmodell wechseln?'),
        message: t(
          'Der Suchindex wird mit {model} im Hintergrund neu aufgebaut. Bis dahin findet die semantische Suche weniger.',
          { model: entry.name }
        ),
        confirmLabel: t('Wechseln')
      });
      if (!ok) return;
    }
    if (entry.installed) {
      setPending(p => ({ ...p, [kind]: undefined }));
      await save(kind === 'embed' ? { embedModel: id } : { model: id });
    } else {
      // Not on this computer yet: nothing is downloaded until the button below is pressed.
      const active = kind === 'embed' ? state.selected.embedModel : state.selected.model;
      setPending(p => ({ ...p, [kind]: id === active ? undefined : id }));
    }
    void load();
  }

  // A chosen model becomes active once its download is verified.
  useEffect(() => {
    if (!state) return;
    for (const kind of ['chat', 'embed'] as const) {
      const id = pending[kind];
      if (id && state.models.find(m => m.id === id)?.installed) {
        setPending(p => ({ ...p, [kind]: undefined }));
        void save(kind === 'embed' ? { embedModel: id } : { model: id }).then(() => load());
      }
    }
  }, [state, pending, save, load]);

  async function remove(m: LocalModel) {
    const inUse = m.id === state?.selected.model || m.id === state?.selected.embedModel;
    const ok = await confirm({
      title: t('{name} löschen?', { name: m.name }),
      message: inUse
        ? t(
            'Das Modell ist gerade ausgewählt. Die KI-Funktionen, die es brauchen, gehen erst nach einem neuen Download wieder.'
          )
        : t('Das Modell wird von diesem Computer entfernt ({size}). Du kannst es jederzeit wieder herunterladen.', {
            size: formatSize(m.size, locale)
          }),
      confirmLabel: t('Löschen'),
      danger: true
    });
    if (ok) await act('delete', m.id);
  }

  async function discardPartial(model: string) {
    try {
      await postJson('/api/ai/local-models/discard-partial', { model }, 'ai-v1');
    } catch (err) {
      toast({ text: aiErrorText((err as ApiError).code, t), kind: 'error' });
    }
    void load();
  }

  if (!enabled) return null;
  if (!state)
    return failed ? (
      <Row label={t('Lokale Modelle')} hint={failed}>
        <Button size="sm" onClick={() => void load()}>
          {t('Erneut versuchen')}
        </Button>
      </Row>
    ) : null;

  const chat = state.models.filter(m => m.kind === 'chat');
  const embed = state.models.filter(m => m.kind === 'embed');
  const activeChat = state.models.find(m => m.id === state.selected.model);
  const activeEmbed = state.models.find(m => m.id === state.selected.embedModel);
  const selectedChat = state.models.find(m => m.id === pending.chat) || activeChat;
  const selectedEmbed = state.models.find(m => m.id === pending.embed) || activeEmbed;
  const recommended = TIER_NAMES[state.recommendedTier];
  const ramGb = Math.round(state.ram / 1024 ** 3);
  const optionText = (m: LocalModel) =>
    [
      m.name,
      formatSize(m.size, locale),
      m.eu ? t('EU') : '',
      m.installed ? t('vorhanden') : '',
      m.fit === 'too_big' ? t('zu groß') : m.fit === 'tight' ? t('knapp') : ''
    ]
      .filter(Boolean)
      .join(' · ');
  const installed = state.models.filter(m => m.installed);
  const paused = state.models.filter(m => m.job?.status === 'canceled');
  const downloading = state.models.some(m => busy(m.job));
  const statusProps = { act, remove, freeBytes: state.freeBytes };
  const switchBack = (kind: 'chat' | 'embed', to: LocalModel | undefined) =>
    to ? (
      <Button size="sm" variant="ghost" onClick={() => setPending(p => ({ ...p, [kind]: undefined }))}>
        {t('Bei {name} bleiben', { name: to.name })}
      </Button>
    ) : null;

  return (
    <>
      <Row
        label={t('Lokale KI')}
        hint={t(
          'Levuvo Mail bringt sein eigenes Ollama {version} mit. Es läuft nur auf diesem Computer, getrennt von einem anderen installierten Ollama. Für diesen Computer ({ram} GB Arbeitsspeicher) passt die Größe „{tier}“.',
          { version: state.runtime.version || '', ram: String(ramGb), tier: t(recommended) }
        )}
      >
        <span className={`local-model-state${state.reachable ? ' ok' : ''}`}>
          {state.reachable ? t('Bereit') : t('Startet …')}
        </span>
      </Row>
      {!cloud && (
        <Row
          label={t('Sprachmodell')}
          hint={selectedChat ? modelHint(selectedChat, t, locale) : t('Bitte ein Modell aus der Liste wählen.')}
        >
          <select value={selectedChat ? selectedChat.id : ''} onChange={e => void choose('chat', e.target.value)}>
            {!selectedChat && <option value="">{t('Bitte wählen')}</option>}
            {TIERS.map(g => (
              <optgroup
                key={g.tier}
                label={`${t(g.label)}${g.tier === state.recommendedTier ? ` (${t('empfohlen')})` : ''}`}
              >
                {chat
                  .filter(m => m.tier === g.tier)
                  .map(m => (
                    <option key={m.id} value={m.id}>
                      {optionText(m)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </Row>
      )}
      {!cloud && selectedChat && (
        <ModelStatus
          model={selectedChat}
          {...statusProps}
          extra={selectedChat !== activeChat ? switchBack('chat', activeChat) : null}
        />
      )}
      <Row
        label={t('Modell für die Suche')}
        hint={
          selectedEmbed
            ? `${t('Läuft immer lokal, auch bei Cloud-KI.')} ${modelHint(selectedEmbed, t, locale)}`
            : t('Bitte ein Modell aus der Liste wählen.')
        }
      >
        <select value={selectedEmbed ? selectedEmbed.id : ''} onChange={e => void choose('embed', e.target.value)}>
          {!selectedEmbed && <option value="">{t('Bitte wählen')}</option>}
          {embed.map(m => (
            <option key={m.id} value={m.id}>
              {optionText(m)}
              {m.default ? ` · ${t('empfohlen')}` : ''}
            </option>
          ))}
        </select>
      </Row>
      {selectedEmbed && (
        <ModelStatus
          model={selectedEmbed}
          {...statusProps}
          extra={selectedEmbed !== activeEmbed ? switchBack('embed', activeEmbed) : null}
        />
      )}
      <SemanticIndexStatus />
      {installed.length > 0 && (
        <Row
          label={t('Heruntergeladene Modelle')}
          hint={
            state.freeBytes !== null
              ? t('Noch {free} frei auf diesem Laufwerk.', { free: formatSize(state.freeBytes, locale) })
              : undefined
          }
        >
          <ul className="local-model-list">
            {installed.map(m => (
              <li key={m.id}>
                <span>
                  {m.name} <small>{formatSize(m.size, locale)}</small>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={14} />}
                  aria-label={t('{name} löschen', { name: m.name })}
                  onClick={() => void remove(m)}
                >
                  {t('Löschen')}
                </Button>
              </li>
            ))}
          </ul>
        </Row>
      )}
      {paused.length > 0 && (
        <section className="local-model-paused" aria-labelledby="local-model-paused-title">
          <strong id="local-model-paused-title">{t('Unterbrochene Downloads')}</strong>
          <p className="local-model-paused-hint">
            {t('Bereits geladene Teile bleiben erhalten. Fortsetzen lädt nur den Rest.')}
          </p>
          <ul>
            {paused.map(m => (
              <li key={m.id} className="local-model-status">
                <span>
                  {t('{name}: pausiert bei {pct} % ({done} von {total})', {
                    name: m.name,
                    pct: String(percent(m.job)),
                    done: formatSize(m.job!.completed, locale),
                    total: formatSize(m.job!.total, locale)
                  })}
                </span>
                <span className="local-model-actions">
                  <Button size="sm" icon={<Play size={14} />} onClick={() => void act('download', m.id)}>
                    {t('Fortsetzen')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<X size={14} />}
                    aria-label={t('Teile von {name} verwerfen', { name: m.name })}
                    title={
                      downloading ? t('Teile, die der laufende Download gerade schreibt, bleiben erhalten.') : undefined
                    }
                    onClick={() => void discardPartial(m.id)}
                  >
                    {t('Verwerfen')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function modelHint(m: LocalModel, t: ReturnType<typeof useT>['t'], locale: string) {
  const fit =
    m.fit === 'too_big'
      ? t('Für diesen Computer zu groß.')
      : m.fit === 'tight'
        ? t('Läuft hier, aber knapp: andere Programme werden langsamer.')
        : t('Passt zu diesem Computer.');
  return [
    t('{vendor}, Lizenz {license}, {size}.', {
      vendor: m.vendor,
      license: m.license,
      size: formatSize(m.size, locale)
    }),
    m.eu ? t('Anbieter aus der EU.') : '',
    m.kind === 'chat' ? fit : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function ModelStatus({
  model,
  act,
  remove,
  freeBytes,
  extra
}: {
  model: LocalModel;
  act: (action: 'download' | 'cancel' | 'delete', id: string, activate?: boolean) => Promise<void>;
  remove: (m: LocalModel) => Promise<void>;
  freeBytes: number | null;
  /** Shown next to the download button, e.g. "stay with the current model". */
  extra?: ReactNode;
}) {
  const { t, locale } = useT();
  const job = model.job;
  const pct = percent(job);
  if (busy(job))
    return (
      <div className="local-model-status" role="status" aria-live="polite">
        <span>
          {job!.status === 'verifying'
            ? t('{name}: Prüfsumme wird kontrolliert …', { name: model.name })
            : t('{name} wird heruntergeladen: {pct} % ({done} von {total})', {
                name: model.name,
                pct: String(pct),
                done: formatSize(job!.completed, locale),
                total: formatSize(job!.total, locale)
              })}
        </span>
        <progress max={100} value={pct} aria-label={t('Download von {name}', { name: model.name })} />
        <Button size="sm" icon={<Pause size={14} />} onClick={() => void act('cancel', model.id)}>
          {t('Abbrechen')}
        </Button>
      </div>
    );
  if (model.installed)
    return (
      <div className="local-model-status ok">
        <CheckCircle2 size={14} aria-hidden="true" />
        <span>{t('{name} ist heruntergeladen und geprüft.', { name: model.name })}</span>
        <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void remove(model)}>
          {t('Löschen')}
        </Button>
      </div>
    );
  const size = formatSize(model.size, locale);
  // The server keeps DISK_RESERVE (2 GiB) free next to the model.
  const tooLittleSpace = freeBytes !== null && freeBytes < model.size + DISK_RESERVE;
  const space =
    freeBytes === null
      ? ''
      : tooLittleSpace
        ? t('Nicht genug Speicherplatz: {free} frei, gebraucht werden {need}.', {
            free: formatSize(freeBytes, locale),
            need: formatSize(model.size + DISK_RESERVE, locale)
          })
        : t('Noch {free} frei.', { free: formatSize(freeBytes, locale) });
  const message =
    job?.status === 'canceled'
      ? t('Download pausiert bei {pct} %. Bereits geladene Teile bleiben erhalten.', { pct: String(pct) })
      : job?.status === 'error'
        ? aiErrorText(`ai_${job.error}`, t)
        : model.mismatch
          ? aiErrorText('ai_checksum', t)
          : t('{name} ist noch nicht auf diesem Computer. Download {size}.', { name: model.name, size });
  return (
    <div className={`local-model-status${job?.status === 'error' ? ' error' : ''}`} role="status">
      <span>
        {message} {space}
      </span>
      <span className="local-model-actions">
        {extra}
        <Button
          size="sm"
          variant={job?.status ? 'default' : 'primary'}
          disabled={tooLittleSpace}
          icon={job?.status === 'canceled' ? <Play size={14} /> : <Download size={14} />}
          onClick={() => void act('download', model.id, true)}
        >
          {job?.status === 'canceled'
            ? t('Fortsetzen')
            : job?.status === 'error'
              ? t('Erneut versuchen')
              : t('Herunterladen ({size})', { size })}
        </Button>
      </span>
    </div>
  );
}
