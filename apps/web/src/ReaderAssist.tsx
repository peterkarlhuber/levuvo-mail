// Levuvo Mail Assistant in the reading pane: summary, translation, appointments/tasks/contacts and a
// phishing assessment for the open message. Everything here is a suggestion: results are marked as
// AI-generated, and nothing is saved until the user clicks "Übernehmen".
import { useEffect, useState } from 'react';
import {
  CalendarPlus,
  Check,
  Languages,
  ListChecks,
  LoaderCircle,
  ShieldQuestion,
  Sparkles,
  UserPlus,
  X
} from 'lucide-react';
import { ApiError, postJson } from './api';
import { aiEnabled, aiErrorText, runAi, type AiFeature, type AiResult } from './ai';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';

type Digest = {
  summary: string[];
  deadlines: { text: string; date: string }[];
  amounts: { text: string; value: string; currency: string }[];
  open_questions: string[];
  action_needed: boolean;
};
type Translation = { source_language: string; translation: string };
type EventS = {
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string;
  certain: boolean;
  quote: string;
};
type TaskS = { title: string; due: string; quote: string };
type ContactS = {
  name: string;
  email: string;
  phone: string;
  organization: string;
  title: string;
  address: string;
  website: string;
};
type Extraction = { events: EventS[]; tasks: TaskS[]; contacts: ContactS[] };
type Assessment = { risk: 'low' | 'medium' | 'high'; reasons: string[]; signals: string[] };

type Kind = 'digest' | 'translate' | 'extract' | 'assess';
type Shown =
  | { kind: 'digest'; data: AiResult<Digest> }
  | { kind: 'translate'; data: AiResult<Translation> }
  | { kind: 'extract'; data: AiResult<Extraction> }
  | { kind: 'assess'; data: AiResult<Assessment> };

const FEATURE: Record<Kind, AiFeature> = {
  digest: 'digest',
  translate: 'translate',
  extract: 'extract',
  assess: 'assess'
};

