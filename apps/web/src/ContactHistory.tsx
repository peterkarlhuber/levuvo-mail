// Contact history ("mini CRM"): notes, tasks, mails and appointments about one person in one
// timeline. Everything comes from this computer: notes are stored encrypted (contact-notes.json),
// tasks in the encrypted task list, mails from the encrypted search index and appointments from
// the connected calendars. Nothing is looked up online and no AI is involved.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckSquare, LoaderCircle, Mail, Pencil, Plus, Square, StickyNote, Trash2 } from 'lucide-react';
import { getJson, postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import {
  buildTimeline,
  countKinds,
  historyAddresses,
  type ContactNote,
  type HistoryItem,
  type HistoryKind,
  type HistoryMail
} from './contact-history';
import type { Task } from './tasks';
import type { CalendarEvent } from './types';

const DAY = 86_400_000;
type History = { notes: ContactNote[]; tasks: Task[]; notesError: string; tasksError: string };
type OpenMail = (mail: { accountId: string; folder: string; uid: number }) => void;

/** Notes and tasks of all addresses of the person (merged, without duplicates). */
async function loadHistory(addresses: string[]): Promise<History> {
  const parts = await Promise.all(
    addresses.map(email =>
      getJson<{
        notes: ContactNote[];
        tasks: Task[];
        notesError: { error: string } | null;
        tasksError: { error: string } | null;
      }>(`/api/contact-history?email=${encodeURIComponent(email)}`)
    )
  );
  const notes = new Map<string, ContactNote>();
  const tasks = new Map<string, Task>();
  for (const p of parts) {
    for (const n of p.notes) notes.set(n.id, n);
    for (const t of p.tasks) tasks.set(t.id, t);
  }
  return {
    notes: [...notes.values()],
    tasks: [...tasks.values()],
    notesError: parts.find(p => p.notesError)?.notesError?.error || '',
    tasksError: parts.find(p => p.tasksError)?.tasksError?.error || ''
  };
}

/**
 * Notes and tasks about a person, with forms to add them. `compact` (the reader's contact card)
 * shows only these; the contacts module adds the timeline of mails and appointments.
 */
export default function ContactHistory({
  emails,
  name,
  compact = false,
  onOpenMail
}: {
  emails: string[];
  name: string;
  compact?: boolean;
  onOpenMail?: OpenMail;
}) {
  const { t, locale } = useT();
  const { confirm, toast } = useUi();
  const addresses = useMemo(() => historyAddresses(emails), [emails]);
  const key = addresses.join(',');
  const [history, setHistory] = useState<History | null>(null);
  const [mails, setMails] = useState<HistoryMail[] | null>(compact ? [] : null);
  const [events, setEvents] = useState<CalendarEvent[] | null>(compact ? [] : null);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | HistoryKind>('all');

  const reload = useCallback(async () => {
    if (!addresses.length) return;
    try {
      setHistory(await loadHistory(addresses));
    } catch (err) {
      setHistory({ notes: [], tasks: [], notesError: (err as Error).message, tasksError: '' });
    }
    // addresses is derived from key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    let live = true;
    setHistory(null);
    setNote('');
    setEditing(null);
    setTaskTitle('');
    setError('');
    void reload();
    if (!compact && addresses.length) {
      setMails(null);
      setEvents(null);
      // The encrypted search index of all accounts; while it is switched off the list stays empty.
      Promise.all(
        addresses.map(a =>
          getJson<{ messages: HistoryMail[] }>(`/api/search/local?q=${encodeURIComponent(a)}&limit=50`)
            .then(d => d.messages || [])
            .catch(() => [] as HistoryMail[])
        )
      ).then(list => live && setMails(list.flat()));
      const now = Date.now();
      getJson<{ events: CalendarEvent[] }>(
        `/api/calendar/events?from=${new Date(now - 365 * DAY).toISOString()}&to=${new Date(now + 180 * DAY).toISOString()}`
      )
        .then(d => live && setEvents(d.events || []))
        .catch(() => live && setEvents([]));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, compact]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await reload();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    if (
      await run(() => postJson('/api/contact-history/notes/save', { email: addresses[0], text: note }, 'contacts-v1'))
    )
      setNote('');
  };
  const saveEdit = async () => {
    if (!editing) return;
    if (
      await run(() =>
        postJson('/api/contact-history/notes/save', { id: editing.id, text: editing.text }, 'contacts-v1')
      )
    )
      setEditing(null);
  };
  const removeNote = async (n: ContactNote) => {
    const ok = await confirm({
      title: t('Notiz löschen?'),
      message: t('Die Notiz wird von diesem Gerät gelöscht.'),
      confirmLabel: t('Löschen'),
      danger: true
    });
    if (ok) await run(() => postJson('/api/contact-history/notes/delete', { id: n.id }, 'contacts-v1'));
  };
  const addTask = async () => {
    const title = taskTitle.trim();
    if (!title) return;
    if (
      await run(() =>
        postJson('/api/tasks/save', { task: { title, contact: { email: addresses[0], name } } }, 'mail-v1')
      )
    ) {
      setTaskTitle('');
      toast({ kind: 'info', text: t('Aufgabe angelegt.') });
    }
  };
  const toggleTask = (task: Task) =>
    void run(() => postJson('/api/tasks/done', { id: task.id, done: !task.done }, 'mail-v1'));

  const timeline = useMemo(
    () =>
      buildTimeline(
        { mails: mails || [], events: events || [], tasks: history?.tasks || [], notes: history?.notes || [] },
        addresses
      ),
    [mails, events, history, addresses]
  );
  const counts = countKinds(timeline);
  const shown = filter === 'all' ? timeline : timeline.filter(i => i.kind === filter);
  const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const day = (iso: string) => {
    const d = new Date(iso);
    return Number.isFinite(d.getTime()) ? dateFmt.format(d) : '';
  };
  const loading = history === null || mails === null || events === null;
  if (!addresses.length) return null;

  const noteRow = (n: ContactNote) =>
    editing?.id === n.id ? (
      <form
        className="contact-history-note-edit"
        onSubmit={e => {
          e.preventDefault();
          void saveEdit();
        }}
      >
        <textarea
          rows={3}
          maxLength={5000}
          aria-label={t('Notiz bearbeiten')}
          value={editing.text}
          onChange={e => setEditing({ id: n.id, text: e.target.value })}
        />
        <span className="contact-history-buttons">
          <button type="button" className="btn small" onClick={() => setEditing(null)}>
            {t('Abbrechen')}
          </button>
          <button type="submit" className="btn small primary" disabled={busy || !editing.text.trim()}>
            {t('Speichern')}
          </button>
        </span>
      </form>
    ) : (
      <>
        <p className="pre">{n.text}</p>
        <span className="contact-history-buttons">
          <button
            type="button"
            className="icon-button"
            aria-label={t('Notiz bearbeiten')}
            title={t('Notiz bearbeiten')}
            onClick={() => setEditing({ id: n.id, text: n.text })}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('Notiz löschen')}
            title={t('Notiz löschen')}
            onClick={() => void removeNote(n)}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </>
    );
  const taskRow = (task: Task) => (
    <button
      type="button"
      className="contact-history-task"
      role="checkbox"
      aria-checked={task.done}
      onClick={() => toggleTask(task)}
    >
      {task.done ? <CheckSquare size={14} aria-hidden="true" /> : <Square size={14} aria-hidden="true" />}
      <span className={task.done ? 'done' : undefined}>{task.title}</span>
      {task.due && <small className="muted">{t('fällig {date}', { date: day(task.due) })}</small>}
    </button>
  );
  const icon = (kind: HistoryKind) =>
    kind === 'mail' ? (
      <Mail size={14} aria-hidden="true" />
    ) : kind === 'event' ? (
      <CalendarDays size={14} aria-hidden="true" />
    ) : kind === 'task' ? (
      <CheckSquare size={14} aria-hidden="true" />
    ) : (
      <StickyNote size={14} aria-hidden="true" />
    );
  const kindLabel = (kind: HistoryKind) =>
    ({ mail: t('E-Mail'), event: t('Termin'), task: t('Aufgabe'), note: t('Notiz') })[kind];
  const itemBody = (i: HistoryItem) => {
    if (i.kind === 'note') return noteRow(i.note);
    if (i.kind === 'task') return taskRow(i.task);
    if (i.kind === 'event') return <span>{i.event.summary || t('(Ohne Titel)')}</span>;
    const m = i.mail;
    return onOpenMail && m.accountId ? (
      <button
        type="button"
        className="link-button"
        onClick={() => onOpenMail({ accountId: m.accountId!, folder: m.folder, uid: m.uid })}
      >
        {m.subject || t('(Ohne Betreff)')}
      </button>
    ) : (
      <span>{m.subject || t('(Ohne Betreff)')}</span>
    );
  };

  const forms = (
    <>
      <form
        className="contact-history-form"
        onSubmit={e => {
          e.preventDefault();
          void saveNote();
        }}
      >
        <textarea
          rows={compact ? 2 : 3}
          maxLength={5000}
          value={note}
          aria-label={t('Neue Notiz')}
          placeholder={t('Notiz zu {name} …', { name: name || addresses[0] })}
          onChange={e => setNote(e.target.value)}
        />
        <button type="submit" className="btn small" disabled={busy || !note.trim()}>
          <StickyNote size={14} aria-hidden="true" /> {t('Notiz speichern')}
        </button>
      </form>
      <form
        className="contact-history-form inline"
        onSubmit={e => {
          e.preventDefault();
          void addTask();
        }}
      >
        <input
          value={taskTitle}
          maxLength={300}
          aria-label={t('Neue Aufgabe')}
          placeholder={t('Aufgabe zu {name} …', { name: name || addresses[0] })}
          onChange={e => setTaskTitle(e.target.value)}
        />
        <button type="submit" className="btn small" disabled={busy || !taskTitle.trim()}>
          {busy ? (
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
          ) : (
            <Plus size={14} aria-hidden="true" />
          )}{' '}
          {t('Aufgabe anlegen')}
        </button>
      </form>
      {error && (
        <p className="modal-error" role="alert">
          {error}
        </p>
      )}
      {history?.notesError && <p className="muted small">{history.notesError}</p>}
      {history?.tasksError && <p className="muted small">{history.tasksError}</p>}
    </>
  );

  if (compact) {
    const notes = history?.notes || [];
    const tasks = (history?.tasks || []).filter(x => !x.done);
    return (
      <section className="contact-history compact" aria-label={t('Notizen und Aufgaben')}>
        <h4>
          <StickyNote size={13} /> {t('Notizen und Aufgaben')}
        </h4>
        {forms}
        {history === null ? (
          <small className="muted">{t('Wird geladen …')}</small>
        ) : (
          <ul>
            {tasks.map(task => (
              <li key={task.id}>{taskRow(task)}</li>
            ))}
            {[...notes]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 5)
              .map(n => (
                <li key={n.id} className="contact-history-note">
                  <small className="muted">{day(n.createdAt)}</small>
                  {noteRow(n)}
                </li>
              ))}
          </ul>
        )}
      </section>
    );
  }

  const filters: { id: 'all' | HistoryKind; label: string; count: number }[] = [
    { id: 'all', label: t('Alles'), count: timeline.length },
    { id: 'mail', label: t('E-Mails'), count: counts.mail },
    { id: 'event', label: t('Termine'), count: counts.event },
    { id: 'task', label: t('Aufgaben'), count: counts.task },
    { id: 'note', label: t('Notizen'), count: counts.note }
  ];
  return (
    <section className="contact-history" aria-labelledby="contact-history-title">
      <h3 id="contact-history-title">{t('Verlauf')}</h3>
      <p className="muted small">
        {t('Nur auf diesem Gerät: Notizen werden verschlüsselt gespeichert, E-Mails kommen aus dem lokalen Suchindex.')}
      </p>
      {forms}
      <div className="contact-history-filter" role="group" aria-label={t('Verlauf filtern')}>
        {filters.map(f => (
          <button
            key={f.id}
            type="button"
            className={`chip ${filter === f.id ? 'active' : ''}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label} <span className="muted">{f.count}</span>
          </button>
        ))}
      </div>
      {loading && (
        <p className="muted small" role="status">
          <LoaderCircle size={13} className="spin" aria-hidden="true" /> {t('Wird geladen …')}
        </p>
      )}
      {!loading && !shown.length && <p className="muted small">{t('Noch nichts im Verlauf.')}</p>}
      <ol className="contact-history-list">
        {shown.map(i => (
          <li key={i.key} className={`contact-history-item ${i.kind}`}>
            <span className="contact-history-kind" title={kindLabel(i.kind)}>
              {icon(i.kind)}
              <span className="sr-only">{kindLabel(i.kind)}</span>
            </span>
            <time dateTime={i.at} className="muted small">
              {day(i.at)}
            </time>
            <div className="contact-history-body">{itemBody(i)}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
