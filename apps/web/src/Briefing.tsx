// "Mein Tag": the morning briefing. Opens by itself the first time Levuvo Mail is used on a day
// (can be switched off) and from the command palette or the assistant. The overview is built from
// local data without AI. When the AI is on, it can say which waiting mails really need an answer
// today: automatically only with a local model, with a cloud model only when the user clicks.
// AI results are labelled (EU AI Act Art. 50) and only change the order, never hide anything.
import { useCallback, useEffect, useState } from 'react';
import {
  BellRing,
  CalendarDays,
  CircleCheck,
  Handshake,
  Inbox,
  ListTodo,
  LoaderCircle,
  MapPin,
  Sparkles,
  Users
} from 'lucide-react';
import { aiEnabled, aiErrorText, aiLocal } from './ai';
import { ApiError, getJson, postJson } from './api';
import { CommitmentList, useCommitments } from './Commitments';
import { useUi } from './ConfirmDialog';
import { applyRanking, greetingFor, localDay, type RankItem } from './day-utils';
import { useT } from './i18n';
import { usePrefs } from './prefs';
import { tasksChanged } from './TaskDialog';
import { formatTaskDate } from './tasks';
import { Button, Dialog } from './ui';

export type BriefingData = {
  from: string;
  to: string;
  generatedAt: string;
  events: {
    uid: string;
    summary: string;
    location: string;
    start: string;
    end: string;
    allDay: boolean;
    color: string | null;
    attendees: number;
  }[];
  tasks: {
    id: string;
    title: string;
    due: string | null;
    priority: string;
    overdue: boolean;
    mail: { accountId: string; folder: string; uid: number } | null;
  }[];
  followups: { id: string; accountId: string; subject: string; to: string[]; due: string | null }[];
  replies: {
    accountId: string;
    accountLabel: string;
    folder: string;
    uid: number;
    fromName: string;
    fromEmail: string;
    subject: string;
    date: string;
    unread: boolean;
    flagged: boolean;
    preview: string;
  }[];
  moreReplies: number;
  spaces: {
    updated: { id: string; name: string; openTasks: number }[];
    invitations: { id: string; name: string; from: string }[];
  };
  unavailable: string[];
};

type Rank = { items: RankItem[]; model: string };

export type BriefingTarget =
  | { type: 'mail'; accountId: string; folder: string; uid: number }
  | { type: 'calendar' }
  | { type: 'tasks' }
  | { type: 'followups' }
  | { type: 'spaces' };

const LAST_SHOWN = 'levuvo-mail-briefing-day';
export function lastBriefingDay(): string | null {
  try {
    return window.localStorage.getItem(LAST_SHOWN);
  } catch {
    return null;
  }
}
export function markBriefingShown(day: string) {
  try {
    window.localStorage.setItem(LAST_SHOWN, day);
  } catch {
    /* storage blocked: it may open once more */
  }
}

/** Opens "Mein Tag" from anywhere (command palette, assistant). */
export const openBriefing = () => window.dispatchEvent(new Event('levuvo:briefing'));

/** Fills in what an older or partial answer leaves out, so the view never breaks on it. */
export function normalizeBriefing(raw: Partial<BriefingData> | null | undefined): BriefingData {
  const list = <T,>(v: T[] | undefined) => (Array.isArray(v) ? v : []);
  return {
    from: raw?.from || '',
    to: raw?.to || '',
    generatedAt: raw?.generatedAt || '',
    events: list(raw?.events),
    tasks: list(raw?.tasks),
    followups: list(raw?.followups),
    replies: list(raw?.replies),
    moreReplies: Number(raw?.moreReplies) || 0,
    spaces: { updated: list(raw?.spaces?.updated), invitations: list(raw?.spaces?.invitations) },
    unavailable: list(raw?.unavailable)
  };
}

export const isEmptyBriefing = (d: BriefingData) =>
  !d.events.length &&
  !d.tasks.length &&
  !d.followups.length &&
  !d.replies.length &&
  !d.spaces.updated.length &&
  !d.spaces.invitations.length;

/**
 * `auto`: opened by itself at the first start of the day. Then nothing is shown until the overview
 * is loaded, and it closes silently when there is nothing to show or loading failed.
 */