export function ReaderAssist({ accountId, folder, uid }: { accountId: string; folder: string; uid: number }) {
  const { t, lang } = useT();
  const { toast } = useUi();
  const [enabled, setEnabled] = useState<Record<Kind, boolean> | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    void Promise.all((Object.keys(FEATURE) as Kind[]).map(async k => [k, await aiEnabled(FEATURE[k])] as const)).then(
      list => alive && setEnabled(Object.fromEntries(list) as Record<Kind, boolean>)
    );
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    setShown(null);
    setError('');
    setSaved(new Set());
  }, [accountId, folder, uid]);

  if (!enabled || !Object.values(enabled).some(Boolean)) return null;

  async function run(kind: Kind) {
    setBusy(kind);
    setError('');
    try {
      const now = new Date();
      const input =
        kind === 'translate'
          ? { target: lang === 'en' ? 'en' : 'de' }
          : kind === 'extract'
            ? {
                now: now.toISOString(),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
              }
            : {};
      const data = await runAi<never>(kind, { account: accountId, refs: [{ folder, uid }], input, lang });
      setShown({ kind, data } as Shown);
    } catch (err) {
      setError(aiErrorText(err instanceof ApiError ? err.code : undefined, t));
    } finally {
      setBusy(null);
    }
  }

  async function apply(key: string, type: 'event' | 'task' | 'contact', data: Record<string, unknown>) {
    try {
      await postJson('/api/ai/apply', { type, data, source: 'reader' }, 'ai-v1');
      setSaved(old => new Set(old).add(key));
      toast({
        text:
          type === 'event'
            ? t('Termin gespeichert.')
            : type === 'task'
              ? t('Aufgabe gespeichert.')
              : t('Kontakt gespeichert.'),
        kind: 'success'
      });
    } catch (err) {
      toast({ text: t(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.'), kind: 'error' });
    }
  }

  const button = (kind: Kind, icon: React.ReactNode, label: string) =>
    enabled[kind] && (
      <button className="btn small" disabled={busy !== null} onClick={() => void run(kind)}>
        {busy === kind ? <LoaderCircle className="spin" size={14} /> : icon} {label}
      </button>
    );
  const take = (key: string, onClick: () => void, icon: React.ReactNode) =>
    saved.has(key) ? (
      <span className="ai-taken">
        <Check size={14} /> {t('Übernommen')}
      </span>
    ) : (
      <button className="btn small" onClick={onClick}>
        {icon} {t('Übernehmen')}
      </button>
    );

  return (
    <div className="reader-ai" aria-label={t('Levuvo Mail Assistant')}>
      <div className="reader-ai-actions">
        <Sparkles size={14} aria-hidden="true" />
        {button('digest', <ListChecks size={14} />, t('Zusammenfassen'))}
        {button('translate', <Languages size={14} />, t('Übersetzen'))}
        {button('extract', <CalendarPlus size={14} />, t('Termine, Aufgaben, Kontakte'))}
        {button('assess', <ShieldQuestion size={14} />, t('Echtheit prüfen'))}
      </div>
      {error && (
        <div className="reader-security warning" role="status">
          {error}
        </div>
      )}
      {shown && (
        <div className="reader-ai-card" role="region" aria-live="polite">
          <div className="reader-ai-head">
            <span className="ai-label" title={t('Von einer KI erstellt. Bitte prüfen.')}>
              <Sparkles size={12} /> {t('KI-generiert')} · {shown.data.model}
            </span>
            <button className="icon-button" aria-label={t('Schließen')} onClick={() => setShown(null)}>
              <X size={14} />
            </button>
          </div>
          {shown.kind === 'digest' && (
            <>
              <ul className="ai-summary">
                {shown.data.result.summary.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              {shown.data.result.deadlines.length > 0 && (
                <p>
                  <strong>{t('Fristen')}:</strong>{' '}
                  {shown.data.result.deadlines.map(d => (d.date ? `${d.text} (${d.date})` : d.text)).join(' · ')}
                </p>
              )}
              {shown.data.result.amounts.length > 0 && (
                <p>
                  <strong>{t('Beträge')}:</strong> {shown.data.result.amounts.map(a => a.text).join(' · ')}
                </p>
              )}
              {shown.data.result.open_questions.length > 0 && (
                <p>
                  <strong>{t('Offene Fragen an dich')}:</strong> {shown.data.result.open_questions.join(' · ')}
                </p>
              )}
              {shown.data.result.action_needed && <p className="ai-hint">{t('Du solltest reagieren.')}</p>}
            </>
          )}
          {shown.kind === 'translate' && (
            <>
              <p className="ai-hint">{t('Übersetzt aus: {lang}', { lang: shown.data.result.source_language })}</p>
              <div className="ai-translation">{shown.data.result.translation}</div>
            </>
          )}
          {shown.kind === 'extract' && (
            <>
              {!shown.data.result.events.length &&
                !shown.data.result.tasks.length &&
                !shown.data.result.contacts.length && <p>{t('Nichts gefunden.')}</p>}
              {shown.data.result.events.map((e, i) => (
                <div className="ai-suggestion" key={`e${i}`}>
                  <CalendarPlus size={14} aria-hidden="true" />
                  <span>
                    <strong>{e.title}</strong> {e.start && `· ${e.start.replace('T', ' ')}`}
                    {e.location && ` · ${e.location}`}
                    {!e.certain && <em> · {t('Zeitpunkt unklar')}</em>}
                  </span>
                  {e.start &&
                    take(
                      `e${i}`,
                      () =>
                        void apply(`e${i}`, 'event', {
                          summary: e.title,
                          start: e.start,
                          end: e.end || defaultEnd(e.start, e.all_day),
                          allDay: e.all_day,
                          location: e.location,
                          description: e.quote,
                          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
                        }),
                      <CalendarPlus size={14} />
                    )}
                </div>
              ))}
              {shown.data.result.tasks.map((task, i) => (
                <div className="ai-suggestion" key={`t${i}`}>
                  <ListChecks size={14} aria-hidden="true" />
                  <span>
                    <strong>{task.title}</strong> {task.due && `· ${t('bis {date}', { date: task.due })}`}
                  </span>
                  {take(
                    `t${i}`,
                    () => void apply(`t${i}`, 'task', { title: task.title, due: task.due, notes: task.quote }),
                    <ListChecks size={14} />
                  )}
                </div>
              ))}
              {shown.data.result.contacts.map((c, i) => (
                <div className="ai-suggestion" key={`c${i}`}>
                  <UserPlus size={14} aria-hidden="true" />
                  <span>
                    <strong>{c.name}</strong>
                    {[c.title, c.organization, c.email, c.phone].filter(Boolean).map(v => ` · ${v}`)}
                  </span>
                  {take(
                    `c${i}`,
                    () =>
                      void apply(`c${i}`, 'contact', {
                        name: c.name,
                        emails: c.email ? [c.email] : [],
                        phones: c.phone ? [c.phone] : [],
                        organization: c.organization,
                        title: c.title,
                        address: c.address,
                        note: c.website
                      }),
                    <UserPlus size={14} />
                  )}
                </div>
              ))}
            </>
          )}
          {shown.kind === 'assess' && (
            <>
              <p className={`ai-risk ai-risk-${shown.data.result.risk}`}>
                <strong>
                  {shown.data.result.risk === 'high'
                    ? t('Hohes Risiko')
                    : shown.data.result.risk === 'medium'
                      ? t('Vorsicht')
                      : t('Keine Auffälligkeiten')}
                </strong>
              </p>
              <ul className="ai-summary">
                {shown.data.result.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <p className="ai-hint">
                {t('Die Einschätzung kann irren. Im Zweifel den Absender über einen bekannten Weg kontaktieren.')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** One hour after a timed start, the same day for an all-day event. */
export function defaultEnd(start: string, allDay: boolean) {
  if (allDay) return start.slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(start);
  if (!m) return start;
  const d = new Date(Date.UTC(2000, 0, 1, Number(m[2]) + 1, Number(m[3])));
  return Number(m[2]) >= 23 ? `${m[1]}T23:59` : `${m[1]}T${d.toISOString().slice(11, 16)}`;
}
