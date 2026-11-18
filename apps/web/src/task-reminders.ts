// App-wide task state: the badge count (due today or overdue) and, in the browser, the reminders.
// The desktop app shows task reminders from its main process, also with the window closed.
import { useCallback, useEffect, useState } from 'react';
import { ApiError, getJson, postJson } from './api';
import { filterView, TZ_NAME, type Task } from './tasks';

export function useTaskBadge({
  browserReminders,
  onReminder
}: {
  browserReminders: boolean;
  onReminder: (t: Task) => void;
}) {
  const [due, setDue] = useState(0);
  useEffect(() => {
    const count = () =>
      getJson<{ tasks: Task[] }>(`/api/tasks?view=today&tz=${encodeURIComponent(TZ_NAME)}`)
        .then(d => setDue(filterView(d.tasks, 'today').length))
        .catch(() => setDue(0));
    void count();
    window.addEventListener('levuvo:tasks-changed', count);
    const timer = window.setInterval(count, 5 * 60_000);
    return () => {
      window.removeEventListener('levuvo:tasks-changed', count);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!browserReminders) return;
    const check = async () => {
      try {
        const { tasks } = await postJson<{ tasks: Task[] }>('/api/tasks/reminders/claim', {}, 'mail-v1');
        for (const task of tasks) onReminder(task);
      } catch {
        /* tasks locked or offline */
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    return () => window.clearInterval(timer);
  }, [browserReminders, onReminder]);
  return due;
}

/** Loads all tasks and reloads on changes from anywhere in the app. */
export function useTasks() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<{ message: string; locked: boolean } | null>(null);
  const load = useCallback(async () => {
    try {
      const d = await getJson<{ tasks: Task[] }>(`/api/tasks?view=all&tz=${encodeURIComponent(TZ_NAME)}`);
      setTasks(d.tasks);
      setError(null);
    } catch (e) {
      setTasks(t => t ?? []);
      setError({ message: (e as Error).message, locked: e instanceof ApiError && e.status === 423 });
    }
  }, []);
  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener('levuvo:tasks-changed', reload);
    // Due states change with the clock.
    const timer = window.setInterval(reload, 5 * 60_000);
    return () => {
      window.removeEventListener('levuvo:tasks-changed', reload);
      window.clearInterval(timer);
    };
  }, [load]);
  return { tasks, error, reload: load };
}
