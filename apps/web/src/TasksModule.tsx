// "Aufgaben" module: own list with views (today, upcoming, overdue, all open, done), quick add,
// priority, reminders, repetition and the link back to the mail a task came from.
import { useEffect, useMemo, useState } from 'react';
import {
  AlarmClock,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Circle,
  CircleCheck,
  Cloud,
  Flag,
  Inbox,
  ListTodo,
  LoaderCircle,
  Lock,
  Mail,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
  Users
} from 'lucide-react';
import { postAction, postJson } from './api';
import { useTasks } from './task-reminders';
import { CommitmentList, useCommitments } from './Commitments';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import TaskDialog, { tasksChanged, type TaskDraft } from './TaskDialog';
import { TaskListsNav, useTaskLinks } from './TaskLists';
import {
  dueState,
  filterView,
  formatTaskDate,
  inList,
  localDate,
  spaceFilter,
  spacesOf,
  viewCounts,
  type Task,
  type TaskListFilter,
  type TaskMailRef,
  type TaskView
} from './tasks';

const ARCHIVE_KEY = 'levuvo-tasks-archive-on-done';
const readArchivePref = () => {
  try {
    return window.localStorage.getItem(ARCHIVE_KEY) === '1';
  } catch {
    return false;
  }
};

export default function TasksModule({ onOpenMail }: { onOpenMail: (mail: TaskMailRef) => void }) {
  const { data: promises } = useCommitments();
  const { t, locale } = useT();
  const { toast, confirm } = useUi();
  const { tasks, error, reload } = useTasks();
  // Space tasks change when other members work on them: refresh while the module is open.
  useEffect(() => {
    const timer = window.setInterval(() => void reload(), 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  const [view, setView] = useState<TaskView>('today');
  const [editing, setEditing] = useState<TaskDraft | null>(null);
  const [quick, setQuick] = useState('');
  const [archiveOnDone, setArchiveOnDone] = useState(readArchivePref);
  const { links } = useTaskLinks();
  const [listFilter, setListFilter] = useState<TaskListFilter>('all');
  const everything = useMemo(() => tasks || [], [tasks]);
  const spaces = useMemo(() => spacesOf(everything), [everything]);
  // A disconnected list (or a space without my tasks) falls back to all tasks.
  const activeList =
    listFilter === 'all' ||
    listFilter === 'local' ||
    links.some(l => l.id === listFilter) ||
    spaces.some(sp => spaceFilter(sp.id) === listFilter)
      ? listFilter
      : 'all';
  const all = useMemo(() => inList(everything, activeList), [everything, activeList]);
  const counts = viewCounts(all);
  const visible = filterView(all, view);
  const listCounts = useMemo(() => {
    const open = everything.filter(t => !t.done);
    return Object.fromEntries([
      ['all', open.length],
      ['local', inList(open, 'local').length],
      ...links.map(l => [l.id, inList(open, l.id).length]),
      ...spaces.map(sp => [spaceFilter(sp.id), inList(open, spaceFilter(sp.id)).length])
    ]) as Record<string, number>;
  }, [everything, links, spaces]);
  const inSpace = activeList.startsWith('space:') ? spaces.find(sp => spaceFilter(sp.id) === activeList) : null;
  // New tasks go into the list or space that is shown (a space only if I may add tasks there).
  const newInList = activeList === 'all' || activeList === 'local' || inSpace ? null : activeList;
  const newInSpace = inSpace && !inSpace.readOnly ? inSpace.id : null;
  const listName = (id: string | null | undefined) => links.find(l => l.id === id)?.name || '';

  async function quickAdd() {
    const title = quick.trim();
    if (!title) return;
    const due = view === 'today' ? localDate(new Date()) : null;
    try {
      await postJson('/api/tasks/save', { task: { title, due, list: newInList, space: newInSpace } }, 'mail-v1');
      setQuick('');
      tasksChanged();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }
  async function toggle(task: Task) {
    try {
      const r = await postJson<{ task: Task; finished: Task | null }>(
        '/api/tasks/done',
        { id: task.id, done: !task.done },
        'mail-v1'
      );
      tasksChanged();
      if (!task.done && r.finished && r.task.due)
        toast({ text: t('Erledigt. Nächste Fälligkeit: {when}', { when: dueLabel(r.task) }), kind: 'success' });
      if (!task.done && archiveOnDone && task.mail) {
        try {
          await postAction(
            '/api/messages/batch-action',
            { folder: task.mail.folder, action: 'archive', uids: [String(task.mail.uid)] },
            task.mail.accountId
          );
          toast({ text: t('Erledigt. Die E-Mail wurde archiviert.'), kind: 'success' });
        } catch (e) {
          toast({
            text: t('Erledigt, aber die E-Mail ließ sich nicht archivieren: {error}', { error: (e as Error).message }),
            kind: 'info'
          });
        }
      }
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }
  async function remove(task: Task) {
    const ok = await confirm({
      title: t('Aufgabe löschen?'),
      message: task.space
        ? t('„{title}“ wird im Raum „{space}“ für alle Mitglieder gelöscht.', {
            title: task.title,
            space: task.space.name
          })
        : task.title,
      confirmLabel: t('Löschen'),
      danger: true
    });
    if (!ok) return;
    try {
      await postJson('/api/tasks/delete', { id: task.id }, 'mail-v1');
      tasksChanged();
    } catch (e) {
      toast({ text: (e as Error).message, kind: 'error' });
    }
  }
  function dueLabel(task: Task) {
    return formatTaskDate(locale, task.due, { weekday: 'short' });
  }
  const repeatLabel: Record<string, string> = {
    'DAILY:1': t('Täglich'),
    'WEEKLY:1': t('Wöchentlich'),
    'WEEKLY:2': t('Alle zwei Wochen'),
    'MONTHLY:1': t('Monatlich'),
    'MONTHLY:3': t('Vierteljährlich'),
    'YEARLY:1': t('Jährlich')
  };
  const prioLabel = { high: t('Hoch'), medium: t('Mittel'), low: t('Niedrig'), none: '' };

  const views: { id: TaskView; label: string; icon: typeof Inbox }[] = [
    { id: 'today', label: t('Heute'), icon: CalendarClock },
    { id: 'upcoming', label: t('Demnächst'), icon: CalendarDays },
    { id: 'overdue', label: t('Überfällig'), icon: AlertTriangle },
    { id: 'open', label: t('Alle offenen'), icon: Inbox },
    { id: 'done', label: t('Erledigt'), icon: CheckCircle2 }
  ];
  const empty: Record<TaskView, string> = {
    today: t('Für heute ist nichts offen.'),
    upcoming: t('In den nächsten sieben Tagen ist nichts fällig.'),
    overdue: t('Nichts überfällig.'),
    open: t('Keine offenen Aufgaben.'),
    done: t('Noch nichts erledigt.'),
    all: t('Keine Aufgaben.')
  };

  const row = (task: Task) => {
    const state = dueState(task);
    const locked = Boolean(task.space?.readOnly);
    return (
      <div
        key={task.id}
        className={`task-row ${task.done ? 'done' : ''} due-${state} prio-${task.priority}`}
        role="listitem"
      >
        <button
          className="icon-button task-check"
          aria-label={task.done ? t('Als offen markieren') : t('Als erledigt markieren')}
          title={
            locked
              ? t('Nur lesen: In diesem Raum hast du die Rolle Leser.')
              : task.done
                ? t('Als offen markieren')
                : t('Als erledigt markieren')
          }
          disabled={locked}
          onClick={() => void toggle(task)}
        >
          {task.done ? <CircleCheck size={19} /> : <Circle size={19} />}
        </button>
        <button className="task-main" onClick={() => setEditing(task)}>
          <strong>{task.title}</strong>
          <span className="task-meta">
            {task.due && (
              <span className="task-due">
                {state === 'overdue' ? `${t('Überfällig')} · ` : ''}
                {dueLabel(task)}
              </span>
            )}
            {task.priority !== 'none' && (
              <span className={`task-prio prio-${task.priority}`}>
                <Flag size={11} /> {prioLabel[task.priority]}
              </span>
            )}
            {task.repeat && (
              <span title={t('Wiederholen')}>
                <Repeat size={11} /> {repeatLabel[`${task.repeat.freq}:${task.repeat.interval}`] || t('Wiederholt')}
              </span>
            )}
            {task.remindAt && !task.done && (
              <span title={t('Erinnerung')}>
                <AlarmClock size={11} /> {formatTaskDate(locale, task.remindAt)}
              </span>
            )}
            {task.source === 'ai' && (
              <span className="ai-label" title={t('Von der KI vorgeschlagen')}>
                <Sparkles size={11} aria-hidden="true" /> {t('KI')}
                <span className="sr-only"> {t('Von der KI vorgeschlagen')}</span>
              </span>
            )}
            {task.space && !inSpace && (
              <span className="task-space" title={t('Aufgabe aus dem Raum „{name}“', { name: task.space.name })}>
                <Users size={11} aria-hidden="true" />
                <span className="sr-only">{t('Raum')}: </span>
                {task.space.name}
              </span>
            )}
            {task.list && activeList === 'all' && (
              <span title={t('Liste')}>
                <Cloud size={11} /> {listName(task.list)}
              </span>
            )}
            {task.mail && (
              <span className="task-mail-ref">
                <Mail size={11} /> {task.mail.from || task.mail.subject}
              </span>
            )}
          </span>
          {task.notes && <small className="task-notes">{task.notes}</small>}
        </button>
        <div className="followup-actions">
          {task.mail && (
            <button
              className="icon-button"
              title={t('E-Mail öffnen')}
              aria-label={t('E-Mail öffnen')}
              onClick={() => onOpenMail(task.mail!)}
            >
              <Mail size={15} />
            </button>
          )}
          {!locked && (
            <button
              className="icon-button"
              title={t('Löschen')}
              aria-label={t('Löschen')}
              onClick={() => void remove(task)}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="tasks-module">
      <aside className="calendar-sidebar tasks-sidebar">
        <button
          className="btn primary"
          onClick={() =>
            setEditing({
              due: view === 'today' ? localDate(new Date()) : null,
              list: newInList,
              space: newInSpace ? { id: newInSpace, name: inSpace!.name } : null
            })
          }
        >
          <Plus size={15} /> {t('Neue Aufgabe')}
        </button>
        <h3>{t('Ansichten')}</h3>
        {views.map(v => (
          <button
            key={v.id}
            className={`folder-item ${view === v.id ? 'active' : ''}`}
            onClick={() => setView(v.id)}
            aria-current={view === v.id ? 'page' : undefined}
          >
            <v.icon size={16} strokeWidth={1.8} />
            <span>{v.label}</span>
            {v.id !== 'done' && counts[v.id] > 0 && (
              <span className={`folder-count ${v.id === 'overdue' ? 'attention' : ''}`}>{counts[v.id]}</span>
            )}
          </button>
        ))}
        <TaskListsNav filter={activeList} onFilter={setListFilter} links={links} counts={listCounts} />
        {spaces.length > 0 && (
          <>
            <h3>{t('Räume')}</h3>
            {spaces.map(sp => (
              <button
                key={sp.id}
                className={`folder-item ${activeList === spaceFilter(sp.id) ? 'active' : ''}`}
                onClick={() => setListFilter(spaceFilter(sp.id))}
                aria-current={activeList === spaceFilter(sp.id) ? 'page' : undefined}
                title={t('Mir zugewiesene Aufgaben aus dem Raum „{name}“', { name: sp.name })}
              >
                <Users size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{sp.name}</span>
                {(listCounts[spaceFilter(sp.id)] || 0) > 0 && (
                  <span className="folder-count">{listCounts[spaceFilter(sp.id)]}</span>
                )}
              </button>
            ))}
          </>
        )}
        <h3>{t('Optionen')}</h3>
        <label className="task-option">
          <input
            type="checkbox"
            checked={archiveOnDone}
            onChange={e => {
              setArchiveOnDone(e.target.checked);
              try {
                window.localStorage.setItem(ARCHIVE_KEY, e.target.checked ? '1' : '0');
              } catch {
                /* private mode */
              }
            }}
          />
          <span>{t('Beim Erledigen die verknüpfte E-Mail archivieren')}</span>
        </label>
      </aside>
      <section className="tasks-main">
        <div className="contacts-head">
          <h1>
            {views.find(v => v.id === view)?.label || t('Aufgaben')}
            <span className="period">.</span>
          </h1>
        </div>
        {view !== 'done' && !error?.locked && !(inSpace && inSpace.readOnly) && (
          <form
            className="task-quick"
            onSubmit={e => {
              e.preventDefault();
              void quickAdd();
            }}
          >
            <Plus size={16} />
            <input
              value={quick}
              maxLength={300}
              placeholder={view === 'today' ? t('Aufgabe für heute hinzufügen …') : t('Aufgabe hinzufügen …')}
              aria-label={t('Neue Aufgabe')}
              onChange={e => setQuick(e.target.value)}
            />
          </form>
        )}
        {view !== 'done' && !!promises?.items.length && (
          <section className="tasks-promises" aria-label={t('Versprechen aus deinen Mails')}>
            <h2>{t('Versprechen aus deinen Mails')}</h2>
            <CommitmentList
              items={promises.items}
              onOpenMail={c =>
                onOpenMail({
                  accountId: c.accountId,
                  folder: c.folder,
                  uid: c.uid,
                  messageId: null,
                  subject: c.subject,
                  from: c.who
                })
              }
            />
          </section>
        )}
        {error && (
          <div className="reader-alert" role="alert">
            {error.locked ? <Lock size={18} /> : <AlertTriangle size={18} />}
            <span>{error.message}</span>
          </div>
        )}
        {!tasks ? (
          <div className="empty-list">
            <LoaderCircle className="spin" size={20} />
          </div>
        ) : visible.length ? (
          <div className="task-list" role="list" aria-label={t('Aufgaben')}>
            {visible.map(row)}
          </div>
        ) : (
          !error && (
            <div className="empty-list">
              <ListTodo size={24} />
              <h3>{empty[view]}</h3>
              {all.length === 0 && (
                <p>
                  {t('Im Lesebereich wird aus einer E-Mail mit „Als Aufgabe“ eine Aufgabe, mit Link zurück zur Mail.')}
                </p>
              )}
            </div>
          )
        )}
      </section>
      {editing && <TaskDialog draft={editing} onClose={() => setEditing(null)} />}
    </main>
  );
}
