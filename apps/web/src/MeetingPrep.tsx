// Meeting preparation: shortly before a meeting with other people, a card at the bottom right shows
// who takes part (with their address book entries), the latest mails with them, files, and open
// points (tasks, follow-ups, promises). Built from local data (server: meeting-prep.mjs). On request
// the AI summarizes the open points of those mails (the existing "digest" function), labelled as
// AI output. The card never covers the app: it is not modal and closes with Escape.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BellRing,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  FileText,
  Handshake,
  ListTodo,
  LoaderCircle,
  Mail,
  MapPin,
  Sparkles,
  Users,
  X
} from 'lucide-react';
import { aiEnabled, aiErrorText, runAi } from './ai';
import { ApiError, getJson } from './api';
import { prepKey, refsForDigest } from './day-utils';
import { useT } from './i18n';
import { usePrefs } from './prefs';
import { useUi } from './ConfirmDialog';
import { formatTaskDate } from './tasks';
import { Button, IconButton } from './ui';

export type Meeting = { uid: string; start: string; end: string; summary: string; location: string };
type PrepMail = {
  accountId: string;
  folder: string;
  uid: number;
  subject: string;
  fromName: string;
  fromEmail: string;
  date: string;
  hasAttachments: boolean;
};
export type Prep = {
  event: { uid: string; summary: string; start: string; end: string; location: string; description: string };
  attendees: {
    email: string;
    name: string;
    role: string;
    partstat: string;
    contact: { name: string; organization: string; title: string; phone: string } | null;
  }[];
  mails: PrepMail[];
  files: { source: 'event' | 'mail'; name: string; accountId?: string; folder?: string; uid?: number }[];
  tasks: { id: string; title: string; due: string | null }[];
  followups: { id: string; subject: string; due: string | null }[];
  promises: { id: string; direction: 'mine' | 'theirs'; what: string; due: string | null }[];
  unavailable: string[];
};
type Digest = {
  summary: string[];
  open_questions?: string[];
  deadlines?: { text: string; date: string }[];
};

const SHOWN = 'levuvo-mail-meeting-prep-shown';
function shownKeys(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(SHOWN) || '[]');
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}
const prepWasShown = (key: string) => shownKeys().includes(key);
function markPrepShown(key: string) {
  try {
    window.localStorage.setItem(SHOWN, JSON.stringify([...shownKeys().filter(k => k !== key), key].slice(-50)));
  } catch {
    /* storage blocked: the card may show once more */
  }
}

/** Opens the preparation for the next meeting (or a given one) from anywhere. */
export const openMeetingPrep = (meeting?: Pick<Meeting, 'uid' | 'start'>) =>
  window.dispatchEvent(new CustomEvent('levuvo:meeting-prep', { detail: meeting || null }));

/** Watches for a meeting about to start and returns the one to show (once per meeting). */
export function useMeetingWatch(enabled: boolean, minutes: number) {
  const { t } = useT();
  const { toast } = useUi();
  // Kept in a ref so the polling callback stays stable.
  const say = useRef((text: string) => toast({ text, kind: 'info' }));
  say.current = (text: string) => toast({ text, kind: 'info' });
  const texts = useRef(t);
  texts.current = t;
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [expanded, setExpanded] = useState(false);
  const busy = useRef(false);
  const check = useCallback(async (within: number, force = false, wanted?: Pick<Meeting, 'uid' | 'start'> | null) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await getJson<{ meetings: Meeting[] }>(`/api/meeting-prep/upcoming?minutes=${within}`);
      const list = Array.isArray(r?.meetings) ? r.meetings : [];
      const next = wanted
        ? list.find(m => m.uid === wanted.uid && m.start === wanted.start) || {
            uid: wanted.uid,
            start: wanted.start,
            end: '',
            summary: '',
            location: ''
          }
        : list.find(m => force || !prepWasShown(prepKey(m)));
      if (next) {
        markPrepShown(prepKey(next));
        setMeeting(next);
        setExpanded(force);
      } else if (force) {
        setMeeting(null);
        say.current(texts.current('In den nächsten 24 Stunden steht kein Termin mit anderen an.'));
      }
    } catch {
      /* calendar not reachable: try again next minute */
      if (force) say.current(texts.current('Der Kalender ist gerade nicht erreichbar.'));
    } finally {
      busy.current = false;
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void check(minutes);
    const timer = window.setInterval(() => void check(minutes), 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, minutes, check]);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const wanted = (e as CustomEvent<Pick<Meeting, 'uid' | 'start'> | null>).detail;
      void check(24 * 60, true, wanted);
    };
    window.addEventListener('levuvo:meeting-prep', onOpen);
    return () => window.removeEventListener('levuvo:meeting-prep', onOpen);
  }, [check]);
  return { meeting, expanded, setExpanded, close: () => setMeeting(null) };
}

