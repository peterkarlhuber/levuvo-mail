import { useCallback, useEffect, useState } from 'react';
import { Bot, Cloud, Cpu, Download, Image, MailX, RefreshCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { Button } from './ui';
import { useT } from './i18n';

type KindStats = { local: number; cloud: number; sources: Record<string, number> };
type Overview = {
  days: number;
  blocked: { trackers: number; perDay: { day: string; trackers: number }[] };
  remoteImages: number;
  unsubscribe: { oneClick: number; mail: number };
  ai: {
    local: number;
    cloud: number;
    failed: number;
    kinds: Record<string, KindStats>;
    providers: Record<string, number>;
    lastAt: string | null;
    lastCloudAt: string | null;
    indexRuns: number;
  };
  agents: { name: string; calls: number; denied: number; tools: Record<string, number>; lastAt: string | null }[];
  downloads: { at: string; kind: string; model: string | null }[];
  recent: {
    at: string;
    kind: string;
    where: 'local' | 'cloud' | 'agent';
    provider?: string | null;
    source?: string | null;
    agent?: string;
    ok: boolean;
  }[];
};

const PROVIDERS: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };

/** German labels of the AI functions (log `kind`); unknown kinds are shown as they are. */
function useKindLabel() {
  const { t } = useT();
  const labels: Record<string, string> = {
    digest: t('Zusammenfassen'),
    translate: t('Übersetzen'),
    reply: t('Antwortvorschlag'),
    rewrite: t('Umformulieren'),
    compose: t('Entwurf schreiben'),
    attachment_check: t('Anhang-Prüfung'),
    presend: t('Prüfung vor dem Senden'),
    filter_rule: t('Filterregel vorschlagen'),
    prioritize: t('Wichtiges erkennen'),
    classify: t('Einsortieren (Bündel, Screening)'),
    extract: t('Termine und Aufgaben erkennen'),
    assess: t('Sicherheitsbewertung'),
    ask: t('Frag dein Postfach'),
    embed: t('Suchindex'),
    agent: t('Aufgaben und Routinen des Assistenten'),
    briefing: t('Morgen-Briefing'),
    commitments: t('Versprechen-Tracker'),
    meeting_prep: t('Termin-Vorbereitung'),
    dictate: t('Diktat'),
    newsletters: t('Newsletter-Überblick')
  };
  return (kind: string) => labels[kind] || kind;
}

/**
 * Datenschutz-Cockpit: blocked trackers, what the AI read (local or cloud) and what left
 * Levuvo Mail during the last 30 days. Only counters and timestamps, never content.
 */
