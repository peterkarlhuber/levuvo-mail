// Tasks made from mails: types and pure helpers (unit-tested in apps/web/test, no runtime imports).
export type TaskMailRef = {
  accountId: string;
  accountLabel?: string | null;
  folder: string;
  uid: number;
  messageId: string | null;
  subject: string;
  from: string;
};
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';
export type TaskRepeat = { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'; interval: number } | null;
export type TaskView = 'today' | 'upcoming' | 'overdue' | 'open' | 'done' | 'all';
export type Task = {
  id: string;
  title: string;
  notes: string;
  /** null, a date (YYYY-MM-DD) or an ISO instant. */
  due: string | null;
  remindAt: string | null;
  remindedAt?: string | null;
  priority: TaskPriority;
  repeat: TaskRepeat;
  source: 'manual' | 'mail' | 'ai';
  done: boolean;
  doneAt: string | null;
  mail: TaskMailRef | null;
  /** Person the task is about (made in their contact history). */
  contact?: { email: string; name: string } | null;
  /** Connected list the task is synced with (null: only on this device). */
  list?: string | null;
  /**
   * Space the task belongs to (a space task assigned to me, shown in the main area). Its changes
   * go to the space; `readOnly` when my role there is reader.
   */
  space?: TaskSpaceRef | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskSpaceRef = { id: string; name: string; readOnly?: boolean };
/** List filter value of a space. */
export const spaceFilter = (spaceId: string) => `space:${spaceId}`;

export type TaskSyncProvider = 'caldav' | 'microsoft' | 'google';
/** A connected list (CalDAV, Microsoft To Do, Google Tasks). */
export type TaskLink = {
  id: string;
  provider: TaskSyncProvider;
  accountId: string;
  accountLabel: string;
  listId: string;
  name: string;
  lastSync: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
};
/** A list on a server that can be connected. */
export type TaskListSource = {
  provider: TaskSyncProvider;
  accountId: string;
  accountLabel: string;
  listId: string;
  name: string;
  connected: boolean;
};
/** 'all', 'local' (this device only), a connected list's id or `space:<id>` (see spaceFilter). */
export type TaskListFilter = string;
export function inList<T extends Pick<Task, 'list' | 'space'>>(list: T[], filter: TaskListFilter) {
  if (filter === 'all') return list;
  if (filter === 'local') return list.filter(t => !t.list && !t.space);
  if (filter.startsWith('space:')) return list.filter(t => t.space && spaceFilter(t.space.id) === filter);
  return list.filter(t => t.list === filter);
}
/** Spaces that tasks in the list belong to (for the sidebar), by name. */
export function spacesOf<T extends Pick<Task, 'space'>>(list: T[]) {
  const seen = new Map<string, TaskSpaceRef>();
  for (const t of list) if (t.space && !seen.has(t.space.id)) seen.set(t.space.id, t.space);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const pad = (n: number) => String(n).padStart(2, '0');
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Title proposed for a task made from a mail: the subject without Re:/AW:/Fwd: prefixes. */
export function taskTitleFromSubject(subject: string) {
  return String(subject || '')
    .replace(/^\s*((re|aw|wg|fw|fwd|antw)\s*:\s*)+/i, '')
    .trim()
    .slice(0, 300);
}

/** Form values (date + optional time, local) → stored due value. */
export function dueFromForm(date: string, time: string): string | null {
  if (!DATE.test(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return date;
  return new Date(`${date}T${time}:00`).toISOString();
}
/** Stored due value → form values (local date and time). */
export function formFromDue(due: string | null): { date: string; time: string } {
  if (!due) return { date: '', time: '' };
  if (DATE.test(due)) return { date: due, time: '' };
  const d = new Date(due);
  return { date: localDate(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
/** Local calendar day a task is due on (null without due date). */
export function dueDay(due: string | null) {
  if (!due) return null;
  return DATE.test(due) ? due : localDate(new Date(due));
}
/** overdue / today / soon (next 7 days) / later / none, relative to `now`. */
export function dueState(task: Pick<Task, 'due' | 'done'>, now = new Date()) {
  const day = dueDay(task.due);
  if (!day || task.done) return 'none';
  const today = localDate(now);
  if (day < today || (!DATE.test(task.due!) && new Date(task.due!) < now)) return 'overdue';
  if (day === today) return 'today';
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  return day <= localDate(week) ? 'soon' : 'later';
}
/**
 * Due or reminder value for display: a date (YYYY-MM-DD, shown as that calendar day) or an
 * instant (shown with its local time). An unreadable value is shown as it is instead of
 * throwing (Intl throws a RangeError for an invalid date, which would take the view down).
 */
export function formatTaskDate(
  locale: string,
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions & { withTime?: boolean } = {}
) {
  if (!value) return '';
  const { withTime, ...rest } = options;
  const dated = DATE.test(value);
  const at = new Date(dated ? `${value}T12:00:00` : value);
  if (!Number.isFinite(at.getTime())) return String(value).slice(0, 40);
  const time: Intl.DateTimeFormatOptions = !dated && withTime !== false ? { hour: '2-digit', minute: '2-digit' } : {};
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...rest, ...time }).format(at);
  } catch {
    return String(value).slice(0, 40);
  }
}
/** Quick due choices: today, tomorrow, next Monday, in a week. */
export function duePresets(now = new Date()) {
  const at = (n: number) => localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return { today: at(0), tomorrow: at(1), monday: at(toMonday), week: at(7) };
}

export type ReminderChoice = 'none' | 'atDue' | 'before15' | 'before60' | 'morning' | 'dayBefore' | 'custom';

/** Reminder time for a choice, relative to the due value (null when it cannot be computed). */
export function reminderFor(choice: ReminderChoice, due: string | null, custom = ''): string | null {
  if (choice === 'none') return null;
  if (choice === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(custom)) return null;
    return new Date(`${custom}:00`).toISOString();
  }
  if (!due) return null;
  const dated = DATE.test(due);
  const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString();
  const day = dueDay(due)!;
  if (choice === 'morning') return at(day, '09:00');
  if (choice === 'dayBefore') {
    const [y, m, d] = day.split('-').map(Number);
    return at(localDate(new Date(y, m - 1, d - 1)), '09:00');
  }
  if (dated) return at(day, '09:00');
  const t = new Date(due).getTime();
  if (choice === 'atDue') return new Date(t).toISOString();
  return new Date(t - (choice === 'before15' ? 15 : 60) * 60_000).toISOString();
}
/** Which choice describes a stored reminder (for editing). */
export function reminderChoice(remindAt: string | null, due: string | null): ReminderChoice {
  if (!remindAt) return 'none';
  if (!Number.isFinite(Date.parse(remindAt))) return 'custom';
  for (const c of ['atDue', 'before15', 'before60', 'morning', 'dayBefore'] as const)
    if (reminderFor(c, due) === new Date(remindAt).toISOString()) return c;
  return 'custom';
}
/** Local "YYYY-MM-DDTHH:MM" of an instant (for a datetime-local input). */
export function localDateTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const TZ_NAME = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Vienna';
const RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2, none: 3 };
const dueKey = (t: Pick<Task, 'due'>) =>
  t.due ? (DATE.test(t.due) ? `${t.due}T00:00` : localDateTime(t.due)) : '9999';

/** Tasks of a view (same rules as the server, in this computer's zone). */
export function filterView<T extends Pick<Task, 'due' | 'done' | 'priority' | 'doneAt' | 'createdAt'>>(
  list: T[],
  view: TaskView,
  now = new Date()
): T[] {
  const today = localDate(now);
  const week = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const pick: Record<TaskView, (t: T) => boolean> = {
    today: t => !t.done && Boolean(t.due) && (dueDay(t.due)! <= today || dueState(t, now) === 'overdue'),
    upcoming: t => !t.done && Boolean(t.due) && dueDay(t.due)! > today && dueDay(t.due)! <= week,
    overdue: t => dueState(t, now) === 'overdue',
    open: t => !t.done,
    done: t => t.done,
    all: () => true
  };
  return list.filter(pick[view]).sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return String(b.doneAt || '').localeCompare(String(a.doneAt || ''));
    return (
      dueKey(a).localeCompare(dueKey(b)) ||
      RANK[a.priority || 'none'] - RANK[b.priority || 'none'] ||
      String(a.createdAt).localeCompare(String(b.createdAt))
    );
  });
}
export function viewCounts<T extends Pick<Task, 'due' | 'done' | 'priority' | 'doneAt' | 'createdAt'>>(
  list: T[],
  now = new Date()
) {
  const views: TaskView[] = ['today', 'upcoming', 'overdue', 'open', 'done', 'all'];
  return Object.fromEntries(views.map(v => [v, filterView(list, v, now).length])) as Record<TaskView, number>;
}
/** Open tasks whose due day lies in [from, to) (local dates), for the calendar. */
export function tasksInRange<T extends Pick<Task, 'due' | 'done'>>(list: T[], from: string, to: string) {
  return list.filter(t => !t.done && t.due && dueDay(t.due)! >= from && dueDay(t.due)! < to);
}
/** Open tasks made from a mail (same account; by folder + UID or by Message-ID after a move). */
export function tasksForMail<T extends Pick<Task, 'done' | 'mail'>>(
  list: T[],
  mail: { accountId: string; folder: string; uid: number; messageId: string | null }
) {
  return list.filter(
    t =>
      !t.done &&
      t.mail?.accountId === mail.accountId &&
      ((t.mail.folder === mail.folder && t.mail.uid === mail.uid) ||
        (Boolean(mail.messageId) && t.mail.messageId === mail.messageId))
  );
}