export function MeetingPrepCard({
  meeting,
  expanded,
  onExpand,
  onClose,
  onOpenMail
}: {
  meeting: Meeting;
  expanded: boolean;
  onExpand: (v: boolean) => void;
  onClose: () => void;
  onOpenMail: (m: { accountId: string; folder: string; uid: number }) => void;
}) {
  const { t, lang, locale } = useT();
  const [prep, setPrep] = useState<Prep | null>(null);
  const [error, setError] = useState('');
  const [digest, setDigest] = useState<{ data: Digest; model: string } | null>(null);
  const [digesting, setDigesting] = useState(false);
  const [digestError, setDigestError] = useState('');
  const [canDigest, setCanDigest] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    let off = false;
    void getJson<Prep>(
      `/api/meeting-prep?uid=${encodeURIComponent(meeting.uid)}&start=${encodeURIComponent(meeting.start)}`
    )
      .then(p => !off && setPrep(p))
      .catch(e => !off && setError((e as Error).message));
    void aiEnabled('digest').then(v => !off && setCanDigest(v));
    return () => {
      off = true;
    };
  }, [meeting.uid, meeting.start]);
  // The "in 4 minutes" label stays current.
  useEffect(() => {
    const timer = window.setInterval(() => forceTick(n => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const title = prep?.event.summary || meeting.summary || t('(Ohne Titel)');
  const start = new Date(prep?.event.start || meeting.start);
  const mins = Math.round((start.getTime() - Date.now()) / 60_000);
  const when =
    mins > 0 && mins <= 60
      ? t('in {n} Min.', { n: mins })
      : mins === 0
        ? t('jetzt')
        : start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const people = prep?.attendees || [];
  const refs = prep ? refsForDigest(prep.mails) : null;

  async function summarize() {
    if (!refs) return;
    setDigesting(true);
    setDigestError('');
    try {
      const r = await runAi<Digest>('digest', { account: refs.account, refs: refs.refs, lang });
      setDigest({ data: r.result, model: r.model });
    } catch (e) {
      setDigestError(e instanceof ApiError && e.code ? aiErrorText(e.code, t) : (e as Error).message);
    } finally {
      setDigesting(false);
    }
  }

  return (
    <section
      className={`meeting-prep ${expanded ? 'is-open' : ''}`}
      aria-label={t('Termin-Vorbereitung')}
      tabIndex={-1}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="meeting-prep-head">
        <CalendarClock size={16} aria-hidden="true" />
        <div className="meeting-prep-title">
          <strong>{title}</strong>
          <span>
            {when}
            {(prep?.event.location || meeting.location) && (
              <>
                {' · '}
                <MapPin size={11} aria-hidden="true" /> {prep?.event.location || meeting.location}
              </>
            )}
          </span>
        </div>
        <IconButton
          label={expanded ? t('Weniger anzeigen') : t('Vorbereitung anzeigen')}
          icon={expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          onClick={() => onExpand(!expanded)}
          aria-expanded={expanded}
        />
        <IconButton label={t('Schließen')} icon={<X size={16} />} onClick={onClose} />
      </header>
      {!expanded && people.length > 0 && (
        <button type="button" className="meeting-prep-peek" onClick={() => onExpand(true)}>
          <Users size={13} aria-hidden="true" /> {people.map(p => p.name || p.email).join(', ')}
        </button>
      )}
      {expanded && (
        <div className="meeting-prep-body">
          {!prep && !error && (
            <p className="briefing-loading" role="status">
              <LoaderCircle className="spin" size={14} aria-hidden="true" /> {t('Wird vorbereitet …')}
            </p>
          )}
          {error && (
            <p className="briefing-error" role="alert">
              {error}
            </p>
          )}
          {prep && (
            <>
              {people.length > 0 && (
                <div className="meeting-prep-section">
                  <h3>
                    <Users size={13} aria-hidden="true" /> {t('Teilnehmende')}
                  </h3>
                  <ul>
                    {people.map(p => (
                      <li key={p.email} className="meeting-person">
                        <strong>{p.contact?.name || p.name || p.email}</strong>
                        <span className="briefing-meta">
                          {[p.contact?.title, p.contact?.organization].filter(Boolean).join(', ') || p.email}
                          {p.partstat === 'ACCEPTED' && ` · ${t('zugesagt')}`}
                          {p.partstat === 'DECLINED' && ` · ${t('abgesagt')}`}
                          {p.partstat === 'TENTATIVE' && ` · ${t('vielleicht')}`}
                          {p.role === 'organizer' && ` · ${t('Organisator')}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {prep.mails.length > 0 && (
                <div className="meeting-prep-section">
                  <h3>
                    <Mail size={13} aria-hidden="true" /> {t('Letzte Mails')}
                  </h3>
                  <ul>
                    {prep.mails.map(m => (
                      <li key={`${m.accountId}|${m.folder}|${m.uid}`}>
                        <button
                          type="button"
                          className="briefing-item"
                          onClick={() => onOpenMail({ accountId: m.accountId, folder: m.folder, uid: m.uid })}
                        >
                          <span className="briefing-main">
                            <strong>{m.subject}</strong>
                            <span className="briefing-meta">
                              {m.fromName || m.fromEmail}
                              {m.date
                                ? ` · ${new Date(m.date).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`
                                : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {prep.files.length > 0 && (
                <div className="meeting-prep-section">
                  <h3>
                    <FileText size={13} aria-hidden="true" /> {t('Dateien')}
                  </h3>
                  <ul>
                    {prep.files.map((f, i) => (
                      <li key={`${f.source}${i}`}>
                        {f.source === 'mail' && f.accountId ? (
                          <button
                            type="button"
                            className="briefing-item"
                            onClick={() => onOpenMail({ accountId: f.accountId!, folder: f.folder!, uid: f.uid! })}
                          >
                            <span className="briefing-main">
                              <span>{t('Anhang in „{subject}“', { subject: f.name })}</span>
                            </span>
                          </button>
                        ) : (
                          <span className="meeting-file">{t('Im Termin: {name}', { name: f.name })}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(prep.tasks.length > 0 || prep.followups.length > 0 || prep.promises.length > 0) && (
                <div className="meeting-prep-section">
                  <h3>
                    <ListTodo size={13} aria-hidden="true" /> {t('Offene Punkte')}
                  </h3>
                  <ul>
                    {prep.tasks.map(x => (
                      <li key={x.id} className="meeting-point">
                        <ListTodo size={13} aria-hidden="true" /> {x.title}
                        {x.due && (
                          <span className="briefing-meta">
                            {' '}
                            · {formatTaskDate(locale, x.due, { weekday: 'short' })}
                          </span>
                        )}
                      </li>
                    ))}
                    {prep.followups.map(x => (
                      <li key={x.id} className="meeting-point">
                        <BellRing size={13} aria-hidden="true" />{' '}
                        {t('Noch keine Antwort auf „{subject}“', { subject: x.subject })}
                      </li>
                    ))}
                    {prep.promises.map(x => (
                      <li key={x.id} className="meeting-point">
                        <Handshake size={13} aria-hidden="true" />{' '}
                        {x.direction === 'mine'
                          ? t('Deine Zusage: {what}', { what: x.what })
                          : t('Zugesagt: {what}', { what: x.what })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!people.length && !prep.mails.length && !prep.files.length && (
                <p className="briefing-empty">{t('Keine passenden Mails, Dateien oder offenen Punkte gefunden.')}</p>
              )}
              {canDigest && refs && !digest && (
                <Button size="sm" icon={<Sparkles size={13} />} busy={digesting} onClick={() => void summarize()}>
                  {t('Worum geht es? Mit KI zusammenfassen')}
                </Button>
              )}
              {digestError && (
                <p className="briefing-error" role="alert">
                  {digestError}
                </p>
              )}
              {digest && (
                <div className="meeting-prep-section meeting-digest">
                  <p className="ai-label" title={t('Von einer KI erstellt. Bitte prüfen.')}>
                    <Sparkles size={12} aria-hidden="true" /> {t('KI-generiert')} · {digest.model}
                  </p>
                  <ul className="ai-summary">
                    {(digest.data.summary || []).map((s, i) => (
                      <li key={`s${i}`}>{s}</li>
                    ))}
                    {(digest.data.open_questions || []).map((s, i) => (
                      <li key={`q${i}`}>{t('Offen: {text}', { text: s })}</li>
                    ))}
                    {(digest.data.deadlines || []).map((d, i) => (
                      <li key={`d${i}`}>{t('Frist: {text}', { text: d.date ? `${d.text} (${d.date})` : d.text })}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** The card, wired to the user's setting; rendered once in the app shell. */
export function MeetingPrep({
  onOpenMail
}: {
  onOpenMail: (m: { accountId: string; folder: string; uid: number }) => void;
}) {
  const [prefs] = usePrefs();
  const { meeting, expanded, setExpanded, close } = useMeetingWatch(prefs.meetingPrep > 0, prefs.meetingPrep || 10);
  if (!meeting) return null;
  return (
    <MeetingPrepCard
      key={prepKey(meeting)}
      meeting={meeting}
      expanded={expanded}
      onExpand={setExpanded}
      onClose={close}
      onOpenMail={m => {
        onOpenMail(m);
        setExpanded(false);
      }}
    />
  );
}