export function PrivacyCockpit({ onOpenAiLog }: { onOpenAiLog?: () => void }) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const kindLabel = useKindLabel();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const o = await getJson<Overview>('/api/privacy/overview');
      // An unexpected answer (older server, proxy) shows the error line instead of breaking Settings.
      if (!o?.blocked?.perDay || !o.ai?.kinds || !Array.isArray(o.agents) || !Array.isArray(o.recent))
        throw new TypeError('invalid overview');
      setData({ ...o, downloads: Array.isArray(o.downloads) ? o.downloads : [] });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const when = (at: string | null | undefined) =>
    at ? new Date(at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '–';

  if (!data)
    return (
      <section className="settings-section privacy-cockpit">
        <h2>{t('Datenschutz-Cockpit')}</h2>
        <p className="settings-description">
          {failed ? t('Das Cockpit konnte nicht geladen werden.') : t('Wird geladen …')}
        </p>
      </section>
    );

  const cloudCalls = Object.entries(data.ai.providers);
  const agentCalls = data.agents.reduce((n, a) => n + a.calls, 0);
  const max = Math.max(1, ...data.blocked.perDay.map(d => d.trackers));
  const kinds = Object.entries(data.ai.kinds).sort((a, b) => b[1].local + b[1].cloud - (a[1].local + a[1].cloud));
  const automatic = (s: KindStats) =>
    Object.entries(s.sources)
      .filter(([src]) => !['user', 'reader'].includes(src))
      .reduce((n, [, c]) => n + c, 0);

  return (
    <section className="settings-section privacy-cockpit" aria-labelledby="privacy-cockpit-title">
      <h2 id="privacy-cockpit-title">{t('Datenschutz-Cockpit')}</h2>
      <p className="settings-description">
        {t(
          'Was in den letzten {days} Tagen auf diesem Gerät passiert ist. Es werden nur Zähler und Zeitpunkte gespeichert, keine Inhalte, Adressen oder Betreffzeilen.',
          { days: data.days }
        )}
      </p>

      <div className="privacy-tiles">
        <div className="privacy-tile">
          <ShieldCheck size={16} aria-hidden="true" />
          <strong>{data.blocked.trackers}</strong>
          <span>{t('Tracker blockiert')}</span>
        </div>
        <div className="privacy-tile">
          <Cpu size={16} aria-hidden="true" />
          <strong>{data.ai.local}</strong>
          <span>{t('KI-Aufrufe lokal')}</span>
        </div>
        <div className={`privacy-tile ${data.ai.cloud ? 'privacy-tile--out' : ''}`}>
          <Cloud size={16} aria-hidden="true" />
          <strong>{data.ai.cloud}</strong>
          <span>{t('KI-Aufrufe in der Cloud')}</span>
        </div>
        <div className={`privacy-tile ${agentCalls ? 'privacy-tile--out' : ''}`}>
          <Bot size={16} aria-hidden="true" />
          <strong>{agentCalls}</strong>
          <span>{t('Zugriffe externer Agenten')}</span>
        </div>
      </div>

      <div
        className="privacy-bars"
        role="img"
        aria-label={t('Blockierte Tracker pro Tag, letzte {days} Tage: insgesamt {count}', {
          days: data.days,
          count: data.blocked.trackers
        })}
      >
        {data.blocked.perDay.map(d => (
          <span
            key={d.day}
            title={`${new Date(`${d.day}T12:00:00`).toLocaleDateString(locale)}: ${d.trackers}`}
            style={{ height: `${Math.max(4, Math.round((d.trackers / max) * 100))}%` }}
            className={d.trackers ? '' : 'empty'}
          />
        ))}
      </div>

      <h3>{t('Was die KI gelesen hat')}</h3>
      {kinds.length === 0 ? (
        <p className="settings-description">{t('Die KI hat in diesem Zeitraum nichts gelesen.')}</p>
      ) : (
        <table className="privacy-table">
          <thead>
            <tr>
              <th scope="col">{t('Funktion')}</th>
              <th scope="col">{t('Lokal')}</th>
              <th scope="col">{t('Cloud')}</th>
              <th scope="col">{t('Davon automatisch')}</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map(([kind, s]) => (
              <tr key={kind}>
                <th scope="row">{kindLabel(kind)}</th>
                <td>{s.local}</td>
                <td className={s.cloud ? 'out' : ''}>{s.cloud}</td>
                <td>{automatic(s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.ai.indexRuns > 0 && (
        <p className="settings-description">
          {t('Der lokale Suchindex wurde {count}-mal aktualisiert (nur auf diesem Gerät).', {
            count: data.ai.indexRuns
          })}
        </p>
      )}
      {data.recent.length > 0 && (
        <details className="privacy-recent">
          <summary>{t('Letzte Zugriffe')}</summary>
          <ul className="plain-list">
            {data.recent.slice(0, 15).map((r, i) => (
              <li key={`${r.at}-${i}`}>
                <small>{when(r.at)}</small> · {r.where === 'agent' ? `${r.agent}: ${r.kind}` : kindLabel(r.kind)} ·{' '}
                {r.where === 'cloud'
                  ? t('Cloud ({provider})', { provider: PROVIDERS[r.provider || ''] || r.provider || '' })
                  : r.where === 'agent'
                    ? t('externer Agent')
                    : t('lokal')}
                {r.ok ? '' : ` · ${t('fehlgeschlagen')}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      <h3>{t('Was Levuvo Mail verlassen hat')}</h3>
      <ul className="privacy-out">
        <li>
          <Cloud size={14} aria-hidden="true" />
          <span>
            {cloudCalls.length
              ? t('Cloud-KI: {list}. Zuletzt am {when}.', {
                  list: cloudCalls
                    .map(([p, n]) => t('{count} Aufrufe an {provider}', { count: n, provider: PROVIDERS[p] || p }))
                    .join(', '),
                  when: when(data.ai.lastCloudAt)
                })
              : t('Cloud-KI: nichts. Alle KI-Funktionen liefen lokal.')}
          </span>
        </li>
        <li>
          <Bot size={14} aria-hidden="true" />
          <span>
            {data.agents.length
              ? data.agents
                  .map(a =>
                    t('{agent}: {count} Zugriffe ({tools}), zuletzt {when}', {
                      agent: a.name,
                      count: a.calls,
                      tools: Object.keys(a.tools).slice(0, 4).join(', '),
                      when: when(a.lastAt)
                    })
                  )
                  .join(' · ')
              : t('Externe Agenten (MCP): keine Zugriffe.')}
          </span>
        </li>
        <li>
          <MailX size={14} aria-hidden="true" />
          <span>
            {t('Newsletter-Abmeldungen: {direct} direkt beim Absender, {mail} per E-Mail.', {
              direct: data.unsubscribe.oneClick,
              mail: data.unsubscribe.mail
            })}
          </span>
        </li>
        <li>
          <Image size={14} aria-hidden="true" />
          <span>
            {t(
              'Externe Bilder: {count}-mal auf deinen Wunsch geladen. Der Absender sieht dabei deine IP-Adresse; Tracker bleiben trotzdem blockiert.',
              { count: data.remoteImages }
            )}
          </span>
        </li>
        {data.downloads.length > 0 && (
          <li>
            <Download size={14} aria-hidden="true" />
            <span>
              {t('Modell-Downloads: {list}', {
                list: data.downloads.map(d => `${d.model || d.kind} (${when(d.at)})`).join(', ')
              })}
            </span>
          </li>
        )}
        <li>
          <ShieldCheck size={14} aria-hidden="true" />
          <span>
            {t(
              'Immer: deine E-Mails, Termine und Kontakte gehen nur an die Server deiner Anbieter; Updates werden bei GitHub geprüft.'
            )}
          </span>
        </li>
      </ul>

      <div className="settings-actions">
        <Button size="sm" icon={<RefreshCcw size={14} />} onClick={() => void load()}>
          {t('Aktualisieren')}
        </Button>
        {onOpenAiLog && (
          <Button size="sm" icon={<Bot size={14} />} onClick={onOpenAiLog}>
            {t('KI-Protokoll öffnen')}
          </Button>
        )}
        <Button
          size="sm"
          icon={<Trash2 size={14} />}
          onClick={async () => {
            if (
              !(await confirm({
                title: t('Zähler des Cockpits löschen?'),
                message: t(
                  'Die Zähler für Tracker, externe Bilder und Abmeldungen werden gelöscht. Das KI-Protokoll leerst du unter KI & Agenten.'
                ),
                confirmLabel: t('Löschen')
              }))
            )
              return;
            try {
              await postJson('/api/privacy/clear', {}, 'mail-v1');
              void load();
            } catch (err) {
              toast({ text: (err as Error).message, kind: 'error' });
            }
          }}
        >
          {t('Zähler löschen')}
        </Button>
      </div>
    </section>
  );
}
