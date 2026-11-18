// Hint in the reader when a task was made from this mail: title, due date, "done" in one click.
import { CircleCheck, ListTodo } from 'lucide-react';
import { postJson } from './api';
import { useUi } from './ConfirmDialog';
import { useT } from './i18n';
import { tasksChanged } from './TaskDialog';
import { useTasks } from './task-reminders';
import { dueState, tasksForMail } from './tasks';
import type { Detail } from './types';

export function TaskHint({ accountId, detail }: { accountId: string; detail: Detail }) {
  const { t, locale } = useT();
  const { toast } = useUi();
  const { tasks } = useTasks();
  const linked = tasksForMail(tasks || [], {
    accountId,
    folder: detail.folder,
    uid: detail.uid,
    messageId: detail.messageId || null
  });
  if (!linked.length) return null;
  const when = (due: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(due)
      ? new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(
          new Date(`${due}T12:00:00`)
        )
      : new Intl.DateTimeFormat(locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        }).format(new Date(due));
  return (
    <div className="task-hint" role="note">
      {linked.map(task => (
        <div key={task.id} className={`task-hint-row due-${dueState(task)}`}>
          <ListTodo size={15} />
          <span>
            {t('Aufgabe')}: <strong>{task.title}</strong>
            {task.due ? ` · ${t('fällig {when}', { when: when(task.due) })}` : ''}
          </span>
          <button
            className="btn small"
            onClick={async () => {
              try {
                await postJson('/api/tasks/done', { id: task.id, done: true }, 'mail-v1');
                tasksChanged();
                toast({ text: t('Aufgabe erledigt.'), kind: 'success' });
              } catch (e) {
                toast({ text: (e as Error).message, kind: 'error' });
              }
            }}
          >
            <CircleCheck size={14} /> {t('Erledigt')}
          </button>
        </div>
      ))}
    </div>
  );
}