export function Briefing({
  onClose,
  onOpen,
  auto = false
}: {
  onClose: () => void;
  onOpen: (target: BriefingTarget) => void;
  auto?: boolean;
}) {
  const { t, lang, locale } = useT();
  const { toast } = useUi();
  const [prefs, setPrefs] = usePrefs();
  const [data, setData] = useState<BriefingData | null>(null);
  const [error, setError] = useState('');
  const [rank, setRank] = useState<Rank | null>(null);
  const [ranking, setRanking] = useState(false);
  const [canRank, setCanRank] = useState(false);
  const [rankError, setRankError] = useState('');

  const load = useCallback(async () => {
    const { from, to } = localDay();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const next = normalizeBriefing(
        await getJson<Partial<BriefingData>>(
          `/api/briefing?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tz=${encodeURIComponent(tz)}`
        )
      );
      if (auto && isEmptyBriefing(next)) return onClose();
      setData(next);
      setError('');
    } catch (e) {
      if (auto) return onClose();
      setError((e as Error).message);
    }
  }, [auto, onClose]);
  useEffect(() => {
    void load();
  }, [load]);

  const runRank = useCallback(
    async (auto: boolean) => {
      const { from, to } = localDay();
      setRanking(true);
      setRankError('');
      try {
        const r = await postJson<Rank>('/api/briefing/rank', { from, to, lang, auto }, 'ai-v1');
        setRank(r);
      } catch (e) {
        if (!auto) setRankError(e instanceof ApiError && e.code ? aiErrorText(e.code, t) : (e as Error).message);
      } finally {
        setRanking(false);
      }
    },
    [lang, t]
  );
  // Ranking by itself only with a local model; otherwise a button the user clicks.
  useEffect(() => {
    if (!data || !data.replies.length) return;
    let off = false;
    void (async () => {
      const on = await aiEnabled('prioritize');
      if (off || !on) return;
      setCanRank(true);
      if (await aiLocal()) void runRank(true);
    })();
    return () => {
      off = true;
    };
  }, [data, runRank]);

  const open = (target: BriefingTarget) => {
    onOpen(target);
    onClose();
  };
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const replies = data
    ? rank
      ? applyRanking(data.replies, rank.items)
      : data.replies.map(r => ({ ...r, ai: null }))
    : [];
  const { data: promises } = useCommitments();
  const openPromises = promises?.items || [];
  const empty = data && isEmptyBriefing(data) && !openPromises.length;
  const heading = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  if (auto && !data) return null;
  return (
    <Dialog
      title={t('Mein Tag')}
      description={`${t(greetingFor())}! ${heading}`}
      onClose={onClose}
      size="lg"
      className="briefing"
      footer={
        <>
          <label className="briefing-auto">
            <input
              type="checkbox"
              checked={prefs.briefingOnStart}
              onChange={e => setPrefs({ briefingOnStart: e.target.checked })}
            />
            {t('Jeden Tag beim ersten Öffnen zeigen')}
          </label>
          <Button variant="primary" onClick={onClose}>
            {t('Los geht’s')}
          </Button>
        </>
      }
    >
      {!data && !error && (
        <p className="briefing-loading" role="status">
          <LoaderCircle className="spin" size={16} aria-hidden="true" /> {t('Wird zusammengestellt …')}
        </p>
      )}
      {error && (
        <p className="briefing-error" role="alert">
          {error}{' '}
          <Button size="sm" onClick={() => void load()}>
            {t('Erneut versuchen')}
          </Button>
        </p>
      )}
      {empty && (
        <p className="briefing-empty">
          {t('Heute steht nichts an. Keine Termine, keine fälligen Aufgaben, keine offenen Antworten.')}
        </p>
      )}
      {data && (
        <div className="briefing-grid">
          {data.events.length > 0 && (
            <section className="briefing-section" aria-labelledby="briefing-events">
              <h3 id="briefing-events">
                <CalendarDays size={15} aria-hidden="true" /> {t('Termine heute')}
              </h3>
              <ul>
                {data.events.map(e => (
                  <li key={`${e.uid}|${e.start}`}>
                    <button className="briefing-item" onClick={() => open({ type: 'calendar' })}>
                      <span className="briefing-when">{e.allDay ? t('Ganztägig') : time(e.start)}</span>
                      <span className="briefing-main">
                        <strong>{e.summary || t('(Ohne Titel)')}</strong>
                        {(e.location || e.attendees > 0) && (
                          <span className="briefing-meta">
                            {e.location && (
                              <>
                                <MapPin size={12} aria-hidden="true" /> {e.location}
                              </>
                            )}
                            {e.attendees > 0 && (
                              <>
                                {' '}
                                <Users size={12} aria-hidden="true" /> {t('{n} Teilnehmende', { n: e.attendees })}
                              </>
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {replies.length > 0 && (
            <section className="briefing-section" aria-labelledby="briefing-replies">
              <h3 id="briefing-replies">
                <Inbox size={15} aria-hidden="true" /> {t('Wartet auf deine Antwort')}
                {ranking && <LoaderCircle className="spin" size={13} aria-label={t('KI sortiert …')} />}
              </h3>
              {rank && (
                <p className="ai-label" title={t('Von einer KI erstellt. Bitte prüfen.')}>
                  <Sparkles size={12} aria-hidden="true" /> {t('Reihenfolge KI-generiert')} · {rank.model}
                </p>
              )}
              <ul>
                {replies.map(r => (
                  <li key={`${r.accountId}|${r.uid}`}>
                    <button
                      className={`briefing-item ${r.ai?.needsReply || r.ai?.priority === 'high' ? 'is-important' : ''}`}
                      onClick={() => open({ type: 'mail', accountId: r.accountId, folder: r.folder, uid: r.uid })}
                    >
                      <span className="briefing-main">
                        <span>
                          <strong>{r.fromName || r.fromEmail}</strong> · {r.subject}
                        </span>
                        {r.ai?.reason ? (
                          <span className="briefing-meta">
                            <Sparkles size={11} aria-hidden="true" /> {r.ai.reason}
                          </span>
                        ) : (
                          r.preview && <span className="briefing-meta">{r.preview}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {data.moreReplies > 0 && (
                <p className="briefing-more">{t('und {n} weitere im Posteingang', { n: data.moreReplies })}</p>
              )}
              {canRank && !rank && !ranking && (
                <Button size="sm" icon={<Sparkles size={13} />} onClick={() => void runRank(false)}>
                  {t('Mit KI ordnen: was braucht heute eine Antwort?')}
                </Button>
              )}
              {rankError && (
                <p className="briefing-error" role="alert">
                  {rankError}
                </p>
              )}
            </section>
          )}
          {data.tasks.length > 0 && (
            <section className="briefing-section" aria-labelledby="briefing-tasks">
              <h3 id="briefing-tasks">
                <ListTodo size={15} aria-hidden="true" /> {t('Aufgaben für heute')}
              </h3>
              <ul>
                {data.tasks.map(task => (
                  <li key={task.id} className="briefing-row">
                    <button className="briefing-item" onClick={() => open({ type: 'tasks' })}>
                      <span className="briefing-main">
                        <strong>{task.title}</strong>
                        {task.due && (
                          <span className={`briefing-meta ${task.overdue ? 'is-overdue' : ''}`}>
                            {task.overdue
                              ? t('überfällig seit {when}', {
                                  when: formatTaskDate(locale, task.due, { weekday: 'short' })
                                })
                              : t('fällig {when}', { when: formatTaskDate(locale, task.due, { weekday: 'short' }) })}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      className="icon-button"
                      title={t('Erledigt')}
                      aria-label={t('{title} erledigt', { title: task.title })}
                      onClick={async () => {
                        try {
                          await postJson('/api/tasks/done', { id: task.id, done: true }, 'mail-v1');
                          tasksChanged();
                          setData(d => (d ? { ...d, tasks: d.tasks.filter(x => x.id !== task.id) } : d));
                        } catch (e) {
                          toast({ text: (e as Error).message, kind: 'error' });
                        }
                      }}
                    >
                      <CircleCheck size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {openPromises.length > 0 && (
            <section className="briefing-section" aria-labelledby="briefing-promises">
              <h3 id="briefing-promises">
                <Handshake size={15} aria-hidden="true" /> {t('Versprechen')}
              </h3>
              <CommitmentList
                compact
                items={openPromises.slice(0, 6)}
                onOpenMail={c => open({ type: 'mail', accountId: c.accountId, folder: c.folder, uid: c.uid })}
              />
            </section>
          )}
          {data.followups.length > 0 && (
            <section className="briefing-section" aria-labelledby="briefing-followups">
              <h3 id="briefing-followups">
                <BellRing size={15} aria-hidden="true" /> {t('Keine Antwort erhalten')}
              </h3>
              <ul>
                {data.followups.map(f => (
                  <li key={f.id}>
                    <button className="briefing-item" onClick={() => open({ type: 'followups' })}>
                      <span className="briefing-main">
                        <strong>{f.subject || t('(Ohne Betreff)')}</strong>
                        {f.to.length > 0 && (
                          <span className="briefing-meta">{t('an {to}', { to: f.to.join(', ') })}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(data.spaces.updated.length > 0 || data.spaces.invitations.length > 0) && (
            <section className="briefing-section" aria-labelledby="briefing-spaces">
              <h3 id="briefing-spaces">
                <Users size={15} aria-hidden="true" /> {t('Neues in deinen Räumen')}
              </h3>
              <ul>
                {data.spaces.invitations.map(i => (
                  <li key={i.id}>
                    <button className="briefing-item" onClick={() => open({ type: 'spaces' })}>
                      <span className="briefing-main">
                        <strong>{t('Einladung: {name}', { name: i.name })}</strong>
                        {i.from && <span className="briefing-meta">{t('von {name}', { name: i.from })}</span>}
                      </span>
                    </button>
                  </li>
                ))}
                {data.spaces.updated.map(s => (
                  <li key={s.id}>
                    <button className="briefing-item" onClick={() => open({ type: 'spaces' })}>
                      <span className="briefing-main">
                        <strong>{s.name}</strong>
                        <span className="briefing-meta">
                          {s.openTasks === 1
                            ? t('Neue Aktivität · 1 offene Aufgabe')
                            : s.openTasks > 0
                              ? t('Neue Aktivität · {n} offene Aufgaben', { n: s.openTasks })
                              : t('Neue Aktivität')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {data && data.unavailable.length > 0 && (
        <p className="briefing-more" role="note">
          {t('Nicht alles konnte geladen werden: {what}.', {
            what: data.unavailable
              .map(u => unavailableLabel(u, t))
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(', ')
          })}
        </p>
      )}
    </Dialog>
  );
}

function unavailableLabel(source: string, t: (s: string) => string) {
  if (source === 'calendar') return t('Kalender');
  if (source === 'tasks') return t('Aufgaben');
  if (source === 'followups') return t('Nachfassen');
  if (source === 'spaces') return t('Räume');
  return t('E-Mail');
}
